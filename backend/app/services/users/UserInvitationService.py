from datetime import datetime, timezone
import secrets
from typing import Any, Callable
import uuid

from fastapi import BackgroundTasks, HTTPException, Response
from sqlalchemy.orm import Session

from app.services.MailService import send_batch_invitations, send_invitation_email as _default_single_sender

from app.api.v1.routes.Auth import create_access_token, create_refresh_token, set_auth_cookies
from app.core.Security import hash_password
from app.models.auth.InvitationToken import InvitationToken
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.Student import Student
from app.schemas.User import AcceptInvitationRequest, AcceptInvitationResponse, InviteSingleUserRequest
from app.services.users.UserShared import (
    LRN_RE,
    attach_staff_profile,
    attach_student_profile,
    create_pending_account,
    normalize_lrn,
    resolve_academic_level_id,
    validate_optional_date,
    sha256_token,
    validate_required_name,
)

# USER INVITATION LIFECYCLE
# invite_single_user creates a pending account and profile. accept_invitation
# verifies the one-time token, sets the password, activates the account, and
# returns authentication tokens.


def invite_single_user(
    db: Session,
    payload: InviteSingleUserRequest,
    invitation_sender: Callable[[str, str], None] | None = None,
    batch_invitation_sender: Callable[[list[dict]], Any] | None = None,
    background_tasks: BackgroundTasks | None = None,
) -> dict[str, str]:
    email = str(payload.email).lower()
    if db.query(UserAccount).filter(UserAccount.email == email).first():
        raise HTTPException(status_code=409, detail="Email already registered")

    data = payload.model_dump()
    data["email"] = email
    if payload.role == "Student":
        _validate_student_data(db, data)
    elif payload.role == "Teacher":
        validate_required_name(data)
        validate_optional_date(data)
    else:
        validate_required_name(data)

    # Invitation creates the account, role, profile, and token together; the
    # account remains unusable until accept_invitation sets a password.
    account, raw_token = create_pending_account(db, email, payload.role)
    if payload.role == "Teacher":
        attach_staff_profile(db, account.user_id, data)
    elif payload.role == "Student":
        attach_student_profile(db, account.user_id, data)

    db.commit()

    item = [{"email": email, "token": raw_token, "user_id": str(account.user_id)}]
    has_custom_single = invitation_sender is not None and invitation_sender is not _default_single_sender
    has_custom_batch = batch_invitation_sender is not None and batch_invitation_sender is not send_batch_invitations

    if has_custom_single:
        invitation_sender(email, raw_token)
        account.email_status = "sent"
        db.commit()
    elif background_tasks is not None:
        target_fn = batch_invitation_sender if has_custom_batch else send_batch_invitations
        background_tasks.add_task(target_fn, item)
    elif batch_invitation_sender is not None:
        batch_invitation_sender(item)
    elif invitation_sender is not None:
        invitation_sender(email, raw_token)
        account.email_status = "sent"
        db.commit()
    else:
        send_batch_invitations(item)

    return {"message": f"Invitation sent to {email}"}


def _validate_student_data(db: Session, data: dict) -> None:
    validate_required_name(data)
    validate_optional_date(data)
    student_lrn = normalize_lrn(str(data.get("student_lrn") or ""))
    if not LRN_RE.fullmatch(student_lrn):
        raise HTTPException(status_code=400, detail="Student LRN must be exactly 12 digits")
    existing_lrn = db.query(Student).filter(Student.student_lrn == student_lrn).first()
    if existing_lrn:
        raise HTTPException(status_code=409, detail="Student LRN already registered")
    if resolve_academic_level_id(db, data) is None:
        raise HTTPException(status_code=400, detail="Invalid grade level")


def accept_invitation(
    db: Session,
    payload: AcceptInvitationRequest,
    response: Response,
) -> AcceptInvitationResponse:
    if payload.password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    invitation = db.query(InvitationToken).filter(InvitationToken.token_hash == sha256_token(payload.token)).first()
    if not invitation:
        raise HTTPException(status_code=400, detail="Invalid invitation link")
    expires_at = invitation.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invitation link has expired")

    account = db.query(UserAccount).filter(UserAccount.user_id == invitation.user_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="User not found")
    if account.account_status == "active":
        raise HTTPException(status_code=400, detail="Account already activated")

    # Activation consumes the one-time token and signs the user in immediately.
    account.password_hash = hash_password(payload.password)
    account.account_status = "active"
    account.email_verified_at = datetime.now(timezone.utc)
    db.delete(invitation)
    db.commit()

    role_row = (
        db.query(Role)
        .join(UserRoles, Role.role_id == UserRoles.role_id)
        .filter(UserRoles.user_id == account.user_id)
        .first()
    )
    role_name = role_row.role_name.lower() if role_row else "student"
    access_token = create_access_token(str(account.user_id), role_name)
    refresh_token = create_refresh_token(str(account.user_id), role_name)
    set_auth_cookies(response, access_token, refresh_token)
    return AcceptInvitationResponse(access_token=access_token, role=role_name, user_id=str(account.user_id))


def resend_user_invitation(
    db: Session,
    user_id: uuid.UUID,
    invitation_sender: Callable[[str, str], None] | None = None,
    batch_invitation_sender: Callable[[list[dict]], Any] | None = None,
    background_tasks: BackgroundTasks | None = None,
) -> dict[str, str]:
    account = db.query(UserAccount).filter(UserAccount.user_id == user_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="User not found")
    if account.account_status != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot resend invitation for account with status '{account.account_status}'",
        )

    # Invalidate existing invitation tokens for this user
    db.query(InvitationToken).filter(InvitationToken.user_id == user_id).delete()

    raw_token = secrets.token_urlsafe(32)
    db.add(InvitationToken(user_id=account.user_id, token_hash=sha256_token(raw_token)))
    account.email_status = "pending"
    db.commit()

    item = [{"email": account.email, "token": raw_token, "user_id": str(account.user_id)}]
    has_custom_single = invitation_sender is not None and invitation_sender is not _default_single_sender
    has_custom_batch = batch_invitation_sender is not None and batch_invitation_sender is not send_batch_invitations

    if has_custom_single:
        invitation_sender(account.email, raw_token)
        account.email_status = "sent"
        db.commit()
    elif background_tasks is not None:
        target_fn = batch_invitation_sender if has_custom_batch else send_batch_invitations
        background_tasks.add_task(target_fn, item)
    elif batch_invitation_sender is not None:
        batch_invitation_sender(item)
    elif invitation_sender is not None:
        invitation_sender(account.email, raw_token)
        account.email_status = "sent"
        db.commit()
    else:
        send_batch_invitations(item)

    return {"message": f"Invitation resent to {account.email}"}

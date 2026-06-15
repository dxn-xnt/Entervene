import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.db.Session import get_db
from app.schemas.User import AcceptInvitationRequest, AcceptInvitationResponse, InviteSingleUserRequest, UpdateUserRequest
from app.services.MailService import send_invitation_email
from app.services.users.UserAccountService import archive_user as archive_user_account
from app.services.users.UserAccountService import update_user as update_user_account
from app.services.users.UserImportService import import_users_file
from app.services.users.UserInvitationService import accept_invitation as accept_user_invitation
from app.services.users.UserInvitationService import invite_single_user as invite_user
from app.services.users.UserQueryService import ClientRole
from app.services.users.UserQueryService import display_name as _display_name
from app.services.users.UserQueryService import get_user_analytics as query_user_analytics
from app.services.users.UserQueryService import get_user_detail as query_user_detail
from app.services.users.UserQueryService import list_users as query_users
from app.services.users.UserShared import capitalize_name as _capitalize_name


# USER MANAGEMENT FLOW
# 1. Admin-only endpoints list, inspect, update, archive, invite, or import users.
# 2. Routes authenticate the requester, then delegate work to a user service:
#    - UserQueryService: build admin list/detail responses
#    - UserAccountService: update or archive existing users
#    - UserInvitationService: invite users and activate pending accounts
#    - UserImportService: validate and create users from CSV/Excel files
# 3. A new user starts as "pending" and becomes "active" after accepting the
#    invitation and creating a password.
router = APIRouter()


# User routes use get_current_user plus this check because this router also
# contains the public invitation-acceptance endpoint below.
def _require_admin(current_user: dict) -> None:
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")


@router.get("/users")
def list_users(
    role: ClientRole | None = Query(default=None),
    search: str | None = Query(default=None),
    status: str | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_admin(current_user)
    return query_users(db=db, role=role, search=search, status=status)


@router.get("/users/{user_id}")
def get_user_detail(
    user_id: uuid.UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_admin(current_user)
    return query_user_detail(db, user_id)


@router.put("/users/{user_id}")
def update_user(
    user_id: uuid.UUID,
    payload: UpdateUserRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_admin(current_user)
    return update_user_account(db, user_id, payload)


@router.patch("/users/{user_id}/archive")
def archive_user(
    user_id: uuid.UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_admin(current_user)
    return archive_user_account(db, user_id)


@router.get("/users/{user_id}/analytics")
def get_user_analytics(
    user_id: uuid.UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_admin(current_user)
    return query_user_analytics(db, user_id)


# Single invite flow: validate details -> create pending account and profile ->
# commit records -> send the invitation email.
@router.post("/users/invite")
def invite_single_user(
    payload: InviteSingleUserRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_admin(current_user)
    return invite_user(db, payload, send_invitation_email)


# Bulk invite flow follows the same account lifecycle as a single invite, but
# validates every uploaded row before creating any account.
# Keep the legacy admin path and the current path mapped to the same import flow.
@router.post("/admin/users/upload-csv")
@router.post("/users/upload-csv")
async def upload_csv(
    role: str = Query(..., description="Teacher or Student"),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    _require_admin(current_user)
    return await import_users_file(db=db, file=file, role=role, invitation_sender=send_invitation_email)


# Invitation acceptance is intentionally public; possession of the one-time
# invitation token is the authorization required to activate the account.
@router.post("/auth/accept-invitation", response_model=AcceptInvitationResponse)
def accept_invitation(
    payload: AcceptInvitationRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    return accept_user_invitation(db, payload, response)

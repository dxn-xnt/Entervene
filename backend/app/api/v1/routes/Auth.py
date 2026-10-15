import secrets
import re
import hashlib
from datetime import timedelta
from fastapi import BackgroundTasks
from app.core.RequestLimits import login_limiter
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.Config import settings
from app.core.Security import (
    create_token,
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_token,
    hash_password,
    is_password_hash,
    verify_password,
)
from app.db.Session import get_db
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserLoginLog import UserLoginLog
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.schemas.Auth import AvatarUpdate, ForgotPasswordRequest, LoginRequest, LoginResponse, ResetPasswordRequest
from app.services.MailService import send_password_reset_email

router = APIRouter()
bearer_scheme = HTTPBearer(auto_error=False)

ACCESS_COOKIE_NAME = "entervene_access"
REFRESH_COOKIE_NAME = "entervene_refresh"
CSRF_COOKIE_NAME = "entervene_csrf"


def _set_cookie(response: Response, key: str, value: str, max_age: int, httponly: bool = True) -> None:
    response.set_cookie(
        key=key,
        value=value,
        max_age=max_age,
        httponly=httponly,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        domain=settings.cookie_domain,
        path="/",
    )


def set_auth_cookies(response: Response, access_token: str, refresh_token: str) -> None:
    _set_cookie(response, ACCESS_COOKIE_NAME, access_token, settings.access_token_expire_minutes * 60)
    _set_cookie(
        response,
        REFRESH_COOKIE_NAME,
        refresh_token,
        settings.refresh_token_expire_days * 24 * 60 * 60,
    )
    csrf_token = secrets.token_urlsafe(32)
    _set_cookie(
        response,
        CSRF_COOKIE_NAME,
        csrf_token,
        settings.refresh_token_expire_days * 24 * 60 * 60,
        httponly=False,
    )
    response.headers["X-CSRF-Token"] = csrf_token


def clear_auth_cookies(response: Response) -> None:
    for key in (ACCESS_COOKIE_NAME, REFRESH_COOKIE_NAME, CSRF_COOKIE_NAME):
        response.delete_cookie(
            key=key,
            domain=settings.cookie_domain,
            path="/",
            secure=settings.cookie_secure,
            samesite=settings.cookie_samesite,
        )


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    token = request.cookies.get(ACCESS_COOKIE_NAME)
    if not token and credentials:
        token = credentials.credentials
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")

    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload


def _user_identity_query(db: Session):
    return (
        db.query(
            UserAccount.user_id,
            UserAccount.email,
            UserAccount.avatar_path,
            UserAccount.password_hash,
            UserAccount.account_status,
            Role.role_name,
            func.coalesce(
                func.nullif(func.concat(AcademicStaff.first_name, " ", AcademicStaff.last_name), " "),
                func.nullif(func.concat(Student.first_name, " ", Student.last_name), " "),
            ).label("full_name"),
        )
        .join(UserRoles, UserAccount.user_id == UserRoles.user_id)
        .join(Role, UserRoles.role_id == Role.role_id)
        .outerjoin(AcademicStaff, UserAccount.user_id == AcademicStaff.user_id)
        .outerjoin(Student, UserAccount.user_id == Student.user_id)
    )


def _role_name_to_client_role(role_name: str | None) -> str:
    return {"teacher": "teacher", "student": "student", "admin": "admin"}.get((role_name or "").strip().lower(), "student")


def _password_fingerprint(password_hash: str | None) -> str:
    return hashlib.sha256((password_hash or "").encode()).hexdigest()


@router.post("/forgot-password")
def forgot_password(body: ForgotPasswordRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    # Keep the response identical for unknown, pending, and active accounts.
    email = str(body.email).strip().lower()
    if not login_limiter.allow("reset:" + hashlib.sha256(email.encode()).hexdigest(), 3):
        raise HTTPException(429, "Too many requests. Please wait.", headers={"Retry-After": "60"})
    account = db.query(UserAccount).filter(func.lower(UserAccount.email) == email).first()
    if account and (account.account_status or "").strip().lower() == "active":
        token = create_token(str(account.user_id), "", "password_reset", timedelta(minutes=30))
        # A password change invalidates every earlier reset link.
        background_tasks.add_task(send_password_reset_email, account.email, token + "." + _password_fingerprint(account.password_hash))
    return {"message": "If this email has an active account, a reset link has been sent."}


@router.post("/reset-password")
def reset_password(body: ResetPasswordRequest, db: Session = Depends(get_db)):
    if body.password != body.confirm_password:
        raise HTTPException(400, "Passwords do not match")
    signed_token, separator, fingerprint = body.token.rpartition(".")
    payload = decode_token(signed_token, expected_type="password_reset") if separator else None
    if not payload or not fingerprint:
        raise HTTPException(400, "Invalid or expired reset link")
    account = db.query(UserAccount).filter(UserAccount.user_id == payload.get("sub")).first()
    if not account or (account.account_status or "").strip().lower() != "active" or not secrets.compare_digest(fingerprint, _password_fingerprint(account.password_hash)):
        raise HTTPException(400, "Invalid or expired reset link")
    account.password_hash = hash_password(body.password)
    db.commit()
    return {"message": "Password updated. You can now sign in."}


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    account_key = hashlib.sha256(str(body.email).strip().lower().encode()).hexdigest()
    if not login_limiter.allow(account_key, 10):
        raise HTTPException(429, "Too many login attempts. Please wait.", headers={"Retry-After": "60"})
    result = _user_identity_query(db).filter(func.lower(UserAccount.email) == str(body.email).strip().lower()).first()
    if not result:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if is_password_hash(result.password_hash):
        password_ok = verify_password(body.password, result.password_hash)
        replacement_hash = None
    else:
        password_ok = secrets.compare_digest(result.password_hash or "", body.password)
        replacement_hash = hash_password(body.password) if password_ok else None

    if not password_ok:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if (result.account_status or "").strip().lower() != "active":
        raise HTTPException(status_code=403, detail="Account is inactive")

    role = _role_name_to_client_role(result.role_name)
    set_auth_cookies(
        response,
        create_access_token(str(result.user_id), role),
        create_refresh_token(str(result.user_id), role),
    )

    log_entry = UserLoginLog(user_id=result.user_id, login_at=datetime.now(timezone.utc))
    db.add(log_entry)

    update_values = {"last_login": datetime.now(timezone.utc)}
    if replacement_hash:
        update_values["password_hash"] = replacement_hash
    db.query(UserAccount).filter(UserAccount.user_id == result.user_id).update(update_values)

    db.commit()
    db.refresh(log_entry)

    return {
        "role": role,
        "user_id": str(result.user_id),
        "email": result.email,
        "full_name": (result.full_name or "").strip() or "User",
        "login_log_id": log_entry.login_id,
        "avatar": result.avatar_path,
    }


@router.get("/me")
def get_me(current_user: dict = Depends(get_current_user), db: Session = Depends(get_db)):
    result = _user_identity_query(db).filter(UserAccount.user_id == current_user["sub"]).first()
    if not result:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "user_id": str(result.user_id),
        "email": result.email,
        "full_name": (result.full_name or "").strip() or "User",
        "role": _role_name_to_client_role(result.role_name),
        "account_status": result.account_status,
        "avatar": result.avatar_path,
    }


@router.patch("/me/avatar")
def update_my_avatar(
    body: AvatarUpdate,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    role = current_user.get("role")
    avatar_range = "(?:1[2-9]|20)" if role in ("teacher", "admin") else "(?:[1-9]|1[01])"
    avatar_group = "teacher-avatars" if role in ("teacher", "admin") else "student-avatars"
    if not re.fullmatch(rf"/avatars/{avatar_group}/{avatar_range}\.svg", body.avatar):
        raise HTTPException(status_code=422, detail="Invalid avatar choice")
    account = db.get(UserAccount, current_user["sub"])
    if account is None:
        raise HTTPException(status_code=404, detail="User not found")
    account.avatar_path = body.avatar
    db.commit()
    return {"avatar": account.avatar_path}


@router.post("/refresh", response_model=LoginResponse)
def refresh_session(request: Request, response: Response, db: Session = Depends(get_db)):
    refresh_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not refresh_token:
        raise HTTPException(status_code=401, detail="Missing refresh token")

    payload = decode_token(refresh_token, expected_type="refresh")
    if not payload:
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Invalid or expired refresh token")

    result = _user_identity_query(db).filter(UserAccount.user_id == payload["sub"]).first()
    if not result or (result.account_status or "").strip().lower() != "active":
        clear_auth_cookies(response)
        raise HTTPException(status_code=401, detail="Invalid session")

    role = _role_name_to_client_role(result.role_name)
    set_auth_cookies(
        response,
        create_access_token(str(result.user_id), role),
        create_refresh_token(str(result.user_id), role),
    )
    return {
        "role": role,
        "user_id": str(result.user_id),
        "email": result.email,
        "full_name": (result.full_name or "").strip() or "User",
        "login_log_id": 0,
        "avatar": result.avatar_path,
    }


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
):
    token = request.cookies.get(ACCESS_COOKIE_NAME)
    if token:
        payload = decode_access_token(token)
        if payload and "sub" in payload:
            log_entry = (
                db.query(UserLoginLog)
                .filter(UserLoginLog.user_id == payload["sub"], UserLoginLog.logout_at.is_(None))
                .order_by(UserLoginLog.login_at.desc())
                .first()
            )
            if log_entry:
                log_entry.logout_at = datetime.now(timezone.utc)
                db.commit()

    clear_auth_cookies(response)
    return {"message": "Logged out successfully"}

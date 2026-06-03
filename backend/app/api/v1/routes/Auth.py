import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.Config import settings
from app.core.Security import (
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
from app.schemas.Auth import LoginRequest, LoginResponse

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
    _set_cookie(
        response,
        CSRF_COOKIE_NAME,
        secrets.token_urlsafe(32),
        settings.refresh_token_expire_days * 24 * 60 * 60,
        httponly=False,
    )


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
    return {"Teacher": "teacher", "Student": "student", "Admin": "admin"}.get(role_name or "", "student")


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    result = _user_identity_query(db).filter(UserAccount.email == body.email).first()
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
    if result.account_status != "active":
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
    }


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
    if not result or result.account_status != "active":
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
    }


@router.post("/logout")
def logout(
    response: Response,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    log_entry = (
        db.query(UserLoginLog)
        .filter(UserLoginLog.user_id == current_user["sub"], UserLoginLog.logout_at.is_(None))
        .order_by(UserLoginLog.login_at.desc())
        .first()
    )
    if log_entry:
        log_entry.logout_at = datetime.now(timezone.utc)
        db.commit()

    clear_auth_cookies(response)
    return {"message": "Logged out successfully"}

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.db.Session import get_db
from app.schemas.Auth import LoginRequest, LoginResponse
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.auth.Role import Role
from app.models.auth.UserLoginLog import UserLoginLog
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.core.Security import create_access_token, decode_access_token
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from datetime import datetime, timezone

router = APIRouter()
bearer_scheme = HTTPBearer()


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
):
    token = credentials.credentials
    payload = decode_access_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return payload


@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    result = (
        db.query(
            UserAccount.user_id,
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
        .filter(UserAccount.email == body.email)
        .first()
    )

    if not result:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if result.password_hash != body.password:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if result.account_status != "active":
        raise HTTPException(status_code=403, detail="Account is inactive")

    role_map = {"Teacher": "teacher", "Student": "student", "Admin": "admin"}
    role = role_map.get(result.role_name, "student")

    token = create_access_token(str(result.user_id), role)

    log_entry = UserLoginLog(
        user_id=result.user_id,
        login_at=datetime.now(timezone.utc),
    )
    db.add(log_entry)

    db.query(UserAccount).filter(UserAccount.user_id == result.user_id).update(
        {"last_login": datetime.now(timezone.utc)}
    )

    db.commit()
    db.refresh(log_entry)

    return {
        "access_token": token,
        "token_type": "bearer",
        "role": role,
        "user_id": str(result.user_id),
        "full_name": result.full_name,
        "login_log_id": log_entry.login_id,
    }


@router.get("/me")
def get_me(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user["sub"]

    result = (
        db.query(
            UserAccount.user_id,
            UserAccount.email,
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
        .filter(UserAccount.user_id == user_id)
        .first()
    )

    if not result:
        raise HTTPException(status_code=404, detail="User not found")

    role_map = {"Teacher": "teacher", "Student": "student", "Admin": "admin"}

    return {
        "user_id": str(result.user_id),
        "email": result.email,
        "full_name": result.full_name,
        "role": role_map.get(result.role_name, "student"),
        "account_status": result.account_status,
    }


@router.post("/logout")
def logout(
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    user_id = current_user["sub"]
    log_entry = (
        db.query(UserLoginLog)
        .filter(
            UserLoginLog.user_id == user_id,
            UserLoginLog.logout_at.is_(None),
        )
        .order_by(UserLoginLog.login_at.desc())
        .first()
    )

    if log_entry:
        log_entry.logout_at = datetime.now(timezone.utc)
        db.commit()

    return {"message": "Logged out successfully"}
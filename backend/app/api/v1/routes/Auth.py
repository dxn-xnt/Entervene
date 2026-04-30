from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from app.db.Session import get_db
from app.schemas.Auth import LoginRequest, LoginResponse
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.auth.Role import Role
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.core.Security import create_access_token

router = APIRouter()

@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    result = (
        db.query(
            UserAccount.user_id,
            UserAccount.password_hash,
            UserAccount.account_status,
            Role.role_name,
            func.coalesce(
                func.concat(AcademicStaff.first_name, " ", AcademicStaff.last_name),
                func.concat(Student.first_name, " ", Student.last_name),
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

    return {
        "access_token": token,
        "token_type": "bearer",
        "role": role,
        "user_id": str(result.user_id),
        "full_name": result.full_name,
    }
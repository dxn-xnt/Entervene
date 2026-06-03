from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.v1.routes.Auth import get_current_user
from app.db.Session import get_db
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student

router = APIRouter()

ClientRole = Literal["admin", "teacher", "student"]


def _role_name_to_client_role(role_name: str | None) -> ClientRole:
    role = {"Admin": "admin", "Teacher": "teacher", "Student": "student"}.get(role_name or "")
    return role or "student"


@router.get("/users")
def list_users(
    role: ClientRole | None = Query(default=None),
    search: str | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    full_name = func.coalesce(
        func.nullif(func.concat(AcademicStaff.first_name, " ", AcademicStaff.last_name), " "),
        func.nullif(func.concat(Student.first_name, " ", Student.last_name), " "),
    ).label("full_name")

    query = (
        db.query(
            UserAccount.user_id,
            UserAccount.email,
            UserAccount.created_at,
            Role.role_name,
            full_name,
        )
        .join(UserRoles, UserAccount.user_id == UserRoles.user_id)
        .join(Role, UserRoles.role_id == Role.role_id)
        .outerjoin(AcademicStaff, UserAccount.user_id == AcademicStaff.user_id)
        .outerjoin(Student, UserAccount.user_id == Student.user_id)
    )

    if role:
        query = query.filter(Role.role_name == role.title())

    if search:
        keyword = f"%{search.strip()}%"
        query = query.filter(
            or_(
                UserAccount.email.ilike(keyword),
                AcademicStaff.first_name.ilike(keyword),
                AcademicStaff.last_name.ilike(keyword),
                Student.first_name.ilike(keyword),
                Student.last_name.ilike(keyword),
            )
        )

    users = query.order_by(UserAccount.created_at.desc()).all()

    return [
        {
            "id": str(user.user_id),
            "name": (user.full_name or "").strip() or user.email,
            "email": user.email,
            "role": _role_name_to_client_role(user.role_name),
            "created_at": user.created_at.date().isoformat() if user.created_at else "",
        }
        for user in users
    ]

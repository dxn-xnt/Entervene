from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.api.v1.routes.Auth import get_current_user
from app.db.Session import get_db
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission

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
            AcademicStaff.staff_id,
            Student.student_id,
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

    response = []
    for user in users:
        client_role = _role_name_to_client_role(user.role_name)
        item = {
            "id": str(user.user_id),
            "name": (user.full_name or "").strip() or user.email,
            "email": user.email,
            "role": client_role,
            "created_at": user.created_at.date().isoformat() if user.created_at else "",
        }

        if client_role == "teacher" and user.staff_id:
            teacher_loads = (
                db.query(Subject.subject_name, SubjectLoad.class_id)
                .join(SubjectLoad, Subject.subject_id == SubjectLoad.subject_id)
                .filter(SubjectLoad.staff_id == user.staff_id)
                .filter(SubjectLoad.status == "active")
                .all()
            )
            item["subjects"] = sorted({load.subject_name for load in teacher_loads if load.subject_name})
            item["class_count"] = len({load.class_id for load in teacher_loads if load.class_id is not None})

        if client_role == "student" and user.student_id:
            class_row = (
                db.query(Class.section_name)
                .join(StudentClass, Class.class_id == StudentClass.class_id)
                .filter(StudentClass.student_id == user.student_id)
                .filter(StudentClass.enrollment_status == "enrolled")
                .order_by(StudentClass.enrolled_at.desc())
                .first()
            )
            average = (
                db.query(func.avg(StudentSubmission.grade))
                .filter(StudentSubmission.student_id == user.student_id)
                .filter(StudentSubmission.status == "graded")
                .filter(StudentSubmission.grade.isnot(None))
                .scalar()
            )
            item["section"] = class_row.section_name if class_row else None
            item["average"] = round(float(average)) if average is not None else None

        response.append(item)

    return response

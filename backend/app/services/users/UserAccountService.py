import uuid

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.schemas.User import UpdateUserRequest
from app.services.classes.ClassService import build_student_class_assignment
from app.services.users.UserQueryService import get_user_detail, role_name_to_client_role
from app.services.users.UserShared import capitalize_name, resolve_academic_level_id


COMMON_STATUSES = {"active", "pending", "inactive", "suspended", "archived"}
STUDENT_STATUSES = COMMON_STATUSES | {"no section assigned", "graduated", "transferred", "dropped"}


def update_user(db: Session, user_id: uuid.UUID, payload: UpdateUserRequest) -> dict:
    account = db.query(UserAccount).filter(UserAccount.user_id == user_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="User not found")
    if (account.account_status or "").lower() == "pending":
        raise HTTPException(status_code=400, detail="Pending accounts cannot be edited until the invitation is accepted")

    role_row = (
        db.query(Role.role_name)
        .join(UserRoles, Role.role_id == UserRoles.role_id)
        .filter(UserRoles.user_id == user_id)
        .first()
    )
    client_role = role_name_to_client_role(role_row.role_name if role_row else None)
    allowed_statuses = STUDENT_STATUSES if client_role == "student" else COMMON_STATUSES
    status = payload.account_status.strip().lower()
    if status not in allowed_statuses:
        raise HTTPException(status_code=400, detail="Invalid account status")

    first_name = capitalize_name(payload.first_name)
    middle_name = capitalize_name(payload.middle_name)
    last_name = capitalize_name(payload.last_name)
    email = payload.email.lower()
    if not first_name or not last_name:
        raise HTTPException(status_code=400, detail="First name and last name are required")
    if db.query(UserAccount).filter(UserAccount.email == email, UserAccount.user_id != user_id).first():
        raise HTTPException(status_code=409, detail="Email already registered")

    account.email = email
    account.account_status = status
    if client_role == "student":
        _update_student(db, user_id, payload, first_name, middle_name, last_name, email)
    elif client_role == "teacher":
        _update_teacher(db, user_id, payload, first_name, middle_name, last_name, email)
    else:
        staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_id).first()
        if staff:
            staff.first_name = first_name
            staff.middle_name = middle_name
            staff.last_name = last_name
            staff.email = email

    db.commit()
    return get_user_detail(db, user_id)


def _update_student(
    db: Session,
    user_id: uuid.UUID,
    payload: UpdateUserRequest,
    first_name: str,
    middle_name: str,
    last_name: str,
    email: str,
) -> None:
    student = db.query(Student).filter(Student.user_id == user_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student profile not found")
    student.first_name = first_name
    student.middle_name = middle_name
    student.last_name = last_name
    student.email = email
    student.contact_number = payload.contact_number.strip()
    student.address = payload.address.strip()

    if payload.grade_level is not None:
        academic_level_id = resolve_academic_level_id(db, {"grade_level": payload.grade_level})
        if not academic_level_id:
            raise HTTPException(status_code=400, detail="Invalid grade level")
        student.academic_level_id = academic_level_id

    section = (payload.section or "").strip()
    if not section:
        return
    class_row = db.query(Class).filter(func.lower(Class.section_name) == section.lower()).first()
    if not class_row:
        raise HTTPException(status_code=400, detail="Section not found")
    current_enrollment = (
        db.query(StudentClass)
        .filter(StudentClass.student_id == student.student_id)
        .filter(StudentClass.enrollment_status == "enrolled")
        .order_by(StudentClass.enrolled_at.desc())
        .first()
    )
    if current_enrollment:
        current_enrollment.class_id = class_row.class_id
        current_enrollment.academic_year_id = class_row.academic_year_id
    else:
        db.add(build_student_class_assignment(student.student_id, class_row))


def _update_teacher(
    db: Session,
    user_id: uuid.UUID,
    payload: UpdateUserRequest,
    first_name: str,
    middle_name: str,
    last_name: str,
    email: str,
) -> None:
    staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_id).first()
    if not staff:
        raise HTTPException(status_code=404, detail="Teacher profile not found")
    staff.first_name = first_name
    staff.middle_name = middle_name
    staff.last_name = last_name
    staff.email = email
    staff.contact_number = payload.contact_number.strip()
    staff.address = payload.address.strip()
    staff.employment_status = payload.employment_status.strip()


def archive_user(db: Session, user_id: uuid.UUID) -> dict[str, str]:
    account = db.query(UserAccount).filter(UserAccount.user_id == user_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="User not found")
    if (account.account_status or "").lower() == "pending":
        raise HTTPException(status_code=400, detail="Pending accounts cannot be archived until the invitation is accepted")
    if (account.account_status or "").lower() == "archived":
        raise HTTPException(status_code=400, detail="User is already archived")
    account.account_status = "archived"
    db.commit()
    return {"message": "User archived successfully."}

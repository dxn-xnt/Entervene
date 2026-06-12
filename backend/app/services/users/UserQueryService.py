import uuid
from typing import Any, Literal

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, aliased

from app.models.academic.AcademicLevel import AcademicLevel
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
from app.services.users.UserShared import capitalize_name


ClientRole = Literal["admin", "teacher", "student"]


def role_name_to_client_role(role_name: str | None) -> ClientRole:
    role = {"Admin": "admin", "Teacher": "teacher", "Student": "student"}.get(role_name or "")
    return role or "student"


def display_name(first_name: Any, last_name: Any, fallback: str) -> str:
    return " ".join(filter(None, (capitalize_name(first_name), capitalize_name(last_name)))) or fallback


def _base_user_query(db: Session):
    student_academic_level = aliased(AcademicLevel)
    student_grade_level = aliased(AcademicLevel)
    resolved_grade_level = func.coalesce(
        student_academic_level.grade_level,
        student_grade_level.grade_level,
    ).label("grade_level")

    return (
        db.query(
            UserAccount.user_id,
            UserAccount.email,
            UserAccount.created_at,
            UserAccount.account_status,
            Role.role_name,
            AcademicStaff.staff_id,
            AcademicStaff.first_name.label("staff_first_name"),
            AcademicStaff.middle_name.label("staff_middle_name"),
            AcademicStaff.last_name.label("staff_last_name"),
            AcademicStaff.contact_number.label("staff_contact_number"),
            AcademicStaff.address.label("staff_address"),
            AcademicStaff.employment_status,
            Student.student_id,
            Student.first_name.label("student_first_name"),
            Student.middle_name.label("student_middle_name"),
            Student.last_name.label("student_last_name"),
            Student.contact_number.label("student_contact_number"),
            Student.address.label("student_address"),
            resolved_grade_level,
        )
        .join(UserRoles, UserAccount.user_id == UserRoles.user_id)
        .join(Role, UserRoles.role_id == Role.role_id)
        .outerjoin(AcademicStaff, UserAccount.user_id == AcademicStaff.user_id)
        .outerjoin(Student, UserAccount.user_id == Student.user_id)
        .outerjoin(student_academic_level, Student.academic_level_id == student_academic_level.academic_level_id)
        .outerjoin(student_grade_level, Student.academic_level_id == student_grade_level.grade_level)
    )


def _teacher_summaries(db: Session, teacher_ids: set[str]) -> dict[str, dict[str, set]]:
    summaries: dict[str, dict[str, set]] = {}
    if not teacher_ids:
        return summaries

    teacher_loads = (
        db.query(SubjectLoad.staff_id, Subject.subject_name, SubjectLoad.class_id)
        .join(Subject, Subject.subject_id == SubjectLoad.subject_id)
        .filter(SubjectLoad.staff_id.in_(teacher_ids))
        .filter(SubjectLoad.status == "active")
        .all()
    )
    for load in teacher_loads:
        summary = summaries.setdefault(load.staff_id, {"subjects": set(), "class_ids": set()})
        if load.subject_name:
            summary["subjects"].add(load.subject_name)
        if load.class_id is not None:
            summary["class_ids"].add(load.class_id)
    return summaries


def _student_summaries(db: Session, student_ids: set[uuid.UUID]) -> tuple[dict, dict]:
    latest_sections = {}
    averages = {}
    if not student_ids:
        return latest_sections, averages

    enrollment_rows = (
        db.query(StudentClass.student_id, Class.section_name)
        .join(Class, Class.class_id == StudentClass.class_id)
        .filter(StudentClass.student_id.in_(student_ids))
        .filter(StudentClass.enrollment_status == "enrolled")
        .order_by(StudentClass.student_id, StudentClass.enrolled_at.desc())
        .all()
    )
    for enrollment in enrollment_rows:
        latest_sections.setdefault(enrollment.student_id, enrollment.section_name)

    average_rows = (
        db.query(
            StudentSubmission.student_id,
            func.avg(StudentSubmission.grade).label("average"),
        )
        .filter(StudentSubmission.student_id.in_(student_ids))
        .filter(StudentSubmission.status == "graded")
        .filter(StudentSubmission.grade.isnot(None))
        .group_by(StudentSubmission.student_id)
        .all()
    )
    averages = {row.student_id: row.average for row in average_rows}
    return latest_sections, averages


def list_users(
    db: Session,
    role: ClientRole | None = None,
    search: str | None = None,
    status: str | None = None,
) -> list[dict]:
    query = _base_user_query(db)
    if role:
        query = query.filter(Role.role_name == role.title())
    if status:
        query = query.filter(func.lower(UserAccount.account_status) == status.strip().lower())
    else:
        query = query.filter(func.lower(UserAccount.account_status) != "archived")
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
    teacher_ids = {user.staff_id for user in users if user.role_name == "Teacher" and user.staff_id}
    student_ids = {user.student_id for user in users if user.role_name == "Student" and user.student_id}
    teacher_summaries = _teacher_summaries(db, teacher_ids)
    latest_sections, averages = _student_summaries(db, student_ids)

    response = []
    for user in users:
        client_role = role_name_to_client_role(user.role_name)
        first_name = user.student_first_name if client_role == "student" else user.staff_first_name
        last_name = user.student_last_name if client_role == "student" else user.staff_last_name
        item = {
            "id": str(user.user_id),
            "name": display_name(first_name, last_name, user.email),
            "email": user.email,
            "role": client_role,
            "created_at": user.created_at.date().isoformat() if user.created_at else "",
            "account_status": user.account_status,
        }
        if client_role == "teacher" and user.staff_id:
            summary = teacher_summaries.get(user.staff_id, {"subjects": set(), "class_ids": set()})
            item["subjects"] = sorted(summary["subjects"])
            item["class_count"] = len(summary["class_ids"])
        if client_role == "student" and user.student_id:
            average = averages.get(user.student_id)
            item["section"] = latest_sections.get(user.student_id)
            item["grade_level"] = user.grade_level
            item["average"] = round(float(average)) if average is not None else None
        response.append(item)
    return response


def get_user_detail(db: Session, user_id: uuid.UUID) -> dict[str, Any]:
    user = _base_user_query(db).filter(UserAccount.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    client_role = role_name_to_client_role(user.role_name)
    first_name = user.student_first_name if client_role == "student" else user.staff_first_name
    middle_name = user.student_middle_name if client_role == "student" else user.staff_middle_name
    last_name = user.student_last_name if client_role == "student" else user.staff_last_name
    item: dict[str, Any] = {
        "id": str(user.user_id),
        "name": display_name(first_name, last_name, user.email),
        "email": user.email,
        "role": client_role,
        "created_at": user.created_at.date().isoformat() if user.created_at else "",
        "account_status": user.account_status,
        "first_name": capitalize_name(first_name),
        "middle_name": capitalize_name(middle_name),
        "last_name": capitalize_name(last_name),
        "contact_number": (user.staff_contact_number if client_role != "student" else user.student_contact_number) or "",
        "address": (user.staff_address if client_role != "student" else user.student_address) or "",
    }

    if client_role == "teacher" and user.staff_id:
        teacher_loads = (
            db.query(Subject.subject_name, SubjectLoad.class_id)
            .join(SubjectLoad, Subject.subject_id == SubjectLoad.subject_id)
            .filter(SubjectLoad.staff_id == user.staff_id)
            .filter(SubjectLoad.status == "active")
            .all()
        )
        item["staff_id"] = user.staff_id
        item["employment_status"] = user.employment_status or ""
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
        item["student_id"] = str(user.student_id)
        item["section"] = class_row.section_name if class_row else None
        item["grade_level"] = user.grade_level
        item["student_status"] = "No Section Assigned" if not class_row else user.account_status
        item["graduation_year"] = None
        item["last_grade_level"] = user.grade_level
        item["last_section"] = class_row.section_name if class_row else None
        item["average"] = round(float(average)) if average is not None else None
    return item


def get_user_analytics(db: Session, user_id: uuid.UUID) -> dict:
    exists = db.query(UserAccount.user_id).filter(UserAccount.user_id == user_id).first()
    if not exists:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "summary": None,
        "subject_mastery": [],
        "score_trend": [],
        "historical_performance": [],
        "quarterly_performance": [],
        "subject_breakdown": [],
        "activity_feed": [],
        "classwork": [],
        "lms_behavior": None,
    }

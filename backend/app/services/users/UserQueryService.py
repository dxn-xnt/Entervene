import uuid
from typing import Any, Literal
from datetime import datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, aliased

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.users.UserShared import capitalize_name

# READ SIDE OF USER MANAGEMENT
# User data is spread across authentication, role, staff/student profile, class,
# and submission tables. This module combines those records for the admin UI.


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

    # UserAccount owns authentication state, while role-specific names and
    # profile fields live in either AcademicStaff or Student.
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
    # Fetch role-specific summaries in batches to avoid per-user queries on the
    # admin list page.
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

    # Add role-specific fields only after the common account/profile data exists.
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
    user = _base_user_query(db).filter(UserAccount.user_id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if role_name_to_client_role(user.role_name) == "student" and user.student_id:
        return _student_user_analytics(db, user.student_id)
    return {
        "summary": None,
        "subject_mastery": [],
        "score_trend": [],
        "historical_performance": [],
        "period_performance": [],
        "quarterly_performance": [],
        "subject_breakdown": [],
        "activity_feed": [],
        "classwork": [],
        "lms_behavior": None,
    }


def _student_user_analytics(db: Session, student_id: uuid.UUID) -> dict:
    enrollment = _latest_student_enrollment(db, student_id)
    assignment_rows = _student_assignment_rows(db, student_id)
    submissions_by_assignment = _student_submissions_by_assignment(db, student_id)
    metrics = _student_metric_summary(assignment_rows, submissions_by_assignment)
    return {
        "summary": {
            "writtenWorksAverage": metrics["written_work_average"],
            "performanceAverage": metrics["performance_average"],
            "completionRate": metrics["completion_rate"],
            "failureRisk": "Unavailable - prediction module has no saved result",
            "modelConfidence": "Unavailable",
        },
        "subject_mastery": _student_subject_mastery(assignment_rows, submissions_by_assignment),
        "score_trend": _student_score_trend(db, student_id),
        "historical_performance": [],
        "period_performance": [],
        "quarterly_performance": [],
        "subject_breakdown": [],
        "activity_feed": [],
        "classwork": _student_classwork_rows(assignment_rows, submissions_by_assignment),
        "lms_behavior": {
            "totalLogins": "Unavailable",
            "averageSession": "Unavailable",
            "missedActivities": metrics["missing_count"],
            "onTimeSubmissions": (
                f"{metrics['on_time_rate']}%" if metrics["on_time_rate"] is not None else "Unavailable"
            ),
            "note": "Login/session tracking is not available yet.",
            "section": enrollment[1].section_name if enrollment else None,
        },
    }


def _latest_student_enrollment(db: Session, student_id: uuid.UUID):
    return (
        db.query(StudentClass, Class)
        .join(Class, Class.class_id == StudentClass.class_id)
        .filter(StudentClass.student_id == student_id)
        .filter(StudentClass.enrollment_status == "enrolled")
        .order_by(StudentClass.enrolled_at.desc())
        .first()
    )


def _student_assignment_rows(db: Session, student_id: uuid.UUID) -> list[tuple[ClassworkAssignment, Classwork, Subject]]:
    class_ids = [
        row.class_id
        for row in db.query(StudentClass.class_id)
        .filter(StudentClass.student_id == student_id)
        .filter(StudentClass.enrollment_status == "enrolled")
        .all()
    ]
    if not class_ids:
        return []
    return (
        db.query(ClassworkAssignment, Classwork, Subject)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .join(Subject, Subject.subject_id == Classwork.subject_id)
        .filter(ClassworkAssignment.class_id.in_(class_ids))
        .filter(Classwork.is_archived.is_(False))
        .filter(Classwork.classwork_type != "READING")
        .order_by(ClassworkAssignment.due_date.asc().nullslast(), Classwork.created_at.asc())
        .all()
    )


def _student_submissions_by_assignment(
    db: Session,
    student_id: uuid.UUID,
) -> dict[int, StudentSubmission]:
    submissions = (
        db.query(StudentSubmission)
        .filter(StudentSubmission.student_id == student_id)
        .order_by(StudentSubmission.submitted_at.desc().nullslast(), StudentSubmission.submission_id.desc())
        .all()
    )
    grouped: dict[int, StudentSubmission] = {}
    for submission in submissions:
        grouped.setdefault(submission.classwork_assignment_id, submission)
    return grouped


def _student_metric_summary(
    assignment_rows: list[tuple[ClassworkAssignment, Classwork, Subject]],
    submissions_by_assignment: dict[int, StudentSubmission],
) -> dict[str, Any]:
    category_points: dict[str, dict[str, Decimal]] = {}
    completed_count = 0
    missing_count = 0
    on_time_count = 0
    turned_in_count = 0
    now = datetime.now(timezone.utc)

    for assignment, classwork, _ in assignment_rows:
        submission = submissions_by_assignment.get(assignment.classwork_assignment_id)
        status = _submission_status(assignment, submission, now)
        if status in {"submitted", "graded", "late"}:
            completed_count += 1
            turned_in_count += 1
            if status != "late":
                on_time_count += 1
        if status == "missing":
            missing_count += 1
        if submission and submission.status == "graded" and submission.grade is not None and classwork.total_points:
            category = classwork.classwork_category or "UNCATEGORIZED"
            bucket = category_points.setdefault(category, {"earned": Decimal("0"), "possible": Decimal("0")})
            bucket["earned"] += Decimal(str(submission.grade))
            bucket["possible"] += Decimal(str(classwork.total_points))

    return {
        "written_work_average": _bucket_percent(category_points.get("WRITTEN_WORK")),
        "performance_average": _bucket_percent(category_points.get("PERFORMANCE_TASK")),
        "completion_rate": _ratio(completed_count, len(assignment_rows)),
        "missing_count": missing_count,
        "on_time_rate": _ratio(on_time_count, turned_in_count),
    }


def _student_subject_mastery(
    assignment_rows: list[tuple[ClassworkAssignment, Classwork, Subject]],
    submissions_by_assignment: dict[int, StudentSubmission],
) -> list[dict[str, Any]]:
    buckets: dict[int, dict[str, Any]] = {}
    for assignment, classwork, subject in assignment_rows:
        submission = submissions_by_assignment.get(assignment.classwork_assignment_id)
        if not submission or submission.status != "graded" or submission.grade is None or not classwork.total_points:
            continue
        bucket = buckets.setdefault(
            subject.subject_id,
            {"subject": subject.subject_name, "earned": Decimal("0"), "possible": Decimal("0")},
        )
        bucket["earned"] += Decimal(str(submission.grade))
        bucket["possible"] += Decimal(str(classwork.total_points))
    return [
        {"subject": bucket["subject"], "value": _bucket_percent(bucket)}
        for bucket in sorted(buckets.values(), key=lambda item: str(item["subject"]).lower())
        if _bucket_percent(bucket) is not None
    ]


def _student_score_trend(db: Session, student_id: uuid.UUID) -> list[dict[str, Any]]:
    rows = (
        db.query(StudentPeriodGrade, AcademicPeriod)
        .join(AcademicPeriod, AcademicPeriod.academic_period_id == StudentPeriodGrade.academic_period_id)
        .filter(StudentPeriodGrade.student_id == student_id)
        .order_by(AcademicPeriod.start_date.asc(), AcademicPeriod.period_sequence.asc())
        .all()
    )
    trend = []
    for grade, period in rows:
        score = _official_grade_value(grade)
        if score is not None:
            trend.append({"month": period.period_name, "score": score})
    return trend


def _student_classwork_rows(
    assignment_rows: list[tuple[ClassworkAssignment, Classwork, Subject]],
    submissions_by_assignment: dict[int, StudentSubmission],
) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    rows = []
    for assignment, classwork, subject in assignment_rows[:20]:
        submission = submissions_by_assignment.get(assignment.classwork_assignment_id)
        status = _submission_status(assignment, submission, now)
        rows.append({
            "name": classwork.title,
            "type": classwork.classwork_type,
            "subject": subject.subject_name,
            "status": _display_status(status),
            "score": (
                f"{float(submission.grade):g}/{float(classwork.total_points):g}"
                if submission and submission.grade is not None and classwork.total_points is not None
                else "Not graded"
            ),
        })
    return rows


def _submission_status(
    assignment: ClassworkAssignment,
    submission: StudentSubmission | None,
    now: datetime,
) -> str:
    if submission:
        status = (submission.status or "pending").lower()
        if status == "submitted" and _is_late(assignment, submission):
            return "late"
        if status == "missed":
            return "missing"
        return status
    if assignment.due_date and _as_aware(assignment.due_date) < now:
        return "missing"
    return "pending"


def _is_late(assignment: ClassworkAssignment, submission: StudentSubmission) -> bool:
    if not assignment.due_date or not submission.submitted_at:
        return False
    return _as_aware(submission.submitted_at) > _as_aware(assignment.due_date)


def _as_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _official_grade_value(row: StudentPeriodGrade) -> float | None:
    for value in (row.final_period_grade, row.transmuted_grade, row.initial_grade):
        if value is not None:
            return round(float(value), 2)
    return None


def _bucket_percent(bucket: dict[str, Decimal] | None) -> float | None:
    if not bucket or bucket["possible"] <= 0:
        return None
    return round(float((bucket["earned"] / bucket["possible"]) * Decimal("100")), 2)


def _ratio(part: int, whole: int) -> float | None:
    if whole <= 0:
        return None
    return round((part / whole) * 100, 2)


def _display_status(status: str) -> str:
    labels = {
        "graded": "Graded",
        "submitted": "Submitted",
        "late": "Late",
        "missing": "Missing",
        "pending": "Pending",
    }
    return labels.get(status, status.replace("_", " ").title())

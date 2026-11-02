from __future__ import annotations

import uuid
from app.services.grading.PassingThresholdReader import read_passing_threshold_context_or_422
from functools import wraps
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import and_, func, distinct, or_
from sqlalchemy.orm import Session, joinedload

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.Lesson import Lesson
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.attendance.Attendance import AttendanceRecord
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.TeacherDashboard import DashboardGradeDetails, DashboardScopeLabel, DashboardSupportSummary
from app.services.activity.TeacherDashboardMetrics import (
    DashboardScope,
    build_dashboard_engagement,
    build_dashboard_performance_trend,
    dashboard_month_window,
    dashboard_term_progress,
    read_dashboard_current_grades,
    read_dashboard_lesson_evidence,
    read_dashboard_student_names,
    rank_dashboard_performers,
    resolve_dashboard_passing_threshold,
    summarize_dashboard_attendance,
    summarize_dashboard_submissions,
    summarize_dashboard_grades,
    summarize_dashboard_grade_distribution,
    summarize_dashboard_engagement,
    summarize_dashboard_lesson_performance,
    summarize_dashboard_support,
)
from app.services.academic.AcademicLifecycleService import resolve_active_academic_period


def format_count(val: int | float | None) -> str:
    if val is None:
        return "0"
    if isinstance(val, float):
        if val.is_integer():
            return f"{int(val):,}"
        return f"{val:,.1f}"
    return f"{val:,}"


def get_target_period(db: Session, academic_period_id: int | None = None) -> AcademicPeriod:
    """Resolve an explicit period exactly, otherwise require the canonical active period."""
    if academic_period_id is not None:
        period = db.get(AcademicPeriod, academic_period_id)
        if period is None:
            raise HTTPException(status_code=404, detail="Academic period not found")
        return period
    return resolve_active_academic_period(db)


def build_system_overview(db: Session, target_period: AcademicPeriod | None) -> dict[str, Any]:
    period_name = target_period.period_name if target_period else "Current Term"
    academic_year_label = ""
    if target_period and target_period.academic_year:
        academic_year_label = target_period.academic_year.year_label

    period_id = target_period.academic_period_id if target_period else None
    year_id = target_period.academic_year_id if target_period else None
    enrolled_students = db.query(func.count(distinct(StudentClass.student_id))).filter(
        StudentClass.enrollment_status == "enrolled",
        *((StudentClass.academic_year_id == year_id,) if year_id is not None else ()),
    ).scalar() or 0
    total_students = enrolled_students
    load_filters = [SubjectLoad.is_active_version.is_(True), SubjectLoad.status.in_(["active", "published"])]
    if period_id is not None:
        load_filters.append(SubjectLoad.academic_period_id == period_id)
    active_staff_loads = db.query(func.count(distinct(SubjectLoad.staff_id))).join(
        Class, Class.class_id == SubjectLoad.class_id,
    ).filter(
        *load_filters,
        *((Class.academic_year_id == year_id,) if year_id is not None else ()),
    ).scalar() or 0
    total_staff = active_staff_loads
    total_classes = db.query(Class).filter(*((Class.academic_year_id == year_id,) if year_id is not None else ())).count()
    active_classes = db.query(Class).filter(
        Class.class_status == "active", *((Class.academic_year_id == year_id,) if year_id is not None else ()),
    ).count()
    active_subjects = db.query(func.count(distinct(SubjectLoad.subject_id))).join(
        Class, Class.class_id == SubjectLoad.class_id,
    ).filter(
        *load_filters,
        *((Class.academic_year_id == year_id,) if year_id is not None else ()),
    ).scalar() or 0
    total_subjects = active_subjects

    # Ungraded submissions count
    ungraded_count = (
        db.query(StudentSubmission)
        .join(ClassworkAssignment, StudentSubmission.classwork_assignment_id == ClassworkAssignment.classwork_assignment_id)
        .join(Class, Class.class_id == ClassworkAssignment.class_id)
        .filter(
            StudentSubmission.status == "submitted",
            StudentSubmission.grade.is_(None),
            *((ClassworkAssignment.academic_period_id == period_id,) if period_id is not None else ()),
            *((Class.academic_year_id == year_id,) if year_id is not None else ()),
        )
        .count()
    )

    # Assessments published
    assessment_query = db.query(Classwork).join(
        ClassworkAssignment, ClassworkAssignment.classwork_id == Classwork.classwork_id,
    ).join(Class, Class.class_id == ClassworkAssignment.class_id).filter(
        Classwork.is_archived.is_(False), ClassworkAssignment.is_published.is_(True),
        *((ClassworkAssignment.academic_period_id == period_id,) if period_id is not None else ()),
        *((Class.academic_year_id == year_id,) if year_id is not None else ()),
    )
    cw_count = assessment_query.filter(func.upper(Classwork.classwork_type) != "QUIZ").distinct().count()
    quiz_count = assessment_query.filter(func.upper(Classwork.classwork_type) == "QUIZ").distinct().count()
    total_assessments = cw_count + quiz_count

    ratio_str = f"{total_students / total_staff:.1f} : 1" if total_staff else "—"

    cards = [
        {
            "title": "Students",
            "count": format_count(total_students),
            "stat": str(enrolled_students),
            "statDescription": f"enrolled in {period_name}",
            "rawCount": total_students,
        },
        {
            "title": "Teachers",
            "count": format_count(total_staff),
            "stat": str(active_staff_loads),
            "statDescription": f"teaching in {period_name}",
            "rawCount": total_staff,
        },
        {
            "title": "Classes",
            "count": format_count(total_classes),
            "stat": str(active_classes),
            "statDescription": f"active in {period_name}",
            "rawCount": total_classes,
        },
        {
            "title": "Subjects",
            "count": format_count(total_subjects),
            "stat": str(active_subjects),
            "statDescription": f"active in {period_name}",
            "rawCount": total_subjects,
        },
        {
            "title": "School Passing Rate",
            "count": "—", "stat": "Not calculated", "statDescription": period_name,
        },
        {
            "title": "School Attendance",
            "count": "—", "stat": "Not calculated", "statDescription": period_name,
        },
        {
            "title": "Student-Teacher Ratio",
            "count": ratio_str,
            "stat": f"{total_students} students",
            "statDescription": f"per {total_staff} active teachers",
        },
        {
            "title": "New Enrollments",
            "count": "—", "stat": "Not calculated", "statDescription": period_name,
        },
        {
            "title": "Ungraded Backlog",
            "count": str(ungraded_count),
            "stat": f"{ungraded_count} submissions",
            "statDescription": "waiting more than 3 days",
        },
        {
            "title": "Assessments Published",
            "count": str(total_assessments),
            "stat": f"{cw_count} classworks · {quiz_count} quizzes",
            "statDescription": "this term",
        },
        {
            "title": "Submission Completion",
            "count": "—", "stat": "Not calculated", "statDescription": period_name,
        },
        {
            "title": "Term Progress",
            "count": "—", "stat": "Calendar period", "statDescription": period_name, "progressValue": 0,
        },
    ]

    return {
        "term_info": {
            "period_id": target_period.academic_period_id if target_period else None,
            "period_name": period_name,
            "academic_year": academic_year_label,
            "is_active": target_period.is_active if target_period else False,
        },
        "cards": cards,
        "details": {
            "students": {"total": total_students, "enrolled": enrolled_students},
            "teachers": {"total": total_staff, "active_loads": active_staff_loads},
            "classes": {"total": total_classes, "active": active_classes},
            "subjects": {"total": total_subjects, "active": active_subjects},
            "enrollment_trend": [],
            "students_per_grade": [],
            "attendance_by_grade": [],
            "completion_by_grade": [],
            "active_users_weekly": [],
            "teacher_workload": [],
            "classes_needing_attention": [],
            "teachers_no_work": [],
            "top_performing_subjects": [],
        },
    }


def build_teacher_overview(
    db: Session,
    staff_id_or_user_id: str | uuid.UUID | None,
    target_period: AcademicPeriod | None,
) -> dict[str, Any]:
    period_name = target_period.period_name if target_period else "Current Term"
    academic_year_label = ""
    if target_period and target_period.academic_year:
        academic_year_label = target_period.academic_year.year_label

    staff = None
    if staff_id_or_user_id:
        # Check if staff_id_or_user_id is a UUID or UUID string
        if isinstance(staff_id_or_user_id, uuid.UUID) or (
            isinstance(staff_id_or_user_id, str) and len(staff_id_or_user_id) == 36 and "-" in staff_id_or_user_id
        ):
            try:
                uid = uuid.UUID(str(staff_id_or_user_id))
                staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == uid).first()
            except ValueError:
                staff = None
        if not staff and isinstance(staff_id_or_user_id, str):
            staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == staff_id_or_user_id).first()

    if not staff:
        raise HTTPException(status_code=404, detail="Teacher staff profile not found")

    staff_id = staff.staff_id

    # Loads assigned to teacher
    load_query = db.query(SubjectLoad).join(Class, Class.class_id == SubjectLoad.class_id).filter(
        SubjectLoad.staff_id == staff_id,
        SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(["active", "published"]),
        *((Class.academic_year_id == target_period.academic_year_id,) if target_period else ()),
    )
    loads_for_period = load_query.filter(
        SubjectLoad.academic_period_id == target_period.academic_period_id,
    ).all() if target_period else []

    subject_ids = {l.subject_id for l in loads_for_period if l.subject_id}
    class_ids = {l.class_id for l in loads_for_period if l.class_id}
    authorized_combos = {(l.class_id, l.subject_id) for l in loads_for_period if l.class_id and l.subject_id}

    # Advised classes
    advised_classes = db.query(Class).filter(
        Class.adviser_staff_id == staff_id,
        Class.class_status == "active",
        *((Class.academic_year_id == target_period.academic_year_id,) if target_period else ()),
    ).all()
    for ac in advised_classes:
        class_ids.add(ac.class_id)

    # Total distinct students in teacher's classes
    total_students = (
        db.query(func.count(distinct(StudentClass.student_id))).filter(
            StudentClass.class_id.in_(class_ids),
            StudentClass.enrollment_status == "enrolled",
            *((StudentClass.academic_year_id == target_period.academic_year_id,) if target_period else ()),
        ).scalar()
        if class_ids
        else 0
    )

    # Ungraded classworks
    ungraded_count = (
        db.query(StudentSubmission)
        .join(ClassworkAssignment, StudentSubmission.classwork_assignment_id == ClassworkAssignment.classwork_assignment_id)
        .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
        .filter(
            (Classwork.created_by_staff_id == staff_id) | (ClassworkAssignment.assigned_by_staff_id == staff_id),
            *((ClassworkAssignment.academic_period_id == target_period.academic_period_id,) if target_period else ()),
            ClassworkAssignment.class_id.in_(class_ids) if class_ids else False,
            or_(*(
                and_(ClassworkAssignment.class_id == class_id, Classwork.subject_id == subject_id)
                for class_id, subject_id in sorted(authorized_combos)
            )) if authorized_combos else False,
            StudentSubmission.status == "submitted",
            StudentSubmission.grade.is_(None),
        )
        .count()
    )

    cards = [
        {
            "title": "Subjects",
            "count": format_count(len(subject_ids)),
            "stat": str(len(loads_for_period)),
            "statDescription": f"assigned loads in {period_name}",
            "rawCount": len(subject_ids),
        },
        {
            "title": "Classes",
            "count": format_count(len(class_ids)),
            "stat": str(len(class_ids)),
            "statDescription": f"active sections in {period_name}",
            "rawCount": len(class_ids),
        },
        {
            "title": "Students",
            "count": format_count(total_students),
            "stat": str(total_students),
            "statDescription": f"enrolled in {period_name}",
            "rawCount": total_students,
        },
        {
            "title": "Ungraded Classwork",
            "count": format_count(ungraded_count),
            "stat": str(ungraded_count),
            "statDescription": f"pending review in {period_name}",
            "rawCount": ungraded_count,
        },
    ]

    return {
        "term_info": {
            "period_id": target_period.academic_period_id if target_period else None,
            "period_name": period_name,
            "academic_year": academic_year_label,
            "is_active": target_period.is_active if target_period else False,
        },
        "cards": cards,
        "details": {
            "staff_id": staff_id,
            "staff_name": f"{staff.first_name} {staff.last_name}" if staff else None,
            "subjects_count": len(subject_ids),
            "classes_count": len(class_ids),
            "students_count": total_students,
            "ungraded_count": ungraded_count,
        },
    }


def build_class_overview(
    db: Session,
    class_id: int,
    target_period: AcademicPeriod | None,
) -> dict[str, Any]:
    period_name = target_period.period_name if target_period else "Current Term"
    academic_year_label = ""
    if target_period and target_period.academic_year:
        academic_year_label = target_period.academic_year.year_label

    cls = db.query(Class).filter(Class.class_id == class_id).first()
    if cls is None:
        raise HTTPException(status_code=404, detail="Class not found")
    if target_period and cls.academic_year_id != target_period.academic_year_id:
        raise HTTPException(status_code=400, detail="Class does not belong to the selected academic year")
    section_name = cls.section_name

    total_students = db.query(StudentClass).filter(
        StudentClass.class_id == class_id,
        StudentClass.enrollment_status == "enrolled",
        *((StudentClass.academic_year_id == target_period.academic_year_id,) if target_period else ()),
    ).count()

    total_subjects = (
        db.query(func.count(distinct(SubjectLoad.subject_id)))
        .filter(
            SubjectLoad.class_id == class_id,
            *((SubjectLoad.academic_period_id == target_period.academic_period_id,) if target_period else ()),
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["active", "published"]),
        )
        .scalar()
        or 0
    )

    grade_q = db.query(func.avg(StudentPeriodGrade.final_period_grade)).filter(StudentPeriodGrade.class_id == class_id)
    if target_period:
        grade_q = grade_q.filter(StudentPeriodGrade.academic_period_id == target_period.academic_period_id)
    avg_grade_val = grade_q.scalar()
    avg_grade_str = f"{round(float(avg_grade_val), 1)}%" if avg_grade_val is not None else "N/A"

    cards = [
        {
            "title": "Total Students",
            "count": format_count(total_students),
            "stat": str(total_students),
            "statDescription": f"enrolled in {section_name} ({period_name})",
            "rawCount": total_students,
        },
        {
            "title": "Total Subjects",
            "count": format_count(total_subjects),
            "stat": str(total_subjects),
            "statDescription": f"active subjects in {period_name}",
            "rawCount": total_subjects,
        },
        {
            "title": "Avg. Class Score",
            "count": avg_grade_str,
            "stat": avg_grade_str if avg_grade_val is not None else "--",
            "statDescription": f"grade average in {period_name}",
            "rawCount": float(avg_grade_val) if avg_grade_val is not None else None,
        },
    ]

    return {
        "term_info": {
            "period_id": target_period.academic_period_id if target_period else None,
            "period_name": period_name,
            "academic_year": academic_year_label,
            "is_active": target_period.is_active if target_period else False,
        },
        "cards": cards,
        "details": {
            "class_id": class_id,
            "section_name": section_name,
            "total_students": total_students,
            "total_subjects": total_subjects,
            "avg_grade": avg_grade_val,
        },
    }


def build_subject_overview(
    db: Session,
    subject_id: int,
    target_period: AcademicPeriod | None,
) -> dict[str, Any]:
    period_name = target_period.period_name if target_period else "Current Term"
    academic_year_label = ""
    if target_period and target_period.academic_year:
        academic_year_label = target_period.academic_year.year_label

    subj = db.query(Subject).filter(Subject.subject_id == subject_id).first()
    if subj is None:
        raise HTTPException(status_code=404, detail="Subject not found")
    subject_name = subj.subject_name

    subj_classes = (
        db.query(func.count(distinct(SubjectLoad.class_id))).join(Class, Class.class_id == SubjectLoad.class_id)
        .filter(
            SubjectLoad.subject_id == subject_id,
            *((SubjectLoad.academic_period_id == target_period.academic_period_id,) if target_period else ()),
            *((Class.academic_year_id == target_period.academic_year_id,) if target_period else ()),
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["active", "published"]),
        )
        .scalar()
        or 0
    )

    subj_teachers = (
        db.query(func.count(distinct(SubjectLoad.staff_id))).join(Class, Class.class_id == SubjectLoad.class_id)
        .filter(
            SubjectLoad.subject_id == subject_id,
            *((SubjectLoad.academic_period_id == target_period.academic_period_id,) if target_period else ()),
            *((Class.academic_year_id == target_period.academic_year_id,) if target_period else ()),
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["active", "published"]),
        )
        .scalar()
        or 0
    )

    classworks_query = db.query(Classwork.classwork_id).join(
        ClassworkAssignment, ClassworkAssignment.classwork_id == Classwork.classwork_id,
    ).join(Class, Class.class_id == ClassworkAssignment.class_id).filter(
        Classwork.subject_id == subject_id,
        Classwork.is_archived.is_(False),
        *((ClassworkAssignment.academic_period_id == target_period.academic_period_id,) if target_period else ()),
        *((Class.academic_year_id == target_period.academic_year_id,) if target_period else ()),
    )
    classworks_count = classworks_query.distinct().count()
    scoped_classwork_ids = classworks_query.subquery()
    lessons_count = db.query(func.count(distinct(ClassworkLesson.lesson_id))).filter(
        ClassworkLesson.classwork_id.in_(db.query(scoped_classwork_ids.c.classwork_id)),
    ).scalar() or 0

    cards = [
        {
            "title": "Total Classes",
            "count": format_count(subj_classes),
            "stat": str(subj_classes),
            "statDescription": f"assigned sections in {period_name}",
            "rawCount": subj_classes,
        },
        {
            "title": "Teachers",
            "count": format_count(subj_teachers),
            "stat": str(subj_teachers),
            "statDescription": f"assigned faculty in {period_name}",
            "rawCount": subj_teachers,
        },
        {
            "title": "Lessons",
            "count": format_count(lessons_count),
            "stat": str(lessons_count),
            "statDescription": f"learning modules in {period_name}",
            "rawCount": lessons_count,
        },
        {
            "title": "Classworks",
            "count": format_count(classworks_count),
            "stat": str(classworks_count),
            "statDescription": f"activities & quizzes in {period_name}",
            "rawCount": classworks_count,
        },
    ]

    return {
        "term_info": {
            "period_id": target_period.academic_period_id if target_period else None,
            "period_name": period_name,
            "academic_year": academic_year_label,
            "is_active": target_period.is_active if target_period else False,
        },
        "cards": cards,
        "details": {
            "subject_id": subject_id,
            "subject_name": subject_name,
            "classes_count": subj_classes,
            "teachers_count": subj_teachers,
            "lessons_count": lessons_count,
            "classworks_count": classworks_count,
        },
    }


def _teacher_dashboard_now() -> datetime:
    return datetime.now(timezone.utc)


def _dashboard_aware_datetime(value: datetime) -> datetime:
    # Legacy naive timestamps follow the same UTC convention as student metrics.
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def _read_only_dashboard(function):
    @wraps(function)
    def read(db, *args, **kwargs):
        with db.no_autoflush:
            return function(db, *args, **kwargs)
    return read


@_read_only_dashboard
def build_teacher_dashboard_health(
    db: Session,
    staff_id_or_user_id: str | uuid.UUID | None,
    target_period: AcademicPeriod | None,
    class_id: int | None = None,
    subject_id: int | None = None,
    dashboard_class_id: int | None = None,
    dashboard_subject_id: int | None = None,
) -> dict[str, Any]:
    period_name = target_period.period_name if target_period else "Current Term"
    academic_year_label = ""
    if target_period and target_period.academic_year:
        academic_year_label = target_period.academic_year.year_label

    staff = None
    if staff_id_or_user_id:
        if isinstance(staff_id_or_user_id, uuid.UUID) or (
            isinstance(staff_id_or_user_id, str) and len(staff_id_or_user_id) == 36 and "-" in staff_id_or_user_id
        ):
            try:
                uid = uuid.UUID(str(staff_id_or_user_id))
                staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == uid).first()
            except ValueError:
                staff = None
        if not staff and isinstance(staff_id_or_user_id, str):
            staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == staff_id_or_user_id).first()

    if not staff:
        raise HTTPException(status_code=403, detail="Teacher identity could not be resolved")

    staff_id = staff.staff_id

    # One clock snapshot keeps all Manila date/window boundaries consistent.
    now = _dashboard_aware_datetime(_teacher_dashboard_now())
    school_now = now.astimezone(ZoneInfo("Asia/Manila"))

    # An explicitly selected period never includes legacy or other-period loads.
    load_query = db.query(SubjectLoad).join(Class, SubjectLoad.class_id == Class.class_id).filter(
        SubjectLoad.staff_id == staff_id,
        SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(["active", "published"]),
        Class.class_status == "active",
    )
    if target_period:
        loads = load_query.filter(
            SubjectLoad.academic_period_id == target_period.academic_period_id,
            Class.academic_year_id == target_period.academic_year_id,
        ).order_by(SubjectLoad.class_id, SubjectLoad.subject_id).all()
    else:
        loads = []

    # Fixed-size metadata reads, not one relationship query per load.
    class_ids = {load.class_id for load in loads if load.class_id}
    scoped_subject_ids = {load.subject_id for load in loads if load.subject_id}
    classes_by_id = {
        item.class_id: item for item in db.query(Class).options(joinedload(Class.academic_level)).filter(
            Class.class_id.in_(class_ids),
        ).all()
    } if class_ids else {}
    threshold_subjects = db.query(Subject).options(joinedload(Subject.grading_template)).filter(
        Subject.subject_id.in_(scoped_subject_ids),
    ).all() if scoped_subject_ids else []
    subjects_by_id = {item.subject_id: item for item in threshold_subjects}
    available_filters: list[dict[str, Any]] = []
    seen_combos = set()
    for l in loads:
        if l.class_id and l.subject_id and (l.class_id, l.subject_id) not in seen_combos:
            seen_combos.add((l.class_id, l.subject_id))
            c = classes_by_id.get(l.class_id)
            s = subjects_by_id.get(l.subject_id)
            available_filters.append({
                "class_id": l.class_id,
                "section_name": c.section_name if c else f"Class {l.class_id}",
                "subject_id": l.subject_id,
                "subject_name": s.subject_name if s else f"Subject {l.subject_id}",
            })

    # Keep authorized options available when narrowing the analytics scope.
    # The legacy class_id/subject_id parameters remain trend-only selectors.
    dashboard_filters = list(available_filters)
    available_filters = [
        item for item in available_filters
        if (dashboard_class_id is None or item["class_id"] == dashboard_class_id)
        and (dashboard_subject_id is None or item["subject_id"] == dashboard_subject_id)
    ]
    seen_combos = {(item["class_id"], item["subject_id"]) for item in available_filters}
    scoped_subject_ids = {item["subject_id"] for item in available_filters}
    threshold_subjects = [item for item in threshold_subjects if item.subject_id in scoped_subject_ids]
    unique_class_ids = {f["class_id"] for f in available_filters}

    # Cache only canonical active enrollments for every denominator and numerator.
    enrolled_by_class = {cid: set() for cid in unique_class_ids}
    if unique_class_ids:
        enrollments = db.query(StudentClass).filter(
            StudentClass.class_id.in_(unique_class_ids),
            StudentClass.academic_year_id == target_period.academic_year_id,
            StudentClass.enrollment_status == "enrolled",
        ).all()
        for enrollment in enrollments:
            enrolled_by_class[enrollment.class_id].add(enrollment.student_id)
    total_students = len(set().union(*enrolled_by_class.values())) if enrolled_by_class else 0

    # Use the same teacher, load tuple and exact period scope for all dashboard data.
    all_assignments = []
    if seen_combos and target_period:
        all_assignments = (
            db.query(ClassworkAssignment)
            .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
            .options(joinedload(ClassworkAssignment.classwork))
            .filter(
                (Classwork.created_by_staff_id == staff_id) | (ClassworkAssignment.assigned_by_staff_id == staff_id),
                ClassworkAssignment.is_published.is_(True),
                Classwork.is_archived.is_(False),
                ClassworkAssignment.academic_period_id == target_period.academic_period_id,
                or_(*(
                    and_(ClassworkAssignment.class_id == cid, Classwork.subject_id == sid)
                    for cid, sid in sorted(seen_combos)
                )),
            )
            .all()
        )

    assignments_by_combo = {combo: [] for combo in seen_combos}
    assignments_by_id = {}
    for assignment in all_assignments:
        assignments_by_combo[(assignment.class_id, assignment.classwork.subject_id)].append(assignment)
        assignments_by_id[assignment.classwork_assignment_id] = assignment
    submissions = []
    if assignments_by_id:
        submissions = db.query(StudentSubmission).filter(
            StudentSubmission.classwork_assignment_id.in_(assignments_by_id),
        ).all()
    engagement = build_dashboard_engagement(assignments_by_id, enrolled_by_class, submissions, now)
    engagement_summary = summarize_dashboard_engagement(engagement)
    lesson_subjects = {
        sid: (subjects_by_id[sid].subject_name if sid in subjects_by_id else "Subject name unavailable",
              tuple(sorted({item["class_id"] for item in available_filters if item["subject_id"] == sid})))
        for sid in scoped_subject_ids
    }
    lesson_performance = summarize_dashboard_lesson_performance(
        read_dashboard_lesson_evidence(db, engagement, subjects=lesson_subjects),
    )
    # One explicit-year policy context for every authorized subject; never active-year inference.
    policy_context = read_passing_threshold_context_or_422(
        db, academic_year_id=target_period.academic_year_id,
        subject_ids=scoped_subject_ids,
    ) if target_period and scoped_subject_ids else None
    thresholds = {
        subject.subject_id: resolve_dashboard_passing_threshold(subject, context=policy_context)
        for subject in threshold_subjects
    }
    current_grades = read_dashboard_current_grades(db, staff_id, [
        DashboardScope(
            f["class_id"], f["subject_id"], target_period.academic_period_id,
            frozenset(str(student_id) for student_id in enrolled_by_class[f["class_id"]]),
        )
        for f in available_filters
    ])
    grade_summary = summarize_dashboard_grades(current_grades, thresholds)
    student_names = read_dashboard_student_names(db, {
        grade.student_id for grade in current_grades
    })
    scope_labels = {
        (item["class_id"], item["subject_id"]): DashboardScopeLabel(
            section_name=item["section_name"], subject_name=item["subject_name"],
        )
        for item in available_filters
    }
    performers = rank_dashboard_performers(current_grades, student_names, scope_labels)
    distribution = summarize_dashboard_grade_distribution(current_grades)
    grade_details = DashboardGradeDetails(
        total_grade_count=distribution.total_grade_count,
        available_grade_count=distribution.available_grade_count,
        unavailable_grade_count=distribution.unavailable_grade_count,
        top_performer_limit=performers.limit,
        cutoff_tie_omitted_count=performers.cutoff_tie_omitted_count,
        warnings=[*grade_summary.warnings, *performers.warnings],
    )
    attendance_by_class = {cid: [] for cid in unique_class_ids}
    if unique_class_ids:
        for record in db.query(AttendanceRecord).filter(
            AttendanceRecord.class_id.in_(unique_class_ids),
            AttendanceRecord.date >= target_period.start_date,
            AttendanceRecord.date <= target_period.end_date,
        ).all():
            if record.student_id in enrolled_by_class[record.class_id]:
                attendance_by_class[record.class_id].append(record)
    month_window = dashboard_month_window(
        now, target_period.start_date, target_period.end_date,
    ) if target_period else None
    month_attendance = [
        {
            "class_id": cid,
            "section": next(f["section_name"] for f in available_filters if f["class_id"] == cid),
            **summarize_dashboard_attendance([
                record for record in attendance_by_class[cid]
                if month_window and month_window.start_date <= record.date <= month_window.end_date
            ]).model_dump(mode="json"),
        }
        for cid in sorted(unique_class_ids)
    ]
    attendance_today = summarize_dashboard_attendance([
        record for records in attendance_by_class.values() for record in records
        if record.date == school_now.date()
    ])
    # Excuses match the DEADLINE date, not the submission date or monthly window.
    # Fetch all relevant deadline dates even when they precede this month.
    deadline_dates = {
        _dashboard_aware_datetime(a.due_date).astimezone(ZoneInfo("Asia/Manila")).date()
        for a in all_assignments if a.due_date is not None
    }
    excuses = []
    if unique_class_ids and deadline_dates:
        excuses = [
            record for record in db.query(AttendanceRecord).filter(
                AttendanceRecord.class_id.in_(unique_class_ids),
                AttendanceRecord.date.in_(deadline_dates),
                AttendanceRecord.status == "excused",
            ).all()
            if record.student_id in enrolled_by_class[record.class_id]
        ]
    late_summary, weekdays = summarize_dashboard_submissions(
        assignments_by_id,
        engagement.eligible_submissions,
        excuses, now,
        target_period.start_date if target_period else school_now.date(),
        target_period.end_date if target_period else school_now.date(),
        require_subject_match=False,
    )
    support = summarize_dashboard_support(
        current_grades, thresholds, engagement,
        [record for records in attendance_by_class.values() for record in records],
        excuses, now, month_window, target_period.start_date, target_period.end_date,
        student_names, scope_labels, require_subject_match=False,
    ) if target_period is not None and month_window is not None else DashboardSupportSummary()
    term_progress = dashboard_term_progress(
        target_period.start_date, target_period.end_date, school_now.date(),
    ) if target_period else None

    total_expected = engagement_summary.expected_count
    total_submitted = engagement_summary.completed_count
    overall_completion_rate = engagement_summary.completion_rate_percent

    # Ungraded count
    pending_subs = [
        s for subs in engagement.selected_by_assignment.values() for s in subs
        if s.status in {"submitted", "late"} and s.grade is None
    ]
    ungraded_count = engagement_summary.pending_grading_count

    # Determine selected class & subject for the trend chart
    sel_class_id = None
    sel_subj_id = None
    sel_section_name = ""
    sel_subject_name = ""

    if (class_id is None) != (subject_id is None):
        raise HTTPException(status_code=400, detail="class_id and subject_id must be provided together")
    if class_id is not None and subject_id is not None:
        matching = next((f for f in available_filters if f["class_id"] == class_id and f["subject_id"] == subject_id), None)
        if matching is None:
            raise HTTPException(status_code=403, detail="You are not authorized for the selected class and subject")
        sel_class_id = class_id
        sel_subj_id = subject_id
        sel_section_name = matching["section_name"]
        sel_subject_name = matching["subject_name"]

    if sel_class_id is None and available_filters:
        first_f = available_filters[0]
        sel_class_id = first_f["class_id"]
        sel_subj_id = first_f["subject_id"]
        sel_section_name = first_f["section_name"]
        sel_subject_name = first_f["subject_name"]

    trend_points: list[dict[str, Any]] = []
    selected_assignment_ids = []
    if sel_class_id is not None and sel_subj_id is not None:
        class_asgns = assignments_by_combo[(sel_class_id, sel_subj_id)]
        selected_assignment_ids = [a.classwork_assignment_id for a in class_asgns]
        trend_points = [point.model_dump(mode="json") for point in
                        build_dashboard_performance_trend(engagement, class_asgns)]
    trend_summary = summarize_dashboard_engagement(engagement, selected_assignment_ids)
    # Sufficiency means three scored tasks, not three date groups. One/two actual
    # date groups remain renderable; metadata distinguishes tasks from groups.
    has_sufficient_data = trend_summary.graded_task_count >= 3

    # Section-by-Section Health Matrix
    section_matrix: list[dict[str, Any]] = []
    for f in available_filters:
        cid = f["class_id"]
        sid = f["subject_id"]
        cls_obj = classes_by_id.get(cid)
        student_count = len(enrolled_by_class[cid])

        grade_level_label = ""
        if cls_obj and cls_obj.academic_level:
            grade_level_label = cls_obj.academic_level.level_name

        asgns_for_sec = assignments_by_combo[(cid, sid)]

        section_engagement = summarize_dashboard_engagement(
            engagement, [a.classwork_assignment_id for a in asgns_for_sec],
        )
        sec_completion_rate = section_engagement.completion_rate_percent
        sec_avg_score = section_engagement.avg_score_percent
        section_grades = summarize_dashboard_grades(
            [grade for grade in current_grades if grade.class_id == cid and grade.subject_id == sid],
            {sid: thresholds[sid]},
        )
        sec_passing_rate = section_grades.passing_rate_percent

        # Attendance calculation
        section_attendance = summarize_dashboard_attendance(attendance_by_class[cid])
        sec_attendance_rate = section_attendance.rate

        section_matrix.append({
            "class_id": cid,
            "section_name": f["section_name"],
            "grade_level": grade_level_label,
            "subject_id": sid,
            "subject_name": f["subject_name"],
            "student_count": student_count,
            "published_classworks": len(asgns_for_sec),
            "avg_score_percent": sec_avg_score,
            "passing_rate_percent": sec_passing_rate,
            "completion_rate_percent": sec_completion_rate,
            "attendance_rate_percent": sec_attendance_rate,
            "attendance_record_count": section_attendance.record_count,
            "engagement": section_engagement.model_dump(mode="json"),
            **section_grades.model_dump(mode="json"),
        })

    # Live Action Queue: pending_grading
    pending_subs = sorted(
        pending_subs,
        key=lambda s: (
            _dashboard_aware_datetime(s.submitted_at) if s.submitted_at else datetime.min.replace(tzinfo=timezone.utc),
            s.submission_id,
        ),
        reverse=True,
    )[:5]

    # One name-only SELECT, preserving the existing first/last queue format.
    pending_student_ids = {row.student_id for row in pending_subs}
    pending_names = {
        str(row.student_id): f"{row.first_name} {row.last_name}"
        for row in db.query(Student.student_id, Student.first_name, Student.last_name).filter(
            Student.student_id.in_(pending_student_ids),
        ).all()
    } if pending_student_ids else {}
    pending_grading_list = []
    for ps in pending_subs:
        assignment = assignments_by_id[ps.classwork_assignment_id]
        cw_obj = assignment.classwork
        cls_obj = classes_by_id.get(assignment.class_id)
        pending_grading_list.append({
            "submission_id": ps.submission_id,
            "student_id": str(ps.student_id),
            "student_name": pending_names.get(str(ps.student_id), "Name unavailable"),
            "classwork_id": cw_obj.classwork_id if cw_obj else None,
            "classwork_title": cw_obj.title if cw_obj else "Classwork",
            "section_name": cls_obj.section_name if cls_obj else "",
            "submitted_at": ps.submitted_at.isoformat() if ps.submitted_at else None,
        })

    # Live Action Queue: upcoming_deadlines
    next_monday = (school_now + timedelta(days=7 - school_now.weekday())).replace(
        hour=0, minute=0, second=0, microsecond=0,
    )
    upcoming_asgns = sorted(
        [a for a in all_assignments if a.due_date and now <= _dashboard_aware_datetime(a.due_date) < next_monday],
        key=lambda a: (_dashboard_aware_datetime(a.due_date), a.classwork_assignment_id),
    )[:5]

    upcoming_deadlines_list = []
    for ua in upcoming_asgns:
        cw_obj = ua.classwork
        cls_obj = classes_by_id.get(ua.class_id)
        deadline_engagement = summarize_dashboard_engagement(engagement, [ua.classwork_assignment_id])
        upcoming_deadlines_list.append({
            "classwork_id": cw_obj.classwork_id if cw_obj else None,
            "title": cw_obj.title if cw_obj else "Assignment",
            "section_name": cls_obj.section_name if cls_obj else "",
            "due_date": ua.due_date.isoformat() if ua.due_date else None,
            "assignment_id": ua.classwork_assignment_id,
            "submitted_count": deadline_engagement.completed_count,
            "total_students": deadline_engagement.expected_count,
            "eligible_count": deadline_engagement.expected_count,
            "warnings": [warning.model_dump(mode="json") for warning in deadline_engagement.warnings],
        })

    cw_count = len([a for a in all_assignments if a.classwork and (a.classwork.classwork_type or "").upper() != "QUIZ"])
    quiz_count = len([a for a in all_assignments if a.classwork and (a.classwork.classwork_type or "").upper() == "QUIZ"])
    total_published = len(all_assignments)

    cards = [
        {
            "title": "Active Classes",
            "count": str(len(unique_class_ids)),
            "stat": f"{len(unique_class_ids)} sections",
            "statDescription": f"in {period_name}",
        },
        {
            "title": "Enrolled Students",
            "count": str(total_students),
            "stat": f"{total_students} learners",
            "statDescription": "total across sections",
        },
        {
            "title": "Overall Completion",
            "count": f"{int(overall_completion_rate)}%" if overall_completion_rate is not None else "—",
            "stat": (f"{total_submitted} of {total_expected} submitted" if total_submitted is not None else
                     f"{engagement_summary.resolved_completed_count} resolved of {total_expected} expected"),
            "statDescription": "Selected-period eligible student-task requirements; unique latest completed attempts.",
        },
        {
            "title": "Ungraded Queue",
            "count": str(ungraded_count) if ungraded_count is not None else "—",
            "stat": (f"{ungraded_count} submissions" if ungraded_count is not None else
                     f"{engagement_summary.resolved_pending_grading_count} resolved submissions"),
            "statDescription": "Latest completed attempts pending teacher grading.",
        },
        {
            "title": "Current grade",
            "count": str(grade_summary.current_grade) if grade_summary.current_grade is not None else "—",
            "stat": f"{grade_summary.available_grade_count} of {grade_summary.total_grade_count} student-subject grades available",
            "statDescription": "Weighted and transmuted, as in the class record.",
        },
        {
            "title": "Passing Rate",
            "count": f"{grade_summary.passing_rate_percent}%" if grade_summary.passing_rate_percent is not None else "—",
            "stat": (
                f"{grade_summary.passing_count} of {grade_summary.available_grade_count} available grades"
                if grade_summary.passing_count is not None else
                f"{grade_summary.available_grade_count} of {grade_summary.total_grade_count} student-subject grades available"
            ),
            "statDescription": (
                grade_summary.warnings[0].message if grade_summary.warnings else
                "Against each subject's grading template passing grade."
            ),
        },
        {
            "title": "Late Submissions",
            "count": f"{late_summary.late_rate_percent}%" if late_summary.late_rate_percent is not None else "—",
            "stat": f"{late_summary.late_count} of {late_summary.eligible_count} assessed submissions · {late_summary.excused_excluded_count} excused excluded",
            "statDescription": (
                late_summary.warnings[0].message if late_summary.warnings else
                "Late submissions, excluding excused submissions."
            ),
        },
        {
            "title": "Grading Turnaround",
            "count": "—",
            "statDescription": "Not calculated",
        },
        {
            "title": "Attendance Today",
            "count": (
                f"{attendance_today.present_count + attendance_today.late_count} / {attendance_today.record_count}"
                if attendance_today.record_count else "—"
            ),
            "stat": f"{attendance_today.late_count} late · {attendance_today.absent_count} absent · {attendance_today.excused_count} excused",
            "statDescription": "Present + late / recorded entries today.",
        },
        {
            "title": "Feedback Coverage",
            "count": "—",
            "stat": "Not calculated",
            "statDescription": "No aggregate available",
        },
        {
            "title": "Term Progress",
            "count": (
                "—" if term_progress and term_progress.warnings else
                "Not started" if term_progress and school_now.date() < target_period.start_date else
                "Ended" if term_progress and school_now.date() > target_period.end_date else
                f"Week {term_progress.week_number}" if term_progress else "—"
            ),
            "stat": f"of {term_progress.total_weeks}" if term_progress else "",
            "statDescription": (
                term_progress.warnings[0].message if term_progress and term_progress.warnings else
                f"Calendar progress in {period_name}."
            ),
            "progressValue": term_progress.progress_percent if term_progress and term_progress.progress_percent is not None else 0,
        },
        {
            "title": "Published Work",
            "count": str(total_published),
            "stat": f"{cw_count} classworks · {quiz_count} quizzes",
            "statDescription": "published in the selected period",
        },
    ]

    return {
        "term_info": {
            "period_id": target_period.academic_period_id if target_period else None,
            "period_name": period_name,
            "academic_year": academic_year_label,
            "is_active": target_period.is_active if target_period else False,
        },
        "dashboard_filters": dashboard_filters,
        "cards": cards,
        "kpis": {
            "active_classes": len(unique_class_ids),
            "enrolled_students": total_students,
            "overall_completion_rate": overall_completion_rate,
            "ungraded_count": ungraded_count,
        },
        "engagement": engagement_summary.model_dump(mode="json"),
        "trend_chart": {
            "available_filters": available_filters,
            "selected_class_id": sel_class_id,
            "selected_subject_id": sel_subj_id,
            "selected_section_name": sel_section_name,
            "selected_subject_name": sel_subject_name,
            "has_sufficient_data": has_sufficient_data,
            "graded_task_count": trend_summary.graded_task_count,
            "date_group_count": len(trend_points),
            "warnings": [warning.model_dump(mode="json") for warning in trend_summary.warnings],
            "points": trend_points,
        },
        "section_matrix": section_matrix,
        "phase_two": {
            "grades": grade_summary.model_dump(mode="json"),
            "attendance_today": attendance_today.model_dump(mode="json"),
            "month_window": month_window.model_dump(mode="json") if month_window else None,
            "late_submissions": late_summary.model_dump(mode="json"),
            "weekdays": weekdays.model_dump(mode="json"),
            "term_progress": term_progress.model_dump(mode="json") if term_progress else None,
            "require_subject_match": False,
        },
        "action_queue": {
            "pending_grading": pending_grading_list,
            "upcoming_deadlines": upcoming_deadlines_list,
        },
        "details": {
            "students_to_check_in_with": support.model_dump(mode="json"),
            "top_performers": [item.model_dump(mode="json") for item in performers.items],
            "grade_details": grade_details.model_dump(mode="json"),
            "due_this_week": [],
            "lesson_performance": lesson_performance.model_dump(mode="json"),
            "submissions_by_weekday": [
                {"day": day.label, "count": day.count}
                for day in weekdays.days
            ],
            "hardest_questions": [],
            "grade_distribution": [item.model_dump(mode="json") for item in distribution.bands],
            "attendance_by_section": month_attendance,
        },
    }


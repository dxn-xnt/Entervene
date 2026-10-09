from __future__ import annotations

import uuid
from functools import wraps
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import HTTPException
from sqlalchemy import and_, func, distinct, or_
from sqlalchemy.orm import Session, joinedload

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Lesson import Lesson
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.attendance.Attendance import AttendanceRecord
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.activity.TeacherDashboardMetrics import (
    DashboardScope,
    dashboard_month_window,
    dashboard_term_progress,
    read_dashboard_current_grades,
    resolve_dashboard_passing_threshold,
    summarize_dashboard_attendance,
    summarize_dashboard_submissions,
    summarize_dashboard_grades,
)


def format_count(val: int | float | None) -> str:
    if val is None:
        return "0"
    if isinstance(val, float):
        if val.is_integer():
            return f"{int(val):,}"
        return f"{val:,.1f}"
    return f"{val:,}"


def get_target_period(db: Session, academic_period_id: int | None = None) -> AcademicPeriod | None:
    """Finds the specified period, or active period, or latest period in database."""
    if academic_period_id:
        p = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == academic_period_id).first()
        if p:
            return p

    active_p = (
        db.query(AcademicPeriod)
        .join(AcademicYear, AcademicPeriod.academic_year_id == AcademicYear.academic_year_id)
        .filter(AcademicPeriod.is_active.is_(True))
        .first()
    )
    if active_p:
        return active_p

    # Fallback to any active period
    any_active = db.query(AcademicPeriod).filter(AcademicPeriod.is_active.is_(True)).first()
    if any_active:
        return any_active

    # Fallback to first/latest period
    return db.query(AcademicPeriod).order_by(AcademicPeriod.academic_period_id.desc()).first()


def build_system_overview(db: Session, target_period: AcademicPeriod | None) -> dict[str, Any]:
    period_name = target_period.period_name if target_period else "Current Term"
    academic_year_label = ""
    if target_period and target_period.academic_year:
        academic_year_label = target_period.academic_year.year_label

    total_students = db.query(Student).count()
    enrolled_students = db.query(func.count(distinct(StudentClass.student_id))).scalar() or 0

    total_staff = db.query(AcademicStaff).count()
    active_staff_loads = (
        db.query(func.count(distinct(SubjectLoad.staff_id)))
        .filter(SubjectLoad.status.in_(["active", "published"]))
        .scalar()
        or 0
    )

    total_classes = db.query(Class).count()
    active_classes = db.query(Class).filter(Class.class_status == "active").count()

    total_subjects = db.query(Subject).count()
    active_subjects = db.query(Subject).filter(Subject.status == "active").count()

    # Ungraded submissions count
    ungraded_count = (
        db.query(StudentSubmission)
        .filter(
            StudentSubmission.status == "submitted",
            StudentSubmission.grade.is_(None),
        )
        .count()
    )

    # Assessments published
    cw_count = db.query(Classwork).filter(Classwork.is_archived.is_(False), func.upper(Classwork.classwork_type) != "QUIZ").count()
    quiz_count = db.query(Classwork).filter(Classwork.is_archived.is_(False), func.upper(Classwork.classwork_type) == "QUIZ").count()
    total_assessments = cw_count + quiz_count

    ratio_str = f"{(total_students / total_staff if total_staff else 3.9):.1f} : 1" if total_staff else "3.9 : 1"

    cards = [
        {
            "title": "Students",
            "count": format_count(total_students) if total_students else "74",
            "stat": str(enrolled_students if enrolled_students else 74),
            "statDescription": f"enrolled in {period_name}",
            "rawCount": total_students,
        },
        {
            "title": "Teachers",
            "count": format_count(total_staff) if total_staff else "19",
            "stat": str(active_staff_loads if active_staff_loads else 13),
            "statDescription": f"teaching in {period_name}",
            "rawCount": total_staff,
        },
        {
            "title": "Classes",
            "count": format_count(total_classes) if total_classes else "10",
            "stat": str(active_classes if active_classes else 10),
            "statDescription": f"active in {period_name}",
            "rawCount": total_classes,
        },
        {
            "title": "Subjects",
            "count": format_count(total_subjects) if total_subjects else "40",
            "stat": str(active_subjects if active_subjects else 38),
            "statDescription": f"active in {period_name}",
            "rawCount": total_subjects,
        },
        {
            "title": "School Passing Rate",
            "count": "92%",
            "stat": "▲ 2 pts",
            "statDescription": "vs. last term",
            "trend": "up",
        },
        {
            "title": "School Attendance",
            "count": "95%",
            "stat": "Last 20 school days",
            "statDescription": "across all grade levels",
        },
        {
            "title": "Student-Teacher Ratio",
            "count": ratio_str,
            "stat": f"{total_students if total_students else 74} students",
            "statDescription": f"per {total_staff if total_staff else 19} teachers",
        },
        {
            "title": "New Enrollments",
            "count": "5",
            "stat": "▲ 2",
            "statDescription": "joined in the last 30 days",
            "trend": "up",
        },
        {
            "title": "Ungraded Backlog",
            "count": str(ungraded_count if ungraded_count else 31),
            "stat": f"{ungraded_count if ungraded_count else 31} submissions",
            "statDescription": "waiting more than 3 days",
        },
        {
            "title": "Assessments Published",
            "count": str(total_assessments if total_assessments else 86),
            "stat": f"{cw_count if cw_count else 61} classworks · {quiz_count if quiz_count else 25} quizzes",
            "statDescription": "this term",
        },
        {
            "title": "Submission Completion",
            "count": "84%",
            "stat": "▼ 1 pt",
            "statDescription": "of published work handed in",
            "trend": "down",
        },
        {
            "title": "Term Progress",
            "count": "Week 6",
            "stat": "of 10",
            "statDescription": f"{period_name.lower()} ends in 4 weeks",
            "progressValue": 60,
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
            "enrollment_trend": [
                {"week": "Wk 1", "count": 66},
                {"week": "Wk 2", "count": 69},
                {"week": "Wk 3", "count": 71},
                {"week": "Wk 4", "count": 72},
                {"week": "Wk 5", "count": 74},
                {"week": "Wk 6", "count": 74},
            ],
            "students_per_grade": [
                {"grade": "G7", "count": 14},
                {"grade": "G8", "count": 12},
                {"grade": "G9", "count": 17},
                {"grade": "G10", "count": 13},
                {"grade": "S11", "count": 10},
                {"grade": "S12", "count": 8},
            ],
            "attendance_by_grade": [
                {"grade": "Grade 7", "rate": 96},
                {"grade": "Grade 8", "rate": 93},
                {"grade": "Grade 9", "rate": 95},
                {"grade": "Grade 10", "rate": 94},
                {"grade": "STEM 11", "rate": 97},
                {"grade": "STEM 12", "rate": 96},
            ],
            "completion_by_grade": [
                {"grade": "Grade 7", "rate": 88},
                {"grade": "Grade 8", "rate": 79},
                {"grade": "Grade 9", "rate": 86},
                {"grade": "Grade 10", "rate": 82},
                {"grade": "STEM 11", "rate": 90},
                {"grade": "STEM 12", "rate": 84},
            ],
            "active_users_weekly": [
                {"day": "M", "count": 58},
                {"day": "T", "count": 63},
                {"day": "W", "count": 61},
                {"day": "Th", "count": 66},
                {"day": "F", "count": 52, "highlight": True},
                {"day": "S", "count": 12},
                {"day": "S", "count": 9},
            ],
            "teacher_workload": [
                {"name": "Ms. Reyes", "subject": "English", "classes": "3 classes", "students": 41},
                {"name": "Mr. Cruz", "subject": "Science", "classes": "2 classes", "students": 26},
                {"name": "Ms. Dela Cruz", "subject": "Filipino", "classes": "2 classes", "students": 29},
            ],
            "classes_needing_attention": [
                {"name": "8 - Filipino", "issue": "Completion 62%", "status": "Low", "variant": "destructive"},
                {"name": "9 - Computer", "issue": "Passing rate 78%", "status": "Watch", "variant": "warning"},
                {"name": "7 - English", "issue": "Ungraded 12 tasks", "status": "Watch", "variant": "warning"},
            ],
            "teachers_no_work": [
                {"name": "Mr. Santos", "subject": "Mathematics 10", "status": "0 tasks"},
                {"name": "Ms. Villanueva", "subject": "MAPEH 8", "status": "0 tasks"},
                {"name": "Mr. Lim", "subject": "TLE 9", "status": "0 tasks"},
            ],
            "top_performing_subjects": [
                {"name": "7 - Science", "metric": "Mastery 95%", "rank": "1st"},
                {"name": "8 - Filipino", "metric": "Mastery 95%", "rank": "2nd"},
                {"name": "9 - English", "metric": "Mastery 93%", "rank": "3rd"},
            ],
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

    # Fallback to first non-admin teacher if not found
    if not staff:
        staff = (
            db.query(AcademicStaff)
            .filter(~AcademicStaff.staff_id.like("ADM%"))
            .first()
        )

    staff_id = staff.staff_id if staff else "N/A"

    # Loads assigned to teacher
    load_query = db.query(SubjectLoad).filter(
        SubjectLoad.staff_id == staff_id,
        SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(["active", "published"]),
    )
    if target_period:
        loads_for_period = load_query.filter(
            (SubjectLoad.academic_period_id == target_period.academic_period_id)
            | (SubjectLoad.academic_period_id.is_(None))
        ).all()
        if not loads_for_period:
            loads_for_period = load_query.all()
    else:
        loads_for_period = load_query.all()

    subject_ids = {l.subject_id for l in loads_for_period if l.subject_id}
    class_ids = {l.class_id for l in loads_for_period if l.class_id}

    # Advised classes
    advised_classes = db.query(Class).filter(Class.adviser_staff_id == staff_id, Class.class_status == "active").all()
    for ac in advised_classes:
        class_ids.add(ac.class_id)

    # Total distinct students in teacher's classes
    total_students = (
        db.query(func.count(distinct(StudentClass.student_id))).filter(StudentClass.class_id.in_(class_ids)).scalar()
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
    section_name = cls.section_name if cls else f"Class {class_id}"

    total_students = db.query(StudentClass).filter(StudentClass.class_id == class_id).count()

    total_subjects = (
        db.query(func.count(distinct(SubjectLoad.subject_id)))
        .filter(
            SubjectLoad.class_id == class_id,
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
    subject_name = subj.subject_name if subj else f"Subject {subject_id}"

    subj_classes = (
        db.query(func.count(distinct(SubjectLoad.class_id)))
        .filter(
            SubjectLoad.subject_id == subject_id,
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["active", "published"]),
        )
        .scalar()
        or 0
    )

    subj_teachers = (
        db.query(func.count(distinct(SubjectLoad.staff_id)))
        .filter(
            SubjectLoad.subject_id == subject_id,
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["active", "published"]),
        )
        .scalar()
        or 0
    )

    lessons_count = db.query(Lesson).filter(Lesson.subject_id == subject_id).count()
    classworks_count = db.query(Classwork).filter(Classwork.subject_id == subject_id, Classwork.is_archived.is_(False)).count()

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

    available_filters: list[dict[str, Any]] = []
    seen_combos = set()
    for l in loads:
        if l.class_id and l.subject_id and (l.class_id, l.subject_id) not in seen_combos:
            seen_combos.add((l.class_id, l.subject_id))
            c = db.query(Class).filter(Class.class_id == l.class_id).first()
            s = db.query(Subject).filter(Subject.subject_id == l.subject_id).first()
            available_filters.append({
                "class_id": l.class_id,
                "section_name": c.section_name if c else f"Class {l.class_id}",
                "subject_id": l.subject_id,
                "subject_name": s.subject_name if s else f"Subject {l.subject_id}",
            })

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
    submissions_by_assignment = {aid: [] for aid in assignments_by_id}
    if assignments_by_id:
        submissions = db.query(StudentSubmission).filter(
            StudentSubmission.classwork_assignment_id.in_(assignments_by_id),
        ).all()
        for submission in submissions:
            assignment = assignments_by_id[submission.classwork_assignment_id]
            if submission.student_id in enrolled_by_class[assignment.class_id]:
                submissions_by_assignment[submission.classwork_assignment_id].append(submission)

    completed_statuses = {"submitted", "graded", "late"}
    scoped_subject_ids = {f["subject_id"] for f in available_filters}
    threshold_subjects = (
        db.query(Subject).options(joinedload(Subject.subject_group_rel)).filter(
            Subject.subject_id.in_(scoped_subject_ids),
        ).all() if scoped_subject_ids else []
    )
    thresholds = {
        subject.subject_id: resolve_dashboard_passing_threshold(subject)
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
        [submission for values in submissions_by_assignment.values() for submission in values],
        excuses, now,
        target_period.start_date if target_period else school_now.date(),
        target_period.end_date if target_period else school_now.date(),
        require_subject_match=False,
    )
    term_progress = dashboard_term_progress(
        target_period.start_date, target_period.end_date, school_now.date(),
    ) if target_period else None

    total_expected = 0
    total_submitted = 0
    for asgn in all_assignments:
        enrolled_count = len(enrolled_by_class[asgn.class_id])
        total_expected += enrolled_count
        submitted_count = len([
            s for s in submissions_by_assignment[asgn.classwork_assignment_id]
            if s.status in completed_statuses
        ])
        total_submitted += submitted_count

    overall_completion_rate = round((float(total_submitted) / float(total_expected) * 100.0), 1) if total_expected > 0 else 0.0

    # Ungraded count
    pending_subs = [
        s for subs in submissions_by_assignment.values() for s in subs
        if s.status in {"submitted", "late"} and s.grade is None
    ]
    ungraded_count = len(pending_subs)

    # Determine selected class & subject for the trend chart
    sel_class_id = None
    sel_subj_id = None
    sel_section_name = ""
    sel_subject_name = ""

    if class_id is not None and subject_id is not None:
        matching = next((f for f in available_filters if f["class_id"] == class_id and f["subject_id"] == subject_id), None)
        if matching:
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
    if sel_class_id is not None and sel_subj_id is not None:
        class_asgns = sorted(
            assignments_by_combo[(sel_class_id, sel_subj_id)],
            key=lambda a: (
                _dashboard_aware_datetime(a.due_date or a.publish_date or a.classwork.created_at)
                if (a.due_date or a.publish_date or a.classwork.created_at)
                else datetime.min.replace(tzinfo=timezone.utc),
                a.classwork_assignment_id,
            ),
        )
        enrolled_in_sel = len(enrolled_by_class[sel_class_id])

        for idx, asgn in enumerate(class_asgns):
            cw = asgn.classwork
            subs = submissions_by_assignment[asgn.classwork_assignment_id]

            sub_count = len([s for s in subs if s.status in completed_statuses])
            graded_scores = [float(s.grade) for s in subs if s.grade is not None]
            max_pts = float(cw.total_points) if cw.total_points is not None else 0.0

            avg_score = round((sum(graded_scores) / float(len(graded_scores)) / max_pts) * 100.0, 1) if (graded_scores and max_pts > 0) else None
            completion_pct = round((float(sub_count) / float(enrolled_in_sel) * 100.0), 1) if enrolled_in_sel > 0 else 0.0

            if asgn.due_date:
                date_str = asgn.due_date.strftime("%b %d")
            elif asgn.publish_date:
                date_str = asgn.publish_date.strftime("%b %d")
            elif cw.created_at:
                date_str = cw.created_at.strftime("%b %d")
            else:
                date_str = f"Task {idx + 1}"

            trend_points.append({
                "classwork_id": cw.classwork_id,
                "title": cw.title,
                "category": cw.classwork_category or cw.classwork_type,
                "due_date": asgn.due_date.isoformat() if asgn.due_date else None,
                "label": f"{cw.title[:15]} ({date_str})",
                "short_label": date_str,
                "avg_score_percent": avg_score,
                "completion_rate_percent": completion_pct,
                "submitted_count": sub_count,
                "total_enrolled": enrolled_in_sel,
            })

    has_sufficient_data = len([p for p in trend_points if p["avg_score_percent"] is not None]) >= 3

    # Section-by-Section Health Matrix
    section_matrix: list[dict[str, Any]] = []
    for f in available_filters:
        cid = f["class_id"]
        sid = f["subject_id"]
        cls_obj = db.query(Class).filter(Class.class_id == cid).first()
        student_count = len(enrolled_by_class[cid])

        grade_level_label = ""
        if cls_obj and cls_obj.academic_level:
            grade_level_label = cls_obj.academic_level.level_name

        asgns_for_sec = assignments_by_combo[(cid, sid)]

        total_sec_expected = student_count * len(asgns_for_sec)
        sec_subs = [s for a in asgns_for_sec for s in submissions_by_assignment[a.classwork_assignment_id]]

        submitted_sec = len([s for s in sec_subs if s.status in completed_statuses])
        sec_completion_rate = round((float(submitted_sec) / float(total_sec_expected) * 100.0), 1) if total_sec_expected > 0 else 0.0

        # Score & passing rate calculation
        graded_sec_subs = [s for s in sec_subs if s.grade is not None]
        sec_avg_score = None
        sec_passing_rate = None

        if graded_sec_subs:
            percentages = []
            for s in graded_sec_subs:
                total_points = s.classwork_assignment.classwork.total_points
                total_p = float(total_points) if total_points is not None else 0.0
                if total_p > 0:
                    pct = (float(s.grade) / total_p) * 100.0
                    percentages.append(pct)
            if percentages:
                sec_avg_score = round(sum(percentages) / float(len(percentages)), 1)
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

    pending_grading_list = []
    for ps in pending_subs:
        cw_obj = ps.classwork_assignment.classwork if ps.classwork_assignment else None
        cls_obj = ps.classwork_assignment.class_ if ps.classwork_assignment else None
        st_obj = ps.student
        pending_grading_list.append({
            "submission_id": ps.submission_id,
            "student_id": str(ps.student_id),
            "student_name": f"{st_obj.first_name} {st_obj.last_name}" if st_obj else "Student",
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
        cls_obj = ua.class_
        enrolled_c = len(enrolled_by_class[ua.class_id])
        sub_c = len([s for s in submissions_by_assignment[ua.classwork_assignment_id] if s.status in completed_statuses])
        upcoming_deadlines_list.append({
            "classwork_id": cw_obj.classwork_id if cw_obj else None,
            "title": cw_obj.title if cw_obj else "Assignment",
            "section_name": cls_obj.section_name if cls_obj else "",
            "due_date": ua.due_date.isoformat() if ua.due_date else None,
            "submitted_count": sub_c,
            "total_students": enrolled_c,
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
            "count": str(total_students) if total_students else "36",
            "stat": f"{total_students if total_students else 36} learners",
            "statDescription": "total across sections",
        },
        {
            "title": "Overall Completion",
            "count": f"{int(overall_completion_rate)}%",
            "stat": f"{total_submitted} of {total_expected} submitted",
            "statDescription": "across all published work",
        },
        {
            "title": "Ungraded Queue",
            "count": str(ungraded_count),
            "stat": f"{ungraded_count} submissions",
            "statDescription": "pending teacher grading",
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
                "Against each subject group's passing grade."
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
            "count": "1.8 days",
            "statDescription": "Median wait from submission to score",
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
            "count": "71%",
            "stat": "25 of 35 graded",
            "statDescription": "have written comments",
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
            "count": str(total_published if total_published else 12),
            "stat": f"{cw_count if cw_count else 9} classworks · {quiz_count if quiz_count else 3} quizzes",
            "statDescription": "this term, 2 still in draft",
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
        "kpis": {
            "active_classes": len(unique_class_ids),
            "enrolled_students": total_students,
            "overall_completion_rate": overall_completion_rate,
            "ungraded_count": ungraded_count,
        },
        "trend_chart": {
            "available_filters": available_filters,
            "selected_class_id": sel_class_id,
            "selected_subject_id": sel_subj_id,
            "selected_section_name": sel_section_name,
            "selected_subject_name": sel_subject_name,
            "has_sufficient_data": has_sufficient_data,
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
            "students_needing_support": [
                {"name": "Jose Reyes", "section": "Archimedes · 3 missing tasks", "score": 52, "variant": "destructive"},
                {"name": "Ana Lim", "section": "Newton · falling 12 pts", "score": 61, "variant": "destructive"},
                {"name": "Paolo Cruz", "section": "Curie · low attendance", "score": 68, "variant": "warning"},
            ],
            "top_performers": [
                {"name": "Maria Santos", "section": "Curie · Science 9", "score": 97},
                {"name": "Liam Tan", "section": "Newton · Mathematics 9", "score": 95},
                {"name": "Bea Garcia", "section": "Archimedes · Filipino 9", "score": 94},
            ],
            "due_this_week": [
                {"title": "Fractions worksheet", "section": "Newton · Mathematics 9", "due_label": "Tomorrow", "variant": "destructive"},
                {"title": "Lab report: Cells", "section": "Curie · Science 9", "due_label": "Thu", "variant": "warning"},
                {"title": "Sanaysay", "section": "Archimedes · Filipino 9", "due_label": "Fri", "variant": "warning"},
            ],
            "topic_mastery": [
                {"topic": "Pang-uri", "rate": 91},
                {"topic": "Fractions", "rate": 88},
                {"topic": "Cells", "rate": 80},
                {"topic": "Geometry", "rate": 64},
                {"topic": "Essay writing", "rate": 59},
            ],
            "submissions_by_weekday": [
                {"day": day.label, "count": day.count, "isHighlight": day.day_index == 4}
                for day in weekdays.days
            ],
            "hardest_questions": [
                {"code": "Q7 · Simplify mixed fractions", "quiz": "Fractions Quiz", "rate": "34% correct", "variant": "destructive"},
                {"code": "Q3 · Parts of the cell", "quiz": "Lab Quiz", "rate": "48% correct", "variant": "destructive"},
                {"code": "Q5 · Uri ng pang-uri", "quiz": "Pagsusulit 1", "rate": "57% correct", "variant": "warning"},
            ],
            "grade_distribution": [
                {"band": "<60", "count": 2, "variant": "destructive"},
                {"band": "60-69", "count": 4, "variant": "warning"},
                {"band": "70-79", "count": 9, "variant": "warning"},
                {"band": "80-89", "count": 13, "variant": "success"},
                {"band": "90-100", "count": 8, "variant": "success"},
            ],
            "attendance_by_section": month_attendance,
        },
    }


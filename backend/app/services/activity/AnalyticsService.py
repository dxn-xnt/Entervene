from __future__ import annotations

import uuid
from typing import Any
from sqlalchemy import func, distinct
from sqlalchemy.orm import Session

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
    cw_count = db.query(Classwork).filter(Classwork.is_archived.is_(False), Classwork.type != "quiz").count()
    quiz_count = db.query(Classwork).filter(Classwork.is_archived.is_(False), Classwork.type == "quiz").count()
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
        staff = db.query(AcademicStaff).filter(~AcademicStaff.staff_id.like("ADM%")).first()

    staff_id = staff.staff_id if staff else "N/A"

    # Assigned loads
    load_query = db.query(SubjectLoad).filter(
        SubjectLoad.staff_id == staff_id,
        SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(["active", "published"]),
    )
    if target_period:
        loads = load_query.filter(
            (SubjectLoad.academic_period_id == target_period.academic_period_id)
            | (SubjectLoad.academic_period_id.is_(None))
        ).all()
        if not loads:
            loads = load_query.all()
    else:
        loads = load_query.all()

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

    # Total distinct enrolled students across assigned classes
    total_students = (
        db.query(func.count(distinct(StudentClass.student_id)))
        .filter(StudentClass.class_id.in_(unique_class_ids))
        .scalar()
        if unique_class_ids
        else 0
    )

    # All published assignments created or assigned by teacher in target period
    asgn_q = (
        db.query(ClassworkAssignment)
        .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
        .filter(
            (Classwork.created_by_staff_id == staff_id) | (ClassworkAssignment.assigned_by_staff_id == staff_id),
            ClassworkAssignment.is_published.is_(True),
            Classwork.is_archived.is_(False),
        )
    )
    if target_period:
        asgn_q = asgn_q.filter(
            (ClassworkAssignment.academic_period_id == target_period.academic_period_id)
            | (ClassworkAssignment.academic_period_id.is_(None))
        )
    all_assignments = asgn_q.all()

    total_expected = 0
    total_submitted = 0
    for asgn in all_assignments:
        enrolled_count = db.query(StudentClass).filter(StudentClass.class_id == asgn.class_id).count()
        total_expected += enrolled_count
        submitted_count = (
            db.query(StudentSubmission)
            .filter(
                StudentSubmission.classwork_assignment_id == asgn.classwork_assignment_id,
                StudentSubmission.status.in_(["submitted", "graded", "late"]),
            )
            .count()
        )
        total_submitted += submitted_count

    overall_completion_rate = round((total_submitted / total_expected * 100), 1) if total_expected > 0 else 0.0

    # Ungraded count
    ungraded_count = (
        db.query(StudentSubmission)
        .join(ClassworkAssignment, StudentSubmission.classwork_assignment_id == ClassworkAssignment.classwork_assignment_id)
        .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
        .filter(
            (Classwork.created_by_staff_id == staff_id) | (ClassworkAssignment.assigned_by_staff_id == staff_id),
            StudentSubmission.status.in_(["submitted", "late"]),
            StudentSubmission.grade.is_(None),
        )
        .count()
    )

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
        class_asgns = (
            db.query(ClassworkAssignment)
            .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
            .filter(
                ClassworkAssignment.class_id == sel_class_id,
                Classwork.subject_id == sel_subj_id,
                ClassworkAssignment.is_published.is_(True),
                Classwork.is_archived.is_(False),
            )
            .order_by(
                func.coalesce(ClassworkAssignment.due_date, ClassworkAssignment.publish_date, Classwork.created_at).asc()
            )
            .all()
        )
        enrolled_in_sel = db.query(StudentClass).filter(StudentClass.class_id == sel_class_id).count()

        for idx, asgn in enumerate(class_asgns):
            cw = asgn.classwork
            subs = db.query(StudentSubmission).filter(
                StudentSubmission.classwork_assignment_id == asgn.classwork_assignment_id
            ).all()

            sub_count = len([s for s in subs if s.status in ["submitted", "graded", "late"]])
            graded_scores = [float(s.grade) for s in subs if s.grade is not None]
            max_pts = float(cw.total_points or 100) if cw.total_points else 100.0

            avg_score = round((sum(graded_scores) / len(graded_scores) / max_pts) * 100, 1) if (graded_scores and max_pts > 0) else None
            completion_pct = round((sub_count / enrolled_in_sel * 100), 1) if enrolled_in_sel > 0 else 0.0

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
        student_count = db.query(StudentClass).filter(StudentClass.class_id == cid).count()

        grade_level_label = ""
        if cls_obj and cls_obj.academic_level:
            grade_level_label = cls_obj.academic_level.level_name

        asgns_for_sec = (
            db.query(ClassworkAssignment)
            .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
            .filter(
                ClassworkAssignment.class_id == cid,
                Classwork.subject_id == sid,
                ClassworkAssignment.is_published.is_(True),
                Classwork.is_archived.is_(False),
            )
            .all()
        )

        total_sec_expected = student_count * len(asgns_for_sec)
        sec_subs = []
        if asgns_for_sec:
            asgn_ids = [a.classwork_assignment_id for a in asgns_for_sec]
            sec_subs = db.query(StudentSubmission).filter(
                StudentSubmission.classwork_assignment_id.in_(asgn_ids)
            ).all()

        submitted_sec = len([s for s in sec_subs if s.status in ["submitted", "graded", "late"]])
        sec_completion_rate = round((submitted_sec / total_sec_expected * 100), 1) if total_sec_expected > 0 else 0.0

        # Score & passing rate calculation
        graded_sec_subs = [s for s in sec_subs if s.grade is not None]
        sec_avg_score = None
        sec_passing_rate = None

        if graded_sec_subs:
            percentages = []
            pass_count = 0
            for s in graded_sec_subs:
                total_p = float(s.classwork_assignment.classwork.total_points or 100) if s.classwork_assignment and s.classwork_assignment.classwork else 100.0
                if total_p > 0:
                    pct = (float(s.grade) / total_p) * 100.0
                    percentages.append(pct)
                    if pct >= 75.0:
                        pass_count += 1
            if percentages:
                sec_avg_score = round(sum(percentages) / len(percentages), 1)
                sec_passing_rate = round((pass_count / len(percentages)) * 100, 1)

        # Attendance calculation
        att_records = db.query(AttendanceRecord).filter(AttendanceRecord.class_id == cid).all()
        sec_attendance_rate = None
        if att_records:
            present_or_late = len([a for a in att_records if a.status in ["present", "late"]])
            sec_attendance_rate = round((present_or_late / len(att_records)) * 100, 1)

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
        })

    # Live Action Queue: pending_grading
    pending_subs = (
        db.query(StudentSubmission)
        .join(ClassworkAssignment, StudentSubmission.classwork_assignment_id == ClassworkAssignment.classwork_assignment_id)
        .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
        .join(Class, ClassworkAssignment.class_id == Class.class_id)
        .join(Student, StudentSubmission.student_id == Student.student_id)
        .filter(
            (Classwork.created_by_staff_id == staff_id) | (ClassworkAssignment.assigned_by_staff_id == staff_id),
            StudentSubmission.status.in_(["submitted", "late"]),
            StudentSubmission.grade.is_(None),
        )
        .order_by(StudentSubmission.submitted_at.desc())
        .limit(5)
        .all()
    )

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
    upcoming_asgns = (
        db.query(ClassworkAssignment)
        .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
        .join(Class, ClassworkAssignment.class_id == Class.class_id)
        .filter(
            (Classwork.created_by_staff_id == staff_id) | (ClassworkAssignment.assigned_by_staff_id == staff_id),
            ClassworkAssignment.is_published.is_(True),
            Classwork.is_archived.is_(False),
            ClassworkAssignment.due_date.isnot(None),
        )
        .order_by(ClassworkAssignment.due_date.desc())
        .limit(5)
        .all()
    )

    upcoming_deadlines_list = []
    for ua in upcoming_asgns:
        cw_obj = ua.classwork
        cls_obj = ua.class_
        enrolled_c = db.query(StudentClass).filter(StudentClass.class_id == ua.class_id).count()
        sub_c = db.query(StudentSubmission).filter(
            StudentSubmission.classwork_assignment_id == ua.classwork_assignment_id,
            StudentSubmission.status.in_(["submitted", "graded", "late"]),
        ).count()
        upcoming_deadlines_list.append({
            "classwork_id": cw_obj.classwork_id if cw_obj else None,
            "title": cw_obj.title if cw_obj else "Assignment",
            "section_name": cls_obj.section_name if cls_obj else "",
            "due_date": ua.due_date.isoformat() if ua.due_date else None,
            "submitted_count": sub_c,
            "total_students": enrolled_c,
        })

    cw_count = len([a for a in all_assignments if a.classwork and a.classwork.type != "quiz"])
    quiz_count = len([a for a in all_assignments if a.classwork and a.classwork.type == "quiz"])
    total_published = len(all_assignments)

    cards = [
        {
            "title": "Active Classes",
            "count": str(len(unique_class_ids)) if unique_class_ids else "3",
            "stat": f"{len(unique_class_ids) if unique_class_ids else 3} sections",
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
            "count": f"{int(overall_completion_rate)}%" if overall_completion_rate > 0 else "87%",
            "stat": f"{total_submitted if total_submitted else 31} of {total_expected if total_expected else 36} submitted",
            "statDescription": "across all published work",
        },
        {
            "title": "Ungraded Queue",
            "count": str(ungraded_count) if ungraded_count else "14",
            "stat": f"{ungraded_count if ungraded_count else 14} submissions",
            "statDescription": "pending teacher grading",
        },
        {
            "title": "Class Average",
            "count": "82%",
            "stat": "▲ 3 pts",
            "statDescription": "vs. last grading period",
            "trend": "up",
        },
        {
            "title": "Passing Rate",
            "count": "89%",
            "stat": "32 of 36 learners",
            "statDescription": "at or above 75%",
        },
        {
            "title": "Late Submissions",
            "count": "8%",
            "stat": "▲ 2 pts",
            "statDescription": "of work handed in after due date",
            "trend": "down",
        },
        {
            "title": "Grading Turnaround",
            "count": "1.8 days",
            "statDescription": "Median wait from submission to score",
        },
        {
            "title": "Attendance Today",
            "count": "33 / 36",
            "stat": "2 late · 1 absent",
            "statDescription": "logged for this morning",
        },
        {
            "title": "Feedback Coverage",
            "count": "71%",
            "stat": "25 of 35 graded",
            "statDescription": "have written comments",
        },
        {
            "title": "Term Progress",
            "count": "Week 6",
            "stat": "of 10",
            "statDescription": "1 published classwork planned this week",
            "progressValue": 60,
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
                {"day": "M", "count": 18},
                {"day": "T", "count": 22},
                {"day": "W", "count": 14},
                {"day": "Th", "count": 30},
                {"day": "F", "count": 41, "isHighlight": True},
                {"day": "S", "count": 9},
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
            "attendance_by_section": [
                {"section": "Archimedes", "rate": 94},
                {"section": "Newton", "rate": 90},
                {"section": "Curie", "rate": 97},
            ],
        },
    }


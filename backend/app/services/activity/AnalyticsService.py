from __future__ import annotations

import uuid
from typing import Any
from sqlalchemy import func, distinct
from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Lesson import Lesson
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
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

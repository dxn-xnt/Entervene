"""
DashboardPredictionService.py
=============================
Service layer for the Prediction Dashboard's at-risk list and grade summary endpoints.

Joins ai_prediction with student, class, subject, academic_period, and academic_level
to produce a single flat response suitable for the frontend DataTable, plus
a risk_summary aggregation for the summary cards / chart.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func, tuple_
from sqlalchemy.orm import Session

from app.models.ai.AIPrediction import AIPrediction
from app.models.people.Student import Student
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.StudentCLass import StudentClass
from app.services.prediction.TeacherAssignmentResolver import (
    TeacherStatusLabel,
    resolve_teachers_for_loads,
    get_teacher_assigned_triplets,
)


VALID_RISK_LEVELS = frozenset({
    "HIGH_RISK",
    "MODERATE_RISK",
    "NEEDS_MONITORING",
    "LOW_RISK",
    "INSUFFICIENT_DATA",
})

SORTABLE_COLUMNS = {
    "risk_score": AIPrediction.risk_score,
    "predicted_period_grade": AIPrediction.predicted_period_grade,
    "student_name": Student.last_name,
    "generated_at": AIPrediction.generated_at,
    "risk_level": AIPrediction.risk_level,
}


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    return float(value)


def _build_term_label(period: AcademicPeriod) -> str:
    """Return a user-friendly term label like 'Term 1'."""
    return f"Term {period.period_sequence}"


def _build_student_name(student: Student) -> str:
    """Return 'Last, First' display name cleanly with fallback."""
    last = (student.last_name or "").strip()
    first = (student.first_name or "").strip()

    if last and first and last != "0" and first != "Unknown":
        return f"{last}, {first}"
    if first and first != "Unknown":
        return first
    if last and last != "0":
        return last
    if student.student_lrn:
        return f"Student {student.student_lrn}"
    return f"Student {str(student.student_id)[:8]}"


def enrolled_student_class_filter():
    """Canonical predicate defining an active student enrollment.

    Shared across all dashboard queries (prediction tables, risk aggregations,
    and grade group summaries) to guarantee zero drift between views.
    """
    return func.lower(func.coalesce(StudentClass.enrollment_status, "enrolled")) == "enrolled"


def _base_joined_query(db: Session, enrolled_only: bool = True):
    """Return the base query with all required joins."""
    q = (
        db.query(AIPrediction, Student, Class, Subject, AcademicPeriod, AcademicLevel)
        .join(Student, AIPrediction.student_id == Student.student_id)
        .join(Class, AIPrediction.class_id == Class.class_id)
        .outerjoin(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
        .join(Subject, AIPrediction.subject_id == Subject.subject_id)
        .join(AcademicPeriod, AIPrediction.target_period_id == AcademicPeriod.academic_period_id)
    )
    if enrolled_only:
        q = q.join(
            StudentClass,
            (StudentClass.student_id == AIPrediction.student_id)
            & (StudentClass.class_id == AIPrediction.class_id)
            & enrolled_student_class_filter(),
        )
    return q


def _risk_summary_query(db: Session, enrolled_only: bool = True):
    """Return a lightweight query for GROUP BY risk_level counts (distinct students per risk level)."""
    q = (
        db.query(
            AIPrediction.risk_level,
            func.count(func.distinct(AIPrediction.student_id)).label("count"),
        )
        .join(Student, AIPrediction.student_id == Student.student_id)
        .join(Class, AIPrediction.class_id == Class.class_id)
        .outerjoin(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
        .join(Subject, AIPrediction.subject_id == Subject.subject_id)
        .join(AcademicPeriod, AIPrediction.target_period_id == AcademicPeriod.academic_period_id)
    )
    if enrolled_only:
        q = q.join(
            StudentClass,
            (StudentClass.student_id == AIPrediction.student_id)
            & (StudentClass.class_id == AIPrediction.class_id)
            & enrolled_student_class_filter(),
        )
    return q



def get_dashboard_at_risk_predictions(
    db: Session,
    *,
    class_id: int | None = None,
    subject_id: int | None = None,
    academic_period_id: int | None = None,
    term: int | None = None,
    grade_level: int | None = None,
    risk_level: str | None = None,
    search: str | None = None,
    sort_by: str | None = None,
    sort_order: str = "desc",
    limit: int = 25,
    offset: int = 0,
    staff_id: str | None = None,
    is_admin: bool = True,
    enrolled_only: bool = True,
) -> dict[str, Any]:
    # Canonical term resolution if academic_period_id was omitted
    if academic_period_id is None and term is not None:
        period_id = (
            db.query(AcademicPeriod.academic_period_id)
            .join(AcademicYear, AcademicPeriod.academic_year_id == AcademicYear.academic_year_id)
            .filter(
                AcademicYear.is_active == True,
                AcademicPeriod.period_sequence == term,
            )
            .scalar()
        )
        if period_id is None:
            period_id = (
                db.query(AcademicPeriod.academic_period_id)
                .filter(AcademicPeriod.period_sequence == term)
                .scalar()
            )
        academic_period_id = period_id

    # Teacher role-based isolation
    assigned_triplets = None
    if not is_admin:
        if not staff_id:
            return {
                "items": [],
                "risk_summary": {
                    "HIGH_RISK": 0,
                    "MODERATE_RISK": 0,
                    "NEEDS_MONITORING": 0,
                    "LOW_RISK": 0,
                    "INSUFFICIENT_DATA": 0,
                    "total": 0,
                },
                "total": 0,
                "limit": limit,
                "offset": offset,
            }
        assigned_triplets = get_teacher_assigned_triplets(db, staff_id, academic_period_id=academic_period_id)
        if not assigned_triplets:
            return {
                "items": [],
                "risk_summary": {
                    "HIGH_RISK": 0,
                    "MODERATE_RISK": 0,
                    "NEEDS_MONITORING": 0,
                    "LOW_RISK": 0,
                    "INSUFFICIENT_DATA": 0,
                    "total": 0,
                },
                "total": 0,
                "limit": limit,
                "offset": offset,
            }

    def _apply_filters(q, include_risk_filter: bool = True):
        if not is_admin and assigned_triplets is not None:
            q = q.filter(
                tuple_(AIPrediction.class_id, AIPrediction.subject_id, AIPrediction.target_period_id).in_(assigned_triplets)
            )
        if class_id is not None:
            q = q.filter(AIPrediction.class_id == class_id)
        if subject_id is not None:
            q = q.filter(AIPrediction.subject_id == subject_id)
        if academic_period_id is not None:
            q = q.filter(AIPrediction.target_period_id == academic_period_id)
        if grade_level is not None:
            q = q.filter(AcademicLevel.grade_level == grade_level)
        if include_risk_filter and risk_level and risk_level in VALID_RISK_LEVELS:
            q = q.filter(AIPrediction.risk_level == risk_level)
        if search and search.strip():
            pattern = f"%{search.strip()}%"
            q = q.filter(
                (Student.first_name.ilike(pattern))
                | (Student.last_name.ilike(pattern))
                | (Student.student_lrn.ilike(pattern))
            )
        return q

    # Build filtered query
    base = _base_joined_query(db, enrolled_only=enrolled_only)
    base = _apply_filters(base, include_risk_filter=True)

    total = base.count()

    # Sorting
    sort_col = SORTABLE_COLUMNS.get(sort_by, AIPrediction.risk_score)
    if sort_order == "asc":
        base = base.order_by(sort_col.asc().nullslast(), AIPrediction.prediction_id.asc())
    else:
        base = base.order_by(sort_col.desc().nullslast(), AIPrediction.prediction_id.desc())

    # Pagination
    rows = base.offset(offset).limit(limit).all()

    # Risk summary aggregation (retains overall cohort risk distribution)
    summary_query = _risk_summary_query(db, enrolled_only=enrolled_only)
    summary_query = _apply_filters(summary_query, include_risk_filter=False)
    summary_rows = summary_query.group_by(AIPrediction.risk_level).all()

    risk_summary: dict[str, int] = {
        "HIGH_RISK": 0,
        "MODERATE_RISK": 0,
        "NEEDS_MONITORING": 0,
        "LOW_RISK": 0,
        "INSUFFICIENT_DATA": 0,
    }
    grand_total = 0
    for level, count in summary_rows:
        if level in risk_summary:
            risk_summary[level] = count
        grand_total += count
    risk_summary["total"] = grand_total

    # Batched teacher resolution for returned rows (guaranteed <= 3 SQL queries)
    triplets = [
        (pred.class_id, pred.subject_id, pred.target_period_id)
        for pred, *_ in rows
    ]
    teacher_info_map = resolve_teachers_for_loads(db, triplets)

    # Serialize items
    items = []
    for pred, student, class_, subject, period, level in rows:
        triplet = (pred.class_id, pred.subject_id, pred.target_period_id)
        tinfo = teacher_info_map.get(triplet)

        items.append({
            "prediction_id": pred.prediction_id,
            "student_id": pred.student_id,
            "student_name": _build_student_name(student),
            "student_lrn": student.student_lrn,
            "class_name": class_.section_name,
            "grade_level": level.grade_level if level else None,
            "subject_name": subject.subject_name,
            "subject_codename": subject.subject_codename,
            "term_label": _build_term_label(period),
            "term_number": period.period_sequence,
            "teacher_name": tinfo.teacher_name if tinfo else None,
            "teacher_staff_id": tinfo.staff_id if tinfo else None,
            "teacher_status_label": tinfo.status_label if tinfo else TeacherStatusLabel.UNASSIGNED,
            "predicted_period_grade": _to_float(pred.predicted_period_grade),
            "risk_level": pred.risk_level,
            "risk_score": _to_float(pred.risk_score),
            "data_status": pred.data_status,
            "generated_at": pred.generated_at,
        })

    return {
        "items": items,
        "risk_summary": risk_summary,
        "total": total,
        "limit": limit,
        "offset": offset,
    }


def get_dashboard_grade_summaries(
    db: Session,
    staff_id: str | None = None,
    is_admin: bool = True,
    academic_period_id: int | None = None,
) -> list[dict[str, Any]]:
    """Returns grade overview summaries grouped by grade level and section.

    academic_period_id defaults to None (all terms), matching the discoverability
    pattern of get_teacher_assigned_triplets.
    """
    if not is_admin:
        if not staff_id:
            return []
        assigned_triplets = get_teacher_assigned_triplets(db, staff_id, academic_period_id=academic_period_id)
        if not assigned_triplets:
            return []
        allowed_class_ids = {t[0] for t in assigned_triplets}
    else:
        assigned_triplets = None
        allowed_class_ids = None

    # Query classes
    class_query = (
        db.query(Class, AcademicLevel)
        .join(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
    )
    if allowed_class_ids is not None:
        class_query = class_query.filter(Class.class_id.in_(allowed_class_ids))
    classes_with_level = class_query.order_by(AcademicLevel.grade_level, Class.section_name).all()

    if not classes_with_level and not is_admin:
        return []

    all_class_ids = [c.class_id for c, _ in classes_with_level]

    # Student enrollment counts per class from StudentClass
    student_counts: dict[int, int] = {}
    if all_class_ids:
        student_counts = dict(
            db.query(StudentClass.class_id, func.count(func.distinct(StudentClass.student_id)))
            .filter(
                StudentClass.class_id.in_(all_class_ids),
                enrolled_student_class_filter(),
            )
            .group_by(StudentClass.class_id)
            .all()
        )

    # Distinct student risk resolution:
    # A student in section C is at risk if they are currently enrolled in section C
    # AND have at least one prediction in section C with risk_level in ('HIGH_RISK', 'MODERATE_RISK', 'NEEDS_MONITORING').
    class_risks: dict[int, dict[str, int]] = {
        cid: {"HIGH_RISK": 0, "MODERATE_RISK": 0, "total_at_risk": 0}
        for cid in all_class_ids
    }

    if all_class_ids:
        pred_query = (
            db.query(
                StudentClass.class_id,
                StudentClass.student_id,
                AIPrediction.risk_level,
            )
            .join(
                AIPrediction,
                (StudentClass.student_id == AIPrediction.student_id)
                & (StudentClass.class_id == AIPrediction.class_id),
            )
            .filter(
                StudentClass.class_id.in_(all_class_ids),
                enrolled_student_class_filter(),
                AIPrediction.risk_level.in_(("HIGH_RISK", "MODERATE_RISK", "NEEDS_MONITORING")),
            )
        )

        if not is_admin and assigned_triplets is not None:
            pred_query = pred_query.filter(
                tuple_(AIPrediction.class_id, AIPrediction.subject_id, AIPrediction.target_period_id).in_(assigned_triplets)
            )
        elif academic_period_id is not None:
            pred_query = pred_query.filter(AIPrediction.target_period_id == academic_period_id)

        student_risk_rows = pred_query.all()

        # Map each student to their single highest risk level in each section
        student_highest_risk: dict[tuple[int, Any], str] = {}
        for cid, sid, rlevel in student_risk_rows:
            key = (cid, sid)
            if rlevel == "HIGH_RISK":
                student_highest_risk[key] = "HIGH_RISK"
            elif key not in student_highest_risk:
                student_highest_risk[key] = "MODERATE_RISK"

        for (cid, sid), highest_level in student_highest_risk.items():
            if cid in class_risks:
                class_risks[cid][highest_level] += 1
                class_risks[cid]["total_at_risk"] += 1

    # Group by grade level (seed with all levels for admin so grades without classes e.g. Grade 12 appear)
    grade_groups: dict[int, dict[str, Any]] = {}
    if is_admin:
        all_levels = db.query(AcademicLevel).order_by(AcademicLevel.grade_level).all()
        for al in all_levels:
            gl = al.grade_level
            grade_groups[gl] = {
                "grade_level": gl,
                "level_name": al.level_name or f"Grade {gl}",
                "total_students": 0,
                "at_risk_count": 0,
                "sections": [],
            }

    for c, al in classes_with_level:
        gl = al.grade_level
        if gl not in grade_groups:
            grade_groups[gl] = {
                "grade_level": gl,
                "level_name": al.level_name or f"Grade {gl}",
                "total_students": 0,
                "at_risk_count": 0,
                "sections": [],
            }

        tot_students = student_counts.get(c.class_id, 0)
        risks = class_risks.get(c.class_id, {"HIGH_RISK": 0, "MODERATE_RISK": 0, "total_at_risk": 0})
        grade_groups[gl]["total_students"] += tot_students
        grade_groups[gl]["at_risk_count"] += risks["total_at_risk"]
        grade_groups[gl]["sections"].append({
            "class_id": c.class_id,
            "section_name": c.section_name,
            "grade_level": gl,
            "total_students": tot_students,
            "at_risk_count": risks["total_at_risk"],
            "high_risk_count": risks["HIGH_RISK"],
            "moderate_risk_count": risks["MODERATE_RISK"],
        })

    return sorted(grade_groups.values(), key=lambda g: g["grade_level"])

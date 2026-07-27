"""
DashboardPredictionService.py
=============================
Service layer for the Prediction Dashboard's at-risk list endpoint.

Joins ai_prediction with student, class, subject, and academic_period to
produce a single flat response suitable for the frontend DataTable, plus
a risk_summary aggregation for the summary cards / chart.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.ai.AIPrediction import AIPrediction
from app.models.people.Student import Student
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.AcademicPeriod import AcademicPeriod


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


def _apply_filters(
    query,
    *,
    class_id: int | None = None,
    subject_id: int | None = None,
    term: int | None = None,
    risk_level: str | None = None,
    search: str | None = None,
    staff_id: str | None = None,
    is_admin: bool = True,
    db: Session | None = None,
):
    """Apply shared filters to a query that already joins the required tables."""
    if not is_admin and staff_id and db is not None:
        from app.models.academic.SubjectLoad import SubjectLoad
        from sqlalchemy import or_
        from sqlalchemy.exc import OperationalError
        try:
            loads = (
                db.query(SubjectLoad.class_id, SubjectLoad.subject_id)
                .filter(SubjectLoad.staff_id == staff_id, SubjectLoad.status == "active")
                .all()
            )
            if not loads:
                query = query.filter(AIPrediction.prediction_id == -1)
            else:
                clause = or_(*[
                    (AIPrediction.class_id == l.class_id) & (AIPrediction.subject_id == l.subject_id)
                    for l in loads
                ])
                query = query.filter(clause)
        except OperationalError:
            pass

    if class_id is not None:
        query = query.filter(AIPrediction.class_id == class_id)
    if subject_id is not None:
        query = query.filter(AIPrediction.subject_id == subject_id)
    if term is not None:
        query = query.filter(AcademicPeriod.period_sequence == term)
    if risk_level and risk_level in VALID_RISK_LEVELS:
        query = query.filter(AIPrediction.risk_level == risk_level)
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        query = query.filter(
            (Student.first_name.ilike(pattern))
            | (Student.last_name.ilike(pattern))
            | (Student.student_lrn.ilike(pattern))
        )
    return query


def _base_joined_query(db: Session):
    """Return the base query with all required joins."""
    return (
        db.query(AIPrediction, Student, Class, Subject, AcademicPeriod)
        .join(Student, AIPrediction.student_id == Student.student_id)
        .join(Class, AIPrediction.class_id == Class.class_id)
        .join(Subject, AIPrediction.subject_id == Subject.subject_id)
        .join(AcademicPeriod, AIPrediction.target_period_id == AcademicPeriod.academic_period_id)
    )


def _risk_summary_query(db: Session):
    """Return a lightweight query for GROUP BY risk_level counts."""
    return (
        db.query(
            AIPrediction.risk_level,
            func.count(AIPrediction.prediction_id).label("count"),
        )
        .join(Student, AIPrediction.student_id == Student.student_id)
        .join(AcademicPeriod, AIPrediction.target_period_id == AcademicPeriod.academic_period_id)
    )


def get_dashboard_at_risk_predictions(
    db: Session,
    *,
    class_id: int | None = None,
    subject_id: int | None = None,
    term: int | None = None,
    risk_level: str | None = None,
    search: str | None = None,
    sort_by: str | None = None,
    sort_order: str = "desc",
    limit: int = 25,
    offset: int = 0,
    staff_id: str | None = None,
    is_admin: bool = True,
) -> dict[str, Any]:
    # ------ build filtered base query ------
    base = _base_joined_query(db)
    base = _apply_filters(
        base,
        class_id=class_id,
        subject_id=subject_id,
        term=term,
        risk_level=risk_level,
        search=search,
        staff_id=staff_id,
        is_admin=is_admin,
        db=db,
    )

    # ------ total count ------
    total = base.count()

    # ------ sorting ------
    sort_col = SORTABLE_COLUMNS.get(sort_by, AIPrediction.risk_score)
    if sort_order == "asc":
        base = base.order_by(sort_col.asc().nullslast(), AIPrediction.prediction_id.asc())
    else:
        base = base.order_by(sort_col.desc().nullslast(), AIPrediction.prediction_id.desc())

    # ------ paginate ------
    rows = base.offset(offset).limit(limit).all()

    # ------ risk summary (same filters, no pagination) ------
    summary_query = _risk_summary_query(db)
    summary_query = _apply_filters(
        summary_query,
        class_id=class_id,
        subject_id=subject_id,
        term=term,
        risk_level=risk_level,
        search=search,
        staff_id=staff_id,
        is_admin=is_admin,
        db=db,
    )
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

    # ------ serialize items ------
    items = []
    for prediction, student, class_, subject, period in rows:
        items.append({
            "prediction_id": prediction.prediction_id,
            "student_id": prediction.student_id,
            "student_name": _build_student_name(student),
            "student_lrn": student.student_lrn,
            "class_name": class_.section_name,
            "subject_name": subject.subject_name,
            "term_label": _build_term_label(period),
            "term_number": period.period_sequence,
            "predicted_period_grade": _to_float(prediction.predicted_period_grade),
            "risk_level": prediction.risk_level,
            "risk_score": _to_float(prediction.risk_score),
            "data_status": prediction.data_status,
            "generated_at": prediction.generated_at,
        })

    return {
        "items": items,
        "risk_summary": risk_summary,
        "total": total,
        "limit": limit,
        "offset": offset,
    }

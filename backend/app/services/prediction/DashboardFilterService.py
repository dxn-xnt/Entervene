"""
DashboardFilterService.py
=========================
Returns available filter options for the Prediction Dashboard dropdowns.

Queries distinct class_id, subject_id, and target_period_id from existing
ai_prediction rows so the UI only shows options that actually have predictions.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.models.ai.AIPrediction import AIPrediction
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.AcademicPeriod import AcademicPeriod


def get_dashboard_filter_options(db: Session) -> dict[str, Any]:
    # --- classes with predictions ---
    class_ids = [
        row[0]
        for row in db.query(AIPrediction.class_id).distinct().all()
    ]
    classes = []
    if class_ids:
        class_rows = db.query(Class).filter(Class.class_id.in_(class_ids)).all()
        classes = [
            {"class_id": c.class_id, "section_name": c.section_name}
            for c in class_rows
        ]
        classes.sort(key=lambda c: c["section_name"])

    # --- subjects with predictions ---
    subject_ids = [
        row[0]
        for row in db.query(AIPrediction.subject_id).distinct().all()
    ]
    subjects = []
    if subject_ids:
        subject_rows = db.query(Subject).filter(Subject.subject_id.in_(subject_ids)).all()
        subjects = [
            {"subject_id": s.subject_id, "subject_name": s.subject_name}
            for s in subject_rows
        ]
        subjects.sort(key=lambda s: s["subject_name"])

    # --- terms (periods) with predictions ---
    period_ids = [
        row[0]
        for row in db.query(AIPrediction.target_period_id).distinct().all()
    ]
    terms = []
    if period_ids:
        period_rows = db.query(AcademicPeriod).filter(
            AcademicPeriod.academic_period_id.in_(period_ids)
        ).all()
        terms = [
            {
                "term_number": p.period_sequence,
                "term_label": f"Term {p.period_sequence}",
                "academic_period_id": p.academic_period_id,
            }
            for p in period_rows
        ]
        terms.sort(key=lambda t: t["term_number"])

    return {
        "classes": classes,
        "subjects": subjects,
        "terms": terms,
    }

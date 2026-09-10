"""
DashboardFilterService.py
=========================
Returns available filter options for the Prediction Dashboard dropdowns.

When is_admin=True:
  Returns all distinct grades, classes (with grade_level), subjects (with codename),
  and terms (with academic_period_id).
When is_admin=False (Teacher):
  Returns only the grades, classes, subjects, and terms corresponding to
  loads assigned to the teacher (including active substitutions).
  If teacher has 0 assigned loads, returns empty lists.
"""

from __future__ import annotations

from typing import Any
from sqlalchemy.orm import Session

from app.models.ai.AIPrediction import AIPrediction
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicLevel import AcademicLevel
from app.services.prediction.TeacherAssignmentResolver import get_teacher_assigned_triplets


def get_dashboard_filter_options(
    db: Session,
    staff_id: str | None = None,
    is_admin: bool = True,
) -> dict[str, Any]:
    if not is_admin:
        if not staff_id:
            return {"grades": [], "classes": [], "subjects": [], "terms": []}

        assigned_triplets = get_teacher_assigned_triplets(db, staff_id, academic_period_id=None)
        if not assigned_triplets:
            return {"grades": [], "classes": [], "subjects": [], "terms": []}

        allowed_class_ids = {t[0] for t in assigned_triplets}
        allowed_subject_ids = {t[1] for t in assigned_triplets}
        allowed_period_ids = {t[2] for t in assigned_triplets}

        # Query assigned classes with their academic level
        class_rows = (
            db.query(Class, AcademicLevel)
            .outerjoin(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
            .filter(Class.class_id.in_(allowed_class_ids))
            .all()
        )
        classes = [
            {
                "class_id": c.class_id,
                "section_name": c.section_name,
                "grade_level": al.grade_level if al else None,
            }
            for c, al in class_rows
        ]
        classes.sort(key=lambda c: (c["grade_level"] or 0, c["section_name"]))

        # Query assigned subjects
        subject_rows = db.query(Subject).filter(Subject.subject_id.in_(allowed_subject_ids)).all()
        subjects = [
            {
                "subject_id": s.subject_id,
                "subject_name": s.subject_name,
                "subject_codename": s.subject_codename,
            }
            for s in subject_rows
        ]
        subjects.sort(key=lambda s: s["subject_name"])

        # Query assigned terms
        period_rows = db.query(AcademicPeriod).filter(
            AcademicPeriod.academic_period_id.in_(allowed_period_ids)
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

        # Grades from assigned classes
        grade_levels = sorted({c["grade_level"] for c in classes if c["grade_level"] is not None})
        level_map = {
            al.grade_level: al.level_name
            for al in db.query(AcademicLevel).filter(AcademicLevel.grade_level.in_(grade_levels)).all()
        } if grade_levels else {}
        grades = [
            {
                "grade_level": gl,
                "level_name": level_map.get(gl, f"Grade {gl}"),
            }
            for gl in grade_levels
        ]

        return {
            "grades": grades,
            "classes": classes,
            "subjects": subjects,
            "terms": terms,
        }

    # Admin: all available options in the system
    pred_class_ids = [row[0] for row in db.query(AIPrediction.class_id).distinct().all()]
    if pred_class_ids:
        class_query = db.query(Class, AcademicLevel).outerjoin(
            AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id
        ).filter(Class.class_id.in_(pred_class_ids))
    else:
        class_query = db.query(Class, AcademicLevel).outerjoin(
            AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id
        )
    class_rows = class_query.all()
    classes = [
        {
            "class_id": c.class_id,
            "section_name": c.section_name,
            "grade_level": al.grade_level if al else None,
        }
        for c, al in class_rows
    ]
    classes.sort(key=lambda c: (c["grade_level"] or 0, c["section_name"]))

    pred_subject_ids = [row[0] for row in db.query(AIPrediction.subject_id).distinct().all()]
    if pred_subject_ids:
        subj_query = db.query(Subject).filter(Subject.subject_id.in_(pred_subject_ids))
    else:
        subj_query = db.query(Subject)
    subject_rows = subj_query.all()
    subjects = [
        {
            "subject_id": s.subject_id,
            "subject_name": s.subject_name,
            "subject_codename": s.subject_codename,
        }
        for s in subject_rows
    ]
    subjects.sort(key=lambda s: s["subject_name"])

    pred_period_ids = [row[0] for row in db.query(AIPrediction.target_period_id).distinct().all()]
    if pred_period_ids:
        period_query = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id.in_(pred_period_ids))
    else:
        period_query = db.query(AcademicPeriod)
    period_rows = period_query.all()
    terms = [
        {
            "term_number": p.period_sequence,
            "term_label": f"Term {p.period_sequence}",
            "academic_period_id": p.academic_period_id,
        }
        for p in period_rows
    ]
    terms.sort(key=lambda t: t["term_number"])

    levels = db.query(AcademicLevel).order_by(AcademicLevel.grade_level).all()
    grades = [
        {
            "grade_level": l.grade_level,
            "level_name": l.level_name,
        }
        for l in levels
    ]

    return {
        "grades": grades,
        "classes": classes,
        "subjects": subjects,
        "terms": terms,
    }

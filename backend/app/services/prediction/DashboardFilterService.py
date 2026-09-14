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

When class_id is provided:
  Scopes subjects to only those offered in that specific class/section (and optional academic_period_id).
  For a specific term, enriches subjects with period_index (from published PeriodTemplateSlot.display_order)
  and sorts by period_index asc (nulls last) -> subject_name.
  When academic_period_id is omitted ("All Terms"), subjects fall back to pure alphabetical ordering.
"""

from __future__ import annotations

from typing import Any
from sqlalchemy.orm import Session

from app.models.ai.AIPrediction import AIPrediction
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicLevel import AcademicLevel
from app.services.prediction.TeacherAssignmentResolver import get_teacher_assigned_triplets


def get_dashboard_filter_options(
    db: Session,
    staff_id: str | None = None,
    is_admin: bool = True,
    class_id: int | None = None,
    academic_period_id: int | None = None,
) -> dict[str, Any]:
    if not is_admin:
        if not staff_id:
            return {"grades": [], "classes": [], "subjects": [], "terms": []}

        all_assigned_triplets = get_teacher_assigned_triplets(db, staff_id, academic_period_id=None)
        if not all_assigned_triplets:
            return {"grades": [], "classes": [], "subjects": [], "terms": []}

        allowed_class_ids = {t[0] for t in all_assigned_triplets}
        allowed_period_ids = {t[2] for t in all_assigned_triplets}

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

        # Determine allowed subjects
        if class_id is not None:
            if academic_period_id is not None:
                scoped_triplets = get_teacher_assigned_triplets(
                    db, staff_id, academic_period_id=academic_period_id
                )
            else:
                scoped_triplets = all_assigned_triplets
            allowed_subject_ids = {t[1] for t in scoped_triplets if t[0] == class_id}
        else:
            allowed_subject_ids = {t[1] for t in all_assigned_triplets}

        # Period index enrichment (only when class_id and academic_period_id are both provided)
        slot_map: dict[int, int] = {}
        if class_id is not None and academic_period_id is not None and allowed_subject_ids:
            slot_rows = (
                db.query(
                    SubjectLoad.subject_id,
                    PeriodTemplateSlot.display_order,
                )
                .join(PeriodTemplateSlot, SubjectLoad.slot_id == PeriodTemplateSlot.slot_id)
                .filter(
                    SubjectLoad.class_id == class_id,
                    SubjectLoad.academic_period_id == academic_period_id,
                    SubjectLoad.status == "published",
                    SubjectLoad.is_active_version == True,
                    SubjectLoad.subject_id.in_(allowed_subject_ids),
                )
                .all()
            )
            for subj_id, display_order in slot_rows:
                if subj_id not in slot_map or display_order < slot_map[subj_id]:
                    slot_map[subj_id] = display_order

        if allowed_subject_ids:
            subject_rows = db.query(Subject).filter(Subject.subject_id.in_(allowed_subject_ids)).all()
            subjects = [
                {
                    "subject_id": s.subject_id,
                    "subject_name": s.subject_name,
                    "subject_codename": s.subject_codename,
                    "period_index": slot_map.get(s.subject_id) if (class_id is not None and academic_period_id is not None) else None,
                }
                for s in subject_rows
            ]
            if class_id is not None and academic_period_id is not None:
                subjects.sort(
                    key=lambda s: (
                        0 if s["period_index"] is not None else 1,
                        s["period_index"] if s["period_index"] is not None else 0,
                        s["subject_name"].lower(),
                    )
                )
            else:
                subjects.sort(key=lambda s: s["subject_name"].lower())
        else:
            subjects = []

        return {
            "grades": grades,
            "classes": classes,
            "subjects": subjects,
            "terms": terms,
        }

    # Admin: all available options in the system (or scoped by class_id/academic_period_id)
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

    # Subjects for Admin
    if class_id is not None:
        subj_load_query = db.query(SubjectLoad.subject_id).filter(
            SubjectLoad.class_id == class_id,
            SubjectLoad.status.in_(["active", "published", "draft"]),
            SubjectLoad.is_active_version == True,
        )
        if academic_period_id is not None:
            subj_load_query = subj_load_query.filter(SubjectLoad.academic_period_id == academic_period_id)
        allowed_subject_ids = {row[0] for row in subj_load_query.distinct().all()}

        slot_map: dict[int, int] = {}
        if academic_period_id is not None and allowed_subject_ids:
            slot_rows = (
                db.query(
                    SubjectLoad.subject_id,
                    PeriodTemplateSlot.display_order,
                )
                .join(PeriodTemplateSlot, SubjectLoad.slot_id == PeriodTemplateSlot.slot_id)
                .filter(
                    SubjectLoad.class_id == class_id,
                    SubjectLoad.academic_period_id == academic_period_id,
                    SubjectLoad.status == "published",
                    SubjectLoad.is_active_version == True,
                    SubjectLoad.subject_id.in_(allowed_subject_ids),
                )
                .all()
            )
            for subj_id, display_order in slot_rows:
                if subj_id not in slot_map or display_order < slot_map[subj_id]:
                    slot_map[subj_id] = display_order

        if allowed_subject_ids:
            subject_rows = db.query(Subject).filter(Subject.subject_id.in_(allowed_subject_ids)).all()
            subjects = [
                {
                    "subject_id": s.subject_id,
                    "subject_name": s.subject_name,
                    "subject_codename": s.subject_codename,
                    "period_index": slot_map.get(s.subject_id) if academic_period_id is not None else None,
                }
                for s in subject_rows
            ]
            if academic_period_id is not None:
                subjects.sort(
                    key=lambda s: (
                        0 if s["period_index"] is not None else 1,
                        s["period_index"] if s["period_index"] is not None else 0,
                        s["subject_name"].lower(),
                    )
                )
            else:
                subjects.sort(key=lambda s: s["subject_name"].lower())
        else:
            subjects = []
    else:
        # Backward compatibility when class_id is None
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
                "period_index": None,
            }
            for s in subject_rows
        ]
        subjects.sort(key=lambda s: s["subject_name"].lower())

    return {
        "grades": grades,
        "classes": classes,
        "subjects": subjects,
        "terms": terms,
    }

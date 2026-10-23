from __future__ import annotations

from typing import Any
from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicLevel import AcademicLevel
from app.services.prediction.TeacherAssignmentResolver import get_teacher_assigned_triplets


def get_teacher_academic_scope(
    db: Session,
    staff_id: str | None,
    class_id: int | None = None,
    academic_period_id: int | None = None,
    reject_unassigned_class: bool = True,
) -> dict[str, Any]:
    """Resolves authorized academic scope (grades, classes, subjects, terms) for an authenticated teacher.

    Derives scope strictly from active/published SubjectLoads and active TeacherSubstitutions.
    """
    if not staff_id:
        if class_id is not None and reject_unassigned_class:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to view this class scope.",
            )
        return {"grades": [], "classes": [], "subjects": [], "terms": []}

    all_assigned_triplets = get_teacher_assigned_triplets(db, staff_id, academic_period_id=None)
    if not all_assigned_triplets:
        if class_id is not None and reject_unassigned_class:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to view this class scope.",
            )
        return {"grades": [], "classes": [], "subjects": [], "terms": []}

    allowed_class_ids = {t[0] for t in all_assigned_triplets}
    allowed_period_ids = {t[2] for t in all_assigned_triplets}

    if class_id is not None and class_id not in allowed_class_ids:
        if reject_unassigned_class:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not have access to view this class scope.",
            )
        allowed_subject_ids: set[int] = set()
    else:
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
            if academic_period_id is not None:
                scoped_triplets = get_teacher_assigned_triplets(
                    db, staff_id, academic_period_id=academic_period_id
                )
                allowed_subject_ids = {t[1] for t in scoped_triplets}
            else:
                allowed_subject_ids = {t[1] for t in all_assigned_triplets}

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

from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Subject import Subject
from app.models.academic.GradingTemplate import GradingTemplate
from app.services.subjects.SubjectShared import (
    ALLOWED_SUBJECT_STATUSES,
    DEFAULT_SUBJECT_STATUS,
    normalize_optional_text,
    normalize_subject_status,
    subject_to_item,
)


def _assignment_lock_reasons(db: Session, subject_ids: list[int]) -> dict[int, str]:
    if not subject_ids:
        return {}
    from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
    from app.models.classwork.Classwork import Classwork
    from app.models.classwork.ClassworkAssignment import ClassworkAssignment
    from app.models.submissions.StudentSubmission import StudentSubmission

    period_grade_ids = {
        subject_id for subject_id, in db.query(StudentPeriodGrade.subject_id)
        .filter(StudentPeriodGrade.subject_id.in_(subject_ids)).distinct().all()
    }
    graded_classwork_ids = {
        subject_id for subject_id, in db.query(Classwork.subject_id)
        .join(ClassworkAssignment, ClassworkAssignment.classwork_id == Classwork.classwork_id)
        .join(StudentSubmission, StudentSubmission.classwork_assignment_id == ClassworkAssignment.classwork_assignment_id)
        .filter(Classwork.subject_id.in_(subject_ids), StudentSubmission.grade.isnot(None)).distinct().all()
    }
    reasons = {
        subject_id: "Recorded period grades prevent changing this subject's grading template."
        for subject_id in period_grade_ids
    }
    for subject_id in graded_classwork_ids:
        reasons.setdefault(subject_id, "Graded classwork prevents changing this subject's grading template.")
    return reasons


def get_subject_form_options_data(db: Session) -> dict:
    academic_levels = (
        db.query(AcademicLevel)
        .order_by(AcademicLevel.grade_level, func.lower(AcademicLevel.level_name))
        .all()
    )
    active_templates = (
        db.query(GradingTemplate)
        .filter(GradingTemplate.status == "active")
        .order_by(GradingTemplate.template_name)
        .all()
    )
    return {
        "academic_levels": [
            {
                "academic_level_id": level.academic_level_id,
                "level_name": level.level_name,
                "grade_level": level.grade_level,
            }
            for level in academic_levels
        ],
        "statuses": ALLOWED_SUBJECT_STATUSES,
        "default_status": DEFAULT_SUBJECT_STATUS,
        "grading_templates": [t.template_name for t in active_templates],
        "grading_template_details": [{
            "grading_template_id": t.grading_template_id,
            "template_name": t.template_name,
            "passing_threshold": float(t.passing_threshold),
            "components": [{"component_name": c.component_name, "weight": float(c.weight)} for c in t.components],
        } for t in active_templates],
    }


def list_subjects_data(
    db: Session,
    status: str | None = None,
    academic_level_id: int | None = None,
    grading_template_id: int | None = None,
    search: str = "",
) -> dict:
    query = db.query(Subject, AcademicLevel).join(
        AcademicLevel,
        Subject.academic_level_id == AcademicLevel.academic_level_id,
    )
    all_rows = query.all()

    if status is not None:
        query = query.filter(func.lower(func.coalesce(Subject.status, DEFAULT_SUBJECT_STATUS)) == normalize_subject_status(status))
    if academic_level_id is not None:
        query = query.filter(Subject.academic_level_id == academic_level_id)
    if grading_template_id is not None:
        query = query.filter(Subject.grading_template_id == grading_template_id)
    search_term = normalize_optional_text(search)
    if search_term is not None:
        like_term = f"%{search_term.casefold()}%"
        query = query.filter(
            or_(
                func.lower(Subject.subject_name).like(like_term),
                func.lower(func.coalesce(Subject.subject_codename, "")).like(like_term),
            )
        )

    rows = (
        query
        .order_by(AcademicLevel.grade_level, func.lower(Subject.subject_name), func.lower(func.coalesce(Subject.subject_codename, "")))
        .all()
    )
    active_subjects = sum(1 for subject, _ in all_rows if (subject.status or DEFAULT_SUBJECT_STATUS).casefold() == "active")
    archived_subjects = sum(1 for subject, _ in all_rows if (subject.status or "").casefold() == "archived")
    from app.models.academic.GradingTemplate import GradingTemplate
    templates = db.query(GradingTemplate).all()
    template_name_map = {str(t.grading_template_id): t.template_name for t in templates}
    lock_reasons = _assignment_lock_reasons(db, [subject.subject_id for subject, _ in rows])

    return {
        "summary": {
            "total_subjects": len(all_rows),
            "active_subjects": active_subjects,
            "archived_subjects": archived_subjects,
        },
        "subjects": [
            subject_to_item(subject, level, template_name_map, lock_reasons.get(subject.subject_id))
            for subject, level in rows
        ],
    }


def get_subject_detail_data(db: Session, subject_id: int) -> dict:
    row = (
        db.query(Subject, AcademicLevel)
        .join(AcademicLevel, Subject.academic_level_id == AcademicLevel.academic_level_id)
        .filter(Subject.subject_id == subject_id)
        .first()
    )
    if row is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Subject not found.")
    subject, academic_level = row
    from app.models.academic.GradingTemplate import GradingTemplate
    templates = db.query(GradingTemplate).all()
    template_name_map = {str(t.grading_template_id): t.template_name for t in templates}
    lock_reason = _assignment_lock_reasons(db, [subject.subject_id]).get(subject.subject_id)
    return subject_to_item(subject, academic_level, template_name_map, lock_reason)

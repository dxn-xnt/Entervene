from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AssessmentItem import AssessmentItem
from app.models.academic.Class_ import Class
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.GradeSubmissionLog import GradeSubmissionLog
from app.models.academic.Subject import Subject
from app.models.academic.SubjectYearGradingTemplate import SubjectYearGradingTemplate
from app.models.academic.SubjectPeriodGradingTemplate import SubjectPeriodGradingTemplate
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment


LOCK_REASON = (
    "The grading template is locked because classwork, submissions, or grades "
    "already exist for this subject in the selected academic year."
)


def resolve_subject_year_template(
    db: Session, subject: Subject, academic_year_id: int
) -> tuple[GradingTemplate, bool, str | None]:
    template = get_subject_year_template(db, subject, academic_year_id)
    locked = subject_year_template_is_locked(db, subject.subject_id, academic_year_id)
    return template, locked, LOCK_REASON if locked else None


def get_subject_year_template(
    db: Session, subject: Subject, academic_year_id: int, academic_period_id: int | None = None
) -> GradingTemplate:
    if academic_period_id is not None:
        override = db.query(SubjectPeriodGradingTemplate).filter(
            SubjectPeriodGradingTemplate.subject_id == subject.subject_id,
            SubjectPeriodGradingTemplate.academic_period_id == academic_period_id,
        ).first()
        if override is not None:
            period = db.get(AcademicPeriod, academic_period_id)
            if period is None or period.academic_year_id != academic_year_id:
                raise HTTPException(status_code=422, detail="Academic period does not belong to the selected academic year.")
            return override.grading_template
    assignment = (
        db.query(SubjectYearGradingTemplate)
        .filter(
            SubjectYearGradingTemplate.subject_id == subject.subject_id,
            SubjectYearGradingTemplate.academic_year_id == academic_year_id,
        )
        .first()
    )
    return assignment.grading_template if assignment else subject.grading_template


def subject_year_template_is_locked(
    db: Session, subject_id: int, academic_year_id: int
) -> bool:
    classwork_exists = (
        db.query(ClassworkAssignment.classwork_assignment_id)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .outerjoin(
            AcademicPeriod,
            AcademicPeriod.academic_period_id == ClassworkAssignment.academic_period_id,
        )
        .outerjoin(Class, Class.class_id == ClassworkAssignment.class_id)
        .filter(
            Classwork.subject_id == subject_id,
            or_(
                AcademicPeriod.academic_year_id == academic_year_id,
                and_(
                    ClassworkAssignment.academic_period_id.is_(None),
                    Class.academic_year_id == academic_year_id,
                ),
            ),
        )
        .first()
        is not None
    )
    if classwork_exists:
        return True

    period_grade_exists = (
        db.query(StudentPeriodGrade.period_grade_id)
        .join(
            AcademicPeriod,
            AcademicPeriod.academic_period_id == StudentPeriodGrade.academic_period_id,
        )
        .filter(
            StudentPeriodGrade.subject_id == subject_id,
            AcademicPeriod.academic_year_id == academic_year_id,
        )
        .first()
        is not None
    )
    if period_grade_exists:
        return True

    submission_log_exists = (
        db.query(GradeSubmissionLog.id)
        .join(
            AcademicPeriod,
            AcademicPeriod.academic_period_id == GradeSubmissionLog.academic_period_id,
        )
        .filter(
            GradeSubmissionLog.subject_id == subject_id,
            AcademicPeriod.academic_year_id == academic_year_id,
        )
        .first()
        is not None
    )
    if submission_log_exists:
        return True

    return (
        db.query(AssessmentItem.assessment_id)
        .join(
            AcademicPeriod,
            AcademicPeriod.academic_period_id == AssessmentItem.academic_period_id,
        )
        .filter(
            AssessmentItem.subject_id == subject_id,
            AcademicPeriod.academic_year_id == academic_year_id,
        )
        .first()
        is not None
    )


def set_subject_year_template(
    db: Session,
    *,
    subject: Subject,
    academic_year_id: int,
    grading_template_id: int,
) -> None:
    current_template, locked, _reason = resolve_subject_year_template(
        db, subject, academic_year_id
    )
    if current_template.grading_template_id == grading_template_id:
        return
    if locked:
        raise HTTPException(status_code=409, detail=LOCK_REASON)

    template = (
        db.query(GradingTemplate)
        .filter(GradingTemplate.grading_template_id == grading_template_id)
        .first()
    )
    if template is None:
        raise HTTPException(status_code=404, detail="Grading template not found.")
    if (template.status or "active").casefold() != "active":
        raise HTTPException(status_code=422, detail="Select an active grading template.")

    assignment = (
        db.query(SubjectYearGradingTemplate)
        .filter(
            SubjectYearGradingTemplate.subject_id == subject.subject_id,
            SubjectYearGradingTemplate.academic_year_id == academic_year_id,
        )
        .first()
    )
    if assignment is None:
        assignment = SubjectYearGradingTemplate(
            subject_id=subject.subject_id,
            academic_year_id=academic_year_id,
            grading_template_id=grading_template_id,
        )
        db.add(assignment)
    else:
        assignment.grading_template_id = grading_template_id


def _period_evidence_counts(db: Session, subject_id: int, academic_period_id: int) -> dict[str, int]:
    classwork = db.query(ClassworkAssignment.classwork_assignment_id).join(
        Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id
    ).filter(
        Classwork.subject_id == subject_id,
        ClassworkAssignment.academic_period_id == academic_period_id,
    ).count()
    grades = db.query(StudentPeriodGrade.period_grade_id).filter(
        StudentPeriodGrade.subject_id == subject_id,
        StudentPeriodGrade.academic_period_id == academic_period_id,
    ).count()
    assessments = db.query(AssessmentItem.assessment_id).filter(
        AssessmentItem.subject_id == subject_id,
        AssessmentItem.academic_period_id == academic_period_id,
    ).count()
    logs = db.query(GradeSubmissionLog.id).filter(
        GradeSubmissionLog.subject_id == subject_id,
        GradeSubmissionLog.academic_period_id == academic_period_id,
    ).count()
    return {"classwork": classwork, "period_grades": grades, "assessments": assessments, "submission_logs": logs}


def set_subject_period_template(
    db: Session, *, subject: Subject, academic_period_id: int,
    grading_template_id: int, policy_reference: str | None, change_reason: str,
) -> None:
    period = db.get(AcademicPeriod, academic_period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Academic period not found.")
    current = get_subject_year_template(db, subject, period.academic_year_id, academic_period_id)
    if current.grading_template_id == grading_template_id:
        return
    counts = _period_evidence_counts(db, subject.subject_id, academic_period_id)
    if any(counts.values()):
        raise HTTPException(status_code=409, detail={
            "code": "GRADING_POLICY_EVIDENCE_CONFLICT",
            "message": "Recorded evidence prevents an unaudited term policy change.",
            "affected_counts": counts,
        })
    target = db.get(GradingTemplate, grading_template_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Grading template not found.")
    if target.status not in {"active", "draft"}:
        raise HTTPException(status_code=422, detail="Select an available grading template revision.")
    assignment = db.query(SubjectPeriodGradingTemplate).filter(
        SubjectPeriodGradingTemplate.subject_id == subject.subject_id,
        SubjectPeriodGradingTemplate.academic_period_id == academic_period_id,
    ).first()
    if assignment is None:
        assignment = SubjectPeriodGradingTemplate(
            subject_id=subject.subject_id, academic_period_id=academic_period_id,
            grading_template_id=grading_template_id,
            policy_reference=policy_reference, change_reason=change_reason,
        )
        db.add(assignment)
    else:
        assignment.grading_template_id = grading_template_id
        assignment.policy_reference = policy_reference
        assignment.change_reason = change_reason

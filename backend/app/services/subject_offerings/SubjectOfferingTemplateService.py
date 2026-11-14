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
    db: Session, subject: Subject, academic_year_id: int
) -> GradingTemplate:
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

"""Persistence foundation for intervention-specific Reading reviews."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationReadingPrerequisite import (
    RemediationReadingPrerequisite,
)
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionReadingReview import (
    InterventionReadingReview,
)
from app.models.people.Student import Student
from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
from app.services.classwork.ClassworkAccessService import assignment_allows_student
from app.services.classwork.ClassworkShared import (
    assignment_is_available,
    assignment_is_locked,
    is_reading_type,
)


def _owned_intervention(
    db: Session,
    *,
    intervention_id: int,
    student: Student,
) -> Intervention:
    intervention = db.query(Intervention).filter(
        Intervention.intervention_id == intervention_id,
        Intervention.student_id == student.student_id,
    ).one_or_none()
    if intervention is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    return intervention


def intervention_reading_reviews(
    db: Session,
    *,
    intervention_id: int,
    student: Student,
) -> list[InterventionReadingReview]:
    """Return only the authenticated student's reviews for one intervention."""
    _owned_intervention(db, intervention_id=intervention_id, student=student)
    return db.query(InterventionReadingReview).filter_by(
        intervention_id=intervention_id,
        student_id=student.student_id,
    ).order_by(
        InterventionReadingReview.acknowledged_at,
        InterventionReadingReview.review_id,
    ).all()


def _require_snapshot_membership(
    db: Session,
    *,
    intervention_id: int,
    reading_assignment_id: int,
    student: Student,
) -> None:
    membership = db.query(RemediationReadingPrerequisite).join(
        ClassworkAssignment,
        ClassworkAssignment.classwork_assignment_id
        == RemediationReadingPrerequisite.remediation_assignment_id,
    ).filter(
        ClassworkAssignment.source_intervention_id == intervention_id,
        ClassworkAssignment.recipient_student_id == student.student_id,
        ClassworkAssignment.is_published.is_(True),
        RemediationReadingPrerequisite.reading_assignment_id
        == reading_assignment_id,
    ).first()
    if membership is None:
        raise HTTPException(
            status_code=404,
            detail="Reading is not required by a published remediation activity for this intervention",
        )

    intervention = db.get(Intervention, intervention_id)
    remediation_assignment = db.get(
        ClassworkAssignment,
        membership.remediation_assignment_id,
    )
    reading_assignment = db.get(ClassworkAssignment, membership.reading_assignment_id)
    remediation_work = (
        db.get(Classwork, remediation_assignment.classwork_id)
        if remediation_assignment is not None
        else None
    )
    reading_work = (
        db.get(Classwork, membership.reading_classwork_id)
        if reading_assignment is not None
        else None
    )
    valid_scope = bool(
        intervention is not None
        and remediation_assignment is not None
        and remediation_work is not None
        and reading_assignment is not None
        and reading_work is not None
        and remediation_assignment.class_id == intervention.class_id
        and remediation_assignment.academic_period_id == intervention.academic_period_id
        and remediation_work.subject_id == intervention.subject_id
        and remediation_work.is_published
        and not remediation_work.is_archived
        and assignment_is_available(remediation_assignment)
        and not assignment_is_locked(remediation_assignment)
        and assignment_allows_student(remediation_assignment, student.student_id)
        and reading_assignment.classwork_id == membership.reading_classwork_id
        and reading_assignment.class_id == intervention.class_id
        and reading_assignment.academic_period_id == intervention.academic_period_id
        and reading_work.subject_id == intervention.subject_id
        and is_reading_type(reading_work.classwork_type)
        and not reading_work.is_graded
        and reading_work.is_published
        and not reading_work.is_archived
        and reading_assignment.is_published
        and assignment_is_available(reading_assignment)
        and not assignment_is_locked(reading_assignment)
        and assignment_allows_student(reading_assignment, student.student_id)
    )
    if not valid_scope:
        raise HTTPException(
            status_code=404,
            detail="Reading is outside the intervention academic scope",
        )


def _assert_review_context_writable(
    db: Session,
    *,
    intervention: Intervention,
    student: Student,
) -> None:
    class_ = db.get(Class, intervention.class_id)
    period = db.get(AcademicPeriod, intervention.academic_period_id)
    if class_ is None or period is None or class_.academic_year_id != period.academic_year_id:
        raise HTTPException(status_code=403, detail="Intervention academic context is invalid")

    SubjectLoadAuthorizationService.assert_context_writable(
        db,
        class_id=intervention.class_id,
        academic_period_id=intervention.academic_period_id,
        block_future_period_in_current_year=True,
    )

    if not period.is_active:
        raise HTTPException(
            status_code=403,
            detail="Reading reviews require the active grading period",
        )

    enrolled = db.query(StudentClass.student_class_id).filter(
        StudentClass.student_id == student.student_id,
        StudentClass.class_id == intervention.class_id,
        StudentClass.academic_year_id == period.academic_year_id,
        StudentClass.enrollment_status == "enrolled",
    ).first()
    if enrolled is None:
        raise HTTPException(
            status_code=403,
            detail="Not enrolled in this class for this academic year",
        )

    finalized = db.query(StudentPeriodGrade.period_grade_id).filter(
        StudentPeriodGrade.student_id == student.student_id,
        StudentPeriodGrade.class_id == intervention.class_id,
        StudentPeriodGrade.subject_id == intervention.subject_id,
        StudentPeriodGrade.academic_period_id == intervention.academic_period_id,
        StudentPeriodGrade.is_finalized.is_(True),
    ).first()
    if finalized is not None:
        raise HTTPException(status_code=409, detail="The period grade is finalized")


def acknowledge_intervention_reading_review(
    db: Session,
    *,
    intervention_id: int,
    reading_assignment_id: int,
    student: Student,
) -> InterventionReadingReview:
    """Persist one review acknowledgment, returning the original row on retries."""
    intervention = _owned_intervention(
        db,
        intervention_id=intervention_id,
        student=student,
    )
    if intervention.status != "ACTIVE":
        raise HTTPException(
            status_code=400,
            detail="Reading reviews require an active intervention",
        )
    _assert_review_context_writable(db, intervention=intervention, student=student)

    _require_snapshot_membership(
        db,
        intervention_id=intervention_id,
        reading_assignment_id=reading_assignment_id,
        student=student,
    )

    existing = db.scalar(select(InterventionReadingReview).where(
        InterventionReadingReview.intervention_id == intervention_id,
        InterventionReadingReview.reading_assignment_id == reading_assignment_id,
    ))
    if existing is not None:
        return existing

    values = {
        "intervention_id": intervention_id,
        "reading_assignment_id": reading_assignment_id,
        "student_id": student.student_id,
    }
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        statement = postgresql_insert(InterventionReadingReview)
    elif dialect == "sqlite":
        statement = sqlite_insert(InterventionReadingReview)
    else:
        raise RuntimeError(
            f"Intervention Reading review persistence does not support {dialect}"
        )
    review_id = db.execute(
        statement.values(**values).on_conflict_do_nothing(
            index_elements=["intervention_id", "reading_assignment_id"],
        ).returning(InterventionReadingReview.review_id)
    ).scalar_one_or_none()
    db.commit()

    if review_id is not None:
        review = db.get(InterventionReadingReview, review_id)
    else:
        review = db.scalar(select(InterventionReadingReview).where(
            InterventionReadingReview.intervention_id == intervention_id,
            InterventionReadingReview.reading_assignment_id == reading_assignment_id,
        ))
    if review is None:
        raise RuntimeError("Intervention Reading review was not persisted")
    return review

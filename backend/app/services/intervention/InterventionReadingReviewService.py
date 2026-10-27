"""Persistence foundation for intervention-specific Reading reviews."""

from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationReadingPrerequisite import (
    RemediationReadingPrerequisite,
)
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionReadingReview import (
    InterventionReadingReview,
)
from app.models.people.Student import Student


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
    membership = db.query(RemediationReadingPrerequisite.prerequisite_id).join(
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
    enrolled = db.query(StudentClass.student_class_id).filter_by(
        student_id=student.student_id,
        class_id=intervention.class_id,
        enrollment_status="enrolled",
    ).first()
    if enrolled is None:
        raise HTTPException(status_code=403, detail="Not enrolled in this class")

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

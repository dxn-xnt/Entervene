"""Read only teacher-sent reviewers for the exact Intervention student."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionSupportMaterial import InterventionSupportMaterial
from app.schemas.StudentInterventionReviewer import (
    StudentReviewerDetail, StudentReviewerList, StudentReviewerSummary,
)


def _query(db: Session, student_id):
    return db.query(InterventionSupportMaterial, Intervention).join(
        Intervention, InterventionSupportMaterial.intervention_id == Intervention.intervention_id,
    ).filter(
        Intervention.student_id == student_id,
        Intervention.status.in_(("ACTIVE", "RESOLVED")),
        InterventionSupportMaterial.kind == "STUDENT_REVIEWER",
        InterventionSupportMaterial.status == "SENT",
        InterventionSupportMaterial.sent_at.is_not(None),
    )


def list_student_reviewers(db: Session, student_id) -> StudentReviewerList:
    rows = _query(db, student_id).order_by(InterventionSupportMaterial.sent_at.desc()).all()
    items = [StudentReviewerSummary(
        material_id=material.material_id, subject_name=intervention.subject.subject_name,
        title=material.current_content["title"], sent_at=material.sent_at,
    ) for material, intervention in rows]
    return StudentReviewerList(items=items, total=len(items))


def get_student_reviewer(db: Session, student_id, material_id: int) -> StudentReviewerDetail:
    result = _query(db, student_id).filter(InterventionSupportMaterial.material_id == material_id).one_or_none()
    if result is None:
        raise HTTPException(status_code=404, detail="Reviewer not found")
    material, intervention = result
    content = material.current_content
    return StudentReviewerDetail(
        material_id=material.material_id, subject_name=intervention.subject.subject_name,
        title=content["title"], introduction=content["introduction"], body=content["body"],
        sent_at=material.sent_at,
    )

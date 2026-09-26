"""Approve and deliver one immutable reviewer to its Intervention student."""

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.orm import Session

from app.models.auth.UserAccount import UserAccount
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionSupportMaterial import InterventionSupportMaterial
from app.schemas.InterventionSupportMaterial import MaterialRead, ReviewerContent
from app.schemas.Notification import NotificationCreate
from app.services.NotificationService import stage_notification
from app.services.intervention.InterventionSupportMaterialService import _basis, _read
from app.services.intervention.TeacherInterventionService import _eligible_scope, _source


def send_reviewer(db: Session, staff_id: str, intervention_id: int, material_id: int) -> MaterialRead:
    # Lock order matches draft generation: Intervention, then material. A second
    # request sees SENT after the first transaction commits and stages no alert.
    intervention = db.query(Intervention).filter_by(
        intervention_id=intervention_id,
    ).populate_existing().with_for_update().one_or_none()
    if intervention is None or not _eligible_scope(db, staff_id, intervention):
        raise HTTPException(status_code=404, detail="Reviewer not found")
    material = db.query(InterventionSupportMaterial).filter_by(
        intervention_id=intervention_id, material_id=material_id,
    ).populate_existing().with_for_update().one_or_none()
    if material is None:
        raise HTTPException(status_code=404, detail="Reviewer not found")
    if intervention.status != "ACTIVE" or material.status != "DRAFT":
        raise HTTPException(status_code=409, detail="Reviewer is not an editable active draft")
    if material.kind != "STUDENT_REVIEWER":
        raise HTTPException(status_code=409, detail="Only a student reviewer can be sent")
    if material.evidence_basis != _basis(intervention):
        raise HTTPException(status_code=409, detail="Reviewer evidence basis no longer matches")
    source = _source(db, intervention)
    if source.prediction_id != material.evidence_basis.get("source_prediction_id"):
        raise HTTPException(status_code=409, detail="Reviewer source prediction does not match")
    try:
        content = ReviewerContent.model_validate(material.current_content)
    except ValidationError:
        raise HTTPException(status_code=409, detail="Reviewer content is invalid") from None
    if not all((content.title.strip(), content.introduction.strip(), content.body.strip())):
        raise HTTPException(status_code=409, detail="Complete the reviewer before sending")
    student_user_id = intervention.student.user_id
    account = db.get(UserAccount, student_user_id) if student_user_id else None
    if account is None or account.account_status != "active":
        raise HTTPException(status_code=409, detail="Student account is unavailable for delivery")

    try:
        material.status = "SENT"
        material.sent_at = datetime.now(timezone.utc)
        material.sent_by_staff_id = staff_id
        stage_notification(db, NotificationCreate(
            user_id=student_user_id,
            notification_type="intervention_reviewer_available",
            title="A reviewer is ready for you",
            body=f"Your teacher prepared a {intervention.subject.subject_name} reviewer to support your study.",
            action_url=f"/student/interventions?reviewer={material.material_id}",
        ))
        db.commit()
    except BaseException:
        db.rollback()
        raise
    db.refresh(material)
    return _read(material)

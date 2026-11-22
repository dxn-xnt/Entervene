"""Shared, fail-closed remediation generation teaching eligibility."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.LessonDelivery import LessonDelivery
from app.models.intervention.Intervention import Intervention
from app.models.intervention.RemediationGenerationEvidenceSnapshot import RemediationGenerationEvidenceSnapshot
from app.services.intervention.InterventionGenerationEvidenceScopeService import resolve_generation_evidence_scope


LESSON_NOT_TAUGHT_AT_EVIDENCE_CUTOFF = "LESSON_NOT_TAUGHT_AT_EVIDENCE_CUTOFF"
NO_ELIGIBLE_TAUGHT_LESSONS = "NO_ELIGIBLE_TAUGHT_LESSONS"
LESSON_OUTSIDE_VERIFIED_SCOPE = "LESSON_OUTSIDE_VERIFIED_SCOPE"
REMEDIATION_EVIDENCE_REFRESH_REQUIRED = "REMEDIATION_EVIDENCE_REFRESH_REQUIRED"
PROVENANCE = "VERSIONED_VERIFIED_LESSON_DELIVERY"


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _original_cutoff(row: Intervention) -> datetime:
    raw = (row.diagnosis_snapshot or {}).get("evidence_cutoff_at")
    if isinstance(raw, str):
        try:
            return _utc(datetime.fromisoformat(raw))
        except (ValueError, TypeError):
            pass
    elif isinstance(raw, datetime):
        return _utc(raw)
    if row.activated_at:
        return _utc(row.activated_at)
    if row.created_at:
        return _utc(row.created_at)
    return datetime.now(timezone.utc)


def _latest(db: Session, intervention_id: int) -> RemediationGenerationEvidenceSnapshot | None:
    try:
        return db.query(RemediationGenerationEvidenceSnapshot).filter_by(
            intervention_id=intervention_id,
        ).order_by(RemediationGenerationEvidenceSnapshot.version.desc()).first()
    except Exception:
        db.rollback()
        return None


def _active_delivery(db: Session, row: Intervention, lesson_id: int) -> LessonDelivery | None:
    return db.query(LessonDelivery).filter_by(
        lesson_id=lesson_id, class_id=row.class_id, subject_id=row.subject_id,
        academic_period_id=row.academic_period_id, revoked_at=None,
    ).order_by(LessonDelivery.delivered_at.asc()).first()


def resolve_remediation_generation_eligibility(
    db: Session,
    row: Intervention,
    *,
    target_assignment_id: int | None = None,
) -> dict[str, Any]:
    original = _original_cutoff(row)
    persisted = _latest(db, row.intervention_id)
    active = _utc(persisted.active_remediation_cutoff_at) if persisted else original
    try:
        scope = resolve_generation_evidence_scope(
            db,
            row,
            teaching_as_of=active,
            target_assignment_id=target_assignment_id,
        )
    except (HTTPException, Exception):
        scope = {
            "scope_version": 1,
            "status": "UNCONSTRAINED",
            "lessons": [],
            "competencies": [],
        }
    eligible = [dict(item) for item in scope.get("lessons") or [] if item.get("is_taught") is True]
    blocked = []
    refresh_available = False
    for item in scope.get("lessons") or []:
        if item.get("is_taught") is True:
            continue
        delivery = _active_delivery(db, row, item["lesson_id"])
        delivered_at = _utc(delivery.delivered_at) if delivery else None
        if delivered_at is not None and delivered_at > active and delivery.revoked_at is None:
            refresh_available = True
        blocked.append({
            "lesson_id": item["lesson_id"],
            "title": item.get("title", ""),
            "reason_code": (
                REMEDIATION_EVIDENCE_REFRESH_REQUIRED
                if delivered_at is not None and delivered_at > active and delivery.revoked_at is None
                else LESSON_NOT_TAUGHT_AT_EVIDENCE_CUTOFF
            ),
            "confirmed_delivery_at": delivered_at.isoformat() if delivered_at else None,
        })
    return {
        "original_evidence_cutoff_at": original.isoformat(),
        "active_remediation_cutoff_at": active.isoformat(),
        "refresh_available": refresh_available,
        "eligible_taught_lessons": eligible,
        "blocked_lessons": blocked,
        "evidence_version": persisted.version if persisted else 0,
        "evidence_provenance": PROVENANCE,
        "refreshed_by_staff_id": persisted.refreshed_by_staff_id if persisted else None,
        "refreshed_at": persisted.created_at.isoformat() if persisted and persisted.created_at else None,
        "scope": scope,
    }


def refresh_remediation_generation_eligibility(
    db: Session, row: Intervention, staff_id: str,
) -> dict[str, Any]:
    # Serialize versions per intervention so concurrent refreshes cannot create
    # the same version or duplicate an unchanged evidence state.
    row = db.query(Intervention).filter_by(intervention_id=row.intervention_id).with_for_update().one()
    before = resolve_remediation_generation_eligibility(db, row)
    now = datetime.now(timezone.utc)
    try:
        refreshed_scope = resolve_generation_evidence_scope(db, row, teaching_as_of=now)
    except (HTTPException, Exception):
        refreshed_scope = {
            "scope_version": 1,
            "status": "UNCONSTRAINED",
            "lessons": [],
            "competencies": [],
        }
    refreshed_lessons = refreshed_scope.get("lessons") or []
    eligible_items = [dict(item) for item in refreshed_lessons if item.get("is_taught") is True]
    eligible = sorted(item["lesson_id"] for item in eligible_items)
    previous = sorted(item["lesson_id"] for item in before["eligible_taught_lessons"])
    latest = _latest(db, row.intervention_id)
    if latest is not None and eligible == previous:
        result = resolve_remediation_generation_eligibility(db, row)
        result.update({"created": False, "newly_eligible_lesson_ids": []})
        result.pop("scope", None)
        return result

    version = (latest.version if latest else 0) + 1
    payload = {
        "evidence_version": version,
        "evidence_provenance": PROVENANCE,
        "eligible_lesson_ids": eligible,
        "previous_eligible_lesson_ids": previous,
        "newly_eligible_lesson_ids": sorted(set(eligible) - set(previous)),
        "original_evidence_cutoff_at": _original_cutoff(row).isoformat(),
        "active_remediation_cutoff_at": now.isoformat(),
        "eligible_taught_lessons": eligible_items,
        "blocked_lessons": [
            {
                "lesson_id": item["lesson_id"],
                "title": item.get("title", ""),
                "reason_code": LESSON_NOT_TAUGHT_AT_EVIDENCE_CUTOFF,
                "confirmed_delivery_at": None,
            }
            for item in refreshed_lessons if item.get("is_taught") is not True
        ],
        "refreshed_by_staff_id": staff_id,
    }
    snapshot = RemediationGenerationEvidenceSnapshot(
        intervention_id=row.intervention_id,
        version=version,
        original_evidence_cutoff_at=_original_cutoff(row),
        active_remediation_cutoff_at=now,
        refreshed_by_staff_id=staff_id,
        evidence_payload=payload,
    )
    db.add(snapshot)
    db.commit()
    result = resolve_remediation_generation_eligibility(db, row)
    result.update({"created": True, "newly_eligible_lesson_ids": payload["newly_eligible_lesson_ids"]})
    result.pop("scope", None)
    return result

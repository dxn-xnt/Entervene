"""Private teacher draft storage anchored to frozen Intervention evidence."""

from __future__ import annotations

import hashlib
import json

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionSupportMaterial import InterventionSupportMaterial
from app.schemas.InterventionSupportMaterial import (
    MaterialList, MaterialRead, MaterialUpdate, RemedialContent, ReviewerContent,
)
from app.services.intervention.TeacherInterventionService import _eligible_scope


def _intervention(db: Session, staff_id: str, intervention_id: int, *, editable: bool) -> Intervention:
    row = db.get(Intervention, intervention_id)
    if row is None or not _eligible_scope(db, staff_id, row):
        raise HTTPException(status_code=404, detail="Support material not found")
    if row.status == "CANDIDATE":
        raise HTTPException(status_code=409, detail="Support material requires an active intervention")
    if editable and row.status != "ACTIVE":
        raise HTTPException(status_code=409, detail="Resolved intervention materials are read-only")
    return row


def _material(db: Session, intervention_id: int, material_id: int) -> InterventionSupportMaterial:
    row = db.query(InterventionSupportMaterial).filter_by(
        intervention_id=intervention_id, material_id=material_id,
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Support material not found")
    return row


def _read(row: InterventionSupportMaterial) -> MaterialRead:
    return MaterialRead.model_validate({key: getattr(row, key) for key in MaterialRead.model_fields})


def _basis(row: Intervention) -> dict:
    diagnosis = row.diagnosis_snapshot
    if not isinstance(diagnosis, dict):
        raise HTTPException(status_code=409, detail="Frozen intervention diagnosis is unavailable")
    canonical = json.dumps(diagnosis, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    scored = diagnosis.get("lowest_supported_competencies") or []
    return {
        "version": 1,
        "source_prediction_id": row.source_prediction_id,
        "diagnosis_sha256": hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        "evidence_cutoff_at": diagnosis.get("evidence_cutoff_at"),
        "weakest_supported_components": diagnosis.get("weakest_supported_components") or [],
        "has_question_scored_evidence": any(
            score.get("source_type") == "QUIZ_QUESTION"
            for item in scored for score in item.get("supporting_scores", [])
        ),
        "has_scored_competency_evidence": bool(scored),
        "has_manual_coverage_context": bool(diagnosis.get("manual_assessment_coverage")),
        "reference": "intervention.diagnosis_snapshot",
    }


def _validate_provenance(content: RemedialContent, diagnosis: dict) -> None:
    scored = diagnosis.get("lowest_supported_competencies") or []
    scores = [score for item in scored for score in item.get("supporting_scores", [])]
    coverage = diagnosis.get("manual_assessment_coverage") or []
    weak = set(diagnosis.get("weakest_supported_components") or [])
    for question in content.questions:
        source = question.provenance
        if source is None:
            continue
        valid = False
        if source.source_kind == "QUESTION_SCORE":
            valid = source.source_question_id is not None and any(
                item.get("source_type") == "QUIZ_QUESTION"
                and item.get("quiz_question_id") == source.source_question_id
                and item.get("score", 0) < item.get("possible_score", 0)
                and (source.lesson_id is None or item.get("lesson_id") == source.lesson_id)
                and (source.competency_id is None or item.get("competency_id") == source.competency_id)
                for item in scores
            )
        elif source.source_kind == "SCORED_COMPETENCY":
            valid = source.competency_id is not None and any(
                item.get("competency_id") == source.competency_id for item in scored
            )
        elif source.source_kind == "COVERAGE":
            valid = source.coverage_classwork_id is not None and any(
                item.get("classwork_id") == source.coverage_classwork_id
                and (source.lesson_id is None or any(
                    lesson.get("lesson_id") == source.lesson_id for lesson in item.get("covered_lessons", [])
                ))
                and (source.competency_id is None or any(
                    competency.get("competency_id") == source.competency_id
                    for competency in item.get("covered_competencies", [])
                )) for item in coverage
            )
        elif source.source_kind == "COMPONENT":
            valid = source.component in weak
        if not valid:
            raise HTTPException(status_code=422, detail="Question provenance is not present in frozen evidence")


def list_materials(db: Session, staff_id: str, intervention_id: int) -> MaterialList:
    _intervention(db, staff_id, intervention_id, editable=False)
    rows = db.query(InterventionSupportMaterial).filter_by(intervention_id=intervention_id).order_by(
        InterventionSupportMaterial.material_id,
    ).all()
    return MaterialList(items=[_read(row) for row in rows], total=len(rows))


def create_material(db: Session, staff_id: str, intervention_id: int, kind: str) -> MaterialRead:
    if kind not in {"STUDENT_REVIEWER", "REMEDIAL_ASSESSMENT"}:
        raise HTTPException(status_code=422, detail="Unsupported support material kind")
    row = db.query(Intervention).filter_by(intervention_id=intervention_id).with_for_update().one_or_none()
    if row is None or not _eligible_scope(db, staff_id, row):
        raise HTTPException(status_code=404, detail="Support material not found")
    if row.status != "ACTIVE":
        raise HTTPException(status_code=409, detail="Support material requires an active intervention")
    existing = db.query(InterventionSupportMaterial).filter_by(intervention_id=intervention_id, kind=kind).first()
    if existing is not None:
        raise HTTPException(status_code=409, detail="A draft of this kind already exists")
    content = ReviewerContent() if kind == "STUDENT_REVIEWER" else RemedialContent()
    material = InterventionSupportMaterial(
        intervention_id=intervention_id, kind=kind, status="DRAFT", evidence_basis=_basis(row),
        generated_content=None, current_content=content.model_dump(mode="json"),
        created_by_staff_id=staff_id, updated_by_staff_id=staff_id,
    )
    db.add(material)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="A draft of this kind already exists") from None
    db.refresh(material)
    return _read(material)


def get_material(db: Session, staff_id: str, intervention_id: int, material_id: int) -> MaterialRead:
    _intervention(db, staff_id, intervention_id, editable=False)
    return _read(_material(db, intervention_id, material_id))


def update_material(
    db: Session, staff_id: str, intervention_id: int, material_id: int, body: MaterialUpdate,
) -> MaterialRead:
    intervention = db.query(Intervention).filter_by(intervention_id=intervention_id).with_for_update().one_or_none()
    if intervention is None or not _eligible_scope(db, staff_id, intervention):
        raise HTTPException(status_code=404, detail="Support material not found")
    material = _material(db, intervention_id, material_id)
    if intervention.status != "ACTIVE" or material.status != "DRAFT":
        raise HTTPException(status_code=409, detail="Support material is read-only")
    shape = ReviewerContent if material.kind == "STUDENT_REVIEWER" else RemedialContent
    try:
        content = shape.model_validate(body.content.model_dump())
    except ValidationError as exc:
        raise HTTPException(status_code=422, detail=exc.errors()) from exc
    if isinstance(content, RemedialContent):
        _validate_provenance(content, intervention.diagnosis_snapshot)
        orders = [question.display_order for question in content.questions]
        if len(orders) != len(set(orders)):
            raise HTTPException(status_code=422, detail="Question display order must be unique")
    material.current_content = content.model_dump(mode="json")
    material.updated_by_staff_id = staff_id
    db.commit()
    db.refresh(material)
    return _read(material)

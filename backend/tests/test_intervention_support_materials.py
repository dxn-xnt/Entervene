"""Teacher support drafts retain their frozen source and remain private."""

from copy import deepcopy
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.TeacherInterventions import router
from app.db.Session import get_db
from app.models.intervention.Intervention import Intervention
from app.services.intervention.InterventionSupportMaterialService import (
    create_material, get_material, list_materials, update_material,
)
from app.schemas.InterventionSupportMaterial import MaterialUpdate
from tests.test_teacher_intervention_review import candidate_context, _id, _other_staff, _staff
from tests.test_current_period_live_feature_builder import current_period_context


def _activate(ctx):
    staff_id = _staff(ctx)
    row = ctx["candidate"]
    row.status = "ACTIVE"
    row.activated_at = datetime.now(timezone.utc)
    row.activated_by_staff_id = staff_id
    ctx["db"].commit()


def _http(ctx, role="teacher", user_id=None):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: ctx["db"]
    app.dependency_overrides[get_current_user] = lambda: {
        "role": role, "sub": str(user_id or ctx["staff"].user_id),
    }
    return TestClient(app)


def test_drafts_are_owned_and_keep_frozen_basis(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    frozen = deepcopy(ctx["candidate"].diagnosis_snapshot)
    source_id = ctx["candidate"].source_prediction_id
    with pytest.raises(HTTPException) as candidate:
        create_material(db, _staff(ctx), _id(ctx), "STUDENT_REVIEWER")
    assert candidate.value.status_code == 409

    _activate(ctx)
    reviewer = create_material(db, _staff(ctx), _id(ctx), "STUDENT_REVIEWER")
    assessment = create_material(db, _staff(ctx), _id(ctx), "REMEDIAL_ASSESSMENT")
    assert reviewer.status == assessment.status == "DRAFT"
    assert reviewer.intervention_id == assessment.intervention_id == _id(ctx)
    assert reviewer.generated_content is None
    assert reviewer.evidence_basis["source_prediction_id"] == source_id
    assert reviewer.evidence_basis["reference"] == "intervention.diagnosis_snapshot"
    original_basis = deepcopy(reviewer.evidence_basis)
    updated = update_material(db, _staff(ctx), _id(ctx), reviewer.material_id, MaterialUpdate.model_validate({
        "content": {"title": "Review fractions", "introduction": "Start here", "body": "Practice examples"},
    }))
    assert updated.current_content["body"] == "Practice examples"
    assert updated.evidence_basis == original_basis
    assert updated.generated_content is None
    assert db.get(Intervention, _id(ctx)).diagnosis_snapshot == frozen
    assert db.get(Intervention, _id(ctx)).source_prediction_id == source_id
    assert list_materials(db, _staff(ctx), _id(ctx)).total == 2

    row = db.get(Intervention, _id(ctx))
    row.status = "RESOLVED"
    row.resolution_reason = "IMPROVED_PREDICTION"
    row.resolved_at = datetime.now(timezone.utc)
    db.commit()
    assert get_material(db, _staff(ctx), _id(ctx), reviewer.material_id).current_content["title"] == "Review fractions"
    with pytest.raises(HTTPException) as resolved:
        update_material(db, _staff(ctx), _id(ctx), reviewer.material_id, MaterialUpdate.model_validate({
            "content": {"title": "Changed", "introduction": "", "body": ""},
        }))
    assert resolved.value.status_code == 409
    with pytest.raises(HTTPException) as resolved_create:
        create_material(db, _staff(ctx), _id(ctx), "STUDENT_REVIEWER")
    assert resolved_create.value.status_code == 409


def test_material_http_scope_roles_and_assessment_shape(candidate_context):
    ctx = candidate_context
    _activate(ctx)
    client = _http(ctx)
    created = client.post(f"/{_id(ctx)}/materials", json={"kind": "REMEDIAL_ASSESSMENT"})
    assert created.status_code == 201, created.text
    material_id = created.json()["material_id"]
    assert client.get(f"/{_id(ctx)}/materials").json()["total"] == 1
    assert client.get(f"/{_id(ctx)}/materials/{material_id}").status_code == 200
    content = created.json()["current_content"]
    content["title"] = "Practice quiz"
    content["questions"] = [{
        "question_text": "What is 2 + 2?", "question_type": "SHORT_ANSWER", "points": 1,
        "display_order": 1, "difficulty_level": None, "explanation": "Add two and two.",
        "lesson_id": None, "options": [{"option_text": "4", "is_correct": True, "option_order": 1}],
        "provenance": None,
    }]
    saved = client.put(f"/{_id(ctx)}/materials/{material_id}", json={"content": content})
    assert saved.status_code == 200, saved.text
    assert saved.json()["current_content"]["questions"][0]["options"][0]["option_text"] == "4"
    content["questions"][0]["question_type"] = "ESSAY"
    assert client.put(f"/{_id(ctx)}/materials/{material_id}", json={"content": content}).status_code == 422
    content["questions"][0]["question_type"] = "SHORT_ANSWER"
    content["questions"][0]["provenance"] = {"source_kind": "SCORED_COMPETENCY", "competency_id": 999999}
    assert client.put(f"/{_id(ctx)}/materials/{material_id}", json={"content": content}).status_code == 422

    other = _other_staff(ctx)
    other_client = _http(ctx, user_id=other.user_id)
    for path in (f"/{_id(ctx)}/materials", f"/{_id(ctx)}/materials/{material_id}"):
        assert other_client.get(path).status_code == 404
    assert other_client.put(f"/{_id(ctx)}/materials/{material_id}", json={"content": content}).status_code == 404
    for role in ("admin", "student"):
        denied = _http(ctx, role=role)
        assert denied.get(f"/{_id(ctx)}/materials").status_code == 403
        assert denied.post(f"/{_id(ctx)}/materials", json={"kind": "STUDENT_REVIEWER"}).status_code == 403

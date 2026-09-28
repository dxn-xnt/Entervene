"""Grounded, metered generation of one private reviewer draft."""

import json
from copy import deepcopy
from datetime import datetime, timezone
from unittest.mock import patch

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.TeacherInterventions import router
from app.core.Config import settings
from app.db.Session import get_db
from app.models.intervention.Intervention import Intervention
from app.schemas.InterventionSupportMaterial import MaterialUpdate
from app.services.ai.UsageGuard import actor
from app.services.intervention.InterventionReviewerGenerationService import build_grounding, _validate_output
from app.services.intervention.InterventionSupportMaterialService import create_material, get_material, update_material
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_teacher_intervention_review import candidate_context, _id, _other_staff, _staff


REVIEWER = {"title": "Mathematics review", "introduction": "Let's practice using the available work.",
            "body": "Review the written work component. Read a worked example, try a similar practice item, check your steps, and ask your teacher about any step that remains unclear. Repeat the process with another example."}


def _client(ctx, *, role="teacher", user_id=None):
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: ctx["db"]
    app.dependency_overrides[get_current_user] = lambda: {
        "role": role, "sub": str(user_id or ctx["staff"].user_id),
    }
    return TestClient(app)


def _active(ctx):
    staff_id = _staff(ctx)
    row = ctx["candidate"]
    row.status = "ACTIVE"
    row.activated_at = datetime.now(timezone.utc)
    row.activated_by_staff_id = staff_id
    ctx["db"].commit()


def test_reviewer_generation_uses_provider_guard_and_preserves_teacher_edits(candidate_context, monkeypatch):
    ctx = candidate_context
    _active(ctx)
    material = create_material(ctx["db"], _staff(ctx), _id(ctx), "STUDENT_REVIEWER")
    original_basis = deepcopy(material.evidence_basis)
    original_diagnosis = deepcopy(ctx["candidate"].diagnosis_snapshot)
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(REVIEWER)}}]})

    monkeypatch.setattr(settings, "ai_enabled", True)
    monkeypatch.setattr(settings, "groq_api_key", "test-key")
    monkeypatch.setattr(settings, "groq_model", "openai/gpt-oss-20b")
    with patch("app.services.ai.Provider.reserve_call") as reserve, patch(
        "app.services.ai.Provider.httpx.AsyncHTTPTransport", return_value=httpx.MockTransport(handler),
    ):
        response = _client(ctx).post(f"/{_id(ctx)}/materials/{material.material_id}/generate")
        assert response.status_code == 200, response.text
        reserve.assert_called_once()
        assert reserve.call_args.args[0] == _staff(ctx)
    assert len(calls) == 1
    request_body = json.loads(calls[0].content)
    assert "Frozen evidence" in request_body["messages"][1]["content"]
    assert "student_lrn" not in request_body["messages"][1]["content"]
    assert response.json()["generated_content"] == REVIEWER
    assert response.json()["current_content"] == REVIEWER
    assert response.json()["evidence_basis"] == original_basis
    assert ctx["db"].get(Intervention, _id(ctx)).diagnosis_snapshot == original_diagnosis

    again = _client(ctx).post(f"/{_id(ctx)}/materials/{material.material_id}/generate")
    assert again.status_code == 409
    assert len(calls) == 1
    changed = update_material(ctx["db"], _staff(ctx), _id(ctx), material.material_id, MaterialUpdate.model_validate({
        "content": {**REVIEWER, "body": "Teacher revised this review."},
    }))
    assert changed.generated_content == REVIEWER
    assert changed.current_content["body"] == "Teacher revised this review."


def test_generation_rejects_state_kind_scope_and_roles_before_provider(candidate_context, monkeypatch):
    ctx = candidate_context
    called = []

    async def fake(*args, **kwargs):
        called.append(actor.get())
        return json.dumps(REVIEWER)

    monkeypatch.setattr("app.services.ai.Provider.generate_text", fake)
    with pytest.raises(Exception):
        create_material(ctx["db"], _staff(ctx), _id(ctx), "STUDENT_REVIEWER")
    _active(ctx)
    reviewer = create_material(ctx["db"], _staff(ctx), _id(ctx), "STUDENT_REVIEWER")
    assessment = create_material(ctx["db"], _staff(ctx), _id(ctx), "REMEDIAL_ASSESSMENT")
    path = f"/{_id(ctx)}/materials/{assessment.material_id}/generate"
    assert _client(ctx).post(path).status_code == 409
    other = _other_staff(ctx)
    assert _client(ctx, user_id=other.user_id).post(f"/{_id(ctx)}/materials/{reviewer.material_id}/generate").status_code == 404
    for role in ("admin", "student"):
        assert _client(ctx, role=role).post(f"/{_id(ctx)}/materials/{reviewer.material_id}/generate").status_code == 403
    row = ctx["db"].get(Intervention, _id(ctx))
    row.status = "RESOLVED"
    row.resolution_reason = "IMPROVED_PREDICTION"
    row.resolved_at = datetime.now(timezone.utc)
    ctx["db"].commit()
    assert _client(ctx).post(f"/{_id(ctx)}/materials/{reviewer.material_id}/generate").status_code == 409
    assert called == []


def test_failure_and_bad_output_leave_draft_untouched(candidate_context, monkeypatch):
    ctx = candidate_context
    _active(ctx)
    material = create_material(ctx["db"], _staff(ctx), _id(ctx), "STUDENT_REVIEWER")
    path = f"/{_id(ctx)}/materials/{material.material_id}/generate"

    async def fail(*args, **kwargs):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr("app.services.ai.Provider.generate_text", fail)
    assert _client(ctx).post(path).status_code == 502
    assert get_material(ctx["db"], _staff(ctx), _id(ctx), material.material_id).generated_content is None

    async def malformed(*args, **kwargs):
        return '{"title":"too short","body":"missing introduction"}'

    monkeypatch.setattr("app.services.ai.Provider.generate_text", malformed)
    assert _client(ctx).post(path).status_code == 502
    assert get_material(ctx["db"], _staff(ctx), _id(ctx), material.material_id).generated_content is None

    row = ctx["db"].get(Intervention, _id(ctx))
    diagnosis = deepcopy(row.diagnosis_snapshot)
    diagnosis["evidence_cutoff_at"] = "changed"
    row.diagnosis_snapshot = diagnosis
    ctx["db"].commit()
    assert _client(ctx).post(path).status_code == 409
    assert get_material(ctx["db"], _staff(ctx), _id(ctx), material.material_id).evidence_basis["evidence_cutoff_at"] != "changed"

def test_grounding_keeps_coverage_out_of_measured_weakness(candidate_context):
    ctx = candidate_context
    row = ctx["candidate"]
    diagnosis = deepcopy(row.diagnosis_snapshot)
    diagnosis["lowest_supported_competencies"] = []
    diagnosis["manual_assessment_coverage"] = [{
        "title": "Assessment", "covered_lessons": [{"title": "Fractions"}],
        "covered_competencies": [{"competency_statement": "Compare fractions"}],
    }]
    row.diagnosis_snapshot = diagnosis
    ctx["db"].commit()
    source = ctx["db"].get(type(row.source_prediction), row.source_prediction_id)
    grounding = build_grounding(row, source)
    assert grounding["measured_scored_competencies"] == []
    assert grounding["partly_or_incorrectly_scored_mapped_questions"] == []
    assert grounding["unranked_manual_coverage_context"][0]["covered_competencies"] == ["Compare fractions"]
    unsupported = {**REVIEWER, "body": "You are weak in Compare fractions. " + REVIEWER["body"]}
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as rejected:
        _validate_output(json.dumps(unsupported), grounding)
    assert rejected.value.status_code == 502


def test_reviewer_accepts_bounded_groq_json_wrapping_without_relaxing_evidence():
    grounding = {"measured_scored_competencies": [], "unranked_manual_coverage_context": [
        {"covered_competencies": ["Compare fractions"], "covered_lessons": []},
    ]}
    wrapped = "Here is the reviewer:\n```JSON\n" + json.dumps(REVIEWER)[:-1] + ",}\n```"
    assert _validate_output(wrapped, grounding) == REVIEWER
    valid_escaped = {**REVIEWER, "body": REVIEWER["body"] + "\nUse \\ as a written symbol."}
    assert _validate_output(json.dumps(valid_escaped), grounding) == valid_escaped
    bad = {**REVIEWER, "body": "You are weak in Compare fractions. " + REVIEWER["body"]}
    with pytest.raises(Exception):
        _validate_output("```json\n" + json.dumps(bad) + "\n```", grounding)

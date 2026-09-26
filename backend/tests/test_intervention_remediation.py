"""Preparation stays scoped, advisory, and separate from assignment."""
import asyncio
import json
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.core.Config import settings
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.services.ai.UsageGuard import actor
from app.services.intervention.InterventionRemediationService import (
    PlanUpdate, generate_advisory, get_workspace, save_plan,
)
from tests.test_intervention_support_materials import _activate, _http
from tests.test_teacher_intervention_review import candidate_context, _id, _other_staff, _staff
from tests.test_current_period_live_feature_builder import current_period_context


def test_plan_requires_active_scope_and_validates_selected_resources(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    with pytest.raises(HTTPException) as candidate:
        get_workspace(db, _staff(ctx), _id(ctx))
    assert candidate.value.status_code == 409
    _activate(ctx)
    own = Lesson(title="Owned review", subject_id=ctx["subject"].subject_id,
                 created_by_staff_id=_staff(ctx), is_published=False)
    other = Lesson(title="Private other teacher", subject_id=ctx["subject"].subject_id,
                   created_by_staff_id=_other_staff(ctx).staff_id, is_published=False)
    reading = Classwork(title="Uploaded reading", classwork_type="READING",
                        subject_id=ctx["subject"].subject_id, created_by_staff_id=_staff(ctx))
    db.add_all([own, other, reading]); db.commit()
    listing = get_workspace(db, _staff(ctx), _id(ctx))["resources"]
    labels = {(r["kind"], r["title"]) for r in listing}
    assert ("LESSON", "Owned review") in labels
    assert ("CLASSWORK", "Uploaded reading") in labels
    assert ("LESSON", "Private other teacher") not in labels
    assert all(r["ai_read"] == "METADATA_ONLY" for r in listing)
    assert next(r for r in listing if r["title"] == "Uploaded reading")["access"] == "PLANNING_ONLY"
    with pytest.raises(HTTPException) as denied:
        save_plan(db, _staff(ctx), _id(ctx), PlanUpdate(
            teacher_choice="QUIZ", selected_resources=[{"kind": "LESSON", "id": other.lesson_id}]))
    assert denied.value.status_code == 422
    saved = save_plan(db, _staff(ctx), _id(ctx), PlanUpdate(
        teacher_choice="CLASSWORK", selected_resources=[{"kind": "LESSON", "id": own.lesson_id}]))
    assert saved["plan"]["teacher_choice"] == "CLASSWORK"
    assert saved["plan"]["selected_resources"] == [{"kind": "LESSON", "id": own.lesson_id}]
    assert db.get(Intervention, _id(ctx)).status == "ACTIVE"
    assert db.query(ClassworkAssignment).filter_by(classwork_id=reading.classwork_id).count() == 0
    with pytest.raises(HTTPException) as other_teacher:
        get_workspace(db, other.created_by_staff_id, _id(ctx))
    assert other_teacher.value.status_code == 404
    row = db.get(Intervention, _id(ctx)); row.status = "RESOLVED"
    row.resolved_at = datetime.now(timezone.utc); row.resolution_reason = "IMPROVED_PREDICTION"; db.commit()
    with pytest.raises(HTTPException) as resolved:
        save_plan(db, _staff(ctx), _id(ctx), PlanUpdate(teacher_choice="QUIZ"))
    assert resolved.value.status_code == 409


def test_advisory_uses_provider_and_keeps_teacher_choice(candidate_context, monkeypatch):
    ctx = candidate_context; db = ctx["db"]
    _activate(ctx)
    save_plan(db, _staff(ctx), _id(ctx), PlanUpdate(teacher_choice="CLASSWORK"))
    monkeypatch.setattr(settings, "groq_api_key", "test-key")
    async def fake(prompt, system_prompt, **kwargs):
        assert actor.get() == _staff(ctx)
        assert "METADATA_ONLY" not in prompt or "selected_material_metadata" in prompt
        assert kwargs["json_output"] is True
        return json.dumps({"recommended_format": "QUIZ", "reason": "Focused practice may support the measured component."})
    monkeypatch.setattr("app.services.ai.Provider.generate_text", fake)
    token = actor.set(_staff(ctx))
    try:
        result = asyncio.run(generate_advisory(db, _staff(ctx), _id(ctx)))
    finally:
        actor.reset(token)
    assert result["plan"]["ai_suggestion"]["recommended_format"] == "QUIZ"
    assert result["plan"]["teacher_choice"] == "CLASSWORK"
    assert result["plan"]["ai_suggestion"]["evidence_used"]["source_prediction_id"] == ctx["candidate"].source_prediction_id


def test_groq_required_before_provider_call(candidate_context, monkeypatch):
    ctx = candidate_context; _activate(ctx)
    monkeypatch.setattr(settings, "groq_api_key", None)
    with patch("app.services.ai.Provider.generate_text") as provider, pytest.raises(HTTPException) as exc:
        asyncio.run(generate_advisory(ctx["db"], _staff(ctx), _id(ctx)))
    assert exc.value.status_code == 503
    provider.assert_not_called()


def test_advisory_rejects_unverified_weakness_claim(candidate_context, monkeypatch):
    ctx = candidate_context; _activate(ctx)
    monkeypatch.setattr(settings, "groq_api_key", "test-key")
    async def unsupported(*_args, **_kwargs):
        return json.dumps({"recommended_format": "QUIZ", "reason": "The student is weak in an unmeasured topic."})
    monkeypatch.setattr("app.services.ai.Provider.generate_text", unsupported)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(generate_advisory(ctx["db"], _staff(ctx), _id(ctx)))
    assert exc.value.status_code == 502
    assert ctx["db"].get(Intervention, _id(ctx)).remediation_plan is None


def test_http_teacher_only_and_candidate_rejected(candidate_context):
    ctx = candidate_context
    path = f"/{_id(ctx)}/remediation"
    assert _http(ctx).get(path).status_code == 409
    _activate(ctx)
    assert _http(ctx).get(path).status_code == 200
    assert _http(ctx).put(path, json={"teacher_choice": "EXAMS", "selected_resources": []}).status_code == 422
    for role in ("admin", "student"):
        assert _http(ctx, role=role).get(path).status_code == 403
    other = _other_staff(ctx)
    assert _http(ctx, user_id=other.user_id).get(path).status_code == 404

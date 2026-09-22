from __future__ import annotations

import json
import uuid
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from app.api.v1.routes.Auth import get_current_user
from app.core.Config import settings
from app.db.Base import Base
from app.db.Session import engine as configured_engine, get_db
from app.main import app
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from app.services.prediction.DashboardPredictionService import get_dashboard_at_risk_predictions
from tests.test_current_period_live_feature_builder import add_activity, current_period_context
from tests.test_development_current_term_prediction_persistence import _register_test_model
from tests.test_development_current_term_prediction_service import _make_ready, _set_weights


PATH = "/api/v1/development/current-term-predictions"


def _scope(ctx):
    return {
        "student_id": str(ctx["student"].student_id),
        "class_id": ctx["class"].class_id,
        "subject_id": ctx["subject"].subject_id,
        "source_period_id": ctx["period"].academic_period_id,
    }


def _client(monkeypatch, db, *, role="admin", environment="test", enabled=True):
    monkeypatch.setattr(settings, "app_environment", environment)
    monkeypatch.setattr(settings, "development_prediction_api_enabled", enabled)

    def db_override():
        yield db

    app.dependency_overrides[get_db] = db_override
    if role is not None:
        app.dependency_overrides[get_current_user] = lambda: {"role": role}
    else:
        app.dependency_overrides.pop(get_current_user, None)
    return TestClient(app)


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


@pytest.mark.parametrize("environment,enabled,expected", [
    ("production", True, 404),
    ("development", False, 404),
    ("test", True, 401),
    ("test", True, 403),
])
def test_guard_and_auth(current_period_context, monkeypatch, environment, enabled, expected):
    role = None if expected == 401 else "teacher"
    client = _client(monkeypatch, current_period_context["db"], role=role, environment=environment, enabled=enabled)
    response = client.post(PATH, json=_scope(current_period_context))
    assert response.status_code == expected
    assert current_period_context["db"].query(DevelopmentCurrentTermPrediction).count() == 0


def test_rejects_client_model_fields(current_period_context, monkeypatch):
    client = _client(monkeypatch, current_period_context["db"])
    for forbidden in ("projected_final_term_grade", "intervention_level", "risk_score", "model_version_id", "features", "prediction_purpose"):
        response = client.post(PATH, json={**_scope(current_period_context), forbidden: 90})
        assert response.status_code == 422


@pytest.mark.parametrize("blocker,status", [
    ("insufficient", "INSUFFICIENT_EVIDENCE"),
    ("subject", "UNSUPPORTED_DEVELOPMENT_DOMAIN"),
    ("weight", "UNSUPPORTED_DEVELOPMENT_DOMAIN"),
    ("finalized", "FINALIZED_GRADE_EXISTS"),
    ("period", "INVALID_PERIOD_SCOPE"),
])
def test_blocked_api_does_not_persist(current_period_context, monkeypatch, blocker, status):
    ctx = current_period_context
    _set_weights(ctx)
    _register_test_model(ctx)
    if blocker == "insufficient":
        add_activity(ctx, "WRITTEN_WORK", 8, 10)
    else:
        _make_ready(ctx)
    if blocker == "subject":
        ctx["subject"].subject_codename = "PHILOSOPHY"
    elif blocker == "weight":
        _set_weights(ctx, "20", "40", "40")
        add_activity(ctx, "QUARTERLY_ASSESSMENT", 32, 40)
    elif blocker == "finalized":
        ctx["db"].add(StudentPeriodGrade(
            student_id=ctx["student"].student_id,
            class_id=ctx["class"].class_id,
            subject_id=ctx["subject"].subject_id,
            academic_period_id=ctx["period"].academic_period_id,
            final_period_grade=Decimal("92"),
            is_finalized=True,
        ))
    ctx["db"].commit()
    scope = _scope(ctx)
    if blocker == "period":
        scope["target_period_id"] = ctx["next_period"].academic_period_id
    response = _client(monkeypatch, ctx["db"]).post(PATH, json=scope)
    assert response.status_code == 200
    body = response.json()
    assert body["persisted"] is False
    assert body["prediction_status"] == status
    assert body["intervention_level"] == "INTERVENTION_NOT_ASSESSED"
    assert body["reason_codes"]
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == 0


def test_revisions_and_production_read_isolation(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx)
    _make_ready(ctx)
    _register_test_model(ctx)
    client = _client(monkeypatch, ctx["db"])
    first = client.post(PATH, json=_scope(ctx))
    assert first.status_code == 200, first.text
    row = ctx["db"].get(DevelopmentCurrentTermPrediction, first.json()["prediction_id"])
    original = json.loads(json.dumps(row.evidence_snapshot))
    add_activity(ctx, "WRITTEN_WORK", 9, 10)
    second = client.post(PATH, json=_scope(ctx))
    assert second.status_code == 200, second.text
    assert (first.json()["revision"], second.json()["revision"]) == (1, 2)
    ctx["db"].expire_all()
    assert ctx["db"].get(DevelopmentCurrentTermPrediction, row.prediction_id).evidence_snapshot == original
    for response in (first, second):
        body = response.json()
        assert body["persisted"] is True
        assert body["readiness_status"] == "READY"
        assert body["intervention_basis"] == "RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE"
        assert body["source_period_id"] == body["target_period_id"]
        assert not any(word in json.dumps(body).lower() for word in ("probability", "confidence", "risk_score"))
    assert ctx["db"].query(AIPrediction).count() == 0
    assert get_dashboard_at_risk_predictions(ctx["db"])["items"] == []
    production_list = client.get(f"/api/v1/predictions/classes/{ctx['class'].class_id}/risks")
    assert production_list.status_code == 200
    assert production_list.json()["items"] == []


@pytest.mark.skipif(configured_engine.dialect.name != "postgresql", reason="PostgreSQL is not configured")
def test_real_postgres_http_end_to_end(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx)
    _make_ready(ctx)
    _register_test_model(ctx)
    schema = "dev_v3_api_test_" + uuid.uuid4().hex
    with configured_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    test_engine = create_engine(configured_engine.url, connect_args={"options": "-csearch_path=" + schema})
    try:
        Base.metadata.create_all(test_engine)
        with test_engine.begin() as conn:
            for table in Base.metadata.sorted_tables:
                rows = [dict(row) for row in ctx["db"].execute(select(table)).mappings()]
                if rows:
                    conn.execute(table.insert(), rows)
        db = sessionmaker(bind=test_engine)()
        try:
            result = _client(monkeypatch, db).post(PATH, json=_scope(ctx))
            assert result.status_code == 200, result.text
            body = result.json()
            assert body["persisted"] is True
            assert body["revision"] == 1
            assert 0 <= body["projected_final_term_grade"] <= 100
            assert body["intervention_level"] in {"HIGH_RISK", "MODERATE_RISK", "NEEDS_MONITORING", "LOW_RISK"}
            db.expire_all()
            row = db.get(DevelopmentCurrentTermPrediction, body["prediction_id"])
            assert str(row.student_id) == body.get("student_id", _scope(ctx)["student_id"])
            assert row.class_id == ctx["class"].class_id
            assert row.subject_id == ctx["subject"].subject_id
            assert row.source_period_id == row.target_period_id == ctx["period"].academic_period_id
            assert row.model_version_id == body["model_version_id"]
            assert row.revision == body["revision"]
            assert float(row.predicted_period_grade) == pytest.approx(body["projected_final_term_grade"], abs=0.01)
            assert row.intervention_level == body["intervention_level"]
            assert row.risk_score is None
            snapshot = row.evidence_snapshot
            assert snapshot["snapshot_version"] == "CURRENT_TERM_V3_EVIDENCE_V1"
            assert len(snapshot["model_features"]) == 31
            assert [x["name"] for x in snapshot["model_features"]] == scorer.required_feature_columns(scorer.load_development_current_term_schema())
            assert not any(term in json.dumps(snapshot).lower() for term in ("learner", "lrn", "email", "uploaded_file"))
            assert db.query(AIPrediction).count() == 0
            assert get_dashboard_at_risk_predictions(db)["items"] == []
            production_list = _client(monkeypatch, db).get(f"/api/v1/predictions/classes/{ctx['class'].class_id}/risks")
            assert production_list.status_code == 200
            assert production_list.json()["items"] == []
            print(f"PostgreSQL V3 E2E projected grade={body['projected_final_term_grade']}, intervention={body['intervention_level']}")
        finally:
            db.close()
    finally:
        test_engine.dispose()
        assert schema.startswith("dev_v3_api_test_")
        with configured_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))
        with configured_engine.connect() as conn:
            assert conn.execute(text("SELECT COUNT(*) FROM pg_namespace WHERE nspname = :schema"), {"schema": schema}).scalar_one() == 0

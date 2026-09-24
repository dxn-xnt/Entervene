from __future__ import annotations

import json
import uuid
from datetime import date, datetime, timedelta, timezone
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
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.people.Student import Student
from app.models.people.AcademicStaff import AcademicStaff
from app.models.auth.UserAccount import UserAccount
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


def _client(monkeypatch, db, *, role="admin", user_id=None, environment="test", enabled=True):
    monkeypatch.setattr(settings, "app_environment", environment)
    monkeypatch.setattr(settings, "development_prediction_api_enabled", enabled)

    def db_override():
        yield db

    app.dependency_overrides[get_db] = db_override
    if role is not None:
        claims = {"role": role}
        if user_id is not None:
            claims["sub"] = str(user_id)
        app.dependency_overrides[get_current_user] = lambda: claims
    else:
        app.dependency_overrides.pop(get_current_user, None)
    return TestClient(app)


def _read_params(ctx, **overrides):
    params = {
        "class_id": ctx["class"].class_id,
        "subject_id": ctx["subject"].subject_id,
        "academic_period_id": ctx["period"].academic_period_id,
    }
    params.update(overrides)
    return params


def _snapshot(readiness_level="STANDARD_READY"):
    return {
        "snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V1",
        "readiness": {
            "status": "READY",
            "level": readiness_level,
            "reason_codes": [],
        },
        "model_features": [{"name": "secret_feature", "value": 123}],
    }


def _insert_development_prediction(
    ctx,
    *,
    model_version_id: int,
    revision: int = 1,
    student=None,
    class_=None,
    subject=None,
    period=None,
    grade="88.50",
):
    row = DevelopmentCurrentTermPrediction(
        student_id=(student or ctx["student"]).student_id,
        class_id=(class_ or ctx["class"]).class_id,
        subject_id=(subject or ctx["subject"]).subject_id,
        source_period_id=(period or ctx["period"]).academic_period_id,
        target_period_id=(period or ctx["period"]).academic_period_id,
        model_version_id=model_version_id,
        revision=revision,
        predicted_period_grade=Decimal(grade),
        intervention_level="NEEDS_MONITORING",
        intervention_basis="RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE",
        risk_score=None,
        evidence_snapshot=_snapshot(),
        generated_at=datetime(2026, 9, 23, 1, revision, tzinfo=timezone.utc),
    )
    ctx["db"].add(row)
    ctx["db"].commit()
    return row


def test_selected_model_default_and_authorized_legacy_history(current_period_context, monkeypatch):
    ctx = current_period_context
    legacy_id = _register_test_model(ctx)
    corrected = AIModelVersion(
        model_name="entervene_current_term_official_target_rf_candidate",
        model_type="REGRESSOR", model_purpose="CURRENT_TERM_FINAL_GRADE_PROJECTION",
        algorithm="RandomForestRegressor", target_column="target_final_period_grade",
        lifecycle_status="DEVELOPMENT", is_active=False, production_validated=False,
        independent_three_term_validation=False,
    )
    ctx["db"].add(corrected)
    ctx["db"].commit()
    _insert_development_prediction(ctx, model_version_id=legacy_id, grade="81.00")
    _insert_development_prediction(ctx, model_version_id=corrected.model_version_id, grade="89.00")
    monkeypatch.setattr(settings, "development_current_term_model_name", corrected.model_name)
    client = _client(monkeypatch, ctx["db"])
    current = client.get(PATH, params=_read_params(ctx))
    assert current.status_code == 200
    assert current.json()["total"] == 1
    assert current.json()["items"][0]["model_version_id"] == corrected.model_version_id
    history = client.get(PATH, params=_read_params(ctx, model_version_id=legacy_id))
    assert history.status_code == 200
    assert history.json()["total"] == 1
    assert history.json()["items"][0]["model_version_id"] == legacy_id


def _add_student(ctx, first_name="Second", last_name="Learner", lrn="300000000002"):
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn=lrn,
        first_name=first_name,
        last_name=last_name,
        academic_level_id=ctx["level"].academic_level_id,
    )
    ctx["db"].add(student)
    ctx["db"].commit()
    return student


def _add_teacher(ctx, staff_id: str, email: str):
    account = UserAccount(user_id=uuid.uuid4(), email=email)
    staff = AcademicStaff(
        staff_id=staff_id,
        first_name=staff_id,
        last_name="Teacher",
        user_id=account.user_id,
    )
    ctx["db"].add_all([account, staff])
    ctx["db"].commit()
    return staff


def _add_load(ctx, staff, *, class_=None, subject=None, period=None):
    load = SubjectLoad(
        staff_id=staff.staff_id,
        class_id=(class_ or ctx["class"]).class_id,
        subject_id=(subject or ctx["subject"]).subject_id,
        academic_period_id=(period or ctx["period"]).academic_period_id,
        status="published",
        is_active_version=True,
    )
    ctx["db"].add(load)
    ctx["db"].commit()
    return load


def _enroll(ctx, student, *, class_=None, status="enrolled"):
    class_ = class_ or ctx["class"]
    enrollment = StudentClass(
        student_id=student.student_id,
        class_id=class_.class_id,
        academic_year_id=class_.academic_year_id,
        enrollment_status=status,
    )
    ctx["db"].add(enrollment)
    ctx["db"].commit()
    return enrollment


@pytest.fixture(autouse=True)
def clear_overrides():
    yield
    app.dependency_overrides.clear()


@pytest.mark.parametrize("environment,enabled,role,expected", [
    ("test", True, "admin", 200),
    ("production", True, "admin", 404),
    ("development", False, "admin", 404),
    ("test", True, None, 401),
    ("test", True, "teacher", 403),
])
def test_get_guard_and_auth(current_period_context, monkeypatch, environment, enabled, role, expected):
    ctx = current_period_context
    model_version_id = _register_test_model(ctx)
    _insert_development_prediction(ctx, model_version_id=model_version_id)

    response = _client(
        monkeypatch,
        ctx["db"],
        role=role,
        environment=environment,
        enabled=enabled,
    ).get(PATH, params=_read_params(ctx))

    assert response.status_code == expected


def test_get_returns_latest_revisions_for_each_student(current_period_context, monkeypatch):
    ctx = current_period_context
    model_version_id = _register_test_model(ctx)
    other_student = _add_student(ctx)
    _insert_development_prediction(ctx, model_version_id=model_version_id, revision=1, grade="76.00")
    latest = _insert_development_prediction(ctx, model_version_id=model_version_id, revision=2, grade="91.25")
    other_latest = _insert_development_prediction(
        ctx,
        model_version_id=model_version_id,
        student=other_student,
        revision=1,
        grade="84.00",
    )

    response = _client(monkeypatch, ctx["db"]).get(PATH, params=_read_params(ctx))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["total"] == 2
    returned = {item["student_id"]: item for item in body["items"]}
    assert set(returned) == {str(ctx["student"].student_id), str(other_student.student_id)}
    assert returned[str(ctx["student"].student_id)]["prediction_id"] == latest.prediction_id
    assert returned[str(ctx["student"].student_id)]["revision"] == 2
    assert returned[str(ctx["student"].student_id)]["projected_final_term_grade"] == 91.25
    assert returned[str(other_student.student_id)]["prediction_id"] == other_latest.prediction_id


def test_finalized_read_distinguishes_actual_grade_from_historical_projection(current_period_context, monkeypatch):
    ctx = current_period_context
    model_version_id = _register_test_model(ctx)
    _insert_development_prediction(ctx, model_version_id=model_version_id, grade="84.60")
    ctx["period"].start_date = date(2020, 1, 1)
    ctx["period"].end_date = date(2020, 3, 1)
    ctx["db"].add(StudentPeriodGrade(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        final_period_grade=Decimal("87.00"),
        is_finalized=True,
    ))
    ctx["db"].commit()

    response = _client(monkeypatch, ctx["db"]).get(PATH, params=_read_params(ctx))
    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["projected_final_term_grade"] == 84.6
    assert item["official_final_grade"] == 87.0
    assert item["official_final_grade_available"] is True
    assert item["term_context"]["progress_percent"] == 100.0
    assert item["term_context"]["scheduled_end_passed_while_active"] is True


def test_get_filters_by_required_scope(current_period_context, monkeypatch):
    ctx = current_period_context
    model_version_id = _register_test_model(ctx)
    match = _insert_development_prediction(ctx, model_version_id=model_version_id)
    other_class = Class(
        section_name="Babbage",
        academic_year_id=ctx["class"].academic_year_id,
        academic_level_id=ctx["level"].academic_level_id,
    )
    other_subject = Subject(
        subject_name="Mathematics",
        subject_codename="MATHEMATICS",
        academic_level_id=ctx["level"].academic_level_id,
    )
    ctx["db"].add_all([other_class, other_subject])
    ctx["db"].commit()
    _insert_development_prediction(ctx, model_version_id=model_version_id, class_=other_class, revision=1)
    _insert_development_prediction(ctx, model_version_id=model_version_id, subject=other_subject, revision=1)
    _insert_development_prediction(ctx, model_version_id=model_version_id, period=ctx["next_period"], revision=1)

    client = _client(monkeypatch, ctx["db"])
    assert client.get(PATH, params=_read_params(ctx)).json()["items"][0]["prediction_id"] == match.prediction_id
    assert client.get(PATH, params=_read_params(ctx, class_id=other_class.class_id)).json()["items"][0]["class_id"] == other_class.class_id
    assert client.get(PATH, params=_read_params(ctx, subject_id=other_subject.subject_id)).json()["items"][0]["subject_id"] == other_subject.subject_id
    assert client.get(PATH, params=_read_params(ctx, academic_period_id=ctx["next_period"].academic_period_id)).json()["items"][0]["academic_period_id"] == ctx["next_period"].academic_period_id


def test_get_returns_only_development_current_term_model_rows(current_period_context, monkeypatch):
    ctx = current_period_context
    model_version_id = _register_test_model(ctx)
    included = _insert_development_prediction(ctx, model_version_id=model_version_id)
    production_model = AIModelVersion(
        model_name="current_term_production_candidate",
        model_type="REGRESSOR",
        model_purpose="CURRENT_TERM_FINAL_GRADE_PROJECTION",
        algorithm="RandomForestRegressor",
        target_column="target_final_period_grade",
        lifecycle_status="PRODUCTION",
        production_validated=True,
        independent_three_term_validation=False,
        is_active=False,
    )
    unrelated_model = AIModelVersion(
        model_name="legacy_next_period",
        model_type="REGRESSOR",
        model_purpose="NEXT_PERIOD_BASELINE_FORECAST",
        algorithm="RandomForestRegressor",
        target_column="target_final_period_grade",
        lifecycle_status="DEVELOPMENT",
        production_validated=False,
        independent_three_term_validation=False,
        is_active=False,
    )
    ctx["db"].add_all([production_model, unrelated_model])
    ctx["db"].commit()
    _insert_development_prediction(ctx, model_version_id=production_model.model_version_id, revision=1, grade="70.00")
    _insert_development_prediction(ctx, model_version_id=unrelated_model.model_version_id, revision=1, grade="72.00")
    ctx["db"].add(AIPrediction(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        source_period_id=ctx["period"].academic_period_id,
        target_period_id=ctx["period"].academic_period_id,
        predicted_period_grade=Decimal("50.00"),
        risk_score=Decimal("0.99"),
        risk_level="HIGH_RISK",
        data_status="SUFFICIENT",
        revision=1,
    ))
    ctx["db"].commit()

    response = _client(monkeypatch, ctx["db"]).get(PATH, params=_read_params(ctx))

    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["prediction_id"] for item in body["items"]] == [included.prediction_id]
    payload = json.dumps(body).lower()
    assert "risk_score" not in payload
    assert "probability" not in payload
    assert "confidence" not in payload
    assert "model_features" not in payload
    assert "evidence_snapshot" not in payload
    assert "student_lrn" not in payload and "300000000001" not in payload


def test_get_keeps_normal_production_reads_isolated(current_period_context, monkeypatch):
    ctx = current_period_context
    model_version_id = _register_test_model(ctx)
    _insert_development_prediction(ctx, model_version_id=model_version_id)

    client = _client(monkeypatch, ctx["db"])
    development_list = client.get(PATH, params=_read_params(ctx))
    production_list = client.get(f"/api/v1/predictions/classes/{ctx['class'].class_id}/risks")

    assert development_list.status_code == 200
    assert development_list.json()["total"] == 1
    assert ctx["db"].query(AIPrediction).count() == 0
    assert get_dashboard_at_risk_predictions(ctx["db"])["items"] == []
    assert production_list.status_code == 200
    assert production_list.json()["items"] == []


def test_teacher_gets_latest_predictions_for_own_authorized_load(current_period_context, monkeypatch):
    ctx = current_period_context
    model_version_id = _register_test_model(ctx)
    _add_load(ctx, ctx["staff"])
    _enroll(ctx, ctx["student"])
    _insert_development_prediction(ctx, model_version_id=model_version_id, revision=1, grade="80.00")
    latest = _insert_development_prediction(ctx, model_version_id=model_version_id, revision=2, grade="90.00")

    response = _client(
        monkeypatch,
        ctx["db"],
        role="teacher",
        user_id=ctx["staff"].user_id,
    ).get(PATH, params=_read_params(ctx))

    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["prediction_id"] == latest.prediction_id
    assert response.json()["items"][0]["revision"] == 2


def test_teacher_cannot_generate_development_prediction(current_period_context, monkeypatch):
    ctx = current_period_context
    _add_load(ctx, ctx["staff"])
    _enroll(ctx, ctx["student"])

    response = _client(
        monkeypatch,
        ctx["db"],
        role="teacher",
        user_id=ctx["staff"].user_id,
    ).post(PATH, json=_scope(ctx))

    assert response.status_code == 403
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == 0


def test_teacher_scope_ids_cannot_bypass_subject_load_authorization(current_period_context, monkeypatch):
    ctx = current_period_context
    other_teacher = _add_teacher(ctx, "T-OTHER", "other.teacher@example.test")
    other_class = Class(
        section_name="Babbage",
        academic_year_id=ctx["class"].academic_year_id,
        academic_level_id=ctx["level"].academic_level_id,
    )
    other_subject = Subject(
        subject_name="Mathematics",
        subject_codename="MATHEMATICS",
        academic_level_id=ctx["level"].academic_level_id,
    )
    ctx["db"].add_all([other_class, other_subject])
    ctx["db"].commit()
    _add_load(ctx, ctx["staff"])
    _add_load(ctx, other_teacher, class_=other_class)
    _add_load(ctx, other_teacher, subject=other_subject)
    _add_load(ctx, other_teacher, period=ctx["next_period"])

    client = _client(monkeypatch, ctx["db"], role="teacher", user_id=ctx["staff"].user_id)
    denied_scopes = [
        _read_params(ctx, class_id=other_class.class_id),
        _read_params(ctx, subject_id=other_subject.subject_id),
        _read_params(ctx, academic_period_id=ctx["next_period"].academic_period_id),
    ]

    for params in denied_scopes:
        response = client.get(PATH, params=params)
        assert response.status_code == 403, (params, response.text)


def test_teacher_results_include_only_active_class_enrollments(current_period_context, monkeypatch):
    ctx = current_period_context
    model_version_id = _register_test_model(ctx)
    outside = _add_student(ctx, "Outside", "Learner", "300000000003")
    transferred = _add_student(ctx, "Transferred", "Learner", "300000000004")
    inactive = _add_student(ctx, "Inactive", "Learner", "300000000005")
    _add_load(ctx, ctx["staff"])
    _enroll(ctx, ctx["student"])
    _enroll(ctx, transferred, status="transferred")
    _enroll(ctx, inactive, status="inactive")
    for student in (ctx["student"], outside, transferred, inactive):
        _insert_development_prediction(ctx, model_version_id=model_version_id, student=student)

    response = _client(
        monkeypatch,
        ctx["db"],
        role="teacher",
        user_id=ctx["staff"].user_id,
    ).get(PATH, params=_read_params(ctx))

    assert response.status_code == 200, response.text
    assert [item["student_id"] for item in response.json()["items"]] == [str(ctx["student"].student_id)]


def test_active_substitute_and_view_only_permanent_teacher_can_read(current_period_context, monkeypatch):
    ctx = current_period_context
    model_version_id = _register_test_model(ctx)
    substitute = _add_teacher(ctx, "T-SUB", "substitute@example.test")
    load = _add_load(ctx, ctx["staff"])
    _enroll(ctx, ctx["student"])
    _insert_development_prediction(ctx, model_version_id=model_version_id)
    ctx["db"].add(TeacherSubstitution(
        subject_load_id=load.subject_load_id,
        original_staff_id=ctx["staff"].staff_id,
        substitute_staff_id=substitute.staff_id,
        start_date=date.today() - timedelta(days=1),
        end_date=date.today() + timedelta(days=1),
        status="active",
    ))
    ctx["db"].commit()

    for staff in (ctx["staff"], substitute):
        response = _client(
            monkeypatch,
            ctx["db"],
            role="teacher",
            user_id=staff.user_id,
        ).get(PATH, params=_read_params(ctx))
        assert response.status_code == 200, (staff.staff_id, response.text)
        assert response.json()["total"] == 1


def test_teacher_cannot_spoof_staff_identity(current_period_context, monkeypatch):
    ctx = current_period_context
    other_teacher = _add_teacher(ctx, "T-SPOOF", "spoof@example.test")
    _add_load(ctx, ctx["staff"])

    response = _client(
        monkeypatch,
        ctx["db"],
        role="teacher",
        user_id=other_teacher.user_id,
    ).get(PATH, params={
        **_read_params(ctx),
        "staff_id": ctx["staff"].staff_id,
        "teacher_id": ctx["staff"].staff_id,
    })

    assert response.status_code == 403


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


def test_controlled_admin_teacher_development_acceptance(current_period_context, monkeypatch):
    ctx = current_period_context
    _set_weights(ctx)
    _make_ready(ctx)
    model_version_id = _register_test_model(ctx)
    _add_load(ctx, ctx["staff"])
    _enroll(ctx, ctx["student"])
    teacher_b = _add_teacher(ctx, "T-DENIED", "denied.teacher@example.test")

    first = _client(monkeypatch, ctx["db"]).post(PATH, json=_scope(ctx))
    assert first.status_code == 200, first.text
    first_body = first.json()
    assert first_body["persisted"] is True
    assert first_body["revision"] == 1
    assert first_body["readiness_status"] == "READY"
    assert first_body["intervention_basis"] == "RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE"

    admin_read = _client(monkeypatch, ctx["db"]).get(PATH, params=_read_params(ctx))
    assert admin_read.status_code == 200, admin_read.text
    assert admin_read.json()["total"] == 1
    assert admin_read.json()["items"][0]["prediction_id"] == first_body["prediction_id"]

    teacher_read = _client(
        monkeypatch,
        ctx["db"],
        role="teacher",
        user_id=ctx["staff"].user_id,
    ).get(PATH, params=_read_params(ctx))
    assert teacher_read.status_code == 200, teacher_read.text
    assert teacher_read.json()["items"] == admin_read.json()["items"]

    for body in (first_body, admin_read.json(), teacher_read.json()):
        payload = json.dumps(body).lower()
        assert not any(term in payload for term in ("risk_score", "probability", "confidence"))

    denied_read = _client(
        monkeypatch,
        ctx["db"],
        role="teacher",
        user_id=teacher_b.user_id,
    ).get(PATH, params=_read_params(ctx))
    denied_write = _client(
        monkeypatch,
        ctx["db"],
        role="teacher",
        user_id=teacher_b.user_id,
    ).post(PATH, json=_scope(ctx))
    assert denied_read.status_code == 403
    assert denied_write.status_code == 403

    first_row = ctx["db"].get(DevelopmentCurrentTermPrediction, first_body["prediction_id"])
    original_snapshot = json.loads(json.dumps(first_row.evidence_snapshot))
    add_activity(ctx, "WRITTEN_WORK", 9, 10)

    second = _client(monkeypatch, ctx["db"]).post(PATH, json=_scope(ctx))
    assert second.status_code == 200, second.text
    second_body = second.json()
    assert second_body["persisted"] is True
    assert second_body["revision"] == 2
    assert second_body["prediction_id"] != first_body["prediction_id"]

    ctx["db"].expire_all()
    assert ctx["db"].get(
        DevelopmentCurrentTermPrediction,
        first_body["prediction_id"],
    ).evidence_snapshot == original_snapshot
    assert ctx["db"].query(DevelopmentCurrentTermPrediction).count() == 2

    for role, user_id in (("admin", None), ("teacher", ctx["staff"].user_id)):
        latest = _client(
            monkeypatch,
            ctx["db"],
            role=role,
            user_id=user_id,
        ).get(PATH, params=_read_params(ctx))
        assert latest.status_code == 200, latest.text
        assert latest.json()["total"] == 1
        assert latest.json()["items"][0]["prediction_id"] == second_body["prediction_id"]
        assert latest.json()["items"][0]["revision"] == 2

    model = ctx["db"].get(AIModelVersion, model_version_id)
    assert model.model_purpose == "CURRENT_TERM_FINAL_GRADE_PROJECTION"
    assert model.lifecycle_status == "DEVELOPMENT"
    assert model.is_active is False
    assert ctx["db"].query(AIPrediction).count() == 0
    assert get_dashboard_at_risk_predictions(ctx["db"])["items"] == []
    production_list = _client(monkeypatch, ctx["db"]).get(
        f"/api/v1/predictions/classes/{ctx['class'].class_id}/risks"
    )
    assert production_list.status_code == 200
    assert production_list.json()["items"] == []


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

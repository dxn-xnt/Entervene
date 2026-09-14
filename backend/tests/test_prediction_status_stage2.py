from copy import deepcopy
import json
from pathlib import Path
import uuid

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from test_prediction_feature_builder_service import add_classwork_submission, add_period_grade, feature_context
from test_prediction_integrity_stage1 import context, generate
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Predictions import router as predictions_router
from app.db.Session import get_db
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.prediction import PredictionGenerationService as generation
from app.services.prediction.DashboardPredictionService import get_dashboard_at_risk_predictions
from app.services.prediction.PredictionStatusService import get_prediction_history, get_roster_prediction_status


def status(c, **overrides):
    return get_roster_prediction_status(
        c["db"],
        class_id=c["scope"]["class_id"],
        subject_id=c["scope"]["subject_id"],
        source_period_id=c["scope"]["source_period_id"],
        target_period_id=c["scope"]["target_period_id"],
        staff_id=c["staff"].staff_id,
        is_admin=False,
        **overrides,
    )


def api_context(c, *, role="teacher", staff_id=None):
    app = FastAPI()
    app.include_router(predictions_router, prefix="/api/v1/predictions")
    app.dependency_overrides[get_db] = lambda: c["db"]
    app.dependency_overrides[get_current_user] = lambda: {"role": role, "sub": str(uuid.uuid4())}
    if staff_id is None:
        staff_id = c["staff"].staff_id
    # get_optional_staff_id/get_staff_id resolve through the current user in app code.
    return TestClient(app, raise_server_exceptions=False)


def test_zero_data_enrolled_student_appears_without_prediction_insert(context):
    c = context
    zero = Student(student_id=uuid.uuid4(), student_lrn="100000000099", first_name="Zero", last_name="Evidence",
                   academic_level_id=c["student"].academic_level_id)
    c["db"].add(zero)
    c["db"].flush()
    c["db"].add(StudentClass(student_id=zero.student_id, class_id=c["scope"]["class_id"],
                             academic_year_id=c["class"].academic_year_id, enrollment_status="enrolled"))
    c["db"].commit()

    before = c["db"].query(AIPrediction).count()
    result = status(c)

    assert c["db"].query(AIPrediction).count() == before
    row = next(item for item in result["items"] if item["student_id"] == zero.student_id)
    assert row["latest_prediction"] is None
    assert row["status"] in {"COLLECTING_DATA", "NOT_READY"}


def test_status_read_does_not_score_or_mutate(context, monkeypatch):
    def fail(*args, **kwargs):
        raise AssertionError("status must not execute model scoring")
    monkeypatch.setattr(generation, "score_student_prediction", fail)
    before_predictions = c_before = context["db"].query(AIPrediction).count()
    before_outcomes = context["db"].query(PredictionOutcome).count()

    result = status(context)

    assert result["total"] == 1
    assert context["db"].query(AIPrediction).count() == before_predictions == c_before
    assert context["db"].query(PredictionOutcome).count() == before_outcomes


def test_thirty_grade_writes_create_zero_prediction_versions(context):
    for index in range(30):
        add_classwork_submission(context, period=context["periods"][0], grade=70 + (index % 10))

    assert context["db"].query(AIPrediction).count() == 0


def test_strong_provisional_source_is_ready_but_forecast_ineligible(context):
    context["grade"].is_finalized = False
    context["db"].commit()

    row = status(context)["items"][0]

    assert row["evidence_readiness"]["ready"] is True
    assert row["evidence_readiness"]["readiness_level"] in {"MINIMUM", "GOOD", "STRONG"}
    assert row["forecast_eligibility"]["eligible"] is False
    assert row["forecast_eligibility"]["status"] == "AWAITING_OFFICIAL_SOURCE_GRADE"
    assert row["latest_prediction"] is None


def test_official_source_valid_successor_is_eligible(context):
    row = status(context)["items"][0]

    assert row["evidence_readiness"]["ready"] is True
    assert row["forecast_eligibility"]["eligible"] is True
    assert row["status"] == "READY_FOR_FORECAST"


def test_saved_v2_current_and_source_grade_correction_stales(context):
    first = generate(context, "stage2-current")
    row = status(context)["items"][0]
    assert row["latest_prediction"]["prediction_id"] == first["prediction_id"]
    assert row["forecast_freshness"]["status"] == "CURRENT"
    assert row["status"] == "FORECAST_CURRENT"

    context["grade"].final_period_grade = 79
    context["db"].commit()
    stale = status(context)["items"][0]
    assert stale["forecast_freshness"]["status"] == "SOURCE_EVIDENCE_CHANGED"
    assert stale["status"] == "SOURCE_EVIDENCE_CHANGED"


def test_source_classwork_correction_stales_when_in_contract(context):
    generate(context, "stage2-classwork")
    submission = context["db"].query(StudentSubmission).one()
    submission.grade = 70
    context["db"].commit()

    row = status(context)["items"][0]

    assert row["forecast_freshness"]["status"] == "SOURCE_EVIDENCE_CHANGED"


def test_target_period_changes_do_not_stale_source_forecast(context):
    generate(context, "stage2-target-safe")
    add_period_grade(context, context["periods"][1], grade=60, is_finalized=True,
                     written_work_percent=60, performance_task_percent=60, quarterly_assessment_percent=60)
    add_classwork_submission(context, period=context["periods"][1], grade=60)

    row = status(context)["items"][0]

    assert row["forecast_freshness"]["status"] == "CURRENT"


def test_prior_dependency_correction_stales_when_it_contributed(context):
    c = context
    c["db"].add(SubjectLoad(class_id=c["class"].class_id, subject_id=c["subject"].subject_id,
                            academic_period_id=c["periods"][1].academic_period_id, staff_id=c["staff"].staff_id,
                            status="active"))
    add_period_grade(c, c["periods"][1], grade=88, is_finalized=True,
                     written_work_percent=88, performance_task_percent=88, quarterly_assessment_percent=88)
    add_classwork_submission(c, period=c["periods"][1], grade=88)
    c["scope"] = {**c["scope"], "source_period_id": c["periods"][1].academic_period_id,
                  "target_period_id": c["periods"][2].academic_period_id}
    generate(c, "stage2-prior")
    assert status(c)["items"][0]["forecast_freshness"]["status"] == "CURRENT"

    original_prior = c["db"].query(StudentPeriodGrade).filter(
        StudentPeriodGrade.academic_period_id == c["periods"][0].academic_period_id
    ).one()
    original_prior.final_period_grade = 70
    c["db"].commit()

    assert status(c)["items"][0]["forecast_freshness"]["status"] == "SOURCE_EVIDENCE_CHANGED"


def test_legacy_forecast_freshness_unknown(context):
    legacy = AIPrediction(**context["scope"], model_version_id=context["model"].model_version_id,
                          risk_level="LOW_RISK", data_status="SUFFICIENT")
    context["db"].add(legacy)
    context["db"].commit()

    row = status(context)["items"][0]

    assert row["status"] == "LEGACY_UNKNOWN"
    assert row["forecast_freshness"]["status"] == "UNKNOWN"
    assert row["latest_prediction"]["validation_status"] == "LEGACY_UNVALIDATED"


def test_dashboard_prefers_audited_forecast_over_legacy_same_scope(context):
    legacy = AIPrediction(**context["scope"], model_version_id=None,
                          risk_level="HIGH_RISK", risk_score=90, data_status="SUFFICIENT")
    context["db"].add(legacy)
    context["db"].commit()
    audited = generate(context, "stage2-dashboard")

    result = get_dashboard_at_risk_predictions(
        context["db"],
        class_id=context["scope"]["class_id"],
        subject_id=context["scope"]["subject_id"],
        academic_period_id=context["scope"]["target_period_id"],
        is_admin=True,
    )

    assert result["total"] == 1
    assert result["items"][0]["prediction_id"] == audited["prediction_id"]
    assert result["items"][0]["validation_status"] == "NEXT_PERIOD_PROTOTYPE"


def test_refresh_unchanged_changed_and_not_ready_paths(context):
    first = generate(context, "stage2-refresh-a")
    unchanged = generate(context, "stage2-refresh-b")
    assert unchanged["generation_status"] == "UNCHANGED"
    assert unchanged["prediction_id"] == first["prediction_id"]
    assert unchanged["revision"] == first["revision"]

    frozen = deepcopy(context["db"].get(AIPrediction, first["prediction_id"]).evidence_snapshot)
    context["db"].query(StudentSubmission).one().grade = 70
    context["db"].commit()
    second = generate(context, "stage2-refresh-c")
    assert second["revision"] == first["revision"] + 1
    assert second["prediction_id"] != first["prediction_id"]
    assert context["db"].get(AIPrediction, first["prediction_id"]).evidence_snapshot == frozen

    context["db"].query(StudentSubmission).one().grade = None
    context["db"].query(StudentSubmission).one().status = "pending"
    context["db"].commit()
    not_ready = generate(context, "stage2-refresh-d")
    assert not_ready["generation_status"] == "NOT_READY"
    assert context["db"].query(AIPrediction).count() == 2


def test_history_ordering_and_legacy_revision_label(context):
    first = generate(context, "stage2-history-a")
    context["db"].query(StudentSubmission).one().grade = 70
    context["db"].commit()
    second = generate(context, "stage2-history-b")

    history = get_prediction_history(context["db"], context["db"].get(AIPrediction, first["prediction_id"]))

    assert [item["prediction_id"] for item in history["items"]] == [first["prediction_id"], second["prediction_id"]]
    assert [item["revision"] for item in history["items"]] == [1, 2]
    assert history["items"][0]["is_latest"] is False
    assert history["items"][1]["is_latest"] is True
    assert history["items"][0]["forecast_freshness"]["status"] == "SOURCE_EVIDENCE_CHANGED"
    assert history["items"][1]["forecast_freshness"]["status"] == "CURRENT"


def test_no_next_period_status(context):
    source = context["periods"][2]
    result = get_roster_prediction_status(
        context["db"],
        class_id=context["class"].class_id,
        subject_id=context["subject"].subject_id,
        source_period_id=source.academic_period_id,
        target_period_id=None,
        staff_id=context["staff"].staff_id,
        is_admin=True,
    )

    assert result["items"][0]["status"] == "NO_NEXT_PERIOD"


def test_status_refresh_and_history_routes(context):
    client = api_context(context, role="admin")
    params = {
        "class_id": context["scope"]["class_id"],
        "subject_id": context["scope"]["subject_id"],
        "source_period_id": context["scope"]["source_period_id"],
        "target_period_id": context["scope"]["target_period_id"],
    }
    status_response = client.get("/api/v1/predictions/status/roster", params=params)
    assert status_response.status_code == 200, status_response.text
    assert status_response.json()["items"][0]["status"] == "READY_FOR_FORECAST"

    first = generate(context, "stage2-route-first")
    history_response = client.get(f"/api/v1/predictions/{first['prediction_id']}/history")
    assert history_response.status_code == 200, history_response.text
    assert history_response.json()["items"][0]["prediction_id"] == first["prediction_id"]

    refresh_response = client.post(f"/api/v1/predictions/{first['prediction_id']}/refresh", json={})
    assert refresh_response.status_code == 200, refresh_response.text
    assert refresh_response.json()["generation_status"] == "UNCHANGED"
    assert refresh_response.json()["prediction_id"] == first["prediction_id"]


def test_status_endpoint_rejects_unauthorized_teacher(context):
    with pytest.raises(PermissionError):
        get_roster_prediction_status(
            context["db"],
            class_id=context["class"].class_id,
            subject_id=context["subject"].subject_id,
            source_period_id=context["periods"][0].academic_period_id,
            target_period_id=context["periods"][1].academic_period_id,
            staff_id="UNASSIGNED",
            is_admin=False,
        )

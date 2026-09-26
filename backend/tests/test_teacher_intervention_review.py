"""Teacher-only review and safe activation of corrected candidates."""

from copy import deepcopy
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.TeacherInterventions import require_development_intervention_api, router
from app.core.Config import settings
from app.db.Session import get_db
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.UserAccount import UserAccount
from app.models.auth.Role import Role
from app.models.auth.UserRoles import UserRoles
from app.models.intervention.Intervention import Intervention
from app.models.people.AcademicStaff import AcademicStaff
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.suggestion.StudentSuggestion import StudentSuggestion
from app.services.intervention.TeacherInterventionService import (
    activate_teacher_candidate, get_teacher_candidate, list_teacher_candidates,
)
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_development_current_term_prediction_persistence import _run
from tests.test_intervention_candidate_sync import _setup


@pytest.fixture
def candidate_context(current_period_context, monkeypatch):
    ctx = current_period_context
    model_id = _setup(ctx, monkeypatch, [84, 84])
    db = ctx["db"]
    db.add_all([
        StudentClass(
            student_id=ctx["student"].student_id, class_id=ctx["class"].class_id,
            academic_year_id=ctx["class"].academic_year_id, enrollment_status="enrolled",
        ),
        SubjectLoad(
            staff_id=ctx["staff"].staff_id, class_id=ctx["class"].class_id,
            subject_id=ctx["subject"].subject_id,
            academic_period_id=ctx["period"].academic_period_id,
            status="published", is_active_version=True,
        ),
    ])
    db.commit()
    result = _run(ctx, model_id)
    ctx["candidate"] = db.query(Intervention).filter_by(source_prediction_id=result["prediction_id"]).one()
    ctx["model_id"] = model_id
    return ctx


def _id(ctx):
    return ctx["candidate"].intervention_id


def _staff(ctx):
    return ctx["staff"].staff_id


def _other_staff(ctx):
    account = UserAccount(user_id=uuid4(), email=f"other-{uuid4().hex[:8]}@example.test")
    staff = AcademicStaff(staff_id="T-OTHER", first_name="Other", last_name="Teacher", user_id=account.user_id)
    ctx["db"].add_all([account, staff])
    ctx["db"].commit()
    return staff


def test_assigned_teacher_lists_and_views_frozen_candidate(candidate_context):
    ctx = candidate_context
    listed = list_teacher_candidates(ctx["db"], _staff(ctx))
    assert listed.total == 1
    item = listed.items[0]
    assert item.intervention_id == _id(ctx)
    assert (item.student_id, item.class_id, item.subject_id, item.academic_period_id) == (
        ctx["student"].student_id, ctx["class"].class_id,
        ctx["subject"].subject_id, ctx["period"].academic_period_id,
    )
    assert item.student_name and item.student_lrn == ctx["student"].student_lrn
    assert item.source_prediction_revision == 1
    assert item.triggering_predicted_grade == 84
    assert item.triggering_intervention_level == "MODERATE_RISK"
    detail = get_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    assert detail.diagnosis_snapshot == ctx["candidate"].diagnosis_snapshot
    assert "manual_assessment_coverage" in detail.diagnosis_snapshot
    assert "lowest_supported_competencies" in detail.diagnosis_snapshot


def test_teacher_http_contract_returns_scoped_candidate(candidate_context):
    ctx = candidate_context
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: {"role": "teacher", "sub": str(ctx["staff"].user_id)}
    app.dependency_overrides[get_db] = lambda: ctx["db"]
    client = TestClient(app)
    listed = client.get("/candidates")
    assert listed.status_code == 200
    assert listed.json()["total"] == 1
    detail = client.get(f"/candidates/{_id(ctx)}")
    assert detail.status_code == 200
    assert detail.json()["diagnosis_snapshot"] == ctx["candidate"].diagnosis_snapshot


def test_other_teacher_and_cross_paired_loads_cannot_see_or_activate(candidate_context):
    ctx = candidate_context
    other = _other_staff(ctx)
    assert list_teacher_candidates(ctx["db"], other.staff_id).total == 0
    for operation in (get_teacher_candidate, activate_teacher_candidate):
        with pytest.raises(HTTPException) as exc:
            operation(ctx["db"], other.staff_id, _id(ctx))
        assert exc.value.status_code == 403
    other_class = Class(
        section_name="Other", academic_year_id=ctx["class"].academic_year_id,
        academic_level_id=ctx["level"].academic_level_id,
    )
    other_subject = Subject(
        subject_name="English", subject_codename="ENGLISH",
        academic_level_id=ctx["level"].academic_level_id,
    )
    ctx["db"].add_all([other_class, other_subject])
    ctx["db"].flush()
    load = ctx["db"].query(SubjectLoad).filter_by(
        class_id=ctx["class"].class_id, subject_id=ctx["subject"].subject_id,
    ).one()
    load.staff_id = other.staff_id
    ctx["db"].add_all([
        SubjectLoad(staff_id=_staff(ctx), class_id=ctx["class"].class_id,
                    subject_id=other_subject.subject_id, academic_period_id=ctx["period"].academic_period_id,
                    status="published", is_active_version=True),
        SubjectLoad(staff_id=_staff(ctx), class_id=other_class.class_id,
                    subject_id=ctx["subject"].subject_id, academic_period_id=ctx["period"].academic_period_id,
                    status="published", is_active_version=True),
    ])
    ctx["db"].commit()
    assert list_teacher_candidates(ctx["db"], _staff(ctx)).total == 0
    with pytest.raises(HTTPException) as exc:
        get_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    assert exc.value.status_code == 403


@pytest.mark.parametrize("method,path", [
    ("get", "/candidates"),
    ("get", "/candidates/1"),
    ("post", "/candidates/1/activate"),
])
def test_admin_is_forbidden_by_route_role(candidate_context, method, path):
    ctx = candidate_context
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: {"role": "admin", "sub": str(ctx["staff"].user_id)}
    app.dependency_overrides[get_db] = lambda: ctx["db"]
    response = getattr(TestClient(app), method)(path)
    assert response.status_code == 403


def test_account_with_admin_membership_cannot_use_teacher_token(candidate_context):
    ctx = candidate_context
    ctx["db"].add(Role(role_id=9, role_name="Admin"))
    ctx["db"].add(UserRoles(user_id=ctx["staff"].user_id, role_id=9))
    ctx["db"].commit()
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_current_user] = lambda: {"role": "teacher", "sub": str(ctx["staff"].user_id)}
    app.dependency_overrides[get_db] = lambda: ctx["db"]
    client = TestClient(app)
    for method, path in (("get", "/candidates"), ("get", f"/candidates/{_id(ctx)}"),
                         ("post", f"/candidates/{_id(ctx)}/activate")):
        assert getattr(client, method)(path).status_code == 403


def test_production_gate_exposes_no_intervention_review(candidate_context, monkeypatch):
    ctx = candidate_context
    monkeypatch.setattr(settings, "app_environment", "production")
    with pytest.raises(HTTPException) as exc:
        require_development_intervention_api()
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    assert exc.value.status_code == 404


def test_valid_current_candidate_activates_once_without_resources(candidate_context, monkeypatch):
    ctx = candidate_context
    frozen = deepcopy(ctx["candidate"].diagnosis_snapshot)
    suggestions_before = ctx["db"].query(StudentSuggestion).count()
    from app.models.classwork.Classwork import Classwork
    classwork_before = ctx["db"].query(Classwork).count()
    result = activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    assert result.status == "ACTIVE"
    assert result.activated_by_staff_id == _staff(ctx)
    assert result.activated_at is not None
    assert result.diagnosis_snapshot == frozen
    assert ctx["db"].query(StudentSuggestion).count() == suggestions_before
    assert ctx["db"].query(Classwork).count() == classwork_before
    with pytest.raises(HTTPException) as exc:
        activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    assert exc.value.status_code == 409
    submission = ctx["db"].query(StudentSubmission).first()
    submission.grade = Decimal("1")
    ctx["db"].commit()
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features, model_name=None: 74)
    _run(ctx, ctx["model_id"])
    ctx["db"].expire_all()
    assert ctx["db"].get(Intervention, _id(ctx)).diagnosis_snapshot == frozen
    assert ctx["db"].get(Intervention, _id(ctx)).status == "ACTIVE"


def test_latest_improved_prediction_resolves_instead_of_activating(candidate_context, monkeypatch):
    ctx = candidate_context
    submission = ctx["db"].query(StudentSubmission).first()
    submission.grade = Decimal("1")
    ctx["db"].commit()
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features, model_name=None: 88)
    with pytest.raises(HTTPException) as exc:
        activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    assert exc.value.status_code == 409
    ctx["db"].expire_all()
    row = ctx["db"].get(Intervention, _id(ctx))
    assert row.status == "RESOLVED"
    assert row.resolution_reason == "IMPROVED_PREDICTION"
    assert row.activated_at is None


def test_later_low_revision_can_activate_with_original_trigger_preserved(candidate_context, monkeypatch):
    ctx = candidate_context
    original_prediction_id = ctx["candidate"].source_prediction_id
    submission = ctx["db"].query(StudentSubmission).first()
    submission.grade = Decimal("1")
    ctx["db"].commit()
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features, model_name=None: 74)
    activated = activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    assert activated.status == "ACTIVE"
    assert activated.source_prediction_id == original_prediction_id
    assert activated.triggering_predicted_grade == 84


def test_ungrading_blocks_activation_without_improvement(candidate_context):
    ctx = candidate_context
    for submission in ctx["db"].query(StudentSubmission).all()[1:]:
        submission.grade = None
    ctx["db"].commit()
    with pytest.raises(HTTPException) as exc:
        activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    assert exc.value.status_code == 409
    row = ctx["db"].get(Intervention, _id(ctx))
    assert row.status == "CANDIDATE"
    assert row.resolution_reason is None and row.activated_at is None


def test_resolved_candidate_and_finalized_period_cannot_activate(candidate_context):
    ctx = candidate_context
    grade = StudentPeriodGrade(
        student_id=ctx["student"].student_id, class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id, academic_period_id=ctx["period"].academic_period_id,
        is_finalized=True, final_period_grade=Decimal("80"),
    )
    ctx["db"].add(grade)
    ctx["db"].commit()
    with pytest.raises(HTTPException) as exc:
        activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    assert exc.value.status_code == 409
    row = ctx["db"].get(Intervention, _id(ctx))
    assert row.status == "CANDIDATE"
    grade.is_finalized = False
    row.status = "RESOLVED"
    row.resolution_reason = "IMPROVED_PREDICTION"
    row.resolved_at = datetime.now(timezone.utc)
    ctx["db"].commit()
    with pytest.raises(HTTPException) as exc:
        activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    assert exc.value.status_code == 409

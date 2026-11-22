"""Targeted tests for Task 4: Teacher-Controlled ACTIVE Intervention Resolution."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.TeacherInterventions import router
from app.db.Session import get_db
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationReadingPrerequisite import RemediationReadingPrerequisite
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.models.notifications.Notification import Notification
from app.models.people.AcademicStaff import AcademicStaff
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.RemediationPrerequisiteService import (
    evaluate_remediation_prerequisite,
)
from app.services.intervention.TeacherInterventionService import (
    activate_teacher_candidate,
    continue_teacher_active_intervention,
    get_teacher_active,
    list_teacher_active,
    resolve_teacher_active_intervention,
)
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from tests.test_current_period_live_feature_builder import add_activity, current_period_context  # noqa: F401
from tests.test_development_current_term_prediction_persistence import _run
from tests.test_intervention_candidate_sync import _interventions, _setup


def _setup_active_context(ctx, monkeypatch, initial_grade: float = 82.0):
    db = ctx["db"]
    if not db.query(Role).filter_by(role_id=1).first():
        db.add(Role(role_id=1, role_name="teacher"))
    if not db.query(Role).filter_by(role_id=2).first():
        db.add(Role(role_id=2, role_name="admin"))
    db.flush()
    if not db.query(UserRoles).filter_by(user_id=ctx["staff"].user_id, role_id=1).first():
        db.add(UserRoles(user_id=ctx["staff"].user_id, role_id=1))
    if not db.query(StudentClass).filter_by(
        student_id=ctx["student"].student_id,
        academic_year_id=ctx["class"].academic_year_id,
    ).first():
        db.add(StudentClass(
            student_id=ctx["student"].student_id,
            class_id=ctx["class"].class_id,
            academic_year_id=ctx["class"].academic_year_id,
            enrollment_status="enrolled",
        ))
    load = db.query(SubjectLoad).filter_by(
        staff_id=ctx["staff"].staff_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
    ).first()
    if load is None:
        load = SubjectLoad(
            staff_id=ctx["staff"].staff_id,
            class_id=ctx["class"].class_id,
            subject_id=ctx["subject"].subject_id,
            academic_period_id=ctx["period"].academic_period_id,
            status="published",
            is_active_version=True,
        )
        db.add(load)
    else:
        load.status = "published"
        load.is_active_version = True
    db.commit()

    model_id = _setup(ctx, monkeypatch, [initial_grade, initial_grade])
    first = _run(ctx, model_id)
    candidate = db.query(Intervention).filter_by(source_prediction_id=first["prediction_id"]).one()
    activate_teacher_candidate(db, ctx["staff"].staff_id, candidate.intervention_id)
    db.expire_all()
    active = db.get(Intervention, candidate.intervention_id)
    assert active is not None and active.status == "ACTIVE"
    return active, model_id


def _add_remediation_activity(ctx, intervention_id: int, *, status: str | None = None, title: str = "Remediation Quiz"):
    db = ctx["db"]
    reading_cw = Classwork(
        title=f"Reading for {title}",
        classwork_type="READING",
        is_graded=False,
        total_points=None,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=ctx["staff"].staff_id,
        is_published=True,
    )
    rem_cw = Classwork(
        title=title,
        classwork_type="QUIZ",
        classwork_category="WRITTEN_WORK",
        is_graded=True,
        total_points=Decimal("10"),
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=ctx["staff"].staff_id,
        is_published=True,
        show_scores=True,
    )
    db.add_all([reading_cw, rem_cw])
    db.flush()
    reading_asgn = ClassworkAssignment(
        classwork_id=reading_cw.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=ctx["staff"].staff_id,
        is_published=True,
    )
    rem_asgn = ClassworkAssignment(
        classwork_id=rem_cw.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        recipient_student_id=ctx["student"].student_id,
        source_intervention_id=intervention_id,
        remediation_request_id=uuid4(),
        assigned_by_staff_id=ctx["staff"].staff_id,
        is_published=True,
        due_date=datetime.now(timezone.utc) + timedelta(days=7),
        max_attempts=3,
    )
    db.add_all([reading_asgn, rem_asgn])
    db.flush()
    db.add(RemediationReadingPrerequisite(
        remediation_assignment_id=rem_asgn.classwork_assignment_id,
        reading_classwork_id=reading_cw.classwork_id,
        reading_assignment_id=reading_asgn.classwork_assignment_id,
        display_order=1,
    ))
    db.add(InterventionReadingReview(
        intervention_id=intervention_id,
        reading_assignment_id=reading_asgn.classwork_assignment_id,
        student_id=ctx["student"].student_id,
        review_cycle=1,
    ))
    if status is not None:
        db.add(StudentSubmission(
            student_id=ctx["student"].student_id,
            classwork_assignment_id=rem_asgn.classwork_assignment_id,
            status=status,
            grade=Decimal("9") if status == "graded" else None,
            attempt_count=1 if status == "graded" else 0,
            submitted_at=datetime.now(timezone.utc) if status != "pending" else None,
            graded_at=datetime.now(timezone.utc) if status == "graded" else None,
        ))
    db.commit()
    return rem_asgn


def test_improved_prediction_keeps_active_open_and_notifies_teacher_once(
    current_period_context, monkeypatch,
):
    ctx = current_period_context
    active, model_id = _setup_active_context(ctx, monkeypatch, initial_grade=82.0)

    # Prediction improves to >= 87.0 -> stays ACTIVE and notifies teacher once
    add_activity(ctx, "PERFORMANCE_TASK", 19, 20)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda *_args, **_kwargs: 88.5)
    _run(ctx, model_id)

    ctx["db"].expire_all()
    row = ctx["db"].get(Intervention, active.intervention_id)
    assert row.status == "ACTIVE"
    assert row.resolved_at is None
    assert row.resolution_reason is None

    recommended_notifs = ctx["db"].query(Notification).filter_by(
        user_id=ctx["staff"].user_id,
        notification_type="intervention_resolution_recommended",
    ).all()
    assert len(recommended_notifs) == 1
    assert recommended_notifs[0].action_url == f"/teacher/interventions?view=active&active={active.intervention_id}"
    assert ctx["db"].query(Notification).filter_by(
        user_id=ctx["staff"].user_id,
        notification_type="intervention_resolved",
    ).count() == 0

    detail = get_teacher_active(ctx["db"], ctx["staff"].staff_id, active.intervention_id)
    assert detail.resolution_recommended is True
    assert detail.resolution_recommendation_reason == "TARGET_REACHED"
    assert detail.can_confirm_resolution is True

    # A second passing prediction revision must NOT duplicate the notification
    add_activity(ctx, "WRITTEN_WORK", 10, 10)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda *_args, **_kwargs: 90.0)
    _run(ctx, model_id)

    recommended_notifs_after = ctx["db"].query(Notification).filter_by(
        user_id=ctx["staff"].user_id,
        notification_type="intervention_resolution_recommended",
    ).all()
    assert len(recommended_notifs_after) == 1


def test_continue_support_keeps_active_and_protects_ongoing_remediation_attempt(
    current_period_context, monkeypatch,
):
    ctx = current_period_context
    active, model_id = _setup_active_context(ctx, monkeypatch, initial_grade=82.0)
    in_progress_asgn = _add_remediation_activity(
        ctx, active.intervention_id, status="pending", title="Ongoing Remediation Quiz",
    )

    add_activity(ctx, "PERFORMANCE_TASK", 19, 20)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda *_args, **_kwargs: 88.0)
    _run(ctx, model_id)

    # Ongoing remediation attempt stays unlocked because intervention remains ACTIVE
    prereq = evaluate_remediation_prerequisite(ctx["db"], in_progress_asgn, ctx["student"])
    assert prereq.allowed is True

    summary_before = list_teacher_active(ctx["db"], ctx["staff"].staff_id).items[0]
    assert summary_before.resolution_recommended is True
    assert summary_before.unfinished_remediation_count == 1
    assert summary_before.has_in_progress_remediation is True

    continued = continue_teacher_active_intervention(ctx["db"], ctx["staff"].staff_id, active.intervention_id)
    assert continued.status == "ACTIVE"
    assert continued.resolved_at is None
    assert continued.resolution_recommended is False
    assert continued.resolution_recommendation_reason == "CONTINUED_BY_TEACHER"
    assert continued.can_confirm_resolution is True
    assert continued.resolution_continued_by_staff_id == ctx["staff"].staff_id
    assert continued.resolution_continued_at is not None

    # Ongoing attempt remains unlocked after Continue Support
    prereq_after = evaluate_remediation_prerequisite(ctx["db"], in_progress_asgn, ctx["student"])
    assert prereq_after.allowed is True


def test_resolve_intervention_revalidates_preserves_history_and_handles_unfinished_work(
    current_period_context, monkeypatch,
):
    ctx = current_period_context
    active, model_id = _setup_active_context(ctx, monkeypatch, initial_grade=82.0)
    original_source_id = active.source_prediction_id
    frozen_snapshot = deepcopy(active.diagnosis_snapshot)
    completed_asgn = _add_remediation_activity(
        ctx, active.intervention_id, status="graded", title="Completed Remediation Quiz",
    )
    unfinished_asgn = _add_remediation_activity(
        ctx, active.intervention_id, status="pending", title="Unfinished Remediation Quiz",
    )

    add_activity(ctx, "PERFORMANCE_TASK", 19, 20)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda *_args, **_kwargs: 89.0)
    _run(ctx, model_id)

    resolved = resolve_teacher_active_intervention(ctx["db"], ctx["staff"].staff_id, active.intervention_id)
    assert resolved.status == "RESOLVED"
    assert resolved.resolution_reason == "IMPROVED_PREDICTION"
    assert resolved.resolved_at is not None
    assert resolved.source_prediction_id == original_source_id
    assert resolved.diagnosis_snapshot == frozen_snapshot
    assert resolved.resolution_projection == 89.0

    # Completed remediation remains reviewable in read-only mode; unfinished closes to new submissions
    completed_review = evaluate_remediation_prerequisite(
        ctx["db"], completed_asgn, ctx["student"], allow_completed_resolved_review=True,
    )
    assert completed_review.allowed is True
    unfinished_check = evaluate_remediation_prerequisite(ctx["db"], unfinished_asgn, ctx["student"])
    assert unfinished_check.allowed is False
    assert unfinished_check.code == "INTERVENTION_NOT_ACTIVE"

    # Re-resolving an already resolved intervention fails with 409
    with pytest.raises(HTTPException) as repeat:
        resolve_teacher_active_intervention(ctx["db"], ctx["staff"].staff_id, active.intervention_id)
    assert repeat.value.status_code == 409


def test_resolve_intervention_rejects_when_revalidated_prediction_drops_below_target(
    current_period_context, monkeypatch,
):
    ctx = current_period_context
    active, model_id = _setup_active_context(ctx, monkeypatch, initial_grade=82.0)

    # First reaches target -> recommended
    add_activity(ctx, "PERFORMANCE_TASK", 19, 20)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda *_args, **_kwargs: 88.5)
    _run(ctx, model_id)
    assert get_teacher_active(ctx["db"], ctx["staff"].staff_id, active.intervention_id).resolution_recommended is True

    # Live evidence worsens before teacher confirms resolution
    add_activity(ctx, "WRITTEN_WORK", 1, 10)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda *_args, **_kwargs: 80.0)

    with pytest.raises(HTTPException) as exc:
        resolve_teacher_active_intervention(ctx["db"], ctx["staff"].staff_id, active.intervention_id)
    assert exc.value.status_code == 409
    assert "below the passing threshold" in str(exc.value.detail).lower()

    ctx["db"].expire_all()
    row = ctx["db"].get(Intervention, active.intervention_id)
    assert row.status == "ACTIVE"
    assert row.resolved_at is None
    assert row.resolution_reason is None


def test_candidate_still_auto_resolves_when_target_reached(
    current_period_context, monkeypatch,
):
    ctx = current_period_context
    db = ctx["db"]
    db.add(Role(role_id=1, role_name="teacher"))
    db.flush()
    db.add(UserRoles(user_id=ctx["staff"].user_id, role_id=1))
    load = db.query(SubjectLoad).filter_by(
        staff_id=ctx["staff"].staff_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
    ).one()
    load.status = "published"
    load.is_active_version = True
    db.commit()

    model_id = _setup(ctx, monkeypatch, [83.0, 88.0])
    _run(ctx, model_id)
    assert _interventions(ctx)[0].status == "CANDIDATE"

    add_activity(ctx, "PERFORMANCE_TASK", 19, 20)
    _run(ctx, model_id)
    row = _interventions(ctx)[0]
    assert row.status == "RESOLVED"
    assert row.resolution_reason == "IMPROVED_PREDICTION"
    assert row.activated_at is None

    types = [
        n.notification_type
        for n in db.query(Notification).filter_by(user_id=ctx["staff"].user_id).all()
    ]
    assert "intervention_resolved" in types
    assert "intervention_resolution_recommended" not in types


def test_teacher_authorization_enforced_on_continue_and_resolve_endpoints(
    current_period_context, monkeypatch,
):
    ctx = current_period_context
    active, model_id = _setup_active_context(ctx, monkeypatch, initial_grade=82.0)

    add_activity(ctx, "PERFORMANCE_TASK", 19, 20)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda *_args, **_kwargs: 89.0)
    _run(ctx, model_id)

    other_user = UserAccount(user_id=uuid4(), email="other-teacher@example.test")
    other_staff = AcademicStaff(staff_id="T-OTHER", first_name="Other", last_name="Teacher", user_id=other_user.user_id)
    ctx["db"].add_all([other_user, other_staff])
    ctx["db"].flush()
    ctx["db"].add(UserRoles(user_id=other_user.user_id, role_id=1))
    ctx["db"].commit()

    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_db] = lambda: ctx["db"]

    # Unassigned teacher -> 403
    app.dependency_overrides[get_current_user] = lambda: {"role": "teacher", "sub": str(other_user.user_id)}
    client = TestClient(app)
    assert client.post(f"/active/{active.intervention_id}/continue").status_code == 403
    assert client.post(f"/active/{active.intervention_id}/resolve").status_code == 403

    # Admin and student roles -> 403
    for role in ("admin", "student"):
        app.dependency_overrides[get_current_user] = lambda role=role: {"role": role, "sub": str(ctx["staff"].user_id)}
        assert client.post(f"/active/{active.intervention_id}/continue").status_code == 403
        assert client.post(f"/active/{active.intervention_id}/resolve").status_code == 403

    # Responsible teacher -> 200 for continue and resolve
    app.dependency_overrides[get_current_user] = lambda: {"role": "teacher", "sub": str(ctx["staff"].user_id)}
    res_cont = client.post(f"/active/{active.intervention_id}/continue")
    assert res_cont.status_code == 200
    assert res_cont.json()["status"] == "ACTIVE"
    assert res_cont.json()["resolution_recommended"] is False

    res_resolve = client.post(f"/active/{active.intervention_id}/resolve")
    assert res_resolve.status_code == 200
    assert res_resolve.json()["status"] == "RESOLVED"
    assert res_resolve.json()["resolution_reason"] == "IMPROVED_PREDICTION"

"""Read-only resolved history reuses stored work and enforces exact scopes."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.StudentPersistentInterventions import router as student_router
from app.api.v1.routes.StudentInterventionReviewers import router as reviewer_router
from app.api.v1.routes.TeacherInterventions import router as teacher_router
from app.db.Session import get_db
from app.models.academic.StudentCLass import StudentClass
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionSupportMaterial import InterventionSupportMaterial
from app.models.people.Student import Student
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.InterventionSupportMaterialService import create_material
from app.services.intervention.TeacherInterventionService import (
    activate_teacher_candidate,
    get_teacher_active,
    get_teacher_resolved,
    list_teacher_active,
    list_teacher_resolved,
)
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_teacher_intervention_review import candidate_context, _id, _other_staff, _staff


def _client(ctx, router, prefix, role, user_id):
    app = FastAPI()
    app.include_router(router, prefix=prefix)
    app.dependency_overrides[get_db] = lambda: ctx["db"]
    app.dependency_overrides[get_current_user] = lambda: {"role": role, "sub": str(user_id)}
    return TestClient(app)


def test_resolved_history_is_scoped_read_only_and_preserves_stored_records(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    own_account = UserAccount(user_id=uuid4(), email=f"history-{uuid4().hex[:8]}@example.test")
    other_account = UserAccount(user_id=uuid4(), email=f"classmate-{uuid4().hex[:8]}@example.test")
    other_student = Student(student_id=uuid4(), student_lrn="300000000097", first_name="Other", last_name="Student", user_id=other_account.user_id)
    db.add_all([own_account, other_account, other_student])
    db.flush()
    ctx["student"].user_id = own_account.user_id
    db.add(StudentClass(student_id=other_student.student_id, class_id=ctx["class"].class_id,
                        academic_year_id=ctx["class"].academic_year_id, enrollment_status="enrolled"))
    db.commit()
    teacher = _client(ctx, teacher_router, "/teacher/interventions", "teacher", ctx["staff"].user_id)
    student = _client(ctx, student_router, "/student/interventions", "student", own_account.user_id)
    reviewers = _client(ctx, reviewer_router, "/student/intervention-reviewers", "student", own_account.user_id)
    classmate = _client(ctx, student_router, "/student/interventions", "student", other_account.user_id)
    path = f"/teacher/interventions/resolved/{_id(ctx)}"
    student_path = f"/student/interventions/resolved/{_id(ctx)}"

    assert teacher.get("/teacher/interventions/resolved").json()["total"] == 0
    assert student.get("/student/interventions/resolved").json()["items"] == []
    activate_teacher_candidate(db, _staff(ctx), _id(ctx))
    assert teacher.get("/teacher/interventions/resolved").json()["total"] == 0

    work = Classwork(title="Targeted practice", classwork_type="QUIZ", subject_id=ctx["subject"].subject_id,
                     created_by_staff_id=_staff(ctx), is_published=True, show_scores=True, total_points=Decimal("10"))
    db.add(work)
    db.flush()
    db.add(QuizSetting(
        classwork_id=work.classwork_id,
        show_correct_answers=True,
        summary_release_mode="IMMEDIATE",
    ))
    assignment = ClassworkAssignment(classwork_id=work.classwork_id, class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id, assigned_by_staff_id=_staff(ctx), is_published=True,
        recipient_student_id=ctx["student"].student_id, source_intervention_id=_id(ctx), remediation_request_id=uuid4())
    db.add(assignment)
    db.flush()
    submission = StudentSubmission(student_id=ctx["student"].student_id,
        classwork_assignment_id=assignment.classwork_assignment_id, status="graded", grade=Decimal("8"))
    db.add(submission)

    hidden_work = Classwork(title="Hidden quiz", classwork_type="QUIZ", subject_id=ctx["subject"].subject_id,
                            created_by_staff_id=_staff(ctx), is_published=True, show_scores=False, total_points=Decimal("10"))
    db.add(hidden_work)
    db.flush()
    hidden_assignment = ClassworkAssignment(classwork_id=hidden_work.classwork_id, class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id, assigned_by_staff_id=_staff(ctx), is_published=True,
        recipient_student_id=ctx["student"].student_id, source_intervention_id=_id(ctx), remediation_request_id=uuid4())
    db.add(hidden_assignment)
    db.flush()
    db.add(StudentSubmission(student_id=ctx["student"].student_id,
        classwork_assignment_id=hidden_assignment.classwork_assignment_id, status="graded", grade=Decimal("7")))
    draft = create_material(db, _staff(ctx), _id(ctx), "STUDENT_REVIEWER")
    row = ctx["candidate"]
    frozen = row.diagnosis_snapshot.copy()
    source_id = row.source_prediction_id
    row.status = "RESOLVED"
    row.resolution_reason = "IMPROVED_PREDICTION"
    row.resolved_at = datetime.now(timezone.utc)
    db.commit()

    listed = teacher.get("/teacher/interventions/resolved")
    assert listed.status_code == 200 and listed.json()["total"] == 1
    assert listed.json()["items"][0]["resolution_reason"] == "IMPROVED_PREDICTION"
    detail = teacher.get(path)
    assert detail.status_code == 200
    teacher_data = detail.json()
    assert teacher_data["source_prediction_id"] == source_id
    assert teacher_data["diagnosis_snapshot"] == frozen
    assert teacher_data["resolved_at"] is not None
    assert teacher_data["targeted_activities"][0]["grade"] == 8
    assert teacher_data["targeted_activities"][1]["grade"] == 7
    assert teacher_data["sent_reviewer"] is None
    assert teacher.get(f"/teacher/interventions/active/{_id(ctx)}").status_code == 404
    assert teacher.put(f"/teacher/interventions/{_id(ctx)}/remediation", json={}).status_code == 409
    assert teacher.post(f"/teacher/interventions/{_id(ctx)}/materials", json={"kind": "STUDENT_REVIEWER"}).status_code == 409

    own_history = student.get("/student/interventions/resolved").json()["items"]
    assert len(own_history) == 1 and own_history[0]["status"] == "RESOLVED"
    own_detail = student.get(student_path)
    assert own_detail.status_code == 200
    student_data = own_detail.json()
    assert student_data["activities"][0]["grade"] == 8
    assert student_data["activities"][1]["grade"] is None
    assert student_data["resolution_message"] == "Your progress reached the goal for this support."
    assert student_data["reviewer_id"] is None
    assert reviewers.get(f"/student/intervention-reviewers/{draft.material_id}").status_code == 404
    assert not any(key in student_data for key in ("diagnosis_snapshot", "source_prediction_id", "resolution_reason", "resolution_projection"))
    assert student.get(f"/student/interventions/{_id(ctx)}").status_code == 404
    assert classmate.get("/student/interventions/resolved").json()["items"] == []
    assert classmate.get(student_path).status_code == 404

    other_teacher = _other_staff(ctx)
    outsider = _client(ctx, teacher_router, "/teacher/interventions", "teacher", other_teacher.user_id)
    assert outsider.get("/teacher/interventions/resolved").json()["total"] == 0
    assert outsider.get(path).status_code == 404
    admin = _client(ctx, teacher_router, "/teacher/interventions", "admin", ctx["staff"].user_id)
    assert admin.get("/teacher/interventions/resolved").status_code == 403
    assert admin.get(path).status_code == 403

    material = db.get(InterventionSupportMaterial, draft.material_id)
    material.status = "SENT"
    material.sent_at = datetime.now(timezone.utc)
    material.sent_by_staff_id = _staff(ctx)
    material.current_content = {"title": "Review", "introduction": "Read this", "body": "Practice ratios"}
    db.commit()
    assert student.get(student_path).json()["reviewer_id"] == draft.material_id
    assert reviewers.get(f"/student/intervention-reviewers/{draft.material_id}").json()["body"] == "Practice ratios"
    assert teacher.get(path).json()["sent_reviewer"]["body"] == "Practice ratios"
    assert row.diagnosis_snapshot == frozen and row.source_prediction_id == source_id
    assert db.get(StudentSubmission, submission.submission_id).grade == 8


def _make_prediction(
    ctx,
    *,
    revision: int,
    raw_grade: float,
    intervention_level: str,
    generated_at: datetime,
) -> DevelopmentCurrentTermPrediction:
    return DevelopmentCurrentTermPrediction(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        source_period_id=ctx["period"].academic_period_id,
        target_period_id=ctx["period"].academic_period_id,
        model_version_id=ctx["model_id"],
        revision=revision,
        predicted_period_grade=Decimal(f"{raw_grade:.2f}"),
        intervention_level=intervention_level,
        intervention_basis="DEVELOPMENT_CURRENT_TERM_PROJECTION",
        evidence_snapshot={
            "readiness": {"status": "READY"},
            "projected_final_term_grade_raw": raw_grade,
        },
        generated_at=generated_at,
    )


def test_resolved_intervention_keeps_resolution_prediction_across_later_cycles(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = _staff(ctx)
    ctx["template"].passing_threshold = Decimal("85.00")
    base_time = datetime(2026, 11, 19, 1, 0, 0, tzinfo=timezone.utc)

    cycle1 = ctx["candidate"]
    source1 = db.get(DevelopmentCurrentTermPrediction, cycle1.source_prediction_id)
    source1.predicted_period_grade = Decimal("82.55")
    source1.evidence_snapshot = {
        "readiness": {"status": "READY"},
        "projected_final_term_grade_raw": 82.55,
    }
    source1.intervention_level = "MODERATE_RISK"
    source1.generated_at = base_time

    rev2 = _make_prediction(
        ctx,
        revision=2,
        raw_grade=83.10,
        intervention_level="MODERATE_RISK",
        generated_at=base_time + timedelta(minutes=15),
    )
    rev3 = _make_prediction(
        ctx,
        revision=3,
        raw_grade=85.35548749398748,
        intervention_level="NEEDS_MONITORING",
        generated_at=base_time + timedelta(minutes=34),
    )
    rev4 = _make_prediction(
        ctx,
        revision=4,
        raw_grade=82.89,
        intervention_level="MODERATE_RISK",
        generated_at=base_time + timedelta(minutes=44),
    )
    rev8 = _make_prediction(
        ctx,
        revision=8,
        raw_grade=82.7495322270322,
        intervention_level="MODERATE_RISK",
        generated_at=base_time + timedelta(hours=11),
    )
    db.add_all([rev2, rev3, rev4, rev8])
    db.flush()

    cycle1.status = "RESOLVED"
    cycle1.activated_at = base_time + timedelta(minutes=5)
    cycle1.activated_by_staff_id = staff_id
    cycle1.resolution_reason = "IMPROVED_PREDICTION"
    cycle1.resolved_at = base_time + timedelta(minutes=34, seconds=1)

    cycle2 = Intervention(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        source_prediction_id=rev4.prediction_id,
        status="ACTIVE",
        diagnosis_snapshot=cycle1.diagnosis_snapshot,
        activated_at=base_time + timedelta(minutes=45),
        activated_by_staff_id=staff_id,
    )
    db.add(cycle2)
    db.commit()

    resolved_list = list_teacher_resolved(db, staff_id)
    assert resolved_list.total == 1
    resolved_summary = resolved_list.items[0]
    assert resolved_summary.intervention_id == cycle1.intervention_id
    assert resolved_summary.source_prediction_revision == 1
    assert resolved_summary.triggering_predicted_grade == pytest.approx(82.55)
    assert resolved_summary.triggering_intervention_level == "MODERATE_RISK"
    assert resolved_summary.current_prediction_revision == 3
    assert resolved_summary.current_predicted_grade == pytest.approx(85.35548749398748)
    assert resolved_summary.current_intervention_level == "NEEDS_MONITORING"

    resolved_detail = get_teacher_resolved(db, staff_id, cycle1.intervention_id)
    assert resolved_detail.current_prediction_revision == 3
    assert resolved_detail.current_predicted_grade == pytest.approx(85.35548749398748)
    assert resolved_detail.current_intervention_level == "NEEDS_MONITORING"
    assert resolved_detail.resolution_projection == pytest.approx(85.35548749398748)

    active_list = list_teacher_active(db, staff_id)
    assert active_list.total == 1
    active_summary = active_list.items[0]
    assert active_summary.intervention_id == cycle2.intervention_id
    assert active_summary.source_prediction_revision == 4
    assert active_summary.triggering_predicted_grade == pytest.approx(82.89)
    assert active_summary.current_prediction_revision == 8
    assert active_summary.current_predicted_grade == pytest.approx(82.7495322270322)
    assert active_summary.current_intervention_level == "MODERATE_RISK"

    active_detail = get_teacher_active(db, staff_id, cycle2.intervention_id)
    assert active_detail.current_prediction_revision == 8
    assert active_detail.current_predicted_grade == pytest.approx(82.7495322270322)
    assert active_detail.current_intervention_level == "MODERATE_RISK"

    teacher = _client(ctx, teacher_router, "/teacher/interventions", "teacher", ctx["staff"].user_id)
    http_resolved = teacher.get("/teacher/interventions/resolved").json()["items"][0]
    assert round(http_resolved["current_predicted_grade"], 2) == 85.36
    assert http_resolved["current_intervention_level"] == "NEEDS_MONITORING"
    http_active = teacher.get("/teacher/interventions/active").json()["items"][0]
    assert round(http_active["current_predicted_grade"], 2) == 82.75
    assert http_active["current_intervention_level"] == "MODERATE_RISK"


def test_resolved_intervention_excludes_next_cycle_even_at_identical_timestamp(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = _staff(ctx)
    ctx["template"].passing_threshold = Decimal("85.00")
    shared_ts = datetime(2026, 11, 19, 2, 0, 0, tzinfo=timezone.utc)

    cycle1 = ctx["candidate"]
    source1 = db.get(DevelopmentCurrentTermPrediction, cycle1.source_prediction_id)
    source1.generated_at = shared_ts - timedelta(minutes=10)

    rev2_resolved = _make_prediction(
        ctx,
        revision=2,
        raw_grade=85.36,
        intervention_level="NEEDS_MONITORING",
        generated_at=shared_ts,
    )
    rev3_next_cycle = _make_prediction(
        ctx,
        revision=3,
        raw_grade=82.75,
        intervention_level="MODERATE_RISK",
        generated_at=shared_ts,
    )
    db.add_all([rev2_resolved, rev3_next_cycle])
    db.flush()

    cycle1.status = "RESOLVED"
    cycle1.resolution_reason = "IMPROVED_PREDICTION"
    cycle1.resolved_at = shared_ts

    cycle2 = Intervention(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        source_prediction_id=rev3_next_cycle.prediction_id,
        status="ACTIVE",
        diagnosis_snapshot=cycle1.diagnosis_snapshot,
        activated_at=shared_ts,
        activated_by_staff_id=staff_id,
    )
    db.add(cycle2)
    db.commit()

    resolved_detail = get_teacher_resolved(db, staff_id, cycle1.intervention_id)
    assert resolved_detail.current_prediction_revision == 2
    assert resolved_detail.current_predicted_grade == pytest.approx(85.36)
    assert resolved_detail.current_intervention_level == "NEEDS_MONITORING"
    assert resolved_detail.resolution_projection == pytest.approx(85.36)

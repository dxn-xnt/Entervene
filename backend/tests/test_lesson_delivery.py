"""Tests for teacher-verified lesson delivery foundation (PR 2B.1).

Verifies:
- Teacher confirmation and server-recorded delivery timestamp
- Repeated requests (idempotency)
- Corrections with audit trail and revocation
- Re-confirmation after correction
- Separation of Published, Lesson Goal, and Taught concepts
- Cross-class authorization blocking (403)
- Academic scope and year consistency validation (409)
- Historical cutoff behavior (as-of queries)
- Protection against retroactive changes to frozen intervention evidence (409)
- FastAPI HTTP endpoint contracts
- Alembic migration upgrade/downgrade on disposable database
"""

from __future__ import annotations

import importlib
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect, text

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.LessonDeliveries import router as lesson_deliveries_router
from app.core.Dependencies import get_staff_id, require_role
from app.db.Session import get_db
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.LessonDelivery import LessonDelivery
from app.models.academic.LessonGoal import LessonGoal, LessonGoalItem
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.intervention.Intervention import Intervention
from app.models.people.AcademicStaff import AcademicStaff
from app.schemas.lesson_delivery import (
    LessonDeliveryConfirmRequest,
    LessonDeliveryCorrectionRequest,
)
from app.services.lesson.LessonDeliveryService import (
    confirm_lesson_delivery,
    correct_lesson_delivery,
    get_active_deliveries_as_of,
    get_delivered_lesson_ids_as_of,
    get_delivery_history,
    get_lesson_delivery_status,
    is_lesson_delivered_as_of,
)
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_teacher_intervention_review import candidate_context


def _utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt.astimezone(timezone.utc)


def _setup_second_class(ctx, db):
    """Create a second class and subject load for cross-class authorization tests."""
    class_b = Class(
        section_name="Grade 9 - Newton",
        class_status="active",
        academic_year_id=ctx["class"].academic_year_id,
        academic_level_id=ctx["class"].academic_level_id,
    )
    other_teacher = AcademicStaff(
        staff_id=f"TCH-OTHER-{uuid4().hex[:6]}",
        first_name="Jane",
        last_name="Smith",
    )
    db.add_all([class_b, other_teacher])
    db.flush()

    load_b = SubjectLoad(
        staff_id=other_teacher.staff_id,
        class_id=class_b.class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        status="published",
        is_active_version=True,
    )
    db.add(load_b)
    db.commit()
    return class_b, other_teacher


def test_confirm_lesson_delivery_creates_active_record(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = ctx["staff"].staff_id

    lesson = Lesson(
        title="Quadratic Equations Intro",
        subject_id=ctx["subject"].subject_id,
        is_published=True,
    )
    db.add(lesson)
    db.commit()

    before = datetime.now(timezone.utc) - timedelta(seconds=1)
    delivery = confirm_lesson_delivery(
        db=db,
        lesson_id=lesson.lesson_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        staff_id=staff_id,
    )
    after = datetime.now(timezone.utc) + timedelta(seconds=1)

    assert delivery.delivery_id is not None
    assert delivery.lesson_id == lesson.lesson_id
    assert delivery.class_id == ctx["class"].class_id
    assert delivery.subject_id == ctx["subject"].subject_id
    assert delivery.academic_period_id == ctx["period"].academic_period_id
    assert delivery.delivered_by_staff_id == staff_id
    assert delivery.revoked_at is None
    assert delivery.revoked_by_staff_id is None
    assert delivery.correction_reason is None
    assert before <= _utc(delivery.delivered_at) <= after


def test_repeated_requests_are_idempotent(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = ctx["staff"].staff_id

    lesson = Lesson(
        title="Idempotency Test Lesson",
        subject_id=ctx["subject"].subject_id,
    )
    db.add(lesson)
    db.commit()

    first = confirm_lesson_delivery(
        db=db,
        lesson_id=lesson.lesson_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        staff_id=staff_id,
    )
    second = confirm_lesson_delivery(
        db=db,
        lesson_id=lesson.lesson_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        staff_id=staff_id,
    )

    assert first.delivery_id == second.delivery_id
    assert db.query(LessonDelivery).filter_by(lesson_id=lesson.lesson_id).count() == 1


def test_correction_sets_audit_trail_and_revocation(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = ctx["staff"].staff_id

    lesson = Lesson(
        title="Correctable Delivery Lesson",
        subject_id=ctx["subject"].subject_id,
    )
    db.add(lesson)
    db.commit()

    delivery = confirm_lesson_delivery(
        db=db,
        lesson_id=lesson.lesson_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        staff_id=staff_id,
    )

    reason = "Taught only up to halfway through slides; moved full delivery to next session"
    corrected = correct_lesson_delivery(
        db=db,
        delivery_id=delivery.delivery_id,
        reason=reason,
        staff_id=staff_id,
    )

    assert corrected.delivery_id == delivery.delivery_id
    assert corrected.revoked_at is not None
    assert corrected.revoked_by_staff_id == staff_id
    assert corrected.correction_reason == reason
    assert is_lesson_delivered_as_of(
        db, lesson.lesson_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id
    ) is False

    # Second correction attempt on already revoked record raises 409 Conflict
    with pytest.raises(HTTPException) as conflict:
        correct_lesson_delivery(
            db=db,
            delivery_id=delivery.delivery_id,
            reason="Already revoked correction attempt",
            staff_id=staff_id,
        )
    assert conflict.value.status_code == 409


def test_reconfirm_after_correction_creates_new_record_and_preserves_history(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = ctx["staff"].staff_id

    lesson = Lesson(
        title="Reconfirmed Lesson",
        subject_id=ctx["subject"].subject_id,
    )
    db.add(lesson)
    db.commit()

    first = confirm_lesson_delivery(
        db=db,
        lesson_id=lesson.lesson_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        staff_id=staff_id,
    )
    correct_lesson_delivery(
        db=db,
        delivery_id=first.delivery_id,
        reason="Mistakenly logged earlier",
        staff_id=staff_id,
    )

    # Re-confirming creates a second, active record
    second = confirm_lesson_delivery(
        db=db,
        lesson_id=lesson.lesson_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        staff_id=staff_id,
    )

    assert second.delivery_id != first.delivery_id
    assert second.revoked_at is None
    assert is_lesson_delivered_as_of(
        db, lesson.lesson_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id
    ) is True

    history = get_delivery_history(
        db, lesson.lesson_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id
    )
    assert len(history) == 2
    assert history[0].delivery_id == second.delivery_id
    assert history[1].delivery_id == first.delivery_id


def test_cross_class_authorization_denied(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = ctx["staff"].staff_id
    class_b, other_teacher = _setup_second_class(ctx, db)

    lesson = Lesson(
        title="Class B Exclusive Lesson",
        subject_id=ctx["subject"].subject_id,
    )
    db.add(lesson)
    db.commit()

    # Teacher A cannot confirm delivery for Class B (403 Forbidden)
    with pytest.raises(HTTPException) as forbidden_confirm:
        confirm_lesson_delivery(
            db=db,
            lesson_id=lesson.lesson_id,
            class_id=class_b.class_id,
            subject_id=ctx["subject"].subject_id,
            academic_period_id=ctx["period"].academic_period_id,
            staff_id=staff_id,
        )
    assert forbidden_confirm.value.status_code == 403

    # Teacher B confirms delivery in Class B
    delivery_b = confirm_lesson_delivery(
        db=db,
        lesson_id=lesson.lesson_id,
        class_id=class_b.class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        staff_id=other_teacher.staff_id,
    )

    # Teacher A cannot correct delivery in Class B (403 Forbidden)
    with pytest.raises(HTTPException) as forbidden_correct:
        correct_lesson_delivery(
            db=db,
            delivery_id=delivery_b.delivery_id,
            reason="Unauthorized teacher attempting correction",
            staff_id=staff_id,
        )
    assert forbidden_correct.value.status_code == 403


def test_academic_scope_mismatch_rejected(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = ctx["staff"].staff_id

    # Create another academic year and period
    other_year = AcademicYear(
        year_label="2025-2026",
        start_date=datetime(2025, 6, 1).date(),
        end_date=datetime(2026, 3, 31).date(),
    )
    db.add(other_year)
    db.flush()

    mismatched_period = AcademicPeriod(
        period_name="Mismatched Term",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        start_date=datetime(2025, 6, 1).date(),
        end_date=datetime(2025, 9, 30).date(),
        academic_year_id=other_year.academic_year_id,
    )
    lesson = Lesson(
        title="Scope Mismatch Lesson",
        subject_id=ctx["subject"].subject_id,
    )
    db.add_all([mismatched_period, lesson])
    db.commit()

    with pytest.raises(HTTPException) as mismatch:
        confirm_lesson_delivery(
            db=db,
            lesson_id=lesson.lesson_id,
            class_id=ctx["class"].class_id,
            subject_id=ctx["subject"].subject_id,
            academic_period_id=mismatched_period.academic_period_id,
            staff_id=staff_id,
        )
    assert mismatch.value.status_code == 409
    assert "different academic years" in mismatch.value.detail


def test_lesson_subject_mismatch_rejected(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = ctx["staff"].staff_id

    other_subject = Subject(
        subject_codename="SCI9",
        subject_name="Science 9",
        academic_level_id=ctx["class"].academic_level_id,
    )
    lesson = Lesson(
        title="Science Lesson",
        subject_id=ctx["subject"].subject_id,
    )
    db.add_all([other_subject, lesson])
    db.commit()

    with pytest.raises(HTTPException) as subj_mismatch:
        confirm_lesson_delivery(
            db=db,
            lesson_id=lesson.lesson_id,
            class_id=ctx["class"].class_id,
            subject_id=other_subject.subject_id,
            academic_period_id=ctx["period"].academic_period_id,
            staff_id=staff_id,
        )
    assert subj_mismatch.value.status_code == 422
    assert "does not belong" in subj_mismatch.value.detail


def test_archived_lesson_cannot_be_delivered(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = ctx["staff"].staff_id

    archived_lesson = Lesson(
        title="Archived Lesson",
        subject_id=ctx["subject"].subject_id,
        is_archived=True,
    )
    db.add(archived_lesson)
    db.commit()

    with pytest.raises(HTTPException) as archived_err:
        confirm_lesson_delivery(
            db=db,
            lesson_id=archived_lesson.lesson_id,
            class_id=ctx["class"].class_id,
            subject_id=ctx["subject"].subject_id,
            academic_period_id=ctx["period"].academic_period_id,
            staff_id=staff_id,
        )
    assert archived_err.value.status_code == 422
    assert "archived" in archived_err.value.detail


def test_published_and_goals_do_not_mark_as_taught(candidate_context):
    ctx = candidate_context
    db = ctx["db"]

    # 1. Lesson is published and assigned
    lesson = Lesson(
        title="Curriculum Target Lesson",
        subject_id=ctx["subject"].subject_id,
        is_published=True,
    )
    db.add(lesson)
    db.flush()

    db.add(LessonAssignment(
        lesson_id=lesson.lesson_id,
        class_id=ctx["class"].class_id,
        is_published=True,
    ))

    # 2. Included in LessonGoal
    goal = LessonGoal(
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        created_by_staff_id=ctx["staff"].staff_id,
    )
    db.add(goal)
    db.flush()
    db.add(LessonGoalItem(
        goal_id=goal.goal_id,
        item_type="LESSON",
        lesson_id=lesson.lesson_id,
        order_index=1,
    ))
    db.commit()

    # Even though published, assigned, and in lesson goals, it is NOT taught!
    assert is_lesson_delivered_as_of(
        db, lesson.lesson_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id
    ) is False
    assert get_delivered_lesson_ids_as_of(
        db, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id
    ) == set()


def test_historical_cutoff_behavior(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = ctx["staff"].staff_id

    lesson1 = Lesson(title="Lesson 1", subject_id=ctx["subject"].subject_id)
    lesson2 = Lesson(title="Lesson 2", subject_id=ctx["subject"].subject_id)
    db.add_all([lesson1, lesson2])
    db.commit()

    base_time = datetime(2026, 10, 1, 10, 0, tzinfo=timezone.utc)
    t0_pre_delivery = base_time
    t1_delivery1 = base_time + timedelta(days=4)
    t2_evidence_cutoff = base_time + timedelta(days=9)
    t3_revocation1 = base_time + timedelta(days=14)
    t4_delivery2 = base_time + timedelta(days=19)
    t5_future = base_time + timedelta(days=24)

    # Deliver Lesson 1 at T1
    d1 = LessonDelivery(
        lesson_id=lesson1.lesson_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        delivered_by_staff_id=staff_id,
        delivered_at=t1_delivery1,
    )
    db.add(d1)
    db.commit()

    # Deliver Lesson 2 at T4
    d2 = LessonDelivery(
        lesson_id=lesson2.lesson_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        delivered_by_staff_id=staff_id,
        delivered_at=t4_delivery2,
    )
    db.add(d2)
    db.commit()

    # Revoke Lesson 1 at T3
    d1.revoked_at = t3_revocation1
    d1.revoked_by_staff_id = staff_id
    d1.correction_reason = "Retracted on day 14"
    db.commit()

    # Test as of T0 (before any delivery)
    assert get_delivered_lesson_ids_as_of(
        db, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id, as_of=t0_pre_delivery
    ) == set()

    # Test as of T2 (cutoff): Lesson 1 was delivered at T1 and NOT yet revoked at T2!
    delivered_at_cutoff = get_delivered_lesson_ids_as_of(
        db, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id, as_of=t2_evidence_cutoff
    )
    assert delivered_at_cutoff == {lesson1.lesson_id}
    assert is_lesson_delivered_as_of(
        db, lesson1.lesson_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id, as_of=t2_evidence_cutoff
    ) is True
    assert is_lesson_delivered_as_of(
        db, lesson2.lesson_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id, as_of=t2_evidence_cutoff
    ) is False

    # Test as of T5 (after T3 revocation and T4 delivery 2): Lesson 1 is revoked, Lesson 2 is active!
    delivered_at_t5 = get_delivered_lesson_ids_as_of(
        db, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id, as_of=t5_future
    )
    assert delivered_at_t5 == {lesson2.lesson_id}

    # Test current active (as_of=None)
    current_active = get_delivered_lesson_ids_as_of(
        db, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id, as_of=None
    )
    assert current_active == {lesson2.lesson_id}


def test_retroactive_correction_blocked_by_frozen_intervention_evidence(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = ctx["staff"].staff_id

    lesson = Lesson(
        title="Frozen Evidence Lesson",
        subject_id=ctx["subject"].subject_id,
    )
    db.add(lesson)
    db.commit()

    delivery = confirm_lesson_delivery(
        db=db,
        lesson_id=lesson.lesson_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        staff_id=staff_id,
    )

    # Attach this lesson to the candidate intervention's frozen diagnosis snapshot
    snapshot = dict(ctx["candidate"].diagnosis_snapshot)
    snapshot["evidence_cutoff_at"] = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
    snapshot["lowest_supported_competencies"] = [{
        "competency_id": 1,
        "supporting_scores": [{
            "source_type": "QUIZ_QUESTION",
            "quiz_question_id": 101,
            "lesson_id": lesson.lesson_id,
            "score": 0.0,
            "possible_score": 5.0,
        }],
    }]
    ctx["candidate"].diagnosis_snapshot = snapshot
    db.commit()

    # Attempting to correct delivery of a lesson frozen in intervention evidence raises 409
    with pytest.raises(HTTPException) as conflict:
        correct_lesson_delivery(
            db=db,
            delivery_id=delivery.delivery_id,
            reason="Attempting retroactive retraction",
            staff_id=staff_id,
        )
    assert conflict.value.status_code == 409
    assert "Cannot alter delivery" in conflict.value.detail
    assert "frozen intervention evidence" in conflict.value.detail


def test_api_endpoints_confirm_and_correct(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    staff_id = ctx["staff"].staff_id

    lesson = Lesson(
        title="API Test Lesson",
        subject_id=ctx["subject"].subject_id,
    )
    db.add(lesson)
    db.commit()

    test_app = FastAPI()
    test_app.include_router(lesson_deliveries_router, prefix="/api/v1/lesson-deliveries")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_staff_id] = lambda: staff_id
    test_app.dependency_overrides[get_current_user] = lambda: {
        "role": "teacher",
        "sub": str(ctx["staff"].user_id),
    }

    client = TestClient(test_app)

    # 1. Confirm Delivery via POST
    confirm_payload = {
        "lesson_id": lesson.lesson_id,
        "class_id": ctx["class"].class_id,
        "subject_id": ctx["subject"].subject_id,
        "academic_period_id": ctx["period"].academic_period_id,
    }
    resp = client.post("/api/v1/lesson-deliveries/confirm", json=confirm_payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["lesson_id"] == lesson.lesson_id
    assert data["is_active"] is True
    delivery_id = data["delivery_id"]

    # 2. Query status for this lesson via GET
    status_resp = client.get(
        f"/api/v1/lesson-deliveries/class/{ctx['class'].class_id}/subject/{ctx['subject'].subject_id}/lesson/{lesson.lesson_id}",
        params={"academic_period_id": ctx["period"].academic_period_id},
    )
    assert status_resp.status_code == 200
    status_data = status_resp.json()
    assert status_data["is_delivered"] is True
    assert status_data["active_delivery"]["delivery_id"] == delivery_id

    # 3. Query list for class/subject via GET
    list_resp = client.get(
        f"/api/v1/lesson-deliveries/class/{ctx['class'].class_id}/subject/{ctx['subject'].subject_id}",
        params={"academic_period_id": ctx["period"].academic_period_id},
    )
    assert list_resp.status_code == 200
    list_data = list_resp.json()
    assert len(list_data) == 1
    assert list_data[0]["delivery_id"] == delivery_id

    # 4. Correct Delivery via PUT
    correct_payload = {"reason": "Test correction via API"}
    correct_resp = client.put(f"/api/v1/lesson-deliveries/{delivery_id}/correct", json=correct_payload)
    assert correct_resp.status_code == 200
    correct_data = correct_resp.json()
    assert correct_data["is_active"] is False
    assert correct_data["revoked_at"] is not None
    assert correct_data["correction_reason"] == "Test correction via API"


def test_migration_upgrade_and_downgrade_on_disposable_sqlite(tmp_path):
    """Test Alembic migration on a temporary, isolated SQLite database."""
    database = tmp_path / "lesson-delivery-test.sqlite"
    engine = create_engine(f"sqlite:///{database}")
    migration = importlib.import_module("migrations.versions.20261028_lesson_delivery")

    try:
        with engine.begin() as connection:
            connection.execute(text("PRAGMA foreign_keys=ON"))
            connection.execute(text("CREATE TABLE academic_year (academic_year_id INTEGER PRIMARY KEY)"))
            connection.execute(text("CREATE TABLE academic_period (academic_period_id INTEGER PRIMARY KEY)"))
            connection.execute(text("CREATE TABLE class (class_id INTEGER PRIMARY KEY)"))
            connection.execute(text("CREATE TABLE subject (subject_id INTEGER PRIMARY KEY)"))
            connection.execute(text("CREATE TABLE lesson (lesson_id INTEGER PRIMARY KEY)"))
            connection.execute(text("CREATE TABLE academic_staff (staff_id VARCHAR(20) PRIMARY KEY)"))

            migration.op = Operations(MigrationContext.configure(connection))
            migration.upgrade()

        inspector = inspect(engine)
        assert "lesson_delivery" in inspector.get_table_names()

        fk_columns = {
            tuple(fk["constrained_columns"])[0]
            for fk in inspector.get_foreign_keys("lesson_delivery")
        }
        assert {"lesson_id", "class_id", "subject_id", "academic_period_id"} <= fk_columns

        indexes = {idx["name"] for idx in inspector.get_indexes("lesson_delivery")}
        assert {
            "uq_lesson_delivery_active",
            "ix_lesson_delivery_scope",
            "ix_lesson_delivery_lesson_class",
            "ix_lesson_delivery_lesson_id",
            "ix_lesson_delivery_class_id",
            "ix_lesson_delivery_subject_id",
            "ix_lesson_delivery_academic_period_id",
        } <= indexes

        with engine.begin() as connection:
            migration.op = Operations(MigrationContext.configure(connection))
            migration.downgrade()

        assert "lesson_delivery" not in inspect(engine).get_table_names()
    finally:
        engine.dispose()


def test_evidence_scope_reflects_teacher_verified_delivery(candidate_context):
    """Verify that InterventionGenerationEvidenceScopeService uses teacher-verified delivery records."""
    from app.services.intervention.InterventionGenerationEvidenceScopeService import (
        resolve_generation_evidence_scope,
    )
    from tests.test_intervention_generation_evidence_scope import (
        _mapped_records,
        _question_snapshot,
    )

    ctx = candidate_context
    db = ctx["db"]
    staff_id = ctx["staff"].staff_id
    competency, lesson = _mapped_records(ctx)
    snapshot, question_ids = _question_snapshot(ctx, competency, lesson)
    ctx["candidate"].diagnosis_snapshot = snapshot
    db.commit()

    # Before delivery confirmed: taught_status is UNAVAILABLE_NO_TEACHING_HISTORY
    scope_before = resolve_generation_evidence_scope(db, ctx["candidate"])
    assert scope_before["taught_status"] == "UNAVAILABLE_NO_TEACHING_HISTORY"
    assert "is_taught" not in scope_before["lessons"][0]

    # Teacher confirms delivery prior to the frozen cutoff
    cutoff = datetime.fromisoformat(snapshot["evidence_cutoff_at"])
    d = LessonDelivery(
        lesson_id=lesson.lesson_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        delivered_by_staff_id=staff_id,
        delivered_at=cutoff - timedelta(hours=2),
    )
    db.add(d)
    db.commit()

    # After delivery confirmed: taught_status is TEACHER_VERIFIED_DELIVERY
    scope_after = resolve_generation_evidence_scope(db, ctx["candidate"])
    assert scope_after["taught_status"] == "TEACHER_VERIFIED_DELIVERY"
    assert scope_after["lessons"][0]["lesson_id"] == lesson.lesson_id
    assert scope_after["lessons"][0]["is_taught"] is True
    assert scope_after["lessons"][0]["taught_evidence"] == "TEACHER_VERIFIED_DELIVERY"


"""Persistence-only coverage for intervention-specific Reading reviews."""

import importlib
from datetime import datetime, timezone
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import HTTPException
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from app.models.intervention.InterventionReadingReview import (
    InterventionReadingReview,
)
from app.models.intervention.Intervention import Intervention
from app.models.ai.DevelopmentCurrentTermPrediction import (
    DevelopmentCurrentTermPrediction,
)
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.InterventionReadingReviewService import (
    acknowledge_intervention_reading_review,
    intervention_reading_reviews,
)
from app.services.intervention.RemediationReadingPrerequisiteService import (
    stage_remediation_reading_prerequisites,
)
from app.services.intervention.TeacherInterventionService import (
    activate_teacher_candidate,
)
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_remediation_reading_prerequisite import _item, _reading, _remediation
from tests.test_teacher_intervention_review import candidate_context, _id, _staff


def _published_activity(ctx, title: str):
    assignment = _remediation(ctx, title)
    assignment.is_published = True
    assignment.classwork.is_published = True
    return assignment


def test_acknowledgment_is_persistent_idempotent_and_shared_within_intervention(
    candidate_context,
):
    ctx = candidate_context
    db = ctx["db"]
    activate_teacher_candidate(db, _staff(ctx), _id(ctx))
    reading = _reading(ctx, "Reusable intervention Reading")
    first_activity = _published_activity(ctx, "First remediation")
    second_activity = _published_activity(ctx, "Second remediation")
    for activity in (first_activity, second_activity):
        stage_remediation_reading_prerequisites(
            db,
            remediation_assignment_id=activity.classwork_assignment_id,
            items=[_item(reading, 1)],
        )
    ordinary_completion = StudentSubmission(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=reading[1].classwork_assignment_id,
        status="submitted",
        attempt_count=1,
    )
    db.add(ordinary_completion)
    db.commit()
    original_submission = (
        ordinary_completion.submission_id,
        ordinary_completion.status,
        ordinary_completion.submitted_at,
        ordinary_completion.attempt_count,
    )

    first = acknowledge_intervention_reading_review(
        db,
        intervention_id=_id(ctx),
        reading_assignment_id=reading[1].classwork_assignment_id,
        student=ctx["student"],
    )
    retried = acknowledge_intervention_reading_review(
        db,
        intervention_id=_id(ctx),
        reading_assignment_id=reading[1].classwork_assignment_id,
        student=ctx["student"],
    )

    assert retried.review_id == first.review_id
    assert retried.acknowledged_at == first.acknowledged_at
    assert retried.student_id == ctx["student"].student_id
    assert intervention_reading_reviews(
        db,
        intervention_id=_id(ctx),
        student=ctx["student"],
    ) == [first]
    assert db.query(InterventionReadingReview).count() == 1
    db.refresh(ordinary_completion)
    assert (
        ordinary_completion.submission_id,
        ordinary_completion.status,
        ordinary_completion.submitted_at,
        ordinary_completion.attempt_count,
    ) == original_submission

    first_intervention = ctx["candidate"]
    first_intervention.status = "RESOLVED"
    first_intervention.resolution_reason = "IMPROVED_PREDICTION"
    first_intervention.resolved_at = datetime.now(timezone.utc)
    source = db.get(
        DevelopmentCurrentTermPrediction,
        first_intervention.source_prediction_id,
    )
    next_prediction = DevelopmentCurrentTermPrediction(
        student_id=source.student_id,
        class_id=source.class_id,
        subject_id=source.subject_id,
        source_period_id=source.source_period_id,
        target_period_id=source.target_period_id,
        model_version_id=source.model_version_id,
        revision=source.revision + 1,
        predicted_period_grade=source.predicted_period_grade,
        intervention_level=source.intervention_level,
        intervention_basis=source.intervention_basis,
        risk_score=None,
        evidence_snapshot=source.evidence_snapshot,
    )
    db.add(next_prediction)
    db.flush()
    next_intervention = Intervention(
        student_id=first_intervention.student_id,
        class_id=first_intervention.class_id,
        subject_id=first_intervention.subject_id,
        academic_period_id=first_intervention.academic_period_id,
        source_prediction_id=next_prediction.prediction_id,
        status="ACTIVE",
        diagnosis_snapshot={},
        activated_at=datetime.now(timezone.utc),
        activated_by_staff_id=_staff(ctx),
    )
    db.add(next_intervention)
    db.flush()
    next_activity = _published_activity(ctx, "Next intervention remediation")
    next_activity.source_intervention_id = next_intervention.intervention_id
    stage_remediation_reading_prerequisites(
        db,
        remediation_assignment_id=next_activity.classwork_assignment_id,
        items=[_item(reading, 1)],
    )
    db.commit()

    next_review = acknowledge_intervention_reading_review(
        db,
        intervention_id=next_intervention.intervention_id,
        reading_assignment_id=reading[1].classwork_assignment_id,
        student=ctx["student"],
    )
    assert next_review.review_id != first.review_id
    assert db.query(InterventionReadingReview).count() == 2


def test_acknowledgment_requires_owner_enrollment_and_published_snapshot_membership(
    candidate_context,
):
    ctx = candidate_context
    db = ctx["db"]
    activate_teacher_candidate(db, _staff(ctx), _id(ctx))
    required = _reading(ctx, "Required Reading")
    unrelated = _reading(ctx, "Unrelated Reading")
    activity = _published_activity(ctx, "Published remediation")
    stage_remediation_reading_prerequisites(
        db,
        remediation_assignment_id=activity.classwork_assignment_id,
        items=[_item(required, 1)],
    )
    outsider = Student(
        student_id=uuid4(),
        student_lrn="399999999999",
        first_name="Other",
        last_name="Learner",
        academic_level_id=ctx["level"].academic_level_id,
    )
    db.add(outsider)
    db.commit()

    with pytest.raises(HTTPException) as wrong_student:
        acknowledge_intervention_reading_review(
            db,
            intervention_id=_id(ctx),
            reading_assignment_id=required[1].classwork_assignment_id,
            student=outsider,
        )
    assert wrong_student.value.status_code == 404

    with pytest.raises(HTTPException) as not_required:
        acknowledge_intervention_reading_review(
            db,
            intervention_id=_id(ctx),
            reading_assignment_id=unrelated[1].classwork_assignment_id,
            student=ctx["student"],
        )
    assert not_required.value.status_code == 404
    assert db.query(InterventionReadingReview).count() == 0

    activity.is_published = False
    db.commit()
    with pytest.raises(HTTPException) as unpublished:
        acknowledge_intervention_reading_review(
            db,
            intervention_id=_id(ctx),
            reading_assignment_id=required[1].classwork_assignment_id,
            student=ctx["student"],
        )
    assert unpublished.value.status_code == 404


def test_acknowledgment_requires_active_intervention(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    reading = _reading(ctx, "Candidate Reading")
    activity = _published_activity(ctx, "Candidate remediation")
    stage_remediation_reading_prerequisites(
        db,
        remediation_assignment_id=activity.classwork_assignment_id,
        items=[_item(reading, 1)],
    )
    db.commit()

    with pytest.raises(HTTPException) as inactive:
        acknowledge_intervention_reading_review(
            db,
            intervention_id=_id(ctx),
            reading_assignment_id=reading[1].classwork_assignment_id,
            student=ctx["student"],
        )
    assert inactive.value.status_code == 400
    assert db.query(InterventionReadingReview).count() == 0


def test_database_constraint_rejects_duplicate_intervention_reading(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    reading = _reading(ctx, "Constraint Reading")
    first = InterventionReadingReview(
        intervention_id=_id(ctx),
        reading_assignment_id=reading[1].classwork_assignment_id,
        student_id=ctx["student"].student_id,
    )
    duplicate = InterventionReadingReview(
        intervention_id=_id(ctx),
        reading_assignment_id=reading[1].classwork_assignment_id,
        student_id=ctx["student"].student_id,
    )
    db.add(first)
    db.commit()
    db.add(duplicate)
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()
    assert db.query(InterventionReadingReview).count() == 1


def test_model_declares_review_identity_constraints_and_indexes():
    table = InterventionReadingReview.__table__
    assert set(table.columns.keys()) == {
        "review_id",
        "intervention_id",
        "reading_assignment_id",
        "student_id",
        "acknowledged_at",
    }
    unique = next(
        constraint
        for constraint in table.constraints
        if constraint.name
        == "uq_intervention_reading_review_intervention_assignment"
    )
    assert [column.name for column in unique.columns] == [
        "intervention_id",
        "reading_assignment_id",
    ]
    assert {
        "ix_intervention_reading_review_intervention",
        "ix_intervention_reading_review_reading_assignment",
        "ix_intervention_reading_review_student",
    } == {index.name for index in table.indexes}
    assert table.c.acknowledged_at.nullable is False
    assert table.c.acknowledged_at.server_default is not None


def test_migration_upgrade_and_downgrade_on_disposable_sqlite(tmp_path):
    database = tmp_path / "intervention-reading-review.sqlite"
    engine = create_engine(f"sqlite:///{database}")
    migration = importlib.import_module(
        "migrations.versions.20261027_intervention_reading_review"
    )
    try:
        with engine.begin() as connection:
            connection.execute(text("PRAGMA foreign_keys=ON"))
            connection.execute(text(
                "CREATE TABLE intervention (intervention_id INTEGER PRIMARY KEY)"
            ))
            connection.execute(text(
                "CREATE TABLE classwork_assignment (classwork_assignment_id INTEGER PRIMARY KEY)"
            ))
            connection.execute(text(
                "CREATE TABLE student (student_id UUID PRIMARY KEY)"
            ))
            migration.op = Operations(MigrationContext.configure(connection))
            migration.upgrade()

        inspector = inspect(engine)
        assert "intervention_reading_review" in inspector.get_table_names()
        assert {
            "intervention_id",
            "reading_assignment_id",
            "student_id",
        } == {
            tuple(item["constrained_columns"])[0]
            for item in inspector.get_foreign_keys("intervention_reading_review")
        }
        assert {
            "uq_intervention_reading_review_intervention_assignment",
        } <= {
            item["name"]
            for item in inspector.get_unique_constraints("intervention_reading_review")
        }
        assert {
            "ix_intervention_reading_review_intervention",
            "ix_intervention_reading_review_reading_assignment",
            "ix_intervention_reading_review_student",
        } <= {
            item["name"]
            for item in inspector.get_indexes("intervention_reading_review")
        }

        with engine.begin() as connection:
            migration.op = Operations(MigrationContext.configure(connection))
            migration.downgrade()
        assert "intervention_reading_review" not in inspect(engine).get_table_names()
    finally:
        engine.dispose()

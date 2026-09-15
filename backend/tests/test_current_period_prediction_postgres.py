"""Real PostgreSQL concurrency and integrity tests for CurrentPeriodPredictionGenerationService.

Run with RUN_POSTGRES_CONCURRENCY_TESTS=1.
Uses disposable PostgreSQL test schemas and isolated seeded records.
"""

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import os
from pathlib import Path
import threading
import uuid

import pytest
from sqlalchemy import create_engine, select, text

from app.db.Base import Base
from app.db.Session import engine as configured_engine
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.PredictionGenerationRequest import PredictionGenerationRequest
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.prediction import CurrentPeriodPredictionGenerationService as current_gen
from app.services.prediction import PredictionGenerationService as next_gen
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    MODEL_NAME as CURRENT_MODEL_NAME,
    MODEL_PURPOSE as CURRENT_MODEL_PURPOSE,
)
from app.services.prediction.PredictionGenerationTransaction import (
    advisory_lock_key,
    canonical_prediction_scope,
    run_prediction_generation_transaction,
)
from test_current_period_prediction_generation import add_activity, current_context

pytestmark = pytest.mark.skipif(
    configured_engine.dialect.name != "postgresql"
    or os.getenv("RUN_POSTGRES_CONCURRENCY_TESTS") != "1",
    reason="Explicitly enable isolated PostgreSQL integrity tests via RUN_POSTGRES_CONCURRENCY_TESTS=1.",
)


@pytest.fixture
def pg_current(current_context):
    c = current_context
    # Add sufficient activities in current_context for STANDARD_READY
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    schema = "prediction_current_test_" + uuid.uuid4().hex
    with configured_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))

    test_engine = create_engine(
        configured_engine.url,
        connect_args={"options": "-csearch_path=" + schema},
        pool_size=4,
        max_overflow=2,
    )
    try:
        # Create all tables in disposable schema
        Base.metadata.create_all(test_engine)
        with test_engine.begin() as conn:
            for table in Base.metadata.sorted_tables:
                rows = [dict(row) for row in c["db"].execute(select(table)).mappings()]
                if rows:
                    conn.execute(table.insert(), rows)
        yield {**c, "engine": test_engine, "schema": schema}
    finally:
        test_engine.dispose()
        assert schema.startswith("prediction_current_test_")
        with configured_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def run_current(pg, key=None, callback=None):
    def operation(db):
        if callback:
            callback(db)
        return current_gen.generate_current_period_from_records(
            db,
            pg["scope"],
            generation_request_id=key,
            staff_id=pg["staff"].staff_id,
        )

    return run_prediction_generation_transaction(
        pg["scope"],
        CURRENT_MODEL_NAME,
        operation,
        bind=pg["engine"],
        generation_request_id=key,
    )


def pg_counts(pg):
    with pg["engine"].connect() as conn:
        revs = conn.execute(
            text("SELECT revision FROM ai_prediction ORDER BY revision")
        ).scalars().all()
        reqs = conn.execute(
            text("SELECT count(*) FROM prediction_generation_request")
        ).scalar()
        return revs, reqs


def concurrent_current_pair(pg, monkeypatch, keys):
    original_predict = current_gen.score_current_period_prediction
    first_scoring = threading.Event()
    release = threading.Event()
    second_started = threading.Event()
    visibility = []

    def score(*args, **kwargs):
        first_scoring.set()
        assert release.wait(10), "Test did not release first generator"
        return original_predict(*args, **kwargs)

    monkeypatch.setattr(current_gen, "score_current_period_prediction", score)

    def second():
        second_started.set()
        return run_current(
            pg,
            keys[1],
            lambda db: visibility.append(
                db.query(AIPrediction)
                .filter(AIPrediction.model_version_id == pg["model"].model_version_id)
                .count()
            ),
        )

    with ThreadPoolExecutor(max_workers=2) as workers:
        first = workers.submit(run_current, pg, keys[0])
        assert first_scoring.wait(10)
        waiter = workers.submit(second)
        assert second_started.wait(5)
        try:
            with pytest.raises(TimeoutError):
                waiter.result(timeout=0.15)
        finally:
            release.set()
        results = first.result(timeout=10), waiter.result(timeout=10)
    return results, visibility


def test_current_waiter_sees_committed_prediction_different_keys_unchanged(pg_current, monkeypatch):
    """Worker 2 blocks on advisory lock; after Worker 1 commits V1, Worker 2 sees V1 and returns UNCHANGED."""
    (first, second), visibility = concurrent_current_pair(pg_current, monkeypatch, ("key-a", "key-b"))
    assert visibility == [1]
    assert first["prediction_id"] == second["prediction_id"]
    assert first["generation_status"] == "CREATED"
    assert second["generation_status"] == "UNCHANGED"
    assert first["evidence_snapshot"] == second["evidence_snapshot"]
    revs, reqs = pg_counts(pg_current)
    assert revs == [1]
    assert reqs == 2


def test_current_same_request_id_concurrent_replay(pg_current, monkeypatch):
    """Concurrent requests with same generation_request_id return REPLAYED without conflict."""
    (first, second), visibility = concurrent_current_pair(pg_current, monkeypatch, ("same-id", "same-id"))
    assert visibility == [1]
    assert first["generation_status"] == "CREATED"
    assert second["generation_status"] == "REPLAYED"
    assert first["prediction_id"] == second["prediction_id"]
    revs, reqs = pg_counts(pg_current)
    assert revs == [1]
    assert reqs == 1


def test_current_concurrent_changed_evidence_creates_only_one_successor(pg_current, monkeypatch):
    """When evidence changes, concurrent workers create exactly one Revision 2; the other returns UNCHANGED."""
    first = run_current(pg_current, "init-key")
    assert first["revision"] == 1

    with pg_current["engine"].begin() as conn:
        conn.execute(text("UPDATE student_submission SET grade=99"))

    (second, unchanged), visibility = concurrent_current_pair(
        pg_current, monkeypatch, ("update-a", "update-b")
    )
    assert visibility == [2]
    assert second["revision"] == unchanged["revision"] == 2
    assert second["prediction_id"] == unchanged["prediction_id"]
    revs, reqs = pg_counts(pg_current)
    assert revs == [1, 2]
    assert reqs == 3


def test_current_and_next_different_locks_do_not_block(pg_current):
    """CURRENT and NEXT advisory locks incorporate model name and scope, avoiding lock contention."""
    next_scope = {
        "student_id": pg_current["student"].student_id,
        "class_id": pg_current["class"].class_id,
        "subject_id": pg_current["subject"].subject_id,
        "source_period_id": pg_current["period1"].academic_period_id,
        "target_period_id": pg_current["period2"].academic_period_id,
    }
    cur_scope = pg_current["scope"]

    next_key = canonical_prediction_scope(next_scope, "entervene_next_period_grade_rf")
    cur_key = canonical_prediction_scope(cur_scope, CURRENT_MODEL_NAME)

    assert next_key != cur_key
    assert advisory_lock_key(next_key) != advisory_lock_key(cur_key)

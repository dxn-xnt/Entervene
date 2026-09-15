"""Real PostgreSQL concurrency and integrity tests for current-period refresh lifecycle.

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
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.PredictionGenerationRequest import PredictionGenerationRequest
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Prediction import PredictionRefreshRequest
from app.services.prediction import CurrentPeriodPredictionGenerationService as current_gen
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
def pg_refresh_context(current_context):
    c = current_context
    # Seed standard ready activities
    add_activity(c, "WRITTEN_WORK", 85, 100)
    add_activity(c, "WRITTEN_WORK", 90, 100)
    add_activity(c, "PERFORMANCE_TASK", 80, 100)
    add_activity(c, "PERFORMANCE_TASK", 85, 100)

    schema = "pred_refresh_test_" + uuid.uuid4().hex
    with configured_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))

    test_engine = create_engine(
        configured_engine.url,
        connect_args={"options": "-csearch_path=" + schema},
        pool_size=4,
        max_overflow=2,
    )
    try:
        Base.metadata.create_all(test_engine)
        with test_engine.begin() as conn:
            for table in Base.metadata.sorted_tables:
                rows = [dict(row) for row in c["db"].execute(select(table)).mappings()]
                if rows:
                    conn.execute(table.insert(), rows)
        yield {**c, "engine": test_engine, "schema": schema}
    finally:
        test_engine.dispose()
        assert schema.startswith("pred_refresh_test_")
        with configured_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def run_refresh_in_db(pg, prediction_id, key=None):
    from sqlalchemy.orm import sessionmaker
    SessionLocal = sessionmaker(bind=pg["engine"])
    db = SessionLocal()
    try:
        pred = db.get(AIPrediction, prediction_id)
        assert pred is not None
        payload = PredictionRefreshRequest(generation_request_id=key) if key else None
        return current_gen.refresh_current_period_prediction_workflow(
            db,
            pred,
            payload=payload,
            staff_id=pg["staff"].staff_id,
        )
    finally:
        db.close()


def concurrent_refresh_pair(pg, monkeypatch, prediction_id, keys):
    original_predict = current_gen.score_current_period_prediction
    first_scoring = threading.Event()
    release = threading.Event()
    second_started = threading.Event()

    def score(*args, **kwargs):
        first_scoring.set()
        assert release.wait(10), "Test did not release first generator"
        return original_predict(*args, **kwargs)

    monkeypatch.setattr(current_gen, "score_current_period_prediction", score)

    def second():
        second_started.set()
        return run_refresh_in_db(pg, prediction_id, keys[1])

    with ThreadPoolExecutor(max_workers=2) as workers:
        first = workers.submit(run_refresh_in_db, pg, prediction_id, keys[0])
        assert first_scoring.wait(10)
        waiter = workers.submit(second)
        assert second_started.wait(5)
        try:
            with pytest.raises(TimeoutError):
                waiter.result(timeout=0.15)
        finally:
            release.set()
        results = first.result(timeout=10), waiter.result(timeout=10)
    return results


def test_concurrent_refresh_changed_evidence_creates_only_one_v2(pg_refresh_context, monkeypatch):
    """When evidence changes, two concurrent refreshes yield exactly one V2; the second returns UNCHANGED."""
    pg = pg_refresh_context
    # Generate initial V1
    init_res = current_gen.generate_current_period_prediction(
        pg["scope"],
        generation_request_id="init-v1-key",
        staff_id=pg["staff"].staff_id,
        bind=pg["engine"],
    )
    assert init_res["revision"] == 1
    v1_id = init_res["prediction_id"]

    # Update student grade to trigger change
    with pg["engine"].begin() as conn:
        conn.execute(text("UPDATE student_submission SET grade=99"))

    (first, second) = concurrent_refresh_pair(
        pg, monkeypatch, v1_id, ("refresh-worker-1", "refresh-worker-2")
    )

    assert first["generation_status"] == "CREATED"
    assert first["revision"] == 2
    assert second["generation_status"] == "UNCHANGED"
    assert second["revision"] == 2
    assert second["prediction_id"] == first["prediction_id"]

    with pg["engine"].connect() as conn:
        revisions = conn.execute(text("SELECT revision FROM ai_prediction ORDER BY revision")).scalars().all()
        assert revisions == [1, 2]


def test_concurrent_refresh_same_request_id_replayed(pg_refresh_context, monkeypatch):
    """When concurrent refreshes use the exact same generation_request_id, one is CREATED, one is REPLAYED."""
    pg = pg_refresh_context
    init_res = current_gen.generate_current_period_prediction(
        pg["scope"],
        generation_request_id="init-v1-key",
        staff_id=pg["staff"].staff_id,
        bind=pg["engine"],
    )
    v1_id = init_res["prediction_id"]

    with pg["engine"].begin() as conn:
        conn.execute(text("UPDATE student_submission SET grade=99"))

    (first, second) = concurrent_refresh_pair(
        pg, monkeypatch, v1_id, ("same-refresh-id", "same-refresh-id")
    )

    assert first["generation_status"] == "CREATED"
    assert second["generation_status"] == "REPLAYED"
    assert second["prediction_id"] == first["prediction_id"]

    with pg["engine"].connect() as conn:
        revisions = conn.execute(text("SELECT revision FROM ai_prediction ORDER BY revision")).scalars().all()
        assert revisions == [1, 2]

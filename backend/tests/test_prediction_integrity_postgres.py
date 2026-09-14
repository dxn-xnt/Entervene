"""Real PostgreSQL tests, isolated in disposable schemas, never school rows.

Run with RUN_POSTGRES_CONCURRENCY_TESTS=1. Includes the actual migration.
"""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import importlib.util
import os
from pathlib import Path
import threading
import uuid

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, text, select
from sqlalchemy.exc import IntegrityError

from test_prediction_integrity_stage1 import context, feature_context
from app.db.Base import Base
from app.db.Session import engine as configured_engine
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.models.ai.PredictionGenerationRequest import PredictionGenerationRequest
from app.services.prediction import PredictionGenerationService as generation
from app.services.prediction.PredictionGenerationTransaction import run_prediction_generation_transaction

pytestmark = pytest.mark.skipif(
    configured_engine.dialect.name != 'postgresql' or os.getenv('RUN_POSTGRES_CONCURRENCY_TESTS') != '1',
    reason='Explicitly enable isolated PostgreSQL integrity tests.')


def migration(connection, direction):
    spec = importlib.util.spec_from_file_location('stage1_migration', Path('migrations/versions/20260914_prediction_integrity.py'))
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    with Operations.context(MigrationContext.configure(connection)):
        getattr(module, direction)()


@pytest.fixture
def pg(context):
    schema = 'prediction_stage1_test_' + uuid.uuid4().hex
    with configured_engine.begin() as conn:
        conn.execute(text(f'CREATE SCHEMA "{schema}"'))
    test_engine = create_engine(configured_engine.url, connect_args={'options': '-csearch_path=' + schema}, pool_size=3, max_overflow=2)
    try:
        Base.metadata.create_all(test_engine)
        # Start at the actual pre-migration table shape.
        with test_engine.begin() as conn:
            conn.execute(text('DROP TABLE prediction_generation_request'))
            conn.execute(text('ALTER TABLE ai_prediction DROP COLUMN revision CASCADE'))
            migration(conn, 'upgrade')
            # Copy only the isolated unit fixture's seed records. No school data.
            for table in Base.metadata.sorted_tables:
                rows = [dict(row) for row in context['db'].execute(select(table)).mappings()]
                if rows:
                    conn.execute(table.insert(), rows)
        yield {**context, 'engine': test_engine, 'schema': schema}
    finally:
        test_engine.dispose()
        assert schema.startswith('prediction_stage1_test_') and len(schema) == len('prediction_stage1_test_') + 32
        with configured_engine.begin() as conn:
            conn.execute(text(f'DROP SCHEMA "{schema}" CASCADE'))


def run(pg, key=None, callback=None):
    def operation(db):
        if callback: callback(db)
        return generation.generate_from_records(db, pg['scope'], generation_request_id=key, staff_id=pg['staff'].staff_id)
    return run_prediction_generation_transaction(pg['scope'], generation.DEFAULT_MODEL_NAME, operation,
        bind=pg['engine'], generation_request_id=key)


def counts(pg):
    with pg['engine'].connect() as conn:
        return conn.execute(text('SELECT revision FROM ai_prediction ORDER BY revision')).scalars().all(), conn.execute(text('SELECT count(*) FROM prediction_generation_request')).scalar()


def concurrent_pair(pg, monkeypatch, keys):
    original = generation.score_student_prediction
    first_scoring = threading.Event(); release = threading.Event(); second_started = threading.Event()
    visibility = []
    def score(*args, **kwargs):
        first_scoring.set()
        assert release.wait(10), 'Test did not release first generator'
        return original(*args, **kwargs)
    monkeypatch.setattr(generation, 'score_student_prediction', score)
    def second():
        second_started.set()
        return run(pg, keys[1], lambda db: visibility.append(db.query(AIPrediction).count()))
    with ThreadPoolExecutor(max_workers=2) as workers:
        first = workers.submit(run, pg, keys[0])
        assert first_scoring.wait(10)
        waiter = workers.submit(second)
        assert second_started.wait(5)
        try:
            # A short negative wait proves the caller is blocked, not completed.
            with pytest.raises(TimeoutError): waiter.result(timeout=.15)
        finally:
            release.set()
        results = first.result(timeout=10), waiter.result(timeout=10)
    return results, visibility


def test_waiter_sees_committed_prediction_different_keys_unchanged(pg, monkeypatch):
    (first, second), visibility = concurrent_pair(pg, monkeypatch, ('a', 'b'))
    assert visibility == [1]
    assert first['prediction_id'] == second['prediction_id']
    assert second['generation_status'] == 'UNCHANGED'
    assert first['evidence_snapshot'] == second['evidence_snapshot']
    assert counts(pg) == ([1], 2)
    print('PG waiting visibility=1; different keys unchanged: revisions=[1], request aliases=2')


def test_same_request_id_concurrent_replay(pg, monkeypatch):
    (first, second), visibility = concurrent_pair(pg, monkeypatch, ('same', 'same'))
    assert visibility == [1]
    assert second['generation_status'] == 'REPLAYED'
    assert second['evidence_snapshot'] == first['evidence_snapshot']
    assert counts(pg) == ([1], 1)
    print('PG same-key replay: revisions=[1], request aliases=1')


def test_concurrent_changed_evidence_creates_only_one_successor(pg, monkeypatch):
    first = run(pg, 'initial')
    with pg['engine'].begin() as conn:
        conn.execute(text('UPDATE student_submission SET grade=70'))
    (second, unchanged), visibility = concurrent_pair(pg, monkeypatch, ('refresh-a', 'refresh-b'))
    assert visibility == [2]
    assert second['revision'] == unchanged['revision'] == 2
    assert counts(pg) == ([1, 2], 3)
    assert run(pg, 'initial')['evidence_snapshot'] == first['evidence_snapshot']
    print('PG concurrent successor: revisions=[1,2], request aliases=3; V1 unchanged')


def test_rollback_and_pool_reuse_release_all_locks(pg):
    def fail(db):
        generation.generate_from_records(db, pg['scope'], generation_request_id='failed', staff_id=pg['staff'].staff_id)
        raise RuntimeError('after snapshot sealed')
    with pytest.raises(RuntimeError):
        run_prediction_generation_transaction(pg['scope'], generation.DEFAULT_MODEL_NAME, fail,
            bind=pg['engine'], generation_request_id='failed')
    assert counts(pg) == ([], 0)
    with pg['engine'].connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'")).scalar() == 0
    assert run(pg, 'failed')['revision'] == 1
    # Check all pooled connections simultaneously, not just one checkout.
    connections = [pg['engine'].connect() for _ in range(3)]
    try:
        for conn in connections:
            assert conn.execute(text("SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'")).scalar() == 0
    finally:
        for conn in connections: conn.close()
    print('PG rollback: zero rows/aliases; retry revision=1; 3 reused connections have zero advisory locks')


def test_authorization_failure_releases_all_locks(pg):
    def unauthorized(db):
        return generation.generate_from_records(db, pg['scope'], generation_request_id='unauthorized', staff_id='UNASSIGNED')
    with pytest.raises(PermissionError):
        run_prediction_generation_transaction(pg['scope'], generation.DEFAULT_MODEL_NAME, unauthorized,
            bind=pg['engine'], generation_request_id='unauthorized')
    with pg['engine'].connect() as conn:
        assert conn.execute(text("SELECT count(*) FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'")).scalar() == 0
    assert counts(pg) == ([], 0)
    print('PG authorization failure: zero rows/aliases and zero retained advisory locks')


def test_database_uniqueness_and_immutable_payload_guards(pg):
    first = run(pg, 'original')
    pid = first['prediction_id']
    for sql in [
        'UPDATE ai_prediction SET predicted_period_grade=1 WHERE prediction_id=:pid',
        "UPDATE ai_prediction SET evidence_snapshot='{}' WHERE prediction_id=:pid",
        'UPDATE ai_prediction_feature SET feature_value=1 WHERE prediction_id=:pid',
        'DELETE FROM ai_prediction_feature WHERE prediction_id=:pid',
        'DELETE FROM ai_prediction WHERE prediction_id=:pid',
        "INSERT INTO ai_prediction_feature(prediction_id,feature_name,direction,explanation_method) VALUES (:pid,'tamper','NEUTRAL','OTHER')",
    ]:
        with pytest.raises(IntegrityError, match='immutable'):
            with pg['engine'].begin() as conn: conn.execute(text(sql), {'pid': pid})
    with pytest.raises(IntegrityError, match='uq_prediction_scope_revision'):
        with pg['engine'].begin() as conn:
            conn.execute(text('''INSERT INTO ai_prediction(student_id,class_id,subject_id,source_period_id,target_period_id,model_version_id,revision,risk_level,data_status)
                SELECT student_id,class_id,subject_id,source_period_id,target_period_id,model_version_id,revision,risk_level,data_status FROM ai_prediction WHERE prediction_id=:pid'''), {'pid': pid})
    assert counts(pg) == ([1], 1)


def test_children_keep_original_ids_when_successor_created(pg):
    from sqlalchemy.orm import Session
    from app.services.prediction.PredictionOutcomeService import evaluate_prediction_outcome
    from app.models.ai.TeacherRiskReview import TeacherRiskReview
    from app.models.suggestion.StudentSuggestion import StudentSuggestion
    first = run(pg, 'first')
    with pg['engine'].begin() as conn:
        conn.execute(text('UPDATE student_submission SET grade=70'))
    second = run(pg, 'second')
    assert second['revision'] == 2
    with Session(pg['engine']) as db, db.begin():
        evaluate_prediction_outcome(db, first['prediction_id'], 88, commit=False)
        db.add(TeacherRiskReview(prediction_id=first['prediction_id'], student_id=pg['scope']['student_id'],
            reviewed_by_staff_id=pg['staff'].staff_id, review_decision='CONFIRMED_RISK'))
        from app.models.academic.Lesson import Lesson
        lesson = Lesson(subject_id=pg['scope']['subject_id'], title='Retained lesson')
        db.add(lesson); db.flush()
        db.add(StudentSuggestion(lesson_id=lesson.lesson_id, student_id=pg['scope']['student_id'], subject_id=pg['scope']['subject_id'],
            prediction_id=first['prediction_id'], suggestion_type='MANUAL', resource_type='LESSON', title='Retained intervention', status='ACTIVE'))
    # Known outcomes block NEW generation, but do not block original request replay.
    with pytest.raises(ValueError, match='already finalized or known'): run(pg, 'new')
    assert run(pg, 'first')['prediction_id'] == first['prediction_id']
    with pg['engine'].connect() as conn:
        for table in ['prediction_outcome', 'teacher_risk_review', 'student_suggestion']:
            assert conn.execute(text(f'SELECT prediction_id FROM {table}')).scalars().all() == [first['prediction_id']]


def test_legacy_migration_null_models_duplicates_and_downgrade(pg):
    with pg['engine'].begin() as conn:
        migration(conn, 'downgrade')
        params = {**pg['scope'], 'model': pg['model'].model_version_id}
        for model in [params['model'], params['model'], None, None]:
            conn.execute(text('''INSERT INTO ai_prediction(student_id,class_id,subject_id,source_period_id,target_period_id,model_version_id,risk_level,data_status,generated_at)
              VALUES (:student_id,:class_id,:subject_id,:source_period_id,:target_period_id,:model,'LOW_RISK','SUFFICIENT','2026-01-01')'''), {**params, 'model': model})
        before = conn.execute(text('SELECT prediction_id,model_version_id FROM ai_prediction ORDER BY prediction_id')).all()
        migration(conn, 'upgrade')
        after = conn.execute(text('SELECT prediction_id,model_version_id,revision FROM ai_prediction ORDER BY prediction_id')).all()
        assert [(r[0], r[1]) for r in after] == before
        assert [r[2] for r in after] == [1, 2, 1, 2]
    with pytest.raises(IntegrityError, match='uq_prediction_legacy_scope_revision'):
        with pg['engine'].begin() as conn:
            conn.execute(text('''INSERT INTO ai_prediction(student_id,class_id,subject_id,source_period_id,target_period_id,model_version_id,revision,risk_level,data_status)
                SELECT student_id,class_id,subject_id,source_period_id,target_period_id,NULL,revision,risk_level,data_status FROM ai_prediction WHERE model_version_id IS NULL LIMIT 1'''))
    with pg['engine'].begin() as conn:
        migration(conn, 'downgrade')
        assert conn.execute(text('SELECT prediction_id,model_version_id FROM ai_prediction ORDER BY prediction_id')).all() == before
    print('PG legacy migration: 4 IDs preserved; model series [1,2], null-model legacy series [1,2]; downgrade preserves all rows')

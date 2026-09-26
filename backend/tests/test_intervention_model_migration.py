"""Focused contract checks for the Intervention table and Alembic DDL."""

from datetime import datetime, timezone
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from uuid import uuid4

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import IntegrityError

import app.models  # noqa: F401
from app.models.intervention.Intervention import Intervention


def _migrated_engine():
    engine = create_engine("sqlite://")
    path = Path(__file__).parents[1] / "migrations" / "versions" / "20260926_intervention_core.py"
    spec = spec_from_file_location("intervention_core_migration", path)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    with engine.begin() as connection:
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade()
    return engine


def _row(*, student_id, class_id=1, subject_id=1, period_id=1, prediction_id=1, status="CANDIDATE", **extra):
    return dict(
        student_id=student_id,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=period_id,
        source_prediction_id=prediction_id,
        status=status,
        **extra,
    )


def test_migration_matches_model_scope_and_prediction_link():
    engine = _migrated_engine()
    try:
        inspector = inspect(engine)
        assert "intervention" in inspector.get_table_names()
        columns = {column["name"]: column for column in inspector.get_columns("intervention")}
        # This test exercises the core migration in isolation; later migrations
        # may add columns to the current ORM model.
        assert set(columns).issubset(set(Intervention.__table__.columns.keys()))
        for name in ("student_id", "class_id", "subject_id", "academic_period_id", "source_prediction_id", "status", "created_at"):
            assert columns[name]["nullable"] is False
        targets = {fk["referred_table"] for fk in inspector.get_foreign_keys("intervention")}
        assert targets == {"student", "class", "subject", "academic_period", "development_current_term_prediction", "academic_staff"}
        indexes = {index["name"]: index for index in inspector.get_indexes("intervention")}
        assert bool(indexes["uq_intervention_open_scope"]["unique"])
        assert indexes["uq_intervention_open_scope"]["column_names"] == [
            "student_id", "class_id", "subject_id", "academic_period_id",
        ]
    finally:
        engine.dispose()


def test_open_scope_is_unique_but_resolved_history_and_other_subjects_are_allowed():
    engine = _migrated_engine()
    student = uuid4()
    table = Intervention.__table__
    try:
        with engine.begin() as connection:
            connection.execute(table.insert().values(**_row(student_id=student)))
            connection.execute(table.insert().values(**_row(student_id=student, subject_id=2, prediction_id=2)))
        with pytest.raises(IntegrityError):
            with engine.begin() as connection:
                connection.execute(table.insert().values(**_row(student_id=student, prediction_id=3)))
        with engine.begin() as connection:
            connection.execute(table.update().where(table.c.source_prediction_id == 1).values(
                status="RESOLVED", resolution_reason="IMPROVED_PREDICTION", resolved_at=datetime.now(timezone.utc),
            ))
            connection.execute(table.insert().values(**_row(student_id=student, prediction_id=3)))
        with pytest.raises(IntegrityError):
            with engine.begin() as connection:
                connection.execute(table.insert().values(**_row(student_id=student, class_id=2, prediction_id=3)))
    finally:
        engine.dispose()


@pytest.mark.parametrize("changes", [
    {"status": "UNKNOWN"},
    {"status": "ACTIVE"},
    {"status": "RESOLVED"},
    {"status": "CANDIDATE", "resolution_reason": "IMPROVED_PREDICTION"},
    {"status": "CANDIDATE", "activated_at": datetime.now(timezone.utc)},
])
def test_invalid_lifecycle_rows_are_rejected(changes):
    engine = _migrated_engine()
    try:
        with pytest.raises(IntegrityError):
            with engine.begin() as connection:
                connection.execute(Intervention.__table__.insert().values(**_row(student_id=uuid4(), **changes)))
    finally:
        engine.dispose()

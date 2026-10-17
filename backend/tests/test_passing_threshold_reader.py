"""Isolated SQL reader coverage; shared scenarios also execute on guarded PG.

Only the four configuration-table projections used by R1 are created. These
fixtures contain no accounts, grades, student information or production data.
"""
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal
import ast
import inspect

import pytest
from sqlalchemy import Boolean, Column, Integer, MetaData, Numeric, String, Table, Text
from sqlalchemy import create_engine, event, insert, update
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.models.academic.Subject import Subject
from app.services.grading import PassingThresholdReader as reader
from app.services.grading.PassingThresholdReader import read_passing_threshold_context
from app.services.grading.PassingThresholdResolver import (
    PassingThresholdConfigurationError, PassingThresholdSnapshot,
    compare_stored_final_grade, resolve_passing_threshold,
)


READER_PARITY_CASES = (
    "live_subjects", "inactive_group", "null_group", "missing_group",
    "missing_subject", "raw_general_average", "invalid_general_average",
    "missing_general_average", "historical_snapshot", "ambiguous_active_year",
    "missing_year", "query_count_and_no_writes",
)


def threshold_metadata():
    metadata = MetaData()
    Table("academic_year", metadata,
        Column("academic_year_id", Integer, primary_key=True), Column("is_active", Boolean))
    Table("subject_groups", metadata,
        Column("subject_group_id", Integer, primary_key=True),
        Column("passing_threshold", Numeric(5, 2)), Column("is_active", Boolean))
    Table("subject", metadata,
        Column("subject_id", Integer, primary_key=True), Column("subject_group_id", Integer))
    Table("setting", metadata,
        Column("key", String(100), primary_key=True), Column("value", Text))
    return metadata


@contextmanager
def recorded_statements(db):
    statements = []
    bind = db.get_bind()

    def record(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(bind, "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(bind, "before_cursor_execute", record)


def seed_context(db, metadata, *, size=2):
    db.execute(insert(metadata.tables["academic_year"]), [
        {"academic_year_id": 1, "is_active": True},
        {"academic_year_id": 2, "is_active": False},
    ])
    db.execute(insert(metadata.tables["subject_groups"]), [
        {"subject_group_id": 20, "passing_threshold": Decimal("85.00"), "is_active": True},
        {"subject_group_id": 21, "passing_threshold": Decimal("83.00"), "is_active": False},
    ])
    db.execute(insert(metadata.tables["subject"]), [
        {"subject_id": index + 10, "subject_group_id": 20 if index % 2 == 0 else 21}
        for index in range(size)
    ])
    db.execute(insert(metadata.tables["setting"]), [
        {"key": "general_average_passing_grade", "value": " 80.25 "},
        {"key": "unrelated_private_configuration", "value": "not selected by the reader"},
    ])
    db.commit()


def expect_code(code, callback):
    with pytest.raises(PassingThresholdConfigurationError) as caught:
        callback()
    assert caught.value.code == code


def exercise_reader_case(db, metadata, case):
    """The same assertions, not separate expected-value implementations, on PG/SQLite."""
    seed_context(db, metadata, size=200 if case == "query_count_and_no_writes" else 2)
    subjects = metadata.tables["subject"]
    settings = metadata.tables["setting"]
    years = metadata.tables["academic_year"]
    if case in {"null_group", "missing_group"}:
        db.execute(update(subjects).where(subjects.c.subject_id == 10).values(
            subject_group_id=None if case == "null_group" else 999))
        db.commit()
    if case == "ambiguous_active_year":
        db.execute(update(years).values(is_active=True))
        db.commit()
        expect_code("academic_year_ambiguous", lambda: read_passing_threshold_context(
            db, academic_year_id=1, subject_ids=[10]))
        return
    if case == "missing_year":
        expect_code("academic_year_missing", lambda: read_passing_threshold_context(
            db, academic_year_id=999, subject_ids=[10]))
        return
    if case in {"invalid_general_average", "missing_general_average"}:
        # An absent key, not SettingsCache's parsed 0, is the missing-setting case.
        values = ({"value": "NaN"} if case == "invalid_general_average"
                  else {"key": "renamed_missing_setting"})
        db.execute(update(settings).where(settings.c.key == "general_average_passing_grade").values(**values))
        db.commit()
    year = 2 if case == "historical_snapshot" else 1
    ids = range(10, 210) if case == "query_count_and_no_writes" else [10, 11, 999]
    with recorded_statements(db) as statements:
        context = read_passing_threshold_context(db, academic_year_id=year, subject_ids=ids)
        assert all(statement.lstrip().upper().startswith("SELECT") for statement in statements)
        assert len(statements) == 4
        assert not any("snapshot" in statement.lower() or "frozen" in statement.lower()
                       for statement in statements)
        if case in {"null_group", "missing_group"}:
            expect_code("subject_group_missing", lambda: resolve_passing_threshold(
                context, academic_year_id=1, scope="subject", subject_id=10))
        elif case == "missing_subject":
            expect_code("subject_missing", lambda: resolve_passing_threshold(
                context, academic_year_id=1, scope="subject", subject_id=999))
        elif case in {"invalid_general_average", "missing_general_average"}:
            code = ("general_average_threshold_invalid" if case == "invalid_general_average"
                    else "general_average_threshold_missing")
            expect_code(code, lambda: resolve_passing_threshold(
                context, academic_year_id=1, scope="general_average"))
            # A broken GA setting does not erase an independently valid subject threshold.
            assert resolve_passing_threshold(context, academic_year_id=1,
                scope="subject", subject_id=11).threshold == Decimal("83.00")
        elif case == "historical_snapshot":
            assert context.policy_mode == "snapshot_required"
            expect_code("historical_threshold_snapshot_missing", lambda: resolve_passing_threshold(
                context, academic_year_id=2, scope="subject", subject_id=10))
            snapshot = PassingThresholdSnapshot(academic_year_id=2, scope="subject",
                threshold=Decimal("87.25"), policy_version="r2-contract", revision=1,
                captured_at=datetime(2026, 10, 17, tzinfo=timezone.utc),
                subject_id=10, subject_group_id=20)
            assert resolve_passing_threshold(context, academic_year_id=2, scope="subject",
                subject_id=10, result_snapshot=snapshot).threshold == Decimal("87.25")
        else:
            core = resolve_passing_threshold(context, academic_year_id=1, scope="subject", subject_id=10)
            applied = resolve_passing_threshold(context, academic_year_id=1, scope="subject", subject_id=11)
            assert isinstance(core.threshold, Decimal)
            assert (core.threshold, applied.threshold) == (Decimal("85.00"), Decimal("83.00"))
            assert context.subject_groups[21].is_active is False
            assert compare_stored_final_grade(Decimal("84.00"), core) is False
            assert compare_stored_final_grade(Decimal("84.00"), applied) is True
            assert context.general_average_raw == " 80.25 "
            assert resolve_passing_threshold(context, academic_year_id=1,
                scope="general_average").threshold == Decimal("80.25")
        # Resolution/comparison is pure: iterating all subject thresholds adds no SQL.
        if case == "query_count_and_no_writes":
            for subject_id in range(10, 210):
                resolve_passing_threshold(context, academic_year_id=1, scope="subject", subject_id=subject_id)
        assert len(statements) == 4


@pytest.fixture
def sqlite_config_session():
    engine = create_engine("sqlite:///:memory:", poolclass=StaticPool)
    metadata = threshold_metadata()
    metadata.create_all(engine)
    with Session(engine) as db:
        yield db, metadata
    engine.dispose()


@pytest.mark.parametrize("case", READER_PARITY_CASES)
def test_bulk_reader_sqlite_parity_scenarios(sqlite_config_session, case):
    exercise_reader_case(*sqlite_config_session, case)


@pytest.mark.parametrize("size", [1, 2, 200])
def test_query_count_is_four_regardless_of_subject_count(sqlite_config_session, size):
    db, metadata = sqlite_config_session
    seed_context(db, metadata, size=size)
    with recorded_statements(db) as statements:
        result = read_passing_threshold_context(db, academic_year_id=1,
            subject_ids=(value for value in list(range(10, 10 + size)) * 2))
    assert len(result.subjects) == size
    assert len(statements) == 4


def test_pending_orm_state_is_not_flushed_or_committed(sqlite_config_session, monkeypatch):
    db, metadata = sqlite_config_session
    seed_context(db, metadata)
    pending = Subject(subject_id=12345, subject_name="Pending fixture must not be written")
    db.add(pending)

    def forbid_write(*args, **kwargs):
        raise AssertionError("The production reader must not flush, commit or roll back")

    with monkeypatch.context() as no_writes:
        for method in ("flush", "commit", "rollback"):
            no_writes.setattr(db, method, forbid_write)
        with recorded_statements(db) as statements:
            result = read_passing_threshold_context(db, academic_year_id=1, subject_ids=[10, 11, 12345])
    assert pending in db.new
    assert 12345 not in result.subjects
    assert len(statements) == 4
    assert all(statement.lstrip().upper().startswith("SELECT") for statement in statements)
    assert not db.identity_map  # scalar projections never hydrate a relationship graph
    db.expunge(pending)


def test_raw_setting_is_reloaded_without_global_cache(sqlite_config_session):
    db, metadata = sqlite_config_session
    seed_context(db, metadata)
    first = read_passing_threshold_context(db, academic_year_id=1, subject_ids=[10])
    db.execute(update(metadata.tables["setting"]).where(
        metadata.tables["setting"].c.key == "general_average_passing_grade").values(value="83.00"))
    db.execute(update(metadata.tables["subject_groups"]).where(
        metadata.tables["subject_groups"].c.subject_group_id == 20).values(passing_threshold=Decimal("86.00")))
    db.commit()
    second = read_passing_threshold_context(db, academic_year_id=1, subject_ids=[10])
    assert first.general_average_raw == " 80.25 "
    assert second.general_average_raw == "83.00"
    assert first.subject_groups[20].passing_threshold == Decimal("85.00")
    assert second.subject_groups[20].passing_threshold == Decimal("86.00")


@pytest.mark.parametrize("raw", ["", "true", "NaN", "Infinity", "-1", "100.01", "1_0", "80%", "8e1"])
def test_reader_preserves_invalid_raw_text_for_explicit_resolution_error(sqlite_config_session, raw):
    db, metadata = sqlite_config_session
    seed_context(db, metadata)
    settings = metadata.tables["setting"]
    db.execute(update(settings).where(settings.c.key == "general_average_passing_grade").values(value=raw))
    db.commit()
    context = read_passing_threshold_context(db, academic_year_id=1)
    assert context.general_average_raw == raw
    expect_code("general_average_threshold_invalid", lambda: resolve_passing_threshold(
        context, academic_year_id=1, scope="general_average"))


@pytest.mark.parametrize("value", [None, Decimal("-0.01"), Decimal("100.01")])
def test_invalid_database_group_value_never_gets_a_fallback(sqlite_config_session, value):
    db, metadata = sqlite_config_session
    seed_context(db, metadata)
    groups = metadata.tables["subject_groups"]
    db.execute(update(groups).where(groups.c.subject_group_id == 20).values(passing_threshold=value))
    db.commit()
    context = read_passing_threshold_context(db, academic_year_id=1, subject_ids=[10])
    expect_code("passing_threshold_invalid", lambda: resolve_passing_threshold(
        context, academic_year_id=1, scope="subject", subject_id=10))


@pytest.mark.parametrize("arguments", [
    {"academic_year_id": True}, {"academic_year_id": 0},
    {"academic_year_id": 1, "subject_ids": [True]},
    {"academic_year_id": 1, "subject_ids": ["10"]},
    {"academic_year_id": 1, "subject_group_ids": [-1]},
])
def test_invalid_identity_rejected_before_any_query(sqlite_config_session, arguments):
    db, metadata = sqlite_config_session
    with recorded_statements(db) as statements:
        with pytest.raises(PassingThresholdConfigurationError):
            read_passing_threshold_context(db, **arguments)
    assert statements == []


def test_group_only_and_general_average_only_queries_are_bounded(sqlite_config_session):
    db, metadata = sqlite_config_session
    seed_context(db, metadata)
    with recorded_statements(db) as statements:
        context = read_passing_threshold_context(db, academic_year_id=1, subject_group_ids=[21, 21])
        assert resolve_passing_threshold(context, academic_year_id=1,
            scope="subject", subject_group_id=21).threshold == Decimal("83.00")
    assert len(statements) == 3
    with recorded_statements(db) as statements:
        context = read_passing_threshold_context(db, academic_year_id=1)
        assert resolve_passing_threshold(context, academic_year_id=1,
            scope="general_average").threshold == Decimal("80.25")
    assert len(statements) == 2


def test_no_active_year_requires_snapshot_without_assuming_a_closed_year(sqlite_config_session):
    db, metadata = sqlite_config_session
    seed_context(db, metadata)
    db.execute(update(metadata.tables["academic_year"]).values(is_active=False))
    db.commit()
    context = read_passing_threshold_context(db, academic_year_id=1, subject_ids=[10])
    assert context.active_academic_year_id is None
    assert context.policy_mode == "snapshot_required"
    expect_code("historical_threshold_snapshot_missing", lambda: resolve_passing_threshold(
        context, academic_year_id=1, scope="subject", subject_id=10))


def test_sql_only_selects_configuration_columns(sqlite_config_session):
    db, metadata = sqlite_config_session
    seed_context(db, metadata)
    with recorded_statements(db) as statements:
        read_passing_threshold_context(db, academic_year_id=1, subject_ids=[10, 11])
    sql = " ".join(statements).lower()
    for forbidden in ("student", "user_account", "first_name", "last_name", "lrn", "contact",
                      "snapshot", "frozen", "subject_name", "setting.type"):
        assert forbidden not in sql


def test_reader_source_has_no_cache_application_config_or_writes():
    tree = ast.parse(inspect.getsource(reader))
    source = inspect.getsource(reader)
    imports = [node.module or "" for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)]
    assert not any("SettingsCache" in name or "Config" in name or "SessionLocal" in name for name in imports)
    calls = [node.func.attr for node in ast.walk(tree)
             if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)]
    assert not set(calls) & {"flush", "commit", "rollback", "delete", "update", "insert"}
    assert "db.add(" not in source  # set.add() only deduplicates identifiers

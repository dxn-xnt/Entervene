"""Shared isolated SQLite/guarded-PG cases for current configuration projections."""
from contextlib import contextmanager
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
    PassingThresholdConfigurationError, compare_stored_final_grade, resolve_passing_threshold,
)

READER_PARITY_CASES = (
    "live_subjects", "archived_template", "null_template", "missing_template",
    "missing_subject", "raw_general_average", "invalid_general_average",
    "missing_general_average", "inactive_open_year", "multiple_active_flags",
    "missing_year", "query_count_and_no_writes",
)


def threshold_metadata():
    metadata = MetaData()
    Table("academic_year", metadata,
        Column("academic_year_id", Integer, primary_key=True), Column("is_active", Boolean))
    Table("grading_template", metadata,
        Column("grading_template_id", Integer, primary_key=True),
        Column("passing_threshold", Numeric(5, 2)), Column("status", String(20)))
    Table("subject", metadata,
        Column("subject_id", Integer, primary_key=True), Column("grading_template_id", Integer))
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
        {"academic_year_id": 1, "is_active": True}, {"academic_year_id": 2, "is_active": False}])
    db.execute(insert(metadata.tables["grading_template"]), [
        {"grading_template_id": 20, "passing_threshold": Decimal("85.00"), "status": "active"},
        {"grading_template_id": 21, "passing_threshold": Decimal("83.00"), "status": "archived"}])
    db.execute(insert(metadata.tables["subject"]), [
        {"subject_id": i + 10, "grading_template_id": 20 if i % 2 == 0 else 21} for i in range(size)])
    db.execute(insert(metadata.tables["setting"]), [
        {"key": "general_average_passing_grade", "value": " 80.25 "},
        {"key": "unrelated_private_configuration", "value": "not selected"}])
    db.commit()


def expect_code(code, callback):
    with pytest.raises(PassingThresholdConfigurationError) as caught:
        callback()
    assert caught.value.code == code


def exercise_reader_case(db, metadata, case):
    """Identical expected-value implementation on SQLite and guarded PostgreSQL."""
    seed_context(db, metadata, size=200 if case == "query_count_and_no_writes" else 2)
    subjects, settings = metadata.tables["subject"], metadata.tables["setting"]
    if case in {"null_template", "missing_template"}:
        db.execute(update(subjects).where(subjects.c.subject_id == 10).values(
            grading_template_id=None if case == "null_template" else 999))
        db.commit()
    if case == "multiple_active_flags":
        db.execute(update(metadata.tables["academic_year"]).values(is_active=True))
        db.commit()
    if case == "missing_year":
        expect_code("academic_year_missing", lambda: read_passing_threshold_context(
            db, academic_year_id=999, subject_ids=[10]))
        return
    if case in {"invalid_general_average", "missing_general_average"}:
        values = {"value": "NaN"} if case == "invalid_general_average" else {"key": "renamed_setting"}
        db.execute(update(settings).where(settings.c.key == "general_average_passing_grade").values(**values))
        db.commit()
    year = 2 if case == "inactive_open_year" else 1
    ids = range(10, 210) if case == "query_count_and_no_writes" else [10, 11, 999]
    with recorded_statements(db) as statements:
        ctx = read_passing_threshold_context(db, academic_year_id=year, subject_ids=ids)
        assert len(statements) == 3
        assert all(s.lstrip().upper().startswith("SELECT") for s in statements)
        assert ctx.academic_year_id == year and ctx.policy_mode == "live"
        if case in {"null_template", "missing_template"}:
            expect_code("grading_template_missing", lambda: resolve_passing_threshold(
                ctx, academic_year_id=year, scope="subject", subject_id=10))
        elif case == "missing_subject":
            expect_code("subject_missing", lambda: resolve_passing_threshold(
                ctx, academic_year_id=year, scope="subject", subject_id=999))
        elif case in {"invalid_general_average", "missing_general_average"}:
            code = "general_average_threshold_invalid" if case == "invalid_general_average" else "general_average_threshold_missing"
            expect_code(code, lambda: resolve_passing_threshold(ctx, academic_year_id=year, scope="general_average"))
            assert resolve_passing_threshold(ctx, academic_year_id=year, scope="subject", subject_id=11).threshold == Decimal("83")
        else:
            core = resolve_passing_threshold(ctx, academic_year_id=year, scope="subject", subject_id=10)
            applied = resolve_passing_threshold(ctx, academic_year_id=year, scope="subject", subject_id=11)
            assert (core.threshold, applied.threshold) == (Decimal("85"), Decimal("83"))
            assert compare_stored_final_grade(Decimal("84"), core) is False
            assert compare_stored_final_grade(Decimal("84"), applied) is True
            assert resolve_passing_threshold(ctx, academic_year_id=year, scope="general_average").threshold == Decimal("80.25")
        if case == "query_count_and_no_writes":
            for sid in range(10, 210):
                resolve_passing_threshold(ctx, academic_year_id=year, scope="subject", subject_id=sid)
        assert len(statements) == 3


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
def test_query_count_is_three_regardless_of_subject_count(sqlite_config_session, size):
    db, metadata = sqlite_config_session
    seed_context(db, metadata, size=size)
    with recorded_statements(db) as statements:
        ctx = read_passing_threshold_context(db, academic_year_id=2,
            subject_ids=(sid for sid in list(range(10, 10 + size)) * 2))
    assert len(ctx.subjects) == size and len(statements) == 3


def test_pending_orm_state_is_not_flushed_committed_or_rolled_back(sqlite_config_session, monkeypatch):
    db, metadata = sqlite_config_session
    seed_context(db, metadata)
    pending = Subject(subject_id=12345, subject_name="Pending", grading_template_id=20)
    db.add(pending)
    def forbid(*args, **kwargs):
        raise AssertionError("Reader must not flush, commit or roll back")
    with monkeypatch.context() as no_writes:
        for method in ("flush", "commit", "rollback"):
            no_writes.setattr(db, method, forbid)
        with recorded_statements(db) as statements:
            ctx = read_passing_threshold_context(db, academic_year_id=1, subject_ids=[10, 12345])
    assert pending in db.new and 12345 not in ctx.subjects
    assert len(statements) == 3 and not db.identity_map
    db.expunge(pending)


def test_raw_setting_and_template_are_reloaded_without_global_cache(sqlite_config_session):
    db, metadata = sqlite_config_session
    seed_context(db, metadata)
    before = read_passing_threshold_context(db, academic_year_id=1, subject_ids=[10])
    db.execute(update(metadata.tables["setting"]).where(
        metadata.tables["setting"].c.key == "general_average_passing_grade").values(value="83.00"))
    db.execute(update(metadata.tables["grading_template"]).where(
        metadata.tables["grading_template"].c.grading_template_id == 20).values(passing_threshold=Decimal("86")))
    db.commit()
    after = read_passing_threshold_context(db, academic_year_id=1, subject_ids=[10])
    assert before.general_average_raw == " 80.25 " and after.general_average_raw == "83.00"
    assert before.grading_templates[20].passing_threshold == Decimal("85")
    assert after.grading_templates[20].passing_threshold == Decimal("86")


@pytest.mark.parametrize("raw", ["", "true", "NaN", "Infinity", "-1", "100.01", "1_0", "80%", "8e1"])
def test_invalid_raw_legacy_setting_never_gets_a_fallback(sqlite_config_session, raw):
    db, metadata = sqlite_config_session
    seed_context(db, metadata)
    settings = metadata.tables["setting"]
    db.execute(update(settings).where(settings.c.key == "general_average_passing_grade").values(value=raw))
    db.commit()
    ctx = read_passing_threshold_context(db, academic_year_id=1)
    assert ctx.general_average_raw == raw
    expect_code("general_average_threshold_invalid", lambda: resolve_passing_threshold(
        ctx, academic_year_id=1, scope="general_average"))


@pytest.mark.parametrize("value", [None, Decimal("-0.01"), Decimal("100.01")])
def test_invalid_database_template_value_never_gets_a_fallback(sqlite_config_session, value):
    db, metadata = sqlite_config_session
    seed_context(db, metadata)
    templates = metadata.tables["grading_template"]
    db.execute(update(templates).where(templates.c.grading_template_id == 20).values(passing_threshold=value))
    db.commit()
    ctx = read_passing_threshold_context(db, academic_year_id=1, subject_ids=[10])
    expect_code("passing_threshold_invalid", lambda: resolve_passing_threshold(
        ctx, academic_year_id=1, scope="subject", subject_id=10))


@pytest.mark.parametrize("args", [{"academic_year_id": True}, {"academic_year_id": 0},
    {"academic_year_id": 1, "subject_ids": [True]}, {"academic_year_id": 1, "subject_ids": ["10"]}])
def test_invalid_identity_rejected_before_query(sqlite_config_session, args):
    db, _ = sqlite_config_session
    with recorded_statements(db) as statements:
        with pytest.raises(PassingThresholdConfigurationError):
            read_passing_threshold_context(db, **args)
    assert statements == []


def test_general_average_only_requires_two_selects(sqlite_config_session):
    db, metadata = sqlite_config_session
    seed_context(db, metadata)
    with recorded_statements(db) as statements:
        ctx = read_passing_threshold_context(db, academic_year_id=2)
        result = resolve_passing_threshold(ctx, academic_year_id=2, scope="general_average")
    assert len(statements) == 2 and result.source == "legacy_general_average_setting"


def test_activation_flags_are_irrelevant_to_requested_year(sqlite_config_session):
    db, metadata = sqlite_config_session
    seed_context(db, metadata)
    db.execute(update(metadata.tables["academic_year"]).values(is_active=False))
    db.commit()
    ctx = read_passing_threshold_context(db, academic_year_id=2, subject_ids=[10])
    assert resolve_passing_threshold(ctx, academic_year_id=2, scope="subject", subject_id=10).threshold == Decimal("85")


def test_only_existing_configuration_columns_are_selected(sqlite_config_session):
    db, metadata = sqlite_config_session
    seed_context(db, metadata)
    with recorded_statements(db) as statements:
        read_passing_threshold_context(db, academic_year_id=2, subject_ids=[10, 11])
    sql = " ".join(statements).lower()
    for forbidden in ("student", "user_account", "lrn", "contact", "snapshot", "closed_at",
                      "is_active", "subject_name", "subject_group", "setting.type"):
        assert forbidden not in sql


def test_reader_has_no_cache_or_writes():
    source = inspect.getsource(reader)
    tree = ast.parse(source)
    calls = [n.func.attr for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)]
    assert not set(calls) & {"flush", "commit", "rollback", "delete", "update", "insert"}
    assert "db.add(" not in source and "SettingsCache" not in source

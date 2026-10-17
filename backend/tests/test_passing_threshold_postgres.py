"""Opt-in PostgreSQL parity for the R1 bulk reader, never public/live tables.

Only activity_test on literal localhost/127.0.0.1, explicit port 55432, with
the existing dashboard guard is accepted. Missing/invalid targets SKIP before
schema writes. A connection/query failure on a valid target FAILS, sanitized.
Each parity case creates four minimal configuration tables inside its own UUID
schema, then drops only that schema after revalidating the connected database.
"""
from contextlib import contextmanager
import os
import sys
import uuid
from unittest.mock import MagicMock, Mock

import pytest
from sqlalchemy.orm import Session
from sqlalchemy.schema import CreateSchema, DropSchema

from tests import test_teacher_dashboard_postgres as guard
from tests.test_passing_threshold_reader import (
    READER_PARITY_CASES, exercise_reader_case, threshold_metadata,
)

# Reuse the existing HTTP prohibition as well as its tested target guard.
prohibit_external_provider_http = guard.prohibit_external_provider_http


def _target_engine_or_skip():
    if not os.environ.get("DASHBOARD_TEST_PG_URL"):
        pytest.skip("DASHBOARD_TEST_PG_URL is unset or empty; PostgreSQL parity is opt-in")
    try:
        return guard._guarded_postgres_engine()
    except guard.DashboardPostgresSafetyError as error:
        pytest.skip(guard._safe_failure("passing-threshold target validation", error))


def _checked_database_or_skip(connection):
    try:
        guard._validate_connected_database(connection)
    except guard.DashboardPostgresSafetyError:
        pytest.skip("PostgreSQL passing-threshold target validation refused; check=database")


def _drop_owned_schema(engine, schema):
    # Ownership is established by our successful CreateSchema, never by an
    # external name. Re-check both the generated name and actual DB on cleanup.
    guard._validate_schema_name(schema)
    with engine.begin() as connection:
        guard._validate_connected_database(connection)
        connection.execute(DropSchema(schema, cascade=True, if_exists=True))


@contextmanager
def _guarded_config_session():
    engine = None
    session = None
    created = False
    schema = "dashboard_test_" + uuid.uuid4().hex
    metadata = threshold_metadata()
    stage = "passing-threshold target validation"
    try:
        engine = _target_engine_or_skip()
        stage = "passing-threshold connection validation"
        with engine.begin() as connection:
            _checked_database_or_skip(connection)
            guard._validate_schema_name(schema)
            stage = "passing-threshold schema creation"
            connection.execute(CreateSchema(schema))
            created = True
            translated = connection.execution_options(schema_translate_map={None: schema})
            metadata.create_all(translated)
        session = Session(bind=engine.execution_options(schema_translate_map={None: schema}))
        stage = "passing-threshold bulk reader parity"
        yield session, metadata
    except Exception as error:
        pytest.fail(guard._safe_failure(stage, error), pytrace=False)
    finally:
        try:
            if session is not None:
                session.close()
        finally:
            if engine is not None:
                try:
                    if created:
                        try:
                            _drop_owned_schema(engine, schema)
                        except Exception as error:
                            pytest.fail(guard._safe_failure("passing-threshold isolated schema cleanup", error),
                                        pytrace=False)
                finally:
                    engine.dispose()


@pytest.fixture
def postgres_config_session():
    with _guarded_config_session() as context:
        yield context


@pytest.mark.parametrize("case", READER_PARITY_CASES)
def test_passing_threshold_bulk_reader_execute_on_guarded_postgres(postgres_config_session, case):
    exercise_reader_case(*postgres_config_session, case)


@pytest.mark.parametrize("raw", [None, ""])
def test_missing_target_skips_before_engine_or_connection(monkeypatch, raw):
    if raw is None:
        monkeypatch.delenv("DASHBOARD_TEST_PG_URL", raising=False)
    else:
        monkeypatch.setenv("DASHBOARD_TEST_PG_URL", raw)
    engine = Mock()
    monkeypatch.setattr(guard, "_guarded_postgres_engine", engine)
    with pytest.raises(pytest.skip.Exception, match="unset or empty"):
        with _guarded_config_session():
            pytest.fail("An unset target must never yield a database")
    engine.assert_not_called()


@pytest.mark.parametrize("raw,check", [
    ("not-a-url", "url_parse"),
    ("sqlite:///:memory:", "driver"),
    ("postgresql+psycopg2://fixture@localhost:55432/activity_test", "driver"),
    ("postgresql://fixture@remote.invalid:55432/activity_test", "host"),
    ("postgresql://fixture@localhost:5432/activity_test", "port"),
    ("postgresql://fixture@localhost:55432/entervene_preview", "database"),
    ("postgresql://fixture@localhost:55432/activity_test?host=remote.invalid", "query_parameters"),
])
def test_invalid_target_skips_before_engine_creation(monkeypatch, raw, check):
    monkeypatch.setenv("DASHBOARD_TEST_PG_URL", raw)
    engine = Mock()
    monkeypatch.setattr(guard, "create_engine", engine)
    with pytest.raises(pytest.skip.Exception, match=f"check={check}"):
        with _guarded_config_session():
            pytest.fail("An unsafe target must never yield a database")
    engine.assert_not_called()


def test_routing_override_skips_before_engine_creation(monkeypatch):
    monkeypatch.setenv("DASHBOARD_TEST_PG_URL", "postgresql://fixture@localhost:55432/activity_test")
    monkeypatch.setenv("PGHOST", "synthetic-unsafe-routing")
    monkeypatch.setattr(guard.importlib.util, "find_spec", lambda name: object())
    engine = Mock()
    monkeypatch.setattr(guard, "create_engine", engine)
    with pytest.raises(pytest.skip.Exception, match="check=routing_environment"):
        _target_engine_or_skip()
    engine.assert_not_called()


def test_driver_unavailable_skips_before_engine_creation(monkeypatch):
    monkeypatch.setenv("DASHBOARD_TEST_PG_URL", "postgresql://fixture@localhost:55432/activity_test")
    monkeypatch.setattr(guard.importlib.util, "find_spec", lambda name: None)
    engine = Mock()
    monkeypatch.setattr(guard, "create_engine", engine)
    with pytest.raises(pytest.skip.Exception, match="check=driver_available"):
        _target_engine_or_skip()
    engine.assert_not_called()


def test_connected_database_mismatch_skips_before_any_schema_write(monkeypatch):
    engine = MagicMock()
    connection = engine.begin.return_value.__enter__.return_value
    connection.dialect.name = "postgresql"
    connection.execute.return_value.scalar_one.return_value = "synthetic_wrong_database"
    monkeypatch.setattr(sys.modules[__name__], "_target_engine_or_skip", lambda: engine)
    with pytest.raises(pytest.skip.Exception, match="check=database"):
        with _guarded_config_session():
            pytest.fail("A wrong connected database must not yield a session")
    assert connection.execute.call_count == 1
    assert str(connection.execute.call_args.args[0]) == "SELECT current_database()"
    engine.dispose.assert_called_once()


@pytest.mark.parametrize("error", [
    RuntimeError("postgresql://private-user:private-password@private-host/private-db"),
    ValueError("private-user private-password private exception payload"),
    guard.DashboardPostgresSafetyError("private-user private-password unknown guard text"),
])
def test_failure_and_skip_messages_do_not_disclose_target_or_exception(monkeypatch, error):
    monkeypatch.setenv("DASHBOARD_TEST_PG_URL", "synthetic-private-target")

    def refuse():
        raise error

    monkeypatch.setattr(guard, "_guarded_postgres_engine", refuse)
    outcome = (pytest.skip.Exception if isinstance(error, guard.DashboardPostgresSafetyError)
               else pytest.fail.Exception)
    with pytest.raises(outcome) as caught:
        with _guarded_config_session():
            pytest.fail("The refused engine must not yield a session")
    displayed = str(caught.value)
    for secret in ("postgresql://", "private-user", "private-password", "private-host",
                   "private-db", "private exception payload", "synthetic-private-target", str(error)):
        assert secret not in displayed


def test_connection_failure_fails_sanitized_instead_of_skipping(monkeypatch):
    engine = Mock()
    engine.begin.side_effect = ConnectionError("private connection details")
    monkeypatch.setattr(sys.modules[__name__], "_target_engine_or_skip", lambda: engine)
    with pytest.raises(pytest.fail.Exception, match=r"connection validation failed \(ConnectionError\)") as caught:
        with _guarded_config_session():
            pytest.fail("The failed connection must not yield a session")
    assert "private connection details" not in str(caught.value)
    engine.dispose.assert_called_once()


def test_cleanup_revalidates_database_and_only_drops_owned_uuid_schema():
    engine = MagicMock()
    connection = engine.begin.return_value.__enter__.return_value
    connection.dialect.name = "postgresql"
    connection.execute.return_value.scalar_one.return_value = "activity_test"
    schema = "dashboard_test_" + "a" * 32
    _drop_owned_schema(engine, schema)
    assert str(connection.execute.call_args_list[0].args[0]) == "SELECT current_database()"
    command = connection.execute.call_args_list[1].args[0]
    assert isinstance(command, DropSchema)
    assert command.element == schema
    assert command.cascade is True
    assert command.if_exists is True


def test_cleanup_refuses_external_schema_before_connection():
    engine = Mock()
    with pytest.raises(guard.DashboardPostgresSafetyError):
        _drop_owned_schema(engine, "public")
    engine.begin.assert_not_called()


def test_cleanup_refuses_changed_database_without_drop():
    engine = MagicMock()
    connection = engine.begin.return_value.__enter__.return_value
    connection.dialect.name = "postgresql"
    connection.execute.return_value.scalar_one.return_value = "synthetic_wrong_database"
    with pytest.raises(guard.DashboardPostgresSafetyError):
        _drop_owned_schema(engine, "dashboard_test_" + "a" * 32)
    assert connection.execute.call_count == 1

"""Dashboard SQL coverage with an opt-in, strictly local PostgreSQL target.

The URL is read only from DASHBOARD_TEST_PG_URL in this process. An unset
variable skips live integration tests. Guard and SQL compilation tests always
run without PostgreSQL, network requests, or an external AI provider.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import importlib.util
import os
import re
import sys
import uuid
from unittest.mock import MagicMock, Mock, patch

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import CheckConstraint, create_engine, event, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool
from sqlalchemy.schema import CreateSchema, CreateTable, DropSchema

import app.models  # noqa: F401 -- create all registered models, not a subset
from app.db.Base import Base
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.attendance.Attendance import AttendanceRecord
from app.models.people.Student import Student
from app.services.activity import AnalyticsService


_TEST_DATABASE = "activity_test"
_TEST_PORT = 55432
_SCHEMA_PATTERN = re.compile(r"dashboard_test_[0-9a-f]{32}\Z")
_DRIVERS = {
    "postgresql": "psycopg2",
}
_ROUTING_ENVIRONMENT = (
    "PGHOST", "PGHOSTADDR", "PGPORT", "PGDATABASE", "PGSERVICE",
    "PGSERVICEFILE", "PGSYSCONFDIR", "PGOPTIONS",
)
_SYNTHETIC_URL = "postgresql://x@127.0.0.1:55432/activity_test"


class DashboardPostgresSafetyError(RuntimeError):
    """A sanitized guard failure; never includes a supplied URL or credentials."""


@pytest.fixture(autouse=True)
def prohibit_external_provider_http(monkeypatch):
    def refuse_http(*args, **kwargs):
        raise AssertionError("External HTTP calls are forbidden in dashboard database tests")

    async def refuse_async_http(*args, **kwargs):
        raise AssertionError("External HTTP calls are forbidden in dashboard database tests")

    # TestClient's in-process transport remains available for authenticated
    # route tests; every real HTTP provider transport is forbidden.
    monkeypatch.setattr(httpx.HTTPTransport, "handle_request", refuse_http)
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", refuse_async_http)


def _validate_postgres_test_url(raw_url: str) -> URL:
    # Do not interpolate raw_url or a parser/driver exception into an error.
    try:
        parsed = make_url(raw_url)
        host, port, database = parsed.host, parsed.port, parsed.database
    except Exception:
        raise DashboardPostgresSafetyError("Malformed PostgreSQL test URL") from None

    driver_module = _DRIVERS.get(parsed.drivername)
    if driver_module is None:
        raise DashboardPostgresSafetyError("The PostgreSQL test driver must be exactly postgresql")
    if parsed.query:
        raise DashboardPostgresSafetyError("PostgreSQL test URL query parameters are forbidden")
    if host not in {"localhost", "127.0.0.1"}:
        raise DashboardPostgresSafetyError("PostgreSQL test host must be a literal local host")
    if port != _TEST_PORT:
        raise DashboardPostgresSafetyError("PostgreSQL test port must be 55432")
    if database != _TEST_DATABASE:
        raise DashboardPostgresSafetyError("PostgreSQL test database must be activity_test")
    try:
        installed = importlib.util.find_spec(driver_module) is not None
    except Exception:
        installed = False
    if not installed:
        raise DashboardPostgresSafetyError("The selected PostgreSQL test driver is not installed")
    return parsed


def _guarded_postgres_engine():
    """All target validation happens before an engine or connection is created."""
    parsed = _validate_postgres_test_url(os.environ["DASHBOARD_TEST_PG_URL"])
    if any(os.environ.get(name) for name in _ROUTING_ENVIRONMENT):
        raise DashboardPostgresSafetyError("libpq routing and options environment overrides are forbidden")
    try:
        return create_engine(
            parsed,
            echo=False,
            hide_parameters=True,
            pool_pre_ping=True,
            connect_args={
                "hostaddr": "127.0.0.1",
                "connect_timeout": 5,
                "options": "-c statement_timeout=5000 -c lock_timeout=5000",
            },
        )
    except Exception:
        raise DashboardPostgresSafetyError("Unable to construct the validated PostgreSQL test engine") from None


def _validate_schema_name(schema: str) -> None:
    if not _SCHEMA_PATTERN.fullmatch(schema):
        raise DashboardPostgresSafetyError("Refusing an invalid dashboard test schema name")


def _validate_connected_database(connection) -> None:
    if connection.dialect.name != "postgresql":
        raise DashboardPostgresSafetyError("The connected test database is not PostgreSQL")
    if connection.execute(text("SELECT current_database()")).scalar_one() != _TEST_DATABASE:
        raise DashboardPostgresSafetyError("The connected database is not activity_test")


@contextmanager
def _postgres_model_constraints():
    """Undo conftest's SQLite LRN workaround temporarily, using the model object."""
    original = next(
        constraint for constraint in Student.__table_args__
        if isinstance(constraint, CheckConstraint) and constraint.name == "lrn_check"
    )
    removed_by_conftest = original not in Student.__table__.constraints
    if removed_by_conftest:
        Student.__table__.append_constraint(original)
    try:
        assert original in Student.__table__.constraints
        yield
    finally:
        if removed_by_conftest:
            Student.__table__.constraints.remove(original)


def _safe_failure(stage: str, error: Exception, *, list_models: bool = False) -> str:
    # Exception text, repr, connection details and query parameters are omitted.
    message = f"PostgreSQL dashboard {stage} failed ({type(error).__name__})"
    sqlstate = getattr(getattr(error, "orig", None), "pgcode", None)
    if isinstance(sqlstate, str) and re.fullmatch(r"[A-Z0-9]{5}", sqlstate):
        message += f"; SQLSTATE {sqlstate}"
    if list_models:
        message += "; model tables: " + ", ".join(sorted(Base.metadata.tables))
    return message


@pytest.fixture
def postgres_dashboard_session():
    if "DASHBOARD_TEST_PG_URL" not in os.environ:
        pytest.skip("DASHBOARD_TEST_PG_URL is unset; local PostgreSQL integration is opt-in")

    engine = None
    session = None
    schema_created = False
    schema = "dashboard_test_" + uuid.uuid4().hex
    _validate_schema_name(schema)
    failure = None
    stage = "target guard"

    with _postgres_model_constraints():
        try:
            engine = _guarded_postgres_engine()
            stage = "connection and database validation"
            with engine.begin() as connection:
                _validate_connected_database(connection)
                if any(table.schema is not None for table in Base.metadata.tables.values()):
                    raise DashboardPostgresSafetyError("Model tables must have no explicit external schema")
                stage = "schema creation"
                connection.execute(CreateSchema(schema))
                schema_created = True
                connection.exec_driver_sql(f'SET search_path TO "{schema}"')
                connection = connection.execution_options(schema_translate_map={None: schema})
                stage = "model creation"
                Base.metadata.create_all(bind=connection)

            session = Session(bind=engine.execution_options(schema_translate_map={None: schema}))
            session.execute(text(f'SET search_path TO "{schema}"'))
        except Exception as error:
            failure = _safe_failure(stage, error, list_models=stage == "model creation")

        try:
            if failure is not None:
                pytest.fail(failure, pytrace=False)
            yield session
        finally:
            if session is not None:
                session.close()
            cleanup_failure = None
            if engine is not None and schema_created:
                # Validate both the generated schema and the actual database on
                # each cleanup connection, including after a failed create_all.
                try:
                    _validate_schema_name(schema)
                    with engine.begin() as connection:
                        _validate_connected_database(connection)
                        connection.exec_driver_sql(f'SET search_path TO "{schema}"')
                        connection = connection.execution_options(schema_translate_map={None: schema})
                        Base.metadata.drop_all(bind=connection)
                except Exception as error:
                    cleanup_failure = _safe_failure("model cleanup", error, list_models=True)
                try:
                    _validate_schema_name(schema)
                    with engine.begin() as connection:
                        _validate_connected_database(connection)
                        connection.execute(DropSchema(schema, cascade=True, if_exists=True))
                except Exception as error:
                    cleanup_failure = _safe_failure("isolated schema cleanup", error)
            if engine is not None:
                engine.dispose()
            if cleanup_failure is not None:
                pytest.fail(cleanup_failure, pytrace=False)


@pytest.mark.parametrize("driver", tuple(_DRIVERS))
@pytest.mark.parametrize("host", ["localhost", "127.0.0.1"])
def test_postgres_guard_accepts_only_installed_local_test_target(monkeypatch, driver, host):
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: object())
    parsed = _validate_postgres_test_url(
        f"{driver}://x@{host}:55432/activity_test"
    )
    assert (parsed.drivername, parsed.host, parsed.port, parsed.database) == (
        driver, host, _TEST_PORT, _TEST_DATABASE,
    )


@pytest.mark.parametrize("unsafe_url", [
    "sqlite:///:memory:",
    "postgresql+psycopg2://x@localhost:55432/activity_test",
    "postgresql+psycopg://x@localhost:55432/activity_test",
    "postgresql+pg8000://x@localhost:55432/activity_test",
    "postgresql://x@external.example:55432/activity_test",
    "postgresql://x@localhost.evil.com:55432/activity_test",
    "postgresql://x@localhost:5432/activity_test",
    "postgresql://x@localhost/activity_test",
    "postgresql://x@localhost:55432/activity",
    "postgresql://x@localhost:55432/activity_db",
    "postgresql://x@localhost:55432/entervene_db",
    "postgresql://x@localhost:55432/activity_test_extra",
    "postgresql://x@/activity_test",
    "postgresql://x@localhost,external.example:55432/activity_test",
    "postgresql://x@[::1]:55432/activity_test",
    "postgresql://x@localhost:invalid/activity_test",
    "not a database URL",
] + [_SYNTHETIC_URL + suffix for suffix in [
    "?host=external.example", "?hostaddr=203.0.113.1", "?host=/tmp",
    "?host=localhost&host=external.example", "?port=5432", "?service=production",
    "?options=-csearch_path%3Dpublic", "?sslmode=disable",
]])
def test_postgres_guard_refuses_unsafe_target_before_engine_creation(monkeypatch, unsafe_url):
    monkeypatch.setenv("DASHBOARD_TEST_PG_URL", unsafe_url)
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: object())
    engine_factory = Mock()
    monkeypatch.setattr(sys.modules[__name__], "create_engine", engine_factory)
    with pytest.raises(DashboardPostgresSafetyError) as caught:
        _guarded_postgres_engine()
    assert "://" not in str(caught.value)
    assert unsafe_url not in str(caught.value)
    engine_factory.assert_not_called()


def test_postgres_guard_refuses_missing_driver_before_engine_creation(monkeypatch):
    monkeypatch.setenv("DASHBOARD_TEST_PG_URL", _SYNTHETIC_URL)
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: None)
    engine_factory = Mock()
    monkeypatch.setattr(sys.modules[__name__], "create_engine", engine_factory)
    with pytest.raises(DashboardPostgresSafetyError, match="driver is not installed"):
        _guarded_postgres_engine()
    engine_factory.assert_not_called()


@pytest.mark.parametrize("routing_variable", _ROUTING_ENVIRONMENT)
def test_postgres_guard_refuses_libpq_environment_routing(monkeypatch, routing_variable):
    monkeypatch.setenv("DASHBOARD_TEST_PG_URL", _SYNTHETIC_URL)
    monkeypatch.setenv(routing_variable, "synthetic-unsafe-override")
    monkeypatch.setattr(importlib.util, "find_spec", lambda name: object())
    engine_factory = Mock()
    monkeypatch.setattr(sys.modules[__name__], "create_engine", engine_factory)
    with pytest.raises(DashboardPostgresSafetyError, match="environment overrides"):
        _guarded_postgres_engine()
    engine_factory.assert_not_called()


@pytest.mark.parametrize("schema", ["public", "dashboard_test_", "dashboard_test_../x", 'dashboard_test_x"; DROP SCHEMA public'])
def test_postgres_cleanup_guard_refuses_nonisolated_schema_names(schema):
    with pytest.raises(DashboardPostgresSafetyError, match="schema name"):
        _validate_schema_name(schema)


def test_postgres_guard_checks_actual_database_before_schema_writes():
    connection = Mock()
    connection.dialect.name = "postgresql"
    connection.execute.return_value.scalar_one.return_value = "synthetic_wrong_database"
    with pytest.raises(DashboardPostgresSafetyError, match="connected database"):
        _validate_connected_database(connection)
    assert connection.execute.call_count == 1
    assert str(connection.execute.call_args.args[0]) == "SELECT current_database()"


def test_postgres_fixture_never_cleans_up_a_schema_it_did_not_create(monkeypatch):
    monkeypatch.setenv("DASHBOARD_TEST_PG_URL", _SYNTHETIC_URL)
    engine = MagicMock()
    connection = engine.begin.return_value.__enter__.return_value
    connection.dialect.name = "postgresql"
    query_result = Mock()
    query_result.scalar_one.return_value = _TEST_DATABASE

    def execute(statement):
        if isinstance(statement, CreateSchema):
            raise RuntimeError("Synthetic schema creation refusal")
        return query_result

    connection.execute.side_effect = execute
    monkeypatch.setattr(sys.modules[__name__], "_guarded_postgres_engine", lambda: engine)
    fixture = postgres_dashboard_session.__wrapped__()
    with pytest.raises(pytest.fail.Exception, match="schema creation failed"):
        next(fixture)
    assert engine.begin.call_count == 1
    assert not any(isinstance(call.args[0], DropSchema) for call in connection.execute.call_args_list)
    engine.dispose.assert_called_once()


def test_postgres_fixture_sanitizes_connection_errors_before_schema_writes(monkeypatch, capsys, caplog):
    monkeypatch.setenv("DASHBOARD_TEST_PG_URL", _SYNTHETIC_URL)
    user_marker = "connection-user-marker"
    password_marker = "connection-secret-marker"
    diagnostic_url = URL.create(
        "postgresql", username=user_marker, password=password_marker,
        host="127.0.0.1", port=_TEST_PORT, database=_TEST_DATABASE,
    )
    error = OperationalError(
        None, None, RuntimeError(diagnostic_url.render_as_string(hide_password=False)),
        hide_parameters=True,
    )
    engine = MagicMock()
    connection = engine.begin.return_value.__enter__.return_value
    engine.begin.return_value.__enter__.side_effect = error
    drop_all = Mock()
    monkeypatch.setattr(Base.metadata, "drop_all", drop_all)
    monkeypatch.setattr(sys.modules[__name__], "_guarded_postgres_engine", lambda: engine)
    fixture = postgres_dashboard_session.__wrapped__()
    with pytest.raises(pytest.fail.Exception) as caught:
        next(fixture)
    _expect_equal(str(caught.value), (
        "PostgreSQL dashboard connection and database validation failed (OperationalError)"
    ), "connection-error sanitation")
    captured = capsys.readouterr()
    visible = str(caught.value) + captured.out + captured.err + caplog.text
    if any(marker in visible for marker in ("://", user_marker, password_marker)):
        pytest.fail("Mocked PostgreSQL connection error leaked confidential details", pytrace=False)
    connection.execute.assert_not_called()
    drop_all.assert_not_called()
    engine.dispose.assert_called_once()


def test_postgres_model_constraints_restore_original_lrn_check():
    original = next(
        constraint for constraint in Student.__table_args__
        if isinstance(constraint, CheckConstraint) and constraint.name == "lrn_check"
    )
    before = set(Student.__table__.constraints)
    with _postgres_model_constraints():
        assert original in Student.__table__.constraints
        ddl = str(CreateTable(Student.__table__).compile(dialect=postgresql.dialect()))
        assert "CONSTRAINT lrn_check CHECK (length(student_lrn) = 12)" in ddl
    assert set(Student.__table__.constraints) == before


@pytest.fixture
def dashboard_clock(monkeypatch):
    from test_teacher_dashboard_health import NOW

    monkeypatch.setattr(AnalyticsService, "_teacher_dashboard_now", lambda: NOW)


def _seed_and_dashboard(db):
    from test_teacher_dashboard_health import seed_dashboard_data

    try:
        data = seed_dashboard_data(db)
        result = _read_only_dashboard(db, data["teacher"].staff_id, data["period"])
        return data, result
    except Exception as error:
        pytest.fail(_safe_failure("synthetic data or dashboard query", error), pytrace=False)


def _read_only_dashboard(db, identity, period):
    """Reject DML and explicit session mutations after synthetic fixture writes."""
    def reject_write(*args, **kwargs):
        raise AssertionError("Dashboard production path attempted a database write")

    def select_only(_connection, _cursor, statement, _parameters, _context, _many):
        if not statement.lstrip().upper().startswith("SELECT"):
            reject_write()

    engine = db.get_bind()
    event.listen(engine, "before_cursor_execute", select_only)
    try:
        with patch.object(db, "add", side_effect=reject_write), \
                patch.object(db, "add_all", side_effect=reject_write), \
                patch.object(db, "delete", side_effect=reject_write), \
                patch.object(db, "flush", side_effect=reject_write), \
                patch.object(db, "commit", side_effect=reject_write):
            return AnalyticsService.build_teacher_dashboard_health(db, identity, period)
    finally:
        event.remove(engine, "before_cursor_execute", select_only)


def _dashboard(db, identity, period):
    try:
        return _read_only_dashboard(db, identity, period)
    except Exception as error:
        pytest.fail(_safe_failure("dashboard query", error), pytrace=False)


def _route_dashboard(db, data, period_id=None):
    from test_teacher_dashboard_health import create_client

    try:
        with create_client(db, {"sub": str(data["teacher"].user_id), "role": "teacher"}) as client:
            return client.get("/analytics/teacher/dashboard-health", params={
                "academic_period_id": data["period"].academic_period_id if period_id is None else period_id,
                "class_id": data["class_"].class_id,
                "subject_id": data["subject"].subject_id,
            })
    except Exception as error:
        pytest.fail(_safe_failure("in-process route query", error), pytrace=False)


def _assert_unknown_identity_is_forbidden(db, data, identity):
    try:
        AnalyticsService.build_teacher_dashboard_health(db, identity, data["period"])
    except HTTPException as error:
        _expect_equal(error.status_code, 403, "unknown identity status")
    except Exception as error:
        pytest.fail(_safe_failure("unknown identity query", error), pytrace=False)
    else:
        pytest.fail("Unknown dashboard identity was accepted", pytrace=False)


def _expect_equal(actual, expected, description):
    if actual != expected:
        pytest.fail(f"Dashboard {description} mismatch", pytrace=False)


def _utc_timestamp(value):
    if value is None:
        return None
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def _numeric_snapshot(result, data):
    """Compare numeric behavior and absolute times without DB IDs or people."""
    assignment_keys = {row.classwork_id: key for key, row in data["assignments"].items()}
    submission_keys = {row.submission_id: key for key, row in data["submissions"].items()}
    class_keys = {data[key].class_id: key for key in ("class_", "other_class", "previous_class")}
    subject_keys = {data[key].subject_id: key for key in ("subject", "other_subject", "off_load_subject")}
    chart = result["trend_chart"]
    phase_two = result["phase_two"]
    grades = phase_two["grades"]
    return {
        "kpis": result["kpis"],
        "selected_combo": (
            class_keys.get(chart["selected_class_id"]), subject_keys.get(chart["selected_subject_id"]),
        ),
        "sufficient_mastery": chart["has_sufficient_data"],
        "trend": [(
            assignment_keys[row["classwork_id"]], row["avg_score_percent"],
            row["completion_rate_percent"], row["submitted_count"], row["total_enrolled"],
            _utc_timestamp(row["due_date"]),
        ) for row in chart["points"]],
        "matrix": sorted((
            class_keys[row["class_id"]], subject_keys[row["subject_id"]],
            row["student_count"], row["published_classworks"], row["avg_score_percent"],
            row["passing_rate_percent"], row["completion_rate_percent"], row["attendance_rate_percent"],
        ) for row in result["section_matrix"]),
        "section_grades": sorted((
            class_keys[row["class_id"]], subject_keys[row["subject_id"]],
            row["current_grade"], row["passing_threshold"],
            row["available_grade_count"], row["total_grade_count"],
            row["current_grade_meets_threshold"],
            tuple(warning["code"] for warning in row["warnings"]),
        ) for row in result["section_matrix"]),
        "grade_summary": {key: value for key, value in grades.items() if key != "warnings"},
        "grade_warnings": [warning["code"] for warning in grades["warnings"]],
        "month_window": phase_two["month_window"],
        "attendance_today": phase_two["attendance_today"],
        "monthly_attendance": sorted((
            class_keys[row["class_id"]], row["rate"], row["record_count"],
            row["present_count"], row["late_count"], row["excused_count"], row["absent_count"],
        ) for row in result["details"]["attendance_by_section"]),
        "late_submissions": {
            key: value for key, value in phase_two["late_submissions"].items() if key != "warnings"
        },
        "late_warnings": [warning["code"] for warning in phase_two["late_submissions"]["warnings"]],
        "weekdays": {
            key: value for key, value in phase_two["weekdays"].items() if key != "warnings"
        },
        "weekday_warnings": [warning["code"] for warning in phase_two["weekdays"]["warnings"]],
        "require_subject_match": phase_two["require_subject_match"],
        "pending": [(
            submission_keys[row["submission_id"]], _utc_timestamp(row["submitted_at"]),
        ) for row in result["action_queue"]["pending_grading"]],
        "deadlines": [(
            assignment_keys[row["classwork_id"]], _utc_timestamp(row["due_date"]),
            row["submitted_count"], row["total_students"],
        ) for row in result["action_queue"]["upcoming_deadlines"]],
    }


def _collect_numeric_scenarios(db, data, current_result):
    from test_teacher_dashboard_health import NEXT_MONDAY, NOW, add_assignment

    try:
        samples = {"current_period": _numeric_snapshot(current_result, data)}
        current = samples["current_period"]
        _expect_equal(current["kpis"], {
            "active_classes": 1, "enrolled_students": 2,
            "overall_completion_rate": 75.0, "ungraded_count": 1,
        }, "current-period KPI values")
        _expect_equal([row[:5] for row in current["trend"]], [
            ("main_graded", 71.0, 100.0, 2, 2), ("main_pending", None, 50.0, 1, 2),
        ], "current-period mastery and completion values")
        _expect_equal(current["matrix"], [
            ("class_", "subject", 2, 2, 71.0, 0.0, 75.0, 50.0),
        ], "current-period matrix values")

        previous = _dashboard(db, data["teacher"].staff_id, data["previous_period"])
        samples["previous_period"] = _numeric_snapshot(previous, data)
        _expect_equal(samples["previous_period"]["kpis"], {
            "active_classes": 2, "enrolled_students": 3,
            "overall_completion_rate": 50.0, "ungraded_count": 1,
        }, "selected previous-period KPI values")
        _expect_equal(samples["previous_period"]["matrix"], [
            ("class_", "subject", 2, 1, None, None, 50.0, 0.0),
            ("previous_class", "subject", 1, 0, None, None, 0.0, None),
        ], "selected previous-period matrix values")

        work = data["assignments"]["main_graded"].classwork
        for key, points, expected in (
            ("null_point_total", None, None),
            ("zero_point_total", Decimal("0.00"), None),
            ("genuine_zero_score", Decimal("100.00"), 0.0),
        ):
            work.total_points = points
            for submission_key in ("graded_one", "graded_two"):
                data["submissions"][submission_key].grade = Decimal("0.00")
            db.flush()
            samples[key] = _numeric_snapshot(_dashboard(db, data["teacher"].staff_id, data["period"]), data)
            _expect_equal(samples[key]["trend"][0][1], expected, f"{key} mastery")
            _expect_equal(samples[key]["matrix"][0][4:6], (expected, 0.0), f"{key} raw score and official passing")

        work.total_points = Decimal("50.00")
        data["submissions"]["graded_one"].grade = Decimal("25.50")
        data["submissions"]["graded_two"].grade = Decimal("45.50")
        for key, due in (
            ("past_week", NOW - timedelta(days=7)),
            ("earlier_today", NOW - timedelta(seconds=1)),
            ("exact_now", NOW),
            ("late_sunday", NEXT_MONDAY - timedelta(seconds=1)),
            ("monday_boundary", NEXT_MONDAY),
            ("end_next_week", NEXT_MONDAY + timedelta(days=6)),
        ):
            add_assignment(db, data, key, due_date=due)
        db.commit()
        samples["deadline_boundaries"] = _numeric_snapshot(
            _dashboard(db, data["teacher"].staff_id, data["period"]), data,
        )
        _expect_equal([row[0] for row in samples["deadline_boundaries"]["deadlines"]], [
            "exact_now", "main_graded", "main_pending", "late_sunday",
        ], "inclusive-now and exclusive-next-Monday deadline order")
        _expect_equal([row[2:] for row in samples["deadline_boundaries"]["deadlines"]], [
            (0, 2), (2, 2), (1, 2), (0, 2),
        ], "deadline submission and enrollment counts")
        _expect_equal(samples["deadline_boundaries"]["kpis"]["overall_completion_rate"], 18.8, "boundary-data completion percentage")

        for index in range(7):
            add_assignment(db, data, f"soon_{index}", due_date=NOW + timedelta(minutes=index + 1))
        db.commit()
        samples["five_earliest_deadlines"] = _numeric_snapshot(
            _dashboard(db, data["teacher"].staff_id, data["period"]), data,
        )
        _expect_equal([row[0] for row in samples["five_earliest_deadlines"]["deadlines"]], [
            "exact_now", "soon_0", "soon_1", "soon_2", "soon_3",
        ], "five earliest deadline limit and order")
        samples["previous_after_current_additions"] = _numeric_snapshot(
            _dashboard(db, data["teacher"].staff_id, data["previous_period"]), data,
        )
        _expect_equal(samples["previous_after_current_additions"], samples["previous_period"], "previous-period isolation after current-period additions")
        return samples
    except Exception as error:
        pytest.fail(_safe_failure("numeric scenario query", error), pytrace=False)


def _assert_matches_sqlite(actual, expected):
    for scenario in expected:
        for component in expected[scenario]:
            _expect_equal(actual[scenario][component], expected[scenario][component], f"{scenario} {component} PostgreSQL/SQLite parity")


def _collect_phase_two_scenarios(db, data):
    """Actual ORM queries; only synthetic fixture setup writes to either engine."""
    from test_teacher_dashboard_health import NOW, add_assignment, add_submission

    try:
        samples = {}
        group = data["subject"].subject_group_rel
        period_grades = []
        for key in ("active_one", "active_two"):
            row = StudentPeriodGrade(
                student_id=data["students"][key].student_id,
                class_id=data["class_"].class_id,
                subject_id=data["subject"].subject_id,
                academic_period_id=data["period"].academic_period_id,
                # A separate saved final grade must NOT replace the Term Grade.
                final_period_grade=Decimal("99"), is_finalized=True,
            )
            db.add(row)
            period_grades.append(row)
        for threshold in (Decimal("85"), Decimal("83"), Decimal("75"), Decimal("83.25")):
            group.passing_threshold = threshold
            period_grades[0].transmuted_grade = threshold - Decimal("0.01")
            period_grades[1].transmuted_grade = threshold
            db.commit()
            key = f"runtime_threshold_{threshold}"
            samples[key] = _numeric_snapshot(_dashboard(db, data["teacher"].staff_id, data["period"]), data)
            summary = samples[key]["grade_summary"]
            _expect_equal(summary["passing_threshold"], float(threshold), "runtime threshold")
            _expect_equal(summary["passing_count"], 1, "precise threshold equality passing count")
            _expect_equal(summary["passing_rate_percent"], 50.0, "precise threshold passing rate")
            _expect_equal(summary["available_grade_count"], 2, "official grade coverage")
            _expect_equal(summary["current_grade"], round(float(threshold - Decimal("0.005")), 1), "Term Grade not separate saved final")
            _expect_equal(summary["current_grade_meets_threshold"], False, "threshold comparison before rounding")

        data["subject"].subject_group_rel = None
        db.commit()
        samples["missing_group"] = _numeric_snapshot(_dashboard(db, data["teacher"].staff_id, data["period"]), data)
        _expect_equal(samples["missing_group"]["grade_summary"]["passing_rate_percent"], None, "missing-group passing availability")
        _expect_equal(samples["missing_group"]["grade_summary"]["available_grade_count"], 2, "missing-group current-grade coverage")
        _expect_equal(samples["missing_group"]["grade_warnings"], ["invalid_passing_threshold"], "missing-group configuration warning")
        data["subject"].subject_group_rel = group

        # Every recorded row counts, including another subject in the same class.
        rows = [
            ("active_one", "subject", date(2026, 10, 1), "present"),
            ("active_two", "subject", date(2026, 10, 1), "late"),
            ("active_one", "other_subject", date(2026, 10, 1), "excused"),
            ("active_two", "other_subject", date(2026, 10, 1), "absent"),
            ("active_one", "subject", date(2026, 10, 9), "present"),
            ("active_two", "subject", date(2026, 9, 30), "late"),
            ("active_one", "other_subject", date(2026, 9, 30), "excused"),
        ]
        db.add_all([
            AttendanceRecord(
                student_id=data["students"][student].student_id,
                class_id=data["class_"].class_id, subject_id=data[subject].subject_id,
                date=record_date, status=status,
            ) for student, subject, record_date, status in rows
        ])
        db.commit()
        samples["four_status_month"] = _numeric_snapshot(_dashboard(db, data["teacher"].staff_id, data["period"]), data)
        _expect_equal(samples["four_status_month"]["monthly_attendance"], [
            ("class_", 50.0, 6, 2, 1, 1, 2),
        ], "inclusive month/current-day record denominator")
        _expect_equal(samples["four_status_month"]["attendance_today"]["record_count"], 0, "missing-today records are not inferred")

        with patch.object(AnalyticsService, "_teacher_dashboard_now", return_value=datetime(2026, 9, 30, 16, 0, tzinfo=timezone.utc)):
            samples["manila_midnight"] = _numeric_snapshot(_dashboard(db, data["teacher"].staff_id, data["period"]), data)
        _expect_equal(samples["manila_midnight"]["month_window"], {
            "start_date": "2026-10-01", "end_date": "2026-10-01", "today": "2026-10-01", "label": "This month",
        }, "UTC previous-day Manila month boundary")
        _expect_equal(samples["manila_midnight"]["monthly_attendance"], [
            ("class_", 50.0, 4, 1, 1, 1, 1),
        ], "first-day four status records")

        # UTC Sept 30 16:00 is Oct 1 in Manila. Its excuse is deliberately for a
        # different subject: the approved three-field policy must still match.
        midnight_due = datetime(2026, 9, 30, 16, 0, tzinfo=timezone.utc)
        for key, student, due, submitted in (
            ("excused_midnight", "active_one", midnight_due, midnight_due + timedelta(hours=1)),
            ("equal_midnight", "active_two", midnight_due, midnight_due),
            ("unexcused_late", "active_two", midnight_due, midnight_due + timedelta(hours=1)),
            ("sunday_late", "active_two", datetime(2026, 10, 3, 16, 0, tzinfo=timezone.utc), datetime(2026, 10, 4, 1, 0, tzinfo=timezone.utc)),
            ("prior_month_excuse", "active_one", datetime(2026, 9, 30, 8, 0, tzinfo=timezone.utc), datetime(2026, 10, 1, 1, 0, tzinfo=timezone.utc)),
        ):
            assignment = add_assignment(db, data, key, due_date=due)
            submission = add_submission(db, data, key, assignment, data["students"][student], status="graded", grade=Decimal("25"))
            submission.submitted_at = submitted
        db.commit()
        with patch.object(AnalyticsService, "_teacher_dashboard_now", return_value=NOW):
            samples["three_field_excuses_and_weekdays"] = _numeric_snapshot(_dashboard(db, data["teacher"].staff_id, data["period"]), data)
        submitted = samples["three_field_excuses_and_weekdays"]
        _expect_equal(submitted["require_subject_match"], False, "subject matching stays disabled")
        _expect_equal(submitted["late_submissions"], {
            "late_rate_percent": 33.3, "late_count": 2, "eligible_count": 6,
            "excused_excluded_count": 2, "completed_count": 8,
        }, "excuse exclusion from numerator and denominator")
        _expect_equal(submitted["late_warnings"], [], "complete timestamp availability")
        _expect_equal(submitted["weekdays"]["sunday_count"], 1, "Sunday disclosed separately")
        _expect_equal(submitted["weekdays"]["total_count"], 8, "excused completion still counted")
        _expect_equal([row["count"] for row in submitted["weekdays"]["days"]], [0, 0, 0, 7, 0, 0], "six Monday-Saturday Manila buckets")

        previous = _dashboard(db, data["teacher"].staff_id, data["previous_period"])
        samples["historical_period_phase_two"] = _numeric_snapshot(previous, data)
        _expect_equal([row[2] for row in samples["historical_period_phase_two"]["monthly_attendance"]], [0, 0], "historical selected-period empty month")
        _expect_equal(samples["historical_period_phase_two"]["weekdays"]["total_count"], 0, "historical selected-period submission dates")
        return samples
    except Exception as error:
        pytest.fail(_safe_failure("Phase 2 numeric scenario query", error), pytrace=False)


def test_teacher_dashboard_queries_compile_for_postgres_without_connecting(dashboard_clock):
    """Compilation checks cover actual service SELECTs, not hand-written SQL."""
    statements = []
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    with Session(bind=engine) as db:
        def capture_select(state):
            if state.is_select:
                statements.append(state.statement)

        event.listen(db, "do_orm_execute", capture_select)
        data, result = _seed_and_dashboard(db)
        _dashboard(db, data["teacher"].user_id, data["period"])
        _assert_unknown_identity_is_forbidden(db, data, "unknown-synthetic-teacher")
        assert _route_dashboard(db, data).status_code == 200
        assert _route_dashboard(db, data, period_id=999999).status_code == 404
        _collect_numeric_scenarios(db, data, result)
        _collect_phase_two_scenarios(db, data)
        event.remove(db, "do_orm_execute", capture_select)

    engine.dispose()
    assert result["kpis"]["active_classes"] > 0
    assert statements
    compiled = [str(statement.compile(dialect=postgresql.dialect())) for statement in statements]
    for table in (
        "academic_period", "academic_staff", "subject_load", "student_class", "classwork_assignment",
        "student_submission", "attendance_record", "subject_groups", "student_period_grade",
        "grading_template",
    ):
        assert any(table in sql for sql in compiled), f"Missing actual dashboard SELECT for {table}"
    assert all("strftime" not in sql.lower() and "julianday" not in sql.lower() for sql in compiled)


def test_teacher_dashboard_populated_queries_execute_on_guarded_postgres(postgres_dashboard_session, dashboard_clock):
    data, result = _seed_and_dashboard(postgres_dashboard_session)
    _expect_equal(result["kpis"], {
        "active_classes": 1, "enrolled_students": 2,
        "overall_completion_rate": 75.0, "ungraded_count": 1,
    }, "populated-scope KPI values")
    _expect_equal(_dashboard(
        postgres_dashboard_session, data["teacher"].user_id, data["period"],
    )["kpis"], result["kpis"], "UUID identity KPI values")
    route_response = _route_dashboard(postgres_dashboard_session, data)
    _expect_equal(route_response.status_code, 200, "explicit-period route status")
    _expect_equal(route_response.json()["kpis"], result["kpis"], "explicit-period route KPI values")
    _expect_equal(_route_dashboard(postgres_dashboard_session, data, period_id=999999).status_code, 404, "invalid-period route status")
    _expect_equal([item["submission_id"] for item in result["action_queue"]["pending_grading"]], [
        data["submissions"]["pending_active"].submission_id,
    ], "pending submission identifiers")
    deadlines = result["action_queue"]["upcoming_deadlines"]
    _expect_equal([_utc_timestamp(item["due_date"]) for item in deadlines], sorted(_utc_timestamp(item["due_date"]) for item in deadlines), "base deadline timestamp order")
    _expect_equal([item["classwork_id"] for item in deadlines], [
        data["assignments"]["main_graded"].classwork_id,
        data["assignments"]["main_pending"].classwork_id,
    ], "base deadline identifiers")
    postgres_samples = _collect_numeric_scenarios(postgres_dashboard_session, data, result)
    sqlite_engine = create_engine("sqlite:///:memory:")
    try:
        Base.metadata.create_all(bind=sqlite_engine)
        with Session(bind=sqlite_engine) as sqlite_db:
            sqlite_data, sqlite_result = _seed_and_dashboard(sqlite_db)
            sqlite_samples = _collect_numeric_scenarios(sqlite_db, sqlite_data, sqlite_result)
    except Exception as error:
        pytest.fail(_safe_failure("isolated SQLite comparison", error), pytrace=False)
    finally:
        sqlite_engine.dispose()
    _assert_matches_sqlite(postgres_samples, sqlite_samples)


def test_teacher_dashboard_phase_two_scenarios_execute_on_isolated_sqlite(dashboard_clock):
    """Mocked-behavior: run parity expectations even when PG is not configured."""
    engine = create_engine("sqlite:///:memory:")
    try:
        Base.metadata.create_all(bind=engine)
        with Session(bind=engine) as db:
            data, _ = _seed_and_dashboard(db)
            samples = _collect_phase_two_scenarios(db, data)
    finally:
        engine.dispose()
    assert len(samples) == 9


def test_teacher_dashboard_phase_two_queries_execute_on_guarded_postgres(postgres_dashboard_session, dashboard_clock):
    """Opt-in: actual queries/Decimal/timestamps/read-only parity, no providers."""
    data, _ = _seed_and_dashboard(postgres_dashboard_session)
    postgres_samples = _collect_phase_two_scenarios(postgres_dashboard_session, data)
    engine = create_engine("sqlite:///:memory:")
    try:
        Base.metadata.create_all(bind=engine)
        with Session(bind=engine) as db:
            sqlite_data, _ = _seed_and_dashboard(db)
            sqlite_samples = _collect_phase_two_scenarios(db, sqlite_data)
    except Exception as error:
        pytest.fail(_safe_failure("Phase 2 isolated SQLite comparison", error), pytrace=False)
    finally:
        engine.dispose()
    _assert_matches_sqlite(postgres_samples, sqlite_samples)


def test_teacher_dashboard_empty_queries_execute_on_guarded_postgres(postgres_dashboard_session, dashboard_clock):
    data, _ = _seed_and_dashboard(postgres_dashboard_session)
    for identity in (
        "unknown-synthetic-teacher", uuid.UUID("00000000-0000-4000-8000-000000000099"),
    ):
        _assert_unknown_identity_is_forbidden(postgres_dashboard_session, data, identity)
    for identity, period in (
        (data["empty_teacher"].staff_id, data["period"]),
        (data["teacher"].staff_id, data["empty_period"]),
        (data["teacher"].staff_id, None),
    ):
        result = _dashboard(postgres_dashboard_session, identity, period)
        _expect_equal(result["kpis"], {
            "active_classes": 0, "enrolled_students": 0,
            "overall_completion_rate": 0.0, "ungraded_count": 0,
        }, "empty-scope KPI zeros")
        _expect_equal(result["trend_chart"]["available_filters"], [], "empty-scope filters")
        _expect_equal(result["trend_chart"]["points"], [], "empty-scope trend points")
        _expect_equal(result["section_matrix"], [], "empty-scope matrix")
        _expect_equal(result["action_queue"], {"pending_grading": [], "upcoming_deadlines": []}, "empty-scope queues")

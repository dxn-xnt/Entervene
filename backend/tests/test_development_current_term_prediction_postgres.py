"""PostgreSQL transaction verification for current-term prediction generation.

Live tests are opt-in and accept only a local PostgreSQL administrator URL on
port 55432.  They create a randomly named disposable database, migrate it to
the current Alembic head, verify the connected identity before seeding data,
and drop it after the module finishes.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from hashlib import sha256
import json
import os
from pathlib import Path
import re
import threading
import time
from uuid import uuid4

from alembic import command
from alembic.config import Config
import pytest
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.engine import URL, make_url
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.main import app
from app.schemas.Submission import GradeRequest
from app.services.prediction import DevelopmentCurrentTermPredictionPersistenceService as persistence
from app.services.prediction import DevelopmentGradeRefreshService as grade_refresh
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from app.services.submission import SubmissionService as submission_service
from app.services.prediction.DevelopmentCurrentTermModelSelection import (
    CORRECTED_MODEL_NAME,
    LEGACY_MODEL_NAME,
    artifact_path,
)
from app.services.prediction.DevelopmentCurrentTermPredictionReadService import (
    list_latest_development_current_term_predictions,
)
from tests.test_current_period_live_feature_builder import add_activity
from tests.test_development_current_term_api import _client, _read_params
from tests.test_development_current_term_prediction_service import _make_ready, _set_weights


_ADMIN_URL_ENV = "PREDICTION_TEST_PG_ADMIN_URL"
_TEST_PORT = 55432
_DATABASE_PREFIX = "entervene_prediction_test_"
_DATABASE_NAME = re.compile(r"^entervene_prediction_test_[0-9a-f]{32}$")
_APPLICATION_NAME = "entervene_prediction_pr2"
_ROUTING_ENVIRONMENT = (
    "PGHOST",
    "PGHOSTADDR",
    "PGPORT",
    "PGDATABASE",
    "PGSERVICE",
    "PGSERVICEFILE",
    "PGOPTIONS",
)


class PredictionPostgresSafetyError(RuntimeError):
    pass


def _validate_admin_url(raw_url: str) -> URL:
    try:
        parsed = make_url(raw_url)
    except Exception:
        raise PredictionPostgresSafetyError("Invalid PostgreSQL test URL") from None
    if parsed.drivername != "postgresql+psycopg2":
        raise PredictionPostgresSafetyError("PostgreSQL test driver must be postgresql+psycopg2")
    if parsed.host not in {"localhost", "127.0.0.1"}:
        raise PredictionPostgresSafetyError("PostgreSQL test host must be a literal local host")
    if parsed.port != _TEST_PORT:
        raise PredictionPostgresSafetyError("PostgreSQL test port must be 55432")
    if parsed.database != "postgres":
        raise PredictionPostgresSafetyError("PostgreSQL administrator URL must target postgres")
    if parsed.query:
        raise PredictionPostgresSafetyError("PostgreSQL test URL query options are forbidden")
    if any(os.environ.get(name) for name in _ROUTING_ENVIRONMENT):
        raise PredictionPostgresSafetyError("libpq routing environment overrides are forbidden")
    return parsed


def _connect_args(application_name: str) -> dict[str, object]:
    return {
        "hostaddr": "127.0.0.1",
        "connect_timeout": 5,
        "application_name": application_name,
        "options": "-c statement_timeout=10000 -c lock_timeout=10000",
    }


def _assert_admin_identity(connection) -> None:
    identity = connection.execute(text(
        "SELECT current_database(), inet_server_addr()::text, inet_server_port(), version()"
    )).one()
    # The guarded URL and hostaddr establish the host-side 127.0.0.1:55432
    # connection. A Dockerized server correctly reports its container-side
    # address and PostgreSQL port here.
    if identity[0] != "postgres" or identity[1] is None or identity[2] != 5432 or not identity[3].startswith("PostgreSQL "):
        raise PredictionPostgresSafetyError("Connected PostgreSQL server is not the dedicated local test server")


def _assert_disposable_identity(connection, database_name: str) -> None:
    if not _DATABASE_NAME.fullmatch(database_name):
        raise PredictionPostgresSafetyError("Refusing an invalid disposable database name")
    identity = connection.execute(text(
        "SELECT current_database(), inet_server_addr()::text, inet_server_port(), version()"
    )).one()
    if identity[0] != database_name or identity[1] is None or identity[2] != 5432 or not identity[3].startswith("PostgreSQL "):
        raise PredictionPostgresSafetyError("Connected database is not the disposable prediction test database")


def _migration_config(database_url: URL) -> Config:
    config = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", database_url.render_as_string(hide_password=False).replace("%", "%%"))
    return config


@pytest.fixture(scope="module")
def prediction_postgres_engine():
    raw_url = os.getenv(_ADMIN_URL_ENV)
    if not raw_url:
        pytest.skip(f"{_ADMIN_URL_ENV} is unset; live PostgreSQL prediction verification is opt-in")

    admin_url = _validate_admin_url(raw_url)
    database_name = _DATABASE_PREFIX + uuid4().hex
    assert _DATABASE_NAME.fullmatch(database_name)
    admin_engine = create_engine(
        admin_url,
        isolation_level="AUTOCOMMIT",
        hide_parameters=True,
        connect_args=_connect_args(_APPLICATION_NAME + "_admin"),
    )
    test_engine = None
    created = False
    try:
        with admin_engine.connect() as connection:
            _assert_admin_identity(connection)
            connection.exec_driver_sql(f'CREATE DATABASE "{database_name}"')
            created = True

        test_url = admin_url.set(database=database_name)
        command.upgrade(_migration_config(test_url), "head")
        test_engine = create_engine(
            test_url,
            hide_parameters=True,
            pool_pre_ping=True,
            connect_args=_connect_args(_APPLICATION_NAME),
        )
        with test_engine.connect() as connection:
            _assert_disposable_identity(connection, database_name)
            migration_heads = connection.execute(text("SELECT version_num FROM alembic_version")).scalars().all()
            assert migration_heads
        yield test_engine
    finally:
        if test_engine is not None:
            test_engine.dispose()
        if created:
            with admin_engine.connect() as connection:
                _assert_admin_identity(connection)
                if not _DATABASE_NAME.fullmatch(database_name):
                    raise PredictionPostgresSafetyError("Refusing to drop an invalid database name")
                connection.exec_driver_sql(f'DROP DATABASE IF EXISTS "{database_name}" WITH (FORCE)')
        admin_engine.dispose()


@pytest.fixture
def postgres_prediction_context(prediction_postgres_engine, monkeypatch):
    engine = prediction_postgres_engine
    table_names = inspect(engine).get_table_names(schema="public")
    quoted = ", ".join(f'"{name}"' for name in table_names if name != "alembic_version")
    if quoted:
        with engine.begin() as connection:
            _assert_disposable_identity(connection, engine.url.database)
            connection.exec_driver_sql(f"TRUNCATE TABLE {quoted} RESTART IDENTITY CASCADE")

    monkeypatch.setattr(persistence.settings, "app_environment", "test")
    monkeypatch.setattr(persistence.settings, "development_prediction_api_enabled", True)
    monkeypatch.setattr(persistence.settings, "development_current_term_model_name", CORRECTED_MODEL_NAME)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features, **_kwargs: 74.25)

    with Session(engine) as db:
        year = AcademicYear(
            year_label="2026-2027",
            start_date=date(2026, 6, 1),
            end_date=date(2027, 3, 31),
            is_active=True,
        )
        level = AcademicLevel(level_name="Grade 9", grade_level=9)
        db.add_all([year, level])
        db.flush()
        account = UserAccount(user_id=uuid4(), email="prediction-pg@example.test")
        staff = AcademicStaff(
            staff_id="T-PRED-PG",
            first_name="Prediction",
            last_name="Tester",
            user_id=account.user_id,
        )
        student = Student(
            student_id=uuid4(),
            student_lrn="300000009901",
            first_name="Postgres",
            last_name="Learner",
            academic_level_id=level.academic_level_id,
        )
        period = AcademicPeriod(
            period_name="Term 1",
            period_type="TERM",
            period_sequence=1,
            total_periods_in_year=3,
            period_progress_ratio=Decimal("0.3333"),
            start_date=date(2026, 6, 1),
            end_date=date(2026, 8, 31),
            academic_year_id=year.academic_year_id,
            is_active=True,
        )
        class_ = Class(
            section_name="PostgreSQL Integrity",
            academic_year_id=year.academic_year_id,
            academic_level_id=level.academic_level_id,
            period_template_group="JHS_45MIN",
        )
        template = GradingTemplate(template_name="Prediction PG", passing_threshold=87, status="active")
        db.add(template)
        db.flush()
        db.add_all([
            GradingTemplateComponent(
                grading_template_id=template.grading_template_id,
                component_name="Written Work",
                weight=Decimal("20"),
                display_order=1,
            ),
            GradingTemplateComponent(
                grading_template_id=template.grading_template_id,
                component_name="Performance Tasks",
                weight=Decimal("50"),
                display_order=2,
            ),
            GradingTemplateComponent(
                grading_template_id=template.grading_template_id,
                component_name="Exams",
                weight=Decimal("30"),
                display_order=3,
            ),
        ])
        subject = Subject(
            subject_name="Science",
            subject_codename="SCIENCE",
            academic_level_id=level.academic_level_id,
            grading_template_id=template.grading_template_id,
        )
        db.add_all([account, staff, student, period, class_, subject])
        db.flush()
        db.add_all([
            StudentClass(
                student_id=student.student_id,
                class_id=class_.class_id,
                academic_year_id=year.academic_year_id,
                enrollment_status="enrolled",
            ),
            SubjectLoad(
                staff_id=staff.staff_id,
                subject_id=subject.subject_id,
                class_id=class_.class_id,
                academic_period_id=period.academic_period_id,
                status="published",
                is_active_version=True,
            ),
        ])
        db.commit()
        ctx = {
            "db": db,
            "engine": engine,
            "student": student,
            "class": class_,
            "subject": subject,
            "staff": staff,
            "period": period,
            "template": template,
            "level": level,
            "year": year,
        }
        _set_weights(ctx)
        _make_ready(ctx)
        model_version_id = _register_model(db, CORRECTED_MODEL_NAME)
        ctx["model_version_id"] = model_version_id
        db.expire_all()
        yield ctx


def _register_model(db: Session, model_name: str) -> int:
    schema = scorer.load_development_current_term_schema(model_name)
    schema_digest = sha256(json.dumps(schema, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    artifact = artifact_path(model_name)
    row = AIModelVersion(
        model_name=model_name,
        model_type="REGRESSOR",
        model_purpose="CURRENT_TERM_FINAL_GRADE_PROJECTION",
        algorithm="RandomForestRegressor",
        target_column="target_final_period_grade",
        lifecycle_status="DEVELOPMENT",
        production_validated=False,
        independent_three_term_validation=False,
        is_active=False,
        artifact_path=str(artifact.relative_to(artifact.parents[2])).replace("\\", "/"),
        feature_schema_json=schema,
        registry_metadata_json={
            "supported_subjects": ["CREATIVE_TECHNOLOGY", "ENGLISH", "ICT", "MATHEMATICS", "SCIENCE"],
            "supported_weight_patterns": ["20/50/30", "20/60/20"],
            "period_semantics": "SOURCE_EQUALS_TARGET_SAME_TERM",
            "feature_schema_sha256": schema_digest,
            "feature_schema_version": f"sha256:{schema_digest}",
            "artifact_sha256": sha256(artifact.read_bytes()).hexdigest(),
            "training_dataset_version": "postgres-transaction-test-v1",
        },
    )
    db.add(row)
    db.commit()
    return row.model_version_id


def _scope(ctx, *, student_id=None, model_version_id=None) -> dict[str, object]:
    return {
        "student_id": student_id or ctx["student"].student_id,
        "class_id": ctx["class"].class_id,
        "subject_id": ctx["subject"].subject_id,
        "period_id": ctx["period"].academic_period_id,
        "model_version_id": model_version_id or ctx["model_version_id"],
        "bind": ctx["engine"],
    }


def _generate(ctx, **kwargs):
    values = _scope(ctx)
    values.update(kwargs)
    return persistence.generate_and_persist_development_current_term(**values)


def _prediction_rows(ctx):
    with Session(ctx["engine"]) as db:
        return db.query(DevelopmentCurrentTermPrediction).order_by(
            DevelopmentCurrentTermPrediction.revision
        ).all()


def _wait_for_advisory_contention(engine, timeout: float = 5.0) -> tuple[int, int]:
    deadline = time.monotonic() + timeout
    last = (0, 0)
    sql = text("""
        SELECT
            count(*) FILTER (WHERE lock.granted),
            count(*) FILTER (WHERE NOT lock.granted)
        FROM pg_locks AS lock
        JOIN pg_stat_activity AS activity ON activity.pid = lock.pid
        WHERE lock.locktype = 'advisory'
          AND activity.application_name = :application_name
          AND lock.database = (SELECT oid FROM pg_database WHERE datname = current_database())
    """)
    while time.monotonic() < deadline:
        with engine.connect() as connection:
            last = tuple(connection.execute(sql, {"application_name": _APPLICATION_NAME}).one())
        if last[0] >= 1 and last[1] >= 1:
            return last
        time.sleep(0.05)
    return last


def _run_contended_pair(ctx) -> tuple[list[dict], list[Exception], list[str]]:
    first_flushed = threading.Event()
    release_first = threading.Event()
    second_finished_operation = threading.Event()
    results: list[dict] = []
    errors: list[Exception] = []
    sqlstates: list[str] = []

    def capture_error(exception_context):
        code = getattr(exception_context.original_exception, "pgcode", None)
        if isinstance(code, str):
            sqlstates.append(code)

    event.listen(ctx["engine"], "handle_error", capture_error)

    def first_followup(_db, _result):
        first_flushed.set()
        if not release_first.wait(timeout=10):
            raise TimeoutError("Timed out holding the first prediction transaction")

    def second_followup(_db, _result):
        second_finished_operation.set()

    def run(followup):
        try:
            results.append(_generate(ctx, after_result=followup))
        except Exception as exc:  # asserted by caller
            errors.append(exc)

    first = threading.Thread(target=run, args=(first_followup,), name="prediction-first")
    second = threading.Thread(target=run, args=(second_followup,), name="prediction-second")
    try:
        first.start()
        assert first_flushed.wait(timeout=10), errors
        second.start()
        granted, waiting = _wait_for_advisory_contention(ctx["engine"])
        assert granted >= 1 and waiting >= 1
        assert not second_finished_operation.is_set()
    finally:
        release_first.set()
        first.join(timeout=15)
        second.join(timeout=15)
        event.remove(ctx["engine"], "handle_error", capture_error)
    assert not first.is_alive() and not second.is_alive()
    return results, errors, sqlstates


@pytest.mark.parametrize(
    "unsafe_url",
    [
        "postgresql+psycopg2://x@external.example:55432/postgres",
        "postgresql+psycopg2://x@localhost:5432/postgres",
        "postgresql+psycopg2://x@localhost:55432/entervene",
        "postgresql://x@localhost:55432/postgres",
    ],
)
def test_prediction_postgres_guard_rejects_unsafe_targets(monkeypatch, unsafe_url):
    for name in _ROUTING_ENVIRONMENT:
        monkeypatch.delenv(name, raising=False)
    with pytest.raises(PredictionPostgresSafetyError):
        _validate_admin_url(unsafe_url)


def test_first_generation_and_sequential_idempotency(postgres_prediction_context, monkeypatch):
    ctx = postgres_prediction_context
    score_calls = []
    monkeypatch.setattr(
        scorer,
        "score_development_current_term",
        lambda features, **_kwargs: score_calls.append(dict(features)) or 74.25,
    )

    def assert_transaction_contract(db, _result):
        assert db.execute(text("SHOW transaction_isolation")).scalar_one() == "repeatable read"
        held_locks = db.execute(text(
            "SELECT count(*) FROM pg_locks "
            "WHERE pid = pg_backend_pid() AND locktype = 'advisory' AND granted"
        )).scalar_one()
        assert held_locks == 1

    first = _generate(ctx, after_result=assert_transaction_contract)
    second = _generate(ctx)
    third = _generate(ctx)

    assert first["persisted"] is True
    assert first["revision"] == 1
    assert first["projected_final_term_grade"] == pytest.approx(74.25)
    assert second["unchanged"] is True and third["unchanged"] is True
    assert {first["prediction_id"], second["prediction_id"], third["prediction_id"]} == {first["prediction_id"]}
    assert len(score_calls) == 1
    rows = _prediction_rows(ctx)
    assert len(rows) == 1
    assert rows[0].revision == 1
    assert len(rows[0].evidence_snapshot["model_features"]) == 31
    with Session(ctx["engine"]) as db:
        assert db.query(Intervention).count() == 1
        assert db.query(Intervention).one().source_prediction_id == first["prediction_id"]
        latest = list_latest_development_current_term_predictions(
            db,
            class_id=ctx["class"].class_id,
            subject_id=ctx["subject"].subject_id,
            academic_period_id=ctx["period"].academic_period_id,
            model_version_id=ctx["model_version_id"],
            require_active_enrollment=True,
        )
        assert latest["total"] == 1
        assert latest["items"][0]["prediction_id"] == first["prediction_id"]


def test_concurrent_initial_generation_uses_advisory_lock_and_retry(postgres_prediction_context):
    ctx = postgres_prediction_context
    results, errors, sqlstates = _run_contended_pair(ctx)

    assert not errors
    assert len(results) == 2
    assert len({item["prediction_id"] for item in results}) == 1
    assert {item["revision"] for item in results} == {1}
    assert len(_prediction_rows(ctx)) == 1
    with Session(ctx["engine"]) as db:
        assert db.query(Intervention).count() == 1
    assert set(sqlstates) & {"23505", "40001"}


def test_different_student_scopes_do_not_share_the_generation_lock(postgres_prediction_context):
    ctx = postgres_prediction_context
    with Session(ctx["engine"]) as db:
        second_student = Student(
            student_id=uuid4(),
            student_lrn="300000009902",
            first_name="Independent",
            last_name="Scope",
            academic_level_id=ctx["level"].academic_level_id,
        )
        db.add(second_student)
        db.flush()
        db.add(StudentClass(
            student_id=second_student.student_id,
            class_id=ctx["class"].class_id,
            academic_year_id=ctx["year"].academic_year_id,
            enrollment_status="enrolled",
        ))
        for assignment, original in db.query(ClassworkAssignment, StudentSubmission).join(
            StudentSubmission,
            StudentSubmission.classwork_assignment_id == ClassworkAssignment.classwork_assignment_id,
        ).filter(StudentSubmission.student_id == ctx["student"].student_id).all():
            db.add(StudentSubmission(
                student_id=second_student.student_id,
                classwork_assignment_id=assignment.classwork_assignment_id,
                status=original.status,
                grade=original.grade,
                submitted_at=original.submitted_at,
                graded_at=original.graded_at,
                graded_by_staff_id=original.graded_by_staff_id,
            ))
        db.commit()
        second_student_id = second_student.student_id

    rendezvous = threading.Barrier(2, timeout=10)
    results: list[dict] = []
    errors: list[Exception] = []

    def run(student_id):
        try:
            results.append(_generate(ctx, student_id=student_id, after_result=lambda _db, _result: rendezvous.wait()))
        except Exception as exc:
            errors.append(exc)

    threads = [
        threading.Thread(target=run, args=(ctx["student"].student_id,)),
        threading.Thread(target=run, args=(second_student_id,)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=15)

    assert not errors
    assert all(not thread.is_alive() for thread in threads)
    assert len(results) == 2
    assert len({item["prediction_id"] for item in results}) == 2
    assert len(_prediction_rows(ctx)) == 2


def test_changed_evidence_creates_and_then_reuses_revision(postgres_prediction_context):
    ctx = postgres_prediction_context
    first = _generate(ctx)
    first_snapshot = json.loads(json.dumps(_prediction_rows(ctx)[0].evidence_snapshot))
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)

    second = _generate(ctx)
    third = _generate(ctx)
    rows = _prediction_rows(ctx)

    assert [row.revision for row in rows] == [1, 2]
    assert first["prediction_id"] != second["prediction_id"]
    assert third["prediction_id"] == second["prediction_id"]
    assert third["unchanged"] is True
    assert rows[0].evidence_snapshot == first_snapshot
    assert rows[1].evidence_snapshot["model_features"] != first_snapshot["model_features"]


def test_concurrent_changed_evidence_creates_one_revision_two(postgres_prediction_context):
    ctx = postgres_prediction_context
    initial = _generate(ctx)
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)

    results, errors, sqlstates = _run_contended_pair(ctx)
    rows = _prediction_rows(ctx)

    assert not errors
    assert len(results) == 2
    assert [row.revision for row in rows] == [1, 2]
    assert len({item["prediction_id"] for item in results}) == 1
    assert {item["revision"] for item in results} == {2}
    assert rows[0].prediction_id == initial["prediction_id"]
    with Session(ctx["engine"]) as db:
        assert db.query(Intervention).filter(Intervention.status.in_(("CANDIDATE", "ACTIVE"))).count() == 1
    assert set(sqlstates) & {"23505", "40001"}


def test_failure_after_flush_rolls_back_prediction_and_intervention(postgres_prediction_context):
    ctx = postgres_prediction_context

    def fail_after_result(_db, result):
        assert result["prediction_id"] is not None
        raise RuntimeError("controlled failure after prediction and intervention flush")

    with pytest.raises(RuntimeError, match="controlled failure"):
        _generate(ctx, after_result=fail_after_result)

    with Session(ctx["engine"]) as db:
        assert db.query(DevelopmentCurrentTermPrediction).count() == 0
        assert db.query(Intervention).count() == 0
        latest = list_latest_development_current_term_predictions(
            db,
            class_id=ctx["class"].class_id,
            subject_id=ctx["subject"].subject_id,
            academic_period_id=ctx["period"].academic_period_id,
            model_version_id=ctx["model_version_id"],
            require_active_enrollment=True,
        )
        assert latest["total"] == 0

    successful = _generate(ctx)
    assert successful["revision"] == 1
    with Session(ctx["engine"]) as db:
        assert db.query(DevelopmentCurrentTermPrediction).count() == 1
        assert db.query(Intervention).count() == 1


def test_migrated_constraints_enforce_revision_identity_and_immutability(postgres_prediction_context):
    ctx = postgres_prediction_context
    result = _generate(ctx)
    expected_columns = [
        "student_id", "class_id", "subject_id", "source_period_id", "target_period_id",
        "model_version_id", "revision",
    ]
    unique_constraints = {
        item["name"]: item["column_names"]
        for item in inspect(ctx["engine"]).get_unique_constraints("development_current_term_prediction")
    }
    check_names = {
        item["name"]
        for item in inspect(ctx["engine"]).get_check_constraints("development_current_term_prediction")
    }
    assert unique_constraints["uq_development_current_term_scope_revision"] == expected_columns
    assert {
        "ck_development_current_term_same_period",
        "ck_development_current_term_revision_positive",
        "ck_development_current_term_no_risk_score",
        "ck_development_current_term_intervention_level",
    } <= check_names
    with ctx["engine"].connect() as connection:
        trigger_names = set(connection.execute(text(
            "SELECT tgname FROM pg_trigger "
            "WHERE tgrelid = 'development_current_term_prediction'::regclass "
            "AND NOT tgisinternal"
        )).scalars())
    assert "immutable_development_current_term_prediction" in trigger_names

    with Session(ctx["engine"]) as db:
        original = db.get(DevelopmentCurrentTermPrediction, result["prediction_id"])
        duplicate = DevelopmentCurrentTermPrediction(
            student_id=original.student_id,
            class_id=original.class_id,
            subject_id=original.subject_id,
            source_period_id=original.source_period_id,
            target_period_id=original.target_period_id,
            model_version_id=original.model_version_id,
            revision=original.revision,
            predicted_period_grade=original.predicted_period_grade,
            intervention_level=original.intervention_level,
            intervention_basis=original.intervention_basis,
            risk_score=None,
            evidence_snapshot=original.evidence_snapshot,
        )
        db.add(duplicate)
        with pytest.raises(IntegrityError) as duplicate_error:
            db.commit()
        assert getattr(duplicate_error.value.orig, "pgcode", None) == "23505"
        assert duplicate_error.value.orig.diag.constraint_name == "uq_development_current_term_scope_revision"
        db.rollback()

        with pytest.raises(DBAPIError) as immutable_error:
            db.execute(text(
                "UPDATE development_current_term_prediction "
                "SET predicted_period_grade = 99 WHERE prediction_id = :prediction_id"
            ), {"prediction_id": result["prediction_id"]})
            db.commit()
        assert getattr(immutable_error.value.orig, "pgcode", None) == "23514"
        db.rollback()


def test_latest_reader_is_model_specific_after_revisions(postgres_prediction_context):
    ctx = postgres_prediction_context
    corrected_first = _generate(ctx)
    add_activity(ctx, "PERFORMANCE_TASK", 15, 20)
    corrected_second = _generate(ctx)

    with Session(ctx["engine"]) as db:
        legacy_model_id = _register_model(db, LEGACY_MODEL_NAME)
    legacy = _generate(ctx, model_version_id=legacy_model_id)

    with Session(ctx["engine"]) as db:
        query = {
            "class_id": ctx["class"].class_id,
            "subject_id": ctx["subject"].subject_id,
            "academic_period_id": ctx["period"].academic_period_id,
        }
        corrected_read = list_latest_development_current_term_predictions(
            db, **query, model_version_id=ctx["model_version_id"], require_active_enrollment=True,
        )
        legacy_read = list_latest_development_current_term_predictions(
            db, **query, model_version_id=legacy_model_id, require_active_enrollment=True,
        )

    assert corrected_first["revision"] == 1 and corrected_second["revision"] == 2
    assert corrected_read["total"] == 1
    assert corrected_read["items"][0]["prediction_id"] == corrected_second["prediction_id"]
    assert corrected_read["items"][0]["revision"] == 2
    assert legacy["revision"] == 1
    assert legacy_read["total"] == 1
    assert legacy_read["items"][0]["prediction_id"] == legacy["prediction_id"]


def test_committed_grades_drive_complete_automatic_prediction_workflow(
    postgres_prediction_context,
    monkeypatch,
):
    ctx = postgres_prediction_context
    db = ctx["db"]
    student = Student(
        student_id=uuid4(),
        student_lrn="300000009902",
        first_name="Automatic",
        last_name="Workflow",
        academic_level_id=ctx["level"].academic_level_id,
    )
    db.add(student)
    db.flush()
    db.add(StudentClass(
        student_id=student.student_id,
        class_id=ctx["class"].class_id,
        academic_year_id=ctx["year"].academic_year_id,
        enrollment_status="enrolled",
    ))
    db.commit()

    # The fixture's four class-wide assignments are the exact readiness set:
    # two Written Works and two Performance Tasks. Add one more initially
    # ungraded activity so a later committed grade materially changes evidence.
    add_activity(ctx, "WRITTEN_WORK", None, 10, status=None, title="Workflow revision evidence")
    assignments = db.query(ClassworkAssignment).order_by(
        ClassworkAssignment.classwork_assignment_id
    ).all()
    assert len(assignments) == 5
    submissions = []
    for assignment in assignments:
        submission = StudentSubmission(
            student_id=student.student_id,
            classwork_assignment_id=assignment.classwork_assignment_id,
            status="submitted",
            submitted_at=datetime.now(timezone.utc),
        )
        db.add(submission)
        submissions.append(submission)
    db.commit()

    score_calls = []

    def deterministic_score(features, **kwargs):
        score_calls.append({"features": dict(features), "kwargs": dict(kwargs)})
        return 74.25 if len(score_calls) == 1 else 90.0

    monkeypatch.setattr(scorer, "score_development_current_term", deterministic_score)
    committed_refreshes = []
    real_refresh = submission_service.refresh_after_committed_grade_change

    def observe_committed_refresh(bind, **scope):
        with Session(bind) as check:
            committed_count = check.query(StudentSubmission).filter(
                StudentSubmission.student_id == student.student_id,
                StudentSubmission.status == "graded",
                StudentSubmission.grade.isnot(None),
            ).count()
        committed_refreshes.append({"committed_count": committed_count, "scope": scope})
        return real_refresh(bind, **scope)

    monkeypatch.setattr(
        submission_service,
        "refresh_after_committed_grade_change",
        observe_committed_refresh,
    )

    def prediction_rows():
        db.expire_all()
        return db.query(DevelopmentCurrentTermPrediction).filter_by(
            student_id=student.student_id,
            class_id=ctx["class"].class_id,
            subject_id=ctx["subject"].subject_id,
            source_period_id=ctx["period"].academic_period_id,
            target_period_id=ctx["period"].academic_period_id,
            model_version_id=ctx["model_version_id"],
        ).order_by(DevelopmentCurrentTermPrediction.revision).all()

    assert prediction_rows() == []
    for index, submission in enumerate(submissions[:3], start=1):
        submission_service.grade_student_submission(
            submission.submission_id,
            GradeRequest(grade=7),
            ctx["staff"].staff_id,
            db,
        )
        assert committed_refreshes[-1]["committed_count"] == index
        assert prediction_rows() == []
        assert score_calls == []

    submission_service.grade_student_submission(
        submissions[3].submission_id,
        GradeRequest(grade=7),
        ctx["staff"].staff_id,
        db,
    )
    first_rows = prediction_rows()
    assert committed_refreshes[-1]["committed_count"] == 4
    assert len(first_rows) == 1
    assert first_rows[0].revision == 1
    assert len(score_calls) == 1
    first_prediction_id = first_rows[0].prediction_id
    first_snapshot = first_rows[0].evidence_snapshot

    # An unchanged grade does not enqueue redundant refresh work. A duplicate
    # delivery of the real refresh service also reuses Revision 1 without ML.
    refresh_count = len(committed_refreshes)
    submission_service.grade_student_submission(
        submissions[3].submission_id,
        GradeRequest(grade=7),
        ctx["staff"].staff_id,
        db,
    )
    assert len(committed_refreshes) == refresh_count
    grade_refresh.refresh_after_committed_grade_change(
        ctx["engine"],
        student_ids=[student.student_id],
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        period_id=ctx["period"].academic_period_id,
    )
    unchanged_rows = prediction_rows()
    assert [(row.prediction_id, row.revision) for row in unchanged_rows] == [
        (first_prediction_id, 1),
    ]
    assert len(score_calls) == 1

    submission_service.grade_student_submission(
        submissions[4].submission_id,
        GradeRequest(grade=9),
        ctx["staff"].staff_id,
        db,
    )
    changed_rows = prediction_rows()
    assert committed_refreshes[-1]["committed_count"] == 5
    assert [row.revision for row in changed_rows] == [1, 2]
    assert changed_rows[0].prediction_id == first_prediction_id
    assert changed_rows[0].evidence_snapshot == first_snapshot
    assert changed_rows[1].prediction_id != first_prediction_id
    assert len(score_calls) == 2

    interventions = db.query(Intervention).filter_by(
        student_id=student.student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
    ).all()
    assert len(interventions) == 1
    assert interventions[0].status == "RESOLVED"
    assert interventions[0].resolution_reason == "IMPROVED_PREDICTION"
    assert interventions[0].source_prediction_id == first_prediction_id

    # Promote only the isolated test registry row so the stable production GET
    # can expose the generated history. The request must execute no SQL writes.
    model = db.get(AIModelVersion, ctx["model_version_id"])
    model.lifecycle_status = "PRODUCTION"
    model.production_validated = True
    model.independent_three_term_validation = True
    model.is_active = True
    db.commit()
    writes = []

    def capture_writes(_conn, _cursor, statement, _parameters, _context, _executemany):
        verb = statement.lstrip().split(None, 1)[0].upper()
        if verb in {"INSERT", "UPDATE", "DELETE", "MERGE", "TRUNCATE"}:
            writes.append(statement)

    event.listen(ctx["engine"], "before_cursor_execute", capture_writes)
    before_counts = (
        db.query(DevelopmentCurrentTermPrediction).count(),
        db.query(Intervention).count(),
        len(score_calls),
    )
    try:
        with _client(
            monkeypatch,
            db,
            role="admin",
            environment="production",
            enabled=False,
        ) as client:
            response = client.get(
                "/api/v1/current-term-predictions",
                params=_read_params(ctx),
            )
    finally:
        event.remove(ctx["engine"], "before_cursor_execute", capture_writes)
        app.dependency_overrides.clear()

    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["prediction_id"] == changed_rows[1].prediction_id
    assert response.json()["items"][0]["revision"] == 2
    assert writes == []
    assert (
        db.query(DevelopmentCurrentTermPrediction).count(),
        db.query(Intervention).count(),
        len(score_calls),
    ) == before_counts

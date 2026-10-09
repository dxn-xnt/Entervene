"""Units and SQLite/mocked behavior only: never run the live preview CLI."""
import ast
from collections import Counter
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock
from uuid import UUID

import pytest
from sqlalchemy import create_engine, event, func, insert, select, text
from sqlalchemy.engine import URL
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicYear import AcademicYear
from app.models.people.Student import Student
from scripts import seed_teacher_dashboard_preview as seed


NOW = datetime(2026, 10, 10, 4, tzinfo=timezone.utc)  # Saturday, noon Manila
STAFF = "T-PREVIEW"


def learner_id(index):
    # Include a hex letter: SQLite's native UUID column has numeric affinity.
    return UUID(f"a0000000-0000-4000-8000-{index:012x}")


def synthetic_url(**overrides):
    """No embedded password; URLs are runtime test objects, never credentials."""
    parts = dict(drivername="postgresql", username="x", host="localhost",
                 port=5432, database="entervene_preview")
    parts.update(overrides)
    return URL.create(**parts).render_as_string(hide_password=False)


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1"])
@pytest.mark.parametrize("drivername", ["postgresql", "postgresql+psycopg2"])
def test_guard_accepts_only_explicit_loopback_preview_target(host, drivername):
    """Unit."""
    result = seed.validate_url(synthetic_url(host=host, drivername=drivername), {})
    assert result.host == host
    assert result.database == "entervene_preview"


@pytest.mark.parametrize("overrides", [
    {"database": "activity_db"}, {"database": "entervene_db"},
    {"database": "activity_test"}, {"database": "other"},
    {"host": "localhost.evil.com"}, {"host": "192.0.2.1"},
    {"host": "::1"}, {"host": None}, {"port": None},
    {"port": 0}, {"port": 65536}, {"drivername": "sqlite"},
    {"drivername": "postgresql+asyncpg"},
    {"query": {"host": "127.0.0.1"}}, {"query": {"hostaddr": "127.0.0.1"}},
    {"query": {"service": "x"}}, {"query": {"options": "x"}},
    {"query": {"sslmode": "require"}},
])
def test_guard_rejects_wrong_targets_and_all_query_parameters(overrides):
    """Unit: guard runs before any engine/connection is created."""
    with pytest.raises(seed.SeedError):
        seed.validate_url(synthetic_url(**overrides), {})


@pytest.mark.parametrize("raw", [None, "", "not-a-url", "postgresql://x@localhost:bad/entervene_preview"])
def test_guard_rejects_missing_or_malformed_url(raw):
    """Unit."""
    with pytest.raises(seed.SeedError):
        seed.validate_url(raw, {})


@pytest.mark.parametrize("key", ["PGHOST", "PGHOSTADDR", "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS", "PGPORT", "PGDATABASE", "PGUSER", "PGPASSWORD", "PGPASSFILE"])
def test_guard_rejects_libpq_routing_and_credential_overrides(key):
    """Unit."""
    with pytest.raises(seed.SeedError, match="libpq_environment_override_forbidden"):
        seed.validate_url(synthetic_url(), {key: "x"})


def test_engine_pins_loopback_and_uses_serializable_hidden_parameters(monkeypatch):
    """Mocked-behavior: create_engine is mocked; no real connection."""
    factory = MagicMock()
    monkeypatch.setattr(seed, "create_engine", factory)
    seed.guarded_engine({seed.URL_ENV: synthetic_url(), "DATABASE_URL": "ignored"})
    _, kwargs = factory.call_args
    assert kwargs == dict(connect_args={"hostaddr": "127.0.0.1"}, echo=False,
                          hide_parameters=True, isolation_level="SERIALIZABLE")


@pytest.mark.parametrize("database,accepted", [("entervene_preview", True), ("activity_db", False), ("entervene_db", False), ("other", False)])
def test_connected_database_is_checked_before_seeding(database, accepted):
    """Mocked-behavior: current_database() result only."""
    conn = MagicMock()
    conn.execute.return_value.scalar_one.return_value = database
    if accepted:
        seed.check_database(conn)
    else:
        with pytest.raises(seed.SeedError, match="connected_database_guard_failed"):
            seed.check_database(conn)
    assert str(conn.execute.call_args.args[0]) == "SELECT current_database()"


@pytest.fixture
def preview():
    """Mocked-behavior: disposable SQLite structure, not a real preview DB."""
    engine = create_engine("sqlite://", poolclass=StaticPool)
    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, _record):
        dbapi_connection.execute("PRAGMA foreign_keys=ON")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        year = AcademicYear(year_label="2026-2027", start_date=date(2026, 8, 1),
                            end_date=date(2027, 5, 31), is_active=True)
        level = AcademicLevel(level_name="Grade 7", grade_level=7)
        staff = seed.AcademicStaff(staff_id=STAFF, first_name="Synthetic", last_name="Teacher")
        db.add_all([year, level, staff])
        db.flush()
        period = seed.AcademicPeriod(academic_year_id=year.academic_year_id, period_name="Term 2",
            period_type="TERM", period_sequence=2, total_periods_in_year=3,
            start_date=date(2026, 10, 1), end_date=date(2026, 12, 31), is_active=True)
        class_ = seed.Class(section_name="Synthetic", academic_year_id=year.academic_year_id,
                            academic_level_id=level.academic_level_id, class_status="active")
        groups = [seed.SubjectGroup(name="Synthetic Core", passing_threshold=Decimal(85)),
                  seed.SubjectGroup(name="Synthetic Other", passing_threshold=Decimal(83))]
        db.add_all([period, class_, *groups])
        db.flush()
        subjects = [seed.Subject(subject_name=f"Synthetic Subject {i}", subject_group_id=group.subject_group_id,
                                 academic_level_id=level.academic_level_id, status="active")
                    for i, group in enumerate(groups, 1)]
        db.add_all(subjects)
        db.flush()
        db.add_all([seed.SubjectLoad(staff_id=STAFF, class_id=class_.class_id, subject_id=s.subject_id,
                                    academic_period_id=period.academic_period_id, status="published") for s in subjects])
        learners = [Student(student_id=learner_id(i), student_lrn=f"{i:012}", first_name=f"Synthetic{i}",
                            last_name="Student", academic_level_id=level.academic_level_id) for i in range(1, 20)]
        db.add_all(learners)
        db.flush()
        db.add_all([seed.StudentClass(student_id=s.student_id, class_id=class_.class_id,
                                     academic_year_id=year.academic_year_id, enrollment_status="enrolled") for s in learners])
        db.commit()
        data = SimpleNamespace(period=period.academic_period_id, class_id=class_.class_id,
                               year_id=year.academic_year_id, level_id=level.academic_level_id,
                               subjects=[s.subject_id for s in subjects], groups=[g.subject_group_id for g in groups])
    try:
        yield engine, data
    finally:
        engine.dispose()


def table_counts(conn):
    return {name: conn.scalar(select(func.count()).select_from(table)) for name, table in seed.TABLES.items()}


def apply_fixture(engine, data):
    with engine.begin() as conn:
        return seed.seed_connection(conn, STAFF, data.period, NOW, apply=True)


def test_dry_run_is_select_only_and_does_not_insert_then_rollback(preview):
    """Mocked-behavior: actual SQLite statements recorded and checked."""
    engine, data = preview
    statements = []
    with engine.begin() as conn:
        before = table_counts(conn)
        guard = seed.install_statement_guard(conn, dry_run=True)
        recorder = lambda _c, _u, statement, *_rest: statements.append(statement)
        event.listen(conn, "before_cursor_execute", recorder)
        try:
            plan, existing, missing = seed.seed_connection(conn, STAFF, data.period, NOW, apply=False)
        finally:
            event.remove(conn, "before_cursor_execute", recorder)
            event.remove(conn, "before_cursor_execute", guard)
        assert table_counts(conn) == before
    assert statements and all(s.lstrip().upper().startswith("SELECT ") for s in statements)
    assert not existing and sum(missing.values()) == len(plan.rows)


def test_apply_is_insert_only_and_rerun_has_zero_additions(preview):
    """Mocked-behavior: true idempotency, existing values never updated."""
    engine, data = preview
    with engine.begin() as conn:
        guard = seed.install_statement_guard(conn, dry_run=False)
        try:
            first, _, inserted = seed.seed_connection(conn, STAFF, data.period, NOW, apply=True)
            before = table_counts(conn)
            second, existing, additions = seed.seed_connection(conn, STAFF, data.period, NOW, apply=True)
            assert table_counts(conn) == before
        finally:
            event.remove(conn, "before_cursor_execute", guard)
    assert not additions
    assert existing == inserted
    assert first == second
    assert inserted["student_submission"] == 198
    assert inserted["quiz_answer"] == 180
    assert inserted["attendance_record"] == 10
    assert inserted["classwork"] == 11
    assert inserted["grading_template_component"] == 6


@pytest.mark.parametrize("dry_run", [True, False])
@pytest.mark.parametrize("statement", ["UPDATE academic_staff SET first_name = 'x'", "DELETE FROM attendance_record", "DROP TABLE quiz", "CREATE TABLE x (id INTEGER)"])
def test_statement_guard_refuses_update_delete_and_ddl(preview, dry_run, statement):
    """Mocked-behavior: guard stops execution before the cursor sees DML."""
    engine, _ = preview
    with engine.begin() as conn:
        guard = seed.install_statement_guard(conn, dry_run=dry_run)
        try:
            with pytest.raises(seed.SeedError, match="non_insert_write_forbidden"):
                conn.execute(text(statement))
        finally:
            event.remove(conn, "before_cursor_execute", guard)


def test_dry_run_guard_also_refuses_inserts(preview):
    """Mocked-behavior."""
    engine, _ = preview
    with engine.begin() as conn:
        guard = seed.install_statement_guard(conn, dry_run=True)
        try:
            with pytest.raises(seed.SeedError):
                conn.execute(insert(seed.Question.__table__).values(question_text="Synthetic", question_type="SHORT_ANSWER"))
        finally:
            event.remove(conn, "before_cursor_execute", guard)


def test_apply_does_all_preflight_validation_before_any_insert(preview, monkeypatch):
    """Mocked-behavior: failed same-run preflight leaves everything untouched."""
    engine, data = preview
    def refuse(*_args):
        raise seed.SeedError("preflight_refused")
    monkeypatch.setattr(seed, "inspect_plan", refuse)
    with engine.begin() as conn:
        before = table_counts(conn)
        with pytest.raises(seed.SeedError, match="preflight_refused"):
            seed.seed_connection(conn, STAFF, data.period, NOW, apply=True)
        assert table_counts(conn) == before


def test_apply_rolls_back_all_inserts_when_a_later_insert_fails(preview):
    """Mocked-behavior: caller's single transaction is atomic."""
    engine, data = preview
    with engine.connect() as conn:
        before = table_counts(conn)
    def fail_after_prior_inserts(_conn, _cursor, statement, *_rest):
        if statement.startswith("INSERT INTO quiz_answer"):
            raise RuntimeError("synthetic failure")
    event.listen(engine, "before_cursor_execute", fail_after_prior_inserts)
    try:
        with pytest.raises(RuntimeError, match="synthetic failure"):
            apply_fixture(engine, data)
    finally:
        event.remove(engine, "before_cursor_execute", fail_after_prior_inserts)
    with engine.connect() as conn:
        assert table_counts(conn) == before


@pytest.mark.parametrize("kind", ["foreign_activity", "foreign_attendance", "saved_grade", "duplicate_load", "changed_row", "extra_submission", "extra_attendance", "changed_threshold"])
def test_preexisting_conflicts_are_refused_without_writing(preview, kind):
    """Mocked-behavior: fixture mutations are SQLite-only, not seed operations."""
    engine, data = preview
    if kind in {"changed_row", "extra_submission", "extra_attendance", "changed_threshold"}:
        apply_fixture(engine, data)
    with Session(engine) as db:
        if kind == "foreign_activity":
            work = seed.Classwork(title="Synthetic unrelated work", classwork_type="ACTIVITY", subject_id=data.subjects[0], created_by_staff_id=STAFF)
            db.add(work)
            db.flush()
            db.add(seed.ClassworkAssignment(classwork_id=work.classwork_id, class_id=data.class_id, academic_period_id=data.period, assigned_by_staff_id=STAFF))
        elif kind == "foreign_attendance":
            db.add(seed.AttendanceRecord(student_id=learner_id(1), class_id=data.class_id, date=date(2026, 10, 1), status="present"))
        elif kind == "saved_grade":
            db.add(seed.StudentPeriodGrade(student_id=learner_id(1), class_id=data.class_id, subject_id=data.subjects[0], academic_period_id=data.period, final_period_grade=85))
        elif kind == "duplicate_load":
            db.add(seed.SubjectLoad(staff_id=STAFF, subject_id=data.subjects[0], class_id=data.class_id, academic_period_id=data.period, status="active", logical_load_id="Synthetic-duplicate"))
        elif kind == "changed_row":
            db.query(seed.StudentSubmission).first().grade = Decimal(1)
        elif kind == "extra_submission":
            assignment = db.query(seed.ClassworkAssignment).first()
            db.add(seed.StudentSubmission(student_id=learner_id(19), classwork_assignment_id=assignment.classwork_assignment_id, grade=Decimal(100), status="graded"))
        elif kind == "extra_attendance":
            existing = db.query(seed.AttendanceRecord).first()
            db.add(seed.AttendanceRecord(student_id=learner_id(19), class_id=data.class_id, subject_id=data.subjects[0], date=date(2026, 10, 1), remarks=existing.remarks))
        elif kind == "changed_threshold":
            db.get(seed.SubjectGroup, data.groups[0]).passing_threshold = Decimal(75)
        db.commit()
    with engine.begin() as conn:
        before = table_counts(conn)
        with pytest.raises(seed.SeedError):
            seed.seed_connection(conn, STAFF, data.period, NOW, apply=True)
        assert table_counts(conn) == before


@pytest.mark.parametrize("day", range(5, 11))
def test_calendar_slots_scale_status_mix_without_future_dates(day):
    """Unit: preserve all four statuses with the closest possible small mix."""
    now = datetime(2026, 10, day, 0, tzinfo=timezone.utc)
    slots = seed.attendance_dates(now, date(2026, 10, 1), date(2026, 12, 31))
    statuses = Counter(seed.attendance_statuses(len(slots)))
    assert len(slots) == len(set(slots)) == day
    assert max(slots) <= now.astimezone(seed.MANILA).date()
    assert statuses == Counter(present=day-3, late=1, excused=1, absent=1)
    # Compare every integer allocation retaining at least one of each status.
    loss = sum((statuses[k] - day*p)**2 for k, p in zip(("present", "late", "excused", "absent"), (.7, .1, .1, .1)))
    for p in range(1, day-2):
        for l in range(1, day-p-1):
            for e in range(1, day-p-l):
                a = day-p-l-e
                assert loss <= sum((n-day*r)**2 for n, r in zip((p,l,e,a), (.7,.1,.1,.1))) + 1e-10


@pytest.mark.parametrize("day", [1, 2, 3, 4])
def test_fewer_than_five_elapsed_days_refuses_preflight(day):
    """Unit."""
    with pytest.raises(seed.SeedError, match="at_least_5"):
        seed.attendance_dates(NOW.replace(day=day), date(2026, 10, 1), date(2026, 12, 31))


def test_weekends_manila_midnight_and_period_intersection():
    """Unit: no UTC date leakage and no silent reduction of required slots."""
    assert seed.attendance_dates(NOW, date(2026, 10, 1), date(2026, 12, 31))[-1].weekday() == 5
    before = datetime(2026, 10, 4, 15, 59, tzinfo=timezone.utc)
    with pytest.raises(seed.SeedError):
        seed.attendance_dates(before, date(2026, 10, 1), date(2026, 12, 31))
    assert len(seed.attendance_dates(before + timedelta(minutes=1), date(2026, 10, 1), date(2026, 12, 31))) == 5
    with pytest.raises(seed.SeedError, match="does_not_cover"):
        seed.attendance_dates(NOW, date(2026, 10, 2), date(2026, 12, 31))
    days = seed.weekday_dates(NOW, date(2026, 10, 1), date(2026, 12, 31))
    assert {day.weekday() for day in days} == set(range(7))
    assert max(days) < NOW.astimezone(seed.MANILA).date()
    with pytest.raises(seed.SeedError, match="seven_elapsed"):
        seed.weekday_dates(NOW, date(2026, 10, 5), date(2026, 12, 31))


@pytest.mark.parametrize("grade", sorted(set(seed.PROFILE)))
def test_profile_scores_use_the_real_transmutation_table(grade):
    """Unit: no invented inverse grade formula."""
    assert seed.transmute_current_three_term_grade(seed.raw_score(grade)) == grade


def test_counts_match_the_real_phase_two_three_dashboard_and_gradebook(preview, monkeypatch):
    """Mocked-behavior: actual dashboard/class-record against seeded SQLite."""
    from app.services.activity import AnalyticsService
    engine, data = preview
    plan, _, _ = apply_fixture(engine, data)
    monkeypatch.setattr(AnalyticsService, "_teacher_dashboard_now", lambda: NOW)
    with Session(engine) as db:
        dashboard = AnalyticsService.build_teacher_dashboard_health(db, STAFF, db.get(seed.AcademicPeriod, data.period))
        grades = dashboard["phase_two"]["grades"]
        assert grades["available_grade_count"] == plan.counts["available_grades"] == 36
        assert grades["total_grade_count"] == plan.counts["student_subject_entries"] == 38
        assert grades["current_grade"] == round(sum(plan.grades.values()) / len(plan.grades), 1)
        expected_passing = sum(value >= (85 if sid == data.subjects[0] else 83)
                               for (_, sid, _), value in plan.grades.items())
        assert grades["passing_count"] == plan.counts["passing_grades"] == expected_passing
        assert grades["passing_rate_percent"] == round(100.0 * expected_passing / len(plan.grades), 1)
        bands = dashboard["details"]["grade_distribution"]
        expected_bands = [sum(low <= value < high for value in plan.grades.values())
                          for low, high in ((90,101), (85,90), (80,85), (75,80), (0,75))]
        assert [b["count"] for b in bands] == expected_bands
        assert [p["current_grade"] for p in dashboard["details"]["top_performers"]] == [97, 96, 95]
        assert dashboard["details"]["grade_details"]["cutoff_tie_omitted_count"] == 1
        assert dashboard["details"]["attendance_by_section"][0]["rate"] == 80.0
        late = dashboard["phase_two"]["late_submissions"]
        assert late["late_count"] == 1
        assert late["excused_excluded_count"] == 1
        assert late["eligible_count"] == 197
        assert dashboard["phase_two"]["weekdays"]["sunday_count"] > 0
        assert all(row["count"] > 0 for row in dashboard["details"]["submissions_by_weekday"])
        assert dashboard["kpis"]["overall_completion_rate"] == 94.7
        assert dashboard["kpis"]["ungraded_count"] == 0
        assert dashboard["action_queue"]["pending_grading"] == []
        assert not grades["warnings"]
        # Quiz marks add up to the persisted submission score, not fabricated totals.
        for submission in db.query(seed.StudentSubmission).join(seed.ClassworkAssignment).join(seed.Classwork).filter(seed.Classwork.classwork_type == "QUIZ"):
            assert sum(answer.points_awarded for answer in submission.quiz_answers) == submission.grade


def test_output_is_allowlisted_counts_and_chosen_ids_only(preview, capsys):
    """Unit formatting: chosen IDs allowed, no names or individual grades/text."""
    engine, data = preview
    with engine.connect() as conn:
        result = seed.seed_connection(conn, STAFF, data.period, NOW, apply=False)
    seed.print_counts(*result, apply=False)
    output = capsys.readouterr().out
    assert all(value not in output for value in ("Synthetic", "student_lrn", result[0].prefix, result[0].fingerprint, "postgresql", "There are 12"))
    assert output.count(STAFF) == 1
    assert f'teacher_staff_id "{STAFF}"' in output
    assert f"academic_period_id {data.period}" in output
    numeric_section = output.split("Metric Count\n", 1)[1].split("Included scenarios\n", 1)[0]
    assert all(part.isdigit() for line in numeric_section.splitlines() for part in line.split()[1:])
    assert "Expected results (aggregates only)" in output
    assert f"grade_coverage {len(result[0].grades)}/38" in output


def test_existing_template_is_reused_without_modification(preview):
    """Mocked-behavior: INSERT-only code never rewrites existing weights."""
    engine, data = preview
    with Session(engine) as db:
        template = seed.GradingTemplate(template_name="Synthetic existing template",
            academic_level_id=data.level_id, status="active")
        db.add(template)
        db.flush()
        db.add_all([seed.GradingTemplateComponent(grading_template_id=template.grading_template_id,
            component_name=name, weight=weight, display_order=index)
            for index, (name, weight) in enumerate((("Written Work", 25), ("Performance Task", 45), ("Examinations", 30)), 1)])
        db.commit()
    _, _, additions = apply_fixture(engine, data)
    assert additions["grading_template"] == additions["grading_template_component"] == 0
    with engine.connect() as conn:
        assert list(conn.execute(select(seed.GradingTemplateComponent.weight).order_by(seed.GradingTemplateComponent.display_order)).scalars()) == [25, 45, 30]


def test_preview_scope_rejects_missing_teacher_period_or_roster(preview):
    """Mocked-behavior: no fallback to another staff member or period."""
    engine, data = preview
    with engine.connect() as conn:
        for teacher, period in (("UNKNOWN", data.period), (STAFF, 999999)):
            with pytest.raises(seed.SeedError, match="teacher_or_period_missing"):
                seed.build_plan(conn, teacher, period, NOW)
    with Session(engine) as db:
        for enrollment in db.query(seed.StudentClass):
            enrollment.enrollment_status = "transferred"
        db.commit()
    with engine.connect() as conn:
        with pytest.raises(seed.SeedError, match="empty_active_roster"):
            seed.build_plan(conn, STAFF, data.period, NOW)


def test_plan_is_deterministic_and_never_selects_student_personal_fields(preview):
    """Mocked-behavior: structure/IDs only; name data isn't needed to seed."""
    engine, data = preview
    statements = []
    recorder = lambda _c, _u, statement, *_rest: statements.append(statement)
    with engine.connect() as conn:
        event.listen(conn, "before_cursor_execute", recorder)
        first = seed.build_plan(conn, STAFF, data.period, NOW)
        second = seed.build_plan(conn, STAFF, data.period, NOW)
    assert first == second
    assert all(not any(column in s.lower() for column in ("student_lrn", "first_name", "last_name", "email", "password")) for s in statements)
    assert {row.table for row in first.rows} <= set(seed.TABLES)
    assert max(row.values["submitted_at"] for row in first.rows if row.table == "student_submission") < NOW


@pytest.mark.parametrize("apply", [False, True])
def test_cli_is_one_transaction_with_target_guard_and_apply_lock(monkeypatch, apply):
    """Mocked-behavior only; neither seed script nor real engine is run."""
    engine, conn = MagicMock(), MagicMock()
    engine.connect.return_value.__enter__.return_value = conn
    conn.execute.return_value.scalar_one.return_value = "entervene_preview"
    monkeypatch.setattr(seed, "guarded_engine", lambda _env: engine)
    monkeypatch.setattr(seed, "install_statement_guard", lambda *_a, **_kw: "guard")
    monkeypatch.setattr(seed.event, "remove", MagicMock())
    observed = []
    def record_sql(statement, *_args):
        observed.append(str(statement))
        result = MagicMock()
        result.scalar_one.return_value = "entervene_preview"
        return result
    conn.execute.side_effect = record_sql
    def preflight_then_seed(*_args, **_kwargs):
        observed.append("preflight_then_seed")
        return "plan", Counter(), Counter()
    core, printer = MagicMock(side_effect=preflight_then_seed), MagicMock()
    monkeypatch.setattr(seed, "seed_connection", core)
    monkeypatch.setattr(seed, "print_counts", printer)
    assert seed.main(["--teacher-staff-id", STAFF, "--academic-period-id", "1", "--apply" if apply else "--dry-run"], environ={}) == 0
    sql = [str(call.args[0]) for call in conn.execute.call_args_list]
    assert conn.begin.call_count == 1
    assert ("SET TRANSACTION READ ONLY" in sql) is not apply
    assert any("pg_advisory_xact_lock" in q for q in sql) is apply
    assert observed.index("SELECT current_database()") < observed.index("preflight_then_seed")
    if apply:
        assert observed.index("SELECT pg_advisory_xact_lock(:key)") < observed.index("preflight_then_seed")
    assert core.call_args.kwargs["apply"] is apply
    engine.dispose.assert_called_once()


def test_cli_wrong_connected_database_never_calls_seed(monkeypatch, capsys):
    """Mocked-behavior: sanitization and fail-closed guard."""
    engine, conn, core = MagicMock(), MagicMock(), MagicMock()
    engine.connect.return_value.__enter__.return_value = conn
    conn.execute.return_value.scalar_one.return_value = "activity_db"
    monkeypatch.setattr(seed, "guarded_engine", lambda _env: engine)
    monkeypatch.setattr(seed, "install_statement_guard", lambda *_a, **_kw: "guard")
    monkeypatch.setattr(seed.event, "remove", MagicMock())
    monkeypatch.setattr(seed, "seed_connection", core)
    assert seed.main(["--teacher-staff-id", STAFF, "--academic-period-id", "1", "--apply"], environ={}) == 2
    core.assert_not_called()
    assert capsys.readouterr().out == "ERROR connected_database_guard_failed: The connected database must be exactly entervene_preview.\n"


def test_cli_connection_errors_never_print_url_sql_or_identity(monkeypatch, capsys):
    """Mocked-behavior: even a malicious driver's exception is redacted."""
    def fail(_env):
        raise RuntimeError(synthetic_url() + " Synthetic Teacher private question text")
    monkeypatch.setattr(seed, "guarded_engine", fail)
    assert seed.main(["--teacher-staff-id", STAFF, "--academic-period-id", "1", "--dry-run"], environ={}) == 2
    assert capsys.readouterr().out == "ERROR preview_seed_failed: The operation failed; connection and database details were suppressed.\n"


def test_script_has_no_settings_session_dotenv_or_app_importers():
    """Unit structural guard: standalone dev tool, no application hook."""
    source = Path(seed.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)
    imports = [node.module or "" for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)]
    imports += [alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names]
    assert all(not ("dotenv" in name or name.startswith(("app.core", "app.db.Session", "app.main"))) for name in imports)
    root = Path(seed.__file__).parents[1] / "app"
    for path in root.rglob("*.py"):
        if path.name.startswith(".env"):
            continue
        assert "seed_teacher_dashboard_preview" not in path.read_text(encoding="utf-8")


def configure_small_roster(engine, data, *, count=3, subject_count=1, threshold=83):
    """Fixture-only SQLite mutations; the seed itself remains INSERT-only."""
    with Session(engine) as db:
        for enrollment in db.query(seed.StudentClass):
            enrollment.enrollment_status = "enrolled" if enrollment.student_id in {learner_id(i) for i in range(1, count+1)} else "transferred"
        for index, load in enumerate(db.query(seed.SubjectLoad).order_by(seed.SubjectLoad.subject_id)):
            load.status = "published" if index < subject_count else "draft"
        db.get(seed.SubjectGroup, data.groups[0]).passing_threshold = Decimal(threshold)
        db.commit()


def add_candidate_pair(engine, data, *, staff_id="T-OTHER", learners=25, sequence=None,
                       start=date(2026,10,1), end=date(2026,12,31), period_id=None):
    """Synthetic SQLite structure for discovery, no names selected by the seed."""
    with Session(engine) as db:
        if db.get(seed.AcademicStaff, staff_id) is None:
            db.add(seed.AcademicStaff(staff_id=staff_id, first_name="Synthetic", last_name="Other"))
        if sequence is not None:
            period = seed.AcademicPeriod(academic_year_id=data.year_id, period_name=f"Synthetic term {sequence}",
                period_type="TERM", period_sequence=sequence, total_periods_in_year=3,
                start_date=start, end_date=end)
            db.add(period)
            db.flush()
            period_id = period.academic_period_id
        period_id = data.period if period_id is None else period_id
        class_ = seed.Class(section_name="Synthetic Other", academic_year_id=data.year_id,
                            academic_level_id=data.level_id, class_status="active")
        db.add(class_)
        db.flush()
        db.add(seed.SubjectLoad(staff_id=staff_id, class_id=class_.class_id, subject_id=data.subjects[0],
                               academic_period_id=period_id, status="published"))
        first = 1000 + class_.class_id * 100
        for index in range(first, first+learners):
            db.add(Student(student_id=learner_id(index), student_lrn=f"{index:012}",
                first_name="Synthetic", last_name="Other", academic_level_id=data.level_id))
            db.flush()
            db.add(seed.StudentClass(student_id=learner_id(index), class_id=class_.class_id,
                academic_year_id=data.year_id, enrollment_status="enrolled"))
        db.commit()
        return staff_id, period_id, class_.class_id


def test_auto_discovery_ranks_learners_not_multiplied_subject_entries(preview):
    """Mocked-behavior: 25 learners/one subject beats 19 learners/two subjects."""
    engine, data = preview
    staff, period, _ = add_candidate_pair(engine, data)
    with engine.connect() as conn:
        assert seed.discover_scope(conn, None, None, NOW) == (staff, period)
        assert seed.discover_scope(conn, STAFF, None, NOW) == (STAFF, data.period)
        assert seed.discover_scope(conn, STAFF, data.period, NOW) == (STAFF, data.period)


def test_auto_discovery_honors_period_override_and_missing_id_filters(preview):
    """Mocked-behavior: a single explicit ID constrains, never gets replaced."""
    engine, data = preview
    staff, period, _ = add_candidate_pair(engine, data, sequence=3)
    with engine.connect() as conn:
        assert seed.discover_scope(conn, None, period, NOW) == (staff, period)
        assert seed.discover_scope(conn, STAFF, period, NOW) == (STAFF, period)
        with pytest.raises(seed.SeedError, match="no_assigned_active_loads"):
            seed.seed_connection(conn, STAFF, period, NOW, apply=False)


@pytest.mark.parametrize("kind", ["historical_period", "starts_after_first", "ends_before_today", "inactive_class", "draft_load", "inactive_version", "other_year", "inactive_enrollments"])
def test_auto_discovery_ignores_ineligible_or_unenrolled_larger_candidates(preview, kind):
    """Mocked-behavior: real ORM rows queried on SQLite, no production DB."""
    engine, data = preview
    kwargs = {}
    if kind == "historical_period":
        kwargs = dict(sequence=1, start=date(2026,7,1), end=date(2026,9,30))
    elif kind == "starts_after_first":
        kwargs = dict(sequence=3, start=date(2026,10,2))
    elif kind == "ends_before_today":
        kwargs = dict(sequence=3, end=date(2026,10,9))
    staff, _, class_id = add_candidate_pair(engine, data, **kwargs)
    with Session(engine) as db:
        class_ = db.get(seed.Class, class_id)
        load = db.query(seed.SubjectLoad).filter_by(class_id=class_id).one()
        if kind == "inactive_class":
            class_.class_status = "archived"
        elif kind == "draft_load":
            load.status = "draft"
        elif kind == "inactive_version":
            load.is_active_version = False
        elif kind == "other_year":
            year = AcademicYear(year_label="2025-2026", start_date=date(2025,8,1), end_date=date(2026,5,31))
            db.add(year)
            db.flush()
            old_class = seed.Class(section_name="Synthetic old-year class", academic_year_id=year.academic_year_id,
                                   academic_level_id=data.level_id, class_status="active")
            db.add(old_class)
            db.flush()
            load.class_id = old_class.class_id
        elif kind == "inactive_enrollments":
            for enrollment in db.query(seed.StudentClass).filter_by(class_id=class_id):
                enrollment.enrollment_status = "transferred"
        db.commit()
    with engine.connect() as conn:
        assert seed.discover_scope(conn, None, None, NOW) == (STAFF, data.period)


def test_discovery_ties_and_clock_use_manila_dates(preview):
    """Mocked-behavior: stable IDs break ties, Manila month not UTC month."""
    engine, data = preview
    add_candidate_pair(engine, data, learners=19, staff_id="T-Z")
    with engine.connect() as conn:
        assert seed.discover_scope(conn, None, None, NOW) == (STAFF, data.period)
        # UTC September 30 is already October 1 in Manila.
        assert seed.discover_scope(conn, STAFF, None, datetime(2026,9,30,16,tzinfo=timezone.utc)) == (STAFF, data.period)


def test_auto_selected_unsafe_pair_fails_closed_without_teacher_fallback(preview):
    """Mocked-behavior: discovery cannot silently bypass ambiguous ownership."""
    engine, data = preview
    _, _, class_id = add_candidate_pair(engine, data)
    with Session(engine) as db:
        db.add(seed.SubjectLoad(staff_id=STAFF, class_id=class_id, subject_id=data.subjects[0],
                               academic_period_id=data.period, status="active", logical_load_id="Synthetic-ambiguous"))
        db.commit()
    with engine.connect() as conn:
        with pytest.raises(seed.SeedError, match="ambiguous_shared_load_authorization"):
            seed.seed_connection(conn, None, None, NOW, apply=False)


@pytest.mark.parametrize("threshold", [75, 83, 85, 83.25])
def test_three_learner_single_subject_floor_succeeds_without_other_groups(preview, threshold):
    """Mocked-behavior: two scored learners and one ungraded, optional gaps."""
    engine, data = preview
    configure_small_roster(engine, data, threshold=threshold)
    with engine.begin() as conn:
        guard = seed.install_statement_guard(conn, dry_run=False)
        try:
            first, _, inserted = seed.seed_connection(conn, None, None, NOW, apply=True)
            second, existing, additions = seed.seed_connection(conn, None, None, NOW, apply=True)
        finally:
            event.remove(conn, "before_cursor_execute", guard)
    assert first == second and not additions and existing == inserted
    assert first.counts["enrolled_learners"] == 3
    assert first.counts["student_subject_entries"] == 3
    assert first.counts["available_grades"] == 2
    assert first.counts["unavailable_grades"] == first.counts["ungraded_learners"] == 1
    assert first.counts["top_performer_entries"] == 2
    assert first.counts["top_cutoff_ties_omitted"] == 0
    assert first.counts["completed_submissions"] == 12
    assert first.counts["expected_submissions"] == 18
    assert first.counts["excused_excluded_submissions"] == first.counts["counted_late_submissions"] == 1
    assert "all_attendance_statuses" in first.scenarios
    assert "excused_late_submission" in first.scenarios
    skipped = {s.code: s.reason for s in first.skipped}
    assert skipped["top_3_cutoff_tie"] == "insufficient_matching_grade_entries"
    assert skipped["multi_subject_learner"] == "no_multi_subject_learner"
    if threshold != 85:
        assert skipped["threshold_85_boundary_pair"] == "no_subject_at_threshold_85"
    if threshold != 83:
        assert skipped["threshold_83_boundary_pair"] == "no_subject_at_threshold_83"


@pytest.mark.parametrize("count", [1, 2])
def test_roster_floor_has_its_own_sanitized_refusal(preview, count, capsys):
    """Mocked-behavior: exact floor diagnostics, never a bundled reason."""
    engine, data = preview
    configure_small_roster(engine, data, count=count)
    with engine.connect() as conn:
        with pytest.raises(seed.SeedError, match="insufficient_enrolled_learners") as caught:
            seed.seed_connection(conn, None, None, NOW, apply=False)
    seed.print_refusal(caught.value)
    output = capsys.readouterr().out
    assert "At least three enrolled learners" in output
    assert f"enrolled_learners {count}" in output
    assert "required_learners 3" in output
    assert output.count(STAFF) == 1  # Verified chosen ID is explicitly allowed.


def test_shared_graded_scope_is_checked_before_planning():
    """Validator-unit: three isolated learners cannot satisfy the shared floor."""
    entries = [(i, 1, learner_id(i)) for i in range(1,4)]
    with pytest.raises(seed.SeedError, match="no_shared_graded_scope"):
        seed.choose_ungraded(entries, {1: Decimal(83)})


def test_ungraded_selection_preserves_a_two_learner_scope_when_possible():
    """Validator-unit: remove the lone learner, not one of the shared pair."""
    entries = [(1,1,learner_id(1)), (2,1,learner_id(2)), (2,1,learner_id(3))]
    missing, scope, grades, _, _ = seed.choose_ungraded(entries, {1: Decimal(83)})
    assert missing == learner_id(1)
    assert scope == (2,1)
    assert len(grades) == 2


def test_priority_uses_four_available_entries_for_top_cutoff_tie_first(preview):
    """Mocked-behavior: no hardcoded 15-entry floor or guaranteed tie count."""
    engine, data = preview
    configure_small_roster(engine, data, count=3, subject_count=2, threshold=85)
    plan, _, _ = apply_fixture(engine, data)
    assert sorted(plan.grades.values(), reverse=True) == [97,96,95,95]
    assert "top_3_cutoff_tie" in plan.scenarios
    assert plan.counts["top_cutoff_ties_omitted"] == 1
    assert plan.counts["unavailable_grades"] == 2
    assert "multi_subject_learner" in plan.scenarios
    assert any(s.code == "threshold_85_boundary_pair" for s in plan.skipped)


def test_large_roster_fits_all_scenarios_and_reuses_boundary_pairs(preview):
    """Mocked-behavior: all requested examples fit, same data serves band 85."""
    engine, data = preview
    with engine.connect() as conn:
        plan = seed.build_plan(conn, STAFF, data.period, NOW)
    assert set(plan.scenarios) == set(seed.SCENARIOS)
    assert not plan.skipped
    core = {value for (_,sid,_), value in plan.grades.items() if sid == data.subjects[0]}
    other = {value for (_,sid,_), value in plan.grades.items() if sid == data.subjects[1]}
    assert {84,85,86} <= core
    assert {82,83,84} <= other
    assert {74,75,79,80,84,85,89,90} <= set(plan.grades.values())


def test_absent_graded_entries_are_not_mislabeled_as_absent_subject():
    """Validator-unit: subject exists but the reserved learner owned its entries."""
    _, _, skipped = seed.plan_scenarios([(1,1,learner_id(1)), (1,1,learner_id(2))], {1:Decimal(85), 2:Decimal(83)})
    assert next(s for s in skipped if s.code == "threshold_83_boundary_pair").reason == "insufficient_matching_grade_entries"


def test_small_expected_output_is_derived_from_real_dashboard(preview, monkeypatch, capsys):
    """Mocked-behavior: count-only example and authoritative class-record parity."""
    from app.services.activity import AnalyticsService
    engine, data = preview
    configure_small_roster(engine, data)
    result = apply_fixture(engine, data)
    plan = result[0]
    monkeypatch.setattr(AnalyticsService, "_teacher_dashboard_now", lambda: NOW)
    with Session(engine) as db:
        dashboard = AnalyticsService.build_teacher_dashboard_health(db, STAFF, db.get(seed.AcademicPeriod, data.period))
    assert dashboard["phase_two"]["grades"]["current_grade"] == 82.5
    assert dashboard["phase_two"]["grades"]["passing_rate_percent"] == 50.0
    assert dashboard["kpis"]["overall_completion_rate"] == 66.7
    assert dashboard["details"]["grade_details"]["unavailable_grade_count"] == 1
    assert len(dashboard["details"]["top_performers"]) == 2
    assert dashboard["phase_two"]["late_submissions"]["late_rate_percent"] == 9.1
    seed.print_counts(*result, apply=True)
    output = capsys.readouterr().out
    assert "grade_coverage 2/3" in output
    assert "current_grade_average 82.5" in output
    assert "passing 1/2 50.0%" in output
    assert "completion 12/18 66.7%" in output
    assert "this_month_attendance 8/10 80.0%" in output
    assert "late_submissions 1/11 9.1%" in output
    assert "No subject at threshold 85" in output
    assert "Skipped scenarios" in output
    assert "Synthetic" not in output
    assert all(str(learner_id(i)) not in output for i in range(1,20))


@pytest.mark.parametrize("arguments,staff,period", [
    ([], None, None), (["--teacher-staff-id",STAFF], STAFF, None),
    (["--academic-period-id","1"], None, 1),
])
def test_cli_defaults_to_discovery_and_preserves_partial_overrides(monkeypatch, arguments, staff, period):
    """Mocked-behavior: parse only, engine and seeding fully mocked."""
    engine, conn = MagicMock(), MagicMock()
    engine.connect.return_value.__enter__.return_value = conn
    conn.execute.return_value.scalar_one.return_value = "entervene_preview"
    monkeypatch.setattr(seed, "guarded_engine", lambda _env: engine)
    monkeypatch.setattr(seed, "install_statement_guard", lambda *_a, **_k: "guard")
    monkeypatch.setattr(seed.event, "remove", MagicMock())
    core = MagicMock(return_value=("plan", Counter(), Counter()))
    monkeypatch.setattr(seed, "seed_connection", core)
    monkeypatch.setattr(seed, "print_counts", MagicMock())
    assert seed.main(["--dry-run", *arguments], environ={}) == 0
    assert core.call_args.args[1:3] == (staff,period)


def test_unknown_refusal_code_and_sensitive_details_are_never_printed(capsys):
    """Unit: neither arbitrary error codes nor non-integer count fields leak."""
    seed.print_refusal(seed.SeedError("PRIVATE_EXCEPTION_TEXT", enrolled_learners="PRIVATE_NAME", sql="PRIVATE_SQL"))
    assert capsys.readouterr().out == "ERROR preview_seed_failed: The operation failed; connection and database details were suppressed.\n"


def test_multi_subject_scenario_requires_distinct_subjects_not_extra_classes():
    """Validator-unit: repeat classes in one subject are not two subjects."""
    entries = [(class_id, 1, learner_id(index))
               for class_id in (1, 2) for index in (1, 2)]
    _, included, skipped = seed.plan_scenarios(entries, {1: Decimal(83)})
    assert "multi_subject_learner" not in included
    assert next(s for s in skipped if s.code == "multi_subject_learner").reason == "no_multi_subject_learner"


def test_no_discovery_candidate_has_separate_reason_and_count(preview, capsys):
    """Mocked-behavior: no eligible dates emits neither input IDs nor names."""
    engine, data = preview
    with engine.connect() as conn:
        with pytest.raises(seed.SeedError, match="no_teacher_period_candidate") as caught:
            seed.seed_connection(conn, None, None, NOW.replace(year=2028), apply=False)
    seed.print_refusal(caught.value)
    assert capsys.readouterr().out == (
        "ERROR no_teacher_period_candidate: No assigned teacher/period pair covers this Manila month through today.\n"
        "candidate_pairs 0\n"
    )


def test_auto_discovery_dry_run_is_select_only_and_selects_no_names(preview):
    """Mocked-behavior: real SQLite dry-run with statement guard and SQL capture."""
    engine, data = preview
    statements = []
    def capture(_conn, _cursor, statement, *_args):
        statements.append(statement)
    with engine.connect() as conn:
        guard = seed.install_statement_guard(conn, dry_run=True)
        event.listen(conn, "before_cursor_execute", capture)
        try:
            plan, _, _ = seed.seed_connection(conn, None, None, NOW, apply=False)
        finally:
            event.remove(conn, "before_cursor_execute", capture)
            event.remove(conn, "before_cursor_execute", guard)
    assert (plan.staff_id, plan.period_id) == (STAFF, data.period)
    assert all(statement.lstrip().upper().startswith("SELECT ") for statement in statements)
    discovery_selects = [sql.split("FROM", 1)[0] for sql in statements[:2]]
    assert all(field not in sql for sql in discovery_selects
               for field in ("first_name", "last_name", "student_lrn", "email", "password"))

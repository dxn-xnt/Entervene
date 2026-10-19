"""PR 1a consumer contracts on isolated SQLite; no live database or HTTP.

85/83 are deliberately configurable test policies, NOT migration defaults
(Core 87, Applied/Specialized 85). Corrupt-context tests inject configuration
only: authorization and the shared resolver decisions are never mocked.
"""
from contextlib import contextmanager
from dataclasses import replace
from datetime import date
from decimal import Decimal
import re
from unittest.mock import Mock
import uuid

import openpyxl
import pytest
from sqlalchemy import event, select
from sqlalchemy.dialects import postgresql
from sqlalchemy.sql import quoted_name

from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.models.settings.Setting import Setting
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.StudentRecord import BulkSendGradesRequest
from app.services.activity import AnalyticsService
from app.services.activity import TeacherDashboardMetrics as metrics
from app.services.export import ClassRecordExportService as exports
from app.services.export import SF9ExportService as sf9
from app.services.grading import PassingThresholdReader as reader
from app.services.grading.PassingThresholdResolver import TemplateThresholdConfig
from app.services.prediction import PredictionOutcomeService as outcomes
from app.services.student_record import StudentRecordService as records
from tests.test_teacher_dashboard_health import db, data  # noqa: F401; isolated fixtures
from tests.test_send_grades_to_adviser import adviser_send_context  # noqa: F401
from tests import test_teacher_dashboard_postgres as pg_guard
from tests.test_teacher_dashboard_postgres import postgres_dashboard_session  # noqa: F401


@contextmanager
def capture_sql(db):
    statements = []

    def record(connection, cursor, statement, parameters, context, executemany):
        statements.append(statement)

    event.listen(db.get_bind(), "before_cursor_execute", record)
    try:
        yield statements
    finally:
        event.remove(db.get_bind(), "before_cursor_execute", record)


_SQL_IDENTIFIER = r'(?:"(?:[^"]|"")*"|[a-z_][a-z0-9_$]*)'


def _table_ref(table_name):
    table = rf'(?:"{table_name}"|{table_name})'
    return rf'(?:{_SQL_IDENTIFIER}\s*\.\s*)?{table}'


def _column_ref(table_name, column_name):
    column = rf'(?:"{column_name}"|{column_name})'
    return rf'{_table_ref(table_name)}\s*\.\s*{column}'


def _policy_selects(statements):
    """Count configuration projections, not existing gradebook/roster queries."""
    result = []
    for statement in statements:
        sql = " ".join(statement.lower().split())
        year_projection = re.match(
            rf'^select\s+{_column_ref("academic_year", "academic_year_id")}\s+'
            rf'from\s+{_table_ref("academic_year")}(?:\s|$)', sql)
        setting_projection = re.match(
            rf'^select\s+{_column_ref("setting", "value")}\s+'
            rf'from\s+{_table_ref("setting")}(?:\s|$)', sql)
        subject_projection = (
            sql.startswith("select ")
            and re.search(rf'\sfrom\s+{_table_ref("subject")}(?:\s|$)', sql)
            and re.search(rf'\sleft outer join\s+{_table_ref("grading_template")}\s+on\s+', sql)
            and re.search(_column_ref("subject", "subject_id"), sql)
            and re.search(_column_ref("subject", "grading_template_id"), sql)
            and re.search(
                rf'{_column_ref("grading_template", "grading_template_id")}\s+'
                rf'as\s+(?:"linked_template_id"|linked_template_id)', sql)
            and re.search(_column_ref("grading_template", "passing_threshold"), sql)
        )
        if year_projection or setting_projection or subject_projection:
            result.append(statement)
    return result


def _compiled_policy_selects(schema=None):
    statements = [
        select(AcademicYear.academic_year_id).where(AcademicYear.academic_year_id == 1),
        select(
            Subject.subject_id,
            Subject.grading_template_id,
            GradingTemplate.grading_template_id.label("linked_template_id"),
            GradingTemplate.passing_threshold,
        ).outerjoin(
            GradingTemplate,
            Subject.grading_template_id == GradingTemplate.grading_template_id,
        ).where(Subject.subject_id.in_([1, 2])),
        select(Setting.value).where(Setting.key == "general_average_passing_grade"),
    ]
    dialect = postgresql.dialect()
    result = []
    for statement in statements:
        kwargs = {"schema_translate_map": {None: schema}} if schema is not None else {}
        sql = str(statement.compile(dialect=dialect, **kwargs))
        if schema is not None:
            # Execution normally performs this final schema-token rendering.
            # Do it connection-free so both quoted and unquoted forms are tested.
            sql = sql.replace(
                "__[SCHEMA__none]",
                dialect.identifier_preparer.quote_schema(schema),
            )
        result.append(sql)
    return result


@pytest.mark.parametrize(
    "schema",
    [None, "dashboard_test_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
     quoted_name("dashboard-test-quoted", True)],
    ids=["unqualified", "schema-qualified", "quoted-schema"],
)
def test_policy_select_counter_recognizes_three_postgresql_compiled_queries(schema):
    statements = _compiled_policy_selects(schema)
    assert len(_policy_selects(statements)) == 3


def test_policy_select_counter_rejects_unrelated_queries_even_with_similar_names():
    unrelated = [
        str(select(AcademicYear.year_label).compile(dialect=postgresql.dialect())),
        str(select(Setting.key).compile(dialect=postgresql.dialect())),
        str(select(Subject.subject_id).compile(dialect=postgresql.dialect())),
        'SELECT other.value AS linked_template_id FROM other',
    ]
    assert _policy_selects(unrelated) == []


def _prediction(db, data, revision=1):
    prediction = AIPrediction(
        student_id=data["students"]["active_one"].student_id,
        class_id=data["class_"].class_id, subject_id=data["subject"].subject_id,
        source_period_id=data["previous_period"].academic_period_id,
        target_period_id=data["period"].academic_period_id,
        predicted_period_grade=Decimal("84.00"), revision=revision,
        risk_level="LOW_RISK", data_status="SUFFICIENT")
    db.add(prediction)
    db.flush()
    return prediction


def _final_grades(db, data, grade=Decimal("84.00")):
    db.add(SubjectLoad(staff_id=data["teacher"].staff_id,
        class_id=data["class_"].class_id, subject_id=data["subject"].subject_id,
        academic_period_id=data["empty_period"].academic_period_id,
        status="published", is_active_version=True))
    result = None
    for name in ("active_one", "active_two"):
        for period in (data["previous_period"], data["period"], data["empty_period"]):
            row = StudentPeriodGrade(student_id=data["students"][name].student_id,
                class_id=data["class_"].class_id, subject_id=data["subject"].subject_id,
                academic_period_id=period.academic_period_id,
                final_period_grade=grade, transmuted_grade=grade, is_finalized=True)
            db.add(row)
            if name == "active_one" and period == data["period"]:
                result = row
    db.commit()
    return result


def _summary(db, data, **kwargs):
    return records.teacher_term_grade_summary(db, data["teacher"].staff_id,
        data["class_"].class_id, data["subject"].subject_id,
        academic_year_id=kwargs.pop("year", data["year"].academic_year_id), **kwargs)


def _dashboard(db, data):
    return AnalyticsService.build_teacher_dashboard_health(
        db, data["teacher"].staff_id, data["period"])


def _export(db, data, *, summary=True, staff=None, year=None):
    wb = openpyxl.Workbook()
    if summary:
        ws = exports.generate_summary_of_grades_sheet(wb, db, data["class_"].class_id,
            data["subject"].subject_id,
            academic_year_id=data["year"].academic_year_id if year is None else year,
            staff_id=staff or data["teacher"].staff_id)
    else:
        ws = exports.generate_class_record_sheet(wb, db, data["class_"].class_id,
            data["subject"].subject_id, data["period"].academic_period_id,
            staff_id=staff or data["teacher"].staff_id)
    return ws


@pytest.mark.parametrize("threshold,grade,passed", [
    ("85", "84", False), ("83", "84", True),  # configurable 85/83 fixture
    ("87", "84", False), ("85", "84", False),  # migration values, unchanged
    ("84.91", "84.90", False), ("84.90", "84.90", True),
], ids=["configured-85", "configured-83", "migration-core-87", "migration-applied-85",
        "decimal-below", "decimal-equal"])
@pytest.mark.parametrize("active", [True, False], ids=["active-open", "inactive-open"])
def test_template_policy_agrees_across_dashboard_summary_export_and_outcome(
    db, data, threshold, grade, passed, active,
):
    mark, number = Decimal(threshold), Decimal(grade)
    data["subject"].grading_template.passing_threshold = mark
    data["year"].is_active = active
    if not active:
        for key in ("period", "previous_period", "empty_period"):
            data[key].is_active = False
        db.add(AcademicYear(year_label="2030-2031", start_date=date(2030, 6, 1),
                            end_date=date(2031, 5, 31), is_active=True))
    prediction = _prediction(db, data)
    period_grade = _final_grades(db, data, number)
    context = reader.read_passing_threshold_context(db,
        academic_year_id=data["year"].academic_year_id, subject_ids=[data["subject"].subject_id])
    policy = reader.require_subject_passing_threshold(db,
        academic_year_id=data["year"].academic_year_id,
        subject_id=data["subject"].subject_id, context=context)
    dashboard = _dashboard(db, data)["phase_two"]["grades"]
    summary = _summary(db, data)
    row = next(s for s in summary.students
               if s.student_id == str(data["students"]["active_one"].student_id))
    ws = _export(db, data)
    name_row = next(r for r in range(12, ws.max_row + 1) if ws.cell(r, 2).value == row.name)
    remark_col = next(c.column for c in ws[10] if c.value == "REMARKS")
    final_col = next(c.column for c in ws[10] if c.value == "FINAL GRADE")
    result = outcomes.evaluate_prediction_outcome(
        db, prediction.prediction_id, period_grade.final_period_grade)
    assert policy.source == "live_grading_template" and policy.threshold == mark
    assert policy.grading_template_id == data["subject"].grading_template_id
    assert Decimal(str(dashboard["passing_threshold"])) == mark
    assert Decimal(str(summary.passing_threshold)) == mark
    assert dashboard["passing_count"] == (2 if passed else 0)
    assert row.remark == ws.cell(name_row, remark_col).value == ("PASSED" if passed else "FAILED")
    assert row.final_grade == ws.cell(name_row, final_col).value == float(number)
    assert result["actual_passed"] is passed
    assert period_grade.final_period_grade == number
    assert data["subject"].grading_template.passing_threshold == mark


def test_stored_decimal_comparison_precedes_dashboard_display_rounding(db, data):
    prediction = _prediction(db, data)
    grade = _final_grades(db, data, Decimal("84.99"))
    result = _dashboard(db, data)["phase_two"]["grades"]
    assert result["current_grade"] == 85.0  # display rounding only
    assert result["passing_count"] == 0 and result["current_grade_meets_threshold"] is False
    outcome = outcomes.evaluate_prediction_outcome(db, prediction.prediction_id, grade.final_period_grade)
    assert outcome["actual_passed"] is False
    # Preserve the DIFFERENT existing annual-summary calculation: mean rounded
    # to one decimal is the numeric annual grade, not a stored period grade.
    annual = _summary(db, data)
    row = next(r for r in annual.students if r.student_id == str(grade.student_id))
    assert row.final_grade == 85.0 and row.remark == "PASSED"


@pytest.mark.parametrize("year", [0, True, 999999])
def test_explicit_invalid_year_never_falls_back_to_active_year(db, data, year):
    for call in (lambda: _summary(db, data, year=year),
                 lambda: _export(db, data, year=year)):
        with pytest.raises(records.HTTPException) as caught:
            call()
        assert caught.value.status_code == 422


def test_authorization_happens_before_policy_lookup(db, data, monkeypatch):
    probe = Mock(side_effect=AssertionError("Do not expose policy to unauthorized callers"))
    monkeypatch.setattr(records, "require_subject_passing_threshold", probe)
    with pytest.raises(records.HTTPException) as caught:
        records.teacher_term_grade_summary(db, data["empty_teacher"].staff_id,
            data["class_"].class_id, data["subject"].subject_id)
    assert caught.value.status_code == 403
    probe.assert_not_called()


@pytest.mark.parametrize("summary", [True, False])
def test_real_unassigned_teacher_cannot_export(db, data, summary):
    with pytest.raises(records.HTTPException) as caught:
        _export(db, data, summary=summary, staff=data["empty_teacher"].staff_id)
    assert caught.value.status_code == 403


@pytest.mark.parametrize("summary", [True, False], ids=["summary", "term"])
@pytest.mark.parametrize("status", [401, 403, 404, 422, 500])
def test_export_does_not_swallow_authorization_or_configuration_errors(db, data, monkeypatch, summary, status):
    error = records.HTTPException(status_code=status, detail={"code": "synthetic_failure"})
    name = "teacher_term_grade_summary" if summary else "teacher_student_gradebook"
    monkeypatch.setattr(exports, name, Mock(side_effect=error))
    with pytest.raises(records.HTTPException) as caught:
        _export(db, data, summary=summary)
    assert caught.value is error


def test_unstarted_term_layout_still_requires_authorized_scope(db, data):
    db.add(SubjectLoad(
        staff_id=data["teacher"].staff_id,
        class_id=data["class_"].class_id,
        subject_id=data["subject"].subject_id,
        academic_period_id=data["empty_period"].academic_period_id,
        status="published",
        is_active_version=True,
    ))
    db.commit()
    ws = exports.generate_class_record_sheet(openpyxl.Workbook(), db,
        data["class_"].class_id, data["subject"].subject_id,
        data["empty_period"].academic_period_id, staff_id=data["teacher"].staff_id)
    assert ws.title == data["empty_period"].period_name
    with pytest.raises(records.HTTPException):
        exports.generate_class_record_sheet(openpyxl.Workbook(), db,
            data["class_"].class_id, data["subject"].subject_id,
            data["empty_period"].academic_period_id, staff_id=data["empty_teacher"].staff_id)


@pytest.mark.parametrize("problem", ["missing_template", "invalid_threshold"])
def test_bad_configuration_is_explicit_and_never_mutates_grades(db, data, monkeypatch, problem):
    prediction = _prediction(db, data)
    grade = _final_grades(db, data)
    year_id, sid = data["year"].academic_year_id, data["subject"].subject_id
    good = reader.read_passing_threshold_context(db, academic_year_id=year_id, subject_ids=[sid])
    bad = replace(good, grading_templates={} if problem == "missing_template" else {
        data["subject"].grading_template_id: TemplateThresholdConfig(
            data["subject"].grading_template_id, Decimal("NaN"))})
    # Mock only the corrupt configuration projection; exercise real resolver,
    # authorization, gradebook and export code against the isolated database.
    monkeypatch.setattr(reader, "read_passing_threshold_context", lambda *a, **k: bad)
    code = "grading_template_missing" if problem == "missing_template" else "passing_threshold_invalid"
    before, prediction_id = grade.final_period_grade, prediction.prediction_id
    calls = [lambda: _summary(db, data), lambda: _export(db, data),
             lambda: _export(db, data, summary=False),
             lambda: outcomes.evaluate_prediction_outcome(db, prediction_id, before),
             lambda: records.finalize_student_period_grade(db, grade.period_grade_id, final_period_grade=90)]
    with capture_sql(db) as sql:
        for call in calls:
            with pytest.raises(records.HTTPException) as caught:
                call()
            assert caught.value.status_code == 422 and caught.value.detail["code"] == code
        dashboard = _dashboard(db, data)["phase_two"]["grades"]
    assert dashboard["passing_count"] is None and dashboard["warnings"]
    assert grade.final_period_grade == before and not db.dirty and not db.new
    assert all(s.lstrip().upper().startswith("SELECT") for s in sql)


@pytest.mark.parametrize("operation", ["dashboard", "summary", "term_export", "summary_export", "full_export"])
def test_clean_session_reads_and_exports_do_not_commit_or_write(db, data, monkeypatch, operation):
    _final_grades(db, data)
    forbidden = Mock(side_effect=AssertionError("A read/export attempted a write"))
    # A SQLAlchemy no-op autoflush is not a database write. SQL capture below
    # verifies the actual read/export SQL; dirty-session protections are tested
    # separately for the policy reader and dashboard.
    for method in ("add", "add_all", "delete", "commit"):
        monkeypatch.setattr(db, method, forbidden)
    with capture_sql(db) as sql:
        if operation == "dashboard":
            _dashboard(db, data)
        elif operation == "summary":
            _summary(db, data)
        elif operation == "full_export":
            exports.export_class_record_full_workbook(db, data["class_"].class_id,
                data["subject"].subject_id, academic_year_id=data["year"].academic_year_id,
                staff_id=data["teacher"].staff_id)
        else:
            _export(db, data, summary=operation == "summary_export")
    forbidden.assert_not_called()
    assert sql and all(s.lstrip().upper().startswith("SELECT") for s in sql)
    assert len(_policy_selects(sql)) == (12 if operation == "full_export" else 3)
    assert not db.new and not db.dirty


def test_outcome_batch_policy_queries_are_constant_and_writes_are_outcomes_only(db, data):
    first = _prediction(db, data)
    grade = _final_grades(db, data)
    grade_id = grade.period_grade_id

    def measure():
        db.expire_all()
        with capture_sql(db) as sql:
            result = outcomes.evaluate_outcomes_for_finalized_period_grade(db, grade_id, commit=False)
        return result, sql

    small, small_sql = measure()
    db.commit()
    for revision in range(2, 22):
        _prediction(db, data, revision)
    db.commit()
    large, large_sql = measure()
    assert small["evaluated_count"] == 1 and large["evaluated_count"] == 21
    assert len(_policy_selects(small_sql)) == len(_policy_selects(large_sql)) == 3
    assert sum(s.lstrip().upper().startswith("SELECT") for s in small_sql) == 7
    assert sum(s.lstrip().upper().startswith("SELECT") for s in large_sql) == 7
    writes = [s for s in large_sql if not s.lstrip().upper().startswith("SELECT")]
    assert writes and all("prediction_outcome" in s.lower() for s in writes)
    assert db.get(StudentPeriodGrade, grade_id).final_period_grade == Decimal("84.00")
    assert first.predicted_period_grade == Decimal("84.00")
    assert db.query(PredictionOutcome).count() == 21


def test_dashboard_policy_queries_stay_three_as_roster_grows(db, data):
    with capture_sql(db) as small:
        _dashboard(db, data)
    class_id, year_id = data["class_"].class_id, data["year"].academic_year_id
    for index in range(25):
        student = Student(student_id=uuid.uuid4(), student_lrn=f"{9000 + index:012d}",
                          first_name="Policy", last_name=f"Fixture {index}")
        db.add(student)
        db.flush()
        db.add(StudentClass(student_id=student.student_id, class_id=class_id,
                            academic_year_id=year_id, enrollment_status="enrolled"))
    db.commit()
    db.expire_all()
    with capture_sql(db) as large:
        _dashboard(db, data)
    assert len(_policy_selects(small)) == len(_policy_selects(large)) == 3


def test_bulk_grade_send_shares_policy_context_as_students_grow(adviser_send_context):
    ctx = adviser_send_context
    db = ctx["db"]
    staff_id, class_id, subject_id, period_id = (
        ctx["teacher"].staff_id, ctx["class"].class_id,
        ctx["subject"].subject_id, ctx["period"].academic_period_id)
    db.expire_all()
    with capture_sql(db) as small:
        first = records.bulk_send_grades_to_adviser(
            db, staff_id, class_id, subject_id, period_id, BulkSendGradesRequest())
    assert first.newly_sent_count == 1 and first.incomplete_skipped_count == 1
    assignments = [ctx[key].classwork_assignment_id for key in ("ca_ww", "ca_pt", "ca_qa")]
    for index in range(20):
        student = Student(student_id=uuid.uuid4(), student_lrn=f"{8000 + index:012d}",
                          first_name="Bulk", last_name=f"Fixture {index}")
        db.add(student)
        db.flush()
        db.add(StudentClass(student_id=student.student_id, class_id=class_id,
            academic_year_id=ctx["class"].academic_year_id, enrollment_status="enrolled"))
        db.add_all([StudentSubmission(student_id=student.student_id,
            classwork_assignment_id=assignment, grade=Decimal("80"), status="graded")
            for assignment in assignments])
    db.commit()
    db.expire_all()
    with capture_sql(db) as large:
        second = records.bulk_send_grades_to_adviser(
            db, staff_id, class_id, subject_id, period_id, BulkSendGradesRequest())
    assert second.newly_sent_count == 20 and second.unchanged_skipped_count == 1
    assert second.incomplete_skipped_count == 1
    assert len(_policy_selects(small)) == len(_policy_selects(large)) == 3


def test_next_consumer_request_uses_subject_template_fk_not_name_or_cache(db, data):
    prediction = _prediction(db, data)
    grade = _final_grades(db, data)
    before = _dashboard(db, data)["phase_two"]["grades"]
    assert before["passing_count"] == 0
    template = GradingTemplate(template_name="Explicit alternate fixture", passing_threshold=Decimal("83"), status="active")
    template.components = [GradingTemplateComponent(component_name=name, weight=weight, display_order=i)
        for i, (name, weight) in enumerate((("Written Work", 20), ("Performance Tasks", 50), ("Exams", 30)), 1)]
    db.add(template)
    db.flush()
    data["subject"].grading_template_id = template.grading_template_id
    db.commit()
    db.expire_all()
    after = _dashboard(db, data)["phase_two"]["grades"]
    assert after["passing_count"] == 2 and after["passing_threshold"] == 83.0
    assert all(row.remark == "PASSED" for row in _summary(db, data).students)
    assert outcomes.evaluate_prediction_outcome(db, prediction.prediction_id,
        grade.final_period_grade)["actual_passed"] is True


@pytest.mark.parametrize("autoflush", [False, True])
def test_dashboard_context_ignores_pending_template_fk_without_flushing(db, data, autoflush):
    committed_template_id = data["subject"].grading_template_id
    year_id = data["year"].academic_year_id
    subject_id = data["subject"].subject_id
    alternate = GradingTemplate(
        template_name="Pending alternate fixture",
        passing_threshold=Decimal("83"),
        status="active",
    )
    db.add(alternate)
    db.commit()
    data["subject"].grading_template_id = alternate.grading_template_id
    db.autoflush = autoflush

    with capture_sql(db) as sql:
        # Production dashboard entry points wrap both the bulk reader and pure
        # adapter in no_autoflush; mirror that complete read boundary here.
        with db.no_autoflush:
            context = reader.read_passing_threshold_context(
                db,
                academic_year_id=year_id,
                subject_ids=[subject_id],
            )
            result = metrics.resolve_dashboard_passing_threshold(
                data["subject"], context=context)

    assert result.grading_template_id == committed_template_id
    assert result.passing_threshold == 85.0
    assert data["subject"] in db.dirty
    assert len(_policy_selects(sql)) == 3
    assert all(statement.lstrip().upper().startswith("SELECT") for statement in sql)


def test_sf9_official_compatibility_is_separate_from_school_policy(db, data):
    from docx import Document
    from app.services.export.SF9DocxExportService import export_student_sf9_docx
    data["class_"].adviser_staff_id = data["teacher"].staff_id
    data["subject"].grading_template.passing_threshold = Decimal("87")
    db.add(Setting(key="general_average_passing_grade", value="99", type="string"))
    grade = _final_grades(db, data)
    summary = _summary(db, data)
    assert next(r for r in summary.students if r.student_id == str(grade.student_id)).remark == "FAILED"
    data_args = dict(class_id=data["class_"].class_id, student_id=str(grade.student_id),
                     staff_id=data["teacher"].staff_id)
    with capture_sql(db) as sql:
        preview = sf9.gather_student_sf9_data(db, **data_args)
        # Existing XLSX service takes a UUID; preview/DOCX take its text form.
        wb = openpyxl.load_workbook(sf9.export_student_sf9(db,
            **{**data_args, "student_id": grade.student_id}))
        doc = Document(export_student_sf9_docx(db, **data_args))
    subject = next(s for s in preview["learning_areas"]["core"] if s["subject_id"] == data["subject"].subject_id)
    assert subject["final_grade"] == 84.0 and subject["remarks"] == "Passed"
    ws = wb.active
    r = next(c.row for row in ws.iter_rows() for c in row if c.value == data["subject"].subject_name)
    assert [c.value for c in ws[r] if c.value is not None][-1] == "Passed"
    # The official two-panel document nests its learning-area table inside a
    # layout cell; Document.tables exposes only the outer layout table.
    doc_row = next(row for row in doc.element.xpath(".//w:tr")
        if any(node.text == data["subject"].subject_name
               for node in row.xpath("./w:tc/w:p/w:r/w:t")))
    last_cell = doc_row.xpath("./w:tc")[-1]
    assert "".join(node.text or "" for node in last_cell.xpath(".//w:t")) == "Passed"
    assert preview["general_average"]["remarks"] == "Passed"
    assert [(d["scale"], d["remarks"]) for d in preview["descriptors"]] == [
        ("90-100", "Passed"), ("80-89", "Passed"), ("75-79", "Passed"),
        ("65-74", "Failed"), ("0-64", "Failed")]
    assert all(s.lstrip().upper().startswith("SELECT") for s in sql)


@pytest.mark.parametrize("case", ["configured-85", "configured-83", "migration-core-87", "inactive-open", "outcome-batch"])
def test_passing_threshold_consumers_execute_on_guarded_postgres(postgres_dashboard_session, monkeypatch, case):
    """Opt-in parity in an owned UUID schema; never a preview/public schema.

    Use the existing strict activity_test target guard. Unset target skips in
    fixture setup, before connecting. Driver/constraint parity is NOT established
    by our SQLite run. Query errors retain only sanitized exception-class output.
    """
    from tests.test_teacher_dashboard_health import NOW, seed_dashboard_data

    db = postgres_dashboard_session
    monkeypatch.setattr(AnalyticsService, "_teacher_dashboard_now", lambda: NOW)
    try:
        data = seed_dashboard_data(db)
        if case == "outcome-batch":
            test_outcome_batch_policy_queries_are_constant_and_writes_are_outcomes_only(db, data)
        else:
            threshold = {"configured-85": "85", "configured-83": "83",
                         "migration-core-87": "87", "inactive-open": "83"}[case]
            test_template_policy_agrees_across_dashboard_summary_export_and_outcome(
                db, data, threshold, "84", threshold == "83", case != "inactive-open")
    except Exception as error:
        pytest.fail(pg_guard._safe_failure("Passing-threshold consumer parity", error), pytrace=False)

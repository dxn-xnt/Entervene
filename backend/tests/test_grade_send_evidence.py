"""Real SQLite send endpoints: every-item evidence, configuration, no writes on skips."""
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch

import pytest
from sqlalchemy import event

from app.models.attendance.Attendance import AttendanceRecord
from app.models.academic.GradeSubmissionLog import GradeSubmissionLog
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.student_record.StudentRecordService import teacher_student_gradebook
from tests.test_send_grades_to_adviser import adviser_send_context, _make_client, _add_grade_scope_comparison_work


def _send(ctx, kind, *, student="student2", force=False, **extra):
    prefix = f"/api/v1/student-records/teacher/classes/{ctx['class'].class_id}/subjects/{ctx['subject'].subject_id}"
    if kind == "single":
        url = f"{prefix}/students/{ctx[student].student_id}/send-to-adviser"
        payload = {"academic_period_id": ctx["period"].academic_period_id, "force_resend": force}
    else:
        url = f"{prefix}/periods/{ctx['period'].academic_period_id}/send-to-adviser"
        payload = {"force_resend_all": force}
    return _make_client(ctx["db"], ctx["user"]).post(url, json={**payload, **extra})


def _entry(response, ctx, kind, student="student2"):
    data = response.json()
    return data if kind == "single" else next(
        row for row in data["entries"] if row["student_id"] == str(ctx[student].student_id)
    )


@contextmanager
def _forbid_writes(db):
    """Prove skipped-only requests execute no DML, flush writes or commit."""
    def inspect_sql(_connection, _cursor, statement, _parameters, _context, _many):
        assert statement.lstrip().split(None, 1)[0].upper() not in {"INSERT", "UPDATE", "DELETE"}, statement
    def reject_flush(_session, _context, _instances):
        pytest.fail("A rejected/skipped-only request attempted to flush writes")
    engine = db.get_bind()
    event.listen(engine, "before_cursor_execute", inspect_sql)
    event.listen(db, "before_flush", reject_flush)
    try:
        with patch.object(db, "commit", side_effect=AssertionError("A skipped-only request attempted a commit")):
            yield
    finally:
        event.remove(engine, "before_cursor_execute", inspect_sql)
        event.remove(db, "before_flush", reject_flush)


@pytest.mark.parametrize("kind", ["single", "bulk"])
@pytest.mark.parametrize("force", [False, True])
@pytest.mark.parametrize("evidence", ["none", "partial"])
def test_incomplete_send_cannot_write_even_with_force(adviser_send_context, kind, force, evidence):
    ctx = adviser_send_context
    db = ctx["db"]
    # Both learners are incomplete so a bulk request cannot legitimately write.
    for score in db.query(StudentSubmission).all():
        if score.student_id == ctx["student1"].student_id or evidence == "none":
            score.grade = None
    db.commit()
    with _forbid_writes(db):
        expected = ({"expected_transmuted_grade": 99} if kind == "single" else {
            "expected_student_grades": {str(ctx["student2"].student_id): 99},
        })
        response = _send(ctx, kind, force=force, **expected)
    if kind == "single":
        assert response.status_code == 422, response.text
        detail = response.json()["detail"]
        assert detail["code"] == "grade_send_incomplete"
        missing = detail["missing_components"]
    else:
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["newly_sent_count"] == 0
        assert data["incomplete_skipped_count"] == 2
        assert data["finalized_at"] is None
        assert data["message"] == "No grades were sent."
        assert "incomplete_warning_count" not in data
        skipped = _entry(response, ctx, kind)
        assert skipped["status"] == "skipped_incomplete"
        assert skipped["skip_reason"] == "grade_send_incomplete"
        assert skipped["final_period_grade"] is None
        assert skipped["finalized_at"] is None
        missing = skipped["incomplete_components"]
    assert missing == (["written_work", "performance_task", "quarterly_assessment"] if evidence == "none"
                       else ["performance_task", "quarterly_assessment"])
    assert db.query(StudentPeriodGrade).count() == 0
    assert db.query(GradeSubmissionLog).count() == 0


@pytest.mark.parametrize("kind", ["single", "bulk"])
@pytest.mark.parametrize("force", [False, True])
def test_skip_preserves_previously_finalized_grade_and_log(adviser_send_context, kind, force):
    ctx = adviser_send_context
    db = ctx["db"]
    manual = _send(ctx, "single", final_period_grade=88)
    assert manual.status_code == 200, manual.text
    stored = db.query(StudentPeriodGrade).filter_by(student_id=ctx["student2"].student_id).one()
    snapshot = {column.name: getattr(stored, column.name) for column in StudentPeriodGrade.__table__.columns}
    previous_log_id = db.query(GradeSubmissionLog).one().id
    for score in db.query(StudentSubmission).all():
        score.grade = None
    db.commit()
    with _forbid_writes(db):
        response = _send(ctx, kind, force=force)
    assert response.status_code == (422 if kind == "single" else 200), response.text
    db.refresh(stored)
    assert {column.name: getattr(stored, column.name) for column in StudentPeriodGrade.__table__.columns} == snapshot
    assert db.query(GradeSubmissionLog).one().id == previous_log_id


@pytest.mark.parametrize("kind", ["single", "bulk"])
def test_scored_zero_in_every_component_sends_sixty(adviser_send_context, kind):
    ctx = adviser_send_context
    db = ctx["db"]
    for score in db.query(StudentSubmission).filter_by(student_id=ctx["student1"].student_id):
        score.grade = Decimal("0")
    db.commit()
    response = _send(ctx, kind, student="student1")
    assert response.status_code == 200, response.text
    sent = _entry(response, ctx, kind, "student1")
    assert sent["status"] == "newly_sent"
    assert sent["initial_grade"] == 0
    assert sent["transmuted_grade"] == 60  # Independent Task4G floor.
    assert sent["final_period_grade"] == 60
    assert sent["incomplete_components"] == []


@pytest.mark.parametrize("manual_grade", [0, 87.5])
@pytest.mark.parametrize("configured", [True, False])
def test_explicit_manual_override_survives_missing_evidence_and_configuration(
    adviser_send_context, manual_grade, configured,
):
    ctx = adviser_send_context
    db = ctx["db"]
    for score in db.query(StudentSubmission).all():
        score.grade = None
    if not configured:
        for template in db.query(GradingTemplate).all():
            template.status = "archived"
    db.commit()
    response = _send(ctx, "single", final_period_grade=manual_grade)
    assert response.status_code == 200, response.text
    assert response.json()["final_period_grade"] == manual_grade
    assert response.json()["is_finalized"] is True
    assert float(db.query(StudentPeriodGrade).one().final_period_grade) == manual_grade


@pytest.mark.parametrize("kind", ["single", "bulk"])
@pytest.mark.parametrize("missing_component", ["ca_ww", "ca_pt", "ca_qa"])
def test_required_category_with_uncomputable_percentage_is_blocked(adviser_send_context, kind, missing_component):
    ctx = adviser_send_context
    db = ctx["db"]
    # A raw score exists, but zero possible points makes its PS uncomputable.
    ctx[missing_component].classwork.total_points = Decimal("0")
    db.commit()
    response = _send(ctx, kind, student="student1", force=True)
    assert response.status_code == (422 if kind == "single" else 200), response.text
    missing = (response.json()["detail"]["missing_components"] if kind == "single"
               else _entry(response, ctx, kind, "student1")["incomplete_components"])
    assert {"ca_ww": "written_work", "ca_pt": "performance_task", "ca_qa": "quarterly_assessment"}[missing_component] in missing
    assert db.query(StudentPeriodGrade).filter_by(student_id=ctx["student1"].student_id).count() == 0
    assert db.query(GradeSubmissionLog).filter_by(student_id=ctx["student1"].student_id).count() == 0


@pytest.mark.parametrize("kind", ["single", "bulk"])
def test_only_actual_configured_categories_are_required(adviser_send_context, kind):
    ctx = adviser_send_context
    db = ctx["db"]
    template = db.get(GradingTemplate, int(ctx["subject"].default_grading_template))
    template.components.remove(next(c for c in template.components if c.component_name == "Exams"))
    for component in template.components:
        component.weight = Decimal("40" if component.component_name == "Written Works" else "60")
    for score in db.query(StudentSubmission).filter_by(classwork_assignment_id=ctx["ca_qa"].classwork_assignment_id):
        score.grade = None
    db.commit()
    response = _send(ctx, kind, student="student1")
    assert response.status_code == 200, response.text
    assert _entry(response, ctx, kind, "student1")["final_period_grade"] == 91


@pytest.mark.parametrize("kind", ["single", "bulk"])
def test_all_required_items_scored_sends_without_requiring_graded_status(adviser_send_context, kind):
    ctx = adviser_send_context
    db = ctx["db"]
    for score in db.query(StudentSubmission).filter_by(student_id=ctx["student1"].student_id):
        score.status = "submitted"  # Existing grade computation accepts a numeric score.
    db.commit()
    _add_grade_scope_comparison_work(ctx, "WRITTEN_WORK", None, "100", classwide_student1_score="0")
    book = teacher_student_gradebook(db, ctx["teacher"].staff_id, ctx["class"].class_id,
                                    ctx["subject"].subject_id, ctx["period"].academic_period_id)
    displayed = next(s for s in book.studentGrades if s.student_id == str(ctx["student1"].student_id))
    response = _send(ctx, kind, student="student1")
    assert response.status_code == 200, response.text
    assert _entry(response, ctx, kind, "student1")["final_period_grade"] == displayed.transmuted_grade


def _missing_detail(response, ctx, kind):
    assert response.status_code == (422 if kind == "single" else 200), response.text
    return response.json()["detail"] if kind == "single" else _entry(response, ctx, kind, "student1")


@pytest.mark.parametrize("kind", ["single", "bulk"])
@pytest.mark.parametrize("force", [False, True])
@pytest.mark.parametrize("blank_submission", [False, True], ids=["no-submission", "blank-score"])
def test_one_of_four_written_items_unscored_blocks_without_writes(
    adviser_send_context, kind, force, blank_submission,
):
    ctx = adviser_send_context
    for index in range(3):
        assignment = _add_grade_scope_comparison_work(
            ctx, "WRITTEN_WORK", None, "100",
            classwide_student1_score="90" if index < 2 else None,
        )
    assignment.classwork.title = "Fourth written item"
    # Future items are deliberately required; deadline passage is not a gate.
    assignment.due_date = datetime.now(timezone.utc) + timedelta(days=10)
    if blank_submission:
        ctx["db"].add(StudentSubmission(student_id=ctx["student1"].student_id,
            classwork_assignment_id=assignment.classwork_assignment_id, grade=None, status="submitted"))
    ctx["db"].commit()
    with _forbid_writes(ctx["db"]):
        response = _send(ctx, kind, student="student1", force=force)
    detail = _missing_detail(response, ctx, kind)
    assert detail["missing_item_count"] == 1
    assert detail["missing_items"] == [{
        "assignment_id": assignment.classwork_assignment_id,
        "title": "Fourth written item", "category": "Written Work",
        "due_date": assignment.due_date.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z"),
    }]
    categories = detail["missing_components"] if kind == "single" else detail["incomplete_components"]
    assert categories == ["written_work"]


@pytest.mark.parametrize("kind", ["single", "bulk"])
@pytest.mark.parametrize("category", ["WRITTEN_WORK", "PERFORMANCE_TASK", "QUARTERLY_ASSESSMENT"])
def test_each_configured_category_requires_every_item(adviser_send_context, kind, category):
    ctx = adviser_send_context
    assignment = _add_grade_scope_comparison_work(ctx, category, None, "100")
    response = _send(ctx, kind, student="student1")
    detail = _missing_detail(response, ctx, kind)
    assert detail["missing_item_count"] == 1
    assert detail["missing_items"][0]["assignment_id"] == assignment.classwork_assignment_id
    assert detail["missing_items"][0]["due_date"] is None
    assert ctx["db"].query(StudentPeriodGrade).filter_by(student_id=ctx["student1"].student_id).count() == 0


@pytest.mark.parametrize("kind", ["single", "bulk"])
@pytest.mark.parametrize("category", ["WRITTEN_WORK", "PERFORMANCE_TASK", "QUARTERLY_ASSESSMENT"])
@pytest.mark.parametrize("forged", [False, True])
def test_unscored_classmate_target_does_not_block_or_use_forged_score(
    adviser_send_context, kind, category, forged,
):
    ctx = adviser_send_context
    assignment = _add_grade_scope_comparison_work(ctx, category, "student2", "100", forged_score=forged)
    for score in ctx["db"].query(StudentSubmission).filter_by(classwork_assignment_id=assignment.classwork_assignment_id):
        if score.student_id == ctx["student2"].student_id:
            score.grade = None
    ctx["db"].commit()
    book = teacher_student_gradebook(ctx["db"], ctx["teacher"].staff_id, ctx["class"].class_id,
                                    ctx["subject"].subject_id, ctx["period"].academic_period_id)
    expected = next(row for row in book.studentGrades if row.student_id == str(ctx["student1"].student_id))
    response = _send(ctx, kind, student="student1")
    assert response.status_code == 200, response.text
    assert _entry(response, ctx, kind, "student1")["final_period_grade"] == expected.transmuted_grade


@pytest.mark.parametrize("kind", ["single", "bulk"])
@pytest.mark.parametrize("ignored", ["archived", "ungraded", "reading", "null-period", "other-period"])
def test_nonrequired_items_do_not_block(adviser_send_context, kind, ignored):
    ctx = adviser_send_context
    assignment = _add_grade_scope_comparison_work(ctx, "WRITTEN_WORK", None, "100")
    if ignored == "archived":
        assignment.classwork.is_archived = True
    elif ignored == "ungraded":
        assignment.classwork.is_graded = False
    elif ignored == "reading":
        assignment.classwork.classwork_type = "READING"
    elif ignored == "null-period":
        assignment.academic_period_id = None
    else:
        from app.models.academic.AcademicPeriod import AcademicPeriod
        period = AcademicPeriod(period_name="Other term", period_type="TERM", period_sequence=2,
            academic_year_id=ctx["period"].academic_year_id, start_date=ctx["period"].start_date,
            end_date=ctx["period"].end_date, is_active=False)
        ctx["db"].add(period)
        ctx["db"].flush()
        assignment.academic_period_id = period.academic_period_id
    ctx["db"].commit()
    response = _send(ctx, kind, student="student1")
    assert response.status_code == 200, response.text
    assert _entry(response, ctx, kind, "student1")["status"] == "newly_sent"


@pytest.mark.parametrize("kind", ["single", "bulk"])
def test_missing_item_list_is_capped_and_total_is_not(adviser_send_context, kind):
    ctx = adviser_send_context
    anchor = datetime(2026, 10, 16, 16, 0, tzinfo=timezone.utc)
    for index in range(7):
        assignment = _add_grade_scope_comparison_work(ctx, "WRITTEN_WORK", None, "100")
        assignment.classwork.title = f"Unscored item {index + 1}"
        assignment.due_date = anchor + timedelta(days=7 - index)
    ctx["db"].commit()
    with _forbid_writes(ctx["db"]):
        response = _send(ctx, kind, student="student1")
    detail = _missing_detail(response, ctx, kind)
    assert detail["missing_item_count"] == 7
    assert len(detail["missing_items"]) == 5
    assert [item["title"] for item in detail["missing_items"]] == [f"Unscored item {n}" for n in [7, 6, 5, 4, 3]]
    assert all(item["category"] == "Written Work" and item["due_date"].endswith("Z") for item in detail["missing_items"])


@pytest.mark.parametrize("kind", ["single", "bulk"])
@pytest.mark.parametrize("original,remedial,allowed", [
    ("90", None, True), (None, "100", True), (None, None, False),
    ("90", "80", True), ("90", "100", True), (None, "101", False), (None, "0", True),
])
def test_exam_readiness_uses_the_existing_effective_original_score(
    adviser_send_context, kind, original, remedial, allowed,
):
    ctx = adviser_send_context
    assignment = _add_grade_scope_comparison_work(ctx, "QUARTERLY_ASSESSMENT", "student1", "100", remedial=True)
    scores = ctx["db"].query(StudentSubmission).filter_by(student_id=ctx["student1"].student_id)
    for score in scores:
        if score.classwork_assignment_id == ctx["ca_qa"].classwork_assignment_id:
            score.grade = Decimal(original) if original is not None else None
        elif score.classwork_assignment_id == assignment.classwork_assignment_id:
            score.grade = Decimal(remedial) if remedial is not None else None
    ctx["db"].commit()
    book = teacher_student_gradebook(ctx["db"], ctx["teacher"].staff_id, ctx["class"].class_id,
                                    ctx["subject"].subject_id, ctx["period"].academic_period_id)
    expected = next(row for row in book.studentGrades if row.student_id == str(ctx["student1"].student_id))
    response = _send(ctx, kind, student="student1")
    if allowed:
        assert response.status_code == 200, response.text
        assert _entry(response, ctx, kind, "student1")["final_period_grade"] == expected.transmuted_grade
    else:
        detail = _missing_detail(response, ctx, kind)
        assert detail["missing_item_count"] == 1
        assert detail["missing_items"][0]["assignment_id"] == ctx["ca_qa"].classwork_assignment_id
        assert detail["missing_items"][0]["category"] == "Examination"


@pytest.mark.parametrize("kind", ["single", "bulk"])
def test_excused_status_does_not_exempt_a_blank_required_score(adviser_send_context, kind):
    ctx = adviser_send_context
    score = ctx["db"].query(StudentSubmission).filter_by(student_id=ctx["student1"].student_id,
        classwork_assignment_id=ctx["ca_ww"].classwork_assignment_id).one()
    score.status = "excused"
    score.grade = None
    deadline = datetime(2026, 10, 16, 16, 0, tzinfo=timezone.utc)
    ctx["ca_ww"].due_date = deadline
    # A matching excuse on the Manila deadline date does not alter the class
    # record's calculation. Dashboard excused-event rules are not a grade waiver.
    ctx["db"].add(AttendanceRecord(student_id=ctx["student1"].student_id,
        class_id=ctx["class"].class_id, subject_id=ctx["subject"].subject_id,
        date=(deadline + timedelta(hours=8)).date(), status="excused"))
    ctx["db"].commit()
    response = _send(ctx, kind, student="student1")
    detail = _missing_detail(response, ctx, kind)
    assert detail["missing_item_count"] == 1
    assert detail["missing_items"][0]["assignment_id"] == ctx["ca_ww"].classwork_assignment_id


@pytest.mark.parametrize("kind", ["single", "bulk"])
def test_four_written_items_all_scored_including_zero_send(adviser_send_context, kind):
    ctx = adviser_send_context
    for index in range(3):
        _add_grade_scope_comparison_work(ctx, "WRITTEN_WORK", None, "100",
            classwide_student1_score="0" if index == 2 else "90")
    response = _send(ctx, kind, student="student1")
    assert response.status_code == 200, response.text
    sent = _entry(response, ctx, kind, "student1")
    assert sent["status"] == "newly_sent"
    assert sent["missing_item_count"] == 0
    assert sent["missing_items"] == []


@pytest.mark.parametrize("kind", ["single", "bulk"])
@pytest.mark.parametrize("problem", ["unassigned", "archived", "bad_reference", "unknown_component", "bad_total", "generic_core_fallback"])
def test_automatic_send_refuses_missing_or_invalid_real_configuration(adviser_send_context, kind, problem):
    ctx = adviser_send_context
    db = ctx["db"]
    template = db.get(GradingTemplate, int(ctx["subject"].default_grading_template))
    if problem == "unassigned":
        ctx["subject"].default_grading_template = None
        template.subject_id = None
        template.academic_level_id = None
    elif problem == "archived":
        template.status = "archived"
    elif problem == "bad_reference":
        ctx["subject"].default_grading_template = "unresolvable-template"
    elif problem == "unknown_component":
        template.components[0].component_name = "Unmapped category"
    elif problem == "bad_total":
        template.components[0].weight = Decimal("31")
    else:
        ctx["subject"].default_grading_template = None
        template.subject_id = None
        template.academic_level_id = None
        template.template_name = "Core Subjects"
    db.commit()
    with _forbid_writes(db):
        response = _send(ctx, kind, student="student1", force=True)
    if kind == "single":
        assert response.status_code == 422, response.text
        assert response.json()["detail"]["code"] == "grading_configuration_invalid"
    else:
        assert response.status_code == 200, response.text
        assert response.json()["incomplete_skipped_count"] == 2
        assert response.json()["finalized_at"] is None
        assert all(row["skip_reason"] == "grading_configuration_invalid" for row in response.json()["entries"])


def test_bulk_empty_roster_has_no_finalization_timestamp_or_writes(adviser_send_context):
    ctx = adviser_send_context
    ctx["db"].query(StudentClass).delete()
    ctx["db"].commit()
    with _forbid_writes(ctx["db"]):
        response = _send(ctx, "bulk")
    assert response.status_code == 200, response.text
    assert response.json()["total_students"] == 0
    assert response.json()["entries"] == []
    assert response.json()["finalized_at"] is None

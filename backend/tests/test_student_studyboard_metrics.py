"""Regression tests for Student Study Board metrics and /me/todos accuracy."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal

from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.submissions.StudentSubmission import StudentSubmission
from tests.test_student_active_period_resolution import student_context  # noqa: F401


def _make_work(db, ctx, *, title, due_date, allow_late=False, is_locked=False, is_published=True, show_scores=True):
    subject_id = ctx["load_math_t1"].subject_id
    cw = Classwork(
        title=title,
        classwork_type="ASSIGNMENT",
        classwork_category="WRITTEN_WORK",
        is_graded=True,
        total_points=Decimal("20.00"),
        subject_id=subject_id,
        created_by_staff_id=ctx["load_math_t1"].staff_id,
        is_published=is_published,
        is_archived=False,
        show_scores=show_scores,
    )
    db.add(cw)
    db.flush()
    asgn = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=ctx["class_curr"].class_id,
        academic_period_id=ctx["period_t1"].academic_period_id,
        assigned_by_staff_id=ctx["load_math_t1"].staff_id,
        due_date=due_date,
        allow_late_submissions=allow_late,
        is_locked=is_locked,
        is_published=is_published,
    )
    db.add(asgn)
    db.flush()
    return cw, asgn


def test_studyboard_metrics_zero_timed_submissions_returns_null_rate(student_context):
    c = student_context
    db = c["db"]
    period_id = c["period_t1"].academic_period_id

    # One submitted assignment WITHOUT a due date
    _, asgn_no_due = _make_work(db, c, title="No Deadline Reflection", due_date=None)
    db.add(StudentSubmission(
        student_id=c["student"].student_id,
        classwork_assignment_id=asgn_no_due.classwork_assignment_id,
        status="submitted",
        submitted_at=datetime.now(timezone.utc),
        attempt_count=1,
    ))
    db.commit()

    res = c["client"].get(f"/api/v1/students/me/studyboard-metrics?academic_period_id={period_id}")
    assert res.status_code == 200
    body = res.json()
    assert body["on_time_count"] == 0
    assert body["late_submission_count"] == 0
    assert body["on_time_rate"] is None
    assert body["submitted_without_deadline_count"] == 1


def test_studyboard_deduplicates_multi_attempt_submissions_and_filters_hidden_scores(student_context):
    c = student_context
    db = c["db"]
    period_id = c["period_t1"].academic_period_id
    now = datetime.now(timezone.utc)

    # Assignment with 2 attempts (e.g., Study Support retake) — should count ONCE
    _, asgn_retake = _make_work(db, c, title="Retake Quiz Work", due_date=now + timedelta(days=2))
    db.add_all([
        StudentSubmission(
            student_id=c["student"].student_id,
            classwork_assignment_id=asgn_retake.classwork_assignment_id,
            status="graded",
            grade=Decimal("10.00"),
            submitted_at=now - timedelta(hours=2),
            graded_at=now - timedelta(hours=2),
            attempt_count=1,
        ),
        StudentSubmission(
            student_id=c["student"].student_id,
            classwork_assignment_id=asgn_retake.classwork_assignment_id,
            status="graded",
            grade=Decimal("18.00"),
            submitted_at=now - timedelta(hours=1),
            graded_at=now - timedelta(hours=1),
            attempt_count=2,
        ),
    ])

    # Assignment with hidden scores (show_scores=False) — grade must not leak
    _, asgn_hidden = _make_work(
        db, c, title="Hidden Score Work", due_date=now - timedelta(days=1), show_scores=False,
    )
    db.add(StudentSubmission(
        student_id=c["student"].student_id,
        classwork_assignment_id=asgn_hidden.classwork_assignment_id,
        status="graded",
        grade=Decimal("19.00"),
        submitted_at=now,  # submitted after due_date -> late
        graded_at=now,
        attempt_count=1,
    ))

    # Unpublished work must be excluded
    _, asgn_draft = _make_work(
        db, c, title="Unpublished Draft", due_date=now + timedelta(days=1), is_published=False,
    )
    db.add(StudentSubmission(
        student_id=c["student"].student_id,
        classwork_assignment_id=asgn_draft.classwork_assignment_id,
        status="submitted",
        submitted_at=now,
        attempt_count=1,
    ))

    # Overdue actionable vs overdue closed
    _make_work(db, c, title="Overdue Late Allowed", due_date=now - timedelta(hours=3), allow_late=True)
    _make_work(db, c, title="Overdue Closed", due_date=now - timedelta(hours=3), allow_late=False)
    _make_work(db, c, title="Locked Pending", due_date=now + timedelta(days=3), is_locked=True)
    db.commit()

    metrics_res = c["client"].get(f"/api/v1/students/me/studyboard-metrics?academic_period_id={period_id}")
    assert metrics_res.status_code == 200
    metrics = metrics_res.json()
    assert metrics["on_time_count"] == 1
    assert metrics["late_submission_count"] == 1
    assert metrics["on_time_rate"] == 50

    todos_res = c["client"].get(f"/api/v1/students/me/todos?academic_period_id={period_id}")
    assert todos_res.status_code == 200
    all_todos = todos_res.json()["all"]
    titles = [item["title"] for item in all_todos]
    assert titles.count("Retake Quiz Work") == 1
    assert "Unpublished Draft" not in titles

    by_title = {item["title"]: item for item in all_todos}
    assert by_title["Retake Quiz Work"]["grade"] == 18.0
    assert by_title["Hidden Score Work"]["grade"] is None
    assert by_title["Overdue Late Allowed"]["is_actionable"] is True
    assert by_title["Overdue Closed"]["is_actionable"] is False
    assert by_title["Locked Pending"]["is_locked"] is True
    assert by_title["Locked Pending"]["is_actionable"] is False

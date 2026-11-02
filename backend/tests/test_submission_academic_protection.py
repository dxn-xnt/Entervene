from datetime import date, datetime, timezone
from uuid import uuid4

import pytest

import app.api.v1.routes.Submissions as submission_routes
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from tests.test_classwork_submission_authorization import _act_as, authz_context


def _submit_url(context) -> str:
    return f"/api/v1/submissions/assignment/{context['assignment'].classwork_assignment_id}/submit"


def _make_current_period(context) -> None:
    period = context["period"]
    period.period_sequence = 2
    period.start_date = date(2025, 9, 1)
    period.end_date = date(2025, 11, 30)
    period.is_active = True
    context["db"].commit()


def _assert_rejected_submit_without_mutation(context, expected_status: int, expected_detail: str) -> None:
    before = {
        "status": context["submission"].status,
        "attempt_count": context["submission"].attempt_count,
        "attachments": len(context["submission"].attachments),
    }
    response = context["client"].post(
        _submit_url(context),
        files=[("files", ("blocked.pdf", b"blocked", "application/pdf"))],
    )
    context["db"].refresh(context["submission"])

    assert response.status_code == expected_status
    assert expected_detail.lower() in str(response.json()["detail"]).lower()
    assert context["submission"].status == before["status"]
    assert context["submission"].attempt_count == before["attempt_count"]
    assert len(context["submission"].attachments) == before["attachments"]


def test_current_period_submission_and_resubmission_remain_available(authz_context):
    c = authz_context
    _make_current_period(c)
    _act_as(c, "student", "student")

    cleared = c["client"].delete(_submit_url(c))
    resubmitted = c["client"].post(
        _submit_url(c),
        files=[("files", ("current.pdf", b"current", "application/pdf"))],
    )

    assert cleared.status_code == 200
    assert resubmitted.status_code == 200
    assert resubmitted.json()["status"] == "submitted"
    assert resubmitted.json()["attempt_count"] == 2


@pytest.mark.parametrize(
    ("sequence", "detail"),
    [
        (1, "Academic period is closed"),
        (3, "Academic period is not yet active"),
    ],
)
def test_closed_and_future_period_submissions_are_rejected_without_writes(
    authz_context,
    sequence,
    detail,
):
    c = authz_context
    _make_current_period(c)
    blocked = AcademicPeriod(
        period_name="Blocked period",
        period_type="QUARTER",
        period_sequence=sequence,
        start_date=date(2025, 6, 1) if sequence == 1 else date(2025, 12, 1),
        end_date=date(2025, 8, 31) if sequence == 1 else date(2026, 2, 28),
        academic_year_id=c["period"].academic_year_id,
        is_active=False,
    )
    c["db"].add(blocked)
    c["db"].flush()
    c["assignment"].academic_period_id = blocked.academic_period_id
    c["db"].commit()
    _act_as(c, "student", "student")

    _assert_rejected_submit_without_mutation(c, 403, detail)


@pytest.mark.parametrize(
    ("target_label", "target_start", "target_end", "detail"),
    [
        ("2024-2025", date(2024, 6, 1), date(2025, 3, 31), "Academic year is closed"),
        ("2026-2027", date(2026, 6, 1), date(2027, 3, 31), "Academic year is not currently active"),
    ],
)
def test_historical_and_future_year_submissions_are_rejected(
    authz_context,
    target_label,
    target_start,
    target_end,
    detail,
):
    c = authz_context
    target_year = c["db"].get(AcademicYear, c["allowed_class"].academic_year_id)
    target_year.year_label = target_label
    target_year.start_date = target_start
    target_year.end_date = target_end
    target_year.is_active = False
    active_year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    c["db"].add(active_year)
    c["db"].flush()
    c["period"].is_active = False
    c["db"].add(AcademicPeriod(
        period_name="Active Quarter",
        period_type="QUARTER",
        period_sequence=2,
        start_date=date(2025, 9, 1),
        end_date=date(2025, 11, 30),
        academic_year_id=active_year.academic_year_id,
        is_active=True,
    ))
    c["db"].commit()
    _act_as(c, "student", "student")

    _assert_rejected_submit_without_mutation(c, 403, detail)


def test_archived_class_and_unscoped_assignment_are_rejected(authz_context):
    c = authz_context
    _make_current_period(c)
    _act_as(c, "student", "student")

    c["allowed_class"].class_status = "archived"
    c["db"].commit()
    _assert_rejected_submit_without_mutation(c, 403, "archived")

    c["allowed_class"].class_status = "active"
    c["assignment"].academic_period_id = None
    c["db"].commit()
    _assert_rejected_submit_without_mutation(c, 403, "unscoped academic period")


def test_cross_year_enrollment_and_unauthorized_recipient_are_rejected(authz_context):
    c = authz_context
    _make_current_period(c)
    db = c["db"]
    membership = db.query(StudentClass).filter_by(
        student_id=c["student"].student_id,
        class_id=c["allowed_class"].class_id,
    ).one()
    db.delete(membership)
    other_year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=False,
    )
    db.add(other_year)
    db.flush()
    other_class = Class(
        section_name="Future membership",
        academic_year_id=other_year.academic_year_id,
        academic_level_id=c["allowed_class"].academic_level_id,
    )
    db.add(other_class)
    db.flush()
    db.add(StudentClass(
        student_id=c["student"].student_id,
        class_id=other_class.class_id,
        academic_year_id=other_year.academic_year_id,
        enrollment_status="enrolled",
    ))
    db.commit()
    _act_as(c, "student", "student")

    _assert_rejected_submit_without_mutation(c, 403, "not enrolled")

    db.delete(db.query(StudentClass).filter_by(student_id=c["student"].student_id).one())
    db.add(StudentClass(
        student_id=c["student"].student_id,
        class_id=c["allowed_class"].class_id,
        academic_year_id=c["allowed_class"].academic_year_id,
        enrollment_status="enrolled",
    ))
    recipient_id = c["db"].query(StudentClass.student_id).filter(
        StudentClass.class_id == c["other_class"].class_id,
    ).scalar()
    intervention = Intervention(
        student_id=recipient_id,
        class_id=c["allowed_class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        source_prediction_id=1,
        status="ACTIVE",
        diagnosis_snapshot={},
        activated_at=datetime.now(timezone.utc),
        activated_by_staff_id=c["owner"].staff_id,
    )
    db.add(intervention)
    db.flush()
    c["assignment"].recipient_student_id = recipient_id
    c["assignment"].source_intervention_id = intervention.intervention_id
    c["assignment"].remediation_request_id = uuid4()
    db.commit()

    _assert_rejected_submit_without_mutation(c, 404, "Assignment not found")


def test_finalized_grade_blocks_all_student_submission_mutations_before_file_changes(
    authz_context,
    monkeypatch,
):
    c = authz_context
    _make_current_period(c)
    db = c["db"]
    db.add(StudentPeriodGrade(
        student_id=c["student"].student_id,
        class_id=c["allowed_class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        is_finalized=True,
    ))
    db.commit()
    _act_as(c, "student", "student")
    assignment_id = c["assignment"].classwork_assignment_id
    attachment_id = c["submission_attachment"].submission_attachment_id
    attachment_path = c["submission_attachment"].file_path

    async def unexpected_save(*args, **kwargs):
        raise AssertionError("authorization must run before saving files")

    monkeypatch.setattr(submission_routes, "save_file", unexpected_save)

    responses = [
        c["client"].post(
            _submit_url(c),
            files=[("files", ("blocked.pdf", b"blocked", "application/pdf"))],
        ),
        c["client"].post(f"/api/v1/submissions/assignment/{assignment_id}/unsubmit"),
        c["client"].delete(
            f"/api/v1/submissions/assignment/{assignment_id}/attachments/{attachment_id}"
        ),
        c["client"].delete(_submit_url(c)),
    ]

    assert [response.status_code for response in responses] == [409, 409, 409, 409]
    assert all(response.json()["detail"] == "The period grade is finalized" for response in responses)
    db.refresh(c["submission"])
    assert c["submission"].status == "submitted"
    assert c["submission"].attempt_count == 1
    assert db.query(StudentSubmission).count() == 1
    assert db.get(StudentSubmission, c["submission"].submission_id).attachments
    assert c["tmp_path"].joinpath("submission.txt").exists()
    assert attachment_path == str(c["tmp_path"].joinpath("submission.txt"))


def test_ordinary_reading_progress_is_protected_and_remains_separate_from_intervention_reviews(authz_context):
    c = authz_context
    _make_current_period(c)
    reading = Classwork(
        title="Ordinary reading",
        classwork_type="READING",
        is_graded=False,
        is_published=True,
        is_archived=False,
        subject_id=c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(reading)
    c["db"].flush()
    assignment = ClassworkAssignment(
        classwork_id=reading.classwork_id,
        class_id=c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        is_published=True,
    )
    c["db"].add(assignment)
    c["db"].commit()
    _act_as(c, "student", "student")
    base = f"/api/v1/submissions/assignment/{assignment.classwork_assignment_id}"

    focused = c["client"].post(f"{base}/reading-focus", json={"focused_seconds": 30})
    completed = c["client"].post(f"{base}/complete-reading")

    assert focused.status_code == 200
    assert completed.status_code == 200
    assert completed.json()["status"] == "submitted"
    assert c["db"].query(InterventionReadingReview).count() == 0

    c["db"].add(StudentPeriodGrade(
        student_id=c["student"].student_id,
        class_id=c["allowed_class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        is_finalized=True,
    ))
    c["db"].commit()

    assert c["client"].post(f"{base}/reading-focus", json={"focused_seconds": 30}).status_code == 409
    assert c["client"].post(f"{base}/complete-reading").status_code == 409

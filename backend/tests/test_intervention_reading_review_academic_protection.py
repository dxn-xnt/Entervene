from datetime import date

import pytest

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from tests.test_classwork_submission_authorization import _act_as, authz_context
from tests.test_student_intervention_reading_review_api import (
    _client_for_student,
    _setup_intervention_with_reading,
)


def _make_current_period(context) -> None:
    period = context["period"]
    period.period_sequence = 2
    period.start_date = date(2025, 9, 1)
    period.end_date = date(2025, 11, 30)
    period.is_active = True
    context["db"].commit()


def _review(context, intervention, reading_assignment):
    _act_as(context, "student", "student")
    client = _client_for_student(context)
    response = client.post(
        f"/api/v1/student/interventions/{intervention.intervention_id}"
        f"/readings/{reading_assignment.classwork_assignment_id}/review"
    )
    return client, response


def _assert_no_review(context) -> None:
    assert context["db"].query(InterventionReadingReview).count() == 0


def test_current_period_review_is_allowed(authz_context):
    c = authz_context
    _make_current_period(c)
    intervention, reading_assignment, _ = _setup_intervention_with_reading(c, 8101)

    _, response = _review(c, intervention, reading_assignment)

    assert response.status_code == 200
    assert response.json()["review_status"] == "REVIEWED"
    assert c["db"].query(InterventionReadingReview).count() == 1


@pytest.mark.parametrize(
    ("sequence", "expected_detail"),
    [
        (1, "Academic period is closed"),
        (3, "Academic period is not yet active"),
    ],
)
def test_closed_and_future_period_reviews_are_rejected_without_mutation(
    authz_context,
    sequence,
    expected_detail,
):
    c = authz_context
    _make_current_period(c)
    intervention, reading_assignment, remediation_assignment = _setup_intervention_with_reading(c, 8102)
    blocked = AcademicPeriod(
        period_name="Blocked Quarter",
        period_type="QUARTER",
        period_sequence=sequence,
        start_date=date(2025, 6, 1) if sequence == 1 else date(2025, 12, 1),
        end_date=date(2025, 8, 31) if sequence == 1 else date(2026, 2, 28),
        academic_year_id=c["period"].academic_year_id,
        is_active=False,
    )
    c["db"].add(blocked)
    c["db"].flush()
    intervention.academic_period_id = blocked.academic_period_id
    reading_assignment.academic_period_id = blocked.academic_period_id
    remediation_assignment.academic_period_id = blocked.academic_period_id
    c["db"].commit()

    _, response = _review(c, intervention, reading_assignment)

    assert response.status_code == 403
    assert expected_detail in response.json()["detail"]
    _assert_no_review(c)


@pytest.mark.parametrize(
    ("target_label", "target_start", "target_end", "expected_detail"),
    [
        ("2024-2025", date(2024, 6, 1), date(2025, 3, 31), "Academic year is closed"),
        ("2026-2027", date(2026, 6, 1), date(2027, 3, 31), "Academic year is not currently active"),
    ],
)
def test_historical_and_future_year_reviews_are_rejected(
    authz_context,
    target_label,
    target_start,
    target_end,
    expected_detail,
):
    c = authz_context
    intervention, reading_assignment, _ = _setup_intervention_with_reading(c, 8103)
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

    _, response = _review(c, intervention, reading_assignment)

    assert response.status_code == 403
    assert expected_detail in response.json()["detail"]
    _assert_no_review(c)


def test_archived_class_review_is_rejected(authz_context):
    c = authz_context
    _make_current_period(c)
    intervention, reading_assignment, _ = _setup_intervention_with_reading(c, 8104)
    c["allowed_class"].class_status = "archived"
    c["db"].commit()

    _, response = _review(c, intervention, reading_assignment)

    assert response.status_code == 403
    assert "archived" in response.json()["detail"].lower()
    _assert_no_review(c)


def test_inactive_period_without_an_active_replacement_reports_missing_lifecycle(authz_context):
    c = authz_context
    intervention, reading_assignment, _ = _setup_intervention_with_reading(c, 8108)
    c["period"].is_active = False
    c["db"].commit()

    _, response = _review(c, intervention, reading_assignment)

    assert response.status_code == 409
    assert response.json()["detail"] == "No active grading period is configured."
    _assert_no_review(c)


def test_finalized_period_review_is_rejected_without_mutation(authz_context):
    c = authz_context
    _make_current_period(c)
    intervention, reading_assignment, _ = _setup_intervention_with_reading(c, 8109)
    c["db"].add(StudentPeriodGrade(
        student_id=c["student"].student_id,
        class_id=intervention.class_id,
        subject_id=intervention.subject_id,
        academic_period_id=intervention.academic_period_id,
        is_finalized=True,
        finalized_by_staff_id=c["owner"].staff_id,
    ))
    c["db"].commit()

    _, response = _review(c, intervention, reading_assignment)

    assert response.status_code == 409
    assert response.json()["detail"] == "The period grade is finalized"
    _assert_no_review(c)


@pytest.mark.parametrize("target", ["reading_locked", "remediation_locked"])
def test_inaccessible_snapshot_assignments_cannot_be_reviewed(authz_context, target):
    c = authz_context
    _make_current_period(c)
    intervention, reading_assignment, remediation_assignment = _setup_intervention_with_reading(c, 8110)
    if target == "reading_locked":
        reading_assignment.is_locked = True
    else:
        remediation_assignment.is_locked = True
    c["db"].commit()

    _, response = _review(c, intervention, reading_assignment)

    assert response.status_code == 404
    assert response.json()["detail"] == "Reading is outside the intervention academic scope"
    _assert_no_review(c)


def test_exact_year_enrollment_is_required(authz_context):
    c = authz_context
    _make_current_period(c)
    intervention, reading_assignment, _ = _setup_intervention_with_reading(c, 8105)
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
        section_name="Future enrollment",
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

    _, response = _review(c, intervention, reading_assignment)

    assert response.status_code == 403
    assert "this academic year" in response.json()["detail"]
    _assert_no_review(c)


@pytest.mark.parametrize("mismatch", ["reading_class", "reading_period", "remediation_subject"])
def test_frozen_snapshot_must_match_intervention_scope(authz_context, mismatch):
    c = authz_context
    _make_current_period(c)
    intervention, reading_assignment, remediation_assignment = _setup_intervention_with_reading(c, 8106)
    if mismatch == "reading_class":
        reading_assignment.class_id = c["other_class"].class_id
    elif mismatch == "reading_period":
        future = AcademicPeriod(
            period_name="Future Quarter",
            period_type="QUARTER",
            period_sequence=3,
            start_date=date(2025, 12, 1),
            end_date=date(2026, 2, 28),
            academic_year_id=c["period"].academic_year_id,
            is_active=False,
        )
        c["db"].add(future)
        c["db"].flush()
        reading_assignment.academic_period_id = future.academic_period_id
    else:
        other_subject = Subject(
            subject_name="Out-of-scope subject",
            academic_level_id=c["subject"].academic_level_id,
            grading_template_id=c["subject"].grading_template_id,
        )
        c["db"].add(other_subject)
        c["db"].flush()
        remediation_assignment.classwork.subject_id = other_subject.subject_id
    c["db"].commit()

    _, response = _review(c, intervention, reading_assignment)

    assert response.status_code == 404
    assert response.json()["detail"] == "Reading is outside the intervention academic scope"
    _assert_no_review(c)


def test_historical_reviews_remain_readable_but_cannot_be_reacknowledged(authz_context):
    c = authz_context
    _make_current_period(c)
    intervention, reading_assignment, _ = _setup_intervention_with_reading(c, 8107)
    client, created = _review(c, intervention, reading_assignment)
    assert created.status_code == 200

    next_period = AcademicPeriod(
        period_name="Third Quarter",
        period_type="QUARTER",
        period_sequence=3,
        start_date=date(2025, 12, 1),
        end_date=date(2026, 2, 28),
        academic_year_id=c["period"].academic_year_id,
        is_active=True,
    )
    c["period"].is_active = False
    c["db"].add(next_period)
    c["db"].commit()

    listed = client.get(f"/api/v1/student/interventions/{intervention.intervention_id}/reviews")
    retried = client.post(
        f"/api/v1/student/interventions/{intervention.intervention_id}"
        f"/readings/{reading_assignment.classwork_assignment_id}/review"
    )

    assert listed.status_code == 200
    assert len(listed.json()) == 1
    assert retried.status_code == 403
    assert "Academic period is closed" in retried.json()["detail"]
    assert c["db"].query(InterventionReadingReview).count() == 1

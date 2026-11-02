from datetime import date, datetime, timezone
from uuid import uuid4

import pytest

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.people.Student import Student
from tests.test_classwork_submission_authorization import _act_as, authz_context


pytestmark = pytest.mark.usefixtures("authz_context")


def _add_assignment(context, *, title: str, period: AcademicPeriod) -> ClassworkAssignment:
    db = context["db"]
    classwork = Classwork(
        title=title,
        classwork_type="ASSIGNMENT",
        total_points=100,
        subject_id=context["subject"].subject_id,
        created_by_staff_id=context["owner"].staff_id,
        is_published=True,
    )
    db.add(classwork)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=classwork.classwork_id,
        class_id=context["allowed_class"].class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=context["owner"].staff_id,
        is_published=True,
    )
    db.add(assignment)
    db.commit()
    return assignment


def _second_period(context, *, name: str = "Q2") -> AcademicPeriod:
    period = AcademicPeriod(
        period_name=name,
        period_type="QUARTER",
        period_sequence=2,
        period_progress_ratio=0.5,
        start_date=date(2025, 9, 1),
        end_date=date(2025, 11, 30),
        academic_year_id=context["period"].academic_year_id,
        is_active=False,
    )
    context["db"].add(period)
    context["db"].commit()
    return period


def _list_url(context, period_id: int | None = None) -> str:
    path = (
        f"/api/v1/classwork-assignments/class/{context['allowed_class'].class_id}"
        f"/subject/{context['subject'].subject_id}"
    )
    return path if period_id is None else f"{path}?academic_period_id={period_id}"


def test_explicit_period_uses_the_assignments_actual_period(authz_context):
    context = authz_context
    _act_as(context, "student", "student")
    second_period = _second_period(context)
    second_assignment = _add_assignment(
        context,
        title="Second-term work",
        period=second_period,
    )

    response = context["client"].get(
        _list_url(context, second_period.academic_period_id)
    )

    assert response.status_code == 200
    assert [row["classwork_assignment_id"] for row in response.json()] == [
        second_assignment.classwork_assignment_id
    ]


def test_unscoped_request_preserves_all_valid_periods_and_missing_period_is_empty(
    authz_context,
):
    context = authz_context
    _act_as(context, "student", "student")
    second_period = _second_period(context)
    second_assignment = _add_assignment(
        context,
        title="Second-term work",
        period=second_period,
    )

    unscoped = context["client"].get(_list_url(context))
    missing = context["client"].get(_list_url(context, 999_999))

    assert unscoped.status_code == 200
    assert {
        row["classwork_assignment_id"] for row in unscoped.json()
    } == {
        context["assignment"].classwork_assignment_id,
        second_assignment.classwork_assignment_id,
    }
    assert missing.status_code == 200
    assert missing.json() == []


def test_historical_period_remains_readable_and_cross_year_assignment_is_excluded(
    authz_context,
):
    context = authz_context
    _act_as(context, "student", "student")
    historical_period = context["period"]
    historical_period.is_active = False

    future_year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    context["db"].add(future_year)
    context["db"].flush()
    malformed_period = AcademicPeriod(
        period_name="Future Q1",
        period_type="QUARTER",
        start_date=date(2026, 6, 1),
        end_date=date(2026, 8, 31),
        academic_year_id=future_year.academic_year_id,
        is_active=True,
    )
    context["db"].add(malformed_period)
    context["db"].commit()
    _add_assignment(context, title="Cross-year work", period=malformed_period)

    historical = context["client"].get(
        _list_url(context, historical_period.academic_period_id)
    )
    malformed = context["client"].get(
        _list_url(context, malformed_period.academic_period_id)
    )

    assert historical.status_code == 200
    assert [row["classwork_assignment_id"] for row in historical.json()] == [
        context["assignment"].classwork_assignment_id
    ]
    assert malformed.status_code == 200
    assert malformed.json() == []


def test_period_filter_does_not_bypass_student_enrollment(authz_context):
    context = authz_context
    _act_as(context, "other_student", "student")

    response = context["client"].get(
        _list_url(context, context["period"].academic_period_id)
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Not enrolled in this class"


def test_period_filter_preserves_targeted_remediation_recipient_scope(authz_context):
    context = authz_context
    db = context["db"]
    other_student = db.query(Student).filter_by(
        user_id=context["accounts"]["other_student"].user_id
    ).one()
    db.query(StudentClass).filter_by(student_id=other_student.student_id).one().class_id = (
        context["allowed_class"].class_id
    )
    intervention = Intervention(
        intervention_id=9_999,
        student_id=context["student"].student_id,
        class_id=context["allowed_class"].class_id,
        subject_id=context["subject"].subject_id,
        academic_period_id=context["period"].academic_period_id,
        source_prediction_id=1,
        status="ACTIVE",
        diagnosis_snapshot={},
        activated_at=datetime.now(timezone.utc),
        activated_by_staff_id=context["owner"].staff_id,
    )
    db.add(intervention)
    context["assignment"].recipient_student_id = context["student"].student_id
    context["assignment"].source_intervention_id = intervention.intervention_id
    context["assignment"].remediation_request_id = uuid4()
    db.commit()

    url = _list_url(context, context["period"].academic_period_id)
    _act_as(context, "student", "student")
    recipient_response = context["client"].get(url)
    _act_as(context, "other_student", "student")
    other_response = context["client"].get(url)

    assert recipient_response.status_code == 200
    assert [row["classwork_assignment_id"] for row in recipient_response.json()] == [
        context["assignment"].classwork_assignment_id
    ]
    assert other_response.status_code == 200
    assert other_response.json() == []

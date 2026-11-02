"""Authorization and academic-integrity coverage for the legacy ActivityService."""

from datetime import date

import pytest
from fastapi import HTTPException

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.Role import Role
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.schemas.Activity import ActivityCreateRequest, BulkScoreUpdateRequest
from app.services.activity import ActivityService as activity
from tests.test_classwork_submission_authorization import authz_context


def _create_payload(context, *, period_id=None, title="Protected activity"):
    return ActivityCreateRequest(
        title=title,
        classwork_category="WRITTEN_WORK",
        total_points=100,
        class_id=context["allowed_class"].class_id,
        subject_id=context["subject"].subject_id,
        academic_period_id=period_id or context["period"].academic_period_id,
        activity_mode="MANUAL",
    )


def _score_payload(context, student, score=80):
    return BulkScoreUpdateRequest(
        class_id=context["allowed_class"].class_id,
        scores=[{"student_id": student.student_id, "score": score}],
    )


def test_unassigned_teacher_cannot_create_read_score_or_delete(authz_context):
    context = authz_context
    db = context["db"]
    other_staff_id = "T-OTHER"

    with pytest.raises(HTTPException) as create_error:
        activity.create_activity(db, other_staff_id, _create_payload(context))
    assert create_error.value.status_code == 403

    with pytest.raises(HTTPException) as read_error:
        activity.get_activity_scores(
            db, other_staff_id, context["classwork"].classwork_id, context["allowed_class"].class_id,
        )
    assert read_error.value.status_code == 403

    with pytest.raises(HTTPException) as score_error:
        activity.bulk_update_activity_scores(
            db,
            other_staff_id,
            context["classwork"].classwork_id,
            _score_payload(context, context["student"]),
        )
    assert score_error.value.status_code == 403

    with pytest.raises(HTTPException) as delete_error:
        activity.delete_activity(db, other_staff_id, context["classwork"].classwork_id)
    assert delete_error.value.status_code == 403
    db.refresh(context["classwork"])
    db.refresh(context["submission"])
    assert context["classwork"].is_archived is False
    assert context["submission"].grade is None


def test_current_teacher_can_create_score_and_delete_but_not_score_nonmember(authz_context, monkeypatch):
    context = authz_context
    db = context["db"]
    monkeypatch.setattr(activity, "refresh_after_committed_grade_change", lambda *_args, **_kwargs: None)

    created = activity.create_activity(db, context["owner"].staff_id, _create_payload(context))
    assert created["classwork_id"]

    response = activity.bulk_update_activity_scores(
        db,
        context["owner"].staff_id,
        context["classwork"].classwork_id,
        _score_payload(context, context["student"]),
    )
    assert next(item.score for item in response.students if item.student_id == context["student"].student_id) == 80

    nonmember = db.query(Student).filter_by(user_id=context["accounts"]["other_student"].user_id).one()
    with pytest.raises(HTTPException) as nonmember_error:
        activity.bulk_update_activity_scores(
            db,
            context["owner"].staff_id,
            context["classwork"].classwork_id,
            _score_payload(context, nonmember, 90),
        )
    assert nonmember_error.value.status_code == 403

    result = activity.delete_activity(db, context["owner"].staff_id, created["classwork_id"])
    assert result == {"message": "Activity deleted successfully"}


def test_historical_and_archived_scopes_are_read_only(authz_context):
    context = authz_context
    db = context["db"]
    period = context["period"]
    period.is_active = False
    period.period_sequence = 1
    active_period = AcademicPeriod(
        period_name="Q2",
        period_type="QUARTER",
        period_sequence=2,
        total_periods_in_year=3,
        start_date=date(2025, 9, 1),
        end_date=date(2025, 11, 30),
        is_active=True,
        academic_year_id=period.academic_year_id,
    )
    db.add(active_period)
    db.commit()

    # Authorized historical reads remain available.
    activity.get_activity_scores(
        db, context["owner"].staff_id, context["classwork"].classwork_id, context["allowed_class"].class_id,
    )
    with pytest.raises(HTTPException) as historical_score:
        activity.bulk_update_activity_scores(
            db,
            context["owner"].staff_id,
            context["classwork"].classwork_id,
            _score_payload(context, context["student"]),
        )
    assert historical_score.value.status_code == 403
    with pytest.raises(HTTPException) as historical_delete:
        activity.delete_activity(db, context["owner"].staff_id, context["classwork"].classwork_id)
    assert historical_delete.value.status_code == 403

    period.is_active = True
    active_period.is_active = False
    context["allowed_class"].class_status = "archived"
    db.commit()
    with pytest.raises(HTTPException) as archived_create:
        activity.create_activity(db, context["owner"].staff_id, _create_payload(context))
    assert archived_create.value.status_code == 403


def test_future_period_planning_in_active_year_remains_allowed(authz_context):
    context = authz_context
    db = context["db"]
    current = context["period"]
    current.is_active = True
    current.period_sequence = 1
    future = AcademicPeriod(
        period_name="Q2",
        period_type="QUARTER",
        period_sequence=2,
        total_periods_in_year=3,
        start_date=date(2025, 9, 1),
        end_date=date(2025, 11, 30),
        is_active=False,
        academic_year_id=current.academic_year_id,
    )
    db.add(future)
    db.flush()
    db.add(SubjectLoad(
        staff_id=context["owner"].staff_id,
        subject_id=context["subject"].subject_id,
        class_id=context["allowed_class"].class_id,
        academic_period_id=future.academic_period_id,
        status="active",
        is_active_version=True,
    ))
    db.commit()

    created = activity.create_activity(
        db,
        context["owner"].staff_id,
        _create_payload(context, period_id=future.academic_period_id, title="Planned Q2 activity"),
    )
    assert created["classwork_id"]


def test_future_academic_year_activity_creation_is_read_only(authz_context):
    context = authz_context
    db = context["db"]
    future_year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=False,
    )
    db.add(future_year)
    db.flush()
    future_period = AcademicPeriod(
        period_name="Q1",
        period_type="QUARTER",
        period_sequence=1,
        total_periods_in_year=3,
        start_date=date(2026, 6, 1),
        end_date=date(2026, 8, 31),
        is_active=False,
        academic_year_id=future_year.academic_year_id,
    )
    future_class = Class(
        section_name="Future section",
        academic_year_id=future_year.academic_year_id,
        academic_level_id=context["allowed_class"].academic_level_id,
    )
    db.add_all([future_period, future_class])
    db.flush()
    db.add(SubjectLoad(
        staff_id=context["owner"].staff_id,
        subject_id=context["subject"].subject_id,
        class_id=future_class.class_id,
        academic_period_id=future_period.academic_period_id,
        status="active",
        is_active_version=True,
    ))
    db.commit()

    payload = _create_payload(context, period_id=future_period.academic_period_id)
    payload.class_id = future_class.class_id
    with pytest.raises(HTTPException) as error:
        activity.create_activity(db, context["owner"].staff_id, payload)
    assert error.value.status_code == 403
    assert "not currently active" in error.value.detail


def test_actual_admin_role_can_manage_current_activity_scope(authz_context):
    context = authz_context
    db = context["db"]
    admin = db.query(AcademicStaff).filter_by(staff_id="T-OTHER").one()
    role = Role(role_id=91, role_name="Admin")
    db.add(role)
    db.flush()
    db.add(UserRoles(user_id=admin.user_id, role_id=role.role_id))
    db.commit()

    created = activity.create_activity(db, admin.staff_id, _create_payload(context, title="Admin activity"))
    result = activity.delete_activity(db, admin.staff_id, created["classwork_id"])
    assert result == {"message": "Activity deleted successfully"}


def test_finalized_grade_blocks_bulk_scoring_and_activity_deletion(authz_context, monkeypatch):
    context = authz_context
    db = context["db"]
    monkeypatch.setattr(activity, "refresh_after_committed_grade_change", lambda *_args, **_kwargs: None)
    db.add(StudentPeriodGrade(
        student_id=context["student"].student_id,
        class_id=context["allowed_class"].class_id,
        subject_id=context["subject"].subject_id,
        academic_period_id=context["period"].academic_period_id,
        final_period_grade=90,
        is_finalized=True,
    ))
    db.commit()

    with pytest.raises(HTTPException) as score_error:
        activity.bulk_update_activity_scores(
            db,
            context["owner"].staff_id,
            context["classwork"].classwork_id,
            _score_payload(context, context["student"]),
        )
    assert score_error.value.status_code == 409
    assert score_error.value.detail == "The period grade is finalized"

    with pytest.raises(HTTPException) as delete_error:
        activity.delete_activity(db, context["owner"].staff_id, context["classwork"].classwork_id)
    assert delete_error.value.status_code == 409
    db.refresh(context["submission"])
    db.refresh(context["classwork"])
    assert context["submission"].grade is None
    assert context["classwork"].is_archived is False

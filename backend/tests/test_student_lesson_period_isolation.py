from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Lessons import router as lessons_router
from app.db.Session import get_db
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from tests.test_classwork_submission_authorization import _act_as, authz_context


pytestmark = pytest.mark.usefixtures("authz_context")


@pytest.fixture
def lesson_client(authz_context):
    app = FastAPI()
    app.include_router(lessons_router, prefix="/api/v1/lessons")
    app.dependency_overrides[get_db] = lambda: authz_context["db"]
    app.dependency_overrides[get_current_user] = lambda: authz_context["identity"]
    with TestClient(app) as client:
        yield client


def _second_period(context) -> AcademicPeriod:
    period = AcademicPeriod(
        period_name="Q2",
        period_type="QUARTER",
        period_sequence=2,
        start_date=date(2025, 9, 1),
        end_date=date(2025, 11, 30),
        academic_year_id=context["period"].academic_year_id,
        is_active=False,
    )
    context["db"].add(period)
    context["db"].flush()
    context["db"].add(
        SubjectLoad(
            staff_id=context["owner"].staff_id,
            subject_id=context["subject"].subject_id,
            class_id=context["allowed_class"].class_id,
            academic_period_id=period.academic_period_id,
            status="published",
            is_active_version=True,
        )
    )
    context["db"].commit()
    return period


def _lesson_context(context):
    db = context["db"]
    lesson = Lesson(
        title="Reusable lesson",
        subject_id=context["subject"].subject_id,
        is_published=True,
        is_draft=False,
        created_by_staff_id=context["owner"].staff_id,
    )
    db.add(lesson)
    db.flush()
    db.add(
        LessonAssignment(
            lesson_id=lesson.lesson_id,
            class_id=context["allowed_class"].class_id,
            assigned_by_staff_id=context["owner"].staff_id,
            is_published=True,
        )
    )
    db.add(
        ClassworkLesson(
            classwork_id=context["classwork"].classwork_id,
            lesson_id=lesson.lesson_id,
        )
    )
    second_period = _second_period(context)
    second_work = Classwork(
        title="Second-term work",
        classwork_type="ASSIGNMENT",
        total_points=100,
        subject_id=context["subject"].subject_id,
        created_by_staff_id=context["owner"].staff_id,
        is_published=True,
    )
    db.add(second_work)
    db.flush()
    db.add(
        ClassworkLesson(
            classwork_id=second_work.classwork_id,
            lesson_id=lesson.lesson_id,
        )
    )
    second_assignment = ClassworkAssignment(
        classwork_id=second_work.classwork_id,
        class_id=context["allowed_class"].class_id,
        academic_period_id=second_period.academic_period_id,
        assigned_by_staff_id=context["owner"].staff_id,
        is_published=True,
    )
    db.add(second_assignment)
    db.commit()
    return lesson, second_period, second_assignment


def _lesson_list_url(context, period_id: int) -> str:
    return (
        f"/api/v1/lessons/class/{context['allowed_class'].class_id}"
        f"/subject/{context['subject'].subject_id}?academic_period_id={period_id}"
    )


def _linked_url(context, lesson_id: int, period_id: int) -> str:
    return (
        f"/api/v1/lessons/{lesson_id}/classwork-assignments"
        f"?class_id={context['allowed_class'].class_id}"
        f"&academic_period_id={period_id}"
    )


def test_reusable_lesson_stays_visible_but_linked_work_is_period_isolated(
    authz_context,
    lesson_client,
):
    context = authz_context
    _act_as(context, "student", "student")
    lesson, second_period, second_assignment = _lesson_context(context)

    first_lessons = lesson_client.get(
        _lesson_list_url(context, context["period"].academic_period_id)
    )
    second_lessons = lesson_client.get(
        _lesson_list_url(context, second_period.academic_period_id)
    )
    first_work = lesson_client.get(
        _linked_url(context, lesson.lesson_id, context["period"].academic_period_id)
    )
    second_work = lesson_client.get(
        _linked_url(context, lesson.lesson_id, second_period.academic_period_id)
    )

    assert first_lessons.status_code == second_lessons.status_code == 200
    assert [row["lesson_id"] for row in first_lessons.json()] == [lesson.lesson_id]
    assert [row["lesson_id"] for row in second_lessons.json()] == [lesson.lesson_id]
    assert [row["classwork_assignment_id"] for row in first_work.json()] == [
        context["assignment"].classwork_assignment_id
    ]
    assert [row["classwork_assignment_id"] for row in second_work.json()] == [
        second_assignment.classwork_assignment_id
    ]


def test_historical_missing_and_unauthorized_period_reads(authz_context, lesson_client):
    context = authz_context
    _act_as(context, "student", "student")
    lesson, _second_period_obj, _second_assignment = _lesson_context(context)
    context["period"].is_active = False
    context["db"].commit()

    historical = lesson_client.get(
        _linked_url(context, lesson.lesson_id, context["period"].academic_period_id)
    )
    missing_lessons = lesson_client.get(_lesson_list_url(context, 999_999))
    missing_work = lesson_client.get(_linked_url(context, lesson.lesson_id, 999_999))
    _act_as(context, "other_student", "student")
    unauthorized = lesson_client.get(
        _linked_url(context, lesson.lesson_id, context["period"].academic_period_id)
    )

    assert historical.status_code == 200
    assert [row["classwork_assignment_id"] for row in historical.json()] == [
        context["assignment"].classwork_assignment_id
    ]
    assert missing_lessons.status_code == missing_work.status_code == 200
    assert missing_lessons.json() == missing_work.json() == []
    assert unauthorized.status_code == 403


def test_linked_work_does_not_bypass_lesson_publication(authz_context, lesson_client):
    context = authz_context
    _act_as(context, "student", "student")
    lesson, _second_period_obj, _second_assignment = _lesson_context(context)
    lesson.is_published = False
    context["db"].commit()

    response = lesson_client.get(
        _linked_url(context, lesson.lesson_id, context["period"].academic_period_id)
    )

    assert response.status_code == 404


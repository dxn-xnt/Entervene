from datetime import date

import pytest

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.auth.Role import Role
from app.models.auth.UserRoles import UserRoles
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.submissions.StudentSubmission import StudentSubmission
from tests.test_quiz_builder_api import _valid_payload, quiz_api_context


def _act_as(context, account_name: str, role: str = "teacher") -> None:
    context["identity"].update(
        sub=context["accounts"][account_name].user_id,
        role=role,
    )


def _builder_url(context) -> str:
    return f"/api/v1/quizzes/classwork/{context['quiz_classwork'].classwork_id}"


def _create_builder(context, *, status: str = "READY"):
    payload = _valid_payload(context["lesson"].lesson_id)
    payload["status"] = status
    response = context["client"].put(_builder_url(context), json=payload)
    assert response.status_code == 200
    return context["db"].get(Quiz, response.json()["quiz_id"])


def _create_submission(context):
    quiz = _create_builder(context)
    links = sorted(quiz.questions, key=lambda item: item.display_order)
    submission = StudentSubmission(
        student_id=context["student"].student_id,
        classwork_assignment_id=context["assignment"].classwork_assignment_id,
        status="submitted",
        attempt_count=1,
    )
    context["db"].add(submission)
    context["db"].flush()
    answers = [
        QuizAnswer(
            quiz_question_id=link.quiz_question_id,
            submission_id=submission.submission_id,
            answer_text="student response",
        )
        for link in links
    ]
    context["db"].add_all(answers)
    context["db"].commit()
    return submission, answers, links


def _grade_payload(links, first_points=6, second_points=4):
    return {
        "answers": [
            {"quiz_question_id": links[0].quiz_question_id, "points_awarded": first_points},
            {"quiz_question_id": links[1].quiz_question_id, "points_awarded": second_points},
        ],
        "feedback": "Reviewed",
    }


def test_builder_requires_load_scope_and_rejects_without_mutation(quiz_api_context):
    c = quiz_api_context
    _act_as(c, "other_teacher")
    before = c["db"].query(Quiz).count()

    response = c["client"].put(
        _builder_url(c),
        json=_valid_payload(c["lesson"].lesson_id),
    )

    assert response.status_code == 403
    assert c["db"].query(Quiz).count() == before


def test_admin_and_active_substitute_builder_permissions(quiz_api_context):
    c = quiz_api_context
    role = Role(role_id=91, role_name="admin")
    c["db"].add(role)
    c["db"].flush()
    c["db"].add(UserRoles(
        user_id=c["accounts"]["other_teacher"].user_id,
        role_id=role.role_id,
    ))
    c["db"].commit()
    _act_as(c, "other_teacher", "admin")
    assert c["client"].put(
        _builder_url(c),
        json=_valid_payload(c["lesson"].lesson_id),
    ).status_code == 200


def test_active_substitute_can_edit_while_original_teacher_is_read_only(quiz_api_context):
    c = quiz_api_context
    load = c["db"].query(SubjectLoad).one()
    c["db"].add(TeacherSubstitution(
        subject_load_id=load.subject_load_id,
        original_staff_id=c["owner"].staff_id,
        substitute_staff_id=c["other_teacher"].staff_id,
        start_date=date.today(),
        status="active",
    ))
    c["db"].commit()

    owner_response = c["client"].put(
        _builder_url(c),
        json=_valid_payload(c["lesson"].lesson_id),
    )
    _act_as(c, "other_teacher")
    substitute_response = c["client"].put(
        _builder_url(c),
        json=_valid_payload(c["lesson"].lesson_id),
    )

    assert owner_response.status_code == 403
    assert substitute_response.status_code == 200


@pytest.mark.parametrize("archive_class", [False, True])
def test_historical_or_archived_builder_is_read_only(quiz_api_context, archive_class):
    c = quiz_api_context
    _create_builder(c)
    if archive_class:
        c["class"].class_status = "archived"
    else:
        c["period"].is_active = False
        c["period"].period_sequence = 1
        c["db"].add(AcademicPeriod(
            period_name="Second Quarter",
            period_sequence=2,
            start_date=date(2025, 9, 1),
            end_date=date(2025, 11, 30),
            academic_year_id=c["year"].academic_year_id,
            is_active=True,
        ))
    c["db"].commit()
    before = c["db"].query(Quiz).one().status

    read_response = c["client"].get(_builder_url(c))
    payload = _valid_payload(c["lesson"].lesson_id)
    payload["status"] = "PUBLISHED"
    write_response = c["client"].put(_builder_url(c), json=payload)
    delete_response = c["client"].delete(_builder_url(c))

    assert read_response.status_code == 200
    assert write_response.status_code in {400, 403}
    assert delete_response.status_code in {400, 403}
    c["db"].expire_all()
    assert c["db"].query(Quiz).one().status == before


def test_future_period_allows_unpublished_draft_but_not_publication(quiz_api_context):
    c = quiz_api_context
    future = AcademicPeriod(
        period_name="Second Quarter",
        period_sequence=2,
        start_date=date(2025, 9, 1),
        end_date=date(2025, 11, 30),
        academic_year_id=c["year"].academic_year_id,
        is_active=False,
    )
    c["db"].add(future)
    c["db"].flush()
    c["assignment"].academic_period_id = future.academic_period_id
    c["assignment"].is_published = False
    c["quiz_classwork"].is_published = False
    load = c["db"].query(SubjectLoad).one()
    load.academic_period_id = future.academic_period_id
    c["db"].commit()

    draft = _valid_payload(c["lesson"].lesson_id)
    draft["status"] = "DRAFT"
    draft_response = c["client"].put(_builder_url(c), json=draft)
    published = _valid_payload(c["lesson"].lesson_id)
    published["status"] = "PUBLISHED"
    publish_response = c["client"].put(_builder_url(c), json=published)

    assert draft_response.status_code == 200
    assert publish_response.status_code == 403
    c["db"].expire_all()
    assert c["db"].query(Quiz).one().status == "DRAFT"


def test_cross_year_assignment_scope_rejected_before_builder_mutation(quiz_api_context):
    c = quiz_api_context
    other_year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=False,
    )
    c["db"].add(other_year)
    c["db"].flush()
    other_period = AcademicPeriod(
        period_name="Future First Quarter",
        period_sequence=1,
        start_date=date(2026, 6, 1),
        end_date=date(2026, 8, 31),
        academic_year_id=other_year.academic_year_id,
        is_active=False,
    )
    c["db"].add(other_period)
    c["db"].flush()
    c["assignment"].academic_period_id = other_period.academic_period_id
    c["db"].query(SubjectLoad).one().academic_period_id = other_period.academic_period_id
    c["db"].commit()

    response = c["client"].put(
        _builder_url(c),
        json=_valid_payload(c["lesson"].lesson_id),
    )

    assert response.status_code == 403
    assert c["db"].query(Quiz).count() == 0


def test_grading_requires_authorized_load_and_preserves_submission(quiz_api_context):
    c = quiz_api_context
    submission, answers, links = _create_submission(c)
    _act_as(c, "other_teacher")

    response = c["client"].put(
        f"/api/v1/quizzes/submission/{submission.submission_id}/grade",
        json=_grade_payload(links),
    )

    assert response.status_code == 403
    c["db"].expire_all()
    assert c["db"].get(StudentSubmission, submission.submission_id).grade is None
    assert all(c["db"].get(QuizAnswer, answer.answer_id).points_awarded is None for answer in answers)


def test_future_period_live_grading_is_rejected_without_mutation(quiz_api_context):
    c = quiz_api_context
    submission, answers, links = _create_submission(c)
    future = AcademicPeriod(
        period_name="Second Quarter",
        period_sequence=2,
        start_date=date(2025, 9, 1),
        end_date=date(2025, 11, 30),
        academic_year_id=c["year"].academic_year_id,
        is_active=False,
    )
    c["db"].add(future)
    c["db"].flush()
    c["assignment"].academic_period_id = future.academic_period_id
    c["db"].query(SubjectLoad).one().academic_period_id = future.academic_period_id
    c["db"].commit()

    response = c["client"].put(
        f"/api/v1/quizzes/submission/{submission.submission_id}/grade",
        json=_grade_payload(links),
    )

    assert response.status_code == 403
    c["db"].expire_all()
    assert c["db"].get(StudentSubmission, submission.submission_id).grade is None
    assert all(c["db"].get(QuizAnswer, answer.answer_id).points_awarded is None for answer in answers)


def test_finalized_grade_blocks_initial_grading_and_regrading(quiz_api_context):
    c = quiz_api_context
    submission, answers, links = _create_submission(c)
    c["db"].add(StudentPeriodGrade(
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        is_finalized=True,
    ))
    c["db"].commit()

    response = c["client"].put(
        f"/api/v1/quizzes/submission/{submission.submission_id}/grade",
        json=_grade_payload(links),
    )

    assert response.status_code == 409
    c["db"].expire_all()
    assert c["db"].get(StudentSubmission, submission.submission_id).grade is None
    assert all(c["db"].get(QuizAnswer, answer.answer_id).points_awarded is None for answer in answers)


def test_finalized_grade_blocks_regrading_without_changing_prior_score(quiz_api_context):
    c = quiz_api_context
    submission, answers, links = _create_submission(c)
    grade_url = f"/api/v1/quizzes/submission/{submission.submission_id}/grade"
    assert c["client"].put(grade_url, json=_grade_payload(links)).status_code == 200
    c["db"].add(StudentPeriodGrade(
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        is_finalized=True,
    ))
    c["db"].commit()

    response = c["client"].put(
        grade_url,
        json=_grade_payload(links, first_points=0, second_points=0),
    )

    assert response.status_code == 409
    c["db"].expire_all()
    assert float(c["db"].get(StudentSubmission, submission.submission_id).grade) == 10
    assert [
        float(c["db"].get(QuizAnswer, answer.answer_id).points_awarded)
        for answer in answers
    ] == [6, 4]


def test_invalid_grade_payload_causes_no_partial_mutation(quiz_api_context):
    c = quiz_api_context
    submission, answers, links = _create_submission(c)

    response = c["client"].put(
        f"/api/v1/quizzes/submission/{submission.submission_id}/grade",
        json=_grade_payload(links, first_points=5, second_points=99),
    )

    assert response.status_code == 400
    c["db"].expire_all()
    refreshed = c["db"].get(StudentSubmission, submission.submission_id)
    assert (refreshed.grade, refreshed.feedback, refreshed.status) == (None, None, "submitted")
    assert all(c["db"].get(QuizAnswer, answer.answer_id).points_awarded is None for answer in answers)


def test_authorized_current_period_grading_still_succeeds(quiz_api_context):
    c = quiz_api_context
    submission, _, links = _create_submission(c)

    response = c["client"].put(
        f"/api/v1/quizzes/submission/{submission.submission_id}/grade",
        json=_grade_payload(links),
    )

    assert response.status_code == 200
    assert response.json()["grade"] == 10
    assert response.json()["status"] == "graded"

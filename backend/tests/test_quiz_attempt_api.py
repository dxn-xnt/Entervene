import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Quizzes import router as quizzes_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.notifications.Notification import Notification
from app.services.quiz.QuizAttemptService import _summary_release_state
from app.services.quiz.QuizResultsNotificationService import (
    scan_due_quiz_result_releases,
    stage_available_results_for_classwork,
)


TABLES = [
    AcademicYear.__table__,
    AcademicPeriod.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    Subject.__table__,
    GradingTemplate.__table__,
    GradingTemplateComponent.__table__,
    Class.__table__,
    StudentClass.__table__,
    StudentPeriodGrade.__table__,
    Classwork.__table__,
    ClassworkAssignment.__table__,
    StudentSubmission.__table__,
    Quiz.__table__,
    QuizSetting.__table__,
    Question.__table__,
    QuestionOption.__table__,
    QuizQuestion.__table__,
    QuizAnswer.__table__,
]


@pytest.fixture
def quiz_attempt_context():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    lrn_check = next(
        (c for c in Student.__table__.constraints if isinstance(c, CheckConstraint) and c.name == "lrn_check"),
        None,
    )
    if lrn_check and lrn_check in Student.__table__.constraints:
        Student.__table__.constraints.remove(lrn_check)
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        if lrn_check and lrn_check not in Student.__table__.constraints:
            Student.__table__.append_constraint(lrn_check)
    db = sessionmaker(bind=engine)()

    year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add_all([year, level])
    db.flush()
    period = AcademicPeriod(
        period_name="Second Quarter",
        academic_year_id=year.academic_year_id,
        period_sequence=2,
        start_date=date(2025, 9, 1),
        end_date=date(2025, 11, 30),
        is_active=True,
    )
    db.add(period)
    db.flush()

    accounts = {
        name: UserAccount(user_id=uuid.uuid4(), email=f"{name}@example.test", password_hash="x")
        for name in ("teacher", "student", "other_student")
    }
    db.add_all(accounts.values())
    db.flush()
    teacher = AcademicStaff(
        staff_id="T-QUIZ",
        first_name="Quiz",
        last_name="Teacher",
        user_id=accounts["teacher"].user_id,
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789012",
        first_name="Quiz",
        last_name="Student",
        academic_level_id=level.academic_level_id,
        user_id=accounts["student"].user_id,
    )
    other_student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789013",
        first_name="Other",
        last_name="Student",
        academic_level_id=level.academic_level_id,
        user_id=accounts["other_student"].user_id,
    )
    template = GradingTemplate(
        grading_template_id=1,
        template_name="Core",
        passing_threshold=87.0,
        status="active",
    )
    template.components = [
        GradingTemplateComponent(component_name="Written Work", weight=20.0, display_order=1),
        GradingTemplateComponent(component_name="Performance Tasks", weight=50.0, display_order=2),
        GradingTemplateComponent(component_name="Exams", weight=30.0, display_order=3),
    ]
    db.add(template)
    db.flush()
    subject = Subject(
        subject_name="Programming",
        academic_level_id=level.academic_level_id,
        grading_template_id=template.grading_template_id,
    )
    class_ = Class(
        section_name="Sapphire",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add_all([teacher, student, other_student, subject, class_])
    db.flush()
    db.add(StudentClass(
        student_id=student.student_id,
        class_id=class_.class_id,
        academic_year_id=year.academic_year_id,
        enrollment_status="enrolled",
    ))

    classwork = Classwork(
        title="Variables Quiz",
        instructions="Answer every question.",
        classwork_type="QUIZ",
        total_points=Decimal("10.00"),
        subject_id=subject.subject_id,
        created_by_staff_id=teacher.staff_id,
        is_published=True,
    )
    db.add(classwork)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=classwork.classwork_id,
        class_id=class_.class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=teacher.staff_id,
        is_published=True,
        max_attempts=1,
    )
    quiz = Quiz(classwork_id=classwork.classwork_id, total_items=2, status="READY")
    setting = QuizSetting(
        classwork_id=classwork.classwork_id,
        max_attempts=1,
        show_correct_answers=True,
    )
    db.add_all([assignment, quiz, setting])
    db.flush()

    mc = Question(
        question_text="What stores a value?",
        question_type="MULTIPLE_CHOICE",
        points=Decimal("6.00"),
        difficulty_level="EASY",
        is_ai_generated=False,
    )
    short = Question(
        question_text="Explain variables.",
        question_type="SHORT_ANSWER",
        points=Decimal("4.00"),
        difficulty_level="MEDIUM",
        is_ai_generated=False,
    )
    db.add_all([mc, short])
    db.flush()
    correct = QuestionOption(
        question_id=mc.question_id,
        option_text="Variable",
        is_correct=True,
        option_order=1,
    )
    wrong = QuestionOption(
        question_id=mc.question_id,
        option_text="Paintbrush",
        is_correct=False,
        option_order=2,
    )
    mc_link = QuizQuestion(quiz_id=quiz.quiz_id, question_id=mc.question_id, display_order=1)
    short_link = QuizQuestion(quiz_id=quiz.quiz_id, question_id=short.question_id, display_order=2)
    db.add_all([correct, wrong, mc_link, short_link])
    db.commit()

    identity = {"sub": accounts["student"].user_id, "role": "student"}
    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: identity
    with TestClient(app, raise_server_exceptions=False) as client:
        yield {
            "client": client,
            "db": db,
            "identity": identity,
            "accounts": accounts,
            "student": student,
            "other_student": other_student,
            "assignment": assignment,
            "classwork": classwork,
            "class": class_,
            "year": year,
            "period": period,
            "subject": subject,
            "setting": setting,
            "mc_link": mc_link,
            "short_link": short_link,
            "correct": correct,
            "wrong": wrong,
        }
    db.close()
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


def _act_as(context, account_name: str, role: str) -> None:
    context["identity"].update(
        sub=context["accounts"][account_name].user_id,
        role=role,
    )


def _submit_fixture_quiz(context, *, selected_option_id=None, short_answer="Variables store values."):
    return context["client"].post(
        f"/api/v1/quizzes/assignment/{context['assignment'].classwork_assignment_id}/submit",
        json={
            "answers": [
                {
                    "quiz_question_id": context["mc_link"].quiz_question_id,
                    "selected_option_id": selected_option_id or context["correct"].option_id,
                },
                {
                    "quiz_question_id": context["short_link"].quiz_question_id,
                    "answer_text": short_answer,
                },
            ]
        },
    )


def test_student_can_start_resume_and_submit_quiz_with_server_scoring(quiz_attempt_context):
    c = quiz_attempt_context
    assignment_id = c["assignment"].classwork_assignment_id

    attempt = c["client"].get(f"/api/v1/quizzes/assignment/{assignment_id}/attempt")
    assert attempt.status_code == 200
    assert attempt.json()["questions"][0]["options"][0]["is_correct"] is None

    started = c["client"].post(f"/api/v1/quizzes/assignment/{assignment_id}/start")
    assert started.status_code == 200
    assert started.json()["status"] == "pending"
    assert started.json()["started_at"]
    assert started.json()["server_time"]

    submitted = c["client"].post(
        f"/api/v1/quizzes/assignment/{assignment_id}/submit",
        json={
            "answers": [
                {
                    "quiz_question_id": c["mc_link"].quiz_question_id,
                    "selected_option_id": c["correct"].option_id,
                },
                {
                    "quiz_question_id": c["short_link"].quiz_question_id,
                    "answer_text": "Variables store reusable values.",
                },
            ]
        },
    )

    assert submitted.status_code == 200
    body = submitted.json()
    assert body["status"] == "submitted"
    assert body["attempt_count"] == 1
    assert body["grade"] == 6.0
    assert c["db"].query(QuizAnswer).count() == 2


def test_targeted_quiz_reports_total_used_and_remaining_attempts(quiz_attempt_context, monkeypatch):
    from app.services.quiz import QuizAttemptService

    monkeypatch.setattr(QuizAttemptService, "require_remediation_prerequisite", lambda *_args: None)
    c = quiz_attempt_context
    assignment_id = c["assignment"].classwork_assignment_id
    intervention = Intervention(
        intervention_id=9999,
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        source_prediction_id=9999,
        status="ACTIVE",
        activated_at=datetime.now(timezone.utc),
        activated_by_staff_id=c["assignment"].assigned_by_staff_id,
        diagnosis_snapshot={},
        remediation_plan={"selected_resources": []},
    )
    c["db"].add(intervention)
    c["db"].flush()
    c["assignment"].source_intervention_id = intervention.intervention_id
    c["assignment"].recipient_student_id = c["student"].student_id
    c["assignment"].remediation_request_id = uuid.uuid4()
    c["assignment"].max_attempts = 3
    c["setting"].max_attempts = 3
    c["db"].commit()

    first = _submit_fixture_quiz(c)
    assert first.status_code == 200, first.json()
    assert first.json()["max_attempts"] == 3
    assert first.json()["attempts_used"] == 1
    assert first.json()["attempts_remaining"] == 2

    retry = c["client"].post(f"/api/v1/quizzes/assignment/{assignment_id}/start")
    assert retry.status_code == 200
    assert retry.json()["attempt_count"] == 1
    assert retry.json()["attempts_used"] == 1
    assert retry.json()["attempts_remaining"] == 2


def test_unfinished_attempt_never_exposes_evaluation_or_correct_answers(quiz_attempt_context):
    c = quiz_attempt_context
    c["setting"].show_correct_answers = True
    c["setting"].summary_release_mode = "IMMEDIATE"
    c["mc_link"].question.explanation = "The correct answer is Variable."
    c["db"].commit()

    started = c["client"].post(
        f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/start"
    )

    assert started.status_code == 200
    body = started.json()
    assert body["status"] == "pending"
    assert body["summary_available"] is False
    assert body["feedback"] is None
    for question in body["questions"]:
        assert question["points_awarded"] is None
        assert question["is_correct"] is None
        assert question["explanation"] is None
        assert all(option["is_correct"] is None for option in question["options"])


def test_unsubmitted_quiz_never_exposes_feedback_or_solutions(quiz_attempt_context):
    c = quiz_attempt_context
    c["setting"].show_correct_answers = True
    c["setting"].summary_release_mode = "IMMEDIATE"
    c["mc_link"].question.explanation = "The correct answer is Variable."
    c["db"].commit()

    response = c["client"].get(
        f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/attempt"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "not_started"
    assert body["feedback"] is None
    assert body["questions"][0]["explanation"] is None
    assert body["questions"][0]["points_awarded"] is None
    assert body["questions"][0]["is_correct"] is None
    assert all(option["is_correct"] is None for option in body["questions"][0]["options"])


def test_multiple_choice_only_quiz_is_auto_graded(quiz_attempt_context):
    c = quiz_attempt_context
    c["db"].query(QuizQuestion).filter_by(quiz_question_id=c["short_link"].quiz_question_id).delete()
    c["classwork"].total_points = Decimal("6.00")
    c["db"].commit()

    response = c["client"].post(
        f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/submit",
        json={
            "answers": [
                {
                    "quiz_question_id": c["mc_link"].quiz_question_id,
                    "selected_option_id": c["wrong"].option_id,
                }
            ]
        },
    )

    assert response.status_code == 200
    assert response.json()["status"] == "graded"
    assert response.json()["grade"] == 0.0


def test_quiz_summary_is_hidden_until_scheduled_release(quiz_attempt_context):
    c = quiz_attempt_context
    c["setting"].show_correct_answers = True
    c["setting"].summary_release_mode = "SCHEDULED"
    c["setting"].summary_release_at = datetime.now(timezone.utc) + timedelta(days=1)
    c["mc_link"].question.explanation = "The correct answer is Variable."
    c["db"].commit()

    response = c["client"].post(
        f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/submit",
        json={
            "answers": [
                {
                    "quiz_question_id": c["mc_link"].quiz_question_id,
                    "selected_option_id": c["correct"].option_id,
                },
                {
                    "quiz_question_id": c["short_link"].quiz_question_id,
                    "answer_text": "Variables store values.",
                },
            ]
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["summary_available"] is False
    assert body["summary_release_at"] is not None
    assert "will be available" in body["summary_message"]
    assert body["questions"][0]["selected_option_id"] is None
    assert body["questions"][0]["options"][0]["is_correct"] is None
    assert body["questions"][0]["points_awarded"] is None
    assert body["questions"][0]["explanation"] is None

    c["setting"].summary_release_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    c["db"].commit()
    released = c["client"].get(
        f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/attempt"
    )

    assert released.status_code == 200
    released_body = released.json()
    assert released_body["summary_available"] is True
    assert released_body["questions"][0]["selected_option_id"] == c["correct"].option_id
    assert released_body["questions"][0]["options"][0]["is_correct"] is True
    assert released_body["questions"][0]["points_awarded"] == 6.0
    assert released_body["questions"][0]["explanation"] == "The correct answer is Variable."


def test_after_due_date_summary_releases_only_after_due_without_writes(quiz_attempt_context):
    c = quiz_attempt_context
    c["setting"].show_correct_answers = True
    c["setting"].summary_release_mode = "AFTER_DUE_DATE"
    c["assignment"].due_date = datetime.now(timezone.utc) + timedelta(hours=1)
    c["mc_link"].question.explanation = "The correct answer is Variable."
    c["db"].commit()

    submitted = _submit_fixture_quiz(c)
    assert submitted.status_code == 200
    assert submitted.json()["summary_available"] is False
    assert submitted.json()["questions"][0]["points_awarded"] is None
    assert submitted.json()["questions"][0]["explanation"] is None

    submission_id = c["db"].query(StudentSubmission.submission_id).scalar()
    stored_submission = c["db"].get(StudentSubmission, submission_id)
    stored_grade = stored_submission.grade
    stored_attempt_count = stored_submission.attempt_count
    stored_answer_count = c["db"].query(QuizAnswer).count()
    stored_answers = [
        (answer.answer_id, answer.answer_text, answer.points_awarded, answer.is_correct)
        for answer in c["db"].query(QuizAnswer).order_by(QuizAnswer.answer_id).all()
    ]
    period_grade_count = c["db"].query(StudentPeriodGrade).count()

    c["assignment"].due_date = datetime.now(timezone.utc) - timedelta(minutes=1)
    c["db"].commit()
    released = c["client"].get(
        f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/attempt"
    )

    assert released.status_code == 200
    body = released.json()
    assert body["summary_available"] is True
    assert body["questions"][0]["points_awarded"] == 6.0
    assert body["questions"][0]["is_correct"] is True
    assert body["questions"][0]["options"][0]["is_correct"] is True
    assert body["questions"][0]["explanation"] == "The correct answer is Variable."
    stored_submission = c["db"].get(StudentSubmission, submission_id)
    assert stored_submission.grade == stored_grade
    assert stored_submission.attempt_count == stored_attempt_count
    assert c["db"].query(QuizAnswer).count() == stored_answer_count
    assert [
        (answer.answer_id, answer.answer_text, answer.points_awarded, answer.is_correct)
        for answer in c["db"].query(QuizAnswer).order_by(QuizAnswer.answer_id).all()
    ] == stored_answers
    assert c["db"].query(StudentPeriodGrade).count() == period_grade_count


def test_never_release_hides_score_and_all_question_feedback(quiz_attempt_context):
    c = quiz_attempt_context
    c["setting"].show_correct_answers = True
    c["setting"].summary_release_mode = "NEVER"
    c["mc_link"].question.explanation = "The correct answer is Variable."
    c["db"].commit()

    response = _submit_fixture_quiz(c)

    assert response.status_code == 200
    body = response.json()
    assert body["grade"] is None
    assert body["summary_available"] is False
    assert "not available" in body["summary_message"]
    for question in body["questions"]:
        assert question["answer_text"] is None
        assert question["selected_option_id"] is None
        assert question["points_awarded"] is None
        assert question["is_correct"] is None
        assert question["explanation"] is None
        assert all(option["is_correct"] is None for option in question["options"])


@pytest.mark.parametrize("release_mode", ["SCHEDULED", "AFTER_DUE_DATE"])
def test_release_mode_missing_required_date_fails_closed(quiz_attempt_context, release_mode):
    c = quiz_attempt_context
    c["setting"].show_correct_answers = True
    c["setting"].summary_release_mode = release_mode
    c["setting"].summary_release_at = None
    c["assignment"].due_date = None
    c["db"].commit()

    response = _submit_fixture_quiz(c)

    assert response.status_code == 200
    body = response.json()
    assert body["grade"] is None
    assert body["summary_available"] is False
    assert body["summary_release_at"] is None
    assert "currently unavailable" in body["summary_message"]
    assert body["questions"][0]["selected_option_id"] is None
    assert body["questions"][0]["points_awarded"] is None
    assert body["questions"][0]["is_correct"] is None
    assert body["questions"][0]["explanation"] is None
    assert all(option["is_correct"] is None for option in body["questions"][0]["options"])


def test_unsupported_release_mode_fails_closed():
    setting = SimpleNamespace(
        summary_release_mode="UNSUPPORTED",
        summary_release_at=None,
    )
    assignment = SimpleNamespace(due_date=None)
    submission = SimpleNamespace(status="graded")

    available, release_at, message = _summary_release_state(setting, assignment, submission)

    assert available is False
    assert release_at is None
    assert "currently unavailable" in message


def test_legacy_mixed_visibility_fails_closed_even_when_summary_is_released(quiz_attempt_context):
    c = quiz_attempt_context
    c["setting"].show_correct_answers = False
    c["setting"].summary_release_mode = "IMMEDIATE"
    c["mc_link"].question.explanation = "The correct answer is Variable."
    c["db"].commit()

    response = c["client"].post(
        f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/submit",
        json={
            "answers": [
                {
                    "quiz_question_id": c["mc_link"].quiz_question_id,
                    "selected_option_id": c["wrong"].option_id,
                },
                {
                    "quiz_question_id": c["short_link"].quiz_question_id,
                    "answer_text": "Variables store values.",
                },
            ]
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["summary_available"] is True
    assert body["show_scores"] is False
    assert body["grade"] is None
    assert body["questions"][0]["selected_option_id"] is None
    assert body["questions"][0]["points_awarded"] is None
    assert body["questions"][0]["options"][0]["is_correct"] is None
    assert body["questions"][0]["explanation"] is None
    assert body["questions"][1]["answer_text"] is None


def test_hidden_results_redact_released_summary_and_follow_current_setting(quiz_attempt_context):
    c = quiz_attempt_context
    assignment_id = c["assignment"].classwork_assignment_id
    c["classwork"].show_scores = False
    c["setting"].enable_per_question_scoring = True
    c["setting"].show_correct_answers = True
    c["setting"].summary_release_mode = "IMMEDIATE"
    c["mc_link"].question.explanation = "The correct answer is Variable."
    c["db"].commit()

    submitted = _submit_fixture_quiz(c, selected_option_id=c["wrong"].option_id)

    assert submitted.status_code == 200
    hidden = submitted.json()
    assert hidden["summary_available"] is True
    assert hidden["show_scores"] is False
    assert hidden["grade"] is None
    assert hidden["passing_threshold"] is None
    for question in hidden["questions"]:
        assert question["answer_text"] is None
        assert question["selected_option_id"] is None
        assert question["points_awarded"] is None
        assert question["is_correct"] is None
        assert question["explanation"] is None
        assert all(option["is_correct"] is None for option in question["options"])

    c["classwork"].show_scores = True
    c["db"].commit()
    visible = c["client"].get(f"/api/v1/quizzes/assignment/{assignment_id}/attempt")
    assert visible.status_code == 200
    assert visible.json()["grade"] == 0.0
    assert visible.json()["questions"][0]["selected_option_id"] == c["wrong"].option_id
    assert visible.json()["questions"][0]["points_awarded"] == 0.0
    assert visible.json()["questions"][0]["is_correct"] is False
    assert visible.json()["questions"][0]["options"][0]["is_correct"] is True

    c["classwork"].show_scores = False
    c["db"].commit()
    hidden_again = c["client"].get(f"/api/v1/quizzes/assignment/{assignment_id}/attempt")
    assert hidden_again.status_code == 200
    assert hidden_again.json()["grade"] is None
    assert hidden_again.json()["questions"][0]["selected_option_id"] is None
    assert hidden_again.json()["questions"][0]["points_awarded"] is None
    assert hidden_again.json()["questions"][0]["is_correct"] is None
    assert hidden_again.json()["questions"][0]["options"][0]["is_correct"] is None

    c["classwork"].show_scores = True
    c["setting"].show_correct_answers = False
    c["db"].commit()
    mixed_legacy = c["client"].get(f"/api/v1/quizzes/assignment/{assignment_id}/attempt")
    assert mixed_legacy.status_code == 200
    assert mixed_legacy.json()["show_scores"] is False
    assert mixed_legacy.json()["grade"] is None
    assert mixed_legacy.json()["questions"][0]["points_awarded"] is None


def test_immediate_release_returns_nonblank_explanation_only_with_correct_answers_enabled(
    quiz_attempt_context,
):
    c = quiz_attempt_context
    c["setting"].show_correct_answers = True
    c["setting"].summary_release_mode = "IMMEDIATE"
    c["mc_link"].question.explanation = "The correct answer is Variable."
    c["short_link"].question.explanation = "This essay explanation must wait for grading."
    c["db"].commit()

    response = _submit_fixture_quiz(c)

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "submitted"
    assert body["summary_available"] is True
    assert body["feedback"] is None
    assert body["questions"][0]["explanation"] == "The correct answer is Variable."
    assert body["questions"][1]["points_awarded"] is None
    assert body["questions"][1]["is_correct"] is None
    assert body["questions"][1]["explanation"] is None


def test_blank_or_missing_explanations_are_returned_as_none(quiz_attempt_context):
    c = quiz_attempt_context
    c["setting"].show_correct_answers = True
    c["setting"].summary_release_mode = "IMMEDIATE"
    c["mc_link"].question.explanation = "   "
    c["short_link"].question.explanation = None
    c["db"].commit()

    response = _submit_fixture_quiz(c)

    assert response.status_code == 200
    assert all(question["explanation"] is None for question in response.json()["questions"])


def test_partially_graded_response_releases_explanation_and_exact_teacher_feedback(
    quiz_attempt_context,
):
    c = quiz_attempt_context
    c["setting"].show_correct_answers = True
    c["setting"].summary_release_mode = "IMMEDIATE"
    c["mc_link"].question.explanation = "The correct answer is Variable."
    c["short_link"].question.explanation = "A variable stores a reusable value."
    c["db"].commit()

    submitted = _submit_fixture_quiz(c)
    assert submitted.status_code == 200
    submitted_body = submitted.json()
    assert submitted_body["questions"][0]["explanation"] == "The correct answer is Variable."
    assert submitted_body["questions"][1]["explanation"] is None

    submission = c["db"].query(StudentSubmission).one()
    essay_answer = c["db"].query(QuizAnswer).filter(
        QuizAnswer.submission_id == submission.submission_id,
        QuizAnswer.quiz_question_id == c["short_link"].quiz_question_id,
    ).one()
    essay_answer.points_awarded = Decimal("2.00")
    essay_answer.is_correct = None
    submission.grade = Decimal("8.00")
    submission.status = "graded"
    submission.feedback = "Good foundation; add one concrete example."
    c["db"].commit()

    result = c["client"].get(
        f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/attempt"
    )

    assert result.status_code == 200
    body = result.json()
    assert body["feedback"] == "Good foundation; add one concrete example."
    assert body["questions"][1]["points_awarded"] == 2.0
    assert body["questions"][1]["is_correct"] is None
    assert body["questions"][1]["explanation"] == "A variable stores a reusable value."


def test_teacher_feedback_is_withheld_from_student_without_releasing_never_summary(
    quiz_attempt_context,
):
    c = quiz_attempt_context
    c["setting"].show_correct_answers = True
    c["setting"].summary_release_mode = "NEVER"
    c["mc_link"].question.explanation = "The correct answer is Variable."
    c["db"].commit()
    assert _submit_fixture_quiz(c).status_code == 200

    submission = c["db"].query(StudentSubmission).one()
    submission.status = "graded"
    submission.feedback = "Review variables before the next lesson."
    c["db"].commit()

    result = c["client"].get(
        f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/attempt"
    )

    assert result.status_code == 200
    body = result.json()
    assert body["summary_available"] is False
    assert body["feedback"] is None
    assert all(question["explanation"] is None for question in body["questions"])

    _act_as(c, "other_student", "student")
    unauthorized = c["client"].get(
        f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/attempt"
    )
    assert unauthorized.status_code == 403
    assert "Review variables" not in unauthorized.text
    assert "correct answer" not in unauthorized.text


def test_identification_accepted_keys_are_not_invented_as_a_display_answer(quiz_attempt_context):
    c = quiz_attempt_context
    c["setting"].show_correct_answers = True
    c["setting"].summary_release_mode = "IMMEDIATE"
    c["short_link"].question.question_type = "IDENTIFICATION"
    c["short_link"].question.explanation = "Review the scientist discussed in class."
    c["db"].add_all([
        QuestionOption(
            question_id=c["short_link"].question_id,
            option_text="Isaac Newton",
            is_correct=True,
            option_order=1,
        ),
        QuestionOption(
            question_id=c["short_link"].question_id,
            option_text="Sir Isaac Newton",
            is_correct=True,
            option_order=2,
        ),
    ])
    c["db"].commit()

    response = _submit_fixture_quiz(c, short_answer="Albert Einstein")

    assert response.status_code == 200
    body = response.json()
    identification = body["questions"][1]
    assert identification["question_type"] == "IDENTIFICATION"
    assert identification["answer_text"] == "Albert Einstein"
    assert identification["is_correct"] is False
    assert identification["options"] == []
    assert identification["explanation"] == "Review the scientist discussed in class."
    assert "Isaac Newton" not in response.text
    assert "Sir Isaac Newton" not in response.text


def test_started_retake_restores_own_answers_without_prior_evaluation_or_solutions(quiz_attempt_context):
    c = quiz_attempt_context
    assignment_id = c["assignment"].classwork_assignment_id
    c["assignment"].max_attempts = 2
    c["setting"].max_attempts = 2
    c["setting"].show_correct_answers = True
    c["setting"].summary_release_mode = "IMMEDIATE"
    c["mc_link"].question.explanation = "A variable is the authoritative solution."
    c["short_link"].question.question_type = "IDENTIFICATION"
    c["short_link"].question.explanation = "The accepted answer is Isaac Newton."
    c["db"].add(QuestionOption(
        question_id=c["short_link"].question_id,
        option_text="Isaac Newton",
        is_correct=True,
        option_order=1,
    ))
    c["db"].commit()

    submitted = c["client"].post(
        f"/api/v1/quizzes/assignment/{assignment_id}/submit",
        json={
            "answers": [
                {
                    "quiz_question_id": c["mc_link"].quiz_question_id,
                    "selected_option_id": c["correct"].option_id,
                },
                {
                    "quiz_question_id": c["short_link"].quiz_question_id,
                    "answer_text": "Albert Einstein",
                },
            ]
        },
    )
    assert submitted.status_code == 200
    submitted_body = submitted.json()
    assert submitted_body["status"] == "graded"
    assert submitted_body["can_submit"] is True
    # While retake is available, correctness markers, answer keys, and explanations remain hidden
    assert submitted_body["questions"][0]["options"][0]["is_correct"] is None
    assert submitted_body["questions"][0]["is_correct"] is None
    assert submitted_body["questions"][0]["explanation"] is None
    submission = c["db"].query(StudentSubmission).one()
    submission.feedback = "The previous attempt feedback must not survive a retake."
    c["db"].commit()

    restarted = c["client"].post(f"/api/v1/quizzes/assignment/{assignment_id}/start")

    assert restarted.status_code == 200
    body = restarted.json()
    assert body["status"] == "pending"
    assert body["summary_available"] is False
    assert body["grade"] is None
    assert body["feedback"] is None
    assert body["questions"][0]["selected_option_id"] == c["correct"].option_id
    assert body["questions"][0]["points_awarded"] is None
    assert body["questions"][0]["is_correct"] is None
    assert body["questions"][0]["explanation"] is None
    assert all(option["is_correct"] is None for option in body["questions"][0]["options"])
    assert body["questions"][1]["answer_text"] == "Albert Einstein"
    assert body["questions"][1]["points_awarded"] is None
    assert body["questions"][1]["is_correct"] is None
    assert body["questions"][1]["explanation"] is None
    assert "Isaac Newton" not in restarted.text
    assert "authoritative solution" not in restarted.text


def test_multi_attempt_withholds_answers_until_final_attempt(quiz_attempt_context):
    c = quiz_attempt_context
    assignment_id = c["assignment"].classwork_assignment_id
    c["assignment"].max_attempts = 2
    c["setting"].max_attempts = 2
    c["setting"].show_correct_answers = True
    c["setting"].summary_release_mode = "IMMEDIATE"
    c["mc_link"].question.explanation = "Authoritative MC explanation."
    c["short_link"].question.question_type = "IDENTIFICATION"
    c["db"].add(QuestionOption(
        question_id=c["short_link"].question_id,
        option_text="Isaac Newton",
        is_correct=True,
        option_order=1,
    ))
    c["db"].commit()

    # Attempt 1 submitted (1 of 2 max attempts)
    sub1 = c["client"].post(
        f"/api/v1/quizzes/assignment/{assignment_id}/submit",
        json={
            "answers": [
                {"quiz_question_id": c["mc_link"].quiz_question_id, "selected_option_id": c["correct"].option_id},
                {"quiz_question_id": c["short_link"].quiz_question_id, "answer_text": "Isaac Newton"},
            ]
        },
    )
    assert sub1.status_code == 200
    b1 = sub1.json()
    assert b1["attempt_count"] == 1
    assert b1["can_submit"] is True  # Retake permitted
    # Correctness and solutions MUST be hidden while retake is available
    assert b1["questions"][0]["options"][0]["is_correct"] is None
    assert b1["questions"][0]["is_correct"] is None
    assert b1["questions"][0]["explanation"] is None

    # Student checks attempt endpoint between attempts
    check = c["client"].get(f"/api/v1/quizzes/assignment/{assignment_id}/attempt")
    assert check.status_code == 200
    cb = check.json()
    assert cb["can_submit"] is True
    assert cb["questions"][0]["options"][0]["is_correct"] is None
    assert cb["questions"][0]["is_correct"] is None
    assert cb["questions"][0]["explanation"] is None

    # Student starts and submits Attempt 2 (final attempt: attempt_count becomes 2 == max_attempts)
    c["client"].post(f"/api/v1/quizzes/assignment/{assignment_id}/start")
    sub2 = c["client"].post(
        f"/api/v1/quizzes/assignment/{assignment_id}/submit",
        json={
            "answers": [
                {"quiz_question_id": c["mc_link"].quiz_question_id, "selected_option_id": c["correct"].option_id},
                {"quiz_question_id": c["short_link"].quiz_question_id, "answer_text": "Isaac Newton"},
            ]
        },
    )
    assert sub2.status_code == 200
    b2 = sub2.json()
    assert b2["attempt_count"] == 2
    assert b2["can_submit"] is False  # No more retakes
    # Now that the final attempt is completed and release mode is IMMEDIATE, solutions ARE released
    assert b2["questions"][0]["options"][0]["is_correct"] is True
    assert b2["questions"][0]["is_correct"] is True
    assert b2["questions"][0]["explanation"] == "Authoritative MC explanation."



def test_quiz_submit_allows_unanswered_items_for_timed_autosubmit(quiz_attempt_context):
    c = quiz_attempt_context

    response = c["client"].post(
        f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/submit",
        json={
            "answers": [
                {"quiz_question_id": c["mc_link"].quiz_question_id},
                {"quiz_question_id": c["short_link"].quiz_question_id, "answer_text": ""},
            ]
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "graded"
    assert body["grade"] == 0.0
    assert c["db"].query(QuizAnswer).count() == 2


def test_quiz_submit_finalizes_once_and_requires_explicit_retake_start(quiz_attempt_context):
    c = quiz_attempt_context
    c["assignment"].max_attempts = 2
    c["setting"].max_attempts = 2
    c["db"].commit()

    first = _submit_fixture_quiz(c)
    assert first.status_code == 200
    assert first.json()["attempt_count"] == 1
    stored_answers = c["db"].query(QuizAnswer).count()

    repeated = _submit_fixture_quiz(c)
    assert repeated.status_code == 409
    assert "already finalized" in repeated.json()["detail"]
    submission = c["db"].query(StudentSubmission).one()
    assert submission.attempt_count == 1
    assert c["db"].query(QuizAnswer).count() == stored_answers

    started = c["client"].post(
        f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/start"
    )
    assert started.status_code == 200
    assert started.json()["status"] == "pending"
    second = _submit_fixture_quiz(c)
    assert second.status_code == 200
    assert second.json()["attempt_count"] == 2


def test_scheduled_quiz_results_notification_is_due_authorized_and_idempotent(
    quiz_attempt_context,
):
    c = quiz_attempt_context
    release_at = datetime.now(timezone.utc) + timedelta(hours=2)
    c["setting"].summary_release_mode = "SCHEDULED"
    c["setting"].summary_release_at = release_at
    c["setting"].show_correct_answers = True
    c["classwork"].show_scores = True
    c["db"].commit()
    assert _submit_fixture_quiz(c).status_code == 200

    before = scan_due_quiz_result_releases(
        c["db"], now=release_at - timedelta(seconds=1),
    )
    assert before["sent"] == 0
    assert c["db"].query(Notification).count() == 0

    due = scan_due_quiz_result_releases(c["db"], now=release_at)
    assert due["sent"] == 1
    notice = c["db"].query(Notification).one()
    assert notice.notification_type == "quiz_results_available"
    assert notice.action_url.endswith(
        f"/student/quiz/{c['assignment'].classwork_assignment_id}/result"
    )
    assert c["subject"].subject_name in notice.body
    assert c["classwork"].title in notice.body
    assert str(c["db"].query(StudentSubmission).one().grade) not in notice.body
    privacy_text = f"{notice.title} {notice.body}".lower()
    assert "score" not in privacy_text
    assert "feedback" not in privacy_text
    assert "correct answer" not in privacy_text
    assert "answer key" not in privacy_text

    repeated = scan_due_quiz_result_releases(
        c["db"], now=release_at + timedelta(days=1),
    )
    assert repeated["sent"] == 0
    assert c["db"].query(Notification).count() == 1


def test_changed_or_hidden_release_policy_does_not_emit_stale_result_notice(
    quiz_attempt_context,
):
    c = quiz_attempt_context
    original_release = datetime.now(timezone.utc) + timedelta(hours=2)
    c["setting"].summary_release_mode = "SCHEDULED"
    c["setting"].summary_release_at = original_release
    c["setting"].show_correct_answers = True
    c["classwork"].show_scores = True
    c["db"].commit()
    assert _submit_fixture_quiz(c).status_code == 200

    # Moving the boundary must make the former boundary inert.
    c["setting"].summary_release_at = original_release + timedelta(days=1)
    c["db"].commit()
    old_boundary = scan_due_quiz_result_releases(
        c["db"], now=original_release + timedelta(seconds=1),
    )
    assert old_boundary["sent"] == 0

    # Hiding results before the new boundary must also prevent both the
    # scheduled and explicit-release producers from creating a notice.
    c["setting"].summary_release_mode = "NEVER"
    c["setting"].summary_release_at = None
    c["setting"].show_correct_answers = False
    c["classwork"].show_scores = False
    c["db"].commit()
    after_hidden = scan_due_quiz_result_releases(
        c["db"], now=original_release + timedelta(days=2),
    )
    assert after_hidden["sent"] == 0
    assert stage_available_results_for_classwork(
        c["db"], c["classwork"].classwork_id,
        now=original_release + timedelta(days=2),
    ) == 0
    assert c["db"].query(Notification).count() == 0


def test_manual_immediate_release_stages_only_privacy_safe_notice(quiz_attempt_context):
    c = quiz_attempt_context
    c["setting"].summary_release_mode = "NEVER"
    c["setting"].show_correct_answers = False
    c["classwork"].show_scores = False
    c["db"].commit()
    assert _submit_fixture_quiz(c).status_code == 200
    assert c["db"].query(Notification).count() == 0

    c["setting"].summary_release_mode = "IMMEDIATE"
    c["setting"].show_correct_answers = True
    c["classwork"].show_scores = True
    assert stage_available_results_for_classwork(
        c["db"], c["classwork"].classwork_id,
    ) == 1
    c["db"].commit()

    notice = c["db"].query(Notification).one()
    assert notice.notification_type == "quiz_results_available"
    assert notice.title == "Quiz Results Available"
    privacy_text = f"{notice.title} {notice.body}".lower()
    assert "score" not in privacy_text
    assert "feedback" not in privacy_text
    assert "correct answer" not in privacy_text
    assert "answer key" not in privacy_text


def test_quiz_attempt_rejects_unenrolled_locked_closed_and_over_limit(quiz_attempt_context):
    c = quiz_attempt_context
    assignment_id = c["assignment"].classwork_assignment_id

    _act_as(c, "other_student", "student")
    assert c["client"].get(f"/api/v1/quizzes/assignment/{assignment_id}/attempt").status_code == 403

    _act_as(c, "student", "student")
    c["assignment"].lock_date = datetime.now(timezone.utc) + timedelta(days=1)
    c["db"].commit()
    assert c["client"].post(f"/api/v1/quizzes/assignment/{assignment_id}/start").status_code == 403

    c["assignment"].lock_date = None
    c["assignment"].due_date = datetime.now(timezone.utc) - timedelta(minutes=1)
    c["db"].commit()
    assert c["client"].post(f"/api/v1/quizzes/assignment/{assignment_id}/start").status_code == 403

    c["assignment"].due_date = None
    c["assignment"].max_attempts = 1
    c["db"].add(StudentSubmission(
        student_id=c["student"].student_id,
        classwork_assignment_id=assignment_id,
        status="graded",
        attempt_count=1,
    ))
    c["db"].commit()
    assert c["client"].post(f"/api/v1/quizzes/assignment/{assignment_id}/start").status_code == 403


@pytest.mark.parametrize(
    ("period_sequence", "expected_detail"),
    [
        (1, "Academic period is closed"),
        (3, "Academic period is not yet active"),
    ],
)
def test_quiz_start_and_submit_reject_non_current_periods_without_mutation(
    quiz_attempt_context,
    period_sequence,
    expected_detail,
):
    c = quiz_attempt_context
    blocked_period = AcademicPeriod(
        period_name="Blocked Quarter",
        academic_year_id=c["year"].academic_year_id,
        period_sequence=period_sequence,
        start_date=date(2025, 6, 1) if period_sequence == 1 else date(2025, 12, 1),
        end_date=date(2025, 8, 31) if period_sequence == 1 else date(2026, 2, 28),
        is_active=False,
    )
    c["db"].add(blocked_period)
    c["db"].flush()
    c["assignment"].academic_period_id = blocked_period.academic_period_id
    c["db"].commit()

    assignment_id = c["assignment"].classwork_assignment_id
    start = c["client"].post(f"/api/v1/quizzes/assignment/{assignment_id}/start")
    submit = c["client"].post(
        f"/api/v1/quizzes/assignment/{assignment_id}/submit",
        json={"answers": []},
    )

    assert start.status_code == 403
    assert expected_detail in start.json()["detail"]
    assert submit.status_code == 403
    assert expected_detail in submit.json()["detail"]
    assert c["db"].query(StudentSubmission).count() == 0


def test_quiz_start_and_submit_reject_archived_class_without_mutation(quiz_attempt_context):
    c = quiz_attempt_context
    c["class"].class_status = "archived"
    c["db"].commit()
    assignment_id = c["assignment"].classwork_assignment_id

    start = c["client"].post(f"/api/v1/quizzes/assignment/{assignment_id}/start")
    submit = c["client"].post(
        f"/api/v1/quizzes/assignment/{assignment_id}/submit",
        json={"answers": []},
    )

    assert start.status_code == 403
    assert "archived" in start.json()["detail"].lower()
    assert submit.status_code == 403
    assert c["db"].query(StudentSubmission).count() == 0


def test_quiz_start_and_submit_reject_finalized_period_grade_without_mutation(quiz_attempt_context):
    c = quiz_attempt_context
    c["db"].add(StudentPeriodGrade(
        student_id=c["student"].student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        is_finalized=True,
    ))
    c["db"].commit()
    assignment_id = c["assignment"].classwork_assignment_id

    start = c["client"].post(f"/api/v1/quizzes/assignment/{assignment_id}/start")
    submit = c["client"].post(
        f"/api/v1/quizzes/assignment/{assignment_id}/submit",
        json={"answers": []},
    )

    assert start.status_code == 409
    assert start.json()["detail"] == "The period grade is finalized"
    assert submit.status_code == 409
    assert c["db"].query(StudentSubmission).count() == 0


def test_quiz_start_rejects_unscoped_legacy_assignment(quiz_attempt_context):
    c = quiz_attempt_context
    c["assignment"].academic_period_id = None
    c["db"].commit()

    response = c["client"].post(
        f"/api/v1/quizzes/assignment/{c['assignment'].classwork_assignment_id}/start"
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Quiz has an unscoped academic period"
    assert c["db"].query(StudentSubmission).count() == 0


def test_quiz_submit_validates_complete_and_scoped_answers(quiz_attempt_context):
    c = quiz_attempt_context
    assignment_id = c["assignment"].classwork_assignment_id

    incomplete = c["client"].post(
        f"/api/v1/quizzes/assignment/{assignment_id}/submit",
        json={
            "answers": [
                {
                    "quiz_question_id": c["mc_link"].quiz_question_id,
                    "selected_option_id": c["correct"].option_id,
                }
            ]
        },
    )
    assert incomplete.status_code == 400

    wrong_option = c["client"].post(
        f"/api/v1/quizzes/assignment/{assignment_id}/submit",
        json={
            "answers": [
                {
                    "quiz_question_id": c["mc_link"].quiz_question_id,
                    "selected_option_id": 999999,
                },
                {
                    "quiz_question_id": c["short_link"].quiz_question_id,
                    "answer_text": "Variables store values.",
                },
            ]
        },
    )
    assert wrong_option.status_code == 400


def test_quiz_identification_spelling_auto_grading(quiz_attempt_context):
    c = quiz_attempt_context
    assignment_id = c["assignment"].classwork_assignment_id

    # Set question to IDENTIFICATION and add correct option key
    c["short_link"].question.question_type = "IDENTIFICATION"
    sa_option = QuestionOption(
        question_id=c["short_link"].question_id,
        option_text="Isaac Newton",
        is_correct=True,
        option_order=1,
    )
    c["db"].add(sa_option)
    c["db"].commit()

    # Submit attempt with exact spelling (case-insensitive & trimmed)
    res = c["client"].post(
        f"/api/v1/quizzes/assignment/{assignment_id}/submit",
        json={
            "answers": [
                {
                    "quiz_question_id": c["mc_link"].quiz_question_id,
                    "selected_option_id": c["correct"].option_id,
                },
                {
                    "quiz_question_id": c["short_link"].quiz_question_id,
                    "answer_text": "  isaac newton  ",
                },
            ]
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "graded"
    assert float(data["grade"]) == 10.0


def test_editing_intervention_quiz_attempt_limit_after_submission_updates_remaining_without_data_loss(
    quiz_attempt_context,
):
    c = quiz_attempt_context
    assignment_id = c["assignment"].classwork_assignment_id
    classwork_id = c["classwork"].classwork_id
    c["assignment"].max_attempts = 3
    c["setting"].max_attempts = 3
    c["db"].commit()

    first = _submit_fixture_quiz(c)
    assert first.status_code == 200, first.json()
    assert first.json()["max_attempts"] == 3
    assert first.json()["attempts_used"] == 1
    assert first.json()["attempts_remaining"] == 2
    saved_grade = first.json()["grade"]

    from app.schemas.Quiz import QuizConfigurationUpdate
    from app.services.quiz.QuizBuilderService import update_quiz_configuration

    quiz = c["db"].query(Quiz).filter_by(classwork_id=classwork_id).one()
    updated = update_quiz_configuration(
        c["db"],
        c["classwork"],
        QuizConfigurationUpdate(
            duration_minutes=quiz.duration_minutes,
            is_shuffle_questions=c["setting"].is_shuffle_questions,
            enable_per_question_scoring=c["setting"].enable_per_question_scoring,
            enable_per_question_time_limits=c["setting"].enable_per_question_time_limits,
            max_attempts=5,
        ),
    )
    c["db"].commit()
    assert updated.max_attempts == 5
    assert updated.has_attempts is True
    c["db"].refresh(c["assignment"])
    c["db"].refresh(c["setting"])
    assert c["assignment"].max_attempts == 5
    assert c["setting"].max_attempts == 5

    after_edit = c["client"].get(f"/api/v1/quizzes/assignment/{assignment_id}/attempt")
    assert after_edit.status_code == 200, after_edit.json()
    body = after_edit.json()
    assert body["max_attempts"] == 5
    assert body["attempt_count"] == 1
    assert body["attempts_used"] == 1
    assert body["attempts_remaining"] == 4
    assert body["grade"] == saved_grade
    assert len(body["questions"]) == 2


def test_student_my_assignments_and_grade_notifications_enforce_quiz_release_policy(quiz_attempt_context):
    c = quiz_attempt_context
    db = c["db"]
    student = c["student"]
    assignment = c["assignment"]
    classwork = c["classwork"]
    setting = c["setting"]

    from app.models.academic.SubjectLoad import SubjectLoad
    db.add(SubjectLoad(
        staff_id=classwork.created_by_staff_id,
        class_id=assignment.class_id,
        subject_id=classwork.subject_id,
        academic_period_id=assignment.academic_period_id,
        status="active",
        is_active_version=True,
    ))

    # Submit and grade a quiz while results are scheduled in the future
    setting.show_correct_answers = True
    setting.summary_release_mode = "SCHEDULED"
    setting.summary_release_at = datetime.now(timezone.utc) + timedelta(days=2)
    db.commit()

    submitted = _submit_fixture_quiz(c)
    assert submitted.status_code == 200
    submission = db.query(StudentSubmission).one()

    from app.models.notifications.Notification import Notification
    from app.schemas.Submission import GradeRequest
    from app.services.classwork.ClassworkService import student_assignments
    from app.services.submission.SubmissionService import grade_student_submission

    # Grade via submission service while scheduled release is still in the future
    grade_student_submission(
        submission.submission_id,
        GradeRequest(grade=9.0, feedback="Hidden teacher feedback"),
        classwork.created_by_staff_id,
        db,
    )

    # No grade_released notification may leak the score before release
    notifs = db.query(Notification).filter(
        Notification.user_id == student.user_id,
        Notification.notification_type == "grade_released",
    ).all()
    assert notifs == []

    # /my-assignments must hide the score before scheduled release
    before = student_assignments(student, db)["graded"][0]
    assert before["grade"] is None
    assert before["show_scores"] is False

    # Legacy mixed visibility must also hide the score
    setting.summary_release_mode = "IMMEDIATE"
    setting.summary_release_at = None
    setting.show_correct_answers = False
    db.commit()
    mixed = student_assignments(student, db)["graded"][0]
    assert mixed["grade"] is None
    assert mixed["show_scores"] is False

    # Once released, /my-assignments exposes the grade and grading notifies the student
    setting.show_correct_answers = True
    db.commit()
    after = student_assignments(student, db)["graded"][0]
    assert after["grade"] == 9.0
    assert after["show_scores"] is True

    grade_student_submission(
        submission.submission_id,
        GradeRequest(grade=10.0, feedback="Hidden teacher feedback"),
        classwork.created_by_staff_id,
        db,
    )
    released_notifs = db.query(Notification).filter(
        Notification.user_id == student.user_id,
        Notification.notification_type == "grade_released",
    ).all()
    assert len(released_notifs) == 1
    assert "10.0" in released_notifs[0].body


def test_started_published_quiz_allows_due_date_and_release_policy_update_without_readiness_error(
    quiz_attempt_context,
):
    """Teachers can adjust due date and release policy after attempts start without spurious readiness errors."""
    c = quiz_attempt_context
    db = c["db"]
    classwork = c["classwork"]
    assignment = c["assignment"]
    staff_id = classwork.created_by_staff_id

    from app.models.academic.SubjectLoad import SubjectLoad
    db.add(SubjectLoad(
        staff_id=staff_id,
        class_id=assignment.class_id,
        subject_id=classwork.subject_id,
        academic_period_id=assignment.academic_period_id,
        status="active",
        is_active_version=True,
    ))
    db.commit()

    # Start a student attempt so questions are frozen
    started = c["client"].post(
        f"/api/v1/quizzes/assignment/{assignment.classwork_assignment_id}/start"
    )
    assert started.status_code == 200

    # Simulate an existing published quiz with a legacy readiness mismatch
    # (e.g. unmapped question or mismatched points) that cannot be edited post-attempt.
    c["mc_link"].question.lesson_id = None
    db.commit()

    from app.schemas.Classwork import ClassworkAssignRequest, ClassworkUpdate
    from app.schemas.Quiz import QuizResultsSettingsUpdate
    from app.services.classwork.ClassworkService import (
        assign_classwork_to_classes,
        update_classwork_record,
    )
    from app.services.quiz.QuizBuilderService import update_quiz_results_settings

    # Metadata edit on already-started published quiz must not fail readiness
    updated_cw = update_classwork_record(
        classwork.classwork_id,
        ClassworkUpdate(title="Updated Started Quiz", is_published=True),
        staff_id,
        db,
    )
    assert updated_cw.title == "Updated Started Quiz"

    # Setting a due date on already-started published quiz must not fail readiness
    due_at = datetime.now(timezone.utc) + timedelta(days=3)
    assign_result = assign_classwork_to_classes(
        classwork.classwork_id,
        ClassworkAssignRequest(
            class_ids=[assignment.class_id],
            due_date=due_at,
            is_published=True,
        ),
        staff_id,
        db,
    )
    assert assignment.class_id in assign_result["updated_class_ids"]

    # Switching release policy to AFTER_DUE_DATE succeeds cleanly
    release_res = update_quiz_results_settings(
        db,
        classwork,
        QuizResultsSettingsUpdate(
            release_policy="AFTER_DUE_DATE",
            confirm_answer_reveal=True,
        ),
    )
    assert release_res.release_policy == "AFTER_DUE_DATE"
    assert release_res.show_scores is True
    assert release_res.show_correct_answers is True

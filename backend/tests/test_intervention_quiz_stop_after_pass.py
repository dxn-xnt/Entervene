"""Regression tests for stopping Intervention/Study Support quiz attempts after passing."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
import uuid

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
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.models.classwork.RemediationReadingPrerequisite import RemediationReadingPrerequisite
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.quiz.QuizAttemptService import STUDY_SUPPORT_QUIZ_PASSED_MESSAGE


@pytest.fixture
def intervention_quiz_env():
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
    level = AcademicLevel(level_name="Grade 9", grade_level=9)
    db.add_all([year, level])
    db.flush()

    period = AcademicPeriod(
        period_name="First Quarter",
        academic_year_id=year.academic_year_id,
        period_sequence=1,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 9, 30),
        is_active=True,
    )
    db.add(period)
    db.flush()

    teacher_user = UserAccount(user_id=uuid.uuid4(), email="teacher@example.test", password_hash="x")
    student_user = UserAccount(user_id=uuid.uuid4(), email="student@example.test", password_hash="x")
    db.add_all([teacher_user, student_user])
    db.flush()

    teacher = AcademicStaff(
        staff_id="T-INT-QUIZ",
        first_name="Remedial",
        last_name="Teacher",
        user_id=teacher_user.user_id,
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789099",
        first_name="Study",
        last_name="Learner",
        academic_level_id=level.academic_level_id,
        user_id=student_user.user_id,
    )
    template = GradingTemplate(
        template_name="Math 80 Passing",
        passing_threshold=Decimal("80.00"),
        status="active",
    )
    db.add_all([teacher, student, template])
    db.flush()

    subject = Subject(
        subject_codename="MATH9",
        subject_name="Mathematics 9",
        academic_level_id=level.academic_level_id,
        grading_template_id=template.grading_template_id,
    )
    db.add(subject)
    db.flush()

    class_ = Class(
        section_name="Section Archimedes",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    db.add(class_)
    db.flush()

    db.add(StudentClass(
        student_id=student.student_id,
        class_id=class_.class_id,
        academic_year_id=year.academic_year_id,
        enrollment_status="enrolled",
    ))

    # Required reading + review so remediation prerequisite is satisfied
    reading_cw = Classwork(
        title="Foundations Reading",
        classwork_type="READING",
        is_graded=False,
        is_published=True,
        is_archived=False,
        subject_id=subject.subject_id,
        created_by_staff_id=teacher.staff_id,
    )
    db.add(reading_cw)
    db.flush()
    reading_asgn = ClassworkAssignment(
        classwork_id=reading_cw.classwork_id,
        class_id=class_.class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=teacher.staff_id,
        is_published=True,
    )
    db.add(reading_asgn)
    db.flush()

    intervention = Intervention(
        student_id=student.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        academic_period_id=period.academic_period_id,
        source_prediction_id=1,
        status="ACTIVE",
        activated_by_staff_id=teacher.staff_id,
        activated_at=datetime.now(timezone.utc),
        diagnosis_snapshot={},
        remediation_plan={"selected_resources": [{"kind": "CLASSWORK", "id": reading_cw.classwork_id}]},
    )
    db.add(intervention)
    db.flush()

    db.add(InterventionReadingReview(
        intervention_id=intervention.intervention_id,
        reading_assignment_id=reading_asgn.classwork_assignment_id,
        student_id=student.student_id,
        review_cycle=1,
        acknowledged_at=datetime.now(timezone.utc),
    ))

    def _build_quiz_assignment(*, is_intervention: bool, show_scores: bool = True, max_attempts: int = 3):
        # 20-point quiz: Q1=15 pts, Q2=2 pts, Q3=3 pts
        # -> Q1 only = 15/20 = 75% (below 80%)
        # -> Q1 + Q2 = 17/20 = 85% (above 80%, less than 100%)
        # -> All 3   = 20/20 = 100%
        cw = Classwork(
            title="Study Support Quiz" if is_intervention else "Regular Class Quiz",
            classwork_type="QUIZ",
            classwork_category="WRITTEN_WORK",
            is_graded=True,
            total_points=Decimal("20.00"),
            subject_id=subject.subject_id,
            is_published=True,
            show_scores=show_scores,
            created_by_staff_id=teacher.staff_id,
        )
        db.add(cw)
        db.flush()
        asgn = ClassworkAssignment(
            classwork_id=cw.classwork_id,
            class_id=class_.class_id,
            academic_period_id=period.academic_period_id,
            assigned_by_staff_id=teacher.staff_id,
            due_date=datetime.now(timezone.utc) + timedelta(days=2),
            max_attempts=max_attempts,
            is_published=True,
            recipient_student_id=student.student_id if is_intervention else None,
            source_intervention_id=intervention.intervention_id if is_intervention else None,
            remediation_request_id=uuid.uuid4() if is_intervention else None,
        )
        db.add(asgn)
        db.flush()

        if is_intervention:
            db.add(RemediationReadingPrerequisite(
                remediation_assignment_id=asgn.classwork_assignment_id,
                reading_classwork_id=reading_cw.classwork_id,
                reading_assignment_id=reading_asgn.classwork_assignment_id,
                display_order=1,
            ))

        quiz = Quiz(classwork_id=cw.classwork_id, status="PUBLISHED", duration_minutes=30, total_items=3)
        setting = QuizSetting(
            classwork_id=cw.classwork_id,
            max_attempts=max_attempts,
            show_correct_answers=show_scores,
            summary_release_mode="IMMEDIATE",
        )
        db.add_all([quiz, setting])
        db.flush()

        links = []
        for idx, pts in enumerate((Decimal("15.00"), Decimal("2.00"), Decimal("3.00")), start=1):
            q = Question(
                question_text=f"Question {idx}",
                question_type="MULTIPLE_CHOICE",
                points=pts,
            )
            db.add(q)
            db.flush()
            opt_ok = QuestionOption(question_id=q.question_id, option_text="Right", is_correct=True, option_order=1)
            opt_no = QuestionOption(question_id=q.question_id, option_text="Wrong", is_correct=False, option_order=2)
            db.add_all([opt_ok, opt_no])
            db.flush()
            link = QuizQuestion(quiz_id=quiz.quiz_id, question_id=q.question_id, display_order=idx)
            db.add(link)
            db.flush()
            links.append((link, opt_ok, opt_no))

        db.commit()
        return {"classwork": cw, "assignment": asgn, "quiz": quiz, "setting": setting, "links": links}

    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(student_user.user_id),
        "role": "student",
    }

    client = TestClient(app)

    def submit_score(bundle, *, q1_correct: bool, q2_correct: bool, q3_correct: bool):
        aid = bundle["assignment"].classwork_assignment_id
        flags = (q1_correct, q2_correct, q3_correct)
        answers = [
            {
                "quiz_question_id": link.quiz_question_id,
                "selected_option_id": ok.option_id if is_ok else no.option_id,
            }
            for (link, ok, no), is_ok in zip(bundle["links"], flags)
        ]
        return client.post(f"/api/v1/quizzes/assignment/{aid}/submit", json={"answers": answers})

    yield {
        "db": db,
        "client": client,
        "student": student,
        "intervention": intervention,
        "build_quiz": _build_quiz_assignment,
        "submit_score": submit_score,
    }
    db.close()


def test_passing_first_attempt_below_100_percent_blocks_second_and_third_attempts(intervention_quiz_env):
    env = intervention_quiz_env
    bundle = env["build_quiz"](is_intervention=True, show_scores=True, max_attempts=3)
    aid = bundle["assignment"].classwork_assignment_id

    # Attempt 1: 17/20 = 85% (>= 80% threshold, < 100%)
    res = env["submit_score"](bundle, q1_correct=True, q2_correct=True, q3_correct=False)
    assert res.status_code == 200, res.json()
    body = res.json()
    assert body["is_intervention_quiz"] is True
    assert body["is_passed"] is True
    assert body["passing_threshold"] == 80.0
    assert body["grade"] == 17.0
    assert body["attempts_used"] == 1
    assert body["attempts_remaining"] == 0
    assert body["can_submit"] is False

    submission = env["db"].query(StudentSubmission).filter_by(classwork_assignment_id=aid).one()
    original_submitted_at = submission.submitted_at
    original_graded_at = submission.graded_at
    original_answer_ids = [a.answer_id for a in env["db"].query(QuizAnswer).filter_by(submission_id=submission.submission_id).all()]

    # Direct API attempt to start Attempt 2 is rejected
    start_blocked = env["client"].post(f"/api/v1/quizzes/assignment/{aid}/start")
    assert start_blocked.status_code == 403
    assert start_blocked.json()["detail"] == STUDY_SUPPORT_QUIZ_PASSED_MESSAGE

    # Direct API attempt to submit Attempt 2 is also rejected
    submit_blocked = env["submit_score"](bundle, q1_correct=False, q2_correct=False, q3_correct=False)
    assert submit_blocked.status_code == 403
    assert submit_blocked.json()["detail"] == STUDY_SUPPORT_QUIZ_PASSED_MESSAGE

    # Attempt history, score, timestamps, and answers remain completely unchanged
    env["db"].expire_all()
    submission_after = env["db"].query(StudentSubmission).filter_by(classwork_assignment_id=aid).one()
    assert submission_after.attempt_count == 1
    assert submission_after.grade == Decimal("17.00")
    assert submission_after.submitted_at == original_submitted_at
    assert submission_after.graded_at == original_graded_at
    after_answer_ids = [a.answer_id for a in env["db"].query(QuizAnswer).filter_by(submission_id=submission_after.submission_id).all()]
    assert after_answer_ids == original_answer_ids


def test_fail_first_then_pass_second_blocks_third_attempt(intervention_quiz_env):
    env = intervention_quiz_env
    bundle = env["build_quiz"](is_intervention=True, show_scores=True, max_attempts=3)
    aid = bundle["assignment"].classwork_assignment_id

    # Attempt 1: 15/20 = 75% (< 80% threshold) -> fails, 2 attempts remain
    first = env["submit_score"](bundle, q1_correct=True, q2_correct=False, q3_correct=False)
    assert first.status_code == 200, first.json()
    b1 = first.json()
    assert b1["is_passed"] is False
    assert b1["grade"] == 15.0
    assert b1["attempts_used"] == 1
    assert b1["attempts_remaining"] == 2
    assert b1["can_submit"] is True

    # Starting Attempt 2 is permitted
    start_second = env["client"].post(f"/api/v1/quizzes/assignment/{aid}/start")
    assert start_second.status_code == 200, start_second.json()
    assert start_second.json()["status"] == "pending"

    # Attempt 2: 17/20 = 85% (>= 80% threshold) -> passes, Attempt 3 blocked
    second = env["submit_score"](bundle, q1_correct=True, q2_correct=True, q3_correct=False)
    assert second.status_code == 200, second.json()
    b2 = second.json()
    assert b2["is_passed"] is True
    assert b2["grade"] == 17.0
    assert b2["attempts_used"] == 2
    assert b2["attempts_remaining"] == 0
    assert b2["can_submit"] is False

    # Attempt 3 is blocked despite unused attempt
    third_start = env["client"].post(f"/api/v1/quizzes/assignment/{aid}/start")
    assert third_start.status_code == 403
    assert third_start.json()["detail"] == STUDY_SUPPORT_QUIZ_PASSED_MESSAGE


def test_failing_all_three_attempts_preserves_existing_max_attempts_behavior(intervention_quiz_env):
    env = intervention_quiz_env
    bundle = env["build_quiz"](is_intervention=True, show_scores=True, max_attempts=3)
    aid = bundle["assignment"].classwork_assignment_id

    for expected_used, expected_rem in ((1, 2), (2, 1), (3, 0)):
        if expected_used > 1:
            assert env["client"].post(f"/api/v1/quizzes/assignment/{aid}/start").status_code == 200
        res = env["submit_score"](bundle, q1_correct=True, q2_correct=False, q3_correct=False)
        assert res.status_code == 200
        body = res.json()
        assert body["is_passed"] is False
        assert body["attempts_used"] == expected_used
        assert body["attempts_remaining"] == expected_rem
        assert body["can_submit"] is (expected_rem > 0)

    fourth = env["client"].post(f"/api/v1/quizzes/assignment/{aid}/start")
    assert fourth.status_code == 403
    assert fourth.json()["detail"] == "Maximum attempts reached"


def test_hidden_results_still_enforces_stop_after_pass_without_leaking_score(intervention_quiz_env):
    env = intervention_quiz_env
    bundle = env["build_quiz"](is_intervention=True, show_scores=False, max_attempts=3)
    aid = bundle["assignment"].classwork_assignment_id

    res = env["submit_score"](bundle, q1_correct=True, q2_correct=True, q3_correct=False)
    assert res.status_code == 200, res.json()
    body = res.json()
    assert body["is_passed"] is True
    assert body["can_submit"] is False
    assert body["show_scores"] is False
    assert body["grade"] is None
    assert body["passing_threshold"] is None

    # DB still preserves the real grade for teacher grading/records
    submission = env["db"].query(StudentSubmission).filter_by(classwork_assignment_id=aid).one()
    assert submission.grade == Decimal("17.00")

    # Attempt 2 is still rejected server-side
    assert env["client"].post(f"/api/v1/quizzes/assignment/{aid}/start").status_code == 403


def test_regular_quiz_remains_unaffected_after_passing_or_perfect_score(intervention_quiz_env):
    env = intervention_quiz_env
    bundle = env["build_quiz"](is_intervention=False, show_scores=True, max_attempts=3)
    aid = bundle["assignment"].classwork_assignment_id

    # Even a 100% score on a regular quiz keeps remaining attempts open
    res = env["submit_score"](bundle, q1_correct=True, q2_correct=True, q3_correct=True)
    assert res.status_code == 200, res.json()
    body = res.json()
    assert body["is_intervention_quiz"] is False
    assert body["is_passed"] is False
    assert body["passing_threshold"] is None
    assert body["attempts_used"] == 1
    assert body["attempts_remaining"] == 2
    assert body["can_submit"] is True

    retake = env["client"].post(f"/api/v1/quizzes/assignment/{aid}/start")
    assert retake.status_code == 200

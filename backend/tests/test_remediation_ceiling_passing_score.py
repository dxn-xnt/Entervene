"""Tests for curated remediation passing score matching the intervention ceiling average."""

from __future__ import annotations

import asyncio
import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
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
from app.models.academic.AcademicYearPassingPolicy import AcademicYearPassingPolicy
from app.models.academic.Class_ import Class
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.classwork.RemediationReadingPrerequisite import RemediationReadingPrerequisite
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.models.notifications.Notification import Notification
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Submission import GradeRequest
from app.services.intervention.InterventionRemediationService import progress
from app.services.intervention.RemediationAttemptPolicy import (
    evaluate_remediation_assessment_pass,
    evaluate_remediation_attempt_state,
    remediation_passing_threshold,
)
from app.services.intervention.StudentPersistentInterventionService import get_active
from app.services.quiz.QuizAttemptService import STUDY_SUPPORT_QUIZ_PASSED_MESSAGE
from app.services.submission.SubmissionService import (
    build_submission_response,
    grade_student_submission,
    submit_student_work,
)


class _FakeForm:
    def multi_items(self):
        return []


class _FakeRequest:
    async def form(self):
        return _FakeForm()


@pytest.fixture
def remediation_ceiling_env():
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

    teacher_user = UserAccount(
        user_id=uuid.uuid4(),
        email="teacher-ceiling@example.test",
        password_hash="x",
        account_status="active",
    )
    student_user = UserAccount(
        user_id=uuid.uuid4(),
        email="student-ceiling@example.test",
        password_hash="x",
        account_status="active",
    )
    role = Role(role_id=1, role_name="teacher")
    db.add_all([teacher_user, student_user, role])
    db.flush()
    db.add(UserRoles(user_id=teacher_user.user_id, role_id=role.role_id))
    db.add(AcademicYearPassingPolicy(
        academic_year_id=year.academic_year_id,
        general_average_threshold=Decimal("85.00"),
        version=1,
        updated_by=teacher_user.user_id,
    ))

    teacher = AcademicStaff(
        staff_id="T-CEILING",
        first_name="Remedial",
        last_name="Teacher",
        user_id=teacher_user.user_id,
    )
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789088",
        first_name="Study",
        last_name="Learner",
        academic_level_id=level.academic_level_id,
        user_id=student_user.user_id,
    )
    # Subject passing threshold intentionally set to 85% to verify curated remediation
    # uses the intervention ceiling rather than falling back to 85%.
    template = GradingTemplate(
        template_name="Core 85 Passing",
        passing_threshold=Decimal("85.00"),
        status="active",
    )
    db.add_all([teacher, student, template])
    db.flush()

    subject = Subject(
        subject_codename="SCI9",
        subject_name="Science 9",
        academic_level_id=level.academic_level_id,
        grading_template_id=template.grading_template_id,
    )
    db.add(subject)
    db.flush()

    class_ = Class(
        section_name="Section Newton",
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
    db.add(SubjectLoad(
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        academic_period_id=period.academic_period_id,
        staff_id=teacher.staff_id,
        status="active",
        is_active_version=True,
    ))

    reading_cw = Classwork(
        title="Review Reading",
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

    model_version = AIModelVersion(
        model_name="test_ceiling_model",
        model_type="REGRESSOR",
        model_purpose="CURRENT_TERM_FINAL_GRADE_PROJECTION",
        algorithm="test",
    )
    db.add(model_version)
    db.flush()

    source_prediction = DevelopmentCurrentTermPrediction(
        student_id=student.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        source_period_id=period.academic_period_id,
        target_period_id=period.academic_period_id,
        model_version_id=model_version.model_version_id,
        revision=1,
        predicted_period_grade=Decimal("78.00"),
        intervention_level="MODERATE_RISK",
        intervention_basis="TEST",
        evidence_snapshot={
            "readiness": {"status": "READY"},
            "projected_final_term_grade_raw": 78.0,
        },
    )
    db.add(source_prediction)
    db.flush()

    def _build_intervention_with_quiz(
        *,
        ceiling: float | Decimal | None,
        create_link: bool = True,
        show_scores: bool = True,
        summary_release_mode: str = "IMMEDIATE",
        is_intervention: bool = True,
        is_graded: bool = True,
        grade_treatment: str = "WRITTEN_WORK",
        question_points: tuple[Decimal, ...] = (
            Decimal("12.00"),
            Decimal("1.00"),
            Decimal("1.00"),
            Decimal("6.00"),
        ),
    ):
        # Default 20-point quiz: Q1=12, Q2=1, Q3=1, Q4=6
        # -> Q1 only          = 12/20 = 60%
        # -> Q1 + Q2          = 13/20 = 65%
        # -> Q1 + Q2 + Q3     = 14/20 = 70%
        # -> All 4            = 20/20 = 100%
        total_points = sum(question_points, Decimal("0"))
        orig_cw = Classwork(
            title="Original Quiz",
            classwork_type="QUIZ",
            classwork_category="WRITTEN_WORK",
            is_graded=True,
            total_points=total_points,
            subject_id=subject.subject_id,
            is_published=True,
            show_scores=True,
            created_by_staff_id=teacher.staff_id,
        )
        db.add(orig_cw)
        db.flush()
        orig_asgn = ClassworkAssignment(
            classwork_id=orig_cw.classwork_id,
            class_id=class_.class_id,
            academic_period_id=period.academic_period_id,
            assigned_by_staff_id=teacher.staff_id,
            is_published=True,
        )
        db.add(orig_asgn)
        db.flush()
        db.add(StudentSubmission(
            student_id=student.student_id,
            classwork_assignment_id=orig_asgn.classwork_assignment_id,
            status="graded",
            grade=Decimal("8.00"),
            attempt_count=1,
        ))

        plan: dict = {
            "teacher_choice": "QUIZ",
            "grade_treatment": grade_treatment,
            "target_assignment_ids": [orig_asgn.classwork_assignment_id],
            "selected_resources": [{"kind": "CLASSWORK", "id": reading_cw.classwork_id}],
        }
        if ceiling is not None:
            plan["score_adjustment_cap"] = float(ceiling)

        intervention = None
        if is_intervention:
            intervention = (
                db.query(Intervention)
                .filter_by(
                    student_id=student.student_id,
                    class_id=class_.class_id,
                    subject_id=subject.subject_id,
                    academic_period_id=period.academic_period_id,
                    status="ACTIVE",
                )
                .first()
            )
            if intervention is None:
                intervention = Intervention(
                    student_id=student.student_id,
                    class_id=class_.class_id,
                    subject_id=subject.subject_id,
                    academic_period_id=period.academic_period_id,
                    source_prediction_id=source_prediction.prediction_id,
                    status="ACTIVE",
                    activated_by_staff_id=teacher.staff_id,
                    activated_at=datetime.now(timezone.utc),
                    diagnosis_snapshot={},
                    remediation_plan=plan,
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
            else:
                intervention.remediation_plan = plan
                db.flush()

        cw = Classwork(
            title="Curated Remediation Quiz" if is_intervention else "Regular Quiz",
            classwork_type="QUIZ",
            classwork_category="WRITTEN_WORK",
            is_graded=is_graded,
            total_points=total_points,
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
            max_attempts=3,
            is_published=True,
            recipient_student_id=student.student_id if is_intervention else None,
            source_intervention_id=intervention.intervention_id if intervention else None,
            remediation_request_id=uuid.uuid4() if is_intervention else None,
        )
        db.add(asgn)
        db.flush()

        link_row = None
        if is_intervention:
            db.add(RemediationReadingPrerequisite(
                remediation_assignment_id=asgn.classwork_assignment_id,
                reading_classwork_id=reading_cw.classwork_id,
                reading_assignment_id=reading_asgn.classwork_assignment_id,
                display_order=1,
            ))
            if create_link and ceiling is not None:
                link_row = RemediationAssignmentLink(
                    source_intervention_id=intervention.intervention_id,
                    remediation_assignment_id=asgn.classwork_assignment_id,
                    original_assignment_id=orig_asgn.classwork_assignment_id,
                    student_id=student.student_id,
                    component="WRITTEN_WORK",
                    score_adjustment_cap=Decimal(str(ceiling)),
                    created_by_staff_id=teacher.staff_id,
                )
                db.add(link_row)

        quiz = Quiz(
            classwork_id=cw.classwork_id,
            status="PUBLISHED",
            duration_minutes=30,
            total_items=len(question_points),
        )
        setting = QuizSetting(
            classwork_id=cw.classwork_id,
            max_attempts=3,
            show_correct_answers=show_scores,
            summary_release_mode=summary_release_mode,
        )
        db.add_all([quiz, setting])
        db.flush()

        q_links = []
        for idx, pts in enumerate(question_points, start=1):
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
            qq = QuizQuestion(quiz_id=quiz.quiz_id, question_id=q.question_id, display_order=idx)
            db.add(qq)
            db.flush()
            q_links.append((qq, opt_ok, opt_no))

        db.commit()
        return {
            "intervention": intervention,
            "orig_assignment": orig_asgn,
            "classwork": cw,
            "assignment": asgn,
            "link": link_row,
            "quiz": quiz,
            "setting": setting,
            "q_links": q_links,
        }

    app = FastAPI()
    app.include_router(quizzes_router, prefix="/api/v1/quizzes")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(student_user.user_id),
        "role": "student",
    }
    client = TestClient(app)

    def submit_flags(bundle, flags: tuple[bool, ...]):
        aid = bundle["assignment"].classwork_assignment_id
        answers = [
            {
                "quiz_question_id": qq.quiz_question_id,
                "selected_option_id": ok.option_id if is_ok else no.option_id,
            }
            for (qq, ok, no), is_ok in zip(bundle["q_links"], flags)
        ]
        return client.post(f"/api/v1/quizzes/assignment/{aid}/submit", json={"answers": answers})

    yield {
        "db": db,
        "client": client,
        "student": student,
        "teacher": teacher,
        "subject": subject,
        "class_": class_,
        "period": period,
        "reading_cw": reading_cw,
        "reading_asgn": reading_asgn,
        "build": _build_intervention_with_quiz,
        "submit_flags": submit_flags,
    }
    db.close()


def test_ceiling_65_score_70_passes_and_blocks_retakes(remediation_ceiling_env):
    env = remediation_ceiling_env
    bundle = env["build"](ceiling=65)
    aid = bundle["assignment"].classwork_assignment_id

    # Score: 14/20 = 70% >= 65% ceiling (even though subject threshold is 85%)
    res = env["submit_flags"](bundle, (True, True, True, False))
    assert res.status_code == 200, res.json()
    body = res.json()
    assert body["grade"] == 14.0
    assert body["passing_threshold"] == 65.0
    assert body["is_passed"] is True
    assert body["attempts_used"] == 1
    assert body["attempts_remaining"] == 0
    assert body["can_submit"] is False
    assert body["needs_teacher_review"] is False

    # Student cannot start another retake once passed
    retake = env["client"].post(f"/api/v1/quizzes/assignment/{aid}/start")
    assert retake.status_code == 403
    assert retake.json()["detail"] == STUDY_SUPPORT_QUIZ_PASSED_MESSAGE

    # Student Study Support active view reflects completion
    student_view = get_active(env["db"], env["student"].student_id, bundle["intervention"].intervention_id)
    act = next(a for a in student_view.activities if a.assignment_id == aid)
    assert act.is_passed is True
    assert act.attempts_remaining == 0
    assert act.needs_teacher_review is False


def test_ceiling_65_score_65_exact_boundary_passes(remediation_ceiling_env):
    env = remediation_ceiling_env
    bundle = env["build"](ceiling=65)

    # Score: 13/20 = 65% == 65% ceiling -> Passed
    res = env["submit_flags"](bundle, (True, True, False, False))
    assert res.status_code == 200, res.json()
    body = res.json()
    assert body["grade"] == 13.0
    assert body["passing_threshold"] == 65.0
    assert body["is_passed"] is True
    assert body["can_submit"] is False
    assert body["attempts_remaining"] == 0


def test_ceiling_65_score_60_fails_and_allows_retake(remediation_ceiling_env):
    env = remediation_ceiling_env
    bundle = env["build"](ceiling=65)

    # Score: 12/20 = 60% < 65% ceiling -> Failed
    res = env["submit_flags"](bundle, (True, False, False, False))
    assert res.status_code == 200, res.json()
    body = res.json()
    assert body["grade"] == 12.0
    assert body["passing_threshold"] == 65.0
    assert body["is_passed"] is False
    assert body["can_submit"] is True
    assert body["attempts_used"] == 1
    assert body["attempts_remaining"] == 2
    assert body["needs_teacher_review"] is False


def test_ceiling_85_score_70_fails(remediation_ceiling_env):
    env = remediation_ceiling_env
    bundle = env["build"](ceiling=85)

    # Score: 14/20 = 70% < 85% ceiling -> Failed
    res = env["submit_flags"](bundle, (True, True, True, False))
    assert res.status_code == 200, res.json()
    body = res.json()
    assert body["grade"] == 14.0
    assert body["passing_threshold"] == 85.0
    assert body["is_passed"] is False
    assert body["can_submit"] is True
    assert body["attempts_remaining"] == 2


def test_decimal_ceiling_and_decimal_score_boundary_consistency(remediation_ceiling_env):
    env = remediation_ceiling_env
    # 20-point quiz: Q1=13.1 (65.5%), Q2=6.9
    bundle = env["build"](
        ceiling=Decimal("65.50"),
        question_points=(Decimal("13.10"), Decimal("6.90")),
    )

    # Exact decimal boundary 13.1/20 = 65.5% >= 65.5% -> Passed
    res = env["submit_flags"](bundle, (True, False))
    assert res.status_code == 200, res.json()
    body = res.json()
    assert body["passing_threshold"] == 65.5
    assert body["is_passed"] is True
    assert body["can_submit"] is False

    # Just below decimal boundary: 13.0/20 = 65.0% < 65.5% -> Failed
    bundle_below = env["build"](
        ceiling=Decimal("65.50"),
        question_points=(Decimal("13.00"), Decimal("7.00")),
    )
    res_below = env["submit_flags"](bundle_below, (True, False))
    assert res_below.status_code == 200, res_below.json()
    body_below = res_below.json()
    assert body_below["passing_threshold"] == 65.5
    assert body_below["is_passed"] is False
    assert body_below["can_submit"] is True


def test_existing_assessment_with_prior_attempts_evaluates_passed_and_preserves_history(remediation_ceiling_env):
    env = remediation_ceiling_env
    db = env["db"]
    bundle = env["build"](ceiling=65)
    aid = bundle["assignment"].classwork_assignment_id

    # Simulate an existing assessment with two previously recorded attempts
    # (Attempt 1: 10/20 = 50%, Attempt 2: 14/20 = 70%) that were previously
    # evaluated against 85% and left open for a 3rd retake.
    sub1 = StudentSubmission(
        student_id=env["student"].student_id,
        classwork_assignment_id=aid,
        status="graded",
        grade=Decimal("10.00"),
        attempt_count=1,
        submitted_at=datetime.now(timezone.utc) - timedelta(hours=2),
        graded_at=datetime.now(timezone.utc) - timedelta(hours=2),
    )
    sub2 = StudentSubmission(
        student_id=env["student"].student_id,
        classwork_assignment_id=aid,
        status="graded",
        grade=Decimal("14.00"),
        attempt_count=2,
        submitted_at=datetime.now(timezone.utc) - timedelta(hours=1),
        graded_at=datetime.now(timezone.utc) - timedelta(hours=1),
    )
    db.add_all([sub1, sub2])
    db.commit()

    # GET attempt now evaluates Attempt 2 (70%) against 65% ceiling -> Passed
    res = env["client"].get(f"/api/v1/quizzes/assignment/{aid}/attempt")
    assert res.status_code == 200, res.json()
    body = res.json()
    assert body["grade"] == 14.0
    assert body["passing_threshold"] == 65.0
    assert body["is_passed"] is True
    assert body["attempts_used"] == 2
    assert body["attempts_remaining"] == 0
    assert body["can_submit"] is False
    assert body["needs_teacher_review"] is False

    # Attempt 3 is blocked while preserving both historical rows untouched
    retake = env["client"].post(f"/api/v1/quizzes/assignment/{aid}/start")
    assert retake.status_code == 403
    subs = (
        db.query(StudentSubmission)
        .filter_by(classwork_assignment_id=aid, student_id=env["student"].student_id)
        .order_by(StudentSubmission.attempt_count.asc())
        .all()
    )
    assert [(s.attempt_count, s.grade) for s in subs] == [
        (1, Decimal("10.00")),
        (2, Decimal("14.00")),
    ]

    # Teacher intervention progress reflects the corrected Passed status & preserved attempt history
    teacher_progress = progress(db, bundle["intervention"])
    prog_item = next(
        x for x in teacher_progress["assigned_remediation"] if x["assignment_id"] == aid
    )
    assert prog_item["is_passed"] is True
    assert prog_item["attempt_count"] == 2
    assert prog_item["attempts_remaining"] == 0
    assert prog_item["needs_teacher_review"] is False
    assert [(h["attempt_count"], h["grade"]) for h in prog_item["attempt_history"]] == [
        (1, 10.0),
        (2, 14.0),
    ]


def test_immutable_link_cap_governs_existing_assessment_if_plan_later_changes(remediation_ceiling_env):
    env = remediation_ceiling_env
    db = env["db"]
    bundle = env["build"](ceiling=65, create_link=True)

    # Suppose the intervention plan's score_adjustment_cap was later modified to 80%
    bundle["intervention"].remediation_plan = {
        **(bundle["intervention"].remediation_plan or {}),
        "score_adjustment_cap": 80.0,
    }
    db.commit()

    # The immutable RemediationAssignmentLink snapshot (65%) still governs this assessment
    threshold = remediation_passing_threshold(db, bundle["assignment"], bundle["classwork"])
    assert threshold == Decimal("65.00")

    res = env["submit_flags"](bundle, (True, True, True, False))  # 14/20 = 70%
    assert res.status_code == 200
    body = res.json()
    assert body["passing_threshold"] == 65.0
    assert body["is_passed"] is True


def test_unlinked_graded_remediation_falls_back_to_intervention_plan_ceiling(remediation_ceiling_env):
    env = remediation_ceiling_env
    db = env["db"]
    bundle = env["build"](ceiling=70, create_link=False)

    threshold = remediation_passing_threshold(db, bundle["assignment"], bundle["classwork"])
    assert threshold == Decimal("70")

    res = env["submit_flags"](bundle, (True, True, True, False))  # 14/20 = 70%
    assert res.status_code == 200
    body = res.json()
    assert body["passing_threshold"] == 70.0
    assert body["is_passed"] is True


def test_passing_on_third_attempt_under_ceiling_does_not_trigger_needs_teacher_review(remediation_ceiling_env):
    env = remediation_ceiling_env
    db = env["db"]
    bundle = env["build"](ceiling=65)
    aid = bundle["assignment"].classwork_assignment_id

    # Attempt 1 & 2: 60% (fail)
    assert env["submit_flags"](bundle, (True, False, False, False)).json()["is_passed"] is False
    assert env["client"].post(f"/api/v1/quizzes/assignment/{aid}/start").status_code == 200
    assert env["submit_flags"](bundle, (True, False, False, False)).json()["is_passed"] is False

    # Attempt 3: 70% (pass under 65% ceiling)
    assert env["client"].post(f"/api/v1/quizzes/assignment/{aid}/start").status_code == 200
    third = env["submit_flags"](bundle, (True, True, True, False))
    assert third.status_code == 200
    body = third.json()
    assert body["is_passed"] is True
    assert body["needs_teacher_review"] is False
    assert body["passing_threshold"] == 65.0
    assert body["attempts_remaining"] == 0

    review_notifs = db.query(Notification).filter_by(
        notification_type="intervention_needs_teacher_review",
    ).all()
    assert review_notifs == []


def test_non_quiz_curated_remediation_uses_configured_ceiling(remediation_ceiling_env):
    env = remediation_ceiling_env
    db = env["db"]
    bundle = env["build"](ceiling=65, create_link=False)
    intervention = bundle["intervention"]

    cw = Classwork(
        title="Remedial Worksheet",
        classwork_type="ASSIGNMENT",
        activity_mode="ONLINE",
        classwork_category="WRITTEN_WORK",
        is_graded=True,
        total_points=Decimal("20.00"),
        subject_id=env["subject"].subject_id,
        created_by_staff_id=env["teacher"].staff_id,
        is_published=True,
        show_scores=True,
    )
    db.add(cw)
    db.flush()
    asgn = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=env["class_"].class_id,
        academic_period_id=env["period"].academic_period_id,
        recipient_student_id=env["student"].student_id,
        source_intervention_id=intervention.intervention_id,
        remediation_request_id=uuid.uuid4(),
        assigned_by_staff_id=env["teacher"].staff_id,
        is_published=True,
        max_attempts=3,
    )
    db.add(asgn)
    db.flush()
    db.add(RemediationAssignmentLink(
        source_intervention_id=intervention.intervention_id,
        remediation_assignment_id=asgn.classwork_assignment_id,
        original_assignment_id=bundle["orig_assignment"].classwork_assignment_id,
        student_id=env["student"].student_id,
        component="WRITTEN_WORK",
        score_adjustment_cap=Decimal("65.00"),
        created_by_staff_id=env["teacher"].staff_id,
    ))
    db.add(RemediationReadingPrerequisite(
        remediation_assignment_id=asgn.classwork_assignment_id,
        reading_classwork_id=env["reading_cw"].classwork_id,
        reading_assignment_id=env["reading_asgn"].classwork_assignment_id,
        display_order=1,
    ))
    db.commit()

    sub = asyncio.run(submit_student_work(
        asgn.classwork_assignment_id,
        _FakeRequest(),
        None,
        env["student"],
        db,
        links=json.dumps([{"url": "https://example.com/work", "title": "Attempt 1"}]),
    ))
    graded = grade_student_submission(
        sub.submission_id,
        GradeRequest(grade=14.0, feedback="Good progress"),
        env["teacher"].staff_id,
        db,
    )
    assert graded.is_intervention_assessment is True
    assert graded.passing_threshold == 65.0
    assert graded.is_passed is True
    assert graded.can_retry is False
    assert graded.attempts_remaining == 0
    assert graded.needs_teacher_review is False


def test_results_release_policies_and_regular_quizzes_unaffected(remediation_ceiling_env):
    env = remediation_ceiling_env

    # 1. Hidden scores on curated remediation still hides grade & passing_threshold while enforcing pass
    hidden_bundle = env["build"](ceiling=65, show_scores=False)
    hidden_res = env["submit_flags"](hidden_bundle, (True, True, True, False))  # 14/20 = 70%
    assert hidden_res.status_code == 200
    hb = hidden_res.json()
    assert hb["is_passed"] is True
    assert hb["can_submit"] is False
    assert hb["show_scores"] is False
    assert hb["grade"] is None
    assert hb["passing_threshold"] is None

    # 2. Summary release mode NEVER still withholds results and summary even after passing
    never_bundle = env["build"](ceiling=65, show_scores=True, summary_release_mode="NEVER")
    never_res = env["submit_flags"](never_bundle, (True, True, True, False))
    assert never_res.status_code == 200
    nb = never_res.json()
    assert nb["is_passed"] is True
    assert nb["can_submit"] is False
    assert nb["show_scores"] is False
    assert nb["grade"] is None
    assert nb["passing_threshold"] is None
    assert nb["summary_available"] is False

    # 3. Regular quiz has no passing threshold and keeps remaining attempts open
    regular_bundle = env["build"](ceiling=None, is_intervention=False)
    reg_res = env["submit_flags"](regular_bundle, (True, True, True, True))  # 100%
    assert reg_res.status_code == 200
    rb = reg_res.json()
    assert rb["is_intervention_quiz"] is False
    assert rb["is_passed"] is False
    assert rb["passing_threshold"] is None
    assert rb["can_submit"] is True
    assert rb["attempts_remaining"] == 2

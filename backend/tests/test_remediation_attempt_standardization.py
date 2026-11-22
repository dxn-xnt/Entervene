"""Targeted tests for standardized 3-attempt remediation policy across all remediation assessment types."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.academic.AcademicYearPassingPolicy import AcademicYearPassingPolicy
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationReadingPrerequisite import RemediationReadingPrerequisite
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.models.notifications.Notification import Notification
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Quiz import QuizAnswerIn, QuizConfigurationUpdate, QuizSubmitRequest
from app.schemas.Submission import GradeRequest
from app.services.classwork.ClassworkService import create_classwork_wizard_record
from app.services.intervention.InterventionReadingReviewService import (
    acknowledge_intervention_reading_review,
)
from app.services.intervention.InterventionRemediationAssessmentCreationService import (
    create_remediation_assessment,
)
from app.services.intervention.InterventionRemediationService import PlanUpdate, progress, save_plan
from app.services.intervention.StudentPersistentInterventionService import get_active
from app.services.quiz.QuizAttemptService import (
    get_student_quiz_attempt,
    start_student_quiz_attempt,
    submit_student_quiz_attempt,
)
from app.services.quiz.QuizBuilderService import update_quiz_configuration
from app.services.submission.SubmissionService import (
    build_submission_response,
    grade_student_submission,
    submit_student_work,
)
from tests.test_intervention_support_materials import _activate
from tests.test_remediation_draft_preflight import (
    _make_classwork_draft,
    _make_quiz_draft,
    _setup_intervention_with_targets,
)
from tests.test_remediation_target_persistence import _make_classwork_target
from tests.test_teacher_intervention_review import (
    _id,
    _staff,
    candidate_context,
)
from tests.test_current_period_live_feature_builder import current_period_context  # noqa: F401


def _ensure_passing_policy(ctx, threshold: str = "75.00"):
    db = ctx["db"]
    year_id = ctx["period"].academic_year_id
    existing = db.query(AcademicYearPassingPolicy).filter_by(academic_year_id=year_id).first()
    if existing is None:
        db.add(AcademicYearPassingPolicy(
            academic_year_id=year_id,
            general_average_threshold=Decimal(threshold),
            version=1,
            updated_by=ctx["staff"].user_id,
        ))
    teacher_user = db.get(UserAccount, ctx["staff"].user_id)
    if teacher_user is not None:
        teacher_user.account_status = "active"
        role = db.query(Role).filter_by(role_name="teacher").first()
        if role is None:
            role = Role(role_id=1, role_name="teacher")
            db.add(role)
            db.flush()
        has_role = db.query(UserRoles).filter_by(
            user_id=teacher_user.user_id, role_id=role.role_id,
        ).first()
        if has_role is None:
            db.add(UserRoles(user_id=teacher_user.user_id, role_id=role.role_id))
    db.commit()


def _attach_auto_graded_quiz(db, classwork: Classwork, *, max_attempts: int = 3):
    quiz = Quiz(classwork_id=classwork.classwork_id, duration_minutes=20, status="PUBLISHED")
    setting = QuizSetting(
        classwork_id=classwork.classwork_id,
        max_attempts=max_attempts,
        show_correct_answers=True,
        summary_release_mode="IMMEDIATE",
    )
    q = Question(
        question_text="What is 2 + 2?",
        question_type="MULTIPLE_CHOICE",
        points=Decimal("10"),
    )
    db.add_all([quiz, setting, q])
    db.flush()
    correct_opt = QuestionOption(question_id=q.question_id, option_text="4", is_correct=True, option_order=1)
    wrong_opt = QuestionOption(question_id=q.question_id, option_text="5", is_correct=False, option_order=2)
    db.add_all([correct_opt, wrong_opt])
    db.flush()
    qq = QuizQuestion(quiz_id=quiz.quiz_id, question_id=q.question_id, display_order=1)
    db.add(qq)
    db.commit()
    return quiz, qq, correct_opt, wrong_opt


class _FakeForm:
    def multi_items(self):
        return []


class _FakeRequest:
    async def form(self):
        return _FakeForm()


def _stage_and_complete_reading_prerequisite(ctx, assignment_id: int):
    db = ctx["db"]
    reading_cw = Classwork(
        title="Prep Reading",
        classwork_type="READING",
        is_graded=False,
        total_points=None,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=_staff(ctx),
        is_published=True,
    )
    db.add(reading_cw)
    db.flush()
    reading_asgn = ClassworkAssignment(
        classwork_id=reading_cw.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=_staff(ctx),
        is_published=True,
    )
    db.add(reading_asgn)
    db.flush()
    db.add(RemediationReadingPrerequisite(
        remediation_assignment_id=assignment_id,
        reading_classwork_id=reading_cw.classwork_id,
        reading_assignment_id=reading_asgn.classwork_assignment_id,
        display_order=1,
    ))
    db.add(InterventionReadingReview(
        intervention_id=_id(ctx),
        reading_assignment_id=reading_asgn.classwork_assignment_id,
        student_id=ctx["student"].student_id,
        review_cycle=1,
    ))
    db.commit()


def _acknowledge_all_prerequisites(db, intervention_id: int, assignment_id: int, student):
    prereqs = db.query(RemediationReadingPrerequisite).filter_by(
        remediation_assignment_id=assignment_id,
    ).all()
    for p in prereqs:
        acknowledge_intervention_reading_review(
            db,
            intervention_id=intervention_id,
            reading_assignment_id=p.reading_assignment_id,
            student=student,
        )


def test_ai_generated_remediation_quiz_defaults_to_three_attempts(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    _ensure_passing_policy(ctx)
    competency, lesson, target, _reading = _setup_intervention_with_targets(
        ctx, "WRITTEN_WORK", 10.0,
    )

    quiz_result = create_remediation_assessment(
        db,
        staff_id=_staff(ctx),
        intervention_id=_id(ctx),
        remediation_request_id=uuid4(),
        target_assignment_id=target.classwork_assignment_id,
        draft_input=_make_quiz_draft(competency.competency_id, lesson.lesson_id, 10.0),
    )
    quiz_assignment = db.get(ClassworkAssignment, quiz_result.classwork_assignment_id)
    quiz_setting = db.query(QuizSetting).filter_by(classwork_id=quiz_result.classwork_id).one()
    assert quiz_assignment is not None
    assert quiz_assignment.max_attempts == 3
    assert quiz_setting.max_attempts == 3


def test_ai_generated_remediation_classwork_defaults_to_three_attempts(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    _ensure_passing_policy(ctx)
    competency, lesson, target, _reading = _setup_intervention_with_targets(
        ctx, "WRITTEN_WORK", 10.0,
    )
    ctx["candidate"].remediation_plan = {
        **(ctx["candidate"].remediation_plan or {}),
        "teacher_choice": "CLASSWORK",
    }
    db.commit()

    cw_draft = _make_classwork_draft(competency.competency_id, lesson.lesson_id, 10.0).model_copy(
        update={"target_component": "WRITTEN_WORK", "grade_treatment": "WRITTEN_WORK"}
    )
    cw_result = create_remediation_assessment(
        db,
        staff_id=_staff(ctx),
        intervention_id=_id(ctx),
        remediation_request_id=uuid4(),
        target_assignment_id=target.classwork_assignment_id,
        draft_input=cw_draft,
    )
    cw_assignment = db.get(ClassworkAssignment, cw_result.classwork_assignment_id)
    assert cw_assignment is not None
    assert cw_assignment.max_attempts == 3


def test_remedial_examination_allows_three_attempts_stops_on_pass_and_locks_with_teacher_review(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    _ensure_passing_policy(ctx, "75.00")
    _activate(ctx)

    # Create an original exam assignment with a failing score
    orig_cw = Classwork(
        title="Midterm Exam",
        classwork_type="QUIZ",
        classwork_category="QUARTERLY_ASSESSMENT",
        exam_subtype="TERM_EXAM",
        is_graded=True,
        total_points=Decimal("10"),
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=_staff(ctx),
        is_published=True,
        show_scores=True,
    )
    db.add(orig_cw)
    db.flush()
    orig_asgn = ClassworkAssignment(
        classwork_id=orig_cw.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=_staff(ctx),
        is_published=True,
        max_attempts=1,
    )
    db.add(orig_asgn)
    db.flush()
    db.add(StudentSubmission(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=orig_asgn.classwork_assignment_id,
        status="graded",
        grade=Decimal("4"),
        attempt_count=1,
    ))
    db.commit()

    # Create remedial examination assignment with standardized 3 attempts
    rem_cw = Classwork(
        title="Remedial Midterm Exam",
        classwork_type="QUIZ",
        classwork_category="QUARTERLY_ASSESSMENT",
        exam_subtype="TERM_EXAM",
        is_graded=True,
        total_points=Decimal("10"),
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=_staff(ctx),
        is_published=True,
        show_scores=True,
    )
    db.add(rem_cw)
    db.flush()
    rem_asgn = ClassworkAssignment(
        classwork_id=rem_cw.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        recipient_student_id=ctx["student"].student_id,
        source_intervention_id=_id(ctx),
        remediation_request_id=uuid4(),
        original_exam_assignment_id=orig_asgn.classwork_assignment_id,
        assigned_by_staff_id=_staff(ctx),
        is_published=True,
        due_date=datetime.now(timezone.utc) + timedelta(days=7),
        max_attempts=3,
    )
    db.add(rem_asgn)
    db.flush()
    _stage_and_complete_reading_prerequisite(ctx, rem_asgn.classwork_assignment_id)
    _quiz, qq, _correct_opt, wrong_opt = _attach_auto_graded_quiz(db, rem_cw, max_attempts=3)

    # Configuration update allows up to 3 attempts and rejects 4
    cfg = update_quiz_configuration(
        db,
        rem_cw,
        QuizConfigurationUpdate(
            duration_minutes=20,
            is_shuffle_questions=False,
            is_shuffle_options=False,
            enable_per_question_scoring=True,
            enable_per_question_time_limits=False,
            max_attempts=3,
            show_correct_answers=True,
            summary_release_mode="IMMEDIATE",
        ),
    )
    assert cfg.max_attempts == 3
    with pytest.raises(HTTPException) as too_many:
        update_quiz_configuration(
            db,
            rem_cw,
            QuizConfigurationUpdate(
                duration_minutes=20,
                is_shuffle_questions=False,
                is_shuffle_options=False,
                enable_per_question_scoring=True,
                enable_per_question_time_limits=False,
                max_attempts=4,
                show_correct_answers=True,
                summary_release_mode="IMMEDIATE",
            ),
        )
    assert too_many.value.status_code == 400

    # Fail Attempts 1, 2, and 3 on the remedial examination
    for expected_attempt in (1, 2, 3):
        started = start_student_quiz_attempt(db, ctx["student"], rem_asgn.classwork_assignment_id)
        assert started.max_attempts == 3
        submitted = submit_student_quiz_attempt(
            db,
            ctx["student"],
            rem_asgn.classwork_assignment_id,
            QuizSubmitRequest(answers=[QuizAnswerIn(quiz_question_id=qq.quiz_question_id, selected_option_id=wrong_opt.option_id)]),
        )
        assert submitted.attempt_count == expected_attempt
        assert submitted.is_passed is False
        assert submitted.needs_teacher_review is (expected_attempt == 3)
        assert submitted.can_submit is (expected_attempt < 3)

    # Attempt 4 is locked with Needs Teacher Review
    with pytest.raises(HTTPException) as locked:
        start_student_quiz_attempt(db, ctx["student"], rem_asgn.classwork_assignment_id)
    assert locked.value.status_code == 403
    assert "needs teacher review" in locked.value.detail.lower()

    # All 3 StudentSubmission rows and QuizAnswer rows are preserved
    subs = db.query(StudentSubmission).filter_by(
        classwork_assignment_id=rem_asgn.classwork_assignment_id,
        student_id=ctx["student"].student_id,
    ).order_by(StudentSubmission.attempt_count.asc()).all()
    assert [s.attempt_count for s in subs] == [1, 2, 3]
    for sub in subs:
        ans = db.query(QuizAnswer).filter_by(submission_id=sub.submission_id).all()
        assert len(ans) == 1

    # Teacher received Needs Teacher Review notification
    review_notifs = db.query(Notification).filter_by(
        user_id=ctx["staff"].user_id,
        notification_type="intervention_needs_teacher_review",
    ).all()
    assert len(review_notifs) == 1
    assert "Needs Teacher Review" in review_notifs[0].title
    assert "3/3" in (review_notifs[0].body or "")

    # Teacher progress and student active intervention expose needs_teacher_review
    prog = progress(db, ctx["candidate"])
    item = next(x for x in prog["assigned_remediation"] if x["assignment_id"] == rem_asgn.classwork_assignment_id)
    assert item["attempt_count"] == 3
    assert item["max_attempts"] == 3
    assert item["attempts_remaining"] == 0
    assert item["needs_teacher_review"] is True
    assert len(item["attempt_history"]) == 3
    assert "Needs Teacher Review" in prog["status_reason"]

    student_view = get_active(db, ctx["student"].student_id, _id(ctx))
    act = next(a for a in student_view.activities if a.assignment_id == rem_asgn.classwork_assignment_id)
    assert act.attempt_count == 3
    assert act.max_attempts == 3
    assert act.attempts_remaining == 0
    assert act.needs_teacher_review is True


def test_non_quiz_remediation_assignment_retries_history_lock_and_notification(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    _ensure_passing_policy(ctx, "75.00")
    _competency, _lesson, target, _reading = _setup_intervention_with_targets(
        ctx, "WRITTEN_WORK", 20.0,
    )
    ctx["candidate"].remediation_plan = {
        **(ctx["candidate"].remediation_plan or {}),
        "teacher_choice": "CLASSWORK",
    }
    db.commit()

    # Reject > 3 attempts on non-quiz remediation
    with pytest.raises(HTTPException) as over_limit:
        asyncio.run(create_classwork_wizard_record(
            title="Remedial Essay Too Many Attempts",
            classwork_type="ASSIGNMENT",
            subject_id=ctx["subject"].subject_id,
            description=None,
            instructions="Write reflection",
            classwork_category="WRITTEN_WORK",
            total_points=20,
            is_published=True,
            class_ids=json.dumps([ctx["class"].class_id]),
            academic_period_id=ctx["period"].academic_period_id,
            lesson_ids="[]",
            due_date=datetime.now(timezone.utc) + timedelta(days=7),
            lock_date=None,
            allow_late_submissions=False,
            max_attempts=4,
            quiz_payload=None,
            rubric_payload=None,
            files=None,
            intervention_id=_id(ctx),
            remediation_request_id=uuid4(),
            original_classwork_assignment_id=target.classwork_assignment_id,
            current_user={"sub": str(ctx["staff"].user_id), "role": "teacher"},
            staff_id=_staff(ctx),
            db=db,
        ))
    assert over_limit.value.status_code == 400

    # Create non-quiz remediation assignment with omitted max_attempts -> defaults to 3
    created = asyncio.run(create_classwork_wizard_record(
        title="Remedial Written Worksheet",
        classwork_type="ASSIGNMENT",
        subject_id=ctx["subject"].subject_id,
        description=None,
        instructions="Complete worksheet",
        classwork_category="WRITTEN_WORK",
        total_points=20,
        is_published=True,
        class_ids=json.dumps([ctx["class"].class_id]),
        academic_period_id=ctx["period"].academic_period_id,
        lesson_ids="[]",
        due_date=datetime.now(timezone.utc) + timedelta(days=7),
        lock_date=None,
        allow_late_submissions=False,
        max_attempts=None,
        quiz_payload=None,
        rubric_payload=None,
        files=None,
        intervention_id=_id(ctx),
        remediation_request_id=uuid4(),
        original_classwork_assignment_id=target.classwork_assignment_id,
        current_user={"sub": str(ctx["staff"].user_id), "role": "teacher"},
        staff_id=_staff(ctx),
        db=db,
    ))
    rem_asgn = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()
    assert rem_asgn.max_attempts == 3
    _acknowledge_all_prerequisites(db, _id(ctx), rem_asgn.classwork_assignment_id, ctx["student"])

    # Attempt 1 -> submit & fail (10/20 = 50% < 75%)
    sub1 = asyncio.run(submit_student_work(
        rem_asgn.classwork_assignment_id,
        _FakeRequest(),
        None,
        ctx["student"],
        db,
        links=json.dumps([{"url": "https://example.com/attempt-1", "title": "Attempt 1"}]),
    ))
    assert sub1.attempt_count == 1
    assert sub1.is_intervention_assessment is True
    assert sub1.max_attempts == 3
    graded1 = grade_student_submission(
        sub1.submission_id,
        GradeRequest(grade=10.0, feedback="Try again with more details"),
        _staff(ctx),
        db,
    )
    assert graded1.is_passed is False
    assert graded1.can_retry is True
    assert graded1.attempts_remaining == 2
    assert graded1.needs_teacher_review is False

    # Attempt 2 -> submit & fail (12/20 = 60% < 75%) — creates new row preserving Attempt 1
    sub2 = asyncio.run(submit_student_work(
        rem_asgn.classwork_assignment_id,
        _FakeRequest(),
        None,
        ctx["student"],
        db,
        links=json.dumps([{"url": "https://example.com/attempt-2", "title": "Attempt 2"}]),
    ))
    assert sub2.submission_id != sub1.submission_id
    assert sub2.attempt_count == 2
    graded2 = grade_student_submission(
        sub2.submission_id,
        GradeRequest(grade=12.0, feedback="Closer, one attempt left"),
        _staff(ctx),
        db,
    )
    assert graded2.can_retry is True
    assert graded2.attempts_remaining == 1
    assert graded2.needs_teacher_review is False

    # Attempt 3 -> submit & fail (14/20 = 70% < 75%) -> locks retries + Needs Teacher Review + notifies teacher
    sub3 = asyncio.run(submit_student_work(
        rem_asgn.classwork_assignment_id,
        _FakeRequest(),
        None,
        ctx["student"],
        db,
        links=json.dumps([{"url": "https://example.com/attempt-3", "title": "Attempt 3"}]),
    ))
    assert sub3.submission_id not in {sub1.submission_id, sub2.submission_id}
    assert sub3.attempt_count == 3
    graded3 = grade_student_submission(
        sub3.submission_id,
        GradeRequest(grade=14.0, feedback="Let us review together"),
        _staff(ctx),
        db,
    )
    assert graded3.is_passed is False
    assert graded3.can_retry is False
    assert graded3.attempts_remaining == 0
    assert graded3.needs_teacher_review is True
    assert [h.attempt_count for h in graded3.attempt_history] == [1, 2, 3]
    assert [h.grade for h in graded3.attempt_history] == [10.0, 12.0, 14.0]

    # Attempt 4 is blocked
    with pytest.raises(HTTPException) as locked:
        asyncio.run(submit_student_work(
            rem_asgn.classwork_assignment_id,
            _FakeRequest(),
            None,
            ctx["student"],
            db,
            links=json.dumps([{"url": "https://example.com/attempt-4", "title": "Attempt 4"}]),
        ))
    assert locked.value.status_code == 403
    assert "needs teacher review" in locked.value.detail.lower()

    # Teacher received Needs Teacher Review notification
    review_notifs = db.query(Notification).filter_by(
        user_id=ctx["staff"].user_id,
        notification_type="intervention_needs_teacher_review",
    ).all()
    assert len(review_notifs) == 1
    assert "Needs Teacher Review" in review_notifs[0].title


def test_non_quiz_remediation_stops_additional_attempts_once_passed(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    _ensure_passing_policy(ctx, "75.00")
    _activate(ctx)

    cw = Classwork(
        title="Remedial Activity",
        classwork_type="ACTIVITY",
        activity_mode="ONLINE",
        classwork_category=None,
        is_graded=False,
        total_points=Decimal("20"),
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=_staff(ctx),
        is_published=True,
        show_scores=True,
    )
    db.add(cw)
    db.flush()
    asgn = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        recipient_student_id=ctx["student"].student_id,
        source_intervention_id=_id(ctx),
        remediation_request_id=uuid4(),
        assigned_by_staff_id=_staff(ctx),
        is_published=True,
        max_attempts=3,
    )
    db.add(asgn)
    db.flush()
    _stage_and_complete_reading_prerequisite(ctx, asgn.classwork_assignment_id)

    sub1 = asyncio.run(submit_student_work(
        asgn.classwork_assignment_id,
        _FakeRequest(),
        None,
        ctx["student"],
        db,
        links=json.dumps([{"url": "https://example.com/pass-1", "title": "Attempt 1"}]),
    ))
    graded1 = grade_student_submission(
        sub1.submission_id,
        GradeRequest(grade=18.0, feedback="Great work"),
        _staff(ctx),
        db,
    )
    assert graded1.is_passed is True
    assert graded1.can_retry is False
    assert graded1.attempts_remaining == 0
    assert graded1.needs_teacher_review is False

    # Passing on Attempt 1 blocks Attempt 2
    with pytest.raises(HTTPException) as passed_err:
        asyncio.run(submit_student_work(
            asgn.classwork_assignment_id,
            _FakeRequest(),
            None,
            ctx["student"],
            db,
            links=json.dumps([{"url": "https://example.com/pass-2", "title": "Attempt 2"}]),
        ))
    assert passed_err.value.status_code == 403
    assert "no further attempts" in passed_err.value.detail.lower()

    # No Needs Teacher Review notification was emitted
    review_notifs = db.query(Notification).filter_by(
        user_id=ctx["staff"].user_id,
        notification_type="intervention_needs_teacher_review",
    ).all()
    assert review_notifs == []


def test_regular_classwork_behavior_is_unchanged(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    _ensure_passing_policy(ctx, "75.00")

    reg_cw = Classwork(
        title="Regular Assignment",
        classwork_type="ASSIGNMENT",
        activity_mode="ONLINE",
        classwork_category="WRITTEN_WORK",
        is_graded=True,
        total_points=Decimal("20"),
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=_staff(ctx),
        is_published=True,
        show_scores=True,
    )
    db.add(reg_cw)
    db.flush()
    reg_asgn = ClassworkAssignment(
        classwork_id=reg_cw.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=_staff(ctx),
        is_published=True,
        max_attempts=None,
    )
    db.add(reg_asgn)
    db.commit()

    sub = asyncio.run(submit_student_work(
        reg_asgn.classwork_assignment_id,
        _FakeRequest(),
        None,
        ctx["student"],
        db,
        links=json.dumps([{"url": "https://example.com/reg", "title": "Regular Work"}]),
    ))
    assert sub.is_intervention_assessment is False
    assert sub.max_attempts is None

    graded = grade_student_submission(
        sub.submission_id,
        GradeRequest(grade=8.0, feedback="Regular score"),
        _staff(ctx),
        db,
    )
    assert graded.is_intervention_assessment is False
    assert graded.needs_teacher_review is False
    assert graded.can_retry is False

    # Regular graded assignment remains immutable (original behavior preserved)
    with pytest.raises(HTTPException) as err:
        asyncio.run(submit_student_work(
            reg_asgn.classwork_assignment_id,
            _FakeRequest(),
            None,
            ctx["student"],
            db,
            links=json.dumps([{"url": "https://example.com/reg-2", "title": "Regular Work 2"}]),
        ))
    assert err.value.status_code == 403
    assert "cannot modify a graded submission" in err.value.detail.lower()

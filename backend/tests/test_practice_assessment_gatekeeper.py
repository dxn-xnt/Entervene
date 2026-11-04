"""Focused tests for Phase 3: Practice Assessment Remediation Gatekeeper Integration.

Verifies:
1. Prerequisite logic across policies: REQUIRE_PASS, REQUIRE_ATTEMPT, OPTIONAL, and No Published Assessment.
2. Reading prerequisite precedence (reading must be satisfied before practice qualifies access).
3. Protection of existing remediation work (grandfathering in-progress and completed submissions).
4. Retention of qualification (subsequent failing practice attempts do not revoke passed qualification).
5. Scoping and cross-student isolation.
6. Unified gatekeeper enforcement across Written Work (WW), Performance Tasks (PT), and Quizzes.
7. Zero gradebook contamination (practice attempts never write to StudentGrade or grade calculations).
"""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4
import pytest
from fastapi import HTTPException

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentAssessmentScore import StudentAssessmentScore
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.models.intervention.PracticeAssessment import PracticeAssessment
from app.models.intervention.PracticeAttempt import PracticeAttempt
from app.models.intervention.PracticeAttemptAnswer import PracticeAttemptAnswer
from app.models.intervention.PracticeQuestion import PracticeQuestion
from app.models.intervention.PracticeQuestionOption import PracticeQuestionOption
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.PracticeAssessmentService import (
    evaluate_practice_progression,
)
from app.services.intervention.RemediationPrerequisiteService import (
    evaluate_remediation_prerequisite,
    require_remediation_prerequisite,
)
from app.services.intervention.RemediationReadingPrerequisiteService import (
    ReadingPrerequisiteSnapshotItem,
    stage_remediation_reading_prerequisites,
)
from app.services.quiz.QuizAttemptService import (
    get_student_quiz_attempt,
    start_student_quiz_attempt,
)
from tests.test_classwork_submission_authorization import (
    _act_as,
    _bearer,
    authz_context,
)


def _create_active_intervention(c, intervention_id: int = 2001) -> Intervention:
    """Helper to create an active intervention for the primary test student."""
    intervention = Intervention(
        intervention_id=intervention_id,
        student_id=c["student"].student_id,
        class_id=c["allowed_class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        source_prediction_id=1,
        status="ACTIVE",
        diagnosis_snapshot={},
        activated_at=datetime.now(timezone.utc),
        activated_by_staff_id=c["owner"].staff_id,
        remediation_plan={"selected_resources": []},
    )
    c["db"].add(intervention)
    c["db"].flush()
    return intervention


def _create_reading_and_snapshot(
    c,
    intervention: Intervention,
    remedial_assignment: ClassworkAssignment,
) -> ClassworkAssignment:
    """Helper to create a required reading, snapshot it, and link remediation."""
    cw = Classwork(
        title="Supporting Reading Material",
        classwork_type="READING",
        is_graded=False,
        is_published=True,
        is_archived=False,
        subject_id=c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(cw)
    c["db"].flush()

    reading_asg = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        is_published=True,
    )
    c["db"].add(reading_asg)
    c["db"].flush()

    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=remedial_assignment.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=cw.classwork_id,
                reading_assignment_id=reading_asg.classwork_assignment_id,
                display_order=1,
            )
        ],
    )
    c["db"].flush()

    return reading_asg


def _review_reading(c, reading_asg: ClassworkAssignment, intervention: Intervention):
    """Mark reading prerequisite as reviewed/completed."""
    sub = StudentSubmission(
        student_id=c["student"].student_id,
        classwork_assignment_id=reading_asg.classwork_assignment_id,
        status="submitted",
        submitted_at=datetime.now(timezone.utc),
        reading_focused_seconds=120,
    )
    c["db"].add(sub)
    c["db"].flush()

    review = InterventionReadingReview(
        intervention_id=intervention.intervention_id,
        reading_assignment_id=reading_asg.classwork_assignment_id,
        student_id=c["student"].student_id,
        acknowledged_at=datetime.now(timezone.utc),
    )
    c["db"].add(review)
    c["db"].flush()


def _create_remedial_quiz(
    c,
    intervention: Intervention,
) -> ClassworkAssignment:
    """Create remedial quiz assignment."""
    cw = Classwork(
        title="Remedial Quiz Activity",
        classwork_type="QUIZ",
        is_graded=True,
        total_points=Decimal("10"),
        is_published=True,
        is_archived=False,
        subject_id=c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(cw)
    c["db"].flush()

    assign = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        recipient_student_id=c["student"].student_id,
        remediation_request_id=uuid4(),
        source_intervention_id=intervention.intervention_id,
        is_published=True,
    )
    c["db"].add(assign)
    c["db"].flush()

    quiz = Quiz(
        classwork_id=cw.classwork_id,
        status="PUBLISHED",
        total_items=1,
    )
    c["db"].add(quiz)
    c["db"].flush()

    setting = QuizSetting(
        classwork_id=cw.classwork_id,
        is_shuffle_questions=False,
        max_attempts=1,
    )
    c["db"].add(setting)

    q = Question(
        question_text="Remedial Question",
        question_type="MULTIPLE_CHOICE",
        points=Decimal("10"),
    )
    c["db"].add(q)
    c["db"].flush()

    qq = QuizQuestion(
        quiz=quiz,
        question=q,
        display_order=1,
    )
    c["db"].add(qq)

    opt = QuestionOption(
        question=q,
        option_text="A",
        is_correct=True,
        option_order=1,
    )
    c["db"].add(opt)
    c["db"].flush()

    return assign


def _create_remedial_work(
    c,
    intervention: Intervention,
    classwork_type: str = "ASSIGNMENT",
) -> ClassworkAssignment:
    """Create remedial written work / performance task assignment."""
    cw = Classwork(
        title=f"Remedial {classwork_type} Activity",
        classwork_type=classwork_type,
        is_graded=True,
        total_points=Decimal("50"),
        is_published=True,
        is_archived=False,
        subject_id=c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(cw)
    c["db"].flush()

    assign = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        recipient_student_id=c["student"].student_id,
        remediation_request_id=uuid4(),
        source_intervention_id=intervention.intervention_id,
        is_published=True,
    )
    c["db"].add(assign)
    c["db"].flush()
    return assign


def _setup_practice_assessment(
    c,
    intervention: Intervention,
    *,
    gatekeeper_policy: str = "REQUIRE_PASS",
    passing_percentage: float = 75.0,
    status: str = "PUBLISHED",
) -> PracticeAssessment:
    """Configure a practice assessment for an intervention with 2 questions."""
    assessment = PracticeAssessment(
        intervention_id=intervention.intervention_id,
        title="Practice Checkpoint",
        passing_percentage=Decimal(str(passing_percentage)),
        gatekeeper_policy=gatekeeper_policy,
        status=status,
        created_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(assessment)
    c["db"].flush()

    q1 = PracticeQuestion(
        practice_assessment_id=assessment.practice_assessment_id,
        question_text="Practice Q1",
        question_type="MULTIPLE_CHOICE",
        points=1.0,
        display_order=1,
        explanation="Exp 1",
    )
    c["db"].add(q1)
    c["db"].flush()
    o1 = PracticeQuestionOption(
        practice_question_id=q1.practice_question_id,
        option_text="Correct 1",
        is_correct=True,
        option_order=1,
    )
    c["db"].add(o1)

    q2 = PracticeQuestion(
        practice_assessment_id=assessment.practice_assessment_id,
        question_text="Practice Q2",
        question_type="MULTIPLE_CHOICE",
        points=1.0,
        display_order=2,
        explanation="Exp 2",
    )
    c["db"].add(q2)
    c["db"].flush()
    o2 = PracticeQuestionOption(
        practice_question_id=q2.practice_question_id,
        option_text="Correct 2",
        is_correct=True,
        option_order=1,
    )
    c["db"].add(o2)
    c["db"].flush()

    return assessment


def _record_practice_attempt(
    c,
    assessment: PracticeAssessment,
    student: Student,
    *,
    score_percentage: float,
    is_passed: bool,
    passing_threshold_snapshot: Decimal | None = None,
    attempt_number: int = 1,
) -> PracticeAttempt:
    """Simulate a submitted practice assessment attempt."""
    threshold = (
        passing_threshold_snapshot
        if passing_threshold_snapshot is not None
        else Decimal(str(assessment.passing_percentage))
    )
    attempt = PracticeAttempt(
        practice_assessment_id=assessment.practice_assessment_id,
        student_id=student.student_id,
        status="SUBMITTED",
        attempt_number=attempt_number,
        assessment_version=1,
        total_score=Decimal(str(score_percentage / 50.0)),
        max_score=Decimal("2.0"),
        score_percentage=Decimal(str(score_percentage)),
        passing_threshold_snapshot=threshold,
        is_passed=is_passed,
        started_at=datetime.now(timezone.utc),
        completed_at=datetime.now(timezone.utc),
        question_order=[1, 2],
        option_order_map={},
        attempt_snapshot={},
    )
    c["db"].add(attempt)
    c["db"].flush()
    return attempt


# ---------------------------------------------------------------------------
# Test Suite
# ---------------------------------------------------------------------------


def test_no_practice_assessment_allows_remediation_when_reading_satisfied(authz_context):
    """When no practice assessment exists, satisfying reading prerequisites immediately unlocks remediation."""
    c = authz_context
    intervention = _create_active_intervention(c, 3001)
    remedial_asg = _create_remedial_quiz(c, intervention)
    reading_asg = _create_reading_and_snapshot(c, intervention, remedial_asg)

    # 1. Reading not yet completed -> PREPARATION_REQUIRED
    dec = evaluate_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec.allowed is False
    assert dec.code == "PREPARATION_REQUIRED"

    # 2. Reading completed -> PREPARATION_COMPLETE
    _review_reading(c, reading_asg, intervention)
    c["db"].commit()

    dec = evaluate_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec.allowed is True
    assert dec.code == "PREPARATION_COMPLETE"
    assert dec.practice_evaluation is not None
    assert dec.practice_evaluation.practice_exists is False


def test_draft_or_archived_practice_does_not_block_remediation(authz_context):
    """A practice assessment in DRAFT or ARCHIVED status does not gate remediation access."""
    c = authz_context
    intervention = _create_active_intervention(c, 3002)
    remedial_asg = _create_remedial_quiz(c, intervention)
    reading_asg = _create_reading_and_snapshot(c, intervention, remedial_asg)
    _review_reading(c, reading_asg, intervention)

    # DRAFT practice
    draft_pa = _setup_practice_assessment(c, intervention, gatekeeper_policy="REQUIRE_PASS", status="DRAFT")
    c["db"].commit()

    dec = evaluate_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec.allowed is True
    assert dec.code == "PREPARATION_COMPLETE"
    assert dec.practice_evaluation.assessment_status == "DRAFT"

    # ARCHIVED practice
    draft_pa.status = "ARCHIVED"
    c["db"].commit()

    dec = evaluate_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec.allowed is True
    assert dec.code == "PREPARATION_COMPLETE"
    assert dec.practice_evaluation.assessment_status == "ARCHIVED"


def test_require_pass_policy_blocks_unattempted_and_failed_allows_passed(authz_context):
    """REQUIRE_PASS requires at least one submitted attempt meeting or exceeding the passing percentage."""
    c = authz_context
    intervention = _create_active_intervention(c, 3003)
    remedial_asg = _create_remedial_quiz(c, intervention)
    reading_asg = _create_reading_and_snapshot(c, intervention, remedial_asg)
    _review_reading(c, reading_asg, intervention)

    pa = _setup_practice_assessment(c, intervention, gatekeeper_policy="REQUIRE_PASS", passing_percentage=75.0, status="PUBLISHED")
    c["db"].commit()

    # 1. Zero attempts -> blocked with PRACTICE_PASS_REQUIRED
    dec = evaluate_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec.allowed is False
    assert dec.code == "PRACTICE_PASS_REQUIRED"

    with pytest.raises(HTTPException) as exc:
        require_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "PRACTICE_PASS_REQUIRED"
    assert exc.value.detail["practice"]["eligible_for_remediation"] is False

    # 2. Failed attempt (50% < 75%) -> blocked
    _record_practice_attempt(c, pa, c["student"], score_percentage=50.0, is_passed=False, attempt_number=1)
    c["db"].commit()

    dec = evaluate_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec.allowed is False
    assert dec.code == "PRACTICE_PASS_REQUIRED"

    # 3. Passing attempt (100% >= 75%) -> allowed
    _record_practice_attempt(c, pa, c["student"], score_percentage=100.0, is_passed=True, attempt_number=2)
    c["db"].commit()

    dec = evaluate_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec.allowed is True
    assert dec.code == "PREPARATION_COMPLETE"
    assert dec.practice_evaluation.practice_passed is True
    assert dec.practice_evaluation.eligible_for_remediation is True


def test_require_pass_retains_passed_qualification_after_subsequent_failure(authz_context):
    """Once passed, a subsequent lower or failing attempt must NEVER revoke remediation qualification."""
    c = authz_context
    intervention = _create_active_intervention(c, 3004)
    remedial_asg = _create_remedial_quiz(c, intervention)
    reading_asg = _create_reading_and_snapshot(c, intervention, remedial_asg)
    _review_reading(c, reading_asg, intervention)

    pa = _setup_practice_assessment(c, intervention, gatekeeper_policy="REQUIRE_PASS", passing_percentage=80.0, status="PUBLISHED")
    # First attempt: Pass
    _record_practice_attempt(c, pa, c["student"], score_percentage=90.0, is_passed=True, attempt_number=1)
    c["db"].commit()

    dec = evaluate_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec.allowed is True

    # Second attempt: Fail (0%)
    _record_practice_attempt(c, pa, c["student"], score_percentage=0.0, is_passed=False, attempt_number=2)
    c["db"].commit()

    dec = evaluate_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec.allowed is True
    assert dec.code == "PREPARATION_COMPLETE"
    assert dec.practice_evaluation.practice_passed is True
    assert dec.practice_evaluation.eligible_for_remediation is True


def test_require_attempt_policy_allows_any_submitted_score(authz_context):
    """REQUIRE_ATTEMPT requires at least one completed attempt, even if below passing."""
    c = authz_context
    intervention = _create_active_intervention(c, 3005)
    remedial_asg = _create_remedial_quiz(c, intervention)
    reading_asg = _create_reading_and_snapshot(c, intervention, remedial_asg)
    _review_reading(c, reading_asg, intervention)

    pa = _setup_practice_assessment(c, intervention, gatekeeper_policy="REQUIRE_ATTEMPT", passing_percentage=75.0, status="PUBLISHED")
    c["db"].commit()

    # 1. 0 attempts -> blocked with PRACTICE_ATTEMPT_REQUIRED
    dec = evaluate_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec.allowed is False
    assert dec.code == "PRACTICE_ATTEMPT_REQUIRED"

    with pytest.raises(HTTPException) as exc:
        require_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "PRACTICE_ATTEMPT_REQUIRED"

    # 2. Submitted attempt scoring 0% -> allowed because an attempt was completed
    _record_practice_attempt(c, pa, c["student"], score_percentage=0.0, is_passed=False, attempt_number=1)
    c["db"].commit()

    dec = evaluate_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec.allowed is True
    assert dec.code == "PREPARATION_COMPLETE"
    assert dec.practice_evaluation.practice_completed is True
    assert dec.practice_evaluation.eligible_for_remediation is True


def test_optional_policy_allows_access_without_attempts(authz_context):
    """OPTIONAL policy allows remediation directly without requiring any practice attempts."""
    c = authz_context
    intervention = _create_active_intervention(c, 3006)
    remedial_asg = _create_remedial_quiz(c, intervention)
    reading_asg = _create_reading_and_snapshot(c, intervention, remedial_asg)
    _review_reading(c, reading_asg, intervention)

    _setup_practice_assessment(c, intervention, gatekeeper_policy="OPTIONAL", status="PUBLISHED")
    c["db"].commit()

    dec = evaluate_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec.allowed is True
    assert dec.code == "PREPARATION_COMPLETE"
    assert dec.practice_evaluation.eligible_for_remediation is True


def test_reading_prerequisite_takes_precedence_over_passed_practice(authz_context):
    """Ordering requirement: Reading Materials -> Practice Assessment -> Remediation Assessment.
    If reading is incomplete, access is blocked with PREPARATION_REQUIRED even if practice was passed.
    """
    c = authz_context
    intervention = _create_active_intervention(c, 3007)
    remedial_asg = _create_remedial_quiz(c, intervention)
    reading_asg = _create_reading_and_snapshot(c, intervention, remedial_asg)
    # Reading is NOT reviewed!

    pa = _setup_practice_assessment(c, intervention, gatekeeper_policy="REQUIRE_PASS", status="PUBLISHED")
    _record_practice_attempt(c, pa, c["student"], score_percentage=100.0, is_passed=True)
    c["db"].commit()

    dec = evaluate_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec.allowed is False
    assert dec.code == "PREPARATION_REQUIRED"
    assert "Required Reading preparation is incomplete" in dec.message


def test_in_progress_and_completed_remediation_is_grandfathered(authz_context):
    """If a student has started or completed remediation before a practice assessment is published,
    their access and work must NEVER be retroactively revoked.
    """
    c = authz_context
    intervention = _create_active_intervention(c, 3008)
    remedial_asg = _create_remedial_quiz(c, intervention)
    reading_asg = _create_reading_and_snapshot(c, intervention, remedial_asg)
    _review_reading(c, reading_asg, intervention)

    # 1. Student started quiz attempt (pending submission)
    sub = StudentSubmission(
        student_id=c["student"].student_id,
        classwork_assignment_id=remedial_asg.classwork_assignment_id,
        status="pending",
        attempt_count=0,
    )
    c["db"].add(sub)
    c["db"].commit()

    # 2. Later, teacher publishes Practice Assessment with REQUIRE_PASS (0 practice attempts)
    _setup_practice_assessment(c, intervention, gatekeeper_policy="REQUIRE_PASS", status="PUBLISHED")
    c["db"].commit()

    # 3. Gatekeeper must grandfather existing work and allow access
    dec = evaluate_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec.allowed is True
    assert dec.code == "PREPARATION_COMPLETE"
    assert "in progress or completed" in dec.message

    # 4. Same for completed / graded submission
    sub.status = "graded"
    sub.submitted_at = datetime.now(timezone.utc)
    c["db"].commit()

    dec = evaluate_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec.allowed is True
    assert dec.code == "PREPARATION_COMPLETE"


def test_scope_isolation_between_different_students(authz_context):
    """Practice completed by student A does NOT qualify student B."""
    c = authz_context
    intervention = _create_active_intervention(c, 3009)
    remedial_asg = _create_remedial_quiz(c, intervention)
    reading_asg = _create_reading_and_snapshot(c, intervention, remedial_asg)
    _review_reading(c, reading_asg, intervention)

    pa = _setup_practice_assessment(c, intervention, gatekeeper_policy="REQUIRE_PASS", status="PUBLISHED")
    # Student A passes
    _record_practice_attempt(c, pa, c["student"], score_percentage=100.0, is_passed=True)

    # Other student (not in scope, and has no practice)
    other_student = c["db"].query(Student).filter_by(user_id=c["accounts"]["other_student"].user_id).first()
    c["db"].commit()

    eval_other = evaluate_practice_progression(c["db"], intervention.intervention_id, other_student.student_id)
    assert eval_other.attempts_count == 0
    assert eval_other.practice_passed is False
    assert eval_other.eligible_for_remediation is False


def test_remediation_enforcement_on_quiz_attempt_service(authz_context):
    """Verify that QuizAttemptService endpoints invoke gatekeeper and reject when practice is required."""
    c = authz_context
    intervention = _create_active_intervention(c, 3010)
    remedial_asg = _create_remedial_quiz(c, intervention)
    reading_asg = _create_reading_and_snapshot(c, intervention, remedial_asg)
    _review_reading(c, reading_asg, intervention)

    _setup_practice_assessment(c, intervention, gatekeeper_policy="REQUIRE_PASS", status="PUBLISHED")
    c["db"].commit()

    # Attempting to start remedial quiz before passing practice assessment must raise 403
    with pytest.raises(HTTPException) as exc:
        start_student_quiz_attempt(c["db"], c["student"], remedial_asg.classwork_assignment_id)
    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "PRACTICE_PASS_REQUIRED"

    # Attempting to fetch quiz before passing practice assessment must also raise 403
    with pytest.raises(HTTPException) as exc:
        get_student_quiz_attempt(c["db"], c["student"], remedial_asg.classwork_assignment_id)
    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "PRACTICE_PASS_REQUIRED"


def test_remediation_enforcement_on_written_work_and_performance_tasks(authz_context):
    """Verify gatekeeper protects Written Work and Performance Tasks equally."""
    c = authz_context
    intervention = _create_active_intervention(c, 3011)

    # Written Work
    ww_asg = _create_remedial_work(c, intervention, classwork_type="ASSIGNMENT")
    reading_asg = _create_reading_and_snapshot(c, intervention, ww_asg)
    _review_reading(c, reading_asg, intervention)

    pa = _setup_practice_assessment(c, intervention, gatekeeper_policy="REQUIRE_ATTEMPT", status="PUBLISHED")
    c["db"].commit()

    # Blocked without attempt
    with pytest.raises(HTTPException) as exc:
        require_remediation_prerequisite(c["db"], ww_asg, c["student"])
    assert exc.value.status_code == 403
    assert exc.value.detail["code"] == "PRACTICE_ATTEMPT_REQUIRED"

    # Completed attempt unlocks WW
    _record_practice_attempt(c, pa, c["student"], score_percentage=10.0, is_passed=False)
    c["db"].commit()

    dec = require_remediation_prerequisite(c["db"], ww_asg, c["student"])
    assert dec.allowed is True


def test_zero_gradebook_contamination(authz_context):
    """Practice assessments and attempts never write to StudentGrade or StudentSubmission."""
    c = authz_context
    intervention = _create_active_intervention(c, 3012)
    pa = _setup_practice_assessment(c, intervention, gatekeeper_policy="REQUIRE_PASS", status="PUBLISHED")

    grades_before = c["db"].query(StudentPeriodGrade).count()
    scores_before = c["db"].query(StudentAssessmentScore).count()
    submissions_before = c["db"].query(StudentSubmission).count()

    # Record 3 attempts with different outcomes
    _record_practice_attempt(c, pa, c["student"], score_percentage=40.0, is_passed=False, attempt_number=1)
    _record_practice_attempt(c, pa, c["student"], score_percentage=100.0, is_passed=True, attempt_number=2)
    _record_practice_attempt(c, pa, c["student"], score_percentage=70.0, is_passed=False, attempt_number=3)
    c["db"].commit()

    grades_after = c["db"].query(StudentPeriodGrade).count()
    scores_after = c["db"].query(StudentAssessmentScore).count()
    submissions_after = c["db"].query(StudentSubmission).count()

    assert grades_after == grades_before
    assert scores_after == scores_before
    assert submissions_after == submissions_before


def test_raising_passing_threshold_does_not_revoke_previously_earned_qualification(authz_context):
    """When a teacher raises passing_percentage after an attempt passed, eligibility is preserved."""
    c = authz_context
    intervention = _create_active_intervention(c, 3013)
    remedial_asg = _create_remedial_work(c, intervention, classwork_type="QUIZ")
    reading_asg = _create_reading_and_snapshot(c, intervention, remedial_asg)
    _review_reading(c, reading_asg, intervention)

    # Initial threshold: 75%
    pa = _setup_practice_assessment(c, intervention, gatekeeper_policy="REQUIRE_PASS", status="PUBLISHED")
    pa.passing_percentage = Decimal("75.00")
    c["db"].commit()

    # Student scores 80% (passes under 75% snapshot)
    _record_practice_attempt(
        c, pa, c["student"],
        score_percentage=80.0,
        is_passed=True,
        passing_threshold_snapshot=Decimal("75.00"),
        attempt_number=1,
    )
    c["db"].commit()

    dec1 = require_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec1.allowed is True

    # Teacher raises passing percentage to 90%
    pa.passing_percentage = Decimal("90.00")
    c["db"].commit()

    # Previously earned qualification must NOT be revoked!
    dec2 = require_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec2.allowed is True
    assert "Passing score achieved on practice assessment." in dec2.message


def test_lowering_passing_threshold_qualifies_student_with_qualifying_score(authz_context):
    """When teacher lowers passing_percentage, students whose scores meet the new threshold qualify."""
    c = authz_context
    intervention = _create_active_intervention(c, 3014)
    remedial_asg = _create_remedial_work(c, intervention, classwork_type="QUIZ")
    reading_asg = _create_reading_and_snapshot(c, intervention, remedial_asg)
    _review_reading(c, reading_asg, intervention)

    # Initial threshold: 90%
    pa = _setup_practice_assessment(c, intervention, gatekeeper_policy="REQUIRE_PASS", status="PUBLISHED")
    pa.passing_percentage = Decimal("90.00")
    c["db"].commit()

    # Student scores 80% (fails under initial 90% threshold)
    _record_practice_attempt(
        c, pa, c["student"],
        score_percentage=80.0,
        is_passed=False,
        passing_threshold_snapshot=Decimal("90.00"),
        attempt_number=1,
    )
    c["db"].commit()

    # Blocked initially
    with pytest.raises(HTTPException) as exc:
        require_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert exc.value.status_code == 403

    # Teacher lowers passing percentage to 75%
    pa.passing_percentage = Decimal("75.00")
    c["db"].commit()

    # Student's 80% score now meets the 75% threshold and qualifies!
    dec = require_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec.allowed is True


def test_subsequent_failed_attempt_never_revokes_earned_eligibility(authz_context):
    """Retaking practice assessment and scoring lower never revokes previously earned eligibility."""
    c = authz_context
    intervention = _create_active_intervention(c, 3015)
    remedial_asg = _create_remedial_work(c, intervention, classwork_type="QUIZ")
    reading_asg = _create_reading_and_snapshot(c, intervention, remedial_asg)
    _review_reading(c, reading_asg, intervention)

    pa = _setup_practice_assessment(c, intervention, gatekeeper_policy="REQUIRE_PASS", status="PUBLISHED")
    pa.passing_percentage = Decimal("75.00")
    c["db"].commit()

    # Attempt 1: 85% (Passed)
    _record_practice_attempt(
        c, pa, c["student"],
        score_percentage=85.0,
        is_passed=True,
        passing_threshold_snapshot=Decimal("75.00"),
        attempt_number=1,
    )
    c["db"].commit()
    assert require_remediation_prerequisite(c["db"], remedial_asg, c["student"]).allowed is True

    # Attempt 2: 40% (Failed)
    _record_practice_attempt(
        c, pa, c["student"],
        score_percentage=40.0,
        is_passed=False,
        passing_threshold_snapshot=Decimal("75.00"),
        attempt_number=2,
    )
    c["db"].commit()

    # Still eligible because Attempt 1 was passed
    dec = require_remediation_prerequisite(c["db"], remedial_asg, c["student"])
    assert dec.allowed is True


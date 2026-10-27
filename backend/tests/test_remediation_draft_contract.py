"""Tests for PR 2C.1: AI Remediation Draft Contract.

Verifies strict schema mechanics, component compatibility, taught-lesson eligibility,
competency scoping, point totals, rubric structures, and separation of student instructions
from teacher-only answer keys using synthetic fixtures without live AI calls.
"""

from copy import deepcopy
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonDelivery import LessonDelivery
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.quiz.Question import Question
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.schemas.RemediationDraft import (
    RemediationClassworkDraft,
    RemediationDeliverableDraft,
    RemediationQuizDraft,
    RemediationQuizOptionDraft,
    RemediationQuizQuestionDraft,
    RemediationRubricLevelDraft,
    RemediationTaskDraft,
    RemediationTeacherAnswerKey,
    RemediationTeacherClassworkGuide,
    parse_remediation_draft,
)
from app.services.intervention.InterventionRemediationDraftValidationService import (
    validate_draft_against_scope,
    validate_remediation_draft,
)
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_teacher_intervention_review import candidate_context


# ── Synthetic Fixtures for Pure Schema & Scope Tests ──

def sample_scope():
    return {
        "scope_version": "REMEDIATION_GENERATION_EVIDENCE_V1",
        "status": "AVAILABLE",
        "academic_scope": {
            "student_id": "11111111-1111-1111-1111-111111111111",
            "class_id": 10,
            "subject_id": 20,
            "academic_period_id": 1,
            "academic_year_id": 1,
            "evidence_cutoff_at": "2026-10-15T08:00:00Z",
        },
        "evidence_level": "QUESTION_SCORE",
        "components": ["WRITTEN_WORK"],
        "questions": [
            {
                "quiz_question_id": 101,
                "classwork_id": 50,
                "lesson_id": 1,
                "competency_id": 10,
                "score": 0.0,
                "possible_score": 5.0,
            }
        ],
        "lessons": [
            {
                "lesson_id": 1,
                "title": "Algebraic Expressions",
                "is_taught": True,
                "taught_evidence": "TEACHER_VERIFIED_DELIVERY",
            },
            {
                "lesson_id": 2,
                "title": "Quadratic Functions",
                "is_taught": False,
                "taught_evidence": "NOT_RECORDED_AS_TAUGHT",
            },
        ],
        "competencies": [
            {
                "competency_id": 10,
                "code": "MATH-01",
                "statement": "Simplifies algebraic expressions",
            }
        ],
    }


def sample_quiz_draft():
    return RemediationQuizDraft(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        title="Remedial Quiz: Algebraic Expressions",
        instructions="Complete the following targeted questions carefully.",
        total_points=10.0,
        duration_minutes=20,
        questions=[
            RemediationQuizQuestionDraft(
                question_text="What is the simplified form of 2x + 3x?",
                question_type="MULTIPLE_CHOICE",
                points=5.0,
                display_order=1,
                difficulty_level="EASY",
                targeted_competency_id=10,
                targeted_lesson_id=1,
                targeted_quiz_question_id=101,
                options=[
                    RemediationQuizOptionDraft(option_text="5x", option_order=1),
                    RemediationQuizOptionDraft(option_text="6x", option_order=2),
                    RemediationQuizOptionDraft(option_text="5x^2", option_order=3),
                ],
                teacher_answer_key=RemediationTeacherAnswerKey(
                    correct_answer="5x",
                    explanation="Combine like terms: 2x + 3x = (2+3)x = 5x.",
                    scoring_guide="Award full 5 points for 5x, 0 otherwise.",
                ),
            ),
            RemediationQuizQuestionDraft(
                question_text="True or False: The coefficient of x in the term 7x is 7.",
                question_type="TRUE_FALSE",
                points=5.0,
                display_order=2,
                difficulty_level="EASY",
                targeted_competency_id=10,
                targeted_lesson_id=1,
                options=[
                    RemediationQuizOptionDraft(option_text="True", option_order=1),
                    RemediationQuizOptionDraft(option_text="False", option_order=2),
                ],
                teacher_answer_key=RemediationTeacherAnswerKey(
                    correct_answer="True",
                    explanation="In 7x, 7 is the numerical coefficient multiplying the variable x.",
                ),
            ),
        ],
    )


def sample_classwork_draft():
    return RemediationClassworkDraft(
        draft_format="CLASSWORK",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        title="Remedial Activity: Expression Simplification Journal",
        description="A guided practice activity to reinforce algebraic simplification.",
        student_instructions="Step 1: Simplify the problems. Step 2: Show complete work.",
        total_points=20.0,
        activity_mode="ONLINE",
        tasks=[
            RemediationTaskDraft(
                task_number=1,
                title="Combine Like Terms",
                instructions="Simplify 4 expressions showing each combining step clearly.",
                targeted_competency_id=10,
                targeted_lesson_id=1,
            ),
            RemediationTaskDraft(
                task_number=2,
                title="Error Analysis",
                instructions="Identify the error in the provided worked example and write the correct solution.",
                targeted_competency_id=10,
                targeted_lesson_id=1,
            ),
        ],
        deliverables=[
            RemediationDeliverableDraft(
                deliverable_name="Simplification Worksheet",
                deliverable_type="DOCUMENT",
                description="Completed worksheet with handwritten or typed steps.",
            )
        ],
        supported_upload_formats=[".pdf", ".docx", ".png"],
        rubric_levels=[
            RemediationRubricLevelDraft(
                level_name="Excellent",
                description="All expressions simplified correctly with complete step-by-step reasoning.",
                points=20.0,
                display_order=1,
            ),
            RemediationRubricLevelDraft(
                level_name="Proficient",
                description="Most expressions simplified correctly with minor arithmetic errors.",
                points=15.0,
                display_order=2,
            ),
            RemediationRubricLevelDraft(
                level_name="Developing",
                description="Significant misunderstanding of like terms; incomplete steps.",
                points=10.0,
                display_order=3,
            ),
        ],
        teacher_guide=RemediationTeacherClassworkGuide(
            exemplar_or_expected_response="Task 1: 3a + 5a = 8a. Task 2: Student should identify sign error in step 2.",
            evaluation_notes="Look for proper grouping of variables vs constants.",
            common_misconceptions=["Adding exponents when combining like terms (e.g. x + x = x^2)"],
        ),
    )


# ── Unit Tests: Schema Validation & Mechanics ──

def test_valid_quiz_draft_mechanics_and_authoring_conversion():
    draft = sample_quiz_draft()
    assert draft.draft_format == "QUIZ"
    assert draft.total_points == 10.0
    assert len(draft.questions) == 2

    # Verify authoring compatibility: converts to standard Entervene QuizQuestionIn
    converted = draft.to_quiz_questions_in()
    assert len(converted) == 2
    assert converted[0].points == 5.0
    assert converted[0].is_ai_generated is True
    assert converted[0].lesson_id == 1
    # Check that option 1 is marked correct
    assert converted[0].options[0].is_correct is True
    assert converted[0].options[1].is_correct is False

    # Verify student view strips teacher answer keys
    student_view = draft.to_student_view()
    assert "teacher_answer_key" not in student_view["questions"][0]
    assert "correct_answer" not in student_view["questions"][0]
    assert student_view["questions"][0]["question_text"] == "What is the simplified form of 2x + 3x?"


def test_valid_classwork_draft_mechanics_and_authoring_conversion():
    draft = sample_classwork_draft()
    assert draft.draft_format == "CLASSWORK"
    assert draft.total_points == 20.0
    assert len(draft.tasks) == 2
    assert len(draft.rubric_levels) == 3

    # Verify authoring compatibility: converts to standard Entervene ClassworkCreate
    classwork_create = draft.to_classwork_create(subject_id=20)
    assert classwork_create.title == draft.title
    assert classwork_create.subject_id == 20
    assert classwork_create.total_points == 20.0
    assert classwork_create.classwork_category == "WRITTEN_WORK"
    assert len(classwork_create.rubric_levels) == 3

    # Verify student view strips teacher guide
    student_view = draft.to_student_view()
    assert "teacher_guide" not in student_view
    assert len(student_view["tasks"]) == 2
    assert len(student_view["deliverables"]) == 1


def test_quiz_point_sum_mismatch_raises_error():
    draft_dict = sample_quiz_draft().model_dump()
    draft_dict["total_points"] = 15.0  # Questions only sum to 10.0
    with pytest.raises(ValidationError, match="Sum of question points .* does not equal draft total_points"):
        RemediationQuizDraft.model_validate(draft_dict)


def test_quiz_mc_correct_answer_not_in_options_raises_error():
    draft_dict = sample_quiz_draft().model_dump()
    draft_dict["questions"][0]["teacher_answer_key"]["correct_answer"] = "999x"
    with pytest.raises(ValidationError, match="does not match any provided option"):
        RemediationQuizDraft.model_validate(draft_dict)


def test_quiz_true_false_invalid_options_raises_error():
    draft_dict = sample_quiz_draft().model_dump()
    draft_dict["questions"][1]["options"] = [
        {"option_text": "Maybe", "option_order": 1},
        {"option_text": "No", "option_order": 2},
    ]
    with pytest.raises(ValidationError, match="options must be 'True' and 'False'"):
        RemediationQuizDraft.model_validate(draft_dict)


def test_classwork_rubric_max_points_mismatch_raises_error():
    draft_dict = sample_classwork_draft().model_dump()
    draft_dict["total_points"] = 30.0  # Max rubric points is 20.0
    with pytest.raises(ValidationError, match="Maximum rubric points .* must equal classwork total_points"):
        RemediationClassworkDraft.model_validate(draft_dict)


def test_classwork_rubric_not_descending_raises_error():
    draft_dict = sample_classwork_draft().model_dump()
    # Invert order: 10, 15, 20
    draft_dict["rubric_levels"] = [
        {"level_name": "Developing", "description": "Developing level description", "points": 10.0, "display_order": 1},
        {"level_name": "Proficient", "description": "Proficient level description", "points": 15.0, "display_order": 2},
        {"level_name": "Excellent", "description": "Excellent level description", "points": 20.0, "display_order": 3},
    ]
    with pytest.raises(ValidationError, match="must be ordered in descending order by points"):
        RemediationClassworkDraft.model_validate(draft_dict)


def test_classwork_unsupported_upload_format_raises_error():
    draft_dict = sample_classwork_draft().model_dump()
    draft_dict["supported_upload_formats"] = [".exe", ".bat"]
    with pytest.raises(ValidationError, match="Unsupported upload format"):
        RemediationClassworkDraft.model_validate(draft_dict)


# ── Scope & Evidence Validation Tests ──

def test_validate_draft_against_scope_success():
    scope = sample_scope()
    draft = sample_quiz_draft()
    validated = validate_draft_against_scope(scope, draft)
    assert validated.title == draft.title


def test_reject_untaught_lesson():
    scope = sample_scope()
    draft = sample_quiz_draft()
    # Point question 2 to lesson 2, which has is_taught = False in scope
    draft.questions[1].targeted_lesson_id = 2

    with pytest.raises(HTTPException) as exc_info:
        validate_draft_against_scope(scope, draft)
    assert exc_info.value.status_code == 422
    assert "has not been verified as taught to this class as of the evidence cutoff" in exc_info.value.detail


def test_reject_invented_lesson_not_in_scope():
    scope = sample_scope()
    draft = sample_quiz_draft()
    draft.questions[0].targeted_lesson_id = 999  # Invented lesson

    with pytest.raises(HTTPException) as exc_info:
        validate_draft_against_scope(scope, draft)
    assert exc_info.value.status_code == 422
    assert "Lesson ID 999 is outside the verified evidence scope" in exc_info.value.detail


def test_reject_invented_competency_not_in_scope():
    scope = sample_scope()
    draft = sample_quiz_draft()
    draft.questions[0].targeted_competency_id = 888  # Invented competency

    with pytest.raises(HTTPException) as exc_info:
        validate_draft_against_scope(scope, draft)
    assert exc_info.value.status_code == 422
    assert "Competency ID 888 is outside the verified evidence scope" in exc_info.value.detail


def test_reject_unsupported_quiz_question_reference():
    scope = sample_scope()
    draft = sample_quiz_draft()
    draft.questions[0].targeted_quiz_question_id = 777  # Not in scope["questions"]

    with pytest.raises(HTTPException) as exc_info:
        validate_draft_against_scope(scope, draft)
    assert exc_info.value.status_code == 422
    assert "Referenced quiz question ID 777 is outside the verified question evidence" in exc_info.value.detail


def test_reject_incompatible_target_component():
    scope = sample_scope()  # Weakest is WRITTEN_WORK
    draft_dict = sample_quiz_draft().model_dump()
    draft_dict["target_component"] = "EXAMINATION"
    draft_dict["grade_treatment"] = "EXAMINATION"
    draft_dict["exam_subtype"] = "SUMMATIVE_1"
    draft = RemediationQuizDraft.model_validate(draft_dict)

    with pytest.raises(HTTPException) as exc_info:
        validate_draft_against_scope(scope, draft)
    assert exc_info.value.status_code == 422
    assert "does not match the student's verified weakest components" in exc_info.value.detail


def test_reject_performance_task_in_quiz_format():
    scope = sample_scope()
    scope["components"] = ["PERFORMANCE_TASK"]
    draft_dict = sample_classwork_draft().model_dump()
    draft_dict["target_component"] = "PERFORMANCE_TASK"
    draft_dict["grade_treatment"] = "PERFORMANCE_TASK"
    # Try putting PT in QUIZ format
    quiz_dict = sample_quiz_draft().model_dump()
    quiz_dict["target_component"] = "PERFORMANCE_TASK"  # Pydantic will catch or service will catch
    with pytest.raises(ValidationError):
        RemediationQuizDraft.model_validate(quiz_dict)


def test_reject_leaked_answer_key_in_student_instructions():
    scope = sample_scope()
    draft_dict = sample_quiz_draft().model_dump()
    draft_dict["questions"][0]["question_text"] = "What is 2x + 3x? (Answer key: 5x)"
    draft = RemediationQuizDraft.model_validate(draft_dict)

    with pytest.raises(HTTPException) as exc_info:
        validate_draft_against_scope(scope, draft)
    assert exc_info.value.status_code == 422
    assert "contains leaked teacher answer key" in exc_info.value.detail


def test_reject_insufficient_evidence_scope():
    scope = sample_scope()
    scope["status"] = "INSUFFICIENT_EVIDENCE"
    draft = sample_quiz_draft()

    with pytest.raises(HTTPException) as exc_info:
        validate_draft_against_scope(scope, draft)
    assert exc_info.value.status_code == 422
    assert "Insufficient verified evidence for remediation generation" in exc_info.value.detail


def test_parse_remediation_draft_unknown_format():
    with pytest.raises(ValueError, match="must be 'QUIZ' or 'CLASSWORK'"):
        parse_remediation_draft({"draft_format": "UNKNOWN"})


# ── Database & Intervention Evidence Integration Tests ──

def _mapped_records(ctx):
    competency = Competency(
        competency_code="MATH-SCOPE-1",
        statement="Interpret verified ratios",
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
    )
    ctx["db"].add(competency)
    ctx["db"].flush()
    lesson = Lesson(
        title="Verified ratios lesson",
        subject_id=ctx["subject"].subject_id,
        competency_id=competency.competency_id,
        is_published=False,
    )
    ctx["db"].add(lesson)
    ctx["db"].commit()
    return competency, lesson


def _question_snapshot(ctx, competency, lesson):
    snapshot = deepcopy(ctx["candidate"].diagnosis_snapshot)
    activity = snapshot["supporting_activities"][0]
    quiz = Quiz(classwork_id=activity["classwork_id"], total_items=2, status="PUBLISHED")
    ctx["db"].add(quiz)
    ctx["db"].flush()
    question_rows = []
    submission = ctx["db"].get(StudentSubmission, activity["submission_id"])
    for order, awarded in enumerate((2, 0), start=1):
        question = Question(
            question_text=f"Verified ratio item {order}",
            question_type="SHORT_ANSWER",
            points=Decimal("5"),
            lesson_id=lesson.lesson_id,
        )
        ctx["db"].add(question)
        ctx["db"].flush()
        link = QuizQuestion(
            quiz_id=quiz.quiz_id,
            question_id=question.question_id,
            display_order=order,
        )
        ctx["db"].add(link)
        ctx["db"].flush()
        ctx["db"].add(
            QuizAnswer(
                submission_id=submission.submission_id,
                quiz_question_id=link.quiz_question_id,
                points_awarded=Decimal(str(awarded)),
            )
        )
        question_rows.append(link)
    ctx["db"].commit()

    snapshot["lowest_supported_competencies"] = [
        {
            "competency_id": competency.competency_id,
            "competency_statement": competency.statement,
            "percent": 20.0,
            "supporting_scores": [
                {
                    "classwork_id": activity["classwork_id"],
                    "classwork_assignment_id": activity["classwork_assignment_id"],
                    "submission_id": activity["submission_id"],
                    "quiz_question_id": question_rows[0].quiz_question_id,
                    "lesson_id": lesson.lesson_id,
                    "lesson_title": lesson.title,
                    "competency_id": competency.competency_id,
                    "score": 2.0,
                    "possible_score": 5.0,
                    "percent": 40.0,
                    "source_type": "QUIZ_QUESTION",
                    "component": "WRITTEN_WORK",
                },
                {
                    "classwork_id": activity["classwork_id"],
                    "classwork_assignment_id": activity["classwork_assignment_id"],
                    "submission_id": activity["submission_id"],
                    "quiz_question_id": question_rows[1].quiz_question_id,
                    "lesson_id": lesson.lesson_id,
                    "lesson_title": lesson.title,
                    "competency_id": competency.competency_id,
                    "score": 0.0,
                    "possible_score": 5.0,
                    "percent": 0.0,
                    "source_type": "QUIZ_QUESTION",
                    "component": "WRITTEN_WORK",
                },
            ],
        }
    ]
    ctx["candidate"].diagnosis_snapshot = snapshot
    ctx["db"].commit()
    return question_rows


def test_end_to_end_validation_with_qualified_taught_lesson(candidate_context):
    ctx = candidate_context
    competency, lesson = _mapped_records(ctx)
    question_rows = _question_snapshot(ctx, competency, lesson)

    cutoff = datetime.fromisoformat(
        ctx["candidate"].diagnosis_snapshot["evidence_cutoff_at"]
    )
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=timezone.utc)

    # Stamp delivery BEFORE cutoff
    delivery = LessonDelivery(
        lesson_id=lesson.lesson_id,
        class_id=ctx["candidate"].class_id,
        subject_id=ctx["candidate"].subject_id,
        academic_period_id=ctx["candidate"].academic_period_id,
        delivered_by_staff_id="STAFF-DEMO",
        delivered_at=cutoff - timedelta(days=2),
    )
    ctx["db"].add(delivery)
    ctx["db"].commit()

    draft = RemediationQuizDraft(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        title="Remediation Quiz: Ratios",
        instructions="Answer the questions on ratios.",
        total_points=5.0,
        questions=[
            RemediationQuizQuestionDraft(
                question_text="What is the ratio of 2 to 4?",
                question_type="SHORT_ANSWER",
                points=5.0,
                display_order=1,
                targeted_competency_id=competency.competency_id,
                targeted_lesson_id=lesson.lesson_id,
                targeted_quiz_question_id=question_rows[1].quiz_question_id,
                teacher_answer_key=RemediationTeacherAnswerKey(
                    correct_answer="1:2",
                    explanation="Divide both terms by 2.",
                ),
            )
        ],
    )

    validated = validate_remediation_draft(ctx["db"], ctx["candidate"], draft)
    assert validated.title == "Remediation Quiz: Ratios"


def test_end_to_end_validation_rejects_delivery_stamped_after_frozen_cutoff(candidate_context):
    ctx = candidate_context
    competency, lesson = _mapped_records(ctx)
    _question_snapshot(ctx, competency, lesson)

    cutoff = datetime.fromisoformat(
        ctx["candidate"].diagnosis_snapshot["evidence_cutoff_at"]
    )
    if cutoff.tzinfo is None:
        cutoff = cutoff.replace(tzinfo=timezone.utc)

    # Stamp delivery AFTER cutoff (e.g. lesson delivered yesterday, but intervention cutoff was last week)
    delivery = LessonDelivery(
        lesson_id=lesson.lesson_id,
        class_id=ctx["candidate"].class_id,
        subject_id=ctx["candidate"].subject_id,
        academic_period_id=ctx["candidate"].academic_period_id,
        delivered_by_staff_id="STAFF-DEMO",
        delivered_at=cutoff + timedelta(days=2),
    )
    ctx["db"].add(delivery)
    ctx["db"].commit()

    draft = RemediationQuizDraft(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        title="Remediation Quiz: Ratios",
        instructions="Answer the questions on ratios.",
        total_points=5.0,
        questions=[
            RemediationQuizQuestionDraft(
                question_text="What is the ratio of 2 to 4?",
                question_type="SHORT_ANSWER",
                points=5.0,
                display_order=1,
                targeted_competency_id=competency.competency_id,
                targeted_lesson_id=lesson.lesson_id,
                teacher_answer_key=RemediationTeacherAnswerKey(
                    correct_answer="1:2",
                    explanation="Divide both terms by 2.",
                ),
            )
        ],
    )

    with pytest.raises(HTTPException) as exc_info:
        validate_remediation_draft(ctx["db"], ctx["candidate"], draft)
    assert exc_info.value.status_code == 422
    assert "has not been verified as taught to this class as of the evidence cutoff" in exc_info.value.detail

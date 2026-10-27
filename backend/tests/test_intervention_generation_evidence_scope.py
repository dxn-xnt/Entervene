"""Synthetic contracts for future remediation-generation evidence boundaries."""

from copy import deepcopy
from datetime import datetime, timedelta
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.quiz.Question import Question
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.InterventionGenerationEvidenceScopeService import (
    EvidenceCoverageSelection,
    resolve_generation_evidence_scope,
    validate_selected_evidence_coverage,
)
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_teacher_intervention_review import candidate_context


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
    quiz = Quiz(classwork_id=activity["classwork_id"], total_items=3, status="PUBLISHED")
    ctx["db"].add(quiz)
    ctx["db"].flush()
    question_rows = []
    submission = ctx["db"].get(StudentSubmission, activity["submission_id"])
    for order, awarded in enumerate((2, 0, 5), start=1):
        question = Question(
            question_text=f"Verified ratio item {order}",
            question_type="SHORT_ANSWER",
            points=Decimal("5"),
            lesson_id=lesson.lesson_id,
        )
        ctx["db"].add(question)
        ctx["db"].flush()
        link = QuizQuestion(quiz_id=quiz.quiz_id, question_id=question.question_id, display_order=order)
        ctx["db"].add(link)
        ctx["db"].flush()
        ctx["db"].add(QuizAnswer(
            quiz_question_id=link.quiz_question_id,
            submission_id=submission.submission_id,
            points_awarded=Decimal(awarded),
        ))
        question_rows.append((link.quiz_question_id, awarded))
    ctx["db"].commit()
    snapshot["weakest_supported_components"] = [activity["component"]]
    base = {
        "source_type": "QUIZ_QUESTION",
        "lesson_id": lesson.lesson_id,
        "lesson_title": lesson.title,
        "competency_id": competency.competency_id,
        "competency_code": competency.competency_code,
        "competency_statement": competency.statement,
        "classwork_id": activity["classwork_id"],
        "classwork_assignment_id": activity["classwork_assignment_id"],
        "submission_id": activity["submission_id"],
        "activity_title": activity["title"],
        "component": activity["component"],
        "possible_score": 5,
    }
    snapshot["lowest_supported_competencies"] = [{
        "competency_id": competency.competency_id,
        "competency_code": competency.competency_code,
        "competency_statement": competency.statement,
        "percent": 20,
        "score": 2,
        "possible_score": 10,
        "supporting_scores": [
            {**base, "quiz_question_id": question_id, "score": awarded}
            for question_id, awarded in question_rows
        ],
    }]
    snapshot["manual_assessment_coverage"] = []
    return snapshot, [question_id for question_id, _ in question_rows]


def test_question_scope_prioritizes_only_incorrect_and_partial_mapped_items(candidate_context):
    ctx = candidate_context
    competency, lesson = _mapped_records(ctx)
    snapshot, question_ids = _question_snapshot(ctx, competency, lesson)
    ctx["candidate"].diagnosis_snapshot = snapshot
    ctx["db"].commit()

    scope = resolve_generation_evidence_scope(ctx["db"], ctx["candidate"])

    assert scope["evidence_level"] == "QUESTION_SCORE"
    assert [item["quiz_question_id"] for item in scope["questions"]] == [question_ids[1], question_ids[0]]
    assert [item["response_evidence"] for item in scope["questions"]] == ["INCORRECT", "PARTIAL"]
    assert scope["questions"][0]["priority"] == 1
    assert scope["lessons"] == [{
        "lesson_id": lesson.lesson_id,
        "title": lesson.title,
        "authorization_basis": "SCORED_MAPPED_QUESTION",
        "weakness_supported": True,
    }]
    assert scope["competencies"][0]["competency_id"] == competency.competency_id
    assert scope["topics"] == []
    assert scope["taught_status"] == "UNAVAILABLE_NO_TEACHING_HISTORY"
    assert scope["academic_scope"]["academic_year_id"] == ctx["period"].academic_year_id
    assert scope["academic_scope"]["class_id"] == ctx["class"].class_id
    assert scope["academic_scope"]["subject_id"] == ctx["subject"].subject_id
    assert scope["academic_scope"]["academic_period_id"] == ctx["period"].academic_period_id


def test_teacher_selection_is_limited_to_verified_coverage(candidate_context):
    ctx = candidate_context
    competency, lesson = _mapped_records(ctx)
    snapshot, question_ids = _question_snapshot(ctx, competency, lesson)
    ctx["candidate"].diagnosis_snapshot = snapshot
    future = Lesson(
        title="Published future lesson",
        subject_id=ctx["subject"].subject_id,
        is_published=True,
    )
    ctx["db"].add(future)
    ctx["db"].commit()
    scope = resolve_generation_evidence_scope(ctx["db"], ctx["candidate"])

    selected = validate_selected_evidence_coverage(scope, EvidenceCoverageSelection(
        quiz_question_ids=[question_ids[1]],
        lesson_ids=[lesson.lesson_id],
        competency_ids=[competency.competency_id],
    ))
    assert [item["quiz_question_id"] for item in selected["questions"]] == [question_ids[1]]
    assert [item["lesson_id"] for item in selected["lessons"]] == [lesson.lesson_id]

    with pytest.raises(HTTPException) as unrelated:
        validate_selected_evidence_coverage(
            scope, EvidenceCoverageSelection(lesson_ids=[future.lesson_id]),
        )
    assert unrelated.value.status_code == 422
    with pytest.raises(HTTPException) as invented_question:
        validate_selected_evidence_coverage(
            scope, EvidenceCoverageSelection(quiz_question_ids=[999999]),
        )
    assert invented_question.value.status_code == 422
    with pytest.raises(HTTPException) as topic:
        validate_selected_evidence_coverage(
            scope, EvidenceCoverageSelection(topics=["A published title is not a verified topic"]),
        )
    assert topic.value.status_code == 422


def test_manual_assessment_coverage_is_context_not_weakness(candidate_context):
    ctx = candidate_context
    competency, lesson = _mapped_records(ctx)
    unverified_lesson = Lesson(
        title="Merely published lesson",
        subject_id=ctx["subject"].subject_id,
        is_published=True,
    )
    ctx["db"].add(unverified_lesson)
    ctx["db"].flush()
    snapshot = deepcopy(ctx["candidate"].diagnosis_snapshot)
    activity = snapshot["supporting_activities"][0]
    snapshot["weakest_supported_components"] = [activity["component"]]
    snapshot["lowest_supported_competencies"] = []
    coverage_row = ClassworkCoverage(
        classwork_id=activity["classwork_id"],
        lesson_id=lesson.lesson_id,
        competency_id=competency.competency_id,
        valid_from=datetime.fromisoformat(snapshot["evidence_cutoff_at"]) - timedelta(hours=1),
        linked_by_staff_id=ctx["staff"].staff_id,
    )
    ctx["db"].add(coverage_row)
    ctx["db"].flush()
    snapshot["manual_assessment_coverage"] = [{
        **activity,
        "in_weakest_supported_component": True,
        "coverage_provenance": "TEACHER_ASSERTED_ASSESSMENT_COVERAGE",
        "coverage_links": [{
            "coverage_id": coverage_row.coverage_id,
            "lesson_id": lesson.lesson_id,
            "competency_id": competency.competency_id,
            "valid_from": coverage_row.valid_from.isoformat(),
            "valid_until": None,
            "linked_by_staff_id": ctx["staff"].staff_id,
            "provenance": "TEACHER_ASSERTED_ASSESSMENT_COVERAGE",
        }],
        "covered_lessons": [
            {"lesson_id": lesson.lesson_id, "title": lesson.title},
            {"lesson_id": unverified_lesson.lesson_id, "title": unverified_lesson.title},
        ],
        "covered_competencies": [{
            "competency_id": competency.competency_id,
            "competency_code": competency.competency_code,
            "competency_statement": competency.statement,
        }],
    }]
    ctx["candidate"].diagnosis_snapshot = snapshot
    ctx["db"].commit()

    scope = resolve_generation_evidence_scope(ctx["db"], ctx["candidate"])

    assert scope["evidence_level"] == "ACTIVITY_COVERAGE"
    assert scope["questions"] == []
    assert scope["lessons"][0]["authorization_basis"] == "ASSESSED_COVERAGE"
    assert scope["lessons"][0]["weakness_supported"] is False
    assert [item["lesson_id"] for item in scope["lessons"]] == [lesson.lesson_id]
    assert scope["competencies"][0]["weakness_supported"] is False


def test_competency_level_evidence_never_invents_incorrect_questions(candidate_context):
    ctx = candidate_context
    competency, lesson = _mapped_records(ctx)
    snapshot = deepcopy(ctx["candidate"].diagnosis_snapshot)
    activity = snapshot["supporting_activities"][0]
    snapshot["weakest_supported_components"] = [activity["component"]]
    snapshot["lowest_supported_competencies"] = [{
        "competency_id": competency.competency_id,
        "competency_code": competency.competency_code,
        "competency_statement": competency.statement,
        "percent": activity["percent"],
        "score": activity["score"],
        "possible_score": activity["possible_score"],
        "supporting_scores": [{
            "source_type": "CLASSWORK_SINGLE_LESSON",
            "lesson_id": lesson.lesson_id,
            "lesson_title": lesson.title,
            "competency_id": competency.competency_id,
            "competency_code": competency.competency_code,
            "competency_statement": competency.statement,
            "classwork_id": activity["classwork_id"],
            "classwork_assignment_id": activity["classwork_assignment_id"],
            "submission_id": activity["submission_id"],
            "component": activity["component"],
            "score": activity["score"],
            "possible_score": activity["possible_score"],
        }],
    }]
    snapshot["manual_assessment_coverage"] = []
    ctx["candidate"].diagnosis_snapshot = snapshot
    ctx["db"].commit()

    scope = resolve_generation_evidence_scope(ctx["db"], ctx["candidate"])

    assert scope["evidence_level"] == "SCORED_COMPETENCY"
    assert scope["questions"] == []
    assert scope["lessons"][0]["authorization_basis"] == "SCORED_COMPETENCY"
    assert scope["competencies"][0]["weakness_supported"] is True


def test_unavailable_mapping_falls_back_without_inventing_question_or_competency(candidate_context):
    ctx = candidate_context
    snapshot = deepcopy(ctx["candidate"].diagnosis_snapshot)
    activity = snapshot["supporting_activities"][0]
    snapshot["weakest_supported_components"] = [activity["component"]]
    snapshot["lowest_supported_competencies"] = [{
        "competency_id": 999999,
        "competency_statement": "Missing mapping",
        "percent": 0,
        "supporting_scores": [{
            "source_type": "QUIZ_QUESTION",
            "quiz_question_id": 44,
            "classwork_id": activity["classwork_id"],
            "classwork_assignment_id": activity["classwork_assignment_id"],
            "submission_id": activity["submission_id"],
            "component": activity["component"],
            "score": 0,
            "possible_score": 5,
        }],
    }]
    snapshot["manual_assessment_coverage"] = []
    ctx["candidate"].diagnosis_snapshot = snapshot
    ctx["db"].commit()

    scope = resolve_generation_evidence_scope(ctx["db"], ctx["candidate"])
    assert scope["status"] == "AVAILABLE_COMPONENT_ONLY"
    assert scope["evidence_level"] == "COMPONENT_ONLY"
    assert scope["questions"] == scope["lessons"] == scope["competencies"] == []


def test_scope_rejects_academic_mismatch_and_insufficient_evidence(candidate_context):
    ctx = candidate_context
    original = deepcopy(ctx["candidate"].diagnosis_snapshot)
    mismatches = {
        "student_id": "00000000-0000-0000-0000-000000000000",
        "class_id": ctx["class"].class_id + 999,
        "subject_id": ctx["subject"].subject_id + 999,
        "academic_period_id": ctx["period"].academic_period_id + 999,
        "source_prediction_id": ctx["candidate"].source_prediction_id + 999,
    }
    for key, value in mismatches.items():
        mismatch = deepcopy(original)
        mismatch[key] = value
        ctx["candidate"].diagnosis_snapshot = mismatch
        ctx["db"].commit()
        with pytest.raises(HTTPException) as conflict:
            resolve_generation_evidence_scope(ctx["db"], ctx["candidate"])
        assert conflict.value.status_code == 409

    insufficient = deepcopy(original)
    insufficient["weakest_supported_components"] = []
    insufficient["lowest_supported_competencies"] = []
    insufficient["manual_assessment_coverage"] = []
    ctx["candidate"].diagnosis_snapshot = insufficient
    ctx["db"].commit()
    scope = resolve_generation_evidence_scope(ctx["db"], ctx["candidate"])
    assert scope["status"] == "INSUFFICIENT_EVIDENCE"
    with pytest.raises(HTTPException) as no_evidence:
        validate_selected_evidence_coverage(scope, EvidenceCoverageSelection())
    assert no_evidence.value.status_code == 422

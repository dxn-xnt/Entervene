"""Deterministic evidence boundaries for future AI remediation generation.

This module does not generate content. It resolves and validates the only
coverage references that a future generator may receive.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.intervention.Intervention import Intervention
from app.models.quiz.Question import Question
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.lesson.LessonDeliveryService import get_delivered_lesson_ids_as_of


SCOPE_VERSION = "REMEDIATION_GENERATION_EVIDENCE_V1"
COMPONENTS = {"WRITTEN_WORK", "PERFORMANCE_TASK", "EXAMINATION"}


class EvidenceCoverageSelection(BaseModel):
    """Teacher choices within a resolved scope; never an authority expansion."""

    model_config = ConfigDict(extra="forbid")

    quiz_question_ids: list[int] = Field(default_factory=list, max_length=100)
    lesson_ids: list[int] = Field(default_factory=list, max_length=100)
    competency_ids: list[int] = Field(default_factory=list, max_length=100)
    components: list[str] = Field(default_factory=list, max_length=3)
    topics: list[str] = Field(default_factory=list, max_length=100)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _scope_conflict(message: str) -> None:
    raise HTTPException(status_code=409, detail=message)


def _require_frozen_scope(
    db: Session, row: Intervention,
) -> tuple[dict[str, Any], DevelopmentCurrentTermPrediction, AcademicPeriod, datetime]:
    diagnosis = row.diagnosis_snapshot if isinstance(row.diagnosis_snapshot, dict) else None
    if not diagnosis:
        _scope_conflict("Intervention has no frozen diagnosis evidence")
    source = db.get(DevelopmentCurrentTermPrediction, row.source_prediction_id)
    period = db.get(AcademicPeriod, row.academic_period_id)
    class_ = db.get(Class, row.class_id)
    if source is None or period is None or class_ is None:
        _scope_conflict("Intervention academic scope is unavailable")
    expected_source = (
        row.student_id, row.class_id, row.subject_id,
        row.academic_period_id, row.academic_period_id,
    )
    actual_source = (
        source.student_id, source.class_id, source.subject_id,
        source.source_period_id, source.target_period_id,
    )
    if actual_source != expected_source:
        _scope_conflict("Intervention source prediction does not match its academic scope")
    if class_.academic_year_id != period.academic_year_id:
        _scope_conflict("Intervention class and grading period belong to different academic years")

    expected_snapshot = {
        "source_prediction_id": row.source_prediction_id,
        "student_id": str(row.student_id),
        "class_id": row.class_id,
        "subject_id": row.subject_id,
        "academic_period_id": row.academic_period_id,
    }
    for key, expected in expected_snapshot.items():
        actual = diagnosis.get(key)
        if str(actual) != str(expected):
            _scope_conflict(f"Frozen diagnosis {key} does not match the intervention scope")

    cutoff_text = diagnosis.get("evidence_cutoff_at")
    source_cutoff = (
        source.evidence_snapshot.get("generation_cutoff_at")
        if isinstance(source.evidence_snapshot, dict) else None
    )
    try:
        cutoff = _utc(datetime.fromisoformat(cutoff_text))
        source_cutoff_value = _utc(datetime.fromisoformat(source_cutoff))
    except (TypeError, ValueError):
        _scope_conflict("Frozen diagnosis evidence cutoff is unavailable")
    if cutoff != source_cutoff_value:
        _scope_conflict("Frozen diagnosis cutoff does not match the source prediction")
    return diagnosis, source, period, cutoff


def _verified_activities(db: Session, row: Intervention, diagnosis: dict[str, Any]) -> dict[int, dict[str, Any]]:
    verified: dict[int, dict[str, Any]] = {}
    for item in diagnosis.get("supporting_activities") or []:
        classwork_id = item.get("classwork_id")
        assignment_id = item.get("classwork_assignment_id")
        submission_id = item.get("submission_id")
        snapshot_score = item.get("score")
        snapshot_possible = item.get("possible_score")
        if (
            not all(isinstance(value, int) for value in (classwork_id, assignment_id, submission_id))
            or not isinstance(snapshot_score, (int, float))
            or not isinstance(snapshot_possible, (int, float))
        ):
            continue
        assignment = db.get(ClassworkAssignment, assignment_id)
        classwork = db.get(Classwork, classwork_id)
        submission = db.get(StudentSubmission, submission_id)
        if (
            assignment is None or classwork is None or submission is None
            or assignment.classwork_id != classwork_id
            or assignment.class_id != row.class_id
            or assignment.academic_period_id != row.academic_period_id
            or classwork.subject_id != row.subject_id
            or submission.classwork_assignment_id != assignment_id
            or submission.student_id != row.student_id
            or submission.grade is None
            or classwork.total_points is None
            or abs(float(submission.grade) - snapshot_score) >= 0.000001
            or abs(float(classwork.total_points) - snapshot_possible) >= 0.000001
        ):
            continue
        verified[classwork_id] = item
    return verified


def _authorized_lesson(db: Session, subject_id: int, item: dict[str, Any]) -> dict[str, Any] | None:
    lesson_id = item.get("lesson_id")
    if not isinstance(lesson_id, int):
        return None
    lesson = db.get(Lesson, lesson_id)
    if lesson is None or lesson.subject_id != subject_id:
        return None
    return {
        "lesson_id": lesson_id,
        "title": str(item.get("lesson_title") or item.get("title") or "").strip()[:255],
    }


def _authorized_competency(
    db: Session, subject_id: int, period_id: int, item: dict[str, Any],
) -> dict[str, Any] | None:
    competency_id = item.get("competency_id")
    if not isinstance(competency_id, int):
        return None
    competency = db.get(Competency, competency_id)
    if (
        competency is None or competency.subject_id != subject_id
        or competency.academic_period_id not in (None, period_id)
    ):
        return None
    return {
        "competency_id": competency_id,
        "code": str(item.get("competency_code") or "").strip()[:100] or None,
        "statement": str(item.get("competency_statement") or "").strip()[:500],
    }


def _verified_question_score(db: Session, score: dict[str, Any]) -> bool:
    quiz_question_id = score.get("quiz_question_id")
    submission_id = score.get("submission_id")
    if not isinstance(quiz_question_id, int) or not isinstance(submission_id, int):
        return False
    row = (
        db.query(QuizAnswer, QuizQuestion, Quiz, Question)
        .join(QuizQuestion, QuizAnswer.quiz_question_id == QuizQuestion.quiz_question_id)
        .join(Quiz, QuizQuestion.quiz_id == Quiz.quiz_id)
        .join(Question, QuizQuestion.question_id == Question.question_id)
        .filter(
            QuizAnswer.submission_id == submission_id,
            QuizAnswer.quiz_question_id == quiz_question_id,
        )
        .one_or_none()
    )
    if row is None:
        return False
    answer, _link, quiz, question = row
    return (
        quiz.classwork_id == score.get("classwork_id")
        and question.lesson_id == score.get("lesson_id")
        and answer.points_awarded is not None
        and question.points is not None
        and abs(float(answer.points_awarded) - float(score.get("score"))) < 0.000001
        and abs(float(question.points) - float(score.get("possible_score"))) < 0.000001
    )


def _verified_coverage_targets(
    db: Session, coverage: dict[str, Any], cutoff: datetime,
) -> tuple[set[int], set[int]]:
    lesson_ids: set[int] = set()
    competency_ids: set[int] = set()
    for link in coverage.get("coverage_links") or []:
        coverage_id = link.get("coverage_id")
        if not isinstance(coverage_id, int) or link.get("provenance") != "TEACHER_ASSERTED_ASSESSMENT_COVERAGE":
            continue
        stored = db.get(ClassworkCoverage, coverage_id)
        if (
            stored is None
            or stored.classwork_id != coverage.get("classwork_id")
            or stored.lesson_id != link.get("lesson_id")
            or stored.competency_id != link.get("competency_id")
            or stored.valid_from is None
            or not (_utc(stored.valid_from) <= cutoff and (
                stored.valid_until is None or cutoff < _utc(stored.valid_until)
            ))
        ):
            continue
        if stored.lesson_id is not None:
            lesson_ids.add(stored.lesson_id)
        if stored.competency_id is not None:
            competency_ids.add(stored.competency_id)
    return lesson_ids, competency_ids


def resolve_generation_evidence_scope(db: Session, row: Intervention) -> dict[str, Any]:
    """Resolve the maximum evidence scope available to a future AI generator."""
    diagnosis, source, period, cutoff = _require_frozen_scope(db, row)
    activities = _verified_activities(db, row, diagnosis)
    component_evidence = diagnosis.get("components") or {}
    weakest = sorted({
        value for value in diagnosis.get("weakest_supported_components") or []
        if value in COMPONENTS
        and isinstance(component_evidence.get(value), dict)
        and component_evidence[value].get("evidence_state") == "AVAILABLE"
        and isinstance(component_evidence[value].get("percent"), (int, float))
        and component_evidence[value]["percent"] < 100
    })
    lessons: dict[int, dict[str, Any]] = {}
    competencies: dict[int, dict[str, Any]] = {}
    questions: dict[int, dict[str, Any]] = {}

    # Incorrect and partially scored mapped questions have highest priority.
    for competency_group in diagnosis.get("lowest_supported_competencies") or []:
        for score in competency_group.get("supporting_scores") or []:
            score_value, possible = score.get("score"), score.get("possible_score")
            if (
                score.get("source_type") != "QUIZ_QUESTION"
                or not isinstance(score.get("quiz_question_id"), int)
                or not isinstance(score_value, (int, float))
                or not isinstance(possible, (int, float)) or possible <= 0
                or score_value < 0 or score_value >= possible
                or score.get("classwork_id") not in activities
                or score.get("component") not in weakest
                or not _verified_question_score(db, score)
            ):
                continue
            lesson = _authorized_lesson(db, row.subject_id, score)
            competency = _authorized_competency(db, row.subject_id, row.academic_period_id, score)
            if lesson is None or competency is None:
                continue
            lesson.update({"authorization_basis": "SCORED_MAPPED_QUESTION", "weakness_supported": True})
            competency.update({"authorization_basis": "SCORED_MAPPED_QUESTION", "weakness_supported": True})
            lessons[lesson["lesson_id"]] = lesson
            competencies[competency["competency_id"]] = competency
            question_id = score["quiz_question_id"]
            questions[question_id] = {
                "quiz_question_id": question_id,
                "classwork_id": score["classwork_id"],
                "classwork_assignment_id": score.get("classwork_assignment_id"),
                "lesson_id": lesson["lesson_id"],
                "competency_id": competency["competency_id"],
                "score": score_value,
                "possible_score": possible,
                "response_evidence": "INCORRECT" if score_value <= 0 else "PARTIAL",
                "priority": 1,
            }

    if questions:
        evidence_level = "QUESTION_SCORE"
    else:
        # A scored competency can be used at competency/lesson level, never as an
        # invented question-level mistake.
        measured = []
        for item in diagnosis.get("lowest_supported_competencies") or []:
            percent = item.get("percent")
            if not isinstance(percent, (int, float)) or percent < 0 or percent >= 100:
                continue
            valid_scores = []
            for score in item.get("supporting_scores") or []:
                activity = activities.get(score.get("classwork_id"))
                if activity is None or score.get("component") not in weakest:
                    continue
                if score.get("source_type") == "QUIZ_QUESTION":
                    if not _verified_question_score(db, score):
                        continue
                elif score.get("source_type") == "CLASSWORK_SINGLE_LESSON":
                    score_value = score.get("score")
                    possible_score = score.get("possible_score")
                    if (
                        score.get("lesson_id") is None or score.get("competency_id") != item.get("competency_id")
                        or not isinstance(score_value, (int, float))
                        or not isinstance(possible_score, (int, float))
                        or abs(score_value - float(activity["score"])) >= 0.000001
                        or abs(possible_score - float(activity["possible_score"])) >= 0.000001
                    ):
                        continue
                else:
                    continue
                valid_scores.append(score)
            if not valid_scores:
                continue
            competency = _authorized_competency(db, row.subject_id, row.academic_period_id, item)
            if competency is None:
                continue
            measured.append((percent, competency, valid_scores))
        if measured:
            minimum = min(item[0] for item in measured)
            for percent, competency, scores in measured:
                if percent != minimum:
                    continue
                competency.update({"authorization_basis": "SCORED_COMPETENCY", "weakness_supported": True})
                competencies[competency["competency_id"]] = competency
                for score in scores:
                    lesson = _authorized_lesson(db, row.subject_id, score)
                    if lesson is not None:
                        lesson.update({"authorization_basis": "SCORED_COMPETENCY", "weakness_supported": True})
                        lessons[lesson["lesson_id"]] = lesson
            evidence_level = "SCORED_COMPETENCY"
        else:
            # Dated manual coverage is authorized review context only. It does
            # not establish that any covered lesson or competency is weak.
            for coverage in diagnosis.get("manual_assessment_coverage") or []:
                if (
                    coverage.get("classwork_id") not in activities
                    or coverage.get("component") not in weakest
                    or not coverage.get("in_weakest_supported_component")
                    or coverage.get("coverage_provenance") != "TEACHER_ASSERTED_ASSESSMENT_COVERAGE"
                    or not isinstance(coverage.get("percent"), (int, float))
                    or coverage["percent"] < 0 or coverage["percent"] >= 100
                ):
                    continue
                covered_lesson_ids, covered_competency_ids = _verified_coverage_targets(db, coverage, cutoff)
                for item in coverage.get("covered_lessons") or []:
                    if item.get("lesson_id") not in covered_lesson_ids:
                        continue
                    lesson = _authorized_lesson(db, row.subject_id, item)
                    if lesson is not None:
                        lesson.update({"authorization_basis": "ASSESSED_COVERAGE", "weakness_supported": False})
                        lessons[lesson["lesson_id"]] = lesson
                for item in coverage.get("covered_competencies") or []:
                    if item.get("competency_id") not in covered_competency_ids:
                        continue
                    competency = _authorized_competency(db, row.subject_id, row.academic_period_id, item)
                    if competency is not None:
                        competency.update({"authorization_basis": "ASSESSED_COVERAGE", "weakness_supported": False})
                        competencies[competency["competency_id"]] = competency
            evidence_level = "ACTIVITY_COVERAGE" if lessons or competencies else "COMPONENT_ONLY"

    status = "AVAILABLE" if questions or lessons or competencies else (
        "AVAILABLE_COMPONENT_ONLY" if weakest else "INSUFFICIENT_EVIDENCE"
    )

    delivered_lesson_ids = get_delivered_lesson_ids_as_of(
        db, row.class_id, row.subject_id, row.academic_period_id, as_of=cutoff
    )
    if delivered_lesson_ids:
        taught_status = "TEACHER_VERIFIED_DELIVERY"
        resolved_lessons = []
        for key in sorted(lessons):
            item = dict(lessons[key])
            item["is_taught"] = item["lesson_id"] in delivered_lesson_ids
            item["taught_evidence"] = "TEACHER_VERIFIED_DELIVERY" if item["is_taught"] else "NOT_RECORDED_AS_TAUGHT"
            resolved_lessons.append(item)
    else:
        taught_status = "UNAVAILABLE_NO_TEACHING_HISTORY"
        resolved_lessons = [lessons[key] for key in sorted(lessons)]

    return {
        "scope_version": SCOPE_VERSION,
        "status": status,
        "basis": "FROZEN_TRIGGER_DIAGNOSIS",
        "academic_scope": {
            "student_id": str(row.student_id),
            "class_id": row.class_id,
            "subject_id": row.subject_id,
            "academic_period_id": row.academic_period_id,
            "academic_year_id": period.academic_year_id,
            "source_prediction_id": source.prediction_id,
            "source_prediction_revision": source.revision,
            "evidence_cutoff_at": cutoff.isoformat(),
        },
        "evidence_level": evidence_level,
        "components": weakest,
        "questions": sorted(questions.values(), key=lambda item: (item["score"] / item["possible_score"], item["quiz_question_id"])),
        "lessons": resolved_lessons,
        "competencies": [competencies[key] for key in sorted(competencies)],
        "topics": [],
        "topic_status": "UNAVAILABLE_NO_SEPARATE_VERIFIED_TOPIC_MODEL",
        "taught_status": taught_status,
        "limitations": [
            "Published, scheduled, or assigned lessons are not evidence that content was taught.",
            "Assessment coverage is review context and does not prove a specific weakness.",
            "Frozen question evidence contains scored references, not immutable question text.",
        ],
    }


def validate_selected_evidence_coverage(
    scope: dict[str, Any], selection: EvidenceCoverageSelection,
) -> dict[str, Any]:
    """Validate teacher-selected coverage as a strict subset of a resolved scope."""
    if scope.get("scope_version") != SCOPE_VERSION:
        raise HTTPException(status_code=422, detail="Unknown remediation evidence scope")
    if scope.get("status") == "INSUFFICIENT_EVIDENCE":
        raise HTTPException(status_code=422, detail="Insufficient verified evidence for remediation generation")

    requested = {
        "quiz_question_ids": selection.quiz_question_ids,
        "lesson_ids": selection.lesson_ids,
        "competency_ids": selection.competency_ids,
        "components": selection.components,
        "topics": selection.topics,
    }
    if any(len(values) != len(set(values)) for values in requested.values()):
        raise HTTPException(status_code=422, detail="Duplicate remediation evidence selection")
    if selection.topics:
        raise HTTPException(status_code=422, detail="Topic selection is unavailable without a verified topic model")

    available = {
        "quiz_question_ids": {item["quiz_question_id"] for item in scope["questions"]},
        "lesson_ids": {item["lesson_id"] for item in scope["lessons"]},
        "competency_ids": {item["competency_id"] for item in scope["competencies"]},
        "components": set(scope["components"]),
    }
    for key in ("quiz_question_ids", "lesson_ids", "competency_ids", "components"):
        unsupported = set(requested[key]) - available[key]
        if unsupported:
            raise HTTPException(
                status_code=422,
                detail=f"Selected {key.replace('_', ' ')} are outside the verified evidence scope",
            )

    return {
        "scope_version": SCOPE_VERSION,
        "academic_scope": scope["academic_scope"],
        "evidence_level": scope["evidence_level"],
        "components": selection.components or scope["components"],
        "questions": [item for item in scope["questions"] if item["quiz_question_id"] in selection.quiz_question_ids],
        "lessons": [item for item in scope["lessons"] if item["lesson_id"] in selection.lesson_ids],
        "competencies": [item for item in scope["competencies"] if item["competency_id"] in selection.competency_ids],
        "topics": [],
    }

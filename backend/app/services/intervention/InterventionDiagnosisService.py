"""Build a deterministic, frozen explanation for one candidate prediction."""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.quiz.Question import Question
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.services.grading.ComponentMapper import CanonicalGradingComponent, classify_classwork_component
from app.services.prediction.CurrentPeriodFeatureBuilderService import _classwork_rows


SNAPSHOT_VERSION = "INTERVENTION_DIAGNOSIS_V2"
COMPONENTS = (
    ("WRITTEN_WORK", "ww"),
    ("PERFORMANCE_TASK", "pt"),
    ("EXAMINATION", "qa"),
)


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _component_snapshot(features: dict[str, Any]) -> tuple[dict[str, dict[str, Any]], list[str]]:
    components: dict[str, dict[str, Any]] = {}
    for label, key in COMPONENTS:
        available = float(features[f"{key}_has_evidence"]) == 1.0
        components[label] = {
            "evidence_state": "AVAILABLE" if available else "UNAVAILABLE",
            "percent": float(features[f"{key}_percent_so_far"]) if available else None,
            "model_observation_count": int(features[f"{key}_available_activity_count"]) if available else 0,
        }
    available_values = [item["percent"] for item in components.values() if item["percent"] is not None]
    lowest = min(available_values) if available_values else None
    weakest = [
        label for label, item in components.items()
        if lowest is not None and item["percent"] is not None and abs(item["percent"] - lowest) < 0.0001
    ]
    return components, weakest


def _single_lesson_attribution(db: Session, classwork_id: int, subject_id: int) -> tuple[Lesson, Competency] | None:
    classwork = db.get(Classwork, classwork_id)
    # Manual assessment totals are not individually scored lesson evidence.
    if classwork is not None and classwork.activity_mode == "MANUAL":
        return None
    links = db.query(ClassworkLesson).filter_by(classwork_id=classwork_id).all()
    if len(links) != 1:
        return None
    lesson = db.get(Lesson, links[0].lesson_id)
    if lesson is None or lesson.subject_id != subject_id or lesson.competency_id is None:
        return None
    competency = db.get(Competency, lesson.competency_id)
    if competency is None or competency.subject_id != subject_id:
        return None
    return lesson, competency


def _manual_coverage_at_cutoff(
    db: Session, classwork_id: int, subject_id: int, period_id: int, cutoff: datetime,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Read the association interval, retaining the teacher's competency snapshot."""
    rows = db.query(ClassworkCoverage).filter_by(classwork_id=classwork_id).order_by(
        ClassworkCoverage.coverage_id,
    ).all()
    links: list[dict[str, Any]] = []
    lessons: dict[int, dict[str, Any]] = {}
    competencies: dict[int, dict[str, Any]] = {}
    for row in rows:
        if row.valid_from is None or not (_utc(row.valid_from) <= cutoff and (
            row.valid_until is None or cutoff < _utc(row.valid_until)
        )):
            continue
        lesson = db.get(Lesson, row.lesson_id) if row.lesson_id is not None else None
        if row.lesson_id is not None and (lesson is None or lesson.subject_id != subject_id):
            continue
        competency = db.get(Competency, row.competency_id) if row.competency_id is not None else None
        if row.competency_id is not None and (
            competency is None or competency.subject_id != subject_id
            or competency.academic_period_id not in (None, period_id)
        ):
            continue
        if lesson is not None:
            lessons[lesson.lesson_id] = {"lesson_id": lesson.lesson_id, "title": lesson.title}
        if competency is not None:
            competencies[competency.competency_id] = {
                "competency_id": competency.competency_id,
                "competency_code": competency.competency_code,
                "competency_statement": competency.statement,
            }
        links.append({
            "coverage_id": row.coverage_id,
            "lesson_id": row.lesson_id,
            "competency_id": row.competency_id,
            "valid_from": _utc(row.valid_from).isoformat(),
            "valid_until": _utc(row.valid_until).isoformat() if row.valid_until is not None else None,
            "linked_by_staff_id": row.linked_by_staff_id,
            "provenance": "TEACHER_ASSERTED_ASSESSMENT_COVERAGE",
        })
    return (
        links,
        [lessons[key] for key in sorted(lessons)],
        [competencies[key] for key in sorted(competencies)],
    )


def _quiz_item_evidence(db: Session, submission_id: int, classwork_id: int, subject_id: int) -> list[dict[str, Any]]:
    rows = (
        db.query(QuizAnswer, QuizQuestion, Question, Lesson, Competency)
        .join(QuizQuestion, QuizAnswer.quiz_question_id == QuizQuestion.quiz_question_id)
        .join(Quiz, QuizQuestion.quiz_id == Quiz.quiz_id)
        .join(Question, QuizQuestion.question_id == Question.question_id)
        .outerjoin(Lesson, Question.lesson_id == Lesson.lesson_id)
        .outerjoin(Competency, Lesson.competency_id == Competency.competency_id)
        .filter(QuizAnswer.submission_id == submission_id, Quiz.classwork_id == classwork_id)
        .order_by(QuizQuestion.display_order, QuizQuestion.quiz_question_id)
        .all()
    )
    evidence = []
    for answer, link, question, lesson, competency in rows:
        if (
            answer.points_awarded is None or lesson is None or competency is None
            or lesson.subject_id != subject_id or competency.subject_id != subject_id
            or question.points is None or float(question.points) <= 0
        ):
            continue
        evidence.append({
            "source_type": "QUIZ_QUESTION",
            "quiz_question_id": link.quiz_question_id,
            "lesson_id": lesson.lesson_id,
            "lesson_title": lesson.title,
            "competency_id": competency.competency_id,
            "competency_code": competency.competency_code,
            "competency_statement": competency.statement,
            "score": float(answer.points_awarded),
            "possible_score": float(question.points),
        })
    return evidence


def build_candidate_diagnosis(db: Session, prediction: DevelopmentCurrentTermPrediction) -> dict[str, Any]:
    """Use frozen component features and capture traceable activity detail once."""
    snapshot = prediction.evidence_snapshot
    if not isinstance(snapshot, dict) or snapshot.get("readiness", {}).get("status") != "READY":
        raise ValueError("A READY source prediction is required for diagnosis.")
    cutoff_text = snapshot.get("generation_cutoff_at")
    if not isinstance(cutoff_text, str):
        raise ValueError("The source prediction has no evidence cutoff.")
    cutoff = _utc(datetime.fromisoformat(cutoff_text))
    features = {item["name"]: item["value"] for item in snapshot.get("model_features", [])}
    components, weakest = _component_snapshot(features)
    rows, unresolved = _classwork_rows(
        db, prediction.student_id, prediction.class_id, prediction.subject_id,
        prediction.source_period_id, cutoff,
    )
    activities = []
    assessment_coverage = []
    review_coverage: dict[int, dict[str, Any]] = {}
    competency_evidence: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for assignment, classwork, submission, is_unresolved in rows:
        if is_unresolved or submission is None or submission.grade is None or classwork.total_points is None:
            continue
        score, possible = float(submission.grade), float(classwork.total_points)
        if possible <= 0:
            continue
        classified = classify_classwork_component(
            classwork.classwork_type, classwork.classwork_category, classwork.exam_subtype,
        )
        component = (
            "WRITTEN_WORK" if classified == CanonicalGradingComponent.WRITTEN_WORK
            else "PERFORMANCE_TASK" if classified == CanonicalGradingComponent.PERFORMANCE_TASK
            else "EXAMINATION"
        )
        activity = {
            "classwork_id": classwork.classwork_id,
            "classwork_assignment_id": assignment.classwork_assignment_id,
            "submission_id": submission.submission_id,
            "title": classwork.title,
            "activity_mode": classwork.activity_mode,
            "component": component,
            "exam_subtype": classwork.exam_subtype,
            "score": score,
            "possible_score": possible,
            "percent": round(score / possible * 100, 4),
        }
        activities.append(activity)
        if classwork.activity_mode == "MANUAL":
            links, lessons, covered_competencies = _manual_coverage_at_cutoff(
                db, classwork.classwork_id, prediction.subject_id, prediction.source_period_id, cutoff,
            )
            if links:
                assessment_coverage.append({
                    **activity,
                    "evidence_cutoff_at": cutoff.isoformat(),
                    "coverage_provenance": "TEACHER_ASSERTED_ASSESSMENT_COVERAGE",
                    "score_scope": "ASSESSMENT_TOTAL_ONLY",
                    "competency_score_attribution": "NONE_SHARED_TOTAL_SCORE",
                    "in_weakest_supported_component": component in weakest,
                    "coverage_links": links,
                    "covered_lessons": lessons,
                    "covered_competencies": covered_competencies,
                })
                if component in weakest:
                    for covered in covered_competencies:
                        competency_id = covered["competency_id"]
                        review = review_coverage.setdefault(competency_id, {
                            **covered,
                            "reason": "COVERED_BY_ASSESSMENT_IN_WEAKEST_COMPONENT",
                            "ranking_status": "UNRANKED_SHARED_ASSESSMENT_SCORE",
                            "assessment_classwork_ids": [],
                        })
                        if classwork.classwork_id not in review["assessment_classwork_ids"]:
                            review["assessment_classwork_ids"].append(classwork.classwork_id)
        if component not in weakest:
            continue
        linked = _quiz_item_evidence(db, submission.submission_id, classwork.classwork_id, prediction.subject_id)
        if not linked:
            single = _single_lesson_attribution(db, classwork.classwork_id, prediction.subject_id)
            if single is not None:
                lesson, competency = single
                linked = [{
                    "source_type": "CLASSWORK_SINGLE_LESSON",
                    "lesson_id": lesson.lesson_id,
                    "lesson_title": lesson.title,
                    "competency_id": competency.competency_id,
                    "competency_code": competency.competency_code,
                    "competency_statement": competency.statement,
                    "score": score,
                    "possible_score": possible,
                }]
        for item in linked:
            competency_evidence[item["competency_id"]].append({
                **item,
                "classwork_id": classwork.classwork_id,
                "classwork_assignment_id": assignment.classwork_assignment_id,
                "submission_id": submission.submission_id,
                "activity_title": classwork.title,
                "component": component,
            })

    competencies = []
    for competency_id, evidence in competency_evidence.items():
        earned = sum(item["score"] for item in evidence)
        possible = sum(item["possible_score"] for item in evidence)
        competencies.append({
            "competency_id": competency_id,
            "competency_code": evidence[0]["competency_code"],
            "competency_statement": evidence[0]["competency_statement"],
            "percent": round(earned / possible * 100, 4),
            "score": round(earned, 4),
            "possible_score": round(possible, 4),
            "supporting_scores": evidence,
        })
    competencies.sort(key=lambda item: (item["percent"], item["competency_id"]))
    return {
        "snapshot_version": SNAPSHOT_VERSION,
        "diagnosis_status": "AVAILABLE",
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "source_prediction_id": prediction.prediction_id,
        "student_id": str(prediction.student_id),
        "class_id": prediction.class_id,
        "subject_id": prediction.subject_id,
        "academic_period_id": prediction.source_period_id,
        "evidence_cutoff_at": cutoff.isoformat(),
        "components": components,
        "weakest_supported_components": weakest,
        "supporting_activities": activities,
        "manual_assessment_coverage": assessment_coverage,
        "covered_competencies_for_teacher_review": [
            review_coverage[key] for key in sorted(review_coverage)
        ],
        "lowest_supported_competencies": competencies,
        "competency_detail_status": "AVAILABLE" if competencies else "UNAVAILABLE_NO_TRACEABLE_SCORES",
        "unresolved_activity_evidence": unresolved,
        "external_assessment_detail_status": (
            "AVAILABLE_ASSESSMENT_LEVEL_COVERAGE" if assessment_coverage else "UNAVAILABLE_NO_COMPETENCY_LINK"
        ),
    }

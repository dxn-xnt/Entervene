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
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.quiz.Question import Question
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.classwork.ClassworkAccessService import assignment_allows_student
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


def _single_lesson_quiz_attribution(
    db: Session, classwork_id: int, submission_id: int, subject_id: int,
) -> tuple[Lesson, Competency] | None:
    """Attribute a quiz total ONLY when no per-question answers exist and 100% of quiz items map to one lesson."""
    quiz = db.query(Quiz).filter(Quiz.classwork_id == classwork_id).first()
    if quiz is None:
        return None
    # If the student recorded any per-question QuizAnswer rows (e.g. unmapped questions),
    # never fall back to whole-activity attribution.
    if db.query(QuizAnswer.answer_id).filter_by(submission_id=submission_id).first() is not None:
        return None
    single = _single_lesson_attribution(db, classwork_id, subject_id)
    if single is None:
        return None
    lesson, competency = single
    question_rows = (
        db.query(Question.lesson_id)
        .join(QuizQuestion, QuizQuestion.question_id == Question.question_id)
        .filter(QuizQuestion.quiz_id == quiz.quiz_id)
        .all()
    )
    if not question_rows:
        return None
    if any(row[0] != lesson.lesson_id for row in question_rows):
        return None
    return lesson, competency


def effective_diagnosis_snapshot(db: Session | None, row: Any) -> dict[str, Any]:
    """Return a non-mutating diagnosis view enriched with verified single-lesson quiz evidence and classwork_type."""
    diagnosis = getattr(row, "diagnosis_snapshot", None)
    if not isinstance(diagnosis, dict):
        return {}
    if db is None or not hasattr(row, "subject_id"):
        return diagnosis

    raw_activities = diagnosis.get("supporting_activities") or []
    filtered_activities: list[dict[str, Any]] = []
    activities_changed = False
    row_student_id = getattr(row, "student_id", None)
    row_class_id = getattr(row, "class_id", None)
    row_period_id = getattr(row, "academic_period_id", None)
    for act in raw_activities:
        if not isinstance(act, dict):
            filtered_activities.append(act)
            continue
        assignment_id = act.get("classwork_assignment_id")
        if isinstance(assignment_id, int):
            asgn = db.get(ClassworkAssignment, assignment_id)
            if asgn is not None and (
                (row_class_id is not None and asgn.class_id != row_class_id)
                or (row_period_id is not None and asgn.academic_period_id not in (None, row_period_id))
                or (row_student_id is not None and not assignment_allows_student(asgn, row_student_id))
            ):
                activities_changed = True
                continue
        item = act
        if not act.get("classwork_type") and isinstance(act.get("classwork_id"), int):
            cw = db.get(Classwork, act["classwork_id"])
            if cw is not None and cw.subject_id == row.subject_id:
                item = dict(act)
                item["classwork_type"] = cw.classwork_type
                activities_changed = True
        filtered_activities.append(item)
    enriched_activities: list[dict[str, Any]] | None = filtered_activities if activities_changed else None

    scored = diagnosis.get("lowest_supported_competencies") or []
    coverage = diagnosis.get("manual_assessment_coverage") or []
    weakest = set(diagnosis.get("weakest_supported_components") or [])

    hydrated_competencies: list[dict[str, Any]] | None = None
    if not scored and not coverage and weakest and raw_activities:
        competency_evidence: dict[int, list[dict[str, Any]]] = defaultdict(list)
        for act in raw_activities:
            if not isinstance(act, dict) or act.get("component") not in weakest:
                continue
            classwork_id = act.get("classwork_id")
            assignment_id = act.get("classwork_assignment_id")
            submission_id = act.get("submission_id")
            score = act.get("score")
            possible = act.get("possible_score")
            if (
                not all(isinstance(v, int) for v in (classwork_id, assignment_id, submission_id))
                or not isinstance(score, (int, float))
                or not isinstance(possible, (int, float))
                or possible <= 0
                or act.get("activity_mode") == "MANUAL"
            ):
                continue
            assignment = db.get(ClassworkAssignment, assignment_id)
            classwork = db.get(Classwork, classwork_id)
            submission = db.get(StudentSubmission, submission_id)
            if (
                assignment is None or classwork is None or submission is None
                or assignment.classwork_id != classwork_id
                or assignment.class_id != getattr(row, "class_id", None)
                or assignment.academic_period_id != getattr(row, "academic_period_id", None)
                or assignment.recipient_student_id not in (None, getattr(row, "student_id", None))
                or classwork.subject_id != row.subject_id
                or submission.classwork_assignment_id != assignment_id
                or submission.student_id != getattr(row, "student_id", None)
                or submission.grade is None
                or classwork.total_points is None
                or abs(float(submission.grade) - float(score)) >= 0.000001
                or abs(float(classwork.total_points) - float(possible)) >= 0.000001
            ):
                continue
            single = _single_lesson_quiz_attribution(db, classwork_id, submission_id, row.subject_id)
            if single is None:
                continue
            lesson, competency = single
            competency_evidence[competency.competency_id].append({
                "source_type": "CLASSWORK_SINGLE_LESSON",
                "lesson_id": lesson.lesson_id,
                "lesson_title": lesson.title,
                "competency_id": competency.competency_id,
                "competency_code": competency.competency_code,
                "competency_statement": competency.statement,
                "score": float(score),
                "possible_score": float(possible),
                "classwork_id": classwork_id,
                "classwork_assignment_id": assignment_id,
                "submission_id": submission_id,
                "activity_title": act.get("title") or classwork.title,
                "component": act["component"],
            })
        if competency_evidence:
            hydrated_competencies = []
            for competency_id, evidence in competency_evidence.items():
                earned = sum(item["score"] for item in evidence)
                total_possible = sum(item["possible_score"] for item in evidence)
                hydrated_competencies.append({
                    "competency_id": competency_id,
                    "competency_code": evidence[0]["competency_code"],
                    "competency_statement": evidence[0]["competency_statement"],
                    "percent": round(earned / total_possible * 100, 4),
                    "score": round(earned, 4),
                    "possible_score": round(total_possible, 4),
                    "supporting_scores": evidence,
                })
            hydrated_competencies.sort(key=lambda item: (item["percent"], item["competency_id"]))

    if enriched_activities is None and hydrated_competencies is None:
        return diagnosis

    updated = dict(diagnosis)
    if enriched_activities is not None:
        updated["supporting_activities"] = enriched_activities
    if hydrated_competencies is not None:
        updated["lowest_supported_competencies"] = hydrated_competencies
        updated["competency_detail_status"] = "AVAILABLE"
    return updated


def _stored_target_classwork_lesson_ids(
    db: Session,
    classwork_id: int,
    subject_id: int,
    cutoff: datetime | None,
) -> set[int]:
    """Return explicitly stored subject-scoped lesson links for one classwork."""
    lesson_ids: set[int] = set()
    for link in db.query(ClassworkLesson).filter_by(classwork_id=classwork_id).all():
        lesson = db.get(Lesson, link.lesson_id)
        if lesson is not None and lesson.subject_id == subject_id:
            lesson_ids.add(lesson.lesson_id)

    quiz_question_lessons = (
        db.query(Question.lesson_id)
        .join(QuizQuestion, QuizQuestion.question_id == Question.question_id)
        .join(Quiz, Quiz.quiz_id == QuizQuestion.quiz_id)
        .filter(Quiz.classwork_id == classwork_id, Question.lesson_id.isnot(None))
        .all()
    )
    for (lesson_id,) in quiz_question_lessons:
        lesson = db.get(Lesson, lesson_id)
        if lesson is not None and lesson.subject_id == subject_id:
            lesson_ids.add(lesson.lesson_id)

    coverage_rows = db.query(ClassworkCoverage).filter_by(classwork_id=classwork_id).all()
    for cov in coverage_rows:
        if cov.lesson_id is None:
            continue
        if cutoff is not None:
            if cov.valid_from is None or not (
                _utc(cov.valid_from) <= cutoff
                and (cov.valid_until is None or cutoff < _utc(cov.valid_until))
            ):
                continue
        elif cov.valid_until is not None:
            continue
        lesson = db.get(Lesson, cov.lesson_id)
        if lesson is not None and lesson.subject_id == subject_id:
            lesson_ids.add(lesson.lesson_id)

    return lesson_ids


def scope_diagnosis_to_target(
    db: Session | None,
    row: Any,
    diagnosis: dict[str, Any],
    target_assignment_id: int | None,
) -> dict[str, Any]:
    """Return a non-mutating view of frozen diagnosis evidence scoped to one original target."""
    if target_assignment_id is None or not isinstance(diagnosis, dict):
        return diagnosis

    activities = [
        item for item in (diagnosis.get("supporting_activities") or [])
        if isinstance(item, dict)
    ]
    target_classwork_id: int | None = None
    stored_lesson_ids: set[int] = set()

    matched_activity = next(
        (item for item in activities if item.get("classwork_assignment_id") == target_assignment_id),
        None,
    )
    if matched_activity is not None and isinstance(matched_activity.get("classwork_id"), int):
        target_classwork_id = matched_activity["classwork_id"]

    cutoff: datetime | None = None
    cutoff_text = diagnosis.get("evidence_cutoff_at")
    if isinstance(cutoff_text, str):
        try:
            cutoff = _utc(datetime.fromisoformat(cutoff_text))
        except ValueError:
            cutoff = None

    if db is not None:
        target_asgn = db.get(ClassworkAssignment, target_assignment_id)
        if (
            target_asgn is not None
            and target_asgn.classwork is not None
            and not target_asgn.classwork.is_archived
            and target_asgn.source_intervention_id is None
            and target_asgn.original_exam_assignment_id is None
            and target_asgn.class_id == getattr(row, "class_id", None)
            and target_asgn.academic_period_id == getattr(row, "academic_period_id", None)
            and target_asgn.classwork.subject_id == getattr(row, "subject_id", None)
            and assignment_allows_student(target_asgn, getattr(row, "student_id", None))
        ):
            target_classwork_id = target_asgn.classwork_id
            stored_lesson_ids = _stored_target_classwork_lesson_ids(
                db, target_asgn.classwork_id, target_asgn.classwork.subject_id, cutoff,
            )

    if target_classwork_id is None and matched_activity is None:
        return diagnosis

    def _matches_target(item: dict[str, Any]) -> bool:
        item_asgn_id = item.get("classwork_assignment_id")
        if isinstance(item_asgn_id, int):
            return item_asgn_id == target_assignment_id
        return target_classwork_id is not None and item.get("classwork_id") == target_classwork_id

    target_activities = [item for item in activities if _matches_target(item)]

    def _filter_competencies(predicate) -> list[dict[str, Any]]:
        filtered: list[dict[str, Any]] = []
        for comp in diagnosis.get("lowest_supported_competencies") or []:
            if not isinstance(comp, dict):
                continue
            scores = [
                score for score in (comp.get("supporting_scores") or [])
                if isinstance(score, dict) and predicate(score)
            ]
            if not scores:
                continue
            earned = sum(
                float(s["score"]) for s in scores if isinstance(s.get("score"), (int, float))
            )
            possible = sum(
                float(s["possible_score"])
                for s in scores
                if isinstance(s.get("possible_score"), (int, float))
            )
            percent = round(earned / possible * 100, 4) if possible > 0 else comp.get("percent")
            filtered.append({
                **comp,
                "score": round(earned, 4) if possible > 0 else comp.get("score"),
                "possible_score": round(possible, 4) if possible > 0 else comp.get("possible_score"),
                "percent": percent,
                "supporting_scores": scores,
            })
        filtered.sort(key=lambda item: (
            item["percent"] if isinstance(item.get("percent"), (int, float)) else float("inf"),
            item.get("competency_id") or 0,
        ))
        return filtered

    target_competencies = _filter_competencies(_matches_target)
    target_coverage = [
        item for item in (diagnosis.get("manual_assessment_coverage") or [])
        if isinstance(item, dict) and _matches_target(item)
    ]

    if target_competencies or target_coverage:
        updated = dict(diagnosis)
        updated["lowest_supported_competencies"] = target_competencies
        updated["manual_assessment_coverage"] = target_coverage
        if target_activities:
            updated["supporting_activities"] = target_activities
        return updated

    if target_activities:
        updated = dict(diagnosis)
        updated["lowest_supported_competencies"] = []
        updated["manual_assessment_coverage"] = []
        updated["supporting_activities"] = target_activities
        return updated

    if stored_lesson_ids:
        lesson_competencies = _filter_competencies(
            lambda score: isinstance(score.get("lesson_id"), int) and score["lesson_id"] in stored_lesson_ids
        )
        lesson_coverage: list[dict[str, Any]] = []
        for cov in diagnosis.get("manual_assessment_coverage") or []:
            if not isinstance(cov, dict):
                continue
            cov_lessons = [
                lesson for lesson in (cov.get("covered_lessons") or [])
                if isinstance(lesson, dict) and lesson.get("lesson_id") in stored_lesson_ids
            ]
            cov_links = [
                link for link in (cov.get("coverage_links") or [])
                if isinstance(link, dict) and link.get("lesson_id") in stored_lesson_ids
            ]
            if cov_lessons and cov_links:
                allowed_comp_ids = {
                    link.get("competency_id") for link in cov_links if isinstance(link.get("competency_id"), int)
                }
                cov_comps = [
                    comp for comp in (cov.get("covered_competencies") or [])
                    if isinstance(comp, dict) and comp.get("competency_id") in allowed_comp_ids
                ]
                lesson_coverage.append({
                    **cov,
                    "covered_lessons": cov_lessons,
                    "coverage_links": cov_links,
                    "covered_competencies": cov_comps,
                })
        updated = dict(diagnosis)
        updated["lowest_supported_competencies"] = lesson_competencies
        updated["manual_assessment_coverage"] = lesson_coverage
        return updated

    return diagnosis


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
        if (
            is_unresolved
            or assignment.recipient_student_id not in (None, prediction.student_id)
            or submission is None
            or submission.grade is None
            or classwork.total_points is None
        ):
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
            "classwork_type": classwork.classwork_type,
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
        # Whole-activity attribution applies to single-lesson non-quiz activities, or to a
        # quiz scored without per-question answers ONLY when 100% of quiz items map to that one lesson.
        if not linked:
            has_quiz = db.query(Quiz.quiz_id).filter(Quiz.classwork_id == classwork.classwork_id).first() is not None
            single = (
                _single_lesson_quiz_attribution(db, classwork.classwork_id, submission.submission_id, prediction.subject_id)
                if has_quiz
                else _single_lesson_attribution(db, classwork.classwork_id, prediction.subject_id)
            )
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

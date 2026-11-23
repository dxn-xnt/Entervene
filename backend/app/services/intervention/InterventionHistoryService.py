"""Read existing resolution evidence and targeted work without changing history."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionSupportMaterial import InterventionSupportMaterial
from app.models.intervention.PracticeAssessment import PracticeAssessment
from app.models.intervention.PracticeAttempt import PracticeAttempt
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.classwork.ClassworkShared import is_reading_type
from app.services.grading.ComponentMapper import CanonicalGradingComponent, classify_classwork_component
from app.services.grading.PassingThresholdReader import require_subject_passing_threshold
from app.services.grading.RemedialExamination import (
    _submission_grade_sort_key,
    effective_exam_score_for_change,
    latest_graded_submission_score,
)
from app.services.grading.RemediationScoreAdjuster import adjust_remediation_score
from app.services.intervention.RemediationAttemptPolicy import (
    evaluate_remediation_assessment_pass,
    list_remediation_attempt_history,
    remediation_max_attempts,
)
from app.services.quiz.QuizResultsReleasePolicy import quiz_results_are_visible


IMPROVED_RESOLUTION_REASONS = frozenset({
    "IMPROVED_PREDICTION",
    "REMEDIATION_IMPROVED_PREDICTION",
})


def resolution_prediction(
    db: Session,
    row: Intervention,
    source: DevelopmentCurrentTermPrediction | None = None,
) -> DevelopmentCurrentTermPrediction | None:
    if row.status != "RESOLVED" or row.resolved_at is None:
        return None
    resolved_source = (
        source
        or row.source_prediction
        or db.get(DevelopmentCurrentTermPrediction, row.source_prediction_id)
    )
    if resolved_source is None:
        return None

    # Prefer the exact prediction_id recorded at resolution time when available and in scope.
    plan = row.remediation_plan if isinstance(row.remediation_plan, dict) else {}
    review = plan.get("resolution_review") if isinstance(plan.get("resolution_review"), dict) else {}
    recorded_pred_id = review.get("prediction_id")
    if isinstance(recorded_pred_id, int):
        recorded = db.get(DevelopmentCurrentTermPrediction, recorded_pred_id)
        if (
            recorded is not None
            and recorded.student_id == row.student_id
            and recorded.class_id == row.class_id
            and recorded.subject_id == row.subject_id
            and recorded.source_period_id == row.academic_period_id
            and recorded.target_period_id == row.academic_period_id
            and recorded.model_version_id == resolved_source.model_version_id
            and recorded.revision >= resolved_source.revision
        ):
            return recorded

    query = db.query(DevelopmentCurrentTermPrediction).filter_by(
        student_id=row.student_id, class_id=row.class_id, subject_id=row.subject_id,
        source_period_id=row.academic_period_id, target_period_id=row.academic_period_id,
        model_version_id=resolved_source.model_version_id,
    ).filter(
        DevelopmentCurrentTermPrediction.revision >= resolved_source.revision,
        DevelopmentCurrentTermPrediction.generated_at <= row.resolved_at,
    )
    next_cycle_revision = (
        db.query(DevelopmentCurrentTermPrediction.revision)
        .join(
            Intervention,
            Intervention.source_prediction_id == DevelopmentCurrentTermPrediction.prediction_id,
        )
        .filter(
            Intervention.student_id == row.student_id,
            Intervention.class_id == row.class_id,
            Intervention.subject_id == row.subject_id,
            Intervention.academic_period_id == row.academic_period_id,
            Intervention.intervention_id != row.intervention_id,
            DevelopmentCurrentTermPrediction.model_version_id == resolved_source.model_version_id,
            DevelopmentCurrentTermPrediction.revision > resolved_source.revision,
        )
        .order_by(DevelopmentCurrentTermPrediction.revision.asc())
        .limit(1)
        .scalar()
    )
    if next_cycle_revision is not None:
        query = query.filter(DevelopmentCurrentTermPrediction.revision < next_cycle_revision)
    return query.order_by(DevelopmentCurrentTermPrediction.revision.desc()).first()


def resolution_projection(db: Session, row: Intervention) -> float | None:
    prediction = resolution_prediction(db, row)
    if prediction is None or not isinstance(prediction.evidence_snapshot, dict):
        return None
    readiness = prediction.evidence_snapshot.get("readiness")
    value = prediction.evidence_snapshot.get("projected_final_term_grade_raw")
    if not isinstance(readiness, dict) or readiness.get("status") != "READY" or not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    if row.resolution_reason in IMPROVED_RESOLUTION_REASONS:
        threshold_val = 85.0
        try:
            period = db.get(AcademicPeriod, row.academic_period_id)
            if period:
                res = require_subject_passing_threshold(
                    db,
                    academic_year_id=period.academic_year_id,
                    subject_id=row.subject_id,
                    academic_period_id=row.academic_period_id,
                )
                threshold_val = float(res.threshold)
        except Exception:
            pass
        if float(value) < threshold_val:
            return None
    return float(value)


def _activity_score_visible(
    db: Session,
    assignment: ClassworkAssignment,
    work,
    submission: StudentSubmission | None,
    *,
    student_view: bool,
) -> bool:
    if not student_view:
        return True
    if work is None:
        return False
    if (work.classwork_type or "").strip().upper() == "QUIZ":
        setting = db.query(QuizSetting).filter_by(classwork_id=work.classwork_id).first()
        return quiz_results_are_visible(
            work,
            setting,
            assignment,
            submission_status=submission.status if submission else None,
        )
    return bool(work.show_scores)


def _select_latest_graded_or_recent(
    attempt_rows: list[StudentSubmission],
) -> tuple[StudentSubmission | None, StudentSubmission | None]:
    """Return (primary_submission, latest_graded_submission).

    Prefers the latest graded submission so an unfinished/pending retake left
    open at resolution never hides a previously graded remediation attempt.
    """
    if not attempt_rows:
        return None, None
    graded_rows = [
        item for item in attempt_rows
        if (item.status or "").lower() == "graded" and item.grade is not None
    ]
    if not graded_rows:
        graded_rows = [item for item in attempt_rows if item.grade is not None]
    latest_graded = (
        max(graded_rows, key=_submission_grade_sort_key)
        if graded_rows
        else None
    )
    latest_any = max(attempt_rows, key=lambda item: (int(item.attempt_count or 0), int(item.submission_id or 0)))
    return (latest_graded or latest_any), latest_graded


def _build_live_targeted_activities(
    db: Session,
    row: Intervention,
    *,
    student_view: bool,
) -> list[dict[str, Any]]:
    assignments = db.query(ClassworkAssignment).filter_by(
        source_intervention_id=row.intervention_id, recipient_student_id=row.student_id,
    ).order_by(ClassworkAssignment.classwork_assignment_id).all()
    result: list[dict[str, Any]] = []
    for assignment in assignments:
        work = assignment.classwork
        if work is None or is_reading_type(work.classwork_type):
            continue
        attempt_rows = list_remediation_attempt_history(
            db, assignment.classwork_assignment_id, row.student_id,
        )
        submission, latest_graded = _select_latest_graded_or_recent(attempt_rows)
        if not submission and (not assignment.is_published or not work.is_published or work.is_archived):
            continue
        visible_score = _activity_score_visible(
            db, assignment, work, submission, student_view=student_view,
        )
        original_assignment_id = assignment.original_exam_assignment_id
        original = db.get(ClassworkAssignment, original_assignment_id) if original_assignment_id else None
        original_submission = (
            db.query(StudentSubmission)
            .filter_by(classwork_assignment_id=original.classwork_assignment_id, student_id=row.student_id)
            .filter(StudentSubmission.grade.isnot(None))
            .order_by(StudentSubmission.submission_id.desc())
            .first()
            if original
            else None
        )
        original_visible_score = (
            _activity_score_visible(
                db, original, original.classwork, original_submission, student_view=student_view,
            )
            if original
            else visible_score
        )
        raw_exam_orig = (
            latest_graded_submission_score(db, original.classwork_assignment_id, row.student_id)
            if original
            else None
        )
        original_grade = (
            float(raw_exam_orig)
            if raw_exam_orig is not None and visible_score and original_visible_score
            else None
        )
        rem_grade = float(latest_graded.grade) if latest_graded and latest_graded.grade is not None else None
        effective_grade = (
            effective_exam_score_for_change(db, assignment, row.student_id, rem_grade)
            if original and visible_score and original_visible_score
            else None
        )
        exam_subtype = work.exam_subtype if original else None
        score_adjustment_cap: float | None = None
        component_value: str | None = (
            "EXAMINATION"
            if original is not None
            else None
        )

        if original_assignment_id is None:
            link = db.query(RemediationAssignmentLink).filter_by(
                remediation_assignment_id=assignment.classwork_assignment_id,
            ).first()
            if link is not None:
                original_assignment_id = link.original_assignment_id
                score_adjustment_cap = (
                    float(link.score_adjustment_cap)
                    if link.score_adjustment_cap is not None
                    else None
                )
                component_value = link.component
                original = db.get(ClassworkAssignment, link.original_assignment_id)
                original_submission = (
                    db.query(StudentSubmission)
                    .filter_by(classwork_assignment_id=link.original_assignment_id, student_id=row.student_id)
                    .filter(StudentSubmission.grade.isnot(None))
                    .order_by(StudentSubmission.submission_id.desc())
                    .first()
                    if original
                    else None
                )
                original_visible_score = (
                    _activity_score_visible(
                        db, original, original.classwork, original_submission, student_view=student_view,
                    )
                    if original
                    else visible_score
                )
                raw_orig_val = (
                    latest_graded_submission_score(db, link.original_assignment_id, row.student_id)
                    if original
                    else None
                )
                raw_orig = float(raw_orig_val) if raw_orig_val is not None else None
                original_grade = raw_orig if (visible_score and original_visible_score) else None
                if visible_score and original_visible_score and raw_orig is not None:
                    if rem_grade is not None and original and original.classwork and original.classwork.total_points:
                        adj = adjust_remediation_score(
                            original_score=raw_orig,
                            remediation_score=rem_grade,
                            max_points=float(original.classwork.total_points),
                            cap_percentage=link.score_adjustment_cap,
                        )
                        effective_grade = float(adj.effective_score)
                    else:
                        effective_grade = raw_orig

        if component_value is None:
            classified = classify_classwork_component(
                work.classwork_type, work.classwork_category, getattr(work, "exam_subtype", None),
            )
            component_value = (
                "EXAMINATION"
                if classified == CanonicalGradingComponent.ASSESSMENT
                else classified.value
            )

        is_passed, _pass_threshold = evaluate_remediation_assessment_pass(
            db, assignment, work, latest_graded or submission,
        )
        max_attempts = remediation_max_attempts(db, assignment, work)
        completed_attempts = [
            item for item in attempt_rows
            if (item.status or "").lower() in {"submitted", "late", "graded"} or item.grade is not None
        ]
        attempts_used = (
            max((int(item.attempt_count or 0) for item in completed_attempts), default=0)
            if completed_attempts
            else (int(submission.attempt_count or 0) if submission is not None else 0)
        )
        if attempts_used == 0 and completed_attempts:
            attempts_used = len(completed_attempts)

        attempt_history = [
            {
                "submission_id": item.submission_id,
                "attempt_count": int(item.attempt_count or idx),
                "status": item.status,
                "grade": float(item.grade) if item.grade is not None and visible_score else None,
                "submitted_at": item.submitted_at.isoformat() if item.submitted_at else None,
                "graded_at": item.graded_at.isoformat() if item.graded_at else None,
            }
            for idx, item in enumerate(attempt_rows, start=1)
        ]

        result.append({
            "assignment_id": assignment.classwork_assignment_id,
            "title": work.title,
            "classwork_type": work.classwork_type,
            "component": component_value,
            "submission_status": submission.status if submission else None,
            "grade": rem_grade if visible_score else None,
            "total_points": float(work.total_points) if work.total_points is not None and visible_score else None,
            "attempt_count": attempts_used,
            "max_attempts": max_attempts,
            "is_passed": bool(is_passed) if visible_score else False,
            "score_adjustment_cap": score_adjustment_cap,
            "attempt_history": attempt_history if not student_view else [],
            "original_assignment_id": original_assignment_id,
            "original_title": original.classwork.title if original and original.classwork else None,
            "exam_subtype": exam_subtype,
            "original_grade": original_grade,
            "effective_grade": effective_grade,
        })
    return result


def targeted_activities(db: Session, row: Intervention, *, student_view: bool) -> list[dict]:
    """Return frozen targeted remediation history when available, else safe live reconstruction."""
    if not student_view and row.status == "RESOLVED":
        plan = row.remediation_plan if isinstance(row.remediation_plan, dict) else {}
        snapshot = plan.get("resolution_history_snapshot")
        if isinstance(snapshot, dict) and isinstance(snapshot.get("targeted_activities"), list):
            return [dict(item) for item in snapshot["targeted_activities"]]
    return _build_live_targeted_activities(db, row, student_view=student_view)


def _build_live_practice_assessment_history(
    db: Session,
    row: Intervention,
) -> dict[str, Any] | None:
    assessment = db.query(PracticeAssessment).filter_by(intervention_id=row.intervention_id).first()
    if assessment is None:
        return None
    attempts = (
        db.query(PracticeAttempt)
        .filter_by(
            practice_assessment_id=assessment.practice_assessment_id,
            student_id=row.student_id,
        )
        .order_by(PracticeAttempt.attempt_number.asc(), PracticeAttempt.attempt_id.asc())
        .all()
    )
    from app.services.intervention.PracticeAssessmentService import evaluate_practice_progression
    progression = evaluate_practice_progression(db, row.intervention_id, row.student_id)
    total_points = float(sum((q.points for q in assessment.questions), 0))
    return {
        "practice_assessment_id": assessment.practice_assessment_id,
        "title": assessment.title,
        "status": assessment.status,
        "gatekeeper_policy": assessment.gatekeeper_policy,
        "passing_percentage": float(assessment.passing_percentage),
        "total_questions": len(assessment.questions),
        "total_points": total_points,
        "attempts_count": len(attempts),
        "submitted_attempts_count": progression.attempts_count,
        "practice_passed": progression.practice_passed,
        "eligible_for_remediation": progression.eligible_for_remediation,
        "best_score_percentage": float(progression.best_score_percentage) if progression.best_score_percentage is not None else None,
        "progression_reason": progression.reason,
        "attempts": [
            {
                "attempt_id": att.attempt_id,
                "attempt_number": att.attempt_number,
                "reading_review_cycle": att.reading_review_cycle,
                "status": att.status,
                "total_score": float(att.total_score),
                "max_score": float(att.max_score),
                "score_percentage": float(att.score_percentage),
                "passing_threshold_snapshot": float(att.passing_threshold_snapshot),
                "is_passed": bool(att.is_passed),
                "started_at": att.started_at.isoformat() if att.started_at else None,
                "completed_at": att.completed_at.isoformat() if att.completed_at else None,
            }
            for att in attempts
        ],
    }


def practice_assessment_history(db: Session, row: Intervention) -> dict[str, Any] | None:
    """Return frozen Practice Assessment history when available, else safe live reconstruction."""
    if row.status == "RESOLVED":
        plan = row.remediation_plan if isinstance(row.remediation_plan, dict) else {}
        snapshot = plan.get("resolution_history_snapshot")
        if isinstance(snapshot, dict) and "practice_assessment" in snapshot:
            saved = snapshot.get("practice_assessment")
            return dict(saved) if isinstance(saved, dict) else None
    return _build_live_practice_assessment_history(db, row)


def capture_resolution_history_snapshot(
    db: Session,
    row: Intervention,
    *,
    prediction: DevelopmentCurrentTermPrediction | None = None,
    predicted_grade: float | None = None,
) -> dict[str, Any]:
    """Capture immutable targeted remediation and practice assessment history at resolution time."""
    now = datetime.now(timezone.utc)
    return {
        "snapshot_version": "RESOLUTION_HISTORY_V1",
        "captured_at": now.isoformat(),
        "resolution_prediction": (
            {
                "prediction_id": prediction.prediction_id,
                "revision": prediction.revision,
                "projected_final_term_grade": predicted_grade,
                "intervention_level": prediction.intervention_level,
            }
            if prediction is not None
            else None
        ),
        "targeted_activities": _build_live_targeted_activities(db, row, student_view=False),
        "practice_assessment": _build_live_practice_assessment_history(db, row),
    }


def sent_reviewer(db: Session, row: Intervention) -> InterventionSupportMaterial | None:
    return db.query(InterventionSupportMaterial).filter_by(
        intervention_id=row.intervention_id, kind="STUDENT_REVIEWER", status="SENT",
    ).filter(InterventionSupportMaterial.sent_at.isnot(None)).one_or_none()

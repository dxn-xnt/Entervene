"""Evidence-based remediation attribution and ACTIVE intervention resolution evaluation.

Determines whether a persisted current-term prediction crossing the subject passing
threshold for an ACTIVE intervention was verifiably caused solely by graded remediation
improvement belonging to that intervention, versus regular classwork, mixed changes,
policy threshold edits, or uncertain causes.

Design invariant:
- Never auto-resolve an ACTIVE intervention unless actual grading records and the
  persisted prediction feature delta independently prove that graded remediation
  improvement for THIS intervention drove the transition from below-threshold to
  at-or-above threshold.
- If attribution is mixed, regular-classwork-driven, threshold-driven, or uncertain
  in any way, retain manual teacher review ("Resolution Recommended").
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import math
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.classwork.ClassworkShared import is_reading_type
from app.services.grading.ComponentMapper import CanonicalGradingComponent, classify_classwork_component
from app.services.grading.ExaminationCalculator import ExaminationObservation, compute_examination_component
from app.services.grading.RemedialClassworkResolver import resolve_student_classwork_scores
from app.services.grading.RemedialExamination import effective_exam_scores
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    _as_utc,
    _classwork_rows,
    _evidence_time,
    _to_float,
)


REMEDIATION_IMPROVED_PREDICTION = "REMEDIATION_IMPROVED_PREDICTION"

STRUCTURAL_FEATURES = (
    "grade_level",
    "subject",
    "ww_weight",
    "pt_weight",
    "qa_weight",
    "ww_available_activity_count",
    "pt_available_activity_count",
    "qa_available_activity_count",
    "overall_available_activity_count",
    "ww_points_possible_so_far",
    "pt_points_possible_so_far",
    "qa_points_possible_so_far",
    "observed_component_weight_sum",
    "ww_has_evidence",
    "pt_has_evidence",
    "qa_has_evidence",
    "has_any_input_evidence",
)

FEATURE_DELTA_TOLERANCE = 1e-3


@dataclass(frozen=True)
class ResolutionAttributionResult:
    """Verified attribution outcome for an ACTIVE intervention crossing threshold."""

    should_auto_resolve: bool
    attribution_code: str
    reason_summary: str
    previous_prediction_id: int | None = None
    previous_prediction_revision: int | None = None
    previous_predicted_grade: float | None = None
    remediation_assignment_ids: tuple[int, ...] = ()
    remediation_component_deltas: dict[str, float] | None = None

    def to_review_metadata(self) -> dict[str, Any]:
        return {
            "attribution_code": self.attribution_code,
            "attribution_summary": self.reason_summary,
            "previous_prediction_id": self.previous_prediction_id,
            "previous_prediction_revision": self.previous_prediction_revision,
            "previous_predicted_grade": self.previous_predicted_grade,
            "remediation_assignment_ids": list(self.remediation_assignment_ids),
            "remediation_component_deltas": dict(self.remediation_component_deltas or {}),
        }


def _extract_feature_map(prediction: DevelopmentCurrentTermPrediction) -> dict[str, Any] | None:
    snapshot = prediction.evidence_snapshot if isinstance(prediction.evidence_snapshot, dict) else None
    if not snapshot:
        return None
    raw_features = snapshot.get("model_features")
    if not isinstance(raw_features, list) or not raw_features:
        return None
    mapping: dict[str, Any] = {}
    for item in raw_features:
        if isinstance(item, dict) and "name" in item:
            mapping[str(item["name"])] = item.get("value")
    return mapping or None


def _extract_raw_grade(prediction: DevelopmentCurrentTermPrediction) -> float | None:
    snapshot = prediction.evidence_snapshot if isinstance(prediction.evidence_snapshot, dict) else {}
    raw = snapshot.get("projected_final_term_grade_raw")
    if raw is None or isinstance(raw, bool):
        return None
    try:
        val = float(raw)
    except (TypeError, ValueError, OverflowError):
        return None
    return val if math.isfinite(val) else None


def _extract_cutoff(prediction: DevelopmentCurrentTermPrediction) -> datetime | None:
    snapshot = prediction.evidence_snapshot if isinstance(prediction.evidence_snapshot, dict) else {}
    raw_cutoff = snapshot.get("generation_cutoff_at")
    if isinstance(raw_cutoff, str):
        try:
            return _as_utc(datetime.fromisoformat(raw_cutoff))
        except ValueError:
            pass
    if prediction.generated_at is not None:
        return _as_utc(prediction.generated_at)
    return None


def _compute_qa_earned_from_exam_rows(
    rows: list[tuple[ClassworkAssignment, Classwork, StudentSubmission | None, bool]],
    student_id: UUID,
    effective_exams: dict[int, float | None],
) -> tuple[float, bool]:
    """Compute QA earned points using the same formula as CurrentPeriodFeatureBuilderService."""
    exam_observations: list[ExaminationObservation] = []
    plain_earned = 0.0
    plain_count = 0
    for assignment, classwork, submission, is_unresolved in rows:
        if (
            assignment.recipient_student_id not in (None, student_id)
            or assignment.original_exam_assignment_id is not None
        ):
            continue
        component = classify_classwork_component(
            classwork.classwork_type,
            classwork.classwork_category,
            getattr(classwork, "exam_subtype", None),
        )
        if component != CanonicalGradingComponent.ASSESSMENT or is_unresolved:
            continue
        score = _to_float(submission.grade) if submission and submission.grade is not None else None
        if assignment.classwork_assignment_id in effective_exams:
            score = effective_exams[assignment.classwork_assignment_id]
        possible = _to_float(classwork.total_points)
        if getattr(classwork, "exam_subtype", None):
            exam_observations.append(
                ExaminationObservation(
                    score=score,
                    possible=possible,
                    exam_subtype=getattr(classwork, "exam_subtype", None),
                    title=getattr(classwork, "title", None),
                    category=getattr(classwork, "classwork_category", None),
                    unresolved=False,
                    administered=True,
                )
            )
        elif score is not None and possible is not None and possible > 0:
            plain_earned += score
            plain_count += 1

    if exam_observations:
        exam_result = compute_examination_component(exam_observations, require_complete_for_percent=True)
        if exam_result.examination_percent is None:
            return 0.0, False
        return round((exam_result.examination_percent / 100.0) * 40.0, 4), True
    if plain_count > 0:
        return round(plain_earned, 4), True
    return 0.0, False


def _feature_values_equal(left: Any, right: Any) -> bool:
    if isinstance(left, (int, float)) and not isinstance(left, bool) and isinstance(right, (int, float)) and not isinstance(right, bool):
        return abs(float(left) - float(right)) <= FEATURE_DELTA_TOLERANCE
    return left == right


def evaluate_active_resolution_attribution(
    db: Session,
    intervention: Intervention,
    prediction: DevelopmentCurrentTermPrediction,
    *,
    passing_threshold: float,
    trigger_assignment_id: int | None = None,
) -> ResolutionAttributionResult:
    """Verify whether an ACTIVE intervention crossing threshold was solely remediation-driven."""
    curr_grade = _extract_raw_grade(prediction)
    if curr_grade is None or curr_grade < passing_threshold:
        return ResolutionAttributionResult(
            should_auto_resolve=False,
            attribution_code="BELOW_THRESHOLD",
            reason_summary="Latest prediction has not reached the passing threshold.",
        )

    # 1. Must transition from an immediately preceding READY revision that was BELOW threshold.
    prev_prediction = (
        db.query(DevelopmentCurrentTermPrediction)
        .filter(
            DevelopmentCurrentTermPrediction.student_id == intervention.student_id,
            DevelopmentCurrentTermPrediction.class_id == intervention.class_id,
            DevelopmentCurrentTermPrediction.subject_id == intervention.subject_id,
            DevelopmentCurrentTermPrediction.source_period_id == intervention.academic_period_id,
            DevelopmentCurrentTermPrediction.target_period_id == intervention.academic_period_id,
            DevelopmentCurrentTermPrediction.model_version_id == prediction.model_version_id,
            DevelopmentCurrentTermPrediction.revision < prediction.revision,
        )
        .order_by(DevelopmentCurrentTermPrediction.revision.desc())
        .first()
    )
    if prev_prediction is None:
        return ResolutionAttributionResult(
            should_auto_resolve=False,
            attribution_code="UNCERTAIN_NO_PRIOR_REVISION",
            reason_summary="Prediction reached the passing target without a prior revision to verify remediation attribution; teacher review required.",
        )

    prev_snapshot = prev_prediction.evidence_snapshot if isinstance(prev_prediction.evidence_snapshot, dict) else {}
    prev_readiness = prev_snapshot.get("readiness")
    prev_grade = _extract_raw_grade(prev_prediction)
    if (
        not isinstance(prev_readiness, dict)
        or prev_readiness.get("status") != "READY"
        or prev_grade is None
    ):
        return ResolutionAttributionResult(
            should_auto_resolve=False,
            attribution_code="UNCERTAIN_PRIOR_NOT_READY",
            reason_summary="Prior prediction evidence was not ready for attribution comparison; teacher review required.",
            previous_prediction_id=prev_prediction.prediction_id,
            previous_prediction_revision=prev_prediction.revision,
            previous_predicted_grade=prev_grade,
        )

    if prev_grade >= passing_threshold:
        return ResolutionAttributionResult(
            should_auto_resolve=False,
            attribution_code="POLICY_OR_ALREADY_PASSING",
            reason_summary="Prior prediction was already at or above the passing target; teacher review required.",
            previous_prediction_id=prev_prediction.prediction_id,
            previous_prediction_revision=prev_prediction.revision,
            previous_predicted_grade=prev_grade,
        )

    if curr_grade <= prev_grade:
        return ResolutionAttributionResult(
            should_auto_resolve=False,
            attribution_code="UNCERTAIN_NO_POSITIVE_GAIN",
            reason_summary="Prediction did not increase from the prior revision; teacher review required.",
            previous_prediction_id=prev_prediction.prediction_id,
            previous_prediction_revision=prev_prediction.revision,
            previous_predicted_grade=prev_grade,
        )

    # 2. If caller explicitly passed the triggering assignment, verify it belongs to THIS intervention's graded remediation.
    trigger_is_this_intervention_remediation = False
    if trigger_assignment_id is not None:
        trig_asgn = db.get(ClassworkAssignment, trigger_assignment_id)
        trig_work = trig_asgn.classwork if trig_asgn is not None else None
        if (
            trig_asgn is None
            or trig_work is None
            or trig_asgn.source_intervention_id != intervention.intervention_id
            or trig_asgn.recipient_student_id != intervention.student_id
            or not trig_work.is_graded
            or is_reading_type(trig_work.classwork_type)
        ):
            return ResolutionAttributionResult(
                should_auto_resolve=False,
                attribution_code="REGULAR_CLASSWORK_TRIGGER",
                reason_summary="Latest prediction improved after regular classwork or non-remediation grading; teacher confirmation is required.",
                previous_prediction_id=prev_prediction.prediction_id,
                previous_prediction_revision=prev_prediction.revision,
                previous_predicted_grade=prev_grade,
            )
        trigger_is_this_intervention_remediation = True

    # 3. Extract and validate model feature vectors from both revisions.
    prev_features = _extract_feature_map(prev_prediction)
    curr_features = _extract_feature_map(prediction)
    prev_cutoff = _extract_cutoff(prev_prediction)
    curr_cutoff = _extract_cutoff(prediction)
    if prev_features is None or curr_features is None or prev_cutoff is None or curr_cutoff is None:
        return ResolutionAttributionResult(
            should_auto_resolve=False,
            attribution_code="UNCERTAIN_MISSING_FEATURES",
            reason_summary="Prediction feature evidence is incomplete for remediation attribution; teacher review required.",
            previous_prediction_id=prev_prediction.prediction_id,
            previous_prediction_revision=prev_prediction.revision,
            previous_predicted_grade=prev_grade,
        )

    # 4. Structural features MUST be identical (any new/removed/ungraded regular classwork changes counts or possible points).
    for feat_name in STRUCTURAL_FEATURES:
        if not _feature_values_equal(prev_features.get(feat_name), curr_features.get(feat_name)):
            return ResolutionAttributionResult(
                should_auto_resolve=False,
                attribution_code="REGULAR_CLASSWORK_OR_MIXED",
                reason_summary="Classwork count, weights, or possible points changed between predictions, indicating regular classwork or mixed changes; teacher confirmation is required.",
                previous_prediction_id=prev_prediction.prediction_id,
                previous_prediction_revision=prev_prediction.revision,
                previous_predicted_grade=prev_grade,
            )

    # 5. Inspect grading records at prev_cutoff and curr_cutoff.
    curr_rows, curr_unresolved = _classwork_rows(
        db,
        intervention.student_id,
        intervention.class_id,
        intervention.subject_id,
        intervention.academic_period_id,
        curr_cutoff,
    )
    prev_rows, prev_unresolved = _classwork_rows(
        db,
        intervention.student_id,
        intervention.class_id,
        intervention.subject_id,
        intervention.academic_period_id,
        prev_cutoff,
    )
    if curr_unresolved or prev_unresolved:
        return ResolutionAttributionResult(
            should_auto_resolve=False,
            attribution_code="UNCERTAIN_UNRESOLVED_EVIDENCE",
            reason_summary="Unresolved submission timestamps prevent reliable remediation attribution; teacher review required.",
            previous_prediction_id=prev_prediction.prediction_id,
            previous_prediction_revision=prev_prediction.revision,
            previous_predicted_grade=prev_grade,
        )

    # 5a. Ensure NO non-remedial (regular) assignment was newly graded or re-graded after prev_cutoff.
    prev_rows_by_id = {asgn.classwork_assignment_id: sub for asgn, _cw, sub, _unres in prev_rows}
    for asgn, cw, curr_sub, _unres in curr_rows:
        if asgn.recipient_student_id not in (None, intervention.student_id):
            continue
        is_this_intervention_remedial = (
            asgn.source_intervention_id == intervention.intervention_id
            and asgn.recipient_student_id == intervention.student_id
        )
        if is_this_intervention_remedial:
            continue
        # Regular classwork (or another intervention's assignment): must not have changed after prev_cutoff.
        prev_sub = prev_rows_by_id.get(asgn.classwork_assignment_id)
        if curr_sub is not None:
            ev_time = _evidence_time(curr_sub)
            if ev_time is not None and _as_utc(ev_time) > prev_cutoff:
                return ResolutionAttributionResult(
                    should_auto_resolve=False,
                    attribution_code="REGULAR_CLASSWORK_OR_MIXED",
                    reason_summary="Regular classwork grading changed since the previous prediction; teacher confirmation is required.",
                    previous_prediction_id=prev_prediction.prediction_id,
                    previous_prediction_revision=prev_prediction.revision,
                    previous_predicted_grade=prev_grade,
                )
        prev_grade_val = _to_float(prev_sub.grade) if prev_sub and prev_sub.grade is not None else None
        curr_grade_val = _to_float(curr_sub.grade) if curr_sub and curr_sub.grade is not None else None
        if prev_grade_val != curr_grade_val:
            return ResolutionAttributionResult(
                should_auto_resolve=False,
                attribution_code="REGULAR_CLASSWORK_OR_MIXED",
                reason_summary="Regular classwork scores changed since the previous prediction; teacher confirmation is required.",
                previous_prediction_id=prev_prediction.prediction_id,
                previous_prediction_revision=prev_prediction.revision,
                previous_predicted_grade=prev_grade,
            )

    # 6. Compute exact earned-point deltas between prev_features and curr_features.
    observed_deltas = {
        "ww": round(float(curr_features["ww_points_earned_so_far"]) - float(prev_features["ww_points_earned_so_far"]), 4),
        "pt": round(float(curr_features["pt_points_earned_so_far"]) - float(prev_features["pt_points_earned_so_far"]), 4),
        "qa": round(float(curr_features["qa_points_earned_so_far"]) - float(prev_features["qa_points_earned_so_far"]), 4),
    }

    # If any component decreased or total earned did not strictly increase, cannot claim pure remediation gain.
    if any(delta < -FEATURE_DELTA_TOLERANCE for delta in observed_deltas.values()) or sum(observed_deltas.values()) <= FEATURE_DELTA_TOLERANCE:
        return ResolutionAttributionResult(
            should_auto_resolve=False,
            attribution_code="UNCERTAIN_NON_POSITIVE_COMPONENT_DELTA",
            reason_summary="Earned score changes did not show a clear net improvement from remediation alone; teacher review required.",
            previous_prediction_id=prev_prediction.prediction_id,
            previous_prediction_revision=prev_prediction.revision,
            previous_predicted_grade=prev_grade,
        )

    # 7. Compute exact expected earned-point deltas contributed ONLY by THIS intervention's graded remediations.
    asgn_ids = [asgn.classwork_assignment_id for asgn, _cw, _sub, _u in curr_rows]
    all_links: list[RemediationAssignmentLink] = []
    if asgn_ids:
        all_links = (
            db.query(RemediationAssignmentLink)
            .filter(
                RemediationAssignmentLink.student_id == intervention.student_id,
                (
                    RemediationAssignmentLink.original_assignment_id.in_(asgn_ids)
                    | RemediationAssignmentLink.remediation_assignment_id.in_(asgn_ids)
                ),
            )
            .all()
        )
    prev_links = [
        link for link in all_links
        if link.created_at is None or _as_utc(link.created_at) <= prev_cutoff
    ]
    curr_links = [
        link for link in all_links
        if link.created_at is None or _as_utc(link.created_at) <= curr_cutoff
    ]

    prev_resolved_cw = resolve_student_classwork_scores(
        student_id=intervention.student_id,
        assignments=[asgn for asgn, _cw, _sub, _u in prev_rows],
        submissions={asgn.classwork_assignment_id: sub for asgn, _cw, sub, _u in prev_rows if sub is not None},
        links=prev_links,
    )
    curr_resolved_cw = resolve_student_classwork_scores(
        student_id=intervention.student_id,
        assignments=[asgn for asgn, _cw, _sub, _u in curr_rows],
        submissions={asgn.classwork_assignment_id: sub for asgn, _cw, sub, _u in curr_rows if sub is not None},
        links=curr_links,
    )

    expected_deltas = {"ww": 0.0, "pt": 0.0, "qa": 0.0}
    max_inplace_deltas = {"ww": 0.0, "pt": 0.0, "qa": 0.0}
    contributing_remediation_ids: list[int] = []
    this_intervention_ww_pt_orig_ids: set[int] = set()

    for orig_id, curr_audit in curr_resolved_cw.audits_by_original_id.items():
        if curr_audit.source_intervention_id != intervention.intervention_id:
            continue
        this_intervention_ww_pt_orig_ids.add(orig_id)
        if not curr_audit.is_completed or curr_audit.effective_score is None or curr_audit.original_raw_score is None:
            continue
        comp_key = "ww" if curr_audit.component == "WRITTEN_WORK" else "pt" if curr_audit.component == "PERFORMANCE_TASK" else None
        if comp_key is None:
            continue

        prev_eff = prev_resolved_cw.effective_scores_float.get(orig_id)
        if prev_eff is None:
            prev_eff = float(curr_audit.original_raw_score)
        curr_eff = float(curr_audit.effective_score)
        gain = round(curr_eff - prev_eff, 4)
        total_gain_over_orig = round(curr_eff - float(curr_audit.original_raw_score), 4)
        if gain > FEATURE_DELTA_TOLERANCE:
            expected_deltas[comp_key] = round(expected_deltas[comp_key] + gain, 4)
            contributing_remediation_ids.append(curr_audit.remediation_assignment_id)
        if total_gain_over_orig > FEATURE_DELTA_TOLERANCE:
            max_inplace_deltas[comp_key] = round(max_inplace_deltas[comp_key] + total_gain_over_orig, 4)

    # Check remedial exams for THIS intervention
    curr_exam_rows = [
        (asgn, cw, sub, unres) for asgn, cw, sub, unres in curr_rows
        if getattr(cw, "classwork_category", None) == "EXAMS"
        or getattr(cw, "exam_subtype", None) is not None
        or getattr(asgn, "original_exam_assignment_id", None) is not None
    ]
    prev_exam_rows = [
        (asgn, cw, sub, unres) for asgn, cw, sub, unres in prev_rows
        if getattr(cw, "classwork_category", None) == "EXAMS"
        or getattr(cw, "exam_subtype", None) is not None
        or getattr(asgn, "original_exam_assignment_id", None) is not None
    ]
    if curr_exam_rows:
        prev_exam_scores = {
            asgn.classwork_assignment_id: _to_float(sub.grade) if sub and sub.grade is not None else None
            for asgn, _cw, sub, _u in prev_exam_rows
            if asgn.recipient_student_id in (None, intervention.student_id)
        }
        curr_exam_scores = {
            asgn.classwork_assignment_id: _to_float(sub.grade) if sub and sub.grade is not None else None
            for asgn, _cw, sub, _u in curr_exam_rows
            if asgn.recipient_student_id in (None, intervention.student_id)
        }
        prev_eff_exams = effective_exam_scores([a for a, _cw, _s, _u in prev_exam_rows], prev_exam_scores)
        # Apply ONLY this intervention's current remedial exam scores on top of prev_exam_scores
        only_this_remedial_exam_scores = dict(prev_exam_scores)
        remedial_exam_ids_increased: list[int] = []
        for asgn, _cw, sub, _u in curr_exam_rows:
            if (
                asgn.original_exam_assignment_id is not None
                and asgn.source_intervention_id == intervention.intervention_id
                and asgn.recipient_student_id == intervention.student_id
                and sub is not None
                and sub.grade is not None
            ):
                only_this_remedial_exam_scores[asgn.classwork_assignment_id] = _to_float(sub.grade)
                orig_eff_before = prev_eff_exams.get(asgn.original_exam_assignment_id)
                if orig_eff_before is None or float(sub.grade) > orig_eff_before + FEATURE_DELTA_TOLERANCE:
                    remedial_exam_ids_increased.append(asgn.classwork_assignment_id)

        curr_eff_exams_this_only = effective_exam_scores(
            [a for a, _cw, _s, _u in curr_exam_rows],
            only_this_remedial_exam_scores,
        )
        curr_eff_exams_all = effective_exam_scores(
            [a for a, _cw, _s, _u in curr_exam_rows],
            curr_exam_scores,
        )
        if curr_eff_exams_this_only == curr_eff_exams_all and remedial_exam_ids_increased:
            prev_qa_earned, _ = _compute_qa_earned_from_exam_rows(prev_exam_rows, intervention.student_id, prev_eff_exams)
            curr_qa_earned, _ = _compute_qa_earned_from_exam_rows(curr_exam_rows, intervention.student_id, curr_eff_exams_this_only)
            qa_gain = round(curr_qa_earned - prev_qa_earned, 4)
            if qa_gain > FEATURE_DELTA_TOLERANCE:
                expected_deltas["qa"] = qa_gain
                contributing_remediation_ids.extend(remedial_exam_ids_increased)
                max_inplace_deltas["qa"] = max(max_inplace_deltas["qa"], qa_gain)

    if not contributing_remediation_ids:
        return ResolutionAttributionResult(
            should_auto_resolve=False,
            attribution_code="REGULAR_CLASSWORK_OR_NO_REMEDIATION_GAIN",
            reason_summary="No graded remediation activity for this intervention produced an effective score gain since the prior prediction; teacher confirmation is required.",
            previous_prediction_id=prev_prediction.prediction_id,
            previous_prediction_revision=prev_prediction.revision,
            previous_predicted_grade=prev_grade,
        )

    # 8. Exact per-component reconciliation between observed feature deltas and remediation deltas.
    exact_match = all(
        abs(observed_deltas[comp] - expected_deltas[comp]) <= FEATURE_DELTA_TOLERANCE
        for comp in ("ww", "pt", "qa")
    )

    # Special verified case: single-row in-place remediation regrade (e.g. ActivityService bulk score update)
    # where the exact triggering assignment is confirmed to be THIS intervention's graded remediation,
    # no regular assignment changed after prev_cutoff, and only that remediation's component improved
    # within its verified total gain over original score.
    verified_inplace_regrade = False
    if not exact_match and trigger_is_this_intervention_remediation and trigger_assignment_id in contributing_remediation_ids:
        verified_inplace_regrade = all(
            (
                observed_deltas[comp] >= -FEATURE_DELTA_TOLERANCE
                and observed_deltas[comp] <= max_inplace_deltas[comp] + FEATURE_DELTA_TOLERANCE
                and (max_inplace_deltas[comp] > FEATURE_DELTA_TOLERANCE or abs(observed_deltas[comp]) <= FEATURE_DELTA_TOLERANCE)
            )
            for comp in ("ww", "pt", "qa")
        )

    if not exact_match and not verified_inplace_regrade:
        return ResolutionAttributionResult(
            should_auto_resolve=False,
            attribution_code="MIXED_OR_UNCERTAIN_ATTRIBUTION",
            reason_summary="Score changes could not be attributed solely to this intervention's graded remediation; teacher confirmation is required.",
            previous_prediction_id=prev_prediction.prediction_id,
            previous_prediction_revision=prev_prediction.revision,
            previous_predicted_grade=prev_grade,
            remediation_assignment_ids=tuple(sorted(set(contributing_remediation_ids))),
            remediation_component_deltas=observed_deltas,
        )

    return ResolutionAttributionResult(
        should_auto_resolve=True,
        attribution_code="VERIFIED_GRADED_REMEDIATION",
        reason_summary="Verified graded remediation score improvement raised the latest valid prediction to the passing target.",
        previous_prediction_id=prev_prediction.prediction_id,
        previous_prediction_revision=prev_prediction.revision,
        previous_predicted_grade=prev_grade,
        remediation_assignment_ids=tuple(sorted(set(contributing_remediation_ids))),
        remediation_component_deltas=observed_deltas,
    )

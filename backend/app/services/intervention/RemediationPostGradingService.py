"""Shared read-only evaluator for actual post-remediation predicted term grades.

Calculates the remediation-adjusted predicted subject term grade from committed
academic evidence (never hypothetical maximum-score previews) by combining:
  - The persisted DevelopmentCurrentTermPrediction's raw RF output (kept unchanged).
  - The intervention's saved predicted_grade_ceiling (0-85, via RemediationGradeCeiling).
  - The unremediated baseline reconstructed at the prediction's exact model version
    and generation_cutoff_at using exclude_intervention_id.

Fails explicitly with status="UNAVAILABLE" whenever model version, generation cutoff,
historical evidence consistency, or the unremediated baseline cannot be verified.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

from sqlalchemy.orm import Session

from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.intervention.Intervention import Intervention
from app.services.grading.RemediationGradeCeiling import (
    apply_remediation_grade_ceiling,
    validate_predicted_grade,
    validate_predicted_grade_ceiling,
)
from app.services.prediction.DevelopmentCurrentTermPredictionService import (
    STATUS_DEVELOPMENT_PREDICTION_AVAILABLE,
    prepare_development_current_term,
    score_prepared_development_current_term,
)

STATUS_AVAILABLE: Literal["AVAILABLE"] = "AVAILABLE"
STATUS_UNAVAILABLE: Literal["UNAVAILABLE"] = "UNAVAILABLE"


@dataclass(frozen=True)
class ActualRemediationPredictionEvaluation:
    """Structured result separating raw RF output from the remediation-adjusted grade."""

    status: Literal["AVAILABLE", "UNAVAILABLE"]
    raw_predicted_grade: float | None
    remediation_adjusted_predicted_grade: float | None
    unremediated_baseline_grade: float | None
    selected_grade_ceiling: float | None
    effective_grade_ceiling: float | None
    was_ceiling_applied: bool
    is_legacy_uncapped: bool
    model_version_id: int | None
    model_name: str | None
    generation_cutoff_at: str | None
    unavailable_reason_codes: tuple[str, ...] = ()
    unavailable_message: str | None = None

    def to_resolution_snapshot(self, prediction_id: int) -> dict[str, Any]:
        """Serialize an AVAILABLE ceiling evaluation for immutable resolution history."""
        if self.status != STATUS_AVAILABLE:
            raise ValueError("Cannot build a resolution snapshot from an UNAVAILABLE evaluation.")
        return {
            "prediction_id": prediction_id,
            "model_version_id": self.model_version_id,
            "model_name": self.model_name,
            "generation_cutoff_at": self.generation_cutoff_at,
            "raw_predicted_grade": self.raw_predicted_grade,
            "unremediated_baseline_grade": self.unremediated_baseline_grade,
            "selected_grade_ceiling": self.selected_grade_ceiling,
            "effective_grade_ceiling": self.effective_grade_ceiling,
            "remediation_adjusted_predicted_grade": self.remediation_adjusted_predicted_grade,
            "was_ceiling_applied": self.was_ceiling_applied,
        }


def _unavailable(
    *,
    reason_codes: list[str] | tuple[str, ...],
    message: str,
    raw_predicted_grade: float | None = None,
    selected_grade_ceiling: float | None = None,
    model_version_id: int | None = None,
    model_name: str | None = None,
    generation_cutoff_at: str | None = None,
) -> ActualRemediationPredictionEvaluation:
    deduped = tuple(dict.fromkeys(reason_codes))
    return ActualRemediationPredictionEvaluation(
        status=STATUS_UNAVAILABLE,
        raw_predicted_grade=raw_predicted_grade,
        remediation_adjusted_predicted_grade=None,
        unremediated_baseline_grade=None,
        selected_grade_ceiling=selected_grade_ceiling,
        effective_grade_ceiling=None,
        was_ceiling_applied=False,
        is_legacy_uncapped=False,
        model_version_id=model_version_id,
        model_name=model_name,
        generation_cutoff_at=generation_cutoff_at,
        unavailable_reason_codes=deduped,
        unavailable_message=message,
    )


def _parse_cutoff(raw_cutoff: object) -> tuple[datetime | None, str | None]:
    if not isinstance(raw_cutoff, str) or not raw_cutoff.strip():
        return None, None
    text = raw_cutoff.strip()
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None, text
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed, text


def _saved_features_map(snapshot: dict[str, Any]) -> dict[str, Any] | None:
    raw_features = snapshot.get("model_features")
    if not isinstance(raw_features, list) or not raw_features:
        return None
    mapping: dict[str, Any] = {}
    for item in raw_features:
        if not isinstance(item, dict) or "name" not in item:
            return None
        mapping[str(item["name"])] = item.get("value")
    return mapping


def _try_frozen_resolution_snapshot(
    intervention: Intervention,
    prediction: DevelopmentCurrentTermPrediction,
    raw_grade_float: float,
    selected_ceiling_float: float,
    model_version_id: int,
    model_name: str | None,
    cutoff_text: str | None,
) -> ActualRemediationPredictionEvaluation | None:
    if intervention.status != "RESOLVED":
        return None
    plan = intervention.remediation_plan if isinstance(intervention.remediation_plan, dict) else {}
    frozen = plan.get("resolution_ceiling_snapshot")
    if not isinstance(frozen, dict):
        return None
    if (
        frozen.get("prediction_id") != prediction.prediction_id
        or frozen.get("model_version_id") != model_version_id
    ):
        return None
    try:
        capped = float(validate_predicted_grade(frozen.get("remediation_adjusted_predicted_grade")))
        baseline = float(validate_predicted_grade(frozen.get("unremediated_baseline_grade")))
        effective_ceil = float(validate_predicted_grade(frozen.get("effective_grade_ceiling")))
    except (TypeError, ValueError):
        return None
    return ActualRemediationPredictionEvaluation(
        status=STATUS_AVAILABLE,
        raw_predicted_grade=raw_grade_float,
        remediation_adjusted_predicted_grade=capped,
        unremediated_baseline_grade=baseline,
        selected_grade_ceiling=selected_ceiling_float,
        effective_grade_ceiling=effective_ceil,
        was_ceiling_applied=bool(frozen.get("was_ceiling_applied", False)),
        is_legacy_uncapped=False,
        model_version_id=model_version_id,
        model_name=frozen.get("model_name") or model_name,
        generation_cutoff_at=frozen.get("generation_cutoff_at") or cutoff_text,
    )


def evaluate_actual_remediation_prediction(
    db: Session,
    intervention: Intervention,
    prediction: DevelopmentCurrentTermPrediction,
) -> ActualRemediationPredictionEvaluation:
    """Evaluate the actual post-grading remediation-adjusted prediction without DB writes.

    Guarantees:
      - Never mutates `prediction` or any database row.
      - Never uses hypothetical maximum-score overrides; uses committed scores at the
        persisted prediction's exact `generation_cutoff_at` and `model_version_id`.
      - Applies `predicted_grade_ceiling` only to improvements attributable to
        `intervention.intervention_id`; legitimate regular assessments can exceed 85.
      - Passes legacy plans (without `predicted_grade_ceiling`), `CANDIDATE` rows, and
        `PRACTICE_ONLY` plans through uncapped.
      - Fails explicitly (`status="UNAVAILABLE"`) if model version, cutoff, historical
        evidence consistency, or unremediated baseline cannot be verified.
    """
    with db.no_autoflush:
        if (
            prediction.student_id != intervention.student_id
            or prediction.class_id != intervention.class_id
            or prediction.subject_id != intervention.subject_id
            or prediction.source_period_id != intervention.academic_period_id
            or prediction.target_period_id != intervention.academic_period_id
        ):
            return _unavailable(
                reason_codes=["PREDICTION_SCOPE_MISMATCH"],
                message="The persisted prediction does not match the intervention scope.",
                model_version_id=prediction.model_version_id,
            )

        snapshot = prediction.evidence_snapshot if isinstance(prediction.evidence_snapshot, dict) else {}
        readiness = snapshot.get("readiness")
        cutoff_raw = snapshot.get("generation_cutoff_at")
        cutoff_dt, cutoff_text = _parse_cutoff(cutoff_raw)

        if not isinstance(readiness, dict) or readiness.get("status") != "READY":
            return _unavailable(
                reason_codes=["PREDICTION_NOT_READY"],
                message="The persisted prediction is not in READY status.",
                model_version_id=prediction.model_version_id,
                generation_cutoff_at=cutoff_text,
            )

        raw_grade_obj = snapshot.get("projected_final_term_grade_raw")
        try:
            raw_grade_dec = validate_predicted_grade(raw_grade_obj, param_name="raw_prediction")
        except (TypeError, ValueError):
            return _unavailable(
                reason_codes=["INVALID_RAW_PREDICTION"],
                message="The persisted prediction is missing a valid raw projected grade.",
                model_version_id=prediction.model_version_id,
                generation_cutoff_at=cutoff_text,
            )
        raw_grade_float = float(raw_grade_dec)

        plan = intervention.remediation_plan if isinstance(intervention.remediation_plan, dict) else {}
        grade_treatment = plan.get("grade_treatment")
        raw_ceiling = plan.get("predicted_grade_ceiling")

        # Legacy plans (no predicted_grade_ceiling), CANDIDATE rows, and PRACTICE_ONLY plans
        # do not have an active remediation grade ceiling.
        if (
            intervention.status == "CANDIDATE"
            or grade_treatment == "PRACTICE_ONLY"
            or raw_ceiling is None
        ):
            model_version = db.get(AIModelVersion, prediction.model_version_id)
            return ActualRemediationPredictionEvaluation(
                status=STATUS_AVAILABLE,
                raw_predicted_grade=raw_grade_float,
                remediation_adjusted_predicted_grade=raw_grade_float,
                unremediated_baseline_grade=None,
                selected_grade_ceiling=None,
                effective_grade_ceiling=None,
                was_ceiling_applied=False,
                is_legacy_uncapped=True,
                model_version_id=prediction.model_version_id,
                model_name=model_version.model_name if model_version is not None else None,
                generation_cutoff_at=cutoff_text,
            )

        try:
            selected_ceiling_dec = validate_predicted_grade_ceiling(raw_ceiling)
        except (TypeError, ValueError) as err:
            return _unavailable(
                reason_codes=["INVALID_PREDICTED_GRADE_CEILING"],
                message=f"Invalid saved predicted_grade_ceiling: {err}",
                raw_predicted_grade=raw_grade_float,
                model_version_id=prediction.model_version_id,
                generation_cutoff_at=cutoff_text,
            )
        selected_ceiling_float = float(selected_ceiling_dec)

        model_version = db.get(AIModelVersion, prediction.model_version_id)
        if model_version is None or not model_version.model_name:
            return _unavailable(
                reason_codes=["MODEL_VERSION_UNAVAILABLE"],
                message="The persisted prediction's AI model version is unavailable.",
                raw_predicted_grade=raw_grade_float,
                selected_grade_ceiling=selected_ceiling_float,
                model_version_id=prediction.model_version_id,
                generation_cutoff_at=cutoff_text,
            )

        frozen = _try_frozen_resolution_snapshot(
            intervention,
            prediction,
            raw_grade_float,
            selected_ceiling_float,
            model_version.model_version_id,
            model_version.model_name,
            cutoff_text,
        )
        if frozen is not None:
            return frozen

        # Verify model version & registry metadata consistency against the persisted snapshot
        snap_model_version_id = snapshot.get("model_version_id")
        if snap_model_version_id is not None and snap_model_version_id != model_version.model_version_id:
            return _unavailable(
                reason_codes=["MODEL_VERSION_MISMATCH"],
                message="Persisted prediction snapshot model_version_id does not match the model version record.",
                raw_predicted_grade=raw_grade_float,
                selected_grade_ceiling=selected_ceiling_float,
                model_version_id=model_version.model_version_id,
                model_name=model_version.model_name,
                generation_cutoff_at=cutoff_text,
            )

        registry_meta = model_version.registry_metadata_json if isinstance(model_version.registry_metadata_json, dict) else {}
        if (
            snapshot.get("feature_schema_sha256")
            and registry_meta.get("feature_schema_sha256")
            and snapshot["feature_schema_sha256"] != registry_meta["feature_schema_sha256"]
        ):
            return _unavailable(
                reason_codes=["MODEL_VERSION_SCHEMA_MISMATCH"],
                message="Model feature schema hash no longer matches the persisted prediction snapshot.",
                raw_predicted_grade=raw_grade_float,
                selected_grade_ceiling=selected_ceiling_float,
                model_version_id=model_version.model_version_id,
                model_name=model_version.model_name,
                generation_cutoff_at=cutoff_text,
            )
        if (
            snapshot.get("artifact_sha256")
            and registry_meta.get("artifact_sha256")
            and snapshot["artifact_sha256"] != registry_meta["artifact_sha256"]
        ):
            return _unavailable(
                reason_codes=["MODEL_VERSION_ARTIFACT_MISMATCH"],
                message="Model artifact hash no longer matches the persisted prediction snapshot.",
                raw_predicted_grade=raw_grade_float,
                selected_grade_ceiling=selected_ceiling_float,
                model_version_id=model_version.model_version_id,
                model_name=model_version.model_name,
                generation_cutoff_at=cutoff_text,
            )

        # Require an explicit valid generation_cutoff_at so future assessments cannot leak backward
        if cutoff_dt is None:
            code = "GENERATION_CUTOFF_MISSING" if cutoff_raw is None else "GENERATION_CUTOFF_INVALID"
            return _unavailable(
                reason_codes=[code],
                message="Persisted prediction is missing a valid generation_cutoff_at for historical baseline reconstruction.",
                raw_predicted_grade=raw_grade_float,
                selected_grade_ceiling=selected_ceiling_float,
                model_version_id=model_version.model_version_id,
                model_name=model_version.model_name,
                generation_cutoff_at=cutoff_text,
            )

        scope_kwargs = {
            "student_id": intervention.student_id,
            "class_id": intervention.class_id,
            "subject_id": intervention.subject_id,
            "source_period_id": intervention.academic_period_id,
            "target_period_id": intervention.academic_period_id,
            "cutoff_at": cutoff_dt,
            "model_name": model_version.model_name,
        }

        # Verify committed evidence at cutoff_at still reproduces the persisted prediction's
        # 31-feature vector when model_features is recorded in the snapshot.
        saved_features = _saved_features_map(snapshot)
        if saved_features is not None:
            try:
                rebuilt_pred, prepared_rebuilt = prepare_development_current_term(
                    db,
                    **scope_kwargs,
                )
            except Exception:
                return _unavailable(
                    reason_codes=["HISTORICAL_EVIDENCE_UNAVAILABLE"],
                    message="Could not reconstruct committed features at the prediction cutoff.",
                    raw_predicted_grade=raw_grade_float,
                    selected_grade_ceiling=selected_ceiling_float,
                    model_version_id=model_version.model_version_id,
                    model_name=model_version.model_name,
                    generation_cutoff_at=cutoff_text,
                )
            if (
                rebuilt_pred["status"] != STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
                or prepared_rebuilt is None
            ):
                codes = ["HISTORICAL_EVIDENCE_UNAVAILABLE"] + (
                    list(rebuilt_pred.get("readiness_reason_codes") or []) or [rebuilt_pred["status"]]
                )
                return _unavailable(
                    reason_codes=codes,
                    message="Committed evidence at the prediction cutoff is no longer ready for baseline reconstruction.",
                    raw_predicted_grade=raw_grade_float,
                    selected_grade_ceiling=selected_ceiling_float,
                    model_version_id=model_version.model_version_id,
                    model_name=model_version.model_name,
                    generation_cutoff_at=cutoff_text,
                )
            if prepared_rebuilt["features"] != saved_features:
                return _unavailable(
                    reason_codes=["HISTORICAL_EVIDENCE_DRIFT"],
                    message="Committed academic evidence at the prediction cutoff no longer matches the persisted prediction snapshot.",
                    raw_predicted_grade=raw_grade_float,
                    selected_grade_ceiling=selected_ceiling_float,
                    model_version_id=model_version.model_version_id,
                    model_name=model_version.model_name,
                    generation_cutoff_at=cutoff_text,
                )

        # Reconstruct the unremediated baseline excluding ONLY this intervention's remediation
        try:
            unremediated_pred, prepared_unremediated = prepare_development_current_term(
                db,
                **scope_kwargs,
                exclude_intervention_id=intervention.intervention_id,
            )
        except Exception:
            return _unavailable(
                reason_codes=["UNREMEDIATED_BASELINE_UNAVAILABLE"],
                message="Could not prepare the unremediated baseline for this intervention.",
                raw_predicted_grade=raw_grade_float,
                selected_grade_ceiling=selected_ceiling_float,
                model_version_id=model_version.model_version_id,
                model_name=model_version.model_name,
                generation_cutoff_at=cutoff_text,
            )

        if (
            unremediated_pred["status"] != STATUS_DEVELOPMENT_PREDICTION_AVAILABLE
            or prepared_unremediated is None
        ):
            codes = ["UNREMEDIATED_BASELINE_UNAVAILABLE"] + (
                list(unremediated_pred.get("readiness_reason_codes") or []) or [unremediated_pred["status"]]
            )
            return _unavailable(
                reason_codes=codes,
                message="The unremediated baseline prediction is unavailable for this intervention.",
                raw_predicted_grade=raw_grade_float,
                selected_grade_ceiling=selected_ceiling_float,
                model_version_id=model_version.model_version_id,
                model_name=model_version.model_name,
                generation_cutoff_at=cutoff_text,
            )

        if saved_features is not None and prepared_unremediated["features"] == saved_features:
            # No remediation from this intervention changed the 31-feature vector ->
            # unremediated baseline is identically the persisted raw prediction.
            unremediated_baseline_grade = raw_grade_float
        else:
            try:
                scored_unremediated = score_prepared_development_current_term(
                    unremediated_pred,
                    prepared_unremediated,
                )
            except Exception:
                return _unavailable(
                    reason_codes=["UNREMEDIATED_BASELINE_UNAVAILABLE"],
                    message="Could not score the unremediated baseline with the prediction's model version.",
                    raw_predicted_grade=raw_grade_float,
                    selected_grade_ceiling=selected_ceiling_float,
                    model_version_id=model_version.model_version_id,
                    model_name=model_version.model_name,
                    generation_cutoff_at=cutoff_text,
                )
            unremediated_baseline_grade = float(scored_unremediated["projected_final_term_grade"])

        try:
            policy = apply_remediation_grade_ceiling(
                raw_prediction=raw_grade_dec,
                unremediated_baseline=unremediated_baseline_grade,
                selected_ceiling=selected_ceiling_dec,
            )
        except (TypeError, ValueError) as err:
            return _unavailable(
                reason_codes=["UNREMEDIATED_BASELINE_UNAVAILABLE"],
                message=f"Could not apply remediation grade ceiling policy: {err}",
                raw_predicted_grade=raw_grade_float,
                selected_grade_ceiling=selected_ceiling_float,
                model_version_id=model_version.model_version_id,
                model_name=model_version.model_name,
                generation_cutoff_at=cutoff_text,
            )

        return ActualRemediationPredictionEvaluation(
            status=STATUS_AVAILABLE,
            raw_predicted_grade=float(policy.raw_predicted_grade),
            remediation_adjusted_predicted_grade=float(policy.capped_projection),
            unremediated_baseline_grade=float(policy.unremediated_baseline),
            selected_grade_ceiling=float(policy.selected_ceiling),
            effective_grade_ceiling=float(policy.effective_ceiling),
            was_ceiling_applied=policy.was_ceiling_applied,
            is_legacy_uncapped=False,
            model_version_id=model_version.model_version_id,
            model_name=model_version.model_name,
            generation_cutoff_at=cutoff_text,
        )

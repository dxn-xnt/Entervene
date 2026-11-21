"""Pure backend policy helper for remediation-adjusted predicted subject term grades.

This module governs the teacher-selectable predicted term grade ceiling (maximum 85),
which is intentionally separate from:
  - Raw Random Forest predictions (preserved unchanged for auditability and accuracy).
  - Per-classwork percentage caps in RemediationScoreAdjuster (score_adjustment_cap).
  - Official DepEd gradebook calculations.

Policy formula:
    effective_ceiling = max(selected_ceiling, unremediated_baseline)
    capped_projection = min(raw_prediction, effective_ceiling)
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import math

# Matches the verified valid prediction grade range [0, 100] enforced by
# DevelopmentCurrentTermRiskService (L102), InterventionCandidateService (L83),
# TeacherInterventionService (L98), and PassingThresholdResolver (L66).
MIN_PREDICTED_GRADE = Decimal("0")
MAX_PREDICTED_GRADE = Decimal("100")

MIN_PREDICTED_GRADE_CEILING = MIN_PREDICTED_GRADE
MAX_PREDICTED_GRADE_CEILING = Decimal("85")
DEFAULT_PREDICTED_GRADE_CEILING = Decimal("85")


def to_decimal(value: object, *, param_name: str = "value") -> Decimal:
    """Convert a numeric or numeric-string value to a finite Decimal without invented rounding."""
    if isinstance(value, bool):
        raise TypeError(f"{param_name} cannot be a boolean")
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError(f"{param_name} must be a finite Decimal")
        return value
    if isinstance(value, (int, str)):
        raw = str(value).strip()
        if not raw:
            raise ValueError(f"Invalid decimal value for {param_name}: {value!r}")
        try:
            parsed = Decimal(raw)
        except (InvalidOperation, ValueError) as err:
            raise ValueError(f"Invalid decimal value for {param_name}: {value!r}") from err
        if not parsed.is_finite():
            raise ValueError(f"{param_name} must be finite")
        return parsed
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"{param_name} must be finite")
        return Decimal(str(value))
    raise TypeError(f"Unsupported type for {param_name}: {type(value).__name__}")


def validate_predicted_grade(grade: object, *, param_name: str = "predicted_grade") -> Decimal:
    """Validate that a predicted subject term grade is a finite Decimal within [0, 100]."""
    value = to_decimal(grade, param_name=param_name)
    if value < MIN_PREDICTED_GRADE or value > MAX_PREDICTED_GRADE:
        raise ValueError(
            f"{param_name} must be between {MIN_PREDICTED_GRADE} and {MAX_PREDICTED_GRADE} (got {value})"
        )
    return value


def validate_predicted_grade_ceiling(ceiling: object) -> Decimal:
    """Validate that the teacher-selectable predicted-grade ceiling is within [0, 85]."""
    value = to_decimal(ceiling, param_name="selected_ceiling")
    if value < MIN_PREDICTED_GRADE_CEILING or value > MAX_PREDICTED_GRADE_CEILING:
        raise ValueError(
            f"selected_ceiling must be between {MIN_PREDICTED_GRADE_CEILING} and "
            f"{MAX_PREDICTED_GRADE_CEILING} (got {value})"
        )
    return value


def resolve_default_predicted_grade_ceiling(selected_ceiling: object | None = None) -> Decimal:
    """Resolve the ceiling for a new graded plan, defaulting to 85 when omitted."""
    if selected_ceiling is None:
        return DEFAULT_PREDICTED_GRADE_CEILING
    return validate_predicted_grade_ceiling(selected_ceiling)


@dataclass(frozen=True)
class RemediationGradeCeilingResult:
    """Structured result distinguishing the raw RF prediction from the policy-capped projection."""

    raw_predicted_grade: Decimal
    unremediated_baseline: Decimal | None
    selected_ceiling: Decimal
    effective_ceiling: Decimal
    capped_projection: Decimal
    was_ceiling_applied: bool
    raw_gain_from_baseline: Decimal | None
    capped_gain_from_baseline: Decimal | None


def apply_remediation_grade_ceiling(
    raw_prediction: object,
    *,
    unremediated_baseline: object | None = None,
    selected_ceiling: object = DEFAULT_PREDICTED_GRADE_CEILING,
) -> RemediationGradeCeilingResult:
    """Apply the remediation predicted-term-grade ceiling policy without altering raw RF output.

    Implements:
        effective_ceiling = max(selected_ceiling, unremediated_baseline)
        capped_projection = min(raw_prediction, effective_ceiling)

    Guarantees:
        - Preserves raw_prediction unchanged in raw_predicted_grade.
        - Uses exact Decimal arithmetic without invented rounding.
        - Never lowers a student's legitimate unremediated baseline prediction.
        - Never inflates a non-monotonic RF dip upward to the ceiling.
    """
    raw_dec = validate_predicted_grade(raw_prediction, param_name="raw_prediction")
    ceiling_dec = validate_predicted_grade_ceiling(selected_ceiling)
    baseline_dec = (
        validate_predicted_grade(unremediated_baseline, param_name="unremediated_baseline")
        if unremediated_baseline is not None
        else None
    )

    effective_ceiling = max(ceiling_dec, baseline_dec) if baseline_dec is not None else ceiling_dec
    capped_projection = min(raw_dec, effective_ceiling)
    was_ceiling_applied = raw_dec > effective_ceiling

    raw_gain = (raw_dec - baseline_dec) if baseline_dec is not None else None
    capped_gain = (capped_projection - baseline_dec) if baseline_dec is not None else None

    return RemediationGradeCeilingResult(
        raw_predicted_grade=raw_dec,
        unremediated_baseline=baseline_dec,
        selected_ceiling=ceiling_dec,
        effective_ceiling=effective_ceiling,
        capped_projection=capped_projection,
        was_ceiling_applied=was_ceiling_applied,
        raw_gain_from_baseline=raw_gain,
        capped_gain_from_baseline=capped_gain,
    )

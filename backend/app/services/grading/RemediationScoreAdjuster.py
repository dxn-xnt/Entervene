"""Pure backend calculator for adjusting an existing classwork's effective score.

Remediation adjusts an existing classwork score rather than creating an additional
official graded entry in the gradebook. Raw submissions and scores remain preserved
in database history.

Formula:
    effective = max(original, min(remediation, max_points * cap_percentage / 100))
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import math
from typing import Any

DEFAULT_REMEDIATION_CAP_PERCENTAGE = Decimal("75")


def to_decimal(value: object, *, param_name: str = "value") -> Decimal:
    """Convert a numeric or string value to a finite Decimal without invented rounding."""
    if isinstance(value, bool):
        raise TypeError(f"{param_name} cannot be a boolean")
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError(f"{param_name} must be a finite Decimal")
        return value
    if isinstance(value, (int, str)):
        try:
            val = Decimal(str(value).strip())
            if not val.is_finite():
                raise ValueError(f"{param_name} must be finite")
            return val
        except (InvalidOperation, ValueError) as err:
            raise ValueError(f"Invalid decimal value for {param_name}: {value!r}") from err
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"{param_name} must be finite")
        return Decimal(str(value))
    raise TypeError(f"Unsupported type for {param_name}: {type(value).__name__}")


def validate_cap_percentage(cap: object) -> Decimal:
    """Validate that the score adjustment cap percentage is between 0 and 100 (excluding 100% full replacement)."""
    percentage = to_decimal(cap, param_name="cap_percentage")
    if percentage < Decimal("0") or percentage >= Decimal("100"):
        raise ValueError(
            f"cap_percentage must be between 0 and 100, excluding 100% full replacement (got {percentage})"
        )
    return percentage


@dataclass(frozen=True)
class RemediationScoreAdjustment:
    """Structured result of a remediation score adjustment calculation."""

    original_score: Decimal
    remediation_score: Decimal
    max_points: Decimal
    cap_percentage: Decimal
    cap_score: Decimal
    effective_score: Decimal
    was_adjusted: bool
    was_capped: bool


def _resolve_and_validate_max_points(
    max_points: object | None,
    original_max_points: object | None,
    remediation_max_points: object | None,
) -> Decimal:
    """Resolve and enforce matching maximum points for Task 4.1."""
    orig_max_dec = (
        to_decimal(original_max_points, param_name="original_max_points")
        if original_max_points is not None
        else None
    )
    rem_max_dec = (
        to_decimal(remediation_max_points, param_name="remediation_max_points")
        if remediation_max_points is not None
        else None
    )

    if orig_max_dec is not None and rem_max_dec is not None:
        if orig_max_dec != rem_max_dec:
            raise ValueError(
                f"Matching original and remediation maximum points required in Task 4.1 "
                f"(got original={orig_max_dec}, remediation={rem_max_dec})"
            )
        resolved = orig_max_dec
    elif orig_max_dec is not None:
        resolved = orig_max_dec
    elif rem_max_dec is not None:
        resolved = rem_max_dec
    elif max_points is not None:
        resolved = to_decimal(max_points, param_name="max_points")
    else:
        raise ValueError("max_points must be provided")

    if max_points is not None:
        mp_dec = to_decimal(max_points, param_name="max_points")
        if mp_dec != resolved:
            raise ValueError(
                f"Conflicting max_points provided: max_points={mp_dec} vs resolved={resolved}"
            )

    if resolved <= Decimal("0"):
        raise ValueError(f"max_points must be strictly positive (got {resolved})")

    return resolved


def adjust_remediation_score(
    original_score: object,
    remediation_score: object,
    max_points: object | None = None,
    *,
    cap_percentage: object = DEFAULT_REMEDIATION_CAP_PERCENTAGE,
    original_max_points: object | None = None,
    remediation_max_points: object | None = None,
) -> RemediationScoreAdjustment:
    """Calculate the effective score for an existing classwork following remediation.

    Implements:
        effective = max(original, min(remediation, max_points * cap_percentage / 100))

    Guarantees:
        - Uses Decimal precision without invented rounding.
        - Never reduces the original score: effective >= original.
        - Raw original and remediation scores are preserved unchanged.
    """
    orig_dec = to_decimal(original_score, param_name="original_score")
    rem_dec = to_decimal(remediation_score, param_name="remediation_score")
    mp_dec = _resolve_and_validate_max_points(
        max_points=max_points,
        original_max_points=original_max_points,
        remediation_max_points=remediation_max_points,
    )
    cap_dec = validate_cap_percentage(cap_percentage)

    if orig_dec < Decimal("0"):
        raise ValueError(f"original_score cannot be negative (got {orig_dec})")
    if orig_dec > mp_dec:
        raise ValueError(
            f"original_score ({orig_dec}) cannot exceed max_points ({mp_dec})"
        )

    if rem_dec < Decimal("0"):
        raise ValueError(f"remediation_score cannot be negative (got {rem_dec})")
    if rem_dec > mp_dec:
        raise ValueError(
            f"remediation_score ({rem_dec}) cannot exceed max_points ({mp_dec})"
        )

    cap_score = (mp_dec * cap_dec) / Decimal("100")
    capped_remediation = min(rem_dec, cap_score)
    effective_score = max(orig_dec, capped_remediation)

    was_adjusted = effective_score > orig_dec
    was_capped = rem_dec > cap_score and effective_score == cap_score

    return RemediationScoreAdjustment(
        original_score=orig_dec,
        remediation_score=rem_dec,
        max_points=mp_dec,
        cap_percentage=cap_dec,
        cap_score=cap_score,
        effective_score=effective_score,
        was_adjusted=was_adjusted,
        was_capped=was_capped,
    )


def calculate_adjusted_score(
    original_score: object,
    remediation_score: object,
    max_points: object | None = None,
    *,
    cap_percentage: object = DEFAULT_REMEDIATION_CAP_PERCENTAGE,
    original_max_points: object | None = None,
    remediation_max_points: object | None = None,
) -> Decimal:
    """Convenience helper returning just the effective Decimal score."""
    return adjust_remediation_score(
        original_score=original_score,
        remediation_score=remediation_score,
        max_points=max_points,
        cap_percentage=cap_percentage,
        original_max_points=original_max_points,
        remediation_max_points=remediation_max_points,
    ).effective_score

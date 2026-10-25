from decimal import Decimal
import pytest

from app.services.grading.RemediationScoreAdjuster import (
    DEFAULT_REMEDIATION_CAP_PERCENTAGE,
    RemediationScoreAdjustment,
    adjust_remediation_score,
    calculate_adjusted_score,
    validate_cap_percentage,
)


def test_agreed_example_10_20_to_19_20_capped_at_15_20():
    """Agreed requirement: Original 10/20, Remediation 19/20, Adjusted 15/20 (75% default cap)."""
    result = adjust_remediation_score(
        original_score=10,
        remediation_score=19,
        max_points=20,
    )
    assert result.original_score == Decimal("10")
    assert result.remediation_score == Decimal("19")
    assert result.max_points == Decimal("20")
    assert result.cap_percentage == Decimal("75")
    assert result.cap_score == Decimal("15")
    assert result.effective_score == Decimal("15")
    assert result.was_adjusted is True
    assert result.was_capped is True

    # Check convenience function returns identical Decimal
    effective = calculate_adjusted_score(10, 19, 20)
    assert effective == Decimal("15")


def test_lower_remediation_score_never_reduces_original():
    """Remediation score worse than original must NEVER penalize the student."""
    result = adjust_remediation_score(
        original_score=10,
        remediation_score=7,
        max_points=20,
    )
    assert result.effective_score == Decimal("10")
    assert result.was_adjusted is False
    assert result.was_capped is False


def test_zero_remediation_score_never_reduces_original():
    result = adjust_remediation_score(
        original_score=10,
        remediation_score=0,
        max_points=20,
    )
    assert result.effective_score == Decimal("10")
    assert result.was_adjusted is False


def test_equal_remediation_score_leaves_score_unchanged():
    result = adjust_remediation_score(
        original_score=10,
        remediation_score=10,
        max_points=20,
    )
    assert result.effective_score == Decimal("10")
    assert result.was_adjusted is False
    assert result.was_capped is False


def test_partial_improvement_below_cap_is_not_capped():
    """If remediation improves score but is <= 75% cap, award the full remediation score."""
    result = adjust_remediation_score(
        original_score=8,
        remediation_score=13,
        max_points=20,
    )
    # 75% of 20 = 15. 13 < 15, so effective is 13.
    assert result.cap_score == Decimal("15")
    assert result.effective_score == Decimal("13")
    assert result.was_adjusted is True
    assert result.was_capped is False


def test_exact_cap_score_improvement():
    """Remediation matching the cap exactly."""
    result = adjust_remediation_score(
        original_score=10,
        remediation_score=15,
        max_points=20,
    )
    assert result.effective_score == Decimal("15")
    assert result.was_adjusted is True
    assert result.was_capped is False


def test_already_passing_scores_never_reduced():
    """Original scores already above 75% cap must never be reduced."""
    # Original is 16/20 (80%), Remediation is 19/20 (95%).
    # 75% cap is 15. The student must keep their original 16.
    result = adjust_remediation_score(
        original_score=16,
        remediation_score=19,
        max_points=20,
    )
    assert result.effective_score == Decimal("16")
    assert result.was_adjusted is False

    # Original is 18/20 (90%), Remediation is 12/20 (60%).
    result_lower = adjust_remediation_score(
        original_score=18,
        remediation_score=12,
        max_points=20,
    )
    assert result_lower.effective_score == Decimal("18")
    assert result_lower.was_adjusted is False


def test_already_passing_score_can_improve_under_higher_cap():
    """If cap allows (e.g. 90%), an already passing score can still improve up to the cap."""
    result = adjust_remediation_score(
        original_score=16,
        remediation_score=19,
        max_points=20,
        cap_percentage=90,
    )
    # 90% of 20 = 18. 18 > 16 original.
    assert result.effective_score == Decimal("18")
    assert result.was_adjusted is True
    assert result.was_capped is True


def test_100_percent_full_replacement_cap_is_strictly_excluded():
    """Approved remediation policy strictly excludes 100% Full Replacement."""
    with pytest.raises(ValueError, match="excluding 100% full replacement"):
        validate_cap_percentage(100)

    with pytest.raises(ValueError, match="excluding 100% full replacement"):
        adjust_remediation_score(
            original_score=10,
            remediation_score=19,
            max_points=20,
            cap_percentage=100,
        )


@pytest.mark.parametrize(
    "cap_percent,expected_effective,expected_capped",
    [
        (50, Decimal("10"), True),   # 50% of 20 = 10 -> effective max(10, 10) = 10
        (80, Decimal("16"), True),   # 80% of 20 = 16 -> effective 16
        (85, Decimal("17"), True),   # 85% of 20 = 17 -> effective 17
        (90, Decimal("18"), True),   # 90% of 20 = 18 -> effective 18
        (95, Decimal("19"), False),  # 95% of 20 = 19 -> exact remediation 19
    ],
)
def test_configurable_caps(cap_percent, expected_effective, expected_capped):
    result = adjust_remediation_score(
        original_score=10,
        remediation_score=19,
        max_points=20,
        cap_percentage=cap_percent,
    )
    assert result.effective_score == expected_effective
    assert result.was_capped is expected_capped


def test_decimal_precision_no_invented_rounding():
    """Retains exact Decimal precision with fractional points."""
    # 75% of 15 = 11.25
    result = adjust_remediation_score(
        original_score=Decimal("6.5"),
        remediation_score=Decimal("14.0"),
        max_points=Decimal("15"),
        cap_percentage=Decimal("75"),
    )
    assert result.cap_score == Decimal("11.25")
    assert result.effective_score == Decimal("11.25")
    assert result.was_adjusted is True
    assert result.was_capped is True

    # 75% of 25 = 18.75
    result2 = adjust_remediation_score(
        original_score=Decimal("12.5"),
        remediation_score=Decimal("18.5"),
        max_points=Decimal("25"),
    )
    assert result2.cap_score == Decimal("18.75")
    assert result2.effective_score == Decimal("18.5")  # 18.5 < 18.75, not capped
    assert result2.was_adjusted is True
    assert result2.was_capped is False


def test_matching_max_points_support():
    """Requirement 6: support matching original/remediation maximum points only."""
    # When matching max points are explicitly passed:
    result = adjust_remediation_score(
        original_score=10,
        remediation_score=19,
        original_max_points=20,
        remediation_max_points=20,
    )
    assert result.effective_score == Decimal("15")

    # When max points mismatch, raise ValueError:
    with pytest.raises(ValueError, match="Matching original and remediation maximum points required"):
        adjust_remediation_score(
            original_score=10,
            remediation_score=19,
            original_max_points=20,
            remediation_max_points=25,
        )


def test_raw_evidence_preserved_and_result_immutable():
    """Requirement 5: Never overwrite raw evidence; result object is frozen."""
    orig = Decimal("10")
    rem = Decimal("19")
    mp = Decimal("20")

    result = adjust_remediation_score(orig, rem, mp)
    assert result.original_score == orig
    assert result.remediation_score == rem

    # Dataclass is frozen
    with pytest.raises(Exception):
        result.effective_score = Decimal("20")  # type: ignore


def test_validation_errors():
    """Ensures robust input validation."""
    # Negative scores
    with pytest.raises(ValueError, match="original_score cannot be negative"):
        adjust_remediation_score(-1, 10, 20)

    with pytest.raises(ValueError, match="remediation_score cannot be negative"):
        adjust_remediation_score(10, -1, 20)

    # Score exceeding max points
    with pytest.raises(ValueError, match="original_score .* cannot exceed max_points"):
        adjust_remediation_score(25, 10, 20)

    with pytest.raises(ValueError, match="remediation_score .* cannot exceed max_points"):
        adjust_remediation_score(10, 25, 20)

    # Invalid max_points
    with pytest.raises(ValueError, match="max_points must be strictly positive"):
        adjust_remediation_score(10, 10, 0)

    with pytest.raises(ValueError, match="max_points must be strictly positive"):
        adjust_remediation_score(10, 10, -5)

    # Invalid cap percentage
    with pytest.raises(ValueError, match="between 0 and 100"):
        validate_cap_percentage(-1)

    with pytest.raises(ValueError, match="excluding 100% full replacement"):
        validate_cap_percentage(100)

    with pytest.raises(ValueError, match="between 0 and 100"):
        validate_cap_percentage(101)

    # Boolean input rejection
    with pytest.raises(TypeError, match="cannot be a boolean"):
        adjust_remediation_score(True, 10, 20)

    # Missing max points
    with pytest.raises(ValueError, match="max_points must be provided"):
        adjust_remediation_score(10, 15)

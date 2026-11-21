"""Focused unit tests for the remediation predicted-term-grade ceiling policy."""

from decimal import Decimal
import math
import pytest

from app.services.grading.RemediationGradeCeiling import (
    DEFAULT_PREDICTED_GRADE_CEILING,
    MAX_PREDICTED_GRADE,
    MAX_PREDICTED_GRADE_CEILING,
    MIN_PREDICTED_GRADE,
    MIN_PREDICTED_GRADE_CEILING,
    RemediationGradeCeilingResult,
    apply_remediation_grade_ceiling,
    resolve_default_predicted_grade_ceiling,
    validate_predicted_grade,
    validate_predicted_grade_ceiling,
)


def test_example_84_to_87_point_2_capped_at_85_preserves_raw_rf_output():
    """Core example: baseline 84, ceiling 85, raw RF 87.2 -> capped 85 while raw stays 87.2."""
    result = apply_remediation_grade_ceiling(
        raw_prediction=87.2,
        unremediated_baseline=84,
        selected_ceiling=85,
    )
    assert isinstance(result, RemediationGradeCeilingResult)
    assert result.raw_predicted_grade == Decimal("87.2")
    assert result.unremediated_baseline == Decimal("84")
    assert result.selected_ceiling == Decimal("85")
    assert result.effective_ceiling == Decimal("85")
    assert result.capped_projection == Decimal("85")
    assert result.was_ceiling_applied is True
    assert result.raw_gain_from_baseline == Decimal("3.2")
    assert result.capped_gain_from_baseline == Decimal("1")


def test_default_ceiling_is_85_for_new_graded_plans():
    assert DEFAULT_PREDICTED_GRADE_CEILING == Decimal("85")
    assert MAX_PREDICTED_GRADE_CEILING == Decimal("85")
    assert MIN_PREDICTED_GRADE_CEILING == Decimal("0")
    assert resolve_default_predicted_grade_ceiling() == Decimal("85")
    assert resolve_default_predicted_grade_ceiling(None) == Decimal("85")
    assert resolve_default_predicted_grade_ceiling(80) == Decimal("80")

    result = apply_remediation_grade_ceiling(
        raw_prediction=87.2,
        unremediated_baseline=84,
    )
    assert result.selected_ceiling == Decimal("85")
    assert result.capped_projection == Decimal("85")
    assert result.was_ceiling_applied is True


def test_prediction_below_cap_is_not_capped():
    result = apply_remediation_grade_ceiling(
        raw_prediction=84.6,
        unremediated_baseline=84.0,
        selected_ceiling=85,
    )
    assert result.raw_predicted_grade == Decimal("84.6")
    assert result.capped_projection == Decimal("84.6")
    assert result.selected_ceiling == Decimal("85")
    assert result.effective_ceiling == Decimal("85")
    assert result.was_ceiling_applied is False
    assert result.raw_gain_from_baseline == Decimal("0.6")
    assert result.capped_gain_from_baseline == Decimal("0.6")


def test_prediction_exactly_at_ceiling_is_not_marked_capped():
    result = apply_remediation_grade_ceiling(
        raw_prediction=85.0,
        unremediated_baseline=84.0,
        selected_ceiling=85,
    )
    assert result.raw_predicted_grade == Decimal("85.0")
    assert result.capped_projection == Decimal("85")
    assert result.was_ceiling_applied is False
    assert result.capped_gain_from_baseline == Decimal("1.0")


def test_lower_teacher_selected_ceiling_caps_below_85():
    result = apply_remediation_grade_ceiling(
        raw_prediction=83.5,
        unremediated_baseline=78.0,
        selected_ceiling=80,
    )
    assert result.raw_predicted_grade == Decimal("83.5")
    assert result.selected_ceiling == Decimal("80")
    assert result.effective_ceiling == Decimal("80")
    assert result.capped_projection == Decimal("80")
    assert result.was_ceiling_applied is True
    assert result.raw_gain_from_baseline == Decimal("5.5")
    assert result.capped_gain_from_baseline == Decimal("2.0")


def test_baseline_above_85_is_preserved_and_remediation_adds_no_gain():
    """A student whose legitimate unremediated baseline is already > 85 must never be penalized."""
    result = apply_remediation_grade_ceiling(
        raw_prediction=88.4,
        unremediated_baseline=86.5,
        selected_ceiling=85,
    )
    assert result.raw_predicted_grade == Decimal("88.4")
    assert result.selected_ceiling == Decimal("85")
    assert result.effective_ceiling == Decimal("86.5")
    assert result.capped_projection == Decimal("86.5")
    assert result.was_ceiling_applied is True
    assert result.raw_gain_from_baseline == Decimal("1.9")
    assert result.capped_gain_from_baseline == Decimal("0.0")


def test_legitimate_non_remediation_gain_above_85_preserved():
    """If regular work pushes unremediated baseline to 87.5 while raw with remediation is 89.0, keep 87.5."""
    result = apply_remediation_grade_ceiling(
        raw_prediction=Decimal("89.0"),
        unremediated_baseline=Decimal("87.5"),
        selected_ceiling=Decimal("85"),
    )
    assert result.effective_ceiling == Decimal("87.5")
    assert result.capped_projection == Decimal("87.5")
    assert result.raw_predicted_grade == Decimal("89.0")
    assert result.was_ceiling_applied is True
    assert result.capped_gain_from_baseline == Decimal("0.0")


def test_selected_ceiling_below_baseline_never_reduces_baseline():
    result = apply_remediation_grade_ceiling(
        raw_prediction=86.0,
        unremediated_baseline=84.0,
        selected_ceiling=80,
    )
    assert result.selected_ceiling == Decimal("80")
    assert result.effective_ceiling == Decimal("84.0")
    assert result.capped_projection == Decimal("84.0")
    assert result.was_ceiling_applied is True
    assert result.capped_gain_from_baseline == Decimal("0.0")


def test_non_monotonic_rf_drop_is_not_inflated_to_ceiling():
    """Random Forest outputs are not guaranteed monotonic; a drop below baseline stays as predicted."""
    result = apply_remediation_grade_ceiling(
        raw_prediction=83.1,
        unremediated_baseline=84.0,
        selected_ceiling=85,
    )
    assert result.raw_predicted_grade == Decimal("83.1")
    assert result.effective_ceiling == Decimal("85")
    assert result.capped_projection == Decimal("83.1")
    assert result.was_ceiling_applied is False
    assert result.raw_gain_from_baseline == Decimal("-0.9")
    assert result.capped_gain_from_baseline == Decimal("-0.9")


def test_non_monotonic_rf_drop_when_baseline_above_85():
    result = apply_remediation_grade_ceiling(
        raw_prediction=85.8,
        unremediated_baseline=86.5,
        selected_ceiling=85,
    )
    assert result.raw_predicted_grade == Decimal("85.8")
    assert result.effective_ceiling == Decimal("86.5")
    assert result.capped_projection == Decimal("85.8")
    assert result.was_ceiling_applied is False
    assert result.capped_gain_from_baseline == Decimal("-0.7")


def test_missing_unremediated_baseline_uses_selected_ceiling_directly():
    result = apply_remediation_grade_ceiling(
        raw_prediction=87.2,
        unremediated_baseline=None,
        selected_ceiling=85,
    )
    assert result.unremediated_baseline is None
    assert result.effective_ceiling == Decimal("85")
    assert result.capped_projection == Decimal("85")
    assert result.was_ceiling_applied is True
    assert result.raw_gain_from_baseline is None
    assert result.capped_gain_from_baseline is None


def test_decimal_precision_and_low_valid_range_without_invented_rounding():
    result = apply_remediation_grade_ceiling(
        raw_prediction="72.345",
        unremediated_baseline="55.125",
        selected_ceiling="82.5",
    )
    assert result.raw_predicted_grade == Decimal("72.345")
    assert result.unremediated_baseline == Decimal("55.125")
    assert result.selected_ceiling == Decimal("82.5")
    assert result.capped_projection == Decimal("72.345")
    assert result.was_ceiling_applied is False
    assert result.raw_gain_from_baseline == Decimal("17.220")


def test_result_is_immutable():
    result = apply_remediation_grade_ceiling(87.2, unremediated_baseline=84, selected_ceiling=85)
    with pytest.raises(Exception):
        result.capped_projection = Decimal("90")  # type: ignore[misc]


@pytest.mark.parametrize("valid_ceiling", [0, 0.0, 59.5, 60, 75, 80, 82.5, 85, "85.00", Decimal("85")])
def test_validate_predicted_grade_ceiling_accepts_valid_range(valid_ceiling):
    parsed = validate_predicted_grade_ceiling(valid_ceiling)
    assert MIN_PREDICTED_GRADE_CEILING <= parsed <= MAX_PREDICTED_GRADE_CEILING


@pytest.mark.parametrize("invalid_ceiling", [-0.01, -1, 85.01, 86, 99, 100, 101, "85.1", "-5", "", "   ", "abc", math.nan, math.inf, -math.inf, Decimal("NaN"), Decimal("Infinity")])
def test_validate_predicted_grade_ceiling_rejects_out_of_range_and_non_finite(invalid_ceiling):
    with pytest.raises(ValueError):
        validate_predicted_grade_ceiling(invalid_ceiling)


@pytest.mark.parametrize("bad_type", [True, False, None, [], {}])
def test_validate_predicted_grade_ceiling_rejects_invalid_types(bad_type):
    with pytest.raises(TypeError):
        validate_predicted_grade_ceiling(bad_type)


@pytest.mark.parametrize("invalid_grade", [-0.01, -10, 100.01, 105, math.nan, math.inf, -math.inf, Decimal("NaN"), "", "bad"])
def test_validate_predicted_grade_rejects_out_of_range_and_non_finite(invalid_grade):
    with pytest.raises(ValueError):
        validate_predicted_grade(invalid_grade)


def test_apply_rejects_invalid_inputs():
    with pytest.raises(ValueError, match="selected_ceiling must be between 0 and 85"):
        apply_remediation_grade_ceiling(84, unremediated_baseline=82, selected_ceiling=85.01)

    with pytest.raises(ValueError, match="selected_ceiling must be between 0 and 85"):
        apply_remediation_grade_ceiling(84, unremediated_baseline=82, selected_ceiling=100)

    with pytest.raises(ValueError, match="raw_prediction must be between 0 and 100"):
        apply_remediation_grade_ceiling(101, unremediated_baseline=82, selected_ceiling=85)

    with pytest.raises(ValueError, match="unremediated_baseline must be between 0 and 100"):
        apply_remediation_grade_ceiling(84, unremediated_baseline=-1, selected_ceiling=85)

    with pytest.raises(TypeError, match="cannot be a boolean"):
        apply_remediation_grade_ceiling(True, unremediated_baseline=82, selected_ceiling=85)

    with pytest.raises(TypeError, match="Unsupported type for selected_ceiling"):
        apply_remediation_grade_ceiling(84, unremediated_baseline=82, selected_ceiling=None)

    assert MIN_PREDICTED_GRADE == Decimal("0")
    assert MAX_PREDICTED_GRADE == Decimal("100")

from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.services.AcademicPeriodService import (
    compute_period_progress_ratio,
    normalize_academic_period_values,
)


def test_academic_period_model_defaults_to_term_values():
    columns = AcademicPeriod.__table__.c

    assert columns.period_type.default.arg == "TERM"
    assert columns.total_periods_in_year.default.arg == 3
    assert columns.period_progress_ratio.default.arg == 0.3333


def test_default_academic_period_values_normalize_to_term_one():
    period = SimpleNamespace(period_type=None, period_sequence=None, total_periods_in_year=None)

    normalize_academic_period_values(period)

    assert period.period_type == "TERM"
    assert period.period_sequence == 1
    assert period.total_periods_in_year == 3
    assert period.period_progress_ratio == Decimal("0.3333")


@pytest.mark.parametrize(
    ("sequence", "expected"),
    [(1, Decimal("0.3333")), (2, Decimal("0.6667")), (3, Decimal("1.0000"))],
)
def test_term_progress_ratio_calculation(sequence, expected):
    assert compute_period_progress_ratio(sequence, 3) == expected


@pytest.mark.parametrize("sequence", [1, 2, 3])
def test_term_period_validation_accepts_terms_one_to_three(sequence):
    period = SimpleNamespace(period_type="TERM", period_sequence=sequence, total_periods_in_year=3)

    normalize_academic_period_values(period)

    assert period.period_progress_ratio == compute_period_progress_ratio(sequence, 3)


def test_term_period_validation_rejects_sequence_above_total():
    period = SimpleNamespace(period_type="TERM", period_sequence=4, total_periods_in_year=3)

    with pytest.raises(ValueError, match="TERM period_sequence must be between 1 and 3"):
        normalize_academic_period_values(period)


@pytest.mark.parametrize("sequence", [1, 4])
def test_existing_quarter_period_values_remain_valid(sequence):
    period = SimpleNamespace(period_type="QUARTER", period_sequence=sequence, total_periods_in_year=4)

    normalize_academic_period_values(period)

    assert period.period_type == "QUARTER"
    assert period.period_progress_ratio == compute_period_progress_ratio(sequence, 4)


def test_normalize_accepts_custom_total_periods_for_transitional_year():
    # A TERM with only 2 periods (transitional SSHS pilot year) should be accepted.
    period = SimpleNamespace(period_type="TERM", period_sequence=2, total_periods_in_year=2)

    normalize_academic_period_values(period)

    assert period.total_periods_in_year == 2
    assert period.period_progress_ratio == Decimal("1.0000")


def test_normalize_uses_default_total_when_none_provided():
    # When total_periods_in_year is None the canonical default for TERM (3) is used.
    period = SimpleNamespace(period_type="TERM", period_sequence=2, total_periods_in_year=None)

    normalize_academic_period_values(period)

    assert period.total_periods_in_year == 3
    assert period.period_progress_ratio == Decimal("0.6667")


def test_normalize_rejects_sequence_exceeding_custom_total():
    period = SimpleNamespace(period_type="TERM", period_sequence=3, total_periods_in_year=2)

    with pytest.raises(ValueError, match="TERM period_sequence must be between 1 and 2"):
        normalize_academic_period_values(period)


from decimal import Decimal, ROUND_HALF_UP


PERIOD_TOTALS = {
    "TERM": 3,
    "QUARTER": 4,
    "SEMESTER": 2,
}


def compute_period_progress_ratio(period_sequence: int, total_periods: int) -> Decimal:
    if period_sequence <= 0:
        raise ValueError("period_sequence must be greater than 0")
    if total_periods <= 0:
        raise ValueError("total_periods must be greater than 0")
    if period_sequence > total_periods:
        raise ValueError("period_sequence cannot exceed total_periods")

    return (Decimal(period_sequence) / Decimal(total_periods)).quantize(
        Decimal("0.0001"),
        rounding=ROUND_HALF_UP,
    )


def normalize_academic_period_values(period: object) -> None:
    period_type = (getattr(period, "period_type", None) or "TERM").upper()
    if period_type not in PERIOD_TOTALS:
        raise ValueError("period_type must be one of TERM, QUARTER, or SEMESTER")

    expected_total = PERIOD_TOTALS[period_type]
    period_sequence = getattr(period, "period_sequence", None) or 1
    total_periods = getattr(period, "total_periods_in_year", None) or expected_total

    if total_periods != expected_total:
        raise ValueError(f"{period_type} periods must use total_periods_in_year={expected_total}")
    if period_sequence < 1 or period_sequence > expected_total:
        raise ValueError(f"{period_type} period_sequence must be between 1 and {expected_total}")

    period.period_type = period_type
    period.period_sequence = period_sequence
    period.total_periods_in_year = total_periods
    period.period_progress_ratio = compute_period_progress_ratio(period_sequence, total_periods)

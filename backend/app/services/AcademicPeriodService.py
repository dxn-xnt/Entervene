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

    default_total = PERIOD_TOTALS[period_type]
    period_sequence = getattr(period, "period_sequence", None) or 1

    # Allow caller to supply a custom total_periods_in_year (e.g. a transitional
    # 2-term SSHS pilot year).  Only fall back to the dictionary default when the
    # caller has not explicitly provided one.
    caller_total = getattr(period, "total_periods_in_year", None)
    total_periods = caller_total if caller_total else default_total

    if total_periods < 1:
        raise ValueError("total_periods_in_year must be at least 1")
    if period_sequence < 1 or period_sequence > total_periods:
        raise ValueError(
            f"{period_type} period_sequence must be between 1 and {total_periods}"
        )

    period.period_type = period_type
    period.period_sequence = period_sequence
    period.total_periods_in_year = total_periods
    period.period_progress_ratio = compute_period_progress_ratio(period_sequence, total_periods)


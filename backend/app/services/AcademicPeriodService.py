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


def create_or_update_academic_periods(
    db,
    academic_year_id: int,
    period_type: str,
    periods_data: list[dict],
) -> list:
    """
    Creates or updates academic periods for an academic year and period type.
    """
    from datetime import date
    from fastapi import HTTPException
    from app.models.academic.AcademicYear import AcademicYear
    from app.models.academic.AcademicPeriod import AcademicPeriod

    academic_year = db.query(AcademicYear).filter(AcademicYear.academic_year_id == academic_year_id).first()
    if not academic_year:
        raise HTTPException(status_code=404, detail="Academic year not found")

    p_type = (period_type or "TERM").upper()
    if p_type not in PERIOD_TOTALS:
        raise HTTPException(status_code=400, detail=f"Invalid period type '{period_type}'. Must be TERM, QUARTER, or SEMESTER.")

    expected_total = PERIOD_TOTALS[p_type]
    results = []

    for item in periods_data:
        seq = item.get("period_sequence")
        if not seq or seq < 1 or seq > expected_total:
            raise HTTPException(status_code=400, detail=f"Invalid period_sequence {seq} for {p_type}")

        start_raw = item.get("start_date")
        end_raw = item.get("end_date")
        if not start_raw or not end_raw:
            raise HTTPException(status_code=400, detail=f"Start and end dates are required for period {seq}")

        start_d = date.fromisoformat(start_raw) if isinstance(start_raw, str) else start_raw
        end_d = date.fromisoformat(end_raw) if isinstance(end_raw, str) else end_raw

        if start_d > end_d:
            raise HTTPException(status_code=400, detail=f"Start date cannot be after end date for period {seq}")

        p_name = f"{p_type.capitalize()} {seq}"

        # Check existing
        existing = (
            db.query(AcademicPeriod)
            .filter(
                AcademicPeriod.academic_year_id == academic_year_id,
                AcademicPeriod.period_type == p_type,
                AcademicPeriod.period_sequence == seq,
            )
            .first()
        )

        if existing:
            existing.period_name = p_name
            existing.start_date = start_d
            existing.end_date = end_d
            existing.total_periods_in_year = expected_total
            normalize_academic_period_values(existing)
            results.append(existing)
        else:
            new_period = AcademicPeriod(
                academic_year_id=academic_year_id,
                period_type=p_type,
                period_sequence=seq,
                period_name=p_name,
                total_periods_in_year=expected_total,
                start_date=start_d,
                end_date=end_d,
                is_active=False,
            )
            normalize_academic_period_values(new_period)
            db.add(new_period)
            results.append(new_period)

    db.commit()
    for r in results:
        db.refresh(r)
    return results



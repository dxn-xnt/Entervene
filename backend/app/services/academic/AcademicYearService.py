from datetime import date, datetime
import re
from sqlalchemy.orm import Session
from sqlalchemy import func

from app.models.academic.AcademicYear import AcademicYear


def _parse_start_year(year_label: str) -> int | None:
    match = re.match(r"^(\d{4})", year_label.strip())
    if match:
        return int(match.group(1))
    return None


def ensure_future_academic_years(db: Session, years_ahead: int = 2) -> list[AcademicYear]:
    """
    Ensures that academic years exist up to ``years_ahead`` from the current/active academic year.
    If missing, creates future AcademicYear records with standard dates and is_active=False.
    Idempotent and safe against duplicates.
    """
    # 1. Determine base start year
    active_year = (
        db.query(AcademicYear)
        .filter(AcademicYear.is_active.is_(True))
        .order_by(AcademicYear.start_date.desc())
        .first()
    )

    base_start_year: int | None = None

    if active_year:
        base_start_year = _parse_start_year(active_year.year_label)
        if not base_start_year and active_year.start_date:
            base_start_year = active_year.start_date.year

    if not base_start_year:
        latest_year = (
            db.query(AcademicYear)
            .order_by(AcademicYear.start_date.desc())
            .first()
        )
        if latest_year:
            base_start_year = _parse_start_year(latest_year.year_label)
            if not base_start_year and latest_year.start_date:
                base_start_year = latest_year.start_date.year

    if not base_start_year:
        now = datetime.now()
        # In PH/DepEd cycle: if June or later, start year is current year, else prior year
        base_start_year = now.year if now.month >= 6 else now.year - 1

    # 2. Query all existing year labels into a set
    existing_years = db.query(AcademicYear).all()
    existing_labels = {ay.year_label.strip().casefold() for ay in existing_years}

    created_any = False
    for offset in range(years_ahead + 1):
        sy_start = base_start_year + offset
        sy_end = sy_start + 1
        label = f"{sy_start}-{sy_end}"

        if label.casefold() not in existing_labels:
            new_ay = AcademicYear(
                year_label=label,
                start_date=date(sy_start, 8, 1),
                end_date=date(sy_end, 5, 31),
                is_active=False,
            )
            db.add(new_ay)
            existing_labels.add(label.casefold())
            created_any = True

    if created_any:
        db.commit()

    return db.query(AcademicYear).order_by(AcademicYear.start_date.desc(), func.lower(AcademicYear.year_label).desc()).all()

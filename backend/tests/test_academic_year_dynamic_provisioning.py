from datetime import date
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.Base import Base
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.services.academic.AcademicYearService import ensure_future_academic_years
from app.services.AcademicPeriodService import create_or_update_academic_periods
from fastapi import HTTPException


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def test_ensure_future_academic_years_from_active_year(db_session):
    # Seed active academic year
    active_year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 8, 1),
        end_date=date(2026, 5, 31),
        is_active=True,
    )
    db_session.add(active_year)
    db_session.commit()

    # Call ensure_future_academic_years with years_ahead=2
    years = ensure_future_academic_years(db_session, years_ahead=2)
    labels = [y.year_label for y in years]

    assert "2025-2026" in labels
    assert "2026-2027" in labels
    assert "2027-2028" in labels

    # Future years must not be active by default
    y_2026 = next(y for y in years if y.year_label == "2026-2027")
    y_2027 = next(y for y in years if y.year_label == "2027-2028")
    assert y_2026.is_active is False
    assert y_2027.is_active is False


def test_ensure_future_academic_years_idempotency(db_session):
    active_year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 8, 1),
        end_date=date(2027, 5, 31),
        is_active=True,
    )
    db_session.add(active_year)
    db_session.commit()

    # Call twice
    first_run = ensure_future_academic_years(db_session, years_ahead=2)
    second_run = ensure_future_academic_years(db_session, years_ahead=2)

    assert len(first_run) == len(second_run)

    all_years = db_session.query(AcademicYear).all()
    all_labels = [y.year_label for y in all_years]
    # Verify no duplicate labels
    assert len(all_labels) == len(set(all_labels))


def test_create_academic_periods_success(db_session):
    ay = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 8, 1),
        end_date=date(2027, 5, 31),
        is_active=True,
    )
    db_session.add(ay)
    db_session.commit()

    periods_data = [
        {"period_sequence": 1, "start_date": "2026-08-01", "end_date": "2026-11-15"},
        {"period_sequence": 2, "start_date": "2026-11-16", "end_date": "2027-02-15"},
        {"period_sequence": 3, "start_date": "2027-02-16", "end_date": "2027-05-31"},
    ]

    created = create_or_update_academic_periods(
        db=db_session,
        academic_year_id=ay.academic_year_id,
        period_type="TERM",
        periods_data=periods_data,
    )

    assert len(created) == 3
    assert created[0].period_name == "Term 1"
    assert created[1].period_name == "Term 2"
    assert created[2].period_name == "Term 3"
    assert float(created[0].period_progress_ratio) == pytest.approx(0.3333, abs=1e-4)


def test_create_academic_periods_invalid_dates_rejected(db_session):
    ay = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 8, 1),
        end_date=date(2027, 5, 31),
        is_active=True,
    )
    db_session.add(ay)
    db_session.commit()

    invalid_periods_data = [
        {"period_sequence": 1, "start_date": "2026-11-15", "end_date": "2026-08-01"},  # start > end
    ]

    with pytest.raises(HTTPException) as exc_info:
        create_or_update_academic_periods(
            db=db_session,
            academic_year_id=ay.academic_year_id,
            period_type="TERM",
            periods_data=invalid_periods_data,
        )
    assert exc_info.value.status_code == 400


def test_admin_can_configure_future_year_periods_without_activating_year(db_session):
    current = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 8, 1),
        end_date=date(2027, 5, 31),
        is_active=True,
    )
    future = AcademicYear(
        year_label="2027-2028",
        start_date=date(2027, 8, 1),
        end_date=date(2028, 5, 31),
        is_active=False,
    )
    db_session.add_all([current, future])
    db_session.commit()

    periods = create_or_update_academic_periods(
        db=db_session,
        academic_year_id=future.academic_year_id,
        period_type="TERM",
        periods_data=[
            {"period_sequence": 1, "start_date": "2027-08-01", "end_date": "2027-11-15"},
        ],
    )

    assert len(periods) == 1
    assert periods[0].academic_year_id == future.academic_year_id
    db_session.refresh(future)
    assert future.is_active is False


def test_historical_period_configuration_and_invalid_batches_do_not_partially_mutate(db_session):
    historical = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 8, 1),
        end_date=date(2026, 5, 31),
        is_active=False,
    )
    current = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 8, 1),
        end_date=date(2027, 5, 31),
        is_active=True,
    )
    existing = AcademicPeriod(
        academic_year=historical,
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        start_date=date(2025, 8, 1),
        end_date=date(2025, 11, 15),
        is_active=False,
    )
    db_session.add_all([historical, current, existing])
    db_session.commit()

    with pytest.raises(HTTPException) as historical_error:
        create_or_update_academic_periods(
            db=db_session,
            academic_year_id=historical.academic_year_id,
            period_type="TERM",
            periods_data=[
                {"period_sequence": 1, "start_date": "2025-08-10", "end_date": "2025-11-15"},
            ],
        )
    assert historical_error.value.status_code == 403
    db_session.refresh(existing)
    assert existing.start_date == date(2025, 8, 1)

    with pytest.raises(HTTPException) as batch_error:
        create_or_update_academic_periods(
            db=db_session,
            academic_year_id=current.academic_year_id,
            period_type="TERM",
            periods_data=[
                {"period_sequence": 1, "start_date": "2026-08-01", "end_date": "2026-11-15"},
                {"period_sequence": 2, "start_date": "2027-02-01", "end_date": "2026-12-01"},
            ],
        )
    assert batch_error.value.status_code == 400
    assert db_session.query(AcademicPeriod).filter(
        AcademicPeriod.academic_year_id == current.academic_year_id
    ).count() == 0


def test_ensure_future_academic_years_with_custom_labeled_active_year(db_session):
    # Active year has custom label with suffix e.g. "2026-2027 DEMO"
    active_year = AcademicYear(
        year_label="2026-2027 DEMO",
        start_date=date(2026, 8, 1),
        end_date=date(2027, 5, 31),
        is_active=True,
    )
    db_session.add(active_year)
    db_session.commit()

    years = ensure_future_academic_years(db_session, years_ahead=2)
    labels = [y.year_label for y in years]

    # Must retain original label and provision 2027-2028 and 2028-2029 without duplicate 2026-2027
    assert "2026-2027 DEMO" in labels
    assert "2026-2027" not in labels
    assert "2027-2028" in labels
    assert "2028-2029" in labels


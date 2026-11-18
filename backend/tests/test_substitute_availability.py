from datetime import date
from types import SimpleNamespace

from app.services.academic.SubstituteAvailabilityService import bounds, overlap, scheduled


def load(start="08:00", end="09:00", days=None):
    return SimpleNamespace(start_time=start, end_time=end, days_of_week=days or ["MONDAY"],
                           effective_from=None, effective_to=None,
                           period=SimpleNamespace(start_date=date(2026, 1, 1), end_date=date(2026, 12, 31)))


def test_overlapping_time_and_weekday():
    dates = (date(2026, 11, 1), date(2026, 11, 30))
    assert overlap(load(), load("08:30", "09:30"), dates, dates)
    assert not overlap(load(), load("09:00", "10:00"), dates, dates)
    assert not overlap(load(), load(days=["TUESDAY"]), dates, dates)


def test_disjoint_assignment_dates_do_not_conflict():
    assert not overlap(load(), load(), (date(2026, 11, 1), date(2026, 11, 7)),
                       (date(2026, 11, 8), date(2026, 11, 14)))


def test_short_assignment_must_include_scheduled_weekday():
    dates = (date(2026, 11, 3), date(2026, 11, 3))  # Tuesday
    assert not overlap(load(), load(), dates, dates)


def test_unknown_schedule_is_not_verified():
    assert not scheduled(load(start=None))
    assert not scheduled(load(start="09:00", end="08:00"))


def test_open_ended_dates_clipped_to_term_and_load_effectivity():
    item = load()
    item.effective_from = date(2026, 11, 10)
    assert bounds(item, date(2026, 11, 1), None) == (date(2026, 11, 10), date(2026, 12, 31))

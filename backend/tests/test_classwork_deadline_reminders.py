"""Regression tests for removal of student Classwork deadline reminders."""

from datetime import datetime, timezone

from app.services import ReminderRunner
from app.services.classwork.ClassworkDeadlineReminderService import (
    scan_classwork_deadline_reminders,
)


NOW = datetime(2026, 11, 19, 12, 0, tzinfo=timezone.utc)


def test_deadline_scanner_is_a_compatibility_noop():
    result = scan_classwork_deadline_reminders(None, now=NOW)

    assert result == {
        "scanned_assignments": 0,
        "sent": 0,
        "already_submitted": 0,
        "duplicate": 0,
        "ineligible": 0,
        "not_due": 0,
        "failed": 0,
    }


def test_reminder_runner_only_invokes_study_support(monkeypatch):
    calls: list[tuple[str, int]] = []

    def fake_study_support(*, now=None, limit=100):
        calls.append(("study_support", limit))
        return {"scanned": 1, "sent": 1, "failed": 0}

    monkeypatch.setattr(ReminderRunner, "run_study_support_reminder_scan", fake_study_support)

    summary = ReminderRunner.run_all_reminder_scans(now=NOW, limit=50)
    assert calls == [("study_support", 50)]
    assert summary == {"study_support": {"scanned": 1, "sent": 1, "failed": 0}}

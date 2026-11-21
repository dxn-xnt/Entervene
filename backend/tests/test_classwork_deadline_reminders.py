"""Regression tests for the durable reminder runner wiring."""

from datetime import datetime, timezone

from app.services import ReminderRunner


NOW = datetime(2026, 11, 19, 12, 0, tzinfo=timezone.utc)


def test_reminder_runner_invokes_all_durable_scans(monkeypatch):
    calls: list[tuple[str, int]] = []

    def fake_study_support(*, now=None, limit=100):
        calls.append(("study_support", limit))
        return {"scanned": 1, "sent": 1, "failed": 0}

    def fake_quiz_results(*, now=None, limit=100):
        calls.append(("quiz_results", limit))
        return {"scanned": 2, "sent": 1, "failed": 0}

    def fake_deadlines(*, now=None, limit=100):
        calls.append(("classwork_deadlines", limit))
        return {"scanned_assignments": 3, "sent": 2, "failed": 0}

    monkeypatch.setattr(ReminderRunner, "run_study_support_reminder_scan", fake_study_support)
    monkeypatch.setattr(ReminderRunner, "run_quiz_result_release_scan", fake_quiz_results)
    monkeypatch.setattr(ReminderRunner, "run_classwork_deadline_reminder_scan", fake_deadlines)

    summary = ReminderRunner.run_all_reminder_scans(now=NOW, limit=50)
    assert calls == [("study_support", 50), ("quiz_results", 50), ("classwork_deadlines", 50)]
    assert summary == {
        "study_support": {"scanned": 1, "sent": 1, "failed": 0},
        "quiz_results": {"scanned": 2, "sent": 1, "failed": 0},
        "classwork_deadlines": {"scanned_assignments": 3, "sent": 2, "failed": 0},
    }

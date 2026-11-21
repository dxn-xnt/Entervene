"""Independent periodic runner for durable student notifications.

Intended to be invoked from an external scheduler (cron, systemd timer,
Windows Task Scheduler, or a hosted scheduled job), not as a FastAPI background loop:

    python -m app.services.ReminderRunner --limit 100
"""

from __future__ import annotations

import argparse
from datetime import datetime
import json

from app.services.intervention.StudySupportReminderService import (
    run_study_support_reminder_scan,
)
from app.services.quiz.QuizResultsNotificationService import (
    run_quiz_result_release_scan,
)
from app.services.classwork.ClassworkDeadlineReminderService import (
    run_classwork_deadline_reminder_scan,
)


def run_all_reminder_scans(
    *,
    now: datetime | None = None,
    limit: int = 100,
) -> dict[str, dict[str, int | bool]]:
    """Run all scheduler-owned notification scans and return their summaries."""
    study_support_result = run_study_support_reminder_scan(now=now, limit=limit)
    quiz_results_result = run_quiz_result_release_scan(now=now, limit=limit)
    deadline_result = run_classwork_deadline_reminder_scan(now=now, limit=limit)
    return {
        "study_support": study_support_result,
        "quiz_results": quiz_results_result,
        "classwork_deadlines": deadline_result,
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run bounded Study Support, quiz-result, and deadline scans.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="Maximum candidates scanned by each notification service (1-1000).",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    summary = run_all_reminder_scans(limit=args.limit)
    print(json.dumps(summary, sort_keys=True))
    has_failures = any(int(section.get("failed", 0)) > 0 for section in summary.values())
    raise SystemExit(1 if has_failures else 0)

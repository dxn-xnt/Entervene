"""Independent periodic runner for Classwork deadline and Study Support reminders.

Intended to be invoked from an external scheduler (cron, systemd timer,
Windows Task Scheduler, or a hosted scheduled job), not as a FastAPI background loop:

    python -m app.services.ReminderRunner --limit 100
"""

from __future__ import annotations

import argparse
from datetime import datetime
import json

from app.services.classwork.ClassworkDeadlineReminderService import (
    run_classwork_deadline_reminder_scan,
)
from app.services.intervention.StudySupportReminderService import (
    run_study_support_reminder_scan,
)


def run_all_reminder_scans(
    *,
    now: datetime | None = None,
    limit: int = 100,
) -> dict[str, dict[str, int | bool]]:
    """Run both independent reminder scanners sequentially and return their summaries."""
    classwork_result = run_classwork_deadline_reminder_scan(now=now, limit=limit)
    study_support_result = run_study_support_reminder_scan(now=now, limit=limit)
    return {
        "classwork_deadlines": classwork_result,
        "study_support": study_support_result,
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run bounded Classwork deadline and Study Support reminder scans.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="Maximum candidate assignments scanned per reminder service (1-1000).",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    summary = run_all_reminder_scans(limit=args.limit)
    print(json.dumps(summary, sort_keys=True))
    has_failures = any(int(section.get("failed", 0)) > 0 for section in summary.values())
    raise SystemExit(1 if has_failures else 0)

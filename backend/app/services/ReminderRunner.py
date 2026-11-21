"""Independent periodic runner for Study Support reminders.

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


def run_all_reminder_scans(
    *,
    now: datetime | None = None,
    limit: int = 100,
) -> dict[str, dict[str, int | bool]]:
    """Run the Study Support reminder scanner and return its summary."""
    study_support_result = run_study_support_reminder_scan(now=now, limit=limit)
    return {
        "study_support": study_support_result,
    }


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the bounded Study Support reminder scan.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=100,
        help="Maximum candidate assignments scanned by the reminder service (1-1000).",
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    summary = run_all_reminder_scans(limit=args.limit)
    print(json.dumps(summary, sort_keys=True))
    has_failures = any(int(section.get("failed", 0)) > 0 for section in summary.values())
    raise SystemExit(1 if has_failures else 0)

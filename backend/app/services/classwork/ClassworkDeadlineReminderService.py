"""Compatibility entry points for the removed student deadline reminder scanner.

The module remains importable so older cron or Task Scheduler commands cannot
recreate student-facing deadline notifications during deployment transitions.
"""

from __future__ import annotations

from datetime import datetime
import json

from sqlalchemy.orm import Session


def scan_classwork_deadline_reminders(
    db: Session | None,
    *,
    now: datetime | None = None,
    limit: int = 100,
) -> dict[str, int]:
    """Return an empty summary without reading deadlines or creating notifications."""
    del db, now, limit
    return {
        "scanned_assignments": 0,
        "sent": 0,
        "already_submitted": 0,
        "duplicate": 0,
        "ineligible": 0,
        "not_due": 0,
        "failed": 0,
    }


def run_classwork_deadline_reminder_scan(
    *,
    now: datetime | None = None,
    limit: int = 100,
) -> dict[str, int]:
    """Keep the former standalone runner callable as a harmless no-op."""
    return scan_classwork_deadline_reminders(None, now=now, limit=limit)


if __name__ == "__main__":
    print(json.dumps(run_classwork_deadline_reminder_scan(), sort_keys=True))

"""
remediate_insufficient_data_predictions.py
===========================================
One-time idempotent remediation script to fix AIPrediction rows flagged as
INSUFFICIENT_DATA that currently store non-null predicted_period_grade,
non-null risk_score, or incorrect data_status.

Usage:
  python scripts/remediate_insufficient_data_predictions.py --dry-run
  python scripts/remediate_insufficient_data_predictions.py
"""

from __future__ import annotations

import argparse
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Ensure backend root is on sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

# Load environment if present
from dotenv import load_dotenv
load_dotenv(backend_dir.parent / ".env")
load_dotenv(backend_dir / ".env")

from app.db.Session import SessionLocal
from app.models.ai.AIPrediction import AIPrediction


def main():
    parser = argparse.ArgumentParser(
        description="Remediate AIPrediction rows where risk_level is INSUFFICIENT_DATA."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Inspect candidate rows and report without committing any changes.",
    )
    args = parser.parse_args()

    db = SessionLocal()

    try:
        # Idempotent candidate query:
        # Matches rows where risk_level is INSUFFICIENT_DATA and ANY of the 3 fields is dirty.
        candidate_query = db.query(AIPrediction).filter(
            AIPrediction.risk_level == "INSUFFICIENT_DATA",
            (
                AIPrediction.predicted_period_grade.isnot(None)
                | AIPrediction.risk_score.isnot(None)
                | (AIPrediction.data_status != "INSUFFICIENT_DATA")
            ),
        )

        candidate_count = candidate_query.count()
        start_time = datetime.now(timezone.utc)

        print(f"[{start_time.isoformat()}] Remediation Script: INSUFFICIENT_DATA Cleanup")
        print(f"  Candidate rows matching criteria: {candidate_count}")

        if candidate_count == 0:
            print("  No candidate rows found. Database is already clean and consistent.")
            return

        # Fetch up to 5 samples for inspection
        sample_rows = candidate_query.limit(5).all()
        print("\n  Sample candidate rows before update:")
        for r in sample_rows:
            print(
                f"    - ID {r.prediction_id}: student={r.student_id}, "
                f"grade={r.predicted_period_grade}, score={r.risk_score}, status='{r.data_status}'"
            )

        if args.dry_run:
            print(f"\n[DRY-RUN] {candidate_count} rows would be updated. No changes committed.")
            return

        # Unconditional 3-field batch update inside explicit transaction block
        print(f"\n  Executing unconditional 3-field update across {candidate_count} rows...")
        try:
            updated_count = candidate_query.update(
                {
                    AIPrediction.predicted_period_grade: None,
                    AIPrediction.risk_score: None,
                    AIPrediction.data_status: "INSUFFICIENT_DATA",
                },
                synchronize_session=False,
            )
            db.commit()
        except Exception:
            db.rollback()
            raise

        end_time = datetime.now(timezone.utc)
        duration_s = (end_time - start_time).total_seconds()
        print(f"  Update successful. Rows affected: {updated_count} (in {duration_s:.2f}s)")

        # Verify post-condition (idempotency check)
        remaining_candidates = candidate_query.count()
        print(f"  Post-verification: remaining candidate rows = {remaining_candidates}")
        assert remaining_candidates == 0, f"Error: {remaining_candidates} candidate rows still remain!"

        # Write audit log entry
        audit_dir = backend_dir / "data"
        audit_dir.mkdir(parents=True, exist_ok=True)
        audit_file = audit_dir / "migrations_audit.log"

        runner = os.environ.get("USERNAME") or os.environ.get("USER") or "system"
        audit_line = (
            f"[{end_time.isoformat()}] SCRIPT: remediate_insufficient_data_predictions.py | "
            f"RUNNER: {runner} | MATCHED: {candidate_count} | UPDATED: {updated_count} | "
            f"REMAINING: 0 | STATUS: SUCCESS\n"
        )
        with open(audit_file, "a", encoding="utf-8") as f:
            f.write(audit_line)

        print(f"  Audit trail recorded in: {audit_file}")
        print("  Remediation complete.")

    finally:
        db.close()


if __name__ == "__main__":
    main()

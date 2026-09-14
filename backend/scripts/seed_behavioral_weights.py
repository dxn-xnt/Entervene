"""Seed default RiskThreshold rows for Behavioral Engagement Score weights.

Weights:
- attendance_weight: 0.40
- ontime_weight: 0.35
- participation_weight: 0.25

Note on risk_level:
RiskThreshold.risk_level is a non-nullable DB schema column with a CHECK constraint.
For weight-configuration rows, risk_level is set to 'NEEDS_MONITORING' as a schema placeholder.
Weight lookups filter by condition_type and ignore the risk_level field.
"""

import os
import sys
from datetime import datetime, timezone
from decimal import Decimal

# Add backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.db.Session import SessionLocal
from app.models.ai.RiskThreshold import RiskThreshold


WEIGHT_CONFIGS = [
    {
        "threshold_name": "Behavioral Attendance Weight",
        "condition_type": "attendance_weight",
        "condition_value": Decimal("0.4000"),
        # Note: risk_level is a required DB schema placeholder, not evaluated by weight lookups.
        "risk_level": "NEEDS_MONITORING",
        "is_active": True,
    },
    {
        "threshold_name": "Behavioral On-Time Submission Weight",
        "condition_type": "ontime_weight",
        "condition_value": Decimal("0.3500"),
        # Note: risk_level is a required DB schema placeholder, not evaluated by weight lookups.
        "risk_level": "NEEDS_MONITORING",
        "is_active": True,
    },
    {
        "threshold_name": "Behavioral Assessment Participation Weight",
        "condition_type": "participation_weight",
        "condition_value": Decimal("0.2500"),
        # Note: risk_level is a required DB schema placeholder, not evaluated by weight lookups.
        "risk_level": "NEEDS_MONITORING",
        "is_active": True,
    },
]


def seed_behavioral_weights() -> None:
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        inserted = 0
        updated = 0
        for config in WEIGHT_CONFIGS:
            existing = (
                db.query(RiskThreshold)
                .filter(RiskThreshold.condition_type == config["condition_type"])
                .first()
            )
            if existing:
                existing.threshold_name = config["threshold_name"]
                existing.condition_value = config["condition_value"]
                existing.is_active = config["is_active"]
                updated += 1
            else:
                row = RiskThreshold(
                    threshold_name=config["threshold_name"],
                    condition_type=config["condition_type"],
                    condition_value=config["condition_value"],
                    risk_level=config["risk_level"],
                    effective_from=now,
                    is_active=config["is_active"],
                )
                db.add(row)
                inserted += 1
        db.commit()
        print(f"Seeded behavioral weights: {inserted} inserted, {updated} updated.")


if __name__ == "__main__":
    seed_behavioral_weights()

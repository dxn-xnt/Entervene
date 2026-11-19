import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock
from app.models.intervention.Intervention import Intervention
from app.services.intervention.RemediationGenerationEligibilityService import (
    _original_cutoff,
    _utc,
    resolve_remediation_generation_eligibility,
)


class TestRemediationGenerationEligibilityFallback(unittest.TestCase):
    def test_original_cutoff_handles_missing_and_null_cutoff(self):
        # 1. Missing evidence_cutoff_at fallback to activated_at
        act = datetime(2026, 10, 24, 18, 0, tzinfo=timezone.utc)
        inv = Intervention(
            intervention_id=1,
            diagnosis_snapshot={"risk_score": 0.88, "identified_weakness": "Reading"},
            activated_at=act,
        )
        cutoff = _original_cutoff(inv)
        self.assertEqual(cutoff, act)

        # 2. None diagnosis_snapshot fallback to created_at
        created = datetime(2026, 11, 1, 10, 0, tzinfo=timezone.utc)
        inv2 = Intervention(
            intervention_id=2,
            diagnosis_snapshot=None,
            activated_at=None,
            created_at=created,
        )
        cutoff2 = _original_cutoff(inv2)
        self.assertEqual(cutoff2, created)

        # 3. Explicit None in evidence_cutoff_at fallback to activated_at
        inv3 = Intervention(
            intervention_id=3,
            diagnosis_snapshot={"evidence_cutoff_at": None},
            activated_at=act,
        )
        cutoff3 = _original_cutoff(inv3)
        self.assertEqual(cutoff3, act)

    def test_original_cutoff_handles_valid_iso_strings(self):
        # UTC ISO string
        inv = Intervention(
            intervention_id=4,
            diagnosis_snapshot={"evidence_cutoff_at": "2026-11-15T08:30:00+00:00"},
        )
        cutoff = _original_cutoff(inv)
        self.assertEqual(cutoff, datetime(2026, 11, 15, 8, 30, tzinfo=timezone.utc))

        # Non-UTC ISO string with offset (+08:00)
        inv_offset = Intervention(
            intervention_id=5,
            diagnosis_snapshot={"evidence_cutoff_at": "2026-11-15T16:30:00+08:00"},
        )
        cutoff_offset = _original_cutoff(inv_offset)
        self.assertEqual(cutoff_offset, datetime(2026, 11, 15, 8, 30, tzinfo=timezone.utc))

    def test_original_cutoff_handles_datetime_objects(self):
        # Timezone-aware datetime
        dt_aware = datetime(2026, 11, 10, 12, 0, tzinfo=timezone(timedelta(hours=8)))
        inv = Intervention(
            intervention_id=6,
            diagnosis_snapshot={"evidence_cutoff_at": dt_aware},
        )
        cutoff = _original_cutoff(inv)
        self.assertEqual(cutoff, datetime(2026, 11, 10, 4, 0, tzinfo=timezone.utc))

        # Naive datetime
        dt_naive = datetime(2026, 11, 10, 12, 0)
        inv_naive = Intervention(
            intervention_id=7,
            diagnosis_snapshot={"evidence_cutoff_at": dt_naive},
        )
        cutoff_naive = _original_cutoff(inv_naive)
        self.assertEqual(cutoff_naive, datetime(2026, 11, 10, 12, 0, tzinfo=timezone.utc))

    def test_original_cutoff_handles_malformed_values(self):
        act = datetime(2026, 10, 24, 18, 0, tzinfo=timezone.utc)

        # Non-date string
        inv_str = Intervention(
            intervention_id=8,
            diagnosis_snapshot={"evidence_cutoff_at": "not-a-valid-date-string"},
            activated_at=act,
        )
        self.assertEqual(_original_cutoff(inv_str), act)

        # Empty string
        inv_empty = Intervention(
            intervention_id=9,
            diagnosis_snapshot={"evidence_cutoff_at": ""},
            activated_at=act,
        )
        self.assertEqual(_original_cutoff(inv_empty), act)

        # Integer / unexpected type
        inv_int = Intervention(
            intervention_id=10,
            diagnosis_snapshot={"evidence_cutoff_at": 1731650000},
            activated_at=act,
        )
        self.assertEqual(_original_cutoff(inv_int), act)

        # Nested dict / unexpected object
        inv_dict = Intervention(
            intervention_id=11,
            diagnosis_snapshot={"evidence_cutoff_at": {"invalid": True}},
            activated_at=act,
        )
        self.assertEqual(_original_cutoff(inv_dict), act)

    def test_resolve_remediation_generation_eligibility_fallback_on_unfrozen_diagnosis(self):
        db = MagicMock()
        db.query.return_value.filter_by.return_value.order_by.return_value.first.return_value = None

        inv = Intervention(
            intervention_id=1,
            student_id="367cb3f4-8c92-4c69-8a62-eea21d0d3f2a",
            class_id=101,
            subject_id=101,
            academic_period_id=2,
            diagnosis_snapshot={"risk_score": 0.88, "identified_weakness": "Reading"},
            activated_at=datetime(2026, 10, 24, 18, 0, tzinfo=timezone.utc),
        )

        result = resolve_remediation_generation_eligibility(db, inv)
        self.assertIn("original_evidence_cutoff_at", result)
        self.assertIn("active_remediation_cutoff_at", result)
        self.assertIn("eligible_taught_lessons", result)
        self.assertIn("blocked_lessons", result)
        self.assertEqual(result["eligible_taught_lessons"], [])
        self.assertEqual(result["blocked_lessons"], [])
        self.assertFalse(result["refresh_available"])

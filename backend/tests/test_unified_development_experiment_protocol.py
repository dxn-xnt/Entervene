from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from app.ml import RunUnifiedDevelopmentExperiment as exp


def test_u4b_dataset_contract_and_feature_isolation():
    _, dev, verification = exp.validate_inputs()

    assert verification["dataset_sha256"] == exp.EXPECTED_DATASET_SHA256
    assert verification["row_count"] == 9294
    assert verification["development_rows"] == 7971
    assert verification["frozen_rows_excluded_only"] == 1323
    assert verification["maximum_raw_candidate_features"] == 39
    assert verification["target_isolated"] is True
    assert verification["metadata_isolated"] is True
    assert verification["mapeh_absent"] is True
    assert verification["dev_frozen_learner_overlap"] == 0
    assert "MAPEH" not in set(dev["subject_meta"])

    all_features = set(exp.FEATURE_SETS["F2"])
    assert exp.TARGET_COLUMN not in all_features
    assert not (all_features & exp.METADATA_COLUMNS)
    assert "snapshot_fraction" not in all_features
    assert "period_sequence" not in all_features


def test_u4b_cv_groups_are_learner_and_cohort_safe():
    _, dev, _ = exp.validate_inputs()
    _, _, folds = exp.cv_splits(dev)

    assert len(folds) == 5
    assert all(fold["learner_overlap"] == 0 for fold in folds)
    assert all(fold["cohort_overlap"] == 0 for fold in folds)


def test_u4b_lock_guard_contract_if_lock_exists():
    lock_path = exp.EXPERIMENT_DIR / "candidate_lock.json"
    if not lock_path.exists():
        pytest.skip("candidate_lock.json is created by the U4B experiment runner")

    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    assert lock["lock_type"].startswith("UNIFIED_CURRENT_TERM_V1_CANDIDATE_LOCK")
    assert lock["frozen_test_evaluated"] is False
    assert lock["dataset_sha256"] == exp.EXPECTED_DATASET_SHA256
    assert lock["selected_feature_set"] in {"F1", "F2"}
    assert lock["missingness_strategy"] in {"M1", "M2", "M3"}
    summary_path = Path(lock.get("development_summary_path") or lock["reconciliation_report_path"])
    if not summary_path.exists():
        summary_path = BACKEND_DIR.parent / summary_path
    assert summary_path.exists()

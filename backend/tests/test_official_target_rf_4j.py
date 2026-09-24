import pandas as pd

from app.ml.BuildCurrentTermDevelopmentDataset import FEATURE_COLUMNS
from app.ml.CharacterizeOfficialTargetRF4J import feature_groups, replay_readiness
from app.services.prediction.CurrentPeriodFeatureBuilderService import check_current_period_readiness


def test_feature_groups_cover_each_model_feature_once():
    grouped = [feature for members in feature_groups().values() for feature in members]
    assert len(grouped) == len(FEATURE_COLUMNS) == 31
    assert set(grouped) == set(FEATURE_COLUMNS)
    assert "subject" in feature_groups()["CONTEXT_WEIGHTS"]
    assert "overall_partial_percent" in feature_groups()["AGGREGATE_COVERAGE"]


def test_readiness_replay_uses_runtime_predicate_not_snapshot_label():
    rows = []
    for stage, activities in ((0.25, 3), (0.5, 4), (0.75, 7)):
        rows.append({"student_period_key": "synthetic-period", "source_file": "synthetic.xlsx",
                     "subject": "ENGLISH", "grade_level": 7.0, "snapshot_fraction": stage,
                     "overall_available_activity_count": activities,
                     "ww_has_evidence": 1.0, "pt_has_evidence": 1.0,
                     "qa_has_evidence": float(stage == 0.75),
                     "observed_component_weight_sum": 100.0 if stage == 0.75 else 70.0})
    replayed, report = replay_readiness(pd.DataFrame(rows))
    assert replayed.runtime_feature_ready.tolist() == [False, True, True]
    assert report["first_ready_stage_periods"] == {"0.5": 1}
    assert report["latest_ready_stage_periods"] == {"0.75": 1}
    assert report["not_ready_reasons"] == {"INSUFFICIENT_AVAILABLE_ACTIVITIES": 1}
    assert check_current_period_readiness(rows[2], unresolved_evidence=True)["ready"] is False

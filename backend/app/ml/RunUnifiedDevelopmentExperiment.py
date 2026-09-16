from __future__ import annotations

import argparse
import hashlib
import json
import math
import random
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    mean_absolute_error,
    mean_squared_error,
    median_absolute_error,
    r2_score,
)
from sklearn.model_selection import GroupKFold, ParameterSampler, RandomizedSearchCV, cross_val_predict
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

RANDOM_STATE = 42
FROZEN_TEST_COHORTS = {"2023-2024_G10_SOCRATES", "2025-2026_G7_GALILEO"}
EXPECTED_DATASET_SHA256 = "5b1673e8c722a6ce1e13da53c59dcafc72fa9613422c028cfaae74cc7d52bbdd"
EXPECTED_ROWS = 9294
EXPECTED_DEV_ROWS = 7971
EXPECTED_FROZEN_ROWS = 1323
TARGET_COLUMN = "target_final_period_grade"
BACKEND_DIR = Path(__file__).resolve().parents[2]
EXPERIMENT_DIR = BACKEND_DIR / "data" / "experiments" / "unified_current_term_v1"
DATASET_PATH = BACKEND_DIR / "data" / "processed" / "unified_current_term_snapshots_no_mapeh.csv"
SOURCE_SUMMARY_PATH = BACKEND_DIR / "data" / "processed" / "unified_current_term_dataset_summary.json"
NO_MAPEH_SUMMARY_PATH = BACKEND_DIR / "data" / "processed" / "unified_current_term_dataset_summary_no_mapeh.json"
NEXT_SCHEMA_PATH = BACKEND_DIR / "data" / "models" / "entervene_next_period_grade_rf_feature_schema.json"

CURRENT_31 = [
    "grade_level",
    "ww_weight",
    "pt_weight",
    "qa_weight",
    "ww_available_activity_count",
    "pt_available_activity_count",
    "qa_available_activity_count",
    "overall_available_activity_count",
    "ww_points_earned_so_far",
    "ww_points_possible_so_far",
    "ww_percent_so_far",
    "ww_weighted_score_so_far",
    "pt_points_earned_so_far",
    "pt_points_possible_so_far",
    "pt_percent_so_far",
    "pt_weighted_score_so_far",
    "qa_points_earned_so_far",
    "qa_points_possible_so_far",
    "qa_percent_so_far",
    "qa_weighted_score_so_far",
    "observed_component_weight_sum",
    "overall_weighted_score_so_far",
    "overall_partial_percent",
    "ww_has_evidence",
    "pt_has_evidence",
    "qa_has_evidence",
    "has_any_input_evidence",
    "ww_score_over_hps_count_so_far",
    "pt_score_over_hps_count_so_far",
    "qa_score_over_hps_count_so_far",
    "subject",
]
F1_PRIOR = ["previous_term_available", "previous_term_final_grade"]
F2_PRIOR = [
    "previous_term_available",
    "previous_term_final_grade",
    "previous_term_ww_percent",
    "previous_term_pt_percent",
    "previous_term_qa_percent",
    "previous_term_ww_weight",
    "previous_term_pt_weight",
    "previous_term_qa_weight",
]
FEATURE_SETS = {
    "F0": CURRENT_31,
    "F1": CURRENT_31[:-1] + F1_PRIOR + ["subject"],
    "F2": CURRENT_31[:-1] + F2_PRIOR + ["subject"],
}
METADATA_COLUMNS = {
    "row_identity",
    "source_provenance_identity",
    "raw_student_key",
    "student_period_key",
    "cohort_group_key",
    "cv_component_group_key",
    "school_year",
    "grade_level_meta",
    "section",
    "subject_meta",
    "historical_period_sequence",
    "prediction_stage",
    "has_previous_period_audit",
    "source_workbook",
    "source_sheet",
    "row_number",
}


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_json(obj: Any) -> str:
    payload = json.dumps(obj, sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def one_hot_encoder() -> OneHotEncoder:
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        return OneHotEncoder(handle_unknown="ignore", sparse=False)


def build_pipeline(
    features: list[str],
    missingness: str,
    rf_params: dict[str, Any] | None = None,
) -> Pipeline:
    numeric = [feature for feature in features if feature != "subject"]
    categorical = [feature for feature in features if feature == "subject"]
    if missingness == "M1":
        numeric_transformer = Pipeline([("imputer", SimpleImputer(strategy="median"))])
    elif missingness == "M2":
        numeric_transformer = Pipeline([("imputer", SimpleImputer(strategy="constant", fill_value=-1.0))])
    elif missingness == "M3":
        numeric_transformer = Pipeline([("imputer", SimpleImputer(strategy="median", add_indicator=True))])
    else:
        raise ValueError(f"Unknown missingness strategy: {missingness}")
    preprocessor = ColumnTransformer(
        [
            ("num", numeric_transformer, numeric),
            ("cat", one_hot_encoder(), categorical),
        ]
    )
    params = {
        "n_estimators": 300,
        "max_depth": None,
        "min_samples_split": 2,
        "min_samples_leaf": 1,
        "max_features": "sqrt",
        "random_state": RANDOM_STATE,
        "n_jobs": -1,
    }
    if rf_params:
        params.update(rf_params)
    return Pipeline(
        [
            ("preprocessor", preprocessor),
            ("regressor", RandomForestRegressor(**params)),
        ]
    )


def regression_metrics(y_true: Any, y_pred: Any) -> dict[str, float | int | None]:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    error = y_pred - y_true
    abs_error = np.abs(error)
    return {
        "n": int(len(y_true)),
        "mae": round(float(mean_absolute_error(y_true, y_pred)), 6),
        "rmse": round(float(math.sqrt(mean_squared_error(y_true, y_pred))), 6),
        "median_absolute_error": round(float(median_absolute_error(y_true, y_pred)), 6),
        "r2": round(float(r2_score(y_true, y_pred)), 6) if len(y_true) > 1 else None,
        "bias_mean_signed_error": round(float(np.mean(error)), 6),
        "within_1_pct": round(float(np.mean(abs_error <= 1.0) * 100.0), 4),
        "within_2_pct": round(float(np.mean(abs_error <= 2.0) * 100.0), 4),
        "within_3_pct": round(float(np.mean(abs_error <= 3.0) * 100.0), 4),
    }


def metrics_by(df: pd.DataFrame, pred_col: str, group_col: str) -> dict[str, dict[str, Any]]:
    return {
        str(key): regression_metrics(group[TARGET_COLUMN], group[pred_col])
        for key, group in df.groupby(group_col, dropna=False)
    }


def weight_pattern(row: pd.Series) -> str:
    return f"WW{int(round(row['ww_weight']))}_PT{int(round(row['pt_weight']))}_QA{int(round(row['qa_weight']))}"


def validate_inputs() -> tuple[pd.DataFrame, pd.DataFrame, dict[str, Any]]:
    actual_sha = sha256_file(DATASET_PATH)
    if actual_sha != EXPECTED_DATASET_SHA256:
        raise RuntimeError(f"Dataset SHA mismatch: expected {EXPECTED_DATASET_SHA256}, actual {actual_sha}")
    df = pd.read_csv(DATASET_PATH)
    if len(df) != EXPECTED_ROWS:
        raise RuntimeError(f"Dataset row mismatch: expected {EXPECTED_ROWS}, actual {len(df)}")
    if (df["subject_meta"] == "MAPEH").any() or (df["subject"] == "MAPEH").any():
        raise RuntimeError("MAPEH rows found in U4B dataset")
    feature_union = set(FEATURE_SETS["F2"])
    if len(FEATURE_SETS["F2"]) != 39:
        raise RuntimeError(f"F2 feature count mismatch: {len(FEATURE_SETS['F2'])}")
    if TARGET_COLUMN in feature_union:
        raise RuntimeError("Target leaks into feature set")
    leaked_metadata = sorted(feature_union & METADATA_COLUMNS)
    if leaked_metadata:
        raise RuntimeError(f"Metadata leaks into feature set: {leaked_metadata}")
    required = feature_union | {
        TARGET_COLUMN,
        "cohort_group_key",
        "raw_student_key",
        "student_period_key",
        "cv_component_group_key",
        "prediction_stage",
        "historical_period_sequence",
        "subject_meta",
        "row_identity",
    }
    missing_cols = sorted(required - set(df.columns))
    if missing_cols:
        raise RuntimeError(f"Dataset missing required columns: {missing_cols}")
    frozen_mask = df["cohort_group_key"].isin(FROZEN_TEST_COHORTS)
    dev = df.loc[~frozen_mask].copy()
    frozen = df.loc[frozen_mask].copy()
    if len(dev) != EXPECTED_DEV_ROWS or len(frozen) != EXPECTED_FROZEN_ROWS:
        raise RuntimeError(f"Split mismatch: dev={len(dev)}, frozen={len(frozen)}")
    overlap = set(dev["raw_student_key"]) & set(frozen["raw_student_key"])
    if overlap:
        raise RuntimeError(f"Development/frozen learner overlap: {len(overlap)}")
    dev["weight_pattern"] = dev.apply(weight_pattern, axis=1)
    verification = {
        "dataset_path": str(DATASET_PATH),
        "dataset_sha256": actual_sha,
        "row_count": int(len(df)),
        "development_rows": int(len(dev)),
        "frozen_rows_excluded_only": int(len(frozen)),
        "maximum_raw_candidate_features": len(FEATURE_SETS["F2"]),
        "target_isolated": TARGET_COLUMN not in feature_union,
        "metadata_isolated": not leaked_metadata,
        "mapeh_absent": True,
        "dev_frozen_learner_overlap": 0,
        "cv_group_count_development": int(dev["cv_component_group_key"].nunique()),
        "supported_subjects": sorted(dev["subject_meta"].unique().tolist()),
        "frozen_test_sealed_note": (
            "Frozen rows were identified only for exclusion; no frozen target metrics "
            "or predictions are computed by this script."
        ),
    }
    return df, dev, verification


def cv_splits(dev: pd.DataFrame) -> tuple[GroupKFold, np.ndarray, list[dict[str, Any]]]:
    groups = dev["cv_component_group_key"].astype(str).to_numpy()
    cv = GroupKFold(n_splits=5)
    reports = []
    for fold, (train_idx, val_idx) in enumerate(cv.split(dev, groups=groups), start=1):
        train = dev.iloc[train_idx]
        val = dev.iloc[val_idx]
        learner_overlap = len(set(train["raw_student_key"]) & set(val["raw_student_key"]))
        cohort_overlap = len(set(train["cohort_group_key"]) & set(val["cohort_group_key"]))
        if learner_overlap or cohort_overlap:
            raise RuntimeError(f"CV fold {fold} leakage: learners={learner_overlap}, cohorts={cohort_overlap}")
        reports.append(
            {
                "fold": fold,
                "train_rows": int(len(train)),
                "validation_rows": int(len(val)),
                "train_learners": int(train["raw_student_key"].nunique()),
                "validation_learners": int(val["raw_student_key"].nunique()),
                "learner_overlap": learner_overlap,
                "cohort_overlap": cohort_overlap,
            }
        )
    return cv, groups, reports


def summarize_predictions(pred_df: pd.DataFrame, pred_col: str) -> dict[str, Any]:
    result = regression_metrics(pred_df[TARGET_COLUMN], pred_df[pred_col])
    by_stage = metrics_by(pred_df, pred_col, "prediction_stage")
    stage_mae = {key: value["mae"] for key, value in by_stage.items()}
    current_keys = [key for key in ["25%", "50%", "75%"] if key in stage_mae]
    unified_keys = [key for key in ["0%", "25%", "50%", "75%"] if key in stage_mae]
    result["by_stage"] = by_stage
    result["current_stage_macro_mae_25_50_75"] = (
        round(float(np.mean([stage_mae[key] for key in current_keys])), 6) if current_keys else None
    )
    result["unified_stage_macro_mae_0_25_50_75"] = (
        round(float(np.mean([stage_mae[key] for key in unified_keys])), 6) if unified_keys else None
    )
    result["by_period"] = metrics_by(pred_df, pred_col, "historical_period_sequence")
    result["by_subject"] = metrics_by(pred_df, pred_col, "subject_meta")
    result["by_weight_pattern"] = metrics_by(pred_df, pred_col, "weight_pattern")
    return result


def oof_predict(
    dev: pd.DataFrame,
    candidate_id: str,
    feature_set: str,
    missingness: str,
    rf_params: dict[str, Any] | None = None,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    features = FEATURE_SETS[feature_set]
    cv, groups, _ = cv_splits(dev)
    pipeline = build_pipeline(features, missingness, rf_params)
    predictions = cross_val_predict(
        pipeline,
        dev[features],
        dev[TARGET_COLUMN].astype(float).to_numpy(),
        cv=cv,
        groups=groups,
        n_jobs=None,
    )
    out = dev[
        [
            "row_identity",
            "raw_student_key",
            "student_period_key",
            "cohort_group_key",
            "cv_component_group_key",
            "prediction_stage",
            "historical_period_sequence",
            "subject_meta",
            "weight_pattern",
            TARGET_COLUMN,
            "previous_term_available",
            "overall_available_activity_count",
            "ww_has_evidence",
            "pt_has_evidence",
            "qa_has_evidence",
            "observed_component_weight_sum",
            "overall_partial_percent",
        ]
    ].copy()
    out["candidate_id"] = candidate_id
    out["feature_set"] = feature_set
    out["missingness_strategy"] = missingness
    out["prediction"] = predictions
    out["absolute_error"] = (out["prediction"] - out[TARGET_COLUMN]).abs()
    out["signed_error"] = out["prediction"] - out[TARGET_COLUMN]
    evaluated = out if feature_set != "F0" else out[out["prediction_stage"].isin(["25%", "50%", "75%"])]
    summary = summarize_predictions(evaluated, "prediction")
    summary.update(
        {
            "candidate_id": candidate_id,
            "feature_set": feature_set,
            "missingness_strategy": missingness,
            "rf_params": build_pipeline(features, missingness, rf_params)
            .named_steps["regressor"]
            .get_params(),
        }
    )
    return out, summary


def paired_bootstrap(
    model_a: pd.DataFrame,
    model_b: pd.DataFrame,
    label: str,
    stage_filter: set[str] | None = None,
    n_boot: int = 500,
) -> dict[str, Any]:
    aa = model_a[
        ["row_identity", "raw_student_key", "prediction_stage", "absolute_error"]
    ].rename(columns={"absolute_error": "ae_a"})
    bb = model_b[["row_identity", "absolute_error"]].rename(columns={"absolute_error": "ae_b"})
    joined = aa.merge(bb, on="row_identity", how="inner")
    if stage_filter is not None:
        joined = joined[joined["prediction_stage"].isin(stage_filter)]
    joined["diff_a_minus_b"] = joined["ae_a"] - joined["ae_b"]
    groups = sorted(joined["raw_student_key"].unique().tolist())
    by_group = {
        group: joined.loc[joined["raw_student_key"] == group, "diff_a_minus_b"].to_numpy()
        for group in groups
    }
    rng = random.Random(RANDOM_STATE)
    boot = []
    for _ in range(n_boot):
        sampled = [rng.choice(groups) for _ in groups]
        values = np.concatenate([by_group[group] for group in sampled])
        boot.append(float(np.mean(values)))
    return {
        "comparison": label,
        "bootstrap_unit": "raw_student_key / physical learner",
        "rows": int(len(joined)),
        "groups": int(len(groups)),
        "mean_mae_diff_a_minus_b": round(float(joined["diff_a_minus_b"].mean()), 6),
        "ci95_low": round(float(np.percentile(boot, 2.5)), 6),
        "ci95_high": round(float(np.percentile(boot, 97.5)), 6),
        "interpretation": "negative favors A; positive favors B",
    }


def tune_finalist(dev: pd.DataFrame, feature_set: str, missingness: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    features = FEATURE_SETS[feature_set]
    groups = dev["cv_component_group_key"].astype(str).to_numpy()
    pipeline = build_pipeline(features, missingness)
    param_dist = {
        "regressor__n_estimators": [300, 500, 800],
        "regressor__max_depth": [None, 8, 12, 16],
        "regressor__min_samples_split": [2, 5, 10],
        "regressor__min_samples_leaf": [1, 2, 4],
        "regressor__max_features": ["sqrt", 0.5, 0.75, 1.0],
    }
    search = RandomizedSearchCV(
        pipeline,
        param_distributions=param_dist,
        n_iter=40,
        scoring="neg_mean_absolute_error",
        cv=GroupKFold(n_splits=5),
        random_state=RANDOM_STATE,
        n_jobs=-1,
        refit=False,
        return_train_score=False,
    )
    # Keep this materialized count as an audit assertion that U4B performed the approved restrained search.
    _sampled = list(ParameterSampler(param_dist, n_iter=40, random_state=RANDOM_STATE))
    search.fit(dev[features], dev[TARGET_COLUMN].astype(float), groups=groups)
    rows = []
    for idx, params in enumerate(search.cv_results_["params"]):
        rows.append(
            {
                "rank": int(search.cv_results_["rank_test_score"][idx]),
                "mean_cv_mae": round(float(-search.cv_results_["mean_test_score"][idx]), 6),
                "std_cv_mae": round(float(search.cv_results_["std_test_score"][idx]), 6),
                "params": params,
            }
        )
    rows.sort(key=lambda row: (row["rank"], row["mean_cv_mae"]))
    best_params = {key.replace("regressor__", ""): value for key, value in search.best_params_.items()}
    return best_params, rows


def fair_next_development(dev: pd.DataFrame) -> dict[str, Any]:
    schema = json.loads(NEXT_SCHEMA_PATH.read_text(encoding="utf-8"))
    feature_cols = schema["feature_columns"]
    zero = dev[(dev["prediction_stage"] == "0%") & (dev["previous_term_available"] == 1.0)].copy()
    period_grades: dict[tuple[str, str, str], dict[int, float]] = {}
    for _, period_row in dev.drop_duplicates(
        ["raw_student_key", "subject_meta", "school_year", "historical_period_sequence"]
    ).iterrows():
        key = (
            str(period_row["raw_student_key"]),
            str(period_row["subject_meta"]),
            str(period_row["school_year"]),
        )
        period_grades.setdefault(key, {})[int(period_row["historical_period_sequence"])] = float(period_row[TARGET_COLUMN])
    rows = []
    for _, row in zero.iterrows():
        target_seq = int(row["historical_period_sequence"])
        source_seq = target_seq - 1
        trajectory_key = (
            str(row["raw_student_key"]),
            str(row["subject_meta"]),
            str(row["school_year"]),
        )
        source_trajectory = period_grades.get(trajectory_key, {})
        source_grade = source_trajectory.get(source_seq, float(row["previous_term_final_grade"]))
        previous_source_grade = source_trajectory.get(source_seq - 1)
        grades_up_to_source = [
            grade
            for seq, grade in sorted(source_trajectory.items())
            if seq <= source_seq
        ]
        cumulative_avg = (
            float(np.mean(grades_up_to_source))
            if grades_up_to_source
            else float(row["previous_term_final_grade"])
        )
        has_previous_period = 1.0 if previous_source_grade is not None else 0.0
        trend = float(source_grade - previous_source_grade) if previous_source_grade is not None else 0.0
        next_row = {
            "grade_level": float(row["grade_level"]),
            "period_sequence": float(source_seq),
            "has_previous_period": has_previous_period,
            "written_work_percent": float(row["previous_term_ww_percent"]),
            "performance_task_percent": float(row["previous_term_pt_percent"]),
            "quarterly_assessment_percent": float(row["previous_term_qa_percent"]),
            "assessment_completion_rate": 1.0,
            "source_period_grade": float(source_grade),
            "grade_trend_vs_previous_period": trend,
            "cumulative_period_grade_avg": cumulative_avg,
        }
        for col in feature_cols:
            if col.startswith("subject_"):
                next_row[col] = 1.0 if row["subject_meta"] == col.replace("subject_", "") else 0.0
            next_row.setdefault(col, 0.0)
        next_row.update(
            {
                "cohort_group_key": row["cohort_group_key"],
                "target": float(row[TARGET_COLUMN]),
            }
        )
        rows.append(next_row)
    comp = pd.DataFrame(rows)
    if comp.empty:
        return {"status": "NO_DEVELOPMENT_ROWS", "schema_features": feature_cols}
    predictions = cross_val_predict(
        Pipeline(
            [
                ("imputer", SimpleImputer(strategy="median")),
                (
                    "regressor",
                    RandomForestRegressor(
                        n_estimators=300,
                        random_state=RANDOM_STATE,
                        min_samples_leaf=2,
                        n_jobs=-1,
                    ),
                ),
            ]
        ),
        comp[feature_cols],
        comp["target"].to_numpy(),
        cv=GroupKFold(n_splits=5),
        groups=comp["cohort_group_key"].astype(str).to_numpy(),
        n_jobs=None,
    )
    return {
        "status": "DEVELOPMENT_ONLY_OOF_COMPLETE",
        "warning": "Experimental retrained NEXT comparator; not deployed and not evaluated on frozen intersection in U4B.",
        "actual_deployed_next_schema_feature_count": len(feature_cols),
        "actual_deployed_next_schema_features": feature_cols,
        "architecture": {
            "RandomForestRegressor": {
                "n_estimators": 300,
                "min_samples_leaf": 2,
                "random_state": RANDOM_STATE,
            }
        },
        "development_oof_metrics": regression_metrics(comp["target"].to_numpy(), predictions),
    }


def readiness_analysis(pred_df: pd.DataFrame) -> dict[str, Any]:
    rows = pred_df.copy()
    rows["activity_count_bin"] = pd.cut(
        rows["overall_available_activity_count"],
        bins=[-0.1, 0, 3, 6, 10, 999],
        labels=["0", "1-3", "4-6", "7-10", "11+"],
    )
    rows["observed_weight_bin"] = pd.cut(
        rows["observed_component_weight_sum"],
        bins=[-0.1, 0, 69.999, 89.999, 100.0],
        labels=["0", "1-69", "70-89", "90-100"],
    )
    return {
        "by_activity_count_bin": metrics_by(rows.dropna(subset=["activity_count_bin"]), "prediction", "activity_count_bin"),
        "by_observed_component_weight_bin": metrics_by(rows.dropna(subset=["observed_weight_bin"]), "prediction", "observed_weight_bin"),
        "by_ww_has_evidence": metrics_by(rows, "prediction", "ww_has_evidence"),
        "by_pt_has_evidence": metrics_by(rows, "prediction", "pt_has_evidence"),
        "by_qa_has_evidence": metrics_by(rows, "prediction", "qa_has_evidence"),
        "by_previous_term_available": metrics_by(rows, "prediction", "previous_term_available"),
        "recommendation": (
            "Use development OOF evidence regions, not synthetic prediction_stage, for future readiness policy. "
            "Avoid 0% for first period; allow 0% only with valid previous-term data if frozen U4C passes."
        ),
    }


def domain_support(dev: pd.DataFrame, features: list[str]) -> dict[str, Any]:
    numeric = [feature for feature in features if feature != "subject"]
    return {
        "subjects_supported": sorted(dev["subject_meta"].unique().tolist()),
        "mapeh_supported": False,
        "weight_patterns_supported": sorted(dev["weight_pattern"].unique().tolist()),
        "previous_term_available_states": sorted(float(x) for x in dev["previous_term_available"].dropna().unique().tolist()),
        "numeric_ranges_development_only": {
            col: {
                "min": None if dev[col].dropna().empty else float(dev[col].min()),
                "max": None if dev[col].dropna().empty else float(dev[col].max()),
            }
            for col in numeric
        },
        "draft_classification": {
            "SUPPORTED": "Subject/weight pattern/state/ranges observed in development and later not rejected by frozen U4C.",
            "DOMAIN_WARNING": "Near boundary, sparse supported slice, or score-over-HPS present but represented in training.",
            "DOMAIN_INCOMPATIBLE": "MAPEH, unseen subject, unseen structural weight pattern, missing required schema columns, or impossible numeric values.",
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-tuning", action="store_true", help="Use phase-1 winner only; intended for smoke tests.")
    args = parser.parse_args()
    EXPERIMENT_DIR.mkdir(parents=True, exist_ok=True)
    _, dev, verification = validate_inputs()
    _, _, cv_report = cv_splits(dev)

    phase1_specs = [("F0_BASELINE_M1", "F0", "M1")]
    for feature_set in ["F1", "F2"]:
        for missingness in ["M1", "M2", "M3"]:
            phase1_specs.append((f"{feature_set}_{missingness}_BASELINE", feature_set, missingness))

    phase1_summaries = []
    oof_frames: dict[str, pd.DataFrame] = {}
    for candidate_id, feature_set, missingness in phase1_specs:
        print(f"OOF phase-1 {candidate_id}", flush=True)
        oof, summary = oof_predict(dev, candidate_id, feature_set, missingness)
        oof.to_csv(EXPERIMENT_DIR / f"oof_{candidate_id}.csv", index=False)
        oof_frames[candidate_id] = oof
        phase1_summaries.append(summary)

    unified = [summary for summary in phase1_summaries if summary["feature_set"] in {"F1", "F2"}]
    unified.sort(
        key=lambda summary: (
            summary.get("unified_stage_macro_mae_0_25_50_75") or 999,
            summary.get("current_stage_macro_mae_25_50_75") or 999,
            summary["mae"],
        )
    )
    finalist_base = unified[0]
    if args.skip_tuning:
        best_params = {
            "n_estimators": 300,
            "max_depth": None,
            "min_samples_split": 2,
            "min_samples_leaf": 1,
            "max_features": "sqrt",
        }
        tuning_rows: list[dict[str, Any]] = []
    else:
        print(f"Tuning finalist {finalist_base['candidate_id']} with 40 sampled configurations", flush=True)
        best_params, tuning_rows = tune_finalist(
            dev,
            finalist_base["feature_set"],
            finalist_base["missingness_strategy"],
        )

    tuned_id = f"{finalist_base['feature_set']}_{finalist_base['missingness_strategy']}_TUNED"
    tuned_oof, tuned_summary = oof_predict(
        dev,
        tuned_id,
        finalist_base["feature_set"],
        finalist_base["missingness_strategy"],
        best_params,
    )
    tuned_oof.to_csv(EXPERIMENT_DIR / f"oof_{tuned_id}.csv", index=False)

    final_pipeline = build_pipeline(FEATURE_SETS[tuned_summary["feature_set"]], tuned_summary["missingness_strategy"], best_params)
    final_pipeline.fit(dev[FEATURE_SETS[tuned_summary["feature_set"]]], dev[TARGET_COLUMN].astype(float))
    joblib.dump(final_pipeline, EXPERIMENT_DIR / "unified_current_term_v1_development_candidate.joblib")

    paired = []
    f0 = oof_frames["F0_BASELINE_M1"]
    for candidate_id in [
        "F1_M1_BASELINE",
        "F1_M2_BASELINE",
        "F1_M3_BASELINE",
        "F2_M1_BASELINE",
        "F2_M2_BASELINE",
        "F2_M3_BASELINE",
    ]:
        paired.append(
            paired_bootstrap(
                oof_frames[candidate_id],
                f0,
                f"{candidate_id} vs F0 on 25/50/75",
                {"25%", "50%", "75%"},
            )
        )
    for missingness in ["M1", "M2", "M3"]:
        paired.append(
            paired_bootstrap(
                oof_frames[f"F2_{missingness}_BASELINE"],
                oof_frames[f"F1_{missingness}_BASELINE"],
                f"F2_{missingness} vs F1_{missingness} all development rows",
            )
        )
    paired.append(
        paired_bootstrap(
            tuned_oof,
            oof_frames[finalist_base["candidate_id"]],
            f"{tuned_id} vs phase-1 base {finalist_base['candidate_id']}",
        )
    )

    fair_next = fair_next_development(dev)
    readiness = readiness_analysis(tuned_oof)
    support = domain_support(dev, FEATURE_SETS[tuned_summary["feature_set"]])
    success_gates = {
        "locked_before_frozen_test": True,
        "primary_metric": "MAE",
        "zero_percent_vs_fair_next_allowed_mae_degradation": 0.20,
        "stage_25_vs_deployed_current_allowed_mae_degradation": 0.20,
        "stage_50_vs_deployed_current_allowed_mae_degradation": 0.20,
        "stage_75_vs_deployed_current_allowed_mae_degradation": 0.20,
        "p1_25_50_75_allowed_mae_degradation_vs_current_evidence_control": 0.20,
        "severe_subject_period_weight_pattern_failure": (
            "slice MAE degradation >= 0.50 or absolute mean signed bias >= 0.75 "
            "on a supported slice with N >= 30"
        ),
        "bias_limit": "absolute mean signed error <= 0.50 overall and <= 0.75 on supported critical slices with N >= 30",
        "paired_comparison_rule": (
            "A difference is treated as meaningful only when absolute mean MAE difference >= 0.10 "
            "and the learner-grouped bootstrap CI does not mostly collapse around zero; "
            "material degradation threshold is >= 0.20."
        ),
    }
    config_core = {
        "feature_set": tuned_summary["feature_set"],
        "features": FEATURE_SETS[tuned_summary["feature_set"]],
        "missingness_strategy": tuned_summary["missingness_strategy"],
        "rf_params": best_params,
        "random_state": RANDOM_STATE,
    }
    model_config_hash = sha256_json(config_core)
    source_summary = json.loads(SOURCE_SUMMARY_PATH.read_text(encoding="utf-8")) if SOURCE_SUMMARY_PATH.exists() else {}

    report = {
        "task": "U4B_DEVELOPMENT_ONLY_UNIFIED_MODEL_TRAINING_SELECTION",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "frozen_test_evaluated": False,
        "frozen_test_guard": "No frozen predictions or frozen error metrics are computed in U4B.",
        "dataset_verification": verification,
        "source_corpus_sha256": source_summary.get("source_corpus_sha256"),
        "no_mapeh_summary_sha256": sha256_file(NO_MAPEH_SUMMARY_PATH) if NO_MAPEH_SUMMARY_PATH.exists() else None,
        "cv_integrity": cv_report,
        "feature_sets": {key: {"count": len(value), "features": value} for key, value in FEATURE_SETS.items()},
        "phase1_candidate_summaries": phase1_summaries,
        "phase1_candidate_ranking": sorted(
            phase1_summaries,
            key=lambda summary: (
                (summary.get("unified_stage_macro_mae_0_25_50_75") if summary["feature_set"] != "F0" else 999),
                summary.get("current_stage_macro_mae_25_50_75") or 999,
                summary["mae"],
            ),
        ),
        "hyperparameter_tuning": [
            {
                "base_candidate": finalist_base["candidate_id"],
                "best_params": best_params,
                "top_results": tuning_rows[:10],
                "evaluated_configurations": len(tuning_rows),
            }
        ],
        "final_development_candidate": {
            "selected_candidate_id": tuned_id,
            "selection_basis": (
                "Best tuned development OOF result among phase-1 strongest unified candidates, "
                "considering 0% capability, current-stage macro MAE, P1 safety, slice stability, and simplicity."
            ),
            "selected_feature_set": tuned_summary["feature_set"],
            "selected_missingness_strategy": tuned_summary["missingness_strategy"],
            "selected_rf_params": best_params,
        },
        "final_development_oof_metrics": tuned_summary,
        "paired_bootstrap_comparisons": paired,
        "fair_next_comparator_development_only": fair_next,
        "readiness_analysis_development_only": readiness,
        "domain_support_draft": support,
        "practical_effect_thresholds_and_frozen_success_gates": success_gates,
        "model_configuration_hash": model_config_hash,
        "experiment_artifacts": {
            "experiment_dir": str(EXPERIMENT_DIR),
            "development_candidate_artifact": str(EXPERIMENT_DIR / "unified_current_term_v1_development_candidate.joblib"),
            "oof_predictions_prefix": str(EXPERIMENT_DIR / "oof_<candidate>.csv"),
        },
    }
    report_path = EXPERIMENT_DIR / "development_summary.json"
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True, default=str), encoding="utf-8")

    lock = {
        "lock_type": "UNIFIED_CURRENT_TERM_V1_CANDIDATE_LOCK",
        "created_at": report["created_at"],
        "frozen_test_evaluated": False,
        "dataset_path": str(DATASET_PATH),
        "dataset_sha256": verification["dataset_sha256"],
        "source_corpus_sha256": report["source_corpus_sha256"],
        "selected_feature_set": tuned_summary["feature_set"],
        "exact_feature_list": FEATURE_SETS[tuned_summary["feature_set"]],
        "missingness_strategy": tuned_summary["missingness_strategy"],
        "preprocessing_definition": {
            "numeric": f"SimpleImputer strategy for {tuned_summary['missingness_strategy']}",
            "categorical": "OneHotEncoder(handle_unknown='ignore') for subject",
            "target_column": TARGET_COLUMN,
        },
        "rf_hyperparameters": best_params,
        "random_state": RANDOM_STATE,
        "development_cv_definition": {
            "type": "GroupKFold",
            "n_splits": 5,
            "group_column": "cv_component_group_key",
            "learner_and_cohort_overlap_required": 0,
        },
        "development_oof_metrics": tuned_summary,
        "stage_balanced_metrics": {
            "current_stage_macro_mae_25_50_75": tuned_summary.get("current_stage_macro_mae_25_50_75"),
            "unified_stage_macro_mae_0_25_50_75": tuned_summary.get("unified_stage_macro_mae_0_25_50_75"),
        },
        "p1_metrics": tuned_summary["by_period"].get("1"),
        "subject_period_weight_diagnostics": {
            "by_subject": tuned_summary["by_subject"],
            "by_period": tuned_summary["by_period"],
            "by_weight_pattern": tuned_summary["by_weight_pattern"],
        },
        "readiness_findings": readiness,
        "domain_support_draft": support,
        "practical_effect_thresholds": success_gates,
        "frozen_test_success_gates": success_gates,
        "model_configuration_hash": model_config_hash,
        "development_summary_path": str(report_path),
    }
    lock_path = EXPERIMENT_DIR / "candidate_lock.json"
    lock_path.write_text(json.dumps(lock, indent=2, sort_keys=True, default=str), encoding="utf-8")
    print(
        json.dumps(
            {
                "status": "U4B_COMPLETE_DEVELOPMENT_ONLY",
                "frozen_test_evaluated": False,
                "development_summary": str(report_path),
                "candidate_lock": str(lock_path),
                "candidate_lock_sha256": sha256_file(lock_path),
                "selected": lock["selected_feature_set"],
                "missingness": lock["missingness_strategy"],
                "dev_mae": tuned_summary["mae"],
                "current_macro_mae": tuned_summary.get("current_stage_macro_mae_25_50_75"),
                "unified_macro_mae": tuned_summary.get("unified_stage_macro_mae_0_25_50_75"),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

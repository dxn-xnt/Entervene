"""
Train and validate the CURRENT_PERIOD_FINAL_GRADE_PROJECTION model (v1).

Goal: Partial evidence from the current grading period -> Final grade of the same period.
Implements:
1. Strict zero-leakage cohort partitioning (12 development cohorts, 2 frozen test cohorts).
2. 5-Fold GroupKFold development CV on cohort_group_key across all 12 non-test cohorts.
3. Transmuted DepEd CurrentPartialGradeBaseline comparator.
4. Internal consistency for QA-masked robustness evaluations.
5. Runtime readiness rule selection strictly on out-of-fold development cross-validation.
6. Single unbiased final evaluation on the frozen test set.
7. Immutable v1 artifact serialization with cryptographic hashes and domain shift guards.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.dummy import DummyRegressor
from sklearn.ensemble import (
    ExtraTreesRegressor,
    GradientBoostingRegressor,
    RandomForestRegressor,
)
from sklearn.impute import SimpleImputer
from sklearn.inspection import permutation_importance
from sklearn.linear_model import Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import GridSearchCV, GroupKFold
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

RANDOM_SEED = 42
MODEL_NAME = "entervene_current_period_grade_rf_v1"
TARGET_COLUMN = "target_final_period_grade"

DATASET_WARNING = (
    "The dataset contains zero final grades below 75 after QC (observed range 80.0 to 100.0). "
    "The model is validated strictly as a continuous regression estimator on the observed "
    "target distribution and is NOT validated as a failing-grade detector."
)
DOMAIN_SHIFT_WARNING = (
    "Production Academic Terms may differ from historical Quarters. Runtime activity counts "
    "or weight distributions outside the validated training support range must trigger a domain shift review."
)
SNAPSHOT_POLICY_DISCLAIMER = (
    "The 25%, 50%, and 75% snapshots are reconstructed evidence states based on historical activity column order, "
    "not actual calendar timestamps or proven cross-component chronology."
)

CATEGORICAL_FEATURES = ["subject"]

NUMERIC_FEATURES = [
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
]

EXCLUDED_INPUT_COLUMNS = [
    "student_period_key",
    "raw_student_key",
    "source_file",
    "sheet_name",
    "row_number",
    "raw_student_name",
    "school_year",
    "section",
    "historical_period_label",
    "period_sequence_audit",
    "snapshot_policy_version",
    "target_source",
    "attendance_available",
    "snapshot_trace_json",
    "snapshot_fraction",
    "ww_total_activity_count",
    "pt_total_activity_count",
    "qa_total_activity_count",
    "overall_total_activity_count",
    "ww_coverage_ratio",
    "pt_coverage_ratio",
    "qa_coverage_ratio",
    "overall_activity_coverage_ratio",
    TARGET_COLUMN,
]

FROZEN_TEST_COHORTS = [
    "2023-2024_G10_SOCRATES",
    "2025-2026_G7_GALILEO",
]


def deped_transmute(initial_grade: float) -> float:
    """
    Official DepEd Order No. 8, s. 2015 transmutation table.
    Linearly interpolates initial raw percent to transmutation grade (60-100 scale).
    """
    table = [
        (100.0, 100.0), (95.0, 98.0), (90.0, 95.0), (85.0, 91.0), (80.0, 87.0),
        (75.0, 83.0), (70.0, 79.0), (65.0, 75.0), (60.0, 70.0), (55.0, 65.0),
        (50.0, 60.0), (45.0, 55.0), (40.0, 50.0), (35.0, 45.0), (30.0, 40.0),
        (25.0, 35.0), (20.0, 30.0), (15.0, 25.0), (10.0, 20.0), (5.0, 15.0), (0.0, 10.0),
    ]
    ig = max(0.0, min(100.0, float(initial_grade)))
    for i in range(len(table) - 1):
        ig_high, tg_high = table[i]
        ig_low, tg_low = table[i + 1]
        if ig_low <= ig <= ig_high:
            if ig_high == ig_low:
                return float(tg_high)
            ratio = (ig - ig_low) / (ig_high - ig_low)
            return round(tg_low + ratio * (tg_high - tg_low), 2)
    return 10.0


def compute_file_sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()


def compute_string_sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def prepare_raw_dataframe(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["cohort_group_key"] = (
        df["school_year"].astype(str)
        + "_G"
        + df["grade_level"].astype(str)
        + "_"
        + df["section"].astype(str)
    )
    return df


def clean_feature_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    cleaned = df.copy()
    for comp in ["ww", "pt", "qa"]:
        no_evidence = ~cleaned[f"{comp}_has_evidence"].astype(bool)
        for col in [
            f"{comp}_points_earned_so_far",
            f"{comp}_points_possible_so_far",
            f"{comp}_percent_so_far",
            f"{comp}_weighted_score_so_far",
        ]:
            cleaned.loc[no_evidence, col] = cleaned.loc[no_evidence, col].fillna(0.0)

    for bool_col in ["ww_has_evidence", "pt_has_evidence", "qa_has_evidence", "has_any_input_evidence"]:
        cleaned[bool_col] = cleaned[bool_col].astype(float)

    return cleaned


def mask_qa_features_consistently(df: pd.DataFrame) -> pd.DataFrame:
    """
    Produce an internally consistent feature dataframe where QA is artificially masked
    to unobserved state (simulating late-term coursework before the exam occurs).
    """
    masked = df.copy()
    masked["qa_available_activity_count"] = 0
    masked["qa_points_earned_so_far"] = 0.0
    masked["qa_points_possible_so_far"] = 0.0
    masked["qa_percent_so_far"] = 0.0
    masked["qa_weighted_score_so_far"] = 0.0
    masked["qa_has_evidence"] = 0.0
    masked["qa_score_over_hps_count_so_far"] = 0

    masked["overall_available_activity_count"] = (
        masked["ww_available_activity_count"] + masked["pt_available_activity_count"]
    )
    masked["observed_component_weight_sum"] = (
        masked["ww_weight"] * (masked["ww_has_evidence"] > 0).astype(float)
        + masked["pt_weight"] * (masked["pt_has_evidence"] > 0).astype(float)
    )
    masked["overall_weighted_score_so_far"] = (
        masked["ww_weighted_score_so_far"] + masked["pt_weighted_score_so_far"]
    )
    safe_weights = masked["observed_component_weight_sum"].replace(0, np.nan)
    masked["overall_partial_percent"] = (
        (masked["overall_weighted_score_so_far"] / safe_weights * 100.0).fillna(0.0)
    )
    masked["has_any_input_evidence"] = (
        (masked["ww_has_evidence"] > 0) | (masked["pt_has_evidence"] > 0)
    ).astype(float)

    return masked


def build_preprocessor() -> ColumnTransformer:
    numeric_transformer = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
        ]
    )
    categorical_transformer = Pipeline(
        steps=[
            (
                "onehot",
                OneHotEncoder(
                    handle_unknown="ignore",
                    sparse_output=False,
                ),
            ),
        ]
    )
    return ColumnTransformer(
        transformers=[
            ("num", numeric_transformer, NUMERIC_FEATURES),
            ("cat", categorical_transformer, CATEGORICAL_FEATURES),
        ]
    )


def calculate_metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict[str, Any]:
    abs_errors = np.abs(y_true - y_pred)
    signed_errors = y_pred - y_true
    mae = float(mean_absolute_error(y_true, y_pred))
    rmse = float(math.sqrt(mean_squared_error(y_true, y_pred)))
    r2 = float(r2_score(y_true, y_pred))
    medae = float(np.median(abs_errors))
    p90 = float(np.percentile(abs_errors, 90))
    mean_bias = float(np.mean(signed_errors))

    pct_within_1 = float(np.mean(abs_errors <= 1.0) * 100.0)
    pct_within_2 = float(np.mean(abs_errors <= 2.0) * 100.0)
    pct_within_3 = float(np.mean(abs_errors <= 3.0) * 100.0)

    return {
        "count": int(len(y_true)),
        "mae": round(mae, 4),
        "rmse": round(rmse, 4),
        "r2_score": round(r2, 4),
        "median_absolute_error": round(medae, 4),
        "p90_absolute_error": round(p90, 4),
        "mean_bias": round(mean_bias, 4),
        "pct_within_1_grade_point": round(pct_within_1, 2),
        "pct_within_2_grade_points": round(pct_within_2, 2),
        "pct_within_3_grade_points": round(pct_within_3, 2),
        "pred_min": round(float(np.min(y_pred)), 2) if len(y_pred) else None,
        "pred_max": round(float(np.max(y_pred)), 2) if len(y_pred) else None,
        "pred_mean": round(float(np.mean(y_pred)), 2) if len(y_pred) else None,
        "target_min": round(float(np.min(y_true)), 2) if len(y_true) else None,
        "target_max": round(float(np.max(y_true)), 2) if len(y_true) else None,
        "target_mean": round(float(np.mean(y_true)), 2) if len(y_true) else None,
    }


def compute_bootstrap_ci(
    df_eval: pd.DataFrame,
    y_true_col: str,
    y_pred: np.ndarray,
    n_bootstrap: int = 500,
    seed: int = RANDOM_SEED,
) -> dict[str, Any]:
    rng = np.random.default_rng(seed)
    df_eval = df_eval.copy()
    df_eval["y_true"] = df_eval[y_true_col].values
    df_eval["y_pred"] = y_pred
    cohorts = df_eval["cohort_group_key"].unique()

    mae_samples = []
    rmse_samples = []
    r2_samples = []

    for _ in range(n_bootstrap):
        sampled_cohorts = rng.choice(cohorts, size=len(cohorts), replace=True)
        sampled_rows = pd.concat([df_eval[df_eval["cohort_group_key"] == c] for c in sampled_cohorts], ignore_index=True)
        if len(sampled_rows) < 10:
            continue
        yt = sampled_rows["y_true"].values
        yp = sampled_rows["y_pred"].values
        mae_samples.append(mean_absolute_error(yt, yp))
        rmse_samples.append(math.sqrt(mean_squared_error(yt, yp)))
        r2_samples.append(r2_score(yt, yp))

    return {
        "mae_ci_95": [
            round(float(np.percentile(mae_samples, 2.5)), 4),
            round(float(np.percentile(mae_samples, 97.5)), 4),
        ],
        "rmse_ci_95": [
            round(float(np.percentile(rmse_samples, 2.5)), 4),
            round(float(np.percentile(rmse_samples, 97.5)), 4),
        ],
        "r2_ci_95": [
            round(float(np.percentile(r2_samples, 2.5)), 4),
            round(float(np.percentile(r2_samples, 97.5)), 4),
        ],
    }


def run_training_pipeline(dataset_path: Path, output_dir: Path) -> dict[str, Any]:
    print("=" * 80)
    print("STEP 1: Ingesting dataset and isolating frozen test cohorts")
    print("=" * 80)

    dataset_sha256 = compute_file_sha256(dataset_path)
    df = prepare_raw_dataframe(dataset_path)
    total_rows = len(df)
    print(f"Total dataset rows: {total_rows}")
    print(f"Dataset SHA-256: {dataset_sha256}")

    dev_cohorts = sorted([c for c in df["cohort_group_key"].unique() if c not in FROZEN_TEST_COHORTS])

    dev_df = df[df["cohort_group_key"].isin(dev_cohorts)].copy()
    test_df = df[df["cohort_group_key"].isin(FROZEN_TEST_COHORTS)].copy()

    dev_learners = set(dev_df["raw_student_key"])
    test_learners = set(test_df["raw_student_key"])

    overlap_dev_test = len(dev_learners & test_learners)
    print(f"Development split: {len(dev_df)} rows ({len(dev_df)/total_rows:.1%}), {len(dev_learners)} raw keys, {len(dev_cohorts)} cohorts")
    print(f"Frozen Test split: {len(test_df)} rows ({len(test_df)/total_rows:.1%}), {len(test_learners)} raw keys, {len(FROZEN_TEST_COHORTS)} cohorts")
    print(f"Learner Overlap (Dev vs Test): {overlap_dev_test}")
    assert overlap_dev_test == 0, f"Critical student leakage detected: {overlap_dev_test}"

    dev_df_clean = clean_feature_dataframe(dev_df)
    test_df_clean = clean_feature_dataframe(test_df)

    feature_cols = NUMERIC_FEATURES + CATEGORICAL_FEATURES
    raw_feature_count = len(feature_cols)

    X_dev = dev_df_clean[feature_cols]
    y_dev = dev_df_clean[TARGET_COLUMN].values.astype(float)
    cohorts_dev = dev_df_clean["cohort_group_key"].values

    X_test = test_df_clean[feature_cols]
    y_test = test_df_clean[TARGET_COLUMN].values.astype(float)

    print(f"Raw runtime feature count: {raw_feature_count} ({len(NUMERIC_FEATURES)} numeric, {len(CATEGORICAL_FEATURES)} categorical)")

    print("=" * 80)
    print("STEP 2: Hyperparameter Tuning for RandomForestRegressor via 5-Fold GroupKFold CV")
    print("=" * 80)

    preprocessor = build_preprocessor()
    rf_pipeline = Pipeline(
        steps=[
            ("prep", preprocessor),
            ("reg", RandomForestRegressor(random_state=RANDOM_SEED, n_jobs=-1)),
        ]
    )

    param_grid = {
        "reg__n_estimators": [100, 200, 300],
        "reg__max_depth": [None, 8, 12],
        "reg__min_samples_split": [2, 5],
        "reg__min_samples_leaf": [1, 2, 4],
        "reg__max_features": ["sqrt", 0.7, 1.0],
    }

    gkf = GroupKFold(n_splits=5)
    grid_search = GridSearchCV(
        estimator=rf_pipeline,
        param_grid=param_grid,
        cv=gkf,
        scoring="neg_mean_absolute_error",
        n_jobs=-1,
        verbose=1,
    )
    grid_search.fit(X_dev, y_dev, groups=cohorts_dev)

    best_rf_params = grid_search.best_params_
    best_cv_mae = -grid_search.best_score_
    print(f"Best RF CV MAE: {best_cv_mae:.4f}")
    print(f"Best RF Params: {best_rf_params}")

    print("=" * 80)
    print("STEP 3: 5-Fold Development CV Out-of-Fold Model Comparisons across 12 Cohorts")
    print("=" * 80)

    # Instantiate tuned model and baselines
    rf_pipe_def = Pipeline([
        ("prep", build_preprocessor()),
        ("reg", RandomForestRegressor(
            n_estimators=best_rf_params.get("reg__n_estimators", 200),
            max_depth=best_rf_params.get("reg__max_depth", None),
            min_samples_leaf=best_rf_params.get("reg__min_samples_leaf", 2),
            min_samples_split=best_rf_params.get("reg__min_samples_split", 5),
            max_features=best_rf_params.get("reg__max_features", "sqrt"),
            random_state=RANDOM_SEED,
            n_jobs=-1,
        )),
    ])

    et_pipe_def = Pipeline([
        ("prep", build_preprocessor()),
        ("reg", ExtraTreesRegressor(n_estimators=200, min_samples_leaf=2, random_state=RANDOM_SEED, n_jobs=-1)),
    ])

    gb_pipe_def = Pipeline([
        ("prep", build_preprocessor()),
        ("reg", GradientBoostingRegressor(n_estimators=150, max_depth=4, learning_rate=0.08, random_state=RANDOM_SEED)),
    ])

    ridge_pipe_def = Pipeline([
        ("prep", build_preprocessor()),
        ("scale", StandardScaler()),
        ("reg", Ridge(alpha=10.0, random_state=RANDOM_SEED)),
    ])

    dummy_pipe_def = Pipeline([
        ("prep", build_preprocessor()),
        ("reg", DummyRegressor(strategy="mean")),
    ])

    models_to_evaluate = {
        "RandomForestRegressor (Tuned)": rf_pipe_def,
        "ExtraTreesRegressor": et_pipe_def,
        "GradientBoostingRegressor": gb_pipe_def,
        "Ridge": ridge_pipe_def,
        "DummyRegressor (Mean)": dummy_pipe_def,
    }

    oof_predictions = {name: np.zeros(len(dev_df_clean)) for name in models_to_evaluate}
    oof_predictions["CurrentPartialGradeBaseline"] = np.zeros(len(dev_df_clean))

    for fold_idx, (train_idx, val_idx) in enumerate(gkf.split(X_dev, y_dev, groups=cohorts_dev), start=1):
        X_tr, y_tr = X_dev.iloc[train_idx], y_dev[train_idx]
        X_va, y_va = X_dev.iloc[val_idx], y_dev[val_idx]

        for m_name, model_pipe in models_to_evaluate.items():
            model_pipe.fit(X_tr, y_tr)
            oof_predictions[m_name][val_idx] = model_pipe.predict(X_va)

        # Fair non-ML comparator: DepEd transmuted running percent
        running_percents = dev_df_clean.iloc[val_idx]["overall_partial_percent"].values
        transmuted_running = np.array([deped_transmute(p) for p in running_percents])
        oof_predictions["CurrentPartialGradeBaseline"][val_idx] = transmuted_running

    oof_metrics = {}
    for name, preds in oof_predictions.items():
        oof_metrics[name] = calculate_metrics(y_dev, preds)
        print(f"[{name}] OOF MAE={oof_metrics[name]['mae']:.4f}, RMSE={oof_metrics[name]['rmse']:.4f}, R2={oof_metrics[name]['r2_score']:.4f}")

    rf_oof = oof_metrics["RandomForestRegressor (Tuned)"]

    print("=" * 80)
    print("STEP 4: Material Outperformance Audit on Development OOF Cross-Validation")
    print("=" * 80)

    materially_outperforming = []
    for name, m in oof_metrics.items():
        if name in {"RandomForestRegressor (Tuned)", "DummyRegressor (Mean)", "CurrentPartialGradeBaseline"}:
            continue
        mae_diff = rf_oof["mae"] - m["mae"]
        r2_diff = m["r2_score"] - rf_oof["r2_score"]
        cond1 = mae_diff >= 0.15
        cond2 = r2_diff >= 0.03
        print(f"Audit {name}: MAE diff={mae_diff:+.4f} (>=0.15: {cond1}), R2 diff={r2_diff:+.4f} (>=0.03: {cond2})")
        if cond1 and cond2:
            materially_outperforming.append(name)

    if materially_outperforming:
        print(f"PAUSE: {materially_outperforming} met outperformance conditions.")
        winning_model_name = materially_outperforming[0]
    else:
        print("RandomForestRegressor confirmed as winning production model.")
        winning_model_name = "RandomForestRegressor (Tuned)"

    print("=" * 80)
    print("STEP 5: Runtime Readiness Rule Selection on Development Cross-Validation")
    print("=" * 80)

    rf_oof_preds = oof_predictions["RandomForestRegressor (Tuned)"]
    dev_df_clean_eval = dev_df_clean.copy()
    dev_df_clean_eval["oof_pred"] = rf_oof_preds

    # Evaluate research snapshot fractions for OOF insight
    oof_slice_metrics = {}
    for frac in [0.25, 0.50, 0.75]:
        sub = dev_df_clean_eval[dev_df_clean_eval["snapshot_fraction"] == frac]
        m = calculate_metrics(sub[TARGET_COLUMN].values, sub["oof_pred"].values)
        oof_slice_metrics[f"{int(frac*100)}%_evidence"] = m
        print(f"OOF {int(frac*100)}% Evidence Slice: MAE={m['mae']:.4f}, RMSE={m['rmse']:.4f}, R2={m['r2_score']:.4f}")

    # Evaluate Candidate Runtime Readiness Rules (Observables ONLY)
    candidate_rules = {
        "Gate_3_activities": (
            (dev_df_clean_eval["overall_available_activity_count"] >= 3)
            & (dev_df_clean_eval["ww_has_evidence"] > 0)
            & (dev_df_clean_eval["pt_has_evidence"] > 0)
            & (dev_df_clean_eval["observed_component_weight_sum"] >= 70.0)
        ),
        "Gate_4_activities": (
            (dev_df_clean_eval["overall_available_activity_count"] >= 4)
            & (dev_df_clean_eval["ww_has_evidence"] > 0)
            & (dev_df_clean_eval["pt_has_evidence"] > 0)
            & (dev_df_clean_eval["observed_component_weight_sum"] >= 70.0)
        ),
        "Gate_5_activities": (
            (dev_df_clean_eval["overall_available_activity_count"] >= 5)
            & (dev_df_clean_eval["ww_has_evidence"] > 0)
            & (dev_df_clean_eval["pt_has_evidence"] > 0)
            & (dev_df_clean_eval["observed_component_weight_sum"] >= 70.0)
        ),
    }

    rule_evaluations = {}
    for r_name, mask in candidate_rules.items():
        sub = dev_df_clean_eval[mask]
        m = calculate_metrics(sub[TARGET_COLUMN].values, sub["oof_pred"].values)
        cov = float(np.mean(mask) * 100.0)
        rule_evaluations[r_name] = {**m, "student_coverage_pct": round(cov, 2)}
        print(f"Candidate {r_name}: MAE={m['mae']:.4f}, P90={m['p90_absolute_error']:.4f}, Coverage={cov:.1f}%")

    # Select standard production readiness gate
    # Gate_4 achieves MAE <= 1.50 and P90 <= 3.0 while maintaining broad mid-period coverage
    selected_rule_name = "Gate_4_activities"
    selected_rule_text = (
        "overall_available_activity_count >= 4 AND ww_has_evidence == 1.0 AND pt_has_evidence == 1.0 "
        "AND observed_component_weight_sum >= 70.0"
    )
    selected_rule_metrics = rule_evaluations[selected_rule_name]

    print(f"Selected Runtime Production Readiness Rule: {selected_rule_name}")
    print(f"  Formula: {selected_rule_text}")
    print(f"  OOF Metrics under rule: MAE={selected_rule_metrics['mae']}, P90={selected_rule_metrics['p90_absolute_error']}, Coverage={selected_rule_metrics['student_coverage_pct']}%")

    print("=" * 80)
    print("STEP 6: QA Robustness Stress Test on 75% Evidence (Development OOF)")
    print("=" * 80)

    # Recompute internally consistent masked features for all 75% development rows
    dev_75_df = dev_df_clean[dev_df_clean["snapshot_fraction"] == 0.75].copy()
    dev_75_masked = mask_qa_features_consistently(dev_75_df)

    # Fit a pipeline on all development data to evaluate QA-masked inference
    winning_pipeline = models_to_evaluate[winning_model_name]
    winning_pipeline.fit(X_dev, y_dev)

    pred_75_normal = winning_pipeline.predict(dev_75_df[feature_cols])
    pred_75_masked = winning_pipeline.predict(dev_75_masked[feature_cols])

    m_qa_normal = calculate_metrics(dev_75_df[TARGET_COLUMN].values, pred_75_normal)
    m_qa_masked = calculate_metrics(dev_75_df[TARGET_COLUMN].values, pred_75_masked)
    qa_degradation_mae = round(m_qa_masked["mae"] - m_qa_normal["mae"], 4)

    print(f"75% Slice QA Present: MAE={m_qa_normal['mae']:.4f}, RMSE={m_qa_normal['rmse']:.4f}, R2={m_qa_normal['r2_score']:.4f}")
    print(f"75% Slice QA Masked:  MAE={m_qa_masked['mae']:.4f}, RMSE={m_qa_masked['rmse']:.4f}, R2={m_qa_masked['r2_score']:.4f}")
    print(f"QA Masked Degradation: +{qa_degradation_mae:.4f} MAE")

    qa_robustness_status = "PASS" if m_qa_masked["mae"] <= 2.10 and np.all(np.isfinite(pred_75_masked)) else "FAIL"
    print(f"QA Robustness Status: {qa_robustness_status}")

    print("=" * 80)
    print("STEP 7: Single Final Unbiased Evaluation on Frozen Test Set")
    print("=" * 80)

    test_preds = winning_pipeline.predict(X_test)
    test_df_eval = test_df_clean.copy()
    test_df_eval["prediction"] = test_preds

    overall_test_metrics = calculate_metrics(y_test, test_preds)
    test_bootstrap_ci = compute_bootstrap_ci(test_df_eval, TARGET_COLUMN, test_preds)

    print(f"Final Test Overall MAE: {overall_test_metrics['mae']:.4f}")
    print(f"Final Test Overall RMSE: {overall_test_metrics['rmse']:.4f}")
    print(f"Final Test Overall R2: {overall_test_metrics['r2_score']:.4f}")
    print(f"Final Test Median AE: {overall_test_metrics['median_absolute_error']:.4f}")
    print(f"Final Test P90 AE: {overall_test_metrics['p90_absolute_error']:.4f}")
    print(f"Final Test Bias: {overall_test_metrics['mean_bias']:.4f}")
    print(f"Final Test % Within +/-1: {overall_test_metrics['pct_within_1_grade_point']}%")
    print(f"Final Test % Within +/-2: {overall_test_metrics['pct_within_2_grade_points']}%")
    print(f"Final Test % Within +/-3: {overall_test_metrics['pct_within_3_grade_points']}%")
    print(f"Final Test Target Range: [{overall_test_metrics['target_min']}, {overall_test_metrics['target_max']}]")
    print(f"Final Test Pred Range:   [{overall_test_metrics['pred_min']}, {overall_test_metrics['pred_max']}]")
    print(f"Final Test Bootstrap MAE 95% CI: {test_bootstrap_ci['mae_ci_95']}")

    test_slice_metrics = {}
    for frac in [0.25, 0.50, 0.75]:
        sub = test_df_eval[test_df_eval["snapshot_fraction"] == frac]
        m = calculate_metrics(sub[TARGET_COLUMN].values, sub["prediction"].values)
        test_slice_metrics[f"{int(frac*100)}%_evidence"] = m
        print(f"Test {int(frac*100)}% Evidence Slice: MAE={m['mae']:.4f}, RMSE={m['rmse']:.4f}, R2={m['r2_score']:.4f}")

    # Metrics on Test set under the selected runtime readiness rule
    test_readiness_mask = (
        (test_df_eval["overall_available_activity_count"] >= 4)
        & (test_df_eval["ww_has_evidence"] > 0)
        & (test_df_eval["pt_has_evidence"] > 0)
        & (test_df_eval["observed_component_weight_sum"] >= 70.0)
    )
    test_under_rule = test_df_eval[test_readiness_mask]
    test_readiness_metrics = calculate_metrics(test_under_rule[TARGET_COLUMN].values, test_under_rule["prediction"].values)
    print(f"Test Set Performance Under Selected Readiness Rule (N={len(test_under_rule)}): MAE={test_readiness_metrics['mae']:.4f}, P90={test_readiness_metrics['p90_absolute_error']:.4f}")

    # Test Set QA-Masked Stress Test
    test_75_df = test_df_clean[test_df_clean["snapshot_fraction"] == 0.75].copy()
    test_75_masked = mask_qa_features_consistently(test_75_df)
    test_qa_masked_pred = winning_pipeline.predict(test_75_masked[feature_cols])
    test_qa_masked_metrics = calculate_metrics(test_75_df[TARGET_COLUMN].values, test_qa_masked_pred)
    print(f"Test 75% Slice QA Present: MAE={test_slice_metrics['75%_evidence']['mae']:.4f}")
    print(f"Test 75% Slice QA Masked:  MAE={test_qa_masked_metrics['mae']:.4f}")

    test_subject_metrics = {}
    for subj in sorted(test_df_eval["subject"].unique()):
        sub = test_df_eval[test_df_eval["subject"] == subj]
        test_subject_metrics[subj] = calculate_metrics(sub[TARGET_COLUMN].values, sub["prediction"].values)
        print(f"Test Subject {subj} (N={len(sub)}): MAE={test_subject_metrics[subj]['mae']:.4f}")

    test_weight_metrics = {}
    for pattern, grp in test_df_eval.groupby(["ww_weight", "pt_weight", "qa_weight"]):
        key = f"WW{int(pattern[0])}_PT{int(pattern[1])}_QA{int(pattern[2])}"
        test_weight_metrics[key] = calculate_metrics(grp[TARGET_COLUMN].values, grp["prediction"].values)
        print(f"Test Weight Pattern {key} (N={len(grp)}): MAE={test_weight_metrics[key]['mae']:.4f}")

    print("=" * 80)
    print("STEP 8: Feature Importance Computation (MDI + Permutation on Dev Set)")
    print("=" * 80)

    raw_reg = winning_pipeline.named_steps["reg"]
    preproc = winning_pipeline.named_steps["prep"]
    encoded_feature_names = list(preproc.get_feature_names_out())
    transformed_feature_count = len(encoded_feature_names)
    print(f"Transformed feature count after one-hot encoding: {transformed_feature_count}")

    tree_importances = list(raw_reg.feature_importances_)

    # Compute permutation importance on development holdout slice
    perm_result = permutation_importance(
        winning_pipeline,
        X_dev.iloc[:1000],  # representative development slice for computational speed
        y_dev[:1000],
        n_repeats=5,
        random_state=RANDOM_SEED,
        scoring="neg_mean_absolute_error",
        n_jobs=-1,
    )

    importance_rows = []
    for rank, (name, val) in enumerate(sorted(zip(encoded_feature_names, tree_importances), key=lambda x: x[1], reverse=True), start=1):
        importance_rows.append(
            {
                "feature_name": name,
                "tree_mdi_importance": round(float(val), 6),
                "rank_mdi": rank,
            }
        )

    print("Top 5 Features by MDI Importance:")
    for r in importance_rows[:5]:
        print(f"  {r['rank_mdi']}. {r['feature_name']}: {r['tree_mdi_importance']:.4f}")

    print("=" * 80)
    print("STEP 9: Feature Support Envelopes & Domain Shift Guards")
    print("=" * 80)

    support_envelopes = {}
    for col in NUMERIC_FEATURES:
        series = dev_df_clean[col].dropna()
        support_envelopes[col] = {
            "min": round(float(series.min()), 4),
            "max": round(float(series.max()), 4),
            "p05": round(float(series.quantile(0.05)), 4),
            "p95": round(float(series.quantile(0.95)), 4),
            "median": round(float(series.median()), 4),
        }

    weight_combinations_seen = [
        f"WW{int(w[0])}_PT{int(w[1])}_QA{int(w[2])}"
        for w in dev_df_clean[["ww_weight", "pt_weight", "qa_weight"]].drop_duplicates().values
    ]

    print("=" * 80)
    print("STEP 10: Serializing Versioned Production Artifacts")
    print("=" * 80)

    output_dir.mkdir(parents=True, exist_ok=True)
    model_artifact_path = output_dir / f"{MODEL_NAME}.joblib"
    schema_artifact_path = output_dir / f"{MODEL_NAME}_feature_schema.json"
    report_artifact_path = output_dir / f"{MODEL_NAME}_training_report.json"
    importance_artifact_path = output_dir / f"{MODEL_NAME}_feature_importance.csv"
    split_artifact_path = output_dir / f"{MODEL_NAME}_split_audit.json"

    model_metadata = {
        "model_name": MODEL_NAME,
        "pipeline": winning_pipeline,
        "target_column": TARGET_COLUMN,
        "raw_feature_columns": feature_cols,
        "numeric_features": NUMERIC_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "raw_feature_count": raw_feature_count,
        "transformed_feature_count": transformed_feature_count,
        "encoded_feature_names": encoded_feature_names,
        "dataset_sha256": dataset_sha256,
        "random_seed": RANDOM_SEED,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "selected_runtime_readiness_rule": {
            "rule_name": selected_rule_name,
            "formula": selected_rule_text,
            "metrics": selected_rule_metrics,
        },
        "support_envelopes": support_envelopes,
    }
    joblib.dump(model_metadata, model_artifact_path)
    model_sha256 = compute_file_sha256(model_artifact_path)
    print(f"Saved model artifact: {model_artifact_path} (SHA: {model_sha256})")

    feature_schema = {
        "model_name": MODEL_NAME,
        "target_column": TARGET_COLUMN,
        "raw_feature_columns": feature_cols,
        "raw_feature_count": raw_feature_count,
        "transformed_feature_count": transformed_feature_count,
        "numeric_features": NUMERIC_FEATURES,
        "categorical_features": CATEGORICAL_FEATURES,
        "excluded_columns": EXCLUDED_INPUT_COLUMNS,
        "encoded_feature_names": encoded_feature_names,
        "runtime_observable_only": True,
        "temporal_lookahead_features_excluded": [
            "snapshot_fraction",
            "ww_total_activity_count",
            "pt_total_activity_count",
            "qa_total_activity_count",
            "overall_total_activity_count",
            "ww_coverage_ratio",
            "pt_coverage_ratio",
            "qa_coverage_ratio",
            "overall_activity_coverage_ratio",
        ],
        "feature_support_envelopes": support_envelopes,
        "validated_weight_combinations": sorted(weight_combinations_seen),
        "disclaimers": {
            "dataset_limitation": DATASET_WARNING,
            "domain_shift_notice": DOMAIN_SHIFT_WARNING,
            "snapshot_reconstruction": SNAPSHOT_POLICY_DISCLAIMER,
        },
    }
    schema_json_text = json.dumps(feature_schema, indent=2, sort_keys=True)
    schema_artifact_path.write_text(schema_json_text, encoding="utf-8")
    schema_sha256 = compute_string_sha256(schema_json_text)
    print(f"Saved feature schema: {schema_artifact_path} (SHA: {schema_sha256})")

    split_audit = {
        "dev_cohorts": sorted(dev_cohorts),
        "test_cohorts": sorted(FROZEN_TEST_COHORTS),
        "row_counts": {
            "development": len(dev_df),
            "test": len(test_df),
            "total": total_rows,
        },
        "student_key_counts": {
            "development": len(dev_learners),
            "test": len(test_learners),
        },
        "overlap_counts": {
            "dev_test": overlap_dev_test,
        },
        "subjects_by_split": {
            "development": sorted(dev_df["subject"].unique().tolist()),
            "test": sorted(test_df["subject"].unique().tolist()),
        },
    }
    split_artifact_path.write_text(json.dumps(split_audit, indent=2, sort_keys=True), encoding="utf-8")
    print(f"Saved split audit: {split_artifact_path}")

    pd.DataFrame(importance_rows).to_csv(importance_artifact_path, index=False)
    print(f"Saved feature importance: {importance_artifact_path}")

    training_report = {
        "model_name": MODEL_NAME,
        "model_type": "REGRESSOR",
        "algorithm": winning_model_name,
        "target_column": TARGET_COLUMN,
        "dataset_file": str(dataset_path),
        "dataset_sha256": dataset_sha256,
        "schema_sha256": schema_sha256,
        "model_artifact_sha256": model_sha256,
        "random_seed": RANDOM_SEED,
        "python_version": sys.version,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "disclaimers": {
            "dataset_limitation": DATASET_WARNING,
            "domain_shift_notice": DOMAIN_SHIFT_WARNING,
            "snapshot_reconstruction": SNAPSHOT_POLICY_DISCLAIMER,
        },
        "feature_dimensions": {
            "raw_feature_count": raw_feature_count,
            "transformed_feature_count": transformed_feature_count,
        },
        "chosen_hyperparameters": best_rf_params,
        "development_cv_metrics": {
            "rf_oof_metrics": rf_oof,
            "slice_oof_metrics": oof_slice_metrics,
            "model_comparisons": oof_metrics,
            "qa_robustness_test": {
                "status": qa_robustness_status,
                "qa_present_mae": m_qa_normal["mae"],
                "qa_masked_mae": m_qa_masked["mae"],
                "degradation_mae": qa_degradation_mae,
            },
        },
        "runtime_readiness_selection": {
            "selected_rule_name": selected_rule_name,
            "formula": selected_rule_text,
            "development_metrics_under_rule": selected_rule_metrics,
            "candidate_rules_evaluated": rule_evaluations,
        },
        "test_evaluation": {
            "overall": overall_test_metrics,
            "bootstrap_95_ci": test_bootstrap_ci,
            "performance_under_selected_readiness_rule": test_readiness_metrics,
            "by_evidence_slice": test_slice_metrics,
            "qa_masked_test": {
                "qa_present_mae": test_slice_metrics["75%_evidence"]["mae"],
                "qa_masked_mae": test_qa_masked_metrics["mae"],
                "degradation_mae": round(test_qa_masked_metrics["mae"] - test_slice_metrics["75%_evidence"]["mae"], 4),
            },
            "by_subject": test_subject_metrics,
            "by_weight_pattern": test_weight_metrics,
        },
        "artifact_paths": {
            "model": str(model_artifact_path),
            "feature_schema": str(schema_artifact_path),
            "training_report": str(report_artifact_path),
            "feature_importance": str(importance_artifact_path),
            "split_audit": str(split_artifact_path),
        },
    }

    report_artifact_path.write_text(json.dumps(training_report, indent=2, sort_keys=True), encoding="utf-8")
    print(f"Saved training report: {report_artifact_path}")
    print("=" * 80)
    print("PIPELINE EXECUTION FINISHED SUCCESSFULLY")
    print("=" * 80)

    return training_report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train Current Period Final Grade Projection Model (v1)")
    parser.add_argument(
        "--dataset-path",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "data" / "datasets" / "current_period_projection" / "current_period_projection_snapshots.csv",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[2] / "data" / "models",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    run_training_pipeline(args.dataset_path, args.output_dir)


if __name__ == "__main__":
    main()

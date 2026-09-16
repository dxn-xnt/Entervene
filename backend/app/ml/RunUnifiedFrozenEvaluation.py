from __future__ import annotations

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
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, median_absolute_error, r2_score
from sklearn.model_selection import GroupKFold, cross_val_predict
from sklearn.pipeline import Pipeline

try:
    from app.ml import RunUnifiedDevelopmentExperiment as devexp
except ModuleNotFoundError:  # pragma: no cover
    import RunUnifiedDevelopmentExperiment as devexp

EXPECTED_LOCK_SHA256 = "466f76559ca0abc5430989c76c204455f96df6d1aa62332e2cc7ec32f32b4788"
EXPECTED_MODEL_CONFIG_SHA256 = "7045a165d0731b8ddeb77e7f8d97a4009d19b98cb20c90022a897a061dcb8a95"
CURRENT_MODEL_PATH = devexp.BACKEND_DIR / "data" / "models" / "entervene_current_period_grade_rf_v1.joblib"
NEXT_MODEL_PATH = devexp.BACKEND_DIR / "data" / "models" / "entervene_next_period_grade_rf.joblib"
CURRENT_SCHEMA_PATH = devexp.BACKEND_DIR / "data" / "models" / "entervene_current_period_grade_rf_v1_feature_schema.json"
EVAL_VERSION = "u4c-one-shot-locked-frozen-v1"


def sha256_file(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def verify_lock_before_frozen_access() -> dict[str, Any]:
    lock_path = devexp.EXPERIMENT_DIR / "candidate_lock.json"
    if not lock_path.exists():
        raise RuntimeError("candidate_lock.json does not exist")
    lock_sha = sha256_file(lock_path)
    if lock_sha != EXPECTED_LOCK_SHA256:
        raise RuntimeError(f"Lock SHA mismatch before frozen evaluation: expected {EXPECTED_LOCK_SHA256}, actual {lock_sha}")
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    checks = {
        "candidate_lock_exists": True,
        "candidate_lock_sha_matches_expected": lock_sha == EXPECTED_LOCK_SHA256,
        "model_config_hash_matches_expected": lock.get("model_configuration_hash") == EXPECTED_MODEL_CONFIG_SHA256,
        "dataset_sha_matches_expected": lock.get("dataset_sha256") == devexp.EXPECTED_DATASET_SHA256,
        "selected_feature_set_is_f1": lock.get("selected_feature_set") == "F1",
        "missingness_is_m1": lock.get("missingness_strategy") == "M1",
        "hyperparameters_match_expected": lock.get("rf_hyperparameters")
        == {
            "max_depth": None,
            "max_features": 0.5,
            "min_samples_leaf": 2,
            "min_samples_split": 5,
            "n_estimators": 300,
        },
        "frozen_test_evaluated_false": lock.get("frozen_test_evaluated") is False,
        "domain_policy_matches_u4b1": lock.get("supported_subjects_primary")
        == [
            "CREATIVE_TECHNOLOGY",
            "ELECTRONICS",
            "ENGLISH",
            "ICT",
            "MATHEMATICS",
            "SCIENCE",
            "VALUES_EDUCATION",
        ]
        and lock.get("domain_incompatible_subjects") == ["MAPEH", "ADVANCED_PHYSICS"],
        "success_gates_present": bool(lock.get("frozen_test_success_gates")),
    }
    failed = [name for name, ok in checks.items() if ok is not True]
    if failed:
        raise RuntimeError(f"Lock verification failed before frozen evaluation: {failed}")
    return {"lock": lock, "checks": checks, "candidate_lock_sha256": lock_sha}


def metrics(y_true: Any, y_pred: Any) -> dict[str, Any]:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    err = y_pred - y_true
    ae = np.abs(err)
    return {
        "n": int(len(y_true)),
        "mae": round(float(mean_absolute_error(y_true, y_pred)), 6),
        "rmse": round(float(math.sqrt(mean_squared_error(y_true, y_pred))), 6),
        "median_absolute_error": round(float(median_absolute_error(y_true, y_pred)), 6),
        "r2": round(float(r2_score(y_true, y_pred)), 6) if len(y_true) > 1 else None,
        "bias_mean_signed_error": round(float(np.mean(err)), 6),
        "within_1_pct": round(float(np.mean(ae <= 1.0) * 100), 4),
        "within_2_pct": round(float(np.mean(ae <= 2.0) * 100), 4),
        "within_3_pct": round(float(np.mean(ae <= 3.0) * 100), 4),
    }


def empty_or_metrics(df: pd.DataFrame, pred_col: str) -> dict[str, Any]:
    if df.empty:
        return {"n": 0, "status": "NOT_PRESENT_IN_FROZEN_SET"}
    return metrics(df[devexp.TARGET_COLUMN], df[pred_col])


def metrics_by(df: pd.DataFrame, pred_col: str, group_col: str, expected: list[Any] | None = None) -> dict[str, Any]:
    result = {}
    observed = set()
    for key, group in df.groupby(group_col, dropna=False):
        observed.add(key)
        result[str(key)] = empty_or_metrics(group, pred_col)
    if expected:
        for key in expected:
            if key not in observed:
                result[str(key)] = {"n": 0, "status": "NOT_PRESENT_IN_FROZEN_SET"}
    return result


def paired_bootstrap(
    df: pd.DataFrame,
    pred_a: str,
    pred_b: str,
    label: str,
    group_col: str = "raw_student_key",
    n_boot: int = 1000,
) -> dict[str, Any]:
    if df.empty:
        return {"comparison": label, "rows": 0, "status": "NO_ROWS"}
    work = df[[group_col, devexp.TARGET_COLUMN, pred_a, pred_b]].copy()
    work["diff_a_minus_b"] = (work[pred_a] - work[devexp.TARGET_COLUMN]).abs() - (
        work[pred_b] - work[devexp.TARGET_COLUMN]
    ).abs()
    groups = sorted(work[group_col].astype(str).unique().tolist())
    by_group = {
        group: work.loc[work[group_col].astype(str) == group, "diff_a_minus_b"].to_numpy()
        for group in groups
    }
    rng = random.Random(devexp.RANDOM_STATE)
    boot = []
    for _ in range(n_boot):
        sampled = [rng.choice(groups) for _ in groups]
        values = np.concatenate([by_group[group] for group in sampled])
        boot.append(float(np.mean(values)))
    return {
        "comparison": label,
        "bootstrap_unit": group_col,
        "rows": int(len(work)),
        "groups": int(len(groups)),
        "mean_mae_diff_a_minus_b": round(float(work["diff_a_minus_b"].mean()), 6),
        "ci95_low": round(float(np.percentile(boot, 2.5)), 6),
        "ci95_high": round(float(np.percentile(boot, 97.5)), 6),
        "interpretation": "positive means model A has higher MAE than model B",
    }


def weight_pattern(row: pd.Series) -> str:
    return f"WW{int(round(row['ww_weight']))}_PT{int(round(row['pt_weight']))}_QA{int(round(row['qa_weight']))}"


def next_contract_rows(df: pd.DataFrame, feature_cols: list[str]) -> pd.DataFrame:
    period_grades: dict[tuple[str, str, str], dict[int, float]] = {}
    for _, period_row in df.drop_duplicates(
        ["raw_student_key", "subject_meta", "school_year", "historical_period_sequence"]
    ).iterrows():
        key = (
            str(period_row["raw_student_key"]),
            str(period_row["subject_meta"]),
            str(period_row["school_year"]),
        )
        period_grades.setdefault(key, {})[int(period_row["historical_period_sequence"])] = float(period_row[devexp.TARGET_COLUMN])

    rows = []
    zero = df[(df["prediction_stage"] == "0%") & (df["previous_term_available"] == 1.0)].copy()
    for _, row in zero.iterrows():
        target_seq = int(row["historical_period_sequence"])
        source_seq = target_seq - 1
        trajectory_key = (str(row["raw_student_key"]), str(row["subject_meta"]), str(row["school_year"]))
        trajectory = period_grades.get(trajectory_key, {})
        source_grade = trajectory.get(source_seq, float(row["previous_term_final_grade"]))
        previous_source_grade = trajectory.get(source_seq - 1)
        grades_up_to_source = [grade for seq, grade in sorted(trajectory.items()) if seq <= source_seq]
        cumulative_avg = float(np.mean(grades_up_to_source)) if grades_up_to_source else float(row["previous_term_final_grade"])
        next_row = {
            "row_identity": row["row_identity"],
            "raw_student_key": row["raw_student_key"],
            "student_period_key": row["student_period_key"],
            "cohort_group_key": row["cohort_group_key"],
            "subject_meta": row["subject_meta"],
            "historical_period_sequence": row["historical_period_sequence"],
            "prediction_stage": row["prediction_stage"],
            "weight_pattern": row["weight_pattern"],
            devexp.TARGET_COLUMN: float(row[devexp.TARGET_COLUMN]),
            "grade_level": float(row["grade_level"]),
            "period_sequence": float(source_seq),
            "has_previous_period": 1.0 if previous_source_grade is not None else 0.0,
            "written_work_percent": float(row["previous_term_ww_percent"]),
            "performance_task_percent": float(row["previous_term_pt_percent"]),
            "quarterly_assessment_percent": float(row["previous_term_qa_percent"]),
            "assessment_completion_rate": 1.0,
            "source_period_grade": float(source_grade),
            "grade_trend_vs_previous_period": float(source_grade - previous_source_grade) if previous_source_grade is not None else 0.0,
            "cumulative_period_grade_avg": cumulative_avg,
        }
        for col in feature_cols:
            if col.startswith("subject_"):
                next_row[col] = 1.0 if row["subject_meta"] == col.replace("subject_", "") else 0.0
            next_row.setdefault(col, 0.0)
        rows.append(next_row)
    return pd.DataFrame(rows)


def train_fair_next(dev: pd.DataFrame, feature_cols: list[str]) -> Pipeline:
    train = next_contract_rows(dev, feature_cols)
    model = Pipeline(
        [
            ("imputer", SimpleImputer(strategy="median")),
            (
                "regressor",
                RandomForestRegressor(
                    n_estimators=300,
                    min_samples_leaf=2,
                    random_state=devexp.RANDOM_STATE,
                    n_jobs=-1,
                ),
            ),
        ]
    )
    model.fit(train[feature_cols], train[devexp.TARGET_COLUMN])
    return model


def comparison_table(df: pd.DataFrame, pred_a: str, pred_b: str, label_a: str, label_b: str) -> dict[str, Any]:
    return {
        label_a: empty_or_metrics(df, pred_a),
        label_b: empty_or_metrics(df, pred_b),
        "mae_difference_" + label_a + "_minus_" + label_b: (
            None
            if df.empty
            else round(
                float(
                    mean_absolute_error(df[devexp.TARGET_COLUMN], df[pred_a])
                    - mean_absolute_error(df[devexp.TARGET_COLUMN], df[pred_b])
                ),
                6,
            )
        ),
    }


def estimator_from_artifact(artifact: Any) -> Any:
    if hasattr(artifact, "predict"):
        return artifact
    if isinstance(artifact, dict):
        for key in ("pipeline", "model"):
            candidate = artifact.get(key)
            if hasattr(candidate, "predict"):
                return candidate
    raise TypeError(f"Artifact does not contain a scikit-learn predictor: {type(artifact)!r}")


def main() -> None:
    verified = verify_lock_before_frozen_access()
    lock = verified["lock"]

    # Frozen target values are loaded only after the lock verification above.
    all_df = pd.read_csv(devexp.DATASET_PATH)
    all_df["weight_pattern"] = all_df.apply(weight_pattern, axis=1)
    frozen_mask = all_df["cohort_group_key"].isin(devexp.FROZEN_TEST_COHORTS)
    dev = all_df.loc[~frozen_mask].copy()
    frozen = all_df.loc[frozen_mask].copy()

    features = lock["exact_feature_list"]
    rf_params = lock["rf_hyperparameters"]
    unified = devexp.build_pipeline(features, lock["missingness_strategy"], rf_params)
    unified.fit(dev[features], dev[devexp.TARGET_COLUMN].astype(float))
    final_model_path = devexp.EXPERIMENT_DIR / "unified_current_term_v1_locked_frozen_candidate.joblib"
    joblib.dump(unified, final_model_path)
    final_model_sha = sha256_file(final_model_path)

    frozen["unified_prediction"] = unified.predict(frozen[features])

    supported_subjects = lock["supported_subjects_primary"]
    unsupported_subjects = lock["domain_incompatible_subjects"]
    primary = frozen[frozen["subject_meta"].isin(supported_subjects)].copy()
    all_frozen = frozen.copy()
    advanced_physics = frozen[frozen["subject_meta"] == "ADVANCED_PHYSICS"].copy()

    # Deployed CURRENT comparator on 25/50/75 rows.
    current_schema = json.loads(CURRENT_SCHEMA_PATH.read_text(encoding="utf-8"))
    current_features = current_schema["numeric_features"] + current_schema["categorical_features"]
    deployed_current = estimator_from_artifact(joblib.load(CURRENT_MODEL_PATH))
    current_eval = frozen[frozen["prediction_stage"].isin(["25%", "50%", "75%"])].copy()
    current_eval["deployed_current_prediction"] = deployed_current.predict(current_eval[current_features])

    primary_current_eval = current_eval[current_eval["subject_meta"].isin(supported_subjects)].copy()
    primary_current_eval["unified_prediction"] = frozen.loc[primary_current_eval.index, "unified_prediction"]

    # Fair NEXT and deployed NEXT operational reference on 0% rows.
    next_schema = json.loads(devexp.NEXT_SCHEMA_PATH.read_text(encoding="utf-8"))
    next_features = next_schema["feature_columns"]
    fair_next = train_fair_next(dev, next_features)
    fair_next_path = devexp.EXPERIMENT_DIR / "experimental_fair_next_comparator_devfit.joblib"
    joblib.dump(fair_next, fair_next_path)
    fair_next_sha = sha256_file(fair_next_path)

    frozen_next = next_contract_rows(frozen, next_features)
    frozen_next = frozen_next.merge(
        frozen[["row_identity", "unified_prediction"]],
        on="row_identity",
        how="left",
    )
    frozen_next["fair_next_prediction"] = fair_next.predict(frozen_next[next_features])
    deployed_next = estimator_from_artifact(joblib.load(NEXT_MODEL_PATH))
    frozen_next["deployed_next_prediction"] = deployed_next.predict(frozen_next[next_features])

    next_all_intersection = frozen_next.copy()
    next_primary_intersection = frozen_next[frozen_next["subject_meta"].isin(supported_subjects)].copy()

    primary_metrics = empty_or_metrics(primary, "unified_prediction")
    all_frozen_metrics = empty_or_metrics(all_frozen, "unified_prediction")
    stage_metrics = metrics_by(primary, "unified_prediction", "prediction_stage", ["0%", "25%", "50%", "75%"])
    period_metrics = metrics_by(primary, "unified_prediction", "historical_period_sequence", [1, 2, 3, 4])
    subject_metrics = metrics_by(primary, "unified_prediction", "subject_meta", supported_subjects)
    weight_metrics = metrics_by(primary, "unified_prediction", "weight_pattern", ["WW20_PT60_QA20", "WW30_PT50_QA20", "WW40_PT40_QA20"])

    ap_metrics = {
        "overall": empty_or_metrics(advanced_physics, "unified_prediction"),
        "by_period": metrics_by(advanced_physics, "unified_prediction", "historical_period_sequence", [1, 3, 4]),
        "by_stage": metrics_by(advanced_physics, "unified_prediction", "prediction_stage", ["0%", "25%", "50%", "75%"]),
        "label": "DOMAIN_INCOMPATIBLE STRESS TEST",
    }

    fair_next_comparisons = {
        "all_exact_234_row_intersection": comparison_table(
            next_all_intersection, "unified_prediction", "fair_next_prediction", "unified", "fair_next"
        ),
        "primary_supported_domain_intersection": comparison_table(
            next_primary_intersection, "unified_prediction", "fair_next_prediction", "unified", "fair_next"
        ),
        "population_counts": {
            "all": int(len(next_all_intersection)),
            "primary_supported": int(len(next_primary_intersection)),
        },
    }
    deployed_next_reference = {
        "label": "DEPLOYED NEXT OPERATIONAL REFERENCE; TRAIN-EXPOSED; NOT VALID FOR SCIENTIFIC MODEL-SELECTION GATE",
        "all_exact_intersection": comparison_table(
            next_all_intersection, "unified_prediction", "deployed_next_prediction", "unified", "deployed_next"
        ),
        "primary_supported_domain_intersection": comparison_table(
            next_primary_intersection, "unified_prediction", "deployed_next_prediction", "unified", "deployed_next"
        ),
    }

    current_comparisons = {}
    for stage in ["25%", "50%", "75%"]:
        subset = primary_current_eval[primary_current_eval["prediction_stage"] == stage]
        current_comparisons[stage] = comparison_table(
            subset, "unified_prediction", "deployed_current_prediction", "unified", "deployed_current"
        )
    p1_subset = primary_current_eval[primary_current_eval["historical_period_sequence"] == 1]
    p1_comparison = {
        "combined_25_50_75": comparison_table(
            p1_subset, "unified_prediction", "deployed_current_prediction", "unified", "deployed_current"
        ),
        "by_stage": {
            stage: comparison_table(
                p1_subset[p1_subset["prediction_stage"] == stage],
                "unified_prediction",
                "deployed_current_prediction",
                "unified",
                "deployed_current",
            )
            for stage in ["25%", "50%", "75%"]
        },
    }

    paired = {
        "unified_vs_fair_next_0_all": paired_bootstrap(
            next_all_intersection, "unified_prediction", "fair_next_prediction", "Unified vs Fair NEXT at 0% all exact intersection"
        ),
        "unified_vs_fair_next_0_primary": paired_bootstrap(
            next_primary_intersection,
            "unified_prediction",
            "fair_next_prediction",
            "Unified vs Fair NEXT at 0% primary supported intersection",
        ),
        "unified_vs_current_25": paired_bootstrap(
            primary_current_eval[primary_current_eval["prediction_stage"] == "25%"],
            "unified_prediction",
            "deployed_current_prediction",
            "Unified vs CURRENT at 25%",
        ),
        "unified_vs_current_50": paired_bootstrap(
            primary_current_eval[primary_current_eval["prediction_stage"] == "50%"],
            "unified_prediction",
            "deployed_current_prediction",
            "Unified vs CURRENT at 50%",
        ),
        "unified_vs_current_75": paired_bootstrap(
            primary_current_eval[primary_current_eval["prediction_stage"] == "75%"],
            "unified_prediction",
            "deployed_current_prediction",
            "Unified vs CURRENT at 75%",
        ),
        "unified_vs_current_p1": paired_bootstrap(
            p1_subset,
            "unified_prediction",
            "deployed_current_prediction",
            "Unified vs CURRENT on P1 25/50/75",
        ),
    }

    gates = lock["frozen_test_success_gates"]
    gate_results: dict[str, Any] = {}
    gate_results["gate_1_0pct_unified_vs_fair_next"] = {
        "population": "primary_supported_domain_intersection",
        "mae_degradation": fair_next_comparisons["primary_supported_domain_intersection"]["mae_difference_unified_minus_fair_next"],
        "allowed": gates["zero_percent_vs_fair_next_allowed_mae_degradation"],
    }
    gate_results["gate_2_25pct_unified_vs_current"] = {
        "mae_degradation": current_comparisons["25%"]["mae_difference_unified_minus_deployed_current"],
        "allowed": gates["stage_25_vs_deployed_current_allowed_mae_degradation"],
    }
    gate_results["gate_3_50pct_unified_vs_current"] = {
        "mae_degradation": current_comparisons["50%"]["mae_difference_unified_minus_deployed_current"],
        "allowed": gates["stage_50_vs_deployed_current_allowed_mae_degradation"],
    }
    gate_results["gate_4_75pct_unified_vs_current"] = {
        "mae_degradation": current_comparisons["75%"]["mae_difference_unified_minus_deployed_current"],
        "allowed": gates["stage_75_vs_deployed_current_allowed_mae_degradation"],
    }
    gate_results["gate_5_p1_safety"] = {
        "mae_degradation": p1_comparison["combined_25_50_75"]["mae_difference_unified_minus_deployed_current"],
        "allowed": gates["p1_25_50_75_allowed_mae_degradation_vs_current_evidence_control"],
    }
    gate_results["gate_6_overall_bias"] = {
        "primary_abs_bias": abs(primary_metrics["bias_mean_signed_error"]),
        "allowed": gates["overall_bias_limit_abs"],
    }

    severe_slice_violations = []
    for family, family_metrics in [
        ("stage", stage_metrics),
        ("period", period_metrics),
        ("subject", subject_metrics),
        ("weight_pattern", weight_metrics),
    ]:
        for name, item in family_metrics.items():
            if item.get("n", 0) >= 30 and abs(item.get("bias_mean_signed_error", 0.0)) >= gates["supported_slice_bias_limit_abs_n_ge_30"]:
                severe_slice_violations.append(
                    {
                        "family": family,
                        "slice": name,
                        "reason": "ABS_BIAS_EXCEEDS_SUPPORTED_SLICE_LIMIT",
                        "bias": item["bias_mean_signed_error"],
                        "n": item["n"],
                    }
                )
    gate_results["gate_7_supported_subject_stability"] = {
        "violations": [v for v in severe_slice_violations if v["family"] == "subject"],
    }
    gate_results["gate_8_period_stability"] = {
        "violations": [v for v in severe_slice_violations if v["family"] == "period"],
    }
    gate_results["gate_9_weight_pattern_stability"] = {
        "violations": [v for v in severe_slice_violations if v["family"] == "weight_pattern"],
    }

    for key, value in gate_results.items():
        if "allowed" in value:
            value["passed"] = value["mae_degradation"] is not None and value["mae_degradation"] <= value["allowed"] if "mae_degradation" in value else value["primary_abs_bias"] <= value["allowed"]
        elif "violations" in value:
            value["passed"] = len(value["violations"]) == 0
    gate_results["gate_6_overall_bias"]["passed"] = gate_results["gate_6_overall_bias"]["primary_abs_bias"] <= gate_results["gate_6_overall_bias"]["allowed"]

    pass_fail = {gate: ("PASS" if result["passed"] else "FAIL") for gate, result in gate_results.items()}
    verdict = "PASS" if all(result["passed"] for result in gate_results.values()) else "FAIL"

    frozen_predictions = frozen[
        [
            "row_identity",
            "raw_student_key",
            "student_period_key",
            "cohort_group_key",
            "subject_meta",
            "historical_period_sequence",
            "prediction_stage",
            "weight_pattern",
            devexp.TARGET_COLUMN,
            "unified_prediction",
        ]
    ].copy()
    frozen_predictions["domain_population"] = np.where(
        frozen_predictions["subject_meta"].isin(supported_subjects),
        "PRIMARY_SUPPORTED_DOMAIN",
        "DOMAIN_INCOMPATIBLE_STRESS_OR_UNSUPPORTED",
    )
    frozen_predictions_path = devexp.EXPERIMENT_DIR / "frozen_predictions.csv"
    frozen_predictions.to_csv(frozen_predictions_path, index=False)

    comparator_results = {
        "fair_next_0pct": fair_next_comparisons,
        "deployed_next_operational_reference": deployed_next_reference,
        "deployed_current_25_50_75": current_comparisons,
        "p1_safety": p1_comparison,
    }
    comparator_path = devexp.EXPERIMENT_DIR / "frozen_comparator_results.json"
    comparator_path.write_text(json.dumps(comparator_results, indent=2, sort_keys=True, default=str), encoding="utf-8")

    bootstrap_path = devexp.EXPERIMENT_DIR / "frozen_paired_bootstrap.json"
    bootstrap_path.write_text(json.dumps(paired, indent=2, sort_keys=True, default=str), encoding="utf-8")

    summary = {
        "task": "U4C_ONE_SHOT_LOCKED_FROZEN_TEST_EVALUATION",
        "created_at": datetime.now(timezone.utc).isoformat(),
        "evaluation_version": EVAL_VERSION,
        "lock_verification": verified["checks"],
        "candidate_lock_sha256": EXPECTED_LOCK_SHA256,
        "model_config_sha256": EXPECTED_MODEL_CONFIG_SHA256,
        "dataset_sha256": devexp.EXPECTED_DATASET_SHA256,
        "supported_subjects_primary": supported_subjects,
        "domain_incompatible_subjects": unsupported_subjects,
        "final_fit_confirmation": {
            "train_rows": int(len(dev)),
            "frozen_rows": int(len(frozen)),
            "train_contains_frozen_rows": False,
            "retuning_performed": False,
            "final_model_artifact": str(final_model_path),
            "final_model_artifact_sha256": final_model_sha,
        },
        "primary_supported_domain_metrics": primary_metrics,
        "all_frozen_diagnostic_not_primary": all_frozen_metrics,
        "stage_wise_primary_metrics": stage_metrics,
        "period_wise_primary_metrics": period_metrics,
        "supported_subject_metrics": subject_metrics,
        "weight_pattern_metrics": weight_metrics,
        "advanced_physics_stress_test": ap_metrics,
        "fair_next_0pct_comparison": fair_next_comparisons,
        "deployed_next_operational_reference": deployed_next_reference,
        "deployed_current_comparison": current_comparisons,
        "p1_safety_comparison": p1_comparison,
        "paired_bootstrap": paired,
        "bias_gate_results": {
            "overall_primary_bias": primary_metrics["bias_mean_signed_error"],
            "severe_slice_violations": severe_slice_violations,
        },
        "pass_fail_gate_table": gate_results,
        "pass_fail_labels": pass_fail,
        "u4c_verdict": verdict,
    }
    summary_path = devexp.EXPERIMENT_DIR / "frozen_test_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True, default=str), encoding="utf-8")

    manifest = {
        "created_at": summary["created_at"],
        "evaluation_version": EVAL_VERSION,
        "candidate_lock_sha256": EXPECTED_LOCK_SHA256,
        "model_config_sha256": EXPECTED_MODEL_CONFIG_SHA256,
        "dataset_sha256": devexp.EXPECTED_DATASET_SHA256,
        "final_model_artifact_sha256": final_model_sha,
        "fair_next_comparator_sha256": fair_next_sha,
        "frozen_predictions_sha256": sha256_file(frozen_predictions_path),
        "frozen_summary_sha256": sha256_file(summary_path),
        "frozen_comparator_results_sha256": sha256_file(comparator_path),
        "frozen_paired_bootstrap_sha256": sha256_file(bootstrap_path),
        "frozen_population_counts": {
            "all_frozen": int(len(frozen)),
            "primary_supported": int(len(primary)),
            "advanced_physics": int(len(advanced_physics)),
            "next_all_intersection": int(len(next_all_intersection)),
            "next_primary_intersection": int(len(next_primary_intersection)),
        },
        "candidate_lock_mutated": False,
    }
    manifest_path = devexp.EXPERIMENT_DIR / "u4c_evaluation_manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True, default=str), encoding="utf-8")
    print(
        json.dumps(
            {
                "status": "U4C_COMPLETE_ONE_SHOT_FROZEN_EVALUATION",
                "verdict": verdict,
                "primary_supported_mae": primary_metrics["mae"],
                "all_frozen_mae": all_frozen_metrics["mae"],
                "gate_labels": pass_fail,
                "summary": str(summary_path),
                "manifest": str(manifest_path),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()

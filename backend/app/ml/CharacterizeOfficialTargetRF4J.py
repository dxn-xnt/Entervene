"""Offline RF readiness, stability, and explainability audit for Task 4J."""

from __future__ import annotations

import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
import pandas as pd

from app.ml.BuildCurrentTermDevelopmentDataset import FEATURE_COLUMNS
from app.ml.EvaluateOfficialTargetRF4I import (
    BACKEND, OUTPUT_DIR as PREVIOUS_DIR, RAW_DIR, folds, measure, rf_pipeline,
    verify_data,
)
from app.services.prediction.CurrentPeriodFeatureBuilderService import check_current_period_readiness

OUTPUT_DIR = BACKEND / "data" / "experiments" / "official_target_rf_4j"
STAGES = (0.25, 0.5, 0.75)
GROUPS = {
    "WW": tuple(name for name in FEATURE_COLUMNS if name.startswith("ww_") and name != "ww_weight"),
    "PT": tuple(name for name in FEATURE_COLUMNS if name.startswith("pt_") and name != "pt_weight"),
    "QA": tuple(name for name in FEATURE_COLUMNS if name.startswith("qa_") and name != "qa_weight"),
    "AGGREGATE_COVERAGE": (
        "overall_available_activity_count", "observed_component_weight_sum",
        "overall_weighted_score_so_far", "overall_partial_percent", "has_any_input_evidence",
    ),
    "CONTEXT_WEIGHTS": ("grade_level", "ww_weight", "pt_weight", "qa_weight", "subject"),
}


def feature_groups() -> dict[str, list[str]]:
    union = [feature for group in GROUPS.values() for feature in group]
    if len(union) != len(FEATURE_COLUMNS) or set(union) != set(FEATURE_COLUMNS):
        raise AssertionError("Feature groups must be disjoint and exhaustive")
    return {key: list(value) for key, value in GROUPS.items()}


def replay_readiness(data: pd.DataFrame) -> tuple[pd.DataFrame, dict]:
    records = []
    for row in data.to_dict(orient="records"):
        result = check_current_period_readiness(row, unresolved_evidence=False)
        records.append((result["ready"], result["readiness_level"], "|".join(result["reason_codes"])))
    out = data.copy()
    out["runtime_feature_ready"] = [item[0] for item in records]
    out["readiness_level"] = [item[1] for item in records]
    out["readiness_reason"] = [item[2] for item in records]
    ready = out[out.runtime_feature_ready]
    first = ready.sort_values("snapshot_fraction").drop_duplicates("student_period_key", keep="first")
    latest = ready.sort_values("snapshot_fraction").drop_duplicates("student_period_key", keep="last")
    if len(first) != len(latest):
        raise AssertionError("First/latest ready counts disagree")
    def counts(column):
        return {str(key): int(value) for key, value in column.value_counts().sort_index().items()}
    report = {
        "ready_snapshots": len(ready), "not_ready_snapshots": len(out) - len(ready),
        "ready_periods": len(first), "never_ready_periods": data.student_period_key.nunique() - len(first),
        "by_stage": {str(stage): {"ready": int(out[out.snapshot_fraction.eq(stage)].runtime_feature_ready.sum()),
                                  "not_ready": int(out[out.snapshot_fraction.eq(stage)].runtime_feature_ready.eq(False).sum())}
                     for stage in STAGES},
        "first_ready_stage_periods": counts(first.snapshot_fraction),
        "latest_ready_stage_periods": counts(latest.snapshot_fraction),
        "readiness_levels": counts(out.readiness_level),
        "not_ready_reasons": counts(out.loc[~out.runtime_feature_ready, "readiness_reason"]),
        "ready_snapshots_by_subject": counts(ready.subject),
        "ready_snapshots_by_grade": counts(ready.grade_level),
        "ready_snapshots_by_workbook": counts(ready.source_file),
    }
    return out, report


def aligned_predictions(data: pd.DataFrame) -> pd.DataFrame:
    predictions = pd.read_csv(PREVIOUS_DIR / "holdout_predictions.csv")
    if len(predictions) != len(data):
        raise ValueError("Task 4I predictions no longer align with candidate data")
    keys = data[["student_period_key", "snapshot_fraction", "runtime_feature_ready", "readiness_level", "readiness_reason"]].copy()
    keys["pseudonymous_period_id"] = keys.student_period_key.map(lambda value: hashlib.sha256(value.encode()).hexdigest())
    joined = predictions.merge(keys.drop(columns="student_period_key"),
                               on=["pseudonymous_period_id", "snapshot_fraction"],
                               validate="one_to_one")
    if len(joined) != len(data):
        raise ValueError("Task 4I held-out predictions do not cover every snapshot")
    return joined


def _selected_ready(rows: pd.DataFrame, first: bool) -> pd.DataFrame:
    return rows[rows.runtime_feature_ready].sort_values("snapshot_fraction").drop_duplicates(
        "pseudonymous_period_id", keep="first" if first else "last")


def _row_metrics(rows: pd.DataFrame) -> dict:
    out = {"periods": len(rows), "stage_distribution": {str(k): int(v) for k, v in rows.snapshot_fraction.value_counts().sort_index().items()}}
    for method in ("rf", "global_mean", "subject_mean", "grade_subject_mean", "linear", "academic"):
        eligible = rows[np.isfinite(rows[method])]
        out[method] = measure(eligible.actual, eligible[method]) if len(eligible) else {"n": 0, "status": "NOT_COMPARABLE"}
        if len(eligible):
            rf_same = measure(eligible.actual, eligible.rf)
            out[method]["rf_same_rows_mae"] = rf_same["mae"]
            out[method]["mae_advantage_rf"] = round(out[method]["mae"] - rf_same["mae"], 4)
            out[method]["mae_advantage_rf_pct"] = round(
                (out[method]["mae"] - rf_same["mae"]) / out[method]["mae"] * 100, 2)
    error = np.abs(rows.rf.to_numpy() - rows.actual.to_numpy())
    out["rf_abs_error_distribution"] = {
        "median": round(float(np.median(error)), 4), "p75": round(float(np.quantile(error, .75)), 4),
        "p90": round(float(np.quantile(error, .90)), 4), "maximum": round(float(error.max()), 4),
    }
    out["rf_by_actual_band"] = {}
    for label, low, high in (("80-84", 80, 85), ("85-89", 85, 90), ("90+", 90, np.inf)):
        band = rows[rows.actual.ge(low) & rows.actual.lt(high)]
        out["rf_by_actual_band"][label] = measure(band.actual, band.rf) if len(band) else {"n": 0, "status": "NOT_EVALUABLE"}
    return out


def readiness_metrics(predictions: pd.DataFrame) -> dict:
    views = {
        "seen_subject": predictions[predictions.fold_class.eq("SEEN_SUBJECT_HOLDOUT")],
        "exact_live": predictions[predictions.runtime_exact_match],
        "unseen_ict": predictions[predictions.fold_class.eq("UNSEEN_SUBJECT_HOLDOUT")],
    }
    return {name: {"first": _row_metrics(_selected_ready(frame, True)),
                   "latest": _row_metrics(_selected_ready(frame, False))}
            for name, frame in views.items()}


def _fit_rf(train: pd.DataFrame, features: list[str], *, seed: int = 42, trees: int = 300):
    model = rf_pipeline(features)
    model.named_steps["regressor"].set_params(random_state=seed, n_estimators=trees)
    model.fit(train[features], train.target_final_period_grade)
    model.named_steps["regressor"].n_jobs = 1
    return model


def _permutation_deltas(model, test: pd.DataFrame, features: list[str], selected: list[str], *, seed: int) -> list[float]:
    if len(test) < 2:
        return []
    baseline = float(np.mean(np.abs(model.predict(test[features]) - test.target_final_period_grade)))
    rng = np.random.default_rng(seed)
    deltas = []
    for _ in range(2):
        permuted = test[features].copy()
        order = rng.permutation(len(test))
        permuted.loc[:, selected] = permuted.iloc[order][selected].to_numpy()
        changed = float(np.mean(np.abs(model.predict(permuted) - test.target_final_period_grade)))
        deltas.append(changed - baseline)
    return deltas


def explain_and_stability(data: pd.DataFrame, plan: list[dict]) -> dict:
    """Characterize fixed RF only; no winner selection or hyperparameter change."""
    features = list(FEATURE_COLUMNS)
    seen = [fold for fold in plan if fold["class"] == "SEEN_SUBJECT_HOLDOUT"]
    individual: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    grouped: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    ablations: dict[str, list[dict]] = defaultdict(list)
    seed_scores: dict[int, list[dict]] = defaultdict(list)
    for index, fold in enumerate(seen):
        filename = fold["file"]
        train = data[~data.source_file.eq(filename)]
        test = data[data.source_file.eq(filename)]
        model = _fit_rf(train, features)
        for stage in STAGES:
            held = test[test.snapshot_fraction.eq(stage)]
            for feature in features:
                deltas = _permutation_deltas(model, held, features, [feature], seed=1000 + index)
                individual[str(stage)][feature].append({"fold": filename, "delta_mae": float(np.mean(deltas))})
            for group, members in GROUPS.items():
                deltas = _permutation_deltas(model, held, features, list(members), seed=2000 + index)
                grouped[str(stage)][group].append({"fold": filename, "delta_mae": float(np.mean(deltas))})
        ready = test[test.runtime_feature_ready]
        first = ready.sort_values("snapshot_fraction").drop_duplicates("student_period_key", keep="first")
        latest = ready.sort_values("snapshot_fraction").drop_duplicates("student_period_key", keep="last")
        for label, held in (("first", first), ("latest", latest)):
            if not len(held):
                continue
            baseline = measure(held.target_final_period_grade, model.predict(held[features]))
            ablations["full"].append({"fold": filename, "point": label, "n": len(held), "mae": baseline["mae"]})
            seed_scores[42].append({"fold": filename, "point": label, "n": len(held),
                                    "actual": held.target_final_period_grade.to_numpy().tolist(),
                                    "predicted": model.predict(held[features]).tolist()})
        for group, members in {**GROUPS, "SUBJECT_ONLY": ("subject",)}.items():
            kept = [feature for feature in features if feature not in members]
            ablated = _fit_rf(train, kept)
            for label, held in (("first", first), ("latest", latest)):
                if len(held):
                    result = measure(held.target_final_period_grade, ablated.predict(held[kept]))
                    ablations[group].append({"fold": filename, "point": label, "n": len(held), "mae": result["mae"],
                                             "actual": held.target_final_period_grade.to_numpy().tolist(),
                                             "predicted": ablated.predict(held[kept]).tolist()})
        for seed in (43, 44, 45, 46):
            alternative = _fit_rf(train, features, seed=seed)
            for label, held in (("first", first), ("latest", latest)):
                if len(held):
                    seed_scores[seed].append({"fold": filename, "point": label, "n": len(held),
                                              "actual": held.target_final_period_grade.to_numpy().tolist(),
                                              "predicted": alternative.predict(held[features]).tolist()})
        print(f"characterized {index + 1}/{len(seen)}: {filename}", flush=True)

    def importance_summary(source):
        result = {}
        for stage, items in source.items():
            result[stage] = {}
            names = list(items)
            fold_ranks: dict[str, list[int]] = defaultdict(list)
            for filename in (fold["file"] for fold in seen):
                ranked = sorted(names, key=lambda name: next(entry["delta_mae"] for entry in items[name] if entry["fold"] == filename), reverse=True)
                for rank, name in enumerate(ranked, 1):
                    fold_ranks[name].append(rank)
            for name, entries in items.items():
                values = np.array([entry["delta_mae"] for entry in entries])
                ranks = fold_ranks[name]
                result[stage][name] = {"mean_delta_mae": round(float(values.mean()), 4),
                                       "std_across_folds": round(float(values.std()), 4),
                                       "positive_folds": int(np.sum(values > 0)),
                                       "top5_folds": sum(rank <= 5 for rank in ranks),
                                       "median_rank": float(np.median(ranks))}
        return result

    def pooled(entries, point):
        selected = [row for row in entries if row["point"] == point]
        actual = [value for row in selected for value in row["actual"]]
        predicted = [value for row in selected for value in row["predicted"]]
        return measure(actual, predicted)

    return {
        "permutation_individual": importance_summary(individual),
        "permutation_groups": importance_summary(grouped),
        "ablation": {name: {point: pooled(entries, point) for point in ("first", "latest")}
                     for name, entries in ablations.items() if name != "full"},
        "seed_stability": {str(seed): {point: pooled(entries, point) for point in ("first", "latest")}
                           for seed, entries in seed_scores.items()},
        "permutation_note": "Within-workbook permutation cannot measure constant context fields such as subject, grade, or weights; subject value is tested by drop-column ablation.",
    }


def tree_count_diagnostic(data: pd.DataFrame, plan: list[dict]) -> dict:
    """Fixed descriptive counts only; do not select a count from held-out results."""
    features = list(FEATURE_COLUMNS)
    results: dict[int, dict[str, dict[str, list[float]]]] = defaultdict(
        lambda: defaultdict(lambda: {"actual": [], "predicted": []}))
    seen = [fold for fold in plan if fold["class"] == "SEEN_SUBJECT_HOLDOUT"]
    for index, fold in enumerate(seen, 1):
        train = data[~data.source_file.eq(fold["file"])]
        ready = data[data.source_file.eq(fold["file"]) & data.runtime_feature_ready]
        first = ready.sort_values("snapshot_fraction").drop_duplicates("student_period_key", keep="first")
        latest = ready.sort_values("snapshot_fraction").drop_duplicates("student_period_key", keep="last")
        for trees in (100, 200, 300, 500):
            model = _fit_rf(train, features, trees=trees)
            for point, held in (("first", first), ("latest", latest)):
                results[trees][point]["actual"].extend(held.target_final_period_grade.to_numpy().tolist())
                results[trees][point]["predicted"].extend(model.predict(held[features]).tolist())
        print(f"tree-count diagnostic {index}/{len(seen)}: {fold['file']}", flush=True)
    return {str(trees): {point: measure(values["actual"], values["predicted"])
                         for point, values in points.items()} for trees, points in results.items()}


def run() -> dict:
    data, verification = verify_data()
    feature_groups()
    data, replay = replay_readiness(data)
    predictions = aligned_predictions(data)
    plan = folds(data)
    report = {"verification": verification, "feature_groups": feature_groups(),
              "readiness_replay": replay, "runtime_ready_metrics": readiness_metrics(predictions),
              "characterization": explain_and_stability(data, plan),
              "tree_count_diagnostic": tree_count_diagnostic(data, plan),
              "status": {"lifecycle": "DEVELOPMENT", "is_active": False,
                         "production_validated": False, "independent_three_term_validation": False}}
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUTPUT_DIR / "characterization_report.json").write_text(
        json.dumps(report, indent=2, sort_keys=True, allow_nan=False) + "\n", encoding="utf-8")
    return report


if __name__ == "__main__":
    result = run()
    print(json.dumps({"readiness": result["readiness_replay"],
                      "status": result["status"]}, indent=2, sort_keys=True))

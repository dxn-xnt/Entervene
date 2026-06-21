from __future__ import annotations

import argparse
import csv
import json
import math
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline


TRAIN_FILENAME = "03_random_forest_regression_train.csv"
TEST_FILENAME = "04_random_forest_regression_test.csv"
PREFERRED_TARGET = "target_next_period_grade"
TARGET_CANDIDATES = [
    PREFERRED_TARGET,
    "next_period_grade",
    "target_period_grade",
    "target_grade",
]
COLUMN_MAPPINGS = {
    "quarterly_assessment_percent": "periodical_assessment_percent",
}
RANDOM_STATE = 42

DATASET_WARNING = (
    "The current dataset uses synthetic learner identities for development traceability only. "
    "It must not be treated as verified production learner data."
)
CLASSIFIER_WARNING = (
    "The current dataset contains zero below-75 target examples, so this model is a regression "
    "prototype and not a validated at-risk classifier."
)
THREE_TERM_READINESS_WARNING = (
    "The current ML pack is quarter-based. Future three-term data should include period_type, "
    "total_periods_in_year, and period_progress_ratio."
)

EXACT_EXCLUDED_COLUMNS = {
    "row_id",
    "split",
    "student_id",
    "student_lrn",
    "lrn",
    "learner_name",
    "first_name",
    "middle_name",
    "last_name",
    "full_name",
    "name",
    "section",
    "section_name",
    "academic_year_name",
    "school_year",
    "source_file_name",
    "source_file",
    "file",
    "roster_index",
    "target_next_period_grade",
    "next_period_grade",
    "final_grade",
    "final_period_grade",
    "prototype_monitoring_target_below_90",
    "actual_failure_target_below_75",
}
CONTAINS_EXCLUDED_TERMS = (
    "student_lrn",
    "learner_name",
    "first_name",
    "middle_name",
    "last_name",
    "full_name",
    "section_name",
    "academic_year_name",
    "source_file",
    "source_file_name",
    "roster_index",
    "final_grade",
    "final_period_grade",
    "prototype_monitoring_target_below_90",
)


def load_csv(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Required CSV file not found: {path}")
    return pd.read_csv(path)


def detect_target_column(columns: list[str]) -> str:
    for candidate in TARGET_CANDIDATES:
        if candidate in columns:
            return candidate
    raise ValueError(
        "Target column not found. Expected one of: "
        f"{', '.join(TARGET_CANDIDATES)}"
    )


def apply_column_mappings(df: pd.DataFrame) -> tuple[pd.DataFrame, dict[str, str]]:
    applied: dict[str, str] = {}
    mapped = df.copy()
    for source, target in COLUMN_MAPPINGS.items():
        if source in mapped.columns and target not in mapped.columns:
            mapped = mapped.rename(columns={source: target})
            applied[source] = target
    return mapped, applied


def should_exclude_column(column: str, target_column: str) -> bool:
    lower = column.lower()
    if column == target_column or lower in EXACT_EXCLUDED_COLUMNS:
        return True
    if "student_id" in lower:
        return True
    if lower.endswith("_id") and not lower.startswith("subject_"):
        return True
    if lower in {"source", "file"}:
        return True
    return any(term in lower for term in CONTAINS_EXCLUDED_TERMS)


def select_feature_columns(columns: list[str], target_column: str) -> tuple[list[str], list[str]]:
    excluded = [column for column in columns if should_exclude_column(column, target_column)]
    features = [column for column in columns if column not in excluded]
    return features, excluded


def validate_numeric_features(df: pd.DataFrame, feature_columns: list[str]) -> None:
    non_numeric = [
        column
        for column in feature_columns
        if not pd.api.types.is_numeric_dtype(pd.to_numeric(df[column], errors="coerce"))
        and df[column].notna().any()
    ]
    # Object columns containing numeric strings pass the dtype check above poorly,
    # so verify conversion instead of trusting the original CSV dtype.
    non_numeric = [
        column
        for column in feature_columns
        if df[column].notna().any()
        and pd.to_numeric(df[column], errors="coerce").isna().sum() > df[column].isna().sum()
    ]
    if non_numeric:
        raise ValueError(
            "Non-numeric feature columns remain after exclusions: "
            f"{', '.join(sorted(non_numeric))}"
        )


def calculate_metrics(y_true: pd.Series, y_pred: Any) -> dict[str, float]:
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": float(math.sqrt(mean_squared_error(y_true, y_pred))),
        "r2_score": float(r2_score(y_true, y_pred)),
    }


def count_unique_students(df: pd.DataFrame) -> int | None:
    if "student_id" not in df.columns:
        return None
    return int(df["student_id"].dropna().astype(str).nunique())


def count_student_overlap(train_df: pd.DataFrame, test_df: pd.DataFrame) -> int | None:
    if "student_id" not in train_df.columns or "student_id" not in test_df.columns:
        return None
    train_ids = set(train_df["student_id"].dropna().astype(str))
    test_ids = set(test_df["student_id"].dropna().astype(str))
    return len(train_ids & test_ids)


def build_model() -> Pipeline:
    return Pipeline(
        steps=[
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
    )


def write_feature_importance(path: Path, feature_columns: list[str], importances: Any) -> None:
    rows = sorted(
        zip(feature_columns, [float(value) for value in importances]),
        key=lambda item: item[1],
        reverse=True,
    )
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["feature_name", "importance", "rank"])
        writer.writeheader()
        for rank, (feature_name, importance) in enumerate(rows, start=1):
            writer.writerow(
                {
                    "feature_name": feature_name,
                    "importance": importance,
                    "rank": rank,
                }
            )


def train_model(ml_dir: Path, output_dir: Path, model_name: str) -> dict[str, Any]:
    train_file = ml_dir / TRAIN_FILENAME
    test_file = ml_dir / TEST_FILENAME
    train_df = load_csv(train_file)
    test_df = load_csv(test_file)

    target_column = detect_target_column(list(train_df.columns))
    train_df, train_mappings = apply_column_mappings(train_df)
    test_df, test_mappings = apply_column_mappings(test_df)
    column_mappings = {**test_mappings, **train_mappings}
    if target_column in COLUMN_MAPPINGS:
        target_column = COLUMN_MAPPINGS[target_column]

    if target_column not in test_df.columns:
        raise ValueError(f"Detected target column is missing from test CSV: {target_column}")

    feature_columns, excluded_columns = select_feature_columns(list(train_df.columns), target_column)
    missing_in_test = [column for column in feature_columns if column not in test_df.columns]
    if missing_in_test:
        raise ValueError(f"Feature columns missing from test CSV: {', '.join(missing_in_test)}")

    validate_numeric_features(train_df, feature_columns)
    validate_numeric_features(test_df, feature_columns)

    X_train = train_df[feature_columns].apply(pd.to_numeric, errors="coerce")
    y_train = pd.to_numeric(train_df[target_column], errors="coerce")
    X_test = test_df[feature_columns].apply(pd.to_numeric, errors="coerce")
    y_test = pd.to_numeric(test_df[target_column], errors="coerce")

    if y_train.isna().any() or y_test.isna().any():
        raise ValueError("Target column contains non-numeric or missing values.")

    model = build_model()
    model.fit(X_train, y_train)
    predictions = model.predict(X_test)
    metrics = calculate_metrics(y_test, predictions)

    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = output_dir / f"{model_name}.joblib"
    report_path = output_dir / f"{model_name}_training_report.json"
    schema_path = output_dir / f"{model_name}_feature_schema.json"
    importance_path = output_dir / f"{model_name}_feature_importance.csv"

    artifact = {
        "model": model,
        "feature_columns": feature_columns,
        "target_column": target_column,
        "column_mappings": column_mappings,
    }
    joblib.dump(artifact, model_path)

    required_runtime_columns = [
        next((source for source, target in column_mappings.items() if target == column), column)
        for column in feature_columns
    ]
    schema = {
        "feature_columns": feature_columns,
        "target_column": target_column,
        "excluded_columns": excluded_columns,
        "column_mappings": column_mappings,
        "required_runtime_columns": required_runtime_columns,
    }
    schema_path.write_text(json.dumps(schema, indent=2, sort_keys=True), encoding="utf-8")

    regressor = model.named_steps["regressor"]
    write_feature_importance(importance_path, feature_columns, regressor.feature_importances_)

    report = {
        "model_name": model_name,
        "model_type": "REGRESSOR",
        "algorithm": "RandomForestRegressor",
        "target_column": target_column,
        "train_file": str(train_file),
        "test_file": str(test_file),
        "training_row_count": int(len(train_df)),
        "test_row_count": int(len(test_df)),
        "train_unique_students": count_unique_students(train_df),
        "test_unique_students": count_unique_students(test_df),
        "student_overlap_count": count_student_overlap(train_df, test_df),
        "mae": metrics["mae"],
        "rmse": metrics["rmse"],
        "r2_score": metrics["r2_score"],
        "feature_count": len(feature_columns),
        "feature_columns": feature_columns,
        "excluded_columns": excluded_columns,
        "column_mappings": column_mappings,
        "random_state": RANDOM_STATE,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "dataset_warning": DATASET_WARNING,
        "classifier_warning": CLASSIFIER_WARNING,
        "three_term_readiness_warning": THREE_TERM_READINESS_WARNING,
        "ready_for_task_4": True,
        "artifact_paths": {
            "model": str(model_path),
            "training_report": str(report_path),
            "feature_schema": str(schema_path),
            "feature_importance": str(importance_path),
        },
    }
    report_path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")
    return report


def print_summary(report: dict[str, Any]) -> None:
    print("RandomForestRegressor training summary")
    print(f"Model name: {report['model_name']}")
    print(f"Target column: {report['target_column']}")
    print(f"Rows: train={report['training_row_count']}, test={report['test_row_count']}")
    print(f"Unique students: train={report['train_unique_students']}, test={report['test_unique_students']}")
    print(f"Student overlap: {report['student_overlap_count']}")
    print(f"Feature count: {report['feature_count']}")
    print(f"MAE: {report['mae']:.4f}")
    print(f"RMSE: {report['rmse']:.4f}")
    print(f"R2: {report['r2_score']:.4f}")
    print(f"Model artifact: {report['artifact_paths']['model']}")
    print(f"Training report: {report['artifact_paths']['training_report']}")
    print(f"Feature schema: {report['artifact_paths']['feature_schema']}")
    print(f"Feature importance: {report['artifact_paths']['feature_importance']}")
    print(report["classifier_warning"])
    print(report["three_term_readiness_warning"])


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Train Entervene next-period grade regression prototype.")
    parser.add_argument("--ml-dir", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--model-name", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    report = train_model(args.ml_dir, args.output_dir, args.model_name)
    print_summary(report)


if __name__ == "__main__":
    main()

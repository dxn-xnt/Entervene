from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

BACKEND_DIR = Path(__file__).resolve().parents[2]
DATASET_PATH = BACKEND_DIR / "data" / "datasets" / "current_term_development" / "current_term_development_snapshots.csv"
SUMMARY_PATH = BACKEND_DIR / "data" / "datasets" / "current_term_development" / "current_term_development_summary.json"
MODELS_DIR = BACKEND_DIR / "data" / "models"
MODEL_NAME = "entervene_current_term_development_rf_v3"
TARGET_COLUMN = "target_final_period_grade"
RANDOM_STATE = 42


def one_hot_encoder() -> OneHotEncoder:
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        return OneHotEncoder(handle_unknown="ignore", sparse=False)


def metrics(y_true: Any, y_pred: Any) -> dict[str, Any]:
    y_true = np.asarray(y_true, dtype=float)
    y_pred = np.asarray(y_pred, dtype=float)
    abs_error = np.abs(y_pred - y_true)
    return {
        "n": int(len(y_true)),
        "mae": round(float(mean_absolute_error(y_true, y_pred)), 4),
        "rmse": round(float(math.sqrt(mean_squared_error(y_true, y_pred))), 4),
        "r2": round(float(r2_score(y_true, y_pred)), 4) if len(y_true) > 1 else None,
        "within_1": round(float(np.mean(abs_error <= 1.0) * 100.0), 2),
        "within_2": round(float(np.mean(abs_error <= 2.0) * 100.0), 2),
        "within_3": round(float(np.mean(abs_error <= 3.0) * 100.0), 2),
    }


def build_preprocessor(features: list[str]) -> ColumnTransformer:
    numeric_features = [feature for feature in features if feature != "subject"]
    categorical_features = [feature for feature in features if feature == "subject"]
    return ColumnTransformer(
        [
            ("num", Pipeline([("imputer", SimpleImputer(strategy="median"))]), numeric_features),
            ("cat", one_hot_encoder(), categorical_features),
        ]
    )


def linear_pipeline(features: list[str]) -> Pipeline:
    numeric_features = [feature for feature in features if feature != "subject"]
    categorical_features = [feature for feature in features if feature == "subject"]
    preprocessor = ColumnTransformer(
        [
            (
                "num",
                Pipeline([
                    ("imputer", SimpleImputer(strategy="median")),
                    ("scaler", StandardScaler()),
                ]),
                numeric_features,
            ),
            ("cat", one_hot_encoder(), categorical_features),
        ]
    )
    return Pipeline([("preprocessor", preprocessor), ("regressor", LinearRegression())])


def rf_pipeline(features: list[str]) -> Pipeline:
    return Pipeline(
        [
            ("preprocessor", build_preprocessor(features)),
            (
                "regressor",
                RandomForestRegressor(
                    n_estimators=300,
                    max_depth=None,
                    max_features=0.5,
                    min_samples_leaf=2,
                    min_samples_split=5,
                    random_state=RANDOM_STATE,
                    n_jobs=-1,
                ),
            ),
        ]
    )


def slice_metrics(df: pd.DataFrame, predictions: np.ndarray, column: str, values: list[str], min_n: int = 30) -> dict[str, Any]:
    out: dict[str, Any] = {}
    frame = df.copy()
    frame["_prediction"] = predictions
    for value in values:
        group = frame[frame[column].astype(str) == value]
        if len(group) < min_n:
            out[value] = {"n": int(len(group)), "status": "too_few_samples"}
            continue
        out[value] = metrics(group[TARGET_COLUMN], group["_prediction"])
    return out


def feature_importance(pipe: Pipeline) -> list[dict[str, Any]]:
    preprocessor = pipe.named_steps["preprocessor"]
    regressor = pipe.named_steps["regressor"]
    names = list(preprocessor.get_feature_names_out())
    importances = list(regressor.feature_importances_)
    ranked = sorted(zip(names, importances), key=lambda item: item[1], reverse=True)
    return [
        {"feature": str(name), "importance": round(float(value), 8)}
        for name, value in ranked[:10]
    ]


def train_and_evaluate() -> dict[str, Any]:
    summary = json.loads(SUMMARY_PATH.read_text(encoding="utf-8"))
    features = list(summary["feature_columns"])
    df = pd.read_csv(DATASET_PATH)
    train_df = df[df["split"] == "train"].copy()
    validation_df = df[df["split"] == "validation"].copy()
    test_df = df[df["split"] == "test"].copy()

    linear = linear_pipeline(features)
    rf = rf_pipeline(features)

    linear.fit(train_df[features], train_df[TARGET_COLUMN])
    rf.fit(train_df[features], train_df[TARGET_COLUMN])

    linear_validation_pred = linear.predict(validation_df[features])
    rf_validation_pred = rf.predict(validation_df[features])
    linear_validation = metrics(validation_df[TARGET_COLUMN], linear_validation_pred)
    rf_validation = metrics(validation_df[TARGET_COLUMN], rf_validation_pred)
    rf_wins = rf_validation["mae"] < linear_validation["mae"]

    report: dict[str, Any] = {
        "model_name": MODEL_NAME,
        "development_status": "DEVELOPMENT_ONLY",
        "production_validated": False,
        "independent_three_term_validation": False,
        "dataset_path": str(DATASET_PATH),
        "dataset_sha256": summary.get("dataset_sha256"),
        "target_column": TARGET_COLUMN,
        "feature_columns": features,
        "train_rows": int(len(train_df)),
        "validation_rows": int(len(validation_df)),
        "test_rows": int(len(test_df)),
        "linear_regression_validation": linear_validation,
        "random_forest_validation": rf_validation,
        "selection_rule": "Select lower validation MAE; test set is used once after selection.",
        "selected_model": "RandomForestRegressor" if rf_wins else "LinearRegression",
        "artifacts_saved": False,
        "limitations": [
            "Development-only model; production validation is false.",
            "Independent real three-term validation is false.",
            "Historical QA aggregate is used as the exam analogue; ST1/ST2/Term Exam are not fabricated.",
            "This is a grade-projection regression model, not a validated failure classifier.",
        ],
    }

    if rf_wins:
        test_pred = rf.predict(test_df[features])
        report["test_metrics"] = metrics(test_df[TARGET_COLUMN], test_pred)
        report["test_by_weight_pattern"] = slice_metrics(test_df, test_pred, "weight_pattern", ["20/50/30", "20/60/20"])
        report["test_by_subject"] = slice_metrics(
            test_df,
            test_pred,
            "subject",
            ["MATHEMATICS", "SCIENCE", "ENGLISH", "ICT", "CREATIVE_TECHNOLOGY"],
        )
        report["top_10_rf_feature_importances"] = feature_importance(rf)

        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        artifact = {
            "model_name": MODEL_NAME,
            "development_status": "DEVELOPMENT_ONLY",
            "production_validated": False,
            "independent_three_term_validation": False,
            "pipeline": rf,
            "target_column": TARGET_COLUMN,
            "feature_columns": features,
            "dataset_sha256": summary.get("dataset_sha256"),
            "random_state": RANDOM_STATE,
        }
        model_path = MODELS_DIR / f"{MODEL_NAME}.joblib"
        schema_path = MODELS_DIR / f"{MODEL_NAME}_feature_schema.json"
        report_path = MODELS_DIR / f"{MODEL_NAME}_training_report.json"
        importance_path = MODELS_DIR / f"{MODEL_NAME}_feature_importance.csv"
        joblib.dump(artifact, model_path)
        schema = {
            "model_name": MODEL_NAME,
            "development_status": "DEVELOPMENT_ONLY",
            "production_validated": False,
            "independent_three_term_validation": False,
            "target_column": TARGET_COLUMN,
            "feature_columns": features,
            "categorical_features": ["subject"],
            "numeric_features": [feature for feature in features if feature != "subject"],
            "supported_weight_patterns": summary.get("supported_weight_patterns"),
            "supported_subjects": summary.get("supported_subjects"),
            "historical_exam_semantics": summary.get("historical_exam_semantics"),
        }
        schema_path.write_text(json.dumps(schema, indent=2, sort_keys=True), encoding="utf-8")
        with importance_path.open("w", encoding="utf-8", newline="") as handle:
            handle.write("feature,importance\n")
            for row in feature_importance(rf):
                handle.write(f"{row['feature']},{row['importance']}\n")
        report["artifact_paths"] = {
            "model": str(model_path),
            "feature_schema": str(schema_path),
            "training_report": str(report_path),
            "feature_importance": str(importance_path),
        }
        report["artifacts_saved"] = True
        report_path.write_text(json.dumps(report, indent=2, sort_keys=True), encoding="utf-8")

    return report


if __name__ == "__main__":
    print(json.dumps(train_and_evaluate(), indent=2, sort_keys=True))

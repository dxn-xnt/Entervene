from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any, Dict

import joblib
import pandas as pd


ML_DIR = Path(__file__).resolve().parent.parent / "ml"


@lru_cache(maxsize=1)
def _load_artifacts():
    """
    Load model + expected feature columns once per process.

    Notes:
    - Your repo currently has `Model.pkl` (capital M). `Train.py` writes to
      `model.pkl` (lowercase). We support either filename so deployment on
      case-sensitive filesystems won't break.
    """
    model_path_candidates = [ML_DIR / "model.pkl", ML_DIR / "Model.pkl"]
    model_path = next((p for p in model_path_candidates if p.exists()), None)
    if model_path is None:
        raise FileNotFoundError(
            f"Model file not found. Tried: {', '.join(str(p) for p in model_path_candidates)}"
        )

    features_path = ML_DIR / "feature_columns.pkl"
    if not features_path.exists():
        raise FileNotFoundError(f"Feature columns file not found: {features_path}")

    model = joblib.load(model_path)
    feature_columns = joblib.load(features_path)
    return model, list(feature_columns)


def predict_risk(raw_features: Dict[str, Any]) -> Dict[str, Any]:
    """
    Predict student risk from a dict of raw inputs.

    The model was trained on one-hot encoded categorical fields, so we:
    - one-hot encode the incoming row
    - add any missing training columns with 0
    - reorder columns to match training
    """
    model, feature_columns = _load_artifacts()

    df = pd.DataFrame([raw_features])
    df_encoded = pd.get_dummies(df)

    for col in feature_columns:
        if col not in df_encoded.columns:
            df_encoded[col] = 0
    df_encoded = df_encoded[feature_columns]

    proba = float(model.predict_proba(df_encoded)[0][1])
    pred = int(model.predict(df_encoded)[0])

    return {
        "prediction": pred,  # 1 = at risk, 0 = not at risk
        "risk_probability": proba,
    }

import joblib
import pandas as pd
from pathlib import Path

MODEL_PATH = Path(__file__).parent.parent / "ml" / "model.pkl"
FEATURES_PATH = Path(__file__).parent.parent / "ml" / "feature_columns.pkl"

_model = None
_feature_columns = None


def get_model():
    global _model, _feature_columns
    if _model is None:
        _model = joblib.load(MODEL_PATH)
        _feature_columns = joblib.load(FEATURES_PATH)
    return _model, _feature_columns


def get_risk_level(prob: float) -> str:
    if prob >= 0.80:
        return "critical"
    elif prob >= 0.60:
        return "high"
    elif prob >= 0.40:
        return "moderate"
    else:
        return "low"


def predict_risk(student_features: dict) -> dict:
    model, feature_columns = get_model()

    df = pd.DataFrame([student_features])
    df = pd.get_dummies(df)
    df = df.reindex(columns=feature_columns, fill_value=0)

    prob = float(model.predict_proba(df)[0][1])
    risk_level = get_risk_level(prob)
    is_at_risk = prob >= 0.5

    # Top 5 features driving this prediction
    importances = dict(zip(feature_columns, model.feature_importances_))
    top_factors = sorted(importances.items(), key=lambda x: x[1], reverse=True)[:5]

    return {
        "is_at_risk": is_at_risk,
        "risk_level": risk_level,
        "risk_probability": round(prob, 4),
        "top_risk_factors": [
            {"feature": k, "importance": round(v, 4)} for k, v in top_factors
        ],
    }
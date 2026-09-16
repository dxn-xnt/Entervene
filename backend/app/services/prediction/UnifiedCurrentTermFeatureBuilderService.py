"""Runtime feature builder for UNIFIED_CURRENT_TERM_PROJECTION.

This service reuses the validated current-period WW/PT/QA evidence builder and
adds only the Unified V2 runtime context: previous finalized period grade and
current period progress ratio.
"""

from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import UUID

import pandas as pd
from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.ai.AIModelVersion import ModelPurpose
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    build_current_period_features_from_records,
)

MODEL_NAME = "unified_current_term_projection_v2"
MODEL_PURPOSE = ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value
SCHEMA_PATH = Path(__file__).resolve().parents[3] / "data" / "models" / f"{MODEL_NAME}_feature_schema.json"
ARTIFACT_PATH = Path(__file__).resolve().parents[3] / "data" / "models" / f"{MODEL_NAME}.joblib"
EVIDENCE_CONTRACT_VERSION = "u5b-unified-current-term-v2"
SNAPSHOT_VERSION = "prediction-evidence-v4-unified-current-term"
BLOCKING_WARNING_CODES = {"DOMAIN_UNSUPPORTED", "UNSUPPORTED_SUBJECT", "UNSUPPORTED_WEIGHT_PATTERN"}


def _normalize_unified_subject_label(subject: Subject) -> str:
    raw = subject.subject_codename or subject.subject_name or ""
    text = re.sub(r"[^A-Za-z0-9]+", "_", raw).strip("_").upper()
    text = re.sub(r"_(G?RADE_?)?\d+$", "", text)
    text = re.sub(r"\d+$", "", text)
    aliases = {
        "ADVANCED_PHYSICS": "ADVANCED_PHYSICS",
        "AP": "ARALING_PANLIPUNAN",
        "ARALING_PANLIPUNAN": "ARALING_PANLIPUNAN",
        "CREATIVE_TECH": "CREATIVE_TECHNOLOGY",
        "CREATIVE_TECHNOLOGY": "CREATIVE_TECHNOLOGY",
        "CT": "CREATIVE_TECHNOLOGY",
        "ELECTRONICS": "ELECTRONICS",
        "ELEC": "ELECTRONICS",
        "ENGLISH": "ENGLISH",
        "ENG": "ENGLISH",
        "ICT": "ICT",
        "MATH": "MATHEMATICS",
        "MATHEMATICS": "MATHEMATICS",
        "EMATH": "MATHEMATICS",
        "MAPEH": "MAPEH",
        "PEHM": "MAPEH",
        "SCI": "SCIENCE",
        "SCIE": "SCIENCE",
        "ESCIE": "SCIENCE",
        "SCIENCE": "SCIENCE",
        "VALUES": "VALUES_EDUCATION",
        "VALUES_ED": "VALUES_EDUCATION",
        "VALUES_EDUCATION": "VALUES_EDUCATION",
        "VALED": "VALUES_EDUCATION",
        "VALUE": "VALUES_EDUCATION",
        "VE": "VALUES_EDUCATION",
        "FIL": "FILIPINO",
        "FILIPINO": "FILIPINO",
    }
    return aliases.get(text, text or "UNKNOWN")


def load_unified_feature_schema(schema_path: Path = SCHEMA_PATH) -> dict[str, Any]:
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    validate_unified_schema_identity(schema)
    return schema


def validate_unified_schema_identity(schema: dict[str, Any]) -> None:
    if schema.get("model_name") != MODEL_NAME:
        raise ValueError(f"Unexpected unified model schema name: {schema.get('model_name')}")
    if schema.get("model_purpose") != MODEL_PURPOSE:
        raise ValueError(f"Unexpected unified model purpose: {schema.get('model_purpose')}")
    raw = schema.get("raw_feature_columns")
    if not isinstance(raw, list) or schema.get("raw_feature_count") != len(raw):
        raise ValueError("Unified schema raw_feature_count does not match raw_feature_columns.")
    if len(raw) != 34:
        raise ValueError(f"Unified V2 expects exactly 34 raw features, got {len(raw)}.")
    numeric = set(schema.get("numeric_features") or [])
    categorical = set(schema.get("categorical_features") or [])
    if set(raw) != numeric | categorical:
        raise ValueError("Unified schema raw columns must equal numeric plus categorical features.")
    if categorical != {"subject"}:
        raise ValueError("Unified V2 expects subject as the only categorical feature.")
    for required in ("previous_term_available", "previous_term_final_grade", "current_period_progress_ratio", "subject"):
        if required not in raw:
            raise ValueError(f"Unified schema missing required runtime feature {required}.")


def _period_label(period: AcademicPeriod | None) -> str | None:
    return period.period_name if period else None


def _previous_period(db: Session, period: AcademicPeriod) -> AcademicPeriod | None:
    if int(period.period_sequence or 0) <= 1:
        return None
    return (
        db.query(AcademicPeriod)
        .filter(
            AcademicPeriod.academic_year_id == period.academic_year_id,
            AcademicPeriod.period_type == period.period_type,
            AcademicPeriod.period_sequence == int(period.period_sequence) - 1,
        )
        .first()
    )


def _previous_final_grade(
    db: Session,
    *,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    current_period: AcademicPeriod,
) -> tuple[int, float | None, dict[str, Any]]:
    previous = _previous_period(db, current_period)
    provenance: dict[str, Any] = {
        "previous_period_id": previous.academic_period_id if previous else None,
        "previous_period_label": _period_label(previous),
        "previous_grade_used": False,
        "reason": None,
    }
    if previous is None:
        provenance["reason"] = "NO_PREVIOUS_PERIOD"
        return 0, None, provenance

    grade = (
        db.query(StudentPeriodGrade)
        .filter(
            StudentPeriodGrade.student_id == student_id,
            StudentPeriodGrade.class_id == class_id,
            StudentPeriodGrade.subject_id == subject_id,
            StudentPeriodGrade.academic_period_id == previous.academic_period_id,
        )
        .one_or_none()
    )
    if grade is None or grade.is_finalized is not True or grade.final_period_grade is None:
        provenance["reason"] = "PREVIOUS_FINAL_GRADE_UNAVAILABLE"
        return 0, None, provenance

    provenance["previous_grade_used"] = True
    provenance["student_period_grade_id"] = getattr(grade, "student_period_grade_id", None)
    provenance["reason"] = "FINALIZED_PREVIOUS_PERIOD_GRADE"
    return 1, float(grade.final_period_grade), provenance


def _period_progress_ratio(period: AcademicPeriod) -> float:
    sequence = float(period.period_sequence or 0)
    total = float(period.total_periods_in_year or 0)
    if sequence <= 0 or total <= 0:
        raise ValueError("Academic period must define period_sequence and total_periods_in_year for Unified prediction.")
    return round(sequence / total, 6)


def _domain_warnings(subject_label: str, schema: dict[str, Any]) -> list[dict[str, Any]]:
    supported = set(schema.get("supported_subjects") or [])
    unsupported = set(schema.get("unsupported_subjects") or [])
    if subject_label in unsupported:
        return [{
            "code": "DOMAIN_UNSUPPORTED",
            "message": f"Unified V2 does not support {subject_label}.",
            "feature": "subject",
            "value": subject_label,
        }]
    if subject_label not in supported:
        return [{
            "code": "DOMAIN_UNSUPPORTED",
            "message": f"Unified V2 has no registered support for subject {subject_label}.",
            "feature": "subject",
            "value": subject_label,
        }]
    return []


def _unified_readiness(features: dict[str, Any], current_ready: bool, current_level: str, current_reasons: list[str]) -> dict[str, Any]:
    if int(features.get("previous_term_available") or 0) == 1:
        if float(features.get("overall_available_activity_count") or 0) > 0 and current_ready:
            return {"ready": True, "readiness_level": current_level, "reasons": []}
        return {"ready": True, "readiness_level": "EARLY_PRIOR_READY", "reasons": []}
    if current_ready:
        return {"ready": True, "readiness_level": current_level, "reasons": []}
    return {
        "ready": False,
        "readiness_level": "INSUFFICIENT_EVIDENCE",
        "reasons": current_reasons or ["More graded academic evidence is needed before generating a projection."],
    }


def build_unified_current_term_features_from_records(
    db: Session,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
    *,
    cutoff_at: datetime | None = None,
    schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    schema = schema or load_unified_feature_schema()
    cutoff_at = cutoff_at or datetime.now(timezone.utc)
    if cutoff_at.tzinfo is None:
        cutoff_at = cutoff_at.replace(tzinfo=timezone.utc)

    period = db.get(AcademicPeriod, academic_period_id)
    subject = db.get(Subject, subject_id)
    if period is None:
        raise ValueError("Referenced academic period was not found.")
    if subject is None:
        raise ValueError("Referenced subject was not found.")

    current = build_current_period_features_from_records(
        db,
        student_id,
        class_id,
        subject_id,
        academic_period_id,
        cutoff_at=cutoff_at,
    )
    previous_available, previous_grade, previous_provenance = _previous_final_grade(
        db,
        student_id=student_id,
        class_id=class_id,
        subject_id=subject_id,
        current_period=period,
    )

    return assemble_unified_features(
        current=current,
        period=period,
        subject=subject,
        previous_available=previous_available,
        previous_grade=previous_grade,
        previous_provenance=previous_provenance,
        schema=schema,
    )


def assemble_unified_features(
    *,
    current: dict[str, Any],
    period: AcademicPeriod,
    subject: Subject,
    previous_available: int | float,
    previous_grade: float | None,
    previous_provenance: dict[str, Any],
    schema: dict[str, Any] | None = None,
) -> dict[str, Any]:
    schema = schema or load_unified_feature_schema()
    current_features = dict(current["features"])
    subject_label = _normalize_unified_subject_label(subject)
    current_features.pop("subject", None)

    raw = dict(current_features)
    raw["previous_term_available"] = float(previous_available)
    raw["previous_term_final_grade"] = previous_grade
    raw["current_period_progress_ratio"] = _period_progress_ratio(period)
    raw["subject"] = subject_label

    features = {name: raw.get(name) for name in schema["raw_feature_columns"]}
    validate_unified_feature_contract(features, schema)

    current_warnings = [
        warning for warning in (current.get("domain_warnings") or [])
        if not (warning.get("code") == "UNSUPPORTED_SUBJECT" and warning.get("feature") == "subject")
    ]
    warnings = current_warnings + _domain_warnings(subject_label, schema)
    readiness = _unified_readiness(
        features,
        bool(current.get("ready")),
        str(current.get("readiness_level") or "UNKNOWN"),
        list(current.get("readiness_reasons") or []),
    )
    summary = dict(current.get("evidence_summary") or {})
    summary.update({
        "unified_evidence_source": "LIVE_CLASSWORK_SUBMISSIONS_AND_OPTIONAL_PREVIOUS_FINAL_GRADE",
        "previous_term": previous_provenance,
        "current_period_progress_ratio": features["current_period_progress_ratio"],
        "subject": subject_label,
        "current_period_readiness_level": current.get("readiness_level"),
        "current_period_ready": current.get("ready"),
    })

    return {
        "model_purpose": MODEL_PURPOSE,
        "model_name": MODEL_NAME,
        "schema_version": schema.get("schema_version"),
        "features": features,
        "ready": readiness["ready"],
        "readiness_level": readiness["readiness_level"],
        "readiness_reasons": readiness["reasons"],
        "domain_warnings": warnings,
        "evidence_summary": summary,
    }


def validate_unified_feature_contract(features: dict[str, Any], schema: dict[str, Any] | None = None) -> None:
    schema = schema or load_unified_feature_schema()
    expected = list(schema["raw_feature_columns"])
    if list(features.keys()) != expected:
        raise ValueError("Unified feature names/order do not match the registered schema.")
    for name in schema.get("numeric_features") or []:
        value = features.get(name)
        if value is None:
            if name == "previous_term_final_grade":
                continue
            raise ValueError(f"Unified numeric feature {name} is missing.")
        float(value)
    for name in schema.get("categorical_features") or []:
        value = features.get(name)
        if not isinstance(value, str) or not value:
            raise ValueError(f"Unified categorical feature {name} must be a non-empty string.")


def prepare_unified_frame(features: dict[str, Any], schema: dict[str, Any] | None = None) -> pd.DataFrame:
    schema = schema or load_unified_feature_schema()
    validate_unified_feature_contract(features, schema)
    return pd.DataFrame([{name: features[name] for name in schema["raw_feature_columns"]}], columns=schema["raw_feature_columns"])

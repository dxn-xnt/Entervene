from __future__ import annotations

from datetime import datetime
from functools import partial
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.services.prediction import DevelopmentCurrentTermScoringService as v3_scorer
from app.services.prediction.DevelopmentCurrentTermModelSelection import selected_development_model_name, require_development_model_name
from app.services.prediction.CurrentPeriodFeatureBuilderService import build_current_period_features_from_records
from app.services.prediction.CurrentTermV3Domain import resolve_v3_scope, canonicalize_v3_features


MODEL_DEVELOPMENT_STATUS = "DEVELOPMENT_ONLY"
PREDICTION_PURPOSE = "CURRENT_TERM_FINAL_GRADE_PROJECTION"

STATUS_DEVELOPMENT_PREDICTION_AVAILABLE = "DEVELOPMENT_PREDICTION_AVAILABLE"
STATUS_FINALIZED_GRADE_EXISTS = "FINALIZED_GRADE_EXISTS"
STATUS_INSUFFICIENT_EVIDENCE = "INSUFFICIENT_EVIDENCE"
STATUS_INVALID_PERIOD_SCOPE = "INVALID_PERIOD_SCOPE"
STATUS_SCHEMA_CONTRACT_ERROR = "SCHEMA_CONTRACT_ERROR"
STATUS_UNSUPPORTED_DEVELOPMENT_DOMAIN = "UNSUPPORTED_DEVELOPMENT_DOMAIN"
STATUS_PERIOD_NOT_ACTIVE = "PERIOD_NOT_ACTIVE"

SUPPORTED_SUBJECTS = {
    "MATHEMATICS",
    "SCIENCE",
    "ENGLISH",
    "ICT",
    "CREATIVE_TECHNOLOGY",
}
SUPPORTED_WEIGHT_PATTERNS = {
    "20/50/30",
    "20/60/20",
}


def _weight_pattern(features: dict[str, Any]) -> str:
    return "/".join(
        str(int(round(float(features[name]))))
        for name in ("ww_weight", "pt_weight", "qa_weight")
    )


def _base_result(
    *,
    status: str,
    source_period_id: int,
    target_period_id: int,
    readiness_result: dict[str, Any] | None = None,
    reason_codes: list[str] | None = None,
    projected_final_term_grade: float | None = None,
    domain_result: dict[str, Any] | None = None,
    model_name: str = v3_scorer.MODEL_NAME,
) -> dict[str, Any]:
    readiness_result = readiness_result or {}
    return {
        "status": status,
        "projected_final_term_grade": projected_final_term_grade,
        "source_period_id": source_period_id,
        "target_period_id": target_period_id,
        "readiness_result": readiness_result,
        "readiness_reason_codes": reason_codes if reason_codes is not None else list(readiness_result.get("reason_codes") or []),
        "domain_result": domain_result or {},
        "model_name": model_name,
        "model_development_status": MODEL_DEVELOPMENT_STATUS,
        "prediction_purpose": PREDICTION_PURPOSE,
    }


def _finalized_same_term_grade_exists(
    db: Session,
    *,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    target_period_id: int,
) -> bool:
    return db.query(StudentPeriodGrade).filter(
        StudentPeriodGrade.student_id == student_id,
        StudentPeriodGrade.class_id == class_id,
        StudentPeriodGrade.subject_id == subject_id,
        StudentPeriodGrade.academic_period_id == target_period_id,
        StudentPeriodGrade.is_finalized.is_(True),
        StudentPeriodGrade.final_period_grade.isnot(None),
    ).first() is not None


def _unsupported_domain(features: dict[str, Any]) -> dict[str, Any]:
    reasons: list[str] = []
    subject = str(features.get("subject") or "").strip().upper()
    pattern = _weight_pattern(features)

    if subject not in SUPPORTED_SUBJECTS:
        reasons.append("UNSUPPORTED_SUBJECT")
    if pattern not in SUPPORTED_WEIGHT_PATTERNS:
        reasons.append("UNSUPPORTED_WEIGHT_PATTERN")

    return {
        "supported": not reasons,
        "reason_codes": reasons,
        "subject": subject,
        "weight_pattern": pattern,
        "supported_subjects": sorted(SUPPORTED_SUBJECTS),
        "supported_weight_patterns": sorted(SUPPORTED_WEIGHT_PATTERNS),
    }


def predict_development_current_term(
    db: Session,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    source_period_id: int,
    target_period_id: int | None = None,
    *,
    cutoff_at: datetime | None = None,
    model_name: str | None = None,
) -> dict[str, Any]:
    model_name = require_development_model_name(model_name or selected_development_model_name())
    result = partial(_base_result, model_name=model_name)
    target_period_id = source_period_id if target_period_id is None else target_period_id

    if source_period_id != target_period_id:
        return result(
            status=STATUS_INVALID_PERIOD_SCOPE,
            source_period_id=source_period_id,
            target_period_id=target_period_id,
            reason_codes=["SOURCE_TARGET_PERIOD_MISMATCH"],
        )

    if _finalized_same_term_grade_exists(
        db,
        student_id=student_id,
        class_id=class_id,
        subject_id=subject_id,
        target_period_id=target_period_id,
    ):
        return result(
            status=STATUS_FINALIZED_GRADE_EXISTS,
            source_period_id=source_period_id,
            target_period_id=target_period_id,
            reason_codes=["FINALIZED_SAME_TERM_GRADE_EXISTS"],
        )

    period = db.get(AcademicPeriod, source_period_id)
    if period is None or not period.is_active:
        return result(
            status=STATUS_PERIOD_NOT_ACTIVE,
            source_period_id=source_period_id,
            target_period_id=target_period_id,
            reason_codes=["PERIOD_NOT_ACTIVE"],
        )

    scope = resolve_v3_scope(db, student_id, class_id, subject_id)
    if not scope["supported"] and any(
        reason in scope["reason_codes"]
        for reason in ("UNSUPPORTED_GRADE_SCOPE", "MISMATCHED_GRADE_SCOPE", "INVALID_ACADEMIC_SCOPE")
    ):
        return result(
            status=STATUS_UNSUPPORTED_DEVELOPMENT_DOMAIN,
            source_period_id=source_period_id,
            target_period_id=target_period_id,
            reason_codes=scope["reason_codes"],
            domain_result=scope,
        )

    built = build_current_period_features_from_records(
        db,
        student_id,
        class_id,
        subject_id,
        source_period_id,
        cutoff_at=cutoff_at,
    )
    if scope["supported"]:
        built["features"] = canonicalize_v3_features(built["features"], scope)
    readiness_result = {
        "ready": built["ready"],
        "readiness_level": built["readiness_level"],
        "reason_codes": list(built.get("readiness_reason_codes") or []),
    }

    if not built["ready"]:
        return result(
            status=STATUS_INSUFFICIENT_EVIDENCE,
            source_period_id=source_period_id,
            target_period_id=target_period_id,
            readiness_result=readiness_result,
        )

    if not scope["supported"]:
        return result(
            status=STATUS_UNSUPPORTED_DEVELOPMENT_DOMAIN,
            source_period_id=source_period_id,
            target_period_id=target_period_id,
            readiness_result=readiness_result,
            reason_codes=scope["reason_codes"],
            domain_result={
                **scope,
                "subject": built["features"]["subject"],
                "weight_pattern": _weight_pattern(built["features"]),
            },
        )

    domain_result = _unsupported_domain(built["features"])
    if not domain_result["supported"]:
        return result(
            status=STATUS_UNSUPPORTED_DEVELOPMENT_DOMAIN,
            source_period_id=source_period_id,
            target_period_id=target_period_id,
            readiness_result=readiness_result,
            reason_codes=list(domain_result["reason_codes"]),
            domain_result=domain_result,
        )

    contract = v3_scorer.compare_feature_contract(built["features"], v3_scorer.load_development_current_term_schema(model_name))
    if contract["missing_features"] or contract["unexpected_features"] or contract["type_mismatches"]:
        return result(
            status=STATUS_SCHEMA_CONTRACT_ERROR,
            source_period_id=source_period_id,
            target_period_id=target_period_id,
            readiness_result=readiness_result,
            reason_codes=["V3_FEATURE_CONTRACT_MISMATCH"],
            domain_result={"supported": True, "feature_contract": contract},
        )

    if model_name == v3_scorer.MODEL_NAME:
        projected = v3_scorer.score_development_current_term(built["features"])
    else:
        projected = v3_scorer.score_development_current_term(built["features"], model_name=model_name)
    return result(
        status=STATUS_DEVELOPMENT_PREDICTION_AVAILABLE,
        source_period_id=source_period_id,
        target_period_id=target_period_id,
        readiness_result=readiness_result,
        projected_final_term_grade=projected,
        domain_result=domain_result,
    )

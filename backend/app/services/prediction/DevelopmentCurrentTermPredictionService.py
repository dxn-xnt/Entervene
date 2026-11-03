from __future__ import annotations

from datetime import datetime
from functools import partial
from typing import Any, Mapping
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Class_ import Class
from app.models.academic.SubjectLoad import SubjectLoad
from app.services.academic.AcademicLifecycleService import (
    resolve_active_academic_period,
    resolve_active_academic_year,
)
from app.services.prediction import DevelopmentCurrentTermScoringService as v3_scorer
from app.services.prediction.DevelopmentCurrentTermModelSelection import selected_development_model_name, require_development_model_name
from app.services.prediction.CurrentPeriodFeatureBuilderService import build_current_period_features_from_records
from app.services.prediction.CurrentTermV3Domain import (
    resolve_v3_scope,
    canonicalize_v3_features,
    UNSUPPORTED_EXPLICIT_SUBJECTS,
)


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


def current_term_lifecycle_reason_codes(
    db: Session,
    *,
    class_id: int,
    subject_id: int,
    period_id: int,
    lock: bool = False,
) -> list[str]:
    resolve_active_academic_year(db, required=True, lock=lock)
    active_period = resolve_active_academic_period(db, required=False, lock=lock)
    if active_period is None:
        return ["PERIOD_NOT_ACTIVE"]
    if active_period.academic_period_id != period_id:
        return ["PERIOD_NOT_ACTIVE"]

    class_query = db.query(Class).filter(Class.class_id == class_id)
    if lock:
        class_query = class_query.with_for_update(read=True)
    class_ = class_query.one_or_none()
    if class_ is None:
        return ["INVALID_ACADEMIC_SCOPE"]
    if class_.academic_year_id != active_period.academic_year_id:
        return ["CLASS_PERIOD_YEAR_MISMATCH"]

    load_query = db.query(SubjectLoad).filter(
        SubjectLoad.class_id == class_id,
        SubjectLoad.subject_id == subject_id,
        SubjectLoad.academic_period_id == period_id,
        SubjectLoad.is_active_version.is_(True),
        SubjectLoad.status.in_(["published", "active"]),
    )
    if lock:
        load_query = load_query.with_for_update(read=True)
    if load_query.first() is None:
        return ["ACTIVE_SUBJECT_LOAD_NOT_FOUND"]
    return []


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
    is_provisional: bool = False,
    validation_status: str | None = None,
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
        "is_provisional": is_provisional,
        "validation_status": validation_status,
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


def _unsupported_domain(
    features: dict[str, Any],
    grade_level: int | None = None,
    is_provisional: bool = False,
    validation_status: str | None = None,
) -> dict[str, Any]:
    reasons: list[str] = []
    subject = str(features.get("subject") or "").strip().upper()
    pattern = _weight_pattern(features)

    if not subject or subject in UNSUPPORTED_EXPLICIT_SUBJECTS:
        reasons.append("UNSUPPORTED_SUBJECT")

    if pattern not in SUPPORTED_WEIGHT_PATTERNS:
        reasons.append("UNSUPPORTED_WEIGHT_PATTERN")

    provisional = is_provisional or (grade_level in {11, 12})
    resolved_validation_status = validation_status
    if resolved_validation_status is None:
        if provisional:
            resolved_validation_status = "PROVISIONAL_UNVALIDATED_SHS" if (grade_level in {11, 12}) else "PROVISIONAL"
        else:
            resolved_validation_status = "VALIDATED_JHS"

    return {
        "supported": not reasons,
        "reason_codes": reasons,
        "subject": subject,
        "weight_pattern": pattern,
        "supported_subjects": sorted(SUPPORTED_SUBJECTS),
        "supported_weight_patterns": sorted(SUPPORTED_WEIGHT_PATTERNS),
        "is_provisional": provisional,
        "validation_status": resolved_validation_status,
    }


def prepare_development_current_term(
    db: Session,
    student_id: UUID,
    class_id: int,
    subject_id: int,
    source_period_id: int,
    target_period_id: int | None = None,
    *,
    cutoff_at: datetime | None = None,
    model_name: str | None = None,
    hypothetical_ww_pt_scores: Mapping[int, float] | None = None,
) -> tuple[dict[str, Any], dict[str, Any] | None]:
    model_name = require_development_model_name(model_name or selected_development_model_name())
    result = partial(_base_result, model_name=model_name)
    target_period_id = source_period_id if target_period_id is None else target_period_id

    if source_period_id != target_period_id:
        return result(
            status=STATUS_INVALID_PERIOD_SCOPE,
            source_period_id=source_period_id,
            target_period_id=target_period_id,
            reason_codes=["SOURCE_TARGET_PERIOD_MISMATCH"],
        ), None

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
        ), None

    lifecycle_reasons = current_term_lifecycle_reason_codes(
        db,
        class_id=class_id,
        subject_id=subject_id,
        period_id=source_period_id,
    )
    if lifecycle_reasons == ["PERIOD_NOT_ACTIVE"]:
        return result(
            status=STATUS_PERIOD_NOT_ACTIVE,
            source_period_id=source_period_id,
            target_period_id=target_period_id,
            reason_codes=lifecycle_reasons,
        ), None
    if lifecycle_reasons:
        return result(
            status=STATUS_INVALID_PERIOD_SCOPE,
            source_period_id=source_period_id,
            target_period_id=target_period_id,
            reason_codes=lifecycle_reasons,
        ), None

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
            is_provisional=scope.get("is_provisional", False),
            validation_status=scope.get("validation_status"),
        ), None

    built = build_current_period_features_from_records(
        db,
        student_id,
        class_id,
        subject_id,
        source_period_id,
        cutoff_at=cutoff_at,
        hypothetical_ww_pt_scores=hypothetical_ww_pt_scores,
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
            is_provisional=scope.get("is_provisional", False),
            validation_status=scope.get("validation_status"),
        ), None

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
            is_provisional=scope.get("is_provisional", False),
            validation_status=scope.get("validation_status"),
        ), None

    domain_result = _unsupported_domain(
        built["features"],
        grade_level=scope.get("grade_level"),
        is_provisional=scope.get("is_provisional", False),
        validation_status=scope.get("validation_status"),
    )
    if not domain_result["supported"]:
        return result(
            status=STATUS_UNSUPPORTED_DEVELOPMENT_DOMAIN,
            source_period_id=source_period_id,
            target_period_id=target_period_id,
            readiness_result=readiness_result,
            reason_codes=list(domain_result["reason_codes"]),
            domain_result=domain_result,
            is_provisional=domain_result.get("is_provisional", False),
            validation_status=domain_result.get("validation_status"),
        ), None

    contract = v3_scorer.compare_feature_contract(built["features"], v3_scorer.load_development_current_term_schema(model_name))
    if contract["missing_features"] or contract["unexpected_features"] or contract["type_mismatches"]:
        return result(
            status=STATUS_SCHEMA_CONTRACT_ERROR,
            source_period_id=source_period_id,
            target_period_id=target_period_id,
            readiness_result=readiness_result,
            reason_codes=["V3_FEATURE_CONTRACT_MISMATCH"],
            domain_result={"supported": True, "feature_contract": contract},
            is_provisional=domain_result.get("is_provisional", False),
            validation_status=domain_result.get("validation_status"),
        ), None

    prediction = result(
        status=STATUS_DEVELOPMENT_PREDICTION_AVAILABLE,
        source_period_id=source_period_id,
        target_period_id=target_period_id,
        readiness_result=readiness_result,
        domain_result=domain_result,
        is_provisional=domain_result.get("is_provisional", False),
        validation_status=domain_result.get("validation_status", "VALIDATED_JHS"),
    )
    return prediction, {
        "features": dict(built["features"]),
        "evidence_summary": built["evidence_summary"],
    }


def score_prepared_development_current_term(
    prediction: dict[str, Any],
    prepared: dict[str, Any],
    *,
    scored_features_out: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if prediction["status"] != STATUS_DEVELOPMENT_PREDICTION_AVAILABLE:
        raise ValueError("Only a ready development prediction may be scored.")
    features = prepared["features"]
    model_name = prediction["model_name"]
    if model_name == v3_scorer.MODEL_NAME:
        projected = v3_scorer.score_development_current_term(features)
    else:
        projected = v3_scorer.score_development_current_term(features, model_name=model_name)
    if scored_features_out is not None:
        scored_features_out.update(features)
    return {
        **prediction,
        "projected_final_term_grade": projected,
        "is_provisional": prediction.get("is_provisional", False),
        "validation_status": prediction.get("validation_status", "VALIDATED_JHS"),
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
    scored_features_out: dict[str, Any] | None = None,
    hypothetical_ww_pt_scores: Mapping[int, float] | None = None,
) -> dict[str, Any]:
    prediction, prepared = prepare_development_current_term(
        db,
        student_id,
        class_id,
        subject_id,
        source_period_id,
        target_period_id,
        cutoff_at=cutoff_at,
        model_name=model_name,
        hypothetical_ww_pt_scores=hypothetical_ww_pt_scores,
    )
    if prepared is None:
        return prediction
    return score_prepared_development_current_term(
        prediction,
        prepared,
        scored_features_out=scored_features_out,
    )

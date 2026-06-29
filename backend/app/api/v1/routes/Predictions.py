from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.Dependencies import require_role
from app.db.Session import get_db
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.schemas.Prediction import (
    PredictionBuildFeaturesRequest,
    PredictionBuiltFeaturesResponse,
    PredictionFeatureListResponse,
    PredictionFromRecordsPersistRequest,
    PredictionFromRecordsPreviewRequest,
    PredictionFromRecordsResponse,
    PredictionPersistRequest,
    PredictionPersistResponse,
    PredictionListResponse,
    PredictionPreviewRequest,
    PredictionPreviewResponse,
    PredictionSummaryResponse,
)
from app.services.ModelScoringService import DEFAULT_MODEL_NAME, score_student_prediction
from app.services.PredictionFeatureBuilderService import (
    build_prediction_features_from_records,
    insufficient_prediction_response,
)
from app.services.PredictionPersistenceService import score_and_persist_prediction

router = APIRouter()


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    return float(value)


def _summary(prediction: AIPrediction) -> dict[str, Any]:
    return {
        "prediction_id": prediction.prediction_id,
        "student_id": prediction.student_id,
        "class_id": prediction.class_id,
        "subject_id": prediction.subject_id,
        "source_period_id": prediction.source_period_id,
        "target_period_id": prediction.target_period_id,
        "model_version_id": prediction.model_version_id,
        "predicted_period_grade": _to_float(prediction.predicted_period_grade),
        "risk_level": prediction.risk_level,
        "risk_score": _to_float(prediction.risk_score),
        "data_status": prediction.data_status,
        "generated_at": prediction.generated_at,
    }


def _service_error(exc: Exception) -> HTTPException:
    status_code = 404 if isinstance(exc, LookupError) else 400
    return HTTPException(status_code=status_code, detail=str(exc))


def _records_request_payload(payload: PredictionBuildFeaturesRequest) -> dict[str, Any]:
    return {
        "student_id": payload.student_id,
        "class_id": payload.class_id,
        "subject_id": payload.subject_id,
        "source_period_id": payload.source_period_id,
        "target_period_id": payload.target_period_id,
    }


def _with_readiness(scoring_result: dict[str, Any], built: dict[str, Any]) -> dict[str, Any]:
    return {
        **scoring_result,
        "ready": built["ready"],
        "readiness_level": built["readiness_level"],
        "prediction_mode": built["prediction_mode"],
        "features": built["features"],
        "evidence_summary": built["evidence_summary"],
        "warnings": [*built.get("warnings", []), *scoring_result.get("warnings", [])],
    }


@router.post("/preview", response_model=PredictionPreviewResponse)
def preview_prediction(
    payload: PredictionPreviewRequest,
    current_user: dict = Depends(require_role("admin", "teacher")),
    db: Session = Depends(get_db),
):
    try:
        return score_student_prediction(
            db,
            payload.features,
            model_name=payload.model_name or DEFAULT_MODEL_NAME,
        )
    except (ValueError, LookupError, FileNotFoundError) as exc:
        raise _service_error(exc) from exc


@router.post("/build-features", response_model=PredictionBuiltFeaturesResponse)
def build_prediction_features(
    payload: PredictionBuildFeaturesRequest,
    current_user: dict = Depends(require_role("admin", "teacher")),
    db: Session = Depends(get_db),
):
    try:
        return build_prediction_features_from_records(db, **_records_request_payload(payload))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/from-records/preview", response_model=PredictionFromRecordsResponse)
def preview_prediction_from_records(
    payload: PredictionFromRecordsPreviewRequest,
    current_user: dict = Depends(require_role("admin", "teacher")),
    db: Session = Depends(get_db),
):
    try:
        built = build_prediction_features_from_records(db, **_records_request_payload(payload))
        if not built["ready"]:
            return insufficient_prediction_response(built)
        scoring_result = score_student_prediction(
            db,
            built["features"],
            model_name=payload.model_name or DEFAULT_MODEL_NAME,
        )
        return _with_readiness(scoring_result, built)
    except (ValueError, LookupError, FileNotFoundError) as exc:
        raise _service_error(exc) from exc


@router.post("/from-records", response_model=PredictionFromRecordsResponse)
def create_prediction_from_records(
    payload: PredictionFromRecordsPersistRequest,
    current_user: dict = Depends(require_role("admin", "teacher")),
    db: Session = Depends(get_db),
):
    try:
        built = build_prediction_features_from_records(db, **_records_request_payload(payload))
        if not built["ready"]:
            return insufficient_prediction_response(built)
        persist_request = {
            **_records_request_payload(payload),
            "features": built["features"],
        }
        result = score_and_persist_prediction(
            db,
            persist_request,
            model_name=payload.model_name or DEFAULT_MODEL_NAME,
            replace_existing=payload.replace_existing,
        )
        return _with_readiness(result, built)
    except (ValueError, LookupError, FileNotFoundError) as exc:
        raise _service_error(exc) from exc


@router.post("", response_model=PredictionPersistResponse)
def create_prediction(
    payload: PredictionPersistRequest,
    current_user: dict = Depends(require_role("admin", "teacher")),
    db: Session = Depends(get_db),
):
    try:
        request_data = payload.model_dump()
        model_name = request_data.pop("model_name") or DEFAULT_MODEL_NAME
        replace_existing = bool(request_data.pop("replace_existing", False))
        return score_and_persist_prediction(
            db,
            request_data,
            model_name=model_name,
            replace_existing=replace_existing,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/latest", response_model=PredictionSummaryResponse)
def get_latest_prediction(
    student_id: UUID,
    class_id: int,
    subject_id: int,
    source_period_id: int | None = None,
    target_period_id: int | None = None,
    model_version_id: int | None = None,
    current_user: dict = Depends(require_role("admin", "teacher")),
    db: Session = Depends(get_db),
):
    query = db.query(AIPrediction).filter(
        AIPrediction.student_id == student_id,
        AIPrediction.class_id == class_id,
        AIPrediction.subject_id == subject_id,
    )
    if source_period_id is not None:
        query = query.filter(AIPrediction.source_period_id == source_period_id)
    if target_period_id is not None:
        query = query.filter(AIPrediction.target_period_id == target_period_id)
    if model_version_id is not None:
        query = query.filter(AIPrediction.model_version_id == model_version_id)

    prediction = query.order_by(AIPrediction.generated_at.desc(), AIPrediction.prediction_id.desc()).first()
    if prediction is None:
        raise HTTPException(status_code=404, detail="Prediction not found")
    return _summary(prediction)


@router.get("/classes/{class_id}/risks", response_model=PredictionListResponse)
def list_class_risk_predictions(
    class_id: int,
    subject_id: int | None = None,
    source_period_id: int | None = None,
    target_period_id: int | None = None,
    risk_level: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_role("admin", "teacher")),
    db: Session = Depends(get_db),
):
    query = db.query(AIPrediction).filter(AIPrediction.class_id == class_id)
    if subject_id is not None:
        query = query.filter(AIPrediction.subject_id == subject_id)
    if source_period_id is not None:
        query = query.filter(AIPrediction.source_period_id == source_period_id)
    if target_period_id is not None:
        query = query.filter(AIPrediction.target_period_id == target_period_id)
    if risk_level:
        query = query.filter(AIPrediction.risk_level == risk_level)

    total = query.count()
    rows = (
        query.order_by(AIPrediction.generated_at.desc(), AIPrediction.prediction_id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )
    return {
        "items": [_summary(row) for row in rows],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/{prediction_id}/features", response_model=PredictionFeatureListResponse)
def list_prediction_features(
    prediction_id: int,
    current_user: dict = Depends(require_role("admin", "teacher")),
    db: Session = Depends(get_db),
):
    prediction = db.get(AIPrediction, prediction_id)
    if prediction is None:
        raise HTTPException(status_code=404, detail="Prediction not found")

    rows = (
        db.query(AIPredictionFeature)
        .filter(AIPredictionFeature.prediction_id == prediction_id)
        .order_by(AIPredictionFeature.feature_rank.asc(), AIPredictionFeature.feature_id.asc())
        .all()
    )
    return {
        "prediction_id": prediction_id,
        "features": [
            {
                "feature_id": row.feature_id,
                "feature_name": row.feature_name,
                "feature_value": _to_float(row.feature_value),
                "feature_contribution": _to_float(row.feature_contribution),
                "direction": row.direction,
                "feature_rank": row.feature_rank,
                "explanation_method": row.explanation_method,
            }
            for row in rows
        ],
    }

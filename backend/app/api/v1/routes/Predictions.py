from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.Dependencies import get_current_user, get_optional_staff_id, get_staff_id, require_role
from app.db.Session import get_db
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.ai.AIPrediction import AIPrediction, RISK_ASSESSMENT_EVALUATED
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.schemas.Prediction import (
    DashboardAtRiskResponse,
    DashboardFilterOptionsResponse,
    DashboardGradeGroupSummary,
    CurrentPeriodGenerateRequest,
    CurrentPeriodGenerateResponse,
    ModelPerformanceSummaryResponse,
    PredictionBuildFeaturesRequest,
    PredictionBuiltFeaturesResponse,
    PredictionDetailResponse,
    PredictionFeatureListResponse,
    PredictionFromRecordsPersistRequest,
    PredictionFromRecordsPreviewRequest,
    PredictionFromRecordsResponse,
    PredictionHistoryResponse,
    PredictionOutcomeEvaluateRequest,
    PredictionOutcomeResponse,
    PredictionPersistRequest,
    PredictionPersistResponse,
    PredictionListResponse,
    PredictionPreviewRequest,
    PredictionPreviewResponse,
    PredictionRefreshRequest,
    PredictionRosterResponse,
    PredictionRosterStatusResponse,
    DualPurposeRosterResponse,
    LegacyPredictionRosterResponse,
    PredictionStatusEnvelopeResponse,
    PredictionSummaryResponse,
    PredictionTeacherReviewListResponse,
    TeacherRiskReviewRequest,
    TeacherRiskReviewResponse,
)
from app.models.ai.AIModelVersion import ModelPurpose
from app.services.prediction.CurrentPeriodPredictionGenerationService import (
    refresh_current_period_prediction_workflow,
)
from app.services.prediction.UnifiedPredictionGenerationService import (
    evaluate_unified_projection_status,
    generate_unified_prediction,
    refresh_unified_prediction_workflow,
)
from app.services.prediction.ModelPerformanceService import get_model_performance_summary
from app.services.prediction.ModelScoringService import DEFAULT_MODEL_NAME, score_student_prediction
from app.services.prediction.PredictionFeatureBuilderService import (
    build_prediction_features_from_records,
    insufficient_prediction_response,
)
from app.services.prediction.PredictionSuggestionService import (
    assign_intervention_from_prediction,
    get_suggestions_for_prediction,
)
from app.services.prediction.PredictionOutcomeService import evaluate_prediction_outcome
from app.services.prediction.PredictionPersistenceService import score_and_persist_prediction
from app.services.prediction.PredictionGenerationTransaction import run_prediction_generation_transaction
from app.services.prediction.PredictionGenerationService import generate_from_records
from app.services.prediction.PredictionScopeService import (
    PredictionConflict, authorize_generation, authorize_prediction_read,
    prediction_read_filter, prediction_metadata, latest_prediction_filter, authorize_prediction_write,
)
from app.services.prediction.TeacherAssignmentResolver import get_teacher_assigned_triplets
from app.services.prediction.PredictionReadService import (
    get_prediction_detail,
    get_teacher_reviews_for_prediction,
)
from app.services.prediction.TeacherRiskReviewService import review_prediction_risk
from app.services.prediction.DashboardPredictionService import (
    get_dashboard_at_risk_predictions,
    get_dashboard_grade_summaries,
)
from app.services.prediction.DashboardFilterService import get_dashboard_filter_options
from app.services.prediction.PredictionStatusService import (
    get_dual_purpose_roster_status,
    get_prediction_history,
    get_roster_prediction_status,
)

router = APIRouter()


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    return float(value)


def _summary(prediction: AIPrediction) -> dict[str, Any]:
    return {
        **prediction_metadata(prediction),
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
        "risk_assessment_status": prediction.risk_assessment_status,
        "generated_at": prediction.generated_at,
    }


def _service_error(exc: Exception) -> HTTPException:
    if isinstance(exc, PredictionConflict):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
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


def _assert_teacher_can_use_prediction_scope(
    db: Session,
    current_user: dict[str, Any],
    staff_id: str | None,
    scope: dict[str, Any],
) -> None:
    authorize_generation(db, scope, is_admin=current_user.get("role") == "admin", staff_id=staff_id)


def _authorized_prediction(db, prediction_id, current_user, staff_id, *, write=False):
    prediction = db.get(AIPrediction, prediction_id)
    if prediction is None:
        raise HTTPException(status_code=404, detail="Prediction not found")
    try:
        if write and current_user.get("role") != "admin":
            authorize_prediction_write(db, prediction, staff_id)
        else:
            authorize_prediction_read(db, prediction, is_admin=current_user.get("role") == "admin", staff_id=staff_id)
    except PermissionError as exc:
        raise _service_error(exc) from exc
    return prediction


# ---------------------------------------------------------------------------
# Dashboard endpoints
# ---------------------------------------------------------------------------


@router.get("/dashboard/at-risk", response_model=DashboardAtRiskResponse)
def dashboard_at_risk(
    class_id: int | None = None,
    subject_id: int | None = None,
    academic_period_id: int | None = Query(None, description="Primary term filter matching academic_period.academic_period_id"),
    term: int | None = Query(None, ge=1, le=3, description="Legacy fallback mapping to active year's period sequence"),
    grade_level: int | None = Query(None, ge=1, le=12, description="Grade level filter (7-12)"),
    risk_level: str | None = None,
    search: str | None = None,
    sort_by: str | None = Query("student_name"),
    sort_order: str = Query("asc", pattern="^(asc|desc)$"),
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    is_admin = current_user.get("role") == "admin"
    return get_dashboard_at_risk_predictions(
        db,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
        term=term,
        grade_level=grade_level,
        risk_level=risk_level,
        search=search,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
        offset=offset,
        staff_id=staff_id,
        is_admin=is_admin,
        enrolled_only=True,
    )


@router.get("/dashboard/at-risk/historical", response_model=DashboardAtRiskResponse)
def dashboard_at_risk_historical(
    class_id: int | None = None,
    subject_id: int | None = None,
    academic_period_id: int | None = Query(None, description="Primary term filter matching academic_period.academic_period_id"),
    term: int | None = Query(None, ge=1, le=3, description="Legacy fallback mapping to active year's period sequence"),
    grade_level: int | None = Query(None, ge=1, le=12, description="Grade level filter (7-12)"),
    risk_level: str | None = None,
    search: str | None = None,
    sort_by: str | None = Query("student_name"),
    sort_order: str = Query("asc", pattern="^(asc|desc)$"),
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0),
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    """Dedicated endpoint for administrative inspection of historical benchmark records (Universe 2)."""
    return get_dashboard_at_risk_predictions(
        db,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
        term=term,
        grade_level=grade_level,
        risk_level=risk_level,
        search=search,
        sort_by=sort_by,
        sort_order=sort_order,
        limit=limit,
        offset=offset,
        staff_id=None,
        is_admin=True,
        enrolled_only=False,
    )


@router.get("/dashboard/grade-summaries", response_model=list[DashboardGradeGroupSummary])
def dashboard_grade_summaries(
    academic_period_id: int | None = Query(None, description="Term filter; defaults to None for all terms"),
    term: int | None = Query(None, ge=1, le=3, description="Legacy term fallback"),
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    is_admin = current_user.get("role") == "admin"
    if academic_period_id is None and term is not None:
        period_id = (
            db.query(AcademicPeriod.academic_period_id)
            .join(AcademicYear, AcademicPeriod.academic_year_id == AcademicYear.academic_year_id)
            .filter(
                AcademicYear.is_active == True,
                AcademicPeriod.period_sequence == term,
            )
            .scalar()
        )
        if period_id is None:
            period_id = (
                db.query(AcademicPeriod.academic_period_id)
                .filter(AcademicPeriod.period_sequence == term)
                .scalar()
            )
        academic_period_id = period_id

    return get_dashboard_grade_summaries(
        db,
        staff_id=staff_id,
        is_admin=is_admin,
        academic_period_id=academic_period_id,
    )


@router.get("/dashboard/filters", response_model=DashboardFilterOptionsResponse)
def dashboard_filters(
    class_id: int | None = Query(None, description="Optional class ID to scope subjects"),
    academic_period_id: int | None = Query(None, description="Optional academic period ID to scope subjects"),
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    is_admin = current_user.get("role") == "admin"
    return get_dashboard_filter_options(
        db,
        staff_id=staff_id,
        is_admin=is_admin,
        class_id=class_id,
        academic_period_id=academic_period_id,
    )


@router.get("/status/roster", response_model=PredictionRosterResponse | DualPurposeRosterResponse | LegacyPredictionRosterResponse)
def roster_prediction_status(
    class_id: int,
    subject_id: int,
    academic_period_id: int | None = None,
    source_period_id: int | None = None,
    target_period_id: int | None = None,
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    if academic_period_id is None and source_period_id is None:
        raise HTTPException(
            status_code=422,
            detail="Either academic_period_id (for dual-purpose roster) or source_period_id (for legacy roster) must be provided.",
        )

    try:
        if academic_period_id is not None:
            if target_period_id is not None and target_period_id != academic_period_id:
                raise HTTPException(
                    status_code=422,
                    detail=f"Conflicting parameters: target_period_id {target_period_id} does not match academic_period_id {academic_period_id}.",
                )
            if source_period_id is not None:
                focal_period = db.get(AcademicPeriod, academic_period_id)
                if not focal_period:
                    raise HTTPException(status_code=404, detail=f"Academic period {academic_period_id} not found.")
                src_period = db.get(AcademicPeriod, source_period_id)
                if not src_period:
                    raise HTTPException(status_code=422, detail=f"Invalid source_period_id {source_period_id}.")
                if (
                    src_period.academic_year_id != focal_period.academic_year_id
                    or src_period.period_sequence != focal_period.period_sequence - 1
                ):
                    raise HTTPException(
                        status_code=422,
                        detail=f"Conflicting parameters: source_period_id {source_period_id} does not immediately precede academic_period_id {academic_period_id}.",
                    )
            return get_dual_purpose_roster_status(
                db,
                class_id=class_id,
                subject_id=subject_id,
                academic_period_id=academic_period_id,
                staff_id=staff_id,
                is_admin=current_user.get("role") == "admin",
            )
        else:
            return get_roster_prediction_status(
                db,
                class_id=class_id,
                subject_id=subject_id,
                source_period_id=source_period_id,
                target_period_id=target_period_id,
                staff_id=staff_id,
                is_admin=current_user.get("role") == "admin",
            )
    except HTTPException:
        raise
    except (ValueError, PermissionError) as exc:
        raise _service_error(exc) from exc


@router.post("/unified/generate", response_model=CurrentPeriodGenerateResponse)
def generate_unified_projection(
    payload: CurrentPeriodGenerateRequest,
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    scope = {
        "student_id": payload.student_id,
        "class_id": payload.class_id,
        "subject_id": payload.subject_id,
        "academic_period_id": payload.academic_period_id,
    }
    try:
        return generate_unified_prediction(
            scope,
            generation_request_id=payload.generation_request_id,
            current_user=current_user,
            is_admin=current_user.get("role") == "admin",
            staff_id=staff_id,
            bind=db.get_bind(),
            initial_only=True,
        )
    except (ValueError, LookupError, FileNotFoundError, PermissionError, PredictionConflict) as exc:
        raise _service_error(exc) from exc


# ---------------------------------------------------------------------------
# Scoring / Feature / Persistence endpoints
# ---------------------------------------------------------------------------


@router.post("/preview", response_model=PredictionPreviewResponse)
def preview_prediction(
    payload: PredictionPreviewRequest,
    current_user: dict = Depends(require_role("admin", "teacher")),
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=410, detail="Raw HTTP preview is retired: use /from-records/preview. Offline ScorePrediction remains an unaudited diagnostic.")


@router.post("/build-features", response_model=PredictionBuiltFeaturesResponse)
def build_prediction_features(
    payload: PredictionBuildFeaturesRequest,
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    try:
        record_scope = _records_request_payload(payload)
        _assert_teacher_can_use_prediction_scope(db, current_user, staff_id, record_scope)
        return build_prediction_features_from_records(db, **record_scope)
    except (ValueError, PermissionError) as exc:
        raise _service_error(exc) from exc


@router.post("/from-records/preview", response_model=PredictionFromRecordsResponse)
def preview_prediction_from_records(
    payload: PredictionFromRecordsPreviewRequest,
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    try:
        scope = _records_request_payload(payload)
        _assert_teacher_can_use_prediction_scope(db, current_user, staff_id, scope)
        return run_prediction_generation_transaction(
            scope, payload.model_name or DEFAULT_MODEL_NAME,
            lambda generation_db: generate_from_records(
                generation_db, scope, model_name=payload.model_name or DEFAULT_MODEL_NAME,
                is_admin=current_user.get("role") == "admin", staff_id=staff_id,
                preview=True),
            bind=db.get_bind(),
        )
    except (ValueError, LookupError, FileNotFoundError, PermissionError) as exc:
        raise _service_error(exc) from exc




@router.post("", response_model=PredictionPersistResponse)
def create_prediction(
    payload: PredictionPersistRequest,
    current_user: dict = Depends(require_role("admin", "teacher")),
    db: Session = Depends(get_db),
):
    raise HTTPException(status_code=410, detail="Raw feature persistence is disabled; use /from-records with official source records.")


@router.get("/latest", response_model=PredictionSummaryResponse)
def get_latest_prediction(
    student_id: UUID,
    class_id: int,
    subject_id: int,
    source_period_id: int | None = None,
    target_period_id: int | None = None,
    model_version_id: int | None = None,
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    query = db.query(AIPrediction).filter(
        AIPrediction.student_id == student_id,
        AIPrediction.class_id == class_id,
        AIPrediction.subject_id == subject_id,
    )
    query = query.filter(latest_prediction_filter())
    if current_user.get("role") != "admin":
        query = query.filter(prediction_read_filter(db, staff_id))
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
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    query = db.query(AIPrediction).filter(AIPrediction.class_id == class_id)
    query = query.filter(latest_prediction_filter(), AIPrediction.risk_assessment_status == RISK_ASSESSMENT_EVALUATED)
    if current_user.get("role") != "admin":
        query = query.filter(prediction_read_filter(db, staff_id))
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


@router.get("/model-performance", response_model=ModelPerformanceSummaryResponse)
def get_model_performance(
    model_version_id: int | None = None,
    class_id: int | None = None,
    subject_id: int | None = None,
    academic_period_id: int | None = None,
    current_user: dict = Depends(require_role("admin", "teacher")),
    db: Session = Depends(get_db),
):
    return get_model_performance_summary(
        db,
        model_version_id=model_version_id,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
    )


@router.post("/{prediction_id}/refresh", response_model=PredictionFromRecordsResponse)
def refresh_prediction(
    prediction_id: int,
    payload: PredictionRefreshRequest | None = None,
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    prediction = _authorized_prediction(db, prediction_id, current_user, staff_id, write=True)
    purpose = prediction.model_version.model_purpose if prediction.model_version else None
    scope = {
        "student_id": prediction.student_id,
        "class_id": prediction.class_id,
        "subject_id": prediction.subject_id,
        "source_period_id": prediction.source_period_id,
        "target_period_id": prediction.target_period_id,
    }
    try:
        if purpose == ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value:
            return refresh_unified_prediction_workflow(
                db,
                prediction,
                payload=payload,
                current_user=current_user,
                staff_id=staff_id,
            )

        if purpose == ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value:
            return refresh_current_period_prediction_workflow(
                db,
                prediction,
                payload=payload,
                current_user=current_user,
                staff_id=staff_id,
            )

        if purpose == ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value:
            _assert_teacher_can_use_prediction_scope(db, current_user, staff_id, scope)
            key = payload.generation_request_id if payload else None
            return run_prediction_generation_transaction(
                scope,
                prediction.model_version.model_name if prediction.model_version else DEFAULT_MODEL_NAME,
                lambda generation_db: generate_from_records(
                    generation_db,
                    scope,
                    model_name=prediction.model_version.model_name if prediction.model_version else DEFAULT_MODEL_NAME,
                    is_admin=current_user.get("role") == "admin",
                    staff_id=staff_id,
                    generation_request_id=key,
                ),
                bind=db.get_bind(),
                generation_request_id=key,
            )

        raise HTTPException(
            status_code=422,
            detail="Historical unvalidated or legacy predictions cannot be refreshed.",
        )
    except (ValueError, LookupError, FileNotFoundError, PermissionError, PredictionConflict) as exc:
        raise _service_error(exc) from exc


@router.get("/{prediction_id}/status", response_model=PredictionStatusEnvelopeResponse)
def read_prediction_status(
    prediction_id: int,
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    prediction = _authorized_prediction(db, prediction_id, current_user, staff_id, write=False)
    purpose = prediction.model_version.model_purpose if prediction.model_version else None

    if purpose == ModelPurpose.UNIFIED_CURRENT_TERM_PROJECTION.value:
        status_data = evaluate_unified_projection_status(db, prediction)
        return {
            "prediction_id": prediction_id,
            "model_purpose": purpose,
            "status": status_data,
        }

    if purpose == ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value:
        from app.services.prediction.CurrentPeriodPredictionFreshnessService import (
            evaluate_current_period_prediction_status,
        )
        status_data = evaluate_current_period_prediction_status(
            db,
            prediction,
            current_user=current_user,
            staff_id=staff_id,
        )
        return {
            "prediction_id": prediction_id,
            "model_purpose": purpose,
            "status": status_data,
        }

    if purpose == ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value:
        from app.services.prediction.PredictionStatusService import (
            evaluate_next_period_prediction_status,
        )
        status_data = evaluate_next_period_prediction_status(db, prediction)
        return {
            "prediction_id": prediction_id,
            "model_purpose": purpose,
            "status": status_data,
        }

    raise HTTPException(
        status_code=422,
        detail="Prediction has no authoritative model purpose and does not support status evaluation.",
    )


@router.get("/{prediction_id}/history", response_model=PredictionHistoryResponse)
def read_prediction_history(
    prediction_id: int,
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    prediction = _authorized_prediction(db, prediction_id, current_user, staff_id, write=False)
    return get_prediction_history(db, prediction)


@router.post("/{prediction_id}/outcome/evaluate", response_model=PredictionOutcomeResponse)
def evaluate_outcome(
    prediction_id: int,
    payload: PredictionOutcomeEvaluateRequest,
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    _authorized_prediction(db, prediction_id, current_user, staff_id, write=True)
    try:
        return evaluate_prediction_outcome(
            db,
            prediction_id=prediction_id,
            actual_period_grade=payload.actual_period_grade,
        )
    except (LookupError, ValueError, PermissionError) as exc:
        raise _service_error(exc) from exc


@router.get("/{prediction_id}/detail", response_model=PredictionDetailResponse)
def read_prediction_detail(
    prediction_id: int,
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    is_admin = current_user.get("role") == "admin"
    try:
        return get_prediction_detail(
            db,
            prediction_id=prediction_id,
            staff_id=staff_id,
            is_admin=is_admin,
        )
    except (LookupError, PermissionError) as exc:
        raise _service_error(exc) from exc


@router.post("/{prediction_id}/teacher-review", response_model=TeacherRiskReviewResponse)
def create_teacher_risk_review(
    prediction_id: int,
    payload: TeacherRiskReviewRequest,
    current_user: dict = Depends(require_role("teacher")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    try:
        return review_prediction_risk(
            db,
            prediction_id=prediction_id,
            staff_id=staff_id,
            decision=payload.decision,
            teacher_notes=payload.teacher_notes,
        )
    except (LookupError, ValueError, PermissionError) as exc:
        raise _service_error(exc) from exc


@router.get("/{prediction_id}/teacher-review", response_model=PredictionTeacherReviewListResponse)
def read_teacher_risk_reviews(
    prediction_id: int,
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    _authorized_prediction(db, prediction_id, current_user, staff_id, write=False)
    try:
        return get_teacher_reviews_for_prediction(
            db,
            prediction_id=prediction_id,
            staff_id=staff_id,
            current_user_only=False,
        )
    except LookupError as exc:
        raise _service_error(exc) from exc


@router.get("/{prediction_id}/features", response_model=PredictionFeatureListResponse)
def list_prediction_features(
    prediction_id: int,
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    _authorized_prediction(db, prediction_id, current_user, staff_id, write=False)
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


# ---------------------------------------------------------------------------
# Intervention Linking Endpoints
# ---------------------------------------------------------------------------


@router.post("/{prediction_id}/assign-intervention")
def assign_prediction_intervention(
    prediction_id: int,
    payload: dict[str, Any],
    current_user: dict = Depends(require_role("teacher")),
    staff_id: str | None = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    suggestion = assign_intervention_from_prediction(
        db, prediction_id, staff_id=staff_id, payload=payload
    )
    return {
        "message": "Intervention assigned successfully",
        "student_suggestion_id": suggestion.student_suggestion_id,
        "prediction_id": suggestion.prediction_id,
        "status": suggestion.status,
    }


@router.get("/{prediction_id}/suggestions")
def list_prediction_suggestions(
    prediction_id: int,
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    _authorized_prediction(db, prediction_id, current_user, staff_id, write=False)
    suggestions = get_suggestions_for_prediction(db, prediction_id)
    return [
        {
            "student_suggestion_id": s.student_suggestion_id,
            "suggestion_type": s.suggestion_type,
            "resource_type": s.resource_type,
            "title": s.title,
            "description": s.description,
            "priority": s.priority,
            "status": s.status,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "lesson_id": s.lesson_id,
            "lesson_title": s.lesson.title if s.lesson else None,
            "classwork_assignment_id": (
                s.classwork_link.classwork_assignment_id
                if s.classwork_link
                else None
            ),
        }
        for s in suggestions
    ]

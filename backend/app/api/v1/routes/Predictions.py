from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import func, tuple_
from sqlalchemy.orm import Session

from app.core.Dependencies import get_current_user, get_optional_staff_id, require_role
from app.db.Session import get_db
from app.models.academic.StudentCLass import StudentClass
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.schemas.Prediction import (
    DashboardAtRiskResponse,
    DashboardFilterOptionsResponse,
    DashboardGradeGroupSummary,
    ModelPerformanceSummaryResponse,
    PredictionDetailResponse,
    PredictionFeatureListResponse,
    PredictionListResponse,
    PredictionSummaryResponse,
    PredictionTeacherReviewListResponse,
)
from app.services.prediction.ModelPerformanceService import get_model_performance_summary
from app.services.prediction.PredictionSuggestionService import get_suggestions_for_prediction
from app.services.prediction.TeacherAssignmentResolver import get_teacher_assigned_triplets
from app.services.prediction.RiskSummaryExportService import export_student_risk_summary_csv
from app.services.prediction.PredictionReadService import (
    get_prediction_detail,
    get_teacher_reviews_for_prediction,
)
from app.services.prediction.DashboardPredictionService import (
    get_dashboard_at_risk_predictions,
    get_dashboard_grade_summaries,
    resolve_dashboard_academic_period_id,
)
from app.services.prediction.DashboardFilterService import get_dashboard_filter_options

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
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail=str(exc))
    status_code = 404 if isinstance(exc, LookupError) else 400
    return HTTPException(status_code=status_code, detail=str(exc))


def _assert_student_is_actively_enrolled(db: Session, student_id: UUID, class_id: int) -> None:
    enrollment = db.query(StudentClass.student_class_id).filter(
        StudentClass.student_id == student_id,
        StudentClass.class_id == class_id,
        func.lower(func.coalesce(StudentClass.enrollment_status, "enrolled")) == "enrolled",
    ).first()
    if enrollment is None:
        raise HTTPException(status_code=403, detail="Access denied. The student is not actively enrolled in this prediction scope.")


def _authorize_stored_prediction(
    db: Session,
    current_user: dict[str, Any],
    staff_id: str | None,
    prediction_id: int,
) -> AIPrediction:
    """Authorize prediction-ID operations against the persisted target scope."""
    prediction = db.get(AIPrediction, prediction_id)
    if prediction is None:
        raise HTTPException(status_code=404, detail="Prediction not found.")
    if current_user.get("role") == "admin":
        return prediction
    if not staff_id:
        raise HTTPException(status_code=403, detail="Access denied. Teacher profile is required for prediction access.")
    assigned = get_teacher_assigned_triplets(
        db,
        staff_id,
        academic_period_id=prediction.target_period_id,
    )
    triplet = (prediction.class_id, prediction.subject_id, prediction.target_period_id)
    if triplet not in assigned:
        raise HTTPException(status_code=403, detail="Access denied. You are not assigned to this prediction scope.")
    _assert_student_is_actively_enrolled(db, prediction.student_id, prediction.class_id)
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
    academic_period_id = resolve_dashboard_academic_period_id(
        db,
        academic_period_id=academic_period_id,
        term=term,
    )

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


@router.get("/export-csv")
def export_predictions_csv(
    academic_period_id: int | None = Query(None, description="Academic period ID filter"),
    class_id: int | None = Query(None, description="Class / Section ID filter"),
    subject_id: int | None = Query(None, description="Subject ID filter"),
    grade_level: int | None = Query(None, ge=1, le=12, description="Grade level filter (7-12)"),
    risk_level: str | None = Query(None, description="Risk level filter"),
    search: str | None = Query(None, description="Search term for student name or LRN"),
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    """Export student risk summary predictions as an RFC-4180 CSV file with formula protection."""
    content, filename = export_student_risk_summary_csv(
        db,
        academic_period_id=academic_period_id,
        class_id=class_id,
        subject_id=subject_id,
        grade_level=grade_level,
        risk_level=risk_level,
        search=search,
        current_user=current_user,
        staff_id=staff_id,
    )
    return Response(
        content=content,
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
        },
    )



# ---------------------------------------------------------------------------
# Scoring / Feature / Persistence endpoints
# ---------------------------------------------------------------------------


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
    if source_period_id is not None:
        query = query.filter(AIPrediction.source_period_id == source_period_id)
    if target_period_id is not None:
        query = query.filter(AIPrediction.target_period_id == target_period_id)
    if model_version_id is not None:
        query = query.filter(AIPrediction.model_version_id == model_version_id)

    prediction = query.order_by(AIPrediction.generated_at.desc(), AIPrediction.prediction_id.desc()).first()
    if prediction is None:
        raise HTTPException(status_code=404, detail="Prediction not found")
    _authorize_stored_prediction(db, current_user, staff_id, prediction.prediction_id)
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
    if current_user.get("role") != "admin":
        if not staff_id:
            raise HTTPException(status_code=403, detail="Access denied. Teacher profile is required for prediction access.")
        assigned = {
            triplet
            for triplet in get_teacher_assigned_triplets(db, staff_id, academic_period_id=target_period_id)
            if triplet[0] == class_id
        }
        if not assigned:
            raise HTTPException(status_code=403, detail="Access denied. You are not assigned to this class prediction scope.")
        if subject_id is not None and not any(triplet[1] == subject_id for triplet in assigned):
            raise HTTPException(status_code=403, detail="Access denied. You are not assigned to this subject prediction scope.")
        query = query.filter(
            tuple_(AIPrediction.class_id, AIPrediction.subject_id, AIPrediction.target_period_id).in_(assigned)
        ).join(
            StudentClass,
            (StudentClass.student_id == AIPrediction.student_id)
            & (StudentClass.class_id == AIPrediction.class_id),
        ).filter(
            func.lower(func.coalesce(StudentClass.enrollment_status, "enrolled")) == "enrolled"
        )
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
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return get_model_performance_summary(
        db,
        model_version_id=model_version_id,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
    )


@router.get("/{prediction_id}/detail", response_model=PredictionDetailResponse)
def read_prediction_detail(
    prediction_id: int,
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    is_admin = current_user.get("role") == "admin"
    try:
        _authorize_stored_prediction(db, current_user, staff_id, prediction_id)
        return get_prediction_detail(
            db,
            prediction_id=prediction_id,
            staff_id=staff_id,
            is_admin=is_admin,
        )
    except (LookupError, PermissionError) as exc:
        raise _service_error(exc) from exc


@router.get("/{prediction_id}/teacher-review", response_model=PredictionTeacherReviewListResponse)
def read_teacher_risk_reviews(
    prediction_id: int,
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    try:
        _authorize_stored_prediction(db, current_user, staff_id, prediction_id)
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
    _authorize_stored_prediction(db, current_user, staff_id, prediction_id)

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
# Historical linked-record endpoints (read-only)
# ---------------------------------------------------------------------------


@router.get("/{prediction_id}/suggestions")
def list_prediction_suggestions(
    prediction_id: int,
    current_user: dict = Depends(require_role("admin", "teacher")),
    staff_id: str | None = Depends(get_optional_staff_id),
    db: Session = Depends(get_db),
):
    _authorize_stored_prediction(db, current_user, staff_id, prediction_id)
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

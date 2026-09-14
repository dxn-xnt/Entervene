from __future__ import annotations

from copy import deepcopy
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.AIPrediction import AIPrediction
from app.models.people.Student import Student
from app.services.prediction.ModelScoringService import DEFAULT_MODEL_NAME, get_active_model_version
from app.services.prediction.PredictionFeatureBuilderService import build_prediction_features_from_records
from app.services.prediction.PredictionGenerationService import build_current_evidence_contract
from app.services.prediction.PredictionScopeService import (
    authorize_generation,
    authorize_prediction_read,
    latest_prediction_filter,
    prediction_metadata,
    validate_forecast_scope,
)


def _float(value):
    return float(value) if value is not None else None


def _period_label(period: AcademicPeriod | None) -> str | None:
    return period.period_name if period else None


def _student_name(student: Student) -> str:
    return f"{student.last_name}, {student.first_name}"


def _resolve_next_period(db: Session, source_period_id: int, target_period_id: int | None):
    source = db.get(AcademicPeriod, source_period_id)
    if source is None:
        raise ValueError("Source academic period was not found.")
    if target_period_id is not None:
        target = db.get(AcademicPeriod, target_period_id)
        if target is None:
            raise ValueError("Target academic period was not found.")
        return source, target, None
    if source.period_sequence >= source.total_periods_in_year:
        return source, None, "NO_NEXT_PERIOD"
    target = (
        db.query(AcademicPeriod)
        .filter(
            AcademicPeriod.academic_year_id == source.academic_year_id,
            AcademicPeriod.period_type == source.period_type,
            AcademicPeriod.total_periods_in_year == source.total_periods_in_year,
            AcademicPeriod.period_sequence == source.period_sequence + 1,
        )
        .one_or_none()
    )
    return source, target, None if target else "NEXT_PERIOD_NOT_CONFIGURED"


def _prediction_summary(prediction: AIPrediction | None, *, is_latest=True):
    if prediction is None:
        return None
    snapshot = prediction.evidence_snapshot or {}
    return {
        **prediction_metadata(prediction),
        "prediction_id": prediction.prediction_id,
        "revision": prediction.revision,
        "is_latest": is_latest,
        "model_version_id": prediction.model_version_id,
        "source_period_id": prediction.source_period_id,
        "target_period_id": prediction.target_period_id,
        "generated_at": prediction.generated_at,
        "evidence_cutoff_at": snapshot.get("evidence_cutoff_at"),
        "predicted_period_grade": _float(prediction.predicted_period_grade),
        "risk_level": prediction.risk_level,
        "risk_score": _float(prediction.risk_score),
        "data_status": prediction.data_status,
        "generation_reason": (snapshot.get("generation") or {}).get("reason"),
    }


def _latest_prediction_for_status(db: Session, scope: dict[str, Any], model: AIModelVersion | None):
    exact = [
        AIPrediction.student_id == scope["student_id"],
        AIPrediction.class_id == scope["class_id"],
        AIPrediction.subject_id == scope["subject_id"],
        AIPrediction.source_period_id == scope["source_period_id"],
        AIPrediction.target_period_id == scope["target_period_id"],
    ]
    if model is not None:
        row = (
            db.query(AIPrediction)
            .filter(*exact, AIPrediction.model_version_id == model.model_version_id, latest_prediction_filter())
            .order_by(AIPrediction.revision.desc(), AIPrediction.prediction_id.desc())
            .first()
        )
        if row is not None:
            return row
    return (
        db.query(AIPrediction)
        .filter(*exact, latest_prediction_filter())
        .order_by(AIPrediction.generated_at.desc(), AIPrediction.prediction_id.desc())
        .first()
    )


def _readiness_contract(built: dict[str, Any]) -> dict[str, Any]:
    summary = built.get("evidence_summary") or {}
    return {
        "ready": bool(built.get("ready")),
        "readiness_level": built.get("readiness_level", "INSUFFICIENT"),
        "reasons": built.get("readiness_reasons", []),
        "coverage_ratio": summary.get("data_coverage_ratio"),
        "completion_rate": summary.get("assessment_completion_rate"),
        "coverage_state": summary.get("coverage_state"),
        "completion_state": summary.get("completion_state"),
        "source_grade_provenance": summary.get("source_grade_provenance"),
        "graded_count": summary.get("graded_count"),
        "expected_count": summary.get("expected_count"),
    }


def _eligibility_status(error: str | None) -> str:
    if not error:
        return "ELIGIBLE"
    if "NO_NEXT_PERIOD" in error:
        return "NO_NEXT_PERIOD"
    if "OFFICIAL finalized source period grade" in error:
        return "AWAITING_OFFICIAL_SOURCE_GRADE"
    if "already finalized or known" in error:
        return "TARGET_OUTCOME_KNOWN"
    return "INELIGIBLE"


def _fingerprint_status(db: Session, prediction: AIPrediction | None, scope: dict[str, Any]):
    if prediction is None:
        return {"status": "NOT_APPLICABLE", "comparable": False}
    snapshot = prediction.evidence_snapshot or {}
    if snapshot.get("snapshot_version") != "prediction-evidence-v2" or not snapshot.get("evidence_fingerprint"):
        return {"status": "UNKNOWN", "comparable": False, "reason": "Legacy forecast has no comparable Stage 2 fingerprint."}
    relationship = snapshot.get("validated_relationship")
    if not relationship:
        return {"status": "UNKNOWN", "comparable": False, "reason": "Audited relationship metadata is unavailable."}
    model = prediction.model_version
    if model is None:
        return {"status": "UNKNOWN", "comparable": False, "reason": "Model version is unavailable."}
    try:
        contract = build_current_evidence_contract(
            db,
            scope,
            model_name=model.model_name,
            model_version=model,
            relationship=relationship,
        )
    except Exception as exc:
        return {"status": "UNKNOWN", "comparable": False, "reason": str(exc)}
    current = contract["evidence_fingerprint"]
    saved = snapshot.get("evidence_fingerprint")
    return {
        "status": "CURRENT" if current == saved else "SOURCE_EVIDENCE_CHANGED",
        "comparable": True,
        "saved_fingerprint": saved,
        "current_fingerprint": current,
    }


def _row_status(*, latest, readiness, eligibility, freshness, no_next_reason=None):
    if no_next_reason == "NO_NEXT_PERIOD" or eligibility.get("status") == "NO_NEXT_PERIOD":
        return "NO_NEXT_PERIOD"
    if latest is not None:
        metadata = prediction_metadata(latest)
        if metadata["validation_status"] == "LEGACY_UNVALIDATED":
            return "LEGACY_UNKNOWN"
        if freshness.get("status") == "SOURCE_EVIDENCE_CHANGED":
            return "SOURCE_EVIDENCE_CHANGED"
        if freshness.get("status") == "CURRENT":
            return "FORECAST_CURRENT"
        return "LEGACY_UNKNOWN"
    if not readiness.get("ready"):
        coverage = readiness.get("coverage_ratio")
        if coverage in (None, 0):
            return "COLLECTING_DATA"
        return "NOT_READY"
    if eligibility.get("eligible"):
        return "READY_FOR_FORECAST"
    return "FORECAST_UNAVAILABLE"


def _message_for(status: str, readiness: dict[str, Any], eligibility: dict[str, Any], latest):
    coverage = readiness.get("coverage_ratio")
    coverage_text = f"{round(float(coverage) * 100)}% of assigned graded activities have recorded scores" if coverage is not None else "Prediction unavailable"
    if status == "COLLECTING_DATA":
        return f"Collecting evidence · {coverage_text}."
    if status == "NOT_READY":
        return f"Collecting evidence · {coverage_text}."
    if status == "READY_FOR_FORECAST":
        return f"{readiness.get('readiness_level', 'Ready').title()} academic evidence available · Ready for next-term forecast."
    if status == "FORECAST_UNAVAILABLE" and eligibility.get("status") == "AWAITING_OFFICIAL_SOURCE_GRADE":
        return f"{readiness.get('readiness_level', 'Ready').title()} academic evidence available · Next-term forecast awaits the official source grade."
    if status == "FORECAST_CURRENT":
        return f"Predicted target grade: {latest.predicted_period_grade} · Forecast current."
    if status == "SOURCE_EVIDENCE_CHANGED":
        return f"New source academic evidence is available · Current saved forecast: revision {latest.revision}."
    if status == "NO_NEXT_PERIOD":
        return "No next period exists for this source period."
    if status == "LEGACY_UNKNOWN":
        return "Historical unvalidated forecast."
    return eligibility.get("reason") or "Forecast unavailable."


def _status_for_student(db: Session, *, student: Student, class_id: int, subject_id: int, source, target, model, no_next_reason):
    scope = {
        "student_id": student.student_id,
        "class_id": class_id,
        "subject_id": subject_id,
        "source_period_id": source.academic_period_id,
        "target_period_id": target.academic_period_id if target else None,
    }
    if target is None:
        readiness = {"ready": False, "readiness_level": "INSUFFICIENT", "reasons": [], "coverage_ratio": None}
        eligibility = {"eligible": False, "status": no_next_reason or "INELIGIBLE", "reason": no_next_reason}
        latest = None
        freshness = {"status": "NOT_APPLICABLE", "comparable": False}
    else:
        build_scope = dict(scope)
        latest = _latest_prediction_for_status(db, scope, model)
        try:
            built = build_prediction_features_from_records(db, **build_scope, model_name=DEFAULT_MODEL_NAME, model_version=model)
            readiness = _readiness_contract(built)
        except Exception as exc:
            readiness = {"ready": False, "readiness_level": "INSUFFICIENT", "reasons": [str(exc)], "coverage_ratio": None}
        try:
            relationship = validate_forecast_scope(db, scope)
            eligibility = {"eligible": True, "status": "ELIGIBLE", "reason": None, "relationship": relationship}
        except ValueError as exc:
            eligibility = {"eligible": False, "status": _eligibility_status(str(exc)), "reason": str(exc)}
        freshness = _fingerprint_status(db, latest, scope)
    status = _row_status(latest=latest, readiness=readiness, eligibility=eligibility, freshness=freshness, no_next_reason=no_next_reason)
    return {
        "student_id": student.student_id,
        "student_name": _student_name(student),
        "student_lrn": student.student_lrn,
        "class_id": class_id,
        "subject_id": subject_id,
        "source_period_id": source.academic_period_id,
        "target_period_id": target.academic_period_id if target else None,
        "source_period_label": _period_label(source),
        "target_period_label": _period_label(target),
        "status": status,
        "message": _message_for(status, readiness, eligibility, latest),
        "evidence_readiness": readiness,
        "forecast_eligibility": eligibility,
        "forecast_freshness": freshness,
        "latest_prediction": _prediction_summary(latest) if latest else None,
    }


def get_roster_prediction_status(
    db: Session,
    *,
    class_id: int,
    subject_id: int,
    source_period_id: int,
    target_period_id: int | None,
    staff_id: str | None,
    is_admin: bool,
):
    source, target, no_next_reason = _resolve_next_period(db, source_period_id, target_period_id)
    scope_for_auth = {
        "student_id": UUID("00000000-0000-0000-0000-000000000000"),
        "class_id": class_id,
        "subject_id": subject_id,
        "source_period_id": source_period_id,
        "target_period_id": target.academic_period_id if target else source_period_id,
    }
    if not is_admin:
        authorize_generation(db, scope_for_auth, is_admin=False, staff_id=staff_id)
    class_ = db.get(Class, class_id)
    subject = db.get(Subject, subject_id)
    if class_ is None or subject is None:
        raise ValueError("Class and subject must exist.")
    try:
        model = get_active_model_version(db, DEFAULT_MODEL_NAME)
    except Exception:
        model = None
    students = (
        db.query(Student)
        .join(StudentClass, StudentClass.student_id == Student.student_id)
        .filter(
            StudentClass.class_id == class_id,
            StudentClass.academic_year_id == source.academic_year_id,
            func.lower(func.coalesce(StudentClass.enrollment_status, "enrolled")) == "enrolled",
        )
        .order_by(Student.last_name.asc(), Student.first_name.asc(), Student.student_lrn.asc())
        .all()
    )
    rows = [
        _status_for_student(db, student=student, class_id=class_id, subject_id=subject_id, source=source,
                            target=target, model=model, no_next_reason=no_next_reason)
        for student in students
    ]
    counts: dict[str, int] = {}
    for row in rows:
        counts[row["status"]] = counts.get(row["status"], 0) + 1
    return {
        "class_id": class_id,
        "class_name": class_.section_name,
        "subject_id": subject_id,
        "subject_name": subject.subject_name,
        "source_period_id": source.academic_period_id,
        "target_period_id": target.academic_period_id if target else None,
        "source_period_label": _period_label(source),
        "target_period_label": _period_label(target),
        "items": rows,
        "total": len(rows),
        "status_counts": counts,
    }


def get_prediction_history(db: Session, prediction: AIPrediction):
    rows = (
        db.query(AIPrediction)
        .filter(
            AIPrediction.student_id == prediction.student_id,
            AIPrediction.class_id == prediction.class_id,
            AIPrediction.subject_id == prediction.subject_id,
            AIPrediction.source_period_id == prediction.source_period_id,
            AIPrediction.target_period_id == prediction.target_period_id,
            AIPrediction.model_version_id.is_not_distinct_from(prediction.model_version_id),
        )
        .order_by(AIPrediction.revision.asc(), AIPrediction.prediction_id.asc())
        .all()
    )
    latest_revision = max((row.revision for row in rows), default=None)
    scope = {
        "student_id": prediction.student_id,
        "class_id": prediction.class_id,
        "subject_id": prediction.subject_id,
        "source_period_id": prediction.source_period_id,
        "target_period_id": prediction.target_period_id,
    }
    freshness_by_id = {row.prediction_id: _fingerprint_status(db, row, scope) for row in rows}
    return {
        "scope": {
            "student_id": prediction.student_id,
            "class_id": prediction.class_id,
            "subject_id": prediction.subject_id,
            "source_period_id": prediction.source_period_id,
            "target_period_id": prediction.target_period_id,
            "model_version_id": prediction.model_version_id,
        },
        "items": [
            {
                **_prediction_summary(row, is_latest=row.revision == latest_revision),
                "source_period_label": row.source_period.period_name if row.source_period else None,
                "target_period_label": row.target_period.period_name if row.target_period else None,
                "forecast_freshness": freshness_by_id[row.prediction_id],
            }
            for row in rows
        ],
    }

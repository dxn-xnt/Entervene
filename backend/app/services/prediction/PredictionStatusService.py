from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session, joinedload

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    build_classwork_evidence_rows_for_student,
    calculate_current_period_features_from_evidence,
    load_current_period_feature_schema,
    resolve_subject_grading_weights,
)
from app.services.prediction.CurrentPeriodPredictionFreshnessService import (
    evaluate_current_period_prediction_status,
)
from app.services.prediction.CurrentPeriodPredictionGenerationService import (
    EVIDENCE_CONTRACT_VERSION,
    SNAPSHOT_VERSION,
)
from app.services.prediction.ModelScoringService import (
    DEFAULT_MODEL_NAME,
    get_active_model_version,
    get_active_model_version_by_purpose,
    resolve_artifact_path,
)
from app.services.prediction.ModelVersionService import compute_file_sha256, load_json
from app.services.prediction.PredictionFeatureBuilderService import build_prediction_features_from_records
from app.services.prediction.PredictionGenerationService import build_current_evidence_contract
from app.services.prediction.PredictionScopeService import (
    authorize_generation,
    authorize_prediction_read,
    latest_prediction_filter,
    prediction_metadata,
    validate_forecast_scope,
)
from app.services.prediction.TeacherAssignmentResolver import (
    get_teacher_assigned_triplets,
    resolve_teacher_for_load,
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
        "risk_assessment_status": prediction.risk_assessment_status,
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


def evaluate_next_period_prediction_status(db: Session, prediction: AIPrediction) -> dict[str, Any]:
    """Side-effect free Stage 2 forecast status evaluation for a specific NEXT prediction."""
    scope = {
        "student_id": prediction.student_id,
        "class_id": prediction.class_id,
        "subject_id": prediction.subject_id,
        "source_period_id": prediction.source_period_id,
        "target_period_id": prediction.target_period_id,
    }
    source, target, no_next_reason = _resolve_next_period(db, prediction.source_period_id, prediction.target_period_id)
    model = prediction.model_version
    try:
        built = build_prediction_features_from_records(
            db, **scope, model_name=DEFAULT_MODEL_NAME, model_version=model
        )
        readiness = _readiness_contract(built)
    except Exception as exc:
        readiness = {
            "ready": False,
            "readiness_level": "INSUFFICIENT",
            "reasons": [str(exc)],
            "coverage_ratio": None,
        }

    try:
        relationship = validate_forecast_scope(db, scope)
        eligibility = {"eligible": True, "status": "ELIGIBLE", "reason": None, "relationship": relationship}
    except ValueError as exc:
        eligibility = {"eligible": False, "status": _eligibility_status(str(exc)), "reason": str(exc)}

    freshness = _fingerprint_status(db, prediction, scope)
    row_status = _row_status(
        latest=prediction,
        readiness=readiness,
        eligibility=eligibility,
        freshness=freshness,
        no_next_reason=no_next_reason,
    )
    message = _message_for(row_status, readiness, eligibility, prediction)
    latest_row = _latest_prediction_for_status(db, scope, model)

    return {
        "status": row_status,
        "message": message,
        "evidence_readiness": readiness,
        "forecast_eligibility": eligibility,
        "forecast_freshness": freshness,
        "requested_prediction": _prediction_summary(prediction),
        "latest_prediction": _prediction_summary(latest_row) if latest_row else None,
    }


def _model_version_dict(version: AIModelVersion | None) -> dict[str, Any] | None:
    if version is None:
        return None
    return {
        "model_version_id": version.model_version_id,
        "model_name": version.model_name,
        "model_type": version.model_type,
        "algorithm": version.algorithm,
        "is_active": bool(version.is_active),
    }


def _datetime_sort_key(dt: datetime | None) -> float:
    if dt is None:
        return 0.0
    if dt.tzinfo is not None:
        return dt.timestamp()
    return dt.replace(tzinfo=timezone.utc).timestamp()


def get_dual_purpose_roster_status(
    db: Session,
    *,
    class_id: int,
    subject_id: int,
    academic_period_id: int,
    staff_id: str | None = None,
    is_admin: bool = False,
) -> dict[str, Any]:
    # 1. Period resolution
    period = db.get(AcademicPeriod, academic_period_id)
    if period is None:
        raise ValueError("Academic period was not found.")

    # 2. Teacher authorization based on focal Term N: (class_id, subject_id, academic_period_id)
    if not is_admin:
        assigned = get_teacher_assigned_triplets(db, staff_id) if staff_id else set()
        if (class_id, subject_id, academic_period_id) not in assigned:
            raise PermissionError("You are not assigned to this class, subject, and academic period.")

    class_ = db.get(Class, class_id)
    subject = db.get(Subject, subject_id)
    if class_ is None or subject is None:
        raise ValueError("Class and subject must exist.")

    # Resolve prior period in sequence (if Term > 1)
    if period.period_sequence > 1:
        prior_period = (
            db.query(AcademicPeriod)
            .filter(
                AcademicPeriod.academic_year_id == period.academic_year_id,
                AcademicPeriod.period_type == period.period_type,
                AcademicPeriod.period_sequence == period.period_sequence - 1,
            )
            .first()
        )
    else:
        prior_period = None

    # Resolve next period in sequence
    if period.period_sequence < period.total_periods_in_year:
        next_period = (
            db.query(AcademicPeriod)
            .filter(
                AcademicPeriod.academic_year_id == period.academic_year_id,
                AcademicPeriod.period_type == period.period_type,
                AcademicPeriod.period_sequence == period.period_sequence + 1,
            )
            .first()
        )
        next_period_status = "AVAILABLE" if next_period is not None else "NO_NEXT_PERIOD"
    else:
        next_period = None
        next_period_status = "NO_NEXT_PERIOD"

    # Teacher info for class_context (admin or teacher)
    teacher_info = None
    teacher_assignment = resolve_teacher_for_load(db, class_id, subject_id, academic_period_id)
    if teacher_assignment and teacher_assignment.staff_id:
        t_name = getattr(teacher_assignment, "teacher_name", None) or getattr(teacher_assignment, "full_name", None)
        teacher_info = {
            "staff_id": teacher_assignment.staff_id,
            "teacher_name": t_name,
            "full_name": t_name,
            "email": getattr(teacher_assignment, "email", None),
        }

    # 3. Active models resolution via purpose
    try:
        active_next_model = get_active_model_version_by_purpose(
            db, ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST
        )
    except Exception:
        active_next_model = None

    try:
        active_current_model = get_active_model_version_by_purpose(
            db, ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION
        )
    except Exception:
        active_current_model = None

    # 4. Enrolled students
    students = (
        db.query(Student)
        .join(StudentClass, StudentClass.student_id == Student.student_id)
        .filter(
            StudentClass.class_id == class_id,
            StudentClass.academic_year_id == period.academic_year_id,
            func.lower(func.coalesce(StudentClass.enrollment_status, "enrolled")) == "enrolled",
        )
        .order_by(Student.last_name.asc(), Student.first_name.asc(), Student.student_lrn.asc())
        .all()
    )
    student_ids = [s.student_id for s in students]

    # 5. Bulk preloading
    # Preload grading weights & current feature schema
    weights = resolve_subject_grading_weights(db, subject_id, getattr(class_, "academic_level_id", None))
    schema = load_current_period_feature_schema()
    class_level = db.get(AcademicLevel, class_.academic_level_id) if getattr(class_, "academic_level_id", None) else None
    class_grade_level = float(class_level.grade_level) if class_level and class_level.grade_level else 0.0

    # Preload classwork assignments & legacy check for current period
    assignments = (
        db.query(ClassworkAssignment, Classwork)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .filter(
            ClassworkAssignment.class_id == class_id,
            ClassworkAssignment.academic_period_id == academic_period_id,
            Classwork.subject_id == subject_id,
            Classwork.is_archived.is_(False),
            Classwork.is_graded.is_(True),
            Classwork.classwork_type != "READING",
        )
        .order_by(ClassworkAssignment.classwork_assignment_id)
        .all()
    )
    legacy_exists = (
        db.query(ClassworkAssignment.classwork_assignment_id)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .filter(
            ClassworkAssignment.class_id == class_id,
            ClassworkAssignment.academic_period_id.is_(None),
            Classwork.subject_id == subject_id,
            Classwork.is_archived.is_(False),
            Classwork.is_graded.is_(True),
            Classwork.classwork_type != "READING",
        )
        .first()
        is not None
    )
    assignment_ids = [a.classwork_assignment_id for a, _ in assignments]

    # Preload submissions for all enrolled students
    submissions_by_student: dict[UUID, list[StudentSubmission]] = defaultdict(list)
    if assignment_ids and student_ids:
        subs = (
            db.query(StudentSubmission)
            .filter(
                StudentSubmission.student_id.in_(student_ids),
                StudentSubmission.classwork_assignment_id.in_(assignment_ids),
            )
            .all()
        )
        for sub in subs:
            submissions_by_student[sub.student_id].append(sub)

    # Bulk preload predictions for all enrolled students
    next_preds_by_student: dict[UUID, list[AIPrediction]] = defaultdict(list)
    curr_preds_by_student: dict[UUID, list[AIPrediction]] = defaultdict(list)
    if student_ids:
        all_preds = (
            db.query(AIPrediction)
            .options(joinedload(AIPrediction.model_version))
            .filter(
                AIPrediction.student_id.in_(student_ids),
                AIPrediction.class_id == class_id,
                AIPrediction.subject_id == subject_id,
            )
            .all()
        )
        for p in all_preds:
            model_v = p.model_version
            purpose = model_v.model_purpose if model_v else None
            if (
                purpose == ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value
                and prior_period is not None
                and p.source_period_id == prior_period.academic_period_id
                and p.target_period_id == academic_period_id
            ):
                next_preds_by_student[p.student_id].append(p)
            elif (
                purpose == ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value
                and p.source_period_id == academic_period_id
                and p.target_period_id == academic_period_id
            ):
                curr_preds_by_student[p.student_id].append(p)

    # Bulk preload StudentPeriodGrade for focal period
    focal_grades: dict[UUID, StudentPeriodGrade] = {}
    prior_grades: dict[UUID, StudentPeriodGrade] = {}
    if student_ids:
        f_grades = (
            db.query(StudentPeriodGrade)
            .filter(
                StudentPeriodGrade.student_id.in_(student_ids),
                StudentPeriodGrade.class_id == class_id,
                StudentPeriodGrade.subject_id == subject_id,
                StudentPeriodGrade.academic_period_id == academic_period_id,
            )
            .all()
        )
        focal_grades = {g.student_id: g for g in f_grades}

        if prior_period is not None:
            p_grades = (
                db.query(StudentPeriodGrade)
                .filter(
                    StudentPeriodGrade.student_id.in_(student_ids),
                    StudentPeriodGrade.class_id == class_id,
                    StudentPeriodGrade.subject_id == subject_id,
                    StudentPeriodGrade.academic_period_id == prior_period.academic_period_id,
                )
                .all()
            )
            prior_grades = {g.student_id: g for g in p_grades}

    # Bulk preload PredictionOutcome for focal period
    focal_outcomes: dict[UUID, PredictionOutcome] = {}
    if student_ids:
        outcomes = (
            db.query(PredictionOutcome)
            .join(AIPrediction, PredictionOutcome.prediction_id == AIPrediction.prediction_id)
            .filter(
                AIPrediction.student_id.in_(student_ids),
                AIPrediction.class_id == class_id,
                AIPrediction.subject_id == subject_id,
                AIPrediction.target_period_id == academic_period_id,
                PredictionOutcome.actual_period_grade.isnot(None),
            )
            .all()
        )
        for o in outcomes:
            if o.prediction:
                focal_outcomes[o.prediction.student_id] = o

    now_utc = datetime.now(timezone.utc)
    student_items = []

    for s in students:
        # A. Evaluate period_outcome
        fg = focal_grades.get(s.student_id)
        fo = focal_outcomes.get(s.student_id)
        if fg is not None and fg.is_finalized and fg.final_period_grade is not None:
            period_outcome = {
                "status": "FINALIZED",
                "actual_grade": float(fg.final_period_grade),
            }
        elif fo is not None and fo.actual_period_grade is not None:
            period_outcome = {
                "status": "FINALIZED",
                "actual_grade": float(fo.actual_period_grade),
            }
        else:
            period_outcome = {
                "status": "IN_PROGRESS",
                "actual_grade": None,
            }

        # B. NEXT Baseline Selection (Deterministic Two-Phase Selection)
        s_next_preds = next_preds_by_student.get(s.student_id, [])
        latest_next: AIPrediction | None = None
        if active_next_model is not None:
            active_next_preds = [
                p for p in s_next_preds if p.model_version_id == active_next_model.model_version_id
            ]
            if active_next_preds:
                latest_next = max(active_next_preds, key=lambda p: (p.revision, p.prediction_id))
        if latest_next is None and s_next_preds:
            latest_next = max(
                s_next_preds,
                key=lambda p: (_datetime_sort_key(p.generated_at), p.prediction_id),
            )

        # C. NEXT Baseline Forecast Status
        if prior_period is None:
            baseline_forecast = {
                "purpose": "NEXT_PERIOD_BASELINE_FORECAST",
                "status": "NO_PREVIOUS_PERIOD",
                "message": "No previous period baseline is available for Term 1.",
                "source_period_id": None,
                "target_period_id": academic_period_id,
                "source_period_label": None,
                "target_period_label": _period_label(period),
                "predicted_grade": None,
                "risk_level": None,
                "risk_score": None,
                "data_status": None,
                "risk_assessment_status": None,
                "evidence_readiness": {
                    "ready": False,
                    "readiness_level": "INSUFFICIENT",
                    "reasons": ["No previous period exists for Term 1."],
                    "coverage_ratio": None,
                },
                "forecast_eligibility": {
                    "eligible": False,
                    "status": "NO_PREVIOUS_PERIOD",
                    "reason": "No previous period baseline is available for Term 1.",
                },
                "forecast_freshness": {
                    "status": "NOT_APPLICABLE",
                    "comparable": False,
                    "reason": None,
                    "saved_fingerprint": None,
                    "current_fingerprint": None,
                },
                "latest_prediction_id": None,
                "model_version": None,
                "revision": None,
                "generated_at": None,
            }
        else:
            base_scope = {
                "student_id": s.student_id,
                "class_id": class_id,
                "subject_id": subject_id,
                "source_period_id": prior_period.academic_period_id,
                "target_period_id": academic_period_id,
            }
            if latest_next is not None:
                base_freshness = _fingerprint_status(db, latest_next, base_scope)
                base_status = (
                    "SOURCE_EVIDENCE_CHANGED"
                    if base_freshness.get("status") == "SOURCE_EVIDENCE_CHANGED"
                    else "FORECAST_CURRENT"
                )
                base_msg = (
                    f"New source academic evidence is available · Current saved forecast: revision {latest_next.revision}."
                    if base_status == "SOURCE_EVIDENCE_CHANGED"
                    else f"Predicted target grade: {latest_next.predicted_period_grade} · Forecast current."
                )
                baseline_forecast = {
                    "purpose": "NEXT_PERIOD_BASELINE_FORECAST",
                    "status": base_status,
                    "message": base_msg,
                    "source_period_id": prior_period.academic_period_id,
                    "target_period_id": academic_period_id,
                    "source_period_label": _period_label(prior_period),
                    "target_period_label": _period_label(period),
                    "predicted_grade": _float(latest_next.predicted_period_grade),
                    "risk_level": latest_next.risk_level,
                    "risk_score": _float(latest_next.risk_score),
                    "data_status": latest_next.data_status,
                    "risk_assessment_status": latest_next.risk_assessment_status,
                    "evidence_readiness": {
                        "ready": True,
                        "readiness_level": "SUFFICIENT",
                        "coverage_ratio": 1.0,
                        "reasons": [],
                    },
                    "forecast_eligibility": {
                        "eligible": True,
                        "status": "ELIGIBLE",
                        "reason": None,
                    },
                    "forecast_freshness": base_freshness,
                    "latest_prediction_id": latest_next.prediction_id,
                    "model_version": _model_version_dict(latest_next.model_version),
                    "revision": latest_next.revision,
                    "generated_at": latest_next.generated_at,
                }
            else:
                pg = prior_grades.get(s.student_id)
                if pg is not None and pg.is_finalized and pg.final_period_grade is not None:
                    base_status = "READY_FOR_FORECAST"
                    base_msg = "Ready academic evidence available · Ready for next-term forecast."
                    base_elig = {"eligible": True, "status": "ELIGIBLE", "reason": None}
                else:
                    base_status = "AWAITING_OFFICIAL_SOURCE_GRADE"
                    base_msg = "Next-term forecast awaits the official source grade."
                    base_elig = {
                        "eligible": False,
                        "status": "AWAITING_OFFICIAL_SOURCE_GRADE",
                        "reason": "An official finalized source period grade is required.",
                    }
                baseline_forecast = {
                    "purpose": "NEXT_PERIOD_BASELINE_FORECAST",
                    "status": base_status,
                    "message": base_msg,
                    "source_period_id": prior_period.academic_period_id,
                    "target_period_id": academic_period_id,
                    "source_period_label": _period_label(prior_period),
                    "target_period_label": _period_label(period),
                    "predicted_grade": None,
                    "risk_level": None,
                    "risk_score": None,
                    "data_status": None,
                    "risk_assessment_status": None,
                    "evidence_readiness": {
                        "ready": False,
                        "readiness_level": "INSUFFICIENT",
                        "reasons": [],
                        "coverage_ratio": None,
                    },
                    "forecast_eligibility": base_elig,
                    "forecast_freshness": {
                        "status": "NOT_APPLICABLE",
                        "comparable": False,
                        "reason": None,
                        "saved_fingerprint": None,
                        "current_fingerprint": None,
                    },
                    "latest_prediction_id": None,
                    "model_version": None,
                    "revision": None,
                    "generated_at": None,
                }

        # D. CURRENT Projection Selection (Deterministic Two-Phase Selection)
        s_curr_preds = curr_preds_by_student.get(s.student_id, [])
        latest_curr: AIPrediction | None = None
        if active_current_model is not None:
            active_curr_preds = [
                p for p in s_curr_preds if p.model_version_id == active_current_model.model_version_id
            ]
            if active_curr_preds:
                latest_curr = max(active_curr_preds, key=lambda p: (p.revision, p.prediction_id))
        if latest_curr is None and s_curr_preds:
            latest_curr = max(
                s_curr_preds,
                key=lambda p: (_datetime_sort_key(p.generated_at), p.prediction_id),
            )

        # Prebuilt live evidence for current period
        s_subs = submissions_by_student.get(s.student_id, [])
        s_rows = build_classwork_evidence_rows_for_student(assignments, s_subs)
        prebuilt = calculate_current_period_features_from_evidence(
            subject=subject,
            grade_level=class_grade_level,
            weights=weights,
            schema=schema,
            rows=s_rows,
            legacy_classwork_exists=legacy_exists,
            academic_period_id=academic_period_id,
            cutoff_at=now_utc,
        )

        if active_current_model is not None:
            prebuilt["model_version_id"] = active_current_model.model_version_id
            prebuilt["model_name"] = active_current_model.model_name
            prebuilt["evidence_contract_version"] = EVIDENCE_CONTRACT_VERSION
            prebuilt["snapshot_version"] = SNAPSHOT_VERSION
            schema_sha = None
            if active_current_model.artifact_path:
                try:
                    resolved = resolve_artifact_path(active_current_model.artifact_path)
                    manifest_p = resolved.with_name(f"{active_current_model.model_name}_manifest.json")
                    if manifest_p.exists():
                        manifest = load_json(manifest_p)
                        schema_sha = manifest.get("artifact_hashes", {}).get("feature_schema_sha256")
                    if not schema_sha:
                        schema_p = resolved.with_name(f"{active_current_model.model_name}_feature_schema.json")
                        if schema_p.exists():
                            schema_sha = compute_file_sha256(schema_p)
                except Exception:
                    pass
            if not schema_sha and isinstance(schema, dict):
                schema_sha = schema.get("schema_sha256")
            prebuilt["schema_sha256"] = schema_sha

        curr_target = latest_curr if latest_curr is not None else {
            "student_id": s.student_id,
            "class_id": class_id,
            "subject_id": subject_id,
            "source_period_id": academic_period_id,
            "target_period_id": academic_period_id,
        }

        s_finalization = {
            "is_finalized": period_outcome["status"] == "FINALIZED",
            "status": period_outcome["status"],
            "message": "Academic period is officially finalized." if period_outcome["status"] == "FINALIZED" else None,
        }

        # Reuse Task 6B.2B evaluator directly with prebuilt evidence & models
        curr_status = evaluate_current_period_prediction_status(
            db,
            curr_target,
            staff_id=None,  # Roster-level teacher authorization already validated at entry
            prebuilt_evidence=prebuilt,
            preloaded_active_model=active_current_model,
            preloaded_latest_prediction=latest_curr,
            preloaded_finalization=s_finalization,
        )

        current_projection = {
            "purpose": "CURRENT_PERIOD_FINAL_GRADE_PROJECTION",
            "source_period_id": academic_period_id,
            "target_period_id": academic_period_id,
            "source_period_label": _period_label(period),
            "target_period_label": _period_label(period),
            "predicted_grade": _float(latest_curr.predicted_period_grade) if latest_curr else None,
            "risk_level": None,
            "risk_score": None,
            "data_status": None,
            "risk_assessment_status": "NOT_EVALUATED_FOR_CURRENT_PERIOD_MODEL",
            "evidence_readiness": curr_status["evidence_readiness"],
            "projection_freshness": curr_status["projection_freshness"],
            "model_currency": curr_status["model_currency"],
            "refresh_eligibility": curr_status["refresh_eligibility"],
            "domain_warnings": curr_status.get("domain_warnings", []),
            "latest_prediction_id": latest_curr.prediction_id if latest_curr else None,
            "model_version": _model_version_dict(latest_curr.model_version) if latest_curr else None,
            "revision": latest_curr.revision if latest_curr else None,
            "generated_at": latest_curr.generated_at if latest_curr else None,
        }

        # E. Primary Display Recommendation
        if latest_curr is not None:
            primary_display = "CURRENT_PROJECTION"
        elif latest_next is not None:
            primary_display = "BASELINE_FORECAST"
        else:
            primary_display = "NONE"

        student_items.append({
            "student": {
                "student_id": s.student_id,
                "student_name": _student_name(s),
                "student_lrn": s.student_lrn,
            },
            "period_outcome": period_outcome,
            "baseline_forecast": baseline_forecast,
            "current_projection": current_projection,
            "primary_display": primary_display,
        })

    class_context = {
        "class_id": class_id,
        "class_name": class_.section_name,
        "subject_id": subject_id,
        "subject_name": subject.subject_name,
        "academic_period_id": academic_period_id,
        "period_label": _period_label(period),
        "academic_year_id": period.academic_year_id,
        "next_period_status": next_period_status,
        "teacher": teacher_info,
    }

    return {
        "class_context": class_context,
        "students": student_items,
        "total": len(student_items),
    }


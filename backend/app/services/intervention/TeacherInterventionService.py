"""Current teacher review of frozen development Interventions."""

from __future__ import annotations

import math
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.Config import settings
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.StudentCLass import StudentClass
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.classwork.ClassworkShared import is_reading_type
from app.services.grading.PassingThresholdReader import require_subject_passing_threshold
from app.schemas.TeacherIntervention import (
    ResolutionReviewSummary,
    TeacherInterventionDetail,
    TeacherInterventionList,
    TeacherInterventionSummary,
    TeacherResolvedInterventionDetail,
)
from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
from app.services.academic.SubstitutionService import SubstitutionService
from app.services.intervention.InterventionCandidateService import (
    IMPROVED_PREDICTION,
    sync_intervention_for_persisted_prediction,
)
from app.services.intervention.InterventionDiagnosisService import effective_diagnosis_snapshot
from app.services.intervention.InterventionHistoryService import (
    capture_resolution_history_snapshot,
    practice_assessment_history,
    resolution_prediction,
    resolution_projection,
    sent_reviewer,
    targeted_activities,
)
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction.DevelopmentCurrentTermPredictionPersistenceService import generate_and_persist_development_current_term


def _eligible_scope(db: Session, staff_id: str, row: Intervention) -> bool:
    load = SubjectLoadAuthorizationService.get_active_published_load(
        db, row.class_id, row.subject_id, row.academic_period_id,
    )
    if load is None:
        return False
    substitution = SubstitutionService.get_active_substitution(db, load.subject_load_id)
    responsible = substitution.substitute_staff_id if substitution is not None else load.staff_id
    if staff_id != responsible:
        return False
    return db.query(StudentClass.student_class_id).filter_by(
        student_id=row.student_id, class_id=row.class_id, enrollment_status="enrolled",
    ).first() is not None


def _require_scope(db: Session, staff_id: str, row: Intervention) -> None:
    if not _eligible_scope(db, staff_id, row):
        raise HTTPException(status_code=403, detail="You do not have active teaching permissions for this intervention scope")


def _source(db: Session, row: Intervention) -> DevelopmentCurrentTermPrediction:
    source = db.get(DevelopmentCurrentTermPrediction, row.source_prediction_id)
    if source is None or (
        source.student_id, source.class_id, source.subject_id, source.source_period_id, source.target_period_id
    ) != (row.student_id, row.class_id, row.subject_id, row.academic_period_id, row.academic_period_id):
        raise HTTPException(status_code=409, detail="Intervention source prediction is unavailable or mismatched")
    return source


def _current_candidate_status(
    db: Session,
    row: Intervention,
    source: DevelopmentCurrentTermPrediction,
    passing_threshold: float | None,
) -> tuple[DevelopmentCurrentTermPrediction, float | None, bool | None, str | None]:
    if row.status == "RESOLVED":
        latest = resolution_prediction(db, row, source=source) or source
    else:
        latest = db.query(DevelopmentCurrentTermPrediction).filter_by(
            student_id=row.student_id,
            class_id=row.class_id,
            subject_id=row.subject_id,
            source_period_id=row.academic_period_id,
            target_period_id=row.academic_period_id,
            model_version_id=source.model_version_id,
        ).order_by(DevelopmentCurrentTermPrediction.revision.desc()).first() or source
    snapshot = latest.evidence_snapshot if isinstance(latest.evidence_snapshot, dict) else {}
    raw_grade = snapshot.get("projected_final_term_grade_raw")
    if raw_grade is None and row.status == "RESOLVED" and latest.predicted_period_grade is not None:
        raw_grade = float(latest.predicted_period_grade)
    try:
        current_grade = float(raw_grade) if not isinstance(raw_grade, bool) else math.nan
    except (TypeError, ValueError, OverflowError):
        current_grade = math.nan
    current_grade_value = current_grade if math.isfinite(current_grade) else None
    if row.status != "CANDIDATE":
        return latest, current_grade_value, None, None
    readiness = snapshot.get("readiness")
    if not isinstance(readiness, dict) or readiness.get("status") != "READY":
        return latest, current_grade_value, False, "CURRENT_PREDICTION_NOT_READY"
    if current_grade_value is None or not 0 <= current_grade_value <= 100:
        return latest, current_grade_value, False, "CURRENT_PREDICTION_GRADE_INVALID"
    if passing_threshold is None:
        return latest, current_grade_value, False, "PASSING_THRESHOLD_UNAVAILABLE"
    if current_grade_value >= passing_threshold:
        return latest, current_grade_value, False, "PASSING_THRESHOLD_REACHED"
    return latest, current_grade_value, True, None


def _unfinished_remediation_summary(db: Session, row: Intervention) -> tuple[int, bool]:
    if row.status != "ACTIVE":
        return 0, False
    assignments = db.query(ClassworkAssignment).filter_by(
        source_intervention_id=row.intervention_id,
        recipient_student_id=row.student_id,
        is_published=True,
    ).all()
    unfinished = 0
    has_in_progress = False
    for assignment in assignments:
        work = assignment.classwork
        if work is None or work.is_archived or not work.is_published or is_reading_type(work.classwork_type):
            continue
        submission = db.query(StudentSubmission).filter_by(
            classwork_assignment_id=assignment.classwork_assignment_id,
            student_id=row.student_id,
        ).order_by(StudentSubmission.submission_id.desc()).first()
        if submission is None:
            unfinished += 1
            continue
        norm_status = (submission.status or "").lower()
        if norm_status == "pending":
            unfinished += 1
            has_in_progress = True
        elif norm_status in {"submitted", "late"}:
            unfinished += 1
    return unfinished, has_in_progress


def _active_resolution_status(
    row: Intervention,
    latest: DevelopmentCurrentTermPrediction,
    current_grade: float | None,
    passing_threshold: float | None,
) -> dict:
    if row.status != "ACTIVE":
        return {
            "resolution_recommended": False,
            "resolution_recommendation_reason": None,
            "resolution_recommendation_detail": None,
            "resolution_attribution_code": None,
            "can_confirm_resolution": False,
            "resolution_continued_at": None,
            "resolution_continued_by_staff_id": None,
        }
    snapshot = latest.evidence_snapshot if isinstance(latest.evidence_snapshot, dict) else {}
    readiness = snapshot.get("readiness")
    is_ready = isinstance(readiness, dict) and readiness.get("status") == "READY"
    reaches_target = bool(
        is_ready
        and current_grade is not None
        and 0 <= current_grade <= 100
        and passing_threshold is not None
        and current_grade >= passing_threshold
    )
    plan = row.remediation_plan if isinstance(row.remediation_plan, dict) else {}
    review = plan.get("resolution_review") if isinstance(plan.get("resolution_review"), dict) else {}
    continued_at = None
    continued_by = None
    if review.get("decision") == "CONTINUE_SUPPORT":
        raw_dt = review.get("decided_at")
        if isinstance(raw_dt, str):
            try:
                continued_at = datetime.fromisoformat(raw_dt)
            except ValueError:
                continued_at = None
        continued_by = review.get("decided_by_staff_id")
    continued_for_latest = bool(
        review.get("decision") == "CONTINUE_SUPPORT"
        and review.get("continued_prediction_id") == latest.prediction_id
    )
    resolution_recommended = bool(reaches_target and not continued_for_latest)
    reason = (
        "TARGET_REACHED"
        if resolution_recommended
        else ("CONTINUED_BY_TEACHER" if reaches_target and continued_for_latest else None)
    )
    latest_attr = (
        review.get("latest_attribution")
        if isinstance(review.get("latest_attribution"), dict)
        and review.get("latest_attribution", {}).get("prediction_id") == latest.prediction_id
        else {}
    )
    return {
        "resolution_recommended": resolution_recommended,
        "resolution_recommendation_reason": reason,
        "resolution_recommendation_detail": (
            latest_attr.get("attribution_summary") if reaches_target else None
        ),
        "resolution_attribution_code": (
            latest_attr.get("attribution_code") if reaches_target else None
        ),
        "can_confirm_resolution": reaches_target,
        "resolution_continued_at": continued_at,
        "resolution_continued_by_staff_id": continued_by,
    }


def _summary(db: Session, row: Intervention) -> TeacherInterventionSummary:
    source = _source(db, row)
    diagnosis = effective_diagnosis_snapshot(db, row)
    grade = source.evidence_snapshot.get("projected_final_term_grade_raw") if isinstance(source.evidence_snapshot, dict) else None
    threshold_val = None
    try:
        period = row.academic_period or db.get(AcademicPeriod, row.academic_period_id)
        if period is not None:
            res = require_subject_passing_threshold(
                db,
                academic_year_id=period.academic_year_id,
                subject_id=row.subject_id,
                academic_period_id=row.academic_period_id,
            )
            threshold_val = float(res.threshold)
    except Exception:
        threshold_val = None
    academic_level = None
    if row.student and row.student.academic_level:
        academic_level = row.student.academic_level
    elif row.class_ and row.class_.academic_level:
        academic_level = row.class_.academic_level
    grade_level_val = academic_level.grade_level if academic_level else None
    level_name_val = academic_level.level_name if academic_level else (f"Grade {grade_level_val}" if grade_level_val is not None else None)
    latest, current_grade, activation_eligible, activation_reason = _current_candidate_status(
        db, row, source, threshold_val,
    )
    active_resolution = _active_resolution_status(row, latest, current_grade, threshold_val)
    unfinished_count, has_in_progress = _unfinished_remediation_summary(db, row)

    return TeacherInterventionSummary(
        grade_level=grade_level_val,
        level_name=level_name_val,
        intervention_id=row.intervention_id,
        student_id=row.student_id,
        student_name=" ".join(part for part in (row.student.first_name, row.student.middle_name, row.student.last_name, row.student.suffix) if part),
        student_lrn=row.student.student_lrn,
        class_id=row.class_id, class_name=row.class_.section_name,
        subject_id=row.subject_id, subject_name=row.subject.subject_name,
        academic_period_id=row.academic_period_id, academic_period_name=row.academic_period.period_name,
        status=row.status,
        source_prediction_id=source.prediction_id, source_prediction_revision=source.revision,
        triggering_predicted_grade=float(grade if grade is not None else source.predicted_period_grade),
        triggering_intervention_level=source.intervention_level,
        current_prediction_revision=latest.revision,
        current_predicted_grade=current_grade,
        current_intervention_level=latest.intervention_level,
        candidate_activation_eligible=activation_eligible,
        candidate_activation_reason=activation_reason,
        resolution_recommended=active_resolution["resolution_recommended"],
        resolution_recommendation_reason=active_resolution["resolution_recommendation_reason"],
        resolution_recommendation_detail=active_resolution["resolution_recommendation_detail"],
        resolution_attribution_code=active_resolution["resolution_attribution_code"],
        can_confirm_resolution=active_resolution["can_confirm_resolution"],
        resolution_continued_at=active_resolution["resolution_continued_at"],
        resolution_continued_by_staff_id=active_resolution["resolution_continued_by_staff_id"],
        unfinished_remediation_count=unfinished_count,
        has_in_progress_remediation=has_in_progress,
        created_at=row.created_at,
        activated_at=row.activated_at,
        resolved_at=row.resolved_at, resolution_reason=row.resolution_reason,
        diagnosis_summary={
            "snapshot_version": diagnosis.get("snapshot_version"),
            "weakest_supported_components": diagnosis.get("weakest_supported_components", []),
            "competency_detail_status": diagnosis.get("competency_detail_status"),
            "external_assessment_detail_status": diagnosis.get("external_assessment_detail_status"),
            "covered_competencies_for_teacher_review_count": len(diagnosis.get("covered_competencies_for_teacher_review") or []),
        },
        passing_threshold=threshold_val,
    )


def list_teacher_candidates(db: Session, staff_id: str, academic_period_id: int | None = None) -> TeacherInterventionList:
    query = db.query(Intervention).filter_by(status="CANDIDATE")
    if academic_period_id is not None:
        query = query.filter(Intervention.academic_period_id == academic_period_id)
    candidates = query.order_by(
        Intervention.created_at.desc(), Intervention.intervention_id.desc(),
    ).all()
    items = [_summary(db, row) for row in candidates if _eligible_scope(db, staff_id, row)]
    return TeacherInterventionList(items=items, total=len(items))


def list_teacher_active(db: Session, staff_id: str, academic_period_id: int | None = None) -> TeacherInterventionList:
    query = db.query(Intervention).filter_by(status="ACTIVE")
    if academic_period_id is not None:
        query = query.filter(Intervention.academic_period_id == academic_period_id)
    active = query.order_by(
        Intervention.activated_at.desc(), Intervention.intervention_id.desc(),
    ).all()
    items = [_summary(db, row) for row in active if _eligible_scope(db, staff_id, row)]
    return TeacherInterventionList(items=items, total=len(items))


def list_teacher_resolved(db: Session, staff_id: str, academic_period_id: int | None = None) -> TeacherInterventionList:
    query = db.query(Intervention).filter_by(status="RESOLVED")
    if academic_period_id is not None:
        query = query.filter(Intervention.academic_period_id == academic_period_id)
    rows = query.order_by(
        Intervention.resolved_at.desc(), Intervention.intervention_id.desc(),
    ).all()
    items = [_summary(db, row) for row in rows if _eligible_scope(db, staff_id, row)]
    return TeacherInterventionList(items=items, total=len(items))


def _detail(db: Session, row: Intervention) -> TeacherInterventionDetail:
    return TeacherInterventionDetail(
        **_summary(db, row).model_dump(),
        diagnosis_snapshot=effective_diagnosis_snapshot(db, row),
        activated_by_staff_id=row.activated_by_staff_id,
    )


def get_teacher_candidate(db: Session, staff_id: str, intervention_id: int) -> TeacherInterventionDetail:
    row = db.get(Intervention, intervention_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    _require_scope(db, staff_id, row)
    if row.status != "CANDIDATE":
        raise HTTPException(status_code=409, detail="Intervention is no longer a candidate")
    return _detail(db, row)


def get_teacher_active(db: Session, staff_id: str, intervention_id: int) -> TeacherInterventionDetail:
    row = db.get(Intervention, intervention_id)
    if row is None or row.status != "ACTIVE" or not _eligible_scope(db, staff_id, row):
        raise HTTPException(status_code=404, detail="Active intervention not found")
    return _detail(db, row)


def get_teacher_resolved(db: Session, staff_id: str, intervention_id: int) -> TeacherResolvedInterventionDetail:
    row = db.get(Intervention, intervention_id)
    if row is None or row.status != "RESOLVED" or not _eligible_scope(db, staff_id, row):
        raise HTTPException(status_code=404, detail="Resolved intervention not found")
    reviewer = sent_reviewer(db, row)
    plan = row.remediation_plan if isinstance(row.remediation_plan, dict) else {}
    raw_review = plan.get("resolution_review") if isinstance(plan.get("resolution_review"), dict) else None
    review_summary = None
    if raw_review:
        review_summary = ResolutionReviewSummary(
            decision=raw_review.get("decision"),
            resolution_mode=raw_review.get("resolution_mode"),
            attribution_code=raw_review.get("attribution_code"),
            attribution_summary=raw_review.get("attribution_summary"),
            decided_by_staff_id=raw_review.get("decided_by_staff_id"),
            decided_at=raw_review.get("decided_at"),
            prediction_id=raw_review.get("prediction_id"),
            prediction_revision=raw_review.get("prediction_revision"),
            predicted_grade=raw_review.get("predicted_grade"),
            previous_predicted_grade=raw_review.get("previous_predicted_grade"),
            passing_threshold=raw_review.get("passing_threshold"),
        )
    return TeacherResolvedInterventionDetail(
        **_detail(db, row).model_dump(),
        resolution_projection=resolution_projection(db, row),
        targeted_activities=targeted_activities(db, row, student_view=False),
        practice_assessment=practice_assessment_history(db, row),
        resolution_review=review_summary,
        sent_reviewer=reviewer.current_content if reviewer else None,
    )


def activate_teacher_candidate(db: Session, staff_id: str, intervention_id: int) -> TeacherInterventionDetail:
    if (
        settings.app_environment.lower() not in {"development", "test"}
        or not settings.development_prediction_api_enabled
        or settings.development_current_term_model_name != CORRECTED_MODEL_NAME
    ):
        raise HTTPException(status_code=404, detail="Not found")
    candidate = db.get(Intervention, intervention_id)
    if candidate is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    _require_scope(db, staff_id, candidate)
    if candidate.status != "CANDIDATE":
        raise HTTPException(status_code=409, detail="Intervention is no longer a candidate")
    source = _source(db, candidate)
    scope = (candidate.student_id, candidate.class_id, candidate.subject_id, candidate.academic_period_id)
    model_version_id = source.model_version_id
    version = db.get(AIModelVersion, model_version_id)
    if version is None or version.model_name != CORRECTED_MODEL_NAME:
        raise HTTPException(status_code=409, detail="Candidate source is not the corrected development model")
    outcome: dict[str, str] = {}

    def approve_if_current(transaction: Session, result: dict) -> None:
        outcome.clear()
        row = transaction.query(Intervention).filter_by(intervention_id=intervention_id).with_for_update().one_or_none()
        if row is None:
            outcome["error"] = "Intervention no longer exists"
            return
        if not _eligible_scope(transaction, staff_id, row):
            outcome["error"] = "Teacher no longer handles this intervention scope"
            return
        if row.status != "CANDIDATE":
            outcome["error"] = "Intervention is no longer a candidate"
            return
        versions = transaction.query(AIModelVersion).filter(
            AIModelVersion.model_name == CORRECTED_MODEL_NAME,
            AIModelVersion.model_purpose == ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value,
            AIModelVersion.lifecycle_status == "DEVELOPMENT",
            AIModelVersion.is_active.is_(False),
        ).all()
        if len(versions) != 1 or versions[0].model_version_id != model_version_id:
            outcome["error"] = "Current corrected model differs from the candidate source"
            return
        if result.get("readiness_status") != "READY" or result.get("prediction_status") != "DEVELOPMENT_PREDICTION_AVAILABLE":
            outcome["error"] = "Current prediction evidence is not READY"
            return
        latest = transaction.query(DevelopmentCurrentTermPrediction).filter_by(
            student_id=scope[0], class_id=scope[1], subject_id=scope[2],
            source_period_id=scope[3], target_period_id=scope[3], model_version_id=model_version_id,
        ).order_by(DevelopmentCurrentTermPrediction.revision.desc()).first()
        if latest is None or latest.prediction_id != result.get("prediction_id") or (
            not isinstance(latest.evidence_snapshot, dict)
            or latest.evidence_snapshot.get("readiness", {}).get("status") != "READY"
        ):
            outcome["error"] = "Current corrected prediction is unavailable"
            return
        raw_grade = latest.evidence_snapshot.get("projected_final_term_grade_raw")
        try:
            grade = float(raw_grade) if not isinstance(raw_grade, bool) else math.nan
        except (TypeError, ValueError, OverflowError):
            grade = math.nan
        if not math.isfinite(grade) or not 0 <= grade <= 100:
            outcome["error"] = "Current corrected prediction grade is invalid"
            return
        period = transaction.get(AcademicPeriod, scope[3])
        threshold_resolution = require_subject_passing_threshold(
            transaction,
            academic_year_id=period.academic_year_id if period else None,
            subject_id=scope[2],
            academic_period_id=scope[3],
        )
        passing_threshold = float(threshold_resolution.threshold)
        if grade >= passing_threshold:
            sync_intervention_for_persisted_prediction(
                transaction, latest, student_id=scope[0], class_id=scope[1],
                subject_id=scope[2], academic_period_id=scope[3],
            )
            outcome["error"] = f"Current prediction improved to at least {passing_threshold:g}"
            return
        row.status = "ACTIVE"
        row.activated_at = datetime.now(timezone.utc)
        row.activated_by_staff_id = staff_id
        transaction.flush()
        from app.services.intervention.StudySupportReminderService import (
            stage_intervention_study_support_available,
        )
        stage_intervention_study_support_available(transaction, row)

    try:
        generate_and_persist_development_current_term(
            *scope, model_version_id=model_version_id, bind=db.get_bind(), after_result=approve_if_current,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if "error" in outcome:
        raise HTTPException(status_code=409, detail=outcome["error"])
    db.expire_all()
    active = db.get(Intervention, intervention_id)
    if active is None or active.status != "ACTIVE":
        raise HTTPException(status_code=409, detail="Intervention activation did not complete")
    return _detail(db, active)


def _require_active_resolution_scope(db: Session, staff_id: str, intervention_id: int):
    if (
        settings.app_environment.lower() not in {"development", "test"}
        or not settings.development_prediction_api_enabled
        or settings.development_current_term_model_name != CORRECTED_MODEL_NAME
    ):
        raise HTTPException(status_code=404, detail="Not found")
    active = db.get(Intervention, intervention_id)
    if active is None:
        raise HTTPException(status_code=404, detail="Active intervention not found")
    _require_scope(db, staff_id, active)
    if active.status != "ACTIVE":
        raise HTTPException(status_code=409, detail="Intervention is no longer active")
    source = _source(db, active)
    model_version_id = source.model_version_id
    version = db.get(AIModelVersion, model_version_id)
    if version is None or version.model_name != CORRECTED_MODEL_NAME:
        raise HTTPException(status_code=409, detail="Intervention source is not the corrected development model")
    scope = (active.student_id, active.class_id, active.subject_id, active.academic_period_id)
    return active, source, scope, model_version_id


def _validate_revalidated_active_prediction(
    transaction: Session,
    *,
    staff_id: str,
    intervention_id: int,
    scope: tuple,
    model_version_id: int,
    result: dict,
):
    row = transaction.query(Intervention).filter_by(intervention_id=intervention_id).with_for_update().one_or_none()
    if row is None:
        return None, None, None, None, "Intervention no longer exists"
    if not _eligible_scope(transaction, staff_id, row):
        return None, None, None, None, "Teacher no longer handles this intervention scope"
    if row.status != "ACTIVE":
        return None, None, None, None, "Intervention is no longer active"
    versions = transaction.query(AIModelVersion).filter(
        AIModelVersion.model_name == CORRECTED_MODEL_NAME,
        AIModelVersion.model_purpose == ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value,
        AIModelVersion.lifecycle_status == "DEVELOPMENT",
        AIModelVersion.is_active.is_(False),
    ).all()
    if len(versions) != 1 or versions[0].model_version_id != model_version_id:
        return None, None, None, None, "Current corrected model differs from the intervention source"
    if result.get("readiness_status") != "READY" or result.get("prediction_status") != "DEVELOPMENT_PREDICTION_AVAILABLE":
        return None, None, None, None, "Current prediction evidence is not READY"
    latest = transaction.query(DevelopmentCurrentTermPrediction).filter_by(
        student_id=scope[0], class_id=scope[1], subject_id=scope[2],
        source_period_id=scope[3], target_period_id=scope[3], model_version_id=model_version_id,
    ).order_by(DevelopmentCurrentTermPrediction.revision.desc()).first()
    if latest is None or latest.prediction_id != result.get("prediction_id") or (
        not isinstance(latest.evidence_snapshot, dict)
        or latest.evidence_snapshot.get("readiness", {}).get("status") != "READY"
    ):
        return None, None, None, None, "Current corrected prediction is unavailable"
    raw_grade = latest.evidence_snapshot.get("projected_final_term_grade_raw")
    try:
        grade = float(raw_grade) if not isinstance(raw_grade, bool) else math.nan
    except (TypeError, ValueError, OverflowError):
        grade = math.nan
    if not math.isfinite(grade) or not 0 <= grade <= 100:
        return None, None, None, None, "Current corrected prediction grade is invalid"
    period = transaction.get(AcademicPeriod, scope[3])
    threshold_resolution = require_subject_passing_threshold(
        transaction,
        academic_year_id=period.academic_year_id if period else None,
        subject_id=scope[2],
        academic_period_id=scope[3],
    )
    passing_threshold = float(threshold_resolution.threshold)
    return row, latest, grade, passing_threshold, None


def continue_teacher_active_intervention(
    db: Session,
    staff_id: str,
    intervention_id: int,
) -> TeacherInterventionDetail:
    """Revalidate latest prediction and record teacher decision to continue ACTIVE support."""
    _active, _source_pred, scope, model_version_id = _require_active_resolution_scope(
        db, staff_id, intervention_id,
    )
    outcome: dict[str, str] = {}

    def record_continue(transaction: Session, result: dict) -> None:
        outcome.clear()
        row, latest, grade, _threshold, error = _validate_revalidated_active_prediction(
            transaction,
            staff_id=staff_id,
            intervention_id=intervention_id,
            scope=scope,
            model_version_id=model_version_id,
            result=result,
        )
        if error or row is None or latest is None or grade is None:
            outcome["error"] = error or "Unable to continue support"
            return
        now = datetime.now(timezone.utc)
        plan = dict(row.remediation_plan or {})
        existing_review = dict(plan.get("resolution_review")) if isinstance(plan.get("resolution_review"), dict) else {}
        existing_review.update({
            "decision": "CONTINUE_SUPPORT",
            "decided_by_staff_id": staff_id,
            "decided_at": now.isoformat(),
            "continued_prediction_id": latest.prediction_id,
            "continued_prediction_revision": latest.revision,
            "predicted_grade": grade,
        })
        plan["resolution_review"] = existing_review
        row.remediation_plan = plan
        transaction.flush()

    try:
        generate_and_persist_development_current_term(
            *scope,
            model_version_id=model_version_id,
            bind=db.get_bind(),
            after_result=record_continue,
            allow_active_auto_resolve=False,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if "error" in outcome:
        raise HTTPException(status_code=409, detail=outcome["error"])
    db.expire_all()
    active = db.get(Intervention, intervention_id)
    if active is None or active.status != "ACTIVE":
        raise HTTPException(status_code=409, detail="Intervention is no longer active")
    return _detail(db, active)


def resolve_teacher_active_intervention(
    db: Session,
    staff_id: str,
    intervention_id: int,
) -> TeacherResolvedInterventionDetail:
    """Revalidate latest prediction and confirm ACTIVE -> RESOLVED when target is met."""
    _active, _source_pred, scope, model_version_id = _require_active_resolution_scope(
        db, staff_id, intervention_id,
    )
    outcome: dict[str, str] = {}

    def confirm_resolution(transaction: Session, result: dict) -> None:
        outcome.clear()
        row, latest, grade, passing_threshold, error = _validate_revalidated_active_prediction(
            transaction,
            staff_id=staff_id,
            intervention_id=intervention_id,
            scope=scope,
            model_version_id=model_version_id,
            result=result,
        )
        if error or row is None or latest is None or grade is None or passing_threshold is None:
            outcome["error"] = error or "Unable to resolve intervention"
            return
        if grade < passing_threshold:
            outcome["error"] = (
                f"Current prediction ({grade:.2f}) is below the passing threshold ({passing_threshold:g})"
            )
            return
        now = datetime.now(timezone.utc)
        plan = dict(row.remediation_plan or {})
        existing_review = plan.get("resolution_review") if isinstance(plan.get("resolution_review"), dict) else {}
        latest_attr = (
            existing_review.get("latest_attribution")
            if isinstance(existing_review.get("latest_attribution"), dict)
            and existing_review.get("latest_attribution", {}).get("prediction_id") == latest.prediction_id
            else {}
        )
        plan["resolution_review"] = {
            "decision": "RESOLVED",
            "resolution_mode": "TEACHER_CONFIRMED",
            "decided_by_staff_id": staff_id,
            "decided_at": now.isoformat(),
            "prediction_id": latest.prediction_id,
            "prediction_revision": latest.revision,
            "predicted_grade": grade,
            "passing_threshold": passing_threshold,
            "attribution_code": latest_attr.get("attribution_code"),
            "attribution_summary": latest_attr.get("attribution_summary"),
            "previous_prediction_id": latest_attr.get("previous_prediction_id"),
            "previous_prediction_revision": latest_attr.get("previous_prediction_revision"),
            "previous_predicted_grade": latest_attr.get("previous_predicted_grade"),
        }
        plan["resolution_history_snapshot"] = capture_resolution_history_snapshot(
            transaction,
            row,
            prediction=latest,
            predicted_grade=grade,
        )
        row.remediation_plan = plan
        row.status = "RESOLVED"
        row.resolution_reason = IMPROVED_PREDICTION
        row.resolved_at = now
        transaction.flush()

    try:
        generate_and_persist_development_current_term(
            *scope,
            model_version_id=model_version_id,
            bind=db.get_bind(),
            after_result=confirm_resolution,
            allow_active_auto_resolve=False,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if "error" in outcome:
        raise HTTPException(status_code=409, detail=outcome["error"])
    db.expire_all()
    resolved = db.get(Intervention, intervention_id)
    if resolved is None or resolved.status != "RESOLVED":
        raise HTTPException(status_code=409, detail="Intervention resolution did not complete")
    return get_teacher_resolved(db, staff_id, intervention_id)

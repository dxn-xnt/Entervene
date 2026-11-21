"""Read existing resolution evidence and targeted work without changing history."""

from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionSupportMaterial import InterventionSupportMaterial
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.grading.PassingThresholdReader import require_subject_passing_threshold
from app.services.grading.RemedialExamination import effective_exam_score_for_change


def resolution_prediction(
    db: Session,
    row: Intervention,
    source: DevelopmentCurrentTermPrediction | None = None,
) -> DevelopmentCurrentTermPrediction | None:
    if row.status != "RESOLVED" or row.resolved_at is None:
        return None
    resolved_source = (
        source
        or row.source_prediction
        or db.get(DevelopmentCurrentTermPrediction, row.source_prediction_id)
    )
    if resolved_source is None:
        return None
    query = db.query(DevelopmentCurrentTermPrediction).filter_by(
        student_id=row.student_id, class_id=row.class_id, subject_id=row.subject_id,
        source_period_id=row.academic_period_id, target_period_id=row.academic_period_id,
        model_version_id=resolved_source.model_version_id,
    ).filter(
        DevelopmentCurrentTermPrediction.revision >= resolved_source.revision,
        DevelopmentCurrentTermPrediction.generated_at <= row.resolved_at,
    )
    next_cycle_revision = (
        db.query(DevelopmentCurrentTermPrediction.revision)
        .join(
            Intervention,
            Intervention.source_prediction_id == DevelopmentCurrentTermPrediction.prediction_id,
        )
        .filter(
            Intervention.student_id == row.student_id,
            Intervention.class_id == row.class_id,
            Intervention.subject_id == row.subject_id,
            Intervention.academic_period_id == row.academic_period_id,
            Intervention.intervention_id != row.intervention_id,
            DevelopmentCurrentTermPrediction.model_version_id == resolved_source.model_version_id,
            DevelopmentCurrentTermPrediction.revision > resolved_source.revision,
        )
        .order_by(DevelopmentCurrentTermPrediction.revision.asc())
        .limit(1)
        .scalar()
    )
    if next_cycle_revision is not None:
        query = query.filter(DevelopmentCurrentTermPrediction.revision < next_cycle_revision)
    return query.order_by(DevelopmentCurrentTermPrediction.revision.desc()).first()


def resolution_projection(db: Session, row: Intervention) -> float | None:
    prediction = resolution_prediction(db, row)
    if prediction is None or not isinstance(prediction.evidence_snapshot, dict):
        return None
    readiness = prediction.evidence_snapshot.get("readiness")
    value = prediction.evidence_snapshot.get("projected_final_term_grade_raw")
    if not isinstance(readiness, dict) or readiness.get("status") != "READY" or not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    if row.resolution_reason == "IMPROVED_PREDICTION":
        threshold_val = 85.0
        try:
            period = db.get(AcademicPeriod, row.academic_period_id)
            if period:
                res = require_subject_passing_threshold(
                    db,
                    academic_year_id=period.academic_year_id,
                    subject_id=row.subject_id,
                )
                threshold_val = float(res.threshold)
        except Exception:
            pass
        if float(value) < threshold_val:
            return None
    return float(value)


def targeted_activities(db: Session, row: Intervention, *, student_view: bool) -> list[dict]:
    assignments = db.query(ClassworkAssignment).filter_by(
        source_intervention_id=row.intervention_id, recipient_student_id=row.student_id,
    ).order_by(ClassworkAssignment.classwork_assignment_id).all()
    result = []
    for assignment in assignments:
        submission = db.query(StudentSubmission).filter_by(
            classwork_assignment_id=assignment.classwork_assignment_id, student_id=row.student_id,
        ).order_by(StudentSubmission.submission_id.desc()).first()
        work = assignment.classwork
        if not submission and (not assignment.is_published or not work.is_published or work.is_archived):
            continue
        visible_score = not student_view or work.show_scores
        original_assignment_id = assignment.original_exam_assignment_id
        original = db.get(ClassworkAssignment, original_assignment_id) if original_assignment_id else None
        original_submission = db.query(StudentSubmission).filter_by(
            classwork_assignment_id=original.classwork_assignment_id, student_id=row.student_id,
        ).order_by(StudentSubmission.submission_id.desc()).first() if original else None
        original_grade = (
            float(original_submission.grade)
            if original_submission and original_submission.grade is not None and visible_score
            else None
        )
        rem_grade = float(submission.grade) if submission and submission.grade is not None else None
        effective_grade = (
            effective_exam_score_for_change(db, assignment, row.student_id, rem_grade)
            if original and visible_score
            else None
        )
        exam_subtype = work.exam_subtype if original else None
        if original_assignment_id is None:
            from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
            link = db.query(RemediationAssignmentLink).filter_by(
                remediation_assignment_id=assignment.classwork_assignment_id,
            ).first()
            if link is not None:
                original_assignment_id = link.original_assignment_id
                original = db.get(ClassworkAssignment, link.original_assignment_id)
                original_submission = db.query(StudentSubmission).filter_by(
                    classwork_assignment_id=link.original_assignment_id, student_id=row.student_id,
                ).order_by(StudentSubmission.submission_id.desc()).first() if original else None
                raw_orig = (
                    float(original_submission.grade)
                    if original_submission and original_submission.grade is not None
                    else None
                )
                original_grade = raw_orig if visible_score else None
                if visible_score and raw_orig is not None:
                    if rem_grade is not None and original and original.classwork and original.classwork.total_points:
                        from app.services.grading.RemediationScoreAdjuster import adjust_remediation_score
                        adj = adjust_remediation_score(
                            original_score=raw_orig,
                            remediation_score=rem_grade,
                            max_points=float(original.classwork.total_points),
                            cap_percentage=link.score_adjustment_cap,
                        )
                        effective_grade = float(adj.effective_score)
                    else:
                        effective_grade = raw_orig
        result.append({
            "assignment_id": assignment.classwork_assignment_id,
            "title": work.title,
            "classwork_type": work.classwork_type,
            "submission_status": submission.status if submission else None,
            "grade": float(submission.grade) if submission and submission.grade is not None and visible_score else None,
            "total_points": float(work.total_points) if work.total_points is not None and visible_score else None,
            "original_assignment_id": original_assignment_id,
            "original_title": original.classwork.title if original and original.classwork else None,
            "exam_subtype": exam_subtype,
            "original_grade": original_grade,
            "effective_grade": effective_grade,
        })
    return result


def sent_reviewer(db: Session, row: Intervention) -> InterventionSupportMaterial | None:
    return db.query(InterventionSupportMaterial).filter_by(
        intervention_id=row.intervention_id, kind="STUDENT_REVIEWER", status="SENT",
    ).filter(InterventionSupportMaterial.sent_at.is_not(None)).one_or_none()

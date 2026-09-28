"""Read existing resolution evidence and targeted work without changing history."""

from sqlalchemy.orm import Session

from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionSupportMaterial import InterventionSupportMaterial
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.grading.RemedialExamination import effective_exam_score_for_change


def resolution_projection(db: Session, row: Intervention) -> float | None:
    if row.status != "RESOLVED" or row.resolved_at is None:
        return None
    source = row.source_prediction
    prediction = db.query(DevelopmentCurrentTermPrediction).filter_by(
        student_id=row.student_id, class_id=row.class_id, subject_id=row.subject_id,
        source_period_id=row.academic_period_id, target_period_id=row.academic_period_id,
        model_version_id=source.model_version_id,
    ).filter(
        DevelopmentCurrentTermPrediction.generated_at <= row.resolved_at,
    ).order_by(DevelopmentCurrentTermPrediction.revision.desc()).first()
    if prediction is None or not isinstance(prediction.evidence_snapshot, dict):
        return None
    readiness = prediction.evidence_snapshot.get("readiness")
    value = prediction.evidence_snapshot.get("projected_final_term_grade_raw")
    if not isinstance(readiness, dict) or readiness.get("status") != "READY" or not isinstance(value, (int, float)) or isinstance(value, bool):
        return None
    if row.resolution_reason == "IMPROVED_PREDICTION" and float(value) < 85:
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
        original = db.get(ClassworkAssignment, assignment.original_exam_assignment_id) if assignment.original_exam_assignment_id else None
        original_submission = db.query(StudentSubmission).filter_by(
            classwork_assignment_id=original.classwork_assignment_id, student_id=row.student_id,
        ).order_by(StudentSubmission.submission_id.desc()).first() if original else None
        result.append({
            "assignment_id": assignment.classwork_assignment_id,
            "title": work.title,
            "classwork_type": work.classwork_type,
            "submission_status": submission.status if submission else None,
            "grade": float(submission.grade) if submission and submission.grade is not None and visible_score else None,
            "total_points": float(work.total_points) if work.total_points is not None and visible_score else None,
            "original_assignment_id": assignment.original_exam_assignment_id,
            "original_title": original.classwork.title if original else None,
            "exam_subtype": work.exam_subtype if original else None,
            "original_grade": float(original_submission.grade) if original_submission and original_submission.grade is not None and visible_score else None,
            "effective_grade": effective_exam_score_for_change(db, assignment, row.student_id,
                float(submission.grade) if submission and submission.grade is not None else None) if original and visible_score else None,
        })
    return result


def sent_reviewer(db: Session, row: Intervention) -> InterventionSupportMaterial | None:
    return db.query(InterventionSupportMaterial).filter_by(
        intervention_id=row.intervention_id, kind="STUDENT_REVIEWER", status="SENT",
    ).filter(InterventionSupportMaterial.sent_at.is_not(None)).one_or_none()

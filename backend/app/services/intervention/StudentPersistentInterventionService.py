"""Student-safe reads of the persistent Intervention, scoped to its exact student."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionSupportMaterial import InterventionSupportMaterial
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.InterventionHistoryService import sent_reviewer, targeted_activities
from app.schemas.StudentPersistentIntervention import (
    StudentPersistentIntervention, StudentPersistentInterventionList, StudentSupportActivity,
)


def _summary(db: Session, row: Intervention, student_id) -> StudentPersistentIntervention:
    if row.status == "RESOLVED":
        reviewer = sent_reviewer(db, row)
        return StudentPersistentIntervention(
            intervention_id=row.intervention_id, status=row.status,
            subject_id=row.subject_id, subject_name=row.subject.subject_name,
            class_id=row.class_id, class_name=row.class_.section_name,
            teacher_name=f"{row.activated_by.first_name} {row.activated_by.last_name}" if row.activated_by else None,
            activities=[StudentSupportActivity(**item) for item in targeted_activities(db, row, student_view=True)],
            reviewer_id=reviewer.material_id if reviewer else None,
            resolved_at=row.resolved_at,
            resolution_message=("Your progress reached the goal for this support."
                                if row.resolution_reason == "IMPROVED_PREDICTION" else "This support has ended."),
        )
    assignments = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.source_intervention_id == row.intervention_id,
        ClassworkAssignment.recipient_student_id == student_id,
        ClassworkAssignment.is_published.is_(True),
    ).order_by(ClassworkAssignment.classwork_assignment_id).all()
    activities = []
    for assignment in assignments:
        work = assignment.classwork
        if not work.is_published or work.is_archived:
            continue
        submission = db.query(StudentSubmission).filter(
            StudentSubmission.classwork_assignment_id == assignment.classwork_assignment_id,
            StudentSubmission.student_id == student_id,
        ).order_by(StudentSubmission.submission_id.desc()).first()
        activities.append(StudentSupportActivity(
            assignment_id=assignment.classwork_assignment_id,
            title=work.title, classwork_type=work.classwork_type,
            submission_status=submission.status if submission else None,
            grade=float(submission.grade) if submission and submission.grade is not None and work.show_scores else None,
            total_points=float(work.total_points) if work.total_points is not None and work.show_scores else None,
        ))
    reviewer = db.query(InterventionSupportMaterial.material_id).filter(
        InterventionSupportMaterial.intervention_id == row.intervention_id,
        InterventionSupportMaterial.kind == "STUDENT_REVIEWER",
        InterventionSupportMaterial.status == "SENT",
        InterventionSupportMaterial.sent_at.is_not(None),
    ).first()
    teacher = row.activated_by
    return StudentPersistentIntervention(
        intervention_id=row.intervention_id, status=row.status,
        subject_id=row.subject_id, subject_name=row.subject.subject_name,
        class_id=row.class_id, class_name=row.class_.section_name,
        teacher_name=f"{teacher.first_name} {teacher.last_name}" if teacher else None,
        activities=activities, reviewer_id=reviewer[0] if reviewer else None,
    )


def list_active(db: Session, student_id) -> StudentPersistentInterventionList:
    rows = db.query(Intervention).filter(
        Intervention.student_id == student_id, Intervention.status == "ACTIVE",
    ).order_by(Intervention.activated_at.desc()).all()
    return StudentPersistentInterventionList(items=[_summary(db, row, student_id) for row in rows])


def get_active(db: Session, student_id, intervention_id: int) -> StudentPersistentIntervention:
    row = db.query(Intervention).filter(
        Intervention.intervention_id == intervention_id,
        Intervention.student_id == student_id,
        Intervention.status == "ACTIVE",
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    return _summary(db, row, student_id)


def list_resolved(db: Session, student_id) -> StudentPersistentInterventionList:
    rows = db.query(Intervention).filter(
        Intervention.student_id == student_id, Intervention.status == "RESOLVED",
    ).order_by(Intervention.resolved_at.desc(), Intervention.intervention_id.desc()).all()
    return StudentPersistentInterventionList(items=[_summary(db, row, student_id) for row in rows])


def get_resolved(db: Session, student_id, intervention_id: int) -> StudentPersistentIntervention:
    row = db.query(Intervention).filter(
        Intervention.intervention_id == intervention_id,
        Intervention.student_id == student_id,
        Intervention.status == "RESOLVED",
    ).one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Intervention not found")
    return _summary(db, row, student_id)

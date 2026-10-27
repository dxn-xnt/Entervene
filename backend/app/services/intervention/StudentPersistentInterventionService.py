"""Student-safe reads of the persistent Intervention, scoped to its exact student."""

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.models.intervention.InterventionSupportMaterial import InterventionSupportMaterial
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.classwork.ClassworkShared import assignment_is_locked
from app.services.intervention.InterventionHistoryService import sent_reviewer, targeted_activities
from app.schemas.StudentPersistentIntervention import (
    StudentPersistentIntervention, StudentPersistentInterventionList,
    StudentPreparationProgress, StudentRequiredReading,
    StudentRequiredReadingIssue, StudentSupportActivity,
)


COMPLETED_READING_STATUSES = {"submitted", "late", "graded"}


def _inactive_preparation() -> StudentPreparationProgress:
    return StudentPreparationProgress(
        state="NOT_APPLICABLE", is_satisfied=False, completed_count=0,
        required_count=0, accessible_count=0, unavailable_count=0,
        summary="Preparation progress is available for active support only.",
    )


def resolve_required_readings(
    db: Session,
    row: Intervention,
    student_id,
) -> tuple[list[StudentRequiredReading], list[StudentRequiredReadingIssue], StudentPreparationProgress]:
    plan = row.remediation_plan if isinstance(row.remediation_plan, dict) else {}
    selected = plan.get("selected_resources")
    selected = selected if isinstance(selected, list) else []
    readings: list[StudentRequiredReading] = []
    issues: list[StudentRequiredReadingIssue] = []

    enrolled = db.query(StudentClass.student_class_id).filter_by(
        student_id=student_id,
        class_id=row.class_id,
        enrollment_status="enrolled",
    ).first() is not None

    reviews = db.query(InterventionReadingReview).filter_by(
        intervention_id=row.intervention_id,
        student_id=student_id,
    ).all()
    reviews_by_assignment = {
        r.reading_assignment_id: r.acknowledged_at for r in reviews
    }

    for order, resource in enumerate(selected, start=1):
        resource_id = resource.get("id") if isinstance(resource, dict) else None
        kind = resource.get("kind") if isinstance(resource, dict) else None
        if kind != "CLASSWORK" or not isinstance(resource_id, int) or resource_id <= 0:
            issues.append(StudentRequiredReadingIssue(
                resource_id=resource_id if isinstance(resource_id, int) else None,
                order=order,
                reason="INVALID_RESOURCE",
            ))
            continue

        work = db.get(Classwork, resource_id)
        if work is None:
            issues.append(StudentRequiredReadingIssue(
                resource_id=resource_id, order=order, reason="MISSING_RESOURCE",
            ))
            continue
        if (
            (work.classwork_type or "").upper() != "READING"
            or work.is_graded
        ):
            issues.append(StudentRequiredReadingIssue(
                resource_id=resource_id, order=order, reason="NOT_REQUIRED_READING",
            ))
            continue
        if work.is_archived or work.subject_id != row.subject_id or not enrolled:
            issues.append(StudentRequiredReadingIssue(
                resource_id=resource_id, order=order, reason="INACCESSIBLE",
            ))
            continue

        scope_assignments = db.query(ClassworkAssignment).filter(
            ClassworkAssignment.classwork_id == work.classwork_id,
            ClassworkAssignment.class_id == row.class_id,
            ClassworkAssignment.academic_period_id == row.academic_period_id,
        ).order_by(ClassworkAssignment.classwork_assignment_id).all()
        if not scope_assignments:
            issues.append(StudentRequiredReadingIssue(
                resource_id=resource_id, order=order, reason="PLANNING_ONLY",
            ))
            continue

        assignment = next((item for item in scope_assignments if (
            item.recipient_student_id is None or item.recipient_student_id == student_id
        )), None)
        if assignment is None:
            issues.append(StudentRequiredReadingIssue(
                resource_id=resource_id, order=order, reason="INACCESSIBLE",
            ))
            continue
        if not work.is_published or not assignment.is_published:
            issues.append(StudentRequiredReadingIssue(
                resource_id=resource_id, order=order, reason="UNPUBLISHED",
            ))
            continue
        if assignment_is_locked(assignment):
            issues.append(StudentRequiredReadingIssue(
                resource_id=resource_id, order=order, reason="LOCKED",
            ))
            continue

        submission = db.query(StudentSubmission).filter(
            StudentSubmission.classwork_assignment_id == assignment.classwork_assignment_id,
            StudentSubmission.student_id == student_id,
        ).order_by(StudentSubmission.submission_id.desc()).first()
        persisted_status = (submission.status or "").lower() if submission else ""
        focused_seconds = max(0, submission.reading_focused_seconds or 0) if submission else 0
        if persisted_status in COMPLETED_READING_STATUSES:
            completion_status = "COMPLETED"
        elif submission is not None:
            completion_status = "IN_PROGRESS"
        else:
            completion_status = "NOT_STARTED"
        reviewed_at = reviews_by_assignment.get(assignment.classwork_assignment_id)
        review_status = "REVIEWED" if reviewed_at is not None else "NOT_REVIEWED"
        readings.append(StudentRequiredReading(
            classwork_id=work.classwork_id,
            title=work.title,
            assignment_id=assignment.classwork_assignment_id,
            order=order,
            completion_status=completion_status,
            focused_seconds=focused_seconds,
            completed_at=submission.submitted_at if completion_status == "COMPLETED" else None,
            review_status=review_status,
            reviewed_at=reviewed_at,
        ))

    required_count = len(selected)
    completed_count = sum(item.review_status == "REVIEWED" for item in readings)
    accessible_count = len(readings)
    unavailable_count = max(0, required_count - accessible_count)
    if required_count == 0:
        state = "NOT_CONFIGURED"
    elif not readings or issues:
        state = "BLOCKED"
    elif completed_count == required_count:
        state = "COMPLETE"
    elif completed_count > 0:
        state = "IN_PROGRESS"
    else:
        state = "NOT_STARTED"
    preparation = StudentPreparationProgress(
        state=state,
        is_satisfied=state == "COMPLETE",
        completed_count=completed_count,
        required_count=required_count,
        accessible_count=accessible_count,
        unavailable_count=unavailable_count,
        summary=f"{completed_count} of {required_count} completed",
    )
    return readings, issues, preparation


def _summary(db: Session, row: Intervention, student_id) -> StudentPersistentIntervention:
    if row.status == "RESOLVED":
        reviewer = sent_reviewer(db, row)
        return StudentPersistentIntervention(
            intervention_id=row.intervention_id, status=row.status,
            subject_id=row.subject_id, subject_name=row.subject.subject_name,
            class_id=row.class_id, class_name=row.class_.section_name,
            teacher_name=f"{row.activated_by.first_name} {row.activated_by.last_name}" if row.activated_by else None,
            required_readings=[], resource_issues=[], preparation=_inactive_preparation(),
            activities=[StudentSupportActivity(
                **item, access_state="HISTORICAL", access_enforced=False,
                prerequisite_code="INTERVENTION_RESOLVED",
                prerequisite_message="This support has ended.",
            ) for item in targeted_activities(db, row, student_view=True)],
            reviewer_id=reviewer.material_id if reviewer else None,
            activated_at=row.activated_at,
            resolved_at=row.resolved_at,
            resolution_message=("Your progress reached the goal for this support."
                                if row.resolution_reason == "IMPROVED_PREDICTION" else "This support has ended."),
        )
    required_readings, resource_issues, preparation = resolve_required_readings(db, row, student_id)
    assignments = db.query(ClassworkAssignment).filter(
        ClassworkAssignment.source_intervention_id == row.intervention_id,
        ClassworkAssignment.recipient_student_id == student_id,
        ClassworkAssignment.is_published.is_(True),
    ).order_by(ClassworkAssignment.classwork_assignment_id).all()
    activities = []
    from app.services.intervention.RemediationPrerequisiteService import (
        evaluate_remediation_prerequisite,
    )
    student = db.get(Student, student_id)
    for assignment in assignments:
        work = assignment.classwork
        if not work.is_published or work.is_archived:
            continue
        submission = db.query(StudentSubmission).filter(
            StudentSubmission.classwork_assignment_id == assignment.classwork_assignment_id,
            StudentSubmission.student_id == student_id,
        ).order_by(StudentSubmission.submission_id.desc()).first()

        decision = evaluate_remediation_prerequisite(db, assignment, student) if student else None
        if decision is None:
            access_state = "PREPARATION_REQUIRED"
            access_enforced = False
            prereq_code = "STUDENT_SCOPE_MISMATCH"
            prereq_message = "Student not found."
            activity_prep = None
        elif decision.code == "PREREQUISITE_SNAPSHOT_MISSING":
            access_state = "HISTORICAL"
            access_enforced = False
            prereq_code = decision.code
            prereq_message = decision.message
            activity_prep = None
        elif decision.code in (
            "REMEDIATION_UNAVAILABLE",
            "STUDENT_SCOPE_MISMATCH",
            "INTERVENTION_SCOPE_MISMATCH",
            "REMEDIATION_LINK_MISMATCH",
            "INTERVENTION_NOT_ACTIVE",
            "NOT_REMEDIATION",
        ):
            access_state = "PREPARATION_REQUIRED"
            access_enforced = False
            prereq_code = decision.code
            prereq_message = decision.message
            activity_prep = None
        elif decision.allowed:
            access_state = "READY"
            access_enforced = True
            prereq_code = decision.code
            prereq_message = decision.message
            activity_prep = decision.preparation
        else:
            access_state = "PREPARATION_REQUIRED"
            access_enforced = True
            prereq_code = decision.code
            prereq_message = decision.message
            activity_prep = decision.preparation

        activities.append(StudentSupportActivity(
            assignment_id=assignment.classwork_assignment_id,
            title=work.title, classwork_type=work.classwork_type,
            submission_status=submission.status if submission else None,
            grade=float(submission.grade) if submission and submission.grade is not None and work.show_scores else None,
            total_points=float(work.total_points) if work.total_points is not None and work.show_scores else None,
            access_state=access_state,
            access_enforced=access_enforced,
            prerequisite_code=prereq_code,
            prerequisite_message=prereq_message,
            preparation=activity_prep,
            readings=list(decision.readings) if decision else [],
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
        required_readings=required_readings,
        resource_issues=resource_issues,
        preparation=preparation,
        activities=activities, reviewer_id=reviewer[0] if reviewer else None,
        activated_at=row.activated_at,
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

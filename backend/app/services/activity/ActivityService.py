# app/services/activity/ActivityService.py
from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Activity import (
    ActivityCreateRequest,
    ActivityScoresResponse,
    BulkScoreUpdateRequest,
    StudentActivityScoreItem,
)
from app.services.prediction.DevelopmentGradeRefreshService import refresh_after_committed_grade_change
from app.services.classwork.ClassworkAccessService import assignment_allows_student
from app.services.grading.RemedialExamination import (
    effective_grade_changed,
    ensure_remedial_period_open,
    latest_graded_submission_score,
)
from app.services.grading.GradeabilityService import (
    ONLINE_SUBMISSION_REQUIRED,
    can_enter_grade,
    is_manual_activity,
    require_gradeable_submission,
)
from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService


def _authorize_assignment(
    db: Session,
    staff_id: str,
    classwork: Classwork,
    assignment: ClassworkAssignment,
    *,
    write: bool,
) -> None:
    if assignment.academic_period_id is None:
        raise HTTPException(status_code=403, detail="Activity has an unscoped academic period")
    if write:
        SubjectLoadAuthorizationService.assert_context_writable(
            db,
            class_id=assignment.class_id,
            academic_period_id=assignment.academic_period_id,
            block_future_period_in_current_year=True,
        )
    assertion = (
        SubjectLoadAuthorizationService.assert_can_write
        if write
        else SubjectLoadAuthorizationService.assert_can_view
    )
    assertion(
        db,
        staff_id,
        assignment.class_id,
        classwork.subject_id,
        assignment.academic_period_id,
    )


def _assert_students_not_finalized(
    db: Session,
    classwork: Classwork,
    assignment: ClassworkAssignment,
    student_ids: list[UUID],
) -> None:
    if not student_ids:
        return
    finalized = (
        db.query(StudentPeriodGrade.period_grade_id)
        .filter(
            StudentPeriodGrade.student_id.in_(student_ids),
            StudentPeriodGrade.class_id == assignment.class_id,
            StudentPeriodGrade.subject_id == classwork.subject_id,
            StudentPeriodGrade.academic_period_id == assignment.academic_period_id,
            StudentPeriodGrade.is_finalized.is_(True),
        )
        .first()
    )
    if finalized is not None:
        raise HTTPException(status_code=409, detail="The period grade is finalized")


def create_activity(db: Session, staff_id: str, payload: ActivityCreateRequest):
    period = db.get(AcademicPeriod, payload.academic_period_id)
    class_ = db.get(Class, payload.class_id)
    if period is None:
        raise HTTPException(status_code=400, detail="Academic period was not found")
    if class_ is None or class_.academic_year_id != period.academic_year_id:
        raise HTTPException(status_code=400, detail="Academic period does not belong to the target class year")
    SubjectLoadAuthorizationService.assert_context_writable(
        db,
        class_id=payload.class_id,
        academic_period_id=payload.academic_period_id,
        block_future_period_in_current_year=True,
    )
    SubjectLoadAuthorizationService.assert_can_write(
        db,
        staff_id,
        payload.class_id,
        payload.subject_id,
        payload.academic_period_id,
    )

    classwork = Classwork(
        title=payload.title,
        description=payload.description,
        classwork_type="ACTIVITY",
        classwork_category=payload.classwork_category,
        exam_subtype=payload.exam_subtype,
        activity_mode=payload.activity_mode,
        total_points=Decimal(str(payload.total_points)),
        is_published=True,
        is_locked=False,
        is_archived=False,
        subject_id=payload.subject_id,
        created_by_staff_id=staff_id,
    )
    db.add(classwork)
    db.flush()

    if payload.activity_mode == "MANUAL" and payload.lesson_ids:
        from app.services.activity.ActivityCoverageService import add_initial_manual_coverage
        add_initial_manual_coverage(db, staff_id, classwork, payload.academic_period_id, payload.lesson_ids)

    if payload.lesson_ids:
        from app.models.classwork.ClassworkLesson import ClassworkLesson
        for lid in payload.lesson_ids:
            db.add(ClassworkLesson(classwork_id=classwork.classwork_id, lesson_id=lid))

    assignment = ClassworkAssignment(
        classwork_id=classwork.classwork_id,
        class_id=payload.class_id,
        academic_period_id=payload.academic_period_id,
        assigned_by_staff_id=staff_id,
        due_date=payload.due_date,
        is_published=True,
        is_locked=False,
    )
    db.add(assignment)
    db.commit()
    db.refresh(classwork)
    db.refresh(assignment)

    return {
        "classwork_id": classwork.classwork_id,
        "classwork_assignment_id": assignment.classwork_assignment_id,
        "title": classwork.title,
        "classwork_category": classwork.classwork_category,
        "activity_mode": classwork.activity_mode,
        "total_points": float(classwork.total_points) if classwork.total_points is not None else 100.0,
    }


def _resolve_activity_and_assignment(
    db: Session,
    staff_id: str,
    activity_id: int,
    class_id: int,
) -> tuple[Classwork, ClassworkAssignment]:
    # 1. Try treating activity_id as Classwork.classwork_id
    classwork = db.query(Classwork).filter(Classwork.classwork_id == activity_id).first()
    assignment = None
    if classwork and not classwork.is_archived:
        assignment = (
            db.query(ClassworkAssignment)
            .filter(
                ClassworkAssignment.classwork_id == classwork.classwork_id,
                ClassworkAssignment.class_id == class_id,
            )
            .first()
        )

    # 2. Try treating activity_id as ClassworkAssignment.classwork_assignment_id
    if not assignment:
        assignment = (
            db.query(ClassworkAssignment)
            .filter(
                ClassworkAssignment.classwork_assignment_id == activity_id,
                ClassworkAssignment.class_id == class_id,
            )
            .first()
        )
        if assignment:
            classwork = assignment.classwork

    if not classwork or classwork.is_archived or not assignment:
        raise HTTPException(status_code=404, detail="Activity not found or not assigned to this class")

    _authorize_assignment(db, staff_id, classwork, assignment, write=False)

    return classwork, assignment


def get_activity_scores(db: Session, staff_id: str, activity_id: int, class_id: int) -> ActivityScoresResponse:
    classwork, assignment = _resolve_activity_and_assignment(db, staff_id, activity_id, class_id)

    # Fetch roster of enrolled students in this class
    students = (
        db.query(Student)
        .join(StudentClass, StudentClass.student_id == Student.student_id)
        .filter(
            StudentClass.class_id == class_id,
            StudentClass.enrollment_status == "enrolled",
        )
        .order_by(Student.last_name.asc(), Student.first_name.asc())
        .all()
    )

    # Fetch existing submissions
    submissions = (
        db.query(StudentSubmission)
        .filter(StudentSubmission.classwork_assignment_id == assignment.classwork_assignment_id)
        .all()
    )
    sub_map = {str(sub.student_id): sub for sub in submissions}

    student_items: list[StudentActivityScoreItem] = []
    for s in students:
        assigned = assignment_allows_student(assignment, s.student_id)
        sub = sub_map.get(str(s.student_id)) if assigned else None
        score = float(sub.grade) if (sub and sub.grade is not None) else None
        gradeable = assigned and can_enter_grade(classwork, sub)
        student_items.append(
            StudentActivityScoreItem(
                student_id=str(s.student_id),
                name=f"{s.first_name} {s.last_name}".strip(),
                score=score,
                assigned=assigned,
                can_enter_score=gradeable,
                score_entry_reason=(
                    None
                    if gradeable
                    else (
                        "Not assigned to this classwork."
                        if not assigned
                        else ONLINE_SUBMISSION_REQUIRED
                    )
                ),
            )
        )

    return ActivityScoresResponse(
        activity_id=classwork.classwork_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        title=classwork.title,
        max_score=float(classwork.total_points or 100),
        activity_mode=classwork.activity_mode or "MANUAL",
        students=student_items,
    )


def bulk_update_activity_scores(
    db: Session,
    staff_id: str,
    activity_id: int,
    payload: BulkScoreUpdateRequest,
) -> ActivityScoresResponse:
    classwork, assignment = _resolve_activity_and_assignment(db, staff_id, activity_id, payload.class_id)
    _authorize_assignment(db, staff_id, classwork, assignment, write=True)
    max_score = float(classwork.total_points or 100)

    # Validate the complete request before touching submissions. A targeted
    # assignment must never gain a classmate's grade through this bulk endpoint.
    enrolled_ids = {row.student_id for row in db.query(StudentClass).filter_by(
        class_id=payload.class_id, enrollment_status="enrolled",
    ).all()}
    requested_student_ids: set[UUID] = set()
    for item in payload.scores:
        if item.student_id in requested_student_ids:
            raise HTTPException(status_code=400, detail="Each student's score may be submitted only once")
        requested_student_ids.add(item.student_id)
        if item.student_id not in enrolled_ids or not assignment_allows_student(assignment, item.student_id):
            raise HTTPException(status_code=403, detail="Student is not assigned to this activity")
        ensure_remedial_period_open(db, assignment, item.student_id)

    _assert_students_not_finalized(
        db,
        classwork,
        assignment,
        [item.student_id for item in payload.scores],
    )

    # Fetch existing submissions before validating changes. No mutation occurs
    # until every requested score and submission is known to be gradeable.
    existing_subs = (
        db.query(StudentSubmission)
        .filter(StudentSubmission.classwork_assignment_id == assignment.classwork_assignment_id)
        .order_by(StudentSubmission.submission_id.asc())
        .all()
    )
    sub_map = {str(sub.student_id): sub for sub in existing_subs}

    changed_student_ids: set[str] = set()

    # Validate each score input before modifying database.
    for item in payload.scores:
        if item.score is not None:
            if item.score < 0:
                raise HTTPException(
                    status_code=400,
                    detail=f"Score cannot be negative for student ID {item.student_id}",
                )
            if item.score > max_score:
                raise HTTPException(
                    status_code=400,
                    detail=f"Score ({item.score}) exceeds maximum score ({max_score}) for student ID {item.student_id}",
                )
        sub = sub_map.get(str(item.student_id))
        current_score = float(sub.grade) if sub is not None and sub.grade is not None else None
        requested_score = float(item.score) if item.score is not None else None
        if requested_score != current_score:
            require_gradeable_submission(classwork, sub)
            changed_student_ids.add(str(item.student_id))
    original_grades = {
        str(item.student_id): latest_graded_submission_score(
            db, assignment.classwork_assignment_id, item.student_id,
        )
        for item in payload.scores
    }

    now = datetime.now(timezone.utc)

    for item in payload.scores:
        sid_str = str(item.student_id)
        if sid_str not in changed_student_ids:
            continue
        sub = sub_map.get(sid_str)
        if sub is None:
            try:
                parsed_sid = UUID(sid_str)
            except (ValueError, TypeError):
                parsed_sid = sid_str
            sub = StudentSubmission(
                student_id=parsed_sid,
                classwork_assignment_id=assignment.classwork_assignment_id,
            )
            db.add(sub)
            sub_map[sid_str] = sub

        if item.score is not None:
            sub.grade = Decimal(str(item.score))
            sub.status = "graded"
            sub.graded_at = now
            sub.graded_by_staff_id = staff_id
        else:
            sub.grade = None
            # Clearing an online grade does not erase the completed attempt.
            # Manual/offline rows have no submitted lifecycle to preserve.
            sub.status = "pending" if is_manual_activity(classwork) else "submitted"

    if assignment.source_intervention_id is not None and changed_student_ids:
        from app.services.intervention.InterventionNotificationService import (
            stage_remediation_needs_teacher_review_if_exhausted,
        )
        db.flush()
        for sid_str in changed_student_ids:
            sub = sub_map.get(sid_str)
            if sub is not None and sub.status == "graded":
                stage_remediation_needs_teacher_review_if_exhausted(db, assignment, sub)

    db.commit()

    changed_students = {
        UUID(student_id)
        for student_id, original in original_grades.items()
        if effective_grade_changed(
            db,
            assignment,
            UUID(student_id),
            original,
            latest_graded_submission_score(
                db, assignment.classwork_assignment_id, UUID(student_id),
            ),
        )
    }
    if classwork.is_graded:
        refresh_after_committed_grade_change(
            db.get_bind(),
            student_ids=changed_students,
            class_id=assignment.class_id,
            subject_id=classwork.subject_id,
            period_id=assignment.academic_period_id,
        )

    return get_activity_scores(db, staff_id, classwork.classwork_id, payload.class_id)


def delete_activity(db: Session, staff_id: str, activity_id: int):
    classwork = db.query(Classwork).filter(Classwork.classwork_id == activity_id).first()
    if not classwork:
        raise HTTPException(status_code=404, detail="Activity not found")

    assignments = (
        db.query(ClassworkAssignment)
        .filter(ClassworkAssignment.classwork_id == classwork.classwork_id)
        .all()
    )
    if not assignments:
        raise HTTPException(status_code=403, detail="Activity has no authorized academic scope")

    for assignment in assignments:
        _authorize_assignment(db, staff_id, classwork, assignment, write=True)
        finalized = (
            db.query(StudentPeriodGrade.period_grade_id)
            .filter(
                StudentPeriodGrade.class_id == assignment.class_id,
                StudentPeriodGrade.subject_id == classwork.subject_id,
                StudentPeriodGrade.academic_period_id == assignment.academic_period_id,
                StudentPeriodGrade.is_finalized.is_(True),
            )
            .first()
        )
        if finalized is not None:
            raise HTTPException(status_code=409, detail="The period grade is finalized")

    classwork.is_archived = True
    db.commit()
    return {"message": "Activity deleted successfully"}

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonGoal import LessonGoal, LessonGoalItem
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.lesson_goal import (
    LessonGoalItemDetailClasswork,
    LessonGoalItemDetailLesson,
    LessonGoalItemResponse,
    LessonGoalResponse,
    LessonGoalSetRequest,
)
from app.services.classwork.ClassworkShared import aware_utc
from app.services.academic.AcademicLifecycleService import resolve_active_academic_period
from app.services.academic.ContentAuthorizationService import authorize_teacher_content, resolve_content_staff_id
from app.services.lesson.LessonShared import authorize_lesson_access
from app.services.classwork.ClassworkAccessService import (
    authorize_assignment_access,
    authorize_classwork_access,
    user_id_from_claims,
)


def _resolve_goal_read_context(
    db: Session,
    *,
    class_id: int,
    subject_id: int,
    academic_period_id: int | None,
) -> tuple[Class, Subject, AcademicPeriod]:
    class_obj = db.get(Class, class_id)
    if class_obj is None:
        raise HTTPException(status_code=404, detail="Class not found")
    subject_obj = db.get(Subject, subject_id)
    if subject_obj is None:
        raise HTTPException(status_code=404, detail="Subject not found")

    period_obj = (
        db.get(AcademicPeriod, academic_period_id)
        if academic_period_id is not None
        else resolve_active_academic_period(db)
    )
    if period_obj is None:
        raise HTTPException(status_code=404, detail="Academic period not found")
    if class_obj.academic_year_id != period_obj.academic_year_id:
        raise HTTPException(status_code=404, detail="Lesson goal not found")
    return class_obj, subject_obj, period_obj


def get_curated_lesson_goal(
    class_id: int,
    subject_id: int,
    academic_period_id: Optional[int],
    current_user: dict,
    db: Session,
) -> LessonGoalResponse:
    # 1. Resolve the canonical current period only when the caller did not
    # explicitly select a historical/future context.
    _class_obj, _subject_obj, period_obj = _resolve_goal_read_context(
        db,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
    )
    academic_period_id = period_obj.academic_period_id

    user_role = current_user.get("role")
    student_obj: Student | None = None
    if user_role == "student":
        student_obj = db.query(Student).filter(
            Student.user_id == user_id_from_claims(current_user)
        ).first()
        if student_obj is None:
            raise HTTPException(status_code=404, detail="Student profile not found")
        enrollment = db.query(StudentClass).filter(
            StudentClass.student_id == student_obj.student_id,
            StudentClass.class_id == class_id,
            StudentClass.academic_year_id == period_obj.academic_year_id,
            StudentClass.enrollment_status == "enrolled",
        ).first()
        if enrollment is None:
            raise HTTPException(status_code=403, detail="Not enrolled in this class")

    # 2. Query LessonGoal
    goal = (
        db.query(LessonGoal)
        .filter(
            LessonGoal.class_id == class_id,
            LessonGoal.subject_id == subject_id,
            LessonGoal.academic_period_id == academic_period_id,
        )
        .first()
    )

    if current_user.get("role") == "teacher":
        authorize_teacher_content(
            db, staff_id=resolve_content_staff_id(db, current_user),
            owner_staff_id=goal.created_by_staff_id if goal else None,
            detail="Lesson goal not found",
            read_scopes=[(class_id, subject_id, academic_period_id)],
        )

    if not goal:
        return LessonGoalResponse(
            goal_id=None,
            class_id=class_id,
            subject_id=subject_id,
            academic_period_id=academic_period_id,
            items=[],
        )

    # Pre-fetch ClassworkAssignments for this class
    classwork_ids = [it.classwork_id for it in goal.items if it.classwork_id]
    asgn_map: dict[int, ClassworkAssignment] = {}
    if classwork_ids:
        assignments = (
            db.query(ClassworkAssignment)
            .filter(
                ClassworkAssignment.class_id == class_id,
                ClassworkAssignment.classwork_id.in_(classwork_ids),
                ClassworkAssignment.academic_period_id == academic_period_id,
            )
            .all()
        )
        for asgn in assignments:
            asgn_map[asgn.classwork_id] = asgn

    # Pre-fetch Submissions if student
    sub_map: dict[int, StudentSubmission] = {}
    if student_obj and asgn_map:
        sub_records = (
            db.query(StudentSubmission)
            .filter(
                StudentSubmission.student_id == student_obj.student_id,
                StudentSubmission.classwork_assignment_id.in_([a.classwork_assignment_id for a in asgn_map.values()]),
            )
            .all()
        )
        for s in sub_records:
            sub_map[s.classwork_assignment_id] = s

    # 4. Build Item Responses
    item_responses: list[LessonGoalItemResponse] = []
    for it in goal.items:
        lesson_detail: LessonGoalItemDetailLesson | None = None
        classwork_detail: LessonGoalItemDetailClasswork | None = None

        # Curated summaries must not bypass detail policy. Teachers retain
        # ownership/assignment reads; students only receive published content
        # in their enrolled class and the selected period.
        if user_role == "teacher":
            try:
                if it.lesson:
                    authorize_lesson_access(db, it.lesson, current_user, class_id=class_id)
                if it.classwork:
                    authorize_classwork_access(it.classwork, current_user, db, class_id)
            except HTTPException as error:
                if error.status_code != 404:
                    raise
                continue
        elif user_role == "student":
            try:
                if it.lesson:
                    if not it.lesson.is_published or it.lesson.is_locked:
                        continue
                if it.classwork:
                    assignment = asgn_map.get(it.classwork.classwork_id)
                    if assignment is None:
                        continue
                    authorize_assignment_access(
                        assignment, it.classwork, current_user, db
                    )
            except HTTPException as error:
                if error.status_code not in (403, 404):
                    raise
                continue

        if it.item_type == "LESSON" and it.lesson_id and it.lesson:
            if not it.lesson.is_archived:
                lesson_detail = LessonGoalItemDetailLesson(
                    lesson_id=it.lesson.lesson_id,
                    title=it.lesson.title,
                    description=it.lesson.description,
                    is_published=it.lesson.is_published,
                    order_index=it.lesson.order_index,
                )
        elif it.item_type == "CLASSWORK" and it.classwork_id and it.classwork:
            if not it.classwork.is_archived:
                asgn = asgn_map.get(it.classwork.classwork_id)
                if student_obj and asgn and asgn.recipient_student_id is not None and str(asgn.recipient_student_id) != str(student_obj.student_id):
                    continue
                sub = sub_map.get(asgn.classwork_assignment_id) if asgn else None
                sub_status = sub.status.lower() if sub and sub.status else None
                due_str = aware_utc(asgn.due_date).isoformat() if asgn and asgn.due_date else None

                classwork_detail = LessonGoalItemDetailClasswork(
                    classwork_id=it.classwork.classwork_id,
                    classwork_assignment_id=asgn.classwork_assignment_id if asgn else None,
                    title=it.classwork.title,
                    classwork_type=it.classwork.classwork_type,
                    classwork_category=it.classwork.classwork_category,
                    exam_subtype=it.classwork.exam_subtype,
                    is_graded=it.classwork.is_graded,
                    total_points=float(it.classwork.total_points) if it.classwork.total_points is not None else None,
                    due_date=due_str,
                    submission_status=sub_status,
                )

        if lesson_detail or classwork_detail:
            item_responses.append(
                LessonGoalItemResponse(
                    goal_item_id=it.goal_item_id,
                    item_type=it.item_type,
                    lesson_id=it.lesson_id,
                    classwork_id=it.classwork_id,
                    order_index=it.order_index,
                    lesson=lesson_detail,
                    classwork=classwork_detail,
                )
            )

    return LessonGoalResponse(
        goal_id=goal.goal_id,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
        items=item_responses,
    )


def save_curated_lesson_goal(
    class_id: int,
    subject_id: int,
    request: LessonGoalSetRequest,
    staff_id: str | None,
    current_user: dict,
    db: Session,
) -> LessonGoalResponse:
    # 1. Verify class and subject exist
    class_obj = db.get(Class, class_id)
    if not class_obj:
        raise HTTPException(status_code=404, detail="Class not found")
    subject_obj = db.get(Subject, subject_id)
    if not subject_obj:
        raise HTTPException(status_code=404, detail="Subject not found")

    period_obj = db.get(AcademicPeriod, request.academic_period_id)
    if not period_obj:
        raise HTTPException(status_code=404, detail="Academic period not found")

    from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
    if current_user.get("role") == "teacher" and staff_id:
        SubjectLoadAuthorizationService.assert_can_write(
            db, staff_id, class_id, subject_id, request.academic_period_id
        )
    else:
        SubjectLoadAuthorizationService.assert_context_configurable(
            db,
            class_id=class_id,
            academic_period_id=request.academic_period_id,
        )

    # 2. Find or create LessonGoal
    goal = (
        db.query(LessonGoal)
        .filter(
            LessonGoal.class_id == class_id,
            LessonGoal.subject_id == subject_id,
            LessonGoal.academic_period_id == request.academic_period_id,
        )
        .first()
    )

    for item in request.items:
        item_type = item.item_type.upper().strip()
        model = Lesson if item_type == "LESSON" else Classwork if item_type == "CLASSWORK" else None
        content_id = item.lesson_id if model is Lesson else item.classwork_id if model is Classwork else None
        content = db.get(model, content_id) if model is not None and content_id is not None else None
        if content is None or content.subject_id != subject_id:
            raise HTTPException(status_code=404, detail="Lesson goal item not found")

    if current_user.get("role") == "teacher":
        # Authorize before creating, replacing, flushing, or deleting any row.
        authorize_teacher_content(
            db, staff_id=staff_id, owner_staff_id=goal.created_by_staff_id if goal else None,
            detail="Lesson goal not found", owner_only=goal is not None,
            read_scopes=[(class_id, subject_id, request.academic_period_id)],
        )
        for item in request.items:
            model = Lesson if item.item_type.upper().strip() == "LESSON" else Classwork
            content_id = item.lesson_id if model is Lesson else item.classwork_id
            content = db.get(model, content_id)
            authorize_teacher_content(
                db, staff_id=staff_id, owner_staff_id=content.created_by_staff_id,
                detail="Lesson goal item not found", owner_only=True,
            )

    if not goal:
        goal = LessonGoal(
            class_id=class_id,
            subject_id=subject_id,
            academic_period_id=request.academic_period_id,
            created_by_staff_id=staff_id,
        )
        db.add(goal)
        db.flush()
    else:
        goal.created_by_staff_id = staff_id
        goal.updated_at = datetime.now(timezone.utc)
        # Remove existing items to replace with new curated list
        db.query(LessonGoalItem).filter(LessonGoalItem.goal_id == goal.goal_id).delete()

    # 3. Create items
    for it in request.items:
        item_type = it.item_type.upper().strip()
        if item_type not in ("LESSON", "CLASSWORK"):
            continue

        goal_item = LessonGoalItem(
            goal_id=goal.goal_id,
            item_type=item_type,
            lesson_id=it.lesson_id if item_type == "LESSON" else None,
            classwork_id=it.classwork_id if item_type == "CLASSWORK" else None,
            order_index=it.order_index,
        )
        db.add(goal_item)

    db.commit()
    db.refresh(goal)

    return get_curated_lesson_goal(
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=request.academic_period_id,
        current_user=current_user,
        db=db,
    )


def clear_curated_lesson_goal(
    class_id: int,
    subject_id: int,
    academic_period_id: int,
    db: Session,
    current_user: dict,
) -> None:
    class_obj = db.get(Class, class_id)
    if class_obj is None:
        raise HTTPException(status_code=404, detail="Class not found")
    if db.get(Subject, subject_id) is None:
        raise HTTPException(status_code=404, detail="Subject not found")
    period_obj = db.get(AcademicPeriod, academic_period_id)
    if period_obj is None:
        raise HTTPException(status_code=404, detail="Academic period not found")
    if class_obj.academic_year_id != period_obj.academic_year_id:
        raise HTTPException(status_code=404, detail="Lesson goal not found")

    goal = (
        db.query(LessonGoal)
        .filter(
            LessonGoal.class_id == class_id,
            LessonGoal.subject_id == subject_id,
            LessonGoal.academic_period_id == academic_period_id,
        )
        .first()
    )
    if current_user.get("role") == "teacher":
        staff_id = resolve_content_staff_id(db, current_user)
        authorize_teacher_content(
            db,
            staff_id=staff_id,
            owner_staff_id=goal.created_by_staff_id if goal else None,
            detail="Lesson goal not found",
            owner_only=goal is not None,
            read_scopes=[(class_id, subject_id, academic_period_id)],
        )
    from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService
    if current_user.get("role") == "teacher":
        SubjectLoadAuthorizationService.assert_can_write(
            db, staff_id, class_id, subject_id, academic_period_id,
        )
    else:
        SubjectLoadAuthorizationService.assert_context_configurable(
            db, class_id=class_id, academic_period_id=academic_period_id
        )
    if goal:
        db.delete(goal)
        db.commit()

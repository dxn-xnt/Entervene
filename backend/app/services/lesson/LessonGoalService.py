from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonGoal import LessonGoal, LessonGoalItem
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


def get_curated_lesson_goal(
    class_id: int,
    subject_id: int,
    academic_period_id: Optional[int],
    current_user: dict,
    db: Session,
) -> LessonGoalResponse:
    # 1. Resolve Academic Period if not provided
    if not academic_period_id:
        active_period = (
            db.query(AcademicPeriod)
            .filter(AcademicPeriod.is_active == True)
            .first()
        )
        if not active_period:
            active_period = db.query(AcademicPeriod).order_by(AcademicPeriod.academic_period_id.desc()).first()
        academic_period_id = active_period.academic_period_id if active_period else 0

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

    if not goal:
        return LessonGoalResponse(
            goal_id=None,
            class_id=class_id,
            subject_id=subject_id,
            academic_period_id=academic_period_id,
            items=[],
        )

    # 3. Check student context for submissions
    user_role = current_user.get("role")
    student_obj: Student | None = None
    if user_role == "student":
        raw_uid = current_user.get("sub") or current_user.get("user_id")
        if raw_uid:
            import uuid as _uuid
            try:
                target_uid = _uuid.UUID(str(raw_uid)) if isinstance(raw_uid, str) else raw_uid
            except (ValueError, TypeError):
                target_uid = raw_uid
            student_obj = db.query(Student).filter(Student.user_id == target_uid).first()

    # Pre-fetch ClassworkAssignments for this class
    classwork_ids = [it.classwork_id for it in goal.items if it.classwork_id]
    asgn_map: dict[int, ClassworkAssignment] = {}
    if classwork_ids:
        assignments = (
            db.query(ClassworkAssignment)
            .filter(
                ClassworkAssignment.class_id == class_id,
                ClassworkAssignment.classwork_id.in_(classwork_ids),
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
                due_str = asgn.due_date.isoformat() if asgn and asgn.due_date else None

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
) -> None:
    goal = (
        db.query(LessonGoal)
        .filter(
            LessonGoal.class_id == class_id,
            LessonGoal.subject_id == subject_id,
            LessonGoal.academic_period_id == academic_period_id,
        )
        .first()
    )
    if goal:
        db.delete(goal)
        db.commit()

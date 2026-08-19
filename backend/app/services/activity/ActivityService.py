# app/services/activity/ActivityService.py
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
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


def _verify_teacher_scope(db: Session, staff_id: str, class_id: int, subject_id: int):
    row = (
        db.query(SubjectLoad)
        .filter(
            SubjectLoad.staff_id == staff_id,
            SubjectLoad.class_id == class_id,
            SubjectLoad.subject_id == subject_id,
            SubjectLoad.status == "active",
        )
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=403,
            detail="You do not have active teaching permissions for this class and subject",
        )
    return row


def create_activity(db: Session, staff_id: str, payload: ActivityCreateRequest):
    _verify_teacher_scope(db, staff_id, payload.class_id, payload.subject_id)

    classwork = Classwork(
        title=payload.title,
        description=payload.description,
        classwork_type="ACTIVITY",
        classwork_category=payload.classwork_category,
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

    if payload.lesson_ids:
        from app.models.classwork.ClassworkLesson import ClassworkLesson
        for lid in payload.lesson_ids:
            db.add(ClassworkLesson(classwork_id=classwork.classwork_id, lesson_id=lid))

    assignment = ClassworkAssignment(
        classwork_id=classwork.classwork_id,
        class_id=payload.class_id,
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


def get_activity_scores(db: Session, staff_id: str, activity_id: int, class_id: int) -> ActivityScoresResponse:
    classwork = db.query(Classwork).filter(Classwork.classwork_id == activity_id).first()
    if not classwork:
        raise HTTPException(status_code=404, detail="Activity not found")

    _verify_teacher_scope(db, staff_id, class_id, classwork.subject_id)

    assignment = (
        db.query(ClassworkAssignment)
        .filter(
            ClassworkAssignment.classwork_id == activity_id,
            ClassworkAssignment.class_id == class_id,
        )
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Activity is not assigned to this class")

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
    sub_map = {sub.student_id: sub for sub in submissions}

    student_items: list[StudentActivityScoreItem] = []
    for s in students:
        sub = sub_map.get(s.student_id)
        score = float(sub.grade) if (sub and sub.grade is not None) else None
        student_items.append(
            StudentActivityScoreItem(
                student_id=s.student_id,
                name=f"{s.first_name} {s.last_name}".strip(),
                score=score,
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
    classwork = db.query(Classwork).filter(Classwork.classwork_id == activity_id).first()
    if not classwork:
        raise HTTPException(status_code=404, detail="Activity not found")

    _verify_teacher_scope(db, staff_id, payload.class_id, classwork.subject_id)

    assignment = (
        db.query(ClassworkAssignment)
        .filter(
            ClassworkAssignment.classwork_id == activity_id,
            ClassworkAssignment.class_id == payload.class_id,
        )
        .first()
    )
    if not assignment:
        raise HTTPException(status_code=404, detail="Activity is not assigned to this class")

    max_score = float(classwork.total_points or 100)

    # Validate each score input before modifying database
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

    # Fetch existing submissions
    existing_subs = (
        db.query(StudentSubmission)
        .filter(StudentSubmission.classwork_assignment_id == assignment.classwork_assignment_id)
        .all()
    )
    sub_map = {sub.student_id: sub for sub in existing_subs}

    now = datetime.now(timezone.utc)

    for item in payload.scores:
        sub = sub_map.get(item.student_id)
        if sub is None:
            sub = StudentSubmission(
                student_id=item.student_id,
                classwork_assignment_id=assignment.classwork_assignment_id,
            )
            db.add(sub)

        if item.score is not None:
            sub.grade = Decimal(str(item.score))
            sub.status = "graded"
            sub.graded_at = now
            sub.graded_by_staff_id = staff_id
        else:
            sub.grade = None
            sub.status = "pending"

    db.commit()

    return get_activity_scores(db, staff_id, activity_id, payload.class_id)


def delete_activity(db: Session, staff_id: str, activity_id: int):
    classwork = db.query(Classwork).filter(Classwork.classwork_id == activity_id).first()
    if not classwork:
        raise HTTPException(status_code=404, detail="Activity not found")

    classwork.is_archived = True
    db.commit()
    return {"message": "Activity deleted successfully"}

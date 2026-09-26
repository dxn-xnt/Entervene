"""Teacher assertions about coverage of externally scored activities."""

from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.schemas.ActivityCoverage import ActivityCoverageResponse, ActivityCoverageUpdate
from app.services.academic.SubjectLoadAuthorizationService import SubjectLoadAuthorizationService


def validate_coverage_targets(
    db: Session, subject_id: int, period_id: int, lesson_ids: list[int], competency_ids: list[int],
) -> list[tuple[int | None, int | None]]:
    if len(set(lesson_ids)) != len(lesson_ids) or len(set(competency_ids)) != len(competency_ids):
        raise HTTPException(status_code=400, detail="Duplicate coverage target")
    targets: list[tuple[int | None, int | None]] = []
    for lesson_id in lesson_ids:
        lesson = db.get(Lesson, lesson_id)
        if lesson is None or lesson.subject_id != subject_id:
            raise HTTPException(status_code=400, detail="Lesson does not belong to the assessment subject")
        competency_id = lesson.competency_id
        if competency_id is not None:
            competency = db.get(Competency, competency_id)
            if competency is None or competency.subject_id != subject_id or (
                competency.academic_period_id is not None and competency.academic_period_id != period_id
            ):
                raise HTTPException(status_code=400, detail="Lesson competency is incompatible with the assessment scope")
        targets.append((lesson_id, competency_id))
    for competency_id in competency_ids:
        competency = db.get(Competency, competency_id)
        if competency is None or competency.subject_id != subject_id or (
            competency.academic_period_id is not None and competency.academic_period_id != period_id
        ):
            raise HTTPException(status_code=400, detail="Competency does not belong to the assessment scope")
        targets.append((None, competency_id))
    return targets


def _manual_scope(db: Session, staff_id: str, activity_id: int, class_id: int) -> tuple[Classwork, ClassworkAssignment]:
    classwork = db.get(Classwork, activity_id)
    if classwork is None or classwork.activity_mode != "MANUAL" or classwork.classwork_type != "ACTIVITY" or classwork.is_archived:
        raise HTTPException(status_code=404, detail="Manual activity not found")
    assignment = db.query(ClassworkAssignment).filter_by(classwork_id=activity_id, class_id=class_id).one_or_none()
    if assignment is None or assignment.academic_period_id is None:
        raise HTTPException(status_code=404, detail="Activity assignment with an academic period not found")
    # A Classwork can be assigned to several classes; changes affect all of them.
    for assigned in db.query(ClassworkAssignment).filter_by(classwork_id=activity_id).all():
        if assigned.academic_period_id is None:
            raise HTTPException(status_code=403, detail="Activity has an unscoped assignment")
        SubjectLoadAuthorizationService.assert_can_write(
            db, staff_id, assigned.class_id, classwork.subject_id, assigned.academic_period_id,
        )
        if assigned.academic_period_id != assignment.academic_period_id:
            raise HTTPException(status_code=400, detail="Activity spans multiple academic periods")
    return classwork, assignment


def _response(db: Session, classwork_id: int, class_id: int, period_id: int) -> ActivityCoverageResponse:
    db.flush()
    rows = db.query(ClassworkCoverage).filter_by(classwork_id=classwork_id).order_by(ClassworkCoverage.coverage_id).all()
    return ActivityCoverageResponse(
        classwork_id=classwork_id, class_id=class_id, academic_period_id=period_id,
        links=[{
            "coverage_id": row.coverage_id, "lesson_id": row.lesson_id,
            "competency_id": row.competency_id, "valid_from": row.valid_from,
            "linked_by_staff_id": row.linked_by_staff_id, "valid_until": row.valid_until,
            "removed_by_staff_id": row.removed_by_staff_id,
        } for row in rows],
    )


def get_manual_activity_coverage(db: Session, staff_id: str, activity_id: int, class_id: int) -> ActivityCoverageResponse:
    _, assignment = _manual_scope(db, staff_id, activity_id, class_id)
    return _response(db, activity_id, class_id, assignment.academic_period_id)


def replace_manual_activity_coverage(
    db: Session, staff_id: str, activity_id: int, class_id: int, payload: ActivityCoverageUpdate,
) -> ActivityCoverageResponse:
    classwork, assignment = _manual_scope(db, staff_id, activity_id, class_id)
    db.query(Classwork.classwork_id).filter_by(classwork_id=activity_id).with_for_update().one()
    targets = validate_coverage_targets(
        db, classwork.subject_id, assignment.academic_period_id, payload.lesson_ids, payload.competency_ids,
    )
    desired = {(lesson_id, competency_id) for lesson_id, competency_id in targets}
    active = db.query(ClassworkCoverage).filter_by(classwork_id=activity_id, valid_until=None).all()
    # A lesson's competency may change later. The saved association remains the
    # historical assertion; match lesson rows by lesson ID, not mutable metadata.
    active_keys = {(row.lesson_id, None if row.lesson_id is not None else row.competency_id): row for row in active}
    desired_keys = {(lesson_id, None if lesson_id is not None else competency_id) for lesson_id, competency_id in desired}
    now = db.execute(select(func.now())).scalar_one()
    if active:
        latest_start = max(row.valid_from for row in active)
        if now <= latest_start:
            now = latest_start + timedelta(microseconds=1)
    for key, row in active_keys.items():
        if key not in desired_keys:
            row.valid_until = now
            row.removed_by_staff_id = staff_id
    db.flush()
    for lesson_id, competency_id in targets:
        key = (lesson_id, None if lesson_id is not None else competency_id)
        if key not in active_keys:
            db.add(ClassworkCoverage(
                classwork_id=activity_id, lesson_id=lesson_id, competency_id=competency_id,
                valid_from=now, linked_by_staff_id=staff_id,
            ))
    current_lessons = {row.lesson_id: row for row in db.query(ClassworkLesson).filter_by(classwork_id=activity_id).all()}
    wanted_lessons = set(payload.lesson_ids)
    for lesson_id, row in current_lessons.items():
        if lesson_id not in wanted_lessons:
            db.delete(row)
    db.flush()
    for lesson_id in wanted_lessons - current_lessons.keys():
        db.add(ClassworkLesson(classwork_id=activity_id, lesson_id=lesson_id))
    db.commit()
    return _response(db, activity_id, class_id, assignment.academic_period_id)


def add_initial_manual_coverage(
    db: Session, staff_id: str, classwork: Classwork, period_id: int, lesson_ids: list[int],
) -> None:
    targets = validate_coverage_targets(db, classwork.subject_id, period_id, lesson_ids, [])
    for lesson_id, competency_id in targets:
        db.add(ClassworkCoverage(
            classwork_id=classwork.classwork_id, lesson_id=lesson_id,
            competency_id=competency_id, linked_by_staff_id=staff_id,
        ))

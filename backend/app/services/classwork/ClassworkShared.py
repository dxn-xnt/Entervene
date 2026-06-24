import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.core.FileUpload import delete_file
from app.models.academic.Lesson import Lesson
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment

# SHARED CLASSWORK RULES
# Routes call these helpers so schedule, ownership, and file-cleanup behavior
# stays consistent across classwork and submission flows.

READING_TYPE = "READING"
QUIZ_TYPE = "QUIZ"


def normalize_classwork_type(value: str) -> str:
    return value.strip().upper()


def is_reading_type(value: Optional[str]) -> bool:
    return normalize_classwork_type(value or "") == READING_TYPE


def is_quiz_type(value: Optional[str]) -> bool:
    return normalize_classwork_type(value or "") == QUIZ_TYPE


def normalize_uploaded_path(info: dict) -> dict:
    raw_path = info.get("file_path", "")
    normalized = raw_path.replace("\\", "/")
    try:
        uploads_idx = next(i for i, part in enumerate(Path(normalized).parts) if part == "uploads")
        info["file_path"] = str(Path(*Path(normalized).parts[uploads_idx:]))
    except StopIteration:
        pass
    return info


def validate_classwork_values(total_points: Optional[float] = None, max_attempts: Optional[int] = None) -> None:
    """Keep classwork scoring and retry limits valid before writing rows."""
    if total_points is not None and total_points <= 0:
        raise HTTPException(status_code=400, detail="Total points must be greater than zero")
    if max_attempts is not None and max_attempts <= 0:
        raise HTTPException(status_code=400, detail="Max attempts must be greater than zero")


def validate_schedule(
    publish_date: Optional[datetime],
    due_date: Optional[datetime],
    lock_date: Optional[datetime],
) -> None:
    # publish_date is kept only for older clients; visibility now uses is_published.
    if due_date and lock_date and lock_date > due_date:
        raise HTTPException(status_code=400, detail="Lock date must be before or equal to due date")


def dedupe_ids(ids: Optional[list[int]]) -> list[int]:
    return list(dict.fromkeys(ids or []))


def parse_id_list(raw: Optional[str], field_name: str) -> list[int]:
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail=f"{field_name} must be a JSON array")
    if not isinstance(value, list) or not all(isinstance(item, int) for item in value):
        raise HTTPException(status_code=400, detail=f"{field_name} must be a JSON array of IDs")
    return dedupe_ids(value)


def ensure_subject_owner(db: Session, staff_id: str, subject_id: int) -> None:
    """Teachers can only create or assign classwork for active subject loads."""
    load = db.query(SubjectLoad).filter(
        SubjectLoad.staff_id == staff_id,
        SubjectLoad.subject_id == subject_id,
        SubjectLoad.status == "active",
    ).first()
    if not load:
        raise HTTPException(status_code=403, detail="You are not assigned to this subject")


def ensure_lessons_owned(db: Session, staff_id: str, subject_id: int, lesson_ids: list[int]) -> None:
    """Linked lessons must belong to the same teacher and subject as the classwork."""
    if not lesson_ids:
        return
    lessons = db.query(Lesson).filter(
        Lesson.lesson_id.in_(lesson_ids),
        Lesson.subject_id == subject_id,
        Lesson.created_by_staff_id == staff_id,
    ).all()
    if len(lessons) != len(lesson_ids):
        raise HTTPException(status_code=400, detail="One or more lessons cannot be linked to this classwork")


def ensure_class_targets(db: Session, staff_id: str, subject_id: int, class_ids: list[int]) -> None:
    """Class assignment targets must match the teacher's active subject loads."""
    if not class_ids:
        raise HTTPException(status_code=400, detail="Select at least one class target")
    valid_class_ids = {
        row[0]
        for row in db.query(SubjectLoad.class_id).filter(
            SubjectLoad.staff_id == staff_id,
            SubjectLoad.subject_id == subject_id,
            SubjectLoad.class_id.in_(class_ids),
            SubjectLoad.status == "active",
        ).all()
    }
    if set(class_ids) != valid_class_ids:
        raise HTTPException(status_code=403, detail="Not assigned to one or more class/subject targets")


def cleanup_saved_files(file_paths: list[str]) -> None:
    for file_path in file_paths:
        delete_file(file_path)


def aware_utc(value: Optional[datetime]) -> Optional[datetime]:
    if value and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def assignment_is_available(ca: ClassworkAssignment, now: Optional[datetime] = None) -> bool:
    """Published assignments are visible even when they are still locked."""
    return bool(ca.is_published)


def assignment_is_locked(ca: ClassworkAssignment, now: Optional[datetime] = None) -> bool:
    """Future lock dates keep assignments inaccessible until that time."""
    lock_date = aware_utc(ca.lock_date)
    now_value = now or datetime.now(timezone.utc)
    return bool(ca.is_locked or (lock_date and now_value < lock_date))


def classwork_uses_attempt_limit(cw: Classwork) -> bool:
    """Only quiz classwork should enforce a resubmission attempt cap."""
    return is_quiz_type(cw.classwork_type)

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.core.Dependencies import get_staff_id, require_role
from app.db.Session import get_db
from app.schemas.StudentRecord import (
    StudentPeriodGradeFinalizeRequest,
    StudentPeriodGradeFinalizeResponse,
    StudentRecordDetailResponse,
    StudentRecordPeriodOptionsResponse,
    StudentRecordRosterResponse,
)
from app.services.student_record.StudentRecordService import (
    finalize_student_period_grade,
    teacher_period_options,
    teacher_student_record_detail,
    teacher_student_roster,
)


router = APIRouter()


@router.post(
    "/period-grades/{period_grade_id}/finalize",
    response_model=StudentPeriodGradeFinalizeResponse,
)
def finalize_period_grade(
    period_grade_id: int,
    payload: StudentPeriodGradeFinalizeRequest,
    _staff: dict = Depends(require_role("admin", "teacher")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return finalize_student_period_grade(
        db,
        period_grade_id=period_grade_id,
        final_period_grade=payload.final_period_grade,
        finalized_by_staff_id=staff_id,
        passing_grade=payload.passing_grade,
    )


@router.get("/teacher/periods", response_model=StudentRecordPeriodOptionsResponse)
def get_teacher_record_periods(
    class_id: int | None = Query(None),
    subject_id: int | None = Query(None),
    _teacher: dict = Depends(require_role("teacher")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return teacher_period_options(db, staff_id, class_id, subject_id)


@router.get(
    "/teacher/classes/{class_id}/subjects/{subject_id}/roster",
    response_model=StudentRecordRosterResponse,
)
def get_teacher_student_roster(
    class_id: int,
    subject_id: int,
    academic_period_id: int | None = Query(None),
    _teacher: dict = Depends(require_role("teacher")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return teacher_student_roster(db, staff_id, class_id, subject_id, academic_period_id)


@router.get(
    "/teacher/classes/{class_id}/subjects/{subject_id}/students/{student_id}",
    response_model=StudentRecordDetailResponse,
)
def get_teacher_student_record_detail(
    class_id: int,
    subject_id: int,
    student_id: UUID,
    academic_period_id: int | None = Query(None),
    _teacher: dict = Depends(require_role("teacher")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return teacher_student_record_detail(
        db,
        staff_id,
        class_id,
        subject_id,
        student_id,
        academic_period_id,
    )

from uuid import UUID

from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.core.Dependencies import get_staff_id, require_role
from app.db.Session import get_db
from app.schemas.StudentRecord import (
    BulkSendGradesRequest,
    BulkSendGradesToAdviserResponse,
    SendGradeToAdviserItemResponse,
    SendStudentGradeRequest,
    StudentGradebookResponse,
    StudentPeriodGradeFinalizeRequest,
    StudentPeriodGradeFinalizeResponse,
    StudentRecordDetailResponse,
    StudentRecordPeriodOptionsResponse,
    StudentRecordRosterResponse,
    TermGradeSummaryResponse,
)
from app.services.export.ClassRecordExportService import (
    export_class_record_full_workbook,
    export_class_record_single_term,
)
from app.services.student_record.StudentRecordService import (
    bulk_send_grades_to_adviser,
    finalize_student_period_grade,
    send_student_grade_to_adviser,
    teacher_period_options,
    teacher_student_gradebook,
    teacher_student_record_detail,
    teacher_student_roster,
    teacher_term_grade_summary,
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
    )


@router.get("/teacher/periods", response_model=StudentRecordPeriodOptionsResponse)
def get_teacher_record_periods(
    class_id: int | None = Query(None),
    subject_id: int | None = Query(None),
    academic_year_id: int | None = Query(None),
    _teacher: dict = Depends(require_role("teacher", "admin")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    role = _teacher.get("role", "teacher") if isinstance(_teacher, dict) else "teacher"
    return teacher_period_options(
        db,
        staff_id,
        class_id,
        subject_id,
        academic_year_id=academic_year_id,
        role=role,
    )


@router.get(
    "/teacher/classes/{class_id}/subjects/{subject_id}/roster",
    response_model=StudentRecordRosterResponse,
)
def get_teacher_student_roster(
    class_id: int,
    subject_id: int,
    academic_period_id: int | None = Query(None),
    academic_year_id: int | None = Query(None),
    _teacher: dict = Depends(require_role("teacher", "admin")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    role = _teacher.get("role", "teacher") if isinstance(_teacher, dict) else "teacher"
    return teacher_student_roster(
        db,
        staff_id,
        class_id,
        subject_id,
        academic_period_id,
        academic_year_id=academic_year_id,
        role=role,
    )


@router.get(
    "/teacher/classes/{class_id}/subjects/{subject_id}/students/{student_id}",
    response_model=StudentRecordDetailResponse,
)
def get_teacher_student_record_detail(
    class_id: int,
    subject_id: int,
    student_id: UUID,
    academic_period_id: int | None = Query(None),
    academic_year_id: int | None = Query(None),
    _teacher: dict = Depends(require_role("teacher", "admin")),
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
        academic_year_id=academic_year_id,
    )


@router.get(
    "/teacher/classes/{class_id}/subjects/{subject_id}/gradebook",
    response_model=StudentGradebookResponse,
)
def get_teacher_student_gradebook(
    class_id: int,
    subject_id: int,
    academic_period_id: int | None = Query(None),
    academic_year_id: int | None = Query(None),
    _teacher: dict = Depends(require_role("teacher", "admin")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    role = _teacher.get("role", "teacher") if isinstance(_teacher, dict) else "teacher"
    return teacher_student_gradebook(
        db,
        staff_id=staff_id,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
        academic_year_id=academic_year_id,
        role=role,
    )


@router.get(
    "/teacher/classes/{class_id}/subjects/{subject_id}/export-class-record",
)
def export_teacher_class_record(
    class_id: int,
    subject_id: int,
    academic_period_id: int = Query(...),
    academic_year_id: int | None = Query(None),
    _teacher: dict = Depends(require_role("teacher", "admin")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    from app.models.academic.Class_ import Class
    from fastapi import HTTPException
    class_obj = db.get(Class, class_id)
    if not class_obj:
        raise HTTPException(status_code=404, detail="Class not found")
    if academic_year_id is not None and class_obj.academic_year_id != academic_year_id:
        raise HTTPException(status_code=400, detail="Academic year does not match class academic year")
    stream, filename = export_class_record_single_term(
        db=db,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
        staff_id=staff_id,
    )
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.get(
    "/teacher/classes/{class_id}/subjects/{subject_id}/export-class-record-workbook",
)
def export_teacher_class_record_workbook(
    class_id: int,
    subject_id: int,
    academic_year_id: int | None = Query(None),
    _teacher: dict = Depends(require_role("teacher", "admin")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    from app.models.academic.Class_ import Class
    from fastapi import HTTPException
    class_obj = db.get(Class, class_id)
    if not class_obj:
        raise HTTPException(status_code=404, detail="Class not found")
    if academic_year_id is not None and class_obj.academic_year_id != academic_year_id:
        raise HTTPException(status_code=400, detail="Academic year does not match class academic year")
    stream, filename = export_class_record_full_workbook(
        db=db,
        class_id=class_id,
        subject_id=subject_id,
        academic_year_id=academic_year_id,
        staff_id=staff_id,
    )
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.get(
    "/teacher/classes/{class_id}/subjects/{subject_id}/term-summary",
    response_model=TermGradeSummaryResponse,
)
def get_teacher_term_grade_summary(
    class_id: int,
    subject_id: int,
    academic_year_id: int | None = Query(None),
    _teacher: dict = Depends(require_role("teacher", "admin")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    role = _teacher.get("role", "teacher") if isinstance(_teacher, dict) else "teacher"
    return teacher_term_grade_summary(
        db,
        staff_id=staff_id,
        class_id=class_id,
        subject_id=subject_id,
        academic_year_id=academic_year_id,
        role=role,
    )


@router.post(
    "/teacher/classes/{class_id}/subjects/{subject_id}/students/{student_id}/send-to-adviser",
    response_model=SendGradeToAdviserItemResponse,
)
def send_student_grade(
    class_id: int,
    subject_id: int,
    student_id: UUID,
    payload: SendStudentGradeRequest,
    _teacher: dict = Depends(require_role("teacher")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return send_student_grade_to_adviser(
        db=db,
        staff_id=staff_id,
        class_id=class_id,
        subject_id=subject_id,
        student_id=student_id,
        payload=payload,
    )


@router.post(
    "/teacher/classes/{class_id}/subjects/{subject_id}/periods/{academic_period_id}/send-to-adviser",
    response_model=BulkSendGradesToAdviserResponse,
)
def bulk_send_grades(
    class_id: int,
    subject_id: int,
    academic_period_id: int,
    payload: BulkSendGradesRequest,
    _teacher: dict = Depends(require_role("teacher")),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return bulk_send_grades_to_adviser(
        db=db,
        staff_id=staff_id,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
        payload=payload,
    )



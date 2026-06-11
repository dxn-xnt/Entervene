from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy.orm import Session

from app.core.Dependencies import require_role
from app.db.Session import get_db
from app.schemas.Class import (
    ArchiveClassResponse,
    BatchCreateClassesRequest,
    BatchCreateClassesResponse,
    ClassDetailResponse,
    ClassListResponse,
    ClassFormOptionsResponse,
    ClassStudentListResponse,
    ClassTransferOptionsResponse,
    ClassUpdateRequest,
    UpdateClassStudentListRequest,
    UnassignedStudentsResponse,
    ValidateClassImportResponse,
)
from app.services.classes.ClassService import archive_class_record, batch_create_classes, update_class_record
from app.services.classes.ClassImportService import validate_class_import_file
from app.services.classes.ClassQueryService import (
    get_class_detail_data,
    get_class_form_options_data,
    get_class_students_data,
    get_class_transfer_options_data,
    get_unassigned_students_data,
    list_classes_data,
)
from app.services.classes.ClassStudentService import update_class_student_assignments

router = APIRouter()


@router.get("/form-options", response_model=ClassFormOptionsResponse)
def get_class_form_options(
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return get_class_form_options_data(db=db)


@router.get("", response_model=ClassListResponse)
def list_classes(
    status: str = Query("active", pattern="^(active|archived)$"),
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return list_classes_data(db=db, status=status)


@router.post("/batch-create", response_model=BatchCreateClassesResponse, status_code=201)
def create_classes_batch(
    payload: BatchCreateClassesRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return batch_create_classes(db, payload)


@router.post("/validate-import", response_model=ValidateClassImportResponse)
async def validate_class_import(
    file: UploadFile = File(...),
    academic_level_id: int = Form(...),
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return await validate_class_import_file(
        db=db,
        file=file,
        academic_level_id=academic_level_id,
    )


@router.get("/unassigned-students", response_model=UnassignedStudentsResponse)
def get_unassigned_students(
    academic_level_id: int = Query(...),
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return get_unassigned_students_data(db=db, academic_level_id=academic_level_id)


@router.get("/{class_id}/students", response_model=ClassStudentListResponse)
def get_class_students(
    class_id: int,
    search: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return get_class_students_data(db=db, class_id=class_id, search=search, page=page, page_size=page_size)


@router.get("/{class_id}/transfer-options", response_model=ClassTransferOptionsResponse)
def get_class_transfer_options(
    class_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return get_class_transfer_options_data(db=db, class_id=class_id)


@router.patch("/{class_id}/students", response_model=ClassStudentListResponse)
def update_class_students(
    class_id: int,
    payload: UpdateClassStudentListRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    update_class_student_assignments(db=db, class_id=class_id, payload=payload)
    return get_class_students_data(db=db, class_id=class_id, page=1, page_size=200)


@router.get("/{class_id}", response_model=ClassDetailResponse)
def get_class_detail(
    class_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return get_class_detail_data(db=db, class_id=class_id)


@router.patch("/{class_id}/archive", response_model=ArchiveClassResponse)
def archive_class(
    class_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return archive_class_record(db=db, class_id=class_id)


@router.patch("/{class_id}", response_model=ClassDetailResponse)
def update_class(
    class_id: int,
    payload: ClassUpdateRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return update_class_record(db=db, class_id=class_id, payload=payload)

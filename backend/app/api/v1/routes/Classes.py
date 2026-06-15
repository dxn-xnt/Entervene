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

# CLASS MANAGEMENT FLOW
# 1. The admin frontend sends a request to one of the endpoints in this file.
# 2. require_role("admin") blocks non-admin users before the endpoint runs.
# 3. The route delegates business rules and database work to a class service:
#    - ClassQueryService: read class, adviser, and student data
#    - ClassService: create, update, and archive classes
#    - ClassImportService: validate a CSV and prepare an import preview
#    - ClassStudentService: add, remove, or transfer students
# 4. The response_model validates the final response returned to the frontend.
router = APIRouter()


# Data used by the admin class-creation form: active year, levels, and advisers.
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


# Class creation has two entry paths. Manual creation sends this payload
# directly; CSV creation first calls /validate-import, then sends its preview here.
@router.post("/batch-create", response_model=BatchCreateClassesResponse, status_code=201)
def create_classes_batch(
    payload: BatchCreateClassesRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return batch_create_classes(db, payload)


# CSV validation does not create classes. It returns a clean preview that the
# admin can review before submitting it to /batch-create.
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


# These students can be selected during class creation because they do not yet
# have a class assignment in the active academic year.
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


# One request may add, remove, and transfer students; the service commits those
# roster changes as a single transaction.
@router.patch("/{class_id}/students", response_model=ClassStudentListResponse)
def update_class_students(
    class_id: int,
    payload: UpdateClassStudentListRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    # Return a fresh class roster so the admin UI receives the committed state,
    # including transfers and additions, without issuing a second request.
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

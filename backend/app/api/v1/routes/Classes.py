from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.Dependencies import require_role
from app.db.Session import get_db
from app.models.academic.Class_ import Class
from app.models.people.AcademicStaff import AcademicStaff
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
from app.services.classes.ClassService import batch_create_classes
from app.services.classes.ClassShared import (
    eligible_advisers_query,
    normalized_text,
    readable_text,
)
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


def _get_class_or_404(db: Session, class_id: int) -> Class:
    class_ = db.query(Class).filter(Class.class_id == class_id).first()
    if class_ is None:
        raise HTTPException(status_code=404, detail="Class not found.")
    return class_

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
    class_ = _get_class_or_404(db, class_id)
    if normalized_text(class_.class_status or "active") == "archived":
        raise HTTPException(status_code=409, detail="Class is already archived.")

    class_.class_status = "archived"
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Unable to archive class.")
    db.refresh(class_)

    return {
        "class_id": class_.class_id,
        "section_name": class_.section_name,
        "class_status": class_.class_status,
        "message": "Class archived successfully.",
    }


@router.patch("/{class_id}", response_model=ClassDetailResponse)
def update_class(
    class_id: int,
    payload: ClassUpdateRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="Provide at least one editable field.")

    class_ = db.query(Class).filter(Class.class_id == class_id).first()
    if class_ is None:
        raise HTTPException(status_code=404, detail="Class not found.")
    if normalized_text(class_.class_status or "active") == "archived":
        raise HTTPException(
            status_code=409,
            detail="Archived classes cannot be modified. Restore the class before editing.",
        )

    if "section_name" in changes:
        section_name = readable_text(changes["section_name"])
        if not section_name:
            raise HTTPException(status_code=400, detail="Section name is required.")
        duplicate = (
            db.query(Class.class_id)
            .filter(Class.class_id != class_.class_id)
            .filter(Class.academic_year_id == class_.academic_year_id)
            .filter(Class.academic_level_id == class_.academic_level_id)
            .filter(func.lower(Class.section_name) == section_name.lower())
            .first()
        )
        if duplicate:
            raise HTTPException(
                status_code=409,
                detail="A class with the same section and academic configuration already exists.",
            )
        class_.section_name = section_name

    if "adviser_staff_id" in changes:
        adviser_staff_id = changes["adviser_staff_id"]
        if adviser_staff_id is None or readable_text(adviser_staff_id) == "":
            class_.adviser_staff_id = None
        else:
            adviser_staff_id = readable_text(adviser_staff_id)
            adviser = (
                eligible_advisers_query(db)
                .filter(AcademicStaff.staff_id == adviser_staff_id)
                .first()
            )
            if adviser is None:
                raise HTTPException(status_code=400, detail="Adviser not found.")
            assigned_elsewhere = (
                db.query(Class.class_id)
                .filter(Class.class_id != class_.class_id)
                .filter(Class.academic_year_id == class_.academic_year_id)
                .filter(Class.adviser_staff_id == adviser_staff_id)
                .first()
            )
            if assigned_elsewhere:
                raise HTTPException(
                    status_code=409,
                    detail="This adviser is already assigned to another class in this academic year.",
                )
            class_.adviser_staff_id = adviser_staff_id

    db.commit()
    db.refresh(class_)
    return get_class_detail_data(db=db, class_id=class_.class_id)

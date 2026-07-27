from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.Dependencies import require_role
from app.db.Session import get_db
from app.schemas.Subject import (
    SubjectCreate,
    SubjectFormOptions,
    SubjectImportResponse,
    SubjectListResponse,
    SubjectResponse,
    SubjectUpdate,
)
from app.services.subjects.SubjectImportService import (
    import_subject_catalog_csv,
    subject_import_template_csv,
)
from app.services.subjects.SubjectQueryService import (
    get_subject_detail_data,
    get_subject_form_options_data,
    list_subjects_data,
)
from app.services.subjects.SubjectService import (
    archive_subject_record,
    create_subject_record,
    restore_subject_record,
    update_subject_record,
)


router = APIRouter()


@router.get("/form-options", response_model=SubjectFormOptions)
def get_subject_form_options(
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return get_subject_form_options_data(db=db)


@router.get("", response_model=SubjectListResponse)
def list_subjects(
    status: str | None = Query(None),
    academic_level_id: int | None = Query(None),
    subject_group: str | None = Query(None),
    search: str = "",
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return list_subjects_data(
        db=db,
        status=status,
        academic_level_id=academic_level_id,
        subject_group=subject_group,
        search=search,
    )


@router.get("/import-template")
def download_subject_import_template(
    current_user: dict = Depends(require_role("admin")),
):
    return Response(
        content=subject_import_template_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="subject_catalog_import_template.csv"'},
    )


@router.post("/import", response_model=SubjectImportResponse)
async def import_subjects(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return await import_subject_catalog_csv(db=db, file=file)


@router.get("/{subject_id}", response_model=SubjectResponse)
def get_subject_detail(
    subject_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return get_subject_detail_data(db=db, subject_id=subject_id)


@router.post("", response_model=SubjectResponse, status_code=201)
def create_subject(
    payload: SubjectCreate,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return create_subject_record(db=db, payload=payload)


@router.patch("/{subject_id}", response_model=SubjectResponse)
def update_subject(
    subject_id: int,
    payload: SubjectUpdate,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return update_subject_record(db=db, subject_id=subject_id, payload=payload)


@router.patch("/{subject_id}/archive", response_model=SubjectResponse)
def archive_subject(
    subject_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return archive_subject_record(db=db, subject_id=subject_id)


@router.patch("/{subject_id}/restore", response_model=SubjectResponse)
def restore_subject(
    subject_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return restore_subject_record(db=db, subject_id=subject_id)

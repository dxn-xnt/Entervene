from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app.core.Dependencies import require_role
from app.db.Session import get_db
from app.schemas.SubjectOffering import (
    SubjectOfferingCopyAcademicYearRequest,
    SubjectOfferingCopyAcademicYearResponse,
    SubjectOfferingCreate,
    SubjectOfferingFormOptions,
    SubjectOfferingImportResponse,
    SubjectOfferingListResponse,
    SubjectOfferingResponse,
    SubjectOfferingUpdate,
)
from app.services.subject_offerings.SubjectOfferingImportService import (
    import_subject_offering_csv,
    subject_offering_import_template_csv,
)
from app.services.subject_offerings.SubjectOfferingQueryService import (
    get_subject_offering_detail_data,
    get_subject_offering_form_options_data,
    list_subject_offerings_data,
)
from app.services.subject_offerings.SubjectOfferingService import (
    archive_subject_offering_record,
    copy_subject_offerings_between_academic_years,
    create_subject_offering_record,
    restore_subject_offering_record,
    update_subject_offering_record,
)


router = APIRouter()


@router.get("/form-options", response_model=SubjectOfferingFormOptions)
def get_subject_offering_form_options(
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return get_subject_offering_form_options_data(db=db)


@router.get("", response_model=SubjectOfferingListResponse)
def list_subject_offerings(
    academic_year_id: int | None = Query(None),
    academic_level_id: int | None = Query(None),
    academic_period_id: int | None = Query(None),
    pathway: str | None = Query(None),
    status: str | None = Query(None),
    search: str = "",
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return list_subject_offerings_data(
        db=db,
        academic_year_id=academic_year_id,
        academic_level_id=academic_level_id,
        academic_period_id=academic_period_id,
        pathway=pathway,
        status=status,
        search=search,
    )


@router.get("/import-template")
def download_subject_offering_import_template(
    current_user: dict = Depends(require_role("admin")),
):
    return Response(
        content=subject_offering_import_template_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="subject_offering_import_template.csv"'},
    )


@router.post("/import", response_model=SubjectOfferingImportResponse)
async def import_subject_offerings(
    file: UploadFile = File(...),
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return await import_subject_offering_csv(db=db, file=file)


@router.post("/copy-academic-year", response_model=SubjectOfferingCopyAcademicYearResponse)
def copy_subject_offerings_from_academic_year(
    payload: SubjectOfferingCopyAcademicYearRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return copy_subject_offerings_between_academic_years(db=db, payload=payload)


@router.get("/{subject_offering_id}", response_model=SubjectOfferingResponse)
def get_subject_offering_detail(
    subject_offering_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return get_subject_offering_detail_data(db=db, subject_offering_id=subject_offering_id)


@router.post("", response_model=SubjectOfferingResponse, status_code=201)
def create_subject_offering(
    payload: SubjectOfferingCreate,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return create_subject_offering_record(db=db, payload=payload)


@router.patch("/{subject_offering_id}", response_model=SubjectOfferingResponse)
def update_subject_offering(
    subject_offering_id: int,
    payload: SubjectOfferingUpdate,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return update_subject_offering_record(db=db, subject_offering_id=subject_offering_id, payload=payload)


@router.patch("/{subject_offering_id}/archive", response_model=SubjectOfferingResponse)
def archive_subject_offering(
    subject_offering_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return archive_subject_offering_record(db=db, subject_offering_id=subject_offering_id)


@router.patch("/{subject_offering_id}/restore", response_model=SubjectOfferingResponse)
def restore_subject_offering(
    subject_offering_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return restore_subject_offering_record(db=db, subject_offering_id=subject_offering_id)

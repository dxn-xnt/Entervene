from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.Dependencies import require_role
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
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
from app.services.ClassManagement import (
    ClassManagementError,
    available_advisers_query,
    batch_create_classes,
    eligible_advisers_query,
    normalized_text,
    readable_text,
    resolve_active_academic_year,
    student_sort_key,
)
from app.services.classes.ClassImportService import validate_class_import_file
from app.services.classes.ClassStudentService import update_class_student_assignments

router = APIRouter()


def _academic_year_option(academic_year) -> dict:
    return {
        "academic_year_id": academic_year.academic_year_id,
        "year_label": academic_year.year_label,
    }


def _academic_level_option(academic_level) -> dict:
    return {
        "academic_level_id": academic_level.academic_level_id,
        "level_name": academic_level.level_name,
        "grade_level": academic_level.grade_level,
    }


def _adviser_option(adviser) -> dict | None:
    if adviser is None:
        return None
    return {
        "staff_id": adviser.staff_id,
        "first_name": adviser.first_name,
        "middle_name": adviser.middle_name,
        "last_name": adviser.last_name,
        "suffix": adviser.suffix,
    }


def _class_detail_response(db: Session, class_id: int) -> dict:
    class_row = (
        db.query(Class, AcademicLevel, AcademicYear, AcademicStaff)
        .join(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
        .join(AcademicYear, Class.academic_year_id == AcademicYear.academic_year_id)
        .outerjoin(AcademicStaff, Class.adviser_staff_id == AcademicStaff.staff_id)
        .filter(Class.class_id == class_id)
        .first()
    )
    if class_row is None:
        raise HTTPException(status_code=404, detail="Class not found.")

    class_, academic_level, academic_year, adviser = class_row
    student_count = (
        db.query(func.count(StudentClass.student_class_id))
        .filter(StudentClass.class_id == class_.class_id)
        .scalar()
    )
    subject_count = (
        db.query(func.count(SubjectLoad.subject_load_id))
        .filter(SubjectLoad.class_id == class_.class_id)
        .scalar()
    )

    return {
        "class_id": class_.class_id,
        "section_name": class_.section_name,
        "class_status": readable_text(class_.class_status) or "active",
        "created_at": class_.created_at,
        "academic_year": _academic_year_option(academic_year),
        "academic_level": _academic_level_option(academic_level),
        "adviser": _adviser_option(adviser),
        "statistics": {
            "student_count": int(student_count or 0),
            "subject_count": int(subject_count or 0),
            "schedule_count": 0,
        },
    }


def _student_full_name(student: Student) -> str:
    first_name = readable_text(student.first_name)
    middle_name = readable_text(student.middle_name)
    last_name = readable_text(student.last_name)
    suffix = readable_text(student.suffix)
    middle_initial = f"{middle_name[:1].upper()}." if middle_name else ""
    given_name = " ".join(part for part in [first_name, middle_initial] if part)
    family_name = " ".join(part for part in [last_name, suffix] if part)
    if family_name and given_name:
        return f"{family_name}, {given_name}"
    return family_name or given_name


def _student_gender_group(value) -> str:
    gender = normalized_text(value)
    if gender in {"female", "f", "girl"}:
        return "Female"
    if gender in {"male", "m", "boy"}:
        return "Male"
    if gender:
        return "Other"
    return "Unspecified"


def _gender_count_key(group: str) -> str:
    if group == "Female":
        return "female"
    if group == "Male":
        return "male"
    if group == "Other":
        return "other"
    return "unspecified"


def _student_list_item(student: Student) -> dict:
    full_name = _student_full_name(student)
    return {
        "student_id": student.student_id,
        "full_name": full_name,
        "gender": _student_gender_group(student.gender),
        "avatar_initial": (readable_text(student.first_name)[:1] or "?").upper(),
    }


def _get_class_or_404(db: Session, class_id: int) -> Class:
    class_ = db.query(Class).filter(Class.class_id == class_id).first()
    if class_ is None:
        raise HTTPException(status_code=404, detail="Class not found.")
    return class_


def _active_class_filter():
    return func.lower(func.coalesce(Class.class_status, "active")) != "archived"


@router.get("/form-options", response_model=ClassFormOptionsResponse)
def get_class_form_options(
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    academic_year = resolve_active_academic_year(db)

    academic_levels = (
        db.query(AcademicLevel)
        .order_by(AcademicLevel.grade_level, func.lower(AcademicLevel.level_name))
        .all()
    )
    eligible_advisers = (
        available_advisers_query(db, academic_year.academic_year_id)
        .order_by(
            func.lower(AcademicStaff.last_name),
            func.lower(AcademicStaff.first_name),
            func.lower(func.coalesce(AcademicStaff.middle_name, "")),
        )
        .all()
    )

    return {
        "academic_year": _academic_year_option(academic_year),
        "academic_levels": [_academic_level_option(level) for level in academic_levels],
        "eligible_advisers": [
            {
                "staff_id": adviser.staff_id,
                "first_name": adviser.first_name,
                "middle_name": adviser.middle_name,
                "last_name": adviser.last_name,
                "suffix": adviser.suffix,
            }
            for adviser in eligible_advisers
        ],
    }


@router.get("", response_model=ClassListResponse)
def list_classes(
    status: str = Query("active", pattern="^(active|archived)$"),
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    requested_status = normalized_text(status)
    class_rows = (
        db.query(
            Class,
            AcademicLevel,
            AcademicYear,
            AcademicStaff,
            func.count(StudentClass.student_class_id).label("student_count"),
        )
        .join(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
        .join(AcademicYear, Class.academic_year_id == AcademicYear.academic_year_id)
        .outerjoin(AcademicStaff, Class.adviser_staff_id == AcademicStaff.staff_id)
        .outerjoin(StudentClass, Class.class_id == StudentClass.class_id)
        .group_by(Class.class_id, AcademicLevel.academic_level_id, AcademicYear.academic_year_id, AcademicStaff.staff_id)
        .order_by(AcademicLevel.grade_level, func.lower(Class.section_name))
        .all()
    )

    classes = []
    total_students = 0
    active_classes = 0
    archived_classes = 0
    for class_, academic_level, academic_year, adviser, student_count in class_rows:
        count = int(student_count or 0)
        total_students += count
        class_status = readable_text(class_.class_status) or "active"
        normalized_status = normalized_text(class_status)
        if normalized_status == "active":
            active_classes += 1
        elif normalized_status == "archived":
            archived_classes += 1

        if normalized_status == requested_status:
            classes.append({
                "class_id": class_.class_id,
                "section_name": class_.section_name,
                "class_status": class_status,
                "academic_year": _academic_year_option(academic_year),
                "academic_level": _academic_level_option(academic_level),
                "adviser": None if adviser is None else {
                    "staff_id": adviser.staff_id,
                    "first_name": adviser.first_name,
                    "middle_name": adviser.middle_name,
                    "last_name": adviser.last_name,
                    "suffix": adviser.suffix,
                },
                "student_count": count,
                "subject_count": 0,
            })

    return {
        "summary": {
            "total_classes": len(class_rows),
            "active_classes": active_classes,
            "archived_classes": archived_classes,
            "students_assigned": total_students,
        },
        "classes": classes,
    }


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
    academic_year = resolve_active_academic_year(db)
    academic_level = (
        db.query(AcademicLevel)
        .filter(AcademicLevel.academic_level_id == academic_level_id)
        .first()
    )
    if not academic_level:
        raise ClassManagementError(
            status_code=404,
            message="Request validation failed.",
            code="validation_failed",
            errors=[
                {
                    "row": None,
                    "field": "academic_level_id",
                    "code": "academic_level_not_found",
                    "message": f"Academic level {academic_level_id} does not exist.",
                }
            ],
        )

    assigned_in_active_year = (
        db.query(StudentClass.student_class_id)
        .join(Class, StudentClass.class_id == Class.class_id)
        .filter(StudentClass.student_id == Student.student_id)
        .filter(Class.academic_year_id == academic_year.academic_year_id)
        .exists()
    )
    students = (
        db.query(Student)
        .filter(Student.academic_level_id == academic_level_id)
        .filter(~assigned_in_active_year)
        .all()
    )
    students.sort(key=student_sort_key)

    return {
        "academic_level": _academic_level_option(academic_level),
        "academic_year": _academic_year_option(academic_year),
        "students": [
            {
                "student_id": student.student_id,
                "student_lrn": student.student_lrn,
                "first_name": student.first_name,
                "middle_name": student.middle_name,
                "last_name": student.last_name,
                "gender": student.gender,
                "academic_level_id": student.academic_level_id,
            }
            for student in students
        ],
    }


@router.get("/{class_id}/students", response_model=ClassStudentListResponse)
def get_class_students(
    class_id: int,
    search: str = "",
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=200),
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    class_row = (
        db.query(Class, AcademicLevel)
        .join(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
        .filter(Class.class_id == class_id)
        .first()
    )
    if class_row is None:
        raise HTTPException(status_code=404, detail="Class not found.")

    class_, academic_level = class_row
    rows = (
        db.query(Student)
        .join(StudentClass, Student.student_id == StudentClass.student_id)
        .filter(StudentClass.class_id == class_.class_id)
        .filter(StudentClass.academic_year_id == class_.academic_year_id)
        .all()
    )

    items = [_student_list_item(student) for student in rows]
    search_term = normalized_text(search)
    if search_term:
        items = [item for item in items if search_term in normalized_text(item["full_name"])]

    items.sort(key=lambda item: item["full_name"].casefold())
    gender_counts = {"female": 0, "male": 0, "other": 0, "unspecified": 0}
    for item in items:
        gender_counts[_gender_count_key(item["gender"])] += 1

    total_items = len(items)
    total_pages = max((total_items + page_size - 1) // page_size, 1)
    start = (page - 1) * page_size
    paged_items = items[start:start + page_size]

    return {
        "class_id": class_.class_id,
        "section_name": class_.section_name,
        "academic_level": {
            "academic_level_id": academic_level.academic_level_id,
            "level_name": academic_level.level_name,
        },
        "summary": {
            "total_students": total_items,
            "gender_counts": gender_counts,
        },
        "students": paged_items,
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_items": total_items,
            "total_pages": total_pages,
        },
    }


@router.get("/{class_id}/transfer-options", response_model=ClassTransferOptionsResponse)
def get_class_transfer_options(
    class_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    class_row = (
        db.query(Class, AcademicLevel)
        .join(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
        .filter(Class.class_id == class_id)
        .first()
    )
    if class_row is None:
        raise HTTPException(status_code=404, detail="Class not found.")

    class_, academic_level = class_row
    sections = (
        db.query(Class)
        .filter(Class.class_id != class_.class_id)
        .filter(Class.academic_level_id == class_.academic_level_id)
        .filter(Class.academic_year_id == class_.academic_year_id)
        .filter(_active_class_filter())
        .order_by(func.lower(Class.section_name))
        .all()
    )

    return {
        "current_class_id": class_.class_id,
        "academic_level": {
            "academic_level_id": academic_level.academic_level_id,
            "level_name": academic_level.level_name,
        },
        "available_sections": [
            {"class_id": section.class_id, "section_name": section.section_name}
            for section in sections
        ],
    }


@router.patch("/{class_id}/students", response_model=ClassStudentListResponse)
def update_class_students(
    class_id: int,
    payload: UpdateClassStudentListRequest,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    update_class_student_assignments(db=db, class_id=class_id, payload=payload)
    return get_class_students(class_id=class_id, page=1, page_size=200, current_user=current_user, db=db)


@router.get("/{class_id}", response_model=ClassDetailResponse)
def get_class_detail(
    class_id: int,
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
    return _class_detail_response(db, class_id)


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
    return _class_detail_response(db, class_.class_id)

import re

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.Dependencies import require_role
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.schemas.Class import (
    BatchCreateClassesRequest,
    BatchCreateClassesResponse,
    ClassListResponse,
    ClassFormOptionsResponse,
    UnassignedStudentsResponse,
    ValidateClassImportResponse,
)
from app.services.ClassManagement import (
    ClassManagementError,
    available_advisers_query,
    batch_create_classes,
    csv_validation_error,
    eligible_advisers_query,
    normalized_import_row,
    normalized_middle_name,
    normalized_text,
    raise_csv_validation_errors,
    read_class_import_rows,
    readable_text,
    resolve_active_academic_year,
    student_sort_key,
)

router = APIRouter()
SCIENTIFIC_NOTATION_PATTERN = re.compile(r"^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$")


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
    current_user: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
):
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
        status = readable_text(class_.class_status) or "active"
        normalized_status = normalized_text(status)
        if normalized_status == "active":
            active_classes += 1
        elif normalized_status == "archived":
            archived_classes += 1

        classes.append({
            "class_id": class_.class_id,
            "section_name": class_.section_name,
            "class_status": status,
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
            "total_classes": len(classes),
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

    rows = await read_class_import_rows(file)
    errors: list[dict] = []
    seen_rows: dict[tuple[str, ...], int] = {}
    seen_lrns: dict[str, int] = {}

    adviser_ids = {row["adviser_staff_id"] for _, row in rows if row["adviser_staff_id"]}
    student_lrns = {row["student_lrn"] for _, row in rows if row["student_lrn"]}
    advisers = {
        adviser.staff_id: adviser
        for adviser in db.query(AcademicStaff).filter(AcademicStaff.staff_id.in_(adviser_ids)).all()
    } if adviser_ids else {}
    eligible_adviser_ids = {
        adviser.staff_id
        for adviser in eligible_advisers_query(db).filter(AcademicStaff.staff_id.in_(adviser_ids)).all()
    } if adviser_ids else set()
    assigned_adviser_ids = {
        adviser_id
        for adviser_id, in (
            db.query(Class.adviser_staff_id)
            .filter(Class.academic_year_id == academic_year.academic_year_id)
            .filter(Class.adviser_staff_id.in_(adviser_ids))
            .all()
        )
    } if adviser_ids else set()
    students = {
        student.student_lrn: student
        for student in db.query(Student).filter(Student.student_lrn.in_(student_lrns)).all()
    } if student_lrns else {}
    assigned_lrns = {
        row.student_lrn
        for row in (
            db.query(Student.student_lrn)
            .join(StudentClass, Student.student_id == StudentClass.student_id)
            .filter(StudentClass.academic_year_id == academic_year.academic_year_id)
            .filter(Student.student_lrn.in_(student_lrns))
            .all()
        )
    } if student_lrns else set()
    existing_sections = {
        normalized_text(section_name)
        for section_name, in (
            db.query(Class.section_name)
            .filter(Class.academic_year_id == academic_year.academic_year_id)
            .filter(Class.academic_level_id == academic_level_id)
            .all()
        )
    }

    grouped: dict[str, dict] = {}
    imported_adviser_sections: dict[str, str] = {}
    for row_number, row in rows:
        row_error_count = len(errors)
        row_key = normalized_import_row(row)
        if row_key in seen_rows:
            errors.append(
                csv_validation_error(
                    "duplicate_row",
                    f"Row duplicates CSV row {seen_rows[row_key]}.",
                    row_number,
                    None,
                )
            )
        else:
            seen_rows[row_key] = row_number

        section_name = readable_text(row["section_name"])
        section_key = normalized_text(section_name)
        if not section_name:
            errors.append(csv_validation_error(
                "section_name_required", "Section name is required.", row_number, "section_name"
            ))
        elif section_key in existing_sections:
            errors.append(csv_validation_error(
                "section_already_exists",
                f'Section "{section_name}" already exists for the selected academic level and active academic year.',
                row_number,
                "section_name",
            ))

        grade_level = readable_text(row["grade_level"])
        if not grade_level:
            errors.append(csv_validation_error(
                "missing_required_field", "Grade level is required.", row_number, "grade_level"
            ))
        elif not grade_level.isdecimal():
            errors.append(csv_validation_error(
                "invalid_grade_level", "Grade level must be a whole number.", row_number, "grade_level"
            ))
        elif int(grade_level) != academic_level.grade_level:
            errors.append(csv_validation_error(
                "academic_level_mismatch",
                f"CSV grade level {int(grade_level)} does not match the selected academic level {academic_level.level_name}.",
                row_number,
                "grade_level",
            ))

        adviser_id = readable_text(row["adviser_staff_id"])
        adviser = advisers.get(adviser_id)
        if not adviser_id:
            errors.append(csv_validation_error(
                "adviser_staff_id_required", "Adviser staff ID is required.", row_number, "adviser_staff_id"
            ))
        elif not adviser:
            errors.append(csv_validation_error(
                "adviser_not_found", f'No adviser exists with staff ID "{adviser_id}".', row_number, "adviser_staff_id"
            ))
        elif adviser_id not in eligible_adviser_ids:
            errors.append(csv_validation_error(
                "adviser_not_eligible", f'Adviser "{adviser_id}" is not eligible.', row_number, "adviser_staff_id"
            ))
        elif adviser_id in assigned_adviser_ids:
            errors.append(csv_validation_error(
                "adviser_already_assigned",
                f'Adviser "{adviser_id}" is already assigned during the active academic year.',
                row_number,
                "adviser_staff_id",
            ))
        elif (
            normalized_text(row["adviser_first_name"]) != normalized_text(adviser.first_name)
            or normalized_middle_name(row["adviser_middle_name"]) != normalized_middle_name(adviser.middle_name)
            or normalized_text(row["adviser_last_name"]) != normalized_text(adviser.last_name)
        ):
            errors.append(csv_validation_error(
                "adviser_name_mismatch",
                f'Adviser name does not match adviser staff ID "{adviser_id}".',
                row_number,
                "adviser_staff_id",
            ))

        adviser_signature = (
            adviser_id.casefold(),
            normalized_text(row["adviser_first_name"]),
            normalized_middle_name(row["adviser_middle_name"]),
            normalized_text(row["adviser_last_name"]),
        )
        if section_key:
            previous_section = imported_adviser_sections.get(adviser_id)
            if adviser_id and previous_section and previous_section != section_key:
                errors.append(csv_validation_error(
                    "duplicate_adviser_assignment",
                    f'Adviser "{adviser_id}" is assigned to multiple imported sections.',
                    row_number,
                    "adviser_staff_id",
                ))
            elif adviser_id:
                imported_adviser_sections[adviser_id] = section_key
            section = grouped.setdefault(
                section_key,
                {
                    "section_name": section_name,
                    "adviser_signature": adviser_signature,
                    "adviser": adviser,
                    "students": [],
                },
            )
            if section["adviser_signature"] != adviser_signature:
                errors.append(csv_validation_error(
                    "conflicting_section_adviser",
                    f'Section "{section["section_name"]}" uses conflicting adviser information.',
                    row_number,
                    "adviser_staff_id",
                ))

        student_lrn = readable_text(row["student_lrn"])
        student = students.get(student_lrn)
        if not student_lrn:
            errors.append(csv_validation_error(
                "student_lrn_required", "Student LRN is required.", row_number, "student_lrn"
            ))
        elif SCIENTIFIC_NOTATION_PATTERN.fullmatch(student_lrn):
            errors.append(csv_validation_error(
                "student_lrn_scientific_notation",
                "Student LRN was converted to scientific notation by spreadsheet software. Use the complete 12-digit LRN and format the student_lrn column as Text before saving the CSV.",
                row_number,
                "student_lrn",
            ))
        elif not (len(student_lrn) == 12 and student_lrn.isdigit()):
            errors.append(csv_validation_error(
                "student_lrn_invalid_format",
                "Student LRN must contain exactly 12 numeric characters.",
                row_number,
                "student_lrn",
            ))
        elif student_lrn in seen_lrns:
            errors.append(csv_validation_error(
                "duplicate_student_lrn",
                f"Student LRN {student_lrn} already appears on CSV row {seen_lrns[student_lrn]}.",
                row_number,
                "student_lrn",
            ))
        else:
            seen_lrns[student_lrn] = row_number

        if student_lrn and len(student_lrn) == 12 and student_lrn.isdigit():
            if not student:
                errors.append(csv_validation_error(
                    "student_not_found", f"No student exists with LRN {student_lrn}.", row_number, "student_lrn"
                ))
            elif student.academic_level_id != academic_level_id:
                errors.append(csv_validation_error(
                    "student_level_mismatch",
                    f"Student LRN {student_lrn} does not belong to the selected academic level.",
                    row_number,
                    "student_lrn",
                ))
            else:
                if (
                    normalized_text(row["student_first_name"]) != normalized_text(student.first_name)
                    or normalized_middle_name(row["student_middle_name"]) != normalized_middle_name(student.middle_name)
                    or normalized_text(row["student_last_name"]) != normalized_text(student.last_name)
                ):
                    errors.append(csv_validation_error(
                        "student_name_mismatch",
                        f"Student name does not match student LRN {student_lrn}.",
                        row_number,
                        "student_lrn",
                    ))
                if normalized_text(row["student_gender"]) != normalized_text(student.gender):
                    errors.append(csv_validation_error(
                        "student_gender_mismatch",
                        f"Student gender does not match student LRN {student_lrn}.",
                        row_number,
                        "student_gender",
                    ))
                if student_lrn in assigned_lrns:
                    errors.append(csv_validation_error(
                        "student_already_assigned",
                        f"Student LRN {student_lrn} is already assigned during the active academic year.",
                        row_number,
                        "student_lrn",
                    ))

        if len(errors) == row_error_count and section_key:
            grouped[section_key]["students"].append(student)

    if errors:
        raise_csv_validation_errors(errors)

    sections = []
    for section in sorted(grouped.values(), key=lambda value: value["section_name"].casefold()):
        adviser = section["adviser"]
        section_students = sorted(section["students"], key=student_sort_key)
        sections.append(
            {
                "section_name": section["section_name"],
                "adviser": {
                    "staff_id": adviser.staff_id,
                    "first_name": adviser.first_name,
                    "middle_name": adviser.middle_name,
                    "last_name": adviser.last_name,
                    "suffix": adviser.suffix,
                },
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
                    for student in section_students
                ],
            }
        )

    return {
        "academic_level": _academic_level_option(academic_level),
        "academic_year": _academic_year_option(academic_year),
        "sections": sections,
        "summary": {
            "section_count": len(sections),
            "student_count": sum(len(section["students"]) for section in sections),
        },
    }


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

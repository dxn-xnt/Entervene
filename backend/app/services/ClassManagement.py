import csv
import io
from typing import Any

from fastapi import Request, UploadFile
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student


CLASS_IMPORT_HEADERS = [
    "section_name",
    "adviser_staff_id",
    "adviser_first_name",
    "adviser_middle_name",
    "adviser_last_name",
    "student_lrn",
    "student_first_name",
    "student_middle_name",
    "student_last_name",
    "student_gender",
]


class ClassManagementError(Exception):
    def __init__(
        self,
        status_code: int,
        message: str,
        code: str,
        errors: list[dict[str, Any]] | None = None,
    ) -> None:
        self.status_code = status_code
        self.payload = {
            "message": message,
            "code": code,
            "errors": errors or [],
        }
        super().__init__(message)


async def class_management_error_handler(
    request: Request,
    exc: ClassManagementError,
) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=exc.payload)


def resolve_active_academic_year(db: Session) -> AcademicYear:
    active_years = (
        db.query(AcademicYear)
        .filter(AcademicYear.is_active.is_(True))
        .limit(2)
        .all()
    )

    if not active_years:
        raise ClassManagementError(
            status_code=409,
            message="Active academic year configuration is invalid.",
            code="active_academic_year_missing",
        )
    if len(active_years) > 1:
        raise ClassManagementError(
            status_code=409,
            message="Active academic year configuration is invalid.",
            code="active_academic_year_multiple",
        )

    return active_years[0]


def eligible_advisers_query(db: Session):
    return (
        db.query(AcademicStaff)
        .join(UserAccount, AcademicStaff.user_id == UserAccount.user_id)
        .join(UserRoles, UserAccount.user_id == UserRoles.user_id)
        .join(Role, UserRoles.role_id == Role.role_id)
        .filter(func.lower(UserAccount.account_status) == "active")
        .filter(Role.role_name == "Teacher")
    )


def available_advisers_query(db: Session, academic_year_id: int):
    assigned_in_year = (
        db.query(Class.class_id)
        .filter(Class.adviser_staff_id == AcademicStaff.staff_id)
        .filter(Class.academic_year_id == academic_year_id)
        .exists()
    )
    return eligible_advisers_query(db).filter(~assigned_in_year)


def readable_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def normalized_text(value: Any) -> str:
    return readable_text(value).casefold()


def normalized_middle_name(value: Any) -> str:
    normalized = normalized_text(value)
    return "" if normalized == "null" else normalized


def normalized_import_row(row: dict[str, Any]) -> tuple[str, ...]:
    return tuple(
        normalized_middle_name(row.get(header))
        if header in {"adviser_middle_name", "student_middle_name"}
        else normalized_text(row.get(header))
        for header in CLASS_IMPORT_HEADERS
    )


def csv_validation_error(
    code: str,
    message: str,
    row: int | None = None,
    field: str | None = None,
) -> dict[str, Any]:
    return {
        "row": row,
        "field": field,
        "code": code,
        "message": message,
    }


def raise_csv_validation_errors(errors: list[dict[str, Any]]) -> None:
    raise ClassManagementError(
        status_code=422,
        message="CSV validation failed.",
        code="csv_validation_failed",
        errors=errors,
    )


async def read_class_import_rows(file: UploadFile) -> list[tuple[int, dict[str, str]]]:
    filename = readable_text(file.filename)
    if not filename.casefold().endswith(".csv"):
        raise_csv_validation_errors(
            [csv_validation_error("invalid_file_type", "Upload a .csv file.")]
        )

    content = await file.read()
    if not content:
        raise_csv_validation_errors(
            [csv_validation_error("file_empty", "The CSV file is empty.")]
        )

    try:
        decoded = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise_csv_validation_errors(
            [csv_validation_error("invalid_encoding", "The CSV file must use UTF-8 encoding.")]
        )
    if not decoded.strip():
        raise_csv_validation_errors(
            [csv_validation_error("file_empty", "The CSV file is empty.")]
        )

    try:
        reader = csv.DictReader(io.StringIO(decoded, newline=""), strict=True)
        headers = reader.fieldnames
        if headers != CLASS_IMPORT_HEADERS:
            raise_csv_validation_errors(
                [
                    csv_validation_error(
                        "invalid_headers",
                        "CSV headers must exactly match the required ordered header list.",
                    )
                ]
            )

        rows: list[tuple[int, dict[str, str]]] = []
        for row_number, row in enumerate(reader, start=2):
            if None in row:
                raise csv.Error("Row contains more values than the header.")
            trimmed = {header: readable_text(row.get(header)) for header in CLASS_IMPORT_HEADERS}
            if any(trimmed.values()):
                rows.append((row_number, trimmed))
    except ClassManagementError:
        raise
    except (csv.Error, UnicodeError):
        raise_csv_validation_errors(
            [csv_validation_error("csv_parse_error", "The CSV file could not be parsed.")]
        )

    if not rows:
        raise_csv_validation_errors(
            [csv_validation_error("file_empty", "The CSV file contains no data rows.")]
        )

    return rows


def student_sort_key(student: Any) -> tuple[int, str, str, str]:
    gender = (student.gender or "").strip().lower()
    if gender in {"male", "m", "boy"}:
        gender_priority = 0
    elif gender in {"female", "f", "girl"}:
        gender_priority = 1
    else:
        gender_priority = 2

    return (
        gender_priority,
        (student.last_name or "").lower(),
        (student.first_name or "").lower(),
        (student.middle_name or "").lower(),
    )


def build_student_class_assignment(
    student_id: Any,
    class_: Any,
    enrollment_status: str = "enrolled",
) -> StudentClass:
    return StudentClass(
        student_id=student_id,
        class_id=class_.class_id,
        academic_year_id=class_.academic_year_id,
        enrollment_status=enrollment_status,
    )


def _request_validation_error(
    code: str,
    message: str,
    field: str,
) -> dict[str, Any]:
    return {
        "row": None,
        "field": field,
        "code": code,
        "message": message,
    }


def _raise_batch_validation_errors(errors: list[dict[str, Any]]) -> None:
    conflict_codes = {"section_already_exists", "student_already_assigned", "adviser_already_assigned"}
    status_code = 409 if any(error["code"] in conflict_codes for error in errors) else 422
    raise ClassManagementError(
        status_code=status_code,
        message="Request validation failed.",
        code="validation_failed",
        errors=errors,
    )


def _raise_class_creation_conflict() -> None:
    raise ClassManagementError(
        status_code=409,
        message="Class creation conflicted with an existing assignment.",
        code="class_creation_conflict",
        errors=[
            _request_validation_error(
                "class_creation_conflict",
                "An adviser or student assignment conflicted with another request. Refresh the class form and try again.",
                "sections",
            )
        ],
    )


def batch_create_classes(db: Session, payload: Any) -> dict[str, Any]:
    try:
        academic_year = resolve_active_academic_year(db)
        academic_level = (
            db.query(AcademicLevel)
            .filter(AcademicLevel.academic_level_id == payload.academic_level_id)
            .first()
        )
        if not academic_level:
            raise ClassManagementError(
                status_code=404,
                message="Request validation failed.",
                code="validation_failed",
                errors=[
                    _request_validation_error(
                        "academic_level_not_found",
                        f"Academic level {payload.academic_level_id} does not exist.",
                        "academic_level_id",
                    )
                ],
            )

        errors: list[dict[str, Any]] = []
        if not payload.sections:
            errors.append(
                _request_validation_error(
                    "sections_required",
                    "At least one section is required.",
                    "sections",
                )
            )
            _raise_batch_validation_errors(errors)

        normalized_sections: list[dict[str, Any]] = []
        seen_section_names: dict[str, str] = {}
        adviser_ids: set[str] = set()
        seen_adviser_ids: dict[str, str] = {}
        submitted_student_ids: list[Any] = []
        seen_student_ids: set[Any] = set()

        for index, section in enumerate(payload.sections):
            section_field = f"sections.{index}.section_name"
            section_name = readable_text(section.section_name)
            section_key = normalized_text(section_name)
            adviser_id = readable_text(section.adviser_staff_id)

            if not section_name:
                errors.append(
                    _request_validation_error(
                        "section_name_required",
                        "Section name is required.",
                        section_field,
                    )
                )
            elif section_key in seen_section_names:
                errors.append(
                    _request_validation_error(
                        "duplicate_section_name",
                        f'Section name "{section_name}" appears more than once.',
                        "sections",
                    )
                )
            else:
                seen_section_names[section_key] = section_name

            if not adviser_id:
                errors.append(
                    _request_validation_error(
                        "adviser_staff_id_required",
                        "Adviser staff ID is required.",
                        f"sections.{index}.adviser_staff_id",
                    )
                )
            else:
                if adviser_id in seen_adviser_ids:
                    errors.append(
                        _request_validation_error(
                            "duplicate_adviser_assignment",
                            f'Adviser "{adviser_id}" is assigned to both "{seen_adviser_ids[adviser_id]}" and "{section_name}".',
                            "sections",
                        )
                    )
                else:
                    seen_adviser_ids[adviser_id] = section_name
                adviser_ids.add(adviser_id)

            section_student_ids: list[Any] = []
            for student_id in section.student_ids:
                if student_id in seen_student_ids:
                    errors.append(
                        _request_validation_error(
                            "duplicate_student_assignment",
                            f"Student {student_id} appears more than once in the request.",
                            f"sections.{index}.student_ids",
                        )
                    )
                else:
                    seen_student_ids.add(student_id)
                    submitted_student_ids.append(student_id)
                    section_student_ids.append(student_id)

            normalized_sections.append(
                {
                    "section_name": section_name,
                    "section_key": section_key,
                    "adviser_staff_id": adviser_id,
                    "student_ids": section_student_ids,
                }
            )

        existing_section_names = {
            normalized_text(section_name)
            for section_name, in (
                db.query(Class.section_name)
                .filter(Class.academic_year_id == academic_year.academic_year_id)
                .filter(Class.academic_level_id == academic_level.academic_level_id)
                .all()
            )
        }
        for section in normalized_sections:
            if section["section_key"] and section["section_key"] in existing_section_names:
                errors.append(
                    _request_validation_error(
                        "section_already_exists",
                        f'Section "{section["section_name"]}" already exists for the selected academic level and active academic year.',
                        "sections",
                    )
                )

        advisers = {
            adviser.staff_id: adviser
            for adviser in (
                db.query(AcademicStaff)
                .filter(AcademicStaff.staff_id.in_(adviser_ids))
                .all()
            )
        } if adviser_ids else {}
        eligible_adviser_ids = {
            adviser.staff_id
            for adviser in (
                eligible_advisers_query(db)
                .filter(AcademicStaff.staff_id.in_(adviser_ids))
                .all()
            )
        } if adviser_ids else set()
        for section in normalized_sections:
            adviser_id = section["adviser_staff_id"]
            if not adviser_id:
                continue
            if adviser_id not in advisers:
                errors.append(
                    _request_validation_error(
                        "adviser_not_found",
                        f'No adviser exists with staff ID "{adviser_id}".',
                        "sections",
                    )
                )
            elif adviser_id not in eligible_adviser_ids:
                errors.append(
                    _request_validation_error(
                        "adviser_not_eligible",
                        f'Adviser "{adviser_id}" is not eligible.',
                        "sections",
                    )
                )

        assigned_adviser_ids = {
            adviser_id
            for adviser_id, in (
                db.query(Class.adviser_staff_id)
                .filter(Class.academic_year_id == academic_year.academic_year_id)
                .filter(Class.adviser_staff_id.in_(adviser_ids))
                .all()
            )
        } if adviser_ids else set()
        for adviser_id in sorted(assigned_adviser_ids):
            errors.append(
                _request_validation_error(
                    "adviser_already_assigned",
                    f'Adviser "{adviser_id}" is already assigned during the active academic year.',
                    "sections",
                )
            )

        students = {
            student.student_id: student
            for student in (
                db.query(Student)
                .filter(Student.student_id.in_(submitted_student_ids))
                .with_for_update()
                .all()
            )
        } if submitted_student_ids else {}
        for student_id in submitted_student_ids:
            student = students.get(student_id)
            if not student:
                errors.append(
                    _request_validation_error(
                        "student_not_found",
                        f"Student {student_id} does not exist.",
                        "student_ids",
                    )
                )
            elif student.academic_level_id != academic_level.academic_level_id:
                errors.append(
                    _request_validation_error(
                        "student_level_mismatch",
                        f"Student {student_id} does not belong to the selected academic level.",
                        "student_ids",
                    )
                )

        assigned_student_ids = {
            student_id
            for student_id, in (
                db.query(StudentClass.student_id)
                .filter(StudentClass.student_id.in_(submitted_student_ids))
                .filter(StudentClass.academic_year_id == academic_year.academic_year_id)
                .all()
            )
        } if submitted_student_ids else set()
        for student_id in submitted_student_ids:
            if student_id in assigned_student_ids:
                errors.append(
                    _request_validation_error(
                        "student_already_assigned",
                        f"Student {student_id} is already assigned during the active academic year.",
                        "student_ids",
                    )
                )

        if errors:
            _raise_batch_validation_errors(errors)

        created: list[tuple[Class, dict[str, Any]]] = []
        for section in normalized_sections:
            class_ = Class(
                section_name=section["section_name"],
                adviser_staff_id=section["adviser_staff_id"],
                academic_year_id=academic_year.academic_year_id,
                academic_level_id=academic_level.academic_level_id,
                academic_period_id=None,
                class_status="active",
            )
            db.add(class_)
            created.append((class_, section))

        db.flush()

        for class_, section in created:
            for student_id in section["student_ids"]:
                db.add(build_student_class_assignment(student_id, class_))

        db.flush()
        db.commit()

        classes = sorted(
            [
                {
                    "class_id": class_.class_id,
                    "section_name": class_.section_name,
                    "adviser_staff_id": class_.adviser_staff_id,
                    "student_count": len(section["student_ids"]),
                }
                for class_, section in created
            ],
            key=lambda item: item["section_name"].casefold(),
        )
        return {
            "message": "Classes created successfully.",
            "academic_level_id": academic_level.academic_level_id,
            "academic_year_id": academic_year.academic_year_id,
            "summary": {
                "class_count": len(classes),
                "student_assignment_count": sum(item["student_count"] for item in classes),
            },
            "classes": classes,
        }
    except ClassManagementError:
        db.rollback()
        raise
    except IntegrityError:
        db.rollback()
        _raise_class_creation_conflict()
    except Exception:
        db.rollback()
        raise

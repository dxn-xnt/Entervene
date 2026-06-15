from typing import Any

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.schemas.Class import ClassUpdateRequest
from app.services.classes.ClassQueryService import get_class_detail_data
from app.services.classes.ClassShared import (
    ClassManagementError,
    eligible_advisers_query,
    normalized_text,
    readable_text,
    resolve_active_academic_year,
)

# WRITE SIDE OF CLASS MANAGEMENT
# This module owns class creation, editing, and archiving. It validates business
# rules before commit and rolls back multi-record operations when any part fails.


def _get_class_or_404(db: Session, class_id: int) -> Class:
    class_ = db.query(Class).filter(Class.class_id == class_id).first()
    if class_ is None:
        raise HTTPException(status_code=404, detail="Class not found.")
    return class_


def archive_class_record(db: Session, class_id: int) -> dict:
    class_ = _get_class_or_404(db, class_id)
    if normalized_text(class_.class_status or "active") == "archived":
        raise HTTPException(status_code=409, detail="Class is already archived.")

    # Archiving is a soft state change; related enrollments and subject loads
    # remain available for historical reporting.
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


def update_class_record(
    db: Session,
    class_id: int,
    payload: ClassUpdateRequest,
) -> dict:
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="Provide at least one editable field.")

    class_ = _get_class_or_404(db, class_id)
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
            # Re-check eligibility during mutation; form-option data may be stale
            # by the time the admin submits an update.
            adviser = eligible_advisers_query(db).filter(AcademicStaff.staff_id == adviser_staff_id).first()
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

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise
    db.refresh(class_)
    return get_class_detail_data(db=db, class_id=class_.class_id)


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
    # The entire batch is validated before any class is persisted. A failure in
    # one section rejects the batch so classes and rosters cannot be half-created.
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

        # Phase 1: validate duplicates and required values inside the request.
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

        # Phase 2: compare the request with existing classes and assignments.
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

        # Lock submitted students until commit to reduce concurrent requests
        # assigning the same student twice in the active academic year.
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

        # Phase 3: after all validation passes, create classes and their rosters.
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

        # Class IDs are required before their StudentClass rows can be created.
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

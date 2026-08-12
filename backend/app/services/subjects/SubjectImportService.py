import csv
import io

from fastapi import UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Subject import Subject
from app.models.academic.SubjectGroup import SubjectGroup
from app.services.subjects.SubjectShared import (
    DEFAULT_SUBJECT_STATUS,
    normalize_optional_text,
    normalized_text,
)


SUBJECT_IMPORT_HEADERS = [
    "subject_code",
    "subject_name",
    "grade_level",
    "subject_group",
    "hours",
    "default_grading_template",
    "description",
]


def subject_import_template_csv(db: Session | None = None) -> str:
    """Return a CSV string for the subject catalog import template.

    The example row's ``subject_group`` value is fetched from the live
    SubjectGroup table (first active group by display_order) so the template
    stays current even when an admin renames or reorders groups.  Falls back to
    "Core" when db is not supplied or no groups exist.
    """
    example_group = "Core"
    if db is not None:
        first_group = (
            db.query(SubjectGroup)
            .filter(SubjectGroup.is_active.is_(True))
            .order_by(SubjectGroup.display_order, func.lower(SubjectGroup.name))
            .first()
        )
        if first_group is not None:
            example_group = first_group.name

    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(SUBJECT_IMPORT_HEADERS)
    writer.writerow([
        "GENBIO1",
        "General Biology 1",
        "11",
        example_group,
        "80",
        "Default SHS",
        "STEM specialized subject",
    ])
    writer.writerow([
        "MATH7",
        "Mathematics 7",
        "7",
        example_group,
        "",
        "",
        "JHS Core Mathematics (hours optional)",
    ])
    return output.getvalue()


def _import_error(row: int | None, message: str) -> dict:
    return {"row": row, "message": message}


def _decode_csv(content: bytes) -> str | None:
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return None


async def _read_csv_rows(file: UploadFile, expected_headers: list[str]) -> tuple[list[tuple[int, dict[str, str]]], list[dict]]:
    filename = (file.filename or "").strip()
    if not filename.casefold().endswith(".csv"):
        return [], [_import_error(None, "Upload a .csv file.")]

    content = await file.read()
    if not content:
        return [], [_import_error(None, "The CSV file is empty.")]

    decoded = _decode_csv(content)
    if decoded is None:
        return [], [_import_error(None, "The CSV file must use UTF-8 encoding.")]
    if not decoded.strip():
        return [], [_import_error(None, "The CSV file is empty.")]

    try:
        reader = csv.DictReader(io.StringIO(decoded, newline=""), strict=True)
        if reader.fieldnames != expected_headers:
            return [], [_import_error(None, "CSV headers must exactly match the subject catalog template.")]
        rows = []
        for row_number, row in enumerate(reader, start=2):
            if None in row:
                return [], [_import_error(row_number, "Row contains more values than the header.")]
            trimmed = {header: (row.get(header) or "").strip() for header in expected_headers}
            if any(trimmed.values()):
                rows.append((row_number, trimmed))
    except csv.Error:
        return [], [_import_error(None, "The CSV file could not be parsed.")]

    if not rows:
        return [], [_import_error(None, "The CSV file contains no data rows.")]
    return rows, []


def _grade_level_map(db: Session) -> dict[int, AcademicLevel]:
    return {level.grade_level: level for level in db.query(AcademicLevel).all()}


def _existing_subject_keys(db: Session) -> set[tuple[int, str]]:
    rows = (
        db.query(Subject.academic_level_id, Subject.subject_codename)
        .filter(Subject.subject_codename.isnot(None))
        .all()
    )
    return {
        (academic_level_id, subject_codename.casefold())
        for academic_level_id, subject_codename in rows
        if subject_codename
    }


def _build_group_map(db: Session) -> tuple[dict[str, SubjectGroup], SubjectGroup | None]:
    """Return (name_lower -> SubjectGroup, other_group_or_None)."""
    groups = db.query(SubjectGroup).filter(SubjectGroup.is_active.is_(True)).all()
    group_map = {normalized_text(g.name): g for g in groups}
    # Also include inactive groups so we can still match names from older data
    all_groups = db.query(SubjectGroup).all()
    full_map = {normalized_text(g.name): g for g in all_groups}
    other_group = full_map.get("other")
    return full_map, other_group


async def import_subject_catalog_csv(db: Session, file: UploadFile) -> dict:
    rows, errors = await _read_csv_rows(file, SUBJECT_IMPORT_HEADERS)
    if errors:
        return {
            "total_rows": len(rows),
            "created_count": 0,
            "skipped_count": len(rows),
            "error_count": len(errors),
            "errors": errors,
            "warnings": [],
        }

    levels = _grade_level_map(db)
    existing_keys = _existing_subject_keys(db)
    seen_keys: dict[tuple[int, str], int] = {}
    group_map, other_group = _build_group_map(db)
    created: list[Subject] = []
    errors = []
    warnings: list[str] = []

    for row_number, row in rows:
        row_errors = []
        subject_code = normalize_optional_text(row["subject_code"])
        subject_name = normalize_optional_text(row["subject_name"])
        grade_level_text = normalize_optional_text(row["grade_level"])
        subject_group_text = normalize_optional_text(row["subject_group"])
        hours_text = normalize_optional_text(row["hours"])

        if subject_code is None:
            row_errors.append("subject_code cannot be blank.")
        if subject_name is None:
            row_errors.append("subject_name cannot be blank.")

        academic_level = None
        if grade_level_text is None:
            row_errors.append("grade_level cannot be blank.")
        elif not grade_level_text.isdecimal():
            row_errors.append("grade_level must be a whole number.")
        else:
            academic_level = levels.get(int(grade_level_text))
            if academic_level is None:
                row_errors.append(f"grade_level {grade_level_text} does not match an existing academic level.")

        # Group resolution: unknown name → assign "Other", add warning (not error)
        resolved_group: SubjectGroup | None = None
        if subject_group_text is None:
            row_errors.append("subject_group cannot be blank.")
        else:
            resolved_group = group_map.get(normalized_text(subject_group_text))
            if resolved_group is None:
                if other_group is not None:
                    resolved_group = other_group
                    warnings.append(
                        f"Row {row_number}: subject_group \"{subject_group_text}\" not recognised — "
                        f"assigned to \"{other_group.name}\"."
                    )
                else:
                    row_errors.append(f"subject_group \"{subject_group_text}\" not recognised and no \"Other\" group exists.")

        hours = None
        if hours_text is not None:
            try:
                parsed_val = int(hours_text)
                if parsed_val < 0:
                    warnings.append(
                        f"Row {row_number} ({subject_code or 'Subject'}): negative hours '{hours_text}' — saved as unset (needs review)."
                    )
                else:
                    hours = parsed_val
            except ValueError:
                warnings.append(
                    f"Row {row_number} ({subject_code or 'Subject'}): invalid hours value '{hours_text}' — saved as unset (needs review)."
                )
        else:
            warnings.append(
                f"Row {row_number} ({subject_code or 'Subject'}): hours column is empty — saved as unset (needs review)."
            )

        duplicate_key = None
        if academic_level is not None and subject_code is not None:
            duplicate_key = (academic_level.academic_level_id, subject_code.casefold())
            if duplicate_key in existing_keys:
                row_errors.append("Duplicate subject code within the same grade level.")
            if duplicate_key in seen_keys:
                row_errors.append(f"Duplicate subject code already appears on CSV row {seen_keys[duplicate_key]}.")

        if row_errors:
            errors.extend(_import_error(row_number, message) for message in row_errors)
            continue

        if duplicate_key is not None:
            seen_keys[duplicate_key] = row_number
            existing_keys.add(duplicate_key)

        created.append(Subject(
            subject_name=subject_name or "",
            subject_codename=subject_code,
            subject_group_id=resolved_group.subject_group_id if resolved_group else (other_group.subject_group_id if other_group else 1),
            hours=hours,
            default_grading_template=normalize_optional_text(row["default_grading_template"]),
            description=normalize_optional_text(row["description"]),
            status=DEFAULT_SUBJECT_STATUS,
            academic_level_id=academic_level.academic_level_id if academic_level else 0,
        ))

    for subject in created:
        db.add(subject)
    if created:
        db.commit()

    return {
        "total_rows": len(rows),
        "created_count": len(created),
        "skipped_count": len(rows) - len(created),
        "error_count": len(errors),
        "errors": errors,
        "warnings": warnings,
    }

import csv
import io

from fastapi import HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Subject import Subject
from app.models.academic.GradingTemplate import GradingTemplate
from app.services.subjects.SubjectCodeGenerator import normalize_subject_name
from app.services.subjects.SubjectService import (
    find_subject_name_conflict,
    generate_available_subject_code,
)
from app.services.subjects.SubjectShared import (
    DEFAULT_SUBJECT_STATUS,
    ensure_standard_academic_levels,
    normalize_optional_text,
)


SUBJECT_IMPORT_HEADERS = [
    "subject_name",
    "grade_level",
    "grading_template",
    "description",
]
LEGACY_SUBJECT_IMPORT_HEADERS = ["subject_code", *SUBJECT_IMPORT_HEADERS]


def subject_import_template_csv(db: Session | None = None) -> str:
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(SUBJECT_IMPORT_HEADERS)
    if db is not None:
        ensure_standard_academic_levels(db)
        levels = db.query(AcademicLevel).order_by(AcademicLevel.grade_level.asc()).all()
        templates = db.query(GradingTemplate).filter(GradingTemplate.status == "active").all()
        default_grade = str(levels[0].grade_level) if levels else "9"
        second_grade = str(levels[-1].grade_level) if len(levels) > 1 else default_grade
        core_tpl = next((t.template_name for t in templates if "core" in t.template_name.casefold()), templates[0].template_name if templates else "Core")
        second_tpl = next((t.template_name for t in templates if t.template_name != core_tpl), core_tpl)
        writer.writerow([f"Science {second_grade}", second_grade, second_tpl, "Science catalog subject"])
        writer.writerow([f"English {default_grade}", default_grade, core_tpl, "Core English subject"])
    else:
        writer.writerow(["General Biology 1", "11", "Specialized", "STEM specialized subject"])
        writer.writerow(["Mathematics 7", "7", "Core", "JHS Core Mathematics"])
    return output.getvalue()


def _import_error(row: int | None, message: str) -> dict:
    return {"row": row, "message": message}


def _decode_csv(content: bytes) -> str | None:
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return None


async def _read_csv_rows(file: UploadFile) -> tuple[list[tuple[int, dict[str, str]]], list[dict]]:
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
        if reader.fieldnames not in (SUBJECT_IMPORT_HEADERS, LEGACY_SUBJECT_IMPORT_HEADERS):
            return [], [_import_error(None, "CSV headers must exactly match the subject catalog template.")]
        source_headers = reader.fieldnames
        rows = []
        for row_number, row in enumerate(reader, start=2):
            if None in row:
                return [], [_import_error(row_number, "Row contains more values than the header.")]
            trimmed = {header: (row.get(header) or "").strip() for header in source_headers}
            if any(trimmed.values()):
                rows.append((row_number, {header: trimmed.get(header, "") for header in SUBJECT_IMPORT_HEADERS}))
    except csv.Error:
        return [], [_import_error(None, "The CSV file could not be parsed.")]

    if not rows:
        return [], [_import_error(None, "The CSV file contains no data rows.")]
    return rows, []


def _resolve_academic_level(
    levels_by_grade: dict[int, AcademicLevel],
    levels_by_name: dict[str, AcademicLevel],
    level_text: str | None,
) -> AcademicLevel | None:
    if not level_text:
        return None
    cleaned = level_text.strip()
    if cleaned.casefold() in levels_by_name:
        return levels_by_name[cleaned.casefold()]
    digits = "".join(ch for ch in cleaned if ch.isdigit())
    grade_num = int(digits) if digits.isdecimal() else None
    if grade_num is not None:
        if grade_num in levels_by_grade:
            return levels_by_grade[grade_num]
    return None


def _validate_subject_catalog_rows(
    db: Session,
    rows: list[tuple[int, dict[str, str]]],
) -> tuple[list[dict], list[dict], list[dict]]:
    all_levels = db.query(AcademicLevel).all()
    levels_by_grade = {level.grade_level: level for level in all_levels}
    levels_by_name = {level.level_name.casefold(): level for level in all_levels if level.level_name}
    templates = db.query(GradingTemplate).filter(GradingTemplate.status == "active").all()
    template_by_name = {template.template_name.casefold(): template for template in templates}
    template_by_id = {str(template.grading_template_id): template for template in templates}
    seen_names: dict[tuple[int, str], int] = {}
    reserved_codes: list[str] = []
    prepared: list[dict] = []
    errors: list[dict] = []
    preview_rows: list[dict] = []

    for row_number, row in rows:
        issues: list[str] = []
        name = normalize_optional_text(row["subject_name"])
        level_text = normalize_optional_text(row["grade_level"])
        template_text = normalize_optional_text(row["grading_template"])
        if not name:
            issues.append("subject_name cannot be blank.")
        level = _resolve_academic_level(levels_by_grade, levels_by_name, level_text)
        if level is None:
            issues.append("grade_level must match an existing academic level.")
        template = (
            template_by_id.get(template_text) or template_by_name.get(template_text.casefold())
        ) if template_text else None
        if template is None and templates:
            template = next(
                (candidate for candidate in templates if "core" in candidate.template_name.casefold()),
                templates[0],
            ) if not template_text else None
        if template is None:
            issues.append(
                f'grading_template "{template_text or ""}" is invalid; use an active template name or ID.'
            )

        name_key = None
        if name and level is not None:
            name_key = (level.academic_level_id, normalize_subject_name(name))
            existing_subject = find_subject_name_conflict(db, name, level.academic_level_id)
            if existing_subject is not None:
                if (existing_subject.status or DEFAULT_SUBJECT_STATUS).casefold() == "archived":
                    issues.append("Subject is archived. Restore it instead.")
                else:
                    issues.append("Subject already exists in this grade.")
            elif name_key in seen_names:
                issues.append(f"Duplicate subject name already appears on CSV row {seen_names[name_key]}.")
            else:
                seen_names[name_key] = row_number

        code = None
        if name and level is not None and not any(
            issue.startswith(("Subject ", "Duplicate subject name")) for issue in issues
        ):
            try:
                code = generate_available_subject_code(
                    db,
                    name,
                    level.grade_level,
                    additional_codes=tuple(reserved_codes),
                )
            except HTTPException as exc:
                issues.append(str(exc.detail))

        preview_row = {
            "row": row_number,
            "subject_code": code,
            "subject_name": name or "",
            "grade_level": str(level.grade_level) if level is not None else (level_text or ""),
            "grading_template": template.template_name if template is not None else (template_text or ""),
            "description": normalize_optional_text(row["description"]) or "",
            "errors": issues,
        }
        preview_rows.append(preview_row)
        errors.extend(_import_error(row_number, issue) for issue in issues)
        if issues:
            continue

        reserved_codes.append(code)
        prepared.append({
            "subject_name": name,
            "subject_codename": code,
            "academic_level_id": level.academic_level_id,
            "grading_template_id": template.grading_template_id,
            "description": normalize_optional_text(row["description"]),
        })

    return prepared, errors, preview_rows


async def preview_subject_catalog_csv(db: Session, file: UploadFile) -> dict:
    rows, read_errors = await _read_csv_rows(file)
    if read_errors:
        return {
            "total_rows": len(rows),
            "valid_count": 0,
            "error_count": len(read_errors),
            "errors": read_errors,
            "rows": [],
        }
    # Match the final import exactly: it seeds the standard Grade 7-12 levels
    # before validating, so the preview must resolve grades the same way.
    ensure_standard_academic_levels(db)
    prepared, errors, preview_rows = _validate_subject_catalog_rows(db, rows)
    return {
        "total_rows": len(rows),
        "valid_count": len(prepared),
        "error_count": len(errors),
        "errors": errors,
        "rows": preview_rows,
    }


async def import_subject_catalog_csv(db: Session, file: UploadFile) -> dict:
    rows, errors = await _read_csv_rows(file)
    if errors:
        return {"total_rows": len(rows), "created_count": 0, "skipped_count": len(rows),
                "error_count": len(errors), "errors": errors, "warnings": []}
    ensure_standard_academic_levels(db)
    prepared, errors, _ = _validate_subject_catalog_rows(db, rows)
    created = [Subject(**values, status=DEFAULT_SUBJECT_STATUS) for values in prepared]
    db.add_all(created)
    if created: db.commit()
    return {"total_rows": len(rows), "created_count": len(created), "skipped_count": len(rows)-len(created),
            "error_count": len(errors), "errors": errors, "warnings": []}

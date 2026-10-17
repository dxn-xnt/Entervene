import csv
import io

from fastapi import UploadFile
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Subject import Subject
from app.models.academic.GradingTemplate import GradingTemplate
from app.services.subjects.SubjectShared import (
    DEFAULT_SUBJECT_STATUS,
    normalize_optional_text,
    normalized_text,
)


SUBJECT_IMPORT_HEADERS = [
    "subject_code",
    "subject_name",
    "grade_level",
    "grading_template",
    "description",
]


def subject_import_template_csv(db: Session | None = None) -> str:
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(SUBJECT_IMPORT_HEADERS)
    writer.writerow(["GENBIO1", "General Biology 1", "11", "Specialized", "STEM specialized subject"])
    writer.writerow(["MATH7", "Mathematics 7", "7", "Core", "JHS Core Mathematics"])
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


async def import_subject_catalog_csv(db: Session, file: UploadFile) -> dict:
    rows, errors = await _read_csv_rows(file, SUBJECT_IMPORT_HEADERS)
    if errors:
        return {"total_rows": len(rows), "created_count": 0, "skipped_count": len(rows),
                "error_count": len(errors), "errors": errors, "warnings": []}
    levels = _grade_level_map(db)
    templates = db.query(GradingTemplate).filter(GradingTemplate.status == "active").all()
    template_by_name = {t.template_name.casefold(): t for t in templates}
    template_by_id = {str(t.grading_template_id): t for t in templates}
    existing = _existing_subject_keys(db)
    seen: dict[tuple[int, str], int] = {}
    created: list[Subject] = []
    errors = []
    for row_number, row in rows:
        issues = []
        code = normalize_optional_text(row["subject_code"])
        name = normalize_optional_text(row["subject_name"])
        level_text = normalize_optional_text(row["grade_level"])
        template_text = normalize_optional_text(row["grading_template"])
        if not code: issues.append("subject_code cannot be blank.")
        if not name: issues.append("subject_name cannot be blank.")
        level = levels.get(int(level_text)) if level_text and level_text.isdecimal() else None
        if level is None: issues.append("grade_level must match an existing academic level.")
        template = (template_by_id.get(template_text) or template_by_name.get(template_text.casefold())) if template_text else None
        if template is None:
            issues.append(f'grading_template "{template_text or ""}" is invalid; use an active template name or ID.')
        key = (level.academic_level_id, code.casefold()) if level and code else None
        if key in existing: issues.append("Duplicate subject code within the same grade level.")
        if key in seen: issues.append(f"Duplicate subject code already appears on CSV row {seen[key]}.")
        if issues:
            errors.extend(_import_error(row_number, issue) for issue in issues)
            continue
        seen[key] = row_number
        existing.add(key)
        created.append(Subject(
            subject_name=name, subject_codename=code, academic_level_id=level.academic_level_id,
            grading_template_id=template.grading_template_id,
            description=normalize_optional_text(row["description"]), status=DEFAULT_SUBJECT_STATUS,
        ))
    db.add_all(created)
    if created: db.commit()
    return {"total_rows": len(rows), "created_count": len(created), "skipped_count": len(rows)-len(created),
            "error_count": len(errors), "errors": errors, "warnings": []}

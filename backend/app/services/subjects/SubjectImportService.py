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
    if db is not None:
        levels = db.query(AcademicLevel).order_by(AcademicLevel.grade_level.asc()).all()
        templates = db.query(GradingTemplate).filter(GradingTemplate.status == "active").all()
        default_grade = str(levels[0].grade_level) if levels else "9"
        second_grade = str(levels[-1].grade_level) if len(levels) > 1 else default_grade
        core_tpl = next((t.template_name for t in templates if "core" in t.template_name.casefold()), templates[0].template_name if templates else "Core")
        second_tpl = next((t.template_name for t in templates if t.template_name != core_tpl), core_tpl)
        writer.writerow([f"SCI{second_grade}", f"Science {second_grade}", second_grade, second_tpl, "Science catalog subject"])
        writer.writerow([f"ENG{default_grade}", f"English {default_grade}", default_grade, core_tpl, "Core English subject"])
    else:
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


def _resolve_academic_level(
    db: Session,
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
        if 7 <= grade_num <= 12:
            new_level = AcademicLevel(
                level_name=f"Grade {grade_num}",
                grade_level=grade_num,
                requires_pathway=grade_num in (11, 12),
            )
            db.add(new_level)
            db.flush()
            levels_by_grade[grade_num] = new_level
            levels_by_name[new_level.level_name.casefold()] = new_level
            return new_level
    return None


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
    all_levels = db.query(AcademicLevel).all()
    levels_by_grade = {level.grade_level: level for level in all_levels}
    levels_by_name = {level.level_name.casefold(): level for level in all_levels if level.level_name}
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
        level = _resolve_academic_level(db, levels_by_grade, levels_by_name, level_text)
        if level is None: issues.append("grade_level must match an existing academic level.")
        template = (template_by_id.get(template_text) or template_by_name.get(template_text.casefold())) if template_text else None
        if template is None and templates:
            template = next((t for t in templates if "core" in t.template_name.casefold()), templates[0]) if not template_text else None
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

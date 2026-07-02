import csv
import io

from fastapi import UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Subject import Subject
from app.models.academic.SubjectOffering import SubjectOffering
from app.services.subject_offerings.SubjectOfferingShared import (
    ALLOWED_PATHWAYS,
    GENERAL_PATHWAY,
    INACTIVE_ACADEMIC_YEAR_READ_ONLY_MESSAGE,
    normalize_pathway,
    normalized_text,
    validate_pathway_for_grade,
)


SUBJECT_OFFERING_IMPORT_HEADERS = [
    "academic_year",
    "grade_level",
    "pathway",
    "term",
    "subject_code",
]


def subject_offering_import_template_csv() -> str:
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(SUBJECT_OFFERING_IMPORT_HEADERS)
    writer.writerow(["2026-2027", "Grade 7", "general", "Term 1", "MATH7"])
    writer.writerow(["2026-2027", "Grade 11", "both", "Term 1", "GENMATH11"])
    writer.writerow(["2026-2027", "Grade 11", "stem_medical", "Term 2", "BIO1"])
    writer.writerow(["2026-2027", "Grade 11", "stem_engineering", "Term 2", "PRECAL11"])
    return output.getvalue()


def _import_error(row: int | None, message: str) -> dict:
    return {"row": row, "message": message}


async def _read_csv_rows(file: UploadFile, expected_headers: list[str]) -> tuple[list[tuple[int, dict[str, str]]], list[dict]]:
    filename = (file.filename or "").strip()
    if not filename.casefold().endswith(".csv"):
        return [], [_import_error(None, "Upload a .csv file.")]

    content = await file.read()
    if not content:
        return [], [_import_error(None, "The CSV file is empty.")]

    try:
        decoded = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        return [], [_import_error(None, "The CSV file must use UTF-8 encoding.")]
    if not decoded.strip():
        return [], [_import_error(None, "The CSV file is empty.")]

    try:
        reader = csv.DictReader(io.StringIO(decoded, newline=""), strict=True)
        if reader.fieldnames != expected_headers:
            return [], [_import_error(None, "CSV headers must exactly match the subject offering template.")]
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


def _term_key(value: str) -> str:
    normalized = normalized_text(value)
    if normalized.startswith("term "):
        return normalized.replace("term ", "", 1)
    return normalized


def _find_period(periods: list[AcademicPeriod], term: str, academic_year_id: int) -> AcademicPeriod | None:
    term_key = _term_key(term)
    for period in periods:
        if period.academic_year_id != academic_year_id:
            continue
        if normalized_text(period.period_name) == normalized_text(term):
            return period
        if str(period.period_sequence) == term_key:
            return period
    return None


def _parse_grade_level(value: str) -> int | None:
    normalized = normalized_text(value)
    if normalized.startswith("grade "):
        normalized = normalized.replace("grade ", "", 1)
    return int(normalized) if normalized.isdecimal() else None


def _offering_conflict(
    existing_pathways: set[str],
    pathway: str,
) -> str | None:
    if pathway in existing_pathways:
        return "Duplicate subject offering."
    if pathway == GENERAL_PATHWAY:
        return None
    if pathway == "both" and ({"stem_medical", "stem_engineering"} & existing_pathways):
        return "Shared offering conflicts with an existing pathway-specific offering."
    if pathway in {"stem_medical", "stem_engineering"} and "both" in existing_pathways:
        return "Pathway-specific offering conflicts with an existing shared offering."
    return None


async def import_subject_offering_csv(db: Session, file: UploadFile) -> dict:
    rows, errors = await _read_csv_rows(file, SUBJECT_OFFERING_IMPORT_HEADERS)
    if errors:
        return {
            "total_rows": len(rows),
            "created_count": 0,
            "skipped_count": len(rows),
            "error_count": len(errors),
            "errors": errors,
        }

    years = {year.year_label.casefold(): year for year in db.query(AcademicYear).all()}
    levels = {level.grade_level: level for level in db.query(AcademicLevel).all()}
    periods = db.query(AcademicPeriod).all()
    subjects = {
        (subject.academic_level_id, (subject.subject_codename or "").casefold()): subject
        for subject in db.query(Subject).filter(func.lower(func.coalesce(Subject.status, "active")) == "active").all()
        if subject.subject_codename
    }

    existing_by_scope: dict[tuple[int, int, int, int], set[str]] = {}
    for offering in db.query(SubjectOffering).all():
        key = (
            offering.subject_id,
            offering.academic_year_id,
            offering.academic_level_id,
            offering.academic_period_id,
        )
        existing_by_scope.setdefault(key, set()).add(offering.pathway)

    created: list[SubjectOffering] = []
    errors = []

    for row_number, row in rows:
        row_errors = []
        year_label = row["academic_year"].strip()
        grade_level_text = row["grade_level"].strip()
        term = row["term"].strip()
        subject_code = row["subject_code"].strip()
        pathway_text = row["pathway"].strip()

        academic_year = years.get(year_label.casefold()) if year_label else None
        if academic_year is None:
            row_errors.append("academic_year must match an existing academic year.")
        elif not academic_year.is_active:
            row_errors.append(INACTIVE_ACADEMIC_YEAR_READ_ONLY_MESSAGE)

        academic_level = None
        if not grade_level_text:
            row_errors.append("grade_level cannot be blank.")
        else:
            grade_level = _parse_grade_level(grade_level_text)
            if grade_level is None:
                row_errors.append("grade_level must be a whole number or label like Grade 7.")
            else:
                academic_level = levels.get(grade_level)
                if academic_level is None:
                    row_errors.append(f"grade_level {grade_level_text} does not match an existing academic level.")

        academic_period = None
        if not term:
            row_errors.append("term cannot be blank.")
        elif academic_year is not None:
            academic_period = _find_period(periods, term, academic_year.academic_year_id)
            if academic_period is None:
                row_errors.append("term must match an academic period in the selected academic year.")

        pathway = None
        if not pathway_text:
            row_errors.append("pathway cannot be blank.")
        else:
            try:
                pathway = normalize_pathway(pathway_text)
            except Exception:
                row_errors.append(f"pathway must be one of: {', '.join(ALLOWED_PATHWAYS)}.")

        if pathway is not None and academic_level is not None:
            try:
                validate_pathway_for_grade(pathway, academic_level)
            except Exception as exc:
                row_errors.append(getattr(exc, "detail", "pathway is not valid for the selected grade level."))

        subject = None
        if not subject_code:
            row_errors.append("subject_code cannot be blank.")
        elif academic_level is not None:
            subject = subjects.get((academic_level.academic_level_id, subject_code.casefold()))
            if subject is None:
                row_errors.append("subject_code must exist for the selected grade level.")

        if subject is not None and academic_year is not None and academic_level is not None and academic_period is not None and pathway is not None:
            scope_key = (
                subject.subject_id,
                academic_year.academic_year_id,
                academic_level.academic_level_id,
                academic_period.academic_period_id,
            )
            conflict = _offering_conflict(existing_by_scope.get(scope_key, set()), pathway)
            if conflict:
                row_errors.append(conflict)

        if row_errors:
            errors.extend(_import_error(row_number, message) for message in row_errors)
            continue

        scope_key = (
            subject.subject_id,
            academic_year.academic_year_id,
            academic_level.academic_level_id,
            academic_period.academic_period_id,
        )
        existing_by_scope.setdefault(scope_key, set()).add(pathway)
        created.append(SubjectOffering(
            subject_id=subject.subject_id,
            academic_year_id=academic_year.academic_year_id,
            academic_level_id=academic_level.academic_level_id,
            academic_period_id=academic_period.academic_period_id,
            pathway=pathway,
            status="active",
        ))

    for offering in created:
        db.add(offering)
    if created:
        db.commit()

    return {
        "total_rows": len(rows),
        "created_count": len(created),
        "skipped_count": len(rows) - len(created),
        "error_count": len(errors),
        "errors": errors,
    }

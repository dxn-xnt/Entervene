import csv
import io
from typing import Any, Callable

import pandas as pd
from fastapi import HTTPException, UploadFile
from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy.orm import Session

from app.core.FileUpload import MAX_FILE_SIZE
from app.models.auth.UserAccount import UserAccount
from app.models.people.Student import Student
from app.services.users.UserShared import (
    LRN_RE,
    attach_staff_profile,
    attach_student_profile,
    create_pending_account,
    DOB_FIELDS,
    normalize_lrn,
    resolve_academic_level_id,
    parse_optional_date,
    validate_required_name,
)

# BULK USER INVITATION FLOW
# read CSV/Excel -> validate every row -> create pending accounts and profiles ->
# commit the complete batch -> send invitation emails.


EMAIL_ADAPTER = TypeAdapter(EmailStr)
TEACHER_COLUMNS = {"first_name", "last_name", "email"}
STUDENT_COLUMNS = {"first_name", "last_name", "email", "student_lrn"}
STUDENT_GRADE_COLUMNS = {"grade_level", "academic_level", "academic_level_id"}


def _normalize_upload_row(row: dict[str, Any]) -> dict[str, str]:
    return {str(key).strip(): "" if value is None else str(value).strip() for key, value in row.items()}


def _normalize_email(raw: str) -> str:
    value = (raw or "").strip().lower()
    if not value:
        return ""
    try:
        return str(EMAIL_ADAPTER.validate_python(value)).lower()
    except ValidationError:
        return value


def _import_error(row: int, field: str, value: Any, reason: str) -> dict[str, Any]:
    return {"row": row, "field": field, "value": "" if value is None else str(value), "reason": reason}


def _decode_csv_content(content: bytes) -> str:
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            return content.decode("cp1252")
        except UnicodeDecodeError as exc:
            raise HTTPException(
                status_code=400,
                detail="Unable to read CSV encoding. Save the file as CSV UTF-8 and try again.",
            ) from exc


def _validate_optional_dob(row: dict[str, Any], row_number: int, errors: list[dict[str, Any]]) -> None:
    raw_value = next((row.get(field) for field in DOB_FIELDS if row.get(field) not in (None, "")), "")
    if raw_value in (None, ""):
        row["dob"] = None
        return
    try:
        row["dob"] = parse_optional_date(row)
    except HTTPException:
        errors.append(_import_error(row_number, "dob", raw_value, "DOB must use YYYY-MM-DD format"))


async def _read_import_rows(file: UploadFile) -> tuple[list[dict[str, str]], set[str]]:
    filename = (file.filename or "").lower()
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail=f"File too large. Maximum is {MAX_FILE_SIZE} bytes.")

    if filename.endswith(".csv"):
        reader = csv.DictReader(io.StringIO(_decode_csv_content(content)))
        fieldnames = {field.strip() for field in reader.fieldnames or []}
        return [_normalize_upload_row(row) for row in reader], fieldnames

    if filename.endswith((".xlsx", ".xls")):
        try:
            frame = pd.read_excel(io.BytesIO(content), dtype=str).fillna("")
        except ImportError as exc:
            raise HTTPException(status_code=500, detail="Excel upload support requires the openpyxl package.") from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Unable to read Excel file.") from exc
        fieldnames = {str(column).strip() for column in frame.columns}
        return [_normalize_upload_row(row) for row in frame.to_dict(orient="records")], fieldnames

    raise HTTPException(status_code=400, detail="Upload a .csv, .xlsx, or .xls file.")


def _validate_import_rows(
    db: Session,
    role: str,
    rows: list[dict[str, str]],
) -> tuple[list[dict[str, str]], list[dict[str, Any]]]:
    valid_rows: list[dict[str, str]] = []
    errors: list[dict[str, Any]] = []
    seen_emails: dict[str, int] = {}
    seen_student_lrns: dict[str, int] = {}

    if not rows:
        return valid_rows, [_import_error(1, "file", "", "File contains no data rows")]

    for index, row in enumerate(rows, start=2):
        if not any((value or "").strip() for value in row.values()):
            continue

        normalized = {key: (value or "").strip() for key, value in row.items()}
        validate_required_name(normalized, errors, index, _import_error)
        _validate_optional_dob(normalized, index, errors)

        raw_email = normalized.get("email", "")
        email = _normalize_email(raw_email)
        normalized["email"] = email
        if not raw_email.strip():
            errors.append(_import_error(index, "email", raw_email, "Email is required"))
        else:
            try:
                EMAIL_ADAPTER.validate_python(email)
            except ValidationError:
                errors.append(_import_error(index, "email", raw_email, "Invalid email address"))

        if email:
            if email in seen_emails:
                errors.append(_import_error(index, "email", raw_email, f"Duplicate email in upload; first seen on row {seen_emails[email]}"))
            else:
                seen_emails[email] = index
            if db.query(UserAccount).filter(UserAccount.email == email).first():
                errors.append(_import_error(index, "email", raw_email, "Email already registered"))

        if role == "Student":
            raw_lrn = normalized.get("student_lrn", "")
            student_lrn = normalize_lrn(raw_lrn)
            normalized["student_lrn"] = student_lrn
            if not LRN_RE.fullmatch(student_lrn):
                errors.append(_import_error(index, "student_lrn", raw_lrn, "Student LRN must be exactly 12 digits"))
            else:
                if student_lrn in seen_student_lrns:
                    errors.append(_import_error(index, "student_lrn", raw_lrn, f"Duplicate LRN in upload; first seen on row {seen_student_lrns[student_lrn]}"))
                else:
                    seen_student_lrns[student_lrn] = index
                if db.query(Student).filter(Student.student_lrn == student_lrn).first():
                    errors.append(_import_error(index, "student_lrn", raw_lrn, "Student LRN already registered"))

            if resolve_academic_level_id(db, normalized) is None:
                grade_value = normalized.get("grade_level") or normalized.get("academic_level") or normalized.get("academic_level_id") or ""
                errors.append(_import_error(index, "grade_level", grade_value, "Grade level does not match an existing academic level"))

        valid_rows.append(normalized)

    if not valid_rows and not errors:
        errors.append(_import_error(1, "file", "", "File contains no data rows"))
    return valid_rows, errors


async def import_users_file(
    db: Session,
    file: UploadFile,
    role: str,
    invitation_sender: Callable[[str, str], None],
) -> dict:
    if role not in ("Teacher", "Student"):
        raise HTTPException(status_code=400, detail="role must be Teacher or Student")

    # Phase 1: verify file structure and validate all rows before writing.
    required = TEACHER_COLUMNS if role == "Teacher" else STUDENT_COLUMNS
    rows, fieldnames = await _read_import_rows(file)
    if not required.issubset(fieldnames):
        missing = sorted(required - fieldnames)
        raise HTTPException(status_code=400, detail=f"File missing columns: {', '.join(missing)}")
    if role == "Student" and not STUDENT_GRADE_COLUMNS.intersection(fieldnames):
        raise HTTPException(
            status_code=400,
            detail="File missing a student grade column: use grade_level with values like 7, 8, 9, 10, 11, or 12.",
        )

    valid_rows, errors = _validate_import_rows(db, role, rows)
    total_rows = len(valid_rows)
    if errors:
        raise HTTPException(
            status_code=422,
            detail={
                "message": "Student import failed validation" if role == "Student" else "User import failed validation",
                "total_rows": total_rows,
                "created_count": 0,
                "failed_count": len({error["row"] for error in errors}),
                "errors": errors,
            },
        )

    # Phase 2: persist the complete import before sending email. This keeps the database
    # all-or-nothing and avoids invitations pointing to rolled-back accounts.
    created: list[str] = []
    invitations_to_send: list[tuple[str, str]] = []
    try:
        for row in valid_rows:
            email = row["email"]
            account, raw_token = create_pending_account(db, email, role)
            if role == "Teacher":
                attach_staff_profile(db, account.user_id, row)
            else:
                attach_student_profile(db, account.user_id, row)
            invitations_to_send.append((email, raw_token))
            created.append(email)
        db.commit()
    except Exception:
        db.rollback()
        raise

    # Phase 3: email delivery is deliberately outside the database transaction.
    for email, raw_token in invitations_to_send:
        invitation_sender(email, raw_token)

    return {
        "message": "Student import completed" if role == "Student" else "User import completed",
        "total_rows": total_rows,
        "created_count": len(created),
        "failed_count": 0,
        "created_users": created,
        "errors": [],
        "created": len(created),
        "skipped": 0,
        "skipped_emails": [],
    }

import hashlib
import re
import secrets
import uuid
from typing import Any

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.StaffId import generate_staff_id
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.auth.InvitationToken import InvitationToken
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student

# SHARED USER-CREATION HELPERS
# Single-user invitations and bulk imports both use these helpers so they create
# accounts, roles, invitation tokens, and role-specific profiles consistently.


LRN_RE = re.compile(r"^\d{12}$")


def capitalize_name(value: Any) -> str:
    name = str(value or "").strip()
    return f"{name[:1].upper()}{name[1:]}" if name else ""


def sha256_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def normalize_lrn(raw: str) -> str:
    value = (raw or "").strip()
    if value.startswith("'"):
        value = value[1:].strip()

    if value and "E+" in value.upper():
        try:
            return str(int(float(value)))
        except ValueError:
            pass
    return value


def validate_required_name(
    data: dict[str, Any],
    errors: list[dict[str, Any]] | None = None,
    row: int = 0,
    error_factory=None,
) -> None:
    for field in ("first_name", "last_name"):
        if not str(data.get(field) or "").strip():
            if errors is not None and error_factory is not None:
                errors.append(error_factory(row, field, data.get(field, ""), "Required field is missing"))
            else:
                raise HTTPException(status_code=400, detail=f"{field.replace('_', ' ').title()} is required")


def create_pending_account(db: Session, email: str, role_name: str) -> tuple[UserAccount, str]:
    account = UserAccount(
        user_id=uuid.uuid4(),
        email=email,
        password_hash=None,
        account_status="pending",
    )
    db.add(account)
    db.flush()

    role = db.query(Role).filter(Role.role_name == role_name).first()
    if not role:
        raise HTTPException(status_code=400, detail=f"Role '{role_name}' not found in DB")

    db.add(UserRoles(user_id=account.user_id, role_id=role.role_id))
    # Only the hash is persisted; the raw token exists solely for the invitation
    # link and cannot be recovered from the database.
    raw_token = secrets.token_urlsafe(32)
    db.add(InvitationToken(user_id=account.user_id, token_hash=sha256_token(raw_token)))
    return account, raw_token


def resolve_academic_level_id(db: Session, data: dict) -> int | None:
    raw_id = data.get("academic_level_id")
    raw_grade = data.get("grade_level") or data.get("academic_level") or data.get("level_name")

    if raw_id not in (None, ""):
        try:
            level_id = int(raw_id)
        except (TypeError, ValueError):
            level_id = None
        else:
            level = db.query(AcademicLevel).filter(AcademicLevel.academic_level_id == level_id).first()
            if level:
                return level.academic_level_id
            grade_level = db.query(AcademicLevel).filter(AcademicLevel.grade_level == level_id).first()
            if grade_level:
                return grade_level.academic_level_id

    if raw_grade in (None, ""):
        return None

    grade_text = str(raw_grade).strip()
    grade_digits = "".join(ch for ch in grade_text if ch.isdigit())
    if grade_digits:
        level = db.query(AcademicLevel).filter(AcademicLevel.grade_level == int(grade_digits)).first()
        if level:
            return level.academic_level_id

    level = db.query(AcademicLevel).filter(func.lower(AcademicLevel.level_name) == grade_text.lower()).first()
    return level.academic_level_id if level else None


def attach_staff_profile(db: Session, user_id: uuid.UUID, data: dict) -> None:
    db.add(AcademicStaff(
        staff_id=generate_staff_id(db),
        user_id=user_id,
        first_name=capitalize_name(data.get("first_name")),
        middle_name=capitalize_name(data.get("middle_name")),
        last_name=capitalize_name(data.get("last_name")),
        suffix=data.get("suffix", ""),
        gender=data.get("gender", ""),
        contact_number=data.get("contact_number", ""),
        address=data.get("address", ""),
        email=data.get("email", ""),
        hired_date=data.get("hired_date") or None,
        employment_status=data.get("employment_status", ""),
    ))


def attach_student_profile(db: Session, user_id: uuid.UUID, data: dict) -> None:
    db.add(Student(
        student_id=uuid.uuid4(),
        user_id=user_id,
        student_lrn=normalize_lrn(data.get("student_lrn", "")),
        first_name=capitalize_name(data.get("first_name")),
        middle_name=capitalize_name(data.get("middle_name")),
        last_name=capitalize_name(data.get("last_name")),
        suffix=data.get("suffix", ""),
        gender=data.get("gender", ""),
        contact_number=data.get("contact_number", ""),
        address=data.get("address", ""),
        email=data.get("email", ""),
        academic_level_id=resolve_academic_level_id(db, data),
    ))

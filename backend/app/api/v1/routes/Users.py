import csv
import hashlib
import io
import secrets
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
import pandas as pd
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.api.v1.routes.Auth import create_access_token, create_refresh_token, get_current_user, set_auth_cookies
from app.core.Security import hash_password
from app.core.StaffId import generate_staff_id
from app.db.Session import get_db
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.ClassworkAssignment import ClassworkAssignment  # noqa: F401
from app.models.auth.InvitationToken import InvitationToken
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.User import AcceptInvitationRequest, AcceptInvitationResponse, InviteSingleUserRequest
from app.services.MailService import send_invitation_email

router = APIRouter()

ClientRole = Literal["admin", "teacher", "student"]


def _role_name_to_client_role(role_name: str | None) -> ClientRole:
    role = {"Admin": "admin", "Teacher": "teacher", "Student": "student"}.get(role_name or "")
    return role or "student"


@router.get("/users")
def list_users(
    role: ClientRole | None = Query(default=None),
    search: str | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    full_name = func.coalesce(
        func.nullif(func.concat(AcademicStaff.first_name, " ", AcademicStaff.last_name), " "),
        func.nullif(func.concat(Student.first_name, " ", Student.last_name), " "),
    ).label("full_name")

    query = (
        db.query(
            UserAccount.user_id,
            UserAccount.email,
            UserAccount.created_at,
            UserAccount.account_status,
            Role.role_name,
            AcademicStaff.staff_id,
            Student.student_id,
            full_name,
        )
        .join(UserRoles, UserAccount.user_id == UserRoles.user_id)
        .join(Role, UserRoles.role_id == Role.role_id)
        .outerjoin(AcademicStaff, UserAccount.user_id == AcademicStaff.user_id)
        .outerjoin(Student, UserAccount.user_id == Student.user_id)
    )

    if role:
        query = query.filter(Role.role_name == role.title())

    if search:
        keyword = f"%{search.strip()}%"
        query = query.filter(
            or_(
                UserAccount.email.ilike(keyword),
                AcademicStaff.first_name.ilike(keyword),
                AcademicStaff.last_name.ilike(keyword),
                Student.first_name.ilike(keyword),
                Student.last_name.ilike(keyword),
            )
        )

    users = query.order_by(UserAccount.created_at.desc()).all()

    response = []
    for user in users:
        client_role = _role_name_to_client_role(user.role_name)
        item = {
            "id": str(user.user_id),
            "name": (user.full_name or "").strip() or user.email,
            "email": user.email,
            "role": client_role,
            "created_at": user.created_at.date().isoformat() if user.created_at else "",
            "account_status": user.account_status,
        }

        if client_role == "teacher" and user.staff_id:
            teacher_loads = (
                db.query(Subject.subject_name, SubjectLoad.class_id)
                .join(SubjectLoad, Subject.subject_id == SubjectLoad.subject_id)
                .filter(SubjectLoad.staff_id == user.staff_id)
                .filter(SubjectLoad.status == "active")
                .all()
            )
            item["subjects"] = sorted({load.subject_name for load in teacher_loads if load.subject_name})
            item["class_count"] = len({load.class_id for load in teacher_loads if load.class_id is not None})

        if client_role == "student" and user.student_id:
            class_row = (
                db.query(Class.section_name)
                .join(StudentClass, Class.class_id == StudentClass.class_id)
                .filter(StudentClass.student_id == user.student_id)
                .filter(StudentClass.enrollment_status == "enrolled")
                .order_by(StudentClass.enrolled_at.desc())
                .first()
            )
            average = (
                db.query(func.avg(StudentSubmission.grade))
                .filter(StudentSubmission.student_id == user.student_id)
                .filter(StudentSubmission.status == "graded")
                .filter(StudentSubmission.grade.isnot(None))
                .scalar()
            )
            item["section"] = class_row.section_name if class_row else None
            item["average"] = round(float(average)) if average is not None else None

        response.append(item)

    return response


# ── helpers ──────────────────────────────────────────────────────────────────

def _sha256(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _normalize_upload_row(row: dict[str, Any]) -> dict[str, str]:
    return {
        str(key).strip(): "" if value is None else str(value).strip()
        for key, value in row.items()
    }


def _normalize_lrn(raw: str) -> str:
    """
    Fix Excel scientific notation: '9.33553E+11' → '933553000000'.
    Returns the original string if it's already numeric or empty.
    """
    if raw and "E+" in raw.upper():
        try:
            return str(int(float(raw)))
        except ValueError:
            pass
    return raw


async def _read_upload_rows(file: UploadFile) -> tuple[list[dict[str, str]], set[str]]:
    filename = (file.filename or "").lower()
    content = await file.read()

    if filename.endswith(".csv"):
        reader = csv.DictReader(io.StringIO(content.decode("utf-8-sig")))
        fieldnames = {field.strip() for field in reader.fieldnames or []}
        return [_normalize_upload_row(row) for row in reader], fieldnames

    if filename.endswith((".xlsx", ".xls")):
        try:
            frame = pd.read_excel(io.BytesIO(content), dtype=str).fillna("")
        except ImportError as exc:
            raise HTTPException(
                status_code=500,
                detail="Excel upload support requires the openpyxl package.",
            ) from exc
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Unable to read Excel file.") from exc

        fieldnames = {str(column).strip() for column in frame.columns}
        rows = [_normalize_upload_row(row) for row in frame.to_dict(orient="records")]
        return rows, fieldnames

    raise HTTPException(status_code=400, detail="Upload a .csv, .xlsx, or .xls file.")


def _create_pending_account(db: Session, email: str, role_name: str) -> tuple[UserAccount, str]:
    """Create a PENDING UserAccount + InvitationToken. Returns (account, raw_token)."""
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

    raw_token = secrets.token_urlsafe(32)
    db.add(InvitationToken(user_id=account.user_id, token_hash=_sha256(raw_token)))

    return account, raw_token


def _attach_staff_profile(db: Session, user_id: uuid.UUID, data: dict) -> None:
    staff_id = generate_staff_id(db)
    db.add(AcademicStaff(
        staff_id=staff_id,
        user_id=user_id,
        first_name=data.get("first_name", ""),
        middle_name=data.get("middle_name", ""),
        last_name=data.get("last_name", ""),
        suffix=data.get("suffix", ""),
        gender=data.get("gender", ""),
        contact_number=data.get("contact_number", ""),
        address=data.get("address", ""),
        email=data.get("email", ""),
        hired_date=data.get("hired_date") or None,
        employment_status=data.get("employment_status", ""),
    ))


def _attach_student_profile(db: Session, user_id: uuid.UUID, data: dict) -> None:
    db.add(Student(
        student_id=uuid.uuid4(),
        user_id=user_id,
        student_lrn=data.get("student_lrn", ""),
        first_name=data.get("first_name", ""),
        middle_name=data.get("middle_name", ""),
        last_name=data.get("last_name", ""),
        suffix=data.get("suffix", ""),
        gender=data.get("gender", ""),
        contact_number=data.get("contact_number", ""),
        address=data.get("address", ""),
        email=data.get("email", ""),
        academic_level_id=data.get("academic_level_id"),
    ))


# ── single manual invite ──────────────────────────────────────────────────────

@router.post("/users/invite")
def invite_single_user(
    payload: InviteSingleUserRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    if db.query(UserAccount).filter(UserAccount.email == payload.email).first():
        raise HTTPException(status_code=409, detail="Email already registered")

    account, raw_token = _create_pending_account(db, payload.email, payload.role)

    data = payload.model_dump()
    if payload.role == "Teacher":
        _attach_staff_profile(db, account.user_id, data)
    elif payload.role == "Student":
        _attach_student_profile(db, account.user_id, data)

    db.commit()
    send_invitation_email(payload.email, raw_token)
    return {"message": f"Invitation sent to {payload.email}"}


# ── CSV bulk invite ───────────────────────────────────────────────────────────

TEACHER_COLUMNS = {"first_name", "last_name", "email"}
STUDENT_COLUMNS = {"first_name", "last_name", "email", "student_lrn"}


@router.post("/admin/users/upload-csv")
@router.post("/users/upload-csv")
async def upload_csv(
    role: str = Query(..., description="Teacher or Student"),
    file: UploadFile = File(...),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    if role not in ("Teacher", "Student"):
        raise HTTPException(status_code=400, detail="role must be Teacher or Student")

    required = TEACHER_COLUMNS if role == "Teacher" else STUDENT_COLUMNS

    rows, fieldnames = await _read_upload_rows(file)

    if not required.issubset(fieldnames):
        missing = sorted(required - fieldnames)
        raise HTTPException(status_code=400, detail=f"File missing columns: {', '.join(missing)}")

    created: list[str] = []
    skipped: list[str] = []
    seen_emails: set[str] = set()
    seen_student_lrns: set[str] = set()
    invitations_to_send: list[tuple[str, str]] = []

    for row in rows:
        email = (row.get("email") or "").strip().lower()
        if not email:
            continue

        if email in seen_emails:
            skipped.append(email)
            continue
        seen_emails.add(email)

        if db.query(UserAccount).filter(UserAccount.email == email).first():
            skipped.append(email)
            continue

        if role == "Student":
            student_lrn = _normalize_lrn((row.get("student_lrn") or "").strip())

            if not student_lrn or student_lrn in seen_student_lrns:
                skipped.append(email)
                continue
            seen_student_lrns.add(student_lrn)

            if db.query(Student).filter(Student.student_lrn == student_lrn).first():
                skipped.append(email)
                continue

        account, raw_token = _create_pending_account(db, email, role)

        data = {k: (v or "").strip() for k, v in row.items()}
        data["email"] = email

        if role == "Student":
            data["student_lrn"] = student_lrn  # use the normalized value

        if role == "Teacher":
            _attach_staff_profile(db, account.user_id, data)
        else:
            _attach_student_profile(db, account.user_id, data)

        invitations_to_send.append((email, raw_token))
        created.append(email)

    db.commit()

    for email, raw_token in invitations_to_send:
        send_invitation_email(email, raw_token)

    return {"created": len(created), "skipped": len(skipped), "skipped_emails": skipped}


# ── accept invitation (set password) ─────────────────────────────────────────

@router.post("/auth/accept-invitation", response_model=AcceptInvitationResponse)
def accept_invitation(
    payload: AcceptInvitationRequest,
    response: Response,
    db: Session = Depends(get_db),
):
    if payload.password != payload.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match")
    if len(payload.password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    token_hash = _sha256(payload.token)
    invitation = (
        db.query(InvitationToken)
        .filter(InvitationToken.token_hash == token_hash)
        .first()
    )

    if not invitation:
        raise HTTPException(status_code=400, detail="Invalid invitation link")
    expires_at = invitation.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)

    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Invitation link has expired")

    account = db.query(UserAccount).filter(UserAccount.user_id == invitation.user_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="User not found")
    if account.account_status == "active":
        raise HTTPException(status_code=400, detail="Account already activated")

    account.password_hash = hash_password(payload.password)
    account.account_status = "active"
    account.email_verified_at = datetime.now(timezone.utc)

    db.delete(invitation)
    db.commit()

    role_row = (
        db.query(Role)
        .join(UserRoles, Role.role_id == UserRoles.role_id)
        .filter(UserRoles.user_id == account.user_id)
        .first()
    )
    role_name = role_row.role_name.lower() if role_row else "student"

    access_token = create_access_token(str(account.user_id), role_name)
    refresh_token = create_refresh_token(str(account.user_id), role_name)
    set_auth_cookies(response, access_token, refresh_token)

    return AcceptInvitationResponse(
        access_token=access_token,
        role=role_name,
        user_id=str(account.user_id),
    )
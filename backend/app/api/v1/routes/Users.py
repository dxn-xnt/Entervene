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
from sqlalchemy.orm import Session, aliased

import app.models  # noqa: F401
from app.api.v1.routes.Auth import create_access_token, create_refresh_token, get_current_user, set_auth_cookies
from app.core.Security import hash_password
from app.core.StaffId import generate_staff_id
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
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
from app.schemas.User import AcceptInvitationRequest, AcceptInvitationResponse, InviteSingleUserRequest, UpdateUserRequest
from app.services.MailService import send_invitation_email

router = APIRouter()

ClientRole = Literal["admin", "teacher", "student"]
COMMON_STATUSES = {"active", "pending", "inactive", "suspended", "archived"}
STUDENT_STATUSES = COMMON_STATUSES | {"no section assigned", "graduated", "transferred", "dropped"}


def _role_name_to_client_role(role_name: str | None) -> ClientRole:
    role = {"Admin": "admin", "Teacher": "teacher", "Student": "student"}.get(role_name or "")
    return role or "student"


def _normalize_status(status: str) -> str:
    return status.strip().lower()


@router.get("/users")
def list_users(
    role: ClientRole | None = Query(default=None),
    search: str | None = Query(default=None),
    status: str | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    full_name = func.coalesce(
        func.nullif(func.concat(AcademicStaff.first_name, " ", AcademicStaff.last_name), " "),
        func.nullif(func.concat(Student.first_name, " ", Student.last_name), " "),
    ).label("full_name")

    student_academic_level = aliased(AcademicLevel)
    student_grade_level = aliased(AcademicLevel)
    resolved_grade_level = func.coalesce(
        student_academic_level.grade_level,
        student_grade_level.grade_level,
    ).label("grade_level")

    query = (
        db.query(
            UserAccount.user_id,
            UserAccount.email,
            UserAccount.created_at,
            UserAccount.account_status,
            Role.role_name,
            AcademicStaff.staff_id,
            AcademicStaff.first_name.label("staff_first_name"),
            AcademicStaff.middle_name.label("staff_middle_name"),
            AcademicStaff.last_name.label("staff_last_name"),
            AcademicStaff.contact_number.label("staff_contact_number"),
            AcademicStaff.address.label("staff_address"),
            AcademicStaff.employment_status,
            Student.student_id,
            Student.first_name.label("student_first_name"),
            Student.middle_name.label("student_middle_name"),
            Student.last_name.label("student_last_name"),
            Student.contact_number.label("student_contact_number"),
            Student.address.label("student_address"),
            resolved_grade_level,
            full_name,
        )
        .join(UserRoles, UserAccount.user_id == UserRoles.user_id)
        .join(Role, UserRoles.role_id == Role.role_id)
        .outerjoin(AcademicStaff, UserAccount.user_id == AcademicStaff.user_id)
        .outerjoin(Student, UserAccount.user_id == Student.user_id)
        .outerjoin(student_academic_level, Student.academic_level_id == student_academic_level.academic_level_id)
        .outerjoin(student_grade_level, Student.academic_level_id == student_grade_level.grade_level)
    )

    if role:
        query = query.filter(Role.role_name == role.title())

    if status:
        query = query.filter(func.lower(UserAccount.account_status) == status.strip().lower())
    else:
        query = query.filter(func.lower(UserAccount.account_status) != "archived")

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
            item["grade_level"] = user.grade_level
            item["average"] = round(float(average)) if average is not None else None

        response.append(item)

    return response


@router.get("/users/{user_id}")
def get_user_detail(
    user_id: uuid.UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    staff_name = func.nullif(func.concat(AcademicStaff.first_name, " ", AcademicStaff.last_name), " ")
    student_name = func.nullif(func.concat(Student.first_name, " ", Student.last_name), " ")
    full_name = func.coalesce(staff_name, student_name).label("full_name")

    student_academic_level = aliased(AcademicLevel)
    student_grade_level = aliased(AcademicLevel)
    resolved_grade_level = func.coalesce(
        student_academic_level.grade_level,
        student_grade_level.grade_level,
    ).label("grade_level")

    user = (
        db.query(
            UserAccount.user_id,
            UserAccount.email,
            UserAccount.created_at,
            UserAccount.account_status,
            Role.role_name,
            AcademicStaff.staff_id,
            AcademicStaff.first_name.label("staff_first_name"),
            AcademicStaff.middle_name.label("staff_middle_name"),
            AcademicStaff.last_name.label("staff_last_name"),
            AcademicStaff.contact_number.label("staff_contact_number"),
            AcademicStaff.address.label("staff_address"),
            AcademicStaff.employment_status,
            Student.student_id,
            Student.first_name.label("student_first_name"),
            Student.middle_name.label("student_middle_name"),
            Student.last_name.label("student_last_name"),
            Student.contact_number.label("student_contact_number"),
            Student.address.label("student_address"),
            resolved_grade_level,
            full_name,
        )
        .join(UserRoles, UserAccount.user_id == UserRoles.user_id)
        .join(Role, UserRoles.role_id == Role.role_id)
        .outerjoin(AcademicStaff, UserAccount.user_id == AcademicStaff.user_id)
        .outerjoin(Student, UserAccount.user_id == Student.user_id)
        .outerjoin(student_academic_level, Student.academic_level_id == student_academic_level.academic_level_id)
        .outerjoin(student_grade_level, Student.academic_level_id == student_grade_level.grade_level)
        .filter(UserAccount.user_id == user_id)
        .first()
    )

    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    client_role = _role_name_to_client_role(user.role_name)
    item: dict[str, Any] = {
        "id": str(user.user_id),
        "name": (user.full_name or "").strip() or user.email,
        "email": user.email,
        "role": client_role,
        "created_at": user.created_at.date().isoformat() if user.created_at else "",
        "account_status": user.account_status,
        "first_name": (user.staff_first_name if client_role != "student" else user.student_first_name) or "",
        "middle_name": (user.staff_middle_name if client_role != "student" else user.student_middle_name) or "",
        "last_name": (user.staff_last_name if client_role != "student" else user.student_last_name) or "",
        "contact_number": (user.staff_contact_number if client_role != "student" else user.student_contact_number) or "",
        "address": (user.staff_address if client_role != "student" else user.student_address) or "",
    }

    if client_role == "teacher" and user.staff_id:
        teacher_loads = (
            db.query(Subject.subject_name, SubjectLoad.class_id)
            .join(SubjectLoad, Subject.subject_id == SubjectLoad.subject_id)
            .filter(SubjectLoad.staff_id == user.staff_id)
            .filter(SubjectLoad.status == "active")
            .all()
        )
        item["staff_id"] = user.staff_id
        item["employment_status"] = user.employment_status or ""
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
        item["student_id"] = str(user.student_id)
        item["section"] = class_row.section_name if class_row else None
        item["grade_level"] = user.grade_level
        item["student_status"] = "No Section Assigned" if not class_row else user.account_status
        item["graduation_year"] = None
        item["last_grade_level"] = user.grade_level
        item["last_section"] = class_row.section_name if class_row else None
        item["average"] = round(float(average)) if average is not None else None

    return item


@router.put("/users/{user_id}")
def update_user(
    user_id: uuid.UUID,
    payload: UpdateUserRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    account = db.query(UserAccount).filter(UserAccount.user_id == user_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="User not found")
    if (account.account_status or "").lower() == "pending":
        raise HTTPException(status_code=400, detail="Pending accounts cannot be edited until the invitation is accepted")

    role_row = (
        db.query(Role.role_name)
        .join(UserRoles, Role.role_id == UserRoles.role_id)
        .filter(UserRoles.user_id == user_id)
        .first()
    )
    client_role = _role_name_to_client_role(role_row.role_name if role_row else None)
    allowed_statuses = STUDENT_STATUSES if client_role == "student" else COMMON_STATUSES
    status = _normalize_status(payload.account_status)
    if status not in allowed_statuses:
        raise HTTPException(status_code=400, detail="Invalid account status")

    first_name = payload.first_name.strip()
    last_name = payload.last_name.strip()
    email = payload.email.lower()
    if not first_name or not last_name:
        raise HTTPException(status_code=400, detail="First name and last name are required")

    existing_email = db.query(UserAccount).filter(UserAccount.email == email, UserAccount.user_id != user_id).first()
    if existing_email:
        raise HTTPException(status_code=409, detail="Email already registered")

    account.email = email
    account.account_status = status

    if client_role == "student":
        student = db.query(Student).filter(Student.user_id == user_id).first()
        if not student:
            raise HTTPException(status_code=404, detail="Student profile not found")

        student.first_name = first_name
        student.middle_name = payload.middle_name.strip()
        student.last_name = last_name
        student.email = email
        student.contact_number = payload.contact_number.strip()
        student.address = payload.address.strip()

        if payload.grade_level is not None:
            academic_level_id = _resolve_academic_level_id(db, {"grade_level": payload.grade_level})
            if not academic_level_id:
                raise HTTPException(status_code=400, detail="Invalid grade level")
            student.academic_level_id = academic_level_id

        section = (payload.section or "").strip()
        if section:
            class_row = db.query(Class).filter(func.lower(Class.section_name) == section.lower()).first()
            if not class_row:
                raise HTTPException(status_code=400, detail="Section not found")

            current_enrollment = (
                db.query(StudentClass)
                .filter(StudentClass.student_id == student.student_id)
                .filter(StudentClass.enrollment_status == "enrolled")
                .order_by(StudentClass.enrolled_at.desc())
                .first()
            )
            if current_enrollment:
                current_enrollment.class_id = class_row.class_id
            else:
                db.add(StudentClass(student_id=student.student_id, class_id=class_row.class_id, enrollment_status="enrolled"))

    elif client_role == "teacher":
        staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_id).first()
        if not staff:
            raise HTTPException(status_code=404, detail="Teacher profile not found")

        staff.first_name = first_name
        staff.middle_name = payload.middle_name.strip()
        staff.last_name = last_name
        staff.email = email
        staff.contact_number = payload.contact_number.strip()
        staff.address = payload.address.strip()
        staff.employment_status = payload.employment_status.strip()

    else:
        staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_id).first()
        if staff:
            staff.first_name = first_name
            staff.middle_name = payload.middle_name.strip()
            staff.last_name = last_name
            staff.email = email

    db.commit()
    return get_user_detail(user_id=user_id, current_user=current_user, db=db)


@router.patch("/users/{user_id}/archive")
def archive_user(
    user_id: uuid.UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    account = db.query(UserAccount).filter(UserAccount.user_id == user_id).first()
    if not account:
        raise HTTPException(status_code=404, detail="User not found")

    if (account.account_status or "").lower() == "pending":
        raise HTTPException(status_code=400, detail="Pending accounts cannot be archived until the invitation is accepted")

    if (account.account_status or "").lower() == "archived":
        raise HTTPException(status_code=400, detail="User is already archived")

    account.account_status = "archived"
    db.commit()
    return {"message": "User archived successfully."}


@router.get("/users/{user_id}/analytics")
def get_user_analytics(
    user_id: uuid.UUID,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    exists = db.query(UserAccount.user_id).filter(UserAccount.user_id == user_id).first()
    if not exists:
        raise HTTPException(status_code=404, detail="User not found")

    return {
        "summary": None,
        "subject_mastery": [],
        "score_trend": [],
        "historical_performance": [],
        "quarterly_performance": [],
        "subject_breakdown": [],
        "activity_feed": [],
        "classwork": [],
        "lms_behavior": None,
    }


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


def _resolve_academic_level_id(db: Session, data: dict) -> int | None:
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
    academic_level_id = _resolve_academic_level_id(db, data)
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
        academic_level_id=academic_level_id,
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
STUDENT_GRADE_COLUMNS = {"grade_level", "academic_level", "academic_level_id"}


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

    if role == "Student" and not STUDENT_GRADE_COLUMNS.intersection(fieldnames):
        raise HTTPException(
            status_code=400,
            detail="File missing a student grade column: use grade_level with values like 7, 8, 9, 10, 11, or 12.",
        )

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

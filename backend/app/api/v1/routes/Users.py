import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from sqlalchemy import func, or_
from sqlalchemy.orm import Session, aliased

import app.models  # noqa: F401
from app.api.v1.routes.Auth import create_access_token, create_refresh_token, get_current_user, set_auth_cookies
from app.core.Security import hash_password
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
from app.services.classes.ClassService import build_student_class_assignment
from app.services.users.UserImportService import import_users_file
from app.services.users.UserShared import (
    LRN_RE,
    attach_staff_profile as _attach_staff_profile,
    attach_student_profile as _attach_student_profile,
    capitalize_name as _capitalize_name,
    create_pending_account as _create_pending_account,
    normalize_lrn as _normalize_lrn,
    resolve_academic_level_id as _resolve_academic_level_id,
    sha256_token as _sha256,
    validate_required_name as _validate_required_name,
)

router = APIRouter()

ClientRole = Literal["admin", "teacher", "student"]
COMMON_STATUSES = {"active", "pending", "inactive", "suspended", "archived"}
STUDENT_STATUSES = COMMON_STATUSES | {"no section assigned", "graduated", "transferred", "dropped"}


def _role_name_to_client_role(role_name: str | None) -> ClientRole:
    role = {"Admin": "admin", "Teacher": "teacher", "Student": "student"}.get(role_name or "")
    return role or "student"


def _normalize_status(status: str) -> str:
    return status.strip().lower()


def _display_name(first_name: Any, last_name: Any, fallback: str) -> str:
    return " ".join(filter(None, (_capitalize_name(first_name), _capitalize_name(last_name)))) or fallback


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
        first_name = user.student_first_name if client_role == "student" else user.staff_first_name
        last_name = user.student_last_name if client_role == "student" else user.staff_last_name
        item = {
            "id": str(user.user_id),
            "name": _display_name(first_name, last_name, user.email),
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
    first_name = user.student_first_name if client_role == "student" else user.staff_first_name
    middle_name = user.student_middle_name if client_role == "student" else user.staff_middle_name
    last_name = user.student_last_name if client_role == "student" else user.staff_last_name
    item: dict[str, Any] = {
        "id": str(user.user_id),
        "name": _display_name(first_name, last_name, user.email),
        "email": user.email,
        "role": client_role,
        "created_at": user.created_at.date().isoformat() if user.created_at else "",
        "account_status": user.account_status,
        "first_name": _capitalize_name(first_name),
        "middle_name": _capitalize_name(middle_name),
        "last_name": _capitalize_name(last_name),
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

    first_name = _capitalize_name(payload.first_name)
    middle_name = _capitalize_name(payload.middle_name)
    last_name = _capitalize_name(payload.last_name)
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
        student.middle_name = middle_name
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
                current_enrollment.academic_year_id = class_row.academic_year_id
            else:
                db.add(build_student_class_assignment(student.student_id, class_row))

    elif client_role == "teacher":
        staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_id).first()
        if not staff:
            raise HTTPException(status_code=404, detail="Teacher profile not found")

        staff.first_name = first_name
        staff.middle_name = middle_name
        staff.last_name = last_name
        staff.email = email
        staff.contact_number = payload.contact_number.strip()
        staff.address = payload.address.strip()
        staff.employment_status = payload.employment_status.strip()

    else:
        staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_id).first()
        if staff:
            staff.first_name = first_name
            staff.middle_name = middle_name
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

def _validate_student_data(db: Session, data: dict[str, Any], *, user_id: uuid.UUID | None = None) -> None:
    _validate_required_name(data)
    student_lrn = _normalize_lrn(str(data.get("student_lrn") or ""))
    if not LRN_RE.fullmatch(student_lrn):
        raise HTTPException(status_code=400, detail="Student LRN must be exactly 12 digits")

    existing_lrn = db.query(Student).filter(Student.student_lrn == student_lrn).first()
    if existing_lrn and existing_lrn.user_id != user_id:
        raise HTTPException(status_code=409, detail="Student LRN already registered")

    if _resolve_academic_level_id(db, data) is None:
        raise HTTPException(status_code=400, detail="Invalid grade level")


def _validate_staff_data(data: dict[str, Any]) -> None:
    _validate_required_name(data)


# ── single manual invite ──────────────────────────────────────────────────────

@router.post("/users/invite")
def invite_single_user(
    payload: InviteSingleUserRequest,
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if current_user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    email = str(payload.email).lower()
    if db.query(UserAccount).filter(UserAccount.email == email).first():
        raise HTTPException(status_code=409, detail="Email already registered")

    data = payload.model_dump()
    data["email"] = email
    if payload.role == "Student":
        _validate_student_data(db, data)
    elif payload.role == "Teacher":
        _validate_staff_data(data)
    else:
        _validate_required_name(data)

    account, raw_token = _create_pending_account(db, email, payload.role)

    if payload.role == "Teacher":
        _attach_staff_profile(db, account.user_id, data)
    elif payload.role == "Student":
        _attach_student_profile(db, account.user_id, data)

    db.commit()
    send_invitation_email(email, raw_token)
    return {"message": f"Invitation sent to {email}"}


# ── CSV bulk invite ───────────────────────────────────────────────────────────

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
    return await import_users_file(
        db=db,
        file=file,
        role=role,
        invitation_sender=send_invitation_email,
    )


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

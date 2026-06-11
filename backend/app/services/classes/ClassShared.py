from typing import Any

from fastapi import Request
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse

from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff


class ClassManagementError(Exception):
    def __init__(
        self,
        status_code: int,
        message: str,
        code: str,
        errors: list[dict[str, Any]] | None = None,
    ) -> None:
        self.status_code = status_code
        self.payload = {
            "message": message,
            "code": code,
            "errors": errors or [],
        }
        super().__init__(message)


async def class_management_error_handler(
    request: Request,
    exc: ClassManagementError,
) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content=exc.payload)


def resolve_active_academic_year(db: Session) -> AcademicYear:
    active_years = (
        db.query(AcademicYear)
        .filter(AcademicYear.is_active.is_(True))
        .limit(2)
        .all()
    )

    if not active_years:
        raise ClassManagementError(
            status_code=409,
            message="Active academic year configuration is invalid.",
            code="active_academic_year_missing",
        )
    if len(active_years) > 1:
        raise ClassManagementError(
            status_code=409,
            message="Active academic year configuration is invalid.",
            code="active_academic_year_multiple",
        )

    return active_years[0]


def eligible_advisers_query(db: Session):
    return (
        db.query(AcademicStaff)
        .join(UserAccount, AcademicStaff.user_id == UserAccount.user_id)
        .join(UserRoles, UserAccount.user_id == UserRoles.user_id)
        .join(Role, UserRoles.role_id == Role.role_id)
        .filter(func.lower(UserAccount.account_status) == "active")
        .filter(Role.role_name == "Teacher")
    )


def available_advisers_query(db: Session, academic_year_id: int):
    assigned_in_year = (
        db.query(Class.class_id)
        .filter(Class.adviser_staff_id == AcademicStaff.staff_id)
        .filter(Class.academic_year_id == academic_year_id)
        .exists()
    )
    return eligible_advisers_query(db).filter(~assigned_in_year)


def readable_text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def normalized_text(value: Any) -> str:
    return readable_text(value).casefold()


def normalized_middle_name(value: Any) -> str:
    normalized = normalized_text(value)
    return "" if normalized == "null" else normalized


def student_sort_key(student: Any) -> tuple[int, str, str, str]:
    gender = (student.gender or "").strip().lower()
    if gender in {"male", "m", "boy"}:
        gender_priority = 0
    elif gender in {"female", "f", "girl"}:
        gender_priority = 1
    else:
        gender_priority = 2

    return (
        gender_priority,
        (student.last_name or "").lower(),
        (student.first_name or "").lower(),
        (student.middle_name or "").lower(),
    )

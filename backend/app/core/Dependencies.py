# app/core/Dependencies.py
"""
Role-based dependency factories.
Reuse get_current_user from Auth.py and add role enforcement.
"""
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.Session import get_db
from app.api.v1.routes.Auth import get_current_user
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student


def require_role(*allowed_roles: str):
    """
    FastAPI dependency that restricts access to users with specific roles.

    Usage:
        current_user = Depends(require_role("teacher"))
    """
    def _dependency(
        current_user: dict = Depends(get_current_user),
    ):
        user_role = current_user.get("role", "")
        if user_role not in allowed_roles:
            raise HTTPException(
                status_code=403,
                detail=f"Access denied. Required role(s): {', '.join(allowed_roles)}",
            )
        return current_user
    return _dependency


import uuid as _uuid

def get_staff_id(
    current_user: dict = Depends(require_role("teacher", "admin")),
    db: Session = Depends(get_db),
) -> str:
    """Resolve the staff_id from the JWT user_id."""
    raw_user_id = current_user.get("sub") or current_user.get("user_id")
    if not raw_user_id:
        raise HTTPException(status_code=404, detail="Staff profile not found")
    
    try:
        user_id = _uuid.UUID(str(raw_user_id)) if isinstance(raw_user_id, str) else raw_user_id
    except ValueError:
        user_id = raw_user_id

    staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_id).first()
    if not staff:
        raise HTTPException(status_code=404, detail="Staff profile not found")
    return staff.staff_id


def get_optional_staff_id(
    current_user: dict = Depends(require_role("teacher", "admin")),
    db: Session = Depends(get_db),
) -> str | None:
    """Safely resolve staff_id if present, without failing for admin users without staff profile."""
    raw_user_id = current_user.get("sub") or current_user.get("user_id")
    if not raw_user_id:
        return None

    try:
        user_id = _uuid.UUID(str(raw_user_id)) if isinstance(raw_user_id, str) else raw_user_id
    except ValueError:
        user_id = raw_user_id

    staff = db.query(AcademicStaff).filter(AcademicStaff.user_id == user_id).first()
    return staff.staff_id if staff else None


def get_student_record(
    current_user: dict = Depends(require_role("student")),
    db: Session = Depends(get_db),
) -> Student:
    """Resolve the Student ORM object from the JWT user_id."""
    user_id = current_user["sub"]
    student = db.query(Student).filter(Student.user_id == user_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student profile not found")
    return student

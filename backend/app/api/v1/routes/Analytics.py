from __future__ import annotations

from typing import Literal
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.db.Session import get_db
from app.services.activity.AnalyticsService import (
    build_class_overview,
    build_subject_overview,
    build_system_overview,
    build_teacher_overview,
    get_target_period,
)

router = APIRouter()

ScopeType = Literal["system", "teacher", "class", "subject"]


@router.get("/overview")
def get_overview_metrics(
    scope: ScopeType = Query(default="system"),
    staff_id: str | None = Query(default=None),
    class_id: int | None = Query(default=None),
    subject_id: int | None = Query(default=None),
    academic_period_id: int | None = Query(default=None),
    current_user: dict = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Returns dynamic overview card statistics relative to the active or specified academic term.
    Supports scopes:
    - 'system': system-wide totals for admin dashboard
    - 'teacher': teacher-scoped subjects, classes, students, ungraded tasks
    - 'class': class-scoped students, subjects, average performance
    - 'subject': subject-scoped classes, teachers, lessons, classworks
    """
    user_role = current_user.get("role")
    user_id = current_user.get("user_id") or current_user.get("sub")

    target_period = get_target_period(db, academic_period_id=academic_period_id)

    if scope == "system":
        if user_role != "admin":
            raise HTTPException(status_code=403, detail="Admin access required for system overview")
        return build_system_overview(db=db, target_period=target_period)

    elif scope == "teacher":
        target_staff_id = staff_id
        if not target_staff_id:
            # Fallback to current authenticated user's ID
            target_staff_id = user_id

        # Non-admins can only see their own teacher overview
        if user_role not in ["admin", "teacher"]:
            raise HTTPException(status_code=403, detail="Teacher or Admin access required")

        return build_teacher_overview(
            db=db,
            staff_id_or_user_id=target_staff_id,
            target_period=target_period,
        )

    elif scope == "class":
        if not class_id:
            raise HTTPException(status_code=400, detail="class_id is required for class scope")
        return build_class_overview(
            db=db,
            class_id=class_id,
            target_period=target_period,
        )

    elif scope == "subject":
        if not subject_id:
            raise HTTPException(status_code=400, detail="subject_id is required for subject scope")
        return build_subject_overview(
            db=db,
            subject_id=subject_id,
            target_period=target_period,
        )

    raise HTTPException(status_code=400, detail=f"Unsupported scope: {scope}")

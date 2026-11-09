from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.core.Dependencies import require_role
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import ModelPurpose
from app.services.prediction import DevelopmentCurrentTermPredictionReadService as read_service
from app.services.prediction.CurrentTermV3Domain import resolve_v3_academic_scope
from app.services.prediction.ModelVersionService import get_production_model_versions
from app.services.prediction.V3PredictionScopeAuthorizationService import authorize_v3_prediction_view


router = APIRouter()


def _approved_current_term_model(db: Session):
    versions = get_production_model_versions(
        db,
        ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION,
    )
    if len(versions) != 1:
        raise HTTPException(
            status_code=503,
            detail="Approved current-term prediction model is unavailable.",
        )
    return versions[0]


@router.get("/scope")
def read_admin_current_term_scope(
    academic_period_id: int = Query(..., gt=0),
    _admin: dict = Depends(require_role("admin")),
    db: Session = Depends(get_db),
) -> dict:
    """Return valid school-wide read scopes for one selected academic term.

    Scope discovery is deliberately based on the academic setup rather than
    legacy ``ai_prediction`` rows. A valid scope requires an active published
    subject-load version whose class belongs to the selected period's academic
    year and whose class/subject pair is supported by the current-term domain.
    """
    period = db.get(AcademicPeriod, academic_period_id)
    if period is None:
        raise HTTPException(status_code=404, detail="Academic period not found.")

    rows = (
        db.query(SubjectLoad, Class, Subject, AcademicLevel)
        .join(Class, SubjectLoad.class_id == Class.class_id)
        .join(Subject, SubjectLoad.subject_id == Subject.subject_id)
        .outerjoin(AcademicLevel, Class.academic_level_id == AcademicLevel.academic_level_id)
        .filter(
            SubjectLoad.academic_period_id == academic_period_id,
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(("published", "active")),
            Class.academic_year_id == period.academic_year_id,
        )
        .order_by(
            AcademicLevel.grade_level.asc(),
            Class.section_name.asc(),
            Subject.subject_name.asc(),
            SubjectLoad.subject_load_id.asc(),
        )
        .all()
    )

    scopes_by_key: dict[tuple[int, int], dict] = {}
    for _load, class_, subject, level in rows:
        domain = resolve_v3_academic_scope(db, class_.class_id, subject.subject_id)
        if not domain["supported"]:
            continue
        scopes_by_key.setdefault(
            (class_.class_id, subject.subject_id),
            {
                "class_id": class_.class_id,
                "section_name": class_.section_name,
                "grade_level": level.grade_level if level is not None else None,
                "subject_id": subject.subject_id,
                "subject_name": subject.subject_name,
                "subject_codename": subject.subject_codename,
            },
        )

    scopes = list(scopes_by_key.values())
    classes_by_id = {
        scope["class_id"]: {
            "class_id": scope["class_id"],
            "section_name": scope["section_name"],
            "grade_level": scope["grade_level"],
        }
        for scope in scopes
    }
    subjects_by_id = {
        scope["subject_id"]: {
            "subject_id": scope["subject_id"],
            "subject_name": scope["subject_name"],
            "subject_codename": scope["subject_codename"],
            "period_index": None,
        }
        for scope in scopes
    }
    grades = sorted({scope["grade_level"] for scope in scopes if scope["grade_level"] is not None})
    periods = (
        db.query(AcademicPeriod)
        .filter(AcademicPeriod.academic_year_id == period.academic_year_id)
        .order_by(AcademicPeriod.period_sequence.asc(), AcademicPeriod.academic_period_id.asc())
        .all()
    )

    return {
        "filters": {
            "grades": [
                {"grade_level": grade, "level_name": f"Grade {grade}"}
                for grade in grades
            ],
            "classes": list(classes_by_id.values()),
            "subjects": list(subjects_by_id.values()),
            "terms": [
                {
                    "term_number": item.period_sequence,
                    "term_label": item.period_name,
                    "academic_period_id": item.academic_period_id,
                }
                for item in periods
            ],
        },
        "scopes": scopes,
    }


@router.get("")
def list_current_term_predictions(
    class_id: int = Query(..., gt=0),
    subject_id: int = Query(..., gt=0),
    academic_period_id: int = Query(..., gt=0),
    current_user: dict = Depends(require_role("admin", "teacher")),
    db: Session = Depends(get_db),
) -> dict:
    access = authorize_v3_prediction_view(
        db,
        current_user,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
    )
    domain = resolve_v3_academic_scope(db, class_id, subject_id)
    if not domain["supported"]:
        raise HTTPException(
            status_code=404,
            detail="Current-term predictions are unavailable for this academic scope.",
        )
    version = _approved_current_term_model(db)
    return read_service.list_latest_development_current_term_predictions(
        db,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
        model_version_id=version.model_version_id,
        require_active_enrollment=access.require_active_enrollment,
        lifecycle_status="PRODUCTION",
    )

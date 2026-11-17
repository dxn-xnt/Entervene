"""Refresh the selected current-term prediction after a committed grade change."""

from __future__ import annotations

import logging
from collections.abc import Iterable
from uuid import UUID

from sqlalchemy.engine import Connectable
from sqlalchemy.orm import Session

from app.core.Config import settings
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction.DevelopmentCurrentTermPredictionPersistenceService import (
    generate_and_persist_current_term,
)
from app.services.prediction.ModelVersionService import get_production_model_versions


logger = logging.getLogger(__name__)


def refresh_after_committed_grade_change(
    bind: Connectable,
    *,
    student_ids: Iterable[UUID],
    class_id: int,
    subject_id: int,
    period_id: int | None,
) -> None:
    """Use the normal generator for changed students, outside the grade transaction."""
    students = set(student_ids)
    environment = settings.app_environment.lower()
    if not students or period_id is None:
        return
    if environment in {"development", "test"} and (
        not settings.development_prediction_api_enabled
        or settings.development_current_term_model_name != CORRECTED_MODEL_NAME
    ):
        return
    if environment not in {"development", "test", "production"}:
        return

    try:
        with Session(bind) as db:
            if environment == "production":
                versions = [
                    (version.model_version_id,)
                    for version in get_production_model_versions(
                        db, ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION,
                    )
                ]
            else:
                versions = db.query(AIModelVersion.model_version_id).filter(
                    AIModelVersion.model_name == CORRECTED_MODEL_NAME,
                    AIModelVersion.model_purpose == ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value,
                    AIModelVersion.lifecycle_status == "DEVELOPMENT",
                    AIModelVersion.is_active.is_(False),
                    AIModelVersion.production_validated.is_(False),
                    AIModelVersion.independent_three_term_validation.is_(False),
                ).all()
        if len(versions) != 1:
            return
        model_version_id = versions[0][0]
    except Exception:
        logger.exception("Development prediction model lookup failed after grade commit")
        return

    for student_id in students:
        try:
            generate_and_persist_current_term(
                student_id,
                class_id,
                subject_id,
                period_id,
                model_version_id=model_version_id,
                bind=bind,
            )
        except Exception:
            logger.exception(
                "Development prediction refresh failed after grade commit for student %s",
                student_id,
            )

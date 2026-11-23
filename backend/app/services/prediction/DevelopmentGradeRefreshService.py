"""Refresh the selected current-term prediction after a committed grade change."""

from __future__ import annotations

import logging
from collections.abc import Iterable
from uuid import UUID

from sqlalchemy.engine import Connectable
from sqlalchemy.orm import Session

from app.core.Config import settings
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.services.prediction.DevelopmentCurrentTermModelResolver import (
    DUPLICATE_MODEL_REGISTRY_ENTRY,
    MODEL_REGISTRY_ENTRY_NOT_FOUND,
    SelectedModelResolutionError,
    resolve_selected_development_model,
)
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
    trigger_assignment_id: int | None = None,
) -> None:
    """Use the normal generator for changed students, outside the grade transaction."""
    students = set(student_ids)
    environment = settings.app_environment.lower()
    if not students or period_id is None:
        return
    if environment not in {"development", "test", "production"}:
        logger.warning(
            "Current-term prediction refresh skipped reason_code=PREDICTION_FEATURE_DISABLED"
        )
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
                version = resolve_selected_development_model(db)
                versions = [(version.model_version_id,)]
        if len(versions) != 1:
            logger.warning(
                "Current-term prediction refresh skipped reason_code=%s",
                MODEL_REGISTRY_ENTRY_NOT_FOUND if not versions else DUPLICATE_MODEL_REGISTRY_ENTRY,
            )
            return
        model_version_id = versions[0][0]
    except SelectedModelResolutionError as exc:
        logger.warning(
            "Current-term prediction refresh skipped reason_code=%s",
            exc.reason_code,
        )
        return
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
                trigger_assignment_id=trigger_assignment_id,
            )
        except Exception:
            logger.exception(
                "Development prediction refresh failed after grade commit for student %s",
                student_id,
            )

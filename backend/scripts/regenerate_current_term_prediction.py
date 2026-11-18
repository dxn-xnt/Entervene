"""Inspect or regenerate one current-term prediction using backend/.env."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from uuid import UUID


BACKEND_DIR = Path(__file__).resolve().parents[1]
os.environ["ENV_FILE"] = str(BACKEND_DIR / ".env")
sys.path.insert(0, str(BACKEND_DIR))

from sqlalchemy.engine import make_url  # noqa: E402

from app.core.Config import settings  # noqa: E402
from app.db.Session import SessionLocal  # noqa: E402
from app.services.prediction.ScopedCurrentTermRegenerationService import (  # noqa: E402
    apply_scoped_current_term_regeneration,
    inspect_scoped_current_term_regeneration,
)


def _require_main_local_environment() -> None:
    url = make_url(settings.database_url)
    if (
        settings.app_environment.lower() != "development"
        or url.host not in {"localhost", "127.0.0.1"}
        or (url.database or "").casefold() != "entervene"
        or not settings.allow_local_corrected_prediction_model
    ):
        raise ValueError(
            "Scoped regeneration requires the explicitly opted-in main local Entervene development database."
        )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--student-id", type=UUID, required=True)
    parser.add_argument("--class-id", type=int, required=True)
    parser.add_argument("--subject-id", type=int, required=True)
    parser.add_argument("--period-id", type=int, required=True)
    parser.add_argument("--apply", action="store_true", help="Persist the exact selected scope; default is dry-run.")
    args = parser.parse_args()
    if min(args.class_id, args.subject_id, args.period_id) < 1:
        parser.error("Class, subject, and period identifiers must be positive.")

    _require_main_local_environment()
    with SessionLocal() as db:
        if args.apply:
            result = apply_scoped_current_term_regeneration(
                db,
                student_id=args.student_id,
                class_id=args.class_id,
                subject_id=args.subject_id,
                period_id=args.period_id,
                bind=db.get_bind(),
            )
        else:
            result = inspect_scoped_current_term_regeneration(
                db,
                student_id=args.student_id,
                class_id=args.class_id,
                subject_id=args.subject_id,
                period_id=args.period_id,
            )
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    main()

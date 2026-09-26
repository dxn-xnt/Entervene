"""Dry-run or reconcile existing latest corrected predictions in Entervene_Demo."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session


BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
ENV_FILE = BACKEND_DIR / ".env.demo"
load_dotenv(ENV_FILE, override=True)
os.environ["ENV_FILE"] = str(ENV_FILE)

from app.core.Config import settings  # noqa: E402
from app.models.ai.AIModelVersion import AIModelVersion  # noqa: E402
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction  # noqa: E402
from app.services.intervention.InterventionReconciliationService import reconcile_existing_candidate  # noqa: E402
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME  # noqa: E402
from app.services.prediction.PredictionGenerationTransaction import run_prediction_generation_transaction  # noqa: E402


def _require_demo_database(db: Session) -> None:
    if db.scalar(text("select current_database()")) != "Entervene_Demo":
        raise RuntimeError("Refusing to reconcile outside Entervene_Demo")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Commit eligible candidates to Entervene_Demo")
    args = parser.parse_args()
    url = make_url(settings.database_url)
    if (
        url.drivername.split("+")[0] != "postgresql"
        or url.host not in {"localhost", "127.0.0.1"}
        or url.database != "Entervene_Demo"
        or settings.app_environment.lower() != "development"
        or not settings.development_prediction_api_enabled
        or settings.development_current_term_model_name != CORRECTED_MODEL_NAME
    ):
        raise RuntimeError("A verified local .env.demo corrected-development configuration is required")
    engine = create_engine(url, pool_pre_ping=True)
    try:
        with Session(engine) as db:
            _require_demo_database(db)
            rows = db.query(DevelopmentCurrentTermPrediction).join(
                AIModelVersion, DevelopmentCurrentTermPrediction.model_version_id == AIModelVersion.model_version_id,
            ).filter(AIModelVersion.model_name == CORRECTED_MODEL_NAME).order_by(
                DevelopmentCurrentTermPrediction.revision.desc(),
                DevelopmentCurrentTermPrediction.prediction_id.desc(),
            ).all()
            latest = {}
            for row in rows:
                scope = (
                    row.student_id, row.class_id, row.subject_id,
                    row.source_period_id, row.target_period_id, row.model_version_id,
                )
                latest.setdefault(scope, row.prediction_id)
            ids = list(latest.values())
        results = []
        for prediction_id in ids:
            if args.apply:
                with Session(engine) as read_db:
                    _require_demo_database(read_db)
                    row = read_db.get(DevelopmentCurrentTermPrediction, prediction_id)
                    scope = dict(
                        student_id=row.student_id, class_id=row.class_id,
                        subject_id=row.subject_id, source_period_id=row.source_period_id,
                        target_period_id=row.target_period_id,
                    )
                    model_version_id = row.model_version_id

                def reconcile(db: Session) -> str:
                    _require_demo_database(db)
                    return reconcile_existing_candidate(db, prediction_id, apply=True)

                outcome = run_prediction_generation_transaction(
                    scope, str(model_version_id), reconcile, bind=engine,
                )
            else:
                with Session(engine) as db:
                    _require_demo_database(db)
                    outcome = reconcile_existing_candidate(db, prediction_id)
            results.append({"prediction_id": prediction_id, "outcome": outcome})
        print(json.dumps({"database": "Entervene_Demo", "applied": args.apply, "results": results}))
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()

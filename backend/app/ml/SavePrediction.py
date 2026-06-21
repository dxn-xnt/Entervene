from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.db.Session import SessionLocal
from app.services.ModelScoringService import DEFAULT_MODEL_NAME
from app.services.PredictionPersistenceService import score_and_persist_prediction


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Score and persist one Entervene prediction request.")
    parser.add_argument("--model-name", default=DEFAULT_MODEL_NAME)
    parser.add_argument("--input-json", required=True, type=Path)
    parser.add_argument("--replace-existing", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    prediction_request = json.loads(args.input_json.read_text(encoding="utf-8"))
    db = SessionLocal()
    try:
        result = score_and_persist_prediction(
            db,
            prediction_request,
            model_name=args.model_name,
            replace_existing=args.replace_existing,
        )
    finally:
        db.close()
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

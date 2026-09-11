from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.services.prediction.ModelScoringService import DEFAULT_MODEL_NAME
from app.services.prediction.PredictionGenerationTransaction import run_prediction_generation_transaction
from app.services.prediction.PredictionPersistenceService import score_and_persist_prediction


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Score and persist one Entervene prediction request.")
    parser.add_argument("--model-name", default=DEFAULT_MODEL_NAME)
    parser.add_argument("--input-json", required=True, type=Path)
    parser.add_argument("--replace-existing", action="store_true")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    prediction_request = json.loads(args.input_json.read_text(encoding="utf-8"))
    result = run_prediction_generation_transaction(
        prediction_request,
        args.model_name,
        lambda generation_db: score_and_persist_prediction(
            generation_db,
            prediction_request,
            model_name=args.model_name,
            replace_existing=args.replace_existing,
            commit=False,
        ),
    )
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()

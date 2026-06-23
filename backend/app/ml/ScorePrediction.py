from __future__ import annotations

import argparse
import json
from pathlib import Path

from app.db.Session import SessionLocal
from app.services.ModelScoringService import DEFAULT_MODEL_NAME, score_student_prediction


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Score one Entervene prediction input with the active model.")
    parser.add_argument("--model-name", default=DEFAULT_MODEL_NAME)
    parser.add_argument("--input-json", required=True, type=Path)
    parser.add_argument("--output-json", type=Path)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    input_data = json.loads(args.input_json.read_text(encoding="utf-8"))
    db = SessionLocal()
    try:
        result = score_student_prediction(db, input_data, model_name=args.model_name)
    finally:
        db.close()

    output = json.dumps(result, indent=2, sort_keys=True)
    print(output)
    if args.output_json:
        args.output_json.parent.mkdir(parents=True, exist_ok=True)
        args.output_json.write_text(output, encoding="utf-8")


if __name__ == "__main__":
    main()

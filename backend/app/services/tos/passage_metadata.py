"""Versioned passage storage using the existing Text column; no migration.

Plain explanations from older exams are returned verbatim. The API never
exposes the storage envelope as the answer rationale.
"""
import json

from app.schemas.AITOS import TOSPassage, TOSQuestionIn

PREFIX = "[TOS-PASSAGE:v1]"


def encode_question_metadata(question: TOSQuestionIn) -> str | None:
    if question.passage is None:
        return question.explanation
    return PREFIX + json.dumps({
        "explanation": question.explanation,
        "passage": question.passage.model_dump(),
        "passage_id": question.passage_id,
    }, ensure_ascii=False)


def decode_question_metadata(value: str | None) -> dict:
    if value and value.startswith(PREFIX):
        try:
            data = json.loads(value[len(PREFIX):])
            passage = TOSPassage.model_validate(data["passage"])
            explanation = data.get("explanation")
            if data["passage_id"] == passage.id and (explanation is None or isinstance(explanation, str)):
                return {"explanation": explanation, "passage": passage, "passage_id": passage.id}
        except (ValueError, KeyError, TypeError):
            pass
    return {"explanation": value, "passage": None, "passage_id": None}

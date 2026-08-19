import pytest
from app.services.ai.AIQuizGeneratorService import (
    _build_quiz_prompt,
    _extract_and_validate_json,
)


def test_build_quiz_prompt():
    prompt = _build_quiz_prompt(
        subject="Science 7",
        lessons=["Photosynthesis", "Cellular Respiration"],
        content_text="Plants convert sunlight into chemical energy.",
        test_parts=[
            {"type": "MULTIPLE_CHOICE", "count": 5, "difficulty_breakdown": {"EASY": 3, "MEDIUM": 2}},
            {"type": "SHORT_ANSWER", "count": 2, "difficulty_breakdown": {"HARD": 2}},
        ],
    )
    assert "Subject: Science 7" in prompt
    assert "Photosynthesis" in prompt
    assert "MULTIPLE_CHOICE" in prompt
    assert "SHORT_ANSWER" in prompt
    assert "Plants convert sunlight" in prompt


def test_extract_and_validate_json_success():
    raw_ai_response = """
    ```json
    {
      "questions": [
        {
          "question_text": "What is the powerhouse of the cell?",
          "question_type": "MULTIPLE_CHOICE",
          "points": 1.0,
          "display_order": 1,
          "difficulty_level": "EASY",
          "explanation": "Mitochondria generates ATP.",
          "options": [
            {"option_text": "Nucleus", "is_correct": false, "option_order": 1},
            {"option_text": "Mitochondria", "is_correct": true, "option_order": 2},
            {"option_text": "Ribosome", "is_correct": false, "option_order": 3},
            {"option_text": "Chloroplast", "is_correct": false, "option_order": 4}
          ]
        },
        {
          "question_text": "Define photosynthesis.",
          "question_type": "SHORT_ANSWER",
          "points": 2.0,
          "display_order": 2,
          "difficulty_level": "MEDIUM",
          "explanation": "Process by which green plants synthesize nutrients using sunlight.",
          "options": []
        }
      ]
    }
    ```
    """
    questions = _extract_and_validate_json(raw_ai_response)
    assert len(questions) == 2
    assert questions[0]["question_text"] == "What is the powerhouse of the cell?"
    assert questions[0]["question_type"] == "MULTIPLE_CHOICE"
    assert len(questions[0]["options"]) == 4
    assert questions[0]["options"][1]["is_correct"] is True

    assert questions[1]["question_text"] == "Define photosynthesis."
    assert questions[1]["question_type"] == "SHORT_ANSWER"
    assert questions[1]["options"] == []

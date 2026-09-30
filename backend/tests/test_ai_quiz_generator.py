import json
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

    correct_opts = [o for o in questions[0]["options"] if o["is_correct"]]
    assert len(correct_opts) == 1
    assert correct_opts[0]["option_text"] == "Mitochondria"
    for idx, opt in enumerate(questions[0]["options"], start=1):
        assert opt["option_order"] == idx

    assert questions[1]["question_text"] == "Define photosynthesis."
    assert questions[1]["question_type"] == "SHORT_ANSWER"
    assert questions[1]["options"] == []


def test_quiz_mc_shuffle_distribution():
    raw_ai_response = json.dumps({
        "questions": [
            {
                "question_text": "What is the chemical formula for water?",
                "question_type": "MULTIPLE_CHOICE",
                "options": [
                    {"option_text": "H2O", "is_correct": True, "option_order": 1},
                    {"option_text": "CO2", "is_correct": False, "option_order": 2},
                    {"option_text": "NaCl", "is_correct": False, "option_order": 3},
                    {"option_text": "O2", "is_correct": False, "option_order": 4},
                ],
            }
        ]
    })

    seen_orders = set()
    for _ in range(60):
        validated = _extract_and_validate_json(raw_ai_response)
        assert len(validated) == 1
        opts = validated[0]["options"]
        assert len(opts) == 4

        correct = [o for o in opts if o["is_correct"]]
        assert len(correct) == 1
        assert correct[0]["option_text"] == "H2O"

        for idx, o in enumerate(opts, start=1):
            assert o["option_order"] == idx

        seen_orders.add(correct[0]["option_order"])

    assert len(seen_orders) >= 3


def test_quiz_relative_options_never_shuffled():
    for rel_text in [
        "All of the above",
        "None of the above",
        "Both A and B",
        "A and C only",
        "A, B, and C",
        "Neither A nor B",
        "Option B and C",
    ]:
        raw = json.dumps({
            "questions": [
                {
                    "question_text": "Sample relative question",
                    "question_type": "MULTIPLE_CHOICE",
                    "options": [
                        {"option_text": "Statement 1", "is_correct": False, "option_order": 1},
                        {"option_text": "Statement 2", "is_correct": False, "option_order": 2},
                        {"option_text": "Statement 3", "is_correct": False, "option_order": 3},
                        {"option_text": rel_text, "is_correct": True, "option_order": 4},
                    ],
                }
            ]
        })

        for _ in range(15):
            validated = _extract_and_validate_json(raw)
            opts = validated[0]["options"]
            assert opts[0]["option_text"] == "Statement 1"
            assert opts[1]["option_text"] == "Statement 2"
            assert opts[2]["option_text"] == "Statement 3"
            assert opts[3]["option_text"] == rel_text
            assert opts[3]["option_order"] == 4
            assert opts[3]["is_correct"] is True


def test_quiz_lowercase_math_variables_allowed_to_shuffle():
    # Lowercase math variables should NOT be flagged as relative options and should shuffle
    raw = json.dumps({
        "questions": [
            {
                "question_text": "Which condition holds?",
                "question_type": "MULTIPLE_CHOICE",
                "options": [
                    {"option_text": "a and b are real numbers", "is_correct": True, "option_order": 1},
                    {"option_text": "a or b", "is_correct": False, "option_order": 2},
                    {"option_text": "x = a and y = b", "is_correct": False, "option_order": 3},
                    {"option_text": "c and d are constants", "is_correct": False, "option_order": 4},
                ],
            }
        ]
    })

    seen_orders = set()
    for _ in range(60):
        validated = _extract_and_validate_json(raw)
        opts = validated[0]["options"]
        correct = [o for o in opts if o["is_correct"]]
        assert len(correct) == 1
        assert correct[0]["option_text"] == "a and b are real numbers"
        seen_orders.add(correct[0]["option_order"])

    # Over 60 runs, it should distribute across positions, proving shuffle occurred
    assert len(seen_orders) >= 3


def test_quiz_fallback_warn_and_discard_when_no_correct_option():
    # When one question has a valid correct option and another has none,
    # the question without a correct option must be discarded, not biased to Option A
    raw_mixed = json.dumps({
        "questions": [
            {
                "question_text": "Valid question",
                "question_type": "MULTIPLE_CHOICE",
                "options": [
                    {"option_text": "Correct Option", "is_correct": True, "option_order": 1},
                    {"option_text": "Wrong Option 1", "is_correct": False, "option_order": 2},
                    {"option_text": "Wrong Option 2", "is_correct": False, "option_order": 3},
                    {"option_text": "Wrong Option 3", "is_correct": False, "option_order": 4},
                ],
            },
            {
                "question_text": "Invalid question with no correct option",
                "question_type": "MULTIPLE_CHOICE",
                "options": [
                    {"option_text": "Alpha", "is_correct": False, "option_order": 1},
                    {"option_text": "Beta", "is_correct": False, "option_order": 2},
                    {"option_text": "Gamma", "is_correct": False, "option_order": 3},
                    {"option_text": "Delta", "is_correct": False, "option_order": 4},
                ],
            },
        ]
    })

    validated = _extract_and_validate_json(raw_mixed)
    assert len(validated) == 1
    assert validated[0]["question_text"] == "Valid question"

    # If all questions in the batch have no correct option, it raises 502 HTTPException
    raw_all_invalid = json.dumps({
        "questions": [
            {
                "question_text": "Invalid only",
                "question_type": "MULTIPLE_CHOICE",
                "options": [
                    {"option_text": "Alpha", "is_correct": False, "option_order": 1},
                    {"option_text": "Beta", "is_correct": False, "option_order": 2},
                    {"option_text": "Gamma", "is_correct": False, "option_order": 3},
                    {"option_text": "Delta", "is_correct": False, "option_order": 4},
                ],
            }
        ]
    })
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as exc_info:
        _extract_and_validate_json(raw_all_invalid)
    assert exc_info.value.status_code == 502

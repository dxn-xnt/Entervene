import json
import pytest
from app.services.ai.AITOSGeneratorService import (
    _extract_and_validate_tos_json,
    _has_positional_or_relative_options,
)


def test_has_positional_or_relative_options():
    # Cases that MUST match (don't shuffle)
    assert _has_positional_or_relative_options([{"option_text": "Both A and B"}])
    assert _has_positional_or_relative_options([{"option_text": "A and C only"}])
    assert _has_positional_or_relative_options([{"option_text": "A, B, and C"}])
    assert _has_positional_or_relative_options([{"option_text": "Neither A nor B"}])
    assert _has_positional_or_relative_options([{"option_text": "All of the above"}])
    assert _has_positional_or_relative_options([{"option_text": "Option B and C"}])
    assert _has_positional_or_relative_options([{"option_text": "None of the above"}])
    assert _has_positional_or_relative_options([{"option_text": "Both A & B"}])
    assert _has_positional_or_relative_options([{"option_text": "Any of the above"}])
    assert _has_positional_or_relative_options([{"option_text": "All of the choices"}])

    # Cases with lowercase variables that MUST NOT match (shuffle allowed)
    assert not _has_positional_or_relative_options([{"option_text": "a and b are real numbers"}])
    assert not _has_positional_or_relative_options([{"option_text": "a or b"}])
    assert not _has_positional_or_relative_options([{"option_text": "x = a and y = b"}])
    assert not _has_positional_or_relative_options([{"option_text": "Both have the same solution set {3}."}])
    assert not _has_positional_or_relative_options([{"option_text": "c and d are constants"}])
    assert not _has_positional_or_relative_options([{"option_text": "Both equations are linear"}])
    assert not _has_positional_or_relative_options([{"option_text": "None of the roots are negative numbers"}])
    assert not _has_positional_or_relative_options([{"option_text": "All real numbers greater than 3"}])

    # Other regular math / scientific questions that MUST NOT be detected
    assert not _has_positional_or_relative_options([
        {"option_text": "ax + b = 0"},
        {"option_text": "3x - 5 ≤ 7"},
        {"option_text": "x - 4 ≥ 0"},
        {"option_text": "(4, ∞)"},
    ])
    assert not _has_positional_or_relative_options([
        {"option_text": "Temperature above 100 degrees Celsius"}
    ])


def test_mc_shuffle_distribution_and_integrity():
    raw_ai_response = json.dumps({
        "questions": [
            {
                "question_text": "What is the capital of the Philippines?",
                "question_type": "MULTIPLE_CHOICE",
                "options": [
                    {"option_text": "Manila", "is_correct": True, "option_order": 1},
                    {"option_text": "Cebu", "is_correct": False, "option_order": 2},
                    {"option_text": "Davao", "is_correct": False, "option_order": 3},
                    {"option_text": "Iloilo", "is_correct": False, "option_order": 4},
                ],
            }
        ]
    })

    seen_orders = set()
    for _ in range(60):
        validated = _extract_and_validate_tos_json(raw_ai_response)
        assert len(validated) == 1
        q = validated[0]
        options = q["options"]
        assert len(options) == 4

        # Verify exactly one option is marked correct
        correct_opts = [o for o in options if o["is_correct"]]
        assert len(correct_opts) == 1
        correct_opt = correct_opts[0]

        # Verify is_correct stays attached to "Manila"
        assert correct_opt["option_text"] == "Manila"

        # Verify option_order matches list index + 1
        for idx, o in enumerate(options, start=1):
            assert o["option_order"] == idx

        seen_orders.add(correct_opt["option_order"])

    # Over 60 runs, Manila must have appeared in more than 1 distinct position (not always 1)
    assert len(seen_orders) > 1, f"Correct answer was only seen at orders: {seen_orders}"
    # Verify it has appeared in at least 3 distinct positions over 60 trials
    assert len(seen_orders) >= 3


def test_true_false_never_shuffled():
    raw_tf = json.dumps({
        "questions": [
            {
                "question_text": "The earth is flat.",
                "question_type": "TRUE_FALSE",
                "options": [
                    {"option_text": "True", "is_correct": False, "option_order": 1},
                    {"option_text": "False", "is_correct": True, "option_order": 2},
                ],
            }
        ]
    })

    for _ in range(30):
        validated = _extract_and_validate_tos_json(raw_tf)
        q = validated[0]
        opts = q["options"]
        assert len(opts) == 2
        assert opts[0]["option_text"] == "True"
        assert opts[0]["option_order"] == 1
        assert opts[0]["is_correct"] is False
        assert opts[1]["option_text"] == "False"
        assert opts[1]["option_order"] == 2
        assert opts[1]["is_correct"] is True


def test_relative_options_never_shuffled():
    for rel_text in ["All of the above", "None of the above", "Both A and B", "A and C only"]:
        raw = json.dumps({
            "questions": [
                {
                    "question_text": "Sample relative question",
                    "question_type": "MULTIPLE_CHOICE",
                    "options": [
                        {"option_text": "Choice 1", "is_correct": False, "option_order": 1},
                        {"option_text": "Choice 2", "is_correct": False, "option_order": 2},
                        {"option_text": "Choice 3", "is_correct": False, "option_order": 3},
                        {"option_text": rel_text, "is_correct": True, "option_order": 4},
                    ],
                }
            ]
        })

        for _ in range(20):
            validated = _extract_and_validate_tos_json(raw)
            opts = validated[0]["options"]
            assert opts[0]["option_text"] == "Choice 1"
            assert opts[1]["option_text"] == "Choice 2"
            assert opts[2]["option_text"] == "Choice 3"
            assert opts[3]["option_text"] == rel_text
            assert opts[3]["option_order"] == 4
            assert opts[3]["is_correct"] is True


def test_fallback_does_not_bias_to_a_when_no_correct_option():
    # If AI provides 4 options and NONE are marked is_correct: True, and no hint matches
    raw_no_correct = json.dumps({
        "questions": [
            {
                "question_text": "Unanswerable question with no correct answer",
                "question_type": "MULTIPLE_CHOICE",
                "options": [
                    {"option_text": "Option A", "is_correct": False, "option_order": 1},
                    {"option_text": "Option B", "is_correct": False, "option_order": 2},
                    {"option_text": "Option C", "is_correct": False, "option_order": 3},
                    {"option_text": "Option D", "is_correct": False, "option_order": 4},
                ],
            }
        ]
    })

    # It must NOT silently set Option A to is_correct=True; it drops the invalid question
    validated = _extract_and_validate_tos_json(raw_no_correct)
    assert len(validated) == 0


def test_aitos_generator_service_end_to_end_shuffle_distribution():
    import asyncio
    from unittest.mock import patch
    from app.services.ai.AITOSGeneratorService import generate_tos_row_questions

    async def _run():
        # Simulated AI response where all 10 questions initially have Option A (order 1) marked as correct
        mock_ai_questions = {
            "questions": [
                {
                    "question_text": f"Solve equation #{i}",
                    "question_type": "MULTIPLE_CHOICE",
                    "difficulty_band": "EASY",
                    "cognitive_level": "REMEMBER",
                    "points": 1.0,
                    "explanation": f"Explanation #{i}",
                    "options": [
                        {"option_text": f"Correct Answer #{i}", "is_correct": True, "option_order": 1},
                        {"option_text": f"Distractor #{i}-B", "is_correct": False, "option_order": 2},
                        {"option_text": f"Distractor #{i}-C", "is_correct": False, "option_order": 3},
                        {"option_text": f"Distractor #{i}-D", "is_correct": False, "option_order": 4},
                    ],
                }
                for i in range(1, 11)
            ]
        }

        position_counts = {1: 0, 2: 0, 3: 0, 4: 0}
        total_questions = 0

        with patch("app.services.ai.AITOSGeneratorService.generate_text", return_value=json.dumps(mock_ai_questions)):
            # Generate 5 TOS exams (10 items each = 50 total questions)
            for _ in range(5):
                exam_questions = await generate_tos_row_questions(
                    competency_label="Solving Linear Equations",
                    code="M7-01",
                    subject="Mathematics 7",
                    type_counts={"MULTIPLE_CHOICE": 10},
                    bloom_targets={"REMEMBER": 10},
                )
                assert len(exam_questions) == 10

                for q in exam_questions:
                    total_questions += 1
                    correct_opts = [o for o in q["options"] if o["is_correct"]]
                    assert len(correct_opts) == 1
                    corr_opt = correct_opts[0]

                    # Verify correct text integrity
                    assert "Correct Answer #" in corr_opt["option_text"]

                    # Verify valid option orders 1..4
                    orders = [o["option_order"] for o in q["options"]]
                    assert orders == [1, 2, 3, 4]

                    corr_order = corr_opt["option_order"]
                    position_counts[corr_order] += 1

        # Over 50 questions, all 4 positions (A, B, C, D) must be present
        assert len(set(position_counts.keys())) == 4
        for pos, count in position_counts.items():
            assert count > 0, f"Position {pos} had 0 occurrences across 50 questions"

        # Distribution must not be trivially skewed (e.g. Option A should not have > 50% of questions)
        assert position_counts[1] < total_questions * 0.50
        # Every option should have at least 10% representation across 50 questions
        for pos, count in position_counts.items():
            assert count >= total_questions * 0.10, f"Position {pos} had under 10% frequency: {count}/{total_questions}"

    asyncio.run(_run())



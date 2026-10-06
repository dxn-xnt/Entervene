import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.routes.AIAssist import router as ai_assist_router
from app.api.v1.routes.Auth import get_current_user
from app.core.Dependencies import get_staff_id
from app.db.Session import get_db
from app.services.ai.AIQuizGeneratorService import (
    _SYSTEM_PROMPT,
    _extract_and_validate_json,
    generate_quiz_questions,
)
from app.services.ai.AITOSGeneratorService import (
    _TOS_SYSTEM_PROMPT,
    _extract_and_validate_tos_json,
    generate_tos_row_questions,
)
from app.services.ai.question_quality_validation import self_containment_issue


def _option(text, correct=False, order=1):
    return {"option_text": text, "is_correct": correct, "option_order": order}


def _tf(text, answer=True, returned_type="TRUE_FALSE"):
    return {
        "question_text": text,
        "question_type": returned_type,
        "options": [
            _option("True", answer, 1),
            _option("False", not answer, 2),
        ],
    }


def _mc(text="Which planet is closest to the Sun?", option_count=4, correct_indexes=(0,)):
    names = ["Mercury", "Venus", "Earth", "Mars", "Jupiter"]
    return {
        "question_text": text,
        "question_type": "MULTIPLE_CHOICE",
        "options": [
            _option(name, index in correct_indexes, index + 1)
            for index, name in enumerate(names[:option_count])
        ],
    }


def _raw(*questions):
    return json.dumps({"questions": list(questions)})


def test_exact_question_211_shape_is_discarded_for_requested_true_false_part():
    warnings = []
    questions = _extract_and_validate_json(
        _raw(_tf(
            'The sentence "I will go to the store" is an example of a(n) _______ sentence.',
            returned_type="MULTIPLE_CHOICE",
        )),
        [{"type": "TRUE_FALSE", "count": 1}],
        warnings=warnings,
        allow_empty=True,
    )

    assert questions == []
    assert warnings == ["1 question(s) discarded: True/False stem contains a blank"]


@pytest.mark.parametrize("option_count", [2, 3])
def test_quiz_multiple_choice_with_too_few_options_is_discarded(option_count):
    warnings = []
    questions = _extract_and_validate_json(
        _raw(_mc(option_count=option_count)),
        warnings=warnings,
        allow_empty=True,
    )
    assert questions == []
    assert warnings == [
        "1 question(s) discarded: multiple choice requires at least 4 distinct non-empty options"
    ]


def test_five_option_multiple_choice_keeps_correct_and_first_three_others(monkeypatch):
    monkeypatch.setattr(
        "app.services.ai.AIQuizGeneratorService.shuffle_options",
        lambda options, _question_type: options,
    )
    questions = _extract_and_validate_json(_raw(_mc(option_count=5, correct_indexes=(4,))))
    assert [option["option_text"] for option in questions[0]["options"]] == [
        "Mercury",
        "Venus",
        "Earth",
        "Jupiter",
    ]
    assert sum(option["is_correct"] for option in questions[0]["options"]) == 1


def test_tos_multiple_choice_does_not_pad_and_keeps_correct_from_five(monkeypatch):
    monkeypatch.setattr(
        "app.services.ai.AITOSGeneratorService.shuffle_options",
        lambda options, _question_type: options,
    )
    warnings = []
    questions = _extract_and_validate_tos_json(
        _raw(
            _mc("Two options?", option_count=2),
            _mc("Three options?", option_count=3),
            _mc("Five options?", option_count=5, correct_indexes=(4,)),
            _mc("Two correct?", correct_indexes=(0, 1)),
        ),
        warnings=warnings,
    )
    assert len(questions) == 1
    assert [option["option_text"] for option in questions[0]["options"]] == [
        "Mercury",
        "Venus",
        "Earth",
        "Jupiter",
    ]
    assert warnings == [
        "2 question(s) discarded: multiple choice requires at least 4 distinct non-empty options",
        "1 question(s) discarded: multiple choice has multiple correct options",
    ]


def test_multiple_correct_placeholder_and_duplicate_options_are_discarded():
    placeholder = _mc()
    placeholder["options"][2]["option_text"] = "Option C"
    duplicate = _mc()
    duplicate["options"][2]["option_text"] = " Mercury "
    warnings = []
    questions = _extract_and_validate_json(
        _raw(_mc(correct_indexes=(0, 1)), placeholder, duplicate),
        warnings=warnings,
        allow_empty=True,
    )
    assert questions == []
    assert warnings == [
        "1 question(s) discarded: multiple choice has multiple correct options",
        "1 question(s) discarded: placeholder option",
        "1 question(s) discarded: duplicate options",
    ]


@pytest.mark.parametrize(
    ("stem", "expected_reason"),
    [
        ("A plant makes food through ______.", "True/False stem contains a blank"),
        ("Identify the process used by plants.", "True/False stem is not a declarative statement"),
        ("What process do plants use?", "True/False stem is not a declarative statement"),
    ],
)
def test_true_false_rejects_non_declarative_stems_in_both_generators(stem, expected_reason):
    raw = _raw(_tf(stem))
    quiz_warnings = []
    tos_warnings = []
    assert _extract_and_validate_json(
        raw,
        [{"type": "TRUE_FALSE", "count": 1}],
        warnings=quiz_warnings,
        allow_empty=True,
    ) == []
    assert _extract_and_validate_tos_json(raw, warnings=tos_warnings) == []
    expected = f"1 question(s) discarded: {expected_reason}"
    assert quiz_warnings == [expected]
    assert tos_warnings == [expected]


@pytest.mark.parametrize("option_count", [3, 4])
def test_true_false_rejects_extra_options_in_both_generators(option_count):
    question = _tf("The Earth revolves around the Sun.")
    for index in range(2, option_count):
        question["options"].append(_option(f"Extra {index}", False, index + 1))
    raw = _raw(question)
    quiz_warnings = []
    tos_warnings = []
    assert _extract_and_validate_json(
        raw,
        [{"type": "TRUE_FALSE", "count": 1}],
        warnings=quiz_warnings,
        allow_empty=True,
    ) == []
    assert _extract_and_validate_tos_json(raw, warnings=tos_warnings) == []
    expected = "1 question(s) discarded: True/False requires exactly True and False options"
    assert quiz_warnings == [expected]
    assert tos_warnings == [expected]


def test_valid_true_false_is_canonical_and_never_shuffled_in_both_generators(monkeypatch):
    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("True/False options must not be shuffled")

    monkeypatch.setattr("app.services.ai.AIQuizGeneratorService.shuffle_options", fail_if_called)
    monkeypatch.setattr("app.services.ai.AITOSGeneratorService.shuffle_options", fail_if_called)
    raw = _raw(_tf("The Earth revolves around the Sun.", returned_type="MULTIPLE_CHOICE"))
    quiz = _extract_and_validate_json(raw, [{"type": "TRUE_FALSE", "count": 1}])
    tos = _extract_and_validate_tos_json(_raw(_tf("The Earth revolves around the Sun.")))
    for question in (quiz[0], tos[0]):
        assert [option["option_text"] for option in question["options"]] == ["True", "False"]
        assert [option["option_order"] for option in question["options"]] == [1, 2]
    assert quiz[0]["question_type"] == "MULTIPLE_CHOICE"
    assert tos[0]["question_type"] == "TRUE_FALSE"


def test_multiple_choice_shape_for_true_false_part_is_not_relabeled():
    warnings = []
    result = _extract_and_validate_json(
        _raw(_mc("The Earth revolves around the Sun.")),
        [{"type": "TRUE_FALSE", "count": 1}],
        warnings=warnings,
        allow_empty=True,
    )
    assert result == []
    assert warnings == [
        "1 question(s) discarded: True/False requires exactly True and False options"
    ]


@pytest.mark.parametrize(
    ("stem", "key", "reason"),
    [
        ("What is the main idea of the paragraph?", "Friendship", "Identification stem is open-ended"),
        ("Name one supporting detail from the paragraph.", "The key was found", "Identification stem is open-ended"),
        (
            "What principle is demonstrated?",
            "Objects remain at rest unless acted upon.",
            "Identification answer key is a full sentence",
        ),
    ],
)
def test_identification_quality_rejections_in_both_generators(stem, key, reason):
    question = {
        "question_text": stem,
        "question_type": "IDENTIFICATION",
        "options": [_option(key, True, 1)],
    }
    raw = _raw(question)
    quiz_warnings = []
    tos_warnings = []
    assert _extract_and_validate_json(raw, warnings=quiz_warnings, allow_empty=True) == []
    assert _extract_and_validate_tos_json(raw, warnings=tos_warnings) == []
    expected = f"1 question(s) discarded: {reason}"
    assert quiz_warnings == [expected]
    assert tos_warnings == [expected]


def test_concise_identification_passes_in_both_generators():
    question = {
        "question_text": "What is the chemical symbol for gold?",
        "question_type": "IDENTIFICATION",
        "answer": "Au",
        "options": [],
    }
    assert _extract_and_validate_json(_raw(question))[0]["options"][0]["option_text"] == "Au"
    assert _extract_and_validate_tos_json(_raw(question))[0]["options"][0]["option_text"] == "Au"


def test_external_story_reference_is_discarded_but_embedded_passage_passes():
    external = _mc('In the narrative "The Lost Key", why did Mia retrace her steps?')
    embedded = _mc(
        'Read this passage: Mia lost her key on the walk home. She retraced her steps and found it by a tree. '
        'In the narrative "The Lost Key", where was the key found?'
    )
    unrelated = _mc("Why do people retrace their steps after losing an object?")
    warnings = []
    questions = _extract_and_validate_json(
        _raw(external, embedded, unrelated),
        warnings=warnings,
        allow_empty=True,
    )
    assert [question["question_text"] for question in questions] == [
        embedded["question_text"],
        unrelated["question_text"],
    ]
    assert warnings == [
        "1 question(s) discarded: question refers to external material that is not included"
    ]
    tos_warnings = []
    tos_questions = _extract_and_validate_tos_json(
        _raw(external, embedded, unrelated),
        warnings=tos_warnings,
    )
    assert [question["question_text"] for question in tos_questions] == [
        embedded["question_text"],
        unrelated["question_text"],
    ]
    assert tos_warnings == warnings


async def _quiz_identical_true_false_answers_retry_once_then_warn():
    all_true = _raw(*[_tf(f"Statement {index} is accurate.", True) for index in range(3)])
    mocked = AsyncMock(side_effect=[all_true, all_true])
    warnings = []
    with patch("app.services.ai.AIQuizGeneratorService.generate_text", mocked):
        questions = await generate_quiz_questions(
            "Science",
            [],
            "",
            [{"type": "TRUE_FALSE", "count": 3}],
            warnings=warnings,
        )
    assert len(questions) == 3
    assert mocked.await_count == 2
    assert warnings == ["all True/False answers are the same"]


async def _quiz_mixed_true_false_answers_do_not_retry():
    mixed = _raw(
        _tf("Statement one is accurate.", True),
        _tf("Statement two is inaccurate.", False),
        _tf("Statement three is accurate.", True),
    )
    mocked = AsyncMock(return_value=mixed)
    with patch("app.services.ai.AIQuizGeneratorService.generate_text", mocked):
        questions = await generate_quiz_questions(
            "Science",
            [],
            "",
            [{"type": "TRUE_FALSE", "count": 3}],
        )
    assert len(questions) == 3
    assert mocked.await_count == 1


async def _tos_shortfall_retries_once_for_only_the_missing_count():
    first = _raw(_mc("Question one?"))
    retry = _raw(_mc("Question two?"))
    mocked = AsyncMock(side_effect=[first, retry])
    warnings = []
    with patch("app.services.ai.AITOSGeneratorService.generate_text", mocked):
        questions = await generate_tos_row_questions(
            "Planets",
            None,
            "Science",
            {"MULTIPLE_CHOICE": 2},
            {"REMEMBER": 2},
            warnings=warnings,
        )
    assert [question["question_text"] for question in questions] == ["Question one?", "Question two?"]
    assert mocked.await_count == 2
    assert "1 x MULTIPLE_CHOICE" in mocked.await_args_list[1].args[0]
    assert warnings == []


async def _tos_remaining_shortfall_returns_valid_items_with_exact_warning():
    mocked = AsyncMock(side_effect=[_raw(_mc("Only valid question?")), _raw()])
    warnings = []
    with patch("app.services.ai.AITOSGeneratorService.generate_text", mocked):
        questions = await generate_tos_row_questions(
            "Planets",
            None,
            "Science",
            {"MULTIPLE_CHOICE": 2},
            {"REMEMBER": 2},
            warnings=warnings,
        )
    assert len(questions) == 1
    assert mocked.await_count == 2
    assert warnings == [
        "TOS question count mismatch: requested MULTIPLE_CHOICE=2; produced MULTIPLE_CHOICE=1."
    ]


async def _tos_identical_true_false_answers_retry_once_then_warn():
    all_false = _raw(*[_tf(f"Statement {index} is inaccurate.", False) for index in range(3)])
    mocked = AsyncMock(side_effect=[all_false, all_false])
    warnings = []
    with patch("app.services.ai.AITOSGeneratorService.generate_text", mocked):
        questions = await generate_tos_row_questions(
            "Matter",
            None,
            "Science",
            {"TRUE_FALSE": 3},
            {"UNDERSTAND": 3},
            warnings=warnings,
        )
    assert len(questions) == 3
    assert mocked.await_count == 2
    assert warnings == ["all True/False answers are the same"]


async def _tos_does_not_relabel_multiple_choice_as_true_false():
    wrong_shape = _raw(_mc("The Earth revolves around the Sun."))
    mocked = AsyncMock(side_effect=[wrong_shape, wrong_shape])
    warnings = []
    with patch("app.services.ai.AITOSGeneratorService.generate_text", mocked):
        questions = await generate_tos_row_questions(
            "Earth",
            None,
            "Science",
            {"TRUE_FALSE": 1},
            {"REMEMBER": 1},
            warnings=warnings,
        )
    assert questions == []
    assert mocked.await_count == 2
    assert not any("question_type" in question for question in questions)
    assert warnings == [
        "1 question(s) discarded: unexpected question type MULTIPLE_CHOICE",
        "1 question(s) discarded: unexpected question type MULTIPLE_CHOICE",
        "TOS question count mismatch: requested TRUE_FALSE=1; produced TRUE_FALSE=0.",
    ]


def test_quiz_identical_true_false_answers_retry_once_then_warn():
    asyncio.run(_quiz_identical_true_false_answers_retry_once_then_warn())


def test_quiz_mixed_true_false_answers_do_not_retry():
    asyncio.run(_quiz_mixed_true_false_answers_do_not_retry())


def test_tos_shortfall_retries_once_for_only_the_missing_count():
    asyncio.run(_tos_shortfall_retries_once_for_only_the_missing_count())


def test_tos_remaining_shortfall_returns_valid_items_with_exact_warning():
    asyncio.run(_tos_remaining_shortfall_returns_valid_items_with_exact_warning())


def test_tos_identical_true_false_answers_retry_once_then_warn():
    asyncio.run(_tos_identical_true_false_answers_retry_once_then_warn())


def test_tos_does_not_relabel_multiple_choice_as_true_false():
    asyncio.run(_tos_does_not_relabel_multiple_choice_as_true_false())


def test_ai_prompt_sources_have_no_mojibake_marker_or_placeholder_examples():
    marker = "\u00e2\u20ac"
    prompt_dir = Path(__file__).parents[1] / "app" / "services" / "ai"
    for path in prompt_dir.glob("*.py"):
        assert marker not in path.read_text(encoding="utf-8"), path
    assert marker not in _SYSTEM_PROMPT
    assert marker not in _TOS_SYSTEM_PROMPT
    assert "Sample question" not in _TOS_SYSTEM_PROMPT
    for placeholder in ("Option A", "Option B", "Option C", "Option D"):
        assert placeholder not in _TOS_SYSTEM_PROMPT


def _warning_api_client():
    app = FastAPI()
    app.include_router(ai_assist_router, prefix="/api/v1/ai")
    app.dependency_overrides[get_current_user] = lambda: {"sub": "test-user", "role": "teacher"}
    app.dependency_overrides[get_staff_id] = lambda: "STAFF-001"
    subject = MagicMock()
    subject.subject_name = "Science"
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = subject
    app.dependency_overrides[get_db] = lambda: db
    return TestClient(app, raise_server_exceptions=False)


def test_quiz_api_returns_generator_warning_reasons():
    async def generated(**kwargs):
        kwargs["warnings"].append("1 question(s) discarded: placeholder option")
        return [{
            "question_text": "Which planet is closest to the Sun?",
            "question_type": "MULTIPLE_CHOICE",
            "points": 1.0,
            "display_order": 1,
            "difficulty_level": "EASY",
            "explanation": "Mercury is closest.",
            "lesson_id": None,
            "is_ai_generated": True,
            "options": [
                _option("Mercury", True, 1),
                _option("Venus", False, 2),
                _option("Earth", False, 3),
                _option("Mars", False, 4),
            ],
        }]

    with patch("app.api.v1.routes.AIAssist.generate_quiz_questions", side_effect=generated):
        with _warning_api_client() as client:
            response = client.post("/api/v1/ai/generate-quiz", json={
                "subject_id": 1,
                "test_parts": [{"type": "MULTIPLE_CHOICE", "count": 1}],
            })
    assert response.status_code == 200
    assert response.json()["warnings"] == ["1 question(s) discarded: placeholder option"]


def test_tos_api_returns_generator_warning_reasons():
    async def generated(**kwargs):
        kwargs["warnings"].append(
            "TOS question count mismatch: requested IDENTIFICATION=2; produced IDENTIFICATION=1."
        )
        return [{
            "question_text": "What is the chemical symbol for gold?",
            "question_type": "IDENTIFICATION",
            "difficulty_band": "EASY",
            "cognitive_level": "REMEMBER",
            "points": 1.0,
            "explanation": "Au is the symbol for gold.",
            "options": [_option("Au", True, 1)],
        }]

    with patch("app.api.v1.routes.AIAssist.generate_tos_row_questions", side_effect=generated):
        with _warning_api_client() as client:
            response = client.post("/api/v1/ai/generate-tos-questions", json={
                "subject_id": 1,
                "subject_name": "Science",
                "rows": [{
                    "label": "Elements",
                    "type_counts": {"IDENTIFICATION": 2},
                    "bloom_targets": {"REMEMBER": 2},
                }],
            })
    assert response.status_code == 200
    assert response.json()["warnings"] == [
        "TOS question count mismatch: requested IDENTIFICATION=2; produced IDENTIFICATION=1."
    ]


@pytest.mark.parametrize(
    ("stem", "should_discard"),
    [
        ("Using the narrative 'The Lost Key', explain how the author supports the main idea.", True),
        ("What is the main idea of the short narrative titled 'The Lost Key'?", True),
        ("Read the passage below and identify the theme.", True),
        ("Based on the poem above, which line shows imagery?", True),
        ("According to the passage, why did Mina leave early?", True),
        ("From the article, identify one cause of erosion.", True),
        ("In the poem, what does the river symbolize?", True),
        ("Which value is largest in the table above?", True),
        ("Study the diagram above and name the labeled organ.", True),
        ("Look at the chart below and identify the trend.", True),
        ("Read the following excerpt and explain the conflict.", True),
        ("What happened after the event described in the text?", True),
        ("Which line from the poem shows imagery?", True),
        ("In the story, what did Tom do?", True),
        ("Read the poem 'The Road Not Taken' and describe the speaker's choice.", True),
        ("Refer to the figure and compute the area.", True),
        ("In the story 'Cinderella', the main character is Cinderella.", True),
        ("The story 'The Tortoise and the Hare' teaches that steady effort can succeed.", True),
        (
            "Using the narrative 'The Lost Key', read this passage: Mara lost the key on Monday. "
            "She retraced her steps and found it near the gate. Explain how the author supports the main idea.",
            False,
        ),
        ("Read the passage: 'The rain fell all day. Tom stayed inside.' What is the setting?", False),
        ("Read the passage below: Ana planted a seed. Rain helped it grow. Identify the theme.", False),
        ("According to the passage: Mina felt ill. She called her mother. Why did Mina leave early?", False),
        ("From the article: Wind moves loose soil. Flowing water carries sediment. Identify one cause of erosion.", False),
        ("Which value is largest in the table above: A is 4. B is 9. Choose the largest value.", False),
        ("Who wrote 'Romeo and Juliet'?", False),
        ("Which sentence is a complete sentence?", False),
        ("What is the term for a comparison using 'like' or 'as'?", False),
        ("The sentence 'I will go to the store' is a declarative sentence.", False),
        ("What is a narrative?", False),
        (
            "The main idea of a short narrative text is the central theme that the author wants the reader to understand.",
            False,
        ),
        ("Select the best definition of photosynthesis.", False),
    ],
)
def test_missing_external_material_decision_table(stem, should_discard):
    issue = self_containment_issue(stem)
    assert (issue is not None) is should_discard
    if should_discard:
        assert issue == "question refers to external material that is not included"


def test_inline_material_must_follow_reference_and_include_two_statements():
    stem = "Note: choose carefully. According to the passage, why did Mina leave early?"
    assert self_containment_issue(stem) == (
        "question refers to external material that is not included"
    )


def test_quoted_inline_material_with_ten_words_is_self_contained():
    stem = (
        'Read the passage: "Heavy rain covered the road while the tired travelers waited inside the station." '
        "Why did the travelers wait?"
    )
    assert self_containment_issue(stem) is None

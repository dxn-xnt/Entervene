"""MC duplicate comparisons only: no provider traffic or application DB writes."""
from collections import Counter
import asyncio
import json
from unittest.mock import AsyncMock

import pytest

from app.services.ai import tos_generation as generation
from app.services.ai.question_quality_validation import (
    normalize_mc_option_text, normalize_option_text, option_text_issue, validate_true_false,
)


CASES = [
    (["Tom went home.", "tom went home.", "TOM went home.", "tom Went home."], False),
    (["Let us eat, Grandma.", "Let us eat Grandma.", "Let, us eat Grandma.", "Let us, eat Grandma."], False),
    (["Stop.", "Stop?", "Stop!", "Stop"], False),
    (["Tom went home.", " Tom went home. ", "Tom  went home.", "Tom\twent home."], True),
    (["Root", "Root", "Root", "Root"], True),
    (["Root", "Stem", "Leaf", "Flower"], False),
]
CASE_IDS = ["a-capitalization", "b-comma-placement", "c-final-punctuation", "d-whitespace",
            "e-identical", "f-distinct-content"]


def candidate(options, kind="MULTIPLE_CHOICE", correct_index=1):
    return {"question_text": "Which option demonstrates the assessed rule?", "question_type": kind,
            "cognitive_level": "REMEMBER", "difficulty_band": "EASY", "points": 1.0,
            "explanation": "The selected option demonstrates the assessed rule.",
            "options": options, "correct_index": correct_index, "passage_id": None}


@pytest.mark.parametrize("options,rejected", CASES, ids=CASE_IDS)
def test_mc_comparison_a_to_f(options, rejected):
    reason = option_text_issue([{"option_text": text} for text in options], "MULTIPLE_CHOICE")
    assert reason == ("duplicate options" if rejected else None)
    discards = Counter()
    item = generation.validate_item(candidate(options), "MULTIPLE_CHOICE", None, discards=discards)
    assert (item is None) == rejected
    assert discards == (Counter(duplicate_options=1) if rejected else Counter())


@pytest.mark.parametrize("options,rejected", [
    (["Caf\u00e9", "Cafe\u0301", "Stem", "Leaf"], True),
    (["\u00c5", "A\u030a", "B", "C"], True),
    (["\uff21", "A", "B", "C"], False),  # NFC, not compatibility normalization.
    (["Stra\u00dfe", "Strasse", "Stem", "Leaf"], False),  # No Unicode casefold.
])
def test_mc_uses_nfc_without_compatibility_or_case_folding(options, rejected):
    assert (option_text_issue([{"option_text": text} for text in options]) is not None) == rejected
    assert (generation.validate_item(candidate(options), "MULTIPLE_CHOICE", None) is None) == rejected


def test_mc_normalizer_only_trims_collapses_whitespace_and_applies_nfc():
    assert normalize_mc_option_text(" \tCafe\u0301  says,\nSTOP?!  ") == "Caf\u00e9 says, STOP?!"
    # The old helper remains unchanged for stem deduplication and other types.
    assert normalize_option_text(" \tROOT?! ") == "root"


@pytest.mark.parametrize("kind", ["TRUE_FALSE", "IDENTIFICATION", "MATCHING", "ESSAY", "SHORT_ANSWER"])
def test_non_mc_comparison_retains_legacy_case_punctuation_rejection(kind):
    options = [{"option_text": text} for text in ["Root", " root. ", "Leaf", "Flower"]]
    assert option_text_issue(options, kind) == "duplicate options"


def test_true_false_case_handling_and_canonical_pair_remain_unchanged():
    options, reason = validate_true_false("Plants need water.", [
        {"option_text": " TRUE ", "is_correct": True}, {"option_text": " false ", "is_correct": False}])
    assert reason is None and [o["option_text"] for o in options] == ["True", "False"]
    assert sum(o["is_correct"] for o in options) == 1
    _, reason = validate_true_false("Plants need water.", [
        {"option_text": "True", "is_correct": True}, {"option_text": "TRUE", "is_correct": False}])
    assert reason == "duplicate options"


def test_matching_and_identification_generation_behavior_remains_unchanged():
    counts = Counter()
    assert generation.validate_item(candidate(["Root", " root. ", "Leaf", "Flower"], "MATCHING"),
                                    "MATCHING", None, discards=counts) is None
    assert counts == Counter(duplicate_options=1)
    identification = candidate(["Root"], "IDENTIFICATION", 0)
    assert generation.validate_item(identification, "IDENTIFICATION", None) is not None


@pytest.mark.parametrize("correct_index", [0, 1])
def test_case_only_options_keep_exactly_one_correct_answer_after_shuffle(monkeypatch, correct_index):
    def reverse(options, kind):
        assert kind == "MULTIPLE_CHOICE"
        options.reverse()
        for index, option in enumerate(options, 1):
            option["option_order"] = index
        return options
    monkeypatch.setattr(generation, "shuffle_options", reverse)
    raw_options = ["Mount Everest", "mount Everest", "Pacific Ocean", "Sierra Madre"]
    raw = candidate(raw_options, correct_index=correct_index)
    # Model-owned output still omits batch-owned context fields.
    del raw["question_type"], raw["passage_id"]
    mocked = AsyncMock(return_value=json.dumps({"questions": [raw]}))
    monkeypatch.setattr(generation, "generate_text", mocked)
    questions = asyncio.run(generation.generate_tos_row_questions("Identify capitalization rules", None,
        "English", {"MULTIPLE_CHOICE": 1}, {"REMEMBER": 1}))
    assert len(questions) == 1 and mocked.await_count == 1
    options = questions[0]["options"]
    assert [o["option_text"] for o in options] == list(reversed(raw_options))
    assert [o["option_order"] for o in options] == [1, 2, 3, 4]
    assert sum(o["is_correct"] for o in options) == 1
    assert next(o["option_text"] for o in options if o["is_correct"]) == raw_options[correct_index]
    assert "correct_index" not in questions[0]


def test_mc_prompt_matches_validator_and_accepts_case_only_distractors():
    prompt = " ".join(generation.SYSTEM_PROMPT.split())
    assert (
        "MC options must remain distinct after trimming, collapsing whitespace, and Unicode NFC normalization. "
        "Preserve meaningful capitalization and punctuation differences."
    ) in prompt
    assert "lowercas" not in prompt.lower()
    assert "casefold" not in prompt.lower()
    assert "removing trailing punctuation" not in prompt.lower()
    assert "stripping punctuation" not in prompt.lower()

    options = ["Tom went home.", "tom went home.", "TOM went home.", "tom Went home."]
    discards = Counter()
    question = generation.validate_item(
        candidate(options, correct_index=0), "MULTIPLE_CHOICE", None, discards=discards,
    )
    assert question is not None and discards == Counter()
    assert {option["option_text"] for option in question["options"]} == set(options)
    assert sum(option["is_correct"] for option in question["options"]) == 1
    assert next(option["option_text"] for option in question["options"] if option["is_correct"]) == options[0]

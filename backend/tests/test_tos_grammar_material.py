"""TOS-only material narrowing: validator-unit and mocked-behavior cases."""
import asyncio
from collections import Counter
import json
from unittest.mock import AsyncMock

import pytest

from app.services.ai import tos_generation as service
from app.services.ai.question_quality_validation import self_containment_issue
from test_tos_generation_repair import item, passage


SENTENCES = [
    "The birds sing outside.",
    "the birds sing outside.",
    "The birds sing outside?",
    "The birds sing outside!",
]
PROBE_STEMS = [
    "Choose the sentence that uses a comma correctly",
    "Choose the sentence with correct capitalization.",
    "Choose the sentence that uses an apostrophe correctly.",
    "Choose the sentence that ends with a question mark.",
]
SELECTION_STEMS = PROBE_STEMS + [
    "Select the sentence that uses a comma correctly.",
    "Identify the sentence that uses an apostrophe correctly.",
    "Which sentence is punctuated correctly?",
]


@pytest.mark.parametrize("stem", SELECTION_STEMS)
def test_sentence_selection_with_valid_sentence_options_is_accepted(stem):
    # Classification: validator-unit.
    discards = Counter()
    result = service.validate_item(item(question_text=stem, options=SENTENCES),
        "MULTIPLE_CHOICE", None, discards=discards)
    assert result is not None and not discards
    assert {option["option_text"] for option in result["options"]} == set(SENTENCES)
    assert sum(option["is_correct"] for option in result["options"]) == 1
    assert next(option["option_text"] for option in result["options"] if option["is_correct"]) == SENTENCES[0]


@pytest.mark.parametrize("stem", PROBE_STEMS)
@pytest.mark.parametrize("options", [
    [], ["", "", "", ""], [" ", " \t", "\n", "  "],
    ["Red", "Blue", "Green", "Yellow"],
    ["The birds sing outside.", "The birds sing outside.", "Cats sleep at home.", "Dogs run outside."],
    ["The birds sing outside.", " The  birds sing outside. ", "Cats sleep at home.", "Dogs run outside."],
    ["Jos\u00e9 reads a book.", "Jose\u0301 reads a book.", "Cats sleep at home.", "Dogs run outside."],
])
def test_probe_stems_without_four_valid_sentence_options_are_rejected(stem, options):
    # Classification: validator-unit.
    assert service.supporting_material_issue(stem, question_type="MULTIPLE_CHOICE", options=options)
    assert service.validate_item(item(question_text=stem, options=options), "MULTIPLE_CHOICE", None) is None


@pytest.mark.parametrize("stem", [
    "Based on the passage above, which sentence supports the main idea?",
    "Refer to the table below and identify the pattern.",
    "Using the paragraph, identify its topic sentence.",
    "Analyze the following sentence and select its subject.",
    "Choose the sentence that supports the passage above.",
    "Select the sentence that is correct based on the passage above.",
    "Identify the sentence that uses the paragraph correctly.",
    "Choose the sentence that explains the following sentence.",
    "Choose the sentence that explains the given sentence.",
    "Choose the sentence that explains the sentence above.",
    "Choose the sentence that explains the sentence below.",
    "Choose the sentence that explains the given letter.",
    "Choose the sentence that explains the chart below.",
    "Choose the sentence that explains the following short sentence.",
    "Choose the sentence that explains the given sentences.",
    "Choose the sentence that explains the sentence shown above.",
])
def test_missing_or_located_material_is_not_supplied_by_sentence_options(stem):
    # Classification: validator-unit.
    assert service.supporting_material_issue(stem, question_type="MULTIPLE_CHOICE", options=SENTENCES)
    assert service.validate_item(item(question_text=stem, options=SENTENCES), "MULTIPLE_CHOICE", None) is None


@pytest.mark.parametrize("visual", ["table", "image", "graph", "chart", "diagram", "picture"])
@pytest.mark.parametrize("linked", [False, True])
@pytest.mark.parametrize("opener", ["Choose the sentence that", "Which sentence"])
def test_sentence_options_and_text_passage_do_not_supply_a_missing_visual(visual, linked, opener):
    # Classification: validator-unit.
    source = passage() if linked else None
    stem = f"{opener} describes the {visual}."
    assert service.validate_item(item(question_text=stem, options=SENTENCES,
        passage_id=source.id if source else None), "MULTIPLE_CHOICE", source) is None


@pytest.mark.parametrize("visual", ["table", "image", "graph", "chart", "diagram", "picture"])
@pytest.mark.parametrize("linked", [False, True])
def test_located_visual_without_a_definite_article_is_still_missing(visual, linked):
    # Classification: validator-unit.
    source = passage() if linked else None
    stem = f"Which sentence describes {visual} above?"
    assert service.validate_item(item(question_text=stem, options=SENTENCES,
        passage_id=source.id if source else None), "MULTIPLE_CHOICE", source) is None


@pytest.mark.parametrize("kind", ["TRUE_FALSE", "IDENTIFICATION", "ESSAY", "MATCHING"])
def test_non_mc_material_check_keeps_its_previous_behavior(kind):
    # Classification: validator-unit.
    stem = PROBE_STEMS[0]
    original = service.supporting_material_issue(stem)
    assert original is not None
    assert service.supporting_material_issue(stem, question_type=kind, options=SENTENCES) == original
    assert service.validate_item(item(kind=kind, question_text=stem), kind, None) is None
    inline = "Analyze the following sentence: 'The birds sing.' What is its subject?"
    assert service.supporting_material_issue(inline, question_type=kind, options=SENTENCES) is None
    visual_stem = "Which sentence describes the chart?"
    assert service.supporting_material_issue(visual_stem, question_type=kind, options=SENTENCES) == service.supporting_material_issue(visual_stem)


@pytest.mark.parametrize("stem", [
    "Explain the sentence that uses a comma correctly.",
    "Correct the sentence with appropriate punctuation.",
    "Analyze the sentence that uses an apostrophe.",
])
def test_sentence_keyword_alone_does_not_trigger_the_exemption(stem):
    # Classification: validator-unit.
    assert service.supporting_material_issue(stem, question_type="MULTIPLE_CHOICE", options=SENTENCES)


def test_shared_check_and_supported_inline_or_linked_material_are_unchanged():
    # Classification: validator-unit.
    stem = "Based on the passage above, which sentence supports the main idea?"
    original = self_containment_issue(stem)
    assert original is not None
    assert service.supporting_material_issue(stem, question_type="MULTIPLE_CHOICE", options=SENTENCES) == original
    assert self_containment_issue(stem) == original
    source = passage()
    assert service.validate_item(item(question_text=stem, options=SENTENCES,
        passage_id=source.id), "MULTIPLE_CHOICE", source) is not None
    inline = "Analyze the following sentence: 'The birds sing.' What is its subject?"
    assert service.validate_item(item(question_text=inline, options=SENTENCES), "MULTIPLE_CHOICE", None) is not None


def test_linked_text_does_not_hide_a_later_located_visual_reference():
    # Classification: validator-unit.
    source = passage()
    stem = "Choose the sentence that explains the given paragraph, comparing chart above."
    assert service.validate_item(item(question_text=stem, options=SENTENCES,
        passage_id=source.id), "MULTIPLE_CHOICE", source) is None


@pytest.mark.parametrize("stem", SELECTION_STEMS)
def test_mocked_first_pass_keeps_self_contained_grammar_items_without_repairs(monkeypatch, stem):
    # Classification: mocked-behavior.
    raw = json.dumps({"questions": [item(question_text=stem, options=SENTENCES)]})
    provider = AsyncMock(return_value=raw)
    monkeypatch.setattr(service, "generate_text", provider)
    warnings = []
    questions = asyncio.run(service.generate_tos_row_questions("Sentence punctuation", None,
        "English", {"MULTIPLE_CHOICE": 1}, {"REMEMBER": 1}, warnings=warnings))
    assert len(questions) == 1 and warnings == []
    assert questions[0]["question_type"] == "MULTIPLE_CHOICE"
    assert len(questions[0]["options"]) == 4
    assert sum(option["is_correct"] for option in questions[0]["options"]) == 1
    provider.assert_awaited_once()


def test_mocked_repair_accepts_sentence_options_but_not_missing_material(monkeypatch):
    # Classification: mocked-behavior.
    bad = item(question_text="Based on the passage above, identify the topic.", options=SENTENCES)
    good = item(question_text=PROBE_STEMS[0], options=SENTENCES)
    provider = AsyncMock(side_effect=[
        json.dumps({"questions": [bad]}), json.dumps({"questions": [good]})])
    monkeypatch.setattr(service, "generate_text", provider)
    warnings = []
    questions = asyncio.run(service.generate_tos_row_questions("Sentence punctuation", None,
        "English", {"MULTIPLE_CHOICE": 1}, {"REMEMBER": 1}, warnings=warnings))
    assert len(questions) == 1 and questions[0]["question_text"] == good["question_text"]
    assert warnings == [] and provider.await_count == 2
    assert json.loads(provider.await_args_list[1].args[0])["repair_round"] == 1

"""Shared, side-effect-free quality checks for AI-generated assessment items."""
from __future__ import annotations

import re
from typing import Any


_PLACEHOLDER_OPTION_RE = re.compile(r"^\s*option\s*[a-z0-9]\s*$", re.IGNORECASE)
_TRUE_FALSE_BAD_OPENER_RE = re.compile(
    r"^\s*(?:what|which|who|identify|name|fill\s+in|complete|define|explain)\b",
    re.IGNORECASE,
)
_IDENTIFICATION_OPEN_ENDED_RE = re.compile(
    r"^\s*(?:explain|describe|what\s+is\s+the\s+main\s+idea\b|"
    r"name\s+one\b|give\s+(?:an?|one)\s+example\b|list\b)",
    re.IGNORECASE,
)
_REFERENCE_NOUNS = (
    r"story|narrative|passage|poem|selection|excerpt|article|text|paragraph|"
    r"essay|speech|letter|dialogue|graph|chart|table|diagram|figure|picture|"
    r"image|illustration|map|drawing"
)
_EXTERNAL_REFERENCE_RE = re.compile(
    rf"""
    (?:
        # Definite directions to use material that should be present.
        \b(?:in|from|according\s+to|based\s+on|using|refer\s+to)\s+
            (?:(?:this|these|the|the\s+given)\s+)?(?:{_REFERENCE_NOUNS})\b
        | \b(?:this|these|the\s+given)\s+(?:{_REFERENCE_NOUNS})\b
        | \b(?:the\s+)?following\s+(?:{_REFERENCE_NOUNS})\b
        | \b(?:{_REFERENCE_NOUNS})\s+(?:above|below)\b
        # A named work attached to a reference noun is treated as specific.
        | \b(?:{_REFERENCE_NOUNS})\b(?=[^.!?\n]{{0,40}}
            (?:\b(?:titled|entitled|called)\b|[\"'\u201c\u2018]))
        # Covers prompts such as "Read the passage and identify ...".
        | \bread\s+(?:(?:this|these|the|the\s+given)\s+)?
            (?:{_REFERENCE_NOUNS})\b(?=[^.!?\n]{{0,100}}\band\b)
        | \bdescribed\s+in\s+(?:(?:this|these|the|the\s+given)\s+)?
            (?:{_REFERENCE_NOUNS})\b
    )
    """,
    re.IGNORECASE | re.VERBOSE,
)


def normalize_option_text(text: str) -> str:
    """Ignore presentation-only differences, including trailing punctuation."""
    import unicodedata

    text = " ".join(text.strip().casefold().split())
    while text and unicodedata.category(text[-1]).startswith("P"):
        text = text[:-1].rstrip()
    return text


def normalize_mc_option_text(text: str) -> str:
    """Compare MC options without erasing case or punctuation being assessed."""
    import unicodedata

    return unicodedata.normalize("NFC", " ".join(text.strip().split()))


def option_text_issue(options: list[dict[str, Any]], question_type: str = "MULTIPLE_CHOICE") -> str | None:
    """Return a discard reason for placeholder or duplicate option text."""
    texts = [str(option.get("option_text", "")).strip() for option in options]
    if any(_PLACEHOLDER_OPTION_RE.fullmatch(text) for text in texts):
        return "placeholder option"
    normalize = normalize_mc_option_text if question_type == "MULTIPLE_CHOICE" else normalize_option_text
    normalized = [normalize(text) for text in texts]
    if len(normalized) != len(set(normalized)):
        return "duplicate options"
    return None


def validate_true_false(
    question_text: str,
    options: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]] | None, str | None]:
    """Validate and canonically order a declarative True/False item."""
    stem = question_text.strip()
    if re.search(r"_{3,}", stem):
        return None, "True/False stem contains a blank"
    if stem.endswith("?") or _TRUE_FALSE_BAD_OPENER_RE.match(stem):
        return None, "True/False stem is not a declarative statement"
    if len(options) != 2:
        return None, "True/False requires exactly True and False options"

    issue = option_text_issue(options, "TRUE_FALSE")
    if issue:
        return None, issue

    by_text = {str(option.get("option_text", "")).strip().casefold(): option for option in options}
    if set(by_text) != {"true", "false"}:
        return None, "True/False requires exactly True and False options"
    if sum(bool(option.get("is_correct")) for option in options) != 1:
        return None, "True/False requires exactly one correct option"

    return [
        {
            "option_text": "True",
            "is_correct": bool(by_text["true"].get("is_correct")),
            "option_order": 1,
        },
        {
            "option_text": "False",
            "is_correct": bool(by_text["false"].get("is_correct")),
            "option_order": 2,
        },
    ], None


def identification_issue(question_text: str, answer_key: str) -> str | None:
    """Return a discard reason when Identification is open-ended or too broad."""
    stem = question_text.strip()
    key = answer_key.strip()
    if _IDENTIFICATION_OPEN_ENDED_RE.match(stem):
        return "Identification stem is open-ended"
    words = re.findall(r"\b[\w'-]+\b", key, flags=re.UNICODE)
    if len(words) > 8:
        return "Identification answer key is longer than 8 words"
    if key.endswith(".") and len(words) > 5:
        return "Identification answer key is a full sentence"
    return None


def self_containment_issue(question_text: str) -> str | None:
    """Detect a definite external reference unless enough material follows it."""
    stem = question_text.strip()
    reference = _EXTERNAL_REFERENCE_RE.search(stem)
    if reference is None:
        return None

    # Inline evidence must follow the detected reference. The old rule used the
    # first colon anywhere in the stem, so an unrelated leading label could make
    # a later missing reference appear self-contained.
    inline = stem[reference.end() :]

    # A substantial quoted span can itself supply the required source material.
    quote_patterns = (
        r'"([^"]+)"',
        r"'([^']+)'",
        r"\u201c([^\u201d]+)\u201d",
        r"\u2018([^\u2019]+)\u2019",
    )
    quoted_spans = (
        quoted
        for pattern in quote_patterns
        for quoted in re.findall(pattern, inline)
    )
    for quoted in quoted_spans:
        if len(re.findall(r"\b[\w'-]+\b", quoted, flags=re.UNICODE)) >= 10:
            return None

    # Require two completed declarative passage sentences after the reference.
    # Question marks are excluded so one fragment plus the question itself does
    # not satisfy the inline-material rule.
    sentence_ends = re.findall(r"[.!](?=\s|[\"'\u201d\u2019]|$)", inline)
    if len(sentence_ends) >= 2:
        return None
    return "question refers to external material that is not included"


def true_false_answers_are_mixed(questions: list[dict[str, Any]]) -> bool:
    answers = {
        option["option_text"]
        for question in questions
        for option in question.get("options", [])
        if option.get("is_correct")
    }
    return len(answers) > 1

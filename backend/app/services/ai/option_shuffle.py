"""
app/services/ai/option_shuffle.py

Shared utilities for detecting positional/relative option dependencies and
randomizing option display orders for AI-generated assessment items.
"""
from __future__ import annotations

import logging
import random
import re
from typing import Any

logger = logging.getLogger(__name__)

_POSITION_DEPENDENT_PATTERNS = [
    # Phrase patterns (case-insensitive)
    re.compile(r"\b(all|none|any|each|either|neither)\s+of\s+the\s+above\b", re.IGNORECASE),
    re.compile(r"\bthe\s+above\b", re.IGNORECASE),
    re.compile(r"\bas\s+above\b", re.IGNORECASE),
    re.compile(r"\b(all|none|any)\s+of\s+the\s+(choices|options|answers)\b", re.IGNORECASE),
    re.compile(r"\b(all|none|any)\s+of\s+these\b", re.IGNORECASE),
    # Letter-referencing patterns (Uppercase [A-D] only to avoid matching lowercase variables like 'a and b')
    re.compile(r"(?i:\bboth\s+)[A-D]\b"),
    re.compile(r"(?i:\b(either|neither)\s+)[A-D]\b"),
    re.compile(r"\b[A-D](?:,\s*[A-D])*,?\s*(?i:and|or|&)\s*[A-D]\b"),
    re.compile(r"\b[A-D](?i:\s+only)\b"),
    re.compile(r"(?i:\bonly\s+)[A-D]\b"),
    re.compile(r"(?i:\b(option|choice|statement)s?\s+)[A-D]\b"),
]


def has_positional_or_relative_options(options: list[dict[str, Any]]) -> bool:
    """
    Detect if any option references position or other options (e.g. 'All of the above',
    'None of the above', 'Both A and B', 'A and C only', 'A, B, and C').
    """
    for opt in options:
        text = str(opt.get("option_text", "")).strip()
        for pat in _POSITION_DEPENDENT_PATTERNS:
            if pat.search(text):
                return True
    return False


# Alias for backward compatibility with private helper naming
_has_positional_or_relative_options = has_positional_or_relative_options


def _is_true_false(options: list[dict[str, Any]]) -> bool:
    if len(options) == 2:
        texts = {str(o.get("option_text", "")).strip().lower() for o in options}
        if texts == {"true", "false"}:
            return True
    return False


def shuffle_options(
    options: list[dict[str, Any]],
    question_type: str = "MULTIPLE_CHOICE",
) -> list[dict[str, Any]]:
    """
    Randomize option order for MULTIPLE_CHOICE questions if they do not
    reference positional or relative cues (e.g. 'All of the above', 'Both A and B')
    and are not True/False questions.
    Reassigns 1..N option_order to match the final sequence.
    """
    q_type = str(question_type).upper()
    if q_type == "MULTIPLE_CHOICE":
        if not _is_true_false(options) and not has_positional_or_relative_options(options):
            random.shuffle(options)

    for o_idx, o in enumerate(options, start=1):
        o["option_order"] = o_idx

    return options

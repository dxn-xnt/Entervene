"""
app/services/quiz/quiz_normalization.py

Single authoritative helper for IDENTIFICATION answer comparison.
Used by both QuizAttemptService (grading) and QuizAnalysisService (display).

Pipeline:
  1. Superscript & Subscript preservation:
     - Convert runs of superscript characters (⁰¹²³⁴⁵⁶⁷⁸⁹ and ⁻, ⁺) to "^" plus plain characters (e.g. 10² -> 10^2, m/s² -> m/s^2, 10¹² -> 10^12)
     - Convert subscript digits (₀-₉) to plain digits (e.g. H₂O -> H2O)
  2. Unicode NFKC normalization
  3. Casefold (locale-agnostic Unicode lower)
  4. Trim surrounding whitespace
  5. Collapse internal whitespace runs to a single space
  6. Strip surrounding quotes ONLY when they form a matching pair around the entire answer ("...", “...”, '...', etc.), preserving stray quotes like 5'
  7. Strip trailing sentence punctuation (. , ; : ! ?)

Preserves:
  - Signs: +, -, +- (e.g. "-5" vs "5")
  - Brackets & parentheses: (, ), [, ], {, } (e.g. "(4, ∞)" vs "[4, ∞)")
  - Mathematical & logical symbols: %, ^, /, =, <, >, <=, >=, ∞, √ (e.g. "50%" vs "50", "x >= 3" vs "x <= 3")
  - Prime / apostrophe / foot marks: (e.g. "5'" vs "5")
  - Chemical & scientific notations: (e.g. "H2O" vs "H2O2")
"""
from __future__ import annotations

import re
import unicodedata

_SUPERSCRIPTS = {
    "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
    "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
    "⁻": "-", "⁺": "+",
}
_SUBSCRIPTS = {
    "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4",
    "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9",
}

_SUPER_RUN_RE = re.compile(r"([⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺]+)")
_SUB_TRANS = str.maketrans(_SUBSCRIPTS)
_WHITESPACE_RE = re.compile(r"\s+")
_TRAILING_PUNCT = ".,;:!?"

_MATCHING_QUOTES = [
    ('"', '"'),
    ("'", "'"),
    ("“", "”"),
    ("‘", "’"),
    ("«", "»"),
    ("`", "`"),
]


def _strip_matching_quotes(text: str) -> str:
    """Strip surrounding quotes only when they are a matching pair around the whole answer.
    Preserves stray quotes such as 5' (feet/prime).
    """
    changed = True
    while changed and len(text) >= 2:
        changed = False
        for open_q, close_q in _MATCHING_QUOTES:
            if text.startswith(open_q) and text.endswith(close_q):
                text = text[len(open_q):-len(close_q)].strip()
                changed = True
                break
    return text


def normalize_answer(text: str) -> str:
    """Normalize an answer string for IDENTIFICATION comparison.

    Returns an empty string for blank/None input so callers can do a
    simple ``normalized_student == normalized_key`` without extra None checks.
    """
    if not text:
        return ""

    # a) Convert runs of superscripts to ^... and subscripts to plain digits before NFKC
    text = _SUPER_RUN_RE.sub(lambda m: "^" + "".join(_SUPERSCRIPTS.get(c, c) for c in m.group(1)), text)
    text = text.translate(_SUB_TRANS)

    # b) NFKC, casefold, trim, collapse whitespace
    text = unicodedata.normalize("NFKC", text)
    # Fold mathematical minus sign U+2212 to ASCII '-' and fraction slash U+2044 to ASCII '/'
    text = text.replace("\u2212", "-").replace("\u2044", "/")
    text = text.casefold()
    text = text.strip()
    text = _WHITESPACE_RE.sub(" ", text)

    # c) Strip surrounding quotes only when they are a matching pair around the whole answer
    text = _strip_matching_quotes(text)

    # Strip trailing sentence punctuation (. , ; : ! ?)
    text = text.rstrip(_TRAILING_PUNCT)

    # In case trailing punct was inside quotes: e.g. "Au." -> matching quotes stripped -> Au. -> rstrip -> Au
    text = _strip_matching_quotes(text)
    return text.strip()


def is_identification_correct(student_answer: str, accepted_keys: list[str]) -> bool:
    """Return True if the student answer matches ANY of the accepted keys after normalization.

    Args:
        student_answer: Raw text typed by the student.
        accepted_keys: List of option_text values where is_correct is True.

    Returns:
        False when student_answer is blank or no keys are supplied.
    """
    norm_student = normalize_answer(student_answer)
    if not norm_student:
        return False
    for key in accepted_keys:
        norm_key = normalize_answer(key)
        if norm_key and norm_student == norm_key:
            return True
    return False

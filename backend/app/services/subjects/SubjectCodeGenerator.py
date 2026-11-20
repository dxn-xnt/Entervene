"""Deterministic subject-code generation rules.

This module is intentionally independent of database and HTTP concerns so every
subject write path can eventually use the same rules without duplicating them.
"""

from collections.abc import Iterable
import re
import unicodedata


MAX_SUBJECT_CODE_LENGTH = 12

# Keys are normalized subject names without a trailing grade or course number.
# Keep explicit curriculum phrases here instead of relying on first-letter
# guesses for well-known subjects.
SUBJECT_ABBREVIATIONS: dict[str, str] = {
    "enhanced mathematics": "ENMATH",
    "mathematics": "MATH",
    "enhanced science": "ENSCI",
    "science": "SCI",
    "science research": "SCIRES",
    "araling panlipunan": "AP",
    "english": "ENG",
    "filipino": "FIL",
    "french": "FRE",
    "technology and livelihood education": "TLE",
    "tle": "TLE",
    "mapeh": "MAPEH",
    "values education": "VALED",
    "values recommendation": "VALREC",
    "general mathematics": "GENMATH",
    "general biology": "GENBIO",
    "biology": "BIO",
    "general chemistry": "GENCHEM",
    "chemistry": "CHEM",
    "general physics": "GENPHYS",
    "physics": "PHYS",
    "earth and life science": "ELS",
    "pre calculus": "PRECAL",
    "basic calculus": "BASCAL",
    "statistics and probability": "STATPROB",
    "human anatomy and physiology": "HAP",
    "health science fundamentals": "HSF",
    "introduction to engineering": "INTROENG",
    "computer aided design fundamentals": "CADF",
    "research": "RSRCH",
    "research project": "RPROJ",
    "practical research": "PR",
    "work immersion": "WI",
    "media and information literacy": "MIL",
    "empowerment technologies": "EMPTECH",
    "personal development": "PERDEV",
    "entrepreneurship": "ENTREP",
    "physical education": "PE",
    "general science": "GENSCI",
    "life and career skills": "LCS",
    "mabisang komunikasyon": "MABKOM",
    "effective communication": "EFFCOMM",
    "english for academic and professional purposes": "EAPP",
    "pag aaral ng kasaysayan at lipunang pilipino": "PKLP",
}

_FALLBACK_STOP_WORDS = frozenset({"a", "an", "and", "at", "for", "in", "ng", "of", "sa", "the"})
_CODE_PATTERN = re.compile(r"^[A-Z0-9]+$")


class SubjectCodeGenerationError(ValueError):
    """Raised when a valid, unambiguous code cannot be generated."""


class SubjectCodeConflictError(SubjectCodeGenerationError):
    """Raised when a generated code is already reserved."""

    def __init__(self, code: str, conflicting_code: str) -> None:
        self.code = code
        self.conflicting_code = conflicting_code
        super().__init__(
            f'Subject code "{code}" conflicts with existing code "{conflicting_code}".'
        )


def normalize_subject_name(subject_name: str) -> str:
    """Return a comparison-friendly ASCII subject name."""
    if not isinstance(subject_name, str) or not subject_name.strip():
        raise SubjectCodeGenerationError("Subject name is required to generate a code.")

    text = unicodedata.normalize("NFKD", subject_name)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.replace("&", " and ")
    text = re.sub(r"(?<=[A-Za-z])(?=[0-9])|(?<=[0-9])(?=[A-Za-z])", " ", text)
    text = re.sub(r"[^A-Za-z0-9]+", " ", text)
    return " ".join(text.casefold().split())


def normalize_subject_code(code: str) -> str:
    """Normalize legacy formatting for collision comparison only."""
    return re.sub(r"[^A-Z0-9]+", "", str(code).strip().upper())


def _split_base_and_number(normalized_name: str) -> tuple[str, str | None]:
    parts = normalized_name.split()
    if parts and parts[-1].isdecimal():
        if len(parts) == 1:
            raise SubjectCodeGenerationError("Subject name must contain letters.")
        return " ".join(parts[:-1]), parts[-1]
    return normalized_name, None


def _fallback_abbreviation(base_name: str, available_length: int) -> str:
    words = [word for word in base_name.split() if word not in _FALLBACK_STOP_WORDS]
    if not words:
        raise SubjectCodeGenerationError(
            "Subject name does not contain enough information to generate a code."
        )

    if len(words) == 1:
        abbreviation = words[0].upper()
    else:
        abbreviation = "".join(word[0] for word in words).upper()

    abbreviation = abbreviation[:available_length]
    if not abbreviation:
        raise SubjectCodeGenerationError("Subject grade leaves no room for an abbreviation.")
    return abbreviation


def generate_subject_code(
    subject_name: str,
    grade_level: int,
    *,
    existing_codes: Iterable[str | None] = (),
) -> str:
    """Generate a canonical code and fail if that code is already reserved.

    A terminal number in ``subject_name`` is treated as an explicit course
    number (or an already-present grade) and is preserved. Otherwise the
    academic grade is appended. Callers should pass globally reserved codes in
    ``existing_codes`` when global uniqueness is required.
    """
    if isinstance(grade_level, bool) or not isinstance(grade_level, int) or grade_level <= 0:
        raise SubjectCodeGenerationError("Grade level must be a positive whole number.")

    normalized_name = normalize_subject_name(subject_name)
    base_name, explicit_number = _split_base_and_number(normalized_name)
    suffix = explicit_number or str(grade_level)
    available_length = MAX_SUBJECT_CODE_LENGTH - len(suffix)
    if available_length <= 0:
        raise SubjectCodeGenerationError("Grade or course number is too long for a subject code.")

    abbreviation = SUBJECT_ABBREVIATIONS.get(base_name)
    if abbreviation is None:
        abbreviation = _fallback_abbreviation(base_name, available_length)
    elif len(abbreviation) > available_length:
        raise SubjectCodeGenerationError(
            f'Configured abbreviation "{abbreviation}" exceeds the subject-code length limit.'
        )

    code = f"{abbreviation}{suffix}"
    if len(code) > MAX_SUBJECT_CODE_LENGTH or _CODE_PATTERN.fullmatch(code) is None:
        raise SubjectCodeGenerationError("Generated subject code is not uppercase alphanumeric.")

    normalized_candidate = normalize_subject_code(code)
    for existing_code in existing_codes:
        if existing_code is None:
            continue
        if normalize_subject_code(existing_code) == normalized_candidate:
            raise SubjectCodeConflictError(code, str(existing_code))

    return code

import pytest

from app.services.subjects.SubjectCodeGenerator import (
    MAX_SUBJECT_CODE_LENGTH,
    SubjectCodeConflictError,
    SubjectCodeGenerationError,
    generate_subject_code,
    normalize_subject_name,
)


@pytest.mark.parametrize(
    ("subject_name", "grade_level", "expected"),
    [
        ("Enhanced Mathematics 7", 7, "ENMATH7"),
        ("Mathematics 7", 7, "MATH7"),
        ("Enhanced Science 8", 8, "ENSCI8"),
        ("Araling Panlipunan 9", 9, "AP9"),
        ("English 7", 7, "ENG7"),
        ("General Biology 1", 11, "GENBIO1"),
    ],
)
def test_generate_subject_code_for_canonical_subjects(subject_name, grade_level, expected):
    assert generate_subject_code(subject_name, grade_level) == expected


def test_normalization_handles_case_punctuation_whitespace_and_attached_grade():
    assert normalize_subject_name("  ENHANCED---Mathematics7  ") == "enhanced mathematics 7"
    assert generate_subject_code("  ENHANCED---Mathematics7  ", 7) == "ENMATH7"
    assert generate_subject_code("Pre--Calculus", 11) == "PRECAL11"


def test_explicit_shs_course_number_is_preserved_instead_of_appending_grade():
    assert generate_subject_code("General Biology 1", 11) == "GENBIO1"
    assert generate_subject_code("General Physics 2", 12) == "GENPHYS2"
    assert generate_subject_code("Research 1", 11) == "RSRCH1"
    assert generate_subject_code("General Biology", 11) == "GENBIO11"


def test_generation_is_deterministic_and_bounded():
    first = generate_subject_code("Computer-Aided Design Fundamentals", 11)
    second = generate_subject_code("computer aided design fundamentals", 11)

    assert first == second == "CADF11"
    assert first.isalnum() and first.isupper()
    assert len(first) <= MAX_SUBJECT_CODE_LENGTH


def test_unknown_subject_uses_deterministic_initials_not_insertion_suffixes():
    assert generate_subject_code("Advanced Robotics Laboratory", 10) == "ARL10"


def test_collision_is_reported_without_silently_renumbering():
    with pytest.raises(SubjectCodeConflictError) as exc_info:
        generate_subject_code(
            "Enhanced Mathematics 7",
            7,
            existing_codes=["ENMATH7"],
        )

    assert exc_info.value.code == "ENMATH7"
    assert "EN72" not in str(exc_info.value)


def test_collision_comparison_normalizes_legacy_code_formatting():
    with pytest.raises(SubjectCodeConflictError):
        generate_subject_code("English 7", 7, existing_codes=["eng 7"])


@pytest.mark.parametrize("subject_name", ["", "   "])
def test_blank_subject_name_is_rejected(subject_name):
    with pytest.raises(SubjectCodeGenerationError, match="Subject name is required"):
        generate_subject_code(subject_name, 7)


@pytest.mark.parametrize("grade_level", [0, -1, 7.5, True])
def test_invalid_grade_level_is_rejected(grade_level):
    with pytest.raises(SubjectCodeGenerationError, match="positive whole number"):
        generate_subject_code("English", grade_level)

from app.services.grading.ExaminationCalculator import (
    EXAM_SUBTYPE_SUMMATIVE_1,
    EXAM_SUBTYPE_SUMMATIVE_2,
    EXAM_SUBTYPE_TERM_EXAM,
    ExaminationObservation,
    compute_examination_component,
)


def obs(score, possible, subtype, *, unresolved=False, administered=True):
    return ExaminationObservation(
        score=score,
        possible=possible,
        exam_subtype=subtype,
        unresolved=unresolved,
        administered=administered,
    )


def test_complete_exam_uses_exact_30_30_40_weights():
    result = compute_examination_component([
        obs(27, 30, EXAM_SUBTYPE_SUMMATIVE_1),
        obs(21, 30, EXAM_SUBTYPE_SUMMATIVE_2),
        obs(32, 40, EXAM_SUBTYPE_TERM_EXAM),
    ])

    assert result.subtype_percentages[EXAM_SUBTYPE_SUMMATIVE_1] == 90
    assert result.subtype_percentages[EXAM_SUBTYPE_SUMMATIVE_2] == 70
    assert result.subtype_percentages[EXAM_SUBTYPE_TERM_EXAM] == 80
    assert result.examination_percent == 80
    assert result.complete is True


def test_unequal_max_points_still_preserve_30_30_40_semantics():
    result = compute_examination_component([
        obs(20, 20, EXAM_SUBTYPE_SUMMATIVE_1),
        obs(10, 20, EXAM_SUBTYPE_SUMMATIVE_2),
        obs(25, 50, EXAM_SUBTYPE_TERM_EXAM),
    ])

    assert result.examination_percent == 65


def test_legitimate_zero_is_evidence():
    result = compute_examination_component([
        obs(0, 30, EXAM_SUBTYPE_SUMMATIVE_1),
        obs(0, 30, EXAM_SUBTYPE_SUMMATIVE_2),
        obs(0, 40, EXAM_SUBTYPE_TERM_EXAM),
    ])

    assert result.examination_percent == 0
    assert all(result.subtype_has_evidence.values())
    assert result.complete is True


def test_missing_score_is_not_zero():
    result = compute_examination_component([
        obs(None, 30, EXAM_SUBTYPE_SUMMATIVE_1),
        obs(21, 30, EXAM_SUBTYPE_SUMMATIVE_2),
        obs(32, 40, EXAM_SUBTYPE_TERM_EXAM),
    ])

    assert result.subtype_percentages[EXAM_SUBTYPE_SUMMATIVE_1] is None
    assert result.examination_percent == 75.71
    assert result.complete is False


def test_not_yet_administered_is_unavailable_not_zero():
    result = compute_examination_component([
        obs(27, 30, EXAM_SUBTYPE_SUMMATIVE_1),
        obs(None, 30, EXAM_SUBTYPE_SUMMATIVE_2, administered=False),
        obs(None, 40, EXAM_SUBTYPE_TERM_EXAM, administered=False),
    ])

    assert result.examination_percent == 90
    assert result.subtype_has_evidence[EXAM_SUBTYPE_SUMMATIVE_2] is False
    assert result.subtype_has_evidence[EXAM_SUBTYPE_TERM_EXAM] is False


def test_unresolved_evidence_is_reported_separately():
    result = compute_examination_component([
        obs(27, 30, EXAM_SUBTYPE_SUMMATIVE_1),
        obs(None, 30, EXAM_SUBTYPE_SUMMATIVE_2, unresolved=True),
        obs(32, 40, EXAM_SUBTYPE_TERM_EXAM),
    ])

    assert EXAM_SUBTYPE_SUMMATIVE_2 in result.unresolved_subtypes
    assert any(warning["code"] == "QA_UNRESOLVED_COMPONENTS" for warning in result.warnings)


def test_partial_st1_only_can_be_dynamic_for_gradebook():
    result = compute_examination_component([
        obs(24, 30, EXAM_SUBTYPE_SUMMATIVE_1),
    ])

    assert result.examination_percent == 80
    assert result.complete is False
    assert any(warning["code"] == "QA_PARTIAL_COMPONENTS_AVAILABLE" for warning in result.warnings)


def test_partial_st1_st2_can_be_suppressed_for_current_period_model():
    result = compute_examination_component([
        obs(27, 30, EXAM_SUBTYPE_SUMMATIVE_1),
        obs(24, 30, EXAM_SUBTYPE_SUMMATIVE_2),
    ], require_complete_for_percent=True)

    assert result.examination_percent is None
    assert result.complete is False
    assert any(warning["code"] == "QA_PARTIAL_COMPONENTS_AVAILABLE" for warning in result.warnings)


def test_complete_st1_st2_term_exam_available_for_current_period_model():
    result = compute_examination_component([
        obs(27, 30, EXAM_SUBTYPE_SUMMATIVE_1),
        obs(24, 30, EXAM_SUBTYPE_SUMMATIVE_2),
        obs(32, 40, EXAM_SUBTYPE_TERM_EXAM),
    ], require_complete_for_percent=True)

    assert result.examination_percent == 83
    assert result.complete is True

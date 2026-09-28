from types import SimpleNamespace

import pytest

from app.services.grading.ExaminationCalculator import ExaminationObservation, compute_examination_component
from app.services.grading.RemedialExamination import effective_exam_scores


def assignment(identifier: int, original: int | None = None):
    return SimpleNamespace(classwork_assignment_id=identifier, original_exam_assignment_id=original,
                           classwork=SimpleNamespace(total_points=10))


@pytest.mark.parametrize("subtype", ["SUMMATIVE_1", "SUMMATIVE_2", "TERM_EXAM"])
def test_higher_and_lower_remedial_attempts_use_one_original_position(subtype):
    original, lower, higher = assignment(1), assignment(2, 1), assignment(3, 1)
    raw_scores = {1: 6.0, 2: 4.0, 3: 8.0}
    effective = effective_exam_scores([original, lower, higher], raw_scores)
    assert raw_scores == {1: 6.0, 2: 4.0, 3: 8.0}  # history is retained
    assert effective == {1: 8.0}
    component = compute_examination_component([
        ExaminationObservation(score=effective[1], possible=10, exam_subtype=subtype),
    ])
    assert component.subtype_percentages[subtype] == 80
    assert effective_exam_scores([original, lower], raw_scores) == {1: 6.0}


def test_ordinary_same_subtype_exams_still_pool_points_and_remedial_does_not():
    rows = [assignment(1), assignment(2), assignment(3, 1)]
    selected = effective_exam_scores(rows, {1: 6.0, 2: 15.0, 3: 8.0})
    assert selected == {1: 8.0, 2: 15.0}
    result = compute_examination_component([
        ExaminationObservation(score=selected[1], possible=10, exam_subtype="SUMMATIVE_1"),
        ExaminationObservation(score=selected[2], possible=20, exam_subtype="SUMMATIVE_1"),
        ExaminationObservation(score=7, possible=10, exam_subtype="SUMMATIVE_2"),
        ExaminationObservation(score=8, possible=10, exam_subtype="TERM_EXAM"),
    ])
    assert result.subtype_percentages["SUMMATIVE_1"] == 76.67
    assert result.examination_percent == 76.0


def test_invalid_remedial_score_cannot_replace_original():
    assert effective_exam_scores([assignment(1), assignment(2, 1)], {1: 6, 2: 11}) == {1: 6}

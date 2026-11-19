import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services.classwork.ClassworkService import _parse_rubric_payload
from app.services.classwork.ClassworkService import _replace_activity_rubric
from app.services.classwork.ClassworkService import _assert_rubric_change_allowed
from app.models.classwork.Classwork import Classwork


def test_assignment_accepts_the_activity_scoring_rubric():
    payload = json.dumps([
        {"level_name": "Good", "description": "Meets most requirements", "points": 8, "display_order": 1},
        {"level_name": "Excellent", "description": "Meets all requirements", "points": 10, "display_order": 0},
    ])

    levels = _parse_rubric_payload(payload, "ASSIGNMENT")

    assert levels is not None
    assert [level.level_name for level in levels] == ["Excellent", "Good"]
    assert levels[0].points == 10

    classwork = Classwork(classwork_type="ASSIGNMENT")
    _replace_activity_rubric(None, classwork, levels)
    assert [(level.level_name, level.points) for level in classwork.rubric_levels] == [
        ("Excellent", 10),
        ("Good", 8),
    ]


def test_quiz_does_not_use_classwork_scoring_rubric():
    assert _parse_rubric_payload("not json", "QUIZ") is None


def test_rubric_change_requires_confirmation_for_ungraded_submissions():
    submission = SimpleNamespace(status="pending", grade=None)

    with pytest.raises(HTTPException) as exc_info:
        _assert_rubric_change_allowed([submission], confirmed=False)

    assert exc_info.value.status_code == 409
    _assert_rubric_change_allowed([submission], confirmed=True)


@pytest.mark.parametrize(
    "submission",
    [
        SimpleNamespace(status="graded", grade=None),
        SimpleNamespace(status="pending", grade=0),
    ],
)
def test_rubric_change_is_locked_after_grading_even_when_confirmed(submission):
    with pytest.raises(HTTPException) as exc_info:
        _assert_rubric_change_allowed([submission], confirmed=True)

    assert exc_info.value.status_code == 409
    assert exc_info.value.detail["code"] == "RUBRIC_LOCKED_AFTER_GRADING"


@pytest.mark.parametrize(
    ("target_max", "expected_points"),
    [
        (20, [20, 16, 12, 8, 4]),
        (50, [50, 40, 30, 20, 10]),
        (75, [75, 60, 45, 30, 15]),
    ],
)
def test_rubric_scales_to_target_maximum_and_sets_authoritative_total_points(target_max, expected_points):
    levels_data = [
        {"level_name": "Excellent", "description": "Meets all", "points": target_max, "display_order": 0},
        {"level_name": "Good", "description": "Meets most", "points": expected_points[1], "display_order": 1},
        {"level_name": "Fair", "description": "Meets some", "points": expected_points[2], "display_order": 2},
        {"level_name": "Needs Improvement", "description": "Meets few", "points": expected_points[3], "display_order": 3},
        {"level_name": "Poor", "description": "Missing", "points": expected_points[4], "display_order": 4},
    ]
    parsed = _parse_rubric_payload(json.dumps(levels_data), "ASSIGNMENT")
    assert parsed is not None
    assert [p.points for p in parsed] == expected_points
    classwork = Classwork(classwork_type="ASSIGNMENT", total_points=max(p.points for p in parsed))
    _replace_activity_rubric(None, classwork, parsed)
    assert classwork.total_points == target_max
    assert [level.points for level in classwork.rubric_levels] == expected_points


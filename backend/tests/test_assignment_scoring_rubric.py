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

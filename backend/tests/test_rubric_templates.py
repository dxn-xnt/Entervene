from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app.api.v1.routes.RubricTemplates import _levels, _owned
from app.models.classwork.RubricTemplate import RubricTemplate
from app.schemas.RubricTemplate import RubricTemplateInput


def _input(levels=None):
    return RubricTemplateInput(
        name="  My rubric  ",
        description="  Reusable levels  ",
        levels=levels or [
            {"level_name": "Good", "description": "Most requirements met", "points": 8, "display_order": 1},
            {"level_name": "Excellent", "description": "All requirements met", "points": 10, "display_order": 0},
        ],
    )


def test_template_uses_existing_performance_level_fields_and_order():
    body = _input()
    assert body.name == "My rubric"
    assert body.description == "Reusable levels"
    assert [level.level_name for level in body.levels] == ["Excellent", "Good"]
    assert _levels(body)[0] == {
        "level_name": "Excellent",
        "description": "All requirements met",
        "points": 10,
        "display_order": 0,
    }


@pytest.mark.parametrize("levels", [
    [{"level_name": "Good", "description": "A", "points": 0, "display_order": 0}],
    [
        {"level_name": "Good", "description": "A", "points": 5, "display_order": 0},
        {"level_name": "good", "description": "B", "points": 3, "display_order": 1},
    ],
    [{"level_name": "Excellent", "description": "A", "points": 1000000, "display_order": 0}],
])
def test_invalid_template_scores_or_duplicate_levels_are_rejected(levels):
    with pytest.raises(ValidationError):
        _input(levels)


def test_only_owner_can_change_personal_template():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = RubricTemplate(
        rubric_template_id=1, owner_staff_id="teacher-a", is_system=False,
    )
    assert _owned(db, 1, "teacher-a").rubric_template_id == 1
    with pytest.raises(HTTPException) as denied:
        _owned(db, 1, "teacher-b")
    assert denied.value.status_code == 404


def test_system_template_cannot_be_changed_by_teacher():
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = RubricTemplate(
        rubric_template_id=2, owner_staff_id=None, is_system=True,
    )
    with pytest.raises(HTTPException) as denied:
        _owned(db, 2, "teacher-a")
    assert denied.value.status_code == 404

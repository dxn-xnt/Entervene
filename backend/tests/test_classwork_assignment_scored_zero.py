"""The student assignment-list serialization must distinguish zero from no score."""
from decimal import Decimal

import pytest

from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.classwork.ClassworkService import student_assignments
from tests.test_send_grades_to_adviser import adviser_send_context


@pytest.mark.parametrize("grade", [0, 90, None])
@pytest.mark.parametrize("status", ["graded", "submitted", "late"])
def test_student_assignment_list_preserves_scored_zero(adviser_send_context, grade, status):
    ctx = adviser_send_context
    assignment = ctx["ca_ww"]
    assignment.is_published = True
    submission = ctx["db"].query(StudentSubmission).filter_by(
        student_id=ctx["student1"].student_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
    ).one()
    submission.grade = Decimal(str(grade)) if grade is not None else None
    submission.status = status
    ctx["db"].commit()

    result = student_assignments(ctx["student1"], ctx["db"])
    rows = [row for bucket in result.values() for row in bucket]
    item = next(row for row in rows if row["classwork_assignment_id"] == assignment.classwork_assignment_id)
    if grade is None:
        assert item["grade"] is None
    else:
        assert isinstance(item["grade"], float)
        assert item["grade"] == grade
    assert item["submission_status"] == status

from app.services.classwork.ClassworkService import _creation_max_attempts


def test_intervention_assessments_default_to_three_attempts_while_regular_stays_unchanged():
    assert _creation_max_attempts(
        normalized_type="QUIZ", requested=None, intervention_id=7,
    ) == 3
    assert _creation_max_attempts(
        normalized_type="QUIZ", requested=5, intervention_id=7,
    ) == 5
    assert _creation_max_attempts(
        normalized_type="ASSIGNMENT", requested=None, intervention_id=7,
    ) == 3
    assert _creation_max_attempts(
        normalized_type="ACTIVITY", requested=None, intervention_id=7,
    ) == 3
    assert _creation_max_attempts(
        normalized_type="READING", requested=3, intervention_id=7,
    ) is None
    assert _creation_max_attempts(
        normalized_type="QUIZ", requested=None, intervention_id=None,
    ) == 1
    assert _creation_max_attempts(
        normalized_type="ASSIGNMENT", requested=5, intervention_id=None,
    ) is None

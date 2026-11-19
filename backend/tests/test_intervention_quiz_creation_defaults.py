from app.services.classwork.ClassworkService import _creation_max_attempts


def test_intervention_quiz_defaults_to_three_attempts_only_when_unspecified():
    assert _creation_max_attempts(
        normalized_type="QUIZ", requested=None, intervention_id=7,
    ) == 3
    assert _creation_max_attempts(
        normalized_type="QUIZ", requested=5, intervention_id=7,
    ) == 5
    assert _creation_max_attempts(
        normalized_type="QUIZ", requested=None, intervention_id=None,
    ) == 1
    assert _creation_max_attempts(
        normalized_type="ASSIGNMENT", requested=5, intervention_id=7,
    ) is None

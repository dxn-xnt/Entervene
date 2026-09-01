"""
Unit tests for Step 5B Major Exam 30/30/40 sub-split computation and zero denominator safety.
"""

from unittest.mock import MagicMock
import pytest

from app.services.student_record.StudentRecordService import (
    ExamSubsplitWeights,
    GradingWeights,
    _categorize_exam_subtype,
    _compute_exam_ps,
    _deped_grade,
)


def _make_mock_assignment(title: str, total_points: float = 100, subtype: str | None = None, category: str = "EXAMS"):
    cw = MagicMock()
    cw.title = title
    cw.total_points = total_points
    cw.exam_subtype = subtype
    cw.classwork_category = category
    cw.classwork_type = "EXAM"

    asgn = MagicMock()
    asgn.classwork = cw
    asgn.classwork_assignment_id = 1
    return asgn


def test_categorize_exam_subtype_explicit():
    asgn_sum1 = _make_mock_assignment("Quarterly Test 1", subtype="SUMMATIVE_1")
    asgn_sum2 = _make_mock_assignment("Quarterly Test 2", subtype="SUMMATIVE_2")
    asgn_term = _make_mock_assignment("Final Exam", subtype="TERM_EXAM")

    assert _categorize_exam_subtype(asgn_sum1) == "SUMMATIVE_1"
    assert _categorize_exam_subtype(asgn_sum2) == "SUMMATIVE_2"
    assert _categorize_exam_subtype(asgn_term) == "TERM_EXAM"


def test_categorize_exam_subtype_keywords():
    asgn1 = _make_mock_assignment("Summative 1 - Algebra")
    asgn2 = _make_mock_assignment("Summative Assessment 2 - Geometry")
    asgn3 = _make_mock_assignment("Periodical Exam 1st Term")

    assert _categorize_exam_subtype(asgn1) == "SUMMATIVE_1"
    assert _categorize_exam_subtype(asgn2) == "SUMMATIVE_2"
    assert _categorize_exam_subtype(asgn3) == "TERM_EXAM"


def test_zero_denominator_no_exams():
    """PS_exams handles zero denominator (no exams assigned) cleanly without division error."""
    ps_sum1, ps_sum2, ps_term, ps_exams = _compute_exam_ps([], [])
    assert ps_sum1 is None
    assert ps_sum2 is None
    assert ps_term is None
    assert ps_exams is None

    # Entire deped grade with no classwork at all
    res = _deped_grade([], [], [], [], [], [])
    assert res.ps_ww is None
    assert res.ps_pt is None
    assert res.ps_qa is None
    assert res.initial_grade is None
    assert res.transmuted_grade is None

    # Tuple unpacking backward compatibility
    ww, pt, qa, ig, tg = res
    assert ww is None and pt is None and qa is None and ig is None and tg is None


def test_subsplit_full_term_computation():
    """Sum 1 (30%), Sum 2 (30%), Term Exam (40%)."""
    asgn1 = _make_mock_assignment("Summative 1", 100, subtype="SUMMATIVE_1")
    asgn2 = _make_mock_assignment("Summative 2", 100, subtype="SUMMATIVE_2")
    asgn3 = _make_mock_assignment("Term Exam", 100, subtype="TERM_EXAM")

    # Student with 100% on Sum 1, 50% on Sum 2, 80% on Term Exam
    # Expected: 0.30 * 100 + 0.30 * 50 + 0.40 * 80 = 30 + 15 + 32 = 77.0%
    scores = [100.0, 50.0, 80.0]
    assignments = [asgn1, asgn2, asgn3]

    ps_sum1, ps_sum2, ps_term, ps_exams = _compute_exam_ps(scores, assignments)
    assert ps_sum1 == 100.0
    assert ps_sum2 == 50.0
    assert ps_term == 80.0
    assert ps_exams == 77.0


def test_subsplit_partial_term_normalization():
    """Mid-term scenario: Only Summative 1 given so far (score 90%)."""
    asgn1 = _make_mock_assignment("Summative 1", 100, subtype="SUMMATIVE_1")

    ps_sum1, ps_sum2, ps_term, ps_exams = _compute_exam_ps([90.0], [asgn1])
    assert ps_sum1 == 90.0
    assert ps_sum2 is None
    assert ps_term is None
    # Normalized: 0.30 * 90 / 0.30 = 90.0%
    assert ps_exams == 90.0


def test_deped_grade_with_subsplit_and_template_weights():
    """Full DepEd grade computation with WW=30%, PT=50%, Exams=20% (with 30/30/40 sub-split)."""
    ww_asgn = [_make_mock_assignment("Quiz 1", 100, category="WRITTEN_WORK")]
    pt_asgn = [_make_mock_assignment("Project 1", 100, category="PERFORMANCE_TASK")]
    exam_asgns = [
        _make_mock_assignment("Summative 1", 100, subtype="SUMMATIVE_1"),
        _make_mock_assignment("Summative 2", 100, subtype="SUMMATIVE_2"),
        _make_mock_assignment("Term Exam", 100, subtype="TERM_EXAM"),
    ]

    # Scores: WW=80%, PT=90%, Exams = Sum1(100%), Sum2(50%), Term(80%) -> 77%
    # IG = 0.30 * 80 + 0.50 * 90 + 0.20 * 77 = 24.0 + 45.0 + 15.4 = 84.4
    res = _deped_grade(
        written_scores=[80.0],
        written_assignments=ww_asgn,
        performance_scores=[90.0],
        performance_assignments=pt_asgn,
        quarterly_scores=[100.0, 50.0, 80.0],
        quarterly_assignments=exam_asgns,
        weights=GradingWeights(ww_weight=0.30, pt_weight=0.50, qa_weight=0.20),
    )

    assert res.ps_ww == 80.0
    assert res.ps_pt == 90.0
    assert res.ps_qa == 77.0
    assert res.ps_sum1 == 100.0
    assert res.ps_sum2 == 50.0
    assert res.ps_term == 80.0
    assert res.initial_grade == 84.4
    assert res.transmuted_grade is not None


def test_categorize_exam_subtype_precedence():
    """Explicit exam_subtype takes absolute precedence over title keywords."""
    # Title says 'Summative 2' but explicit tag is 'SUMMATIVE_1'
    asgn = _make_mock_assignment("Summative 2 Test", subtype="SUMMATIVE_1")
    assert _categorize_exam_subtype(asgn) == "SUMMATIVE_1"

    # Title says 'Quarterly Exam' but explicit tag is 'SUMMATIVE_2'
    asgn2 = _make_mock_assignment("Final Quarterly Exam", subtype="SUMMATIVE_2")
    assert _categorize_exam_subtype(asgn2) == "SUMMATIVE_2"


def test_categorize_exam_subtype_keyword_variations():
    """Matches various keyword spellings and formatting."""
    assert _categorize_exam_subtype(_make_mock_assignment("summative-1 chapter 1")) == "SUMMATIVE_1"
    assert _categorize_exam_subtype(_make_mock_assignment("SUMMATIVE TEST 1")) == "SUMMATIVE_1"
    assert _categorize_exam_subtype(_make_mock_assignment("Summative Assessment 1")) == "SUMMATIVE_1"

    assert _categorize_exam_subtype(_make_mock_assignment("summative-2 chapter 2")) == "SUMMATIVE_2"
    assert _categorize_exam_subtype(_make_mock_assignment("SUMMATIVE TEST 2")) == "SUMMATIVE_2"
    assert _categorize_exam_subtype(_make_mock_assignment("Summative Assessment 2")) == "SUMMATIVE_2"

    assert _categorize_exam_subtype(_make_mock_assignment("1st Periodical Exam")) == "TERM_EXAM"
    assert _categorize_exam_subtype(_make_mock_assignment("Quarterly Exam - Science")) == "TERM_EXAM"
    assert _categorize_exam_subtype(_make_mock_assignment("Final Exam Grade 10")) == "TERM_EXAM"
    assert _categorize_exam_subtype(_make_mock_assignment("Term Exam 2026")) == "TERM_EXAM"


def test_chronological_fallback_generic_summatives():
    """Untagged generic summatives without numbers are slotted chronologically: 1st -> Sum 1, 2nd -> Sum 2."""
    asgn1 = _make_mock_assignment("Summative Assessment on Matter", 100)
    asgn2 = _make_mock_assignment("Summative Test on Living Things", 100)
    asgn3 = _make_mock_assignment("Periodical Exam", 100)

    scores = [90.0, 80.0, 70.0]
    asgns = [asgn1, asgn2, asgn3]

    ps_sum1, ps_sum2, ps_term, ps_exams = _compute_exam_ps(scores, asgns)
    assert ps_sum1 == 90.0  # slotted to sum 1
    assert ps_sum2 == 80.0  # slotted to sum 2
    assert ps_term == 70.0  # matched periodical exam
    # 0.30*90 + 0.30*80 + 0.40*70 = 27 + 24 + 28 = 79.0%
    assert ps_exams == 79.0


def test_chronological_fallback_generic_unclassified():
    """Completely untagged assignments with no recognized keywords fall back chronologically into Sum 1 (30%) -> Sum 2 (30%) -> Term Exam (40%)."""
    asgn_a = _make_mock_assignment("Unit Assessment", 100)
    asgn_b = _make_mock_assignment("Module Test", 100)
    asgn_c = _make_mock_assignment("Major Evaluation", 100)

    # 1st untagged (80%) -> Sum 1 (30%), 2nd (90%) -> Sum 2 (30%), 3rd (70%) -> Term Exam (40%)
    scores = [80.0, 90.0, 70.0]
    asgns = [asgn_a, asgn_b, asgn_c]

    ps_sum1, ps_sum2, ps_term, ps_exams = _compute_exam_ps(scores, asgns)
    assert ps_sum1 == 80.0  # 1st created -> Summative 1
    assert ps_sum2 == 90.0  # 2nd created -> Summative 2
    assert ps_term == 70.0  # 3rd created -> Term Exam
    # 0.30*80 + 0.30*90 + 0.40*70 = 24 + 27 + 28 = 79.0%
    assert ps_exams == 79.0


def test_three_plus_summatives_aggregate_in_sum2():
    """When 3+ classworks contain 'SUMMATIVE' in title, the 1st is Sum 1 and 2nd+ are aggregated in Sum 2 via DepEd PS."""
    asgn_s1 = _make_mock_assignment("Summative Quiz 1", 50)
    asgn_s2a = _make_mock_assignment("Summative Quiz 2 Part A", 50)
    asgn_s2b = _make_mock_assignment("Summative Quiz 2 Part B", 50)
    asgn_term = _make_mock_assignment("Periodical Term Exam", 100)

    # Student scores:
    # S1: 50/50 -> 100.0%
    # S2a: 40/50, S2b: 30/50 -> total earned = 70, total max = 100 -> 70.0%
    # Term: 80/100 -> 80.0%
    scores = [50.0, 40.0, 30.0, 80.0]
    asgns = [asgn_s1, asgn_s2a, asgn_s2b, asgn_term]

    ps_sum1, ps_sum2, ps_term, ps_exams = _compute_exam_ps(scores, asgns)
    assert ps_sum1 == 100.0
    assert ps_sum2 == 70.0
    assert ps_term == 80.0
    # Composite: 0.30*100 + 0.30*70 + 0.40*80 = 30.0 + 21.0 + 32.0 = 83.0%
    assert ps_exams == 83.0


def test_unrecorded_scores_return_none_not_default_ten():
    """When assignments exist but student has no scores entered (all None), grades must be None, not 10.0."""
    asgn_ww = _make_mock_assignment("Activity 1", 100, category="WRITTEN_WORK")
    asgn_pt = _make_mock_assignment("Performance 1", 100, category="PERFORMANCE_TASK")
    asgn_exam = _make_mock_assignment("Term Exam", 100, subtype="TERM_EXAM")

    res = _deped_grade(
        written_scores=[None],
        written_assignments=[asgn_ww],
        performance_scores=[None],
        performance_assignments=[asgn_pt],
        quarterly_scores=[None],
        quarterly_assignments=[asgn_exam],
    )
    assert res.ps_ww is None
    assert res.ps_pt is None
    assert res.ps_qa is None
    assert res.initial_grade is None
    assert res.transmuted_grade is None


def test_actual_zero_score_transmutes_to_ten():
    """When student legitimately earned 0 score (score is 0.0, not None), initial grade is 0.0 and transmutes to 10.0."""
    asgn_ww = _make_mock_assignment("Activity 1", 100, category="WRITTEN_WORK")
    asgn_pt = _make_mock_assignment("Performance 1", 100, category="PERFORMANCE_TASK")
    asgn_exam = _make_mock_assignment("Term Exam", 100, subtype="TERM_EXAM")

    res = _deped_grade(
        written_scores=[0.0],
        written_assignments=[asgn_ww],
        performance_scores=[0.0],
        performance_assignments=[asgn_pt],
        quarterly_scores=[0.0],
        quarterly_assignments=[asgn_exam],
    )
    assert res.ps_ww == 0.0
    assert res.ps_pt == 0.0
    assert res.ps_qa == 0.0
    assert res.initial_grade == 0.0
    assert res.transmuted_grade == 10.0




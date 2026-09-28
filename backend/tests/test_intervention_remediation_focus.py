"""Focus uses frozen traceable evidence and never invents examination policy."""

from copy import deepcopy
from types import SimpleNamespace

from app.models.academic.Lesson import Lesson
from app.models.classwork.Classwork import Classwork
from app.services.intervention.InterventionRemediationFocusService import build_remediation_focus
from app.services.intervention.InterventionRemediationService import get_workspace
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_intervention_support_materials import _activate
from tests.test_teacher_intervention_review import candidate_context, _id, _staff


def _focus(component, *, exam=None, scored=None, coverage=None):
    return build_remediation_focus(SimpleNamespace(diagnosis_snapshot={
        "weakest_supported_components": [component],
        "supporting_activities": exam or [],
        "lowest_supported_competencies": scored or [],
        "manual_assessment_coverage": coverage or [],
    }))


def test_component_and_exact_exam_subtype_are_deterministic():
    assert _focus("WRITTEN_WORK")["component"] == "WRITTEN_WORK"
    assert _focus("PERFORMANCE_TASK")["component"] == "PERFORMANCE_TASK"
    unknown = _focus("EXAMINATION", exam=[{"component": "EXAMINATION", "exam_subtype": None,
        "title": "Term Exam", "score": 2, "possible_score": 10}])
    assert unknown["component"] == "EXAMINATION"
    assert unknown["exam_subtype"] is None and unknown["exam_subtype_requires_confirmation"]
    known = _focus("EXAMINATION", exam=[
        {"component": "EXAMINATION", "exam_subtype": "SUMMATIVE_1", "score": 8, "possible_score": 10},
        {"component": "EXAMINATION", "exam_subtype": "TERM_EXAM", "score": 3, "possible_score": 10},
    ])
    assert known["exam_subtype"] == "TERM_EXAM"
    assert not known["exam_subtype_requires_confirmation"]
    tie = _focus("EXAMINATION", exam=[
        {"component": "EXAMINATION", "exam_subtype": "SUMMATIVE_1", "score": 3, "possible_score": 10},
        {"component": "EXAMINATION", "exam_subtype": "TERM_EXAM", "score": 3, "possible_score": 10},
    ])
    assert tie["exam_subtype"] is None


def test_question_scores_outrank_competency_and_unscored_coverage():
    scored = [{"competency_id": 4, "competency_statement": "Add fractions", "percent": 20,
        "supporting_scores": [{"source_type": "QUIZ_QUESTION", "quiz_question_id": 7,
            "score": 1, "possible_score": 5, "lesson_id": 3, "lesson_title": "Fractions",
            "competency_id": 4, "competency_statement": "Add fractions", "classwork_id": 8}]}]
    focus = _focus("WRITTEN_WORK", scored=scored)
    assert focus["evidence_level"] == "QUESTION_SCORE"
    assert focus["lesson_ids"] == [3] and focus["competency_ids"] == [4]
    assert focus["source_classwork_ids"] == [8]
    scored[0]["supporting_scores"][0]["source_type"] = "CLASSWORK_SINGLE_LESSON"
    assert _focus("WRITTEN_WORK", scored=scored)["evidence_level"] == "SCORED_COMPETENCY"
    coverage = [{"component": "WRITTEN_WORK", "in_weakest_supported_component": True,
        "classwork_id": 9, "percent": 50, "covered_lessons": [{"lesson_id": 3, "title": "Fractions"}],
        "covered_competencies": [{"competency_id": 4, "competency_statement": "Add fractions"}]}]
    covered = _focus("WRITTEN_WORK", coverage=coverage)
    assert covered["evidence_level"] == "ACTIVITY_COVERAGE" and covered["coverage_is_context_only"]
    assert covered["lesson_ids"] == [3]


def test_workspace_recommends_traceable_material_and_keeps_manual_browse(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    _activate(ctx)
    row = ctx["candidate"]
    snapshot = deepcopy(row.diagnosis_snapshot)
    snapshot["weakest_supported_components"] = ["WRITTEN_WORK"]
    snapshot["lowest_supported_competencies"] = [{"competency_id": 123, "percent": 40,
        "competency_statement": "Fractions", "supporting_scores": [{"source_type": "QUIZ_QUESTION",
            "quiz_question_id": 5, "score": 2, "possible_score": 5, "lesson_id": 101,
            "lesson_title": "Fractions", "competency_id": 123,
            "competency_statement": "Fractions", "classwork_id": 7}]}]
    row.diagnosis_snapshot = snapshot
    matched = Lesson(title="Fractions", subject_id=ctx["subject"].subject_id,
                     created_by_staff_id=_staff(ctx), is_published=False)
    unrelated = Lesson(title="Geometry", subject_id=ctx["subject"].subject_id,
                       created_by_staff_id=_staff(ctx), is_published=False)
    db.add_all([matched, unrelated]); db.flush()
    snapshot = deepcopy(snapshot)
    snapshot["lowest_supported_competencies"][0]["supporting_scores"][0]["lesson_id"] = matched.lesson_id
    row.diagnosis_snapshot = snapshot
    db.commit()
    frozen_before = deepcopy(row.diagnosis_snapshot)
    workspace = get_workspace(db, _staff(ctx), _id(ctx))
    assert row.diagnosis_snapshot == frozen_before
    items = {item["title"]: item for item in workspace["resources"]}
    assert items["Fractions"]["recommended"] is True
    assert items["Fractions"]["match_level"] == "LESSON"
    assert "Matched lesson" in items["Fractions"]["match_reason"]
    assert items["Fractions"]["ai_read"] == "METADATA_ONLY"
    assert items["Geometry"]["recommended"] is False
    assert items["Geometry"]["match_reason"] is None
    assert workspace["focus"]["basis"] == "FROZEN_TRIGGER_DIAGNOSIS"
    assert workspace["progress"]["status"] == "ACTIVE"


def test_source_assessment_is_related_evidence_not_recommended_learning_material(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    _activate(ctx)
    work = Classwork(title="Term Exam source", classwork_type="EXAM", classwork_category="EXAMS",
                     total_points=40, subject_id=ctx["subject"].subject_id,
                     created_by_staff_id=_staff(ctx), is_published=True)
    db.add(work); db.flush()
    snapshot = deepcopy(ctx["candidate"].diagnosis_snapshot)
    snapshot["weakest_supported_components"] = ["EXAMINATION"]
    snapshot["lowest_supported_competencies"] = []
    snapshot["manual_assessment_coverage"] = []
    snapshot["supporting_activities"] = [{"classwork_id": work.classwork_id, "component": "EXAMINATION",
        "exam_subtype": "TERM_EXAM", "score": 12, "possible_score": 40, "percent": 30}]
    ctx["candidate"].diagnosis_snapshot = snapshot
    db.commit()
    workspace = get_workspace(db, _staff(ctx), _id(ctx))
    source = next(item for item in workspace["resources"] if item["id"] == work.classwork_id and item["kind"] == "CLASSWORK")
    assert source["match_level"] == "SOURCE_ACTIVITY"
    assert source["recommended"] is False
    assert "file contents were not analyzed" in source["match_reason"]

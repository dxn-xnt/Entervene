"""Persistence tests for AI remediation assessment creation (no live AI calls)."""

from copy import deepcopy
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.classwork.ActivityRubricLevel import ActivityRubricLevel
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.classwork.RemediationReadingPrerequisite import RemediationReadingPrerequisite
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizSetting import QuizSetting
from app.services.quiz.QuizAttemptService import _attempt_question_out
from app.services.intervention.InterventionRemediationAssessmentCreationService import (
    create_remediation_assessment,
)
from app.services.intervention.InterventionRemediationService import get_workspace
from app.services.classwork.ClassworkService import student_assignments
from app.services.classwork.ClassworkResponseService import build_classwork_response
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_remediation_draft_preflight import (
    _client,
    _make_classwork_draft,
    _make_quiz_draft,
    _setup_intervention_with_targets,
)
from tests.test_teacher_intervention_review import (
    _id,
    _other_staff,
    _staff,
    candidate_context,
)


def test_create_unpublished_quiz_is_atomic_linked_and_idempotent(candidate_context):
    ctx = candidate_context
    competency, lesson, target, _reading = _setup_intervention_with_targets(
        ctx, "WRITTEN_WORK", 10.0,
    )
    db = ctx["db"]
    request_id = uuid4()
    draft = _make_quiz_draft(competency.competency_id, lesson.lesson_id, 10.0)
    draft.settings.show_correct_answers = True  # Creation must not expose teacher keys.

    result = create_remediation_assessment(
        db,
        staff_id=_staff(ctx),
        intervention_id=_id(ctx),
        remediation_request_id=request_id,
        draft_input=draft,
    )
    retry = create_remediation_assessment(
        db,
        staff_id=_staff(ctx),
        intervention_id=_id(ctx),
        remediation_request_id=request_id,
        draft_input=draft,
    )

    assert retry == result
    assignment = db.get(ClassworkAssignment, result.classwork_assignment_id)
    assert assignment.is_published is False
    assert assignment.publish_date is None
    assert assignment.recipient_student_id == ctx["candidate"].student_id
    assert assignment.source_intervention_id == _id(ctx)
    assert assignment.remediation_request_id == request_id
    assert assignment.classwork.is_published is False
    assert db.query(ClassworkAssignment).filter_by(remediation_request_id=request_id).count() == 1
    teacher_view = build_classwork_response(assignment.classwork)
    targeted_row = next(
        item for item in teacher_view.assignments
        if item.classwork_assignment_id == assignment.classwork_assignment_id
    )
    assert targeted_row.recipient_student_id == ctx["candidate"].student_id
    assert targeted_row.recipient_student_name == (
        f"{ctx['student'].first_name} {ctx['student'].last_name}"
    )
    assert targeted_row.source_intervention_id == _id(ctx)

    quiz = db.get(Quiz, result.quiz_id)
    assert quiz.status == "DRAFT"
    assert quiz.total_items == 2
    assert db.query(QuizSetting).filter_by(classwork_id=result.classwork_id).one().show_correct_answers is False
    assert db.query(Question).join(Question.quiz_links).filter_by(quiz_id=quiz.quiz_id).count() == 2
    correct = db.query(QuestionOption).filter_by(is_correct=True).count()
    assert correct >= 2
    for quiz_question in quiz.questions:
        student_item = _attempt_question_out(quiz_question, None, False, False)
        assert all(option.is_correct is None for option in student_item.options)
        assert "explanation" not in student_item.model_dump()

    link = db.query(RemediationAssignmentLink).filter_by(
        remediation_assignment_id=result.classwork_assignment_id,
    ).one()
    assert link.original_assignment_id == target.classwork_assignment_id
    assert float(link.score_adjustment_cap) == 75.0
    prereqs = db.query(RemediationReadingPrerequisite).filter_by(
        remediation_assignment_id=result.classwork_assignment_id,
    ).all()
    assert len(prereqs) == 1

    reopened = get_workspace(db, _staff(ctx), _id(ctx))
    saved_items = reopened["progress"]["assigned_remediation"]
    saved_item = next(
        item for item in saved_items
        if item["assignment_id"] == result.classwork_assignment_id
    )
    assert saved_item["classwork_id"] == result.classwork_id
    assert saved_item["title"] == draft.title
    assert saved_item["classwork_type"] == "QUIZ"
    assert saved_item["total_points"] == 10.0
    assert saved_item["is_published"] is False
    assert saved_item["submission_status"] == "draft"
    student_lists = student_assignments(ctx["student"], db)
    visible_assignment_ids = {
        item["classwork_assignment_id"]
        for group in student_lists.values()
        for item in group
    }
    assert result.classwork_assignment_id not in visible_assignment_ids


def test_create_unpublished_draft_without_reading_defers_gate_to_publication(candidate_context):
    ctx = candidate_context
    competency, lesson, _target, _reading = _setup_intervention_with_targets(
        ctx, "WRITTEN_WORK", 10.0,
    )
    plan = dict(ctx["candidate"].remediation_plan or {})
    plan["selected_resources"] = []
    ctx["candidate"].remediation_plan = plan
    ctx["db"].commit()

    result = create_remediation_assessment(
        ctx["db"],
        staff_id=_staff(ctx),
        intervention_id=_id(ctx),
        remediation_request_id=uuid4(),
        draft_input=_make_quiz_draft(competency.competency_id, lesson.lesson_id, 10.0),
    )

    assignment = ctx["db"].get(ClassworkAssignment, result.classwork_assignment_id)
    assert assignment.is_published is False
    assert assignment.classwork.is_published is False
    assert ctx["db"].query(RemediationReadingPrerequisite).filter_by(
        remediation_assignment_id=result.classwork_assignment_id,
    ).count() == 0


def test_create_unpublished_summative_preserves_exam_subtype_and_original(candidate_context):
    ctx = candidate_context
    competency, lesson, target, _reading = _setup_intervention_with_targets(
        ctx, "WRITTEN_WORK", 10.0,
    )
    db = ctx["db"]
    target.classwork.classwork_type = "QUIZ"
    target.classwork.classwork_category = "EXAMS"
    target.classwork.exam_subtype = "SUMMATIVE_1"
    snapshot = deepcopy(ctx["candidate"].diagnosis_snapshot)
    snapshot["weakest_supported_components"] = ["EXAMINATION"]
    snapshot.setdefault("components", {})["EXAMINATION"] = snapshot["components"].get(
        "WRITTEN_WORK", {"evidence_state": "AVAILABLE", "percent": 50},
    )
    for item in snapshot.get("lowest_supported_competencies", []):
        for score in item.get("supporting_scores", []):
            score["component"] = "EXAMINATION"
    for activity in snapshot.get("supporting_activities", []):
        activity["component"] = "EXAMINATION"
    ctx["candidate"].diagnosis_snapshot = snapshot
    ctx["candidate"].remediation_plan = {
        **ctx["candidate"].remediation_plan,
        "teacher_choice": "QUIZ",
        "grade_treatment": "EXAMINATION",
        "original_exam_assignment_id": target.classwork_assignment_id,
        "target_assignment_ids": [target.classwork_assignment_id],
    }
    db.commit()
    draft = _make_quiz_draft(competency.competency_id, lesson.lesson_id, 10.0)
    draft.target_component = "EXAMINATION"
    draft.grade_treatment = "EXAMINATION"
    draft.exam_subtype = "SUMMATIVE_1"

    result = create_remediation_assessment(
        db,
        staff_id=_staff(ctx),
        intervention_id=_id(ctx),
        remediation_request_id=uuid4(),
        draft_input=draft,
    )

    assignment = db.get(ClassworkAssignment, result.classwork_assignment_id)
    assert assignment.original_exam_assignment_id == target.classwork_assignment_id
    assert assignment.classwork.exam_subtype == "SUMMATIVE_1"
    assert assignment.classwork.classwork_category == "EXAMS"
    assert assignment.is_published is False
    assert db.query(RemediationAssignmentLink).filter_by(
        remediation_assignment_id=assignment.classwork_assignment_id,
    ).count() == 0


def test_create_unpublished_classwork_preserves_tasks_deliverables_and_rubric(candidate_context):
    ctx = candidate_context
    competency, lesson, target, _reading = _setup_intervention_with_targets(
        ctx, "PERFORMANCE_TASK", 20.0,
    )
    db = ctx["db"]
    draft = _make_classwork_draft(competency.competency_id, lesson.lesson_id, 20.0)

    result = create_remediation_assessment(
        db,
        staff_id=_staff(ctx),
        intervention_id=_id(ctx),
        remediation_request_id=uuid4(),
        draft_input=draft,
    )

    work = db.get(Classwork, result.classwork_id)
    assignment = db.get(ClassworkAssignment, result.classwork_assignment_id)
    assert not work.is_published and not assignment.is_published
    assert draft.student_instructions in work.instructions
    for task in draft.tasks:
        assert task.title in work.instructions
        assert task.instructions in work.instructions
    for deliverable in draft.deliverables:
        assert deliverable.deliverable_name in work.instructions
        assert deliverable.description in work.instructions
    assert ", ".join(draft.supported_upload_formats) in work.instructions
    levels = db.query(ActivityRubricLevel).filter_by(classwork_id=work.classwork_id).all()
    assert [(row.level_name, float(row.points)) for row in levels] == [
        (level.level_name, level.points) for level in draft.rubric_levels
    ]
    link = db.query(RemediationAssignmentLink).filter_by(
        remediation_assignment_id=assignment.classwork_assignment_id,
    ).one()
    assert link.original_assignment_id == target.classwork_assignment_id
    assert link.component == "PERFORMANCE_TASK"


def test_invalid_or_unauthorized_creation_writes_nothing(candidate_context):
    ctx = candidate_context
    competency, lesson, _target, _reading = _setup_intervention_with_targets(
        ctx, "WRITTEN_WORK", 10.0,
    )
    db = ctx["db"]
    draft = _make_quiz_draft(competency.competency_id, lesson.lesson_id, 10.0)
    before = db.query(Classwork).count()
    bad = draft.model_dump()
    bad["total_points"] = 9.0
    with pytest.raises(HTTPException) as invalid:
        create_remediation_assessment(
            db, staff_id=_staff(ctx), intervention_id=_id(ctx),
            remediation_request_id=uuid4(), draft_input=bad,
        )
    assert invalid.value.status_code == 422
    assert db.query(Classwork).count() == before

    other = _other_staff(ctx)
    with pytest.raises(HTTPException) as unauthorized:
        create_remediation_assessment(
            db, staff_id=other.staff_id, intervention_id=_id(ctx),
            remediation_request_id=uuid4(), draft_input=draft,
        )
    assert unauthorized.value.status_code == 404
    assert db.query(Classwork).count() == before


def test_failure_after_assessment_staging_rolls_back_everything(candidate_context, monkeypatch):
    ctx = candidate_context
    competency, lesson, _target, _reading = _setup_intervention_with_targets(
        ctx, "WRITTEN_WORK", 10.0,
    )
    db = ctx["db"]
    draft = _make_quiz_draft(competency.competency_id, lesson.lesson_id, 10.0)
    counts = {
        "work": db.query(Classwork).count(),
        "assignment": db.query(ClassworkAssignment).count(),
        "quiz": db.query(Quiz).count(),
        "link": db.query(RemediationAssignmentLink).count(),
        "reading": db.query(RemediationReadingPrerequisite).count(),
    }

    def fail_builder(*_args, **_kwargs):
        raise RuntimeError("forced builder failure")

    monkeypatch.setattr(
        "app.services.intervention.InterventionRemediationAssessmentCreationService.upsert_quiz_builder",
        fail_builder,
    )
    with pytest.raises(RuntimeError, match="forced builder failure"):
        create_remediation_assessment(
            db, staff_id=_staff(ctx), intervention_id=_id(ctx),
            remediation_request_id=uuid4(), draft_input=draft,
        )

    assert db.query(Classwork).count() == counts["work"]
    assert db.query(ClassworkAssignment).count() == counts["assignment"]
    assert db.query(Quiz).count() == counts["quiz"]
    assert db.query(RemediationAssignmentLink).count() == counts["link"]
    assert db.query(RemediationReadingPrerequisite).count() == counts["reading"]


def test_teacher_creation_endpoint_returns_identifiers_only(candidate_context):
    ctx = candidate_context
    competency, lesson, _target, _reading = _setup_intervention_with_targets(
        ctx, "WRITTEN_WORK", 10.0,
    )
    draft = _make_quiz_draft(competency.competency_id, lesson.lesson_id, 10.0)
    response = _client(ctx).post(
        f"/api/v1/teacher/interventions/{_id(ctx)}/remediation/assessment",
        json={
            "remediation_request_id": str(uuid4()),
            "draft": draft.model_dump(mode="json"),
        },
    )

    assert response.status_code == 201, response.text
    payload = response.json()
    assert payload["intervention_id"] == _id(ctx)
    assert payload["draft_format"] == "QUIZ"
    assert payload["is_published"] is False
    assert "answer_keys" not in payload
    assert "teacher_guide" not in payload

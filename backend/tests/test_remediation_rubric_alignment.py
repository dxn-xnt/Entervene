"""Regression tests for Task 4: Remediation rubric inheritance & backend validation."""

from __future__ import annotations

import json
from copy import deepcopy
from decimal import Decimal
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.classwork.ActivityRubricLevel import ActivityRubricLevel
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Classwork import ClassworkUpdate
from app.schemas.RemediationDraft import RemediationDraftGenerationRequest
from app.schemas.Submission import GradeRequest
from app.services.classwork.ClassworkService import (
    create_classwork_wizard_record,
    update_classwork_record,
)
from app.services.intervention.InterventionRemediationAssessmentCreationService import (
    create_remediation_assessment,
)
from app.services.intervention.InterventionRemediationDraftGenerationService import (
    generate_remediation_draft,
)
from app.services.intervention.InterventionRemediationDraftPreflightService import (
    preflight_remediation_draft,
)
from app.services.intervention.InterventionRemediationService import (
    get_workspace,
    preview_score_adjustment,
)
from app.services.submission.SubmissionService import grade_student_submission
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_remediation_draft_preflight import (
    _make_classwork_draft,
    _setup_intervention_with_targets,
)
from tests.test_remediation_target_persistence import _make_classwork_target
from tests.test_teacher_intervention_review import _id, _staff, candidate_context


RUBRIC_A = [
    {"level_name": "Mastery", "description": "Demonstrates complete geometric proof with zero errors", "points": 50.0, "display_order": 0},
    {"level_name": "Proficient", "description": "Shows clear reasoning with minor computational slips", "points": 38.0, "display_order": 1},
    {"level_name": "Developing", "description": "Partially applies theorems with incomplete steps", "points": 25.0, "display_order": 2},
    {"level_name": "Emerging", "description": "Minimal attempt with major conceptual gaps", "points": 12.0, "display_order": 3},
]

RUBRIC_B = [
    {"level_name": "Outstanding", "description": "Models real-world ratios accurately with labeled diagrams", "points": 30.0, "display_order": 0},
    {"level_name": "Satisfactory", "description": "Correct model with minor labeling omissions", "points": 20.0, "display_order": 1},
    {"level_name": "Needs Support", "description": "Model is incomplete or uses incorrect ratios", "points": 10.0, "display_order": 2},
]


def _attach_rubric(db, classwork: Classwork, levels: list[dict]) -> None:
    classwork.rubric_levels.clear()
    for idx, item in enumerate(levels):
        classwork.rubric_levels.append(
            ActivityRubricLevel(
                level_name=item["level_name"],
                description=item["description"],
                points=Decimal(str(item["points"])),
                display_order=idx,
            )
        )
    classwork.total_points = Decimal(str(max(item["points"] for item in levels)))
    db.flush()


def _ai_classwork_payload(competency_id: int, lesson_id: int, *, title: str, fake_points: float = 40.0) -> dict:
    return {
        "draft_format": "CLASSWORK",
        "target_component": "PERFORMANCE_TASK",
        "grade_treatment": "PERFORMANCE_TASK",
        "title": title,
        "description": "Guided remediation task targeting missed geometry skills.",
        "student_instructions": "Follow the scaffolded steps and submit your annotated work.",
        "total_points": fake_points,
        "activity_mode": "ONLINE",
        "tasks": [
            {
                "task_number": 1,
                "title": "Scaffolded Proof Practice",
                "instructions": "Complete the two-column proof using the given angle relationships.",
                "targeted_competency_id": competency_id,
                "targeted_lesson_id": lesson_id,
            }
        ],
        "deliverables": [
            {
                "deliverable_name": "Annotated Solution Sheet",
                "deliverable_type": "PDF",
                "description": "Upload a PDF showing all reasoning steps.",
            }
        ],
        "supported_upload_formats": [".pdf", ".docx"],
        # Deliberately different rubric to verify server-side enforcement preserves original rubric!
        "rubric_levels": [
            {"level_name": "AI Invented Top", "description": "AI tried to replace the rubric", "points": fake_points, "display_order": 0},
            {"level_name": "AI Invented Low", "description": "AI tried to invent a lower band", "points": fake_points / 2, "display_order": 1},
        ],
        "teacher_guide": {
            "exemplar_or_expected_response": "Students prove congruence using SAS and justify every statement.",
            "evaluation_notes": "Grade against the original performance task rubric levels.",
            "common_misconceptions": ["Confusing complementary and supplementary angles"],
        },
    }


@pytest.mark.anyio
async def test_ai_generation_inherits_original_rubric_and_switches_targets_cleanly(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    competency, lesson, target_a, _reading = _setup_intervention_with_targets(
        ctx, "PERFORMANCE_TASK", 50.0,
    )
    _attach_rubric(db, target_a.classwork, RUBRIC_A)

    target_b = _make_classwork_target(
        ctx, "PT 2 - Ratio Modeling", category="PERFORMANCE_TASK", classwork_type="ACTIVITY", score=10.0, points=30.0,
    )
    _attach_rubric(db, target_b.classwork, RUBRIC_B)

    ctx["candidate"].remediation_plan = {
        **ctx["candidate"].remediation_plan,
        "teacher_choice": "CLASSWORK",
        "grade_treatment": "PERFORMANCE_TASK",
        "target_assignment_ids": [target_a.classwork_assignment_id, target_b.classwork_assignment_id],
        "score_adjustment_cap": 75.0,
    }
    db.commit()

    # Workspace & score previews expose each target's saved rubric levels
    preview_res = preview_score_adjustment(
        db,
        _staff(ctx),
        _id(ctx),
        cap_percentage=75.0,
        target_assignment_ids=[target_a.classwork_assignment_id, target_b.classwork_assignment_id],
    )
    by_id = {item["assignment_id"]: item for item in preview_res["previews"]}
    assert [r["level_name"] for r in by_id[target_a.classwork_assignment_id]["rubric_levels"]] == [
        "Mastery", "Proficient", "Developing", "Emerging",
    ]
    assert [r["level_name"] for r in by_id[target_b.classwork_assignment_id]["rubric_levels"]] == [
        "Outstanding", "Satisfactory", "Needs Support",
    ]

    # Generate for Target A: AI tries to invent its own rubric, but Target A's exact rubric is enforced
    ai_payload_a = _ai_classwork_payload(
        competency.competency_id, lesson.lesson_id, title="Custom AI Remediation Task A",
    )
    mock_generate = AsyncMock(return_value=json.dumps(ai_payload_a))
    with patch("app.services.ai.Provider.generate_text", mock_generate):
        draft_a = await generate_remediation_draft(
            db,
            _staff(ctx),
            _id(ctx),
            RemediationDraftGenerationRequest(
                draft_format="CLASSWORK",
                target_component="PERFORMANCE_TASK",
                grade_treatment="PERFORMANCE_TASK",
                target_assignment_id=target_a.classwork_assignment_id,
                item_count=1,
                total_points=50.0,
            ),
        )

    assert draft_a.title == "Custom AI Remediation Task A"
    assert draft_a.student_instructions == ai_payload_a["student_instructions"]
    assert draft_a.total_points == 50.0
    assert [r.model_dump() for r in draft_a.rubric_levels] == RUBRIC_A
    sent_prompt = mock_generate.call_args.args[0]
    assert "locked_original_rubric_levels" in sent_prompt
    assert "Mastery" in sent_prompt

    # Switch to Target B: inherits Target B's exact rubric and max points (30.0), not Target A's
    ai_payload_b = _ai_classwork_payload(
        competency.competency_id, lesson.lesson_id, title="Custom AI Remediation Task B",
    )
    mock_generate_b = AsyncMock(return_value=json.dumps(ai_payload_b))
    with patch("app.services.ai.Provider.generate_text", mock_generate_b):
        draft_b = await generate_remediation_draft(
            db,
            _staff(ctx),
            _id(ctx),
            RemediationDraftGenerationRequest(
                draft_format="CLASSWORK",
                target_component="PERFORMANCE_TASK",
                grade_treatment="PERFORMANCE_TASK",
                target_assignment_id=target_b.classwork_assignment_id,
                item_count=1,
                total_points=50.0,  # Stale client points must still resolve to Target B's 30.0
            ),
        )

    assert draft_b.title == "Custom AI Remediation Task B"
    assert draft_b.total_points == 30.0
    assert [r.model_dump() for r in draft_b.rubric_levels] == RUBRIC_B


def test_preflight_and_ai_creation_reject_tampered_rubric_and_persist_original_rubric(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    competency, lesson, target_a, _reading = _setup_intervention_with_targets(
        ctx, "PERFORMANCE_TASK", 50.0,
    )
    _attach_rubric(db, target_a.classwork, RUBRIC_A)
    ctx["candidate"].remediation_plan = {
        **ctx["candidate"].remediation_plan,
        "teacher_choice": "CLASSWORK",
        "grade_treatment": "PERFORMANCE_TASK",
        "target_assignment_ids": [target_a.classwork_assignment_id],
        "score_adjustment_cap": 75.0,
    }
    db.commit()

    base_draft = _make_classwork_draft(
        competency.competency_id, lesson.lesson_id, total_points=50.0,
    )
    base_dict = base_draft.model_dump()
    base_dict["rubric_levels"] = deepcopy(RUBRIC_A)

    # Matching original rubric passes preflight and persists verbatim
    preflight = preflight_remediation_draft(
        db,
        _staff(ctx),
        _id(ctx),
        base_dict,
        target_assignment_id=target_a.classwork_assignment_id,
        require_readings=False,
    )
    assert preflight.is_valid is True

    created = create_remediation_assessment(
        db,
        staff_id=_staff(ctx),
        intervention_id=_id(ctx),
        remediation_request_id=uuid4(),
        target_assignment_id=target_a.classwork_assignment_id,
        draft_input=base_dict,
    )
    saved_cw = db.get(Classwork, created.classwork_id)
    assert [
        (r.level_name, r.description, float(r.points))
        for r in sorted(saved_cw.rubric_levels, key=lambda x: -float(x.points))
    ] == [(r["level_name"], r["description"], r["points"]) for r in RUBRIC_A]

    # Tampered criteria/score range with same max points is rejected on preflight
    target_b = _make_classwork_target(
        ctx, "PT 2 - Tamper Check", category="PERFORMANCE_TASK", classwork_type="ACTIVITY", score=10.0, points=30.0,
    )
    _attach_rubric(db, target_b.classwork, RUBRIC_B)
    ctx["candidate"].remediation_plan = {
        **ctx["candidate"].remediation_plan,
        "target_assignment_ids": [target_a.classwork_assignment_id, target_b.classwork_assignment_id],
    }
    db.commit()

    tampered = _make_classwork_draft(
        competency.competency_id, lesson.lesson_id, total_points=30.0,
    ).model_dump()
    tampered["rubric_levels"] = [
        {"level_name": "Outstanding", "description": "Altered criteria text", "points": 30.0, "display_order": 0},
        {"level_name": "Satisfactory", "description": "Correct model with minor labeling omissions", "points": 22.0, "display_order": 1},
        {"level_name": "Needs Support", "description": "Model is incomplete or uses incorrect ratios", "points": 10.0, "display_order": 2},
    ]
    with pytest.raises(HTTPException) as exc:
        preflight_remediation_draft(
            db,
            _staff(ctx),
            _id(ctx),
            tampered,
            target_assignment_id=target_b.classwork_assignment_id,
            require_readings=False,
        )
    assert exc.value.status_code == 422
    assert "saved rubric" in str(exc.value.detail).lower()


@pytest.mark.anyio
async def test_manual_creation_edit_and_teacher_grading_keep_rubric_aligned_and_cap_separate(
    candidate_context, monkeypatch,
):
    from app.services.submission import SubmissionFeedbackService

    monkeypatch.setattr(
        SubmissionFeedbackService,
        "dispatch_background_draft_processing",
        lambda *_args, **_kwargs: None,
    )
    ctx = candidate_context
    db = ctx["db"]
    _competency, lesson, target_a, _reading = _setup_intervention_with_targets(
        ctx, "PERFORMANCE_TASK", 50.0,
    )
    _attach_rubric(db, target_a.classwork, RUBRIC_A)
    ctx["candidate"].remediation_plan = {
        **ctx["candidate"].remediation_plan,
        "teacher_choice": "CLASSWORK",
        "grade_treatment": "PERFORMANCE_TASK",
        "target_assignment_ids": [target_a.classwork_assignment_id],
        "score_adjustment_cap": 75.0,
    }
    db.commit()

    teacher_user = {"role": "teacher", "sub": str(ctx["staff"].user_id)}

    # 1. Manual creation with an incompatible rubric is rejected with HTTP 400
    bad_rubric = json.dumps([
        {"level_name": "Custom Top", "description": "Different standard", "points": 50.0, "display_order": 0},
        {"level_name": "Custom Low", "description": "Different lower standard", "points": 20.0, "display_order": 1},
    ])
    with pytest.raises(HTTPException) as bad_exc:
        await create_classwork_wizard_record(
            title="Manual Remediation Bad Rubric",
            description="Remediation task",
            instructions="Complete task",
            classwork_type="ASSIGNMENT",
            classwork_category="PERFORMANCE_TASK",
            exam_subtype=None,
            total_points=50.0,
            subject_id=ctx["subject"].subject_id,
            is_published=True,
            show_scores=True,
            class_ids=json.dumps([ctx["class"].class_id]),
            academic_period_id=ctx["period"].academic_period_id,
            lesson_ids=None,
            due_date=None,
            lock_date=None,
            allow_late_submissions=False,
            max_attempts=None,
            quiz_payload=None,
            rubric_payload=bad_rubric,
            files=None,
            intervention_id=_id(ctx),
            remediation_request_id=uuid4(),
            original_classwork_assignment_id=target_a.classwork_assignment_id,
            current_user=teacher_user,
            staff_id=_staff(ctx),
            db=db,
        )
    assert bad_exc.value.status_code == 400
    assert "saved rubric" in str(bad_exc.value.detail).lower()

    # 2. Manual creation omitting rubric_payload automatically inherits original rubric
    created = await create_classwork_wizard_record(
        title="Manual Remediation Inherited",
        description="Alternative remediation task",
        instructions="Follow the revised learning steps.",
        classwork_type="ASSIGNMENT",
        classwork_category="PERFORMANCE_TASK",
        exam_subtype=None,
        total_points=50.0,
        subject_id=ctx["subject"].subject_id,
        is_published=True,
        show_scores=True,
        class_ids=json.dumps([ctx["class"].class_id]),
        academic_period_id=ctx["period"].academic_period_id,
        lesson_ids=None,
        due_date=None,
        lock_date=None,
        allow_late_submissions=False,
        max_attempts=None,
        quiz_payload=None,
        rubric_payload=None,
        files=None,
        intervention_id=_id(ctx),
        remediation_request_id=uuid4(),
        original_classwork_assignment_id=target_a.classwork_assignment_id,
        current_user=teacher_user,
        staff_id=_staff(ctx),
        db=db,
    )
    assert [(r.level_name, r.description, float(r.points)) for r in created.rubric_levels] == [
        (r["level_name"], r["description"], r["points"]) for r in RUBRIC_A
    ]

    # 3. Updating instructions works, while attempting to replace the rubric is blocked
    updated = update_classwork_record(
        created.classwork_id,
        ClassworkUpdate(instructions="Updated teacher instructions only."),
        _staff(ctx),
        db,
    )
    assert updated.instructions == "Updated teacher instructions only."
    assert [(r.level_name, float(r.points)) for r in updated.rubric_levels] == [
        (r["level_name"], r["points"]) for r in RUBRIC_A
    ]

    with pytest.raises(HTTPException) as edit_exc:
        update_classwork_record(
            created.classwork_id,
            ClassworkUpdate(
                rubric_levels=[
                    {"level_name": "Altered", "description": "Changed standard", "points": 50.0, "display_order": 0},
                ],
            ),
            _staff(ctx),
            db,
        )
    assert edit_exc.value.status_code == 400
    assert "saved rubric" in str(edit_exc.value.detail).lower()

    # 4. Teacher grades within Mastery range (45/50 > 75% cap of 37.5);
    # raw submission grade stays 45/50 and remediation cap applies ONLY to effective adjusted score (37.5/50)
    rem_asgn = (
        db.query(ClassworkAssignment)
        .filter_by(classwork_id=created.classwork_id)
        .one()
    )
    submission = StudentSubmission(
        classwork_assignment_id=rem_asgn.classwork_assignment_id,
        student_id=ctx["student"].student_id,
        status="submitted",
    )
    db.add(submission)
    db.commit()

    graded = grade_student_submission(
        submission.submission_id,
        GradeRequest(grade=45.0, feedback="Strong mastery of proofs."),
        _staff(ctx),
        db,
    )
    assert float(graded.grade) == 45.0

    workspace = get_workspace(db, _staff(ctx), _id(ctx))
    assigned = next(
        item
        for item in workspace["progress"]["assigned_remediation"]
        if item["assignment_id"] == rem_asgn.classwork_assignment_id
    )
    assert assigned["grade"] == 45.0
    assert assigned["total_points"] == 50.0
    assert assigned["effective_grade"] == 37.5

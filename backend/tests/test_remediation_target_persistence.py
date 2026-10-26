"""Focused tests for teacher remediation target persistence foundation.

Verifies:
1. Persistence of single and multiple target classwork assignment IDs.
2. Persistence of teacher-configured score adjustment cap (default 75%).
3. Validation of teacher authorization, student, class, subject, period, category, and finalized state.
4. Prevention of duplicate target assignment IDs.
5. Rejection of 100% full replacement cap.
6. Backward compatibility with existing original_exam_assignment_id workflows.
"""

from decimal import Decimal
from uuid import uuid4
import pytest
from fastapi import HTTPException

from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.intervention.Intervention import Intervention
from app.services.intervention.InterventionRemediationService import (
    PlanUpdate, get_workspace, save_plan,
)
from tests.test_intervention_support_materials import _activate
from tests.test_teacher_intervention_review import candidate_context, _id, _other_staff, _staff
from tests.test_current_period_live_feature_builder import current_period_context


def _make_classwork_target(
    ctx,
    title: str,
    category: str = "WRITTEN_WORK",
    classwork_type: str = "ASSIGNMENT",
    points: float = 20.0,
    score: float | None = 10.0,
    is_graded: bool = True,
    is_archived: bool = False,
    is_remedial: bool = False,
    class_id: int | None = None,
    subject_id: int | None = None,
    period_id: int | None = None,
    recipient_student_id=None,
    exam_subtype: str | None = None,
) -> ClassworkAssignment:
    db = ctx["db"]
    cw = Classwork(
        title=title,
        classwork_category=category,
        classwork_type=classwork_type,
        exam_subtype=exam_subtype,
        subject_id=subject_id or ctx["subject"].subject_id,
        created_by_staff_id=_staff(ctx),
        total_points=points,
        is_graded=is_graded,
        is_archived=is_archived,
    )
    db.add(cw)
    db.flush()

    req_id = uuid4() if (recipient_student_id is not None or is_remedial) else None
    source_id = (_id(ctx) if is_remedial else 99999) if (recipient_student_id is not None or is_remedial) else None
    recipient_id = (recipient_student_id or ctx["student"].student_id) if (recipient_student_id is not None or is_remedial) else None

    assignment = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=class_id or ctx["class"].class_id,
        academic_period_id=period_id or ctx["period"].academic_period_id,
        assigned_by_staff_id=_staff(ctx),
        is_published=True,
        recipient_student_id=recipient_id,
        source_intervention_id=source_id,
        remediation_request_id=req_id,
    )
    db.add(assignment)
    db.flush()

    if score is not None:
        sub = StudentSubmission(
            classwork_assignment_id=assignment.classwork_assignment_id,
            student_id=recipient_student_id or ctx["student"].student_id,
            grade=Decimal(str(score)),
            status="graded",
        )
        db.add(sub)
        db.flush()

    db.commit()
    return assignment


def _set_focus(ctx, *components: str) -> None:
    row = ctx["db"].get(Intervention, _id(ctx))
    row.diagnosis_snapshot = {
        **(row.diagnosis_snapshot or {}),
        "weakest_supported_components": list(components),
    }
    ctx["db"].commit()


def test_persist_single_and_multiple_target_assignments_with_default_cap(candidate_context):
    ctx = candidate_context; db = ctx["db"]; _activate(ctx)

    a1 = _make_classwork_target(ctx, "Written Exercise 1", category="WRITTEN_WORK", score=10.0)
    a2 = _make_classwork_target(ctx, "Written Exercise 2", category="WRITTEN_WORK", score=12.0)

    # 1. Single target
    saved_single = save_plan(
        db, _staff(ctx), _id(ctx),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[a1.classwork_assignment_id],
        ),
    )
    assert saved_single["plan"]["grade_treatment"] == "WRITTEN_WORK"
    assert saved_single["plan"]["target_assignment_ids"] == [a1.classwork_assignment_id]
    assert saved_single["plan"]["score_adjustment_cap"] == 75.0

    # 2. Multiple targets
    saved_multi = save_plan(
        db, _staff(ctx), _id(ctx),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[a1.classwork_assignment_id, a2.classwork_assignment_id],
        ),
    )
    assert saved_multi["plan"]["target_assignment_ids"] == [
        a1.classwork_assignment_id, a2.classwork_assignment_id,
    ]
    assert saved_multi["plan"]["score_adjustment_cap"] == 75.0

    # 3. get_workspace returns persisted fields
    workspace = get_workspace(db, _staff(ctx), _id(ctx))
    assert workspace["plan"]["target_assignment_ids"] == [
        a1.classwork_assignment_id, a2.classwork_assignment_id,
    ]
    assert workspace["plan"]["score_adjustment_cap"] == 75.0


def test_persist_teacher_selected_adjustment_cap(candidate_context):
    ctx = candidate_context; db = ctx["db"]; _activate(ctx)
    _set_focus(ctx, "PERFORMANCE_TASK")
    a1 = _make_classwork_target(ctx, "Task 1", category="PERFORMANCE_TASK", score=14.0)

    saved = save_plan(
        db, _staff(ctx), _id(ctx),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="PERFORMANCE_TASK",
            target_assignment_ids=[a1.classwork_assignment_id],
            score_adjustment_cap=85.0,
        ),
    )
    assert saved["plan"]["score_adjustment_cap"] == 85.0

    workspace = get_workspace(db, _staff(ctx), _id(ctx))
    assert workspace["plan"]["score_adjustment_cap"] == 85.0


def test_reject_graded_treatment_outside_verified_focus(candidate_context):
    ctx = candidate_context; db = ctx["db"]; _activate(ctx)
    target = _make_classwork_target(ctx, "Forged Task", category="PERFORMANCE_TASK")

    with pytest.raises(HTTPException) as exc:
        save_plan(
            db, _staff(ctx), _id(ctx),
            PlanUpdate(
                teacher_choice="CLASSWORK",
                grade_treatment="PERFORMANCE_TASK",
                target_assignment_ids=[target.classwork_assignment_id],
            ),
        )

    assert exc.value.status_code == 422
    assert "verified Written Work intervention focus" in exc.value.detail


def test_missing_or_ambiguous_focus_allows_only_ungraded_treatment(candidate_context):
    ctx = candidate_context; db = ctx["db"]; _activate(ctx)

    for components in ((), ("WRITTEN_WORK", "PERFORMANCE_TASK")):
        _set_focus(ctx, *components)
        with pytest.raises(HTTPException) as exc:
            save_plan(
                db, _staff(ctx), _id(ctx),
                PlanUpdate(teacher_choice="QUIZ", grade_treatment="WRITTEN_WORK"),
            )
        assert exc.value.status_code == 422
        assert "one verified weakest grading component" in exc.value.detail

    saved = save_plan(
        db, _staff(ctx), _id(ctx),
        PlanUpdate(teacher_choice="QUIZ", grade_treatment="PRACTICE_ONLY"),
    )
    assert saved["plan"]["grade_treatment"] == "PRACTICE_ONLY"


def test_legacy_cross_focus_plan_is_read_without_automatic_mutation(candidate_context):
    ctx = candidate_context; db = ctx["db"]; _activate(ctx)
    row = db.get(Intervention, _id(ctx))
    row.remediation_plan = {
        "teacher_choice": "CLASSWORK",
        "grade_treatment": "PERFORMANCE_TASK",
        "target_assignment_ids": [9876],
        "selected_resources": [],
    }
    db.commit()

    workspace = get_workspace(db, _staff(ctx), _id(ctx))
    assert workspace["plan"]["grade_treatment"] == "PERFORMANCE_TASK"
    assert workspace["plan"]["target_assignment_ids"] == [9876]

    with pytest.raises(HTTPException):
        save_plan(
            db, _staff(ctx), _id(ctx),
            PlanUpdate(teacher_choice="CLASSWORK", grade_treatment="PERFORMANCE_TASK"),
        )
    db.refresh(row)
    assert row.remediation_plan["grade_treatment"] == "PERFORMANCE_TASK"
    assert row.remediation_plan["target_assignment_ids"] == [9876]

    reconciled = save_plan(
        db, _staff(ctx), _id(ctx),
        PlanUpdate(teacher_choice="CLASSWORK", grade_treatment="PRACTICE_ONLY"),
    )
    assert reconciled["plan"]["grade_treatment"] == "PRACTICE_ONLY"
    assert reconciled["plan"]["target_assignment_ids"] == []


def test_reject_100_percent_cap_in_plan_update(candidate_context):
    ctx = candidate_context; db = ctx["db"]; _activate(ctx)
    a1 = _make_classwork_target(ctx, "Written Task", category="WRITTEN_WORK", score=10.0)

    with pytest.raises(HTTPException) as exc:
        save_plan(
            db, _staff(ctx), _id(ctx),
            PlanUpdate(
                teacher_choice="CLASSWORK",
                grade_treatment="WRITTEN_WORK",
                target_assignment_ids=[a1.classwork_assignment_id],
                score_adjustment_cap=100.0,
            ),
        )
    assert exc.value.status_code == 422
    assert "excluding 100% full replacement" in exc.value.detail


def test_reject_duplicate_target_assignment_ids(candidate_context):
    ctx = candidate_context; db = ctx["db"]; _activate(ctx)
    a1 = _make_classwork_target(ctx, "Duplicate Check", category="WRITTEN_WORK", score=10.0)

    with pytest.raises(HTTPException) as exc:
        save_plan(
            db, _staff(ctx), _id(ctx),
            PlanUpdate(
                teacher_choice="CLASSWORK",
                grade_treatment="WRITTEN_WORK",
                target_assignment_ids=[a1.classwork_assignment_id, a1.classwork_assignment_id],
            ),
        )
    assert exc.value.status_code == 422
    assert "Duplicate target classwork assignment IDs" in exc.value.detail


def test_reject_cross_category_targets(candidate_context):
    ctx = candidate_context; db = ctx["db"]; _activate(ctx)
    perf_task = _make_classwork_target(ctx, "Poster Making", category="PERFORMANCE_TASK", score=15.0)

    with pytest.raises(HTTPException) as exc:
        save_plan(
            db, _staff(ctx), _id(ctx),
            PlanUpdate(
                teacher_choice="CLASSWORK",
                grade_treatment="WRITTEN_WORK",  # Treatment is Written Work
                target_assignment_ids=[perf_task.classwork_assignment_id],  # Target is Performance Task
            ),
        )
    assert exc.value.status_code == 422
    assert "cross-category adjustment not allowed" in exc.value.detail


def test_reject_unscored_target_classwork(candidate_context):
    ctx = candidate_context; db = ctx["db"]; _activate(ctx)
    unscored = _make_classwork_target(ctx, "Unscored Quiz", category="WRITTEN_WORK", score=None)

    with pytest.raises(HTTPException) as exc:
        save_plan(
            db, _staff(ctx), _id(ctx),
            PlanUpdate(
                teacher_choice="CLASSWORK",
                grade_treatment="WRITTEN_WORK",
                target_assignment_ids=[unscored.classwork_assignment_id],
            ),
        )
    assert exc.value.status_code == 422
    assert "no scored submission" in exc.value.detail


def test_reject_target_outside_scope(candidate_context):
    ctx = candidate_context; db = ctx["db"]; _activate(ctx)
    wrong_class = _make_classwork_target(ctx, "Other Class Task", category="WRITTEN_WORK", class_id=9999)

    with pytest.raises(HTTPException) as exc:
        save_plan(
            db, _staff(ctx), _id(ctx),
            PlanUpdate(
                teacher_choice="CLASSWORK",
                grade_treatment="WRITTEN_WORK",
                target_assignment_ids=[wrong_class.classwork_assignment_id],
            ),
        )
    assert exc.value.status_code == 422
    assert "outside this student's intervention scope" in exc.value.detail


def test_reject_target_for_different_student(candidate_context):
    ctx = candidate_context; db = ctx["db"]; _activate(ctx)
    other_student_id = uuid4()
    other_student_target = _make_classwork_target(
        ctx, "Individual Task", category="WRITTEN_WORK",
        recipient_student_id=other_student_id,
    )

    with pytest.raises(HTTPException) as exc:
        save_plan(
            db, _staff(ctx), _id(ctx),
            PlanUpdate(
                teacher_choice="CLASSWORK",
                grade_treatment="WRITTEN_WORK",
                target_assignment_ids=[other_student_target.classwork_assignment_id],
            ),
        )
    assert exc.value.status_code == 422
    assert "was assigned to another individual student" in exc.value.detail


def test_reject_targeting_another_remedial_classwork(candidate_context):
    ctx = candidate_context; db = ctx["db"]; _activate(ctx)
    remedial_cw = _make_classwork_target(ctx, "Remedial Quiz", category="WRITTEN_WORK", is_remedial=True)

    with pytest.raises(HTTPException) as exc:
        save_plan(
            db, _staff(ctx), _id(ctx),
            PlanUpdate(
                teacher_choice="CLASSWORK",
                grade_treatment="WRITTEN_WORK",
                target_assignment_ids=[remedial_cw.classwork_assignment_id],
            ),
        )
    assert exc.value.status_code == 422
    assert "already a remedial assignment" in exc.value.detail


def test_reject_targets_in_finalized_period(candidate_context):
    ctx = candidate_context; db = ctx["db"]; _activate(ctx)
    a1 = _make_classwork_target(ctx, "Pre-Final Task", category="WRITTEN_WORK", score=10.0)

    # Mark period grade finalized
    pg = StudentPeriodGrade(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        final_period_grade=Decimal("80.00"),
        is_finalized=True,
    )
    db.add(pg)
    db.commit()

    with pytest.raises(HTTPException) as exc:
        save_plan(
            db, _staff(ctx), _id(ctx),
            PlanUpdate(
                teacher_choice="CLASSWORK",
                grade_treatment="WRITTEN_WORK",
                target_assignment_ids=[a1.classwork_assignment_id],
            ),
        )
    assert exc.value.status_code == 409
    assert "period grade is finalized" in exc.value.detail


def test_reject_targets_for_practice_only_treatment(candidate_context):
    ctx = candidate_context; db = ctx["db"]; _activate(ctx)
    a1 = _make_classwork_target(ctx, "Practice Item", category="WRITTEN_WORK", score=10.0)

    with pytest.raises(HTTPException) as exc:
        save_plan(
            db, _staff(ctx), _id(ctx),
            PlanUpdate(
                teacher_choice="CLASSWORK",
                grade_treatment="PRACTICE_ONLY",
                target_assignment_ids=[a1.classwork_assignment_id],
            ),
        )
    assert exc.value.status_code == 422
    assert "only be set for graded remediation treatments" in exc.value.detail


def test_backward_compatibility_with_original_exam_assignment_id(candidate_context):
    """Preserves compatibility with existing original_exam_assignment_id."""
    ctx = candidate_context; db = ctx["db"]; _activate(ctx)
    row = db.get(Intervention, _id(ctx))

    # Temporarily set focus to EXAMINATION so it passes examination validation
    row.diagnosis_snapshot = {
        "focus": "EXAMINATION",
        "weakest_supported_components": ["EXAMINATION"],
        "evidence_level": "COMPONENT_ONLY",
        "component": "EXAMINATION",
        "exam_subtype": "SUMMATIVE_1",
    }
    db.commit()

    exam = _make_classwork_target(
        ctx, "Summative Exam 1", category="EXAMS",
        classwork_type="EXAM", exam_subtype="SUMMATIVE_1", score=15.0,
    )

    # Save via original_exam_assignment_id legacy field
    saved = save_plan(
        db, _staff(ctx), _id(ctx),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="EXAMINATION",
            original_exam_assignment_id=exam.classwork_assignment_id,
        ),
    )
    assert saved["plan"]["grade_treatment"] == "EXAMINATION"
    assert saved["plan"]["original_exam_assignment_id"] == exam.classwork_assignment_id
    assert saved["plan"]["target_assignment_ids"] == [exam.classwork_assignment_id]

    workspace = get_workspace(db, _staff(ctx), _id(ctx))
    assert workspace["plan"]["original_exam_assignment_id"] == exam.classwork_assignment_id
    assert workspace["plan"]["target_assignment_ids"] == [exam.classwork_assignment_id]


def test_preview_score_adjustment_service_and_workspace(candidate_context):
    ctx = candidate_context; db = ctx["db"]; _activate(ctx)
    from app.services.intervention.InterventionRemediationService import preview_score_adjustment

    # Target: score 14/20
    target = _make_classwork_target(ctx, "Algebraic Expressions", category="WRITTEN_WORK", score=14.0)

    # 1. 75% cap: max achievable is 20 * 75% = 15.0, gain +1.0
    preview_75 = preview_score_adjustment(
        db, _staff(ctx), _id(ctx), cap_percentage=75,
        target_assignment_ids=[target.classwork_assignment_id],
    )
    assert preview_75["score_adjustment_cap"] == 75.0
    assert len(preview_75["previews"]) == 1
    p1 = preview_75["previews"][0]
    assert p1["assignment_id"] == target.classwork_assignment_id
    assert p1["original_score"] == 14.0
    assert p1["max_points"] == 20.0
    assert p1["max_adjusted_score"] == 15.0
    assert p1["possible_gain"] == 1.0
    assert p1["was_adjusted"] is True
    assert p1["was_capped"] is True
    assert "Hypothetical maximum" in preview_75["disclaimer"]

    # 2. Dynamic update with 85% cap: max achievable is 20 * 85% = 17.0, gain +3.0
    preview_85 = preview_score_adjustment(
        db, _staff(ctx), _id(ctx), cap_percentage=85,
        target_assignment_ids=[target.classwork_assignment_id],
    )
    p2 = preview_85["previews"][0]
    assert p2["max_adjusted_score"] == 17.0
    assert p2["possible_gain"] == 3.0

    # 3. Save plan and verify get_workspace includes score_previews
    save_plan(
        db, _staff(ctx), _id(ctx),
        PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[target.classwork_assignment_id],
            score_adjustment_cap=80.0,
        ),
    )
    workspace = get_workspace(db, _staff(ctx), _id(ctx))
    assert "score_previews" in workspace
    assert len(workspace["score_previews"]) == 1
    wp = workspace["score_previews"][0]
    assert wp["assignment_id"] == target.classwork_assignment_id
    # 20 * 80% = 16.0, gain = 16 - 14 = +2.0
    assert wp["max_adjusted_score"] == 16.0
    assert wp["possible_gain"] == 2.0


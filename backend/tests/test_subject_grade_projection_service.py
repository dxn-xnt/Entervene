"""Focused contract tests for the Task 4.8B read-only projection foundation."""

from __future__ import annotations

from datetime import date
from decimal import Decimal
from uuid import uuid4

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.grading.SubjectGradeProjectionService import calculate_subject_grade_projection
from app.services.student_record.StudentRecordService import teacher_student_gradebook
from tests.test_gradebook_remediation_integration import (
    _create_remedial_pt,
    gradebook_integration_context,
)


def _add_assignment(ctx, *, title, category, points, score_a, score_b, exam_subtype=None, recipient=None):
    db = ctx["db"]
    work = Classwork(
        title=title,
        subject_id=ctx["subject"].subject_id,
        classwork_category=category,
        classwork_type="EXAM" if exam_subtype else "ACTIVITY",
        exam_subtype=exam_subtype,
        total_points=Decimal(str(points)),
        created_by_staff_id=ctx["teacher"].staff_id,
        is_graded=True,
        is_archived=False,
    )
    db.add(work)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=work.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=ctx["teacher"].staff_id,
        recipient_student_id=recipient,
        is_published=True,
    )
    db.add(assignment)
    db.flush()
    if score_a is not None:
        db.add(StudentSubmission(
            student_id=ctx["student_a"].student_id,
            classwork_assignment_id=assignment.classwork_assignment_id,
            grade=Decimal(str(score_a)),
            status="graded",
        ))
    if score_b is not None:
        db.add(StudentSubmission(
            student_id=ctx["student_b"].student_id,
            classwork_assignment_id=assignment.classwork_assignment_id,
            grade=Decimal(str(score_b)),
            status="graded",
        ))
    db.commit()
    return assignment


def _complete_exam_evidence(ctx):
    st1 = _add_assignment(
        ctx, title="Summative 1", category="QUARTERLY_ASSESSMENT", points=50,
        score_a=35, score_b=45, exam_subtype="SUMMATIVE_1",
    )
    st2 = _add_assignment(
        ctx, title="Summative 2", category="QUARTERLY_ASSESSMENT", points=50,
        score_a=30, score_b=40, exam_subtype="SUMMATIVE_2",
    )
    return st1, st2


def _second_pt(ctx):
    return _add_assignment(
        ctx, title="PT 2", category="PERFORMANCE_TASK", points=20,
        score_a=5, score_b=18,
    )


def _foreign_assignment(ctx, *, title, subject_id, class_id, period_id):
    db = ctx["db"]
    work = Classwork(
        title=title,
        subject_id=subject_id,
        classwork_category="PERFORMANCE_TASK",
        classwork_type="ACTIVITY",
        total_points=Decimal("20"),
        created_by_staff_id=ctx["teacher"].staff_id,
        is_graded=True,
        is_archived=False,
    )
    db.add(work)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=work.classwork_id,
        class_id=class_id,
        academic_period_id=period_id,
        assigned_by_staff_id=ctx["teacher"].staff_id,
        is_published=True,
    )
    db.add(assignment)
    db.flush()
    db.add(StudentSubmission(
        student_id=ctx["student_a"].student_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        grade=Decimal("5"),
        status="graded",
    ))
    db.commit()
    return assignment


def _calculate(ctx, targets=None, *, student=None, class_id=None, subject_id=None, period_id=None):
    return calculate_subject_grade_projection(
        ctx["db"],
        staff_id=ctx["teacher"].staff_id,
        student_id=(student or ctx["student_a"]).student_id,
        class_id=class_id or ctx["class"].class_id,
        subject_id=subject_id or ctx["subject"].subject_id,
        academic_period_id=period_id or ctx["period"].academic_period_id,
        target_assignment_ids=targets or [],
        cap_percentage=75,
    )


def test_current_grade_and_threshold_use_authoritative_term_grade(gradebook_integration_context):
    ctx = gradebook_integration_context
    _complete_exam_evidence(ctx)
    _second_pt(ctx)

    result = _calculate(ctx)

    assert result["status"] == "AVAILABLE"
    assert result["grade_representation"] == "TRANSMUTED_TERM_GRADE"
    assert result["current_initial_grade"] == 45.2
    assert result["current_subject_grade"] == 69.0
    assert result["passing_threshold"] == 75.0
    assert result["passing_threshold_policy"] == {
        "academic_year_id": ctx["period"].academic_year_id,
        "subject_id": ctx["subject"].subject_id,
        "grading_template_id": ctx["template"].grading_template_id,
        "source": "live_grading_template",
        "policy_version": None,
        "revision": None,
        "captured_at": None,
    }
    assert result["current_reaches_passing_threshold"] is False


def test_single_and_two_target_cumulative_projection(gradebook_integration_context):
    ctx = gradebook_integration_context
    _complete_exam_evidence(ctx)
    second = _second_pt(ctx)
    first_id = ctx["asgn_pt1"].classwork_assignment_id

    single = _calculate(ctx, [first_id])
    cumulative = _calculate(ctx, [first_id, second.classwork_assignment_id])

    first = single["target_projections"][0]
    assert first["maximum_hypothetical_effective_score"] == 30.0
    assert first["possible_score_gain"] == 20.0
    assert first["projected_initial_grade"] == 65.2
    assert first["projected_subject_grade"] == 73.0
    assert first["possible_grade_improvement"] == 4.0
    assert first["reaches_passing_threshold"] is False
    assert single["additional_eligible_targets_have_positive_improvement"] is True
    assert single["recommended_target_assignment_id"] == second.classwork_assignment_id

    first_step, second_step = cumulative["target_projections"]
    assert first_step["projected_subject_grade"] == 73.0
    assert second_step["maximum_hypothetical_effective_score"] == 15.0
    assert second_step["projected_initial_grade"] == 75.2
    assert second_step["projected_subject_grade"] == 79.0
    assert second_step["step_subject_grade_improvement"] == 6.0
    assert second_step["possible_grade_improvement"] == 10.0
    assert second_step["reaches_passing_threshold"] is True
    assert cumulative["additional_eligible_targets_have_positive_improvement"] is False
    assert cumulative["recommended_target_assignment_id"] is None


def test_duplicate_original_is_never_adjusted_twice(gradebook_integration_context):
    ctx = gradebook_integration_context
    _complete_exam_evidence(ctx)
    _second_pt(ctx)
    target = ctx["asgn_pt1"].classwork_assignment_id

    result = _calculate(ctx, [target, target])

    assert result["target_projections"][0]["projected_subject_grade"] == 73.0
    duplicate = result["target_projections"][1]
    assert duplicate["applied"] is False
    assert duplicate["projected_subject_grade"] == 73.0
    assert duplicate["unavailable_reasons"][0]["code"] == "DUPLICATE_TARGET"


def test_missing_exam_makes_subject_projection_unavailable_but_keeps_item_gains(gradebook_integration_context):
    ctx = gradebook_integration_context
    _second_pt(ctx)
    _add_assignment(
        ctx, title="Summative 1", category="QUARTERLY_ASSESSMENT", points=50,
        score_a=35, score_b=45, exam_subtype="SUMMATIVE_1",
    )
    target = ctx["asgn_pt1"].classwork_assignment_id

    result = _calculate(ctx, [target])

    assert result["status"] == "UNAVAILABLE"
    assert result["current_subject_grade"] is None
    assert "INCOMPLETE_EXAMINATION_EVIDENCE" in {reason["code"] for reason in result["unavailable_reasons"]}
    assert result["target_projections"][0]["possible_score_gain"] == 20.0
    assert result["target_projections"][0]["projected_subject_grade"] is None
    assert result["target_projections"][0]["reaches_passing_threshold"] is None
    assert result["additional_eligible_targets_have_positive_improvement"] is True


def test_missing_ww_or_pt_score_is_not_treated_as_zero(gradebook_integration_context):
    ctx = gradebook_integration_context
    _complete_exam_evidence(ctx)
    _second_pt(ctx)
    ctx["sub_a_pt1"].grade = None
    ctx["db"].commit()

    result = _calculate(ctx)

    assert result["status"] == "UNAVAILABLE"
    assert result["current_subject_grade"] is None
    assert "INCOMPLETE_ACADEMIC_EVIDENCE" in {reason["code"] for reason in result["unavailable_reasons"]}


def test_incomplete_remediation_keeps_original_score_and_projection(gradebook_integration_context):
    ctx = gradebook_integration_context
    _complete_exam_evidence(ctx)
    _second_pt(ctx)
    before = _calculate(ctx)
    _create_remedial_pt(ctx, ctx["student_a"], ctx["asgn_pt1"], rem_score=None)

    after = _calculate(ctx)

    assert before["current_subject_grade"] == after["current_subject_grade"] == 69.0
    assert ctx["asgn_pt1"].classwork_assignment_id not in {
        item["assignment_id"] for item in after["eligible_target_gains"]
    }


def test_actual_effective_score_is_the_new_projection_baseline(gradebook_integration_context):
    ctx = gradebook_integration_context
    _complete_exam_evidence(ctx)
    second = _second_pt(ctx)
    _create_remedial_pt(ctx, ctx["student_a"], ctx["asgn_pt1"], rem_score=28)

    result = _calculate(ctx, [second.classwork_assignment_id])
    gradebook = teacher_student_gradebook(
        ctx["db"], ctx["teacher"].staff_id, ctx["class"].class_id,
        ctx["subject"].subject_id, ctx["period"].academic_period_id,
    )
    row = next(item for item in gradebook.studentGrades if item.student_id == str(ctx["student_a"].student_id))

    assert result["status"] == "AVAILABLE"
    assert result["current_subject_grade"] == row.transmuted_grade == 73.0
    assert result["target_projections"][0]["projected_subject_grade"] == 77.0
    assert result["target_projections"][0]["possible_grade_improvement"] == 4.0


def test_student_and_target_scope_are_isolated(gradebook_integration_context):
    ctx = gradebook_integration_context
    _complete_exam_evidence(ctx)
    _second_pt(ctx)
    individual, _, _ = _create_remedial_pt(
        ctx, ctx["student_b"], ctx["asgn_pt1"], rem_score=None,
    )
    before_b = _calculate(ctx, student=ctx["student_b"])["current_subject_grade"]

    result = _calculate(ctx, [individual.classwork_assignment_id, 999999])
    after_b = _calculate(ctx, student=ctx["student_b"])["current_subject_grade"]

    assert result["target_projections"][0]["unavailable_reasons"][0]["code"] == "TARGET_OUTSIDE_STUDENT_SCOPE"
    assert result["target_projections"][1]["unavailable_reasons"][0]["code"] == "TARGET_OUTSIDE_SCOPE"
    assert before_b == after_b


def test_subject_class_and_period_targets_are_isolated(gradebook_integration_context):
    ctx = gradebook_integration_context
    _complete_exam_evidence(ctx)
    _second_pt(ctx)
    db = ctx["db"]
    other_subject = Subject(
        subject_name="Other Projection Subject",
        subject_codename="OTHER-PROJ",
        academic_level_id=ctx["subject"].academic_level_id,
        grading_template_id=ctx["template"].grading_template_id,
    )
    other_class = Class(
        section_name="Other Projection Class",
        academic_year_id=ctx["class"].academic_year_id,
        academic_level_id=ctx["class"].academic_level_id,
        academic_period_id=ctx["period"].academic_period_id,
        adviser_staff_id=None,
        class_status="active",
    )
    other_period = AcademicPeriod(
        period_name="Term 2 Projection Isolation",
        period_type="TERM",
        period_sequence=2,
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.6667"),
        start_date=date(2026, 1, 1),
        end_date=date(2026, 2, 1),
        academic_year_id=ctx["period"].academic_year_id,
        is_active=False,
    )
    db.add_all([other_subject, other_class, other_period])
    db.flush()
    foreign = [
        _foreign_assignment(
            ctx, title="Other subject target", subject_id=other_subject.subject_id,
            class_id=ctx["class"].class_id, period_id=ctx["period"].academic_period_id,
        ),
        _foreign_assignment(
            ctx, title="Other class target", subject_id=ctx["subject"].subject_id,
            class_id=other_class.class_id, period_id=ctx["period"].academic_period_id,
        ),
        _foreign_assignment(
            ctx, title="Other period target", subject_id=ctx["subject"].subject_id,
            class_id=ctx["class"].class_id, period_id=other_period.academic_period_id,
        ),
    ]

    result = _calculate(ctx, [item.classwork_assignment_id for item in foreign])

    assert [
        item["unavailable_reasons"][0]["code"] for item in result["target_projections"]
    ] == ["TARGET_OUTSIDE_SCOPE", "TARGET_OUTSIDE_SCOPE", "TARGET_OUTSIDE_SCOPE"]


def test_projection_does_not_mutate_scores_or_create_interventions(gradebook_integration_context):
    ctx = gradebook_integration_context
    _complete_exam_evidence(ctx)
    second = _second_pt(ctx)
    db = ctx["db"]
    target_ids = [ctx["asgn_pt1"].classwork_assignment_id, second.classwork_assignment_id]
    before_scores = {
        row.submission_id: row.grade
        for row in db.query(StudentSubmission).order_by(StudentSubmission.submission_id).all()
    }
    before_interventions = db.query(Intervention).count()

    result = _calculate(ctx, target_ids)

    after_scores = {
        row.submission_id: row.grade
        for row in db.query(StudentSubmission).order_by(StudentSubmission.submission_id).all()
    }
    assert result["target_projections"][-1]["reaches_passing_threshold"] is True
    assert after_scores == before_scores
    assert db.query(Intervention).count() == before_interventions
    assert not db.new
    assert not db.dirty
    assert not db.deleted


def test_examination_target_is_not_hypothetically_adjusted(gradebook_integration_context):
    ctx = gradebook_integration_context
    _complete_exam_evidence(ctx)
    _second_pt(ctx)

    result = _calculate(ctx, [ctx["asgn_qa1"].classwork_assignment_id])

    target = result["target_projections"][0]
    assert target["applied"] is False
    assert target["unavailable_reasons"][0]["code"] == "TARGET_COMPONENT_UNSUPPORTED"
    gradebook = teacher_student_gradebook(
        ctx["db"], ctx["teacher"].staff_id, ctx["class"].class_id,
        ctx["subject"].subject_id, ctx["period"].academic_period_id,
    )
    row = next(item for item in gradebook.studentGrades if item.student_id == str(ctx["student_a"].student_id))
    assert row.exams == [40.0, 35.0, 30.0]


def test_finalized_grade_is_reported_but_not_projected(gradebook_integration_context):
    ctx = gradebook_integration_context
    _complete_exam_evidence(ctx)
    _second_pt(ctx)
    ctx["db"].add(StudentPeriodGrade(
        student_id=ctx["student_a"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        initial_grade=Decimal("76.00"),
        transmuted_grade=Decimal("80.00"),
        final_period_grade=Decimal("81.00"),
        is_finalized=True,
    ))
    ctx["db"].commit()

    result = _calculate(ctx, [ctx["asgn_pt1"].classwork_assignment_id])

    assert result["status"] == "FINALIZED"
    assert result["grade_representation"] == "FINAL_PERIOD_GRADE"
    assert result["current_subject_grade"] == 81.0
    assert result["eligible_target_gains"] == []
    assert result["additional_eligible_targets_have_positive_improvement"] is False
    assert result["recommended_target_assignment_id"] is None
    assert result["target_projections"][0]["unavailable_reasons"][0]["code"] == "FINALIZED_PERIOD_GRADE"

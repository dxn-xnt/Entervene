"""Evidence and historical-cutoff contract for candidate diagnosis."""

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.Competency import Competency
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.Lesson import Lesson
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.intervention.Intervention import Intervention
from app.models.people.Student import Student
from app.models.quiz.Question import Question
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from app.schemas.ActivityCoverage import ActivityCoverageUpdate
from app.services.activity.ActivityCoverageService import replace_manual_activity_coverage
from tests.test_current_period_live_feature_builder import add_activity, build_current, current_period_context
from tests.test_development_current_term_model_4l import _register_corrected
from tests.test_development_current_term_prediction_persistence import _run
from tests.test_development_current_term_prediction_service import _set_weights
from tests.test_intervention_candidate_sync import _enable


def _ready_activities(ctx):
    return [
        add_activity(ctx, "WRITTEN_WORK", 8, 10, title="WW one"),
        add_activity(ctx, "WRITTEN_WORK", 7, 10, title="WW two"),
        add_activity(ctx, "PERFORMANCE_TASK", 18, 20, title="PT one"),
        add_activity(ctx, "PERFORMANCE_TASK", 17, 20, title="PT two"),
    ]


def _prepare(ctx, monkeypatch):
    _enable(monkeypatch)
    _set_weights(ctx)
    assignments = _ready_activities(ctx)
    model = _register_corrected(ctx)
    monkeypatch.setattr(scorer, "score_development_current_term", lambda _features, model_name=None: 84)
    return model, assignments


def _diagnosis(ctx):
    ctx["db"].expire_all()
    return ctx["db"].query(Intervention).one().diagnosis_snapshot


def _link_competency(ctx, assignment, *, statement="Interpret data"):
    competency = Competency(statement=statement, subject_id=ctx["subject"].subject_id)
    ctx["db"].add(competency)
    ctx["db"].flush()
    lesson = Lesson(title="Data interpretation", subject_id=ctx["subject"].subject_id, competency_id=competency.competency_id)
    ctx["db"].add(lesson)
    ctx["db"].flush()
    ctx["db"].add(ClassworkLesson(classwork_id=assignment.classwork_id, lesson_id=lesson.lesson_id))
    ctx["db"].commit()
    return competency, lesson


def _manual_coverage(ctx, assignment, competency, *, valid_from, valid_until=None, lesson=None):
    assignment.classwork.activity_mode = "MANUAL"
    assignment.classwork.classwork_type = "ACTIVITY"
    row = ClassworkCoverage(
        classwork_id=assignment.classwork_id,
        lesson_id=lesson.lesson_id if lesson is not None else None,
        competency_id=competency.competency_id,
        valid_from=valid_from,
        valid_until=valid_until,
        linked_by_staff_id=ctx["staff"].staff_id,
    )
    ctx["db"].add(row)
    ctx["db"].commit()
    return row


def test_weakest_component_and_missing_exam_are_distinguished(current_period_context, monkeypatch):
    ctx = current_period_context
    model, _ = _prepare(ctx, monkeypatch)
    _run(ctx, model.model_version_id)
    result = _diagnosis(ctx)
    assert result["weakest_supported_components"] == ["WRITTEN_WORK"]
    assert result["components"]["WRITTEN_WORK"]["percent"] == 75
    assert result["components"]["PERFORMANCE_TASK"]["percent"] == 87.5
    assert result["components"]["EXAMINATION"] == {
        "evidence_state": "UNAVAILABLE", "percent": None, "model_observation_count": 0,
    }


def test_linked_activity_supports_competency_but_unlinked_score_does_not(current_period_context, monkeypatch):
    ctx = current_period_context
    model, assignments = _prepare(ctx, monkeypatch)
    competency, lesson = _link_competency(ctx, assignments[0])
    _run(ctx, model.model_version_id)
    result = _diagnosis(ctx)
    assert len(result["lowest_supported_competencies"]) == 1
    item = result["lowest_supported_competencies"][0]
    assert item["competency_id"] == competency.competency_id
    assert item["percent"] == 80
    assert item["supporting_scores"][0]["classwork_id"] == assignments[0].classwork_id
    assert item["supporting_scores"][0]["lesson_id"] == lesson.lesson_id
    assert (item["score"], item["possible_score"]) == (8, 10)
    assert len(result["supporting_activities"]) == 4


def test_total_score_without_link_never_invents_competency(current_period_context, monkeypatch):
    ctx = current_period_context
    model, _ = _prepare(ctx, monkeypatch)
    _run(ctx, model.model_version_id)
    result = _diagnosis(ctx)
    assert result["lowest_supported_competencies"] == []
    assert result["competency_detail_status"] == "UNAVAILABLE_NO_TRACEABLE_SCORES"
    assert result["external_assessment_detail_status"] == "UNAVAILABLE_NO_COMPETENCY_LINK"


def test_quiz_question_score_can_support_its_linked_competency(current_period_context, monkeypatch):
    ctx = current_period_context
    model, assignments = _prepare(ctx, monkeypatch)
    competency = Competency(statement="Read a graph", subject_id=ctx["subject"].subject_id)
    ctx["db"].add(competency)
    ctx["db"].flush()
    lesson = Lesson(title="Graphs", subject_id=ctx["subject"].subject_id, competency_id=competency.competency_id)
    quiz = Quiz(classwork_id=assignments[0].classwork_id, total_items=1, status="PUBLISHED")
    ctx["db"].add_all([lesson, quiz])
    ctx["db"].flush()
    question = Question(question_text="Read this graph", question_type="MULTIPLE_CHOICE", points=Decimal("5"), lesson_id=lesson.lesson_id)
    ctx["db"].add(question)
    ctx["db"].flush()
    link = QuizQuestion(quiz_id=quiz.quiz_id, question_id=question.question_id, display_order=1)
    ctx["db"].add(link)
    ctx["db"].flush()
    submission = ctx["db"].query(StudentSubmission).filter_by(
        classwork_assignment_id=assignments[0].classwork_assignment_id,
        student_id=ctx["student"].student_id,
    ).one()
    ctx["db"].add(QuizAnswer(quiz_question_id=link.quiz_question_id, submission_id=submission.submission_id, points_awarded=Decimal("2")))
    ctx["db"].commit()
    covered = Competency(statement="Covered by an external assessment", subject_id=ctx["subject"].subject_id)
    ctx["db"].add(covered)
    ctx["db"].commit()
    _manual_coverage(ctx, assignments[1], covered, valid_from=datetime.now(timezone.utc) - timedelta(hours=1))
    _run(ctx, model.model_version_id)
    diagnosis = _diagnosis(ctx)
    item = diagnosis["lowest_supported_competencies"][0]
    assert item["competency_id"] == competency.competency_id
    assert (item["score"], item["possible_score"], item["percent"]) == (2, 5, 40)
    assert item["supporting_scores"][0]["source_type"] == "QUIZ_QUESTION"
    assert covered.competency_id not in {item["competency_id"] for item in diagnosis["lowest_supported_competencies"]}
    assert diagnosis["covered_competencies_for_teacher_review"][0]["competency_id"] == covered.competency_id


@pytest.mark.parametrize("start_hours,end_hours,included", [
    (-2, None, True),
    (0, None, True),
    (1, None, False),
    (-2, 1, True),
    (-2, 0, False),
    (-2, -1, False),
])
def test_manual_coverage_respects_half_open_prediction_cutoff(
    current_period_context, monkeypatch, start_hours, end_hours, included,
):
    ctx = current_period_context
    model, assignments = _prepare(ctx, monkeypatch)
    competency = Competency(statement="Read evidence", subject_id=ctx["subject"].subject_id)
    ctx["db"].add(competency)
    ctx["db"].commit()
    cutoff = datetime.now(timezone.utc) + timedelta(seconds=2)
    row = _manual_coverage(
        ctx, assignments[0], competency,
        valid_from=cutoff + timedelta(hours=start_hours),
        valid_until=cutoff + timedelta(hours=end_hours) if end_hours is not None else None,
    )
    _run(ctx, model.model_version_id, cutoff_at=cutoff)
    diagnosis = _diagnosis(ctx)
    assert bool(diagnosis["manual_assessment_coverage"]) is included
    assert diagnosis["lowest_supported_competencies"] == []
    if included:
        evidence = diagnosis["manual_assessment_coverage"][0]
        assert evidence["coverage_links"][0]["coverage_id"] == row.coverage_id
        assert evidence["evidence_cutoff_at"] == cutoff.isoformat()
        assert evidence["score_scope"] == "ASSESSMENT_TOTAL_ONLY"
        assert evidence["score"] == 8 and evidence["possible_score"] == 10
        assert evidence["covered_competencies"][0]["competency_id"] == competency.competency_id


def test_one_manual_total_covers_many_unranked_competencies_and_a_lesson(current_period_context, monkeypatch):
    ctx = current_period_context
    model, assignments = _prepare(ctx, monkeypatch)
    first, lesson = _link_competency(ctx, assignments[0])
    second = Competency(statement="Interpret a graph", subject_id=ctx["subject"].subject_id)
    later = Competency(statement="Later lesson tag", subject_id=ctx["subject"].subject_id)
    ctx["db"].add_all([second, later])
    ctx["db"].commit()
    from_time = datetime.now(timezone.utc) - timedelta(hours=1)
    _manual_coverage(ctx, assignments[0], first, lesson=lesson, valid_from=from_time)
    _manual_coverage(ctx, assignments[0], second, valid_from=from_time)
    lesson.competency_id = later.competency_id
    ctx["db"].commit()
    _run(ctx, model.model_version_id)
    result = _diagnosis(ctx)
    assert result["snapshot_version"] == "INTERVENTION_DIAGNOSIS_V2"
    assert result["external_assessment_detail_status"] == "AVAILABLE_ASSESSMENT_LEVEL_COVERAGE"
    assessment = result["manual_assessment_coverage"][0]
    assert assessment["classwork_id"] == assignments[0].classwork_id
    assert assessment["component"] == "WRITTEN_WORK"
    assert assessment["percent"] == 80
    assert assessment["covered_lessons"] == [{"lesson_id": lesson.lesson_id, "title": lesson.title}]
    assert {item["competency_id"] for item in assessment["covered_competencies"]} == {
        first.competency_id, second.competency_id,
    }
    assert all(link["provenance"] == "TEACHER_ASSERTED_ASSESSMENT_COVERAGE" for link in assessment["coverage_links"])
    assert result["lowest_supported_competencies"] == []
    review = result["covered_competencies_for_teacher_review"]
    assert {item["competency_id"] for item in review} == {first.competency_id, second.competency_id}
    assert all(item["ranking_status"] == "UNRANKED_SHARED_ASSESSMENT_SCORE" for item in review)
    assert all("score" not in item and "percent" not in item for item in review)


def test_multi_lesson_activity_total_is_not_split_into_competencies(current_period_context, monkeypatch):
    ctx = current_period_context
    model, assignments = _prepare(ctx, monkeypatch)
    _link_competency(ctx, assignments[0], statement="First topic")
    _link_competency(ctx, assignments[0], statement="Second topic")
    _run(ctx, model.model_version_id)
    assert _diagnosis(ctx)["lowest_supported_competencies"] == []


def test_activity_after_prediction_cutoff_is_excluded(current_period_context, monkeypatch):
    ctx = current_period_context
    model, _ = _prepare(ctx, monkeypatch)
    cutoff = datetime.now(timezone.utc)
    future = add_activity(ctx, "WRITTEN_WORK", 0, 10, title="Future work", graded_at=cutoff + timedelta(days=1))
    _run(ctx, model.model_version_id, cutoff_at=cutoff)
    result = _diagnosis(ctx)
    assert future.classwork_id not in {item["classwork_id"] for item in result["supporting_activities"]}
    assert result["components"]["WRITTEN_WORK"]["percent"] == 75


def test_unrelated_student_class_subject_and_period_scores_are_excluded(current_period_context, monkeypatch):
    ctx = current_period_context
    model, _ = _prepare(ctx, monkeypatch)
    original = {key: ctx[key] for key in ("student", "class", "subject")}
    other_student = Student(
        student_id=uuid4(), student_lrn="300000000099", first_name="Other", last_name="Student",
        academic_level_id=ctx["level"].academic_level_id,
    )
    other_class = Class(
        section_name="Other Section", academic_year_id=ctx["class"].academic_year_id,
        academic_level_id=ctx["level"].academic_level_id,
    )
    other_subject = Subject(
        subject_name="English", subject_codename="ENGLISH", academic_level_id=ctx["level"].academic_level_id,
    )
    ctx["db"].add_all([other_student, other_class, other_subject])
    ctx["db"].commit()
    unrelated_ids = []
    for key, replacement in (("student", other_student), ("class", other_class), ("subject", other_subject)):
        ctx[key] = replacement
        unrelated_ids.append(add_activity(ctx, "WRITTEN_WORK", 0, 10, title=f"Other {key}").classwork_id)
        ctx[key] = original[key]
    unrelated_ids.append(add_activity(ctx, "WRITTEN_WORK", 0, 10, period=ctx["next_period"], title="Other period").classwork_id)
    local_competency = Competency(statement="Local topic", subject_id=original["subject"].subject_id)
    foreign_competency = Competency(statement="English topic", subject_id=other_subject.subject_id)
    ctx["db"].add_all([local_competency, foreign_competency])
    ctx["db"].commit()
    for classwork_id in unrelated_ids:
        assignment = ctx["db"].query(ClassworkAssignment).filter_by(classwork_id=classwork_id).one()
        comp = foreign_competency if assignment.classwork.subject_id == other_subject.subject_id else local_competency
        _manual_coverage(ctx, assignment, comp, valid_from=datetime.now(timezone.utc) - timedelta(hours=1))
    _run(ctx, model.model_version_id)
    diagnosis = _diagnosis(ctx)
    ids = {item["classwork_id"] for item in diagnosis["supporting_activities"]}
    assert ids.isdisjoint(unrelated_ids)
    assert len(ids) == 4
    assert diagnosis["manual_assessment_coverage"] == []


def test_two_subject_diagnoses_remain_isolated(current_period_context, monkeypatch):
    ctx = current_period_context
    model, _ = _prepare(ctx, monkeypatch)
    first_subject_id = ctx["subject"].subject_id
    _run(ctx, model.model_version_id)
    subject = Subject(subject_name="English", subject_codename="ENGLISH", academic_level_id=ctx["level"].academic_level_id)
    ctx["db"].add(subject)
    ctx["db"].flush()
    template = GradingTemplate(
        template_name="English 20-50-30", academic_level_id=ctx["level"].academic_level_id,
        subject_id=subject.subject_id, status="active",
    )
    ctx["db"].add(template)
    ctx["db"].flush()
    ctx["db"].add_all([
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name=name, weight=Decimal(weight), display_order=order)
        for order, (name, weight) in enumerate((
            ("Written Works", "20"), ("Performance Tasks", "50"), ("Quarterly Assessment", "30"),
        ), start=1)
    ])
    subject.default_grading_template = str(template.grading_template_id)
    ctx["db"].commit()
    ctx["subject"] = subject
    second_ids = {assignment.classwork_id for assignment in _ready_activities(ctx)}
    _run(ctx, model.model_version_id)
    rows = ctx["db"].query(Intervention).order_by(Intervention.intervention_id).all()
    assert {row.subject_id for row in rows} == {first_subject_id, subject.subject_id}
    assert {item["classwork_id"] for item in rows[1].diagnosis_snapshot["supporting_activities"]} == second_ids
    assert {item["classwork_id"] for item in rows[0].diagnosis_snapshot["supporting_activities"]}.isdisjoint(second_ids)


def test_snapshot_does_not_change_after_grade_or_lesson_edit(current_period_context, monkeypatch):
    ctx = current_period_context
    model, assignments = _prepare(ctx, monkeypatch)
    _, lesson = _link_competency(ctx, assignments[0])
    _run(ctx, model.model_version_id)
    frozen = deepcopy(_diagnosis(ctx))
    submission = ctx["db"].query(StudentSubmission).filter_by(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=assignments[0].classwork_assignment_id,
    ).one()
    submission.grade = Decimal("0")
    lesson.title = "Renamed later"
    ctx["db"].commit()
    assert _diagnosis(ctx) == frozen


def test_manual_coverage_and_grades_are_frozen_in_candidate_snapshot(current_period_context, monkeypatch):
    ctx = current_period_context
    model, assignments = _prepare(ctx, monkeypatch)
    ctx["db"].add(SubjectLoad(
        staff_id=ctx["staff"].staff_id, subject_id=ctx["subject"].subject_id,
        class_id=ctx["class"].class_id, academic_period_id=ctx["period"].academic_period_id,
        status="published", is_active_version=True,
    ))
    first = Competency(statement="First topic", subject_id=ctx["subject"].subject_id)
    second = Competency(statement="New topic", subject_id=ctx["subject"].subject_id)
    ctx["db"].add_all([first, second])
    ctx["db"].commit()
    features_before = build_current(ctx)["features"]
    _manual_coverage(ctx, assignments[0], first, valid_from=datetime.now(timezone.utc) - timedelta(hours=1))
    assert build_current(ctx)["features"] == features_before
    _run(ctx, model.model_version_id)
    frozen = deepcopy(_diagnosis(ctx))
    assert frozen["manual_assessment_coverage"][0]["covered_competencies"][0]["competency_id"] == first.competency_id
    replace_manual_activity_coverage(
        ctx["db"], ctx["staff"].staff_id, assignments[0].classwork_id, ctx["class"].class_id,
        ActivityCoverageUpdate(competency_ids=[second.competency_id]),
    )
    submission = ctx["db"].query(StudentSubmission).filter_by(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=assignments[0].classwork_assignment_id,
    ).one()
    submission.grade = Decimal("0")
    ctx["db"].commit()
    assert _diagnosis(ctx) == frozen

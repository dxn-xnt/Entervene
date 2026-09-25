from __future__ import annotations

from uuid import uuid4

import pytest

from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Activity import BulkScoreItem, BulkScoreUpdateRequest
from app.schemas.Submission import GradeRequest
from app.services.activity import ActivityService as activity
from app.services.submission import SubmissionService as submissions
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction import DevelopmentGradeRefreshService as refresh_service
from app.services.prediction.DevelopmentGradeRefreshService import settings
from tests.test_current_period_live_feature_builder import add_activity, current_period_context
from tests.test_development_current_term_model_4l import _register_corrected
from tests.test_development_current_term_prediction_persistence import _run
from tests.test_development_current_term_prediction_service import _make_ready, _set_weights


def _enable(monkeypatch):
    monkeypatch.setattr(settings, "app_environment", "test")
    monkeypatch.setattr(settings, "development_prediction_api_enabled", True)
    monkeypatch.setattr(settings, "development_current_term_model_name", CORRECTED_MODEL_NAME)


def _save_score(ctx, monkeypatch, assignment, score, student_id=None):
    db = ctx["db"]
    student_id = student_id or ctx["student"].student_id
    monkeypatch.setattr(activity, "_resolve_activity_and_assignment", lambda *_args: (assignment.classwork, assignment))
    monkeypatch.setattr(activity, "get_activity_scores", lambda *_args: None)
    return activity.bulk_update_activity_scores(
        db,
        ctx["staff"].staff_id,
        assignment.classwork_id,
        BulkScoreUpdateRequest(class_id=ctx["class"].class_id, scores=[BulkScoreItem(student_id=student_id, score=score)]),
    )


def _rows(ctx, model_version_id):
    return ctx["db"].query(DevelopmentCurrentTermPrediction).filter_by(
        student_id=ctx["student"].student_id,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        source_period_id=ctx["period"].academic_period_id,
        model_version_id=model_version_id,
    ).order_by(DevelopmentCurrentTermPrediction.revision).all()


def test_committed_term_exam_refreshes_only_changed_evidence_and_preserves_history(current_period_context, monkeypatch):
    ctx = current_period_context
    _enable(monkeypatch)
    _set_weights(ctx)
    _make_ready(ctx)
    add_activity(ctx, "EXAMS", 27, 30, title="Summative 1", classwork_type="EXAM", exam_subtype="SUMMATIVE_1")
    add_activity(ctx, "EXAMS", 21, 30, title="Summative 2", classwork_type="EXAM", exam_subtype="SUMMATIVE_2")
    term = add_activity(ctx, "EXAMS", None, 40, title="Term Exam", classwork_type="EXAM", exam_subtype="TERM_EXAM")
    model = _register_corrected(ctx)
    first = _run(ctx, model.model_version_id)
    old_snapshot = dict(_rows(ctx, model.model_version_id)[0].evidence_snapshot)
    assert old_snapshot["examination_presentation"]["status"] == "PARTIAL"

    _save_score(ctx, monkeypatch, term, 32)
    rows = _rows(ctx, model.model_version_id)
    assert [row.revision for row in rows] == [1, 2]
    assert rows[0].evidence_snapshot == old_snapshot
    new_snapshot = rows[1].evidence_snapshot
    assert new_snapshot["examination_presentation"] == {
        "status": "COMPLETE",
        "completed_count": 3,
        "components": {"SUMMATIVE_1": 90.0, "SUMMATIVE_2": 70.0, "TERM_EXAM": 80.0},
    }
    features = {item["name"]: item["value"] for item in new_snapshot["model_features"]}
    assert len(features) == 31
    assert features["qa_has_evidence"] == 1
    assert features["qa_percent_so_far"] == 80
    assert rows[1].prediction_id != first["prediction_id"]

    _save_score(ctx, monkeypatch, term, 32)
    assert [row.revision for row in _rows(ctx, model.model_version_id)] == [1, 2]

    _save_score(ctx, monkeypatch, term, None)
    rows = _rows(ctx, model.model_version_id)
    assert [row.revision for row in rows] == [1, 2, 3]
    assert rows[2].evidence_snapshot["examination_presentation"]["status"] == "PARTIAL"
    assert rows[1].evidence_snapshot == new_snapshot


@pytest.mark.parametrize("category,subtype", [
    ("WRITTEN_WORK", None),
    ("PERFORMANCE_TASK", None),
    ("EXAMS", "SUMMATIVE_1"),
    ("EXAMS", "SUMMATIVE_2"),
    ("EXAMS", "TERM_EXAM"),
])
def test_each_relevant_grade_type_triggers_only_after_commit(current_period_context, monkeypatch, category, subtype):
    ctx = current_period_context
    assignment = add_activity(ctx, category, None, 40, exam_subtype=subtype)
    calls = []
    monkeypatch.setattr(activity, "refresh_after_committed_grade_change", lambda _bind, **kwargs: calls.append(kwargs))
    _save_score(ctx, monkeypatch, assignment, 20)
    assert calls == [{
        "student_ids": {ctx["student"].student_id},
        "class_id": ctx["class"].class_id,
        "subject_id": ctx["subject"].subject_id,
        "period_id": ctx["period"].academic_period_id,
    }]
    _save_score(ctx, monkeypatch, assignment, 20)
    assert calls[-1]["student_ids"] == set()


def test_insufficient_and_unrelated_student_do_not_create_prediction(current_period_context, monkeypatch):
    ctx = current_period_context
    _enable(monkeypatch)
    _set_weights(ctx)
    model = _register_corrected(ctx)
    assignment = add_activity(ctx, "WRITTEN_WORK", None, 40)
    _save_score(ctx, monkeypatch, assignment, 20)
    assert _rows(ctx, model.model_version_id) == []

    _make_ready(ctx)
    first = _run(ctx, model.model_version_id)
    other = Student(
        student_id=uuid4(), student_lrn="300000000002", first_name="Other",
        last_name="Learner", academic_level_id=ctx["level"].academic_level_id,
    )
    ctx["db"].add(other)
    ctx["db"].commit()
    _save_score(ctx, monkeypatch, assignment, 21, student_id=other.student_id)
    assert [row.prediction_id for row in _rows(ctx, model.model_version_id)] == [first["prediction_id"]]


def test_failed_grade_commit_never_refreshes(current_period_context, monkeypatch):
    ctx = current_period_context
    assignment = add_activity(ctx, "WRITTEN_WORK", None, 40)
    calls = []
    monkeypatch.setattr(activity, "refresh_after_committed_grade_change", lambda *_args, **_kwargs: calls.append(True))

    def fail_commit():
        raise RuntimeError("failed grade transaction")

    monkeypatch.setattr(ctx["db"], "commit", fail_commit)
    with pytest.raises(RuntimeError, match="failed grade transaction"):
        _save_score(ctx, monkeypatch, assignment, 20)
    assert calls == []
    ctx["db"].rollback()


def test_individual_grade_edit_refreshes_only_on_numeric_change(current_period_context, monkeypatch):
    ctx = current_period_context
    assignment = add_activity(ctx, "WRITTEN_WORK", 10, 40)
    submission = ctx["db"].query(StudentSubmission).filter_by(
        student_id=ctx["student"].student_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
    ).one()
    monkeypatch.setattr(submissions, "teacher_owns_assignment", lambda *_args, **_kwargs: assignment)
    monkeypatch.setattr(submissions, "build_submission_response", lambda *_args: None)
    calls = []
    monkeypatch.setattr(submissions, "refresh_after_committed_grade_change", lambda _bind, **kwargs: calls.append(kwargs))
    submissions.grade_student_submission(submission.submission_id, GradeRequest(grade=20), ctx["staff"].staff_id, ctx["db"])
    assert calls[0]["student_ids"] == [ctx["student"].student_id]
    assert calls[0]["class_id"] == ctx["class"].class_id
    submissions.grade_student_submission(submission.submission_id, GradeRequest(grade=20), ctx["staff"].staff_id, ctx["db"])
    assert len(calls) == 1


def test_production_configuration_never_starts_refresh(monkeypatch):
    monkeypatch.setattr(settings, "app_environment", "production")
    monkeypatch.setattr(settings, "development_prediction_api_enabled", True)
    monkeypatch.setattr(settings, "development_current_term_model_name", CORRECTED_MODEL_NAME)
    monkeypatch.setattr(refresh_service, "Session", lambda _bind: pytest.fail("Registry lookup should not run"))
    refresh_service.refresh_after_committed_grade_change(
        object(), student_ids=[uuid4()], class_id=1, subject_id=1, period_id=1,
    )

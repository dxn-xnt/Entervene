"""External manual-score coverage is dated and never changes grading inputs."""

from datetime import datetime, timezone
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import pytest
from alembic.operations import Operations
from alembic.runtime.migration import MigrationContext
from fastapi import HTTPException
from sqlalchemy import create_engine, inspect
from sqlalchemy.exc import IntegrityError

from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.api.v1.routes.Activities import create_activity_endpoint
from app.schemas.ActivityCoverage import ActivityCoverageUpdate
from app.schemas.Activity import ActivityCreateRequest
from app.services.activity.ActivityService import create_activity
from app.services.activity.ActivityCoverageService import (
    get_manual_activity_coverage,
    replace_manual_activity_coverage,
)
from app.services.intervention.InterventionDiagnosisService import _single_lesson_attribution
from tests.test_current_period_live_feature_builder import add_activity, build_current, current_period_context


@pytest.fixture
def manual_context(current_period_context):
    ctx = current_period_context
    db = ctx["db"]
    db.add(SubjectLoad(
        staff_id=ctx["staff"].staff_id, subject_id=ctx["subject"].subject_id,
        class_id=ctx["class"].class_id, academic_period_id=ctx["period"].academic_period_id,
        status="published", is_active_version=True,
    ))
    db.commit()
    assignment = add_activity(ctx, "PERFORMANCE_TASK", 8, 10)
    assignment.classwork.activity_mode = "MANUAL"
    db.commit()
    ctx["assignment"] = assignment
    return ctx


def _lesson(ctx, *, subject_id=None, competency=None):
    db = ctx["db"]
    subject_id = subject_id or ctx["subject"].subject_id
    competency = competency or Competency(statement="Interpret data", subject_id=subject_id)
    db.add(competency)
    db.flush()
    lesson = Lesson(title="Data", subject_id=subject_id, competency_id=competency.competency_id)
    db.add(lesson)
    db.commit()
    return competency, lesson


def _replace(ctx, *, lessons=(), competencies=(), staff_id=None):
    return replace_manual_activity_coverage(
        ctx["db"], staff_id or ctx["staff"].staff_id,
        ctx["assignment"].classwork_id, ctx["class"].class_id,
        ActivityCoverageUpdate(lesson_ids=list(lessons), competency_ids=list(competencies)),
    )


def test_one_and_multiple_competencies_have_dated_teacher_provenance(manual_context):
    ctx = manual_context
    first, _ = _lesson(ctx)
    second, _ = _lesson(ctx)
    one = _replace(ctx, competencies=[first.competency_id])
    assert len(one.links) == 1
    assert one.links[0].lesson_id is None
    assert one.links[0].competency_id == first.competency_id
    assert one.links[0].linked_by_staff_id == ctx["staff"].staff_id
    assert one.links[0].valid_from is not None
    assert one.links[0].valid_until is None
    two = _replace(ctx, competencies=[first.competency_id, second.competency_id])
    assert len(two.links) == 2
    assert all(link.valid_until is None for link in two.links)
    assert two.links[0].coverage_id == one.links[0].coverage_id
    assert _replace(ctx, competencies=[first.competency_id, second.competency_id]).links == two.links


def test_lesson_captures_competency_and_removal_keeps_cutoff_history(manual_context):
    ctx = manual_context
    competency, lesson = _lesson(ctx)
    before = build_current(ctx)["features"]
    linked = _replace(ctx, lessons=[lesson.lesson_id])
    row = linked.links[0]
    assert (row.lesson_id, row.competency_id) == (lesson.lesson_id, competency.competency_id)
    assert ctx["db"].query(ClassworkLesson).filter_by(classwork_id=ctx["assignment"].classwork_id).count() == 1
    assert _single_lesson_attribution(
        ctx["db"], ctx["assignment"].classwork_id, ctx["subject"].subject_id,
    ) is None
    removed = _replace(ctx)
    assert removed.links[0].valid_until is not None
    assert removed.links[0].removed_by_staff_id == ctx["staff"].staff_id
    cutoff = row.valid_from
    assert row.valid_from <= cutoff < removed.links[0].valid_until
    assert ctx["db"].query(ClassworkLesson).filter_by(classwork_id=ctx["assignment"].classwork_id).count() == 0
    relinked = _replace(ctx, lessons=[lesson.lesson_id])
    assert len(relinked.links) == 2
    assert relinked.links[0].valid_until is not None
    assert relinked.links[1].valid_until is None
    assert build_current(ctx)["features"] == before


def test_cross_subject_and_wrong_period_links_are_rejected(manual_context):
    ctx = manual_context
    db = ctx["db"]
    other = Subject(subject_name="Other", subject_codename="OTHER", academic_level_id=ctx["level"].academic_level_id)
    db.add(other)
    db.flush()
    foreign_comp, foreign_lesson = _lesson(ctx, subject_id=other.subject_id)
    for payload in ({"lessons": [foreign_lesson.lesson_id]}, {"competencies": [foreign_comp.competency_id]}):
        with pytest.raises(HTTPException) as exc:
            _replace(ctx, **payload)
        assert exc.value.status_code == 400
    wrong_period = Competency(
        statement="Later topic", subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["next_period"].academic_period_id,
    )
    db.add(wrong_period)
    db.commit()
    with pytest.raises(HTTPException) as exc:
        _replace(ctx, competencies=[wrong_period.competency_id])
    assert exc.value.status_code == 400
    assert db.query(ClassworkCoverage).count() == 0


def test_unauthorized_teacher_and_duplicate_payload_rejected(manual_context):
    ctx = manual_context
    comp, _ = _lesson(ctx)
    with pytest.raises(HTTPException) as exc:
        _replace(ctx, competencies=[comp.competency_id], staff_id="T-OTHER")
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        _replace(ctx, competencies=[comp.competency_id, comp.competency_id])
    assert exc.value.status_code == 400
    assert ctx["db"].query(ClassworkCoverage).count() == 0


def test_initial_manual_activity_links_are_validated_and_dated(manual_context):
    ctx = manual_context
    first_comp, first_lesson = _lesson(ctx)
    second_comp, second_lesson = _lesson(ctx)
    created = create_activity(ctx["db"], ctx["staff"].staff_id, ActivityCreateRequest(
        title="External exam", classwork_category="QUARTERLY_ASSESSMENT", total_points=30,
        class_id=ctx["class"].class_id, subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id, activity_mode="MANUAL",
        lesson_ids=[first_lesson.lesson_id, second_lesson.lesson_id],
    ))
    rows = get_manual_activity_coverage(ctx["db"], ctx["staff"].staff_id, created["classwork_id"], ctx["class"].class_id).links
    assert {(row.lesson_id, row.competency_id) for row in rows} == {
        (first_lesson.lesson_id, first_comp.competency_id),
        (second_lesson.lesson_id, second_comp.competency_id),
    }
    assert all(row.valid_from and row.linked_by_staff_id == ctx["staff"].staff_id for row in rows)


def test_nonmanual_activity_cannot_be_managed_as_external_coverage(manual_context):
    ctx = manual_context
    ctx["assignment"].classwork.activity_mode = "ONLINE"
    ctx["db"].commit()
    with pytest.raises(HTTPException) as exc:
        _replace(ctx)
    assert exc.value.status_code == 404


def test_existing_admin_create_path_cannot_set_manual_coverage(manual_context):
    ctx = manual_context
    _, lesson = _lesson(ctx)
    request = ActivityCreateRequest(
        title="Admin manual score", classwork_category="PERFORMANCE_TASK", total_points=10,
        class_id=ctx["class"].class_id, subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id, activity_mode="MANUAL",
        lesson_ids=[lesson.lesson_id],
    )
    with pytest.raises(HTTPException) as exc:
        create_activity_endpoint(request, {"role": "admin"}, ctx["staff"].staff_id, ctx["db"])
    assert exc.value.status_code == 403
    assert ctx["db"].query(ClassworkCoverage).count() == 0


def test_migration_indexes_constraints_and_model_match():
    engine = create_engine("sqlite://")
    path = Path(__file__).parents[1] / "migrations" / "versions" / "20260926_manual_classwork_coverage.py"
    spec = spec_from_file_location("manual_coverage_migration", path)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    assert module.down_revision == "20260926_intervention_diagnosis"
    with engine.begin() as connection:
        module.op = Operations(MigrationContext.configure(connection))
        module.upgrade()
    schema = inspect(engine)
    columns = {column["name"] for column in schema.get_columns("classwork_coverage")}
    assert columns == set(ClassworkCoverage.__table__.columns.keys())
    indexes = {index["name"]: index for index in schema.get_indexes("classwork_coverage")}
    assert indexes["uq_classwork_coverage_active_lesson"]["unique"]
    assert indexes["uq_classwork_coverage_active_competency"]["unique"]
    assert {fk["referred_table"] for fk in schema.get_foreign_keys("classwork_coverage")} == {
        "classwork", "lesson", "competency", "academic_staff",
    }
    table = ClassworkCoverage.__table__
    now = datetime.now(timezone.utc)
    with engine.begin() as connection:
        connection.execute(table.insert().values(classwork_id=1, competency_id=1, valid_from=now))
    with pytest.raises(IntegrityError):
        with engine.begin() as connection:
            connection.execute(table.insert().values(classwork_id=1, competency_id=1, valid_from=now))
    with engine.begin() as connection:
        connection.execute(table.update().values(valid_until=now))
        connection.execute(table.insert().values(classwork_id=1, competency_id=1, valid_from=now))
    engine.dispose()

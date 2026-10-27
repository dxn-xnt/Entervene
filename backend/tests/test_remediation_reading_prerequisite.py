"""Persistence-only coverage for immutable remediation Reading snapshots."""

import importlib
from decimal import Decimal
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import HTTPException
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError

from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationReadingPrerequisite import (
    RemediationReadingPrerequisite,
)
from app.services.intervention.RemediationReadingPrerequisiteService import (
    ReadingPrerequisiteSnapshotItem,
    remediation_reading_prerequisites,
    resolve_reading_prerequisite_snapshot_items,
    stage_remediation_reading_prerequisites,
)
from app.services.intervention.TeacherInterventionService import activate_teacher_candidate
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_teacher_intervention_review import candidate_context, _id, _staff


def _reading(ctx, title: str):
    work = Classwork(
        title=title,
        classwork_type="READING",
        is_graded=False,
        total_points=None,
        is_published=True,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=_staff(ctx),
    )
    ctx["db"].add(work)
    ctx["db"].flush()
    assignment = ClassworkAssignment(
        classwork_id=work.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=_staff(ctx),
        is_published=True,
    )
    ctx["db"].add(assignment)
    ctx["db"].flush()
    return work, assignment


def _remediation(ctx, title: str):
    work = Classwork(
        title=title,
        classwork_type="QUIZ",
        is_graded=True,
        total_points=Decimal("10"),
        is_published=False,
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=_staff(ctx),
    )
    ctx["db"].add(work)
    ctx["db"].flush()
    assignment = ClassworkAssignment(
        classwork_id=work.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=_staff(ctx),
        recipient_student_id=ctx["student"].student_id,
        source_intervention_id=_id(ctx),
        remediation_request_id=uuid4(),
        is_published=False,
    )
    ctx["db"].add(assignment)
    ctx["db"].flush()
    return assignment


def _item(reading, order):
    work, assignment = reading
    return ReadingPrerequisiteSnapshotItem(
        reading_classwork_id=work.classwork_id,
        reading_assignment_id=assignment.classwork_assignment_id,
        display_order=order,
    )


def test_snapshots_are_ordered_immutable_and_independent_per_activity(candidate_context):
    ctx = candidate_context
    activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    first_reading = _reading(ctx, "First foundations")
    second_reading = _reading(ctx, "Second foundations")
    first_activity = _remediation(ctx, "First remediation")
    second_activity = _remediation(ctx, "Second remediation")
    historical_activity = _remediation(ctx, "Legacy remediation without snapshot")

    first = stage_remediation_reading_prerequisites(
        ctx["db"],
        remediation_assignment_id=first_activity.classwork_assignment_id,
        items=[_item(first_reading, 1), _item(second_reading, 2)],
    )
    second = stage_remediation_reading_prerequisites(
        ctx["db"],
        remediation_assignment_id=second_activity.classwork_assignment_id,
        items=[_item(second_reading, 1)],
    )
    ctx["db"].commit()

    assert [row.reading_assignment_id for row in first] == [
        first_reading[1].classwork_assignment_id,
        second_reading[1].classwork_assignment_id,
    ]
    assert [row.reading_assignment_id for row in second] == [
        second_reading[1].classwork_assignment_id,
    ]
    assert remediation_reading_prerequisites(
        ctx["db"], historical_activity.classwork_assignment_id,
    ) == []

    retried = stage_remediation_reading_prerequisites(
        ctx["db"],
        remediation_assignment_id=first_activity.classwork_assignment_id,
        items=[_item(first_reading, 1), _item(second_reading, 2)],
    )
    assert [row.prerequisite_id for row in retried] == [row.prerequisite_id for row in first]
    with pytest.raises(HTTPException) as immutable:
        stage_remediation_reading_prerequisites(
            ctx["db"],
            remediation_assignment_id=first_activity.classwork_assignment_id,
            items=[_item(second_reading, 1)],
        )
    assert immutable.value.status_code == 409


def test_snapshot_service_rejects_invalid_identity_order_and_ordinary_assignment(candidate_context):
    ctx = candidate_context
    activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    reading = _reading(ctx, "Valid Reading")
    activity = _remediation(ctx, "Targeted remediation")
    ordinary_work = Classwork(
        title="Ordinary quiz", classwork_type="QUIZ", is_graded=True,
        total_points=Decimal("10"), is_published=False,
        subject_id=ctx["subject"].subject_id, created_by_staff_id=_staff(ctx),
    )
    ctx["db"].add(ordinary_work)
    ctx["db"].flush()
    ordinary = ClassworkAssignment(
        classwork_id=ordinary_work.classwork_id, class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=_staff(ctx), is_published=False,
    )
    ctx["db"].add(ordinary)
    ctx["db"].flush()

    with pytest.raises(HTTPException) as empty:
        stage_remediation_reading_prerequisites(
            ctx["db"], remediation_assignment_id=activity.classwork_assignment_id, items=[],
        )
    assert empty.value.status_code == 400
    with pytest.raises(HTTPException) as order:
        stage_remediation_reading_prerequisites(
            ctx["db"], remediation_assignment_id=activity.classwork_assignment_id,
            items=[_item(reading, 2)],
        )
    assert order.value.status_code == 400
    with pytest.raises(HTTPException) as mismatch:
        stage_remediation_reading_prerequisites(
            ctx["db"], remediation_assignment_id=activity.classwork_assignment_id,
            items=[ReadingPrerequisiteSnapshotItem(
                reading_classwork_id=ordinary_work.classwork_id,
                reading_assignment_id=reading[1].classwork_assignment_id,
                display_order=1,
            )],
        )
    assert mismatch.value.status_code == 400
    with pytest.raises(HTTPException) as not_targeted:
        stage_remediation_reading_prerequisites(
            ctx["db"], remediation_assignment_id=ordinary.classwork_assignment_id,
            items=[_item(reading, 1)],
        )
    assert not_targeted.value.status_code == 400


def test_model_declares_required_constraints_and_indexes():
    table = RemediationReadingPrerequisite.__table__
    assert set(table.columns.keys()) == {
        "prerequisite_id", "remediation_assignment_id", "reading_classwork_id",
        "reading_assignment_id", "display_order", "created_at",
    }
    names = {constraint.name for constraint in table.constraints if constraint.name}
    assert {
        "uq_remediation_reading_prerequisite_order",
        "uq_remediation_reading_prerequisite_reading",
        "ck_remediation_reading_prerequisite_order_positive",
    } <= names
    assert {
        "ix_remediation_reading_prerequisite_remediation",
        "ix_remediation_reading_prerequisite_reading_assignment",
    } == {index.name for index in table.indexes}
    assert table.c.created_at.nullable is False
    assert table.c.created_at.server_default is not None


def test_migration_upgrade_and_downgrade_on_disposable_sqlite(tmp_path):
    database = tmp_path / "reading-prerequisite-migration.sqlite"
    engine = create_engine(f"sqlite:///{database}")
    migration = importlib.import_module(
        "migrations.versions.20261027_remediation_reading_prerequisite"
    )
    try:
        with engine.begin() as connection:
            connection.execute(text("PRAGMA foreign_keys=ON"))
            connection.execute(text(
                "CREATE TABLE classwork (classwork_id INTEGER PRIMARY KEY)"
            ))
            connection.execute(text(
                "CREATE TABLE classwork_assignment ("
                "classwork_assignment_id INTEGER PRIMARY KEY, "
                "classwork_id INTEGER NOT NULL REFERENCES classwork(classwork_id))"
            ))
            migration.op = Operations(MigrationContext.configure(connection))
            migration.upgrade()

        inspector = inspect(engine)
        assert "remediation_reading_prerequisite" in inspector.get_table_names()
        assert {
            "uq_remediation_reading_prerequisite_order",
            "uq_remediation_reading_prerequisite_reading",
        } <= {
            item["name"]
            for item in inspector.get_unique_constraints("remediation_reading_prerequisite")
        }
        assert "ck_remediation_reading_prerequisite_order_positive" in {
            item["name"]
            for item in inspector.get_check_constraints("remediation_reading_prerequisite")
        }
        assert {
            "ix_remediation_reading_prerequisite_remediation",
            "ix_remediation_reading_prerequisite_reading_assignment",
        } <= {
            item["name"]
            for item in inspector.get_indexes("remediation_reading_prerequisite")
        }

        with engine.begin() as connection:
            connection.execute(text("PRAGMA foreign_keys=ON"))
            connection.execute(text(
                "INSERT INTO classwork (classwork_id) VALUES (1), (2), (3)"
            ))
            connection.execute(text(
                "INSERT INTO classwork_assignment (classwork_assignment_id, classwork_id) "
                "VALUES (10, 1), (20, 2), (30, 3)"
            ))
            connection.execute(text(
                "INSERT INTO remediation_reading_prerequisite "
                "(remediation_assignment_id, reading_classwork_id, reading_assignment_id, display_order) "
                "VALUES (10, 2, 20, 1)"
            ))
        with pytest.raises(IntegrityError):
            with engine.begin() as connection:
                connection.execute(text(
                    "INSERT INTO remediation_reading_prerequisite "
                    "(remediation_assignment_id, reading_classwork_id, reading_assignment_id, display_order) "
                    "VALUES (10, 3, 30, 1)"
                ))
        with pytest.raises(IntegrityError):
            with engine.begin() as connection:
                connection.execute(text(
                    "INSERT INTO remediation_reading_prerequisite "
                    "(remediation_assignment_id, reading_classwork_id, reading_assignment_id, display_order) "
                    "VALUES (10, 2, 20, 2)"
                ))
        with pytest.raises(IntegrityError):
            with engine.begin() as connection:
                connection.execute(text(
                    "INSERT INTO remediation_reading_prerequisite "
                    "(remediation_assignment_id, reading_classwork_id, reading_assignment_id, display_order) "
                    "VALUES (30, 2, 20, 0)"
                ))
        with pytest.raises(IntegrityError):
            with engine.begin() as connection:
                connection.execute(text("PRAGMA foreign_keys=ON"))
                connection.execute(text(
                    "INSERT INTO remediation_reading_prerequisite "
                    "(remediation_assignment_id, reading_classwork_id, reading_assignment_id, display_order) "
                    "VALUES (999, 2, 20, 1)"
                ))

        with engine.begin() as connection:
            migration.op = Operations(MigrationContext.configure(connection))
            migration.downgrade()
        assert "remediation_reading_prerequisite" not in inspect(engine).get_table_names()
        assert {"classwork", "classwork_assignment"} <= set(inspect(engine).get_table_names())
    finally:
        engine.dispose()


def test_resolve_reading_prerequisites_success_and_preserves_order(candidate_context):
    ctx = candidate_context
    activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    r1 = _reading(ctx, "First foundations")
    r2 = _reading(ctx, "Second foundations")
    r3 = _reading(ctx, "Third foundations")
    activity = _remediation(ctx, "Targeted remediation")
    intervention = ctx["candidate"]
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "selected_resources": [
            {"kind": "CLASSWORK", "id": r3[0].classwork_id},
            {"kind": "CLASSWORK", "id": r1[0].classwork_id},
            {"kind": "CLASSWORK", "id": r2[0].classwork_id},
        ],
    }
    ctx["db"].commit()

    items = resolve_reading_prerequisite_snapshot_items(
        ctx["db"],
        intervention=intervention,
        remediation_assignment=activity,
    )
    assert len(items) == 3
    assert [item.display_order for item in items] == [1, 2, 3]
    assert [item.reading_classwork_id for item in items] == [
        r3[0].classwork_id,
        r1[0].classwork_id,
        r2[0].classwork_id,
    ]
    assert [item.reading_assignment_id for item in items] == [
        r3[1].classwork_assignment_id,
        r1[1].classwork_assignment_id,
        r2[1].classwork_assignment_id,
    ]


def test_resolve_reading_prerequisites_graded_requires_at_least_one_reading(candidate_context):
    ctx = candidate_context
    activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    activity = _remediation(ctx, "Targeted remediation")
    intervention = ctx["candidate"]
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "selected_resources": [],
    }
    ctx["db"].commit()

    with pytest.raises(HTTPException) as exc:
        resolve_reading_prerequisite_snapshot_items(
            ctx["db"],
            intervention=intervention,
            remediation_assignment=activity,
        )
    assert exc.value.status_code == 400
    assert "at least one valid Supporting Reading" in exc.value.detail


def test_resolve_reading_prerequisites_practice_only_permits_empty_or_valid(candidate_context):
    ctx = candidate_context
    activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    reading = _reading(ctx, "Practice foundation")
    activity = _remediation(ctx, "Practice remediation")
    activity.classwork.is_graded = False
    intervention = ctx["candidate"]
    intervention.remediation_plan = {
        "teacher_choice": "CLASSWORK",
        "grade_treatment": "PRACTICE_ONLY",
        "selected_resources": [],
    }
    ctx["db"].commit()

    empty_items = resolve_reading_prerequisite_snapshot_items(
        ctx["db"],
        intervention=intervention,
        remediation_assignment=activity,
    )
    assert empty_items == []

    intervention.remediation_plan = {
        "teacher_choice": "CLASSWORK",
        "grade_treatment": "PRACTICE_ONLY",
        "selected_resources": [{"kind": "CLASSWORK", "id": reading[0].classwork_id}],
    }
    ctx["db"].commit()
    with_reading = resolve_reading_prerequisite_snapshot_items(
        ctx["db"],
        intervention=intervention,
        remediation_assignment=activity,
    )
    assert len(with_reading) == 1
    assert with_reading[0].reading_classwork_id == reading[0].classwork_id
    assert with_reading[0].reading_assignment_id == reading[1].classwork_assignment_id
    assert with_reading[0].display_order == 1


def test_resolve_reading_prerequisites_rejects_duplicates(candidate_context):
    ctx = candidate_context
    activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    reading = _reading(ctx, "Single reading")
    activity = _remediation(ctx, "Targeted remediation")
    intervention = ctx["candidate"]
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "selected_resources": [
            {"kind": "CLASSWORK", "id": reading[0].classwork_id},
            {"kind": "CLASSWORK", "id": reading[0].classwork_id},
        ],
    }
    ctx["db"].commit()

    with pytest.raises(HTTPException) as exc:
        resolve_reading_prerequisite_snapshot_items(
            ctx["db"],
            intervention=intervention,
            remediation_assignment=activity,
        )
    assert exc.value.status_code == 400
    assert "Duplicate reading resources" in exc.value.detail


@pytest.mark.parametrize(
    ("issue_type", "expected_reason"),
    [
        ("missing", "MISSING_RESOURCE"),
        ("invalid_kind", "INVALID_RESOURCE"),
        ("invalid_id", "INVALID_RESOURCE"),
        ("not_reading", "NOT_REQUIRED_READING"),
        ("graded_reading", "NOT_REQUIRED_READING"),
        ("archived", "INACCESSIBLE"),
        ("wrong_subject", "INACCESSIBLE"),
        ("planning_only", "PLANNING_ONLY"),
        ("unpublished_classwork", "UNPUBLISHED"),
        ("unpublished_assignment", "UNPUBLISHED"),
        ("locked_assignment", "LOCKED"),
    ],
)
def test_resolve_reading_prerequisites_rejects_unavailable_and_invalid_resources(
    candidate_context, issue_type, expected_reason
):
    ctx = candidate_context
    activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    reading = _reading(ctx, "Baseline reading")
    activity = _remediation(ctx, "Targeted remediation")
    intervention = ctx["candidate"]

    if issue_type == "missing":
        res = {"kind": "CLASSWORK", "id": 999999}
    elif issue_type == "invalid_kind":
        res = {"kind": "LESSON", "id": reading[0].classwork_id}
    elif issue_type == "invalid_id":
        res = {"kind": "CLASSWORK", "id": -1}
    elif issue_type == "not_reading":
        not_reading = Classwork(
            title="Quiz not reading", classwork_type="QUIZ", is_graded=True,
            total_points=Decimal("10"), is_published=True,
            subject_id=ctx["subject"].subject_id, created_by_staff_id=_staff(ctx),
        )
        ctx["db"].add(not_reading)
        ctx["db"].flush()
        res = {"kind": "CLASSWORK", "id": not_reading.classwork_id}
    elif issue_type == "graded_reading":
        reading[0].is_graded = True
        res = {"kind": "CLASSWORK", "id": reading[0].classwork_id}
    elif issue_type == "archived":
        reading[0].is_archived = True
        res = {"kind": "CLASSWORK", "id": reading[0].classwork_id}
    elif issue_type == "wrong_subject":
        reading[0].subject_id = 999999
        res = {"kind": "CLASSWORK", "id": reading[0].classwork_id}
    elif issue_type == "planning_only":
        ctx["db"].delete(reading[1])
        ctx["db"].flush()
        res = {"kind": "CLASSWORK", "id": reading[0].classwork_id}
    elif issue_type == "unpublished_classwork":
        reading[0].is_published = False
        res = {"kind": "CLASSWORK", "id": reading[0].classwork_id}
    elif issue_type == "unpublished_assignment":
        reading[1].is_published = False
        res = {"kind": "CLASSWORK", "id": reading[0].classwork_id}
    elif issue_type == "locked_assignment":
        reading[1].is_locked = True
        res = {"kind": "CLASSWORK", "id": reading[0].classwork_id}

    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "selected_resources": [res],
    }
    ctx["db"].commit()

    with pytest.raises(HTTPException) as exc:
        resolve_reading_prerequisite_snapshot_items(
            ctx["db"],
            intervention=intervention,
            remediation_assignment=activity,
        )
    assert exc.value.status_code == 400
    assert expected_reason in exc.value.detail


def test_resolve_reading_prerequisites_rejects_scope_and_target_mismatch(candidate_context):
    ctx = candidate_context
    activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    reading = _reading(ctx, "Valid reading")
    activity = _remediation(ctx, "Targeted remediation")
    intervention = ctx["candidate"]
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "selected_resources": [{"kind": "CLASSWORK", "id": reading[0].classwork_id}],
    }
    ctx["db"].commit()

    # Untargeted assignment
    activity.recipient_student_id = None
    activity.source_intervention_id = None
    activity.remediation_request_id = None
    with pytest.raises(HTTPException) as exc:
        resolve_reading_prerequisite_snapshot_items(
            ctx["db"], intervention=intervention, remediation_assignment=activity,
        )
    assert exc.value.status_code == 400
    assert "targeted remediation assignment" in exc.value.detail
    activity.recipient_student_id = ctx["student"].student_id
    activity.source_intervention_id = _id(ctx)
    activity.remediation_request_id = uuid4()

    # Wrong intervention ID
    activity.source_intervention_id = 999999
    with pytest.raises(HTTPException) as exc:
        resolve_reading_prerequisite_snapshot_items(
            ctx["db"], intervention=intervention, remediation_assignment=activity,
        )
    assert exc.value.status_code == 400
    assert "does not belong to this intervention" in exc.value.detail
    activity.source_intervention_id = _id(ctx)

    # Wrong student ID
    from app.models.people.Student import Student
    other_student = Student(
        student_id=uuid4(), student_lrn="300000000098", first_name="Other", last_name="Student",
    )
    ctx["db"].add(other_student)
    ctx["db"].flush()
    activity.recipient_student_id = other_student.student_id
    with pytest.raises(HTTPException) as exc:
        resolve_reading_prerequisite_snapshot_items(
            ctx["db"], intervention=intervention, remediation_assignment=activity,
        )
    assert exc.value.status_code == 400
    assert "recipient does not match intervention student" in exc.value.detail
    activity.recipient_student_id = ctx["student"].student_id

    # Wrong class ID
    activity.class_id = 999999
    with pytest.raises(HTTPException) as exc:
        resolve_reading_prerequisite_snapshot_items(
            ctx["db"], intervention=intervention, remediation_assignment=activity,
        )
    assert exc.value.status_code == 400
    assert "class does not match" in exc.value.detail
    activity.class_id = ctx["class"].class_id

    # Wrong period ID
    activity.academic_period_id = 999999
    with pytest.raises(HTTPException) as exc:
        resolve_reading_prerequisite_snapshot_items(
            ctx["db"], intervention=intervention, remediation_assignment=activity,
        )
    assert exc.value.status_code == 400
    assert "period does not match" in exc.value.detail
    activity.academic_period_id = ctx["period"].academic_period_id


def test_resolve_reading_prerequisites_rejects_inactive_intervention(candidate_context):
    from datetime import datetime, timezone
    ctx = candidate_context
    activate_teacher_candidate(ctx["db"], _staff(ctx), _id(ctx))
    reading = _reading(ctx, "Valid reading")
    activity = _remediation(ctx, "Targeted remediation")
    intervention = ctx["candidate"]
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "selected_resources": [{"kind": "CLASSWORK", "id": reading[0].classwork_id}],
    }
    intervention.status = "RESOLVED"
    intervention.resolution_reason = "IMPROVED_PREDICTION"
    intervention.resolved_at = datetime.now(timezone.utc)
    ctx["db"].commit()

    with pytest.raises(HTTPException) as exc:
        resolve_reading_prerequisite_snapshot_items(
            ctx["db"],
            intervention=intervention,
            remediation_assignment=activity,
        )
    assert exc.value.status_code == 400
    assert "active intervention" in exc.value.detail


import asyncio
import json
from app.models.notifications.Notification import Notification
from app.schemas.Classwork import ClassworkAssignRequest
from app.services.classwork.ClassworkService import (
    assign_classwork_to_classes,
    create_classwork_wizard_record,
)


def _wizard_kwargs(ctx, request_id, is_published=True, treatment="PRACTICE_ONLY", category=None):
    return dict(
        title="Remediation Activity",
        classwork_type="ASSIGNMENT",
        subject_id=ctx["subject"].subject_id,
        description="Focused practice",
        instructions="Complete the practice",
        classwork_category=category,
        total_points=10.0,
        is_published=is_published,
        class_ids=json.dumps([ctx["class"].class_id]),
        academic_period_id=ctx["period"].academic_period_id,
        lesson_ids="[]",
        due_date=None,
        lock_date=None,
        allow_late_submissions=False,
        max_attempts=None,
        quiz_payload=None,
        rubric_payload=None,
        files=None,
        intervention_id=_id(ctx),
        remediation_request_id=request_id,
        current_user={"sub": str(ctx["staff"].user_id), "role": "teacher"},
        staff_id=_staff(ctx),
        db=ctx["db"],
    )


def test_direct_publication_stages_snapshots_atomically(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    activate_teacher_candidate(db, _staff(ctx), _id(ctx))
    r1 = _reading(ctx, "First foundational reading")
    r2 = _reading(ctx, "Second foundational reading")

    intervention = ctx["candidate"]
    intervention.remediation_plan = {
        "teacher_choice": "CLASSWORK",
        "grade_treatment": "PRACTICE_ONLY",
        "selected_resources": [
            {"kind": "CLASSWORK", "id": r1[0].classwork_id},
            {"kind": "CLASSWORK", "id": r2[0].classwork_id},
        ],
    }
    db.commit()

    req_id = uuid4()
    kwargs = _wizard_kwargs(ctx, req_id, is_published=True)
    created = asyncio.run(create_classwork_wizard_record(**kwargs))
    assignment = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()

    assert assignment.is_published is True
    assert assignment.recipient_student_id == ctx["student"].student_id
    assert assignment.source_intervention_id == _id(ctx)

    prereqs = remediation_reading_prerequisites(db, assignment.classwork_assignment_id)
    assert len(prereqs) == 2
    assert prereqs[0].reading_classwork_id == r1[0].classwork_id
    assert prereqs[0].reading_assignment_id == r1[1].classwork_assignment_id
    assert prereqs[0].display_order == 1
    assert prereqs[1].reading_classwork_id == r2[0].classwork_id
    assert prereqs[1].reading_assignment_id == r2[1].classwork_assignment_id
    assert prereqs[1].display_order == 2


def test_draft_to_published_stages_snapshots_atomically(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    activate_teacher_candidate(db, _staff(ctx), _id(ctx))
    r1 = _reading(ctx, "Draft foundation reading")

    intervention = ctx["candidate"]
    intervention.remediation_plan = {
        "teacher_choice": "CLASSWORK",
        "grade_treatment": "PRACTICE_ONLY",
        "selected_resources": [{"kind": "CLASSWORK", "id": r1[0].classwork_id}],
    }
    db.commit()

    req_id = uuid4()
    kwargs = _wizard_kwargs(ctx, req_id, is_published=False)
    created = asyncio.run(create_classwork_wizard_record(**kwargs))
    assignment = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()

    # Draft creation stages zero snapshots
    assert assignment.is_published is False
    assert remediation_reading_prerequisites(db, assignment.classwork_assignment_id) == []

    # Transition to published
    identity = {"sub": str(ctx["staff"].user_id), "role": "teacher"}
    publish_req = ClassworkAssignRequest(
        class_ids=[ctx["class"].class_id],
        academic_period_id=ctx["period"].academic_period_id,
        is_published=True,
    )
    assign_classwork_to_classes(created.classwork_id, publish_req, _staff(ctx), db, identity)
    db.refresh(assignment)

    assert assignment.is_published is True
    prereqs = remediation_reading_prerequisites(db, assignment.classwork_assignment_id)
    assert len(prereqs) == 1
    assert prereqs[0].reading_classwork_id == r1[0].classwork_id
    assert prereqs[0].reading_assignment_id == r1[1].classwork_assignment_id
    assert prereqs[0].display_order == 1


def test_failed_publication_rolls_back_atomically(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    activate_teacher_candidate(db, _staff(ctx), _id(ctx))

    intervention = ctx["candidate"]
    intervention.remediation_plan = {
        "teacher_choice": "CLASSWORK",
        "grade_treatment": "PRACTICE_ONLY",
        "selected_resources": [],  # Empty readings!
    }
    db.commit()

    before_cw = db.query(Classwork).count()
    before_ca = db.query(ClassworkAssignment).count()
    before_prereq = db.query(RemediationReadingPrerequisite).count()

    # Direct publishing fails and rolls back completely
    req_id = uuid4()
    kwargs = _wizard_kwargs(ctx, req_id, is_published=True)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(create_classwork_wizard_record(**kwargs))
    assert exc.value.status_code == 400
    assert "at least one valid Supporting Reading" in exc.value.detail

    assert db.query(Classwork).count() == before_cw
    assert db.query(ClassworkAssignment).count() == before_ca
    assert db.query(RemediationReadingPrerequisite).count() == before_prereq

    # Draft creation succeeds without readings
    draft = asyncio.run(create_classwork_wizard_record(**_wizard_kwargs(ctx, req_id, is_published=False)))
    assignment = db.query(ClassworkAssignment).filter_by(classwork_id=draft.classwork_id).one()
    assert assignment.is_published is False
    assert remediation_reading_prerequisites(db, assignment.classwork_assignment_id) == []

    # Publishing draft fails and rolls back publication
    identity = {"sub": str(ctx["staff"].user_id), "role": "teacher"}
    publish_req = ClassworkAssignRequest(
        class_ids=[ctx["class"].class_id],
        academic_period_id=ctx["period"].academic_period_id,
        is_published=True,
    )
    with pytest.raises(HTTPException) as exc:
        assign_classwork_to_classes(draft.classwork_id, publish_req, _staff(ctx), db, identity)
    assert exc.value.status_code == 400
    assert "at least one valid Supporting Reading" in exc.value.detail

    db.refresh(assignment)
    assert assignment.is_published is False
    assert remediation_reading_prerequisites(db, assignment.classwork_assignment_id) == []


def test_repeated_publication_and_republish_reuses_snapshot_unchanged(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    activate_teacher_candidate(db, _staff(ctx), _id(ctx))
    r1 = _reading(ctx, "Stable foundation")

    intervention = ctx["candidate"]
    intervention.remediation_plan = {
        "teacher_choice": "CLASSWORK",
        "grade_treatment": "PRACTICE_ONLY",
        "selected_resources": [{"kind": "CLASSWORK", "id": r1[0].classwork_id}],
    }
    db.commit()

    created = asyncio.run(create_classwork_wizard_record(**_wizard_kwargs(ctx, uuid4(), is_published=True)))
    assignment = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()
    prereqs = remediation_reading_prerequisites(db, assignment.classwork_assignment_id)
    assert len(prereqs) == 1
    original_prereq_id = prereqs[0].prerequisite_id

    # Repeated save while published
    identity = {"sub": str(ctx["staff"].user_id), "role": "teacher"}
    assign_req = ClassworkAssignRequest(
        class_ids=[ctx["class"].class_id],
        academic_period_id=ctx["period"].academic_period_id,
        is_published=True,
    )
    assign_classwork_to_classes(created.classwork_id, assign_req, _staff(ctx), db, identity)
    current_prereqs = remediation_reading_prerequisites(db, assignment.classwork_assignment_id)
    assert len(current_prereqs) == 1
    assert current_prereqs[0].prerequisite_id == original_prereq_id

    # Unpublish to draft
    unpublish_req = ClassworkAssignRequest(
        class_ids=[ctx["class"].class_id],
        academic_period_id=ctx["period"].academic_period_id,
        is_published=False,
    )
    assign_classwork_to_classes(created.classwork_id, unpublish_req, _staff(ctx), db, identity)
    db.refresh(assignment)
    assert assignment.is_published is False
    # Existing snapshot is immutable and preserved
    assert len(remediation_reading_prerequisites(db, assignment.classwork_assignment_id)) == 1

    # Republish
    assign_classwork_to_classes(created.classwork_id, assign_req, _staff(ctx), db, identity)
    db.refresh(assignment)
    assert assignment.is_published is True
    republished_prereqs = remediation_reading_prerequisites(db, assignment.classwork_assignment_id)
    assert len(republished_prereqs) == 1
    assert republished_prereqs[0].prerequisite_id == original_prereq_id


def test_intervention_selected_resources_change_preserves_existing_snapshot_and_applies_to_new_activity(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    activate_teacher_candidate(db, _staff(ctx), _id(ctx))
    r1 = _reading(ctx, "Activity 1 Reading")
    r2 = _reading(ctx, "Activity 2 Reading")

    intervention = ctx["candidate"]
    intervention.remediation_plan = {
        "teacher_choice": "CLASSWORK",
        "grade_treatment": "PRACTICE_ONLY",
        "selected_resources": [{"kind": "CLASSWORK", "id": r1[0].classwork_id}],
    }
    db.commit()

    # Activity 1
    act1 = asyncio.run(create_classwork_wizard_record(**_wizard_kwargs(ctx, uuid4(), is_published=True)))
    assign1 = db.query(ClassworkAssignment).filter_by(classwork_id=act1.classwork_id).one()
    prereqs1 = remediation_reading_prerequisites(db, assign1.classwork_assignment_id)
    assert [p.reading_classwork_id for p in prereqs1] == [r1[0].classwork_id]

    # Teacher changes intervention selected resources
    intervention.remediation_plan = {
        "teacher_choice": "CLASSWORK",
        "grade_treatment": "PRACTICE_ONLY",
        "selected_resources": [{"kind": "CLASSWORK", "id": r2[0].classwork_id}],
    }
    db.commit()

    # Activity 1 prerequisites remain unchanged!
    assert [p.reading_classwork_id for p in remediation_reading_prerequisites(db, assign1.classwork_assignment_id)] == [r1[0].classwork_id]

    # Activity 2 uses the updated selection
    act2 = asyncio.run(create_classwork_wizard_record(**_wizard_kwargs(ctx, uuid4(), is_published=True)))
    assign2 = db.query(ClassworkAssignment).filter_by(classwork_id=act2.classwork_id).one()
    prereqs2 = remediation_reading_prerequisites(db, assign2.classwork_assignment_id)
    assert [p.reading_classwork_id for p in prereqs2] == [r2[0].classwork_id]


def test_historical_published_activity_is_not_backfilled(candidate_context):
    ctx = candidate_context
    db = ctx["db"]
    activate_teacher_candidate(db, _staff(ctx), _id(ctx))

    historical = _remediation(ctx, "Historical Remediation")
    historical.is_published = True
    historical.classwork.is_published = True
    db.commit()

    # Zero snapshots exist initially
    assert remediation_reading_prerequisites(db, historical.classwork_assignment_id) == []

    # Repeated save / assignment update on already published historical activity
    identity = {"sub": str(ctx["staff"].user_id), "role": "teacher"}
    req = ClassworkAssignRequest(
        class_ids=[ctx["class"].class_id],
        academic_period_id=ctx["period"].academic_period_id,
        is_published=True,
    )
    assign_classwork_to_classes(historical.classwork_id, req, _staff(ctx), db, identity)

    # Must NOT backfill snapshots
    assert remediation_reading_prerequisites(db, historical.classwork_assignment_id) == []



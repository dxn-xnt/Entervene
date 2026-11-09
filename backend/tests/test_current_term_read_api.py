from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.ai.AIModelVersion import AIModelVersion
from tests.test_current_period_live_feature_builder import current_period_context
from tests.test_development_current_term_api import (
    _add_load,
    _add_student,
    _add_teacher,
    _client,
    _enroll,
    _insert_development_prediction,
    _read_params,
)
from tests.test_development_current_term_prediction_persistence import _register_test_model


PATH = "/api/v1/current-term-predictions"
SCOPE_PATH = f"{PATH}/scope"


def _approve_model(ctx) -> AIModelVersion:
    model_version_id = _register_test_model(ctx)
    version = ctx["db"].get(AIModelVersion, model_version_id)
    version.lifecycle_status = "PRODUCTION"
    version.production_validated = True
    version.independent_three_term_validation = True
    version.is_active = True
    ctx["db"].commit()
    return version


@pytest.mark.parametrize(
    "lifecycle,production_validated,independent_validation,is_active",
    [
        ("DEVELOPMENT", False, False, False),
        ("PRODUCTION", False, True, True),
        ("PRODUCTION", True, False, True),
        ("PRODUCTION", True, True, False),
    ],
)
def test_stable_get_reports_unavailable_without_fully_approved_model(
    current_period_context,
    monkeypatch,
    lifecycle,
    production_validated,
    independent_validation,
    is_active,
):
    ctx = current_period_context
    model_version_id = _register_test_model(ctx)
    version = ctx["db"].get(AIModelVersion, model_version_id)
    version.lifecycle_status = lifecycle
    version.production_validated = production_validated
    version.independent_three_term_validation = independent_validation
    version.is_active = is_active
    ctx["db"].commit()

    response = _client(
        monkeypatch,
        ctx["db"],
        environment="production",
        enabled=True,
    ).get(PATH, params=_read_params(ctx))

    assert response.status_code == 503
    assert response.json()["detail"] == "Approved current-term prediction model is unavailable."


def test_stable_get_is_get_only_and_selects_latest_approved_revision(current_period_context, monkeypatch):
    ctx = current_period_context
    version = _approve_model(ctx)
    _insert_development_prediction(ctx, model_version_id=version.model_version_id, revision=1, grade="80.00")
    latest = _insert_development_prediction(ctx, model_version_id=version.model_version_id, revision=2, grade="91.25")
    client = _client(monkeypatch, ctx["db"], environment="production", enabled=False)

    response = client.get(PATH, params=_read_params(ctx))

    assert response.status_code == 200, response.text
    assert response.json()["total"] == 1
    assert response.json()["items"][0]["prediction_id"] == latest.prediction_id
    assert response.json()["items"][0]["revision"] == 2
    assert response.json()["items"][0]["lifecycle_status"] == "PRODUCTION"
    assert client.post(PATH, json={}).status_code == 405


def test_authorized_teacher_reads_only_active_enrollment(current_period_context, monkeypatch):
    ctx = current_period_context
    version = _approve_model(ctx)
    inactive = _add_student(ctx, "Inactive", "Learner", "300000000005")
    _add_load(ctx, ctx["staff"])
    _enroll(ctx, ctx["student"])
    _enroll(ctx, inactive, status="inactive")
    included = _insert_development_prediction(ctx, model_version_id=version.model_version_id)
    _insert_development_prediction(ctx, model_version_id=version.model_version_id, student=inactive)

    response = _client(
        monkeypatch,
        ctx["db"],
        role="teacher",
        user_id=ctx["staff"].user_id,
        environment="production",
        enabled=False,
    ).get(PATH, params=_read_params(ctx))

    assert response.status_code == 200, response.text
    assert [item["prediction_id"] for item in response.json()["items"]] == [included.prediction_id]


def test_unassigned_teacher_is_denied_before_model_availability(current_period_context, monkeypatch):
    ctx = current_period_context
    other = _add_teacher(ctx, "T-UNASSIGNED", "unassigned@example.test")

    response = _client(
        monkeypatch,
        ctx["db"],
        role="teacher",
        user_id=other.user_id,
        environment="production",
        enabled=False,
    ).get(PATH, params=_read_params(ctx))

    assert response.status_code == 403


def test_active_substitute_and_view_only_primary_can_read(current_period_context, monkeypatch):
    ctx = current_period_context
    version = _approve_model(ctx)
    substitute = _add_teacher(ctx, "T-PROD-SUB", "prod.substitute@example.test")
    load = ctx["db"].query(SubjectLoad).filter(
        SubjectLoad.class_id == ctx["class"].class_id,
        SubjectLoad.subject_id == ctx["subject"].subject_id,
        SubjectLoad.academic_period_id == ctx["period"].academic_period_id,
        SubjectLoad.is_active_version.is_(True),
    ).one()
    _insert_development_prediction(ctx, model_version_id=version.model_version_id)
    ctx["db"].add(TeacherSubstitution(
        subject_load_id=load.subject_load_id,
        original_staff_id=ctx["staff"].staff_id,
        substitute_staff_id=substitute.staff_id,
        start_date=date.today() - timedelta(days=1),
        end_date=date.today() + timedelta(days=1),
        status="active",
    ))
    ctx["db"].commit()

    for staff in (ctx["staff"], substitute):
        response = _client(
            monkeypatch,
            ctx["db"],
            role="teacher",
            user_id=staff.user_id,
            environment="production",
            enabled=False,
        ).get(PATH, params=_read_params(ctx))
        assert response.status_code == 200, (staff.staff_id, response.text)
        assert response.json()["total"] == 1


def test_provisional_grade_11_scope_is_available_for_approved_reads(current_period_context, monkeypatch):
    ctx = current_period_context
    _approve_model(ctx)
    level = AcademicLevel(level_name="Grade 11", grade_level=11)
    ctx["db"].add(level)
    ctx["db"].flush()
    class_ = Class(
        section_name="Grade Eleven",
        academic_year_id=ctx["class"].academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    subject = Subject(
        subject_name="Mathematics 11",
        subject_codename="MATH11",
        academic_level_id=level.academic_level_id,
    )
    ctx["db"].add_all([class_, subject])
    ctx["db"].commit()

    response = _client(
        monkeypatch,
        ctx["db"],
        environment="production",
        enabled=False,
    ).get(PATH, params={
        "class_id": class_.class_id,
        "subject_id": subject.subject_id,
        "academic_period_id": ctx["period"].academic_period_id,
    })

    assert response.status_code == 200, response.text
    assert response.json()["items"] == []
    assert response.json()["total"] == 0


def test_admin_scope_discovers_supported_grades_7_through_12(
    current_period_context,
    monkeypatch,
):
    ctx = current_period_context
    for grade in (7, 8, 10, 11, 12):
        level = AcademicLevel(level_name=f"Grade {grade}", grade_level=grade)
        ctx["db"].add(level)
        ctx["db"].flush()
        class_ = Class(
            section_name=f"Grade {grade} Section",
            academic_year_id=ctx["class"].academic_year_id,
            academic_level_id=level.academic_level_id,
        )
        subject = Subject(
            subject_name=f"Mathematics {grade}",
            subject_codename=f"MATH{grade}",
            academic_level_id=level.academic_level_id,
        )
        ctx["db"].add_all([class_, subject])
        ctx["db"].flush()
        ctx["db"].add(SubjectLoad(
            class_id=class_.class_id,
            subject_id=subject.subject_id,
            academic_period_id=ctx["period"].academic_period_id,
            status="published",
            is_active_version=True,
        ))
    ctx["db"].commit()

    response = _client(monkeypatch, ctx["db"]).get(
        SCOPE_PATH,
        params={"academic_period_id": ctx["period"].academic_period_id},
    )

    assert response.status_code == 200, response.text
    assert [item["grade_level"] for item in response.json()["filters"]["grades"]] == [
        7, 8, 9, 10, 11, 12,
    ]
    assert {scope["grade_level"] for scope in response.json()["scopes"]} == {
        7, 8, 9, 10, 11, 12,
    }


def test_admin_scope_discovers_school_wide_published_loads_for_selected_term(
    current_period_context,
    monkeypatch,
):
    ctx = current_period_context
    second_class = Class(
        section_name="Bernoulli",
        academic_year_id=ctx["class"].academic_year_id,
        academic_level_id=ctx["level"].academic_level_id,
    )
    ctx["db"].add(second_class)
    ctx["db"].flush()
    ctx["db"].add_all([
        SubjectLoad(
            class_id=second_class.class_id,
            subject_id=ctx["subject"].subject_id,
            academic_period_id=ctx["period"].academic_period_id,
            status="published",
            is_active_version=True,
        ),
        SubjectLoad(
            class_id=second_class.class_id,
            subject_id=ctx["subject"].subject_id,
            academic_period_id=ctx["next_period"].academic_period_id,
            status="draft",
            is_active_version=True,
        ),
    ])
    ctx["db"].commit()

    response = _client(monkeypatch, ctx["db"]).get(
        SCOPE_PATH,
        params={"academic_period_id": ctx["period"].academic_period_id},
    )

    assert response.status_code == 200, response.text
    payload = response.json()
    assert [(item["section_name"], item["subject_name"]) for item in payload["scopes"]] == [
        ("Archimedes", "Science"),
        ("Bernoulli", "Science"),
    ]
    assert {item["class_id"] for item in payload["filters"]["classes"]} == {
        ctx["class"].class_id,
        second_class.class_id,
    }
    assert payload["filters"]["grades"] == [{"grade_level": 9, "level_name": "Grade 9"}]
    assert [item["academic_period_id"] for item in payload["filters"]["terms"]] == [
        ctx["period"].academic_period_id,
        ctx["next_period"].academic_period_id,
    ]


def test_admin_scope_supports_historical_term_and_filters_out_other_terms(
    current_period_context,
    monkeypatch,
):
    ctx = current_period_context
    ctx["db"].add(SubjectLoad(
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["next_period"].academic_period_id,
        status="active",
        is_active_version=True,
    ))
    ctx["db"].commit()
    client = _client(monkeypatch, ctx["db"])

    current = client.get(
        SCOPE_PATH,
        params={"academic_period_id": ctx["period"].academic_period_id},
    )
    historical = client.get(
        SCOPE_PATH,
        params={"academic_period_id": ctx["next_period"].academic_period_id},
    )

    assert current.status_code == historical.status_code == 200
    assert len(current.json()["scopes"]) == 1
    assert len(historical.json()["scopes"]) == 1
    assert current.json()["scopes"][0] == historical.json()["scopes"][0]


def test_admin_scope_returns_empty_for_term_without_published_loads(
    current_period_context,
    monkeypatch,
):
    ctx = current_period_context

    response = _client(monkeypatch, ctx["db"]).get(
        SCOPE_PATH,
        params={"academic_period_id": ctx["next_period"].academic_period_id},
    )

    assert response.status_code == 200, response.text
    assert response.json()["scopes"] == []
    assert response.json()["filters"]["classes"] == []
    assert response.json()["filters"]["subjects"] == []


def test_admin_scope_rejects_teacher_and_unknown_period(
    current_period_context,
    monkeypatch,
):
    ctx = current_period_context
    teacher_client = _client(
        monkeypatch,
        ctx["db"],
        role="teacher",
        user_id=ctx["staff"].user_id,
    )

    denied = teacher_client.get(
        SCOPE_PATH,
        params={"academic_period_id": ctx["period"].academic_period_id},
    )
    assert denied.status_code == 403

    admin_client = _client(monkeypatch, ctx["db"], role="admin")
    missing = admin_client.get(SCOPE_PATH, params={"academic_period_id": 999999})
    assert missing.status_code == 404

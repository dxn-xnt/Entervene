"""PR 1b policy writes against isolated SQLite; no shared database access."""

from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401 - register all mapped tables
from app.db.Base import Base
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicYearPassingPolicy import AcademicYearPassingPolicy, PassingPolicyAudit
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.settings.Setting import Setting, SettingType
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.grading.PassingPolicyAdminService import (
    edit_template_threshold, read_year_general_average_policy,
    save_year_general_average_policy,
)
from app.services.grading.PassingThresholdReader import read_passing_threshold_context
from app.services.grading.PassingThresholdResolver import (
    PassingThresholdConfigurationError, resolve_passing_threshold,
)
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.GradingTemplates import router as template_router
from app.api.v1.routes.Settings import router as settings_router
from app.db.Session import get_db


@pytest.fixture
def policy_db():
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    with Session(engine, autoflush=False) as db:
        actor = uuid4()
        db.add_all([
            AcademicYear(academic_year_id=1, year_label="2025-2026", start_date=date(2025, 8, 1), end_date=date(2026, 5, 31), is_active=False),
            AcademicYear(academic_year_id=2, year_label="2026-2027", start_date=date(2026, 8, 1), end_date=date(2027, 5, 31), is_active=True),
            AcademicLevel(academic_level_id=1, level_name="Grade 11", grade_level=11),
            Setting(key="general_average_passing_grade", value="80", type=SettingType.STRING, group="academic", is_public=False),
        ])
        core = GradingTemplate(template_name="Core", passing_threshold=Decimal("87"), status="active", updated_at=datetime.now(timezone.utc))
        other = GradingTemplate(template_name="Applied", passing_threshold=Decimal("85"), status="active", updated_at=datetime.now(timezone.utc))
        for template in (core, other):
            template.components = [GradingTemplateComponent(component_name=name, weight=weight, display_order=i)
                for i, (name, weight) in enumerate((("Written Work", Decimal("20")), ("Performance Tasks", Decimal("50")), ("Exams", Decimal("30"))), 1)]
            db.add(template)
        db.flush()
        affected = Subject(subject_name="Mathematics", subject_codename="MATH", academic_level_id=1, grading_template_id=core.grading_template_id, status="active")
        unrelated = Subject(subject_name="Research", subject_codename="RES", academic_level_id=1, grading_template_id=other.grading_template_id, status="active")
        db.add_all([affected, unrelated]); db.commit()
        yield db, actor, core, other, affected, unrelated
    engine.dispose()


def edit(db, actor, template, **changes):
    values = dict(template_id=template.grading_template_id, year_id=2, raw_threshold="88.25",
        expected_updated_at=template.updated_at, reason="Approved policy adjustment", actor=actor)
    values.update(changes)
    return edit_template_threshold(db, **values)


def save(db, actor, year_id, **changes):
    values = dict(year_id=year_id, raw_threshold="80", expected_version=0,
        reason="Administrator confirmation", actor=actor, action="confirm_legacy", confirmed=True)
    values.update(changes)
    return save_year_general_average_policy(db, **values)


def assert_error(code, callback, status=None):
    with pytest.raises(HTTPException) as caught:
        callback()
    assert caught.value.detail["code"] == code
    if status is not None:
        assert caught.value.status_code == status


def test_threshold_edit_is_audited_and_preserves_components_and_assignments(policy_db):
    db, actor, core, _, affected, _ = policy_db
    before_components = [(c.component_name, c.weight) for c in core.components]
    result = edit(db, actor, core)
    db.refresh(core); db.refresh(affected)
    audit = db.query(PassingPolicyAudit).one()
    assert Decimal(str(result["passing_threshold"])) == Decimal("88.25")
    assert (audit.policy_scope, audit.academic_year_id, audit.action) == ("template", 2, "edit")
    assert (audit.old_threshold, audit.new_threshold, audit.actor_user_id, audit.reason) == (
        Decimal("87"), Decimal("88.25"), actor, "Approved policy adjustment")
    assert affected.grading_template_id == core.grading_template_id
    assert [(c.component_name, c.weight) for c in core.components] == before_components


@pytest.mark.parametrize("grade_year", [1, 2])
def test_finalized_grade_on_shared_template_blocks_even_earlier_year(policy_db, grade_year):
    db, actor, core, _, affected, _ = policy_db
    db.add(StudentPeriodGrade(student_id=uuid4(), class_id=1, subject_id=affected.subject_id,
        academic_period_id=grade_year, final_period_grade=Decimal("90"), is_finalized=True))
    db.commit()
    assert_error("FINALIZED_GRADE_PROTECTED", lambda: edit(db, actor, core), 409)
    db.refresh(core)
    assert core.passing_threshold == Decimal("87")
    assert db.query(StudentPeriodGrade).one().final_period_grade == Decimal("90")
    assert db.query(PassingPolicyAudit).count() == 0


def test_archived_subject_and_historical_offering_do_not_hide_finalized_grade(policy_db):
    db, actor, core, _, affected, _ = policy_db
    affected.status = "archived"
    db.add(AcademicPeriod(
        academic_period_id=101, period_name="Historical Term 1",
        period_type="TERM", period_sequence=1, total_periods_in_year=3,
        start_date=date(2025, 8, 1), end_date=date(2025, 10, 31),
        academic_year_id=1, is_active=False,
    ))
    db.add(SubjectOffering(
        subject_id=affected.subject_id, academic_year_id=1,
        academic_level_id=1, academic_period_id=101, status="archived",
    ))
    db.add(StudentPeriodGrade(
        student_id=uuid4(), class_id=1, subject_id=affected.subject_id,
        academic_period_id=101, final_period_grade=Decimal("84"), is_finalized=True,
    ))
    db.commit()
    assert_error("FINALIZED_GRADE_PROTECTED", lambda: edit(db, actor, core), 409)
    db.refresh(core)
    assert core.passing_threshold == Decimal("87")
    assert db.query(PassingPolicyAudit).count() == 0


def test_unrelated_subjects_and_unfinalized_grades_do_not_block(policy_db):
    db, actor, core, other, affected, unrelated = policy_db
    db.add_all([
        StudentPeriodGrade(student_id=uuid4(), class_id=1, subject_id=unrelated.subject_id,
            academic_period_id=1, final_period_grade=Decimal("75"), is_finalized=True),
        StudentPeriodGrade(student_id=uuid4(), class_id=1, subject_id=affected.subject_id,
            academic_period_id=2, final_period_grade=None, is_finalized=False),
    ])
    db.commit()
    edit(db, actor, core)
    assert db.query(PassingPolicyAudit).count() == 1
    assert other.passing_threshold == Decimal("85")


def test_scored_classwork_locks_weights_but_not_threshold_before_finalization(policy_db):
    db, actor, core, _, affected, _ = policy_db
    work = Classwork(title="Scored task", classwork_type="ASSIGNMENT", subject_id=affected.subject_id,
        created_by_staff_id="fixture", is_graded=True)
    db.add(work); db.flush()
    assignment = ClassworkAssignment(classwork_id=work.classwork_id, class_id=1,
        academic_period_id=2, assigned_by_staff_id="fixture")
    db.add(assignment); db.flush()
    db.add(StudentSubmission(student_id=uuid4(), classwork_assignment_id=assignment.classwork_assignment_id,
        grade=Decimal("90")))
    db.commit()
    result = edit(db, actor, core)
    assert result["is_locked"] is True
    assert core.passing_threshold == Decimal("88.25")


@pytest.mark.parametrize("raw", ["NaN", "Infinity", "-1", "100.01", "84.999", "84.000", "1e2", "", "true"])
def test_threshold_rejects_invalid_or_silent_rounding(policy_db, raw):
    db, actor, core, *_ = policy_db
    assert_error("PASSING_THRESHOLD_PRECISION" if raw in {"84.999", "84.000"} else "PASSING_THRESHOLD_INVALID",
        lambda: edit(db, actor, core, raw_threshold=raw), 422)
    assert db.query(PassingPolicyAudit).count() == 0


def test_stale_template_and_missing_reason_rejected(policy_db):
    db, actor, core, *_ = policy_db
    assert_error("POLICY_VERSION_CONFLICT", lambda: edit(db, actor, core,
        expected_updated_at=datetime(2000, 1, 1, tzinfo=timezone.utc)), 409)
    assert_error("POLICY_REASON_REQUIRED", lambda: edit(db, actor, core, reason=" "), 422)


def test_template_audit_and_update_roll_back_together(policy_db, monkeypatch):
    db, actor, core, *_ = policy_db
    before = core.passing_threshold
    def fail_commit():
        raise IntegrityError("redacted", {}, Exception("synthetic"))
    monkeypatch.setattr(db, "commit", fail_commit)
    assert_error("POLICY_WRITE_CONFLICT", lambda: edit(db, actor, core), 409)
    db.refresh(core)
    assert core.passing_threshold == before and db.query(PassingPolicyAudit).count() == 0


def test_legacy_initialization_requires_confirmation_and_is_year_specific(policy_db):
    db, actor, _, _, _, _ = policy_db
    assert read_year_general_average_policy(db, 1)["legacy_proposal"] == "80"
    assert_error("POLICY_CONFIRMATION_REQUIRED", lambda: save(db, actor, 1, confirmed=False), 422)
    with pytest.raises(PassingThresholdConfigurationError, match="not configured"):
        resolve_passing_threshold(read_passing_threshold_context(db, academic_year_id=1), academic_year_id=1, scope="general_average")
    result = save(db, actor, 1)
    assert result["configured"] and result["threshold"] == "80.00" and result["version"] == 1
    first = read_passing_threshold_context(db, academic_year_id=1)
    second = read_passing_threshold_context(db, academic_year_id=2)
    assert resolve_passing_threshold(first, academic_year_id=1, scope="general_average").threshold == Decimal("80")
    with pytest.raises(PassingThresholdConfigurationError):
        resolve_passing_threshold(second, academic_year_id=2, scope="general_average")
    assert db.query(PassingPolicyAudit).one().action == "confirm_legacy"


def test_invalid_or_missing_legacy_policy_cannot_initialize_silently(policy_db):
    db, actor, *_ = policy_db
    legacy = db.query(Setting).filter(Setting.key == "general_average_passing_grade").one()
    legacy.value = "NaN"
    db.commit()
    state = read_year_general_average_policy(db, 1)
    assert state["configured"] is False and state["legacy_proposal"] is None
    assert_error("LEGACY_POLICY_INVALID", lambda: save(db, actor, 1), 422)
    assert db.query(AcademicYearPassingPolicy).count() == 0


@pytest.mark.parametrize("legacy_value", [None, "NaN"], ids=["missing_legacy", "invalid_legacy"])
def test_manual_initialization_requires_confirmation_and_is_year_scoped(policy_db, legacy_value):
    db, actor, core, _, affected, _ = policy_db
    legacy = db.query(Setting).filter(Setting.key == "general_average_passing_grade").one()
    if legacy_value is None:
        db.delete(legacy)
    else:
        legacy.value = legacy_value
    db.commit()
    state = read_year_general_average_policy(db, 1)
    assert state["configured"] is False and state["legacy_proposal"] is None
    before_components = [(component.component_name, component.weight) for component in core.components]
    before_template = core.passing_threshold
    before_assignment = affected.grading_template_id

    manual = dict(action="initialize_manual", raw_threshold="82.25")
    assert_error("POLICY_CONFIRMATION_REQUIRED", lambda: save(db, actor, 1, confirmed=False, **manual), 422)
    assert_error("POLICY_REASON_REQUIRED", lambda: save(db, actor, 1, reason=" ", **manual), 422)
    assert_error("PASSING_THRESHOLD_INVALID", lambda: save(db, actor, 1,
        action="initialize_manual", raw_threshold="NaN"), 422)
    assert db.query(AcademicYearPassingPolicy).count() == 0
    assert db.query(PassingPolicyAudit).count() == 0

    result = save(db, actor, 1, **manual)
    assert result["configured"] and result["threshold"] == "82.25" and result["version"] == 1
    audit = db.query(PassingPolicyAudit).one()
    assert (audit.policy_scope, audit.action, audit.academic_year_id,
            audit.old_threshold, audit.new_threshold, audit.actor_user_id,
            audit.reason, audit.revision) == (
                "general_average", "initialize_manual", 1, None,
                Decimal("82.25"), actor, "Administrator confirmation", 1)
    assert audit.created_at is not None
    assert db.get(AcademicYearPassingPolicy, 2) is None
    assert core.passing_threshold == before_template
    assert affected.grading_template_id == before_assignment
    assert [(component.component_name, component.weight) for component in core.components] == before_components

    # A second administrator holding the original version cannot initialize again.
    assert_error("POLICY_VERSION_CONFLICT", lambda: save(db, actor, 1, **manual), 409)
    assert_error("POLICY_STATE_CONFLICT", lambda: save(db, actor, 1,
        expected_version=1, **manual), 409)
    assert db.query(PassingPolicyAudit).count() == 1


def test_manual_initialization_cannot_bypass_validated_legacy_proposal(policy_db):
    db, actor, *_ = policy_db
    assert read_year_general_average_policy(db, 1)["legacy_proposal"] == "80"
    assert_error("LEGACY_PROPOSAL_AVAILABLE", lambda: save(db, actor, 1,
        action="initialize_manual", raw_threshold="83"), 409)
    assert db.query(AcademicYearPassingPolicy).count() == 0
    assert db.query(PassingPolicyAudit).count() == 0


def test_copy_previous_year_is_explicit_and_audited(policy_db):
    db, actor, *_ = policy_db
    save(db, actor, 1)
    assert_error("POLICY_CONFIRMATION_REQUIRED", lambda: save(db, actor, 2,
        action="copy_previous", source_year_id=1, confirmed=False), 422)
    copied = save(db, actor, 2, action="copy_previous", source_year_id=1)
    assert copied["threshold"] == "80.00" and copied["is_active"] is True
    audits = db.query(PassingPolicyAudit).order_by(PassingPolicyAudit.audit_id).all()
    assert [audit.action for audit in audits] == ["confirm_legacy", "copy_previous"]
    assert (audits[1].source_academic_year_id, audits[1].source_version) == (1, 1)


def test_year_policy_version_and_legacy_bypass_protection(policy_db):
    db, actor, *_ = policy_db
    save(db, actor, 1)
    assert_error("POLICY_VERSION_CONFLICT", lambda: save(db, actor, 1,
        action="edit", raw_threshold="83", expected_version=0), 409)
    result = save(db, actor, 1, action="edit", raw_threshold="83", expected_version=1)
    assert result["version"] == 2
    assert db.get(AcademicYearPassingPolicy, 1).general_average_threshold == Decimal("83")
    audit = db.query(PassingPolicyAudit).order_by(PassingPolicyAudit.audit_id.desc()).first()
    assert (audit.old_threshold, audit.new_threshold, audit.revision) == (Decimal("80"), Decimal("83"), 2)


def test_admin_routes_enforce_role_and_block_unaccounted_legacy_writes(policy_db):
    db, actor, core, *_ = policy_db
    app = FastAPI()
    app.include_router(template_router, prefix="/api/v1/grading-templates")
    app.include_router(settings_router, prefix="/api/v1/settings")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: {"sub": str(actor), "role": "teacher"}
    with TestClient(app) as client:
        url = f"/api/v1/grading-templates/{core.grading_template_id}/passing-threshold"
        payload = {"academic_year_id": 2, "threshold": "88.25",
            "expected_updated_at": core.updated_at.isoformat(), "reason": "Approved policy adjustment"}
        assert client.patch(url, json=payload).status_code == 403
        assert client.put("/api/v1/settings/academic-years/2/general-average-policy",
            json={"threshold": "80", "expected_version": 0, "reason": "Confirmed legacy policy",
                "action": "confirm_legacy", "confirmed": True}).status_code == 403
        assert client.put("/api/v1/settings/academic-years/2/general-average-policy",
            json={"threshold": "82", "expected_version": 0, "reason": "Manual initialization",
                "action": "initialize_manual", "confirmed": True}).status_code == 403
        app.dependency_overrides[get_current_user] = lambda: {"sub": str(actor), "role": "admin"}
        generic = client.patch(f"/api/v1/grading-templates/{core.grading_template_id}",
            json={"updated_at": core.updated_at.isoformat(), "passing_threshold": 88.25})
        assert generic.status_code == 422 and generic.json()["detail"]["code"] == "THRESHOLD_AUDIT_REQUIRED"
        legacy = client.put("/api/v1/settings/general_average_passing_grade", json={"value": "83"})
        assert legacy.status_code == 422 and legacy.json()["detail"]["code"] == "YEAR_POLICY_REQUIRED"
        result = client.patch(url, json=payload)
        assert result.status_code == 200, result.text
        assert result.json()["passing_threshold"] == 88.25
    assert db.query(PassingPolicyAudit).count() == 1


def test_admin_route_can_manually_initialize_only_selected_unconfigured_year(policy_db):
    db, actor, *_ = policy_db
    legacy = db.query(Setting).filter(Setting.key == "general_average_passing_grade").one()
    db.delete(legacy)
    db.commit()
    app = FastAPI()
    app.include_router(settings_router, prefix="/api/v1/settings")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: {"sub": str(actor), "role": "admin"}
    with TestClient(app) as client:
        response = client.put("/api/v1/settings/academic-years/1/general-average-policy",
            json={"threshold": "82.25", "expected_version": 0,
                "reason": "Approved initial policy", "action": "initialize_manual", "confirmed": True})
        assert response.status_code == 200, response.text
        assert response.json()["threshold"] == "82.25"
        assert client.get("/api/v1/settings/academic-years/2/general-average-policy").json()["configured"] is False
    assert db.query(PassingPolicyAudit).one().action == "initialize_manual"


def test_year_policy_audit_rollback_is_atomic(policy_db, monkeypatch):
    db, actor, *_ = policy_db
    def fail_commit():
        raise IntegrityError("redacted", {}, Exception("synthetic"))
    monkeypatch.setattr(db, "commit", fail_commit)
    assert_error("POLICY_WRITE_CONFLICT", lambda: save(db, actor, 1), 409)
    assert db.query(AcademicYearPassingPolicy).count() == 0
    assert db.query(PassingPolicyAudit).count() == 0

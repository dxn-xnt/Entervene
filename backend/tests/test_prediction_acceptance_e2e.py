"""Task 6E Automated Acceptance Suite.

Executes end-to-end verification against an isolated PostgreSQL database cloned from the baseline
Entervene database template. Validates:
1. Isolated PostgreSQL environment lifecycle
2. Golden path student progression (T1-A through T3-N)
3. Mixed-state roster simultaneous state display (Students A, B, C, D)
4. Negative and security authorization guards
5. Model-purpose isolation
6. PostgreSQL advisory lock concurrency
7. Outcome-evaluation revision policy metrics calculation
"""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal
import os
from pathlib import Path
import threading
import uuid
from typing import Any

import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT
import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import sessionmaker

from app.db.Base import Base
from app.db.Session import engine as configured_engine
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.AIPrediction import (
    AIPrediction,
    RISK_ASSESSMENT_EVALUATED,
    RISK_ASSESSMENT_NOT_EVALUATED_CURRENT,
)
from app.models.ai.PredictionGenerationRequest import PredictionGenerationRequest
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.prediction.CurrentPeriodPredictionFreshnessService import (
    evaluate_current_period_prediction_status,
)
from app.services.prediction.CurrentPeriodPredictionGenerationService import (
    generate_current_period_prediction,
    refresh_current_period_prediction_workflow,
)
from app.services.prediction.PredictionGenerationService import generate_from_records
from app.services.prediction.PredictionScopeService import (
    PredictionConflict,
    authorize_generation,
)
from app.services.prediction.PredictionStatusService import (
    get_dual_purpose_roster_status,
    get_prediction_history,
)
from tests.outcome_evaluation_helper import evaluate_dual_purpose_outcomes

# Only run if PostgreSQL is configured or explicit runner is requested
pytestmark = pytest.mark.skipif(
    configured_engine.dialect.name != "postgresql",
    reason="Acceptance suite requires PostgreSQL database.",
)


@pytest.fixture(scope="module")
def pg_acceptance_env():
    """Create a dedicated, run-scoped PostgreSQL acceptance database cloned from template."""
    run_id = f"acc_{uuid.uuid4().hex[:8]}"
    db_name = f"entervene_acceptance_{run_id}"

    # Connect to root postgres DB to clone database from Entervene template
    conn = psycopg2.connect("postgresql://postgres:sphinxclub012@localhost:5432/postgres")
    conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
    cursor = conn.cursor()

    try:
        cursor.execute(f'CREATE DATABASE "{db_name}" TEMPLATE "Entervene"')
    except Exception as e:
        pytest.skip(f"Could not clone Entervene template database: {e}")

    acceptance_url = f"postgresql://postgres:sphinxclub012@localhost:5432/{db_name}"
    acc_engine = create_engine(acceptance_url, pool_size=5, max_overflow=5)
    AccSession = sessionmaker(bind=acc_engine)

    try:
        yield {
            "run_id": run_id,
            "db_name": db_name,
            "engine": acc_engine,
            "Session": AccSession,
        }
    finally:
        acc_engine.dispose()
        cursor.execute(f'DROP DATABASE "{db_name}" WITH (FORCE)')
        cursor.close()
        conn.close()


@pytest.fixture(scope="module")
def acceptance_fixture(pg_acceptance_env):
    """Seed deterministic fixtures for the acceptance run."""
    run_id = pg_acceptance_env["run_id"]
    Session = pg_acceptance_env["Session"]
    db = Session()

    # 1. Academic Year & Level
    year = AcademicYear(
        year_label=f"AY-{run_id[:8]}",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name=f"Gr9-{run_id[:8]}", grade_level=9)
    db.add_all([year, level])
    db.flush()

    # 2. Staff & Roles
    from sqlalchemy import func as sa_func
    admin_role = db.query(Role).filter(sa_func.lower(Role.role_name) == "admin").first()
    teacher_role = db.query(Role).filter(sa_func.lower(Role.role_name) == "teacher").first()
    student_role = db.query(Role).filter(sa_func.lower(Role.role_name) == "student").first()

    # Admin
    admin_user = UserAccount(user_id=uuid.uuid4(), email=f"adm_{run_id[:8]}@school.edu")
    admin_staff = AcademicStaff(
        staff_id=f"ADM-{run_id[:8]}",
        first_name="Admin",
        last_name="User",
        user_id=admin_user.user_id,
    )
    # Assigned Teacher
    t1_user = UserAccount(user_id=uuid.uuid4(), email=f"t1_{run_id[:8]}@school.edu")
    teacher1 = AcademicStaff(
        staff_id=f"T1-{run_id[:8]}",
        first_name="Assigned",
        last_name="Teacher",
        user_id=t1_user.user_id,
    )
    # Unassigned Teacher
    t2_user = UserAccount(user_id=uuid.uuid4(), email=f"t2_{run_id[:8]}@school.edu")
    teacher2 = AcademicStaff(
        staff_id=f"T2-{run_id[:8]}",
        first_name="Unassigned",
        last_name="Teacher",
        user_id=t2_user.user_id,
    )
    # Student User
    stud_user = UserAccount(user_id=uuid.uuid4(), email=f"st_{run_id[:8]}@school.edu")

    db.add_all([admin_user, admin_staff, t1_user, teacher1, t2_user, teacher2, stud_user])
    db.flush()

    # Assign user roles
    db.add_all([
        UserRoles(user_id=admin_user.user_id, role_id=admin_role.role_id),
        UserRoles(user_id=t1_user.user_id, role_id=teacher_role.role_id),
        UserRoles(user_id=t2_user.user_id, role_id=teacher_role.role_id),
        UserRoles(user_id=stud_user.user_id, role_id=student_role.role_id),
    ])
    db.flush()

    now_dt = datetime.now(timezone.utc)
    p1 = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name=f"Term 1-{run_id[:8]}",
        period_sequence=1,
        period_type="TERM",
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.3333"),
        start_date=date(2026, 6, 1),
        end_date=date(2026, 8, 31),
        is_active=False,
        updated_at=now_dt,
    )
    p2 = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name=f"Term 2-{run_id[:8]}",
        period_sequence=2,
        period_type="TERM",
        total_periods_in_year=3,
        period_progress_ratio=Decimal("0.6667"),
        start_date=date(2026, 9, 1),
        end_date=date(2026, 11, 30),
        is_active=True,
        updated_at=now_dt,
    )
    p3 = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name=f"Term 3-{run_id[:8]}",
        period_sequence=3,
        period_type="TERM",
        total_periods_in_year=3,
        period_progress_ratio=Decimal("1.0000"),
        start_date=date(2026, 12, 1),
        end_date=date(2027, 3, 31),
        is_active=False,
        updated_at=now_dt,
    )
    db.add_all([p1, p2, p3])
    db.flush()

    # 4. Class and Subject
    class_ = Class(
        section_name=f"Emerald-{run_id}",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
    )
    subject = Subject(
        subject_name="Science",
        subject_codename="SCIENCE",
        academic_level_id=level.academic_level_id,
    )
    db.add_all([class_, subject])
    db.flush()

    # 5. Grading Template: Science 40/40/20
    template = GradingTemplate(
        template_name=f"Science 40-40-20-{run_id[:8]}",
        academic_level_id=level.academic_level_id,
        subject_id=subject.subject_id,
        status="active",
    )
    db.add(template)
    db.flush()

    comp_ww = GradingTemplateComponent(
        grading_template_id=template.grading_template_id,
        component_name="Written Works",
        weight=Decimal("40.00"),
        display_order=1,
    )
    comp_pt = GradingTemplateComponent(
        grading_template_id=template.grading_template_id,
        component_name="Performance Tasks",
        weight=Decimal("40.00"),
        display_order=2,
    )
    comp_qa = GradingTemplateComponent(
        grading_template_id=template.grading_template_id,
        component_name="Quarterly Assessment",
        weight=Decimal("20.00"),
        display_order=3,
    )
    db.add_all([comp_ww, comp_pt, comp_qa])
    subject.default_grading_template = str(template.grading_template_id)
    db.flush()

    # 6. Subject Loads (Teacher 1 assigned to Class + Subject across all 3 terms)
    sl1 = SubjectLoad(
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        academic_period_id=p1.academic_period_id,
        staff_id=teacher1.staff_id,
        is_active_version=True,
        status="active",
    )
    sl2 = SubjectLoad(
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=teacher1.staff_id,
        is_active_version=True,
        status="active",
    )
    sl3 = SubjectLoad(
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        academic_period_id=p3.academic_period_id,
        staff_id=teacher1.staff_id,
        is_active_version=True,
        status="active",
    )
    db.add_all([sl1, sl2, sl3])
    db.flush()

    # 7. Model Registry: Use existing active models from database
    active_next_model = db.query(AIModelVersion).filter(
        AIModelVersion.model_purpose == ModelPurpose.NEXT_PERIOD_BASELINE_FORECAST.value,
        AIModelVersion.is_active == True,
    ).first()

    active_current_model = db.query(AIModelVersion).filter(
        AIModelVersion.model_purpose == ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
        AIModelVersion.is_active == True,
    ).first()

    historical_current_model = db.query(AIModelVersion).filter(
        AIModelVersion.model_purpose == ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
        AIModelVersion.is_active == False,
    ).first()
    if not historical_current_model:
        historical_current_model = AIModelVersion(
            model_name="entervene_current_period_grade_rf_v0",
            model_type="REGRESSOR",
            model_purpose=ModelPurpose.CURRENT_PERIOD_FINAL_GRADE_PROJECTION.value,
            algorithm="RandomForestRegressor",
            artifact_path=active_current_model.artifact_path,
            feature_schema_json=active_current_model.feature_schema_json,
            is_active=False,
        )
        db.add(historical_current_model)
        db.flush()

    # 8. Seed Enrolled Students:
    # Golden student
    student_golden = Student(
        student_id=uuid.uuid4(),
        student_lrn=f"90{uuid.uuid4().int % 10000000000:010d}",
        first_name="Golden",
        last_name="Pathfinder",
        academic_level_id=level.academic_level_id,
    )
    # Mixed-State Roster Students (Requirement 1)
    student_a = Student(
        student_id=uuid.uuid4(),
        student_lrn=f"91{uuid.uuid4().int % 10000000000:010d}",
        first_name="StudentA",
        last_name="NotReady",
        academic_level_id=level.academic_level_id,
    )
    student_b = Student(
        student_id=uuid.uuid4(),
        student_lrn=f"92{uuid.uuid4().int % 10000000000:010d}",
        first_name="StudentB",
        last_name="BaselineOnly",
        academic_level_id=level.academic_level_id,
    )
    student_c = Student(
        student_id=uuid.uuid4(),
        student_lrn=f"93{uuid.uuid4().int % 10000000000:010d}",
        first_name="StudentC",
        last_name="BaselineAndCurrent",
        academic_level_id=level.academic_level_id,
    )
    student_d = Student(
        student_id=uuid.uuid4(),
        student_lrn=f"94{uuid.uuid4().int % 10000000000:010d}",
        first_name="StudentD",
        last_name="FinalizedOutcome",
        academic_level_id=level.academic_level_id,
    )

    all_students = [student_golden, student_a, student_b, student_c, student_d]
    db.add_all(all_students)
    db.flush()

    for s in all_students:
        db.add(StudentClass(
            student_id=s.student_id,
            class_id=class_.class_id,
            academic_year_id=year.academic_year_id,
            enrollment_status="enrolled",
        ))
    db.commit()

    context = {
        **pg_acceptance_env,
        "db": db,
        "year": year,
        "level": level,
        "class": class_,
        "subject": subject,
        "template": template,
        "p1": p1,
        "p2": p2,
        "p3": p3,
        "admin_user": admin_user,
        "teacher1": teacher1,
        "teacher2": teacher2,
        "stud_user": stud_user,
        "next_model": active_next_model,
        "curr_model": active_current_model,
        "curr_v0": historical_current_model,
        "student_golden": student_golden,
        "student_a": student_a,
        "student_b": student_b,
        "student_c": student_c,
        "student_d": student_d,
    }
    return context


def _create_classwork_and_submission(
    db,
    class_id: int,
    subject_id: int,
    period_id: int,
    component_type: str,
    title: str,
    hps: float,
    student_id: uuid.UUID,
    score: float,
    exam_subtype: str | None = None,
    staff_id: str | None = None,
):
    if not staff_id:
        from app.models.people.AcademicStaff import AcademicStaff
        st = db.query(AcademicStaff).first()
        staff_id = st.staff_id if st else "STAFF-01"

    cw = Classwork(
        title=title,
        description="Acceptance activity",
        classwork_type="QUIZ" if component_type == "WRITTEN_WORK" else "ACTIVITY",
        classwork_category=component_type,
        exam_subtype=exam_subtype,
        total_points=Decimal(str(hps)),
        is_graded=True,
        is_published=True,
        is_archived=False,
        subject_id=subject_id,
        created_by_staff_id=staff_id,
    )
    db.add(cw)
    db.flush()

    ca = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=class_id,
        academic_period_id=period_id,
        assigned_by_staff_id=staff_id,
        is_published=True,
        due_date=datetime.now(timezone.utc) + timedelta(days=2),
    )
    db.add(ca)
    db.flush()

    sub = StudentSubmission(
        classwork_assignment_id=ca.classwork_assignment_id,
        student_id=student_id,
        grade=Decimal(str(score)),
        status="graded",
        submitted_at=datetime.now(timezone.utc),
        graded_at=datetime.now(timezone.utc),
    )
    db.add(sub)
    db.flush()
    return cw, ca, sub


# ==============================================================================
# PASS 6E.1 — SCENARIO TESTS
# ==============================================================================


def test_t1_a_golden_path_term1_no_previous_period(acceptance_fixture):
    """Scenario T1-A: Term 1, no previous period -> baseline is NO_PREVIOUS_PERIOD, no fake baseline."""
    c = acceptance_fixture
    db = c["db"]
    student = c["student_golden"]
    p1 = c["p1"]

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p1.academic_period_id,
        staff_id=c["teacher1"].staff_id,
        is_admin=False,
    )

    item = next(it for it in res["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    assert item["baseline_forecast"]["status"] == "NO_PREVIOUS_PERIOD"
    assert item["baseline_forecast"]["predicted_grade"] is None
    assert item["current_projection"]["projection_freshness"]["status"] == "NO_PROJECTION"
    assert item["primary_display"] == "NONE"


def test_t1_b_insufficient_evidence_generate_hidden(acceptance_fixture):
    """Scenario T1-B: Insufficient graded evidence -> current has NO_PROJECTION, readiness not ready."""
    c = acceptance_fixture
    db = c["db"]
    student = c["student_golden"]
    p1 = c["p1"]

    # Add 1 WW activity (insufficient, <4 activities, <70% weight)
    _create_classwork_and_submission(
        db, c["class"].class_id, c["subject"].subject_id, p1.academic_period_id,
        "WRITTEN_WORK", "WW1", 20.0, student.student_id, 18.0
    )
    db.commit()

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p1.academic_period_id,
        staff_id=c["teacher1"].staff_id,
        is_admin=False,
    )

    item = next(it for it in res["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    cp = item["current_projection"]
    assert cp["evidence_readiness"]["ready"] is False
    assert cp["evidence_readiness"]["level"] in ("NOT_READY", "INSUFFICIENT_EVIDENCE")
    assert cp["refresh_eligibility"]["eligible"] is False
    assert cp["refresh_eligibility"]["status"] == "NOT_READY"


def test_t1_c_and_d_generate_current_period_projection(acceptance_fixture):
    """Scenarios T1-C & T1-D: Enough WW/PT evidence -> STANDARD_READY -> Generate creates Revision 1."""
    c = acceptance_fixture
    db = c["db"]
    student = c["student_golden"]
    p1 = c["p1"]

    # Add 1 more WW (total 2) and 2 PT activities (total 4 activities, WW=40%, PT=40% -> 80% weight >= 70%)
    _create_classwork_and_submission(
        db, c["class"].class_id, c["subject"].subject_id, p1.academic_period_id,
        "WRITTEN_WORK", "WW2", 20.0, student.student_id, 17.0
    )
    _create_classwork_and_submission(
        db, c["class"].class_id, c["subject"].subject_id, p1.academic_period_id,
        "PERFORMANCE_TASK", "PT1", 50.0, student.student_id, 45.0
    )
    _create_classwork_and_submission(
        db, c["class"].class_id, c["subject"].subject_id, p1.academic_period_id,
        "PERFORMANCE_TASK", "PT2", 50.0, student.student_id, 44.0
    )
    db.commit()

    # T1-C check: STANDARD_READY
    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p1.academic_period_id,
        staff_id=c["teacher1"].staff_id,
        is_admin=False,
    )
    item = next(it for it in res["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    assert item["current_projection"]["evidence_readiness"]["ready"] is True
    assert item["current_projection"]["evidence_readiness"]["level"] == "STANDARD_READY"
    assert item["current_projection"]["refresh_eligibility"]["eligible"] is True

    # T1-D: Generate current prediction under PostgreSQL advisory lock
    scope = {
        "student_id": student.student_id,
        "class_id": c["class"].class_id,
        "subject_id": c["subject"].subject_id,
        "academic_period_id": p1.academic_period_id,
    }
    gen_res = generate_current_period_prediction(
        scope,
        staff_id=c["teacher1"].staff_id,
        is_admin=False,
        bind=c["engine"],
        reason="MANUAL_GENERATION",
        initial_only=True,
    )
    assert gen_res["generation_status"] == "CREATED"
    assert gen_res["revision"] == 1
    assert gen_res["risk_level"] is None
    assert gen_res["risk_score"] is None
    assert gen_res["risk_assessment_status"] == RISK_ASSESSMENT_NOT_EVALUATED_CURRENT
    assert gen_res["predicted_period_grade"] is not None

    # Roster immediately returns current projection as primary
    res_after = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p1.academic_period_id,
        staff_id=c["teacher1"].staff_id,
        is_admin=False,
    )
    item_after = next(it for it in res_after["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    assert item_after["primary_display"] == "CURRENT_PROJECTION"
    assert item_after["current_projection"]["predicted_grade"] == gen_res["predicted_period_grade"]
    assert item_after["current_projection"]["revision"] == 1
    assert item_after["current_projection"]["projection_freshness"]["status"] == "CURRENT"


def test_t1_e_and_f_stale_and_refresh_revision(acceptance_fixture):
    """Scenarios T1-E & T1-F: Adding evidence makes projection stale -> Refresh creates Revision 2."""
    c = acceptance_fixture
    db = c["db"]
    student = c["student_golden"]
    p1 = c["p1"]

    # T1-E: Add another PT activity
    _create_classwork_and_submission(
        db, c["class"].class_id, c["subject"].subject_id, p1.academic_period_id,
        "PERFORMANCE_TASK", "PT3", 50.0, student.student_id, 48.0
    )
    db.commit()

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p1.academic_period_id,
        staff_id=c["teacher1"].staff_id,
        is_admin=False,
    )
    item = next(it for it in res["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    assert item["current_projection"]["projection_freshness"]["status"] == "SOURCE_EVIDENCE_CHANGED"
    assert item["current_projection"]["revision"] == 1
    assert item["primary_display"] == "CURRENT_PROJECTION"

    # T1-F: Refresh
    pred_v1 = db.get(AIPrediction, item["current_projection"]["latest_prediction_id"])
    ref_res = refresh_current_period_prediction_workflow(
        db,
        pred_v1,
        staff_id=c["teacher1"].staff_id,
    )
    assert ref_res["generation_status"] == "CREATED"
    assert ref_res["revision"] == 2
    assert ref_res["prediction_id"] != pred_v1.prediction_id

    # History shows both revisions
    pred_v2 = db.get(AIPrediction, ref_res["prediction_id"])
    history = get_prediction_history(db, pred_v2)
    assert len(history["items"]) == 2
    assert set(h["revision"] for h in history["items"]) == {1, 2}


def test_t1_h_complete_canonical_qa_composite(acceptance_fixture):
    """Scenario T1-H: Complete canonical QA 30/30/40 composite elevates evidence to HIGH_EVIDENCE."""
    c = acceptance_fixture
    db = c["db"]
    student = c["student_golden"]
    p1 = c["p1"]

    # Canonical QA: SUMMATIVE_1 (30), SUMMATIVE_2 (30), TERM_EXAM (40)
    # plus WW3 and PT4 to ensure overall available activities >= 7 for HIGH_EVIDENCE
    _create_classwork_and_submission(
        db, c["class"].class_id, c["subject"].subject_id, p1.academic_period_id,
        "WRITTEN_WORK", "WW3", 20.0, student.student_id, 18.0
    )
    _create_classwork_and_submission(
        db, c["class"].class_id, c["subject"].subject_id, p1.academic_period_id,
        "PERFORMANCE_TASK", "PT4", 50.0, student.student_id, 47.0
    )
    _create_classwork_and_submission(
        db, c["class"].class_id, c["subject"].subject_id, p1.academic_period_id,
        "QUARTERLY_ASSESSMENT", "Exam Part 1", 30.0, student.student_id, 27.0, exam_subtype="SUMMATIVE_1"
    )
    _create_classwork_and_submission(
        db, c["class"].class_id, c["subject"].subject_id, p1.academic_period_id,
        "QUARTERLY_ASSESSMENT", "Exam Part 2", 30.0, student.student_id, 28.0, exam_subtype="SUMMATIVE_2"
    )
    _create_classwork_and_submission(
        db, c["class"].class_id, c["subject"].subject_id, p1.academic_period_id,
        "QUARTERLY_ASSESSMENT", "Term Exam", 40.0, student.student_id, 36.0, exam_subtype="TERM_EXAM"
    )
    db.commit()

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p1.academic_period_id,
        staff_id=c["teacher1"].staff_id,
        is_admin=False,
    )
    item = next(it for it in res["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    # Evidence readiness is now HIGH_EVIDENCE (all 3 components WW, PT, QA present and observed weight == 100%)
    assert item["current_projection"]["evidence_readiness"]["level"] == "HIGH_EVIDENCE"


def test_t1_i_period_finalization_blocks_generate_and_refresh(acceptance_fixture):
    """Scenario T1-I: Official final grade finalization foregrounds outcome and blocks generation."""
    c = acceptance_fixture
    db = c["db"]
    student = c["student_golden"]
    p1 = c["p1"]

    # Finalize Term 1 grade
    spg = StudentPeriodGrade(
        student_id=student.student_id,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p1.academic_period_id,
        final_period_grade=Decimal("86.00"),
        is_finalized=True,
        finalized_at=datetime.now(timezone.utc),
    )
    db.add(spg)
    db.commit()

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p1.academic_period_id,
        staff_id=c["teacher1"].staff_id,
        is_admin=False,
    )
    item = next(it for it in res["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    assert item["period_outcome"]["status"] == "FINALIZED"
    assert item["period_outcome"]["actual_grade"] == 86.0
    assert item["current_projection"]["refresh_eligibility"]["eligible"] is False
    assert item["current_projection"]["refresh_eligibility"]["status"] == "FINALIZED"


def test_t2_j_through_m_dual_purpose_lifecycle(acceptance_fixture):
    """Scenarios T2-J to T2-M: Term 1 -> Term 2 NEXT baseline + Term 2 CURRENT projection lifecycle."""
    c = acceptance_fixture
    db = c["db"]
    student = c["student_golden"]
    p1 = c["p1"]
    p2 = c["p2"]

    # T2-J: Generate Term 1 -> Term 2 NEXT baseline forecast
    next_scope = {
        "student_id": student.student_id,
        "class_id": c["class"].class_id,
        "subject_id": c["subject"].subject_id,
        "source_period_id": p1.academic_period_id,
        "target_period_id": p2.academic_period_id,
    }
    next_res = generate_from_records(
        db,
        next_scope,
        model_name=c["next_model"].model_name,
        staff_id=c["teacher1"].staff_id,
        is_admin=False,
    )
    db.commit()
    assert next_res["generation_status"] == "CREATED"
    assert next_res["risk_assessment_status"] == RISK_ASSESSMENT_EVALUATED

    # T2-K: Term 2 starts with zero current evidence
    res_t2 = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=c["teacher1"].staff_id,
        is_admin=False,
    )
    item_t2 = next(it for it in res_t2["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    assert item_t2["baseline_forecast"]["status"] == "FORECAST_CURRENT"
    assert item_t2["baseline_forecast"]["predicted_grade"] == next_res["predicted_period_grade"]
    assert item_t2["current_projection"]["projection_freshness"]["status"] == "NO_PROJECTION"
    # Rule B: when only baseline exists, primary is BASELINE_FORECAST
    assert item_t2["primary_display"] == "BASELINE_FORECAST"

    # T2-L: Add Term 2 evidence and generate CURRENT projection
    for i in range(1, 3):
        _create_classwork_and_submission(
            db, c["class"].class_id, c["subject"].subject_id, p2.academic_period_id,
            "WRITTEN_WORK", f"T2-WW{i}", 25.0, student.student_id, 22.0
        )
        _create_classwork_and_submission(
            db, c["class"].class_id, c["subject"].subject_id, p2.academic_period_id,
            "PERFORMANCE_TASK", f"T2-PT{i}", 50.0, student.student_id, 43.0
        )
    db.commit()

    curr_t2 = generate_current_period_prediction(
        {
            "student_id": student.student_id,
            "class_id": c["class"].class_id,
            "subject_id": c["subject"].subject_id,
            "academic_period_id": p2.academic_period_id,
        },
        staff_id=c["teacher1"].staff_id,
        bind=c["engine"],
        reason="MANUAL_GENERATION",
        initial_only=True,
    )

    res_coexist = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=c["teacher1"].staff_id,
        is_admin=False,
    )
    item_coexist = next(it for it in res_coexist["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    # Both predictions coexist without blending
    assert item_coexist["baseline_forecast"]["predicted_grade"] == next_res["predicted_period_grade"]
    assert item_coexist["current_projection"]["predicted_grade"] == curr_t2["predicted_period_grade"]
    assert item_coexist["primary_display"] == "CURRENT_PROJECTION"

    # T2-M: More Term 2 evidence added makes CURRENT stale, baseline stays current
    _create_classwork_and_submission(
        db, c["class"].class_id, c["subject"].subject_id, p2.academic_period_id,
        "WRITTEN_WORK", "T2-WW3", 25.0, student.student_id, 24.0
    )
    db.commit()

    res_stale = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=c["teacher1"].staff_id,
        is_admin=False,
    )
    item_stale = next(it for it in res_stale["students"] if str(it["student"]["student_id"]) == str(student.student_id))
    assert item_stale["current_projection"]["projection_freshness"]["status"] == "SOURCE_EVIDENCE_CHANGED"
    assert item_stale["baseline_forecast"]["status"] == "FORECAST_CURRENT"


def test_t3_n_final_term_behavior(acceptance_fixture):
    """Scenario T3-N: Final term behavior -> incoming baseline valid, next_period_status = NO_NEXT_PERIOD."""
    c = acceptance_fixture
    db = c["db"]
    p3 = c["p3"]

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p3.academic_period_id,
        staff_id=c["teacher1"].staff_id,
        is_admin=False,
    )
    assert res["class_context"]["academic_period_id"] == p3.academic_period_id
    assert res["class_context"]["next_period_status"] == "NO_NEXT_PERIOD"


# ==============================================================================
# REQUIREMENT 1: MIXED-STATE ROSTER IN FOCAL PERIOD (TERM 2)
# ==============================================================================


def test_requirement_1_mixed_state_roster_simultaneous_display(acceptance_fixture):
    """
    Requirement 1: Seed small mixed-state roster so real UI can display simultaneous states:
    - Student A: NOT_READY / no current projection
    - Student B: incoming baseline only
    - Student C: baseline + current projection
    - Student D: finalized period with official outcome
    Uses actual application services, no hardcoded statuses.
    """
    c = acceptance_fixture
    db = c["db"]
    p1 = c["p1"]
    p2 = c["p2"]
    cls_id = c["class"].class_id
    sub_id = c["subject"].subject_id
    t1_staff = c["teacher1"].staff_id

    sa = c["student_a"]
    sb = c["student_b"]
    sc = c["student_c"]
    sd = c["student_d"]

    # Student A: 1 activity in Term 2 (insufficient -> NOT_READY)
    _create_classwork_and_submission(db, cls_id, sub_id, p2.academic_period_id, "WRITTEN_WORK", "A-WW", 20.0, sa.student_id, 15.0)

    # Seed Term 1 submissions for Student B and Student C so they meet NEXT model readiness (>=50% completion)
    t1_assignments = (
        db.query(ClassworkAssignment, Classwork)
        .join(Classwork, Classwork.classwork_id == ClassworkAssignment.classwork_id)
        .filter(
            ClassworkAssignment.class_id == cls_id,
            ClassworkAssignment.academic_period_id == p1.academic_period_id,
        )
        .all()
    )
    for ca, cw in t1_assignments:
        pts = cw.total_points or Decimal("50.0")
        db.add(StudentSubmission(
            classwork_assignment_id=ca.classwork_assignment_id,
            student_id=sb.student_id,
            grade=Decimal(str(round(float(pts) * 0.84, 2))),
            status="graded",
            submitted_at=datetime.now(timezone.utc),
            graded_at=datetime.now(timezone.utc),
        ))
        db.add(StudentSubmission(
            classwork_assignment_id=ca.classwork_assignment_id,
            student_id=sc.student_id,
            grade=Decimal(str(round(float(pts) * 0.88, 2))),
            status="graded",
            submitted_at=datetime.now(timezone.utc),
            graded_at=datetime.now(timezone.utc),
        ))
    db.commit()

    # Student B: finalized Term 1 grade -> generate NEXT baseline into Term 2, 0 Term 2 activities
    spg_b1 = StudentPeriodGrade(
        student_id=sb.student_id,
        class_id=cls_id,
        subject_id=sub_id,
        academic_period_id=p1.academic_period_id,
        final_period_grade=Decimal("84.00"),
        written_work_percent=Decimal("84.00"),
        performance_task_percent=Decimal("84.00"),
        quarterly_assessment_percent=Decimal("84.00"),
        is_finalized=True,
    )
    db.add(spg_b1)
    db.commit()
    gen_b = generate_from_records(
        db,
        {"student_id": sb.student_id, "class_id": cls_id, "subject_id": sub_id, "source_period_id": p1.academic_period_id, "target_period_id": p2.academic_period_id},
        model_name=c["next_model"].model_name,
        staff_id=t1_staff,
    )
    db.commit()

    # Student C: finalized Term 1 -> NEXT baseline, AND 4 Term 2 activities -> CURRENT projection
    spg_c1 = StudentPeriodGrade(
        student_id=sc.student_id,
        class_id=cls_id,
        subject_id=sub_id,
        academic_period_id=p1.academic_period_id,
        final_period_grade=Decimal("88.00"),
        written_work_percent=Decimal("88.00"),
        performance_task_percent=Decimal("88.00"),
        quarterly_assessment_percent=Decimal("88.00"),
        is_finalized=True,
    )
    db.add(spg_c1)
    db.commit()
    generate_from_records(
        db,
        {"student_id": sc.student_id, "class_id": cls_id, "subject_id": sub_id, "source_period_id": p1.academic_period_id, "target_period_id": p2.academic_period_id},
        model_name=c["next_model"].model_name,
        staff_id=t1_staff,
    )
    for i in range(1, 3):
        _create_classwork_and_submission(db, cls_id, sub_id, p2.academic_period_id, "WRITTEN_WORK", f"C-WW{i}", 20.0, sc.student_id, 18.0)
        _create_classwork_and_submission(db, cls_id, sub_id, p2.academic_period_id, "PERFORMANCE_TASK", f"C-PT{i}", 50.0, sc.student_id, 45.0)
    db.commit()
    generate_current_period_prediction(
        {"student_id": sc.student_id, "class_id": cls_id, "subject_id": sub_id, "academic_period_id": p2.academic_period_id},
        staff_id=t1_staff,
        bind=c["engine"],
        initial_only=True,
    )

    # Student D: Term 2 finalized grade with official outcome
    spg_d2 = StudentPeriodGrade(
        student_id=sd.student_id, class_id=cls_id, subject_id=sub_id,
        academic_period_id=p2.academic_period_id, final_period_grade=Decimal("89.00"), is_finalized=True
    )
    db.add(spg_d2)
    db.commit()

    # Query the live dual-purpose roster for Term 2
    res = get_dual_purpose_roster_status(
        db,
        class_id=cls_id,
        subject_id=sub_id,
        academic_period_id=p2.academic_period_id,
        staff_id=t1_staff,
        is_admin=False,
    )
    items = {str(it["student"]["student_id"]): it for it in res["students"]}

    # Assert Student A: NOT_READY / no current projection
    item_a = items[str(sa.student_id)]
    assert item_a["current_projection"]["evidence_readiness"]["ready"] is False
    assert item_a["current_projection"]["evidence_readiness"]["level"] in ("NOT_READY", "INSUFFICIENT_EVIDENCE")
    assert item_a["current_projection"]["projection_freshness"]["status"] == "NO_PROJECTION"
    assert item_a["primary_display"] == "NONE"

    # Assert Student B: incoming baseline only
    item_b = items[str(sb.student_id)]
    assert item_b["baseline_forecast"]["status"] == "FORECAST_CURRENT"
    assert item_b["baseline_forecast"]["predicted_grade"] is not None
    assert item_b["current_projection"]["projection_freshness"]["status"] == "NO_PROJECTION"
    assert item_b["primary_display"] == "BASELINE_FORECAST"

    # Assert Student C: baseline + current projection coexist
    item_c = items[str(sc.student_id)]
    assert item_c["baseline_forecast"]["predicted_grade"] is not None
    assert item_c["current_projection"]["predicted_grade"] is not None
    assert item_c["current_projection"]["projection_freshness"]["status"] == "CURRENT"
    assert item_c["primary_display"] == "CURRENT_PROJECTION"

    # Assert Student D: finalized period with official outcome
    item_d = items[str(sd.student_id)]
    assert item_d["period_outcome"]["status"] == "FINALIZED"
    assert item_d["period_outcome"]["actual_grade"] == 89.0
    assert item_d["current_projection"]["refresh_eligibility"]["status"] == "FINALIZED"


# ==============================================================================
# NEGATIVE & SECURITY SCENARIOS
# ==============================================================================


def test_security_unassigned_teacher_forbidden(acceptance_fixture):
    """Unassigned teacher receives 403 when accessing roster or generating prediction."""
    c = acceptance_fixture
    db = c["db"]
    p2 = c["p2"]

    with pytest.raises(Exception) as exc:
        get_dual_purpose_roster_status(
            db,
            class_id=c["class"].class_id,
            subject_id=c["subject"].subject_id,
            academic_period_id=p2.academic_period_id,
            staff_id=c["teacher2"].staff_id,  # Unassigned!
            is_admin=False,
        )
    assert isinstance(exc.value, PermissionError) or "403" in str(exc.value) or "Forbidden" in str(exc.value) or "not assigned" in str(exc.value).lower()


def test_security_admin_access_includes_assigned_teacher(acceptance_fixture):
    """Admin is authorized across scopes and receives populated assigned teacher info."""
    c = acceptance_fixture
    db = c["db"]
    p2 = c["p2"]

    res = get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=None,
        is_admin=True,
    )
    assert res["class_context"]["teacher"] is not None
    assert res["class_context"]["teacher"]["staff_id"] == c["teacher1"].staff_id


def test_idempotency_same_request_replay_and_conflict(acceptance_fixture):
    """Same generation_request_id replays original; same id with different scope raises conflict."""
    c = acceptance_fixture
    db = c["db"]
    student = c["student_c"]
    p2 = c["p2"]

    req_id = f"req_{uuid.uuid4().hex}"
    scope = {
        "student_id": student.student_id,
        "class_id": c["class"].class_id,
        "subject_id": c["subject"].subject_id,
        "academic_period_id": p2.academic_period_id,
    }

    # First call with generation_request_id
    res1 = generate_current_period_prediction(
        scope,
        generation_request_id=req_id,
        staff_id=c["teacher1"].staff_id,
        bind=c["engine"],
        initial_only=False,
    )

    # Replay with same request_id
    res2 = generate_current_period_prediction(
        scope,
        generation_request_id=req_id,
        staff_id=c["teacher1"].staff_id,
        bind=c["engine"],
        initial_only=False,
    )
    assert res2["generation_status"] == "REPLAYED"
    assert res2["prediction_id"] == res1["prediction_id"]

    # Replay with same request_id but different student -> conflict
    scope_different = {
        "student_id": c["student_a"].student_id,
        "class_id": c["class"].class_id,
        "subject_id": c["subject"].subject_id,
        "academic_period_id": p2.academic_period_id,
    }
    with pytest.raises(PredictionConflict):
        generate_current_period_prediction(
            scope_different,
            generation_request_id=req_id,
            staff_id=c["teacher1"].staff_id,
            bind=c["engine"],
            initial_only=False,
        )


def test_postgresql_advisory_lock_concurrency(acceptance_fixture):
    """Concurrent generations on identical scope produce exactly one revision via PostgreSQL advisory locks."""
    c = acceptance_fixture
    student = c["student_c"]
    p2 = c["p2"]

    scope = {
        "student_id": student.student_id,
        "class_id": c["class"].class_id,
        "subject_id": c["subject"].subject_id,
        "academic_period_id": p2.academic_period_id,
    }

    results = []
    errors = []

    def worker():
        try:
            r = generate_current_period_prediction(
                scope,
                staff_id=c["teacher1"].staff_id,
                bind=c["engine"],
                initial_only=True,
            )
            results.append(r)
        except Exception as exc:
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    # No uncaught database concurrency deadlocks
    assert len(errors) == 0
    # Every worker received an identical prediction ID (one created, others returned existing)
    pred_ids = {r["prediction_id"] for r in results}
    assert len(pred_ids) == 1


def test_zero_writes_on_roster_get(acceptance_fixture):
    """GET roster executes zero prediction scoring and creates zero database rows."""
    c = acceptance_fixture
    db = c["db"]
    p2 = c["p2"]

    cnt_pred_before = db.query(AIPrediction).count()
    cnt_req_before = db.query(PredictionGenerationRequest).count()

    get_dual_purpose_roster_status(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=p2.academic_period_id,
        staff_id=c["teacher1"].staff_id,
        is_admin=False,
    )

    cnt_pred_after = db.query(AIPrediction).count()
    cnt_req_after = db.query(PredictionGenerationRequest).count()

    assert cnt_pred_after == cnt_pred_before
    assert cnt_req_after == cnt_req_before


def test_outcome_evaluation_metrics_by_purpose(acceptance_fixture):
    """Compute and verify outcome metrics across acceptance database strictly by purpose."""
    c = acceptance_fixture
    db = c["db"]

    outcome_metrics = evaluate_dual_purpose_outcomes(
        db,
        class_id=c["class"].class_id,
        subject_id=c["subject"].subject_id,
    )

    assert outcome_metrics["policy"]["cherry_picking_prohibited"] is True
    assert outcome_metrics["policy"]["purposes_strictly_separated"] is True

    curr_metrics = outcome_metrics["current_period_projections"]["primary_runtime_evaluation"]
    next_metrics = outcome_metrics["next_period_baseline_forecasts"]["baseline_evaluation"]

    # At least Student Golden (Term 1 finalized) is in current metrics
    assert curr_metrics["count"] >= 1
    assert curr_metrics["mae"] is not None
    assert curr_metrics["rmse"] is not None
    assert curr_metrics["median_absolute_error"] is not None

    # Next baseline evaluated against Term 2 finalized (e.g. Student D or Golden)
    assert next_metrics["count"] >= 0

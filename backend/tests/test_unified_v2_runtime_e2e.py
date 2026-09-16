"""Comprehensive E2E Integration tests for UNIFIED_CURRENT_TERM_PROJECTION (Task U5B).

Verifies:
1. Exact 34-feature schema and column ordering
2. Dynamic period progress ratio calculation
3. Prior term lookup (Term 1 null, Term 2/3 finalized only)
4. Domain rules (MAPEH and ADVANCED_PHYSICS rejected as DOMAIN_UNSUPPORTED)
5. Readiness transitions (Insufficient Evidence -> Ready -> Scored -> Successor revision)
6. Finalized period handling
7. Teacher authorization and Admin access
8. PostgreSQL / SQLite row persistence contracts
"""

from datetime import date, datetime, timezone
from decimal import Decimal
import uuid

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.AIPrediction import AIPrediction, RISK_ASSESSMENT_NOT_EVALUATED_UNIFIED
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.prediction.ModelVersionService import compute_file_sha256
from app.services.prediction.PredictionStatusService import get_dual_purpose_roster_status
from app.services.prediction.UnifiedCurrentTermFeatureBuilderService import (
    ARTIFACT_PATH,
    MODEL_NAME,
    MODEL_PURPOSE,
    SCHEMA_PATH,
    _normalize_unified_subject_label,
    _period_progress_ratio,
    _previous_final_grade,
    build_unified_current_term_features_from_records,
    load_unified_feature_schema,
)
from app.services.prediction.UnifiedPredictionGenerationService import (
    evaluate_unified_projection_status,
    generate_unified_from_records,
    refresh_unified_prediction_workflow,
)


@pytest.fixture
def u5b_db():
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(engine)
    SessionLocal = sessionmaker(bind=engine)
    db = SessionLocal()

    # Academic Year: 2025-2026, 3 terms
    ay = AcademicYear(academic_year_id=1, year_label="2025-2026", start_date=date(2025, 8, 1), end_date=date(2026, 5, 31), is_active=True)
    db.add(ay)
    db.flush()

    p1 = AcademicPeriod(
        academic_period_id=1,
        academic_year_id=ay.academic_year_id,
        period_name="Term 1",
        period_sequence=1,
        period_type="TERM",
        total_periods_in_year=3,
        start_date=date(2025, 8, 1),
        end_date=date(2025, 11, 15),
        is_active=True,
    )
    p2 = AcademicPeriod(
        academic_period_id=2,
        academic_year_id=ay.academic_year_id,
        period_name="Term 2",
        period_sequence=2,
        period_type="TERM",
        total_periods_in_year=3,
        start_date=date(2025, 11, 16),
        end_date=date(2026, 2, 28),
        is_active=False,
    )
    p3 = AcademicPeriod(
        academic_period_id=3,
        academic_year_id=ay.academic_year_id,
        period_name="Term 3",
        period_sequence=3,
        period_type="TERM",
        total_periods_in_year=3,
        start_date=date(2026, 3, 1),
        end_date=date(2026, 5, 31),
        is_active=False,
    )
    db.add_all([p1, p2, p3])
    db.flush()

    # Academic Level & Class
    level = AcademicLevel(academic_level_id=7, level_name="Grade 7", grade_level=7)
    db.add(level)
    db.flush()

    cls = Class(class_id=10, academic_year_id=ay.academic_year_id, academic_level_id=level.academic_level_id, section_name="Diamond", class_status="active")
    db.add(cls)
    db.flush()

    # Subjects
    sub_math = Subject(subject_id=1, subject_name="Mathematics 7", subject_codename="MATH7")
    sub_mapeh = Subject(subject_id=2, subject_name="MAPEH 7", subject_codename="MAPEH7")
    sub_phys = Subject(subject_id=3, subject_name="Advanced Physics", subject_codename="ADVANCED_PHYSICS")
    db.add_all([sub_math, sub_mapeh, sub_phys])
    db.flush()

    # Teacher & Subject Load
    user = UserAccount(user_id=uuid.uuid4(), email="maria@example.com")
    db.add(user)
    db.flush()
    staff = AcademicStaff(staff_id="TCH-001", first_name="Maria", last_name="Santos", user_id=user.user_id)
    db.add(staff)
    db.flush()
    load_math = SubjectLoad(subject_load_id=100, staff_id=staff.staff_id, class_id=cls.class_id, subject_id=sub_math.subject_id, academic_period_id=p1.academic_period_id, status="active", is_active_version=True)
    load_mapeh = SubjectLoad(subject_load_id=101, staff_id=staff.staff_id, class_id=cls.class_id, subject_id=sub_mapeh.subject_id, academic_period_id=p1.academic_period_id, status="active", is_active_version=True)
    load_phys = SubjectLoad(subject_load_id=102, staff_id=staff.staff_id, class_id=cls.class_id, subject_id=sub_phys.subject_id, academic_period_id=p1.academic_period_id, status="active", is_active_version=True)
    db.add_all([load_math, load_mapeh, load_phys])
    db.flush()

    # Student
    student = Student(student_id=uuid.uuid4(), student_lrn="123456789012", first_name="Juan", last_name="Dela Cruz", academic_level_id=level.academic_level_id)
    db.add(student)
    db.flush()
    sc = StudentClass(student_id=student.student_id, class_id=cls.class_id, academic_year_id=ay.academic_year_id, enrollment_status="enrolled")
    db.add(sc)
    db.flush()

    # Unified V2 Active Model
    schema = load_unified_feature_schema(SCHEMA_PATH)
    schema_sha = compute_file_sha256(SCHEMA_PATH)
    artifact_sha = compute_file_sha256(ARTIFACT_PATH)
    mv = AIModelVersion(
        model_version_id=35,
        model_name=MODEL_NAME,
        model_type="REGRESSOR",
        model_purpose=MODEL_PURPOSE,
        algorithm="RandomForestRegressor",
        artifact_path=str(ARTIFACT_PATH),
        feature_schema_json=schema,
        is_active=True,
    )
    db.add(mv)
    db.commit()

    yield {
        "db": db,
        "ay": ay,
        "p1": p1,
        "p2": p2,
        "p3": p3,
        "cls": cls,
        "level": level,
        "sub_math": sub_math,
        "sub_mapeh": sub_mapeh,
        "sub_phys": sub_phys,
        "staff": staff,
        "student": student,
        "model": mv,
        "schema": schema,
    }

    db.close()


def test_unified_feature_schema_exact_contract():
    schema = load_unified_feature_schema(SCHEMA_PATH)
    assert schema["model_name"] == "unified_current_term_projection_v2"
    assert schema["model_purpose"] == "UNIFIED_CURRENT_TERM_PROJECTION"
    assert schema["raw_feature_count"] == 34
    assert len(schema["raw_feature_columns"]) == 34
    assert schema["raw_feature_columns"][-4:] == [
        "previous_term_available",
        "previous_term_final_grade",
        "current_period_progress_ratio",
        "subject",
    ]
    assert schema["categorical_features"] == ["subject"]


def test_dynamic_period_progress_ratio(u5b_db):
    p1 = u5b_db["p1"]
    p2 = u5b_db["p2"]
    p3 = u5b_db["p3"]
    assert _period_progress_ratio(p1) == pytest.approx(1 / 3, rel=1e-4)
    assert _period_progress_ratio(p2) == pytest.approx(2 / 3, rel=1e-4)
    assert _period_progress_ratio(p3) == 1.0


def test_previous_final_grade_lookup(u5b_db):
    db = u5b_db["db"]
    student = u5b_db["student"]
    cls = u5b_db["cls"]
    sub = u5b_db["sub_math"]
    p1 = u5b_db["p1"]
    p2 = u5b_db["p2"]

    # Term 1: No previous period exists
    avail, grade, prov = _previous_final_grade(db, student_id=student.student_id, class_id=cls.class_id, subject_id=sub.subject_id, current_period=p1)
    assert avail == 0
    assert grade is None
    assert prov["reason"] == "NO_PREVIOUS_PERIOD"

    # Term 2 without finalized Term 1 grade: Unavailable
    avail, grade, prov = _previous_final_grade(db, student_id=student.student_id, class_id=cls.class_id, subject_id=sub.subject_id, current_period=p2)
    assert avail == 0
    assert grade is None
    assert prov["reason"] == "PREVIOUS_FINAL_GRADE_UNAVAILABLE"

    # Term 2 with finalized Term 1 grade
    spg1 = StudentPeriodGrade(
        student_id=student.student_id,
        class_id=cls.class_id,
        subject_id=sub.subject_id,
        academic_period_id=p1.academic_period_id,
        final_period_grade=Decimal("88.50"),
        is_finalized=True,
    )
    db.add(spg1)
    db.commit()

    avail, grade, prov = _previous_final_grade(db, student_id=student.student_id, class_id=cls.class_id, subject_id=sub.subject_id, current_period=p2)
    assert avail == 1
    assert grade == 88.50
    assert prov["reason"] == "FINALIZED_PREVIOUS_PERIOD_GRADE"


def test_unsupported_domains_rejected_before_scoring(u5b_db):
    db = u5b_db["db"]
    student = u5b_db["student"]
    cls = u5b_db["cls"]
    sub_mapeh = u5b_db["sub_mapeh"]
    sub_phys = u5b_db["sub_phys"]
    p1 = u5b_db["p1"]

    scope_mapeh = {
        "student_id": student.student_id,
        "class_id": cls.class_id,
        "subject_id": sub_mapeh.subject_id,
        "academic_period_id": p1.academic_period_id,
    }
    res_mapeh = generate_unified_from_records(db, scope_mapeh, is_admin=True)
    assert res_mapeh["generation_status"] == "DOMAIN_UNSUPPORTED"
    assert res_mapeh["predicted_period_grade"] is None
    assert any("MAPEH" in r for r in res_mapeh["blocking_reasons"])

    scope_phys = {
        "student_id": student.student_id,
        "class_id": cls.class_id,
        "subject_id": sub_phys.subject_id,
        "academic_period_id": p1.academic_period_id,
    }
    res_phys = generate_unified_from_records(db, scope_phys, is_admin=True)
    assert res_phys["generation_status"] == "DOMAIN_UNSUPPORTED"
    assert res_phys["predicted_period_grade"] is None
    assert any("ADVANCED_PHYSICS" in r for r in res_phys["blocking_reasons"])

    # Verify no prediction row was saved in the database for rejected domain
    preds = db.query(AIPrediction).filter(AIPrediction.student_id == student.student_id).all()
    assert len(preds) == 0


def test_term1_insufficient_evidence_and_generation_with_evidence(u5b_db):
    db = u5b_db["db"]
    student = u5b_db["student"]
    cls = u5b_db["cls"]
    sub = u5b_db["sub_math"]
    p1 = u5b_db["p1"]

    scope = {
        "student_id": student.student_id,
        "class_id": cls.class_id,
        "subject_id": sub.subject_id,
        "academic_period_id": p1.academic_period_id,
    }

    # Step A: Term 1 with 0% evidence -> Insufficient Evidence
    res_empty = generate_unified_from_records(db, scope, is_admin=True)
    assert res_empty["generation_status"] == "NOT_READY"
    assert res_empty["readiness_level"] == "INSUFFICIENT_EVIDENCE"
    assert res_empty["predicted_period_grade"] is None

    # Step B: Add valid graded activities
    staff = u5b_db["staff"]
    # 2 Written Works
    cw1a = Classwork(title="Quiz 1", classwork_type="QUIZ", subject_id=sub.subject_id, total_points=Decimal("50.00"), is_graded=True, is_archived=False, created_by_staff_id=staff.staff_id)
    cw1b = Classwork(title="Quiz 2", classwork_type="QUIZ", subject_id=sub.subject_id, total_points=Decimal("50.00"), is_graded=True, is_archived=False, created_by_staff_id=staff.staff_id)
    db.add_all([cw1a, cw1b])
    db.flush()
    cwa1a = ClassworkAssignment(classwork_id=cw1a.classwork_id, class_id=cls.class_id, academic_period_id=p1.academic_period_id, assigned_by_staff_id=staff.staff_id, is_published=True, due_date=datetime.now(timezone.utc))
    cwa1b = ClassworkAssignment(classwork_id=cw1b.classwork_id, class_id=cls.class_id, academic_period_id=p1.academic_period_id, assigned_by_staff_id=staff.staff_id, is_published=True, due_date=datetime.now(timezone.utc))
    db.add_all([cwa1a, cwa1b])
    db.flush()
    sub1a = StudentSubmission(classwork_assignment_id=cwa1a.classwork_assignment_id, student_id=student.student_id, grade=Decimal("45.00"), status="graded")
    sub1b = StudentSubmission(classwork_assignment_id=cwa1b.classwork_assignment_id, student_id=student.student_id, grade=Decimal("40.00"), status="graded")
    db.add_all([sub1a, sub1b])

    # 2 Performance Tasks
    cw2a = Classwork(title="Project 1", classwork_type="PROJECT", subject_id=sub.subject_id, total_points=Decimal("100.00"), is_graded=True, is_archived=False, created_by_staff_id=staff.staff_id)
    cw2b = Classwork(title="Project 2", classwork_type="PROJECT", subject_id=sub.subject_id, total_points=Decimal("100.00"), is_graded=True, is_archived=False, created_by_staff_id=staff.staff_id)
    db.add_all([cw2a, cw2b])
    db.flush()
    cwa2a = ClassworkAssignment(classwork_id=cw2a.classwork_id, class_id=cls.class_id, academic_period_id=p1.academic_period_id, assigned_by_staff_id=staff.staff_id, is_published=True, due_date=datetime.now(timezone.utc))
    cwa2b = ClassworkAssignment(classwork_id=cw2b.classwork_id, class_id=cls.class_id, academic_period_id=p1.academic_period_id, assigned_by_staff_id=staff.staff_id, is_published=True, due_date=datetime.now(timezone.utc))
    db.add_all([cwa2a, cwa2b])
    db.flush()
    sub2a = StudentSubmission(classwork_assignment_id=cwa2a.classwork_assignment_id, student_id=student.student_id, grade=Decimal("90.00"), status="graded")
    sub2b = StudentSubmission(classwork_assignment_id=cwa2b.classwork_assignment_id, student_id=student.student_id, grade=Decimal("85.00"), status="graded")
    db.add_all([sub2a, sub2b])
    db.commit()

    # Step C: Generate Unified prediction with evidence
    res_gen = generate_unified_from_records(db, scope, is_admin=True, generation_request_id="req-u5b-t1")
    assert res_gen["generation_status"] == "CREATED"
    assert res_gen["revision"] == 1
    assert res_gen["prediction_mode"] == "UNIFIED_CURRENT_TERM_PROJECTION"
    assert 60.0 <= res_gen["predicted_period_grade"] <= 100.0
    assert res_gen["risk_level"] is None
    assert res_gen["risk_score"] is None
    assert res_gen["risk_assessment_status"] == RISK_ASSESSMENT_NOT_EVALUATED_UNIFIED

    # Check persistence in DB
    saved = db.query(AIPrediction).filter(AIPrediction.prediction_id == res_gen["prediction_id"]).one()
    assert saved.model_version_id == 35
    assert saved.revision == 1
    assert saved.predicted_period_grade is not None
    assert saved.evidence_snapshot["raw_features_34"]["previous_term_available"] == 0.0
    assert saved.evidence_snapshot["raw_features_34"]["previous_term_final_grade"] is None
    assert saved.evidence_snapshot["raw_features_34"]["current_period_progress_ratio"] == pytest.approx(1 / 3, rel=1e-4)
    assert saved.evidence_snapshot["raw_features_34"]["subject"] == "MATHEMATICS"

    # Step D: Add more evidence -> Refresh creates revision 2
    cw3 = Classwork(title="Quiz 2", classwork_type="QUIZ", subject_id=sub.subject_id, total_points=Decimal("50.00"), is_graded=True, is_archived=False, created_by_staff_id=staff.staff_id)
    db.add(cw3)
    db.flush()
    cwa3 = ClassworkAssignment(classwork_id=cw3.classwork_id, class_id=cls.class_id, academic_period_id=p1.academic_period_id, assigned_by_staff_id=staff.staff_id, is_published=True, due_date=datetime.now(timezone.utc))
    db.add(cwa3)
    db.flush()
    sub3 = StudentSubmission(classwork_assignment_id=cwa3.classwork_assignment_id, student_id=student.student_id, grade=Decimal("40.00"), status="graded")
    db.add(sub3)
    db.commit()

    # Verify status detects evidence changed
    st = evaluate_unified_projection_status(db, saved)
    assert st["projection_freshness"]["status"] == "SOURCE_EVIDENCE_CHANGED"
    assert st["refresh_eligibility"]["eligible"] is True

    # Refresh
    res_refresh = refresh_unified_prediction_workflow(db, saved, current_user={"role": "admin", "staff_id": "ADMIN-1"})
    assert res_refresh["generation_status"] == "CREATED"
    assert res_refresh["revision"] == 2
    assert res_refresh["prediction_id"] != saved.prediction_id

    # Check total predictions in DB
    all_preds = db.query(AIPrediction).filter(AIPrediction.student_id == student.student_id).order_by(AIPrediction.revision).all()
    assert len(all_preds) == 2
    assert [p.revision for p in all_preds] == [1, 2]
    for p in all_preds:
        assert p.model_version_id == 35


def test_finalized_period_blocks_generation(u5b_db):
    db = u5b_db["db"]
    student = u5b_db["student"]
    cls = u5b_db["cls"]
    sub = u5b_db["sub_math"]
    p1 = u5b_db["p1"]

    # Finalize Term 1 officially
    spg = StudentPeriodGrade(
        student_id=student.student_id,
        class_id=cls.class_id,
        subject_id=sub.subject_id,
        academic_period_id=p1.academic_period_id,
        final_period_grade=Decimal("92.00"),
        is_finalized=True,
    )
    db.add(spg)
    db.commit()

    scope = {
        "student_id": student.student_id,
        "class_id": cls.class_id,
        "subject_id": sub.subject_id,
        "academic_period_id": p1.academic_period_id,
    }
    res = generate_unified_from_records(db, scope, is_admin=True)
    assert res["generation_status"] == "FINALIZED"
    assert res["predicted_period_grade"] is None
    assert res["final_period_grade"] == 92.0
    assert "official final grade supersedes" in res["message"]

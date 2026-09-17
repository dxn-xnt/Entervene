"""
test_prediction_dynamic_relationships.py
========================================
Comprehensive tests verifying:
1. Batched resolver query count bound (<= 3 queries for arbitrary triplet counts).
2. Four-tier teacher status disambiguation (ASSIGNED, SUBSTITUTE_ACTIVE, NO_CONFIRMED_TEACHER, UNASSIGNED, HISTORICAL_UNMAPPED).
3. Period-specific teacher resolution and authorization.
4. Server-side role-based isolation (HTTP 403 on cross-teacher prediction detail access).
5. Substitute teacher authorization (HTTP 200 during active window).
6. Grade summaries endpoint scoping.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine, event
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.routes.Predictions import router as predictions_router
from app.core.Dependencies import get_current_user, get_optional_staff_id, get_staff_id
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.AIPrediction import AIPrediction
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.prediction.TeacherAssignmentResolver import (
    LEGACY_IMPORT_SUBJECT_IDS,
    TeacherResolutionError,
    TeacherStatusLabel,
    get_teacher_assigned_triplets,
    resolve_teacher_for_load,
    resolve_teachers_for_loads,
)


@pytest.fixture
def rel_context():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    lrn_check = next(
        (c for c in Student.__table__.constraints if isinstance(c, CheckConstraint) and c.name == "lrn_check"),
        None,
    )
    if lrn_check and lrn_check in Student.__table__.constraints:
        Student.__table__.constraints.remove(lrn_check)
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        if lrn_check and lrn_check not in Student.__table__.constraints:
            Student.__table__.append_constraint(lrn_check)
    db = sessionmaker(bind=engine)()

    # Academic year & periods
    year = AcademicYear(
        academic_year_id=1,
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    period1 = AcademicPeriod(
        academic_period_id=1,
        academic_year_id=1,
        period_sequence=1,
        period_name="Term 1",
        start_date=date(2025, 6, 1),
        end_date=date(2025, 9, 30),
    )
    period2 = AcademicPeriod(
        academic_period_id=2,
        academic_year_id=1,
        period_sequence=2,
        period_name="Term 2",
        start_date=date(2025, 10, 1),
        end_date=date(2025, 12, 15),
    )
    level9 = AcademicLevel(
        academic_level_id=1,
        grade_level=9,
        level_name="Grade 9",
    )
    level10 = AcademicLevel(
        academic_level_id=2,
        grade_level=10,
        level_name="Grade 10",
    )
    db.add_all([year, period1, period2, level9, level10])
    db.flush()

    # Classes
    class_archimedes = Class(
        class_id=8,
        section_name="Archimedes",
        academic_year_id=1,
        academic_level_id=1,
    )
    class_copernicus = Class(
        class_id=14,
        section_name="Copernicus",
        academic_year_id=1,
        academic_level_id=1,
    )
    db.add_all([class_archimedes, class_copernicus])
    db.flush()

    # Academic Staff
    staff_maria = AcademicStaff(
        staff_id="2026-0002",
        first_name="Maria",
        last_name="Cruz",
        email="m.cruz@school.edu.ph",
    )
    staff_miguel = AcademicStaff(
        staff_id="2026-0003",
        first_name="Miguel",
        last_name="Santos",
        email="miguel.santos@school.edu.ph",
    )
    staff_sub = AcademicStaff(
        staff_id="2026-0099",
        first_name="Sub",
        last_name="Teacher",
        email="sub@school.edu.ph",
    )
    db.add_all([staff_maria, staff_miguel, staff_sub])
    db.flush()

    # Subjects
    sub_math9 = Subject(
        subject_id=7,
        subject_name="Enhanced Math 9",
        subject_codename="EMATH9",
        academic_level_id=1,
    )
    sub_sci9 = Subject(
        subject_id=8,
        subject_name="Enhanced Sci 9",
        subject_codename="ESCI9",
        academic_level_id=1,
    )
    sub_generic = Subject(
        subject_id=21,
        subject_name="Mathematics (Generic)",
        subject_codename="MATH_GEN",
    )
    db.add_all([sub_math9, sub_sci9, sub_generic])
    db.flush()

    # Model Version
    mv = AIModelVersion(
        model_version_id=1,
        model_name="Grade9-Risk-v1",
        model_type="CLASSIFIER",
        algorithm="RandomForestClassifier",
        is_active=True,
    )
    db.add(mv)
    db.flush()

    # Students & Enrollments
    student1 = Student(
        student_id=uuid.uuid4(),
        first_name="Juan",
        last_name="Dela Cruz",
        student_lrn="100000000001",
        gender="MALE",
        dob=date(2010, 1, 1),
    )
    student2 = Student(
        student_id=uuid.uuid4(),
        first_name="Maria",
        last_name="Clara",
        student_lrn="100000000002",
        gender="FEMALE",
        dob=date(2010, 2, 2),
    )
    db.add_all([student1, student2])
    db.flush()

    sc1 = StudentClass(
        student_id=student1.student_id,
        class_id=8,
        academic_year_id=1,
        enrollment_status="enrolled",
    )
    sc2 = StudentClass(
        student_id=student2.student_id,
        class_id=14,
        academic_year_id=1,
        enrollment_status="enrolled",
    )
    db.add_all([sc1, sc2])
    db.flush()

    # Setup FastAPI test app
    app = FastAPI()
    app.include_router(predictions_router, prefix="/api/v1/predictions")
    app.dependency_overrides[get_db] = lambda: db

    current_auth = {
        "user": {"role": "admin"},
        "staff_id": None,
    }

    def override_get_current_user():
        return current_auth["user"]

    def override_get_staff_id():
        return current_auth["staff_id"]

    def override_get_optional_staff_id():
        return current_auth["staff_id"]

    app.dependency_overrides[get_current_user] = override_get_current_user
    app.dependency_overrides[get_staff_id] = override_get_staff_id
    app.dependency_overrides[get_optional_staff_id] = override_get_optional_staff_id

    client = TestClient(app)

    return {
        "db": db,
        "engine": engine,
        "client": client,
        "auth": current_auth,
        "period1": period1,
        "period2": period2,
        "maria": staff_maria,
        "miguel": staff_miguel,
        "sub": staff_sub,
        "math9": sub_math9,
        "sci9": sub_sci9,
        "generic": sub_generic,
        "archimedes": class_archimedes,
        "copernicus": class_copernicus,
        "student1": student1,
        "student2": student2,
    }


def test_batch_resolver_query_count_bound(rel_context):
    """Asserts that resolve_teachers_for_loads executes <= 3 SQL queries regardless of triplet count."""
    db = rel_context["db"]
    engine = rel_context["engine"]

    # Generate 20 distinct triplets
    triplets = []
    for c in range(1, 6):
        for s in range(1, 5):
            triplets.append((c, s, 1))

    query_count = 0

    def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
        nonlocal query_count
        query_count += 1

    event.listen(engine, "before_cursor_execute", before_cursor_execute)
    try:
        results = resolve_teachers_for_loads(db, triplets)
    finally:
        event.remove(engine, "before_cursor_execute", before_cursor_execute)

    # Must be bounded by <= 3 SQL queries (O(1))
    assert query_count <= 3, f"Batch query count bound violated: executed {query_count} queries (expected <= 3)"
    # Every triplet must be present in results
    assert len(results) == len(set(triplets))
    for t in triplets:
        assert t in results


def test_single_item_delegate_assertion_contract(rel_context, monkeypatch):
    """Verifies resolve_teacher_for_load calls the batch resolver and raises TeacherResolutionError if violated."""
    db = rel_context["db"]
    info = resolve_teacher_for_load(db, class_id=8, subject_id=7, academic_period_id=1)
    assert info is not None
    assert hasattr(info, "status_label")
    assert hasattr(info, "is_assigned")

    # If the batch resolver unexpectedly drops the requested triplet, it must raise TeacherResolutionError
    import app.services.prediction.TeacherAssignmentResolver as resolver_mod
    monkeypatch.setattr(resolver_mod, "resolve_teachers_for_loads", lambda db, triplets, as_of=None: {})
    with pytest.raises(TeacherResolutionError) as exc_info:
        resolve_teacher_for_load(db, class_id=8, subject_id=7, academic_period_id=1)
    assert "contract violated" in str(exc_info.value)


def test_four_tier_disambiguation(rel_context):
    """Tests all 4 tiers of the disambiguation tree:
    Tier 1: ASSIGNED & SUBSTITUTE_ACTIVE
    Tier 2: NO_CONFIRMED_TEACHER (draft load)
    Tier 3: UNASSIGNED (valid curriculum subject with no load)
    Tier 4: HISTORICAL_UNMAPPED (legacy import subject)
    """
    db = rel_context["db"]

    # 1. Tier 1: Active/published load with Maria
    load_tier1 = SubjectLoad(
        class_id=8,
        subject_id=7,
        academic_period_id=1,
        staff_id="2026-0002",
        status="published",
        is_active_version=True,
    )
    # 2. Tier 2: Draft load
    load_tier2 = SubjectLoad(
        class_id=8,
        subject_id=8,
        academic_period_id=1,
        staff_id="2026-0002",
        status="draft",
        is_active_version=True,
    )
    db.add_all([load_tier1, load_tier2])
    db.flush()

    triplets = [
        (8, 7, 1),   # Tier 1 (ASSIGNED)
        (8, 8, 1),   # Tier 2 (NO_CONFIRMED_TEACHER)
        (14, 7, 1),  # Tier 3 (UNASSIGNED, subject 7 is Enhanced Math 9)
        (8, 21, 1),  # Tier 4 (HISTORICAL_UNMAPPED, subject 21 is in LEGACY_IMPORT_SUBJECT_IDS)
    ]

    res = resolve_teachers_for_loads(db, triplets)

    assert res[(8, 7, 1)].status_label == TeacherStatusLabel.ASSIGNED
    assert res[(8, 7, 1)].is_assigned is True
    assert res[(8, 7, 1)].staff_id == "2026-0002"
    assert res[(8, 7, 1)].teacher_name == "Maria Cruz"

    assert res[(8, 8, 1)].status_label == TeacherStatusLabel.NO_CONFIRMED_TEACHER
    assert res[(8, 8, 1)].is_assigned is False

    assert res[(14, 7, 1)].status_label == TeacherStatusLabel.UNASSIGNED
    assert res[(14, 7, 1)].is_assigned is False

    assert res[(8, 21, 1)].status_label == TeacherStatusLabel.HISTORICAL_UNMAPPED
    assert res[(8, 21, 1)].is_assigned is False


def test_period_specific_teacher_and_role_isolation(rel_context):
    """Verifies that different teachers in Term 1 vs Term 2 on the same class/subject
    correctly isolate authorization (HTTP 200 for Term 1 teacher, HTTP 403 for Term 2 teacher).
    """
    db = rel_context["db"]
    client = rel_context["client"]
    auth = rel_context["auth"]

    # Term 1: Maria Cruz
    load_t1 = SubjectLoad(
        class_id=8,
        subject_id=7,
        academic_period_id=1,
        staff_id="2026-0002",
        status="published",
        is_active_version=True,
    )
    # Term 2: Miguel Santos
    load_t2 = SubjectLoad(
        class_id=8,
        subject_id=7,
        academic_period_id=2,
        staff_id="2026-0003",
        status="published",
        is_active_version=True,
    )
    db.add_all([load_t1, load_t2])
    db.flush()

    # Create prediction for Term 1
    pred_t1 = AIPrediction(
        prediction_id=101,
        student_id=rel_context["student1"].student_id,
        class_id=8,
        subject_id=7,
        source_period_id=1,
        target_period_id=1,
        risk_level="HIGH_RISK",
        risk_score=0.85,
        data_status="SUFFICIENT",
    )
    db.add(pred_t1)
    db.flush()

    # 1. Term 1 teacher (Maria Cruz) accesses Term 1 prediction -> 200 OK
    auth["user"] = {"role": "teacher"}
    auth["staff_id"] = "2026-0002"
    r1 = client.get("/api/v1/predictions/101/detail")
    assert r1.status_code == 200
    data1 = r1.json()
    assert data1["teacher_staff_id"] == "2026-0002"
    assert data1["teacher_name"] == "Maria Cruz"
    assert data1["teacher_status_label"] == "ASSIGNED"
    assert data1["student_name"] == "Dela Cruz, Juan"
    assert data1["class_name"] == "Archimedes"
    assert data1["grade_level"] == 9

    # 2. Term 2 teacher (Miguel Santos) attempts to access Term 1 prediction -> 403 Forbidden!
    auth["staff_id"] = "2026-0003"
    r2 = client.get("/api/v1/predictions/101/detail")
    assert r2.status_code == 403
    assert "Access denied" in r2.json()["detail"]


def test_substitute_teacher_authorization(rel_context):
    """Verifies that an active substitute teacher gets HTTP 200 and sees substitute context."""
    db = rel_context["db"]
    client = rel_context["client"]
    auth = rel_context["auth"]

    # Original load assigned to Maria
    load = SubjectLoad(
        subject_load_id=50,
        class_id=8,
        subject_id=7,
        academic_period_id=1,
        staff_id="2026-0002",
        status="published",
        is_active_version=True,
    )
    db.add(load)
    db.flush()

    # Active substitution assigned to Sub Teacher
    today = date.today()
    sub = TeacherSubstitution(
        substitution_id=1,
        subject_load_id=load.subject_load_id,
        original_staff_id="2026-0002",
        substitute_staff_id="2026-0099",
        status="active",
        start_date=today - timedelta(days=5),
        end_date=today + timedelta(days=10),
    )
    db.add(sub)

    pred = AIPrediction(
        prediction_id=202,
        student_id=rel_context["student1"].student_id,
        class_id=8,
        subject_id=7,
        source_period_id=1,
        target_period_id=1,
        risk_level="MODERATE_RISK",
        risk_score=0.65,
        data_status="SUFFICIENT",
    )
    db.add(pred)
    db.flush()

    # Substitute teacher accesses prediction -> 200 OK
    auth["user"] = {"role": "teacher"}
    auth["staff_id"] = "2026-0099"
    r = client.get("/api/v1/predictions/202/detail")
    assert r.status_code == 200
    data = r.json()
    assert data["is_substitute"] is True
    assert data["teacher_staff_id"] == "2026-0099"
    assert data["teacher_name"] == "Sub Teacher"
    assert data["original_teacher_name"] == "Maria Cruz"
    assert data["teacher_status_label"] == "SUBSTITUTE_ACTIVE"


def test_grade_summaries_scoping(rel_context):
    """Verifies /dashboard/grade-summaries properly scopes for teachers and admins."""
    db = rel_context["db"]
    client = rel_context["client"]
    auth = rel_context["auth"]

    # Assign Maria to Grade 9 Archimedes
    load = SubjectLoad(
        class_id=8,
        subject_id=7,
        academic_period_id=1,
        staff_id="2026-0002",
        status="published",
        is_active_version=True,
    )
    db.add(load)

    # Add predictions in Archimedes (class_id=8)
    pred1 = AIPrediction(
        prediction_id=301,
        student_id=rel_context["student1"].student_id,
        class_id=8,
        subject_id=7,
        source_period_id=1,
        target_period_id=1,
        risk_level="HIGH_RISK",
        data_status="SUFFICIENT",
    )
    db.add(pred1)
    db.flush()

    # 1. Teacher with 0 loads -> returns []
    auth["user"] = {"role": "teacher"}
    auth["staff_id"] = "2026-0003"  # Miguel has no loads
    r_empty = client.get("/api/v1/predictions/dashboard/grade-summaries")
    assert r_empty.status_code == 200
    assert r_empty.json() == []

    # 2. Teacher with loads (Maria) -> returns only Grade 9 Archimedes
    auth["staff_id"] = "2026-0002"
    r_maria = client.get("/api/v1/predictions/dashboard/grade-summaries")
    assert r_maria.status_code == 200
    data_maria = r_maria.json()
    assert len(data_maria) == 1
    assert data_maria[0]["grade_level"] == 9
    assert len(data_maria[0]["sections"]) == 1
    sec = data_maria[0]["sections"][0]
    assert sec["class_id"] == 8
    assert sec["section_name"] == "Archimedes"
    assert sec["total_students"] == 1
    assert sec["at_risk_count"] == 1
    assert sec["high_risk_count"] == 1

    # 3. Admin -> sees all sections in Grade 9
    auth["user"] = {"role": "admin"}
    auth["staff_id"] = None
    r_admin = client.get("/api/v1/predictions/dashboard/grade-summaries")
    assert r_admin.status_code == 200
    data_admin = r_admin.json()
    assert len(data_admin) >= 1
    sec_names = [s["section_name"] for g in data_admin for s in g["sections"]]
    assert "Archimedes" in sec_names
    assert "Copernicus" in sec_names


def test_grade_summaries_at_risk_counts_distinct_students(rel_context):
    """Regression: at_risk_count must count distinct enrolled students, not raw prediction rows.

    When a student has multiple historical prediction rows (repeated model runs),
    at_risk_count must never exceed total_students for any section. Prior to the fix,
    the aggregation counted raw ai_prediction rows, inflating at_risk_count by 800x+
    on datasets with many predictions per student.
    """
    db = rel_context["db"]
    client = rel_context["client"]
    auth = rel_context["auth"]

    # Maria assigned to Archimedes class_id=8, subject_id=7, period_id=1
    load = SubjectLoad(
        class_id=8,
        subject_id=7,
        academic_period_id=1,
        staff_id="2026-0002",
        status="published",
        is_active_version=True,
    )
    db.add(load)

    # Insert 20 prediction rows for student1 in Archimedes (simulating repeated model runs)
    # These all have at-risk levels to maximize the inflation if counting raw rows.
    for i in range(20):
        pred = AIPrediction(
            prediction_id=500 + i,
            student_id=rel_context["student1"].student_id,
            class_id=8,
            subject_id=7,
            source_period_id=1,
            target_period_id=1,
            risk_level="HIGH_RISK" if i % 3 == 0 else "MODERATE_RISK",
            data_status="SUFFICIENT",
        )
        db.add(pred)

    # Insert 10 prediction rows for student2 in Copernicus (class_id=14)
    for i in range(10):
        pred = AIPrediction(
            prediction_id=600 + i,
            student_id=rel_context["student2"].student_id,
            class_id=14,
            subject_id=7,
            source_period_id=1,
            target_period_id=1,
            risk_level="NEEDS_MONITORING",
            data_status="SUFFICIENT",
        )
        db.add(pred)

    db.flush()

    # Admin view
    auth["user"] = {"role": "admin"}
    auth["staff_id"] = None
    r = client.get("/api/v1/predictions/dashboard/grade-summaries")
    assert r.status_code == 200
    data = r.json()

    grade9 = next(g for g in data if g["grade_level"] == 9)
    for section in grade9["sections"]:
        # Core invariant: at_risk_count must never exceed total_students
        assert section["at_risk_count"] <= section["total_students"], (
            f"Section {section['section_name']}: at_risk_count={section['at_risk_count']} "
            f"> total_students={section['total_students']}. "
            f"Aggregation is counting raw prediction rows instead of distinct students."
        )

    archimedes = next(s for s in grade9["sections"] if s["section_name"] == "Archimedes")
    assert archimedes["total_students"] == 1  # Only student1 enrolled
    assert archimedes["at_risk_count"] == 1   # Only 1 distinct student, despite 20 prediction rows
    assert archimedes["high_risk_count"] == 1  # Student's highest risk is HIGH_RISK

    copernicus = next(s for s in grade9["sections"] if s["section_name"] == "Copernicus")
    assert copernicus["total_students"] == 1  # Only student2 enrolled
    assert copernicus["at_risk_count"] == 1   # 1 distinct student, despite 10 prediction rows
    assert copernicus["moderate_risk_count"] == 1  # NEEDS_MONITORING maps to moderate bucket


def test_grade_summaries_dedup_across_subjects_and_periods(rel_context):
    """Regression: a student with at-risk predictions across multiple subjects and multiple
    periods within the same section must count as exactly 1 toward that section's at_risk_count.

    This is the next-most-likely place the raw-row bug could resurface, since the dedup key
    must be (class_id, student_id), not (class_id, student_id, subject_id) or
    (class_id, student_id, target_period_id).
    """
    db = rel_context["db"]
    client = rel_context["client"]
    auth = rel_context["auth"]

    # Student1 is enrolled in Archimedes (class_id=8).
    # Fixture already has subjects: Math 9 (id=7), Sci 9 (id=8) and periods: Term 1 (id=1), Term 2 (id=2).

    # Create subject loads so the data is reachable
    for subj_id in (7, 8):
        for period_id in (1, 2):
            db.add(SubjectLoad(
                class_id=8,
                subject_id=subj_id,
                academic_period_id=period_id,
                staff_id="2026-0002",
                status="published",
                is_active_version=True,
            ))

    # Student1 has at-risk predictions across all 4 (subject, period) combinations in Archimedes
    pred_id = 700
    for subj_id in (7, 8):
        for period_id in (1, 2):
            for run in range(5):  # 5 model runs each = 20 rows total
                db.add(AIPrediction(
                    prediction_id=pred_id,
                    student_id=rel_context["student1"].student_id,
                    class_id=8,
                    subject_id=subj_id,
                    source_period_id=period_id,
                    target_period_id=period_id,
                    risk_level="HIGH_RISK" if run % 2 == 0 else "MODERATE_RISK",
                    data_status="SUFFICIENT",
                ))
                pred_id += 1

    # Student2 has predictions for 2 different subjects in Copernicus, different periods
    for subj_id, period_id in [(7, 1), (8, 2)]:
        for run in range(3):
            db.add(AIPrediction(
                prediction_id=pred_id,
                student_id=rel_context["student2"].student_id,
                class_id=14,
                subject_id=subj_id,
                source_period_id=period_id,
                target_period_id=period_id,
                risk_level="NEEDS_MONITORING",
                data_status="SUFFICIENT",
            ))
            pred_id += 1

    db.flush()

    # Admin view (all terms, all subjects)
    auth["user"] = {"role": "admin"}
    auth["staff_id"] = None
    r = client.get("/api/v1/predictions/dashboard/grade-summaries")
    assert r.status_code == 200
    data = r.json()

    grade9 = next(g for g in data if g["grade_level"] == 9)

    archimedes = next(s for s in grade9["sections"] if s["section_name"] == "Archimedes")
    # 20 prediction rows across 4 (subject, period) combos — but still only 1 enrolled student
    assert archimedes["total_students"] == 1
    assert archimedes["at_risk_count"] == 1, (
        f"Expected 1 at-risk student but got {archimedes['at_risk_count']}. "
        f"Dedup key is not (class_id, student_id) — likely splitting by subject or period."
    )
    assert archimedes["high_risk_count"] == 1  # Highest risk across all subjects/periods

    copernicus = next(s for s in grade9["sections"] if s["section_name"] == "Copernicus")
    # 6 prediction rows across 2 (subject, period) combos — 1 enrolled student
    assert copernicus["total_students"] == 1
    assert copernicus["at_risk_count"] == 1, (
        f"Expected 1 at-risk student but got {copernicus['at_risk_count']}. "
        f"Dedup key is not (class_id, student_id) — likely splitting by subject or period."
    )

    # Grade-level totals should also reflect the dedup
    assert grade9["at_risk_count"] == 2  # 1 student per section, 2 sections
    assert grade9["total_students"] == 2

    # Core invariant for every section
    for section in grade9["sections"]:
        assert section["at_risk_count"] <= section["total_students"], (
            f"Section {section['section_name']}: at_risk_count={section['at_risk_count']} "
            f"> total_students={section['total_students']}"
        )


def test_insufficient_data_null_risk_score_sorts_last(rel_context):
    """Asserts that predictions with NULL risk_score (INSUFFICIENT_DATA) always sort to the

    bottom (NULLS LAST) regardless of sort direction (ASC or DESC).
    """
    db = rel_context["db"]
    client = rel_context["client"]
    auth = rel_context["auth"]

    # Clear existing predictions for clean test
    db.query(AIPrediction).delete()
    db.flush()

    # Prediction 1: High risk (score 85.0)
    p_high = AIPrediction(
        prediction_id=801,
        student_id=rel_context["student1"].student_id,
        class_id=8,
        subject_id=7,
        source_period_id=1,
        target_period_id=1,
        predicted_period_grade=72.50,
        risk_score=85.0,
        risk_level="HIGH_RISK",
        data_status="SUFFICIENT",
    )
    # Prediction 2: Monitoring (score 35.0)
    p_mon = AIPrediction(
        prediction_id=802,
        student_id=rel_context["student2"].student_id,
        class_id=14,
        subject_id=7,
        source_period_id=1,
        target_period_id=1,
        predicted_period_grade=84.00,
        risk_score=35.0,
        risk_level="NEEDS_MONITORING",
        data_status="SUFFICIENT",
    )
    # Prediction 3: Insufficient data (NULL grade and NULL score)
    p_insuf = AIPrediction(
        prediction_id=803,
        student_id=rel_context["student1"].student_id,
        class_id=8,
        subject_id=8,
        source_period_id=1,
        target_period_id=1,
        predicted_period_grade=None,
        risk_score=None,
        risk_level="INSUFFICIENT_DATA",
        data_status="INSUFFICIENT_DATA",
    )
    db.add_all([p_high, p_mon, p_insuf])
    db.flush()

    auth["user"] = {"role": "admin"}
    auth["staff_id"] = None

    # Test 1: ASCENDING sort by risk_score
    r_asc = client.get("/api/v1/predictions/dashboard/at-risk?sort_by=risk_score&sort_order=asc")
    assert r_asc.status_code == 200
    items_asc = r_asc.json()["items"]
    assert len(items_asc) == 3
    # 35.0 -> 85.0 -> None (NULLS LAST)
    assert items_asc[0]["prediction_id"] == 802
    assert items_asc[0]["risk_score"] == 35.0
    assert items_asc[1]["prediction_id"] == 801
    assert items_asc[1]["risk_score"] == 85.0
    assert items_asc[2]["prediction_id"] == 803
    assert items_asc[2]["risk_score"] is None
    assert items_asc[2]["predicted_period_grade"] is None

    # Test 2: DESCENDING sort by risk_score
    r_desc = client.get("/api/v1/predictions/dashboard/at-risk?sort_by=risk_score&sort_order=desc")
    assert r_desc.status_code == 200
    items_desc = r_desc.json()["items"]
    assert len(items_desc) == 3
    # 85.0 -> 35.0 -> None (NULLS LAST)
    assert items_desc[0]["prediction_id"] == 801
    assert items_desc[0]["risk_score"] == 85.0
    assert items_desc[1]["prediction_id"] == 802
    assert items_desc[1]["risk_score"] == 35.0
    assert items_desc[2]["prediction_id"] == 803
    assert items_desc[2]["risk_score"] is None
    assert items_desc[2]["predicted_period_grade"] is None

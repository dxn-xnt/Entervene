"""
Tests for pathway canonicalization, compatibility, frontend-backend contract synchronization,
and integration with subject offerings & subject load studio.
"""

from pathlib import Path
import re
from datetime import date
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.pathways import (
    CANONICAL_MEDICAL,
    CANONICAL_ENGINEERING,
    PATHWAY_BOTH,
    PATHWAY_GENERAL,
    PATHWAY_ALIAS_MAP,
    canonicalize_pathway,
    are_pathways_compatible,
)
from app.db.Base import Base
from app.db.Session import get_db
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.SubjectOfferings import router as subject_offerings_router
from app.api.v1.routes.SubjectLoads import router as subject_loads_router
from app.models.academic.AcademicPathway import AcademicPathway
from app.models.academic.Subject import Subject
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.academic.SubjectOfferingPathway import SubjectOfferingPathway
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.people.AcademicStaff import AcademicStaff


# ─────────────────────────────────────────────────────────────────────────────
# 1. Unit Tests for Canonicalization and Compatibility
# ─────────────────────────────────────────────────────────────────────────────

def test_canonicalize_pathway_resolutions():
    """Assert canonicalization correctly maps aliases and DB codes."""
    assert canonicalize_pathway("stem_medical") == CANONICAL_MEDICAL
    assert canonicalize_pathway("medical-courses") == CANONICAL_MEDICAL
    assert canonicalize_pathway("stem_engineering") == CANONICAL_ENGINEERING
    assert canonicalize_pathway("engineering-math") == CANONICAL_ENGINEERING
    assert canonicalize_pathway("both") == PATHWAY_BOTH
    assert canonicalize_pathway("general") == PATHWAY_GENERAL
    assert canonicalize_pathway(None) == PATHWAY_GENERAL
    assert canonicalize_pathway("") == PATHWAY_GENERAL


def test_are_pathways_compatible():
    """Assert compatibility logic handles shared offerings and matching pathways."""
    # Shared offering is compatible with any class pathway
    assert are_pathways_compatible("both", "medical-courses") is True
    assert are_pathways_compatible("both", "engineering-math") is True
    assert are_pathways_compatible("both", "general") is True

    # Same canonical pathway is compatible across alias forms
    assert are_pathways_compatible("stem_medical", "medical-courses") is True
    assert are_pathways_compatible("medical-courses", "stem_medical") is True
    assert are_pathways_compatible("medical-courses", "medical-courses") is True
    assert are_pathways_compatible("stem_engineering", "engineering-math") is True
    assert are_pathways_compatible("engineering-math", "engineering-math") is True

    # Cross-pathway offerings are incompatible
    assert are_pathways_compatible("medical-courses", "engineering-math") is False
    assert are_pathways_compatible("stem_medical", "stem_engineering") is False
    assert are_pathways_compatible("engineering-math", "medical-courses") is False

    # General pathway compatibility
    assert are_pathways_compatible("general", "general") is True
    assert are_pathways_compatible("medical-courses", "general") is False
    assert are_pathways_compatible("general", "medical-courses") is False


# ─────────────────────────────────────────────────────────────────────────────
# 2. Frontend-Backend Contract Sync Test
# ─────────────────────────────────────────────────────────────────────────────

def test_frontend_backend_pathway_contract_sync():
    """
    Asserts frontend/src/lib/pathways.ts and backend/app/core/pathways.py
    maintain identical canonical codes and alias map keys.
    """
    frontend_pathways_ts = Path(__file__).resolve().parents[2] / "frontend" / "src" / "lib" / "pathways.ts"
    assert frontend_pathways_ts.exists(), f"Frontend pathways.ts not found at {frontend_pathways_ts}"

    ts_content = frontend_pathways_ts.read_text(encoding="utf-8")

    # Verify canonical codes match
    assert f'"{CANONICAL_MEDICAL}"' in ts_content
    assert f'"{CANONICAL_ENGINEERING}"' in ts_content
    assert f'"{PATHWAY_BOTH}"' in ts_content
    assert f'"{PATHWAY_GENERAL}"' in ts_content

    # Extract alias keys from TS file
    alias_matches = re.findall(r'"([^"]+)":\s*(?:CANONICAL_PATHWAYS\.\w+|"[^"]+")', ts_content)
    ts_aliases = set(alias_matches)

    py_aliases = set(PATHWAY_ALIAS_MAP.keys())
    assert py_aliases == ts_aliases, (
        f"Pathway alias mismatch between backend and frontend!\n"
        f"Backend only: {py_aliases - ts_aliases}\n"
        f"Frontend only: {ts_aliases - py_aliases}"
    )


# ─────────────────────────────────────────────────────────────────────────────
# 3. Integration Tests: Subject Offering Query Service & Subject Loads
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture
def test_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        # Seed test data
        year = AcademicYear(
            academic_year_id=1,
            year_label="2025-2026",
            start_date=date(2025, 6, 1),
            end_date=date(2026, 3, 31),
            is_active=True,
        )
        period = AcademicPeriod(
            academic_period_id=1,
            academic_year_id=1,
            period_name="Term 1",
            period_type="TERM",
            period_sequence=1,
            start_date=date(2025, 6, 1),
            end_date=date(2025, 9, 30),
            is_active=True,
        )
        g11 = AcademicLevel(academic_level_id=1, level_name="Grade 11", grade_level=11)
        med_pw = AcademicPathway(id=1, code=CANONICAL_MEDICAL, name="Medical Courses and Sciences Related", is_enabled=True)
        eng_pw = AcademicPathway(id=2, code=CANONICAL_ENGINEERING, name="Engineering and Mathematics Related", is_enabled=True)

        # Subjects
        s_res1 = Subject(subject_id=1, subject_name="Research 1", subject_codename="RESEARCH1", academic_level_id=1, is_core=False, subject_group="Core", status="active")
        s_stat = Subject(subject_id=2, subject_name="Statistics and Probability", subject_codename="STATPROB", academic_level_id=1, is_core=False, subject_group="Core", status="active")
        s_hsf = Subject(subject_id=3, subject_name="Health Science Fundamentals", subject_codename="HSF1", academic_level_id=1, is_core=False, subject_group="Specialized", status="active")
        s_hap = Subject(subject_id=4, subject_name="Human Anatomy and Physiology", subject_codename="HAP1", academic_level_id=1, is_core=False, subject_group="Specialized", status="active")
        s_eng = Subject(subject_id=5, subject_name="Introduction to Engineering", subject_codename="INTROENG1", academic_level_id=1, is_core=False, subject_group="Specialized", status="active")

        # Offerings
        # Research 1 -> linked to both
        o_res1 = SubjectOffering(subject_offering_id=1, subject_id=1, academic_year_id=1, academic_level_id=1, academic_period_id=1, status="active")
        # StatProb -> linked to both
        o_stat = SubjectOffering(subject_offering_id=2, subject_id=2, academic_year_id=1, academic_level_id=1, academic_period_id=1, status="active")
        # Health Science -> Medical
        o_hsf = SubjectOffering(subject_offering_id=3, subject_id=3, academic_year_id=1, academic_level_id=1, academic_period_id=1, status="active")
        # Human Anatomy -> Medical
        o_hap = SubjectOffering(subject_offering_id=4, subject_id=4, academic_year_id=1, academic_level_id=1, academic_period_id=1, status="active")
        # Intro to Engineering -> Engineering
        o_eng = SubjectOffering(subject_offering_id=5, subject_id=5, academic_year_id=1, academic_level_id=1, academic_period_id=1, status="active")

        # Class sections
        cls_zara = Class(class_id=1, section_name="Zara", academic_level_id=1, academic_year_id=1, pathway_id=1, class_status="active")
        cls_campos = Class(class_id=2, section_name="Campos", academic_level_id=1, academic_year_id=1, pathway_id=2, class_status="active")

        # Staff
        staff = AcademicStaff(staff_id="STF-001", first_name="Maria", last_name="Santos", email="maria@example.com")

        session.add_all([year, period, g11, med_pw, eng_pw, s_res1, s_stat, s_hsf, s_hap, s_eng, o_res1, o_stat, o_hsf, o_hap, o_eng, cls_zara, cls_campos, staff])
        session.flush()

        # Pathway links
        # o_res1 -> med & eng
        session.add(SubjectOfferingPathway(subject_offering_id=1, pathway_id=1))
        session.add(SubjectOfferingPathway(subject_offering_id=1, pathway_id=2))
        # o_stat -> med & eng
        session.add(SubjectOfferingPathway(subject_offering_id=2, pathway_id=1))
        session.add(SubjectOfferingPathway(subject_offering_id=2, pathway_id=2))
        # o_hsf -> med
        session.add(SubjectOfferingPathway(subject_offering_id=3, pathway_id=1))
        # o_hap -> med
        session.add(SubjectOfferingPathway(subject_offering_id=4, pathway_id=1))
        # o_eng -> eng
        session.add(SubjectOfferingPathway(subject_offering_id=5, pathway_id=2))
        session.commit()

        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture
def client(test_db):
    app = FastAPI()
    app.include_router(subject_offerings_router, prefix="/api/v1/subject-offerings")
    app.include_router(subject_loads_router, prefix="/api/v1/subject-loads")
    app.dependency_overrides[get_db] = lambda: test_db
    app.dependency_overrides[get_current_user] = lambda: {"sub": "ADM-001", "role": "admin"}
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def test_subject_offerings_pathway_alias_equivalence_and_shared_inclusion(client):
    """
    Verifies that querying by 'stem_medical' and 'medical-courses' yields identical results,
    and both include shared subjects (Research 1, Statistics and Probability) alongside specialized subjects.
    """
    res_legacy = client.get("/api/v1/subject-offerings?pathway=stem_medical")
    assert res_legacy.status_code == 200, res_legacy.text
    legacy_offerings = res_legacy.json()["subject_offerings"]

    res_canon = client.get("/api/v1/subject-offerings?pathway=medical-courses")
    assert res_canon.status_code == 200, res_canon.text
    canon_offerings = res_canon.json()["subject_offerings"]

    legacy_ids = {o["subject_offering_id"] for o in legacy_offerings}
    canon_ids = {o["subject_offering_id"] for o in canon_offerings}
    assert legacy_ids == canon_ids, "stem_medical and medical-courses must return identical offerings"

    names = {o["subject"]["subject_name"] for o in canon_offerings}
    assert "Health Science Fundamentals" in names
    assert "Human Anatomy and Physiology" in names
    assert "Research 1" in names, "Shared core subject Research 1 must be included"
    assert "Statistics and Probability" in names, "Shared core subject Statistics & Probability must be included"
    assert "Introduction to Engineering" not in names, "Engineering subject must NOT be included in medical query"
    assert len(names) == 4


def test_subject_load_studio_data_pathway_loads(client):
    """
    Verifies that Subject Load Studio returns offerings with canonical pathway codes,
    enabling Zara (Medical) to match 4 subjects and Campos (Engineering) to match 3 subjects.
    """
    res = client.get("/api/v1/subject-loads/studio-data")
    assert res.status_code == 200, res.text
    data = res.json()

    classes = data.get("classes", [])
    offerings = data.get("subject_offerings", [])

    zara = next((c for c in classes if c.get("section_name") == "Zara"), None)
    campos = next((c for c in classes if c.get("section_name") == "Campos"), None)

    assert zara is not None
    assert campos is not None

    # Check Zara (Medical) pathway matching: should match 4 subjects (2 shared + 2 medical specialized)
    zara_offerings = [
        so for so in offerings
        if so["academic_level_id"] == zara["academic_level_id"]
        and are_pathways_compatible(so.get("pathway"), zara.get("pathway"))
    ]
    zara_subject_ids = {so["subject_id"] for so in zara_offerings}
    assert len(zara_subject_ids) == 4, f"Zara should match exactly 4 subjects, got {len(zara_subject_ids)}"

    # Check Campos (Engineering) pathway matching: should match 3 subjects (2 shared + 1 engineering specialized)
    campos_offerings = [
        so for so in offerings
        if so["academic_level_id"] == campos["academic_level_id"]
        and are_pathways_compatible(so.get("pathway"), campos.get("pathway"))
    ]
    campos_subject_ids = {so["subject_id"] for so in campos_offerings}
    assert len(campos_subject_ids) == 3, f"Campos should match exactly 3 subjects, got {len(campos_subject_ids)}"

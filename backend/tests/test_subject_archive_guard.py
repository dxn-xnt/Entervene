from datetime import date
import uuid
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Subjects import router as subjects_router
from app.api.v1.routes.SubjectOfferings import router as subject_offerings_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectGroup import SubjectGroup
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.SubjectOffering import SubjectOffering
from app.services.subjects.SubjectService import archive_subject_record, update_subject_record
from app.services.subject_offerings.SubjectOfferingService import archive_subject_offering_record, update_subject_offering_record
from app.schemas.Subject import SubjectUpdate
from app.schemas.SubjectOffering import SubjectOfferingUpdate


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture
def client(db):
    test_app = FastAPI()
    test_app.include_router(subjects_router, prefix="/api/v1/subjects")
    test_app.include_router(subject_offerings_router, prefix="/api/v1/subject-offerings")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "admin",
    }
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.clear()


def create_base_environment(db):
    level = AcademicLevel(level_name="Grade 11", grade_level=11)
    group = SubjectGroup(name="Sciences")
    db.add_all([level, group])
    db.commit()
    db.refresh(level)
    db.refresh(group)

    active_year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    past_year = AcademicYear(
        year_label="2024-2025",
        start_date=date(2024, 6, 1),
        end_date=date(2025, 3, 31),
        is_active=False,
    )
    db.add_all([active_year, past_year])
    db.commit()
    db.refresh(active_year)
    db.refresh(past_year)

    period = AcademicPeriod(
        period_name="Semester 1",
        period_type="SEMESTER",
        period_sequence=1,
        total_periods_in_year=2,
        period_progress_ratio=0.5,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 10, 31),
        academic_year_id=active_year.academic_year_id,
        is_active=True,
    )
    past_period = AcademicPeriod(
        period_name="Semester 1 (Past)",
        period_type="SEMESTER",
        period_sequence=1,
        total_periods_in_year=2,
        period_progress_ratio=0.5,
        start_date=date(2024, 6, 1),
        end_date=date(2024, 10, 31),
        academic_year_id=past_year.academic_year_id,
        is_active=False,
    )
    db.add_all([period, past_period])
    db.commit()
    db.refresh(period)
    db.refresh(past_period)

    cls = Class(
        section_name="STEM 11-Einstein",
        class_status="active",
        academic_year_id=active_year.academic_year_id,
        academic_level_id=level.academic_level_id,
        academic_period_id=period.academic_period_id,
    )
    db.add(cls)
    db.commit()
    db.refresh(cls)

    return {
        "level": level,
        "group": group,
        "active_year": active_year,
        "past_year": past_year,
        "period": period,
        "past_period": past_period,
        "class": cls,
    }


def test_archive_catalog_subject_unassigned_succeeds(db, client):
    env = create_base_environment(db)
    subj = Subject(
        subject_name="Astronomy Elective",
        subject_codename="ASTRO11",
        subject_group_id=env["group"].subject_group_id,
        academic_level_id=env["level"].academic_level_id,
        status="active",
    )
    db.add(subj)
    db.commit()
    db.refresh(subj)

    res = client.patch(f"/api/v1/subjects/{subj.subject_id}/archive")
    assert res.status_code == 200
    assert res.json()["status"] == "archived"


def test_archive_catalog_subject_blocked_by_active_offering(db, client):
    env = create_base_environment(db)
    subj = Subject(
        subject_name="General Chemistry 1",
        subject_codename="GENCHEM1",
        subject_group_id=env["group"].subject_group_id,
        academic_level_id=env["level"].academic_level_id,
        status="active",
    )
    db.add(subj)
    db.commit()
    db.refresh(subj)

    offering = SubjectOffering(
        subject_id=subj.subject_id,
        academic_year_id=env["active_year"].academic_year_id,
        academic_level_id=env["level"].academic_level_id,
        academic_period_id=env["period"].academic_period_id,
        status="active",
    )
    db.add(offering)
    db.commit()

    # Attempt archival via API route
    res = client.patch(f"/api/v1/subjects/{subj.subject_id}/archive")
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert "General Chemistry 1" in detail
    assert "2025-2026" in detail
    assert "active curriculum offerings" in detail

    # Attempt archival via update payload
    with pytest.raises(HTTPException) as exc_info:
        update_subject_record(db, subj.subject_id, SubjectUpdate(status="archived"))
    assert exc_info.value.status_code == 409
    assert "active curriculum offerings" in exc_info.value.detail


def test_archive_catalog_subject_blocked_by_active_schedule(db, client):
    env = create_base_environment(db)
    subj = Subject(
        subject_name="General Biology 1",
        subject_codename="GENBIO1",
        subject_group_id=env["group"].subject_group_id,
        academic_level_id=env["level"].academic_level_id,
        status="active",
    )
    db.add(subj)
    db.commit()
    db.refresh(subj)

    # Active SubjectLoad assigned to a class
    load = SubjectLoad(
        subject_id=subj.subject_id,
        class_id=env["class"].class_id,
        academic_period_id=env["period"].academic_period_id,
        is_active_version=True,
        status="published",
    )
    db.add(load)
    db.commit()

    res = client.patch(f"/api/v1/subjects/{subj.subject_id}/archive")
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert "General Biology 1" in detail
    assert "STEM 11-Einstein" in detail
    assert "2025-2026" in detail
    assert "active class schedules" in detail


def test_archive_catalog_subject_allowed_for_past_school_year(db, client):
    env = create_base_environment(db)
    subj = Subject(
        subject_name="Old DepEd Curriculum Subject",
        subject_codename="OLDDEPED",
        subject_group_id=env["group"].subject_group_id,
        academic_level_id=env["level"].academic_level_id,
        status="active",
    )
    db.add(subj)
    db.commit()
    db.refresh(subj)

    # Offering exists only in the past/inactive academic year
    offering = SubjectOffering(
        subject_id=subj.subject_id,
        academic_year_id=env["past_year"].academic_year_id,
        academic_level_id=env["level"].academic_level_id,
        academic_period_id=env["past_period"].academic_period_id,
        status="active",
    )
    db.add(offering)
    db.commit()

    # Archiving should succeed because past school year doesn't block catalog retirement
    res = client.patch(f"/api/v1/subjects/{subj.subject_id}/archive")
    assert res.status_code == 200
    assert res.json()["status"] == "archived"


def test_archive_subject_offering_blocked_by_active_schedule(db, client):
    env = create_base_environment(db)
    subj = Subject(
        subject_name="Pre-Calculus",
        subject_codename="PRECALC",
        subject_group_id=env["group"].subject_group_id,
        academic_level_id=env["level"].academic_level_id,
        status="active",
    )
    db.add(subj)
    db.commit()
    db.refresh(subj)

    offering = SubjectOffering(
        subject_id=subj.subject_id,
        academic_year_id=env["active_year"].academic_year_id,
        academic_level_id=env["level"].academic_level_id,
        academic_period_id=env["period"].academic_period_id,
        status="active",
    )
    db.add(offering)
    db.commit()
    db.refresh(offering)

    load = SubjectLoad(
        subject_id=subj.subject_id,
        class_id=env["class"].class_id,
        academic_period_id=env["period"].academic_period_id,
        is_active_version=True,
        status="active",
    )
    db.add(load)
    db.commit()

    # Attempt archival via API route
    res = client.patch(f"/api/v1/subject-offerings/{offering.subject_offering_id}/archive")
    assert res.status_code == 409
    detail = res.json()["detail"]
    assert "STEM 11-Einstein" in detail
    assert "Semester 1" in detail
    assert "actively scheduled" in detail

    # Attempt archival via update payload
    with pytest.raises(HTTPException) as exc_info:
        update_subject_offering_record(db, offering.subject_offering_id, SubjectOfferingUpdate(status="archived"))
    assert exc_info.value.status_code == 409
    assert "actively scheduled" in exc_info.value.detail


def test_archive_subject_offering_unscheduled_succeeds(db, client):
    env = create_base_environment(db)
    subj = Subject(
        subject_name="Basic Calculus",
        subject_codename="BASICCALC",
        subject_group_id=env["group"].subject_group_id,
        academic_level_id=env["level"].academic_level_id,
        status="active",
    )
    db.add(subj)
    db.commit()
    db.refresh(subj)

    offering = SubjectOffering(
        subject_id=subj.subject_id,
        academic_year_id=env["active_year"].academic_year_id,
        academic_level_id=env["level"].academic_level_id,
        academic_period_id=env["period"].academic_period_id,
        status="active",
    )
    db.add(offering)
    db.commit()
    db.refresh(offering)

    res = client.patch(f"/api/v1/subject-offerings/{offering.subject_offering_id}/archive")
    assert res.status_code == 200
    assert res.json()["status"] == "archived"

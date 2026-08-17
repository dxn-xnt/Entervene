from datetime import date
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
from app.db.Session import get_db
from app.main import app
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Subject import Subject
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.academic.AcademicPathway import AcademicPathway
from app.models.academic.DepedCluster import DepedCluster
from app.models.academic.SubjectOfferingPathway import SubjectOfferingPathway
from app.models.academic.AcademicLevelPathwayScope import AcademicLevelPathwayScope
from app.services.pathways.PathwayScopeService import (
    clone_prior_year_pathway_scopes,
    resolve_pathway_scope,
)


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    AcademicPeriod.__table__,
    Subject.__table__,
    SubjectOffering.__table__,
    AcademicPathway.__table__,
    DepedCluster.__table__,
    SubjectOfferingPathway.__table__,
    AcademicLevelPathwayScope.__table__,
]


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine, tables=TABLES)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
        engine.dispose()


@pytest.fixture
def client(db):
    def _override_db():
        try:
            yield db
        finally:
            pass

    from app.core.Dependencies import get_current_user
    app.dependency_overrides[get_db] = _override_db
    app.dependency_overrides[get_current_user] = lambda: {"sub": "100", "role": "admin"}
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def admin_headers():
    return {
        "X-Test-User-Id": "100",
        "X-Test-User-Role": "admin",
    }


def test_pathway_scope_year_isolation_and_upsert(client, db, admin_headers):
    year1 = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    year2 = AcademicYear(
        year_label="2027-2028",
        start_date=date(2027, 6, 1),
        end_date=date(2028, 3, 31),
        is_active=False,
    )
    db.add_all([year1, year2])
    db.commit()

    g11 = AcademicLevel(level_name="Grade 11", grade_level=11)
    g12 = AcademicLevel(level_name="Grade 12", grade_level=12)
    db.add_all([g11, g12])
    db.commit()

    # Initial scope for SY 2026-2027: G11 = True, G12 = False
    scope1 = AcademicLevelPathwayScope(
        academic_year_id=year1.academic_year_id,
        academic_level_id=g12.academic_level_id,
        requires_pathway=False,
    )
    db.add(scope1)
    db.commit()

    # SY 2026-2027 Grade 12 resolves to False
    assert resolve_pathway_scope(db, year1.academic_year_id, g12.academic_level_id) is False

    # Admin enables Grade 12 pathway requirement for SY 2027-2028 ONLY via PATCH upsert
    res = client.patch(
        "/api/v1/pathways/scopes",
        headers=admin_headers,
        json={
            "academic_year_id": year2.academic_year_id,
            "scopes": [
                {"academic_level_id": g12.academic_level_id, "requires_pathway": True}
            ],
        },
    )
    assert res.status_code == 200

    # SY 2027-2028 Grade 12 resolves to True
    assert resolve_pathway_scope(db, year2.academic_year_id, g12.academic_level_id) is True

    # SY 2026-2027 Grade 12 STILL resolves to False (Year Isolation Guaranteed!)
    assert resolve_pathway_scope(db, year1.academic_year_id, g12.academic_level_id) is False


def test_future_academic_year_inherits_prior_scope(db):
    year1 = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    year2 = AcademicYear(
        year_label="2027-2028",
        start_date=date(2027, 6, 1),
        end_date=date(2028, 3, 31),
        is_active=False,
    )
    year3 = AcademicYear(
        year_label="2028-2029",
        start_date=date(2028, 6, 1),
        end_date=date(2029, 3, 31),
        is_active=False,
    )
    db.add_all([year1, year2, year3])
    db.commit()

    g12 = AcademicLevel(level_name="Grade 12", grade_level=12)
    db.add(g12)
    db.commit()

    # SY 2027-2028 gets explicit Grade 12 = True
    scope2 = AcademicLevelPathwayScope(
        academic_year_id=year2.academic_year_id,
        academic_level_id=g12.academic_level_id,
        requires_pathway=True,
    )
    db.add(scope2)
    db.commit()

    # SY 2028-2029 has NO scope row created yet, but lazy fallback inherits SY 2027-2028 Grade 12 = True!
    assert resolve_pathway_scope(db, year3.academic_year_id, g12.academic_level_id) is True


def test_copy_academic_year_clones_scopes(db):
    year1 = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    year2 = AcademicYear(
        year_label="2027-2028",
        start_date=date(2027, 6, 1),
        end_date=date(2028, 3, 31),
        is_active=False,
    )
    db.add_all([year1, year2])
    db.commit()

    g11 = AcademicLevel(level_name="Grade 11", grade_level=11)
    g12 = AcademicLevel(level_name="Grade 12", grade_level=12)
    db.add_all([g11, g12])
    db.commit()

    # Explicit scope in year 1
    scope1 = AcademicLevelPathwayScope(
        academic_year_id=year1.academic_year_id,
        academic_level_id=g11.academic_level_id,
        requires_pathway=True,
    )
    db.add(scope1)
    db.commit()

    # Clone scopes into year 2
    cloned_count = clone_prior_year_pathway_scopes(db, year2.academic_year_id)
    assert cloned_count == 2

    scopes_y2 = (
        db.query(AcademicLevelPathwayScope)
        .filter(AcademicLevelPathwayScope.academic_year_id == year2.academic_year_id)
        .all()
    )
    assert len(scopes_y2) == 2

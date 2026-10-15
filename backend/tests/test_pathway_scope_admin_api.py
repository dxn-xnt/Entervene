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
from app.models.academic.Class_ import Class
from app.services.classes.ClassService import _resolve_class_pathway_id
from fastapi import HTTPException
import importlib
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


def test_shs_pathway_assignments_and_subject_load_data_follow_year_scope(client, db, admin_headers, monkeypatch):
    year1 = AcademicYear(year_label="2026-2027", start_date=date(2026, 6, 1), end_date=date(2027, 3, 31), is_active=True)
    year2 = AcademicYear(year_label="2027-2028", start_date=date(2027, 6, 1), end_date=date(2028, 3, 31), is_active=False)
    grade11 = AcademicLevel(level_name="Grade 11", grade_level=11)
    grade12 = AcademicLevel(level_name="Grade 12", grade_level=12)
    medical = AcademicPathway(code="medical-courses", name="Medical Courses and Sciences Related", is_enabled=True)
    engineering = AcademicPathway(code="engineering-math", name="Engineering and Mathematics Related", is_enabled=True)
    db.add_all([year1, year2, grade11, grade12, medical, engineering])
    db.flush()
    term1 = AcademicPeriod(academic_year_id=year1.academic_year_id, period_name="Term 1", period_sequence=1,
                           start_date=date(2026, 6, 1), end_date=date(2026, 8, 31), is_active=True)
    term2 = AcademicPeriod(academic_year_id=year2.academic_year_id, period_name="Term 1", period_sequence=1,
                           start_date=date(2027, 6, 1), end_date=date(2027, 8, 31), is_active=False)
    db.add_all([term1, term2])
    db.add_all([
        AcademicLevelPathwayScope(academic_year_id=year1.academic_year_id, academic_level_id=grade11.academic_level_id, requires_pathway=True),
        AcademicLevelPathwayScope(academic_year_id=year1.academic_year_id, academic_level_id=grade12.academic_level_id, requires_pathway=False),
        AcademicLevelPathwayScope(academic_year_id=year2.academic_year_id, academic_level_id=grade12.academic_level_id, requires_pathway=True),
    ])
    zara = Class(section_name="Zara", class_status="active", academic_year_id=year1.academic_year_id,
                 academic_level_id=grade11.academic_level_id, pathway_id=medical.id)
    campos = Class(section_name="Campos", class_status="active", academic_year_id=year1.academic_year_id,
                   academic_level_id=grade11.academic_level_id, pathway_id=engineering.id)
    future = Class(section_name="Future", class_status="active", academic_year_id=year2.academic_year_id,
                   academic_level_id=grade12.academic_level_id, pathway_id=engineering.id)
    db.add_all([zara, campos, future])
    db.commit()

    listing = client.get("/api/v1/classes", headers=admin_headers)
    assert listing.status_code == 200, listing.text
    class_rows = {row["section_name"]: row for row in listing.json()["classes"]}
    assert class_rows["Zara"]["pathway"]["name"] == medical.name
    assert class_rows["Campos"]["pathway"]["name"] == engineering.name
    assert class_rows["Zara"]["academic_level"]["requires_pathway"] is True
    detail = client.get(f"/api/v1/classes/{future.class_id}", headers=admin_headers)
    assert detail.status_code == 200, detail.text
    assert detail.json()["academic_level"]["requires_pathway"] is True
    transfers = client.get(f"/api/v1/classes/{zara.class_id}/transfer-options", headers=admin_headers)
    assert transfers.status_code == 200, transfers.text
    assert [(item["section_name"], item["pathway_name"]) for item in transfers.json()["available_sections"]] == [
        ("Campos", engineering.name)
    ]

    subject_load_route = importlib.import_module("app.api.v1.routes.SubjectLoads")
    monkeypatch.setattr(subject_load_route, "ensure_default_period_templates", lambda _db: None)
    monkeypatch.setattr(subject_load_route, "ensure_shs_template_groups_backfilled", lambda _db: None)
    first_term = client.get("/api/v1/subject-loads/studio-data", params={"academic_period_id": term1.academic_period_id}, headers=admin_headers)
    assert first_term.status_code == 200, first_term.text
    first_classes = {row["section_name"]: row for row in first_term.json()["classes"]}
    assert set(first_classes) == {"Zara", "Campos"}
    assert (first_classes["Zara"]["pathway_id"], first_classes["Zara"]["pathway_name"]) == (medical.id, medical.name)
    assert (first_classes["Campos"]["pathway_id"], first_classes["Campos"]["pathway_name"]) == (engineering.id, engineering.name)
    future_term = client.get("/api/v1/subject-loads/studio-data", params={"academic_period_id": term2.academic_period_id}, headers=admin_headers)
    assert future_term.status_code == 200, future_term.text
    assert [row["section_name"] for row in future_term.json()["classes"]] == ["Future"]

    medical.is_enabled = False
    db.commit()
    disabled = client.get("/api/v1/subject-loads/studio-data", params={"academic_period_id": term1.academic_period_id}, headers=admin_headers)
    disabled_zara = next(row for row in disabled.json()["classes"] if row["section_name"] == "Zara")
    assert (disabled_zara["pathway_id"], disabled_zara["pathway_name"], disabled_zara["pathway_is_enabled"]) == (medical.id, medical.name, False)
    assert db.query(Class).filter(Class.class_id == zara.class_id).one().pathway_id == medical.id
    invalid_edit = client.patch(
        f"/api/v1/classes/{campos.class_id}", json={"pathway_id": medical.id}, headers=admin_headers,
    )
    assert invalid_edit.status_code == 422
    db.refresh(campos)
    assert campos.pathway_id == engineering.id


def test_class_pathway_assignment_rejects_disabled_and_out_of_scope_values(db):
    year = AcademicYear(year_label="2026-2027", start_date=date(2026, 6, 1), end_date=date(2027, 3, 31), is_active=True)
    grade11 = AcademicLevel(level_name="Grade 11", grade_level=11)
    grade12 = AcademicLevel(level_name="Grade 12", grade_level=12)
    enabled = AcademicPathway(code="medical-courses", name="Medical", is_enabled=True)
    disabled = AcademicPathway(code="engineering-math", name="Engineering", is_enabled=False)
    db.add_all([year, grade11, grade12, enabled, disabled])
    db.flush()
    db.add_all([
        AcademicLevelPathwayScope(academic_year_id=year.academic_year_id, academic_level_id=grade11.academic_level_id, requires_pathway=True),
        AcademicLevelPathwayScope(academic_year_id=year.academic_year_id, academic_level_id=grade12.academic_level_id, requires_pathway=False),
    ])
    db.commit()
    assert _resolve_class_pathway_id(db, pathway_id=enabled.id, academic_year_id=year.academic_year_id, academic_level_id=grade11.academic_level_id) == enabled.id
    for pathway_id, level_id in [(disabled.id, grade11.academic_level_id), (enabled.id, grade12.academic_level_id), (None, grade11.academic_level_id)]:
        with pytest.raises(HTTPException) as error:
            _resolve_class_pathway_id(db, pathway_id=pathway_id, academic_year_id=year.academic_year_id, academic_level_id=level_id)
        assert error.value.status_code == 422
    assert _resolve_class_pathway_id(db, academic_year_id=year.academic_year_id, academic_level_id=grade12.academic_level_id) is None

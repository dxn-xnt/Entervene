import uuid
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.SubjectOfferings import router as subject_offerings_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Subject import Subject
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.academic.AcademicPathway import AcademicPathway
from app.models.academic.DepedCluster import DepedCluster
from app.models.academic.SubjectOfferingPathway import SubjectOfferingPathway
from app.models.academic.AcademicLevelPathwayScope import AcademicLevelPathwayScope

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

READ_ONLY_DETAIL = "Subject offerings for inactive academic years are read-only to protect historical records."


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
    test_app = FastAPI()
    test_app.include_router(subject_offerings_router, prefix="/api/v1/subject-offerings")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "admin",
    }
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.clear()


@pytest.fixture
def offering_context(db):
    year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    other_year = AcademicYear(
        year_label="2027-2028",
        start_date=date(2027, 6, 1),
        end_date=date(2028, 3, 31),
        is_active=False,
    )
    grade_7 = AcademicLevel(level_name="Grade 7", grade_level=7)
    grade_11 = AcademicLevel(level_name="Grade 11", grade_level=11)
    grade_12 = AcademicLevel(level_name="Grade 12", grade_level=12)
    med_pathway = AcademicPathway(code="medical-courses", name="Medical Courses", is_enabled=True)
    eng_pathway = AcademicPathway(code="engineering-math", name="Engineering & Math", is_enabled=True)
    db.add_all([year, other_year, grade_7, grade_11, grade_12, med_pathway, eng_pathway])
    db.flush()

    term_1 = AcademicPeriod(
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        start_date=date(2026, 6, 1),
        end_date=date(2026, 8, 31),
        is_active=True,
        academic_year_id=year.academic_year_id,
    )
    term_2 = AcademicPeriod(
        period_name="Term 2",
        period_type="TERM",
        period_sequence=2,
        total_periods_in_year=3,
        start_date=date(2026, 9, 1),
        end_date=date(2026, 11, 30),
        is_active=False,
        academic_year_id=year.academic_year_id,
    )
    other_year_term = AcademicPeriod(
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        start_date=date(2027, 6, 1),
        end_date=date(2027, 8, 31),
        is_active=False,
        academic_year_id=other_year.academic_year_id,
    )
    db.add_all([term_1, term_2, other_year_term])
    db.flush()

    biology = Subject(
        subject_name="General Biology 1",
        subject_codename="GENBIO1",
        subject_group="Specialized",
        hours=80,
        default_grading_template="Default SHS",
        status="active",
        academic_level_id=grade_11.academic_level_id,
    )
    math_7 = Subject(
        subject_name="Mathematics 7",
        subject_codename="MATH7",
        subject_group="Core",
        hours=80,
        default_grading_template="Default JHS",
        status="active",
        academic_level_id=grade_7.academic_level_id,
    )
    precal = Subject(
        subject_name="Pre-Calculus",
        subject_codename="PRECAL",
        subject_group="Core",
        hours=80,
        default_grading_template="Default SHS",
        status="active",
        academic_level_id=grade_11.academic_level_id,
    )
    archived_subject = Subject(
        subject_name="Old STEM Subject",
        subject_codename="OLDSTEM",
        status="archived",
        academic_level_id=grade_11.academic_level_id,
    )
    grade_12_subject = Subject(
        subject_name="General Biology 2",
        subject_codename="GENBIO2",
        status="active",
        academic_level_id=grade_12.academic_level_id,
    )
    genmath = Subject(
        subject_name="General Mathematics",
        subject_codename="GENMATH",
        subject_group="Core",
        is_core=True,
        hours=80,
        status="active",
        academic_level_id=grade_11.academic_level_id,
    )
    db.add_all([math_7, biology, precal, archived_subject, grade_12_subject, genmath])
    db.commit()
    return {
        "year": year,
        "other_year": other_year,
        "grade_7": grade_7,
        "grade_11": grade_11,
        "grade_12": grade_12,
        "term_1": term_1,
        "term_2": term_2,
        "other_year_term": other_year_term,
        "math_7": math_7,
        "biology": biology,
        "precal": precal,
        "genmath": genmath,
        "archived_subject": archived_subject,
        "grade_12_subject": grade_12_subject,
    }


def offering_payload(ctx, **overrides):
    payload = {
        "subject_id": ctx["biology"].subject_id,
        "academic_year_id": ctx["year"].academic_year_id,
        "academic_level_id": ctx["grade_11"].academic_level_id,
        "academic_period_id": ctx["term_1"].academic_period_id,
        "pathway": "stem_medical",
    }
    payload.update(overrides)
    return payload


def create_offering(db, ctx, **overrides):
    values = offering_payload(ctx, **overrides)
    offering = SubjectOffering(
        subject_id=values["subject_id"],
        academic_year_id=values["academic_year_id"],
        academic_level_id=values["academic_level_id"],
        academic_period_id=values["academic_period_id"],
        status=values.get("status", "active"),
    )
    db.add(offering)
    db.flush()

    from app.services.subject_offerings.SubjectOfferingService import _resolve_pathway_ids
    academic_level = db.query(AcademicLevel).filter(AcademicLevel.academic_level_id == values["academic_level_id"]).first()
    subject = db.query(Subject).filter(Subject.subject_id == values["subject_id"]).first()
    pathway_ids = values.get("pathway_ids")
    legacy_pathway = values.get("pathway")
    resolved_pathway_ids = _resolve_pathway_ids(
        db,
        pathway_ids=pathway_ids,
        legacy_pathway=legacy_pathway,
        academic_level=academic_level,
        academic_year_id=values["academic_year_id"],
        subject=subject,
    )
    for pid in resolved_pathway_ids:
        db.add(SubjectOfferingPathway(subject_offering_id=offering.subject_offering_id, pathway_id=pid))
    db.flush()
    return offering



def copy_academic_year_payload(ctx, **overrides):
    payload = {
        "source_academic_year_id": ctx["other_year"].academic_year_id,
        "target_academic_year_id": ctx["year"].academic_year_id,
        "overwrite_existing": False,
    }
    payload.update(overrides)
    return payload


def test_form_options_returns_usable_data(client, offering_context):
    response = client.get("/api/v1/subject-offerings/form-options")

    assert response.status_code == 200
    body = response.json()
    assert [level["grade_level"] for level in body["academic_levels"]] == [7, 11, 12]
    assert {p["code"] for p in body["pathways"]} == {"medical-courses", "engineering-math"}
    assert body["statuses"] == ["active", "archived"]
    assert body["default_status"] == "active"
    assert {subject["subject_codename"] for subject in body["active_subjects"]} == {"MATH7", "GENBIO1", "PRECAL", "GENBIO2", "GENMATH"}
    assert {period["period_name"] for period in body["academic_periods"]} == {"Term 1", "Term 2"}


def test_create_offering_works(client, db, offering_context):
    response = client.post("/api/v1/subject-offerings", json=offering_payload(offering_context))

    assert response.status_code == 201
    body = response.json()
    assert body["subject"]["subject_codename"] == "GENBIO1"
    assert body["academic_year"]["year_label"] == "2026-2027"
    assert body["academic_level"]["grade_level"] == 11
    assert body["academic_period"]["period_name"] == "Term 1"
    assert body["pathway"] == "stem_medical"
    assert body["status"] == "active"
    assert db.query(SubjectOffering).count() == 1


def test_copy_source_inactive_year_to_active_target_year_succeeds(client, db, offering_context):
    ctx = offering_context
    source_offering = create_offering(
        db,
        ctx,
        academic_year_id=ctx["other_year"].academic_year_id,
        academic_period_id=ctx["other_year_term"].academic_period_id,
        status="archived",
    )
    db.commit()

    response = client.post("/api/v1/subject-offerings/copy-academic-year", json=copy_academic_year_payload(ctx))

    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 1
    assert body["updated_count"] == 0
    assert body["skipped_count"] == 0
    copied = (
        db.query(SubjectOffering)
        .filter(
            SubjectOffering.subject_offering_id != source_offering.subject_offering_id,
            SubjectOffering.academic_year_id == ctx["year"].academic_year_id,
        )
        .one()
    )
    assert copied.subject_id == source_offering.subject_id
    assert copied.academic_level_id == source_offering.academic_level_id
    assert copied.academic_period_id == ctx["term_1"].academic_period_id
    assert copied.academic_period_id != ctx["other_year_term"].academic_period_id
    from app.services.subject_offerings.SubjectOfferingShared import get_offering_legacy_pathway
    assert get_offering_legacy_pathway(copied) == get_offering_legacy_pathway(source_offering)
    assert copied.status == "archived"


def test_copy_to_inactive_target_year_fails(client, db, offering_context):
    ctx = offering_context
    create_offering(db, ctx)
    db.commit()

    response = client.post(
        "/api/v1/subject-offerings/copy-academic-year",
        json=copy_academic_year_payload(
            ctx,
            source_academic_year_id=ctx["year"].academic_year_id,
            target_academic_year_id=ctx["other_year"].academic_year_id,
        ),
    )

    assert response.status_code == 409
    assert response.json()["detail"] == READ_ONLY_DETAIL


def test_copy_same_source_and_target_year_fails(client, offering_context):
    ctx = offering_context

    response = client.post(
        "/api/v1/subject-offerings/copy-academic-year",
        json=copy_academic_year_payload(
            ctx,
            source_academic_year_id=ctx["year"].academic_year_id,
            target_academic_year_id=ctx["year"].academic_year_id,
        ),
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "Source and target academic years must be different."


def test_copy_skips_duplicate_target_offerings_without_overwrite(client, db, offering_context):
    ctx = offering_context
    create_offering(
        db,
        ctx,
        academic_year_id=ctx["other_year"].academic_year_id,
        academic_period_id=ctx["other_year_term"].academic_period_id,
    )
    create_offering(db, ctx)
    db.commit()

    response = client.post("/api/v1/subject-offerings/copy-academic-year", json=copy_academic_year_payload(ctx))

    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 0
    assert body["updated_count"] == 0
    assert body["skipped_count"] == 1
    assert body["skipped"][0]["reason"] == "Duplicate target subject offering already exists."
    assert db.query(SubjectOffering).count() == 2


def test_copy_overwrites_exact_existing_target_offerings_when_requested(client, db, offering_context):
    ctx = offering_context
    create_offering(
        db,
        ctx,
        academic_year_id=ctx["other_year"].academic_year_id,
        academic_period_id=ctx["other_year_term"].academic_period_id,
        status="archived",
    )
    target = create_offering(db, ctx, status="active")
    db.commit()

    response = client.post(
        "/api/v1/subject-offerings/copy-academic-year",
        json=copy_academic_year_payload(ctx, overwrite_existing=True),
    )

    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 0
    assert body["updated_count"] == 1
    assert body["skipped_count"] == 0
    db.refresh(target)
    assert target.status == "archived"


def test_copy_skips_missing_target_period_sequence(client, db, offering_context):
    ctx = offering_context
    source_term_3 = AcademicPeriod(
        period_name="Term 3",
        period_type="TERM",
        period_sequence=3,
        total_periods_in_year=3,
        start_date=date(2028, 1, 1),
        end_date=date(2028, 3, 31),
        is_active=False,
        academic_year_id=ctx["other_year"].academic_year_id,
    )
    db.add(source_term_3)
    db.flush()
    create_offering(
        db,
        ctx,
        academic_year_id=ctx["other_year"].academic_year_id,
        academic_period_id=source_term_3.academic_period_id,
    )
    db.commit()

    response = client.post("/api/v1/subject-offerings/copy-academic-year", json=copy_academic_year_payload(ctx))

    assert response.status_code == 200
    body = response.json()
    assert body["created_count"] == 0
    assert body["skipped_count"] == 1
    assert body["skipped"][0]["reason"] == "Matching target period not found for period_sequence 3."


def test_copy_only_creates_subject_offerings(client, db, offering_context):
    ctx = offering_context
    create_offering(
        db,
        ctx,
        academic_year_id=ctx["other_year"].academic_year_id,
        academic_period_id=ctx["other_year_term"].academic_period_id,
    )
    db.commit()
    subject_count = db.query(Subject).count()
    academic_year_count = db.query(AcademicYear).count()
    academic_period_count = db.query(AcademicPeriod).count()
    academic_level_count = db.query(AcademicLevel).count()

    response = client.post("/api/v1/subject-offerings/copy-academic-year", json=copy_academic_year_payload(ctx))

    assert response.status_code == 200
    assert response.json()["created_count"] == 1
    assert db.query(SubjectOffering).count() == 2
    assert db.query(Subject).count() == subject_count
    assert db.query(AcademicYear).count() == academic_year_count
    assert db.query(AcademicPeriod).count() == academic_period_count
    assert db.query(AcademicLevel).count() == academic_level_count


def test_active_target_future_terms_remain_editable_after_copy(client, db, offering_context):
    ctx = offering_context
    create_offering(
        db,
        ctx,
        academic_year_id=ctx["other_year"].academic_year_id,
        academic_period_id=ctx["other_year_term"].academic_period_id,
    )
    db.commit()

    copy_response = client.post("/api/v1/subject-offerings/copy-academic-year", json=copy_academic_year_payload(ctx))
    create_future_term = client.post(
        "/api/v1/subject-offerings",
        json=offering_payload(ctx, academic_period_id=ctx["term_2"].academic_period_id),
    )

    assert copy_response.status_code == 200
    assert create_future_term.status_code == 201
    assert create_future_term.json()["academic_period"]["period_name"] == "Term 2"


def test_create_offering_in_inactive_academic_year_fails(client, db, offering_context):
    ctx = offering_context

    response = client.post(
        "/api/v1/subject-offerings",
        json=offering_payload(
            ctx,
            academic_year_id=ctx["other_year"].academic_year_id,
            academic_period_id=ctx["other_year_term"].academic_period_id,
        ),
    )

    assert response.status_code == 409
    assert response.json()["detail"] == READ_ONLY_DETAIL
    assert db.query(SubjectOffering).count() == 0


def test_create_offering_for_future_term_in_active_academic_year_works(client, db, offering_context):
    response = client.post(
        "/api/v1/subject-offerings",
        json=offering_payload(offering_context, academic_period_id=offering_context["term_2"].academic_period_id),
    )

    assert response.status_code == 201
    assert response.json()["academic_period"]["period_name"] == "Term 2"
    assert db.query(SubjectOffering).count() == 1


def test_grade_7_to_10_requires_general_pathway(client, db, offering_context):
    ctx = offering_context

    valid = client.post(
        "/api/v1/subject-offerings",
        json=offering_payload(
            ctx,
            subject_id=ctx["math_7"].subject_id,
            academic_level_id=ctx["grade_7"].academic_level_id,
            pathway="general",
        ),
    )
    assert valid.status_code == 201
    assert valid.json()["pathway"] == "general"

    invalid = client.post(
        "/api/v1/subject-offerings",
        json=offering_payload(
            ctx,
            subject_id=ctx["math_7"].subject_id,
            academic_level_id=ctx["grade_7"].academic_level_id,
            pathway="stem_medical",
        ),
    )
    assert invalid.status_code == 422
    assert "must use the general pathway" in invalid.json()["detail"]


def test_grade_11_to_12_rejects_general_pathway(client, offering_context):
    response = client.post(
        "/api/v1/subject-offerings",
        json=offering_payload(offering_context, pathway="general"),
    )

    assert response.status_code == 422
    assert "require a specific pathway" in response.json()["detail"]


def test_create_validates_subject_year_level_period_scope(client, offering_context):
    ctx = offering_context

    archived_subject = client.post(
        "/api/v1/subject-offerings",
        json=offering_payload(ctx, subject_id=ctx["archived_subject"].subject_id),
    )
    assert archived_subject.status_code == 422

    wrong_year_period = client.post(
        "/api/v1/subject-offerings",
        json=offering_payload(ctx, academic_period_id=ctx["other_year_term"].academic_period_id),
    )
    assert wrong_year_period.status_code == 422

    wrong_level = client.post(
        "/api/v1/subject-offerings",
        json=offering_payload(ctx, academic_level_id=ctx["grade_12"].academic_level_id),
    )
    assert wrong_level.status_code == 422


def test_duplicate_offering_is_rejected(client, db, offering_context):
    create_offering(db, offering_context, pathway="stem_medical")
    db.commit()

    response = client.post("/api/v1/subject-offerings", json=offering_payload(offering_context, pathway="stem_medical"))

    assert response.status_code == 409
    assert "conflict" in response.json()["detail"].lower() or "already exists" in response.json()["detail"].lower()


def test_both_pathway_conflict_rules_work(client, db, offering_context):
    create_offering(db, offering_context, pathway="stem_medical")
    db.commit()

    shared_conflict = client.post("/api/v1/subject-offerings", json=offering_payload(offering_context, pathway="both"))
    assert shared_conflict.status_code == 409
    assert "conflict" in shared_conflict.json()["detail"].lower() or "already exists" in shared_conflict.json()["detail"].lower()

    db.query(SubjectOfferingPathway).delete()
    db.query(SubjectOffering).delete()
    db.commit()
    create_offering(db, offering_context, pathway="both")
    db.commit()

    medical_conflict = client.post("/api/v1/subject-offerings", json=offering_payload(offering_context, pathway="stem_medical"))
    assert medical_conflict.status_code == 409
    assert "conflict" in medical_conflict.json()["detail"].lower() or "already exists" in medical_conflict.json()["detail"].lower()



def test_list_offerings_and_search_work(client, db, offering_context):
    create_offering(db, offering_context, pathway="stem_medical")
    create_offering(
        db,
        offering_context,
        subject_id=offering_context["precal"].subject_id,
        pathway="both",
    )
    db.commit()

    response = client.get("/api/v1/subject-offerings?search=bio")

    assert response.status_code == 200
    body = response.json()
    assert body["summary"] == {"total_offerings": 2, "active_offerings": 2, "archived_offerings": 0}
    assert [item["subject"]["subject_codename"] for item in body["subject_offerings"]] == ["GENBIO1"]


def test_list_inactive_academic_year_offerings_still_works(client, db, offering_context):
    ctx = offering_context
    create_offering(
        db,
        ctx,
        academic_year_id=ctx["other_year"].academic_year_id,
        academic_period_id=ctx["other_year_term"].academic_period_id,
    )
    db.commit()

    response = client.get(f"/api/v1/subject-offerings?academic_year_id={ctx['other_year'].academic_year_id}")

    assert response.status_code == 200
    body = response.json()
    assert body["summary"]["total_offerings"] == 1
    assert body["subject_offerings"][0]["academic_year"]["is_active"] is False


def test_filters_work(client, db, offering_context):
    create_offering(db, offering_context, pathway="stem_medical")
    create_offering(
        db,
        offering_context,
        subject_id=offering_context["precal"].subject_id,
        academic_period_id=offering_context["term_2"].academic_period_id,
        pathway="both",
        status="archived",
    )
    db.commit()

    response = client.get(
        "/api/v1/subject-offerings"
        f"?academic_year_id={offering_context['year'].academic_year_id}"
        f"&academic_level_id={offering_context['grade_11'].academic_level_id}"
        f"&academic_period_id={offering_context['term_2'].academic_period_id}"
        "&pathway=both&status=archived"
    )

    assert response.status_code == 200
    assert [item["subject"]["subject_codename"] for item in response.json()["subject_offerings"]] == ["PRECAL"]


def test_get_subject_offering_detail(client, db, offering_context):
    offering = create_offering(db, offering_context)
    db.commit()

    response = client.get(f"/api/v1/subject-offerings/{offering.subject_offering_id}")

    assert response.status_code == 200
    assert response.json()["subject_offering_id"] == offering.subject_offering_id


def test_update_offering_works_and_revalidates_conflicts(client, db, offering_context):
    offering = create_offering(db, offering_context, pathway="stem_medical")
    create_offering(
        db,
        offering_context,
        subject_id=offering_context["precal"].subject_id,
        academic_period_id=offering_context["term_2"].academic_period_id,
        pathway="both",
    )
    db.commit()

    conflict = client.patch(
        f"/api/v1/subject-offerings/{offering.subject_offering_id}",
        json={
            "subject_id": offering_context["precal"].subject_id,
            "academic_period_id": offering_context["term_2"].academic_period_id,
            "pathway": "stem_engineering",
        },
    )
    assert conflict.status_code == 409

    response = client.patch(
        f"/api/v1/subject-offerings/{offering.subject_offering_id}",
        json={
            "academic_period_id": offering_context["term_2"].academic_period_id,
            "pathway": "stem_engineering",
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["academic_period"]["period_name"] == "Term 2"
    assert body["pathways"][0]["code"] == "engineering-math"


def test_update_offering_in_inactive_academic_year_fails(client, db, offering_context):
    ctx = offering_context
    offering = create_offering(
        db,
        ctx,
        academic_year_id=ctx["other_year"].academic_year_id,
        academic_period_id=ctx["other_year_term"].academic_period_id,
    )
    db.commit()

    response = client.patch(
        f"/api/v1/subject-offerings/{offering.subject_offering_id}",
        json={"pathway": "stem_engineering"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == READ_ONLY_DETAIL


def test_update_offering_to_inactive_academic_year_fails(client, db, offering_context):
    ctx = offering_context
    offering = create_offering(db, ctx)
    db.commit()

    response = client.patch(
        f"/api/v1/subject-offerings/{offering.subject_offering_id}",
        json={
            "academic_year_id": ctx["other_year"].academic_year_id,
            "academic_period_id": ctx["other_year_term"].academic_period_id,
        },
    )

    assert response.status_code == 409
    assert response.json()["detail"] == READ_ONLY_DETAIL


def test_archive_and_restore_offering_work(client, db, offering_context):
    offering = create_offering(db, offering_context)
    db.commit()

    archived = client.patch(f"/api/v1/subject-offerings/{offering.subject_offering_id}/archive")
    assert archived.status_code == 200
    assert archived.json()["status"] == "archived"

    restored = client.patch(f"/api/v1/subject-offerings/{offering.subject_offering_id}/restore")
    assert restored.status_code == 200
    assert restored.json()["status"] == "active"


def test_archive_and_restore_offering_in_inactive_academic_year_fail(client, db, offering_context):
    ctx = offering_context
    active_offering = create_offering(
        db,
        ctx,
        academic_year_id=ctx["other_year"].academic_year_id,
        academic_period_id=ctx["other_year_term"].academic_period_id,
    )
    archived_offering = create_offering(
        db,
        ctx,
        academic_year_id=ctx["other_year"].academic_year_id,
        academic_period_id=ctx["other_year_term"].academic_period_id,
        subject_id=ctx["precal"].subject_id,
        pathway="stem_engineering",
        status="archived",
    )
    db.commit()

    archived = client.patch(f"/api/v1/subject-offerings/{active_offering.subject_offering_id}/archive")
    restored = client.patch(f"/api/v1/subject-offerings/{archived_offering.subject_offering_id}/restore")

    assert archived.status_code == 409
    assert archived.json()["detail"] == READ_ONLY_DETAIL
    assert restored.status_code == 409
    assert restored.json()["detail"] == READ_ONLY_DETAIL


def test_non_admin_cannot_create_update_or_archive(client, db, offering_context):
    offering = create_offering(db, offering_context)
    db.commit()
    client.app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }

    assert client.post("/api/v1/subject-offerings", json=offering_payload(offering_context)).status_code == 403
    assert client.patch(f"/api/v1/subject-offerings/{offering.subject_offering_id}", json={"pathway": "both"}).status_code == 403
    assert client.patch(f"/api/v1/subject-offerings/{offering.subject_offering_id}/archive").status_code == 403

    del client.app.dependency_overrides[get_current_user]
    assert client.post("/api/v1/subject-offerings", json=offering_payload(offering_context)).status_code == 401


def test_is_core_subject_rejects_pathway_restrictions(client, db, offering_context):
    from app.models.academic.AcademicPathway import AcademicPathway
    from app.services.subject_offerings.SubjectOfferingShared import validate_core_subject_pathway_restriction

    ctx = offering_context
    pathway = AcademicPathway(code="medical", name="Medical")
    db.add(pathway)
    db.commit()

    core_subject = ctx["genmath"]
    core_subject.is_core = True
    db.commit()

    # Attempting to create an offering for an is_core=True subject with pathway_ids should fail with 422
    payload = offering_payload(ctx, subject_id=core_subject.subject_id)
    payload["pathway_ids"] = [pathway.id]
    res = client.post("/api/v1/subject-offerings", json=payload)
    assert res.status_code == 422
    assert "Core subjects are mandatory for all pathways" in res.json()["detail"]


def test_is_core_toggle_blocked_if_pathway_offering_exists(db, offering_context):
    from app.models.academic.AcademicPathway import AcademicPathway
    from app.models.academic.SubjectOfferingPathway import SubjectOfferingPathway
    from app.services.subject_offerings.SubjectOfferingShared import validate_subject_is_core_toggle

    ctx = offering_context
    pathway = AcademicPathway(code="engineering", name="Engineering")
    db.add(pathway)
    db.commit()

    offering = create_offering(db, ctx, subject_id=ctx["precal"].subject_id)
    db.add(SubjectOfferingPathway(subject_offering_id=offering.subject_offering_id, pathway_id=pathway.id))
    db.commit()

    # Toggling is_core=True on precal should raise 422 because it has pathway-restricted offerings
    with pytest.raises(Exception) as exc_info:
        validate_subject_is_core_toggle(db, ctx["precal"].subject_id, True)
    assert "Cannot mark subject as core" in str(exc_info.value)


def test_multi_pathway_join_offering_and_filtering(client, db, offering_context):
    from app.models.academic.AcademicPathway import AcademicPathway

    ctx = offering_context
    pathway1 = AcademicPathway(code="medical", name="Medical")
    pathway2 = AcademicPathway(code="engineering", name="Engineering")
    db.add_all([pathway1, pathway2])
    db.commit()

    payload = offering_payload(ctx, subject_id=ctx["precal"].subject_id)
    payload["pathway_ids"] = [pathway1.id, pathway2.id]
    res = client.post("/api/v1/subject-offerings", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert len(data["pathway_ids"]) == 2
    assert data["pathway"] == "both"

    # Filter by pathway_id=pathway1.id should include this offering
    list_res = client.get(f"/api/v1/subject-offerings?pathway_id={pathway1.id}")
    assert list_res.status_code == 200
    assert len(list_res.json()["subject_offerings"]) == 1


def test_grade11_section_query_returns_core_and_pathway_electives(client, db, offering_context):
    from app.models.academic.AcademicPathway import AcademicPathway

    ctx = offering_context
    pathway = AcademicPathway(code="medical", name="Medical")
    db.add(pathway)
    db.commit()

    # Core subject offering (pathway_ids=[])
    ctx["genmath"].is_core = True
    db.commit()
    core_offering_payload = offering_payload(ctx, subject_id=ctx["genmath"].subject_id)
    core_offering_payload["pathway_ids"] = []
    res1 = client.post("/api/v1/subject-offerings", json=core_offering_payload)
    assert res1.status_code == 201

    # Pathway elective offering (pathway_ids=[pathway.id])
    elective_payload = offering_payload(ctx, subject_id=ctx["biology"].subject_id)
    elective_payload["pathway_ids"] = [pathway.id]
    res2 = client.post("/api/v1/subject-offerings", json=elective_payload)
    assert res2.status_code == 201

    # Query for the medical pathway
    list_res = client.get(f"/api/v1/subject-offerings?pathway_id={pathway.id}")
    assert list_res.status_code == 200
    offerings = list_res.json()["subject_offerings"]
    subject_ids = {o["subject"]["subject_id"] for o in offerings}
    assert ctx["genmath"].subject_id in subject_ids
    assert ctx["biology"].subject_id in subject_ids

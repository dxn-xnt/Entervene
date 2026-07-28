import uuid
from datetime import date
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.main import app
from app.db.Base import Base
from app.db.Session import get_db
from app.core.Security import create_access_token
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.people.AcademicStaff import AcademicStaff
from app.models.auth.UserAccount import UserAccount


TABLES = [
    AcademicYear.__table__,
    AcademicPeriod.__table__,
    AcademicLevel.__table__,
    Class.__table__,
    Subject.__table__,
    SubjectOffering.__table__,
    AcademicStaff.__table__,
    SubjectLoad.__table__,
    UserAccount.__table__,
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
    
    def _override_get_db():
        try:
            yield session
        finally:
            pass

    app.dependency_overrides[get_db] = _override_get_db
    try:
        yield session
    finally:
        app.dependency_overrides.clear()
        session.close()
        Base.metadata.drop_all(bind=engine, tables=reversed(TABLES))
        engine.dispose()


def test_term_specific_subject_offering_studio_and_validation(db):
    # Setup test data
    admin_id = uuid.uuid4()
    admin_user = UserAccount(user_id=admin_id, email="admin_term@example.com", account_status="active")
    db.add(admin_user)
    db.commit()

    token = create_access_token(str(admin_id), "admin")

    year = AcademicYear(year_label="2025-2026", start_date=date(2025, 6, 1), end_date=date(2026, 3, 31), is_active=True)
    db.add(year)
    db.flush()

    term1 = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        period_progress_ratio=0.3333,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 9, 30),
        is_active=True,
    )
    term2 = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Term 2",
        period_type="TERM",
        period_sequence=2,
        total_periods_in_year=3,
        period_progress_ratio=0.6666,
        start_date=date(2025, 10, 1),
        end_date=date(2025, 12, 31),
        is_active=False,
    )
    db.add_all([term1, term2])
    db.flush()

    g11 = AcademicLevel(level_name="Grade 11", grade_level=11)
    db.add(g11)
    db.flush()

    stem_class = Class(
        section_name="11-STEM-A",
        academic_level_id=g11.academic_level_id,
        academic_year_id=year.academic_year_id,
        pathway="stem_medical",
        class_status="active",
    )
    db.add(stem_class)
    db.flush()

    gen_math = Subject(subject_name="General Mathematics", subject_codename="GENMATH", academic_level_id=g11.academic_level_id, status="active")
    stat_prob = Subject(subject_name="Statistics and Probability", subject_codename="STATPROB", academic_level_id=g11.academic_level_id, status="active")
    db.add_all([gen_math, stat_prob])
    db.flush()

    # Offer Gen Math in Term 1, Stat Prob in Term 2
    offering_t1 = SubjectOffering(
        subject_id=gen_math.subject_id,
        academic_year_id=year.academic_year_id,
        academic_level_id=g11.academic_level_id,
        academic_period_id=term1.academic_period_id,
        pathway="both",
        status="active",
    )
    offering_t2 = SubjectOffering(
        subject_id=stat_prob.subject_id,
        academic_year_id=year.academic_year_id,
        academic_level_id=g11.academic_level_id,
        academic_period_id=term2.academic_period_id,
        pathway="both",
        status="active",
    )
    db.add_all([offering_t1, offering_t2])
    db.flush()

    teacher = AcademicStaff(staff_id="STF1111", first_name="Maria", last_name="Santos", employment_status="active")
    db.add(teacher)
    db.commit()

    client = TestClient(app)

    # 1. Fetch studio data for Term 1
    res1 = client.get(
        f"/api/v1/subject-loads/studio-data?academic_period_id={term1.academic_period_id}",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res1.status_code == 200
    body1 = res1.json()
    assert "subject_offerings" in body1
    assert len(body1["subject_offerings"]) == 1
    assert body1["subject_offerings"][0]["subject_id"] == gen_math.subject_id

    # 2. Batch save load in Term 1 for Gen Math
    payload_t1 = {
        "academic_period_id": term1.academic_period_id,
        "academic_level_id": g11.academic_level_id,
        "action": "draft",
        "loads": [
            {
                "class_id": stem_class.class_id,
                "subject_id": gen_math.subject_id,
                "staff_id": teacher.staff_id,
                "academic_period_id": term1.academic_period_id,
                "start_time": "08:00",
                "end_time": "09:00",
                "days_of_week": ["MON", "WED"],
                "status": "draft",
            }
        ],
    }
    save_res = client.post(
        "/api/v1/subject-loads/batch-save",
        json=payload_t1,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert save_res.status_code == 200
    t1_load_id = db.query(SubjectLoad).filter(SubjectLoad.subject_id == gen_math.subject_id).first().subject_load_id

    # 3. Batch save in Term 2 linking to Term 1 via continued_from_load_id
    payload_t2 = {
        "academic_period_id": term2.academic_period_id,
        "academic_level_id": g11.academic_level_id,
        "action": "draft",
        "loads": [
            {
                "class_id": stem_class.class_id,
                "subject_id": stat_prob.subject_id,
                "staff_id": teacher.staff_id,
                "academic_period_id": term2.academic_period_id,
                "start_time": "08:00",
                "end_time": "09:00",
                "days_of_week": ["MON", "WED"],
                "status": "draft",
                "continued_from_load_id": t1_load_id,
            }
        ],
    }
    save_res2 = client.post(
        "/api/v1/subject-loads/batch-save",
        json=payload_t2,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert save_res2.status_code == 200
    t2_load = db.query(SubjectLoad).filter(SubjectLoad.subject_id == stat_prob.subject_id).first()
    assert t2_load.continued_from_load_id == t1_load_id

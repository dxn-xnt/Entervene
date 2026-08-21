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
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.people.AcademicStaff import AcademicStaff
from app.models.auth.UserAccount import UserAccount
from app.models.settings.Setting import Setting, SettingType
from app.models.academic.PeriodTemplate import PeriodTemplate
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.models.academic.SubjectGroup import SubjectGroup


TABLES = [
    Setting.__table__,
    AcademicYear.__table__,
    AcademicPeriod.__table__,
    AcademicLevel.__table__,
    Class.__table__,
    Subject.__table__,
    SubjectOffering.__table__,
    AcademicStaff.__table__,
    SubjectLoad.__table__,
    UserAccount.__table__,
    SubjectGroup.__table__,
    PeriodTemplate.__table__,
    PeriodTemplateSlot.__table__,
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
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_settings_public_endpoint(db):
    setting = Setting(
        key="school_name",
        value="Entervene High",
        type=SettingType.STRING,
        group="general",
        is_public=True,
        description="School Name",
    )
    db.add(setting)
    db.commit()

    client = TestClient(app)
    response = client.get("/api/v1/settings/public")
    assert response.status_code == 200
    data = response.json()
    assert "settings" in data
    assert data["settings"]["school_name"] == "Entervene High"


def test_subject_load_studio_data_endpoint(db):
    user_id_obj = uuid.uuid4()
    user_id_str = str(user_id_obj)
    admin_user = UserAccount(
        user_id=user_id_obj,
        email="admin_test@example.com",
        account_status="active",
    )
    db.add(admin_user)
    db.commit()

    token = create_access_token(user_id_str, "admin")

    year = AcademicYear(year_label="2025-2026", start_date=date(2025, 6, 1), end_date=date(2026, 3, 31), is_active=True)
    db.add(year)
    db.flush()

    period = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Term 1",
        period_sequence=1,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 9, 30),
        is_active=True,
    )
    db.add(period)
    db.flush()

    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add(level)
    db.flush()

    cls = Class(section_name="7-A", academic_level_id=level.academic_level_id, academic_year_id=year.academic_year_id, class_status="active")
    db.add(cls)
    db.flush()

    subject = Subject(subject_name="Mathematics 7", subject_codename="MATH7", academic_level_id=level.academic_level_id, status="active")
    db.add(subject)
    db.flush()

    staff = AcademicStaff(staff_id="STF9999", first_name="John", last_name="Doe", employment_status="active")
    db.add(staff)
    db.flush()

    load = SubjectLoad(
        staff_id=staff.staff_id,
        subject_id=subject.subject_id,
        class_id=cls.class_id,
        academic_period_id=period.academic_period_id,
        start_time="08:00",
        end_time="09:00",
        days_of_week=["MON", "WED"],
        status="draft",
    )
    db.add(load)
    db.commit()

    client = TestClient(app)
    response = client.get(
        f"/api/v1/subject-loads/studio-data?academic_period_id={period.academic_period_id}",
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    data = response.json()
    assert data["active_period_id"] == period.academic_period_id
    assert len(data["existing_loads"]) >= 1

    first_load = data["existing_loads"][0]
    assert first_load["start_time"] == "08:00"
    assert first_load["end_time"] == "09:00"
    assert first_load["days_of_week"] == ["MON", "WED"]


def test_batch_save_multi_slot_subject_loads(db):
    user_id_obj = uuid.uuid4()
    admin_user = UserAccount(user_id=user_id_obj, email="admin_multi@example.com", account_status="active")
    db.add(admin_user)
    db.commit()

    token = create_access_token(str(user_id_obj), "admin")

    year = AcademicYear(year_label="2025-2026", start_date=date(2025, 6, 1), end_date=date(2026, 3, 31), is_active=True)
    db.add(year)
    db.flush()

    period = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Term 1",
        period_sequence=1,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 9, 30),
        is_active=True,
    )
    db.add(period)
    db.flush()

    level = AcademicLevel(level_name="Grade 8", grade_level=8)
    db.add(level)
    db.flush()

    cls = Class(section_name="8-A", academic_level_id=level.academic_level_id, academic_year_id=year.academic_year_id, class_status="active")
    db.add(cls)
    db.flush()

    subject = Subject(subject_name="Mathematics 8", subject_codename="MATH8", hours=80, academic_level_id=level.academic_level_id, status="active")
    db.add(subject)
    db.flush()

    staff = AcademicStaff(staff_id="STF8888", first_name="Jane", last_name="Smith", employment_status="active")
    db.add(staff)
    db.commit()

    client = TestClient(app)

    # Batch save two split schedule slots for Math 8
    payload = {
        "academic_period_id": period.academic_period_id,
        "academic_level_id": level.academic_level_id,
        "action": "draft",
        "loads": [
            {
                "class_id": cls.class_id,
                "subject_id": subject.subject_id,
                "staff_id": staff.staff_id,
                "academic_period_id": period.academic_period_id,
                "start_time": "06:00",
                "end_time": "08:00",
                "days_of_week": ["MON", "TUE"],
                "status": "draft",
            },
            {
                "class_id": cls.class_id,
                "subject_id": subject.subject_id,
                "staff_id": staff.staff_id,
                "academic_period_id": period.academic_period_id,
                "start_time": "13:00",
                "end_time": "14:00",
                "days_of_week": ["THU"],
                "status": "draft",
            },
        ],
    }

    response = client.post(
        "/api/v1/subject-loads/batch-save",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )

    assert response.status_code == 200
    res_data = response.json()
    assert res_data["saved_count"] == 2

    # Verify both slots exist in DB
    db_loads = db.query(SubjectLoad).filter(
        SubjectLoad.class_id == cls.class_id,
        SubjectLoad.subject_id == subject.subject_id,
    ).all()
    assert len(db_loads) == 2


def test_publish_section_isolated_conflicts(db):
    user_id_obj = uuid.uuid4()
    admin_user = UserAccount(user_id=user_id_obj, email="admin_section_pub@example.com", account_status="active")
    db.add(admin_user)
    db.commit()

    token = create_access_token(str(user_id_obj), "admin")

    year = AcademicYear(year_label="2025-2026", start_date=date(2025, 6, 1), end_date=date(2026, 3, 31), is_active=True)
    db.add(year)
    db.flush()

    period = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Term 1",
        period_sequence=1,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 9, 30),
        is_active=True,
    )
    db.add(period)
    db.flush()

    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add(level)
    db.flush()

    cls1 = Class(section_name="7-Diamond", academic_level_id=level.academic_level_id, academic_year_id=year.academic_year_id, class_status="active")
    cls2 = Class(section_name="7-Sapphire", academic_level_id=level.academic_level_id, academic_year_id=year.academic_year_id, class_status="active")
    db.add_all([cls1, cls2])
    db.flush()

    sub1 = Subject(subject_name="Math 7", subject_codename="M7", hours=60, academic_level_id=level.academic_level_id, status="active")
    sub2 = Subject(subject_name="Science 7", subject_codename="S7", hours=60, academic_level_id=level.academic_level_id, status="active")
    db.add_all([sub1, sub2])
    db.flush()

    staff1 = AcademicStaff(staff_id="STF1001", first_name="John", last_name="Doe", employment_status="active")
    staff2 = AcademicStaff(staff_id="STF1002", first_name="Jane", last_name="Roe", employment_status="active")
    db.add_all([staff1, staff2])
    db.commit()

    client = TestClient(app)

    # Payload has Section 1 (cls1) completely valid, and Section 2 (cls2) has an overlap error
    payload = {
        "academic_period_id": period.academic_period_id,
        "academic_level_id": level.academic_level_id,
        "action": "publish",
        "publish_scope": "section",
        "target_class_id": cls1.class_id,
        "loads": [
            # Section 1 (clean)
            {
                "class_id": cls1.class_id,
                "subject_id": sub1.subject_id,
                "staff_id": staff1.staff_id,
                "academic_period_id": period.academic_period_id,
                "start_time": "08:00",
                "end_time": "09:00",
                "days_of_week": ["MON", "TUE", "WED", "THU", "FRI"],
                "status": "draft",
            },
            # Section 2 (overlapping same teacher/time in same class)
            {
                "class_id": cls2.class_id,
                "subject_id": sub1.subject_id,
                "staff_id": staff2.staff_id,
                "academic_period_id": period.academic_period_id,
                "start_time": "10:00",
                "end_time": "11:00",
                "days_of_week": ["MON"],
                "status": "draft",
            },
            {
                "class_id": cls2.class_id,
                "subject_id": sub2.subject_id,
                "staff_id": staff2.staff_id,
                "academic_period_id": period.academic_period_id,
                "start_time": "10:00",
                "end_time": "11:00",
                "days_of_week": ["MON"],
                "status": "draft",
            },
        ],
    }

    # Publishing Section 1 must succeed even though Section 2 has conflicts
    res = client.post(
        "/api/v1/subject-loads/batch-save",
        json=payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200

    # Verify Section 1 load is published and locked
    sl1 = db.query(SubjectLoad).filter(SubjectLoad.class_id == cls1.class_id).first()
    assert sl1.status == "published"
    assert sl1.is_locked is True

    # Verify Section 2 loads remained in draft
    sl2_loads = db.query(SubjectLoad).filter(SubjectLoad.class_id == cls2.class_id).all()
    for sl2 in sl2_loads:
        assert sl2.status == "draft"
        assert sl2.is_locked is False

    # Now test unlocking Section 1
    unlock_payload = {
        "academic_period_id": period.academic_period_id,
        "academic_level_id": level.academic_level_id,
        "action": "draft",
        "publish_scope": "section",
        "target_class_id": cls1.class_id,
        "loads": [
            {
                "subject_load_id": sl1.subject_load_id,
                "class_id": cls1.class_id,
                "subject_id": sub1.subject_id,
                "staff_id": staff1.staff_id,
                "academic_period_id": period.academic_period_id,
                "start_time": "08:00",
                "end_time": "09:00",
                "days_of_week": ["MON", "TUE", "WED", "THU", "FRI"],
                "status": "published",
            }
        ],
    }
    unlock_res = client.post(
        "/api/v1/subject-loads/batch-save",
        json=unlock_payload,
        headers={"Authorization": f"Bearer {token}"},
    )
    assert unlock_res.status_code == 200

    db.refresh(sl1)
    assert sl1.status == "draft"
    assert sl1.is_locked is False



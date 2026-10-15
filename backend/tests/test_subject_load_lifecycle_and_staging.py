import uuid
from datetime import date, timedelta
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.main import app
from app.db.Base import Base
from app.db.Session import get_db
from app.core.Security import create_access_token
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.academic.SubjectLoadAssignmentLog import SubjectLoadAssignmentLog
from app.models.attendance.Attendance import AttendanceRecord
from app.services.academic.SubjectLoadAuthorizationService import (
    SubjectLoadAuthorizationService,
    SubjectAccessLevel,
)
from app.services.academic.SubstitutionService import SubstitutionService


@pytest.fixture
def test_setup():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    Base.metadata.create_all(bind=engine)
    db = TestingSessionLocal()

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db

    # Create Admin User
    admin_id = uuid.uuid4()
    admin_user = UserAccount(user_id=admin_id, email="admin@entervene.test", account_status="active")
    db.add(admin_user)
    db.flush()

    admin_staff = AcademicStaff(
        staff_id="ADM001",
        user_id=admin_id,
        first_name="Admin",
        last_name="User",
        email="admin@entervene.test",
        employment_status="active",
    )
    db.add(admin_staff)

    # Create Academic Structure
    year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    db.add(year)
    db.flush()

    period = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Q1",
        period_sequence=1,
        start_date=date(2026, 6, 1),
        end_date=date(2026, 8, 31),
        is_active=True,
    )
    db.add(period)
    db.flush()

    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add(level)
    db.flush()

    cls = Class(
        section_name="Diamond",
        academic_level_id=level.academic_level_id,
        academic_year_id=year.academic_year_id,
        class_status="active",
    )
    db.add(cls)
    db.flush()

    math_sub = Subject(subject_name="Mathematics 7", subject_codename="M7", academic_level_id=level.academic_level_id, status="active")
    sci_sub = Subject(subject_name="Science 7", subject_codename="S7", academic_level_id=level.academic_level_id, status="active")
    db.add_all([math_sub, sci_sub])
    db.flush()

    # Teachers: Teacher A, Teacher B, Substitute Teacher C
    user_a_id = uuid.uuid4()
    user_b_id = uuid.uuid4()
    user_c_id = uuid.uuid4()

    db.add_all([
        UserAccount(user_id=user_a_id, email="teachera@entervene.test", account_status="active"),
        UserAccount(user_id=user_b_id, email="teacherb@entervene.test", account_status="active"),
        UserAccount(user_id=user_c_id, email="teacherc@entervene.test", account_status="active"),
    ])
    db.flush()

    staff_a = AcademicStaff(staff_id="TCH001", user_id=user_a_id, first_name="Alice", last_name="Teacher", email="teachera@entervene.test", employment_status="active")
    staff_b = AcademicStaff(staff_id="TCH002", user_id=user_b_id, first_name="Bob", last_name="Teacher", email="teacherb@entervene.test", employment_status="active")
    staff_c = AcademicStaff(staff_id="TCH003", user_id=user_c_id, first_name="Charlie", last_name="Substitute", email="teacherc@entervene.test", employment_status="active")
    db.add_all([staff_a, staff_b, staff_c])
    db.commit()

    token = create_access_token(str(admin_id), "admin")

    client = TestClient(app)

    yield {
        "db": db,
        "client": client,
        "token": token,
        "period": period,
        "level": level,
        "class": cls,
        "math_sub": math_sub,
        "sci_sub": sci_sub,
        "staff_a": staff_a,
        "staff_b": staff_b,
        "staff_c": staff_c,
    }

    app.dependency_overrides.clear()


def test_section_snapshot_and_idempotent_unlock(test_setup):
    db = test_setup["db"]
    client = test_setup["client"]
    token = test_setup["token"]
    period = test_setup["period"]
    cls = test_setup["class"]
    math_sub = test_setup["math_sub"]
    staff_a = test_setup["staff_a"]

    # 1. Publish baseline Revision 1
    res = client.post(
        "/api/v1/subject-loads/batch-save",
        json={
            "academic_period_id": period.academic_period_id,
            "academic_level_id": test_setup["level"].academic_level_id,
            "action": "publish",
            "publish_scope": "section",
            "target_class_id": cls.class_id,
            "loads": [
                {
                    "class_id": cls.class_id,
                    "subject_id": math_sub.subject_id,
                    "staff_id": staff_a.staff_id,
                    "academic_period_id": period.academic_period_id,
                    "start_time": "08:00",
                    "end_time": "09:00",
                    "days_of_week": ["MON", "TUE", "WED", "THU", "FRI"],
                }
            ],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 200

    pub_load = db.query(SubjectLoad).filter(
        SubjectLoad.class_id == cls.class_id,
        SubjectLoad.is_active_version == True,
    ).first()
    assert pub_load.status == "published"
    assert pub_load.section_revision == 1

    # 2. Unlock section -> Creates working draft (Revision 2)
    unlock_res = client.post(
        "/api/v1/subject-loads/unlock-section",
        json={"academic_period_id": period.academic_period_id, "class_id": cls.class_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert unlock_res.status_code == 200
    unlock_data = unlock_res.json()
    assert unlock_data["has_pending_draft"] is True
    assert unlock_data["section_revision"] == 2
    assert unlock_data["base_revision"] == 1

    # Baseline pub_load remains published and active version
    db.refresh(pub_load)
    assert pub_load.status == "published"
    assert pub_load.is_active_version is True

    drafts = db.query(SubjectLoad).filter(
        SubjectLoad.class_id == cls.class_id,
        SubjectLoad.status == "draft",
    ).all()
    assert len(drafts) == 1
    assert drafts[0].section_revision == 2
    assert drafts[0].base_revision == 1
    assert drafts[0].is_active_version is False
    assert drafts[0].continued_from_load_id == pub_load.subject_load_id

    # 3. Defensive Hardening 5: Simultaneous / duplicate unlock calls must be idempotent
    simultaneous_res = client.post(
        "/api/v1/subject-loads/unlock-section",
        json={"academic_period_id": period.academic_period_id, "class_id": cls.class_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert simultaneous_res.status_code == 200
    sim_data = simultaneous_res.json()
    assert sim_data["section_revision"] == 2

    # Still only 1 draft row exists
    drafts_after = db.query(SubjectLoad).filter(
        SubjectLoad.class_id == cls.class_id,
        SubjectLoad.status == "draft",
    ).all()
    assert len(drafts_after) == 1


def test_save_draft_does_not_recreate_published_section(test_setup):
    db = test_setup["db"]
    client = test_setup["client"]
    token = test_setup["token"]
    period = test_setup["period"]
    cls = test_setup["class"]
    headers = {"Authorization": f"Bearer {token}"}
    load = {
        "class_id": cls.class_id,
        "subject_id": test_setup["math_sub"].subject_id,
        "staff_id": test_setup["staff_a"].staff_id,
        "academic_period_id": period.academic_period_id,
        "start_time": "08:00",
        "end_time": "09:00",
        "days_of_week": ["MON", "TUE", "WED", "THU", "FRI"],
    }
    request = {
        "academic_period_id": period.academic_period_id,
        "academic_level_id": test_setup["level"].academic_level_id,
        "publish_scope": "section",
        "target_class_id": cls.class_id,
    }

    response = client.post(
        "/api/v1/subject-loads/batch-save",
        json={**request, "action": "publish", "loads": [load]},
        headers=headers,
    )
    assert response.status_code == 200

    studio = client.get(
        "/api/v1/subject-loads/studio-data",
        params={"academic_period_id": period.academic_period_id},
        headers=headers,
    )
    assert studio.status_code == 200
    published = next(item for item in studio.json()["existing_loads"] if item["class_id"] == cls.class_id)
    assert published["section_revision"] == 1
    unchanged_publish = client.post(
        "/api/v1/subject-loads/batch-save",
        json={**request, "action": "publish", "loads": [published]},
        headers=headers,
    )
    assert unchanged_publish.status_code == 200, unchanged_publish.text
    assert unchanged_publish.json()["saved_count"] == 0

    save_unchanged = client.post(
        "/api/v1/subject-loads/batch-save",
        json={**request, "action": "draft", "loads": [published]},
        headers=headers,
    )
    assert save_unchanged.status_code == 200
    assert save_unchanged.json()["saved_count"] == 0
    assert db.query(SubjectLoad).filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.status == "draft").count() == 0

    stale_edit = {**published, "status": "draft", "is_locked": False}
    stale_save = client.post(
        "/api/v1/subject-loads/batch-save",
        json={**request, "action": "draft", "loads": [stale_edit]},
        headers=headers,
    )
    assert stale_save.status_code == 409
    assert db.query(SubjectLoad).filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.status == "draft").count() == 0

    unlock = client.post(
        "/api/v1/subject-loads/unlock-section",
        json={"academic_period_id": period.academic_period_id, "class_id": cls.class_id},
        headers=headers,
    )
    assert unlock.status_code == 200
    edit = unlock.json()["loads"][0]
    save_edit = client.post(
        "/api/v1/subject-loads/batch-save",
        json={**request, "action": "draft", "loads": [edit]},
        headers=headers,
    )
    assert save_edit.status_code == 200
    saved_draft = db.query(SubjectLoad).filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.status == "draft").one()
    assert (saved_draft.section_revision, saved_draft.base_revision) == (2, 1)


def test_studio_read_does_not_turn_unassigned_published_load_into_draft(test_setup):
    db = test_setup["db"]
    client = test_setup["client"]
    token = test_setup["token"]
    period = test_setup["period"]
    cls = test_setup["class"]
    load = SubjectLoad(
        class_id=cls.class_id,
        subject_id=test_setup["math_sub"].subject_id,
        academic_period_id=period.academic_period_id,
        staff_id=None,
        status="published",
        is_active_version=True,
        is_locked=True,
        section_revision=2,
    )
    db.add(load)
    db.commit()

    response = client.get(
        "/api/v1/subject-loads/studio-data",
        params={"academic_period_id": period.academic_period_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert response.status_code == 200
    db.refresh(load)
    assert (load.status, load.is_active_version, load.is_locked, load.section_revision) == ("published", True, True, 2)


def test_discard_draft_restores_baseline(test_setup):
    db = test_setup["db"]
    client = test_setup["client"]
    token = test_setup["token"]
    period = test_setup["period"]
    cls = test_setup["class"]
    math_sub = test_setup["math_sub"]
    staff_a = test_setup["staff_a"]

    # Publish baseline
    client.post(
        "/api/v1/subject-loads/batch-save",
        json={
            "academic_period_id": period.academic_period_id,
            "academic_level_id": test_setup["level"].academic_level_id,
            "action": "publish",
            "publish_scope": "section",
            "target_class_id": cls.class_id,
            "loads": [
                {
                    "class_id": cls.class_id,
                    "subject_id": math_sub.subject_id,
                    "staff_id": staff_a.staff_id,
                    "academic_period_id": period.academic_period_id,
                    "start_time": "08:00",
                    "end_time": "09:00",
                    "days_of_week": ["MON", "TUE", "WED", "THU", "FRI"],
                }
            ],
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    # Unlock
    client.post(
        "/api/v1/subject-loads/unlock-section",
        json={"academic_period_id": period.academic_period_id, "class_id": cls.class_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert db.query(SubjectLoad).filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.status == "draft").count() == 1

    # Discard Draft
    discard_res = client.post(
        "/api/v1/subject-loads/discard-draft",
        json={"academic_period_id": period.academic_period_id, "class_id": cls.class_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert discard_res.status_code == 200
    data = discard_res.json()
    assert data["has_pending_draft"] is False
    assert data["section_revision"] == 1

    # Drafts deleted, published load intact
    assert db.query(SubjectLoad).filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.status == "draft").count() == 0
    pub = db.query(SubjectLoad).filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.is_active_version == True).first()
    assert pub is not None
    assert pub.status == "published"


def test_optimistic_concurrency_conflict_409(test_setup):
    client = test_setup["client"]
    token = test_setup["token"]
    period = test_setup["period"]
    cls = test_setup["class"]
    math_sub = test_setup["math_sub"]
    staff_a = test_setup["staff_a"]

    # Publish Revision 1
    client.post(
        "/api/v1/subject-loads/batch-save",
        json={
            "academic_period_id": period.academic_period_id,
            "academic_level_id": test_setup["level"].academic_level_id,
            "action": "publish",
            "publish_scope": "section",
            "target_class_id": cls.class_id,
            "loads": [
                {
                    "class_id": cls.class_id,
                    "subject_id": math_sub.subject_id,
                    "staff_id": staff_a.staff_id,
                    "academic_period_id": period.academic_period_id,
                    "start_time": "08:00",
                    "end_time": "09:00",
                    "days_of_week": ["MON", "TUE", "WED", "THU", "FRI"],
                }
            ],
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    # Unlock before publishing Revision 2.
    unlocked = client.post(
        "/api/v1/subject-loads/unlock-section",
        json={"academic_period_id": period.academic_period_id, "class_id": cls.class_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert unlocked.status_code == 200
    draft = unlocked.json()["loads"][0]
    client.post(
        "/api/v1/subject-loads/batch-save",
        json={
            "academic_period_id": period.academic_period_id,
            "academic_level_id": test_setup["level"].academic_level_id,
            "action": "publish",
            "publish_scope": "section",
            "target_class_id": cls.class_id,
            "base_revision": 1,
            "loads": [draft],
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    # Another admin tries to publish based on stale base_revision = 1 -> Should return 409
    res = client.post(
        "/api/v1/subject-loads/batch-save",
        json={
            "academic_period_id": period.academic_period_id,
            "academic_level_id": test_setup["level"].academic_level_id,
            "action": "publish",
            "publish_scope": "section",
            "target_class_id": cls.class_id,
            "base_revision": 1,
            "loads": [
                {
                    "class_id": cls.class_id,
                    "subject_id": math_sub.subject_id,
                    "staff_id": staff_a.staff_id,
                    "academic_period_id": period.academic_period_id,
                    "start_time": "09:00",
                    "end_time": "10:00",
                    "days_of_week": ["MON", "TUE", "WED", "THU", "FRI"],
                }
            ],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 409
    assert "conflict" in res.json()["detail"].lower()


def test_deletion_guard_blocks_populated_load(test_setup):
    db = test_setup["db"]
    client = test_setup["client"]
    token = test_setup["token"]
    period = test_setup["period"]
    cls = test_setup["class"]
    math_sub = test_setup["math_sub"]
    sci_sub = test_setup["sci_sub"]
    staff_a = test_setup["staff_a"]

    # Publish Math load
    client.post(
        "/api/v1/subject-loads/batch-save",
        json={
            "academic_period_id": period.academic_period_id,
            "academic_level_id": test_setup["level"].academic_level_id,
            "action": "publish",
            "publish_scope": "section",
            "target_class_id": cls.class_id,
            "loads": [
                {
                    "class_id": cls.class_id,
                    "subject_id": math_sub.subject_id,
                    "staff_id": staff_a.staff_id,
                    "academic_period_id": period.academic_period_id,
                    "start_time": "08:00",
                    "end_time": "09:00",
                    "days_of_week": ["MON", "TUE", "WED", "THU", "FRI"],
                }
            ],
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    # Attach live student data: Attendance record for Math
    att = AttendanceRecord(
        student_id=uuid.uuid4(),
        class_id=cls.class_id,
        subject_id=math_sub.subject_id,
        date=period.start_date,
        status="present",
    )
    db.add(att)
    db.commit()

    # Admin tries to publish a revision removing Math and adding Science
    unlock = client.post(
        "/api/v1/subject-loads/unlock-section",
        json={"academic_period_id": period.academic_period_id, "class_id": cls.class_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert unlock.status_code == 200
    res = client.post(
        "/api/v1/subject-loads/batch-save",
        json={
            "academic_period_id": period.academic_period_id,
            "academic_level_id": test_setup["level"].academic_level_id,
            "action": "publish",
            "publish_scope": "section",
            "target_class_id": cls.class_id,
            "loads": [
                {
                    "class_id": cls.class_id,
                    "subject_id": sci_sub.subject_id,
                    "staff_id": staff_a.staff_id,
                    "academic_period_id": period.academic_period_id,
                    "start_time": "08:00",
                    "end_time": "09:00",
                    "days_of_week": ["MON", "TUE", "WED", "THU", "FRI"],
                }
            ],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    assert res.status_code == 409
    assert "Cannot remove 'Mathematics 7'" in res.json()["detail"]
    assert "attendance records" in res.json()["detail"]


def test_reassignment_with_active_substitution_authorizations(test_setup):
    """
    Scenario (Resolving Prompt Point 1 & Architecture Rule):
    - Initial Primary: Teacher A
    - Substitute: Teacher C
    - Later Permanent Reassignment: Teacher A -> Teacher B while substitution active
    Verify:
    1. During substitution: Teacher C = WRITE, Teacher B = VIEW_ONLY, Teacher A = DENIED!
    2. When substitution concludes: Teacher B = WRITE, Teacher A = DENIED, Teacher C = DENIED!
    3. Historical completed substitution records remain attached and queryable.
    """
    db = test_setup["db"]
    client = test_setup["client"]
    token = test_setup["token"]
    period = test_setup["period"]
    cls = test_setup["class"]
    math_sub = test_setup["math_sub"]
    staff_a = test_setup["staff_a"]
    staff_b = test_setup["staff_b"]
    staff_c = test_setup["staff_c"]

    today = SubstitutionService.get_academic_date()

    # Step 1: Teacher A is published as primary on Math
    client.post(
        "/api/v1/subject-loads/batch-save",
        json={
            "academic_period_id": period.academic_period_id,
            "academic_level_id": test_setup["level"].academic_level_id,
            "action": "publish",
            "publish_scope": "section",
            "target_class_id": cls.class_id,
            "loads": [
                {
                    "class_id": cls.class_id,
                    "subject_id": math_sub.subject_id,
                    "staff_id": staff_a.staff_id,
                    "academic_period_id": period.academic_period_id,
                    "start_time": "08:00",
                    "end_time": "09:00",
                    "days_of_week": ["MON", "TUE", "WED", "THU", "FRI"],
                }
            ],
        },
        headers={"Authorization": f"Bearer {token}"},
    )
    pub_v1 = db.query(SubjectLoad).filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.is_active_version == True).first()

    # Step 2: Teacher C substitutes Teacher A
    sub = TeacherSubstitution(
        subject_load_id=pub_v1.subject_load_id,
        original_staff_id=staff_a.staff_id,
        substitute_staff_id=staff_c.staff_id,
        start_date=today - timedelta(days=1),
        end_date=today + timedelta(days=5),
        status="active",
        reason="Medical leave",
        batch_id=uuid.uuid4(),
    )
    db.add(sub)
    db.commit()

    # Check access during active substitution before reassignment
    level_c = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_c.staff_id, cls.class_id, math_sub.subject_id, period.academic_period_id)
    level_a = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_a.staff_id, cls.class_id, math_sub.subject_id, period.academic_period_id)
    level_b = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_b.staff_id, cls.class_id, math_sub.subject_id, period.academic_period_id)
    assert level_c == SubjectAccessLevel.WRITE
    assert level_a == SubjectAccessLevel.VIEW_ONLY
    assert level_b == SubjectAccessLevel.DENIED

    # Step 3: Admin permanently reassigns Teacher A -> Teacher B via new published revision
    unlocked = client.post(
        "/api/v1/subject-loads/unlock-section",
        json={"academic_period_id": period.academic_period_id, "class_id": cls.class_id},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert unlocked.status_code == 200
    revised_load = {**unlocked.json()["loads"][0], "staff_id": staff_b.staff_id}
    client.post(
        "/api/v1/subject-loads/batch-save",
        json={
            "academic_period_id": period.academic_period_id,
            "academic_level_id": test_setup["level"].academic_level_id,
            "action": "publish",
            "publish_scope": "section",
            "target_class_id": cls.class_id,
            "loads": [revised_load],
        },
        headers={"Authorization": f"Bearer {token}"},
    )

    pub_v2 = db.query(SubjectLoad).filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.is_active_version == True).first()
    assert pub_v2.staff_id == staff_b.staff_id
    assert pub_v2.section_revision == 2

    # Verify substitution was repointed atomically to pub_v2
    db.refresh(sub)
    assert sub.subject_load_id == pub_v2.subject_load_id

    # Verify audit log was written
    audit = db.query(SubjectLoadAssignmentLog).filter(SubjectLoadAssignmentLog.subject_load_id == pub_v2.subject_load_id).first()
    assert audit is not None
    assert audit.old_staff_id == staff_a.staff_id
    assert audit.new_staff_id == staff_b.staff_id

    # Check access: Substitute C = WRITE, Primary B = VIEW_ONLY, Former Primary A = DENIED!
    level_c_after = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_c.staff_id, cls.class_id, math_sub.subject_id, period.academic_period_id)
    level_b_after = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_b.staff_id, cls.class_id, math_sub.subject_id, period.academic_period_id)
    level_a_after = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_a.staff_id, cls.class_id, math_sub.subject_id, period.academic_period_id)

    assert level_c_after == SubjectAccessLevel.WRITE
    assert level_b_after == SubjectAccessLevel.VIEW_ONLY
    assert level_a_after == SubjectAccessLevel.DENIED  # Point 1 Requirement met!

    # Step 4: Substitution concludes (e.g. marked completed or end_date passes)
    sub.status = "completed"
    db.commit()

    # Authority falls back to new primary Teacher B! Teacher A and C are DENIED.
    level_c_ended = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_c.staff_id, cls.class_id, math_sub.subject_id, period.academic_period_id)
    level_b_ended = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_b.staff_id, cls.class_id, math_sub.subject_id, period.academic_period_id)
    level_a_ended = SubjectLoadAuthorizationService.get_teacher_access_level(db, staff_a.staff_id, cls.class_id, math_sub.subject_id, period.academic_period_id)

    assert level_b_ended == SubjectAccessLevel.WRITE
    assert level_a_ended == SubjectAccessLevel.DENIED
    assert level_c_ended == SubjectAccessLevel.DENIED


def _publish_locked_fixture(ctx):
    period_id = ctx["period"].academic_period_id
    class_id = ctx["class"].class_id
    headers = {"Authorization": f"Bearer {ctx['token']}"}
    load = {
        "class_id": class_id,
        "subject_id": ctx["math_sub"].subject_id,
        "staff_id": ctx["staff_a"].staff_id,
        "academic_period_id": period_id,
        "start_time": "08:00",
        "end_time": "09:00",
        "days_of_week": ["MON", "TUE"],
    }
    request = {
        "academic_period_id": period_id,
        "academic_level_id": ctx["level"].academic_level_id,
        "action": "publish",
        "publish_scope": "section",
        "target_class_id": class_id,
        "loads": [load],
    }
    response = ctx["client"].post("/api/v1/subject-loads/batch-save", json=request, headers=headers)
    assert response.status_code == 200, response.text
    published = ctx["db"].query(SubjectLoad).filter(
        SubjectLoad.class_id == class_id, SubjectLoad.is_active_version.is_(True)
    ).one()
    return request, {**load, "subject_load_id": published.subject_load_id, "status": "published", "is_locked": True}, headers


@pytest.mark.parametrize("action,change", [
    ("draft", {"start_time": "09:00", "end_time": "10:00"}),
    ("publish", {"days_of_week": ["WED"]}),
    ("draft", {"staff_id": "TCH002"}),
    ("publish", {"staff_id": "TCH002"}),
])
def test_locked_section_rejects_direct_api_changes(test_setup, action, change):
    request, load, headers = _publish_locked_fixture(test_setup)
    response = test_setup["client"].post(
        "/api/v1/subject-loads/batch-save",
        json={**request, "action": action, "loads": [{**load, **change, "status": "draft", "is_locked": False}]},
        headers=headers,
    )
    assert response.status_code == 409, response.text
    test_setup["db"].expire_all()
    published = test_setup["db"].query(SubjectLoad).filter(SubjectLoad.is_active_version.is_(True)).one()
    assert (published.start_time, published.end_time, published.days_of_week, published.staff_id) == (
        "08:00", "09:00", ["MON", "TUE"], test_setup["staff_a"].staff_id,
    )
    assert test_setup["db"].query(SubjectLoad).filter(SubjectLoad.status == "draft").count() == 0


def test_unlocked_draft_edit_and_republish_locks_again(test_setup):
    request, load, headers = _publish_locked_fixture(test_setup)
    client = test_setup["client"]
    unlocked = client.post(
        "/api/v1/subject-loads/unlock-section",
        json={"academic_period_id": request["academic_period_id"], "class_id": load["class_id"]},
        headers=headers,
    )
    assert unlocked.status_code == 200
    draft = {**unlocked.json()["loads"][0], "start_time": "09:00", "end_time": "10:00"}
    saved = client.post("/api/v1/subject-loads/batch-save", json={**request, "action": "draft", "loads": [draft]}, headers=headers)
    assert saved.status_code == 200, saved.text
    current = test_setup["db"].query(SubjectLoad).filter(SubjectLoad.is_active_version.is_(True)).one()
    assert current.start_time == "08:00"
    published = client.post("/api/v1/subject-loads/batch-save", json={**request, "base_revision": 1, "loads": [draft]}, headers=headers)
    assert published.status_code == 200, published.text
    test_setup["db"].expire_all()
    current = test_setup["db"].query(SubjectLoad).filter(SubjectLoad.is_active_version.is_(True)).one()
    assert (current.start_time, current.section_revision, current.is_locked) == ("09:00", 2, True)
    stale = client.post("/api/v1/subject-loads/batch-save", json={**request, "loads": [draft]}, headers=headers)
    assert stale.status_code == 409


def test_mixed_save_is_atomic_and_other_section_stays_editable(test_setup):
    request, locked, headers = _publish_locked_fixture(test_setup)
    db = test_setup["db"]
    other = Class(
        section_name="Ruby", academic_level_id=test_setup["level"].academic_level_id,
        academic_year_id=test_setup["class"].academic_year_id, class_status="active",
    )
    db.add(other)
    db.commit()
    open_load = {**request["loads"][0], "class_id": other.class_id, "staff_id": test_setup["staff_b"].staff_id}
    mixed = test_setup["client"].post(
        "/api/v1/subject-loads/batch-save",
        json={**request, "action": "draft", "publish_scope": "all", "loads": [open_load, {**locked, "staff_id": test_setup["staff_b"].staff_id}]},
        headers=headers,
    )
    assert mixed.status_code == 409
    assert db.query(SubjectLoad).filter(SubjectLoad.class_id == other.class_id).count() == 0
    allowed = test_setup["client"].post(
        "/api/v1/subject-loads/batch-save",
        json={**request, "action": "draft", "publish_scope": "all", "loads": [open_load]},
        headers=headers,
    )
    assert allowed.status_code == 200, allowed.text
    assert db.query(SubjectLoad).filter(SubjectLoad.class_id == other.class_id, SubjectLoad.status == "draft").count() == 1
    level_publish = test_setup["client"].post(
        "/api/v1/subject-loads/batch-save",
        json={**request, "publish_scope": "level", "target_level_id": test_setup["level"].academic_level_id,
              "loads": [open_load]},
        headers=headers,
    )
    assert level_publish.status_code == 200, level_publish.text
    locked_baseline = db.query(SubjectLoad).filter(SubjectLoad.class_id == locked["class_id"], SubjectLoad.is_active_version.is_(True)).one()
    assert (locked_baseline.start_time, locked_baseline.section_revision) == ("08:00", 1)


def test_auto_generation_preserves_locked_baseline_and_unauthorized_unlock(test_setup):
    request, load, headers = _publish_locked_fixture(test_setup)
    teacher_token = create_access_token(str(test_setup["staff_a"].user_id), "teacher")
    denied = test_setup["client"].post(
        "/api/v1/subject-loads/unlock-section",
        json={"academic_period_id": request["academic_period_id"], "class_id": load["class_id"]},
        headers={"Authorization": f"Bearer {teacher_token}"},
    )
    assert denied.status_code == 403
    scheduled = test_setup["client"].post(
        "/api/v1/subject-loads/auto-schedule",
        json={"academic_period_id": request["academic_period_id"], "loads": [{**load, "start_time": "10:00", "end_time": "11:00"}]},
        headers=headers,
    )
    assert scheduled.status_code == 200, scheduled.text
    assert scheduled.json()["scheduled_loads"][0]["start_time"] == "08:00"
    assert test_setup["db"].query(SubjectLoad).filter(SubjectLoad.status == "draft").count() == 0


def test_template_cascade_cannot_change_published_load(test_setup):
    request, _, headers = _publish_locked_fixture(test_setup)
    db = test_setup["db"]
    slot = PeriodTemplateSlot(
        template_group="JHS_45MIN", slot_name="Period 1", slot_type="CLASS",
        start_time="08:00", end_time="09:00", is_locked_break=False, display_order=1,
    )
    db.add(slot)
    db.commit()
    response = test_setup["client"].put(
        "/api/v1/subject-loads/period-templates",
        json=[{
            "slot_id": slot.slot_id, "template_group": "JHS_45MIN", "slot_name": "Period 1",
            "slot_type": "CLASS", "start_time": "09:00", "end_time": "10:00", "display_order": 1,
        }],
        headers=headers,
    )
    assert response.status_code == 409, response.text
    db.refresh(slot)
    assert slot.start_time == "08:00"
    published = db.query(SubjectLoad).filter(SubjectLoad.is_active_version.is_(True)).one()
    assert published.start_time == "08:00"

    group_change = test_setup["client"].put(
        f"/api/v1/subject-loads/classes/{request['target_class_id']}/template-group",
        json={"template_group": "OTHER"}, headers=headers,
    )
    assert group_change.status_code == 409

import uuid
from datetime import date, timedelta
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.main import app
from app.db.Base import Base
from app.db.Session import get_db
from app.core.Security import create_access_token
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.academic.SubjectLoadAssignmentLog import SubjectLoadAssignmentLog
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.attendance.Attendance import AttendanceRecord
from app.services.academic.SubjectLoadAuthorizationService import (
    SubjectAccessLevel,
    SubjectLoadAuthorizationService,
)
from app.services.academic.SubjectLoadDependencyService import (
    ChangeType,
    SubjectLoadDependencyService,
)
from app.services.academic.SubstitutionService import SubstitutionService
from app.services.academic.PeriodTemplateRevisionService import PeriodTemplateRevisionService


def _create_partial_unique_indexes(engine) -> None:
    """Mirror PostgreSQL partial unique indexes enforced after 20261119_multi_slot_loads."""
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_subject_load_active "
                "ON subject_load(logical_load_id) WHERE is_active_version = 1"
            )
        )
        conn.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_subject_load_draft "
                "ON subject_load(logical_load_id) WHERE status = 'draft'"
            )
        )


@pytest.fixture
def ctx():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    _create_partial_unique_indexes(engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = SessionLocal()

    def _override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = _override_get_db

    admin_uid = uuid.uuid4()
    teacher_a_uid = uuid.uuid4()
    teacher_b_uid = uuid.uuid4()
    teacher_c_uid = uuid.uuid4()
    student_uid = uuid.uuid4()
    db.add_all([
        UserAccount(user_id=admin_uid, email="admin@c1.test", account_status="active"),
        UserAccount(user_id=teacher_a_uid, email="ta@c1.test", account_status="active"),
        UserAccount(user_id=teacher_b_uid, email="tb@c1.test", account_status="active"),
        UserAccount(user_id=teacher_c_uid, email="tc@c1.test", account_status="active"),
        UserAccount(user_id=student_uid, email="student@c1.test", account_status="active"),
    ])
    db.flush()

    staff_a = AcademicStaff(
        staff_id="TCH101",
        user_id=teacher_a_uid,
        first_name="Alice",
        last_name="One",
        email="ta@c1.test",
        employment_status="active",
    )
    staff_b = AcademicStaff(
        staff_id="TCH102",
        user_id=teacher_b_uid,
        first_name="Bob",
        last_name="Two",
        email="tb@c1.test",
        employment_status="active",
    )
    staff_c = AcademicStaff(
        staff_id="TCH103",
        user_id=teacher_c_uid,
        first_name="Charlie",
        last_name="Sub",
        email="tc@c1.test",
        employment_status="active",
    )
    db.add_all([staff_a, staff_b, staff_c])

    today = SubstitutionService.get_academic_date()
    year = AcademicYear(
        year_label="2026-2027",
        start_date=today - timedelta(days=30),
        end_date=today + timedelta(days=270),
        is_active=True,
    )
    db.add(year)
    db.flush()

    period = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Q1",
        period_sequence=1,
        start_date=today - timedelta(days=15),
        end_date=today + timedelta(days=75),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    gt = GradingTemplate(
        grading_template_id=1,
        template_name="Core",
        passing_threshold=75.0,
        status="active",
    )
    db.add_all([period, level, gt])
    db.flush()

    cls1 = Class(
        section_name="7-Alpha",
        academic_level_id=level.academic_level_id,
        academic_year_id=year.academic_year_id,
        class_status="active",
    )
    cls2 = Class(
        section_name="7-Beta",
        academic_level_id=level.academic_level_id,
        academic_year_id=year.academic_year_id,
        class_status="active",
    )
    math_sub = Subject(
        subject_name="Mathematics 7",
        subject_codename="MATH7",
        academic_level_id=level.academic_level_id,
        status="active",
    )
    sci_sub = Subject(
        subject_name="Science 7",
        subject_codename="SCI7",
        academic_level_id=level.academic_level_id,
        status="active",
    )
    db.add_all([cls1, cls2, math_sub, sci_sub])
    db.flush()

    db.add_all([
        SubjectOffering(
            subject_id=math_sub.subject_id,
            academic_year_id=year.academic_year_id,
            academic_level_id=level.academic_level_id,
            academic_period_id=period.academic_period_id,
            minutes=60,
            status="active",
        ),
        SubjectOffering(
            subject_id=sci_sub.subject_id,
            academic_year_id=year.academic_year_id,
            academic_level_id=level.academic_level_id,
            academic_period_id=period.academic_period_id,
            minutes=60,
            status="active",
        ),
    ])

    student = Student(
        student_id=uuid.uuid4(),
        user_id=student_uid,
        student_lrn="123456789012",
        first_name="Sam",
        last_name="Learner",
        gender="M",
        dob=date(2013, 1, 15),
    )
    db.add(student)
    db.flush()
    db.add(
        StudentClass(
            student_id=student.student_id,
            class_id=cls1.class_id,
            academic_year_id=year.academic_year_id,
            enrollment_status="enrolled",
        )
    )
    db.commit()

    admin_headers = {"Authorization": f"Bearer {create_access_token(str(admin_uid), 'admin')}"}
    student_headers = {"Authorization": f"Bearer {create_access_token(str(student_uid), 'student')}"}

    try:
        yield {
            "db": db,
            "engine": engine,
            "client": TestClient(app),
            "admin_headers": admin_headers,
            "student_headers": student_headers,
            "year": year,
            "period": period,
            "level": level,
            "cls1": cls1,
            "cls2": cls2,
            "math": math_sub,
            "sci": sci_sub,
            "staff_a": staff_a,
            "staff_b": staff_b,
            "staff_c": staff_c,
            "student": student,
        }
    finally:
        app.dependency_overrides.clear()
        db.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def _batch_save(ctx, *, action: str, loads: list[dict], publish_scope: str = "section", target_class_id: int | None = None, base_revision: int | None = None):
    body = {
        "academic_period_id": ctx["period"].academic_period_id,
        "academic_level_id": ctx["level"].academic_level_id,
        "action": action,
        "publish_scope": publish_scope,
        "loads": loads,
    }
    if target_class_id is not None:
        body["target_class_id"] = target_class_id
    if base_revision is not None:
        body["base_revision"] = base_revision
    return ctx["client"].post(
        "/api/v1/subject-loads/batch-save",
        json=body,
        headers=ctx["admin_headers"],
    )


def _unlock(ctx, class_id: int):
    return ctx["client"].post(
        "/api/v1/subject-loads/unlock-section",
        json={
            "academic_period_id": ctx["period"].academic_period_id,
            "class_id": class_id,
        },
        headers=ctx["admin_headers"],
    )


def test_single_slot_publish_unlock_republish_preserves_identity_locks_and_audit(ctx):
    db = ctx["db"]
    cls = ctx["cls1"]
    math = ctx["math"]
    period = ctx["period"]
    staff_a = ctx["staff_a"]
    staff_b = ctx["staff_b"]
    staff_c = ctx["staff_c"]

    slot = {
        "class_id": cls.class_id,
        "subject_id": math.subject_id,
        "staff_id": staff_a.staff_id,
        "academic_period_id": period.academic_period_id,
        "start_time": "08:00",
        "end_time": "09:00",
        "days_of_week": ["MON", "TUE", "WED", "THU", "FRI"],
    }

    r_draft = _batch_save(ctx, action="draft", loads=[slot], target_class_id=cls.class_id)
    assert r_draft.status_code == 200, r_draft.text
    draft = db.query(SubjectLoad).filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.status == "draft").one()
    expected_canonical = f"LL_{cls.class_id}_{math.subject_id}_{period.academic_period_id}"
    assert draft.logical_load_id == expected_canonical

    r_pub = _batch_save(
        ctx,
        action="publish",
        loads=[{**slot, "subject_load_id": draft.subject_load_id, "logical_load_id": draft.logical_load_id}],
        target_class_id=cls.class_id,
    )
    assert r_pub.status_code == 200, r_pub.text
    assert r_pub.json()["saved_count"] == 1

    db.expire_all()
    pub_v1 = db.query(SubjectLoad).filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.is_active_version.is_(True)).one()
    assert pub_v1.logical_load_id == expected_canonical
    assert (pub_v1.status, pub_v1.is_locked, pub_v1.section_revision) == ("published", True, 1)

    today = SubstitutionService.get_academic_date()
    sub = TeacherSubstitution(
        subject_load_id=pub_v1.subject_load_id,
        original_staff_id=staff_a.staff_id,
        substitute_staff_id=staff_c.staff_id,
        start_date=today - timedelta(days=1),
        end_date=today + timedelta(days=5),
        status="active",
        reason="Leave",
        batch_id=uuid.uuid4(),
    )
    db.add(sub)
    db.commit()

    r_unlock = _unlock(ctx, cls.class_id)
    assert r_unlock.status_code == 200, r_unlock.text
    unlocked_load = r_unlock.json()["loads"][0]
    assert unlocked_load["logical_load_id"] == expected_canonical
    assert unlocked_load["continued_from_load_id"] == pub_v1.subject_load_id

    edited = {**unlocked_load, "staff_id": staff_b.staff_id, "start_time": "10:00", "end_time": "11:00"}
    r_repub = _batch_save(ctx, action="publish", loads=[edited], target_class_id=cls.class_id, base_revision=1)
    assert r_repub.status_code == 200, r_repub.text

    db.expire_all()
    db.refresh(pub_v1)
    db.refresh(sub)
    assert pub_v1.status == "archived"
    assert pub_v1.is_active_version is False

    pub_v2 = db.query(SubjectLoad).filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.is_active_version.is_(True)).one()
    assert pub_v2.logical_load_id == expected_canonical
    assert pub_v2.continued_from_load_id == pub_v1.subject_load_id
    assert (pub_v2.staff_id, pub_v2.start_time, pub_v2.section_revision, pub_v2.is_locked) == (
        staff_b.staff_id, "10:00", 2, True
    )
    assert sub.subject_load_id == pub_v2.subject_load_id
    assert db.query(SubjectLoad).filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.status == "draft").count() == 0

    audit = db.query(SubjectLoadAssignmentLog).filter(SubjectLoadAssignmentLog.subject_load_id == pub_v2.subject_load_id).one()
    assert (audit.logical_load_id, audit.old_staff_id, audit.new_staff_id) == (
        expected_canonical, staff_a.staff_id, staff_b.staff_id
    )


def test_multi_slot_draft_and_publish_preserves_all_slots_with_partial_unique_indexes(ctx):
    db = ctx["db"]
    cls = ctx["cls1"]
    math = ctx["math"]
    period = ctx["period"]
    staff_a = ctx["staff_a"]

    slots = [
        {
            "class_id": cls.class_id,
            "subject_id": math.subject_id,
            "staff_id": staff_a.staff_id,
            "academic_period_id": period.academic_period_id,
            "start_time": "08:00",
            "end_time": "09:00",
            "days_of_week": ["MON", "WED"],
        },
        {
            "class_id": cls.class_id,
            "subject_id": math.subject_id,
            "staff_id": staff_a.staff_id,
            "academic_period_id": period.academic_period_id,
            "start_time": "10:00",
            "end_time": "11:00",
            "days_of_week": ["TUE", "THU"],
        },
        {
            "class_id": cls.class_id,
            "subject_id": math.subject_id,
            "staff_id": staff_a.staff_id,
            "academic_period_id": period.academic_period_id,
            "start_time": "13:00",
            "end_time": "14:00",
            "days_of_week": ["FRI"],
        },
    ]

    r_draft = _batch_save(ctx, action="draft", loads=slots, target_class_id=cls.class_id)
    assert r_draft.status_code == 200, r_draft.text
    assert r_draft.json()["saved_count"] == 3

    drafts = (
        db.query(SubjectLoad)
        .filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.status == "draft")
        .order_by(SubjectLoad.subject_load_id.asc())
        .all()
    )
    assert len(drafts) == 3
    base_id = f"LL_{cls.class_id}_{math.subject_id}_{period.academic_period_id}"
    assert [d.logical_load_id for d in drafts] == [base_id, f"{base_id}_s2", f"{base_id}_s3"]

    pub_payload = [
        {
            "subject_load_id": d.subject_load_id,
            "logical_load_id": d.logical_load_id,
            "class_id": d.class_id,
            "subject_id": d.subject_id,
            "staff_id": d.staff_id,
            "academic_period_id": d.academic_period_id,
            "start_time": d.start_time,
            "end_time": d.end_time,
            "days_of_week": d.days_of_week,
            "status": "draft",
        }
        for d in drafts
    ]
    r_pub = _batch_save(ctx, action="publish", loads=pub_payload, target_class_id=cls.class_id)
    assert r_pub.status_code == 200, r_pub.text
    assert r_pub.json()["saved_count"] == 3

    db.expire_all()
    published = (
        db.query(SubjectLoad)
        .filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.is_active_version.is_(True))
        .order_by(SubjectLoad.start_time.asc())
        .all()
    )
    assert len(published) == 3
    assert [(p.start_time, p.end_time, p.days_of_week, p.status, p.is_locked, p.section_revision) for p in published] == [
        ("08:00", "09:00", ["MON", "WED"], "published", True, 1),
        ("10:00", "11:00", ["TUE", "THU"], "published", True, 1),
        ("13:00", "14:00", ["FRI"], "published", True, 1),
    ]
    assert len({p.logical_load_id for p in published}) == 3
    assert db.query(SubjectLoad).filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.status == "draft").count() == 0

    # Student subject list deduplicates multi-slot subjects into one card,
    # while class schedule still exposes all 3 meeting slots.
    subj_res = ctx["client"].get(
        f"/api/v1/students/me/subjects?academic_period_id={period.academic_period_id}",
        headers=ctx["student_headers"],
    )
    assert subj_res.status_code == 200, subj_res.text
    assert [row["subject_name"] for row in subj_res.json()] == ["Mathematics 7"]

    sched_res = ctx["client"].get(
        f"/api/v1/subject-loads/class-schedule/{cls.class_id}?academic_period_id={period.academic_period_id}",
        headers=ctx["student_headers"],
    )
    assert sched_res.status_code == 200, sched_res.text
    class_slots = [item for item in sched_res.json()["schedule"] if item["type"] == "class"]
    assert len(class_slots) == 3


def test_legacy_duplicate_logical_load_id_drafts_publish_without_data_loss(ctx):
    """Repairs legacy multi-slot drafts sharing the same logical_load_id without overwriting or deleting."""
    db = ctx["db"]
    engine = ctx["engine"]
    cls = ctx["cls1"]
    math = ctx["math"]
    period = ctx["period"]
    staff_a = ctx["staff_a"]

    # Temporarily drop draft unique index so we can seed pre-fix legacy duplicate drafts
    with engine.begin() as conn:
        conn.execute(text("DROP INDEX IF EXISTS uq_subject_load_draft"))

    shared_id = f"LL_{cls.class_id}_{math.subject_id}_{period.academic_period_id}"
    d1 = SubjectLoad(
        class_id=cls.class_id,
        subject_id=math.subject_id,
        staff_id=staff_a.staff_id,
        academic_period_id=period.academic_period_id,
        start_time="08:00",
        end_time="09:00",
        days_of_week=["MON", "WED"],
        status="draft",
        is_active_version=False,
        logical_load_id=shared_id,
    )
    d2 = SubjectLoad(
        class_id=cls.class_id,
        subject_id=math.subject_id,
        staff_id=staff_a.staff_id,
        academic_period_id=period.academic_period_id,
        start_time="10:00",
        end_time="11:00",
        days_of_week=["TUE", "THU"],
        status="draft",
        is_active_version=False,
        logical_load_id=shared_id,
    )
    db.add_all([d1, d2])
    db.commit()

    r_pub = _batch_save(
        ctx,
        action="publish",
        loads=[
            {
                "subject_load_id": d1.subject_load_id,
                "logical_load_id": shared_id,
                "class_id": cls.class_id,
                "subject_id": math.subject_id,
                "staff_id": staff_a.staff_id,
                "academic_period_id": period.academic_period_id,
                "start_time": "08:00",
                "end_time": "09:00",
                "days_of_week": ["MON", "WED"],
                "status": "draft",
            },
            {
                "subject_load_id": d2.subject_load_id,
                "logical_load_id": shared_id,
                "class_id": cls.class_id,
                "subject_id": math.subject_id,
                "staff_id": staff_a.staff_id,
                "academic_period_id": period.academic_period_id,
                "start_time": "10:00",
                "end_time": "11:00",
                "days_of_week": ["TUE", "THU"],
                "status": "draft",
            },
        ],
        target_class_id=cls.class_id,
    )
    assert r_pub.status_code == 200, r_pub.text
    assert r_pub.json()["saved_count"] == 2

    db.expire_all()
    published = (
        db.query(SubjectLoad)
        .filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.is_active_version.is_(True))
        .order_by(SubjectLoad.start_time.asc())
        .all()
    )
    assert len(published) == 2
    assert [p.logical_load_id for p in published] == [shared_id, f"{shared_id}_s2"]
    assert [(p.start_time, p.days_of_week) for p in published] == [
        ("08:00", ["MON", "WED"]),
        ("10:00", ["TUE", "THU"]),
    ]
    assert db.query(SubjectLoad).filter(SubjectLoad.status == "draft").count() == 0


def test_multi_slot_unlock_edit_republish_preserves_lineage_substitutions_and_split_slots(ctx):
    db = ctx["db"]
    cls = ctx["cls1"]
    math = ctx["math"]
    period = ctx["period"]
    staff_a = ctx["staff_a"]
    staff_b = ctx["staff_b"]
    staff_c = ctx["staff_c"]

    # Rev 1: Publish 2 slots for Math
    r_pub1 = _batch_save(
        ctx,
        action="publish",
        loads=[
            {
                "class_id": cls.class_id,
                "subject_id": math.subject_id,
                "staff_id": staff_a.staff_id,
                "academic_period_id": period.academic_period_id,
                "start_time": "08:00",
                "end_time": "09:00",
                "days_of_week": ["MON", "WED"],
            },
            {
                "class_id": cls.class_id,
                "subject_id": math.subject_id,
                "staff_id": staff_a.staff_id,
                "academic_period_id": period.academic_period_id,
                "start_time": "10:00",
                "end_time": "11:00",
                "days_of_week": ["TUE", "THU"],
            },
        ],
        target_class_id=cls.class_id,
    )
    assert r_pub1.status_code == 200, r_pub1.text
    pub_v1 = (
        db.query(SubjectLoad)
        .filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.is_active_version.is_(True))
        .order_by(SubjectLoad.start_time.asc())
        .all()
    )
    assert len(pub_v1) == 2
    pub_slot1, pub_slot2 = pub_v1

    # Active substitution specifically on Slot 2
    today = SubstitutionService.get_academic_date()
    sub_slot2 = TeacherSubstitution(
        subject_load_id=pub_slot2.subject_load_id,
        original_staff_id=staff_a.staff_id,
        substitute_staff_id=staff_c.staff_id,
        start_date=today - timedelta(days=1),
        end_date=today + timedelta(days=5),
        status="active",
        reason="Slot 2 coverage",
        batch_id=uuid.uuid4(),
    )
    db.add(sub_slot2)
    db.commit()

    # Authorization sees Slot 2 substitution
    assert (
        SubjectLoadAuthorizationService.get_teacher_access_level(
            db, staff_c.staff_id, cls.class_id, math.subject_id, period.academic_period_id
        )
        == SubjectAccessLevel.WRITE
    )

    # Unlock -> Edit Slot 2 (time + teacher A -> B) -> Save Draft -> Publish Rev 2
    r_unlock = _unlock(ctx, cls.class_id)
    assert r_unlock.status_code == 200, r_unlock.text
    unlocked = sorted(r_unlock.json()["loads"], key=lambda x: x["start_time"])
    assert len(unlocked) == 2
    assert unlocked[0]["continued_from_load_id"] == pub_slot1.subject_load_id
    assert unlocked[1]["continued_from_load_id"] == pub_slot2.subject_load_id

    draft_slot1 = unlocked[0]
    draft_slot2 = {
        **unlocked[1],
        "staff_id": staff_b.staff_id,
        "start_time": "13:00",
        "end_time": "14:00",
    }
    r_save_draft = _batch_save(ctx, action="draft", loads=[draft_slot1, draft_slot2], target_class_id=cls.class_id)
    assert r_save_draft.status_code == 200, r_save_draft.text

    r_pub2 = _batch_save(
        ctx,
        action="publish",
        loads=[draft_slot1, draft_slot2],
        target_class_id=cls.class_id,
        base_revision=1,
    )
    assert r_pub2.status_code == 200, r_pub2.text
    assert r_pub2.json()["saved_count"] == 2

    db.expire_all()
    db.refresh(pub_slot1)
    db.refresh(pub_slot2)
    db.refresh(sub_slot2)
    assert (pub_slot1.status, pub_slot1.is_active_version) == ("archived", False)
    assert (pub_slot2.status, pub_slot2.is_active_version) == ("archived", False)

    pub_v2 = (
        db.query(SubjectLoad)
        .filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.is_active_version.is_(True))
        .order_by(SubjectLoad.start_time.asc())
        .all()
    )
    assert len(pub_v2) == 2
    v2_slot1, v2_slot2 = pub_v2
    assert v2_slot1.logical_load_id == pub_slot1.logical_load_id
    assert v2_slot1.continued_from_load_id == pub_slot1.subject_load_id
    assert v2_slot1.staff_id == staff_a.staff_id
    assert v2_slot2.logical_load_id == pub_slot2.logical_load_id
    assert v2_slot2.continued_from_load_id == pub_slot2.subject_load_id
    assert (v2_slot2.staff_id, v2_slot2.start_time, v2_slot2.section_revision, v2_slot2.is_locked) == (
        staff_b.staff_id, "13:00", 2, True
    )
    assert sub_slot2.subject_load_id == v2_slot2.subject_load_id
    assert db.query(SubjectLoad).filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.status == "draft").count() == 0

    logs = db.query(SubjectLoadAssignmentLog).filter(SubjectLoadAssignmentLog.class_id == cls.class_id).all()
    assert len(logs) == 1
    assert (logs[0].logical_load_id, logs[0].subject_load_id, logs[0].old_staff_id, logs[0].new_staff_id) == (
        v2_slot2.logical_load_id, v2_slot2.subject_load_id, staff_a.staff_id, staff_b.staff_id
    )

    # Rev 3: Simulate frontend relocateLoads splitting Slot 1 (spread-copying logical_load_id &
    # continued_from_load_id with subject_load_id=None, placed FIRST in payload array)
    r_unlock3 = _unlock(ctx, cls.class_id)
    assert r_unlock3.status_code == 200
    u3 = sorted(r_unlock3.json()["loads"], key=lambda x: x["start_time"])
    split_new_slot = {
        **u3[0],
        "subject_load_id": None,
        "start_time": "14:00",
        "end_time": "15:00",
        "days_of_week": ["FRI"],
    }
    kept_slot1 = {**u3[0], "days_of_week": ["MON"]}
    kept_slot2 = u3[1]

    r_pub3 = _batch_save(
        ctx,
        action="publish",
        loads=[split_new_slot, kept_slot1, kept_slot2],
        target_class_id=cls.class_id,
        base_revision=2,
    )
    assert r_pub3.status_code == 200, r_pub3.text
    db.expire_all()
    pub_v3 = (
        db.query(SubjectLoad)
        .filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.is_active_version.is_(True))
        .order_by(SubjectLoad.start_time.asc())
        .all()
    )
    assert len(pub_v3) == 3
    v3_s1, v3_s2, v3_s3 = pub_v3
    assert v3_s1.logical_load_id == v2_slot1.logical_load_id
    assert v3_s1.continued_from_load_id == v2_slot1.subject_load_id
    assert v3_s2.logical_load_id == v2_slot2.logical_load_id
    assert v3_s2.continued_from_load_id == v2_slot2.subject_load_id
    assert v3_s3.logical_load_id == f"{pub_slot1.logical_load_id}_s3"
    assert v3_s3.continued_from_load_id is None
    db.refresh(sub_slot2)
    assert sub_slot2.subject_load_id == v3_s2.subject_load_id


def test_multi_slot_intentional_slot_deletion_and_dependency_guards(ctx):
    db = ctx["db"]
    cls = ctx["cls1"]
    math = ctx["math"]
    period = ctx["period"]
    staff_a = ctx["staff_a"]
    staff_c = ctx["staff_c"]

    # Publish 2 slots for Math
    r_pub1 = _batch_save(
        ctx,
        action="publish",
        loads=[
            {
                "class_id": cls.class_id,
                "subject_id": math.subject_id,
                "staff_id": staff_a.staff_id,
                "academic_period_id": period.academic_period_id,
                "start_time": "08:00",
                "end_time": "09:00",
                "days_of_week": ["MON", "WED"],
            },
            {
                "class_id": cls.class_id,
                "subject_id": math.subject_id,
                "staff_id": staff_a.staff_id,
                "academic_period_id": period.academic_period_id,
                "start_time": "10:00",
                "end_time": "11:00",
                "days_of_week": ["TUE", "THU"],
            },
        ],
        target_class_id=cls.class_id,
    )
    assert r_pub1.status_code == 200, r_pub1.text
    pub_s1, pub_s2 = (
        db.query(SubjectLoad)
        .filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.is_active_version.is_(True))
        .order_by(SubjectLoad.start_time.asc())
        .all()
    )

    # Attach live student attendance for Math + active substitution specifically on Slot 1
    db.add(
        AttendanceRecord(
            student_id=ctx["student"].student_id,
            class_id=cls.class_id,
            subject_id=math.subject_id,
            date=period.start_date,
            status="present",
        )
    )
    today = SubstitutionService.get_academic_date()
    sub_s1 = TeacherSubstitution(
        subject_load_id=pub_s1.subject_load_id,
        original_staff_id=staff_a.staff_id,
        substitute_staff_id=staff_c.staff_id,
        start_date=today - timedelta(days=1),
        end_date=today + timedelta(days=5),
        status="active",
        reason="Active sub on slot 1",
        batch_id=uuid.uuid4(),
    )
    db.add(sub_s1)
    db.commit()

    r_unlock = _unlock(ctx, cls.class_id)
    assert r_unlock.status_code == 200
    d_s1, d_s2 = sorted(r_unlock.json()["loads"], key=lambda x: x["start_time"])

    # 1. Deleting Slot 1 (which owns an active substitution) MUST be blocked with 409
    r_blocked_sub = _batch_save(
        ctx,
        action="publish",
        loads=[d_s2],
        target_class_id=cls.class_id,
        base_revision=1,
    )
    assert r_blocked_sub.status_code == 409, r_blocked_sub.text
    assert "active teacher substitution" in r_blocked_sub.json()["detail"].lower()
    db.expire_all()
    assert (
        db.query(SubjectLoad)
        .filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.is_active_version.is_(True))
        .count()
        == 2
    )

    # 2. Deleting Slot 2 (no active substitution, while Math still has Slot 1) MUST SUCCEED
    #    even though Math has live attendance records!
    r_del_slot2 = _batch_save(
        ctx,
        action="publish",
        loads=[d_s1],
        target_class_id=cls.class_id,
        base_revision=1,
    )
    assert r_del_slot2.status_code == 200, r_del_slot2.text
    assert r_del_slot2.json()["saved_count"] == 1

    db.expire_all()
    active_v2 = (
        db.query(SubjectLoad)
        .filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.is_active_version.is_(True))
        .all()
    )
    assert len(active_v2) == 1
    assert active_v2[0].logical_load_id == pub_s1.logical_load_id
    assert active_v2[0].continued_from_load_id == pub_s1.subject_load_id
    assert active_v2[0].section_revision == 2
    assert db.query(SubjectLoad).filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.status == "draft").count() == 0
    db.refresh(sub_s1)
    assert sub_s1.subject_load_id == active_v2[0].subject_load_id

    # 3. Trying to delete the LAST remaining slot of populated Math MUST be blocked with 409
    sub_s1.status = "completed"
    db.commit()
    assert _unlock(ctx, cls.class_id).status_code == 200
    r_blocked_last = _batch_save(
        ctx,
        action="publish",
        loads=[],
        target_class_id=cls.class_id,
        base_revision=2,
    )
    assert r_blocked_last.status_code == 409, r_blocked_last.text
    assert "Cannot remove 'Mathematics 7'" in r_blocked_last.json()["detail"]
    assert "attendance records" in r_blocked_last.json()["detail"]

    db.expire_all()
    still_active = (
        db.query(SubjectLoad)
        .filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.is_active_version.is_(True))
        .one()
    )
    assert still_active.subject_load_id == active_v2[0].subject_load_id


def test_failed_publish_is_atomic_across_conflicts_and_multi_section_scopes(ctx):
    db = ctx["db"]
    cls1 = ctx["cls1"]
    cls2 = ctx["cls2"]
    math = ctx["math"]
    sci = ctx["sci"]
    period = ctx["period"]
    staff_a = ctx["staff_a"]
    staff_b = ctx["staff_b"]

    # Publish Rev 1 for both sections
    assert _batch_save(
        ctx,
        action="publish",
        loads=[
            {
                "class_id": cls1.class_id,
                "subject_id": math.subject_id,
                "staff_id": staff_a.staff_id,
                "academic_period_id": period.academic_period_id,
                "start_time": "08:00",
                "end_time": "09:00",
                "days_of_week": ["MON", "WED"],
            },
            {
                "class_id": cls1.class_id,
                "subject_id": math.subject_id,
                "staff_id": staff_a.staff_id,
                "academic_period_id": period.academic_period_id,
                "start_time": "10:00",
                "end_time": "11:00",
                "days_of_week": ["TUE", "THU"],
            },
        ],
        target_class_id=cls1.class_id,
    ).status_code == 200

    assert _batch_save(
        ctx,
        action="publish",
        loads=[
            {
                "class_id": cls2.class_id,
                "subject_id": sci.subject_id,
                "staff_id": staff_b.staff_id,
                "academic_period_id": period.academic_period_id,
                "start_time": "08:00",
                "end_time": "09:00",
                "days_of_week": ["MON", "TUE", "WED"],
            }
        ],
        target_class_id=cls2.class_id,
    ).status_code == 200

    # Add attendance dependency on Section 2's Science so deleting it triggers 409
    db.add(
        AttendanceRecord(
            student_id=uuid.uuid4(),
            class_id=cls2.class_id,
            subject_id=sci.subject_id,
            date=period.start_date,
            status="present",
        )
    )
    db.commit()

    u1 = sorted(_unlock(ctx, cls1.class_id).json()["loads"], key=lambda x: x["start_time"])
    u2 = _unlock(ctx, cls2.class_id).json()["loads"]

    # Case A: Validation conflict (overlap between Slot 1 & Slot 2 in Section 1) -> 400, zero mutations
    overlap_slot2 = {**u1[1], "start_time": "08:00", "end_time": "09:00", "days_of_week": ["MON"]}
    r_conflict = _batch_save(
        ctx,
        action="publish",
        loads=[u1[0], overlap_slot2],
        target_class_id=cls1.class_id,
        base_revision=1,
    )
    assert r_conflict.status_code == 400, r_conflict.text
    db.expire_all()
    assert (
        db.query(SubjectLoad)
        .filter(SubjectLoad.class_id == cls1.class_id, SubjectLoad.is_active_version.is_(True))
        .count()
        == 2
    )
    assert (
        db.query(SubjectLoad)
        .filter(SubjectLoad.class_id == cls1.class_id, SubjectLoad.status == "draft")
        .count()
        == 2
    )

    # Case B: Multi-section publish_scope="all" where Section 1 is valid (edited to 13:00)
    # but Section 2 fails the deletion guard (trying to replace populated Science with Math).
    # Section 1 MUST NOT be partially published or archived!
    edited_cls1_slot1 = {**u1[0], "start_time": "13:00", "end_time": "14:00"}
    cls2_replace_with_math = {
        "class_id": cls2.class_id,
        "subject_id": math.subject_id,
        "staff_id": staff_b.staff_id,
        "academic_period_id": period.academic_period_id,
        "start_time": "08:00",
        "end_time": "09:00",
        "days_of_week": ["MON", "TUE", "WED"],
        "status": "draft",
        "base_revision": 1,
    }
    r_multi_fail = _batch_save(
        ctx,
        action="publish",
        publish_scope="all",
        loads=[edited_cls1_slot1, u1[1], cls2_replace_with_math],
    )
    assert r_multi_fail.status_code == 409, r_multi_fail.text
    assert "Cannot remove 'Science 7'" in r_multi_fail.json()["detail"]

    db.expire_all()
    cls1_pub = (
        db.query(SubjectLoad)
        .filter(SubjectLoad.class_id == cls1.class_id, SubjectLoad.is_active_version.is_(True))
        .order_by(SubjectLoad.start_time.asc())
        .all()
    )
    assert len(cls1_pub) == 2
    assert [(p.start_time, p.section_revision, p.status) for p in cls1_pub] == [
        ("08:00", 1, "published"),
        ("10:00", 1, "published"),
    ]
    assert db.query(SubjectLoad).filter(SubjectLoad.class_id == cls1.class_id, SubjectLoad.status == "archived").count() == 0
    assert db.query(SubjectLoad).filter(SubjectLoad.class_id == cls1.class_id, SubjectLoad.status == "draft").count() == 2

    # Case C: Stale base_revision returns 409 with zero mutations
    r_stale = _batch_save(
        ctx,
        action="publish",
        publish_scope="all",
        base_revision=99,
        loads=[edited_cls1_slot1, u1[1], u2[0]],
    )
    assert r_stale.status_code == 409, r_stale.text
    db.expire_all()
    assert db.query(SubjectLoad).filter(SubjectLoad.class_id == cls1.class_id, SubjectLoad.status == "archived").count() == 0


def test_classify_section_changes_handles_multi_slot_and_strict_identity():
    base_s1 = SubjectLoad(
        subject_load_id=1,
        class_id=10,
        subject_id=100,
        staff_id="T1",
        academic_period_id=1,
        start_time="08:00",
        end_time="09:00",
        days_of_week=["MON", "WED"],
        logical_load_id="LL_10_100_1",
    )
    base_s2 = SubjectLoad(
        subject_load_id=2,
        class_id=10,
        subject_id=100,
        staff_id="T1",
        academic_period_id=1,
        start_time="10:00",
        end_time="11:00",
        days_of_week=["TUE", "THU"],
        logical_load_id="LL_10_100_1_s2",
    )
    # Keep slot 1 unchanged, remove slot 2, and try spoofing slot 2's logical_load_id on a different subject
    draft_s1 = SubjectLoad(
        class_id=10,
        subject_id=100,
        staff_id="T1",
        academic_period_id=1,
        start_time="08:00",
        end_time="09:00",
        days_of_week=["MON", "WED"],
        logical_load_id="LL_10_100_1",
        continued_from_load_id=1,
    )
    spoof_other_subject = SubjectLoad(
        class_id=10,
        subject_id=200,
        staff_id="T1",
        academic_period_id=1,
        start_time="10:00",
        end_time="11:00",
        days_of_week=["TUE", "THU"],
        logical_load_id="LL_10_100_1_s2",
    )

    changes = SubjectLoadDependencyService.classify_section_changes(
        [base_s1, base_s2],
        [draft_s1, spoof_other_subject],
    )
    by_type = {c["change_type"]: c for c in changes}
    assert set(by_type.keys()) == {ChangeType.UNCHANGED, ChangeType.REMOVED_SLOT, ChangeType.NEW_SUBJECT}
    assert by_type[ChangeType.REMOVED_SLOT]["baseline_load"] is base_s2
    assert by_type[ChangeType.NEW_SUBJECT]["draft_load"] is spoof_other_subject


def test_period_template_scheduled_revision_activates_multi_slot_loads_one_to_one(ctx):
    db = ctx["db"]
    cls = ctx["cls1"]
    math = ctx["math"]
    period = ctx["period"]
    staff_a = ctx["staff_a"]
    staff_c = ctx["staff_c"]

    cls.period_template_group = "JHS_45MIN"
    offering = db.query(SubjectOffering).filter(SubjectOffering.subject_id == math.subject_id).one()
    offering.minutes = 45
    db.commit()

    from app.api.v1.routes.SubjectLoads import ensure_default_period_templates
    ensure_default_period_templates(db)
    jhs_slots = (
        db.query(PeriodTemplateSlot)
        .filter(PeriodTemplateSlot.template_group == "JHS_45MIN")
        .order_by(PeriodTemplateSlot.display_order.asc())
        .all()
    )
    p6 = next(s for s in jhs_slots if s.slot_name == "Period 6")
    p7 = next(s for s in jhs_slots if s.slot_name == "Period 7")

    r_pub = _batch_save(
        ctx,
        action="publish",
        loads=[
            {
                "class_id": cls.class_id,
                "subject_id": math.subject_id,
                "staff_id": staff_a.staff_id,
                "academic_period_id": period.academic_period_id,
                "slot_id": p6.slot_id,
                "start_time": p6.start_time,
                "end_time": p6.end_time,
                "days_of_week": ["MON", "WED"],
            },
            {
                "class_id": cls.class_id,
                "subject_id": math.subject_id,
                "staff_id": staff_a.staff_id,
                "academic_period_id": period.academic_period_id,
                "slot_id": p7.slot_id,
                "start_time": p7.start_time,
                "end_time": p7.end_time,
                "days_of_week": ["TUE", "THU"],
            },
        ],
        target_class_id=cls.class_id,
    )
    assert r_pub.status_code == 200, r_pub.text
    pub_s1, pub_s2 = (
        db.query(SubjectLoad)
        .filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.is_active_version.is_(True))
        .order_by(SubjectLoad.subject_load_id.asc())
        .all()
    )

    today = SubstitutionService.get_academic_date()
    sub_s2 = TeacherSubstitution(
        subject_load_id=pub_s2.subject_load_id,
        original_staff_id=staff_a.staff_id,
        substitute_staff_id=staff_c.staff_id,
        start_date=today - timedelta(days=1),
        end_date=today + timedelta(days=30),
        status="active",
        reason="Template revision test",
        batch_id=uuid.uuid4(),
    )
    db.add(sub_s2)
    db.commit()

    def _shift_5(hhmm: str) -> str:
        h, m = map(int, hhmm.split(":"))
        total = h * 60 + m + 5
        return f"{total // 60:02d}:{total % 60:02d}"

    new_p6_start, new_p6_end = _shift_5(p6.start_time), _shift_5(p6.end_time)
    new_p7_start, new_p7_end = _shift_5(p7.start_time), _shift_5(p7.end_time)

    # Shift end-of-day Period 6 & Period 7 by +5 minutes (no break overlap, preserves 45m duration)
    from app.schemas.SubjectLoad import PeriodTemplateSlotSchema
    submitted = []
    for s in jhs_slots:
        st, et = s.start_time, s.end_time
        if s.slot_id == p6.slot_id:
            st, et = new_p6_start, new_p6_end
        elif s.slot_id == p7.slot_id:
            st, et = new_p7_start, new_p7_end
        submitted.append(
            PeriodTemplateSlotSchema(
                slot_id=s.slot_id,
                template_group=s.template_group,
                slot_name=s.slot_name,
                slot_type=s.slot_type,
                start_time=st,
                end_time=et,
                is_locked_break=bool(s.is_locked_break),
                display_order=s.display_order,
            )
        )

    future_date = today + timedelta(days=7)
    preview = PeriodTemplateRevisionService.create_preview(
        db,
        period=period,
        submitted_slots=submitted,
        effective_date=future_date,
        actor="admin@c1.test",
    )
    apply_res = PeriodTemplateRevisionService.apply_preview(
        db,
        token=preview["preview_token"],
        confirmation="REPLACE PUBLISHED SCHEDULES",
        actor="admin@c1.test",
    )
    assert apply_res["created_load_count"] == 2

    activated = PeriodTemplateRevisionService.activate_due_revisions(db, as_of=future_date)
    assert activated == 1

    db.expire_all()
    db.refresh(pub_s1)
    db.refresh(pub_s2)
    db.refresh(sub_s2)
    assert (pub_s1.status, pub_s1.is_active_version) == ("archived", False)
    assert (pub_s2.status, pub_s2.is_active_version) == ("archived", False)

    active_now = (
        db.query(SubjectLoad)
        .filter(SubjectLoad.class_id == cls.class_id, SubjectLoad.is_active_version.is_(True))
        .order_by(SubjectLoad.start_time.asc())
        .all()
    )
    assert len(active_now) == 2
    assert [(a.logical_load_id, a.continued_from_load_id, a.start_time, a.end_time) for a in active_now] == [
        (pub_s1.logical_load_id, pub_s1.subject_load_id, new_p6_start, new_p6_end),
        (pub_s2.logical_load_id, pub_s2.subject_load_id, new_p7_start, new_p7_end),
    ]
    assert sub_s2.subject_load_id == active_now[1].subject_load_id

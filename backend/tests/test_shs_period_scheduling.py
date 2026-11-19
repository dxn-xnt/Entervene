from __future__ import annotations

from datetime import date
import uuid

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.routes.SubjectLoads import (
    _normalize_jhs_load_slots,
    ensure_default_period_templates,
)
from app.core.Security import create_access_token
from app.db.Base import Base
from app.db.Session import get_db
from app.main import app
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.people.AcademicStaff import AcademicStaff
from app.models.auth.UserAccount import UserAccount
from app.models.settings.Setting import Setting, SettingType
from app.schemas.SubjectLoad import SubjectLoadItem
from app.services.academic.ConflictDetectorService import ConflictDetectorService
from app.services.academic.PeriodTemplateResolver import PeriodTemplateResolver


@pytest.fixture
def shs_ctx():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db = TestingSessionLocal()

    year = AcademicYear(
        academic_year_id=1,
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    period = AcademicPeriod(
        academic_period_id=1,
        academic_year_id=1,
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        period_progress_ratio=0.3333,
        start_date=date(2026, 6, 1),
        end_date=date(2026, 9, 30),
        is_active=True,
    )
    grading = GradingTemplate(
        grading_template_id=1,
        template_name="Core",
        passing_threshold=75.0,
        status="active",
    )
    lvl_jhs = AcademicLevel(academic_level_id=9, level_name="Grade 9", grade_level=9)
    lvl_11 = AcademicLevel(academic_level_id=11, level_name="Grade 11", grade_level=11)
    lvl_12 = AcademicLevel(academic_level_id=12, level_name="Grade 12", grade_level=12)

    # Mark legacy one-time backfill already completed so tests control class templates explicitly
    backfill_flag = Setting(
        key="shs_template_groups_backfilled_v1",
        value="true",
        type=SettingType.BOOLEAN,
        group="general",
        is_public=False,
    )

    db.add_all([year, period, grading, lvl_jhs, lvl_11, lvl_12, backfill_flag])
    db.commit()
    ensure_default_period_templates(db)

    # Custom Grade 12 Medical template with 80-min blocks and a custom break
    custom_slots = [
        PeriodTemplateSlot(
            template_group="SHS_MEDICAL_CUSTOM",
            slot_name="Homeroom",
            slot_type="HOMEROOM",
            start_time="07:30",
            end_time="08:00",
            is_locked_break=True,
            display_order=1,
        ),
        PeriodTemplateSlot(
            template_group="SHS_MEDICAL_CUSTOM",
            slot_name="Clinical Block 1",
            slot_type="CLASS",
            start_time="08:00",
            end_time="09:20",
            is_locked_break=False,
            display_order=2,
        ),
        PeriodTemplateSlot(
            template_group="SHS_MEDICAL_CUSTOM",
            slot_name="Mid-Morning Break",
            slot_type="RECESS",
            start_time="09:20",
            end_time="09:40",
            is_locked_break=True,
            display_order=3,
        ),
        PeriodTemplateSlot(
            template_group="SHS_MEDICAL_CUSTOM",
            slot_name="Clinical Block 2",
            slot_type="CLASS",
            start_time="09:40",
            end_time="11:00",
            is_locked_break=False,
            display_order=4,
        ),
    ]
    db.add_all(custom_slots)

    cls_zara = Class(
        class_id=111,
        section_name="11-Zara (Medical)",
        academic_year_id=1,
        academic_level_id=11,
        period_template_group="SHS_CAMPOS_ZARA",
        class_status="active",
    )
    cls_reyes = Class(
        class_id=112,
        section_name="11-Reyes (Engineering)",
        academic_year_id=1,
        academic_level_id=11,
        period_template_group="SHS_DELMUNDO_REYES",
        class_status="active",
    )
    cls_g12_custom = Class(
        class_id=121,
        section_name="12-Galen (Medical Custom)",
        academic_year_id=1,
        academic_level_id=12,
        period_template_group="SHS_MEDICAL_CUSTOM",
        class_status="active",
    )
    cls_unassigned = Class(
        class_id=122,
        section_name="12-Unconfigured",
        academic_year_id=1,
        academic_level_id=12,
        period_template_group=None,
        class_status="active",
    )
    cls_jhs_misassigned = Class(
        class_id=123,
        section_name="12-WrongJhsTemplate",
        academic_year_id=1,
        academic_level_id=12,
        period_template_group="JHS_45MIN",
        class_status="active",
    )

    sub_60 = Subject(
        subject_id=501,
        subject_name="General Biology 1",
        subject_codename="BIO1",
        academic_level_id=11,
        grading_template_id=1,
        is_core=True,
        status="active",
    )
    sub_96 = Subject(
        subject_id=502,
        subject_name="Research Lab",
        subject_codename="RESLAB",
        academic_level_id=11,
        grading_template_id=1,
        is_core=False,
        status="active",
    )
    sub_72 = Subject(
        subject_id=503,
        subject_name="Pre-Calculus",
        subject_codename="PRECAL",
        academic_level_id=11,
        grading_template_id=1,
        is_core=True,
        status="active",
    )
    sub_80 = Subject(
        subject_id=504,
        subject_name="Anatomy Practicum",
        subject_codename="ANAT",
        academic_level_id=12,
        grading_template_id=1,
        is_core=True,
        status="active",
    )
    sub_90 = Subject(
        subject_id=505,
        subject_name="Capstone Seminar",
        subject_codename="CAP",
        academic_level_id=12,
        grading_template_id=1,
        is_core=False,
        status="active",
    )

    teacher_a = AcademicStaff(
        staff_id="T_SHS_1",
        first_name="Elena",
        last_name="Navarro",
        employment_status="active",
    )
    teacher_b = AcademicStaff(
        staff_id="T_SHS_2",
        first_name="Marco",
        last_name="Velasco",
        employment_status="active",
    )

    offerings = [
        SubjectOffering(subject_id=501, academic_year_id=1, academic_level_id=11, academic_period_id=1, minutes=60, status="active"),
        SubjectOffering(subject_id=502, academic_year_id=1, academic_level_id=11, academic_period_id=1, minutes=96, status="active"),
        SubjectOffering(subject_id=503, academic_year_id=1, academic_level_id=11, academic_period_id=1, minutes=72, status="active"),
        SubjectOffering(subject_id=504, academic_year_id=1, academic_level_id=12, academic_period_id=1, minutes=80, status="active"),
        SubjectOffering(subject_id=505, academic_year_id=1, academic_level_id=12, academic_period_id=1, minutes=90, status="active"),
    ]

    db.add_all([
        cls_zara,
        cls_reyes,
        cls_g12_custom,
        cls_unassigned,
        cls_jhs_misassigned,
        sub_60,
        sub_96,
        sub_72,
        sub_80,
        sub_90,
        teacher_a,
        teacher_b,
        *offerings,
    ])
    db.commit()

    admin_uid = uuid.uuid4()
    db.add(UserAccount(user_id=admin_uid, email="admin@entervene.test", account_status="active"))
    db.commit()

    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    token = create_access_token(str(admin_uid), "admin")
    client = TestClient(app)

    try:
        yield {
            "db": db,
            "client": client,
            "headers": {"Authorization": f"Bearer {token}"},
            "period": period,
            "cls_zara": cls_zara,
            "cls_reyes": cls_reyes,
            "cls_g12_custom": cls_g12_custom,
            "cls_unassigned": cls_unassigned,
            "cls_jhs_misassigned": cls_jhs_misassigned,
            "teacher_a": teacher_a,
            "teacher_b": teacher_b,
        }
    finally:
        app.dependency_overrides.clear()
        db.close()
        engine.dispose()


def _get_slot(db, group: str, name: str) -> PeriodTemplateSlot:
    return (
        db.query(PeriodTemplateSlot)
        .filter(
            PeriodTemplateSlot.template_group == group,
            PeriodTemplateSlot.slot_name == name,
        )
        .one()
    )


def test_period_template_resolver_respects_each_shs_template_and_never_falls_back_to_jhs(shs_ctx):
    db = shs_ctx["db"]

    zara_slots = PeriodTemplateResolver.slots_for_class(db, shs_ctx["cls_zara"])
    reyes_slots = PeriodTemplateResolver.slots_for_class(db, shs_ctx["cls_reyes"])
    custom_slots = PeriodTemplateResolver.slots_for_class(db, shs_ctx["cls_g12_custom"])
    unassigned_slots = PeriodTemplateResolver.slots_for_class(db, shs_ctx["cls_unassigned"])
    wrong_jhs_slots = PeriodTemplateResolver.slots_for_class(db, shs_ctx["cls_jhs_misassigned"])

    assert all(slot.template_group == "SHS_CAMPOS_ZARA" for slot in zara_slots)
    assert any(slot.slot_name == "Lab Block" and (slot.start_time, slot.end_time) == ("10:24", "12:00") for slot in zara_slots)

    assert all(slot.template_group == "SHS_DELMUNDO_REYES" for slot in reyes_slots)
    assert any(slot.slot_name == "Period 1" and (slot.start_time, slot.end_time) == ("08:00", "09:12") for slot in reyes_slots)

    assert all(slot.template_group == "SHS_MEDICAL_CUSTOM" for slot in custom_slots)
    assert [slot.slot_name for slot in custom_slots if slot.slot_type == "CLASS"] == [
        "Clinical Block 1",
        "Clinical Block 2",
    ]

    # Unassigned or JHS-misassigned SHS sections must NOT fall back to JHS_45MIN
    assert unassigned_slots == []
    assert wrong_jhs_slots == []


def test_studio_data_exposes_default_and_custom_shs_templates_without_jhs_pollution(shs_ctx):
    res = shs_ctx["client"].get(
        "/api/v1/subject-loads/studio-data?academic_period_id=1",
        headers=shs_ctx["headers"],
    )
    assert res.status_code == 200, res.text
    slots = res.json()["period_template_slots"]
    groups = {slot["template_group"] for slot in slots}

    assert {"JHS_45MIN", "SHS_CAMPOS_ZARA", "SHS_DELMUNDO_REYES", "SHS_MEDICAL_CUSTOM"}.issubset(groups)
    # JHS_45MIN must remain intact even when an SHS section has period_template_group=None or JHS_45MIN
    jhs_slots = [slot for slot in slots if slot["template_group"] == "JHS_45MIN"]
    assert len(jhs_slots) == 13
    # Custom SHS template slots must keep their exact 80-min times
    custom_class_slots = [
        (slot["slot_name"], slot["start_time"], slot["end_time"])
        for slot in slots
        if slot["template_group"] == "SHS_MEDICAL_CUSTOM" and slot["slot_type"] == "CLASS"
    ]
    assert custom_class_slots == [
        ("Clinical Block 1", "08:00", "09:20"),
        ("Clinical Block 2", "09:40", "11:00"),
    ]


def test_shs_slot_id_is_authoritative_and_rejects_breaks_and_cross_template_slots(shs_ctx):
    db = shs_ctx["db"]
    zara_p1 = _get_slot(db, "SHS_CAMPOS_ZARA", "Period 1")
    zara_recess = _get_slot(db, "SHS_CAMPOS_ZARA", "Morning Recess")
    reyes_p1 = _get_slot(db, "SHS_DELMUNDO_REYES", "Period 1")
    jhs_p1 = _get_slot(db, "JHS_45MIN", "Period 1")
    custom_b1 = _get_slot(db, "SHS_MEDICAL_CUSTOM", "Clinical Block 1")

    # 1. Valid SHS slot_id overwrites forged client times with authoritative slot times
    normalized = _normalize_jhs_load_slots(db, [
        SubjectLoadItem(
            class_id=111,
            subject_id=501,
            academic_period_id=1,
            slot_id=zara_p1.slot_id,
            start_time="15:00",
            end_time="16:00",
            days_of_week=["MON", "WED"],
            status="draft",
        ),
        SubjectLoadItem(
            class_id=121,
            subject_id=504,
            academic_period_id=1,
            slot_id=custom_b1.slot_id,
            start_time="11:00",
            end_time="12:00",
            days_of_week=["TUE", "THU"],
            status="draft",
        ),
    ])
    assert (normalized[0].slot_id, normalized[0].start_time, normalized[0].end_time) == (zara_p1.slot_id, "08:00", "09:00")
    assert (normalized[1].slot_id, normalized[1].start_time, normalized[1].end_time) == (custom_b1.slot_id, "08:00", "09:20")

    # 2. Break slot on SHS section is rejected with 422
    res_break = shs_ctx["client"].post(
        "/api/v1/subject-loads/validate",
        headers=shs_ctx["headers"],
        json={
            "academic_period_id": 1,
            "loads": [{
                "class_id": 111,
                "subject_id": 501,
                "staff_id": "T_SHS_1",
                "academic_period_id": 1,
                "slot_id": zara_recess.slot_id,
                "start_time": zara_recess.start_time,
                "end_time": zara_recess.end_time,
                "days_of_week": ["MON"],
                "status": "draft",
            }],
        },
    )
    assert res_break.status_code == 422

    # 3. Slot from a DIFFERENT SHS template (SHS_DELMUNDO_REYES -> SHS_CAMPOS_ZARA) is rejected with 422
    res_wrong_shs = shs_ctx["client"].post(
        "/api/v1/subject-loads/validate",
        headers=shs_ctx["headers"],
        json={
            "academic_period_id": 1,
            "loads": [{
                "class_id": 111,
                "subject_id": 503,
                "staff_id": "T_SHS_1",
                "academic_period_id": 1,
                "slot_id": reyes_p1.slot_id,
                "start_time": reyes_p1.start_time,
                "end_time": reyes_p1.end_time,
                "days_of_week": ["MON"],
                "status": "draft",
            }],
        },
    )
    assert res_wrong_shs.status_code == 422

    # 4. JHS slot submitted for an SHS section (even one misassigned JHS_45MIN) is rejected with 422
    for shs_class_id in (111, 122, 123):
        res_jhs_slot = shs_ctx["client"].post(
            "/api/v1/subject-loads/validate",
            headers=shs_ctx["headers"],
            json={
                "academic_period_id": 1,
                "loads": [{
                    "class_id": shs_class_id,
                    "subject_id": 501 if shs_class_id == 111 else 504,
                    "staff_id": "T_SHS_1",
                    "academic_period_id": 1,
                    "slot_id": jhs_p1.slot_id,
                    "start_time": jhs_p1.start_time,
                    "end_time": jhs_p1.end_time,
                    "days_of_week": ["MON"],
                    "status": "draft",
                }],
            },
        )
        assert res_jhs_slot.status_code == 422


def test_shs_duration_mismatch_and_missing_slot_and_no_false_jhs_split_warning(shs_ctx):
    db = shs_ctx["db"]
    zara_lab = _get_slot(db, "SHS_CAMPOS_ZARA", "Lab Block")  # 96 min

    # 1. 60-min Grade 11 offering placed on 96-min Lab Block triggers OFFERING_DURATION_MISMATCH
    mismatch_res = shs_ctx["client"].post(
        "/api/v1/subject-loads/validate",
        headers=shs_ctx["headers"],
        json={
            "academic_period_id": 1,
            "loads": [{
                "class_id": 111,
                "subject_id": 501,
                "staff_id": "T_SHS_1",
                "academic_period_id": 1,
                "slot_id": zara_lab.slot_id,
                "start_time": zara_lab.start_time,
                "end_time": zara_lab.end_time,
                "days_of_week": ["MON", "WED"],
                "status": "draft",
            }],
        },
    )
    assert mismatch_res.status_code == 200
    rules = {c["rule"] for c in mismatch_res.json()["conflicts"]}
    assert "OFFERING_DURATION_MISMATCH" in rules
    assert "CORE_SUBJECT_SPLIT_SCHEDULE" not in rules

    # 2. 72-min offering on SHS_CAMPOS_ZARA (only 60m & 96m slots) -> NO_MATCHING_DURATION_SLOT
    #    Same 72-min offering on SHS_DELMUNDO_REYES -> NO such error!
    missing_res = shs_ctx["client"].post(
        "/api/v1/subject-loads/validate",
        headers=shs_ctx["headers"],
        json={
            "academic_period_id": 1,
            "loads": [
                {
                    "class_id": 111,
                    "subject_id": 503,
                    "staff_id": "T_SHS_1",
                    "academic_period_id": 1,
                    "slot_id": None,
                    "start_time": None,
                    "end_time": None,
                    "days_of_week": [],
                    "status": "draft",
                },
                {
                    "class_id": 112,
                    "subject_id": 503,
                    "staff_id": "T_SHS_2",
                    "academic_period_id": 1,
                    "slot_id": None,
                    "start_time": None,
                    "end_time": None,
                    "days_of_week": [],
                    "status": "draft",
                },
            ],
        },
    )
    assert missing_res.status_code == 200
    missing_conflicts = [c for c in missing_res.json()["conflicts"] if c["rule"] == "NO_MATCHING_DURATION_SLOT"]
    assert [c["class_id"] for c in missing_conflicts] == [111]

    # 3. Unassigned SHS section (122) emits UNCONFIGURED_BELL_SCHEDULE + NO_MATCHING_DURATION_SLOT
    #    and never triggers false JHS CORE_SUBJECT_SPLIT_SCHEDULE warnings.
    unassigned_res = ConflictDetectorService.validate_loads(
        db=db,
        loads=[
            SubjectLoadItem(
                class_id=122,
                subject_id=504,
                staff_id="T_SHS_1",
                academic_period_id=1,
                start_time=None,
                end_time=None,
                days_of_week=["MON", "WED"],
                status="draft",
            )
        ],
        academic_period=shs_ctx["period"],
    )
    unassigned_rules = {c.rule for c in unassigned_res.conflicts}
    assert "UNCONFIGURED_BELL_SCHEDULE" in unassigned_rules
    assert "NO_MATCHING_DURATION_SLOT" in unassigned_rules
    assert "CORE_SUBJECT_SPLIT_SCHEDULE" not in unassigned_rules


def test_existing_custom_shs_schedules_are_preserved_without_silent_overwriting(shs_ctx):
    db = shs_ctx["db"]

    # Seed an existing custom saved SHS draft (08:15-09:15, 60 min, slot_id=None)
    # that avoids breaks (Morning Recess is 10:00-10:24) and matches the 60-min offering.
    custom_draft = SubjectLoad(
        class_id=111,
        subject_id=501,
        staff_id="T_SHS_1",
        academic_period_id=1,
        slot_id=None,
        start_time="08:15",
        end_time="09:15",
        days_of_week=["MON", "WED"],
        status="draft",
        is_locked=False,
    )
    # Seed a published locked custom Grade 12 schedule (08:05-09:25? no, 08:00-09:20 or 11:00-12:20 custom 80-min)
    custom_published = SubjectLoad(
        class_id=121,
        subject_id=504,
        staff_id="T_SHS_2",
        academic_period_id=1,
        slot_id=None,
        start_time="11:00",
        end_time="12:20",
        days_of_week=["TUE", "THU"],
        status="published",
        is_active_version=True,
        is_locked=True,
        section_revision=1,
    )
    db.add_all([custom_draft, custom_published])
    db.commit()

    # Re-saving the custom draft without slot_id preserves 08:15-09:15 verbatim
    save_res = shs_ctx["client"].post(
        "/api/v1/subject-loads/batch-save",
        headers=shs_ctx["headers"],
        json={
            "academic_period_id": 1,
            "academic_level_id": 11,
            "action": "draft",
            "publish_scope": "section",
            "target_class_id": 111,
            "loads": [{
                "subject_load_id": custom_draft.subject_load_id,
                "class_id": 111,
                "subject_id": 501,
                "staff_id": "T_SHS_1",
                "academic_period_id": 1,
                "slot_id": None,
                "start_time": "08:15",
                "end_time": "09:15",
                "days_of_week": ["MON", "WED"],
                "status": "draft",
            }],
        },
    )
    assert save_res.status_code == 200, save_res.text

    refreshed_draft = db.query(SubjectLoad).filter(SubjectLoad.class_id == 111).one()
    assert (refreshed_draft.slot_id, refreshed_draft.start_time, refreshed_draft.end_time) == (None, "08:15", "09:15")

    refreshed_pub = db.query(SubjectLoad).filter(SubjectLoad.class_id == 121).one()
    assert (refreshed_pub.slot_id, refreshed_pub.start_time, refreshed_pub.end_time, refreshed_pub.status) == (
        None, "11:00", "12:20", "published"
    )


def test_multi_slot_shs_period_publish_and_cross_template_teacher_overlap_detection(shs_ctx):
    db = shs_ctx["db"]
    custom_b1 = _get_slot(db, "SHS_MEDICAL_CUSTOM", "Clinical Block 1")  # 08:00-09:20
    custom_b2 = _get_slot(db, "SHS_MEDICAL_CUSTOM", "Clinical Block 2")  # 09:40-11:00
    reyes_p1 = _get_slot(db, "SHS_DELMUNDO_REYES", "Period 1")           # 08:00-09:12

    # Publish a 2-slot Grade 12 subject using authoritative SHS slot_ids
    pub_res = shs_ctx["client"].post(
        "/api/v1/subject-loads/batch-save",
        headers=shs_ctx["headers"],
        json={
            "academic_period_id": 1,
            "academic_level_id": 12,
            "action": "publish",
            "publish_scope": "section",
            "target_class_id": 121,
            "loads": [
                {
                    "class_id": 121,
                    "subject_id": 504,
                    "staff_id": "T_SHS_1",
                    "academic_period_id": 1,
                    "slot_id": custom_b1.slot_id,
                    "start_time": "15:00",  # Forged; overwritten authoritatively from slot_id
                    "end_time": "16:00",
                    "days_of_week": ["MON", "WED"],
                    "status": "draft",
                },
                {
                    "class_id": 121,
                    "subject_id": 504,
                    "staff_id": "T_SHS_1",
                    "academic_period_id": 1,
                    "slot_id": custom_b2.slot_id,
                    "start_time": "16:00",  # Forged; overwritten authoritatively from slot_id
                    "end_time": "17:00",
                    "days_of_week": ["TUE", "THU"],
                    "status": "draft",
                },
            ],
        },
    )
    assert pub_res.status_code == 200, pub_res.text

    published_rows = (
        db.query(SubjectLoad)
        .filter(
            SubjectLoad.class_id == 121,
            SubjectLoad.status == "published",
            SubjectLoad.is_active_version.is_(True),
        )
        .order_by(SubjectLoad.start_time.asc())
        .all()
    )
    assert len(published_rows) == 2
    assert [(r.slot_id, r.start_time, r.end_time, r.staff_id) for r in published_rows] == [
        (custom_b1.slot_id, "08:00", "09:20", "T_SHS_1"),
        (custom_b2.slot_id, "09:40", "11:00", "T_SHS_1"),
    ]

    # Assigning the same teacher to SHS_DELMUNDO_REYES Period 1 (08:00-09:12 MON)
    # overlaps with 12-Galen Clinical Block 1 (08:00-09:20 MON) and blocks publish.
    overlap_res = shs_ctx["client"].post(
        "/api/v1/subject-loads/batch-save",
        headers=shs_ctx["headers"],
        json={
            "academic_period_id": 1,
            "academic_level_id": 11,
            "action": "publish",
            "publish_scope": "section",
            "target_class_id": 112,
            "loads": [{
                "class_id": 112,
                "subject_id": 503,
                "staff_id": "T_SHS_1",
                "academic_period_id": 1,
                "slot_id": reyes_p1.slot_id,
                "start_time": reyes_p1.start_time,
                "end_time": reyes_p1.end_time,
                "days_of_week": ["MON"],
                "status": "draft",
            }],
        },
    )
    assert overlap_res.status_code == 400
    assert "conflict" in overlap_res.json()["detail"].lower()

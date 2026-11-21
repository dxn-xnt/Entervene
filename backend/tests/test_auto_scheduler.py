import uuid
from datetime import date

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.core.Security import create_access_token
from app.db.Base import Base
from app.db.Session import get_db
from app.main import app
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPathway import AcademicPathway
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.academic.SubjectOfferingPathway import SubjectOfferingPathway
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.settings.Setting import Setting, SettingType
from app.api.v1.routes.SubjectLoads import ensure_default_period_templates
from app.services.academic.ConflictDetectorService import times_overlap


@pytest.fixture
def sched_ctx():
    engine = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(autocommit=False, autoflush=False, bind=engine)()

    def _override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = _override_get_db

    admin_uid = uuid.uuid4()
    teacher_uid = uuid.uuid4()
    db.add_all([
        UserAccount(user_id=admin_uid, email="admin@sched.test", account_status="active"),
        UserAccount(user_id=teacher_uid, email="teacher@sched.test", account_status="active"),
        GradingTemplate(grading_template_id=1, template_name="Core", passing_threshold=75.0, status="active"),
    ])

    year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    db.add(year)
    db.flush()

    period_t1 = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        start_date=date(2026, 6, 1),
        end_date=date(2026, 9, 30),
        is_active=True,
    )
    period_t2 = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Term 2",
        period_type="TERM",
        period_sequence=2,
        total_periods_in_year=3,
        start_date=date(2026, 10, 1),
        end_date=date(2027, 1, 31),
        is_active=False,
    )
    db.add_all([period_t1, period_t2])
    db.flush()

    levels = {}
    for grade in range(7, 13):
        lvl = AcademicLevel(level_name=f"Grade {grade}", grade_level=grade)
        db.add(lvl)
        db.flush()
        levels[grade] = lvl

    pw_med = AcademicPathway(code="medical-courses", name="Medical Courses", is_enabled=True)
    pw_eng = AcademicPathway(code="engineering-math", name="Engineering & Math", is_enabled=True)
    db.add_all([pw_med, pw_eng])
    db.flush()

    teachers = [
        AcademicStaff(staff_id=f"T{i:03d}", first_name=f"Teacher{i}", last_name="Faculty", employment_status="active")
        for i in range(1, 10)
    ]
    db.add_all(teachers)
    db.commit()

    ensure_default_period_templates(db)

    admin_headers = {"Authorization": f"Bearer {create_access_token(str(admin_uid), 'admin')}"}
    teacher_headers = {"Authorization": f"Bearer {create_access_token(str(teacher_uid), 'teacher')}"}

    try:
        yield {
            "db": db,
            "client": TestClient(app),
            "admin_headers": admin_headers,
            "teacher_headers": teacher_headers,
            "year": year,
            "period_t1": period_t1,
            "period_t2": period_t2,
            "levels": levels,
            "pw_med": pw_med,
            "pw_eng": pw_eng,
            "teachers": teachers,
        }
    finally:
        app.dependency_overrides.clear()
        db.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def _add_subject_with_offering(
    db,
    *,
    name: str,
    code: str,
    level_id: int,
    year_id: int,
    period_id: int,
    minutes: int | None,
    is_core: bool = True,
    pathway_ids: list[int] | None = None,
) -> Subject:
    sub = Subject(
        subject_name=name,
        subject_codename=code,
        academic_level_id=level_id,
        grading_template_id=1,
        is_core=is_core,
        status="active",
    )
    db.add(sub)
    db.flush()
    offering = SubjectOffering(
        subject_id=sub.subject_id,
        academic_year_id=year_id,
        academic_level_id=level_id,
        academic_period_id=period_id,
        minutes=minutes,
        status="active",
    )
    db.add(offering)
    db.flush()
    for pid in pathway_ids or []:
        db.add(SubjectOfferingPathway(subject_offering_id=offering.subject_offering_id, pathway_id=pid))
    db.commit()
    return sub


def test_auto_generate_new_sections_grades_7_to_12_and_custom_break_timelines(sched_ctx):
    db = sched_ctx["db"]
    client = sched_ctx["client"]
    headers = sched_ctx["admin_headers"]
    year = sched_ctx["year"]
    period = sched_ctx["period_t1"]
    levels = sched_ctx["levels"]
    pw_med = sched_ctx["pw_med"]
    pw_eng = sched_ctx["pw_eng"]

    # Add a custom SHS break timeline with 50-min periods and custom recess/lunch
    db.add_all([
        PeriodTemplateSlot(template_group="SHS_CUSTOM_50", slot_name="Homeroom", slot_type="HOMEROOM", start_time="07:30", end_time="08:00", is_locked_break=True, display_order=1),
        PeriodTemplateSlot(template_group="SHS_CUSTOM_50", slot_name="Custom P1", slot_type="CLASS", start_time="08:00", end_time="08:50", is_locked_break=False, display_order=2),
        PeriodTemplateSlot(template_group="SHS_CUSTOM_50", slot_name="Custom Recess", slot_type="RECESS", start_time="08:50", end_time="09:10", is_locked_break=True, display_order=3),
        PeriodTemplateSlot(template_group="SHS_CUSTOM_50", slot_name="Custom P2", slot_type="CLASS", start_time="09:10", end_time="10:00", is_locked_break=False, display_order=4),
    ])

    # Create brand-new empty sections across Grades 7, 10, 11 (Med & Eng), 12 (Custom & Unconfigured)
    c_g7 = Class(section_name="7-Rizal", academic_year_id=year.academic_year_id, academic_level_id=levels[7].academic_level_id, period_template_group="JHS_45MIN")
    c_g10 = Class(section_name="10-Einstein", academic_year_id=year.academic_year_id, academic_level_id=levels[10].academic_level_id, period_template_group="JHS_45MIN")
    c_g11_med = Class(section_name="11-Zara", academic_year_id=year.academic_year_id, academic_level_id=levels[11].academic_level_id, pathway_id=pw_med.id, period_template_group="SHS_CAMPOS_ZARA")
    c_g11_eng = Class(section_name="11-DelMundo", academic_year_id=year.academic_year_id, academic_level_id=levels[11].academic_level_id, pathway_id=pw_eng.id, period_template_group="SHS_DELMUNDO_REYES")
    c_g12_custom = Class(section_name="12-Custom", academic_year_id=year.academic_year_id, academic_level_id=levels[12].academic_level_id, pathway_id=pw_med.id, period_template_group="SHS_CUSTOM_50")
    c_g12_unconf = Class(section_name="12-Unconfigured", academic_year_id=year.academic_year_id, academic_level_id=levels[12].academic_level_id, pathway_id=pw_eng.id, period_template_group=None)
    db.add_all([c_g7, c_g10, c_g11_med, c_g11_eng, c_g12_custom, c_g12_unconf])
    db.commit()

    # Offerings per grade & pathway (and one Term 2 offering that must NOT leak into Term 1)
    s_g7_math = _add_subject_with_offering(db, name="Math 7", code="M7", level_id=levels[7].academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=60, is_core=True)
    s_g7_fil = _add_subject_with_offering(db, name="Filipino 7", code="F7", level_id=levels[7].academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=45, is_core=True)
    _add_subject_with_offering(db, name="Term2 Only 7", code="T27", level_id=levels[7].academic_level_id, year_id=year.academic_year_id, period_id=sched_ctx["period_t2"].academic_period_id, minutes=45, is_core=False)

    s_g10_sci = _add_subject_with_offering(db, name="Science 10", code="S10", level_id=levels[10].academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=60, is_core=True)

    s_g11_med_lab = _add_subject_with_offering(db, name="Anatomy Lab", code="ANAT", level_id=levels[11].academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=96, pathway_ids=[pw_med.id])
    s_g11_med_bio = _add_subject_with_offering(db, name="Human Bio", code="HBIO", level_id=levels[11].academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=60, pathway_ids=[pw_med.id])
    s_g11_eng_calc = _add_subject_with_offering(db, name="Pre-Calculus", code="PCALC", level_id=levels[11].academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=72, pathway_ids=[pw_eng.id])

    s_g12_custom = _add_subject_with_offering(db, name="Med Seminar", code="MSEM", level_id=levels[12].academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=50, pathway_ids=[pw_med.id])
    s_g12_unconf = _add_subject_with_offering(db, name="Eng Capstone", code="ECAP", level_id=levels[12].academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=60, pathway_ids=[pw_eng.id])

    resp = client.post(
        "/api/v1/subject-loads/auto-schedule",
        json={"academic_period_id": period.academic_period_id, "loads": []},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()

    # Preview must NEVER write to the database
    assert db.query(SubjectLoad).count() == 0

    by_pair = {(l["class_id"], l["subject_id"]): l for l in data["scheduled_loads"]}
    # Grade 7 gets 60-min Enhanced Period and 45-min standard Period; Term 2 subject excluded
    assert (c_g7.class_id, s_g7_math.subject_id) in by_pair
    assert by_pair[(c_g7.class_id, s_g7_math.subject_id)]["start_time"] in ("13:00", "14:00")
    assert by_pair[(c_g7.class_id, s_g7_math.subject_id)]["slot_id"] is not None
    assert by_pair[(c_g7.class_id, s_g7_fil.subject_id)]["start_time"] == "08:00"
    assert by_pair[(c_g7.class_id, s_g7_fil.subject_id)]["end_time"] == "08:45"
    assert len([l for l in data["scheduled_loads"] if l["class_id"] == c_g7.class_id]) == 2

    # Grade 10 gets 60-min Enhanced Period
    assert by_pair[(c_g10.class_id, s_g10_sci.subject_id)]["start_time"] in ("13:00", "14:00")

    # Grade 11 Med (SHS_CAMPOS_ZARA) gets 96-min Lab Block (10:24-12:00) and 60-min period; no Eng subject
    assert by_pair[(c_g11_med.class_id, s_g11_med_lab.subject_id)]["start_time"] == "10:24"
    assert by_pair[(c_g11_med.class_id, s_g11_med_lab.subject_id)]["end_time"] == "12:00"
    assert by_pair[(c_g11_med.class_id, s_g11_med_bio.subject_id)]["start_time"] == "08:00"
    assert (c_g11_med.class_id, s_g11_eng_calc.subject_id) not in by_pair

    # Grade 11 Eng (SHS_DELMUNDO_REYES) gets 72-min period (08:00-09:12); no Med subjects
    assert by_pair[(c_g11_eng.class_id, s_g11_eng_calc.subject_id)]["start_time"] == "08:00"
    assert by_pair[(c_g11_eng.class_id, s_g11_eng_calc.subject_id)]["end_time"] == "09:12"
    assert (c_g11_eng.class_id, s_g11_med_lab.subject_id) not in by_pair

    # Grade 12 Custom (SHS_CUSTOM_50) respects custom 50-min slot and never overlaps custom recess
    assert by_pair[(c_g12_custom.class_id, s_g12_custom.subject_id)]["start_time"] == "08:00"
    assert by_pair[(c_g12_custom.class_id, s_g12_custom.subject_id)]["end_time"] == "08:50"

    # Grade 12 Unconfigured (period_template_group=None) is left unscheduled with exact reason
    assert by_pair[(c_g12_unconf.class_id, s_g12_unconf.subject_id)]["start_time"] is None
    unconf_item = next(
        i for i in data["items"] if i["class_id"] == c_g12_unconf.class_id and i["subject_id"] == s_g12_unconf.subject_id
    )
    assert unconf_item["outcome"] == "unscheduled"
    assert unconf_item["reason_code"] == "MISSING_BELL_SCHEDULE"
    assert "Edit Break Timelines" in unconf_item["reason"]

    # Zero fabricated teacher assignments
    assert all(l["staff_id"] is None for l in data["scheduled_loads"])

    # Zero break violations or section overlaps across all generated loads
    assert not any(c["rule"] in ("BREAK_TIME_VIOLATION", "SECTION_OVERLAP", "OFFERING_DURATION_MISMATCH") for c in data["conflicts"])


def test_preserves_manual_drafts_by_default_and_requires_explicit_overwrite_while_protecting_locked(sched_ctx):
    db = sched_ctx["db"]
    client = sched_ctx["client"]
    headers = sched_ctx["admin_headers"]
    year = sched_ctx["year"]
    period = sched_ctx["period_t1"]
    g9 = sched_ctx["levels"][9]

    c_draft = Class(section_name="9-Draft", academic_year_id=year.academic_year_id, academic_level_id=g9.academic_level_id, period_template_group="JHS_45MIN")
    c_locked = Class(section_name="9-Locked", academic_year_id=year.academic_year_id, academic_level_id=g9.academic_level_id, period_template_group="JHS_45MIN")
    db.add_all([c_draft, c_locked])
    db.commit()

    sub1 = _add_subject_with_offering(db, name="English 9", code="E9", level_id=g9.academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=45)
    sub2 = _add_subject_with_offering(db, name="Filipino 9", code="F9", level_id=g9.academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=45)

    p1 = db.query(PeriodTemplateSlot).filter(PeriodTemplateSlot.template_group == "JHS_45MIN", PeriodTemplateSlot.slot_name == "Period 1").one()
    p5 = db.query(PeriodTemplateSlot).filter(PeriodTemplateSlot.template_group == "JHS_45MIN", PeriodTemplateSlot.slot_name == "Period 5").one()

    # Publish & lock c_locked at Period 1 with T001
    db.add(SubjectLoad(
        class_id=c_locked.class_id,
        subject_id=sub1.subject_id,
        staff_id="T001",
        academic_period_id=period.academic_period_id,
        slot_id=p1.slot_id,
        start_time=p1.start_time,
        end_time=p1.end_time,
        days_of_week=["MON", "TUE", "WED", "THU", "FRI"],
        status="published",
        is_active_version=True,
        is_locked=True,
        section_revision=1,
    ))
    db.commit()

    # c_draft has sub1 manually placed at Period 5 (11:15-12:00) and sub2 unscheduled with T001
    submitted = [
        {
            "class_id": c_draft.class_id,
            "subject_id": sub1.subject_id,
            "staff_id": "T002",
            "academic_period_id": period.academic_period_id,
            "slot_id": p5.slot_id,
            "start_time": p5.start_time,
            "end_time": p5.end_time,
            "days_of_week": ["MON", "TUE", "WED", "THU", "FRI"],
            "status": "draft",
        },
        {
            "class_id": c_draft.class_id,
            "subject_id": sub2.subject_id,
            "staff_id": "T001",
            "academic_period_id": period.academic_period_id,
            "slot_id": None,
            "start_time": None,
            "end_time": None,
            "days_of_week": [],
            "status": "draft",
        },
    ]

    # 1. Default (overwrite_existing_drafts=False): preserves sub1 at Period 5, schedules sub2 away from T001's Period 1!
    res1 = client.post(
        "/api/v1/subject-loads/auto-schedule",
        json={
            "academic_period_id": period.academic_period_id,
            "loads": submitted,
            "target_class_ids": [c_draft.class_id, c_locked.class_id],
            "overwrite_existing_drafts": False,
        },
        headers=headers,
    )
    assert res1.status_code == 200, res1.text
    d1 = res1.json()
    by_pair1 = {(l["class_id"], l["subject_id"]): l for l in d1["scheduled_loads"]}

    assert by_pair1[(c_draft.class_id, sub1.subject_id)]["start_time"] == p5.start_time
    assert by_pair1[(c_draft.class_id, sub2.subject_id)]["start_time"] != p1.start_time  # Avoided T001's locked Period 1!
    assert by_pair1[(c_draft.class_id, sub2.subject_id)]["start_time"] != p5.start_time  # Avoided sub1's Period 5!
    assert by_pair1[(c_locked.class_id, sub1.subject_id)]["start_time"] == p1.start_time
    assert d1["summary"]["generated_count"] == 1
    assert d1["summary"]["skipped_count"] == 2  # c_draft sub1 preserved + c_locked sub1 locked

    # 2. Repeated generation on the result creates ZERO duplicates and skips already-scheduled loads
    res_repeat = client.post(
        "/api/v1/subject-loads/auto-schedule",
        json={
            "academic_period_id": period.academic_period_id,
            "loads": d1["scheduled_loads"],
            "target_class_ids": [c_draft.class_id],
            "overwrite_existing_drafts": False,
        },
        headers=headers,
    )
    assert res_repeat.status_code == 200
    d_rep = res_repeat.json()
    assert len(d_rep["scheduled_loads"]) == 2
    assert d_rep["summary"]["generated_count"] == 0
    assert d_rep["summary"]["skipped_count"] == 2

    # 3. Explicit overwrite_existing_drafts=True replaces c_draft's Period 5, preserves staff_id, and STILL protects c_locked!
    res_overwrite = client.post(
        "/api/v1/subject-loads/auto-schedule",
        json={
            "academic_period_id": period.academic_period_id,
            "loads": submitted,
            "target_class_ids": [c_draft.class_id, c_locked.class_id],
            "overwrite_existing_drafts": True,
        },
        headers=headers,
    )
    assert res_overwrite.status_code == 200
    d_ow = res_overwrite.json()
    by_pair_ow = {(l["class_id"], l["subject_id"]): l for l in d_ow["scheduled_loads"]}
    assert by_pair_ow[(c_draft.class_id, sub1.subject_id)]["start_time"] == p1.start_time
    assert by_pair_ow[(c_draft.class_id, sub1.subject_id)]["staff_id"] == "T002"
    assert by_pair_ow[(c_draft.class_id, sub2.subject_id)]["start_time"] != p1.start_time
    assert by_pair_ow[(c_locked.class_id, sub1.subject_id)]["start_time"] == p1.start_time
    assert d_ow["summary"]["replaced_count"] == 1
    assert d_ow["summary"]["locked_sections_count"] == 1
    assert len([l for l in d_ow["scheduled_loads"] if l["class_id"] == c_draft.class_id]) == 2


def test_mrv_backtracking_finds_valid_alternative_slots_and_respects_teacher_conflicts_and_caps(sched_ctx):
    db = sched_ctx["db"]
    client = sched_ctx["client"]
    headers = sched_ctx["admin_headers"]
    year = sched_ctx["year"]
    period = sched_ctx["period_t1"]
    g9 = sched_ctx["levels"][9]

    # Section A already occupies T001 on Enhanced Period 2 (14:00-15:00) in an unlocked draft
    c_a = Class(section_name="9-Alpha", academic_year_id=year.academic_year_id, academic_level_id=g9.academic_level_id, period_template_group="JHS_45MIN")
    c_b = Class(section_name="9-Beta", academic_year_id=year.academic_year_id, academic_level_id=g9.academic_level_id, period_template_group="JHS_45MIN")
    c_c = Class(section_name="9-Gamma", academic_year_id=year.academic_year_id, academic_level_id=g9.academic_level_id, period_template_group="JHS_45MIN")
    db.add_all([c_a, c_b, c_c])
    db.commit()

    # Two 60-min subjects (JHS only has TWO 60-min slots: Enhanced 1 13:00-14:00 and Enhanced 2 14:00-15:00)
    s_math = _add_subject_with_offering(db, name="Math 9", code="M9", level_id=g9.academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=60)
    s_sci = _add_subject_with_offering(db, name="Science 9", code="S9", level_id=g9.academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=60)

    enh2 = db.query(PeriodTemplateSlot).filter(PeriodTemplateSlot.template_group == "JHS_45MIN", PeriodTemplateSlot.slot_name == "Enhanced Period 2").one()
    db.add(SubjectLoad(
        class_id=c_a.class_id,
        subject_id=s_math.subject_id,
        staff_id="T001",
        academic_period_id=period.academic_period_id,
        slot_id=enh2.slot_id,
        start_time=enh2.start_time,
        end_time=enh2.end_time,
        days_of_week=["MON", "TUE", "WED", "THU", "FRI"],
        status="draft",
        is_active_version=False,
        is_locked=False,
    ))
    db.commit()

    # In c_b: s_math has NO teacher (can go anywhere), s_sci has T001 (ONLY free at Enhanced 1!)
    # Naive order by subject_id would put s_math in Enhanced 1 and fail s_sci.
    # Our MRV + backtracking solver MUST place s_sci in Enhanced 1 and s_math in Enhanced 2!
    resp = client.post(
        "/api/v1/subject-loads/auto-schedule",
        json={
            "academic_period_id": period.academic_period_id,
            "target_class_ids": [c_b.class_id],
            "loads": [
                {"class_id": c_b.class_id, "subject_id": s_math.subject_id, "staff_id": None, "academic_period_id": period.academic_period_id},
                {"class_id": c_b.class_id, "subject_id": s_sci.subject_id, "staff_id": "T001", "academic_period_id": period.academic_period_id},
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    d = resp.json()
    by_sub = {l["subject_id"]: l for l in d["scheduled_loads"]}
    assert by_sub[s_sci.subject_id]["start_time"] == "13:00"
    assert by_sub[s_math.subject_id]["start_time"] == "14:00"
    assert not any(c["rule"] == "TEACHER_OVERLAP" for c in d["conflicts"])

    # Now if c_c ALSO assigns T001 to s_math while T001 is busy in c_a (14:00) AND c_b (13:00),
    # c_c must be left unscheduled with TEACHER_CONFLICT instead of double-booking!
    resp2 = client.post(
        "/api/v1/subject-loads/auto-schedule",
        json={
            "academic_period_id": period.academic_period_id,
            "target_class_ids": [c_c.class_id],
            "loads": d["scheduled_loads"] + [
                {"class_id": c_c.class_id, "subject_id": s_math.subject_id, "staff_id": "T001", "academic_period_id": period.academic_period_id},
            ],
        },
        headers=headers,
    )
    assert resp2.status_code == 200, resp2.text
    d2 = resp2.json()
    c_c_item = next(i for i in d2["items"] if i["class_id"] == c_c.class_id and i["subject_id"] == s_math.subject_id)
    assert c_c_item["outcome"] == "unscheduled"
    assert c_c_item["reason_code"] == "TEACHER_CONFLICT"
    assert not any(c["rule"] == "TEACHER_OVERLAP" for c in d2["conflicts"])


def test_teacher_daily_workload_cap_prevents_overloading_and_explains_reason(sched_ctx):
    db = sched_ctx["db"]
    client = sched_ctx["client"]
    headers = sched_ctx["admin_headers"]
    year = sched_ctx["year"]
    period = sched_ctx["period_t1"]
    g8 = sched_ctx["levels"][8]

    # Set strict daily cap: max 2 subjects/day
    db.add(Setting(key="max_subjects_per_day", value="2", type=SettingType.INTEGER, group="scheduling"))
    db.commit()

    classes = [
        Class(section_name=f"8-Sec{i}", academic_year_id=year.academic_year_id, academic_level_id=g8.academic_level_id, period_template_group="JHS_45MIN")
        for i in range(1, 4)
    ]
    db.add_all(classes)
    db.commit()

    sub = _add_subject_with_offering(db, name="AP 8", code="AP8", level_id=g8.academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=45)

    # Assign T002 to AP 8 in 3 sections -> max 2 subjects/day cap allows 2 on 5-day, 3rd cannot fit on any day!
    resp = client.post(
        "/api/v1/subject-loads/auto-schedule",
        json={
            "academic_period_id": period.academic_period_id,
            "target_class_ids": [c.class_id for c in classes],
            "loads": [
                {"class_id": c.class_id, "subject_id": sub.subject_id, "staff_id": "T002", "academic_period_id": period.academic_period_id}
                for c in classes
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    d = resp.json()
    assert d["summary"]["generated_count"] == 2
    assert d["summary"]["unscheduled_count"] == 1
    unsched = next(i for i in d["items"] if i["outcome"] == "unscheduled")
    assert unsched["reason_code"] == "TEACHER_WORKLOAD_LIMIT"
    assert not any(c["rule"] == "DAILY_WORKLOAD_EXCEEDED" for c in d["conflicts"])


def test_insufficient_slots_and_duration_mismatch_and_existing_conflicts_surfaced(sched_ctx):
    db = sched_ctx["db"]
    client = sched_ctx["client"]
    headers = sched_ctx["admin_headers"]
    year = sched_ctx["year"]
    period = sched_ctx["period_t1"]
    g9 = sched_ctx["levels"][9]

    cls = Class(section_name="9-Tight", academic_year_id=year.academic_year_id, academic_level_id=g9.academic_level_id, period_template_group="JHS_45MIN")
    db.add(cls)
    db.commit()

    # JHS has only two 60-min periods -> at most 4 split subjects (2*2) fit. Create 5 of 60 min + 1 of 90 min (no matching slot).
    subs_60 = [
        _add_subject_with_offering(db, name=f"Enhanced {i}", code=f"ENH{i}", level_id=g9.academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=60, is_core=(i == 1))
        for i in range(1, 6)
    ]
    sub_90 = _add_subject_with_offering(db, name="Lab 90", code="L90", level_id=g9.academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=90, is_core=False)

    resp = client.post(
        "/api/v1/subject-loads/auto-schedule",
        json={"academic_period_id": period.academic_period_id, "target_class_ids": [cls.class_id], "loads": []},
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    d = resp.json()
    assert d["summary"]["generated_count"] == 4
    assert d["summary"]["unscheduled_count"] == 2
    codes = {i["reason_code"] for i in d["items"] if i["outcome"] == "unscheduled"}
    assert codes == {"SECTION_CAPACITY_FULL", "NO_MATCHING_DURATION_SLOT"}
    assert not any(c["rule"] == "SECTION_OVERLAP" for c in d["conflicts"])

    # Existing conflicts in preserved drafts must NEVER be silently ignored
    p1 = db.query(PeriodTemplateSlot).filter(PeriodTemplateSlot.template_group == "JHS_45MIN", PeriodTemplateSlot.slot_name == "Period 1").one()
    resp_existing = client.post(
        "/api/v1/subject-loads/auto-schedule",
        json={
            "academic_period_id": period.academic_period_id,
            "target_class_ids": [cls.class_id],
            "overwrite_existing_drafts": False,
            "loads": [
                # Existing preserved manual draft with wrong duration (45 min slot for 60 min subject!)
                {
                    "class_id": cls.class_id,
                    "subject_id": subs_60[0].subject_id,
                    "staff_id": "T001",
                    "academic_period_id": period.academic_period_id,
                    "slot_id": p1.slot_id,
                    "start_time": p1.start_time,
                    "end_time": p1.end_time,
                    "days_of_week": ["MON", "TUE", "WED", "THU", "FRI"],
                    "status": "draft",
                }
            ],
        },
        headers=headers,
    )
    assert resp_existing.status_code == 200
    d_ex = resp_existing.json()
    assert any(c["rule"] == "OFFERING_DURATION_MISMATCH" for c in d_ex["existing_conflicts"])
    assert any(c["rule"] == "OFFERING_DURATION_MISMATCH" for c in d_ex["conflicts"])
    assert d_ex["summary"]["existing_error_conflicts_count"] >= 1


def test_end_to_end_auto_generate_draft_save_and_publish_and_non_admin_denied(sched_ctx):
    db = sched_ctx["db"]
    client = sched_ctx["client"]
    headers = sched_ctx["admin_headers"]
    year = sched_ctx["year"]
    period = sched_ctx["period_t1"]
    g7 = sched_ctx["levels"][7]

    cls = Class(section_name="7-Mabini", academic_year_id=year.academic_year_id, academic_level_id=g7.academic_level_id, period_template_group="JHS_45MIN")
    db.add(cls)
    db.commit()

    sub1 = _add_subject_with_offering(db, name="Math 7", code="M7", level_id=g7.academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=60)
    sub2 = _add_subject_with_offering(db, name="English 7", code="E7", level_id=g7.academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=45)

    # Non-admin denied
    denied = client.post(
        "/api/v1/subject-loads/auto-schedule",
        json={"academic_period_id": period.academic_period_id, "loads": []},
        headers=sched_ctx["teacher_headers"],
    )
    assert denied.status_code == 403

    # 1. Generate draft preview
    preview = client.post(
        "/api/v1/subject-loads/auto-schedule",
        json={"academic_period_id": period.academic_period_id, "target_class_ids": [cls.class_id], "loads": []},
        headers=headers,
    )
    assert preview.status_code == 200
    generated_loads = preview.json()["scheduled_loads"]
    assert len(generated_loads) == 2
    assert db.query(SubjectLoad).count() == 0

    # 2. Save as Draft (even with unassigned teachers)
    save_draft = client.post(
        "/api/v1/subject-loads/batch-save",
        json={
            "academic_period_id": period.academic_period_id,
            "academic_level_id": g7.academic_level_id,
            "action": "draft",
            "publish_scope": "section",
            "target_class_id": cls.class_id,
            "loads": generated_loads,
        },
        headers=headers,
    )
    assert save_draft.status_code == 200, save_draft.text
    db_drafts = db.query(SubjectLoad).filter(SubjectLoad.class_id == cls.class_id).all()
    assert len(db_drafts) == 2
    assert all(row.status == "draft" and not row.is_locked for row in db_drafts)

    # 3. Assign teachers and Publish Section
    loads_with_teachers = [
        {**l, "staff_id": "T001" if l["subject_id"] == sub1.subject_id else "T002"}
        for l in generated_loads
    ]
    pub = client.post(
        "/api/v1/subject-loads/batch-save",
        json={
            "academic_period_id": period.academic_period_id,
            "academic_level_id": g7.academic_level_id,
            "action": "publish",
            "publish_scope": "section",
            "target_class_id": cls.class_id,
            "loads": loads_with_teachers,
        },
        headers=headers,
    )
    assert pub.status_code == 200, pub.text
    published_rows = db.query(SubjectLoad).filter(
        SubjectLoad.class_id == cls.class_id,
        SubjectLoad.is_active_version.is_(True),
    ).all()
    assert len(published_rows) == 2
    assert all(row.status == "published" and row.is_locked for row in published_rows)

    # Verify zero overlap with any JHS break slot
    jhs_breaks = db.query(PeriodTemplateSlot).filter(
        PeriodTemplateSlot.template_group == "JHS_45MIN",
        PeriodTemplateSlot.is_locked_break.is_(True),
    ).all()
    for row in published_rows:
        for brk in jhs_breaks:
            assert not times_overlap(row.start_time, row.end_time, brk.start_time, brk.end_time)


def test_archived_section_loads_ignored_and_empty_curriculum_sections_reported(sched_ctx):
    db = sched_ctx["db"]
    client = sched_ctx["client"]
    headers = sched_ctx["admin_headers"]
    year = sched_ctx["year"]
    period = sched_ctx["period_t1"]
    g7 = sched_ctx["levels"][7]
    g12 = sched_ctx["levels"][12]

    # Active Grade 7 section with offering, Active Grade 12 section with NO offerings,
    # and Archived Grade 7 section holding stale draft load with T001 at Period 1.
    c_active_g7 = Class(section_name="7-Active", class_status="active", academic_year_id=year.academic_year_id, academic_level_id=g7.academic_level_id, period_template_group="JHS_45MIN")
    c_empty_g12 = Class(section_name="12-Empty", class_status="active", academic_year_id=year.academic_year_id, academic_level_id=g12.academic_level_id, period_template_group="SHS_DELMUNDO_REYES")
    c_archived = Class(section_name="7-Archived", class_status="archived", academic_year_id=year.academic_year_id, academic_level_id=g7.academic_level_id, period_template_group="JHS_45MIN")
    db.add_all([c_active_g7, c_empty_g12, c_archived])
    db.commit()

    sub_g7 = _add_subject_with_offering(db, name="English 7", code="ENG7", level_id=g7.academic_level_id, year_id=year.academic_year_id, period_id=period.academic_period_id, minutes=45)
    p1 = db.query(PeriodTemplateSlot).filter(PeriodTemplateSlot.template_group == "JHS_45MIN", PeriodTemplateSlot.slot_name == "Period 1").one()
    db.add(SubjectLoad(
        class_id=c_archived.class_id,
        subject_id=sub_g7.subject_id,
        staff_id="T001",
        academic_period_id=period.academic_period_id,
        slot_id=p1.slot_id,
        start_time=p1.start_time,
        end_time=p1.end_time,
        days_of_week=["MON", "TUE", "WED", "THU", "FRI"],
        status="draft",
        is_active_version=False,
        is_locked=False,
    ))
    db.commit()

    resp = client.post(
        "/api/v1/subject-loads/auto-schedule",
        json={
            "academic_period_id": period.academic_period_id,
            "loads": [
                {"class_id": c_active_g7.class_id, "subject_id": sub_g7.subject_id, "staff_id": "T001", "academic_period_id": period.academic_period_id},
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    d = resp.json()

    # Archived class draft must NOT block Period 1 or leak into conflicts
    placed_g7 = next(l for l in d["scheduled_loads"] if l["class_id"] == c_active_g7.class_id)
    assert placed_g7["start_time"] == p1.start_time
    assert not any(c.get("class_id") == c_archived.class_id for c in d["conflicts"])
    assert not any(c["rule"] == "TEACHER_OVERLAP" for c in d["conflicts"])

    # Empty curriculum Grade 12 section must be reported explicitly with 0 fabricated loads
    assert "12-Empty" in d["summary"]["empty_curriculum_sections"]
    assert not any(l["class_id"] == c_empty_g12.class_id for l in d["scheduled_loads"])

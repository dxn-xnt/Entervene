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
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.people.AcademicStaff import AcademicStaff
from app.models.auth.UserAccount import UserAccount
from app.models.settings.Setting import Setting, SettingType
from app.schemas.SubjectLoad import SubjectLoadItem
from app.services.academic.ConflictDetectorService import ConflictDetectorService


@pytest.fixture
def c4_ctx():
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
    db.add(UserAccount(user_id=admin_uid, email="admin@c4.test", account_status="active"))
    db.add(GradingTemplate(grading_template_id=1, template_name="Core", passing_threshold=75.0, status="active"))

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
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add_all([period, level])
    db.flush()

    classes = [
        Class(
            section_name=f"7-Sec{i}",
            academic_level_id=level.academic_level_id,
            academic_year_id=year.academic_year_id,
            class_status="active",
            period_template_group="JHS_45MIN",
        )
        for i in range(1, 8)
    ]
    math = Subject(
        subject_name="Mathematics 7",
        subject_codename="MATH7",
        academic_level_id=level.academic_level_id,
        status="active",
    )
    science = Subject(
        subject_name="Science 7",
        subject_codename="SCI7",
        academic_level_id=level.academic_level_id,
        status="active",
    )
    teacher = AcademicStaff(
        staff_id="TCH401",
        first_name="Alice",
        last_name="Math",
        employment_status="active",
    )
    db.add_all([*classes, math, science, teacher])
    db.flush()

    db.add_all([
        SubjectOffering(
            subject_id=math.subject_id,
            academic_year_id=year.academic_year_id,
            academic_level_id=level.academic_level_id,
            academic_period_id=period.academic_period_id,
            minutes=45,
            status="active",
        ),
        SubjectOffering(
            subject_id=science.subject_id,
            academic_year_id=year.academic_year_id,
            academic_level_id=level.academic_level_id,
            academic_period_id=period.academic_period_id,
            minutes=45,
            status="active",
        ),
    ])
    db.commit()

    headers = {"Authorization": f"Bearer {create_access_token(str(admin_uid), 'admin')}"}
    try:
        yield {
            "db": db,
            "client": TestClient(app),
            "headers": headers,
            "period": period,
            "level": level,
            "classes": classes,
            "math": math,
            "science": science,
            "teacher": teacher,
        }
    finally:
        app.dependency_overrides.clear()
        db.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


NON_OVERLAPPING_45M_SLOTS = [
    ("08:00", "08:45"),
    ("08:45", "09:30"),
    ("09:45", "10:30"),
    ("10:30", "11:15"),
    ("11:15", "12:00"),
    ("13:00", "13:45"),
    ("13:45", "14:30"),
]


def test_same_subject_across_seven_sections_triggers_max_subjects_cap_and_blocks_publish(c4_ctx):
    db = c4_ctx["db"]
    period = c4_ctx["period"]
    level = c4_ctx["level"]
    classes = c4_ctx["classes"]
    math = c4_ctx["math"]
    teacher = c4_ctx["teacher"]

    # 7 sections of Math 7 on MON = 5.25 hours (<= 6.0 max_hours_per_day),
    # but 7 distinct section-subject loads (> 6 default max_subjects_per_day).
    loads = [
        SubjectLoadItem(
            class_id=cls.class_id,
            subject_id=math.subject_id,
            staff_id=teacher.staff_id,
            academic_period_id=period.academic_period_id,
            start_time=st,
            end_time=et,
            days_of_week=["MON"],
        )
        for cls, (st, et) in zip(classes, NON_OVERLAPPING_45M_SLOTS)
    ]

    res = ConflictDetectorService.validate_loads(db=db, loads=loads, academic_period=period)
    assert len(res.teacher_workloads) == 1
    wl = res.teacher_workloads[0]
    assert wl.daily_hours["MON"] == pytest.approx(5.25)
    assert wl.daily_subjects_count["MON"] == 7
    assert wl.has_capacity_warning is True

    exceeded = [c for c in res.conflicts if c.rule == "DAILY_WORKLOAD_EXCEEDED"]
    minimum = [c for c in res.conflicts if c.rule == "DAILY_WORKLOAD_MINIMUM"]
    assert len(exceeded) == 1
    assert exceeded[0].severity == "error"
    assert exceeded[0].staff_id == teacher.staff_id
    assert exceeded[0].day == "MON"
    assert exceeded[0].days == ["MON"]
    assert exceeded[0].affected_keys == sorted(f"{cls.class_id}_{math.subject_id}" for cls in classes)
    assert "7 subjects scheduled" in exceeded[0].message
    assert minimum == []
    assert res.is_valid is False
    assert res.can_publish is False

    # Publishing via API must also reject with 400 due to DAILY_WORKLOAD_EXCEEDED
    pub_res = c4_ctx["client"].post(
        "/api/v1/subject-loads/batch-save",
        json={
            "academic_period_id": period.academic_period_id,
            "academic_level_id": level.academic_level_id,
            "action": "publish",
            "publish_scope": "all",
            "loads": [item.model_dump(mode="json") for item in loads],
        },
        headers=c4_ctx["headers"],
    )
    assert pub_res.status_code == 400
    assert "exceeds max 6 subjects/day" in pub_res.json()["detail"]


def test_same_subject_across_five_sections_is_within_default_bounds_without_false_minimum_warning(c4_ctx):
    db = c4_ctx["db"]
    period = c4_ctx["period"]
    classes = c4_ctx["classes"][:5]
    math = c4_ctx["math"]
    teacher = c4_ctx["teacher"]

    loads = [
        SubjectLoadItem(
            class_id=cls.class_id,
            subject_id=math.subject_id,
            staff_id=teacher.staff_id,
            academic_period_id=period.academic_period_id,
            start_time=st,
            end_time=et,
            days_of_week=["MON"],
        )
        for cls, (st, et) in zip(classes, NON_OVERLAPPING_45M_SLOTS[:5])
    ]

    res = ConflictDetectorService.validate_loads(db=db, loads=loads, academic_period=period)
    wl = res.teacher_workloads[0]
    assert wl.daily_subjects_count["MON"] == 5
    assert wl.has_capacity_warning is False
    assert [c for c in res.conflicts if "DAILY_WORKLOAD" in c.rule] == []


def test_custom_workload_settings_apply_to_same_subject_across_sections(c4_ctx):
    db = c4_ctx["db"]
    period = c4_ctx["period"]
    classes = c4_ctx["classes"]
    math = c4_ctx["math"]
    teacher = c4_ctx["teacher"]

    db.add_all([
        Setting(key="min_subjects_per_day", value="2", type=SettingType.INTEGER, group="workload", is_public=True),
        Setting(key="max_subjects_per_day", value="3", type=SettingType.INTEGER, group="workload", is_public=True),
        Setting(key="max_hours_per_day", value="6.0", type=SettingType.STRING, group="workload", is_public=True),
    ])
    db.commit()

    # MON: 4 sections of Math 7 (> max 3 -> error)
    # TUE: 3 sections of Math 7 (within [2, 3] -> clean)
    # WED: 1 section of Math 7 (< min 2 -> warning)
    loads = [
        SubjectLoadItem(
            class_id=classes[i].class_id,
            subject_id=math.subject_id,
            staff_id=teacher.staff_id,
            academic_period_id=period.academic_period_id,
            start_time=NON_OVERLAPPING_45M_SLOTS[i][0],
            end_time=NON_OVERLAPPING_45M_SLOTS[i][1],
            days_of_week=["MON"] + (["TUE"] if i < 3 else []) + (["WED"] if i == 0 else []),
        )
        for i in range(4)
    ]

    res = ConflictDetectorService.validate_loads(db=db, loads=loads, academic_period=period)
    wl = res.teacher_workloads[0]
    assert wl.daily_subjects_count == {"MON": 4, "TUE": 3, "WED": 1}

    by_rule_day = {(c.rule, c.day): c for c in res.conflicts if "DAILY_WORKLOAD" in c.rule}
    assert ("DAILY_WORKLOAD_EXCEEDED", "MON") in by_rule_day
    assert by_rule_day[("DAILY_WORKLOAD_EXCEEDED", "MON")].severity == "error"
    assert ("DAILY_WORKLOAD_MINIMUM", "WED") in by_rule_day
    assert by_rule_day[("DAILY_WORKLOAD_MINIMUM", "WED")].severity == "warning"
    assert not any(day == "TUE" for _, day in by_rule_day)


def test_multi_slot_schedules_count_distinct_class_subject_loads_and_exact_hours(c4_ctx):
    db = c4_ctx["db"]
    period = c4_ctx["period"]
    cls1, cls2 = c4_ctx["classes"][0], c4_ctx["classes"][1]
    math = c4_ctx["math"]
    science = c4_ctx["science"]
    teacher = c4_ctx["teacher"]

    # cls1 Math has TWO slots on MON (morning + afternoon) and a separate slot on TUE.
    # cls2 Math has one slot on MON & TUE (with an intentional duplicate "TUE" entry to test dedup).
    # cls1 Science has one slot on MON.
    loads = [
        SubjectLoadItem(
            class_id=cls1.class_id,
            subject_id=math.subject_id,
            staff_id=teacher.staff_id,
            academic_period_id=period.academic_period_id,
            start_time="08:00",
            end_time="08:45",
            days_of_week=["MON"],
        ),
        SubjectLoadItem(
            class_id=cls1.class_id,
            subject_id=math.subject_id,
            staff_id=teacher.staff_id,
            academic_period_id=period.academic_period_id,
            start_time="13:00",
            end_time="13:45",
            days_of_week=["MON"],
        ),
        SubjectLoadItem(
            class_id=cls1.class_id,
            subject_id=math.subject_id,
            staff_id=teacher.staff_id,
            academic_period_id=period.academic_period_id,
            start_time="09:45",
            end_time="10:30",
            days_of_week=["TUE"],
        ),
        SubjectLoadItem(
            class_id=cls2.class_id,
            subject_id=math.subject_id,
            staff_id=teacher.staff_id,
            academic_period_id=period.academic_period_id,
            start_time="08:45",
            end_time="09:30",
            days_of_week=["MON", "TUE", "TUE"],
        ),
        SubjectLoadItem(
            class_id=cls1.class_id,
            subject_id=science.subject_id,
            staff_id=teacher.staff_id,
            academic_period_id=period.academic_period_id,
            start_time="10:30",
            end_time="11:15",
            days_of_week=["MON"],
        ),
    ]

    res = ConflictDetectorService.validate_loads(db=db, loads=loads, academic_period=period)
    wl = res.teacher_workloads[0]
    # MON: distinct (class_id, subject_id) = {(cls1, math), (cls2, math), (cls1, science)} = 3
    #      hours = 4 slots * 0.75h = 3.0h
    # TUE: distinct (class_id, subject_id) = {(cls1, math), (cls2, math)} = 2
    #      hours = 2 slots * 0.75h = 1.5h (duplicate TUE in days_of_week not double-counted)
    assert wl.daily_subjects_count == {"MON": 3, "TUE": 2}
    assert wl.daily_hours["MON"] == pytest.approx(3.0)
    assert wl.daily_hours["TUE"] == pytest.approx(1.5)


def test_unassigned_load_with_blocking_error_emits_both_for_frontend_prioritization(c4_ctx):
    db = c4_ctx["db"]
    period = c4_ctx["period"]
    cls1 = c4_ctx["classes"][0]
    math = c4_ctx["math"]

    # Ensure JHS breaks exist so 12:00-12:45 triggers BREAK_TIME_VIOLATION (Lunch Break 12:00-13:00)
    from app.api.v1.routes.SubjectLoads import ensure_default_period_templates
    ensure_default_period_templates(db)

    loads = [
        SubjectLoadItem(
            class_id=cls1.class_id,
            subject_id=math.subject_id,
            staff_id=None,
            academic_period_id=period.academic_period_id,
            start_time="12:00",
            end_time="12:45",
            days_of_week=["MON", "WED"],
        )
    ]

    res = ConflictDetectorService.validate_loads(db=db, loads=loads, academic_period=period)
    key = f"{cls1.class_id}_{math.subject_id}"
    matching = [c for c in res.conflicts if c.affected_key == key]
    rules = [(c.rule, c.severity) for c in matching]
    assert ("UNASSIGNED_TEACHER", "warning") in rules
    assert ("BREAK_TIME_VIOLATION", "error") in rules
    assert res.is_valid is False
    assert res.can_publish is False


def test_multi_slot_conflicts_include_exact_slot_metadata_for_precise_highlighting(c4_ctx):
    db = c4_ctx["db"]
    period = c4_ctx["period"]
    cls1, cls2 = c4_ctx["classes"][0], c4_ctx["classes"][1]
    math = c4_ctx["math"]
    science = c4_ctx["science"]
    teacher = c4_ctx["teacher"]

    from app.api.v1.routes.SubjectLoads import ensure_default_period_templates
    ensure_default_period_templates(db)

    # Math in cls1 has two slots:
    # - Slot 1 (subject_load_id=101): MON/WED 08:00-08:45 (45m, valid duration, no break overlap)
    # - Slot 2 (subject_load_id=102): TUE/THU 13:00-14:00 (60m -> OFFERING_DURATION_MISMATCH on Slot 2 only)
    # Science in cls2 overlaps teacher ONLY on MON 08:00-08:45 (subject_load_id=201 -> TEACHER_OVERLAP on Slot 1 MON only)
    loads = [
        SubjectLoadItem(
            subject_load_id=101,
            class_id=cls1.class_id,
            subject_id=math.subject_id,
            staff_id=teacher.staff_id,
            academic_period_id=period.academic_period_id,
            start_time="08:00",
            end_time="08:45",
            days_of_week=["MON", "WED"],
        ),
        SubjectLoadItem(
            subject_load_id=102,
            class_id=cls1.class_id,
            subject_id=math.subject_id,
            staff_id=teacher.staff_id,
            academic_period_id=period.academic_period_id,
            start_time="13:00",
            end_time="14:00",
            days_of_week=["TUE", "THU"],
        ),
        SubjectLoadItem(
            subject_load_id=201,
            class_id=cls2.class_id,
            subject_id=science.subject_id,
            staff_id=teacher.staff_id,
            academic_period_id=period.academic_period_id,
            start_time="08:00",
            end_time="08:45",
            days_of_week=["MON"],
        ),
    ]

    res = ConflictDetectorService.validate_loads(db=db, loads=loads, academic_period=period)

    duration_err = next(c for c in res.conflicts if c.rule == "OFFERING_DURATION_MISMATCH")
    assert duration_err.subject_load_id == 102
    assert duration_err.start_time == "13:00"
    assert duration_err.end_time == "14:00"
    assert duration_err.days == ["TUE", "THU"]

    overlap_err = next(c for c in res.conflicts if c.rule == "TEACHER_OVERLAP")
    assert overlap_err.day == "MON"
    assert overlap_err.days == ["MON"]
    assert overlap_err.subject_load_id == 101
    assert overlap_err.start_time == "08:00"
    assert overlap_err.end_time == "08:45"
    assert overlap_err.related_subject_load_id == 201
    assert overlap_err.related_start_time == "08:00"
    assert overlap_err.related_end_time == "08:45"


def test_daily_workload_exceeded_only_associates_sections_scheduled_on_overloaded_day(c4_ctx):
    db = c4_ctx["db"]
    period = c4_ctx["period"]
    classes = c4_ctx["classes"]
    math = c4_ctx["math"]
    science = c4_ctx["science"]
    teacher = c4_ctx["teacher"]

    db.add_all([
        Setting(key="min_subjects_per_day", value="1", type=SettingType.INTEGER, group="workload", is_public=True),
        Setting(key="max_subjects_per_day", value="2", type=SettingType.INTEGER, group="workload", is_public=True),
        Setting(key="max_hours_per_day", value="6.0", type=SettingType.STRING, group="workload", is_public=True),
    ])
    db.commit()

    # Overloaded on MON across classes[0], classes[1], classes[2] (3 > 2).
    # classes[3] is ONLY scheduled on TUE (1 <= 2) -> must NOT be in MON's affected_keys.
    loads = [
        SubjectLoadItem(
            class_id=classes[0].class_id,
            subject_id=math.subject_id,
            staff_id=teacher.staff_id,
            academic_period_id=period.academic_period_id,
            start_time="08:00",
            end_time="08:45",
            days_of_week=["MON"],
        ),
        SubjectLoadItem(
            class_id=classes[1].class_id,
            subject_id=math.subject_id,
            staff_id=teacher.staff_id,
            academic_period_id=period.academic_period_id,
            start_time="08:45",
            end_time="09:30",
            days_of_week=["MON"],
        ),
        SubjectLoadItem(
            class_id=classes[2].class_id,
            subject_id=math.subject_id,
            staff_id=teacher.staff_id,
            academic_period_id=period.academic_period_id,
            start_time="09:45",
            end_time="10:30",
            days_of_week=["MON"],
        ),
        SubjectLoadItem(
            class_id=classes[3].class_id,
            subject_id=science.subject_id,
            staff_id=teacher.staff_id,
            academic_period_id=period.academic_period_id,
            start_time="08:00",
            end_time="08:45",
            days_of_week=["TUE"],
        ),
    ]

    res = ConflictDetectorService.validate_loads(db=db, loads=loads, academic_period=period)
    exceeded = [c for c in res.conflicts if c.rule == "DAILY_WORKLOAD_EXCEEDED"]
    assert len(exceeded) == 1
    assert exceeded[0].day == "MON"
    assert exceeded[0].days == ["MON"]
    assert exceeded[0].affected_keys == sorted([
        f"{classes[0].class_id}_{math.subject_id}",
        f"{classes[1].class_id}_{math.subject_id}",
        f"{classes[2].class_id}_{math.subject_id}",
    ])
    assert f"{classes[3].class_id}_{science.subject_id}" not in exceeded[0].affected_keys

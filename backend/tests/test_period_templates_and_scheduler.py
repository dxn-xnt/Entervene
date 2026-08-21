import uuid
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.main import app
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.people.AcademicStaff import AcademicStaff
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.schemas.SubjectLoad import SubjectLoadItem
from app.services.academic.AutoSchedulerService import AutoSchedulerService
from app.services.academic.ConflictDetectorService import ConflictDetectorService, times_overlap


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

    # Seed Academic Year
    from datetime import date
    ay = AcademicYear(academic_year_id=1, year_label="2025-2026", start_date=date(2025, 8, 1), end_date=date(2026, 5, 31), is_active=True)
    session.add(ay)

    # Seed JHS Template Slots
    defaults = [
        ("JHS_45MIN", "Homeroom Guidance", "HOMEROOM", "07:30", "08:00", True, 1),
        ("JHS_45MIN", "Period 1", "CLASS", "08:00", "08:45", False, 2),
        ("JHS_45MIN", "Period 2", "CLASS", "08:45", "09:30", False, 3),
        ("JHS_45MIN", "Morning Recess", "RECESS", "09:30", "09:45", True, 4),
        ("JHS_45MIN", "Period 3", "CLASS", "09:45", "10:30", False, 5),
        ("JHS_45MIN", "Period 4", "CLASS", "10:30", "11:15", False, 6),
        ("JHS_45MIN", "Period 5", "CLASS", "11:15", "12:00", False, 7),
        ("JHS_45MIN", "Lunch Break", "LUNCH", "12:00", "13:00", True, 8),
        ("JHS_45MIN", "Enhanced Period 1", "CLASS", "13:00", "14:00", False, 9),
        ("JHS_45MIN", "Enhanced Period 2", "CLASS", "14:00", "15:00", False, 10),
        ("JHS_45MIN", "Afternoon Recess", "RECESS", "15:00", "15:30", True, 11),
        ("JHS_45MIN", "Period 6", "CLASS", "15:30", "16:15", False, 12),
        ("JHS_45MIN", "Period 7", "CLASS", "16:15", "17:00", False, 13),
    ]
    for grp, name, stype, start, end, locked, ord_idx in defaults:
        session.add(
            PeriodTemplateSlot(
                template_group=grp,
                slot_name=name,
                slot_type=stype,
                start_time=start,
                end_time=end,
                is_locked_break=locked,
                display_order=ord_idx,
            )
        )
    session.commit()

    try:
        yield session
    finally:
        app.dependency_overrides.clear()
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def test_dynamic_period_slot_change_reflected_in_auto_schedule(db):
    """
    Asserts that changing a PeriodTemplateSlot time directly in the DB
    is immediately reflected when auto-scheduling loads (no stale constants).
    """
    p1 = db.query(PeriodTemplateSlot).filter(
        PeriodTemplateSlot.template_group == "JHS_45MIN",
        PeriodTemplateSlot.slot_name == "Period 1"
    ).first()
    p1.start_time = "08:15"
    p1.end_time = "09:00"
    db.commit()

    cls = Class(class_id=1, section_name="Archimedes", academic_year_id=1, academic_level_id=9, period_template_group="JHS_45MIN")
    sub = Subject(subject_id=101, subject_name="Filipino 9", is_core=True, is_math_or_science=False)
    db.add_all([cls, sub])
    db.commit()

    loads = [SubjectLoadItem(class_id=1, subject_id=101, academic_period_id=1)]
    scheduled = AutoSchedulerService.auto_schedule_loads(db=db, loads=loads)

    assert scheduled[0].start_time == "08:15"
    assert scheduled[0].end_time == "09:00"


def test_zero_overlap_with_locked_breaks(db):
    """
    Asserts that auto-scheduled loads never overlap with any is_locked_break=True slots.
    """
    cls = Class(class_id=1, section_name="Archimedes", academic_year_id=1, academic_level_id=9, period_template_group="JHS_45MIN")
    subs = [
        Subject(subject_id=1, subject_name="Math 9", is_core=True, is_math_or_science=True),
        Subject(subject_id=2, subject_name="Science 9", is_core=True, is_math_or_science=True),
        Subject(subject_id=3, subject_name="Filipino 9", is_core=True, is_math_or_science=False),
        Subject(subject_id=4, subject_name="English 9", is_core=True, is_math_or_science=False),
        Subject(subject_id=5, subject_name="AP 9", is_core=True, is_math_or_science=False),
        Subject(subject_id=6, subject_name="MAPEH 9", is_core=True, is_math_or_science=False),
        Subject(subject_id=7, subject_name="TLE 9", is_core=True, is_math_or_science=False),
        Subject(subject_id=8, subject_name="Values 9", is_core=True, is_math_or_science=False),
        Subject(subject_id=9, subject_name="French 9", is_core=False, is_math_or_science=False),
        Subject(subject_id=10, subject_name="Research 9", is_core=False, is_math_or_science=False),
    ]
    db.add(cls)
    db.add_all(subs)
    db.commit()

    loads = [SubjectLoadItem(class_id=1, subject_id=s.subject_id, academic_period_id=1) for s in subs]
    scheduled = AutoSchedulerService.auto_schedule_loads(db=db, loads=loads)

    break_slots = db.query(PeriodTemplateSlot).filter(
        PeriodTemplateSlot.template_group == "JHS_45MIN",
        PeriodTemplateSlot.is_locked_break == True
    ).all()

    for item in scheduled:
        for b in break_slots:
            assert not times_overlap(item.start_time, item.end_time, b.start_time, b.end_time), (
                f"Subject {item.subject_id} ({item.start_time}-{item.end_time}) overlapped with break {b.slot_name} ({b.start_time}-{b.end_time})"
            )


def test_shared_jhs_template_across_grades_7_to_10(db):
    """
    Asserts that sections across Grades 7, 8, 9, and 10 all resolve to the same JHS_45MIN DB template.
    """
    classes = [
        Class(class_id=701, section_name="Section 7", academic_year_id=1, academic_level_id=7, period_template_group="JHS_45MIN"),
        Class(class_id=801, section_name="Section 8", academic_year_id=1, academic_level_id=8, period_template_group="JHS_45MIN"),
        Class(class_id=901, section_name="Section 9", academic_year_id=1, academic_level_id=9, period_template_group="JHS_45MIN"),
        Class(class_id=1001, section_name="Section 10", academic_year_id=1, academic_level_id=10, period_template_group="JHS_45MIN"),
    ]
    db.add_all(classes)
    db.commit()

    for c in classes:
        enhanced, standard, breaks = AutoSchedulerService.get_group_template_slots(c.period_template_group, db)
        assert len(enhanced) == 2
        assert len(standard) == 7
        assert len(breaks) == 4


def test_db_is_math_or_science_flag_strictly_controls_enhanced_slots(db):
    """
    Asserts that subjects with is_math_or_science=True get the Enhanced slots,
    while non-math/science subjects with 'science' in their name (e.g. Science Research)
    do NOT take enhanced slots and route to standard periods without colliding.
    """
    cls = Class(class_id=1, section_name="Archimedes", academic_year_id=1, academic_level_id=9, period_template_group="JHS_45MIN")
    s_math = Subject(subject_id=1, subject_name="Enhanced Mathematics 9", is_core=True, is_math_or_science=True)
    s_sci = Subject(subject_id=2, subject_name="Enhanced Science 9", is_core=True, is_math_or_science=True)
    s_res = Subject(subject_id=3, subject_name="Science Research", is_core=False, is_math_or_science=False)
    db.add_all([cls, s_math, s_sci, s_res])
    db.commit()

    loads = [
        SubjectLoadItem(class_id=1, subject_id=1, academic_period_id=1),
        SubjectLoadItem(class_id=1, subject_id=2, academic_period_id=1),
        SubjectLoadItem(class_id=1, subject_id=3, academic_period_id=1),
    ]
    scheduled = AutoSchedulerService.auto_schedule_loads(db=db, loads=loads)

    scheduled_map = {l.subject_id: l for l in scheduled}
    assert scheduled_map[1].start_time in ["13:00", "14:00"]
    assert scheduled_map[2].start_time in ["13:00", "14:00"]
    # Science Research must NOT be in 13:00 or 14:00
    assert scheduled_map[3].start_time not in ["13:00", "14:00"]


def test_locked_sections_remain_untouched_during_auto_generate_all(db):
    """
    Asserts that locked/published sections are completely preserved
    and their teacher commitments act as constraints for unlocked sections.
    """
    cls1 = Class(class_id=1, section_name="Archimedes", academic_year_id=1, academic_level_id=9, period_template_group="JHS_45MIN")
    cls2 = Class(class_id=2, section_name="Copernicus", academic_year_id=1, academic_level_id=9, period_template_group="JHS_45MIN")
    sub = Subject(subject_id=1, subject_name="Math 9", is_core=True, is_math_or_science=True)
    teacher = AcademicStaff(staff_id="T001", first_name="Angel", last_name="Alcantara")
    db.add_all([cls1, cls2, sub, teacher])
    db.commit()

    locked_load = SubjectLoadItem(
        class_id=1,
        subject_id=1,
        academic_period_id=1,
        staff_id="T001",
        start_time="13:00",
        end_time="14:00",
        days_of_week=["MON", "TUE", "WED", "THU", "FRI"],
        status="published",
        is_locked=True,
    )
    unlocked_load = SubjectLoadItem(
        class_id=2,
        subject_id=1,
        academic_period_id=1,
        staff_id="T001",
    )

    scheduled = AutoSchedulerService.auto_schedule_loads(db=db, loads=[locked_load, unlocked_load])

    res_locked = next(l for l in scheduled if l.class_id == 1)
    res_unlocked = next(l for l in scheduled if l.class_id == 2)

    # Locked load remains 100% untouched
    assert res_locked.start_time == "13:00"
    assert res_locked.end_time == "14:00"

    # Unlocked load sharing the same teacher is scheduled at 14:00 to avoid double booking
    assert res_unlocked.start_time == "14:00"
    assert res_unlocked.end_time == "15:00"


def test_is_core_subjects_prioritized_for_5day_slots(db):
    """
    Asserts that is_core=True subjects receive full 5-day slots (DAYS_5),
    while non-core subjects split across MWF / TTH when capacity requires.
    """
    cls = Class(class_id=1, section_name="Archimedes", academic_year_id=1, academic_level_id=9, period_template_group="JHS_45MIN")
    core_subs = [
        Subject(subject_id=i, subject_name=f"Core {i}", is_core=True, is_math_or_science=False)
        for i in range(1, 7)
    ]
    non_core_subs = [
        Subject(subject_id=7, subject_name="Elective A", is_core=False, is_math_or_science=False),
        Subject(subject_id=8, subject_name="Elective B", is_core=False, is_math_or_science=False),
    ]
    db.add(cls)
    db.add_all(core_subs + non_core_subs)
    db.commit()

    loads = [SubjectLoadItem(class_id=1, subject_id=s.subject_id, academic_period_id=1) for s in core_subs + non_core_subs]
    scheduled = AutoSchedulerService.auto_schedule_loads(db=db, loads=loads)

    scheduled_map = {l.subject_id: l for l in scheduled}
    for i in range(1, 7):
        assert scheduled_map[i].days_of_week == ["MON", "TUE", "WED", "THU", "FRI"], f"Core subject {i} did not get 5 days"

    # Non-core electives split across MWF and TTH
    assert sorted(scheduled_map[7].days_of_week + scheduled_map[8].days_of_week) == [
        "FRI", "MON", "THU", "TUE", "WED"
    ]


def test_teacher_conflict_demotion_and_live_rebalance(db):
    """
    Asserts that if a core subject's teacher has a conflict on 5-day,
    it falls back to a non-conflicting split pattern without collision,
    and remaining 5-day capacity is offered to the next subject.
    """
    cls1 = Class(class_id=1, section_name="Archimedes", academic_year_id=1, academic_level_id=9, period_template_group="JHS_45MIN")
    cls2 = Class(class_id=2, section_name="Copernicus", academic_year_id=1, academic_level_id=9, period_template_group="JHS_45MIN")
    t1 = AcademicStaff(staff_id="T001", first_name="Busy", last_name="Teacher")
    t2 = AcademicStaff(staff_id="T002", first_name="Free", last_name="Teacher")
    s1 = Subject(subject_id=1, subject_name="Core Subject 1", is_core=True, is_math_or_science=False)
    s2 = Subject(subject_id=2, subject_name="Core Subject 2", is_core=True, is_math_or_science=False)
    db.add_all([cls1, cls2, t1, t2, s1, s2])
    db.commit()

    # Pre-occupy T1 on MON, WED, FRI across all standard morning slots in Class 1
    locked_loads = [
        SubjectLoadItem(
            class_id=1,
            subject_id=s1.subject_id,
            academic_period_id=1,
            staff_id="T001",
            start_time="08:00",
            end_time="08:45",
            days_of_week=["MON", "WED", "FRI"],
            is_locked=True,
        ),
        SubjectLoadItem(
            class_id=1,
            subject_id=s1.subject_id,
            academic_period_id=1,
            staff_id="T001",
            start_time="08:45",
            end_time="09:30",
            days_of_week=["MON", "WED", "FRI"],
            is_locked=True,
        ),
        SubjectLoadItem(
            class_id=1,
            subject_id=s1.subject_id,
            academic_period_id=1,
            staff_id="T001",
            start_time="09:45",
            end_time="10:30",
            days_of_week=["MON", "WED", "FRI"],
            is_locked=True,
        ),
        SubjectLoadItem(
            class_id=1,
            subject_id=s1.subject_id,
            academic_period_id=1,
            staff_id="T001",
            start_time="10:30",
            end_time="11:15",
            days_of_week=["MON", "WED", "FRI"],
            is_locked=True,
        ),
        SubjectLoadItem(
            class_id=1,
            subject_id=s1.subject_id,
            academic_period_id=1,
            staff_id="T001",
            start_time="11:15",
            end_time="12:00",
            days_of_week=["MON", "WED", "FRI"],
            is_locked=True,
        ),
        SubjectLoadItem(
            class_id=1,
            subject_id=s1.subject_id,
            academic_period_id=1,
            staff_id="T001",
            start_time="15:30",
            end_time="16:15",
            days_of_week=["MON", "WED", "FRI"],
            is_locked=True,
        ),
        SubjectLoadItem(
            class_id=1,
            subject_id=s1.subject_id,
            academic_period_id=1,
            staff_id="T001",
            start_time="16:15",
            end_time="17:00",
            days_of_week=["MON", "WED", "FRI"],
            is_locked=True,
        ),
    ]

    # In Class 2, T1 teaches s1 (cannot get 5-day because T1 is busy every MWF), but T2 teaches s2 (free)
    unlocked_loads = [
        SubjectLoadItem(class_id=2, subject_id=s1.subject_id, academic_period_id=1, staff_id="T001"),
        SubjectLoadItem(class_id=2, subject_id=s2.subject_id, academic_period_id=1, staff_id="T002"),
    ]

    scheduled = AutoSchedulerService.auto_schedule_loads(db=db, loads=locked_loads + unlocked_loads)

    res_t1 = next(l for l in scheduled if l.class_id == 2 and l.staff_id == "T001")
    res_t2 = next(l for l in scheduled if l.class_id == 2 and l.staff_id == "T002")

    # T1 cannot take MWF or 5-day, so it gets TUE, THU
    assert res_t1.days_of_week == ["TUE", "THU"]

    # T2 gets full 5-day (rebalanced capacity)
    assert res_t2.days_of_week == ["MON", "TUE", "WED", "THU", "FRI"]

    # Assert that ConflictDetectorService emits CORE_SUBJECT_SPLIT_SCHEDULE warning for s1
    val_res = ConflictDetectorService.validate_loads(db=db, loads=scheduled)
    assert any(
        c.rule == "CORE_SUBJECT_SPLIT_SCHEDULE" and c.class_id == 2 and c.subject_id == s1.subject_id
        for c in val_res.conflicts
    ), "Expected CORE_SUBJECT_SPLIT_SCHEDULE warning for demoted core subject"


def test_period_template_update_endpoint_cascades_to_unlocked_schedules(db):
    """
    Asserts that PUT /period-templates automatically cascades time changes
    from a period slot (e.g. 16:15-17:00 -> 16:15-17:01) to existing unlocked subject loads.
    """
    from app.schemas.SubjectLoad import PeriodTemplateSlotSchema
    from app.api.v1.routes.SubjectLoads import update_period_templates

    cls = Class(class_id=1, section_name="Archimedes", academic_year_id=1, academic_level_id=9, period_template_group="JHS_45MIN")
    sub = Subject(subject_id=1, subject_name="Araling Panlipunan 9", is_core=True)
    db.add_all([cls, sub])
    db.commit()

    # Pre-existing draft load at Period 7 (16:15 - 17:00)
    existing_load = SubjectLoad(
        class_id=1,
        subject_id=1,
        academic_period_id=1,
        start_time="16:15",
        end_time="17:00",
        days_of_week=["MON", "TUE", "WED", "THU", "FRI"],
        status="draft",
        is_locked=False,
    )
    db.add(existing_load)
    db.commit()

    p7 = db.query(PeriodTemplateSlot).filter(
        PeriodTemplateSlot.template_group == "JHS_45MIN",
        PeriodTemplateSlot.slot_name == "Period 7",
    ).first()

    payload = [
        PeriodTemplateSlotSchema(
            slot_id=p7.slot_id,
            template_group=p7.template_group,
            slot_name=p7.slot_name,
            slot_type=p7.slot_type,
            start_time="16:15",
            end_time="17:01",
            is_locked_break=False,
            display_order=p7.display_order,
        )
    ]

    res = update_period_templates(payload=payload, current_user={"role": "admin"}, db=db)
    assert res["message"] == "Period templates updated and cascaded to schedules successfully."

    # Verify that the existing subject load in DB has been updated to 17:01
    db.refresh(existing_load)
    assert existing_load.start_time == "16:15"
    assert existing_load.end_time == "17:01"


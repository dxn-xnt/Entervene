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
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.academic.PeriodTemplateRevision import PeriodTemplateRevision
from app.schemas.SubjectLoad import PeriodTemplateSlotSchema
from app.services.academic.PeriodTemplateRevisionService import (
    CONFIRMATION_PHRASE,
    PeriodTemplateRevisionService,
)


def add_offerings(db, class_obj, subjects, minutes=45, period_id=1):
    for subject in subjects:
        duration = minutes[subject.subject_id] if isinstance(minutes, dict) else minutes
        db.add(SubjectOffering(
            subject_id=subject.subject_id,
            academic_year_id=class_obj.academic_year_id,
            academic_level_id=class_obj.academic_level_id,
            academic_period_id=period_id,
            minutes=duration,
            status="active",
        ))
    db.commit()


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
    sub = Subject(subject_id=101, subject_name="Filipino 9", is_core=True)
    db.add_all([cls, sub])
    db.commit()
    add_offerings(db, cls, [sub], 45)

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
        Subject(subject_id=1, subject_name="Math 9", is_core=True),
        Subject(subject_id=2, subject_name="Science 9", is_core=True),
        Subject(subject_id=3, subject_name="Filipino 9", is_core=True),
        Subject(subject_id=4, subject_name="English 9", is_core=True),
        Subject(subject_id=5, subject_name="AP 9", is_core=True),
        Subject(subject_id=6, subject_name="MAPEH 9", is_core=True),
        Subject(subject_id=7, subject_name="TLE 9", is_core=True),
        Subject(subject_id=8, subject_name="Values 9", is_core=True),
        Subject(subject_id=9, subject_name="French 9", is_core=False),
        Subject(subject_id=10, subject_name="Research 9", is_core=False),
    ]
    db.add(cls)
    db.add_all(subs)
    db.commit()
    add_offerings(db, cls, subs, {1: 60, 2: 60, **{i: 45 for i in range(3, 11)}})

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
        assert len(enhanced) == 0
        assert len(standard) == 9
        assert len(breaks) == 4


def test_default_jhs_template_seed_is_idempotent_and_repairs_missing_slot(db):
    from app.api.v1.routes.SubjectLoads import ensure_default_period_templates

    missing = db.query(PeriodTemplateSlot).filter(
        PeriodTemplateSlot.template_group == "JHS_45MIN",
        PeriodTemplateSlot.slot_name == "Period 7",
    ).one()
    db.delete(missing)
    db.commit()

    ensure_default_period_templates(db)
    ensure_default_period_templates(db)

    slots = db.query(PeriodTemplateSlot).filter(
        PeriodTemplateSlot.template_group == "JHS_45MIN"
    ).all()
    assert len(slots) == 13
    assert len({slot.slot_name for slot in slots}) == 13


def test_jhs_slot_id_is_authoritative_and_forged_times_are_ignored(db):
    from app.api.v1.routes.SubjectLoads import _normalize_jhs_load_slots

    level = AcademicLevel(level_name="Grade 8", grade_level=8)
    db.add(level)
    db.flush()
    cls = Class(
        class_id=80, section_name="Plato", academic_year_id=1,
        academic_level_id=level.academic_level_id,
        period_template_group="JHS_45MIN",
    )
    db.add(cls)
    db.commit()
    period_1 = db.query(PeriodTemplateSlot).filter(
        PeriodTemplateSlot.template_group == "JHS_45MIN",
        PeriodTemplateSlot.slot_name == "Period 1",
    ).one()

    normalized = _normalize_jhs_load_slots(db, [SubjectLoadItem(
        class_id=cls.class_id, subject_id=1, academic_period_id=1,
        slot_id=period_1.slot_id, start_time="15:30", end_time="16:15",
        days_of_week=["MON"], status="draft",
    )])[0]

    assert normalized.slot_id == period_1.slot_id
    assert (normalized.start_time, normalized.end_time) == ("08:00", "08:45")


def test_jhs_break_slot_cannot_be_assigned_to_subject_load(db):
    from app.api.v1.routes.SubjectLoads import _normalize_jhs_load_slots

    level = AcademicLevel(level_name="Grade 10", grade_level=10)
    db.add(level)
    db.flush()
    cls = Class(
        class_id=100, section_name="Newton", academic_year_id=1,
        academic_level_id=level.academic_level_id,
        period_template_group="JHS_45MIN",
    )
    db.add(cls)
    db.commit()
    recess = db.query(PeriodTemplateSlot).filter(
        PeriodTemplateSlot.template_group == "JHS_45MIN",
        PeriodTemplateSlot.slot_name == "Morning Recess",
    ).one()

    with pytest.raises(Exception, match="not an assignable Grade 7-10 class period"):
        _normalize_jhs_load_slots(db, [SubjectLoadItem(
            class_id=cls.class_id, subject_id=1, academic_period_id=1,
            slot_id=recess.slot_id, start_time=recess.start_time,
            end_time=recess.end_time, days_of_week=["MON"], status="draft",
        )])


def test_jhs_backfill_updates_exact_drafts_but_not_published_history(db):
    from app.api.v1.routes.SubjectLoads import ensure_jhs_template_assignments_and_backfill

    level = AcademicLevel(level_name="Grade 9", grade_level=9)
    db.add(level)
    db.flush()
    cls = Class(
        class_id=90, section_name="Socrates", academic_year_id=1,
        academic_level_id=level.academic_level_id,
        period_template_group=None,
    )
    db.add(cls)
    db.flush()
    db.add_all([
        Subject(subject_id=901, subject_name="Draft Subject"),
        Subject(subject_id=902, subject_name="Published Subject"),
    ])
    db.flush()
    draft = SubjectLoad(
        class_id=cls.class_id, subject_id=901, academic_period_id=1,
        start_time="08:00", end_time="08:45", days_of_week=["MON"], status="draft",
    )
    published = SubjectLoad(
        class_id=cls.class_id, subject_id=902, academic_period_id=1,
        start_time="08:00", end_time="08:45", days_of_week=["TUE"],
        status="published", is_active_version=True, is_locked=True,
    )
    db.add_all([draft, published])
    db.commit()

    audit = ensure_jhs_template_assignments_and_backfill(db)
    db.refresh(cls)
    db.refresh(draft)
    db.refresh(published)

    assert cls.period_template_group == "JHS_45MIN"
    assert draft.slot_id is not None
    assert published.slot_id is None
    assert audit["draft_loads_backfilled"] == 1


def test_complete_jhs_template_rejects_overlapping_periods(db):
    from app.api.v1.routes.SubjectLoads import _validate_period_template_payload
    from app.schemas.SubjectLoad import PeriodTemplateSlotSchema

    rows = db.query(PeriodTemplateSlot).filter(
        PeriodTemplateSlot.template_group == "JHS_45MIN"
    ).order_by(PeriodTemplateSlot.display_order).all()
    payload = [PeriodTemplateSlotSchema(
        slot_id=row.slot_id,
        template_group=row.template_group,
        slot_name=row.slot_name,
        slot_type=row.slot_type,
        start_time="08:30" if row.slot_name == "Period 2" else row.start_time,
        end_time=row.end_time,
        is_locked_break=row.is_locked_break,
        display_order=row.display_order,
    ) for row in rows]

    with pytest.raises(Exception, match="overlapping slots"):
        _validate_period_template_payload(db, payload, 360, 1200, "06:00", "20:00")


def test_offering_duration_strictly_controls_matching_slots(db):
    """
    Offering minutes, not subject names, control slot placement.
    """
    cls = Class(class_id=1, section_name="Archimedes", academic_year_id=1, academic_level_id=9, period_template_group="JHS_45MIN")
    s_math = Subject(subject_id=1, subject_name="Enhanced Mathematics 9", is_core=True)
    s_sci = Subject(subject_id=2, subject_name="Enhanced Science 9", is_core=True)
    s_res = Subject(subject_id=3, subject_name="Science Research", is_core=False)
    db.add_all([cls, s_math, s_sci, s_res])
    db.commit()
    add_offerings(db, cls, [s_math, s_sci, s_res], {1: 60, 2: 60, 3: 45})

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
    sub = Subject(subject_id=1, subject_name="Math 9", is_core=True)
    teacher = AcademicStaff(staff_id="T001", first_name="Angel", last_name="Alcantara")
    db.add_all([cls1, cls2, sub, teacher])
    db.commit()
    add_offerings(db, cls1, [sub], 60)

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
        Subject(subject_id=i, subject_name=f"Core {i}", is_core=True)
        for i in range(1, 7)
    ]
    non_core_subs = [
        Subject(subject_id=7, subject_name="Elective A", is_core=False),
        Subject(subject_id=8, subject_name="Elective B", is_core=False),
    ]
    db.add(cls)
    db.add_all(core_subs + non_core_subs)
    db.commit()
    add_offerings(db, cls, core_subs + non_core_subs, 45)

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
    s1 = Subject(subject_id=1, subject_name="Core Subject 1", is_core=True)
    s2 = Subject(subject_id=2, subject_name="Core Subject 2", is_core=True)
    db.add_all([cls1, cls2, t1, t2, s1, s2])
    db.commit()
    add_offerings(db, cls1, [s1, s2], 45)

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


def test_auto_scheduler_leaves_load_unscheduled_when_no_safe_slot_exists(db):
    cls = Class(class_id=1, section_name="Full", academic_year_id=1, academic_level_id=9, period_template_group="JHS_45MIN")
    occupied_subject = Subject(subject_id=1, subject_name="Occupied")
    target_subject = Subject(subject_id=2, subject_name="Target")
    db.add_all([cls, occupied_subject, target_subject])
    db.commit()

    _, standard_periods, _ = AutoSchedulerService.get_group_template_slots("JHS_45MIN", db)
    locked = [
        SubjectLoadItem(
            class_id=1,
            subject_id=1,
            academic_period_id=1,
            start_time=start,
            end_time=end,
            days_of_week=["MON", "TUE", "WED", "THU", "FRI"],
            is_locked=True,
        )
        for start, end in standard_periods
    ]
    target = SubjectLoadItem(class_id=1, subject_id=2, academic_period_id=1)

    AutoSchedulerService.auto_schedule_loads(db=db, loads=locked + [target])

    assert target.start_time is None
    assert target.end_time is None
    assert target.days_of_week == []


def test_teacher_overlap_identifies_both_affected_loads(db):
    classes = [
        Class(class_id=1, section_name="One", academic_year_id=1, academic_level_id=9),
        Class(class_id=2, section_name="Two", academic_year_id=1, academic_level_id=9),
    ]
    subjects = [
        Subject(subject_id=1, subject_name="First"),
        Subject(subject_id=2, subject_name="Second"),
    ]
    teacher = AcademicStaff(staff_id="T001", first_name="Shared", last_name="Teacher")
    db.add_all(classes + subjects + [teacher])
    db.commit()

    result = ConflictDetectorService.validate_loads(db=db, loads=[
        SubjectLoadItem(class_id=1, subject_id=1, staff_id="T001", academic_period_id=1,
                        start_time="08:00", end_time="08:45", days_of_week=["MON"]),
        SubjectLoadItem(class_id=2, subject_id=2, staff_id="T001", academic_period_id=1,
                        start_time="08:30", end_time="09:15", days_of_week=["MON"]),
    ])

    conflict = next(item for item in result.conflicts if item.rule == "TEACHER_OVERLAP")
    assert set(conflict.affected_keys) == {"1_1", "2_2"}
    assert conflict.related_class_id == 2
    assert conflict.related_subject_id == 2


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


def test_period_template_update_endpoint_blocks_locked_published_schedules(db):
    """
    Published schedules are immutable. The admin must unlock and create a
    draft revision before changing a linked class period.
    """
    from app.schemas.SubjectLoad import PeriodTemplateSlotSchema
    from app.api.v1.routes.SubjectLoads import update_period_templates

    cls = Class(class_id=2, section_name="Galileo", academic_year_id=1, academic_level_id=9, period_template_group="JHS_45MIN")
    sub = Subject(subject_id=2, subject_name="English 9", is_core=True)
    db.add_all([cls, sub])
    db.commit()

    # Pre-existing published and locked load at Period 1 (08:00 - 08:45)
    locked_load = SubjectLoad(
        class_id=2,
        subject_id=2,
        academic_period_id=1,
        start_time="08:00",
        end_time="08:45",
        days_of_week=["MON", "TUE", "WED", "THU", "FRI"],
        status="published",
        is_locked=True,
    )
    db.add(locked_load)
    db.commit()

    p1 = db.query(PeriodTemplateSlot).filter(
        PeriodTemplateSlot.template_group == "JHS_45MIN",
        PeriodTemplateSlot.slot_name == "Period 1",
    ).first()

    payload = [
        PeriodTemplateSlotSchema(
            slot_id=p1.slot_id,
            template_group=p1.template_group,
            slot_name=p1.slot_name,
            slot_type=p1.slot_type,
            start_time="08:01",
            end_time="08:46",
            is_locked_break=False,
            display_order=p1.display_order,
        )
    ]

    with pytest.raises(Exception, match="locked published section"):
        update_period_templates(payload=payload, current_user={"role": "admin"}, db=db)

    # Verify that neither the template nor published history was changed.
    db.refresh(p1)
    db.refresh(locked_load)
    assert (p1.start_time, p1.end_time) == ("08:00", "08:45")
    assert locked_load.start_time == "08:00"
    assert locked_load.end_time == "08:45"
    assert locked_load.status == "published"
    assert locked_load.is_locked is True


def test_published_template_override_creates_new_revision_without_mutating_history(db):
    from datetime import timedelta
    from app.services.academic.SubstitutionService import SubstitutionService

    today = SubstitutionService.get_academic_date()
    period = AcademicPeriod(
        period_name="Current Term",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        start_date=today - timedelta(days=30),
        end_date=today + timedelta(days=30),
        is_active=True,
        academic_year_id=1,
    )
    level = AcademicLevel(level_name="Grade 9 Override", grade_level=9)
    db.add_all([period, level])
    db.flush()
    cls = Class(
        section_name="Revision Section",
        academic_year_id=1,
        academic_level_id=level.academic_level_id,
        period_template_group="JHS_45MIN",
    )
    subject = Subject(
        subject_name="Revision Subject",
        subject_codename="REV",
        academic_level_id=level.academic_level_id,
        grading_template_id=1,
        is_core=False,
    )
    teacher = AcademicStaff(staff_id="REV-T1", first_name="Revision", last_name="Teacher")
    db.add_all([cls, subject, teacher])
    db.flush()
    db.add(SubjectOffering(
        subject_id=subject.subject_id,
        academic_year_id=1,
        academic_level_id=level.academic_level_id,
        academic_period_id=period.academic_period_id,
        minutes=40,
        status="active",
    ))
    period_one = db.query(PeriodTemplateSlot).filter(
        PeriodTemplateSlot.template_group == "JHS_45MIN",
        PeriodTemplateSlot.slot_name == "Period 1",
    ).one()
    original = SubjectLoad(
        class_id=cls.class_id,
        subject_id=subject.subject_id,
        staff_id=teacher.staff_id,
        academic_period_id=period.academic_period_id,
        slot_id=period_one.slot_id,
        start_time=period_one.start_time,
        end_time=period_one.end_time,
        days_of_week=["MON", "TUE", "WED", "THU", "FRI"],
        status="published",
        is_active_version=True,
        is_locked=True,
        section_revision=1,
        logical_load_id=f"LL_{cls.class_id}_{subject.subject_id}_{period.academic_period_id}",
    )
    db.add(original)
    db.commit()

    rows = db.query(PeriodTemplateSlot).filter(
        PeriodTemplateSlot.template_group == "JHS_45MIN"
    ).order_by(PeriodTemplateSlot.display_order).all()
    submitted = [PeriodTemplateSlotSchema(
        slot_id=row.slot_id,
        template_group="JHS_45MIN",
        slot_name=row.slot_name,
        slot_type=row.slot_type,
        start_time=row.start_time,
        end_time="08:40" if row.slot_name == "Period 1" else row.end_time,
        is_locked_break=row.is_locked_break,
        display_order=row.display_order,
    ) for row in rows]

    preview = PeriodTemplateRevisionService.create_preview(
        db,
        period=period,
        submitted_slots=submitted,
        effective_date=today,
        actor="admin@example.test",
    )
    assert preview["can_apply"] is True
    assert preview["affected_section_count"] == 1
    assert preview["affected_published_load_count"] == 1

    with pytest.raises(Exception, match="Type REPLACE PUBLISHED SCHEDULES exactly"):
        PeriodTemplateRevisionService.apply_preview(
            db,
            token=preview["preview_token"],
            confirmation="replace",
            actor="admin@example.test",
        )
    db.rollback()

    result = PeriodTemplateRevisionService.apply_preview(
        db,
        token=preview["preview_token"],
        confirmation=CONFIRMATION_PHRASE,
        actor="admin@example.test",
    )
    assert result["status"] == "active"
    db.refresh(original)
    assert original.status == "archived"
    assert original.is_active_version is False
    assert (original.start_time, original.end_time) == ("08:00", "08:45")

    replacement = db.query(SubjectLoad).filter(
        SubjectLoad.class_id == cls.class_id,
        SubjectLoad.is_active_version.is_(True),
    ).one()
    assert replacement.subject_load_id != original.subject_load_id
    assert replacement.continued_from_load_id == original.subject_load_id
    assert replacement.staff_id == original.staff_id
    assert replacement.subject_id == original.subject_id
    assert replacement.days_of_week == original.days_of_week
    assert (replacement.start_time, replacement.end_time) == ("08:00", "08:40")
    assert replacement.section_revision == 2
    assert db.query(PeriodTemplateRevision).count() == 1

    effective_rows = db.query(PeriodTemplateSlot).filter(
        PeriodTemplateSlot.template_group == db.query(PeriodTemplateRevision).one().version_template_group
    ).order_by(PeriodTemplateSlot.display_order).all()
    future_submitted = [PeriodTemplateSlotSchema(
        slot_id=row.slot_id,
        template_group="JHS_45MIN",
        slot_name=row.slot_name,
        slot_type=row.slot_type,
        start_time=row.start_time,
        end_time="08:35" if row.slot_name == "Period 1" else row.end_time,
        is_locked_break=row.is_locked_break,
        display_order=row.display_order,
    ) for row in effective_rows]
    future_date = today + timedelta(days=1)
    db.query(SubjectOffering).filter(
        SubjectOffering.subject_id == subject.subject_id,
        SubjectOffering.academic_period_id == period.academic_period_id,
    ).update({"minutes": 35})
    db.commit()
    future_preview = PeriodTemplateRevisionService.create_preview(
        db,
        period=period,
        submitted_slots=future_submitted,
        effective_date=future_date,
        actor="admin@example.test",
    )
    future_result = PeriodTemplateRevisionService.apply_preview(
        db,
        token=future_preview["preview_token"],
        confirmation=CONFIRMATION_PHRASE,
        actor="admin@example.test",
    )
    assert future_result["status"] == "scheduled"
    db.refresh(replacement)
    assert replacement.is_active_version is True
    scheduled = db.query(SubjectLoad).filter(SubjectLoad.status == "scheduled").one()
    assert scheduled.is_active_version is False

    PeriodTemplateRevisionService.activate_due_revisions(db, as_of=future_date)
    db.refresh(replacement)
    db.refresh(scheduled)
    assert replacement.status == "archived"
    assert scheduled.status == "published"
    assert scheduled.is_active_version is True
    assert (scheduled.start_time, scheduled.end_time) == ("08:00", "08:35")

    latest_revision = db.get(PeriodTemplateRevision, scheduled.template_revision_id)
    latest_rows = db.query(PeriodTemplateSlot).filter(
        PeriodTemplateSlot.template_group == latest_revision.version_template_group
    ).order_by(PeriodTemplateSlot.display_order).all()
    stale_submitted = [PeriodTemplateSlotSchema(
        slot_id=row.slot_id,
        template_group="JHS_45MIN",
        slot_name=row.slot_name,
        slot_type=row.slot_type,
        start_time=row.start_time,
        end_time="08:30" if row.slot_name == "Period 1" else row.end_time,
        is_locked_break=row.is_locked_break,
        display_order=row.display_order,
    ) for row in latest_rows]
    stale_preview = PeriodTemplateRevisionService.create_preview(
        db,
        period=period,
        submitted_slots=stale_submitted,
        effective_date=today,
        actor="admin@example.test",
    )
    revision_count = db.query(PeriodTemplateRevision).count()
    load_count = db.query(SubjectLoad).count()
    scheduled.days_of_week = ["MON", "TUE", "WED", "THU"]
    db.commit()

    with pytest.raises(Exception, match="changed after preview"):
        PeriodTemplateRevisionService.apply_preview(
            db,
            token=stale_preview["preview_token"],
            confirmation=CONFIRMATION_PHRASE,
            actor="admin@example.test",
        )
    db.rollback()
    assert db.query(PeriodTemplateRevision).count() == revision_count
    assert db.query(SubjectLoad).count() == load_count



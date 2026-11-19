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
from app.services.academic.ConflictDetectorService import ConflictDetectorService
from app.services.academic.PeriodTemplateResolver import PeriodTemplateResolver
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


def test_shared_jhs_template_across_grades_7_to_10(db):
    """
    Asserts that sections across Grades 7, 8, 9, and 10 all resolve to the same JHS_45MIN DB template.
    """
    levels = [
        AcademicLevel(academic_level_id=grade, level_name=f"Grade {grade}", grade_level=grade)
        for grade in (7, 8, 9, 10)
    ]
    classes = [
        Class(class_id=701, section_name="Section 7", academic_year_id=1, academic_level_id=7, period_template_group="JHS_45MIN"),
        Class(class_id=801, section_name="Section 8", academic_year_id=1, academic_level_id=8, period_template_group="JHS_45MIN"),
        Class(class_id=901, section_name="Section 9", academic_year_id=1, academic_level_id=9, period_template_group="JHS_45MIN"),
        Class(class_id=1001, section_name="Section 10", academic_year_id=1, academic_level_id=10, period_template_group="JHS_45MIN"),
    ]
    db.add_all(levels + classes)
    db.commit()

    for c in classes:
        resolved = PeriodTemplateResolver.slots_for_class(db, c)
        class_slots = [s for s in resolved if s.slot_type == "CLASS" and not s.is_locked_break]
        break_slots = [s for s in resolved if s.is_locked_break or s.slot_type != "CLASS"]
        assert len(class_slots) == 9
        assert len(break_slots) == 4


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


def test_core_subject_split_schedule_and_duration_validation(db):
    """
    Verifies ConflictDetectorService still enforces offering duration matching,
    break wall protection, unscheduled-load completeness, and JHS core split warnings
    after AutoSchedulerService removal.
    """
    from datetime import date

    period = AcademicPeriod(
        academic_period_id=1,
        academic_year_id=1,
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        start_date=date(2025, 8, 1),
        end_date=date(2025, 11, 30),
        is_active=True,
    )
    cls = Class(class_id=1, section_name="Archimedes", academic_year_id=1, academic_level_id=9, period_template_group="JHS_45MIN")
    s_core = Subject(subject_id=1, subject_name="Math 9", is_core=True)
    s_short = Subject(subject_id=2, subject_name="Filipino 9", is_core=False)
    teacher = AcademicStaff(staff_id="T001", first_name="Angel", last_name="Alcantara")
    db.add_all([period, cls, s_core, s_short, teacher])
    db.commit()
    add_offerings(db, cls, [s_core, s_short], {1: 60, 2: 45}, period_id=1)

    # 1. Core subject placed on a split 2-day 60-min slot emits CORE_SUBJECT_SPLIT_SCHEDULE warning,
    #    while an unscheduled load is allowed in draft validation and rejected when complete schedule is required.
    draft_loads = [
        SubjectLoadItem(
            class_id=1,
            subject_id=1,
            staff_id="T001",
            academic_period_id=1,
            start_time="13:00",
            end_time="14:00",
            days_of_week=["TUE", "THU"],
        ),
        SubjectLoadItem(
            class_id=1,
            subject_id=2,
            staff_id="T001",
            academic_period_id=1,
            start_time=None,
            end_time=None,
            days_of_week=[],
        ),
    ]
    draft_res = ConflictDetectorService.validate_loads(
        db=db, loads=draft_loads, academic_period=period, require_complete_schedule=False
    )
    assert draft_res.is_valid is True
    assert any(c.rule == "CORE_SUBJECT_SPLIT_SCHEDULE" and c.subject_id == 1 for c in draft_res.conflicts)

    publish_res = ConflictDetectorService.validate_loads(
        db=db, loads=draft_loads, academic_period=period, require_complete_schedule=True
    )
    assert publish_res.is_valid is False
    assert any(c.rule == "UNSCHEDULED_LOAD" and c.subject_id == 2 for c in publish_res.conflicts)

    # 2. Duration mismatch and break overlap are still blocked.
    bad_loads = [
        SubjectLoadItem(
            class_id=1,
            subject_id=1,
            staff_id="T001",
            academic_period_id=1,
            start_time="08:00",
            end_time="08:45",
            days_of_week=["MON", "TUE", "WED", "THU", "FRI"],
        ),
        SubjectLoadItem(
            class_id=1,
            subject_id=2,
            staff_id="T001",
            academic_period_id=1,
            start_time="12:00",
            end_time="12:45",
            days_of_week=["MON"],
        ),
    ]
    bad_res = ConflictDetectorService.validate_loads(
        db=db, loads=bad_loads, academic_period=period, require_complete_schedule=True
    )
    assert any(c.rule == "OFFERING_DURATION_MISMATCH" and c.subject_id == 1 for c in bad_res.conflicts)
    assert any(c.rule == "BREAK_TIME_VIOLATION" and c.subject_id == 2 for c in bad_res.conflicts)


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



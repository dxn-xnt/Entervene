import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from fastapi.testclient import TestClient

from app.db.Base import Base
from app.main import app
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.PeriodTemplateSlot import PeriodTemplateSlot
from app.models.settings.Setting import Setting, SettingType
from app.schemas.SubjectLoad import SubjectLoadItem
from app.services.academic.ConflictDetectorService import ConflictDetectorService
from app.api.v1.routes.SubjectLoads import ensure_default_period_templates, ensure_shs_template_groups_backfilled
from app.api.v1.routes.Auth import get_current_user


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", echo=False)
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    # Seed Academic Year & Period
    from datetime import date
    ay = AcademicYear(academic_year_id=1, year_label="2025-2026", start_date=date(2025, 8, 1), end_date=date(2026, 5, 31), is_active=True)
    session.add(ay)
    ap = AcademicPeriod(academic_period_id=1, academic_year_id=1, period_name="Term 1", start_date=date(2025, 8, 1), end_date=date(2025, 12, 15), is_active=True)
    session.add(ap)

    # Seed Academic Levels (JHS: 7, SHS: 11)
    lvl_jhs = AcademicLevel(academic_level_id=1, level_name="Grade 7", grade_level=7)
    lvl_shs = AcademicLevel(academic_level_id=5, level_name="Grade 11", grade_level=11)
    session.add_all([lvl_jhs, lvl_shs])

    # Seed default templates
    session.commit()
    ensure_default_period_templates(session)

    yield session
    session.close()


def test_conflict_detector_strict_period_template_group(db_session):
    """
    Asserts ConflictDetectorService checks break slots based strictly on class.period_template_group.
    For SHS_CAMPOS_ZARA, 08:00-09:00 and 10:24-12:00 have 0 break collisions,
    while 10:00-10:24 collides with Morning Recess.
    """
    # Create an SHS class with explicit period_template_group = SHS_CAMPOS_ZARA
    cls = Class(
        class_id=101,
        section_name="CustomSHS",
        academic_year_id=1,
        academic_level_id=5,
        period_template_group="SHS_CAMPOS_ZARA",
    )
    db_session.add(cls)

    sub1 = Subject(subject_id=1, subject_name="Subject A", is_core=True)
    sub2 = Subject(subject_id=2, subject_name="Subject B", is_core=True)
    db_session.add_all([sub1, sub2])
    db_session.commit()

    # Valid SHS slots avoiding 10:00-10:24 Morning Recess
    clean_loads = [
        SubjectLoadItem(
            academic_period_id=1,
            class_id=101,
            subject_id=1,
            start_time="08:00",
            end_time="09:00",
            days_of_week=["MON", "TUE", "WED", "THU", "FRI"],
        ),
        SubjectLoadItem(
            academic_period_id=1,
            class_id=101,
            subject_id=2,
            start_time="10:24",
            end_time="12:00",
            days_of_week=["MON", "TUE", "WED", "THU", "FRI"],
        ),
    ]

    res = ConflictDetectorService.validate_loads(db=db_session, loads=clean_loads)
    break_errors = [c for c in res.conflicts if c.rule == "BREAK_TIME_VIOLATION"]
    assert len(break_errors) == 0, "Clean SHS slots should have zero break violations"

    # Conflicting load overlapping 10:00-10:24 Morning Recess
    colliding_load = [
        SubjectLoadItem(
            academic_period_id=1,
            class_id=101,
            subject_id=1,
            start_time="09:45",
            end_time="10:30",
            days_of_week=["MON", "TUE", "WED", "THU", "FRI"],
        )
    ]
    res_collide = ConflictDetectorService.validate_loads(db=db_session, loads=colliding_load)
    break_errors_collide = [c for c in res_collide.conflicts if c.rule == "BREAK_TIME_VIOLATION"]
    assert len(break_errors_collide) == 1, "09:45-10:30 overlaps with Morning Recess (10:00-10:24)"


def test_unconfigured_bell_schedule_diagnostic(db_session):
    """
    Asserts ConflictDetectorService flags UNCONFIGURED_BELL_SCHEDULE when:
    1. A class has period_template_group is None
    2. A Senior High class (grade >= 11) is configured with JHS_45MIN
    """
    # Class with None template group
    c_unset = Class(
        class_id=201,
        section_name="UnsetSection",
        academic_year_id=1,
        academic_level_id=1,
        period_template_group=None,
    )
    # SHS Class erroneously with JHS_45MIN
    c_mismatched = Class(
        class_id=202,
        section_name="MismatchedSHS",
        academic_year_id=1,
        academic_level_id=5,
        period_template_group="JHS_45MIN",
    )
    db_session.add_all([c_unset, c_mismatched])
    db_session.commit()

    test_loads = [
        SubjectLoadItem(academic_period_id=1, class_id=201, subject_id=1, start_time="08:00", end_time="08:45"),
        SubjectLoadItem(academic_period_id=1, class_id=202, subject_id=2, start_time="08:00", end_time="08:45"),
    ]

    res = ConflictDetectorService.validate_loads(db=db_session, loads=test_loads)
    diag_warnings = [c for c in res.conflicts if c.rule == "UNCONFIGURED_BELL_SCHEDULE"]
    assert len(diag_warnings) == 2, "Both unset and mismatched SHS classes should trigger UNCONFIGURED_BELL_SCHEDULE"
    assert any("no timetable template assigned" in c.message for c in diag_warnings)
    assert any("Senior High section" in c.message for c in diag_warnings)


def test_idempotent_backfill_and_guard(db_session):
    """
    Asserts ensure_shs_template_groups_backfilled updates SHS classes, sets Setting flag,
    and is strictly idempotent on subsequent executions.
    """
    c_jhs = Class(class_id=301, section_name="JHS Sec", academic_year_id=1, academic_level_id=1, period_template_group=None)
    c_shs_campos = Class(class_id=13, section_name="Campos", academic_year_id=1, academic_level_id=5, period_template_group="JHS_45MIN")
    c_shs_zara = Class(class_id=12, section_name="Zara", academic_year_id=1, academic_level_id=5, period_template_group="JHS_45MIN")
    db_session.add_all([c_jhs, c_shs_campos, c_shs_zara])
    db_session.commit()

    # Initial backfill execution
    ensure_shs_template_groups_backfilled(db_session)

    assert c_jhs.period_template_group == "JHS_45MIN"
    assert c_shs_campos.period_template_group == "SHS_CAMPOS_ZARA"
    assert c_shs_zara.period_template_group == "SHS_CAMPOS_ZARA"

    # Flag is set in database
    flag = db_session.query(Setting).filter(Setting.key == "shs_template_groups_backfilled_v1").first()
    assert flag is not None
    assert flag.value == "true"

    # Manually reassign a section to another group
    c_shs_zara.period_template_group = "SHS_DELMUNDO_REYES"
    db_session.commit()

    # Re-running backfill must NOT overwrite manual admin changes because the flag exists
    ensure_shs_template_groups_backfilled(db_session)
    assert c_shs_zara.period_template_group == "SHS_DELMUNDO_REYES", "Idempotent backfill must not overwrite manual changes"

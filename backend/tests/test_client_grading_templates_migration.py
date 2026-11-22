"""Tests for 20261122_client_grading_templates data migration and safety invariants."""

from __future__ import annotations

import importlib.util
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
import uuid

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectYearGradingTemplate import SubjectYearGradingTemplate
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.grading.PassingThresholdReader import (
    read_passing_threshold_context_or_422,
    require_subject_passing_threshold,
)
from app.services.grading_templates.GradingTemplateQueryService import (
    list_grading_templates_data,
)
from app.services.student_record.StudentRecordService import (
    resolve_subject_grading_weights,
)


MIGRATION_PATH = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "versions"
    / "20261122_align_client_grading_templates.py"
)


def _load_migration():
    spec = importlib.util.spec_from_file_location("client_grading_migration", MIGRATION_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def _make_template(name: str, family: str, weights: tuple[int, int, int], threshold: int = 85, desc: str | None = None):
    tpl = GradingTemplate(
        template_name=name,
        template_family_code=family,
        revision=1,
        passing_threshold=Decimal(str(threshold)),
        description=desc,
        status="active",
        updated_at=datetime.now(timezone.utc),
    )
    tpl.components = [
        GradingTemplateComponent(component_name="Written Work", weight=Decimal(weights[0]), display_order=1),
        GradingTemplateComponent(component_name="Performance Tasks", weight=Decimal(weights[1]), display_order=2),
        GradingTemplateComponent(component_name="Exams", weight=Decimal(weights[2]), display_order=3),
    ]
    return tpl


@pytest.fixture
def db():
    engine = create_engine("sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool)
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


def _seed_baseline(db):
    g7 = AcademicLevel(level_name="Grade 7", grade_level=7)
    g8 = AcademicLevel(level_name="Grade 8", grade_level=8)
    g11 = AcademicLevel(level_name="Grade 11", grade_level=11)
    g12 = AcademicLevel(level_name="Grade 12", grade_level=12)
    db.add_all([g7, g8, g11, g12])

    y1 = AcademicYear(year_label="2026-2027", start_date=date(2026, 9, 1), end_date=date(2027, 6, 30), is_active=True)
    y2 = AcademicYear(year_label="2027-2028", start_date=date(2027, 6, 1), end_date=date(2028, 3, 31), is_active=False)
    db.add_all([y1, y2])
    db.flush()

    p1 = AcademicPeriod(
        academic_year_id=y1.academic_year_id,
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        start_date=date(2026, 9, 1),
        end_date=date(2026, 12, 31),
        is_active=True,
    )
    db.add(p1)

    core = _make_template("Core", "template-1", (20, 50, 30), 85, "Junior High and Senior High School Core Academic subjects")
    specialized = _make_template("Specialized", "template-8", (20, 50, 30), 85, "Senior High School STEM Specialized subjects")
    applied = _make_template("Applied", "template-10", (20, 60, 20), 85, "Senior High School Applied subjects and Work Immersion")
    dup = _make_template("Learning Are", "template-dup", (20, 50, 30), 85, None)
    db.add_all([core, specialized, applied, dup])
    db.flush()

    subjects = {
        "math7": Subject(academic_level_id=g7.academic_level_id, subject_name="Mathematics 7", subject_codename="MATH7", grading_template_id=core.grading_template_id, status="active"),
        "tle8": Subject(academic_level_id=g8.academic_level_id, subject_name="TLE8", subject_codename="TLE8", grading_template_id=core.grading_template_id, status="active"),
        "mapeh8": Subject(academic_level_id=g8.academic_level_id, subject_name="MAPEH 8", subject_codename="MAPEH8", grading_template_id=core.grading_template_id, status="active"),
        "ap8": Subject(academic_level_id=g8.academic_level_id, subject_name="Araling Panlipunan 8", subject_codename="AP8", grading_template_id=core.grading_template_id, status="active"),
        "valed8": Subject(academic_level_id=g8.academic_level_id, subject_name="Values Education 8", subject_codename="VALED8", grading_template_id=core.grading_template_id, status="active"),
        "genbio1": Subject(academic_level_id=g11.academic_level_id, subject_name="General Biology 1", subject_codename="GENBIO1", grading_template_id=specialized.grading_template_id, status="active"),
        "wi12": Subject(academic_level_id=g12.academic_level_id, subject_name="Work Immersion", subject_codename="WI12", grading_template_id=applied.grading_template_id, status="active"),
    }
    db.add_all(subjects.values())
    db.flush()

    # Erroneous year overrides for AP8 -> Applied
    db.add_all([
        SubjectYearGradingTemplate(subject_id=subjects["ap8"].subject_id, academic_year_id=y1.academic_year_id, grading_template_id=applied.grading_template_id),
        SubjectYearGradingTemplate(subject_id=subjects["ap8"].subject_id, academic_year_id=y2.academic_year_id, grading_template_id=applied.grading_template_id),
    ])
    db.commit()
    return {
        "levels": {"g7": g7, "g8": g8, "g11": g11, "g12": g12},
        "years": {"y1": y1, "y2": y2},
        "period": p1,
        "templates": {"core": core, "specialized": specialized, "applied": applied, "dup": dup},
        "subjects": subjects,
    }


def test_aligns_jhs_templates_and_is_idempotent(db):
    mig = _load_migration()
    seeded = _seed_baseline(db)

    mig.apply_client_grading_templates(db.connection())
    db.commit()

    # Run a second time to verify idempotency
    mig.apply_client_grading_templates(db.connection())
    db.commit()
    db.expire_all()

    listed = list_grading_templates_data(db)
    by_name = {t["template_name"]: t for t in listed["grading_templates"]}
    assert set(by_name.keys()) == {"Applied", "Core", "EPP / TLE & MAPEH", "Specialized"}
    assert "Learning Are" not in by_name

    epp = by_name["EPP / TLE & MAPEH"]
    assert epp["passing_threshold"] == 85.0
    assert epp["assigned_subject_count"] == 2
    assert {s["subject_codename"] for s in epp["assigned_subjects"]} == {"TLE8", "MAPEH8"}
    assert {(c["component_name"], float(c["weight"])) for c in epp["components"]} == {
        ("Written Work", 20.0),
        ("Performance Tasks", 60.0),
        ("Exams", 20.0),
    }

    applied = by_name["Applied"]
    assert applied["assigned_subject_count"] == 1
    assert [s["subject_codename"] for s in applied["assigned_subjects"]] == ["WI12"]
    assert applied["is_locked"] is False

    # Verify weight resolution across years
    y1_id = seeded["years"]["y1"].academic_year_id
    y2_id = seeded["years"]["y2"].academic_year_id
    for key in ("math7", "ap8", "valed8", "genbio1"):
        sid = seeded["subjects"][key].subject_id
        for yid in (y1_id, y2_id):
            w = resolve_subject_grading_weights(db, sid, academic_year_id=yid)
            assert (w.ww_weight, w.pt_weight, w.qa_weight) == (0.2, 0.5, 0.3)

    for key in ("tle8", "mapeh8", "wi12"):
        sid = seeded["subjects"][key].subject_id
        for yid in (y1_id, y2_id):
            w = resolve_subject_grading_weights(db, sid, academic_year_id=yid)
            assert (w.ww_weight, w.pt_weight, w.qa_weight) == (0.2, 0.6, 0.2)

    # Verify passing threshold stays 85% across all subjects
    all_subject_ids = [s.subject_id for s in seeded["subjects"].values()]
    ctx = read_passing_threshold_context_or_422(db, academic_year_id=y1_id, subject_ids=all_subject_ids)
    for sid in all_subject_ids:
        res = require_subject_passing_threshold(db, academic_year_id=y1_id, subject_id=sid, context=ctx)
        assert res.threshold == Decimal("85.00")


def test_reassigns_equivalent_duplicate_subject_and_preserves_historical_refs(db):
    mig = _load_migration()
    seeded = _seed_baseline(db)

    # Assign a subject to the duplicate template (identical 20/50/30 & 85% to Core)
    g8 = seeded["levels"]["g8"]
    dup = seeded["templates"]["dup"]
    enmath9 = Subject(
        academic_level_id=g8.academic_level_id,
        subject_name="Enhanced Mathematics 9",
        subject_codename="ENMATH9",
        grading_template_id=dup.grading_template_id,
        status="active",
    )
    db.add(enmath9)

    # Add a finalized period grade for TLE8 (referencing Core) so TLE8 MUST NOT change template
    student = Student(student_id=uuid.uuid4(), first_name="Test", last_name="Learner", student_lrn="123456789012")
    cls = Class(
        academic_year_id=seeded["years"]["y1"].academic_year_id,
        academic_level_id=g8.academic_level_id,
        section_name="Section A",
    )
    db.add_all([student, cls])
    db.flush()

    spg = StudentPeriodGrade(
        student_id=student.student_id,
        class_id=cls.class_id,
        subject_id=seeded["subjects"]["tle8"].subject_id,
        academic_period_id=seeded["period"].academic_period_id,
        initial_grade=Decimal("88.00"),
        transmuted_grade=Decimal("92.00"),
        final_period_grade=Decimal("92.00"),
        is_finalized=True,
    )
    db.add(spg)
    db.commit()

    core_id = seeded["templates"]["core"].grading_template_id
    dup_id = dup.grading_template_id
    tle8_id = seeded["subjects"]["tle8"].subject_id
    mapeh8_id = seeded["subjects"]["mapeh8"].subject_id
    enmath9_id = enmath9.subject_id

    mig.apply_client_grading_templates(db.connection())
    db.commit()
    db.expunge_all()

    # Subject on equivalent duplicate is consolidated into Core and duplicate is deleted
    assert db.get(Subject, enmath9_id).grading_template_id == core_id
    assert db.get(GradingTemplate, dup_id) is None

    # TLE8 with a recorded period grade MUST keep its original template and grade unchanged
    tle8 = db.get(Subject, tle8_id)
    assert tle8.grading_template_id == core_id
    saved_spg = db.query(StudentPeriodGrade).filter_by(subject_id=tle8_id).one()
    assert saved_spg.final_period_grade == Decimal("92.00")

    # MAPEH 8 without recorded grades IS updated to EPP / TLE & MAPEH
    mapeh8 = db.get(Subject, mapeh8_id)
    assert mapeh8.grading_template.template_name == "EPP / TLE & MAPEH"


def test_never_deletes_duplicate_referenced_by_historical_period_grade(db):
    mig = _load_migration()
    seeded = _seed_baseline(db)

    g8 = seeded["levels"]["g8"]
    dup = seeded["templates"]["dup"]
    student = Student(student_id=uuid.uuid4(), first_name="Hist", last_name="Learner", student_lrn="987654321098")
    cls = Class(
        academic_year_id=seeded["years"]["y1"].academic_year_id,
        academic_level_id=g8.academic_level_id,
        section_name="Section H",
    )
    db.add_all([student, cls])
    db.flush()

    db.add(
        StudentPeriodGrade(
            student_id=student.student_id,
            class_id=cls.class_id,
            subject_id=seeded["subjects"]["math7"].subject_id,
            academic_period_id=seeded["period"].academic_period_id,
            initial_grade=Decimal("85.00"),
            transmuted_grade=Decimal("90.00"),
            final_period_grade=Decimal("90.00"),
            is_finalized=True,
            applied_grading_template_id=dup.grading_template_id,
            written_work_weight=Decimal("20.00"),
            performance_task_weight=Decimal("50.00"),
            examination_weight=Decimal("30.00"),
        )
    )
    db.commit()

    mig.apply_client_grading_templates(db.connection())
    db.commit()
    db.expire_all()

    # Duplicate referenced by historical student_period_grade MUST NOT be deleted
    assert db.get(GradingTemplate, dup.grading_template_id) is not None


def test_preserves_evidenced_subject_year_override(db):
    mig = _load_migration()
    seeded = _seed_baseline(db)

    # Record a classwork assignment for AP8 in y1 (2026-2027), leaving y2 (2027-2028) clean
    staff = AcademicStaff(staff_id="2026-9999", first_name="Jane", last_name="Teacher")
    cls = Class(
        academic_year_id=seeded["years"]["y1"].academic_year_id,
        academic_level_id=seeded["levels"]["g8"].academic_level_id,
        section_name="Section B",
    )
    db.add_all([staff, cls])
    db.flush()

    cw = Classwork(
        subject_id=seeded["subjects"]["ap8"].subject_id,
        created_by_staff_id=staff.staff_id,
        title="AP Quiz 1",
        classwork_type="QUIZ",
        classwork_category="WRITTEN_WORK",
        total_points=20,
    )
    db.add(cw)
    db.flush()
    db.add(
        ClassworkAssignment(
            classwork_id=cw.classwork_id,
            class_id=cls.class_id,
            academic_period_id=seeded["period"].academic_period_id,
            assigned_by_staff_id=staff.staff_id,
        )
    )
    db.commit()

    mig.apply_client_grading_templates(db.connection())
    db.commit()
    db.expire_all()

    remaining = db.query(SubjectYearGradingTemplate).filter_by(
        subject_id=seeded["subjects"]["ap8"].subject_id
    ).all()
    # y1 override preserved because classwork exists; y2 override removed
    assert [r.academic_year_id for r in remaining] == [seeded["years"]["y1"].academic_year_id]

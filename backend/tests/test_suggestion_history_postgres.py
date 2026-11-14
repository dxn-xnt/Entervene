"""Live parity check for disposable PostgreSQL suggestion history only.

Set SUGGESTION_TEST_PG_URL to a newly created localhost database named
test_suggestion_history_<32 hex digits>. This test never accepts application DBs.
"""

from datetime import date
import os
import uuid

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

import app.models  # noqa: F401
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.OfficialSection import OfficialSection
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.suggestion.StudentSuggestion import StudentSuggestion
from app.schemas.Suggestion import ManualSuggestionCreate
from app.services.suggestion.SuggestionService import (
    create_manual_suggestion, dismiss_teacher_suggestion, list_student_suggestions,
    list_teacher_suggestions,
)
from app.services.classes.OfficialSectionService import delete_official_section


def _guarded_url():
    raw = os.getenv("SUGGESTION_TEST_PG_URL")
    if not raw:
        pytest.skip("SUGGESTION_TEST_PG_URL is unset")
    try:
        url = make_url(raw)
    except Exception:
        pytest.skip("Suggestion PostgreSQL target validation failed")
    db_name = url.database or ""
    prefix = "test_suggestion_history_"
    suffix = db_name.removeprefix(prefix)
    if (
        not url.drivername.startswith("postgresql")
        or url.host not in {"127.0.0.1", "localhost"}
        or not url.port
        or not db_name.startswith(prefix)
        or len(suffix) != 32
        or any(char not in "0123456789abcdef" for char in suffix.lower())
    ):
        pytest.skip("Suggestion PostgreSQL target validation failed")
    return url


def test_suggestion_history_and_write_scope_on_disposable_postgres():
    url = _guarded_url()
    engine = create_engine(url)
    try:
        with engine.connect() as connection:
            assert connection.scalar(text("select current_database()")) == url.database
            assert int(connection.scalar(text("show server_version_num"))) >= 170000
            assert connection.scalar(text("select count(*) from alembic_version")) == 1
        db = sessionmaker(bind=engine)()
        try:
            token = uuid.uuid4().hex[:8]
            year = AcademicYear(year_label=f"SUG-{token}", start_date=date(2025, 6, 1),
                                end_date=date(2026, 3, 31), is_active=True)
            level = AcademicLevel(level_name=f"Level-{token}", grade_level=7)
            db.add_all([year, level])
            db.flush()
            first = AcademicPeriod(period_name="Q1", period_type="QUARTER", period_sequence=1,
                                   start_date=date(2025, 6, 1), end_date=date(2025, 8, 31),
                                   academic_year_id=year.academic_year_id, is_active=True)
            second = AcademicPeriod(period_name="Q2", period_type="QUARTER", period_sequence=2,
                                    start_date=date(2025, 9, 1), end_date=date(2025, 11, 30),
                                    academic_year_id=year.academic_year_id, is_active=False)
            subject = Subject(subject_name=f"Reading-{token}", academic_level_id=level.academic_level_id)
            db.add_all([first, second, subject])
            db.flush()
            class_ = Class(section_name=f"Section-{token}", academic_year_id=year.academic_year_id,
                           academic_level_id=level.academic_level_id,
                           period_template_group="JHS_45MIN")
            owner = AcademicStaff(staff_id=f"SUG-O-{token}", first_name="Origin", last_name="Teacher")
            successor = AcademicStaff(staff_id=f"SUG-S-{token}", first_name="Next", last_name="Teacher")
            student = Student(student_id=uuid.uuid4(), student_lrn=f"{int(token, 16):012d}",
                              first_name="Test", last_name="Learner", academic_level_id=level.academic_level_id)
            db.add_all([class_, owner, successor, student])
            db.flush()
            db.add_all([
                StudentClass(student_id=student.student_id, class_id=class_.class_id,
                             academic_year_id=year.academic_year_id, enrollment_status="enrolled"),
                SubjectLoad(staff_id=owner.staff_id, subject_id=subject.subject_id,
                            class_id=class_.class_id, academic_period_id=first.academic_period_id,
                            status="active"),
                SubjectLoad(staff_id=successor.staff_id, subject_id=subject.subject_id,
                            class_id=class_.class_id, academic_period_id=second.academic_period_id,
                            status="active"),
            ])
            db.commit()
            made = create_manual_suggestion(db, owner.staff_id, ManualSuggestionCreate(
                student_id=student.student_id, subject_id=subject.subject_id, resource_type="LINK",
                title="Read this", external_url="https://example.org/reading",
            ))
            assert made.origin_class_id == class_.class_id
            assert made.origin_academic_period_id == first.academic_period_id
            first.is_active = False
            second.is_active = True
            db.commit()
            history = list_teacher_suggestions(db, successor.staff_id, class_id=class_.class_id,
                                                student_id=student.student_id)
            assert len(history.suggestions) == 1
            assert history.suggestions[0].is_historical is True
            assert history.suggestions[0].can_manage is False
            for actor in (owner.staff_id, successor.staff_id):
                with pytest.raises(HTTPException) as denied:
                    dismiss_teacher_suggestion(db, actor, made.student_suggestion_id)
                assert denied.value.status_code == 403
            own = list_student_suggestions(db, student)
            assert [item.student_suggestion_id for item in own.suggestions] == [made.student_suggestion_id]

            # A LINK suggestion alone must protect its originating class, even
            # after teaching loads and enrollments are removed. The database FK
            # is the last line of defense; the admin service should archive.
            db.query(StudentClass).filter(StudentClass.class_id == class_.class_id).delete(synchronize_session=False)
            db.query(SubjectLoad).filter(SubjectLoad.class_id == class_.class_id).delete(synchronize_session=False)
            section = OfficialSection(
                academic_year_id=year.academic_year_id,
                academic_level_id=level.academic_level_id,
                section_name=class_.section_name,
                normalized_name=class_.section_name.casefold(),
            )
            empty_section = OfficialSection(
                academic_year_id=year.academic_year_id,
                academic_level_id=level.academic_level_id,
                section_name=f"Unused-{token}", normalized_name=f"unused-{token}",
            )
            db.add_all([section, empty_section])
            db.commit()

            with pytest.raises(IntegrityError) as restricted:
                with db.begin_nested():
                    db.execute(text('DELETE FROM "class" WHERE class_id = :class_id'),
                               {"class_id": class_.class_id})
            assert restricted.value.orig.diag.constraint_name == "fk_student_suggestion_origin_class"

            archived = delete_official_section(db, section.id)
            assert archived["action"] == "archived"
            db.refresh(class_)
            db.refresh(section)
            assert class_.class_status == "archived" and section.is_active is False
            preserved = db.get(StudentSuggestion, made.student_suggestion_id)
            assert preserved.origin_class_id == class_.class_id
            assert preserved.origin_academic_period_id == first.academic_period_id
            assert preserved.created_by_staff_id == owner.staff_id
            assert preserved.status == "ACTIVE"

            deleted = delete_official_section(db, empty_section.id)
            assert deleted["action"] == "deleted"
            assert db.get(OfficialSection, empty_section.id) is None
        finally:
            db.close()
    finally:
        engine.dispose()

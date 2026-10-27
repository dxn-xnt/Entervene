"""Disposable PostgreSQL concurrency coverage for Reading review acknowledgments."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timezone
from decimal import Decimal
import os
from pathlib import Path
import subprocess
import sys
from threading import Barrier
from uuid import uuid4

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from app.db.Session import engine as configured_engine
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import (
    DevelopmentCurrentTermPrediction,
)
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationReadingPrerequisite import (
    RemediationReadingPrerequisite,
)
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionReadingReview import (
    InterventionReadingReview,
)
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.intervention.InterventionReadingReviewService import (
    acknowledge_intervention_reading_review,
)


BACKEND_DIR = Path(__file__).resolve().parents[1]


def test_concurrent_acknowledgments_are_idempotent_on_disposable_postgres():
    if os.getenv("RUN_POSTGRES_READING_REVIEW_TEST") != "1":
        pytest.skip("Set RUN_POSTGRES_READING_REVIEW_TEST=1 to run this test")

    source = configured_engine.url
    if source.get_backend_name() != "postgresql" or source.host not in {
        "localhost",
        "127.0.0.1",
    }:
        pytest.skip("A local PostgreSQL source connection is required")

    database_name = "entervene_test_reading_review_" + uuid4().hex
    admin = create_engine(source.set(database="postgres"), isolation_level="AUTOCOMMIT")
    target = None
    created = False
    try:
        with admin.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{database_name}"'))
            created = True
        target_url = source.set(database=database_name)
        environment = dict(os.environ)
        environment["DATABASE_URL"] = target_url.render_as_string(hide_password=False)
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=BACKEND_DIR,
            env=environment,
            check=True,
            capture_output=True,
            text=True,
        )
        target = create_engine(target_url, pool_pre_ping=True)

        student_id = uuid4()
        with Session(target) as db:
            year = AcademicYear(
                year_label="2098-2099",
                start_date=date(2098, 6, 1),
                end_date=date(2099, 3, 31),
                is_active=True,
            )
            level = AcademicLevel(level_name="Disposable Grade 9", grade_level=9)
            teacher = AcademicStaff(
                staff_id="PG-REVIEW",
                first_name="Postgres",
                last_name="Teacher",
            )
            student = Student(
                student_id=student_id,
                student_lrn="399999999998",
                first_name="Concurrent",
                last_name="Learner",
            )
            db.add_all([year, level, teacher, student])
            db.flush()
            student.academic_level_id = level.academic_level_id
            period = AcademicPeriod(
                period_name="Disposable Term",
                period_type="TERM",
                period_sequence=1,
                total_periods_in_year=3,
                period_progress_ratio=Decimal("0.3333"),
                start_date=date(2098, 6, 1),
                end_date=date(2098, 8, 31),
                is_active=True,
                academic_year_id=year.academic_year_id,
            )
            class_ = Class(
                section_name="Disposable Section",
                academic_year_id=year.academic_year_id,
                academic_level_id=level.academic_level_id,
                period_template_group="AM",
            )
            subject = Subject(
                subject_name="Disposable Mathematics",
                subject_codename="DISPOSABLE-MATH",
                academic_level_id=level.academic_level_id,
                grading_template_id=1,
                is_core=True,
            )
            model = AIModelVersion(
                model_name="disposable-review-model",
                model_type="REGRESSOR",
                model_purpose="CURRENT_TERM_FINAL_GRADE_PROJECTION",
                algorithm="fixture",
                lifecycle_status="DEVELOPMENT",
                is_active=False,
            )
            db.add_all([period, class_, subject, model])
            db.flush()
            class_.academic_period_id = period.academic_period_id
            db.add(StudentClass(
                student_id=student_id,
                class_id=class_.class_id,
                academic_year_id=year.academic_year_id,
                enrollment_status="enrolled",
            ))
            prediction = DevelopmentCurrentTermPrediction(
                student_id=student_id,
                class_id=class_.class_id,
                subject_id=subject.subject_id,
                source_period_id=period.academic_period_id,
                target_period_id=period.academic_period_id,
                model_version_id=model.model_version_id,
                revision=1,
                predicted_period_grade=Decimal("80"),
                intervention_level="MODERATE_RISK",
                intervention_basis="DISPOSABLE_TEST",
                risk_score=None,
                evidence_snapshot={},
            )
            db.add(prediction)
            db.flush()
            intervention = Intervention(
                student_id=student_id,
                class_id=class_.class_id,
                subject_id=subject.subject_id,
                academic_period_id=period.academic_period_id,
                source_prediction_id=prediction.prediction_id,
                status="ACTIVE",
                diagnosis_snapshot={},
                activated_at=datetime.now(timezone.utc),
                activated_by_staff_id=teacher.staff_id,
            )
            reading = Classwork(
                title="Disposable Reading",
                classwork_type="READING",
                is_graded=False,
                total_points=None,
                is_published=True,
                subject_id=subject.subject_id,
                created_by_staff_id=teacher.staff_id,
            )
            remediation = Classwork(
                title="Disposable Remediation",
                classwork_type="ASSIGNMENT",
                is_graded=True,
                total_points=Decimal("10"),
                is_published=True,
                subject_id=subject.subject_id,
                created_by_staff_id=teacher.staff_id,
            )
            db.add_all([intervention, reading, remediation])
            db.flush()
            reading_assignment = ClassworkAssignment(
                classwork_id=reading.classwork_id,
                class_id=class_.class_id,
                academic_period_id=period.academic_period_id,
                assigned_by_staff_id=teacher.staff_id,
                is_published=True,
            )
            remediation_assignment = ClassworkAssignment(
                classwork_id=remediation.classwork_id,
                class_id=class_.class_id,
                academic_period_id=period.academic_period_id,
                assigned_by_staff_id=teacher.staff_id,
                recipient_student_id=student_id,
                source_intervention_id=intervention.intervention_id,
                remediation_request_id=uuid4(),
                is_published=True,
            )
            db.add_all([reading_assignment, remediation_assignment])
            db.flush()
            db.add(RemediationReadingPrerequisite(
                remediation_assignment_id=remediation_assignment.classwork_assignment_id,
                reading_classwork_id=reading.classwork_id,
                reading_assignment_id=reading_assignment.classwork_assignment_id,
                display_order=1,
            ))
            db.commit()
            intervention_id = intervention.intervention_id
            reading_assignment_id = reading_assignment.classwork_assignment_id

        workers = 6
        barrier = Barrier(workers)

        def acknowledge() -> int:
            with Session(target) as db:
                student = db.get(Student, student_id)
                barrier.wait()
                return acknowledge_intervention_reading_review(
                    db,
                    intervention_id=intervention_id,
                    reading_assignment_id=reading_assignment_id,
                    student=student,
                ).review_id

        with ThreadPoolExecutor(max_workers=workers) as executor:
            review_ids = list(executor.map(lambda _: acknowledge(), range(workers)))

        assert len(set(review_ids)) == 1
        with Session(target) as db:
            assert db.query(InterventionReadingReview).count() == 1
            assert db.query(RemediationReadingPrerequisite).count() == 1
        inspector = inspect(target)
        assert "intervention_reading_review" in inspector.get_table_names()
        assert ScriptDirectory.from_config(
            Config(str(BACKEND_DIR / "alembic.ini"))
        ).get_current_head() == "20261027_reading_review"
    finally:
        if target is not None:
            target.dispose()
        if created:
            with admin.connect() as connection:
                connection.execute(
                    text(f'DROP DATABASE IF EXISTS "{database_name}" WITH (FORCE)')
                )
        admin.dispose()

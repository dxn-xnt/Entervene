"""Verify that a completely empty local PostgreSQL database reaches Alembic head.

Run with RUN_POSTGRES_MIGRATION_BOOTSTRAP_TEST=1. This test creates and drops
its own database; it never migrates the configured source database.
"""

import os
from pathlib import Path
import subprocess
import sys
from uuid import uuid4
from datetime import date

import pytest
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from app.db.Session import engine as configured_engine
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.classwork.RemediationReadingPrerequisite import RemediationReadingPrerequisite
from app.services.AcademicPeriodService import create_or_update_academic_periods


BACKEND_DIR = Path(__file__).resolve().parents[1]


def test_empty_postgres_database_upgrades_to_head():
    if os.getenv("RUN_POSTGRES_MIGRATION_BOOTSTRAP_TEST") != "1":
        pytest.skip("Set RUN_POSTGRES_MIGRATION_BOOTSTRAP_TEST=1 to run the disposable PostgreSQL bootstrap test")

    source = configured_engine.url
    if source.get_backend_name() != "postgresql" or source.host not in {"localhost", "127.0.0.1"}:
        pytest.skip("A local PostgreSQL source connection is required")

    name = "entervene_test_bootstrap_" + uuid4().hex
    admin = create_engine(source.set(database="postgres"), isolation_level="AUTOCOMMIT")
    target = None
    created = False
    try:
        with admin.connect() as connection:
            connection.execute(text(f'CREATE DATABASE "{name}"'))
            created = True
        print(f"Disposable PostgreSQL migration database: {name}")

        target_url = source.set(database=name)
        target = create_engine(target_url)
        assert inspect(target).get_table_names() == []

        environment = dict(os.environ)
        environment["DATABASE_URL"] = target_url.render_as_string(hide_password=False)
        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=BACKEND_DIR, env=environment, check=True, capture_output=True, text=True,
        )

        inspector = inspect(target)
        head = ScriptDirectory.from_config(Config(str(BACKEND_DIR / "alembic.ini"))).get_current_head()
        assert head is not None
        assert {
            "user_account", "user_roles", "student", "academic_staff", "classwork",
            "classwork_assignment", "student_submission", "ai_model_version",
            "development_current_term_prediction", "intervention", "intervention_support_material",
            "remediation_assignment_link", "remediation_reading_prerequisite",
        } <= set(inspector.get_table_names())
        def references(table):
            return {
                (tuple(foreign_key["constrained_columns"]), foreign_key["referred_table"])
                for foreign_key in inspector.get_foreign_keys(table)
            }

        assert {(("user_id",), "user_account"), (("role_id",), "role")} <= references("user_roles")
        assert (("user_id",), "user_account") in references("student")
        assert (("user_id",), "user_account") in references("academic_staff")
        assert (("classwork_assignment_id",), "classwork_assignment") in references("student_submission")
        assert (("grading_template_id",), "grading_template") in references("subject")
        assert "subject_groups" not in inspector.get_table_names()
        with target.connect() as connection:
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == head
            assert connection.execute(text("SELECT count(*) FROM user_account")).scalar_one() == 0
            assert connection.execute(text("SELECT template_name FROM grading_template ORDER BY template_name")).scalars().all() == ["Applied", "Core", "Specialized"]
        assert "original_exam_assignment_id" in {column["name"] for column in inspector.get_columns("classwork_assignment")}
        assert {"fk_remedial_original_exam", "ck_remedial_exam_has_target"} <= {
            constraint["name"] for constraint in inspector.get_foreign_keys("classwork_assignment") + inspector.get_check_constraints("classwork_assignment")
        }
        assert "ix_remedial_original_exam" in {index["name"] for index in inspector.get_indexes("classwork_assignment")}
        assert {
            (("remediation_assignment_id",), "classwork_assignment"),
            (("original_assignment_id",), "classwork_assignment"),
            (("source_intervention_id",), "intervention"),
            (("student_id",), "student"),
            (("created_by_staff_id",), "academic_staff"),
        } <= references("remediation_assignment_link")
        link_columns = {column["name"]: column for column in inspector.get_columns("remediation_assignment_link")}
        assert set(link_columns) == {
            "remediation_link_id", "source_intervention_id", "remediation_assignment_id",
            "original_assignment_id", "student_id", "component", "score_adjustment_cap",
            "created_by_staff_id", "created_at",
        }
        assert link_columns["score_adjustment_cap"]["nullable"] is False
        assert "75" in str(link_columns["score_adjustment_cap"]["default"])
        link_unique = {constraint["name"] for constraint in inspector.get_unique_constraints("remediation_assignment_link")}
        assert {"uq_remediation_link_attempt", "uq_remediation_link_original_student"} <= link_unique
        link_checks = {constraint["name"] for constraint in inspector.get_check_constraints("remediation_assignment_link")}
        assert {
            "ck_remediation_link_distinct_assignments",
            "ck_remediation_link_component",
            "ck_remediation_link_cap_range",
        } <= link_checks
        link_indexes = {index["name"] for index in inspector.get_indexes("remediation_assignment_link")}
        assert {"ix_remediation_link_original", "ix_remediation_link_intervention"} <= link_indexes
        model_constraints = {
            constraint.name for constraint in RemediationAssignmentLink.__table__.constraints
            if constraint.name
        }
        assert link_unique | link_checks <= model_constraints
        assert {index.name for index in RemediationAssignmentLink.__table__.indexes} <= link_indexes
        prerequisite_columns = {
            column["name"]: column
            for column in inspector.get_columns("remediation_reading_prerequisite")
        }
        assert set(prerequisite_columns) == {
            "prerequisite_id", "remediation_assignment_id", "reading_classwork_id",
            "reading_assignment_id", "display_order", "created_at",
        }
        assert all(column["nullable"] is False for column in prerequisite_columns.values())
        assert {
            (("remediation_assignment_id",), "classwork_assignment"),
            (("reading_classwork_id",), "classwork"),
            (("reading_assignment_id",), "classwork_assignment"),
        } <= references("remediation_reading_prerequisite")
        prerequisite_unique = {
            constraint["name"]
            for constraint in inspector.get_unique_constraints("remediation_reading_prerequisite")
        }
        assert {
            "uq_remediation_reading_prerequisite_order",
            "uq_remediation_reading_prerequisite_reading",
        } <= prerequisite_unique
        prerequisite_checks = {
            constraint["name"]
            for constraint in inspector.get_check_constraints("remediation_reading_prerequisite")
        }
        assert "ck_remediation_reading_prerequisite_order_positive" in prerequisite_checks
        prerequisite_indexes = {
            index["name"]
            for index in inspector.get_indexes("remediation_reading_prerequisite")
        }
        assert {
            "ix_remediation_reading_prerequisite_remediation",
            "ix_remediation_reading_prerequisite_reading_assignment",
        } <= prerequisite_indexes
        prerequisite_model_constraints = {
            constraint.name
            for constraint in RemediationReadingPrerequisite.__table__.constraints
            if constraint.name
        }
        assert prerequisite_unique | prerequisite_checks <= prerequisite_model_constraints
        assert {
            index.name for index in RemediationReadingPrerequisite.__table__.indexes
        } <= prerequisite_indexes
        updated_at = next(column for column in inspector.get_columns("academic_period") if column["name"] == "updated_at")
        assert updated_at["nullable"] is False
        assert updated_at["default"] is None

        with Session(target) as db:
            year = AcademicYear(year_label="2027-2028", start_date=date(2027, 6, 1), end_date=date(2028, 3, 31))
            db.add(year)
            db.commit()
            periods = create_or_update_academic_periods(db, year.academic_year_id, "TERM", [{
                "period_sequence": 1, "start_date": date(2027, 6, 1), "end_date": date(2027, 9, 30),
            }])
            period = periods[0]
            assert period.created_at is not None and period.updated_at is not None
            initial_created_at, initial_updated_at = period.created_at, period.updated_at
            periods = create_or_update_academic_periods(db, year.academic_year_id, "TERM", [{
                "period_sequence": 1, "start_date": date(2027, 6, 1), "end_date": date(2027, 10, 1),
            }])
            assert periods[0].academic_period_id == period.academic_period_id
            assert periods[0].created_at == initial_created_at
            assert periods[0].updated_at > initial_updated_at
            assert periods[0].end_date == date(2027, 10, 1)
            db.refresh(period)
            assert period.updated_at is not None

        subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "20261026_remediation_link"],
            cwd=BACKEND_DIR, env=environment, check=True, capture_output=True, text=True,
        )
        assert "remediation_reading_prerequisite" not in inspect(target).get_table_names()
        assert "remediation_assignment_link" in inspect(target).get_table_names()
        with target.connect() as connection:
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "20261026_remediation_link"

        subprocess.run(
            [sys.executable, "-m", "alembic", "downgrade", "20261022_passing_policy_audit"],
            cwd=BACKEND_DIR, env=environment, check=True, capture_output=True, text=True,
        )
        assert "remediation_assignment_link" not in inspect(target).get_table_names()
        with target.connect() as connection:
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == "20261022_passing_policy_audit"

        subprocess.run(
            [sys.executable, "-m", "alembic", "upgrade", "head"],
            cwd=BACKEND_DIR, env=environment, check=True, capture_output=True, text=True,
        )
        assert "remediation_assignment_link" in inspect(target).get_table_names()
        assert "remediation_reading_prerequisite" in inspect(target).get_table_names()
        with target.connect() as connection:
            assert connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one() == head

    finally:
        if target is not None:
            target.dispose()
        if created:
            with admin.connect() as connection:
                connection.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()

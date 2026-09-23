from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.attendance.Attendance import AttendanceRecord
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.prediction.CurrentPeriodFeatureBuilderService import build_current_period_features_from_records
from scripts.seed_current_term_demo import DEMO_DATABASE, read_summary, require_demo_database, seed


DEMO_URL = os.getenv("DEMO_DATABASE_URL")


def test_demo_guard_accepts_only_exact_postgresql_demo_name():
    assert require_demo_database("postgresql://user@localhost/Entervene_Demo").database == DEMO_DATABASE
    with pytest.raises(ValueError, match="only 'Entervene_Demo'"):
        require_demo_database("postgresql://user@localhost/Entervene")
    with pytest.raises(ValueError, match="requires PostgreSQL"):
        require_demo_database("sqlite:///Entervene_Demo")


@pytest.fixture(scope="module")
def demo_engine():
    if not DEMO_URL:
        pytest.skip("Set DEMO_DATABASE_URL to run isolated demo database tests.")
    require_demo_database(DEMO_URL)
    engine = create_engine(DEMO_URL)
    yield engine
    engine.dispose()


def test_demo_seed_is_idempotent_and_relationships_are_complete(demo_engine):
    before = read_summary(DEMO_URL)
    repeated = seed(DEMO_URL)
    assert repeated == before
    with Session(demo_engine) as session:
        assert session.scalar(select(func.count()).select_from(Student)) == 10
        assert session.scalar(select(func.count()).select_from(StudentClass)) == 10
        assert session.scalar(select(func.count()).select_from(SubjectLoad)) == 1
        load = session.scalar(select(SubjectLoad))
        assert load.staff_id == "DEMO-T-001"
        assert load.status == "published"
        assert load.is_active_version is True


def test_supported_subject_weights_and_real_academic_evidence_exist(demo_engine):
    with Session(demo_engine) as session:
        subject = session.scalar(select(Subject))
        weights = session.scalars(select(GradingTemplateComponent).order_by(GradingTemplateComponent.display_order)).all()
        assert subject.subject_codename == "MATHEMATICS"
        assert [float(component.weight) for component in weights] == [20.0, 50.0, 30.0]
        assert session.scalar(select(func.count()).select_from(Classwork)) == 10
        assert session.scalar(select(func.count()).select_from(ClassworkAssignment)) == 10
        assert session.scalar(select(func.count()).select_from(StudentSubmission)) == 93
        categories = set(session.scalars(select(Classwork.classwork_category)))
        assert {"WRITTEN_WORK", "PERFORMANCE_TASK", "EXAMS"} <= categories


def test_behavioral_records_and_submission_variation_exist(demo_engine):
    with Session(demo_engine) as session:
        assert session.scalar(select(func.count()).select_from(AttendanceRecord)) == 150
        attendance_statuses = set(session.scalars(select(AttendanceRecord.status)))
        submission_statuses = set(session.scalars(select(StudentSubmission.status)))
        assert {"present", "absent", "late"} <= attendance_statuses
        assert {"graded", "late", "submitted"} <= submission_statuses


def test_ready_and_insufficient_students_use_real_feature_builder(demo_engine):
    summary = read_summary(DEMO_URL)
    scope = summary["scope"]
    with Session(demo_engine) as session:
        ready_student = session.scalar(select(Student).where(Student.first_name == "Demo Avery"))
        blocked_student = session.scalar(select(Student).where(Student.first_name == "Demo Jordan"))
        ready = build_current_period_features_from_records(session, ready_student.student_id, scope["class_id"], scope["subject_id"], scope["academic_period_id"])
        blocked = build_current_period_features_from_records(session, blocked_student.student_id, scope["class_id"], scope["subject_id"], scope["academic_period_id"])
        assert ready["ready"] is True
        assert ready["features"]["observed_component_weight_sum"] == 70
        assert ready["features"]["ww_available_activity_count"] == 4
        assert ready["features"]["pt_available_activity_count"] == 3
        assert blocked["ready"] is False
        assert "INSUFFICIENT_AVAILABLE_ACTIVITIES" in blocked["readiness_reason_codes"]
    assert summary["insufficient_evidence"]["prediction_status"] == "INSUFFICIENT_EVIDENCE"
    assert summary["insufficient_evidence"]["persisted"] is False


def test_revision_history_and_development_isolation(demo_engine):
    summary = read_summary(DEMO_URL)
    with Session(demo_engine) as session:
        predictions = session.scalars(select(DevelopmentCurrentTermPrediction).order_by(DevelopmentCurrentTermPrediction.prediction_id)).all()
        revisions = [row for row in predictions if str(row.student_id) == str(session.scalar(select(Student.student_id).where(Student.first_name == "Demo Avery")))]
        assert [row.revision for row in revisions] == [1, 2]
        assert revisions[0].prediction_id != revisions[1].prediction_id
        assert summary["revision_example"]["revision_1"]["projected_final_term_grade"] != summary["revision_example"]["revision_2"]["projected_final_term_grade"]
        assert session.scalar(select(func.count()).select_from(AIPrediction)) == 0
        model = session.scalar(select(AIModelVersion))
        assert model.lifecycle_status == "DEVELOPMENT"
        assert model.production_validated is False
        assert model.independent_three_term_validation is False
        assert model.is_active is False

import os
import sys
import json
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
from app.db.Session import get_db
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Predictions import router as predictions_router
import app.services.prediction.ModelScoringService as model_scoring_service
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AssessmentItem import AssessmentItem
from app.models.academic.Class_ import Class
from app.models.academic.StudentAssessmentScore import StudentAssessmentScore
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.attendance.Attendance import AttendanceRecord
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.AIPredictionFeature import AIPredictionFeature
from app.models.ai.PredictionOutcome import PredictionOutcome
from app.models.ai.RiskThreshold import RiskThreshold
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.submissions.StudentSubmission import StudentSubmission


def run_manual_verification():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    db = Session()

    # Seed Academic context
    year = AcademicYear(year_label="2025-2026", start_date=date(2025, 6, 1), end_date=date(2026, 3, 31), is_active=True)
    level = AcademicLevel(level_name="Grade 8", grade_level=8)
    db.add_all([year, level])
    db.flush()

    staff_user = UserAccount(user_id=uuid.uuid4(), email="teacher@entervene.test", account_status="active")
    db.add(staff_user)
    db.flush()

    staff = AcademicStaff(staff_id="STAFF-001", user_id=staff_user.user_id, first_name="T", last_name="Teacher")
    db.add(staff)
    db.flush()

    q1 = AcademicPeriod(academic_year_id=year.academic_year_id, period_name="1st Term", period_sequence=1, period_type="TERM", total_periods_in_year=3, start_date=date(2025, 6, 1), end_date=date(2025, 9, 30), is_active=False)
    q2 = AcademicPeriod(academic_year_id=year.academic_year_id, period_name="2nd Term", period_sequence=2, period_type="TERM", total_periods_in_year=3, start_date=date(2025, 10, 1), end_date=date(2026, 1, 31), is_active=True)
    db.add_all([q1, q2])
    db.flush()

    cls = Class(section_name="Gold", academic_level_id=level.academic_level_id, academic_year_id=year.academic_year_id)
    subj = Subject(subject_name="Science", subject_codename="SCIENCE", academic_level_id=level.academic_level_id)
    db.add_all([cls, subj])
    db.flush()

    # Student 1: Complete Records (with attendance)
    student1 = Student(student_id=uuid.uuid4(), student_lrn="100000000001", first_name="Complete", last_name="Student", academic_level_id=level.academic_level_id)
    # Student 2: No attendance records, but has classwork
    student2 = Student(student_id=uuid.uuid4(), student_lrn="100000000002", first_name="Partial", last_name="Student", academic_level_id=level.academic_level_id)
    # Student 3: Pure Cold-Start (No attendance, No classwork assignments)
    student3 = Student(student_id=uuid.uuid4(), student_lrn="100000000003", first_name="PureCold", last_name="Student", academic_level_id=level.academic_level_id)
    db.add_all([student1, student2, student3])
    db.flush()

    # Seed AI Model Version
    feature_columns = [
        "grade_level", "period_sequence", "has_previous_period",
        "written_work_percent", "performance_task_percent", "quarterly_assessment_percent",
        "assessment_completion_rate", "source_period_grade",
        "grade_trend_vs_previous_period", "cumulative_period_grade_avg",
        "subject_SCIENCE",
    ]
    model_ver = AIModelVersion(
        model_name="entervene_next_period_grade_rf",
        model_type="REGRESSOR",
        algorithm="RandomForestRegressor",
        feature_schema_json={
            "feature_columns": feature_columns,
            "target_column": "target_next_period_grade",
            "excluded_columns": ["student_id"],
            "column_mappings": {},
            "required_runtime_columns": feature_columns,
        },
        artifact_path="data/models/entervene_next_period_grade_rf.joblib",
        is_active=True,
    )
    db.add(model_ver)
    db.flush()

    # Seed RiskThreshold weights
    now = datetime.now(timezone.utc)
    db.add_all([
        RiskThreshold(threshold_name="Att Weight", condition_type="attendance_weight", condition_value=Decimal("0.40"), risk_level="NEEDS_MONITORING", effective_from=now, is_active=True),
        RiskThreshold(threshold_name="Ontime Weight", condition_type="ontime_weight", condition_value=Decimal("0.35"), risk_level="NEEDS_MONITORING", effective_from=now, is_active=True),
        RiskThreshold(threshold_name="Part Weight", condition_type="participation_weight", condition_value=Decimal("0.25"), risk_level="NEEDS_MONITORING", effective_from=now, is_active=True),
    ])
    db.flush()

    item1 = AssessmentItem(class_id=cls.class_id, subject_id=subj.subject_id, academic_period_id=q2.academic_period_id, component_type="WRITTEN_WORK", item_number=1, max_score=Decimal("50.00"))
    item2 = AssessmentItem(class_id=cls.class_id, subject_id=subj.subject_id, academic_period_id=q2.academic_period_id, component_type="PERFORMANCE_TASK", item_number=1, max_score=Decimal("50.00"))
    item3 = AssessmentItem(class_id=cls.class_id, subject_id=subj.subject_id, academic_period_id=q2.academic_period_id, component_type="QUARTERLY_ASSESSMENT", item_number=1, max_score=Decimal("100.00"))
    db.add_all([item1, item2, item3])
    db.flush()

    # Seed Academic records for Student 1, 2, 3
    for s in [student1, student2, student3]:
        grade_p1 = StudentPeriodGrade(student_id=s.student_id, class_id=cls.class_id, subject_id=subj.subject_id, academic_period_id=q1.academic_period_id, final_period_grade=Decimal("85.00"), is_finalized=True)
        grade_p2 = StudentPeriodGrade(student_id=s.student_id, class_id=cls.class_id, subject_id=subj.subject_id, academic_period_id=q2.academic_period_id, final_period_grade=Decimal("83.00"), is_finalized=True)
        db.add_all([grade_p1, grade_p2])

        score1 = StudentAssessmentScore(assessment_id=item1.assessment_id, student_id=s.student_id, raw_score=Decimal("42.00"), score_status="RECORDED")
        score2 = StudentAssessmentScore(assessment_id=item2.assessment_id, student_id=s.student_id, raw_score=Decimal("40.00"), score_status="RECORDED")
        score3 = StudentAssessmentScore(assessment_id=item3.assessment_id, student_id=s.student_id, raw_score=Decimal("82.00"), score_status="RECORDED")
        db.add_all([score1, score2, score3])

    # Add Attendance Records ONLY for Student 1
    for day in range(1, 11):
        status = "present" if day <= 8 else ("late" if day == 9 else "excused")
        db.add(AttendanceRecord(student_id=student1.student_id, class_id=cls.class_id, subject_id=subj.subject_id, date=date(2025, 9, day), status=status))

    # Add Classwork and Submissions (for student1 and student2)
    cw = Classwork(subject_id=subj.subject_id, title="Science Task 1", classwork_type="ACTIVITY", classwork_category="PERFORMANCE_TASK", created_by_staff_id=staff.staff_id, total_points=Decimal("20.00"), is_graded=True, is_archived=False)
    db.add(cw)
    db.flush()
    assignment = ClassworkAssignment(classwork_id=cw.classwork_id, class_id=cls.class_id, assigned_by_staff_id=staff.staff_id, due_date=now + timedelta(days=2), is_published=True)
    db.add(assignment)
    db.flush()

    sub1 = StudentSubmission(classwork_assignment_id=assignment.classwork_assignment_id, student_id=student1.student_id, status="submitted", submitted_at=now)
    db.add(sub1)
    db.commit()

    # Mock Model Artifact to return a predicted grade of 84.50
    class MockModel:
        def predict(self, frame):
            return [84.50]

    original_load = model_scoring_service.load_model_artifact
    model_scoring_service.load_model_artifact = lambda path, base_dir=None: MockModel()

    # Set up TestClient
    app = FastAPI()
    app.include_router(predictions_router, prefix="/api/v1/predictions")
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: {"user_id": str(staff_user.user_id), "role": "teacher"}

    client = TestClient(app)

    print("\n=======================================================")
    print("SCENARIO 1: Student With Complete Records (Has Attendance)")
    print("=======================================================")
    resp1 = client.post("/api/v1/predictions/from-records/preview", json={
        "student_id": str(student1.student_id),
        "class_id": cls.class_id,
        "subject_id": subj.subject_id,
        "source_period_id": q2.academic_period_id,
    })
    print(f"HTTP Status: {resp1.status_code}")
    print(json.dumps(resp1.json(), indent=2))

    print("\n=======================================================")
    print("SCENARIO 2: Partial Cold-Start (No Attendance, Has Classwork)")
    print("=======================================================")
    resp2 = client.post("/api/v1/predictions/from-records/preview", json={
        "student_id": str(student2.student_id),
        "class_id": cls.class_id,
        "subject_id": subj.subject_id,
        "source_period_id": q2.academic_period_id,
    })
    print(f"HTTP Status: {resp2.status_code}")
    print(json.dumps(resp2.json(), indent=2))

    print("\n=======================================================")
    print("SCENARIO 3: Pure Cold-Start (Zero Attendance, No Classwork Due Dates)")
    print("=======================================================")
    # Unpublish assignment or query a subject with no assignments
    subj_nodue = Subject(subject_name="Math", subject_codename="MATH", academic_level_id=level.academic_level_id)
    db.add(subj_nodue)
    db.flush()
    # Add grades and assessment items for Math so academic readiness is GOOD
    grade_math_p1 = StudentPeriodGrade(student_id=student3.student_id, class_id=cls.class_id, subject_id=subj_nodue.subject_id, academic_period_id=q1.academic_period_id, final_period_grade=Decimal("86.00"), is_finalized=True)
    grade_math_p2 = StudentPeriodGrade(student_id=student3.student_id, class_id=cls.class_id, subject_id=subj_nodue.subject_id, academic_period_id=q2.academic_period_id, final_period_grade=Decimal("84.00"), is_finalized=True)
    db.add_all([grade_math_p1, grade_math_p2])
    m_item1 = AssessmentItem(class_id=cls.class_id, subject_id=subj_nodue.subject_id, academic_period_id=q2.academic_period_id, component_type="WRITTEN_WORK", item_number=1, max_score=Decimal("50.00"))
    m_item2 = AssessmentItem(class_id=cls.class_id, subject_id=subj_nodue.subject_id, academic_period_id=q2.academic_period_id, component_type="PERFORMANCE_TASK", item_number=1, max_score=Decimal("50.00"))
    m_item3 = AssessmentItem(class_id=cls.class_id, subject_id=subj_nodue.subject_id, academic_period_id=q2.academic_period_id, component_type="QUARTERLY_ASSESSMENT", item_number=1, max_score=Decimal("100.00"))
    db.add_all([m_item1, m_item2, m_item3])
    db.flush()
    db.add_all([
        StudentAssessmentScore(assessment_id=m_item1.assessment_id, student_id=student3.student_id, raw_score=Decimal("45.00"), score_status="RECORDED"),
        StudentAssessmentScore(assessment_id=m_item2.assessment_id, student_id=student3.student_id, raw_score=Decimal("45.00"), score_status="RECORDED"),
        StudentAssessmentScore(assessment_id=m_item3.assessment_id, student_id=student3.student_id, raw_score=Decimal("85.00"), score_status="RECORDED"),
    ])
    db.commit()

    resp3 = client.post("/api/v1/predictions/from-records/preview", json={
        "student_id": str(student3.student_id),
        "class_id": cls.class_id,
        "subject_id": subj_nodue.subject_id,
        "source_period_id": q2.academic_period_id,
    })
    print(f"HTTP Status: {resp3.status_code}")
    print(json.dumps(resp3.json(), indent=2))

    model_scoring_service.load_model_artifact = original_load
    db.close()

if __name__ == "__main__":
    run_manual_verification()

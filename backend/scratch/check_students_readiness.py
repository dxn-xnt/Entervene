import os
import sys

sys.path.insert(0, os.path.abspath("backend"))
from dotenv import dotenv_values
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.services.prediction.CurrentPeriodFeatureBuilderService import build_current_period_features_from_records
from app.models.people.Student import Student
from app.models.academic.StudentCLass import StudentClass

demo_env = dotenv_values("backend/.env.demo")
db_url = demo_env.get("DATABASE_URL")
engine = create_engine(db_url)
with Session(engine) as db:
    students = (
        db.query(Student)
        .join(StudentClass, Student.student_id == StudentClass.student_id)
        .filter(StudentClass.class_id == 1, StudentClass.enrollment_status == "enrolled")
        .order_by(Student.last_name)
        .all()
    )
    for s in students:
        feat = build_current_period_features_from_records(db, s.student_id, 1, 1, 1)
        r_status = feat["readiness_status"]
        weight = feat["observed_component_weight_sum"]
        count = feat["eligible_graded_activity_count"]
        warnings = feat["domain_warnings"]
        print(f"{s.first_name:20}: readiness={r_status:15}, weight={weight:.2f}, count={count}, warnings={len(warnings)}")
        if warnings:
            for w in warnings:
                print("   warning:", w)

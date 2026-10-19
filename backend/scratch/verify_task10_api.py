import sys
from dotenv import dotenv_values
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

demo_env = dotenv_values(r"c:\Users\Roy Adrian Rondina\Desktop\3rd Year\2nd Sem\Entervene\Entervene\backend\.env.demo")
engine = create_engine(demo_env.get("DATABASE_URL"))
db = Session(bind=engine)
sys.path.insert(0, r"c:\Users\Roy Adrian Rondina\Desktop\3rd Year\2nd Sem\Entervene\Entervene\backend")

from app.services.prediction import DevelopmentCurrentTermPredictionReadService as read_service
from app.services.student_record.StudentRecordService import teacher_student_gradebook
from app.models.intervention.Intervention import Intervention
from app.models.people.Student import Student

print("=" * 80)
print("1. PREDICTIONS API (LATEST ACTIVE FOR ALL 11 STUDENTS)")
print("=" * 80)

res = read_service.list_latest_development_current_term_predictions(
    db, class_id=1, subject_id=1, academic_period_id=1, model_version_id=2
)
items = res.get("items", [])
print(f"Total returned predictions: {len(items)}")
for p in items:
    print(f"  {p.get('student_name', ''):<24}: Grade={p.get('projected_final_term_grade')} | Risk={p.get('intervention_level')} | Rev={p.get('revision')} | Status={p.get('prediction_status')}")

print("\n" + "=" * 80)
print("2. GRADEBOOK API (11 STUDENTS)")
print("=" * 80)

book = teacher_student_gradebook(db, staff_id="DEMO-T-001", class_id=1, subject_id=1, academic_period_id=1)
for row in book.studentGrades:
    print(f"  {row.name:<24} | WW: {row.ps_written:.1f}% | PT: {row.ps_performance:.1f}% | QA: {row.ps_exams:.1f}% | Initial: {row.initial_grade:.2f} | Transmuted: {row.transmuted_grade}")

print("\n" + "=" * 80)
print("3. INTERVENTION CANDIDATES")
print("=" * 80)

invs = db.query(Intervention).filter_by(class_id=1, subject_id=1, academic_period_id=1).all()
print(f"Total intervention candidates: {len(invs)}")
for inv in invs:
    st = db.get(Student, inv.student_id)
    print(f"  ID {inv.intervention_id}: {st.first_name} {st.last_name} | Status: {inv.status} | SourcePredID: {inv.source_prediction_id}")

db.close()

import sys
import json
from dotenv import dotenv_values
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

demo_env = dotenv_values(r"c:\Users\Roy Adrian Rondina\Desktop\3rd Year\2nd Sem\Entervene\Entervene\backend\.env.demo")
engine = create_engine(demo_env.get("DATABASE_URL"))
db = Session(bind=engine)
sys.path.insert(0, r"c:\Users\Roy Adrian Rondina\Desktop\3rd Year\2nd Sem\Entervene\Entervene\backend")

from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.people.Student import Student

students = {
    "Jordan": db.query(Student).filter(Student.first_name.ilike("%Jordan%")).first(),
    "Morgan": db.query(Student).filter(Student.first_name.ilike("%Morgan%")).first(),
}

comparison = {}

for name, s in students.items():
    p = db.query(DevelopmentCurrentTermPrediction).filter(
        DevelopmentCurrentTermPrediction.student_id == s.student_id,
        DevelopmentCurrentTermPrediction.target_period_id == 1,
    ).first()
    feats = {item["name"]: item["value"] for item in (p.evidence_snapshot or {}).get("model_features", [])}
    comparison[name] = {
        "predicted_grade": float(p.predicted_period_grade),
        "intervention_level": p.intervention_level,
        "readiness": (p.evidence_snapshot or {}).get("readiness"),
        "features": feats,
    }

print("=" * 80)
print(f"{'Feature Name':<35} | {'Jordan':<18} | {'Morgan':<18} | {'Diff (M - J)':<15}")
print("=" * 80)

j_feats = comparison["Jordan"]["features"]
m_feats = comparison["Morgan"]["features"]

for k in sorted(j_feats.keys()):
    jv = j_feats.get(k)
    mv = m_feats.get(k)
    diff = ""
    if isinstance(jv, (int, float)) and isinstance(mv, (int, float)):
        diff = f"{mv - jv:+.4f}"
    print(f"{k:<35} | {str(jv):<18} | {str(mv):<18} | {diff:<15}")

print("\n" + "=" * 80)
print("READINESS & PREDICTION COMPARISON")
print("=" * 80)
for name in ["Jordan", "Morgan"]:
    print(f"{name}:")
    print(f"  Predicted Period Grade: {comparison[name]['predicted_grade']}")
    print(f"  Intervention Level: {comparison[name]['intervention_level']}")
    print(f"  Readiness: {comparison[name]['readiness']}")

db.close()

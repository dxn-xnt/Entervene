import os, sys
os.environ['ENV_FILE'] = 'backend/.env.demo'
sys.path.insert(0, os.path.abspath("backend"))
from dotenv import dotenv_values

from app.db.Session import SessionLocal
from app.models.people.Student import Student
from app.models.academic.StudentCLass import StudentClass
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.intervention.Intervention import Intervention
from app.services.prediction.CurrentPeriodFeatureBuilderService import build_current_period_features_from_records

db = SessionLocal()
try:
    scs = db.query(StudentClass).filter(StudentClass.class_id == 1).all()
    print(f"Total students in Class 1: {len(scs)}\n")
    
    for sc in scs:
        s = db.get(Student, sc.student_id)
        # 1. Live evidence from feature builder
        built = build_current_period_features_from_records(db, s.student_id, 1, 1, 1)
        es = built.get("evidence_summary", {})
        ww = es.get("written_work", {})
        pt = es.get("performance_task", {})
        qa = es.get("examination", {})
        feat = built.get("features", {})
        
        # 2. Historical frozen prediction
        preds = db.query(DevelopmentCurrentTermPrediction).filter_by(
            student_id=s.student_id,
            class_id=1,
            subject_id=1,
            model_version_id=2
        ).order_by(DevelopmentCurrentTermPrediction.revision.desc()).all()
        latest_pred = preds[0] if preds else None
        
        # 3. Interventions
        invs = db.query(Intervention).filter_by(
            student_id=s.student_id,
            class_id=1,
            subject_id=1
        ).order_by(Intervention.intervention_id).all()
        
        print(f"--- Student: {s.first_name} {s.last_name} ({s.student_lrn}) ---")
        print(f"  Live Readiness: {built.get('readiness_level')}, Ready={built.get('ready')}")
        print(f"  Live Activities: WW={ww.get('count')}, PT={pt.get('count')}, QA={qa.get('complete')} (subtypes={qa.get('subtype_percentages')})")
        print(f"  Live Component %: WW={ww.get('performance_percent')}, PT={pt.get('performance_percent')}, Observed Weight={feat.get('observed_component_weight_sum')}%")
        print(f"  Live Overall Performance: {feat.get('overall_partial_percent')}%")
        
        if latest_pred:
            snap = latest_pred.evidence_snapshot or {}
            snap_readiness = snap.get("readiness", {})
            print(f"  Latest Pred (v2): ID={latest_pred.prediction_id}, Rev={latest_pred.revision}, Grade={latest_pred.predicted_period_grade}, Risk={latest_pred.intervention_level}")
            print(f"    Snapshot Readiness: {snap_readiness.get('level')} ({snap_readiness.get('status')})")
        else:
            print("  Latest Pred (v2): None")
            
        if invs:
            for inv in invs:
                diag = inv.diagnosis_snapshot or {}
                weakest = diag.get("weakest_supported_components")
                comps = diag.get("lowest_supported_competencies", [])
                covs = diag.get("manual_assessment_coverage", [])
                evidence_type = "SCORED_COMPETENCY" if comps else "MANUAL_COVERAGE" if covs else "COMPONENT_ONLY"
                print(f"  Intervention ID={inv.intervention_id}: Status={inv.status}, Weakest={weakest}, EvidenceType={evidence_type}, ScoredTargets={len(comps)}, CoverageCount={len(covs)}")
        else:
            print("  Interventions: None")
        print()

finally:
    db.close()

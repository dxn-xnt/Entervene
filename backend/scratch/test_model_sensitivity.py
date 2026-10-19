import os, sys
os.environ['ENV_FILE'] = '.env.demo'
sys.path.insert(0, os.path.abspath('.'))
from app.db.Session import SessionLocal
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME

from app.services.prediction.CurrentTermV3Domain import canonicalize_v3_features

db = SessionLocal()
try:
    scope = {"canonical_subject": "MATHEMATICS", "grade_level": 9}
    def get_score(features_dict):
        canon = canonicalize_v3_features(features_dict, scope)
        return scorer.score_development_current_term(canon, model_name=CORRECTED_MODEL_NAME)

    # Let's test different WW and PT averages for Grade 9 Mathematics (20/50/30 weight pattern)
    # DepEd transmuted grade baseline: 60% raw = 75 transmuted.
    # If a student is struggling/at-risk:
    # Say WW is between 40% and 55%, PT is between 60% and 70%.
    scenarios = [
        # (ww_scores, pt_scores, label)
        ([8, 8], [24, 24], "WW=40.0%, PT=60.0% (Overall 54.3%)"),
        ([9, 9], [25, 25], "WW=45.0%, PT=62.5% (Overall 57.5%)"),
        ([10, 10], [26, 26], "WW=50.0%, PT=65.0% (Overall 60.7%)"),
        ([9, 11], [27, 27], "WW=50.0%, PT=67.5% (Overall 62.5%)"),
        ([11, 11], [28, 28], "WW=55.0%, PT=70.0% (Overall 65.7%)"),
        ([12, 12], [28, 28], "WW=60.0%, PT=70.0% (Overall 67.1%)"),
        ([12, 12], [31, 32], "WW=60.0%, PT=78.75% (Jordan's actual)"),
        ([7, 8], [22, 24], "WW=37.5%, PT=57.5% (Overall 51.8%)"),
        ([6, 8], [20, 22], "WW=35.0%, PT=52.5% (Overall 47.5%)"),
    ]

    for ww, pt, desc in scenarios:
        ww_pct = sum(ww) / (len(ww) * 20.0) * 100.0
        pt_pct = sum(pt) / (len(pt) * 40.0) * 100.0
        
        # Build canonical feature vector like canonicalize_v3_features
        # Subject: MATHEMATICS, Grade 9, 20/50/30
        features = {
            "subject": "MATHEMATICS",
            "grade_level": 9,
            "ww_weight": 20.0,
            "pt_weight": 50.0,
            "qa_weight": 30.0,
            "ww_available_activity_count": len(ww),
            "pt_available_activity_count": len(pt),
            "qa_available_activity_count": 0,
            "ww_percent_so_far": ww_pct,
            "pt_percent_so_far": pt_pct,
            "qa_percent_so_far": 0.0,
            "ww_has_evidence": 1.0,
            "pt_has_evidence": 1.0,
            "qa_has_evidence": 0.0,
            "ww_is_missing": 0.0,
            "pt_is_missing": 0.0,
            "qa_is_missing": 1.0,
            "observed_weight": 70.0,
            "missing_weight": 30.0,
            "academic_level_id": 1,
            "term_number": 1,
            "raw_subject": "MATHEMATICS",
            "over_hps_count": 0,
            # attendance & submissions (realistic for a struggling student, e.g. 80-90% attendance, some missing submissions)
            "attendance_rate": 86.7,
            "submission_rate": 41.7,
            "days_recorded": 15,
            "absent_count": 2,
            "late_count": 2,
            "submitted_count": 4,
            "missing_count": 7,
            "upcoming_count": 1,
            "assigned_count": 12,
        }
        
        pred = get_score(features)
        
        risk = "HIGH_RISK" if pred < 75.0 else "MODERATE_RISK" if pred < 85.0 else "NEEDS_MONITORING" if pred < 90.0 else "LOW_RISK"
        print(f"{desc:45} -> Predicted: {pred:.2f} ({risk})")
finally:
    db.close()

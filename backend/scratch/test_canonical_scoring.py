import os, sys
from uuid import UUID
os.environ['ENV_FILE'] = '.env.demo'
sys.path.insert(0, os.path.abspath('.'))
from app.db.Session import SessionLocal
from app.services.prediction import DevelopmentCurrentTermScoringService as scorer
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction.CurrentPeriodFeatureBuilderService import build_current_period_features_from_records
from app.services.prediction.CurrentTermV3Domain import resolve_v3_scope, canonicalize_v3_features

db = SessionLocal()
try:
    jordan_id = UUID("02361276-31c5-5e69-a622-b7220472edd3")
    built = build_current_period_features_from_records(db, jordan_id, 1, 1, 1)
    base_features = dict(built["features"])
    scope = resolve_v3_scope(db, jordan_id, 1, 1)
    
    # Let's inspect base features
    print("Base Jordan WW%:", base_features.get("ww_percent_so_far"), "PT%:", base_features.get("pt_percent_so_far"))
    
    # Try different WW and PT earned points (out of WW possible=40, PT possible=80)
    # WW: 2 items of 20 = 40 pts possible
    # PT: 2 items of 40 = 80 pts possible
    scenarios = [
        # (ww_earned, pt_earned, desc)
        (24.0, 63.0, "WW=60.0%, PT=78.75% (Jordan)"),
        (20.0, 56.0, "WW=50.0%, PT=70.0%"),
        (18.0, 52.0, "WW=45.0%, PT=65.0%"),
        (16.0, 48.0, "WW=40.0%, PT=60.0%"),
        (14.0, 44.0, "WW=35.0%, PT=55.0%"),
        (12.0, 40.0, "WW=30.0%, PT=50.0%"),
        (10.0, 40.0, "WW=25.0%, PT=50.0%"),
    ]
    
    for ww_e, pt_e, desc in scenarios:
        f = dict(base_features)
        f["ww_points_earned_so_far"] = ww_e
        f["ww_points_possible_so_far"] = 40.0
        f["ww_percent_so_far"] = ww_e / 40.0 * 100.0
        f["ww_weighted_score_so_far"] = f["ww_percent_so_far"] * 0.20
        
        f["pt_points_earned_so_far"] = pt_e
        f["pt_points_possible_so_far"] = 80.0
        f["pt_percent_so_far"] = pt_e / 80.0 * 100.0
        f["pt_weighted_score_so_far"] = f["pt_percent_so_far"] * 0.50
        
        f["overall_weighted_score_so_far"] = f["ww_weighted_score_so_far"] + f["pt_weighted_score_so_far"]
        f["overall_partial_percent"] = f["overall_weighted_score_so_far"] / 0.70
        
        canon = canonicalize_v3_features(f, scope)
        pred = scorer.score_development_current_term(canon, model_name=CORRECTED_MODEL_NAME)
        risk = "HIGH_RISK" if pred < 75.0 else "MODERATE_RISK" if pred < 85.0 else "NEEDS_MONITORING" if pred < 90.0 else "LOW_RISK"
        print(f"{desc:35} -> Predicted: {pred:.2f} ({risk})")
finally:
    db.close()

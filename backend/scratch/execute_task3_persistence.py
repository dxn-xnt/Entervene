import os
import sys
from uuid import UUID

os.environ["ENV_FILE"] = ".env.demo"
sys.path.insert(0, os.path.abspath("."))

from app.core.Config import settings
from app.db.Session import SessionLocal
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.intervention.Intervention import Intervention
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction.DevelopmentCurrentTermPredictionPersistenceService import generate_and_persist_development_current_term

db = SessionLocal()
try:
    jordan_id = UUID("02361276-31c5-5e69-a622-b7220472edd3")
    class_id = 1
    subject_id = 1
    period_id = 1

    # Check pre-persistence count
    pre_pred_count = db.query(DevelopmentCurrentTermPrediction).count()
    pre_inv_count = db.query(Intervention).count()
    print(f"Pre-persistence Development Predictions: {pre_pred_count}")
    print(f"Pre-persistence Interventions: {pre_inv_count}")

    model_version = db.query(AIModelVersion).filter_by(
        model_name=CORRECTED_MODEL_NAME,
        model_version_id=2
    ).first()
    if not model_version:
        raise ValueError("Model version 2 not found!")

    # Persist prediction for Jordan
    result = generate_and_persist_development_current_term(
        student_id=jordan_id,
        class_id=class_id,
        subject_id=subject_id,
        period_id=period_id,
        model_version_id=model_version.model_version_id,
        bind=db.get_bind(),
    )
    print("\n--- Persistence Result ---")
    for k, v in result.items():
        print(f"  {k}: {v}")

    # Check post-persistence count
    post_pred_count = db.query(DevelopmentCurrentTermPrediction).count()
    post_inv_count = db.query(Intervention).count()
    print(f"\nPost-persistence Development Predictions: {post_pred_count}")
    print(f"Post-persistence Interventions: {post_inv_count}")

    # Inspect persisted prediction row
    persisted = db.query(DevelopmentCurrentTermPrediction).filter_by(
        prediction_id=result["prediction_id"]
    ).first()
    print("\n--- Persisted Row Details ---")
    print(f"Prediction ID: {persisted.prediction_id}")
    print(f"Student ID: {persisted.student_id}")
    print(f"Revision: {persisted.revision}")
    print(f"Predicted Grade: {persisted.predicted_period_grade}")
    print(f"Intervention Level: {persisted.intervention_level}")
    print(f"Intervention Basis: {persisted.intervention_basis}")
    print(f"Generated At: {persisted.generated_at}")
    snapshot = persisted.evidence_snapshot
    print(f"Snapshot Version: {snapshot.get('snapshot_version')}")
    print(f"Readiness: {snapshot.get('readiness')}")
    print(f"Projected Raw: {snapshot.get('projected_final_term_grade_raw')}")
    print(f"Intervention Reason Codes: {snapshot.get('intervention_reason_codes')}")

    # Check interventions for Jordan
    jordan_invs = db.query(Intervention).filter_by(student_id=jordan_id).all()
    print(f"\nJordan Interventions Count: {len(jordan_invs)}")
    for inv in jordan_invs:
        print(f"  Inv ID: {inv.intervention_id}, Status: {inv.status}, Reason: {inv.resolution_reason}")

    # Check Drew and Finley interventions
    other_invs = db.query(Intervention).filter(Intervention.student_id != jordan_id).all()
    print(f"\nOther Students Interventions Count: {len(other_invs)}")
    for inv in other_invs:
        print(f"  Student {inv.student_id}: Inv ID {inv.intervention_id}, Status {inv.status}, Reason {inv.resolution_reason}")

finally:
    db.close()

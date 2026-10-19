import os
import sys
from uuid import UUID

# Set env before importing app
os.environ["ENV_FILE"] = ".env.demo"
sys.path.insert(0, os.path.abspath("."))

from app.core.Config import settings
from app.db.Session import SessionLocal
from app.models.ai.AIModelVersion import AIModelVersion
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction.CurrentPeriodFeatureBuilderService import build_current_period_features_from_records
from app.services.prediction import DevelopmentCurrentTermPredictionService as pred_service
from app.services.prediction import DevelopmentCurrentTermRiskService as risk_service
from app.services.prediction import DevelopmentCurrentTermPredictionPersistenceService as persist_service
from app.services.intervention.InterventionDiagnosisService import build_candidate_diagnosis
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction

print(f"App Environment: {settings.app_environment}")
print(f"DB URL: {settings.database_url}")
print(f"Dev Current Term Model: {settings.development_current_term_model_name}")

db = SessionLocal()
try:
    jordan_id = UUID("02361276-31c5-5e69-a622-b7220472edd3")
    class_id = 1
    subject_id = 1
    period_id = 1

    # 1. Feature builder & Readiness check
    from datetime import datetime, timezone
    cutoff = datetime.now(timezone.utc)
    features_result = build_current_period_features_from_records(
        db, jordan_id, class_id, subject_id, period_id, cutoff_at=cutoff
    )
    print("\n--- Feature Builder & Readiness ---")
    print("Ready:", features_result["ready"])
    print("Readiness Level:", features_result["readiness_level"])
    print("Features Result Keys:", list(features_result.keys()))
    print("Readiness Reason Codes:", features_result.get("readiness_reason_codes"))
    print("Domain Warnings:", features_result.get("domain_warnings"))
    print("Evidence Summary:", features_result.get("evidence_summary"))

    # 2. Scope check
    scope = pred_service.resolve_v3_scope(db, jordan_id, class_id, subject_id)
    print("\n--- Scope Authorization ---")
    print("Scope:", scope)

    # 3. Predict via development prediction service
    model_version = db.query(AIModelVersion).filter_by(
        model_name=CORRECTED_MODEL_NAME,
        model_version_id=2
    ).first()
    print("\n--- Model Version ---")
    print("ID:", model_version.model_version_id, "Name:", model_version.model_name)

    prediction = pred_service.predict_development_current_term(
        db, jordan_id, class_id, subject_id, period_id, model_name=model_version.model_name
    )
    print("\n--- Prediction Output ---")
    print("Status:", prediction["status"])
    print("Projected Grade:", prediction["projected_final_term_grade"])
    print("Readiness Result:", prediction["readiness_result"])
    print("Domain Result:", prediction["domain_result"])

    # 4. Risk / Intervention Assessment
    intervention_assessment = risk_service.assess_development_current_term_intervention(prediction)
    print("\n--- Intervention Assessment ---")
    print("Intervention Level:", intervention_assessment["intervention_level"])
    print("Intervention Basis:", intervention_assessment["intervention_basis"])
    print("Triggered Reasons:", intervention_assessment["triggered_reasons"])
    print("Supporting Signals:", intervention_assessment["supporting_context"]["signals"])

    # 5. Build candidate diagnosis dry-run
    # Create an uncommitted DevelopmentCurrentTermPrediction dummy to pass to build_candidate_diagnosis
    dummy_pred = DevelopmentCurrentTermPrediction(
        student_id=jordan_id,
        class_id=class_id,
        subject_id=subject_id,
        source_period_id=period_id,
        target_period_id=period_id,
        model_version_id=model_version.model_version_id,
        revision=1,
        predicted_period_grade=prediction["projected_final_term_grade"],
        intervention_level=intervention_assessment["intervention_level"],
        intervention_basis=intervention_assessment["intervention_basis"],
        evidence_snapshot={
            "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []},
            "generation_cutoff_at": cutoff.isoformat(),
            "model_features": [{"name": k, "value": v} for k, v in features_result["features"].items()],
        }
    )
    diagnosis = build_candidate_diagnosis(db, dummy_pred)
    print("\n--- Intervention Diagnosis ---")
    print("Diagnosis Status:", diagnosis["diagnosis_status"])
    print("Components:", diagnosis["components"])
    print("Weakest Supported Components:", diagnosis["weakest_supported_components"])
    print("Lowest Supported Competencies:")
    for comp in diagnosis["lowest_supported_competencies"]:
        print(f"  Competency ID: {comp['competency_id']}, Code: {comp['competency_code']}")
        print(f"  Statement: {comp['competency_statement']}")
        print(f"  Score: {comp['score']}/{comp['possible_score']} ({comp['percent']}%)")
        print(f"  Supporting items count: {len(comp['supporting_scores'])}")
    print("Manual Assessment Coverage Count:", len(diagnosis["manual_assessment_coverage"]))
    print("External Assessment Detail Status:", diagnosis["external_assessment_detail_status"])
    print("Unresolved Activity Evidence:", diagnosis["unresolved_activity_evidence"])

finally:
    db.close()

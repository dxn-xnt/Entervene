import os
import sys

os.environ["ENV_FILE"] = ".env.demo"
sys.path.insert(0, os.path.abspath("."))

from app.db.Session import SessionLocal
from app.services.prediction import DevelopmentCurrentTermPredictionReadService as read_service
from app.models.ai.AIModelVersion import AIModelVersion
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME

db = SessionLocal()
try:
    class_id = 1
    subject_id = 1
    academic_period_id = 1

    model_version = db.query(AIModelVersion).filter_by(
        model_name=CORRECTED_MODEL_NAME,
        model_version_id=2
    ).first()

    data = read_service.list_latest_development_current_term_predictions(
        db,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=academic_period_id,
        model_version_id=model_version.model_version_id,
        require_active_enrollment=False,
    )

    print(f"Total students returned: {data['total']}")
    jordan_data = None
    for item in data["items"]:
        # check if this is Jordan
        if "Jordan" in item.get("student_name", "") or str(item.get("student_id")) == "02361276-31c5-5e69-a622-b7220472edd3":
            jordan_data = item
            break

    if jordan_data:
        print("\n--- Jordan's Prediction in Dashboard API ---")
        for k, v in jordan_data.items():
            print(f"  {k}: {v}")
    else:
        print("Jordan not found in items!")
        print("Sample items:", [item.get("student_name") for item in data["items"]])

finally:
    db.close()

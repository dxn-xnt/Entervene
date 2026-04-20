from fastapi import APIRouter
from pydantic import BaseModel

from app.services.Prediction import predict_risk

router = APIRouter()


class StudentFeatures(BaseModel):
    gender: str = "M"
    age_band: str = "0-35"
    imd_band: str = "50-60%"
    highest_education: str = "A Level or Equivalent"
    disability: str = "N"
    num_of_prev_attempts: int = 0
    studied_credits: int = 60
    total_clicks: float = 0
    active_days: float = 0
    avg_daily_clicks: float = 0
    avg_score: float = 0
    min_score: float = 0
    avg_submission_delay: float = 0
    num_assessments_submitted: int = 0
    early_withdrawal: int = 0


@router.post("/predict")
def predict(features: StudentFeatures):
    return predict_risk(features.model_dump())


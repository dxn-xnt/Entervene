from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
from app.models.ai.RiskThreshold import RiskThreshold
from app.services.prediction.PredictionFeatureBuilderService import compute_behavioral_engagement_score


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine, tables=[RiskThreshold.__table__])
    session = sessionmaker(bind=engine)()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine, tables=[RiskThreshold.__table__])
        engine.dispose()


def test_behavioral_score_all_signals_default_weights():
    # Attendance: 90.0%, On-time: 0.85 (85.0%), Completion: 0.75 (75.0%)
    # Default weights: 0.40, 0.35, 0.25 -> 0.40*90 + 0.35*85 + 0.25*75 = 36 + 29.75 + 18.75 = 84.50
    score = compute_behavioral_engagement_score(
        risk_adjusted_attendance_rate=90.0,
        on_time_submission_rate=0.85,
        assessment_completion_rate=0.75,
    )
    assert score == 84.50


def test_behavioral_score_custom_db_weights(db):
    now = datetime.now(timezone.utc)
    # Set custom weights: 50% attendance, 30% on-time, 20% participation
    db.add(RiskThreshold(
        threshold_name="Custom Attendance Weight",
        condition_type="attendance_weight",
        condition_value=Decimal("0.5000"),
        risk_level="NEEDS_MONITORING",
        effective_from=now,
        is_active=True,
    ))
    db.add(RiskThreshold(
        threshold_name="Custom On-Time Weight",
        condition_type="ontime_weight",
        condition_value=Decimal("0.3000"),
        risk_level="NEEDS_MONITORING",
        effective_from=now,
        is_active=True,
    ))
    db.add(RiskThreshold(
        threshold_name="Custom Participation Weight",
        condition_type="participation_weight",
        condition_value=Decimal("0.2000"),
        risk_level="NEEDS_MONITORING",
        effective_from=now,
        is_active=True,
    ))
    db.commit()

    # 0.50*90 + 0.30*80 + 0.20*70 = 45 + 24 + 14 = 83.00
    score = compute_behavioral_engagement_score(
        risk_adjusted_attendance_rate=90.0,
        on_time_submission_rate=0.80,
        assessment_completion_rate=0.70,
        db=db,
    )
    assert score == 83.00


def test_behavioral_score_missing_attendance_redistribution():
    # Attendance is None, On-time: 0.85 (85.0%), Completion: 0.75 (75.0%)
    # Total available weight: 0.35 + 0.25 = 0.60
    # On-time eff: 0.35/0.60 * 85 = 49.5833
    # Completion eff: 0.25/0.60 * 75 = 31.2500
    # Sum = 80.8333 -> 80.83
    score = compute_behavioral_engagement_score(
        risk_adjusted_attendance_rate=None,
        on_time_submission_rate=0.85,
        assessment_completion_rate=0.75,
    )
    assert score == 80.83


def test_behavioral_score_missing_ontime_redistribution():
    # On-time is None, Attendance: 90.0%, Completion: 0.75 (75.0%)
    # Total available weight: 0.40 + 0.25 = 0.65
    # Attendance eff: 0.40/0.65 * 90 = 55.3846
    # Completion eff: 0.25/0.65 * 75 = 28.8462
    # Sum = 84.2308 -> 84.23
    score = compute_behavioral_engagement_score(
        risk_adjusted_attendance_rate=90.0,
        on_time_submission_rate=None,
        assessment_completion_rate=0.75,
    )
    assert score == 84.23


def test_behavioral_score_two_signals_missing_cold_start():
    # Attendance is None, On-time is None, Completion: 0.80 (80.0%)
    # Total available weight: 0.25 -> 100% on completion
    # Sum = 80.00
    score = compute_behavioral_engagement_score(
        risk_adjusted_attendance_rate=None,
        on_time_submission_rate=None,
        assessment_completion_rate=0.80,
    )
    assert score == 80.00


def test_behavioral_score_all_signals_missing():
    score = compute_behavioral_engagement_score(
        risk_adjusted_attendance_rate=None,
        on_time_submission_rate=None,
        assessment_completion_rate=None,
    )
    assert score is None

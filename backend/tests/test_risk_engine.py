from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
from app.models.ai.RiskThreshold import RiskThreshold
from app.services.RiskEngine import (
    HIGH_RISK,
    INSUFFICIENT_DATA,
    LOW_RISK,
    MODERATE_RISK,
    NEEDS_MONITORING,
    RiskEngineInput,
    clamp_score,
    evaluate_risk,
    load_active_thresholds,
)


def sufficient_input(**overrides) -> RiskEngineInput:
    values = {
        "predicted_period_grade": 90.0,
        "source_period_grade": 91.0,
        "grade_trend_vs_previous_period": 0.0,
        "assessment_completion_rate": 0.95,
        "missing_activity_count": 0,
        "late_submission_count": 0,
        "data_coverage_ratio": 0.90,
        "has_previous_period": True,
    }
    values.update(overrides)
    return RiskEngineInput(**values)


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


def test_insufficient_data_when_predicted_grade_missing():
    result = evaluate_risk(sufficient_input(predicted_period_grade=None))

    assert result.risk_level == INSUFFICIENT_DATA
    assert result.data_status == INSUFFICIENT_DATA
    assert "missing_predicted_period_grade" in result.triggered_rules


def test_insufficient_data_when_data_coverage_below_50():
    result = evaluate_risk(sufficient_input(data_coverage_ratio=0.49))

    assert result.risk_level == INSUFFICIENT_DATA
    assert "data_coverage_below_50" in result.triggered_rules


def test_high_risk_when_predicted_grade_below_75():
    result = evaluate_risk(sufficient_input(predicted_period_grade=74.9))

    assert result.risk_level == HIGH_RISK
    assert "predicted_grade_below_75" in result.triggered_rules


def test_high_risk_when_predicted_below_80_and_trend_declines():
    result = evaluate_risk(sufficient_input(predicted_period_grade=79.0, grade_trend_vs_previous_period=-5.0))

    assert result.risk_level == HIGH_RISK
    assert "predicted_below_80_with_decline" in result.triggered_rules


def test_moderate_risk_when_predicted_grade_75_to_81_99():
    result = evaluate_risk(sufficient_input(predicted_period_grade=81.99))

    assert result.risk_level == MODERATE_RISK
    assert "predicted_grade_75_to_81" in result.triggered_rules


def test_moderate_risk_when_missing_activity_count_is_two_or_more():
    result = evaluate_risk(sufficient_input(predicted_period_grade=88.0, missing_activity_count=2))

    assert result.risk_level == MODERATE_RISK
    assert "two_or_more_missing_activities" in result.triggered_rules


def test_needs_monitoring_when_predicted_grade_82_to_87_99():
    result = evaluate_risk(sufficient_input(predicted_period_grade=87.99))

    assert result.risk_level == NEEDS_MONITORING
    assert "predicted_grade_82_to_87" in result.triggered_rules


def test_needs_monitoring_when_has_previous_period_is_false():
    result = evaluate_risk(sufficient_input(has_previous_period=False))

    assert result.risk_level == NEEDS_MONITORING
    assert "no_previous_period" in result.triggered_rules


def test_low_risk_when_grade_completion_and_coverage_are_strong():
    result = evaluate_risk(sufficient_input())

    assert result.risk_level == LOW_RISK
    assert result.recommended_action == "Continue normal monitoring."


def test_higher_severity_wins_when_multiple_rules_trigger():
    result = evaluate_risk(
        sufficient_input(
            predicted_period_grade=83.0,
            grade_trend_vs_previous_period=-8.0,
            late_submission_count=1,
        )
    )

    assert result.risk_level == MODERATE_RISK
    assert "predicted_grade_82_to_87" in result.triggered_rules
    assert "trend_declined_7_or_more" in result.triggered_rules


def test_reasons_are_included():
    result = evaluate_risk(sufficient_input(predicted_period_grade=81.0))

    assert result.reasons
    assert "Predicted next-period grade is below 82." in result.reasons


def test_risk_score_is_clamped_between_0_and_100():
    assert clamp_score(-10) == 0
    assert clamp_score(120) == 100
    result = evaluate_risk(
        sufficient_input(
            predicted_period_grade=70.0,
            source_period_grade=70.0,
            grade_trend_vs_previous_period=-30.0,
            assessment_completion_rate=0.51,
            missing_activity_count=20,
            late_submission_count=20,
        )
    )

    assert 0 <= result.risk_score <= 100


def test_no_threshold_rows_falls_back_to_defaults(db):
    assert load_active_thresholds(db) == []

    result = evaluate_risk(sufficient_input(predicted_period_grade=81.0), db=db)

    assert result.risk_level == MODERATE_RISK


def test_active_threshold_rows_can_be_loaded_without_breaking_defaults(db):
    db.add(
        RiskThreshold(
            threshold_name="Example threshold",
            condition_type="predicted_period_grade_lt",
            condition_value=Decimal("82.0"),
            risk_level=MODERATE_RISK,
            effective_from=datetime.now(timezone.utc),
            is_active=True,
        )
    )
    db.commit()

    thresholds = load_active_thresholds(db)
    result = evaluate_risk(sufficient_input(predicted_period_grade=81.0), db=db)

    assert len(thresholds) == 1
    assert thresholds[0].risk_level == MODERATE_RISK
    assert result.risk_level == MODERATE_RISK

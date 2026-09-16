from decimal import Decimal
import pytest
from app.db.Session import SessionLocal
from app.models.academic import Subject
from app.services.student_record.StudentRecordService import (
    GradingWeights,
    _deped_grade,
    resolve_subject_grading_weights,
)
from app.services.prediction.UnifiedCurrentTermFeatureBuilderService import (
    _domain_warnings,
    load_unified_feature_schema,
)
from app.services.prediction.CurrentPeriodFeatureBuilderService import (
    DomainWarning,
    _component_weight_pattern,
    domain_warnings,
    load_current_period_feature_schema,
)


@pytest.fixture
def pg_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_grading_template_resolution_core_subjects_20_50_30(pg_db):
    """Verify that ordinary core subjects (Math, Science, English, Filipino, AP) resolve to 20/50/30."""
    core_codenames = ["MATH7", "SCI7", "ENG7", "FIL7", "AP8", "AP9", "MATH10", "SCI10"]
    for code in core_codenames:
        subj = pg_db.query(Subject).filter(Subject.subject_codename == code).first()
        assert subj is not None, f"Subject with codename {code} should exist"
        weights = resolve_subject_grading_weights(pg_db, subj.subject_id)
        assert pytest.approx(weights.ww_weight, 0.001) == 0.20, f"{code} WW should be 20%"
        assert pytest.approx(weights.pt_weight, 0.001) == 0.50, f"{code} PT should be 50%"
        assert pytest.approx(weights.qa_weight, 0.001) == 0.30, f"{code} QA should be 30%"
        assert weights.template_name == "Core Subjects"


def test_grading_template_resolution_epp_tle_20_60_20(pg_db):
    """Verify that EPP/TLE subjects resolve to 20/60/20."""
    tle_codenames = ["TLE8", "TLE9"]
    for code in tle_codenames:
        subj = pg_db.query(Subject).filter(Subject.subject_codename == code).first()
        assert subj is not None, f"Subject with codename {code} should exist"
        weights = resolve_subject_grading_weights(pg_db, subj.subject_id)
        assert pytest.approx(weights.ww_weight, 0.001) == 0.20, f"{code} WW should be 20%"
        assert pytest.approx(weights.pt_weight, 0.001) == 0.60, f"{code} PT should be 60%"
        assert pytest.approx(weights.qa_weight, 0.001) == 0.20, f"{code} QA should be 20%"
        assert weights.template_name == "EPP/TLE Subjects"


def test_grading_template_resolution_mapeh_20_60_20(pg_db):
    """Verify that MAPEH subjects resolve to 20/60/20."""
    mapeh_codenames = ["MAPEH8", "MAPEH9"]
    for code in mapeh_codenames:
        subj = pg_db.query(Subject).filter(Subject.subject_codename == code).first()
        assert subj is not None, f"Subject with codename {code} should exist"
        weights = resolve_subject_grading_weights(pg_db, subj.subject_id)
        assert pytest.approx(weights.ww_weight, 0.001) == 0.20, f"{code} WW should be 20%"
        assert pytest.approx(weights.pt_weight, 0.001) == 0.60, f"{code} PT should be 60%"
        assert pytest.approx(weights.qa_weight, 0.001) == 0.20, f"{code} QA should be 20%"


def test_grading_calculation_20_50_30():
    """Verify mathematical calculation: WW 20% + PT 50% + QA 30%."""
    weights = GradingWeights(ww_weight=0.20, pt_weight=0.50, qa_weight=0.30)
    ps_ww, ps_pt, ps_qa = 85.0, 90.0, 80.0
    ww_contrib = ps_ww * weights.ww_weight
    pt_contrib = ps_pt * weights.pt_weight
    qa_contrib = ps_qa * weights.qa_weight
    ig = round(ww_contrib + pt_contrib + qa_contrib, 2)
    # 85*0.20 = 17.0, 90*0.50 = 45.0, 80*0.30 = 24.0 -> sum = 86.0
    assert ig == 86.00


def test_grading_calculation_20_60_20():
    """Verify mathematical calculation: WW 20% + PT 60% + QA 20%."""
    weights = GradingWeights(ww_weight=0.20, pt_weight=0.60, qa_weight=0.20)
    ps_ww, ps_pt, ps_qa = 85.0, 92.0, 88.0
    ww_contrib = ps_ww * weights.ww_weight
    pt_contrib = ps_pt * weights.pt_weight
    qa_contrib = ps_qa * weights.qa_weight
    ig = round(ww_contrib + pt_contrib + qa_contrib, 2)
    # 85*0.20 = 17.0, 92*0.60 = 55.20, 88*0.20 = 17.60 -> sum = 89.80
    assert ig == 89.80


def test_unified_weight_pattern_validation():
    """Verify that WW20_PT60_QA20 is accepted while WW20_PT50_QA30 produces UNSUPPORTED_WEIGHT_PATTERN."""
    base_schema = load_current_period_feature_schema()
    validated = set(base_schema.get("validated_weight_combinations") or [])

    # EPP/TLE pattern: WW20_PT60_QA20 is in the validated set
    assert "WW20_PT60_QA20" in validated

    # Core 20/50/30 pattern: WW20_PT50_QA30 was not in training data
    assert "WW20_PT50_QA30" not in validated

    # Verify domain_warnings generates UNSUPPORTED_WEIGHT_PATTERN for 20/50/30
    features_core = {
        "subject": "MATHEMATICS",
        "ww_weight": 20.0,
        "pt_weight": 50.0,
        "qa_weight": 30.0,
    }
    pattern = _component_weight_pattern(features_core)
    assert pattern == "WW20_PT50_QA30"
    warns = domain_warnings(features_core, base_schema)
    codes = [w["code"] if isinstance(w, dict) else w.code for w in warns]
    assert "UNSUPPORTED_WEIGHT_PATTERN" in codes


def test_mapeh_unsupported():
    """Verify MAPEH returns DOMAIN_UNSUPPORTED in Unified V2."""
    schema = load_unified_feature_schema()
    warns = _domain_warnings("MAPEH", schema)
    assert any(w["code"] == "DOMAIN_UNSUPPORTED" for w in warns)


def test_values_gmrc_unsupported():
    """Verify Values Education / GMRC returns DOMAIN_UNSUPPORTED in Unified V2 due to special domain weighting."""
    schema = load_unified_feature_schema()
    warns = _domain_warnings("VALUES_EDUCATION", schema)
    assert any(w["code"] == "DOMAIN_UNSUPPORTED" for w in warns)
    assert "domain-specific" in warns[0]["message"].lower()


def test_advanced_physics_unsupported():
    """Verify Advanced Physics returns DOMAIN_UNSUPPORTED in Unified V2."""
    schema = load_unified_feature_schema()
    warns = _domain_warnings("ADVANCED_PHYSICS", schema)
    assert any(w["code"] == "DOMAIN_UNSUPPORTED" for w in warns)

from app.services.prediction.TeacherEvidenceService import teacher_evidence_from_snapshot


def snapshot(**overrides):
    value = {
        "scope": {"source_period_name": "Term 1"},
        "observed_evidence": {
            "assessment_completion_rate": {
                "raw_observed_value": 0.0, "evidence_state": "AVAILABLE", "unit": "NUMERIC",
                "scale": "ZERO_TO_ONE", "numerator": 0, "denominator": 10,
            },
            "source_period_grade": {
                "raw_observed_value": 0.0, "evidence_state": "AVAILABLE", "unit": "NUMERIC",
                "scale": "MODEL_NATIVE", "grade_provenance": "OFFICIAL",
            },
            "behavioral_engagement_score": {
                "raw_observed_value": 72.0, "evidence_state": "AVAILABLE", "unit": "NUMERIC", "scale": "MODEL_NATIVE",
            },
            "subject_SCIENCE": {"raw_observed_value": 1, "evidence_state": "AVAILABLE"},
        },
        "readiness": {"checks_evaluated": {"assessment_completion_rate": 0.0}, "failures": []},
        "grade_model": {"status": "EXECUTED", "ordered_feature_names": ["source_period_grade"]},
        "risk_engine": {
            "status": "EXECUTED", "inputs": {"behavioral_engagement_score": 72},
            "triggered_rules": [{"rule_identifier": "internal", "reason": "The saved prediction met a risk review rule."}],
        },
    }
    value.update(overrides)
    return value


def row(result, name):
    return next(item for item in result["evidence"] if item["feature_name"] == name)


def test_genuine_zero_completion_is_not_rendered_as_unavailable():
    item = row(teacher_evidence_from_snapshot(snapshot()), "assessment_completion_rate")
    assert item["formatted_value"] == "0 of 10 · 0%"


def test_no_expected_items_is_not_rendered_as_zero_percent():
    data = snapshot()
    data["observed_evidence"]["assessment_completion_rate"]["evidence_state"] = "NO_EXPECTED_ITEMS"
    assert row(teacher_evidence_from_snapshot(data), "assessment_completion_rate")["formatted_value"] == "No applicable activities recorded"


def test_grade_provenance_and_execution_usage_are_saved_truthfully():
    result = teacher_evidence_from_snapshot(snapshot())
    grade = row(result, "source_period_grade")
    assert grade["formatted_value"] == "0"
    assert grade["source_description"] == "Official grade — Term 1"
    assert grade["usage_description"] == "Used to estimate the predicted grade."


def test_provisional_and_estimated_grades_are_not_labeled_official():
    for provenance, expected in (("RECORDED_PROVISIONAL", "Provisional grade"), ("ESTIMATED", "Estimated grade")):
        data = snapshot()
        data["observed_evidence"]["source_period_grade"]["grade_provenance"] = provenance
        assert expected in row(teacher_evidence_from_snapshot(data), "source_period_grade")["source_description"]


def test_risk_only_usage_is_not_claimed_as_grade_model_use_and_internal_features_are_hidden():
    result = teacher_evidence_from_snapshot(snapshot())
    participation = row(result, "behavioral_engagement_score")
    assert participation["display_name"] == "Learning participation indicator"
    assert participation["usage_description"] == "Used during risk review, not to estimate the grade."
    assert all(item["feature_name"] != "subject_SCIENCE" for item in result["evidence"])


def test_attendance_wording_and_prediction_or_unknown_fields_are_not_evidence():
    data = snapshot()
    data["observed_evidence"]["risk_adjusted_attendance_rate"] = {
        "raw_observed_value": None, "evidence_state": "NO_RECORDED_DATA", "unit": "NUMERIC", "scale": "ZERO_TO_100"
    }
    data["observed_evidence"]["predicted_period_grade"] = {"raw_observed_value": 84, "evidence_state": "AVAILABLE"}
    data["observed_evidence"]["unregistered_metric"] = {"raw_observed_value": 1, "evidence_state": "AVAILABLE"}
    result = teacher_evidence_from_snapshot(data)
    assert row(result, "risk_adjusted_attendance_rate")["formatted_value"] == "No attendance evidence recorded"
    names = {item["feature_name"] for item in result["evidence"]}
    assert "predicted_period_grade" not in names
    assert "unregistered_metric" not in names


def test_skipped_model_has_no_model_usage_claim_and_legacy_is_explicit():
    data = snapshot()
    data["grade_model"] = {"status": "SKIPPED"}
    data["risk_engine"] = {"status": "SKIPPED"}
    data["readiness"] = {"checks_evaluated": {}, "failures": ["Grade coverage evidence is unavailable."]}
    result = teacher_evidence_from_snapshot(data)
    assert result["model_execution"] == "SKIPPED"
    assert "estimate" not in row(result, "source_period_grade")["usage_description"].lower()
    legacy = teacher_evidence_from_snapshot(None)
    assert legacy["prediction_status"] == "LEGACY"
    assert legacy["limitations"] == ["Source details unavailable for this saved prediction."]

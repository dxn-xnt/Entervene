"""Teacher-safe projection of immutable prediction evidence snapshots."""

from __future__ import annotations

from typing import Any

from app.services.prediction.FeatureCatalog import teacher_feature_presentation


def _period_label(snapshot: dict[str, Any]) -> str:
    scope = snapshot.get("scope") or {}
    return scope.get("source_period_name") or "the saved source period"


def _formatted_value(identifier: str, item: dict[str, Any]) -> str:
    state = item.get("evidence_state")
    if state == "NO_EXPECTED_ITEMS":
        return "No applicable activities recorded"
    if state == "NO_RECORDED_DATA":
        if identifier == "risk_adjusted_attendance_rate":
            return "No attendance evidence recorded"
        return "No recorded evidence"
    if state == "UNRESOLVED":
        return "Evidence unavailable because its source could not be verified"
    if state not in {"AVAILABLE", None}:
        return "Evidence unavailable"
    value = item.get("raw_observed_value")
    if value is None:
        return "No recorded evidence"
    numerator, denominator = item.get("numerator"), item.get("denominator")
    if identifier in {"assessment_completion_rate", "data_coverage_ratio"}:
        percent = round(float(value) * 100)
        if denominator is not None and numerator is not None:
            return f"{numerator} of {denominator} · {percent}%"
        return f"{percent}%"
    if identifier == "risk_adjusted_attendance_rate":
        return f"{float(value):g}/100"
    if identifier == "grade_trend_vs_previous_period":
        return f"{float(value):+g} points"
    if identifier in {"missing_activity_count", "late_submission_count"}:
        return str(int(value))
    return f"{float(value):g}" if isinstance(value, (int, float)) else str(value)


def _usage(identifier: str, snapshot: dict[str, Any]) -> str:
    readiness = snapshot.get("readiness") or {}
    model = snapshot.get("grade_model") or {}
    risk = snapshot.get("risk_engine") or {}
    if model.get("status") == "EXECUTED" and identifier in set(model.get("ordered_feature_names") or []):
        return "Used to estimate the predicted grade."
    if identifier in (readiness.get("checks_evaluated") or {}):
        return "Used to check whether enough evidence was available."
    if risk.get("status") == "EXECUTED" and identifier in (risk.get("inputs") or {}):
        return "Used during risk review, not to estimate the grade."
    return "Recorded as supporting evidence for this prediction."


def _source_description(identifier: str, item: dict[str, Any], snapshot: dict[str, Any]) -> str:
    period = _period_label(snapshot)
    if identifier == "source_period_grade":
        provenance = item.get("grade_provenance")
        labels = {"OFFICIAL": "Official grade", "RECORDED_PROVISIONAL": "Provisional grade", "ESTIMATED": "Estimated grade"}
        return f"{labels.get(provenance, 'Grade source unavailable')} — {period}"
    if identifier == "risk_adjusted_attendance_rate":
        return f"Attendance records — {period}"
    if identifier in {"assessment_completion_rate", "data_coverage_ratio", "missing_activity_count", "late_submission_count"}:
        return f"Classwork — {period}"
    return f"Saved prediction evidence — {period}"


def teacher_evidence_from_snapshot(snapshot: dict[str, Any] | None) -> dict[str, Any]:
    if not snapshot:
        return {
            "prediction_status": "LEGACY",
            "model_execution": "UNKNOWN",
            "evidence": [],
            "interpretations": [],
            "limitations": ["Source details unavailable for this saved prediction."],
        }
    rows = []
    for identifier, item in (snapshot.get("observed_evidence") or {}).items():
        presentation = teacher_feature_presentation(identifier)
        if presentation is None or not presentation.teacher_visible:
            continue
        rows.append({
            "feature_name": identifier,
            "display_name": presentation.display_name,
            "description": presentation.description,
            "category": presentation.category,
            "value": item.get("raw_observed_value"),
            "unit": item.get("unit"),
            "value_scale": item.get("scale"),
            "evidence_state": item.get("evidence_state"),
            "numerator": item.get("numerator"),
            "denominator": item.get("denominator"),
            "formatted_value": _formatted_value(identifier, item),
            "source_description": _source_description(identifier, item, snapshot),
            "usage_description": _usage(identifier, snapshot),
        })
    risk = snapshot.get("risk_engine") or {}
    interpretations = [
        item.get("reason") for item in risk.get("triggered_rules", []) if item.get("reason")
    ] if risk.get("status") == "EXECUTED" else []
    model = snapshot.get("grade_model") or {}
    limitations = list((snapshot.get("readiness") or {}).get("failures") or [])
    if model.get("status") == "SKIPPED" and not limitations:
        limitations.append("Not enough recorded grade evidence was available to generate a prediction.")
    return {
        "prediction_status": "INSUFFICIENT_DATA" if model.get("status") == "SKIPPED" else "GENERATED",
        "model_execution": model.get("status", "UNKNOWN"),
        "evidence": rows,
        "interpretations": interpretations,
        "limitations": limitations,
    }

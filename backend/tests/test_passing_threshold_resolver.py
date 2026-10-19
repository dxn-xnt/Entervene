"""Pure template-policy units: no database or application settings."""
import ast
from dataclasses import FrozenInstanceError
from datetime import datetime, timezone
from decimal import Decimal
import inspect

import pytest

from app.services.grading import PassingThresholdResolver as policy
from app.services.grading.PassingThresholdResolver import (
    PassingThresholdConfigurationError as ConfigurationError,
    PassingThresholdContext, PassingThresholdSnapshot, TemplateThresholdConfig,
    SubjectThresholdConfig, compare_stored_final_grade,
    parse_raw_general_average_threshold, resolve_passing_threshold, validate_passing_threshold,
)


def context(**changes):
    values = dict(academic_year_id=1, policy_mode="live",
        subjects={10: SubjectThresholdConfig(10, 20), 11: SubjectThresholdConfig(11, 21)},
        grading_templates={20: TemplateThresholdConfig(20, Decimal("85.00")),
                           21: TemplateThresholdConfig(21, Decimal("83.00"))},
        general_average_raw="80")
    values.update(changes)
    return PassingThresholdContext(**values)


def snapshot(**changes):
    values = dict(academic_year_id=1, scope="subject", threshold=Decimal("84.50"),
        policy_version="closure-contract-only", revision=1,
        captured_at=datetime(2026, 10, 17, tzinfo=timezone.utc),
        subject_id=10, grading_template_id=20)
    values.update(changes)
    return PassingThresholdSnapshot(**values)


def assert_code(code, call):
    with pytest.raises(ConfigurationError) as caught:
        call()
    assert caught.value.code == code
    assert str(caught.value) == policy.ERROR_MESSAGES[code]


@pytest.mark.parametrize("value", [Decimal("0"), Decimal("100"), Decimal("83.25"),
    Decimal("84.999"), 0, 100, 83.25])
def test_valid_threshold_preserves_precision(value):
    assert validate_passing_threshold(value) == Decimal(str(value))


@pytest.mark.parametrize("value", [None, True, False, "85", [], {}, Decimal("NaN"),
    Decimal("sNaN"), Decimal("Infinity"), Decimal("-Infinity"), float("nan"),
    float("inf"), float("-inf"), Decimal("-0.01"), Decimal("100.01")])
def test_invalid_threshold_is_explicit_without_fallback(value):
    assert_code("passing_threshold_invalid", lambda: validate_passing_threshold(value))


@pytest.mark.parametrize("raw,expected", [("0", "0"), ("100", "100"), ("80", "80"),
    ("83", "83"), (" 83.50 ", "83.50"), ("+80", "80"), (".5", "0.5")])
def test_raw_legacy_general_average_decimal_text(raw, expected):
    assert parse_raw_general_average_threshold(raw) == Decimal(expected)


@pytest.mark.parametrize("raw", ["", " ", "true", "False", "NaN", "sNaN", "Infinity",
    "-Infinity", "80%", "1e2", "8_0", "80,5", "-1", "100.01", "0x50", True, False,
    80, 83.0, Decimal("80"), [], {}])
def test_raw_legacy_general_average_never_coerces_invalid_config_to_zero(raw):
    assert_code("general_average_threshold_invalid", lambda: parse_raw_general_average_threshold(raw))


def test_missing_legacy_general_average_is_not_zero():
    assert_code("general_average_threshold_missing", lambda: parse_raw_general_average_threshold(None))
    assert parse_raw_general_average_threshold("0") == Decimal("0")


@pytest.mark.parametrize("subject_id,grade,passed", [
    (10, "84.00", False), (11, "84.00", True), (10, "85.00", True),
    (11, "83.00", True), (10, "84.999", False), (11, "82.999", False)])
def test_configured_85_83_comparisons_without_display_rounding(subject_id, grade, passed):
    result = resolve_passing_threshold(context(), academic_year_id=1, scope="subject", subject_id=subject_id)
    assert compare_stored_final_grade(Decimal(grade), result) is passed
    assert result.source == "live_grading_template"


def test_current_migration_87_85_values_are_separate_from_configurable_fixtures():
    ctx = context(grading_templates={20: TemplateThresholdConfig(20, Decimal("87")),
                                     21: TemplateThresholdConfig(21, Decimal("85"))})
    for subject_id in (10, 11):
        result = resolve_passing_threshold(ctx, academic_year_id=1, scope="subject", subject_id=subject_id)
        assert compare_stored_final_grade(Decimal("84"), result) is False


@pytest.mark.parametrize("subjects,templates,code", [
    ({}, {}, "subject_missing"),
    ({10: SubjectThresholdConfig(10, None)}, {}, "grading_template_missing"),
    ({10: SubjectThresholdConfig(10, 20)}, {}, "grading_template_missing"),
    ({10: SubjectThresholdConfig(999, 20)}, {}, "subject_missing"),
    ({10: SubjectThresholdConfig(10, 20)}, {20: TemplateThresholdConfig(999, Decimal("85"))}, "grading_template_mismatch"),
    ({10: SubjectThresholdConfig(10, 20)}, {20: TemplateThresholdConfig(20, None)}, "passing_threshold_invalid"),
])
def test_missing_or_mismatched_subject_template_configuration(subjects, templates, code):
    assert_code(code, lambda: resolve_passing_threshold(
        context(subjects=subjects, grading_templates=templates),
        academic_year_id=1, scope="subject", subject_id=10))


@pytest.mark.parametrize("args", [dict(scope="invalid"), dict(scope=None), dict(scope=[]),
    dict(scope=True), dict(scope="subject"), dict(scope="subject", subject_id=True),
    dict(scope="subject", subject_id=0), dict(scope="general_average", subject_id=10)])
def test_invalid_request_shapes_are_explicit(args):
    assert_code("request_scope_invalid", lambda: resolve_passing_threshold(context(), academic_year_id=1, **args))


@pytest.mark.parametrize("year", [None, True, 0, -1, "1"])
def test_explicit_year_is_required(year):
    assert_code("academic_year_missing", lambda: resolve_passing_threshold(
        context(), academic_year_id=year, scope="subject", subject_id=10))


@pytest.mark.parametrize("ctx,year", [(context(), 2), (context(policy_mode="invalid"), 1),
    (context(policy_mode=None), 1), (context(policy_mode=[]), 1)])
def test_year_mismatch_and_unknown_mode_fail_explicitly(ctx, year):
    assert_code("academic_year_ambiguous", lambda: resolve_passing_threshold(
        ctx, academic_year_id=year, scope="subject", subject_id=10))


def test_legacy_general_average_is_explicitly_transitional_and_not_year_initialization():
    result = resolve_passing_threshold(context(general_average_raw="80.25"),
                                      academic_year_id=1, scope="general_average")
    assert result.threshold == Decimal("80.25")
    assert result.source == "legacy_general_average_setting"


def test_live_resolution_does_not_apply_an_old_snapshot():
    result = resolve_passing_threshold(context(), academic_year_id=1, scope="subject",
                                      subject_id=10, result_snapshot=snapshot())
    assert result.threshold == Decimal("85")
    assert result.policy_version is None


@pytest.mark.parametrize("scope,identity", [("subject", {"subject_id": 10}), ("general_average", {})])
def test_future_non_live_contract_never_falls_back(scope, identity):
    assert_code("historical_threshold_snapshot_missing", lambda: resolve_passing_threshold(
        context(policy_mode="snapshot_required"), academic_year_id=1, scope=scope, **identity))


def test_future_closure_contract_ignores_mutable_live_template_relationships():
    frozen = context(policy_mode="snapshot_required", subjects={}, grading_templates={}, general_average_raw="broken")
    result = resolve_passing_threshold(frozen, academic_year_id=1, scope="subject",
                                      subject_id=10, result_snapshot=snapshot())
    assert result.threshold == Decimal("84.50") and result.source == "closure_snapshot"


def test_future_general_average_contract():
    old = snapshot(scope="general_average", subject_id=None, grading_template_id=None)
    assert resolve_passing_threshold(context(policy_mode="snapshot_required"), academic_year_id=1,
        scope="general_average", result_snapshot=old).threshold == old.threshold


@pytest.mark.parametrize("changes", [dict(academic_year_id=2), dict(academic_year_id=True),
    dict(scope="general_average"), dict(subject_id=11), dict(subject_id=None)])
def test_snapshot_contract_cannot_cross_scope(changes):
    assert_code("snapshot_scope_mismatch", lambda: resolve_passing_threshold(
        context(policy_mode="snapshot_required"), academic_year_id=1, scope="subject",
        subject_id=10, result_snapshot=snapshot(**changes)))


@pytest.mark.parametrize("changes", [dict(threshold=Decimal("NaN")), dict(threshold=Decimal("101")),
    dict(threshold=True), dict(threshold=84.5), dict(policy_version=""), dict(revision=0),
    dict(revision=True), dict(captured_at=datetime(2026, 10, 17)), dict(captured_at=None)])
def test_snapshot_contract_requires_decimal_and_provenance(changes):
    assert_code("snapshot_invalid", lambda: resolve_passing_threshold(
        context(policy_mode="snapshot_required"), academic_year_id=1, scope="subject",
        subject_id=10, result_snapshot=snapshot(**changes)))


@pytest.mark.parametrize("grade", [True, 0, 84.999, "85", Decimal("NaN"),
    Decimal("Infinity"), Decimal("-1"), Decimal("101")])
def test_comparison_requires_exact_stored_decimal(grade):
    result = resolve_passing_threshold(context(), academic_year_id=1, scope="subject", subject_id=10)
    assert_code("final_grade_invalid", lambda: compare_stored_final_grade(grade, result))


def test_missing_grade_and_scored_zero_are_distinct():
    mark = resolve_passing_threshold(context(general_average_raw="0"), academic_year_id=1, scope="general_average")
    assert compare_stored_final_grade(None, mark) is None
    assert compare_stored_final_grade(Decimal("0.00"), mark) is True


def test_context_defensively_copies_immutable_mapping():
    templates = {20: TemplateThresholdConfig(20, Decimal("85"))}
    ctx = context(grading_templates=templates)
    templates.clear()
    assert ctx.grading_templates[20].passing_threshold == Decimal("85")
    with pytest.raises(TypeError):
        ctx.grading_templates[20] = TemplateThresholdConfig(20, Decimal("0"))
    with pytest.raises(FrozenInstanceError):
        ctx.policy_mode = "snapshot_required"


def test_fixed_errors_do_not_disclose_configuration():
    sentinel = "synthetic-private-configuration-sentinel"
    with pytest.raises(ConfigurationError) as caught:
        parse_raw_general_average_threshold(sentinel)
    assert sentinel not in str(caught.value)
    with pytest.raises(ValueError, match="Unknown passing-threshold error code"):
        ConfigurationError(sentinel)


def test_pure_resolver_has_no_io_or_numeric_policy_defaults():
    tree = ast.parse(inspect.getsource(policy))
    imports = [n.module or "" for n in ast.walk(tree) if isinstance(n, ast.ImportFrom)]
    imports += [a.name for n in ast.walk(tree) if isinstance(n, ast.Import) for a in n.names]
    assert not any(n.startswith(("sqlalchemy", "app.db", "app.core", "httpx", "requests", "os", "pathlib")) for n in imports)
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for default in (*node.args.defaults, *node.args.kw_defaults):
                assert not (isinstance(default, ast.Constant) and default.value in (75, 80, 83, 85, 87))

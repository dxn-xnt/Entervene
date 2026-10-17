"""Pure policy tests; no database, application settings or HTTP calls."""
import ast
from dataclasses import FrozenInstanceError
from datetime import datetime, timezone
from decimal import Decimal
import inspect

import pytest

from app.services.grading import PassingThresholdResolver as policy
from app.services.grading.PassingThresholdResolver import (
    PassingThresholdConfigurationError as ConfigurationError,
    PassingThresholdContext, PassingThresholdSnapshot,
    SubjectGroupThresholdConfig, SubjectThresholdConfig,
    compare_stored_final_grade, parse_raw_general_average_threshold,
    resolve_passing_threshold, validate_passing_threshold,
)


def context(**changes):
    values = dict(academic_year_id=1, active_academic_year_id=1, policy_mode="live",
        subjects={10: SubjectThresholdConfig(10, 20), 11: SubjectThresholdConfig(11, 21)},
        subject_groups={20: SubjectGroupThresholdConfig(20, Decimal("85.00"), True),
                        21: SubjectGroupThresholdConfig(21, Decimal("83.00"), False)},
        general_average_raw="80")
    values.update(changes)
    return PassingThresholdContext(**values)


def snapshot(**changes):
    values = dict(academic_year_id=1, scope="subject", threshold=Decimal("84.50"),
        policy_version="r2-contract-v1", revision=1,
        captured_at=datetime(2026, 10, 17, tzinfo=timezone.utc), subject_id=10, subject_group_id=20)
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
    result = validate_passing_threshold(value)
    assert isinstance(result, Decimal)
    assert result == Decimal(str(value))


@pytest.mark.parametrize("value", [None, True, False, "85", [], {}, Decimal("NaN"),
    Decimal("sNaN"), Decimal("Infinity"), Decimal("-Infinity"), float("nan"), float("inf"),
    float("-inf"), Decimal("-0.01"), Decimal("100.01")])
def test_invalid_threshold_is_explicit_without_fallback(value):
    assert_code("passing_threshold_invalid", lambda: validate_passing_threshold(value))


@pytest.mark.parametrize("raw,expected", [("0", "0"), ("100", "100"), ("80", "80"),
    ("83", "83"), (" 83.50 ", "83.50"), ("+80", "80"), (".5", "0.5")])
def test_raw_general_average_decimal_text(raw, expected):
    assert parse_raw_general_average_threshold(raw) == Decimal(expected)


@pytest.mark.parametrize("raw", ["", " ", "true", "False", "NaN", "sNaN", "Infinity",
    "-Infinity", "80%", "1e2", "8_0", "80,5", "-1", "100.01", "0x50", True, False,
    80, 83.0, Decimal("80"), [], {}])
def test_raw_general_average_never_coerces_invalid_config_to_zero(raw):
    assert_code("general_average_threshold_invalid", lambda: parse_raw_general_average_threshold(raw))


def test_missing_general_average_is_distinct_from_empty_or_numeric_zero():
    assert_code("general_average_threshold_missing", lambda: parse_raw_general_average_threshold(None))
    assert parse_raw_general_average_threshold("0") == Decimal("0")


@pytest.mark.parametrize("subject_id,grade,passed", [(10, "80.00", False), (11, "80.00", False),
    (10, "84.00", False), (11, "84.00", True), (10, "85.00", True), (11, "83.00", True),
    (10, "84.999", False), (11, "82.999", False)])
def test_subject_specific_comparison_no_display_rounding(subject_id, grade, passed):
    resolved = resolve_passing_threshold(context(), academic_year_id=1, scope="subject", subject_id=subject_id)
    assert compare_stored_final_grade(Decimal(grade), resolved) is passed
    assert resolved.source == "live_subject_group"


def test_inactive_group_retains_configured_mark_and_group_only_lookup():
    result = resolve_passing_threshold(context(), academic_year_id=1, scope="subject", subject_group_id=21)
    assert result.threshold == Decimal("83.00")
    assert result.subject_group_id == 21
    assert result.subject_id is None


@pytest.mark.parametrize("subjects,groups,code", [
    ({}, {}, "subject_missing"),
    ({10: SubjectThresholdConfig(10, None)}, {}, "subject_group_missing"),
    ({10: SubjectThresholdConfig(10, 20)}, {}, "subject_group_missing"),
    ({10: SubjectThresholdConfig(999, 20)}, {}, "subject_group_mismatch"),
    ({10: SubjectThresholdConfig(10, 20)}, {20: SubjectGroupThresholdConfig(999, Decimal("85"), True)}, "subject_group_mismatch"),
    ({10: SubjectThresholdConfig(10, 20)}, {20: SubjectGroupThresholdConfig(20, None, True)}, "passing_threshold_invalid"),
])
def test_missing_or_mismatched_subject_configuration(subjects, groups, code):
    assert_code(code, lambda: resolve_passing_threshold(context(subjects=subjects, subject_groups=groups),
        academic_year_id=1, scope="subject", subject_id=10))


@pytest.mark.parametrize("request_args", [dict(scope="invalid"), dict(scope=None), dict(scope=[]),
    dict(scope=True), dict(scope="subject"),
    dict(scope="subject", subject_id=True), dict(scope="subject", subject_id=0),
    dict(scope="subject", subject_group_id=-1), dict(scope="subject", subject_id=10, subject_group_id=20),
    dict(scope="general_average", subject_id=10), dict(scope="general_average", subject_group_id=20)])
def test_invalid_request_shapes_are_explicit(request_args):
    assert_code("request_scope_invalid", lambda: resolve_passing_threshold(context(), academic_year_id=1, **request_args))


@pytest.mark.parametrize("year_id", [None, True, 0, -1, "1"])
def test_explicit_year_is_required(year_id):
    assert_code("academic_year_missing", lambda: resolve_passing_threshold(context(),
        academic_year_id=year_id, scope="subject", subject_id=10))


@pytest.mark.parametrize("ctx,year_id", [(context(), 2), (context(active_academic_year_id=None), 1),
    (context(active_academic_year_id=2), 1), (context(active_academic_year_id=True), 1),
    (context(policy_mode="invalid"), 1), (context(policy_mode=None), 1),
    (context(policy_mode=[]), 1)])
def test_ambiguous_year_policy_never_implicitly_uses_active_year(ctx, year_id):
    assert_code("academic_year_ambiguous", lambda: resolve_passing_threshold(ctx,
        academic_year_id=year_id, scope="subject", subject_id=10))


def test_live_general_average_uses_raw_setting_not_subject_mark_or_snapshot():
    old = snapshot(scope="general_average", subject_id=None, subject_group_id=None, threshold=Decimal("90"))
    result = resolve_passing_threshold(context(general_average_raw="83"), academic_year_id=1,
        scope="general_average", result_snapshot=old)
    assert result.threshold == Decimal("83")
    assert result.source == "live_general_average_setting"
    assert result.policy_version is None


@pytest.mark.parametrize("scope,identity", [("subject", {"subject_id": 10}),
    ("general_average", {})])
def test_non_live_year_requires_snapshot_without_live_fallback(scope, identity):
    assert_code("historical_threshold_snapshot_missing", lambda: resolve_passing_threshold(
        context(policy_mode="snapshot_required"), academic_year_id=1, scope=scope, **identity))


def test_snapshot_is_independent_of_current_group_setting_or_activation():
    frozen = context(policy_mode="snapshot_required", subjects={}, subject_groups={}, general_average_raw="broken")
    result = resolve_passing_threshold(frozen, academic_year_id=1, scope="subject", subject_id=10,
        result_snapshot=snapshot())
    assert result.threshold == Decimal("84.50")
    assert result.source == "finalized_snapshot"
    assert result.policy_version == "r2-contract-v1" and result.revision == 1
    assert result.subject_group_id == 20
    # Even active-year reactivation cannot override an explicitly frozen policy.
    assert frozen.active_academic_year_id == 1


def test_frozen_general_average_and_group_snapshot_contracts():
    frozen = context(policy_mode="snapshot_required", active_academic_year_id=2)
    general = snapshot(scope="general_average", subject_id=None, subject_group_id=None)
    assert resolve_passing_threshold(frozen, academic_year_id=1, scope="general_average",
        result_snapshot=general).threshold == general.threshold
    assert resolve_passing_threshold(frozen, academic_year_id=1, scope="subject", subject_group_id=20,
        result_snapshot=snapshot(subject_id=None)).threshold == Decimal("84.50")


@pytest.mark.parametrize("changes", [dict(academic_year_id=2), dict(academic_year_id=True),
    dict(scope="general_average"), dict(subject_id=11), dict(subject_group_id=None)])
def test_snapshot_cannot_cross_scope(changes):
    assert_code("snapshot_scope_mismatch", lambda: resolve_passing_threshold(context(policy_mode="snapshot_required"),
        academic_year_id=1, scope="subject", subject_id=10, result_snapshot=snapshot(**changes)))


@pytest.mark.parametrize("changes", [dict(threshold=Decimal("NaN")), dict(threshold=Decimal("101")),
    dict(threshold=True), dict(threshold=84.5), dict(policy_version=""), dict(revision=0),
    dict(revision=True), dict(captured_at=datetime(2026, 10, 17)), dict(captured_at=None)])
def test_snapshot_requires_valid_decimal_and_provenance(changes):
    assert_code("snapshot_invalid", lambda: resolve_passing_threshold(context(policy_mode="snapshot_required"),
        academic_year_id=1, scope="subject", subject_id=10, result_snapshot=snapshot(**changes)))


def test_general_snapshot_cannot_smuggle_a_subject_scope():
    assert_code("snapshot_scope_mismatch", lambda: resolve_passing_threshold(context(policy_mode="snapshot_required"),
        academic_year_id=1, scope="general_average", result_snapshot=snapshot(scope="general_average")))


@pytest.mark.parametrize("grade", [True, 0, 84.999, "85", Decimal("NaN"), Decimal("Infinity"), Decimal("-1"), Decimal("101")])
def test_grade_comparison_requires_exact_stored_decimal(grade):
    threshold = resolve_passing_threshold(context(), academic_year_id=1, scope="subject", subject_id=10)
    assert_code("final_grade_invalid", lambda: compare_stored_final_grade(grade, threshold))


def test_missing_grade_and_scored_zero_are_distinct():
    mark = resolve_passing_threshold(context(general_average_raw="0"), academic_year_id=1, scope="general_average")
    assert compare_stored_final_grade(None, mark) is None
    assert compare_stored_final_grade(Decimal("0.00"), mark) is True


def test_context_and_snapshot_are_immutable_and_defensively_copy_mappings():
    groups = {20: SubjectGroupThresholdConfig(20, Decimal("85"), True)}
    ctx = context(subject_groups=groups)
    groups.clear()
    assert ctx.subject_groups[20].passing_threshold == Decimal("85")
    with pytest.raises(TypeError):
        ctx.subject_groups[20] = SubjectGroupThresholdConfig(20, Decimal("0"), True)
    with pytest.raises(FrozenInstanceError):
        ctx.policy_mode = "snapshot_required"
    with pytest.raises(FrozenInstanceError):
        snapshot().revision = 2


def test_fixed_errors_never_disclose_raw_configuration_or_unknown_codes():
    secret = "synthetic-private-configuration-sentinel"
    with pytest.raises(ConfigurationError) as caught:
        parse_raw_general_average_threshold(secret)
    assert secret not in str(caught.value)
    with pytest.raises(ValueError, match="Unknown passing-threshold error code"):
        ConfigurationError(secret)


def test_resolver_has_no_database_settings_http_io_or_numeric_default_parameters():
    tree = ast.parse(inspect.getsource(policy))
    imports = [node.module or "" for node in ast.walk(tree) if isinstance(node, ast.ImportFrom)]
    imports += [alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names]
    assert not any(name.startswith(("sqlalchemy", "app.db", "app.core", "httpx", "requests", "os", "pathlib")) for name in imports)
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            assert not (isinstance(node.func, ast.Attribute) and node.func.attr in {"execute", "query", "flush", "commit", "rollback"})
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for default in (*node.args.defaults, *node.args.kw_defaults):
                assert not (isinstance(default, ast.Constant) and default.value in (75, 80, 83))

"""Pure passing-policy resolution for the current template-based schema.

PR 1a: the explicitly requested existing year uses live validated policy, even
when inactive. The reader does not infer closure from active flags. Closure
snapshots below are contracts only: no closure storage, finalization, revision
workflow or year-scoped general-average configuration is implemented here.
The raw global general-average setting is transitional legacy policy, not an
initialized academic-year policy. Official SF9 reporting semantics are separate.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
import math
import re
from types import MappingProxyType
from typing import Literal, Mapping

ThresholdScope = Literal["subject", "general_average"]
PolicyMode = Literal["live", "snapshot_required"]
ThresholdSource = Literal["live_grading_template", "legacy_general_average_setting", "closure_snapshot"]
GENERAL_AVERAGE_SETTING_KEY = "general_average_passing_grade"

ERROR_MESSAGES = MappingProxyType({
    "academic_year_missing": "An explicit, existing academic year is required.",
    "academic_year_ambiguous": "Academic-year policy does not match the requested year.",
    "subject_missing": "The requested subject is unavailable in the supplied context.",
    "grading_template_missing": "The subject's configured grading template is missing.",
    "grading_template_mismatch": "The subject and grading-template identities do not match.",
    "passing_threshold_invalid": "The grading-template passing threshold must be a finite number from 0 to 100.",
    "general_average_threshold_missing": "The legacy general-average passing-grade setting is missing.",
    "general_average_threshold_invalid": "The raw legacy general-average setting must be a finite number from 0 to 100.",
    "historical_threshold_snapshot_missing": "A non-live year requires an explicit closure-policy snapshot.",
    "snapshot_scope_mismatch": "The snapshot does not match the requested year, scope or subject.",
    "snapshot_invalid": "The closure-policy snapshot or its provenance is invalid.",
    "request_scope_invalid": "Supply a valid scope and a subject identity only for subject scope.",
    "final_grade_invalid": "A final grade must be the exact finite stored Decimal from 0 to 100, or unavailable.",
})


class PassingThresholdConfigurationError(Exception):
    """Stable code and fixed message only; never include raw configuration."""

    def __init__(self, code: str):
        if type(code) is not str or code not in ERROR_MESSAGES:
            raise ValueError("Unknown passing-threshold error code.")
        self.code = code
        super().__init__(ERROR_MESSAGES[code])


def _positive_id(value: object) -> bool:
    return type(value) is int and value > 0


def validate_passing_threshold(value: object, *, code: str = "passing_threshold_invalid") -> Decimal:
    """Retain Decimal precision; never round or supply a policy default."""
    if isinstance(value, bool) or not isinstance(value, (Decimal, int, float)):
        raise PassingThresholdConfigurationError(code)
    if isinstance(value, float) and not math.isfinite(value):
        raise PassingThresholdConfigurationError(code)
    try:
        number = value if isinstance(value, Decimal) else Decimal(str(value))
    except (InvalidOperation, ValueError, OverflowError):
        raise PassingThresholdConfigurationError(code) from None
    if not number.is_finite() or not Decimal("0") <= number <= Decimal("100"):
        raise PassingThresholdConfigurationError(code)
    return number


def parse_raw_general_average_threshold(raw: object) -> Decimal:
    """Transitional global TEXT setting; not a year-specific initialization."""
    if raw is None:
        raise PassingThresholdConfigurationError("general_average_threshold_missing")
    if type(raw) is not str or re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)", raw.strip()) is None:
        raise PassingThresholdConfigurationError("general_average_threshold_invalid")
    try:
        value = Decimal(raw.strip())
    except InvalidOperation:
        raise PassingThresholdConfigurationError("general_average_threshold_invalid") from None
    return validate_passing_threshold(value, code="general_average_threshold_invalid")


def validate_subject_template_threshold(
    subject_id: int, grading_template_id: int | None,
    linked_template_id: int | None, value: object,
) -> Decimal:
    """Common identity/numeric validation, also usable by pure dashboard adapters."""
    if not _positive_id(subject_id):
        raise PassingThresholdConfigurationError("subject_missing")
    if not _positive_id(grading_template_id) or not _positive_id(linked_template_id):
        raise PassingThresholdConfigurationError("grading_template_missing")
    if grading_template_id != linked_template_id:
        raise PassingThresholdConfigurationError("grading_template_mismatch")
    return validate_passing_threshold(value)


@dataclass(frozen=True)
class SubjectThresholdConfig:
    subject_id: int
    grading_template_id: int | None


@dataclass(frozen=True)
class TemplateThresholdConfig:
    grading_template_id: int
    passing_threshold: object


@dataclass(frozen=True)
class PassingThresholdSnapshot:
    """Future closure boundary only: no persisted model, capture or revision writes."""

    academic_year_id: int
    scope: ThresholdScope
    threshold: Decimal
    policy_version: str
    revision: int
    captured_at: datetime
    subject_id: int | None = None
    grading_template_id: int | None = None


@dataclass(frozen=True)
class PassingThresholdContext:
    academic_year_id: int
    policy_mode: PolicyMode
    subjects: Mapping[int, SubjectThresholdConfig]
    grading_templates: Mapping[int, TemplateThresholdConfig]
    general_average_raw: object

    def __post_init__(self):
        object.__setattr__(self, "subjects", MappingProxyType(dict(self.subjects)))
        object.__setattr__(self, "grading_templates", MappingProxyType(dict(self.grading_templates)))


@dataclass(frozen=True)
class PassingThresholdResolution:
    academic_year_id: int
    scope: ThresholdScope
    threshold: Decimal
    source: ThresholdSource
    subject_id: int | None = None
    grading_template_id: int | None = None
    policy_version: str | None = None
    revision: int | None = None
    captured_at: datetime | None = None


def _snapshot_resolution(snapshot, *, academic_year_id, scope, subject_id):
    if not isinstance(snapshot, PassingThresholdSnapshot):
        raise PassingThresholdConfigurationError("snapshot_invalid")
    if (snapshot.academic_year_id != academic_year_id or type(snapshot.academic_year_id) is not int
            or snapshot.scope != scope):
        raise PassingThresholdConfigurationError("snapshot_scope_mismatch")
    if scope == "general_average":
        if snapshot.subject_id is not None or snapshot.grading_template_id is not None:
            raise PassingThresholdConfigurationError("snapshot_scope_mismatch")
    elif (snapshot.subject_id != subject_id or not _positive_id(snapshot.subject_id)
          or (snapshot.grading_template_id is not None and not _positive_id(snapshot.grading_template_id))):
        raise PassingThresholdConfigurationError("snapshot_scope_mismatch")
    if (not isinstance(snapshot.threshold, Decimal) or not _positive_id(snapshot.revision)
            or type(snapshot.policy_version) is not str or not snapshot.policy_version.strip()
            or not isinstance(snapshot.captured_at, datetime)
            or snapshot.captured_at.tzinfo is None or snapshot.captured_at.utcoffset() is None):
        raise PassingThresholdConfigurationError("snapshot_invalid")
    value = validate_passing_threshold(snapshot.threshold, code="snapshot_invalid")
    return PassingThresholdResolution(
        academic_year_id=academic_year_id, scope=scope, threshold=value,
        source="closure_snapshot", subject_id=snapshot.subject_id,
        grading_template_id=snapshot.grading_template_id, policy_version=snapshot.policy_version,
        revision=snapshot.revision, captured_at=snapshot.captured_at,
    )


def resolve_passing_threshold(
    context: PassingThresholdContext, *, academic_year_id: int, scope: ThresholdScope,
    subject_id: int | None = None, result_snapshot: PassingThresholdSnapshot | None = None,
) -> PassingThresholdResolution:
    """Pure resolution from authorized inputs; never infer the year from activation."""
    if not _positive_id(academic_year_id) or not _positive_id(context.academic_year_id):
        raise PassingThresholdConfigurationError("academic_year_missing")
    if (context.academic_year_id != academic_year_id or type(context.policy_mode) is not str
            or context.policy_mode not in {"live", "snapshot_required"}):
        raise PassingThresholdConfigurationError("academic_year_ambiguous")
    if type(scope) is not str or scope not in {"subject", "general_average"}:
        raise PassingThresholdConfigurationError("request_scope_invalid")
    if (scope == "general_average" and subject_id is not None
            or scope == "subject" and not _positive_id(subject_id)):
        raise PassingThresholdConfigurationError("request_scope_invalid")
    if context.policy_mode == "snapshot_required":
        if result_snapshot is None:
            raise PassingThresholdConfigurationError("historical_threshold_snapshot_missing")
        return _snapshot_resolution(result_snapshot, academic_year_id=academic_year_id,
                                    scope=scope, subject_id=subject_id)
    if scope == "general_average":
        return PassingThresholdResolution(
            academic_year_id=academic_year_id, scope=scope,
            threshold=parse_raw_general_average_threshold(context.general_average_raw),
            source="legacy_general_average_setting",
        )
    subject = context.subjects.get(subject_id)
    if subject is None or subject.subject_id != subject_id:
        raise PassingThresholdConfigurationError("subject_missing")
    template = context.grading_templates.get(subject.grading_template_id)
    value = validate_subject_template_threshold(
        subject_id, subject.grading_template_id,
        template.grading_template_id if template else None,
        template.passing_threshold if template else None,
    )
    return PassingThresholdResolution(
        academic_year_id=academic_year_id, scope=scope, threshold=value,
        source="live_grading_template", subject_id=subject_id,
        grading_template_id=subject.grading_template_id,
    )


def compare_stored_final_grade(grade: Decimal | None, threshold: PassingThresholdResolution) -> bool | None:
    """Missing grade is unavailable; scored zero is valid. No display rounding."""
    if grade is None:
        return None
    if not isinstance(grade, Decimal):
        raise PassingThresholdConfigurationError("final_grade_invalid")
    return validate_passing_threshold(grade, code="final_grade_invalid") >= validate_passing_threshold(threshold.threshold)

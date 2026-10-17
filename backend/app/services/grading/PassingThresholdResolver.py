"""R1 passing-policy contracts and pure resolution; no application consumers yet.

Plan addendum accepted by the PM:
* R2a supplies irreversible year freezing and activation protection (no UI here).
* R2b snapshots each term at finalization. Annual subject completion means all
  three distinct terms, in completion order; general average additionally needs
  every required subject. No annual snapshot is captured by a read/export.
* Unchanged resends preserve snapshots. Active-year corrections/manual overrides
  append audited revisions; completed annual snapshots are atomically superseded
  and recaptured. Frozen-year corrections, including force/manual, are rejected.
* Stale-outcome reporting belongs to the later consumer PR. No refresh here.
* Compare the exact stored Decimal grade, without further rounding. Inactive
  groups retain their threshold; missing groups never imply another group.

Snapshot types below are contracts, NOT persisted models. R1 does not implement
finalization, lifecycle, three-term completeness or revision writes. An explicit
snapshot_required mode can represent freezing independently of is_active; future
R2a must make that marker authoritative even if a year is reactivated. Inactive
years are NOT assumed closed: R1 simply refuses a live-policy historical guess.
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
ThresholdSource = Literal["live_subject_group", "live_general_average_setting", "finalized_snapshot"]
GENERAL_AVERAGE_SETTING_KEY = "general_average_passing_grade"

ERROR_MESSAGES = MappingProxyType({
    "academic_year_missing": "An explicit, existing academic year is required.",
    "academic_year_ambiguous": "Academic-year policy cannot be resolved unambiguously.",
    "subject_missing": "The requested subject is unavailable in the supplied context.",
    "subject_group_missing": "The subject's configured group is missing or unavailable.",
    "subject_group_mismatch": "The supplied subject/group configuration does not match its identity.",
    "passing_threshold_invalid": "The subject-group passing threshold must be a finite number from 0 to 100.",
    "general_average_threshold_missing": "The general-average passing-grade setting is missing.",
    "general_average_threshold_invalid": "The raw general-average passing-grade setting must be a finite number from 0 to 100.",
    "historical_threshold_snapshot_missing": "A non-live year requires an explicit finalized-policy snapshot; none was supplied.",
    "snapshot_scope_mismatch": "The snapshot does not match the requested year, scope or subject/group.",
    "snapshot_invalid": "The finalized-policy snapshot or its provenance is invalid.",
    "request_scope_invalid": "Supply a valid scope and exactly one subject or subject-group identity for subject scope.",
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
    """Validate database numerics, retaining Decimal precision without rounding."""
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
    """Parse the raw TEXT setting, never SettingsCache's parsed/default value.

    Accept ordinary decimal text (surrounding whitespace is harmless), not
    booleans, percentages, underscores, exponents, NaN, infinity or empty text.
    There is deliberately no fallback value or quantization.
    """
    if raw is None:
        raise PassingThresholdConfigurationError("general_average_threshold_missing")
    if type(raw) is not str or re.fullmatch(r"[+-]?(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)", raw.strip()) is None:
        raise PassingThresholdConfigurationError("general_average_threshold_invalid")
    try:
        value = Decimal(raw.strip())
    except InvalidOperation:
        raise PassingThresholdConfigurationError("general_average_threshold_invalid") from None
    return validate_passing_threshold(value, code="general_average_threshold_invalid")


@dataclass(frozen=True)
class SubjectThresholdConfig:
    subject_id: int
    subject_group_id: int | None


@dataclass(frozen=True)
class SubjectGroupThresholdConfig:
    subject_group_id: int
    passing_threshold: object
    is_active: bool


@dataclass(frozen=True)
class PassingThresholdSnapshot:
    """Future R2 persistence boundary; no ORM/table, completeness or write logic."""

    academic_year_id: int
    scope: ThresholdScope
    threshold: Decimal
    policy_version: str
    revision: int
    captured_at: datetime
    subject_id: int | None = None
    subject_group_id: int | None = None


@dataclass(frozen=True)
class PassingThresholdContext:
    academic_year_id: int
    active_academic_year_id: int | None
    policy_mode: PolicyMode
    subjects: Mapping[int, SubjectThresholdConfig]
    subject_groups: Mapping[int, SubjectGroupThresholdConfig]
    general_average_raw: object

    def __post_init__(self):
        # Freeze a copy, rather than holding mutable caller dictionaries.
        object.__setattr__(self, "subjects", MappingProxyType(dict(self.subjects)))
        object.__setattr__(self, "subject_groups", MappingProxyType(dict(self.subject_groups)))


@dataclass(frozen=True)
class PassingThresholdResolution:
    academic_year_id: int
    scope: ThresholdScope
    threshold: Decimal
    source: ThresholdSource
    subject_id: int | None = None
    subject_group_id: int | None = None
    policy_version: str | None = None
    revision: int | None = None
    captured_at: datetime | None = None


def _snapshot_resolution(snapshot, *, academic_year_id, scope, subject_id, subject_group_id):
    if not isinstance(snapshot, PassingThresholdSnapshot):
        raise PassingThresholdConfigurationError("snapshot_invalid")
    if (snapshot.academic_year_id != academic_year_id or type(snapshot.academic_year_id) is not int
            or snapshot.scope != scope):
        raise PassingThresholdConfigurationError("snapshot_scope_mismatch")
    if scope == "general_average":
        if snapshot.subject_id is not None or snapshot.subject_group_id is not None:
            raise PassingThresholdConfigurationError("snapshot_scope_mismatch")
    elif (not _positive_id(snapshot.subject_group_id)
          or (snapshot.subject_id is not None and not _positive_id(snapshot.subject_id))
          or (subject_id is not None and snapshot.subject_id != subject_id)
          or (subject_group_id is not None and snapshot.subject_group_id != subject_group_id)):
        raise PassingThresholdConfigurationError("snapshot_scope_mismatch")
    if (not isinstance(snapshot.threshold, Decimal) or not _positive_id(snapshot.revision)
            or type(snapshot.policy_version) is not str or not snapshot.policy_version.strip()
            or not isinstance(snapshot.captured_at, datetime)
            or snapshot.captured_at.tzinfo is None or snapshot.captured_at.utcoffset() is None):
        raise PassingThresholdConfigurationError("snapshot_invalid")
    value = validate_passing_threshold(snapshot.threshold, code="snapshot_invalid")
    return PassingThresholdResolution(
        academic_year_id=academic_year_id, scope=scope, threshold=value,
        source="finalized_snapshot", subject_id=snapshot.subject_id,
        subject_group_id=snapshot.subject_group_id, policy_version=snapshot.policy_version,
        revision=snapshot.revision, captured_at=snapshot.captured_at,
    )


def resolve_passing_threshold(
    context: PassingThresholdContext, *, academic_year_id: int, scope: ThresholdScope,
    subject_id: int | None = None, subject_group_id: int | None = None,
    result_snapshot: PassingThresholdSnapshot | None = None,
) -> PassingThresholdResolution:
    """Resolve one requested decision from an already authorized, bulk-read context.

    A supplied snapshot never authorizes live fallback. Non-live/future/unknown
    closure states require a snapshot. Live mode uses current configuration,
    even when a valid older snapshot accompanies an active-year result.
    Caller authorization and authoritative R2 freeze-marker loading are separate.
    """
    if not _positive_id(academic_year_id) or not _positive_id(context.academic_year_id):
        raise PassingThresholdConfigurationError("academic_year_missing")
    if (context.academic_year_id != academic_year_id or type(context.policy_mode) is not str
            or context.policy_mode not in {"live", "snapshot_required"}):
        raise PassingThresholdConfigurationError("academic_year_ambiguous")
    if type(scope) is not str or scope not in {"subject", "general_average"}:
        raise PassingThresholdConfigurationError("request_scope_invalid")
    if scope == "general_average":
        if subject_id is not None or subject_group_id is not None:
            raise PassingThresholdConfigurationError("request_scope_invalid")
    elif ((subject_id is None) == (subject_group_id is None)
          or (subject_id is not None and not _positive_id(subject_id))
          or (subject_group_id is not None and not _positive_id(subject_group_id))):
        raise PassingThresholdConfigurationError("request_scope_invalid")

    snapshot = None
    if result_snapshot is not None:
        snapshot = _snapshot_resolution(result_snapshot, academic_year_id=academic_year_id,
            scope=scope, subject_id=subject_id, subject_group_id=subject_group_id)
    if context.policy_mode == "snapshot_required":
        if snapshot is None:
            raise PassingThresholdConfigurationError("historical_threshold_snapshot_missing")
        return snapshot
    if context.active_academic_year_id != academic_year_id or not _positive_id(context.active_academic_year_id):
        raise PassingThresholdConfigurationError("academic_year_ambiguous")

    if scope == "general_average":
        return PassingThresholdResolution(academic_year_id=academic_year_id, scope=scope,
            threshold=parse_raw_general_average_threshold(context.general_average_raw),
            source="live_general_average_setting")
    if subject_id is not None:
        subject = context.subjects.get(subject_id)
        if subject is None:
            raise PassingThresholdConfigurationError("subject_missing")
        if subject.subject_id != subject_id or not _positive_id(subject.subject_id):
            raise PassingThresholdConfigurationError("subject_group_mismatch")
        subject_group_id = subject.subject_group_id
    if not _positive_id(subject_group_id):
        raise PassingThresholdConfigurationError("subject_group_missing")
    group = context.subject_groups.get(subject_group_id)
    if group is None:
        raise PassingThresholdConfigurationError("subject_group_missing")
    if group.subject_group_id != subject_group_id or not _positive_id(group.subject_group_id):
        raise PassingThresholdConfigurationError("subject_group_mismatch")
    return PassingThresholdResolution(academic_year_id=academic_year_id, scope=scope,
        threshold=validate_passing_threshold(group.passing_threshold),
        source="live_subject_group", subject_id=subject_id, subject_group_id=subject_group_id)


def compare_stored_final_grade(grade: Decimal | None, threshold: PassingThresholdResolution) -> bool | None:
    """Missing grade is unavailable, not failed. Numeric zero is valid evidence."""
    if grade is None:
        return None
    if not isinstance(grade, Decimal):
        raise PassingThresholdConfigurationError("final_grade_invalid")
    value = validate_passing_threshold(grade, code="final_grade_invalid")
    mark = validate_passing_threshold(threshold.threshold)
    return value >= mark

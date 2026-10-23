"""Audited administrator-only writes. No score or finalized-grade mutation."""

from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
import re
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.AcademicYearPassingPolicy import AcademicYearPassingPolicy, PassingPolicyAudit
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.settings.Setting import Setting
from app.services.grading.PassingThresholdResolver import (
    GENERAL_AVERAGE_SETTING_KEY, PassingThresholdConfigurationError,
    parse_raw_general_average_threshold, validate_passing_threshold,
)


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "message": message})


def _value(raw: str) -> Decimal:
    if type(raw) is not str or not re.fullmatch(r"(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)", raw.strip()):
        raise _error(422, "PASSING_THRESHOLD_INVALID", "Enter a finite numeric passing grade from 0 to 100 with at most two decimal places.")
    try:
        number = validate_passing_threshold(Decimal(raw.strip()))
    except (InvalidOperation, PassingThresholdConfigurationError):
        raise _error(422, "PASSING_THRESHOLD_INVALID", "Enter a finite numeric passing grade from 0 to 100 with at most two decimal places.") from None
    if number.as_tuple().exponent < -2:
        raise _error(422, "PASSING_THRESHOLD_PRECISION", "Passing grades support at most two decimal places.")
    return number.quantize(Decimal("0.01"))


def _reason(value: str) -> str:
    reason = value.strip() if type(value) is str else ""
    if not 5 <= len(reason) <= 1000:
        raise _error(422, "POLICY_REASON_REQUIRED", "Provide an audit reason of 5 to 1000 characters.")
    return reason


def _year(db: Session, year_id: int, *, lock: bool = False) -> AcademicYear:
    if type(year_id) is not int or year_id <= 0:
        raise _error(422, "ACADEMIC_YEAR_INVALID", "Select an academic year.")
    query = db.query(AcademicYear).filter(AcademicYear.academic_year_id == year_id)
    if lock:
        query = query.with_for_update()
    year = query.one_or_none()
    if year is None:
        raise _error(404, "ACADEMIC_YEAR_MISSING", "Academic year not found.")
    # This schema has no closed-year state. All existing years are open until PR 2.
    return year


def _policy_item(year: AcademicYear, policy: AcademicYearPassingPolicy | None) -> dict:
    return {
        "academic_year_id": year.academic_year_id,
        "year_label": year.year_label,
        "is_active": bool(year.is_active),
        "configured": policy is not None,
        "threshold": str(policy.general_average_threshold) if policy else None,
        "version": policy.version if policy else 0,
    }


def read_year_general_average_policy(db: Session, year_id: int) -> dict:
    with db.no_autoflush:
        year = _year(db, year_id)
        policy = db.get(AcademicYearPassingPolicy, year_id)
        result = _policy_item(year, policy)
        if policy is None:
            raw = db.query(Setting.value).filter(Setting.key == GENERAL_AVERAGE_SETTING_KEY).scalar()
            if raw is not None:
                try:
                    result["legacy_proposal"] = str(parse_raw_general_average_threshold(raw))
                except PassingThresholdConfigurationError:
                    result["legacy_proposal"] = None
                    result["legacy_error"] = "The legacy value is invalid; enter a confirmed value explicitly."
            else:
                result["legacy_proposal"] = None
        prior = db.query(AcademicYear).filter(
            AcademicYear.start_date < year.start_date,
        ).order_by(AcademicYear.start_date.desc(), AcademicYear.academic_year_id.desc()).first()
        result["previous_academic_year_id"] = prior.academic_year_id if prior else None
    return result


def _audit(db: Session, *, scope: str, year_id: int, template_id: int | None,
           action: str, old: Decimal | None, new: Decimal, actor: UUID,
           reason: str, revision: int, source_year_id: int | None = None,
           source_version: int | None = None) -> None:
    db.add(PassingPolicyAudit(
        policy_scope=scope, academic_year_id=year_id,
        grading_template_id=template_id, action=action,
        source_academic_year_id=source_year_id, source_version=source_version,
        old_threshold=old, new_threshold=new, revision=revision,
        actor_user_id=actor, reason=reason,
    ))


def edit_template_threshold(db: Session, *, template_id: int, year_id: int,
                            raw_threshold: str, expected_updated_at: datetime,
                            reason: str, actor: UUID) -> dict:
    from app.services.grading_templates.GradingTemplateShared import template_to_item
    from app.services.grading_templates.GradingTemplateService import _utc

    value = _value(raw_threshold)
    note = _reason(reason)
    _year(db, year_id, lock=True)
    template = db.query(GradingTemplate).filter(
        GradingTemplate.grading_template_id == template_id,
    ).with_for_update().one_or_none()
    if template is None:
        raise _error(404, "GRADING_TEMPLATE_MISSING", "Grading template not found.")
    if (not isinstance(expected_updated_at, datetime) or template.updated_at is None
            or _utc(expected_updated_at) != _utc(template.updated_at)):
        raise _error(409, "POLICY_VERSION_CONFLICT", "The template changed. Reload it before saving.")
    old = Decimal(str(template.passing_threshold))
    if old == value:
        raise _error(422, "POLICY_UNCHANGED", "Enter a different passing threshold.")
    # Subject-to-template assignment is global, not per year. Until PR 2 snapshots
    # exist, ANY finalized grade for an assigned subject must make edits ineligible.
    finalized = db.query(StudentPeriodGrade.period_grade_id).join(
        Subject, StudentPeriodGrade.subject_id == Subject.subject_id,
    ).filter(Subject.grading_template_id == template_id,
             StudentPeriodGrade.is_finalized.is_(True)).first()
    if finalized:
        raise _error(409, "FINALIZED_GRADE_PROTECTED", "This template has finalized grades; its passing threshold cannot be changed.")
    last_revision = db.query(func.max(PassingPolicyAudit.revision)).filter(
        PassingPolicyAudit.policy_scope == "template",
        PassingPolicyAudit.academic_year_id == year_id,
        PassingPolicyAudit.grading_template_id == template_id,
    ).scalar() or 0
    template.passing_threshold = value
    template.updated_at = datetime.now(timezone.utc)
    _audit(db, scope="template", year_id=year_id, template_id=template_id,
           action="edit", old=old, new=value, actor=actor,
           reason=note, revision=last_revision + 1)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _error(409, "POLICY_WRITE_CONFLICT", "Policy changed concurrently; reload and try again.") from exc
    return template_to_item(template, db)


def save_year_general_average_policy(
    db: Session, *, year_id: int, raw_threshold: str, expected_version: int,
    reason: str, actor: UUID, action: str, confirmed: bool,
    source_year_id: int | None = None,
) -> dict:
    if not confirmed:
        raise _error(422, "POLICY_CONFIRMATION_REQUIRED", "Confirm the policy action before saving.")
    value = _value(raw_threshold)
    note = _reason(reason)
    year = _year(db, year_id, lock=True)
    policy = db.query(AcademicYearPassingPolicy).filter(
        AcademicYearPassingPolicy.academic_year_id == year_id,
    ).with_for_update().one_or_none()
    current_version = policy.version if policy else 0
    if type(expected_version) is not int or expected_version != current_version:
        raise _error(409, "POLICY_VERSION_CONFLICT", "This policy changed. Reload it before saving.")
    if action not in {"confirm_legacy", "initialize_manual", "copy_previous", "edit"}:
        raise _error(422, "POLICY_ACTION_INVALID", "Choose a valid policy action.")
    if (action in {"confirm_legacy", "initialize_manual", "copy_previous"} and policy is not None
            or action == "edit" and policy is None):
        raise _error(409, "POLICY_STATE_CONFLICT", "This policy state changed. Reload it before saving.")
    if action == "initialize_manual":
        legacy = db.query(Setting.value).filter(
            Setting.key == GENERAL_AVERAGE_SETTING_KEY,
        ).with_for_update().scalar()
        if legacy is not None:
            try:
                parse_raw_general_average_threshold(legacy)
            except PassingThresholdConfigurationError:
                pass
            else:
                raise _error(409, "LEGACY_PROPOSAL_AVAILABLE", "Confirm the validated legacy proposal instead of manually initializing.")
    if action == "confirm_legacy":
        legacy = db.query(Setting.value).filter(Setting.key == GENERAL_AVERAGE_SETTING_KEY).scalar()
        if legacy is None:
            raise _error(422, "LEGACY_POLICY_MISSING", "No legacy value exists to confirm.")
        try:
            proposed = parse_raw_general_average_threshold(legacy)
        except PassingThresholdConfigurationError:
            raise _error(422, "LEGACY_POLICY_INVALID", "The legacy value is invalid.") from None
        if value != proposed:
            raise _error(409, "LEGACY_POLICY_CHANGED", "The legacy proposal changed. Reload it before confirming.")
    copy_source_version = None
    if action == "copy_previous":
        previous = db.query(AcademicYear).filter(
            AcademicYear.start_date < year.start_date,
        ).order_by(AcademicYear.start_date.desc(), AcademicYear.academic_year_id.desc()).first()
        if previous is None or previous.academic_year_id != source_year_id:
            raise _error(422, "PREVIOUS_YEAR_INVALID", "Select the immediately previous academic year.")
        source = db.query(AcademicYearPassingPolicy).filter(
            AcademicYearPassingPolicy.academic_year_id == source_year_id,
        ).with_for_update().one_or_none()
        if source is None or value != source.general_average_threshold:
            raise _error(409, "PREVIOUS_POLICY_CHANGED", "The previous year's policy is missing or changed. Reload it.")
        copy_source_version = source.version
    old = policy.general_average_threshold if policy else None
    if policy and old == value:
        raise _error(422, "POLICY_UNCHANGED", "Enter a different general-average passing grade.")
    if policy is None:
        policy = AcademicYearPassingPolicy(
            academic_year_id=year_id, general_average_threshold=value,
            version=1, updated_by=actor,
        )
        db.add(policy)
    else:
        policy.general_average_threshold = value
        policy.version += 1
        policy.updated_by = actor
        policy.updated_at = datetime.now(timezone.utc)
    _audit(db, scope="general_average", year_id=year_id, template_id=None,
           action=action, old=old, new=value, actor=actor,
           reason=note, revision=policy.version,
           source_year_id=source_year_id if action == "copy_previous" else None,
           source_version=copy_source_version)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise _error(409, "POLICY_WRITE_CONFLICT", "Policy changed concurrently; reload and try again.") from exc
    return _policy_item(year, policy)

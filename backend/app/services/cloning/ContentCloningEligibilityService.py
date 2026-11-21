"""Authoritative source eligibility policy for Repost classwork cloning."""

from __future__ import annotations

from sqlalchemy import and_, exists, func, or_
from sqlalchemy.orm import Session, selectinload

from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkAssignmentRecipient import (
    ClassworkAssignmentRecipient,
)
from app.services.classwork.ClassworkShared import READING_TYPE, is_reading_type
from app.services.cloning.ContentCloningErrors import ContentCloningError


BROAD_INTERVENTION_READING_SCOPES = frozenset({
    "ENTIRE_CLASS",
    "ALL_SUBJECT_STUDENTS",
})


def is_standard_classwork_assignment(assignment: ClassworkAssignment) -> bool:
    """Return True only for broad class-wide assignments without student/intervention targeting."""
    return (
        getattr(assignment, "recipient_student_id", None) is None
        and getattr(assignment, "source_intervention_id", None) is None
        and getattr(assignment, "remediation_request_id", None) is None
        and getattr(assignment, "original_exam_assignment_id", None) is None
        and not (getattr(assignment, "recipients", None) or [])
    )


def standard_classwork_assignments(classwork: Classwork) -> list[ClassworkAssignment]:
    """Return all eligible broad class-wide assignments on a classwork."""
    return [
        assignment
        for assignment in (getattr(classwork, "assignments", None) or [])
        if is_standard_classwork_assignment(assignment)
    ]


def resolve_standard_classwork_period_id(classwork: Classwork) -> int | None:
    """Resolve the single unambiguous academic period from broad standard assignments."""
    periods = {
        assignment.academic_period_id
        or (
            assignment.class_.academic_period_id
            if getattr(assignment, "class_", None) is not None
            else None
        )
        for assignment in standard_classwork_assignments(classwork)
    }
    periods.discard(None)
    return next(iter(periods)) if len(periods) == 1 else None


def has_eligible_classwork_scope(classwork: Classwork) -> bool:
    """Allow ordinary content without intervention scope; fail closed for intervention-origin content."""
    if classwork.intervention_resource_origin_id is None:
        return classwork.intervention_resource_recipient_scope is None
    return (
        is_reading_type(classwork.classwork_type)
        and not classwork.is_graded
        and classwork.intervention_resource_recipient_scope
        in BROAD_INTERVENTION_READING_SCOPES
    )


def is_classwork_repost_eligible(classwork: Classwork) -> bool:
    """Require both an eligible scope and at least one broad standard class-wide assignment."""
    if not has_eligible_classwork_scope(classwork):
        return False
    return bool(standard_classwork_assignments(classwork))


def standard_classwork_assignment_sql_filter():
    """SQL predicate matching `is_standard_classwork_assignment` for discovery queries."""
    has_student_recipients = exists().where(
        ClassworkAssignmentRecipient.classwork_assignment_id
        == ClassworkAssignment.classwork_assignment_id
    )
    return and_(
        ClassworkAssignment.recipient_student_id.is_(None),
        ClassworkAssignment.source_intervention_id.is_(None),
        ClassworkAssignment.remediation_request_id.is_(None),
        ClassworkAssignment.original_exam_assignment_id.is_(None),
        ~has_student_recipients,
    )


def classwork_repost_eligible_sql_filter():
    """SQL predicate matching `has_eligible_classwork_scope` for discovery queries."""
    return or_(
        and_(
            Classwork.intervention_resource_origin_id.is_(None),
            Classwork.intervention_resource_recipient_scope.is_(None),
        ),
        and_(
            Classwork.intervention_resource_origin_id.is_not(None),
            func.upper(func.trim(Classwork.classwork_type)) == READING_TYPE,
            Classwork.is_graded.is_(False),
            Classwork.intervention_resource_recipient_scope.in_(
                BROAD_INTERVENTION_READING_SCOPES
            ),
        ),
    )


def require_classwork_repost_eligible(classwork: Classwork | None) -> Classwork:
    if classwork is None or not is_classwork_repost_eligible(classwork):
        raise ContentCloningError(
            status_code=409,
            code="SOURCE_CONTENT_NOT_REPOST_ELIGIBLE",
            message=(
                "This material is private Study Support content or its saved "
                "recipient scope is no longer eligible for Repost."
            ),
            field="items",
        )
    return classwork


def require_repost_eligible_classworks(
    db: Session,
    source_entity_ids: set[int],
) -> None:
    """Lock, refresh, and revalidate saved scope and assignments immediately before graph creation."""
    if not source_entity_ids:
        return
    ordered_ids = sorted(source_entity_ids)
    query = (
        db.query(Classwork)
        .filter(Classwork.classwork_id.in_(ordered_ids))
        .order_by(Classwork.classwork_id.asc())
        .options(
            selectinload(Classwork.assignments).selectinload(
                ClassworkAssignment.recipients
            ),
        )
        .populate_existing()
    )
    bind = db.get_bind()
    if bind is not None and bind.dialect.name == "postgresql":
        query = query.with_for_update(read=True)
    rows = query.all()
    by_id = {row.classwork_id: row for row in rows}
    for source_id in ordered_ids:
        require_classwork_repost_eligible(by_id.get(source_id))

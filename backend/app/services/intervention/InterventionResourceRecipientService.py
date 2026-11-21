"""Recipient scope resolution and enforcement for Intervention support resources.

Learning resources added or created from an individual student's intervention
default strictly to that student (`THIS_STUDENT`), while allowing the teacher
to explicitly share the resource with:
  - `ENTIRE_CLASS`: all eligible students enrolled in the student's class/section
    for the intervention's subject and academic period.
  - `ALL_SUBJECT_STUDENTS`: all eligible students across every authorized active
    section the authenticated teacher handles for the same subject and period.

Sharing a learning resource grants access to the underlying `READING` classwork
only. It never creates intervention records, diagnoses, remediation activities,
or intervention notifications for other students.
"""

from __future__ import annotations

from typing import Literal

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkAssignmentRecipient import ClassworkAssignmentRecipient
from app.models.intervention.Intervention import Intervention
from app.services.academic.SubjectLoadAuthorizationService import (
    SubjectLoadAuthorizationService,
)
from app.services.academic.SubstitutionService import SubstitutionService
from app.services.classwork.ClassworkAccessService import assignment_allows_student
from app.services.classwork.ClassworkShared import ensure_class_targets, is_reading_type
from app.services.intervention.TeacherInterventionService import _require_scope

ResourceRecipientScope = Literal["THIS_STUDENT", "ENTIRE_CLASS", "ALL_SUBJECT_STUDENTS"]
RESOURCE_RECIPIENT_SCOPES: tuple[str, ...] = (
    "THIS_STUDENT",
    "ENTIRE_CLASS",
    "ALL_SUBJECT_STUDENTS",
)


def normalize_recipient_scope(
    value: str | None,
    *,
    default: ResourceRecipientScope = "THIS_STUDENT",
) -> ResourceRecipientScope:
    if value is None or not str(value).strip():
        return default
    normalized = str(value).strip().upper()
    if normalized not in RESOURCE_RECIPIENT_SCOPES:
        raise HTTPException(
            status_code=400,
            detail=(
                "Invalid recipient scope. Supported values are "
                "THIS_STUDENT, ENTIRE_CLASS, and ALL_SUBJECT_STUDENTS."
            ),
        )
    return normalized  # type: ignore[return-value]


def resolve_authorized_subject_classes(
    db: Session,
    staff_id: str,
    subject_id: int,
    academic_period_id: int,
) -> list[Class]:
    """Return active, non-archived classes this teacher is currently authorized to handle
    for the exact subject and academic period (including active substitutions and excluding
    loads temporarily delegated away to an active substitute)."""
    period = db.get(AcademicPeriod, academic_period_id)
    if period is None:
        return []

    rows = (
        db.query(SubjectLoad, Class)
        .join(Class, Class.class_id == SubjectLoad.class_id)
        .filter(
            SubjectLoad.subject_id == subject_id,
            SubjectLoad.academic_period_id == academic_period_id,
            SubjectLoad.is_active_version.is_(True),
            SubjectLoad.status.in_(["active", "published"]),
            Class.academic_year_id == period.academic_year_id,
        )
        .all()
    )

    by_class_id: dict[int, Class] = {}
    for load, class_obj in rows:
        if SubjectLoadAuthorizationService.is_class_archived(class_obj):
            continue
        substitution = SubstitutionService.get_active_substitution(db, load.subject_load_id)
        responsible = substitution.substitute_staff_id if substitution is not None else load.staff_id
        if responsible != staff_id:
            continue
        by_class_id[class_obj.class_id] = class_obj

    return sorted(
        by_class_id.values(),
        key=lambda c: ((c.section_name or "").lower(), c.class_id),
    )


def resolve_authorized_subject_class_ids(
    db: Session,
    staff_id: str,
    subject_id: int,
    academic_period_id: int,
) -> list[int]:
    return [
        class_obj.class_id
        for class_obj in resolve_authorized_subject_classes(
            db, staff_id, subject_id, academic_period_id
        )
    ]


def count_eligible_enrolled_students(
    db: Session,
    class_ids: list[int],
    academic_year_id: int,
) -> int:
    if not class_ids:
        return 0
    count = (
        db.query(func.count(func.distinct(StudentClass.student_id)))
        .filter(
            StudentClass.class_id.in_(class_ids),
            StudentClass.academic_year_id == academic_year_id,
            StudentClass.enrollment_status == "enrolled",
        )
        .scalar()
    )
    return int(count or 0)


def resolve_intervention_recipient_scopes(
    db: Session,
    staff_id: str,
    intervention: Intervention,
) -> dict:
    """Return recipient scope metadata and exact enrolled student counts for an intervention."""
    period = intervention.academic_period or db.get(AcademicPeriod, intervention.academic_period_id)
    class_obj = intervention.class_ or db.get(Class, intervention.class_id)
    subject_obj = intervention.subject or db.get(Subject, intervention.subject_id)
    academic_year_id = (
        period.academic_year_id
        if period is not None
        else (class_obj.academic_year_id if class_obj is not None else None)
    )

    authorized_classes = resolve_authorized_subject_classes(
        db, staff_id, intervention.subject_id, intervention.academic_period_id
    )
    if class_obj is not None and all(c.class_id != class_obj.class_id for c in authorized_classes):
        authorized_classes = sorted(
            [*authorized_classes, class_obj],
            key=lambda c: ((c.section_name or "").lower(), c.class_id),
        )

    subject_class_ids = [c.class_id for c in authorized_classes]
    class_student_count = (
        count_eligible_enrolled_students(db, [intervention.class_id], academic_year_id)
        if academic_year_id is not None
        else 0
    )
    subject_student_count = (
        count_eligible_enrolled_students(db, subject_class_ids, academic_year_id)
        if academic_year_id is not None
        else 0
    )

    student = intervention.student
    student_name = (
        " ".join(
            part
            for part in (
                student.first_name,
                student.middle_name,
                student.last_name,
                student.suffix,
            )
            if part
        )
        if student is not None
        else "Student"
    )
    class_name = (class_obj.section_name if class_obj else None) or f"Class #{intervention.class_id}"
    subject_name = (subject_obj.subject_name if subject_obj else None) or f"Subject #{intervention.subject_id}"

    return {
        "default_scope": "THIS_STUDENT",
        "this_student": {
            "scope": "THIS_STUDENT",
            "student_id": str(intervention.student_id),
            "student_name": student_name,
            "class_id": intervention.class_id,
            "class_name": class_name,
            "student_count": 1,
        },
        "entire_class": {
            "scope": "ENTIRE_CLASS",
            "class_id": intervention.class_id,
            "class_name": class_name,
            "student_count": class_student_count,
        },
        "all_subject_students": {
            "scope": "ALL_SUBJECT_STUDENTS",
            "subject_id": intervention.subject_id,
            "subject_name": subject_name,
            "class_ids": subject_class_ids,
            "class_names": [c.section_name or f"Class #{c.class_id}" for c in authorized_classes],
            "section_count": len(authorized_classes),
            "student_count": subject_student_count,
        },
    }


def describe_resource_recipient_scope(
    assignments: list[ClassworkAssignment],
    *,
    row: Intervention,
    authorized_subject_class_ids: set[int],
) -> str:
    """Classify a reading's current recipient visibility relative to an intervention."""
    period_assignments = [
        a for a in assignments if a.academic_period_id == row.academic_period_id
    ]
    if not period_assignments:
        return "UNASSIGNED"

    classwide_class_ids = {
        a.class_id
        for a in period_assignments
        if a.recipient_student_id is None and not (getattr(a, "recipients", None) or [])
    }
    if (
        len(authorized_subject_class_ids) > 1
        and authorized_subject_class_ids.issubset(classwide_class_ids)
    ):
        return "ALL_SUBJECT_STUDENTS"

    class_assignment = next(
        (a for a in period_assignments if a.class_id == row.class_id),
        None,
    )
    if class_assignment is not None:
        if class_assignment.recipient_student_id is None and not (
            getattr(class_assignment, "recipients", None) or []
        ):
            return "ENTIRE_CLASS"
        if assignment_allows_student(class_assignment, row.student_id):
            return "THIS_STUDENT"

    return "OTHER_RECIPIENTS"


def apply_resource_recipient_scope(
    db: Session,
    *,
    classwork: Classwork,
    intervention: Intervention,
    staff_id: str,
    scope: str | None,
    publish_override: bool | None = None,
    lock_date=None,
    require_active_intervention: bool = True,
) -> dict:
    """Apply recipient scope to a non-graded READING classwork inside an active intervention.

    Safeguards:
    - Never modifies `classwork.created_by_staff_id` or `classwork.is_published`.
    - Never narrows an existing classwide assignment when `THIS_STUDENT` is chosen.
    - Never duplicates `ClassworkAssignment` or `ClassworkAssignmentRecipient` rows.
    - Never creates intervention records for any other student.
    """
    resolved_scope = normalize_recipient_scope(scope, default="THIS_STUDENT")
    if not is_reading_type(classwork.classwork_type) or classwork.is_graded:
        raise HTTPException(
            status_code=400,
            detail="Recipient scope selection is only supported for non-graded reading resources",
        )
    if classwork.is_archived:
        raise HTTPException(status_code=400, detail="Cannot assign an archived reading resource")
    if classwork.subject_id != intervention.subject_id or classwork.created_by_staff_id != staff_id:
        raise HTTPException(
            status_code=403,
            detail="Reading resource is outside your authorized subject scope",
        )
    if require_active_intervention and intervention.status != "ACTIVE":
        raise HTTPException(status_code=404, detail="Active intervention not found")

    _require_scope(db, staff_id, intervention)

    # Persist only an explicit choice saved against the intervention that
    # originally created this reading. Attaching the reading to another
    # intervention must not broaden its authoritative Repost scope.
    if classwork.intervention_resource_origin_id == intervention.intervention_id:
        classwork.intervention_resource_recipient_scope = resolved_scope

    period = db.get(AcademicPeriod, intervention.academic_period_id)
    if period is None:
        raise HTTPException(status_code=400, detail="Academic period not found")

    enrolled = (
        db.query(StudentClass.student_class_id)
        .filter(
            StudentClass.student_id == intervention.student_id,
            StudentClass.class_id == intervention.class_id,
            StudentClass.academic_year_id == period.academic_year_id,
            StudentClass.enrollment_status == "enrolled",
        )
        .first()
    )
    if enrolled is None:
        raise HTTPException(
            status_code=400,
            detail="Target student is not enrolled in the intervention class for this term",
        )

    effective_published = (
        bool(classwork.is_published)
        if publish_override is None
        else bool(publish_override)
    )
    newly_classwide_published_class_ids: list[int] = []

    if resolved_scope == "THIS_STUDENT":
        ensure_class_targets(
            db,
            staff_id,
            intervention.subject_id,
            [intervention.class_id],
            intervention.academic_period_id,
        )
        existing = (
            db.query(ClassworkAssignment)
            .filter(
                ClassworkAssignment.classwork_id == classwork.classwork_id,
                ClassworkAssignment.class_id == intervention.class_id,
            )
            .first()
        )
        if existing is None:
            if effective_published:
                SubjectLoadAuthorizationService.assert_context_writable(
                    db,
                    class_id=intervention.class_id,
                    academic_period_id=intervention.academic_period_id,
                    block_future_period_in_current_year=True,
                )
            assignment = ClassworkAssignment(
                classwork_id=classwork.classwork_id,
                class_id=intervention.class_id,
                academic_period_id=intervention.academic_period_id,
                assigned_by_staff_id=staff_id,
                publish_date=None,
                due_date=None,
                lock_date=lock_date,
                allow_late_submissions=False,
                max_attempts=None,
                is_published=effective_published,
                recipient_student_id=None,
                source_intervention_id=None,
                remediation_request_id=None,
            )
            db.add(assignment)
            db.flush()
            db.add(
                ClassworkAssignmentRecipient(
                    classwork_assignment_id=assignment.classwork_assignment_id,
                    student_id=intervention.student_id,
                    assigned_by_staff_id=staff_id,
                )
            )
            db.flush()
            return {
                "scope": resolved_scope,
                "class_ids": [intervention.class_id],
                "newly_classwide_published_class_ids": [],
            }

        if existing.academic_period_id not in (None, intervention.academic_period_id):
            raise HTTPException(
                status_code=409,
                detail="This reading is already assigned to this class in a different academic period",
            )
        if existing.recipient_student_id is not None:
            if existing.recipient_student_id != intervention.student_id:
                raise HTTPException(
                    status_code=409,
                    detail="This reading assignment is restricted to another student",
                )
            return {
                "scope": resolved_scope,
                "class_ids": [intervention.class_id],
                "newly_classwide_published_class_ids": [],
            }

        existing_recipients = (
            db.query(ClassworkAssignmentRecipient)
            .filter(
                ClassworkAssignmentRecipient.classwork_assignment_id
                == existing.classwork_assignment_id
            )
            .all()
        )
        # Preserve existing classwide visibility (0 restriction rows => already visible to whole class).
        if not existing_recipients:
            return {
                "scope": resolved_scope,
                "class_ids": [intervention.class_id],
                "newly_classwide_published_class_ids": [],
            }

        already_assigned = any(
            r.student_id == intervention.student_id for r in existing_recipients
        )
        if not already_assigned:
            db.add(
                ClassworkAssignmentRecipient(
                    classwork_assignment_id=existing.classwork_assignment_id,
                    student_id=intervention.student_id,
                    assigned_by_staff_id=staff_id,
                )
            )
            db.flush()
        return {
            "scope": resolved_scope,
            "class_ids": [intervention.class_id],
            "newly_classwide_published_class_ids": [],
        }

    # ENTIRE_CLASS or ALL_SUBJECT_STUDENTS
    if resolved_scope == "ENTIRE_CLASS":
        target_class_ids = [intervention.class_id]
    else:
        target_class_ids = resolve_authorized_subject_class_ids(
            db, staff_id, intervention.subject_id, intervention.academic_period_id
        )
        if intervention.class_id not in target_class_ids:
            target_class_ids.append(intervention.class_id)

    ensure_class_targets(
        db,
        staff_id,
        intervention.subject_id,
        target_class_ids,
        intervention.academic_period_id,
    )

    for class_id in target_class_ids:
        existing = (
            db.query(ClassworkAssignment)
            .filter(
                ClassworkAssignment.classwork_id == classwork.classwork_id,
                ClassworkAssignment.class_id == class_id,
            )
            .first()
        )
        if existing is None:
            if effective_published:
                SubjectLoadAuthorizationService.assert_context_writable(
                    db,
                    class_id=class_id,
                    academic_period_id=intervention.academic_period_id,
                    block_future_period_in_current_year=True,
                )
            assignment = ClassworkAssignment(
                classwork_id=classwork.classwork_id,
                class_id=class_id,
                academic_period_id=intervention.academic_period_id,
                assigned_by_staff_id=staff_id,
                publish_date=None,
                due_date=None,
                lock_date=lock_date,
                allow_late_submissions=False,
                max_attempts=None,
                is_published=effective_published,
                recipient_student_id=None,
                source_intervention_id=None,
                remediation_request_id=None,
            )
            db.add(assignment)
            if effective_published:
                newly_classwide_published_class_ids.append(class_id)
            continue

        if existing.academic_period_id not in (None, intervention.academic_period_id):
            if class_id == intervention.class_id:
                raise HTTPException(
                    status_code=409,
                    detail="This reading is already assigned to this class in a different academic period",
                )
            continue

        if existing.recipient_student_id is not None:
            continue

        existing_recipients = (
            db.query(ClassworkAssignmentRecipient)
            .filter(
                ClassworkAssignmentRecipient.classwork_assignment_id
                == existing.classwork_assignment_id
            )
            .all()
        )
        if existing_recipients:
            # Promote student-restricted assignment to classwide by clearing restriction rows.
            for recipient_row in existing_recipients:
                db.delete(recipient_row)
            if existing.is_published and classwork.is_published:
                newly_classwide_published_class_ids.append(class_id)

    db.flush()
    return {
        "scope": resolved_scope,
        "class_ids": target_class_ids,
        "newly_classwide_published_class_ids": newly_classwide_published_class_ids,
    }


def replace_intervention_resource_recipient_scope(
    db: Session,
    *,
    classwork: Classwork,
    intervention: Intervention,
    staff_id: str,
    scope: str,
) -> dict:
    """Replace the audience of an intervention-created reading atomically.

    Assignments outside the new audience are removed only when they have no
    submission history. This keeps explicit audience reductions enforceable
    without deleting historical student work.
    """
    if classwork.intervention_resource_origin_id != intervention.intervention_id:
        raise HTTPException(
            status_code=400,
            detail="Recipient scope can only be edited for the intervention that created this reading",
        )

    resolved_scope = normalize_recipient_scope(scope)
    result = apply_resource_recipient_scope(
        db,
        classwork=classwork,
        intervention=intervention,
        staff_id=staff_id,
        scope=resolved_scope,
        require_active_intervention=False,
    )
    target_class_ids = set(result["class_ids"])
    period_assignments = (
        db.query(ClassworkAssignment)
        .filter(
            ClassworkAssignment.classwork_id == classwork.classwork_id,
            ClassworkAssignment.academic_period_id == intervention.academic_period_id,
        )
        .all()
    )

    for assignment in period_assignments:
        if assignment.class_id not in target_class_ids:
            if getattr(assignment, "submissions", None):
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "This audience cannot be reduced because a student has existing "
                        "activity history for a section that would lose access."
                    ),
                )
            db.delete(assignment)
            continue

        assignment.recipient_student_id = None
        recipients = (
            db.query(ClassworkAssignmentRecipient)
            .filter(
                ClassworkAssignmentRecipient.classwork_assignment_id
                == assignment.classwork_assignment_id
            )
            .all()
        )
        should_restrict = (
            resolved_scope == "THIS_STUDENT"
            and assignment.class_id == intervention.class_id
        )
        for recipient in recipients:
            if not should_restrict or recipient.student_id != intervention.student_id:
                db.delete(recipient)
        if should_restrict and not any(
            recipient.student_id == intervention.student_id for recipient in recipients
        ):
            db.add(
                ClassworkAssignmentRecipient(
                    classwork_assignment_id=assignment.classwork_assignment_id,
                    student_id=intervention.student_id,
                    assigned_by_staff_id=staff_id,
                )
            )

    db.flush()
    return result


def get_intervention_resource_recipient_context(
    db: Session,
    *,
    classwork_id: int,
    staff_id: str,
) -> dict:
    classwork = db.get(Classwork, classwork_id)
    if classwork is None or classwork.created_by_staff_id != staff_id:
        raise HTTPException(status_code=404, detail="Classwork not found or not yours")
    if (
        not is_reading_type(classwork.classwork_type)
        or classwork.intervention_resource_origin_id is None
    ):
        raise HTTPException(
            status_code=404,
            detail="Study Support recipient settings are not available for this classwork",
        )
    intervention = db.get(
        Intervention, classwork.intervention_resource_origin_id
    )
    if intervention is None:
        raise HTTPException(
            status_code=409,
            detail="The Study Support origin for this reading is no longer available",
        )
    _require_scope(db, staff_id, intervention)
    return {
        "origin_intervention_id": intervention.intervention_id,
        "current_scope": classwork.intervention_resource_recipient_scope or "UNASSIGNED",
        "recipient_scopes": resolve_intervention_recipient_scopes(
            db, staff_id, intervention
        ),
    }

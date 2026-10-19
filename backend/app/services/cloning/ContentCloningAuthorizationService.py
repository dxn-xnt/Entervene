from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, aliased

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.SubjectOffering import SubjectOffering
from app.models.academic.SubjectOfferingPathway import SubjectOfferingPathway
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.people.AcademicStaff import AcademicStaff
from app.services.cloning.ContentCloningErrors import ContentCloningError


@dataclass(frozen=True)
class SourceScope:
    mode: str
    key: str
    academic_year_id: int | None
    academic_period_id: int | None


@dataclass(frozen=True)
class DestinationScope:
    class_id: int
    section_name: str
    subject_id: int
    subject_name: str
    academic_period_id: int
    period_name: str
    academic_year_id: int
    academic_year_label: str
    year_state: str


@dataclass(frozen=True)
class SourceTeacher:
    staff_id: str
    display_name: str


class ContentCloningAuthorizationService:
    LOAD_STATUSES = ("active", "published")

    @classmethod
    def list_destination_scopes(
        cls,
        db: Session,
        *,
        actor_staff_id: str,
    ) -> list[DestinationScope]:
        active_years = (
            db.query(AcademicYear)
            .filter(AcademicYear.is_active.is_(True))
            .limit(2)
            .all()
        )
        if len(active_years) != 1:
            raise ContentCloningError(
                status_code=409,
                code="ACADEMIC_YEAR_STATE_AMBIGUOUS",
                message="Destination academic-year configuration is ambiguous.",
            )
        active_year = active_years[0]

        rows = (
            db.query(Class, Subject, AcademicPeriod, AcademicYear, SubjectOffering)
            .join(SubjectLoad, SubjectLoad.class_id == Class.class_id)
            .join(Subject, Subject.subject_id == SubjectLoad.subject_id)
            .join(
                AcademicPeriod,
                AcademicPeriod.academic_period_id == SubjectLoad.academic_period_id,
            )
            .join(
                AcademicYear,
                AcademicYear.academic_year_id == AcademicPeriod.academic_year_id,
            )
            .join(
                SubjectOffering,
                (SubjectOffering.subject_id == Subject.subject_id)
                & (SubjectOffering.academic_year_id == AcademicYear.academic_year_id)
                & (SubjectOffering.academic_level_id == Class.academic_level_id)
                & (SubjectOffering.academic_period_id == AcademicPeriod.academic_period_id),
            )
            .filter(
                SubjectLoad.staff_id == actor_staff_id,
                SubjectLoad.is_active_version.is_(True),
                func.lower(SubjectLoad.status).in_(cls.LOAD_STATUSES),
                Class.academic_year_id == AcademicYear.academic_year_id,
                or_(
                    Class.academic_period_id.is_(None),
                    Class.academic_period_id == AcademicPeriod.academic_period_id,
                ),
                func.lower(Class.class_status) == "active",
                func.lower(Subject.status) == "active",
                func.lower(SubjectOffering.status) == "active",
            )
            .order_by(
                AcademicYear.start_date,
                AcademicPeriod.period_sequence,
                func.lower(Class.section_name),
                func.lower(Subject.subject_name),
            )
            .all()
        )
        offering_ids = {offering.subject_offering_id for *_, offering in rows}
        pathway_map: dict[int, set[int]] = {}
        if offering_ids:
            for offering_id, pathway_id in (
                db.query(
                    SubjectOfferingPathway.subject_offering_id,
                    SubjectOfferingPathway.pathway_id,
                )
                .filter(
                    SubjectOfferingPathway.subject_offering_id.in_(offering_ids)
                )
                .all()
            ):
                pathway_map.setdefault(offering_id, set()).add(pathway_id)

        scopes: list[DestinationScope] = []
        seen: set[tuple[int, int, int]] = set()
        for destination_class, subject, period, year, offering in rows:
            allowed_pathways = pathway_map.get(offering.subject_offering_id, set())
            if allowed_pathways and (
                destination_class.pathway_id is None
                or destination_class.pathway_id not in allowed_pathways
            ):
                continue
            year_state = cls._destination_year_state(
                year=year,
                period=period,
                active_year=active_year,
            )
            if year_state is None:
                continue
            key = (
                destination_class.class_id,
                subject.subject_id,
                period.academic_period_id,
            )
            if key in seen:
                continue
            seen.add(key)
            scopes.append(
                DestinationScope(
                    class_id=destination_class.class_id,
                    section_name=destination_class.section_name,
                    subject_id=subject.subject_id,
                    subject_name=subject.subject_name,
                    academic_period_id=period.academic_period_id,
                    period_name=period.period_name,
                    academic_year_id=year.academic_year_id,
                    academic_year_label=year.year_label,
                    year_state=year_state,
                )
            )
        return scopes

    @staticmethod
    def _destination_year_state(
        *,
        year: AcademicYear,
        period: AcademicPeriod,
        active_year: AcademicYear,
    ) -> str | None:
        if year.academic_year_id == active_year.academic_year_id:
            return "ACTIVE"
        if (
            year.is_active is False
            and year.start_date > active_year.end_date
            and period.start_date >= year.start_date
            and period.end_date <= year.end_date
        ):
            return "PREPARED_FUTURE"
        return None

    @staticmethod
    def resolve_source_scope(
        db: Session,
        *,
        mode: str,
        academic_year_id: int | None,
        academic_period_id: int | None,
    ) -> SourceScope:
        normalized = (mode or "").strip().upper()
        valid_shape = (
            (normalized == "ANY" and academic_year_id is None and academic_period_id is None)
            or (
                normalized == "ALL_TERMS"
                and academic_year_id is not None
                and academic_period_id is None
            )
            or (
                normalized == "PERIOD"
                and academic_year_id is not None
                and academic_period_id is not None
            )
        )
        if not valid_shape:
            raise ContentCloningError(
                status_code=422,
                code="SOURCE_FILTER_INVALID",
                message="The source academic-year and term filters are inconsistent.",
                field="source_scope",
            )

        if normalized == "ANY":
            return SourceScope("ANY", "ANY", None, None)

        year = db.get(AcademicYear, academic_year_id)
        if year is None:
            raise ContentCloningError(
                status_code=422,
                code="SOURCE_FILTER_INVALID",
                message="The selected source academic year does not exist.",
                field="source_academic_year_id",
            )
        if normalized == "ALL_TERMS":
            return SourceScope(
                "ALL_TERMS",
                f"YEAR:{academic_year_id}",
                academic_year_id,
                None,
            )

        period = db.get(AcademicPeriod, academic_period_id)
        if period is None or period.academic_year_id != academic_year_id:
            raise ContentCloningError(
                status_code=422,
                code="SOURCE_FILTER_INVALID",
                message="The selected source term does not belong to the selected academic year.",
                field="source_academic_period_id",
            )
        return SourceScope(
            "PERIOD",
            f"PERIOD:{academic_period_id}",
            academic_year_id,
            academic_period_id,
        )

    @classmethod
    def resolve_destination(
        cls,
        db: Session,
        *,
        actor_staff_id: str,
        class_id: int,
        subject_id: int,
        academic_period_id: int,
    ) -> DestinationScope:
        row = (
            db.query(Class, Subject, AcademicPeriod, AcademicYear, SubjectOffering)
            .select_from(Class)
            .join(AcademicPeriod, AcademicPeriod.academic_period_id == academic_period_id)
            .join(AcademicYear, AcademicYear.academic_year_id == AcademicPeriod.academic_year_id)
            .join(Subject, Subject.subject_id == subject_id)
            .join(
                SubjectLoad,
                (SubjectLoad.class_id == Class.class_id)
                & (SubjectLoad.subject_id == Subject.subject_id)
                & (SubjectLoad.academic_period_id == AcademicPeriod.academic_period_id),
            )
            .join(
                SubjectOffering,
                (SubjectOffering.subject_id == Subject.subject_id)
                & (SubjectOffering.academic_year_id == AcademicYear.academic_year_id)
                & (SubjectOffering.academic_level_id == Class.academic_level_id)
                & (SubjectOffering.academic_period_id == AcademicPeriod.academic_period_id),
            )
            .filter(
                Class.class_id == class_id,
                Class.academic_year_id == AcademicYear.academic_year_id,
                or_(
                    Class.academic_period_id.is_(None),
                    Class.academic_period_id == AcademicPeriod.academic_period_id,
                ),
                func.lower(Class.class_status) == "active",
                func.lower(Subject.status) == "active",
                SubjectLoad.staff_id == actor_staff_id,
                SubjectLoad.is_active_version.is_(True),
                func.lower(SubjectLoad.status).in_(cls.LOAD_STATUSES),
                func.lower(SubjectOffering.status) == "active",
            )
            .first()
        )
        if row is None:
            raise ContentCloningError(
                status_code=404,
                code="DESTINATION_SCOPE_FORBIDDEN",
                message="The destination was not found or is not assigned to this teacher.",
            )

        destination_class, subject, period, year, offering = row
        pathway_ids = {
            value
            for (value,) in (
                db.query(SubjectOfferingPathway.pathway_id)
                .filter(
                    SubjectOfferingPathway.subject_offering_id
                    == offering.subject_offering_id
                )
                .all()
            )
        }
        if pathway_ids and (
            destination_class.pathway_id is None
            or destination_class.pathway_id not in pathway_ids
        ):
            raise ContentCloningError(
                status_code=404,
                code="DESTINATION_SCOPE_FORBIDDEN",
                message="The destination offering does not apply to this class pathway.",
            )

        active_years = (
            db.query(AcademicYear)
            .filter(AcademicYear.is_active.is_(True))
            .limit(2)
            .all()
        )
        if len(active_years) != 1:
            raise ContentCloningError(
                status_code=409,
                code="ACADEMIC_YEAR_STATE_AMBIGUOUS",
                message="Destination academic-year configuration is ambiguous.",
            )

        active_year = active_years[0]
        year_state = cls._destination_year_state(
            year=year,
            period=period,
            active_year=active_year,
        )
        if year_state is None:
            raise ContentCloningError(
                status_code=409,
                code="DESTINATION_YEAR_INACTIVE",
                message="The destination academic year is not active or safely prepared for future use.",
            )

        return DestinationScope(
            class_id=destination_class.class_id,
            section_name=destination_class.section_name,
            subject_id=subject.subject_id,
            subject_name=subject.subject_name,
            academic_period_id=period.academic_period_id,
            period_name=period.period_name,
            academic_year_id=year.academic_year_id,
            academic_year_label=year.year_label,
            year_state=year_state,
        )

    @staticmethod
    def _apply_source_period_filter(query, scope: SourceScope, destination_period: AcademicPeriod):
        query = query.filter(
            AcademicPeriod.end_date < destination_period.start_date,
            AcademicPeriod.academic_year_id.is_not(None),
        )
        if scope.mode == "ALL_TERMS":
            query = query.filter(
                AcademicPeriod.academic_year_id == scope.academic_year_id
            )
        elif scope.mode == "PERIOD":
            query = query.filter(
                AcademicPeriod.academic_period_id == scope.academic_period_id
            )
        return query

    @classmethod
    def list_source_teachers(
        cls,
        db: Session,
        *,
        requester_staff_id: str,
        subject_id: int,
        destination_period_id: int,
        scope: SourceScope,
    ) -> list[SourceTeacher]:
        destination_period = db.get(AcademicPeriod, destination_period_id)
        if destination_period is None:
            raise ContentCloningError(
                status_code=404,
                code="DESTINATION_SCOPE_FORBIDDEN",
                message="The destination term was not found.",
            )

        owner_period_pairs: set[tuple[str, int]] = set()

        competency_query = (
            db.query(
                Competency.created_by_staff_id,
                AcademicPeriod.academic_period_id,
            )
            .join(
                AcademicPeriod,
                AcademicPeriod.academic_period_id == Competency.academic_period_id,
            )
            .filter(
                Competency.subject_id == subject_id,
                Competency.created_by_staff_id.is_not(None),
            )
        )
        competency_query = cls._apply_source_period_filter(
            competency_query, scope, destination_period
        )
        owner_period_pairs.update(competency_query.distinct().all())

        lesson_query = (
            db.query(
                Lesson.created_by_staff_id,
                AcademicPeriod.academic_period_id,
            )
            .join(Competency, Competency.competency_id == Lesson.competency_id)
            .join(
                AcademicPeriod,
                AcademicPeriod.academic_period_id == Competency.academic_period_id,
            )
            .filter(
                Lesson.subject_id == subject_id,
                Lesson.created_by_staff_id.is_not(None),
            )
        )
        lesson_query = cls._apply_source_period_filter(
            lesson_query, scope, destination_period
        )
        owner_period_pairs.update(lesson_query.distinct().all())

        lesson_assignment_query = (
            db.query(
                Lesson.created_by_staff_id,
                AcademicPeriod.academic_period_id,
            )
            .join(LessonAssignment, LessonAssignment.lesson_id == Lesson.lesson_id)
            .join(Class, Class.class_id == LessonAssignment.class_id)
            .join(
                AcademicPeriod,
                AcademicPeriod.academic_period_id == Class.academic_period_id,
            )
            .filter(
                Lesson.subject_id == subject_id,
                Lesson.created_by_staff_id.is_not(None),
                Class.academic_period_id.is_not(None),
            )
        )
        lesson_assignment_query = cls._apply_source_period_filter(
            lesson_assignment_query, scope, destination_period
        )
        owner_period_pairs.update(lesson_assignment_query.distinct().all())

        classwork_query = (
            db.query(
                Classwork.created_by_staff_id,
                AcademicPeriod.academic_period_id,
            )
            .join(
                ClassworkAssignment,
                ClassworkAssignment.classwork_id == Classwork.classwork_id,
            )
            .join(
                AcademicPeriod,
                AcademicPeriod.academic_period_id
                == ClassworkAssignment.academic_period_id,
            )
            .filter(
                Classwork.subject_id == subject_id,
                ClassworkAssignment.academic_period_id.is_not(None),
            )
        )
        classwork_query = cls._apply_source_period_filter(
            classwork_query, scope, destination_period
        )
        owner_period_pairs.update(classwork_query.distinct().all())

        primary_load_query = (
            db.query(
                SubjectLoad.staff_id,
                AcademicPeriod.academic_period_id,
            )
            .join(
                AcademicPeriod,
                AcademicPeriod.academic_period_id == SubjectLoad.academic_period_id,
            )
            .join(Class, Class.class_id == SubjectLoad.class_id)
            .join(
                SubjectOffering,
                (SubjectOffering.subject_id == SubjectLoad.subject_id)
                & (
                    SubjectOffering.academic_year_id
                    == AcademicPeriod.academic_year_id
                )
                & (
                    SubjectOffering.academic_level_id
                    == Class.academic_level_id
                )
                & (
                    SubjectOffering.academic_period_id
                    == AcademicPeriod.academic_period_id
                ),
            )
            .filter(
                SubjectLoad.subject_id == subject_id,
                SubjectLoad.staff_id.is_not(None),
                SubjectLoad.is_active_version.is_(True),
                func.lower(SubjectLoad.status).in_(cls.LOAD_STATUSES),
                Class.academic_year_id == AcademicPeriod.academic_year_id,
                func.lower(SubjectOffering.status).in_(("active", "archived")),
            )
        )
        primary_load_query = cls._apply_source_period_filter(
            primary_load_query, scope, destination_period
        )
        primary_owner_period_pairs = set(primary_load_query.distinct().all())
        owner_ids = {
            owner_id
            for owner_id, period_id in owner_period_pairs
            if (owner_id, period_id) in primary_owner_period_pairs
        }
        owner_ids.discard(requester_staff_id)
        if not owner_ids:
            return []

        rows = (
            db.query(AcademicStaff)
            .join(UserAccount, UserAccount.user_id == AcademicStaff.user_id)
            .join(UserRoles, UserRoles.user_id == UserAccount.user_id)
            .join(Role, Role.role_id == UserRoles.role_id)
            .filter(
                AcademicStaff.staff_id.in_(owner_ids),
                func.lower(UserAccount.account_status) == "active",
                func.lower(Role.role_name) == "teacher",
            )
            .order_by(
                func.lower(AcademicStaff.last_name),
                func.lower(AcademicStaff.first_name),
                AcademicStaff.staff_id,
            )
            .all()
        )
        return [
            SourceTeacher(
                staff_id=staff.staff_id,
                display_name=" ".join(
                    value
                    for value in (
                        staff.first_name,
                        staff.middle_name,
                        staff.last_name,
                        staff.suffix,
                    )
                    if value
                ),
            )
            for staff in rows
        ]

    @classmethod
    def require_source_teacher(
        cls,
        db: Session,
        *,
        requester_staff_id: str,
        source_owner_staff_id: str,
        subject_id: int,
        destination_period_id: int,
        scope: SourceScope,
    ) -> SourceTeacher:
        for teacher in cls.list_source_teachers(
            db,
            requester_staff_id=requester_staff_id,
            subject_id=subject_id,
            destination_period_id=destination_period_id,
            scope=scope,
        ):
            if teacher.staff_id == source_owner_staff_id:
                return teacher
        raise ContentCloningError(
            status_code=404,
            code="SOURCE_OWNER_NOT_ELIGIBLE",
            message="The source teacher was not found or has no eligible owned content in this scope.",
        )

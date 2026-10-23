from typing import Optional
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.Class_ import Class
from app.models.people.AcademicStaff import AcademicStaff
from app.schemas.Competency import (
    CompetencyCreate,
    CompetencyResponse,
    CompetencyTreeNode,
    CompetencyUpdate,
    SubjectHierarchyTreeResponse,
)
from app.services.lesson.LessonResponseService import build_lesson_response
from app.services.academic.ContentAuthorizationService import authorize_teacher_content, resolve_content_staff_id


def build_competency_response(competency: Competency, db: Session) -> CompetencyResponse:
    subject = db.query(Subject).filter(Subject.subject_id == competency.subject_id).first()
    period = db.query(AcademicPeriod).filter(AcademicPeriod.academic_period_id == competency.academic_period_id).first() if competency.academic_period_id else None
    staff = db.query(AcademicStaff).filter(AcademicStaff.staff_id == competency.created_by_staff_id).first() if competency.created_by_staff_id else None

    # Count active linked lessons
    lesson_count = len([lesson for lesson in (competency.lessons or []) if not lesson.is_archived])

    return CompetencyResponse(
        competency_id=competency.competency_id,
        competency_code=competency.competency_code,
        statement=competency.statement,
        description=competency.description,
        order_index=competency.order_index,
        target_hours=competency.target_hours or 0,
        is_archived=competency.is_archived,
        subject_id=competency.subject_id,
        subject_name=subject.subject_name if subject else None,
        academic_period_id=competency.academic_period_id,
        period_name=period.period_name if period else None,
        created_by_staff_id=competency.created_by_staff_id,
        teacher_name=f"{staff.first_name} {staff.last_name}" if staff else None,
        lesson_count=lesson_count,
        created_at=competency.created_at,
        updated_at=competency.updated_at,
    )


def create_competency_record(body: CompetencyCreate, staff_id: Optional[str], db: Session) -> CompetencyResponse:
    subject = db.query(Subject).filter(Subject.subject_id == body.subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    competency = Competency(
        competency_code=body.competency_code,
        statement=body.statement,
        description=body.description,
        order_index=body.order_index or 1,
        target_hours=body.target_hours or 0,
        subject_id=body.subject_id,
        academic_period_id=body.academic_period_id,
        created_by_staff_id=staff_id,
        is_archived=False,
    )
    db.add(competency)
    db.commit()
    db.refresh(competency)
    return build_competency_response(competency, db)


def get_competency_detail(competency_id: int, current_user: dict, db: Session) -> CompetencyResponse:
    competency = db.query(Competency).filter(Competency.competency_id == competency_id).first()
    if not competency:
        raise HTTPException(status_code=404, detail="Competency not found")

    role = current_user.get("role")

    if role == "admin":
        return build_competency_response(competency, db)

    if role == "teacher":
        def read_scopes():
            query = (
                db.query(LessonAssignment.class_id, AcademicPeriod.academic_period_id)
                .join(Lesson, Lesson.lesson_id == LessonAssignment.lesson_id)
                .join(Class, Class.class_id == LessonAssignment.class_id)
                .join(AcademicPeriod, AcademicPeriod.academic_year_id == Class.academic_year_id)
                .filter(
                    Lesson.competency_id == competency.competency_id,
                    Lesson.subject_id == competency.subject_id,
                    Lesson.is_archived.is_(False),
                )
            )
            if competency.academic_period_id is not None:
                query = query.filter(AcademicPeriod.academic_period_id == competency.academic_period_id)
            for class_id, period_id in query.all():
                yield class_id, competency.subject_id, period_id
        authorize_teacher_content(
            db, staff_id=resolve_content_staff_id(db, current_user),
            owner_staff_id=competency.created_by_staff_id, detail="Competency not found",
            read_scopes=read_scopes(),
        )
        return build_competency_response(competency, db)

    # Note: Student access is not permitted directly via this endpoint as students consume
    # competencies via published lessons (LessonResponse.competency_* fields).
    raise HTTPException(status_code=403, detail="You do not have permission to view this competency")


def list_subject_competencies(
    subject_id: int,
    db: Session,
    staff_id: Optional[str] = None,
    is_admin: bool = False,
    period_id: Optional[int] = None,
    include_archived: bool = False,
) -> list[CompetencyResponse]:
    # Non-admin requests without a resolved staff_id return [] immediately (never leak other teachers' data)
    if not is_admin and not staff_id:
        return []

    query = db.query(Competency).filter(Competency.subject_id == subject_id)
    if staff_id is not None:
        query = query.filter(Competency.created_by_staff_id == staff_id)
    elif not is_admin:
        return []

    if not include_archived:
        query = query.filter(Competency.is_archived == False)
    if period_id is not None:
        query = query.filter(Competency.academic_period_id == period_id)
    
    competencies = query.order_by(Competency.order_index.asc(), Competency.created_at.asc()).all()
    return [build_competency_response(c, db) for c in competencies]


def list_student_published_competencies(
    *, subject_id: int, student_id, db: Session, period_id: int | None = None,
) -> list[CompetencyResponse]:
    """Student discovery only follows enrolled, published lesson assignments."""
    query = (
        db.query(Competency)
        .join(Lesson, Lesson.competency_id == Competency.competency_id)
        .join(LessonAssignment, LessonAssignment.lesson_id == Lesson.lesson_id)
        .join(StudentClass, StudentClass.class_id == LessonAssignment.class_id)
        .filter(
            Competency.subject_id == subject_id,
            Competency.is_archived.is_(False),
            Lesson.is_archived.is_(False),
            Lesson.is_published.is_(True),
            Lesson.is_locked.is_(False),
            LessonAssignment.is_published.is_(True),
            StudentClass.student_id == student_id,
            StudentClass.enrollment_status == "enrolled",
        )
    )
    if period_id is not None:
        query = query.filter(Competency.academic_period_id == period_id)
    visible = {}
    for competency, lesson_id in query.with_entities(
        Competency, Lesson.lesson_id
    ).distinct().order_by(
        Competency.order_index, Competency.competency_id
    ).all():
        _, lesson_ids = visible.setdefault(
            competency.competency_id, (competency, set())
        )
        lesson_ids.add(lesson_id)
    return [
        build_competency_response(item, db).model_copy(
            update={"lesson_count": len(lesson_ids)}
        )
        for item, lesson_ids in visible.values()
    ]


def update_competency_record(
    competency_id: int,
    body: CompetencyUpdate,
    staff_id: Optional[str],
    is_admin: bool,
    db: Session,
) -> CompetencyResponse:
    competency = db.query(Competency).filter(Competency.competency_id == competency_id).first()
    if not competency:
        raise HTTPException(status_code=404, detail="Competency not found")

    if not is_admin:
        authorize_teacher_content(
            db, staff_id=staff_id, owner_staff_id=competency.created_by_staff_id,
            detail="Competency not found", owner_only=True,
        )

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(competency, field, value)

    db.commit()
    db.refresh(competency)
    return build_competency_response(competency, db)


def archive_competency_record(
    competency_id: int,
    staff_id: Optional[str],
    is_admin: bool,
    db: Session,
) -> dict:
    competency = db.query(Competency).filter(Competency.competency_id == competency_id).first()
    if not competency:
        raise HTTPException(status_code=404, detail="Competency not found")

    if not is_admin:
        authorize_teacher_content(
            db, staff_id=staff_id, owner_staff_id=competency.created_by_staff_id,
            detail="Competency not found", owner_only=True,
        )

    competency.is_archived = True
    db.commit()
    return {"message": "Competency archived", "competency_id": competency_id, "is_archived": True}


def get_subject_hierarchy_tree(
    subject_id: int,
    db: Session,
    staff_id: Optional[str] = None,
    is_admin: bool = False,
    class_id: Optional[int] = None,
    period_id: Optional[int] = None,
    student_id=None,
) -> SubjectHierarchyTreeResponse:
    """Build the Competency -> Lesson -> Classwork hierarchy tree."""
    subject = db.query(Subject).filter(Subject.subject_id == subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    if student_id is not None:
        if class_id is None or not db.query(StudentClass).filter(
            StudentClass.student_id == student_id,
            StudentClass.class_id == class_id,
            StudentClass.enrollment_status == "enrolled",
        ).first():
            raise HTTPException(status_code=403, detail="Class access denied")

    target_staff_id = staff_id
    if target_staff_id is None and class_id is not None:
        from sqlalchemy import func
        load = db.query(SubjectLoad).filter(
            SubjectLoad.class_id == class_id,
            SubjectLoad.subject_id == subject_id,
            func.coalesce(SubjectLoad.is_active_version, True).is_(True),
            func.coalesce(SubjectLoad.status, "active") != "archived",
        ).first()
        if load and load.staff_id:
            target_staff_id = load.staff_id

    # Non-admin without target_staff_id returns 0 competencies
    if not is_admin and not target_staff_id:
        return SubjectHierarchyTreeResponse(
            subject_id=subject.subject_id,
            subject_name=subject.subject_name,
            competencies=[],
            unassigned_lessons=[],
            total_competencies=0,
            total_lessons=0,
        )

    # 1. Fetch competencies
    comp_query = db.query(Competency).filter(
        Competency.subject_id == subject_id,
        Competency.is_archived == False,
    )
    if target_staff_id is not None:
        comp_query = comp_query.filter(Competency.created_by_staff_id == target_staff_id)
    elif not is_admin:
        comp_query = comp_query.filter(Competency.created_by_staff_id == "__NONE__")

    if period_id is not None:
        comp_query = comp_query.filter(Competency.academic_period_id == period_id)
    competencies = comp_query.order_by(Competency.order_index.asc(), Competency.created_at.asc()).all()

    # 2. Fetch lessons for subject / class
    lesson_query = db.query(Lesson).filter(
        Lesson.subject_id == subject_id,
        Lesson.is_archived == False,
    )
    if target_staff_id is not None:
        lesson_query = lesson_query.filter(Lesson.created_by_staff_id == target_staff_id)

    if class_id is not None:
        lesson_query = lesson_query.join(
            LessonAssignment, LessonAssignment.lesson_id == Lesson.lesson_id
        ).filter(LessonAssignment.class_id == class_id)
        if student_id is not None:
            lesson_query = lesson_query.filter(
                LessonAssignment.is_published.is_(True),
                Lesson.is_published.is_(True),
                Lesson.is_locked.is_(False),
            )

    lessons = lesson_query.order_by(Lesson.order_index.asc(), Lesson.created_at.asc()).all()
    if student_id is not None:
        linked_competencies = {
            lesson.competency_id for lesson in lessons
            if lesson.competency_id is not None
        }
        competencies = [
            item for item in competencies
            if item.competency_id in linked_competencies
        ]

    # 3. Group lessons under competency
    lessons_by_comp: dict[int, list] = {}
    unassigned: list = []

    for l in lessons:
        res = build_lesson_response(l, db)
        if l.competency_id is not None:
            lessons_by_comp.setdefault(l.competency_id, []).append(res)
        else:
            unassigned.append(res)

    nodes: list[CompetencyTreeNode] = []
    for c in competencies:
        base_resp = build_competency_response(c, db)
        comp_lessons = lessons_by_comp.get(c.competency_id, [])
        if student_id is not None:
            base_resp = base_resp.model_copy(
                update={"lesson_count": len(comp_lessons)}
            )
        nodes.append(
            CompetencyTreeNode(
                **base_resp.model_dump(),
                lessons=comp_lessons,
            )
        )

    # Any lessons pointing to nonexistent/archived competencies go to unassigned
    known_comp_ids = {c.competency_id for c in competencies}
    for comp_id, orphan_lessons in lessons_by_comp.items():
        if comp_id not in known_comp_ids:
            unassigned.extend(orphan_lessons)

    return SubjectHierarchyTreeResponse(
        subject_id=subject.subject_id,
        subject_name=subject.subject_name,
        competencies=nodes,
        unassigned_lessons=unassigned,
        total_competencies=len(nodes),
        total_lessons=len(lessons),
    )

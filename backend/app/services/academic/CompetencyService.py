from typing import Optional
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.Competency import Competency
from app.models.academic.Subject import Subject
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.people.AcademicStaff import AcademicStaff
from app.schemas.Competency import CompetencyCreate, CompetencyResponse, CompetencyUpdate


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


def get_competency_detail(competency_id: int, db: Session) -> CompetencyResponse:
    competency = db.query(Competency).filter(Competency.competency_id == competency_id).first()
    if not competency:
        raise HTTPException(status_code=404, detail="Competency not found")
    return build_competency_response(competency, db)


def list_subject_competencies(
    subject_id: int,
    db: Session,
    period_id: Optional[int] = None,
    include_archived: bool = False,
) -> list[CompetencyResponse]:
    query = db.query(Competency).filter(Competency.subject_id == subject_id)
    if not include_archived:
        query = query.filter(Competency.is_archived == False)
    if period_id is not None:
        query = query.filter(Competency.academic_period_id == period_id)
    
    competencies = query.order_by(Competency.order_index.asc(), Competency.created_at.asc()).all()
    return [build_competency_response(c, db) for c in competencies]


def update_competency_record(
    competency_id: int,
    body: CompetencyUpdate,
    staff_id: Optional[str],
    db: Session,
) -> CompetencyResponse:
    competency = db.query(Competency).filter(Competency.competency_id == competency_id).first()
    if not competency:
        raise HTTPException(status_code=404, detail="Competency not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(competency, field, value)

    db.commit()
    db.refresh(competency)
    return build_competency_response(competency, db)


def archive_competency_record(
    competency_id: int,
    staff_id: Optional[str],
    db: Session,
) -> dict:
    competency = db.query(Competency).filter(Competency.competency_id == competency_id).first()
    if not competency:
        raise HTTPException(status_code=404, detail="Competency not found")

    competency.is_archived = True
    db.commit()
    return {"message": "Competency archived", "competency_id": competency_id, "is_archived": True}

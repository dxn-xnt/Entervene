"""Authenticated student reads of their own active persistent Interventions."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.v1.routes.TeacherInterventions import require_development_intervention_api
from app.core.Dependencies import get_student_record
from app.db.Session import get_db
from app.schemas.StudentPersistentIntervention import StudentPersistentIntervention, StudentPersistentInterventionList
from app.services.intervention.StudentPersistentInterventionService import get_active, list_active, get_resolved, list_resolved


router = APIRouter(dependencies=[Depends(require_development_intervention_api)])


@router.get("", response_model=StudentPersistentInterventionList)
def list_mine(student=Depends(get_student_record), db: Session = Depends(get_db)):
    return list_active(db, student.student_id)


@router.get("/resolved", response_model=StudentPersistentInterventionList)
def list_previous(student=Depends(get_student_record), db: Session = Depends(get_db)):
    return list_resolved(db, student.student_id)


@router.get("/resolved/{intervention_id}", response_model=StudentPersistentIntervention)
def read_previous(intervention_id: int, student=Depends(get_student_record), db: Session = Depends(get_db)):
    return get_resolved(db, student.student_id, intervention_id)


@router.get("/{intervention_id}", response_model=StudentPersistentIntervention)
def read_mine(intervention_id: int, student=Depends(get_student_record), db: Session = Depends(get_db)):
    return get_active(db, student.student_id, intervention_id)

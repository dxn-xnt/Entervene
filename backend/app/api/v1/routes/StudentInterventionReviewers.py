"""Authenticated student access to privately sent Intervention reviewers."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.v1.routes.TeacherInterventions import require_development_intervention_api
from app.core.Dependencies import get_student_record
from app.db.Session import get_db
from app.schemas.StudentInterventionReviewer import StudentReviewerDetail, StudentReviewerList
from app.services.intervention.StudentInterventionReviewerService import (
    get_student_reviewer, list_student_reviewers,
)


router = APIRouter(dependencies=[Depends(require_development_intervention_api)])


@router.get("", response_model=StudentReviewerList)
def list_reviewers(student=Depends(get_student_record), db: Session = Depends(get_db)):
    return list_student_reviewers(db, student.student_id)


@router.get("/{material_id}", response_model=StudentReviewerDetail)
def read_reviewer(material_id: int, student=Depends(get_student_record), db: Session = Depends(get_db)):
    return get_student_reviewer(db, student.student_id, material_id)

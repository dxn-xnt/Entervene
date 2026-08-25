# app/api/v1/routes/TOS.py
from typing import List, Optional

from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.core.Dependencies import get_optional_staff_id, require_role
from app.db.Session import get_db
from app.schemas.AITOS import (
    TOSExamDetailResponse,
    TOSExamSummary,
    TOSExamUpsert,
    TOSQuestionIn,
    TOSQuestionOut,
)
from app.services.tos.TOSService import (
    create_tos_exam,
    delete_tos_exam,
    get_tos_exam_detail,
    list_tos_exams_for_subject,
    update_single_tos_question,
    update_tos_exam,
)

router = APIRouter()


@router.post("/subject/{subject_id}", response_model=TOSExamDetailResponse, status_code=status.HTTP_201_CREATED)
def create_exam(
    subject_id: int,
    body: TOSExamUpsert,
    staff_id: Optional[str] = Depends(get_optional_staff_id),
    current_user: dict = Depends(require_role("teacher", "admin")),
    db: Session = Depends(get_db),
):
    return create_tos_exam(subject_id=subject_id, body=body, staff_id=staff_id, db=db)


@router.get("/subject/{subject_id}", response_model=List[TOSExamSummary])
def get_subject_exams(
    subject_id: int,
    current_user: dict = Depends(require_role("teacher", "admin", "student")),
    db: Session = Depends(get_db),
):
    return list_tos_exams_for_subject(subject_id=subject_id, db=db)


@router.get("/{tos_exam_id}", response_model=TOSExamDetailResponse)
def get_exam_detail(
    tos_exam_id: int,
    current_user: dict = Depends(require_role("teacher", "admin", "student")),
    db: Session = Depends(get_db),
):
    return get_tos_exam_detail(tos_exam_id=tos_exam_id, db=db)


@router.put("/{tos_exam_id}", response_model=TOSExamDetailResponse)
def update_exam(
    tos_exam_id: int,
    body: TOSExamUpsert,
    staff_id: Optional[str] = Depends(get_optional_staff_id),
    current_user: dict = Depends(require_role("teacher", "admin")),
    db: Session = Depends(get_db),
):
    return update_tos_exam(tos_exam_id=tos_exam_id, body=body, staff_id=staff_id, db=db)


@router.delete("/{tos_exam_id}")
def delete_exam(
    tos_exam_id: int,
    staff_id: Optional[str] = Depends(get_optional_staff_id),
    current_user: dict = Depends(require_role("teacher", "admin")),
    db: Session = Depends(get_db),
):
    return delete_tos_exam(tos_exam_id=tos_exam_id, staff_id=staff_id, db=db)


@router.put("/question/{tos_question_id}", response_model=TOSQuestionOut)
def update_question(
    tos_question_id: int,
    body: TOSQuestionIn,
    current_user: dict = Depends(require_role("teacher", "admin")),
    db: Session = Depends(get_db),
):
    return update_single_tos_question(tos_question_id=tos_question_id, body=body, db=db)

# app/services/tos/TOSService.py
from decimal import Decimal
import json
from typing import List, Optional
from fastapi import HTTPException
from sqlalchemy.orm import Session, selectinload

from app.models.academic.Subject import Subject
from app.models.tos.TOSExam import TOSExam
from app.models.tos.TOSQuestion import TOSQuestion
from app.schemas.AITOS import (
    TOSExamDetailResponse,
    TOSExamSummary,
    TOSExamUpsert,
    TOSOption,
    TOSQuestionIn,
    TOSQuestionOut,
)


def _safe_json_loads(val: Optional[str], default: any) -> any:
    if not val:
        return default
    try:
        return json.loads(val)
    except Exception:
        return default


def _question_to_out(q: TOSQuestion) -> TOSQuestionOut:
    raw_options = _safe_json_loads(q.options_json, [])
    options = []
    if isinstance(raw_options, list):
        for o in raw_options:
            if isinstance(o, dict):
                options.append(TOSOption(
                    option_id=o.get("option_id"),
                    option_text=str(o.get("option_text", "")),
                    is_correct=bool(o.get("is_correct", False)),
                    option_order=int(o.get("option_order", 1)),
                ))

    return TOSQuestionOut(
        tos_question_id=q.tos_question_id,
        tos_exam_id=q.tos_exam_id,
        competency_id=q.competency_id,
        competency_label=q.competency_label,
        question_text=q.question_text,
        question_type=q.question_type,
        difficulty_band=q.difficulty_band,
        cognitive_level=q.cognitive_level,
        display_order=q.display_order,
        points=float(q.points) if q.points is not None else 1.0,
        explanation=q.explanation,
        options=options,
    )


def _exam_to_detail(exam: TOSExam) -> TOSExamDetailResponse:
    questions = sorted(exam.questions, key=lambda x: x.display_order) if exam.questions else []
    return TOSExamDetailResponse(
        tos_exam_id=exam.tos_exam_id,
        subject_id=exam.subject_id,
        created_by_staff_id=exam.created_by_staff_id,
        title=exam.title,
        quarter=exam.quarter,
        status=exam.status,
        test_parts=_safe_json_loads(exam.test_parts_json, []),
        competencies=_safe_json_loads(exam.competencies_json, []),
        difficulty_ratio=_safe_json_loads(exam.difficulty_ratio_json, {}),
        questions=[_question_to_out(q) for q in questions],
        created_at=exam.created_at,
        updated_at=exam.updated_at,
    )


def _sync_questions(db: Session, exam: TOSExam, questions: List[TOSQuestionIn]):
    # Delete existing
    for existing_q in list(exam.questions):
        db.delete(existing_q)
    db.flush()

    for idx, q_in in enumerate(questions, start=1):
        options_data = [opt.model_dump() for opt in q_in.options] if q_in.options else []
        db_q = TOSQuestion(
            tos_exam_id=exam.tos_exam_id,
            competency_id=q_in.competency_id,
            competency_label=q_in.competency_label,
            question_text=q_in.question_text,
            question_type=q_in.question_type,
            difficulty_band=q_in.difficulty_band,
            cognitive_level=q_in.cognitive_level,
            display_order=q_in.display_order or idx,
            points=Decimal(str(q_in.points or 1.0)),
            explanation=q_in.explanation,
            options_json=json.dumps(options_data),
        )
        db.add(db_q)
    db.flush()


def create_tos_exam(subject_id: int, body: TOSExamUpsert, staff_id: Optional[str], db: Session) -> TOSExamDetailResponse:
    subject = db.query(Subject).filter(Subject.subject_id == subject_id).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")

    exam = TOSExam(
        subject_id=subject_id,
        created_by_staff_id=staff_id,
        title=body.title.strip() or "Untitled TOS Exam",
        quarter=body.quarter or "Q1",
        status=body.status or "DRAFT",
        test_parts_json=json.dumps(body.test_parts or []),
        competencies_json=json.dumps(body.competencies or []),
        difficulty_ratio_json=json.dumps(body.difficulty_ratio or {}),
    )
    db.add(exam)
    db.flush()

    if body.questions:
        _sync_questions(db, exam, body.questions)

    db.commit()
    db.refresh(exam)
    return _exam_to_detail(exam)


def list_tos_exams_for_subject(subject_id: int, db: Session) -> List[TOSExamSummary]:
    exams = (
        db.query(TOSExam)
        .options(selectinload(TOSExam.questions))
        .filter(TOSExam.subject_id == subject_id)
        .order_by(TOSExam.updated_at.desc(), TOSExam.created_at.desc())
        .all()
    )
    return [
        TOSExamSummary(
            tos_exam_id=e.tos_exam_id,
            subject_id=e.subject_id,
            title=e.title,
            quarter=e.quarter,
            status=e.status,
            question_count=len(e.questions) if e.questions else 0,
            created_at=e.created_at,
            updated_at=e.updated_at,
        )
        for e in exams
    ]


def get_tos_exam_detail(tos_exam_id: int, db: Session) -> TOSExamDetailResponse:
    exam = (
        db.query(TOSExam)
        .options(selectinload(TOSExam.questions))
        .filter(TOSExam.tos_exam_id == tos_exam_id)
        .first()
    )
    if not exam:
        raise HTTPException(status_code=404, detail="TOS Exam not found")
    return _exam_to_detail(exam)


def update_tos_exam(tos_exam_id: int, body: TOSExamUpsert, staff_id: Optional[str], db: Session) -> TOSExamDetailResponse:
    exam = (
        db.query(TOSExam)
        .options(selectinload(TOSExam.questions))
        .filter(TOSExam.tos_exam_id == tos_exam_id)
        .first()
    )
    if not exam:
        raise HTTPException(status_code=404, detail="TOS Exam not found")

    exam.title = body.title.strip() or exam.title
    exam.quarter = body.quarter or exam.quarter
    exam.status = body.status or exam.status
    exam.test_parts_json = json.dumps(body.test_parts or [])
    exam.competencies_json = json.dumps(body.competencies or [])
    exam.difficulty_ratio_json = json.dumps(body.difficulty_ratio or {})

    _sync_questions(db, exam, body.questions or [])

    db.commit()
    db.refresh(exam)
    return _exam_to_detail(exam)


def delete_tos_exam(tos_exam_id: int, staff_id: Optional[str], db: Session) -> dict:
    exam = db.query(TOSExam).filter(TOSExam.tos_exam_id == tos_exam_id).first()
    if not exam:
        raise HTTPException(status_code=404, detail="TOS Exam not found")
    db.delete(exam)
    db.commit()
    return {"message": "TOS Exam deleted successfully", "tos_exam_id": tos_exam_id}


def update_single_tos_question(tos_question_id: int, body: TOSQuestionIn, db: Session) -> TOSQuestionOut:
    q = db.query(TOSQuestion).filter(TOSQuestion.tos_question_id == tos_question_id).first()
    if not q:
        raise HTTPException(status_code=404, detail="TOS Question not found")

    q.competency_id = body.competency_id
    q.competency_label = body.competency_label
    q.question_text = body.question_text
    q.question_type = body.question_type
    q.difficulty_band = body.difficulty_band
    q.cognitive_level = body.cognitive_level
    q.display_order = body.display_order
    q.points = Decimal(str(body.points or 1.0))
    q.explanation = body.explanation
    options_data = [opt.model_dump() for opt in body.options] if body.options else []
    q.options_json = json.dumps(options_data)

    db.commit()
    db.refresh(q)
    return _question_to_out(q)

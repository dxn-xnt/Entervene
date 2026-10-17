import sys, os
sys.path.insert(0, os.path.abspath("."))

from app.db.Session import engine
from sqlalchemy import text
from app.services.student_record.StudentRecordService import resolve_subject_grading_weights
from app.models.academic.Subject import Subject
from sqlalchemy.orm import Session

with Session(engine) as session:
    subjects = session.query(Subject).all()
    print(f"Total subjects: {len(subjects)}")
    for s in subjects[:5]:
        weights = resolve_subject_grading_weights(session, s.subject_id)
        pass_thresh = float(s.subject_group_rel.passing_threshold) if s.subject_group_rel else 75.0
        print(f"Subject: {s.subject_name:25s} | Group: {s.subject_group_rel.name if s.subject_group_rel else 'None':12s} | Pass: {pass_thresh}% | WW: {weights.ww_weight*100}% PT: {weights.pt_weight*100}% QA: {weights.qa_weight*100}%")

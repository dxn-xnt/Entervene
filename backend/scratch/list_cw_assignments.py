import os, sys
os.environ['ENV_FILE'] = '.env.demo'
sys.path.insert(0, os.path.abspath('.'))
from app.db.Session import SessionLocal
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.Classwork import Classwork
from app.models.quiz.Quiz import Quiz

db = SessionLocal()
try:
    rows = (
        db.query(ClassworkAssignment, Classwork)
        .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
        .filter(ClassworkAssignment.class_id == 1, Classwork.subject_id == 1, ClassworkAssignment.academic_period_id == 1)
        .order_by(ClassworkAssignment.classwork_assignment_id)
        .all()
    )
    for a, c in rows:
        q = db.query(Quiz).filter(Quiz.classwork_id == c.classwork_id).first()
        print(f'AsgID={a.classwork_assignment_id}, CWID={c.classwork_id}, Title="{c.title}", Type={c.classwork_type}, Cat={c.classwork_category}, Subtype={c.exam_subtype}, Points={c.total_points}, QuizID={q.quiz_id if q else None}')
finally:
    db.close()

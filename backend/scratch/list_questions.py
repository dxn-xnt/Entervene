import os, sys
os.environ['ENV_FILE'] = '.env.demo'
sys.path.insert(0, os.path.abspath('.'))
from app.db.Session import SessionLocal
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.academic.Lesson import Lesson
from app.models.academic.Competency import Competency

db = SessionLocal()
try:
    qs = db.query(Question).all()
    print(f'Total questions in DB: {len(qs)}')
    for q in qs:
        l = db.get(Lesson, q.lesson_id) if q.lesson_id else None
        c = db.get(Competency, l.competency_id) if l and l.competency_id else None
        print(f'QID={q.question_id}, Type={q.question_type}, Points={q.points}, LessonID={q.lesson_id} ("{l.title if l else None}"), CompCode={c.competency_code if c else None}')
        print(f'  Text: {q.question_text[:80]}...')
        opts = db.query(QuestionOption).filter(QuestionOption.question_id == q.question_id).all()
        for o in opts:
            print(f'    OptID={o.option_id}, Correct={o.is_correct}, Text={o.option_text}')
finally:
    db.close()

import os, sys
os.environ['ENV_FILE'] = '.env.demo'
sys.path.insert(0, os.path.abspath('.'))

from app.db.Session import SessionLocal
from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.people.Student import Student
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.intervention.Intervention import Intervention

db = SessionLocal()
try:
    print("=== 1. COMPETENCIES IN DB ===")
    comps = db.query(Competency).all()
    for c in comps:
        print(f"ID={c.competency_id}, Code={c.competency_code}, SubjID={c.subject_id}, PeriodID={c.academic_period_id}")
        print(f"  Statement: {c.statement}")

    print("\n=== 2. LESSONS IN DB ===")
    lessons = db.query(Lesson).all()
    for l in lessons:
        c = db.get(Competency, l.competency_id) if l.competency_id else None
        print(f"ID={l.lesson_id}, Title=\"{l.title}\", SubjID={l.subject_id}, CompID={l.competency_id} ({c.competency_code if c else 'None'}), Published={l.is_published}, Draft={l.is_draft}")
        if hasattr(l, 'description') and l.description:
            print(f"  Desc: {l.description[:100]}")

    print("\n=== 3. CLASSWORKS IN SUBJECT 1 ===")
    cws = db.query(Classwork).filter(Classwork.subject_id == 1).order_by(Classwork.classwork_id).all()
    for cw in cws:
        q = db.query(Quiz).filter(Quiz.classwork_id == cw.classwork_id).first()
        cls = db.query(ClassworkLesson).filter(ClassworkLesson.classwork_id == cw.classwork_id).all()
        covs = db.query(ClassworkCoverage).filter(ClassworkCoverage.classwork_id == cw.classwork_id).all()
        print(f"CWID={cw.classwork_id}, Title=\"{cw.title}\", Type={cw.classwork_type}, Cat={cw.classwork_category}, Subtype={cw.exam_subtype}, Mode={cw.activity_mode}, Pts={cw.total_points}")
        print(f"  Instructions/Desc: {cw.instructions[:80] if cw.instructions else 'None'}")
        print(f"  Quiz: {q.quiz_id if q else None}, ClassworkLesson: {[cl.lesson_id for cl in cls]}, ClassworkCoverage count: {len(covs)}")

    print("\n=== 4. CLASSWORK ASSIGNMENTS FOR CLASS 1 ===")
    asgs = db.query(ClassworkAssignment).filter(ClassworkAssignment.class_id == 1).order_by(ClassworkAssignment.classwork_assignment_id).all()
    for a in asgs:
        cw = db.get(Classwork, a.classwork_id)
        sub_count = db.query(StudentSubmission).filter(StudentSubmission.classwork_assignment_id == a.classwork_assignment_id).count()
        graded_count = db.query(StudentSubmission).filter(StudentSubmission.classwork_assignment_id == a.classwork_assignment_id, StudentSubmission.grade.isnot(None)).count()
        print(f"AsgID={a.classwork_assignment_id}, CWID={a.classwork_id} (\"{cw.title}\"), Recipient={a.recipient_student_id}, Subs={sub_count}, Graded={graded_count}")

    print("\n=== 5. CLASSWORK COVERAGE RECORDS IN DB ===")
    all_covs = db.query(ClassworkCoverage).all()
    print(f"Total ClassworkCoverage records: {len(all_covs)}")
    for cov in all_covs:
        print(f"CovID={cov.coverage_id}, CWID={cov.classwork_id}, LessonID={cov.lesson_id}, CompID={cov.competency_id}, ValidFrom={cov.valid_from}, ValidUntil={cov.valid_until}")

    print("\n=== 6. QUIZZES AND QUESTIONS IN DB ===")
    quizzes = db.query(Quiz).all()
    for q in quizzes:
        cw = db.get(Classwork, q.classwork_id)
        qqs = db.query(QuizQuestion).filter(QuizQuestion.quiz_id == q.quiz_id).order_by(QuizQuestion.display_order).all()
        print(f"QuizID={q.quiz_id}, CWID={q.classwork_id} (\"{cw.title if cw else 'None'}\"), TotalItems={q.total_items}, Status={q.status}")
        for qq in qqs:
            ques = db.get(Question, qq.question_id)
            print(f"  QQID={qq.quiz_question_id}, Order={qq.display_order}, QID={qq.question_id}, Points={ques.points if ques else None}, LessonID={ques.lesson_id if ques else None}")
            if ques:
                print(f"    Text: {ques.question_text[:80]}")

finally:
    db.close()

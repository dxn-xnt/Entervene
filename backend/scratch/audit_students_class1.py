import os, sys
sys.path.insert(0, os.path.abspath('backend'))
from dotenv import dotenv_values
from sqlalchemy import create_engine, text

demo_env = dotenv_values('backend/.env.demo')
engine = create_engine(demo_env.get('DATABASE_URL'))
with engine.connect() as conn:
    query = text("""
        SELECT s.student_id, s.student_lrn, s.first_name, s.last_name, s.gender, s.email
        FROM student s
        JOIN student_class sc ON s.student_id = sc.student_id
        WHERE sc.class_id = 1
        ORDER BY s.student_lrn
    """)
    students = conn.execute(query).fetchall()
    print(f"Total students in Class 1: {len(students)}")
    for st in students:
        p = conn.execute(text("""
            SELECT prediction_id, predicted_period_grade, intervention_level, risk_score, generated_at,
                   evidence_snapshot->'readiness'->>'readiness_level' as readiness
            FROM development_current_term_prediction
            WHERE student_id = :sid
            ORDER BY prediction_id DESC LIMIT 1
        """), {"sid": st.student_id}).fetchone()
        
        subs_count = conn.execute(text("""
            SELECT count(*) FROM student_submission WHERE student_id = :sid AND status = 'graded'
        """), {"sid": st.student_id}).scalar()

        quiz_ans_count = conn.execute(text("""
            SELECT count(*) FROM quiz_answer qa
            JOIN student_submission ss ON qa.submission_id = ss.submission_id
            WHERE ss.student_id = :sid
        """), {"sid": st.student_id}).scalar()

        p_info = f"Pred #{p.prediction_id}: {p.predicted_period_grade} ({p.intervention_level}, {p.readiness})" if p else "NO PREDICTION"
        print(f"LRN {st.student_lrn} | {st.first_name} {st.last_name} | Subs: {subs_count} | QuizAnswers: {quiz_ans_count} | {p_info}")

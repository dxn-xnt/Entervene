import os
import sys

sys.path.insert(0, os.path.abspath("backend"))
from dotenv import dotenv_values
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

def main():
    demo_env = dotenv_values("backend/.env.demo")
    db_url = demo_env.get("DATABASE_URL")
    if not db_url or "Entervene_Demo" not in db_url:
        raise RuntimeError(f"Safety abort: {db_url}")

    engine = create_engine(db_url)
    with Session(engine) as db:
        print("Connected to:", db.execute(text("SELECT current_database()")).scalar())

        # Inspect Classwork 11
        cw11 = db.execute(text("""
            SELECT c.classwork_id, c.title, c.classwork_type, c.classwork_category, c.total_points, c.instructions,
                   ca.classwork_assignment_id, ca.class_id, ca.due_date, ca.is_published
            FROM classwork c
            LEFT JOIN classwork_assignment ca ON c.classwork_id = ca.classwork_id
            WHERE c.classwork_id = 11
        """)).fetchall()
        print("\n--- Classwork 11 Details ---")
        for row in cw11:
            print(dict(row._mapping))

        # Inspect Submissions for CW 11
        subs11 = db.execute(text("""
            SELECT s.submission_id, s.classwork_assignment_id, s.student_id, st.first_name, st.last_name, s.grade, s.status, s.submitted_at
            FROM student_submission s
            JOIN student st ON s.student_id = st.student_id
            JOIN classwork_assignment ca ON s.classwork_assignment_id = ca.classwork_assignment_id
            WHERE ca.classwork_id = 11
        """)).fetchall()
        print("\n--- Submissions for CW 11 ---")
        for row in subs11:
            print(dict(row._mapping))

        # Inspect all classwork submissions for Finley
        finley_subs = db.execute(text("""
            SELECT c.classwork_id, c.title, c.classwork_type, c.classwork_category, c.total_points,
                   ca.classwork_assignment_id, s.submission_id, s.grade, s.status
            FROM student_submission s
            JOIN classwork_assignment ca ON s.classwork_assignment_id = ca.classwork_assignment_id
            JOIN classwork c ON ca.classwork_id = c.classwork_id
            JOIN student st ON s.student_id = st.student_id
            WHERE st.first_name ILIKE '%Finley%'
            ORDER BY c.classwork_id
        """)).fetchall()
        print("\n--- Finley's all classwork submissions ---")
        for row in finley_subs:
            print(dict(row._mapping))

        # Inspect CW 10 (Term Exam)
        cw10 = db.execute(text("""
            SELECT c.classwork_id, c.title, c.classwork_type, c.classwork_category, c.exam_subtype, c.total_points,
                   ca.classwork_assignment_id, ca.class_id, ca.due_date, ca.is_published
            FROM classwork c
            LEFT JOIN classwork_assignment ca ON c.classwork_id = ca.classwork_id
            WHERE c.classwork_id = 10
        """)).fetchall()
        print("\n--- Classwork 10 (Term Exam) Details ---")
        for row in cw10:
            print(dict(row._mapping))

        # Inspect all classworks in Class 1
        all_cws = db.execute(text("""
            SELECT c.classwork_id, c.title, c.classwork_type, c.classwork_category, c.total_points,
                   ca.classwork_assignment_id, ca.is_published, ca.due_date,
                   count(s.submission_id) as sub_count,
                   count(CASE WHEN s.grade IS NOT NULL THEN 1 END) as graded_count
            FROM classwork c
            JOIN classwork_assignment ca ON c.classwork_id = ca.classwork_id
            LEFT JOIN student_submission s ON ca.classwork_assignment_id = s.classwork_assignment_id
            WHERE ca.class_id = 1
            GROUP BY c.classwork_id, c.title, c.classwork_type, c.classwork_category, c.total_points,
                     ca.classwork_assignment_id, ca.is_published, ca.due_date
            ORDER BY c.classwork_id
        """)).fetchall()
        print("\n--- All Classworks in Class 1 ---")
        for row in all_cws:
            print(dict(row._mapping))

if __name__ == "__main__":
    main()

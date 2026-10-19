"""Inspect current state and dependencies for Task 7 cleanup."""

import os
import sys

sys.path.insert(0, os.path.abspath("backend"))
from dotenv import dotenv_values
from sqlalchemy import create_engine, text

demo_env = dotenv_values("backend/.env.demo")
engine = create_engine(demo_env.get("DATABASE_URL"))

with engine.connect() as conn:
    print("=== DATABASE INFO ===")
    db_info = conn.execute(text("SELECT current_database(), current_user, inet_server_port()")).fetchone()
    print("Connected to:", db_info)

    print("\n=== RECORD COUNTS ===")
    st_count = conn.execute(text("SELECT count(*) FROM student s JOIN student_class sc ON s.student_id = sc.student_id WHERE sc.class_id = 1")).scalar()
    comp_count = conn.execute(text("SELECT count(*) FROM competency")).scalar()
    lesson_count = conn.execute(text("SELECT count(*) FROM lesson")).scalar()
    pred_count = conn.execute(text("SELECT count(*) FROM development_current_term_prediction")).scalar()
    inv_count = conn.execute(text("SELECT count(*) FROM intervention")).scalar()
    sub_count = conn.execute(text("SELECT count(*) FROM student_submission")).scalar()
    print(f"Students in Class 1: {st_count} (Expected: 11)")
    print(f"Competencies: {comp_count} (Expected: 4)")
    print(f"Lessons: {lesson_count} (Expected: 4)")
    print(f"Predictions: {pred_count} (Expected: 45)")
    print(f"Interventions: {inv_count} (Expected: 4)")
    print(f"Submissions: {sub_count} (Expected: 102)")

    print("\n=== INTERVENTIONS DETAIL ===")
    invs = conn.execute(text("""
        SELECT i.intervention_id, i.student_id, s.first_name, s.last_name, i.status, 
               i.source_prediction_id, i.created_at, i.remediation_plan
        FROM intervention i
        JOIN student s ON i.student_id = s.student_id
        ORDER BY i.intervention_id
    """)).fetchall()
    for inv in invs:
        print(f"Inv #{inv.intervention_id} | Student: {inv.first_name} {inv.last_name} | Status: {inv.status} | Source Pred: {inv.source_prediction_id}")
        print(f"  Plan: {inv.remediation_plan}")

    print("\n=== CLASSWORK ASSIGNMENTS LINKED TO INTERVENTIONS ===")
    ca_inv = conn.execute(text("""
        SELECT ca.classwork_assignment_id, ca.classwork_id, cw.title, cw.activity_mode, cw.classwork_category,
               ca.source_intervention_id, ca.recipient_student_id, ca.remediation_request_id, ca.original_exam_assignment_id
        FROM classwork_assignment ca
        JOIN classwork cw ON ca.classwork_id = cw.classwork_id
        WHERE ca.source_intervention_id IS NOT NULL 
           OR ca.recipient_student_id IS NOT NULL 
           OR ca.remediation_request_id IS NOT NULL
           OR ca.original_exam_assignment_id IS NOT NULL
    """)).fetchall()
    for row in ca_inv:
        print(" ", dict(row._mapping))

    print("\n=== CLASSWORK 11 & 12 DETAILS ===")
    for cwid in [11, 12]:
        cw = conn.execute(text("SELECT * FROM classwork WHERE classwork_id = :id"), {"id": cwid}).fetchone()
        print(f"CW {cwid}: {dict(cw._mapping)}")
        cas = conn.execute(text("SELECT * FROM classwork_assignment WHERE classwork_id = :id"), {"id": cwid}).fetchall()
        for ca in cas:
            print(f"  CA {ca.classwork_assignment_id}: {dict(ca._mapping)}")
            subs = conn.execute(text("SELECT * FROM student_submission WHERE classwork_assignment_id = :caid"), {"caid": ca.classwork_assignment_id}).fetchall()
            for s in subs:
                print(f"    Sub {s.submission_id}: student={s.student_id}, grade={s.grade}, status={s.status}")

    print("\n=== TERM EXAM (CW 10) SUBMISSIONS ===")
    cw10_subs = conn.execute(text("""
        SELECT ss.submission_id, ss.student_id, s.first_name, s.last_name, ss.grade, ss.status, ss.submitted_at, ss.graded_at
        FROM student_submission ss
        JOIN student s ON ss.student_id = s.student_id
        JOIN classwork_assignment ca ON ss.classwork_assignment_id = ca.classwork_assignment_id
        WHERE ca.classwork_id = 10
        ORDER BY s.student_lrn
    """)).fetchall()
    print(f"Total Term Exam submissions: {len(cw10_subs)}")
    for s in cw10_subs:
        print(f"  Student {s.first_name} {s.last_name}: grade={s.grade}, status={s.status}")

    print("\n=== FOREIGN KEYS REFERENCING INTERVENTION & PREDICTION ===")
    fks = conn.execute(text("""
        SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name 
        FROM information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY' 
          AND ccu.table_name IN ('intervention', 'development_current_term_prediction', 'ai_prediction')
        ORDER BY ccu.table_name, tc.table_name
    """)).fetchall()
    for fk in fks:
        print(" ", dict(fk._mapping))

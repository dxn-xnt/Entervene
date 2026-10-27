import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
os.environ["ENV_FILE"] = str(BACKEND_DIR / ".env.demo")

from app.core.Config import settings
from sqlalchemy import create_engine, text, inspect

print("Configured DB URL:", settings.database_url.split("@")[-1])
engine = create_engine(settings.database_url)

with engine.connect() as conn:
    current_db = conn.scalar(text("SELECT current_database()"))
    print("Connected DB:", current_db)
    
    rev = conn.scalar(text("SELECT version_num FROM alembic_version"))
    print("Alembic revision:", rev)
    
    table_exists = conn.scalar(text("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'intervention_reading_review'
        )
    """))
    print("intervention_reading_review exists:", table_exists)
    
    if table_exists:
        try:
            rel = conn.execute(text("""
                SELECT pg_relation_filepath('intervention_reading_review'),
                       (pg_stat_file(pg_relation_filepath('intervention_reading_review'))).modification
            """)).first()
            print("Table file & modification:", rel)
        except Exception as e:
            print("Could not get file stats:", e)
            
        row_count = conn.scalar(text("SELECT count(*) FROM intervention_reading_review"))
        print("Rows in intervention_reading_review:", row_count)
        
    print("\n--- Intervention 7 ---")
    inv = conn.execute(text("SELECT intervention_id, student_id, class_id, subject_id, academic_period_id, status, remediation_plan FROM intervention WHERE intervention_id = 7")).mappings().first()
    if inv:
        print("Intervention 7:", {k: v for k, v in inv.items() if k != "remediation_plan"})
        print("Remediation plan selected_resources:", inv["remediation_plan"].get("selected_resources"))
        
    print("\n--- Assignment 18 ---")
    asg = conn.execute(text("SELECT classwork_assignment_id, classwork_id, recipient_student_id, source_intervention_id, is_published FROM classwork_assignment WHERE classwork_assignment_id = 18")).mappings().first()
    print("Assignment 18:", dict(asg) if asg else None)
    
    print("\n--- Reading Assignments 14, 16, 17 ---")
    readings = conn.execute(text("SELECT classwork_assignment_id, classwork_id, recipient_student_id, is_published FROM classwork_assignment WHERE classwork_assignment_id IN (14, 16, 17) ORDER BY classwork_assignment_id")).mappings().fetchall()
    for r in readings:
        print("Reading Assignment:", dict(r))
        
    print("\n--- Snapshotted Prerequisites for 18 ---")
    prereqs = conn.execute(text("SELECT prerequisite_id, remediation_assignment_id, reading_classwork_id, reading_assignment_id, display_order FROM remediation_reading_prerequisite WHERE remediation_assignment_id = 18 ORDER BY display_order")).mappings().fetchall()
    for p in prereqs:
        print("Prereq:", dict(p))
        
    print("\n--- Submissions for 14, 16, 17 ---")
    subs = conn.execute(text("SELECT submission_id, student_id, classwork_assignment_id, status, reading_focused_seconds, submitted_at, grade FROM student_submission WHERE classwork_assignment_id IN (14, 16, 17) ORDER BY classwork_assignment_id")).mappings().fetchall()
    for s in subs:
        print("Submission:", dict(s))

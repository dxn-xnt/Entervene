import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
os.environ["ENV_FILE"] = str(BACKEND_DIR / ".env.demo")

from app.core.Config import settings
from app.main import app
from app.models.people.Student import Student
from app.models.auth.UserAccount import UserAccount
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.db.Session import SessionLocal
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text, inspect
from app.api.v1.routes.Auth import get_current_user

# 1. Confirm database identity
db_url = urlparse(settings.database_url)
assert db_url.path == "/Entervene_Demo", f"Expected /Entervene_Demo, got {db_url.path}"
engine = create_engine(settings.database_url)

print("=" * 60)
print("ENTEVENE_DEMO POST-MIGRATION VERIFICATION (S1D.2C.3)")
print("=" * 60)

with engine.connect() as conn:
    current_db = conn.scalar(text("SELECT current_database()"))
    assert current_db == "Entervene_Demo"
    rev = conn.scalar(text("SELECT version_num FROM alembic_version"))
    print(f"1. Database: {current_db}, Alembic revision: {rev}")
    assert rev == "20261027_reading_review", f"Unexpected revision: {rev}"
    
    insp = inspect(conn)
    assert "intervention_reading_review" in insp.get_table_names()
    cols = [c["name"] for c in insp.get_columns("intervention_reading_review")]
    print(f"   intervention_reading_review columns: {cols}")
    assert {"review_id", "intervention_id", "reading_assignment_id", "student_id", "acknowledged_at"}.issubset(set(cols))
    
    uqs = [uq["name"] for uq in insp.get_unique_constraints("intervention_reading_review")]
    print(f"   Unique constraints: {uqs}")
    assert "uq_intervention_reading_review_intervention_assignment" in uqs
    
    fks = [fk["name"] for fk in insp.get_foreign_keys("intervention_reading_review")]
    print(f"   Foreign keys: {fks}")
    assert "fk_intervention_reading_review_intervention" in fks
    assert "fk_intervention_reading_review_reading_assignment" in fks
    assert "fk_intervention_reading_review_student" in fks
    
    # 2. Reverify intervention 7, assignment 18, and Reading assignments 16, 17, 14 exist
    inv_row = conn.execute(text("SELECT intervention_id, student_id, status FROM intervention WHERE intervention_id = 7")).first()
    print(f"\n2. Intervention 7: {inv_row}")
    assert inv_row is not None and inv_row[0] == 7 and inv_row[2] == "ACTIVE"
    student_id = inv_row[1]
    
    asg_18 = conn.execute(text("SELECT classwork_assignment_id, classwork_id, recipient_student_id, source_intervention_id FROM classwork_assignment WHERE classwork_assignment_id = 18")).first()
    print(f"   Assignment 18: {asg_18}")
    assert asg_18 is not None and asg_18[0] == 18 and asg_18[2] == student_id and asg_18[3] == 7
    
    reading_asgs = conn.execute(text("SELECT classwork_assignment_id, classwork_id, recipient_student_id FROM classwork_assignment WHERE classwork_assignment_id IN (14, 16, 17) ORDER BY classwork_assignment_id")).fetchall()
    print(f"   Reading Assignments: {reading_asgs}")
    assert len(reading_asgs) == 3
    
    # 3. Authenticated Student API Verification
    student_user = conn.execute(text("""
        SELECT u.user_id, u.email 
        FROM student s 
        JOIN user_account u ON u.user_id = s.user_id 
        WHERE s.student_id = :sid
    """), {"sid": student_id}).first()
    print(f"\n3. Authenticated Student: {student_user}")
    assert student_user is not None
    user_id = student_user[0]
    email = student_user[1]

# Set up TestClient with auth override for student
app.dependency_overrides[get_current_user] = lambda: {"sub": str(user_id), "role": "student", "email": email}

client = TestClient(app)

# Query Study Support endpoint
resp = client.get("/api/v1/student/interventions/7")
if resp.status_code == 404:
    resp = client.get("/student/interventions/7")
assert resp.status_code == 200, f"Failed to get student intervention 7: {resp.status_code} {resp.text}"
data = resp.json()

print("\n--- Student Study Support API Data ---")
print(f"Intervention ID: {data['intervention_id']}")
print(f"Preparation Summary: {data['preparation']}")

assert data["preparation"]["completed_count"] == 0, f"Expected 0 completed_count, got {data['preparation']['completed_count']}"
assert data["preparation"]["required_count"] == 3, f"Expected 3 required_count, got {data['preparation']['required_count']}"
assert data["preparation"]["state"] == "NOT_STARTED", f"Expected NOT_STARTED, got {data['preparation']['state']}"
assert data["preparation"]["is_satisfied"] is False, "Expected is_satisfied to be False"
assert data["preparation"]["summary"] == "0 of 3 completed"

# Verify readings in intervention detail
print("\nReadings in Intervention:")
assert len(data["required_readings"]) == 3
for r in data["required_readings"]:
    print(f"  Assignment {r['assignment_id']} ({r['title']}): completion_status={r['completion_status']}, review_status={r['review_status']}, focused_seconds={r['focused_seconds']}, reviewed_at={r['reviewed_at']}")
    assert r["completion_status"] == "COMPLETED", f"Expected COMPLETED for {r['assignment_id']}, got {r['completion_status']}"
    assert r["review_status"] == "NOT_REVIEWED", f"Expected NOT_REVIEWED for {r['assignment_id']}, got {r['review_status']}"
    assert r["reviewed_at"] is None, f"Expected None for reviewed_at, got {r['reviewed_at']}"
    assert r["focused_seconds"] > 0, f"Expected positive focused_seconds, got {r['focused_seconds']}"

# Verify activities
print("\nActivities in Intervention:")
assert len(data["activities"]) == 1
act = data["activities"][0]
print(f"  Activity {act['assignment_id']} ({act['title']}): access_state={act['access_state']}, access_enforced={act['access_enforced']}, prerequisite_code={act['prerequisite_code']}")
assert act["assignment_id"] == 18
assert act["access_state"] == "PREPARATION_REQUIRED"
assert act["access_enforced"] is True
assert act["prerequisite_code"] == "PREPARATION_REQUIRED"

# Verify actual backend access guard blocks assignment 18
read_attempt = client.get("/api/v1/classwork-assignments/assignment/18")
print(f"\nDirect Assignment 18 GET status: {read_attempt.status_code}")
assert read_attempt.status_code == 403, f"Expected 403 Forbidden, got {read_attempt.status_code}"
detail = read_attempt.json()["detail"]
print(f"Denial detail: code={detail['code']}, summary={detail['preparation']['summary']}")
assert detail["code"] == "PREPARATION_REQUIRED"
assert detail["preparation"]["completed_count"] == 0

# 4. Confirm ordinary Classwork completion records and grades remain unchanged
print("\n4. Confirm ordinary Classwork completion records:")
with engine.connect() as conn:
    subs = conn.execute(text("""
        SELECT submission_id, student_id, classwork_assignment_id, status, reading_focused_seconds, submitted_at, grade 
        FROM student_submission 
        WHERE classwork_assignment_id IN (14, 16, 17) 
        ORDER BY classwork_assignment_id
    """)).fetchall()
    for s in subs:
        print(f"  Submission {s[0]}: assignment={s[2]}, status={s[3]}, focused_seconds={s[4]}, grade={s[6]}, submitted_at={s[5]}")
        assert s[3] == "submitted"
        assert s[4] in (18, 19, 39)
        assert s[6] is None
        assert s[5] is not None
        
    # 5. Do not create review acknowledgments yet
    review_count = conn.scalar(text("SELECT count(*) FROM intervention_reading_review"))
    print(f"\n5. Total reviews in intervention_reading_review: {review_count}")
    assert review_count == 0, f"Expected 0 reviews, found {review_count}"

print("\n" + "=" * 60)
print("ALL VERIFICATIONS PASSED SUCCESSFULLY!")
print("=" * 60)

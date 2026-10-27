import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
os.environ["ENV_FILE"] = str(BACKEND_DIR / ".env.demo")

from app.core.Config import settings
from sqlalchemy import create_engine, text, inspect

db_url = urlparse(settings.database_url)
assert db_url.path == "/Entervene_Demo", f"Safety abort: Expected /Entervene_Demo, got {db_url.path}"

engine = create_engine(settings.database_url)

with engine.connect() as conn:
    assert conn.scalar(text("SELECT current_database()")) == "Entervene_Demo"
    initial_rev = conn.scalar(text("SELECT version_num FROM alembic_version"))
    print("Initial revision in Entervene_Demo:", initial_rev)

env = os.environ.copy()
env["ENV_FILE"] = str(BACKEND_DIR / ".env.demo")

# If it is currently at reading_review, downgrade to reading_prerequisite to verify the clean forward migration
if initial_rev == "20261027_reading_review":
    print("Downgrading Entervene_Demo to 20261027_reading_prerequisite...")
    down_res = subprocess.run(
        [sys.executable, "-m", "alembic", "downgrade", "20261027_reading_prerequisite"],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    if down_res.returncode != 0:
        print("Downgrade failed:", down_res.stderr)
        sys.exit(1)
    print(down_res.stdout)

with engine.connect() as conn:
    confirmed_prereq = conn.scalar(text("SELECT version_num FROM alembic_version"))
    print("Confirmed Entervene_Demo revision before upgrade:", confirmed_prereq)
    assert confirmed_prereq == "20261027_reading_prerequisite", f"Expected 20261027_reading_prerequisite, got {confirmed_prereq}"
    
    table_exists_before = conn.scalar(text("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'intervention_reading_review'
        )
    """))
    print("intervention_reading_review exists before upgrade:", table_exists_before)
    assert not table_exists_before, "intervention_reading_review should not exist before upgrade"

# Now apply migration 20261027_reading_review
print("\nApplying migration 20261027_reading_review to Entervene_Demo...")
up_res = subprocess.run(
    [sys.executable, "-m", "alembic", "upgrade", "20261027_reading_review"],
    cwd=BACKEND_DIR,
    env=env,
    capture_output=True,
    text=True,
)
if up_res.returncode != 0:
    print("Upgrade failed:", up_res.stderr)
    sys.exit(1)
print(up_res.stdout)

with engine.connect() as conn:
    final_rev = conn.scalar(text("SELECT version_num FROM alembic_version"))
    print("Confirmed Entervene_Demo revision after upgrade:", final_rev)
    assert final_rev == "20261027_reading_review", f"Expected 20261027_reading_review, got {final_rev}"
    
    table_exists_after = conn.scalar(text("""
        SELECT EXISTS (
            SELECT 1 FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'intervention_reading_review'
        )
    """))
    print("intervention_reading_review exists after upgrade:", table_exists_after)
    assert table_exists_after, "intervention_reading_review must exist after upgrade"
    
    # Check constraints and indexes
    insp = inspect(conn)
    cols = [c['name'] for c in insp.get_columns('intervention_reading_review')]
    print("Columns:", cols)
    assert "review_id" in cols
    assert "intervention_id" in cols
    assert "reading_assignment_id" in cols
    assert "student_id" in cols
    assert "acknowledged_at" in cols
    
    fks = {fk['name'] for fk in insp.get_foreign_keys('intervention_reading_review')}
    print("Foreign keys:", fks)
    assert "fk_intervention_reading_review_intervention" in fks
    assert "fk_intervention_reading_review_reading_assignment" in fks
    assert "fk_intervention_reading_review_student" in fks
    
    uqs = {uq['name'] for uq in insp.get_unique_constraints('intervention_reading_review')}
    print("Unique constraints:", uqs)
    assert "uq_intervention_reading_review_intervention_assignment" in uqs

print("\nMigration cycle completed with 100% verification and safety!")

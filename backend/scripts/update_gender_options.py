"""
update_gender_options.py
========================
Updates all 'Other' genders in the database to 'Male' and standardizes
existing records to 'Male' or 'Female'.
"""

from pathlib import Path
import sys

backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from dotenv import load_dotenv
load_dotenv(backend_dir.parent / ".env")
load_dotenv(backend_dir / ".env")

from sqlalchemy import text
from app.db.Session import SessionLocal

db = SessionLocal()

print("--- BEFORE UPDATE ---")
print("Students:", db.execute(text("SELECT gender, COUNT(*) FROM student GROUP BY gender;")).fetchall())
print("Staff:", db.execute(text("SELECT gender, COUNT(*) FROM academic_staff GROUP BY gender;")).fetchall())

# 1. Update Other -> Male
r1 = db.execute(text("UPDATE student SET gender = 'Male' WHERE gender ILIKE 'other';"))
r2 = db.execute(text("UPDATE academic_staff SET gender = 'Male' WHERE gender ILIKE 'other';"))
print(f"Updated Other -> Male: {r1.rowcount} students, {r2.rowcount} staff")

# 2. Standardize casing
db.execute(text("UPDATE student SET gender = 'Male' WHERE gender ILIKE 'male';"))
db.execute(text("UPDATE student SET gender = 'Female' WHERE gender ILIKE 'female';"))
db.execute(text("UPDATE academic_staff SET gender = 'Male' WHERE gender ILIKE 'male';"))
db.execute(text("UPDATE academic_staff SET gender = 'Female' WHERE gender ILIKE 'female';"))

db.commit()

print("\n--- AFTER UPDATE ---")
print("Students:", db.execute(text("SELECT gender, COUNT(*) FROM student GROUP BY gender;")).fetchall())
print("Staff:", db.execute(text("SELECT gender, COUNT(*) FROM academic_staff GROUP BY gender;")).fetchall())

db.close()

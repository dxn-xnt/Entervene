import os
import sys
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.db.Session import SessionLocal
from app.models.auth.UserAccount import UserAccount
from app.models.people.Student import Student
from app.api.v1.routes.Students import get_my_subjects, get_my_todos, get_my_profile, get_my_class
from app.services.classwork.ClassworkService import student_classworks_for_subject

db = SessionLocal()
user = db.query(UserAccount).filter(UserAccount.email == "manuel.garcia@student.ph").first()
student = db.query(Student).filter(Student.email == "manuel.garcia@student.ph").first()

current_user = {
    "sub": str(user.user_id),
    "email": user.email,
    "role": "student",
}

print("=== 1. MANUEL PROFILE ===")
profile = get_my_profile(current_user=current_user, db=db)
print(profile)

print("\n=== 2. MANUEL CLASS ===")
cls_info = get_my_class(current_user=current_user, db=db)
print(cls_info)

print("\n=== 3. MANUEL ENROLLED SUBJECTS ===")
subjects = get_my_subjects(current_user=current_user, db=db)
print(f"Total Subjects: {len(subjects)}")
for s in subjects:
    print(f"  - [{s['subject_codename'] or s['subject_id']}] {s['subject_name']} | Teacher: {s['teacher_name']} | Section: {s['section_name']} | Period: {s['period_name']}")

print("\n=== 4. MANUEL TODOS ===")
todos = get_my_todos(current_user=current_user, db=db)
print(f"Pending To-Dos ({len(todos['pending'])}):")
for t in todos['pending']:
    print(f"  - [{t['type']}] {t['title']} ({t['subject']}) - Due: {t['deadline']}")

print(f"\nPast Due ({len(todos['pastdue'])}):")
for t in todos['pastdue']:
    print(f"  - [{t['type']}] {t['title']} ({t['subject']})")

print(f"\nCompleted ({len(todos['completed'])}):")
for t in todos['completed']:
    print(f"  - [{t['type']}] {t['title']} ({t['subject']})")

print("\n=== 5. CLASSWORKS PER SUBJECT ===")
for s in subjects[:4]:
    cws = student_classworks_for_subject(class_id=s['class_id'], subject_id=s['subject_id'], student=student, db=db)
    print(f"\nClassworks for {s['subject_name']} (Total: {len(cws)}):")
    for cw in cws:
        print(f"  - [{cw.classwork_type}] {cw.title} (Graded: {cw.is_graded}, Points: {cw.total_points}, Status: {cw.submission_status})")

db.close()

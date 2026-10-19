import os, sys
os.environ['ENV_FILE'] = '.env.demo'
sys.path.insert(0, os.path.abspath('.'))

from app.db.Session import SessionLocal
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.people.Student import Student

db = SessionLocal()
try:
    cws = db.query(Classwork).filter(Classwork.subject_id == 1).order_by(Classwork.classwork_id).all()
    for cw in cws:
        asg = db.query(ClassworkAssignment).filter_by(classwork_id=cw.classwork_id, class_id=1).first()
        subs = db.query(StudentSubmission).filter_by(classwork_assignment_id=asg.classwork_assignment_id).all() if asg else []
        grades = [float(s.grade) for s in subs if s.grade is not None]
        avg_grade = sum(grades) / len(grades) if grades else None
        min_grade = min(grades) if grades else None
        max_grade = max(grades) if grades else None
        
        print(f"CW ID: {cw.classwork_id}")
        print(f"  Title: \"{cw.title}\"")
        print(f"  Type: {cw.classwork_type}, Category: {cw.classwork_category}, Subtype: {cw.exam_subtype}, Mode: {cw.activity_mode}, Points: {cw.total_points}")
        print(f"  Instructions: {cw.instructions}")
        print(f"  Submissions count: {len(subs)}, Graded count: {len(grades)}")
        if grades:
            print(f"  Score Range: {min_grade:.2f} to {max_grade:.2f} (Avg: {avg_grade:.2f}/{cw.total_points} = {avg_grade/float(cw.total_points)*100:.1f}%)")
        print()
finally:
    db.close()

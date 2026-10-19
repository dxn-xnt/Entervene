import os
import sys
from dotenv import dotenv_values
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

# Ensure we use .env.demo strictly
demo_env = dotenv_values(r"c:\Users\Roy Adrian Rondina\Desktop\3rd Year\2nd Sem\Entervene\Entervene\backend\.env.demo")
db_url = demo_env.get("DATABASE_URL")
assert db_url and "Entervene_Demo" in db_url, f"Safety check failed: db_url is {db_url}"
print(f"Verified connected to: {db_url}")

engine = create_engine(db_url)
db = Session(bind=engine)

sys.path.insert(0, r"c:\Users\Roy Adrian Rondina\Desktop\3rd Year\2nd Sem\Entervene\Entervene\backend")

from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.Classwork import Classwork
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.people.Student import Student
from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.Class_ import Class
from app.models.academic.Subject import Subject
from app.models.academic.AcademicPeriod import AcademicPeriod

print("\n" + "=" * 90)
print("1. GRADE 9 MATHEMATICS (DEMO ARCHIMEDES) CONTEXT")
print("=" * 90)

classes = db.query(Class).all()
for c in classes:
    print(f"Class ID {c.class_id}: Section '{c.section_name}', Academic Level ID {c.academic_level_id}, Academic Year ID {c.academic_year_id}")

subject_loads = db.query(SubjectLoad).filter(SubjectLoad.class_id == 1).all()
for sl in subject_loads:
    subj = db.query(Subject).filter(Subject.subject_id == sl.subject_id).first()
    print(f"SubjectLoad: ID {sl.subject_load_id}, Subject: {subj.subject_name} ({subj.subject_codename}), Class ID: {sl.class_id}, Template ID: {subj.grading_template_id}")
    if subj.grading_template_id:
        tmpl = db.query(GradingTemplate).filter(GradingTemplate.grading_template_id == subj.grading_template_id).first()
        comps = db.query(GradingTemplateComponent).filter(GradingTemplateComponent.grading_template_id == subj.grading_template_id).all()
        print(f"  Grading Template: '{tmpl.template_name}'")
        for comp in comps:
            print(f"    Component: {comp.component_name:<25} | Weight: {comp.weight}%")

print("\n" + "=" * 90)
print("2. ALL PUBLISHED CLASSWORK ASSIGNMENTS IN DEMO ARCHIMEDES")
print("=" * 90)

assignments = (
    db.query(ClassworkAssignment, Classwork)
    .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
    .filter(ClassworkAssignment.class_id == 1, ClassworkAssignment.is_published.is_(True))
    .order_by(Classwork.classwork_id)
    .all()
)
print(f"Total Published Classwork Assignments for Class 1: {len(assignments)}")
for ca, cw in assignments:
    cw_lessons = (
        db.query(Lesson.title)
        .join(ClassworkLesson, ClassworkLesson.lesson_id == Lesson.lesson_id)
        .filter(ClassworkLesson.classwork_id == cw.classwork_id)
        .all()
    )
    cw_comps = (
        db.query(Competency.competency_code)
        .join(ClassworkCoverage, ClassworkCoverage.competency_id == Competency.competency_id)
        .filter(ClassworkCoverage.classwork_id == cw.classwork_id)
        .all()
    )
    lessons_str = ", ".join([l[0] for l in cw_lessons]) or "None"
    comps_str = ", ".join([c[0] for c in cw_comps]) or "None"
    cat = cw.classwork_category
    subtype = cw.exam_subtype or "N/A"
    print(f"CA {ca.classwork_assignment_id:2d} | CW {cw.classwork_id:2d} | {cat:<22} | Type: {cw.classwork_type:<10} | Subtype: {subtype:<12} | Max: {cw.total_points:4.0f} | Due: {ca.due_date} | Title: {cw.title}")
    print(f"     Lessons: {lessons_str}")
    print(f"     Competencies: {comps_str}")

print("\n" + "=" * 90)
print("3. ENROLLED STUDENTS IN DEMO ARCHIMEDES (CLASS 1)")
print("=" * 90)

enrolled_students = (
    db.query(Student)
    .join(StudentClass, Student.student_id == StudentClass.student_id)
    .filter(StudentClass.class_id == 1)
    .order_by(Student.last_name, Student.first_name)
    .all()
)
print(f"Total Enrolled Students: {len(enrolled_students)}")

cw_labels = [f"CW{cw.classwork_id:02d}({cw.classwork_category[:2]})" for _, cw in assignments]
header = f"{'Student Name':<24} | LRN          | " + " | ".join(cw_labels)
print(header)
print("-" * len(header))

for s in enrolled_students:
    subs = (
        db.query(StudentSubmission, Classwork)
        .join(ClassworkAssignment, StudentSubmission.classwork_assignment_id == ClassworkAssignment.classwork_assignment_id)
        .join(Classwork, ClassworkAssignment.classwork_id == Classwork.classwork_id)
        .filter(StudentSubmission.student_id == s.student_id, ClassworkAssignment.class_id == 1, ClassworkAssignment.is_published.is_(True))
        .all()
    )
    sub_map = {cw.classwork_id: (sub.status, sub.grade) for sub, cw in subs}
    row_vals = []
    for ca, cw in assignments:
        if cw.classwork_id in sub_map:
            st, gr = sub_map[cw.classwork_id]
            if gr is not None:
                row_vals.append(f"{gr:6.1f}   ")
            else:
                row_vals.append(f" {st[:4]:<6} ")
        else:
            row_vals.append("  ----    ")
    full_name = f"{s.first_name} {s.last_name}"
    print(f"{full_name:<24} | {s.student_lrn} | " + " | ".join(row_vals))

print("\n" + "=" * 90)
print("4. GRADEBOOK VS PREDICTION COMPARISON (ALL 11 STUDENTS)")
print("=" * 90)

from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.services.student_record.StudentRecordService import teacher_student_gradebook

gradebook = teacher_student_gradebook(db, staff_id=subject_loads[0].staff_id, class_id=1, subject_id=1, academic_period_id=1)

print(f"{'Student Name':<24} | {'GB WW%':<7} | {'GB PT%':<7} | {'GB QA%':<7} | {'GB Init':<7} | {'GB Trans':<8} | {'Pred WW%':<8} | {'Pred PT%':<8} | {'Pred QA%':<8} | {'Pred Acad%':<10} | {'Predicted':<9} | {'Risk Level':<15}")
print("-" * 145)

preds = {
    p.student_id: p
    for p in db.query(DevelopmentCurrentTermPrediction)
    .filter(
        DevelopmentCurrentTermPrediction.target_period_id == 1,
    )
    .all()
}

for row in gradebook.studentGrades:
    import uuid
    p = preds.get(uuid.UUID(row.student_id))
    gb_ww = f"{row.ps_written:.1f}%" if row.ps_written is not None else "None"
    gb_pt = f"{row.ps_performance:.1f}%" if row.ps_performance is not None else "None"
    gb_qa = f"{row.ps_exams:.1f}%" if row.ps_exams is not None else "None"
    gb_init = f"{row.initial_grade:.2f}" if row.initial_grade is not None else "None"
    gb_trans = f"{row.transmuted_grade}" if row.transmuted_grade is not None else "None"

    if p:
        features = {
            item["name"]: item["value"]
            for item in (p.evidence_snapshot or {}).get("model_features", [])
        }
        pred_ww = f"{features.get('ww_percent_so_far', 0):.1f}%"
        pred_pt = f"{features.get('pt_percent_so_far', 0):.1f}%"
        pred_qa = f"{features.get('qa_percent_so_far', 0):.1f}%" if features.get('qa_percent_so_far') is not None else "None"
        pred_acad = f"{features.get('overall_partial_percent', 0):.1f}%"
        pred_grade = f"{p.predicted_period_grade:.2f}"
        risk = p.intervention_level
    else:
        pred_ww = pred_pt = pred_qa = pred_acad = pred_grade = risk = "N/A"

    print(f"{row.name:<24} | {gb_ww:<7} | {gb_pt:<7} | {gb_qa:<7} | {gb_init:<7} | {gb_trans:<8} | {pred_ww:<8} | {pred_pt:<8} | {pred_qa:<8} | {pred_acad:<10} | {pred_grade:<9} | {risk:<15}")

db.close()


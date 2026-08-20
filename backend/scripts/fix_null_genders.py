import sys
import os

# Add backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy.orm import Session
from sqlalchemy import or_
from app.db.Session import SessionLocal
from app.models.people.Student import Student

def main():
    print("=== Null Gender Data Fix Script ===")
    
    with SessionLocal() as db:
        # 1. Identify students with missing gender
        students_with_missing_gender = db.query(Student).filter(
            or_(Student.gender.is_(None), Student.gender == "")
        ).all()

        if not students_with_missing_gender:
            print("No students found with missing or empty gender. Exiting.")
            return

        print(f"Found {len(students_with_missing_gender)} students with missing gender.")
        print("Please review the following list against the source e-Class Record spreadsheets:\n")
        
        print(f"{'Student ID':<40} | {'LRN':<15} | {'Name':<30}")
        print("-" * 90)
        for student in students_with_missing_gender:
            name = f"{student.first_name} {student.last_name}"
            print(f"{str(student.student_id):<40} | {student.student_lrn:<15} | {name:<30}")
        
        print("\nDo you want to apply corrections now? (yes/no)")
        choice = input("> ").strip().lower()
        
        if choice != "yes":
            print("Aborting.")
            return

        print("\nEnter corrections in the format 'LRN,gender' (e.g., '123456789012,Female').")
        print("Enter 'done' when finished.")
        
        corrections = {}
        while True:
            line = input("> ").strip()
            if line.lower() == 'done':
                break
            if not line:
                continue
            
            parts = line.split(',')
            if len(parts) != 2:
                print("Invalid format. Use 'LRN,gender'")
                continue
            
            lrn, gender = parts[0].strip(), parts[1].strip()
            if gender.lower() not in ['male', 'female']:
                print("Gender must be 'Male' or 'Female'.")
                continue
                
            corrections[lrn] = gender

        if not corrections:
            print("No corrections provided. Exiting.")
            return

        print(f"\nApplying {len(corrections)} corrections...")
        
        updates = 0
        for lrn, gender in corrections.items():
            student = db.query(Student).filter(Student.student_lrn == lrn).first()
            if student:
                student.gender = gender
                updates += 1
                print(f"Updated LRN {lrn} to {gender}.")
            else:
                print(f"Warning: Student with LRN {lrn} not found.")

        db.commit()
        print(f"\nSuccessfully updated {updates} students.")

if __name__ == "__main__":
    main()

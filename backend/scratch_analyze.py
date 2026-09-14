from app.db.Session import SessionLocal
from app.models.people.Student import Student
from app.models.academic.StudentCLass import StudentClass
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.auth.Role import Role
from app.models.people.AcademicStaff import AcademicStaff
from app.models.ai.AIPrediction import AIPrediction
from app.models.ai.TeacherRiskReview import TeacherRiskReview
from app.models.suggestion.StudentSuggestion import StudentSuggestion
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.attendance.Attendance import AttendanceRecord, LeaveRequest
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.StudentAssessmentScore import StudentAssessmentScore
from app.models.academic.GradeSubmissionLog import GradeSubmissionLog
from sqlalchemy import func

db = SessionLocal()

# 1. Total counts
total_students = db.query(Student).count()
enrolled_ids = set(r[0] for r in db.query(StudentClass.student_id).distinct().all())
all_student_ids = set(r[0] for r in db.query(Student.student_id).all())
unenrolled_ids = all_student_ids - enrolled_ids

print("=== STUDENT COUNTS ===")
print(f"Total students in DB: {total_students}")
print(f"Enrolled students (in StudentClass): {len(enrolled_ids)}")
print(f"Unenrolled students: {len(unenrolled_ids)}")

# 2. Check UserAccounts for enrolled vs unenrolled
enrolled_with_user = db.query(Student).filter(Student.student_id.in_(enrolled_ids), Student.user_id.isnot(None)).count()
unenrolled_with_user = db.query(Student).filter(Student.student_id.in_(unenrolled_ids), Student.user_id.isnot(None)).count()
print(f"Enrolled students with UserAccount: {enrolled_with_user}")
print(f"Unenrolled students with UserAccount: {unenrolled_with_user}")

# 3. Check what tables reference the unenrolled students
print("\n=== REFERENCES TO UNENROLLED STUDENTS ===")
for model, name in [
    (AIPrediction, "AIPrediction"),
    (TeacherRiskReview, "TeacherRiskReview"),
    (StudentSuggestion, "StudentSuggestion"),
    (StudentSubmission, "StudentSubmission"),
    (AttendanceRecord, "AttendanceRecord"),
    (LeaveRequest, "LeaveRequest"),
    (StudentPeriodGrade, "StudentPeriodGrade"),
    (StudentAssessmentScore, "StudentAssessmentScore"),
    (GradeSubmissionLog, "GradeSubmissionLog"),
]:
    count = db.query(model).filter(model.student_id.in_(unenrolled_ids)).count() if unenrolled_ids else 0
    print(f"{name}: {count} records")

# 4. Check what tables reference the 80 enrolled students
print("\n=== REFERENCES TO ENROLLED (80) STUDENTS ===")
for model, name in [
    (AIPrediction, "AIPrediction"),
    (TeacherRiskReview, "TeacherRiskReview"),
    (StudentSuggestion, "StudentSuggestion"),
    (StudentSubmission, "StudentSubmission"),
    (AttendanceRecord, "AttendanceRecord"),
    (LeaveRequest, "LeaveRequest"),
    (StudentPeriodGrade, "StudentPeriodGrade"),
    (StudentAssessmentScore, "StudentAssessmentScore"),
    (GradeSubmissionLog, "GradeSubmissionLog"),
]:
    count = db.query(model).filter(model.student_id.in_(enrolled_ids)).count() if enrolled_ids else 0
    print(f"{name}: {count} records")

# 5. Check sample unenrolled students
print("\n=== SAMPLE UNENROLLED STUDENTS (First 5) ===")
sample_unenrolled = db.query(Student).filter(Student.student_id.in_(list(unenrolled_ids)[:5])).all()
for s in sample_unenrolled:
    print(f"  ID: {s.student_id} | LRN: {s.student_lrn} | Name: {s.first_name} {s.last_name} | Created: {s.created_at} | User: {s.user_id}")

# 6. Check sample enrolled students
print("\n=== SAMPLE ENROLLED STUDENTS (First 5) ===")
sample_enrolled = db.query(Student).filter(Student.student_id.in_(list(enrolled_ids)[:5])).all()
for s in sample_enrolled:
    sc = db.query(StudentClass).filter(StudentClass.student_id == s.student_id).first()
    u = db.query(UserAccount).filter(UserAccount.user_id == s.user_id).first() if s.user_id else None
    print(f"  ID: {s.student_id} | LRN: {s.student_lrn} | Name: {s.first_name} {s.last_name} | Class: {sc.class_id if sc else None} | Email: {u.email if u else None}")

# 7. Total UserAccount breakdown
total_users = db.query(UserAccount).count()
print("\n=== USER ACCOUNT SUMMARY ===")
print(f"Total UserAccounts: {total_users}")
user_roles = db.query(Role.role_name, func.count(UserRoles.user_id)).join(UserRoles, Role.role_id == UserRoles.role_id).group_by(Role.role_name).all()
for rname, cnt in user_roles:
    print(f"  Role {rname}: {cnt} users")

# 8. Check if there are users with "unknown" or orphaned users
student_user_ids = set(r[0] for r in db.query(Student.user_id).filter(Student.user_id.isnot(None)).all())
staff_user_ids = set(r[0] for r in db.query(AcademicStaff.user_id).filter(AcademicStaff.user_id.isnot(None)).all())
all_user_ids = set(r[0] for r in db.query(UserAccount.user_id).all())
orphaned_users = all_user_ids - student_user_ids - staff_user_ids
print(f"\nOrphaned UserAccounts (not linked to Student or Staff): {len(orphaned_users)}")
for u in db.query(UserAccount).filter(UserAccount.user_id.in_(list(orphaned_users)[:10])).all():
    roles = [r.role_name for r in db.query(Role).join(UserRoles, Role.role_id == UserRoles.role_id).filter(UserRoles.user_id == u.user_id).all()]
    print(f"  User: {u.user_id} | Email: {u.email} | Roles: {roles} | Created: {u.created_at}")

# 9. Search for "unknown" across Student and UserAccount
print("\n=== SEARCH FOR 'UNKNOWN' ===")
unknown_students = db.query(Student).filter(
    (func.lower(Student.first_name).like('%unknown%')) |
    (func.lower(Student.last_name).like('%unknown%')) |
    (func.lower(Student.email).like('%unknown%'))
).count()
print(f"Students with 'unknown' in name/email: {unknown_students}")

unknown_users = db.query(UserAccount).filter(
    func.lower(UserAccount.email).like('%unknown%')
).count()
print(f"UserAccounts with 'unknown' in email: {unknown_users}")

db.close()

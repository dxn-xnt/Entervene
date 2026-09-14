from app.db.Session import SessionLocal
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.auth.Role import Role
from app.models.people.Student import Student
from app.models.people.AcademicStaff import AcademicStaff

db = SessionLocal()

student_uids = {s.user_id for s in db.query(Student).filter(Student.user_id.isnot(None)).all()}
staff_uids = {s.user_id for s in db.query(AcademicStaff).filter(AcademicStaff.user_id.isnot(None)).all()}
all_users = db.query(UserAccount).all()

print(f"Total Users in UserAccount: {len(all_users)}")
print(f"Users attached to Student: {len(student_uids)}")
print(f"Users attached to AcademicStaff: {len(staff_uids)}")

other_users = [u for u in all_users if u.user_id not in student_uids and u.user_id not in staff_uids]
print(f"Other Users (not Student or Staff): {len(other_users)}")
for u in other_users:
    roles = [r.role_name for r in db.query(Role).join(UserRoles, Role.role_id == UserRoles.role_id).filter(UserRoles.user_id == u.user_id).all()]
    print(f"  {u.email} | ID: {u.user_id} | roles: {roles} | status: {u.account_status}")

db.close()

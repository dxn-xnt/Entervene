"""Link login accounts to existing Demo students for remediation acceptance.

Run with ENV_FILE=.env.demo. Credentials are generated once and kept in the
gitignored .demo-fixtures directory; the command never prints them.
"""

from __future__ import annotations

import argparse
import json
import os
import secrets
import sys
from pathlib import Path

from dotenv import load_dotenv
from sqlalchemy import create_engine, func, select, text
from sqlalchemy.orm import Session

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
load_dotenv(os.getenv("ENV_FILE", BACKEND_DIR / ".env.demo"))

from app.core.Config import settings  # noqa: E402
from app.core.Security import hash_password  # noqa: E402
from app.models.academic.StudentCLass import StudentClass  # noqa: E402
from app.models.auth.Role import Role  # noqa: E402
from app.models.auth.UserAccount import UserAccount  # noqa: E402
from app.models.auth.UserRoles import UserRoles  # noqa: E402
from app.models.intervention.Intervention import Intervention  # noqa: E402
from app.models.people.Student import Student  # noqa: E402
from scripts.seed_current_term_demo import require_demo_database  # noqa: E402

CREDENTIALS_PATH = BACKEND_DIR / ".demo-fixtures" / "i5i-a-student-logins.json"
EMAILS = {
    "target": "demo-remediation-target@example.com",
    "classmate": "demo-remediation-classmate@example.com",
}


def require_safe_demo_connection(session: Session) -> None:
    """Fail closed before writes, including when a caller supplies another bind."""
    if settings.app_environment.casefold() != "development":
        raise ValueError("Demo account provisioning requires APP_ENVIRONMENT=development")
    url = require_demo_database(str(session.get_bind().url))
    if url.database != "Entervene_Demo":
        raise ValueError("Demo account provisioning requires Entervene_Demo")
    database = session.execute(text("select current_database()")).scalar_one()
    if database != "Entervene_Demo":
        raise ValueError("Connected database is not Entervene_Demo")


def select_students(session: Session) -> tuple[Intervention, Student, Student]:
    active = session.scalars(select(Intervention).where(Intervention.status == "ACTIVE")).all()
    if len(active) != 1:
        raise ValueError("Expected exactly one ACTIVE Demo Intervention")
    intervention = active[0]
    target = session.get(Student, intervention.student_id)
    if target is None:
        raise ValueError("Intervention target Student is missing")
    enrolled = session.scalars(
        select(Student)
        .join(StudentClass, StudentClass.student_id == Student.student_id)
        .where(StudentClass.class_id == intervention.class_id,
               StudentClass.enrollment_status == "enrolled")
        .order_by(Student.student_id)
    ).all()
    if target.student_id not in {student.student_id for student in enrolled}:
        raise ValueError("Intervention target is not enrolled in its class")
    classmates = [student for student in enrolled if student.student_id != target.student_id]
    if not classmates:
        raise ValueError("No enrolled same-class comparison Student exists")
    classmate = next((student for student in classmates
                      if student.user_id is not None
                      and (account := session.get(UserAccount, student.user_id)) is not None
                      and account.email.lower() == EMAILS["classmate"]), None)
    if classmate is None:
        classmate = next((student for student in classmates if student.user_id is None), classmates[0])
    return intervention, target, classmate


def provision_existing_student(session: Session, student: Student, email: str,
                               password: str, student_role_id: int) -> str:
    """Create one login link or validate the existing one without resetting it."""
    existing_email = session.scalar(select(UserAccount).where(func.lower(UserAccount.email) == email.lower()))
    if student.user_id is not None:
        account = session.get(UserAccount, student.user_id)
        if account is None or account.email.lower() != email.lower() or existing_email != account:
            raise ValueError("Student has a different or broken account link")
        if account.account_status != "active" or not account.password_hash:
            raise ValueError("Existing Student account is not usable")
        role = session.get(UserRoles, (account.user_id, student_role_id))
        if role is None:
            raise ValueError("Existing Student account lacks the Student role")
        roles = session.scalars(select(UserRoles.role_id).where(UserRoles.user_id == account.user_id)).all()
        if roles != [student_role_id]:
            raise ValueError("Existing Student account has unexpected roles")
        return "reused"
    if existing_email is not None:
        raise ValueError("Demo account email is already used by another User")
    if len(password) < 12:
        raise ValueError("Demo password is too short")
    account = UserAccount(email=email, password_hash=hash_password(password),
                          account_status="active", email_status="verified")
    session.add(account)
    session.flush()
    session.add(UserRoles(user_id=account.user_id, role_id=student_role_id))
    student.user_id = account.user_id
    return "created"


def _read_or_create_credentials() -> tuple[dict[str, dict[str, str]], bool]:
    if CREDENTIALS_PATH.exists():
        data = json.loads(CREDENTIALS_PATH.read_text(encoding="utf-8"))
        if {key: data[key]["email"] for key in EMAILS} != EMAILS:
            raise ValueError("Local Demo credential file has unexpected accounts")
        return data, False
    data = {key: {"email": email, "password": secrets.token_urlsafe(32)}
            for key, email in EMAILS.items()}
    return data, True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inspect", action="store_true", help="Read-only Demo preflight")
    args = parser.parse_args()
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    try:
        with Session(engine) as session:
            require_safe_demo_connection(session)
            intervention, target, classmate = select_students(session)
            if args.inspect:
                print("APP_ENVIRONMENT", settings.app_environment)
                print("CURRENT_DATABASE", session.execute(text("select current_database()")).scalar_one())
                print("ALEMBIC", session.execute(text("select version_num from alembic_version")).scalar_one())
                print("Intervention", intervention.intervention_id, intervention.status,
                      "class", intervention.class_id, "subject", intervention.subject_id,
                      "period", intervention.academic_period_id,
                      "teacher_choice", (intervention.remediation_plan or {}).get("teacher_choice"))
                print("Target", target.student_id, "linked", target.user_id is not None)
                print("Classmate", classmate.student_id, "linked", classmate.user_id is not None)
                print("Targeted assignments", session.execute(text(
                    "select count(*) from classwork_assignment where recipient_student_id is not null"
                )).scalar_one())
                return
            student_role = session.scalar(select(Role).where(Role.role_name == "Student"))
            if student_role is None:
                raise ValueError("Student role is missing")
            credentials, new_file = _read_or_create_credentials()
            before = {student.student_id: (student.student_lrn,
                      tuple(sorted((row.class_id, row.academic_year_id, row.enrollment_status)
                                   for row in student.student_classes)))
                      for student in (target, classmate)}
            results = {}
            for label, student in (("target", target), ("classmate", classmate)):
                item = credentials[label]
                results[label] = provision_existing_student(
                    session, student, item["email"], item["password"], student_role.role_id)
            session.flush()
            for student in (target, classmate):
                after = (student.student_lrn,
                         tuple(sorted((row.class_id, row.academic_year_id, row.enrollment_status)
                                      for row in student.student_classes)))
                if before[student.student_id] != after:
                    raise ValueError("Student identity or enrollment changed")
            if intervention.student_id != target.student_id:
                raise ValueError("Intervention target changed")
            if new_file:
                CREDENTIALS_PATH.parent.mkdir(parents=True, exist_ok=True)
                with CREDENTIALS_PATH.open("x", encoding="utf-8") as handle:
                    json.dump(credentials, handle)
            session.commit()
            print("Intervention", intervention.intervention_id)
            for label, student in (("target", target), ("classmate", classmate)):
                print(label, student.student_id, EMAILS[label], results[label])
            print("Local credentials:", CREDENTIALS_PATH)
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()

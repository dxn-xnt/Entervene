from datetime import date
import uuid
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.v1.routes.Competencies import router as competencies_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.LessonAttachment import LessonAttachment
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Subject.__table__,
    AcademicPeriod.__table__,
    Class.__table__,
    SubjectLoad.__table__,
    Competency.__table__,
    Lesson.__table__,
    LessonAssignment.__table__,
    LessonAttachment.__table__,
]


def setup_test_db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine, tables=TABLES)
    Session = sessionmaker(bind=engine)
    db = Session()

    # Seed Academic Year & Level
    year = AcademicYear(
        academic_year_id=1,
        year_label="2026-2027",
        start_date=date(2026, 8, 1),
        end_date=date(2027, 5, 31),
        is_active=True,
    )
    level = AcademicLevel(academic_level_id=1, level_name="Grade 8", grade_level=8)
    period = AcademicPeriod(
        academic_period_id=1,
        academic_year_id=1,
        period_name="Quarter 1",
        period_type="QUARTER",
        period_sequence=1,
        total_periods_in_year=4,
        period_progress_ratio=0.25,
        start_date=date(2026, 8, 1),
        end_date=date(2026, 10, 31),
        is_active=True,
    )

    # Seed Teacher A
    user_a_id = uuid.uuid4()
    user_a = UserAccount(user_id=user_a_id, email="teacherA@school.edu", password_hash="hash", account_status="ACTIVE")
    staff_a = AcademicStaff(staff_id="STAFF_A", user_id=user_a_id, first_name="Maria", last_name="Santos")

    # Seed Teacher B
    user_b_id = uuid.uuid4()
    user_b = UserAccount(user_id=user_b_id, email="teacherB@school.edu", password_hash="hash", account_status="ACTIVE")
    staff_b = AcademicStaff(staff_id="STAFF_B", user_id=user_b_id, first_name="Juan", last_name="Dela Cruz")

    # Seed Admin User
    user_admin_id = uuid.uuid4()
    user_admin = UserAccount(user_id=user_admin_id, email="admin@school.edu", password_hash="hash", account_status="ACTIVE")

    # Seed Subject Math 8
    subject = Subject(subject_id=5, subject_name="Mathematics 8", subject_codename="MATH8")

    # Seed Sections: Newton and Einstein
    class_newton = Class(class_id=10, section_name="Grade 8 - Newton", academic_year_id=1, academic_level_id=1)
    class_einstein = Class(class_id=20, section_name="Grade 8 - Einstein", academic_year_id=1, academic_level_id=1)

    # Seed SubjectLoads
    load_newton_a = SubjectLoad(subject_load_id=1, staff_id="STAFF_A", subject_id=5, class_id=10, academic_period_id=1)
    load_einstein_a = SubjectLoad(subject_load_id=2, staff_id="STAFF_A", subject_id=5, class_id=20, academic_period_id=1)

    db.add_all([
        year, level, period, user_a, staff_a, user_b, staff_b, user_admin,
        subject, class_newton, class_einstein, load_newton_a, load_einstein_a,
    ])
    db.commit()

    return db, {
        "user_a_id": user_a_id,
        "staff_a_id": "STAFF_A",
        "user_b_id": user_b_id,
        "staff_b_id": "STAFF_B",
        "user_admin_id": user_admin_id,
        "subject_id": 5,
    }


def create_client(db, current_user_dict):
    from app.api.v1.routes.Auth import get_current_user
    app = FastAPI()
    app.include_router(competencies_router, prefix="/api/v1/competencies")

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: current_user_dict

    return TestClient(app)


def test_competency_lifecycle():
    db, ctx = setup_test_db()
    client = create_client(db, {
        "sub": str(ctx["user_a_id"]),
        "user_id": str(ctx["user_a_id"]),
        "role": "teacher",
    })

    # 1. Create Competency
    create_payload = {
        "competency_code": "M8AL-Ia-1",
        "statement": "Factors completely different types of polynomials.",
        "description": "Quarter 1 week 1",
        "subject_id": ctx["subject_id"],
        "order_index": 1,
        "target_hours": 4,
    }
    resp = client.post("/api/v1/competencies/", json=create_payload)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    comp_id = data["competency_id"]
    assert data["competency_code"] == "M8AL-Ia-1"
    assert data["created_by_staff_id"] == "STAFF_A"
    assert data["teacher_name"] == "Maria Santos"

    # 2. Get by Subject as Teacher A
    resp = client.get(f"/api/v1/competencies/subject/{ctx['subject_id']}")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["competency_id"] == comp_id

    # 3. Update Competency as Teacher A
    update_payload = {
        "target_hours": 6,
        "statement": "Updated statement: Factors completely different types of polynomials (common monomial factor).",
    }
    resp = client.put(f"/api/v1/competencies/{comp_id}", json=update_payload)
    assert resp.status_code == 200
    assert resp.json()["target_hours"] == 6

    # 4. Archive Competency
    resp = client.delete(f"/api/v1/competencies/{comp_id}")
    assert resp.status_code == 200
    assert resp.json()["is_archived"] is True


def test_competency_per_teacher_scoping_and_cross_teacher_isolation():
    db, ctx = setup_test_db()

    client_a = create_client(db, {
        "sub": str(ctx["user_a_id"]),
        "user_id": str(ctx["user_a_id"]),
        "role": "teacher",
    })
    client_b = create_client(db, {
        "sub": str(ctx["user_b_id"]),
        "user_id": str(ctx["user_b_id"]),
        "role": "teacher",
    })

    # Teacher A creates 2 competencies for Math 8
    c1_resp = client_a.post("/api/v1/competencies/", json={
        "competency_code": "M8AL-Ia-1",
        "statement": "Teacher A Polynomials",
        "subject_id": ctx["subject_id"],
        "order_index": 1,
    })
    c1_id = c1_resp.json()["competency_id"]

    c2_resp = client_a.post("/api/v1/competencies/", json={
        "competency_code": "M8AL-Ia-2",
        "statement": "Teacher A Rational Algebraic Expressions",
        "subject_id": ctx["subject_id"],
        "order_index": 2,
    })
    c2_id = c2_resp.json()["competency_id"]

    # Teacher B queries Math 8 -> MUST receive empty list (0 competencies)
    resp_b = client_b.get(f"/api/v1/competencies/subject/{ctx['subject_id']}")
    assert resp_b.status_code == 200
    assert len(resp_b.json()) == 0, "Teacher B must NOT see Teacher A's competencies"

    # Teacher A queries Math 8 -> receives both competencies
    resp_a = client_a.get(f"/api/v1/competencies/subject/{ctx['subject_id']}")
    assert resp_a.status_code == 200
    assert len(resp_a.json()) == 2
    assert {c["competency_id"] for c in resp_a.json()} == {c1_id, c2_id}

    # Teacher B attempts to update Teacher A's competency -> 403 Forbidden
    unauth_update = client_b.put(f"/api/v1/competencies/{c1_id}", json={"statement": "Hacked"})
    assert unauth_update.status_code == 403

    # Teacher B attempts to delete Teacher A's competency -> 403 Forbidden
    unauth_delete = client_b.delete(f"/api/v1/competencies/{c1_id}")
    assert unauth_delete.status_code == 403

    # Teacher B creates their own competency
    cb_resp = client_b.post("/api/v1/competencies/", json={
        "competency_code": "M8AL-Ib-1",
        "statement": "Teacher B Linear Equations",
        "subject_id": ctx["subject_id"],
        "order_index": 1,
    })
    cb_id = cb_resp.json()["competency_id"]

    # Verify Teacher B now sees only their 1 competency
    resp_b2 = client_b.get(f"/api/v1/competencies/subject/{ctx['subject_id']}")
    assert resp_b2.status_code == 200
    assert len(resp_b2.json()) == 1
    assert resp_b2.json()[0]["competency_id"] == cb_id

    # Verify Teacher A still sees only their 2 competencies
    resp_a2 = client_a.get(f"/api/v1/competencies/subject/{ctx['subject_id']}")
    assert resp_a2.status_code == 200
    assert len(resp_a2.json()) == 2


def test_competency_multi_section_shared_for_same_teacher():
    """Teacher A handling two sections of Math 8 (Newton & Einstein) sees the same competencies across both."""
    db, ctx = setup_test_db()
    client_a = create_client(db, {
        "sub": str(ctx["user_a_id"]),
        "user_id": str(ctx["user_a_id"]),
        "role": "teacher",
    })

    # Teacher A creates competency
    c_resp = client_a.post("/api/v1/competencies/", json={
        "competency_code": "M8AL-Ia-1",
        "statement": "Factors polynomials",
        "subject_id": ctx["subject_id"],
        "order_index": 1,
    })
    comp_id = c_resp.json()["competency_id"]

    # Tree for Section Newton (class_id=10)
    resp_newton = client_a.get(f"/api/v1/competencies/tree/subject/{ctx['subject_id']}?class_id=10")
    assert resp_newton.status_code == 200
    tree_newton = resp_newton.json()
    assert len(tree_newton["competencies"]) == 1
    assert tree_newton["competencies"][0]["competency_id"] == comp_id

    # Tree for Section Einstein (class_id=20)
    resp_einstein = client_a.get(f"/api/v1/competencies/tree/subject/{ctx['subject_id']}?class_id=20")
    assert resp_einstein.status_code == 200
    tree_einstein = resp_einstein.json()
    assert len(tree_einstein["competencies"]) == 1
    assert tree_einstein["competencies"][0]["competency_id"] == comp_id


def test_competency_admin_scoping_and_filtering():
    """Admin can view all competencies or filter by teacher staff_id."""
    db, ctx = setup_test_db()

    client_a = create_client(db, {"sub": str(ctx["user_a_id"]), "user_id": str(ctx["user_a_id"]), "role": "teacher"})
    client_b = create_client(db, {"sub": str(ctx["user_b_id"]), "user_id": str(ctx["user_b_id"]), "role": "teacher"})
    client_admin = create_client(db, {"sub": str(ctx["user_admin_id"]), "user_id": str(ctx["user_admin_id"]), "role": "admin"})

    client_a.post("/api/v1/competencies/", json={"statement": "Comp by Teacher A", "subject_id": ctx["subject_id"]})
    client_b.post("/api/v1/competencies/", json={"statement": "Comp by Teacher B", "subject_id": ctx["subject_id"]})

    # Admin without staff_id -> sees both (2)
    resp_all = client_admin.get(f"/api/v1/competencies/subject/{ctx['subject_id']}")
    assert resp_all.status_code == 200
    assert len(resp_all.json()) == 2

    # Admin filtering by staff_id=STAFF_A -> sees only Teacher A's (1)
    resp_a = client_admin.get(f"/api/v1/competencies/subject/{ctx['subject_id']}?staff_id=STAFF_A")
    assert resp_a.status_code == 200
    assert len(resp_a.json()) == 1
    assert resp_a.json()[0]["statement"] == "Comp by Teacher A"

    # Admin filtering by staff_id=STAFF_B -> sees only Teacher B's (1)
    resp_b = client_admin.get(f"/api/v1/competencies/subject/{ctx['subject_id']}?staff_id=STAFF_B")
    assert resp_b.status_code == 200
    assert len(resp_b.json()) == 1
    assert resp_b.json()[0]["statement"] == "Comp by Teacher B"


def test_student_and_fallback_safety():
    """Non-admin callers without a resolved staff_id return empty list (never leak all competencies)."""
    db, ctx = setup_test_db()
    client_a = create_client(db, {"sub": str(ctx["user_a_id"]), "user_id": str(ctx["user_a_id"]), "role": "teacher"})
    client_a.post("/api/v1/competencies/", json={"statement": "Comp by Teacher A", "subject_id": ctx["subject_id"]})

    # Student with class_id=10 (Section Newton handled by Teacher A)
    client_student = create_client(db, {"sub": str(uuid.uuid4()), "user_id": str(uuid.uuid4()), "role": "student"})
    resp_student = client_student.get(f"/api/v1/competencies/tree/subject/{ctx['subject_id']}?class_id=10")
    assert resp_student.status_code == 200
    assert len(resp_student.json()["competencies"]) == 1

    # Student without class_id -> returns 0 competencies (does not leak raw list)
    resp_unscoped = client_student.get(f"/api/v1/competencies/subject/{ctx['subject_id']}")
    assert resp_unscoped.status_code == 200
    assert len(resp_unscoped.json()) == 0

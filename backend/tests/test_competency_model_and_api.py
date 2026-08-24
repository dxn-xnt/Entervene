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
from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonAssignment import LessonAssignment
from app.models.academic.LessonAttachment import LessonAttachment
from app.models.academic.Subject import Subject
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    UserAccount.__table__,
    AcademicStaff.__table__,
    Subject.__table__,
    AcademicPeriod.__table__,
    Competency.__table__,
    Lesson.__table__,
    LessonAssignment.__table__,
    LessonAttachment.__table__,
]


def test_competency_lifecycle():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine, tables=TABLES)
    Session = sessionmaker(bind=engine)
    db = Session()

    # Seed User & Staff
    user_uid = uuid.uuid4()
    user = UserAccount(
        user_id=user_uid,
        email="teacher@entervene.edu",
        password_hash="hash",
        account_status="ACTIVE",
    )
    staff = AcademicStaff(
        staff_id="STF001",
        user_id=user_uid,
        first_name="Maria",
        last_name="Santos",
    )
    subject = Subject(
        subject_id=101,
        subject_name="Mathematics 7",
        subject_codename="MATH7",
    )
    db.add_all([user, staff, subject])
    db.commit()

    app = FastAPI()
    app.include_router(competencies_router, prefix="/api/v1/competencies")

    def override_get_db():
        try:
            yield db
        finally:
            pass

    from app.api.v1.routes.Auth import get_current_user
    from app.core.Dependencies import get_staff_id

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(user_uid),
        "user_id": str(user_uid),
        "role": "teacher",
    }
    app.dependency_overrides[get_staff_id] = lambda: "STF001"


    client = TestClient(app)

    # 1. Create Competency
    create_payload = {
        "competency_code": "M7AL-IIa-1",
        "statement": "Translates verbal phrases to mathematical expressions and vice versa.",
        "description": "Quarter 2 first week learning competency",
        "subject_id": 101,
        "order_index": 1,
        "target_hours": 4,
    }
    resp = client.post("/api/v1/competencies/", json=create_payload)
    assert resp.status_code == 201, resp.text
    data = resp.json()
    comp_id = data["competency_id"]
    assert data["competency_code"] == "M7AL-IIa-1"
    assert data["statement"] == create_payload["statement"]
    assert data["subject_id"] == 101
    assert data["target_hours"] == 4
    assert data["teacher_name"] == "Maria Santos"

    # 2. Get by Subject
    resp = client.get("/api/v1/competencies/subject/101")
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["competency_id"] == comp_id

    # 3. Create Lesson linked to this competency (nullable check)
    lesson = Lesson(
        title="Translating Algebraic Expressions",
        subject_id=101,
        competency_id=comp_id,
        created_by_staff_id="STF001",
    )
    # Also create an unassigned lesson
    unassigned_lesson = Lesson(
        title="Introductory Math Games",
        subject_id=101,
        competency_id=None,
        created_by_staff_id="STF001",
    )
    db.add_all([lesson, unassigned_lesson])
    db.commit()

    # Query competency to verify relationship
    reloaded_comp = db.query(Competency).filter(Competency.competency_id == comp_id).first()
    assert len(reloaded_comp.lessons) == 1
    assert reloaded_comp.lessons[0].title == "Translating Algebraic Expressions"

    # 4. Check Hierarchy Tree Endpoint
    resp = client.get("/api/v1/competencies/tree/subject/101")
    assert resp.status_code == 200, resp.text
    tree = resp.json()
    assert tree["subject_id"] == 101
    assert len(tree["competencies"]) == 1
    assert len(tree["competencies"][0]["lessons"]) == 1
    assert tree["competencies"][0]["lessons"][0]["title"] == "Translating Algebraic Expressions"
    assert len(tree["unassigned_lessons"]) == 1
    assert tree["unassigned_lessons"][0]["title"] == "Introductory Math Games"

    # 5. Update Competency
    update_payload = {
        "target_hours": 6,
        "statement": "Updated statement: Translates verbal phrases to expressions.",
    }
    resp = client.put(f"/api/v1/competencies/{comp_id}", json=update_payload)
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["target_hours"] == 6
    assert updated["statement"] == update_payload["statement"]

    # 6. Archive Competency
    resp = client.delete(f"/api/v1/competencies/{comp_id}")
    assert resp.status_code == 200
    assert resp.json()["is_archived"] is True

    # Check that default listing excludes archived
    resp = client.get("/api/v1/competencies/subject/101")
    assert resp.status_code == 200
    assert len(resp.json()) == 0

    # Check with include_archived=true
    resp = client.get("/api/v1/competencies/subject/101?include_archived=true")
    assert resp.status_code == 200
    assert len(resp.json()) == 1

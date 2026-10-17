import uuid
from datetime import date
from decimal import Decimal

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Classes import router as classes_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPathway import AcademicPathway
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.OfficialSection import OfficialSection
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.classes.ClassService import build_student_class_assignment
from app.services.classes.ClassShared import ClassManagementError, class_management_error_handler
from app.services.classes.ExistingClassDistributionService import (
    commit_existing_class_distribution,
    format_student_display_name,
    preview_existing_class_distribution,
)


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    lrn_check = next(
        (c for c in Student.__table__.constraints if isinstance(c, CheckConstraint) and c.name == "lrn_check"),
        None,
    )
    if lrn_check and lrn_check in Student.__table__.constraints:
        Student.__table__.constraints.remove(lrn_check)
    try:
        Base.metadata.create_all(bind=engine)
    finally:
        if lrn_check and lrn_check not in Student.__table__.constraints:
            Student.__table__.append_constraint(lrn_check)

    session = sessionmaker(bind=engine)()
    session.add_all([
        Role(role_id=1, role_name="Admin"),
        Role(role_id=2, role_name="Teacher"),
        Role(role_id=3, role_name="Student"),
        AcademicLevel(academic_level_id=5, level_name="Grade 11", grade_level=11),
        AcademicLevel(academic_level_id=6, level_name="Grade 12", grade_level=12),
        AcademicYear(
            academic_year_id=1,
            year_label="2025-2026",
            start_date=date(2025, 6, 1),
            end_date=date(2026, 3, 31),
            is_active=True,
        ),
        AcademicPathway(id=1, code="stem", name="Science and Technology", is_enabled=True),
        AcademicPathway(id=2, code="abm", name="Accountancy and Business", is_enabled=True),
    ])
    session.commit()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture
def client(db):
    test_app = FastAPI()
    test_app.add_exception_handler(ClassManagementError, class_management_error_handler)
    test_app.include_router(classes_router, prefix="/api/v1/classes")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "admin",
    }
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.clear()


def create_g12_setup(db, student_count=20):
    sec_del_mundo = OfficialSection(
        academic_year_id=1, academic_level_id=6, section_name="Del Mundo",
        normalized_name="del mundo", is_active=True, pathway_id=None,
    )
    sec_reyes = OfficialSection(
        academic_year_id=1, academic_level_id=6, section_name="Reyes",
        normalized_name="reyes", is_active=True, pathway_id=None,
    )
    db.add_all([sec_del_mundo, sec_reyes])
    db.flush()

    class_del_mundo = Class(
        class_id=19, academic_year_id=1, academic_level_id=6,
        section_name="Del Mundo", class_status="active", pathway_id=None,
    )
    class_reyes = Class(
        class_id=20, academic_year_id=1, academic_level_id=6,
        section_name="Reyes", class_status="active", pathway_id=None,
    )
    db.add_all([class_del_mundo, class_reyes])
    db.flush()

    students = []
    first_names = ["Adrian", "Bianca", "Christian", "Danica", "Enzo", "Francesca", "Gian", "Hannah", "Ivan", "Jasmine",
                   "Kyle", "Lara", "Marco", "Nicole", "Oscar", "Patricia", "Quentin", "Rochelle", "Tristan", "Ursula"]
    last_names = ["Valdez", "Alcantara", "Navarro", "Villareal", "Mendoza", "Bautista", "Salcedo", "Del Rosario", "Torres", "Abad",
                  "Monteverde", "Santos", "Castillo", "Reyes", "Aquino", "Lim", "Tan", "Cruz", "Malanto", "Garcia"]
    middle_names = ["Lorenzo", "Cruz", "Miguel", "Flores", "Gabriel", "Mae", "Rafael", "Claire", "Paolo", "Nicole",
                    "Andrei", "Marie", "Luis", "Joy", "David", "Grace", "James", "Anne", "Noel", "Mae"]

    for i in range(student_count):
        gender = "Male" if i % 2 == 0 else "Female"
        student = Student(
            student_id=uuid.uuid4(),
            student_lrn=f"1000000000{i:02d}",
            first_name=first_names[i % len(first_names)],
            middle_name=middle_names[i % len(middle_names)],
            last_name=last_names[i % len(last_names)],
            suffix="Jr." if i == 0 else None,
            gender=gender,
            academic_level_id=6,
            prior_gwa=Decimal("85.00") + Decimal(str(i * 0.5)),
        )
        students.append(student)
        db.add(student)
    db.commit()
    return class_del_mundo, class_reyes, students


def test_format_student_display_name(db):
    s1 = Student(first_name="Kyle Andrei", middle_name=None, last_name="Monteverde", suffix=None)
    assert format_student_display_name(s1) == "Monteverde, Kyle Andrei"

    s2 = Student(first_name="Marco Luis", middle_name=None, last_name="Castillo", suffix=None)
    assert format_student_display_name(s2) == "Castillo, Marco Luis"

    s3 = Student(first_name="Enzo", middle_name="Gabriel", last_name="Mendoza", suffix=None)
    assert format_student_display_name(s3) == "Mendoza, Enzo Gabriel"

    s4 = Student(first_name="Hannah", middle_name="Claire", last_name="Del Rosario", suffix=None)
    assert format_student_display_name(s4) == "Del Rosario, Hannah Claire"

    s5 = Student(first_name="Juan", middle_name="Carlos", last_name="Reyes", suffix="Jr.")
    assert format_student_display_name(s5) == "Reyes Jr., Juan Carlos"

    s6 = Student(first_name="", middle_name=None, last_name="OnlySurname", suffix=None)
    assert format_student_display_name(s6) == "OnlySurname"

    s7 = Student(first_name="OnlyGiven", middle_name=None, last_name="", suffix=None)
    assert format_student_display_name(s7) == "OnlyGiven"


def test_preview_and_unmodified_commit(db):
    c1, c2, students = create_g12_setup(db, 20)
    preview = preview_existing_class_distribution(db, c1.class_id, [c1.class_id, c2.class_id], "alphabetical")

    assert preview["unassigned_count"] == 20
    assert len(preview["classes"]) == 2
    assert preview["classes"][0]["to_add_count"] == 10
    assert preview["classes"][1]["to_add_count"] == 10
    assert preview["classes"][0]["male_count"] == 5
    assert preview["classes"][0]["female_count"] == 5
    assert preview["classes"][1]["male_count"] == 5
    assert preview["classes"][1]["female_count"] == 5
    assert preview["imbalance"] == 0

    # Verify student names formatted in Surname, Given Names
    for item in preview["assignments"]:
        assert ", " in item["student_name"]

    # Commit without overrides
    result = commit_existing_class_distribution(
        db, c1.class_id, [c1.class_id, c2.class_id], "alphabetical", preview["snapshot"],
    )
    assert result["committed_count"] == 20

    # Verify database state
    memberships = db.query(StudentClass).filter_by(academic_year_id=1).all()
    assert len(memberships) == 20
    c1_members = [m for m in memberships if m.class_id == c1.class_id]
    c2_members = [m for m in memberships if m.class_id == c2.class_id]
    assert len(c1_members) == 10
    assert len(c2_members) == 10


def test_customized_assignment_commit(db):
    c1, c2, students = create_g12_setup(db, 20)
    preview = preview_existing_class_distribution(db, c1.class_id, [c1.class_id, c2.class_id], "alphabetical")

    # Move 1 student from c1 to c2
    c1_student = next(item for item in preview["assignments"] if item["class_id"] == c1.class_id)
    overrides = []
    for item in preview["assignments"]:
        sid = uuid.UUID(str(item["student_id"]))
        if sid == uuid.UUID(str(c1_student["student_id"])):
            overrides.append((sid, c2.class_id))
        else:
            overrides.append((sid, item["class_id"]))

    result = commit_existing_class_distribution(
        db, c1.class_id, [c1.class_id, c2.class_id], "alphabetical", preview["snapshot"],
        assignment_overrides=overrides,
    )
    assert result["committed_count"] == 20

    # Check updated counts: c1 has 9, c2 has 11
    memberships = db.query(StudentClass).filter_by(academic_year_id=1).all()
    assert len(memberships) == 20
    c1_count = sum(1 for m in memberships if m.class_id == c1.class_id)
    c2_count = sum(1 for m in memberships if m.class_id == c2.class_id)
    assert c1_count == 9
    assert c2_count == 11

    # Verify moved student is in c2
    moved = db.query(StudentClass).filter_by(student_id=uuid.UUID(str(c1_student["student_id"]))).first()
    assert moved.class_id == c2.class_id


def test_reject_unauthorized_destination_class(db):
    c1, c2, students = create_g12_setup(db, 4)
    preview = preview_existing_class_distribution(db, c1.class_id, [c1.class_id, c2.class_id], "alphabetical")

    overrides = [(uuid.UUID(str(item["student_id"])), 999) for item in preview["assignments"]]
    with pytest.raises(HTTPException) as exc_info:
        commit_existing_class_distribution(
            db, c1.class_id, [c1.class_id, c2.class_id], "alphabetical", preview["snapshot"],
            assignment_overrides=overrides,
        )
    assert exc_info.value.status_code == 422
    assert "Custom assignments must use selected classes only" in exc_info.value.detail


def test_reject_duplicate_or_missing_students(db):
    c1, c2, students = create_g12_setup(db, 4)
    preview = preview_existing_class_distribution(db, c1.class_id, [c1.class_id, c2.class_id], "alphabetical")

    # Duplicate first student, omit last student
    sids = [uuid.UUID(str(item["student_id"])) for item in preview["assignments"]]
    bad_overrides = [
        (sids[0], c1.class_id),
        (sids[0], c2.class_id),
        (sids[1], c1.class_id),
        (sids[2], c2.class_id),
    ]
    with pytest.raises(HTTPException) as exc_info:
        commit_existing_class_distribution(
            db, c1.class_id, [c1.class_id, c2.class_id], "alphabetical", preview["snapshot"],
            assignment_overrides=bad_overrides,
        )
    assert exc_info.value.status_code == 422
    assert "each eligible unassigned student exactly once" in exc_info.value.detail


def test_reject_injected_foreign_student(db):
    c1, c2, students = create_g12_setup(db, 4)
    preview = preview_existing_class_distribution(db, c1.class_id, [c1.class_id, c2.class_id], "alphabetical")

    sids = [uuid.UUID(str(item["student_id"])) for item in preview["assignments"]]
    fake_id = uuid.uuid4()
    bad_overrides = [(fake_id, c1.class_id)] + [(sid, c2.class_id) for sid in sids[1:]]

    with pytest.raises(HTTPException) as exc_info:
        commit_existing_class_distribution(
            db, c1.class_id, [c1.class_id, c2.class_id], "alphabetical", preview["snapshot"],
            assignment_overrides=bad_overrides,
        )
    assert exc_info.value.status_code == 422
    assert "each eligible unassigned student exactly once" in exc_info.value.detail


def test_reject_stale_preview_on_concurrent_assignment(db):
    c1, c2, students = create_g12_setup(db, 4)
    preview = preview_existing_class_distribution(db, c1.class_id, [c1.class_id, c2.class_id], "alphabetical")

    # Another process assigns students[0]
    db.add(build_student_class_assignment(students[0].student_id, c1))
    db.commit()

    with pytest.raises(HTTPException) as exc_info:
        commit_existing_class_distribution(
            db, c1.class_id, [c1.class_id, c2.class_id], "alphabetical", preview["snapshot"],
        )
    assert exc_info.value.status_code == 409
    assert "Recalculate the preview before saving" in exc_info.value.detail


def test_repeat_distribution_no_unassigned_remaining(db):
    c1, c2, students = create_g12_setup(db, 4)
    preview = preview_existing_class_distribution(db, c1.class_id, [c1.class_id, c2.class_id], "alphabetical")
    commit_existing_class_distribution(
        db, c1.class_id, [c1.class_id, c2.class_id], "alphabetical", preview["snapshot"],
    )

    # Preview again when all students are assigned
    preview2 = preview_existing_class_distribution(db, c1.class_id, [c1.class_id, c2.class_id], "alphabetical")
    assert preview2["unassigned_count"] == 0
    assert len(preview2["assignments"]) == 0

    with pytest.raises(HTTPException) as exc_info:
        commit_existing_class_distribution(
            db, c1.class_id, [c1.class_id, c2.class_id], "alphabetical", preview2["snapshot"],
        )
    assert exc_info.value.status_code == 409
    assert "No unassigned students remain" in exc_info.value.detail


def test_pathway_restricted_grade(db):
    sec = OfficialSection(
        academic_year_id=1, academic_level_id=5, section_name="Campos",
        normalized_name="campos", is_active=True, pathway_id=1,
    )
    sec2 = OfficialSection(
        academic_year_id=1, academic_level_id=5, section_name="Zara",
        normalized_name="zara", is_active=True, pathway_id=2,
    )
    c1 = Class(class_id=111, academic_year_id=1, academic_level_id=5, section_name="Campos", class_status="active", pathway_id=1)
    c2 = Class(class_id=112, academic_year_id=1, academic_level_id=5, section_name="Zara", class_status="active", pathway_id=2)
    db.add_all([sec, sec2, c1, c2])
    db.commit()

    # Note: Grade 11 has pathways, but let's test if resolve_pathway_scope triggers
    # If pathways are required, preview raises 422
    from app.models.academic.AcademicLevelPathwayScope import AcademicLevelPathwayScope
    db.add(AcademicLevelPathwayScope(academic_year_id=1, academic_level_id=5, requires_pathway=True))
    db.commit()

    with pytest.raises(HTTPException) as exc_info:
        preview_existing_class_distribution(db, c1.class_id, [c1.class_id, c2.class_id], "alphabetical")
    assert exc_info.value.status_code == 422
    assert "Automatic distribution is unavailable for pathway-based grades" in exc_info.value.detail


def test_api_routes_end_to_end(client, db):
    c1, c2, students = create_g12_setup(db, 6)

    # 1. Preview
    resp = client.post(f"/api/v1/classes/{c1.class_id}/distribution-preview", json={
        "class_ids": [c1.class_id, c2.class_id],
        "mode": "alphabetical",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data["unassigned_count"] == 6
    assert len(data["assignments"]) == 6

    # 2. Reassign 1 student from c1 to c2
    assignments = []
    moved_student_id = None
    for item in data["assignments"]:
        if item["class_id"] == c1.class_id and moved_student_id is None:
            moved_student_id = item["student_id"]
            assignments.append({"student_id": item["student_id"], "class_id": c2.class_id})
        else:
            assignments.append({"student_id": item["student_id"], "class_id": item["class_id"]})

    # 3. Commit
    commit_resp = client.post(f"/api/v1/classes/{c1.class_id}/distribution-commit", json={
        "class_ids": [c1.class_id, c2.class_id],
        "mode": "alphabetical",
        "snapshot": data["snapshot"],
        "assignments": assignments,
    })
    assert commit_resp.status_code == 200
    commit_data = commit_resp.json()
    assert commit_data["committed_count"] == 6

    # Check updated database
    memberships = db.query(StudentClass).filter_by(academic_year_id=1).all()
    assert len(memberships) == 6
    c1_count = sum(1 for m in memberships if m.class_id == c1.class_id)
    c2_count = sum(1 for m in memberships if m.class_id == c2.class_id)
    assert c1_count == 2
    assert c2_count == 4


def test_gwa_mode_preview_and_customization(db):
    c1, c2, students = create_g12_setup(db, 6)
    preview = preview_existing_class_distribution(db, c1.class_id, [c1.class_id, c2.class_id], "gwa")
    assert preview["mode"] == "gwa"
    assert preview["classes"][0]["average_gwa"] is not None
    assert preview["classes"][1]["average_gwa"] is not None

    # Reassign student with highest GWA from its assigned class to the other
    highest = max(preview["assignments"], key=lambda x: x["gwa"])
    target_class_id = c2.class_id if highest["class_id"] == c1.class_id else c1.class_id
    overrides = []
    for item in preview["assignments"]:
        sid = uuid.UUID(str(item["student_id"]))
        if sid == uuid.UUID(str(highest["student_id"])):
            overrides.append((sid, target_class_id))
        else:
            overrides.append((sid, item["class_id"]))

    result = commit_existing_class_distribution(
        db, c1.class_id, [c1.class_id, c2.class_id], "gwa", preview["snapshot"],
        assignment_overrides=overrides,
    )
    assert result["committed_count"] == 6
    # Verify the student was placed in target_class_id
    moved = db.query(StudentClass).filter_by(student_id=uuid.UUID(str(highest["student_id"]))).first()
    assert moved.class_id == target_class_id


def test_gwa_mode_missing_grades_rejected(db):
    c1, c2, students = create_g12_setup(db, 4)
    # Clear prior_gwa for one student
    students[0].prior_gwa = None
    db.commit()

    with pytest.raises(HTTPException) as exc_info:
        preview_existing_class_distribution(db, c1.class_id, [c1.class_id, c2.class_id], "gwa")
    assert exc_info.value.status_code == 422
    assert "GWA is unavailable for 1 student(s)" in exc_info.value.detail


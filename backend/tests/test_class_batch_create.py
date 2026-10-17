import uuid
from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Classes import router as classes_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPathway import AcademicPathway
from app.models.academic.AcademicLevelPathwayScope import AcademicLevelPathwayScope
from app.models.academic.OfficialSection import OfficialSection
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.classes.ClassService import build_student_class_assignment
from app.services.classes.ClassShared import ClassManagementError, class_management_error_handler


TABLES = [
    AcademicYear.__table__,
    AcademicLevel.__table__,
    Role.__table__,
    UserAccount.__table__,
    UserRoles.__table__,
    AcademicStaff.__table__,
    Student.__table__,
    Class.__table__,
    StudentClass.__table__,
]


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


def add_year(db, label: str, active: bool) -> AcademicYear:
    year = AcademicYear(
        year_label=label,
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=active,
    )
    db.add(year)
    db.flush()
    return year


def add_level(db, name: str, grade: int) -> AcademicLevel:
    level = AcademicLevel(level_name=name, grade_level=grade)
    db.add(level)
    db.flush()
    return level


def add_staff(db, staff_id: str, eligible: bool = True) -> AcademicStaff:
    role = db.query(Role).filter(Role.role_name == "Teacher").first()
    if not role:
        role = Role(role_id=1, role_name="Teacher")
        db.add(role)
        db.flush()
    account = UserAccount(
        user_id=uuid.uuid4(),
        email=f"{staff_id}@example.test",
        password_hash="hash",
        account_status="active" if eligible else "inactive",
    )
    db.add(account)
    db.flush()
    db.add(UserRoles(user_id=account.user_id, role_id=role.role_id))
    staff = AcademicStaff(
        staff_id=staff_id,
        first_name="Teacher",
        last_name=staff_id,
        user_id=account.user_id,
    )
    db.add(staff)
    db.flush()
    return staff


def add_student(db, level: AcademicLevel, lrn: str) -> Student:
    student = Student(
        student_id=uuid.uuid4(),
        student_lrn=lrn,
        first_name="Student",
        last_name=lrn,
        academic_level_id=level.academic_level_id,
    )
    db.add(student)
    db.flush()
    return student


@pytest.fixture
def batch_data(db):
    year = add_year(db, "2025-2026", True)
    other_year = add_year(db, "2024-2025", False)
    level = add_level(db, "Grade 7", 7)
    other_level = add_level(db, "Grade 8", 8)
    adviser = add_staff(db, "T-1")
    adviser_two = add_staff(db, "T-2")
    students = [
        add_student(db, level, "100000000001"),
        add_student(db, level, "100000000002"),
        add_student(db, level, "100000000003"),
    ]
    other_student = add_student(db, other_level, "200000000001")
    # These are intentionally alternate school choices for generic class-service tests.
    # The production migration seeds Entervene's actual names instead.
    for name in ("Sapphire", "Emerald", "Ruby", "A", "B", "New", "Valid", "Invalid"):
        db.add(OfficialSection(academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id,
                               section_name=name, normalized_name=name.casefold()))
    db.commit()
    return year, other_year, level, other_level, adviser, adviser_two, students, other_student


def section(name, adviser_id="T-1", student_ids=None):
    return {
        "section_name": name,
        "adviser_staff_id": adviser_id,
        "student_ids": [str(student_id) for student_id in (student_ids or [])],
    }


def post_batch(client, level_id: int, sections):
    return client.post(
        "/api/v1/classes/batch-create",
        json={"academic_level_id": level_id, "sections": sections},
    )


def error_codes(response):
    return {error["code"] for error in response.json()["errors"]}


def test_batch_create_persists_all_automatic_values_and_sorted_response(client, db, batch_data):
    year, _, level, _, _, _, students, _ = batch_data
    adviser_three = add_staff(db, "T-3")
    db.commit()

    response = post_batch(
        client,
        level.academic_level_id,
        [
            section("Sapphire", student_ids=[students[0].student_id, students[1].student_id]),
            section(" Emerald ", adviser_id="T-2", student_ids=[students[2].student_id]),
            section("Ruby", adviser_id=adviser_three.staff_id),
        ],
    )

    assert response.status_code == 201
    body = response.json()
    assert [item["section_name"] for item in body["classes"]] == ["Emerald", "Ruby", "Sapphire"]
    assert body["summary"] == {"class_count": 3, "student_assignment_count": 3}
    classes = db.query(Class).order_by(Class.section_name).all()
    assignments = db.query(StudentClass).all()
    assert all(class_.academic_year_id == year.academic_year_id for class_ in classes)
    assert all(class_.academic_period_id is None for class_ in classes)
    assert all(class_.class_status == "active" for class_ in classes)
    assert all(assignment.enrollment_status == "enrolled" for assignment in assignments)
    assert all(
        assignment.academic_year_id
        == db.query(Class).filter(Class.class_id == assignment.class_id).one().academic_year_id
        for assignment in assignments
    )


def test_grade_12_class_can_be_created_before_any_student_then_enrolled_later(client, db):
    year = add_year(db, "2025-2026", True)
    level = add_level(db, "Grade 12", 12)
    adviser = add_staff(db, "T-12")
    db.add(OfficialSection(academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id,
                           section_name="Del Mundo", normalized_name="del mundo"))
    db.commit()

    created = post_batch(client, level.academic_level_id, [section("Del Mundo", adviser.staff_id)])
    assert created.status_code == 201
    class_id = created.json()["classes"][0]["class_id"]
    assert created.json()["summary"]["student_assignment_count"] == 0
    assert db.query(Student).count() == 0
    assert db.query(StudentClass).count() == 0
    listed = client.get("/api/v1/classes").json()["classes"]
    assert next(item for item in listed if item["class_id"] == class_id)["student_count"] == 0
    assert client.get(f"/api/v1/classes/{class_id}/students").json()["students"] == []

    students = [add_student(db, level, "120000000001"), add_student(db, level, "120000000002")]
    db.commit()
    available = client.get(f"/api/v1/classes/unassigned-students?academic_level_id={level.academic_level_id}&class_id={class_id}")
    assert available.status_code == 200
    assert {item["student_id"] for item in available.json()["students"]} == {str(student.student_id) for student in students}
    assigned = client.patch(f"/api/v1/classes/{class_id}/students", json={"additions": [{"student_id": str(student.student_id)} for student in students]})
    assert assigned.status_code == 200
    assert assigned.json()["summary"]["total_students"] == 2
    assert db.query(StudentClass).filter(StudentClass.academic_year_id == year.academic_year_id).count() == 2
    assert client.get(f"/api/v1/classes/{class_id}/students").json()["summary"]["total_students"] == 2


@pytest.mark.parametrize("other_grade_student", [False, True])
def test_grade_11_pathway_class_can_be_empty_with_or_without_other_grade_students(client, db, other_grade_student):
    year = add_year(db, "2025-2026", True)
    grade_11 = add_level(db, "Grade 11", 11)
    grade_12 = add_level(db, "Grade 12", 12)
    if other_grade_student:
        add_student(db, grade_12, "120000000001")
    adviser = add_staff(db, "T-11")
    pathway = AcademicPathway(code="medical-courses", name="Medical Courses", is_enabled=True)
    db.add(pathway)
    db.flush()
    db.add(OfficialSection(academic_year_id=year.academic_year_id, academic_level_id=grade_11.academic_level_id,
                           section_name="Zara", normalized_name="zara", pathway_id=pathway.id))
    db.commit()

    request = section("Zara", adviser.staff_id)
    request["pathway"] = pathway.code
    created = post_batch(client, grade_11.academic_level_id, [request])
    assert created.status_code == 201
    assert created.json()["classes"][0]["student_count"] == 0
    assert db.query(StudentClass).count() == 0

    request["section_name"] = "Invalid"
    request["pathway"] = "general"
    invalid = post_batch(client, grade_11.academic_level_id, [request])
    assert invalid.status_code == 422


def test_configured_sections_are_year_and_grade_specific_and_reject_invalid_choices(client, db):
    current = add_year(db, "2025-2026", True)
    future = add_year(db, "2026-2027", False)
    grade_7 = add_level(db, "Grade 7", 7)
    grade_8 = add_level(db, "Grade 8", 8)
    adviser = add_staff(db, "T-7")
    db.add_all([
        OfficialSection(academic_year_id=current.academic_year_id, academic_level_id=grade_7.academic_level_id, section_name="Aristotle", normalized_name="aristotle"),
        OfficialSection(academic_year_id=current.academic_year_id, academic_level_id=grade_7.academic_level_id, section_name="Galileo", normalized_name="galileo"),
        OfficialSection(academic_year_id=current.academic_year_id, academic_level_id=grade_8.academic_level_id, section_name="Newton", normalized_name="newton"),
    ])
    db.commit()

    options = client.get(f"/api/v1/classes/form-options?academic_year_id={current.academic_year_id}")
    assert options.status_code == 200
    assert [item["section_name"] for item in options.json()["official_sections"] if item["academic_level_id"] == grade_7.academic_level_id] == ["Aristotle", "Galileo"]
    for year_id, level_id, name in [
        (current.academic_year_id, grade_7.academic_level_id, "Newton"),
        (current.academic_year_id, grade_7.academic_level_id, "Invented"),
        (future.academic_year_id, grade_7.academic_level_id, "Aristotle"),
    ]:
        rejected = client.post("/api/v1/classes/batch-create", json={"academic_year_id": year_id, "academic_level_id": level_id, "sections": [section(name, adviser.staff_id)]})
        assert rejected.status_code == 422
    assert db.query(Class).count() == 0

    created = client.post("/api/v1/classes/batch-create", json={"academic_year_id": current.academic_year_id, "academic_level_id": grade_7.academic_level_id, "sections": [section(" aristotle ", adviser.staff_id)]})
    assert created.status_code == 201
    assert created.json()["classes"][0]["section_name"] == "Aristotle"
    assert created.json()["classes"][0]["student_count"] == 0
    duplicate = client.post("/api/v1/classes/batch-create", json={"academic_year_id": current.academic_year_id, "academic_level_id": grade_7.academic_level_id, "sections": [section("Aristotle", adviser.staff_id)]})
    assert duplicate.status_code == 409


def test_unconfigured_installation_rejects_free_text_class_creation(client, db):
    year = add_year(db, "2025-2026", True)
    level = add_level(db, "Grade 7", 7)
    adviser = add_staff(db, "T-1")
    db.commit()
    response = client.post("/api/v1/classes/batch-create", json={
        "academic_year_id": year.academic_year_id,
        "academic_level_id": level.academic_level_id,
        "sections": [section("Invented", adviser.staff_id)],
    })
    assert response.status_code == 422
    assert db.query(Class).count() == 0


def test_form_options_expose_all_official_grade_choices(client, db):
    year = add_year(db, "2025-2026", True)
    engineering = AcademicPathway(code="engineering-math", name="Engineering and Mathematics Related", is_enabled=True)
    medical = AcademicPathway(code="medical-courses", name="Medical Courses and Sciences Related", is_enabled=True)
    db.add_all([engineering, medical])
    db.flush()
    expected = {
        7: ("Aristotle", "Galileo"), 8: ("Newton", "Plato"),
        9: ("Archimedes", "Copernicus"), 10: ("Einstein", "Socrates"),
        11: ("Campos", "Zara"), 12: ("Del Mundo", "Reyes"),
    }
    for grade, names in expected.items():
        level = add_level(db, f"Grade {grade}", grade)
        db.add(AcademicLevelPathwayScope(
            academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id,
            requires_pathway=grade == 11,
        ))
        for name in names:
            pathway_id = engineering.id if name == "Campos" else medical.id if name == "Zara" else None
            db.add(OfficialSection(
                academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id,
                section_name=name, normalized_name=name.casefold(), pathway_id=pathway_id,
            ))
    db.commit()

    response = client.get(f"/api/v1/classes/form-options?academic_year_id={year.academic_year_id}")
    assert response.status_code == 200
    rows = response.json()["official_sections"]
    levels = {row["academic_level_id"]: row["grade_level"] for row in response.json()["academic_levels"]}
    by_grade = {grade: tuple(row["section_name"] for row in rows if levels[row["academic_level_id"]] == grade) for grade in expected}
    assert by_grade == expected
    assert {row["section_name"]: row["pathway_id"] for row in rows if levels[row["academic_level_id"]] == 11} == {"Campos": engineering.id, "Zara": medical.id}
    assert all(row["pathway_id"] is None for row in rows if levels[row["academic_level_id"]] == 12)


def test_grade_11_mapping_and_future_grade_12_scope_are_independent(client, db):
    current = add_year(db, "2025-2026", True)
    future = add_year(db, "2026-2027", False)
    grade_11 = add_level(db, "Grade 11", 11)
    grade_12 = add_level(db, "Grade 12", 12)
    medical = AcademicPathway(code="medical-courses", name="Medical Courses and Sciences Related", is_enabled=True)
    engineering = AcademicPathway(code="engineering-math", name="Engineering and Mathematics Related", is_enabled=True)
    db.add_all([medical, engineering])
    db.flush()
    db.add_all([
        AcademicLevelPathwayScope(academic_year_id=current.academic_year_id, academic_level_id=grade_11.academic_level_id, requires_pathway=True),
        AcademicLevelPathwayScope(academic_year_id=current.academic_year_id, academic_level_id=grade_12.academic_level_id, requires_pathway=False),
        AcademicLevelPathwayScope(academic_year_id=future.academic_year_id, academic_level_id=grade_12.academic_level_id, requires_pathway=True),
        OfficialSection(academic_year_id=current.academic_year_id, academic_level_id=grade_11.academic_level_id, section_name="Campos", normalized_name="campos", pathway_id=engineering.id),
        OfficialSection(academic_year_id=current.academic_year_id, academic_level_id=grade_11.academic_level_id, section_name="Zara", normalized_name="zara", pathway_id=medical.id),
        OfficialSection(academic_year_id=current.academic_year_id, academic_level_id=grade_12.academic_level_id, section_name="Del Mundo", normalized_name="del mundo"),
        OfficialSection(academic_year_id=current.academic_year_id, academic_level_id=grade_12.academic_level_id, section_name="Reyes", normalized_name="reyes"),
    ])
    adviser = add_staff(db, "T-11")
    adviser_2 = add_staff(db, "T-12")
    db.commit()

    wrong = section("Campos", adviser.staff_id)
    wrong["pathway"] = medical.code
    assert post_batch(client, grade_11.academic_level_id, [wrong]).status_code == 422
    right = section("Campos", adviser.staff_id)
    right["pathway"] = engineering.code
    assert post_batch(client, grade_11.academic_level_id, [right]).status_code == 201
    current_12 = post_batch(client, grade_12.academic_level_id, [section("Del Mundo", adviser_2.staff_id)])
    assert current_12.status_code == 201
    assert current_12.json()["classes"][0]["pathway"] == "general"
    assert db.query(Class).filter(Class.academic_year_id == current.academic_year_id, Class.academic_level_id == grade_12.academic_level_id).one().pathway_id is None

    future_options = client.get(f"/api/v1/classes/form-options?academic_year_id={future.academic_year_id}").json()
    assert next(level for level in future_options["academic_levels"] if level["grade_level"] == 12)["requires_pathway"] is True
    assert future_options["official_sections"] == []
    future_unconfigured = client.post("/api/v1/classes/batch-create", json={"academic_year_id": future.academic_year_id, "academic_level_id": grade_12.academic_level_id, "sections": [section("Del Mundo", adviser_2.staff_id)]})
    assert future_unconfigured.status_code == 422
    future_section = client.post("/api/v1/classes/official-sections", json={"academic_year_id": future.academic_year_id, "academic_level_id": grade_12.academic_level_id, "section_name": "Future Section", "pathway_id": engineering.id})
    assert future_section.status_code == 201
    future_class = client.post("/api/v1/classes/batch-create", json={"academic_year_id": future.academic_year_id, "academic_level_id": grade_12.academic_level_id, "sections": [{**section("Future Section", adviser_2.staff_id), "pathway": engineering.code}]})
    assert future_class.status_code == 201
    assert db.query(Class).filter(Class.academic_year_id == current.academic_year_id, Class.academic_level_id == grade_12.academic_level_id).one().pathway_id is None
    used_section = client.patch(f"/api/v1/classes/official-sections/{future_section.json()['id']}", json={"is_active": False})
    assert used_section.status_code == 409


def test_same_adviser_cannot_advise_multiple_sections_in_active_year(client, db, batch_data):
    _, _, level, _, adviser, _, _, _ = batch_data

    response = post_batch(
        client,
        level.academic_level_id,
        [section("A", adviser.staff_id), section("B", adviser.staff_id)],
    )

    assert response.status_code == 422
    assert "duplicate_adviser_assignment" in error_codes(response)
    assert db.query(Class).count() == 0
    assert db.query(StudentClass).count() == 0


def test_adviser_already_assigned_in_active_year_is_rejected_but_other_year_is_allowed(client, db, batch_data):
    year, other_year, level, _, adviser, adviser_two, _, _ = batch_data
    db.add_all([
        Class(section_name="Active", adviser_staff_id=adviser.staff_id, academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id),
        Class(section_name="Old", adviser_staff_id=adviser_two.staff_id, academic_year_id=other_year.academic_year_id, academic_level_id=level.academic_level_id),
    ])
    db.commit()

    conflict = post_batch(client, level.academic_level_id, [section("New", adviser.staff_id)])
    assert conflict.status_code == 409
    assert "adviser_already_assigned" in error_codes(conflict)

    allowed = post_batch(client, level.academic_level_id, [section("New", adviser_two.staff_id)])
    assert allowed.status_code == 201


def test_active_year_configuration_and_academic_level_errors(client, db, batch_data):
    year, _, level, _, _, _, _, _ = batch_data
    request_sections = [section("Sapphire")]

    missing_level = post_batch(client, 999, request_sections)
    assert missing_level.status_code == 404
    assert "academic_level_not_found" in error_codes(missing_level)

    year.is_active = False
    db.commit()
    no_active = post_batch(client, level.academic_level_id, request_sections)
    assert no_active.status_code == 409
    assert no_active.json()["code"] == "active_academic_year_missing"

    year.is_active = True
    add_year(db, "2026-2027", True)
    db.commit()
    multiple = post_batch(client, level.academic_level_id, request_sections)
    assert multiple.status_code == 409
    assert multiple.json()["code"] == "active_academic_year_multiple"


@pytest.mark.parametrize(
    ("sections", "expected_code"),
    [
        ([], "sections_required"),
        ([section(" ")], "section_name_required"),
        ([section("Sapphire"), section(" sapphire ")], "duplicate_section_name"),
        ([section("Sapphire", adviser_id="")], "adviser_staff_id_required"),
        ([section("Sapphire", adviser_id="NOPE")], "adviser_not_found"),
    ],
)
def test_section_and_adviser_validation(client, batch_data, sections, expected_code):
    _, _, level, _, _, _, _, _ = batch_data

    response = post_batch(client, level.academic_level_id, sections)

    assert response.status_code == 422
    assert expected_code in error_codes(response)


def test_ineligible_adviser_is_rejected(client, db, batch_data):
    _, _, level, _, _, _, _, _ = batch_data
    add_staff(db, "T-3", eligible=False)
    db.commit()

    response = post_batch(client, level.academic_level_id, [section("Sapphire", "T-3")])

    assert response.status_code == 422
    assert "adviser_not_eligible" in error_codes(response)


def test_existing_name_conflicts_only_for_same_year_and_level(client, db, batch_data):
    year, other_year, level, other_level, _, _, _, _ = batch_data
    db.add_all(
        [
            Class(section_name="Sapphire", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id),
            Class(section_name="Emerald", academic_year_id=other_year.academic_year_id, academic_level_id=level.academic_level_id),
            Class(section_name="Ruby", academic_year_id=year.academic_year_id, academic_level_id=other_level.academic_level_id),
        ]
    )
    db.commit()

    conflict = post_batch(client, level.academic_level_id, [section(" sapphire ")])
    assert conflict.status_code == 409
    assert "section_already_exists" in error_codes(conflict)

    allowed = post_batch(client, level.academic_level_id, [section("Emerald"), section("Ruby", adviser_id="T-2")])
    assert allowed.status_code == 201


def test_student_validation_and_invalid_request_create_no_classes(client, db, batch_data):
    _, _, level, _, _, _, students, other_student = batch_data
    unknown = uuid.uuid4()

    response = post_batch(
        client,
        level.academic_level_id,
        [
            section("Valid", student_ids=[students[0].student_id]),
            section("Invalid", student_ids=[unknown, other_student.student_id]),
        ],
    )

    assert response.status_code == 422
    assert {"student_not_found", "student_level_mismatch"}.issubset(error_codes(response))
    assert db.query(Class).count() == 0
    assert db.query(StudentClass).count() == 0


def test_duplicate_student_within_or_across_sections_is_rejected(client, db, batch_data):
    _, _, level, _, _, _, students, _ = batch_data
    duplicate = students[0].student_id

    within = post_batch(client, level.academic_level_id, [section("A", student_ids=[duplicate, duplicate])])
    assert within.status_code == 422
    assert "duplicate_student_assignment" in error_codes(within)

    across = post_batch(
        client,
        level.academic_level_id,
        [section("A", student_ids=[duplicate]), section("B", student_ids=[duplicate])],
    )
    assert across.status_code == 422
    assert "duplicate_student_assignment" in error_codes(across)
    assert db.query(Class).count() == 0


def test_active_year_assignment_rejected_but_other_year_assignment_allowed(client, db, batch_data):
    year, other_year, level, _, _, _, students, _ = batch_data
    active_class = Class(section_name="Active", academic_year_id=year.academic_year_id, academic_level_id=level.academic_level_id)
    old_class = Class(section_name="Old", academic_year_id=other_year.academic_year_id, academic_level_id=level.academic_level_id)
    db.add_all([active_class, old_class])
    db.flush()
    db.add(build_student_class_assignment(students[0].student_id, active_class))
    db.add(build_student_class_assignment(students[1].student_id, old_class))
    db.commit()

    conflict = post_batch(client, level.academic_level_id, [section("New", student_ids=[students[0].student_id])])
    assert conflict.status_code == 409
    assert "student_already_assigned" in error_codes(conflict)

    allowed = post_batch(client, level.academic_level_id, [section("New", student_ids=[students[1].student_id])])
    assert allowed.status_code == 201


def test_assignment_integrity_error_rolls_back_everything_and_returns_safe_conflict(
    client, db, batch_data, monkeypatch
):
    _, _, level, _, _, _, students, _ = batch_data

    def fail_assignment(*args, **kwargs):
        raise IntegrityError("statement", {}, Exception("raw database detail"))

    monkeypatch.setattr("app.services.classes.ClassService.build_student_class_assignment", fail_assignment)

    response = post_batch(client, level.academic_level_id, [section("Sapphire", student_ids=[students[0].student_id])])

    assert response.status_code == 409
    assert response.json()["code"] == "class_creation_conflict"
    assert "raw database detail" not in response.text
    assert db.query(Class).count() == 0
    assert db.query(StudentClass).count() == 0


def test_batch_create_requires_admin_and_authentication(client, batch_data):
    _, _, level, _, _, _, _, _ = batch_data
    payload = [section("Sapphire")]
    client.app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "teacher",
    }
    assert post_batch(client, level.academic_level_id, payload).status_code == 403

    del client.app.dependency_overrides[get_current_user]
    assert post_batch(client, level.academic_level_id, payload).status_code == 401


def test_official_section_read_includes_class_id_and_class_status(client, db, batch_data):
    year, _, level, _, adviser, _, _, _ = batch_data
    # 1. Create official section with no class
    sec_resp = client.post(
        "/api/v1/classes/official-sections",
        json={"academic_year_id": year.academic_year_id, "academic_level_id": level.academic_level_id, "section_name": "TestSec"}
    )
    assert sec_resp.status_code == 201
    sec_data = sec_resp.json()
    assert sec_data["has_class"] is False
    assert sec_data["class_id"] is None
    assert sec_data["class_status"] is None

    # 2. Create active class using this section
    created_class = Class(
        section_name="TestSec",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
        adviser_staff_id=adviser.staff_id,
        class_status="active",
    )
    db.add(created_class)
    db.commit()
    db.refresh(created_class)

    # 3. Read official sections - class_id and class_status should now be populated
    list_resp = client.get(
        f"/api/v1/classes/official-sections?academic_year_id={year.academic_year_id}&academic_level_id={level.academic_level_id}"
    )
    assert list_resp.status_code == 200
    listed_sec = next(s for s in list_resp.json()["sections"] if s["section_name"] == "TestSec")
    assert listed_sec["has_class"] is True
    assert listed_sec["class_id"] == created_class.class_id
    assert listed_sec["class_status"] == "active"

    # 4. If archived, class_status reflects "archived"
    created_class.class_status = "archived"
    db.commit()

    list_resp2 = client.get(
        f"/api/v1/classes/official-sections?academic_year_id={year.academic_year_id}&academic_level_id={level.academic_level_id}"
    )
    listed_sec2 = next(s for s in list_resp2.json()["sections"] if s["section_name"] == "TestSec")
    assert listed_sec2["has_class"] is True
    assert listed_sec2["class_id"] == created_class.class_id
    assert listed_sec2["class_status"] == "archived"

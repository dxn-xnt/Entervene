import uuid
from datetime import date, datetime, timedelta, timezone
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.TeacherSubstitutions import router as teacher_substitutions_router
from app.api.v1.routes.StudentRecords import router as student_records_router
from app.api.v1.routes.SubjectLoads import router as subject_loads_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.academic.TeacherSubstitution import TeacherSubstitution
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.academic.SubstitutionService import SubstitutionService


@pytest.fixture
def sub_context():
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
    db = sessionmaker(bind=engine)()

    year = AcademicYear(
        year_label="2026-2027",
        start_date=date(2026, 6, 1),
        end_date=date(2027, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add_all([year, level])
    db.flush()

    period = AcademicPeriod(
        period_name="Quarter 1",
        period_type="QUARTER",
        period_sequence=1,
        total_periods_in_year=4,
        period_progress_ratio=0.25,
        start_date=date.today() - timedelta(days=30),
        end_date=date.today() + timedelta(days=60),
        academic_year_id=year.academic_year_id,
        is_active=True,
    )
    subject = Subject(subject_name="Filipino 7", subject_codename="FIL7", academic_level_id=level.academic_level_id)
    db.add_all([period, subject])
    db.flush()

    admin_user = UserAccount(user_id=uuid.uuid4(), email="admin@school.test", password_hash="hash")
    maria_user = UserAccount(user_id=uuid.uuid4(), email="maria@school.test", password_hash="hash")
    juan_user = UserAccount(user_id=uuid.uuid4(), email="juan@school.test", password_hash="hash")
    db.add_all([admin_user, maria_user, juan_user])
    db.flush()

    admin_staff = AcademicStaff(staff_id="A-001", first_name="Admin", last_name="User", user_id=admin_user.user_id)
    maria_staff = AcademicStaff(staff_id="T-001", first_name="Maria", last_name="Cruz", user_id=maria_user.user_id)
    juan_staff = AcademicStaff(staff_id="T-002", first_name="Juan", last_name="Bautista", user_id=juan_user.user_id)
    db.add_all([admin_staff, maria_staff, juan_staff])
    db.flush()

    class_obj = Class(
        section_name="Sampaguita",
        academic_level_id=level.academic_level_id,
        academic_year_id=year.academic_year_id,
        class_status="active",
    )

    db.add(class_obj)
    db.flush()

    load = SubjectLoad(
        class_id=class_obj.class_id,
        subject_id=subject.subject_id,
        academic_period_id=period.academic_period_id,
        staff_id=maria_staff.staff_id,
        status="published",
        start_time="08:00",
        end_time="09:00",
        days_of_week=["MONDAY", "WEDNESDAY", "FRIDAY"],
    )
    db.add(load)
    db.flush()

    student = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789012",
        first_name="Pedro",
        last_name="Penduko",
        email="pedro@school.test",
    )
    db.add(student)
    db.flush()

    student_class = StudentClass(
        student_id=student.student_id,
        class_id=class_obj.class_id,
        academic_year_id=year.academic_year_id,
        enrollment_status="enrolled",
    )
    db.add(student_class)
    db.commit()

    return {
        "db": db,
        "admin_staff": admin_staff,
        "maria_staff": maria_staff,
        "juan_staff": juan_staff,
        "load": load,
        "class": class_obj,
        "subject": subject,
        "period": period,
        "year": year,
        "student": student,
    }


def _make_client(db_session, user_role="admin", user_sub="A-001"):
    app = FastAPI()
    app.include_router(teacher_substitutions_router, prefix="/api/v1/substitutions")
    app.include_router(student_records_router, prefix="/api/v1/student-records")
    app.include_router(subject_loads_router, prefix="/api/v1/subject-loads")

    def _mock_db():
        yield db_session

    def _mock_user():
        return {"sub": user_sub, "role": user_role}

    app.dependency_overrides[get_db] = _mock_db
    app.dependency_overrides[get_current_user] = _mock_user
    return TestClient(app)


def test_create_substitution_success(sub_context):
    db = sub_context["db"]
    client = _make_client(db, user_role="admin", user_sub=str(sub_context["admin_staff"].user_id))

    today = date.today()
    payload = {
        "subject_load_id": sub_context["load"].subject_load_id,
        "substitute_staff_id": sub_context["juan_staff"].staff_id,
        "start_date": today.isoformat(),
        "end_date": (today + timedelta(days=45)).isoformat(),
        "reason": "Maternity Leave",
    }
    res = client.post("/api/v1/substitutions", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["original_staff_id"] == "T-001"
    assert data["original_staff_name"] == "Maria Cruz"
    assert data["substitute_staff_id"] == "T-002"
    assert data["substitute_staff_name"] == "Juan Bautista"
    assert data["status"] == "active"
    assert data["is_currently_active"] is True


def test_create_substitution_overlap_conflict(sub_context):
    db = sub_context["db"]
    client = _make_client(db, user_role="admin", user_sub=str(sub_context["admin_staff"].user_id))

    today = date.today()
    payload = {
        "subject_load_id": sub_context["load"].subject_load_id,
        "substitute_staff_id": sub_context["juan_staff"].staff_id,
        "start_date": today.isoformat(),
        "end_date": (today + timedelta(days=45)).isoformat(),
        "reason": "Maternity Leave",
    }
    res = client.post("/api/v1/substitutions", json=payload)
    assert res.status_code == 201

    # Try creating an overlapping substitution on the same load
    res_overlap = client.post("/api/v1/substitutions", json=payload)
    assert res_overlap.status_code == 409
    assert "already covers" in res_overlap.json()["detail"]


def test_substitution_access_and_view_only(sub_context):
    db = sub_context["db"]
    today = date.today()

    sub = TeacherSubstitution(
        subject_load_id=sub_context["load"].subject_load_id,
        original_staff_id=sub_context["maria_staff"].staff_id,
        substitute_staff_id=sub_context["juan_staff"].staff_id,
        start_date=today - timedelta(days=5),
        end_date=today + timedelta(days=30),
        status="active",
        reason="Maternity Leave",
    )
    db.add(sub)
    db.commit()

    # Maria (original teacher) should be view-only
    assert SubstitutionService.is_view_only(db, "T-001", sub_context["load"].subject_load_id) is True
    # Juan (substitute) should NOT be view-only
    assert SubstitutionService.is_view_only(db, "T-002", sub_context["load"].subject_load_id) is False

    # Effective staff should be Juan
    eff_staff, is_sub = SubstitutionService.resolve_effective_staff(db, sub_context["load"].subject_load_id)
    assert eff_staff == "T-002"
    assert is_sub is True


def test_adjust_end_date(sub_context):
    db = sub_context["db"]
    client = _make_client(db, user_role="admin", user_sub=str(sub_context["admin_staff"].user_id))

    today = date.today()
    sub = TeacherSubstitution(
        subject_load_id=sub_context["load"].subject_load_id,
        original_staff_id=sub_context["maria_staff"].staff_id,
        substitute_staff_id=sub_context["juan_staff"].staff_id,
        start_date=today,
        end_date=today + timedelta(days=30),
        status="active",
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)

    # Extend by 30 days
    new_date = today + timedelta(days=60)
    res = client.patch(f"/api/v1/substitutions/{sub.substitution_id}/end-date", json={"end_date": new_date.isoformat()})
    assert res.status_code == 200
    assert res.json()["end_date"] == new_date.isoformat()

    # Shorten to 10 days
    shortened_date = today + timedelta(days=10)
    res_short = client.patch(f"/api/v1/substitutions/{sub.substitution_id}/end-date", json={"end_date": shortened_date.isoformat()})
    assert res_short.status_code == 200
    assert res_short.json()["end_date"] == shortened_date.isoformat()


def test_end_substitution_early_reconciles_end_date(sub_context):
    db = sub_context["db"]
    client = _make_client(db, user_role="admin", user_sub=str(sub_context["admin_staff"].user_id))

    today = date.today()
    sub = TeacherSubstitution(
        subject_load_id=sub_context["load"].subject_load_id,
        original_staff_id=sub_context["maria_staff"].staff_id,
        substitute_staff_id=sub_context["juan_staff"].staff_id,
        start_date=today - timedelta(days=10),
        end_date=today + timedelta(days=40),
        status="active",
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)

    res = client.patch(f"/api/v1/substitutions/{sub.substitution_id}/end")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "completed"
    assert data["end_date"] == today.isoformat()
    assert data["ended_at"] is not None


def test_cancel_future_substitution(sub_context):
    db = sub_context["db"]
    client = _make_client(db, user_role="admin", user_sub=str(sub_context["admin_staff"].user_id))

    today = date.today()
    future_start = today + timedelta(days=15)
    sub = TeacherSubstitution(
        subject_load_id=sub_context["load"].subject_load_id,
        original_staff_id=sub_context["maria_staff"].staff_id,
        substitute_staff_id=sub_context["juan_staff"].staff_id,
        start_date=future_start,
        end_date=future_start + timedelta(days=40),
        status="active",
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)

    res = client.patch(f"/api/v1/substitutions/{sub.substitution_id}/cancel")
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"


def test_cancel_in_progress_substitution_rejected(sub_context):
    db = sub_context["db"]
    client = _make_client(db, user_role="admin", user_sub=str(sub_context["admin_staff"].user_id))

    today = date.today()
    started_sub = TeacherSubstitution(
        subject_load_id=sub_context["load"].subject_load_id,
        original_staff_id=sub_context["maria_staff"].staff_id,
        substitute_staff_id=sub_context["juan_staff"].staff_id,
        start_date=today - timedelta(days=2),
        end_date=today + timedelta(days=40),
        status="active",
    )
    db.add(started_sub)
    db.commit()
    db.refresh(started_sub)

    res = client.patch(f"/api/v1/substitutions/{started_sub.substitution_id}/cancel")
    assert res.status_code == 400
    assert "already started" in res.json()["detail"]


def test_my_schedule_two_sided_visibility(sub_context):
    db = sub_context["db"]
    today = date.today()

    sub = TeacherSubstitution(
        subject_load_id=sub_context["load"].subject_load_id,
        original_staff_id=sub_context["maria_staff"].staff_id,
        substitute_staff_id=sub_context["juan_staff"].staff_id,
        start_date=today - timedelta(days=1),
        end_date=today + timedelta(days=30),
        status="active",
    )
    db.add(sub)
    db.commit()

    period_id = sub_context["period"].academic_period_id

    # 1. Substitute (Juan) schedule check
    client_juan = _make_client(db, user_role="teacher", user_sub=str(sub_context["juan_staff"].user_id))
    res_juan = client_juan.get(f"/api/v1/subject-loads/my-schedule?academic_period_id={period_id}")
    assert res_juan.status_code == 200
    data_juan = res_juan.json()
    assert data_juan["is_published"] is True
    class_slots_juan = [s for s in data_juan["schedule"] if s.get("type") == "class"]
    assert len(class_slots_juan) == 1
    assert class_slots_juan[0]["is_substitution"] is True
    assert class_slots_juan[0]["original_teacher_name"] == "Maria Cruz"

    # 2. Original teacher (Maria) schedule check
    client_maria = _make_client(db, user_role="teacher", user_sub=str(sub_context["maria_staff"].user_id))
    res_maria = client_maria.get(f"/api/v1/subject-loads/my-schedule?academic_period_id={period_id}")
    assert res_maria.status_code == 200
    data_maria = res_maria.json()
    assert data_maria["is_published"] is True
    class_slots_maria = [s for s in data_maria["schedule"] if s.get("type") == "class"]
    assert len(class_slots_maria) == 1
    assert class_slots_maria[0]["is_covered"] is True
    assert class_slots_maria[0]["substitute_name"] == "Juan Bautista"


def test_finalize_period_grade_by_substitute_and_view_only_for_original(sub_context):
    db = sub_context["db"]
    today = date.today()

    sub = TeacherSubstitution(
        subject_load_id=sub_context["load"].subject_load_id,
        original_staff_id=sub_context["maria_staff"].staff_id,
        substitute_staff_id=sub_context["juan_staff"].staff_id,
        start_date=today - timedelta(days=1),
        end_date=today + timedelta(days=30),
        status="active",
    )
    db.add(sub)

    period_grade = StudentPeriodGrade(
        student_id=sub_context["student"].student_id,
        class_id=sub_context["class"].class_id,
        subject_id=sub_context["subject"].subject_id,
        academic_period_id=sub_context["period"].academic_period_id,
        initial_grade=88.5,
        transmuted_grade=92.0,
        final_period_grade=92.0,
    )
    db.add(period_grade)
    db.commit()
    db.refresh(period_grade)

    # 1. Original teacher on leave calls finalize -> 403 Forbidden
    client_maria = _make_client(db, user_role="teacher", user_sub=str(sub_context["maria_staff"].user_id))
    res_maria = client_maria.post(
        f"/api/v1/student-records/period-grades/{period_grade.period_grade_id}/finalize",
        json={"final_period_grade": 92.0},
    )
    assert res_maria.status_code == 403
    assert "on leave" in res_maria.json()["detail"]

    # 2. Substitute teacher calls finalize -> 200 OK
    client_juan = _make_client(db, user_role="teacher", user_sub=str(sub_context["juan_staff"].user_id))
    res_juan = client_juan.post(
        f"/api/v1/student-records/period-grades/{period_grade.period_grade_id}/finalize",
        json={"final_period_grade": 92.0},
    )
    assert res_juan.status_code == 200
    data_juan = res_juan.json()
    assert data_juan["is_finalized"] is True
    assert data_juan["finalized_by_staff_id"] == "T-002"


def test_create_substitution_schedule_conflict_returns_422(sub_context):
    db = sub_context["db"]
    client = _make_client(db, user_role="admin", user_sub=str(sub_context["admin_staff"].user_id))

    # Give Juan (T-002) an existing class load that directly clashes with Maria's load (08:00 - 09:00, MONDAY)
    subject2 = Subject(
        subject_name="English 7",
        subject_codename="ENG7",
        academic_level_id=sub_context["load"].subject.academic_level_id,
    )
    db.add(subject2)
    db.flush()

    clashing_load = SubjectLoad(
        class_id=sub_context["class"].class_id,
        subject_id=subject2.subject_id,
        academic_period_id=sub_context["period"].academic_period_id,
        staff_id=sub_context["juan_staff"].staff_id,
        status="published",
        start_time="08:00",
        end_time="09:00",
        days_of_week=["MONDAY"],
    )
    db.add(clashing_load)
    db.commit()

    today = date.today()
    payload = {
        "subject_load_id": sub_context["load"].subject_load_id,
        "substitute_staff_id": sub_context["juan_staff"].staff_id,
        "start_date": today.isoformat(),
        "end_date": (today + timedelta(days=45)).isoformat(),
        "reason": "Maternity Leave with Clashing Schedule",
    }
    res = client.post("/api/v1/substitutions", json=payload)
    assert res.status_code == 422
    data = res.json()
    assert "conflict" in data["detail"].lower()
    assert "double-booked" in data["detail"].lower()



def test_subject_load_delete_restrict_on_substitution(sub_context):
    from sqlalchemy.exc import IntegrityError
    db = sub_context["db"]
    today = date.today()

    sub = TeacherSubstitution(
        subject_load_id=sub_context["load"].subject_load_id,
        original_staff_id=sub_context["maria_staff"].staff_id,
        substitute_staff_id=sub_context["juan_staff"].staff_id,
        start_date=today,
        end_date=today + timedelta(days=30),
        status="active",
    )
    db.add(sub)
    db.commit()

    # Attempting to delete the referenced SubjectLoad must be blocked by ON DELETE RESTRICT foreign key
    with pytest.raises(IntegrityError):
        db.delete(sub_context["load"])
        db.commit()

    db.rollback()


def test_single_create_generates_distinct_batch_id(sub_context):
    db = sub_context["db"]
    client = _make_client(db, user_role="admin", user_sub=str(sub_context["admin_staff"].user_id))

    today = date.today()

    # Load 1
    res1 = client.post("/api/v1/substitutions", json={
        "subject_load_id": sub_context["load"].subject_load_id,
        "substitute_staff_id": sub_context["juan_staff"].staff_id,
        "start_date": (today + timedelta(days=60)).isoformat(),
        "end_date": (today + timedelta(days=90)).isoformat(),
        "reason": "Single leave 1",
    })
    assert res1.status_code == 201
    batch_id_1 = res1.json()["batch_id"]
    assert batch_id_1 is not None

    # Load 2 (different subject for Maria)
    subj2 = Subject(subject_name="Math 7", subject_codename="MTH7", academic_level_id=sub_context["load"].subject.academic_level_id)
    db.add(subj2)
    db.flush()
    load2 = SubjectLoad(
        class_id=sub_context["class"].class_id,
        subject_id=subj2.subject_id,
        academic_period_id=sub_context["period"].academic_period_id,
        staff_id=sub_context["maria_staff"].staff_id,
        status="published",
        start_time="10:00",
        end_time="11:00",
        days_of_week=["TUESDAY"],
    )
    db.add(load2)
    db.commit()

    res2 = client.post("/api/v1/substitutions", json={
        "subject_load_id": load2.subject_load_id,
        "substitute_staff_id": sub_context["juan_staff"].staff_id,
        "start_date": (today + timedelta(days=60)).isoformat(),
        "end_date": (today + timedelta(days=90)).isoformat(),
        "reason": "Single leave 2",
    })
    assert res2.status_code == 201
    batch_id_2 = res2.json()["batch_id"]
    assert batch_id_2 is not None

    # Verify both single-create calls generated distinct batch_id values
    assert batch_id_1 != batch_id_2


def test_create_bulk_substitution_entire_program_success(sub_context):
    db = sub_context["db"]
    client = _make_client(db, user_role="admin", user_sub=str(sub_context["admin_staff"].user_id))

    # Add 2 more subject loads for Maria (T-001)
    subj_a = Subject(subject_name="Science 7", subject_codename="SCI7", academic_level_id=sub_context["load"].subject.academic_level_id)
    subj_b = Subject(subject_name="Music 7", subject_codename="MUS7", academic_level_id=sub_context["load"].subject.academic_level_id)
    db.add_all([subj_a, subj_b])
    db.flush()

    load_a = SubjectLoad(
        class_id=sub_context["class"].class_id,
        subject_id=subj_a.subject_id,
        academic_period_id=sub_context["period"].academic_period_id,
        staff_id=sub_context["maria_staff"].staff_id,
        status="published",
        start_time="13:00",
        end_time="14:00",
        days_of_week=["MONDAY"],
    )
    load_b = SubjectLoad(
        class_id=sub_context["class"].class_id,
        subject_id=subj_b.subject_id,
        academic_period_id=sub_context["period"].academic_period_id,
        staff_id=sub_context["maria_staff"].staff_id,
        status="published",
        start_time="14:00",
        end_time="15:00",
        days_of_week=["MONDAY"],
    )
    db.add_all([load_a, load_b])
    db.commit()

    today = date.today()
    payload = {
        "subject_load_ids": [load_a.subject_load_id, load_b.subject_load_id],
        "substitute_staff_id": sub_context["juan_staff"].staff_id,
        "start_date": today.isoformat(),
        "end_date": (today + timedelta(days=60)).isoformat(),
        "reason": "Maternity Leave (Entire Program)",
    }
    res = client.post("/api/v1/substitutions/bulk", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["created_count"] == 2
    batch_id = data["batch_id"]
    assert batch_id is not None

    # Both substitutions must share the exact same batch_id
    assert len(data["substitutions"]) == 2
    assert data["substitutions"][0]["batch_id"] == batch_id
    assert data["substitutions"][1]["batch_id"] == batch_id

    # Maria must be view-only for both loads
    assert SubstitutionService.is_view_only(db, "T-001", load_a.subject_load_id) is True
    assert SubstitutionService.is_view_only(db, "T-001", load_b.subject_load_id) is True


def test_batch_operations_isolated_from_other_batches_same_teacher(sub_context):
    db = sub_context["db"]
    client = _make_client(db, user_role="admin", user_sub=str(sub_context["admin_staff"].user_id))

    today = date.today()
    subj_x = Subject(subject_name="Subject X", subject_codename="SUBX", academic_level_id=sub_context["load"].subject.academic_level_id)
    subj_y = Subject(subject_name="Subject Y", subject_codename="SUBY", academic_level_id=sub_context["load"].subject.academic_level_id)
    db.add_all([subj_x, subj_y])
    db.flush()

    load_x = SubjectLoad(
        class_id=sub_context["class"].class_id,
        subject_id=subj_x.subject_id,
        academic_period_id=sub_context["period"].academic_period_id,
        staff_id=sub_context["maria_staff"].staff_id,
        status="published",
        start_time="09:00",
        end_time="10:00",
        days_of_week=["TUESDAY"],
    )
    load_y = SubjectLoad(
        class_id=sub_context["class"].class_id,
        subject_id=subj_y.subject_id,
        academic_period_id=sub_context["period"].academic_period_id,
        staff_id=sub_context["maria_staff"].staff_id,
        status="published",
        start_time="11:00",
        end_time="12:00",
        days_of_week=["TUESDAY"],
    )
    db.add_all([load_x, load_y])
    db.commit()

    # Batch A (Maternity Leave covering load_x)
    res_a = client.post("/api/v1/substitutions/bulk", json={
        "subject_load_ids": [load_x.subject_load_id],
        "substitute_staff_id": sub_context["juan_staff"].staff_id,
        "start_date": today.isoformat(),
        "end_date": (today + timedelta(days=90)).isoformat(),
        "reason": "Batch A - Maternity",
    })
    assert res_a.status_code == 201
    batch_a_id = res_a.json()["batch_id"]

    # Batch B (Unrelated short leave covering load_y for the SAME teacher Maria)
    res_b = client.post("/api/v1/substitutions/bulk", json={
        "subject_load_ids": [load_y.subject_load_id],
        "substitute_staff_id": sub_context["juan_staff"].staff_id,
        "start_date": today.isoformat(),
        "end_date": (today + timedelta(days=90)).isoformat(),
        "reason": "Batch B - Research Sabbatical",
    })
    assert res_b.status_code == 201
    batch_b_id = res_b.json()["batch_id"]

    assert batch_a_id != batch_b_id

    # Ending Batch A early must ONLY end Batch A, and leave Batch B active!
    res_end = client.patch(f"/api/v1/substitutions/batch/{batch_a_id}/end")
    assert res_end.status_code == 200
    assert len(res_end.json()) == 1
    assert res_end.json()[0]["status"] == "completed"

    # Verify Batch B row in database is STILL ACTIVE and unchanged
    sub_b_row = db.query(TeacherSubstitution).filter(TeacherSubstitution.batch_id == uuid.UUID(batch_b_id)).first()
    assert sub_b_row.status == "active"
    assert sub_b_row.end_date == today + timedelta(days=90)


def test_batch_adjust_and_end_endpoints_skip_completed_rows(sub_context):
    db = sub_context["db"]
    client = _make_client(db, user_role="admin", user_sub=str(sub_context["admin_staff"].user_id))

    today = date.today()
    subj_1 = Subject(subject_name="Hist 1", subject_codename="HST1", academic_level_id=sub_context["load"].subject.academic_level_id)
    subj_2 = Subject(subject_name="Hist 2", subject_codename="HST2", academic_level_id=sub_context["load"].subject.academic_level_id)
    db.add_all([subj_1, subj_2])
    db.flush()

    l1 = SubjectLoad(
        class_id=sub_context["class"].class_id,
        subject_id=subj_1.subject_id,
        academic_period_id=sub_context["period"].academic_period_id,
        staff_id=sub_context["maria_staff"].staff_id,
        status="published",
        start_time="07:00",
        end_time="08:00",
        days_of_week=["WEDNESDAY"],
    )
    l2 = SubjectLoad(
        class_id=sub_context["class"].class_id,
        subject_id=subj_2.subject_id,
        academic_period_id=sub_context["period"].academic_period_id,
        staff_id=sub_context["maria_staff"].staff_id,
        status="published",
        start_time="08:00",
        end_time="09:00",
        days_of_week=["WEDNESDAY"],
    )
    db.add_all([l1, l2])
    db.commit()

    # Create 2-load batch
    res_batch = client.post("/api/v1/substitutions/bulk", json={
        "subject_load_ids": [l1.subject_load_id, l2.subject_load_id],
        "substitute_staff_id": sub_context["juan_staff"].staff_id,
        "start_date": today.isoformat(),
        "end_date": (today + timedelta(days=30)).isoformat(),
        "reason": "Batch with mixed lifecycle",
    })
    assert res_batch.status_code == 201
    batch_id = res_batch.json()["batch_id"]
    sub1_id = res_batch.json()["substitutions"][0]["substitution_id"]
    sub2_id = res_batch.json()["substitutions"][1]["substitution_id"]

    # Individually end row 1 early
    res_single_end = client.patch(f"/api/v1/substitutions/{sub1_id}/end")
    assert res_single_end.status_code == 200
    assert res_single_end.json()["status"] == "completed"

    # Now adjust the remaining active rows in the batch by extending end date to +60 days
    new_end = (today + timedelta(days=60)).isoformat()
    res_adjust_batch = client.patch(f"/api/v1/substitutions/batch/{batch_id}/end-date", json={"end_date": new_end})
    assert res_adjust_batch.status_code == 200
    # Should only return and update the active row (row 2)
    assert len(res_adjust_batch.json()) == 1
    assert res_adjust_batch.json()[0]["substitution_id"] == sub2_id
    assert res_adjust_batch.json()[0]["end_date"] == new_end

    # Row 1 must remain completed with end_date = today
    sub1_row = db.query(TeacherSubstitution).filter(TeacherSubstitution.substitution_id == sub1_id).first()
    assert sub1_row.status == "completed"
    assert sub1_row.end_date == today


def test_batch_cancel_filters_per_row_start_date(sub_context):
    db = sub_context["db"]
    client = _make_client(db, user_role="admin", user_sub=str(sub_context["admin_staff"].user_id))

    today = date.today()
    batch_id = uuid.uuid4()

    subj_m1 = Subject(subject_name="Mix 1", subject_codename="MX1", academic_level_id=sub_context["load"].subject.academic_level_id)
    subj_m2 = Subject(subject_name="Mix 2", subject_codename="MX2", academic_level_id=sub_context["load"].subject.academic_level_id)
    db.add_all([subj_m1, subj_m2])
    db.flush()

    lm1 = SubjectLoad(
        class_id=sub_context["class"].class_id,
        subject_id=subj_m1.subject_id,
        academic_period_id=sub_context["period"].academic_period_id,
        staff_id=sub_context["maria_staff"].staff_id,
        status="published",
        start_time="10:00",
        end_time="11:00",
        days_of_week=["THURSDAY"],
    )
    lm2 = SubjectLoad(
        class_id=sub_context["class"].class_id,
        subject_id=subj_m2.subject_id,
        academic_period_id=sub_context["period"].academic_period_id,
        staff_id=sub_context["maria_staff"].staff_id,
        status="published",
        start_time="11:00",
        end_time="12:00",
        days_of_week=["THURSDAY"],
    )
    db.add_all([lm1, lm2])
    db.flush()

    # Sub 1: Started yesterday (cannot be cancelled)
    sub1 = TeacherSubstitution(
        batch_id=batch_id,
        subject_load_id=lm1.subject_load_id,
        original_staff_id="T-001",
        substitute_staff_id="T-002",
        start_date=today - timedelta(days=1),
        end_date=today + timedelta(days=30),
        status="active",
    )
    # Sub 2: Starts in 15 days (can be cancelled)
    sub2 = TeacherSubstitution(
        batch_id=batch_id,
        subject_load_id=lm2.subject_load_id,
        original_staff_id="T-001",
        substitute_staff_id="T-002",
        start_date=today + timedelta(days=15),
        end_date=today + timedelta(days=45),
        status="active",
    )
    db.add_all([sub1, sub2])
    db.commit()

    # Call batch cancel
    res_cancel = client.patch(f"/api/v1/substitutions/batch/{batch_id}/cancel")
    assert res_cancel.status_code == 200
    assert len(res_cancel.json()) == 1
    assert res_cancel.json()[0]["substitution_id"] == sub2.substitution_id
    assert res_cancel.json()[0]["status"] == "cancelled"

    # Sub 1 must still be active!
    db.refresh(sub1)
    assert sub1.status == "active"


def test_bulk_substitution_schedule_conflict_atomic_rollback(sub_context):
    db = sub_context["db"]
    client = _make_client(db, user_role="admin", user_sub=str(sub_context["admin_staff"].user_id))

    # Give Juan an existing load on FRIDAY 08:00 - 09:00
    subj_clash = Subject(subject_name="Clash Subj", subject_codename="CLSH", academic_level_id=sub_context["load"].subject.academic_level_id)
    db.add(subj_clash)
    db.flush()
    load_clash = SubjectLoad(
        class_id=sub_context["class"].class_id,
        subject_id=subj_clash.subject_id,
        academic_period_id=sub_context["period"].academic_period_id,
        staff_id=sub_context["juan_staff"].staff_id,
        status="published",
        start_time="08:00",
        end_time="09:00",
        days_of_week=["FRIDAY"],
    )
    db.add(load_clash)
    db.commit()

    today = date.today()
    # Maria's existing load from fixture is on MONDAY, WEDNESDAY, FRIDAY 08:00-09:00 (which clashes on FRIDAY with Juan)
    # Attempt bulk assignment containing Maria's load
    payload = {
        "subject_load_ids": [sub_context["load"].subject_load_id],
        "substitute_staff_id": sub_context["juan_staff"].staff_id,
        "start_date": today.isoformat(),
        "end_date": (today + timedelta(days=30)).isoformat(),
        "reason": "Bulk with double booking",
    }
    res = client.post("/api/v1/substitutions/bulk", json=payload)
    assert res.status_code == 422
    assert "conflict" in res.json()["detail"].lower()
    assert "double-booked" in res.json()["detail"].lower()

    # Verify atomic rollback: 0 rows inserted
    count = db.query(TeacherSubstitution).filter(TeacherSubstitution.subject_load_id == sub_context["load"].subject_load_id).count()
    assert count == 0




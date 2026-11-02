"""Authorization, identity, and period isolation for mounted analytics routes."""

import uuid
from datetime import date

import pytest

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.UserAccount import UserAccount
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student

from tests.test_teacher_dashboard_health import create_client, data, db


def _add_year_period(db, *, year_label, start_date, end_date, is_year_active=False, is_period_active=False):
    year = AcademicYear(
        year_label=year_label,
        start_date=start_date,
        end_date=end_date,
        is_active=is_year_active,
    )
    db.add(year)
    db.flush()
    period = AcademicPeriod(
        academic_year_id=year.academic_year_id,
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        start_date=start_date,
        end_date=end_date,
        is_active=is_period_active,
    )
    db.add(period)
    db.commit()
    return year, period


def test_overview_defaults_to_canonical_active_period(db, data):
    client = create_client(db, {"sub": str(uuid.uuid4()), "role": "admin"})

    response = client.get("/analytics/overview", params={"scope": "system"})

    assert response.status_code == 200, response.text
    assert response.json()["term_info"]["period_id"] == data["period"].academic_period_id


@pytest.mark.parametrize(
    "year_label,start_date,end_date",
    [
        ("2025-2026", date(2025, 6, 1), date(2026, 3, 31)),
        ("2027-2028", date(2027, 6, 1), date(2028, 3, 31)),
    ],
)
def test_explicit_historical_and_future_periods_are_respected(
    db,
    data,
    year_label,
    start_date,
    end_date,
):
    _, period = _add_year_period(
        db,
        year_label=year_label,
        start_date=start_date,
        end_date=end_date,
    )
    client = create_client(db, {"sub": str(uuid.uuid4()), "role": "admin"})

    response = client.get("/analytics/overview", params={
        "scope": "system",
        "academic_period_id": period.academic_period_id,
    })

    assert response.status_code == 200, response.text
    assert response.json()["term_info"] == {
        "period_id": period.academic_period_id,
        "period_name": period.period_name,
        "academic_year": year_label,
        "is_active": False,
    }
    assert response.json()["details"]["teachers"]["active_loads"] == 0


def test_missing_active_context_does_not_fall_back_but_explicit_period_still_works(db, data):
    data["year"].is_active = False
    data["period"].is_active = False
    db.commit()
    admin = create_client(db, {"sub": str(uuid.uuid4()), "role": "admin"})
    teacher = create_client(db, {"sub": str(data["teacher"].user_id), "role": "teacher"})

    overview = admin.get("/analytics/overview", params={"scope": "system"})
    dashboard = teacher.get("/analytics/teacher/dashboard-health")
    explicit = admin.get("/analytics/overview", params={
        "scope": "system",
        "academic_period_id": data["previous_period"].academic_period_id,
    })

    assert overview.status_code == dashboard.status_code == 409
    assert overview.json()["detail"] == dashboard.json()["detail"] == "No active academic year is configured."
    assert explicit.status_code == 200, explicit.text
    assert explicit.json()["term_info"]["period_id"] == data["previous_period"].academic_period_id


def test_missing_active_period_does_not_fall_back_to_latest_period(db, data):
    data["period"].is_active = False
    db.commit()
    client = create_client(db, {"sub": str(uuid.uuid4()), "role": "admin"})

    response = client.get("/analytics/overview", params={"scope": "system"})

    assert response.status_code == 409
    assert response.json()["detail"] == "No active grading period is configured."


def test_multiple_active_academic_years_are_rejected(db, data):
    _add_year_period(
        db,
        year_label="2027-2028",
        start_date=date(2027, 6, 1),
        end_date=date(2028, 3, 31),
        is_year_active=True,
    )
    client = create_client(db, {"sub": str(uuid.uuid4()), "role": "admin"})

    response = client.get("/analytics/overview", params={"scope": "system"})

    assert response.status_code == 409
    assert "multiple academic years are active" in response.json()["detail"]


def test_inconsistent_active_periods_are_rejected_without_fallback(db, data):
    data["previous_period"].is_active = True
    db.commit()
    client = create_client(db, {"sub": str(uuid.uuid4()), "role": "admin"})

    response = client.get("/analytics/overview", params={"scope": "system"})

    assert response.status_code == 409
    assert "multiple grading periods are active" in response.json()["detail"]


def test_active_period_outside_active_year_is_rejected(db, data):
    data["period"].is_active = False
    _, future_period = _add_year_period(
        db,
        year_label="2027-2028",
        start_date=date(2027, 6, 1),
        end_date=date(2028, 3, 31),
        is_period_active=True,
    )
    client = create_client(db, {"sub": str(uuid.uuid4()), "role": "admin"})

    response = client.get("/analytics/overview", params={"scope": "system"})

    assert future_period.is_active is True
    assert response.status_code == 409
    assert "active grading period is not in the active academic year" in response.json()["detail"]


def test_inconsistent_cross_year_load_is_excluded_from_analytics(db, data):
    baseline = create_client(db, {"sub": str(uuid.uuid4()), "role": "admin"}).get(
        "/analytics/overview",
        params={"scope": "system", "academic_period_id": data["period"].academic_period_id},
    ).json()["details"]
    future_year = AcademicYear(
        year_label="2027-2028",
        start_date=date(2027, 6, 1),
        end_date=date(2028, 3, 31),
        is_active=False,
    )
    account = UserAccount(user_id=uuid.uuid4(), email="cross-year-analytics@example.test")
    staff = AcademicStaff(
        staff_id="T-CROSS-YEAR",
        first_name="Cross",
        last_name="Year",
        user_id=account.user_id,
    )
    db.add_all([future_year, account, staff])
    db.flush()
    future_class = Class(
        section_name="Future Mismatch",
        academic_year_id=future_year.academic_year_id,
        academic_level_id=data["class_"].academic_level_id,
        class_status="active",
    )
    db.add(future_class)
    db.flush()
    db.add(SubjectLoad(
        staff_id=staff.staff_id,
        class_id=future_class.class_id,
        subject_id=data["subject"].subject_id,
        academic_period_id=data["period"].academic_period_id,
        status="published",
        is_active_version=True,
    ))
    db.commit()
    admin = create_client(db, {"sub": str(uuid.uuid4()), "role": "admin"})

    system = admin.get("/analytics/overview", params={
        "scope": "system",
        "academic_period_id": data["period"].academic_period_id,
    })
    teacher = admin.get("/analytics/overview", params={
        "scope": "teacher",
        "staff_id": staff.staff_id,
        "academic_period_id": data["period"].academic_period_id,
    })

    assert system.status_code == teacher.status_code == 200
    assert system.json()["details"]["teachers"] == baseline["teachers"]
    assert system.json()["details"]["subjects"] == baseline["subjects"]
    assert teacher.json()["details"]["classes_count"] == 0
    assert teacher.json()["details"]["students_count"] == 0


def test_teacher_overview_derives_identity_and_ignores_staff_impersonation(db, data):
    client = create_client(db, {"sub": str(data["teacher"].user_id), "role": "teacher"})
    response = client.get("/analytics/overview", params={
        "scope": "teacher",
        "staff_id": data["other_teacher"].staff_id,
        "academic_period_id": data["period"].academic_period_id,
    })
    assert response.status_code == 200
    body = response.json()
    assert body["details"]["staff_id"] == data["teacher"].staff_id
    assert body["details"]["classes_count"] == 1


def test_admin_can_select_teacher_and_unknown_teacher_is_not_substituted(db, data):
    client = create_client(db, {"sub": str(uuid.uuid4()), "role": "admin"})
    selected = client.get("/analytics/overview", params={
        "scope": "teacher",
        "staff_id": data["other_teacher"].staff_id,
        "academic_period_id": data["period"].academic_period_id,
    })
    assert selected.status_code == 200
    assert selected.json()["details"]["staff_id"] == data["other_teacher"].staff_id

    missing = client.get("/analytics/overview", params={
        "scope": "teacher", "staff_id": "T-NOT-REAL",
        "academic_period_id": data["period"].academic_period_id,
    })
    assert missing.status_code == 404


@pytest.mark.parametrize("scope", ["system", "teacher", "class", "subject"])
def test_students_cannot_access_staff_or_school_analytics(db, data, scope):
    client = create_client(db, {"sub": str(data["students"]["active_one"].student_id), "role": "student"})
    response = client.get("/analytics/overview", params={
        "scope": scope,
        "staff_id": data["teacher"].staff_id,
        "class_id": data["class_"].class_id,
        "subject_id": data["subject"].subject_id,
        "academic_period_id": data["period"].academic_period_id,
    })
    assert response.status_code == 403


@pytest.mark.parametrize("scope", ["system", "class", "subject"])
def test_teacher_cannot_access_admin_aggregate_overviews(db, data, scope):
    client = create_client(db, {"sub": str(data["teacher"].user_id), "role": "teacher"})
    response = client.get("/analytics/overview", params={
        "scope": scope,
        "class_id": data["class_"].class_id,
        "subject_id": data["subject"].subject_id,
        "academic_period_id": data["period"].academic_period_id,
    })
    assert response.status_code == 403


def test_teacher_overview_has_no_cross_period_fallback(db, data):
    client = create_client(db, {"sub": str(data["empty_teacher"].user_id), "role": "teacher"})
    response = client.get("/analytics/overview", params={
        "scope": "teacher", "academic_period_id": data["period"].academic_period_id,
    })
    assert response.status_code == 200
    assert response.json()["details"]["staff_id"] == data["empty_teacher"].staff_id
    assert response.json()["details"]["classes_count"] == 0
    assert response.json()["details"]["students_count"] == 0


def test_admin_system_empty_period_returns_genuine_zero_and_empty_data(db, data):
    client = create_client(db, {"sub": str(uuid.uuid4()), "role": "admin"})
    response = client.get("/analytics/overview", params={
        "scope": "system", "academic_period_id": data["empty_period"].academic_period_id,
    })
    assert response.status_code == 200
    body = response.json()
    assert body["details"]["teachers"]["active_loads"] == 0
    assert body["details"]["subjects"]["active"] == 0
    assert body["details"]["enrollment_trend"] == []
    cards = {card["title"]: card for card in body["cards"]}
    assert cards["Ungraded Backlog"]["count"] == "0"
    assert cards["Assessments Published"]["count"] == "0"


def test_admin_class_and_subject_overviews_keep_exact_period_scope(db, data):
    client = create_client(db, {"sub": str(uuid.uuid4()), "role": "admin"})
    class_result = client.get("/analytics/overview", params={
        "scope": "class", "class_id": data["class_"].class_id,
        "academic_period_id": data["period"].academic_period_id,
    })
    subject_result = client.get("/analytics/overview", params={
        "scope": "subject", "subject_id": data["subject"].subject_id,
        "academic_period_id": data["period"].academic_period_id,
    })
    assert class_result.status_code == subject_result.status_code == 200
    assert class_result.json()["details"]["total_subjects"] == 1
    assert subject_result.json()["details"]["classes_count"] == 1
    assert subject_result.json()["details"]["teachers_count"] == 2


def test_system_overview_does_not_mix_another_academic_year(db, data):
    client = create_client(db, {"sub": str(uuid.uuid4()), "role": "admin"})
    params = {"scope": "system", "academic_period_id": data["period"].academic_period_id}
    baseline = client.get("/analytics/overview", params=params).json()["details"]

    future_year = AcademicYear(
        year_label="2027-2028", start_date=date(2027, 6, 1), end_date=date(2028, 3, 31), is_active=False,
    )
    db.add(future_year)
    db.flush()
    future_period = AcademicPeriod(
        academic_year_id=future_year.academic_year_id, period_name="Term 1", period_type="TERM",
        period_sequence=1, total_periods_in_year=3, start_date=date(2027, 6, 1), end_date=date(2027, 8, 31),
    )
    future_class = Class(
        section_name="Future", academic_year_id=future_year.academic_year_id,
        academic_level_id=data["class_"].academic_level_id, class_status="active",
    )
    account = UserAccount(user_id=uuid.uuid4(), email="future-analytics@example.test")
    staff = AcademicStaff(staff_id="T-FUTURE-AN", first_name="Future", last_name="Teacher", user_id=account.user_id)
    student = Student(
        student_id=uuid.uuid4(), student_lrn="999999999998", first_name="Future", last_name="Learner",
        academic_level_id=data["class_"].academic_level_id,
    )
    db.add_all([future_period, future_class, account, staff, student])
    db.flush()
    db.add_all([
        StudentClass(
            student_id=student.student_id, class_id=future_class.class_id,
            academic_year_id=future_year.academic_year_id, enrollment_status="enrolled",
        ),
        SubjectLoad(
            staff_id=staff.staff_id, class_id=future_class.class_id, subject_id=data["subject"].subject_id,
            academic_period_id=future_period.academic_period_id, status="published", is_active_version=True,
        ),
    ])
    db.commit()

    scoped = client.get("/analytics/overview", params=params).json()["details"]
    assert scoped["students"] == baseline["students"]
    assert scoped["teachers"] == baseline["teachers"]
    assert scoped["classes"] == baseline["classes"]
    assert scoped["subjects"] == baseline["subjects"]


def test_explicit_invalid_period_and_partial_dashboard_filter_are_rejected(db, data):
    teacher = create_client(db, {"sub": str(data["teacher"].user_id), "role": "teacher"})
    assert teacher.get("/analytics/overview", params={
        "scope": "teacher", "academic_period_id": 999999,
    }).status_code == 404
    partial = teacher.get("/analytics/teacher/dashboard-health", params={
        "academic_period_id": data["period"].academic_period_id,
        "class_id": data["class_"].class_id,
    })
    assert partial.status_code == 400

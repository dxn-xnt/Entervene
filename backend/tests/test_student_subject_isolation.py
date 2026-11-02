from datetime import date

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.services.academic.AcademicLifecycleService import activate_academic_period
from tests.test_student_active_period_resolution import student_context


def _add_load(
    context,
    *,
    class_id,
    period_id,
    subject_id=None,
    logical_load_id=None,
    version=1,
    is_active_version=True,
    status="published",
):
    load = SubjectLoad(
        class_id=class_id,
        subject_id=subject_id or context["load_math_t1"].subject_id,
        staff_id=context["load_math_t1"].staff_id,
        academic_period_id=period_id,
        logical_load_id=logical_load_id or f"LOAD-{class_id}-{period_id}-{version}",
        version=version,
        is_active_version=is_active_version,
        status=status,
    )
    context["db"].add(load)
    context["db"].flush()
    return load


def _subject_names(response):
    assert response.status_code == 200
    return [row["subject_name"] for row in response.json()]


def test_explicit_period_returns_only_published_active_load_version(student_context):
    c = student_context
    old = c["load_math_t1"]
    old.logical_load_id = "MATH-T1"
    old.version = 1
    old.is_active_version = False
    current = _add_load(
        c,
        class_id=c["class_curr"].class_id,
        period_id=c["period_t1"].academic_period_id,
        logical_load_id="MATH-T1",
        version=2,
        is_active_version=True,
    )
    c["db"].commit()

    response = c["client"].get(
        f"/api/v1/students/me/subjects?academic_period_id={c['period_t1'].academic_period_id}"
    )

    assert _subject_names(response) == ["Mathematics 10"]
    assert response.json()[0]["subject_load_id"] == current.subject_load_id


def test_inactive_or_unpublished_active_versions_are_not_visible(student_context):
    c = student_context
    c["load_math_t1"].is_active_version = False
    _add_load(
        c,
        class_id=c["class_curr"].class_id,
        period_id=c["period_t1"].academic_period_id,
        subject_id=c["load_math_t1"].subject_id,
        status="draft",
        is_active_version=True,
    )
    c["db"].commit()

    response = c["client"].get(
        f"/api/v1/students/me/subjects?academic_period_id={c['period_t1'].academic_period_id}"
    )

    assert _subject_names(response) == []


def test_malformed_cross_year_load_is_excluded(student_context):
    c = student_context
    malformed = _add_load(
        c,
        class_id=c["class_curr"].class_id,
        period_id=c["period_future_t1"].academic_period_id,
    )
    c["db"].commit()

    response = c["client"].get(
        f"/api/v1/students/me/subjects?academic_period_id={c['period_future_t1'].academic_period_id}"
    )

    assert _subject_names(response) == []
    assert malformed.academic_period_id == c["period_future_t1"].academic_period_id


def test_exact_current_and_historical_term_selection_is_preserved(student_context):
    c = student_context
    activate_academic_period(c["db"], academic_period_id=c["period_t2"].academic_period_id)

    historical = c["client"].get(
        f"/api/v1/students/me/subjects?academic_period_id={c['period_t1'].academic_period_id}"
    )
    current = c["client"].get(
        f"/api/v1/students/me/subjects?academic_period_id={c['period_t2'].academic_period_id}"
    )
    missing = c["client"].get("/api/v1/students/me/subjects?academic_period_id=999999")

    assert _subject_names(historical) == ["Mathematics 10"]
    assert historical.json()[0]["is_current_period"] is False
    assert _subject_names(current) == ["Science 10"]
    assert current.json()[0]["is_current_period"] is True
    assert _subject_names(missing) == []


def test_historical_and_future_year_enrollments_remain_readable(student_context):
    c = student_context
    db = c["db"]
    historical_year = AcademicYear(
        year_label="2024-2025",
        start_date=date(2024, 8, 1),
        end_date=date(2025, 5, 31),
        is_active=False,
    )
    db.add(historical_year)
    db.flush()
    historical_period = AcademicPeriod(
        academic_year_id=historical_year.academic_year_id,
        period_name="Historical Term 1",
        period_type="TERM",
        period_sequence=1,
        start_date=date(2024, 8, 1),
        end_date=date(2024, 11, 15),
        is_active=False,
    )
    historical_class = Class(
        section_name="Historical Rizal",
        academic_year_id=historical_year.academic_year_id,
        academic_level_id=c["class_curr"].academic_level_id,
        class_status="archived",
    )
    future_class = Class(
        section_name="Future Rizal",
        academic_year_id=c["year_future"].academic_year_id,
        academic_level_id=c["class_curr"].academic_level_id,
        class_status="active",
    )
    db.add_all([historical_period, historical_class, future_class])
    db.flush()
    db.add_all([
        StudentClass(
            student_id=c["student"].student_id,
            class_id=historical_class.class_id,
            academic_year_id=historical_year.academic_year_id,
            enrollment_status="enrolled",
        ),
        StudentClass(
            student_id=c["student"].student_id,
            class_id=future_class.class_id,
            academic_year_id=c["year_future"].academic_year_id,
            enrollment_status="enrolled",
        ),
    ])
    historical_load = _add_load(
        c,
        class_id=historical_class.class_id,
        period_id=historical_period.academic_period_id,
    )
    future_load = _add_load(
        c,
        class_id=future_class.class_id,
        period_id=c["period_future_t1"].academic_period_id,
    )
    db.commit()

    historical = c["client"].get(
        f"/api/v1/students/me/subjects?academic_period_id={historical_period.academic_period_id}"
    )
    future = c["client"].get(
        f"/api/v1/students/me/subjects?academic_period_id={c['period_future_t1'].academic_period_id}"
    )

    assert historical.json()[0]["subject_load_id"] == historical_load.subject_load_id
    assert historical.json()[0]["year_label"] == "2024-2025"
    assert future.json()[0]["subject_load_id"] == future_load.subject_load_id
    assert future.json()[0]["year_label"] == "2026-2027"


def test_unscoped_query_keeps_all_valid_periods_without_superseded_or_cross_year_rows(student_context):
    c = student_context
    old = c["load_math_t1"]
    old.is_active_version = False
    _add_load(
        c,
        class_id=c["class_curr"].class_id,
        period_id=c["period_t1"].academic_period_id,
        logical_load_id=old.logical_load_id,
        version=2,
    )
    _add_load(
        c,
        class_id=c["class_curr"].class_id,
        period_id=c["period_future_t1"].academic_period_id,
        logical_load_id="MALFORMED-FUTURE",
    )
    c["db"].commit()

    response = c["client"].get("/api/v1/students/me/subjects")

    assert sorted(_subject_names(response)) == ["Mathematics 10", "Science 10"]
    assert len(response.json()) == 2


def test_unenrolled_class_and_non_student_role_are_unauthorized(student_context):
    c = student_context
    other_class = Class(
        section_name="Other Section",
        academic_year_id=c["year_current"].academic_year_id,
        academic_level_id=c["class_curr"].academic_level_id,
        class_status="active",
    )
    c["db"].add(other_class)
    c["db"].flush()
    _add_load(
        c,
        class_id=other_class.class_id,
        period_id=c["period_t1"].academic_period_id,
    )
    c["db"].commit()

    enrolled = c["client"].get(
        f"/api/v1/students/me/subjects?academic_period_id={c['period_t1'].academic_period_id}"
    )
    assert _subject_names(enrolled) == ["Mathematics 10"]

    c["identity"]["role"] = "teacher"
    forbidden = c["client"].get(
        f"/api/v1/students/me/subjects?academic_period_id={c['period_t1'].academic_period_id}"
    )
    assert forbidden.status_code == 403
    assert forbidden.json()["detail"] == "Only students can access this resource"

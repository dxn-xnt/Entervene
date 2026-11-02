from datetime import date, datetime, timezone

from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.academic.AcademicLifecycleService import activate_academic_period
from tests.test_student_active_period_resolution import student_context


def _add_assignment(context, *, title, class_id, period_id, recipient_student_id=None):
    db = context["db"]
    subject = db.query(Subject).filter(Subject.subject_name == "Mathematics 10").one()
    work = Classwork(
        title=title,
        classwork_type="ASSIGNMENT",
        classwork_category="WRITTEN_WORK",
        subject_id=subject.subject_id,
        created_by_staff_id=context["load_math_t1"].staff_id,
        is_published=True,
        is_archived=False,
    )
    db.add(work)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=work.classwork_id,
        class_id=class_id,
        academic_period_id=period_id,
        recipient_student_id=recipient_student_id,
        assigned_by_staff_id=context["load_math_t1"].staff_id,
        due_date=datetime(2027, 1, 1, tzinfo=timezone.utc),
        is_published=True,
    )
    db.add(assignment)
    db.flush()
    return assignment


def _titles(response):
    assert response.status_code == 200
    return [item["title"] for item in response.json()["all"]]


def test_explicit_period_uses_assignment_period_and_ignores_load_revisions(student_context):
    c = student_context
    db = c["db"]
    subject_id = c["load_math_t1"].subject_id
    term1 = _add_assignment(
        c,
        title="Term 1 Mathematics",
        class_id=c["class_curr"].class_id,
        period_id=c["period_t1"].academic_period_id,
    )
    term2 = _add_assignment(
        c,
        title="Term 2 Mathematics",
        class_id=c["class_curr"].class_id,
        period_id=c["period_t2"].academic_period_id,
    )
    db.add_all([
        SubjectLoad(
            class_id=c["class_curr"].class_id,
            subject_id=subject_id,
            staff_id=c["load_math_t1"].staff_id,
            academic_period_id=c["period_t2"].academic_period_id,
            logical_load_id="MATH-T2",
            version=1,
            is_active_version=False,
            status="published",
        ),
        SubjectLoad(
            class_id=c["class_curr"].class_id,
            subject_id=subject_id,
            staff_id=c["load_math_t1"].staff_id,
            academic_period_id=c["period_t2"].academic_period_id,
            logical_load_id="MATH-T2",
            version=2,
            is_active_version=True,
            status="published",
        ),
    ])
    db.commit()

    response = c["client"].get(
        f"/api/v1/students/me/todos?academic_period_id={c['period_t2'].academic_period_id}"
    )

    assert _titles(response) == ["Term 2 Mathematics"]
    assert response.json()["all"][0]["assignment_id"] == term2.classwork_assignment_id
    assert term1.classwork_assignment_id != term2.classwork_assignment_id


def test_current_historical_and_future_periods_preserve_exact_selection(student_context):
    c = student_context
    term1 = _add_assignment(
        c,
        title="Historical Term 1",
        class_id=c["class_curr"].class_id,
        period_id=c["period_t1"].academic_period_id,
    )
    term2 = _add_assignment(
        c,
        title="Current Term 2",
        class_id=c["class_curr"].class_id,
        period_id=c["period_t2"].academic_period_id,
    )
    c["db"].commit()
    activate_academic_period(c["db"], academic_period_id=c["period_t2"].academic_period_id)

    historical = c["client"].get(
        f"/api/v1/students/me/todos?academic_period_id={c['period_t1'].academic_period_id}"
    )
    current = c["client"].get(
        f"/api/v1/students/me/todos?academic_period_id={c['period_t2'].academic_period_id}"
    )
    missing = c["client"].get("/api/v1/students/me/todos?academic_period_id=999999")

    assert _titles(historical) == ["Historical Term 1"]
    assert _titles(current) == ["Current Term 2"]
    assert _titles(missing) == []
    assert historical.json()["all"][0]["assignment_id"] == term1.classwork_assignment_id
    assert current.json()["all"][0]["assignment_id"] == term2.classwork_assignment_id


def test_omitted_period_preserves_unscoped_all_period_contract(student_context):
    c = student_context
    _add_assignment(
        c,
        title="Unscoped Term 1",
        class_id=c["class_curr"].class_id,
        period_id=c["period_t1"].academic_period_id,
    )
    _add_assignment(
        c,
        title="Unscoped Term 2",
        class_id=c["class_curr"].class_id,
        period_id=c["period_t2"].academic_period_id,
    )
    c["db"].commit()

    response = c["client"].get("/api/v1/students/me/todos")

    assert sorted(_titles(response)) == ["Unscoped Term 1", "Unscoped Term 2"]


def test_cross_year_mismatch_is_excluded_but_valid_future_enrollment_is_readable(student_context):
    c = student_context
    db = c["db"]
    future_class = Class(
        section_name="Future Rizal",
        academic_year_id=c["year_future"].academic_year_id,
        academic_level_id=c["class_curr"].academic_level_id,
        class_status="active",
    )
    db.add(future_class)
    db.flush()
    db.add(StudentClass(
        student_id=c["student"].student_id,
        class_id=future_class.class_id,
        academic_year_id=c["year_future"].academic_year_id,
        enrollment_status="enrolled",
    ))
    _add_assignment(
        c,
        title="Malformed Cross-Year Assignment",
        class_id=c["class_curr"].class_id,
        period_id=c["period_future_t1"].academic_period_id,
    )
    valid = _add_assignment(
        c,
        title="Future Year Assignment",
        class_id=future_class.class_id,
        period_id=c["period_future_t1"].academic_period_id,
    )
    db.commit()

    response = c["client"].get(
        f"/api/v1/students/me/todos?academic_period_id={c['period_future_t1'].academic_period_id}"
    )

    assert _titles(response) == ["Future Year Assignment"]
    assert response.json()["all"][0]["assignment_id"] == valid.classwork_assignment_id


def test_historical_academic_year_enrollment_remains_readable(student_context):
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
        period_name="Historical Term 2",
        period_type="TERM",
        period_sequence=2,
        start_date=date(2024, 11, 16),
        end_date=date(2025, 2, 15),
        is_active=False,
    )
    historical_class = Class(
        section_name="Historical Rizal",
        academic_year_id=historical_year.academic_year_id,
        academic_level_id=c["class_curr"].academic_level_id,
        class_status="archived",
    )
    db.add_all([historical_period, historical_class])
    db.flush()
    db.add(StudentClass(
        student_id=c["student"].student_id,
        class_id=historical_class.class_id,
        academic_year_id=historical_year.academic_year_id,
        enrollment_status="enrolled",
    ))
    assignment = _add_assignment(
        c,
        title="Archived Year Assignment",
        class_id=historical_class.class_id,
        period_id=historical_period.academic_period_id,
    )
    db.commit()

    response = c["client"].get(
        f"/api/v1/students/me/todos?academic_period_id={historical_period.academic_period_id}"
    )

    assert _titles(response) == ["Archived Year Assignment"]
    assert response.json()["all"][0]["assignment_id"] == assignment.classwork_assignment_id


def test_unenrolled_assignments_are_not_exposed(student_context):
    c = student_context
    db = c["db"]
    other_class = Class(
        section_name="Other Section",
        academic_year_id=c["year_current"].academic_year_id,
        academic_level_id=c["class_curr"].academic_level_id,
        class_status="active",
    )
    db.add(other_class)
    db.flush()
    _add_assignment(
        c,
        title="Unenrolled Assignment",
        class_id=other_class.class_id,
        period_id=c["period_t1"].academic_period_id,
    )
    own = _add_assignment(
        c,
        title="Authorized Assignment",
        class_id=c["class_curr"].class_id,
        period_id=c["period_t1"].academic_period_id,
    )
    db.commit()

    response = c["client"].get(
        f"/api/v1/students/me/todos?academic_period_id={c['period_t1'].academic_period_id}"
    )

    assert _titles(response) == ["Authorized Assignment"]
    assert response.json()["all"][0]["assignment_id"] == own.classwork_assignment_id


def test_completion_state_is_preserved_with_period_filter(student_context):
    c = student_context
    assignment = _add_assignment(
        c,
        title="Completed Assignment",
        class_id=c["class_curr"].class_id,
        period_id=c["period_t1"].academic_period_id,
    )
    c["db"].add(StudentSubmission(
        student_id=c["student"].student_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        status="graded",
        submitted_at=datetime.now(timezone.utc),
        grade=90,
    ))
    c["db"].commit()

    response = c["client"].get(
        f"/api/v1/students/me/todos?academic_period_id={c['period_t1'].academic_period_id}"
    )

    assert _titles(response) == ["Completed Assignment"]
    assert response.json()["pending"] == []
    assert response.json()["pastdue"] == []
    assert response.json()["completed"][0]["grade"] == 90.0


def test_non_student_role_cannot_read_todos(student_context):
    c = student_context
    c["identity"]["role"] = "teacher"

    response = c["client"].get(
        f"/api/v1/students/me/todos?academic_period_id={c['period_t1'].academic_period_id}"
    )

    assert response.status_code == 403
    assert response.json()["detail"] == "Only students can access this resource"

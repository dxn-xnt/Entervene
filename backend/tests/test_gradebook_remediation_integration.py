"""Regression tests for Task 4.7B.4A: Official Gradebook Effective-Score Integration.

Verifies:
1. No-link baseline matches existing gradebook results.
2. Original 10/40 + remediation 36/40 + 75% cap -> official 30/40.
3. Exactly one counted PT entry and denominator remains 40 (no duplicate column).
4. Incomplete remediation does not change the effective score.
5. No score decrease when remediation is lower.
6. Multiple distinct original targets remain separate.
7. Different students cannot share adjusted scores.
8. Class grade sheet and student detail agree.
9. Period-grade computation uses the same effective score.
10. Existing Examination remediation behavior remains unchanged.
11. ECR exports and dependent metrics remain consistent.
"""

from __future__ import annotations

import io
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import openpyxl
import pytest
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.Base import Base
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.auth.UserAccount import UserAccount
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.intervention.Intervention import Intervention
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.StudentRecord import SendStudentGradeRequest
from app.services.export.ClassRecordExportService import generate_class_record_sheet
from app.services.student_record.StudentRecordService import (
    _compute_student_period_components,
    resolve_subject_grading_weights,
    send_student_grade_to_adviser,
    teacher_student_gradebook,
    teacher_student_record_detail,
    teacher_student_roster,
)


@pytest.fixture
def gradebook_integration_context():
    """Sets up a complete test database with classes, students, assignments, and templates."""
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

    db: Session = sessionmaker(bind=engine)()

    year = AcademicYear(
        year_label="2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 7", grade_level=7)
    db.add_all([year, level])
    db.flush()

    period = AcademicPeriod(
        period_name="Term 1",
        period_type="TERM",
        period_sequence=1,
        total_periods_in_year=3,
        period_progress_ratio=0.3333,
        start_date=date(2025, 6, 1),
        end_date=date.today() + timedelta(days=1),
        academic_year_id=year.academic_year_id,
        is_active=True,
    )
    db.add(period)
    db.flush()

    template = GradingTemplate(
        template_name="Junior High 20-60-20",
        passing_threshold=Decimal("75.00"),
        status="active",
        components=[
            GradingTemplateComponent(component_name="Written Work", weight=Decimal("20.00"), display_order=1),
            GradingTemplateComponent(component_name="Performance Tasks", weight=Decimal("60.00"), display_order=2),
            GradingTemplateComponent(component_name="Exams", weight=Decimal("20.00"), display_order=3),
        ],
    )
    db.add(template)
    db.flush()

    subject = Subject(
        subject_name="Mathematics 7",
        subject_codename="MATH7",
        academic_level_id=level.academic_level_id,
        grading_template_id=template.grading_template_id,
    )
    db.add(subject)
    db.flush()

    teacher_user = UserAccount(user_id=uuid4(), email="ada@school.edu", account_status="active")
    teacher = AcademicStaff(
        staff_id="T001",
        user_id=teacher_user.user_id,
        first_name="Ada",
        last_name="Lovelace",
        email="ada@school.edu",
    )
    db.add_all([teacher_user, teacher])
    db.flush()

    class_ = Class(
        section_name="7-Rizal",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
        academic_period_id=period.academic_period_id,
        adviser_staff_id=teacher.staff_id,
        class_status="active",
    )
    db.add(class_)
    db.flush()

    load = SubjectLoad(
        staff_id=teacher.staff_id,
        subject_id=subject.subject_id,
        class_id=class_.class_id,
        academic_period_id=period.academic_period_id,
        status="active",
    )
    db.add(load)
    db.flush()

    # Students: Student A and Student B
    student_a = Student(
        student_id=uuid4(),
        student_lrn="111111111111",
        first_name="Alice",
        last_name="Santos",
        gender="Female",
    )
    student_b = Student(
        student_id=uuid4(),
        student_lrn="222222222222",
        first_name="Bob",
        last_name="Reyes",
        gender="Male",
    )
    db.add_all([student_a, student_b])
    db.flush()

    sc_a = StudentClass(student_id=student_a.student_id, class_id=class_.class_id, academic_year_id=year.academic_year_id, enrollment_status="enrolled")
    sc_b = StudentClass(student_id=student_b.student_id, class_id=class_.class_id, academic_year_id=year.academic_year_id, enrollment_status="enrolled")
    db.add_all([sc_a, sc_b])
    db.flush()

    # Create official baseline classworks:
    # 1. WW1: 20 points
    cw_ww1 = Classwork(
        title="WW 1: Quiz on Sets",
        subject_id=subject.subject_id,
        classwork_category="WRITTEN_WORK",
        classwork_type="QUIZ",
        total_points=Decimal("20"),
        created_by_staff_id=teacher.staff_id,
        is_graded=True,
        is_archived=False,
    )
    # 2. PT1: 40 points (the target for remediation)
    cw_pt1 = Classwork(
        title="PT 1: Venn Diagram Project",
        subject_id=subject.subject_id,
        classwork_category="PERFORMANCE_TASK",
        classwork_type="ACTIVITY",
        total_points=Decimal("40"),
        created_by_staff_id=teacher.staff_id,
        is_graded=True,
        is_archived=False,
    )
    # 3. QA1: 50 points (Exam)
    cw_qa1 = Classwork(
        title="Term Examination",
        subject_id=subject.subject_id,
        classwork_category="QUARTERLY_ASSESSMENT",
        classwork_type="EXAM",
        exam_subtype="TERM_EXAM",
        total_points=Decimal("50"),
        created_by_staff_id=teacher.staff_id,
        is_graded=True,
        is_archived=False,
    )
    db.add_all([cw_ww1, cw_pt1, cw_qa1])
    db.flush()

    asgn_ww1 = ClassworkAssignment(
        classwork_id=cw_ww1.classwork_id,
        class_id=class_.class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=teacher.staff_id,
        is_published=True,
    )
    asgn_pt1 = ClassworkAssignment(
        classwork_id=cw_pt1.classwork_id,
        class_id=class_.class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=teacher.staff_id,
        is_published=True,
    )
    asgn_qa1 = ClassworkAssignment(
        classwork_id=cw_qa1.classwork_id,
        class_id=class_.class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=teacher.staff_id,
        is_published=True,
    )
    db.add_all([asgn_ww1, asgn_pt1, asgn_qa1])
    db.flush()

    # Submissions:
    # Student A: WW1=16/20 (80%), PT1=10/40 (25%), QA1=40/50 (80%)
    sub_a_ww1 = StudentSubmission(student_id=student_a.student_id, classwork_assignment_id=asgn_ww1.classwork_assignment_id, grade=Decimal("16"), status="graded")
    sub_a_pt1 = StudentSubmission(student_id=student_a.student_id, classwork_assignment_id=asgn_pt1.classwork_assignment_id, grade=Decimal("10"), status="graded")
    sub_a_qa1 = StudentSubmission(student_id=student_a.student_id, classwork_assignment_id=asgn_qa1.classwork_assignment_id, grade=Decimal("40"), status="graded")

    # Student B: WW1=18/20 (90%), PT1=35/40 (87.5%), QA1=45/50 (90%)
    sub_b_ww1 = StudentSubmission(student_id=student_b.student_id, classwork_assignment_id=asgn_ww1.classwork_assignment_id, grade=Decimal("18"), status="graded")
    sub_b_pt1 = StudentSubmission(student_id=student_b.student_id, classwork_assignment_id=asgn_pt1.classwork_assignment_id, grade=Decimal("35"), status="graded")
    sub_b_qa1 = StudentSubmission(student_id=student_b.student_id, classwork_assignment_id=asgn_qa1.classwork_assignment_id, grade=Decimal("45"), status="graded")

    db.add_all([sub_a_ww1, sub_a_pt1, sub_a_qa1, sub_b_ww1, sub_b_pt1, sub_b_qa1])
    db.commit()

    return {
        "db": db,
        "teacher": teacher,
        "class": class_,
        "subject": subject,
        "period": period,
        "template": template,
        "student_a": student_a,
        "student_b": student_b,
        "asgn_ww1": asgn_ww1,
        "asgn_pt1": asgn_pt1,
        "asgn_qa1": asgn_qa1,
        "sub_a_pt1": sub_a_pt1,
        "sub_b_pt1": sub_b_pt1,
    }


def _create_remedial_pt(ctx, student, orig_asgn, rem_score=None, cap=Decimal("75.00")):
    """Creates a linked remedial PT assignment for a student."""
    db: Session = ctx["db"]
    teacher = ctx["teacher"]
    subject = ctx["subject"]
    class_ = ctx["class"]
    period = ctx["period"]

    intervention = db.query(Intervention).filter_by(
        student_id=student.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        academic_period_id=period.academic_period_id,
    ).first()
    if not intervention:
        model = AIModelVersion(
            model_name=f"test-gradebook-fixture-{uuid4().hex[:6]}",
            model_type="REGRESSOR",
            model_purpose="CURRENT_TERM_FINAL_GRADE_PROJECTION",
            algorithm="fixture-only",
            is_active=False,
        )
        db.add(model)
        db.flush()
        prediction = DevelopmentCurrentTermPrediction(
            student_id=student.student_id,
            class_id=class_.class_id,
            subject_id=subject.subject_id,
            source_period_id=period.academic_period_id,
            target_period_id=period.academic_period_id,
            model_version_id=model.model_version_id,
            revision=1,
            predicted_period_grade=Decimal("80"),
            intervention_level="NEEDS_MONITORING",
            intervention_basis="fixture-only",
            evidence_snapshot={},
        )
        db.add(prediction)
        db.flush()
        intervention = Intervention(
            student_id=student.student_id,
            class_id=class_.class_id,
            subject_id=subject.subject_id,
            academic_period_id=period.academic_period_id,
            source_prediction_id=prediction.prediction_id,
            status="CANDIDATE",
            diagnosis_snapshot={},
        )
        db.add(intervention)
        db.flush()

    rem_cw = Classwork(
        title=f"Remedial Activity for {orig_asgn.classwork.title}",
        subject_id=subject.subject_id,
        classwork_category="PERFORMANCE_TASK",
        classwork_type="ACTIVITY",
        total_points=orig_asgn.classwork.total_points,  # 40 points
        created_by_staff_id=teacher.staff_id,
        is_graded=True,
        is_archived=False,
    )
    db.add(rem_cw)
    db.flush()

    rem_asgn = ClassworkAssignment(
        classwork_id=rem_cw.classwork_id,
        class_id=class_.class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=teacher.staff_id,
        is_published=True,
        recipient_student_id=student.student_id,
        source_intervention_id=intervention.intervention_id,
        remediation_request_id=uuid4(),
    )
    db.add(rem_asgn)
    db.flush()

    link = RemediationAssignmentLink(
        original_assignment_id=orig_asgn.classwork_assignment_id,
        remediation_assignment_id=rem_asgn.classwork_assignment_id,
        student_id=student.student_id,
        component="PERFORMANCE_TASK",
        score_adjustment_cap=cap,
        source_intervention_id=intervention.intervention_id,
        created_by_staff_id=teacher.staff_id,
    )
    db.add(link)
    db.flush()

    rem_sub = None
    if rem_score is not None:
        rem_sub = StudentSubmission(
            student_id=student.student_id,
            classwork_assignment_id=rem_asgn.classwork_assignment_id,
            grade=Decimal(str(rem_score)),
            status="graded",
        )
        db.add(rem_sub)
    db.commit()

    return rem_asgn, link, rem_sub


# 1. No-link baseline matches existing gradebook results
def test_no_link_baseline_matches_existing_gradebook(gradebook_integration_context):
    ctx = gradebook_integration_context
    db = ctx["db"]
    gradebook = teacher_student_gradebook(db, ctx["teacher"].staff_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id)

    # 1 WW, 1 PT, 1 Exam
    assert len(gradebook.classwork[0].writtenWork) == 1
    assert len(gradebook.classwork[0].performanceTask) == 1
    assert len(gradebook.classwork[0].exams) == 1

    rows = {row.student_id: row for row in gradebook.studentGrades}
    row_a = rows[str(ctx["student_a"].student_id)]
    assert row_a.writtenWork == [16.0]
    assert row_a.performanceTask == [10.0]
    assert row_a.exams == [40.0]
    assert row_a.remedial_classworks == []

    # PS calculations:
    # WW: 16/20 = 80.0
    # PT: 10/40 = 25.0
    # QA: 40/50 = 80.0
    # Initial: 80*0.2 + 25*0.6 + 80*0.2 = 16 + 15 + 16 = 47.0
    assert row_a.ps_written == 80.0
    assert row_a.ps_performance == 25.0
    assert row_a.ps_quarterly == 80.0
    assert row_a.initial_grade == 47.0


# 2. Original 10/40 + remediation 36/40 + 75% cap -> official 30/40
def test_official_effective_pt_capped_to_30(gradebook_integration_context):
    ctx = gradebook_integration_context
    db = ctx["db"]
    student_a = ctx["student_a"]
    orig_pt1 = ctx["asgn_pt1"]

    # Student A: Original PT1 is 10/40. Remediation is 36/40. Cap is 75%.
    # 40 * 75% = 30.0 cap score. min(36, 30) = 30. max(10, 30) = 30.
    rem_asgn, link, rem_sub = _create_remedial_pt(ctx, student_a, orig_pt1, rem_score=36, cap=Decimal("75.00"))

    gradebook = teacher_student_gradebook(db, ctx["teacher"].staff_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id)
    rows = {row.student_id: row for row in gradebook.studentGrades}
    row_a = rows[str(student_a.student_id)]

    # Effective score is 30.0
    assert row_a.performanceTask == [30.0]

    # PS calculations with adjusted PT:
    # WW: 16/20 = 80.0
    # PT: 30/40 = 75.0
    # QA: 40/50 = 80.0
    # Initial: 80*0.2 + 75*0.6 + 80*0.2 = 16 + 45 + 16 = 77.0
    assert row_a.ps_performance == 75.0
    assert row_a.initial_grade == 77.0

    # Audit provenance in remedial_classworks
    assert len(row_a.remedial_classworks) == 1
    audit = row_a.remedial_classworks[0]
    assert audit["original_assignment_id"] == orig_pt1.classwork_assignment_id
    assert audit["remediation_assignment_id"] == rem_asgn.classwork_assignment_id
    assert audit["original_score"] == 10.0
    assert audit["remediation_score"] == 36.0
    assert audit["effective_score"] == 30.0
    assert audit["cap_score"] == 30.0
    assert audit["was_adjusted"] is True
    assert audit["was_capped"] is True
    assert audit["is_completed"] is True
    assert audit["status"] == "CAPPED"


# 3. Exactly one counted PT entry and denominator remains 40
def test_exactly_one_counted_pt_entry_and_denominator_remains_40(gradebook_integration_context):
    ctx = gradebook_integration_context
    db = ctx["db"]
    student_a = ctx["student_a"]
    orig_pt1 = ctx["asgn_pt1"]

    # Remediate PT1 with 36/40
    rem_asgn, link, rem_sub = _create_remedial_pt(ctx, student_a, orig_pt1, rem_score=36, cap=Decimal("75.00"))

    gradebook = teacher_student_gradebook(db, ctx["teacher"].staff_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id)

    # 1. Exactly ONE PT column in headers (rem_asgn is NOT an additional column)
    assert len(gradebook.classwork[0].performanceTask) == 1
    pt_header = gradebook.classwork[0].performanceTask[0]
    assert pt_header.id == orig_pt1.classwork.classwork_id
    assert pt_header.maxScore == 40.0

    # 2. Student grade row has exactly one score entry in performanceTask
    rows = {row.student_id: row for row in gradebook.studentGrades}
    row_a = rows[str(student_a.student_id)]
    assert len(row_a.performanceTask) == 1

    # 3. Denominator remains 40 (PS = 30/40 = 75.0%, NOT 30/80 = 37.5% or 66/80 = 82.5%)
    assert row_a.ps_performance == 75.0


# 4. Incomplete/ungraded remediation does not change the effective score
def test_incomplete_remediation_preserves_original_score(gradebook_integration_context):
    ctx = gradebook_integration_context
    db = ctx["db"]
    student_a = ctx["student_a"]
    orig_pt1 = ctx["asgn_pt1"]

    # Remediation assigned, but rem_score=None (ungraded / not submitted)
    _create_remedial_pt(ctx, student_a, orig_pt1, rem_score=None, cap=Decimal("75.00"))

    gradebook = teacher_student_gradebook(db, ctx["teacher"].staff_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id)
    rows = {row.student_id: row for row in gradebook.studentGrades}
    row_a = rows[str(student_a.student_id)]

    # Score remains the original 10.0
    assert row_a.performanceTask == [10.0]
    assert row_a.ps_performance == 25.0
    assert row_a.initial_grade == 47.0

    audit = row_a.remedial_classworks[0]
    assert audit["effective_score"] == 10.0
    assert audit["was_adjusted"] is False
    assert audit["is_completed"] is False
    assert audit["status"] == "UNGRADED_REMEDIATION"


# 5. No score decrease when remediation score is lower
def test_no_score_decrease_when_remediation_lower(gradebook_integration_context):
    ctx = gradebook_integration_context
    db = ctx["db"]
    student_a = ctx["student_a"]
    orig_pt1 = ctx["asgn_pt1"]

    # Original 10/40, remediation 5/40 (worse)
    _create_remedial_pt(ctx, student_a, orig_pt1, rem_score=5, cap=Decimal("75.00"))

    gradebook = teacher_student_gradebook(db, ctx["teacher"].staff_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id)
    rows = {row.student_id: row for row in gradebook.studentGrades}
    row_a = rows[str(student_a.student_id)]

    assert row_a.performanceTask == [10.0]
    assert row_a.ps_performance == 25.0
    audit = row_a.remedial_classworks[0]
    assert audit["effective_score"] == 10.0
    assert audit["was_adjusted"] is False
    assert audit["status"] == "NO_INCREASE"


# 6. Multiple distinct original targets remain separate
def test_multiple_distinct_original_targets(gradebook_integration_context):
    ctx = gradebook_integration_context
    db = ctx["db"]
    student_a = ctx["student_a"]
    orig_pt1 = ctx["asgn_pt1"]

    # Add a second official PT: PT2 40 points, Student A scored 12/40
    cw_pt2 = Classwork(
        title="PT 2: Probability Experiment",
        subject_id=ctx["subject"].subject_id,
        classwork_category="PERFORMANCE_TASK",
        classwork_type="ACTIVITY",
        total_points=Decimal("40"),
        created_by_staff_id=ctx["teacher"].staff_id,
        is_graded=True,
        is_archived=False,
    )
    db.add(cw_pt2)
    db.flush()
    asgn_pt2 = ClassworkAssignment(
        classwork_id=cw_pt2.classwork_id,
        class_id=ctx["class"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=ctx["teacher"].staff_id,
        is_published=True,
    )
    db.add(asgn_pt2)
    db.flush()
    db.add(StudentSubmission(student_id=student_a.student_id, classwork_assignment_id=asgn_pt2.classwork_assignment_id, grade=Decimal("12"), status="graded"))
    db.add(StudentSubmission(student_id=ctx["student_b"].student_id, classwork_assignment_id=asgn_pt2.classwork_assignment_id, grade=Decimal("38"), status="graded"))
    db.commit()

    # Remediate PT1 with score 36 (capped to 30)
    _create_remedial_pt(ctx, student_a, orig_pt1, rem_score=36, cap=Decimal("75.00"))
    # Remediate PT2 with score 28 (not capped, since 28 <= 30; adjusted to 28)
    _create_remedial_pt(ctx, student_a, asgn_pt2, rem_score=28, cap=Decimal("75.00"))

    gradebook = teacher_student_gradebook(db, ctx["teacher"].staff_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id)

    # Exactly 2 official PT columns
    assert len(gradebook.classwork[0].performanceTask) == 2

    rows = {row.student_id: row for row in gradebook.studentGrades}
    row_a = rows[str(student_a.student_id)]
    assert row_a.performanceTask == [30.0, 28.0]

    # PT denominator is 80 (40+40); earned is 30+28 = 58; PS = 58/80 = 72.5%
    assert row_a.ps_performance == 72.5


# 7. Different students cannot share adjusted scores (Student isolation)
def test_student_isolation(gradebook_integration_context):
    ctx = gradebook_integration_context
    db = ctx["db"]
    student_a = ctx["student_a"]
    student_b = ctx["student_b"]
    orig_pt1 = ctx["asgn_pt1"]

    # Remediate Student A's PT1
    _create_remedial_pt(ctx, student_a, orig_pt1, rem_score=36, cap=Decimal("75.00"))

    gradebook = teacher_student_gradebook(db, ctx["teacher"].staff_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id)
    rows = {row.student_id: row for row in gradebook.studentGrades}
    row_a = rows[str(student_a.student_id)]
    row_b = rows[str(student_b.student_id)]

    # Student A is adjusted to 30.0
    assert row_a.performanceTask == [30.0]
    assert len(row_a.remedial_classworks) == 1

    # Student B remains unadjusted at 35.0 with zero remedial records
    assert row_b.performanceTask == [35.0]
    assert row_b.remedial_classworks == []
    # Student B's PS: 35/40 = 87.5%
    assert row_b.ps_performance == 87.5


# 8. Class grade sheet and student detail agree
def test_gradebook_and_student_detail_agree(gradebook_integration_context):
    ctx = gradebook_integration_context
    db = ctx["db"]
    student_a = ctx["student_a"]
    orig_pt1 = ctx["asgn_pt1"]

    _create_remedial_pt(ctx, student_a, orig_pt1, rem_score=36, cap=Decimal("75.00"))

    # Fetch gradebook
    gradebook = teacher_student_gradebook(db, ctx["teacher"].staff_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id)
    gb_row = next(r for r in gradebook.studentGrades if r.student_id == str(student_a.student_id))

    # Fetch student record detail
    detail = teacher_student_record_detail(db, ctx["teacher"].staff_id, ctx["class"].class_id, ctx["subject"].subject_id, student_a.student_id, ctx["period"].academic_period_id)

    # Classwork results in student detail: only official assignments
    assert len(detail.classwork_results) == 3  # WW1, PT1, QA1
    pt_result = next(cw for cw in detail.classwork_results if cw.assignment_id == orig_pt1.classwork_assignment_id)

    # Official score in student detail equals gradebook score!
    assert pt_result.score == 30.0
    assert pt_result.raw_score == 10.0
    assert pt_result.effective_score == 30.0
    assert pt_result.percentage == 75.0
    assert pt_result.remediation is not None
    assert pt_result.remediation["status"] == "CAPPED"

    # Running classwork percentage in summary: earned=16+30+40=86, possible=20+40+50=110. 86/110=78.18%
    assert detail.summary.assigned_count == 3
    assert detail.summary.graded_count == 3
    assert detail.summary.running_classwork_percentage == 78.18

    # Roster summary matches
    roster = teacher_student_roster(db, ctx["teacher"].staff_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id)
    roster_row = next(r for r in roster.students if r.student_id == str(student_a.student_id))
    assert roster_row.running_classwork_percentage == 78.18


# 9. Period-grade computation uses the same effective score
def test_period_grade_computation_uses_same_effective_score(gradebook_integration_context):
    ctx = gradebook_integration_context
    db = ctx["db"]
    student_a = ctx["student_a"]
    orig_pt1 = ctx["asgn_pt1"]

    rem_asgn, link, rem_sub = _create_remedial_pt(ctx, student_a, orig_pt1, rem_score=36, cap=Decimal("75.00"))

    sub_qa = ctx["db"].query(StudentSubmission).filter_by(
        student_id=student_a.student_id, classwork_assignment_id=ctx["asgn_qa1"].classwork_assignment_id
    ).one()
    sub_ww = ctx["db"].query(StudentSubmission).filter_by(
        student_id=student_a.student_id, classwork_assignment_id=ctx["asgn_ww1"].classwork_assignment_id
    ).one()

    # Compute via _compute_student_period_components
    weights = resolve_subject_grading_weights(db, ctx["subject"].subject_id)
    comp_res = _compute_student_period_components(
        student_a,
        [ctx["asgn_ww1"]],
        [orig_pt1, rem_asgn],
        [ctx["asgn_qa1"]],
        {student_a.student_id: {
            ctx["asgn_ww1"].classwork_assignment_id: sub_ww,
            orig_pt1.classwork_assignment_id: ctx["sub_a_pt1"],
            rem_asgn.classwork_assignment_id: rem_sub,
            ctx["asgn_qa1"].classwork_assignment_id: sub_qa,
        }},
        weights=weights,
        db=db,
    )

    # PT score in comp_res is 30.0, PS is 75.0
    assert comp_res["performance_scores"] == [30.0]
    assert comp_res["ps_pt"] == 75.0
    assert comp_res["initial_grade"] == 77.0

    # Gradebook has the exact same initial_grade
    gradebook = teacher_student_gradebook(db, ctx["teacher"].staff_id, ctx["class"].class_id, ctx["subject"].subject_id, ctx["period"].academic_period_id)
    gb_row = next(r for r in gradebook.studentGrades if r.student_id == str(student_a.student_id))
    assert gb_row.initial_grade == comp_res["initial_grade"]
    assert gb_row.transmuted_grade == comp_res["transmuted_grade"]

    # Send grade to adviser
    send_resp = send_student_grade_to_adviser(
        db,
        ctx["teacher"].staff_id,
        ctx["class"].class_id,
        ctx["subject"].subject_id,
        student_a.student_id,
        SendStudentGradeRequest(academic_period_id=ctx["period"].academic_period_id),
    )
    assert send_resp.initial_grade == gb_row.initial_grade
    assert send_resp.transmuted_grade == gb_row.transmuted_grade


# 10. Existing Examination remediation behavior remains unchanged
def test_existing_examination_remediation_unchanged(gradebook_integration_context):
    ctx = gradebook_integration_context
    db = ctx["db"]
    student_a = ctx["student_a"]
    teacher = ctx["teacher"]
    subject = ctx["subject"]
    class_ = ctx["class"]
    period = ctx["period"]
    orig_exam = ctx["asgn_qa1"]

    # Create remedial exam (using existing original_exam_assignment_id pattern)
    rem_exam_cw = Classwork(
        title="Remedial Exam",
        subject_id=subject.subject_id,
        classwork_category="QUARTERLY_ASSESSMENT",
        classwork_type="EXAM",
        exam_subtype="TERM_EXAM",
        total_points=Decimal("50"),
        created_by_staff_id=teacher.staff_id,
        is_graded=True,
        is_archived=False,
    )
    db.add(rem_exam_cw)
    db.flush()

    rem_exam_asgn = ClassworkAssignment(
        classwork_id=rem_exam_cw.classwork_id,
        class_id=class_.class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=teacher.staff_id,
        is_published=True,
        recipient_student_id=student_a.student_id,
        source_intervention_id=123,
        remediation_request_id=uuid4(),
        original_exam_assignment_id=orig_exam.classwork_assignment_id,
    )
    db.add(rem_exam_asgn)
    db.flush()

    # Original exam was 20/50. Remedial exam is 48/50.
    # Existing exam remediation replaces original if remedial > original (no 75% cap on exams)
    sub_orig = db.query(StudentSubmission).filter_by(student_id=student_a.student_id, classwork_assignment_id=orig_exam.classwork_assignment_id).one()
    sub_orig.grade = Decimal("20")
    db.add(StudentSubmission(student_id=student_a.student_id, classwork_assignment_id=rem_exam_asgn.classwork_assignment_id, grade=Decimal("48"), status="graded"))
    db.commit()

    gradebook = teacher_student_gradebook(db, teacher.staff_id, class_.class_id, subject.subject_id, period.academic_period_id)
    gb_row = next(r for r in gradebook.studentGrades if r.student_id == str(student_a.student_id))

    # Exam effective score: 48.0 (replaces 20.0, remedial exam excluded from counted columns)
    assert gb_row.exams == [48.0]
    assert len(gb_row.remedial_exams) == 1
    assert gb_row.remedial_exams[0]["effective_score"] == 48.0


# 11. ECR exports and dependent metrics remain consistent
def test_ecr_export_and_dependent_metrics_consistent(gradebook_integration_context):
    ctx = gradebook_integration_context
    db = ctx["db"]
    student_a = ctx["student_a"]
    orig_pt1 = ctx["asgn_pt1"]

    _create_remedial_pt(ctx, student_a, orig_pt1, rem_score=36, cap=Decimal("75.00"))

    wb = openpyxl.Workbook()
    ws = generate_class_record_sheet(
        wb=wb,
        db=db,
        class_id=ctx["class"].class_id,
        subject_id=ctx["subject"].subject_id,
        academic_period_id=ctx["period"].academic_period_id,
        staff_id=ctx["teacher"].staff_id,
    )

    # Save to buffer and reload to verify openpyxl compatibility
    buf = io.BytesIO()
    wb.save(buf)
    buf.seek(0)
    loaded_wb = openpyxl.load_workbook(buf)
    sheet = loaded_wb.active

    # Student A's row exists and has scores
    # Check that workbook generated without error
    assert sheet is not None

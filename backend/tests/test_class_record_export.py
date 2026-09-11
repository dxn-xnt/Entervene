import io
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

import openpyxl
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import CheckConstraint, create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.StudentRecords import router as student_records_router
from app.db.Base import Base
from app.db.Session import get_db
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
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.settings.Setting import Setting, SettingType
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.export.ClassRecordExportService import (
    export_class_record_single_term,
    generate_class_record_sheet,
)


@pytest.fixture
def export_context():
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

    # Settings
    db.add_all([
        Setting(key="app_name", value="ENTERVENE", type=SettingType.STRING, group="general", is_public=True),
        Setting(key="school_name", value="Medellin National Science and Technology School (MNSTS)", type=SettingType.STRING, group="school", is_public=True),
        Setting(key="school_id", value="303012", type=SettingType.STRING, group="school", is_public=True),
        Setting(key="school_region", value="IV", type=SettingType.STRING, group="school", is_public=True),
        Setting(key="school_division", value="Fourth District", type=SettingType.STRING, group="school", is_public=True),
        Setting(key="current_school_year", value="AY2025-2026", type=SettingType.STRING, group="calendar", is_public=True),
    ])

    # Academic Structure
    year = AcademicYear(
        year_label="AY2025-2026",
        start_date=date(2025, 6, 1),
        end_date=date(2026, 3, 31),
        is_active=True,
    )
    level = AcademicLevel(level_name="Grade 8", grade_level=8)
    db.add_all([year, level])
    db.flush()

    period = AcademicPeriod(
        period_name="First Quarter",
        period_type="QUARTER",
        period_sequence=1,
        academic_year_id=year.academic_year_id,
        is_active=True,
        start_date=date(2025, 6, 1),
        end_date=date(2025, 8, 31),
    )
    db.add(period)
    db.flush()

    # Teacher
    user_teacher = UserAccount(user_id=uuid.uuid4(), email="teacher@entervene.edu", password_hash="hash")
    db.add(user_teacher)
    db.flush()

    teacher = AcademicStaff(
        staff_id="STF-001",
        first_name="Maria",
        last_name="Santos",
        email=user_teacher.email,
        user_id=user_teacher.user_id,
    )
    db.add(teacher)
    db.flush()

    # Class & Subject
    cls = Class(
        section_name="Grade 8 – Rizal",
        academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id,
        academic_period_id=period.academic_period_id,
        class_status="active",
    )
    subj = Subject(
        subject_name="Mathematics",
        subject_codename="MATH8",
        status="active",
        academic_level_id=level.academic_level_id,
    )
    db.add_all([cls, subj])
    db.flush()

    # Grading Template: 40% Written Works, 40% Performance Tasks, 20% Quarterly Assessment
    tpl = GradingTemplate(
        template_name="Junior High Math",
        subject_id=subj.subject_id,
        status="active",
    )
    db.add(tpl)
    db.flush()

    c1 = GradingTemplateComponent(grading_template_id=tpl.grading_template_id, component_name="Written Works", weight=Decimal("40.00"), display_order=1)
    c2 = GradingTemplateComponent(grading_template_id=tpl.grading_template_id, component_name="Performance Tasks", weight=Decimal("40.00"), display_order=2)
    c3 = GradingTemplateComponent(grading_template_id=tpl.grading_template_id, component_name="Quarterly Assessment", weight=Decimal("20.00"), display_order=3)
    db.add_all([c1, c2, c3])
    db.flush()

    subj.default_grading_template = str(tpl.grading_template_id)
    db.flush()

    # Subject Load
    load = SubjectLoad(
        class_id=cls.class_id,
        subject_id=subj.subject_id,
        staff_id=teacher.staff_id,
        academic_period_id=period.academic_period_id,
        status="active",
    )
    db.add(load)
    db.flush()

    # Students: 1 Male, 1 Female
    u_stu1 = UserAccount(user_id=uuid.uuid4(), email="juan@student.edu", password_hash="hash")
    u_stu2 = UserAccount(user_id=uuid.uuid4(), email="maria@student.edu", password_hash="hash")
    db.add_all([u_stu1, u_stu2])
    db.flush()

    stu1 = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789012",
        first_name="Juan",
        last_name="Dela Cruz",
        gender="Male",
        email=u_stu1.email,
        user_id=u_stu1.user_id,
        academic_level_id=level.academic_level_id,
    )
    stu2 = Student(
        student_id=uuid.uuid4(),
        student_lrn="123456789013",
        first_name="Ana",
        last_name="Alvarez",
        gender="Female",
        email=u_stu2.email,
        user_id=u_stu2.user_id,
        academic_level_id=level.academic_level_id,
    )
    db.add_all([stu1, stu2])
    db.flush()

    db.add_all([
        StudentClass(student_id=stu1.student_id, class_id=cls.class_id, academic_year_id=year.academic_year_id, enrollment_status="enrolled"),
        StudentClass(student_id=stu2.student_id, class_id=cls.class_id, academic_year_id=year.academic_year_id, enrollment_status="enrolled"),
    ])
    db.flush()

    # Classwork: 2 Written Works, 1 Performance Task, 1 Quarterly Assessment
    cw_ww1 = Classwork(title="WW1: Algebra Quiz", classwork_type="QUIZ", classwork_category="WRITTEN_WORK", is_graded=True, total_points=Decimal("20.00"), subject_id=subj.subject_id, created_by_staff_id=teacher.staff_id)
    cw_ww2 = Classwork(title="WW2: Problem Set", classwork_type="ASSIGNMENT", classwork_category="WRITTEN_WORK", is_graded=True, total_points=Decimal("30.00"), subject_id=subj.subject_id, created_by_staff_id=teacher.staff_id)
    cw_pt1 = Classwork(title="PT1: Geometric Model", classwork_type="ACTIVITY", classwork_category="PERFORMANCE_TASK", is_graded=True, total_points=Decimal("50.00"), subject_id=subj.subject_id, created_by_staff_id=teacher.staff_id)
    cw_qa1 = Classwork(title="QA1: First Periodical Exam", classwork_type="EXAM", classwork_category="QUARTERLY_ASSESSMENT", is_graded=True, total_points=Decimal("50.00"), subject_id=subj.subject_id, created_by_staff_id=teacher.staff_id)
    db.add_all([cw_ww1, cw_ww2, cw_pt1, cw_qa1])
    db.flush()

    asgn_ww1 = ClassworkAssignment(classwork_id=cw_ww1.classwork_id, class_id=cls.class_id, assigned_by_staff_id=teacher.staff_id, is_published=True)
    asgn_ww2 = ClassworkAssignment(classwork_id=cw_ww2.classwork_id, class_id=cls.class_id, assigned_by_staff_id=teacher.staff_id, is_published=True)
    asgn_pt1 = ClassworkAssignment(classwork_id=cw_pt1.classwork_id, class_id=cls.class_id, assigned_by_staff_id=teacher.staff_id, is_published=True)
    asgn_qa1 = ClassworkAssignment(classwork_id=cw_qa1.classwork_id, class_id=cls.class_id, assigned_by_staff_id=teacher.staff_id, is_published=True)
    db.add_all([asgn_ww1, asgn_ww2, asgn_pt1, asgn_qa1])
    db.flush()

    # Submissions:
    # Stu1: 18/20, 27/30 (WW total: 45/50 = 90% PS, 36.0 WS)
    #       45/50 (PT total: 45/50 = 90% PS, 36.0 WS)
    #       40/50 (QA total: 40/50 = 80% PS, 16.0 WS)
    # Initial Grade: 36 + 36 + 16 = 88.0 -> Transmuted: 92 (Advancing)
    sub1 = StudentSubmission(classwork_assignment_id=asgn_ww1.classwork_assignment_id, student_id=stu1.student_id, grade=Decimal("18.00"), status="GRADED")
    sub2 = StudentSubmission(classwork_assignment_id=asgn_ww2.classwork_assignment_id, student_id=stu1.student_id, grade=Decimal("27.00"), status="GRADED")
    sub3 = StudentSubmission(classwork_assignment_id=asgn_pt1.classwork_assignment_id, student_id=stu1.student_id, grade=Decimal("45.00"), status="GRADED")
    sub4 = StudentSubmission(classwork_assignment_id=asgn_qa1.classwork_assignment_id, student_id=stu1.student_id, grade=Decimal("40.00"), status="GRADED")

    # Stu2: 20/20, 30/30 (WW total: 50/50 = 100% PS, 40.0 WS)
    #       50/50 (PT total: 50/50 = 100% PS, 40.0 WS)
    #       48/50 (QA total: 48/50 = 96% PS, 19.2 WS)
    # Initial Grade: 40 + 40 + 19.2 = 99.2 -> Transmuted: 100 (Advancing)
    sub5 = StudentSubmission(classwork_assignment_id=asgn_ww1.classwork_assignment_id, student_id=stu2.student_id, grade=Decimal("20.00"), status="GRADED")
    sub6 = StudentSubmission(classwork_assignment_id=asgn_ww2.classwork_assignment_id, student_id=stu2.student_id, grade=Decimal("30.00"), status="GRADED")
    sub7 = StudentSubmission(classwork_assignment_id=asgn_pt1.classwork_assignment_id, student_id=stu2.student_id, grade=Decimal("50.00"), status="GRADED")
    sub8 = StudentSubmission(classwork_assignment_id=asgn_qa1.classwork_assignment_id, student_id=stu2.student_id, grade=Decimal("48.00"), status="GRADED")
    db.add_all([sub1, sub2, sub3, sub4, sub5, sub6, sub7, sub8])
    db.commit()

    return {
        "db": db,
        "class_id": cls.class_id,
        "subject_id": subj.subject_id,
        "academic_period_id": period.academic_period_id,
        "teacher_staff_id": teacher.staff_id,
        "teacher_user": user_teacher,
    }


def test_generate_class_record_sheet(export_context):
    db = export_context["db"]
    class_id = export_context["class_id"]
    subject_id = export_context["subject_id"]
    period_id = export_context["academic_period_id"]
    staff_id = export_context["teacher_staff_id"]

    wb = openpyxl.Workbook()
    ws = generate_class_record_sheet(
        wb=wb,
        db=db,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=period_id,
        staff_id=staff_id,
    )

    # 1. Verify Sheet Title
    assert ws.title == "First Quarter"

    # 2. Verify Header Block
    assert ws["A1"].value == "Republic of the Philippines"
    assert ws["A2"].value == "Department of Education"
    assert ws["A3"].value == "ELECTRONIC CLASS RECORD"
    assert ws["B5"].value == "IV"  # Region from Setting
    assert ws["B6"].value == "Fourth District"  # Division from Setting
    assert ws["B7"].value == "Medellin National Science and Technology School (MNSTS)"  # School Name from Setting
    assert ws["B8"].value == "303012"  # School ID from Setting

    # Right column metadata (col 9)
    assert ws.cell(5, 9).value == "AY2025-2026"
    assert ws.cell(6, 9).value == "Grade 8 – Rizal"
    assert ws.cell(7, 9).value == "Maria Santos"
    assert ws.cell(8, 9).value == "Mathematics - First Quarter"

    # 3. Verify Dynamic Component Headers in Row 10
    # WW has 2 items -> start_col=3, total_col=5, ps_col=6, ws_col=7, end_col=7
    # PT has 1 item -> start_col=8, total_col=9, ps_col=10, ws_col=11, end_col=11
    # QA has 1 item -> start_col=12, total_col=13, ps_col=14, ws_col=15, end_col=15
    # Initial Grade = col 16, Quarterly Grade = col 17, Descriptor = col 18
    assert "WRITTEN WORKS (40%)" in str(ws.cell(10, 3).value)
    assert "PERFORMANCE TASKS (40%)" in str(ws.cell(10, 8).value)
    assert "QUARTERLY ASSESSMENT (20%)" in str(ws.cell(10, 12).value)
    assert "INITIAL" in str(ws.cell(10, 16).value)
    assert "QUARTERLY" in str(ws.cell(10, 17).value)
    assert "DESCRIPTOR" in str(ws.cell(10, 18).value)

    # 4. Verify Highest Possible Score (Row 12)
    assert ws.cell(12, 2).value == "HIGHEST POSSIBLE SCORE"
    # WW item 1 max=20, item 2 max=30, total=50, PS=100, WS=40
    assert ws.cell(12, 3).value == 20.0
    assert ws.cell(12, 4).value == 30.0
    assert ws.cell(12, 5).value == 50.0
    assert ws.cell(12, 6).value == 100.0
    assert ws.cell(12, 7).value == 40.0

    # 5. Verify Gender Sections & Students
    # Row 13 is MALE header
    assert ws.cell(13, 2).value == "MALE"
    # Row 14 is Male Student: Dela Cruz, Juan
    assert "Dela Cruz, Juan" in str(ws.cell(14, 2).value)
    assert ws.cell(14, 3).value == 18.0
    assert ws.cell(14, 4).value == 27.0
    assert ws.cell(14, 5).value == 45.0
    assert ws.cell(14, 6).value == 90.0
    assert ws.cell(14, 7).value == 36.0
    # Initial Grade: 88.0, Term Grade: 93.4, Descriptor: Advancing
    assert ws.cell(14, 16).value == 88.0
    assert ws.cell(14, 17).value == 93.4
    assert ws.cell(14, 18).value == "Advancing"

    # Row 15 is FEMALE header
    assert ws.cell(15, 2).value == "FEMALE"
    # Row 16 is Female Student: Alvarez, Ana
    assert "Alvarez, Ana" in str(ws.cell(16, 2).value)
    assert ws.cell(16, 3).value == 20.0
    assert ws.cell(16, 4).value == 30.0
    assert ws.cell(16, 5).value == 50.0
    assert ws.cell(16, 6).value == 100.0
    assert ws.cell(16, 7).value == 40.0
    assert ws.cell(16, 16).value == 99.2
    assert ws.cell(16, 17).value == 99.68
    assert ws.cell(16, 18).value == "Advancing"


def test_export_class_record_single_term_stream(export_context):
    db = export_context["db"]
    class_id = export_context["class_id"]
    subject_id = export_context["subject_id"]
    period_id = export_context["academic_period_id"]
    staff_id = export_context["teacher_staff_id"]

    stream, filename = export_class_record_single_term(
        db=db,
        class_id=class_id,
        subject_id=subject_id,
        academic_period_id=period_id,
        staff_id=staff_id,
    )

    assert filename.startswith("Class_Record_")
    assert filename.endswith(".xlsx")
    assert isinstance(stream, io.BytesIO)

    # Verify stream can be parsed as a valid openpyxl workbook
    wb = openpyxl.load_workbook(stream)
    assert "First Quarter" in wb.sheetnames
    ws = wb["First Quarter"]
    assert ws["A3"].value == "ELECTRONIC CLASS RECORD"


def test_export_class_record_api_endpoint(export_context):
    db = export_context["db"]
    class_id = export_context["class_id"]
    subject_id = export_context["subject_id"]
    period_id = export_context["academic_period_id"]
    staff_id = export_context["teacher_staff_id"]
    teacher_user = export_context["teacher_user"]

    app = FastAPI()
    app.include_router(student_records_router, prefix="/api/v1/student-records")

    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: {"sub": str(teacher_user.user_id), "role": "teacher"}
    from app.core.Dependencies import get_staff_id
    app.dependency_overrides[get_staff_id] = lambda: staff_id

    client = TestClient(app)
    response = client.get(
        f"/api/v1/student-records/teacher/classes/{class_id}/subjects/{subject_id}/export-class-record?academic_period_id={period_id}"
    )

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert "attachment; filename=" in response.headers["content-disposition"]
    assert ".xlsx" in response.headers["content-disposition"]

    # Verify response content is a valid xlsx
    content_stream = io.BytesIO(response.content)
    wb = openpyxl.load_workbook(content_stream)
    assert "First Quarter" in wb.sheetnames


def test_dynamic_grading_template_with_zero_assignment_component(export_context):
    db = export_context["db"]
    class_id = export_context["class_id"]
    period_id = export_context["academic_period_id"]
    staff_id = export_context["teacher_staff_id"]

    # Create a new subject with 4 components, one of which has NO assignments
    new_subj = Subject(
        subject_name="Science",
        subject_codename="SCI8",
        status="active",
    )
    db.add(new_subj)
    db.flush()

    new_tpl = GradingTemplate(template_name="Science Template", subject_id=new_subj.subject_id, status="active")
    db.add(new_tpl)
    db.flush()

    db.add_all([
        GradingTemplateComponent(grading_template_id=new_tpl.grading_template_id, component_name="Written Works", weight=Decimal("30.00"), display_order=1),
        GradingTemplateComponent(grading_template_id=new_tpl.grading_template_id, component_name="Performance Tasks", weight=Decimal("50.00"), display_order=2),
        GradingTemplateComponent(grading_template_id=new_tpl.grading_template_id, component_name="Summative Assessment", weight=Decimal("20.00"), display_order=3),
    ])
    new_subj.default_grading_template = str(new_tpl.grading_template_id)
    db.flush()

    # SubjectLoad with NO assignments
    load = SubjectLoad(class_id=class_id, subject_id=new_subj.subject_id, staff_id=staff_id, academic_period_id=period_id, status="active")
    db.add(load)
    db.commit()

    wb = openpyxl.Workbook()
    ws = generate_class_record_sheet(
        wb=wb,
        db=db,
        class_id=class_id,
        subject_id=new_subj.subject_id,
        academic_period_id=period_id,
        staff_id=staff_id,
    )

    # All 3 components rendered with 1 placeholder column each (Option A minimum 1)
    # Col 3: WW (sub_col=1, total=4, ps=5, ws=6)
    # Col 7: PT (sub_col=1, total=8, ps=9, ws=10)
    # Col 11: QA (sub_col=1, total=12, ps=13, ws=14)
    # Col 15: Initial Grade, Col 16: Quarterly Grade, Col 17: Descriptor
    assert "WRITTEN WORKS (30%)" in str(ws.cell(10, 3).value)
    assert "PERFORMANCE TASKS (50%)" in str(ws.cell(10, 7).value)
    assert "SUMMATIVE ASSESSMENT (20%)" in str(ws.cell(10, 11).value)
    assert ws.cell(11, 3).value == 1
    assert ws.cell(11, 7).value == 1
    assert ws.cell(11, 11).value == 1


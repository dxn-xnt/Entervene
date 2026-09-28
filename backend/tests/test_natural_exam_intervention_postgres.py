"""Natural corrected prediction and Intervention creation from scored Examination work.

Run with RUN_POSTGRES_NATURAL_INTERVENTION_TEST=1 and a local PostgreSQL URL.
The test creates and drops its own database; it never writes to the configured DB.
"""

from datetime import date, datetime, timezone
from decimal import Decimal
import asyncio
import json
import os
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

import app.models  # noqa: F401 - register every table with Base.metadata
from app.db.Base import Base
from app.db.Session import engine as configured_engine
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.academic.AcademicPeriod import AcademicPeriod
from app.models.academic.AcademicYear import AcademicYear
from app.models.academic.Class_ import Class
from app.models.academic.Competency import Competency
from app.models.academic.GradingTemplate import GradingTemplate
from app.models.academic.GradingTemplateComponent import GradingTemplateComponent
from app.models.academic.Lesson import Lesson
from app.models.academic.StudentCLass import StudentClass
from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.academic.Subject import Subject
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import ModelPurpose
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.intervention.Intervention import Intervention
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.models.quiz.Question import Question
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Quiz import QuizBuilderUpsert, QuizSubmitRequest
from app.schemas.Submission import GradeRequest
from app.schemas.Classwork import ClassworkUpdate
from app.services.prediction.CurrentPeriodFeatureBuilderService import build_current_period_features_from_records
from app.services.prediction.DevelopmentCurrentTermModelSelection import CORRECTED_MODEL_NAME
from app.services.prediction.DevelopmentGradeRefreshService import settings
from app.services.quiz import QuizAttemptService as attempts
from app.services.quiz.QuizBuilderService import upsert_quiz_builder
from app.services.submission.SubmissionService import grade_student_submission
from app.services.classwork.ClassworkService import create_classwork_wizard_record, update_classwork_record
from app.services.intervention.InterventionRemediationService import PlanUpdate, save_plan, get_workspace
from app.services.student_record.StudentRecordService import teacher_student_gradebook
from fastapi import HTTPException
from tests.test_development_current_term_model_4l import _register_corrected


@pytest.fixture
def isolated_postgres(monkeypatch):
    if os.getenv("RUN_POSTGRES_NATURAL_INTERVENTION_TEST") != "1":
        pytest.skip("Set RUN_POSTGRES_NATURAL_INTERVENTION_TEST=1 for the disposable PostgreSQL test.")
    source = configured_engine.url
    if source.get_backend_name() != "postgresql" or source.host not in {"localhost", "127.0.0.1"}:
        pytest.skip("A local PostgreSQL connection is required.")

    name = "entervene_test_natural_" + uuid4().hex
    assert name.startswith("entervene_test_natural_")
    assert name.casefold() not in {"entervene_demo", "main", "entervene"}
    admin = create_engine(source.set(database="postgres"), isolation_level="AUTOCOMMIT")
    engine = None
    created = False
    try:
        with admin.connect() as conn:
            conn.execute(text(f'CREATE DATABASE "{name}"'))
            created = True
        engine = create_engine(source.set(database=name))
        Base.metadata.create_all(engine)
        monkeypatch.setattr(settings, "app_environment", "test")
        monkeypatch.setattr(settings, "development_prediction_api_enabled", True)
        monkeypatch.setattr(settings, "development_current_term_model_name", CORRECTED_MODEL_NAME)
        yield engine
    finally:
        if engine is not None:
            engine.dispose()
        if created:
            with admin.connect() as conn:
                conn.execute(text(f'DROP DATABASE IF EXISTS "{name}" WITH (FORCE)'))
        admin.dispose()


def _academic_scope(db: Session):
    year = AcademicYear(year_label="2026-2027", start_date=date(2026, 6, 1), end_date=date(2027, 3, 31), is_active=True)
    level = AcademicLevel(level_name="Grade 10", grade_level=10)
    db.add_all([year, level])
    db.flush()
    period = AcademicPeriod(period_name="Term 2", period_type="TERM", period_sequence=2, total_periods_in_year=3,
        period_progress_ratio=Decimal("0.6667"), start_date=date(2026, 9, 1), end_date=date(2026, 11, 30),
        academic_year_id=year.academic_year_id, is_active=True)
    teacher = AcademicStaff(staff_id="T-NATURAL", first_name="Natural", last_name="Teacher")
    student = Student(student_id=uuid4(), student_lrn="300000000202", first_name="Natural", last_name="Student",
        academic_level_id=level.academic_level_id)
    subject = Subject(subject_name="Mathematics 10", subject_codename="MATH10", academic_level_id=level.academic_level_id,
        is_core=True, status="active")
    class_ = Class(section_name="Natural Trace", academic_year_id=year.academic_year_id,
        academic_level_id=level.academic_level_id, academic_period=period, adviser=teacher)
    class_.period_template_group = "JHS_45MIN"
    db.add_all([period, teacher, student, subject, class_])
    db.flush()
    db.add(StudentClass(student_id=student.student_id, class_id=class_.class_id,
        academic_year_id=year.academic_year_id, enrollment_status="enrolled"))
    db.add(SubjectLoad(staff_id=teacher.staff_id, subject_id=subject.subject_id, class_id=class_.class_id,
        academic_period_id=period.academic_period_id, status="published", is_active_version=True))
    template = GradingTemplate(template_name="Natural 20-50-30", academic_level_id=level.academic_level_id,
        subject_id=subject.subject_id, status="active")
    db.add(template)
    db.flush()
    db.add_all([
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Written Works", weight=Decimal("20"), display_order=1),
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Performance Tasks", weight=Decimal("50"), display_order=2),
        GradingTemplateComponent(grading_template_id=template.grading_template_id, component_name="Quarterly Assessment", weight=Decimal("30"), display_order=3),
    ])
    subject.default_grading_template = str(template.grading_template_id)
    competency = Competency(competency_code="NAT-RATIO", statement="Solve ratios", subject_id=subject.subject_id,
        academic_period_id=period.academic_period_id, created_by_staff_id=teacher.staff_id)
    db.add(competency)
    db.flush()
    lesson = Lesson(title="Ratios", subject_id=subject.subject_id, competency_id=competency.competency_id,
        is_published=True, is_draft=False, created_by_staff_id=teacher.staff_id)
    db.add(lesson)
    db.commit()
    return teacher, student, class_, subject, period, competency, lesson


def _assignment(db: Session, *, title: str, category: str, subtype: str | None,
                teacher: AcademicStaff, class_: Class, subject: Subject, period: AcademicPeriod,
                activity_mode: str) -> ClassworkAssignment:
    classwork = Classwork(title=title, classwork_type="QUIZ" if activity_mode == "ONLINE" else "ACTIVITY",
        classwork_category=category, exam_subtype=subtype, activity_mode=activity_mode,
        total_points=Decimal("10"), is_graded=True, is_published=True,
        subject_id=subject.subject_id, created_by_staff_id=teacher.staff_id)
    db.add(classwork)
    db.flush()
    assignment = ClassworkAssignment(classwork_id=classwork.classwork_id, class_id=class_.class_id,
        academic_period_id=period.academic_period_id, assigned_by_staff_id=teacher.staff_id, is_published=True)
    db.add(assignment)
    db.flush()
    return assignment


def test_grade_commit_naturally_creates_candidate_with_scored_exam_competency(isolated_postgres, monkeypatch):
    with Session(isolated_postgres) as db:
        teacher, student, class_, subject, period, competency, lesson = _academic_scope(db)
        for title, category, subtype, score in (
            ("Written Work 1", "WRITTEN_WORK", None, 3),
            ("Written Work 2", "WRITTEN_WORK", None, 4),
            ("Performance Task 1", "PERFORMANCE_TASK", None, 3),
            ("Performance Task 2", "PERFORMANCE_TASK", None, 4),
            ("Summative 2", "QUARTERLY_ASSESSMENT", "SUMMATIVE_2", 4),
            ("Term Exam", "QUARTERLY_ASSESSMENT", "TERM_EXAM", 3),
        ):
            assignment = _assignment(db, title=title, category=category, subtype=subtype,
                teacher=teacher, class_=class_, subject=subject, period=period, activity_mode="MANUAL")
            if subtype == "SUMMATIVE_2":
                summative_2 = assignment
            submission = StudentSubmission(student_id=student.student_id,
                classwork_assignment_id=assignment.classwork_assignment_id,
                status="submitted", submitted_at=datetime.now(timezone.utc))
            db.add(submission)
            db.commit()
            grade_student_submission(submission.submission_id, GradeRequest(grade=score), teacher.staff_id, db)

        exam = _assignment(db, title="Natural Summative 1", category="QUARTERLY_ASSESSMENT",
            subtype="SUMMATIVE_1", teacher=teacher, class_=class_, subject=subject, period=period,
            activity_mode="ONLINE")
        db.add(ClassworkLesson(classwork_id=exam.classwork_id, lesson_id=lesson.lesson_id))
        built = upsert_quiz_builder(db, exam.classwork, QuizBuilderUpsert.model_validate({
            "status": "READY", "settings": {"max_attempts": 1},
            "questions": [
                {"question_text": "Which ratio is 2 to 1?", "question_type": "MULTIPLE_CHOICE", "points": 9,
                 "display_order": 1, "lesson_id": lesson.lesson_id,
                 "options": [{"option_text": "2:1", "is_correct": True, "option_order": 1},
                             {"option_text": "1:2", "is_correct": False, "option_order": 2}]},
                {"question_text": "Unmapped control question", "question_type": "MULTIPLE_CHOICE", "points": 1,
                 "display_order": 2, "lesson_id": None,
                 "options": [{"option_text": "Yes", "is_correct": True, "option_order": 1},
                             {"option_text": "No", "is_correct": False, "option_order": 2}]},
            ],
        }))
        db.commit()
        pre = build_current_period_features_from_records(db, student.student_id, class_.class_id,
            subject.subject_id, period.academic_period_id)
        assert pre["ready"] is True and pre["readiness_level"] == "STANDARD_READY"
        assert pre["features"]["overall_available_activity_count"] == 4
        assert pre["features"]["qa_has_evidence"] == 0
        assert db.query(DevelopmentCurrentTermPrediction).count() == 0
        assert db.query(Intervention).count() == 0

        model = _register_corrected({"db": db})
        assert model.model_name == CORRECTED_MODEL_NAME
        by_order = sorted(built.questions, key=lambda item: item.display_order)
        wrong_options = [next(option.option_id for option in item.options if not option.is_correct) for item in by_order]
        attempts.start_student_quiz_attempt(db, student, exam.classwork_assignment_id)

        calls = []
        real_refresh = attempts.refresh_after_committed_grade_change
        def observe_committed_refresh(bind, **scope):
            with Session(bind) as check:
                committed = check.query(StudentSubmission).filter_by(
                    student_id=student.student_id, classwork_assignment_id=exam.classwork_assignment_id,
                ).one()
                assert committed.status == "graded" and committed.grade == 0
            calls.append(scope)
            return real_refresh(bind, **scope)
        monkeypatch.setattr(attempts, "refresh_after_committed_grade_change", observe_committed_refresh)

        attempts.submit_student_quiz_attempt(db, student, exam.classwork_assignment_id,
            QuizSubmitRequest(answers=[
                {"quiz_question_id": item.quiz_question_id, "selected_option_id": wrong_id}
                for item, wrong_id in zip(by_order, wrong_options)
            ]))
        assert len(calls) == 1
        assert calls[0] == {"student_ids": [student.student_id], "class_id": class_.class_id,
            "subject_id": subject.subject_id, "period_id": period.academic_period_id}

        db.expire_all()
        source = db.query(DevelopmentCurrentTermPrediction).one()
        version = db.get(type(model), source.model_version_id)
        assert version.model_name == CORRECTED_MODEL_NAME
        assert version.model_purpose == ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value
        assert source.evidence_snapshot["readiness"] == {
            "status": "READY", "level": "STANDARD_READY", "reason_codes": [],
        }
        assert source.evidence_snapshot["projected_final_term_grade_raw"] < 85
        assert source.evidence_snapshot["examination_presentation"]["components"] == {
            "SUMMATIVE_1": 0.0, "SUMMATIVE_2": 40.0, "TERM_EXAM": 30.0,
        }
        features = {item["name"]: item["value"] for item in source.evidence_snapshot["model_features"]}
        assert features["qa_percent_so_far"] == 24
        assert features["overall_available_activity_count"] == 5

        candidate = db.query(Intervention).one()
        assert candidate.status == "CANDIDATE"
        assert candidate.source_prediction_id == source.prediction_id
        diagnosis = candidate.diagnosis_snapshot
        assert diagnosis["weakest_supported_components"] == ["EXAMINATION"]
        assert diagnosis["competency_detail_status"] == "AVAILABLE"
        scored = diagnosis["lowest_supported_competencies"]
        assert len(scored) == 1 and scored[0]["competency_id"] == competency.competency_id
        assert (scored[0]["score"], scored[0]["possible_score"]) == (0, 9)
        assert len(scored[0]["supporting_scores"]) == 1
        assert scored[0]["supporting_scores"][0]["source_type"] == "QUIZ_QUESTION"
        assert scored[0]["supporting_scores"][0]["quiz_question_id"] == by_order[0].quiz_question_id

        answers = db.query(QuizAnswer).order_by(QuizAnswer.quiz_question_id).all()
        assert len(answers) == 2 and all(answer.points_awarded == 0 for answer in answers)
        assert db.get(Question, by_order[0].question_id).lesson_id == lesson.lesson_id
        assert db.get(Question, by_order[1].question_id).lesson_id is None
        assert by_order[1].quiz_question_id not in {
            item["quiz_question_id"] for row in scored for item in row["supporting_scores"]
        }

        # The teacher links one targeted remedial activity to that scored original.
        teacher_id = teacher.staff_id
        candidate.status = "ACTIVE"
        candidate.activated_at = datetime.now(timezone.utc)
        candidate.activated_by_staff_id = teacher_id
        db.commit()
        save_plan(db, teacher.staff_id, candidate.intervention_id,
            PlanUpdate(teacher_choice="CLASSWORK", grade_treatment="EXAMINATION",
                       original_exam_assignment_id=exam.classwork_assignment_id))
        workspace = get_workspace(db, teacher.staff_id, candidate.intervention_id)
        assert any(item["assignment_id"] == exam.classwork_assignment_id and item["subtype"] == "SUMMATIVE_1"
                   for item in workspace["original_exams"])
        create_args = dict(title="Summative 1 remedial", classwork_type="ASSIGNMENT",
            subject_id=subject.subject_id, description=None, instructions="Complete the remedial assessment",
            classwork_category="QUARTERLY_ASSESSMENT", exam_subtype="SUMMATIVE_1", total_points=10,
            is_published=True, class_ids=json.dumps([class_.class_id]),
            academic_period_id=period.academic_period_id, lesson_ids=json.dumps([lesson.lesson_id]),
            due_date=None, lock_date=None, allow_late_submissions=False, max_attempts=None,
            quiz_payload=None, rubric_payload=None, files=None, intervention_id=candidate.intervention_id,
            remediation_request_id=uuid4(), original_exam_assignment_id=exam.classwork_assignment_id,
            current_user={"sub": str(uuid4()), "role": "teacher"}, staff_id=teacher.staff_id, db=db)
        with pytest.raises(HTTPException) as subtype_error:
            asyncio.run(create_classwork_wizard_record(**{**create_args, "exam_subtype": "TERM_EXAM"}))
        assert subtype_error.value.status_code == 400
        with pytest.raises(HTTPException) as points_error:
            asyncio.run(create_classwork_wizard_record(**{**create_args, "total_points": 20}))
        assert points_error.value.status_code == 400
        created = asyncio.run(create_classwork_wizard_record(**create_args))
        remedial = db.query(ClassworkAssignment).filter_by(classwork_id=created.classwork_id).one()
        assert remedial.original_exam_assignment_id == exam.classwork_assignment_id
        assert remedial.recipient_student_id == student.student_id
        assert remedial.classwork.exam_subtype == "SUMMATIVE_1"
        with pytest.raises(HTTPException) as edited_subtype:
            update_classwork_record(remedial.classwork_id, ClassworkUpdate(exam_subtype="TERM_EXAM"), teacher_id, db)
        assert edited_subtype.value.status_code == 400
        repeated = asyncio.run(create_classwork_wizard_record(**{
            **create_args, "title": "Summative 1 second remedial", "remediation_request_id": uuid4(),
        }))
        repeated_assignment = db.query(ClassworkAssignment).filter_by(classwork_id=repeated.classwork_id).one()
        assert repeated_assignment.original_exam_assignment_id == exam.classwork_assignment_id
        save_plan(db, teacher_id, candidate.intervention_id,
            PlanUpdate(teacher_choice="CLASSWORK", grade_treatment="EXAMINATION",
                       original_exam_assignment_id=summative_2.classwork_assignment_id))
        with pytest.raises(HTTPException) as stale_selection:
            asyncio.run(create_classwork_wizard_record(**{**create_args, "remediation_request_id": uuid4()}))
        assert stale_selection.value.status_code == 400
        lower_created = asyncio.run(create_classwork_wizard_record(**{
            **create_args, "title": "Summative 2 remedial", "exam_subtype": "SUMMATIVE_2",
            "original_exam_assignment_id": summative_2.classwork_assignment_id,
            "remediation_request_id": uuid4(),
        }))
        lower_remedial = db.query(ClassworkAssignment).filter_by(classwork_id=lower_created.classwork_id).one()
        lower_attempt = StudentSubmission(student_id=student.student_id,
            classwork_assignment_id=lower_remedial.classwork_assignment_id, status="submitted")
        db.add(lower_attempt)
        db.commit()
        revisions_before = db.query(DevelopmentCurrentTermPrediction).count()
        grade_student_submission(lower_attempt.submission_id, GradeRequest(grade=2), teacher_id, db)
        assert db.query(DevelopmentCurrentTermPrediction).count() == revisions_before
        attempt = StudentSubmission(student_id=student.student_id,
            classwork_assignment_id=remedial.classwork_assignment_id, status="submitted")
        db.add(attempt)
        db.commit()
        revisions_before = db.query(DevelopmentCurrentTermPrediction).count()
        grade_student_submission(attempt.submission_id, GradeRequest(grade=0), teacher.staff_id, db)
        assert db.query(DevelopmentCurrentTermPrediction).count() == revisions_before
        grade_student_submission(attempt.submission_id, GradeRequest(grade=8), teacher.staff_id, db)
        assert db.query(DevelopmentCurrentTermPrediction).count() > revisions_before
        repeated_attempt = StudentSubmission(student_id=student.student_id,
            classwork_assignment_id=repeated_assignment.classwork_assignment_id, status="submitted")
        db.add(repeated_attempt)
        db.commit()
        revisions_after_first = db.query(DevelopmentCurrentTermPrediction).count()
        grade_student_submission(repeated_attempt.submission_id, GradeRequest(grade=9), teacher_id, db)
        assert db.query(DevelopmentCurrentTermPrediction).count() > revisions_after_first
        assert db.get(StudentSubmission, attempt.submission_id).grade == 8
        assert db.query(StudentSubmission).filter_by(classwork_assignment_id=exam.classwork_assignment_id).one().grade == 0
        gradebook = teacher_student_gradebook(db, teacher.staff_id, class_.class_id,
            subject.subject_id, period.academic_period_id)
        student_row = next(item for item in gradebook.studentGrades if item.student_id == str(student.student_id))
        assert student_row.ps_summative_1 == 90
        assert student_row.ps_summative_2 == 40
        assert len(gradebook.classwork[0].exams) == 3  # one column per original Examination
        assert student_row.remedial_exams[0]["original_score"] == 0
        assert student_row.remedial_exams[0]["remedial_score"] == 8
        assert student_row.remedial_exams[0]["effective_score"] == 9
        assert student_row.remedial_exams[1]["remedial_score"] == 9
        assert student_row.remedial_exams[1]["effective_score"] == 9
        assert student_row.remedial_exams[2]["remedial_score"] == 2
        assert student_row.remedial_exams[2]["effective_score"] == 4
        latest = db.query(DevelopmentCurrentTermPrediction).order_by(
            DevelopmentCurrentTermPrediction.revision.desc()).first()
        projected = latest.evidence_snapshot["projected_final_term_grade_raw"]
        db.refresh(candidate)
        assert candidate.status == ("RESOLVED" if projected >= 85 else "ACTIVE")

        period_grade = StudentPeriodGrade(student_id=student.student_id, class_id=class_.class_id,
            subject_id=subject.subject_id, academic_period_id=period.academic_period_id,
            final_period_grade=Decimal("80"), is_finalized=True,
            finalized_at=datetime.now(timezone.utc), finalized_by_staff_id=teacher_id)
        db.add(period_grade)
        db.commit()
        with pytest.raises(HTTPException) as finalized_error:
            grade_student_submission(attempt.submission_id, GradeRequest(grade=9), teacher_id, db)
        assert finalized_error.value.status_code == 409
        assert db.get(StudentSubmission, attempt.submission_id).grade == 8

"""PostgreSQL-backed verification of the complete WW/PT remediation contract.

This reuses the existing disposable local PostgreSQL fixture. The generated
database is dropped after every test and never points at Entervene_Demo.
"""

import asyncio
import json
from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.StudentPeriodGrade import StudentPeriodGrade
from app.models.ai.AIModelVersion import AIModelVersion
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkLesson import ClassworkLesson
from app.models.classwork.RemediationAssignmentLink import RemediationAssignmentLink
from app.models.intervention.Intervention import Intervention
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.Submission import GradeRequest
from app.services.classwork.ClassworkService import create_classwork_wizard_record
from app.services.intervention.InterventionRemediationService import PlanUpdate, get_workspace, save_plan
from app.services.prediction.CurrentPeriodFeatureBuilderService import build_current_period_features_from_records
from app.services.prediction.PredictionFeatureBuilderService import build_prediction_features_from_records
from app.services.student_record.StudentRecordService import teacher_student_gradebook
from app.services.submission.SubmissionService import grade_student_submission
from tests.test_natural_exam_intervention_postgres import _academic_scope, isolated_postgres


def _create_original_pt(db, *, teacher, student, class_, subject, period):
    work = Classwork(
        title="Original PT: Ratio Project",
        classwork_type="ACTIVITY",
        classwork_category="PERFORMANCE_TASK",
        activity_mode="MANUAL",
        total_points=Decimal("40"),
        is_graded=True,
        is_published=True,
        subject_id=subject.subject_id,
        created_by_staff_id=teacher.staff_id,
    )
    db.add(work)
    db.flush()
    assignment = ClassworkAssignment(
        classwork_id=work.classwork_id,
        class_id=class_.class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=teacher.staff_id,
        is_published=True,
    )
    db.add(assignment)
    db.flush()
    submission = StudentSubmission(
        student_id=student.student_id,
        classwork_assignment_id=assignment.classwork_assignment_id,
        submitted_at=datetime.now(timezone.utc),
        status="graded",
        grade=Decimal("10"),
        graded_by_staff_id=teacher.staff_id,
    )
    db.add(submission)
    db.commit()
    return assignment, submission


def _create_reading(db, *, teacher, class_, subject, period, lesson):
    reading = Classwork(
        title="Ratio Review Reading",
        classwork_type="READING",
        classwork_category=None,
        total_points=None,
        is_graded=False,
        is_published=True,
        subject_id=subject.subject_id,
        created_by_staff_id=teacher.staff_id,
    )
    db.add(reading)
    db.flush()
    db.add(ClassworkLesson(classwork_id=reading.classwork_id, lesson_id=lesson.lesson_id))
    db.add(ClassworkAssignment(
        classwork_id=reading.classwork_id,
        class_id=class_.class_id,
        academic_period_id=period.academic_period_id,
        assigned_by_staff_id=teacher.staff_id,
        is_published=True,
    ))
    db.commit()
    return reading


def _create_active_intervention(db, *, teacher, student, class_, subject, period, original):
    model = AIModelVersion(
        model_name=f"postgres-remediation-{uuid4().hex}",
        model_type="REGRESSOR",
        model_purpose="CURRENT_TERM_FINAL_GRADE_PROJECTION",
        algorithm="isolated-test",
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
        predicted_period_grade=Decimal("72"),
        intervention_level="NEEDS_MONITORING",
        intervention_basis="isolated PostgreSQL remediation test",
        evidence_snapshot={
            "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []},
            "projected_final_term_grade_raw": 72.0,
        },
    )
    db.add(prediction)
    db.flush()
    intervention = Intervention(
        student_id=student.student_id,
        class_id=class_.class_id,
        subject_id=subject.subject_id,
        academic_period_id=period.academic_period_id,
        source_prediction_id=prediction.prediction_id,
        status="ACTIVE",
        activated_at=datetime.now(timezone.utc),
        activated_by_staff_id=teacher.staff_id,
        diagnosis_snapshot={
            "evidence_cutoff_at": datetime.now(timezone.utc).isoformat(),
            "weakest_supported_components": ["PERFORMANCE_TASK"],
            "lowest_supported_competencies": [],
            "manual_assessment_coverage": [],
            "supporting_activities": [{
                "classwork_id": original.classwork_id,
                "classwork_assignment_id": original.classwork_assignment_id,
                "title": original.classwork.title,
                "component": "PERFORMANCE_TASK",
                "score": 10.0,
                "possible_score": 40.0,
                "percent": 25.0,
            }],
        },
    )
    db.add(intervention)
    db.commit()
    return intervention


async def _author_remediation(*, db, teacher, class_, subject, period, lesson, intervention, original, total_points):
    return await create_classwork_wizard_record(
        title="Targeted Ratio Remediation",
        classwork_type="ACTIVITY",
        subject_id=subject.subject_id,
        description=None,
        instructions="Complete the targeted performance task.",
        classwork_category="PERFORMANCE_TASK",
        total_points=total_points,
        is_published=True,
        show_scores=True,
        class_ids=json.dumps([class_.class_id]),
        academic_period_id=period.academic_period_id,
        lesson_ids=json.dumps([lesson.lesson_id]),
        due_date=None,
        lock_date=None,
        allow_late_submissions=False,
        max_attempts=None,
        quiz_payload=None,
        rubric_payload=None,
        files=[],
        intervention_id=intervention.intervention_id,
        remediation_request_id=uuid4(),
        original_classwork_assignment_id=original.classwork_assignment_id,
        current_user={"sub": str(uuid4()), "role": "teacher"},
        staff_id=teacher.staff_id,
        db=db,
    )


@pytest.mark.parametrize(
    ("remediation_score", "expected_effective", "expected_improvement"),
    [(Decimal("36"), 30.0, 20.0), (Decimal("25"), 25.0, 15.0)],
)
def test_complete_pt_remediation_workflow_on_disposable_postgres(
    isolated_postgres, remediation_score, expected_effective, expected_improvement,
):
    print(f"Disposable PostgreSQL workflow database: {isolated_postgres.url.database}")
    with Session(isolated_postgres) as db:
        teacher, student, class_, subject, period, _, lesson = _academic_scope(db)
        original, original_submission = _create_original_pt(
            db, teacher=teacher, student=student, class_=class_, subject=subject, period=period,
        )
        reading = _create_reading(
            db, teacher=teacher, class_=class_, subject=subject, period=period, lesson=lesson,
        )
        intervention = _create_active_intervention(
            db, teacher=teacher, student=student, class_=class_, subject=subject,
            period=period, original=original,
        )

        workspace = get_workspace(db, teacher.staff_id, intervention.intervention_id)
        assert [(item["kind"], item["id"]) for item in workspace["resources"]] == [
            ("CLASSWORK", reading.classwork_id),
        ]
        saved = save_plan(db, teacher.staff_id, intervention.intervention_id, PlanUpdate(
            teacher_choice="CLASSWORK",
            grade_treatment="PERFORMANCE_TASK",
            target_assignment_ids=[original.classwork_assignment_id],
            selected_resources=[{"kind": "CLASSWORK", "id": reading.classwork_id}],
        ))
        assert saved["plan"]["score_adjustment_cap"] == 75.0
        assert saved["plan"]["selected_resources"] == [{"kind": "CLASSWORK", "id": reading.classwork_id}]
        reopened = get_workspace(db, teacher.staff_id, intervention.intervention_id)
        assert reopened["plan"]["selected_resources"] == [{"kind": "CLASSWORK", "id": reading.classwork_id}]
        assert len(reopened["resources"]) == 1

        baseline_gradebook = teacher_student_gradebook(
            db, teacher.staff_id, class_.class_id, subject.subject_id, period.academic_period_id,
        )
        baseline_row = next(
            item for item in baseline_gradebook.studentGrades
            if item.student_id == str(student.student_id)
        )
        assert baseline_row.performanceTask == [10.0]
        assert baseline_gradebook.classwork[0].performanceTask[0].maxScore == 40.0
        baseline_current = build_current_period_features_from_records(
            db, student.student_id, class_.class_id, subject.subject_id, period.academic_period_id,
        )["features"]
        assert baseline_current["pt_points_earned_so_far"] == 10.0
        assert baseline_current["pt_points_possible_so_far"] == 40.0
        assert baseline_current["pt_percent_so_far"] == 25.0
        baseline_prediction = build_prediction_features_from_records(
            db, student.student_id, class_.class_id, subject.subject_id, period.academic_period_id,
        )
        assert baseline_prediction["features"]["performance_task_percent"] == 25.0
        assert baseline_prediction["evidence_summary"]["assignment_observations"][0][
            "selected_submission_grade"
        ] == 10.0

        counts_before = (
            db.query(Classwork).count(),
            db.query(ClassworkAssignment).count(),
            db.query(RemediationAssignmentLink).count(),
        )
        with pytest.raises(HTTPException) as mismatch:
            asyncio.run(_author_remediation(
                db=db, teacher=teacher, class_=class_, subject=subject, period=period,
                lesson=lesson, intervention=intervention, original=original, total_points=20,
            ))
        assert mismatch.value.status_code == 400
        assert "maximum points" in str(mismatch.value.detail)
        assert counts_before == (
            db.query(Classwork).count(),
            db.query(ClassworkAssignment).count(),
            db.query(RemediationAssignmentLink).count(),
        )

        authored = asyncio.run(_author_remediation(
            db=db, teacher=teacher, class_=class_, subject=subject, period=period,
            lesson=lesson, intervention=intervention, original=original, total_points=40,
        ))
        remediation_assignment = db.query(ClassworkAssignment).filter_by(
            classwork_id=authored.classwork_id,
        ).one()
        link = db.query(RemediationAssignmentLink).filter_by(
            remediation_assignment_id=remediation_assignment.classwork_assignment_id,
        ).one()
        assert link.original_assignment_id == original.classwork_assignment_id
        assert link.student_id == student.student_id
        assert link.component == "PERFORMANCE_TASK"
        assert link.score_adjustment_cap == Decimal("75.00")

        remediation_submission = StudentSubmission(
            student_id=student.student_id,
            classwork_assignment_id=remediation_assignment.classwork_assignment_id,
            submitted_at=datetime.now(timezone.utc),
            status="graded",
            grade=remediation_score,
            graded_by_staff_id=teacher.staff_id,
        )
        db.add(remediation_submission)
        db.commit()

        assert original_submission.grade == Decimal("10")
        assert remediation_submission.grade == remediation_score
        gradebook = teacher_student_gradebook(
            db, teacher.staff_id, class_.class_id, subject.subject_id, period.academic_period_id,
        )
        row = next(item for item in gradebook.studentGrades if item.student_id == str(student.student_id))
        assert len(gradebook.classwork[0].performanceTask) == 1
        assert gradebook.classwork[0].performanceTask[0].maxScore == 40.0
        assert row.performanceTask == [expected_effective]
        assert row.ps_performance == expected_effective / 40 * 100
        assert len(row.remedial_classworks) == 1
        audit = row.remedial_classworks[0]
        assert audit["original_score"] == 10.0
        assert audit["remediation_score"] == float(remediation_score)
        assert audit["effective_score"] == expected_effective
        assert audit["effective_score"] - audit["original_score"] == expected_improvement

        current = build_current_period_features_from_records(
            db, student.student_id, class_.class_id, subject.subject_id, period.academic_period_id,
        )["features"]
        assert current["pt_points_earned_so_far"] == expected_effective
        assert current["pt_points_possible_so_far"] == 40.0
        assert current["pt_percent_so_far"] == expected_effective / 40 * 100
        prediction = build_prediction_features_from_records(
            db, student.student_id, class_.class_id, subject.subject_id, period.academic_period_id,
        )
        assert prediction["features"]["performance_task_percent"] == expected_effective / 40 * 100
        assert prediction["evidence_summary"]["expected_count"] == 1
        assert prediction["evidence_summary"]["graded_count"] == 1
        observations = prediction["evidence_summary"]["assignment_observations"]
        assert len(observations) == 1
        assert observations[0]["assignment_id"] == original.classwork_assignment_id
        assert observations[0]["selected_submission_grade"] == expected_effective

        db.add(StudentPeriodGrade(
            student_id=student.student_id,
            class_id=class_.class_id,
            subject_id=subject.subject_id,
            academic_period_id=period.academic_period_id,
            final_period_grade=Decimal("80"),
            is_finalized=True,
            finalized_at=datetime.now(timezone.utc),
            finalized_by_staff_id=teacher.staff_id,
        ))
        db.commit()
        with pytest.raises(HTTPException) as finalized:
            grade_student_submission(
                remediation_submission.submission_id,
                GradeRequest(grade=float(remediation_score) - 1),
                teacher.staff_id,
                db,
            )
        assert finalized.value.status_code == 409
        db.refresh(remediation_submission)
        assert remediation_submission.grade == remediation_score

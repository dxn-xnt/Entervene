"""Regression tests for intervention lesson scoping, recommendation accuracy, and cross-student isolation.

Covers:
1. Single-lesson targeting (scopes focus, eligibility, recommended readings, AI validation/preflight).
2. Legitimate multi-lesson targeting (preserves all target lessons while excluding unrelated activities).
3. Unrelated lessons sharing a competency (no competency-only cross-lesson inference).
4. Cross-student isolation (private THIS_STUDENT readings, classwide attribution, cross-student QuizAnswer/assignment rejection).
5. Same-subject / different-section isolation (section-scoped vs ALL_SUBJECT_STUDENTS resources and evidence).
"""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from fastapi import HTTPException

from app.models.academic.Class_ import Class
from app.models.academic.Competency import Competency
from app.models.academic.Lesson import Lesson
from app.models.academic.LessonDelivery import LessonDelivery
from app.models.academic.SubjectLoad import SubjectLoad
from app.models.ai.AIModelVersion import AIModelVersion, ModelPurpose
from app.models.ai.DevelopmentCurrentTermPrediction import DevelopmentCurrentTermPrediction
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkAssignmentRecipient import ClassworkAssignmentRecipient
from app.models.classwork.ClassworkCoverage import ClassworkCoverage
from app.models.intervention.Intervention import Intervention
from app.models.quiz.Question import Question
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizAnswer import QuizAnswer
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.submissions.StudentSubmission import StudentSubmission
from app.schemas.RemediationDraft import parse_remediation_draft
from app.services.intervention.InterventionDiagnosisService import effective_diagnosis_snapshot
from app.services.intervention.InterventionGenerationEvidenceScopeService import (
    resolve_generation_evidence_scope,
)
from app.services.intervention.InterventionRemediationDraftPreflightService import (
    preflight_remediation_draft,
)
from app.services.intervention.InterventionRemediationDraftValidationService import (
    validate_remediation_draft,
)
from app.services.intervention.InterventionRemediationFocusService import (
    build_remediation_focus,
)
from app.services.intervention.InterventionRemediationMaterialContextService import (
    resolve_remediation_material_context,
)
from app.services.intervention.InterventionRemediationService import (
    PlanUpdate,
    ResourceRef,
    get_workspace,
    resources,
    save_plan,
)
from app.services.intervention.RemediationGenerationEligibilityService import (
    resolve_remediation_generation_eligibility,
)
from tests.test_classwork_submission_authorization import authz_context
from tests.test_intervention_resource_recipient_scopes import _add_student


def _setup_two_lesson_math_scenario(authz_context):
    """Build a Grade 9 Math scenario matching two lessons sharing one competency."""
    c = authz_context
    db = c["db"]
    period = c["period"]
    period.is_active = True
    year_id = period.academic_year_id
    owner = c["owner"]
    subject = c["subject"]
    class_a = c["allowed_class"]
    student_a = c["student"]

    student_b, _ = _add_student(
        db, class_id=class_a.class_id, academic_year_id=year_id, suffix="classmate_b"
    )

    class_b = Class(
        section_name="Einstein",
        academic_year_id=year_id,
        academic_level_id=class_a.academic_level_id,
        class_status="active",
    )
    db.add(class_b)
    db.flush()
    db.add(
        SubjectLoad(
            staff_id=owner.staff_id,
            subject_id=subject.subject_id,
            class_id=class_b.class_id,
            academic_period_id=period.academic_period_id,
            status="active",
            is_active_version=True,
        )
    )
    student_sec2, _ = _add_student(
        db, class_id=class_b.class_id, academic_year_id=year_id, suffix="sec2_student"
    )

    comp_shared = Competency(
        competency_code="ENMATH9-G1",
        statement="Basic Geometric Figures",
        subject_id=subject.subject_id,
        academic_period_id=period.academic_period_id,
    )
    comp_other = Competency(
        competency_code="ENMATH9-G2",
        statement="Triangle Congruence",
        subject_id=subject.subject_id,
        academic_period_id=period.academic_period_id,
    )
    db.add_all([comp_shared, comp_other])
    db.flush()

    lesson_1 = Lesson(
        title="Lesson 1: Geometric Figures",
        content="Points, lines, planes, segments, and rays.",
        subject_id=subject.subject_id,
        competency_id=comp_shared.competency_id,
        is_published=True,
    )
    lesson_2 = Lesson(
        title="Lesson 2: Parallel and Perpendicular Lines",
        content="Parallel lines have equal slopes; perpendicular lines have negative reciprocal slopes.",
        subject_id=subject.subject_id,
        competency_id=comp_shared.competency_id,
        is_published=True,
    )
    lesson_3 = Lesson(
        title="Lesson 3: Congruent Triangles",
        content="SSS, SAS, ASA, and AAS triangle congruence postulates.",
        subject_id=subject.subject_id,
        competency_id=comp_other.competency_id,
        is_published=True,
    )
    db.add_all([lesson_1, lesson_2, lesson_3])
    db.flush()

    cutoff = datetime.now(timezone.utc)
    delivered_at = cutoff - timedelta(hours=2)
    for cls in (class_a, class_b):
        for lesson in (lesson_1, lesson_2, lesson_3):
            db.add(
                LessonDelivery(
                    lesson_id=lesson.lesson_id,
                    class_id=cls.class_id,
                    subject_id=subject.subject_id,
                    academic_period_id=period.academic_period_id,
                    delivered_at=delivered_at,
                    delivered_by_staff_id=owner.staff_id,
                )
            )
    db.flush()

    def _create_reading(
        title: str,
        *,
        lessons: list[Lesson] | None = None,
        coverages: list[tuple[int | None, int | None]] | None = None,
        class_ids: list[int] | None = None,
        origin_id: int | None = None,
        recipient_scope: str | None = None,
        recipient_student_ids: list | None = None,
    ) -> Classwork:
        cw = Classwork(
            title=title,
            description=f"Reading material: {title}",
            instructions="Read carefully.",
            classwork_type="READING",
            classwork_category="WRITTEN_WORKS",
            subject_id=subject.subject_id,
            created_by_staff_id=owner.staff_id,
            is_graded=False,
            is_published=True,
            is_archived=False,
            intervention_resource_origin_id=origin_id,
            intervention_resource_recipient_scope=recipient_scope,
        )
        if lessons:
            cw.lessons = list(lessons)
        db.add(cw)
        db.flush()
        for lid, cid in (coverages or []):
            db.add(
                ClassworkCoverage(
                    classwork_id=cw.classwork_id,
                    lesson_id=lid,
                    competency_id=cid,
                )
            )
        for cid_target in (class_ids or []):
            asgn = ClassworkAssignment(
                classwork_id=cw.classwork_id,
                class_id=cid_target,
                academic_period_id=period.academic_period_id,
                assigned_by_staff_id=owner.staff_id,
                is_published=True,
                recipient_student_id=None,
            )
            db.add(asgn)
            db.flush()
            for sid in (recipient_student_ids or []):
                db.add(
                    ClassworkAssignmentRecipient(
                        classwork_assignment_id=asgn.classwork_assignment_id,
                        student_id=sid,
                        assigned_by_staff_id=owner.staff_id,
                    )
                )
        db.flush()
        return cw

    def _create_quiz(
        title: str,
        *,
        class_row: Class,
        lesson_items: list[tuple[Lesson, Decimal, Decimal]],
        student_row,
    ):
        total_pts = sum((possible for _, possible, _ in lesson_items), Decimal("0"))
        score_pts = sum((awarded for _, _, awarded in lesson_items), Decimal("0"))
        cw = Classwork(
            title=title,
            classwork_type="QUIZ",
            classwork_category="WRITTEN_WORKS",
            subject_id=subject.subject_id,
            created_by_staff_id=owner.staff_id,
            total_points=total_pts,
            is_graded=True,
            is_published=True,
            is_archived=False,
        )
        unique_lessons = list({l.lesson_id: l for l, _, _ in lesson_items}.values())
        cw.lessons = unique_lessons
        db.add(cw)
        db.flush()

        asgn = ClassworkAssignment(
            classwork_id=cw.classwork_id,
            class_id=class_row.class_id,
            academic_period_id=period.academic_period_id,
            assigned_by_staff_id=owner.staff_id,
            is_published=True,
        )
        db.add(asgn)
        db.flush()

        sub = StudentSubmission(
            classwork_assignment_id=asgn.classwork_assignment_id,
            student_id=student_row.student_id,
            status="graded",
            grade=score_pts,
        )
        db.add(sub)
        db.flush()

        quiz = Quiz(classwork_id=cw.classwork_id, total_items=len(lesson_items), status="PUBLISHED")
        db.add(quiz)
        db.flush()

        supporting_scores = []
        for idx, (lesson, possible, awarded) in enumerate(lesson_items, start=1):
            q = Question(
                question_text=f"{title} item {idx} ({lesson.title})",
                question_type="SHORT_ANSWER",
                points=possible,
                lesson_id=lesson.lesson_id,
            )
            db.add(q)
            db.flush()
            qq = QuizQuestion(quiz_id=quiz.quiz_id, question_id=q.question_id, display_order=idx)
            db.add(qq)
            db.flush()
            db.add(
                QuizAnswer(
                    quiz_question_id=qq.quiz_question_id,
                    submission_id=sub.submission_id,
                    points_awarded=awarded,
                )
            )
            comp = db.get(Competency, lesson.competency_id) if lesson.competency_id else None
            supporting_scores.append(
                {
                    "source_type": "QUIZ_QUESTION",
                    "quiz_question_id": qq.quiz_question_id,
                    "lesson_id": lesson.lesson_id,
                    "lesson_title": lesson.title,
                    "competency_id": comp.competency_id if comp else None,
                    "competency_code": comp.competency_code if comp else None,
                    "competency_statement": comp.statement if comp else None,
                    "classwork_id": cw.classwork_id,
                    "classwork_assignment_id": asgn.classwork_assignment_id,
                    "submission_id": sub.submission_id,
                    "activity_title": cw.title,
                    "component": "WRITTEN_WORK",
                    "score": float(awarded),
                    "possible_score": float(possible),
                }
            )
        db.flush()
        activity_entry = {
            "classwork_id": cw.classwork_id,
            "classwork_assignment_id": asgn.classwork_assignment_id,
            "submission_id": sub.submission_id,
            "title": cw.title,
            "classwork_type": "QUIZ",
            "component": "WRITTEN_WORK",
            "score": float(score_pts),
            "possible_score": float(total_pts),
            "percent": float((score_pts / total_pts) * Decimal("100")) if total_pts > 0 else 0.0,
        }
        return {
            "classwork": cw,
            "assignment": asgn,
            "submission": sub,
            "quiz": quiz,
            "activity": activity_entry,
            "supporting_scores": supporting_scores,
        }

    def _create_intervention(student_row, class_row, activities, supporting_scores, manual_coverage=None):
        model_version = (
            db.query(AIModelVersion)
            .filter_by(model_purpose=ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value)
            .first()
        )
        if model_version is None:
            model_version = AIModelVersion(
                model_name=f"test-current-term-{uuid4().hex[:6]}",
                algorithm="RandomForest",
                model_type="REGRESSOR",
                model_purpose=ModelPurpose.CURRENT_TERM_FINAL_GRADE_PROJECTION.value,
                lifecycle_status="DEVELOPMENT",
                is_active=True,
            )
            db.add(model_version)
            db.flush()

        pred = DevelopmentCurrentTermPrediction(
            student_id=student_row.student_id,
            class_id=class_row.class_id,
            subject_id=subject.subject_id,
            source_period_id=period.academic_period_id,
            target_period_id=period.academic_period_id,
            model_version_id=model_version.model_version_id,
            revision=1,
            predicted_period_grade=Decimal("72.00"),
            intervention_level="MODERATE_RISK",
            intervention_basis="BELOW_PASSING_THRESHOLD",
            evidence_snapshot={
                "readiness": {"status": "READY"},
                "projected_final_term_grade_raw": 72.0,
                "generation_cutoff_at": cutoff.isoformat(),
            },
        )
        db.add(pred)
        db.flush()

        # Group supporting scores by competency
        by_comp: dict[int, list[dict]] = {}
        for s in supporting_scores:
            if s.get("competency_id") is not None:
                by_comp.setdefault(s["competency_id"], []).append(s)

        lowest_comps = []
        for cid, items in by_comp.items():
            tot_score = sum(i["score"] for i in items)
            tot_pos = sum(i["possible_score"] for i in items)
            lowest_comps.append(
                {
                    "competency_id": cid,
                    "competency_code": items[0]["competency_code"],
                    "competency_statement": items[0]["competency_statement"],
                    "score": tot_score,
                    "possible_score": tot_pos,
                    "percent": round((tot_score / tot_pos) * 100, 2) if tot_pos else 0.0,
                    "supporting_scores": items,
                }
            )

        snapshot = {
            "source_prediction_id": pred.prediction_id,
            "student_id": str(student_row.student_id),
            "class_id": class_row.class_id,
            "subject_id": subject.subject_id,
            "academic_period_id": period.academic_period_id,
            "evidence_cutoff_at": cutoff.isoformat(),
            "weakest_supported_components": ["WRITTEN_WORK"],
            "components": {
                "WRITTEN_WORK": {
                    "evidence_state": "AVAILABLE",
                    "score": 4.0,
                    "possible_score": 20.0,
                    "percent": 20.0,
                }
            },
            "supporting_activities": activities,
            "lowest_supported_competencies": lowest_comps,
            "manual_assessment_coverage": manual_coverage or [],
        }
        row = Intervention(
            student_id=student_row.student_id,
            class_id=class_row.class_id,
            subject_id=subject.subject_id,
            academic_period_id=period.academic_period_id,
            source_prediction_id=pred.prediction_id,
            status="ACTIVE",
            activated_at=cutoff,
            activated_by_staff_id=owner.staff_id,
            diagnosis_snapshot=snapshot,
            remediation_plan={},
        )
        db.add(row)
        db.flush()
        return row

    return {
        **c,
        "class_a": class_a,
        "class_b": class_b,
        "student_a": student_a,
        "student_b": student_b,
        "student_sec2": student_sec2,
        "comp_shared": comp_shared,
        "comp_other": comp_other,
        "lesson_1": lesson_1,
        "lesson_2": lesson_2,
        "lesson_3": lesson_3,
        "cutoff": cutoff,
        "create_reading": _create_reading,
        "create_quiz": _create_quiz,
        "create_intervention": _create_intervention,
    }


def _quiz_draft_for_lesson(lesson_id: int, competency_id: int) -> dict:
    return {
        "draft_format": "QUIZ",
        "target_component": "WRITTEN_WORK",
        "grade_treatment": "WRITTEN_WORK",
        "title": "Targeted Remediation Quiz",
        "instructions": "Answer all items.",
        "total_points": 5,
        "questions": [
            {
                "display_order": 1,
                "question_text": "Which pair of slopes represents perpendicular lines?",
                "question_type": "MULTIPLE_CHOICE",
                "points": 5,
                "targeted_lesson_id": lesson_id,
                "targeted_competency_id": competency_id,
                "options": [
                    {"option_order": 1, "option_text": "2 and -1/2"},
                    {"option_order": 2, "option_text": "2 and 2"},
                ],
                "teacher_answer_key": {
                    "correct_answer": "2 and -1/2",
                    "explanation": "Perpendicular slopes are negative reciprocals.",
                    "scoring_guide": "5 points for correct choice.",
                },
            }
        ],
    }


def test_single_lesson_targeting_scopes_focus_eligibility_resources_and_generation(authz_context):
    ctx = _setup_two_lesson_math_scenario(authz_context)
    db = ctx["db"]
    staff_id = ctx["owner"].staff_id

    reading_l1 = ctx["create_reading"](
        "Basic Geometric Figures Reading",
        lessons=[ctx["lesson_1"]],
        class_ids=[ctx["class_a"].class_id],
    )
    reading_l2 = ctx["create_reading"](
        "Parallel and Perpendicular Lines Reading",
        lessons=[ctx["lesson_2"]],
        class_ids=[ctx["class_a"].class_id],
    )

    quiz_l1 = ctx["create_quiz"](
        "Lesson 1: Basic Geometric Figures Quiz",
        class_row=ctx["class_a"],
        lesson_items=[(ctx["lesson_1"], Decimal("5"), Decimal("1"))],
        student_row=ctx["student_a"],
    )
    quiz_l2 = ctx["create_quiz"](
        "Parallel and Perpendicular Lines Quiz",
        class_row=ctx["class_a"],
        lesson_items=[(ctx["lesson_2"], Decimal("5"), Decimal("1"))],
        student_row=ctx["student_a"],
    )

    intervention = ctx["create_intervention"](
        ctx["student_a"],
        ctx["class_a"],
        activities=[quiz_l1["activity"], quiz_l2["activity"]],
        supporting_scores=quiz_l1["supporting_scores"] + quiz_l2["supporting_scores"],
    )
    db.commit()

    target_l2_id = quiz_l2["assignment"].classwork_assignment_id

    # 1. Focus scoped to Quiz 2 includes ONLY Lesson 2.
    focus = build_remediation_focus(intervention, db=db, target_assignment_id=target_l2_id)
    assert focus["lesson_ids"] == [ctx["lesson_2"].lesson_id]
    assert [l["id"] for l in focus["lessons"]] == [ctx["lesson_2"].lesson_id]

    # 2. Evidence scope & eligibility scoped to Quiz 2 exclude Lesson 1 and Quiz 1 questions.
    scope = resolve_generation_evidence_scope(db, intervention, target_assignment_id=target_l2_id)
    assert [l["lesson_id"] for l in scope["lessons"]] == [ctx["lesson_2"].lesson_id]
    assert all(q["classwork_assignment_id"] == target_l2_id for q in scope["questions"])

    eligibility = resolve_remediation_generation_eligibility(
        db, intervention, target_assignment_id=target_l2_id
    )
    assert [l["lesson_id"] for l in eligibility["eligible_taught_lessons"]] == [ctx["lesson_2"].lesson_id]

    # 3. Workspace with explicit target_assignment_id recommends ONLY Reading 2 (NOT Reading 1).
    ws = get_workspace(db, staff_id, intervention.intervention_id, target_assignment_id=target_l2_id)
    assert ws["focus"]["lesson_ids"] == [ctx["lesson_2"].lesson_id]
    assert [l["lesson_id"] for l in ws["generation_eligibility"]["eligible_taught_lessons"]] == [
        ctx["lesson_2"].lesson_id
    ]
    res_by_id = {r["id"]: r for r in ws["resources"]}
    assert res_by_id[reading_l2.classwork_id]["recommended"] is True
    assert res_by_id[reading_l1.classwork_id]["recommended"] is False

    # 4. Saving plan with target_assignment_ids=[target_l2_id] makes default get_workspace target-scoped.
    saved_ws = save_plan(
        db,
        staff_id,
        intervention.intervention_id,
        PlanUpdate(
            teacher_choice="QUIZ",
            grade_treatment="WRITTEN_WORK",
            target_assignment_ids=[target_l2_id],
            selected_resources=[ResourceRef(kind="CLASSWORK", id=reading_l2.classwork_id)],
        ),
    )
    assert saved_ws["focus"]["lesson_ids"] == [ctx["lesson_2"].lesson_id]
    assert [l["lesson_id"] for l in saved_ws["generation_eligibility"]["eligible_taught_lessons"]] == [
        ctx["lesson_2"].lesson_id
    ]
    saved_res_by_id = {r["id"]: r for r in saved_ws["resources"]}
    assert saved_res_by_id[reading_l2.classwork_id]["recommended"] is True
    assert saved_res_by_id[reading_l1.classwork_id]["recommended"] is False

    # 5. Validation & preflight reject Lesson 1 drafts and accept Lesson 2 drafts for target Quiz 2.
    draft_l1 = parse_remediation_draft(
        _quiz_draft_for_lesson(ctx["lesson_1"].lesson_id, ctx["comp_shared"].competency_id)
    )
    with pytest.raises(HTTPException) as exc:
        validate_remediation_draft(db, intervention, draft_l1, target_assignment_id=target_l2_id)
    assert exc.value.status_code == 422

    with pytest.raises(HTTPException) as preflight_exc:
        preflight_remediation_draft(
            db,
            staff_id=staff_id,
            intervention_id=intervention.intervention_id,
            draft_input=_quiz_draft_for_lesson(ctx["lesson_1"].lesson_id, ctx["comp_shared"].competency_id),
            target_assignment_id=target_l2_id,
            require_readings=False,
        )
    assert preflight_exc.value.status_code == 422

    preflight_ok = preflight_remediation_draft(
        db,
        staff_id=staff_id,
        intervention_id=intervention.intervention_id,
        draft_input=_quiz_draft_for_lesson(ctx["lesson_2"].lesson_id, ctx["comp_shared"].competency_id),
        target_assignment_id=target_l2_id,
        require_readings=False,
    )
    assert preflight_ok.is_valid is True


def test_legitimate_multi_lesson_target_preserves_all_target_lessons_and_excludes_unrelated(authz_context):
    ctx = _setup_two_lesson_math_scenario(authz_context)
    db = ctx["db"]
    staff_id = ctx["owner"].staff_id

    reading_l1 = ctx["create_reading"]("Reading L1", lessons=[ctx["lesson_1"]], class_ids=[ctx["class_a"].class_id])
    reading_l2 = ctx["create_reading"]("Reading L2", lessons=[ctx["lesson_2"]], class_ids=[ctx["class_a"].class_id])
    reading_l3 = ctx["create_reading"]("Reading L3", lessons=[ctx["lesson_3"]], class_ids=[ctx["class_a"].class_id])

    # Legitimate multi-lesson quiz covering Lesson 1 AND Lesson 2.
    quiz_l1_l2 = ctx["create_quiz"](
        "Unit 1 Combined Quiz (L1 + L2)",
        class_row=ctx["class_a"],
        lesson_items=[
            (ctx["lesson_1"], Decimal("5"), Decimal("1")),
            (ctx["lesson_2"], Decimal("5"), Decimal("2")),
        ],
        student_row=ctx["student_a"],
    )
    # Unrelated quiz covering Lesson 3.
    quiz_l3 = ctx["create_quiz"](
        "Lesson 3 Quiz",
        class_row=ctx["class_a"],
        lesson_items=[(ctx["lesson_3"], Decimal("5"), Decimal("1"))],
        student_row=ctx["student_a"],
    )

    intervention = ctx["create_intervention"](
        ctx["student_a"],
        ctx["class_a"],
        activities=[quiz_l1_l2["activity"], quiz_l3["activity"]],
        supporting_scores=quiz_l1_l2["supporting_scores"] + quiz_l3["supporting_scores"],
    )
    db.commit()

    multi_target_id = quiz_l1_l2["assignment"].classwork_assignment_id
    focus = build_remediation_focus(intervention, db=db, target_assignment_id=multi_target_id)
    assert set(focus["lesson_ids"]) == {ctx["lesson_1"].lesson_id, ctx["lesson_2"].lesson_id}
    assert ctx["lesson_3"].lesson_id not in focus["lesson_ids"]

    scope = resolve_generation_evidence_scope(db, intervention, target_assignment_id=multi_target_id)
    assert {l["lesson_id"] for l in scope["lessons"]} == {
        ctx["lesson_1"].lesson_id,
        ctx["lesson_2"].lesson_id,
    }

    res_list = resources(db, intervention, staff_id, target_assignment_id=multi_target_id)
    res_by_id = {r["id"]: r for r in res_list}
    assert res_by_id[reading_l1.classwork_id]["recommended"] is True
    assert res_by_id[reading_l2.classwork_id]["recommended"] is True
    assert res_by_id[reading_l3.classwork_id]["recommended"] is False


def test_unrelated_lesson_sharing_competency_not_recommended_or_auto_discovered(authz_context):
    ctx = _setup_two_lesson_math_scenario(authz_context)
    db = ctx["db"]
    staff_id = ctx["owner"].staff_id

    # Lesson 1 reading linked via classwork_lesson AND explicit ClassworkCoverage(lesson_id=L1, competency_id=shared)
    reading_l1 = ctx["create_reading"](
        "Lesson 1 Only Reading",
        lessons=[ctx["lesson_1"]],
        coverages=[(ctx["lesson_1"].lesson_id, ctx["comp_shared"].competency_id)],
        class_ids=[ctx["class_a"].class_id],
    )
    reading_l2 = ctx["create_reading"](
        "Lesson 2 Only Reading",
        lessons=[ctx["lesson_2"]],
        class_ids=[ctx["class_a"].class_id],
    )
    # Competency-only reading (no lesson attached) remains eligible when competency matches.
    reading_comp_only = ctx["create_reading"](
        "Shared Competency Overview Reading",
        lessons=[],
        coverages=[(None, ctx["comp_shared"].competency_id)],
        class_ids=[ctx["class_a"].class_id],
    )

    quiz_l2 = ctx["create_quiz"](
        "Parallel and Perpendicular Lines Quiz",
        class_row=ctx["class_a"],
        lesson_items=[(ctx["lesson_2"], Decimal("5"), Decimal("0"))],
        student_row=ctx["student_a"],
    )
    intervention = ctx["create_intervention"](
        ctx["student_a"],
        ctx["class_a"],
        activities=[quiz_l2["activity"]],
        supporting_scores=quiz_l2["supporting_scores"],
    )
    db.commit()

    target_l2_id = quiz_l2["assignment"].classwork_assignment_id
    res_list = resources(db, intervention, staff_id, target_assignment_id=target_l2_id)
    res_by_id = {r["id"]: r for r in res_list}
    assert res_by_id[reading_l1.classwork_id]["recommended"] is False
    assert res_by_id[reading_l2.classwork_id]["recommended"] is True
    assert res_by_id[reading_l2.classwork_id]["match_level"] == "COMPETENCY"
    assert res_by_id[reading_comp_only.classwork_id]["recommended"] is True

    # Material context auto-discovery must NOT pull reading_l1 via shared competency.
    eligibility = resolve_remediation_generation_eligibility(
        db, intervention, target_assignment_id=target_l2_id
    )
    scope = eligibility["scope"]
    mat_ctx = resolve_remediation_material_context(db, intervention, scope)
    discovered_ids = {m.classwork_id for m in mat_ctx.reading_materials}
    assert reading_l2.classwork_id in discovered_ids
    assert reading_comp_only.classwork_id in discovered_ids
    assert reading_l1.classwork_id not in discovered_ids


def test_cross_student_private_reading_and_scored_evidence_isolation(authz_context):
    ctx = _setup_two_lesson_math_scenario(authz_context)
    db = ctx["db"]
    staff_id = ctx["owner"].staff_id

    quiz_a = ctx["create_quiz"](
        "Student A Quiz (L1)",
        class_row=ctx["class_a"],
        lesson_items=[(ctx["lesson_1"], Decimal("5"), Decimal("1"))],
        student_row=ctx["student_a"],
    )
    quiz_b = ctx["create_quiz"](
        "Student B Quiz (L2)",
        class_row=ctx["class_a"],
        lesson_items=[(ctx["lesson_2"], Decimal("5"), Decimal("1"))],
        student_row=ctx["student_b"],
    )

    intervention_a = ctx["create_intervention"](
        ctx["student_a"],
        ctx["class_a"],
        activities=[quiz_a["activity"]],
        supporting_scores=quiz_a["supporting_scores"],
    )
    intervention_b = ctx["create_intervention"](
        ctx["student_b"],
        ctx["class_a"],
        activities=[quiz_b["activity"]],
        supporting_scores=quiz_b["supporting_scores"],
    )

    # Private THIS_STUDENT reading created for Student A's intervention.
    private_reading_a = ctx["create_reading"](
        "Student A Private Geometric Figures Reading",
        lessons=[ctx["lesson_1"]],
        class_ids=[ctx["class_a"].class_id],
        origin_id=intervention_a.intervention_id,
        recipient_scope="THIS_STUDENT",
        recipient_student_ids=[ctx["student_a"].student_id],
    )
    # Legitimately shared ENTIRE_CLASS reading created during Student A's intervention.
    shared_class_reading = ctx["create_reading"](
        "Classwide Parallel Lines Guide",
        lessons=[ctx["lesson_2"]],
        class_ids=[ctx["class_a"].class_id],
        origin_id=intervention_a.intervention_id,
        recipient_scope="ENTIRE_CLASS",
        recipient_student_ids=[],
    )
    db.commit()

    # 1. Student B must NOT see Student A's private reading in resources() or material context.
    res_b = resources(db, intervention_b, staff_id)
    res_b_by_id = {r["id"]: r for r in res_b}
    assert private_reading_a.classwork_id not in res_b_by_id

    # Shared ENTIRE_CLASS resource IS eligible for Student B, but NOT attributed as Student B's own added reading.
    assert shared_class_reading.classwork_id in res_b_by_id
    assert res_b_by_id[shared_class_reading.classwork_id]["added_by_teacher"] is False
    assert res_b_by_id[shared_class_reading.classwork_id]["current_recipient_scope"] == "ENTIRE_CLASS"

    # Student A DOES see their own private reading with added_by_teacher=True and THIS_STUDENT.
    res_a_by_id = {r["id"]: r for r in resources(db, intervention_a, staff_id)}
    assert private_reading_a.classwork_id in res_a_by_id
    assert res_a_by_id[private_reading_a.classwork_id]["added_by_teacher"] is True
    assert res_a_by_id[private_reading_a.classwork_id]["current_recipient_scope"] == "THIS_STUDENT"

    # Student B's save_plan rejects Student A's private reading.
    with pytest.raises(HTTPException) as save_exc:
        save_plan(
            db,
            staff_id,
            intervention_b.intervention_id,
            PlanUpdate(
                teacher_choice="EXISTING_MATERIAL_ONLY",
                selected_resources=[ResourceRef(kind="CLASSWORK", id=private_reading_a.classwork_id)],
            ),
        )
    assert save_exc.value.status_code == 422

    # Material context for Student B excludes Student A's private reading (both auto-discovery and explicit).
    elig_b = resolve_remediation_generation_eligibility(db, intervention_b)
    mat_b = resolve_remediation_material_context(db, intervention_b, elig_b["scope"])
    assert private_reading_a.classwork_id not in {m.classwork_id for m in mat_b.reading_materials}
    with pytest.raises(HTTPException) as explicit_exc:
        resolve_remediation_material_context(
            db,
            intervention_b,
            elig_b["scope"],
            selected_reading_ids=[private_reading_a.classwork_id],
        )
    assert explicit_exc.value.status_code == 422

    # 2. Cross-student QuizAnswer evidence cannot leak into Student A's verified scope.
    forged_snapshot = deepcopy(intervention_a.diagnosis_snapshot)
    forged_snapshot["supporting_activities"].append(quiz_b["activity"])
    forged_snapshot["lowest_supported_competencies"][0]["supporting_scores"].extend(
        quiz_b["supporting_scores"]
    )
    intervention_a.diagnosis_snapshot = forged_snapshot
    db.commit()

    scope_a = resolve_generation_evidence_scope(db, intervention_a)
    assert [l["lesson_id"] for l in scope_a["lessons"]] == [ctx["lesson_1"].lesson_id]
    assert all(
        q["classwork_assignment_id"] == quiz_a["assignment"].classwork_assignment_id
        for q in scope_a["questions"]
    )

    # 3. Private assignment belonging to Student B is filtered out of Student A's effective diagnosis.
    private_quiz_b = Classwork(
        title="Student B Individual Quiz",
        classwork_type="QUIZ",
        classwork_category="WRITTEN_WORKS",
        subject_id=ctx["subject"].subject_id,
        created_by_staff_id=staff_id,
        total_points=Decimal("10"),
        is_graded=True,
        is_published=True,
    )
    db.add(private_quiz_b)
    db.flush()
    private_asgn_b = ClassworkAssignment(
        classwork_id=private_quiz_b.classwork_id,
        class_id=ctx["class_a"].class_id,
        academic_period_id=ctx["period"].academic_period_id,
        assigned_by_staff_id=staff_id,
        recipient_student_id=ctx["student_b"].student_id,
        source_intervention_id=intervention_b.intervention_id,
        remediation_request_id=uuid4(),
        is_published=True,
    )
    db.add(private_asgn_b)
    db.flush()
    forged_snapshot2 = deepcopy(intervention_a.diagnosis_snapshot)
    forged_snapshot2["supporting_activities"].append(
        {
            "classwork_id": private_quiz_b.classwork_id,
            "classwork_assignment_id": private_asgn_b.classwork_assignment_id,
            "title": private_quiz_b.title,
            "component": "WRITTEN_WORK",
            "score": 1.0,
            "possible_score": 10.0,
            "percent": 10.0,
        }
    )
    intervention_a.diagnosis_snapshot = forged_snapshot2
    db.commit()

    eff_a = effective_diagnosis_snapshot(db, intervention_a)
    assert all(
        a.get("classwork_assignment_id") != private_asgn_b.classwork_assignment_id
        for a in eff_a["supporting_activities"]
    )


def test_same_subject_different_section_resource_and_evidence_isolation(authz_context):
    ctx = _setup_two_lesson_math_scenario(authz_context)
    db = ctx["db"]
    staff_id = ctx["owner"].staff_id

    quiz_sec1 = ctx["create_quiz"](
        "Section 1 Quiz (L2)",
        class_row=ctx["class_a"],
        lesson_items=[(ctx["lesson_2"], Decimal("5"), Decimal("1"))],
        student_row=ctx["student_a"],
    )
    quiz_sec2 = ctx["create_quiz"](
        "Section 2 Quiz (L1)",
        class_row=ctx["class_b"],
        lesson_items=[(ctx["lesson_1"], Decimal("5"), Decimal("1"))],
        student_row=ctx["student_sec2"],
    )

    intervention_sec1 = ctx["create_intervention"](
        ctx["student_a"],
        ctx["class_a"],
        activities=[quiz_sec1["activity"]],
        supporting_scores=quiz_sec1["supporting_scores"],
    )
    intervention_sec2 = ctx["create_intervention"](
        ctx["student_sec2"],
        ctx["class_b"],
        activities=[quiz_sec2["activity"]],
        supporting_scores=quiz_sec2["supporting_scores"],
    )

    # Section 2 private THIS_STUDENT intervention reading
    sec2_private = ctx["create_reading"](
        "Section 2 Private Student Reading",
        lessons=[ctx["lesson_2"]],
        class_ids=[ctx["class_b"].class_id],
        origin_id=intervention_sec2.intervention_id,
        recipient_scope="THIS_STUDENT",
        recipient_student_ids=[ctx["student_sec2"].student_id],
    )
    # Section 2 ENTIRE_CLASS intervention reading (scoped ONLY to Section 2)
    sec2_class_only = ctx["create_reading"](
        "Section 2 Class-Only Reading",
        lessons=[ctx["lesson_2"]],
        class_ids=[ctx["class_b"].class_id],
        origin_id=intervention_sec2.intervention_id,
        recipient_scope="ENTIRE_CLASS",
        recipient_student_ids=[],
    )
    # Legitimately shared ALL_SUBJECT_STUDENTS reading across both Section 1 and Section 2
    all_sections_reading = ctx["create_reading"](
        "All Grade 9 Sections Parallel Lines Handout",
        lessons=[ctx["lesson_2"]],
        class_ids=[ctx["class_a"].class_id, ctx["class_b"].class_id],
        origin_id=intervention_sec2.intervention_id,
        recipient_scope="ALL_SUBJECT_STUDENTS",
        recipient_student_ids=[],
    )
    db.commit()

    # Section 1 resources must exclude Section 2 private and Section 2 ENTIRE_CLASS intervention readings,
    # while preserving ALL_SUBJECT_STUDENTS shared reading with accurate attribution.
    res_sec1 = resources(db, intervention_sec1, staff_id)
    res_sec1_by_id = {r["id"]: r for r in res_sec1}
    assert sec2_private.classwork_id not in res_sec1_by_id
    assert sec2_class_only.classwork_id not in res_sec1_by_id
    assert all_sections_reading.classwork_id in res_sec1_by_id
    assert res_sec1_by_id[all_sections_reading.classwork_id]["added_by_teacher"] is False
    assert (
        res_sec1_by_id[all_sections_reading.classwork_id]["current_recipient_scope"]
        == "ALL_SUBJECT_STUDENTS"
    )
    assert res_sec1_by_id[all_sections_reading.classwork_id]["recommended"] is True

    # Material context for Section 1 also excludes Section 2 readings and includes ALL_SUBJECT_STUDENTS.
    elig_sec1 = resolve_remediation_generation_eligibility(db, intervention_sec1)
    mat_sec1 = resolve_remediation_material_context(db, intervention_sec1, elig_sec1["scope"])
    discovered_sec1 = {m.classwork_id for m in mat_sec1.reading_materials}
    assert sec2_private.classwork_id not in discovered_sec1
    assert sec2_class_only.classwork_id not in discovered_sec1
    assert all_sections_reading.classwork_id in discovered_sec1

    # Injecting Section 2's quiz activity into Section 1's snapshot must be dropped by evidence scope.
    forged_sec1 = deepcopy(intervention_sec1.diagnosis_snapshot)
    forged_sec1["supporting_activities"].append(quiz_sec2["activity"])
    forged_sec1["lowest_supported_competencies"][0]["supporting_scores"].extend(
        quiz_sec2["supporting_scores"]
    )
    intervention_sec1.diagnosis_snapshot = forged_sec1
    db.commit()

    scope_sec1 = resolve_generation_evidence_scope(db, intervention_sec1)
    assert [l["lesson_id"] for l in scope_sec1["lessons"]] == [ctx["lesson_2"].lesson_id]
    assert all(
        q["classwork_assignment_id"] == quiz_sec1["assignment"].classwork_assignment_id
        for q in scope_sec1["questions"]
    )


def test_score_preview_does_not_collide_between_assignment_id_and_other_classwork_id(authz_context):
    from app.services.intervention.InterventionRemediationService import preview_score_adjustment

    ctx = _setup_two_lesson_math_scenario(authz_context)
    db = ctx["db"]
    staff_id = ctx["owner"].staff_id

    quiz_l1 = ctx["create_quiz"](
        "Lesson 1: Basic Geometric Figures",
        class_row=ctx["class_a"],
        lesson_items=[(ctx["lesson_1"], Decimal("10"), Decimal("1"))],
        student_row=ctx["student_a"],
    )
    quiz_l2 = ctx["create_quiz"](
        "Constructing Parallel and Perpendicular Lines Quiz",
        class_row=ctx["class_a"],
        lesson_items=[(ctx["lesson_2"], Decimal("5"), Decimal("3"))],
        student_row=ctx["student_a"],
    )

    # Simulate the exact numeric collision where another activity's classwork_id
    # equals quiz_l1's classwork_assignment_id.
    target_asgn_id = quiz_l1["assignment"].classwork_assignment_id
    colliding_activity = {
        **quiz_l2["activity"],
        "classwork_id": target_asgn_id,
    }
    intervention = ctx["create_intervention"](
        ctx["student_a"],
        ctx["class_a"],
        activities=[quiz_l1["activity"], colliding_activity],
        supporting_scores=quiz_l1["supporting_scores"] + quiz_l2["supporting_scores"],
    )
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [target_asgn_id],
        "score_adjustment_cap": 75.0,
        "selected_resources": [],
    }
    db.commit()

    preview_res = preview_score_adjustment(
        db, staff_id, intervention.intervention_id, cap_percentage=75, target_assignment_ids=[target_asgn_id],
    )
    assert len(preview_res["previews"]) == 1
    preview = preview_res["previews"][0]
    assert preview["assignment_id"] == target_asgn_id
    assert preview["classwork_id"] == quiz_l1["classwork"].classwork_id
    assert preview["title"] == "Lesson 1: Basic Geometric Figures"
    assert preview["original_score"] == 1.0
    assert preview["max_points"] == 10.0


@pytest.mark.anyio
async def test_ai_remediation_generation_grounds_on_targeted_classwork_lessons_and_readings(
    authz_context, monkeypatch
):
    import json
    from unittest.mock import AsyncMock
    from app.schemas.RemediationDraft import RemediationDraftGenerationRequest
    from app.services.intervention.InterventionRemediationDraftGenerationService import (
        generate_remediation_draft,
    )

    ctx = _setup_two_lesson_math_scenario(authz_context)
    db = ctx["db"]
    staff_id = ctx["owner"].staff_id

    reading_l1 = ctx["create_reading"](
        "Rays, Line Segments, Angles, and Planes",
        lessons=[ctx["lesson_1"]],
        class_ids=[ctx["class_a"].class_id],
    )
    reading_l2 = ctx["create_reading"](
        "Constructing Parallel and Perpendicular Lines",
        lessons=[ctx["lesson_2"]],
        class_ids=[ctx["class_a"].class_id],
    )
    quiz_l1 = ctx["create_quiz"](
        "Lesson 1: Basic Geometric Figures",
        class_row=ctx["class_a"],
        lesson_items=[(ctx["lesson_1"], Decimal("10"), Decimal("1"))],
        student_row=ctx["student_a"],
    )
    quiz_l2 = ctx["create_quiz"](
        "Constructing Parallel and Perpendicular Lines Quiz",
        class_row=ctx["class_a"],
        lesson_items=[(ctx["lesson_2"], Decimal("5"), Decimal("3"))],
        student_row=ctx["student_a"],
    )

    intervention = ctx["create_intervention"](
        ctx["student_a"],
        ctx["class_a"],
        activities=[quiz_l1["activity"], quiz_l2["activity"]],
        supporting_scores=quiz_l1["supporting_scores"] + quiz_l2["supporting_scores"],
    )
    target_l1_id = quiz_l1["assignment"].classwork_assignment_id
    intervention.remediation_plan = {
        "teacher_choice": "QUIZ",
        "grade_treatment": "WRITTEN_WORK",
        "target_assignment_ids": [target_l1_id],
        "score_adjustment_cap": 75.0,
        "selected_resources": [
            {"kind": "CLASSWORK", "id": reading_l1.classwork_id},
            {"kind": "CLASSWORK", "id": reading_l2.classwork_id},
        ],
    }
    db.commit()

    captured_prompts: list[str] = []
    valid_ai_resp = {
        "draft_format": "QUIZ",
        "target_component": "WRITTEN_WORK",
        "grade_treatment": "WRITTEN_WORK",
        "title": "Remediation: Basic Geometric Figures",
        "instructions": "Review Lesson 1 and answer all questions.",
        "total_points": 10.0,
        "questions": [
            {
                "display_order": 1,
                "question_text": "What geometric figure has one endpoint and extends infinitely in one direction?",
                "question_type": "MULTIPLE_CHOICE",
                "points": 5.0,
                "difficulty_level": "EASY",
                "targeted_lesson_id": ctx["lesson_1"].lesson_id,
                "targeted_competency_id": ctx["comp_shared"].competency_id,
                "options": [
                    {"option_order": 1, "option_text": "Ray"},
                    {"option_order": 2, "option_text": "Line segment"},
                    {"option_order": 3, "option_text": "Plane"},
                    {"option_order": 4, "option_text": "Point"},
                ],
                "teacher_answer_key": {
                    "correct_answer": "Ray",
                    "explanation": "A ray starts at one endpoint and extends endlessly in one direction.",
                    "scoring_guide": "5 points for correct answer.",
                },
            },
            {
                "display_order": 2,
                "question_text": "A line segment has two definite endpoints.",
                "question_type": "TRUE_FALSE",
                "points": 5.0,
                "difficulty_level": "EASY",
                "targeted_lesson_id": ctx["lesson_1"].lesson_id,
                "targeted_competency_id": ctx["comp_shared"].competency_id,
                "options": [
                    {"option_order": 1, "option_text": "True"},
                    {"option_order": 2, "option_text": "False"},
                ],
                "teacher_answer_key": {
                    "correct_answer": "True",
                    "explanation": "A line segment is bounded by two distinct endpoints.",
                    "scoring_guide": "5 points for correct answer.",
                },
            },
        ],
    }

    async def fake_generate_text(user_prompt, system_prompt, **kwargs):
        captured_prompts.append(user_prompt)
        return json.dumps(valid_ai_resp)

    monkeypatch.setattr("app.services.ai.Provider.generate_text", AsyncMock(side_effect=fake_generate_text))

    req = RemediationDraftGenerationRequest(
        draft_format="QUIZ",
        target_component="WRITTEN_WORK",
        grade_treatment="WRITTEN_WORK",
        target_assignment_id=target_l1_id,
        item_count=2,
        total_points=10.0,
        selected_reading_ids=[reading_l1.classwork_id, reading_l2.classwork_id],
    )
    draft = await generate_remediation_draft(db, staff_id, intervention.intervention_id, req)
    assert draft.total_points == 10.0
    assert len(captured_prompts) == 1
    prompt = captured_prompts[0]

    # Prompt must anchor on targeted original classwork, its taught lesson content, and ONLY its linked reading
    assert "targeted_original_classwork" in prompt
    assert "Lesson 1: Basic Geometric Figures" in prompt
    assert "Lesson 1: Basic Geometric Figures item 1" in prompt
    assert "taught_lesson_materials" in prompt
    assert "Points, lines, planes, segments, and rays." in prompt
    assert "Rays, Line Segments, Angles, and Planes" in prompt
    assert "Constructing Parallel and Perpendicular Lines" not in prompt
    assert "negative reciprocal slopes" not in prompt

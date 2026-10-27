"""Comprehensive test suite for Task S1D.2B.1: Secure Student Remediation Read Access.

Verifies:
- 0/3 and 2/3 Readings -> assessment content denied with structured HTTP 403.
- 3/3 Readings -> content accessible (HTTP 200).
- Direct URL/API access cannot bypass the guard.
- Wrong student -> denied with HTTP 403.
- Ordinary activities and Supporting Readings (including attachments) -> unaffected.
- Historical unsnapshotted remediation -> denied (PREREQUISITE_SNAPSHOT_MISSING).
- Harmless locked-activity metadata remains available for Study Support.
"""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from app.models.academic.StudentCLass import StudentClass
from app.models.classwork.Classwork import Classwork
from app.models.classwork.ClassworkAssignment import ClassworkAssignment
from app.models.classwork.ClassworkAttachment import ClassworkAttachment
from app.models.intervention.Intervention import Intervention
from app.models.intervention.InterventionReadingReview import InterventionReadingReview
from app.models.quiz.Question import Question
from app.models.quiz.QuestionOption import QuestionOption
from app.models.quiz.Quiz import Quiz
from app.models.quiz.QuizQuestion import QuizQuestion
from app.models.quiz.QuizSetting import QuizSetting
from app.models.submissions.StudentSubmission import StudentSubmission
from app.services.intervention.RemediationReadingPrerequisiteService import (
    ReadingPrerequisiteSnapshotItem,
    stage_remediation_reading_prerequisites,
)
from app.services.intervention.StudentPersistentInterventionService import (
    list_active,
    get_active,
)
from tests.test_classwork_submission_authorization import (
    _act_as,
    _bearer,
    authz_context,
)


def _create_active_intervention(c, intervention_id: int = 1001) -> Intervention:
    """Helper to create an active intervention for the primary test student."""
    intervention = Intervention(
        intervention_id=intervention_id,
        student_id=c["student"].student_id,
        class_id=c["allowed_class"].class_id,
        subject_id=c["subject"].subject_id,
        academic_period_id=c["period"].academic_period_id,
        source_prediction_id=1,
        status="ACTIVE",
        diagnosis_snapshot={},
        activated_at=datetime.now(timezone.utc),
        activated_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(intervention)
    c["db"].flush()
    return intervention


def _create_reading(
    c,
    title: str,
    *,
    file_name: str = "reading_notes.pdf",
    file_type: str = "application/pdf",
    file_content: bytes = b"%PDF-1.4 reading material content",
) -> tuple[Classwork, ClassworkAssignment, ClassworkAttachment]:
    """Helper to create a Supporting Reading with an accessible attachment."""
    cw = Classwork(
        title=title,
        classwork_type="READING",
        is_graded=False,
        total_points=None,
        is_published=True,
        is_archived=False,
        subject_id=c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(cw)
    c["db"].flush()

    assign = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        is_published=True,
    )
    c["db"].add(assign)
    c["db"].flush()

    file_path = c["tmp_path"] / f"{uuid4().hex}_{file_name}"
    file_path.write_bytes(file_content)

    att = ClassworkAttachment(
        classwork_id=cw.classwork_id,
        file_name=file_name,
        file_path=str(file_path),
        file_type=file_type,
        file_size=len(file_content),
    )
    c["db"].add(att)
    c["db"].flush()
    return cw, assign, att


def _create_remedial_quiz(
    c,
    intervention: Intervention,
    *,
    title: str = "Targeted Remedial Quiz",
) -> tuple[Classwork, ClassworkAssignment, Quiz]:
    """Helper to create a remedial Quiz with questions and options."""
    cw = Classwork(
        title=title,
        classwork_type="QUIZ",
        is_graded=True,
        total_points=Decimal("10"),
        is_published=True,
        is_archived=False,
        subject_id=c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(cw)
    c["db"].flush()

    assign = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        is_published=True,
        recipient_student_id=c["student"].student_id,
        source_intervention_id=intervention.intervention_id,
        remediation_request_id=uuid4(),
    )
    c["db"].add(assign)
    c["db"].flush()

    quiz = Quiz(
        classwork_id=cw.classwork_id,
        total_items=1,
        status="PUBLISHED",
    )
    c["db"].add(quiz)
    c["db"].flush()

    setting = QuizSetting(
        classwork_id=cw.classwork_id,
        is_shuffle_questions=False,
        max_attempts=1,
    )
    c["db"].add(setting)

    q = Question(
        question_text="Remedial Secret Question: What is 2 + 2?",
        question_type="MULTIPLE_CHOICE",
        points=Decimal("10"),
    )
    c["db"].add(q)
    c["db"].flush()

    qq = QuizQuestion(
        quiz_id=quiz.quiz_id,
        question_id=q.question_id,
        display_order=1,
    )
    c["db"].add(qq)

    opt1 = QuestionOption(
        question_id=q.question_id,
        option_text="4",
        is_correct=True,
        option_order=1,
    )
    c["db"].add(opt1)
    c["db"].flush()
    return cw, assign, quiz


def _create_remedial_classwork(
    c,
    intervention: Intervention,
    *,
    title: str = "Targeted Remedial Classwork",
    instructions: str = "Secret Remedial Instructions: Solve problem set 1",
) -> tuple[Classwork, ClassworkAssignment, ClassworkAttachment]:
    """Helper to create a remedial Classwork activity with instructions and attachment."""
    cw = Classwork(
        title=title,
        classwork_type="ASSIGNMENT",
        instructions=instructions,
        is_graded=True,
        total_points=Decimal("100"),
        is_published=True,
        is_archived=False,
        subject_id=c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(cw)
    c["db"].flush()

    assign = ClassworkAssignment(
        classwork_id=cw.classwork_id,
        class_id=c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        is_published=True,
        recipient_student_id=c["student"].student_id,
        source_intervention_id=intervention.intervention_id,
        remediation_request_id=uuid4(),
    )
    c["db"].add(assign)
    c["db"].flush()

    file_path = c["tmp_path"] / f"{uuid4().hex}_remedial_worksheet.docx"
    file_path.write_bytes(b"PK\x03\x04 Remedial assessment worksheet content")

    att = ClassworkAttachment(
        classwork_id=cw.classwork_id,
        file_name="remedial_worksheet.docx",
        file_path=str(file_path),
        file_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        file_size=len(b"PK\x03\x04 Remedial assessment worksheet content"),
    )
    c["db"].add(att)
    c["db"].flush()
    return cw, assign, att


def _complete_reading(c, reading_assign: ClassworkAssignment, student_id=None, *, review: bool = True):
    """Mark a reading assignment as completed and reviewed by the student."""
    sid = student_id or c["student"].student_id
    sub = StudentSubmission(
        classwork_assignment_id=reading_assign.classwork_assignment_id,
        student_id=sid,
        status="submitted",
    )
    c["db"].add(sub)
    if review:
        inv = c["db"].query(Intervention).filter_by(student_id=sid).first()
        if inv is not None:
            c["db"].add(InterventionReadingReview(
                intervention_id=inv.intervention_id,
                reading_assignment_id=reading_assign.classwork_assignment_id,
                student_id=sid,
            ))
    c["db"].flush()
    return sub


def test_remediation_quiz_read_blocked_when_0_of_3_readings_complete(authz_context):
    c = authz_context
    intervention = _create_active_intervention(c, 2001)

    r1_cw, r1_as, _ = _create_reading(c, "Reading 1")
    r2_cw, r2_as, _ = _create_reading(c, "Reading 2")
    r3_cw, r3_as, _ = _create_reading(c, "Reading 3")

    q_cw, q_as, _ = _create_remedial_quiz(c, intervention)

    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r1_cw.classwork_id, reading_assignment_id=r1_as.classwork_assignment_id, display_order=1),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r2_cw.classwork_id, reading_assignment_id=r2_as.classwork_assignment_id, display_order=2),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r3_cw.classwork_id, reading_assignment_id=r3_as.classwork_assignment_id, display_order=3),
        ],
    )
    c["db"].commit()

    _act_as(c, "student", "student")
    url = f"/api/v1/quizzes/assignment/{q_as.classwork_assignment_id}/attempt"
    resp = c["client"].get(url)

    assert resp.status_code == 403
    data = resp.json()["detail"]
    assert data["code"] == "PREPARATION_REQUIRED"
    assert data["preparation"]["completed_count"] == 0
    assert data["preparation"]["required_count"] == 3
    assert data["preparation"]["is_satisfied"] is False
    assert data["preparation"]["state"] == "NOT_STARTED"
    assert data["preparation"]["summary"] == "0 of 3 completed"


def test_remediation_quiz_read_blocked_when_2_of_3_readings_complete(authz_context):
    c = authz_context
    intervention = _create_active_intervention(c, 2002)

    r1_cw, r1_as, _ = _create_reading(c, "Reading 1")
    r2_cw, r2_as, _ = _create_reading(c, "Reading 2")
    r3_cw, r3_as, _ = _create_reading(c, "Reading 3")

    q_cw, q_as, _ = _create_remedial_quiz(c, intervention)

    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r1_cw.classwork_id, reading_assignment_id=r1_as.classwork_assignment_id, display_order=1),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r2_cw.classwork_id, reading_assignment_id=r2_as.classwork_assignment_id, display_order=2),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r3_cw.classwork_id, reading_assignment_id=r3_as.classwork_assignment_id, display_order=3),
        ],
    )
    _complete_reading(c, r1_as)
    _complete_reading(c, r2_as)
    c["db"].commit()

    _act_as(c, "student", "student")
    url = f"/api/v1/quizzes/assignment/{q_as.classwork_assignment_id}/attempt"
    resp = c["client"].get(url)

    assert resp.status_code == 403
    data = resp.json()["detail"]
    assert data["code"] == "PREPARATION_REQUIRED"
    assert data["preparation"]["completed_count"] == 2
    assert data["preparation"]["required_count"] == 3
    assert data["preparation"]["is_satisfied"] is False
    assert data["preparation"]["state"] == "IN_PROGRESS"
    assert data["preparation"]["summary"] == "2 of 3 completed"


def test_remediation_quiz_read_allowed_when_3_of_3_readings_complete(authz_context):
    c = authz_context
    intervention = _create_active_intervention(c, 2003)

    r1_cw, r1_as, _ = _create_reading(c, "Reading 1")
    r2_cw, r2_as, _ = _create_reading(c, "Reading 2")
    r3_cw, r3_as, _ = _create_reading(c, "Reading 3")

    q_cw, q_as, _ = _create_remedial_quiz(c, intervention)

    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r1_cw.classwork_id, reading_assignment_id=r1_as.classwork_assignment_id, display_order=1),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r2_cw.classwork_id, reading_assignment_id=r2_as.classwork_assignment_id, display_order=2),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r3_cw.classwork_id, reading_assignment_id=r3_as.classwork_assignment_id, display_order=3),
        ],
    )
    _complete_reading(c, r1_as)
    _complete_reading(c, r2_as)
    _complete_reading(c, r3_as)
    c["db"].commit()

    _act_as(c, "student", "student")
    url = f"/api/v1/quizzes/assignment/{q_as.classwork_assignment_id}/attempt"
    resp = c["client"].get(url)

    assert resp.status_code == 200
    quiz_data = resp.json()
    assert "questions" in quiz_data
    assert len(quiz_data["questions"]) == 1
    assert "What is 2 + 2?" in quiz_data["questions"][0]["question_text"]


def test_remediation_classwork_read_blocked_when_0_of_3_and_2_of_3_readings_complete(authz_context):
    c = authz_context
    intervention = _create_active_intervention(c, 2004)

    r1_cw, r1_as, _ = _create_reading(c, "Reading 1")
    r2_cw, r2_as, _ = _create_reading(c, "Reading 2")
    r3_cw, r3_as, _ = _create_reading(c, "Reading 3")

    cw, cw_as, att = _create_remedial_classwork(c, intervention)

    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=cw_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r1_cw.classwork_id, reading_assignment_id=r1_as.classwork_assignment_id, display_order=1),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r2_cw.classwork_id, reading_assignment_id=r2_as.classwork_assignment_id, display_order=2),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r3_cw.classwork_id, reading_assignment_id=r3_as.classwork_assignment_id, display_order=3),
        ],
    )
    c["db"].commit()

    _act_as(c, "student", "student")

    # 0/3: Assignment detail endpoint blocked
    resp_assign = c["client"].get(f"/api/v1/classwork-assignments/assignment/{cw_as.classwork_assignment_id}")
    assert resp_assign.status_code == 403
    assert resp_assign.json()["detail"]["code"] == "PREPARATION_REQUIRED"

    # 0/3: Direct Classwork URL blocked
    resp_cw = c["client"].get(f"/api/v1/classwork-assignments/classwork/{cw.classwork_id}")
    assert resp_cw.status_code == 403
    assert resp_cw.json()["detail"]["code"] == "PREPARATION_REQUIRED"

    # 0/3: Attachment download blocked
    resp_att = c["client"].get(
        f"/api/v1/classwork-assignments/classwork/{cw.classwork_id}/attachments/{att.classwork_attachment_id}/download",
        headers=_bearer(c, "student", "student"),
    )
    assert resp_att.status_code == 403
    assert resp_att.json()["detail"]["code"] == "PREPARATION_REQUIRED"

    # Now complete 2/3 readings
    _complete_reading(c, r1_as)
    _complete_reading(c, r2_as)
    c["db"].commit()

    # 2/3: All three assessment surfaces remain blocked
    resp_assign_2 = c["client"].get(f"/api/v1/classwork-assignments/assignment/{cw_as.classwork_assignment_id}")
    assert resp_assign_2.status_code == 403
    assert resp_assign_2.json()["detail"]["code"] == "PREPARATION_REQUIRED"
    assert resp_assign_2.json()["detail"]["preparation"]["completed_count"] == 2
    assert resp_assign_2.json()["detail"]["preparation"]["required_count"] == 3

    resp_cw_2 = c["client"].get(f"/api/v1/classwork-assignments/classwork/{cw.classwork_id}")
    assert resp_cw_2.status_code == 403
    assert resp_cw_2.json()["detail"]["code"] == "PREPARATION_REQUIRED"

    resp_att_2 = c["client"].get(
        f"/api/v1/classwork-assignments/classwork/{cw.classwork_id}/attachments/{att.classwork_attachment_id}/download",
        headers=_bearer(c, "student", "student"),
    )
    assert resp_att_2.status_code == 403
    assert resp_att_2.json()["detail"]["code"] == "PREPARATION_REQUIRED"


def test_remediation_classwork_read_allowed_when_3_of_3_readings_complete(authz_context):
    c = authz_context
    intervention = _create_active_intervention(c, 2005)

    r1_cw, r1_as, _ = _create_reading(c, "Reading 1")
    r2_cw, r2_as, _ = _create_reading(c, "Reading 2")
    r3_cw, r3_as, _ = _create_reading(c, "Reading 3")

    cw, cw_as, att = _create_remedial_classwork(c, intervention)

    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=cw_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r1_cw.classwork_id, reading_assignment_id=r1_as.classwork_assignment_id, display_order=1),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r2_cw.classwork_id, reading_assignment_id=r2_as.classwork_assignment_id, display_order=2),
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r3_cw.classwork_id, reading_assignment_id=r3_as.classwork_assignment_id, display_order=3),
        ],
    )
    _complete_reading(c, r1_as)
    _complete_reading(c, r2_as)
    _complete_reading(c, r3_as)
    c["db"].commit()

    _act_as(c, "student", "student")

    # 3/3: Assignment detail returns 200 and reveals instructions
    resp_assign = c["client"].get(f"/api/v1/classwork-assignments/assignment/{cw_as.classwork_assignment_id}")
    assert resp_assign.status_code == 200
    assert "Secret Remedial Instructions" in resp_assign.json()["instructions"]

    # 3/3: Direct Classwork URL returns 200
    resp_cw = c["client"].get(f"/api/v1/classwork-assignments/classwork/{cw.classwork_id}")
    assert resp_cw.status_code == 200
    assert resp_cw.json()["classwork_id"] == cw.classwork_id

    # 3/3: Attachment download returns 200 and worksheet content
    resp_att = c["client"].get(
        f"/api/v1/classwork-assignments/classwork/{cw.classwork_id}/attachments/{att.classwork_attachment_id}/download",
        headers=_bearer(c, "student", "student"),
    )
    assert resp_att.status_code == 200
    assert b"Remedial assessment worksheet content" in resp_att.content


def test_direct_url_cannot_bypass_prerequisite_guard(authz_context):
    """Direct URL or API access to classwork or attachments cannot bypass the guard."""
    c = authz_context
    intervention = _create_active_intervention(c, 2006)

    r1_cw, r1_as, _ = _create_reading(c, "Reading 1")
    cw, cw_as, att = _create_remedial_classwork(c, intervention)

    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=cw_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r1_cw.classwork_id, reading_assignment_id=r1_as.classwork_assignment_id, display_order=1),
        ],
    )
    c["db"].commit()

    _act_as(c, "student", "student")

    # Attacking direct classwork URL without touching assignment endpoint
    resp_direct_cw = c["client"].get(f"/api/v1/classwork-assignments/classwork/{cw.classwork_id}")
    assert resp_direct_cw.status_code == 403
    assert resp_direct_cw.json()["detail"]["code"] == "PREPARATION_REQUIRED"

    # Attacking direct attachment download URL without touching assignment endpoint
    resp_direct_att = c["client"].get(
        f"/api/v1/classwork-assignments/classwork/{cw.classwork_id}/attachments/{att.classwork_attachment_id}/download",
        headers=_bearer(c, "student", "student"),
    )
    assert resp_direct_att.status_code == 403
    assert resp_direct_att.json()["detail"]["code"] == "PREPARATION_REQUIRED"


def test_wrong_student_denied_access(authz_context):
    """A non-recipient classmate cannot access remedial assessment content even if readings are complete."""
    c = authz_context
    # Enroll other_student into allowed_class
    other = c["db"].query(type(c["student"])).filter_by(user_id=c["accounts"]["other_student"].user_id).one()
    c["db"].query(StudentClass).filter_by(student_id=other.student_id).one().class_id = c["allowed_class"].class_id

    intervention = _create_active_intervention(c, 2007)
    r1_cw, r1_as, _ = _create_reading(c, "Reading 1")
    cw, cw_as, att = _create_remedial_classwork(c, intervention)
    q_cw, q_as, _ = _create_remedial_quiz(c, intervention)

    for as_id in (cw_as.classwork_assignment_id, q_as.classwork_assignment_id):
        stage_remediation_reading_prerequisites(
            c["db"],
            remediation_assignment_id=as_id,
            items=[
                ReadingPrerequisiteSnapshotItem(reading_classwork_id=r1_cw.classwork_id, reading_assignment_id=r1_as.classwork_assignment_id, display_order=1),
            ],
        )

    # Allowed student completes reading
    _complete_reading(c, r1_as)
    c["db"].commit()

    _act_as(c, "other_student", "student")

    # Denied on quiz attempt (not recipient)
    resp_q = c["client"].get(f"/api/v1/quizzes/assignment/{q_as.classwork_assignment_id}/attempt")
    assert resp_q.status_code in (403, 404)

    # Denied on assignment detail
    resp_assign = c["client"].get(f"/api/v1/classwork-assignments/assignment/{cw_as.classwork_assignment_id}")
    assert resp_assign.status_code == 403

    # Denied on classwork detail
    resp_cw = c["client"].get(f"/api/v1/classwork-assignments/classwork/{cw.classwork_id}")
    assert resp_cw.status_code == 403

    # Denied on attachment download
    resp_att = c["client"].get(
        f"/api/v1/classwork-assignments/classwork/{cw.classwork_id}/attachments/{att.classwork_attachment_id}/download",
        headers=_bearer(c, "other_student", "student"),
    )
    assert resp_att.status_code == 403


def test_ordinary_activities_and_supporting_readings_remain_unaffected(authz_context):
    """Ordinary activities and prerequisite Reading files remain fully accessible before preparation."""
    c = authz_context
    intervention = _create_active_intervention(c, 2008)

    # 1. Supporting Reading with PDF, DOCX, PPTX files
    r_cw, r_as, r_att_pdf = _create_reading(c, "Unit 1 Preparation Reading", file_name="notes.pdf", file_content=b"%PDF-1.4 reading material")
    # Add a PPTX attachment to the same reading
    pptx_path = c["tmp_path"] / f"{uuid4().hex}_slides.pptx"
    pptx_path.write_bytes(b"PK\x03\x04 PPTX slides content")
    r_att_pptx = ClassworkAttachment(
        classwork_id=r_cw.classwork_id,
        file_name="slides.pptx",
        file_path=str(pptx_path),
        file_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        file_size=len(b"PK\x03\x04 PPTX slides content"),
    )
    c["db"].add(r_att_pptx)
    c["db"].flush()

    # 2. Ordinary Quiz (non-remedial: source_intervention_id is None)
    ord_quiz_cw = Classwork(
        title="Ordinary Class Quiz",
        classwork_type="QUIZ",
        is_graded=True,
        total_points=Decimal("10"),
        is_published=True,
        is_archived=False,
        subject_id=c["subject"].subject_id,
        created_by_staff_id=c["owner"].staff_id,
    )
    c["db"].add(ord_quiz_cw)
    c["db"].flush()
    ord_quiz_as = ClassworkAssignment(
        classwork_id=ord_quiz_cw.classwork_id,
        class_id=c["allowed_class"].class_id,
        academic_period_id=c["period"].academic_period_id,
        assigned_by_staff_id=c["owner"].staff_id,
        is_published=True,
    )
    c["db"].add(ord_quiz_as)
    c["db"].flush()
    quiz = Quiz(classwork_id=ord_quiz_cw.classwork_id, total_items=1, status="PUBLISHED")
    c["db"].add(quiz)
    c["db"].add(QuizSetting(classwork_id=ord_quiz_cw.classwork_id, max_attempts=1))
    q = Question(question_text="Ordinary Question", question_type="MULTIPLE_CHOICE", points=Decimal("10"))
    c["db"].add(q)
    c["db"].flush()
    c["db"].add(QuizQuestion(quiz_id=quiz.quiz_id, question_id=q.question_id, display_order=1))
    c["db"].add(QuestionOption(question_id=q.question_id, option_text="A", is_correct=True, option_order=1))

    # 3. Remedial Quiz requiring the reading
    q_cw, q_as, _ = _create_remedial_quiz(c, intervention)
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=q_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r_cw.classwork_id, reading_assignment_id=r_as.classwork_assignment_id, display_order=1),
        ],
    )
    c["db"].commit()

    _act_as(c, "student", "student")

    # A. Supporting Reading files are completely downloadable by the student before completion
    resp_pdf = c["client"].get(
        f"/api/v1/classwork-assignments/classwork/{r_cw.classwork_id}/attachments/{r_att_pdf.classwork_attachment_id}/download",
        headers=_bearer(c, "student", "student"),
    )
    assert resp_pdf.status_code == 200
    assert b"%PDF-1.4 reading material" in resp_pdf.content

    resp_pptx = c["client"].get(
        f"/api/v1/classwork-assignments/classwork/{r_cw.classwork_id}/attachments/{r_att_pptx.classwork_attachment_id}/download",
        headers=_bearer(c, "student", "student"),
    )
    assert resp_pptx.status_code == 200
    assert b"PPTX slides content" in resp_pptx.content

    # B. Ordinary quiz attempt is accessible without any prerequisite block
    resp_ord_quiz = c["client"].get(f"/api/v1/quizzes/assignment/{ord_quiz_as.classwork_assignment_id}/attempt")
    assert resp_ord_quiz.status_code == 200
    assert "Ordinary Question" in resp_ord_quiz.json()["questions"][0]["question_text"]

    # C. Meanwhile remedial quiz remains blocked
    resp_rem_quiz = c["client"].get(f"/api/v1/quizzes/assignment/{q_as.classwork_assignment_id}/attempt")
    assert resp_rem_quiz.status_code == 403

    # D. Teacher access to remedial content is completely unaffected
    _act_as(c, "owner", "teacher")
    resp_teacher_cw = c["client"].get(f"/api/v1/classwork-assignments/classwork/{q_cw.classwork_id}")
    assert resp_teacher_cw.status_code == 200
    resp_teacher_assign = c["client"].get(f"/api/v1/classwork-assignments/assignment/{q_as.classwork_assignment_id}")
    assert resp_teacher_assign.status_code == 200


def test_historical_unsnapshotted_remediation_denied(authz_context):
    """Historical remediation without an immutable snapshot must remain blocked."""
    c = authz_context
    intervention = _create_active_intervention(c, 2009)

    cw, cw_as, att = _create_remedial_classwork(c, intervention, title="Historical Unsnapshotted Remediation")
    q_cw, q_as, _ = _create_remedial_quiz(c, intervention, title="Historical Unsnapshotted Quiz")
    # DO NOT stage any snapshots for these assignments
    c["db"].commit()

    _act_as(c, "student", "student")

    # Blocked on Quiz attempt
    resp_quiz = c["client"].get(f"/api/v1/quizzes/assignment/{q_as.classwork_assignment_id}/attempt")
    assert resp_quiz.status_code == 403
    assert resp_quiz.json()["detail"]["code"] == "PREREQUISITE_SNAPSHOT_MISSING"

    # Blocked on Classwork assignment detail
    resp_assign = c["client"].get(f"/api/v1/classwork-assignments/assignment/{cw_as.classwork_assignment_id}")
    assert resp_assign.status_code == 403
    assert resp_assign.json()["detail"]["code"] == "PREREQUISITE_SNAPSHOT_MISSING"

    # Blocked on Classwork detail
    resp_cw = c["client"].get(f"/api/v1/classwork-assignments/classwork/{cw.classwork_id}")
    assert resp_cw.status_code == 403
    assert resp_cw.json()["detail"]["code"] == "PREREQUISITE_SNAPSHOT_MISSING"

    # Blocked on Classwork attachment download
    resp_att = c["client"].get(
        f"/api/v1/classwork-assignments/classwork/{cw.classwork_id}/attachments/{att.classwork_attachment_id}/download",
        headers=_bearer(c, "student", "student"),
    )
    assert resp_att.status_code == 403
    assert resp_att.json()["detail"]["code"] == "PREREQUISITE_SNAPSHOT_MISSING"


def test_study_support_locked_metadata_remains_available(authz_context):
    """Harmless locked-activity metadata remains available for Study Support."""
    c = authz_context
    intervention = _create_active_intervention(c, 2010)

    r1_cw, r1_as, _ = _create_reading(c, "Reading 1")
    cw, cw_as, _ = _create_remedial_classwork(c, intervention, title="Locked Classwork For Study Support")
    stage_remediation_reading_prerequisites(
        c["db"],
        remediation_assignment_id=cw_as.classwork_assignment_id,
        items=[
            ReadingPrerequisiteSnapshotItem(reading_classwork_id=r1_cw.classwork_id, reading_assignment_id=r1_as.classwork_assignment_id, display_order=1),
        ],
    )
    c["db"].commit()

    # Query Study Support active list as the student
    active_interventions = list_active(c["db"], c["student"].student_id)
    assert active_interventions is not None
    assert len(active_interventions.items) >= 1

    matching = next(
        (interv for interv in active_interventions.items if interv.intervention_id == intervention.intervention_id),
        None,
    )
    assert matching is not None
    assert len(matching.activities) == 1
    activity = matching.activities[0]

    # Harmless metadata is available
    assert activity.assignment_id == cw_as.classwork_assignment_id
    assert activity.title == "Locked Classwork For Study Support"
    assert activity.access_state == "PREPARATION_REQUIRED"
    assert activity.access_enforced is True
    assert activity.classwork_type == "ASSIGNMENT"
    # Notice: Assessment instructions are NOT leaked in Study Support metadata
    assert not hasattr(activity, "instructions") or activity.instructions is None

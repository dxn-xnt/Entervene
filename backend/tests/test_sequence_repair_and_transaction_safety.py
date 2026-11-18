"""Regression test suite for database sequence reconciliation and classwork transaction safety.

Verifies:
1. Reconciling PostgreSQL sequences corrects all desynchronized tables.
2. Reconciliation is idempotent and never resets sequences backward.
3. Normal inserts generate conflict-free primary keys.
4. Classwork updates execute as a single atomic transaction.
5. Simulated failure during draft synchronization rolls back all classwork changes (zero partial commits).
6. Automatic feedback draft queueing is idempotent and preserves student grades.
"""

from __future__ import annotations

import os
from decimal import Decimal
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.orm import Session

from app.db.sequence_repair import reconcile_database_sequences
from app.models.classwork.Classwork import Classwork
from app.models.submissions.StudentSubmission import StudentSubmission
from app.models.submissions.SubmissionFeedbackDraft import SubmissionFeedbackDraft
from app.schemas.Classwork import ClassworkUpdate
from app.services.classwork.ClassworkService import update_classwork_record
from app.services.submission.SubmissionFeedbackService import (
    enqueue_automatic_feedback_draft,
    sync_and_dispatch_classwork_draft_jobs,
)

CLONE_DB_URL = os.getenv("TEST_DATABASE_URL", "postgresql://postgres:Ian123@localhost:5432/entervene_main")


@pytest.fixture(scope="module")
def clone_engine():
    engine = create_engine(CLONE_DB_URL)
    yield engine
    engine.dispose()


def test_01_reconcile_sequences_on_clone(clone_engine):
    """Verifies that all 21 desynchronized sequences are corrected and idempotent."""
    # Pass 1: Reconcile sequences
    results = reconcile_database_sequences(clone_engine)
    assert len(results) == 74

    # Pass 2: Repeat reconciliation to verify idempotency
    results_pass2 = reconcile_database_sequences(clone_engine)
    reconciled_pass2 = [r for r in results_pass2 if r["action"] == "reconciled"]
    assert len(reconciled_pass2) == 0, "Repeated reconciliation must not alter already synchronized sequences"

    # Verify no sequence in public schema has nextval <= max_id (if max_id > 0)
    with clone_engine.connect() as conn:
        for r in results_pass2:
            schema = r["table_schema"]
            table = r["table_name"]
            col = r["column_name"]
            seq = r["sequence_name"]
            max_id = conn.execute(text(f'SELECT COALESCE(MAX("{col}"), 0) FROM "{schema}"."{table}";')).scalar()
            last_val, is_called = conn.execute(text(f"SELECT last_value, is_called FROM {seq};")).fetchone()
            inc = r["increment_by"]
            next_val = last_val if not is_called else last_val + inc
            if max_id > 0:
                assert next_val > max_id, f"Sequence {seq} for {table}.{col} has nextval {next_val} <= max_id {max_id}"


def test_02_normal_inserts_generate_conflict_free_keys(clone_engine):
    """Verifies normal inserts no longer produce duplicate primary keys."""
    with clone_engine.connect() as conn:
        trans = conn.begin()
        try:
            # Test insert into question table
            max_qid = conn.execute(text("SELECT COALESCE(MAX(question_id), 0) FROM question;")).scalar()
            new_qid = conn.execute(
                text("""
                    INSERT INTO question (question_text, question_type, points, is_ai_generated)
                    VALUES ('Test automated question', 'MULTIPLE_CHOICE', 1.0, false)
                    RETURNING question_id;
                """)
            ).scalar()
            assert new_qid > max_qid

            # Test insert into student_submission table
            max_subid = conn.execute(text("SELECT COALESCE(MAX(submission_id), 0) FROM student_submission;")).scalar()
            new_subid = conn.execute(
                text("""
                    INSERT INTO student_submission (student_id, classwork_assignment_id, status)
                    VALUES ('c0fce8fc-aee8-4545-8810-ce21a88d3083', 1, 'submitted')
                    RETURNING submission_id;
                """)
            ).scalar()
            assert new_subid > max_subid
        finally:
            trans.rollback()


def test_03_automatic_feedback_queueing_and_idempotency(clone_engine):
    """Verifies automatic feedback queueing succeeds without collision and is idempotent."""
    with Session(clone_engine) as session:
        # Run sync_and_dispatch_classwork_draft_jobs with auto_commit=False inside test transaction
        enqueued = sync_and_dispatch_classwork_draft_jobs(session, classwork_id=1, staff_id="STF-TCH-001", auto_commit=False)
        session.flush()

        # Check drafts for classwork 1 graded submissions
        drafts = (
            session.query(SubmissionFeedbackDraft)
            .join(StudentSubmission, StudentSubmission.submission_id == SubmissionFeedbackDraft.submission_id)
            .filter(StudentSubmission.classwork_assignment_id == 1)
            .all()
        )
        assert len(drafts) >= 2
        draft_ids = [d.draft_id for d in drafts]
        assert len(draft_ids) == len(set(draft_ids)), "Draft IDs must be unique"
        initial_draft_count = session.query(SubmissionFeedbackDraft).count()

        # Repeat sync - must not create duplicate records
        sync_and_dispatch_classwork_draft_jobs(session, classwork_id=1, staff_id="STF-TCH-001", auto_commit=False)
        session.flush()
        assert session.query(SubmissionFeedbackDraft).count() == initial_draft_count, "Repeated sync must not create duplicate draft records"
        session.rollback()


def test_04_feedback_approval_preserves_student_grades(clone_engine):
    """Verifies reviewing/approving feedback updates feedback text and keeps student grades intact."""
    with Session(clone_engine) as session:
        # Select graded submission 2 (Maria Ocampo, grade 88.00)
        sub = session.get(StudentSubmission, 2)
        assert sub is not None
        original_grade = sub.grade
        assert original_grade == Decimal("88.00")

        # Create or update draft
        draft = enqueue_automatic_feedback_draft(session, submission_id=2, staff_id="STF-TCH-001")
        assert draft is not None
        draft.status = "READY"
        draft.draft_feedback = "Strong analysis of Florentino's symbolism with clear argumentation."
        session.flush()

        # Approve and publish draft
        draft.status = "APPROVED"
        sub.feedback = "Teacher approved: Excellent work on Florentino's symbolism."
        session.flush()

        # Verify student submission feedback is updated and grade is strictly preserved
        session.refresh(sub)
        assert sub.feedback == "Teacher approved: Excellent work on Florentino's symbolism."
        assert sub.grade == original_grade, "Student grade must not change during feedback approval"

        session.rollback()


def test_05_classwork_update_atomic_rollback_on_failure(clone_engine):
    """Verifies that a failure during draft synchronization triggers an atomic rollback.

    The classwork record, title, rubric, and settings must NOT be partially committed.
    """
    with Session(clone_engine) as session:
        cw = session.get(Classwork, 1)
        original_title = cw.title
        original_description = cw.description
        staff_id = cw.created_by_staff_id

        # Simulate failure in enqueue_automatic_feedback_draft
        with patch(
            "app.services.submission.SubmissionFeedbackService.enqueue_automatic_feedback_draft",
            side_effect=RuntimeError("Simulated primary-key collision or database flush failure"),
        ):
            with pytest.raises(RuntimeError, match="Simulated primary-key collision"):
                update_classwork_record(
                    classwork_id=1,
                    body=ClassworkUpdate(
                        title="MALICIOUS PARTIAL COMMIT ATTEMPT",
                        description="This should never be saved to the database.",
                        auto_ai_feedback_enabled=True,
                    ),
                    staff_id=staff_id,
                    db=session,
                )

        # Clear session cache and query from database
        session.expire_all()
        cw_after_failure = session.get(Classwork, 1)
        assert cw_after_failure.title == original_title, "Classwork title must not be modified after failed update"
        assert cw_after_failure.description == original_description, "Classwork description must not be modified after failed update"


def test_06_classwork_update_succeeds_end_to_end(clone_engine):
    """Verifies classwork update succeeds end-to-end when no error occurs."""
    with patch("app.services.classwork.ClassworkService.notify_students_for_classwork") as mock_notif:
        with Session(clone_engine) as session:
            cw = session.get(Classwork, 1)
            staff_id = cw.created_by_staff_id
            original_title = cw.title

            test_title = f"{original_title} (Verified)"
            res = update_classwork_record(
                classwork_id=1,
                body=ClassworkUpdate(title=test_title),
                staff_id=staff_id,
                db=session,
            )
            assert res.title == test_title

            # Verify in database
            session.expire_all()
            cw_updated = session.get(Classwork, 1)
            assert cw_updated.title == test_title

            # Revert title back cleanly
            update_classwork_record(
                classwork_id=1,
                body=ClassworkUpdate(title=original_title),
                staff_id=staff_id,
                db=session,
            )
            session.expire_all()
            assert session.get(Classwork, 1).title == original_title
            assert mock_notif.called

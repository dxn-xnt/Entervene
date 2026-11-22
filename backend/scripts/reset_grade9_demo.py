"""
reset_grade9_demo.py
====================
Transactional, dependency-safe, dry-run-by-default reset of ALL Grade 9 sections
and Grade 9 operational data across all academic years.

Preserves:
- Grade 9 academic_level, subject catalog, subject_offering, subject_offering_pathway,
  competency definitions, grading_template & grading_template_component
- Academic years, academic periods, passing policies, risk thresholds, global settings
- All academic_staff (teacher/admin) accounts and profiles
- Shared student accounts still needed by other grade levels
- All other grade levels (Grades 7, 8, 10, 11, 12) and every record belonging to them

Deletes (strictly via FK-ordered DELETE statements; never TRUNCATE CASCADE or FK disable):
- All Grade 9 official_section and class rows across all academic years
- All Grade 9 subject_load and teacher-to-class assignments
- All Grade 9 enrollments (student_class), Grade 9-only student rows, and eligible
  pure-student user accounts (+ user_roles, user_login_log, invitation_token)
- All Grade 9 lessons, lesson deliveries/assignments/goals/plans
- All Grade 9 classworks, quizzes, questions, options, rubrics, attachments, links, assignments
- All Grade 9 submissions, quiz answers, scores, grades, attendance
- All Grade 9 predictions, risk reviews, suggestions, interventions, practice assessments,
  remediation links, reading prerequisites, reading reviews, and Grade 9-specific notifications

Usage:
  Dry run (default - runs inside transaction and rolls back):
    python scripts/reset_grade9_demo.py --database-url <URL>

  Apply (commits atomically inside a single transaction):
    python scripts/reset_grade9_demo.py --database-url <URL> --apply --snapshot-out <backup.json>
"""

from __future__ import annotations

import argparse
import datetime
import decimal
import json
import os
import sys
import uuid
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Connection

if sys.stdout.encoding != "utf-8":
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv

load_dotenv(BACKEND_DIR.parent / ".env")
load_dotenv(BACKEND_DIR / ".env")


def _json_default(obj: Any) -> Any:
    if isinstance(obj, (datetime.datetime, datetime.date)):
        return obj.isoformat()
    if isinstance(obj, decimal.Decimal):
        return str(obj)
    if isinstance(obj, uuid.UUID):
        return str(obj)
    return str(obj)


def _existing_tables(conn: Connection) -> set[str]:
    return {
        r[0]
        for r in conn.execute(
            text(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
            )
        ).fetchall()
    }


def _collect_grade9_scope(conn: Connection, tables: set[str]) -> dict[str, Any]:
    g9_levels = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT academic_level_id FROM academic_level "
                "WHERE grade_level = 9 OR lower(level_name) LIKE '%grade 9%' "
                "ORDER BY academic_level_id"
            )
        ).fetchall()
    ]
    if not g9_levels:
        raise RuntimeError("Grade 9 academic_level not found; aborting.")

    g9_sections = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT id FROM official_section "
                "WHERE academic_level_id = ANY(:lids) ORDER BY id"
            ),
            {"lids": g9_levels},
        ).fetchall()
    ]
    g9_classes = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT class_id FROM class "
                "WHERE academic_level_id = ANY(:lids) ORDER BY class_id"
            ),
            {"lids": g9_levels},
        ).fetchall()
    ]
    g9_section_names = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT DISTINCT section_name FROM ("
                "  SELECT section_name FROM official_section WHERE academic_level_id = ANY(:lids)"
                "  UNION "
                "  SELECT section_name FROM class WHERE academic_level_id = ANY(:lids)"
                ") t ORDER BY section_name"
            ),
            {"lids": g9_levels},
        ).fetchall()
    ]
    g9_subjects = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT subject_id FROM subject "
                "WHERE academic_level_id = ANY(:lids) ORDER BY subject_id"
            ),
            {"lids": g9_levels},
        ).fetchall()
    ]
    g9_subject_names = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT subject_name FROM subject "
                "WHERE subject_id = ANY(:sids) ORDER BY subject_id"
            ),
            {"sids": g9_subjects},
        ).fetchall()
    ]

    # Safety check: verify no Grade 9 subject is used by non-Grade-9 classes or offerings
    non_g9_subject_usage = conn.execute(
        text(
            "SELECT COUNT(*) FROM subject_load "
            "WHERE subject_id = ANY(:sids) AND NOT (class_id = ANY(:cids))"
        ),
        {"sids": g9_subjects, "cids": g9_classes},
    ).scalar()
    if non_g9_subject_usage:
        raise RuntimeError(
            f"Safety abort: {non_g9_subject_usage} non-Grade-9 subject_load rows reference Grade 9 subjects."
        )

    g9_loads = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT subject_load_id FROM subject_load "
                "WHERE class_id = ANY(:cids) OR subject_id = ANY(:sids) "
                "ORDER BY subject_load_id"
            ),
            {"cids": g9_classes, "sids": g9_subjects},
        ).fetchall()
    ]
    g9_lessons = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT lesson_id FROM lesson "
                "WHERE subject_id = ANY(:sids) ORDER BY lesson_id"
            ),
            {"sids": g9_subjects},
        ).fetchall()
    ]
    g9_cws = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT classwork_id FROM classwork "
                "WHERE subject_id = ANY(:sids) ORDER BY classwork_id"
            ),
            {"sids": g9_subjects},
        ).fetchall()
    ]
    # Safety check: verify no Grade 9 classwork is assigned to a non-Grade-9 class
    cross_cw_asgns = conn.execute(
        text(
            "SELECT COUNT(*) FROM classwork_assignment "
            "WHERE classwork_id = ANY(:cwids) AND NOT (class_id = ANY(:cids))"
        ),
        {"cwids": g9_cws, "cids": g9_classes},
    ).scalar()
    if cross_cw_asgns:
        raise RuntimeError(
            f"Safety abort: {cross_cw_asgns} Grade 9 classwork_assignment rows point to non-Grade-9 classes."
        )

    g9_asgns = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT classwork_assignment_id FROM classwork_assignment "
                "WHERE class_id = ANY(:cids) OR classwork_id = ANY(:cwids) "
                "ORDER BY classwork_assignment_id"
            ),
            {"cids": g9_classes, "cwids": g9_cws},
        ).fetchall()
    ]
    g9_quizzes = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT quiz_id FROM quiz WHERE classwork_id = ANY(:cwids) ORDER BY quiz_id"
            ),
            {"cwids": g9_cws},
        ).fetchall()
    ]
    g9_qqs = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT quiz_question_id FROM quiz_question WHERE quiz_id = ANY(:qids) ORDER BY quiz_question_id"
            ),
            {"qids": g9_quizzes},
        ).fetchall()
    ]
    candidate_questions = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT DISTINCT question_id FROM quiz_question WHERE quiz_id = ANY(:qids) "
                "UNION "
                "SELECT question_id FROM question WHERE lesson_id = ANY(:lids)"
            ),
            {"qids": g9_quizzes, "lids": g9_lessons},
        ).fetchall()
    ]
    # Only delete questions NOT shared by any non-Grade-9 quiz
    shared_questions = {
        r[0]
        for r in conn.execute(
            text(
                "SELECT DISTINCT question_id FROM quiz_question "
                "WHERE question_id = ANY(:qns) AND NOT (quiz_id = ANY(:qids))"
            ),
            {"qns": candidate_questions, "qids": g9_quizzes},
        ).fetchall()
    }
    g9_questions = sorted(q for q in candidate_questions if q not in shared_questions)

    g9_intervs = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT intervention_id FROM intervention "
                "WHERE class_id = ANY(:cids) OR subject_id = ANY(:sids) "
                "ORDER BY intervention_id"
            ),
            {"cids": g9_classes, "sids": g9_subjects},
        ).fetchall()
    ]
    g9_pas = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT practice_assessment_id FROM practice_assessment "
                "WHERE intervention_id = ANY(:iids) ORDER BY practice_assessment_id"
            ),
            {"iids": g9_intervs},
        ).fetchall()
    ]
    g9_patts = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT attempt_id FROM practice_attempt "
                "WHERE practice_assessment_id = ANY(:pas) ORDER BY attempt_id"
            ),
            {"pas": g9_pas},
        ).fetchall()
    ]
    g9_pqs = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT practice_question_id FROM practice_question "
                "WHERE practice_assessment_id = ANY(:pas) ORDER BY practice_question_id"
            ),
            {"pas": g9_pas},
        ).fetchall()
    ]
    g9_dev_preds = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT prediction_id FROM development_current_term_prediction "
                "WHERE class_id = ANY(:cids) OR subject_id = ANY(:sids) "
                "ORDER BY prediction_id"
            ),
            {"cids": g9_classes, "sids": g9_subjects},
        ).fetchall()
    ]
    g9_ai_preds = (
        [
            r[0]
            for r in conn.execute(
                text(
                    "SELECT prediction_id FROM ai_prediction "
                    "WHERE class_id = ANY(:cids) OR subject_id = ANY(:sids) "
                    "ORDER BY prediction_id"
                ),
                {"cids": g9_classes, "sids": g9_subjects},
            ).fetchall()
        ]
        if "ai_prediction" in tables
        else []
    )
    g9_assessments = (
        [
            r[0]
            for r in conn.execute(
                text(
                    "SELECT assessment_id FROM assessment_item "
                    "WHERE class_id = ANY(:cids) OR subject_id = ANY(:sids)"
                ),
                {"cids": g9_classes, "sids": g9_subjects},
            ).fetchall()
        ]
        if "assessment_item" in tables
        else []
    )
    g9_suggestions = (
        [
            r[0]
            for r in conn.execute(
                text(
                    "SELECT student_suggestion_id FROM student_suggestion "
                    "WHERE origin_class_id = ANY(:cids) OR subject_id = ANY(:sids) OR lesson_id = ANY(:lids)"
                ),
                {"cids": g9_classes, "sids": g9_subjects, "lids": g9_lessons},
            ).fetchall()
        ]
        if "student_suggestion" in tables
        else []
    )
    g9_goals = (
        [
            r[0]
            for r in conn.execute(
                text(
                    "SELECT goal_id FROM lesson_goal "
                    "WHERE class_id = ANY(:cids) OR subject_id = ANY(:sids)"
                ),
                {"cids": g9_classes, "sids": g9_subjects},
            ).fetchall()
        ]
        if "lesson_goal" in tables
        else []
    )
    g9_tos = (
        [
            r[0]
            for r in conn.execute(
                text("SELECT tos_exam_id FROM tos_exam WHERE subject_id = ANY(:sids)"),
                {"sids": g9_subjects},
            ).fetchall()
        ]
        if "tos_exam" in tables
        else []
    )
    g9_share_reqs = (
        [
            r[0]
            for r in conn.execute(
                text(
                    "SELECT request_id FROM content_share_request "
                    "WHERE destination_class_id = ANY(:cids) "
                    "   OR destination_subject_id = ANY(:sids) "
                    "   OR subject_id = ANY(:sids)"
                ),
                {"cids": g9_classes, "sids": g9_subjects},
            ).fetchall()
        ]
        if "content_share_request" in tables
        else []
    )
    g9_clone_ops = (
        [
            r[0]
            for r in conn.execute(
                text(
                    "SELECT operation_id FROM content_clone_operation "
                    "WHERE destination_class_id = ANY(:cids) "
                    "   OR destination_subject_id = ANY(:sids) "
                    "   OR request_id = ANY(:rids)"
                ),
                {"cids": g9_classes, "sids": g9_subjects, "rids": g9_share_reqs},
            ).fetchall()
        ]
        if "content_clone_operation" in tables
        else []
    )

    # Students: enrolled in G9 class OR having academic_level_id in G9
    g9_enrolled_sids = {
        str(r[0])
        for r in conn.execute(
            text("SELECT DISTINCT student_id FROM student_class WHERE class_id = ANY(:cids)"),
            {"cids": g9_classes},
        ).fetchall()
    }
    g9_level_sids = {
        str(r[0])
        for r in conn.execute(
            text("SELECT student_id FROM student WHERE academic_level_id = ANY(:lids)"),
            {"lids": g9_levels},
        ).fetchall()
    }
    candidate_sids = sorted(g9_enrolled_sids | g9_level_sids)

    # Exclude any student still needed by another grade level!
    non_g9_sids: set[str] = {
        str(r[0])
        for r in conn.execute(
            text(
                "SELECT DISTINCT student_id FROM student_class "
                "WHERE NOT (class_id = ANY(:cids))"
            ),
            {"cids": g9_classes},
        ).fetchall()
    }
    for tbl, where_sql, params in [
        ("student_submission", "NOT (classwork_assignment_id = ANY(:aids))", {"aids": g9_asgns}),
        ("student_period_grade", "NOT (class_id = ANY(:cids))", {"cids": g9_classes}),
        ("grade_submission_log", "NOT (class_id = ANY(:cids))", {"cids": g9_classes}),
        ("attendance_record", "NOT (class_id = ANY(:cids))", {"cids": g9_classes}),
        ("intervention", "NOT (intervention_id = ANY(:iids))", {"iids": g9_intervs}),
        ("development_current_term_prediction", "NOT (prediction_id = ANY(:pids))", {"pids": g9_dev_preds}),
        ("ai_prediction", "NOT (prediction_id = ANY(:pids))", {"pids": g9_ai_preds}),
    ]:
        if tbl in tables and candidate_sids:
            rows = conn.execute(
                text(
                    f'SELECT DISTINCT student_id FROM "{tbl}" '
                    f"WHERE student_id::text = ANY(:cand) AND ({where_sql})"
                ),
                {"cand": candidate_sids, **params},
            ).fetchall()
            non_g9_sids.update(str(r[0]) for r in rows)

    shared_sids = sorted(s for s in candidate_sids if s in non_g9_sids)
    eligible_sids = sorted(s for s in candidate_sids if s not in non_g9_sids)

    # Eligible pure-student user_accounts (NEVER teachers, admins, or accounts referenced by other records)
    eligible_uids = [
        str(r[0])
        for r in conn.execute(
            text(
                """
                SELECT DISTINCT st.user_id
                FROM student st
                JOIN user_account ua ON ua.user_id = st.user_id
                WHERE st.student_id::text = ANY(:sids)
                  AND st.user_id IS NOT NULL
                  AND NOT EXISTS (SELECT 1 FROM academic_staff a WHERE a.user_id = ua.user_id)
                  AND NOT EXISTS (
                      SELECT 1 FROM student st2
                      WHERE st2.user_id = ua.user_id
                        AND NOT (st2.student_id::text = ANY(:sids))
                  )
                  AND NOT EXISTS (
                      SELECT 1 FROM user_roles ur
                      JOIN role r ON r.role_id = ur.role_id
                      WHERE ur.user_id = ua.user_id AND lower(r.role_name) <> 'student'
                  )
                  AND NOT EXISTS (SELECT 1 FROM academic_year_passing_policy p WHERE p.updated_by = ua.user_id)
                  AND NOT EXISTS (SELECT 1 FROM passing_policy_audit p WHERE p.actor_user_id = ua.user_id)
                  AND NOT EXISTS (SELECT 1 FROM setting s WHERE s.updated_by = ua.user_id)
                ORDER BY st.user_id
                """
            ),
            {"sids": eligible_sids},
        ).fetchall()
    ]

    g9_subs = [
        r[0]
        for r in conn.execute(
            text(
                "SELECT submission_id FROM student_submission "
                "WHERE classwork_assignment_id = ANY(:aids) "
                "   OR student_id::text = ANY(:sids) "
                "ORDER BY submission_id"
            ),
            {"aids": g9_asgns, "sids": eligible_sids},
        ).fetchall()
    ]

    # Grade 9-specific notifications (all notifications for eligible G9 students + teacher/other notifications pointing to G9 entities)
    g9_notif_ids: list[str] = []
    if "notification" in tables:
        all_notifs = conn.execute(
            text("SELECT notification_id, user_id, title, body, action_url FROM notification")
        ).fetchall()
        uid_set = set(eligible_uids)
        subj_names_low = [s.lower() for s in g9_subject_names if s]
        sec_names_low = [s.lower() for s in g9_section_names if s]
        for nid, uid, title, body, url in all_notifs:
            if str(uid) in uid_set:
                g9_notif_ids.append(str(nid))
                continue
            t_low = (title or "").lower()
            b_low = (body or "").lower()
            u_low = (url or "").lower()
            matched = False
            for iid in g9_intervs:
                if (
                    f"active={iid}" in u_low
                    or f"candidate={iid}" in u_low
                    or f"resolved={iid}" in u_low
                    or f"intervention={iid}" in u_low
                    or f"intervention_id={iid}" in u_low
                ):
                    matched = True
            for cid in g9_classes:
                if f"/subjects/{cid}/" in u_low or f"/classes/{cid}" in u_low:
                    matched = True
            for cwid in g9_cws:
                if f"/classworks/{cwid}" in u_low:
                    matched = True
            for aid in g9_asgns:
                if f"classworkassignmentid={aid}" in u_low or f"assignment_id={aid}" in u_low:
                    matched = True
            for sname in subj_names_low:
                if sname in t_low or sname in b_low:
                    matched = True
            for sec in sec_names_low:
                if sec in t_low or sec in b_low:
                    matched = True
            if matched:
                g9_notif_ids.append(str(nid))

    return {
        "academic_level_ids": g9_levels,
        "official_section_ids": g9_sections,
        "section_names": g9_section_names,
        "class_ids": g9_classes,
        "subject_ids": g9_subjects,
        "subject_names": g9_subject_names,
        "subject_load_ids": g9_loads,
        "lesson_ids": g9_lessons,
        "classwork_ids": g9_cws,
        "classwork_assignment_ids": g9_asgns,
        "quiz_ids": g9_quizzes,
        "quiz_question_ids": g9_qqs,
        "question_ids": g9_questions,
        "shared_question_ids": sorted(shared_questions),
        "submission_ids": g9_subs,
        "intervention_ids": g9_intervs,
        "practice_assessment_ids": g9_pas,
        "practice_attempt_ids": g9_patts,
        "practice_question_ids": g9_pqs,
        "dev_prediction_ids": g9_dev_preds,
        "ai_prediction_ids": g9_ai_preds,
        "assessment_ids": g9_assessments,
        "suggestion_ids": g9_suggestions,
        "lesson_goal_ids": g9_goals,
        "tos_exam_ids": g9_tos,
        "share_request_ids": g9_share_reqs,
        "clone_operation_ids": g9_clone_ops,
        "shared_student_ids": shared_sids,
        "eligible_student_ids": eligible_sids,
        "eligible_user_ids": eligible_uids,
        "notification_ids": sorted(set(g9_notif_ids)),
    }


def _deletion_steps(scope: dict[str, Any]) -> list[tuple[str, str, str, dict[str, Any]]]:
    """Return ordered list of (table_name, action_kind, sql_where_or_stmt, params)."""
    cids = scope["class_ids"]
    sids = scope["subject_ids"]
    slids = scope["subject_load_ids"]
    lids = scope["lesson_ids"]
    cwids = scope["classwork_ids"]
    aids = scope["classwork_assignment_ids"]
    qids = scope["quiz_ids"]
    qqs = scope["quiz_question_ids"]
    qns = scope["question_ids"]
    subs = scope["submission_ids"]
    iids = scope["intervention_ids"]
    pas = scope["practice_assessment_ids"]
    patts = scope["practice_attempt_ids"]
    pqs = scope["practice_question_ids"]
    dev_preds = scope["dev_prediction_ids"]
    ai_preds = scope["ai_prediction_ids"]
    assess = scope["assessment_ids"]
    suggs = scope["suggestion_ids"]
    goals = scope["lesson_goal_ids"]
    tos = scope["tos_exam_ids"]
    sreqs = scope["share_request_ids"]
    cops = scope["clone_operation_ids"]
    stids = scope["eligible_student_ids"]
    uids = scope["eligible_user_ids"]
    nids = scope["notification_ids"]
    osids = scope["official_section_ids"]

    return [
        # 1. Practice Assessment tree
        ("practice_attempt_answer", "DELETE", "attempt_id = ANY(:patts)", {"patts": patts}),
        ("practice_attempt", "DELETE", "practice_assessment_id = ANY(:pas) OR student_id::text = ANY(:stids)", {"pas": pas, "stids": stids}),
        ("practice_question_option", "DELETE", "practice_question_id = ANY(:pqs)", {"pqs": pqs}),
        ("practice_question", "DELETE", "practice_assessment_id = ANY(:pas)", {"pas": pas}),
        ("practice_assessment", "DELETE", "intervention_id = ANY(:iids)", {"iids": iids}),

        # 2. Intervention & Remediation RESTRICT dependents
        ("intervention_reading_review", "DELETE", "intervention_id = ANY(:iids) OR reading_assignment_id = ANY(:aids) OR student_id::text = ANY(:stids)", {"iids": iids, "aids": aids, "stids": stids}),
        ("intervention_support_material", "DELETE", "intervention_id = ANY(:iids)", {"iids": iids}),
        ("remediation_generation_evidence_snapshot", "DELETE", "intervention_id = ANY(:iids)", {"iids": iids}),
        ("remediation_reading_prerequisite", "DELETE", "remediation_assignment_id = ANY(:aids) OR reading_assignment_id = ANY(:aids) OR reading_classwork_id = ANY(:cwids)", {"aids": aids, "cwids": cwids}),
        ("remediation_assignment_link", "DELETE", "source_intervention_id = ANY(:iids) OR original_assignment_id = ANY(:aids) OR remediation_assignment_id = ANY(:aids) OR student_id::text = ANY(:stids)", {"iids": iids, "aids": aids, "stids": stids}),

        # 3. Submissions & Quiz Answers
        ("quiz_answer", "DELETE", "submission_id = ANY(:subs) OR quiz_question_id = ANY(:qqs)", {"subs": subs, "qqs": qqs}),
        ("submission_attachment", "DELETE", "submission_id = ANY(:subs)", {"subs": subs}),
        ("submission_feedback_draft", "DELETE", "submission_id = ANY(:subs)", {"subs": subs}),
        ("submission_link", "DELETE", "submission_id = ANY(:subs)", {"subs": subs}),
        ("student_submission", "DELETE", "submission_id = ANY(:subs)", {"subs": subs}),

        # 4. Suggestions & Legacy AI Predictions
        ("suggestion_classwork", "DELETE", "student_suggestion_id = ANY(:suggs) OR classwork_assignment_id = ANY(:aids)", {"suggs": suggs, "aids": aids}),
        ("student_suggestion", "DELETE", "student_suggestion_id = ANY(:suggs) OR student_id::text = ANY(:stids)", {"suggs": suggs, "stids": stids}),
        ("teacher_risk_review", "DELETE", "prediction_id = ANY(:ai_preds) OR student_id::text = ANY(:stids)", {"ai_preds": ai_preds, "stids": stids}),
        ("prediction_generation_request", "DELETE", "prediction_id = ANY(:ai_preds)", {"ai_preds": ai_preds}),
        ("prediction_outcome", "DELETE", "prediction_id = ANY(:ai_preds)", {"ai_preds": ai_preds}),
        ("ai_prediction_feature", "DELETE", "prediction_id = ANY(:ai_preds)", {"ai_preds": ai_preds}),
        ("ai_prediction", "DELETE", "prediction_id = ANY(:ai_preds) OR student_id::text = ANY(:stids)", {"ai_preds": ai_preds, "stids": stids}),

        # 5. Classwork Assignments (break self-FK first) & Classwork children
        ("classwork_assignment_recipient", "DELETE", "classwork_assignment_id = ANY(:aids) OR student_id::text = ANY(:stids)", {"aids": aids, "stids": stids}),
        ("classwork_assignment", "UPDATE_NULL", "SET original_exam_assignment_id = NULL WHERE classwork_assignment_id = ANY(:aids) OR original_exam_assignment_id = ANY(:aids)", {"aids": aids}),
        ("classwork_assignment", "DELETE", "classwork_assignment_id = ANY(:aids)", {"aids": aids}),
        ("quiz_question", "DELETE", "quiz_id = ANY(:qids)", {"qids": qids}),
        ("question_option", "DELETE", "question_id = ANY(:qns)", {"qns": qns}),
        ("question", "DELETE", "question_id = ANY(:qns)", {"qns": qns}),
        ("quiz_setting", "DELETE", "classwork_id = ANY(:cwids)", {"cwids": cwids}),
        ("quiz", "DELETE", "quiz_id = ANY(:qids)", {"qids": qids}),
        ("activity_rubric_level", "DELETE", "classwork_id = ANY(:cwids)", {"cwids": cwids}),
        ("classwork_attachment", "DELETE", "classwork_id = ANY(:cwids)", {"cwids": cwids}),
        ("classwork_coverage", "DELETE", "classwork_id = ANY(:cwids) OR lesson_id = ANY(:lids)", {"cwids": cwids, "lids": lids}),
        ("classwork_lesson", "DELETE", "classwork_id = ANY(:cwids) OR lesson_id = ANY(:lids)", {"cwids": cwids, "lids": lids}),
        ("classwork_reference_link", "DELETE", "classwork_id = ANY(:cwids)", {"cwids": cwids}),
        ("lesson_goal_item", "DELETE", "goal_id = ANY(:goals) OR classwork_id = ANY(:cwids) OR lesson_id = ANY(:lids)", {"goals": goals, "cwids": cwids, "lids": lids}),
        ("lesson_goal", "DELETE", "goal_id = ANY(:goals)", {"goals": goals}),
        ("classwork", "DELETE", "classwork_id = ANY(:cwids)", {"cwids": cwids}),

        # 6. Interventions & Current-Term Predictions
        ("intervention", "DELETE", "intervention_id = ANY(:iids)", {"iids": iids}),
        ("development_current_term_prediction", "DELETE", "prediction_id = ANY(:dev_preds)", {"dev_preds": dev_preds}),

        # 7. Grades, Manual Assessments, Attendance, TOS
        ("grade_submission_log", "DELETE", "class_id = ANY(:cids) OR subject_id = ANY(:sids) OR student_id::text = ANY(:stids)", {"cids": cids, "sids": sids, "stids": stids}),
        ("student_period_grade", "DELETE", "class_id = ANY(:cids) OR subject_id = ANY(:sids) OR student_id::text = ANY(:stids)", {"cids": cids, "sids": sids, "stids": stids}),
        ("student_assessment_score", "DELETE", "assessment_id = ANY(:assess) OR student_id::text = ANY(:stids)", {"assess": assess, "stids": stids}),
        ("assessment_item", "DELETE", "assessment_id = ANY(:assess)", {"assess": assess}),
        ("attendance_record", "DELETE", "class_id = ANY(:cids) OR subject_id = ANY(:sids) OR student_id::text = ANY(:stids)", {"cids": cids, "sids": sids, "stids": stids}),
        ("tos_question", "DELETE", "tos_exam_id = ANY(:tos)", {"tos": tos}),
        ("tos_exam", "DELETE", "tos_exam_id = ANY(:tos)", {"tos": tos}),

        # 8. Lessons
        ("lesson_delivery", "DELETE", "class_id = ANY(:cids) OR subject_id = ANY(:sids) OR lesson_id = ANY(:lids)", {"cids": cids, "sids": sids, "lids": lids}),
        ("lesson_assignment", "DELETE", "class_id = ANY(:cids) OR lesson_id = ANY(:lids)", {"cids": cids, "lids": lids}),
        ("lesson_plan", "DELETE", "class_id = ANY(:cids) OR subject_id = ANY(:sids)", {"cids": cids, "sids": sids}),
        ("lesson", "DELETE", "lesson_id = ANY(:lids)", {"lids": lids}),

        # 9. Content Sharing / Cloning touching Grade 9 classes or subjects
        ("content_share_event", "DELETE", "operation_id = ANY(:cops) OR request_id = ANY(:sreqs)", {"cops": cops, "sreqs": sreqs}),
        ("content_clone_item_map", "DELETE", "operation_id = ANY(:cops)", {"cops": cops}),
        ("content_clone_operation", "DELETE", "operation_id = ANY(:cops)", {"cops": cops}),
        ("content_share_package_asset", "DELETE", "package_item_id IN (SELECT package_item_id FROM content_share_package_item WHERE package_id IN (SELECT package_id FROM content_share_package WHERE request_id = ANY(:sreqs)))", {"sreqs": sreqs}),
        ("content_share_package_item", "DELETE", "package_id IN (SELECT package_id FROM content_share_package WHERE request_id = ANY(:sreqs))", {"sreqs": sreqs}),
        ("content_share_package", "DELETE", "request_id = ANY(:sreqs)", {"sreqs": sreqs}),
        ("content_share_request", "DELETE", "request_id = ANY(:sreqs)", {"sreqs": sreqs}),

        # 10. Teacher Subject Loads & Substitutions (preserve academic_staff!)
        ("teacher_substitution", "DELETE", "subject_load_id = ANY(:slids)", {"slids": slids}),
        ("subject_load_assignment_log", "DELETE", "class_id = ANY(:cids) OR subject_id = ANY(:sids) OR subject_load_id = ANY(:slids)", {"cids": cids, "sids": sids, "slids": slids}),
        ("subject_load", "UPDATE_NULL", "SET continued_from_load_id = NULL WHERE subject_load_id = ANY(:slids) OR continued_from_load_id = ANY(:slids)", {"slids": slids}),
        ("subject_load", "DELETE", "subject_load_id = ANY(:slids)", {"slids": slids}),

        # 11. Enrollments, Classes, Official Sections
        ("student_class", "DELETE", "class_id = ANY(:cids) OR student_id::text = ANY(:stids)", {"cids": cids, "stids": stids}),
        ("class", "UPDATE_NULL", "SET paired_class_id = NULL WHERE class_id = ANY(:cids) OR paired_class_id = ANY(:cids)", {"cids": cids}),
        ("class", "DELETE", "class_id = ANY(:cids)", {"cids": cids}),
        ("official_section", "DELETE", "id = ANY(:osids)", {"osids": osids}),

        # 12. Grade 9-only Students, Notifications & Eligible Student User Accounts
        ("student", "DELETE", "student_id::text = ANY(:stids)", {"stids": stids}),
        ("notification", "DELETE", "notification_id::text = ANY(:nids)", {"nids": nids}),
        ("invitation_token", "DELETE", "user_id::text = ANY(:uids)", {"uids": uids}),
        ("user_login_log", "DELETE", "user_id::text = ANY(:uids)", {"uids": uids}),
        ("user_roles", "DELETE", "user_id::text = ANY(:uids)", {"uids": uids}),
        ("user_account", "DELETE", "user_id::text = ANY(:uids)", {"uids": uids}),
    ]


def _capture_preserved_baseline(conn: Connection, scope: dict[str, Any]) -> dict[str, int]:
    lids = scope["academic_level_ids"]
    sids = scope["subject_ids"]
    return {
        "g9_academic_levels": conn.execute(text("SELECT COUNT(*) FROM academic_level WHERE academic_level_id = ANY(:lids)"), {"lids": lids}).scalar(),
        "g9_subjects": conn.execute(text("SELECT COUNT(*) FROM subject WHERE academic_level_id = ANY(:lids)"), {"lids": lids}).scalar(),
        "g9_subject_offerings": conn.execute(text("SELECT COUNT(*) FROM subject_offering WHERE academic_level_id = ANY(:lids)"), {"lids": lids}).scalar(),
        "g9_competencies": conn.execute(text("SELECT COUNT(*) FROM competency WHERE subject_id = ANY(:sids)"), {"sids": sids}).scalar(),
        "grading_templates": conn.execute(text("SELECT COUNT(*) FROM grading_template")).scalar(),
        "grading_template_components": conn.execute(text("SELECT COUNT(*) FROM grading_template_component")).scalar(),
        "academic_years": conn.execute(text("SELECT COUNT(*) FROM academic_year")).scalar(),
        "academic_periods": conn.execute(text("SELECT COUNT(*) FROM academic_period")).scalar(),
        "academic_staff": conn.execute(text("SELECT COUNT(*) FROM academic_staff")).scalar(),
        "staff_user_accounts": conn.execute(text("SELECT COUNT(*) FROM user_account ua WHERE EXISTS (SELECT 1 FROM academic_staff a WHERE a.user_id = ua.user_id)")).scalar(),
        "non_g9_official_sections": conn.execute(text("SELECT COUNT(*) FROM official_section WHERE NOT (academic_level_id = ANY(:lids))"), {"lids": lids}).scalar(),
        "non_g9_classes": conn.execute(text("SELECT COUNT(*) FROM class WHERE NOT (academic_level_id = ANY(:lids))"), {"lids": lids}).scalar(),
        "non_g9_subject_loads": conn.execute(text("SELECT COUNT(*) FROM subject_load WHERE NOT (class_id = ANY(:cids))"), {"cids": scope["class_ids"]}).scalar(),
        "non_g9_student_classes": conn.execute(text("SELECT COUNT(*) FROM student_class WHERE NOT (class_id = ANY(:cids))"), {"cids": scope["class_ids"]}).scalar(),
        "non_g9_students": conn.execute(text("SELECT COUNT(*) FROM student WHERE NOT (student_id::text = ANY(:stids))"), {"stids": scope["eligible_student_ids"]}).scalar(),
        "non_g9_lessons": conn.execute(text("SELECT COUNT(*) FROM lesson WHERE NOT (subject_id = ANY(:sids))"), {"sids": sids}).scalar(),
        "non_g9_classworks": conn.execute(text("SELECT COUNT(*) FROM classwork WHERE NOT (subject_id = ANY(:sids))"), {"sids": sids}).scalar(),
        "non_g9_interventions": conn.execute(text("SELECT COUNT(*) FROM intervention WHERE NOT (intervention_id = ANY(:iids))"), {"iids": scope["intervention_ids"]}).scalar(),
        "non_g9_dev_predictions": conn.execute(text("SELECT COUNT(*) FROM development_current_term_prediction WHERE NOT (prediction_id = ANY(:pids))"), {"pids": scope["dev_prediction_ids"]}).scalar(),
    }


def _verify_post_cleanup(
    conn: Connection,
    scope: dict[str, Any],
    baseline: dict[str, int],
) -> dict[str, int]:
    lids = scope["academic_level_ids"]
    sids = scope["subject_ids"]
    remaining_g9 = {
        "official_section": conn.execute(text("SELECT COUNT(*) FROM official_section WHERE academic_level_id = ANY(:lids)"), {"lids": lids}).scalar(),
        "class": conn.execute(text("SELECT COUNT(*) FROM class WHERE academic_level_id = ANY(:lids)"), {"lids": lids}).scalar(),
        "subject_load": conn.execute(text("SELECT COUNT(*) FROM subject_load WHERE subject_id = ANY(:sids) OR class_id = ANY(:cids)"), {"sids": sids, "cids": scope["class_ids"]}).scalar(),
        "student_class": conn.execute(text("SELECT COUNT(*) FROM student_class WHERE class_id = ANY(:cids)"), {"cids": scope["class_ids"]}).scalar(),
        "student_g9_level": conn.execute(text("SELECT COUNT(*) FROM student WHERE academic_level_id = ANY(:lids)"), {"lids": lids}).scalar(),
        "lesson": conn.execute(text("SELECT COUNT(*) FROM lesson WHERE subject_id = ANY(:sids)"), {"sids": sids}).scalar(),
        "classwork": conn.execute(text("SELECT COUNT(*) FROM classwork WHERE subject_id = ANY(:sids)"), {"sids": sids}).scalar(),
        "classwork_assignment": conn.execute(text("SELECT COUNT(*) FROM classwork_assignment WHERE class_id = ANY(:cids) OR classwork_id = ANY(:cwids)"), {"cids": scope["class_ids"], "cwids": scope["classwork_ids"]}).scalar(),
        "quiz": conn.execute(text("SELECT COUNT(*) FROM quiz WHERE classwork_id = ANY(:cwids)"), {"cwids": scope["classwork_ids"]}).scalar(),
        "student_submission": conn.execute(text("SELECT COUNT(*) FROM student_submission WHERE classwork_assignment_id = ANY(:aids)"), {"aids": scope["classwork_assignment_ids"]}).scalar(),
        "intervention": conn.execute(text("SELECT COUNT(*) FROM intervention WHERE subject_id = ANY(:sids) OR class_id = ANY(:cids)"), {"sids": sids, "cids": scope["class_ids"]}).scalar(),
        "development_current_term_prediction": conn.execute(text("SELECT COUNT(*) FROM development_current_term_prediction WHERE subject_id = ANY(:sids) OR class_id = ANY(:cids)"), {"sids": sids, "cids": scope["class_ids"]}).scalar(),
        "eligible_user_account": conn.execute(text("SELECT COUNT(*) FROM user_account WHERE user_id::text = ANY(:uids)"), {"uids": scope["eligible_user_ids"]}).scalar(),
    }
    nonzero = {k: v for k, v in remaining_g9.items() if v != 0}
    if nonzero:
        raise RuntimeError(f"Post-cleanup verification failed; non-zero Grade 9 counts remain: {nonzero}")

    after = _capture_preserved_baseline(conn, scope)
    diffs = {k: (baseline[k], after[k]) for k in baseline if baseline[k] != after[k]}
    if diffs:
        raise RuntimeError(f"Safety abort: preserved baseline changed unexpectedly: {diffs}")
    return after


IMMUTABILITY_TRIGGERS: dict[str, str] = {
    "development_current_term_prediction": "immutable_development_current_term_prediction",
    "ai_prediction": "immutable_audited_prediction",
    "ai_prediction_feature": "immutable_audited_prediction_feature",
}


def _trigger_exists(conn: Connection, table_name: str, trigger_name: str) -> bool:
    return bool(
        conn.execute(
            text(
                "SELECT 1 FROM pg_trigger tg "
                "JOIN pg_class cls ON cls.oid = tg.tgrelid "
                "JOIN pg_namespace ns ON ns.oid = cls.relnamespace "
                "WHERE ns.nspname = 'public' AND cls.relname = :tbl "
                "  AND tg.tgname = :tg AND NOT tg.tgisinternal"
            ),
            {"tbl": table_name, "tg": trigger_name},
        ).scalar()
    )


def _assert_immutability_triggers_enabled(conn: Connection) -> None:
    for tbl, tg in IMMUTABILITY_TRIGGERS.items():
        if not _trigger_exists(conn, tbl, tg):
            continue
        state = conn.execute(
            text(
                "SELECT tg.tgenabled FROM pg_trigger tg "
                "JOIN pg_class cls ON cls.oid = tg.tgrelid "
                "JOIN pg_namespace ns ON ns.oid = cls.relnamespace "
                "WHERE ns.nspname = 'public' AND cls.relname = :tbl "
                "  AND tg.tgname = :tg AND NOT tg.tgisinternal"
            ),
            {"tbl": tbl, "tg": tg},
        ).scalar()
        if state != "O":
            raise RuntimeError(
                f"Safety abort: trigger {tbl}.{tg} is not enabled (tgenabled={state!r})"
            )


def run_reset(
    database_url: str,
    *,
    apply: bool = False,
    snapshot_out: str | None = None,
) -> dict[str, Any]:
    engine = create_engine(database_url)
    deleted_counts: dict[str, int] = {}
    snapshot_rows: dict[str, list[dict[str, Any]]] = {}

    with engine.connect() as conn:
        trans = conn.begin()
        try:
            tables = _existing_tables(conn)
            scope = _collect_grade9_scope(conn, tables)
            baseline = _capture_preserved_baseline(conn, scope)

            for tbl, kind, clause, params in _deletion_steps(scope):
                if tbl not in tables:
                    continue
                if kind == "UPDATE_NULL":
                    conn.execute(text(f'UPDATE "{tbl}" {clause}'), params)
                    continue
                if snapshot_out:
                    rows = conn.execute(text(f'SELECT * FROM "{tbl}" WHERE {clause}'), params).fetchall()
                    if rows:
                        snapshot_rows[tbl] = [dict(r._mapping) for r in rows]

                # Temporarily pause ONLY the named user immutability trigger on prediction
                # tables (never disabling internal foreign-key triggers) and immediately
                # re-enable it inside the same atomic transaction.
                named_trigger = IMMUTABILITY_TRIGGERS.get(tbl)
                paused_trigger = bool(named_trigger and _trigger_exists(conn, tbl, named_trigger))
                if paused_trigger:
                    conn.execute(text(f'ALTER TABLE "{tbl}" DISABLE TRIGGER "{named_trigger}"'))
                try:
                    result = conn.execute(text(f'DELETE FROM "{tbl}" WHERE {clause}'), params)
                finally:
                    if paused_trigger:
                        conn.execute(text(f'ALTER TABLE "{tbl}" ENABLE TRIGGER "{named_trigger}"'))
                if result.rowcount:
                    deleted_counts[tbl] = deleted_counts.get(tbl, 0) + result.rowcount

            _assert_immutability_triggers_enabled(conn)
            preserved_after = _verify_post_cleanup(conn, scope, baseline)

            if apply:
                if snapshot_out:
                    out_path = Path(snapshot_out)
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    out_path.write_text(
                        json.dumps(
                            {
                                "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
                                "scope": scope,
                                "deleted_counts": deleted_counts,
                                "preserved_counts": preserved_after,
                                "deleted_rows": snapshot_rows,
                            },
                            indent=2,
                            default=_json_default,
                        ),
                        encoding="utf-8",
                    )
                trans.commit()
                mode = "APPLIED"
            else:
                trans.rollback()
                mode = "DRY_RUN_ROLLED_BACK"
        except Exception:
            trans.rollback()
            raise

    return {
        "mode": mode,
        "scope": scope,
        "deleted_counts": deleted_counts,
        "total_deleted_rows": sum(deleted_counts.values()),
        "preserved_counts": preserved_after,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Transactional complete Grade 9 demo reset (dry-run by default)."
    )
    parser.add_argument(
        "--database-url",
        default=os.environ.get("DATABASE_URL"),
        help="Target PostgreSQL SQLAlchemy URL (defaults to DATABASE_URL env var).",
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Commit changes (omit for safe transactional dry-run with rollback).",
    )
    parser.add_argument(
        "--confirm-live",
        action="store_true",
        help="Required safety flag when --apply targets the live 'Entervene' database.",
    )
    parser.add_argument(
        "--snapshot-out",
        default=None,
        help="Optional path to write JSON snapshot of deleted rows on --apply.",
    )
    args = parser.parse_args()

    if not args.database_url:
        raise SystemExit("ERROR: --database-url or DATABASE_URL is required.")

    db_name = args.database_url.rsplit("/", 1)[-1].split("?")[0]
    if args.apply and db_name.lower() == "entervene" and not args.confirm_live:
        raise SystemExit(
            "SAFETY ABORT: --apply on live database 'Entervene' requires --confirm-live "
            "after creating and verifying a pg_dump backup."
        )

    summary = run_reset(
        args.database_url,
        apply=args.apply,
        snapshot_out=args.snapshot_out,
    )
    print(json.dumps(summary, indent=2, default=_json_default))


if __name__ == "__main__":
    main()

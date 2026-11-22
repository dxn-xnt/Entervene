"""Narrowly scoped, transactional, idempotent, and reversible data repair for Intervention #13.

Repairs two previously persisted anomalies created before the Task 1 application fixes:
1. Removes private THIS_STUDENT reading classwork_id=71 (originating from resolved Intervention #12)
   from active Intervention #13 (Jayson Doe):
   - Deletes Jayson's leaked row from `classwork_assignment_recipient` for assignment 71.
   - Removes classwork_id=71 from `remediation_reading_prerequisite` for remediation assignment 73
     and compacts contiguous `display_order` values (1..N).
   - Removes `{"kind": "CLASSWORK", "id": 71}` from `intervention.remediation_plan['selected_resources']`.
2. Removes the spurious Lesson 1 (`lesson_id=41`) link from remediation quiz `classwork_id=73`
   in `classwork_lesson`, preserving its legitimate Lesson 2 (`lesson_id=42`) link.

Safety invariants:
- Dry-run is the default; live writes require explicit `--apply --confirm-apply --backup-file <path>`.
- Never touches resolved Intervention #12 or Roy Rondina1's records.
- Never modifies student scores, submissions, grades, predictions, or diagnosis snapshots.
- Verifies all preconditions (including zero student submissions/reviews on leaked reading and
  zero quiz questions mapped to the removed lesson) before modifying any row.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session, sessionmaker

BACKEND_DIR = Path(__file__).resolve().parents[1]
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

DEFAULT_TARGET_INTERVENTION_ID = 13
DEFAULT_ORIGIN_INTERVENTION_ID = 12
DEFAULT_LEAKED_READING_CLASSWORK_ID = 71
DEFAULT_REMEDIATION_CLASSWORK_ID = 73
DEFAULT_SPURIOUS_LESSON_ID = 41
DEFAULT_EXPECTED_LESSON_ID = 42


def _json_canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, default=str)


def _sha256_canonical(value: Any) -> str:
    return hashlib.sha256(_json_canonical(value).encode("utf-8")).hexdigest()


def _parse_json_field(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return deepcopy(value)
    if isinstance(value, str) and value.strip():
        return json.loads(value)
    return {}


def _is_postgres(db: Session) -> bool:
    bind = db.get_bind()
    return bind is not None and bind.dialect.name == "postgresql"


def snapshot_origin_intervention_fingerprint(
    db: Session,
    *,
    origin_intervention_id: int = DEFAULT_ORIGIN_INTERVENTION_ID,
    leaked_reading_classwork_id: int = DEFAULT_LEAKED_READING_CLASSWORK_ID,
) -> dict[str, Any]:
    """Capture an immutable fingerprint of the origin intervention and its student's rows."""
    origin = db.execute(
        text(
            """
            SELECT intervention_id, student_id, class_id, subject_id, academic_period_id,
                   source_prediction_id, status, activated_at, resolved_at, remediation_plan
            FROM intervention
            WHERE intervention_id = :iid
            """
        ),
        {"iid": origin_intervention_id},
    ).mappings().first()
    if origin is None:
        raise ValueError(f"Origin intervention {origin_intervention_id} not found")

    origin_student_id = origin["student_id"]
    origin_recipients = db.execute(
        text(
            """
            SELECT r.recipient_id, r.classwork_assignment_id, r.student_id,
                   r.assigned_by_staff_id, r.created_at
            FROM classwork_assignment_recipient r
            JOIN classwork_assignment a ON a.classwork_assignment_id = r.classwork_assignment_id
            WHERE a.classwork_id = :cw_id AND r.student_id = :sid
            ORDER BY r.recipient_id
            """
        ),
        {"cw_id": leaked_reading_classwork_id, "sid": origin_student_id},
    ).mappings().all()

    origin_prereqs = db.execute(
        text(
            """
            SELECT p.prerequisite_id, p.remediation_assignment_id, p.reading_classwork_id,
                   p.reading_assignment_id, p.display_order, p.created_at
            FROM remediation_reading_prerequisite p
            JOIN classwork_assignment a ON a.classwork_assignment_id = p.remediation_assignment_id
            WHERE a.source_intervention_id = :iid
            ORDER BY p.prerequisite_id
            """
        ),
        {"iid": origin_intervention_id},
    ).mappings().all()

    origin_links = db.execute(
        text(
            """
            SELECT remediation_link_id, source_intervention_id, remediation_assignment_id,
                   original_assignment_id, student_id, component, score_adjustment_cap
            FROM remediation_assignment_link
            WHERE source_intervention_id = :iid
            ORDER BY remediation_link_id
            """
        ),
        {"iid": origin_intervention_id},
    ).mappings().all()

    origin_reviews = db.execute(
        text(
            """
            SELECT review_id, intervention_id, reading_assignment_id, student_id,
                   acknowledged_at, review_cycle
            FROM intervention_reading_review
            WHERE intervention_id = :iid
            ORDER BY review_id
            """
        ),
        {"iid": origin_intervention_id},
    ).mappings().all()

    payload = {
        "intervention": dict(origin),
        "origin_recipients": [dict(r) for r in origin_recipients],
        "origin_prereqs": [dict(r) for r in origin_prereqs],
        "origin_links": [dict(r) for r in origin_links],
        "origin_reviews": [dict(r) for r in origin_reviews],
    }
    return {
        "origin_intervention_id": origin_intervention_id,
        "status": origin["status"],
        "sha256": _sha256_canonical(payload),
    }


def inspect_repair_plan(
    db: Session,
    *,
    target_intervention_id: int = DEFAULT_TARGET_INTERVENTION_ID,
    origin_intervention_id: int = DEFAULT_ORIGIN_INTERVENTION_ID,
    leaked_reading_classwork_id: int = DEFAULT_LEAKED_READING_CLASSWORK_ID,
    remediation_classwork_id: int = DEFAULT_REMEDIATION_CLASSWORK_ID,
    spurious_lesson_id: int = DEFAULT_SPURIOUS_LESSON_ID,
    expected_lesson_id: int = DEFAULT_EXPECTED_LESSON_ID,
) -> dict[str, Any]:
    """Inspect current DB state, enforce safety preconditions, and compute exact changes."""
    target = db.execute(
        text(
            """
            SELECT i.intervention_id, i.student_id, i.class_id, i.subject_id,
                   i.academic_period_id, i.source_prediction_id, i.status, i.remediation_plan
            FROM intervention i
            WHERE i.intervention_id = :iid
            """
        ),
        {"iid": target_intervention_id},
    ).mappings().first()
    if target is None:
        raise ValueError(f"Target intervention {target_intervention_id} not found")
    if target["status"] != "ACTIVE":
        raise ValueError(
            f"Target intervention {target_intervention_id} must be ACTIVE (found {target['status']})"
        )

    origin = db.execute(
        text(
            """
            SELECT intervention_id, student_id, status
            FROM intervention
            WHERE intervention_id = :iid
            """
        ),
        {"iid": origin_intervention_id},
    ).mappings().first()
    if origin is None:
        raise ValueError(f"Origin intervention {origin_intervention_id} not found")
    if origin["student_id"] == target["student_id"]:
        raise ValueError("Target and origin interventions belong to the same student; aborting")

    leaked_cw = db.execute(
        text(
            """
            SELECT classwork_id, title, classwork_type, subject_id,
                   intervention_resource_origin_id, intervention_resource_recipient_scope
            FROM classwork
            WHERE classwork_id = :cw_id
            """
        ),
        {"cw_id": leaked_reading_classwork_id},
    ).mappings().first()
    if leaked_cw is None:
        raise ValueError(f"Leaked reading classwork {leaked_reading_classwork_id} not found")
    if leaked_cw["intervention_resource_origin_id"] != origin_intervention_id:
        raise ValueError(
            f"Classwork {leaked_reading_classwork_id} origin is "
            f"{leaked_cw['intervention_resource_origin_id']}, expected {origin_intervention_id}"
        )
    if leaked_cw["intervention_resource_recipient_scope"] != "THIS_STUDENT":
        raise ValueError(
            f"Classwork {leaked_reading_classwork_id} scope is "
            f"{leaked_cw['intervention_resource_recipient_scope']}, expected THIS_STUDENT"
        )

    # Verify target student has no submissions or reading reviews on the leaked reading.
    leaked_assignments = db.execute(
        text(
            """
            SELECT classwork_assignment_id
            FROM classwork_assignment
            WHERE classwork_id = :cw_id
            ORDER BY classwork_assignment_id
            """
        ),
        {"cw_id": leaked_reading_classwork_id},
    ).scalars().all()
    if not leaked_assignments:
        raise ValueError(f"No assignment rows found for classwork {leaked_reading_classwork_id}")

    for aid in leaked_assignments:
        sub_cnt = db.execute(
            text(
                """
                SELECT COUNT(*)
                FROM student_submission
                WHERE classwork_assignment_id = :aid AND student_id = :sid
                """
            ),
            {"aid": aid, "sid": target["student_id"]},
        ).scalar()
        if sub_cnt:
            raise ValueError(
                f"Target student has {sub_cnt} submission(s) on leaked reading assignment {aid}; "
                "refusing automatic deletion"
            )
        review_cnt = db.execute(
            text(
                """
                SELECT COUNT(*)
                FROM intervention_reading_review
                WHERE intervention_id = :iid AND reading_assignment_id = :aid AND student_id = :sid
                """
            ),
            {"iid": target_intervention_id, "aid": aid, "sid": target["student_id"]},
        ).scalar()
        if review_cnt:
            raise ValueError(
                f"Target student has {review_cnt} reading review(s) on leaked reading assignment {aid}; "
                "refusing automatic deletion"
            )

    # Verify remediation quiz classwork belongs to target intervention and its questions match ONLY expected_lesson_id.
    rem_asgn = db.execute(
        text(
            """
            SELECT classwork_assignment_id, classwork_id, recipient_student_id,
                   source_intervention_id, class_id, academic_period_id
            FROM classwork_assignment
            WHERE classwork_id = :cw_id AND source_intervention_id = :iid
            """
        ),
        {"cw_id": remediation_classwork_id, "iid": target_intervention_id},
    ).mappings().first()
    if rem_asgn is None:
        raise ValueError(
            f"Remediation assignment for classwork {remediation_classwork_id} "
            f"and intervention {target_intervention_id} not found"
        )
    if rem_asgn["recipient_student_id"] != target["student_id"]:
        raise ValueError("Remediation assignment recipient does not match target intervention student")

    rem_link = db.execute(
        text(
            """
            SELECT remediation_link_id, original_assignment_id
            FROM remediation_assignment_link
            WHERE remediation_assignment_id = :raid AND source_intervention_id = :iid
            """
        ),
        {"raid": rem_asgn["classwork_assignment_id"], "iid": target_intervention_id},
    ).mappings().first()
    if rem_link is None:
        raise ValueError("RemediationAssignmentLink for target remediation assignment not found")

    original_lessons = db.execute(
        text(
            """
            SELECT cl.lesson_id
            FROM classwork_lesson cl
            JOIN classwork_assignment a ON a.classwork_id = cl.classwork_id
            WHERE a.classwork_assignment_id = :orig_aid
            ORDER BY cl.lesson_id
            """
        ),
        {"orig_aid": rem_link["original_assignment_id"]},
    ).scalars().all()
    if original_lessons != [expected_lesson_id]:
        raise ValueError(
            f"Original target assignment {rem_link['original_assignment_id']} lessons are "
            f"{original_lessons}, expected [{expected_lesson_id}]"
        )

    quiz_question_lessons = db.execute(
        text(
            """
            SELECT DISTINCT q.lesson_id
            FROM quiz qz
            JOIN quiz_question qq ON qq.quiz_id = qz.quiz_id
            JOIN question q ON q.question_id = qq.question_id
            WHERE qz.classwork_id = :cw_id
            ORDER BY q.lesson_id
            """
        ),
        {"cw_id": remediation_classwork_id},
    ).scalars().all()
    if quiz_question_lessons != [expected_lesson_id]:
        raise ValueError(
            f"Remediation quiz {remediation_classwork_id} question lessons are "
            f"{quiz_question_lessons}, expected [{expected_lesson_id}]"
        )

    current_cw_lessons = db.execute(
        text(
            """
            SELECT lesson_id
            FROM classwork_lesson
            WHERE classwork_id = :cw_id
            ORDER BY lesson_id
            """
        ),
        {"cw_id": remediation_classwork_id},
    ).scalars().all()
    if expected_lesson_id not in current_cw_lessons:
        raise ValueError(
            f"Expected lesson {expected_lesson_id} is missing from classwork_lesson for {remediation_classwork_id}"
        )

    # Collect exact rows needing repair.
    leaked_recipients = [
        dict(r)
        for r in db.execute(
            text(
                """
                SELECT r.recipient_id, r.classwork_assignment_id, r.student_id,
                       r.assigned_by_staff_id, r.created_at
                FROM classwork_assignment_recipient r
                JOIN classwork_assignment a ON a.classwork_assignment_id = r.classwork_assignment_id
                WHERE a.classwork_id = :cw_id AND r.student_id = :sid
                ORDER BY r.recipient_id
                """
            ),
            {"cw_id": leaked_reading_classwork_id, "sid": target["student_id"]},
        ).mappings().all()
    ]

    all_prereqs = [
        dict(r)
        for r in db.execute(
            text(
                """
                SELECT prerequisite_id, remediation_assignment_id, reading_classwork_id,
                       reading_assignment_id, display_order, created_at
                FROM remediation_reading_prerequisite
                WHERE remediation_assignment_id = :raid
                ORDER BY display_order, prerequisite_id
                """
            ),
            {"raid": rem_asgn["classwork_assignment_id"]},
        ).mappings().all()
    ]
    leaked_prereqs = [p for p in all_prereqs if p["reading_classwork_id"] == leaked_reading_classwork_id]
    remaining_prereqs = [p for p in all_prereqs if p["reading_classwork_id"] != leaked_reading_classwork_id]
    if all_prereqs and not remaining_prereqs:
        raise ValueError(
            "Removing leaked prerequisite would leave remediation assignment with zero reading prerequisites"
        )

    prereq_reorders = []
    for new_order, row in enumerate(remaining_prereqs, start=1):
        if row["display_order"] != new_order:
            prereq_reorders.append(
                {
                    "prerequisite_id": row["prerequisite_id"],
                    "old_display_order": row["display_order"],
                    "new_display_order": new_order,
                }
            )

    current_plan = _parse_json_field(target["remediation_plan"])
    selected_resources = current_plan.get("selected_resources") or []
    filtered_resources = [
        item
        for item in selected_resources
        if not (
            isinstance(item, dict)
            and item.get("kind") == "CLASSWORK"
            and item.get("id") == leaked_reading_classwork_id
        )
    ]
    plan_needs_update = filtered_resources != selected_resources
    new_plan = deepcopy(current_plan)
    new_plan["selected_resources"] = filtered_resources

    spurious_lesson_present = spurious_lesson_id in current_cw_lessons

    needs_repair = bool(
        leaked_recipients
        or leaked_prereqs
        or prereq_reorders
        or plan_needs_update
        or spurious_lesson_present
    )

    return {
        "needs_repair": needs_repair,
        "target_intervention_id": target_intervention_id,
        "target_student_id": str(target["student_id"]),
        "origin_intervention_id": origin_intervention_id,
        "leaked_reading_classwork_id": leaked_reading_classwork_id,
        "remediation_classwork_id": remediation_classwork_id,
        "remediation_assignment_id": rem_asgn["classwork_assignment_id"],
        "original_assignment_id": rem_link["original_assignment_id"],
        "spurious_lesson_id": spurious_lesson_id,
        "expected_lesson_id": expected_lesson_id,
        "origin_fingerprint_before": snapshot_origin_intervention_fingerprint(
            db,
            origin_intervention_id=origin_intervention_id,
            leaked_reading_classwork_id=leaked_reading_classwork_id,
        ),
        "changes": {
            "delete_recipients": leaked_recipients,
            "delete_prerequisites": leaked_prereqs,
            "reorder_prerequisites": prereq_reorders,
            "update_remediation_plan": {
                "needed": plan_needs_update,
                "before_selected_resources": selected_resources,
                "after_selected_resources": filtered_resources,
                "before_plan": current_plan,
                "after_plan": new_plan,
            },
            "delete_classwork_lesson": (
                {"classwork_id": remediation_classwork_id, "lesson_id": spurious_lesson_id}
                if spurious_lesson_present
                else None
            ),
        },
    }


def apply_repair(
    db: Session,
    *,
    target_intervention_id: int = DEFAULT_TARGET_INTERVENTION_ID,
    origin_intervention_id: int = DEFAULT_ORIGIN_INTERVENTION_ID,
    leaked_reading_classwork_id: int = DEFAULT_LEAKED_READING_CLASSWORK_ID,
    remediation_classwork_id: int = DEFAULT_REMEDIATION_CLASSWORK_ID,
    spurious_lesson_id: int = DEFAULT_SPURIOUS_LESSON_ID,
    expected_lesson_id: int = DEFAULT_EXPECTED_LESSON_ID,
    dry_run: bool = True,
    backup_file: Path | None = None,
) -> dict[str, Any]:
    """Execute the transactional, idempotent repair (or dry-run inspection)."""
    plan = inspect_repair_plan(
        db,
        target_intervention_id=target_intervention_id,
        origin_intervention_id=origin_intervention_id,
        leaked_reading_classwork_id=leaked_reading_classwork_id,
        remediation_classwork_id=remediation_classwork_id,
        spurious_lesson_id=spurious_lesson_id,
        expected_lesson_id=expected_lesson_id,
    )
    if not plan["needs_repair"]:
        return {
            "status": "ALREADY_REPAIRED",
            "dry_run": dry_run,
            "plan": plan,
        }

    if dry_run:
        return {
            "status": "DRY_RUN",
            "dry_run": True,
            "plan": plan,
        }

    backup_payload = {
        "backup_version": 1,
        "captured_at_utc": datetime.now(timezone.utc).isoformat(),
        "target_intervention_id": plan["target_intervention_id"],
        "target_student_id": plan["target_student_id"],
        "origin_intervention_id": plan["origin_intervention_id"],
        "leaked_reading_classwork_id": plan["leaked_reading_classwork_id"],
        "remediation_classwork_id": plan["remediation_classwork_id"],
        "remediation_assignment_id": plan["remediation_assignment_id"],
        "spurious_lesson_id": plan["spurious_lesson_id"],
        "expected_lesson_id": plan["expected_lesson_id"],
        "deleted_recipients": [
            {
                **r,
                "student_id": str(r["student_id"]),
                "created_at": r["created_at"].isoformat() if hasattr(r["created_at"], "isoformat") else r["created_at"],
            }
            for r in plan["changes"]["delete_recipients"]
        ],
        "deleted_prerequisites": [
            {
                **p,
                "created_at": p["created_at"].isoformat() if hasattr(p["created_at"], "isoformat") else p["created_at"],
            }
            for p in plan["changes"]["delete_prerequisites"]
        ],
        "reordered_prerequisites": plan["changes"]["reorder_prerequisites"],
        "before_remediation_plan": plan["changes"]["update_remediation_plan"]["before_plan"],
        "deleted_classwork_lesson": plan["changes"]["delete_classwork_lesson"],
    }

    if backup_file is not None:
        backup_file.parent.mkdir(parents=True, exist_ok=True)
        backup_file.write_text(json.dumps(backup_payload, indent=2, default=str), encoding="utf-8")

    try:
        # 1. Remove leaked student recipient row(s) on classwork 71.
        for rec in plan["changes"]["delete_recipients"]:
            db.execute(
                text("DELETE FROM classwork_assignment_recipient WHERE recipient_id = :rid"),
                {"rid": rec["recipient_id"]},
            )

        # 2. Remove leaked reading prerequisite row(s) on remediation assignment 73 and compact order.
        for prereq in plan["changes"]["delete_prerequisites"]:
            db.execute(
                text("DELETE FROM remediation_reading_prerequisite WHERE prerequisite_id = :pid"),
                {"pid": prereq["prerequisite_id"]},
            )
        for reorder in plan["changes"]["reorder_prerequisites"]:
            db.execute(
                text(
                    """
                    UPDATE remediation_reading_prerequisite
                    SET display_order = :new_order
                    WHERE prerequisite_id = :pid
                    """
                ),
                {"new_order": reorder["new_display_order"], "pid": reorder["prerequisite_id"]},
            )

        # 3. Remove classwork 71 from intervention 13 remediation_plan['selected_resources'].
        plan_change = plan["changes"]["update_remediation_plan"]
        if plan_change["needed"]:
            serialized = json.dumps(plan_change["after_plan"])
            if _is_postgres(db):
                db.execute(
                    text("UPDATE intervention SET remediation_plan = CAST(:plan AS json) WHERE intervention_id = :iid"),
                    {"plan": serialized, "iid": target_intervention_id},
                )
            else:
                db.execute(
                    text("UPDATE intervention SET remediation_plan = :plan WHERE intervention_id = :iid"),
                    {"plan": serialized, "iid": target_intervention_id},
                )

        # 4. Remove spurious Lesson 1 association from remediation quiz 73.
        cw_lesson_del = plan["changes"]["delete_classwork_lesson"]
        if cw_lesson_del is not None:
            db.execute(
                text(
                    """
                    DELETE FROM classwork_lesson
                    WHERE classwork_id = :cw_id AND lesson_id = :lid
                    """
                ),
                {"cw_id": cw_lesson_del["classwork_id"], "lid": cw_lesson_del["lesson_id"]},
            )

        # Verify origin intervention #12 is byte-for-byte untouched before committing.
        origin_after = snapshot_origin_intervention_fingerprint(
            db,
            origin_intervention_id=origin_intervention_id,
            leaked_reading_classwork_id=leaked_reading_classwork_id,
        )
        if origin_after["sha256"] != plan["origin_fingerprint_before"]["sha256"]:
            raise RuntimeError("Origin intervention fingerprint changed unexpectedly; rolling back")

        db.commit()
    except Exception:
        db.rollback()
        raise

    post_check = inspect_repair_plan(
        db,
        target_intervention_id=target_intervention_id,
        origin_intervention_id=origin_intervention_id,
        leaked_reading_classwork_id=leaked_reading_classwork_id,
        remediation_classwork_id=remediation_classwork_id,
        spurious_lesson_id=spurious_lesson_id,
        expected_lesson_id=expected_lesson_id,
    )
    if post_check["needs_repair"]:
        raise RuntimeError("Post-repair verification still reports pending changes")

    return {
        "status": "REPAIRED",
        "dry_run": False,
        "backup": backup_payload,
        "origin_fingerprint_before": plan["origin_fingerprint_before"]["sha256"],
        "origin_fingerprint_after": origin_after["sha256"],
    }


def rollback_repair(db: Session, backup_payload: dict[str, Any]) -> dict[str, Any]:
    """Transactionally and idempotently restore the exact pre-repair state from backup_payload."""
    target_iid = int(backup_payload["target_intervention_id"])
    origin_iid = int(backup_payload["origin_intervention_id"])
    leaked_cw_id = int(backup_payload["leaked_reading_classwork_id"])
    origin_before = snapshot_origin_intervention_fingerprint(
        db,
        origin_intervention_id=origin_iid,
        leaked_reading_classwork_id=leaked_cw_id,
    )

    try:
        # 1. Restore deleted classwork_assignment_recipient rows (preserving recipient_id & created_at).
        for rec in backup_payload.get("deleted_recipients") or []:
            exists = db.execute(
                text("SELECT 1 FROM classwork_assignment_recipient WHERE recipient_id = :rid"),
                {"rid": rec["recipient_id"]},
            ).first()
            if not exists:
                student_param = rec["student_id"]
                if not _is_postgres(db):
                    student_param = str(student_param).replace("-", "")
                db.execute(
                    text(
                        """
                        INSERT INTO classwork_assignment_recipient
                            (recipient_id, classwork_assignment_id, student_id, assigned_by_staff_id, created_at)
                        VALUES (:rid, :aid, :sid, :staff_id, :created_at)
                        """
                    ),
                    {
                        "rid": rec["recipient_id"],
                        "aid": rec["classwork_assignment_id"],
                        "sid": student_param,
                        "staff_id": rec["assigned_by_staff_id"],
                        "created_at": rec["created_at"],
                    },
                )

        # 2. Restore prerequisite display_order in reverse order BEFORE re-inserting deleted prerequisites
        #    so uq_remediation_reading_prerequisite_order is never violated.
        reordered = sorted(
            backup_payload.get("reordered_prerequisites") or [],
            key=lambda item: item["old_display_order"],
            reverse=True,
        )
        for item in reordered:
            db.execute(
                text(
                    """
                    UPDATE remediation_reading_prerequisite
                    SET display_order = :old_order
                    WHERE prerequisite_id = :pid
                    """
                ),
                {"old_order": item["old_display_order"], "pid": item["prerequisite_id"]},
            )

        for prereq in backup_payload.get("deleted_prerequisites") or []:
            exists = db.execute(
                text("SELECT 1 FROM remediation_reading_prerequisite WHERE prerequisite_id = :pid"),
                {"pid": prereq["prerequisite_id"]},
            ).first()
            if not exists:
                db.execute(
                    text(
                        """
                        INSERT INTO remediation_reading_prerequisite
                            (prerequisite_id, remediation_assignment_id, reading_classwork_id,
                             reading_assignment_id, display_order, created_at)
                        VALUES (:pid, :raid, :rcw, :ra, :dorder, :created_at)
                        """
                    ),
                    {
                        "pid": prereq["prerequisite_id"],
                        "raid": prereq["remediation_assignment_id"],
                        "rcw": prereq["reading_classwork_id"],
                        "ra": prereq["reading_assignment_id"],
                        "dorder": prereq["display_order"],
                        "created_at": prereq["created_at"],
                    },
                )

        # 3. Restore exact pre-repair intervention.remediation_plan JSON.
        before_plan = backup_payload.get("before_remediation_plan")
        if before_plan is not None:
            serialized = json.dumps(before_plan)
            if _is_postgres(db):
                db.execute(
                    text("UPDATE intervention SET remediation_plan = CAST(:plan AS json) WHERE intervention_id = :iid"),
                    {"plan": serialized, "iid": target_iid},
                )
            else:
                db.execute(
                    text("UPDATE intervention SET remediation_plan = :plan WHERE intervention_id = :iid"),
                    {"plan": serialized, "iid": target_iid},
                )

        # 4. Restore deleted classwork_lesson row.
        cw_lesson = backup_payload.get("deleted_classwork_lesson")
        if cw_lesson is not None:
            exists = db.execute(
                text(
                    """
                    SELECT 1 FROM classwork_lesson
                    WHERE classwork_id = :cw_id AND lesson_id = :lid
                    """
                ),
                {"cw_id": cw_lesson["classwork_id"], "lid": cw_lesson["lesson_id"]},
            ).first()
            if not exists:
                db.execute(
                    text(
                        """
                        INSERT INTO classwork_lesson (classwork_id, lesson_id)
                        VALUES (:cw_id, :lid)
                        """
                    ),
                    {"cw_id": cw_lesson["classwork_id"], "lid": cw_lesson["lesson_id"]},
                )

        origin_after = snapshot_origin_intervention_fingerprint(
            db,
            origin_intervention_id=origin_iid,
            leaked_reading_classwork_id=leaked_cw_id,
        )
        if origin_after["sha256"] != origin_before["sha256"]:
            raise RuntimeError("Origin intervention fingerprint changed during rollback; aborting")

        db.commit()
    except Exception:
        db.rollback()
        raise

    return {
        "status": "ROLLED_BACK",
        "target_intervention_id": target_iid,
        "origin_fingerprint": origin_after["sha256"],
    }


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Transactional, reversible, idempotent repair for Intervention #13 data."
    )
    parser.add_argument(
        "--database-url",
        default=None,
        help="Target SQLAlchemy database URL (defaults to DATABASE_URL from backend/.env).",
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--dry-run", action="store_true", help="Inspect and print planned changes without writing (default).")
    mode.add_argument("--apply", action="store_true", help="Apply the repair transactionally (requires --confirm-apply and --backup-file).")
    mode.add_argument("--rollback", action="store_true", help="Roll back a previously applied repair (requires --confirm-rollback and --backup-file).")
    parser.add_argument("--confirm-apply", action="store_true", help="Explicit confirmation flag required with --apply.")
    parser.add_argument("--confirm-rollback", action="store_true", help="Explicit confirmation flag required with --rollback.")
    parser.add_argument("--backup-file", type=Path, default=None, help="Path to write (on --apply) or read (on --rollback) the JSON rollback snapshot.")
    return parser


def main(argv: list[str] | None = None) -> int:
    load_dotenv(BACKEND_DIR / ".env")
    args = _build_parser().parse_args(argv)
    db_url = args.database_url or os.environ.get("DATABASE_URL")
    if not db_url:
        print("ERROR: DATABASE_URL not configured", file=sys.stderr)
        return 2

    if args.apply:
        if not args.confirm_apply:
            print("ERROR: --apply requires --confirm-apply", file=sys.stderr)
            return 2
        if args.backup_file is None:
            print("ERROR: --apply requires --backup-file <path>", file=sys.stderr)
            return 2
    elif args.rollback:
        if not args.confirm_rollback:
            print("ERROR: --rollback requires --confirm-rollback", file=sys.stderr)
            return 2
        if args.backup_file is None or not args.backup_file.exists():
            print("ERROR: --rollback requires an existing --backup-file <path>", file=sys.stderr)
            return 2

    engine = create_engine(db_url)
    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    with SessionLocal() as db:
        if args.rollback:
            payload = json.loads(args.backup_file.read_text(encoding="utf-8"))
            result = rollback_repair(db, payload)
        else:
            result = apply_repair(
                db,
                dry_run=not args.apply,
                backup_file=args.backup_file,
            )
    print(json.dumps(result, indent=2, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

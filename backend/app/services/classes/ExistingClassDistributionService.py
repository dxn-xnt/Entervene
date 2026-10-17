"""Preview and atomically assign unassigned students to saved classes."""

import hashlib
import json
import uuid
from typing import Literal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.people.Student import Student
from app.services.classes.ClassService import build_student_class_assignment
from app.services.classes.ClassShared import normalized_text, readable_text
from app.services.classes.OfficialSectionService import selected_official_section
from app.services.classes.StudentDistributionService import distribute_students_balanced, resolve_student_gwa
from app.services.pathways.PathwayScopeService import resolve_pathway_scope


def format_student_display_name(student: Student) -> str:
    first_name = readable_text(student.first_name)
    middle_name = readable_text(student.middle_name)
    last_name = readable_text(student.last_name)
    suffix = readable_text(student.suffix)
    family_name = " ".join(part for part in [last_name, suffix] if part)
    given_name = " ".join(part for part in [first_name, middle_name] if part)
    if family_name and given_name:
        return f"{family_name}, {given_name}"
    return family_name or given_name or "Student"


def preview_existing_class_distribution(
    db: Session, source_class_id: int, class_ids: list[int], mode: Literal["alphabetical", "gwa"],
    *, lock: bool = False,
    assignment_overrides: list[tuple[uuid.UUID, int]] | None = None,
) -> dict:
    if len(class_ids) < 2 or len(set(class_ids)) != len(class_ids) or source_class_id not in class_ids:
        raise HTTPException(status_code=422, detail="Select at least two distinct existing classes, including this class.")

    class_query = db.query(Class).filter(Class.class_id.in_(class_ids)).order_by(Class.class_id)
    if lock:
        class_query = class_query.with_for_update()
    classes = class_query.all()
    source = next((item for item in classes if item.class_id == source_class_id), None)
    if source is None or len(classes) != len(class_ids):
        raise HTTPException(status_code=404, detail="One or more selected classes no longer exist.")
    if any(item.academic_year_id != source.academic_year_id or item.academic_level_id != source.academic_level_id for item in classes):
        raise HTTPException(status_code=422, detail="Selected classes must share an academic year and grade level.")
    if any(normalized_text(item.class_status or "active") != "active" for item in classes):
        raise HTTPException(status_code=422, detail="Select active classes only.")
    if resolve_pathway_scope(db, source.academic_year_id, source.academic_level_id):
        raise HTTPException(status_code=422, detail="Automatic distribution is unavailable for pathway-based grades because students have no verified pathway assignment.")
    for item in classes:
        official = selected_official_section(db, item.academic_year_id, item.academic_level_id, item.section_name)
        if official.pathway_id != item.pathway_id:
            raise HTTPException(status_code=422, detail="A selected class does not match its official section pathway.")

    # Individual roster edits also lock students before adding them. Holding these
    # locks through commit prevents a concurrent assignment of a previewed student.
    if lock:
        db.query(Student.student_id).filter(Student.academic_level_id == source.academic_level_id).order_by(Student.student_id).with_for_update().all()

    selected_memberships = db.query(StudentClass).filter(
        StudentClass.class_id.in_([item.class_id for item in classes]),
        StudentClass.academic_year_id == source.academic_year_id,
    ).order_by(StudentClass.class_id, StudentClass.student_id).all()
    existing = {str(item.class_id): [] for item in classes}
    for membership in selected_memberships:
        existing[str(membership.class_id)].append(membership.student_id)

    assigned_in_year = select(StudentClass.student_id).where(StudentClass.academic_year_id == source.academic_year_id)
    candidates = db.query(Student).filter(
        Student.academic_level_id == source.academic_level_id,
        ~Student.student_id.in_(assigned_in_year),
    ).order_by(Student.student_id).all()
    candidate_ids = [item.student_id for item in candidates]
    gwa_by_student = {}
    existing_gwa = {}
    if mode == "gwa":
        gwa_by_student = {item.student_id: resolve_student_gwa(db, item, source.academic_year_id) for item in candidates}
        existing_gwa = {item.student_id: resolve_student_gwa(db, item.student_id, source.academic_year_id) for item in selected_memberships}
        missing = sum(value is None for value in gwa_by_student.values()) + sum(value is None for value in existing_gwa.values())
        if missing:
            raise HTTPException(status_code=422, detail=f"GWA is unavailable for {missing} student(s) in the selected pool or rosters. Choose alphabetical distribution or complete their prior grades.")

    section_ids = [str(item.class_id) for item in classes]
    result = distribute_students_balanced(
        db, source.academic_level_id, section_ids, candidate_ids, existing,
        mode=mode, academic_year_id=source.academic_year_id,
    )
    if assignment_overrides is not None:
        override_ids = [student_id for student_id, _ in assignment_overrides]
        if len(override_ids) != len(candidate_ids) or set(override_ids) != set(candidate_ids):
            raise HTTPException(status_code=422, detail="Custom assignments must include each eligible unassigned student exactly once.")
        if any(class_id not in class_ids for _, class_id in assignment_overrides):
            raise HTTPException(status_code=422, detail="Custom assignments must use selected classes only.")
        result = {
            str(item.class_id): [str(student_id) for student_id in existing[str(item.class_id)]]
            + [str(student_id) for student_id, class_id in assignment_overrides if class_id == item.class_id]
            for item in classes
        }
    student_by_id = {str(item.student_id): item for item in candidates}
    roster_student_ids = {item.student_id for item in selected_memberships}
    if roster_student_ids:
        student_by_id.update({str(item.student_id): item for item in db.query(Student).filter(Student.student_id.in_(roster_student_ids)).all()})
    assignments = []
    class_rows = []
    for item in classes:
        class_key = str(item.class_id)
        existing_ids = {str(value) for value in existing[class_key]}
        added_ids = [student_id for student_id in result[class_key] if student_id not in existing_ids]
        genders = [normalized_text(student_by_id[student_id].gender) for student_id in result[class_key] if student_id in student_by_id]
        scores = [value for student_id in result[class_key]
                  if (value := gwa_by_student.get(uuid.UUID(student_id), existing_gwa.get(uuid.UUID(student_id)))) is not None]
        class_rows.append({
            "class_id": item.class_id, "section_name": item.section_name,
            "existing_count": len(existing_ids), "to_add_count": len(added_ids),
            "final_count": len(result[class_key]),
            "male_count": sum(gender in {"male", "m", "boy"} for gender in genders),
            "female_count": sum(gender in {"female", "f", "girl"} for gender in genders),
            "unspecified_count": sum(gender not in {"male", "m", "boy", "female", "f", "girl"} for gender in genders),
            "average_gwa": round(sum(scores) / len(scores), 2) if mode == "gwa" and scores else None,
        })
        for student_id in added_ids:
            student = student_by_id[student_id]
            assignments.append({
                "student_id": student_id, "class_id": item.class_id,
                "student_name": format_student_display_name(student),
                "gender": student.gender,
                "gwa": gwa_by_student.get(student.student_id),
            })

    snapshot_data = {
        "year": source.academic_year_id, "grade": source.academic_level_id, "mode": mode,
        "classes": [(item.class_id, item.section_name, item.pathway_id) for item in classes],
        "memberships": [(item.class_id, str(item.student_id), item.enrollment_status) for item in selected_memberships],
        "existing_gwa": [(str(student_id), value) for student_id, value in sorted(existing_gwa.items(), key=lambda entry: str(entry[0]))],
        "unassigned": [(str(item.student_id), item.first_name, item.middle_name, item.last_name, item.gender,
                        gwa_by_student.get(item.student_id)) for item in candidates],
        "plan": [(item["student_id"], item["class_id"]) for item in assignments],
    }
    snapshot = hashlib.sha256(json.dumps(snapshot_data, sort_keys=True).encode()).hexdigest()
    counts = [row["final_count"] for row in class_rows]
    return {
        "academic_year_id": source.academic_year_id,
        "academic_year_label": source.academic_year.year_label,
        "academic_level_id": source.academic_level_id,
        "grade_level": source.academic_level.grade_level,
        "mode": mode, "snapshot": snapshot,
        "unassigned_count": len(candidates),
        "classes": class_rows, "assignments": assignments,
        "imbalance": max(counts) - min(counts),
    }


def commit_existing_class_distribution(
    db: Session, source_class_id: int, class_ids: list[int], mode: Literal["alphabetical", "gwa"], snapshot: str,
    assignment_overrides: list[tuple[uuid.UUID, int]] | None = None,
) -> dict:
    try:
        preview = preview_existing_class_distribution(db, source_class_id, class_ids, mode, lock=True)
        if preview["snapshot"] != snapshot:
            raise HTTPException(status_code=409, detail="The available students or selected rosters changed. Recalculate the preview before saving.")
        if assignment_overrides is not None:
            preview = preview_existing_class_distribution(
                db, source_class_id, class_ids, mode, assignment_overrides=assignment_overrides,
            )
        if not preview["assignments"]:
            raise HTTPException(status_code=409, detail="No unassigned students remain for distribution.")
        classes = {item.class_id: item for item in db.query(Class).filter(Class.class_id.in_(class_ids)).all()}
        for assignment in preview["assignments"]:
            db.add(build_student_class_assignment(uuid.UUID(str(assignment["student_id"])), classes[assignment["class_id"]]))
        db.commit()
        return {**preview, "committed_count": len(preview["assignments"])}
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Student assignments changed during distribution. Recalculate the preview.") from exc
    except Exception:
        db.rollback()
        raise

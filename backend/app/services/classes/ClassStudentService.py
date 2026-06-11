from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.schemas.Class import UpdateClassStudentListRequest
from app.services.ClassManagement import normalized_text


def update_class_student_assignments(
    db: Session,
    class_id: int,
    payload: UpdateClassStudentListRequest,
) -> None:
    if not payload.removals and not payload.transfers:
        raise HTTPException(status_code=400, detail="Provide at least one student list change.")

    class_ = db.query(Class).filter(Class.class_id == class_id).first()
    if class_ is None:
        raise HTTPException(status_code=404, detail="Class not found.")
    if normalized_text(class_.class_status or "active") == "archived":
        raise HTTPException(
            status_code=409,
            detail="Archived classes cannot be modified. Restore the class before editing.",
        )

    removal_ids = [item.student_id for item in payload.removals]
    transfer_ids = [item.student_id for item in payload.transfers]
    if set(removal_ids).intersection(transfer_ids):
        raise HTTPException(status_code=400, detail="A student cannot be removed and transferred in the same request.")
    if len(set(removal_ids)) != len(removal_ids) or len(set(transfer_ids)) != len(transfer_ids):
        raise HTTPException(status_code=400, detail="Duplicate student changes are not allowed.")

    requested_student_ids = set(removal_ids + transfer_ids)
    assignments = {
        assignment.student_id: assignment
        for assignment in (
            db.query(StudentClass)
            .filter(StudentClass.class_id == class_.class_id)
            .filter(StudentClass.academic_year_id == class_.academic_year_id)
            .filter(StudentClass.student_id.in_(requested_student_ids))
            .all()
        )
    } if requested_student_ids else {}
    if set(assignments.keys()) != requested_student_ids:
        raise HTTPException(status_code=400, detail="Student is not assigned to this class.")

    target_class_ids = {item.target_class_id for item in payload.transfers}
    target_classes = {
        target.class_id: target
        for target in db.query(Class).filter(Class.class_id.in_(target_class_ids)).all()
    } if target_class_ids else {}
    for transfer in payload.transfers:
        target = target_classes.get(transfer.target_class_id)
        if target is None:
            raise HTTPException(status_code=404, detail="Target class not found.")
        if target.class_id == class_.class_id:
            raise HTTPException(status_code=400, detail="Target class must be different from the current class.")
        if target.academic_level_id != class_.academic_level_id:
            raise HTTPException(status_code=400, detail="Target class must use the same academic level.")
        if target.academic_year_id != class_.academic_year_id:
            raise HTTPException(status_code=400, detail="Target class must use the same academic year.")
        if normalized_text(target.class_status or "active") == "archived":
            raise HTTPException(status_code=400, detail="Target class must be active.")

    try:
        for student_id in removal_ids:
            db.delete(assignments[student_id])
        for transfer in payload.transfers:
            assignment = assignments[transfer.student_id]
            assignment.class_id = transfer.target_class_id
            assignment.academic_year_id = target_classes[transfer.target_class_id].academic_year_id
        db.commit()
    except Exception:
        db.rollback()
        raise

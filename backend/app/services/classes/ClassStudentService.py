from fastapi import HTTPException
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.academic.Class_ import Class
from app.models.academic.StudentCLass import StudentClass
from app.models.people.Student import Student
from app.schemas.Class import UpdateClassStudentListRequest
from app.services.classes.ClassShared import normalized_text
from app.services.classes.ClassService import build_student_class_assignment

# CLASS ROSTER WRITE FLOW
# The admin submits additions, removals, and transfers together. This service
# validates the complete request first, then commits every roster change at once.


def update_class_student_assignments(
    db: Session,
    class_id: int,
    payload: UpdateClassStudentListRequest,
) -> None:
    # Additions, removals, and transfers form one atomic roster change. Validate
    # every requested operation before mutating any StudentClass rows.
    if not payload.removals and not payload.transfers and not payload.additions:
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
    addition_ids = [item.student_id for item in payload.additions]
    removal_id_set = set(removal_ids)
    transfer_id_set = set(transfer_ids)
    addition_id_set = set(addition_ids)

    if removal_id_set.intersection(transfer_id_set):
        raise HTTPException(status_code=400, detail="A student cannot be removed and transferred in the same request.")
    if addition_id_set.intersection(removal_id_set):
        raise HTTPException(status_code=400, detail="A student cannot be added and removed in the same request.")
    if addition_id_set.intersection(transfer_id_set):
        raise HTTPException(status_code=400, detail="A student cannot be added and transferred in the same request.")
    if (
        len(removal_id_set) != len(removal_ids)
        or len(transfer_id_set) != len(transfer_ids)
        or len(addition_id_set) != len(addition_ids)
    ):
        raise HTTPException(status_code=400, detail="Duplicate student changes are not allowed.")

    requested_student_ids = removal_id_set | transfer_id_set
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

    # New assignments are locked while validating the academic-year uniqueness
    # rule; the database constraint remains the final concurrency safeguard.
    addition_students = {
        student.student_id: student
        for student in (
            db.query(Student)
            .filter(Student.student_id.in_(addition_id_set))
            .with_for_update()
            .all()
        )
    } if addition_id_set else {}
    if set(addition_students.keys()) != addition_id_set:
        raise HTTPException(status_code=404, detail="Student not found.")
    if any(student.academic_level_id != class_.academic_level_id for student in addition_students.values()):
        raise HTTPException(status_code=400, detail="Student must use the same academic level as the target class.")

    assigned_addition_ids = {
        student_id
        for student_id, in (
            db.query(StudentClass.student_id)
            .filter(StudentClass.student_id.in_(addition_id_set))
            .filter(StudentClass.academic_year_id == class_.academic_year_id)
            .all()
        )
    } if addition_id_set else set()
    if assigned_addition_ids:
        raise HTTPException(status_code=409, detail="Student is already assigned during this academic year.")

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

    # No roster row is changed until all source students, additions, and transfer
    # destinations have passed validation.
    try:
        for student_id in addition_ids:
            db.add(build_student_class_assignment(student_id, class_))
        for student_id in removal_ids:
            db.delete(assignments[student_id])
        for transfer in payload.transfers:
            assignment = assignments[transfer.student_id]
            assignment.class_id = transfer.target_class_id
            assignment.academic_year_id = target_classes[transfer.target_class_id].academic_year_id
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Student assignment conflicted with an existing academic-year assignment.",
        ) from exc
    except Exception:
        db.rollback()
        raise

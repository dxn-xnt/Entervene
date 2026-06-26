# app/api/v1/routes/Classworks.py
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, Query, Request, UploadFile
from sqlalchemy.orm import Session

from app.api.v1.routes.Auth import ACCESS_COOKIE_NAME
from app.core.Dependencies import get_staff_id, get_student_record, require_role
from app.core.FileUpload import delete_file, save_file
from app.db.Session import get_db
from app.schemas.Classwork import (
    ClassworkAssignRequest,
    ClassworkAssignmentResponse,
    ClassworkAttachmentResponse,
    ClassworkCreate,
    ClassworkResponse,
    ClassworkUpdate,
)
from app.services.classwork.ClassworkService import (
    add_classwork_attachment,
    archive_classwork_record,
    assign_classwork_to_classes,
    auth_payload_from_request,
    classwork_assignment_detail,
    classwork_detail,
    create_classwork_record,
    create_classwork_wizard_record,
    download_classwork_file,
    remove_classwork_attachment,
    student_assignments,
    student_classworks_for_subject,
    teacher_assignments_for_class_subject as teacher_assignments_for_class_subject_service,
    teacher_classes,
    teacher_classworks,
    unarchive_classwork_record,
    update_classwork_record,
)

router = APIRouter()


@router.post("/", response_model=ClassworkResponse)
def create_classwork(
    body: ClassworkCreate,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return create_classwork_record(body, staff_id, db)


@router.post("/with-assignments", response_model=ClassworkResponse)
async def create_classwork_with_assignments(
    title: str = Form(...),
    classwork_type: str = Form(...),
    subject_id: int = Form(...),
    description: Optional[str] = Form(None),
    instructions: Optional[str] = Form(None),
    classwork_category: Optional[str] = Form(None),
    total_points: Optional[float] = Form(100),
    is_published: bool = Form(False),
    class_ids: str = Form(...),
    lesson_ids: Optional[str] = Form(None),
    publish_date: Optional[datetime] = Form(None),
    due_date: Optional[datetime] = Form(None),
    lock_date: Optional[datetime] = Form(None),
    max_attempts: Optional[int] = Form(1),
    files: Optional[List[UploadFile]] = File(None),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return await create_classwork_wizard_record(
        title=title,
        classwork_type=classwork_type,
        subject_id=subject_id,
        description=description,
        instructions=instructions,
        classwork_category=classwork_category,
        total_points=total_points,
        is_published=is_published,
        class_ids=class_ids,
        lesson_ids=lesson_ids,
        due_date=due_date,
        lock_date=lock_date,
        max_attempts=max_attempts,
        files=files,
        staff_id=staff_id,
        db=db,
        save_file_func=save_file,
    )


@router.get("/my-classworks", response_model=List[ClassworkResponse])
def get_my_classworks(staff_id: str = Depends(get_staff_id), db: Session = Depends(get_db)):
    return teacher_classworks(staff_id, db)


@router.get("/classwork/{classwork_id}", response_model=ClassworkResponse)
def get_classwork(
    classwork_id: int,
    class_id: Optional[int] = Query(None, description="Optional class ID to get assignment-specific details"),
    current_user: dict = Depends(require_role("teacher", "admin", "student")),
    db: Session = Depends(get_db),
):
    return classwork_detail(classwork_id, class_id, current_user, db)


@router.put("/classwork/{classwork_id}", response_model=ClassworkResponse)
def update_classwork(
    classwork_id: int,
    body: ClassworkUpdate,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return update_classwork_record(classwork_id, body, staff_id, db)


@router.delete("/classwork/{classwork_id}")
def delete_classwork(classwork_id: int, staff_id: str = Depends(get_staff_id), db: Session = Depends(get_db)):
    return archive_classwork_record(classwork_id, staff_id, db)


@router.put("/classwork/{classwork_id}/archive")
def archive_classwork(classwork_id: int, staff_id: str = Depends(get_staff_id), db: Session = Depends(get_db)):
    return archive_classwork_record(classwork_id, staff_id, db)


@router.put("/classwork/{classwork_id}/unarchive")
def unarchive_classwork(classwork_id: int, staff_id: str = Depends(get_staff_id), db: Session = Depends(get_db)):
    return unarchive_classwork_record(classwork_id, staff_id, db)


@router.post("/classwork/{classwork_id}/attachments", response_model=ClassworkAttachmentResponse)
async def upload_cw_attachment(
    classwork_id: int,
    file: UploadFile = File(...),
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return await add_classwork_attachment(classwork_id, file, staff_id, db, save_file, delete_file)


@router.delete("/classwork/{classwork_id}/attachments/{attachment_id}")
def delete_cw_attachment(
    classwork_id: int,
    attachment_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return remove_classwork_attachment(classwork_id, attachment_id, staff_id, db, delete_file)


@router.get("/classwork/{classwork_id}/attachments/{attachment_id}/download")
def download_classwork_attachment(
    classwork_id: int,
    attachment_id: int,
    request: Request,
    token: Optional[str] = Query(None, description="JWT token as fallback for browser-based access"),
    inline: bool = Query(False, description="Display supported files in the browser instead of downloading"),
    db: Session = Depends(get_db),
):
    payload = auth_payload_from_request(request, ACCESS_COOKIE_NAME, token)
    return download_classwork_file(classwork_id, attachment_id, payload, inline, db)


@router.post("/classwork/{classwork_id}/assign")
def assign_classwork(
    classwork_id: int,
    body: ClassworkAssignRequest,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return assign_classwork_to_classes(classwork_id, body, staff_id, db)


@router.get("/class/{class_id}/subject/{subject_id}", response_model=List[ClassworkAssignmentResponse])
def get_cw_for_class(
    class_id: int,
    subject_id: int,
    student=Depends(get_student_record),
    db: Session = Depends(get_db),
):
    return student_classworks_for_subject(class_id, subject_id, student, db)


@router.get("/assignment/{assignment_id}", response_model=ClassworkAssignmentResponse)
def get_cw_assignment(
    assignment_id: int,
    current_user: dict = Depends(require_role("teacher", "admin", "student")),
    db: Session = Depends(get_db),
):
    return classwork_assignment_detail(assignment_id, current_user, db)


@router.get("/teacher/classes")
def get_teacher_classes(staff_id: str = Depends(get_staff_id), db: Session = Depends(get_db)):
    return teacher_classes(staff_id, db)


@router.get("/teacher/class/{class_id}/subject/{subject_id}/assignments", response_model=List[ClassworkAssignmentResponse])
def get_teacher_assignments_for_class_subject(
    class_id: int,
    subject_id: int,
    staff_id: str = Depends(get_staff_id),
    db: Session = Depends(get_db),
):
    return teacher_assignments_for_class_subject_service(class_id, subject_id, staff_id, db)


@router.get("/my-assignments")
def get_student_assignments(student=Depends(get_student_record), db: Session = Depends(get_db)):
    return student_assignments(student, db)

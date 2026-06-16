# app/schemas/Classwork.py
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class ClassworkCreate(BaseModel):
    title: str
    description: Optional[str] = None
    instructions: Optional[str] = None
    classwork_type: str  # QUIZ, ASSIGNMENT, ACTIVITY
    classwork_category: Optional[str] = None  # WRITTEN_WORK, PERFORMANCE_TASK, PERIODICAL_EXAM
    total_points: Optional[float] = 100
    subject_id: int
    is_published: Optional[bool] = False
    lesson_ids: Optional[list[int]] = None


class ClassworkUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    instructions: Optional[str] = None
    classwork_type: Optional[str] = None
    classwork_category: Optional[str] = None
    total_points: Optional[float] = None
    is_published: Optional[bool] = None
    lesson_ids: Optional[list[int]] = None


class ClassworkAttachmentResponse(BaseModel):
    classwork_attachment_id: int
    file_name: str
    file_type: Optional[str]
    file_size: int
    uploaded_at: Optional[datetime]


class CwAssignmentRow(BaseModel):
    classwork_assignment_id: int
    classwork_id: int
    class_id: int
    title: Optional[str] = None
    classwork_type: Optional[str] = None
    due_date: Optional[datetime] = None
    is_published: bool


class ClassworkResponse(BaseModel):
    classwork_id: int
    title: str
    description: Optional[str]
    instructions: Optional[str]
    classwork_type: str
    classwork_category: Optional[str]
    total_points: Optional[float]
    is_published: bool
    is_locked: bool
    subject_id: int
    subject_name: Optional[str] = None
    created_by_staff_id: str
    teacher_name: Optional[str] = None
    attachments: list[ClassworkAttachmentResponse] = []
    assignments: Optional[list[CwAssignmentRow]] = None
    created_at: Optional[datetime]
    updated_at: Optional[datetime]


class ClassworkAssignRequest(BaseModel):
    class_ids: list[int]
    publish_date: Optional[datetime] = None
    due_date: Optional[datetime] = None
    lock_date: Optional[datetime] = None
    max_attempts: Optional[int] = 1
    is_published: Optional[bool] = True


class ClassworkAssignmentResponse(BaseModel):
    """Class-specific classwork view used by student and teacher assignment pages."""
    classwork_assignment_id: int
    classwork_id: int
    class_id: int
    section_name: Optional[str] = None
    title: str
    description: Optional[str]
    instructions: Optional[str]
    classwork_type: str
    classwork_category: Optional[str]
    total_points: Optional[float]
    due_date: Optional[datetime]
    is_published: bool
    is_locked: Optional[bool] = False
    max_attempts: Optional[int] = 1
    teacher_name: Optional[str] = None
    attachments: list[ClassworkAttachmentResponse] = []
    assignments: Optional[list[CwAssignmentRow]] = None
    submission_status: Optional[str] = None  # for student view

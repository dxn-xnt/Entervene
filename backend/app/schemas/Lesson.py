# app/schemas/Lesson.py
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class LessonCreate(BaseModel):
    title: str
    description: Optional[str] = None
    content: Optional[str] = None
    subject_id: int
    order_index: Optional[int] = 1
    is_published: Optional[bool] = False
    is_draft: Optional[bool] = True


class LessonUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None
    order_index: Optional[int] = None
    is_published: Optional[bool] = None
    is_draft: Optional[bool] = None


class LessonAttachmentResponse(BaseModel):
    lesson_attachment_id: int
    file_name: str
    file_type: Optional[str]
    file_size: int
    uploaded_at: Optional[datetime]


class LessonResponse(BaseModel):
    lesson_id: int
    title: str
    description: Optional[str]
    content: Optional[str]
    order_index: int
    is_published: bool
    is_draft: bool
    is_locked: bool
    subject_id: int
    subject_name: Optional[str] = None
    created_by_staff_id: Optional[str]
    teacher_name: Optional[str] = None
    attachments: list[LessonAttachmentResponse] = []
    created_at: Optional[datetime]
    updated_at: Optional[datetime]


class LessonAssignRequest(BaseModel):
    class_ids: list[int]
    is_published: Optional[bool] = True

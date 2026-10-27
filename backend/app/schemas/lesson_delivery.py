from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class LessonDeliveryConfirmRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    lesson_id: int = Field(gt=0, description="The lesson that was taught")
    class_id: int = Field(gt=0, description="Class where the lesson was taught")
    subject_id: int = Field(gt=0, description="Subject of the lesson")
    academic_period_id: int = Field(gt=0, description="Grading period / term when delivered")


class LessonDeliveryCorrectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(
        min_length=3,
        max_length=500,
        description="Auditable reason for correcting or revoking the delivery confirmation",
    )


class LessonDeliveryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    delivery_id: int
    lesson_id: int
    lesson_title: Optional[str] = None
    class_id: int
    subject_id: int
    academic_period_id: int
    delivered_by_staff_id: Optional[str] = None
    delivered_at: datetime
    is_active: bool = True
    revoked_at: Optional[datetime] = None
    revoked_by_staff_id: Optional[str] = None
    correction_reason: Optional[str] = None
    created_at: Optional[datetime] = None


class LessonDeliveryStatusResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    lesson_id: int
    class_id: int
    subject_id: int
    academic_period_id: int
    is_delivered: bool
    active_delivery: Optional[LessonDeliveryResponse] = None
    history: list[LessonDeliveryResponse] = []

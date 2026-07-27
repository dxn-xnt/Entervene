from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from datetime import datetime

class LessonPlanBase(BaseModel):
    status: Optional[str] = "DRAFT"
    title: str = Field(..., max_length=255)
    learning_area: Optional[str] = Field(None, max_length=255)
    grade_section: Optional[str] = Field(None, max_length=255)
    date: Optional[str] = Field(None, max_length=255)
    sessions: Optional[str] = Field(None, max_length=255)
    references: Optional[str] = Field(None, max_length=1000)
    ai_declaration: Optional[str] = Field(None, max_length=1000)
    
    intentions: Optional[Dict[str, Any]] = None
    learning_experience: Optional[Dict[str, Any]] = None
    assessment: Optional[Dict[str, Any]] = None
    ways_forward: Optional[Dict[str, Any]] = None

class LessonPlanCreate(LessonPlanBase):
    pass

class LessonPlanUpdate(BaseModel):
    status: Optional[str] = Field(None, max_length=20)
    title: Optional[str] = Field(None, max_length=255)
    learning_area: Optional[str] = Field(None, max_length=255)
    grade_section: Optional[str] = Field(None, max_length=255)
    date: Optional[str] = Field(None, max_length=255)
    sessions: Optional[str] = Field(None, max_length=255)
    references: Optional[str] = Field(None, max_length=1000)
    ai_declaration: Optional[str] = Field(None, max_length=1000)
    
    intentions: Optional[Dict[str, Any]] = None
    learning_experience: Optional[Dict[str, Any]] = None
    assessment: Optional[Dict[str, Any]] = None
    ways_forward: Optional[Dict[str, Any]] = None

class LessonPlanResponse(LessonPlanBase):
    plan_id: int
    teacher_id: str
    created_at: Optional[datetime]
    updated_at: Optional[datetime]

    model_config = {"from_attributes": True}

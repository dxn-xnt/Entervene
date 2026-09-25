# app/schemas/Auth.py
from pydantic import BaseModel, EmailStr, Field


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=128)


class LoginResponse(BaseModel):
    role: str
    user_id: str
    full_name: str
    email: str
    login_log_id: int
    avatar: str | None = None


class AvatarUpdate(BaseModel):
    avatar: str

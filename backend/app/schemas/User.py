from pydantic import BaseModel, EmailStr
from typing import Literal


class InviteSingleUserRequest(BaseModel):
    first_name: str
    last_name: str
    middle_name: str = ""
    email: EmailStr
    role: Literal["Teacher", "Student", "Admin"]
    # Teacher fields
    suffix: str = ""
    dob: str = ""
    date_of_birth: str = ""
    gender: str = ""
    contact_number: str = ""
    address: str = ""
    hired_date: str = ""
    employment_status: str = ""
    # Student fields
    student_lrn: str = ""
    academic_level_id: int | None = None
    grade_level: int | None = None
    academic_level: str = ""


class UpdateUserRequest(BaseModel):
    first_name: str
    last_name: str
    middle_name: str = ""
    email: EmailStr
    account_status: str
    contact_number: str = ""
    address: str = ""
    employment_status: str = ""
    grade_level: int | None = None
    section: str | None = None


class AcceptInvitationRequest(BaseModel):
    token: str
    password: str
    confirm_password: str


class AcceptInvitationResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    user_id: str

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.db.Session import get_db
from app.core.Config import settings
from pydantic import BaseModel
import jwt
from datetime import datetime, timedelta, timezone

router = APIRouter()

class LoginRequest(BaseModel):
    email: str
    password: str

class LoginResponse(BaseModel):
    access_token: str
    token_type: str
    role: str
    user_id: str
    full_name: str

@router.post("/login", response_model=LoginResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    result = db.execute(text("""
        SELECT 
            ua.user_id,
            ua.email,
            ua.password_hash,
            ua.account_status,
            r.role_name,
            COALESCE(s.first_name || ' ' || s.last_name, 
                     st.first_name || ' ' || st.last_name) AS full_name
        FROM user_account ua
        JOIN user_roles ur ON ua.user_id = ur.user_id
        JOIN role r ON ur.role_id = r.role_id
        LEFT JOIN academic_staff s ON ua.user_id = s.user_id
        LEFT JOIN student st ON ua.user_id = st.user_id
        WHERE ua.email = :email
        LIMIT 1
    """), {"email": body.email}).fetchone()

    if not result:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if result.password_hash != body.password:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    if result.account_status != "active":
        raise HTTPException(status_code=403, detail="Account is inactive")

    role_map = {"Teacher": "teacher", "Student": "student", "Admin": "admin"}
    role = role_map.get(result.role_name, "student")

    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    token = jwt.encode(
        {"sub": str(result.user_id), "role": role, "exp": expire},
        settings.secret_key,
        algorithm=settings.algorithm,
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "role": role,
        "user_id": str(result.user_id),
        "full_name": result.full_name,
    }
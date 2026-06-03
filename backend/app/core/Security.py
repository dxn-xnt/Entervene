from datetime import datetime, timedelta, timezone
from jose import JWTError, jwt
from passlib.context import CryptContext
from app.core.Config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, password_hash: str) -> bool:
    return pwd_context.verify(plain_password, password_hash)


def is_password_hash(value: str | None) -> bool:
    return bool(value and value.startswith(("$2a$", "$2b$", "$2y$")))


def create_token(user_id: str, role: str, token_type: str, expires_delta: timedelta) -> str:
    expire = datetime.now(timezone.utc) + expires_delta
    # Numeric exp is required for reliable HS256 verification across python-jose versions.
    payload = {
        "sub": user_id,
        "role": role,
        "type": token_type,
        "exp": int(expire.timestamp()),
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def create_access_token(user_id: str, role: str) -> str:
    return create_token(
        user_id,
        role,
        "access",
        timedelta(minutes=settings.access_token_expire_minutes),
    )


def create_refresh_token(user_id: str, role: str) -> str:
    return create_token(
        user_id,
        role,
        "refresh",
        timedelta(days=settings.refresh_token_expire_days),
    )


def decode_token(token: str, expected_type: str | None = None) -> dict | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
        if expected_type and payload.get("type") != expected_type:
            return None
        return payload
    except JWTError:
        return None


def decode_access_token(token: str) -> dict | None:
    return decode_token(token, expected_type="access")

from datetime import datetime, timedelta, timezone
import bcrypt
from jose import JWTError, jwt
from app.core.Config import settings


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), password_hash.encode("utf-8"))
    except ValueError:
        return False


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
    # Lazy import to avoid circular dependency (SettingsCache → models → …)
    from app.core.SettingsCache import settings_cache

    # Dynamically fetch the TTL from the admin-configurable settings.
    # settings_cache.get() auto-parses "integer" type → returns int.
    # Falls back to 30 if the setting is missing (pre-migration or unseeded).
    ttl_minutes: int = settings_cache.get("session_timeout_minutes", default=30)

    return create_token(
        user_id,
        role,
        "access",
        timedelta(minutes=ttl_minutes),
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

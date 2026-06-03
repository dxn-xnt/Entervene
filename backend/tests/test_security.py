from app.core.Security import (
    create_access_token,
    create_refresh_token,
    decode_access_token,
    decode_token,
    hash_password,
    is_password_hash,
    verify_password,
)


def test_hash_password_uses_bcrypt_and_verifies_password():
    password_hash = hash_password("CorrectHorseBatteryStaple1!")

    assert password_hash != "CorrectHorseBatteryStaple1!"
    assert is_password_hash(password_hash)
    assert verify_password("CorrectHorseBatteryStaple1!", password_hash)
    assert not verify_password("wrong-password", password_hash)


def test_access_and_refresh_tokens_are_type_scoped():
    access = create_access_token("user-1", "student")
    refresh = create_refresh_token("user-1", "student")

    access_payload = decode_access_token(access)
    assert access_payload["sub"] == "user-1"
    assert access_payload["role"] == "student"
    assert access_payload["type"] == "access"

    assert decode_access_token(refresh) is None
    assert decode_token(refresh, expected_type="refresh")["sub"] == "user-1"

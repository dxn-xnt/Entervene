import uuid
from unittest.mock import MagicMock, patch
import pytest
from fastapi import BackgroundTasks, FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401
from app.api.v1.routes.Auth import get_current_user
from app.api.v1.routes.Users import router as users_router
from app.db.Base import Base
from app.db.Session import get_db
from app.models.academic.AcademicLevel import AcademicLevel
from app.models.auth.InvitationToken import InvitationToken
from app.models.auth.Role import Role
from app.models.auth.UserAccount import UserAccount
from app.models.auth.UserRoles import UserRoles
from app.models.people.AcademicStaff import AcademicStaff
from app.models.people.Student import Student
from app.services.MailService import send_batch_invitations, send_invitation_email
from app.services.users.UserInvitationService import resend_user_invitation
from app.services.users.UserShared import sha256_token


@pytest.fixture
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    session = sessionmaker(bind=engine)()
    session.add_all([
        Role(role_id=1, role_name="Admin"),
        Role(role_id=2, role_name="Teacher"),
        Role(role_id=3, role_name="Student"),
        AcademicLevel(level_name="Grade 7", grade_level=7),
    ])
    session.commit()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)
        engine.dispose()


@pytest.fixture
def client(db):
    test_app = FastAPI()
    test_app.include_router(users_router, prefix="/api/v1")
    test_app.dependency_overrides[get_db] = lambda: db
    test_app.dependency_overrides[get_current_user] = lambda: {
        "sub": str(uuid.uuid4()),
        "role": "admin",
    }
    with TestClient(test_app) as test_client:
        yield test_client
    test_app.dependency_overrides.clear()


def test_send_batch_invitations_console_driver(monkeypatch):
    monkeypatch.setenv("MAIL_DRIVER", "console")
    monkeypatch.setenv("APP_ENVIRONMENT", "test")
    monkeypatch.setenv("DEMO_INVITATION_LINKS_ENABLED", "true")
    items = [
        {"email": "user1@example.com", "token": "token1", "user_id": str(uuid.uuid4())},
        {"email": "user2@example.com", "token": "token2", "user_id": str(uuid.uuid4())},
    ]
    result = send_batch_invitations(items, delay_seconds=0)
    assert result["sent"] == ["user1@example.com", "user2@example.com"]
    assert result["failed"] == []


def _configure_demo_smtp(monkeypatch, *, environment="development", link_logging="true"):
    monkeypatch.setenv("APP_ENVIRONMENT", environment)
    monkeypatch.setenv("DEMO_INVITATION_LINKS_ENABLED", link_logging)
    monkeypatch.setenv("MAIL_DRIVER", "smtp")
    monkeypatch.setenv("FRONTEND_URL", "http://localhost:5173")
    monkeypatch.setenv("SMTP_USER", "sender@example.com")
    monkeypatch.setenv("SMTP_PASSWORD", "test-only-password")


def test_demo_smtp_logs_invitation_link_and_still_sends(monkeypatch, caplog):
    _configure_demo_smtp(monkeypatch)
    token = "demo-terminal-token"
    smtp = MagicMock()

    with (
        patch("smtplib.SMTP", return_value=smtp),
        patch("app.services.MailService.reserve_email", return_value=None),
        patch("app.services.MailService._update_user_email_status") as update_status,
    ):
        result = send_batch_invitations(
            [{"email": "demo@example.com", "token": token, "user_id": "demo-user"}],
            delay_seconds=0,
        )

    assert f"http://localhost:5173/setup-password?token={token}" in caplog.text
    assert smtp.sendmail.call_count == 1
    update_status.assert_called_once_with("demo-user", "sent")
    assert result == {"sent": ["demo@example.com"], "failed": []}


def test_smtp_does_not_log_raw_token_when_demo_logging_is_disabled(monkeypatch, caplog):
    _configure_demo_smtp(monkeypatch, link_logging="false")
    token = "must-not-appear-disabled"
    smtp = MagicMock()

    with (
        patch("smtplib.SMTP", return_value=smtp),
        patch("app.services.MailService.reserve_email", return_value=None),
        patch("app.services.MailService._update_user_email_status"),
    ):
        result = send_batch_invitations(
            [{"email": "private@example.com", "token": token, "user_id": "private-user"}],
            delay_seconds=0,
        )

    assert token not in caplog.text
    assert smtp.sendmail.call_count == 1
    assert result["sent"] == ["private@example.com"]


def test_production_suppresses_raw_token_even_when_demo_logging_is_requested(monkeypatch, caplog):
    _configure_demo_smtp(monkeypatch, environment="production", link_logging="true")
    token = "must-never-appear-in-production"
    smtp = MagicMock()

    with (
        patch("smtplib.SMTP", return_value=smtp),
        patch("app.services.MailService.reserve_email", return_value=None),
        patch("app.services.MailService._update_user_email_status"),
    ):
        result = send_batch_invitations(
            [{"email": "production@example.com", "token": token, "user_id": "production-user"}],
            delay_seconds=0,
        )

    assert token not in caplog.text
    assert smtp.sendmail.call_count == 1
    assert result["sent"] == ["production@example.com"]


def test_demo_link_does_not_turn_an_smtp_failure_into_success(monkeypatch, caplog):
    _configure_demo_smtp(monkeypatch)
    token = "logged-but-delivery-failed"
    smtp = MagicMock()
    smtp.sendmail.side_effect = RuntimeError("Delivery failed")

    with (
        patch("smtplib.SMTP", return_value=smtp),
        patch("app.services.MailService.reserve_email", return_value=None),
        patch("app.services.MailService._update_user_email_status") as update_status,
    ):
        result = send_batch_invitations(
            [{"email": "failed@example.com", "token": token, "user_id": "failed-user"}],
            delay_seconds=0,
        )

    assert f"setup-password?token={token}" in caplog.text
    update_status.assert_called_once_with("failed-user", "failed")
    assert result == {"sent": [], "failed": ["failed@example.com"]}


def test_batch_demo_links_are_logged_while_reusing_one_smtp_connection(monkeypatch, caplog):
    _configure_demo_smtp(monkeypatch)
    smtp = MagicMock()
    items = [
        {"email": "first@example.com", "token": "first-demo-token", "user_id": "first-user"},
        {"email": "second@example.com", "token": "second-demo-token", "user_id": "second-user"},
    ]

    with (
        patch("smtplib.SMTP", return_value=smtp) as smtp_class,
        patch("app.services.MailService.reserve_email", return_value=None),
        patch("app.services.MailService._update_user_email_status"),
    ):
        result = send_batch_invitations(items, delay_seconds=0)

    assert "setup-password?token=first-demo-token" in caplog.text
    assert "setup-password?token=second-demo-token" in caplog.text
    assert smtp_class.call_count == 1
    assert smtp.login.call_count == 1
    assert smtp.sendmail.call_count == 2
    assert result["sent"] == ["first@example.com", "second@example.com"]


def test_direct_single_sender_logs_demo_link_and_still_uses_smtp(monkeypatch, caplog):
    _configure_demo_smtp(monkeypatch)
    smtp = MagicMock()
    smtp.__enter__.return_value = smtp
    token = "direct-single-token"

    with (
        patch("smtplib.SMTP", return_value=smtp),
        patch("app.services.MailService.reserve_email", return_value=None),
    ):
        send_invitation_email("single@example.com", token)

    assert f"setup-password?token={token}" in caplog.text
    assert smtp.sendmail.call_count == 1


def test_send_batch_invitations_smtp_connection_reuse_and_error_isolation(monkeypatch):
    monkeypatch.setenv("MAIL_DRIVER", "smtp")
    monkeypatch.setenv("SMTP_USER", "sender@example.com")
    monkeypatch.setenv("SMTP_PASSWORD", "secret")

    mock_smtp_instance = MagicMock()
    # First email succeeds, second raises SMTPException, third succeeds
    def mock_sendmail(sender, recipients, msg_str):
        if "fail@example.com" in recipients:
            raise Exception("Delivery failed")
        return {}

    mock_smtp_instance.sendmail.side_effect = mock_sendmail

    with (
        patch("smtplib.SMTP", return_value=mock_smtp_instance) as mock_smtp_class,
        patch("app.services.MailService.reserve_email", return_value=None),
    ):
        items = [
            {"email": "ok1@example.com", "token": "tok1", "user_id": str(uuid.uuid4())},
            {"email": "fail@example.com", "token": "tok2", "user_id": str(uuid.uuid4())},
            {"email": "ok2@example.com", "token": "tok3", "user_id": str(uuid.uuid4())},
        ]
        result = send_batch_invitations(items, delay_seconds=0)

        # Verified SMTP was connected only ONCE for the entire batch
        assert mock_smtp_class.call_count == 1
        assert mock_smtp_instance.starttls.call_count == 1
        assert mock_smtp_instance.login.call_count == 1
        assert mock_smtp_instance.sendmail.call_count == 3
        assert mock_smtp_instance.quit.call_count == 1

        assert result["sent"] == ["ok1@example.com", "ok2@example.com"]
        assert result["failed"] == ["fail@example.com"]


def test_resend_user_invitation_service(db):
    user = UserAccount(
        user_id=uuid.uuid4(),
        email="pending@example.com",
        account_status="pending",
        email_status="failed",
    )
    db.add(user)
    db.commit()

    sent_emails = []
    def mock_sender(email, token):
        sent_emails.append((email, token))

    res = resend_user_invitation(db, user.user_id, mock_sender)
    assert "pending@example.com" in res["message"]
    assert len(sent_emails) == 1
    assert sent_emails[0][0] == "pending@example.com"
    assert user.email_status == "sent"

    # Token should exist in DB
    tokens = db.query(InvitationToken).filter(InvitationToken.user_id == user.user_id).all()
    assert len(tokens) == 1


def test_resend_user_invitation_endpoint(client, db):
    user = UserAccount(
        user_id=uuid.uuid4(),
        email="resend_api@example.com",
        account_status="pending",
        email_status="failed",
    )
    db.add(user)
    db.commit()

    with patch("app.api.v1.routes.Users.send_invitation_email") as mock_mail:
        response = client.post(f"/api/v1/users/{user.user_id}/resend-invitation")
        assert response.status_code == 200
        assert "resend_api@example.com" in response.json()["message"]
        mock_mail.assert_called_once()


def test_resend_user_invitation_invalidates_old_token(client, db):
    user = UserAccount(
        user_id=uuid.uuid4(),
        email="token_test@example.com",
        account_status="pending",
        email_status="failed",
    )
    db.add(user)
    db.add(UserRoles(user_id=user.user_id, role_id=3))  # Student role
    old_raw_token = "old_stale_token_abc"
    db.add(InvitationToken(user_id=user.user_id, token_hash=sha256_token(old_raw_token)))
    db.commit()

    # Verify initial token exists
    assert db.query(InvitationToken).filter(InvitationToken.token_hash == sha256_token(old_raw_token)).first() is not None

    captured_tokens = []
    def capture_sender(email, token):
        captured_tokens.append(token)

    resend_user_invitation(db, user.user_id, capture_sender)
    assert len(captured_tokens) == 1
    new_raw_token = captured_tokens[0]
    assert new_raw_token != old_raw_token

    # 1. Verify old token is no longer in the database
    old_record = db.query(InvitationToken).filter(InvitationToken.token_hash == sha256_token(old_raw_token)).first()
    assert old_record is None

    # 2. Attempting to accept with old token fails
    old_res = client.post("/api/v1/auth/accept-invitation", json={
        "token": old_raw_token,
        "password": "Password123!",
        "confirm_password": "Password123!",
    })
    assert old_res.status_code == 400
    assert "Invalid invitation link" in old_res.json()["detail"]

    # 3. Accepting with new token succeeds
    new_res = client.post("/api/v1/auth/accept-invitation", json={
        "token": new_raw_token,
        "password": "Password123!",
        "confirm_password": "Password123!",
    })
    assert new_res.status_code == 200
    assert new_res.json()["user_id"] == str(user.user_id)


def test_resend_logs_and_sends_only_the_new_invitation_link(monkeypatch, caplog, db):
    _configure_demo_smtp(monkeypatch)
    user = UserAccount(
        user_id=uuid.uuid4(),
        email="resend_demo@example.com",
        account_status="pending",
        email_status="failed",
    )
    old_raw_token = "old-resend-token-must-disappear"
    db.add(user)
    db.add(InvitationToken(user_id=user.user_id, token_hash=sha256_token(old_raw_token)))
    db.commit()
    smtp = MagicMock()

    with (
        patch("smtplib.SMTP", return_value=smtp),
        patch("app.services.MailService.reserve_email", return_value=None),
        patch("app.services.MailService._update_user_email_status"),
    ):
        resend_user_invitation(
            db,
            user.user_id,
            batch_invitation_sender=send_batch_invitations,
        )

    remaining = db.query(InvitationToken).filter(InvitationToken.user_id == user.user_id).one()
    logged_link_line = next(line for line in caplog.text.splitlines() if "| Link :" in line)
    new_raw_token = logged_link_line.split("token=", 1)[1].strip().rstrip("|").strip()

    assert old_raw_token not in caplog.text
    assert new_raw_token != old_raw_token
    assert remaining.token_hash == sha256_token(new_raw_token)
    assert smtp.sendmail.call_count == 1


def test_user_account_model_default_email_status(db):
    """Ensure inserting a UserAccount without specifying email_status defaults to 'pending'."""
    user = UserAccount(
        user_id=uuid.uuid4(),
        email="default_test@example.com",
        account_status="pending",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    assert user.email_status == "pending"

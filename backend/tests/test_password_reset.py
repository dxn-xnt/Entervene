from types import SimpleNamespace

import pytest
from fastapi import BackgroundTasks, HTTPException

from app.api.v1.routes.Auth import forgot_password, reset_password
from app.core.Security import hash_password, verify_password
from app.schemas.Auth import ForgotPasswordRequest, ResetPasswordRequest


class FakeQuery:
    def __init__(self, account):
        self.account = account

    def filter(self, *_args):
        return self

    def first(self):
        return self.account


class FakeDb:
    def __init__(self, account):
        self.account = account
        self.commits = 0

    def query(self, *_args):
        return FakeQuery(self.account)

    def commit(self):
        self.commits += 1


def test_password_reset_is_one_use_and_only_for_active_accounts():
    account = SimpleNamespace(user_id="test-user", email="reset@example.com", account_status="active", password_hash=hash_password("old-password"))
    db = FakeDb(account)
    tasks = BackgroundTasks()
    response = forgot_password(ForgotPasswordRequest(email=account.email), tasks, db)
    assert "If this email" in response["message"]
    assert len(tasks.tasks) == 1
    token = tasks.tasks[0].args[1]

    reset_password(ResetPasswordRequest(token=token, password="new-password", confirm_password="new-password"), db)
    assert verify_password("new-password", account.password_hash)
    assert db.commits == 1
    with pytest.raises(HTTPException) as reused:
        reset_password(ResetPasswordRequest(token=token, password="another-password", confirm_password="another-password"), db)
    assert reused.value.status_code == 400

    account.account_status = "pending"
    pending_tasks = BackgroundTasks()
    assert forgot_password(ForgotPasswordRequest(email=account.email), pending_tasks, db) == response
    assert pending_tasks.tasks == []


def test_forgot_password_does_not_reveal_unknown_email():
    tasks = BackgroundTasks()
    response = forgot_password(ForgotPasswordRequest(email="missing@example.com"), tasks, FakeDb(None))
    assert response["message"] == "If this email has an active account, a reset link has been sent."
    assert tasks.tasks == []

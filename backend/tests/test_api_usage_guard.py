import asyncio
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, patch

import httpx
import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from pydantic import ValidationError
from sqlalchemy import create_engine, select

from app.core.Config import settings
from app.core.RequestLimits import RequestLimitsMiddleware, WindowLimiter
from app.schemas.AIQuiz import AIQuizGenerateRequest
from app.schemas.AITOS import AITOSGenerateRequest
from app.services.ai import UsageGuard as guard
from app.services.ai.Provider import generate_text


@pytest.fixture
def usage_db(tmp_path):
    db = create_engine("sqlite:///" + str(tmp_path / "usage.db"), connect_args={"timeout": 20})
    guard.metadata.create_all(db)
    yield db
    db.dispose()


def test_concurrent_workers_cannot_overspend(usage_db, monkeypatch):
    monkeypatch.setattr(settings, "ai_school_per_minute", 3)
    now = datetime(2026, 9, 13, tzinfo=timezone.utc)

    def attempt(i):
        try:
            guard.reserve_call(str(i), str(i), now=now, bind=usage_db)
            return True
        except HTTPException as exc:
            assert exc.status_code == 429
            return False

    with ThreadPoolExecutor(max_workers=8) as pool:
        assert sum(pool.map(attempt, range(20))) == 3
    with usage_db.connect() as conn:
        spent = conn.execute(select(guard.counters.c.used).where(guard.counters.c.scope == "school_budget")).scalar_one()
    assert spent == 30000  # failed multi-bucket transactions rolled back


def test_duplicate_and_daily_limits_survive_new_connection(usage_db, monkeypatch):
    monkeypatch.setattr(settings, "ai_staff_per_day", 1)
    now = datetime(2026, 9, 13, tzinfo=timezone.utc)
    guard.reserve_call("teacher", "prompt", now=now, bind=usage_db)
    for minute in [0, 2]:
        with pytest.raises(HTTPException) as caught:
            guard.reserve_call("teacher", "prompt", now=now + timedelta(minutes=minute), bind=usage_db)
        assert caught.value.status_code == 429
    guard.reserve_call("teacher", "prompt", now=now + timedelta(days=1), bind=usage_db)


def test_zero_budget_and_missing_tables_fail_closed(usage_db, monkeypatch):
    monkeypatch.setattr(settings, "ai_monthly_budget_usd", 0)
    with pytest.raises(HTTPException) as caught:
        guard.reserve_call("a", "b", bind=usage_db)
    assert caught.value.status_code == 429
    empty = create_engine("sqlite://")
    with pytest.raises(HTTPException) as caught:
        guard.reserve_call("a", "b", bind=empty)
    assert caught.value.status_code == 503
    empty.dispose()


def test_monthly_budget_and_rollover(usage_db, monkeypatch):
    monkeypatch.setattr(settings, "ai_monthly_budget_usd", 1)
    with usage_db.begin() as conn:
        conn.execute(guard.counters.insert().values(scope="school_budget", period="2026-09", used=990000))
    now = datetime(2026, 9, 13, tzinfo=timezone.utc)
    guard.reserve_call("a", "first", now=now, bind=usage_db)
    with pytest.raises(HTTPException) as caught:
        guard.reserve_call("b", "second", now=now, bind=usage_db)
    assert caught.value.status_code == 429
    guard.reserve_call("a", "first", now=now.replace(month=10), bind=usage_db)


def test_email_recipient_quota(usage_db):
    guard.reserve_email("teacher@school.test", bind=usage_db)
    with pytest.raises(HTTPException) as caught:
        guard.reserve_email("TEACHER@school.test", bind=usage_db)
    assert caught.value.status_code == 429


def test_model_cache_reuses_load_and_invalidates_on_change(tmp_path):
    from app.services.prediction.ModelScoringService import load_model_artifact, _load_cached_model
    artifact = tmp_path / "model.joblib"
    artifact.write_bytes(b"first")
    _load_cached_model.cache_clear()
    try:
        with patch("app.services.prediction.ModelScoringService.joblib.load", side_effect=["first-model", "new-model"]) as loader:
            assert load_model_artifact(str(artifact)) == "first-model"
            assert load_model_artifact(str(artifact)) == "first-model"
            assert loader.call_count == 1
            artifact.write_bytes(b"second-version")
            assert load_model_artifact(str(artifact)) == "new-model"
            assert loader.call_count == 2
    finally:
        _load_cached_model.cache_clear()


def test_provider_failure_circuit(usage_db):
    for _ in range(5):
        guard.record_failure(bind=usage_db)
    with pytest.raises(HTTPException) as caught:
        guard.reserve_call("a", "b", bind=usage_db)
    assert caught.value.status_code == 503


def test_provider_has_no_retries_or_fallback(monkeypatch):
    monkeypatch.setattr(settings, "groq_api_key", "test-key")
    monkeypatch.setattr(settings, "gemini_api_key", "also-configured")
    monkeypatch.setattr(settings, "groq_model", "openai/gpt-oss-20b")
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(429, json={"error": "limited"})

    async def run():
        token = guard.actor.set("teacher")
        try:
            with patch("app.services.ai.Provider.reserve_call") as reserve, patch("app.services.ai.Provider.record_failure"), patch("app.services.ai.Provider.httpx.AsyncHTTPTransport", return_value=httpx.MockTransport(handler)):
                with pytest.raises(HTTPException) as caught:
                    await generate_text("prompt", "system")
                assert caught.value.status_code == 502
                reserve.assert_called_once()
        finally:
            guard.actor.reset(token)
    asyncio.run(run())
    assert len(calls) == 1
    assert calls[0].url.host == "api.groq.com"


def test_disabled_and_oversized_prompts_never_reserve(monkeypatch):
    async def run():
        token = guard.actor.set("teacher")
        try:
            with patch("app.services.ai.Provider.reserve_call") as reserve:
                monkeypatch.setattr(settings, "ai_enabled", False)
                with pytest.raises(HTTPException):
                    await generate_text("prompt", "system")
                monkeypatch.setattr(settings, "ai_enabled", True)
                with pytest.raises(HTTPException) as caught:
                    await generate_text("あ" * 6000, "system")
                assert caught.value.status_code == 422
                reserve.assert_not_called()
        finally:
            guard.actor.reset(token)
    asyncio.run(run())


def test_generation_bounds():
    with pytest.raises(ValidationError):
        AIQuizGenerateRequest(subject_id=1, test_parts=[{"count": 21}])
    with pytest.raises(ValidationError):
        AITOSGenerateRequest(subject_id=1, subject_name="Science", rows=[{"label": "x", "type_counts": {"ESSAY": -1}}])
    with pytest.raises(ValidationError):
        AITOSGenerateRequest(subject_id=1, subject_name="Science", rows=[{"label": "x", "type_counts": {"ESSAY": 1}}] * 4)


def test_limiter_bounded_memory_and_reset():
    limiter = WindowLimiter(capacity=2)
    assert limiter.allow("a", 1, now=0)
    assert not limiter.allow("a", 1, now=1)
    assert limiter.allow("b", 1, now=1)
    assert not limiter.allow("c", 1, now=1)
    assert limiter.allow("c", 1, now=60)
    assert len(limiter.entries) == 1


def test_streamed_body_limit():
    app = FastAPI()
    app.add_middleware(RequestLimitsMiddleware)

    @app.post("/api/v1/ai/test")
    async def endpoint(request: Request):
        await request.body()
        return {"ok": True}

    with TestClient(app) as client:
        assert client.post("/api/v1/ai/test", content=b"x" * 65537).status_code == 413


def test_students_cannot_read_tos_answer_keys():
    from app.api.v1.routes.TOS import router
    from app.api.v1.routes.Auth import get_current_user
    app = FastAPI()
    app.include_router(router, prefix="/tos")
    app.dependency_overrides[get_current_user] = lambda: {"role": "student", "sub": "student"}
    with TestClient(app) as client:
        assert client.get("/tos/1").status_code == 403
        assert client.get("/tos/subject/1").status_code == 403

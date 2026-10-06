"""All provider traffic mocked; billing uses only an isolated SQLite engine."""
import asyncio
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
import hashlib
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.pool import StaticPool

from app.services.ai import Provider as provider, UsageGuard as guard, tos_generation as service
from app.services.ai.tos_generation_session import exam_generation, current_generation


def item(number=1, **updates):
    return {"question_text": f"Distinct plant question {number}?", "question_type": "MULTIPLE_CHOICE",
            "difficulty_band": "EASY", "cognitive_level": "REMEMBER", "points": 1.0,
            "explanation": "An accurate rationale.", "options": ["Root", "Stem", "Leaf", "Flower"],
            "correct_index": 0, "passage_id": None, **updates}


@pytest.fixture
def isolated(monkeypatch):
    db = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    guard.metadata.create_all(db)
    monkeypatch.setattr(guard, "engine", db)
    monkeypatch.setattr(provider.settings, "ai_enabled", True)
    monkeypatch.setattr(provider.settings, "groq_api_key", "mock-only")
    monkeypatch.setattr(provider.settings, "gemini_api_key", None)
    monkeypatch.setattr(provider.settings, "groq_model", "openai/gpt-oss-20b")
    monkeypatch.setattr(provider.settings, "ai_staff_per_day", 100)
    monkeypatch.setattr(provider.settings, "ai_school_per_minute", 60)
    monkeypatch.setattr(provider.settings, "ai_school_per_day", 500)
    monkeypatch.setattr(provider.settings, "ai_monthly_budget_usd", 20)
    monkeypatch.setattr(provider.asyncio, "sleep", AsyncMock())
    monkeypatch.setattr(provider.random, "uniform", lambda *_: 0.125)
    monkeypatch.setattr(provider, "_execute_groq", AsyncMock(side_effect=AssertionError("Unexpected provider attempt")))
    monkeypatch.setattr(provider, "_execute_gemini", AsyncMock(side_effect=AssertionError("Unexpected provider attempt")))
    yield db
    db.dispose()


def credit_count(db):
    scope = "staff_day:" + hashlib.sha256(b"mock-teacher").hexdigest()
    with db.connect() as conn:
        return sum(conn.execute(select(guard.counters.c.used).where(guard.counters.c.scope == scope)).scalars().all())


async def generate_exam(count=2):
    token = guard.actor.set("mock-teacher")
    try:
        async with exam_generation("mock-teacher", Counter(MULTIPLE_CHOICE=count)) as operation:
            warnings = []
            questions = await service.generate_tos_row_questions("Plant structures", None, "Science",
                {"MULTIPLE_CHOICE": count}, {"REMEMBER": count}, warnings=warnings)
            operation.final = Counter(q["question_type"] for q in questions)
            operation.completed = True
        return questions, warnings, operation
    finally:
        guard.actor.reset(token)


@pytest.mark.parametrize("outcome,expected_count,expected_calls,expected_credit", [
    ("first", 2, 1, 1), ("repaired", 2, 2, 1), ("short", 1, 4, 0), ("empty", 0, 4, 0),
])
def test_final_exam_charged_once_regardless_of_overgeneration_or_repairs(isolated, monkeypatch, outcome,
                                                                        expected_count, expected_calls, expected_credit):
    good, bad = item(1), item(2, options=["Root", " Root ", "Leaf", "Flower"])
    first = [good, item(2), item(3)] if outcome == "first" else ([bad] if outcome == "empty" else [good, bad])
    outputs = [json.dumps({"questions": first})]
    outputs += [json.dumps({"questions": [item(4)]})] if outcome == "repaired" else [json.dumps({"questions": [bad]})] * 3
    execute = AsyncMock(side_effect=outputs)
    monkeypatch.setattr(provider, "_execute_groq", execute)
    questions, warnings, operation = asyncio.run(generate_exam())
    assert len(questions) == expected_count
    assert execute.call_count == expected_calls
    assert credit_count(isolated) == expected_credit
    assert operation.summary()["credits_charged"] == expected_credit
    assert operation.summary()["repair_rounds_used"] == (0 if outcome == "first" else 1 if outcome == "repaired" else 3)
    assert bool(warnings) == (outcome in {"short", "empty"})
    with isolated.connect() as conn:
        budget = conn.execute(select(guard.counters.c.used).where(guard.counters.c.scope == "school_budget")).scalar_one()
    assert budget == expected_calls * guard.RESERVATION_MICRO_USD


def upstream_error(status, retry_after=None):
    request = httpx.Request("POST", "https://mock-provider.invalid/generate")
    response = httpx.Response(status, request=request, headers={"Retry-After": retry_after} if retry_after else {})
    return httpx.HTTPStatusError("PRIVATE RESPONSE TEXT MUST NOT BE LOGGED", request=request, response=response)


@pytest.mark.parametrize("error", [upstream_error(429), upstream_error(408), upstream_error(500), upstream_error(503),
                                   upstream_error(599), httpx.ReadTimeout("private prompt"), TimeoutError("private prompt")])
def test_transient_errors_retry_twice_without_repairs_or_extra_credits(isolated, monkeypatch, error):
    execute = AsyncMock(side_effect=[error, error, json.dumps({"questions": [item(1), item(2), item(3)]})])
    monkeypatch.setattr(provider, "_execute_groq", execute)
    questions, warnings, operation = asyncio.run(generate_exam())
    assert len(questions) == 2 and not warnings
    assert execute.call_count == 3 and credit_count(isolated) == 1
    assert operation.transient_retries == 2 and operation.provider_attempts == 3
    assert operation.summary()["repair_rounds_used"] == 0
    assert [call.args[0] for call in provider.asyncio.sleep.call_args_list] == [1.125, 2.125]


@pytest.mark.parametrize("status", [400, 401, 403, 404, 422])
def test_non_transient_errors_stop_immediately_and_release_credit(isolated, monkeypatch, status):
    execute = AsyncMock(side_effect=upstream_error(status))
    monkeypatch.setattr(provider, "_execute_groq", execute)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(generate_exam())
    assert caught.value.status_code == 502 and execute.call_count == 1
    assert credit_count(isolated) == 0
    assert provider.asyncio.sleep.call_count == 0
    assert current_generation.get() is None


@pytest.mark.parametrize("error,status", [(upstream_error(429, "4"), 429), (upstream_error(503), 503),
                                         (httpx.ReadTimeout("private prompt"), 504)])
def test_exhausted_retries_release_credit_and_keep_provider_budget(isolated, monkeypatch, error, status):
    execute = AsyncMock(side_effect=error)
    monkeypatch.setattr(provider, "_execute_groq", execute)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(generate_exam())
    assert caught.value.status_code == status and execute.call_count == 3
    assert credit_count(isolated) == 0
    with isolated.connect() as conn:
        budget = conn.execute(select(guard.counters.c.used).where(guard.counters.c.scope == "school_budget")).scalar_one()
    assert budget == 3 * guard.RESERVATION_MICRO_USD
    if status == 429:
        assert caught.value.headers["Retry-After"] == "4"
        assert [call.args[0] for call in provider.asyncio.sleep.call_args_list] == [4, 4]


def test_retry_after_date_and_long_wait_bound(isolated, monkeypatch):
    response = httpx.Response(429, headers={"Retry-After": format_datetime(datetime.now(timezone.utc) + timedelta(seconds=10))})
    assert 8 <= provider._retry_after_seconds(response) <= 10
    execute = AsyncMock(side_effect=upstream_error(429, "120"))
    monkeypatch.setattr(provider, "_execute_groq", execute)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(generate_exam())
    assert execute.call_count == 1 and provider.asyncio.sleep.call_count == 0
    assert caught.value.headers["Retry-After"] == "120"
    assert credit_count(isolated) == 0


def test_local_limits_are_not_retried_and_cannot_be_bypassed(isolated, monkeypatch):
    monkeypatch.setattr(provider.settings, "ai_staff_per_day", 1)
    hold = guard.reserve_exam_credit("mock-teacher", "already-running")
    with pytest.raises(HTTPException) as caught:
        asyncio.run(generate_exam())
    assert caught.value.status_code == 429
    provider._execute_groq.assert_not_called()
    provider.asyncio.sleep.assert_not_called()
    assert credit_count(isolated) == 1
    guard.finalize_exam_credit(hold, 0)
    assert credit_count(isolated) == 0


def test_school_budget_rejection_refunds_exam_hold_without_sending_a_request(isolated, monkeypatch):
    monkeypatch.setattr(provider.settings, "ai_monthly_budget_usd", 0)
    with pytest.raises(HTTPException) as caught:
        asyncio.run(generate_exam())
    assert caught.value.status_code == 429
    provider._execute_groq.assert_not_called()
    assert credit_count(isolated) == 0


def test_finalize_receipt_is_idempotent_and_midnight_refunds_the_original_day(isolated):
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)
    hold = guard.reserve_exam_credit("mock-teacher", "yesterday", now=yesterday)
    guard.finalize_exam_credit(hold, 0)
    guard.finalize_exam_credit(hold, 0)
    assert credit_count(isolated) == 0
    hold = guard.reserve_exam_credit("mock-teacher", "today")
    guard.finalize_exam_credit(hold, 2)
    guard.finalize_exam_credit(hold, 2)
    guard.finalize_exam_credit(hold, 0)
    assert credit_count(isolated) == 1


def test_concurrent_credit_holds_never_exceed_daily_limit(monkeypatch, tmp_path):
    db = create_engine("sqlite:///" + str(tmp_path / "isolated-credit.db"), connect_args={"timeout": 20})
    guard.metadata.create_all(db)
    monkeypatch.setattr(provider.settings, "ai_staff_per_day", 1)
    def reserve(number):
        try:
            return guard.reserve_exam_credit("mock-teacher", str(number), bind=db)
        except HTTPException:
            return None
    with ThreadPoolExecutor(max_workers=6) as pool:
        holds = list(pool.map(reserve, range(8)))
    assert sum(hold is not None for hold in holds) == 1
    assert credit_count(db) == 1
    db.dispose()


def test_telemetry_counts_discards_and_never_logs_content_or_identity(isolated, monkeypatch, caplog):
    caplog.set_level("INFO")
    bad = item(2, options=["Root", " Root ", "Leaf", "Flower"], question_text="PRIVATE STUDENT CONTENT")
    execute = AsyncMock(side_effect=[json.dumps({"questions": [item(1), bad]}), json.dumps({"questions": [item(3)]})])
    monkeypatch.setattr(provider, "_execute_groq", execute)
    _, _, operation = asyncio.run(generate_exam())
    events = [record.getMessage() for record in caplog.records if record.name == "ai.tos.telemetry"]
    assert len(events) == 1
    summary = json.loads(events[0].split(" ", 1)[1])
    assert summary["first_pass_per_type"] == {"MULTIPLE_CHOICE": 1}
    assert summary["requested_per_type"] == {"MULTIPLE_CHOICE": 2}
    assert summary["discard_reasons"] == {"duplicate_options": 1}
    assert summary["repair_rounds_used"] == 1
    assert summary["final_shortfall_per_type"] == {"MULTIPLE_CHOICE": 0}
    assert summary["generation_id"] == operation.generation_id
    assert "PRIVATE STUDENT CONTENT" not in caplog.text and "mock-teacher" not in caplog.text
    assert "Distinct plant question" not in caplog.text


def test_provider_error_logs_only_status_and_counts(isolated, monkeypatch, caplog):
    caplog.set_level("INFO")
    monkeypatch.setattr(provider, "_execute_groq", AsyncMock(side_effect=upstream_error(503)))
    with pytest.raises(HTTPException):
        asyncio.run(generate_exam())
    assert "PRIVATE RESPONSE TEXT" not in caplog.text
    event = next(record.getMessage() for record in caplog.records if record.name == "ai.tos.telemetry")
    summary = json.loads(event.split(" ", 1)[1])
    assert summary["credits_charged"] == 0 and not summary["completed"]
    assert summary["final_shortfall_per_type"] == {"MULTIPLE_CHOICE": 2}


def test_multiple_rows_share_one_credit_and_one_summary(isolated, monkeypatch, caplog):
    caplog.set_level("INFO")
    monkeypatch.setattr(provider, "_execute_groq", AsyncMock(side_effect=[
        json.dumps({"questions": [item(1), item(2)]}), json.dumps({"questions": [item(3), item(4)]}),
    ]))
    async def run():
        token = guard.actor.set("mock-teacher")
        try:
            async with exam_generation("mock-teacher", Counter(MULTIPLE_CHOICE=2)) as op:
                questions = []
                for _ in range(2):
                    questions.extend(await service.generate_tos_row_questions("Plants", None, "Science", {"MULTIPLE_CHOICE": 1}, {"REMEMBER": 1}))
                op.final = Counter(q["question_type"] for q in questions)
                op.completed = True
        finally:
            guard.actor.reset(token)
    asyncio.run(run())
    assert credit_count(isolated) == 1
    assert sum(record.name == "ai.tos.telemetry" for record in caplog.records) == 1


def test_smoke_script_is_disabled_before_any_provider_import(monkeypatch, capsys):
    script = Path(__file__).parents[1] / "scripts" / "tos_generation_smoke.py"
    spec = importlib.util.spec_from_file_location("disabled_tos_smoke", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.delenv("TOS_LIVE_SMOKE", raising=False)
    assert module.main() == 2
    assert "disabled" in capsys.readouterr().out.lower()
    monkeypatch.setenv("TOS_LIVE_SMOKE", "1")
    monkeypatch.setenv("CI", "true")
    assert module.main() == 2
    assert "CI" in capsys.readouterr().out


def test_credit_finalization_failure_retains_hold_and_logs_uncertainty(isolated, monkeypatch, caplog):
    from app.services.ai import tos_generation_session as session
    caplog.set_level("INFO")
    monkeypatch.setattr(provider, "_execute_groq", AsyncMock(return_value=json.dumps({"questions": [item(1), item(2), item(3)]})))
    monkeypatch.setattr(session, "finalize_exam_credit", Mock(side_effect=HTTPException(503, "Credit guard unavailable")))
    with pytest.raises(HTTPException):
        asyncio.run(generate_exam())
    assert credit_count(isolated) == 1
    event = next(record.getMessage() for record in caplog.records if record.name == "ai.tos.telemetry")
    summary = json.loads(event.split(" ", 1)[1])
    assert summary["credit_hold_retained"] and not summary["completed"]
    assert summary["credits_charged"] == 0
    assert current_generation.get() is None


def test_api_multi_row_generation_charges_once_with_mock_subject_query(isolated, monkeypatch):
    from app.api.v1.routes import AIAssist as route
    from app.schemas.AITOS import AITOSGenerateRequest
    monkeypatch.setattr(provider, "_execute_groq", AsyncMock(side_effect=[
        json.dumps({"questions": [item(1), item(2)]}), json.dumps({"questions": [item(3), item(4)]}),
    ]))
    db = Mock()
    db.query.return_value.filter.return_value.first.return_value = SimpleNamespace(subject_name="Science", academic_level=None)
    body = AITOSGenerateRequest(subject_id=1, subject_name="Science", rows=[
        {"label": "Plants", "type_counts": {"MULTIPLE_CHOICE": 1}, "bloom_targets": {"REMEMBER": 1}},
        {"label": "Plant functions", "type_counts": {"MULTIPLE_CHOICE": 1}, "bloom_targets": {"REMEMBER": 1}},
    ])
    async def run():
        token = guard.actor.set("mock-teacher")
        try:
            return await route.generate_tos_questions(body, "mock-teacher", db)
        finally:
            guard.actor.reset(token)
    response = asyncio.run(run())
    assert len(response.questions) == 2 and not response.warnings
    assert credit_count(isolated) == 1
    db.commit.assert_not_called()
    db.add.assert_not_called()


def test_transient_retries_and_content_repairs_have_independent_budgets(isolated, monkeypatch):
    bad = item(2, options=["Root", "Root", "Leaf", "Flower"])
    execute = AsyncMock(side_effect=[upstream_error(503), upstream_error(503),
        json.dumps({"questions": [item(1), bad]}), json.dumps({"questions": [item(3)]})])
    monkeypatch.setattr(provider, "_execute_groq", execute)
    questions, warnings, operation = asyncio.run(generate_exam())
    assert len(questions) == 2 and not warnings
    assert operation.transient_retries == 2 and operation.provider_attempts == 4
    assert operation.summary()["repair_rounds_used"] == 1 and credit_count(isolated) == 1


def test_gemini_uses_the_same_retry_and_one_credit_policy(isolated, monkeypatch):
    monkeypatch.setattr(provider.settings, "groq_api_key", None)
    monkeypatch.setattr(provider.settings, "gemini_api_key", "mock-only")
    execute = AsyncMock(side_effect=[httpx.ReadTimeout("private text"), json.dumps({"questions": [item(1), item(2), item(3)]})])
    monkeypatch.setattr(provider, "_execute_gemini", execute)
    questions, warnings, operation = asyncio.run(generate_exam())
    assert len(questions) == 2 and not warnings
    assert operation.transient_retries == 1 and credit_count(isolated) == 1
    assert execute.call_count == 2
    assert all(call.args[2] == "gemini-2.5-flash-lite" for call in execute.call_args_list)
    provider._execute_groq.assert_not_called()


def test_tos_non_transient_failure_does_not_fall_back_even_in_development(isolated, monkeypatch):
    monkeypatch.setattr(provider.settings, "debug", True)
    monkeypatch.setattr(provider.settings, "gemini_api_key", "mock-only")
    monkeypatch.setattr(provider, "_execute_groq", AsyncMock(side_effect=upstream_error(401)))
    with pytest.raises(HTTPException):
        asyncio.run(generate_exam())
    provider._execute_gemini.assert_not_called()
    assert credit_count(isolated) == 0


def test_cancelled_generation_releases_credit_and_resets_context(isolated, monkeypatch):
    monkeypatch.setattr(provider, "_execute_groq", AsyncMock(side_effect=asyncio.CancelledError()))
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(generate_exam())
    assert credit_count(isolated) == 0
    assert current_generation.get() is None

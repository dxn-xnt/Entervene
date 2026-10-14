"""Mocked wire errors and smoke formatting only; never live provider traffic."""
import asyncio
from collections import Counter
import importlib.util
import json
from pathlib import Path
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from fastapi import HTTPException

from app.services.ai import Provider as provider, UsageGuard as guard, tos_generation as generation
from app.services.ai.provider_diagnostics import (
    current_call, provider_call_phase, record_provider_failure, safe_header_value,
    record_provider_usage, start_provider_call, token_count, token_usage_summary,
)
from app.services.ai.tos_generation_session import ExamGeneration, RowMetrics, current_generation


PRIVATE = "PRIVATE_QUESTION_PROMPT_PASSAGE_CREDENTIAL_SENTINEL"


def test_mc_option_discard_reason_and_missing_shape_cannot_echo_content(smoke, capsys):
    from app.services.ai.provider_diagnostics import mc_option_discard_detail
    detail = mc_option_discard_detail({"options": PRIVATE, PRIVATE: PRIVATE},
        PRIVATE, item_index=1)
    assert detail == {"item": 1, "reason": "unknown_validation", "option_count": None,
                      "empty_option_count": None, "empty_option_indexes": []}
    op = ExamGeneration(PRIVATE, Counter(MULTIPLE_CHOICE=1))
    op.rows = [RowMetrics(mc_option_discards=[{
        **detail, "repair_round": 1, "batch_offset": 0}])]
    smoke.print_results([("Grammar", op.summary(), "OK")], [])
    output = capsys.readouterr().out
    assert "round=1 batch=0 item=1 reason=unknown_validation" in output
    assert "options=None empty=None empty_indexes=[]" in output
    assert PRIVATE not in output and PRIVATE not in json.dumps(op.summary())


def test_recovery_counters_are_counts_only_in_summary_and_smoke(smoke, capsys):
    op = ExamGeneration(PRIVATE, Counter(MULTIPLE_CHOICE=2))
    op.rows = [RowMetrics(recovered_from_400=2, context_fields_filled=3,
                          discards=Counter(context_field_conflict=1))]
    summary = op.summary()
    assert summary["recovered_from_400"] == 2 and summary["context_fields_filled"] == 3
    assert summary["other_validation_reasons"] == {"context_field_conflict": 1}
    smoke.print_results([("Grammar", summary, "OK")], [])
    output = capsys.readouterr().out
    assert "recovered_from_400=2, context_fields_filled=3" in output
    assert "context_field_conflict=1" in output
    assert PRIVATE not in output and PRIVATE not in json.dumps(summary)


@pytest.fixture
def smoke():
    path = Path(__file__).parents[1] / "scripts" / "tos_generation_smoke.py"
    spec = importlib.util.spec_from_file_location("mocked_tos_smoke_diagnostics", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def response(status=400, code="json_validate_failed", error_type="invalid_request_error", headers=None):
    return httpx.Response(status, request=httpx.Request("POST", "https://mock.invalid"), headers=headers,
        json={"error": {"code": code, "type": error_type, "message": PRIVATE,
                        "failed_generation": PRIVATE, "details": [{"prompt": PRIVATE}]}})


def operation():
    return ExamGeneration("mock-only", Counter(MULTIPLE_CHOICE=5), provider_attempts=1)


@pytest.mark.parametrize("status,code", [(400, "json_validate_failed"), (429, "rate_limit_exceeded"),
    (500, "server_error"), (400, PRIVATE)])
def test_failure_output_contains_metadata_but_no_raw_content(smoke, capsys, status, code):
    op = operation()
    with provider_call_phase("repair", 2, 6, "MULTIPLE_CHOICE"):
        record_provider_failure(op, "Groq", response=response(status, code, headers={
            "retry-after": "7", "x-ratelimit-remaining-tokens": "1200",
            "x-ratelimit-reset-tokens": "2m59.56s", "authorization": PRIVATE}))
    op.rows = [RowMetrics(discards=Counter(missing_external_material=2, duplicate_options=3, surplus_cell=1))]
    op.final = Counter(MULTIPLE_CHOICE=1)
    smoke.print_results([("Grammar", op.summary(), "OK")], [("Grammar", row) for row in op.provider_failures])
    output = capsys.readouterr().out
    assert PRIVATE not in output and PRIVATE not in json.dumps(op.provider_failures)
    assert "Grammar | 1 | Groq | repair round 2 | MULTIPLE_CHOICE / 6" in output
    assert "True / 7" in output and "x-ratelimit-remaining-tokens=1200" in output
    assert "x-ratelimit-reset-tokens=2m59.56s" in output
    assert "external_material=2, duplicate_options=3, trimmed_over_target=0, other_validation=1" in output
    assert "Other validation reasons: surplus_cell=1" in output
    assert "count_mismatch(final_missing)=4" in output
    assert all(len(row["message"]) <= 200 for row in op.provider_failures)
    assert "authorization" not in output


@pytest.mark.parametrize("value", [PRIVATE, '"' + PRIVATE + '"', "7 " + PRIVATE,
    "7s " + PRIVATE, "gsk_mock_noncredential_" + PRIVATE, "200\n" + PRIVATE])
def test_untrusted_header_values_are_redacted(value):
    assert safe_header_value(value) == "[redacted]"


@pytest.mark.parametrize("value", ["12", "7.66s", "2m59.56s", "Tue, 06 Oct 2026 12:00:00 GMT"])
def test_supported_rate_header_values_preserved(value):
    assert safe_header_value(value) == value


def test_error_type_and_headers_cannot_echo_content(smoke, capsys):
    op = operation()
    record_provider_failure(op, "Groq", response=response(error_type=PRIVATE, headers={
        "retry-after": PRIVATE, "x-ratelimit-remaining-requests": PRIVATE}))
    smoke.print_results([], [("Grammar", op.provider_failures[0])])
    assert PRIVATE not in capsys.readouterr().out
    assert op.provider_failures[0]["retry_after_present"] is True
    assert op.provider_failures[0]["retry_after"] == "[redacted]"
    assert op.provider_failures[0]["error_type"] == "[redacted]"


@pytest.mark.parametrize("kind", ["Groq", "Gemini"])
def test_wire_capture_including_groq_recovered_400_has_no_content_or_duplicate(monkeypatch, kind, caplog):
    real_client = httpx.AsyncClient
    def handler(request):
        if kind == "Groq":
            return response(headers={"x-ratelimit-remaining-requests": "23"})
        return httpx.Response(400, json={"error": {"code": 400, "status": "INVALID_ARGUMENT", "message": PRIVATE}})
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler)))
    op = operation()
    async def run():
        token = current_generation.set(op)
        try:
            with provider_call_phase("passage", 1):
                if kind == "Groq":
                    assert await provider._execute_groq({}, {}, "mock-model") == PRIVATE
                else:
                    with pytest.raises(httpx.HTTPStatusError):
                        await provider._execute_gemini({}, {}, "mock-model")
            # Retry-wrapper capture of this same physical attempt is a no-op.
            record_provider_failure(op, kind, response=response())
        finally:
            current_generation.reset(token)
    asyncio.run(run())
    assert len(op.provider_failures) == 1
    row = op.provider_failures[0]
    assert row["http_status"] == 400 and row["provider"] == kind
    assert row["phase"] == "passage (repair round 1)"
    assert PRIVATE not in json.dumps(row) and PRIVATE not in caplog.text
    if kind == "Gemini":
        assert row["error_code"] == "400" and row["error_type"] == "INVALID_ARGUMENT"


@pytest.mark.parametrize("status", [429, 503])
def test_each_physical_retry_is_recorded_once_without_changing_retry_policy(monkeypatch, status):
    op = operation()
    op.provider_attempts = 0
    error = httpx.HTTPStatusError(PRIVATE, request=httpx.Request("POST", "https://mock.invalid"),
                                response=response(status, "rate_limit_exceeded" if status == 429 else "server_error"))
    execute = AsyncMock(side_effect=error)
    monkeypatch.setattr(provider, "_execute_groq", execute)
    monkeypatch.setattr(provider, "reserve_call", Mock())
    monkeypatch.setattr(provider, "record_failure", Mock())
    sleep = AsyncMock()
    monkeypatch.setattr(provider.asyncio, "sleep", sleep)
    async def run():
        with provider_call_phase("first-pass generation", question_type="ESSAY"):
            return await provider._execute_tos_with_retries(execute, {}, {}, "mock", "mock", "fingerprint", op)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(run())
    assert exc.value.status_code == (429 if status == 429 else 503)
    assert [row["call"] for row in op.provider_failures] == [1, 2, 3]
    assert all(row["phase"] == "first-pass generation" for row in op.provider_failures)
    assert PRIVATE not in json.dumps(op.provider_failures)
    assert execute.call_count == 3 and sleep.await_count == 2


def test_timeout_capture_does_not_print_exception_or_request(monkeypatch):
    op = operation()
    record_provider_failure(op, "Groq", exception=httpx.ReadTimeout(PRIVATE))
    assert op.provider_failures[0]["error_type"] == "timeout"
    assert op.provider_failures[0]["http_status"] is None
    assert not op.provider_failures[0]["retry_after_present"]
    assert PRIVATE not in json.dumps(op.provider_failures)


def test_cancelled_attempt_is_recorded_without_retry_or_content(monkeypatch):
    op = operation()
    op.provider_attempts = 0
    execute = AsyncMock(side_effect=asyncio.CancelledError(PRIVATE))
    monkeypatch.setattr(provider, "_execute_groq", execute)
    monkeypatch.setattr(provider, "reserve_call", Mock())
    with pytest.raises(asyncio.CancelledError):
        asyncio.run(provider._execute_tos_with_retries(execute, {}, {}, "mock", "mock", "fingerprint", op))
    assert execute.call_count == 1 and op.provider_failures[0]["error_type"] == "cancelled"
    assert PRIVATE not in json.dumps(op.provider_failures)


def test_generation_phase_changes_and_resets_during_content_repair(monkeypatch):
    op = operation()
    phases = []
    good = {"question_text": "Which plant part absorbs water?", "question_type": "MULTIPLE_CHOICE",
        "difficulty_band": "EASY", "cognitive_level": "REMEMBER", "points": 1.0,
        "explanation": "Roots absorb water.", "options": ["Root", "Stem", "Leaf", "Flower"],
        "correct_index": 0, "passage_id": None}
    async def generate(*args, **kwargs):
        phases.append(current_call.get())
        return json.dumps({"questions": [dict(good, options=["Root"] * 4)] if len(phases) == 1 else [good]})
    monkeypatch.setattr(generation, "generate_text", generate)
    async def run():
        token = current_generation.set(op)
        try:
            return await generation.generate_tos_row_questions("Plants", None, "Science", {"MULTIPLE_CHOICE": 1}, {"REMEMBER": 1})
        finally:
            current_generation.reset(token)
    assert len(asyncio.run(run())) == 1
    assert [phase[:2] for phase in phases] == [("first-pass generation", 0), ("repair", 1)]
    assert current_call.get()[0] == "unattributed"


@pytest.mark.parametrize("kind", ["Groq", "Gemini"])
def test_truncated_success_response_records_http_status_and_rate_headers(monkeypatch, kind):
    real_client = httpx.AsyncClient
    data = ({"choices": [{"finish_reason": "length", "message": {"content": PRIVATE}}]} if kind == "Groq"
            else {"candidates": [{"finishReason": "MAX_TOKENS", "content": {"parts": [{"text": PRIVATE}]}}]})
    mock_transport = httpx.MockTransport(lambda request: httpx.Response(200, json=data,
        headers={"x-ratelimit-remaining-tokens": "500"}))
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **kwargs: real_client(transport=mock_transport))
    op = operation()
    async def run():
        token = current_generation.set(op)
        try:
            with provider_call_phase("repair", 3, question_type="ESSAY"):
                execute = provider._execute_groq if kind == "Groq" else provider._execute_gemini
                with pytest.raises(ValueError, match="Incomplete generation"):
                    await execute({}, {}, "mock-model")
        finally:
            current_generation.reset(token)
    asyncio.run(run())
    row = op.provider_failures[0]
    assert row["http_status"] == 200 and row["error_type"] == "incomplete_generation"
    assert row["phase"] == "repair round 3" and row["rate_limits"]["x-ratelimit-remaining-tokens"] == "500"
    assert PRIVATE not in json.dumps(row)


def test_smoke_options_default_delay_and_case_insensitive_single_filter(smoke, monkeypatch):
    monkeypatch.delenv("SMOKE_DELAY_SECONDS", raising=False)
    monkeypatch.delenv("SMOKE_ONLY", raising=False)
    delay, selected = smoke.smoke_options()
    assert delay == 60 and len(selected) == 6
    monkeypatch.setenv("SMOKE_ONLY", " essay-heavy ")
    monkeypatch.setenv("SMOKE_DELAY_SECONDS", "12.5")
    delay, selected = smoke.smoke_options()
    assert delay == 12.5 and len(selected) == 1 and selected[0][3] == {"ESSAY": 12}


@pytest.mark.parametrize("value", ["-1", "inf", "nan", PRIVATE])
def test_invalid_smoke_delay_rejected_without_echoing_value(smoke, monkeypatch, value):
    monkeypatch.setenv("SMOKE_DELAY_SECONDS", value)
    with pytest.raises(ValueError) as exc:
        smoke.smoke_options()
    assert PRIVATE not in str(exc.value)


def test_invalid_smoke_filter_rejected_without_echoing_value(smoke, monkeypatch):
    monkeypatch.setenv("SMOKE_ONLY", PRIVATE)
    with pytest.raises(ValueError) as exc:
        smoke.smoke_options()
    assert PRIVATE not in str(exc.value)


def test_mocked_smoke_paces_only_between_exams_and_filters_before_generation(smoke, monkeypatch, capsys):
    monkeypatch.delenv("SMOKE_ONLY", raising=False)
    monkeypatch.setenv("SMOKE_DELAY_SECONDS", "60")
    monkeypatch.setattr(guard, "ai_configured", lambda: True)
    monkeypatch.setattr(guard, "engine", guard.engine)  # Restore after script's isolated-meter substitution.
    sleep = AsyncMock()
    monkeypatch.setattr(smoke.asyncio, "sleep", sleep)
    async def generate(label, code, subject, types, *args, **kwargs):
        op = current_generation.get()
        op.rows.append(RowMetrics(first_pass=Counter(types)))
        return [{"question_type": kind} for kind, count in types.items() for _ in range(count)]
    generate_mock = AsyncMock(side_effect=generate)
    monkeypatch.setattr(generation, "generate_tos_row_questions", generate_mock)
    assert asyncio.run(smoke.run_smoke()) == 0
    assert sleep.await_count == 5 and all(call.args == (60,) for call in sleep.await_args_list)
    assert generate_mock.await_count == 6
    assert "Smoke delay between exams: 60 seconds; selected exams: 6" in capsys.readouterr().out
    sleep.reset_mock()
    generate_mock.reset_mock()
    monkeypatch.setenv("SMOKE_ONLY", "Essay-heavy")
    assert asyncio.run(smoke.run_smoke()) == 0
    assert generate_mock.await_count == 1 and generate_mock.call_args.args[3] == {"ESSAY": 12}
    sleep.assert_not_awaited()
    output = capsys.readouterr().out
    assert "selected exams: 1" in output and "Essay-heavy" in output and "Grammar" not in output


@pytest.mark.parametrize("kind", ["Groq", "Gemini"])
@pytest.mark.parametrize("outcome", ["success", "truncated", "http_error"])
def test_wire_usage_for_success_and_failed_calls_is_count_only(monkeypatch, smoke, capsys, kind, outcome):
    real_client = httpx.AsyncClient
    usage = ({"usage": {"prompt_tokens": 120, "completion_tokens": 45, "total_tokens": 165,
                        "details": PRIVATE}} if kind == "Groq" else
             {"usageMetadata": {"promptTokenCount": 120, "candidatesTokenCount": 40,
                                "thoughtsTokenCount": 5, "totalTokenCount": 165,
                                "promptTokensDetails": [PRIVATE]}})
    if outcome == "http_error":
        data = {"error": {"code": "invalid_request_error", "message": PRIVATE}, **usage}
        status = 400
    elif kind == "Groq":
        data = {"choices": [{"finish_reason": "stop" if outcome == "success" else "length",
                             "message": {"content": PRIVATE}}], **usage}
        status = 200
    else:
        data = {"candidates": [{"finishReason": "STOP" if outcome == "success" else "MAX_TOKENS",
                                "content": {"parts": [{"text": PRIVATE}]}}], **usage}
        status = 200
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **kwargs: real_client(
        transport=httpx.MockTransport(lambda request: httpx.Response(status, json=data))))
    op = operation()
    payload = ({"max_completion_tokens": 3600, "messages": [PRIVATE]} if kind == "Groq" else
               {"generationConfig": {"maxOutputTokens": 3600}, "contents": [PRIVATE]})
    async def run():
        token = current_generation.set(op)
        try:
            with provider_call_phase("first-pass generation", 0, 6, "ESSAY"):
                execute = provider._execute_groq if kind == "Groq" else provider._execute_gemini
                if outcome == "success":
                    assert await execute(payload, {}, "mock") == PRIVATE
                else:
                    with pytest.raises((ValueError, httpx.HTTPStatusError)):
                        await execute(payload, {}, "mock")
        finally:
            current_generation.reset(token)
    asyncio.run(run())
    assert len(op.provider_calls) == 1
    row = op.provider_calls[0]
    assert (row["budget_requested"], row["prompt_tokens"], row["completion_tokens"], row["total_tokens"]) == (3600, 120, 45, 165)
    assert len(op.provider_failures) == int(outcome != "success")
    if op.provider_failures:
        assert op.provider_failures[0]["total_tokens"] == 165
    smoke.print_results([("Essay-heavy", op.summary(), "OK")],
                        [("Essay-heavy", row) for row in op.provider_failures],
                        [("Essay-heavy", row) for row in op.provider_calls])
    output = capsys.readouterr().out
    assert "Budget requested | Prompt tokens | Completion tokens | Total tokens" in output
    assert "Budget requested | Completion tokens | Prompt tokens | Total tokens" in output
    assert "3600 | 45 | 120 | 165" in output
    if outcome != "success":
        assert "3600 | 120 | 45 | 165" in output
    assert "requested_budget=3600, actual_total=165 (usage known 1/1 calls), peak_requested_budget_60s=3600" in output
    assert PRIVATE not in output and PRIVATE not in json.dumps(op.provider_calls)
    assert PRIVATE not in json.dumps(op.summary())


def test_recovered_groq_400_retains_usage_without_duplicate_call(monkeypatch):
    real_client = httpx.AsyncClient
    data = {"error": {"code": "json_validate_failed", "failed_generation": PRIVATE},
            "usage": {"prompt_tokens": 100, "completion_tokens": 20, "total_tokens": 120}}
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **kwargs: real_client(
        transport=httpx.MockTransport(lambda request: httpx.Response(400, json=data))))
    op = operation()
    async def run():
        token = current_generation.set(op)
        try:
            assert await provider._execute_groq({"max_completion_tokens": 850}, {}, "mock") == PRIVATE
        finally:
            current_generation.reset(token)
    asyncio.run(run())
    assert len(op.provider_calls) == len(op.provider_failures) == 1
    assert op.provider_failures[0]["total_tokens"] == 120
    assert op.provider_failures[0]["budget_requested"] == 850


@pytest.mark.parametrize("value", [PRIVATE, {"prompt": PRIVATE}, [PRIVATE], True, False, -1, 4.5, 10**13])
def test_usage_counts_cannot_contain_prose_or_invalid_numbers(value, smoke, capsys):
    assert token_count(value) is None
    op = operation()
    start_provider_call(op, "Groq", {"max_completion_tokens": 850})
    record_provider_usage(op, "Groq", {"usage": dict.fromkeys(
        ["prompt_tokens", "completion_tokens", "total_tokens"], value)})
    record_provider_usage(op, "Gemini", {"usageMetadata": dict.fromkeys(
        ["promptTokenCount", "candidatesTokenCount", "thoughtsTokenCount", "totalTokenCount"], value)})
    smoke.print_results([("Grammar", op.summary(), "OK")], [], [("Grammar", op.provider_calls[0])])
    output = capsys.readouterr().out
    assert "actual_total=unknown (usage known 0/1 calls)" in output
    assert "850 | - | - | -" in output and PRIVATE not in output


def test_absent_partial_and_zero_usage_remain_distinct_and_failures_update(smoke, capsys):
    op = operation()
    start_provider_call(op, "Groq", {"max_completion_tokens": 850})
    record_provider_failure(op, "Groq", exception=httpx.ReadTimeout(PRIVATE))
    record_provider_usage(op, "Groq", {"usage": {"completion_tokens": 0}})
    assert op.provider_failures[0]["completion_tokens"] == 0
    assert op.provider_failures[0]["prompt_tokens"] is None
    assert op.provider_failures[0]["total_tokens"] is None  # Do not invent a total.
    op.provider_attempts += 1
    start_provider_call(op, "Gemini", {"generationConfig": {"maxOutputTokens": 700}})
    record_provider_usage(op, "Gemini", {"usageMetadata": {"promptTokenCount": 30,
        "candidatesTokenCount": 10, "totalTokenCount": 40}})
    smoke.print_results([("Reading", op.summary(), "OK")], [], [("Reading", row) for row in op.provider_calls])
    output = capsys.readouterr().out
    assert "actual_total=40 (usage known 1/2 calls)" in output
    assert "850 | 0 | - | -" in output and "700 | 10 | 30 | 40" in output


@pytest.mark.parametrize("times,expected", [([0, 59, 60], 7200), ([0, 60, 120], 3600),
    ([0, 0, 0], 10800), ([0, 30, 59.999], 10800), ([0, 61, 122], 3600)])
def test_rolling_window_boundaries_and_duplicate_timestamps(monkeypatch, times, expected):
    from app.services.ai import provider_diagnostics as diagnostics
    ticks = iter(times)
    monkeypatch.setattr(diagnostics.time, "monotonic", lambda: next(ticks))
    op = operation()
    for index in range(3):
        op.provider_attempts = index + 1
        start_provider_call(op, "Groq", {"max_completion_tokens": 3600})
    summary = token_usage_summary(list(reversed(op.provider_calls)))
    assert summary["peak_requested_budget_60s"] == expected
    assert summary["requested_budget_total"] == 10800
    assert summary["actual_total_known_calls"] == 0
    assert token_usage_summary([])["peak_requested_budget_60s"] == 0


def test_retry_then_success_tracks_both_budgets_but_only_available_usage(monkeypatch):
    op = operation()
    op.provider_attempts = 0
    error_response = httpx.Response(429, request=httpx.Request("POST", "https://mock.invalid"),
        json={"error": {"code": "rate_limit_exceeded", "message": PRIVATE}})
    attempts = 0
    async def execute(*args):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise httpx.HTTPStatusError(PRIVATE, request=error_response.request, response=error_response)
        record_provider_usage(op, "Groq", {"usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150}})
        return PRIVATE
    monkeypatch.setattr(provider, "_execute_groq", execute)
    monkeypatch.setattr(provider, "reserve_call", Mock())
    monkeypatch.setattr(provider.asyncio, "sleep", AsyncMock())
    assert asyncio.run(provider._execute_tos_with_retries(execute, {"max_completion_tokens": 850}, {},
                                                       "mock", "mock", "fingerprint", op)) == PRIVATE
    assert len(op.provider_calls) == 2 and len(op.provider_failures) == 1
    usage = op.summary()["token_usage"]
    assert usage["requested_budget_total"] == usage["peak_requested_budget_60s"] == 1700
    assert usage["actual_total_tokens"] == 150 and usage["actual_total_known_calls"] == 1
    assert PRIVATE not in json.dumps(op.summary())


def test_budget_unknown_is_not_inferred_and_start_is_idempotent():
    op = operation()
    row = start_provider_call(op, "Groq")
    assert row["budget_requested"] is None
    assert start_provider_call(op, "Groq", {"max_completion_tokens": 700}) is row
    assert len(op.provider_calls) == 1 and row["budget_requested"] == 700


def test_mocked_smoke_collects_successful_calls_and_prints_usage(smoke, monkeypatch, capsys):
    monkeypatch.setenv("SMOKE_ONLY", "Essay-heavy")
    monkeypatch.setattr(guard, "ai_configured", lambda: True)
    monkeypatch.setattr(guard, "engine", guard.engine)
    async def generate(label, code, subject, types, *args, **kwargs):
        op = current_generation.get()
        op.provider_attempts = 1
        with provider_call_phase("first-pass generation", 0, 0, "ESSAY"):
            start_provider_call(op, "Groq", {"max_completion_tokens": 3600, "messages": [PRIVATE]})
            record_provider_usage(op, "Groq", {"usage": {"prompt_tokens": 200,
                "completion_tokens": 1000, "total_tokens": 1200}, "choices": PRIVATE})
        op.rows.append(RowMetrics(first_pass=Counter(types)))
        return [{"question_type": "ESSAY"} for _ in range(12)]
    monkeypatch.setattr(generation, "generate_tos_row_questions", generate)
    assert asyncio.run(smoke.run_smoke()) == 0
    output = capsys.readouterr().out
    assert "Essay-heavy | 1 | Groq | first-pass generation | ESSAY / 0 | 3600 | 1000 | 200 | 1200" in output
    assert "requested_budget=3600, actual_total=1200 (usage known 1/1 calls)" in output
    assert PRIVATE not in output


@pytest.mark.parametrize("raw,expected", [('{"questions":[', True),
    ('{"questions":[{"question_text":"cut off', True), ('{"questions":[{}]', True),
    ('{"questions": []}', False), ('not JSON', False), ('{"questions": invalid}', False),
    ('{"questions": [}', False), ('{"questions":["bad\\u12', True),
    ('{"questions":nul', True), ('{"questions":tru', True),
    ('{"questions":[{"points":1e+', True), ('{"questions":[{"points":1.', True)])
def test_cutoff_json_detection_does_not_retry_arbitrary_invalid_content(raw, expected):
    from app.services.ai.provider_diagnostics import is_truncated_json
    assert is_truncated_json(raw) is expected


@pytest.mark.parametrize("kind", ["Groq", "Gemini"])
@pytest.mark.parametrize("failure", ["finish_reason", "cut_json", "cut_wire_json"])
def test_real_adapter_mocked_truncation_fallback_keeps_one_credit_and_zero_repairs(monkeypatch, smoke, capsys, kind, failure):
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool
    from app.services.ai.tos_generation_session import exam_generation
    from test_tos_generation_repair import item
    real_client = httpx.AsyncClient
    meter = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    guard.metadata.create_all(meter)
    monkeypatch.setattr(guard, "engine", meter)
    monkeypatch.setattr(provider.settings, "ai_enabled", True)
    monkeypatch.setattr(provider.settings, "groq_api_key", "mock-only" if kind == "Groq" else None)
    monkeypatch.setattr(provider.settings, "gemini_api_key", "mock-only" if kind == "Gemini" else None)
    sent_budgets = []
    def handler(request):
        payload = json.loads(request.content)
        sent_budgets.append(payload["max_completion_tokens"] if kind == "Groq" else payload["generationConfig"]["maxOutputTokens"])
        first = len(sent_budgets) == 1
        headers = {"x-ratelimit-remaining-tokens": "1200", "x-ratelimit-reset-tokens": "7.66s", "authorization": PRIVATE}
        if first and failure == "cut_wire_json":
            return httpx.Response(200, content=b'{"candidates":[', headers=headers)
        content = ('{"questions":[{"question_text":"' + PRIVATE if first and failure == "cut_json" else
                   json.dumps({"questions": [item(kind="ESSAY")]}))
        finish = ("length" if kind == "Groq" else "MAX_TOKENS") if first and failure == "finish_reason" else ("stop" if kind == "Groq" else "STOP")
        data = ({"choices": [{"finish_reason": finish, "message": {"content": content}}],
                 "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150}} if kind == "Groq" else
                {"candidates": [{"finishReason": finish, "content": {"parts": [{"text": content}]}}],
                 "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 50, "totalTokenCount": 150}})
        return httpx.Response(200, json=data, headers=headers)
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler)))
    failure_meter = Mock()
    monkeypatch.setattr(provider, "record_failure", failure_meter)
    async def run():
        token = guard.actor.set("mock-only")
        try:
            async with exam_generation("mock-only", Counter(ESSAY=1)) as op:
                questions = await generation.generate_tos_row_questions("Plant structures", None, "Science", {"ESSAY": 1}, {"REMEMBER": 1})
                op.final = Counter(q["question_type"] for q in questions)
                op.completed = True
            return op
        finally:
            guard.actor.reset(token)
    try:
        op = asyncio.run(run())
        assert sent_budgets == [800, 1400]
        summary = op.summary()
        assert summary["credits_charged"] == 1 and summary["repair_rounds_used"] == 0
        assert summary["truncation_retries"] == 1 and summary["transient_retries"] == 0
        assert summary["first_pass_per_type"] == summary["final_per_type"] == {"ESSAY": 1}
        assert len(op.provider_calls) == 2 and len(op.provider_failures) == 1
        assert op.provider_calls[1]["phase"] == "first-pass generation (truncation retry)"
        assert op.provider_failures[0]["http_status"] == 200
        assert op.provider_failures[0]["rate_limits"]["x-ratelimit-remaining-tokens"] == "1200"
        assert PRIVATE not in json.dumps(op.provider_calls) and PRIVATE not in json.dumps(op.provider_failures)
        assert not summary["discard_reasons"]
        failure_meter.assert_not_called()
        smoke.print_results([("Essay-heavy", summary, "OK")], [("Essay-heavy", row) for row in op.provider_failures],
                            [("Essay-heavy", row) for row in op.provider_calls])
        output = capsys.readouterr().out
        assert "Truncation retries: 1" in output and "first-pass generation (truncation retry)" in output
        assert PRIVATE not in output
    finally:
        meter.dispose()


def test_failed_truncation_fallback_is_recorded_once_without_transient_retry(monkeypatch):
    from app.services.ai.provider_diagnostics import ProviderTruncationError
    op = operation()
    op.provider_attempts = 0
    execute = AsyncMock(side_effect=ProviderTruncationError())
    monkeypatch.setattr(provider, "_execute_groq", execute)
    monkeypatch.setattr(provider, "reserve_call", Mock())
    failure_meter = Mock()
    monkeypatch.setattr(provider, "record_failure", failure_meter)
    async def run():
        with provider_call_phase("repair", 2, 6, "ESSAY", truncation_retry=True):
            return await provider._execute_tos_with_retries(execute, {"max_completion_tokens": 3600}, {},
                                                         "mock", "mock", "fingerprint", op)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(run())
    assert exc.value.status_code == 502 and execute.await_count == 1
    assert op.transient_retries == 0
    assert op.provider_failures[0]["phase"] == "repair round 2 (truncation retry)"
    assert op.provider_failures[0]["budget_requested"] == 3600
    failure_meter.assert_called_once()


def test_passage_truncation_keeps_existing_policy_and_budget(monkeypatch):
    from app.services.ai.provider_diagnostics import ProviderTruncationError
    op = operation()
    op.provider_attempts = 0
    execute = AsyncMock(side_effect=ProviderTruncationError())
    monkeypatch.setattr(provider, "_execute_groq", execute)
    monkeypatch.setattr(provider, "reserve_call", Mock())
    monkeypatch.setattr(provider, "record_failure", Mock())
    async def run():
        with provider_call_phase("passage"):
            return await provider._execute_tos_with_retries(execute, {"max_completion_tokens": 700}, {},
                                                         "mock", "mock", "fingerprint", op)
    with pytest.raises(HTTPException):
        asyncio.run(run())
    assert execute.await_count == 1 and op.provider_calls[0]["budget_requested"] == 700
    assert not op.provider_calls[0]["truncation_retry"]


def test_trimmed_reserves_do_not_pollute_other_validation_or_echo_unknown_reasons(smoke, capsys):
    op = operation()
    op.rows = [RowMetrics(discards=Counter(trimmed_over_target=3, surplus_cell=2,
        invalid_schema=1, missing_external_material=4, duplicate_options=5, **{PRIVATE: 6}))]
    summary = op.summary()
    assert summary["discard_counts"] == {"external_material": 4, "duplicate_options": 5,
                                         "trimmed_over_target": 3, "other_validation": 9}
    assert summary["other_validation_reasons"] == {"surplus_cell": 2, "invalid_schema": 1, "unknown_validation": 6}
    smoke.print_results([("Grammar", summary, "OK")], [])
    output = capsys.readouterr().out
    assert "trimmed_over_target=3, other_validation=9" in output
    assert "unknown_validation=6" in output
    assert PRIVATE not in output and PRIVATE not in json.dumps(summary)


@pytest.mark.parametrize("kind", ["Groq", "Gemini"])
def test_other_finish_reasons_do_not_trigger_a_truncation_fallback(monkeypatch, kind):
    real_client = httpx.AsyncClient
    data = ({"choices": [{"finish_reason": "content_filter", "message": {"content": PRIVATE}}]} if kind == "Groq"
            else {"candidates": [{"finishReason": "SAFETY", "content": {"parts": [{"text": PRIVATE}]}}]})
    requests = []
    def handler(request):
        requests.append(request)
        return httpx.Response(200, json=data)
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(provider, "reserve_call", Mock())
    monkeypatch.setattr(provider, "record_failure", Mock())
    op = operation()
    op.provider_attempts = 0
    async def generate(prompt, system, **kwargs):
        execute = provider._execute_groq if kind == "Groq" else provider._execute_gemini
        payload = ({"max_completion_tokens": kwargs["max_tokens"]} if kind == "Groq" else
                   {"generationConfig": {"maxOutputTokens": kwargs["max_tokens"]}})
        return await provider._execute_tos_with_retries(execute, payload, {}, "mock", "mock", "fingerprint", op)
    monkeypatch.setattr(generation, "generate_text", generate)
    metrics = RowMetrics()
    async def run():
        token = current_generation.set(op)
        try:
            return await generation._generate_question_batch("mock", "ESSAY", 6, None, 0, 0, metrics)
        finally:
            current_generation.reset(token)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(run())
    assert exc.value.status_code == 502 and len(requests) == 1
    assert metrics.truncation_retries == 0 and op.transient_retries == 0


def test_smoke_lists_all_selected_names_and_clearly_shows_single_filter(smoke, monkeypatch, capsys):
    monkeypatch.delenv("SMOKE_ONLY", raising=False)
    monkeypatch.setattr(guard, "ai_configured", lambda: False)
    assert asyncio.run(smoke.run_smoke()) == 2
    output = capsys.readouterr().out
    assert "selected exams: 6" in output
    assert "Selected exam names: Grammar, Reading, Science, Mathematics, Filipino, Essay-heavy" in output
    monkeypatch.setenv("SMOKE_ONLY", "Essay-heavy")
    assert asyncio.run(smoke.run_smoke()) == 2
    output = capsys.readouterr().out
    assert "selected exams: 1" in output and "Selected exam names: Essay-heavy" in output
    assert "Grammar" not in output


@pytest.fixture(autouse=True)
def isolate_repeat_setting(monkeypatch):
    # A developer's process-level live-smoke preference cannot multiply tests.
    monkeypatch.delenv("SMOKE_REPEAT", raising=False)


def test_smoke_repeat_defaults_to_one_and_accepts_positive_integer(smoke, monkeypatch):
    assert smoke.smoke_repeat() == 1
    monkeypatch.setenv("SMOKE_REPEAT", "3")
    assert smoke.smoke_repeat() == 3


@pytest.mark.parametrize("value", ["0", "-1", "", "1.5", "inf", "nan", PRIVATE])
def test_invalid_repeat_rejected_before_generation_without_echoing_value(smoke, monkeypatch, value):
    monkeypatch.setenv("SMOKE_REPEAT", value)
    configured = Mock()
    monkeypatch.setattr(guard, "ai_configured", configured)
    with pytest.raises(ValueError) as exc:
        asyncio.run(smoke.run_smoke())
    assert str(exc.value) == "SMOKE_REPEAT must be a positive integer."
    assert PRIVATE not in str(exc.value)
    configured.assert_not_called()


def aggregate_sample(name="Grammar", *, first=5, repairs=0, calls=2, errors_400=0,
                     errors_429=0, final=None, completed=True, missing=0):
    return (name, {"requested_per_type": {"MULTIPLE_CHOICE": 5},
        "first_pass_per_type": {"MULTIPLE_CHOICE": first}, "repair_rounds_used": repairs,
        "provider_attempts": calls, "smoke_http_400": errors_400, "smoke_http_429": errors_429,
        "final_per_type": {"MULTIPLE_CHOICE": 5} if final is None else final,
        "final_shortfall_per_type": {"MULTIPLE_CHOICE": missing}, "completed": completed,
        "prompt": PRIVATE, "question_text": PRIVATE, "passage": PRIVATE, "credential": PRIVATE}, PRIVATE)


def test_repeat_aggregation_means_totals_and_target_counts_include_failures(smoke, capsys):
    samples = [aggregate_sample(first=3, repairs=2, calls=4, errors_400=2),
        aggregate_sample(), aggregate_sample(first=0, calls=3, errors_400=1, errors_429=2,
            completed=False, final={}, missing=5), aggregate_sample("Reading", calls=3),
        aggregate_sample(PRIVATE)]
    assert smoke.aggregate_results(samples) == [
        {"exam": "Grammar", "runs": 3, "mean_first_pass": 8 / 3, "mean_repairs": 2 / 3,
         "mean_provider_calls": 3.0, "total_400s": 3, "total_429s": 2, "at_target": 2},
        {"exam": "Reading", "runs": 1, "mean_first_pass": 5.0, "mean_repairs": 0.0,
         "mean_provider_calls": 3.0, "total_400s": 0, "total_429s": 0, "at_target": 1}]
    smoke.print_aggregate(samples)
    output = capsys.readouterr().out
    assert "Grammar | 3 | 2.67 | 0.67 | 3.00 | 3 | 2 | 2/3" in output
    assert "Reading | 1 | 5.00 | 0.00 | 3.00 | 0 | 0 | 1/1" in output
    assert PRIVATE not in output and PRIVATE not in json.dumps(smoke.aggregate_results(samples))
    for field in ("prompt", "question_text", "passage", "credential"):
        assert field not in output


@pytest.mark.parametrize("updates", [
    {"completed": False}, {"missing": 1}, {"final": {"MULTIPLE_CHOICE": 6}},
    {"final": {"MULTIPLE_CHOICE": 4, "ESSAY": 1}}, {"final": {}}])
def test_aggregate_target_requires_completed_exact_per_type_no_shortfall(smoke, updates):
    row = smoke.aggregate_results([aggregate_sample(**updates)])[0]
    assert row["runs"] == 1 and row["at_target"] == 0


def test_empty_aggregate_has_no_content(smoke, capsys):
    smoke.print_aggregate([])
    output = capsys.readouterr().out
    assert "Exams at target" in output and "(none)" in output


@pytest.mark.parametrize("only,expected_calls", [(None, 18), ("Essay-heavy", 3)])
def test_mocked_repeat_runs_selection_three_times_with_delay_at_run_boundary(
        smoke, monkeypatch, capsys, only, expected_calls):
    if only is None:
        monkeypatch.delenv("SMOKE_ONLY", raising=False)
    else:
        monkeypatch.setenv("SMOKE_ONLY", only)
    monkeypatch.setenv("SMOKE_REPEAT", "3")
    monkeypatch.setenv("SMOKE_DELAY_SECONDS", "60")
    monkeypatch.setattr(guard, "ai_configured", lambda: True)
    monkeypatch.setattr(guard, "engine", guard.engine)
    sleep = AsyncMock()
    monkeypatch.setattr(smoke.asyncio, "sleep", sleep)
    order = []
    async def generate(label, code, subject, types, *args, **kwargs):
        order.append(types.copy())
        op = current_generation.get()
        op.provider_attempts = 2
        op.rows.append(RowMetrics(first_pass=Counter(types)))
        return [{"question_type": kind} for kind, count in types.items() for _ in range(count)]
    generated = AsyncMock(side_effect=generate)
    monkeypatch.setattr(generation, "generate_tos_row_questions", generated)
    assert asyncio.run(smoke.run_smoke()) == 0
    assert generated.await_count == expected_calls
    assert sleep.await_count == expected_calls - 1
    assert all(call.args == (60,) for call in sleep.await_args_list)
    selected = [row[3] for row in smoke.BLUEPRINTS if only is None or row[0] == only]
    assert order == selected * 3
    output = capsys.readouterr().out
    assert f"Smoke repetitions: 3; total exam generations: {expected_calls}" in output
    assert all(f"Smoke repetition {n}/3" in output for n in (1, 2, 3))
    assert output.count("Aggregate across smoke repetitions") == 1
    assert "Essay-heavy | 3 | 12.00 | 0.00 | 2.00 | 0 | 0 | 3/3" in output
    assert PRIVATE not in output
    if only is None:
        assert "Grammar | 3 | 5.00 | 0.00 | 2.00 | 0 | 0 | 3/3" in output
    else:
        assert "Grammar" not in output


def test_mocked_repeated_failure_is_counted_and_nonzero_exit_is_preserved(smoke, monkeypatch, capsys):
    monkeypatch.setenv("SMOKE_ONLY", "Essay-heavy")
    monkeypatch.setenv("SMOKE_REPEAT", "3")
    monkeypatch.setattr(guard, "ai_configured", lambda: True)
    monkeypatch.setattr(guard, "engine", guard.engine)
    monkeypatch.setattr(smoke.asyncio, "sleep", AsyncMock())
    attempts = 0
    async def generate(label, code, subject, types, *args, **kwargs):
        nonlocal attempts
        attempts += 1
        op = current_generation.get()
        op.provider_attempts = 1
        if attempts == 2:
            record_provider_failure(op, "Groq", response=response(429, "rate_limit_exceeded"))
            raise HTTPException(429, PRIVATE)
        if attempts == 1:
            # A recovered HTTP 400 still counts as a wire error, even on success.
            record_provider_failure(op, "Groq", response=response())
        op.rows.append(RowMetrics(first_pass=Counter(types)))
        return [{"question_type": "ESSAY"} for _ in range(12)]
    monkeypatch.setattr(generation, "generate_tos_row_questions", generate)
    assert asyncio.run(smoke.run_smoke()) == 1
    output = capsys.readouterr().out
    assert "Essay-heavy | 3 | 8.00 | 0.00 | 1.00 | 1 | 1 | 2/3" in output
    assert PRIVATE not in output

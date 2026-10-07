"""Count-only recovered-output diagnostics and schema retries; no live traffic."""
import asyncio
from collections import Counter
import importlib.util
import json
from pathlib import Path
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.pool import StaticPool

from app.services.ai import Provider as provider, UsageGuard as guard, tos_generation as generation
from app.services.ai.provider_diagnostics import failed_generation_detail, current_schema_retry
from app.services.ai.tos_generation_session import current_generation, exam_generation
from test_tos_generation_repair import item

PRIVATE = "PRIVATE_PROMPT_QUESTION_PASSAGE_CREDENTIAL_SENTINEL"


@pytest.fixture
def smoke():
    path = Path(__file__).parents[1] / "scripts" / "tos_generation_smoke.py"
    spec = importlib.util.spec_from_file_location("mocked_schema_smoke", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def isolated(monkeypatch):
    meter = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    guard.metadata.create_all(meter)
    monkeypatch.setattr(guard, "engine", meter)
    monkeypatch.setattr(provider.settings, "ai_enabled", True)
    monkeypatch.setattr(provider.settings, "groq_api_key", "mock-only")
    monkeypatch.setattr(provider.settings, "gemini_api_key", None)
    monkeypatch.setattr(provider.settings, "groq_model", "openai/gpt-oss-20b")
    yield meter
    meter.dispose()


def test_recovered_schema_structure_redacts_values_keys_and_finish_reason():
    schema = generation.question_schema("MULTIPLE_CHOICE", 2, None)
    bad = item(explanation="  ", points=True, options=[" ", {PRIVATE: PRIVATE}], correct_index="0",
               **{PRIVATE: PRIVATE, "correct_answer": PRIVATE})
    del bad["cognitive_level"]
    raw = json.dumps({"questions": [bad, PRIVATE], PRIVATE: PRIVATE})
    detail = failed_generation_detail(raw, schema, finish_reason={PRIVATE: PRIVATE})
    assert detail["characters"] == len(raw) and detail["estimated_tokens"] == (len(raw) + 3) // 4
    assert detail["json_parses"] is True and detail["item_count"] == 2
    assert detail["top_level_key_counts"] == {"questions": 1, "[redacted]": 1}
    assert detail["root_problems"] == {"extra_property:[redacted]": 1}
    problems = detail["item_problems"][0]["problems"]
    assert problems["missing_field:cognitive_level"] == 1
    assert problems["wrong_type:points"] == problems["wrong_type:correct_index"] == 1
    assert problems["empty_value:explanation"] == problems["empty_value:options"] == 1
    assert problems["wrong_type:options"] == problems["option_count_wrong"] == 1
    assert problems["extra_property:[redacted]"] == problems["extra_property:correct_answer"] == 1
    assert detail["item_problems"][1] == {"item": 2, "problems": {"wrong_type:root": 1}}
    assert detail["finish_reason"] == "[redacted]" and PRIVATE not in json.dumps(detail)


@pytest.mark.parametrize("raw,state", [('{"questions":[', "looks_truncated"),
    ('{"questions":[{"explanation":"' + PRIVATE, "looks_truncated"),
    ('{"questions":[{"options":[' , "looks_truncated"),
    ('{"questions": invalid}', "malformed"), ('{"questions": [}', "malformed"),
    ('not JSON ' + PRIVATE, "malformed")])
def test_recovered_json_parse_failures_have_fixed_classification_only(raw, state):
    detail = failed_generation_detail(raw, generation.question_schema("ESSAY", 6, None))
    assert detail["json_parses"] is False and detail["parse_state"] == state
    assert not detail["top_level_key_counts"] and not detail["item_problems"]
    assert detail["item_count"] is None and PRIVATE not in json.dumps(detail)


def test_valid_essay_nulls_and_empty_options_are_not_schema_errors():
    candidate = item(kind="ESSAY")
    del candidate["question_type"], candidate["passage_id"]
    raw = json.dumps({"questions": [candidate]})
    detail = failed_generation_detail(raw, generation.question_schema("ESSAY", 1, None), finish_reason="length")
    assert detail["finish_reason"] == "length"
    assert detail["problem_counts"] == {} and detail["item_problems"] == [{"item": 1, "problems": {}}]


def test_inspection_is_bounded_and_counts_uninspected_items():
    raw = json.dumps({"questions": [{}] * 110})
    detail = failed_generation_detail(raw, generation.question_schema("ESSAY", 6, None))
    assert detail["item_count"] == 110 and detail["inspected_items"] == 100
    assert detail["uninspected_items"] == 10 and len(detail["item_problems"]) == 100
    detail = failed_generation_detail(PRIVATE * 10000)
    assert detail["parse_state"] == "not_inspected_size_limit" and detail["json_parses"] is None
    assert PRIVATE not in json.dumps(detail)


@pytest.mark.parametrize("failed_calls", [1, 2, 3])
@pytest.mark.parametrize("missing_only", [False, True])
def test_valid_recovery_needs_no_schema_retry_and_keeps_credit_and_repair_counts(
        isolated, monkeypatch, smoke, capsys, caplog, failed_calls, missing_only):
    real_client = httpx.AsyncClient
    payloads = []
    candidate = item(kind="ESSAY", question_text=PRIVATE)
    del candidate["question_type"], candidate["passage_id"]
    recovery = json.dumps({"questions": [candidate]})
    def handler(request):
        payloads.append(json.loads(request.content))
        if len(payloads) <= failed_calls:
            return httpx.Response(400, json={"error": {"code": "json_validate_failed",
                "type": "invalid_request_error", "message": PRIVATE, "failed_generation": recovery,
                "finish_reason": "stop"}, "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150}})
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": recovery}}],
                                       "usage": {"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150}})
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler)))
    failure_meter = Mock()
    monkeypatch.setattr(provider, "record_failure", failure_meter)
    caplog.set_level("INFO")
    async def run():
        token = guard.actor.set("mock-only")
        try:
            async with exam_generation("mock-only", Counter(ESSAY=1)) as op:
                questions = await generation.generate_tos_row_questions("Plant structures", None, "Science", {"ESSAY": 1},
                    {"REMEMBER": 1}, missing_only=missing_only)
                op.final = Counter(q["question_type"] for q in questions)
                op.completed = True
            return op
        finally:
            guard.actor.reset(token)
    op = asyncio.run(run())
    assert len(payloads) == 1
    assert all(payload == payloads[0] for payload in payloads)
    summary = op.summary()
    assert summary["schema_retries"] == 0
    assert summary["recovered_from_400"] == summary["context_fields_filled"] == 1
    assert summary["repair_rounds_used"] == summary["transient_retries"] == summary["truncation_retries"] == 0
    assert summary["first_pass_per_type"] == summary["final_per_type"] == {"ESSAY": 1}
    assert summary["credits_charged"] == 1 and not summary["discard_reasons"]
    assert len(summary["failed_schema_generations"]) == 1
    assert op.provider_calls[0]["phase"] == "first-pass generation"
    failure_meter.assert_not_called()
    assert not current_schema_retry.get()
    smoke.print_results([("Essay-heavy", summary, "OK")], [("Essay-heavy", row) for row in op.provider_failures],
                        [("Essay-heavy", row) for row in op.provider_calls])
    output = capsys.readouterr().out
    assert "400 detail" in output and "Schema retries:" in output
    assert "questions=1" in output and "1[-]" in output
    assert PRIVATE not in output and PRIVATE not in json.dumps(summary) and PRIVATE not in caplog.text


def test_exhausted_schema_retries_feed_last_invalid_recovery_to_existing_validator(isolated, monkeypatch):
    real_client = httpx.AsyncClient
    sent = []
    bad = item(kind="ESSAY", points="1", question_text=PRIVATE)
    recovery = json.dumps({"questions": [bad]})
    def handler(request):
        sent.append(json.loads(request.content))
        return httpx.Response(400, json={"error": {"code": "json_validate_failed", "failed_generation": recovery}})
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler)))
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
    op = asyncio.run(run())
    assert len(sent) == 8  # Initial + three content repairs, each with ONE schema retry.
    assert op.summary()["schema_retries"] == 4 and op.summary()["repair_rounds_used"] == 3
    assert op.summary()["discard_reasons"] == {"invalid_schema": 4}  # Not every wire attempt.
    assert op.summary()["credits_charged"] == 0
    assert [row["schema_detail"]["problem_counts"] for row in op.provider_failures] == [
        {"wrong_type:points": 1, "extra_property:question_type": 1, "extra_property:passage_id": 1}] * 8


def test_schema_error_without_recovery_stops_after_two_attempts_and_is_free(isolated, monkeypatch):
    real_client = httpx.AsyncClient
    calls = []
    def handler(request):
        calls.append(request)
        return httpx.Response(400, json={"error": {"code": "json_validate_failed", "message": PRIVATE}})
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler)))
    async def run():
        token = guard.actor.set("mock-only")
        try:
            async with exam_generation("mock-only", Counter(ESSAY=1)) as op:
                with pytest.raises(HTTPException) as exc:
                    await generation.generate_tos_row_questions("Plants", None, "Science", {"ESSAY": 1}, {"REMEMBER": 1})
                assert exc.value.status_code == 502
            return op
        finally:
            guard.actor.reset(token)
    op = asyncio.run(run())
    assert len(calls) == 2 and op.schema_retries == 1
    assert op.summary()["repair_rounds_used"] == 0 and op.summary()["credits_charged"] == 0


@pytest.mark.parametrize("exhaust_transients", [False, True])
def test_schema_retry_does_not_spend_or_reset_transient_retry_allowance(isolated, monkeypatch, exhaust_transients):
    real_client = httpx.AsyncClient
    sequence = [429, 400, 429, 429] if exhaust_transients else [429, 400, 429, 200]
    statuses = iter(sequence)
    calls = []
    recovery = json.dumps({"questions": [item(kind="ESSAY")]})
    def handler(request):
        status = next(statuses)
        calls.append(status)
        if status == 200:
            return httpx.Response(status, json={"choices": [{"finish_reason": "stop", "message": {"content": recovery}}]})
        return httpx.Response(status, json={"error": {"code": "json_validate_failed" if status == 400 else "rate_limit_exceeded",
            "failed_generation": "not JSON" if status == 400 else recovery, "message": PRIVATE}})
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler)))
    monkeypatch.setattr(provider.asyncio, "sleep", AsyncMock())
    async def run():
        token = guard.actor.set("mock-only")
        try:
            async with exam_generation("mock-only", Counter(ESSAY=1)) as op:
                if exhaust_transients:
                    with pytest.raises(HTTPException) as exc:
                        await generation.generate_tos_row_questions("Plants", None, "Science", {"ESSAY": 1}, {"REMEMBER": 1})
                    assert exc.value.status_code == 429
                else:
                    questions = await generation.generate_tos_row_questions("Plants", None, "Science", {"ESSAY": 1}, {"REMEMBER": 1})
                    op.final = Counter(q["question_type"] for q in questions)
                    op.completed = True
            return op
        finally:
            guard.actor.reset(token)
    op = asyncio.run(run())
    assert calls == sequence
    assert op.schema_retries == 1 and op.transient_retries == 2
    assert op.summary()["repair_rounds_used"] == 0 and op.summary()["credits_charged"] == int(not exhaust_transients)


def test_schema_retry_in_repair_round_keeps_the_content_round_unchanged(isolated, monkeypatch):
    real_client = httpx.AsyncClient
    sent = []
    recovery = json.dumps({"questions": [item(kind="ESSAY")]})
    def handler(request):
        sent.append(json.loads(request.content))
        if len(sent) == 1:
            bad = json.dumps({"questions": [item(kind="ESSAY", points="1")]})
            return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": bad}}]})
        if len(sent) == 2:
            return httpx.Response(400, json={"error": {"code": "json_validate_failed", "failed_generation": "not JSON"}})
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": recovery}}]})
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler)))
    async def run():
        token = guard.actor.set("mock-only")
        try:
            async with exam_generation("mock-only", Counter(ESSAY=1)) as op:
                questions = await generation.generate_tos_row_questions("Plants", None, "Science", {"ESSAY": 1}, {"REMEMBER": 1})
                op.final = Counter(q["question_type"] for q in questions)
                op.completed = True
            return op
        finally:
            guard.actor.reset(token)
    op = asyncio.run(run())
    assert len(sent) == 3 and sent[1] == sent[2]
    assert op.summary()["repair_rounds_used"] == 1 and op.schema_retries == 1
    assert op.provider_calls[-1]["phase"] == "repair round 1 (schema retry 1)"
    assert op.summary()["discard_reasons"] == {"invalid_schema": 1}
    assert op.summary()["credits_charged"] == 1


def test_truncation_fallback_does_not_reset_one_schema_retry_per_batch(isolated, monkeypatch):
    real_client = httpx.AsyncClient
    sent = []
    recovery = json.dumps({"questions": [item(kind="ESSAY")]})
    def handler(request):
        sent.append(json.loads(request.content))
        if len(sent) == 2:
            return httpx.Response(200, json={"choices": [{"finish_reason": "length", "message": {"content": PRIVATE}}]})
        recovered = "not JSON" if len(sent) == 1 else recovery
        return httpx.Response(400, json={"error": {"code": "json_validate_failed", "failed_generation": recovered}})
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler)))
    async def run():
        token = guard.actor.set("mock-only")
        try:
            async with exam_generation("mock-only", Counter(ESSAY=1)) as op:
                questions = await generation.generate_tos_row_questions("Plants", None, "Science", {"ESSAY": 1}, {"REMEMBER": 1})
                op.final = Counter(q["question_type"] for q in questions)
                op.completed = True
            return op
        finally:
            guard.actor.reset(token)
    op = asyncio.run(run())
    assert [payload["max_completion_tokens"] for payload in sent] == [800, 800, 1400]
    assert op.schema_retries == 1 and op.summary()["truncation_retries"] == 1
    assert op.summary()["repair_rounds_used"] == 0 and op.summary()["credits_charged"] == 1
    assert op.provider_calls[-1]["phase"] == "first-pass generation (truncation retry)"


def model_item(number=1, **updates):
    candidate = item(number, **updates)
    del candidate["question_type"], candidate["passage_id"]
    return candidate


def run_mocked_generation(monkeypatch, responses, *, target=2, source=None):
    """Wire responses are all local MockTransport; metering uses isolated fixture."""
    real_client = httpx.AsyncClient
    sent = []
    sequence = iter(responses)
    def handler(request):
        sent.append(json.loads(request.content))
        status, raw = next(sequence)
        body = ({"error": {"code": "json_validate_failed", "failed_generation": raw}}
                if status == 400 else {"choices": [{"finish_reason": "stop", "message": {"content": raw}}]})
        return httpx.Response(status, json=body)
    monkeypatch.setattr(provider.httpx, "AsyncClient", lambda **kwargs: real_client(transport=httpx.MockTransport(handler)))
    async def run():
        token = guard.actor.set("mock-only")
        try:
            async with exam_generation("mock-only", Counter(MULTIPLE_CHOICE=target)) as op:
                questions = await generation.generate_tos_row_questions("Plant structures", None, "Science",
                    {"MULTIPLE_CHOICE": target}, {"REMEMBER": target}, passage=source)
                op.final = Counter(q["question_type"] for q in questions)
                op.completed = True
            return op, questions
        finally:
            guard.actor.reset(token)
    op, questions = asyncio.run(run())
    return op, questions, sent


def test_model_schema_omits_context_but_keeps_every_other_required_field():
    for kind in ("MULTIPLE_CHOICE", "TRUE_FALSE", "IDENTIFICATION", "ESSAY", "MATCHING"):
        schema = generation.question_schema(kind, 6, None)["properties"]["questions"]
        assert schema["minItems"] == 1 and schema["maxItems"] == 100
        fields = schema["items"]
        assert "question_type" not in fields["properties"] and "passage_id" not in fields["properties"]
        assert set(fields["required"]) == set(generation.GeneratedItem.model_fields) - {"question_type", "passage_id"}
        assert fields["additionalProperties"] is False


def test_recovered_missing_context_links_to_batch_passage(isolated, monkeypatch):
    from test_tos_generation_repair import passage
    source = passage()
    raw = json.dumps({"questions": [model_item(question_text="What is the main idea of the passage?")]})
    op, questions, sent = run_mocked_generation(monkeypatch, [(400, raw)], target=1, source=source)
    assert len(sent) == 1 and len(questions) == 1
    assert questions[0]["question_type"] == "MULTIPLE_CHOICE" and questions[0]["passage_id"] == source.id
    assert questions[0]["passage"] == source.model_dump()
    assert op.summary()["recovered_from_400"] == op.summary()["context_fields_filled"] == 1
    assert op.schema_retries == 0 and op.summary()["credits_charged"] == 1


def test_recovery_extras_are_all_validated_and_trimmed_not_sliced(isolated, monkeypatch):
    raw = json.dumps({"questions": [model_item(n) for n in range(6)]})
    op, questions, sent = run_mocked_generation(monkeypatch, [(400, raw)])
    assert len(sent) == 1 and len(questions) == 2
    assert op.summary()["discard_reasons"] == {"trimmed_over_target": 4}
    assert op.summary()["recovered_from_400"] == 2 and op.summary()["context_fields_filled"] == 6
    assert op.summary()["repair_rounds_used"] == op.schema_retries == 0


def test_recovered_short_count_goes_to_content_repair_not_schema_retry(isolated, monkeypatch):
    raw = json.dumps({"questions": [model_item(1)]})
    repaired = json.dumps({"questions": [model_item(2)]})
    op, questions, sent = run_mocked_generation(monkeypatch, [(400, raw), (200, repaired)])
    assert len(questions) == 2 and len(sent) == 2
    assert op.summary()["repair_rounds_used"] == 1 and op.schema_retries == 0
    assert op.summary()["recovered_from_400"] == 1 and op.summary()["credits_charged"] == 1
    assert json.loads(sent[1]["messages"][1]["content"])["count"] == 1


@pytest.mark.parametrize("bad,reason", [
    (model_item(options=["Root", "Stem", "Leaf", " "]), "empty_option"),
    ({**model_item(), "question_type": "ESSAY"}, "context_field_conflict"),
    ({**model_item(), "passage_id": "not-the-batch-passage"}, "context_field_conflict"),
    (model_item(options=["Root", " Root ", "Leaf", "Flower"]), "duplicate_options"),
    (model_item(options=["Root", "Stem"]), "invalid_option_count"),
    (model_item(question_text="Analyze the following passage."), "missing_external_material"),
    (model_item(difficulty_band="DIFFICULT"), "bloom_difficulty_mismatch"),
])
def test_recovered_invalid_items_still_discarded_without_retrying_good_batch(isolated, monkeypatch, bad, reason):
    raw = json.dumps({"questions": [bad, model_item(2)]})
    op, questions, sent = run_mocked_generation(monkeypatch, [(400, raw)], target=1)
    assert len(sent) == len(questions) == 1
    assert questions[0]["question_text"] == model_item(2)["question_text"]
    assert op.summary()["discard_reasons"] == {reason: 1}
    assert op.schema_retries == 0 and op.summary()["recovered_from_400"] == 1


@pytest.mark.parametrize("recovery", ['{"questions":[', 'not JSON'])
@pytest.mark.parametrize("second_status", [200, 400])
def test_unparseable_recovery_retries_exactly_once_without_repair_or_extra_credit(
        isolated, monkeypatch, recovery, second_status):
    good = json.dumps({"questions": [model_item(1), model_item(2)]})
    op, questions, sent = run_mocked_generation(monkeypatch, [(400, recovery), (second_status, good)])
    assert len(sent) == 2 and sent[0] == sent[1] and len(questions) == 2
    assert op.schema_retries == 1 and op.summary()["repair_rounds_used"] == op.summary()["truncation_retries"] == 0
    assert op.summary()["credits_charged"] == 1 and op.summary()["discard_reasons"] == {}
    assert op.summary()["recovered_from_400"] == (2 if second_status == 400 else 0)


def test_first_pass_and_repair_schema_are_structurally_identical(isolated, monkeypatch):
    raw = json.dumps({"questions": [model_item(1)]})
    repaired = json.dumps({"questions": [model_item(2)]})
    _, _, sent = run_mocked_generation(monkeypatch, [(200, raw), (200, repaired)])
    assert sent[0]["response_format"] == sent[1]["response_format"]
    first, repair = [json.loads(request["messages"][1]["content"]) for request in sent]
    assert set(first) == set(repair)
    assert first["question_type"] == repair["question_type"] == "MULTIPLE_CHOICE"
    assert first["count"] == 3 and repair["count"] == 1
    assert first["repair_round"] == 0 and repair["repair_round"] == 1
    assert first["existing_stems_do_not_repeat"] == [] and len(repair["existing_stems_do_not_repeat"]) == 1
    assert first["instruction"] != repair["instruction"]


@pytest.mark.parametrize("options,expected", [
    ([], (0, 0, [])),
    ([PRIVATE, "", " \t", PRIVATE], (4, 2, [1, 2])),
    ([PRIVATE], (1, 0, [])),
    (None, (None, None, [])),
    (PRIVATE, (None, None, [])),
    ([None, {PRIVATE: PRIVATE}, 5, " "], (4, 1, [3])),
])
def test_mc_failed_generation_reports_only_option_counts_and_zero_based_indexes(options, expected):
    candidate = model_item(options=options)
    detail = failed_generation_detail(json.dumps({"questions": [candidate]}),
        generation.question_schema("MULTIPLE_CHOICE", 6, None))
    row = detail["item_problems"][0]
    assert (row["option_count"], row["empty_option_count"], row["empty_option_indexes"]) == expected
    assert PRIVATE not in json.dumps(detail)


def test_mc_missing_options_are_unknown_not_a_fabricated_empty_array():
    candidate = model_item()
    del candidate["options"]
    detail = failed_generation_detail(json.dumps({"questions": [candidate]}),
        generation.question_schema("MULTIPLE_CHOICE", 1, None))
    row = detail["item_problems"][0]
    assert row["option_count"] is row["empty_option_count"] is None
    assert row["empty_option_indexes"] == []
    assert row["problems"]["missing_field:options"] == 1


def test_mc_option_diagnostics_use_batch_context_even_when_model_type_conflicts():
    candidate = model_item(options=["", PRIVATE, PRIVATE, PRIVATE], question_type="ESSAY")
    detail = failed_generation_detail(json.dumps({"questions": [candidate]}),
        generation.question_schema("MULTIPLE_CHOICE", 1, None), question_type="MULTIPLE_CHOICE")
    assert detail["item_problems"][0]["empty_option_indexes"] == [0]
    assert detail["item_problems"][0]["option_count"] == 4
    assert PRIVATE not in json.dumps(detail)


@pytest.mark.parametrize("kind", ["TRUE_FALSE", "IDENTIFICATION", "ESSAY", "MATCHING"])
def test_non_mc_schema_and_validation_diagnostics_do_not_gain_mc_fields(kind):
    candidate = model_item(kind=kind, points="wrong-type")
    detail = failed_generation_detail(json.dumps({"questions": [candidate]}),
        generation.question_schema(kind, 1, None), question_type=kind)
    assert not {"option_count", "empty_option_count", "empty_option_indexes"} & detail["item_problems"][0].keys()
    batch = generation._validate_batch(json.dumps({"questions": [candidate]}), kind, None)
    assert batch.discards == {"invalid_schema": 1}
    assert batch.mc_option_discards == []


@pytest.mark.parametrize("options,reason,expected", [
    ([], "invalid_option_count", (0, 0, [])),
    (["", PRIVATE, " \t", PRIVATE], "empty_option", (4, 2, [0, 2])),
    ([PRIVATE, PRIVATE + "other"], "invalid_option_count", (2, 0, [])),
    ([None, PRIVATE, PRIVATE + "other", PRIVATE + "third"], "invalid_schema", (4, 0, [])),
])
def test_mocked_mc_400_and_discard_telemetry_share_count_only_option_diagnostics(
        isolated, monkeypatch, smoke, capsys, caplog, options, reason, expected):
    caplog.set_level("INFO")
    bad = model_item(options=options, question_text=PRIVATE)
    raw = json.dumps({"questions": [bad, model_item(2)]})
    op, questions, sent = run_mocked_generation(monkeypatch, [(400, raw)], target=1)
    summary = op.summary()
    count, empty_count, indexes = expected
    assert len(sent) == len(questions) == 1
    assert summary["schema_retries"] == summary["repair_rounds_used"] == 0
    assert summary["credits_charged"] == 1
    assert summary["discard_reasons"] == {reason: 1}
    assert summary["mc_option_discards"] == [{
        "item": 1, "reason": reason, "repair_round": 0, "batch_offset": 0,
        "option_count": count, "empty_option_count": empty_count, "empty_option_indexes": indexes}]
    assert len(questions[0]["options"]) == 4
    assert sum(option["is_correct"] for option in questions[0]["options"]) == 1
    smoke.print_results([("Grammar", summary, "OK")],
        [("Grammar", row) for row in op.provider_failures])
    output = capsys.readouterr().out
    assert "Per-item MC options (count / empty count / empty indexes, zero-based)" in output
    assert f"1[{count} / {empty_count} / {indexes}]" in output
    assert f"options={count} empty={empty_count} empty_indexes={indexes}" in output
    assert PRIVATE not in output and PRIVATE not in json.dumps(summary) and PRIVATE not in caplog.text


def test_kept_items_and_candidate_discards_keep_existing_behavior_with_option_telemetry(
        isolated, monkeypatch):
    first = model_item(1)
    raw = json.dumps({"questions": [first, first, model_item(3)]})
    op, questions, sent = run_mocked_generation(monkeypatch, [(200, raw)], target=1)
    summary = op.summary()
    assert len(sent) == len(questions) == 1
    assert summary["discard_reasons"] == {"duplicate_stem_same_batch": 1, "trimmed_over_target": 1}
    assert [row["item"] for row in summary["mc_option_discards"]] == [2, 3]
    assert [row["reason"] for row in summary["mc_option_discards"]] == [
        "duplicate_stem_same_batch", "trimmed_over_target"]
    assert all(row["option_count"] == 4 and row["empty_option_count"] == 0
        and row["empty_option_indexes"] == [] for row in summary["mc_option_discards"])
    assert summary["repair_rounds_used"] == 0 and summary["credits_charged"] == 1


def test_mc_option_discards_identify_repair_round_without_double_counting_recovered_validation(
        isolated, monkeypatch):
    first = json.dumps({"questions": [model_item(options=[]), model_item(1)]})
    repaired = json.dumps({"questions": [
        model_item(3, options=["Root", "Stem", "Leaf", " "]), model_item(2)]})
    op, questions, sent = run_mocked_generation(monkeypatch, [(200, first), (400, repaired)])
    summary = op.summary()
    assert len(sent) == len(questions) == 2
    assert summary["repair_rounds_used"] == 1 and summary["schema_retries"] == 0
    assert summary["recovered_from_400"] == 1 and summary["credits_charged"] == 1
    assert summary["discard_reasons"] == {"invalid_option_count": 1, "empty_option": 1}
    assert summary["mc_option_discards"] == [
        {"item": 1, "reason": "invalid_option_count", "repair_round": 0, "batch_offset": 0,
         "option_count": 0, "empty_option_count": 0, "empty_option_indexes": []},
        {"item": 1, "reason": "empty_option", "repair_round": 1, "batch_offset": 0,
         "option_count": 4, "empty_option_count": 1, "empty_option_indexes": [3]}]

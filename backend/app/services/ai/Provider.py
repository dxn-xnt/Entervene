"""Bounded, metered provider attempts; TOS-only transient retries, no SDK retries."""
import asyncio
import hashlib
import json
import logging
import math
import random
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

import httpx
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from app.core.Config import settings
from app.services.ai.UsageGuard import actor, reserve_call, record_failure
from app.services.ai.tos_generation_session import current_generation
from app.services.ai.provider_diagnostics import record_provider_failure, record_provider_usage, start_provider_call
from app.services.ai.provider_diagnostics import (
    ProviderTruncationError, is_truncated_json, truncation_retry_available,
    current_truncation_retry, record_provider_response,
    ProviderSchemaError, schema_retry_scope, current_schema_batch, current_recovery_validator,
)

logger = logging.getLogger("ai.provider")


def _read_provider_json(body, response, provider):
    record_provider_response(current_generation.get(), provider, response)
    try:
        data = json.loads(body)
        record_provider_usage(current_generation.get(), provider, data)
        return data
    except (ValueError, TypeError):
        if is_truncated_json(body):
            record_provider_failure(current_generation.get(), provider, response=response, failure_kind="truncated_json")
            raise ProviderTruncationError("truncated_json") from None
        record_provider_failure(current_generation.get(), provider, response=response, failure_kind="invalid_response")
        raise


async def _execute_groq(payload: dict, headers: dict, model: str) -> str:
    start_provider_call(current_generation.get(), "Groq", payload)
    url = "https://api.groq.com/openai/v1/chat/completions"
    output_schema = payload.get("response_format", {}).get("json_schema", {}).get("schema")
    async with asyncio.timeout(30):
        async with httpx.AsyncClient(timeout=httpx.Timeout(25, connect=5),
                                     transport=httpx.AsyncHTTPTransport(retries=0)) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as response:
                if response.status_code >= 400:
                    err_body = await response.aread()
                    record_provider_failure(current_generation.get(), "Groq", response=response, output_schema=output_schema)
                    logger.error("Groq HTTP status=%s", response.status_code)
                    if response.status_code == 400:
                        err_obj = {}
                        try:
                            err_data = json.loads(err_body)
                            err_obj = err_data.get("error", {})
                        except Exception:
                            pass
                        if isinstance(err_obj, dict) and err_obj.get("code") == "json_validate_failed":
                            recovered = str(err_obj["failed_generation"]) if err_obj.get("failed_generation") else None
                            if current_generation.get() is not None and isinstance(output_schema, dict):
                                raise ProviderSchemaError(recovered)
                            if recovered is not None:
                                logger.info("Recovered generation from Groq failed_generation payload")
                                return recovered
                response.raise_for_status()
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > 262144:
                        record_provider_failure(current_generation.get(), "Groq", response=response, failure_kind="invalid_response")
                        raise ValueError("Oversized provider response")
            data = _read_provider_json(body, response, "Groq")
    try:
        choice = data["choices"][0]
        if choice.get("finish_reason") != "stop":
            record_provider_failure(current_generation.get(), "Groq", response=response, failure_kind="incomplete_generation")
            if choice.get("finish_reason") == "length":
                raise ProviderTruncationError()
            raise ValueError("Incomplete generation")
        result = choice["message"]["content"]
    except (KeyError, IndexError, TypeError):
        record_provider_failure(current_generation.get(), "Groq", response=response, failure_kind="invalid_response")
        raise
    if not isinstance(result, str) or not result.strip():
        record_provider_failure(current_generation.get(), "Groq", response=response, failure_kind="empty_generation")
        raise ValueError("Empty generation")
    logger.info("AI_PROVIDER_SUCCESS model=%s", model)
    return result


async def _execute_gemini(payload: dict, headers: dict, model: str) -> str:
    start_provider_call(current_generation.get(), "Gemini", payload)
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    async with asyncio.timeout(30):
        async with httpx.AsyncClient(timeout=httpx.Timeout(25, connect=5),
                                     transport=httpx.AsyncHTTPTransport(retries=0)) as client:
            async with client.stream("POST", url, headers=headers, json=payload) as response:
                if response.status_code >= 400:
                    err_body = await response.aread()
                    record_provider_failure(current_generation.get(), "Gemini", response=response)
                    logger.error("Gemini HTTP status=%s", response.status_code)
                response.raise_for_status()
                body = bytearray()
                async for chunk in response.aiter_bytes():
                    body.extend(chunk)
                    if len(body) > 262144:
                        record_provider_failure(current_generation.get(), "Gemini", response=response, failure_kind="invalid_response")
                        raise ValueError("Oversized provider response")
            data = _read_provider_json(body, response, "Gemini")
    try:
        choice = data["candidates"][0]
        if choice.get("finishReason") != "STOP":
            record_provider_failure(current_generation.get(), "Gemini", response=response, failure_kind="incomplete_generation")
            if choice.get("finishReason") == "MAX_TOKENS":
                raise ProviderTruncationError()
            raise ValueError("Incomplete generation")
        result = "".join(part.get("text", "") for part in choice["content"]["parts"])
    except (KeyError, IndexError, TypeError):
        record_provider_failure(current_generation.get(), "Gemini", response=response, failure_kind="invalid_response")
        raise
    if not isinstance(result, str) or not result.strip():
        record_provider_failure(current_generation.get(), "Gemini", response=response, failure_kind="empty_generation")
        raise ValueError("Empty generation")
    logger.info("AI_PROVIDER_SUCCESS model=%s", model)
    return result


async def generate_text(prompt: str, system_prompt: str, *, json_output: bool = False,
                        max_tokens: int = 4000, output_schema: dict | None = None) -> str:
    if not settings.ai_enabled:
        raise HTTPException(503, "AI generation is disabled by your administrator.")
    identity = actor.get()
    if not identity:
        raise HTTPException(403, "Authenticated staff context required for AI generation.")
    # Byte bounds are conservative token bounds, including multilingual inputs.
    if len((prompt + system_prompt).encode("utf-8")) > 16000:
        raise HTTPException(422, "AI context is too long. Select fewer readings or shorten the instructions.")
    if not 1 <= max_tokens <= 4000:
        raise HTTPException(422, "Invalid AI output limit.")

    if not settings.groq_api_key and not settings.gemini_api_key:
        raise HTTPException(503, "AI service is not configured.")

    groq_payload = None
    groq_headers = None
    gemini_payload = None
    gemini_headers = None

    if settings.groq_api_key:
        if settings.groq_model != "openai/gpt-oss-20b":
            raise HTTPException(503, "AI model requires a reviewed cost policy. Configure GROQ_MODEL=openai/gpt-oss-20b.")
        groq_headers = {"Authorization": "Bearer " + settings.groq_api_key}
        groq_payload = {
            "model": settings.groq_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            "max_completion_tokens": max_tokens,
            "reasoning_effort": "low",
            "temperature": 0.3,
            "stream": False,
        }
        if output_schema is not None:
            groq_payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {"name": "tos_output", "strict": True, "schema": output_schema},
            }

    elif settings.gemini_api_key:
        gemini_headers = {"x-goog-api-key": settings.gemini_api_key}
        config = {
            "maxOutputTokens": max_tokens,
            "temperature": 0.3,
            "thinkingConfig": {"thinkingBudget": 0},
        }
        if json_output or output_schema is not None:
            config["responseMimeType"] = "application/json"
        if output_schema is not None:
            config["responseJsonSchema"] = output_schema
        gemini_payload = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": config,
        }

    primary_payload = groq_payload if groq_payload is not None else gemini_payload
    fingerprint = hashlib.sha256(json.dumps(primary_payload, sort_keys=True).encode()).hexdigest()
    operation = current_generation.get()
    if operation is not None:
        if operation.identity != identity:
            raise HTTPException(403, "AI generation identity mismatch.")
        await operation.ensure_credit_hold()
        execute = _execute_groq if groq_payload is not None else _execute_gemini
        payload = groq_payload if groq_payload is not None else gemini_payload
        headers = groq_headers if groq_payload is not None else gemini_headers
        model = settings.groq_model if groq_payload is not None else "gemini-2.5-flash-lite"
        return await _execute_tos_with_retries(execute, payload, headers, model, identity, fingerprint, operation)
    await run_in_threadpool(reserve_call, identity, fingerprint)

    try:
        if groq_payload is not None:
            return await _execute_groq(groq_payload, groq_headers, settings.groq_model)
        return await _execute_gemini(gemini_payload, gemini_headers, "gemini-2.5-flash-lite")
    except (TimeoutError, httpx.TimeoutException) as exc:
        logger.error("AI provider timeout type=%s", type(exc).__name__)
        await run_in_threadpool(record_failure)
        raise HTTPException(504, "AI generation timed out. No automatic retry was made.") from None
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
        logger.error("AI provider call failed type=%s", type(exc).__name__)
        await run_in_threadpool(record_failure)
        raise HTTPException(502, "AI provider could not complete the request. No automatic retry was made.") from None


def _retry_after_seconds(response) -> float:
    value = response.headers.get("Retry-After", "")
    try:
        seconds = float(value)
        if 0 <= seconds < float("inf"):
            return seconds
    except ValueError:
        pass
    try:
        moment = parsedate_to_datetime(value)
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=timezone.utc)
        return max(0, (moment - datetime.now(timezone.utc)).total_seconds())
    except (ValueError, TypeError, OverflowError):
        return 0


async def _execute_tos_with_retries(execute, payload, headers, model, identity, fingerprint, operation):
    """One schema retry only when recovery has no locally valid items."""
    shared = current_schema_batch.get()
    allowance = shared if shared is not None else [0]
    schema_label = 0
    transient_state = [0]
    while True:
        with schema_retry_scope(schema_label):
            try:
                return await _execute_tos_transport_attempts(execute, payload, headers, model, identity, fingerprint, operation, transient_state)
            except ProviderSchemaError as exc:
                recovered = exc.recovered_generation
                validator = current_recovery_validator.get()
                if recovered is not None and validator is not None:
                    recovered = validator(recovered)
                    if recovered.usable_items:
                        return recovered
                if allowance[0] < 1:
                    allowance[0] += 1
                    schema_label = allowance[0]
                    operation.schema_retries += 1
                    logging.getLogger("ai.tos.telemetry").info("TOS_SCHEMA_RETRY schema_retry=%s", schema_label)
                    continue
                if recovered is not None:
                    logger.info("Recovered generation after exhausted schema retries")
                    return recovered
                await run_in_threadpool(record_failure)
                raise HTTPException(502, "AI provider could not complete the request after schema retries.") from None


async def _execute_tos_transport_attempts(execute, payload, headers, model, identity, fingerprint, operation, transient_state):
    """At most three wire attempts. Every attempt is budgeted, but no extra credits.

    Retry only upstream 429/5xx and timeouts, not local quota/circuit decisions,
    validation errors, authentication errors, or other 4xx. Non-TOS callers keep
    their existing zero-retry, no-fallback behavior.
    """
    for attempt in range(transient_state[0], 3):
        attempt_fingerprint = hashlib.sha256(
            f"{fingerprint}:{operation.generation_id}:{operation.provider_attempts}".encode()).hexdigest()
        # Guard errors occur outside the retry block: never retry local quotas.
        await run_in_threadpool(reserve_call, identity, attempt_fingerprint, charge_staff=False)
        operation.provider_attempts += 1
        start_provider_call(operation, "Groq" if execute is _execute_groq else "Gemini", payload)
        try:
            return await execute(payload, headers, model)
        except asyncio.CancelledError as exc:
            record_provider_failure(operation, "Groq" if execute is _execute_groq else "Gemini",
                                    exception=exc, failure_kind="cancelled")
            raise
        except ProviderSchemaError as exc:
            record_provider_failure(operation, "Groq" if execute is _execute_groq else "Gemini", exception=exc)
            raise
        except ProviderTruncationError as exc:
            record_provider_failure(operation, "Groq" if execute is _execute_groq else "Gemini",
                                    exception=exc, failure_kind=exc.reason)
            if truncation_retry_available():
                # The question-batch orchestrator owns the single old-budget
                # fallback. Do not count the recoverable truncation as a stop.
                raise
            await run_in_threadpool(record_failure)
            logger.warning("TOS_PROVIDER_STOP reason=truncation attempts=%s", attempt + 1)
            detail = ("AI provider returned truncated output after one budget fallback." if current_truncation_retry.get()
                      else "AI provider could not complete the request. No automatic retry was made.")
            raise HTTPException(502, detail) from None
        except (TimeoutError, httpx.TimeoutException, httpx.HTTPError, ValueError, KeyError, IndexError, TypeError) as exc:
            record_provider_failure(operation, "Groq" if execute is _execute_groq else "Gemini",
                response=exc.response if isinstance(exc, httpx.HTTPStatusError) else None, exception=exc)
            timeout = isinstance(exc, (TimeoutError, httpx.TimeoutException))
            status = exc.response.status_code if isinstance(exc, httpx.HTTPStatusError) else None
            timeout = timeout or status == 408
            transient = timeout or status == 429 or (status is not None and 500 <= status <= 599)
            if transient and attempt < 2:
                wait = 2 ** attempt + random.uniform(0, 0.25)
                if isinstance(exc, httpx.HTTPStatusError):
                    wait = max(wait, _retry_after_seconds(exc.response))
                # Do not hold a web request indefinitely for a long provider wait.
                # A Retry-After above this bound is surfaced without retrying early.
                if wait <= 60:
                    transient_state[0] = attempt + 1
                    operation.transient_retries += 1
                    logger.info("TOS_PROVIDER_RETRY attempt=%s status=%s timeout=%s wait_seconds=%.3f",
                                attempt + 1, status, timeout, wait)
                    await asyncio.sleep(wait)
                    continue
            await run_in_threadpool(record_failure)
            logger.warning("TOS_PROVIDER_STOP status=%s timeout=%s attempts=%s", status, timeout, attempt + 1)
            if timeout:
                raise HTTPException(504, "AI generation timed out after bounded retries.") from None
            if status == 429:
                after = max(1, math.ceil(_retry_after_seconds(exc.response)))
                raise HTTPException(429, f"AI is busy, try again in {after} seconds.",
                                    headers={"Retry-After": str(after)}) from None
            if transient:
                after = max(2, math.ceil(_retry_after_seconds(exc.response))) if isinstance(exc, httpx.HTTPStatusError) else 2
                raise HTTPException(503, "AI provider temporarily unavailable after bounded retries.",
                                    headers={"Retry-After": str(after)}) from None
            raise HTTPException(502, "AI provider could not complete the request. No automatic retry was made.") from None

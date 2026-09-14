"""One bounded, metered provider attempt; no SDK retries or model discovery."""
import asyncio
import hashlib
import json
import logging

import httpx
from fastapi import HTTPException
from starlette.concurrency import run_in_threadpool

from app.core.Config import settings
from app.services.ai.UsageGuard import actor, reserve_call, record_failure

logger = logging.getLogger("ai.provider")


async def generate_text(prompt: str, system_prompt: str, *, json_output: bool = False,
                        max_tokens: int = 4000) -> str:
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
    if settings.groq_api_key:
        # Environment overrides must not silently enable expensive/tool-using models.
        if settings.groq_model != "openai/gpt-oss-20b":
            raise HTTPException(503, "AI model requires a reviewed cost policy. Configure GROQ_MODEL=openai/gpt-oss-20b.")
        model = settings.groq_model
        url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {"Authorization": "Bearer " + settings.groq_api_key}
        payload = {"model": model, "messages": [{"role": "system", "content": system_prompt},
                   {"role": "user", "content": prompt}], "max_completion_tokens": max_tokens,
                   "reasoning_effort": "low", "temperature": .3, "stream": False}
        if json_output:
            payload["response_format"] = {"type": "json_object"}
    elif settings.gemini_api_key:
        model = "gemini-2.5-flash-lite"
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        headers = {"x-goog-api-key": settings.gemini_api_key}
        config = {"maxOutputTokens": max_tokens, "temperature": .3,
                  "thinkingConfig": {"thinkingBudget": 0}}
        if json_output:
            config["responseMimeType"] = "application/json"
        payload = {"systemInstruction": {"parts": [{"text": system_prompt}]},
                   "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                   "generationConfig": config}
    else:
        raise HTTPException(503, "AI service is not configured.")
    fingerprint = hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    await run_in_threadpool(reserve_call, identity, fingerprint)
    try:
        # Wall-clock deadline includes connect, read, and pool waits; transport retries=0.
        async with asyncio.timeout(30):
            async with httpx.AsyncClient(timeout=httpx.Timeout(25, connect=5),
                                         transport=httpx.AsyncHTTPTransport(retries=0)) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as response:
                    response.raise_for_status()
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > 262144:
                            raise ValueError("Oversized provider response")
                data = json.loads(body)
        if settings.groq_api_key:
            choice = data["choices"][0]
            if choice.get("finish_reason") != "stop":
                raise ValueError("Incomplete generation")
            result = choice["message"]["content"]
        else:
            choice = data["candidates"][0]
            if choice.get("finishReason") != "STOP":
                raise ValueError("Incomplete generation")
            result = "".join(part.get("text", "") for part in choice["content"]["parts"])
        if not isinstance(result, str) or not result.strip():
            raise ValueError("Empty generation")
        logger.info("AI_PROVIDER_SUCCESS model=%s", model)
        return result
    except (TimeoutError, httpx.TimeoutException):
        await run_in_threadpool(record_failure)
        raise HTTPException(504, "AI generation timed out. No automatic retry was made.") from None
    except (httpx.HTTPError, ValueError, KeyError, IndexError, TypeError):
        await run_in_threadpool(record_failure)
        raise HTTPException(502, "AI provider could not complete the request. No automatic retry was made.") from None

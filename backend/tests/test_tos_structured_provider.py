"""Inspect payloads with provider execution and usage reservation mocked."""
import asyncio
from unittest.mock import AsyncMock, Mock

import pytest

from app.services.ai import Provider as provider
from app.services.ai.UsageGuard import actor


@pytest.mark.parametrize("kind", ["groq", "gemini"])
def test_provider_attaches_json_schema_without_network_or_database(monkeypatch, kind):
    monkeypatch.setattr(provider.settings, "ai_enabled", True)
    monkeypatch.setattr(provider.settings, "groq_api_key", "mock-only" if kind == "groq" else None)
    monkeypatch.setattr(provider.settings, "gemini_api_key", "mock-only" if kind == "gemini" else None)
    monkeypatch.setattr(provider.settings, "groq_model", "openai/gpt-oss-20b")
    reserve = Mock()
    monkeypatch.setattr(provider, "reserve_call", reserve)
    groq, gemini = AsyncMock(return_value="{}"), AsyncMock(return_value="{}")
    monkeypatch.setattr(provider, "_execute_groq", groq)
    monkeypatch.setattr(provider, "_execute_gemini", gemini)
    schema = {"type": "object", "properties": {}, "required": [], "additionalProperties": False}
    token = actor.set("mock-only")
    try:
        assert asyncio.run(provider.generate_text("Generate", "Only JSON", output_schema=schema)) == "{}"
    finally:
        actor.reset(token)
    reserve.assert_called_once()
    if kind == "groq":
        assert groq.call_args.args[0]["response_format"] == {
            "type": "json_schema", "json_schema": {"name": "tos_output", "strict": True, "schema": schema}}
        gemini.assert_not_called()
    else:
        assert gemini.call_args.args[2] == "gemini-2.5-flash-lite"
        assert gemini.call_args.args[0]["generationConfig"]["responseJsonSchema"] == schema
        assert gemini.call_args.args[0]["generationConfig"]["responseMimeType"] == "application/json"
        groq.assert_not_called()

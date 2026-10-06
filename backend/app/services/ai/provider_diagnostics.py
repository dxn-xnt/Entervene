"""Content-free provider diagnostics. Never retain raw bodies or exception text."""
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import timezone
from email.utils import parsedate_to_datetime
import re
import time
import json
import math
from collections import Counter


current_call = ContextVar("tos_provider_call", default=("unattributed", 0, 0, None))
current_truncation_retry = ContextVar("tos_truncation_retry", default=False)
current_schema_retry = ContextVar("tos_schema_retry", default=0)
current_schema_batch = ContextVar("tos_schema_batch", default=None)
current_recovery_validator = ContextVar("tos_recovery_validator", default=None)
ERROR_CODES = frozenset({"json_validate_failed", "rate_limit_exceeded", "context_length_exceeded",
    "invalid_request_error", "invalid_request", "invalid_api_key", "model_not_found",
    "authentication_error", "permission_error", "server_error", "insufficient_quota",
    "tokens", "requests", "invalid_json_schema", "invalid_value", "unsupported_value",
    "unsupported_parameter", "invalid_model", "rate_limit_error", "request_too_large",
    "invalid_argument", "INVALID_ARGUMENT", "RESOURCE_EXHAUSTED", "UNAUTHENTICATED",
    "PERMISSION_DENIED", "INTERNAL", "UNAVAILABLE", "DEADLINE_EXCEEDED", "NOT_FOUND",
    "FAILED_PRECONDITION", "OUT_OF_RANGE"})
RATE_HEADERS = frozenset({f"{prefix}ratelimit-{metric}-{unit}" for prefix in ("", "x-")
    for metric in ("limit", "remaining", "reset") for unit in ("requests", "tokens")})
KINDS = frozenset({"MULTIPLE_CHOICE", "TRUE_FALSE", "IDENTIFICATION", "ESSAY", "MATCHING"})
TOKEN_FIELDS = ("budget_requested", "prompt_tokens", "completion_tokens", "total_tokens")
DISCARD_CODES = frozenset({"missing_external_material", "duplicate_options", "trimmed_over_target",
    "surplus_cell", "invalid_envelope", "invalid_json", "invalid_passage", "duplicate_stem",
    "identical_true_false_answers", "placeholder_option", "invalid_option_count", "empty_option",
    "invalid_correct_index", "blank_stem_or_explanation", "bloom_difficulty_mismatch", "invalid_schema",
    "unexpected_question_type", "invalid_passage_link", "invalid_true_false", "invalid_identification"})
DISCARD_CODES = DISCARD_CODES | {"duplicate_stem_existing_kept", "duplicate_stem_same_batch", "duplicate_stem_previous_candidate", "context_field_conflict"}
SCHEMA_FIELDS = frozenset({"questions", "id", "title", "text", "question_text", "question_type",
    "cognitive_level", "difficulty_band", "points", "explanation", "options", "correct_index", "passage_id",
    "answer", "correct_answer", "rubric", "scoring_criteria", "competency_id", "competency_label", "bloom_level"})
FINISH_REASONS = frozenset({"stop", "length", "content_filter", "tool_calls", "function_call", "max_tokens", "STOP", "MAX_TOKENS"})


class ProviderSchemaError(ValueError):
    """Fixed-message control signal; recovered content never enters diagnostics."""
    def __init__(self, recovered_generation=None):
        self.recovered_generation = recovered_generation
        super().__init__("Provider JSON schema validation failed")


@contextmanager
def schema_batch_scope():
    """Share the one-retry allowance across the batch's truncation fallback."""
    token = current_schema_batch.set([0])
    try:
        yield
    finally:
        current_schema_batch.reset(token)


@contextmanager
def recovery_validation_scope(validator):
    """Ephemeral local validation callback; content never enters telemetry."""
    token = current_recovery_validator.set(validator)
    try:
        yield
    finally:
        current_recovery_validator.reset(token)


@contextmanager
def schema_retry_scope(number):
    token = current_schema_retry.set(number)
    try:
        yield
    finally:
        current_schema_retry.reset(token)


def _safe_field(name):
    return name if isinstance(name, str) and name in SCHEMA_FIELDS else "[redacted]"


def _schema_type_matches(value, schema):
    if "anyOf" in schema:
        return any(_schema_type_matches(value, choice) for choice in schema["anyOf"])
    kind = schema.get("type")
    return (kind is None or (kind == "null" and value is None)
            or (kind == "string" and isinstance(value, str))
            or (kind == "integer" and type(value) is int)
            or (kind == "number" and type(value) in (int, float))
            or (kind == "array" and isinstance(value, list))
            or (kind == "object" and isinstance(value, dict))
            or (kind == "boolean" and type(value) is bool))


def _field_problems(value, schema):
    """Structural inspection only; does not repair content or replace validation."""
    if not schema:
        return {}
    problems = Counter()
    if not isinstance(value, dict):
        return {"wrong_type:root": 1}
    properties = schema.get("properties", {})
    for name in schema.get("required", []):
        if name not in value:
            problems[f"missing_field:{_safe_field(name)}"] += 1
    for name, field in value.items():
        safe = _safe_field(name)
        if name not in properties:
            if schema.get("additionalProperties") is False:
                problems[f"extra_property:{safe}"] += 1
            continue
        expected = properties[name]
        if not _schema_type_matches(field, expected):
            problems[f"wrong_type:{safe}"] += 1
            continue
        if isinstance(field, str) and not field.strip():
            problems[f"empty_value:{safe}"] += 1
        if ("enum" in expected and field not in expected["enum"]):
            problems[f"invalid_value:{safe}"] += 1
        if type(field) in (int, float) and ((type(field) is float and not math.isfinite(field))
                or ("minimum" in expected and field < expected["minimum"])
                or ("maximum" in expected and field > expected["maximum"])
                or ("exclusiveMinimum" in expected and field <= expected["exclusiveMinimum"])
                or ("exclusiveMaximum" in expected and field >= expected["exclusiveMaximum"])):
            problems[f"invalid_value:{safe}"] += 1
        if isinstance(field, list):
            if len(field) < expected.get("minItems", 0) or len(field) > expected.get("maxItems", math.inf):
                problems["option_count_wrong" if name == "options" else f"count_wrong:{safe}"] += 1
            if name == "options":
                for option in field[:100]:
                    if not _schema_type_matches(option, expected.get("items", {})):
                        problems["wrong_type:options"] += 1
                    elif isinstance(option, str) and not option.strip():
                        problems["empty_value:options"] += 1
    return dict(problems)


def failed_generation_detail(raw, schema=None, *, finish_reason=None):
    """Never return raw keys, values, parsing exceptions, schema enums or content."""
    detail = {"characters": len(raw) if isinstance(raw, str) else None,
              "estimated_tokens": math.ceil(len(raw) / 4) if isinstance(raw, str) else None,
              "json_parses": None, "parse_state": "unavailable", "top_level_key_counts": {},
              "item_count": None, "inspected_items": 0, "uninspected_items": 0,
              "root_problems": {}, "item_problems": [], "problem_counts": {},
              "schema_available": isinstance(schema, dict) and bool(schema),
              "finish_reason": finish_reason if isinstance(finish_reason, str) and finish_reason in FINISH_REASONS else "-" if finish_reason is None else "[redacted]"}
    if not isinstance(raw, str):
        return detail
    if len(raw) > 262144:
        detail["parse_state"] = "not_inspected_size_limit"
        return detail
    try:
        data = json.loads(raw)
    except (ValueError, TypeError, RecursionError):
        try:
            truncated = is_truncated_json(raw)
        except (ValueError, TypeError, RecursionError):
            truncated = False
        detail.update(json_parses=False, parse_state="looks_truncated" if truncated else "malformed")
        return detail
    detail.update(json_parses=True, parse_state="parsed")
    if isinstance(data, dict):
        detail["top_level_key_counts"] = dict(Counter(_safe_field(name) for name in data))
    detail["root_problems"] = _field_problems(data, schema or {})
    items = data.get("questions") if isinstance(data, dict) else data if isinstance(data, list) else None
    if isinstance(items, list):
        detail["item_count"] = len(items)
        detail["inspected_items"] = min(len(items), 100)
        detail["uninspected_items"] = max(0, len(items) - 100)
        item_schema = (schema or {}).get("properties", {}).get("questions", {}).get("items", {})
        for index, item in enumerate(items[:100], 1):
            detail["item_problems"].append({"item": index, "problems": _field_problems(item, item_schema)})
    counts = Counter(detail["root_problems"])
    for row in detail["item_problems"]:
        counts.update(row["problems"])
    detail["problem_counts"] = dict(counts)
    return detail


class ProviderTruncationError(ValueError):
    """Content-free signal; not a transient transport retry or repair round."""
    def __init__(self, reason="incomplete_generation"):
        self.reason = reason if reason in ("incomplete_generation", "truncated_json") else "incomplete_generation"
        super().__init__("Incomplete generation")


def is_truncated_json(raw):
    """Conservative EOF signatures, not a general invalid-JSON retry policy."""
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8", errors="replace")
    if not isinstance(raw, str) or not raw.lstrip().startswith(("{", "[")):
        return False
    try:
        json.loads(raw)
    except json.JSONDecodeError as exc:
        tail = raw[exc.pos:].strip()
        unfinished_literal = bool(tail) and any(word.startswith(tail) and word != tail for word in ("true", "false", "null"))
        unfinished_number = (tail == "-" or re.search(
            r"(?:^|[:\s,\[])-?(?:0|[1-9]\d*)(?:\.\d+)?(?:\.$|[eE][+-]?$)", raw.rstrip()) is not None)
        return (exc.pos >= len(raw.rstrip()) or exc.msg.startswith("Unterminated string")
                or unfinished_literal or unfinished_number
                or (exc.msg.startswith("Invalid \\uXXXX escape")
                    and re.search(r"\\u[0-9a-fA-F]{0,3}$", raw.rstrip()) is not None))
    return False


def truncation_retry_available():
    phase, _, _, kind = current_call.get()
    return phase in ("first-pass generation", "repair") and kind in KINDS and not current_truncation_retry.get()


def discard_summary(discards):
    reasons = Counter()
    for code, count in discards.items():
        if token_count(count):
            reasons[code if code in DISCARD_CODES else "unknown_validation"] += count
    other = {code: count for code, count in reasons.items() if code not in
             ("missing_external_material", "duplicate_options", "trimmed_over_target")}
    return {"discard_reasons": dict(reasons), "discard_counts": {
        "external_material": reasons["missing_external_material"], "duplicate_options": reasons["duplicate_options"],
        "trimmed_over_target": reasons["trimmed_over_target"], "other_validation": sum(other.values())},
        "other_validation_reasons": other, "duplicate_stem_counts": {
            "existing_kept": reasons["duplicate_stem_existing_kept"],
            "same_batch": reasons["duplicate_stem_same_batch"],
            "previous_candidate": reasons["duplicate_stem_previous_candidate"] + reasons["duplicate_stem"]}}


def token_count(value):
    """Accept counts only, never booleans, floats, strings or provider prose."""
    return value if type(value) is int and 0 <= value <= 10**12 else None


def start_provider_call(operation, provider, payload=None):
    if operation is None:
        return None
    payload = payload if isinstance(payload, dict) else {}
    config = payload.get("generationConfig", {})
    budget = token_count(payload.get("max_completion_tokens") if provider == "Groq" else
                         config.get("maxOutputTokens") if isinstance(config, dict) else None)
    for row in operation.provider_calls:
        if row["call"] == operation.provider_attempts:
            if row["budget_requested"] is None:
                row["budget_requested"] = budget
            return row
    phase, round_number, offset, kind = current_call.get()
    phase_text = f"repair round {round_number}" if phase == "repair" else phase
    if phase == "passage" and round_number:
        phase_text += f" (repair round {round_number})"
    if current_truncation_retry.get():
        phase_text += " (truncation retry)"
    if current_schema_retry.get():
        phase_text += f" (schema retry {current_schema_retry.get()})"
    row = {"call": operation.provider_attempts,
           "provider": provider if provider in ("Groq", "Gemini") else "unknown",
           "phase": phase_text, "batch_offset": token_count(offset),
           "truncation_retry": current_truncation_retry.get(),
           "schema_retry": current_schema_retry.get(),
           "http_status": None,
           "rate_headers": {},
           "question_type": kind if kind in KINDS else "-",
           "started_at": time.monotonic(), "budget_requested": budget,
           "prompt_tokens": None, "completion_tokens": None, "total_tokens": None}
    operation.provider_calls.append(row)
    return row


def record_provider_response(operation, provider, response):
    row = start_provider_call(operation, provider)
    if row is not None:
        row["http_status"] = response.status_code
        row["rate_headers"] = {name: safe_header_value(value) for name, value in response.headers.items()
                               if name.lower() in RATE_HEADERS or name.lower() == "retry-after"}


def record_provider_usage(operation, provider, body):
    """Retain only usage counts, including HTTP errors and incomplete outputs.

    Gemini completion = candidate tokens + reported thinking tokens. Total is
    authoritative provider data, not inferred from missing usage fields.
    """
    if operation is None or not isinstance(body, dict):
        return
    row = start_provider_call(operation, provider)
    usage = body.get("usage" if provider == "Groq" else "usageMetadata")
    if not isinstance(usage, dict):
        return
    if provider == "Groq":
        values = {key: token_count(usage.get(key)) for key in TOKEN_FIELDS[1:]}
    else:
        candidates = token_count(usage.get("candidatesTokenCount"))
        thoughts = token_count(usage.get("thoughtsTokenCount", 0))
        values = {"prompt_tokens": token_count(usage.get("promptTokenCount")),
                  "completion_tokens": candidates + thoughts if candidates is not None and thoughts is not None else None,
                  "total_tokens": token_count(usage.get("totalTokenCount"))}
    row.update({key: value for key, value in values.items() if value is not None})
    for failure in operation.provider_failures:
        if failure["call"] == row["call"]:
            failure.update({key: row[key] for key in TOKEN_FIELDS})


def token_usage_summary(calls):
    """Completion-cap peak over (t-60, t], across physical attempts in one exam."""
    ordered = sorted(calls, key=lambda row: row["started_at"])
    left, window, peak = 0, 0, 0
    for right, row in enumerate(ordered):
        window += row["budget_requested"] or 0
        while ordered[left]["started_at"] <= row["started_at"] - 60:
            window -= ordered[left]["budget_requested"] or 0
            left += 1
        peak = max(peak, window)
    return {"calls": len(calls),
            "budget_known_calls": sum(row["budget_requested"] is not None for row in calls),
            "requested_budget_total": sum(row["budget_requested"] or 0 for row in calls),
            "actual_total_known_calls": sum(row["total_tokens"] is not None for row in calls),
            "actual_total_tokens": sum(row["total_tokens"] or 0 for row in calls),
            "peak_requested_budget_60s": peak}


@contextmanager
def provider_call_phase(phase, round_number=0, batch_offset=0, question_type=None, *, truncation_retry=False):
    if phase not in ("passage", "first-pass generation", "repair"):
        raise ValueError("Unknown provider call phase")
    token = current_call.set((phase, round_number, batch_offset, question_type))
    retry_token = current_truncation_retry.set(bool(truncation_retry))
    try:
        yield
    finally:
        current_truncation_retry.reset(retry_token)
        current_call.reset(token)


def safe_error_code(value):
    if value is None:
        return "-"
    if isinstance(value, int) and not isinstance(value, bool) and 100 <= value <= 599:
        return str(value)
    return value if isinstance(value, str) and value in ERROR_CODES else "[redacted]"


def safe_header_value(value):
    """Keep numeric counts/durations/HTTP dates only, never arbitrary strings."""
    if not isinstance(value, str) or len(value) > 80:
        return "[redacted]"
    if re.fullmatch(r"-?\d{1,12}(?:\.\d{1,6})?", value):
        return value
    if re.fullmatch(r"(?:\d{1,8}(?:\.\d{1,6})?(?:ms|s|m|h|d))+", value):
        return value
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}T[\d:.+\-]{8,25}Z?", value):
        return value
    try:
        date = parsedate_to_datetime(value)
        if date.tzinfo is not None:
            return date.astimezone(timezone.utc).strftime("%a, %d %b %Y %H:%M:%S GMT")
    except (ValueError, TypeError, OverflowError):
        pass
    return "[redacted]"


def sanitized_message(code, status, raw_message="", failure_type=""):
    # Reconstruct fixed diagnostic wording rather than redact-and-echo prose:
    # provider messages can embed unquoted prompts, options, keys, or schema enums.
    if code == "json_validate_failed":
        text = "Provider JSON validation failed; generated content withheld."
    elif code == "context_length_exceeded":
        text = "Provider context/token limit exceeded; input content withheld."
    elif status == 429 or code in ("rate_limit_exceeded", "RESOURCE_EXHAUSTED", "insufficient_quota"):
        text = "Provider rate/quota limit reached; raw message withheld."
    elif failure_type == "timeout":
        text = "Provider request timed out; exception text withheld."
    elif failure_type == "cancelled":
        text = "Provider request cancelled; exception text withheld."
    elif failure_type in ("incomplete_generation", "truncated_json"):
        text = "Provider returned an incomplete generation; finish/token budget should be checked. Content withheld."
    elif failure_type in ("invalid_response", "empty_generation"):
        text = "Provider returned an empty or invalid response; content withheld."
    elif isinstance(raw_message, str) and any(parameter in raw_message for parameter in (
            "response_format", "responseJsonSchema", "json_schema", "schema")):
        text = "Provider rejected a structured-output request; raw message withheld."
    elif isinstance(raw_message, str) and any(parameter in raw_message for parameter in (
            "max_completion_tokens", "maxOutputTokens", "max_tokens", "thinkingBudget", "reasoning_effort")):
        text = "Provider rejected a token/reasoning setting; raw message withheld."
    else:
        text = "Provider failure; raw message withheld because it may contain input/output content."
    return text[:200]


def record_provider_failure(operation, provider, *, response=None, exception=None, failure_kind=None, output_schema=None):
    if operation is None:
        return
    call_id = operation.provider_attempts
    call = start_provider_call(operation, provider)
    # Wire error capture happens before Groq's recovered-400 path. The retry
    # wrapper also catches mocked/network errors, but must not double-record it.
    if any(row["call"] == call_id for row in operation.provider_failures):
        return
    status = response.status_code if response is not None else call["http_status"]
    call["http_status"] = status
    error = {}
    body = {}
    if response is not None:
        try:
            if len(response.content) <= 262144:
                body = response.json()
                record_provider_usage(operation, provider, body)
                error = body.get("error", {}) if isinstance(body, dict) else {}
                if not isinstance(error, dict):
                    error = {}
        except Exception:
            pass  # Diagnostics must not change provider error/recovery behavior.
    raw_headers = response.headers if response is not None else call["rate_headers"]
    headers = {name: safe_header_value(value) for name, value in raw_headers.items() if name.lower() in RATE_HEADERS}
    code = safe_error_code(error.get("code"))
    error_type = safe_error_code(error.get("type", error.get("status")))
    failure_type = "timeout" if exception is not None and "timeout" in type(exception).__name__.lower() else "http" if status else "response_or_transport_error"
    if failure_kind in ("invalid_response", "incomplete_generation", "truncated_json", "empty_generation", "cancelled"):
        failure_type = failure_kind
    row = {
        "call": call_id, "provider": provider if provider in ("Groq", "Gemini") else "unknown",
        "phase": call["phase"], "batch_offset": call["batch_offset"], "question_type": call["question_type"],
        "truncation_retry": call["truncation_retry"],
        "schema_retry": call["schema_retry"],
        "http_status": status, "error_code": code, "error_type": error_type if error_type != "-" else failure_type,
        "message": sanitized_message(code, status, error.get("message", ""), failure_type),
        "retry_after_present": "retry-after" in raw_headers,
        "retry_after": safe_header_value(raw_headers["retry-after"]) if "retry-after" in raw_headers else "-",
        "rate_limits": headers,
        **{key: call[key] for key in TOKEN_FIELDS},
    }
    if provider == "Groq" and status == 400 and error.get("code") == "json_validate_failed" and "failed_generation" in error:
        finish = error.get("finish_reason", body.get("finish_reason") if isinstance(body, dict) else None)
        choices = body.get("choices") if isinstance(body, dict) else None
        if finish is None and isinstance(choices, list) and choices and isinstance(choices[0], dict):
            finish = choices[0].get("finish_reason")
        row["schema_detail"] = failed_generation_detail(error["failed_generation"], output_schema, finish_reason=finish)
    operation.provider_failures.append(row)

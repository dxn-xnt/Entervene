"""Atomic, durable reservations. All workers must use the same database.

Failed/ambiguous calls retain reservations: a timeout can still be billable.
No prompts, credentials, or generated educational content are persisted here.
"""
from contextvars import ContextVar
from datetime import datetime, timezone
import hashlib
import logging

from fastapi import HTTPException
from sqlalchemy import Column, Integer, MetaData, String, Table, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import SQLAlchemyError

from app.core.Config import settings
from app.db.Session import engine

logger = logging.getLogger("ai.usage")
actor: ContextVar[str | None] = ContextVar("ai_actor", default=None)
metadata = MetaData()
counters = Table(
    "api_usage_counter", metadata,
    Column("scope", String(100), primary_key=True),
    Column("period", String(80), primary_key=True),
    Column("used", Integer, nullable=False),
)
# $0.01 per attempt, deliberately above the allowed models' maximum bounded
# text request cost. Never reconcile downward after uncertain provider failures.
RESERVATION_MICRO_USD = 10000


def _consume(conn, scope: str, period: str, amount: int, limit: int) -> int:
    insert = pg_insert if conn.dialect.name == "postgresql" else sqlite_insert
    conn.execute(insert(counters).values(scope=scope, period=period, used=0)
                 .on_conflict_do_nothing(index_elements=["scope", "period"]))
    used = conn.execute(update(counters).where(
        counters.c.scope == scope, counters.c.period == period,
        counters.c.used <= limit - amount,
    ).values(used=counters.c.used + amount).returning(counters.c.used)).scalar_one_or_none()
    if used is None:
        raise HTTPException(429, "AI usage limit reached. Try later or contact your administrator.",
                            headers={"Retry-After": "60"})
    return used


def reserve_call(identity: str, fingerprint: str, *, now=None, bind=None) -> None:
    now = now or datetime.now(timezone.utc)
    day, month, minute = now.strftime("%Y-%m-%d"), now.strftime("%Y-%m"), now.strftime("%Y-%m-%dT%H:%M")
    identity_hash = hashlib.sha256(identity.encode()).hexdigest()
    try:
        with (bind or engine).begin() as conn:
            failures = conn.execute(select(counters.c.used).where(
                counters.c.scope == "provider_failures", counters.c.period == minute,
            )).scalar_one_or_none() or 0
            if failures >= 5:
                raise HTTPException(503, "AI provider temporarily paused after repeated errors.",
                                    headers={"Retry-After": "60"})
            # Identical lock order across all callers; short transaction, no HTTP inside.
            used = _consume(conn, "school_budget", month, RESERVATION_MICRO_USD,
                            settings.ai_monthly_budget_usd * 1000000)
            _consume(conn, "school_day", day, 1, settings.ai_school_per_day)
            minute_calls = _consume(conn, "school_minute", minute, 1, settings.ai_school_per_minute)
            _consume(conn, "staff_day:" + identity_hash, day, 1, settings.ai_staff_per_day)
            _consume(conn, "duplicate:" + identity_hash, minute + ":" + fingerprint[:32], 1, 1)
        budget = settings.ai_monthly_budget_usd * 1000000
        if used - RESERVATION_MICRO_USD < budget * .8 <= used:
            logger.warning("AI_BUDGET_ALERT reserved_micro_usd=%s budget_micro_usd=%s", used, budget)
        if minute_calls - 1 < settings.ai_school_per_minute * .8 <= minute_calls:
            logger.warning("AI_BURST_ALERT calls_this_minute=%s", minute_calls)
    except SQLAlchemyError:
        logger.error("AI_GUARD_UNAVAILABLE")
        raise HTTPException(503, "AI usage protection unavailable. No AI request was sent.") from None


def record_failure(*, bind=None) -> None:
    try:
        with (bind or engine).begin() as conn:
            _consume(conn, "provider_failures", datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M"), 1, 1000000)
        logger.warning("AI_PROVIDER_ERROR")
    except SQLAlchemyError:
        logger.error("AI_GUARD_UNAVAILABLE")


def reserve_email(email: str, *, bind=None) -> None:
    now = datetime.now(timezone.utc)
    recipient = hashlib.sha256(email.strip().lower().encode()).hexdigest()
    try:
        with (bind or engine).begin() as conn:
            _consume(conn, "email_school_day", now.strftime("%Y-%m-%d"), 1, 1000)
            _consume(conn, "email_recipient:" + recipient, now.strftime("%Y-%m-%dT%H"), 1, 1)
    except SQLAlchemyError:
        raise HTTPException(503, "Email usage protection unavailable.") from None


def usage_snapshot() -> dict:
    now = datetime.now(timezone.utc)
    periods = [now.strftime("%Y-%m"), now.strftime("%Y-%m-%d"), now.strftime("%Y-%m-%dT%H:%M")]
    try:
        with engine.connect() as conn:
            rows = conn.execute(select(counters).where(
                counters.c.scope.in_(["school_budget", "school_day", "school_minute", "provider_failures"]),
                counters.c.period.in_(periods),
            )).mappings().all()
    except SQLAlchemyError:
        raise HTTPException(503, "AI usage protection unavailable.") from None
    values = {row["scope"]: row["used"] for row in rows}
    reserved = values.get("school_budget", 0) / 1000000
    return {"enabled": settings.ai_enabled, "reserved_usd": reserved,
            "monthly_budget_usd": settings.ai_monthly_budget_usd,
            "calls_today": values.get("school_day", 0),
            "calls_this_minute": values.get("school_minute", 0),
            "provider_errors_this_minute": values.get("provider_failures", 0),
            "budget_alert": reserved >= settings.ai_monthly_budget_usd * .8,
            "burst_alert": values.get("school_minute", 0) >= settings.ai_school_per_minute * .8,
            "provider_alert": values.get("provider_failures", 0) >= 5}

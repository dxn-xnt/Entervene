"""Atomic, durable reservations. All workers must use the same database.

Failed/ambiguous calls retain reservations: a timeout can still be billable.
No prompts, credentials, or generated educational content are persisted here.
"""
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import logging

from fastapi import HTTPException
from sqlalchemy import Column, Integer, MetaData, String, Table, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import SQLAlchemyError

from app.core.Config import settings
from app.db.Session import engine


def ai_configured() -> bool:
    """True when at least one AI provider API key is set."""
    return bool(settings.groq_api_key or settings.gemini_api_key)

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


def reserve_call(identity: str, fingerprint: str, *, now=None, bind=None, charge_staff=True) -> None:
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
            if charge_staff:
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


@dataclass(frozen=True)
class ExamCreditHold:
    identity_hash: str
    day: str
    generation_id: str
    created_at: datetime | None = None
    ttl_seconds: int = 900
    free: bool = False
    fill_exam_id: int | None = None
    free_fills_used: int = 0


def _receipt_scope(hold):
    return ("tos_exam_free:" if hold.free else "tos_exam:") + hold.identity_hash


def _insert_counter(conn, scope, period, used=0):
    insert = pg_insert if conn.dialect.name == "postgresql" else sqlite_insert
    conn.execute(insert(counters).values(scope=scope, period=period, used=used)
                 .on_conflict_do_nothing(index_elements=["scope", "period"]))


def _lock_fill(conn, exam_id):
    scope = "tos_fill:" + str(exam_id)
    _insert_counter(conn, scope, "mutex")
    conn.execute(update(counters).where(counters.c.scope == scope,
        counters.c.period == "mutex").values(used=counters.c.used))
    return scope


def _fill_lease(conn, exam_id):
    return conn.execute(select(counters).where(counters.c.scope == "tos_fill:" + str(exam_id),
        counters.c.period.startswith("active:", autoescape=True), counters.c.used == 1)).mappings().one_or_none()


def fill_missing_usage(exam_id: int, *, bind=None) -> int:
    try:
        with (bind or engine).connect() as conn:
            return conn.execute(select(counters.c.used).where(
                counters.c.scope == "tos_fill:" + str(exam_id), counters.c.period == "free_completed",
            )).scalar_one_or_none() or 0
    except SQLAlchemyError:
        raise HTTPException(503, "AI fill protection unavailable.") from None


def _receipt_period(hold):
    return hold.day + ":" + hold.generation_id


def _lock_staff(conn, hold):
    if hold.fill_exam_id is not None:
        _lock_fill(conn, hold.fill_exam_id)
    # Free fills must still have a mutex row, but never require daily credits.
    _insert_counter(conn, "staff_day:" + hold.identity_hash, hold.day)
    conn.execute(update(counters).where(
        counters.c.scope == "staff_day:" + hold.identity_hash, counters.c.period == hold.day,
    ).values(used=counters.c.used))


def _lease_row(conn, hold):
    return conn.execute(select(counters).where(
        counters.c.scope == "tos_lease:" + hold.identity_hash,
        counters.c.period.startswith(_receipt_period(hold) + ":", autoescape=True),
    )).mappings().one_or_none()


def _write_hold_metadata(conn, hold, now):
    # Timestamps live in the existing string period, avoiding schema changes
    # and the 2038 overflow of the existing 32-bit `used` column.
    conn.execute(counters.insert().values(scope="tos_created:" + hold.identity_hash,
        period=_receipt_period(hold) + ":" + now.isoformat(), used=hold.ttl_seconds))
    conn.execute(counters.insert().values(scope="tos_lease:" + hold.identity_hash,
        period=_receipt_period(hold) + ":" + str((now + timedelta(seconds=hold.ttl_seconds)).timestamp()), used=1))


def heartbeat_exam_credit(hold: ExamCreditHold, *, now=None, bind=None) -> bool:
    now = now or datetime.now(timezone.utc)
    try:
        with (bind or engine).begin() as conn:
            _lock_staff(conn, hold)
            state = conn.execute(select(counters.c.used).where(
                counters.c.scope == _receipt_scope(hold),
                counters.c.period == _receipt_period(hold),
            )).scalar_one_or_none()
            lease = _lease_row(conn, hold)
            if state != 1 or lease is None or float(lease["period"].rsplit(":", 1)[1]) <= now.timestamp():
                return False  # Never resurrect a released or expired receipt.
            conn.execute(update(counters).where(counters.c.scope == lease["scope"],
                counters.c.period == lease["period"]).values(
                    period=_receipt_period(hold) + ":" + str((now + timedelta(seconds=hold.ttl_seconds)).timestamp())))
            if hold.fill_exam_id is not None:
                active = _fill_lease(conn, hold.fill_exam_id)
                prefix = "active:" + _receipt_period(hold) + ":"
                if active is None or not active["period"].startswith(prefix) or float(active["period"].rsplit(":", 1)[1]) <= now.timestamp():
                    return False
                conn.execute(update(counters).where(counters.c.scope == active["scope"],
                    counters.c.period == active["period"]).values(period=prefix + str((now + timedelta(seconds=hold.ttl_seconds)).timestamp())))
        return True
    except SQLAlchemyError:
        raise HTTPException(503, "AI credit heartbeat unavailable.") from None


def reconcile_expired_holds(*, now=None, bind=None) -> int:
    """CAS refund with the same fill->staff->receipt order as finalization.

    Candidate leases are re-read under the mutex locks, so a concurrent heartbeat
    wins safely. Historical pre-lease holds receive one full TTL grace period.
    """
    now = now or datetime.now(timezone.utc)
    released = 0
    try:
        meter = bind or engine
        with meter.connect() as conn:
            candidates = conn.execute(select(counters).where(
                (counters.c.scope.startswith("tos_exam:", autoescape=True) |
                 counters.c.scope.startswith("tos_exam_free:", autoescape=True)), counters.c.used == 1,
            )).mappings().all()
        for candidate in candidates:
            day, generation_id = candidate["period"].split(":", 1)
            hold = ExamCreditHold(candidate["scope"].split(":", 1)[1], day, generation_id,
                                  ttl_seconds=settings.tos_credit_hold_ttl_seconds,
                                  free=candidate["scope"].startswith("tos_exam_free:"))
            with meter.begin() as conn:
                fill_id = conn.execute(select(counters.c.used).where(
                    counters.c.scope == "tos_fill_link:" + hold.identity_hash,
                    counters.c.period == _receipt_period(hold),
                )).scalar_one_or_none()
                if fill_id is not None:
                    from dataclasses import replace
                    hold = replace(hold, fill_exam_id=fill_id)
                _lock_staff(conn, hold)
                state = conn.execute(select(counters.c.used).where(
                    counters.c.scope == candidate["scope"], counters.c.period == candidate["period"],
                )).scalar_one_or_none()
                if state != 1:
                    continue
                lease = _lease_row(conn, hold)
                if lease is None:
                    _write_hold_metadata(conn, hold, now)
                    continue
                if float(lease["period"].rsplit(":", 1)[1]) > now.timestamp():
                    continue
                changed = conn.execute(update(counters).where(
                    counters.c.scope == candidate["scope"], counters.c.period == candidate["period"],
                    counters.c.used == 1,
                ).values(used=3).returning(counters.c.used)).scalar_one_or_none()
                if changed is not None and not hold.free:
                    conn.execute(update(counters).where(
                        counters.c.scope == "staff_day:" + hold.identity_hash,
                        counters.c.period == hold.day, counters.c.used > 0,
                    ).values(used=counters.c.used - 1))
                if changed is not None:
                    released += 1
                    if hold.fill_exam_id is not None:
                        _release_fill(conn, hold, successful=False)
        if released:
            logger.info("TOS_CREDIT_RECONCILED released=%s", released)
    except SQLAlchemyError:
        logger.warning("TOS_CREDIT_RECONCILIATION_UNAVAILABLE")
    return released


def reserve_exam_credit(identity: str, generation_id: str, *, now=None, bind=None) -> ExamCreditHold:
    """Hold one daily credit atomically, irrespective of the number of calls.

    Receipt states: 1=held, 2=charged, 3=released. Existing counter storage is
    reused; no migration. A crash retains the hold until lease reconciliation.
    """
    now = now or datetime.now(timezone.utc)
    day = now.strftime("%Y-%m-%d")
    identity_hash = hashlib.sha256(identity.encode()).hexdigest()
    hold = ExamCreditHold(identity_hash, day, generation_id, now, settings.tos_credit_hold_ttl_seconds)
    try:
        with (bind or engine).begin() as conn:
            _consume(conn, "staff_day:" + identity_hash, day, 1, settings.ai_staff_per_day)
            _consume(conn, "tos_exam:" + identity_hash, day + ":" + generation_id, 1, 1)
            _write_hold_metadata(conn, hold, now)
    except SQLAlchemyError:
        logger.error("AI_GUARD_UNAVAILABLE")
        raise HTTPException(503, "AI credit protection unavailable. No AI request was sent.") from None
    return hold


def reserve_fill_credit(identity: str, generation_id: str, exam_id: int, initially_short: bool,
                        *, now=None, bind=None) -> ExamCreditHold:
    """One active fill per exam. Free quota is spent only on successful additions."""
    now = now or datetime.now(timezone.utc)
    identity_hash = hashlib.sha256(identity.encode()).hexdigest()
    try:
        with (bind or engine).begin() as conn:
            scope = _lock_fill(conn, exam_id)
            active = _fill_lease(conn, exam_id)
            if active is not None:
                if float(active["period"].rsplit(":", 1)[1]) > now.timestamp():
                    raise HTTPException(409, "Missing-item generation is already running for this exam.")
                conn.execute(update(counters).where(counters.c.scope == scope,
                    counters.c.period == active["period"]).values(used=3))
            _insert_counter(conn, scope, "free_completed")
            used = conn.execute(select(counters.c.used).where(counters.c.scope == scope,
                counters.c.period == "free_completed")).scalar_one()
            hold = ExamCreditHold(identity_hash, now.strftime("%Y-%m-%d"), generation_id, now,
                settings.tos_credit_hold_ttl_seconds, initially_short and used < settings.tos_fill_missing_free_limit, exam_id, used)
            _lock_staff(conn, hold)
            if not hold.free:
                _consume(conn, "staff_day:" + identity_hash, hold.day, 1, settings.ai_staff_per_day)
            _consume(conn, _receipt_scope(hold), _receipt_period(hold), 1, 1)
            _write_hold_metadata(conn, hold, now)
            conn.execute(counters.insert().values(scope="tos_fill_link:" + identity_hash,
                period=_receipt_period(hold), used=exam_id))
            conn.execute(counters.insert().values(scope=scope,
                period="active:" + _receipt_period(hold) + ":" + str((now + timedelta(seconds=hold.ttl_seconds)).timestamp()), used=1))
        return hold
    except SQLAlchemyError:
        raise HTTPException(503, "AI fill protection unavailable. No AI request was sent.") from None


def _release_fill(conn, hold, successful):
    active = _fill_lease(conn, hold.fill_exam_id)
    if active is None or not active["period"].startswith("active:" + _receipt_period(hold) + ":"):
        return False
    if successful and hold.free:
        conn.execute(update(counters).where(counters.c.scope == active["scope"],
            counters.c.period == "free_completed").values(used=counters.c.used + 1))
    conn.execute(update(counters).where(counters.c.scope == active["scope"],
        counters.c.period == active["period"]).values(used=2 if successful else 3))
    return True


def finalize_exam_credit(hold: ExamCreditHold, produced_count: int, *, requested_count=None, bind=None) -> bool:
    """Charge one credit at the configured final coverage; otherwise release it.

    The receipt transition and any refund share one transaction. Repeated
    finalization cannot double-charge or double-refund, including concurrent
    workers. Physical provider-budget reservations are NEVER refunded here.
    """
    charge = not hold.free and produced_count > 0 and (requested_count is None or (
        Decimal(produced_count) >= Decimal(requested_count) * Decimal(str(settings.tos_short_exam_charge_threshold))))
    try:
        with (bind or engine).begin() as conn:
            # Match admission's fill -> staff -> receipt lock order. In particular,
            # refund and duplicate admission must not deadlock on PostgreSQL.
            _lock_staff(conn, hold)
            prior_state = conn.execute(select(counters.c.used).where(
                counters.c.scope == _receipt_scope(hold),
                counters.c.period == _receipt_period(hold),
            )).scalar_one_or_none()
            if prior_state in (2, 4):
                return prior_state == 2
            if hold.fill_exam_id is not None and produced_count > 0:
                active = _fill_lease(conn, hold.fill_exam_id)
                if active is None or not active["period"].startswith("active:" + _receipt_period(hold) + ":"):
                    raise HTTPException(409, "This fill request lost its lease. Reload the exam.")
            changed = conn.execute(update(counters).where(
                counters.c.scope == _receipt_scope(hold),
                counters.c.period == hold.day + ":" + hold.generation_id,
                counters.c.used == 1,
            ).values(used=2 if charge else 4 if hold.free and produced_count > 0 else 3).returning(counters.c.used)).scalar_one_or_none()
            if changed is not None and not charge and not hold.free:
                conn.execute(update(counters).where(
                    counters.c.scope == "staff_day:" + hold.identity_hash,
                    counters.c.period == hold.day,
                    counters.c.used > 0,
                ).values(used=counters.c.used - 1))
            state = conn.execute(select(counters.c.used).where(
                counters.c.scope == _receipt_scope(hold),
                counters.c.period == _receipt_period(hold),
            )).scalar_one_or_none()
            if charge and state != 2:
                raise HTTPException(503, "AI credit hold expired. Please generate again.")
            if changed is not None and hold.fill_exam_id is not None:
                _release_fill(conn, hold, successful=produced_count > 0)
            return state == 2
    except SQLAlchemyError:
        logger.error("AI_GUARD_UNAVAILABLE")
        raise HTTPException(503, "AI credit finalization unavailable.") from None


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
    return {"enabled": settings.ai_enabled, "configured": ai_configured(),
            "reserved_usd": reserved,
            "monthly_budget_usd": settings.ai_monthly_budget_usd,
            "calls_today": values.get("school_day", 0),
            "calls_this_minute": values.get("school_minute", 0),
            "provider_errors_this_minute": values.get("provider_failures", 0),
            "budget_alert": reserved >= settings.ai_monthly_budget_usd * .8,
            "burst_alert": values.get("school_minute", 0) >= settings.ai_school_per_minute * .8,
            "provider_alert": values.get("provider_failures", 0) >= 5}


def staff_usage_snapshot(staff_id: str) -> dict:
    """Return the authenticated teacher's personal AI usage for today."""
    configured = ai_configured()
    if not configured:
        return {"used_today": 0, "daily_limit": settings.ai_staff_per_day,
                "enabled": settings.ai_enabled, "configured": False}
    now = datetime.now(timezone.utc)
    day = now.strftime("%Y-%m-%d")
    identity_hash = hashlib.sha256(staff_id.encode()).hexdigest()
    scope_key = "staff_day:" + identity_hash
    try:
        with engine.connect() as conn:
            used = conn.execute(select(counters.c.used).where(
                counters.c.scope == scope_key, counters.c.period == day,
            )).scalar_one_or_none() or 0
    except SQLAlchemyError:
        raise HTTPException(503, "AI usage information unavailable.") from None
    return {"used_today": used, "daily_limit": settings.ai_staff_per_day,
            "enabled": settings.ai_enabled, "configured": True}


"""One exam credit lifecycle and count-only, PII-free generation telemetry."""
from collections import Counter
import asyncio
from contextlib import asynccontextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
import json
import logging
from uuid import uuid4

from starlette.concurrency import run_in_threadpool

from fastapi import HTTPException
from app.core.Config import settings
from app.services.ai.provider_diagnostics import token_usage_summary, discard_summary
from app.services.ai.UsageGuard import (
    ExamCreditHold, reserve_exam_credit, finalize_exam_credit,
    heartbeat_exam_credit, reconcile_expired_holds,
    reserve_fill_credit,
)

logger = logging.getLogger("ai.tos.telemetry")


def validate_heartbeat_settings():
    interval = settings.tos_credit_heartbeat_interval_seconds
    effective = interval if interval is not None else min(60, settings.tos_credit_hold_ttl_seconds / 3)
    if effective > settings.tos_credit_hold_ttl_seconds / 3:
        logging.getLogger("uvicorn.error").critical(
            "TOS_HEARTBEAT_UNSAFE interval_seconds=%s ttl_seconds=%s", effective, settings.tos_credit_hold_ttl_seconds)
        raise RuntimeError("TOS heartbeat interval must be at most one third of the credit hold TTL.")
    return effective


def check_telemetry_logging() -> bool:
    sink = logger
    handlers = []
    while sink is not None:
        handlers.extend(sink.handlers)
        sink = sink.parent if sink.propagate else None
    record = logging.LogRecord(logger.name, logging.INFO, "", 0, "TOS_TELEMETRY_CHECK", (), None)
    try:
        enabled = logger.isEnabledFor(logging.INFO) and bool(logger.filter(record)) and any(
            not isinstance(handler, logging.NullHandler) and handler.level <= logging.INFO and handler.filter(record)
            for handler in handlers)
    except Exception:
        enabled = False
    if not enabled:
        logging.getLogger("uvicorn.error").warning(
            "TOS_TELEMETRY_DISABLED: configure ai.tos.telemetry at INFO with an INFO-capable handler.")
    return enabled


@dataclass
class RowMetrics:
    requested: Counter = field(default_factory=Counter)
    first_pass: Counter = field(default_factory=Counter)
    final: Counter = field(default_factory=Counter)
    discards: Counter = field(default_factory=Counter)
    repair_rounds: int = 0
    passage_repairs: int = 0
    truncation_retries: int = 0
    recovered_from_400: int = 0
    context_fields_filled: int = 0


@dataclass
class ExamGeneration:
    identity: str  # Never included in telemetry.
    requested: Counter
    generation_id: str = field(default_factory=lambda: uuid4().hex)
    hold: ExamCreditHold | None = None
    rows: list[RowMetrics] = field(default_factory=list)
    final: Counter = field(default_factory=Counter)
    completed: bool = False
    provider_attempts: int = 0
    transient_retries: int = 0
    schema_retries: int = 0
    provider_failures: list[dict] = field(default_factory=list)  # Sanitized metadata only.
    provider_calls: list[dict] = field(default_factory=list)  # Counts and fixed phase/type labels only.
    credit_finalized: bool = False
    credit_charged: bool = False
    existing: Counter = field(default_factory=Counter)
    billable_new_items: bool = True
    lease_failed: bool = False
    heartbeat_stop: asyncio.Event = field(default_factory=asyncio.Event)
    heartbeat_task: asyncio.Task | None = None

    async def ensure_credit_hold(self):
        if self.lease_failed:
            raise HTTPException(503, "AI credit hold could not be maintained. Generation stopped.")
        if self.hold is None:
            self.hold = await run_in_threadpool(reserve_exam_credit, self.identity, self.generation_id)
            self.heartbeat_task = asyncio.create_task(self._heartbeat())
        elif not await run_in_threadpool(heartbeat_exam_credit, self.hold):
            self.lease_failed = True
            raise HTTPException(503, "AI credit hold expired. Generation stopped.")

    async def reserve_fill(self, exam_id, initially_short):
        self.hold = await run_in_threadpool(reserve_fill_credit, self.identity, self.generation_id, exam_id, initially_short)
        self.heartbeat_task = asyncio.create_task(self._heartbeat())

    async def _heartbeat(self):
        while True:
            try:
                interval = settings.tos_credit_heartbeat_interval_seconds
                await asyncio.wait_for(self.heartbeat_stop.wait(), timeout=min(
                    interval if interval is not None else 60, self.hold.ttl_seconds / 3))
                return
            except asyncio.TimeoutError:
                try:
                    if not await run_in_threadpool(heartbeat_exam_credit, self.hold):
                        self.lease_failed = True
                        return
                except HTTPException:
                    self.lease_failed = True
                    return

    def summary(self) -> dict:
        first, discards = self.existing.copy(), Counter()
        for row in self.rows:
            first.update(row.first_pass)
            discards.update(row.discards)
        return {
            "generation_id": self.generation_id,
            "requested_per_type": dict(self.requested),
            "first_pass_per_type": {kind: first[kind] for kind in self.requested},
            **discard_summary(discards),
            "truncation_retries": sum(row.truncation_retries for row in self.rows),
            "recovered_from_400": sum(row.recovered_from_400 for row in self.rows),
            "context_fields_filled": sum(row.context_fields_filled for row in self.rows),
            "repair_rounds_used": max((row.repair_rounds for row in self.rows), default=0),
            "row_repair_rounds_total": sum(row.repair_rounds for row in self.rows),
            "passage_repair_rounds_total": sum(row.passage_repairs for row in self.rows),
            "final_per_type": {kind: self.final[kind] for kind in self.requested},
            "final_shortfall_per_type": {kind: max(0, count - self.final[kind]) for kind, count in self.requested.items()},
            "provider_attempts": self.provider_attempts,
            "transient_retries": self.transient_retries,
            "schema_retries": self.schema_retries,
            "failed_provider_calls": len(self.provider_failures),
            "failed_schema_generations": [{"call": row["call"], "phase": row["phase"],
                "budget_requested": row["budget_requested"], **row["schema_detail"]}
                for row in self.provider_failures if "schema_detail" in row],
            "token_usage": token_usage_summary(self.provider_calls),
            "completed": self.completed,
            "credits_charged": int(self.credit_charged),
            "credit_hold_retained": self.hold is not None and not self.credit_finalized,
        }


current_generation: ContextVar[ExamGeneration | None] = ContextVar("tos_exam_generation", default=None)


@asynccontextmanager
async def exam_generation(identity: str, requested: Counter):
    """Reconcile first; reserve a fresh credit only when provider traffic starts."""
    operation = ExamGeneration(identity, requested)
    token = current_generation.set(operation)
    try:
        await run_in_threadpool(reconcile_expired_holds)
        yield operation
    finally:
        try:
            operation.heartbeat_stop.set()
            if operation.heartbeat_task is not None:
                await operation.heartbeat_task
            # Failed/cancelled requests never deliver their partial questions.
            if not operation.completed:
                operation.final.clear()
            if operation.hold is not None:
                try:
                    operation.credit_charged = await run_in_threadpool(finalize_exam_credit, operation.hold,
                        sum(operation.final.values()) if operation.completed and operation.billable_new_items and not operation.lease_failed else 0,
                        requested_count=sum(operation.requested.values()))
                    operation.credit_finalized = True
                    if operation.lease_failed:
                        raise HTTPException(503, "AI credit hold could not be maintained. Generation stopped.")
                except Exception:
                    operation.completed = False
                    operation.final.clear()
                    raise
        finally:
            logger.info("TOS_GENERATION %s", json.dumps(operation.summary(), sort_keys=True))
            current_generation.reset(token)

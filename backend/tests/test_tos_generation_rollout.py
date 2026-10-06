"""Pre-rollout tests: all counters isolated, all generation/provider calls mocked."""
import asyncio
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
import json
import logging
from io import StringIO
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.pool import StaticPool

from app.services.ai import UsageGuard as guard, tos_generation as generation
from app.services.ai import tos_generation_session as session
from app.schemas.AITOS import TOSQuestionIn, TOSQuestionOut, TOSPassage, AITOSRepairRequest, TOSExamDetailResponse


@pytest.fixture
def meter(monkeypatch):
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    guard.metadata.create_all(engine)
    monkeypatch.setattr(guard, "engine", engine)
    monkeypatch.setattr(guard.settings, "tos_credit_hold_ttl_seconds", 900)
    monkeypatch.setattr(guard.settings, "tos_short_exam_charge_threshold", 0.6)
    monkeypatch.setattr(guard.settings, "tos_fill_missing_free_limit", 3)
    monkeypatch.setattr(guard.settings, "tos_credit_heartbeat_interval_seconds", None)
    monkeypatch.setattr(guard.settings, "ai_staff_per_day", 100)
    yield engine
    engine.dispose()


def used(engine):
    with engine.connect() as conn:
        return sum(conn.execute(select(guard.counters.c.used).where(guard.counters.c.scope.like("staff_day:%"))).scalars())


def test_crash_hold_expires_once_and_keeps_creation_time(meter):
    now = datetime(2026, 10, 6, tzinfo=timezone.utc)
    hold = guard.reserve_exam_credit("isolated", "crashed", now=now)
    assert hold.created_at == now and hold.ttl_seconds == 900
    with meter.connect() as conn:
        metadata = conn.execute(select(guard.counters).where(guard.counters.c.scope.like("tos_created:%"))).mappings().one()
    assert metadata["period"].endswith(now.isoformat()) and metadata["used"] == 900
    assert guard.reconcile_expired_holds(now=now + timedelta(seconds=899)) == 0
    assert guard.reconcile_expired_holds(now=now + timedelta(seconds=900)) == 1
    assert used(meter) == 0
    assert guard.reconcile_expired_holds(now=now + timedelta(days=1)) == 0
    assert not guard.heartbeat_exam_credit(hold, now=now + timedelta(days=1))


def test_active_heartbeat_extends_original_ttl(meter):
    now = datetime(2026, 10, 6, tzinfo=timezone.utc)
    hold = guard.reserve_exam_credit("isolated", "active", now=now)
    assert guard.heartbeat_exam_credit(hold, now=now + timedelta(seconds=800))
    assert guard.reconcile_expired_holds(now=now + timedelta(seconds=1000)) == 0
    assert used(meter) == 1
    assert guard.reconcile_expired_holds(now=now + timedelta(seconds=1700)) == 1


def test_two_concurrent_sweeps_refund_only_once(tmp_path):
    engine = create_engine("sqlite:///" + str(tmp_path / "isolated-meter.sqlite"))
    guard.metadata.create_all(engine)
    now = datetime.now(timezone.utc)
    guard.reserve_exam_credit("isolated", "crashed", now=now, bind=engine)
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            refunds = list(pool.map(lambda _: guard.reconcile_expired_holds(now=now + timedelta(days=1), bind=engine), range(2)))
        assert sorted(refunds) == [0, 1] and used(engine) == 0
    finally:
        engine.dispose()


def test_charged_exam_never_refunded_by_sweep(meter):
    now = datetime.now(timezone.utc)
    hold = guard.reserve_exam_credit("isolated", "charged", now=now)
    assert guard.finalize_exam_credit(hold, 6, requested_count=10)
    assert guard.reconcile_expired_holds(now=now + timedelta(days=7)) == 0
    assert used(meter) == 1


@pytest.mark.parametrize("produced,charge", [(5, False), (6, True), (7, True), (0, False)])
def test_default_threshold_below_exact_above(meter, produced, charge):
    hold = guard.reserve_exam_credit("isolated", "threshold")
    assert guard.finalize_exam_credit(hold, produced, requested_count=10) is charge
    assert used(meter) == int(charge)
    guard.finalize_exam_credit(hold, 0, requested_count=10)
    assert used(meter) == int(charge)


def test_threshold_is_configurable(meter, monkeypatch):
    monkeypatch.setattr(guard.settings, "tos_short_exam_charge_threshold", 0.8)
    hold = guard.reserve_exam_credit("isolated", "configurable")
    assert not guard.finalize_exam_credit(hold, 7, requested_count=10)
    assert used(meter) == 0


def test_legacy_hold_gets_one_ttl_grace_period(meter):
    now = datetime.now(timezone.utc)
    hold = guard.reserve_exam_credit("isolated", "legacy", now=now)
    with meter.begin() as conn:
        conn.execute(guard.counters.delete().where(guard.counters.c.scope.in_([
            "tos_lease:" + hold.identity_hash, "tos_created:" + hold.identity_hash])))
    assert guard.reconcile_expired_holds(now=now) == 0
    assert guard.reconcile_expired_holds(now=now + timedelta(seconds=900)) == 1


def test_generation_entry_reconciles_and_long_operation_heartbeats(meter, monkeypatch):
    heartbeat = Mock(return_value=True)
    monkeypatch.setattr(session, "heartbeat_exam_credit", heartbeat)
    monkeypatch.setattr(guard.settings, "tos_credit_hold_ttl_seconds", 0.03)
    reconcile = Mock()
    monkeypatch.setattr(session, "reconcile_expired_holds", reconcile)
    async def run():
        async with session.exam_generation("isolated", Counter(MULTIPLE_CHOICE=10)) as op:
            await op.ensure_credit_hold()
            await asyncio.wait_for(asyncio.Event().wait(), timeout=0.04)
    with pytest.raises(asyncio.TimeoutError):
        asyncio.run(run())
    assert heartbeat.call_count >= 1 and reconcile.call_count == 1
    assert used(meter) == 0


def test_lost_heartbeat_stops_completed_generation_and_releases_credit(meter, monkeypatch):
    monkeypatch.setattr(guard.settings, "tos_credit_hold_ttl_seconds", 0.03)
    monkeypatch.setattr(session, "heartbeat_exam_credit", Mock(return_value=False))
    async def run():
        async with session.exam_generation("isolated", Counter(MULTIPLE_CHOICE=10)) as operation:
            await operation.ensure_credit_hold()
            try:
                await asyncio.wait_for(asyncio.Event().wait(), timeout=0.04)
            except asyncio.TimeoutError:
                pass
            operation.final = Counter(MULTIPLE_CHOICE=10)
            operation.completed = True
    with pytest.raises(HTTPException) as exc:
        asyncio.run(run())
    assert exc.value.status_code == 503 and used(meter) == 0
    assert session.current_generation.get() is None


def test_swept_hold_cannot_later_charge_or_resurrect(meter):
    now = datetime.now(timezone.utc)
    hold = guard.reserve_exam_credit("isolated", "crashed", now=now)
    assert guard.reconcile_expired_holds(now=now + timedelta(days=1)) == 1
    with pytest.raises(HTTPException) as exc:
        guard.finalize_exam_credit(hold, 10, requested_count=10)
    assert exc.value.status_code == 503 and used(meter) == 0


def test_telemetry_checks_logger_and_handler_levels(caplog, monkeypatch):
    log = logging.getLogger("isolated.tos.telemetry")
    log.propagate = False
    handler = logging.StreamHandler(StringIO())
    handler.setLevel(logging.WARNING)
    log.handlers = [handler]
    log.setLevel(logging.INFO)
    monkeypatch.setattr(session, "logger", log)
    with caplog.at_level(logging.WARNING, logger="uvicorn.error"):
        assert not session.check_telemetry_logging()
    assert "TOS_TELEMETRY_DISABLED" in caplog.text
    handler.setLevel(logging.INFO)
    assert session.check_telemetry_logging()
    log.setLevel(logging.WARNING)
    assert not session.check_telemetry_logging()


def saved_question(number=1, passage=None):
    return TOSQuestionOut(tos_question_id=number, tos_exam_id=7, competency_id=1,
        competency_label="Plants", question_text=f"Plant question {number}?", question_type="MULTIPLE_CHOICE",
        difficulty_band="EASY", cognitive_level="REMEMBER", display_order=number,
        explanation="A rationale", options=[{"option_text": word, "is_correct": index == 0}
            for index, word in enumerate(["Root", "Stem", "Leaf", "Flower"])],
        passage=passage, passage_id=passage.id if passage else None)


def test_missing_only_requests_exact_deficit_preserves_existing_passage_and_questions(monkeypatch):
    passage = TOSPassage(id="existing", title="A garden", text=" ".join(["garden"] * 150))
    existing = saved_question(passage=passage).model_dump()
    raw = {"question_text": "Which part absorbs water?", "question_type": "MULTIPLE_CHOICE",
        "cognitive_level": "REMEMBER", "difficulty_band": "EASY", "points": 1.0,
        "explanation": "Roots absorb water.", "options": ["Root", "Stem", "Leaf", "Flower"],
        "correct_index": 0, "passage_id": passage.id}
    generate = AsyncMock(return_value=json.dumps({"questions": [raw]}))
    monkeypatch.setattr(generation, "generate_text", generate)
    new = asyncio.run(generation.generate_tos_row_questions("Reading main idea", None, "English",
        {"MULTIPLE_CHOICE": 2}, {"REMEMBER": 2}, passage=passage,
        existing_questions=[existing], existing_stems=[existing["question_text"]], missing_only=True))
    assert len(new) == 1 and new[0]["passage"] == passage.model_dump()
    assert existing == saved_question(passage=passage).model_dump()
    prompt = json.loads(generate.call_args.args[0])
    assert prompt["count"] == 1 and prompt["missing_blueprint_cells"][0]["count"] == 1
    assert prompt["existing_stems_do_not_repeat"] == [existing["question_text"]]
    assert generate.call_count == 1


def route_setup(monkeypatch, count=1, owner="isolated"):
    from app.api.v1.routes import AIAssist as route
    questions = [saved_question(number) for number in range(1, count + 1)]
    saved = TOSExamDetailResponse(tos_exam_id=7, subject_id=1, title="Plants", quarter="Term 1", status="DRAFT",
        questions=questions, updated_at=datetime.now(timezone.utc), difficulty_ratio={"blueprint_rows": [{
            "competency_id": 1, "label": "Plants", "type_counts": {"MULTIPLE_CHOICE": 2}, "bloom_targets": {"REMEMBER": 2}}]})
    db = Mock()
    db.query.return_value.filter.return_value.first.side_effect = [SimpleNamespace(created_by_staff_id=owner),
        SimpleNamespace(subject_name="Science")]
    monkeypatch.setattr(route, "get_tos_exam_detail", Mock(return_value=saved))
    generate = AsyncMock(return_value=[saved_question(3).model_dump(exclude={"tos_exam_id", "tos_question_id"})])
    append = Mock(return_value=saved.model_copy(update={"questions": [*questions, saved_question(3)]}))
    monkeypatch.setattr(route, "generate_tos_row_questions", generate)
    monkeypatch.setattr(route, "append_tos_questions", append)
    return route, db, generate, append, saved


def test_saved_exam_repair_preserves_all_existing_and_appends_only_new(meter, monkeypatch):
    route, db, generate, append, saved = route_setup(monkeypatch)
    result = asyncio.run(route.generate_missing_tos_questions(7, AITOSRepairRequest(), "isolated", {"role": "teacher"}, db))
    assert result.added_count == 1 and result.questions[0] == saved.questions[0]
    assert generate.call_args.kwargs["existing_questions"] == [saved.questions[0].model_dump()]
    assert generate.call_args.kwargs["missing_only"] is True
    assert append.call_args.args[2] == saved.updated_at
    assert append.call_args.args[1][0].display_order == 2


def test_complete_saved_exam_no_provider_no_charge_no_write(meter, monkeypatch):
    route, db, generate, append, saved = route_setup(monkeypatch, count=2)
    result = asyncio.run(route.generate_missing_tos_questions(7, AITOSRepairRequest(), "isolated", {"role": "teacher"}, db))
    assert result.questions == saved.questions and result.added_count == result.credits_charged == 0
    generate.assert_not_called()
    append.assert_not_called()
    assert used(meter) == 0


def test_saved_exam_repair_checks_owner_before_generation(meter, monkeypatch):
    route, db, generate, append, _ = route_setup(monkeypatch, owner="other")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(route.generate_missing_tos_questions(7, AITOSRepairRequest(), "isolated", {"role": "teacher"}, db))
    assert exc.value.status_code == 403
    generate.assert_not_called()
    append.assert_not_called()


@pytest.mark.parametrize("existing_count,new_count,charge", [(4, 1, 0), (5, 1, 1), (6, 1, 1), (6, 0, 0)])
def test_separate_saved_repair_bills_final_exam_threshold_once(meter, monkeypatch, existing_count, new_count, charge):
    # The previous per-request tariff remains the fallback when free fills are disabled/exhausted.
    monkeypatch.setattr(guard.settings, "tos_fill_missing_free_limit", 0)
    from app.services.ai import Provider as provider
    route, db, _, append, saved = route_setup(monkeypatch, count=existing_count)
    saved.difficulty_ratio["blueprint_rows"][0].update(type_counts={"MULTIPLE_CHOICE": 10}, bloom_targets={"REMEMBER": 10})
    monkeypatch.setattr(route, "generate_tos_row_questions", generation.generate_tos_row_questions)
    monkeypatch.setattr(provider.settings, "ai_enabled", True)
    monkeypatch.setattr(provider.settings, "groq_api_key", "mock-only")
    monkeypatch.setattr(provider.settings, "gemini_api_key", None)
    monkeypatch.setattr(provider.settings, "ai_school_per_minute", 60)
    good = {"question_text": "Fresh plant fact?", "question_type": "MULTIPLE_CHOICE",
        "difficulty_band": "EASY", "cognitive_level": "REMEMBER", "points": 1.0,
        "explanation": "A rationale", "options": ["Root", "Stem", "Leaf", "Flower"], "correct_index": 0, "passage_id": None}
    execute = AsyncMock(side_effect=[json.dumps({"questions": [good] if new_count else []})] +
                                    [json.dumps({"questions": []})] * 3)
    monkeypatch.setattr(provider, "_execute_groq", execute)
    append.side_effect = lambda _id, new, _revision, _db: SimpleNamespace(questions=[*saved.questions, *new])
    async def run():
        token = guard.actor.set("isolated")
        try:
            return await route.generate_missing_tos_questions(7, AITOSRepairRequest(), "isolated", {"role": "teacher"}, db)
        finally:
            guard.actor.reset(token)
    result = asyncio.run(run())
    assert result.added_count == new_count and result.credits_charged == charge
    assert len(result.questions) == existing_count + new_count and used(meter) == charge
    assert execute.call_count == 4


def test_startup_checks_telemetry_and_reconciles_without_provider(monkeypatch):
    from app import main
    check, reconcile = Mock(), Mock(return_value=0)
    monkeypatch.setattr(main, "check_telemetry_logging", check)
    monkeypatch.setattr(main, "reconcile_expired_holds", reconcile)
    async def run():
        async with main.lifespan(main.app):
            pass
    asyncio.run(run())
    check.assert_called_once()
    reconcile.assert_called_once()


def test_append_preserves_saved_ids_content_and_detects_revision_conflict(meter):
    from sqlalchemy.orm import Session
    from app.models.tos.TOSExam import TOSExam
    from app.models.tos.TOSQuestion import TOSQuestion
    from app.services.tos.TOSService import append_tos_questions, get_tos_exam_detail
    from app.services.tos.passage_metadata import encode_question_metadata
    TOSExam.__table__.create(meter)
    TOSQuestion.__table__.create(meter)
    with Session(meter) as db:
        exam = TOSExam(subject_id=1, title="Plants", status="DRAFT")
        db.add(exam)
        db.flush()
        old = saved_question(1, passage=TOSPassage(id="preserved", title="A garden", text="Rain fell. Plants grew."))
        original = TOSQuestion(tos_exam_id=exam.tos_exam_id, competency_label=old.competency_label,
            question_text=old.question_text, question_type=old.question_type, difficulty_band=old.difficulty_band,
            cognitive_level=old.cognitive_level, display_order=1, explanation=encode_question_metadata(old),
            options_json=json.dumps([o.model_dump() for o in old.options]))
        db.add(original)
        db.commit()
        original_id = original.tos_question_id
        snapshot = get_tos_exam_detail(exam.tos_exam_id, db)
        new = TOSQuestionIn(**saved_question(2).model_dump(exclude={"tos_exam_id", "tos_question_id"}))
        result = append_tos_questions(exam.tos_exam_id, [new], snapshot.updated_at, db)
        assert len(result.questions) == 2
        assert result.questions[0].tos_question_id == original_id
        assert result.questions[0].question_text == old.question_text
        assert result.questions[0].passage == old.passage
        with pytest.raises(HTTPException) as exc:
            append_tos_questions(exam.tos_exam_id, [new], snapshot.updated_at, db)
        assert exc.value.status_code == 409


def exhaust_free_fills(meter, exam_id=7):
    with meter.begin() as conn:
        conn.execute(guard.counters.insert().values(scope=f"tos_fill:{exam_id}", period="free_completed", used=3))


def test_short_exam_fill_free_even_when_staff_daily_credits_exhausted(meter, monkeypatch):
    import hashlib
    scope = "staff_day:" + hashlib.sha256(b"isolated").hexdigest()
    with meter.begin() as conn:
        conn.execute(guard.counters.insert().values(scope=scope, period=datetime.now(timezone.utc).strftime("%Y-%m-%d"), used=100))
    route, db, _, _, _ = route_setup(monkeypatch)
    result = asyncio.run(route.generate_missing_tos_questions(7, AITOSRepairRequest(), "isolated", {"role": "teacher"}, db))
    assert result.added_count == 1 and result.credits_charged == 0
    assert result.free_fill_limit == 3 and result.free_fills_used == 1
    assert used(meter) == 100 and guard.fill_missing_usage(7) == 1


def test_three_successful_free_fills_then_one_credit_with_idempotent_completion(meter):
    for index in range(3):
        hold = guard.reserve_fill_credit("isolated", f"free-{index}", 7, True)
        assert hold.free
        assert not guard.finalize_exam_credit(hold, 6, requested_count=10)
        assert not guard.finalize_exam_credit(hold, 6, requested_count=10)
        assert guard.fill_missing_usage(7) == index + 1
    hold = guard.reserve_fill_credit("isolated", "paid-fourth", 7, True)
    assert not hold.free and used(meter) == 1
    assert guard.finalize_exam_credit(hold, 6, requested_count=10)
    assert guard.fill_missing_usage(7) == 3 and used(meter) == 1
    assert guard.reconcile_expired_holds(now=datetime.now(timezone.utc) + timedelta(days=1)) == 0
    assert used(meter) == 1


@pytest.mark.parametrize("paid", [False, True])
@pytest.mark.parametrize("failure", [HTTPException(503, "Mock provider failure"), asyncio.CancelledError()])
def test_failed_and_cancelled_fill_free_without_consuming_slot(meter, monkeypatch, paid, failure):
    if paid:
        exhaust_free_fills(meter)
    route, db, generate, _, _ = route_setup(monkeypatch)
    generate.side_effect = failure
    with pytest.raises(type(failure)):
        asyncio.run(route.generate_missing_tos_questions(7, AITOSRepairRequest(), "isolated", {"role": "teacher"}, db))
    assert used(meter) == 0 and guard.fill_missing_usage(7) == (3 if paid else 0)
    next_hold = guard.reserve_fill_credit("isolated", "next-after-failure", 7, True)
    guard.finalize_exam_credit(next_hold, 0, requested_count=2)
    assert used(meter) == 0


@pytest.mark.parametrize("paid", [False, True])
def test_zero_addition_fill_free_and_slot_not_consumed(meter, monkeypatch, paid):
    if paid:
        exhaust_free_fills(meter)
    route, db, generate, _, _ = route_setup(monkeypatch)
    generate.return_value = []
    result = asyncio.run(route.generate_missing_tos_questions(7, AITOSRepairRequest(), "isolated", {"role": "teacher"}, db))
    assert result.added_count == result.credits_charged == 0
    assert used(meter) == 0 and guard.fill_missing_usage(7) == (3 if paid else 0)


@pytest.mark.parametrize("paid", [False, True])
def test_concurrent_click_gets_409_before_generation_no_double_charge(meter, monkeypatch, paid):
    if paid:
        exhaust_free_fills(meter)
    route, db, generate, _, _ = route_setup(monkeypatch)
    second_db = Mock()
    second_db.query.return_value.filter.return_value.first.side_effect = [SimpleNamespace(created_by_staff_id="isolated"), SimpleNamespace(subject_name="Science")]
    async def run():
        entered, release = asyncio.Event(), asyncio.Event()
        async def blocked(*args, **kwargs):
            entered.set()
            await release.wait()
            return [saved_question(3).model_dump(exclude={"tos_exam_id", "tos_question_id"})]
        generate.side_effect = blocked
        first = asyncio.create_task(route.generate_missing_tos_questions(7, AITOSRepairRequest(), "isolated", {"role": "teacher"}, db))
        await entered.wait()
        try:
            with pytest.raises(HTTPException) as exc:
                await route.generate_missing_tos_questions(7, AITOSRepairRequest(), "isolated", {"role": "teacher"}, second_db)
            assert exc.value.status_code == 409
        finally:
            release.set()
        result = await first
        assert result.credits_charged == int(paid)
    asyncio.run(run())
    assert generate.call_count == 1 and used(meter) == int(paid) and guard.fill_missing_usage(7) == (3 if paid else 1)


def test_revision_conflict_refunds_paid_fill_and_keeps_free_quota(meter, monkeypatch):
    exhaust_free_fills(meter)
    route, db, _, append, _ = route_setup(monkeypatch)
    append.side_effect = HTTPException(409, "Exam revision changed")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(route.generate_missing_tos_questions(7, AITOSRepairRequest(), "isolated", {"role": "teacher"}, db))
    assert exc.value.status_code == 409 and used(meter) == 0 and guard.fill_missing_usage(7) == 3


def test_crashed_free_fill_sweep_does_not_refund_other_staff_credits(meter):
    now = datetime.now(timezone.utc)
    paid = guard.reserve_exam_credit("isolated", "charged", now=now)
    guard.finalize_exam_credit(paid, 2)
    free = guard.reserve_fill_credit("isolated", "crash-free", 7, True, now=now)
    assert free.free and guard.reconcile_expired_holds(now=now + timedelta(seconds=900)) == 1
    assert used(meter) == 1 and guard.fill_missing_usage(7) == 0
    reclaimed = guard.reserve_fill_credit("isolated", "after-crash", 7, True, now=now + timedelta(seconds=900))
    assert reclaimed.free
    guard.finalize_exam_credit(reclaimed, 0)


def test_old_created_hold_with_recent_heartbeat_is_not_swept(meter):
    created = datetime.now(timezone.utc) - timedelta(seconds=3600)
    hold = guard.reserve_exam_credit("isolated", "old-but-active", now=created)
    for seconds in (800, 1600, 2400, 3200):
        assert guard.heartbeat_exam_credit(hold, now=created + timedelta(seconds=seconds))
    assert guard.reconcile_expired_holds(now=created + timedelta(seconds=3600)) == 0
    assert used(meter) == 1 and hold.created_at == created


def test_startup_rejects_unsafe_heartbeat_and_accepts_third_boundary(meter, monkeypatch, caplog):
    monkeypatch.setattr(guard.settings, "tos_credit_heartbeat_interval_seconds", 301)
    with caplog.at_level(logging.CRITICAL, logger="uvicorn.error"):
        with pytest.raises(RuntimeError, match="one third"):
            session.validate_heartbeat_settings()
    assert "TOS_HEARTBEAT_UNSAFE" in caplog.text
    monkeypatch.setattr(guard.settings, "tos_credit_heartbeat_interval_seconds", 300)
    assert session.validate_heartbeat_settings() == 300
    monkeypatch.setattr(guard.settings, "tos_credit_heartbeat_interval_seconds", None)
    assert session.validate_heartbeat_settings() == 60


def test_parallel_fill_admission_one_lease_and_one_credit_only(tmp_path, monkeypatch):
    # Separate connections exercise the durable mutex, not an in-process lock.
    engine = create_engine("sqlite:///" + str(tmp_path / "fill-admission.sqlite"))
    guard.metadata.create_all(engine)
    monkeypatch.setattr(guard.settings, "tos_fill_missing_free_limit", 0)
    try:
        def admit(index):
            try:
                return guard.reserve_fill_credit("isolated", f"parallel-{index}", 7, True, bind=engine)
            except HTTPException as exc:
                return exc.status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(admit, range(2)))
        assert results.count(409) == 1
        holds = [result for result in results if isinstance(result, guard.ExamCreditHold)]
        assert len(holds) == 1 and used(engine) == 1
        assert guard.finalize_exam_credit(holds[0], 2, requested_count=2, bind=engine)
        assert guard.finalize_exam_credit(holds[0], 2, requested_count=2, bind=engine)
        assert used(engine) == 1
    finally:
        engine.dispose()


def test_free_fill_limit_can_be_configured(meter, monkeypatch):
    monkeypatch.setattr(guard.settings, "tos_fill_missing_free_limit", 1)
    free = guard.reserve_fill_credit("isolated", "free-one", 7, True)
    assert free.free
    assert not guard.finalize_exam_credit(free, 1, requested_count=10)
    assert guard.fill_missing_usage(7) == 1 and used(meter) == 0
    paid = guard.reserve_fill_credit("isolated", "paid-two", 7, True)
    assert not paid.free
    assert guard.finalize_exam_credit(paid, 6, requested_count=10)
    assert guard.fill_missing_usage(7) == 1 and used(meter) == 1

"""Explicit opt-in only. Never imports the provider or runs in CI by default.

Supply provider keys via process environment, NOT an env file. Billing counters
use isolated in-memory SQLite; the script cannot write application databases.
Only summary counts are printed, never questions, passages, keys or prompts.
"""
import asyncio
from collections import Counter
import os
import math
from pathlib import Path
import sys

BLUEPRINTS = (
    ("Grammar", "English", "Identify sentence types and punctuation", {"MULTIPLE_CHOICE": 5}, {"REMEMBER": 3, "APPLY": 2}, "English"),
    ("Reading", "English", "Infer the main idea and supporting details of a narrative", {"MULTIPLE_CHOICE": 3, "ESSAY": 2}, {"UNDERSTAND": 3, "ANALYZE": 2}, "English"),
    ("Science", "Science", "Compare plant structures and functions", {"TRUE_FALSE": 3, "IDENTIFICATION": 2}, {"REMEMBER": 2, "UNDERSTAND": 3}, "English"),
    ("Mathematics", "Mathematics", "Solve linear equations", {"MULTIPLE_CHOICE": 3, "IDENTIFICATION": 2}, {"REMEMBER": 2, "APPLY": 3}, "English"),
    ("Filipino", "Filipino", "Context clues and author's purpose in a short narrative", {"MULTIPLE_CHOICE": 4, "ESSAY": 1}, {"UNDERSTAND": 2, "ANALYZE": 3}, "Filipino"),
    ("Essay-heavy", "Science", "Explain how plant structures support survival and evaluate adaptations in different environments", {"ESSAY": 12}, {"UNDERSTAND": 4, "ANALYZE": 4, "EVALUATE": 4}, "English"),
)


def smoke_options():
    try:
        delay = float(os.environ.get("SMOKE_DELAY_SECONDS", "60"))
    except ValueError:
        raise ValueError("SMOKE_DELAY_SECONDS must be a finite nonnegative number.") from None
    if not math.isfinite(delay) or delay < 0:
        raise ValueError("SMOKE_DELAY_SECONDS must be a finite nonnegative number.")
    only = os.environ.get("SMOKE_ONLY", "").strip().casefold()
    selected = tuple(row for row in BLUEPRINTS if not only or row[0].casefold() == only)
    if not selected:
        raise ValueError("SMOKE_ONLY must match one of the smoke blueprint names.")
    return delay, selected


def smoke_repeat():
    try:
        repeat = int(os.environ.get("SMOKE_REPEAT", "1"))
    except ValueError:
        raise ValueError("SMOKE_REPEAT must be a positive integer.") from None
    if repeat < 1:
        raise ValueError("SMOKE_REPEAT must be a positive integer.")
    return repeat


def aggregate_results(summaries):
    """Only known blueprint labels and count-level summary fields are retained."""
    rows = []
    for name, *_ in BLUEPRINTS:
        samples = [summary for exam, summary, _ in summaries if exam == name]
        if not samples:
            continue
        runs = len(samples)
        rows.append({"exam": name, "runs": runs,
            "mean_first_pass": sum(sum(s["first_pass_per_type"].values()) for s in samples) / runs,
            "mean_repairs": sum(s["repair_rounds_used"] for s in samples) / runs,
            "mean_provider_calls": sum(s["provider_attempts"] for s in samples) / runs,
            "total_400s": sum(s["smoke_http_400"] for s in samples),
            "total_429s": sum(s["smoke_http_429"] for s in samples),
            "at_target": sum(bool(s["completed"] and not any(s["final_shortfall_per_type"].values())
                and s["final_per_type"] == s["requested_per_type"]) for s in samples)})
    return rows


def print_aggregate(summaries):
    print("\nAggregate across smoke repetitions (provider calls = physical attempts)")
    print("Exam | Runs | Mean first-pass | Mean repairs | Mean provider calls | Total 400s | Total 429s | Exams at target")
    rows = aggregate_results(summaries)
    if not rows:
        print("(none)")
    for row in rows:
        print(f"{row['exam']} | {row['runs']} | {row['mean_first_pass']:.2f} | "
              f"{row['mean_repairs']:.2f} | {row['mean_provider_calls']:.2f} | "
              f"{row['total_400s']} | {row['total_429s']} | {row['at_target']}/{row['runs']}")
    print("Means include failed/short exams. HTTP totals count failed physical attempts, including recovered 400s.")


def print_results(summaries, failures, calls=()):
    print("Exam         Requested  First-pass  Repairs  Final  Missing  Credits  Status")
    for name, summary, status in summaries:
        print(f"{name:12} {sum(summary['requested_per_type'].values()):9} "
              f"{sum(summary['first_pass_per_type'].values()):11} {summary['repair_rounds_used']:7} "
              f"{sum(summary['final_per_type'].values()):6} {sum(summary['final_shortfall_per_type'].values()):8} "
              f"{summary['credits_charged']:8}  {status}")
        print("  Per type: " + ", ".join(
            f"{kind} {summary['first_pass_per_type'][kind]}/{requested} -> {summary['final_per_type'][kind]}"
            for kind, requested in summary["requested_per_type"].items()))
        counts = summary["discard_counts"]
        print(f"  Discards: external_material={counts['external_material']}, duplicate_options={counts['duplicate_options']}, "
              f"trimmed_over_target={counts['trimmed_over_target']}, other_validation={counts['other_validation']}; "
              f"count_mismatch(final_missing)={sum(summary['final_shortfall_per_type'].values())}")
        print("  Other validation reasons: " + (", ".join(
            f"{code}={count}" for code, count in sorted(summary["other_validation_reasons"].items())) or "(none)"))
        print("  MC option discards (item is one-based; empty indexes are zero-based):")
        option_discards = summary.get("mc_option_discards", [])
        if not option_discards:
            print("    (none)")
        for detail in option_discards:
            print(f"    round={detail['repair_round']} batch={detail['batch_offset']} item={detail['item']} "
                  f"reason={detail['reason']} options={detail['option_count']} "
                  f"empty={detail['empty_option_count']} empty_indexes={detail['empty_option_indexes']}")
        print(f"  Truncation retries: {summary['truncation_retries']}")
        print(f"  Schema retries: {summary['schema_retries']}")
        print(f"  Recovery: recovered_from_400={summary.get('recovered_from_400', 0)}, "
              f"context_fields_filled={summary.get('context_fields_filled', 0)}")
        duplicates = summary["duplicate_stem_counts"]
        print(f"  Duplicate stems: existing_kept={duplicates['existing_kept']}, "
              f"same_batch={duplicates['same_batch']}, previous_candidate={duplicates['previous_candidate']}")
        usage = summary.get("token_usage", {})
        known, attempts = usage.get("actual_total_known_calls", 0), usage.get("calls", 0)
        actual = str(usage.get("actual_total_tokens", 0)) if known or not attempts else "unknown"
        print(f"  Tokens: requested_budget={usage.get('requested_budget_total', 0)}, "
              f"actual_total={actual} (usage known {known}/{attempts} calls), "
              f"peak_requested_budget_60s={usage.get('peak_requested_budget_60s', 0)} "
              f"(budget known {usage.get('budget_known_calls', 0)}/{attempts} calls)")
    print("Count mismatch is final missing items, NOT discarded candidates; it includes aborted exams.")
    print("Trimmed over target means valid reserves for fulfilled blueprint types/cells; other_validation excludes these. Counts cover all content rounds.")
    print("\nFailed provider calls (one row per physical attempt, including recovered HTTP 400)")
    print("Exam | Call | Provider | Phase | Type / Batch offset | HTTP | Error code / type | Message | Retry-After present / value | Rate-limit headers | Budget requested | Prompt tokens | Completion tokens | Total tokens")
    if not failures:
        print("(none)")
    for name, row in failures:
        limits = "; ".join(f"{key}={value}" for key, value in sorted(row["rate_limits"].items())) or "-"
        print(f"{name} | {row['call']} | {row['provider']} | {row['phase']} | "
              f"{row['question_type']} / {row['batch_offset']} | {row['http_status'] or '-'} | "
              f"{row['error_code']} / {row['error_type']} | {row['message']} | "
              f"{row['retry_after_present']} / {row['retry_after']} | {limits} | " +
              " | ".join(str(row.get(key)) if row.get(key) is not None else "-"
                         for key in ("budget_requested", "prompt_tokens", "completion_tokens", "total_tokens")))
    print("\n400 detail (structure only; estimated tokens = ceil(characters / 4), NOT measured usage)")
    print("Exam | Call | Phase | Budget requested | Characters | Est tokens | JSON parses / state | Top-level keys (counts) | Items / inspected | Finish reason | Root problems (counts) | Per-item problems (counts) | Per-item MC options (count / empty count / empty indexes, zero-based)")
    detail_rows = [(name, row) for name, row in failures if row["http_status"] == 400]
    if not detail_rows:
        print("(none)")
    for name, row in detail_rows:
        detail = row.get("schema_detail", {})
        counts_text = lambda counts: "; ".join(f"{key}={value}" for key, value in sorted(counts.items())) or "-"
        items = "; ".join(f"{item['item']}[{counts_text(item['problems'])}]" for item in detail.get("item_problems", [])) or "-"
        option_counts = "; ".join(
            f"{item['item']}[{item['option_count']} / {item['empty_option_count']} / {item['empty_option_indexes']}]"
            for item in detail.get("item_problems", []) if "option_count" in item) or "-"
        print(f"{name} | {row['call']} | {row['phase']} | {row.get('budget_requested')} | "
              f"{detail.get('characters', '-')} | {detail.get('estimated_tokens', '-')} | "
              f"{detail.get('json_parses', '-')} / {detail.get('parse_state', 'unavailable')} | "
              f"{counts_text(detail.get('top_level_key_counts', {}))} | "
              f"{detail.get('item_count', '-')} / {detail.get('inspected_items', '-')} | "
              f"{detail.get('finish_reason', '-')} | {counts_text(detail.get('root_problems', {}))} | {items} | {option_counts}")
    print("\nAll provider calls (one row per physical attempt)")
    print("Exam | Call | Provider | Phase | Type / Batch offset | Budget requested | Completion tokens | Prompt tokens | Total tokens")
    if not calls:
        print("(none)")
    for name, row in calls:
        print(f"{name} | {row['call']} | {row['provider']} | {row['phase']} | "
              f"{row['question_type']} / {row['batch_offset']} | " +
              " | ".join(str(row.get(key)) if row.get(key) is not None else "-"
                         for key in ("budget_requested", "completion_tokens", "prompt_tokens", "total_tokens")))
    print("'-' means usage/budget unavailable, NOT zero. Actual totals include only calls with reported total usage.")
    print("Gemini completion tokens include candidate + reported thinking tokens; provider total is used unchanged.")
    print("60s peak sums completion caps at attempt start over (t-60,t]; retries included. NOT full/account TPM: input tokens and other exams/traffic excluded.")


def main() -> int:
    if os.environ.get("CI"):
        print("Live TOS smoke test is forbidden in CI.")
        return 2
    if os.environ.get("TOS_LIVE_SMOKE") != "1":
        print("Live TOS smoke test disabled. Explicit TOS_LIVE_SMOKE=1 is required.")
        return 2
    # These assignments occur only after explicit opt-in. Do not load any .env.
    os.environ["ENV_FILE"] = str(Path(__file__).parent / "__no_environment_files__" / "settings")
    os.environ["DATABASE_URL"] = "sqlite:///:memory:"
    os.environ.setdefault("SECRET_KEY", "isolated-smoke-only-not-an-application-credential")
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    try:
        return asyncio.run(run_smoke())
    except Exception:
        # Configuration validation errors can contain environment values.
        print("Live smoke test stopped due to a configuration or runtime error; details withheld.")
        return 1


async def run_smoke() -> int:
    delay, selected = smoke_options()
    repeat = smoke_repeat()
    print(f"Smoke delay between exams: {delay:g} seconds; selected exams: {len(selected)}")
    print("Selected exam names: " + ", ".join(row[0] for row in selected))
    print(f"Smoke repetitions: {repeat}; total exam generations: {repeat * len(selected)}")
    from fastapi import HTTPException
    from sqlalchemy import create_engine
    from sqlalchemy.pool import StaticPool
    from app.services.ai import UsageGuard as guard
    from app.services.ai.tos_generation import generate_tos_row_questions
    from app.services.ai.tos_generation_session import exam_generation

    if not guard.ai_configured():
        print("No provider configured in process environment; no calls made.")
        return 2
    meter = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    guard.metadata.create_all(meter)
    guard.engine = meter
    token = guard.actor.set("isolated-live-smoke")
    all_summaries = []
    try:
        for repetition in range(repeat):
            print(f"\nSmoke repetition {repetition + 1}/{repeat}")
            summaries, failures, calls = [], [], []
            for index, (name, subject, label, types, blooms, language) in enumerate(selected):
                if repetition or index:
                    await asyncio.sleep(delay)
                status = "OK"
                async with exam_generation("isolated-live-smoke", Counter(types)) as operation:
                    try:
                        questions = await generate_tos_row_questions(label, None, subject, types, blooms, language=language, grade_level=7)
                        operation.final = Counter(q["question_type"] for q in questions)
                        operation.completed = True
                    except HTTPException as exc:
                        # Never print the error body, provider exception, or prompt.
                        status = f"HTTP {exc.status_code}"
                summary = operation.summary()
                summary["smoke_http_400"] = sum(row["http_status"] == 400 for row in operation.provider_failures)
                summary["smoke_http_429"] = sum(row["http_status"] == 429 for row in operation.provider_failures)
                summaries.append((name, summary, status))
                failures.extend((name, failure) for failure in operation.provider_failures)
                calls.extend((name, call) for call in operation.provider_calls)
            print_results(summaries, failures, calls)
            all_summaries.extend(summaries)
        print_aggregate(all_summaries)
        return int(any(not summary["completed"] or sum(summary["final_shortfall_per_type"].values())
                       for _, summary, _ in all_summaries))
    finally:
        guard.actor.reset(token)
        meter.dispose()


if __name__ == "__main__":
    raise SystemExit(main())

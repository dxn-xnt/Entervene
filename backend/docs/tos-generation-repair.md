# TOS generation and repair

The API uses `app/services/ai/tos_generation.py`. The older row helper remains
backward compatible for existing callers; it is not the API generation path.

Each competency row is split by question type into batches of at most six.
The initial batch requests `ceil(target * 1.3)` candidates. Only validated,
distinct questions that satisfy unfilled type/Bloom/difficulty cells are kept.
There are at most three further repair rounds, requesting only missing cells
and supplying bounded previews of existing stems. Full stems are deduplicated
locally across the exam. Supplied Bloom totals are apportioned to the type total
when they differ; when they agree, both margins are preserved exactly.

Reading-comprehension competencies first obtain one original 150-250 word
passage. Invalid passage content has its own initial attempt plus at most three
repairs. A valid passage is reused across all types and question repairs. Single
question regeneration supplies the existing passage instead of generating a
different source. Grammar and isolated vocabulary remain standalone.

Every call uses the provider's JSON-schema output mode and local strict item
validation. No options are invented or padded. Normalized duplicates and
missing external material are rejected. The API exposes only final missing-cell
warnings, not intermediate discards. The existing short-exam confirmation
remains the fallback after repair exhaustion. Provider retries are independent
of content repair and never increment its three-round budget.

The model-facing question schema omits `question_type` and `passage_id`:
both are known batch context. Local normalization fills absent fields from the
batch (the passage id or null), before running the unchanged strict item
validators. If either supplied context field conflicts, reject the item as
`context_field_conflict`; never relabel it. All other item fields remain required.
Question arrays accept 1-100 candidates instead of an exact provider-enforced
count. All returned candidates are validated; valid extras use existing
`trimmed_over_target`/cell selection, while shortfalls use content repair.

## Credits and limits

Teacher credits are now **one per exam-generation request**, not per provider
call. This covers every competency row, its passage, overgeneration, content
repair and transient retries within that request. Single-question regeneration
is a separate generation request and costs one credit if it returns a question.

One credit is held on the first actual provider attempt, atomically enforcing
the staff daily limit across workers. On completion:

| Final result | Teacher credit charge |
| --- | --- |
| Complete exam on first pass | 1 |
| Complete exam after repairs | 1 |
| Short exam at/above the configured coverage threshold | 1 |
| Short exam below the configured coverage threshold | 0 (hold released) |
| Empty exam | 0 (hold released) |
| Failed/cancelled request with no final response | 0 (hold released) |

`TOS_SHORT_EXAM_CHARGE_THRESHOLD` defaults to `0.6` (60%), configurable from 0
to 1. A nonempty exam is charged only when produced >= requested * threshold;
exactly 60% is charged at the default. Empty exams are always free. The final
question count determines coverage; this is not a per-question tariff.
The daily usage snapshot includes in-flight holds.
Receipt transitions are durable and idempotent, using the existing counter
table. Refunds use the original admission day even across UTC midnight.
Separate HTTP requests get separate generation IDs/charges; lost HTTP response
replay/idempotency is not implemented.

### Hold reconciliation

`TOS_CREDIT_HOLD_TTL_SECONDS` defaults to `900` (15 minutes), configurable from
30 to 86400. Each hold persists its immutable UTC creation timestamp, TTL at
admission, and renewable expiry in auxiliary rows of the existing counter
table; no migration is required. Timestamps are stored in the string period,
not the existing 32-bit integer counter. Receipt states are held/charged/
released, plus completed-free for successful free fills. Historical holds without metadata receive one full TTL grace period
on their first sweep, not an immediate refund.

The backend has no existing scheduler. Sweep at app startup and opportunistically
at every new generation request. An independent task heartbeats active holds
every min(60 seconds, TTL/3), including provider waits, and each subsequent
logical call renews the lease. An idle deployment reconciles on its next
startup/request, not exactly at the expiry instant. A crash or billing database
outage can retain a hold until a successful sweep.

Sweeps re-read expiry after acquiring the same fill/staff locks used by heartbeat and
finalization; CAS transition and original-day refund share a transaction.
Double sweeps cannot refund twice, active leases cannot be swept, and charged
exams are never refunded. Released leases cannot be resurrected. If an active
generation loses its lease/heartbeat, it stops rather than deliver an unmetered
exam. Configure TTL generously enough for database outages and event-loop
stalls; the default comfortably exceeds a single provider attempt's timeout.

`TOS_CREDIT_HEARTBEAT_INTERVAL_SECONDS` can override the automatic interval.
Startup fails loudly with `TOS_HEARTBEAT_UNSAFE` if this exceeds TTL/3; no
credential values are included in the error. Each hold additionally clamps its
heartbeat to its own admission TTL/3. Sweeps use the renewable expiry, NEVER
the immutable creation time, so a long-running healthy generation stays active.

### Generate missing items only

`POST /api/v1/ai/tos-exams/{id}/generate-missing` repairs an owned, saved exam.
The short-exam panel first saves the current editor snapshot as DRAFT, with
exact row type/Bloom targets in `difficulty_ratio.blueprint_rows`. Legacy exams
without saved targets must be re-saved from the editor. Authorization is checked
before generation; blueprint limits still apply.

The repair reads all saved questions/passages, computes missing joint cells,
requests exactly the deficits (no initial 30% overgeneration), and uses the same
three-round content repair and transport retry policies. Existing questions are
never relabeled/replaced by repair; their full stems are deduplicated locally
and existing passages reused. Only new questions are appended; a revision check
rejects an exam edited concurrently with HTTP 409. Only final deficit warnings
replace the prior warning list. Successful additions are saved as draft.

**Fill billing:** when saved item count is below the saved blueprint target,
up to `TOS_FILL_MISSING_FREE_LIMIT` successful fills per exam are free (default
3; configurable 0-100), regardless of whether initial generation was charged.
Free fills do not require or reserve a teacher daily credit. The count is durable
across saves, restarts, days and different authorized actors; saving cannot reset
it. Only successful fills that add questions consume a slot. Zero additions,
failed/cancelled requests, and 409 conflicts consume no slot and no credit.

Beyond the limit, or when total item count is already at target but a blueprint
cell is missing, the previous one-credit policy applies: charge at most one
credit only for successful additions and final coverage at/above the configured
threshold. Otherwise release the credit. Provider monetary/rate guards still
reserve every physical attempt, even free fills.

A durable expiring per-exam fill lease rejects concurrent clicks with 409 BEFORE
provider work. The same heartbeat extends both leases. Free-slot completion,
fill-lease release, and any credit finalization occur in one counter transaction;
conflicts/failures cannot double-charge or consume free slots. Expired crash
leases are released by reconciliation or reclaimed at the next fill. Saved-exam
revision checking remains a second safeguard against edits during generation.
Receipts additionally use state 4 for a successfully completed free fill. No
schema migration is needed. The UI discloses the free limit and paid fallback.

Provider-budget and school burst/day reservations still apply **per physical
attempt**, including transient retries. Those monetary reservations are not
teacher credits and are not refunded, because timed-out attempts can still be
billable. Upstream rejected 429s typically consume no model tokens, but the
existing conservative budget policy is retained. A standalone 20-item MC row
initially requests 26 candidates in five logical calls; reading rows add a
passage call. Repair increases logical calls, and each can have up to three
physical attempts. School limits can therefore still stop a generation.

## Transient retries

TOS provider calls retry upstream 429, 5xx and timeouts (including HTTP 408) at most twice (three
attempts total). Backoff is 1 then 2 seconds, plus uniform jitter of 0-0.25s.
Numeric and HTTP-date Retry-After headers are respected when longer. A provider
wait above 60 seconds is surfaced instead of holding the web request or
retrying early. Exhausted 429s return 429 with Retry-After; exhausted 5xx return
503 and exhausted timeouts return 504. Other 4xx, malformed content and local
quota/circuit decisions are not transport-retried. Provider-invalid content
still belongs to the separate content repair loop. Question batches additionally
have one budget fallback for truncation; see Completion budgets below. This
does not change the transport retry policy or consume a content repair round.

### Groq schema retries

For TOS structured-output calls only, upstream HTTP 400 with error code
`json_validate_failed` first passes recovered `failed_generation` through the
same normalization and per-item validation as HTTP 200 output. Keep valid
items immediately, even if the response has a short/extra item count or some
invalid candidates. Invalid context, options, external references and
Bloom/difficulty still fail exactly the existing checks.

Only unparseable recovery or zero locally valid items triggers ONE retry,
with byte-identical prompt, schema and completion budget. It is labelled `(schema retry 1)`
and counted as `schema_retries`, with count-only `TOS_SCHEMA_RETRY` INFO events.
They do not consume a content-repair round, add teacher credits, or change the
existing transient retry allowance/backoff. Schema retries neither spend nor
reset that two-transient-retry allowance within a logical generation call.
The question batch's one-schema-retry cap is shared across its existing
truncation-budget fallback. Passage calls also have one schema retry per
logical passage attempt; invalid passage content still follows its existing
content-repair policy. Non-TOS callers and other HTTP 400 error codes are unchanged.

After exhaustion, return the LAST response's recovered `failed_generation` to
the existing validators. Only that final recovered response
contributes content discards. Without recovered content, stop with HTTP 502 and
release the exam credit as for other failed requests. Every wire attempt still
passes the existing provider/rate/budget guard; more attempts can hit provider
account or local limits. No additional schema-specific backoff is introduced.
Unparseable recovered 400 output does not additionally trigger an old-budget
truncation fallback: it has already used its single schema retry. A valid
recovery that later cannot fill a blueprint cell or duplicates a kept stem uses
ordinary content repair, not another same-batch schema retry.

TOS retries stay on the selected primary provider. Non-TOS requests retain
HEAD's zero-retry, no-provider-fallback behavior. Each attempt must pass the
durable provider budget/rate guard; retries cannot bypass it. A fully validated
exam cannot be guaranteed during outages, quota exhaustion or repeated invalid
model output.

## Telemetry

The `ai.tos.telemetry` logger emits one INFO `TOS_GENERATION` JSON event per
generation, including failures. It contains a random generation ID, requested
and first-pass retained counts per type, fixed discard-reason codes/counts,
maximum question repair rounds used across rows, sum of row and passage repair
rounds, final counts/shortfalls, physical attempts, transient retries and final
credit charge/retained-hold state. Max question repair rounds is 0-3; the sum can be larger for
multi-row exams. Invalid JSON/envelope/passage counts refer to responses; other
discard counts refer to items. `trimmed_over_target` counts valid reserves
dropped after all requested cells of that type are fulfilled. `surplus_cell`
means a candidate cannot fill its requested blueprint cell (including
unrequested cells or a full cell while another remains missing).
`discard_counts` separates external material, duplicate options, valid trimming,
and `other_validation`; `other_validation_reasons` contains allowlisted reason
codes/counts only. Unknown codes become `unknown_validation`, never echoed.
`truncation_retries` counts logical question-batch budget fallbacks separately
from transient retries and repair rounds.
`schema_retries` is separate too. `failed_schema_generations` contains count-only
400 structure details per wire attempt, never the recovered content.
`recovered_from_400` counts recovered question candidates actually accepted
into blueprint cells (including a valid True/False reserve replacement).
`context_fields_filled` counts locally valid question candidates with one or
both context fields injected, including subsequently trimmed/duplicate
candidates. These are item counts, not field counts; neither includes passage
objects or zero-valid recovery attempts superseded by a schema retry.
They are acceptance/normalization events, not a second final question count.
Duplicate-stem counts distinguish `existing_kept` (including supplied protected
exam stems) from `same_batch` (another validated candidate in that batch).
Existing/protected stems from before the batch take precedence if both apply.
The residual `previous_candidate` category preserves existing deduplication
against previously trimmed/rejected candidates; it is not falsely called a
kept question. Classification changes no acceptance decisions.

No staff/student identity, subject/competency labels, stems, passages, options,
prompts, response bodies or exception text is logged. Provider retry events
contain only attempt/status/timeout/backoff values. Enable INFO for this logger
in the deployment's logging configuration to collect successful-generation
events; the application does not install its own logging handlers. Startup checks
the logger's INFO enablement, filters, and effective non-null handlers' levels and warns
`TOS_TELEMETRY_DISABLED` through `uvicorn.error` when INFO cannot be emitted.
Both logger and handler must permit INFO; setting only Uvicorn's access log
level is insufficient. For example, merge this into the deployment logging
configuration (do not disable existing loggers):

```python
"handlers": {"tos_console": {"class": "logging.StreamHandler", "level": "INFO"}},
"loggers": {"ai.tos.telemetry": {"level": "INFO", "handlers": ["tos_console"], "propagate": False}}
```

Missing-only telemetry includes retained saved questions in first-pass/final
counts. Teacher credits are reported from the actual finalized receipt result,
including threshold refunds, rather than inferred from a nonempty exam.

## Optional live smoke test (not run)

`scripts/tos_generation_smoke.py` is disabled unless `TOS_LIVE_SMOKE=1` and is
always blocked when CI is set. It exercises six blueprints: five five-item exams
(grammar, reading, science, mathematics and Filipino), plus an essay-heavy Science
exam requesting 12 essays. It prints first-pass/target counts,
repair rounds, final results, missing counts and credits, with per-type details.
`SMOKE_DELAY_SECONDS` defaults to 60, sleeping only BETWEEN exams (not before
the first or after the last). It does not alter pacing within an exam or the
provider retry policy. `SMOKE_ONLY` optionally selects one blueprint name,
case-insensitively: Grammar, Reading, Science, Mathematics, Filipino, Essay-heavy.
`SMOKE_REPEAT` defaults to 1 and accepts a positive integer. Run the selected
blueprints that many times, in the same order. The existing delay also applies
between the last exam of one repetition and the first exam of the next; there
is no extra delay before the first generation or after the final generation.
Each repetition prints its normal diagnostics. A final aggregate table shows
per exam: runs, mean first-pass retained count, mean repair rounds, mean physical
provider calls, total HTTP 400/429 attempts, and exams at target / runs. Means
include failed/short generations, not just successes. At target requires a
completed generation with exact per-type targets and zero final missing cells.
HTTP totals count wire failures (including recovered 400s), not local quota
errors. Each repeated exam is an independent generation; billing and retries
are unchanged, and the script's isolated counters persist across repetitions.
Three full repetitions mean 18 exam generations and 17 inter-exam waits.

The delay, selected exam count AND names, repetitions and total generations are printed at startup. With
`SMOKE_ONLY` unset/blank all six run; with a leftover single-name filter only
that named blueprint runs. Invalid delay/filter
values and invalid repeat counts stop before provider imports/traffic and are not echoed.
Provider keys must already be supplied through process environment; no env file
is loaded. Billing counters use isolated in-memory SQLite, never application
databases. Calls still use real tokens/money and provider account limits.

In a fresh PowerShell session, from the repository root, only after explicit
live-test approval (CI must be unset). The masked prompt supplies the provider
credential to this process environment, not a file or command-history literal.
This example runs all six exams three times:

```powershell
Remove-Item Env:SMOKE_ONLY, Env:TOS_COMPLETION_ESSAY_PER_ITEM -ErrorAction SilentlyContinue
try {
    Remove-Item Env:GEMINI_API_KEY -ErrorAction SilentlyContinue
    $env:GROQ_API_KEY = [System.Net.NetworkCredential]::new('', (Read-Host 'Rotated Groq API key' -AsSecureString)).Password
    $env:GROQ_MODEL = 'openai/gpt-oss-20b'
    $env:AI_ENABLED = 'true'
    $env:TOS_LIVE_SMOKE = '1'
    $env:SMOKE_DELAY_SECONDS = '60'
    $env:SMOKE_REPEAT = '3'
    & .\backend\venv\Scripts\python.exe .\backend\scripts\tos_generation_smoke.py
}
finally {
    Remove-Item Env:SMOKE_ONLY, Env:TOS_COMPLETION_ESSAY_PER_ITEM,
        Env:GROQ_API_KEY, Env:GEMINI_API_KEY, Env:GROQ_MODEL,
        Env:AI_ENABLED, Env:TOS_LIVE_SMOKE, Env:SMOKE_DELAY_SECONDS,
        Env:SMOKE_REPEAT -ErrorAction SilentlyContinue
}
```

For Gemini instead, replace `GROQ_API_KEY` with `GEMINI_API_KEY` in the command
and cleanup, and leave `GROQ_API_KEY` unset. Neither command prints the key.

### Smoke diagnostics

Each exam prints aggregated `external_material`, `duplicate_options`,
`trimmed_over_target`, and `other_validation` counts from all content rounds.
Valid reserves dropped after fulfilling the type's requested cells do not count
as other validation loss. Sanitized other-validation reason counts and the
separate truncation retry count are printed alongside each exam.
`count_mismatch(final_missing)` is the final deficit, NOT an item-discard reason;
it can also be caused by an aborted provider request. These aggregates alone
do not isolate first-pass discards from repair-round discards.

A second table prints one row per failed physical provider attempt, attributed
to the static smoke exam name, passage / first-pass generation / repair round,
question type and batch offset, including transient retries and recovered Groq
400 responses. It includes upstream HTTP status (or '-' if unavailable), known
provider error code/type, a sanitized message capped at 200 characters,
Retry-After presence/value and recognized rate-limit count/reset headers. Local
quota failures are not wire attempts, so can produce an HTTP error in the main
table without a failed-provider row. Incomplete/invalid HTTP 200 responses are
also captured without retaining their content.

The sanitizer reconstructs fixed diagnostic messages; it NEVER echoes raw
provider prose, failed_generation, response bodies, request headers, exception
text, schema values or prompts. Unknown codes/types and nonnumeric/nonduration/
nondate header values are redacted. Diagnostic records stay in process memory;
normal generation telemetry adds failed-call counts, count-level token usage,
and the sanitized 400 structure details, not the raw errors
or smoke exam labels. No retry, recovery, billing, prompt, overgeneration, or
validator policy is changed by instrumentation. The delay/filter/repeat affect ONLY
the opt-in script. Provider logging may still print content-free status events.

### Recovered HTTP 400 structure diagnostics

The `400 detail` table has one row per failed HTTP 400 attempt (including schema
retries). For Groq `json_validate_failed` with `failed_generation`, report its
character length and rough token estimate `ceil(characters/4)`, JSON parse
success, `looks_truncated` vs `malformed`, allowlisted top-level key counts,
item count, inspected-item count, finish reason if supplied, requested cap,
root problem counts and per-item problem-code counts. The estimate is NOT a
tokenizer measurement and is distinct from provider-reported usage.

Diagnostics inspect the SAME requested JSON schema without changing validation.
Codes include `missing_field:<field>`, `wrong_type:<field>`,
`extra_property:<field>`, `empty_value:<field>`, `invalid_value:<field>`,
`option_count_wrong`, and root-level `count_wrong:questions`. Known field names
are a fixed allowlist; unknown property/key names become `[redacted]` with
counts. Unknown finish reasons are redacted. No schema enum values, parser
exception text, prompts, passage/question/option text or recovered raw JSON is
stored in diagnostic records or printed. Some local semantic checks are not
JSON-schema constraints, so zero structural problems is not proof of validity.

Inspection is limited to 262144 recovered characters and 100 items (100 options
per item); total/inspected/uninspected counts make coverage explicit. EOF
classification is heuristic. Non-string or oversized recovered content reports
unavailable/uninspected fields rather than guessing. Normal telemetry includes
the same sanitized detail dictionaries; the smoke table additionally attributes
them to the static exam names. The opt-in live script is not run by tests or CI.

### Token usage diagnostics

Every physical provider attempt records its requested completion cap and a
monotonic start time, including transient retries and passage calls. Successful,
failed, truncated, and recovered-400 responses retain only integer token counts
when supplied: Groq `usage.prompt_tokens`, `completion_tokens`, `total_tokens`;
Gemini `usageMetadata.promptTokenCount`, `candidatesTokenCount` plus reported
`thoughtsTokenCount` for completion, and `totalTokenCount`. Provider totals are
used unchanged, never inferred from missing fields. No usage prose, detail
objects, prompts or response text is retained. Absent/malformed counts print
`-`, not zero; a reported zero remains zero.

The failed-call table includes budget/prompt/completion/total columns. An
all-call table includes the same counts for successful and failed attempts,
attributed to exam, phase, type and batch offset. Each exam additionally prints
the sum of requested completion caps, sum of available provider total tokens,
usage/budget coverage as known calls / attempts, and peak sum of completion caps
at attempt starts within a rolling `(t-60, t]` window. Partial actual totals are
not complete consumption figures; timeouts/429s often provide no usage. Normal
telemetry emits these aggregates only, not call timestamps or content.

The peak is a completion-budget pressure proxy, NOT provider-account TPM:
input tokens, other exams/account traffic, and the provider's own admission
algorithm are excluded. Budgets include failed/rejected/retried attempts even
when actual usage is unavailable or zero. No billing, pacing within an exam,
token limits or retry decisions are changed by these measurements.

### Completion budgets

First-pass AND repair question calls use
`min(4000, TOS_COMPLETION_BASE_TOKENS + batch_count * per_item_reserve)`.
The hard ceiling stays 4000. All overrides are process/settings values; no env
files are modified by this work. Defaults:

| Setting | Default |
| --- | ---: |
| `TOS_COMPLETION_BASE_TOKENS` | 300 |
| `TOS_COMPLETION_MC_PER_ITEM` | 250 |
| `TOS_COMPLETION_TF_PER_ITEM` | 150 |
| `TOS_COMPLETION_IDENTIFICATION_PER_ITEM` | 130 |
| `TOS_COMPLETION_ESSAY_PER_ITEM` | 250 |
| `TOS_COMPLETION_MATCHING_PER_ITEM` | 200 |

Base accepts 0-4000; reserves accept 1-4000. Passage calls remain 700 tokens.
The user-run Essay-heavy smoke retained 12/12 on the first pass, with completion
counts 710/612/370 against caps 3600/3600/2500. New default caps for those same
6/6/4 batches are 1800/1800/1300: 4900 total rather than 9700, excluding input,
repairs and retries. This is evidence from one exam, not a measured guarantee
across subjects, languages or rubric lengths.

If Groq reports `length`, Gemini reports `MAX_TOKENS`, or JSON has conservative
EOF-cutoff signatures (end-of-input, unterminated string, incomplete Unicode
escape/literal/number), retry that QUESTION batch once with the old fixed formula
`min(4000, 300 + batch_count * 550)`. The same prompt/schema/type/count/Bloom
cells are reused. Arbitrary malformed JSON, wrong envelopes, other finish
reasons, HTTP errors and passage calls do not trigger this budget fallback.
EOF detection is heuristic when the provider reports a normal finish reason.

The first recoverable truncation is recorded in diagnostics but not counted as
an invalid-content discard or provider-stop circuit failure. The fallback is
labelled `(truncation retry)` in its call phase, emits a count-only
`TOS_TRUNCATION_RETRY` event, and increments the separate retry count. A second
finish-reason/wire truncation stops with HTTP 502; raw question JSON still cut
off after the fallback is counted once as invalid JSON and uses the existing
content-repair path. The fallback itself consumes no repair round. Existing
429/5xx/timeout retries apply unchanged to each logical call, including the
fallback. Every physical attempt remains provider-budgeted, with no extra exam
credit; a successfully recovered exam is still charged once.

## User-reported full-run smoke findings

After removing batch-owned `question_type` and `passage_id` from the
model-facing schema (and removing exact item-count enforcement), the latest
user-run six-exam Groq sample reached target for all six exams. HTTP 400
`json_validate_failed` attempts dropped from 16 in the prior full-run sample
to 1; the latest run had zero HTTP 429 attempts. This is an observed before/after
comparison, not a controlled causal attribution or a reliability guarantee.

Grammar retained 3/5 on its first pass, with `duplicate_options=4`, and reached
5/5 after repair. The remaining 400 had empty options in all six returned
items. Every exam reported `recovered_from_400=0`: no usable recovered output
was accepted, so the successful HTTP-400 recovery path remains unverified live.
Mocked recovery tests are not live-provider evidence.

Per-type completion reserves are retained at MC=250, TF=150,
IDENTIFICATION=130, ESSAY=250 and MATCHING=200, with base 300, ceiling 4000
and passage cap 700. The user's essay A/B at caps 3600 versus 1800 reproduced
the same schema failures; all 16 earlier failed generations parsed as JSON,
with none truncated. This supports structural field/count problems rather than
budgets as the cause of those 400s; budgets were not changed to address them.

Actual physical calls per exam were not included in the supplied latest-run
summary and are not inferred from repair rounds. Use `provider_attempts` (all
wire attempts, including passage/schema/transient/truncation retries) and the
new aggregate mean-provider-calls column to record them in subsequent runs.
For reference ONLY, planned first-pass logical calls at the unchanged 30%
over-generation and six-item batch cap are:

| Exam | Planned first-pass calls (not measured physical calls) |
| --- | ---: |
| Grammar | 2 |
| Reading | 3 (including one passage) |
| Science | 2 |
| Mathematics | 2 |
| Filipino | 3 (including one passage) |
| Essay-heavy | 3 |

Content repairs and provider retries add calls beyond these planned counts.

## Known gaps / deferred

- Deferred follow-up: once the Gemini model/alias Config change is committed,
  switch Provider from the literal `gemini-2.5-flash-lite` back to
  `settings.gemini_model` in a separate commit.

- PostgreSQL concurrency tests have not yet been run.
- `create-classwork-quiz.test.tsx` is flaky under parallel workers (not our TOS work).
- Duplicate options on multiple choice are the main remaining first-pass loss
  identified in the latest sample (Grammar 3/5, `duplicate_options=4`).
- Usable `recovered_from_400` recovery is untested live; the latest run accepted
  zero recovered items. The malformed/empty-option path was observed instead.
- Only one full-run sample of the latest schema/recovery behavior is available;
  six of six at target does not establish sustained reliability or failure rates.
- Latest-run measured physical calls per exam were not supplied; repeated-run
  summaries will report them. Live behavior across broader workloads is unmeasured.
- PR creation/push and upstream integration remain deferred; local commits do
  not establish rollout readiness.

## Storage

No migration is required. A versioned `[TOS-PASSAGE:v1]` JSON envelope in the
existing question explanation Text column holds the original explanation and
passage metadata. Save/update paths encode it; API reads decode it back into
`explanation`, `passage_id` and `passage`. Legacy plain explanations are returned
unchanged. Editor and exporters deduplicate by passage id. External direct SQL
consumers of this column will see the envelope and must use the API/decoder.

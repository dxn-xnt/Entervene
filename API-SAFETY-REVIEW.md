# API safety and capacity review — 13 September 2026

This is a tested hardening change for the current prototype, with remaining deployment and adviser decisions below. It is not a guarantee of zero bugs or proof of 1,000 concurrent-user capacity. No paid AI requests were made during verification.

## Provider inventory and changes

| Area | Before | Current protection |
| --- | --- | --- |
| Lesson-plan suggestions, quiz generation, TOS rows | Model discovery on requests, many model candidates, SDK retries, cross-provider fallback | One shared HTTP gateway, one allowed configured provider, zero automatic retries, no discovery or fallback |
| Groq | Default 120B; arbitrary discovered models including tool-using models | `openai/gpt-oss-20b` only; incompatible environment overrides fail closed |
| Gemini | Old Flash models and Pro fallback | `gemini-2.5-flash-lite`, only when Groq has no configured key; thinking disabled |
| Usage | No durable budget | Atomic database reservations before sending, including failures and ambiguous timeouts |
| Provider loops | Failure could trigger more models and more TOS rows | First provider/quota error stops generation; up to 3 TOS rows, each one call |
| Input/output | Unbounded request lists and TOS counts | AI body 64 KiB; prompt + system text 16,000 UTF-8 bytes; 4,000 maximum output tokens; lesson fields 768 |
| Quiz/TOS | Could silently choose the first answer when provider supplied no correct answer | Reject invalid multiple-choice answer keys and incomplete generated sets |
| SMTP invitations | Repeatable admin sends | Persistent 1,000 attempts/school/UTC day; one per recipient/UTC hour; failures retain quota |
| Student risk prediction | Local scikit-learn artifact loaded repeatedly | Local inference remains free of per-token charges; two-entry artifact cache invalidated on file size/mtime change |
| General API | No central request throttle | Per-worker fixed-window rate, concurrency, streamed-body limits; tighter login/import/invitation/prediction POST limits |
| Auth refresh | Sequential waves of 401s could refresh repeatedly | Share in-flight refresh, reuse success for 5 seconds, back off failed refresh for 30 seconds; at most one replay |
| Reading telemetry | Failed fetch could replay through beacon | No replay of ambiguous time deltas, preventing duplicate recording |
| Frontend startup | All role pages eagerly loaded | Lazy route loading with visible loading state |

External text-generation HTTP calls in `backend/app` now go through `services/ai/Provider.py`. SMTP is the other outbound service found. No payment, SMS, or separate paid prediction service was found in the application service scan. Frontend/mobile HTTP requests to this backend are ordinary application traffic, not separately billed AI generations. Hosting, database, storage, bandwidth and mail-provider charges are separate.

## Default controls

| Control | Default | Scope |
| --- | --- | --- |
| Reserved AI allowance | $20/month | Shared database, UTC calendar month |
| Reservation | $0.01 per attempted provider call | Conservative allowance, not actual provider bill |
| AI attempts | 12/minute; 500/day | Entire school, shared database |
| Staff AI attempts | 30/day | Each authenticated staff ID, shared database |
| Duplicate request | One identical provider payload per staff per UTC minute | Also blocks ambiguous retries; not a result cache |
| Provider error circuit | Stop at 5 recorded errors in current minute | Reopens next UTC minute; in-flight calls may finish |
| Deadline | 30 seconds per provider attempt | Includes HTTP connection/read time; TOS has at most 3 sequential calls |
| Quiz generation | 20 questions/request; at most 20 source IDs | Larger exams require deliberate smaller requests |
| TOS generation | 3 rows/request, 20 questions/row, 40 total | Existing large TOS payloads receive validation errors |
| General request rate | 6,000/minute overall; 3,000/minute/IP | Per worker, resets on worker restart |
| Concurrent requests | 100 | Per worker |
| Login attempts | 10/account/minute; auth POST 300/IP/minute | Per worker; accommodates shared school NAT better than a tiny IP limit |
| Expensive POSTs | 10/IP/minute | Imports, invitations, prediction paths, auto-schedule path marker |
| Body limit | 25 MiB general; 64 KiB AI | Streamed bytes checked, not just Content-Length |

Fixed windows can admit a burst spanning a minute boundary. Generic throttles are supplemental, not distributed DDoS protection. Use a trusted reverse proxy with shared throttling and connection/body deadlines. Do not configure Uvicorn to trust arbitrary forwarded IP headers. AI/SMTP quotas are database-backed and remain shared across workers/hosts that use the same database; splitting databases splits the allowance.

The reservation is deliberately higher than bounded text-call estimates at reviewed prices. $20 permits at most 2,000 provider attempts/month, potentially stopping generation well before $20 appears on a provider invoice. A TOS request with three rows uses three attempts. Reservations are not refunded after failure because the provider may already have processed the request. A provider price change, other apps using the same key, or direct use of leaked credentials can bypass the cost assumptions. Use a dedicated project/key and provider-side limits as an independent control.

## Alerts

Admin **System Settings → AI usage and budget** displays reserved allowance, calls today, and alerts for 80% budget consumption, bursts nearing the minute limit, and repeated provider errors. It loads once when opened and supports manual refresh; it does not poll continuously.

Structured log event names: `AI_BUDGET_ALERT`, `AI_BURST_ALERT`, `AI_PROVIDER_ERROR`, `AI_GUARD_UNAVAILABLE`. The usage endpoint is admin-only: `GET /api/v1/ai/usage`. Configure the deployment's log monitor to notify the operator on these events. No email, Slack, provider-console budget alert, or external monitoring integration has been provisioned; this workspace does not supply that deployment/account configuration. Provider response bodies and API keys are not included in gateway error messages.

## Monthly AI cost scenarios

Assumption: staff who generate AI content are 5% of the school population, each makes 40 provider calls/month, each averaging 2,000 input and 2,000 output tokens (including billed reasoning). These are workload assumptions, not measured production usage. Students consuming teacher-generated content do not add AI calls.

Reviewed standard text prices: Groq GPT-OSS 20B is $0.075/million input tokens and $0.30/million output tokens ([Groq model documentation](https://console.groq.com/docs/model/openai/gpt-oss-20b)); Gemini 2.5 Flash-Lite is $0.10/million input and $0.40/million output ([Google pricing](https://ai.google.dev/gemini-api/docs/pricing)). No free tier, batch discount or cache discount is assumed.

| School users | Assumed AI staff | Calls/month | Groq estimate | Gemini estimate | Reserved allowance used |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 600 | 30 | 1,200 | $0.90 | $1.20 | $12 |
| 800 | 40 | 1,600 | $1.20 | $1.60 | $16 |
| 1,000 | 50 | 2,000 | $1.50 | $2.00 | $20 |

Formula: calls × ((input tokens × input price + output tokens × output price) / 1,000,000). For 50 staff making 160 calls each, unconstrained demand is 8,000 calls: $6 Groq or $8 Gemini under those token assumptions, but the default reservation cap stops after 2,000 attempts. If every one of 1,000 users were allowed 40 AI calls, unconstrained demand would be 40,000 calls ($30/$40); students currently cannot access these generation endpoints.

At the configured maximum context/output, the text portion is approximately $0.0024 Groq or $0.0032 Gemini per call before small message framing overhead; $0.01 reservations leave headroom. The real average needs provider usage measurements after a controlled pilot. Dollar amounts exclude taxes, exchange-rate effects, infrastructure, SMTP costs and other use of the provider account.

## Authorization and logic findings

- Removed plaintext credential/account lists from `runningman.md`. Rotate the exposed SMTP app password and any real reused passwords; removal does not purge Git history. Provider credentials should be stored outside tracked files.
- TOS read endpoints previously allowed students to retrieve answer-bearing exam data. They now require staff roles. TOS reads/updates/deletes/question edits require ownership or admin role. Orphaned exams are admin-only.
- AI reading selection now requires lessons owned by the requesting staff and the requested subject; attached classworks are restricted to resolved lessons and READING type. Shared/co-authored reading workflows require an explicit adviser-approved access policy before broadening this.
- Public academic-year GET previously created future rows and could advance from the latest year repeatedly when no active year existed. It is now read only. Preparation is an explicit admin POST to `/api/v1/settings/academic-years/prepare`.
- Health checks now return HTTP 503 for database failure without exposing the database exception.
- Existing attachment-download routes use a separate token/ownership helper; lack of a direct role dependency alone does not make them public. Public settings and invitation acceptance are intentional public surfaces. Query-string JWT download links remain a follow-up because URLs can enter access logs.

## Capacity and remaining work

730 backend tests passed with 2 skipped in the broad run. After subsequent edits, affected-area runs passed 42 and 21 tests (overlapping suites; do not add these counts). Frontend: 17 tests passed and the final TypeScript/Vite production build passed. `git diff --check` passed. These tests are not production load tests. The initial route-splitting build reduced the main JS chunk from 2,841.41 kB (741.04 kB gzip) to 267.40 kB (82.65 kB gzip); shared/route chunks are additional downloads when needed.

Remaining likely bottlenecks needing realistic staging measurements:

- Synchronous database queries inside async AI routes can briefly block their event loop. The gateway offloads quota queries, but route material gathering still uses synchronous ORM access and can hold a session across provider waits.
- Some dashboards/list routes load entire result sets and related objects. Measure query counts and add pagination/bulk aggregation without breaking clients that expect full lists.
- SMTP bulk onboarding still occupies a background task for minutes. Quotas and timeouts bound sends, but a durable job queue with status, expiry and idempotency is needed for restart-safe delivery.
- File-size limits do not bound decompressed ZIP/XML/PDF complexity. Imported documents need archive member/expanded-size/page/row limits and isolated parsing jobs before accepting hostile uploads at scale.
- Prediction artifact caching avoids repeated deserialization; artifact digest calculation and feature building still do work per prediction. Do not mutate cached model objects or replace artifacts while preserving file size/mtime.
- Per-worker request gates cannot stop network-level floods or slow clients before they reach Python. Configure proxy timeouts/body limits and aggregate rate limits. Confirm DB connection budget across all workers; `pool_pre_ping` repairs stale connections but adds a checkout ping.
- Existing JWT access tokens can retain permissions until expiry; archived-user/role-change revocation needs broader auth-contract work. Existing CORS development allowances should be restricted in deployment.

600–1,000 registered users is different from simultaneous activity. Example demand: 100 active students sending one request every 10 seconds is 10 requests/second; 1,000 doing so is 100 requests/second before login bursts or downloads. The reading timer alone can generate approximately 33 requests/second with 1,000 readers at its 30-second interval. CPU, DB query latency, storage and bandwidth determine actual capacity; no hosting configuration was supplied to price or certify it.

Staging acceptance: replay representative student reads/submissions and teacher dashboards at 50, 100, 250, then 1,000 concurrent sessions with AI transport mocked; measure p50/p95/p99, error/429 rate, event-loop delay, DB pool waits, CPU/RAM, and upload throughput. Confirm quotas stay global under multiple processes, restart during ambiguous generation, verify schema migration on a copy, and review generated-question quality with the adviser. Do not load-test using live paid AI keys.

## Third normal form and adviser decisions

Third normal form applies to relational data dependencies, not HTTP infrastructure or code flow. The new usage table has a composite `(scope, period)` primary key and one dependent scalar `used`; it stores no duplicate user profiles, provider prices, prompts or content. Shared provider policy removes duplicated provider/retry logic from the three generation services.

This change does **not** claim that the entire existing database is in 3NF. Existing repeated structures worth reviewing include `SubjectLoad.days_of_week`, TOS exam configuration JSON, and TOS question `options_json`. Some are intentional historical snapshots; decomposing those without defining historical/versioning rules can change existing assessments. Candidate relations are `subject_load_day(subject_load_id, weekday)`, `tos_question_option(tos_question_id, option_order, option_text, is_correct)`, and versioned TOS configuration rows. Before replacing existing storage: define ownership and snapshot semantics, backfill on a copy, compare row counts/results, add foreign keys/unique constraints, switch readers/writers together, and only then retire legacy fields. No destructive schema rewrite was performed while those rules remain open.

## Deployment

New migration: `20260913_api_usage_guard`, following `20260913_lesson_plan_subject_class`. The inspected local DB reported `20260911_subject_load_section_revisions`, so it has pre-existing pending migrations. This change does not silently apply that unrelated migration chain or alter live data. Until the usage table exists, AI and real SMTP sends fail closed.

On a backed-up deployment/copy after reviewing pending migrations, run from `backend/`:

```powershell
.\.venv\Scripts\python.exe -m alembic upgrade head
```

The gateway requires Python 3.11 or newer for its wall-clock timeout. Set these environment values on the server, then restart workers:

```dotenv
GROQ_MODEL=openai/gpt-oss-20b
AI_ENABLED=true
AI_MONTHLY_BUDGET_USD=20
AI_SCHOOL_PER_MINUTE=12
AI_SCHOOL_PER_DAY=500
AI_STAFF_PER_DAY=30
API_REQUESTS_PER_MINUTE=6000
API_IP_REQUESTS_PER_MINUTE=3000
```

`AI_ENABLED=false` is the kill switch. No `.env` credentials or provider account settings were changed. Existing `.env` values override the new cheap-model default and may need updating. All workers must use one quota database. Review retention of old daily/minute/hash counters periodically; never delete the current month budget or active quota windows to reclaim space. Keep monthly budget records for billing reconciliation.

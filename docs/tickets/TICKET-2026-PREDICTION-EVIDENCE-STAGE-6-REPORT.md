# Prediction Evidence Phase 1 — Stage 6 acceptance report

Status: **not release-ready** as of 2026-09-11. The Phase 1 evidence behavior and focused acceptance tests are passing, but the repository-wide backend result could not complete reliably during this validation, repository-wide frontend lint fails, and Alembic has two heads.

## 1. Test results

| Area | Result | Evidence |
| --- | --- | --- |
| Backend collection | 696 tests collected | `pytest --collect-only -q` |
| Full backend suite | **Inconclusive / blocked** | Two PostgreSQL-enabled full-suite invocations became orphaned and idle without a final result. They were stopped; do not count this as a passing suite. |
| PostgreSQL concurrency | Pass | `tests/test_prediction_generation_transaction.py`: **2 passed** in 0.46s with `RUN_POSTGRES_CONCURRENCY_TESTS=1`. |
| Prior focused Phase 1 backend acceptance | Pass | Stage 4 combined focused suite: **115 passed, 1 warning**. |
| Frontend unit suite | Pass | **4 files, 15 tests passed**. |
| Teacher-evidence formatter | Pass | **2 tests passed**. |
| Frontend production build | Pass | `tsc -b && vite build` completed; 4,028 modules transformed. |
| Frontend lint | **Fail** | `eslint .`: 143 findings, 126 errors, 17 warnings across the existing frontend codebase. |

The landing-page button test was corrected so it mocks the authenticated state expected by server rendering. This replaces an invalid provider setup that could only render the provider's loading state; it does not change application behavior.

## 2. PostgreSQL transaction acceptance

The live PostgreSQL test verifies deterministic scope keys, `REPEATABLE READ`, same-scope serialization through `pg_advisory_xact_lock`, and lock release after rollback. Both tests passed.

## 3. End-to-end scenario acceptance

| Scenario | Result |
| --- | --- |
| A — genuine zero completion | Pass: saved teacher evidence renders `0 of 10 · 0%`, not unavailable. |
| B — no activities | Pass: completion and coverage are unavailable rather than fabricated as zero; dependent readiness/scoring is skipped. |
| C — sufficient evidence / scoreable prediction | Pass through services/routes with the approved scorer test double; an execution trace and immutable snapshot are persisted and read back. A production model artifact is not exercised by this repository test. |
| C2 — completed but ungraded | Pass: completion is available while coverage is unavailable; scoring is skipped. |
| D — ambiguous duplicate classwork submission | Pass: unresolved source/attempt state does not create a metric or score. |
| E — other-period data | Pass: out-of-period classwork and attendance are excluded. |
| F — final official zero grade | Pass: zero is preserved and provenance is `OFFICIAL`, not treated as missing. |
| G — saved snapshot after source changes | Pass for the covered source-period mutation: the saved evidence/read response remains immutable. |
| H — legacy prediction | Pass: no fabricated evidence; the response carries the legacy-evidence limitation. |

## 4. Stage 1 baseline to final behavior

| Stage 1 finding | Final Phase 1 behavior |
| --- | --- |
| `0` was indistinguishable from missing in teacher evidence | Real zero is displayed as a real zero with counts and percentage. |
| No activities could look like zero completion | It is `UNAVAILABLE`; readiness/model/risk dependent on it are skipped. |
| Ungraded work could imply grade coverage | Completion and coverage are separate; unavailable coverage does not become zero. |
| Duplicate/ambiguous attempts invited a guessed selector | The existing gradebook selector is used only where it is authoritative; ambiguity is unresolved and blocks dependent scoring. |
| Period leakage was possible in broad evidence reads | Source-period filters and capture cutoffs scope observations. |
| Final zero grade risked loss through truthiness checks | Zero is retained with source provenance. |
| Classwork and assessment might be conflated | They remain separate; no title/timestamp-based deduplication or activity entity was introduced. |
| Raw model identifiers were teacher-facing | Saved evidence is rendered with catalog labels, teacher language, source, state, and usage. |
| Prior predictions could be reinterpreted after source changes | New audited predictions expose their immutable saved snapshot; legacy rows state the limitation. |

## 5. UI and regression results

The prediction detail sheet consumes the saved `evidence` contract, groups items by category, uses `formatted_value`, and keeps source, state, usage, explanations, and limitations visible. Evidence cards use a one-column layout that becomes two columns at `sm`; the active teacher-evidence view has no horizontal evidence table. The former raw feature panel remains guarded by a constant `false` and is not rendered; removing that dead code is a cleanup item, not a runtime behavior change.

No Phase 1 regression was found in the focused backend tests, PostgreSQL concurrency test, frontend unit tests, or production build. Repository lint is a general regression/quality gate failure and includes errors both inside and outside prediction components.

## 6. Known limitations

- Historical/legacy `AIPrediction` rows without an evidence snapshot remain explicitly limited; they are not retroactively claimed to be audited.
- Assessment observations remain separate from classwork. No academic-activity equivalence is inferred.
- The successful prediction scenario uses a controlled scoring test double, not a deployed production model artifact.
- The disabled raw feature panel should be removed in a follow-up cleanup once tests cover the rendered evidence view directly.

## 7. Release blockers and recommendation

1. Resolve the two Alembic heads (`20260911_drop_leave_request` and `20260911_prediction_evidence_scope`) with an approved merge migration, then verify `alembic upgrade head` on a clean database.
2. Obtain a complete, non-orphaned PostgreSQL-enabled run of all 696 backend tests and record its final pass/fail total.
3. Restore a passing frontend lint gate, or obtain an explicit release waiver for the existing 126 lint errors with a bounded remediation ticket.

**Recommendation: do not deploy yet.** The Phase 1 implementation is functionally promising and its focused acceptance evidence passes, but the three release gates above prevent a final release recommendation.

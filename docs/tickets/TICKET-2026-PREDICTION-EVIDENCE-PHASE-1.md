# Phase 1: truthful prediction evidence

Status: Stage 2 minimum migrations applied after the [Stage 1 report](TICKET-2026-PREDICTION-EVIDENCE-STAGE-1-REPORT.md) and [Stage 1.5 decision record](TICKET-2026-PREDICTION-EVIDENCE-STAGE-1-5.md). Evidence extraction, snapshot persistence, and teacher presentation remain pending.
Date: 2026-09-11.
Parent: [prediction evidence architecture roadmap](TICKET-2026-PREDICTION-EVIDENCE-AUDIT.md).

## Deliverable

Newly generated predictions save enough information to explain their evidence accurately. Teachers see familiar labels, meaningful units, and brief source/use descriptions. Legacy predictions remain readable with "Source details unavailable for this saved prediction."

This phase does not introduce LearningActivity, migrate to prediction series, refactor the official gradebook formula, reconstruct missing history, or redesign performance/outcome cohorts. Unknown scope or source authority yields unavailable evidence and a saved scoring-skip reason; it never produces a falsely precise percentage.

## 1. Minimum schema changes

| Change | Purpose |
| --- | --- |
| Nullable `ClassworkAssignment.academic_period_id` FK and scope index | Explicit period attribution for new assignments; validate against class/year/subject load. Assessment items already have period identity. Require it in new writer/import contracts; old unmapped rows remain null. |
| Nullable `AIPrediction.evidence_snapshot` JSON | Atomic saved scope, sources/counts, observed values/states, actual usage, ordered model inputs/transformations, and evaluated rule results. Null means legacy provenance unavailable. Validate payload completeness before commit. |
| Nullable unique `AIPrediction.generation_request_id` | Idempotent creation/retry for new executions. Store request fingerprint in the snapshot; reusing the key with a different request is a conflict. Legacy rows remain null. |

Do not add a new activity table or a standalone snapshot table in Phase 1. A narrow assessment-to-assignment relationship is permitted only after the identity decision below proves that link necessary and its cardinality. It is not an assumed migration requirement.

Capture source data under a consistent read transaction at generation time. Save record values as well as IDs; later edits cannot change the displayed evidence. Attendance uses recorded dates within source-period bounds and capture cutoff. Historical replay is unsupported without revisions; do not infer past row contents from current timestamps.

New outputs, raw feature rows, and snapshot commit together. Save readiness-only results too. Direct-input and import adapters must identify supplied evidence as caller/import sourced; reject unverifiable derived percentages as trusted observed evidence. Every production creation path must use the contract or fail explicitly; do not leave a snapshot-free bypass for new records.

## 2. What stays numerically identical

- Gradebook formulas, grading-template resolution, exam splits, transmutation, finalization, and manual grade overrides remain unchanged.
- Existing model artifact, ordered supported features, and valid preprocessing behavior remain unchanged. Eligibility guards reject invalid schemas rather than silently dropping fields.
- Readiness thresholds (including completion/coverage below 50%) and risk thresholds/scoring formula remain unchanged.
- Attendance status weights and valid participation weights/normalization remain unchanged.
- On equivalent complete, correctly scoped, unambiguous input records, model values, predicted grade, and risk classification must match the baseline.
- The current equal-component prediction fallback stays numerically unchanged and is explicitly labeled ESTIMATED. Replacing it with the gradebook calculation is a separate model-compatibility change, not a Phase 1 dependency.

Provenance distinguishes OFFICIAL (verified finalized final grade), RECORDED_PROVISIONAL (exact stored field/stage), RUNNING_CALCULATION (existing authoritative formula over actual graded records), ESTIMATED (approximation), and NONE. Phase 1 must not claim to produce RUNNING_CALCULATION using the equal-average fallback.

## 3. Intentional correctness changes

| Correction | Expected effect |
| --- | --- |
| Explicit null-based grade selection | A legitimate zero no longer falls through to a different grade |
| Verified period and cutoff scope | Other-period/future-unavailable records no longer affect evidence |
| One assignment per metric despite multiple attempts | Duplicate joined rows no longer inflate counts or percentages |
| Separate absent evidence from numeric zero | No-activity rates are unavailable; genuine 0 of N remains 0%; any preprocessing fallback is separate |
| Correct on-time observation | Unsubmitted activities cannot be counted as on-time; population policy must be established first |
| Omit unavailable participation components | Missing measurements do not masquerade as zero engagement |
| Canonical identifiers and saved rule traces | Causes describe actual evaluated rules; this does not itself change risk classification |
| Reject output/risk-only/unknown model columns | Invalid training/registration/scoring fails clearly instead of admitting leakage |

Scope/deduplication/availability corrections can change grade-model inputs, scoring readiness, participation, predicted grade, and risk. Report these effects explicitly; do not call the release cosmetic. Invalid weights or ambiguous source/attempt records should fail or defer scoring, not be silently clamped or guessed.

## 4. Identity, eligibility, and source authority decisions

Existing evidence identifies classwork by `classwork_assignment_id` and assessment items by `assessment_id`. The gradebook uses assignments/submissions; prediction currently combines those with assessment scores. The inspected models do not prove that each cross-table pair represents a duplicate or an independent learning task.

Before any identity migration, inspect all writers/imports and representative scoped records, and produce a short decision record: authoritative source, source relationship/cardinality, duplicate examples, and why existing IDs plus a link are or are not sufficient. Do not merge matching titles or assign a new shared entity by default.

Until equivalence is verified, preserve separate source populations. Do not sum overlapping/unknown populations into one completion or coverage feature. If both populations may represent the same work and no authority is recorded, mark the required combined metric unresolved and skip dependent scoring. Report known source counts so lack of reconciliation does not look like no activities.

Eligibility must align with the application's existing domain behavior, not an invented overdue-work policy:

- `is_graded` means the activity counts toward grading; it does not mean a score has already been entered. Submitted-but-ungraded work can count toward completion and not the coverage numerator.
- Record completion and coverage population definitions separately. Their denominators may coincide, but must not be forced to do so.
- Current gradebook selection includes non-archived, grading-enabled, non-reading assignments without a publication predicate. Therefore a blanket exclusion of unpublished offline teacher records is not established policy.
- Distinguish online availability/publication from offline recorded work. Use source-specific recorded authority. When availability cannot be established, expose an unresolved state rather than inventing publication history.
- Assignment/availability date and due date are different. Do not make completion denominators "due by cutoff" without domain approval. A future due date alone does not exclude already assigned, available work. Future exclusions in fixtures mean not yet assigned/available at cutoff.
- Use an explicit assigned-population label when aligned with existing assignment semantics. Lateness uses due dates; undated work has no lateness measurement. Any new expected-date field/policy is deferred pending domain alignment.
- Unknown assessment completion (`MISSING_NOT_ENCODED` or no score row) is not confirmed student non-completion. Missing-record counts and missing-work claims remain distinct.

Document alignment with existing gradebook behavior for each supported source. If changing academic policy is necessary, keep that source unresolved and seek the domain decision; a technical plan does not grant policy approval.

Attempt selection must reuse the gradebook's `_submissions_by_student()` policy through a small shared selector, with parity checks. It currently prefers a graded submission, then the latest `graded_at`/`submitted_at`/`created_at` among graded rows. It does not implement highest-score or teacher-selected attempts. Equal timestamps and multiple ungraded records are not fully ordered. Do not invent an ID tie-break or first-submission lateness policy: resolve via existing authoritative data, otherwise mark the affected metric unresolved. Filtering to the saved scope must precede selection.

| Disagreement | Authority for Phase 1 |
| --- | --- |
| Finalized period grade 83 versus running calculation 84 | Display official 83; use verified final grade as source-period input. A running calculation is a separate measure, not a conflict to average away. |
| Non-final stored grade versus fallback estimate | Preserve existing non-null field precedence, record exact source/stage, and label provisional/estimated correctly. |
| Same proven assignment has assessment 80 and gradebook-selected classwork score 85 | For the assignment-backed population, gradebook-selected 85 is authoritative; preserve the assessment value/disagreement in audit data. Do not count both. An explicit verified relationship is required. |
| Standalone assessment with no corresponding assignment | Assessment score is authoritative for that assessment population; it cannot silently substitute for a different gradebook task. |
| Relationship, override, or source authority unknown | Unresolved; neither average nor choose by timestamp across unrelated sources. Block dependent feature/scoring. |

An official period grade does not establish the underlying activity counts or resolve activity-source disputes. A valid official grade can coexist with unavailable activity evidence.

## 5. Snapshot, usage, validation, and simple presentation

Save measured value, unit/scale, availability, population/source counts, relevant source values/IDs, scope, grade provenance, actual stage use/skip reasons, and rule trace. Preprocessing records have separate model values and transformation names. Runtime usage comes from the execution, not today's model schema on detail read.

Use four versioned contracts only:

1. Evidence contract: canonical meanings, aliases, identity/eligibility, denominators, units, availability, and snapshot structure.
2. Grade calculation contract: selected stage, weighting/transmutation behavior; save actual configuration values.
3. Model contract: ordered inputs, supported model permissions, preprocessing; save model identity/artifact digest.
4. Risk ruleset: readiness/risk definitions, thresholds, participation calculation; save actual evaluated inputs and configuration.

Helper names and selected configurations are payload data, not independent version counters. Allow cosmetic label changes without changing mathematical meaning. Save rule predicates, thresholds, results, and skipped reasons. Do not compute new per-feature contributions or rerun historical rules on detail read.

One shared executable catalog validates training, dataset checks, registration, runtime vectors, and new persistence. Every grade-model column requires GRADE_MODEL_INPUT permission. Canonicalize before validating; reject output/target aliases and collisions. Register supported internal encodings explicitly. Unknown historical values remain raw audit data with diagnostics and no invented explanation.

Default teacher rows should be compact:

```text
Activities completed
8 of 10 · 80%
Used to check whether enough evidence is available.

Attendance score
93/100
Based on recorded attendance during Term 1.

Current grade
82
Official finalized Term 1 grade.
```

The use sentence must reflect the saved execution; it is not hard-coded for all predictions. Remove Direction. Keep predicted grade in the summary only. Put definitions and meaningful limitations in accessible expandable help. Technical versions, digests, raw records, and traces belong in an administrator/debug view with appropriate access control, not the default teacher panel.

## 6. Persistence limits and deferred hardening

Phase 1 preserves current one-result list/count behavior. It does not append successors or change dashboard selection. To avoid rewriting the new saved evidence under an existing ID, reject `replace_existing` for audited predictions with an explicit conflict. Retrying an existing logical prediction returns its saved output/snapshot without rescoring; modified refresh requests are not treated as successful regeneration. Do not silently rewrite legacy evidence either. Regeneration/version history is a documented limitation until Phase 2, not a claim that all historical executions are already retained.

Use a transaction and unique request key for retry atomicity; serialize conflicting logical-scope creation through an existing stable scope-row lock so different request IDs cannot create duplicate logical predictions. Test concurrent creation. This is a small service-level prerequisite, not a new series data model.

Deferred work includes append-only series/regeneration, successor links, database immutability enforcement, administrative repair tooling, full reconciliation UI, shared grade-calculator extraction, alternative grade estimation, outcome-cohort redesign, source-revision history, backdated replay, and a potential shared activity entity.

Before append-only migration, inventory every assumption of one prediction per scope. Starting consumers found in source: DashboardPredictionService, DashboardFilterService, PredictionReadService, PredictionSuggestionService, TeacherRiskReviewService, PredictionOutcomeService, ModelPerformanceService, Predictions routes, persistence notification code, SeedLivePredictions, and score_enrolled_cohort. Extend the inventory to frontend/adviser views, exports, alerts, scheduled jobs, cleanup/remediation scripts, and uniqueness constraints; record query behavior and migration tests. Do not migrate persistence until that inventory is complete.

Proposed future series identity is `(student_id, class_id, subject_id, source_period_id, target_period_id, prediction_purpose)`. Model version and cutoff identify executions, not series. Validate year through periods/class. One shared query selects latest committed generation by timestamp then ID; confirm purpose mappings before implementation.

Business immutability applies to normal application actions. Future database controls must allow an exceptional, authorized administrative/migration repair process with reason, operator, timestamp, before/after payload, and audit record; prefer corrective successor records. Never introduce a generic production bypass through normal prediction routes.

Legacy handling is only a null-snapshot adapter: preserve raw values and show the unavailable-source message. No reconstruction, historical threshold re-evaluation, or broad cleanup is required for Phase 1.

## 7. Acceptance and difference severity

| Fixture | Required result |
| --- | --- |
| A: 10 assigned/available eligible tasks, confirmed zero completed, 2 future-unavailable tasks, previous official grade 82, 8 present/1 excused/1 late attendance sessions | 0 of 10 / 0%; attendance 93/100; official prior source visible; model skipped under unchanged completion readiness rule |
| B: no activities, prior grade, or attendance | Unavailable values with specific states; saved model skip reason; no fabricated zero percentages |
| C: 8 of 10 completed and graded, other required inputs available | Model executed; saved exact inputs/model identity; deterministic model returns 84; saved missing-work rule can explain the two confirmed missing activities |
| C2: 8 of 10 completed, only 6 graded | Completion 80%, coverage 60% for this shared-population fixture; ungraded submissions remain completed |
| D: fail extraction after partial reads; separately fail persistence after prediction insert before evidence completion | No visible incomplete execution/orphan features; rollback preserves existing data; retry with same key gives exactly one complete output/snapshot; concurrent retries return that same result |

Exercise records -> extraction -> scoring/readiness -> persistence -> authenticated detail API -> rendered teacher panel. Also test zero grades, duplicate representations/attempts, unresolved identity, other periods/subjects, alias bypass, model-output rejection, saved evidence after source edits, and legacy fallback. For D, attempt dashboard/detail reads after the failure and verify no partial result is visible.

Compare old/new behavior on identical frozen representative inputs. Report coverage/completion/participation/source-grade/prediction differences, missing-state transitions, skipped scoring, and a risk transition matrix. Do not claim production historical validation when only synthetic fixtures are available.

| Difference class | Release treatment |
| --- | --- |
| Expected and previously approved | Pass with fixture/report reference and unchanged intended semantics |
| Serialization-only | Pass only if difference is at most half the existing persisted/display quantum (0.00005 for four-decimal values; 0.005 for two-decimal grades), rounded output is identical, and no threshold, readiness, ordering, or risk decision changes |
| Intended semantic correction | Record cause, affected population, largest deltas, and new regression cases; release once compatibility assessment supports it, without an arbitrary blanket numerical tolerance |
| Unexplained regression | Blocks activation; investigate before release |

Any numeric change crossing a threshold is semantic regardless of its size. Missing/zero/state changes are never serialization-only. Preserve raw computation parity where no correction applies. Changed input distributions require explicit model-compatibility review; do not automatically retrain or change the artifact as part of presentation work.

## Bounded implementation sequence

1. Record existing source/eligibility/attempt authority and baseline fixtures. Resolve supported-source policy; leave unverified populations explicitly unavailable.
2. Add the small period/snapshot/idempotency migrations and update all new production writers. Reuse existing activity identifiers; no new activity entity.
3. Implement catalog enforcement, provenance/availability extraction, scoped counts, proven corrections, and saved actual execution traces. Keep official grading formulas and model artifact unchanged.
4. Persist atomically, protect audited records from replacement, make retries coherent, and add the simple evidence API/UI plus legacy adapter.
5. Run A/B/C/C2/D, targeted semantic tests, and the categorized old/new compatibility report. Enable only verified source scopes; publish unresolved coverage counts so unsupported data do not disappear silently.

Completing this document defines Phase 1. It does not claim migrations, application implementation, school-policy approval, or regression validation have already occurred.

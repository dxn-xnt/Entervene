# Prediction evidence: teacher terminology and audit implementation plan

Status: architecture roadmap, not one implementation ticket; application changes have not been made.
Updated: 2026-09-11.

## Delivery boundary

The executable first delivery is [Phase 1: truthful prediction evidence](TICKET-2026-PREDICTION-EVIDENCE-PHASE-1.md). Its scope and release gates take precedence over the broader proposals below. Sections describing new activity entities, shared grade-calculator extraction, append-only prediction series, database immutability, historical reconciliation, and outcome-cohort changes are later roadmap work, not Phase 1 dependencies.

Phase 1 saves complete evidence with new predictions, enforces model eligibility, corrects proven evidence errors, and simplifies the teacher panel. It does not require reconstructing legacy history. The proposal below is retained as architectural context, subject to the decision gates documented in Phase 1.

## Outcome and hard requirements

Every teacher-visible evidence row must accurately answer: what was measured, where it came from, how this particular prediction used it, and whether zero is observed or evidence is unavailable.

1. Enforce feature eligibility during dataset validation, training, model registration, scoring, persistence, and reconstruction.
2. Save a deterministic student/class/subject/year/period/cutoff scope and canonical activity population.
3. Preserve immutable prediction executions, observed evidence, model transformations, and rule evaluations.
4. Separate observed values from preprocessing defaults and grade estimates.
5. Resolve activity identity, eligibility, and denominators before publishing percentages.
6. Require an old/new calculation comparison before enabling changed prediction behavior.

This document specifies proposed behavior. The audit findings below describe current code, not deployed-database verification or certification of grading policy.

## Verified current flow and implementation gaps

```text
Assessment items/scores + classwork/submissions + attendance + period grades
    -> PredictionFeatureBuilderService
    -> readiness gate
        -> insufficient response (normal records endpoint returns before persistence)
        -> ModelScoringService -> grade estimate -> RiskEngine
    -> PredictionPersistenceService -> prediction + raw feature rows
    -> PredictionReadService -> PredictionExplanationService
    -> prediction-detail-sheet.tsx renders raw keys and four decimal places
```

The cohort script separately persists insufficient-evidence predictions. Imports and direct scoring APIs are additional producer paths.

| Finding | Existing code |
| --- | --- |
| Zero-denominator completion and coverage become numeric zero; grade selection uses truthiness and can skip a real zero | `backend/app/services/prediction/PredictionFeatureBuilderService.py` |
| Prediction fallback grade equally averages available component percentages | `_running_grade()` in the feature builder |
| Assessment queries filter period; classwork and attendance evidence lack equivalent scope restrictions | Feature builder and `backend/app/services/attendance/AttendanceService.py` |
| Multiple submission rows can multiply joined classwork rows; assessment/classwork identity is not unified | `_classwork_rows()`, `_component_features()`, and `StudentSubmission` model |
| Punctuality subtracts late submissions from all dated assignments, allowing unsubmitted work into the remainder | `_late_submission_count()` and the caller's on-time calculation |
| Current persisted feature rows lack denominators, source snapshots, actual execution usage, and rule results | `backend/app/models/ai/AIPredictionFeature.py` |
| Replacement overwrites the prediction and deletes feature rows; duplicate handling scores before returning the saved prediction | `backend/app/services/prediction/PredictionPersistenceService.py` |
| Explanation service checks older identifiers and independently applies thresholds | `backend/app/services/prediction/PredictionExplanationService.py` |
| Direction is always persisted as NEUTRAL by the main persistence service | `build_prediction_feature_rows()` |
| Runtime and training guards do not explicitly reject `predicted_period_grade`; local model schema currently excludes it | `ModelScoringService.py`, `backend/app/ml/Train.py`, local model feature schema |

No inspected application reconstruction path currently feeds saved output rows back into scoring. This is not an enforced guarantee: future reconstruction must use the same model-input validator.

## 1. Enforceable canonical feature catalog

Add `backend/app/services/prediction/FeatureCatalog.py` as the common contract for canonical identifiers, allowed uses, units/scales, visibility, and semantic versions. Keep execution evidence separate from static permissions.

Allowed uses include `GRADE_MODEL_INPUT`, `RISK_RULE_INPUT`, `DATA_SUFFICIENCY_INPUT`, `DERIVED_DISPLAY_ONLY`, and `PREDICTION_OUTPUT`. Multiple permissions are possible. Internal visibility never grants model permission.

Executable rules:

- Every model-vector column must be registered and explicitly permit `GRADE_MODEL_INPUT`.
- Outputs, target variables, risk-only values, display-only values, and unknown identifiers are rejected as model inputs. A registered target can be the training target but cannot also be in X.
- Validate after canonicalization/mapping as well as before constructing the final model vector. Reject alias collisions and mappings that introduce prohibited fields.
- Validate the ordered schema against the model artifact's input contract. Persist model artifact digest and feature-schema version with each execution.
- Apply checks in `DatasetPackValidator.py`, `Train.py`, `ModelVersionService.py`, `ModelScoringService.py`, and all import/reconstruction adapters.
- Every newly persisted feature must have a registered classification. Register permitted subject encodings from an explicit supported subject set; an arbitrary `subject_*` prefix must not bypass validation.
- Unknown historical features remain in the raw audit representation with diagnostics and an explicit unknown classification; do not silently promote them into the catalog or show them as explained teacher evidence.

The older explanation aliases occur in the initial explanation-service history and tests. New live producers use canonical identifiers. Inventory stored aliases before migrating; spelling similarity does not prove matching denominators. Normalize verified aliases once at the legacy/import boundary, record normalization version, and reject conflicting duplicate values. New writes use canonical identifiers only.

## 2. Authoritative application grade computation

The existing gradebook and adviser-submission formula is implemented in `backend/app/services/student_record/StudentRecordService.py`:

- `resolve_subject_grading_weights()`: subject's selected template, subject-linked template, academic-level template, active Core Subjects template, then 30% written work / 50% performance tasks / 20% exams fallback. Recognized component weights are normalized.
- `_category_ps()`: earned points divided by total maximum points of supplied assignments. No assignments/usable scores returns unavailable; a scored zero remains numeric zero.
- `_compute_exam_ps()`: Summative 1 / Summative 2 / Term Exam components with a default 30/30/40 split; available exam components are normalized. It also contains subtype inference that must be captured if used.
- `_deped_grade()`: combines component percentages with resolved weights to produce an initial grade, then calls `_deped_transmuted()`.
- `_deped_transmuted()`: applies the application's current interpolation table.
- `_compute_student_period_components()`, gradebook display, and adviser submission use this calculation. Finalization can also accept an explicitly entered final grade.

The current student-record assignment selector also returns all class/subject assignments; it does not call its date-based `_assignment_in_period()` helper. Reuse of its formula does not make its current evidence selection period-correct.

Implementation: extract a shared grading calculation module under `services/student_record`, initially preserving its numeric behavior through parity tests. Have the gradebook, submission flow, and prediction builder consume the same calculation over explicitly supplied canonical records. Keep HTTP authorization and finalization outside the pure calculator. Do not add a second formula inside prediction.

Freeze template identity, resolved weights, fallback reason, exam split/subtype resolution, calculation version, and transmutation version with each computed grade. A template ID alone is insufficient because templates are editable.

| Source type | Exact meaning |
| --- | --- |
| OFFICIAL | Recorded final period grade with verified finalization state; retain whether entered/overridden or computed when known |
| RECORDED_PROVISIONAL | Stored non-final grade; retain the exact source field and stage (initial, transmuted, or provisional final) |
| RUNNING_CALCULATION | Deterministic result from actual graded records using the shared application formula and resolved configuration; record missing components and configured fallback use |
| ESTIMATED | Approximation, non-authoritative fallback, or inferred/predicted grade; includes the existing equal-component average |
| NONE | No usable grade |

Use explicit null checks. Keep initial and transmuted stages distinct. A model trained on one grade stage cannot silently receive another. Estimated inputs require a documented model compatibility decision; propagate their source limitations without inventing confidence percentages. Label grades using the saved source period; a previous-period grade is a separate, clearly sourced row.

## 3. Deterministic scope and one activity identity

Save `academic_year_id`, `source_period_id`, `target_period_id`, `student_id`, `class_id`, `subject_id`, period boundary dates, school timezone, `cutoff_at` in UTC, and `scope_policy_version`. Validate class/enrollment/year/period relationships before extraction. Previous-grade lookups use an explicitly named prior-period sub-scope in the same year and period type.

Do not create `LearningActivity` without an identity decision record. First evaluate the existing `classwork_assignment_id` and `assessment_id`, writer/import paths, and explicit links. Reuse an existing authoritative identity or add a narrow relationship if it resolves a proven overlap. A new shared entity is a later option only if real independent domain concepts require it. Unknown overlap must not produce a combined trusted denominator; see the Phase 1 source-authority policy. Do not deduplicate on title, ordinal number, or coincident timestamps.

New creation/import flows must record academic period, publication/availability time, and when an activity becomes expected. Link assessment/classwork representations at creation or explicit reconciliation. For historical rows, migrate only verified period and identity mappings; retain unresolved rows and a reconciliation report. An unresolved population marks scope incomplete and blocks trusted percentages/scoring for that scope; do not pretend exclusion produced a complete denominator.

Earlier eligibility proposal (requires domain alignment; not an approved school policy):

1. Activity belongs to the saved year/period/class/subject and applies to the student.
2. Activity counts toward grading (this does not mean a score already exists), is recognized by the grade calculator, and is not archived at capture. Online publication and recorded offline work require distinct source rules. Reading-only and student-exempt (`NOT_APPLICABLE`) items are excluded with reasons.
3. `expected_at <= cutoff_at`. For dated classwork, initialize expected time from the explicit due date. Offline assessments and undated work require an explicit expected date; never infer it from row creation time. Future activities remain outside this population even if their definitions already exist.
4. Count each canonical activity once, regardless of representation count or number of attempts. Save the eligible and excluded IDs plus reason codes.
5. Reuse the authoritative gradebook attempt selector; do not introduce a prediction-specific latest/highest/first-attempt rule. The current selector prefers a graded submission, then the later graded/submitted/created timestamp among graded records. Ties and ungraded-only alternatives are not fully ordered; unresolved ambiguity needs explicit handling. Submission occurrence is separate from the chosen grade revision. Resolve duplicated representation conflicts explicitly; never sum duplicate scores.

Each metric declares its own population and observation rules. Shared identity does not require identical denominators. The table below is a proposed common-population option, not a requirement to merge distinct completion and coverage populations:

| Metric | Numerator / denominator or counting rule |
| --- | --- |
| Completion | Activities with qualifying completion evidence by cutoff / eligible expected activities |
| Grade coverage | Activities with a usable recorded score by cutoff / the same eligible expected activities |
| Missing work | Eligible activities confirmed not completed; distinguish absent/not-submitted from missing encoding or unknown status |
| Late submissions | Distinct eligible activities whose first qualifying submission is after the saved deadline; extra attempts do not increase the count |
| On-time submission rate | Eligible dated activities with a qualifying submission by deadline / eligible dated activities expected by cutoff; unsubmitted activities cannot count as on-time |
| Attendance score | Weighted recorded attendance points / recorded attendance sessions in source-period dates up to cutoff, multiplied by 100 |

An assessment with no score row is not proof the student failed to complete it. Preserve unknown completion state; where unencoded data prevents an exact completion percentage, expose known counts and mark the percentage unavailable rather than treating uncertainty as observed non-completion.

Attendance weights in current code are present 1.0, excused 0.8, late 0.5, absent 0.0. The denominator is recorded sessions, not scheduled school days. Save status counts and weighted numerator; do not invent expected attendance counts. Reject unknown status values and exclude other subjects, periods, and dates after cutoff.

Capture source records in one consistent database read snapshot and save relevant values, not just mutable row IDs. A cutoff filter alone cannot reconstruct a value edited later. Backdated replay requires saved source revisions; reject unsupported historical replay rather than querying today's mutable rows and calling the result historical. Grade, attendance, submission, publication, and configuration revisions must identify when the selected values were available.

## 4. Observed evidence, transformations, and participation

Availability is per metric and separate from overall prediction readiness:

- `AVAILABLE`: a measurement exists, including a real zero.
- `NO_EXPECTED_ITEMS`: verified eligible denominator is zero.
- `NO_RECORDED_DATA`: expected scope exists but observations needed for this metric are missing.
- `INSUFFICIENT_DATA`: partial observations cannot support the stated metric.
- `NOT_APPLICABLE`: excluded by policy, such as a student exemption.
- `LEGACY_PROVENANCE_UNAVAILABLE`: historical numeric value exists without a trustworthy saved basis.

Never derive these states using `value === 0`.

```json
{
  "feature_name": "assessment_completion_rate",
  "observed": {
    "value": null,
    "unit": "PERCENTAGE",
    "value_scale": "ZERO_TO_ONE",
    "evidence_state": "NO_EXPECTED_ITEMS",
    "observed_count": 0,
    "expected_count": 0,
    "denominator_policy": "eligible_expected_activities_v1"
  },
  "model_transformation": null,
  "execution_usage": {
    "grade_model": {"used": false, "reason": "INSUFFICIENT_EVIDENCE"},
    "data_sufficiency": {"used": true, "rule_version": "readiness_v1"},
    "risk_engine": {"used": false, "reason": "SCORING_SKIPPED"}
  }
}
```

When preprocessing actually occurs, record ordered `model_value`, transformation identifier/version, and model/schema identity separately. A `NO_DATA_DEFAULT` value of zero must never overwrite an observed null. Do not fabricate a transformation for a skipped model run. Capture artifact-side transformations too, where applicable.

Use `PERCENTAGE` plus `ZERO_TO_ONE`/`ZERO_TO_ONE_HUNDRED`, `COUNT`, `GRADE_POINTS`, or `SCORE_OUT_OF_100` as appropriate. Formatting is derived, never authoritative. Keep compatibility fields unambiguous during API rollout.

Rename behavioral engagement to **Learning participation indicator**. Snapshot its component values, availability, configured weights, normalized effective weights, and formula version. Current defaults are 40% attendance, 35% punctuality, and 25% completion. Missing components are omitted and weights redistributed; all missing means unavailable. Validate finite component ranges and nonnegative weights with positive available total. The resulting range must be 0–100.

Attendance affects the current risk engine through this composite; it is not a standalone attendance-threshold rule. Save this dependency explicitly. Do not describe attendance as a direct grade-model input or a separately triggered risk rule. Source grades, completion, and trends can have multiple actual uses; grade-model permission is not itself evidence of execution.

## 5. Immutable executions and exact rule traces

Use one new prediction ID per execution/regeneration, with an immutable `supersedes_prediction_id` link and logical series identity. Add a one-to-one, versioned evidence snapshot containing scope, source values/identities, observed metrics, transformations, actual usage, calculation/configuration versions, and rule evaluations. Save the output and complete snapshot atomically.

For the later append-only phase, prevent ordinary updates/deletes to prediction outputs, feature audit rows, and snapshots. Before adding database enforcement, define exceptional administrative/migration repair with explicit authorization, before/after payloads, reason, operator, timestamp, and audit record; prefer corrective successor records. Do not depend on a JSON hash alone for immutability. References to mutable source/configuration records must not cascade-delete historical audit payloads. Teacher reviews, interventions, and later outcome evaluations remain separate records linked to the exact prediction ID.

Proposed series key: `(student_id, class_id, subject_id, source_period_id, target_period_id, prediction_purpose)`. Academic year is validated through periods/class; model version and cutoff identify executions, not new series. Purpose is a controlled domain identifier. A shared selector defines latest by committed generation timestamp then prediction ID. Validate this key against all consumers before migration; inventory dashboards, alerts, interventions, adviser/teacher views, exports, reports, outcome/performance cohorts, jobs, and constraints first.

Replace `replace_existing` behavior with creation of a successor execution. Migrate callers, cohort scripts, and import paths. Idempotent retries return the original saved output AND saved trace without rescoring or mixing current reasons into old results. Add a unique idempotency constraint; test concurrent retries.

Dashboard/list/count queries must select the latest execution per logical student/class/subject/source/target prediction series before aggregating. Detail links continue to resolve historical IDs. Reviews and assigned interventions are not silently copied onto successors. Outcomes retain execution identity; define explicit latest-only versus all-execution evaluation cohorts to avoid inflating performance summaries.

Persist stage execution states and per-feature consumed inputs. Separate readiness checks, grade model execution, and risk evaluation. A failed readiness gate stores why the model and downstream risk stage were skipped; it does not fabricate risk-rule evaluations.

Each evaluated rule trace includes identifier, immutable rule version, operator, thresholds, actual evaluated input values/states, triggered result, and linked feature IDs. Compound rules preserve all predicates. Non-evaluated rules use a skipped/not-applicable status with reason, not `triggered: false`. Save calculation/configuration contents or a durable immutable version, not only today's configuration row ID.

Teacher explanations read these saved traces. Neither the detail API nor a frontend registry reruns old evidence against current rules. Keep interpretation separate from observed evidence and show no invented numeric attribution or causal claims.

## 6. Teacher presentation and legacy migration

The detail API exposes a teacher evidence collection distinct from outputs and internal model encodings. Static display metadata may come from the catalog, but historical source, scope, usage, and interpretation come only from the execution snapshot. Retain a semantic catalog version so a future definition change cannot reinterpret an old measurement.

| Identifier | Teacher label / handling |
| --- | --- |
| assessment_completion_rate | Activities completed |
| data_coverage_ratio | Activities with recorded grades |
| missing_activity_count | Missing activities only when non-completion is established; otherwise show unknown/unrecorded status |
| late_submission_count | Late submissions |
| risk_adjusted_attendance_rate | Attendance score; disclose weighted status calculation |
| behavioral_engagement_score | Learning participation indicator |
| source_period_grade | Official / recorded provisional / calculated running / estimated grade, with source period name |
| grade_trend_vs_previous_period | Grade change since previous period, in points, with provenance of both grades |
| predicted_period_grade | Prediction summary only; never input evidence |
| subject encodings and normalized period sequence | Explicitly internal; meaningful subject/period already appears in context |

Remove Direction from `prediction-detail-sheet.tsx`. Each row shows measurement, source/denominator, and actual use; an optional separate interpretation shows saved triggered rules. Definitions must work by keyboard/touch, not hover alone. Wrap labels and test the narrow sheet layout.

Expand migrations additively. Old predictions remain readable through a legacy adapter with **Source details unavailable for this saved prediction.** Preserve raw values; do not infer denominators, source categories, execution usage, or historical rule results from today's records. Do not reuse the current explanation service's newly evaluated thresholds as historical explanations. Known measurement units alone do not prove availability or provenance.

Inventory unknown legacy features and normalize only verified aliases. New persistence fails on unregistered fields; legacy reads remain available and emit diagnostics. New records with incomplete provenance must be classified accordingly, including caller-supplied inputs and imports.

## 7. Acceptance fixtures and release gates

The requested Student A fixture combines zero completion with sufficient model evidence, which conflicts with current readiness rules. Both readiness and RiskEngine flag completion below 50%. Preserve that policy. Phase 1 defines A/B/C plus failure fixture D and clarifies that future exclusions refer to unavailable activities, not automatically every future due date.

| Fixture | Setup | Expected complete flow |
| --- | --- | --- |
| A: observed zero | 10 eligible activities with confirmed non-completion, 2 future activities excluded, previous finalized grade 82; attendance: 8 present, 1 excused, 1 late | Activities completed **0% — 0 of 10**; attendance **93/100**; previous grade explicitly official; model skipped because completion is below 50% (and other true readiness reasons); saved readiness interpretation, no fabricated downstream rule trace |
| B: unavailable | No eligible activities, previous grade, or attendance records | Activity/attendance/grade measurements unavailable with specific states; no fake 0%; model skipped with saved reason |
| C: model executes | 10 eligible activities, 8 completed and graded, 2 confirmed not completed; future items excluded; source and previous grade evidence and all registered model inputs available | Completion/coverage **80% — 8 of 10**; saved model version and ordered inputs show actual execution; deterministic test model returns 84; saved missing-activity rule triggers at count >= 2; interpretation uses that exact trace |
| D: extraction/persistence failure | Failure during extraction, then a separate injected failure after prediction insert but before snapshot completion | No visible partial prediction or orphan evidence; rollback preserves any existing record; retry with the same idempotency key produces exactly one complete result |

Run each through real record creation, feature calculation, persistence, authenticated detail retrieval, and frontend rendering. Use a small deterministic test model to make model execution reproducible; add a browser integration fixture that exercises the backend response rather than only a hand-written API mock.

Required semantic/integration checks:

- Zero graded score and zero finalized grade remain valid; no prior period stays unavailable.
- Shared grading calculation matches gradebook/submission results for identical records/configuration, including custom templates, exam subtypes, missing components, transmutation, and overridden official grades.
- One activity represented by assessment plus classwork counts once. Multiple attempts count once; conflicting representations cannot silently select an arbitrary grade.
- Out-of-period, out-of-year, other-subject/class/student, unpublished, future, exempt, and post-cutoff records are excluded with traceable reasons. Unresolved mappings do not yield trusted percentages.
- Null observed value remains null even when an allowed preprocessing transformation supplies zero.
- Training, registration, runtime scoring, and reconstruction reject outputs, targets, risk-only, display-only, and unknown model inputs; alias bypass attempts fail.
- All newly persisted features have catalog entries. Internal fields and prediction outputs never appear in the evidence panel.
- Saved rule thresholds/inputs and actual execution usage remain unchanged after model, weights, or rules are changed.
- Editing attendance/scores/due dates/templates cannot alter an old snapshot or detail interpretation. Regeneration creates a new ID and leaves old links, reviews, interventions, and evidence intact.
- Legacy records survive migration without inferred provenance; unknown identifiers produce diagnostics rather than a fabricated explanation.
- Idempotent and concurrent retries do not create duplicate executions or return mixed old/new results. Transaction failure leaves no partial snapshot.

Compatibility release requirement:

1. Capture fixed, de-identified representative input datasets: zero/no-data, varied subjects/templates, quarter and term configurations, partial grading, multiple attempts, duplicates, future work, attendance gaps, and grade/risk boundaries.
2. Run frozen old and new builders on identical inputs without modifying saved production predictions. Do not treat current mutable records as an authentic historic replay unless revisions exist.
3. Report old/new availability counts, distributions, quantiles, and paired differences for completion, coverage, participation, source grade, predicted grade, and risk level. Include scoring-skipped transitions and a risk transition matrix.
4. Classify differences as expected/approved, serialization-only, intended semantic correction, or unexplained regression. The Phase 1 document defines numeric tolerances and boundary exceptions. Unexplained regressions block release; intended corrections need a reproducible explanation and compatibility assessment. Aggregate averages are insufficient.
5. Associate changed feature semantics with a new calculation contract/model compatibility version. Evaluate whether retraining is required; activation is blocked until compatibility is established. Do not claim historical validation if representative data are unavailable.
6. Roll out new execution generation behind a version/feature gate. Rollback disables new generation while preserving already-created snapshots and historical readability.

## Delivery order and affected modules

This table describes the eventual architecture, not a single release. Phase 1 has its own reduced order and four versioned contracts: evidence, grade calculation, model, and risk ruleset. Helper identifiers/configuration values belong inside those contracts rather than gaining independent version numbers.

| Stage | Work | Completion gate |
| --- | --- | --- |
| 1 | Catalog, validators, baseline fixtures, shared grading extraction | Model eligibility failures and grade parity tests pass |
| 2 | Canonical LearningActivity schema, explicit period/expected time, creation/import links, reconciliation report | Deterministic eligibility and deduplication tests pass; unresolved scopes are visible |
| 3 | Scoped evidence builder, grade provenance, participation correction, observed/transformed separation | Exact denominators, availability, and grade-source tests pass |
| 4 | Execution/snapshot migrations, append-only persistence, rule traces, regeneration and dashboard version selection | Immutability, idempotency, legacy migration, and historical link tests pass |
| 5 | Read schemas/API and teacher detail sheet | A/B/C end-to-end scenarios and narrow-screen accessibility checks pass |
| 6 | Old/new compatibility report and controlled activation | Every material change accounted for; model compatibility established |

Existing modules to modify include the prediction builder/scorer/persistence/read/explanation services; RiskEngine; dataset training/validation and model registration; StudentRecordService and grade tests; assessment/classwork/submission source models and writers; prediction schemas/models/migrations; cohort/import scripts; dashboard/performance/outcome selection; frontend prediction API types and detail sheet.

Suggested new modules are `FeatureCatalog.py`, `PredictionEvidenceScope.py`, a shared student-record `GradeCalculationService.py`, and versioned execution/snapshot models. These are proposed filenames, not existing implementations.

No database migration, prediction regeneration, model retraining, or deployment has been run as part of writing this plan.

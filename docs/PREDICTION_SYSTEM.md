# Entervene Prediction System

**Document role:** Canonical technical and evidence reference

**Verified against the repository:** 2026-11-18

**Defense companion:** [`../ML_handoff/PREDICTION_SYSTEM_CAPSTONE_DEFENSE.md`](../ML_handoff/PREDICTION_SYSTEM_CAPSTONE_DEFENSE.md)

This document and the capstone-defense companion form one documentation set. This file is the source of truth for implementation details and evidence. The defense document summarizes these facts; it must not introduce a different prediction target, runtime path, or accuracy claim.

"Verified" means that the repository implementation or checked-in evidence was inspected. It does not mean that the model is independently validated for production use.

## 1. System in one sentence

Entervene estimates a student's **final grade in the same active academic term** from the graded Written Work (WW), Performance Task (PT), and Quarterly Assessment (QA) evidence currently recorded for that student, then maps the numeric estimate to a deterministic intervention band.

The operational model purpose is:

```text
CURRENT_TERM_FINAL_GRADE_PROJECTION
source_period_id == target_period_id
```

It is not a next-term forecast, a probability of failure, a diagnosis, or an autonomous intervention decision.

## 2. Current architecture

```text
Teacher records or updates a grade
              |
              v
Post-commit prediction refresh gate
              |
              v
Scope, lifecycle, finalized-grade, domain, and readiness checks
              |
              v
31-feature same-term evidence row
              |
              v
RandomForestRegressor -> projected final grade
              |
              v
Fixed grade thresholds -> intervention level
              |
              v
Append-only revision with immutable evidence snapshot
              |
              v
Stable read API -> Admin and Teacher prediction pages
```

The model estimates a number. The intervention level is assigned afterward by application code. Attendance and engagement may be retained as supporting context, but they do not change the current-term model's 31-feature vector or its intervention band.

## 3. Runtime contracts

| Contract | Purpose | Mutability | Access and lifecycle |
| --- | --- | --- | --- |
| `GET /api/v1/current-term-predictions/scope` | Resolve valid Admin prediction scopes | Read only | Admin; based on active/published subject loads |
| `GET /api/v1/current-term-predictions` | Read latest current-term rows for a class, subject, and period | Read only | Admin or assignment-authorized Teacher; exactly one approved production model |
| `GET /api/v1/current-term-predictions/export-csv` | Export the stable current-term view | Read only | Same production lifecycle and scope rules |
| `GET /api/v1/development/current-term-predictions` | Inspect isolated development rows | Read only | Development/test only with the feature flag enabled |
| `POST /api/v1/development/current-term-predictions` | Explicitly generate a development row | Write | Automated test environment only |
| `GET /api/v1/predictions/...` | Read historical `ai_prediction` records and evidence | Read only | Historical/archive contract; no current HTTP writer |

The routers are mounted in `backend/app/main.py`. The historical router in `backend/app/api/v1/routes/Predictions.py` contains only `GET` handlers. Its retained next-period services and rows support audit/history and are not the active UI scoring path.

The current frontend prediction pages call the stable current-term contract through `frontend/src/lib/prediction-api.ts` and `frontend/src/components/predictions/current-term-dashboard-adapter.ts`. Consumers include the Teacher prediction, grade, section, and subject pages. The development panel still exists as an isolated component, but it is not evidence that development generation is enabled in a normal development, demo, or production deployment.

## 4. End-to-end behavior

### 4.1 Grade changes and refresh

After a successful grade-related commit, the activity, submission, quiz-attempt, and quiz-analysis services can call `DevelopmentGradeRefreshService`. The refresh is guarded:

- In development/test, it runs only when the development feature is enabled and the selected model is the corrected official-target candidate.
- In production, it runs only when exactly one current-term model passes all production lifecycle requirements.
- Failures are logged and do not turn an unsuccessful prediction refresh into a successful grade mutation.

There is no general scheduled job that continuously predicts every enrolled student.

### 4.2 Scope and eligibility

`DevelopmentCurrentTermPredictionService` and `CurrentTermV3Domain` require:

- source and target period are the same;
- an active academic year and active academic period;
- an active/published subject load for the class and subject;
- a real student/class/subject relationship;
- matching student and class academic levels;
- no finalized grade for the same term;
- a supported grade/domain and grading-weight pattern; and
- enough resolved academic evidence.

A finalized same-term grade blocks a new projection because an official outcome is already available.

### 4.3 Feature construction

`CurrentPeriodFeatureBuilderService` reads eligible, graded, non-archived, non-reading classwork for the exact student, class, subject, and period. It resolves WW, PT, and QA evidence, including the existing remedial-exam behavior, and builds exactly 31 ordered inputs:

```text
grade_level
ww_weight, pt_weight, qa_weight
ww_available_activity_count, pt_available_activity_count,
qa_available_activity_count, overall_available_activity_count
ww_points_earned_so_far, ww_points_possible_so_far,
ww_percent_so_far, ww_weighted_score_so_far
pt_points_earned_so_far, pt_points_possible_so_far,
pt_percent_so_far, pt_weighted_score_so_far
qa_points_earned_so_far, qa_points_possible_so_far,
qa_percent_so_far, qa_weighted_score_so_far
observed_component_weight_sum, overall_weighted_score_so_far,
overall_partial_percent
ww_has_evidence, pt_has_evidence, qa_has_evidence,
has_any_input_evidence
ww_score_over_hps_count_so_far, pt_score_over_hps_count_so_far,
qa_score_over_hps_count_so_far
subject
```

Identity fields, the target grade, finalized grades, attendance, engagement, and intervention labels are not model inputs. Supported WW/PT/QA weight patterns are 20/50/30 and 20/60/20. Other patterns fail the domain contract instead of being silently transformed.

### 4.4 Readiness

Readiness is a code-level eligibility gate, not a confidence score.

| Level | Exact rule | Scoreable? |
| --- | --- | --- |
| `HIGH_EVIDENCE` | At least 7 activities, WW/PT/QA evidence, 100% component weight observed, no unresolved evidence | Yes |
| `STANDARD_READY` | At least 4 activities, WW and PT evidence, at least 70% component weight observed, no unresolved evidence | Yes |
| `LIMITED_EVIDENCE` | Exactly 3 activities with WW and PT evidence and no unresolved evidence | No |
| `INSUFFICIENT_EVIDENCE` | Any other state | No |

Reason codes identify unresolved evidence, too few activities, missing WW/PT evidence, or insufficient observed component weight. Only `STANDARD_READY` and `HIGH_EVIDENCE` reach model scoring.

### 4.5 Scoring and intervention band

`DevelopmentCurrentTermScoringService` rejects leakage/identity fields, requires the exact ordered schema and compatible types, verifies model purpose/target/artifact/schema/lifecycle, loads the joblib pipeline, and returns one finite number from `model.predict()`.

The scorer does not produce a probability or confidence. Its output is not clipped before `DevelopmentCurrentTermRiskService` validates a 0-100 value and applies:

| Projected grade | Intervention level | Meaning |
| ---: | --- | --- |
| `< 75` | `HIGH_RISK` | Highest support priority |
| `75 to < 85` | `MODERATE_RISK` | Moderate support priority |
| `85 to < 90` | `NEEDS_MONITORING` | Monitor progress |
| `>= 90` | `LOW_RISK` | Lowest support priority |

`risk_score` is intentionally null for current-term rows. The band is not a probability of failing.

### 4.6 Persistence and revisions

`DevelopmentCurrentTermPredictionPersistenceService` saves the academic scope, model version, projected grade, intervention level, revision, generation time, and an immutable evidence snapshot containing readiness, features, and model/schema/artifact identity.

The database enforces same-term semantics and a positive revision. A serialized transaction rechecks freshness and eligibility. Unchanged material evidence reuses the latest revision; changed evidence or a changed valid model contract creates a new revision. Reads select the latest revision within the selected model version, so histories from different models are not blended.

## 5. Model selection and lifecycle

### 5.1 Development allowlist

`DevelopmentCurrentTermModelSelection.py` permits only:

- `entervene_current_term_development_rf_v3`
- `entervene_current_term_official_target_rf_candidate`

The code default is legacy V3. The isolated demo configuration selects the corrected official-target candidate. An unknown selector fails closed. Development scoring requires an inactive `DEVELOPMENT` registry row that is not production validated. Development code does not automatically promote a model.

### 5.2 Production gate

`get_production_model_versions()` requires all of the following for `CURRENT_TERM_FINAL_GRADE_PROJECTION`:

- lifecycle is `PRODUCTION`;
- `is_active` is true;
- `production_validated` is true; and
- `independent_three_term_validation` is true.

The stable API and production refresh require **exactly one** such model. Zero or multiple matches fail closed. No checked-in evidence establishes that a real deployment currently has a qualifying production row. Repository capability must not be described as confirmed deployment state.

## 6. Domain support

The runtime accepts Grades 7-12 but does not assign the same evidence status to all scopes. Exact catalog tuples mapped as `VALIDATED_JHS` in code are:

| Grade | Subject code | Subject name |
| ---: | --- | --- |
| 7 | `MATH7` | Mathematics 7 |
| 7 | `SCI7` | Science 7 |
| 7 | `ENG7` | English 7 |
| 8 | `ENG8` | English 8 |
| 9 | `ENG9` | English 9 |
| 10 | `MATH10` | Mathematics 10 |
| 10 | `SCI10` | Science 10 |

Other identifiable JHS categories are provisional. SHS Grades 11-12 are explicitly provisional/unvalidated.

Important distinction: `VALIDATED_JHS` is a runtime catalog/domain label. It does **not** mean every tuple has an exact historical grade-subject holdout. In the official-target evaluation, only ENG7 and MATH10 among these mapped pairs have exact grade-subject historical sources.

## 7. Training data and target integrity

### 7.1 Historical source

The corrected official-target research set was reconstructed from 14 historical JHS workbooks:

- 1,865 distinct student-period outcomes;
- 467 pseudonymous students;
- 5,595 partial-evidence snapshots at 25%, 50%, and 75%;
- 1,209 outcomes using 20/50/30 and 656 using 20/60/20; and
- Grades 7-10 across English, Mathematics, Science, ICT, and Creative Technology.

Snapshot stages use workbook column order, not verified assessment timestamps. The source is older quarter-based data, not an independent cohort from the current three-term implementation.

### 7.2 Outcome distribution

| Official grade range | Count |
| --- | ---: |
| `< 75` | 0 |
| `75-79` | 0 |
| `80-84` | 78 |
| `85-89` | 367 |
| `>= 90` | 1,420 |

High-risk detection cannot be evaluated from this data. Regression error and band agreement do not establish recall for failing students.

### 7.3 Legacy V3 warning

The legacy V3 report lists test MAE 1.5714, RMSE 2.4442, and R-squared 0.6993. Those values must **not** be presented as official-grade accuracy. The target-integrity audit found mixed labels: official grades for 20/60/20 records and reconstructed/interpolated labels for most 20/50/30 records. The corrected candidate uses the stored historical Quarterly Grade as its target.

## 8. Corrected candidate evaluation

The canonical offline comparison uses leave-one-workbook-out historical evaluation. Fold-trained models use the candidate architecture, but this is not an external blind test of the local artifact or current three-term learners.

| Historical slice | N | Random Forest MAE | Linear Regression MAE | Interpretation |
| --- | ---: | ---: | ---: | --- |
| Seen-subject, all stages | 5,187 snapshots | 1.6007 | 1.6664 | Small overall RF advantage |
| Seen-subject, latest 75% | 1,729 periods | 0.7670 | 1.0355 | Best late-evidence result; not early-term accuracy |
| Exact-live, all stages | 2,019 snapshots | 1.8698 | **1.7797** | Linear Regression is better |
| Exact-live, latest 75% | 673 periods | **1.0913** | 1.1325 | Small RF advantage |
| Seen-subject, first feature-ready | 1,600 periods | **1.5443** | 1.6866 | Offline readiness replay |
| Exact-live, first feature-ready | 611 periods | 2.0013 | **1.9528** | Linear Regression is better |

At 25% evidence, Linear Regression is generally stronger. At 50%, results are close and the exact-live subset favors Linear Regression. At 75%, the Random Forest is strongest in the reported comparisons. All-stage rows from one period are correlated, R-squared is not classification accuracy, and reported band agreement is not proof of failure detection.

The defensible conclusion is that the Random Forest is a research candidate whose error improves with more evidence. It has not shown a consistent material advantage over a simpler baseline across the most deployment-relevant slices.

Primary evidence: `docs/V3_TARGET_INTEGRITY_4H.md`, `docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md`, `docs/RANDOM_FOREST_DEFENSE_4J.md`, and the related builders/evaluators under `backend/app/ml/`.

## 9. What is dynamic

The system is dynamic in these bounded ways:

- Features come from the selected student's persisted academic evidence, not UI mock data.
- An eligible grade change can trigger a guarded post-commit refresh.
- Changed eligible evidence creates a new prediction revision.
- Admin scope comes from active/published subject loads.
- Teacher access is constrained to assigned academic scope.
- The UI aggregates current-term rows by grade, class, subject, and intervention level.

It does not retrain when a grade changes, choose arbitrary model files, switch between current-term and next-term targets, score when a gate fails, or infer production deployment from a checked-in artifact.

## 10. Privacy, fairness, and reliability limits

Verified safeguards include role/scope authorization, exact feature order, deterministic thresholds, readiness/domain gates, immutable snapshots, and grouped historical evaluation.

Unresolved risks include:

- no failing examples in the corrected dataset;
- no independent current three-term cohort;
- no protected-group or relevant subgroup error analysis;
- five of seven runtime JHS mappings without exact grade-subject holdouts;
- provisional/unvalidated SHS scope;
- teacher recording and grading-template differences;
- much better late-evidence than early-evidence error;
- readiness affecting who becomes scoreable; and
- activity order standing in for real assessment time.

Pseudonymous research identifiers do not replace production retention, access, consent, and school-policy controls. The system cannot currently be called unbiased, failure-calibrated, or production-validated.

## 11. Safe and unsafe claims

| Claim | Status |
| --- | --- |
| Active architecture predicts the final grade for the same term | **Verified** |
| The model consumes 31 academic evidence features | **Verified** |
| The regressor and deterministic intervention rule are separate | **Verified** |
| The UI reads the stable current-term API | **Verified in repository code** |
| Eligible evidence changes can refresh predictions | **Verified, subject to all gates** |
| Corrected historical metrics in Section 8 match checked-in evidence | **Supported; full retraining not rerun for this edit** |
| The system accurately detects failing students | **Unsupported** |
| Random Forest is proven better than Linear Regression | **Unsupported** |
| All Grades 7-12 and subjects are empirically validated | **Unsupported** |
| A production model is currently deployed | **Not established** |
| Risk level is failure probability or confidence | **False** |
| Legacy V3 metrics measure official-grade accuracy | **False** |
| Historical next-period rows are current-term predictions | **False** |

## 12. Production acceptance criteria

Before live activation or production claims, require:

1. Reproducible artifact, schema, registry, and hash provisioning from a clean checkout.
2. Independent completed outcomes from the current three-term system.
3. Enough naturally occurring lower-grade/failing cases to measure false negatives and sensitivity.
4. A predeclared grouped comparison with Linear Regression and a verified academic baseline.
5. Gradebook, exam, remediation, and transmutation parity against official records.
6. Separate validation for provisional subjects and SHS.
7. Data-sufficiency and subgroup fairness analysis, including readiness exclusions.
8. Passing authorization, lifecycle, revision, backend, frontend, and browser gates.
9. A documented human review/response policy.
10. A separate promotion decision creating exactly one valid production registry row.

## 13. Code authority map

| Concern | Authority |
| --- | --- |
| Router mounting | `backend/app/main.py` |
| Stable reads | `backend/app/api/v1/routes/CurrentTermPredictions.py` |
| Isolated development API | `backend/app/api/v1/routes/DevelopmentCurrentTermPredictions.py` |
| Historical GET-only API | `backend/app/api/v1/routes/Predictions.py` |
| Same-term orchestration | `backend/app/services/prediction/DevelopmentCurrentTermPredictionService.py` |
| Features/readiness | `backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py` |
| Domain mapping | `backend/app/services/prediction/CurrentTermV3Domain.py` |
| Schema/artifact scoring | `backend/app/services/prediction/DevelopmentCurrentTermScoringService.py` |
| Intervention thresholds | `backend/app/services/prediction/DevelopmentCurrentTermRiskService.py` |
| Revisions/snapshots | `backend/app/services/prediction/DevelopmentCurrentTermPredictionPersistenceService.py` |
| Latest-revision reads | `backend/app/services/prediction/DevelopmentCurrentTermPredictionReadService.py` |
| Grade-change refresh | `backend/app/services/prediction/DevelopmentGradeRefreshService.py` |
| Production lifecycle | `backend/app/services/prediction/ModelVersionService.py` |
| Registry/purpose | `backend/app/models/ai/AIModelVersion.py` |
| Persisted row | `backend/app/models/ai/DevelopmentCurrentTermPrediction.py` |
| Frontend contract | `frontend/src/lib/prediction-api.ts`; `frontend/src/components/predictions/current-term-dashboard-adapter.ts` |
| Target/evaluation audit | `docs/V3_TARGET_INTEGRITY_4H.md`; `docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md`; `docs/RANDOM_FOREST_DEFENSE_4J.md` |

## 14. Verification scope

This revision reconciled both prediction documents with route decorators, service gates, model lifecycle fields, persisted-row constraints, feature/readiness code, the frontend current-term adapter, checked-in schema, and evaluation reports.

It did not retrain a model, mutate a registry, query a real deployment, or perform new external validation. Local ignored artifacts and database contents can differ between environments and must be checked before deployment-specific claims.

# Entervene Prediction System: Capstone Defense Guide

**Verified against the repository:** 2026-11-18

**Canonical technical source:** [`../docs/PREDICTION_SYSTEM.md`](../docs/PREDICTION_SYSTEM.md)

This is the presentation and question-answer companion to the canonical prediction-system document. If a detail here appears ambiguous, use the canonical document and current code. Do not revive the former next-period runtime description: that path is now a GET-only historical archive.

## 1. Recommended opening statement

> Entervene uses a current-term final-grade projection to support early academic intervention. When a student has enough recorded Written Work and Performance Task evidence, the backend builds a fixed 31-feature academic snapshot and a Random Forest regressor estimates the student's final grade for that same term. Application code then maps that grade to a transparent intervention band. The result is revisioned with its evidence and shown to authorized administrators and teachers. It is decision support, not an automatic judgment, a failure probability, or a production-validated model.

## 2. The single prediction objective

The correct answer to "What does the system predict?" is:

> It estimates the student's eventual official grade in the **same active term**, using partial evidence already recorded in that term.

In code:

```text
Purpose: CURRENT_TERM_FINAL_GRADE_PROJECTION
Source period: same as target period
Output: one numeric projected grade
```

Do not answer "next term." The repository retains earlier next-period services, artifacts, and `ai_prediction` rows for history and audit, but `/api/v1/predictions` has only GET routes and is not the active scoring path.

## 3. Defense flow

```text
Graded WW/PT/QA evidence
          |
          v
Eligibility and readiness checks
          |
          v
Exact 31-feature row
          |
          v
Random Forest numeric projection
          |
          v
Fixed intervention thresholds
          |
          v
Revision + evidence snapshot
          |
          v
Authorized Admin/Teacher views
```

Suggested explanation:

1. A teacher records or changes a grade.
2. After the successful commit, a guarded refresh may run.
3. The backend verifies the active term, real academic scope, model lifecycle, supported domain, absence of a finalized grade, and readiness.
4. It aggregates only eligible evidence from the exact student/class/subject/period.
5. The model estimates a final grade.
6. A separate deterministic rule assigns the intervention level.
7. The system saves a new revision only if material evidence changed.
8. The stable current-term API supplies authorized prediction pages.

## 4. When a prediction can appear

Only these readiness states are scoreable:

| Readiness | Rule | Result |
| --- | --- | --- |
| `STANDARD_READY` | At least 4 activities, WW and PT evidence, at least 70% observed component weight, no unresolved evidence | Score |
| `HIGH_EVIDENCE` | At least 7 activities, WW/PT/QA evidence, 100% observed weight, no unresolved evidence | Score |
| `LIMITED_EVIDENCE` | Exactly 3 activities with WW and PT evidence | Do not score |
| `INSUFFICIENT_EVIDENCE` | Remaining states | Do not score |

Other gates include:

- source period equals target period;
- year and period are active;
- subject load is active/published;
- student and class grade levels match;
- WW/PT/QA weights are 20/50/30 or 20/60/20;
- subject/grade scope is supported; and
- no official same-term grade has already been finalized.

Defense point: **readiness is eligibility, not model confidence**.

## 5. What enters the model

The 31 inputs cover:

- grade level and normalized subject category;
- WW/PT/QA template weights;
- activity counts per component and overall;
- points earned and possible;
- component percentages and weighted scores;
- observed weight and partial overall score;
- evidence-present flags; and
- counts of scores that exceeded the stated highest possible score.

What does not enter the current-term model:

- student name, ID, email, or other identity fields;
- the final target grade;
- a finalized grade from the same term;
- attendance;
- behavioral engagement;
- intervention labels; or
- historical next-period risk fields.

Attendance/engagement may be stored as context, but they do not alter the current-term feature vector or deterministic band.

## 6. Why Random Forest, and the honest limitation

Random Forest was evaluated because it can represent nonlinear interactions among partial grade evidence without requiring one fixed linear relationship. The current implementation uses `RandomForestRegressor`, so its direct output is a grade, not a class label.

The honest model-selection answer is:

> The Random Forest is a research candidate, not a universally superior model. It has a small overall advantage on some historical slices and performs best with later evidence, but Linear Regression is better on several early and exact-live comparisons. Production approval therefore requires independent three-term validation and a predeclared baseline comparison.

Do not justify the model only with feature importance. Importance does not prove causal contribution, fairness, or better deployment performance.

## 7. Training data

The corrected official-target research set contains:

- 14 historical JHS workbooks;
- 467 pseudonymous students;
- 1,865 student-period official outcomes; and
- 5,595 reconstructed snapshots at 25%, 50%, and 75% evidence.

It covers historical Grades 7-10 records in English, Mathematics, Science, ICT, and Creative Technology, with 20/50/30 and 20/60/20 weight patterns.

The snapshots use assessment column order because reliable historical timestamps were unavailable. The data is older quarter-based history, not an external sample from the current three-term system.

### Target-integrity correction

The older V3 model mixed official and reconstructed target meanings. Therefore its MAE 1.5714, RMSE 2.4442, and R-squared 0.6993 must not be quoted as official-grade performance.

The corrected candidate uses the stored historical Quarterly Grade as the official target. The capstone should use the corrected evaluation below.

## 8. Accuracy evidence

MAE is the average absolute difference in grade points. Lower is better.

| Historical slice | Random Forest MAE | Linear Regression MAE | Winner |
| --- | ---: | ---: | --- |
| Seen-subject, all stages | **1.6007** | 1.6664 | RF, small margin |
| Seen-subject, latest 75% | **0.7670** | 1.0355 | RF |
| Exact-live, all stages | 1.8698 | **1.7797** | Linear |
| Exact-live, latest 75% | **1.0913** | 1.1325 | RF, small margin |
| Seen-subject, first-ready | **1.5443** | 1.6866 | RF |
| Exact-live, first-ready | 2.0013 | **1.9528** | Linear |

Correct interpretation:

- Error improves as more evidence becomes available.
- Late-stage results must not be advertised as early-warning accuracy.
- The simple baseline remains competitive and sometimes better.
- These are grouped historical comparisons, not a new independent production test.
- Multiple stages from the same student-period are correlated.

## 9. Why the system cannot claim failure detection

The corrected set's official outcome distribution is:

| Grade band | Count |
| --- | ---: |
| `< 75` | 0 |
| `75-79` | 0 |
| `80-84` | 78 |
| `85-89` | 367 |
| `>= 90` | 1,420 |

There are no failing examples. Therefore the defense must say:

> We measured historical regression error, but we could not measure sensitivity, false-negative rate, or calibration for failing students. The intervention labels are projected-grade bands, not validated failure classifications.

Do not turn the reported band agreement into a claim of high-risk recall.

## 10. Intervention levels

The model does not output these labels. Application code applies:

| Projected grade | Level |
| ---: | --- |
| `< 75` | `HIGH_RISK` |
| `75 to < 85` | `MODERATE_RISK` |
| `85 to < 90` | `NEEDS_MONITORING` |
| `>= 90` | `LOW_RISK` |

Preferred defense wording:

> We use transparent grade thresholds to prioritize review. They are deterministic support bands and can be explained directly. They are not model confidence or the probability that a learner will fail.

The current-term `risk_score` field is null by design.

## 11. Is the system dynamic?

Yes, within strict boundaries:

- It queries real persisted grade evidence for the selected scope.
- Eligible grade updates can trigger a post-commit refresh.
- Changed evidence produces a new revision.
- Admin scopes come from active/published subject loads.
- Teacher views are constrained to assigned scopes.
- Dashboard summaries are computed from current-term API rows.

No, in these senses:

- It does not retrain on every grade update.
- It does not freely select an arbitrary model.
- It does not switch between current-term and next-term objectives.
- It does not bypass readiness or finalized-grade rules.
- A checked-in artifact does not prove that production has activated it.

## 12. Development versus production

### Development candidate

Only two names are allowlisted, and the corrected official-target candidate remains an inactive `DEVELOPMENT` model. An unknown name fails closed. Explicit development POST generation is restricted to automated tests.

### Production

The stable API requires exactly one model for the current-term purpose with:

- lifecycle `PRODUCTION`;
- active status;
- production validation; and
- independent three-term validation.

Zero or multiple qualifying rows return failure instead of choosing silently. Repository inspection proves this gate exists; it does not prove that a live deployment currently has an approved model.

## 13. Supported scope

The code has seven exact JHS catalog mappings: MATH7, SCI7, ENG7, ENG8, ENG9, MATH10, and SCI10. Other JHS categories and all SHS scope are provisional to different degrees.

Important answer if challenged:

> The runtime label `VALIDATED_JHS` means the catalog tuple is explicitly mapped and allowed by the domain contract. It does not mean every pair has a matching historical accuracy study. Among those seven mapped pairs, only ENG7 and MATH10 have exact grade-subject historical sources in the checked-in evaluation.

Never claim that Grades 7-12 are all empirically validated.

## 14. Auditability and authorization

Each persisted result records the exact academic scope, model version, projected grade, intervention level, revision, and immutable evidence snapshot. Unchanged evidence reuses the latest revision; material changes append a revision.

Admin reads use resolved active/published scopes. Teacher reads require assignment authorization. A finalized official grade blocks another same-term projection.

This design supports reproducibility and review, but it does not itself prove that the model is fair or accurate.

## 15. Main limitations to volunteer

1. No failing examples in the corrected target data.
2. No independent current three-term validation cohort.
3. Historical timing reconstructed from column order.
4. Linear Regression wins some deployment-relevant slices.
5. Most runtime mappings lack exact grade-subject holdouts.
6. SHS is provisional/unvalidated.
7. No protected-group or relevant subgroup fairness evaluation.
8. Readiness may exclude students with sparse or late-recorded evidence.
9. Prediction output is not clipped before the risk service's 0-100 validation.
10. Production activation state cannot be inferred from repository files alone.

Volunteering these limitations strengthens the defense because it shows the evaluation boundaries are understood.

## 16. Safe claims

- The current implementation has one operational objective: same-term final-grade projection.
- It uses a 31-feature academic evidence contract and `RandomForestRegressor`.
- It scores only after explicit readiness and scope checks.
- The intervention level is a deterministic rule separate from ML.
- Current Admin/Teacher prediction pages use the stable current-term read API.
- Evidence/model changes are revisioned with an immutable snapshot.
- The corrected historical evaluation uses official Quarterly Grade targets.
- The Random Forest improves with later evidence but is not consistently superior to Linear Regression.
- The architecture fails closed when the production model lifecycle is ambiguous.

## 17. Claims to avoid

- "The model predicts next term."
- "The risk score is the probability of failing."
- "The model is 89.30% accurate at detecting at-risk students."
- "The model detects failures reliably."
- "Random Forest is proven better than simpler models."
- "Attendance and behavior are current-term model inputs."
- "All Grades 7-12 and all subjects are validated."
- "The model is unbiased."
- "The system is already production validated/deployed."
- "The legacy V3 metrics are official-grade accuracy."
- "The model retrains automatically after each grade."

## 18. Likely panel questions

### Why not wait for the official grade?

The purpose is to surface a reviewable estimate while the term is still active. Once the official same-term grade is finalized, the prediction is blocked because the actual outcome is available.

### Why require at least four activities?

The runtime gate requires minimum breadth across WW and PT and at least 70% observed component weight. It prevents the model from presenting a projection from a single score. This threshold is an operational rule and still needs prospective validation.

### Why is QA optional at standard readiness?

Standard readiness allows WW/PT evidence totaling at least 70% observed weight. QA becomes mandatory for `HIGH_EVIDENCE`. Evaluation shows that later evidence, which can include QA, has lower error; standard readiness should not be confused with high confidence.

### What happens when a teacher edits a grade?

After the grade mutation commits, a guarded refresh rebuilds evidence. If scope, model, and readiness remain valid and material evidence changed, the persistence service appends a revision. It does not retrain the model.

### Can an administrator manually force a prediction?

The stable Admin interface is read-only. Explicit development generation exists only behind the isolated development route and its POST dependency permits the automated test environment, not normal demo or production use.

### How do you avoid data leakage?

The scorer requires the exact feature schema and rejects identity, target, finalized-grade, and known leakage fields. The current target is never part of the feature row.

### Is the model personalized?

Each row uses the individual student's recorded evidence in an exact academic scope. The algorithm is shared across students; it does not learn a personal model or consume private biographical context.

### Is it fair?

Fairness has not been established. The system has consistency and audit controls, but there is no current subgroup analysis, lower-grade cohort, or independent three-term validation sufficient for a fairness claim.

### Why keep historical prediction code?

Existing `ai_prediction` rows, outcomes, explanations, and linked records remain auditable. Their API is GET-only. They are not reinterpreted as current-term projections.

### What would make it production-ready?

Independent current three-term outcomes, real low/failing cases, baseline and subgroup evaluation, gradebook parity, clean artifact provisioning, passing authorization/revision/browser tests, and an explicit model-promotion decision.

## 19. Suggested demonstration

Use prepared isolated data, not real student data.

1. Open an authorized prediction page and select an active period/scope.
2. Show an insufficient-evidence learner and explain why no score appears.
3. Add or reveal enough WW/PT evidence to meet standard readiness.
4. Show the projected grade and deterministic intervention level.
5. Change one eligible grade, refresh, and show that the evidence/revision changes.
6. Show that a Teacher cannot access an unassigned scope.
7. Show that a finalized same-term grade prevents another projection.
8. End with the limitations slide; do not present test fixtures as production deployment evidence.

## 20. Code and evidence map

| Defense topic | Source |
| --- | --- |
| Mounted APIs | `backend/app/main.py` |
| Stable read contract | `backend/app/api/v1/routes/CurrentTermPredictions.py` |
| Isolated writer | `backend/app/api/v1/routes/DevelopmentCurrentTermPredictions.py` |
| Historical read-only contract | `backend/app/api/v1/routes/Predictions.py` |
| Eligibility/orchestration | `backend/app/services/prediction/DevelopmentCurrentTermPredictionService.py` |
| Features/readiness | `backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py` |
| Domain scope | `backend/app/services/prediction/CurrentTermV3Domain.py` |
| Model scoring | `backend/app/services/prediction/DevelopmentCurrentTermScoringService.py` |
| Bands | `backend/app/services/prediction/DevelopmentCurrentTermRiskService.py` |
| Revisions/evidence | `backend/app/services/prediction/DevelopmentCurrentTermPredictionPersistenceService.py` |
| Production gate | `backend/app/services/prediction/ModelVersionService.py` |
| Frontend reads | `frontend/src/lib/prediction-api.ts`; `frontend/src/components/predictions/current-term-dashboard-adapter.ts` |
| Target-integrity audit | `docs/V3_TARGET_INTEGRITY_4H.md` |
| Corrected evaluation | `docs/OFFICIAL_TARGET_RF_EVALUATION_4I.md` |
| RF characterization | `docs/RANDOM_FOREST_DEFENSE_4J.md` |

## 21. Final defense summary

> Entervene's implemented prediction path is a guarded, auditable same-term grade projection. It uses current WW/PT/QA evidence, a strict 31-feature contract, a numeric Random Forest estimate, and transparent downstream intervention thresholds. The repository includes strong safety boundaries around readiness, authorization, revisioning, and production lifecycle. The evidence supports a research demonstration, especially with later evidence, but not a claim of reliable failure detection, universal subject coverage, fairness, or completed production validation. Those boundaries are explicit requirements for the next validation phase.

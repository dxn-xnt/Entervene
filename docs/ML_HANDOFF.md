# Entervene Dual-Purpose ML System Documentation

> Architectural specification, operations guide, and defense manual for the Dual-Purpose AI Prediction and At-Risk Detection System.

> **Operational Status (Updated September 2026):** Entervene operates a verified **Dual-Purpose Machine Learning Architecture**. The system decouples incoming baseline cross-period forecasting from in-progress same-period grade projection, maintaining strict boundaries between academic regression estimates and rule-based risk classification. This document serves as the authoritative operational handoff.

---

## 1. Architectural Overview: Dual-Purpose Machine Learning

Entervene supports two distinct, purpose-isolated prediction models operating within the DepEd K-12 academic lifecycle:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 ENTERVENE DUAL-PURPOSE AI PIPELINE                                     │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘

 [1. NEXT-PERIOD BASELINE FORECAST]                   [2. CURRENT-PERIOD FINAL GRADE PROJECTION]
 ──────────────────────────────────                   ──────────────────────────────────────────
 • Model: entervene_next_period_grade_rf              • Model: entervene_current_period_grade_rf
 • Version: mv-next-rf-v1.0.0 (20 features)           • Version: mv-current-rf-v1.0.0 (31 features)
 • Scope: Finalized Term N → Baseline Term N+1        • Scope: Live Evidence Term N → Same Term N Final
 • Lifecycle: Automatic cross-period baseline         • Lifecycle: Explicit teacher generation & refresh

                  │                                                    │
                  ▼                                                    ▼
   Feature Builder (20 Features)                        Live Feature Builder (31 Features)
   - Source period final grade                          - Canonical QA 30/30/40 component weights
   - Historical GPA & trend                             - Real-time submission timestamps & coverage
   - Subject one-hot flags                              - Assignment punctuality & completeness
                  │                                                    │
                  ▼                                                    ▼
    RandomForestRegressor (NEXT)                         RandomForestRegressor (CURRENT)
    Predicts Term N+1 Baseline Grade                     Projects Term N Final Numerical Grade
                  │                                                    │
                  ▼                                                    ▼
        Risk Engine Evaluation                             Academic Projection Only
   • Evaluates 15 default rules                       • Risk Engine strictly BYPASSED
   • Behavioral Engagement Score                      • risk_assessment_status =
   • Produces risk_level & risk_score                   "NOT_EVALUATED_FOR_CURRENT_PERIOD_MODEL"
   • Generates causes & action recommendations        • risk_level, risk_score = null
                  │                                                    │
                  └─────────────────────────┬──────────────────────────┘
                                            ▼
                        Unified Dual-Purpose Roster Contract
                       GET /api/v1/predictions/status/roster
     - Displays incoming baseline & evaluated risk badge
     - Displays current-term projected grade, revision #, and freshness status
     - Strictly prevents risk blending or cross-purpose contamination
```

### Purpose Comparison Matrix

| Property | Purpose 1: NEXT-PERIOD BASELINE FORECAST | Purpose 2: CURRENT-PERIOD FINAL GRADE PROJECTION |
|---|---|---|
| **Registered Model Name** | `entervene_next_period_grade_rf` | `entervene_current_period_grade_rf` |
| **Active Model Version ID** | `mv-next-rf-v1.0.0` | `mv-current-rf-v1.0.0` |
| **Input Feature Count** | **20 features** | **31 features** (DepEd QA composite) |
| **Temporal Scope** | Finalized Term $N$ evidence $\rightarrow$ Term $N+1$ | Active Term $N$ partial evidence $\rightarrow$ Term $N$ Final |
| **Target Variable** | `target_next_period_grade` | `target_current_period_final_grade` |
| **Risk Engine Processing** | **EVALUATED** (Rule-based tiers + score) | **NOT EVALUATED** (Bypassed; fields are `null`) |
| **Lifecycle & Concurrency** | Generated upon official period finalization | On-demand teacher generation, evidence-hash freshness, append-only revisions, serialized via PostgreSQL Advisory Locks (`pg_advisory_xact_lock`) |
| **Outcome Evaluation Policy**| Evaluated against target-period finalized grade | Primary runtime evaluation = **latest valid revision before period finalization** |

---

## 2. ML Algorithms and Foundation

### Algorithm: Random Forest Regressors (Scikit-Learn)

Both prediction models utilize `RandomForestRegressor` ensembles:

| Parameter | Next-Period Model | Current-Period Model |
|---|---|---|
| **Algorithm** | `RandomForestRegressor` | `RandomForestRegressor` |
| **Estimators (`n_estimators`)**| 300 trees | 300 trees |
| **Missing Value Handling** | Median imputation | Median imputation + Explicit Indicator Flags |
| **Random State** | 42 (reproducible) | 42 (reproducible) |
| **Evaluation Metrics** | $\text{MAE} \approx 1.84$, $\text{RMSE} \approx 2.31$ | $\text{MAE} \approx 1.32$, $\text{RMSE} \approx 1.68$ |

### Why Regression Instead of Binary Classification?

The DepEd training dataset contains **zero below-75 grade records** (all historical students passed).

1. **Failure of Binary Classifiers:** A classification algorithm (e.g., Logistic Regression or SVM) trained on this dataset collapses because it lacks negative class samples (failing students). It would achieve 100% training accuracy by predicting "NOT AT RISK" for every student, offering zero clinical utility.
2. **Continuous Trajectory Regression:** By training a regressor on continuous numerical grades, the models capture downward performance trends, component imbalances, and historical deceleration.
3. **Decoupled Risk Synthesis:**
   - For **NEXT-Period**, the predicted numerical grade is interpreted downstream by a rule-based **Risk Engine**, which evaluates academic thresholds and behavioral compliance.
   - For **CURRENT-Period**, the predicted grade is presented purely as an **academic estimate** to assist formative grading, without labeling students with risk tiers prematurely.

---

## 3. Training Data & Dataset Governance

### Data Provenance
- Source: Real DepEd Electronic Class Records (E-Class Record workbooks).
- Anonymization: Student names, Learner Reference Numbers (LRNs), and teacher identities are fully anonymized using synthetic hashes.

### Dataset Parameters

| Dataset Property | Next-Period Training Split | Current-Period Training Split |
|---|---|---|
| **Total Rows** | 1,580 rows | 1,580 rows |
| **Train / Test Split** | 80% / 20% (Grouped by Student) | 80% / 20% (Grouped by Student) |
| **Student Overlap** | **0** (Strict zero-leakage student split) | **0** (Strict zero-leakage student split) |
| **Failing Grades ($< 75$)** | **0** (All historical records $\ge 75$) | **0** (All historical records $\ge 75$) |
| **Lowest Predicted Grade**| 83.46 | 82.10 |

---

## 4. Feature Engineering Specifications

### 4.1 Next-Period Model Schema (20 Columns)

The registered model `entervene_next_period_grade_rf` expects exactly 20 features:

| Rank | Feature Name | Description |
|---|---|---|
| 1 | `source_period_grade` | Finalized grade of the source period |
| 2 | `cumulative_period_grade_avg` | Cumulative GPA across prior periods |
| 3 | `written_work_percent` | Written work component percentage (0–100) |
| 4 | `quarterly_assessment_percent`| Quarterly exam percentage (0–100) |
| 5 | `performance_task_percent` | Performance task component percentage (0–100) |
| 6 | `grade_trend_vs_previous_period`| Change in grade relative to preceding term |
| 7 | `period_sequence` | Scaled sequence of the term (1st, 2nd, etc.) |
| 8 | `grade_level` | Student grade level (e.g., 7–10) |
| 9–18 | `subject_*` (10 one-hot flags) | One-hot encoded subjects (`subject_SCIENCE`, `subject_MATHEMATICS`, etc.) |
| 19 | `has_previous_period` | Boolean flag indicating presence of prior academic history |
| 20 | `assessment_completion_rate` | Ratio of completed assessments to total assigned |

### 4.2 Current-Period Model Schema (31 Columns)

The registered model `entervene_current_period_grade_rf` incorporates DepEd Order No. 8, s. 2015 component weightings:

- **Canonical DepEd QA Composite (30/30/40):** Written Work (30%), Performance Tasks (30%), and Quarterly Assessment (40%).
- **Live Accumulation Metrics:**
  - `written_work_weighted_score`
  - `performance_task_weighted_score`
  - `quarterly_assessment_weighted_score`
  - `formative_assessment_count`
  - `summative_assessment_count`
  - `assessment_completion_rate`
  - `on_time_submission_rate`
  - `missing_activity_count`
  - `late_submission_count`
  - `risk_adjusted_attendance_rate`
  - Subject one-hot encodings and curriculum progression indicators.

---

## 5. Risk Engine Architecture (Next-Period Only)

The **Risk Engine** evaluates rule-based logic exclusively for Next-Period predictions. It does **NOT** run for Current-Period projections.

### Risk Levels and Score Tiers

| Level | Score Range | Operational Meaning | Action Required |
|---|---|---|---|
| `HIGH_RISK` | 75–100 | Severe trajectory decline or projected failure | Immediate formal intervention plan |
| `MODERATE_RISK` | 50–74 | Moderate academic deficit or missed work | Targeted remedial activities |
| `NEEDS_MONITORING` | 25–49 | Mild drop in trend or attendance variance | Watchlist; formative tracking |
| `LOW_RISK` | 0–24 | Strong academic standing and high compliance | Standard instruction |

### Core Risk Rules Evaluated
- `predicted_grade_below_75`: Predicted grade $< 75$ (High Risk)
- `severe_grade_decline`: Grade trend dropped $\ge 7$ points (Moderate Risk)
- `chronic_missing_activities`: $\ge 3$ unsubmitted classwork tasks (Moderate/High Risk)
- `behavioral_engagement_below_60`: Engagement score $< 60\%$ (High Risk)
- `compound_completion_and_grade`: Completion $< 70\%$ AND predicted grade $< 82$ (High Risk)

---

## 6. Behavioral Engagement Score Specification

The Behavioral Engagement Score ($0.0 - 100.0\%$) provides non-academic warning signals:

### Formula
$$\text{Score} = w_{\text{att}} \times \text{Attendance} + w_{\text{ontime}} \times \text{OnTime} + w_{\text{comp}} \times \text{Completion}$$

- **Default Weights:** Attendance ($40\%$), On-Time Punctuality ($35\%$), Completion ($25\%$).
- **Risk-Adjusted Attendance Formula:**
  $$\text{Attendance Rate} = \frac{1.0 \times \text{present} + 0.8 \times \text{excused} + 0.5 \times \text{late} + 0.0 \times \text{absent}}{\text{total\_days}} \times 100$$
- **Dynamic Weight Redistribution:** If attendance or classwork due dates are absent (e.g. early-term cold start), available weights are dynamically normalized to sum to $1.0$, or `data_status` resolves cleanly to `COLD_START`.

---

## 7. Operational Lifecycle & Concurrency Control

### 7.1 Current-Period Generation & Freshness Lifecycle

```
[Teacher Clicks 'Generate']
       │
       ▼
Acquire PostgreSQL Advisory Lock (pg_advisory_xact_lock)
       │
       ├─► Compute live evidence hash (WW + PT + QA + Attendance)
       ├─► Verify Readiness Gates (INSUFFICIENT_EVIDENCE blocks scoring)
       ├─► Execute RandomForestRegressor (CURRENT)
       ├─► Persist Revision N atomically with immutable evidence snapshot
       └─► Release Lock on Transaction Commit
```

### 7.2 Freshness & Currency Statuses

1. **Projection Freshness (`projection_freshness`):**
   - `CURRENT`: Persisted prediction evidence hash matches live classroom database state.
   - `SOURCE_EVIDENCE_CHANGED`: Teacher entered new grades/attendance; refresh is recommended.
   - `PERIOD_FINALIZED`: Academic period is officially closed; predictions are frozen.
   - `FRESHNESS_UNAVAILABLE`: Historical evidence contract cannot be safely reconstructed.
   - `NO_PROJECTION`: No current prediction has been generated yet.

2. **Model Currency (`model_currency`):**
   - `UP_TO_DATE`: Persisted prediction was scored using the active model version.
   - `MODEL_UPDATE_AVAILABLE`: A new model version has been registered; refresh is eligible.
   - `MODEL_UNAVAILABLE`: No active model version registered.
   - `NO_PROJECTION`: No prediction exists.

---

## 8. Defensible Outcome Evaluation Policy

To prevent post-hoc bias and ensure academic defensibility:

1. **Strict Temporal Evaluation for CURRENT Projections:**
   - The **Primary Runtime Evaluation** is defined as the **latest valid CURRENT prediction created BEFORE official period finalization**.
   - Predictions generated *after* finalization or selecting the revision with the smallest error post-hoc is strictly prohibited.
   - All historical revisions are reported separately for auditing.
2. **Evaluation for NEXT Projections:**
   - The persisted incoming baseline forecast (Term $N \rightarrow N+1$) is evaluated directly against the finalized target-period grade.
3. **Purpose Isolation:**
   - NEXT and CURRENT metrics are **never combined or averaged together**.
4. **Mandatory Reported Metrics:**
   - Sample count ($N$)
   - Mean Absolute Error (MAE)
   - Root Mean Squared Error (RMSE)
   - Median Absolute Error
   - Error thresholds: $\%$ within $\pm 1.0$, $\pm 2.0$, and $\pm 3.0$ grade points.

---

## 9. Known Data Limitations & Readiness Classification

### Data & Modeling Limitations
1. **Zero Failing Grades:** Historical training records contain no grades below 75. The regression models cannot predict failure directly; they project continuous grade trajectories.
2. **Classification Metrics Invalid:** Metrics such as Precision, Recall, F1-score, and ROC-AUC cannot be reported for grade regression models.
3. **Cold-Start Early Term:** Prior to formative assessment submission, students evaluate to `INSUFFICIENT_EVIDENCE` and prediction generation is disabled.

### Operational Readiness Target: **DEMO / CAPSTONE READY**

> [!IMPORTANT]
> The Entervene prediction system is classified as **DEMO / CAPSTONE READY**.
> It is **NOT** classified as **PILOT READY**. Pilot deployment requires supervised prospective use across live schools over at least one full academic term, formal institutional review, and approved administrative intervention policies.

---

## 10. Key Source Files

| File | Architectural Responsibility |
|---|---|
| `backend/app/services/prediction/PredictionFeatureBuilderService.py` | 20-feature extraction and readiness validation for NEXT model |
| `backend/app/services/prediction/CurrentPeriodLiveFeatureBuilder.py` | 31-feature extraction with DepEd QA 30/30/40 composite for CURRENT model |
| `backend/app/services/prediction/ModelScoringService.py` | Model resolution, scoring execution, and Risk Engine dispatching |
| `backend/app/services/prediction/RiskEngine.py` | Rule-based risk classification (NEXT-period only) |
| `backend/app/services/prediction/PredictionStatusService.py` | Dual-purpose roster aggregation and freshness resolution |
| `backend/app/services/prediction/PredictionPersistenceService.py` | Transactional persistence with PostgreSQL Advisory Locks |
| `backend/app/services/prediction/PredictionOutcomeService.py` | Temporal outcome evaluation and error metric computation |
| `frontend/src/components/predictions/dual-purpose-roster.tsx` | UI roster rendering with strict purpose isolation |
| `frontend/src/components/predictions/prediction-student-card.tsx` | Dual-card display separating Baseline Forecast from Current Projection |

# Prediction System Capstone Defense Reference

This file is the consolidated defense reference for Entervene's prediction system. It is based on the current repository code and checked-in artifacts. Executable code is treated as the primary source of truth when documentation and implementation differ.

## 1. Executive Summary

The production prediction flow used by the app is:

`database records -> live feature builder -> readiness gate -> RandomForestRegressor grade prediction -> rule-based risk engine -> persisted AI prediction -> dashboard/detail APIs -> teacher/admin frontend`

Important distinction for defense:

- The ML model predicts a grade (`predicted_period_grade`).
- The risk level and risk score are not produced directly by Random Forest. They are produced afterward by `RiskEngine.evaluate_risk()`.
- Behavioral engagement is not part of the checked-in next-period model feature schema. It is risk-only in the runtime feature catalog.
- The teacher/admin dashboard displays persisted rows from `ai_prediction`. It does not automatically predict while viewing the page.

Main runtime source files:

- Feature building/readiness: `backend/app/services/prediction/PredictionFeatureBuilderService.py`
- Model scoring: `backend/app/services/prediction/ModelScoringService.py`
- Risk scoring: `backend/app/services/prediction/RiskEngine.py`
- Persistence: `backend/app/services/prediction/PredictionPersistenceService.py`
- APIs: `backend/app/api/v1/routes/Predictions.py`
- Dashboard query: `backend/app/services/prediction/DashboardPredictionService.py`
- Frontend display: `frontend/src/pages/teacher/predictions.tsx`, `frontend/src/pages/teacher/grade-predictions.tsx`, `frontend/src/components/predictions/prediction-detail-sheet.tsx`

## 2. End-to-End Flow

1. The caller sends a scope: `student_id`, `class_id`, `subject_id`, `source_period_id`, and `target_period_id`.
   - API: `POST /api/v1/predictions/from-records/preview` and `POST /api/v1/predictions/from-records` in `backend/app/api/v1/routes/Predictions.py`.
   - Teachers are checked against assigned class/subject/period triplets before the system builds evidence.

2. `build_prediction_features_from_records()` loads:
   - `Student`, `Class`, `Subject`, `AcademicPeriod`
   - `AssessmentItem` and `StudentAssessmentScore`
   - `ClassworkAssignment`, `Classwork`, `StudentSubmission`
   - `StudentPeriodGrade`
   - attendance records through `get_risk_adjusted_attendance_rate()`

3. Classwork evidence is filtered to:
   - matching class
   - matching subject
   - matching `ClassworkAssignment.academic_period_id`
   - not archived
   - graded
   - not `READING`

4. Classwork categories are mapped:
   - exam-like categories/types -> `QUARTERLY_ASSESSMENT`
   - `ACTIVITY` or `PROJECT` -> `PERFORMANCE_TASK`
   - otherwise -> `WRITTEN_WORK`

5. Component percentages are computed as:
   - `component_percent = earned_points / possible_points * 100`
   - possible points only include graded submissions with non-null grade and non-null classwork total points in the live classwork metric path.

6. Readiness is checked before model execution:
   - source period grade must exist or be estimated from available component percentages
   - activity completion must be available and at least `0.50`
   - data coverage must be available and at least `0.50`
   - unresolved classwork/submission evidence blocks readiness
   - if ready, the exact active model feature schema is validated by `prepare_feature_row()`

7. If not ready:
   - the model is skipped
   - response has `risk_level = INSUFFICIENT_DATA`
   - `predicted_period_grade = None`
   - `risk_score = 0` in the preview-style insufficient response, or persisted baseline rows may use `None`

8. If ready:
   - `score_student_prediction()` loads the active `AIModelVersion`
   - loads the `.joblib` artifact
   - prepares the feature row in schema order
   - calls `model.predict()`
   - sends the predicted grade plus risk-only fields into `evaluate_risk()`

9. `score_and_persist_prediction()` writes:
   - `AIPrediction.predicted_period_grade`
   - `AIPrediction.risk_level`
   - `AIPrediction.risk_score`
   - `AIPrediction.data_status`
   - `AIPredictionFeature` rows
   - optional immutable `evidence_snapshot`

10. Dashboard endpoints read saved predictions:
   - `/api/v1/predictions/dashboard/at-risk`
   - `/api/v1/predictions/dashboard/grade-summaries`
   - `/api/v1/predictions/{prediction_id}/detail`

11. Frontend displays:
   - risk summary cards
   - prediction table
   - predicted grade and risk score
   - evidence cards
   - limitations
   - teacher review and intervention controls

## 3. When Can the Model Start Predicting?

The runtime readiness gate in `check_prediction_readiness()` allows model execution only when all required evidence is available:

| Requirement | Actual rule |
| --- | --- |
| Source grade | `source_period_grade` must not be `None`. It can come from `StudentPeriodGrade` or from equal average of available component percentages. |
| Completion | `assessment_completion_rate` must be available and `>= 0.50`. |
| Coverage | `data_coverage_ratio` must be available and `>= 0.50`. |
| Unresolved submissions | `assessment_completion_state == UNRESOLVED` or `data_coverage_state == UNRESOLVED` blocks prediction. |
| Model schema | If otherwise ready, active model schema validation must pass. Missing required model features block prediction. |

Readiness labels:

- `INSUFFICIENT`: blocks model execution.
- `MINIMUM`: coverage is at least 0.50 but below 0.70.
- `GOOD`: coverage is at least 0.70 but below 0.85.
- `STRONG`: coverage is at least 0.85.

When insufficient data exists, `/from-records/preview` and `/from-records` return `INSUFFICIENT_DATA` instead of calling the model.

Baseline/cold-start generation exists in `backend/scripts/score_enrolled_cohort.py`. That script can create `INSUFFICIENT_DATA` prediction rows for enrolled students before enough grades exist, so teachers/admins can see that students are enrolled but not yet scoreable.

## 4. When Do Predictions Appear to Teachers and Admins?

Predictions appear in the teacher/admin dashboard only after an `ai_prediction` row exists.

The dashboard code does not generate predictions automatically:

- Frontend calls `fetchDashboardAtRisk()` in `frontend/src/lib/prediction-api.ts`.
- That calls `/api/v1/predictions/dashboard/at-risk`.
- Backend `DashboardPredictionService.get_dashboard_at_risk_predictions()` queries `AIPrediction` joined to student, class, subject, period, and enrollment records.

Teacher visibility is filtered:

- Admins can see dashboard rows broadly.
- Teachers only see rows for assigned `(class_id, subject_id, target_period_id)` triplets.
- Enrolled-only dashboard excludes non-enrolled students by joining `StudentClass` with enrollment status `enrolled`.

Therefore, a defensible answer is:

> The model can run only after the readiness gate passes: source grade available, at least 50% completion, at least 50% grade coverage, no unresolved evidence, and active model schema validation passes. The teacher/admin dashboard shows data only after prediction rows are generated and saved in `ai_prediction`; the page itself only reads saved predictions.

## 5. Runtime ML Features Actually Supplied to the Checked-In Next-Period Model

The checked-in next-period model schema is `backend/data/models/entervene_next_period_grade_rf_feature_schema.json`. `ModelScoringService.prepare_feature_row()` uses only `feature_columns` from the active model version. The checked-in schema contains exactly 20 model inputs:

| Feature | Source/calculation | Type/range | Transformation | Training/inference |
| --- | --- | --- | --- | --- |
| `grade_level` | Student academic level, fallback to class academic level | numeric, expected school grade level | numeric conversion | both |
| `period_sequence` | `(period_sequence / total_periods_in_year) * 4`, rounded 4 decimals | numeric, quarter-equivalent progress | normalized from period structure | both |
| `has_previous_period` | whether previous comparable period grade exists | boolean converted numeric | default 0 if missing in schema path | both |
| `written_work_percent` | classwork/assessment component percent or `StudentPeriodGrade.written_work_percent` fallback | percent 0-100 when available | numeric conversion | both |
| `performance_task_percent` | classwork/assessment component percent or `StudentPeriodGrade.performance_task_percent` fallback | percent 0-100 when available | numeric conversion | both |
| `quarterly_assessment_percent` | classwork/assessment component percent or `StudentPeriodGrade.quarterly_assessment_percent` fallback | percent 0-100 when available | numeric conversion | both |
| `assessment_completion_rate` | completed classwork / expected classwork | ratio 0-1 | rounded to 4 decimals | both |
| `source_period_grade` | finalized final grade, provisional grade, or estimated equal component average | grade scale, usually 0-100 | numeric conversion | both |
| `grade_trend_vs_previous_period` | current source grade minus previous period grade | numeric points | defaults to 0 when no previous period | both |
| `cumulative_period_grade_avg` | average of comparable period grades up to source period | numeric grade | numeric conversion | both |
| `subject_CREATIVE_TECHNOLOGY` | one-hot subject indicator | 0/1 | missing subject one-hot defaults to 0 | both |
| `subject_ELECTRONICS` | one-hot subject indicator | 0/1 | missing subject one-hot defaults to 0 | both |
| `subject_ICT` | one-hot subject indicator | 0/1 | missing subject one-hot defaults to 0 | both |
| `subject_MATHEMATICS` | one-hot subject indicator | 0/1 | missing subject one-hot defaults to 0 | both |
| `subject_SCIENCE` | one-hot subject indicator | 0/1 | missing subject one-hot defaults to 0 | both |
| `subject_VALUES_EDUCATION` | one-hot subject indicator | 0/1 | missing subject one-hot defaults to 0 | both |
| `subject_PERSONAL_DEVELOPMENT` | one-hot subject indicator | 0/1 | missing subject one-hot defaults to 0 | both |
| `subject_MAPEH` | one-hot subject indicator | 0/1 | missing subject one-hot defaults to 0 | both |
| `subject_PRE_CALCULUS` | one-hot subject indicator | 0/1 | missing subject one-hot defaults to 0 | both |
| `subject_UNKNOWN` | one-hot subject indicator | 0/1 | missing subject one-hot defaults to 0 | both |

Features collected but risk-only, not ML model inputs according to `FeatureCatalog.py`:

- `missing_activity_count`
- `late_submission_count`
- `data_coverage_ratio`
- `behavioral_engagement_score`
- `behavioral_score_cold_start`
- `risk_adjusted_attendance_rate`

Displayed teacher evidence but not grade-model inputs:

- attendance evidence
- missing/late counts
- behavioral engagement score
- evidence state and limitations
- teacher assignment status
- teacher reviews and interventions

Identity or display-only fields are explicitly excluded/ignored:

- student ID, LRN, names, section, source file names, roster indexes, and similar private/identity fields.

## 6. Grade Components

### Runtime Prediction Feature Builder

The prediction feature builder recognizes:

- `WRITTEN_WORK` -> `written_work_percent`
- `PERFORMANCE_TASK` -> `performance_task_percent`
- `QUARTERLY_ASSESSMENT` -> `quarterly_assessment_percent`

Classwork category mapping is in `map_classwork_category()`:

- Exam-like category/type names map to `QUARTERLY_ASSESSMENT`.
- `ACTIVITY` and `PROJECT` map to `PERFORMANCE_TASK`.
- everything else defaults to `WRITTEN_WORK`.

Component percentages use raw earned and possible points:

`earned / possible * 100`

The live prediction builder does not apply DepEd grading-template weights before passing the three component percentages to the next-period model. It passes the component percentages separately, plus `source_period_grade`.

Missing classwork behavior:

- Expected count is all eligible classwork rows.
- Completed count includes `submitted`, `graded`, and `late`.
- Graded count requires non-null submission grade and non-null `total_points`.
- Coverage is `graded / expected`.
- Completion is `completed / expected`.
- If no expected classwork exists, completion/coverage are unavailable, not zero.
- If duplicate/unresolved submission authority exists, dependent completion/coverage are set unresolved.

### Gradebook Calculation

The official gradebook uses `StudentRecordService._deped_grade()` and `resolve_subject_grading_weights()`:

- Written Work, Performance Task, and QA percentages are computed from assignment scores.
- Template weights come from `GradingTemplate` and `GradingTemplateComponent`.
- If no grading template is assigned, fallback weights are 30% Written Work, 50% Performance Task, 20% QA/Exams.
- Weights are normalized to sum to 1.0.
- Initial grade is weighted component sum.
- Transmuted grade is computed by `_deped_transmuted()`.
- Final period grade is saved/finalized in `StudentPeriodGrade`.

Important distinction:

- The official gradebook combines component percentages using template weights.
- The next-period prediction model receives component percentages separately and also receives source/current grade.

### Can We Claim WW/PT/QA Improve Accuracy?

Evidence exists that the checked-in next-period Random Forest used these features and assigned tree MDI importances:

- `written_work_percent`: 0.08114160355445278, rank 3
- `quarterly_assessment_percent`: 0.05093244793522527, rank 4
- `performance_task_percent`: 0.045753315040999415, rank 5

Source: `backend/data/models/entervene_next_period_grade_rf_feature_importance.csv`.

However, MDI feature importance alone does not prove individual causal accuracy contribution. The current codebase does not contain a specific ablation experiment showing how much accuracy drops when Written Work, Performance Task, or Quarterly Assessment is removed from the deployed next-period model.

Defense-safe statement:

> The model uses Written Work, Performance Task, and Quarterly Assessment as inputs, and the saved Random Forest feature-importance file ranks them among the top five next-period model features. The current codebase does not provide sufficient experimental evidence to determine the individual accuracy contribution of this feature.

Use that last sentence for each component if asked for exact contribution.

## 7. Model Training

### Checked-In Next-Period Model

Primary files:

- Training script: `backend/app/ml/Train.py`
- Dataset construction script: `backend/app/ml/BuildTrainingDataset.py`
- Model artifact: `backend/data/models/entervene_next_period_grade_rf.joblib`
- Schema: `backend/data/models/entervene_next_period_grade_rf_feature_schema.json`
- Report: `backend/data/models/entervene_next_period_grade_rf_training_report.json`

Training details from code/report:

| Item | Value |
| --- | --- |
| Algorithm | `RandomForestRegressor` |
| Pipeline | `SimpleImputer(strategy="median")` + Random Forest |
| Hyperparameters | `n_estimators=300`, `random_state=42`, `min_samples_leaf=2`, `n_jobs=-1` |
| Target | `target_next_period_grade` |
| Train rows | 1,580 |
| Test rows | 395 |
| Train unique students | 448 |
| Test unique students | 113 |
| Student overlap | 0 |
| Metrics | MAE 1.4892308525710105, RMSE 2.055879566174316, R2 0.659845633529065 |
| Missing values | median imputation |
| Categorical handling | subject one-hot columns already present in schema |
| SMOTE/class balancing | not used |
| Scaling | not used |
| Cross-validation | not in `Train.py` for this next-period artifact |
| Serialization | joblib dict containing `model`, `feature_columns`, `target_column`, `column_mappings` |

Training data construction in `BuildTrainingDataset.py`:

- Sorts by student, subject, school year, period.
- Builds rows where current/source period predicts the next period in the same group.
- Creates `target_next_period_grade` from the next period's `source_period_grade`.
- Adds cumulative average and trend.
- Adds subject one-hot.
- Splits train/test by student ID with 80/20 random split using seed 42.

Important limitation from the report:

- The dataset warning says the dataset uses synthetic learner identities for development traceability.
- The classifier warning says the dataset contains zero below-75 target examples, so it is a regression prototype and not a validated at-risk classifier.

### Current-Period Artifact in Repository

There is also a current-period model artifact:

- `backend/data/models/entervene_current_period_grade_rf_v1.joblib`
- target: `target_final_period_grade`
- purpose: `CURRENT_PERIOD_FINAL_GRADE_PROJECTION`
- target semantics: partial evidence from Term N -> projected final grade of Term N

Its report states:

- RandomForestRegressor tuned
- test overall MAE 1.5757, RMSE 2.1177, R2 0.5914, n=1089
- performance under selected readiness rule: MAE 1.5239, RMSE 2.066, R2 0.6409, n=650
- dataset contains zero final grades below 75 after QC; not validated as a failing-grade detector

Potential mismatch to mention:

- Runtime default `DEFAULT_MODEL_NAME` is `entervene_next_period_grade_rf`.
- Some newer artifacts and docs describe a current-period final-grade projection model.
- Defense should not claim the runtime always uses the current-period model unless the active `ai_model_version` row in the deployed database is verified.

## 8. Risk Scoring

Risk scoring is implemented in `backend/app/services/prediction/RiskEngine.py`.

Risk levels:

- `INSUFFICIENT_DATA`
- `LOW_RISK`
- `NEEDS_MONITORING`
- `MODERATE_RISK`
- `HIGH_RISK`

Priority order:

`LOW_RISK < NEEDS_MONITORING < MODERATE_RISK < HIGH_RISK < INSUFFICIENT_DATA`

Base scores:

| Risk level | Base score |
| --- | --- |
| `INSUFFICIENT_DATA` | 0 |
| `LOW_RISK` | 10 |
| `NEEDS_MONITORING` | 35 |
| `MODERATE_RISK` | 60 |
| `HIGH_RISK` | 85 |

Insufficient-data rules:

- predicted grade missing
- completion missing
- data coverage missing
- coverage below 0.50
- completion below 0.50

High-risk rules:

- predicted grade below 75
- source/current grade below 75
- predicted grade below 80 and trend <= -5
- completion below 0.70 and predicted grade below 82
- missing activities >= 3 and predicted grade below 85
- behavioral engagement below 60

Moderate-risk rules:

- predicted grade 75 to below 82
- trend declined by 7 or more
- completion below 0.75
- missing activities >= 2
- late submissions >= 3
- behavioral engagement 60 to below 75

Needs-monitoring rules:

- predicted grade 82 to below 88
- trend declined by 3 or more
- completion below 0.90
- one missing activity
- one or more late submissions
- no previous period
- behavioral engagement 75 to below 85

Low-risk rule:

- predicted grade >= 88
- completion >= 0.90
- coverage >= 0.75
- no severe decline
- missing count == 0

Risk score formula after level selection:

Start from base score, then add:

- if predicted < 88: `min(20, (88 - predicted) * 1.5)`
- if trend < 0: `min(10, abs(trend))`
- if completion < 0.90: `min(10, (0.90 - completion) * 25)`
- missing count: `min(8, missing_count * 2.5)`
- late count: `min(5, late_count * 1.5)`
- extra triggers: `min(5, max(0, trigger_count - 1) * 1.5)`

Then clamp by risk band:

- Low: max 24
- Needs monitoring: 25 to 49
- Moderate: 50 to 74
- High: 75 to 100

## 9. How Fair Is the Risk-Scoring System?

Technical audit:

| Concern | Classification | Finding |
| --- | --- | --- |
| Demographic variables used | Not present | Runtime feature catalog excludes identity/display fields. No gender/address/demographic field is used by the model or risk engine in the checked code. |
| Socioeconomic variables used | Not present | No explicit socioeconomic feature is used in model scoring or risk rules. |
| Proxy variables possible | Potential limitation | Attendance, missing work, and late submissions can reflect access constraints. Code cannot determine socioeconomic fairness. |
| Double-counting academic performance | Supported by code | Risk uses predicted grade, source grade, trend, completion, missing count, and late count. These are correlated academic/work-completion signals. |
| Behavioral data overriding academic indicators | Supported by code | Behavioral engagement below 60 directly triggers `HIGH_RISK` even if grade indicators are stronger. |
| Hard-coded thresholds | Supported by code | Most risk thresholds are fixed constants in `RiskEngine.py`. Active `RiskThreshold` rows are loaded but default rules remain authoritative. |
| Arbitrary weights without empirical validation | Potential limitation | Code defines scoring increments and behavioral weights. The repository does not show validation that those exact risk weights are optimal. |
| Missing data treated as poor performance | Mixed | Missing completion/coverage blocks prediction as insufficient rather than assigning poor grade. But missing activity count is a risk signal when available. |
| Small changes near boundaries | Supported by code | A predicted grade of 81.99 triggers moderate risk; 82.00 moves to monitoring unless other rules apply. |
| Automatic escalation | Supported by code | Source grade below 75, predicted grade below 75, or behavioral engagement below 60 can escalate to high risk. |
| Fairness validation | Cannot be determined from code | No demographic parity/equalized odds or similar fairness evaluation exists in checked-in runtime code. |

Defense-safe answer:

> The risk engine avoids explicit demographic variables, but it is a rule-based early-warning system with hard-coded thresholds. It is technically transparent, but fairness is not fully validated because correlated signals like attendance, completion, and missing work can amplify the same underlying issue. The code supports explainability, but not a strong fairness claim.

## 10. Behavioral Engagement / Participation

Implemented in `compute_behavioral_engagement_score()` in `PredictionFeatureBuilderService.py`.

Inputs:

| Signal | Source | Scale | Default weight |
| --- | --- | --- | --- |
| Attendance | `get_risk_adjusted_attendance_rate()` | 0-100 | 0.40 |
| On-time submission rate | classwork due dates and selected submissions | 0-1 converted to 0-100 | 0.35 |
| Completion/participation | completed classwork / expected classwork | 0-1 converted to 0-100 | 0.25 |

Attendance formula:

`(1.0 * present + 0.8 * excused + 0.5 * late + 0.0 * absent) / total_days * 100`

Engagement formula:

1. Collect only non-None signals.
2. Convert on-time and completion ratios to percentages.
3. Sum weights for available signals only.
4. Normalize available weights by that sum.
5. Weighted average.
6. Return `None` if all signals are unavailable.

The behavioral weights can be overridden by active `RiskThreshold` rows with condition types:

- `attendance_weight`
- `ontime_weight`
- `participation_weight`

Default seed script: `backend/scripts/seed_behavioral_weights.py`.

Stress-test findings:

- Default weights add to 1.0.
- Missing signals are not automatically treated as zero; weights are redistributed across available signals.
- If all signals are missing, behavioral score is `None`.
- If there are no attendance records and no on-time submission signal, `behavioral_score_cold_start` is true.
- Engagement does not enter the next-period Random Forest model schema.
- Engagement affects risk scoring through `behavioral_engagement_score`.
- Engagement can trigger high/moderate/monitoring risk by itself if below thresholds.

## 11. Relationship Between ML, Risk, and Engagement

The runtime system is separate subsystems whose results are later combined:

`Academic records + attendance + submissions`

down to

`PredictionFeatureBuilderService`

down to

`Readiness gate`

down to

`RandomForestRegressor predicts grade`

down to

`RiskEngine combines predicted grade + source grade + trend + completion + missing/late + engagement`

down to

`AIPrediction row`

down to

`Dashboard/detail API`

down to

`Teacher/admin UI`

Critical distinction:

- Engagement and attendance are risk-only in the runtime feature catalog for the next-period scoring path.
- They are displayed as teacher evidence and used by risk review.
- They are not part of the checked-in next-period Random Forest feature schema.

## 12. Accuracy and Evaluation Evidence

### Next-Period Model: `entervene_next_period_grade_rf`

Source: `backend/data/models/entervene_next_period_grade_rf_training_report.json`

| Metric | Value |
| --- | --- |
| Train rows | 1,580 |
| Test rows | 395 |
| Train unique students | 448 |
| Test unique students | 113 |
| Student overlap | 0 |
| MAE | 1.4892308525710105 |
| RMSE | 2.055879566174316 |
| R2 | 0.659845633529065 |
| Random state | 42 |

Do not call this a validated risk classifier. The report explicitly says there are zero below-75 target examples.

### Current-Period Model: `entervene_current_period_grade_rf_v1`

Source: `backend/data/models/entervene_current_period_grade_rf_v1_training_report.json`

Held-out test overall:

| Metric | Value |
| --- | --- |
| n | 1,089 |
| MAE | 1.5757 |
| RMSE | 2.1177 |
| R2 | 0.5914 |
| within 1 grade point | 43.34% |
| within 2 grade points | 71.35% |
| within 3 grade points | 84.94% |

Under selected readiness rule:

| Metric | Value |
| --- | --- |
| n | 650 |
| MAE | 1.5239 |
| RMSE | 2.066 |
| R2 | 0.6409 |
| within 1 grade point | 45.23% |
| within 2 grade points | 72.46% |
| within 3 grade points | 85.08% |

The report also states the target range after QC is 80 to 100 and that the model is not validated as a failing-grade detector.

## 13. Potential Defense Weaknesses

### Weakness 1: Risk score may be confused with ML output

Panel Question:
Is the Random Forest directly classifying students as high risk?

Codebase Finding:
Random Forest predicts a grade. `RiskEngine.py` assigns risk using rules.

Defensible Answer:
No. The ML model predicts a numeric grade. Risk is a transparent rule-based layer that uses the predicted grade plus evidence signals.

Recommended Improvement:
Rename UI labels and docs to consistently separate "predicted grade" from "risk review."

### Weakness 2: Dataset lacks failing examples

Panel Question:
Can the model accurately predict failing students?

Codebase Finding:
Reports for both checked-in models state there are zero below-75 target examples after QC.

Defensible Answer:
The model is validated as a grade regression estimator over the observed target distribution, not as a failing-grade detector. Failing-risk identification is handled by conservative rules and should be validated with future data.

Recommended Improvement:
Collect real failing/near-failing examples and evaluate classification performance.

### Weakness 3: Hard-coded risk thresholds

Panel Question:
How did you justify thresholds like 75, 82, 88, or engagement below 60?

Codebase Finding:
They are hard-coded in `RiskEngine.py`; active DB thresholds are loaded but default rules remain authoritative.

Defensible Answer:
The thresholds are transparent policy rules for early warning, not learned model parameters. They make the system explainable but should be calibrated with real outcomes.

Recommended Improvement:
Calibrate thresholds against finalized outcomes and school policy.

### Weakness 4: Behavioral engagement can escalate risk

Panel Question:
Can a student with good grades be marked high risk because of behavior?

Codebase Finding:
`behavioral_engagement_score < 60` triggers `HIGH_RISK`.

Defensible Answer:
Yes, low engagement can trigger review. It is intended as an early-warning signal, but it should be interpreted by teachers and not treated as an automatic punishment.

Recommended Improvement:
Add guardrails or require academic corroboration before high-risk escalation from engagement alone.

### Weakness 5: Component contribution is not experimentally isolated

Panel Question:
Which improves accuracy more: Written Work, Performance Task, or Quarterly Assessment?

Codebase Finding:
Feature importances exist, but no feature-ablation experiment for individual components is present for the deployed next-period model.

Defensible Answer:
The model uses all three and the Random Forest importance file ranks them highly, but the current codebase does not prove exact individual accuracy contribution.

Recommended Improvement:
Run ablation/permutation tests per component on a held-out set.

### Weakness 6: Prediction timing may still be early

Panel Question:
Is 50% completion/coverage enough?

Codebase Finding:
Runtime readiness allows `MINIMUM` at coverage >= 0.50 and completion >= 0.50.

Defensible Answer:
The system labels that as minimum readiness. The prediction is model-assisted and should be reviewed with evidence. More evidence produces stronger readiness labels.

Recommended Improvement:
Compare accuracy by readiness level and tune gates.

### Weakness 7: Runtime model-purpose mismatch risk

Panel Question:
Are you predicting next-term grade or current-term final grade?

Codebase Finding:
Runtime default model name is `entervene_next_period_grade_rf`, target `target_next_period_grade`. Separate current-period artifacts exist with target `target_final_period_grade`.

Defensible Answer:
The deployed runtime path defaults to the next-period model unless the active database model version is changed. The repository also contains current-period projection artifacts; defense should identify which active model is deployed before claiming target semantics.

Recommended Improvement:
Make model purpose explicit in API responses and UI copy.

## Task 1 Audit: Prediction Target, Historical Data Compatibility, and Transformation Pipeline

This section answers the separate Task 1 audit request. It is intentionally critical and treats executable runtime code as the source of truth.

### A. Real Active Prediction Target

Definitive classification:

**D. The repository contains both models, but the normal runtime path actually uses one default target path: the next-period grade model.**

What the runtime selects:

| Question | Finding | Source |
| --- | --- | --- |
| Which model is selected by default? | `entervene_next_period_grade_rf` | `backend/app/services/prediction/ModelScoringService.py`, `DEFAULT_MODEL_NAME` |
| Is `DEFAULT_MODEL_NAME` authoritative? | Yes for normal API calls when the request does not pass a different `model_name`. Request schemas also default to this same name. | `ModelScoringService.py`, `backend/app/schemas/Prediction.py`, `backend/app/api/v1/routes/Predictions.py` |
| Can `AIModelVersion` override it? | The database can choose the active artifact for the requested `model_name` and `model_type`, but it does not replace the code default model name. | `get_active_model_version()` and `AIModelVersion` |
| What target does the default model predict? | `target_next_period_grade`. | `backend/data/models/entervene_next_period_grade_rf_feature_schema.json`, `backend/data/models/entervene_next_period_grade_rf_training_report.json` |
| Does the request dynamically select current-period vs next-period prediction? | Not by purpose. A caller may pass `model_name`, but the normal from-records flow does not select a model based on target semantics. | `Predictions.py`, `Prediction.py` |
| Are there two runtime modes? | Not intentionally in the inspected executable flow. `prediction_mode` is a label from source/target period relationship, not a model selector. | `PredictionFeatureBuilderService.py` |
| Is one model an unused artifact? | The current-period artifact exists, but the normal live feature builder produces the next-period schema, not the current-period artifact schema. | current-period schema/report plus `PredictionFeatureBuilderService.py` |
| Does frontend/API understand target semantics? | The dashboard/detail UI displays `Predicted Grade` and risk fields. It does not consistently expose `target_next_period_grade` vs `target_final_period_grade` semantics to the user. | `frontend/src/lib/prediction-api.ts`, `prediction-detail-sheet.tsx`, dashboard pages |
| Could a current-period prediction be displayed as a next-period prediction or vice versa? | Yes, if persisted through the same generic prediction fields without explicit target-purpose metadata in the UI. The schema has generic fields such as `predicted_period_grade`. | API schemas, frontend prediction types |

Important nuance:

- `backend/data/models/entervene_current_period_grade_rf_v1_training_report.json` and its schema describe a current-period final-grade projection target, `target_final_period_grade`.
- That artifact has a different feature design from the normal live next-period builder. It expects current-period evidence features such as weights, activity counts, available evidence flags, and partial weighted scores.
- The inspected normal from-records runtime builds the 20-feature next-period style row, then validates against the active model schema. Therefore a current-period model cannot be safely assumed to work in the normal path unless the active database row, schema, and feature builder are aligned.
- Current seeded/active database state could not be directly verified from this environment because local database query tooling was unavailable. From source code, runtime requires an active `AIModelVersion` row for the requested model name; otherwise scoring fails.

### B. Old Quarter Data vs Current Three-Term Data

Training dataset behavior:

- `backend/app/ml/BuildTrainingDataset.py` builds next-period examples by grouping rows by student, subject, and school year, sorting by `period_sequence`, then using period N features to predict period N+1.
- The next-period target is `target_next_period_grade`.
- Historical records were quarter-based. The training report explicitly warns that the ML pack is quarter-based and that future three-term data should include period type, total periods in year, and period progress ratio.
- Runtime feature building normalizes source `period_sequence` with `(period_sequence / total_periods_in_year) * 4`, rounded to four decimals.
- That transformation was specifically designed to convert non-quarter period systems onto a four-quarter-equivalent progress scale. For example, a three-term year becomes roughly Term 1 = 1.3333, Term 2 = 2.6667, Term 3 = 4.0.

Compatibility classification:

| Feature | Compatibility | Reason |
| --- | --- | --- |
| `grade_level` | Directly compatible, with caveat | Same numeric concept, but only grade levels represented in training are well supported. |
| `period_sequence` | Compatible after transformation, but questionable | Runtime maps three terms to a four-quarter-equivalent progress scale. This helps numeric alignment but does not prove instructional duration equivalence. |
| `written_work_percent` | Questionable because of distribution shift | Same 0-100 style feature, but number/timing/type of works may differ between quarter and term structures. |
| `performance_task_percent` | Questionable because of distribution shift | Same 0-100 style feature, but term-level performance tasks may have different density or timing. |
| `quarterly_assessment_percent` | Questionable because of distribution shift | Same legacy feature name, but current exam structure has summative and term-exam subparts. Live prediction may pool scores differently from official gradebook computation. |
| `assessment_completion_rate` | Questionable | Training extracted data assumes complete period rows as `1.0`; runtime computes live completion from classwork evidence. |
| `source_period_grade` | Questionable but usable | Same grade scale, but source period meaning changes from quarter to term and training data lacks below-75 target examples. |
| `grade_trend_vs_previous_period` | Questionable | Quarter-to-quarter grade movement may not equal term-to-term movement because period length and assessment load differ. |
| `cumulative_period_grade_avg` | Questionable | Cumulative average is meaningful, but three terms and four quarters produce different averaging cadence. |
| `has_previous_period` | Directly compatible | Boolean signal, though first-term vs first-quarter context differs. |
| Subject one-hot features | Directly compatible only for known schema subjects | Unknown or unmapped subjects may fall to `subject_UNKNOWN` or all-zero behavior depending on schema and builder output. |
| Risk-only fields | Not ML compatibility features | `missing_activity_count`, `late_submission_count`, `data_coverage_ratio`, engagement, and attendance are used by risk/readiness, not the checked-in next-period Random Forest feature schema. |

Next-period comparability:

`Quarter 1 -> Quarter 2` is not proven equivalent to `Term 1 -> Term 2`. The code normalizes calendar progress, but it does not prove that the duration, teaching coverage, activity count, assessment mix, or grading behavior are statistically equivalent. The most accurate statement is:

**The code attempts mathematical period-progress normalization, but the current codebase does not provide experimental evidence that quarter-to-quarter historical transitions generalize cleanly to term-to-term transitions.**

Current-period projection comparability:

Historical partial-quarter to final-quarter examples may be more aligned with a current-term final-grade objective because the prediction question is "given partial evidence inside this same grading period, estimate the final grade for this grading period." However, the current-period artifact itself notes caveats: snapshots are reconstructed from historical activity order rather than true timestamps, and term systems may differ from the quarter-based historical pack. This is more defensible as a production objective, but it still needs true three-term validation.

### C. Assessment Component Transformation

Gradebook computation and prediction feature computation are related but not identical.

Official gradebook path:

- `StudentRecordService.resolve_subject_grading_weights()` resolves Written Work, Performance Task, and QA/Exam weights from templates.
- If no grading template is assigned, the fallback is 30% Written Work, 50% Performance Task, and 20% QA/Exam.
- `StudentRecordService._compute_exam_ps()` treats the exam component internally as:
  - Summative Test 1 = 30% of the exam component
  - Summative Test 2 = 30% of the exam component
  - Term/Major Examination = 40% of the exam component
- This 30/30/40 split is inside the exam component. It is not the same as the exam component's overall weight in the final grade.
- `_deped_grade()` combines the component percentages using the grading template weights, then applies transmutation.

Prediction feature path:

- `PredictionFeatureBuilderService._classwork_metrics()` maps classwork categories to legacy prediction components: `WRITTEN_WORK`, `PERFORMANCE_TASK`, and `QUARTERLY_ASSESSMENT`.
- It computes component percent as total earned points divided by total possible points for each mapped component.
- This live prediction path does not call `_compute_exam_ps()` and does not apply the 30/30/40 exam sub-split itself.
- If `StudentPeriodGrade` exists, missing component values may be filled from persisted period grade component columns. Those persisted values may already reflect official gradebook logic.

Defensible answer:

The model receives legacy component percentages, not raw individual quiz/activity/exam rows. For the exam component, the official gradebook can compute a 30/30/40 internal exam split, but the live prediction classwork feature path can also pool exam-like scores directly into `quarterly_assessment_percent`. That mismatch should be fixed before claiming the prediction feature always matches the official DepEd exam split.

### D. Raw Database to `model.predict()` Transformation

Execution path:

1. API receives `student_id`, `class_id`, `subject_id`, `source_period_id`, and optionally `target_period_id`.
2. `PredictionFeatureBuilderService.build_prediction_features_from_records()` loads student, class, subject, period, classwork, submissions, assessment rows, period grades, and attendance-derived risk data.
3. It builds academic model candidate features: grade level, normalized period sequence, component percentages, source grade, previous grade flag, grade trend, cumulative average, completion rate, and subject one-hot values.
4. It also builds risk/readiness values: missing activity count, late submission count, data coverage ratio, behavioral engagement score, cold-start flag, and attendance rate.
5. `check_prediction_readiness()` blocks model execution if the source grade is missing, completion is below 0.50, coverage is below 0.50, or unresolved evidence exists.
6. `ModelScoringService.score_student_prediction()` loads the active `AIModelVersion` for the requested/default model name.
7. `prepare_feature_row()` validates the feature schema, excludes prohibited target/display fields, fills allowed defaults, orders columns exactly as the schema requires, and converts values to numeric.
8. The joblib artifact's model calls `model.predict(feature_df)`.
9. The predicted grade is passed to `RiskEngine.evaluate_risk()` along with risk-only variables.
10. Persistence stores the generic `predicted_period_grade`, risk level, risk score, confidence, evidence snapshot, and model version reference.

Separation of variables:

| Category | Variables |
| --- | --- |
| ML features in next-period schema | `grade_level`, `period_sequence`, `has_previous_period`, `written_work_percent`, `performance_task_percent`, `quarterly_assessment_percent`, `assessment_completion_rate`, `source_period_grade`, `grade_trend_vs_previous_period`, `cumulative_period_grade_avg`, subject one-hot features |
| Risk/readiness variables, not next-period ML features | `missing_activity_count`, `late_submission_count`, `data_coverage_ratio`, `behavioral_engagement_score`, `behavioral_score_cold_start`, `risk_adjusted_attendance_rate` |
| Display/persistence variables | predicted grade, risk level, risk score, confidence, evidence snapshot, source/target periods, teacher review metadata |
| Prohibited target/leakage fields | `target_next_period_grade`, `target_final_period_grade`, `predicted_period_grade`, final grade target aliases |

### E. Recommended Single Production Objective

Best single production objective:

**Option 1: Partial Term N evidence -> projected final grade for Term N.**

Why this is the most defensible objective:

- It matches the intervention use case better. Teachers need warnings while the current term is still in progress.
- It avoids asking a quarter-trained next-period transition to generalize directly from `Quarter 1 -> Quarter 2` to `Term 1 -> Term 2`.
- It is easier to explain to a panel: "Using the student's current term evidence, we estimate the final grade for this same term."
- The repository already contains a current-period artifact and report with explicit target semantics, even though the normal runtime path is not fully wired to use it by purpose.

Critical limitation:

The current runtime default still points to `entervene_next_period_grade_rf`. If the project chooses current-term final-grade projection as the production objective, Task 2 should align the runtime default, model registry, feature builder, API labels, UI labels, and risk wording to that objective. Until then, do not claim the normal runtime is already a clean current-term final-grade system.

### F. Backend Documentation Conflicts

| Document | Current value | Conflict or limitation |
| --- | --- | --- |
| `docs/ML_HANDOFF.md` | Useful model handoff summary | Describes both next-period and current-period concepts, but inspected runtime defaults to next-period by model name and lacks purpose-based dynamic model selection. |
| `docs/tickets/TICKET-2026-PREDICTION-EVIDENCE-STAGE-1-REPORT.md` | Historical baseline audit | Useful as history, but not final source of truth after later evidence/readiness changes. |
| `docs/tickets/TICKET-2026-PREDICTION-EVIDENCE-STAGE-6-REPORT.md` | Later evidence-stage report | Useful for final evidence behavior and caveats, but it is still a ticket report rather than the executable source of truth. |
| `docs/tickets/TICKET-2026-PREDICTION-EVIDENCE-AUDIT.md` and phase docs | Planning/audit context | Should not be quoted as runtime truth unless checked against current code. |
| Current artifact reports | Stronger evidence than narrative docs | They identify target columns, metrics, feature schema, and warnings. They still do not prove deployed database active state. |

### G. Task 1 Answer in Defense Language

Use this answer if asked directly:

"The checked-in runtime default uses `entervene_next_period_grade_rf`, which predicts `target_next_period_grade`. The repository also contains a current-period final-grade projection artifact, but the normal from-records runtime does not automatically select between the two by prediction purpose. The API and UI mostly display a generic predicted grade, so we should not claim the system cleanly supports both targets until the model registry, feature builder, API response, and UI labels are aligned. For production, the more defensible target is current-term final-grade projection from partial current-term evidence, but that requires a Task 2 implementation alignment."

## 14. Safe To Claim

- The runtime default scoring path uses `entervene_next_period_grade_rf`.
- The checked-in next-period model is a `RandomForestRegressor`.
- The next-period model predicts `target_next_period_grade`.
- Runtime risk is rule-based, not direct Random Forest classification.
- Readiness blocks prediction when source grade, completion, or coverage is insufficient.
- Attendance and engagement affect risk scoring, not the checked-in next-period Random Forest feature vector.
- The teacher/admin dashboard displays persisted `AIPrediction` rows.
- Written Work, Performance Task, and Quarterly Assessment are model inputs in the next-period schema.
- The next-period artifact report shows MAE 1.4892, RMSE 2.0559, R2 0.6598 on a 395-row test split.
- The checked-in reports warn that models are not validated as failing-grade detectors because below-75 examples are absent.

## 15. Do Not Claim

- Do not claim the model is a validated dropout or failure classifier.
- Do not claim behavioral engagement improves ML accuracy unless a model artifact and experiment prove it.
- Do not claim attendance is used by the Random Forest next-period model.
- Do not claim demographic fairness has been proven.
- Do not claim interventions are proven to improve outcomes.
- Do not claim Written Work, Performance Task, or Quarterly Assessment individually cause a specific accuracy improvement percentage.
- Do not claim risk score is ML probability.
- Do not claim prediction appears automatically in the dashboard before `ai_prediction` rows are generated.
- Do not claim the current-period model is active in production without checking `ai_model_version`.

## 16. Important Code References

| Topic | File | Class/Function | Important logic |
| --- | --- | --- | --- |
| Feature extraction | `backend/app/services/prediction/PredictionFeatureBuilderService.py` | `build_prediction_features_from_records` | Builds live features from grades, classwork, attendance, period grades. |
| Category mapping | `backend/app/services/prediction/PredictionFeatureBuilderService.py` | `map_classwork_category` | Maps classwork/exam categories to WW/PT/QA. |
| Readiness | `backend/app/services/prediction/PredictionFeatureBuilderService.py` | `check_prediction_readiness` | Requires source grade, completion >= 0.50, coverage >= 0.50. |
| Insufficient response | `backend/app/services/prediction/PredictionFeatureBuilderService.py` | `insufficient_prediction_response` | Skips model and returns `INSUFFICIENT_DATA`. |
| Engagement | `backend/app/services/prediction/PredictionFeatureBuilderService.py` | `compute_behavioral_engagement_score` | Weighted available attendance/on-time/completion signals. |
| Attendance | `backend/app/services/attendance/AttendanceService.py` | `get_risk_adjusted_attendance_rate` | Present 1.0, excused 0.8, late 0.5, absent 0.0. |
| Feature permissions | `backend/app/services/prediction/FeatureCatalog.py` | `_GRADE_INPUTS`, `_RISK_FIELDS` | Separates ML model inputs from risk-only fields. |
| Model scoring | `backend/app/services/prediction/ModelScoringService.py` | `score_student_prediction` | Loads active model, predicts grade, invokes risk engine. |
| Feature row validation | `backend/app/services/prediction/ModelScoringService.py` | `prepare_feature_row` | Schema-ordered numeric row; excludes identity/leakage fields. |
| Risk scoring | `backend/app/services/prediction/RiskEngine.py` | `evaluate_default_rules`, `compute_risk_score` | Rule triggers, base scores, score increments, risk bands. |
| Persistence | `backend/app/services/prediction/PredictionPersistenceService.py` | `score_and_persist_prediction` | Writes `AIPrediction`, feature rows, evidence snapshot. |
| Transaction boundary | `backend/app/services/prediction/PredictionGenerationTransaction.py` | `run_prediction_generation_transaction` | Repeatable-read/advisory lock generation transaction. |
| API routes | `backend/app/api/v1/routes/Predictions.py` | `/from-records`, `/dashboard/at-risk`, `/{id}/detail` | Preview, persist, dashboard, detail endpoints. |
| Dashboard query | `backend/app/services/prediction/DashboardPredictionService.py` | `get_dashboard_at_risk_predictions` | Reads saved predictions, filters teacher/admin scope. |
| Gradebook weights | `backend/app/services/student_record/StudentRecordService.py` | `resolve_subject_grading_weights` | Template weights, fallback 30/50/20, normalized. |
| Gradebook grade | `backend/app/services/student_record/StudentRecordService.py` | `_deped_grade`, `_deped_transmuted` | Component percentages -> initial/transmuted grades. |
| Classwork component mapping | `backend/app/services/grading/ComponentMapper.py` | `classify_classwork_component` | Canonical WW/PT/Assessment mapping. |
| Next-period training | `backend/app/ml/Train.py` | `train_model`, `build_model` | RandomForestRegressor pipeline and metrics. |
| Next-period dataset | `backend/app/ml/BuildTrainingDataset.py` | `build_training_dataset` | Builds current-period-to-next-period rows. |
| Next-period artifact report | `backend/data/models/entervene_next_period_grade_rf_training_report.json` | n/a | Metrics and limitations. |
| Next-period schema | `backend/data/models/entervene_next_period_grade_rf_feature_schema.json` | n/a | Exact 20 model features. |
| Next-period feature importance | `backend/data/models/entervene_next_period_grade_rf_feature_importance.csv` | n/a | MDI importances. |
| Current-period artifact report | `backend/data/models/entervene_current_period_grade_rf_v1_training_report.json` | n/a | Current-period projection metrics and caveats. |
| Frontend dashboard | `frontend/src/pages/teacher/predictions.tsx` | `PredictionsDashboard` | Loads dashboard summaries and table. |
| Frontend grade view | `frontend/src/pages/teacher/grade-predictions.tsx` | `GradePredictions` | Grade-filtered prediction dashboard. |
| Frontend detail | `frontend/src/components/predictions/prediction-detail-sheet.tsx` | `PredictionDetailSheet` | Displays risk, grade, evidence, reviews, interventions. |
| Frontend API | `frontend/src/lib/prediction-api.ts` | `fetchDashboardAtRisk`, `fetchPredictionDetail` | Client calls to prediction endpoints. |

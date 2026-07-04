# Entervene ML / Prediction Handoff

This document is the ML-specific handoff for the next Codex session. It does not replace `docs/CODEX_HANDOFF.md`; that file still contains broader project context.

## Current Status

ML backend pipeline is complete through training, model registration, scoring, risk interpretation, prediction persistence, prediction API endpoints, automatic feature building from real Entervene records, outcome tracking, finalized-grade evaluation, teacher risk review, model performance summary, prediction detail, and read-only causes/recommended actions.

Completed:

```text
ML training: complete
Model registration: complete
Risk engine: complete
Model scoring: complete
Prediction persistence: complete
Prediction API endpoints: complete
Automatic feature builder from real records: complete
Prediction outcome tracking: complete
Finalized-grade outcome evaluation: complete
Teacher risk review: complete
Model performance summary: complete
Prediction detail read endpoint: complete
Read-only causes and recommended actions: complete
```

Ready next backend/ML work:

```text
Dashboard list/filter endpoint
Grading component integration
Persistent suggestion-to-prediction linking
Frontend prediction dashboard
Future classifier after real labels
```

Grading component integration is still important because `PredictionFeatureBuilderService` can compute ML features from records, but real teacher-created classwork, quiz, activity, project, and exam records must be consistently mapped to DepEd grading components:

```text
WRITTEN_WORK
PERFORMANCE_TASK
PERIODICAL_ASSESSMENT
```

Not ready yet:

```text
Frontend prediction dashboard is not implemented yet.
Persistent StudentSuggestion rows are not generated from predictions yet.
Persistent suggestion-to-prediction linking is not implemented yet.
Production classifier is not ready.
Accuracy/AUC/F1/Precision/Recall reporting is not valid yet.
Grading component integration is still needed for production-quality running-grade/component calculations.
```

## Core ML Approach

Entervene currently uses a **Random Forest regression prototype**, not an at-risk classifier.

The model predicts:

```text
target_next_period_grade
```

In runtime/API language, this appears as:

```text
predicted_period_grade
```

The system does not directly predict:

```text
AT_RISK / NOT_AT_RISK
```

Current active flow:

```text
E-Class Record / LMS academic records
-> feature builder
-> readiness check
-> RandomForestRegressor
-> predicted_period_grade
-> RiskEngine
-> risk_level / risk_score
-> ai_prediction persistence
-> prediction detail causes/actions
-> teacher review
-> finalized grade outcome evaluation
-> model performance summary
```

The current historical E-Class Record dataset contains **zero below-75 target examples**. Because of that:

- Accuracy is not the correct metric.
- AUC is not valid.
- Precision is not valid.
- Recall is not valid.
- F1 score is not valid.
- SMOTE/SMOTENC should not be used yet.
- A classifier should not be trained yet.

Current valid regression metrics:

```text
MAE: 1.4396
RMSE: 2.0984
R2: 0.6227
```

Plain explanation:

```text
The model predicts a grade number, like 87.81, not a category like at-risk or not-at-risk. The RiskEngine then interprets that predicted grade together with evidence such as grade trend, completion rate, missing activities, late submissions, and data coverage.
```

## Dataset Context

Local dataset folders:

```text
backend/data/datasets/entervene_interpreted_synthetic_csv_pack
backend/data/datasets/entervene_current_data_ml_optimized
```

These folders are ignored by Git.

Important data-safety notes:

- Student names and LRNs in the development dataset are synthetic placeholders.
- They were created only for development traceability.
- They are not real verified learner identities.
- They must not be imported into production as real students.
- Names/LRNs must not be used as model features.
- `PRIVATE_source_student_identity_map.csv` exists in the normalized pack but must not be printed or shared.

### Dataset Validation Summary

Normalized pack:

```text
00_import_manifest.csv: 12
01_academic_years.csv: 3
02_academic_periods.csv: 12
03_teachers.csv: 2
04_students_synthetic.csv: 289
05_classes.csv: 9
06_student_class_enrollments.csv: 289
07_subjects.csv: 8
08_subject_load_groups.csv: 12
09_subject_loads_by_period.csv: 48
10_assessments.csv: 400
11_student_assessment_scores.csv: 13115
12_student_period_grades.csv: 1564
13_student_final_grades.csv: 391
14_student_subject_period_features.csv: 1564
15_prototype_model_rows.csv: 1169
16_data_quality_issues.csv: 12
17_table_relationships.csv: 16
```

ML optimized pack:

```text
01_training_rows_readable.csv: 1169
02_random_forest_regression_matrix_all.csv: 1169
03_random_forest_regression_train.csv: 938
04_random_forest_regression_test.csv: 231
05_prediction_scoring_template.csv: 1
06_feature_dictionary.csv: 23
07_baseline_feature_importance.csv: 16
08_validation_summary.csv: 14
```

Important validation findings:

```text
ready_for_task_3 = true
below-75 count = 0
below-90 count = 273
train/test student overlap = 0
synthetic names/LRNs excluded from model features
quarterly_assessment_percent mapped to periodical_assessment_percent
period_type, total_periods_in_year, and period_progress_ratio are missing from ML train/test files and should be added later for three-term readiness
```

## Git Ignore Protection

`.gitignore` protects local datasets and generated model artifacts:

```gitignore
backend/data/datasets/
backend/data/dataset_validation/
backend/data/models/
backend/data/raw_eclass_records/
backend/data/normalized_eclass_records/
**/PRIVATE_source_student_identity_map.csv
__pycache__/
*.py[cod]
.pytest_cache/
```

## Completed Tasks

### Task 1 - ML Database Foundation

Created models:

```text
backend/app/models/academic/AssessmentItem.py
backend/app/models/academic/StudentAssessmentScore.py
backend/app/models/academic/StudentPeriodGrade.py
backend/app/models/ai/AIModelVersion.py
backend/app/models/ai/RiskThreshold.py
backend/app/models/ai/AIPrediction.py
backend/app/models/ai/AIPredictionFeature.py
backend/app/models/ai/TeacherRiskReview.py
backend/app/models/ai/PredictionOutcome.py
```

Migration:

```text
backend/migrations/versions/20260621_add_ml_prediction_foundation.py
```

Validation:

```text
alembic upgrade head: passed
pytest -q: 161 passed, 5 warnings
```

### Task 2A - Dataset Validation

Created:

```text
backend/app/ml/DatasetPackValidator.py
backend/tests/test_dataset_pack_validator.py
```

Tests:

```text
pytest tests/test_dataset_pack_validator.py -q: 11 passed
pytest -q: 172 passed, 5 warnings
```

### Task 3 - Train RandomForestRegressor

Modified:

```text
backend/app/ml/Train.py
```

Created:

```text
backend/tests/test_ml_train.py
```

Generated ignored artifacts:

```text
backend/data/models/entervene_next_period_grade_rf.joblib
backend/data/models/entervene_next_period_grade_rf_training_report.json
backend/data/models/entervene_next_period_grade_rf_feature_schema.json
backend/data/models/entervene_next_period_grade_rf_feature_importance.csv
```

Training behavior:

```text
loads 03_random_forest_regression_train.csv
loads 04_random_forest_regression_test.csv
detects target_next_period_grade
excludes identity/leakage columns
trains RandomForestRegressor
writes model artifact, training report, feature schema, and feature importance
```

Training results:

```text
target_column: target_next_period_grade
feature_count: 16
mapped: quarterly_assessment_percent -> periodical_assessment_percent
MAE: 1.4396
RMSE: 2.0984
R2: 0.6227
train/test student overlap: 0
ready_for_task_4: true
```

Tests:

```text
pytest tests/test_ml_train.py -q: 7 passed
pytest -q: 179 passed, 5 warnings
```

### Task 4 - Register Model Metadata

Created:

```text
backend/app/ml/RegisterModelVersion.py
backend/app/services/prediction/ModelVersionService.py
backend/tests/test_register_model_version.py
```

Registered active model:

```text
model_name: entervene_next_period_grade_rf
model_type: REGRESSOR
algorithm: RandomForestRegressor
artifact_path: data/models/entervene_next_period_grade_rf.joblib
MAE: 1.4396
RMSE: 2.0984
R2: 0.6227
is_active: true
```

Tests:

```text
pytest tests/test_register_model_version.py -q: 10 passed
pytest -q: 189 passed, 5 warnings
```

### Task 5 - Risk Engine

Created:

```text
backend/app/services/prediction/RiskEngine.py
backend/tests/test_risk_engine.py
```

Risk levels:

```text
INSUFFICIENT_DATA
LOW_RISK
NEEDS_MONITORING
MODERATE_RISK
HIGH_RISK
```

Priority order:

```text
INSUFFICIENT_DATA > HIGH_RISK > MODERATE_RISK > NEEDS_MONITORING > LOW_RISK
```

Tests:

```text
pytest tests/test_risk_engine.py -q: 14 passed
pytest -q: 203 passed, 5 warnings
```

### Task 6 - Model Scoring Service

Created:

```text
backend/app/services/prediction/ModelScoringService.py
backend/app/ml/ScorePrediction.py
backend/tests/test_model_scoring_service.py
```

Behavior:

```text
active AI_MODEL_VERSION
-> load joblib artifact
-> load feature schema
-> prepare one feature row
-> predict predicted_period_grade
-> call RiskEngine
-> return structured prediction output
```

Tests:

```text
pytest tests/test_model_scoring_service.py -q: 12 passed
pytest -q: 215 passed, 5 warnings
```

### Task 7 - Prediction Persistence

Created:

```text
backend/app/services/prediction/PredictionPersistenceService.py
backend/app/ml/SavePrediction.py
backend/tests/test_prediction_persistence_service.py
```

Behavior:

```text
validates student/class/subject/period identifiers
calls score_student_prediction
saves ai_prediction and ai_prediction_feature rows
avoids duplicate saved predictions unless replace_existing=True
```

Tests:

```text
pytest tests/test_prediction_persistence_service.py -q: 10 passed
pytest -q: 225 passed, 5 warnings
```

### Task 8 - Prediction API Endpoints

Created:

```text
backend/app/schemas/Prediction.py
backend/tests/test_prediction_routes.py
```

Modified:

```text
backend/app/api/v1/routes/Predictions.py
```

Endpoints:

```text
POST /api/v1/predictions/preview
POST /api/v1/predictions
GET /api/v1/predictions/latest
GET /api/v1/predictions/classes/{class_id}/risks
GET /api/v1/predictions/{prediction_id}/features
```

Endpoint behavior:

```text
POST /preview:
calls ModelScoringService.score_student_prediction and does not save.

POST /predictions:
calls PredictionPersistenceService.score_and_persist_prediction and saves ai_prediction / ai_prediction_feature rows.

GET /latest:
fetches the latest saved prediction for a student/class/subject, with optional period/model filters.

GET /classes/{class_id}/risks:
lists saved predictions with subject, period, risk_level, limit, and offset filters.

GET /{prediction_id}/features:
lists saved feature evidence rows for one prediction.
```

Tests:

```text
tests/test_prediction_routes.py -q: 12 passed
related regression/risk tests: 37 passed
full backend suite after Task 8: 282 passed, 5 warnings
```

### Task 9 - Prediction Feature Builder and Readiness Service

Created:

```text
backend/app/services/prediction/PredictionFeatureBuilderService.py
backend/tests/test_prediction_feature_builder_service.py
```

Modified:

```text
backend/app/api/v1/routes/Predictions.py
backend/app/schemas/Prediction.py
backend/tests/test_prediction_routes.py
```

Service functions:

```text
build_prediction_features_from_records(...)
check_prediction_readiness(...)
insufficient_prediction_response(...)
```

New endpoints:

```text
POST /api/v1/predictions/build-features
POST /api/v1/predictions/from-records/preview
POST /api/v1/predictions/from-records
```

Task 9 flow:

```text
student_id/class_id/subject_id/source_period_id/target_period_id
-> collect StudentPeriodGrade, AssessmentItem, StudentAssessmentScore, and classwork submission records
-> compute ML features
-> check readiness
-> if insufficient, return INSUFFICIENT_DATA without calling the model
-> if ready, call scoring or persistence service
```

Tests:

```text
tests/test_prediction_feature_builder_service.py -q: 13 passed
tests/test_prediction_routes.py -q: 18 passed
related regression/risk tests: 37 passed
full backend suite after Task 9: 301 passed, 5 warnings
```

## Post-Task 9 Backend Prediction/Outcome Polish

### A. Prediction Outcome Evaluation

Added/changed:

```text
backend/app/models/ai/PredictionOutcome.py
backend/app/services/prediction/PredictionOutcomeService.py
backend/migrations/versions/20260703_add_prediction_outcome_evaluation_fields.py
backend/tests/test_prediction_outcome_service.py
```

Purpose:

```text
After a prediction is made, the system can later compare the predicted grade against the actual finalized grade.
```

Computed fields:

```text
prediction_error = actual_period_grade - predicted_period_grade
absolute_error = abs(actual_period_grade - predicted_period_grade)
actual_passed = actual_period_grade >= passing_grade
actual_risk_label = LOW_RISK if passed, HIGH_RISK if below passing for now
outcome_status = EVALUATED
evaluated_at
```

This is regression-safe outcome tracking. It does not make classifier metrics valid yet. It only tracks how close the predicted grade was to the actual grade.

### B. Manual Outcome Evaluation Endpoint

Endpoint:

```text
POST /api/v1/predictions/{prediction_id}/outcome/evaluate
```

Request:

```json
{
  "actual_period_grade": 86.5,
  "passing_grade": 75
}
```

Response includes:

```text
outcome_id
prediction_id
actual_period_grade
predicted_period_grade
prediction_error
absolute_error
actual_passed
actual_risk_label
outcome_status
evaluated_at
```

Changed:

```text
backend/app/schemas/Prediction.py
backend/app/api/v1/routes/Predictions.py
backend/tests/test_prediction_routes.py
```

### C. Finalized Grade Outcome Helper

Service helper:

```text
evaluate_outcomes_for_finalized_period_grade(...)
```

Purpose:

```text
When a StudentPeriodGrade is finalized, the system can find matching predictions and evaluate their outcomes.
```

Safe matching rule:

```text
student_id
class_id
subject_id
AIPrediction.target_period_id == StudentPeriodGrade.academic_period_id
```

### D. StudentPeriodGrade Finalization Workflow

Fields added to `StudentPeriodGrade`:

```text
is_finalized
finalized_at
finalized_by_staff_id
```

Migration:

```text
backend/migrations/versions/20260703_add_student_period_grade_finalization.py
```

Endpoint:

```text
POST /api/v1/student-records/period-grades/{period_grade_id}/finalize
```

Request:

```json
{
  "final_period_grade": 86.5,
  "passing_grade": 75
}
```

Purpose:

```text
This finalizes an existing StudentPeriodGrade row and automatically triggers prediction outcome evaluation.
```

Important limitation: this finalizes existing `StudentPeriodGrade` rows only. It does not create period-grade rows from scratch or implement a full grading module.

Changed:

```text
backend/app/models/academic/StudentPeriodGrade.py
backend/app/schemas/StudentRecord.py
backend/app/services/student_record/StudentRecordService.py
backend/app/api/v1/routes/StudentRecords.py
backend/tests/test_student_period_grade_finalization.py
backend/tests/test_prediction_outcome_grade_finalization.py
```

### E. Teacher Risk Review Workflow

Model already existed:

```text
backend/app/models/ai/TeacherRiskReview.py
```

Migration:

```text
backend/migrations/versions/20260703_update_teacher_risk_review_decisions.py
```

Allowed decisions:

```text
CONFIRMED_RISK
DISMISSED_RISK
NEEDS_MORE_DATA
INTERVENTION_ASSIGNED
ESCALATED
```

Service:

```text
backend/app/services/prediction/TeacherRiskReviewService.py
```

Endpoint:

```text
POST /api/v1/predictions/{prediction_id}/teacher-review
```

Request:

```json
{
  "decision": "CONFIRMED_RISK",
  "teacher_notes": "Student has missed multiple classworks and needs remediation."
}
```

Purpose:

```text
The AI prediction remains decision support only. The teacher/admin records whether they confirm, dismiss, need more data, assigned intervention, or escalated the risk.
```

Idempotency rule:

```text
One review per prediction_id + staff_id. A repeated review by the same staff member updates the existing review instead of duplicating it.
```

### F. Model Performance Summary

Service:

```text
backend/app/services/prediction/ModelPerformanceService.py
```

Endpoint:

```text
GET /api/v1/predictions/model-performance
```

Supported query params:

```text
model_version_id
class_id
subject_id
academic_period_id mapped to AIPrediction.target_period_id
```

Response includes:

```text
total_evaluated_predictions
mae
rmse
mean_prediction_error
min_absolute_error
max_absolute_error
actual_risk_label_counts
predicted_risk_level_counts
by_model_version
```

Formulas:

```text
MAE = average(absolute_error)
RMSE = sqrt(average(prediction_error^2))
mean_prediction_error = average(prediction_error)
```

These are still regression-safe metrics. Do not describe this as production classifier accuracy. Risk-label counts are descriptive only, not precision/recall/F1/AUC.

Changed:

```text
backend/app/services/prediction/ModelPerformanceService.py
backend/app/schemas/Prediction.py
backend/app/api/v1/routes/Predictions.py
backend/tests/test_model_performance_summary.py
```

### G. Prediction Detail and Teacher Review Read Endpoints

Service:

```text
backend/app/services/prediction/PredictionReadService.py
```

Endpoints:

```text
GET /api/v1/predictions/{prediction_id}/detail
GET /api/v1/predictions/{prediction_id}/teacher-review
```

Prediction detail returns:

```text
prediction core fields
model version
features
outcome if available
teacher_reviews
current_user_review
```

Teacher review read endpoint returns:

```json
{
  "prediction_id": 1,
  "teacher_reviews": [],
  "current_user_review": null
}
```

Changed:

```text
backend/app/services/prediction/PredictionReadService.py
backend/app/schemas/Prediction.py
backend/app/api/v1/routes/Predictions.py
backend/tests/test_prediction_read_endpoints.py
```

### H. Prediction Causes and Recommended Actions

Service:

```text
backend/app/services/prediction/PredictionExplanationService.py
```

Prediction detail now includes:

```text
causes: []
recommended_actions: []
```

Sample causes:

```text
LOW_COMPLETION_RATE
MISSING_WORK
LOW_ASSESSMENT_AVERAGE
DECLINING_TREND
LOW_DATA_COVERAGE
HIGH_RISK_SCORE
PREDICTED_BELOW_PASSING
INSUFFICIENT_DATA
```

Sample recommended actions:

```text
ASSIGN_REMEDIAL_ACTIVITY
REVIEW_MISSING_CLASSWORKS
SCHEDULE_TEACHER_FOLLOW_UP
GIVE_TARGETED_PRACTICE
MONITOR_NEXT_SUBMISSIONS
COLLECT_MORE_DATA
```

These are read-only, system-derived recommendation previews. They do not create `StudentSuggestion` rows, assign interventions automatically, or link persistent suggestions to predictions yet.

Changed:

```text
backend/app/services/prediction/PredictionExplanationService.py
backend/app/services/prediction/PredictionReadService.py
backend/app/schemas/Prediction.py
backend/tests/test_prediction_detail_explanations.py
```

## Mathematical Explanation of the Prediction Pipeline

### Prediction Features Are Inputs

Prediction features are the input variables passed into the model. Examples:

```text
source_period_grade
written_work_percent
performance_task_percent
periodical_assessment_percent
assessment_completion_rate
missing_activity_count
late_submission_count
data_coverage_ratio
grade_trend_vs_previous_period
has_previous_period
```

These are different from evaluation metrics. Features are values used to make a prediction. Metrics such as MAE, RMSE, and R2 are used after training/testing to evaluate how good the predictions were.

### Component Percentage Formulas

Component percentages come from DepEd-style E-Class Record grading components.

```text
written_work_percent =
(total written work score earned / total written work max score) * 100
```

```text
performance_task_percent =
(total performance task score earned / total performance task max score) * 100
```

```text
periodical_assessment_percent =
(total periodical assessment score earned / total periodical assessment max score) * 100
```

The raw E-Class Record may show item groups under:

```text
Written Works
Performance Tasks
Quarterly Assessment
```

In Entervene, teacher-created classwork, quiz, assignment, activity, project, and exam records should eventually map consistently to:

```text
WRITTEN_WORK
PERFORMANCE_TASK
PERIODICAL_ASSESSMENT
```

Current Task 9 implementation uses `AssessmentItem.component_type` as the primary source for these component-level calculations. Classwork due dates/submissions are currently used for late-submission evidence, not for weighted component score calculation.

### Source Period Grade Formula

The service computes `source_period_grade` using the best available source:

```text
1. Prefer StudentPeriodGrade.final_period_grade.
2. If final is missing, use StudentPeriodGrade.transmuted_grade.
3. If transmuted is missing, use StudentPeriodGrade.initial_grade.
4. If no period grade exists, compute a running grade from available component percentages.
5. If no grade or component percentages exist, use None.
```

Current implemented running-grade fallback:

```text
running_grade = average(available component percentages)
```

Example:

```text
available values = written_work_percent, performance_task_percent
running_grade = (written_work_percent + performance_task_percent) / 2
```

Important: the current service does **not yet** apply DepEd component weights in the running-grade fallback. For the sample ICT E-Class Record style, conceptual weights may be:

```text
Written Works = 20%
Performance Tasks = 60%
Quarterly Assessment = 20%
```

Conceptual weighted formula:

```text
running_grade =
(written_work_percent * 0.20)
+ (performance_task_percent * 0.60)
+ (periodical_assessment_percent * 0.20)
```

A future grading component integration task should align teacher-created records and component weights so production running-grade behavior can follow the correct grading policy. If one component is missing early in the quarter, the current implementation averages only the available component percentages and emits a warning that the source period grade was estimated from available assessment component percentages.

### Completion, Missing, Late, and Coverage Formulas

Current implementation:

```text
expected_assessment_count =
count of AssessmentItem rows for class_id + subject_id + source_period_id
```

```text
recorded_assessment_count =
count of matching StudentAssessmentScore rows with score_status = RECORDED and raw_score not null
```

```text
submitted_assessment_count =
same as recorded_assessment_count in the current AssessmentItem-based implementation
```

```text
missing_activity_count =
count of expected assessment items with no score row, score_status = MISSING_NOT_ENCODED, or score_status = ABSENT
```

```text
assessment_completion_rate =
submitted_assessment_count / expected_assessment_count
```

```text
data_coverage_ratio =
recorded_assessment_count / expected_assessment_count
```

```text
late_submission_count =
count of published classwork submissions where submitted_at > due_date, or status is late
```

If there are no classwork due dates, `late_submission_count` defaults to 0 and the service returns a warning.

### Prediction Readiness

Prediction is not forced when evidence is insufficient.

The service returns `INSUFFICIENT_DATA` without calling the model if:

```text
data_coverage_ratio < 0.50
or assessment_completion_rate < 0.50
or source_period_grade is missing
```

Readiness levels:

```text
INSUFFICIENT:
coverage < 0.50, completion < 0.50, or no source grade

MINIMUM:
coverage >= 0.50 and < 0.70

GOOD:
coverage >= 0.70 and < 0.85

STRONG:
coverage >= 0.85
```

### Grade Trend Formula

```text
grade_trend_vs_previous_period =
source_period_grade - previous_period_grade
```

If no previous period grade exists:

```text
has_previous_period = false
grade_trend_vs_previous_period = None
```

This does not automatically block prediction if enough current-period evidence exists.

### Prediction Mode

The feature builder reports:

```text
CURRENT_PERIOD_PROJECTION
```

when the source period is active, the target period is missing, or the target period is the same as the source period.

It reports:

```text
NEXT_PERIOD_PREDICTION
```

when the source period is complete and the target period is later.

### Random Forest Regression Math

The model is:

```text
RandomForestRegressor
```

It contains many decision trees. In the current training code:

```text
n_estimators = 300
```

The prediction is approximately:

```text
predicted_period_grade =
(tree_1_prediction + tree_2_prediction + ... + tree_300_prediction) / 300
```

The model does not use one fixed manual weight like linear regression. Each tree makes decisions based on feature thresholds. The forest averages all tree outputs to reduce overfitting and improve stability.

### Feature Importance

Feature importance is not the same as DepEd grading weight.

DepEd grading weight example:

```text
Written Works = 20%
Performance Tasks = 60%
Quarterly Assessment = 20%
```

Random Forest feature importance means:

```text
How much a feature helped reduce prediction error across the decision trees.
```

Generated file:

```text
backend/data/models/entervene_next_period_grade_rf_feature_importance.csv
```

This is model-level explanation, not exact per-student SHAP contribution. Current `ai_prediction_feature` rows store feature evidence values. `feature_contribution` may still be null.

## Regression Evaluation Metrics

Evaluation metrics do not make the prediction. They evaluate how close model predictions are to actual next-period grades on the test set.

For each test row:

```text
error_i = actual_i - predicted_i
```

### MAE

```text
MAE = mean(|actual_i - predicted_i|)
```

Meaning:

```text
Average absolute grade-point error.
Current MAE: 1.4396
The model is off by about 1.44 grade points on average.
```

### RMSE

```text
RMSE = sqrt(mean((actual_i - predicted_i)^2))
```

Meaning:

```text
Penalizes larger errors more heavily.
Current RMSE: 2.0984
```

### R2

```text
R2 = 1 - SS_res / SS_tot
```

Where:

```text
SS_res = sum((actual_i - predicted_i)^2)
SS_tot = sum((actual_i - mean_actual)^2)
```

Meaning:

```text
Explains how much variance in the target is captured by the model.
Current R2: 0.6227
The model explains about 62.27% of the variation in next-period grades in the test set.
```

Classification metrics are not valid for the current regression model:

```text
Accuracy
AUC
Precision
Recall
F1
```

They become valid only if the project later trains a classifier using real teacher-confirmed risk labels or enough real below-threshold outcomes.

## RiskEngine Math

The RiskEngine is rule-based and runs after the Random Forest prediction.

Flow:

```text
predicted_period_grade + academic evidence
-> triggered rules
-> risk_level
-> risk_score
```

Risk levels:

```text
INSUFFICIENT_DATA
LOW_RISK
NEEDS_MONITORING
MODERATE_RISK
HIGH_RISK
```

Priority:

```text
INSUFFICIENT_DATA > HIGH_RISK > MODERATE_RISK > NEEDS_MONITORING > LOW_RISK
```

Rough score bands:

```text
INSUFFICIENT_DATA: 0
LOW_RISK: up to 24
NEEDS_MONITORING: 25 to 49
MODERATE_RISK: 50 to 74
HIGH_RISK: 75 to 100
```

Risk score starts from the selected risk level's base score and increases based on signals such as:

```text
lower predicted grade
negative grade trend
low completion rate
missing activities
late submissions
multiple triggered rules
```

The risk score is not produced directly by the Random Forest. It is produced by `RiskEngine.py`.

## Current Full Backend ML Flow

```text
1. Historical E-Class Record workbooks are converted into normalized CSVs.
2. ML train/test matrices are created from normalized grade data.
3. Train.py trains RandomForestRegressor to predict target_next_period_grade.
4. RegisterModelVersion.py stores model metadata into ai_model_version.
5. PredictionFeatureBuilderService builds features from real Entervene records.
6. Readiness logic checks data coverage, completion rate, and source grade.
7. ModelScoringService loads the active model and predicts predicted_period_grade.
8. RiskEngine converts predicted grade + academic evidence into risk_level and risk_score.
9. PredictionPersistenceService saves ai_prediction and ai_prediction_feature rows.
10. Prediction detail can show feature evidence.
11. PredictionExplanationService derives user-friendly causes and recommended actions.
12. Teacher/admin can review the prediction through TeacherRiskReview.
13. StudentPeriodGrade can be finalized.
14. Finalized grades trigger PredictionOutcome evaluation.
15. PredictionOutcome stores prediction_error, absolute_error, actual_passed, and actual_risk_label.
16. ModelPerformanceService summarizes MAE, RMSE, mean error, risk counts, and performance by model version.
17. Predictions.py exposes scoring, saving, from-records prediction, latest prediction, class risk list, feature evidence, outcome evaluation, teacher review, model performance, and detail endpoints.
```

Text flow diagram:

```text
Academic records
-> feature builder
-> readiness check
-> RandomForestRegressor
-> predicted_period_grade
-> RiskEngine
-> risk_level/risk_score
-> save prediction + features
-> prediction detail shows causes/actions
-> teacher review
-> grade finalization
-> outcome evaluation
-> model performance summary
```

## Important Commands

General:

```bash
cd backend
alembic upgrade head
backend/.venv/Scripts/python.exe -m pytest -q
```

Dataset validation:

```bash
python -m app.ml.DatasetPackValidator --normalized-dir data/datasets/entervene_interpreted_synthetic_csv_pack --ml-dir data/datasets/entervene_current_data_ml_optimized --output-dir data/dataset_validation
```

Training:

```bash
python -m app.ml.Train --ml-dir data/datasets/entervene_current_data_ml_optimized --output-dir data/models --model-name entervene_next_period_grade_rf
```

Register model:

```bash
python -m app.ml.RegisterModelVersion --training-report data/models/entervene_next_period_grade_rf_training_report.json --feature-schema data/models/entervene_next_period_grade_rf_feature_schema.json --artifact-path data/models/entervene_next_period_grade_rf.joblib --model-name entervene_next_period_grade_rf --activate
```

Score only:

```bash
python -m app.ml.ScorePrediction --model-name entervene_next_period_grade_rf --input-json data/models/sample_prediction_input.json
```

Score and save:

```bash
python -m app.ml.SavePrediction --model-name entervene_next_period_grade_rf --input-json data/models/sample_prediction_persist_input.json --replace-existing
```

Current test commands:

```bash
cd backend
backend/.venv/Scripts/python.exe -m pytest tests/test_prediction_feature_builder_service.py -q
backend/.venv/Scripts/python.exe -m pytest tests/test_prediction_routes.py -q
backend/.venv/Scripts/python.exe -m pytest tests/test_model_scoring_service.py tests/test_prediction_persistence_service.py tests/test_risk_engine.py -q
backend/.venv/Scripts/python.exe -m pytest tests/test_prediction_outcome_service.py -q
backend/.venv/Scripts/python.exe -m pytest tests/test_prediction_outcome_grade_finalization.py -q
backend/.venv/Scripts/python.exe -m pytest tests/test_student_period_grade_finalization.py -q
backend/.venv/Scripts/python.exe -m pytest tests/test_teacher_risk_review.py -q
backend/.venv/Scripts/python.exe -m pytest tests/test_model_performance_summary.py -q
backend/.venv/Scripts/python.exe -m pytest tests/test_prediction_read_endpoints.py -q
backend/.venv/Scripts/python.exe -m pytest tests/test_prediction_detail_explanations.py -q
backend/.venv/Scripts/python.exe -m pytest -q
```

Latest known results:

```text
Task 1 outcome service: focused tests passed
Task 2 outcome route: focused tests passed
Task 3 grade-finalized helper: focused tests passed
Task 3.5 student period grade finalization: focused tests passed
Task 4 teacher risk review: focused tests passed
Task 5 model performance summary: focused tests passed
Task 6 prediction read endpoints: focused tests passed
Task 7 prediction detail explanations: focused tests passed
Full backend suite after Task 7 backend polish: 454 passed, 5 warnings
```

Warnings are existing SQLAlchemy/Pydantic deprecation warnings.

## Current Limitations

```text
1. The active ML model is still regression-only.
2. It is not a validated at-risk classifier.
3. The historical dataset has zero below-75 target examples.
4. Accuracy/AUC/F1/Precision/Recall are still not valid.
5. The model predicts grade; RiskEngine interprets risk.
6. actual_risk_label in PredictionOutcome is currently pass/fail-derived using the passing threshold.
7. Recommended actions in prediction detail are read-only previews and do not create StudentSuggestion records.
8. TeacherRiskReview records teacher/admin judgment but does not automatically create interventions.
9. Persistent intervention assignment and completion tracking from predictions are still future work.
10. Production reliability still depends on consistent grading component mapping.
11. Frontend dashboard is not yet implemented.
12. Synthetic names/LRNs remain development placeholders only.
13. Current model artifacts/datasets are ignored by Git.
```

## Next Recommended Backend/ML Tasks

### 1. Backend Dashboard List/Filter Endpoint for Prediction Dashboard

```text
Purpose:
Let frontend load at-risk students by class, subject, target period, risk level, model version, and review status.
```

### 2. Grading Component Integration for Classwork, Quiz, and Assessment Records

```text
Purpose:
Ensure teacher-created records consistently map to:
- WRITTEN_WORK
- PERFORMANCE_TASK
- PERIODICAL_ASSESSMENT
```

### 3. Persistent Suggestion-to-Prediction Linking

```text
Purpose:
Connect predictions to generated StudentSuggestion / SuggestionClasswork records later.
```

### 4. Frontend Prediction Dashboard

```text
Purpose:
Show risk list, prediction detail, causes, recommended actions, teacher review, outcome, and model-performance summary.
```

### 5. Future Classifier Only After Real Labels

```text
Purpose:
Train classifier only after enough real below-75 or teacher-confirmed at-risk outcomes exist.
```

## Defense Explanation

The Random Forest model predicts a future grade number. It does not directly decide whether a learner is at risk.

`RiskEngine` converts that predicted grade plus academic evidence into a risk level and risk score. Prediction features explain what evidence was used. Prediction causes convert raw feature evidence into teacher-friendly reasons. Recommended actions are read-only system suggestions.

`TeacherRiskReview` records the teacher/admin decision. `PredictionOutcome` compares the predicted grade to the actual finalized grade. `ModelPerformanceService` summarizes how close the model was using MAE, RMSE, and mean error.

The system does not claim classifier accuracy yet because the current dataset has no below-75 examples.

## Worktree Note

`frontend/package-lock.json` may be modified in the worktree but is unrelated to the ML task unless intentionally changed.

## Final Summary

Current status:

```text
ML backend pipeline is complete through training, model registration, scoring, risk interpretation, prediction persistence, automatic feature building/readiness checks from real Entervene records, outcome tracking, finalized-grade evaluation, teacher risk review, model performance summary, prediction detail, and read-only causes/recommended actions.
```

Ready next:

```text
Backend dashboard list/filter endpoint, grading component integration, persistent suggestion-to-prediction linking, frontend prediction dashboard, and future classifier work only after real labels.
```

Not ready yet:

```text
Frontend prediction dashboard, persistent StudentSuggestion generation/linking from predictions, production classifier, Accuracy/AUC/F1/Precision/Recall reporting, and production-quality grading component integration.
```

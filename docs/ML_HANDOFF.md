# Entervene ML System Documentation

> How the prediction and at-risk detection system works, end to end.

---

## 1. What the System Does (Overview)

Entervene uses a **Machine Learning model** to predict a student's **next period grade** and then uses a **rule-based Risk Engine** to classify that student into a risk level. This helps teachers identify students who may be struggling early, so they can provide timely interventions.

```
Student academic records (grades, scores, submissions)
    ↓
Feature Builder (computes 16 ML features from records)
    ↓
Random Forest Regressor (predicts next period grade)
    ↓
Risk Engine (classifies risk level based on predicted grade + evidence)
    ↓
Result: risk_level, risk_score, causes, recommended actions
    ↓
Saved to database → shown on teacher dashboard → teacher reviews/assigns intervention
```

---

## 2. The ML Algorithm

### Model: Random Forest Regressor

| Property | Value |
|---|---|
| Algorithm | `RandomForestRegressor` (scikit-learn) |
| Type | **Regression** (predicts a number, not a category) |
| Target variable | `target_next_period_grade` (the student's grade in the next quarter) |
| Number of trees | 300 |
| Missing value strategy | Median imputation |
| Random state | 42 (for reproducibility) |

**Key point:** The model does **NOT** directly predict "at-risk" or "not at-risk." It predicts a **grade number** (e.g., 87.5), then the Risk Engine interprets whether that grade is concerning.

### Why Regression Instead of Classification?

The training dataset contains **zero below-75 grade examples** (all students passed). Without actual failing examples, a binary classifier (at-risk vs. not-at-risk) cannot learn what a failing student looks like. Instead, the system:

1. Predicts the **numeric grade** using regression
2. Uses a **rule-based Risk Engine** to interpret the predicted grade along with other evidence

This approach works because even without failing examples, the model can identify students trending toward lower grades, which the Risk Engine flags.

---

## 3. Training Data

### Data Source

The training data comes from **real E-Class Record workbooks** (DepEd electronic class records) that were extracted, anonymized, and processed into ML-ready CSV files.

### Dataset Numbers

| Item | Count |
|---|---|
| Total training rows | 1,580 |
| Total test rows | 395 |
| Unique students (train) | 448 |
| Unique students (test) | 113 |
| Student overlap between train/test | **0** (no data leakage) |
| Below-75 grade examples | **0** (all students passed) |

### How Data Was Prepared

```
E-Class Record Excel workbooks
    ↓
Extraction & anonymization (synthetic IDs, no real names/LRNs)
    ↓
Normalized CSV pack (17 CSV files: students, classes, grades, assessments, etc.)
    ↓
ML-optimized pack (feature engineering, train/test split by student)
    ↓
03_random_forest_regression_train.csv  (938 rows)
04_random_forest_regression_test.csv   (231 rows)
```

### Data Validity

- **Student identity separation**: Train and test sets are split by student (0 overlap), preventing data leakage.
- **Anonymized**: Student names and LRNs in the dataset are synthetic — they are NOT real student identities.
- **Below-75 limitation**: The dataset has no failing examples. This means:
  - The model has never seen what a failing student's data looks like
  - Classification metrics (Accuracy, AUC, Precision, Recall, F1) are **not valid** for at-risk detection
  - The model's lowest predicted grade was **83.46** (still above passing)

---

## 4. The 16 Features (Model Inputs)

These are the inputs the model uses to predict the next period grade, ranked by importance:

| Rank | Feature | Importance | Description |
|---|---|---|---|
| 1 | `source_period_grade` | 56.5% | Student's current period grade |
| 2 | `cumulative_period_grade_avg` | 18.7% | Average of all previous period grades |
| 3 | `written_work_percent` | 6.7% | Written work component percentage |
| 4 | `quarterly_assessment_percent` | 4.9% | Quarterly exam/assessment percentage |
| 5 | `performance_task_percent` | 4.0% | Performance task component percentage |
| 6 | `grade_trend_vs_previous_period` | 2.5% | Grade change from previous period |
| 7 | `period_sequence` | 2.4% | Which quarter/term (1st, 2nd, etc.) |
| 8 | `grade_level` | 1.1% | Student's year level |
| 9-14 | `subject_*` (6 one-hot flags) | ~2.8% total | Which subject (Creative Tech, ICT, Science, Math, Electronics, Values Ed) |
| 15 | `has_previous_period` | 0.4% | Whether a previous period grade exists |
| 16 | `assessment_completion_rate` | 0.05% | Fraction of assessments completed |

### How Features Are Built from Live Records

The `PredictionFeatureBuilderService` computes these features by querying the database:

- **Grade components**: Pulls `AssessmentItem` and `StudentAssessmentScore` records, groups by DepEd component (Written Work, Performance Task, Quarterly Assessment), computes percentages
- **Submissions**: Pulls `Classwork` and `StudentSubmission` records for missing/late counts
- **Grade history**: Queries `StudentPeriodGrade` for current and previous period grades, computes trend and cumulative average
- **Subject**: One-hot encodes the subject name

### Readiness Check (Before Running the Model)

Before the model runs, the system checks if there is enough data:

| Level | Condition |
|---|---|
| **INSUFFICIENT** (blocked) | Source period grade missing, OR data coverage < 50%, OR completion rate < 50% |
| **MINIMUM** | Coverage 50–69% |
| **GOOD** | Coverage 70–84% |
| **STRONG** | Coverage ≥ 85% |

If readiness is `INSUFFICIENT`, no prediction is made and the response returns `INSUFFICIENT_DATA`.

---

## 5. Model Performance (Regression Metrics)

| Metric | Value | Meaning |
|---|---|---|
| **MAE** | 1.48 | Average prediction error is ~1.48 grade points |
| **RMSE** | 2.05 | Root mean squared error is ~2.05 points |
| **R²** | 0.65 | Model explains 65% of grade variation |

**In plain English**: If a student's actual next-period grade is 88, the model would typically predict between 86.5 and 89.5. The model is reasonably accurate for grade prediction, but it has limitations because it has never seen failing students.

---

## 6. Risk Engine (How "At Risk" Is Determined)

The Risk Engine takes the model's predicted grade and combines it with behavioral evidence to assign a risk level. It uses **rule-based logic**, NOT the ML model.

### Risk Levels

| Level | Score Range | Meaning |
|---|---|---|
| `HIGH_RISK` | 75–100 | Immediate teacher attention needed |
| `MODERATE_RISK` | 50–74 | Needs targeted follow-up |
| `NEEDS_MONITORING` | 25–49 | Keep watching, not urgent yet |
| `LOW_RISK` | 0–24 | Student is performing well |
| `INSUFFICIENT_DATA` | 0 | Not enough evidence to decide |

### How Risk Level Is Assigned

The Risk Engine evaluates **multiple rules** and picks the **highest severity** triggered:

**HIGH_RISK triggers:**
- Predicted grade < 75
- Current grade < 75
- Predicted grade < 80 AND grade trend declined ≥ 5 points
- Completion rate < 70% AND predicted grade < 82
- ≥ 3 missing activities AND predicted grade < 85

**MODERATE_RISK triggers:**
- Predicted grade between 75–81
- Grade trend declined ≥ 7 points
- Completion rate < 75%
- ≥ 2 missing activities
- ≥ 3 late submissions

**NEEDS_MONITORING triggers:**
- Predicted grade between 82–87
- Grade trend declined ≥ 3 points
- Completion rate < 90%
- 1 missing activity
- Any late submissions
- No previous period record available

**LOW_RISK triggers:**
- Predicted grade ≥ 88 AND completion ≥ 90% AND coverage ≥ 75% AND no missing activities AND no severe grade decline

### Risk Score Calculation

The risk score (0–100) starts at a base score for the risk level, then adds points for:
- Predicted grade below 88: up to +20 points
- Negative grade trend: up to +10 points
- Low completion rate: up to +10 points
- Missing activities: up to +8 points
- Late submissions: up to +5 points
- Multiple triggered rules: up to +5 points

The score is then clamped to stay within the risk level's range.

---

## 7. Complete Workflow (End to End)

### Step 1: Build Features
```
POST /api/v1/predictions/build-features
```
Takes `student_id`, `class_id`, `subject_id`, `source_period_id` → queries the database for grades, scores, submissions → returns 16 ML features + readiness check.

### Step 2: Score Prediction
```
POST /api/v1/predictions/preview (read-only, no save)
POST /api/v1/predictions (score + save to database)
POST /api/v1/predictions/from-records (auto-build features from DB + score + save)
```
Loads the trained `.joblib` model → feeds the 16 features → gets predicted grade → runs Risk Engine → returns risk level, score, causes, recommended actions.

### Step 3: Persist to Database
Saves into PostgreSQL tables:
- `ai_prediction` — the prediction result (predicted grade, risk level, risk score)
- `ai_prediction_feature` — the individual feature values used
- `prediction_outcome` — tracks if the prediction was later proven correct (when real grades come in)

### Step 4: Teacher Dashboard
```
GET /api/v1/predictions/dashboard/at-risk
GET /api/v1/predictions/dashboard/filters
GET /api/v1/predictions/{prediction_id}/detail
```
Teachers see at-risk students, filter by class/subject/term/risk level, view prediction details with causes and recommended actions.

### Step 5: Teacher Review & Intervention
```
POST /api/v1/predictions/{prediction_id}/review (teacher records decision)
POST /api/v1/predictions/{prediction_id}/assign-intervention (assign remedial work)
```
Teachers can review predictions with decisions: `CONFIRMED_RISK`, `DISMISSED_RISK`, `NEEDS_MORE_DATA`, `INTERVENTION_ASSIGNED`, `ESCALATED`.

Assigning an intervention creates a `StudentSuggestion` record (either a lesson or classwork) and logs a `TeacherRiskReview`.

### Step 6: Outcome Evaluation
```
POST /api/v1/predictions/{prediction_id}/evaluate-outcome
```
When the actual period grade is finalized, the system compares it against the prediction to measure accuracy (prediction error, absolute error, actual pass/fail).

---

## 8. Key Files

### ML Pipeline
| File | Purpose |
|---|---|
| `backend/app/ml/Train.py` | Trains the RandomForestRegressor model |
| `backend/app/ml/ScorePrediction.py` | CLI to score one prediction |
| `backend/app/ml/SeedLivePredictions.py` | Bulk-seeds CSV predictions into DB |
| `backend/app/ml/RegisterModelVersion.py` | Registers model metadata in DB |

### Services
| File | Purpose |
|---|---|
| `backend/app/services/prediction/PredictionFeatureBuilderService.py` | Builds 16 features from live DB records |
| `backend/app/services/prediction/ModelScoringService.py` | Loads model, scores prediction, calls Risk Engine |
| `backend/app/services/prediction/RiskEngine.py` | Rule-based risk classification |
| `backend/app/services/prediction/PredictionPersistenceService.py` | Saves predictions to database |
| `backend/app/services/prediction/PredictionExplanationService.py` | Generates causes and recommended actions |
| `backend/app/services/prediction/PredictionOutcomeService.py` | Evaluates prediction accuracy against actual grades |
| `backend/app/services/prediction/TeacherRiskReviewService.py` | Teacher review decisions |
| `backend/app/services/prediction/PredictionSuggestionService.py` | Creates interventions from predictions |
| `backend/app/services/prediction/DashboardPredictionService.py` | Dashboard at-risk list with filters |

### Model Artifacts (not in Git, must be shared manually)
| File | Purpose |
|---|---|
| `backend/data/models/entervene_next_period_grade_rf.joblib` | Trained model file |
| `backend/data/models/entervene_next_period_grade_rf_feature_schema.json` | Feature column list |
| `backend/data/models/entervene_next_period_grade_rf_feature_importance.csv` | Feature rankings |
| `backend/data/models/entervene_next_period_grade_rf_training_report.json` | Training metrics |
| `backend/data/live_predictions/final_student_risk_predictions.csv` | Pre-scored predictions CSV |
| `backend/app/ml/Model.pkl` | Pickle model file |
| `backend/app/ml/feature_columns.pkl` | Feature column names |

### Database Tables
| Table | Purpose |
|---|---|
| `ai_model_version` | Registered model metadata |
| `ai_prediction` | Stored predictions |
| `ai_prediction_feature` | Feature values per prediction |
| `prediction_outcome` | Actual vs predicted comparison |
| `teacher_risk_review` | Teacher review decisions |
| `student_suggestion` | Intervention recommendations |
| `risk_threshold` | Configurable risk thresholds (for future use) |

---

## 9. Database Seeding (For New Laptops)

The pre-scored predictions can be bulk-inserted using:

```bash
cd backend

# Dry run (no DB changes)
python -m app.ml.SeedLivePredictions --dry-run

# Live seeding
python -m app.ml.SeedLivePredictions --model-version-id 1
```

The seeding script:
1. Reads `final_student_risk_predictions.csv` (3,259 scored records)
2. Auto-creates missing subjects in the DB
3. Creates synthetic students with deterministic UUIDs
4. Inserts `ai_prediction` rows
5. Inserts `prediction_outcome` rows (status = PENDING)

### Files NOT in Git (must be sent manually)
- `backend/data/live_predictions/final_student_risk_predictions.csv`
- `backend/data/models/*` (all model artifacts)
- `backend/app/ml/Model.pkl` and `feature_columns.pkl`
- `backend/.env` (database credentials)

---

## 10. 3-Term Curriculum Adaptation

The model was trained on 4-quarter data. For the new DepEd 3-term curriculum (DO 017 s. 2026), the `period_sequence` feature is normalized:

```
normalized_sequence = round((period_sequence / total_periods_in_year) × 4, 4)
```

| Curriculum | Period 2 | Normalized |
|---|---|---|
| 4-Quarter | Q2 = 2/4 × 4 = **2.0** | Same as original |
| 3-Term | T2 = 2/3 × 4 = **2.67** | Scaled to 4-quarter equivalent |

This lets the existing model work with 3-term data without retraining.

---

## 11. Known Limitations

1. **No failing examples in training data** — The model cannot predict below-75 grades because it has never seen them
2. **Classification metrics are invalid** — AUC, Precision, Recall, F1 cannot be reported
3. **Lowest predicted grade is 83.46** — The model never predicts below passing
4. **Risk detection relies on rules** — The Risk Engine compensates for the model's limitation by also checking behavioral signals (completion rate, missing work, grade trends)
5. **Synthetic student identities** — Training data names/LRNs are fake, not real students

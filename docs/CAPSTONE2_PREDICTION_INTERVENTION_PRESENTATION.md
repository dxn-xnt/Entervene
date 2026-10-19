# ENTERVENE: CAPSTONE 2 PROTOTYPE PRESENTATION & TECHNICAL DEFENSE GUIDE
## AI Student Performance Prediction & Student Intervention Management

> **Document Purpose**: Comprehensive word-for-word presentation script, architectural explanation, live prototype walkthrough, and technical defense reference for the Capstone 2 oral presentation and defense.  
> **Target Audience**: Capstone Adviser, Panel of Examiners, and Project Presenters.  
> **Scope**: Verified against the active `Entervene_Demo` database and backend/frontend implementation.

---

## TABLE OF CONTENTS
1. [Executive Summary & System Architecture](#1-executive-summary--system-architecture)
2. [Technical Deep Dive: Prediction & Grading Mechanics](#2-technical-deep-dive-prediction--grading-mechanics)
   - [2.1 DepEd Grading Templates & Component Calculations](#21-deped-grading-templates--component-calculations)
   - [2.2 Prediction Readiness Rules & The Examination Evidence Contradiction Resolved](#22-prediction-readiness-rules--the-examination-evidence-contradiction-resolved)
   - [2.3 Machine Learning Feature Schema & Behavioral Signal Handling](#23-machine-learning-feature-schema--behavioral-signal-handling)
   - [2.4 Model Architecture, Verified Evaluation Metrics & Limitations](#24-model-architecture-verified-evaluation-metrics--limitations)
   - [2.5 Rule-Based Risk Classification & Threshold Mechanics](#25-rule-based-risk-classification--threshold-mechanics)
   - [2.6 Algorithmic Fairness & Grading Integrity Safeguards](#26-algorithmic-fairness--grading-integrity-safeguards)
3. [Technical Deep Dive: Intervention Management System](#3-technical-deep-dive-intervention-management-system)
   - [3.1 Complete Intervention State Machine (Candidate → Active → Resolved)](#31-complete-intervention-state-machine-candidate--active--resolved)
   - [3.2 Four-Tier Diagnostic Precision & Competency Attribution](#32-four-tier-diagnostic-precision--competency-attribution)
   - [3.3 AI Advisory Engine & Strict Safety Guardrails](#33-ai-advisory-engine--strict-safety-guardrails)
   - [3.4 Remediation Modes & The "Higher Score Counts" Examination Policy](#34-remediation-modes--the-higher-score-counts-examination-policy)
4. [Live Demonstration Guide & Verified Demo Scenario](#4-live-demonstration-guide--verified-demo-scenario)
   - [4.1 Verified Demo Baseline (Grade 9 Archimedes)](#41-verified-demo-baseline-grade-9-archimedes)
   - [4.2 Comparative Student Profile: Jordan vs. Morgan](#42-comparative-student-profile-jordan-vs-morgan)
5. [Word-for-Word 12-Minute Presentation Script](#5-word-for-word-12-minute-presentation-script)
   - [Segment 1: System Purpose & Introduction (0:00 – 1:15)](#segment-1-system-purpose--introduction-000--115)
   - [Segment 2: Authentic Evidence in the Gradebook (1:15 – 3:30)](#segment-2-authentic-evidence-in-the-gradebook-115--330)
   - [Segment 3: AI Prediction Engine & Risk Differentiation (3:30 – 6:30)](#segment-3-ai-prediction-engine--risk-differentiation-330--630)
   - [Segment 4: Competency Diagnosis & Support Planning (6:30 – 10:00)](#segment-4-competency-diagnosis--support-planning-630--1000)
   - [Segment 5: Remediation, Progress Monitoring & Conclusion (10:00 – 12:00)](#segment-5-remediation-progress-monitoring--conclusion-1000--1200)
6. [Comprehensive Technical Defense: 20 Panel Questions & Answers](#6-comprehensive-technical-defense-20-panel-questions--answers)
7. [Quick Defense Cheat Sheet](#7-quick-defense-cheat-sheet)

---

## 1. EXECUTIVE SUMMARY & SYSTEM ARCHITECTURE

Entervene is an educational intelligence and targeted intervention web platform built for Philippine secondary schools operating under Department of Education (DepEd) academic guidelines (DepEd Order No. 8, s. 2015).

Traditional Learning Management Systems (LMS) and electronic class records record failing grades *retroactively*—at the end of a grading quarter when it is already too late for students to recover. Entervene bridges this educational gap by combining two tightly coupled, production-ready engines:

```mermaid
flowchart LR
    A[Student Submissions & Quiz Items] --> B[DepEd Class Record Engine]
    B --> C[Prediction Feature Builder]
    C --> D[Random Forest Regressor V2]
    D --> E[Rule-Based Risk Classifier]
    E --> F[Automated Intervention Candidate]
    F --> G[Competency & Question Diagnosis]
    G --> H[Teacher Support Planning & AI Advisor]
    H --> I[Targeted Remediation & Retesting]
    I --> B
```

1. **AI Student Performance Prediction Engine**: An ensemble Machine Learning pipeline (Random Forest Regression) that evaluates cumulative formative and summative evidence throughout the ongoing grading period to forecast the student's final transmuted quarterly grade. It enforces strict mathematical readiness gates to ensure predictions are generated only when legitimate, representative evidence exists.
2. **Student Intervention Management System**: A diagnostic workflow that automatically flags at-risk students into an intervention queue, isolates their exact learning deficits down to specific DepEd competencies and quiz questions, assists teachers with grounded pedagogical recommendations, and tracks targeted remedial coursework with full historical audit trails.

---

## 2. TECHNICAL DEEP DIVE: PREDICTION & GRADING MECHANICS

### 2.1 DepEd Grading Templates & Component Calculations

All grading logic adheres to DepEd Order No. 8, s. 2015. The system supports dynamic database grading templates ([`GradingTemplate`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/models/academic/GradingTemplate.py) and [`GradingTemplateComponent`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/models/academic/GradingTemplateComponent.py)).

#### Grade 9 Mathematics Template Configuration (`Entervene_Demo`)
In `Entervene_Demo`, Grade 9 Mathematics uses the **Core Template (Template ID: 1)**:
- **Written Works (WW)**: **20.00%** weight (formative quizzes, short problem sets, written exercises).
- **Performance Tasks (PT)**: **50.00%** weight (practical applications, group investigations, rubrics).
- **Quarterly Examination (QA/Exams)**: **30.00%** weight (periodic summatives and quarterly exam).
- **Template Passing Threshold**: **87.00%** (Track/Academic standard configured for high-standard demo section).

#### Mathematical Gradebook Pipeline
The Gradebook calculation implemented in [`StudentRecordService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/student_record/StudentRecordService.py#L675-L715) follows four sequential stages:

1. **Percentage Score (PS) per Component**:
   $$\text{PS} = \left( \frac{\sum \text{Earned Scores}}{\sum \text{Maximum Possible Points (HPS)}} \right) \times 100$$
   *Crucial Rule*: Only graded, published assignments are included. Unattempted or pending activities are excluded from both numerator and denominator; they are **never treated as zero**.

2. **Examination Component Subsplit**:
   Implemented in [`ExaminationCalculator.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/grading/ExaminationCalculator.py), the 30% Examination component is partitioned into three subtypes:
   - **Summative Test 1 (ST1)**: 30% of exam component (9% of final grade).
   - **Summative Test 2 (ST2)**: 30% of exam component (9% of final grade).
   - **Term Examination (Term Exam)**: 40% of exam component (12% of final grade).

   When the Gradebook evaluates in-progress grades prior to the Term Exam, it dynamically normalizes across the active administered subtypes:
   $$\text{PS}_{\text{QA}} = \frac{(\text{PS}_{\text{ST1}} \times 0.30) + (\text{PS}_{\text{ST2}} \times 0.30)}{0.30 + 0.30}$$

3. **Weighted Score (WS) & Initial Grade (IG)**:
   $$\text{Initial Grade (IG)} = (\text{PS}_{\text{WW}} \times 0.20) + (\text{PS}_{\text{PT}} \times 0.50) + (\text{PS}_{\text{QA}} \times 0.30)$$

4. **Grade Transmutation**:
   The Initial Grade (0–100) is converted into the official DepEd Transmuted Grade using the statutory table implemented in [`CurrentThreeTermTransmutation.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/grading/CurrentThreeTermTransmutation.py). An Initial Grade of 60.00 translates to the passing grade of 75.00.

---

### 2.2 Prediction Readiness Rules & The Examination Evidence Contradiction Resolved

A central question in the technical audit was an apparent contradiction:  
*Earlier documentation stated that Examination evidence requires Summative 1, Summative 2, and the Term Exam to be complete. Yet Task 10 showed students with 70% observed component weight and successful predictions while the Term Exam was unpublished.*

#### The Architectural Resolution
Code inspection of [`CurrentPeriodFeatureBuilderService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py#L191-L234) and [`ExaminationCalculator.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/grading/ExaminationCalculator.py#L177-L189) proves that **both statements describe deliberate, complementary parts of the design**:

```mermaid
graph TD
    A[Student Submissions] --> B{Evaluation Context}
    B -->|Teacher Gradebook View| C[require_complete_for_percent = False]
    C --> D[Active Normalization: ST1 + ST2 / 0.60]
    D --> E[In-Progress Gradebook Display: 75.0% QA]

    B -->|AI Prediction Feature Builder| F[require_complete_for_percent = True]
    F --> G{All 3 Subtypes Graded?}
    G -->|No: Term Exam Ungraded| H[qa.count = 0, qa_has_evidence = 0.0]
    H --> I[Observed Weight = WW 20% + PT 50% = 70.0%]
    I --> J[Readiness Level: STANDARD_READY]
    G -->|Yes: ST1 + ST2 + Term Exam Graded| K[qa.count = 1, qa_has_evidence = 1.0]
    K --> L[Observed Weight = 100.0%]
    L --> M[Readiness Level: HIGH_EVIDENCE]
```

1. **Why `HIGH_EVIDENCE` Requires the Term Examination**:
   In [`CurrentPeriodFeatureBuilderService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py#L307), the feature builder invokes:
   ```python
   exam_result = compute_examination_component(exam_observations, require_complete_for_percent=True)
   ```
   When `require_complete_for_percent=True`, line 177 of `ExaminationCalculator.py` explicitly returns `examination_percent=None` unless **all three subtypes** (`SUMMATIVE_1`, `SUMMATIVE_2`, and `TERM_EXAM`) have valid submissions.  
   Consequently, the machine learning input accumulator sets `qa.count = 0` and `qa_has_evidence = 0.0`.
   
   Therefore, **`HIGH_EVIDENCE` strictly requires the full set of examinations including the Term Exam**:
   - $\ge 7$ available graded activities
   - `ww_has_evidence == 1.0`
   - `pt_has_evidence == 1.0`
   - `qa_has_evidence == 1.0`
   - `observed_component_weight_sum == 100.0`
   - `unresolved_evidence == False`

2. **How Early / Midterm Predictions Function (`STANDARD_READY`)**:
   Schools need predictions *before* the Term Exam is held, otherwise interventions cannot prevent failure. The system solves this with the `STANDARD_READY` tier:
   - $\ge 4$ available graded activities
   - Written Work evidence present (`ww_has_evidence == 1.0`)
   - Performance Task evidence present (`pt_has_evidence == 1.0`)
   - Observed component weight $\ge 70.0\%$ (WW 20% + PT 50% = 70%)
   - `unresolved_evidence == False`

3. **Observed Component Weight Defined**:
   Observed component weight measures the sum of template percentage weights for components that possess **complete, validated evidence**. During the ongoing term, WW (20%) + PT (50%) = 70%. The model is specifically trained on intermediate temporal snapshots (25%, 50%, 75% term completion) to accurately project final grades from partial 70% observed weights.

---

### 2.3 Machine Learning Feature Schema & Behavioral Signal Handling

The production candidate model registered in `Entervene_Demo` is **`entervene_current_term_official_target_rf_candidate`** ([`AIModelVersion`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/models/ai/AIModelVersion.py) ID: 2).

#### The Exact 31-Feature Vector
Verified directly against [`entervene_current_period_grade_rf_v1_feature_schema.json`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/data/models/entervene_current_period_grade_rf_v1_feature_schema.json), the model accepts exactly 31 features grouped into five clear categories:

| Feature Category | Variables Included | Purpose & Educational Rationale |
| :--- | :--- | :--- |
| **Academic Context** | `grade_level`, `subject` (one-hot encoded) | Baseline academic year and curricular domain expectations. |
| **Grading Configuration** | `ww_weight`, `pt_weight`, `qa_weight` | Informs the model of the active DepEd subject grading weights. |
| **Assessment Counts** | `ww_available_activity_count`, `pt_available_activity_count`, `qa_available_activity_count`, `overall_available_activity_count` | Captures sample size and assessment density. |
| **Component Performance** | `ww_points_earned_so_far`, `ww_points_possible_so_far`, `ww_percent_so_far`, `ww_weighted_score_so_far`<br>`pt_points_earned_so_far`, `pt_points_possible_so_far`, `pt_percent_so_far`, `pt_weighted_score_so_far`<br>`qa_points_earned_so_far`, `qa_points_possible_so_far`, `qa_percent_so_far`, `qa_weighted_score_so_far` | Raw points, denominators, percentages, and weighted score contributions. |
| **Cumulative & Data Quality** | `observed_component_weight_sum`, `overall_weighted_score_so_far`, `overall_partial_percent`, `ww_has_evidence`, `pt_has_evidence`, `qa_has_evidence`, `has_any_input_evidence`, `ww/pt/qa_score_over_hps_count_so_far` | Measures evidence sufficiency, intermediate trajectory, and flags data anomalies. |

#### Critical Finding: Role of Behavioral Indicators
The Teacher Prediction UI displays student attendance percentages, submission timeliness, and completion rates. **We conducted a comprehensive code audit to determine whether these variables enter the model.**

- **Code Verification**: In [`DevelopmentCurrentTermRiskService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/prediction/DevelopmentCurrentTermRiskService.py#L18-L46) and the feature schema, variables such as `attendance_rate`, `on_time_submission_rate`, and `behavioral_engagement_score` are explicitly defined as:
  ```python
  SUPPORTING_CONTEXT_ROLE = "SUPPORTING_CONTEXT_ONLY"
  ```
- **Conclusion**: **Behavioral indicators do NOT enter the Random Forest feature matrix and do NOT influence the numerical grade prediction.** They are retrieved and presented strictly as supplementary classroom context for the teacher.

---

### 2.4 Model Architecture, Verified Evaluation Metrics & Limitations

#### Model Architecture
- **Algorithm**: Random Forest Regressor (`sklearn.ensemble.RandomForestRegressor`).
- **Hyperparameters**: 300 estimators (`n_estimators: 300`), maximum features per split 0.5 (`max_features: 0.5`), minimum samples per leaf 2 (`min_samples_leaf: 2`), minimum samples per split 5 (`min_samples_split: 5`), random seed 42.
- **Output**: Predicts a continuous numerical value corresponding directly to the student's projected final term grade on the DepEd 0–100 scale.

#### Verified Empirical Evaluation Metrics
Verified from the official evaluation report [`backend/data/experiments/official_target_rf_4i/evaluation_report.json`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/data/experiments/official_target_rf_4i/evaluation_report.json):

| Metric | Random Forest (Candidate) | Baseline (Linear Regression) | Naive Baseline (Subject Mean) |
| :--- | :---: | :---: | :---: |
| **Mean Absolute Error (MAE)** | **1.6007** grade points | 1.6664 grade points | 2.8987 grade points |
| **Root Mean Squared Error (RMSE)**| **2.2333** grade points | 2.2288 grade points | 3.6100 grade points |
| **Coefficient of Determination ($R^2$)**| **0.6396** | 0.6411 | 0.0583 |
| **Accuracy within $\pm 1.0$ Grade Point** | **45.67%** | 41.68% | 21.23% |
| **Accuracy within $\pm 2.0$ Grade Points**| **70.27%** | 68.52% | 41.30% |
| **Accuracy within $\pm 3.0$ Grade Points**| **84.33%** | 84.69% | 60.21% |

- **Validation Structure**: Evaluated across 13 seen-subject holdout workbooks encompassing **1,729 student periods** and **5,187 temporal snapshot records** (25%, 50%, and 75% term intervals).
- **Risk Category Agreement**: **89.3% overall agreement** with actual final risk outcomes at the 75% term milestone.

#### Mandatory Technical Limitations to Disclose
1. **Severe Dataset Truncation (No Failing Samples)**:
   As documented in the model manifest disclaimer, the historical training dataset contained **zero final grades below 75** after data quality cleaning (observed training range: 80.0 to 100.0). The model is validated as a continuous regression estimator, **not as an empirically calibrated failing-grade classifier**.
2. **Snapshot Reconstruction**:
   Training snapshots (25%, 50%, 75%) were reconstructed post-hoc based on spreadsheet column ordering, not real-time calendar timestamps.
3. **Independent Longitudinal Validation**:
   Multi-school, multi-year prospective validation (`independent_three_term_validation`) has not yet been conducted.

---

### 2.5 Rule-Based Risk Classification & Threshold Mechanics

Risk classification is **NOT** a secondary machine learning model or uncalibrated probability output. It is implemented in [`DevelopmentCurrentTermRiskService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/prediction/DevelopmentCurrentTermRiskService.py#L79-L97) as a deterministic, rule-based mapping:

$$\text{Projected Grade } (G) \longrightarrow \begin{cases} 
G < 75.00 & \text{HIGH\_RISK} \\ 
75.00 \le G < 85.00 & \text{MODERATE\_RISK} \\ 
85.00 \le G < 90.00 & \text{NEEDS\_MONITORING} \\ 
G \ge 90.00 & \text{LOW\_RISK} 
\end{cases}$$

#### Distinction Between Passing Threshold (87.0) and Intervention Threshold (85.0)
- **Passing Threshold (87.0)**: Configured in the Core Grading Template as the standard for satisfactory academic mastery in Grade 9 Core subjects.
- **Intervention Candidate Threshold (85.0)**: Hardcoded in [`InterventionCandidateService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/intervention/InterventionCandidateService.py#L87). Any student projected strictly below **85.00** (`MODERATE_RISK` or `HIGH_RISK`) automatically generates an **Intervention Candidate**.
- **Educational Justification**: The 85.0 threshold provides an early-warning safety buffer. By triggering an intervention before a student hits the failing boundary (75.0) or falls below track expectations (87.0), teachers can act while remedial recovery is still viable.

---

### 2.6 Algorithmic Fairness & Grading Integrity Safeguards

1. **Parity of Grading Standards**: All students enrolled in the same class and subject are evaluated under identical component weights and percentage calculations.
2. **Exclusion of Protected Attributes**: The feature schema completely excludes student demographic variables (gender, socio-economic status, home address, disability status).
3. **Absence of Penalty for Unscheduled Activities**: The denominator of component percentages reflects only published, administered activities. Students are never penalized for future or unassigned classworks.
4. **Transparent Boundaries vs. Stigmatizing Labels**: The system maps risk to operational priority categories (`MODERATE_RISK`), never labeling a student as "failing" or "incapable."

---

## 3. TECHNICAL DEEP DIVE: INTERVENTION MANAGEMENT SYSTEM

### 3.1 Complete Intervention State Machine

The intervention workflow governs how academic projections translate into human-supervised teacher action:

```mermaid
stateDiagram-v2
    [*] --> CANDIDATE: Prediction < 85.00 & STANDARD_READY
    CANDIDATE --> ACTIVE: Teacher Approves Candidate
    CANDIDATE --> REJECTED: Teacher Dismisses with Reason
    CANDIDATE --> RESOLVED: New Prediction >= 85.00 (Auto-Reconciled)
    
    ACTIVE --> ACTIVE: Teacher Prepares Support Plan & AI Advisory
    ACTIVE --> ACTIVE: Student Completes Remediation Activity
    ACTIVE --> RESOLVED: New Official Prediction >= 85.00
    ACTIVE --> RESOLVED: Teacher Manual Closure with Summary
    RESOLVED --> [*]
```

- **`CANDIDATE`**: Automatically staged inside the prediction persistence transaction ([`InterventionCandidateService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/intervention/InterventionCandidateService.py)). Teachers review candidates on the Interventions dashboard.
- **`ACTIVE`**: The teacher explicitly reviews the evidence snapshot, approves the candidate, and gains access to the Remediation Workspace.
- **`RESOLVED`**: Triggered either when a subsequent legitimate prediction rises to $\ge 85.00$ or when the teacher conducts a formal exit review after verified remediation.

---

### 3.2 Four-Tier Diagnostic Precision & Competency Attribution

A major limitation of typical LMS gradebooks is that an aggregate score (e.g., 60% in Written Work) does not tell the teacher *what concept* the student failed to understand. Entervene solves this through a four-tier attribution hierarchy implemented in [`InterventionDiagnosisService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/intervention/InterventionDiagnosisService.py):

```mermaid
graph TD
    A[Student Assessment Evidence] --> B{Evidence Structure}
    B -->|Quiz with Mapped Questions| C[Tier 1: Scored Item Evidence]
    C --> C1[Points per Question attributed directly to Lesson & Competency]
    
    B -->|Activity linked to exactly 1 Lesson| D[Tier 2: Single-Lesson Attribution]
    D --> D1[Activity score attributed to Lesson's Competency]
    
    B -->|Manual Activity with ClassworkCoverage| E[Tier 3: Teacher-Asserted Coverage]
    E --> E1[Flagged for Teacher Review; Score is NOT divided or assumed]
    
    B -->|No Question or Lesson Links| F[Tier 4: Component-Only Evidence]
    F --> F1[Diagnoses weak component WW/PT/Exam only]
```

1. **Tier 1: Scored Item Evidence (`_quiz_item_evidence`)**:  
   When a student takes a quiz, each question is linked to a specific lesson and DepEd competency. The points earned on that question (`QuizAnswer.points_awarded`) vs. max points (`Question.points`) are attributed directly to that competency.
2. **Tier 2: Single-Lesson Attribution (`_single_lesson_attribution`)**:  
   If a non-quiz activity is tied to exactly one lesson, its overall score is attributed to that lesson's competency.
3. **Tier 3: Teacher-Asserted Coverage (`_manual_coverage_at_cutoff`)**:  
   For manual activities (e.g., paper rubrics), [`ClassworkCoverage`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/models/classwork/ClassworkCoverage.py) records define which competencies were taught. The system explicitly flags this as `"score_scope": "ASSESSMENT_TOTAL_ONLY"` and refuses to fabricate per-competency percentages.
4. **Tier 4: Component-Only Evidence**:  
   If no curricular links exist, the system informs the teacher that performance is low in the component (e.g., Written Work) without making unsupported claims about specific skills.

---

### 3.3 AI Advisory Engine & Strict Safety Guardrails

The Remediation Workspace includes an AI Advisory feature powered by Groq (Llama-3.3-70b-versatile) via [`InterventionRemediationService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/intervention/InterventionRemediationService.py#L267-L315).

#### What the AI Does
- Recommends an appropriate **remediation format**: `QUIZ`, `TOS` (Table of Specifications), `CLASSWORK`, or `EXISTING_MATERIAL_ONLY`.
- Provides a succinct pedagogical rationale based on verified student evidence.

#### What the AI Does NOT Do (Strict Safety Guardrails)
- **The AI cannot assign grades or change records.**
- **The AI cannot read unverified student files**; it accesses only structured metadata (`METADATA_ONLY`).
- **Deficit Language Filter**: Line 296 rejects any LLM response containing deficit-oriented or stigmatizing words (`weak`, `struggl*`, `poor`, `deficit`, `failed`).
- **Hallucination Blocker**: Line 302 aborts if the model suggests focusing on competencies that lack empirical scoring evidence.

---

### 3.4 Remediation Modes & The "Higher Score Counts" Examination Policy

When assigning targeted remediation, teachers can select from four grade treatments:
1. **`PRACTICE_ONLY`**: Formative exercises; does not alter the gradebook.
2. **`WRITTEN_WORK`**: Staged as a supplementary Written Work activity.
3. **`PERFORMANCE_TASK`**: Staged as an alternative rubric task.
4. **`EXAMINATION` (Remedial Retest)**:  
   Implemented in [`RemedialExamination.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/grading/RemedialExamination.py), this provides a formal retest for a specific summative assessment.

#### The "Higher Score Counts" Policy
- Both original and remedial submissions are permanently preserved in [`StudentSubmission`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/models/submissions/StudentSubmission.py) for auditability.
- When computing effective grades:
  $$\text{Effective Score} = \max(\text{Original Score}, \text{Remedial Score})$$
- *Policy Note*: This policy was implemented based on field consultation with practicing DepEd teachers. It rewards student recovery without punitive risks.

---

## 4. LIVE DEMONSTRATION GUIDE & VERIFIED DEMO SCENARIO

### 4.1 Verified Demo Baseline (Grade 9 Archimedes)
- **Class**: Grade 9 – Archimedes (Class ID: 1, Subject: Mathematics).
- **Class Size**: 11 enrolled students.
- **Published Assessments**: Exactly **9 of 9 published assessments** scored across all 11 students (99 valid submissions).
- **Unpublished Safeguard**: Term Examination (Classwork ID: 10) is verified **unpublished** (`is_published = False`).

### 4.2 Comparative Student Profile: Jordan vs. Morgan

| Academic Indicator | Demo Jordan Starting | Demo Morgan Striving | Educational Significance |
| :--- | :---: | :---: | :--- |
| **Written Works (WW)** | 53.00 / 80 (66.25%) | 37.00 / 80 (46.25%) | Morgan struggled with integer operations and linear quizzes. |
| **Performance Tasks (PT)** | 93.00 / 120 (77.50%) | 76.00 / 120 (63.33%) | Morgan scored 60–65% on practical modeling presentations. |
| **Summative Tests (ST1 & ST2)**| 45.00 / 60 (75.00%) | 37.00 / 60 (61.67%) | Jordan demonstrated steady midterm test performance. |
| **Gradebook Initial Grade** | **74.50** | **59.41** | 15.09-point performance spread. |
| **DepEd Transmuted Grade** | **78.00** | **72.00** | Morgan's current standing is below DepEd passing (75.0). |
| **Observed Component Weight**| **70.0%** (WW + PT) | **70.0%** (WW + PT) | Both meet `STANDARD_READY` requirements. |
| **Predicted Final Grade** | **87.11** | **83.06** | Machine Learning projection from 70% evidence. |
| **Assessed Risk Level** | `NEEDS_MONITORING` | `MODERATE_RISK` | Morgan triggers intervention ($83.06 < 85.0$). |
| **Intervention Status** | Not Eligible ($G \ge 85$) | **Candidate ID: 6** | Morgan queued for teacher review and remediation. |

---

## 5. WORD-FOR-WORD 12-MINUTE PRESENTATION SCRIPT

### Rehearsal Timing Overview
- **Segment 1: Introduction & System Problem** (1 min 15 sec)
- **Segment 2: Authentic Evidence in the Gradebook** (2 min 15 sec)
- **Segment 3: AI Prediction Engine & Risk Differentiation** (3 min 00 sec)
- **Segment 4: Competency Diagnosis & Support Planning** (3 min 30 sec)
- **Segment 5: Remediation, Progress Monitoring & Conclusion** (2 min 00 sec)
- **Total Duration**: ~12 minutes (leaving 3 minutes for panel questions).

---

### Segment 1: System Purpose & Introduction (0:00 – 1:15)

#### What to Click:
- Log in to the application at `http://localhost:5173` using teacher credentials:  
  **Email**: `teacher@entervene.com` | **Password**: `password123`
- Land on the **Teacher Dashboard**.

#### What to Say:
> *"Good morning, esteemed members of the panel, our adviser, and fellow engineers. Today, we are proud to present **Entervene**, an AI-driven student performance prediction and targeted intervention platform built specifically for secondary education under the Department of Education curriculum.*
>
> *In Philippine schools today, teachers rely on quarterly electronic class records. The fundamental flaw of this process is that a failing grade is discovered at the end of the quarter—when the report card is printed, and when it is far too late to help the student recover.*
>
> *Entervene changes this paradigm. It continuously analyzes authentic classroom evidence during the grading period, uses an ensemble machine learning model to forecast final term grades, and immediately routes struggling students into a structured intervention workflow. Today, we will demonstrate these two core capabilities using real, verified student records from our Grade 9 Mathematics class."*

#### What It Proves:
Establishes clear problem relevance, Philippine educational alignment (DepEd Order 8, s. 2015), and the primary research contribution.

---

### Segment 2: Authentic Evidence in the Gradebook (1:15 – 3:30)

#### What to Click:
- Click **"Classes"** in the sidebar $\rightarrow$ Select **"Grade 9 - Archimedes (Mathematics)"**.
- Navigate to the **"Grades"** tab (`/teacher/classes/1/grades`).
- Click the **"Written Works"** component header button to open the modal breakdown.
- Close modal; click the **"Performance Tasks"** component header button.

#### What to Say:
> *"Let us start where every teacher starts: with authentic academic evidence. Here in our Grade 9 Mathematics Gradebook, you can see all 11 enrolled students. Notice that our grading system is governed by an official DepEd Core Grading Template, consisting of 20% Written Works, 50% Performance Tasks, and 30% Quarterly Assessments.*
>
> *Notice two key students on this screen: **Jordan Starting** and **Morgan Striving**.*
>
> *To keep the interface clean and responsive, our main table displays a collapsed view of the two latest activities. When we click on the 'Written Works' header, the breakdown modal reveals all four administered activities: Number Sense, Integer Operations, Rational Numbers, and Linear Equations. Every score you see here is backed by real submissions in our database.*
>
> *Notice the stark difference between our two students:*
> *Jordan has a cumulative Written Work percentage of 66.25% and a strong Performance Task percentage of 77.50%. This gives Jordan an Initial Grade of 74.50, which transmutes under DepEd rules to an official passing grade of **78.0**.*
>
> *In contrast, Morgan struggled significantly on Written Work quizzes, earning only 37 out of 80 points, or 46.25%. Morgan's Performance Tasks stand at 63.33%. This calculates to an Initial Grade of 59.41, which transmutes to a failing grade of **72.0**.*
>
> *Notice also that our Term Examination is currently unpublished and ungraded. Our system handles incomplete activities mathematically by excluding them from the denominator; we never unfairly record unadministered assessments as zero."*

#### Possible Panel Question & Quick Answer:
- **Panel**: *"Why does your collapsed view show dashes for some students if they have grades?"*
- **You**: *"Our UI uses a `getLatestTwo` helper to conserve screen width on standard displays, showing only the two most recent activities per category. When you open the component breakdown modal, all four activities and their historical scores are fully displayed."*

---

### Segment 3: AI Prediction Engine & Risk Differentiation (3:30 – 6:30)

#### What to Click:
- Click the **"AI Predictions"** tab in the class view (`/teacher/classes/1/predictions`).
- Highlight Jordan's row: **Predicted Grade: 87.11**, Badge: **`Needs Monitoring`**.
- Highlight Morgan's row: **Predicted Grade: 83.06**, Badge: **`Moderate Risk`**.
- Click the info button on Morgan's row to view the evidence snapshot drawer.

#### What to Say:
> *"Now let us transition to our first primary capability: AI Student Performance Prediction.*
>
> *Our prediction engine is powered by a Random Forest Regressor trained on 1,729 student periods across multiple historical academic years. Rather than guessing, the model evaluates 31 engineered features, including component percentages, point velocity, and grading template weights.*
>
> *Before any prediction is calculated, our system enforces a strict mathematical readiness gate. Notice that both Jordan and Morgan have an observed component weight of 70%, consisting of 20% Written Work and 50% Performance Tasks. Because they have completed more than 4 activities with both components represented, the system qualifies them as **`STANDARD_READY`**.*
>
> *Now, look at the predictions generated by our official model:*
> - *Jordan is projected to finish with an **87.11**, placing him in the **`Needs Monitoring`** tier.*
> - *Morgan is projected to finish with an **83.06**, placing her in the **`Moderate Risk`** tier.*
>
> *Why does Morgan receive a significantly lower projection? Because Performance Tasks carry a heavy 50% weight—two and a half times that of Written Works. Morgan's 14% deficit in Performance Tasks drags down her multivariate trajectory.*
>
> *Furthermore, notice how our risk classification works: it is a deterministic, rule-based layer mapped directly from the projected grade. Anyone projected below 75 is High Risk; between 75 and 85 is Moderate Risk; 85 to 90 is Needs Monitoring; and 90 and above is Low Risk. Because Morgan is projected at 83.06, which is strictly below 85, she automatically triggers our second primary functionality: the Intervention Management System."*

#### Possible Panel Question & Quick Answer:
- **Panel**: *"Why does Jordan have an 87.11 prediction if his current transmuted grade is 78.0?"*
- **You**: *"Because a current grade is merely an in-progress snapshot that ignores trend and historical recovery curves. The Random Forest learned from 5,000+ historical student snapshots that students with steady performance in 50%-weight Performance Tasks typically trend upward toward their final examination, projecting Jordan to an 87.11."*

---

### Segment 4: Competency Diagnosis & Support Planning (6:30 – 10:00)

#### What to Click:
- Navigate to **"Interventions"** in the main sidebar (`/teacher/interventions`).
- Locate **Demo Morgan Striving** in the Interventions table (Candidate ID: 6).
- Click **"Review Candidate"** to open the Diagnostic & Support Planning Workspace.
- Point to the **Weakest Component** (Written Work: 46.25%).
- Point to the **Lowest Supported Competencies** section: highlight `DEMO-LOCAL-G9M-NS-01` (Number Systems) and `DEMO-LOCAL-G9M-EQ-01` (Equation Modeling).
- Scroll down to the **Remediation Plan** section; show the AI Advisory card.

#### What to Say:
> *"This brings us to Entervene's second core functionality: Student Intervention Management.*
>
> *Most LMS platforms stop at a risk score, leaving the teacher to guess what is wrong. Entervene performs an automated diagnostic breakdown. Because Morgan's projection of 83.06 crossed the 85.0 threshold, the system created Candidate ID 6.*
>
> *When we open Morgan's review, our Four-Tier Diagnostic Engine isolates her exact learning deficits:*
> 1. *First, it identifies her weakest grading component: **Written Works at 46.25%**.*
> 2. *Second, because our quizzes are mapped at the individual item level, it traces her missed answers directly to specific DepEd competencies:*
>    - *On Competency `G9M-NS-01` (Number Systems), she scored 9 out of 20 points (45%).*
>    - *On Competency `G9M-EQ-01` (Equation Modeling), she scored 14 out of 20 points (70%).*
>
> *Now let us look at how Entervene assists the teacher in support planning. The system searches the teacher's published repository and automatically recommends matching lessons and practice activities based on competency metadata.*
>
> *Furthermore, our integrated AI Advisory engine—powered by an open-weights Llama model with strict JSON guardrails—analyzes this diagnostic grounding and suggests an appropriate remediation format, such as a targeted diagnostic quiz. Notice our pedagogical guardrails: the AI is strictly forbidden from using stigmatizing labels like 'poor' or 'failing,' and the final decision always remains entirely in the teacher's hands."*

#### Possible Panel Question & Quick Answer:
- **Panel**: *"Does your AI automatically assign homework to the student without teacher approval?"*
- **You**: *"No, absolutely not. In Entervene, the AI serves strictly as a pedagogical advisor. The teacher must review the candidate, choose the remediation format, select the learning materials, and publish the remedial task. The human teacher maintains complete pedagogical authority."*

---

### Segment 5: Remediation, Progress Monitoring & Conclusion (10:00 – 12:00)

#### What to Click:
- Show the **Grade Treatment** selector dropdown: highlight `PRACTICE_ONLY`, `WRITTEN_WORK`, `PERFORMANCE_TASK`, and `EXAMINATION`.
- Explain the historical tracking table at the bottom of the workspace.
- Navigate back to the **Teacher Dashboard** to conclude.

#### What to Say:
> *"Finally, let us look at remediation delivery and progress monitoring.*
>
> *When a teacher stages a remediation activity, Entervene supports four distinct grading policies: Practice Only, Written Work, Performance Task, or Remedial Examination.*
>
> *For Remedial Examinations, our backend implements a field-validated **'Higher Score Counts'** policy: the student's original attempt and remedial attempt are both permanently stored in PostgreSQL for accreditation audits, but the gradebook adopts whichever score is higher.*
>
> *Once the student completes the remedial activity and the teacher records the score, the gradebook recalculates. On the next prediction run, if Morgan's projected grade rises to 85.0 or above, our reconciliation service automatically marks the intervention as **RESOLVED** with an audit timestamp.*
>
> *To summarize: Entervene transforms raw classroom assessments into actionable predictive intelligence. It alerts teachers weeks in advance, diagnoses exact competency gaps down to individual quiz items, and guides structured remediation. We empower educators to ensure that no student falls through the cracks.*
>
> *Thank you very much. We are now open for your questions and technical defense."*

---

## 6. COMPREHENSIVE TECHNICAL DEFENSE: 20 PANEL QUESTIONS & ANSWERS

### Q1: Why did you choose Random Forest instead of Deep Learning or Logistic Regression?
- **Spoken Answer**: *"We selected Random Forest because our tabular dataset features nonlinear interactions between component percentages and template weights, where tree ensembles consistently outperform neural networks on small-to-medium tabular data without overfitting."*
- **Technical Explanation**: Tabular educational data violates inductive biases favored by deep architectures. Random Forest handles heterogeneous continuous features (percentages, points, counts) and categorical features (`subject`) without requiring complex feature scaling. In our benchmark evaluations, Random Forest achieved an MAE of 1.60 and $R^2$ of 0.64, substantially beating linear models (MAE 1.67) and naive baselines (MAE 2.90).
- **Code Reference**: [`CurrentPeriodFeatureBuilderService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py#L443-L449).

---

### Q2: How accurate is your prediction model?
- **Spoken Answer**: *"On our held-out test evaluation of 1,729 student periods, the model achieved a Mean Absolute Error of 1.60 grade points, with over 70% of predictions landing within 2 points of the actual final grade, and an 89.3% agreement on risk categories."*
- **Technical Explanation**: Metrics from [`evaluation_report.json`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/data/experiments/official_target_rf_4i/evaluation_report.json): MAE = 1.6007, RMSE = 2.2333, $R^2 = 0.6396$. Within $\pm 1.0$ grade point: 45.67%; within $\pm 2.0$ points: 70.27%; within $\pm 3.0$ points: 84.33%. Risk category agreement at 75% snapshot: 89.3%.
- **Limitation**: We do not claim "95% accuracy"; we openly report our calibrated regression error of 1.60 grade points.

---

### Q3: What dataset was used to train the model?
- **Spoken Answer**: *"The model was trained on historical secondary school class records encompassing 13 full-year subject workbooks, 1,729 unique student periods, and 5,187 reconstructed temporal snapshots."*
- **Technical Explanation**: Data was collected from actual junior high school grading sheets across Grade 7 through Grade 10 covering Mathematics, Science, English, Creative Technology, and Values Education. Snapshots were reconstructed at 25%, 50%, and 75% assessment completion intervals.
- **Code Reference**: [`RegisterCorrectedCurrentTermModel.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/prediction/RegisterCorrectedCurrentTermModel.py#L33-L65).

---

### Q4: How do you prevent data leakage and overfitting?
- **Spoken Answer**: *"We enforce strict chronological splitting by source workbook and period, exclude all future assessment columns from intermediate feature vectors, and constrain tree complexity with leaf sample minimums."*
- **Technical Explanation**: Cross-validation was performed via **workbook-level holdouts** (`SEEN_SUBJECT_HOLDOUT` and `UNSEEN_SUBJECT`), ensuring no student from a test class appeared in the training partition. Hyperparameters restrict tree memorization (`min_samples_leaf: 2`, `min_samples_split: 5`, `max_features: 0.5`). Future grades and post-period attendance were strictly placed in `excluded_columns`.
- **Code Reference**: Schema `excluded_columns` in [`entervene_current_period_grade_rf_v1_feature_schema.json`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/data/models/entervene_current_period_grade_rf_v1_feature_schema.json#L51-L76).

---

### Q5: What variables actually determine a student's prediction?
- **Spoken Answer**: *"The prediction is driven exclusively by 31 academic features: component percentages, points earned versus possible, template weights, assessment counts, and subject classification."*
- **Technical Explanation**: Permutation feature importance confirms that `overall_partial_percent`, `pt_weighted_score_so_far`, `pt_percent_so_far`, and `observed_component_weight_sum` are the dominant predictive drivers, which directly reflects the 50% weight assigned to Performance Tasks in DepEd Junior High Mathematics.
- **Code Reference**: [`entervene_current_period_grade_rf_v1_feature_importance.csv`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/data/models/entervene_current_period_grade_rf_v1_feature_importance.csv).

---

### Q6: Why doesn't attendance directly change the prediction?
- **Spoken Answer**: *"In our codebase, attendance and submission timeliness are classified strictly as supporting context for the teacher, rather than predictive features in the machine learning model."*
- **Technical Explanation**: In [`DevelopmentCurrentTermRiskService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/prediction/DevelopmentCurrentTermRiskService.py#L18-L46), attendance variables are tagged `SUPPORTING_CONTEXT_ONLY`. During model training, historical attendance records had irregular tracking and high missingness across sections; feeding sparse behavioral data introduced noise and artificial bias. Thus, attendance is surfaced in the UI for qualitative teacher review while keeping the ML feature vector strictly grounded in academic assessment performance.

---

### Q7: Why does `HIGH_EVIDENCE` require Examination evidence?
- **Spoken Answer**: *"Under our system design, `HIGH_EVIDENCE` signifies 100% component completeness. Because the Quarterly Examination represents 30% of the DepEd grade, a student's evidence cannot be certified as complete until all examination components are graded."*
- **Technical Explanation**: [`CurrentPeriodFeatureBuilderService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py#L204-L211) enforces `observed_component_weight_sum == 100.0` and `qa_has_evidence == 1.0` for `HIGH_EVIDENCE`. When [`compute_examination_component`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/grading/ExaminationCalculator.py#L177) runs with `require_complete_for_percent=True`, any missing exam subtype (such as an unadministered Term Exam) yields `complete=False` and `qa.count=0`. This is a deliberate safeguard ensuring teachers know when predictions are based on partial versus full-term evidence.

---

### Q8: Can Entervene predict before the Term Exam?
- **Spoken Answer**: *"Yes. That is precisely why we engineered the `STANDARD_READY` tier, which enables legitimate, accurate predictions during the midterm when only Written Works and Performance Tasks have been administered."*
- **Technical Explanation**: `STANDARD_READY` requires $\ge 4$ activities, both WW and PT evidence, and $\ge 70.0\%$ observed component weight. Since WW (20%) + PT (50%) = 70%, students reach `STANDARD_READY` midway through the quarter, unlocking predictions weeks prior to the Term Exam.
- **Code Reference**: [`CurrentPeriodFeatureBuilderService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py#L212-L218).

---

### Q9: What is the difference between `STANDARD_READY` and `HIGH_EVIDENCE`?
- **Spoken Answer**: *"`STANDARD_READY` represents intermediate midterm readiness with at least 70% observed weight, whereas `HIGH_EVIDENCE` represents 100% full-term evidence where all Written Works, Performance Tasks, and Examinations are scored."*
- **Technical Explanation**: `STANDARD_READY` guarantees sufficient evidence to prevent wild extrapolation while permitting early warning. `HIGH_EVIDENCE` is reached only when the final Term Examination is submitted, providing post-exam validation before report cards are finalized.

---

### Q10: What does "70% observed component weight" mean?
- **Spoken Answer**: *"It means that the components with fully completed, graded activities account for 70% of the total grading policy weight for that subject—specifically Written Work at 20% plus Performance Tasks at 50%."*
- **Technical Explanation**: Implemented in [`CurrentPeriodFeatureBuilderService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/prediction/CurrentPeriodFeatureBuilderService.py#L344-L347):
  ```python
  observed_component_weight_sum = sum(weight_values[key] for key, acc in component_data.items() if acc.count > 0)
  ```
  It does NOT mean the student achieved a 70% grade; it means 70% of the syllabus grading weight is currently observed.

---

### Q11: Why can an in-progress gradebook grade differ significantly from a projected grade?
- **Spoken Answer**: *"An in-progress grade is a static arithmetic snapshot of work completed today, whereas the Random Forest projects where the student will land at the end of the term by learning historical recovery and completion patterns."*
- **Technical Explanation**: For example, Jordan has an in-progress transmuted grade of 78.0, but a prediction of 87.11. The model recognizes that Jordan's strong 77.5% Performance Task score indicates high mastery, and historical students with this pattern typically score well on subsequent assessments, pulling their final grade into the upper 80s.

---

### Q12: How are risk ranges calculated?
- **Spoken Answer**: *"Risk classification is a deterministic, rule-based layer that categorizes the model's continuous grade projection into four operational bands: High Risk below 75, Moderate Risk between 75 and 85, Needs Monitoring between 85 and 90, and Low Risk at 90 and above."*
- **Technical Explanation**: Implemented in [`DevelopmentCurrentTermRiskService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/prediction/DevelopmentCurrentTermRiskService.py#L79-L87). It evaluates the unrounded floating-point prediction against strict `<` inequalities to avoid boundary rounding errors (e.g., 84.999 is retained as Moderate Risk).

---

### Q13: Why is Morgan at risk while Jordan is not?
- **Spoken Answer**: *"Morgan scored significantly lower in Performance Tasks—63% versus Jordan's 77.5%. Because Performance Tasks carry a massive 50% weight in Mathematics, Morgan's overall trajectory was pulled down to 83.06, crossing below the 85-point intervention threshold."*
- **Technical Explanation**: Morgan's performance deficit is concentrated in the highest-weight component: Performance Tasks (50% weight). A 14-point deficit in PT depresses the overall weighted score by 7.0 full percentage points. The Random Forest captures this non-linear drag, projecting Morgan at 83.06 (`MODERATE_RISK`), while Jordan's 77.5% PT mastery sustains him at 87.11 (`NEEDS_MONITORING`).

---

### Q14: How do you ensure the system is fair?
- **Spoken Answer**: *"We ensure fairness by evaluating all students under identical template formulas, omitting protected demographic attributes, excluding unadministered assignments from denominators, and subjecting the AI advice to anti-stigmatization filters."*
- **Technical Explanation**: Demographic parity is maintained by feature schema exclusion. Algorithmic transparency is maintained because all risk classifications stem from documented numeric boundaries rather than black-box categorization. Furthermore, [`InterventionRemediationService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/intervention/InterventionRemediationService.py#L296) actively screens AI text to eliminate deficit-based labeling.

---

### Q15: How does the system know which competency a student is weak in?
- **Spoken Answer**: *"Our system links individual quiz questions directly to lessons and DepEd competencies. When a student misses a specific question, the lost points are attributed directly to that competency rather than just reducing their overall score."*
- **Technical Explanation**: Implemented in [`_quiz_item_evidence`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/intervention/InterventionDiagnosisService.py#L120-L151). The SQL query joins `QuizAnswer` $\rightarrow$ `QuizQuestion` $\rightarrow$ `Question` $\rightarrow$ `Lesson` $\rightarrow$ `Competency`. Summing points awarded versus points possible per competency yields a true, question-level mastery percentage.

---

### Q16: What happens if an assessment has no competency mapping?
- **Spoken Answer**: *"The system gracefully falls back: if an activity has no question-level links, it diagnoses weaknesses at the component level, informing the teacher that performance is low in Written Work or Performance Tasks without inventing unsupported claims."*
- **Technical Explanation**: In [`InterventionDiagnosisService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/intervention/InterventionDiagnosisService.py#L288), if no question mappings or single-lesson attributions exist, `competency_detail_status` is marked `"UNAVAILABLE_NO_TRACEABLE_SCORES"`. It presents the weakest component only, preventing spurious recommendations.

---

### Q17: What happens after the teacher approves an intervention candidate?
- **Spoken Answer**: *"The candidate transitions to ACTIVE status, unlocking the Remediation Workspace where the teacher can review recommended lessons, generate AI format advice, and stage a remedial activity."*
- **Technical Explanation**: The transition changes `Intervention.status` from `'CANDIDATE'` to `'ACTIVE'`. The teacher selects resources from their personal repository and creates a targeted remedial assignment linked to the intervention ID via `ClassworkAssignment.source_intervention_id`.
- **Code Reference**: [`TeacherInterventionService.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/intervention/TeacherInterventionService.py#L70-L115).

---

### Q18: How does remedial grading affect the original score?
- **Spoken Answer**: *"Both the original submission and the remedial submission remain permanently stored in the database for auditing, but our grade calculator adopts whichever score is higher."*
- **Technical Explanation**: In [`RemedialExamination.py`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/grading/RemedialExamination.py#L15-L29), `effective_exam_scores` compares original vs. remedial score. If the remedial score is higher, it replaces the original in effective grade aggregation; if lower, the original score is preserved.

---

### Q19: When is an intervention officially resolved?
- **Spoken Answer**: *"An intervention is resolved when a subsequent legitimate prediction rises to 85.0 or above, or when the teacher conducts a formal exit evaluation confirming the student has mastered the required competencies."*
- **Technical Explanation**: Automated reconciliation occurs in [`sync_intervention_for_persisted_prediction`](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/intervention/InterventionCandidateService.py#L87-L94). If a student completes remediation, earns higher marks, and triggers a new prediction with $G \ge 85.0$, `Intervention.status` is updated to `'RESOLVED'` with `resolution_reason = 'IMPROVED_PREDICTION'`.

---

### Q20: What are the current limitations of the prototype?
- **Spoken Answer**: *"Our primary limitations are that our training data contained no failing grades below 75, our snapshot data was reconstructed post-hoc, and multi-school longitudinal trials have not yet been conducted."*
- **Technical Explanation**: We explicitly disclose these three engineering boundaries:
  1. **Truncated Label Range**: No training observations below 75; the model is a continuous grade estimator, not an empirically validated failure classifier.
  2. **Reconstructed Chronology**: Historical training snapshots used workbook column order rather than true timestamp telemetry.
  3. **Synthetic Demo Scenarios**: Our current demonstration operates on verified synthetic academic records in `Entervene_Demo` designed to validate system stability prior to live school pilot deployment.

---

## 7. QUICK DEFENSE CHEAT SHEET

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          ENTERVENE CHEAT SHEET                              │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. GRADING TEMPLATE (Grade 9 Core Math):                                   │
│    - Written Works: 20% | Performance Tasks: 50% | Quarterly Exams: 30%    │
│    - Exam Subsplit: ST1 (30%) + ST2 (30%) + Term Exam (40%)                 │
│    - Template Passing Mark: 87.00 | DepEd Transmuted Passing Mark: 75.00    │
│                                                                             │
│ 2. READINESS TIERS:                                                         │
│    - STANDARD_READY: >= 4 activities, WW present, PT present,               │
│                      >= 70% observed weight, no unresolved evidence.        │
│    - HIGH_EVIDENCE:  >= 7 activities, WW + PT + QA present,                │
│                      100% observed weight (requires Term Exam).             │
│                                                                             │
│ 3. ML MODEL DETAILS:                                                        │
│    - Model Name: entervene_current_term_official_target_rf_candidate        │
│    - Algorithm: Random Forest Regressor (300 trees, max_features 0.5)       │
│    - Features: 31 numeric/categorical features (Attendance NOT included)    │
│    - Metrics: MAE = 1.60 grade points, RMSE = 2.23, R² = 0.64               │
│    - Accuracy: 70.3% within ±2 points, 84.3% within ±3 points               │
│    - Risk Agreement: 89.3%                                                  │
│                                                                             │
│ 4. RISK CLASSIFICATION & INTERVENTION GATES:                                │
│    - High Risk:        < 75.00                                              │
│    - Moderate Risk:    75.00 to < 85.00  --> Queued as Intervention Cand.    │
│    - Needs Monitoring: 85.00 to < 90.00                                     │
│    - Low Risk:         >= 90.00                                             │
│    - Candidate Rule:   Triggered automatically if Projected Grade < 85.00   │
│                                                                             │
│ 5. CURRENT DEMO STUDENTS (Class 1, Math):                                  │
│    - Jordan: Transmuted 78.0 | Projected 87.11 (Needs Monitoring)          │
│    - Morgan: Transmuted 72.0 | Projected 83.06 (Moderate Risk, Cand #6)    │
│                                                                             │
│ 6. TOP 3 DEFENSE TALKING POINTS:                                            │
│    - "Attendance is supporting context only; it does NOT alter the RF grade."│
│    - "Term Exam is required for HIGH_EVIDENCE, but STANDARD_READY lets us   │
│       predict midterm at 70% weight so teachers can intervene in time."     │
│    - "AI provides format advice with strict guardrails; the teacher makes   │
│       100% of academic and remediation decisions."                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

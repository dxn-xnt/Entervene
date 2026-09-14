# TICKET-2026-ENROLLED-STUDENT-SCORING: Event-Driven Scoring Lifecycle & Ethical Data Separation for Real Enrolled Cohort

**Status**: Ready for Development (Architectural Refinement & Defense Positioning)  
**Severity**: Core Architecture (Academic Integrity & Ethical AI Governance)  
**Component**: ML Inference Pipeline / Teacher Grading Lifecycle / Data Governance  
**Target Release**: Immediate Next Milestone (Pre-Defense)  

---

## 1. Executive Summary & Ethical Decision

### 1.1 The Finding: Zero Unconverted Signal for Enrolled Students
An exhaustive audit of the Entervene codebase and data directories confirms:
1. **Enrolled Students**: The 80 students enrolled in `student_class` (Grades 7–11) have **0 rows in `student_period_grades`**, **0 rows in `student_assessment_scores`**, and **0 submissions**.
2. **Historical E-Class Records**: The 13,421 prediction records and underlying raw Excel workbooks (`backend/data/raw_eclass_records/`) originate from historical school years at Medellin National Science and Technology School (MNSTS). In accordance with DepEd Order 8 s. 2015 and the Data Privacy Act of 2012 (RA 10173), those learners' identities were anonymized to `MALE 1`, `FEMALE 1`, etc., and mapped to synthetic IDs (`STU-XXX-Y-N` / `Demo0001 ArchimedesSynthetic`).
3. **No Unconverted Gradebook Exists**: There is no hidden or unimported gradebook for the 80 currently enrolled students. Term 1 of AY 2025–2026 is currently active, and classroom teachers have not yet encoded assessment grades.

### 1.2 Decision: Rejection of Manufactured Evidence (`--seed-evidence` Stricken)
> [!CAUTION]
> **Defending Engineering & Academic Integrity**:
> Fabricating synthetic assessment scores (Written Work, Performance Tasks, Quarterly Exams) and attaching them to the 80 real enrolled student identities (`student_class`) to force a "believable" dashboard distribution is **academically dishonest and ethically unacceptable**.
> 
> If a capstone defense panelist or school administrator asks:
> *"Where did Juan Dela Cruz's 68% grade and HIGH_RISK flag come from?"*
> Answering *"We wrote a generator script that synthesized failing grades for real students so the dashboard wouldn't look empty"* destroys the central claim of the capstone—that this system predicts real academic risk from empirical student evidence.
> 
> Therefore, **the `--seed-evidence` proposal for real student identities is permanently rejected**.

---

## 2. The Two-Universe Architecture: Clean Separation of Concerns

To preserve strict scientific validity while delivering a compelling, rock-solid capstone defense, the system formally separates data into two distinct universes:

```mermaid
graph TD
    subgraph Universe 1: Live Enrolled Cohort (Production)
        A["80 Real Enrolled Students (student_class)"] --> B["Active Term 1 (AY 2025-2026)"]
        B --> C{"Teacher Has Encoded >= 50% Graded Evidence?"}
        C -- "No (Current State)" --> D["INSUFFICIENT_DATA (Zero Premature Labels)"]
        C -- "Yes (Post-Grading)" --> E["ModelScoringService -> Genuine Prediction"]
        D --> F["Live Dashboard: 0 at Risk (Ethical Default)"]
        E --> G["Live Dashboard: Actionable Risk"]
    end

    subgraph Universe 2: Historical Validation & Audit Cohort (Benchmark)
        H["13,421 Historical Predictions (MNSTS E-Class Records)"] --> I["Explicitly Tagged: HISTORICAL_UNMAPPED / [live-prediction-import]"]
        I --> J["Model Performance Audit (47.8% Low, 37.5% Monitoring, 14.6% Insufficient)"]
        J --> K["Algorithm Validation: Feature Importance, ROC-AUC, Risk Engine Separation"]
    end
```

### 2.1 Universe 1: Live Enrolled Cohort (Real World / Production)
- **Scope**: The 80 actively enrolled students across Grades 7–11.
- **Current State**: Academic Term 1 is underway. Teachers have not completed encoding formative/summative scores.
- **System Behavior**:
  - `data_coverage_ratio = 0.0` and `source_period_grade is None`.
  - [PredictionFeatureBuilderService.py](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/prediction/PredictionFeatureBuilderService.py) triggers `data_coverage_below_50`.
  - [RiskEngine.py](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/prediction/RiskEngine.py) cleanly classifies readiness as `INSUFFICIENT_DATA`.
  - [DashboardPredictionService.py](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/prediction/DashboardPredictionService.py) correctly reports **0 High Risk** and **0 Monitoring** students.
- **The Defense Narrative**:
  > *"The Entervene platform adheres to ethical AI principles and DepEd grading policies. Because Term 1 assessments are currently in progress, the engine enforces a strict minimum evidence threshold (50% data coverage). It refuses to guess or prematurely label real enrolled students as 'At Risk' without empirical classroom evidence. This protects learners from wrongful stigma and demonstrates robust guardrails against hallucinatory AI outputs."*

### 2.2 Universe 2: Historical Benchmark & Validation Cohort (Research & Validation)
- **Scope**: 13,421 historical predictions from the MNSTS E-Class Record dataset (1,271 synthetic learner personas).
- **Labeling**: Explicitly segregated and tagged with `data_status = 'SUFFICIENT'` or `INSUFFICIENT_DATA` and resolved to `HISTORICAL_UNMAPPED` / `UNASSIGNED`.
- **Purpose**: Demonstrates to the panel that the Random Forest model and rule-based risk engine perform with statistical validity when historical evidence is present:
  - **47.8% Low Risk** (`LOW_RISK`)
  - **37.5% Instructional Monitoring** (`NEEDS_MONITORING`)
  - **14.6% Insufficient Evidence** (`INSUFFICIENT_DATA` with `—` suppression)
  - Clear separation of verified candidate profiles:
    - *Struggling Profile*: Score 100.0 $\rightarrow$ `HIGH_RISK` (7 trigger rules).
    - *Borderline Profile*: Score 49.0 $\rightarrow$ `NEEDS_MONITORING` (predicted 84.61).
    - *Good Profile*: Score 10.0 $\rightarrow$ `LOW_RISK` (predicted 92.08).

### 2.3 Universe 3 (Optional Sandbox): Dedicated Demo Personas (`[DEMO-COHORT]`)
If the capstone panel requests a live end-to-end demonstration of a student transitioning from good standing to at-risk:
- The demonstration must be executed on a dedicated synthetic demo persona (e.g. `student_lrn = "999000000001"`, `first_name = "DemoLearner"`, `last_name = "ArchimedesSynthetic"`).
- It must **never** overwrite or fabricate data on Juan Dela Cruz or any other real enrolled student record.

---

## 3. Revised Technical Implementation Plan

### 3.1 Pipeline Purpose & Scope
Rather than a synthetic data generator, `score_enrolled_cohort.py` becomes the **Production Batch Scoring CLI Pipeline**:
```bash
python scripts/score_enrolled_cohort.py --academic-period-id 1 [--dry-run]
```
- Executes against real database records as teachers encode grades.
- When run in the current empty-grade state, it executes cleanly and idempotently, verifying that all 80 students evaluate to `INSUFFICIENT_DATA` with grades and scores suppressed to `NULL` / `—`.
- As teachers encode grades during the semester, subsequent runs of the exact same CLI automatically graduate students from `INSUFFICIENT_DATA` to actionable predictions (`LOW_RISK`, `NEEDS_MONITORING`, or `HIGH_RISK`).

### 3.2 Service Layer Reuse (Strict Zero-Duplication Contract)
- `score_enrolled_cohort.py` must **never** implement custom model scoring, heuristic thresholding, or direct SQL inserts.
- It MUST import and delegate directly to:
  ```python
  from app.services.prediction.ModelScoringService import score_student_prediction
  from app.services.prediction.PredictionPersistenceService import save_prediction
  from app.services.prediction.PredictionFeatureBuilderService import build_prediction_features_from_records
  ```
- **Guaranteed Guardrails**: Reusing `score_student_prediction` guarantees that:
  - `predicted_period_grade = None` and `risk_score = None` whenever data coverage is $< 50\%$.
  - Feature column alignment and imputation are handled centrally.
  - Audit logging and transaction atomicity are preserved.

### 3.3 Period & Teacher Resolver Binding
- Freshly generated predictions must set:
  - `source_period_id = 1` (Active Term 1)
  - `target_period_id = 1` (Matching `SubjectLoad.academic_period_id`)
- **Outcome**: When teachers (such as Maria Cruz for Grade 9 Filipino) or admins inspect predictions, [TeacherAssignmentResolver.py](file:///c:/Users/Roy%20Adrian%20Rondina/Desktop/3rd%20Year/2nd%20Sem/Entervene/Entervene/backend/app/services/prediction/TeacherAssignmentResolver.py) matches `(class_id, subject_id, 1)` to the published load, correctly displaying **Tier 1 (`ASSIGNED`)** and `Cruz, Maria` without fallback downgrades.

---

## 4. Panel Defense Strategy & Talking Points

| Panelist Question | Recommended Engineering Response |
|---|---|
| *"Why does the live dashboard show 0 High Risk students across all grades?"* | *"Term 1 of the current school year is currently underway. Teachers have not yet encoded the minimum 50% threshold of formative/summative grades. In compliance with DepEd EWS standards and ethical AI guidelines, Entervene deliberately suppresses risk predictions (classifying them as Insufficient Data) to prevent premature or stigmatizing labels on real students without empirical evidence."* |
| *"How do we know the model actually works if the live dashboard is at 0?"* | *"We validated the model against 13,421 real DepEd E-Class Record evaluations from Medellin National Science and Technology School. The Random Forest regressor achieves high fidelity, and our risk engine cleanly isolates 47.8% Low Risk and 37.5% Monitoring cases. Furthermore, offline testing of struggling vs. good candidate profiles confirms that as soon as a student's grade drops below 75 or missing activities reach 3, the system immediately flags HIGH_RISK with 100% confidence and targeted intervention recommendations."* |
| *"Can you show us a prediction in action right now?"* | *"Yes. We can demonstrate using our Historical Validation Cohort (which includes full feature attributions, SHAP contributions, and teacher review sheets), or we can enter a sample quiz score in the Teacher Portal and watch the student's data coverage transition live."* |

---

## 5. Acceptance Criteria
- [ ] Real enrolled students' records remain authentic (0 fabricated grades or assessment scores).
- [ ] `score_enrolled_cohort.py` runs idempotently, cleanly delegating to `ModelScoringService.score_student_prediction`.
- [ ] For students with $< 50\%$ data coverage, predictions are persisted as `INSUFFICIENT_DATA` with `predicted_period_grade = NULL` and `risk_score = NULL`.
- [ ] `target_period_id` binds strictly to `SubjectLoad.academic_period_id` (Term 1 = 1) for Tier 1 resolver attribution.
- [ ] System status / empty state on the frontend articulates that Term 1 grades are in progress, setting transparent expectations for stakeholders.
- [ ] Historical benchmark data remains clearly labeled and segregated from real enrolled rosters.

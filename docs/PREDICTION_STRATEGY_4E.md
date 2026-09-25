# Prediction strategy evidence (Task 4E)

Audited 2026-09-24. This is an **internal robustness evaluation of the frozen V3 architecture**, not independent external validation or a new production model. No artifact, feature schema, subject map, registry flag, runtime resolver, UI, or Intervention behavior changed.

## Verified JHS development data

`backend/data/datasets/current_term_development/current_term_development_snapshots.csv` contains 5,595 snapshots (25%, 50%, and 75% evidence) from 1,865 student-periods, 467 students, and 14 real historical E-Class Record workbooks. All records are Grades 7–10. School-year counts are 2,760 (2023–2024), 387 (2024–2025), and 2,448 (2025–2026). Subject counts are Mathematics 1,539, Science 1,200, English 888, ICT 408, and Creative Technology 1,560. Target counts: **3** below 75 (one student-period), 69 at 75–79, 330 at 80–84, 1,125 at 85–89, and 4,068 at 90+. The original train/validation/test splits contain 3,903/840/852 snapshots with **zero student overlap**. The dataset builder splits by `raw_student_key`; no student appears in more than one workbook. All 3 below-75 snapshots were in the original train split. Historical QA is an aggregate exam analogue, and partial snapshots follow component column order rather than measured assessment dates.

The currently verified **live** JHS mapping has seven exact catalog rows, but the historical evaluation subset covers only Grade 7 English and Grade 10 Mathematics. It has **2,019 snapshots, 673 student-periods, 169 students, five workbooks, three school years**. There is no matched historical evaluation set for verified live Grade 7 Science, Grade 8/9 English, or Grade 10 Science. Enhanced Mathematics/Science, TLE→ICT, and Creative Technology mappings remain unresolved or unsupported for this task.

## Leakage-resistant internal evaluation

Use five **leave-one-workbook-out** folds, one for each eligible Grade 7 English or Grade 10 Mathematics source. In each fold, fit a temporary model with the unchanged `rf_pipeline` and 31 features from `TrainCurrentTermDevelopmentModel.py` on **all other V3 development rows**, including its other training-domain subjects, then score only the eligible held-out workbook. No hyperparameters were selected using these folds. Entire student, class/source workbook, and student-period groups stay out of that fold's training set. The official V3 `.joblib` was never fitted or overwritten. Results below are snapshot-weighted; repeated snapshots of one student-period are correlated. The workbooks are existing training-source material, so these folds do **not** constitute external or independent production validation.

| Held-out evaluation | N snapshots | MAE | RMSE | R² | ±1 | ±2 | ±3 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| All five folds | 2,019 | **2.0891** | **3.0215** | **0.6199** | **41.51%** | **61.86%** | **73.95%** |
| Grade 7 English (2 sources, 888 rows) | 888 | 1.7489 | 2.5929 | 0.4751 | 47.41% | 65.88% | 78.49% |
| Grade 10 Mathematics (3 sources, 1,131 rows) | 1,131 | 2.3561 | 3.3195 | 0.5585 | 36.87% | 58.71% | 70.38% |

Each workbook was evaluated once: fold MAEs were 1.9234 and 1.5744 for English, and 2.3169, 2.2968, and 2.4508 for Mathematics. GroupKFold by student is possible but weaker than holding out full workbooks here. Class/cohort holdout is implemented by these workbook folds. Leave-one-school-year-out is mathematically possible, but year and subject are strongly confounded: English appears only in 2025–2026, the 2024–2025 year has only one Mathematics workbook, and there is no same-subject training source for a held-out English year. It would test extrapolation to unseen subjects as much as time transfer and cannot substitute for current three-term validation.

| Actual target range | N snapshots | Distinct periods | MAE | Mean predicted minus actual |
| --- | ---: | ---: | ---: | ---: |
| <75 | **3** | **1** | **9.9398** | **+9.9398** |
| 75–79 | 42 | 14 | 5.4043 | +5.3799 |
| 80–84 | 168 | 56 | 3.0180 | +2.9078 |
| 85–89 | 402 | 134 | 2.1192 | +1.0744 |
| ≥90 | 1,404 | 468 | 1.8533 | −1.0609 |

The one below-75 target is 73.66; its three held-out snapshot predictions average 83.60. Lower actual grades tend to be overpredicted in this internal test, while the highest grades are slightly pulled downward. These observations warrant caution, not a claim of stable population bias or calibrated failure detection. The original frozen V3 held-out test MAE 1.5714 is a different, less source-separated development test and has no below-75 case.

## SHS provisional-estimate feasibility

Grades 11–12 remain outside the V3 scorer (`UNSUPPORTED_GRADE_SCOPE`). The current Grade 11 Campos/Zara pathways lack representative completed three-term records, and the Grade 12 pathway transition is future client information. Old semester/quarter SHS records must not be used as current-pathway validation.

The grading engine resolves WW/PT/EX template weights and computes official weighted **initial grade** and transmutation. The gradebook may calculate with unobserved components contributing zero; the feature builder's normalized partial percentage instead divides by the **observed** weight. Neither is, by itself, a validated final-term forecast. `ExaminationCalculator` knows ST1/ST2/Term Exam and their 30/30/40 internal weights; the current V3 feature builder exposes an aggregate EX percentage only when all three typed subparts are complete. Current SHS official templates have not been supplied, so even the database's configured weights are not yet verified as the client's current SHS rules.

A **conditional persistence scenario** is mathematically definable but not deployment-ready: for component `c` with official weight `w_c`, let `p_c = 100 × recorded earned / recorded HPS` using only evidence available at cutoff. Assume future scores within that component continue at `p_c`. If all nonzero-weight components have valid evidence, compute `estimated initial grade = Σ(w_c × p_c)` with weights as fractions, then apply the **verified official term-grade transmutation** `T(estimated initial grade)`. This differs from a running grade because it assumes the observed component percentages persist through remaining work. Missing components, especially EX, leave their future values unidentified; imputing them from WW/PT would add an unvalidated assumption. Until an official subject/term template, all component evidence, observation-time cutoff, and transmutation parity are verified, show **unavailable**, not a projected final grade. Even when those checks pass, label a future implementation **Provisional Term Grade Estimate — based on currently recorded academic performance and a persistence assumption**, never AI/Random Forest/confidence.

That conditional method is grade-agnostic in principle and could be assessed for unsupported JHS subjects and SHS where the official subject template matches Entervene's configuration. **No SHS subject is cleared for it now.** Do not automatically apply intervention bands: **REQUIRES_POLICY_DECISION**. Thresholding an unvalidated conditional estimate could imply risk certainty or trigger actions despite the unknown future EX result.

## Panel position and next task

“Grades 7–10 are our main ML scope. We tested the Random Forest approach on real JHS records by holding out whole workbooks and their students; this is stronger internal evidence, not independent current three-term validation. The only failing student-period was overpredicted, so we disclose that limit and do not claim reliable failure detection. SHS pathways have changed, so older quarter/semester records remain useful historical references but cannot validate current pathway predictions. A transparent non-ML persistence estimate is possible only after official SHS grading rules and complete component evidence are verified. School use can collect current pathway outcomes for later validation and model development without inventing accuracy today.”

Next implementation task: **design and test a separate, clearly labelled provisional-estimate contract only after obtaining official SHS ECR rules and confirming subject-level template parity**. Preserve V3 as the JHS development scorer. Separately, future Teacher/Admin Term Record Import should validate grade/subject/term and weights, preview mapping, import scores/exams into normal academic records with provenance, and support later representative datasets; it is not implemented in Task 4E. V3 remains DEVELOPMENT, inactive, and not production or independent-three-term validated.

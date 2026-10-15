# SHS historical-data fitness audit (Task 4D)

Audited 2026-09-24. Scope: four real historical SHS E-Class Record workbooks in `backend/data/raw_eclass_records`, `backend/data/SCHEDULE REFERENCES (CTU).xlsx`, and the configured PostgreSQL curriculum. Counts below exclude roster placeholders and require a named row plus a cached numeric official grade in the workbook; no student identity is reproduced here. This is an audit, not a model training or validation result.

## Historical file inventory

| File | Workbook evidence | Scores and outcome coverage | Fitness for current pathway predictions |
| --- | --- | --- | --- |
| `ORAL COM 11-CAMPOS .2024-2025.xlsx` | **Filename mismatch:** actual subject field is **Reading and Writing**, Grade 11 Campos, 2024–2025, second semester, `Academic Track (except Immersion)`. Sheets are 1ST/2ND quarter slots (third/fourth quarters in the semester summary) plus Final Semestral Grade; not three terms. The 1ST sheet's cells implement WW/PT/QA **25/50/25**. The 2ND sheet's QA header says **30%**, while its weight cell remains **25%**; needs source clarification. | Individual WW/PT/one QA scores and HPS are present for **32** students with 1ST-sheet grades. The 2ND sheet has 33 roster names but **no** scores or grades; no final-semester outcomes. **Partial record.** | `HISTORICAL_ONLY`; not a current Campos offering and incomplete. |
| `PRECALCULUS 11-CAMPOS - 1st.xlsx` | Precalculus, Grade 11 Campos, 2023–2024, first semester, old `Academic Track (except Immersion)`. Two quarters; WW/PT/QA **25/45/30**. | Individual activity scores/HPS, quarterly grades, and final-semester grades for **40** students in both quarters. | `NOT_REPRESENTATIVE_OF_CURRENT_PATHWAY`: current Campos has no active Precalculus offering; weights and period structure differ. |
| `PRECALCULUS  11-ZARA - 1st.xlsx` | Precalculus, Grade 11 Zara, 2023–2024, first semester, old `Academic Track (except Immersion)`. Two quarters; WW/PT/QA **25/45/30**. | Individual activity scores/HPS, quarterly grades, and final-semester grades for **40** students in both quarters. | `NOT_REPRESENTATIVE_OF_CURRENT_PATHWAY`: current Zara has no active Precalculus offering; pathway, weights, and period structure differ. |
| `PERDEV 12 - DELMUNDO.xlsx` | Personal Development, Grade 12 Delmundo, 2025–2026, first semester, `Core Subject (All Tracks)`. Two quarters; WW/PT/QA **25/50/25**. | Individual activity scores/HPS for **32** named students in both quarters; first-quarter grades for 32, second-quarter and final-semester grades for **31**. **One incomplete outcome.** | `NOT_REPRESENTATIVE` of the *configured* current Grade 12 catalog: Personal Development has no active Grade 12 subject/offering; no current Grade 12 class/load is configured. It remains useful as an old-curriculum historical record. |

These are real scored school records, but the historical QA is a single aggregate. They do **not** provide separate ST1, ST2, and Term Exam values or current three-term targets. Workbook student names and staff/contact details must be removed before creating any research extract. The `SCHEDULE REFERENCES (CTU).xlsx` file is a three-term, 45-minute timetable reference, **not** student scores or grade outcomes. It labels Campos as Engineering/Mathematics and Zara as Medical/Sciences. It also lists General Mathematics/General Science and grouped science or physics labels that do not match the currently active offering list; treat that schedule as a reference requiring reconciliation, not proof of a taught subject.

## Current configured pathway curriculum

The latest populated database curriculum is 2025–2026. The separate 2026–2027 year has no listed subject offerings. Two Grade 11 classes have active, published Term 1 loads:

| Section / enabled pathway | Current active offered and published subjects |
| --- | --- |
| **Campos** / `engineering-math` | `INTROENG1` Introduction to Engineering; `STATPROB` Statistics and Probability; `RESEARCH1` Research 1 |
| **Zara** / `medical-courses` | `HAP1` Human Anatomy and Physiology; `HSF1` Health Science Fundamentals; `STATPROB` Statistics and Probability; `RESEARCH1` Research 1 |

Precalculus, General Biology 1, General Mathematics, Earth and Life Science, and Computer-Aided Design Fundamentals remain in the Grade 11 catalog, but have only archived or no active offerings and no published active loads. Grade 12 has active catalog entries `PHYS1` General Physics 1 and `WI12` Work Immersion, **no active offering, class, or load**. The client's description that Grade 12 currently follows an older curriculum is useful context, but the database does not provide a populated current Grade 12 curriculum against which to establish direct representativeness. The client's statement that **next academic year Grade 12 is expected to transition toward the Medical/Engineering pathways** is `CLIENT_PROVIDED_FUTURE_CURRICULUM_INFORMATION`; that transition is not configured in the inspected database.

## Appropriate and inappropriate uses

The old SHS files are suitable for parser development, legacy schema tests, descriptive and grade-distribution analysis, and exploratory feature engineering or model prototypes **labelled historical**. Auxiliary or pretraining experiments may be researched separately, with provenance and leakage controls, but cannot establish current-pathway accuracy. The incomplete Reading and Writing file is especially limited to first-quarter analyses. The Grade 12 Personal Development workbook describes an older subject and must be kept separate from current/future pathway cohorts.

None of these files justifies **independent production validation** or **current-pathway production training** for Campos/Zara Medical/Engineering predictions. Shared section names do not establish curriculum identity across years; Precalculus cannot automatically become current Mathematics or Statistics, and legacy aggregate QA cannot be rewritten as ST1/ST2/Term Exam. Current old-curriculum Grade 12 records will be still less representative **after** the proposed transition unless the client supplies evidence of matching subjects, grading, and terms.

## Architecture and collection decision

**Choose C: NO SHS ML YET UNTIL MORE DATA EXISTS.** V3 remains JHS-only and must continue returning `UNSUPPORTED_GRADE_SCOPE` for Grades 11–12. A separate SHS model family is a possible later design, once official SHS ECR contracts and enough representative outcomes exist; reusing JHS V3 as-is has no supporting validation. Normal SHS classes, subjects, grades, attendance, assignments, and submissions remain available.

Collect **now** from each current Grade 11 pathway: official current Term 1–3 ECR template and subject-specific grading rules; school year/cohort, grade, section/class, pathway, subject code and name, term, stable pseudonymous student key, WW and PT item scores with HPS, each examination component and HPS as actually used, assessment/availability dates where available, applicable weights, and the official term grade. Keep source/workbook identifiers only for provenance and overlap checks. Do not include names, learner numbers, contact details, addresses, or identifying free text. Request enough naturally occurring low and high outcomes to assess behavior; do not invent a minimum before seeing counts.

Following the same pseudonymous Grade 11 cohorts into the client's proposed Grade 12 pathways next academic year would materially improve future longitudinal coverage, reveal curriculum changes, and help separate student overlap across training and validation. It does not by itself guarantee model validity; official Grade 12 contracts, completed outcomes, independent cohorts, cutoff timestamps, and acceptance criteria remain necessary.

**Next task:** reconcile the current SHS subject offerings with the schedule reference, obtain official current Grade 11 and forthcoming Grade 12 pathway ECR contracts, and begin privacy-preserving collection of completed pathway records. No V3/model, database curriculum, registry, runtime, or Intervention change is authorized by this audit.

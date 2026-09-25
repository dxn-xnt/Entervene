# Client three-term E-Class Record contract audit

Audited 2026-09-24 for Task 4B. This document records the format visible in the [client Drive folder](https://drive.google.com/drive/folders/1k6ScsB9jxC2KyAZFAki6s-4tKI2KgneW). It establishes format evidence for the supplied Grades 2–10 workbooks, not model accuracy or an authorized Grades 11–12 grading policy. No model, runtime, registry, or database state was changed.

## Supplied workbooks and record status

| Workbook | Intended range and subjects | Term structure | Component weights | Record status |
| --- | --- | --- | --- | --- |
| [Core subjects](https://docs.google.com/spreadsheets/d/1zqSsW7vNz3H1NhYebMDXRxG8cnPVpvGq/edit) | Grades 2–10; Science, Mathematics, English, Filipino, Araling Panlipunan | First, Second, Third Term and final-grades summary | WW 20, PT 50, EX 30 | Official template with one numeric **example** on First Term, row 1; no named/identified completed student or complete three-term outcome |
| [EPP/TLE](https://docs.google.com/spreadsheets/d/1nk_f80sN66cNq6Fg339ueBR0x-fUvReq/edit) | Grades 2–10; EPP/TLE composite | Three terms and final-grades summary | 20/60/20 | Blank template |
| [EPP/TLE per component](https://docs.google.com/spreadsheets/d/1ncbFGVpqf-xVKgXMgOHSbUQOHNSGHr6X/edit) | Grades 2–10; ICT in each term, alongside AFA in Term 1, FCS in Term 2, IA in Term 3 | Three terms, two component sheets per term, component and combined term-grade summary | 20/60/20 per component | Blank template |
| [GMRC / Values Education](https://docs.google.com/spreadsheets/d/1YEZ6jSDbE_zzTIPJimBMcB6IbY2onJAe/edit) | Grades 2–10; GMRC / Values Education | Three terms and final-grades summary | WW cognitive 10 + affective 10; PT cognitive 10 + affective 10 + behavioral 30; EX 30 | Blank template |
| [Music and Arts / PE and Health](https://docs.google.com/spreadsheets/d/1xqRGLIjXcGLbnh3wth-sEOhl59q161CH/edit) | Grades 2–10; Music and Arts plus PE and Health | Three terms, two component sheets per term, combined term-grade summary | 20/60/20 per component | Blank template |

The folder also contains Grade 1 and Kinder workbooks and an update-log shortcut. Those are outside Entervene's Grades 7–12 scope. No Grades 11–12 ECR workbook was supplied: **GRADE_11_12_ECR_NOT_SUPPLIED**. The five relevant workbooks have **zero verified completed student-term records**, and thus zero verified below-75 outcomes; template row numbers, formulas, and the core example are excluded from these counts.

## Confirmed Grades 7–10 contract

The core workbook has separate FIRST TERM, SECOND TERM, and THIRD TERM sheets. Each has Written / Oral Works, Product / Performance Tasks, and Examinations with 20% / 50% / 30% weights. Examinations have ST1, ST2, and TE (Term Exam), weighted 30% / 30% / 40% **inside** EX. It provides Initial Grade, Term Grade, and Descriptor columns. The final-grades sheet has Term 1, Term 2, Term 3, Final Grade, Descriptor, and Remark columns. The single numeric core example is in First Term only; its later terms and final grade are blank. The workbook is format evidence, not an independent validation cohort.

The EPP/TLE and Music/Arts/PE/Health workbooks retain three terms and the same internal exam split, but use 20% / 60% / 20% main weights. GMRC/Values Education uses the detailed domain weights shown above and the 30/30/40 exam split. Exact annual final-grade formulas and any subject-specific exceptions should be checked against completed client records before operational adoption; the summary sheets expose the fields but provide no completed calculation to reconcile.

## Entervene compatibility

| Client official field or behavior | Entervene current implementation | Classification |
| --- | --- | --- |
| Three terms, term-grade and final-grade views | PostgreSQL has Term 1–3 periods; teacher grade view displays term and final grades | MATCH |
| Core WW/PT/EX 20/50/30 | Active Core Subjects template has 20/50/30; gradebook resolves assigned template weights | MATCH when the correct template is assigned |
| EPP/TLE and MAPEH 20/60/20 | Active EPP/TLE and MAPEH templates have 20/60/20 | MATCH when assigned |
| Values/GMRC domain split 10+10 / 10+10+30 / 30 | Active Values Education / GMRC template is generic 20/50/30, without those five domain components | MISMATCH |
| ST1/ST2/Term Exam 30/30/40 | `ExaminationCalculator` and gradebook implement the internal split; teacher classwork controls expose exam subtypes | MATCH for explicitly typed exams; PARTIAL MATCH for older unlabeled scores, which may be assigned by fallback order |
| Official EX aggregate as a V3 feature | `CurrentPeriodFeatureBuilderService` collapses a **complete** ST1/ST2/Term Exam set to one QA analogue; partial typed sets do not produce an exam percentage | PARTIAL MATCH |
| Initial Grade, Term Grade, Descriptor | Gradebook calculates weighted initial grade, transmutation, and performance descriptor; teacher UI displays them | MATCH at field level; exact official-formula parity needs a populated comparison |
| Official core subject scope | V3 supports canonical Mathematics, Science, English; Filipino and Araling Panlipunan are absent. Live Grades 7–10 codes include `MATH7`, `SCI7`, `ENG7` and enhanced variants; the current runtime passes the code through without the training builder's alias normalization, so these codes fail V3's exact supported-subject check | PARTIAL MATCH; runtime mapping gap |
| Official ICT component | EPP/TLE component workbook labels ICT; live subject catalog has TLE8/TLE9, but no exact ICT code, and runtime feature normalization uses subject code/name rather than interpreting TLE as ICT | POSSIBLE_BUT_REQUIRES_CONFIRMATION |
| Creative Technology | No supplied workbook or live subject code proves a matching client subject/component | UNSUPPORTED |
| Grades 11–12 format | Live catalog includes SHS subjects and a Grade 11 elective template, but no client SHS ECR was supplied | NOT IMPLEMENTED as a verified client contract |
| Demo seed | Demo Mathematics uses 20/50/30 with fabricated scores and no finalized validation outcomes | NOT APPLICABLE to client format or model validation |

V3's frozen schema contains 31 model features: grade level, three weights, aggregate WW/PT/QA score and HPS/count/percentage/weighted-score fields, evidence flags, partial totals, and subject. Official item scores and HPS directly supply WW/PT inputs and, once all three exams are available, an aggregate EX analogue; percentages, counts, flags, and weighted scores are derivable. The template does not supply real assessment timestamps, prior partial snapshots, actual student metadata, or completed term targets. Typed ST1 or ST2 alone has no model-facing aggregate in the current production-intended builder. The older V3 training data used historical aggregate QA, not separate ST1/ST2/TE. Grades 11–12 and unsupported subjects cannot be inferred into its validated domain.

Column order permits a hypothetical progression through WW1, WW2, PT1, PT2, ST1, ST2, and TE, but is not an observation timestamp: **TIMING_APPROXIMATE_FROM_ACTIVITY_ORDER**. True cutoff-based validation requires dated assessment availability, or an explicitly qualified approximation.

## Mapping and validation decisions

- **POSSIBLE_BUT_REQUIRES_CONFIRMATION:** Mathematics, Science, and English are named in the official core template and are canonical V3 subjects at 20/50/30. Their live Grades 7–10 codes are grade-specific (`MATH7`, `SCI7`, `ENG7`, etc.). The current production-intended feature builder does not canonicalize these codes, so the live scoring path is **not verified** for those catalog rows. Confirm exact subject equivalence, then address the mapping in a separate authorized task without changing frozen V3's supported list here.
- **POSSIBLE_BUT_REQUIRES_CONFIRMATION:** ICT is explicitly named in the EPP/TLE component workbook and V3 supports literal `ICT` at 20/60/20. The existing live TLE8/TLE9 codes are broader and do not automatically map to ICT. Confirm the school's actual subject code, enrollment, and whether component grades or a combined TLE term grade is the intended prediction target.
- **UNSUPPORTED:** Creative Technology has no verified client workbook or matching live code here. Filipino, Araling Panlipunan, Values/GMRC, MAPEH, and SHS subjects are outside V3's frozen supported subject list.

Task 4A's **INDEPENDENT_VALIDATION_NOT_POSSIBLE** conclusion remains in force. The new files validate current Grades 7–10 **format** but contain no independent completed cohort for **model** validation. Do not rerun Task 4A scoring on templates or examples.

## Exact client data request

Request anonymized completed **current three-term** class records for Grades 7–10 Mathematics, Science, and English first, plus ICT only after its official subject/target mapping is confirmed. Supply school year, grade level, official subject code/name, class/section, term number, stable pseudonymous student key, WW item scores and HPS, PT item scores and HPS, ST1/ST2/Term Exam scores and HPS, applicable component weights, official Term Grade, and assessment/grade-availability dates when recorded. Include naturally occurring lower-performing cases; count them rather than setting an arbitrary minimum. Keep names, learner numbers, contact data, addresses, and identifying free text out of the validation extract. Stable keys are for overlap and grouped evaluation, never predictive features. Exports must be independent of V3's older source workbooks.

Separately request the official **Grades 11–12 three-term ECR template**, SHS subject list/codes, each subject's component weights and examination structure, term-grade calculation, annual final-grade calculation, and any subject-specific exceptions. Do not apply the Grades 2–10 contract to SHS without that evidence.

Next task: obtain and audit those completed records and SHS contract; then, only if independent supported records exist, repeat Task 4A with the frozen V3 artifact and documented cutoffs. Production promotion and Intervention remain separate tasks.

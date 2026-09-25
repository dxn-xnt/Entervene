# Current-term V3 scope audit (Task 4C)

Audited the configured PostgreSQL curriculum on 2026-09-24. All offering/load counts below refer to the configured 2025–2026 year; the separate 2026–2027 year has no listed subject offerings. `Load` counts mean published, active-version subject loads. An active subject without an active offering or load is a catalog entry, not proof of a current taught class. This is a development prediction scope, not production validation.

The client [Grades 2–10 official ECR contract](CLIENT_THREE_TERM_ECR_CONTRACT.md) establishes the JHS three-term core 20/50/30 format and EPP/TLE 20/60/20 format. It does not supply an SHS ECR or completed independent records.

## JHS Grades 7–10

All rows below are actual subject catalog records. `Canonical` is the frozen V3 label only where explicitly mapped; `—` means no mapping. All supported rows use the client core ECR structure, subject to future independent validation. Enhanced subjects are held pending confirmation that their actual scores/targets have the same meaning as the model's historical canonical subject. `Offering` and `Load` counts make current workflow usage explicit.

| Grade | Code | Live subject | Catalog | Offering / load | Weights | Canonical | Client ECR | Prediction support |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 7 | MATH7 | Mathematics 7 | active | 3 / 2 | 20/50/30 | MATHEMATICS | Core match | SUPPORTED |
| 7 | SCI7 | Science 7 | active | 3 / 2 | 20/50/30 | SCIENCE | Core match | SUPPORTED |
| 7 | ENG7 | English 7 | active | 3 / 2 | 20/50/30 | ENGLISH | Core match | SUPPORTED |
| 7 | FIL7 | Filipino 7 | archived | 0 / 0 | 20/50/30 | — | Core format, subject excluded | UNSUPPORTED_SUBJECT |
| 7 | RSRCH1 | Research | archived | 0 / 0 | 20/50/30 | — | No V3 evidence | UNSUPPORTED_SUBJECT |
| 8 | EMATH8 | Enhanced Mathematics 8 | active | 3 / 1 | 20/50/30 | — | Core weight match; enhanced semantics unverified | MAPPING_UNVERIFIED |
| 8 | ESCIE8 | Enhanced Science 8 | active | 3 / 1 | 20/50/30 | — | Core weight match; enhanced semantics unverified | MAPPING_UNVERIFIED |
| 8 | ENG8 | English 8 | active | 3 / 1 | 20/50/30 | ENGLISH | Core match | SUPPORTED |
| 8 | FIL8 | Filipino 8 | active | 3 / 1 | 20/50/30 | — | Core format, subject excluded | UNSUPPORTED_SUBJECT |
| 8 | SRES8 | Science Research | active | 3 / 1 | 20/50/30 | — | Research is not Science | UNSUPPORTED_SUBJECT |
| 8 | FRE8 | French 8 | active | 3 / 1 | 20/50/30 | — | No V3 subject evidence | UNSUPPORTED_SUBJECT |
| 8 | TLE8 | TLE 8 | active | 3 / 1 | 20/60/20 | — | TLE workbook has an ICT component, but target equivalence is unverified | CLIENT_CONFIRMATION_REQUIRED |
| 8 | MAPEH8 | MAPEH 8 | active | 3 / 1 | 20/60/20 | — | MAPEH format; subject excluded | UNSUPPORTED_SUBJECT |
| 8 | AP8 | Araling Panlipunan 8 | active | 3 / 1 | 20/50/30 | — | Core format; subject excluded | UNSUPPORTED_SUBJECT |
| 8 | VE8 | Values Education 8 | active | 3 / 1 | 20/50/30 | — | Values component details differ | UNSUPPORTED_SUBJECT |
| 9 | MATH9 | Enhanced Mathematics 9 | active | 3 / 3 | 20/50/30 | — | Core weight match; enhanced semantics unverified | MAPPING_UNVERIFIED |
| 9 | SCI9 | Enhanced Science 9 | active | 3 / 3 | 20/50/30 | — | Core weight match; enhanced semantics unverified | MAPPING_UNVERIFIED |
| 9 | ENG9 | English 9 | active | 3 / 3 | 20/50/30 | ENGLISH | Core match | SUPPORTED |
| 9 | FIL9 | Filipino 9 | active | 3 / 3 | 20/50/30 | — | Core format; subject excluded | UNSUPPORTED_SUBJECT |
| 9 | FRE9 | French 9 | active | 3 / 3 | 20/40/40 | — | Unsupported weight and subject | UNSUPPORTED_WEIGHT / UNSUPPORTED_SUBJECT |
| 9 | SCIRES9 | Science Research | active | 3 / 3 | 20/40/40 | — | Research is not Science; weight differs | UNSUPPORTED_WEIGHT / UNSUPPORTED_SUBJECT |
| 9 | MAPEH9 | MAPEH 9 | active | 3 / 3 | 20/60/20 | — | MAPEH format; subject excluded | UNSUPPORTED_SUBJECT |
| 9 | VALED9 | Values Education 9 | active | 3 / 3 | 20/50/30 | — | Values component details differ | UNSUPPORTED_SUBJECT |
| 9 | AP9 | Araling Panlipunan 9 | active | 3 / 3 | 20/50/30 | — | Core format; subject excluded | UNSUPPORTED_SUBJECT |
| 9 | TLE9 | TLE 9 | active | 3 / 3 | 20/60/20 | — | TLE/ICT target equivalence unverified | CLIENT_CONFIRMATION_REQUIRED |
| 10 | MATH10 | Mathematics 10 | active | 3 / 0 | 20/50/30 | MATHEMATICS | Core match | SUPPORTED; no published active load |
| 10 | SCI10 | Science 10 | active | 3 / 0 | 20/50/30 | SCIENCE | Core match | SUPPORTED; no published active load |
| 10 | RSRCH1 | Research 10 | active | 3 / 0 | 20/40/40 | — | Unsupported weight and subject | UNSUPPORTED_WEIGHT / UNSUPPORTED_SUBJECT |

The mapping layer requires an exact grade, subject code, and subject name. It maps only MATH7, SCI7, ENG7, ENG8, ENG9, MATH10, and SCI10 from the live catalog. No TLE, ICT, or Creative Technology mapping is inferred from names. The normal database currently has no exact ICT or Creative Technology subject code. Canonical labels in existing development fixtures remain usable for tests/demo, without altering the real catalog matrix.

## SHS Grades 11–12

The configured 2025–2026 Grade 11 pathway scope requires a pathway. Two enabled pathways exist: `medical-courses` (Medical Courses and Sciences Related) and `engineering-math` (Engineering and Mathematics Related). One active class exists in each pathway. Active offerings include Human Anatomy and Physiology and Health Science Fundamentals for medical courses, Introduction to Engineering for engineering/mathematics, and Statistics and Probability and Research 1 for both. Earlier General Biology 1, Pre-Calculus, General Mathematics, Earth and Life Science, and Computer-Aided Design Fundamentals have active catalog rows but only archived offerings or no active offerings. Thus **HISTORICAL_DATA_NOT_REPRESENTATIVE** for the current Grade 11 specialized pathways is a material risk.

Grade 12 has no current class, subject offering, active load, or required-pathway scope in this database. It has two active catalog rows, General Physics 1 and Work Immersion. Whether this corresponds to an older curriculum cannot be established from the configured records.

| Grade | Code | Live subject | Catalog | Active offering / load | Pathway for active offering | Resolved weight | V3 evidence |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 11 | HAP1 | Human Anatomy and Physiology | active | 1 / 1 | medical-courses | 20/50/30 | NOT_SUPPORTED; REQUIRES_NEW_MODEL / NEW_VALIDATION |
| 11 | HSF1 | Health Science Fundamentals | active | 1 / 1 | medical-courses | 20/50/30 | NOT_SUPPORTED; REQUIRES_NEW_MODEL / NEW_VALIDATION |
| 11 | INTROENG1 | Introduction to Engineering | active | 1 / 1 | engineering-math | 20/50/30 | NOT_SUPPORTED; REQUIRES_NEW_MODEL / NEW_VALIDATION |
| 11 | STATPROB | Statistics and Probability | active | 1 / 2 | both | 20/40/40 | NOT_SUPPORTED; SHS contract absent and weight unsupported |
| 11 | RESEARCH1 | Research 1 | active | 1 / 2 | both | 20/50/30 | NOT_SUPPORTED; REQUIRES_NEW_MODEL / NEW_VALIDATION |
| 11 | BIO1 | General Biology 1 | active | 0 / 0 | — | 20/50/30 | NOT_SUPPORTED; archived offering only |
| 11 | PRECAL11 | Pre-Calculus | active | 0 / 0 | — | 20/50/30 | NOT_SUPPORTED; archived offering only |
| 11 | CAD1 | Computer-Aided Design Fundamentals | active | 0 / 0 | — | 20/40/40 | NOT_SUPPORTED; archived offering only |
| 11 | GENMATH11 | General Mathematics | active | 0 / 0 | — | 20/50/30 | NOT_SUPPORTED; archived offering only |
| 11 | ELS11 | Earth and Life Science | active | 0 / 0 | — | 20/50/30 | NOT_SUPPORTED; archived offering only |
| 12 | PHYS1 | General Physics 1 | active | 0 / 0 | — | 20/50/30 | NOT_SUPPORTED; SHS ECR absent |
| 12 | WI12 | Work Immersion | active | 0 / 0 | — | 20/50/30 | NOT_SUPPORTED; SHS ECR absent |

All SHS rows are outside V3's grade guard, regardless of subject name or weight. This changes only development V3 prediction generation; normal classes, gradebook, attendance, assignments, and submissions remain available.

## Enforcement and remaining evidence

The server checks the actual class grade, student/class grade agreement, subject/class grade agreement, active subject, and exact subject map before scoring. Grades outside 7–10 return `UNSUPPORTED_GRADE_SCOPE`; mismatched IDs return `MISMATCHED_GRADE_SCOPE`. The persistence transaction rechecks scope and uses the same canonical subject before storing. Teacher/admin prediction UI shows a clear unavailable message for unsupported grades and does not fetch or generate V3 predictions for that selection.

The JHS runtime mapping gap is closed **for the seven exact catalog rows marked SUPPORTED**, not for enhanced Mathematics/Science, TLE/ICT, Creative Technology, or subjects outside V3. This does not establish model accuracy. Independent completed three-term records, especially natural low-grade cases, remain the blocker before production validation. The frozen artifact, 31-feature schema, supported model subject/weight lists, registry flags, and production guards are unchanged.

Client request: supply the official Grades 11–12 three-term ECRs and current subject list/codes for the two configured Grade 11 pathways and Grade 12; per-subject WW/PT/EX weights, examination subparts, term and annual final-grade formulas; and anonymized completed Term 1–3 records with school year, grade, pathway, subject, pseudonymous student key, activity score/HPS, applicable ST1/ST2/Term Exam score/HPS, and official term grade. Assessment dates are needed where available for true prediction cutoffs. Confirm whether Enhanced Mathematics/Science uses the core template and whether TLE's ICT component or combined TLE grade is the intended target. Do not send names, learner numbers, contact information, addresses, or identifying free text.

Next task: obtain these client contracts and independent completed records, then audit mapping/target equivalence and run frozen V3 validation only on supported JHS scopes. Any SHS model or production promotion requires separate authorization and evidence.

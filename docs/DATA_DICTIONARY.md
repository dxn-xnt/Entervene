# Entervene — Comprehensive Data Dictionary & Schema Specification

> **System**: Entervene — AI-Enhanced Learning Management System for Student Risk Management & Academic Success  
> **Generated Date**: 2026-09-06  
> **Database Dialect**: PostgreSQL 15+ (Production) | SQLite 3 (Development / Testing)  
> **Database Scope**: **58 Tables** across **12 Functional Domains** | **556 Documented Attributes**  
> **ORM**: SQLAlchemy 2.0 with Alembic Migrations  

---

## Table of Contents

- [**Authentication & Authorization**](#authentication--authorization) (5 tables)
  - [`role`](#table-role) — Defines access control roles within the system (e.g., ADMIN,...
  - [`user_account`](#table-user_account) — Core authentication table storing system credentials, accoun...
  - [`user_roles`](#table-user_roles) — Junction table mapping users to their assigned system roles ...
  - [`user_login_log`](#table-user_login_log) — Security and activity tracking table recording user authenti...
  - [`invitation_token`](#table-invitation_token) — Manages secure onboarding tokens for new staff and student r...
- [**People & User Profiles**](#people--user-profiles) (2 tables)
  - [`academic_staff`](#table-academic_staff) — Stores profile and institutional credentials for teachers, a...
  - [`student`](#table-student) — Stores learner master data including DepEd Learner Reference...
- [**Academic Structure & Curriculum Hierarchy**](#academic-structure--curriculum-hierarchy) (12 tables)
  - [`academic_year`](#table-academic_year) — Defines institutional school years (e.g., 2025-2026), markin...
  - [`academic_level`](#table-academic_level) — Represents grade/year levels (e.g., Grade 7 through Grade 12...
  - [`academic_period`](#table-academic_period) — Represents grading periods/quarters/semesters within an acad...
  - [`academic_pathway`](#table-academic_pathway) — Models Senior High School tracks and strands (e.g., STEM, AB...
  - [`deped_cluster`](#table-deped_cluster) — Groups academic disciplines into standard Department of Educ...
  - [`academic_level_pathway_scope`](#table-academic_level_pathway_scope) — Defines which academic pathways/strands are available at spe...
  - [`subject_groups`](#table-subject_groups) — Organizes academic subjects into functional learning departm...
  - [`subject`](#table-subject) — Curriculum master catalog of academic subjects/courses offer...
  - [`subject_offering`](#table-subject_offering) — Represents an offering of a subject for a specific grade lev...
  - [`subject_offering_pathway`](#table-subject_offering_pathway) — Junction table linking subject offerings to specific academi...
  - [`competency`](#table-competency) — Stores DepEd Most Essential Learning Competencies (MELCs) an...
  - [`class`](#table-class) — Represents academic class sections (e.g., Grade 10 - Rizal),...
- [**Scheduling & Faculty Workload**](#scheduling--faculty-workload) (3 tables)
  - [`period_template_slot`](#table-period_template_slot) — Individual time periods within a bell schedule template (sta...
  - [`subject_load`](#table-subject_load) — Faculty teaching loads and section schedules, supporting mul...
  - [`teacher_substitution`](#table-teacher_substitution) — Manages temporary teacher substitution assignments when a fa...
- [**Enrollment & Lesson Delivery**](#enrollment--lesson-delivery) (4 tables)
  - [`student_class`](#table-student_class) — Student section enrollment records, linking learners to clas...
  - [`lesson`](#table-lesson) — Instructional content, lecture modules, and learning package...
  - [`lesson_assignment`](#table-lesson_assignment) — Distributes lessons to specific classes with scheduled avail...
  - [`lesson_plan`](#table-lesson_plan) — AI-assisted lesson planning records supporting instructional...
- [**Classwork, Activities & Submissions**](#classwork-activities--submissions) (8 tables)
  - [`classwork`](#table-classwork) — Assessments, assignments, activities, and reading tasks assi...
  - [`classwork_assignment`](#table-classwork_assignment) — Publishes classwork to specific class sections with deadline...
  - [`classwork_attachment`](#table-classwork_attachment) — Reference documents, rubrics, and media attached to classwor...
  - [`classwork_lesson`](#table-classwork_lesson) — Junction table linking classwork tasks to relevant lesson mo...
  - [`student_submission`](#table-student_submission) — Student submissions for classwork, storing submission status...
  - [`submission_attachment`](#table-submission_attachment) — Files and digital artifacts submitted by students for an ass...
  - [`tos_exam`](#table-tos_exam) — Table of Specifications (TOS) exam matrix defining cognitive...
  - [`tos_question`](#table-tos_question) — Individual test items mapped to specific TOS competencies, c...
- [**Assessment, Quizzes & Examinations**](#assessment-quizzes--examinations) (6 tables)
  - [`question`](#table-question) — Question bank repository storing multiple-choice, essay, and...
  - [`question_option`](#table-question_option) — Answer choices and options for multiple-choice questions in ...
  - [`quiz`](#table-quiz) — Quiz configuration and metadata linked to classwork activiti...
  - [`quiz_question`](#table-quiz_question) — Junction table linking questions from the question bank to s...
  - [`quiz_answer`](#table-quiz_answer) — Student answer responses submitted during quiz attempts....
  - [`quiz_setting`](#table-quiz_setting) — Execution behavior rules for quizzes (timer, shuffle options...
- [**Grading System & DepEd Assessment**](#grading-system--deped-assessment) (6 tables)
  - [`grading_template`](#table-grading_template) — Defines DepEd grading percentage distributions (Written Work...
  - [`grading_template_component`](#table-grading_template_component) — Components of a grading template (e.g., Written Work: 40%, P...
  - [`assessment_item`](#table-assessment_item) — Grading sheet column entries representing individual graded ...
  - [`student_assessment_score`](#table-student_assessment_score) — Learner raw scores recorded for specific assessment items in...
  - [`student_period_grade`](#table-student_period_grade) — Computed quarterly/period grades for students per subject lo...
  - [`grade_submission_log`](#table-grade_submission_log) — Audit trail logging formal grade submissions, approvals, and...
- [**Attendance & Learner Welfare**](#attendance--learner-welfare) (2 tables)
  - [`attendance_record`](#table-attendance_record) — Daily/session attendance records tracking present, absent, l...
  - [`leave_request`](#table-leave_request) — Learner and faculty leave of absence requests, approvals, an...
- [**AI Early Warning System & Risk Management**](#ai-early-warning-system--risk-management) (6 tables)
  - [`ai_model_version`](#table-ai_model_version) — Registry of trained machine learning models (XGBoost, Random...
  - [`ai_prediction`](#table-ai_prediction) — Core Early Warning System predictions, classifying student a...
  - [`ai_prediction_feature`](#table-ai_prediction_feature) — Stores feature importances and SHAP values explaining why a ...
  - [`prediction_outcome`](#table-prediction_outcome) — Validates ML model predictions against actual final student ...
  - [`risk_threshold`](#table-risk_threshold) — Configurable risk score boundaries and alert sensitivity set...
  - [`teacher_risk_review`](#table-teacher_risk_review) — Records teacher reviews, notes, and qualitative observations...
- [**Targeted Interventions & Recommendations**](#targeted-interventions--recommendations) (2 tables)
  - [`student_suggestion`](#table-student_suggestion) — Personalized intervention recommendations generated for stud...
  - [`suggestion_classwork`](#table-suggestion_classwork) — Junction linking recommended remedial classwork activities t...
- [**System Administration & Communications**](#system-administration--communications) (2 tables)
  - [`notification`](#table-notification) — System notification queue delivering in-app alerts to studen...
  - [`setting`](#table-setting) — Global system configurations, institutional details, grading...
- [**Database Integrity & Schema Audit Log**](#database-integrity--schema-audit-log)

---

## Domain Overview & Entity Metrics

| Domain | Tables | Table Names | Primary Responsibility |
|---|:---:|---|---|
| **Authentication & Authorization** | 5 | `role`, `user_account`, `user_roles`, `user_login_log`, `invitation_token` | Defines access control roles within the system (e.g., ADMIN, TEACHER, STUDE... |
| **People & User Profiles** | 2 | `academic_staff`, `student` | Stores profile and institutional credentials for teachers, administrators, ... |
| **Academic Structure & Curriculum Hierarchy** | 12 | `academic_year`, `academic_level`, `academic_period`, `academic_pathway`, `deped_cluster`, `academic_level_pathway_scope`, `subject_groups`, `subject`, `subject_offering`, `subject_offering_pathway`, `competency`, `class` | Defines institutional school years (e.g., 2025-2026), marking whether a sch... |
| **Scheduling & Faculty Workload** | 3 | `period_template_slot`, `subject_load`, `teacher_substitution` | Individual time periods within a bell schedule template (start time, end ti... |
| **Enrollment & Lesson Delivery** | 4 | `student_class`, `lesson`, `lesson_assignment`, `lesson_plan` | Student section enrollment records, linking learners to classes for a speci... |
| **Classwork, Activities & Submissions** | 8 | `classwork`, `classwork_assignment`, `classwork_attachment`, `classwork_lesson`, `student_submission`, `submission_attachment`, `tos_exam`, `tos_question` | Assessments, assignments, activities, and reading tasks assigned to student... |
| **Assessment, Quizzes & Examinations** | 6 | `question`, `question_option`, `quiz`, `quiz_question`, `quiz_answer`, `quiz_setting` | Question bank repository storing multiple-choice, essay, and open-ended que... |
| **Grading System & DepEd Assessment** | 6 | `grading_template`, `grading_template_component`, `assessment_item`, `student_assessment_score`, `student_period_grade`, `grade_submission_log` | Defines DepEd grading percentage distributions (Written Work, Performance T... |
| **Attendance & Learner Welfare** | 2 | `attendance_record`, `leave_request` | Daily/session attendance records tracking present, absent, late, or excused... |
| **AI Early Warning System & Risk Management** | 6 | `ai_model_version`, `ai_prediction`, `ai_prediction_feature`, `prediction_outcome`, `risk_threshold`, `teacher_risk_review` | Registry of trained machine learning models (XGBoost, Random Forest) with p... |
| **Targeted Interventions & Recommendations** | 2 | `student_suggestion`, `suggestion_classwork` | Personalized intervention recommendations generated for students flagged at... |
| **System Administration & Communications** | 2 | `notification`, `setting` | System notification queue delivering in-app alerts to students, teachers, a... |

---

## Authentication & Authorization

### <a id="table-role"></a> Table: `role`

**Description**: Defines access control roles within the system (e.g., ADMIN, TEACHER, STUDENT). Controls permission scopes across the entire platform.

- **Primary Key**: `role_id`
- **Total Attributes**: 4
- **Foreign Keys**: None (Root / Independent Entity)
- **Unique Constraints**: `(role_name)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `role_id` | `SMALLINT` | No | **PK** | - | Primary key unique identifier for role. |
| `role_name` | `VARCHAR(50)` | No | - | - | Name or label for role. |
| `description` | `TEXT` | Yes | - | - | Descriptive text or explanation for this entity. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |

---

### <a id="table-user_account"></a> Table: `user_account`

**Description**: Core authentication table storing system credentials, account status, verification state, and audit timestamps.

- **Primary Key**: `user_id`
- **Total Attributes**: 8
- **Foreign Keys**: None (Root / Independent Entity)
- **Unique Constraints**: `(email)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `user_id` | `UUID` | No | **PK** | `<function uuid4 at 0x000001D4F4D16FB0>` | Foreign key referencing the associated user account. |
| `email` | `VARCHAR(255)` | No | UNIQUE | - | Stores email. |
| `password_hash` | `VARCHAR(255)` | Yes | - | - | Bcrypt/Argon2 password hash (nullable for invited users pending onboarding). |
| `account_status` | `VARCHAR(50)` | Yes | - | `active` | State of user account: 'active', 'inactive', 'suspended'. |
| `last_login` | `DATETIME` | Yes | - | - | Timestamp of most recent successful user authentication. |
| `email_verified_at` | `DATETIME` | Yes | - | - | Timestamp when user email was verified. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-user_roles"></a> Table: `user_roles`

**Description**: Junction table mapping users to their assigned system roles (Many-to-Many relationship between user_account and role).

- **Primary Key**: `user_id, role_id`
- **Total Attributes**: 3
- **Foreign Keys**: `user_id` → `user_account.user_id` ON DELETE CASCADE; `role_id` → `role.role_id` ON DELETE CASCADE

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `user_id` | `UUID` | No | **PK**, FK → `user_account.user_id` | - | Foreign key referencing the associated user account. |
| `role_id` | `SMALLINT` | No | **PK**, FK → `role.role_id` | - | Foreign key reference to role. |
| `assigned_at` | `DATETIME` | Yes | - | `now()` | Stores assigned at. |

---

### <a id="table-user_login_log"></a> Table: `user_login_log`

**Description**: Security and activity tracking table recording user authentication events, timestamps, and IP addresses.

- **Primary Key**: `login_id`
- **Total Attributes**: 4
- **Foreign Keys**: `user_id` → `user_account.user_id` ON DELETE CASCADE

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `login_id` | `INTEGER` | No | **PK** | - | Foreign key reference to login. |
| `user_id` | `UUID` | No | FK → `user_account.user_id` | - | Foreign key referencing the associated user account. |
| `login_at` | `DATETIME` | No | - | - | Stores login at. |
| `logout_at` | `DATETIME` | Yes | - | - | Stores logout at. |

---

### <a id="table-invitation_token"></a> Table: `invitation_token`

**Description**: Manages secure onboarding tokens for new staff and student registration, tracking expiration and activation status.

- **Primary Key**: `token_id`
- **Total Attributes**: 5
- **Foreign Keys**: `user_id` → `user_account.user_id` ON DELETE CASCADE
- **Unique Constraints**: `(token_hash)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `token_id` | `UUID` | No | **PK** | `<function uuid4 at 0x000001D4F4ED1F30>` | Foreign key reference to token. |
| `user_id` | `UUID` | No | FK → `user_account.user_id` | - | Foreign key referencing the associated user account. |
| `token_hash` | `VARCHAR(64)` | No | UNIQUE | - | Stores token hash. |
| `expires_at` | `DATETIME` | No | - | `<function _48h_from_now at 0x000001D4F4ED2090>` | Stores expires at. |
| `created_at` | `DATETIME` | Yes | - | `<function InvitationToken.<lambda> at 0x000001D4F4ED22A0>` | Timestamp when this record was originally created in the database. |

---

## People & User Profiles

### <a id="table-academic_staff"></a> Table: `academic_staff`

**Description**: Stores profile and institutional credentials for teachers, administrators, and academic personnel.

- **Primary Key**: `staff_id`
- **Total Attributes**: 13
- **Foreign Keys**: `user_id` → `user_account.user_id` ON DELETE SET NULL
- **Unique Constraints**: `(user_id)`, `(email)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `staff_id` | `VARCHAR(20)` | No | **PK** | - | Foreign key referencing the academic staff record. |
| `first_name` | `VARCHAR(100)` | No | - | - | Name or label for academic staff. |
| `middle_name` | `VARCHAR(100)` | Yes | - | - | Name or label for academic staff. |
| `last_name` | `VARCHAR(100)` | No | - | - | Name or label for academic staff. |
| `dob` | `DATE` | Yes | - | - | Stores dob. |
| `suffix` | `VARCHAR(10)` | Yes | - | - | Stores suffix. |
| `gender` | `VARCHAR(20)` | Yes | - | - | Stores gender. |
| `contact_number` | `VARCHAR(20)` | Yes | - | - | Stores contact number. |
| `email` | `VARCHAR(255)` | Yes | UNIQUE | - | Stores email. |
| `address` | `TEXT` | Yes | - | - | Stores address. |
| `hired_date` | `DATE` | Yes | - | - | Calendar date for hired date. |
| `employment_status` | `VARCHAR(50)` | Yes | - | - | Stores employment status. |
| `user_id` | `UUID` | Yes | FK → `user_account.user_id`, UNIQUE | - | Foreign key referencing the associated user account. |

---

### <a id="table-student"></a> Table: `student`

**Description**: Stores learner master data including DepEd Learner Reference Number (LRN), personal demographic data, and baseline academic metrics (prior GWA).

- **Primary Key**: `student_id`
- **Total Attributes**: 14
- **Foreign Keys**: `academic_level_id` → `academic_level.academic_level_id` ON DELETE RESTRICT; `user_id` → `user_account.user_id` ON DELETE SET NULL
- **Unique Constraints**: `(student_lrn)`, `(email)`, `(user_id)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `student_id` | `UUID` | No | **PK** | - | Foreign key referencing the learner record. |
| `student_lrn` | `VARCHAR(12)` | No | UNIQUE | - | 12-digit DepEd Learner Reference Number (LRN), unique institutional student ID. |
| `first_name` | `VARCHAR(100)` | No | - | - | Name or label for student. |
| `middle_name` | `VARCHAR(100)` | Yes | - | - | Name or label for student. |
| `last_name` | `VARCHAR(100)` | No | - | - | Name or label for student. |
| `dob` | `DATE` | Yes | - | - | Student date of birth used for demographic analytics and age-grade cohort analysis. |
| `suffix` | `VARCHAR(10)` | Yes | - | - | Stores suffix. |
| `gender` | `VARCHAR(20)` | Yes | - | - | Learner gender identity ('Male', 'Female', etc.). |
| `contact_number` | `VARCHAR(20)` | Yes | - | - | Stores contact number. |
| `email` | `VARCHAR(255)` | Yes | UNIQUE | - | Stores email. |
| `address` | `TEXT` | Yes | - | - | Stores address. |
| `academic_level_id` | `INTEGER` | Yes | FK → `academic_level.academic_level_id` | - | Foreign key referencing the academic grade level. |
| `prior_gwa` | `NUMERIC(5, 2)` | Yes | - | - | Prior General Weighted Average (GWA), key baseline feature for AI risk prediction. |
| `user_id` | `UUID` | Yes | FK → `user_account.user_id`, UNIQUE | - | Foreign key referencing the associated user account. |

---

## Academic Structure & Curriculum Hierarchy

### <a id="table-academic_year"></a> Table: `academic_year`

**Description**: Defines institutional school years (e.g., 2025-2026), marking whether a school year is currently active.

- **Primary Key**: `academic_year_id`
- **Total Attributes**: 6
- **Foreign Keys**: None (Root / Independent Entity)

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `academic_year_id` | `INTEGER` | No | **PK** | - | Foreign key referencing the academic school year. |
| `year_label` | `VARCHAR(20)` | No | - | - | Stores year label. |
| `start_date` | `DATE` | No | - | - | Calendar date for start date. |
| `end_date` | `DATE` | No | - | - | Calendar date for end date. |
| `is_active` | `BOOLEAN` | No | - | `False` | Flag indicating whether this record is currently active in the system. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |

---

### <a id="table-academic_level"></a> Table: `academic_level`

**Description**: Represents grade/year levels (e.g., Grade 7 through Grade 12), categorized under Junior High School or Senior High School.

- **Primary Key**: `academic_level_id`
- **Total Attributes**: 5
- **Foreign Keys**: None (Root / Independent Entity)

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `academic_level_id` | `INTEGER` | No | **PK** | - | Foreign key referencing the academic grade level. |
| `level_name` | `VARCHAR(100)` | No | - | - | Name or label for academic level. |
| `grade_level` | `INTEGER` | No | - | - | Stores grade level. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-academic_period"></a> Table: `academic_period`

**Description**: Represents grading periods/quarters/semesters within an academic year, tracking progress ratios and active state.

- **Primary Key**: `academic_period_id`
- **Total Attributes**: 12
- **Foreign Keys**: `academic_year_id` → `academic_year.academic_year_id` ON DELETE CASCADE
- **Unique Constraints**: `(academic_year_id, period_type, period_sequence)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `academic_period_id` | `INTEGER` | No | **PK** | - | Foreign key referencing the grading period/quarter. |
| `period_name` | `VARCHAR(100)` | No | - | - | Name or label for academic period. |
| `period_type` | `VARCHAR(20)` | No | - | `TERM` | Stores period type. |
| `period_sequence` | `INTEGER` | No | - | `1` | Stores period sequence. |
| `total_periods_in_year` | `INTEGER` | No | - | `3` | Stores total periods in year. |
| `period_progress_ratio` | `NUMERIC(6, 4)` | No | - | `0.3333` | Stores period progress ratio. |
| `start_date` | `DATE` | No | - | - | Calendar date for start date. |
| `end_date` | `DATE` | No | - | - | Calendar date for end date. |
| `is_active` | `BOOLEAN` | No | - | `False` | Flag indicating whether this record is currently active in the system. |
| `academic_year_id` | `INTEGER` | No | FK → `academic_year.academic_year_id` | - | Foreign key referencing the academic school year. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | No | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-academic_pathway"></a> Table: `academic_pathway`

**Description**: Models Senior High School tracks and strands (e.g., STEM, ABM, HUMSS, TVL) aligned with DepEd K-12 standards.

- **Primary Key**: `id`
- **Total Attributes**: 8
- **Foreign Keys**: `deped_cluster_id` → `deped_cluster.id` ON DELETE SET NULL
- **Unique Constraints**: `(code)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `id` | `INTEGER` | No | **PK** | - | Stores id. |
| `code` | `VARCHAR(50)` | No | UNIQUE | - | Stores code. |
| `name` | `VARCHAR(150)` | No | - | - | Name or label for academic pathway. |
| `is_enabled` | `BOOLEAN` | No | - | `True` | Boolean flag indicating whether enabled. |
| `sort_order` | `INTEGER` | No | - | `0` | Stores sort order. |
| `deped_cluster_id` | `INTEGER` | Yes | FK → `deped_cluster.id` | - | Foreign key reference to deped_cluster. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-deped_cluster"></a> Table: `deped_cluster`

**Description**: Groups academic disciplines into standard Department of Education curriculum clusters (e.g., Core, Applied, Specialized).

- **Primary Key**: `id`
- **Total Attributes**: 7
- **Foreign Keys**: None (Root / Independent Entity)
- **Unique Constraints**: `(code)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `id` | `INTEGER` | No | **PK** | - | Stores id. |
| `code` | `VARCHAR(50)` | No | UNIQUE | - | Stores code. |
| `name` | `VARCHAR(150)` | No | - | - | Name or label for deped cluster. |
| `category` | `VARCHAR(20)` | No | - | `ACADEMIC` | Stores category. |
| `sort_order` | `INTEGER` | No | - | `0` | Stores sort order. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-academic_level_pathway_scope"></a> Table: `academic_level_pathway_scope`

**Description**: Defines which academic pathways/strands are available at specific academic year levels.

- **Primary Key**: `id`
- **Total Attributes**: 6
- **Foreign Keys**: `academic_year_id` → `academic_year.academic_year_id` ON DELETE CASCADE; `academic_level_id` → `academic_level.academic_level_id` ON DELETE CASCADE
- **Unique Constraints**: `(academic_year_id, academic_level_id)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `id` | `INTEGER` | No | **PK** | - | Stores id. |
| `academic_year_id` | `INTEGER` | No | FK → `academic_year.academic_year_id` | - | Foreign key referencing the academic school year. |
| `academic_level_id` | `INTEGER` | No | FK → `academic_level.academic_level_id` | - | Foreign key referencing the academic grade level. |
| `requires_pathway` | `BOOLEAN` | No | - | `False` | Stores requires pathway. |
| `created_at` | `DATETIME` | No | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | No | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-subject_groups"></a> Table: `subject_groups`

**Description**: Organizes academic subjects into functional learning departments or curriculum categories.

- **Primary Key**: `subject_group_id`
- **Total Attributes**: 7
- **Foreign Keys**: None (Root / Independent Entity)
- **Unique Constraints**: `(name)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `subject_group_id` | `INTEGER` | No | **PK** | - | Foreign key reference to subject_group. |
| `name` | `VARCHAR(100)` | No | - | - | Name or label for subject groups. |
| `passing_threshold` | `NUMERIC(5, 2)` | No | - | `83` | Stores passing threshold. |
| `is_active` | `BOOLEAN` | No | - | `True` | Flag indicating whether this record is currently active in the system. |
| `display_order` | `INTEGER` | No | - | `0` | Stores display order. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-subject"></a> Table: `subject`

**Description**: Curriculum master catalog of academic subjects/courses offered by the institution.

- **Primary Key**: `subject_id`
- **Total Attributes**: 13
- **Foreign Keys**: `academic_level_id` → `academic_level.academic_level_id`; `subject_group_id` → `subject_groups.subject_group_id` ON DELETE RESTRICT

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `subject_id` | `INTEGER` | No | **PK** | - | Foreign key referencing the associated subject. |
| `academic_level_id` | `INTEGER` | Yes | FK → `academic_level.academic_level_id` | - | Foreign key referencing the academic grade level. |
| `subject_name` | `VARCHAR(150)` | No | - | - | Name or label for subject. |
| `subject_codename` | `VARCHAR(50)` | Yes | - | - | Name or label for subject. |
| `subject_group` | `VARCHAR(50)` | Yes | - | - | Stores subject group. |
| `subject_group_id` | `INTEGER` | Yes | FK → `subject_groups.subject_group_id` | - | Foreign key reference to subject_group. |
| `is_math_or_science` | `BOOLEAN` | Yes | - | `False` | Boolean flag indicating whether math or science. |
| `is_core` | `BOOLEAN` | No | - | `False` | Boolean flag indicating whether core. |
| `status` | `VARCHAR(20)` | Yes | - | `active` | Current operational status of this record. |
| `default_grading_template` | `VARCHAR(100)` | Yes | - | - | Stores default grading template. |
| `description` | `TEXT` | Yes | - | - | Descriptive text or explanation for this entity. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-subject_offering"></a> Table: `subject_offering`

**Description**: Represents an offering of a subject for a specific grade level and academic period.

- **Primary Key**: `subject_offering_id`
- **Total Attributes**: 9
- **Foreign Keys**: `subject_id` → `subject.subject_id` ON DELETE CASCADE; `academic_year_id` → `academic_year.academic_year_id` ON DELETE CASCADE; `academic_level_id` → `academic_level.academic_level_id`; `academic_period_id` → `academic_period.academic_period_id` ON DELETE CASCADE

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `subject_offering_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for subject_offering. |
| `subject_id` | `INTEGER` | No | FK → `subject.subject_id` | - | Foreign key referencing the associated subject. |
| `academic_year_id` | `INTEGER` | No | FK → `academic_year.academic_year_id` | - | Foreign key referencing the academic school year. |
| `academic_level_id` | `INTEGER` | No | FK → `academic_level.academic_level_id` | - | Foreign key referencing the academic grade level. |
| `academic_period_id` | `INTEGER` | No | FK → `academic_period.academic_period_id` | - | Foreign key referencing the grading period/quarter. |
| `minutes` | `INTEGER` | Yes | - | - | Stores minutes. |
| `status` | `VARCHAR(20)` | No | - | `active` | Current operational status of this record. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-subject_offering_pathway"></a> Table: `subject_offering_pathway`

**Description**: Junction table linking subject offerings to specific academic pathways (strands).

- **Primary Key**: `subject_offering_id, pathway_id`
- **Total Attributes**: 2
- **Foreign Keys**: `subject_offering_id` → `subject_offering.subject_offering_id` ON DELETE CASCADE; `pathway_id` → `academic_pathway.id` ON DELETE CASCADE

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `subject_offering_id` | `INTEGER` | No | **PK**, FK → `subject_offering.subject_offering_id` | - | Foreign key reference to subject_offering. |
| `pathway_id` | `INTEGER` | No | **PK**, FK → `academic_pathway.id` | - | Foreign key reference to pathway. |

---

### <a id="table-competency"></a> Table: `competency`

**Description**: Stores DepEd Most Essential Learning Competencies (MELCs) and curriculum objectives linked to subjects.

- **Primary Key**: `competency_id`
- **Total Attributes**: 12
- **Foreign Keys**: `subject_id` → `subject.subject_id` ON DELETE CASCADE; `academic_period_id` → `academic_period.academic_period_id` ON DELETE SET NULL; `created_by_staff_id` → `academic_staff.staff_id` ON DELETE SET NULL

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `competency_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for competency. |
| `competency_code` | `VARCHAR(100)` | Yes | - | - | Stores competency code. |
| `statement` | `TEXT` | No | - | - | Stores statement. |
| `description` | `TEXT` | Yes | - | - | Descriptive text or explanation for this entity. |
| `order_index` | `INTEGER` | No | - | `1` | Stores order index. |
| `target_hours` | `INTEGER` | Yes | - | `0` | Stores target hours. |
| `is_archived` | `BOOLEAN` | No | - | `False` | Boolean flag indicating whether archived. |
| `subject_id` | `INTEGER` | No | FK → `subject.subject_id` | - | Foreign key referencing the associated subject. |
| `academic_period_id` | `INTEGER` | Yes | FK → `academic_period.academic_period_id` | - | Foreign key referencing the grading period/quarter. |
| `created_by_staff_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key reference to created_by_staff. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-class"></a> Table: `class`

**Description**: Represents academic class sections (e.g., Grade 10 - Rizal), assigned to an adviser, grade level, and academic year.

- **Primary Key**: `class_id`
- **Total Attributes**: 12
- **Foreign Keys**: `adviser_staff_id` → `academic_staff.staff_id` ON DELETE SET NULL; `academic_year_id` → `academic_year.academic_year_id`; `academic_level_id` → `academic_level.academic_level_id`; `academic_period_id` → `academic_period.academic_period_id`; `pathway_id` → `academic_pathway.id` ON DELETE SET NULL; `paired_class_id` → `class.class_id` ON DELETE SET NULL
- **Unique Constraints**: `(adviser_staff_id, academic_year_id)`, `(class_id, academic_year_id)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `class_id` | `INTEGER` | No | **PK** | - | Foreign key referencing the associated class section. |
| `section_name` | `VARCHAR(100)` | No | - | - | Name or label for class. |
| `class_status` | `VARCHAR(20)` | No | - | `active` | Stores class status. |
| `adviser_staff_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key reference to adviser_staff. |
| `academic_year_id` | `INTEGER` | No | FK → `academic_year.academic_year_id` | - | Foreign key referencing the academic school year. |
| `academic_level_id` | `INTEGER` | No | FK → `academic_level.academic_level_id` | - | Foreign key referencing the academic grade level. |
| `academic_period_id` | `INTEGER` | Yes | FK → `academic_period.academic_period_id` | - | Foreign key referencing the grading period/quarter. |
| `pathway_id` | `INTEGER` | Yes | FK → `academic_pathway.id` | - | Foreign key reference to pathway. |
| `paired_class_id` | `INTEGER` | Yes | FK → `class.class_id` | - | Foreign key reference to paired_class. |
| `period_template_group` | `VARCHAR(50)` | No | - | `JHS_45MIN` | Stores period template group. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

## Scheduling & Faculty Workload

### <a id="table-period_template_slot"></a> Table: `period_template_slot`

**Description**: Individual time periods within a bell schedule template (start time, end time, period order).

- **Primary Key**: `slot_id`
- **Total Attributes**: 10
- **Foreign Keys**: None (Root / Independent Entity)

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `slot_id` | `INTEGER` | No | **PK** | - | Foreign key reference to slot. |
| `template_group` | `VARCHAR(50)` | No | - | - | Stores template group. |
| `slot_name` | `VARCHAR(100)` | No | - | - | Name or label for period template slot. |
| `slot_type` | `VARCHAR(20)` | No | - | `CLASS` | Stores slot type. |
| `start_time` | `VARCHAR(10)` | No | - | - | Time specification for start time. |
| `end_time` | `VARCHAR(10)` | No | - | - | Time specification for end time. |
| `is_locked_break` | `BOOLEAN` | No | - | `False` | Boolean flag indicating whether locked break. |
| `display_order` | `INTEGER` | No | - | `0` | Stores display order. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-subject_load"></a> Table: `subject_load`

**Description**: Faculty teaching loads and section schedules, supporting multi-version draft and publish workflows for Subject Load Studio.

- **Primary Key**: `subject_load_id`
- **Total Attributes**: 21
- **Foreign Keys**: `staff_id` → `academic_staff.staff_id`; `subject_id` → `subject.subject_id`; `class_id` → `class.class_id`; `academic_period_id` → `academic_period.academic_period_id`; `slot_id` → `period_template_slot.slot_id`; `continued_from_load_id` → `subject_load.subject_load_id`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `subject_load_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for subject_load. |
| `staff_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key referencing the academic staff record. |
| `subject_id` | `INTEGER` | No | FK → `subject.subject_id` | - | Foreign key referencing the associated subject. |
| `class_id` | `INTEGER` | No | FK → `class.class_id` | - | Foreign key referencing the associated class section. |
| `academic_period_id` | `INTEGER` | No | FK → `academic_period.academic_period_id` | - | Foreign key referencing the grading period/quarter. |
| `slot_id` | `INTEGER` | Yes | FK → `period_template_slot.slot_id` | - | Foreign key referencing period_template_slot for scheduled timetable slot. |
| `start_time` | `VARCHAR(10)` | Yes | - | - | Daily class meeting start time (e.g., '08:00'). |
| `end_time` | `VARCHAR(10)` | Yes | - | - | Daily class meeting end time (e.g., '09:00'). |
| `days_of_week` | `JSON` | Yes | - | - | JSON array of meeting days (e.g., ['MON', 'WED', 'FRI']). |
| `status` | `VARCHAR(20)` | Yes | - | `draft` | Current operational status of this record. |
| `version` | `INTEGER` | No | - | `1` | Schedule version number supporting iterative timetable drafting. |
| `is_active_version` | `BOOLEAN` | No | - | `True` | Flag indicating if this version is the published/active class schedule. |
| `is_locked` | `BOOLEAN` | Yes | - | `False` | Boolean flag indicating whether locked. |
| `locked_at` | `DATETIME` | Yes | - | - | Stores locked at. |
| `published_at` | `DATETIME` | Yes | - | - | Timestamp when the subject load schedule was officially published. |
| `published_by` | `VARCHAR(50)` | Yes | - | - | User ID or username of the administrator who published the schedule. |
| `last_modified_by` | `VARCHAR(50)` | Yes | - | - | User ID or username of the last user who edited the load. |
| `draft_notes` | `VARCHAR(255)` | Yes | - | - | Faculty loading notes and planner commentary. |
| `continued_from_load_id` | `INTEGER` | Yes | FK → `subject_load.subject_load_id` | - | Foreign key reference to continued_from_load. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-teacher_substitution"></a> Table: `teacher_substitution`

**Description**: Manages temporary teacher substitution assignments when a faculty member is on leave or unavailable.

- **Primary Key**: `substitution_id`
- **Total Attributes**: 14
- **Foreign Keys**: `subject_load_id` → `subject_load.subject_load_id` ON DELETE RESTRICT; `original_staff_id` → `academic_staff.staff_id` ON DELETE RESTRICT; `substitute_staff_id` → `academic_staff.staff_id` ON DELETE RESTRICT; `created_by_admin_id` → `academic_staff.staff_id` ON DELETE SET NULL; `ended_by_admin_id` → `academic_staff.staff_id` ON DELETE SET NULL

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `substitution_id` | `INTEGER` | No | **PK** | - | Foreign key reference to substitution. |
| `batch_id` | `UUID` | Yes | - | - | Foreign key reference to batch. |
| `subject_load_id` | `INTEGER` | No | FK → `subject_load.subject_load_id` | - | Foreign key reference to subject_load. |
| `original_staff_id` | `VARCHAR(20)` | No | FK → `academic_staff.staff_id` | - | Foreign key reference to original_staff. |
| `substitute_staff_id` | `VARCHAR(20)` | No | FK → `academic_staff.staff_id` | - | Foreign key reference to substitute_staff. |
| `start_date` | `DATE` | No | - | - | Calendar date for start date. |
| `end_date` | `DATE` | Yes | - | - | Calendar date for end date. |
| `status` | `VARCHAR(20)` | No | - | `active` | Current operational status of this record. |
| `reason` | `TEXT` | Yes | - | - | Stores reason. |
| `created_by_admin_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key reference to created_by_admin. |
| `ended_by_admin_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key reference to ended_by_admin. |
| `ended_at` | `DATETIME` | Yes | - | - | Stores ended at. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

## Enrollment & Lesson Delivery

### <a id="table-student_class"></a> Table: `student_class`

**Description**: Student section enrollment records, linking learners to classes for a specific academic year.

- **Primary Key**: `student_class_id`
- **Total Attributes**: 6
- **Foreign Keys**: `student_id` → `student.student_id`; `class_id` → `class.class_id` ON DELETE CASCADE; `academic_year_id` → `class.academic_year_id` ON DELETE CASCADE
- **Unique Constraints**: `(student_id, class_id)`, `(student_id, academic_year_id)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `student_class_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for student_class. |
| `student_id` | `UUID` | No | FK → `student.student_id` | - | Foreign key referencing the learner record. |
| `class_id` | `INTEGER` | No | FK → `class.class_id` | - | Foreign key referencing the associated class section. |
| `academic_year_id` | `INTEGER` | No | FK → `class.academic_year_id` | - | Foreign key referencing the academic school year. |
| `enrollment_status` | `VARCHAR(20)` | Yes | - | `enrolled` | Stores enrollment status. |
| `enrolled_at` | `DATETIME` | Yes | - | `now()` | Stores enrolled at. |

---

### <a id="table-lesson"></a> Table: `lesson`

**Description**: Instructional content, lecture modules, and learning packages authored by teachers, linked to curriculum competencies.

- **Primary Key**: `lesson_id`
- **Total Attributes**: 14
- **Foreign Keys**: `created_by_staff_id` → `academic_staff.staff_id` ON DELETE SET NULL; `subject_id` → `subject.subject_id` ON DELETE CASCADE; `competency_id` → `competency.competency_id` ON DELETE SET NULL

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `lesson_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for lesson. |
| `title` | `VARCHAR(255)` | No | - | - | Stores title. |
| `description` | `TEXT` | Yes | - | - | Descriptive text or explanation for this entity. |
| `content` | `TEXT` | Yes | - | - | Stores content. |
| `order_index` | `INTEGER` | No | - | `1` | Stores order index. |
| `is_published` | `BOOLEAN` | No | - | `False` | Boolean flag indicating whether published. |
| `is_draft` | `BOOLEAN` | No | - | `True` | Boolean flag indicating whether draft. |
| `is_locked` | `BOOLEAN` | No | - | `False` | Boolean flag indicating whether locked. |
| `is_archived` | `BOOLEAN` | No | - | `False` | Boolean flag indicating whether archived. |
| `created_by_staff_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key reference to created_by_staff. |
| `subject_id` | `INTEGER` | No | FK → `subject.subject_id` | - | Foreign key referencing the associated subject. |
| `competency_id` | `INTEGER` | Yes | FK → `competency.competency_id` | - | Foreign key reference to competency. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-lesson_assignment"></a> Table: `lesson_assignment`

**Description**: Distributes lessons to specific classes with scheduled availability dates.

- **Primary Key**: `lesson_assignment_id`
- **Total Attributes**: 7
- **Foreign Keys**: `lesson_id` → `lesson.lesson_id` ON DELETE CASCADE; `class_id` → `class.class_id` ON DELETE CASCADE; `assigned_by_staff_id` → `academic_staff.staff_id` ON DELETE SET NULL
- **Unique Constraints**: `(lesson_id, class_id)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `lesson_assignment_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for lesson_assignment. |
| `lesson_id` | `INTEGER` | No | FK → `lesson.lesson_id` | - | Foreign key reference to lesson. |
| `class_id` | `INTEGER` | No | FK → `class.class_id` | - | Foreign key referencing the associated class section. |
| `assigned_by_staff_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key reference to assigned_by_staff. |
| `publish_date` | `DATETIME` | Yes | - | - | Calendar date for publish date. |
| `is_published` | `BOOLEAN` | Yes | - | `False` | Boolean flag indicating whether published. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |

---

### <a id="table-lesson_plan"></a> Table: `lesson_plan`

**Description**: AI-assisted lesson planning records supporting instructional objectives, DepEd 4As framework, and teaching notes.

- **Primary Key**: `plan_id`
- **Total Attributes**: 16
- **Foreign Keys**: `teacher_id` → `academic_staff.staff_id` ON DELETE CASCADE

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `plan_id` | `INTEGER` | No | **PK** | - | Foreign key reference to plan. |
| `status` | `VARCHAR(20)` | No | - | `DRAFT` | Current operational status of this record. |
| `title` | `VARCHAR(255)` | No | - | - | Stores title. |
| `learning_area` | `VARCHAR(255)` | Yes | - | - | Stores learning area. |
| `grade_section` | `VARCHAR(255)` | Yes | - | - | Stores grade section. |
| `date` | `VARCHAR(255)` | Yes | - | - | Calendar date for date. |
| `sessions` | `VARCHAR(255)` | Yes | - | - | Stores sessions. |
| `references` | `VARCHAR(1000)` | Yes | - | - | Stores references. |
| `ai_declaration` | `VARCHAR(1000)` | Yes | - | - | Stores ai declaration. |
| `intentions` | `JSON` | Yes | - | - | Stores intentions. |
| `learning_experience` | `JSON` | Yes | - | - | Stores learning experience. |
| `assessment` | `JSON` | Yes | - | - | Stores assessment. |
| `ways_forward` | `JSON` | Yes | - | - | Stores ways forward. |
| `teacher_id` | `VARCHAR(20)` | No | FK → `academic_staff.staff_id` | - | Foreign key reference to teacher. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

## Classwork, Activities & Submissions

### <a id="table-classwork"></a> Table: `classwork`

**Description**: Assessments, assignments, activities, and reading tasks assigned to students.

- **Primary Key**: `classwork_id`
- **Total Attributes**: 18
- **Foreign Keys**: `subject_id` → `subject.subject_id`; `created_by_staff_id` → `academic_staff.staff_id`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `classwork_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for classwork. |
| `title` | `VARCHAR(255)` | No | - | - | Stores title. |
| `description` | `TEXT` | Yes | - | - | Descriptive text or explanation for this entity. |
| `instructions` | `TEXT` | Yes | - | - | Stores instructions. |
| `classwork_type` | `VARCHAR(50)` | No | - | - | Classification: 'ASSIGNMENT', 'QUIZ', 'ACTIVITY', or 'READING'. |
| `classwork_category` | `VARCHAR(50)` | Yes | - | - | Stores classwork category. |
| `exam_subtype` | `VARCHAR(50)` | Yes | - | - | Stores exam subtype. |
| `activity_mode` | `VARCHAR(20)` | No | - | `ONLINE` | Execution mode: 'ONLINE' (digital submission) or 'MANUAL' (physical/in-class). |
| `is_graded` | `BOOLEAN` | No | - | `true` | Boolean flag indicating whether graded. |
| `total_points` | `NUMERIC(8, 2)` | Yes | - | `100` | Maximum attainable raw score for this classwork activity. |
| `is_locked` | `BOOLEAN` | No | - | `False` | Boolean flag indicating whether locked. |
| `is_published` | `BOOLEAN` | No | - | `False` | Boolean flag indicating whether published. |
| `show_scores` | `BOOLEAN` | No | - | `true` | Controls whether student scores are immediately visible or withheld until released. |
| `is_archived` | `BOOLEAN` | No | - | `False` | Soft-delete flag archiving old or deprecated classwork. |
| `subject_id` | `INTEGER` | No | FK → `subject.subject_id` | - | Foreign key referencing the associated subject. |
| `created_by_staff_id` | `VARCHAR(20)` | No | FK → `academic_staff.staff_id` | - | Foreign key reference to created_by_staff. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-classwork_assignment"></a> Table: `classwork_assignment`

**Description**: Publishes classwork to specific class sections with deadlines and submission rules.

- **Primary Key**: `classwork_assignment_id`
- **Total Attributes**: 14
- **Foreign Keys**: `classwork_id` → `classwork.classwork_id` ON DELETE CASCADE; `class_id` → `class.class_id` ON DELETE CASCADE; `assigned_by_staff_id` → `academic_staff.staff_id`
- **Unique Constraints**: `(classwork_id, class_id)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `classwork_assignment_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for classwork_assignment. |
| `classwork_id` | `INTEGER` | No | FK → `classwork.classwork_id` | - | Foreign key reference to classwork. |
| `class_id` | `INTEGER` | No | FK → `class.class_id` | - | Foreign key referencing the associated class section. |
| `assigned_by_staff_id` | `VARCHAR(20)` | No | FK → `academic_staff.staff_id` | - | Foreign key reference to assigned_by_staff. |
| `publish_date` | `DATETIME` | Yes | - | - | Calendar date for publish date. |
| `due_date` | `DATETIME` | Yes | - | - | Calendar date for due date. |
| `lock_date` | `DATETIME` | Yes | - | - | Calendar date for lock date. |
| `is_published` | `BOOLEAN` | Yes | - | `False` | Boolean flag indicating whether published. |
| `is_locked` | `BOOLEAN` | Yes | - | `False` | Boolean flag indicating whether locked. |
| `allow_late_submissions` | `BOOLEAN` | No | - | `False` | Stores allow late submissions. |
| `max_attempts` | `INTEGER` | Yes | - | `1` | Stores max attempts. |
| `assigned_at` | `DATETIME` | Yes | - | `now()` | Stores assigned at. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-classwork_attachment"></a> Table: `classwork_attachment`

**Description**: Reference documents, rubrics, and media attached to classwork items.

- **Primary Key**: `classwork_attachment_id`
- **Total Attributes**: 7
- **Foreign Keys**: `classwork_id` → `classwork.classwork_id` ON DELETE CASCADE

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `classwork_attachment_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for classwork_attachment. |
| `classwork_id` | `INTEGER` | No | FK → `classwork.classwork_id` | - | Foreign key reference to classwork. |
| `file_name` | `VARCHAR(255)` | No | - | - | Name or label for classwork attachment. |
| `file_path` | `TEXT` | No | - | - | Stores file path. |
| `file_type` | `VARCHAR(100)` | Yes | - | - | Stores file type. |
| `file_size` | `BIGINT` | No | - | - | Stores file size. |
| `uploaded_at` | `DATETIME` | Yes | - | `now()` | Stores uploaded at. |

---

### <a id="table-classwork_lesson"></a> Table: `classwork_lesson`

**Description**: Junction table linking classwork tasks to relevant lesson modules.

- **Primary Key**: `classwork_id, lesson_id`
- **Total Attributes**: 2
- **Foreign Keys**: `classwork_id` → `classwork.classwork_id` ON DELETE CASCADE; `lesson_id` → `lesson.lesson_id` ON DELETE CASCADE

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `classwork_id` | `INTEGER` | No | **PK**, FK → `classwork.classwork_id` | - | Foreign key reference to classwork. |
| `lesson_id` | `INTEGER` | No | **PK**, FK → `lesson.lesson_id` | - | Foreign key reference to lesson. |

---

### <a id="table-student_submission"></a> Table: `student_submission`

**Description**: Student submissions for classwork, storing submission status, grades, reading duration, and teacher feedback.

- **Primary Key**: `submission_id`
- **Total Attributes**: 12
- **Foreign Keys**: `student_id` → `student.student_id` ON DELETE CASCADE; `classwork_assignment_id` → `classwork_assignment.classwork_assignment_id` ON DELETE CASCADE; `graded_by_staff_id` → `academic_staff.staff_id`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `submission_id` | `INTEGER` | No | **PK** | - | Foreign key reference to submission. |
| `student_id` | `UUID` | No | FK → `student.student_id` | - | Foreign key referencing the learner record. |
| `classwork_assignment_id` | `INTEGER` | No | FK → `classwork_assignment.classwork_assignment_id` | - | Foreign key reference to classwork_assignment. |
| `submitted_at` | `DATETIME` | Yes | - | - | Stores submitted at. |
| `status` | `VARCHAR(30)` | No | - | `pending` | Current operational status of this record. |
| `grade` | `NUMERIC(8, 2)` | Yes | - | - | Stores grade. |
| `feedback` | `TEXT` | Yes | - | - | Stores feedback. |
| `attempt_count` | `INTEGER` | No | - | `0` | Stores attempt count. |
| `graded_at` | `DATETIME` | Yes | - | - | Stores graded at. |
| `graded_by_staff_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key reference to graded_by_staff. |
| `reading_focused_seconds` | `INTEGER` | Yes | - | - | Tracks total active reading viewport time (seconds) for reading assignments. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |

---

### <a id="table-submission_attachment"></a> Table: `submission_attachment`

**Description**: Files and digital artifacts submitted by students for an assignment.

- **Primary Key**: `submission_attachment_id`
- **Total Attributes**: 7
- **Foreign Keys**: `submission_id` → `student_submission.submission_id` ON DELETE CASCADE

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `submission_attachment_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for submission_attachment. |
| `submission_id` | `INTEGER` | No | FK → `student_submission.submission_id` | - | Foreign key reference to submission. |
| `file_name` | `VARCHAR(255)` | No | - | - | Name or label for submission attachment. |
| `file_path` | `TEXT` | No | - | - | Stores file path. |
| `file_type` | `VARCHAR(100)` | Yes | - | - | Stores file type. |
| `file_size` | `BIGINT` | No | - | - | Stores file size. |
| `uploaded_at` | `DATETIME` | Yes | - | `now()` | Stores uploaded at. |

---

### <a id="table-tos_exam"></a> Table: `tos_exam`

**Description**: Table of Specifications (TOS) exam matrix defining cognitive levels (Bloom's Taxonomy) and test part distributions.

- **Primary Key**: `tos_exam_id`
- **Total Attributes**: 11
- **Foreign Keys**: `subject_id` → `subject.subject_id` ON DELETE CASCADE; `created_by_staff_id` → `academic_staff.staff_id` ON DELETE SET NULL

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `tos_exam_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for tos_exam. |
| `subject_id` | `INTEGER` | No | FK → `subject.subject_id` | - | Foreign key referencing the associated subject. |
| `created_by_staff_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key reference to created_by_staff. |
| `title` | `VARCHAR(255)` | No | - | - | Stores title. |
| `quarter` | `VARCHAR(20)` | No | - | `Term 1` | Stores quarter. |
| `status` | `VARCHAR(20)` | No | - | `DRAFT` | Current operational status of this record. |
| `test_parts_json` | `TEXT` | No | - | `[]` | JSON-structured data payload storing test parts json. |
| `competencies_json` | `TEXT` | No | - | `[]` | JSON-structured data payload storing competencies json. |
| `difficulty_ratio_json` | `TEXT` | No | - | `{}` | JSON-structured data payload storing difficulty ratio json. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-tos_question"></a> Table: `tos_question`

**Description**: Individual test items mapped to specific TOS competencies, cognitive domains, and difficulty levels.

- **Primary Key**: `tos_question_id`
- **Total Attributes**: 12
- **Foreign Keys**: `tos_exam_id` → `tos_exam.tos_exam_id` ON DELETE CASCADE; `competency_id` → `competency.competency_id` ON DELETE SET NULL

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `tos_question_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for tos_question. |
| `tos_exam_id` | `INTEGER` | No | FK → `tos_exam.tos_exam_id` | - | Foreign key reference to tos_exam. |
| `competency_id` | `INTEGER` | Yes | FK → `competency.competency_id` | - | Foreign key reference to competency. |
| `competency_label` | `VARCHAR(500)` | No | - | - | Stores competency label. |
| `question_text` | `TEXT` | No | - | - | Stores question text. |
| `question_type` | `VARCHAR(40)` | No | - | - | Stores question type. |
| `difficulty_band` | `VARCHAR(20)` | No | - | - | Stores difficulty band. |
| `cognitive_level` | `VARCHAR(20)` | No | - | - | Stores cognitive level. |
| `display_order` | `INTEGER` | No | - | `1` | Stores display order. |
| `points` | `NUMERIC(8, 2)` | No | - | `1.00` | Stores points. |
| `explanation` | `TEXT` | Yes | - | - | Stores explanation. |
| `options_json` | `TEXT` | Yes | - | `[]` | JSON-structured data payload storing options json. |

---

## Assessment, Quizzes & Examinations

### <a id="table-question"></a> Table: `question`

**Description**: Question bank repository storing multiple-choice, essay, and open-ended questions.

- **Primary Key**: `question_id`
- **Total Attributes**: 11
- **Foreign Keys**: `lesson_id` → `lesson.lesson_id` ON DELETE SET NULL

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `question_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for question. |
| `question_text` | `TEXT` | No | - | - | Stores question text. |
| `question_type` | `VARCHAR(40)` | No | - | - | Stores question type. |
| `difficulty_level` | `VARCHAR(30)` | Yes | - | - | Stores difficulty level. |
| `points` | `NUMERIC(8, 2)` | No | - | - | Stores points. |
| `explanation` | `TEXT` | Yes | - | - | Stores explanation. |
| `is_ai_generated` | `BOOLEAN` | No | - | `False` | Boolean flag indicating whether ai generated. |
| `expected_answer_type` | `VARCHAR(40)` | Yes | - | - | Stores expected answer type. |
| `max_file_size_mb` | `INTEGER` | Yes | - | - | Stores max file size mb. |
| `lesson_id` | `INTEGER` | Yes | FK → `lesson.lesson_id` | - | Foreign key reference to lesson. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |

---

### <a id="table-question_option"></a> Table: `question_option`

**Description**: Answer choices and options for multiple-choice questions in the question bank.

- **Primary Key**: `option_id`
- **Total Attributes**: 6
- **Foreign Keys**: `question_id` → `question.question_id` ON DELETE CASCADE
- **Unique Constraints**: `(question_id, option_order)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `option_id` | `INTEGER` | No | **PK** | - | Foreign key reference to option. |
| `question_id` | `INTEGER` | No | FK → `question.question_id` | - | Foreign key reference to question. |
| `option_text` | `TEXT` | No | - | - | Stores option text. |
| `is_correct` | `BOOLEAN` | No | - | `False` | Boolean flag indicating whether correct. |
| `option_order` | `INTEGER` | No | - | - | Stores option order. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |

---

### <a id="table-quiz"></a> Table: `quiz`

**Description**: Quiz configuration and metadata linked to classwork activities.

- **Primary Key**: `quiz_id`
- **Total Attributes**: 7
- **Foreign Keys**: `classwork_id` → `classwork.classwork_id` ON DELETE CASCADE
- **Unique Constraints**: `(classwork_id)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `quiz_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for quiz. |
| `classwork_id` | `INTEGER` | No | FK → `classwork.classwork_id` | - | Foreign key reference to classwork. |
| `total_items` | `INTEGER` | No | - | `0` | Stores total items. |
| `duration_minutes` | `INTEGER` | Yes | - | - | Stores duration minutes. |
| `accessible_at` | `DATETIME` | Yes | - | - | Stores accessible at. |
| `status` | `VARCHAR(30)` | No | - | `DRAFT` | Current operational status of this record. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |

---

### <a id="table-quiz_question"></a> Table: `quiz_question`

**Description**: Junction table linking questions from the question bank to specific quizzes with ordering.

- **Primary Key**: `quiz_question_id`
- **Total Attributes**: 4
- **Foreign Keys**: `quiz_id` → `quiz.quiz_id` ON DELETE CASCADE; `question_id` → `question.question_id` ON DELETE CASCADE
- **Unique Constraints**: `(quiz_id, question_id)`, `(quiz_id, display_order)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `quiz_question_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for quiz_question. |
| `quiz_id` | `INTEGER` | No | FK → `quiz.quiz_id` | - | Foreign key reference to quiz. |
| `question_id` | `INTEGER` | No | FK → `question.question_id` | - | Foreign key reference to question. |
| `display_order` | `INTEGER` | No | - | - | Stores display order. |

---

### <a id="table-quiz_answer"></a> Table: `quiz_answer`

**Description**: Student answer responses submitted during quiz attempts.

- **Primary Key**: `answer_id`
- **Total Attributes**: 6
- **Foreign Keys**: `quiz_question_id` → `quiz_question.quiz_question_id` ON DELETE CASCADE; `submission_id` → `student_submission.submission_id` ON DELETE CASCADE
- **Unique Constraints**: `(submission_id, quiz_question_id)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `answer_id` | `INTEGER` | No | **PK** | - | Foreign key reference to answer. |
| `quiz_question_id` | `INTEGER` | No | FK → `quiz_question.quiz_question_id` | - | Foreign key reference to quiz_question. |
| `submission_id` | `INTEGER` | No | FK → `student_submission.submission_id` | - | Foreign key reference to submission. |
| `answer_text` | `TEXT` | Yes | - | - | Stores answer text. |
| `is_correct` | `BOOLEAN` | Yes | - | - | Boolean flag indicating whether correct. |
| `points_awarded` | `NUMERIC(8, 2)` | Yes | - | - | Stores points awarded. |

---

### <a id="table-quiz_setting"></a> Table: `quiz_setting`

**Description**: Execution behavior rules for quizzes (timer, shuffle options, attempt limits, score visibility).

- **Primary Key**: `quiz_setting_id`
- **Total Attributes**: 10
- **Foreign Keys**: `classwork_id` → `classwork.classwork_id` ON DELETE CASCADE
- **Unique Constraints**: `(classwork_id)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `quiz_setting_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for quiz_setting. |
| `classwork_id` | `INTEGER` | No | FK → `classwork.classwork_id` | - | Foreign key reference to classwork. |
| `is_shuffle_questions` | `BOOLEAN` | No | - | `False` | Boolean flag indicating whether shuffle questions. |
| `enable_per_question_scoring` | `BOOLEAN` | No | - | `True` | Stores enable per question scoring. |
| `enable_per_question_time_limits` | `BOOLEAN` | No | - | `False` | Time specification for enable per question time limits. |
| `max_attempts` | `INTEGER` | Yes | - | - | Stores max attempts. |
| `show_correct_answers` | `BOOLEAN` | No | - | `False` | Stores show correct answers. |
| `summary_release_mode` | `VARCHAR(32)` | No | - | `IMMEDIATE` | Stores summary release mode. |
| `summary_release_at` | `DATETIME` | Yes | - | - | Stores summary release at. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |

---

## Grading System & DepEd Assessment

### <a id="table-grading_template"></a> Table: `grading_template`

**Description**: Defines DepEd grading percentage distributions (Written Work, Performance Tasks, Quarterly Assessment).

- **Primary Key**: `grading_template_id`
- **Total Attributes**: 8
- **Foreign Keys**: `academic_level_id` → `academic_level.academic_level_id`; `subject_id` → `subject.subject_id`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `grading_template_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for grading_template. |
| `template_name` | `VARCHAR(150)` | No | - | - | Name or label for grading template. |
| `description` | `TEXT` | Yes | - | - | Descriptive text or explanation for this entity. |
| `academic_level_id` | `INTEGER` | Yes | FK → `academic_level.academic_level_id` | - | Foreign key referencing the academic grade level. |
| `subject_id` | `INTEGER` | Yes | FK → `subject.subject_id` | - | Foreign key referencing the associated subject. |
| `status` | `VARCHAR(20)` | No | - | `active` | Current operational status of this record. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-grading_template_component"></a> Table: `grading_template_component`

**Description**: Components of a grading template (e.g., Written Work: 40%, Performance Tasks: 40%, Exam: 20%).

- **Primary Key**: `component_id`
- **Total Attributes**: 7
- **Foreign Keys**: `grading_template_id` → `grading_template.grading_template_id` ON DELETE CASCADE
- **Unique Constraints**: `(grading_template_id, display_order)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `component_id` | `INTEGER` | No | **PK** | - | Foreign key reference to component. |
| `grading_template_id` | `INTEGER` | No | FK → `grading_template.grading_template_id` | - | Foreign key reference to grading_template. |
| `component_name` | `VARCHAR(100)` | No | - | - | Name or label for grading template component. |
| `weight` | `NUMERIC(6, 2)` | No | - | - | Stores weight. |
| `display_order` | `INTEGER` | No | - | - | Stores display order. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-assessment_item"></a> Table: `assessment_item`

**Description**: Grading sheet column entries representing individual graded activities within a component.

- **Primary Key**: `assessment_id`
- **Total Attributes**: 9
- **Foreign Keys**: `class_id` → `class.class_id` ON DELETE CASCADE; `subject_id` → `subject.subject_id` ON DELETE CASCADE; `academic_period_id` → `academic_period.academic_period_id` ON DELETE CASCADE; `entered_by_staff_id` → `academic_staff.staff_id` ON DELETE SET NULL
- **Unique Constraints**: `(class_id, subject_id, academic_period_id, component_type, item_number)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `assessment_id` | `INTEGER` | No | **PK** | - | Foreign key reference to assessment. |
| `class_id` | `INTEGER` | No | FK → `class.class_id` | - | Foreign key referencing the associated class section. |
| `subject_id` | `INTEGER` | No | FK → `subject.subject_id` | - | Foreign key referencing the associated subject. |
| `academic_period_id` | `INTEGER` | No | FK → `academic_period.academic_period_id` | - | Foreign key referencing the grading period/quarter. |
| `component_type` | `VARCHAR(40)` | No | - | - | Stores component type. |
| `item_number` | `INTEGER` | No | - | - | Stores item number. |
| `max_score` | `NUMERIC(8, 2)` | No | - | - | Stores max score. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `entered_by_staff_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key reference to entered_by_staff. |

---

### <a id="table-student_assessment_score"></a> Table: `student_assessment_score`

**Description**: Learner raw scores recorded for specific assessment items in the electronic class record.

- **Primary Key**: `score_id`
- **Total Attributes**: 7
- **Foreign Keys**: `assessment_id` → `assessment_item.assessment_id` ON DELETE CASCADE; `student_id` → `student.student_id` ON DELETE CASCADE; `entered_by_staff_id` → `academic_staff.staff_id` ON DELETE SET NULL
- **Unique Constraints**: `(assessment_id, student_id)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `score_id` | `INTEGER` | No | **PK** | - | Foreign key reference to score. |
| `assessment_id` | `INTEGER` | No | FK → `assessment_item.assessment_id` | - | Foreign key reference to assessment. |
| `student_id` | `UUID` | No | FK → `student.student_id` | - | Foreign key referencing the learner record. |
| `raw_score` | `NUMERIC(8, 2)` | Yes | - | - | Stores raw score. |
| `score_status` | `VARCHAR(30)` | No | - | `RECORDED` | Stores score status. |
| `encoded_at` | `DATETIME` | Yes | - | `now()` | Stores encoded at. |
| `entered_by_staff_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key reference to entered_by_staff. |

---

### <a id="table-student_period_grade"></a> Table: `student_period_grade`

**Description**: Computed quarterly/period grades for students per subject load, storing transmuted DepEd grades.

- **Primary Key**: `period_grade_id`
- **Total Attributes**: 18
- **Foreign Keys**: `student_id` → `student.student_id` ON DELETE CASCADE; `class_id` → `class.class_id` ON DELETE CASCADE; `subject_id` → `subject.subject_id` ON DELETE CASCADE; `academic_period_id` → `academic_period.academic_period_id` ON DELETE CASCADE; `finalized_by_staff_id` → `academic_staff.staff_id` ON DELETE SET NULL; `entered_by_staff_id` → `academic_staff.staff_id` ON DELETE SET NULL
- **Unique Constraints**: `(student_id, class_id, subject_id, academic_period_id)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `period_grade_id` | `INTEGER` | No | **PK** | - | Foreign key reference to period_grade. |
| `student_id` | `UUID` | No | FK → `student.student_id` | - | Foreign key referencing the learner record. |
| `class_id` | `INTEGER` | No | FK → `class.class_id` | - | Foreign key referencing the associated class section. |
| `subject_id` | `INTEGER` | No | FK → `subject.subject_id` | - | Foreign key referencing the associated subject. |
| `academic_period_id` | `INTEGER` | No | FK → `academic_period.academic_period_id` | - | Foreign key referencing the grading period/quarter. |
| `written_work_percent` | `NUMERIC(6, 2)` | Yes | - | - | Stores written work percent. |
| `performance_task_percent` | `NUMERIC(6, 2)` | Yes | - | - | Stores performance task percent. |
| `quarterly_assessment_percent` | `NUMERIC(6, 2)` | Yes | - | - | Stores quarterly assessment percent. |
| `initial_grade` | `NUMERIC(6, 2)` | Yes | - | - | Weighted raw grade calculated from grading components prior to transmutation. |
| `transmuted_grade` | `NUMERIC(6, 2)` | Yes | - | - | Official DepEd transmuted grade based on standard DepEd transmutation tables. |
| `final_period_grade` | `NUMERIC(6, 2)` | Yes | - | - | Stores final period grade. |
| `is_finalized` | `BOOLEAN` | No | - | `False` | Boolean flag indicating whether finalized. |
| `finalized_at` | `DATETIME` | Yes | - | - | Stores finalized at. |
| `finalized_by_staff_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key reference to finalized_by_staff. |
| `entered_by_staff_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key reference to entered_by_staff. |
| `remarks` | `TEXT` | Yes | - | - | Stores remarks. |
| `source_file_name` | `VARCHAR(255)` | Yes | - | - | Name or label for student period grade. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |

---

### <a id="table-grade_submission_log"></a> Table: `grade_submission_log`

**Description**: Audit trail logging formal grade submissions, approvals, and post-submission alterations.

- **Primary Key**: `id`
- **Total Attributes**: 16
- **Foreign Keys**: `student_period_grade_id` → `student_period_grade.period_grade_id` ON DELETE SET NULL; `student_id` → `student.student_id` ON DELETE CASCADE; `class_id` → `class.class_id` ON DELETE CASCADE; `subject_id` → `subject.subject_id` ON DELETE CASCADE; `academic_period_id` → `academic_period.academic_period_id` ON DELETE CASCADE; `submitted_by_staff_id` → `academic_staff.staff_id` ON DELETE SET NULL

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `id` | `INTEGER` | No | **PK** | - | Stores id. |
| `student_period_grade_id` | `INTEGER` | Yes | FK → `student_period_grade.period_grade_id` | - | Foreign key reference to student_period_grade. |
| `student_id` | `UUID` | No | FK → `student.student_id` | - | Foreign key referencing the learner record. |
| `class_id` | `INTEGER` | No | FK → `class.class_id` | - | Foreign key referencing the associated class section. |
| `subject_id` | `INTEGER` | No | FK → `subject.subject_id` | - | Foreign key referencing the associated subject. |
| `academic_period_id` | `INTEGER` | No | FK → `academic_period.academic_period_id` | - | Foreign key referencing the grading period/quarter. |
| `written_work_percent` | `NUMERIC(6, 2)` | Yes | - | - | Stores written work percent. |
| `performance_task_percent` | `NUMERIC(6, 2)` | Yes | - | - | Stores performance task percent. |
| `quarterly_assessment_percent` | `NUMERIC(6, 2)` | Yes | - | - | Stores quarterly assessment percent. |
| `initial_grade` | `NUMERIC(6, 2)` | Yes | - | - | Stores initial grade. |
| `transmuted_grade` | `NUMERIC(6, 2)` | Yes | - | - | Stores transmuted grade. |
| `final_period_grade` | `NUMERIC(6, 2)` | Yes | - | - | Stores final period grade. |
| `submitted_by_staff_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key reference to submitted_by_staff. |
| `submitted_at` | `DATETIME` | No | - | `now()` | Stores submitted at. |
| `submission_type` | `VARCHAR(20)` | No | - | `single` | Stores submission type. |
| `remarks` | `TEXT` | Yes | - | - | Stores remarks. |

---

## Attendance & Learner Welfare

### <a id="table-attendance_record"></a> Table: `attendance_record`

**Description**: Daily/session attendance records tracking present, absent, late, or excused statuses.

- **Primary Key**: `attendance_id`
- **Total Attributes**: 10
- **Foreign Keys**: `student_id` → `student.student_id` ON DELETE CASCADE; `class_id` → `class.class_id` ON DELETE CASCADE; `subject_id` → `subject.subject_id` ON DELETE CASCADE; `recorded_by_staff_id` → `academic_staff.staff_id` ON DELETE SET NULL
- **Unique Constraints**: `(student_id, class_id, subject_id, date)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `attendance_id` | `INTEGER` | No | **PK** | - | Foreign key reference to attendance. |
| `student_id` | `UUID` | No | FK → `student.student_id` | - | Foreign key referencing the learner record. |
| `class_id` | `INTEGER` | No | FK → `class.class_id` | - | Foreign key referencing the associated class section. |
| `subject_id` | `INTEGER` | Yes | FK → `subject.subject_id` | - | Foreign key referencing the associated subject. |
| `date` | `DATE` | No | - | - | Calendar date for date. |
| `status` | `VARCHAR(20)` | No | - | `present` | Current operational status of this record. |
| `remarks` | `TEXT` | Yes | - | - | Stores remarks. |
| `recorded_by_staff_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key reference to recorded_by_staff. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

### <a id="table-leave_request"></a> Table: `leave_request`

**Description**: Learner and faculty leave of absence requests, approvals, and supporting excuse documentation.

- **Primary Key**: `leave_request_id`
- **Total Attributes**: 11
- **Foreign Keys**: `student_id` → `student.student_id` ON DELETE CASCADE; `class_id` → `class.class_id` ON DELETE CASCADE; `reviewed_by_staff_id` → `academic_staff.staff_id` ON DELETE SET NULL

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `leave_request_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for leave_request. |
| `student_id` | `UUID` | No | FK → `student.student_id` | - | Foreign key referencing the learner record. |
| `class_id` | `INTEGER` | No | FK → `class.class_id` | - | Foreign key referencing the associated class section. |
| `start_date` | `DATE` | No | - | - | Calendar date for start date. |
| `end_date` | `DATE` | No | - | - | Calendar date for end date. |
| `reason` | `TEXT` | No | - | - | Stores reason. |
| `status` | `VARCHAR(20)` | No | - | `pending` | Current operational status of this record. |
| `reviewed_by_staff_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key reference to reviewed_by_staff. |
| `reviewed_at` | `DATETIME` | Yes | - | - | Stores reviewed at. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |

---

## AI Early Warning System & Risk Management

### <a id="table-ai_model_version"></a> Table: `ai_model_version`

**Description**: Registry of trained machine learning models (XGBoost, Random Forest) with performance metrics.

- **Primary Key**: `model_version_id`
- **Total Attributes**: 13
- **Foreign Keys**: None (Root / Independent Entity)

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `model_version_id` | `INTEGER` | No | **PK** | - | Foreign key reference to model_version. |
| `model_name` | `VARCHAR(150)` | No | - | - | Name or label for ai model version. |
| `model_type` | `VARCHAR(30)` | No | - | - | Stores model type. |
| `algorithm` | `VARCHAR(150)` | No | - | - | Stores algorithm. |
| `trained_at` | `DATETIME` | Yes | - | `now()` | Stores trained at. |
| `training_row_count` | `INTEGER` | Yes | - | - | Stores training row count. |
| `test_row_count` | `INTEGER` | Yes | - | - | Stores test row count. |
| `mae` | `NUMERIC(10, 4)` | Yes | - | - | Stores mae. |
| `rmse` | `NUMERIC(10, 4)` | Yes | - | - | Stores rmse. |
| `r2_score` | `NUMERIC(10, 4)` | Yes | - | - | Stores r2 score. |
| `feature_schema_json` | `JSON` | Yes | - | - | JSON-structured data payload storing feature schema json. |
| `artifact_path` | `VARCHAR(500)` | Yes | - | - | Stores artifact path. |
| `is_active` | `BOOLEAN` | No | - | `False` | Flag indicating whether this record is currently active in the system. |

---

### <a id="table-ai_prediction"></a> Table: `ai_prediction`

**Description**: Core Early Warning System predictions, classifying student academic risk (At-Risk, Moderate, Safe) with confidence scores.

- **Primary Key**: `prediction_id`
- **Total Attributes**: 12
- **Foreign Keys**: `student_id` → `student.student_id` ON DELETE CASCADE; `class_id` → `class.class_id` ON DELETE CASCADE; `subject_id` → `subject.subject_id` ON DELETE CASCADE; `source_period_id` → `academic_period.academic_period_id` ON DELETE CASCADE; `target_period_id` → `academic_period.academic_period_id` ON DELETE CASCADE; `model_version_id` → `ai_model_version.model_version_id` ON DELETE RESTRICT

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `prediction_id` | `INTEGER` | No | **PK** | - | Foreign key reference to prediction. |
| `student_id` | `UUID` | No | FK → `student.student_id` | - | Foreign key referencing the learner record. |
| `class_id` | `INTEGER` | No | FK → `class.class_id` | - | Foreign key referencing the associated class section. |
| `subject_id` | `INTEGER` | No | FK → `subject.subject_id` | - | Foreign key referencing the associated subject. |
| `source_period_id` | `INTEGER` | No | FK → `academic_period.academic_period_id` | - | Foreign key reference to source_period. |
| `target_period_id` | `INTEGER` | No | FK → `academic_period.academic_period_id` | - | Foreign key reference to target_period. |
| `predicted_period_grade` | `NUMERIC(6, 2)` | Yes | - | - | Stores predicted period grade. |
| `risk_score` | `NUMERIC(8, 4)` | Yes | - | - | Continuous probabilistic risk score between 0.0 and 1.0. |
| `risk_level` | `VARCHAR(30)` | No | - | - | Stores risk level. |
| `data_status` | `VARCHAR(30)` | No | - | - | JSON-structured data payload storing data status. |
| `model_version_id` | `INTEGER` | Yes | FK → `ai_model_version.model_version_id` | - | Foreign key reference to model_version. |
| `generated_at` | `DATETIME` | Yes | - | `now()` | Stores generated at. |

---

### <a id="table-ai_prediction_feature"></a> Table: `ai_prediction_feature`

**Description**: Stores feature importances and SHAP values explaining why a student was classified as at-risk.

- **Primary Key**: `feature_id`
- **Total Attributes**: 9
- **Foreign Keys**: `prediction_id` → `ai_prediction.prediction_id` ON DELETE CASCADE

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `feature_id` | `INTEGER` | No | **PK** | - | Foreign key reference to feature. |
| `prediction_id` | `INTEGER` | No | FK → `ai_prediction.prediction_id` | - | Foreign key reference to prediction. |
| `feature_name` | `VARCHAR(150)` | No | - | - | Name or label for ai prediction feature. |
| `feature_value` | `NUMERIC(12, 4)` | Yes | - | - | Stores feature value. |
| `feature_contribution` | `NUMERIC(12, 6)` | Yes | - | - | Stores feature contribution. |
| `direction` | `VARCHAR(30)` | No | - | - | Stores direction. |
| `feature_rank` | `INTEGER` | Yes | - | - | Stores feature rank. |
| `explanation_method` | `VARCHAR(30)` | No | - | - | Stores explanation method. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |

---

### <a id="table-prediction_outcome"></a> Table: `prediction_outcome`

**Description**: Validates ML model predictions against actual final student grades to measure precision and recall.

- **Primary Key**: `outcome_id`
- **Total Attributes**: 13
- **Foreign Keys**: `prediction_id` → `ai_prediction.prediction_id` ON DELETE CASCADE

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `outcome_id` | `INTEGER` | No | **PK** | - | Foreign key reference to outcome. |
| `prediction_id` | `INTEGER` | No | FK → `ai_prediction.prediction_id` | - | Foreign key reference to prediction. |
| `actual_period_grade` | `NUMERIC(6, 2)` | Yes | - | - | Stores actual period grade. |
| `actual_risk_status` | `VARCHAR(30)` | Yes | - | - | Stores actual risk status. |
| `prediction_error` | `NUMERIC(8, 2)` | Yes | - | - | Stores prediction error. |
| `absolute_error` | `NUMERIC(8, 2)` | Yes | - | - | Stores absolute error. |
| `actual_passed` | `BOOLEAN` | Yes | - | - | Stores actual passed. |
| `actual_risk_label` | `VARCHAR(30)` | Yes | - | - | Stores actual risk label. |
| `outcome_status` | `VARCHAR(30)` | Yes | - | - | Stores outcome status. |
| `evaluated_at` | `DATETIME` | Yes | - | - | Stores evaluated at. |
| `intervention_given` | `BOOLEAN` | Yes | - | - | Stores intervention given. |
| `intervention_result` | `TEXT` | Yes | - | - | Stores intervention result. |
| `recorded_at` | `DATETIME` | Yes | - | `now()` | Stores recorded at. |

---

### <a id="table-risk_threshold"></a> Table: `risk_threshold`

**Description**: Configurable risk score boundaries and alert sensitivity settings for early warning triggers.

- **Primary Key**: `threshold_id`
- **Total Attributes**: 9
- **Foreign Keys**: None (Root / Independent Entity)

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `threshold_id` | `INTEGER` | No | **PK** | - | Foreign key reference to threshold. |
| `threshold_name` | `VARCHAR(150)` | No | - | - | Name or label for risk threshold. |
| `condition_type` | `VARCHAR(100)` | No | - | - | Stores condition type. |
| `condition_value` | `NUMERIC(10, 4)` | No | - | - | Stores condition value. |
| `risk_level` | `VARCHAR(30)` | No | - | - | Stores risk level. |
| `effective_from` | `DATETIME` | No | - | - | Stores effective from. |
| `effective_to` | `DATETIME` | Yes | - | - | Stores effective to. |
| `is_active` | `BOOLEAN` | No | - | `True` | Flag indicating whether this record is currently active in the system. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |

---

### <a id="table-teacher_risk_review"></a> Table: `teacher_risk_review`

**Description**: Records teacher reviews, notes, and qualitative observations regarding AI risk alerts.

- **Primary Key**: `review_id`
- **Total Attributes**: 7
- **Foreign Keys**: `prediction_id` → `ai_prediction.prediction_id` ON DELETE CASCADE; `student_id` → `student.student_id` ON DELETE CASCADE; `reviewed_by_staff_id` → `academic_staff.staff_id` ON DELETE SET NULL

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `review_id` | `INTEGER` | No | **PK** | - | Foreign key reference to review. |
| `prediction_id` | `INTEGER` | No | FK → `ai_prediction.prediction_id` | - | Foreign key reference to prediction. |
| `student_id` | `UUID` | No | FK → `student.student_id` | - | Foreign key referencing the learner record. |
| `reviewed_by_staff_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key reference to reviewed_by_staff. |
| `review_decision` | `VARCHAR(30)` | No | - | - | Stores review decision. |
| `teacher_notes` | `TEXT` | Yes | - | - | Stores teacher notes. |
| `reviewed_at` | `DATETIME` | Yes | - | `now()` | Stores reviewed at. |

---

## Targeted Interventions & Recommendations

### <a id="table-student_suggestion"></a> Table: `student_suggestion`

**Description**: Personalized intervention recommendations generated for students flagged at academic risk.

- **Primary Key**: `student_suggestion_id`
- **Total Attributes**: 16
- **Foreign Keys**: `student_id` → `student.student_id` ON DELETE CASCADE; `subject_id` → `subject.subject_id` ON DELETE CASCADE; `lesson_id` → `lesson.lesson_id` ON DELETE SET NULL; `created_by_staff_id` → `academic_staff.staff_id` ON DELETE SET NULL; `prediction_id` → `ai_prediction.prediction_id` ON DELETE SET NULL

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `student_suggestion_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for student_suggestion. |
| `suggestion_type` | `VARCHAR(30)` | No | - | `MANUAL` | Stores suggestion type. |
| `resource_type` | `VARCHAR(30)` | No | - | - | Stores resource type. |
| `title` | `VARCHAR(255)` | No | - | - | Stores title. |
| `description` | `TEXT` | Yes | - | - | Descriptive text or explanation for this entity. |
| `resource_links` | `JSON` | Yes | - | - | Stores resource links. |
| `priority` | `VARCHAR(30)` | No | - | `NORMAL` | Stores priority. |
| `status` | `VARCHAR(30)` | No | - | `ACTIVE` | Current operational status of this record. |
| `is_viewed` | `BOOLEAN` | No | - | `False` | Boolean flag indicating whether viewed. |
| `viewed_at` | `DATETIME` | Yes | - | - | Stores viewed at. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `student_id` | `UUID` | No | FK → `student.student_id` | - | Foreign key referencing the learner record. |
| `subject_id` | `INTEGER` | No | FK → `subject.subject_id` | - | Foreign key referencing the associated subject. |
| `lesson_id` | `INTEGER` | Yes | FK → `lesson.lesson_id` | - | Foreign key reference to lesson. |
| `created_by_staff_id` | `VARCHAR(20)` | Yes | FK → `academic_staff.staff_id` | - | Foreign key reference to created_by_staff. |
| `prediction_id` | `INTEGER` | Yes | FK → `ai_prediction.prediction_id` | - | Foreign key reference to prediction. |

---

### <a id="table-suggestion_classwork"></a> Table: `suggestion_classwork`

**Description**: Junction linking recommended remedial classwork activities to student intervention plans.

- **Primary Key**: `suggestion_classwork_id`
- **Total Attributes**: 7
- **Foreign Keys**: `student_suggestion_id` → `student_suggestion.student_suggestion_id` ON DELETE CASCADE; `classwork_assignment_id` → `classwork_assignment.classwork_assignment_id` ON DELETE CASCADE
- **Unique Constraints**: `(student_suggestion_id)`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `suggestion_classwork_id` | `INTEGER` | No | **PK** | - | Primary key unique identifier for suggestion_classwork. |
| `student_suggestion_id` | `INTEGER` | No | FK → `student_suggestion.student_suggestion_id` | - | Foreign key reference to student_suggestion. |
| `classwork_assignment_id` | `INTEGER` | No | FK → `classwork_assignment.classwork_assignment_id` | - | Foreign key reference to classwork_assignment. |
| `is_completed` | `BOOLEAN` | No | - | `False` | Boolean flag indicating whether completed. |
| `completed_at` | `DATETIME` | Yes | - | - | Stores completed at. |
| `score_before` | `NUMERIC(8, 2)` | Yes | - | - | Stores score before. |
| `score_after` | `NUMERIC(8, 2)` | Yes | - | - | Stores score after. |

---

## System Administration & Communications

### <a id="table-notification"></a> Table: `notification`

**Description**: System notification queue delivering in-app alerts to students, teachers, and administrators.

- **Primary Key**: `notification_id`
- **Total Attributes**: 9
- **Foreign Keys**: `user_id` → `user_account.user_id` ON DELETE CASCADE

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `notification_id` | `UUID` | No | **PK** | `<function uuid4 at 0x000001D4F5257950>` | Primary key unique identifier for notification. |
| `user_id` | `UUID` | No | FK → `user_account.user_id` | - | Foreign key referencing the associated user account. |
| `notification_type` | `VARCHAR(60)` | No | - | - | Stores notification type. |
| `title` | `VARCHAR(255)` | No | - | - | Stores title. |
| `body` | `TEXT` | Yes | - | - | Stores body. |
| `action_url` | `VARCHAR(500)` | Yes | - | - | Stores action url. |
| `is_read` | `BOOLEAN` | No | - | `False` | Boolean flag indicating whether read. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `read_at` | `DATETIME` | Yes | - | - | Stores read at. |

---

### <a id="table-setting"></a> Table: `setting`

**Description**: Global system configurations, institutional details, grading parameters, and feature toggles.

- **Primary Key**: `id`
- **Total Attributes**: 10
- **Foreign Keys**: `updated_by` → `user_account.user_id`

#### Attributes

| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |
|---|---|:---:|:---:|---|---|
| `id` | `INTEGER` | No | **PK** | - | Stores id. |
| `key` | `VARCHAR(100)` | No | UNIQUE | - | Stores key. |
| `value` | `TEXT` | No | - | `` | Stores value. |
| `type` | `VARCHAR(7)` | No | - | - | Stores type. |
| `group` | `VARCHAR(50)` | No | - | `general` | Stores group. |
| `is_public` | `BOOLEAN` | No | - | `False` | Boolean flag indicating whether public. |
| `description` | `TEXT` | Yes | - | - | Descriptive text or explanation for this entity. |
| `created_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was originally created in the database. |
| `updated_at` | `DATETIME` | Yes | - | `now()` | Timestamp when this record was last modified. |
| `updated_by` | `UUID` | Yes | FK → `user_account.user_id` | - | Calendar date for updated by. |

---

## Database Integrity & Schema Audit Log

This section summarizes the discrepancies resolved between the original planning schema (`database_schema.txt`), the SQLAlchemy models, and the PostgreSQL/SQLite production database:

### 1. Dropped Dead Items (Cleaned via Alembic Migration `12aa5108d9e8_add_lessonplanmodel.py`)
The following legacy / prototype schema elements had no functional implementation and were formally dropped from PostgreSQL:
- **`classwork_allowed_file_type` (Table)**: Prototype table originally intended to restrict submission file extensions. Replaced by application-level MIME-type validation.
- **`classwork.rubric_id` (Column)**: Deprecated column referencing an unbuilt rubric grading subsystem.
- **`classwork.cloned_from_classwork_id` (Column)**: Removed prototype self-referential cloning column.
- **`student.guardian_id` & `student.import_log_id` (Columns)**: Legacy columns without corresponding parent tables.
- **`student.account_status` (Column)**: Redundant status column eliminated in favor of canonical `user_account.account_status`.

### 2. Corrected Documentation Syntax Errors
- **`database_schema.txt` line 48-50 Copy-Paste Constraint**: The table `user_account` erroneously contained `CONSTRAINT uq_class_adviser_academic_year UNIQUE (adviser_staff_id, academic_year_id)`. This constraint belongs exclusively to the `class` table.

### 3. Active Column Drift Documented
- **`subject_load`**: Added 10 modern scheduling columns (`slot_id`, `start_time`, `end_time`, `days_of_week`, `version`, `is_active_version`, `published_at`, `published_by`, `last_modified_by`, `draft_notes`) to power the Subject Load Studio.
- **`student`**: Added `dob` and `prior_gwa` critical for baseline Machine Learning feature engineering.
- **`student_submission`**: Added `reading_focused_seconds` to capture real-time learner engagement.

"""
Script to generate the comprehensive, defense-ready DATA_DICTIONARY.md
by introspecting SQLAlchemy metadata and enriching with domain knowledge.
"""

import sys
import os
import datetime

# Add backend directory to sys.path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import app.models
import pkgutil
import importlib
from app.db.Base import Base

# Ensure all model packages and submodules are imported
for _, module_name, _ in pkgutil.walk_packages(app.models.__path__, app.models.__name__ + '.'):
    try:
        importlib.import_module(module_name)
    except Exception as e:
        print(f"Warning importing {module_name}: {e}")

DOMAIN_MAPPING = {
    "Authentication & Authorization": [
        "role", "user_account", "user_roles", "user_login_log", "invitation_token"
    ],
    "People & User Profiles": [
        "academic_staff", "student"
    ],
    "Academic Structure & Curriculum Hierarchy": [
        "academic_year", "academic_level", "academic_period", "academic_pathway",
        "deped_cluster", "academic_level_pathway_scope", "subject_groups",
        "subject", "subject_offering", "subject_offering_pathway", "competency", "class"
    ],
    "Scheduling & Faculty Workload": [
        "period_template_slot", "subject_load", "teacher_substitution"
    ],
    "Enrollment & Lesson Delivery": [
        "student_class", "lesson", "lesson_assignment", "lesson_plan"
    ],
    "Classwork, Activities & Submissions": [
        "classwork", "classwork_assignment", "classwork_attachment", "classwork_lesson",
        "student_submission", "submission_attachment", "tos_exam", "tos_question"
    ],
    "Assessment, Quizzes & Examinations": [
        "question", "question_option", "quiz", "quiz_question", "quiz_answer", "quiz_setting"
    ],
    "Grading System & DepEd Assessment": [
        "grading_template", "grading_template_component", "assessment_item",
        "student_assessment_score", "student_period_grade", "grade_submission_log"
    ],
    "Attendance & Learner Welfare": [
        "attendance_record", "leave_request"
    ],
    "AI Early Warning System & Risk Management": [
        "ai_model_version", "ai_prediction", "ai_prediction_feature",
        "prediction_outcome", "risk_threshold", "teacher_risk_review"
    ],
    "Targeted Interventions & Recommendations": [
        "student_suggestion", "suggestion_classwork"
    ],
    "System Administration & Communications": [
        "notification", "setting"
    ]
}

TABLE_DESCRIPTIONS = {
    "role": "Defines access control roles within the system (e.g., ADMIN, TEACHER, STUDENT). Controls permission scopes across the entire platform.",
    "user_account": "Core authentication table storing system credentials, account status, verification state, and audit timestamps.",
    "user_roles": "Junction table mapping users to their assigned system roles (Many-to-Many relationship between user_account and role).",
    "user_login_log": "Security and activity tracking table recording user authentication events, timestamps, and IP addresses.",
    "invitation_token": "Manages secure onboarding tokens for new staff and student registration, tracking expiration and activation status.",
    "academic_staff": "Stores profile and institutional credentials for teachers, administrators, and academic personnel.",
    "student": "Stores learner master data including DepEd Learner Reference Number (LRN), personal demographic data, and baseline academic metrics (prior GWA).",
    "academic_year": "Defines institutional school years (e.g., 2025-2026), marking whether a school year is currently active.",
    "academic_level": "Represents grade/year levels (e.g., Grade 7 through Grade 12), categorized under Junior High School or Senior High School.",
    "academic_period": "Represents grading periods/quarters/semesters within an academic year, tracking progress ratios and active state.",
    "academic_pathway": "Models Senior High School tracks and strands (e.g., STEM, ABM, HUMSS, TVL) aligned with DepEd K-12 standards.",
    "deped_cluster": "Groups academic disciplines into standard Department of Education curriculum clusters (e.g., Core, Applied, Specialized).",
    "academic_level_pathway_scope": "Defines which academic pathways/strands are available at specific academic year levels.",
    "subject_groups": "Organizes academic subjects into functional learning departments or curriculum categories.",
    "subject": "Curriculum master catalog of academic subjects/courses offered by the institution.",
    "subject_offering": "Represents an offering of a subject for a specific grade level and academic period.",
    "subject_offering_pathway": "Junction table linking subject offerings to specific academic pathways (strands).",
    "competency": "Stores DepEd Most Essential Learning Competencies (MELCs) and curriculum objectives linked to subjects.",
    "class": "Represents academic class sections (e.g., Grade 10 - Rizal), assigned to an adviser, grade level, and academic year.",
    "period_template_slot": "Individual time periods within a bell schedule template (start time, end time, period order).",
    "subject_load": "Faculty teaching loads and section schedules, supporting multi-version draft and publish workflows for Subject Load Studio.",
    "teacher_substitution": "Manages temporary teacher substitution assignments when a faculty member is on leave or unavailable.",
    "student_class": "Student section enrollment records, linking learners to classes for a specific academic year.",
    "lesson": "Instructional content, lecture modules, and learning packages authored by teachers, linked to curriculum competencies.",
    "lesson_assignment": "Distributes lessons to specific classes with scheduled availability dates.",
    "lesson_plan": "AI-assisted lesson planning records supporting instructional objectives, DepEd 4As framework, and teaching notes.",
    "classwork": "Assessments, assignments, activities, and reading tasks assigned to students.",
    "classwork_assignment": "Publishes classwork to specific class sections with deadlines and submission rules.",
    "classwork_attachment": "Reference documents, rubrics, and media attached to classwork items.",
    "classwork_lesson": "Junction table linking classwork tasks to relevant lesson modules.",
    "student_submission": "Student submissions for classwork, storing submission status, grades, reading duration, and teacher feedback.",
    "submission_attachment": "Files and digital artifacts submitted by students for an assignment.",
    "tos_exam": "Table of Specifications (TOS) exam matrix defining cognitive levels (Bloom's Taxonomy) and test part distributions.",
    "tos_question": "Individual test items mapped to specific TOS competencies, cognitive domains, and difficulty levels.",
    "question": "Question bank repository storing multiple-choice, essay, and open-ended questions.",
    "question_option": "Answer choices and options for multiple-choice questions in the question bank.",
    "quiz": "Quiz configuration and metadata linked to classwork activities.",
    "quiz_question": "Junction table linking questions from the question bank to specific quizzes with ordering.",
    "quiz_answer": "Student answer responses submitted during quiz attempts.",
    "quiz_setting": "Execution behavior rules for quizzes (timer, shuffle options, attempt limits, score visibility).",
    "grading_template": "Defines DepEd grading percentage distributions (Written Work, Performance Tasks, Quarterly Assessment).",
    "grading_template_component": "Components of a grading template (e.g., Written Work: 40%, Performance Tasks: 40%, Exam: 20%).",
    "assessment_item": "Grading sheet column entries representing individual graded activities within a component.",
    "student_assessment_score": "Learner raw scores recorded for specific assessment items in the electronic class record.",
    "student_period_grade": "Computed quarterly/period grades for students per subject load, storing transmuted DepEd grades.",
    "grade_submission_log": "Audit trail logging formal grade submissions, approvals, and post-submission alterations.",
    "attendance_record": "Daily/session attendance records tracking present, absent, late, or excused statuses.",
    "leave_request": "Learner and faculty leave of absence requests, approvals, and supporting excuse documentation.",
    "ai_model_version": "Registry of trained machine learning models (XGBoost, Random Forest) with performance metrics.",
    "ai_prediction": "Core Early Warning System predictions, classifying student academic risk (At-Risk, Moderate, Safe) with confidence scores.",
    "ai_prediction_feature": "Stores feature importances and SHAP values explaining why a student was classified as at-risk.",
    "prediction_outcome": "Validates ML model predictions against actual final student grades to measure precision and recall.",
    "risk_threshold": "Configurable risk score boundaries and alert sensitivity settings for early warning triggers.",
    "teacher_risk_review": "Records teacher reviews, notes, and qualitative observations regarding AI risk alerts.",
    "student_suggestion": "Personalized intervention recommendations generated for students flagged at academic risk.",
    "suggestion_classwork": "Junction linking recommended remedial classwork activities to student intervention plans.",
    "notification": "System notification queue delivering in-app alerts to students, teachers, and administrators.",
    "setting": "Global system configurations, institutional details, grading parameters, and feature toggles."
}

def get_column_description(table_name, col_name):
    # Common column descriptions
    common = {
        "created_at": "Timestamp when this record was originally created in the database.",
        "updated_at": "Timestamp when this record was last modified.",
        "is_active": "Flag indicating whether this record is currently active in the system.",
        "status": "Current operational status of this record.",
        "description": "Descriptive text or explanation for this entity.",
        "user_id": "Foreign key referencing the associated user account.",
        "class_id": "Foreign key referencing the associated class section.",
        "subject_id": "Foreign key referencing the associated subject.",
        "student_id": "Foreign key referencing the learner record.",
        "staff_id": "Foreign key referencing the academic staff record.",
        "academic_year_id": "Foreign key referencing the academic school year.",
        "academic_period_id": "Foreign key referencing the grading period/quarter.",
        "academic_level_id": "Foreign key referencing the academic grade level."
    }
    if col_name in common:
        return common[col_name]
    
    # Context-specific column descriptions
    specific = {
        ("user_account", "password_hash"): "Bcrypt/Argon2 password hash (nullable for invited users pending onboarding).",
        ("user_account", "account_status"): "State of user account: 'active', 'inactive', 'suspended'.",
        ("user_account", "last_login"): "Timestamp of most recent successful user authentication.",
        ("user_account", "email_verified_at"): "Timestamp when user email was verified.",
        
        ("student", "student_lrn"): "12-digit DepEd Learner Reference Number (LRN), unique institutional student ID.",
        ("student", "dob"): "Student date of birth used for demographic analytics and age-grade cohort analysis.",
        ("student", "prior_gwa"): "Prior General Weighted Average (GWA), key baseline feature for AI risk prediction.",
        ("student", "gender"): "Learner gender identity ('Male', 'Female', etc.).",
        
        ("subject_load", "slot_id"): "Foreign key referencing period_template_slot for scheduled timetable slot.",
        ("subject_load", "start_time"): "Daily class meeting start time (e.g., '08:00').",
        ("subject_load", "end_time"): "Daily class meeting end time (e.g., '09:00').",
        ("subject_load", "days_of_week"): "JSON array of meeting days (e.g., ['MON', 'WED', 'FRI']).",
        ("subject_load", "version"): "Schedule version number supporting iterative timetable drafting.",
        ("subject_load", "is_active_version"): "Flag indicating if this version is the published/active class schedule.",
        ("subject_load", "draft_notes"): "Faculty loading notes and planner commentary.",
        ("subject_load", "published_at"): "Timestamp when the subject load schedule was officially published.",
        ("subject_load", "published_by"): "User ID or username of the administrator who published the schedule.",
        ("subject_load", "last_modified_by"): "User ID or username of the last user who edited the load.",
        
        ("classwork", "show_scores"): "Controls whether student scores are immediately visible or withheld until released.",
        ("classwork", "activity_mode"): "Execution mode: 'ONLINE' (digital submission) or 'MANUAL' (physical/in-class).",
        ("classwork", "is_archived"): "Soft-delete flag archiving old or deprecated classwork.",
        ("classwork", "total_points"): "Maximum attainable raw score for this classwork activity.",
        ("classwork", "classwork_type"): "Classification: 'ASSIGNMENT', 'QUIZ', 'ACTIVITY', or 'READING'.",
        
        ("student_submission", "reading_focused_seconds"): "Tracks total active reading viewport time (seconds) for reading assignments.",
        ("student_submission", "score"): "Raw score awarded by teacher or auto-graded by quiz engine.",
        ("student_submission", "submission_status"): "'assigned', 'submitted', 'late', 'graded', 'returned'.",
        
        ("ai_prediction", "risk_label"): "Categorical risk classification: 'Low', 'Moderate', 'High' (At-Risk).",
        ("ai_prediction", "risk_score"): "Continuous probabilistic risk score between 0.0 and 1.0.",
        ("ai_prediction", "confidence"): "Statistical confidence interval/level for the machine learning prediction.",
        ("ai_prediction", "predicted_grade"): "Estimated numerical end-of-period grade calculated by the regression model.",
        
        ("student_period_grade", "initial_grade"): "Weighted raw grade calculated from grading components prior to transmutation.",
        ("student_period_grade", "transmuted_grade"): "Official DepEd transmuted grade based on standard DepEd transmutation tables.",
        ("student_period_grade", "quarterly_grade"): "Final recorded quarterly grade.",
        ("student_period_grade", "is_passed"): "Boolean indicating whether student achieved the passing mark (>= 75)."
    }
    
    if (table_name, col_name) in specific:
        return specific[(table_name, col_name)]
    
    # Generic fallback based on col_name heuristics
    if col_name.endswith("_id") and col_name == f"{table_name}_id":
        return f"Primary key unique identifier for {table_name}."
    if col_name.endswith("_id"):
        ref = col_name[:-3]
        return f"Foreign key reference to {ref}."
    if col_name.startswith("is_"):
        prop = col_name[3:].replace("_", " ")
        return f"Boolean flag indicating whether {prop}."
    if "name" in col_name:
        return f"Name or label for {table_name.replace('_', ' ')}."
    if "date" in col_name:
        return f"Calendar date for {col_name.replace('_', ' ')}."
    if "time" in col_name:
        return f"Time specification for {col_name.replace('_', ' ')}."
    if "json" in col_name or "data" in col_name:
        return f"JSON-structured data payload storing {col_name.replace('_', ' ')}."
    
    return f"Stores {col_name.replace('_', ' ')}."

def generate_markdown():
    tables = Base.metadata.tables
    total_tables = len(tables)
    total_cols = sum(len(t.columns) for t in tables.values())
    
    lines = []
    lines.append("# Entervene — Comprehensive Data Dictionary & Schema Specification")
    lines.append("")
    lines.append("> **System**: Entervene — AI-Enhanced Learning Management System for Student Risk Management & Academic Success  ")
    lines.append(f"> **Generated Date**: {datetime.datetime.now().strftime('%Y-%m-%d')}  ")
    lines.append("> **Database Dialect**: PostgreSQL 15+ (Production) | SQLite 3 (Development / Testing)  ")
    lines.append(f"> **Database Scope**: **{total_tables} Tables** across **12 Functional Domains** | **{total_cols} Documented Attributes**  ")
    lines.append("> **ORM**: SQLAlchemy 2.0 with Alembic Migrations  ")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Table of Contents")
    lines.append("")
    
    for domain, domain_tables in DOMAIN_MAPPING.items():
        domain_anchor = domain.lower().replace(" ", "-").replace("&", "").replace(",", "")
        lines.append(f"- [**{domain}**](#{domain_anchor}) ({len(domain_tables)} tables)")
        for tname in domain_tables:
            if tname in tables:
                lines.append(f"  - [`{tname}`](#table-{tname}) — {TABLE_DESCRIPTIONS.get(tname, '')[:60]}...")
    lines.append("- [**Database Integrity & Schema Audit Log**](#database-integrity--schema-audit-log)")
    lines.append("")
    lines.append("---")
    lines.append("")
    lines.append("## Domain Overview & Entity Metrics")
    lines.append("")
    lines.append("| Domain | Tables | Table Names | Primary Responsibility |")
    lines.append("|---|:---:|---|---|")
    
    for domain, domain_tables in DOMAIN_MAPPING.items():
        t_list = ", ".join([f"`{t}`" for t in domain_tables])
        resp = TABLE_DESCRIPTIONS.get(domain_tables[0], "Domain operations")
        lines.append(f"| **{domain}** | {len(domain_tables)} | {t_list} | {resp[:75]}... |")
        
    lines.append("")
    lines.append("---")
    lines.append("")
    
    # Detailed Table Specifications grouped by Domain
    for domain, domain_tables in DOMAIN_MAPPING.items():
        domain_anchor = domain.lower().replace(" ", "-").replace("&", "").replace(",", "")
        lines.append(f"## {domain}")
        lines.append("")
        
        for tname in domain_tables:
            if tname not in tables:
                continue
            table = tables[tname]
            cols = table.columns
            pk_cols = [c.name for c in cols if c.primary_key]
            
            lines.append(f"### <a id=\"table-{tname}\"></a> Table: `{tname}`")
            lines.append("")
            lines.append(f"**Description**: {TABLE_DESCRIPTIONS.get(tname, 'System operational table.')}")
            lines.append("")
            lines.append(f"- **Primary Key**: `{', '.join(pk_cols)}`")
            lines.append(f"- **Total Attributes**: {len(cols)}")
            
            # Foreign keys list
            fks = []
            for c in cols:
                for fk in c.foreign_keys:
                    on_del = f" ON DELETE {fk.ondelete}" if fk.ondelete else ""
                    fks.append(f"`{c.name}` → `{fk.column.table.name}.{fk.column.name}`{on_del}")
            if fks:
                lines.append(f"- **Foreign Keys**: {'; '.join(fks)}")
            else:
                lines.append("- **Foreign Keys**: None (Root / Independent Entity)")
                
            # Unique Constraints
            u_constraints = []
            for constr in table.constraints:
                if constr.__class__.__name__ == 'UniqueConstraint':
                    u_cols = [c.name for c in constr.columns]
                    u_constraints.append(f"`({', '.join(u_cols)})`")
            if u_constraints:
                lines.append(f"- **Unique Constraints**: {', '.join(u_constraints)}")
                
            lines.append("")
            lines.append("#### Attributes")
            lines.append("")
            lines.append("| Column Name | Data Type | Nullable | Key / Constraint | Default | Description & System Usage |")
            lines.append("|---|---|:---:|:---:|---|---|")
            
            for c in cols:
                # Key tag
                key_tags = []
                if c.primary_key:
                    key_tags.append("**PK**")
                if c.foreign_keys:
                    target = list(c.foreign_keys)[0].column
                    key_tags.append(f"FK → `{target.table.name}.{target.name}`")
                if c.unique:
                    key_tags.append("UNIQUE")
                key_str = ", ".join(key_tags) if key_tags else "-"
                
                null_str = "No" if not c.nullable else "Yes"
                
                # Default
                def_val = "-"
                if c.server_default is not None:
                    def_val = f"`{c.server_default.arg}`"
                elif c.default is not None:
                    if hasattr(c.default, 'arg'):
                        def_val = f"`{c.default.arg}`"
                    else:
                        def_val = f"`{c.default}`"
                        
                desc = get_column_description(tname, c.name)
                
                lines.append(f"| `{c.name}` | `{str(c.type)}` | {null_str} | {key_str} | {def_val} | {desc} |")
                
            lines.append("")
            lines.append("---")
            lines.append("")
            
    # Section on Database Integrity & Schema Audit Log
    lines.append("## Database Integrity & Schema Audit Log")
    lines.append("")
    lines.append("This section summarizes the discrepancies resolved between the original planning schema (`database_schema.txt`), the SQLAlchemy models, and the PostgreSQL/SQLite production database:")
    lines.append("")
    lines.append("### 1. Dropped Dead Items (Cleaned via Alembic Migration `12aa5108d9e8_add_lessonplanmodel.py`)")
    lines.append("The following legacy / prototype schema elements had no functional implementation and were formally dropped from PostgreSQL:")
    lines.append("- **`classwork_allowed_file_type` (Table)**: Prototype table originally intended to restrict submission file extensions. Replaced by application-level MIME-type validation.")
    lines.append("- **`classwork.rubric_id` (Column)**: Deprecated column referencing an unbuilt rubric grading subsystem.")
    lines.append("- **`classwork.cloned_from_classwork_id` (Column)**: Removed prototype self-referential cloning column.")
    lines.append("- **`student.guardian_id` & `student.import_log_id` (Columns)**: Legacy columns without corresponding parent tables.")
    lines.append("- **`student.account_status` (Column)**: Redundant status column eliminated in favor of canonical `user_account.account_status`.")
    lines.append("")
    lines.append("### 2. Corrected Documentation Syntax Errors")
    lines.append("- **`database_schema.txt` line 48-50 Copy-Paste Constraint**: The table `user_account` erroneously contained `CONSTRAINT uq_class_adviser_academic_year UNIQUE (adviser_staff_id, academic_year_id)`. This constraint belongs exclusively to the `class` table.")
    lines.append("")
    lines.append("### 3. Active Column Drift Documented")
    lines.append("- **`subject_load`**: Added 10 modern scheduling columns (`slot_id`, `start_time`, `end_time`, `days_of_week`, `version`, `is_active_version`, `published_at`, `published_by`, `last_modified_by`, `draft_notes`) to power the Subject Load Studio.")
    lines.append("- **`student`**: Added `dob` and `prior_gwa` critical for baseline Machine Learning feature engineering.")
    lines.append("- **`student_submission`**: Added `reading_focused_seconds` to capture real-time learner engagement.")
    lines.append("")
    
    return "\n".join(lines)

if __name__ == "__main__":
    out_path = os.path.abspath(os.path.join(backend_dir, "..", "docs", "DATA_DICTIONARY.md"))
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    content = generate_markdown()
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Successfully generated {out_path} ({len(content)} bytes)")

-- Frozen pre-Alembic core schema from 6c7641d:backend/database_schema.txt.
-- Deliberately excludes sample data. Do not edit after release.

-- ============================================================
-- REQUIRED EXTENSION
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;



-- ============================================================
-- ROLE
-- ============================================================

CREATE TABLE role (
    role_id SMALLINT PRIMARY KEY,
    role_name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);



-- ============================================================
-- USER ACCOUNT
-- ============================================================

CREATE TABLE user_account (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,

    invitation_token VARCHAR(255),

    account_status VARCHAR(50) DEFAULT 'active'
        CHECK (account_status IN ('active', 'inactive', 'suspended')),

    ref_type VARCHAR(50)
        CHECK (ref_type IN ('staff', 'student')),

    ref_id VARCHAR(50),

    last_login TIMESTAMP WITH TIME ZONE,
    email_verified_at TIMESTAMP WITH TIME ZONE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_user_account_ref ON user_account(ref_type, ref_id);
CREATE INDEX idx_user_account_email ON user_account(email);
CREATE INDEX idx_user_account_status ON user_account(account_status);



-- ============================================================
-- USER ROLES
-- ============================================================

CREATE TABLE user_roles (
    user_id UUID NOT NULL
        REFERENCES user_account(user_id)
        ON DELETE CASCADE,

    role_id SMALLINT NOT NULL
        REFERENCES role(role_id)
        ON DELETE CASCADE,

    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (user_id, role_id)
);

CREATE INDEX idx_user_roles_role_id ON user_roles(role_id);



-- ============================================================
-- ACADEMIC YEAR
-- ============================================================

CREATE TABLE academic_year (
    academic_year_id SERIAL PRIMARY KEY,

    year_label VARCHAR(20) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,

    is_active BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_academic_year_active ON academic_year(is_active) WHERE is_active = true;



-- ============================================================
-- ACADEMIC LEVEL
-- ============================================================

CREATE TABLE academic_level (
    academic_level_id SERIAL PRIMARY KEY,

    level_name VARCHAR(100) NOT NULL,
    grade_level INT NOT NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX idx_academic_level_grade ON academic_level(grade_level);
CREATE INDEX idx_academic_level_name ON academic_level(level_name);



-- ============================================================
-- ACADEMIC PERIOD
-- ============================================================

CREATE TABLE academic_period (
    academic_period_id SERIAL PRIMARY KEY,

    period_name VARCHAR(100) NOT NULL,

    period_type VARCHAR(20) NOT NULL
        CHECK (period_type IN ('QUARTER', 'SEMESTER')),

    start_date DATE NOT NULL,
    end_date DATE NOT NULL,

    is_active BOOLEAN DEFAULT FALSE,

    academic_year_id INT NOT NULL
        REFERENCES academic_year(academic_year_id)
        ON DELETE CASCADE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_academic_period_year_active ON academic_period(academic_year_id, is_active);
CREATE INDEX idx_academic_period_dates ON academic_period(start_date, end_date);



-- ============================================================
-- ACADEMIC STAFF
-- ============================================================

CREATE TABLE academic_staff (
    staff_id VARCHAR(20) PRIMARY KEY,

    first_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100),
    last_name VARCHAR(100) NOT NULL,

    dob DATE,
    suffix VARCHAR(10),

    gender VARCHAR(20),

    contact_number VARCHAR(20),

    email VARCHAR(255) UNIQUE,

    address TEXT,

    hired_date DATE,

    employment_status VARCHAR(50),

    user_id UUID UNIQUE
        REFERENCES user_account(user_id)
        ON DELETE SET NULL
);

CREATE INDEX idx_academic_staff_email ON academic_staff(email);
CREATE INDEX idx_academic_staff_names ON academic_staff(last_name, first_name);
CREATE INDEX idx_academic_staff_user_id ON academic_staff(user_id);



-- ============================================================
-- STUDENT
-- ============================================================

CREATE TABLE student (
    student_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    student_lrn CHAR(12) UNIQUE NOT NULL,

    first_name VARCHAR(100) NOT NULL,
    middle_name VARCHAR(100),
    last_name VARCHAR(100) NOT NULL,

    suffix VARCHAR(10),

    gender VARCHAR(20),

    contact_number VARCHAR(20),

    email VARCHAR(255) UNIQUE,

    address TEXT,

    account_status VARCHAR(50) DEFAULT 'active',

    guardian_id UUID,
    academic_level_id INT
        REFERENCES academic_level(academic_level_id),

    import_log_id INTEGER,
    user_id UUID UNIQUE
        REFERENCES user_account(user_id)
        ON DELETE SET NULL,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT lrn_check
    CHECK (student_lrn ~ '^[0-9]{12}$')
);

CREATE INDEX idx_student_lrn ON student(student_lrn);
CREATE INDEX idx_student_email ON student(email);
CREATE INDEX idx_student_user_id ON student(user_id);
CREATE INDEX idx_student_academic_level ON student(academic_level_id);
CREATE INDEX idx_student_account_status ON student(account_status);
CREATE INDEX idx_student_names ON student(last_name, first_name, middle_name);



-- ============================================================
-- SUBJECT
-- ============================================================

CREATE TABLE subject (
    subject_id SERIAL PRIMARY KEY,

    subject_name VARCHAR(150) NOT NULL,

    subject_codename VARCHAR(50),

    description TEXT,

    status VARCHAR(20) DEFAULT 'active',

    academic_level_id INT NOT NULL
        REFERENCES academic_level(academic_level_id),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_subject_academic_level ON subject(academic_level_id);
CREATE INDEX idx_subject_status ON subject(status);
CREATE INDEX idx_subject_codename ON subject(subject_codename);



-- ============================================================
-- CLASS
-- ============================================================

CREATE TABLE class (
    class_id SERIAL PRIMARY KEY,

    section_name VARCHAR(100) NOT NULL,

    class_status VARCHAR(20) DEFAULT 'active',

    adviser_staff_id VARCHAR(20)
        REFERENCES academic_staff(staff_id)
        ON DELETE SET NULL,

    academic_year_id INT NOT NULL
        REFERENCES academic_year(academic_year_id),

    academic_level_id INT NOT NULL
        REFERENCES academic_level(academic_level_id),

    academic_period_id INT
        REFERENCES academic_period(academic_period_id),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_class_adviser ON class(adviser_staff_id);
CREATE INDEX idx_class_academic_year ON class(academic_year_id);
CREATE INDEX idx_class_academic_level ON class(academic_level_id);
CREATE INDEX idx_class_academic_period ON class(academic_period_id);
CREATE INDEX idx_class_status ON class(class_status);
CREATE INDEX idx_class_year_level ON class(academic_year_id, academic_level_id);



-- ============================================================
-- SUBJECT LOAD
-- ============================================================

CREATE TABLE subject_load (
    subject_load_id SERIAL PRIMARY KEY,

    staff_id VARCHAR(20) NOT NULL
        REFERENCES academic_staff(staff_id),

    subject_id INT NOT NULL
        REFERENCES subject(subject_id),

    class_id INT NOT NULL
        REFERENCES class(class_id),

    academic_period_id INT NOT NULL
        REFERENCES academic_period(academic_period_id),

    status VARCHAR(20) DEFAULT 'active',

    is_locked BOOLEAN DEFAULT FALSE,

    locked_at TIMESTAMP WITH TIME ZONE,

    continued_from_load_id INT
        REFERENCES subject_load(subject_load_id),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (
        staff_id,
        subject_id,
        class_id,
        academic_period_id
    )
);

CREATE INDEX idx_subject_load_staff ON subject_load(staff_id);
CREATE INDEX idx_subject_load_subject ON subject_load(subject_id);
CREATE INDEX idx_subject_load_class ON subject_load(class_id);
CREATE INDEX idx_subject_load_period ON subject_load(academic_period_id);
CREATE INDEX idx_subject_load_status ON subject_load(status);
CREATE INDEX idx_subject_load_continued ON subject_load(continued_from_load_id);



-- ============================================================
-- STUDENT CLASS
-- ============================================================

CREATE TABLE student_class (
    student_class_id SERIAL PRIMARY KEY,

    student_id UUID NOT NULL
        REFERENCES student(student_id)
        ON DELETE CASCADE,

    class_id INT NOT NULL
        REFERENCES class(class_id)
        ON DELETE CASCADE,

    enrollment_status VARCHAR(20) DEFAULT 'enrolled'
        CHECK (
            enrollment_status IN (
                'enrolled',
                'dropped',
                'completed'
            )
        ),

    enrolled_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (student_id, class_id)
);

CREATE INDEX idx_student_class_student ON student_class(student_id);
CREATE INDEX idx_student_class_class ON student_class(class_id);
CREATE INDEX idx_student_class_status ON student_class(enrollment_status);
CREATE INDEX idx_student_class_enrolled ON student_class(enrolled_at);



-- ============================================================
-- LESSON
-- ============================================================

CREATE TABLE lesson (
    lesson_id SERIAL PRIMARY KEY,

    title VARCHAR(255) NOT NULL,

    description TEXT,

    content TEXT,

    order_index INT DEFAULT 1,

    is_published BOOLEAN DEFAULT FALSE,

    is_locked BOOLEAN DEFAULT FALSE,

    created_by_staff_id VARCHAR(20)
        REFERENCES academic_staff(staff_id)
        ON DELETE SET NULL,

    subject_id INT NOT NULL
        REFERENCES subject(subject_id)
        ON DELETE CASCADE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    is_draft BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_lesson_subject ON lesson(subject_id);
CREATE INDEX idx_lesson_created_by ON lesson(created_by_staff_id);
CREATE INDEX idx_lesson_published ON lesson(is_published) WHERE is_published = true;
CREATE INDEX idx_lesson_draft ON lesson(is_draft) WHERE is_draft = true;
CREATE INDEX idx_lesson_order ON lesson(subject_id, order_index);



-- ============================================================
-- LESSON ATTACHMENT
-- ============================================================

CREATE TABLE lesson_attachment (
    lesson_attachment_id SERIAL PRIMARY KEY,

    lesson_id INT NOT NULL
        REFERENCES lesson(lesson_id)
        ON DELETE CASCADE,

    file_name VARCHAR(255) NOT NULL,

    file_path TEXT NOT NULL,

    file_type VARCHAR(100),

    file_size BIGINT NOT NULL,

    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT lesson_attachment_size_check
    CHECK (file_size <= 4194304)
);

CREATE INDEX idx_lesson_attachment_lesson ON lesson_attachment(lesson_id);
CREATE INDEX idx_lesson_attachment_uploaded ON lesson_attachment(uploaded_at);



-- ============================================================
-- LESSON ASSIGNMENT
-- ============================================================

CREATE TABLE lesson_assignment (
    lesson_assignment_id SERIAL PRIMARY KEY,

    lesson_id INT NOT NULL
        REFERENCES lesson(lesson_id)
        ON DELETE CASCADE,

    class_id INT NOT NULL
        REFERENCES class(class_id)
        ON DELETE CASCADE,

    assigned_by_staff_id VARCHAR(20)
        REFERENCES academic_staff(staff_id)
        ON DELETE SET NULL,

    publish_date TIMESTAMP WITH TIME ZONE,

    is_published BOOLEAN DEFAULT FALSE,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (lesson_id, class_id)
);

CREATE INDEX idx_lesson_assignment_lesson ON lesson_assignment(lesson_id);
CREATE INDEX idx_lesson_assignment_class ON lesson_assignment(class_id);
CREATE INDEX idx_lesson_assignment_assigned_by ON lesson_assignment(assigned_by_staff_id);
CREATE INDEX idx_lesson_assignment_published ON lesson_assignment(is_published, publish_date);



-- ============================================================
-- CLASSWORK
-- ============================================================

CREATE TABLE classwork (
    classwork_id SERIAL PRIMARY KEY,

    title VARCHAR(255) NOT NULL,

    description TEXT,

    instructions TEXT,

    classwork_type VARCHAR(50) NOT NULL
        CHECK (
            classwork_type IN (
                'QUIZ',
                'ASSIGNMENT',
                'ACTIVITY'
            )
        ),

    classwork_category VARCHAR(50)
        CHECK (
            classwork_category IN (
                'WRITTEN_WORK',
                'PERFORMANCE_TASK',
                'PERIODICAL_EXAM'
            )
        ),

    total_points DECIMAL(8,2) DEFAULT 100,

    is_locked BOOLEAN DEFAULT FALSE,

    is_published BOOLEAN DEFAULT FALSE,

    subject_id INT NOT NULL
        REFERENCES subject(subject_id),

    created_by_staff_id VARCHAR(20) NOT NULL
        REFERENCES academic_staff(staff_id),

    rubric_id INTEGER,
    cloned_from_classwork_id INTEGER
        REFERENCES classwork(classwork_id),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_classwork_subject ON classwork(subject_id);
CREATE INDEX idx_classwork_created_by ON classwork(created_by_staff_id);
CREATE INDEX idx_classwork_cloned_from ON classwork(cloned_from_classwork_id);
CREATE INDEX idx_classwork_published ON classwork(is_published) WHERE is_published = true;
CREATE INDEX idx_classwork_type_category ON classwork(classwork_type, classwork_category);



-- ============================================================
-- CLASSWORK ASSIGNMENT
-- ============================================================

CREATE TABLE classwork_assignment (
    classwork_assignment_id SERIAL PRIMARY KEY,

    classwork_id INT NOT NULL
        REFERENCES classwork(classwork_id)
        ON DELETE CASCADE,

    class_id INT NOT NULL
        REFERENCES class(class_id)
        ON DELETE CASCADE,

    assigned_by_staff_id VARCHAR(20) NOT NULL
        REFERENCES academic_staff(staff_id),

    publish_date TIMESTAMP WITH TIME ZONE,

    due_date TIMESTAMP WITH TIME ZONE,

    lock_date TIMESTAMP WITH TIME ZONE,

    is_published BOOLEAN DEFAULT FALSE,

    is_locked BOOLEAN DEFAULT FALSE,

    max_attempts INT DEFAULT 1,

    assigned_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    UNIQUE (classwork_id, class_id)
);

CREATE INDEX idx_classwork_assignment_classwork ON classwork_assignment(classwork_id);
CREATE INDEX idx_classwork_assignment_class ON classwork_assignment(class_id);
CREATE INDEX idx_classwork_assignment_assigned_by ON classwork_assignment(assigned_by_staff_id);
CREATE INDEX idx_classwork_assignment_dates ON classwork_assignment(publish_date, due_date, lock_date);
CREATE INDEX idx_classwork_assignment_published ON classwork_assignment(is_published, publish_date);



-- ============================================================
-- CLASSWORK ATTACHMENT
-- ============================================================

CREATE TABLE classwork_attachment (
    classwork_attachment_id SERIAL PRIMARY KEY,

    classwork_id INT NOT NULL
        REFERENCES classwork(classwork_id)
        ON DELETE CASCADE,

    file_name VARCHAR(255) NOT NULL,

    file_path TEXT NOT NULL,

    file_type VARCHAR(100),

    file_size BIGINT NOT NULL,

    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT classwork_attachment_size_check
    CHECK (file_size <= 4194304)
);

CREATE INDEX idx_classwork_attachment_classwork ON classwork_attachment(classwork_id);
CREATE INDEX idx_classwork_attachment_uploaded ON classwork_attachment(uploaded_at);



-- ============================================================
-- CLASSWORK ALLOWED FILE TYPES
-- ============================================================

CREATE TABLE classwork_allowed_file_type (
    allowed_type_id SERIAL PRIMARY KEY,

    classwork_id INT NOT NULL
        REFERENCES classwork(classwork_id)
        ON DELETE CASCADE,

    file_type_label VARCHAR(100),

    extensions VARCHAR(255)
);

CREATE INDEX idx_classwork_allowed_types_classwork ON classwork_allowed_file_type(classwork_id);



-- ============================================================
-- CLASSWORK LESSON (Junction Table)
-- ============================================================

CREATE TABLE classwork_lesson (
    classwork_id INTEGER NOT NULL
        REFERENCES classwork(classwork_id)
        ON DELETE CASCADE,
    
    lesson_id INTEGER NOT NULL
        REFERENCES lesson(lesson_id)
        ON DELETE CASCADE,
    
    PRIMARY KEY (classwork_id, lesson_id)
);

CREATE INDEX idx_classwork_lesson_lesson ON classwork_lesson(lesson_id);
CREATE INDEX idx_classwork_lesson_classwork ON classwork_lesson(classwork_id);



-- ============================================================
-- STUDENT SUBMISSION
-- ============================================================

CREATE TABLE student_submission (
    submission_id SERIAL PRIMARY KEY,

    student_id UUID NOT NULL
        REFERENCES student(student_id)
        ON DELETE CASCADE,

    classwork_assignment_id INT NOT NULL
        REFERENCES classwork_assignment(classwork_assignment_id)
        ON DELETE CASCADE,

    submitted_at TIMESTAMP WITH TIME ZONE,

    status VARCHAR(30) DEFAULT 'pending'
        CHECK (
            status IN (
                'pending',
                'submitted',
                'graded',
                'late',
                'missed'
            )
        ),

    grade DECIMAL(8,2),

    feedback TEXT,

    attempt_count INT DEFAULT 0,

    graded_at TIMESTAMP WITH TIME ZONE,

    graded_by_staff_id VARCHAR(20)
        REFERENCES academic_staff(staff_id),

    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_student_submission_student ON student_submission(student_id);
CREATE INDEX idx_student_submission_assignment ON student_submission(classwork_assignment_id);
CREATE INDEX idx_student_submission_status ON student_submission(status);
CREATE INDEX idx_student_submission_graded_by ON student_submission(graded_by_staff_id);
CREATE INDEX idx_student_submission_submitted ON student_submission(submitted_at);
CREATE INDEX idx_student_submission_student_assignment ON student_submission(student_id, classwork_assignment_id);



-- ============================================================
-- SUBMISSION ATTACHMENT
-- ============================================================

CREATE TABLE submission_attachment (
    submission_attachment_id SERIAL PRIMARY KEY,

    submission_id INT NOT NULL
        REFERENCES student_submission(submission_id)
        ON DELETE CASCADE,

    file_name VARCHAR(255) NOT NULL,

    file_path TEXT NOT NULL,

    file_type VARCHAR(100),

    file_size BIGINT NOT NULL,

    uploaded_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT submission_attachment_size_check
    CHECK (file_size <= 4194304)
);

CREATE INDEX idx_submission_attachment_submission ON submission_attachment(submission_id);
CREATE INDEX idx_submission_attachment_uploaded ON submission_attachment(uploaded_at);



-- ============================================================
-- USER LOGIN LOG
-- ============================================================

CREATE TABLE user_login_log (
    login_id SERIAL PRIMARY KEY,

    user_id UUID
        REFERENCES user_account(user_id)
        ON DELETE CASCADE,

    login_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,

    logout_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX idx_user_login_log_user ON user_login_log(user_id);
CREATE INDEX idx_user_login_log_login_at ON user_login_log(login_at);
CREATE INDEX idx_user_login_log_logout ON user_login_log(logout_at) WHERE logout_at IS NOT NULL;



-- ============================================================

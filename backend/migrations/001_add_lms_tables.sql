-- ============================================================
-- Migration: Add LMS MVP tables
-- Run this AFTER your existing tables are in place.
-- This only adds NEW tables that don't exist yet.
-- ============================================================

-- Lesson tables
CREATE TABLE IF NOT EXISTS lesson (
    lesson_id           SERIAL PRIMARY KEY,
    title               VARCHAR(255) NOT NULL,
    description         TEXT,
    content             TEXT,
    order_index         INTEGER DEFAULT 1,
    is_published        BOOLEAN DEFAULT FALSE,
    is_locked           BOOLEAN DEFAULT FALSE,
    created_by_staff_id VARCHAR(20) REFERENCES academic_staff(staff_id) ON DELETE SET NULL,
    subject_id          INTEGER NOT NULL REFERENCES subject(subject_id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lesson_attachment (
    lesson_attachment_id SERIAL PRIMARY KEY,
    lesson_id            INTEGER NOT NULL REFERENCES lesson(lesson_id) ON DELETE CASCADE,
    file_name            VARCHAR(255) NOT NULL,
    file_path            TEXT NOT NULL,
    file_type            VARCHAR(100),
    file_size            BIGINT NOT NULL,
    uploaded_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lesson_assignment (
    lesson_assignment_id SERIAL PRIMARY KEY,
    lesson_id            INTEGER NOT NULL REFERENCES lesson(lesson_id) ON DELETE CASCADE,
    class_id             INTEGER NOT NULL REFERENCES class(class_id) ON DELETE CASCADE,
    assigned_by_staff_id VARCHAR(20) REFERENCES academic_staff(staff_id) ON DELETE SET NULL,
    publish_date         TIMESTAMPTZ,
    is_published         BOOLEAN DEFAULT FALSE,
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(lesson_id, class_id)
);

-- Classwork tables
CREATE TABLE IF NOT EXISTS classwork (
    classwork_id         SERIAL PRIMARY KEY,
    title                VARCHAR(255) NOT NULL,
    description          TEXT,
    instructions         TEXT,
    classwork_type       VARCHAR(50) NOT NULL,
    classwork_category   VARCHAR(50),
    total_points         NUMERIC(8,2) DEFAULT 100,
    is_locked            BOOLEAN DEFAULT FALSE,
    is_published         BOOLEAN DEFAULT FALSE,
    subject_id           INTEGER NOT NULL REFERENCES subject(subject_id),
    created_by_staff_id  VARCHAR(20) NOT NULL REFERENCES academic_staff(staff_id),
    created_at           TIMESTAMPTZ DEFAULT NOW(),
    updated_at           TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classwork_attachment (
    classwork_attachment_id SERIAL PRIMARY KEY,
    classwork_id            INTEGER NOT NULL REFERENCES classwork(classwork_id) ON DELETE CASCADE,
    file_name               VARCHAR(255) NOT NULL,
    file_path               TEXT NOT NULL,
    file_type               VARCHAR(100),
    file_size               BIGINT NOT NULL,
    uploaded_at             TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS classwork_assignment (
    classwork_assignment_id SERIAL PRIMARY KEY,
    classwork_id            INTEGER NOT NULL REFERENCES classwork(classwork_id) ON DELETE CASCADE,
    class_id                INTEGER NOT NULL REFERENCES class(class_id) ON DELETE CASCADE,
    assigned_by_staff_id    VARCHAR(20) NOT NULL REFERENCES academic_staff(staff_id),
    publish_date            TIMESTAMPTZ,
    due_date                TIMESTAMPTZ,
    lock_date               TIMESTAMPTZ,
    is_published            BOOLEAN DEFAULT FALSE,
    is_locked               BOOLEAN DEFAULT FALSE,
    max_attempts            INTEGER DEFAULT 1,
    assigned_at             TIMESTAMPTZ DEFAULT NOW(),
    created_at              TIMESTAMPTZ DEFAULT NOW(),
    updated_at              TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(classwork_id, class_id)
);

-- Submission tables
CREATE TABLE IF NOT EXISTS student_submission (
    submission_id            SERIAL PRIMARY KEY,
    student_id               UUID NOT NULL REFERENCES student(student_id) ON DELETE CASCADE,
    classwork_assignment_id  INTEGER NOT NULL REFERENCES classwork_assignment(classwork_assignment_id) ON DELETE CASCADE,
    submitted_at             TIMESTAMPTZ,
    status                   VARCHAR(30) DEFAULT 'pending',
    grade                    NUMERIC(8,2),
    feedback                 TEXT,
    attempt_count            INTEGER DEFAULT 0,
    graded_at                TIMESTAMPTZ,
    graded_by_staff_id       VARCHAR(20) REFERENCES academic_staff(staff_id),
    created_at               TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS submission_attachment (
    submission_attachment_id SERIAL PRIMARY KEY,
    submission_id            INTEGER NOT NULL REFERENCES student_submission(submission_id) ON DELETE CASCADE,
    file_name                VARCHAR(255) NOT NULL,
    file_path                TEXT NOT NULL,
    file_type                VARCHAR(100),
    file_size                BIGINT NOT NULL,
    uploaded_at              TIMESTAMPTZ DEFAULT NOW()
);

-- Done!
SELECT 'LMS MVP tables created successfully!' AS result;

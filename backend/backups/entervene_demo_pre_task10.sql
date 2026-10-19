--
-- PostgreSQL database dump
--

\restrict LJoKH6d5ZEmRqMWjcu3wQYCFJvjodJ8Z2tc8fbEOKViN2OnJOHfur9nbldeOVDO

-- Dumped from database version 18.1
-- Dumped by pg_dump version 18.1

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: setting_type_enum; Type: TYPE; Schema: public; Owner: postgres
--

CREATE TYPE public.setting_type_enum AS ENUM (
    'STRING',
    'BOOLEAN',
    'INTEGER',
    'JSON'
);


ALTER TYPE public.setting_type_enum OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: academic_level; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.academic_level (
    academic_level_id integer NOT NULL,
    level_name character varying(100) NOT NULL,
    grade_level integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.academic_level OWNER TO postgres;

--
-- Name: academic_level_academic_level_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.academic_level_academic_level_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.academic_level_academic_level_id_seq OWNER TO postgres;

--
-- Name: academic_level_academic_level_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.academic_level_academic_level_id_seq OWNED BY public.academic_level.academic_level_id;


--
-- Name: academic_level_pathway_scope; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.academic_level_pathway_scope (
    id integer NOT NULL,
    academic_year_id integer NOT NULL,
    academic_level_id integer NOT NULL,
    requires_pathway boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.academic_level_pathway_scope OWNER TO postgres;

--
-- Name: academic_level_pathway_scope_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.academic_level_pathway_scope_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.academic_level_pathway_scope_id_seq OWNER TO postgres;

--
-- Name: academic_level_pathway_scope_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.academic_level_pathway_scope_id_seq OWNED BY public.academic_level_pathway_scope.id;


--
-- Name: academic_pathway; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.academic_pathway (
    id integer NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(150) NOT NULL,
    is_enabled boolean NOT NULL,
    sort_order integer NOT NULL,
    deped_cluster_id integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.academic_pathway OWNER TO postgres;

--
-- Name: academic_pathway_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.academic_pathway_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.academic_pathway_id_seq OWNER TO postgres;

--
-- Name: academic_pathway_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.academic_pathway_id_seq OWNED BY public.academic_pathway.id;


--
-- Name: academic_period; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.academic_period (
    academic_period_id integer NOT NULL,
    period_name character varying(100) NOT NULL,
    period_type character varying(20) NOT NULL,
    period_sequence integer NOT NULL,
    total_periods_in_year integer NOT NULL,
    period_progress_ratio numeric(6,4) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    is_active boolean NOT NULL,
    academic_year_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_academic_period_period_type CHECK (((period_type)::text = ANY ((ARRAY['QUARTER'::character varying, 'TERM'::character varying, 'SEMESTER'::character varying])::text[]))),
    CONSTRAINT ck_academic_period_progress_ratio CHECK ((period_progress_ratio = round((((period_sequence)::numeric * 1.0) / (total_periods_in_year)::numeric), 4))),
    CONSTRAINT ck_academic_period_sequence_positive CHECK ((period_sequence > 0)),
    CONSTRAINT ck_academic_period_total_positive CHECK ((total_periods_in_year > 0))
);


ALTER TABLE public.academic_period OWNER TO postgres;

--
-- Name: academic_period_academic_period_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.academic_period_academic_period_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.academic_period_academic_period_id_seq OWNER TO postgres;

--
-- Name: academic_period_academic_period_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.academic_period_academic_period_id_seq OWNED BY public.academic_period.academic_period_id;


--
-- Name: academic_staff; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.academic_staff (
    staff_id character varying(20) NOT NULL,
    first_name character varying(100) NOT NULL,
    middle_name character varying(100),
    last_name character varying(100) NOT NULL,
    dob date,
    suffix character varying(10),
    gender character varying(20),
    contact_number character varying(20),
    email character varying(255),
    address text,
    hired_date date,
    employment_status character varying(50),
    user_id uuid
);


ALTER TABLE public.academic_staff OWNER TO postgres;

--
-- Name: academic_year; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.academic_year (
    academic_year_id integer NOT NULL,
    year_label character varying(20) NOT NULL,
    start_date date NOT NULL,
    end_date date NOT NULL,
    is_active boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.academic_year OWNER TO postgres;

--
-- Name: academic_year_academic_year_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.academic_year_academic_year_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.academic_year_academic_year_id_seq OWNER TO postgres;

--
-- Name: academic_year_academic_year_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.academic_year_academic_year_id_seq OWNED BY public.academic_year.academic_year_id;


--
-- Name: activity_rubric_level; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.activity_rubric_level (
    rubric_level_id integer NOT NULL,
    classwork_id integer NOT NULL,
    level_name character varying(100) NOT NULL,
    description text NOT NULL,
    points numeric(8,2) NOT NULL,
    display_order integer NOT NULL
);


ALTER TABLE public.activity_rubric_level OWNER TO postgres;

--
-- Name: activity_rubric_level_rubric_level_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.activity_rubric_level_rubric_level_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.activity_rubric_level_rubric_level_id_seq OWNER TO postgres;

--
-- Name: activity_rubric_level_rubric_level_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.activity_rubric_level_rubric_level_id_seq OWNED BY public.activity_rubric_level.rubric_level_id;


--
-- Name: ai_model_version; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_model_version (
    model_version_id integer NOT NULL,
    model_name character varying(150) NOT NULL,
    model_type character varying(30) NOT NULL,
    model_purpose character varying(64) NOT NULL,
    algorithm character varying(150) NOT NULL,
    target_column character varying(150),
    lifecycle_status character varying(20) DEFAULT 'DEVELOPMENT'::character varying NOT NULL,
    production_validated boolean DEFAULT false NOT NULL,
    independent_three_term_validation boolean DEFAULT false NOT NULL,
    registry_metadata_json json,
    trained_at timestamp with time zone DEFAULT now(),
    training_row_count integer,
    test_row_count integer,
    mae numeric(10,4),
    rmse numeric(10,4),
    r2_score numeric(10,4),
    feature_schema_json json,
    artifact_path character varying(500),
    is_active boolean NOT NULL,
    CONSTRAINT ck_ai_model_version_lifecycle_status CHECK (((lifecycle_status)::text = ANY ((ARRAY['DEVELOPMENT'::character varying, 'CANDIDATE'::character varying, 'PRODUCTION'::character varying, 'ARCHIVED'::character varying])::text[]))),
    CONSTRAINT ck_ai_model_version_model_purpose CHECK (((model_purpose)::text = ANY ((ARRAY['NEXT_PERIOD_BASELINE_FORECAST'::character varying, 'CURRENT_PERIOD_FINAL_GRADE_PROJECTION'::character varying, 'UNIFIED_CURRENT_TERM_PROJECTION'::character varying, 'CURRENT_TERM_FINAL_GRADE_PROJECTION'::character varying])::text[]))),
    CONSTRAINT ck_ai_model_version_model_type CHECK (((model_type)::text = ANY ((ARRAY['REGRESSOR'::character varying, 'CLASSIFIER'::character varying, 'ANOMALY'::character varying])::text[])))
);


ALTER TABLE public.ai_model_version OWNER TO postgres;

--
-- Name: ai_model_version_model_version_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ai_model_version_model_version_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ai_model_version_model_version_id_seq OWNER TO postgres;

--
-- Name: ai_model_version_model_version_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ai_model_version_model_version_id_seq OWNED BY public.ai_model_version.model_version_id;


--
-- Name: ai_prediction; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_prediction (
    prediction_id integer NOT NULL,
    student_id uuid NOT NULL,
    class_id integer NOT NULL,
    subject_id integer NOT NULL,
    source_period_id integer NOT NULL,
    target_period_id integer NOT NULL,
    predicted_period_grade numeric(6,2),
    risk_score numeric(8,4),
    risk_level character varying(30),
    data_status character varying(30),
    intervention_level character varying(30),
    intervention_basis character varying(80),
    revision integer DEFAULT 1 NOT NULL,
    risk_assessment_status character varying(60) DEFAULT 'EVALUATED'::character varying NOT NULL,
    model_version_id integer,
    evidence_snapshot json,
    generation_request_id character varying(100),
    generated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ck_ai_prediction_data_status CHECK (((data_status)::text = ANY ((ARRAY['SUFFICIENT'::character varying, 'INSUFFICIENT_DATA'::character varying, 'COLD_START'::character varying])::text[]))),
    CONSTRAINT ck_ai_prediction_intervention_level CHECK (((intervention_level IS NULL) OR ((intervention_level)::text = ANY ((ARRAY['LOW_RISK'::character varying, 'NEEDS_MONITORING'::character varying, 'MODERATE_RISK'::character varying, 'HIGH_RISK'::character varying])::text[])))),
    CONSTRAINT ck_ai_prediction_revision_positive CHECK ((revision > 0)),
    CONSTRAINT ck_ai_prediction_risk_assessment_status CHECK (((risk_assessment_status)::text = ANY ((ARRAY['EVALUATED'::character varying, 'NOT_EVALUATED_FOR_CURRENT_PERIOD_MODEL'::character varying, 'NOT_EVALUATED_FOR_UNIFIED_MODEL'::character varying, 'INSUFFICIENT_RISK_EVIDENCE'::character varying])::text[]))),
    CONSTRAINT ck_ai_prediction_risk_level CHECK (((risk_level)::text = ANY ((ARRAY['LOW_RISK'::character varying, 'NEEDS_MONITORING'::character varying, 'MODERATE_RISK'::character varying, 'HIGH_RISK'::character varying, 'INSUFFICIENT_DATA'::character varying])::text[])))
);


ALTER TABLE public.ai_prediction OWNER TO postgres;

--
-- Name: ai_prediction_feature; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.ai_prediction_feature (
    feature_id integer NOT NULL,
    prediction_id integer NOT NULL,
    feature_name character varying(150) NOT NULL,
    feature_value numeric(12,4),
    feature_contribution numeric(12,6),
    direction character varying(30) NOT NULL,
    feature_rank integer,
    explanation_method character varying(30) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ck_ai_prediction_feature_direction CHECK (((direction)::text = ANY ((ARRAY['INCREASES_RISK'::character varying, 'DECREASES_RISK'::character varying, 'NEUTRAL'::character varying])::text[]))),
    CONSTRAINT ck_ai_prediction_feature_explanation_method CHECK (((explanation_method)::text = ANY ((ARRAY['RULE'::character varying, 'PERMUTATION'::character varying, 'SHAP'::character varying, 'OTHER'::character varying])::text[])))
);


ALTER TABLE public.ai_prediction_feature OWNER TO postgres;

--
-- Name: ai_prediction_feature_feature_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ai_prediction_feature_feature_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ai_prediction_feature_feature_id_seq OWNER TO postgres;

--
-- Name: ai_prediction_feature_feature_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ai_prediction_feature_feature_id_seq OWNED BY public.ai_prediction_feature.feature_id;


--
-- Name: ai_prediction_prediction_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.ai_prediction_prediction_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.ai_prediction_prediction_id_seq OWNER TO postgres;

--
-- Name: ai_prediction_prediction_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.ai_prediction_prediction_id_seq OWNED BY public.ai_prediction.prediction_id;


--
-- Name: alembic_version; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.alembic_version (
    version_num character varying(64) NOT NULL
);


ALTER TABLE public.alembic_version OWNER TO postgres;

--
-- Name: api_usage_counter; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.api_usage_counter (
    scope character varying(100) NOT NULL,
    period character varying(80) NOT NULL,
    used integer NOT NULL
);


ALTER TABLE public.api_usage_counter OWNER TO postgres;

--
-- Name: assessment_item; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.assessment_item (
    assessment_id integer NOT NULL,
    class_id integer NOT NULL,
    subject_id integer NOT NULL,
    academic_period_id integer NOT NULL,
    component_type character varying(40) NOT NULL,
    item_number integer NOT NULL,
    max_score numeric(8,2) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    entered_by_staff_id character varying(20),
    CONSTRAINT ck_assessment_item_component_type CHECK (((component_type)::text = ANY ((ARRAY['WRITTEN_WORK'::character varying, 'PERFORMANCE_TASK'::character varying, 'QUARTERLY_ASSESSMENT'::character varying])::text[]))),
    CONSTRAINT ck_assessment_item_max_score_positive CHECK ((max_score > (0)::numeric))
);


ALTER TABLE public.assessment_item OWNER TO postgres;

--
-- Name: assessment_item_assessment_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.assessment_item_assessment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.assessment_item_assessment_id_seq OWNER TO postgres;

--
-- Name: assessment_item_assessment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.assessment_item_assessment_id_seq OWNED BY public.assessment_item.assessment_id;


--
-- Name: attendance_record; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.attendance_record (
    attendance_id integer NOT NULL,
    student_id uuid NOT NULL,
    class_id integer NOT NULL,
    subject_id integer,
    date date NOT NULL,
    status character varying(20) NOT NULL,
    remarks text,
    recorded_by_staff_id character varying(20),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.attendance_record OWNER TO postgres;

--
-- Name: attendance_record_attendance_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.attendance_record_attendance_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.attendance_record_attendance_id_seq OWNER TO postgres;

--
-- Name: attendance_record_attendance_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.attendance_record_attendance_id_seq OWNED BY public.attendance_record.attendance_id;


--
-- Name: class; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.class (
    class_id integer NOT NULL,
    section_name character varying(100) NOT NULL,
    class_status character varying(20) NOT NULL,
    adviser_staff_id character varying(20),
    academic_year_id integer NOT NULL,
    academic_level_id integer NOT NULL,
    academic_period_id integer,
    pathway_id integer,
    paired_class_id integer,
    period_template_group character varying(50),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.class OWNER TO postgres;

--
-- Name: class_class_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.class_class_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.class_class_id_seq OWNER TO postgres;

--
-- Name: class_class_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.class_class_id_seq OWNED BY public.class.class_id;


--
-- Name: classwork; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.classwork (
    classwork_id integer NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    instructions text,
    classwork_type character varying(50) NOT NULL,
    classwork_category character varying(50),
    exam_subtype character varying(50),
    activity_mode character varying(20) DEFAULT 'ONLINE'::character varying NOT NULL,
    is_graded boolean DEFAULT true NOT NULL,
    total_points numeric(8,2),
    is_locked boolean NOT NULL,
    is_published boolean NOT NULL,
    show_scores boolean DEFAULT true NOT NULL,
    is_archived boolean NOT NULL,
    subject_id integer NOT NULL,
    created_by_staff_id character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.classwork OWNER TO postgres;

--
-- Name: classwork_assignment; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.classwork_assignment (
    classwork_assignment_id integer NOT NULL,
    classwork_id integer NOT NULL,
    class_id integer NOT NULL,
    academic_period_id integer,
    assigned_by_staff_id character varying(20) NOT NULL,
    publish_date timestamp with time zone,
    due_date timestamp with time zone,
    lock_date timestamp with time zone,
    is_published boolean,
    is_locked boolean,
    allow_late_submissions boolean NOT NULL,
    max_attempts integer,
    assigned_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    recipient_student_id uuid,
    source_intervention_id integer,
    remediation_request_id uuid,
    original_exam_assignment_id integer,
    CONSTRAINT ck_classwork_targeted_pair CHECK ((((recipient_student_id IS NULL) AND (source_intervention_id IS NULL) AND (remediation_request_id IS NULL)) OR ((recipient_student_id IS NOT NULL) AND (source_intervention_id IS NOT NULL) AND (remediation_request_id IS NOT NULL)))),
    CONSTRAINT ck_remedial_exam_has_target CHECK (((original_exam_assignment_id IS NULL) OR ((recipient_student_id IS NOT NULL) AND (original_exam_assignment_id <> classwork_assignment_id))))
);


ALTER TABLE public.classwork_assignment OWNER TO postgres;

--
-- Name: classwork_assignment_classwork_assignment_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.classwork_assignment_classwork_assignment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.classwork_assignment_classwork_assignment_id_seq OWNER TO postgres;

--
-- Name: classwork_assignment_classwork_assignment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.classwork_assignment_classwork_assignment_id_seq OWNED BY public.classwork_assignment.classwork_assignment_id;


--
-- Name: classwork_attachment; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.classwork_attachment (
    classwork_attachment_id integer NOT NULL,
    classwork_id integer NOT NULL,
    file_name character varying(255) NOT NULL,
    file_path text NOT NULL,
    file_type character varying(100),
    file_size bigint NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.classwork_attachment OWNER TO postgres;

--
-- Name: classwork_attachment_classwork_attachment_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.classwork_attachment_classwork_attachment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.classwork_attachment_classwork_attachment_id_seq OWNER TO postgres;

--
-- Name: classwork_attachment_classwork_attachment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.classwork_attachment_classwork_attachment_id_seq OWNED BY public.classwork_attachment.classwork_attachment_id;


--
-- Name: classwork_classwork_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.classwork_classwork_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.classwork_classwork_id_seq OWNER TO postgres;

--
-- Name: classwork_classwork_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.classwork_classwork_id_seq OWNED BY public.classwork.classwork_id;


--
-- Name: classwork_coverage; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.classwork_coverage (
    coverage_id integer NOT NULL,
    classwork_id integer NOT NULL,
    lesson_id integer,
    competency_id integer,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    linked_by_staff_id character varying(20),
    valid_until timestamp with time zone,
    removed_by_staff_id character varying(20),
    CONSTRAINT ck_classwork_coverage_interval CHECK (((valid_until IS NULL) OR (valid_until >= valid_from))),
    CONSTRAINT ck_classwork_coverage_target CHECK (((lesson_id IS NOT NULL) OR (competency_id IS NOT NULL)))
);


ALTER TABLE public.classwork_coverage OWNER TO postgres;

--
-- Name: classwork_coverage_coverage_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.classwork_coverage_coverage_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.classwork_coverage_coverage_id_seq OWNER TO postgres;

--
-- Name: classwork_coverage_coverage_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.classwork_coverage_coverage_id_seq OWNED BY public.classwork_coverage.coverage_id;


--
-- Name: classwork_lesson; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.classwork_lesson (
    classwork_id integer NOT NULL,
    lesson_id integer NOT NULL
);


ALTER TABLE public.classwork_lesson OWNER TO postgres;

--
-- Name: competency; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.competency (
    competency_id integer NOT NULL,
    competency_code character varying(100),
    statement text NOT NULL,
    description text,
    order_index integer NOT NULL,
    target_hours integer,
    is_archived boolean NOT NULL,
    subject_id integer NOT NULL,
    academic_period_id integer,
    created_by_staff_id character varying(20),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.competency OWNER TO postgres;

--
-- Name: competency_competency_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.competency_competency_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.competency_competency_id_seq OWNER TO postgres;

--
-- Name: competency_competency_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.competency_competency_id_seq OWNED BY public.competency.competency_id;


--
-- Name: deped_cluster; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.deped_cluster (
    id integer NOT NULL,
    code character varying(50) NOT NULL,
    name character varying(150) NOT NULL,
    category character varying(20) NOT NULL,
    sort_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.deped_cluster OWNER TO postgres;

--
-- Name: deped_cluster_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.deped_cluster_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.deped_cluster_id_seq OWNER TO postgres;

--
-- Name: deped_cluster_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.deped_cluster_id_seq OWNED BY public.deped_cluster.id;


--
-- Name: development_current_term_prediction; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.development_current_term_prediction (
    prediction_id integer NOT NULL,
    student_id uuid NOT NULL,
    class_id integer NOT NULL,
    subject_id integer NOT NULL,
    source_period_id integer NOT NULL,
    target_period_id integer NOT NULL,
    model_version_id integer NOT NULL,
    revision integer NOT NULL,
    predicted_period_grade numeric(6,2) CONSTRAINT development_current_term_predic_predicted_period_grade_not_null NOT NULL,
    intervention_level character varying(30) NOT NULL,
    intervention_basis character varying(80) NOT NULL,
    risk_score numeric(8,4),
    evidence_snapshot json NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT ck_development_current_term_intervention_level CHECK (((intervention_level)::text = ANY ((ARRAY['LOW_RISK'::character varying, 'NEEDS_MONITORING'::character varying, 'MODERATE_RISK'::character varying, 'HIGH_RISK'::character varying])::text[]))),
    CONSTRAINT ck_development_current_term_no_risk_score CHECK ((risk_score IS NULL)),
    CONSTRAINT ck_development_current_term_revision_positive CHECK ((revision > 0)),
    CONSTRAINT ck_development_current_term_same_period CHECK ((source_period_id = target_period_id))
);


ALTER TABLE public.development_current_term_prediction OWNER TO postgres;

--
-- Name: development_current_term_prediction_prediction_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.development_current_term_prediction_prediction_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.development_current_term_prediction_prediction_id_seq OWNER TO postgres;

--
-- Name: development_current_term_prediction_prediction_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.development_current_term_prediction_prediction_id_seq OWNED BY public.development_current_term_prediction.prediction_id;


--
-- Name: grade_submission_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.grade_submission_log (
    id integer NOT NULL,
    student_period_grade_id integer,
    student_id uuid NOT NULL,
    class_id integer NOT NULL,
    subject_id integer NOT NULL,
    academic_period_id integer NOT NULL,
    written_work_percent numeric(6,2),
    performance_task_percent numeric(6,2),
    quarterly_assessment_percent numeric(6,2),
    initial_grade numeric(6,2),
    transmuted_grade numeric(6,2),
    final_period_grade numeric(6,2),
    submitted_by_staff_id character varying(20),
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    submission_type character varying(20) NOT NULL,
    remarks text
);


ALTER TABLE public.grade_submission_log OWNER TO postgres;

--
-- Name: grade_submission_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.grade_submission_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.grade_submission_log_id_seq OWNER TO postgres;

--
-- Name: grade_submission_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.grade_submission_log_id_seq OWNED BY public.grade_submission_log.id;


--
-- Name: grading_template; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.grading_template (
    grading_template_id integer NOT NULL,
    template_name character varying(150) NOT NULL,
    description text,
    status character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    passing_threshold numeric(5,2) NOT NULL,
    CONSTRAINT ck_grading_template_passing_threshold CHECK (((passing_threshold >= (0)::numeric) AND (passing_threshold <= (100)::numeric))),
    CONSTRAINT ck_grading_template_status CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'archived'::character varying])::text[])))
);


ALTER TABLE public.grading_template OWNER TO postgres;

--
-- Name: grading_template_component; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.grading_template_component (
    component_id integer NOT NULL,
    grading_template_id integer NOT NULL,
    component_name character varying(100) NOT NULL,
    weight numeric(6,2) NOT NULL,
    display_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ck_grading_template_component_weight_positive CHECK ((weight > (0)::numeric))
);


ALTER TABLE public.grading_template_component OWNER TO postgres;

--
-- Name: grading_template_component_component_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.grading_template_component_component_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.grading_template_component_component_id_seq OWNER TO postgres;

--
-- Name: grading_template_component_component_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.grading_template_component_component_id_seq OWNED BY public.grading_template_component.component_id;


--
-- Name: grading_template_grading_template_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.grading_template_grading_template_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.grading_template_grading_template_id_seq OWNER TO postgres;

--
-- Name: grading_template_grading_template_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.grading_template_grading_template_id_seq OWNED BY public.grading_template.grading_template_id;


--
-- Name: intervention; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.intervention (
    intervention_id integer NOT NULL,
    student_id uuid NOT NULL,
    class_id integer NOT NULL,
    subject_id integer NOT NULL,
    academic_period_id integer NOT NULL,
    source_prediction_id integer NOT NULL,
    status character varying(30) DEFAULT 'CANDIDATE'::character varying NOT NULL,
    resolution_reason character varying(80),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    activated_at timestamp with time zone,
    activated_by_staff_id character varying(20),
    resolved_at timestamp with time zone,
    diagnosis_snapshot json NOT NULL,
    remediation_plan json,
    CONSTRAINT ck_intervention_activation_pair CHECK ((((activated_at IS NULL) AND (activated_by_staff_id IS NULL)) OR ((activated_at IS NOT NULL) AND (activated_by_staff_id IS NOT NULL)))),
    CONSTRAINT ck_intervention_active_requires_activation CHECK ((((status)::text <> 'ACTIVE'::text) OR (activated_at IS NOT NULL))),
    CONSTRAINT ck_intervention_resolution CHECK (((((status)::text = 'RESOLVED'::text) AND (resolution_reason IS NOT NULL) AND (resolved_at IS NOT NULL)) OR (((status)::text <> 'RESOLVED'::text) AND (resolution_reason IS NULL) AND (resolved_at IS NULL)))),
    CONSTRAINT ck_intervention_status CHECK (((status)::text = ANY ((ARRAY['CANDIDATE'::character varying, 'ACTIVE'::character varying, 'RESOLVED'::character varying])::text[])))
);


ALTER TABLE public.intervention OWNER TO postgres;

--
-- Name: intervention_intervention_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.intervention_intervention_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.intervention_intervention_id_seq OWNER TO postgres;

--
-- Name: intervention_intervention_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.intervention_intervention_id_seq OWNED BY public.intervention.intervention_id;


--
-- Name: intervention_support_material; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.intervention_support_material (
    material_id integer NOT NULL,
    intervention_id integer NOT NULL,
    kind character varying(30) NOT NULL,
    status character varying(20) DEFAULT 'DRAFT'::character varying NOT NULL,
    evidence_basis json NOT NULL,
    generated_content json,
    current_content json NOT NULL,
    created_by_staff_id character varying(20) NOT NULL,
    updated_by_staff_id character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    sent_at timestamp with time zone,
    sent_by_staff_id character varying(20),
    CONSTRAINT ck_intervention_support_kind CHECK (((kind)::text = ANY ((ARRAY['STUDENT_REVIEWER'::character varying, 'REMEDIAL_ASSESSMENT'::character varying])::text[]))),
    CONSTRAINT ck_intervention_support_sent_pair CHECK (((((status)::text = 'SENT'::text) AND (sent_at IS NOT NULL) AND (sent_by_staff_id IS NOT NULL)) OR (((status)::text = 'DRAFT'::text) AND (sent_at IS NULL) AND (sent_by_staff_id IS NULL)))),
    CONSTRAINT ck_intervention_support_status CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'SENT'::character varying])::text[])))
);


ALTER TABLE public.intervention_support_material OWNER TO postgres;

--
-- Name: intervention_support_material_material_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.intervention_support_material_material_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.intervention_support_material_material_id_seq OWNER TO postgres;

--
-- Name: intervention_support_material_material_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.intervention_support_material_material_id_seq OWNED BY public.intervention_support_material.material_id;


--
-- Name: invitation_token; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invitation_token (
    token_id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_hash character varying(64) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone
);


ALTER TABLE public.invitation_token OWNER TO postgres;

--
-- Name: lesson; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lesson (
    lesson_id integer NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    content text,
    order_index integer NOT NULL,
    is_published boolean NOT NULL,
    is_draft boolean NOT NULL,
    is_locked boolean NOT NULL,
    is_archived boolean NOT NULL,
    created_by_staff_id character varying(20),
    subject_id integer NOT NULL,
    competency_id integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.lesson OWNER TO postgres;

--
-- Name: lesson_assignment; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lesson_assignment (
    lesson_assignment_id integer NOT NULL,
    lesson_id integer NOT NULL,
    class_id integer NOT NULL,
    assigned_by_staff_id character varying(20),
    publish_date timestamp with time zone,
    is_published boolean,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.lesson_assignment OWNER TO postgres;

--
-- Name: lesson_assignment_lesson_assignment_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lesson_assignment_lesson_assignment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lesson_assignment_lesson_assignment_id_seq OWNER TO postgres;

--
-- Name: lesson_assignment_lesson_assignment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lesson_assignment_lesson_assignment_id_seq OWNED BY public.lesson_assignment.lesson_assignment_id;


--
-- Name: lesson_goal; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lesson_goal (
    goal_id integer NOT NULL,
    class_id integer NOT NULL,
    subject_id integer NOT NULL,
    academic_period_id integer NOT NULL,
    created_by_staff_id character varying(20),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.lesson_goal OWNER TO postgres;

--
-- Name: lesson_goal_goal_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lesson_goal_goal_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lesson_goal_goal_id_seq OWNER TO postgres;

--
-- Name: lesson_goal_goal_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lesson_goal_goal_id_seq OWNED BY public.lesson_goal.goal_id;


--
-- Name: lesson_goal_item; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lesson_goal_item (
    goal_item_id integer NOT NULL,
    goal_id integer NOT NULL,
    item_type character varying(20) NOT NULL,
    lesson_id integer,
    classwork_id integer,
    order_index integer NOT NULL
);


ALTER TABLE public.lesson_goal_item OWNER TO postgres;

--
-- Name: lesson_goal_item_goal_item_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lesson_goal_item_goal_item_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lesson_goal_item_goal_item_id_seq OWNER TO postgres;

--
-- Name: lesson_goal_item_goal_item_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lesson_goal_item_goal_item_id_seq OWNED BY public.lesson_goal_item.goal_item_id;


--
-- Name: lesson_lesson_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lesson_lesson_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lesson_lesson_id_seq OWNER TO postgres;

--
-- Name: lesson_lesson_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lesson_lesson_id_seq OWNED BY public.lesson.lesson_id;


--
-- Name: lesson_plan; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.lesson_plan (
    plan_id integer NOT NULL,
    status character varying(20) DEFAULT 'DRAFT'::character varying NOT NULL,
    title character varying(255) NOT NULL,
    learning_area character varying(255),
    grade_section character varying(255),
    date character varying(255),
    sessions character varying(255),
    "references" character varying(1000),
    ai_declaration character varying(1000),
    intentions json,
    learning_experience json,
    assessment json,
    ways_forward json,
    teacher_id character varying(20) NOT NULL,
    subject_id integer,
    class_id integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.lesson_plan OWNER TO postgres;

--
-- Name: lesson_plan_plan_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.lesson_plan_plan_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.lesson_plan_plan_id_seq OWNER TO postgres;

--
-- Name: lesson_plan_plan_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.lesson_plan_plan_id_seq OWNED BY public.lesson_plan.plan_id;


--
-- Name: notification; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.notification (
    notification_id uuid NOT NULL,
    user_id uuid NOT NULL,
    notification_type character varying(60) NOT NULL,
    title character varying(255) NOT NULL,
    body text,
    action_url character varying(500),
    is_read boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    read_at timestamp with time zone
);


ALTER TABLE public.notification OWNER TO postgres;

--
-- Name: official_section; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.official_section (
    id integer NOT NULL,
    academic_year_id integer NOT NULL,
    academic_level_id integer NOT NULL,
    section_name character varying(100) NOT NULL,
    normalized_name character varying(100) NOT NULL,
    pathway_id integer,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.official_section OWNER TO postgres;

--
-- Name: official_section_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.official_section_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.official_section_id_seq OWNER TO postgres;

--
-- Name: official_section_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.official_section_id_seq OWNED BY public.official_section.id;


--
-- Name: period_template_slot; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.period_template_slot (
    slot_id integer NOT NULL,
    template_group character varying(50) NOT NULL,
    slot_name character varying(100) NOT NULL,
    slot_type character varying(20) NOT NULL,
    start_time character varying(10) NOT NULL,
    end_time character varying(10) NOT NULL,
    is_locked_break boolean NOT NULL,
    display_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.period_template_slot OWNER TO postgres;

--
-- Name: period_template_slot_slot_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.period_template_slot_slot_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.period_template_slot_slot_id_seq OWNER TO postgres;

--
-- Name: period_template_slot_slot_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.period_template_slot_slot_id_seq OWNED BY public.period_template_slot.slot_id;


--
-- Name: prediction_outcome; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.prediction_outcome (
    outcome_id integer NOT NULL,
    prediction_id integer NOT NULL,
    actual_period_grade numeric(6,2),
    actual_risk_status character varying(30),
    prediction_error numeric(8,2),
    absolute_error numeric(8,2),
    actual_passed boolean,
    actual_risk_label character varying(30),
    outcome_status character varying(30),
    evaluated_at timestamp with time zone,
    intervention_given boolean,
    intervention_result text,
    recorded_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.prediction_outcome OWNER TO postgres;

--
-- Name: prediction_outcome_outcome_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.prediction_outcome_outcome_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.prediction_outcome_outcome_id_seq OWNER TO postgres;

--
-- Name: prediction_outcome_outcome_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.prediction_outcome_outcome_id_seq OWNED BY public.prediction_outcome.outcome_id;


--
-- Name: question; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.question (
    question_id integer NOT NULL,
    question_text text NOT NULL,
    question_type character varying(40) NOT NULL,
    difficulty_level character varying(30),
    points numeric(8,2) NOT NULL,
    explanation text,
    is_ai_generated boolean NOT NULL,
    expected_answer_type character varying(40),
    max_file_size_mb integer,
    lesson_id integer,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ck_question_difficulty CHECK (((difficulty_level IS NULL) OR ((difficulty_level)::text = ANY ((ARRAY['EASY'::character varying, 'MEDIUM'::character varying, 'HARD'::character varying])::text[])))),
    CONSTRAINT ck_question_max_file_size_positive CHECK (((max_file_size_mb IS NULL) OR (max_file_size_mb > 0))),
    CONSTRAINT ck_question_points_positive CHECK ((points > (0)::numeric)),
    CONSTRAINT ck_question_type CHECK (((question_type)::text = ANY ((ARRAY['MULTIPLE_CHOICE'::character varying, 'SHORT_ANSWER'::character varying, 'IDENTIFICATION'::character varying])::text[])))
);


ALTER TABLE public.question OWNER TO postgres;

--
-- Name: question_option; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.question_option (
    option_id integer NOT NULL,
    question_id integer NOT NULL,
    option_text text NOT NULL,
    is_correct boolean NOT NULL,
    option_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ck_question_option_order_positive CHECK ((option_order > 0))
);


ALTER TABLE public.question_option OWNER TO postgres;

--
-- Name: question_option_option_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.question_option_option_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.question_option_option_id_seq OWNER TO postgres;

--
-- Name: question_option_option_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.question_option_option_id_seq OWNED BY public.question_option.option_id;


--
-- Name: question_question_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.question_question_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.question_question_id_seq OWNER TO postgres;

--
-- Name: question_question_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.question_question_id_seq OWNED BY public.question.question_id;


--
-- Name: quiz; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.quiz (
    quiz_id integer NOT NULL,
    classwork_id integer NOT NULL,
    total_items integer NOT NULL,
    duration_minutes integer,
    accessible_at timestamp with time zone,
    status character varying(30) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ck_quiz_duration_positive CHECK (((duration_minutes IS NULL) OR (duration_minutes > 0))),
    CONSTRAINT ck_quiz_status CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'READY'::character varying, 'PUBLISHED'::character varying, 'ARCHIVED'::character varying])::text[]))),
    CONSTRAINT ck_quiz_total_items_non_negative CHECK ((total_items >= 0))
);


ALTER TABLE public.quiz OWNER TO postgres;

--
-- Name: quiz_answer; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.quiz_answer (
    answer_id integer NOT NULL,
    quiz_question_id integer NOT NULL,
    submission_id integer NOT NULL,
    answer_text text,
    is_correct boolean,
    points_awarded numeric(8,2),
    CONSTRAINT ck_quiz_answer_points_non_negative CHECK (((points_awarded IS NULL) OR (points_awarded >= (0)::numeric)))
);


ALTER TABLE public.quiz_answer OWNER TO postgres;

--
-- Name: quiz_answer_answer_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.quiz_answer_answer_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.quiz_answer_answer_id_seq OWNER TO postgres;

--
-- Name: quiz_answer_answer_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.quiz_answer_answer_id_seq OWNED BY public.quiz_answer.answer_id;


--
-- Name: quiz_question; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.quiz_question (
    quiz_question_id integer NOT NULL,
    quiz_id integer NOT NULL,
    question_id integer NOT NULL,
    display_order integer NOT NULL,
    CONSTRAINT ck_quiz_question_display_order_positive CHECK ((display_order > 0))
);


ALTER TABLE public.quiz_question OWNER TO postgres;

--
-- Name: quiz_question_quiz_question_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.quiz_question_quiz_question_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.quiz_question_quiz_question_id_seq OWNER TO postgres;

--
-- Name: quiz_question_quiz_question_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.quiz_question_quiz_question_id_seq OWNED BY public.quiz_question.quiz_question_id;


--
-- Name: quiz_quiz_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.quiz_quiz_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.quiz_quiz_id_seq OWNER TO postgres;

--
-- Name: quiz_quiz_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.quiz_quiz_id_seq OWNED BY public.quiz.quiz_id;


--
-- Name: quiz_setting; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.quiz_setting (
    quiz_setting_id integer NOT NULL,
    classwork_id integer NOT NULL,
    is_shuffle_questions boolean NOT NULL,
    enable_per_question_scoring boolean NOT NULL,
    enable_per_question_time_limits boolean NOT NULL,
    max_attempts integer,
    show_correct_answers boolean NOT NULL,
    summary_release_mode character varying(32) NOT NULL,
    summary_release_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ck_quiz_setting_max_attempts_positive CHECK (((max_attempts IS NULL) OR (max_attempts > 0))),
    CONSTRAINT ck_quiz_setting_summary_release_mode CHECK (((summary_release_mode)::text = ANY ((ARRAY['IMMEDIATE'::character varying, 'SCHEDULED'::character varying, 'AFTER_DUE_DATE'::character varying, 'NEVER'::character varying])::text[])))
);


ALTER TABLE public.quiz_setting OWNER TO postgres;

--
-- Name: quiz_setting_quiz_setting_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.quiz_setting_quiz_setting_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.quiz_setting_quiz_setting_id_seq OWNER TO postgres;

--
-- Name: quiz_setting_quiz_setting_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.quiz_setting_quiz_setting_id_seq OWNED BY public.quiz_setting.quiz_setting_id;


--
-- Name: risk_threshold; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.risk_threshold (
    threshold_id integer NOT NULL,
    threshold_name character varying(150) NOT NULL,
    condition_type character varying(100) NOT NULL,
    condition_value numeric(10,4) NOT NULL,
    risk_level character varying(30) NOT NULL,
    effective_from timestamp with time zone NOT NULL,
    effective_to timestamp with time zone,
    is_active boolean NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ck_risk_threshold_risk_level CHECK (((risk_level)::text = ANY ((ARRAY['LOW_RISK'::character varying, 'NEEDS_MONITORING'::character varying, 'MODERATE_RISK'::character varying, 'HIGH_RISK'::character varying, 'INSUFFICIENT_DATA'::character varying])::text[])))
);


ALTER TABLE public.risk_threshold OWNER TO postgres;

--
-- Name: risk_threshold_threshold_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.risk_threshold_threshold_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.risk_threshold_threshold_id_seq OWNER TO postgres;

--
-- Name: risk_threshold_threshold_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.risk_threshold_threshold_id_seq OWNED BY public.risk_threshold.threshold_id;


--
-- Name: role; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.role (
    role_id smallint NOT NULL,
    role_name character varying(50) NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.role OWNER TO postgres;

--
-- Name: role_role_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.role_role_id_seq
    AS smallint
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.role_role_id_seq OWNER TO postgres;

--
-- Name: role_role_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.role_role_id_seq OWNED BY public.role.role_id;


--
-- Name: rubric_template; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.rubric_template (
    rubric_template_id integer NOT NULL,
    owner_staff_id character varying(20),
    name character varying(100) NOT NULL,
    description character varying(300) NOT NULL,
    levels json NOT NULL,
    is_system boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.rubric_template OWNER TO postgres;

--
-- Name: rubric_template_rubric_template_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.rubric_template_rubric_template_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.rubric_template_rubric_template_id_seq OWNER TO postgres;

--
-- Name: rubric_template_rubric_template_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.rubric_template_rubric_template_id_seq OWNED BY public.rubric_template.rubric_template_id;


--
-- Name: setting; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.setting (
    id integer NOT NULL,
    key character varying(100) NOT NULL,
    value text NOT NULL,
    type public.setting_type_enum NOT NULL,
    "group" character varying(50) NOT NULL,
    is_public boolean NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    updated_by uuid
);


ALTER TABLE public.setting OWNER TO postgres;

--
-- Name: setting_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.setting_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.setting_id_seq OWNER TO postgres;

--
-- Name: setting_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.setting_id_seq OWNED BY public.setting.id;


--
-- Name: student; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.student (
    student_id uuid NOT NULL,
    student_lrn character varying(12) NOT NULL,
    first_name character varying(100) NOT NULL,
    middle_name character varying(100),
    last_name character varying(100) NOT NULL,
    dob date,
    suffix character varying(10),
    gender character varying(20),
    contact_number character varying(20),
    email character varying(255),
    address text,
    academic_level_id integer,
    prior_gwa numeric(5,2),
    user_id uuid,
    CONSTRAINT lrn_check CHECK ((length((student_lrn)::text) = 12))
);


ALTER TABLE public.student OWNER TO postgres;

--
-- Name: student_assessment_score; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.student_assessment_score (
    score_id integer NOT NULL,
    assessment_id integer NOT NULL,
    student_id uuid NOT NULL,
    raw_score numeric(8,2),
    score_status character varying(30) NOT NULL,
    encoded_at timestamp with time zone DEFAULT now(),
    entered_by_staff_id character varying(20),
    CONSTRAINT ck_student_assessment_score_status CHECK (((score_status)::text = ANY ((ARRAY['RECORDED'::character varying, 'MISSING_NOT_ENCODED'::character varying, 'ABSENT'::character varying, 'NOT_APPLICABLE'::character varying])::text[])))
);


ALTER TABLE public.student_assessment_score OWNER TO postgres;

--
-- Name: student_assessment_score_score_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.student_assessment_score_score_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.student_assessment_score_score_id_seq OWNER TO postgres;

--
-- Name: student_assessment_score_score_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.student_assessment_score_score_id_seq OWNED BY public.student_assessment_score.score_id;


--
-- Name: student_class; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.student_class (
    student_class_id integer NOT NULL,
    student_id uuid NOT NULL,
    class_id integer NOT NULL,
    academic_year_id integer NOT NULL,
    enrollment_status character varying(20),
    enrolled_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.student_class OWNER TO postgres;

--
-- Name: student_class_student_class_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.student_class_student_class_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.student_class_student_class_id_seq OWNER TO postgres;

--
-- Name: student_class_student_class_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.student_class_student_class_id_seq OWNED BY public.student_class.student_class_id;


--
-- Name: student_period_grade; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.student_period_grade (
    period_grade_id integer NOT NULL,
    student_id uuid NOT NULL,
    class_id integer NOT NULL,
    subject_id integer NOT NULL,
    academic_period_id integer NOT NULL,
    written_work_percent numeric(6,2),
    performance_task_percent numeric(6,2),
    quarterly_assessment_percent numeric(6,2),
    initial_grade numeric(6,2),
    transmuted_grade numeric(6,2),
    final_period_grade numeric(6,2),
    is_finalized boolean NOT NULL,
    finalized_at timestamp with time zone,
    finalized_by_staff_id character varying(20),
    entered_by_staff_id character varying(20),
    remarks text,
    source_file_name character varying(255),
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.student_period_grade OWNER TO postgres;

--
-- Name: student_period_grade_period_grade_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.student_period_grade_period_grade_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.student_period_grade_period_grade_id_seq OWNER TO postgres;

--
-- Name: student_period_grade_period_grade_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.student_period_grade_period_grade_id_seq OWNED BY public.student_period_grade.period_grade_id;


--
-- Name: student_submission; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.student_submission (
    submission_id integer NOT NULL,
    student_id uuid NOT NULL,
    classwork_assignment_id integer NOT NULL,
    submitted_at timestamp with time zone,
    status character varying(30) NOT NULL,
    grade numeric(8,2),
    feedback text,
    attempt_count integer NOT NULL,
    graded_at timestamp with time zone,
    graded_by_staff_id character varying(20),
    reading_focused_seconds integer,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.student_submission OWNER TO postgres;

--
-- Name: student_submission_submission_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.student_submission_submission_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.student_submission_submission_id_seq OWNER TO postgres;

--
-- Name: student_submission_submission_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.student_submission_submission_id_seq OWNED BY public.student_submission.submission_id;


--
-- Name: student_suggestion; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.student_suggestion (
    student_suggestion_id integer NOT NULL,
    suggestion_type character varying(30) NOT NULL,
    resource_type character varying(30) NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    resource_links json,
    priority character varying(30) NOT NULL,
    status character varying(30) NOT NULL,
    is_viewed boolean NOT NULL,
    viewed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    student_id uuid NOT NULL,
    subject_id integer NOT NULL,
    lesson_id integer,
    created_by_staff_id character varying(20),
    prediction_id integer,
    CONSTRAINT ck_student_suggestion_priority CHECK (((priority)::text = ANY ((ARRAY['LOW'::character varying, 'NORMAL'::character varying, 'HIGH'::character varying, 'URGENT'::character varying])::text[]))),
    CONSTRAINT ck_student_suggestion_resource_link CHECK (((((resource_type)::text = 'LESSON'::text) AND (lesson_id IS NOT NULL)) OR (((resource_type)::text = 'CLASSWORK'::text) AND (lesson_id IS NULL)))),
    CONSTRAINT ck_student_suggestion_resource_type CHECK (((resource_type)::text = ANY ((ARRAY['LESSON'::character varying, 'CLASSWORK'::character varying])::text[]))),
    CONSTRAINT ck_student_suggestion_status CHECK (((status)::text = ANY ((ARRAY['DRAFT'::character varying, 'ACTIVE'::character varying, 'COMPLETED'::character varying, 'DISMISSED'::character varying, 'ARCHIVED'::character varying])::text[]))),
    CONSTRAINT ck_student_suggestion_type CHECK (((suggestion_type)::text = ANY ((ARRAY['MANUAL'::character varying, 'AUTOMATED'::character varying])::text[])))
);


ALTER TABLE public.student_suggestion OWNER TO postgres;

--
-- Name: student_suggestion_student_suggestion_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.student_suggestion_student_suggestion_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.student_suggestion_student_suggestion_id_seq OWNER TO postgres;

--
-- Name: student_suggestion_student_suggestion_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.student_suggestion_student_suggestion_id_seq OWNED BY public.student_suggestion.student_suggestion_id;


--
-- Name: subject; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subject (
    subject_id integer NOT NULL,
    academic_level_id integer,
    subject_name character varying(150) NOT NULL,
    subject_codename character varying(50),
    is_math_or_science boolean,
    is_core boolean NOT NULL,
    status character varying(20),
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    grading_template_id integer NOT NULL
);


ALTER TABLE public.subject OWNER TO postgres;

--
-- Name: subject_load; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subject_load (
    subject_load_id integer NOT NULL,
    staff_id character varying(20),
    subject_id integer NOT NULL,
    class_id integer NOT NULL,
    academic_period_id integer NOT NULL,
    slot_id integer,
    start_time character varying(10),
    end_time character varying(10),
    days_of_week json,
    status character varying(20),
    logical_load_id character varying(64) NOT NULL,
    section_revision integer NOT NULL,
    base_revision integer,
    version integer NOT NULL,
    is_active_version boolean NOT NULL,
    is_locked boolean,
    locked_at timestamp with time zone,
    published_at timestamp with time zone,
    published_by character varying(50),
    last_modified_by character varying(50),
    draft_notes character varying(255),
    continued_from_load_id integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.subject_load OWNER TO postgres;

--
-- Name: subject_load_subject_load_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.subject_load_subject_load_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.subject_load_subject_load_id_seq OWNER TO postgres;

--
-- Name: subject_load_subject_load_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.subject_load_subject_load_id_seq OWNED BY public.subject_load.subject_load_id;


--
-- Name: subject_offering; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subject_offering (
    subject_offering_id integer NOT NULL,
    subject_id integer NOT NULL,
    academic_year_id integer NOT NULL,
    academic_level_id integer NOT NULL,
    academic_period_id integer NOT NULL,
    minutes integer,
    status character varying(20) NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ck_subject_offering_status CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'archived'::character varying])::text[])))
);


ALTER TABLE public.subject_offering OWNER TO postgres;

--
-- Name: subject_offering_pathway; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.subject_offering_pathway (
    subject_offering_id integer NOT NULL,
    pathway_id integer NOT NULL
);


ALTER TABLE public.subject_offering_pathway OWNER TO postgres;

--
-- Name: subject_offering_subject_offering_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.subject_offering_subject_offering_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.subject_offering_subject_offering_id_seq OWNER TO postgres;

--
-- Name: subject_offering_subject_offering_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.subject_offering_subject_offering_id_seq OWNED BY public.subject_offering.subject_offering_id;


--
-- Name: subject_subject_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.subject_subject_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.subject_subject_id_seq OWNER TO postgres;

--
-- Name: subject_subject_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.subject_subject_id_seq OWNED BY public.subject.subject_id;


--
-- Name: submission_attachment; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.submission_attachment (
    submission_attachment_id integer NOT NULL,
    submission_id integer NOT NULL,
    file_name character varying(255) NOT NULL,
    file_path text NOT NULL,
    file_type character varying(100),
    file_size bigint NOT NULL,
    uploaded_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.submission_attachment OWNER TO postgres;

--
-- Name: submission_attachment_submission_attachment_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.submission_attachment_submission_attachment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.submission_attachment_submission_attachment_id_seq OWNER TO postgres;

--
-- Name: submission_attachment_submission_attachment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.submission_attachment_submission_attachment_id_seq OWNED BY public.submission_attachment.submission_attachment_id;


--
-- Name: suggestion_classwork; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.suggestion_classwork (
    suggestion_classwork_id integer NOT NULL,
    student_suggestion_id integer NOT NULL,
    classwork_assignment_id integer NOT NULL,
    is_completed boolean NOT NULL,
    completed_at timestamp with time zone,
    score_before numeric(8,2),
    score_after numeric(8,2),
    CONSTRAINT ck_suggestion_classwork_score_after_non_negative CHECK (((score_after IS NULL) OR (score_after >= (0)::numeric))),
    CONSTRAINT ck_suggestion_classwork_score_before_non_negative CHECK (((score_before IS NULL) OR (score_before >= (0)::numeric)))
);


ALTER TABLE public.suggestion_classwork OWNER TO postgres;

--
-- Name: suggestion_classwork_suggestion_classwork_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.suggestion_classwork_suggestion_classwork_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.suggestion_classwork_suggestion_classwork_id_seq OWNER TO postgres;

--
-- Name: suggestion_classwork_suggestion_classwork_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.suggestion_classwork_suggestion_classwork_id_seq OWNED BY public.suggestion_classwork.suggestion_classwork_id;


--
-- Name: teacher_risk_review; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.teacher_risk_review (
    review_id integer NOT NULL,
    prediction_id integer NOT NULL,
    student_id uuid NOT NULL,
    reviewed_by_staff_id character varying(20),
    review_decision character varying(30) NOT NULL,
    teacher_notes text,
    reviewed_at timestamp with time zone DEFAULT now(),
    CONSTRAINT ck_teacher_risk_review_decision CHECK (((review_decision)::text = ANY ((ARRAY['CONFIRMED_RISK'::character varying, 'DISMISSED_RISK'::character varying, 'NEEDS_MORE_DATA'::character varying, 'INTERVENTION_ASSIGNED'::character varying, 'ESCALATED'::character varying])::text[])))
);


ALTER TABLE public.teacher_risk_review OWNER TO postgres;

--
-- Name: teacher_risk_review_review_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.teacher_risk_review_review_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.teacher_risk_review_review_id_seq OWNER TO postgres;

--
-- Name: teacher_risk_review_review_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.teacher_risk_review_review_id_seq OWNED BY public.teacher_risk_review.review_id;


--
-- Name: teacher_substitution; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.teacher_substitution (
    substitution_id integer NOT NULL,
    batch_id uuid,
    subject_load_id integer NOT NULL,
    original_staff_id character varying(20) NOT NULL,
    substitute_staff_id character varying(20) NOT NULL,
    start_date date NOT NULL,
    end_date date,
    status character varying(20) NOT NULL,
    reason text,
    created_by_admin_id character varying(20),
    ended_by_admin_id character varying(20),
    ended_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.teacher_substitution OWNER TO postgres;

--
-- Name: teacher_substitution_substitution_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.teacher_substitution_substitution_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.teacher_substitution_substitution_id_seq OWNER TO postgres;

--
-- Name: teacher_substitution_substitution_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.teacher_substitution_substitution_id_seq OWNED BY public.teacher_substitution.substitution_id;


--
-- Name: tos_exam; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tos_exam (
    tos_exam_id integer NOT NULL,
    subject_id integer NOT NULL,
    created_by_staff_id character varying(20),
    title character varying(255) NOT NULL,
    quarter character varying(20) NOT NULL,
    status character varying(20) NOT NULL,
    test_parts_json text NOT NULL,
    competencies_json text NOT NULL,
    difficulty_ratio_json text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.tos_exam OWNER TO postgres;

--
-- Name: tos_exam_tos_exam_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tos_exam_tos_exam_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tos_exam_tos_exam_id_seq OWNER TO postgres;

--
-- Name: tos_exam_tos_exam_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tos_exam_tos_exam_id_seq OWNED BY public.tos_exam.tos_exam_id;


--
-- Name: tos_question; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tos_question (
    tos_question_id integer NOT NULL,
    tos_exam_id integer NOT NULL,
    competency_id integer,
    competency_label character varying(500) NOT NULL,
    question_text text NOT NULL,
    question_type character varying(40) NOT NULL,
    difficulty_band character varying(20) NOT NULL,
    cognitive_level character varying(20) NOT NULL,
    display_order integer NOT NULL,
    points numeric(8,2) NOT NULL,
    explanation text,
    options_json text
);


ALTER TABLE public.tos_question OWNER TO postgres;

--
-- Name: tos_question_tos_question_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tos_question_tos_question_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.tos_question_tos_question_id_seq OWNER TO postgres;

--
-- Name: tos_question_tos_question_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tos_question_tos_question_id_seq OWNED BY public.tos_question.tos_question_id;


--
-- Name: user_account; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_account (
    user_id uuid NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255),
    account_status character varying(50),
    email_status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    last_login timestamp with time zone,
    email_verified_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    avatar_path character varying(128)
);


ALTER TABLE public.user_account OWNER TO postgres;

--
-- Name: user_login_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_login_log (
    login_id integer NOT NULL,
    user_id uuid NOT NULL,
    login_at timestamp with time zone NOT NULL,
    logout_at timestamp with time zone
);


ALTER TABLE public.user_login_log OWNER TO postgres;

--
-- Name: user_login_log_login_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.user_login_log_login_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE public.user_login_log_login_id_seq OWNER TO postgres;

--
-- Name: user_login_log_login_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.user_login_log_login_id_seq OWNED BY public.user_login_log.login_id;


--
-- Name: user_roles; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_roles (
    user_id uuid NOT NULL,
    role_id smallint NOT NULL,
    assigned_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.user_roles OWNER TO postgres;

--
-- Name: academic_level academic_level_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_level ALTER COLUMN academic_level_id SET DEFAULT nextval('public.academic_level_academic_level_id_seq'::regclass);


--
-- Name: academic_level_pathway_scope id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_level_pathway_scope ALTER COLUMN id SET DEFAULT nextval('public.academic_level_pathway_scope_id_seq'::regclass);


--
-- Name: academic_pathway id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_pathway ALTER COLUMN id SET DEFAULT nextval('public.academic_pathway_id_seq'::regclass);


--
-- Name: academic_period academic_period_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_period ALTER COLUMN academic_period_id SET DEFAULT nextval('public.academic_period_academic_period_id_seq'::regclass);


--
-- Name: academic_year academic_year_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_year ALTER COLUMN academic_year_id SET DEFAULT nextval('public.academic_year_academic_year_id_seq'::regclass);


--
-- Name: activity_rubric_level rubric_level_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_rubric_level ALTER COLUMN rubric_level_id SET DEFAULT nextval('public.activity_rubric_level_rubric_level_id_seq'::regclass);


--
-- Name: ai_model_version model_version_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_model_version ALTER COLUMN model_version_id SET DEFAULT nextval('public.ai_model_version_model_version_id_seq'::regclass);


--
-- Name: ai_prediction prediction_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_prediction ALTER COLUMN prediction_id SET DEFAULT nextval('public.ai_prediction_prediction_id_seq'::regclass);


--
-- Name: ai_prediction_feature feature_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_prediction_feature ALTER COLUMN feature_id SET DEFAULT nextval('public.ai_prediction_feature_feature_id_seq'::regclass);


--
-- Name: assessment_item assessment_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_item ALTER COLUMN assessment_id SET DEFAULT nextval('public.assessment_item_assessment_id_seq'::regclass);


--
-- Name: attendance_record attendance_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_record ALTER COLUMN attendance_id SET DEFAULT nextval('public.attendance_record_attendance_id_seq'::regclass);


--
-- Name: class class_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.class ALTER COLUMN class_id SET DEFAULT nextval('public.class_class_id_seq'::regclass);


--
-- Name: classwork classwork_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork ALTER COLUMN classwork_id SET DEFAULT nextval('public.classwork_classwork_id_seq'::regclass);


--
-- Name: classwork_assignment classwork_assignment_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_assignment ALTER COLUMN classwork_assignment_id SET DEFAULT nextval('public.classwork_assignment_classwork_assignment_id_seq'::regclass);


--
-- Name: classwork_attachment classwork_attachment_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_attachment ALTER COLUMN classwork_attachment_id SET DEFAULT nextval('public.classwork_attachment_classwork_attachment_id_seq'::regclass);


--
-- Name: classwork_coverage coverage_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_coverage ALTER COLUMN coverage_id SET DEFAULT nextval('public.classwork_coverage_coverage_id_seq'::regclass);


--
-- Name: competency competency_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.competency ALTER COLUMN competency_id SET DEFAULT nextval('public.competency_competency_id_seq'::regclass);


--
-- Name: deped_cluster id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deped_cluster ALTER COLUMN id SET DEFAULT nextval('public.deped_cluster_id_seq'::regclass);


--
-- Name: development_current_term_prediction prediction_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.development_current_term_prediction ALTER COLUMN prediction_id SET DEFAULT nextval('public.development_current_term_prediction_prediction_id_seq'::regclass);


--
-- Name: grade_submission_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grade_submission_log ALTER COLUMN id SET DEFAULT nextval('public.grade_submission_log_id_seq'::regclass);


--
-- Name: grading_template grading_template_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grading_template ALTER COLUMN grading_template_id SET DEFAULT nextval('public.grading_template_grading_template_id_seq'::regclass);


--
-- Name: grading_template_component component_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grading_template_component ALTER COLUMN component_id SET DEFAULT nextval('public.grading_template_component_component_id_seq'::regclass);


--
-- Name: intervention intervention_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.intervention ALTER COLUMN intervention_id SET DEFAULT nextval('public.intervention_intervention_id_seq'::regclass);


--
-- Name: intervention_support_material material_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.intervention_support_material ALTER COLUMN material_id SET DEFAULT nextval('public.intervention_support_material_material_id_seq'::regclass);


--
-- Name: lesson lesson_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson ALTER COLUMN lesson_id SET DEFAULT nextval('public.lesson_lesson_id_seq'::regclass);


--
-- Name: lesson_assignment lesson_assignment_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_assignment ALTER COLUMN lesson_assignment_id SET DEFAULT nextval('public.lesson_assignment_lesson_assignment_id_seq'::regclass);


--
-- Name: lesson_goal goal_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_goal ALTER COLUMN goal_id SET DEFAULT nextval('public.lesson_goal_goal_id_seq'::regclass);


--
-- Name: lesson_goal_item goal_item_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_goal_item ALTER COLUMN goal_item_id SET DEFAULT nextval('public.lesson_goal_item_goal_item_id_seq'::regclass);


--
-- Name: lesson_plan plan_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_plan ALTER COLUMN plan_id SET DEFAULT nextval('public.lesson_plan_plan_id_seq'::regclass);


--
-- Name: official_section id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.official_section ALTER COLUMN id SET DEFAULT nextval('public.official_section_id_seq'::regclass);


--
-- Name: period_template_slot slot_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.period_template_slot ALTER COLUMN slot_id SET DEFAULT nextval('public.period_template_slot_slot_id_seq'::regclass);


--
-- Name: prediction_outcome outcome_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prediction_outcome ALTER COLUMN outcome_id SET DEFAULT nextval('public.prediction_outcome_outcome_id_seq'::regclass);


--
-- Name: question question_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.question ALTER COLUMN question_id SET DEFAULT nextval('public.question_question_id_seq'::regclass);


--
-- Name: question_option option_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.question_option ALTER COLUMN option_id SET DEFAULT nextval('public.question_option_option_id_seq'::regclass);


--
-- Name: quiz quiz_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz ALTER COLUMN quiz_id SET DEFAULT nextval('public.quiz_quiz_id_seq'::regclass);


--
-- Name: quiz_answer answer_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz_answer ALTER COLUMN answer_id SET DEFAULT nextval('public.quiz_answer_answer_id_seq'::regclass);


--
-- Name: quiz_question quiz_question_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz_question ALTER COLUMN quiz_question_id SET DEFAULT nextval('public.quiz_question_quiz_question_id_seq'::regclass);


--
-- Name: quiz_setting quiz_setting_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz_setting ALTER COLUMN quiz_setting_id SET DEFAULT nextval('public.quiz_setting_quiz_setting_id_seq'::regclass);


--
-- Name: risk_threshold threshold_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.risk_threshold ALTER COLUMN threshold_id SET DEFAULT nextval('public.risk_threshold_threshold_id_seq'::regclass);


--
-- Name: role role_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role ALTER COLUMN role_id SET DEFAULT nextval('public.role_role_id_seq'::regclass);


--
-- Name: rubric_template rubric_template_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rubric_template ALTER COLUMN rubric_template_id SET DEFAULT nextval('public.rubric_template_rubric_template_id_seq'::regclass);


--
-- Name: setting id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.setting ALTER COLUMN id SET DEFAULT nextval('public.setting_id_seq'::regclass);


--
-- Name: student_assessment_score score_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_assessment_score ALTER COLUMN score_id SET DEFAULT nextval('public.student_assessment_score_score_id_seq'::regclass);


--
-- Name: student_class student_class_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_class ALTER COLUMN student_class_id SET DEFAULT nextval('public.student_class_student_class_id_seq'::regclass);


--
-- Name: student_period_grade period_grade_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_period_grade ALTER COLUMN period_grade_id SET DEFAULT nextval('public.student_period_grade_period_grade_id_seq'::regclass);


--
-- Name: student_submission submission_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_submission ALTER COLUMN submission_id SET DEFAULT nextval('public.student_submission_submission_id_seq'::regclass);


--
-- Name: student_suggestion student_suggestion_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_suggestion ALTER COLUMN student_suggestion_id SET DEFAULT nextval('public.student_suggestion_student_suggestion_id_seq'::regclass);


--
-- Name: subject subject_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject ALTER COLUMN subject_id SET DEFAULT nextval('public.subject_subject_id_seq'::regclass);


--
-- Name: subject_load subject_load_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_load ALTER COLUMN subject_load_id SET DEFAULT nextval('public.subject_load_subject_load_id_seq'::regclass);


--
-- Name: subject_offering subject_offering_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_offering ALTER COLUMN subject_offering_id SET DEFAULT nextval('public.subject_offering_subject_offering_id_seq'::regclass);


--
-- Name: submission_attachment submission_attachment_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.submission_attachment ALTER COLUMN submission_attachment_id SET DEFAULT nextval('public.submission_attachment_submission_attachment_id_seq'::regclass);


--
-- Name: suggestion_classwork suggestion_classwork_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestion_classwork ALTER COLUMN suggestion_classwork_id SET DEFAULT nextval('public.suggestion_classwork_suggestion_classwork_id_seq'::regclass);


--
-- Name: teacher_risk_review review_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teacher_risk_review ALTER COLUMN review_id SET DEFAULT nextval('public.teacher_risk_review_review_id_seq'::regclass);


--
-- Name: teacher_substitution substitution_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teacher_substitution ALTER COLUMN substitution_id SET DEFAULT nextval('public.teacher_substitution_substitution_id_seq'::regclass);


--
-- Name: tos_exam tos_exam_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tos_exam ALTER COLUMN tos_exam_id SET DEFAULT nextval('public.tos_exam_tos_exam_id_seq'::regclass);


--
-- Name: tos_question tos_question_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tos_question ALTER COLUMN tos_question_id SET DEFAULT nextval('public.tos_question_tos_question_id_seq'::regclass);


--
-- Name: user_login_log login_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_login_log ALTER COLUMN login_id SET DEFAULT nextval('public.user_login_log_login_id_seq'::regclass);


--
-- Data for Name: academic_level; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.academic_level (academic_level_id, level_name, grade_level, created_at, updated_at) FROM stdin;
1	Grade 9 Demo	9	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
\.


--
-- Data for Name: academic_level_pathway_scope; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.academic_level_pathway_scope (id, academic_year_id, academic_level_id, requires_pathway, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: academic_pathway; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.academic_pathway (id, code, name, is_enabled, sort_order, deped_cluster_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: academic_period; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.academic_period (academic_period_id, period_name, period_type, period_sequence, total_periods_in_year, period_progress_ratio, start_date, end_date, is_active, academic_year_id, created_at, updated_at) FROM stdin;
1	Term 1 Demo	TERM	1	3	0.3333	2026-09-01	2026-11-30	t	1	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
\.


--
-- Data for Name: academic_staff; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.academic_staff (staff_id, first_name, middle_name, last_name, dob, suffix, gender, contact_number, email, address, hired_date, employment_status, user_id) FROM stdin;
DEMO-T-001	Mara	\N	Santos	\N	\N	\N	\N	demo-teacher@example.com	\N	\N	active	117c4122-f3eb-5e19-8219-b636b590887b
\.


--
-- Data for Name: academic_year; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.academic_year (academic_year_id, year_label, start_date, end_date, is_active, created_at) FROM stdin;
1	2026-2027 DEMO	2026-06-01	2027-03-31	t	2026-09-23 21:31:00.305889+08
\.


--
-- Data for Name: activity_rubric_level; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.activity_rubric_level (rubric_level_id, classwork_id, level_name, description, points, display_order) FROM stdin;
\.


--
-- Data for Name: ai_model_version; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ai_model_version (model_version_id, model_name, model_type, model_purpose, algorithm, target_column, lifecycle_status, production_validated, independent_three_term_validation, registry_metadata_json, trained_at, training_row_count, test_row_count, mae, rmse, r2_score, feature_schema_json, artifact_path, is_active) FROM stdin;
1	entervene_current_term_development_rf_v3	REGRESSOR	CURRENT_TERM_FINAL_GRADE_PROJECTION	RandomForestRegressor	target_final_period_grade	DEVELOPMENT	f	f	{"supported_subjects": ["CREATIVE_TECHNOLOGY", "ENGLISH", "ICT", "MATHEMATICS", "SCIENCE"], "supported_weight_patterns": ["20/50/30", "20/60/20"], "period_semantics": "SOURCE_EQUALS_TARGET_SAME_TERM", "feature_schema_sha256": "02ab5ef7a3e4d65f06530a14b037d34c0e7f24f0abb604670af5c66b9d91987b", "feature_schema_version": "sha256:02ab5ef7a3e4d65f06530a14b037d34c0e7f24f0abb604670af5c66b9d91987b", "artifact_sha256": "8666c600a1e1ed5afaaa73c5fae8f381e83150c26af3f0af8c1580fd8d2eb3fd", "training_dataset_version": "demo-uses-registered-v3-artifact"}	2026-09-23 21:31:00.305889+08	\N	\N	\N	\N	\N	{"categorical_features": ["subject"], "development_status": "DEVELOPMENT_ONLY", "feature_columns": ["grade_level", "ww_weight", "pt_weight", "qa_weight", "ww_available_activity_count", "pt_available_activity_count", "qa_available_activity_count", "overall_available_activity_count", "ww_points_earned_so_far", "ww_points_possible_so_far", "ww_percent_so_far", "ww_weighted_score_so_far", "pt_points_earned_so_far", "pt_points_possible_so_far", "pt_percent_so_far", "pt_weighted_score_so_far", "qa_points_earned_so_far", "qa_points_possible_so_far", "qa_percent_so_far", "qa_weighted_score_so_far", "observed_component_weight_sum", "overall_weighted_score_so_far", "overall_partial_percent", "ww_has_evidence", "pt_has_evidence", "qa_has_evidence", "has_any_input_evidence", "ww_score_over_hps_count_so_far", "pt_score_over_hps_count_so_far", "qa_score_over_hps_count_so_far", "subject"], "historical_exam_semantics": "Historical QA aggregate is used as the development analogue of the current Examination component; ST1/ST2/Term Exam are not fabricated.", "independent_three_term_validation": false, "model_name": "entervene_current_term_development_rf_v3", "numeric_features": ["grade_level", "ww_weight", "pt_weight", "qa_weight", "ww_available_activity_count", "pt_available_activity_count", "qa_available_activity_count", "overall_available_activity_count", "ww_points_earned_so_far", "ww_points_possible_so_far", "ww_percent_so_far", "ww_weighted_score_so_far", "pt_points_earned_so_far", "pt_points_possible_so_far", "pt_percent_so_far", "pt_weighted_score_so_far", "qa_points_earned_so_far", "qa_points_possible_so_far", "qa_percent_so_far", "qa_weighted_score_so_far", "observed_component_weight_sum", "overall_weighted_score_so_far", "overall_partial_percent", "ww_has_evidence", "pt_has_evidence", "qa_has_evidence", "has_any_input_evidence", "ww_score_over_hps_count_so_far", "pt_score_over_hps_count_so_far", "qa_score_over_hps_count_so_far"], "production_validated": false, "supported_subjects": ["CREATIVE_TECHNOLOGY", "ELECTRONICS", "ENGLISH", "ICT", "MATHEMATICS", "SCIENCE", "VALUES_EDUCATION"], "supported_weight_patterns": ["20/50/30", "20/60/20"], "target_column": "target_final_period_grade"}	data/models/entervene_current_term_development_rf_v3.joblib	f
2	entervene_current_term_official_target_rf_candidate	REGRESSOR	CURRENT_TERM_FINAL_GRADE_PROJECTION	RandomForestRegressor	target_final_period_grade	DEVELOPMENT	f	f	{"supported_subjects": ["CREATIVE_TECHNOLOGY", "ENGLISH", "ICT", "MATHEMATICS", "SCIENCE"], "supported_weight_patterns": ["20/50/30", "20/60/20"], "period_semantics": "SOURCE_EQUALS_TARGET_SAME_TERM", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "evaluation_report_path": "data/experiments/official_target_rf_4i/evaluation_report.json", "artifact_feature_order_sha256": "6b3ff7c43c9e98ce77763b73edacdf2e0411bb641262d2238cbc3ff255e203aa"}	2026-09-25 00:10:47.976943+08	5595	673	1.0913	1.5618	0.8238	{"artifact_feature_order_sha256": "6b3ff7c43c9e98ce77763b73edacdf2e0411bb641262d2238cbc3ff255e203aa", "categorical_features": ["subject"], "dataset_sha256": "789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "development_status": "DEVELOPMENT_ONLY", "feature_columns": ["grade_level", "ww_weight", "pt_weight", "qa_weight", "ww_available_activity_count", "pt_available_activity_count", "qa_available_activity_count", "overall_available_activity_count", "ww_points_earned_so_far", "ww_points_possible_so_far", "ww_percent_so_far", "ww_weighted_score_so_far", "pt_points_earned_so_far", "pt_points_possible_so_far", "pt_percent_so_far", "pt_weighted_score_so_far", "qa_points_earned_so_far", "qa_points_possible_so_far", "qa_percent_so_far", "qa_weighted_score_so_far", "observed_component_weight_sum", "overall_weighted_score_so_far", "overall_partial_percent", "ww_has_evidence", "pt_has_evidence", "qa_has_evidence", "has_any_input_evidence", "ww_score_over_hps_count_so_far", "pt_score_over_hps_count_so_far", "qa_score_over_hps_count_so_far", "subject"], "historical_exam_semantics": "Historical QA aggregate is used as the development analogue of the current Examination component; ST1/ST2/Term Exam are not fabricated.", "independent_three_term_validation": false, "model_name": "entervene_current_term_official_target_rf_candidate", "numeric_features": ["grade_level", "ww_weight", "pt_weight", "qa_weight", "ww_available_activity_count", "pt_available_activity_count", "qa_available_activity_count", "overall_available_activity_count", "ww_points_earned_so_far", "ww_points_possible_so_far", "ww_percent_so_far", "ww_weighted_score_so_far", "pt_points_earned_so_far", "pt_points_possible_so_far", "pt_percent_so_far", "pt_weighted_score_so_far", "qa_points_earned_so_far", "qa_points_possible_so_far", "qa_percent_so_far", "qa_weighted_score_so_far", "observed_component_weight_sum", "overall_weighted_score_so_far", "overall_partial_percent", "ww_has_evidence", "pt_has_evidence", "qa_has_evidence", "has_any_input_evidence", "ww_score_over_hps_count_so_far", "pt_score_over_hps_count_so_far", "qa_score_over_hps_count_so_far"], "production_validated": false, "supported_subjects": ["CREATIVE_TECHNOLOGY", "ENGLISH", "ICT", "MATHEMATICS", "SCIENCE"], "supported_weight_patterns": ["20/50/30", "20/60/20"], "target_column": "target_final_period_grade"}	data/models/entervene_current_term_official_target_rf_candidate.joblib	f
\.


--
-- Data for Name: ai_prediction; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ai_prediction (prediction_id, student_id, class_id, subject_id, source_period_id, target_period_id, predicted_period_grade, risk_score, risk_level, data_status, intervention_level, intervention_basis, revision, risk_assessment_status, model_version_id, evidence_snapshot, generation_request_id, generated_at) FROM stdin;
\.


--
-- Data for Name: ai_prediction_feature; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.ai_prediction_feature (feature_id, prediction_id, feature_name, feature_value, feature_contribution, direction, feature_rank, explanation_method, created_at) FROM stdin;
\.


--
-- Data for Name: alembic_version; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.alembic_version (version_num) FROM stdin;
20261018_three_grading_templates
\.


--
-- Data for Name: api_usage_counter; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.api_usage_counter (scope, period, used) FROM stdin;
school_minute	2026-09-26T13:56	1
duplicate:06b718bc031399e9d5ef9be9464b426c1691eecf80cba948ffbd1e82dfac0e1f	2026-09-26T13:56:add1180ab9cf6c4427f00b031bdc0d1b	1
school_minute	2026-09-26T13:58	1
duplicate:06b718bc031399e9d5ef9be9464b426c1691eecf80cba948ffbd1e82dfac0e1f	2026-09-26T13:58:add1180ab9cf6c4427f00b031bdc0d1b	1
school_minute	2026-09-26T14:00	1
duplicate:06b718bc031399e9d5ef9be9464b426c1691eecf80cba948ffbd1e82dfac0e1f	2026-09-26T14:00:add1180ab9cf6c4427f00b031bdc0d1b	1
school_day	2026-09-26	4
school_minute	2026-09-26T14:02	1
staff_day:06b718bc031399e9d5ef9be9464b426c1691eecf80cba948ffbd1e82dfac0e1f	2026-09-26	4
duplicate:06b718bc031399e9d5ef9be9464b426c1691eecf80cba948ffbd1e82dfac0e1f	2026-09-26T14:02:0922f73a75fe198f2795a98f22eb167b	1
duplicate:06b718bc031399e9d5ef9be9464b426c1691eecf80cba948ffbd1e82dfac0e1f	2026-09-27T04:19:3d58775eee24425cf1d2e1c31721e07e	1
school_budget	2026-09	60000
school_day	2026-09-27	2
school_minute	2026-09-27T04:19	2
staff_day:06b718bc031399e9d5ef9be9464b426c1691eecf80cba948ffbd1e82dfac0e1f	2026-09-27	2
duplicate:06b718bc031399e9d5ef9be9464b426c1691eecf80cba948ffbd1e82dfac0e1f	2026-09-27T04:19:4b6905081d5284656865ee4abfb5993f	1
school_budget	2026-10	10000
school_day	2026-10-19	1
school_minute	2026-10-19T17:31	1
staff_day:06b718bc031399e9d5ef9be9464b426c1691eecf80cba948ffbd1e82dfac0e1f	2026-10-19	1
duplicate:06b718bc031399e9d5ef9be9464b426c1691eecf80cba948ffbd1e82dfac0e1f	2026-10-19T17:31:da44be352187a159c8f45b6f11428a23	1
\.


--
-- Data for Name: assessment_item; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.assessment_item (assessment_id, class_id, subject_id, academic_period_id, component_type, item_number, max_score, created_at, entered_by_staff_id) FROM stdin;
\.


--
-- Data for Name: attendance_record; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.attendance_record (attendance_id, student_id, class_id, subject_id, date, status, remarks, recorded_by_staff_id, created_at, updated_at) FROM stdin;
1	e5888450-33df-5d69-9991-8bf448c3f0d1	1	1	2026-09-01	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
2	e5888450-33df-5d69-9991-8bf448c3f0d1	1	1	2026-09-02	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
3	e5888450-33df-5d69-9991-8bf448c3f0d1	1	1	2026-09-03	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
4	e5888450-33df-5d69-9991-8bf448c3f0d1	1	1	2026-09-04	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
5	e5888450-33df-5d69-9991-8bf448c3f0d1	1	1	2026-09-05	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
6	e5888450-33df-5d69-9991-8bf448c3f0d1	1	1	2026-09-06	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
7	e5888450-33df-5d69-9991-8bf448c3f0d1	1	1	2026-09-07	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
8	e5888450-33df-5d69-9991-8bf448c3f0d1	1	1	2026-09-08	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
9	e5888450-33df-5d69-9991-8bf448c3f0d1	1	1	2026-09-09	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
10	e5888450-33df-5d69-9991-8bf448c3f0d1	1	1	2026-09-10	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
11	e5888450-33df-5d69-9991-8bf448c3f0d1	1	1	2026-09-11	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
12	e5888450-33df-5d69-9991-8bf448c3f0d1	1	1	2026-09-12	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
13	e5888450-33df-5d69-9991-8bf448c3f0d1	1	1	2026-09-13	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
14	e5888450-33df-5d69-9991-8bf448c3f0d1	1	1	2026-09-14	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
15	e5888450-33df-5d69-9991-8bf448c3f0d1	1	1	2026-09-15	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
16	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	1	2026-09-01	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
17	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	1	2026-09-02	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
18	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	1	2026-09-03	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
19	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	1	2026-09-04	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
20	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	1	2026-09-05	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
21	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	1	2026-09-06	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
22	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	1	2026-09-07	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
23	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	1	2026-09-08	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
24	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	1	2026-09-09	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
25	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	1	2026-09-10	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
26	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	1	2026-09-11	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
27	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	1	2026-09-12	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
28	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	1	2026-09-13	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
29	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	1	2026-09-14	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
30	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	1	2026-09-15	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
31	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	1	2026-09-01	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
32	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	1	2026-09-02	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
33	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	1	2026-09-03	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
34	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	1	2026-09-04	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
35	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	1	2026-09-05	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
36	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	1	2026-09-06	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
37	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	1	2026-09-07	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
38	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	1	2026-09-08	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
39	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	1	2026-09-09	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
40	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	1	2026-09-10	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
41	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	1	2026-09-11	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
42	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	1	2026-09-12	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
43	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	1	2026-09-13	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
44	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	1	2026-09-14	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
45	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	1	2026-09-15	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
46	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	1	2026-09-01	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
47	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	1	2026-09-02	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
48	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	1	2026-09-03	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
49	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	1	2026-09-04	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
50	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	1	2026-09-05	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
51	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	1	2026-09-06	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
52	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	1	2026-09-07	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
53	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	1	2026-09-08	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
54	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	1	2026-09-09	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
55	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	1	2026-09-10	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
56	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	1	2026-09-11	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
57	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	1	2026-09-12	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
58	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	1	2026-09-13	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
59	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	1	2026-09-14	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
60	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	1	2026-09-15	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
61	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	1	2026-09-01	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
62	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	1	2026-09-02	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
63	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	1	2026-09-03	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
64	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	1	2026-09-04	absent	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
65	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	1	2026-09-05	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
66	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	1	2026-09-06	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
67	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	1	2026-09-07	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
68	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	1	2026-09-08	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
69	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	1	2026-09-09	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
70	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	1	2026-09-10	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
71	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	1	2026-09-11	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
72	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	1	2026-09-12	absent	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
73	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	1	2026-09-13	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
74	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	1	2026-09-14	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
75	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	1	2026-09-15	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
76	c64e1a20-e025-5113-9f47-a49019ed27c5	1	1	2026-09-01	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
77	c64e1a20-e025-5113-9f47-a49019ed27c5	1	1	2026-09-02	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
78	c64e1a20-e025-5113-9f47-a49019ed27c5	1	1	2026-09-03	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
79	c64e1a20-e025-5113-9f47-a49019ed27c5	1	1	2026-09-04	absent	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
80	c64e1a20-e025-5113-9f47-a49019ed27c5	1	1	2026-09-05	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
81	c64e1a20-e025-5113-9f47-a49019ed27c5	1	1	2026-09-06	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
82	c64e1a20-e025-5113-9f47-a49019ed27c5	1	1	2026-09-07	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
83	c64e1a20-e025-5113-9f47-a49019ed27c5	1	1	2026-09-08	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
84	c64e1a20-e025-5113-9f47-a49019ed27c5	1	1	2026-09-09	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
85	c64e1a20-e025-5113-9f47-a49019ed27c5	1	1	2026-09-10	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
86	c64e1a20-e025-5113-9f47-a49019ed27c5	1	1	2026-09-11	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
87	c64e1a20-e025-5113-9f47-a49019ed27c5	1	1	2026-09-12	absent	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
88	c64e1a20-e025-5113-9f47-a49019ed27c5	1	1	2026-09-13	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
89	c64e1a20-e025-5113-9f47-a49019ed27c5	1	1	2026-09-14	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
90	c64e1a20-e025-5113-9f47-a49019ed27c5	1	1	2026-09-15	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
91	59501866-17b8-5e3f-b979-d2a94b876e21	1	1	2026-09-01	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
92	59501866-17b8-5e3f-b979-d2a94b876e21	1	1	2026-09-02	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
93	59501866-17b8-5e3f-b979-d2a94b876e21	1	1	2026-09-03	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
94	59501866-17b8-5e3f-b979-d2a94b876e21	1	1	2026-09-04	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
95	59501866-17b8-5e3f-b979-d2a94b876e21	1	1	2026-09-05	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
96	59501866-17b8-5e3f-b979-d2a94b876e21	1	1	2026-09-06	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
97	59501866-17b8-5e3f-b979-d2a94b876e21	1	1	2026-09-07	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
98	59501866-17b8-5e3f-b979-d2a94b876e21	1	1	2026-09-08	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
99	59501866-17b8-5e3f-b979-d2a94b876e21	1	1	2026-09-09	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
100	59501866-17b8-5e3f-b979-d2a94b876e21	1	1	2026-09-10	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
101	59501866-17b8-5e3f-b979-d2a94b876e21	1	1	2026-09-11	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
102	59501866-17b8-5e3f-b979-d2a94b876e21	1	1	2026-09-12	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
103	59501866-17b8-5e3f-b979-d2a94b876e21	1	1	2026-09-13	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
104	59501866-17b8-5e3f-b979-d2a94b876e21	1	1	2026-09-14	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
105	59501866-17b8-5e3f-b979-d2a94b876e21	1	1	2026-09-15	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
106	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	1	2026-09-01	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
107	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	1	2026-09-02	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
108	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	1	2026-09-03	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
109	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	1	2026-09-04	absent	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
110	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	1	2026-09-05	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
111	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	1	2026-09-06	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
112	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	1	2026-09-07	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
113	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	1	2026-09-08	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
114	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	1	2026-09-09	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
115	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	1	2026-09-10	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
116	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	1	2026-09-11	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
117	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	1	2026-09-12	absent	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
118	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	1	2026-09-13	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
119	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	1	2026-09-14	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
120	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	1	2026-09-15	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
121	28141b44-9a69-567f-88bd-3a838b4115db	1	1	2026-09-01	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
122	28141b44-9a69-567f-88bd-3a838b4115db	1	1	2026-09-02	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
123	28141b44-9a69-567f-88bd-3a838b4115db	1	1	2026-09-03	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
124	28141b44-9a69-567f-88bd-3a838b4115db	1	1	2026-09-04	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
125	28141b44-9a69-567f-88bd-3a838b4115db	1	1	2026-09-05	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
126	28141b44-9a69-567f-88bd-3a838b4115db	1	1	2026-09-06	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
127	28141b44-9a69-567f-88bd-3a838b4115db	1	1	2026-09-07	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
128	28141b44-9a69-567f-88bd-3a838b4115db	1	1	2026-09-08	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
129	28141b44-9a69-567f-88bd-3a838b4115db	1	1	2026-09-09	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
130	28141b44-9a69-567f-88bd-3a838b4115db	1	1	2026-09-10	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
131	28141b44-9a69-567f-88bd-3a838b4115db	1	1	2026-09-11	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
132	28141b44-9a69-567f-88bd-3a838b4115db	1	1	2026-09-12	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
133	28141b44-9a69-567f-88bd-3a838b4115db	1	1	2026-09-13	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
134	28141b44-9a69-567f-88bd-3a838b4115db	1	1	2026-09-14	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
135	28141b44-9a69-567f-88bd-3a838b4115db	1	1	2026-09-15	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
136	02361276-31c5-5e69-a622-b7220472edd3	1	1	2026-09-01	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
137	02361276-31c5-5e69-a622-b7220472edd3	1	1	2026-09-02	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
138	02361276-31c5-5e69-a622-b7220472edd3	1	1	2026-09-03	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
139	02361276-31c5-5e69-a622-b7220472edd3	1	1	2026-09-04	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
140	02361276-31c5-5e69-a622-b7220472edd3	1	1	2026-09-05	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
141	02361276-31c5-5e69-a622-b7220472edd3	1	1	2026-09-06	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
142	02361276-31c5-5e69-a622-b7220472edd3	1	1	2026-09-07	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
143	02361276-31c5-5e69-a622-b7220472edd3	1	1	2026-09-08	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
144	02361276-31c5-5e69-a622-b7220472edd3	1	1	2026-09-09	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
145	02361276-31c5-5e69-a622-b7220472edd3	1	1	2026-09-10	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
146	02361276-31c5-5e69-a622-b7220472edd3	1	1	2026-09-11	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
147	02361276-31c5-5e69-a622-b7220472edd3	1	1	2026-09-12	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
148	02361276-31c5-5e69-a622-b7220472edd3	1	1	2026-09-13	late	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
149	02361276-31c5-5e69-a622-b7220472edd3	1	1	2026-09-14	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
150	02361276-31c5-5e69-a622-b7220472edd3	1	1	2026-09-15	present	Controlled demo attendance	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
\.


--
-- Data for Name: class; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.class (class_id, section_name, class_status, adviser_staff_id, academic_year_id, academic_level_id, academic_period_id, pathway_id, paired_class_id, period_template_group, created_at, updated_at) FROM stdin;
1	Demo Archimedes	active	DEMO-T-001	1	1	1	\N	\N	\N	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
\.


--
-- Data for Name: classwork; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.classwork (classwork_id, title, description, instructions, classwork_type, classwork_category, exam_subtype, activity_mode, is_graded, total_points, is_locked, is_published, show_scores, is_archived, subject_id, created_by_staff_id, created_at, updated_at) FROM stdin;
1	DEMO - WW 1 - Number Sense	Controlled V3 demonstration evidence.	Demo database only.	ASSIGNMENT	WRITTEN_WORK	\N	MANUAL	t	20.00	f	t	t	f	1	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
2	DEMO - WW 2 - Integer Operations	Controlled V3 demonstration evidence.	Demo database only.	QUIZ	WRITTEN_WORK	\N	MANUAL	t	20.00	f	t	t	f	1	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
3	DEMO - WW 3 - Rational Numbers	Controlled V3 demonstration evidence.	Demo database only.	ASSIGNMENT	WRITTEN_WORK	\N	MANUAL	t	20.00	f	t	t	f	1	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
4	DEMO - WW 4 - Algebraic Expressions	Controlled V3 demonstration evidence.	Demo database only.	QUIZ	WRITTEN_WORK	\N	MANUAL	t	20.00	f	t	t	f	1	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
5	DEMO - PT 1 - Budget Mathematics	Controlled V3 demonstration evidence.	Demo database only.	ACTIVITY	PERFORMANCE_TASK	\N	MANUAL	t	40.00	f	t	t	f	1	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
6	DEMO - PT 2 - Equation Modeling	Controlled V3 demonstration evidence.	Demo database only.	ACTIVITY	PERFORMANCE_TASK	\N	MANUAL	t	40.00	f	t	t	f	1	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
7	DEMO - PT 3 - Data Investigation	Controlled V3 demonstration evidence.	Demo database only.	ACTIVITY	PERFORMANCE_TASK	\N	MANUAL	t	40.00	f	t	t	f	1	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
8	DEMO - Summative Test 1	Controlled V3 demonstration evidence.	Demo database only.	EXAM	EXAMS	SUMMATIVE_1	MANUAL	t	30.00	f	t	t	f	1	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
9	DEMO - Summative Test 2	Controlled V3 demonstration evidence.	Demo database only.	EXAM	EXAMS	SUMMATIVE_2	MANUAL	t	30.00	f	t	t	f	1	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
10	DEMO - Term Examination	Controlled V3 demonstration evidence.	Demo database only.	EXAM	EXAMS	TERM_EXAM	MANUAL	t	40.00	f	t	t	f	1	DEMO-T-001	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
\.


--
-- Data for Name: classwork_assignment; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.classwork_assignment (classwork_assignment_id, classwork_id, class_id, academic_period_id, assigned_by_staff_id, publish_date, due_date, lock_date, is_published, is_locked, allow_late_submissions, max_attempts, assigned_at, created_at, updated_at, recipient_student_id, source_intervention_id, remediation_request_id, original_exam_assignment_id) FROM stdin;
1	1	1	1	DEMO-T-001	2026-09-01 17:00:00+08	2026-09-03 17:00:00+08	2026-09-10 17:00:00+08	t	f	t	2	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	\N	\N	\N	\N
2	2	1	1	DEMO-T-001	2026-09-04 17:00:00+08	2026-09-06 17:00:00+08	2026-09-13 17:00:00+08	t	f	t	2	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	\N	\N	\N	\N
3	3	1	1	DEMO-T-001	2026-09-07 17:00:00+08	2026-09-09 17:00:00+08	2026-09-16 17:00:00+08	t	f	t	2	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	\N	\N	\N	\N
4	4	1	1	DEMO-T-001	2026-09-10 17:00:00+08	2026-09-12 17:00:00+08	2026-09-19 17:00:00+08	t	f	t	2	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	\N	\N	\N	\N
5	5	1	1	DEMO-T-001	2026-09-03 17:00:00+08	2026-09-05 17:00:00+08	2026-09-12 17:00:00+08	t	f	t	2	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	\N	\N	\N	\N
6	6	1	1	DEMO-T-001	2026-09-09 17:00:00+08	2026-09-11 17:00:00+08	2026-09-18 17:00:00+08	t	f	t	2	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	\N	\N	\N	\N
7	7	1	1	DEMO-T-001	2026-09-15 17:00:00+08	2026-09-17 17:00:00+08	2026-09-24 17:00:00+08	t	f	t	2	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	\N	\N	\N	\N
8	8	1	1	DEMO-T-001	2026-09-06 17:00:00+08	2026-09-08 17:00:00+08	2026-09-15 17:00:00+08	t	f	t	2	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	\N	\N	\N	\N
9	9	1	1	DEMO-T-001	2026-09-13 17:00:00+08	2026-09-15 17:00:00+08	2026-09-22 17:00:00+08	t	f	t	2	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	\N	\N	\N	\N
10	10	1	1	DEMO-T-001	2026-09-27 17:00:00+08	2026-09-29 17:00:00+08	2026-10-06 17:00:00+08	f	f	t	2	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	\N	\N	\N	\N
\.


--
-- Data for Name: classwork_attachment; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.classwork_attachment (classwork_attachment_id, classwork_id, file_name, file_path, file_type, file_size, uploaded_at) FROM stdin;
\.


--
-- Data for Name: classwork_coverage; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.classwork_coverage (coverage_id, classwork_id, lesson_id, competency_id, valid_from, linked_by_staff_id, valid_until, removed_by_staff_id) FROM stdin;
1	1	2	2	2026-10-20 03:27:26.2412+08	DEMO-T-001	\N	\N
2	2	2	2	2026-10-20 03:27:26.2412+08	DEMO-T-001	\N	\N
3	3	2	2	2026-10-20 03:27:26.2412+08	DEMO-T-001	\N	\N
4	4	1	1	2026-10-20 03:27:26.2412+08	DEMO-T-001	\N	\N
5	5	3	3	2026-10-20 03:27:26.2412+08	DEMO-T-001	\N	\N
6	6	1	1	2026-10-20 03:27:26.2412+08	DEMO-T-001	\N	\N
7	7	4	4	2026-10-20 03:27:26.2412+08	DEMO-T-001	\N	\N
\.


--
-- Data for Name: classwork_lesson; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.classwork_lesson (classwork_id, lesson_id) FROM stdin;
1	2
2	2
3	2
4	1
5	3
6	1
7	4
\.


--
-- Data for Name: competency; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.competency (competency_id, competency_code, statement, description, order_index, target_hours, is_archived, subject_id, academic_period_id, created_by_staff_id, created_at, updated_at) FROM stdin;
1	DEMO-LOCAL-G9M-EQ-01	Model a contextual relationship with a one-variable linear equation, solve it, and verify the solution.	Local Grade 9 Mathematics demonstration objective; not an official curriculum competency code.	1	1	f	1	1	DEMO-T-001	2026-10-20 01:45:12.670641+08	2026-10-20 01:45:12.670641+08
2	DEMO-LOCAL-G9M-NS-01	Demonstrate number sense by applying operational properties to integers and rational numbers in real-world contexts.	Local Grade 9 Mathematics demonstration objective for number sense and signed operations; not an official curriculum competency code.	2	1	f	1	1	DEMO-T-001	2026-10-20 03:27:26.003643+08	2026-10-20 03:27:26.003643+08
3	DEMO-LOCAL-G9M-BM-01	Formulate and analyze personal and household budget allocations using arithmetic ratios, percentages, and financial constraints.	Local Grade 9 Mathematics demonstration objective for personal financial modeling and budget mathematics; not an official curriculum competency code.	3	1	f	1	1	DEMO-T-001	2026-10-20 03:27:26.003643+08	2026-10-20 03:27:26.003643+08
4	DEMO-LOCAL-G9M-DI-01	Collect, organize, summarize, and interpret bivariate or univariate numerical data using statistical measures and graphical representations.	Local Grade 9 Mathematics demonstration objective for statistical data investigation; not an official curriculum competency code.	4	1	f	1	1	DEMO-T-001	2026-10-20 03:27:26.003643+08	2026-10-20 03:27:26.003643+08
\.


--
-- Data for Name: deped_cluster; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.deped_cluster (id, code, name, category, sort_order, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: development_current_term_prediction; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.development_current_term_prediction (prediction_id, student_id, class_id, subject_id, source_period_id, target_period_id, model_version_id, revision, predicted_period_grade, intervention_level, intervention_basis, risk_score, evidence_snapshot, generated_at) FROM stdin;
47	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	1	1	1	2	1	85.25	NEEDS_MONITORING	RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE	\N	{"snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V2", "captured_at": "2026-10-19T20:15:39.435217+00:00", "generation_cutoff_at": "2026-10-19T20:15:37.944603+00:00", "model_version_id": 2, "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION", "source_period_id": 1, "target_period_id": 1, "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "projected_final_term_grade_raw": 85.24942592592595, "normalized_subject": "MATHEMATICS", "grading_weight_pattern": "20/50/30", "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []}, "model_features": [{"name": "grade_level", "value": 9.0}, {"name": "ww_weight", "value": 20.0}, {"name": "pt_weight", "value": 50.0}, {"name": "qa_weight", "value": 30.0}, {"name": "ww_available_activity_count", "value": 4.0}, {"name": "pt_available_activity_count", "value": 3.0}, {"name": "qa_available_activity_count", "value": 0.0}, {"name": "overall_available_activity_count", "value": 7.0}, {"name": "ww_points_earned_so_far", "value": 58.2}, {"name": "ww_points_possible_so_far", "value": 80.0}, {"name": "ww_percent_so_far", "value": 72.75}, {"name": "ww_weighted_score_so_far", "value": 14.55}, {"name": "pt_points_earned_so_far", "value": 78.4}, {"name": "pt_points_possible_so_far", "value": 120.0}, {"name": "pt_percent_so_far", "value": 65.3333}, {"name": "pt_weighted_score_so_far", "value": 32.6666}, {"name": "qa_points_earned_so_far", "value": 0.0}, {"name": "qa_points_possible_so_far", "value": 0.0}, {"name": "qa_percent_so_far", "value": 0.0}, {"name": "qa_weighted_score_so_far", "value": 0.0}, {"name": "observed_component_weight_sum", "value": 70.0}, {"name": "overall_weighted_score_so_far", "value": 47.2166}, {"name": "overall_partial_percent", "value": 67.4523}, {"name": "ww_has_evidence", "value": 1.0}, {"name": "pt_has_evidence", "value": 1.0}, {"name": "qa_has_evidence", "value": 0.0}, {"name": "has_any_input_evidence", "value": 1.0}, {"name": "ww_score_over_hps_count_so_far", "value": 0.0}, {"name": "pt_score_over_hps_count_so_far", "value": 0.0}, {"name": "qa_score_over_hps_count_so_far", "value": 0.0}, {"name": "subject", "value": "MATHEMATICS"}], "examination_presentation": {"status": "PARTIAL", "completed_count": 2, "components": {"SUMMATIVE_1": 82.0, "SUMMATIVE_2": 84.0, "TERM_EXAM": null}}, "intervention_reason_codes": ["PROJECTED_GRADE_85_TO_BELOW_90"], "supporting_context": {"role": "SUPPORTING_CONTEXT_ONLY", "signals": {}}}	2026-10-20 04:15:39.435217+08
48	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	1	1	1	2	1	94.30	LOW_RISK	RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE	\N	{"snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V2", "captured_at": "2026-10-19T20:15:39.708750+00:00", "generation_cutoff_at": "2026-10-19T20:15:39.456248+00:00", "model_version_id": 2, "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION", "source_period_id": 1, "target_period_id": 1, "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "projected_final_term_grade_raw": 94.30345937109561, "normalized_subject": "MATHEMATICS", "grading_weight_pattern": "20/50/30", "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []}, "model_features": [{"name": "grade_level", "value": 9.0}, {"name": "ww_weight", "value": 20.0}, {"name": "pt_weight", "value": 50.0}, {"name": "qa_weight", "value": 30.0}, {"name": "ww_available_activity_count", "value": 4.0}, {"name": "pt_available_activity_count", "value": 3.0}, {"name": "qa_available_activity_count", "value": 0.0}, {"name": "overall_available_activity_count", "value": 7.0}, {"name": "ww_points_earned_so_far", "value": 73.2}, {"name": "ww_points_possible_so_far", "value": 80.0}, {"name": "ww_percent_so_far", "value": 91.5}, {"name": "ww_weighted_score_so_far", "value": 18.3}, {"name": "pt_points_earned_so_far", "value": 111.2}, {"name": "pt_points_possible_so_far", "value": 120.0}, {"name": "pt_percent_so_far", "value": 92.6667}, {"name": "pt_weighted_score_so_far", "value": 46.3334}, {"name": "qa_points_earned_so_far", "value": 0.0}, {"name": "qa_points_possible_so_far", "value": 0.0}, {"name": "qa_percent_so_far", "value": 0.0}, {"name": "qa_weighted_score_so_far", "value": 0.0}, {"name": "observed_component_weight_sum", "value": 70.0}, {"name": "overall_weighted_score_so_far", "value": 64.6334}, {"name": "overall_partial_percent", "value": 92.3334}, {"name": "ww_has_evidence", "value": 1.0}, {"name": "pt_has_evidence", "value": 1.0}, {"name": "qa_has_evidence", "value": 0.0}, {"name": "has_any_input_evidence", "value": 1.0}, {"name": "ww_score_over_hps_count_so_far", "value": 0.0}, {"name": "pt_score_over_hps_count_so_far", "value": 0.0}, {"name": "qa_score_over_hps_count_so_far", "value": 0.0}, {"name": "subject", "value": "MATHEMATICS"}], "examination_presentation": {"status": "PARTIAL", "completed_count": 2, "components": {"SUMMATIVE_1": 92.0, "SUMMATIVE_2": 94.0, "TERM_EXAM": null}}, "intervention_reason_codes": ["PROJECTED_GRADE_90_OR_ABOVE"], "supporting_context": {"role": "SUPPORTING_CONTEXT_ONLY", "signals": {}}}	2026-10-20 04:15:39.70875+08
49	e5888450-33df-5d69-9991-8bf448c3f0d1	1	1	1	1	2	1	95.98	LOW_RISK	RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE	\N	{"snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V2", "captured_at": "2026-10-19T20:15:39.979367+00:00", "generation_cutoff_at": "2026-10-19T20:15:39.716061+00:00", "model_version_id": 2, "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION", "source_period_id": 1, "target_period_id": 1, "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "projected_final_term_grade_raw": 95.98429685592184, "normalized_subject": "MATHEMATICS", "grading_weight_pattern": "20/50/30", "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []}, "model_features": [{"name": "grade_level", "value": 9.0}, {"name": "ww_weight", "value": 20.0}, {"name": "pt_weight", "value": 50.0}, {"name": "qa_weight", "value": 30.0}, {"name": "ww_available_activity_count", "value": 4.0}, {"name": "pt_available_activity_count", "value": 3.0}, {"name": "qa_available_activity_count", "value": 0.0}, {"name": "overall_available_activity_count", "value": 7.0}, {"name": "ww_points_earned_so_far", "value": 77.2}, {"name": "ww_points_possible_so_far", "value": 80.0}, {"name": "ww_percent_so_far", "value": 96.5}, {"name": "ww_weighted_score_so_far", "value": 19.3}, {"name": "pt_points_earned_so_far", "value": 117.2}, {"name": "pt_points_possible_so_far", "value": 120.0}, {"name": "pt_percent_so_far", "value": 97.6667}, {"name": "pt_weighted_score_so_far", "value": 48.8334}, {"name": "qa_points_earned_so_far", "value": 0.0}, {"name": "qa_points_possible_so_far", "value": 0.0}, {"name": "qa_percent_so_far", "value": 0.0}, {"name": "qa_weighted_score_so_far", "value": 0.0}, {"name": "observed_component_weight_sum", "value": 70.0}, {"name": "overall_weighted_score_so_far", "value": 68.1334}, {"name": "overall_partial_percent", "value": 97.3334}, {"name": "ww_has_evidence", "value": 1.0}, {"name": "pt_has_evidence", "value": 1.0}, {"name": "qa_has_evidence", "value": 0.0}, {"name": "has_any_input_evidence", "value": 1.0}, {"name": "ww_score_over_hps_count_so_far", "value": 0.0}, {"name": "pt_score_over_hps_count_so_far", "value": 0.0}, {"name": "qa_score_over_hps_count_so_far", "value": 0.0}, {"name": "subject", "value": "MATHEMATICS"}], "examination_presentation": {"status": "PARTIAL", "completed_count": 2, "components": {"SUMMATIVE_1": 97.0, "SUMMATIVE_2": 99.0, "TERM_EXAM": null}}, "intervention_reason_codes": ["PROJECTED_GRADE_90_OR_ABOVE"], "supporting_context": {"role": "SUPPORTING_CONTEXT_ONLY", "signals": {}}}	2026-10-20 04:15:39.979367+08
50	59501866-17b8-5e3f-b979-d2a94b876e21	1	1	1	1	2	1	93.12	LOW_RISK	RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE	\N	{"snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V2", "captured_at": "2026-10-19T20:15:40.278314+00:00", "generation_cutoff_at": "2026-10-19T20:15:39.990822+00:00", "model_version_id": 2, "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION", "source_period_id": 1, "target_period_id": 1, "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "projected_final_term_grade_raw": 93.12488492117902, "normalized_subject": "MATHEMATICS", "grading_weight_pattern": "20/50/30", "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []}, "model_features": [{"name": "grade_level", "value": 9.0}, {"name": "ww_weight", "value": 20.0}, {"name": "pt_weight", "value": 50.0}, {"name": "qa_weight", "value": 30.0}, {"name": "ww_available_activity_count", "value": 4.0}, {"name": "pt_available_activity_count", "value": 3.0}, {"name": "qa_available_activity_count", "value": 0.0}, {"name": "overall_available_activity_count", "value": 7.0}, {"name": "ww_points_earned_so_far", "value": 70.8}, {"name": "ww_points_possible_so_far", "value": 80.0}, {"name": "ww_percent_so_far", "value": 88.5}, {"name": "ww_weighted_score_so_far", "value": 17.7}, {"name": "pt_points_earned_so_far", "value": 107.6}, {"name": "pt_points_possible_so_far", "value": 120.0}, {"name": "pt_percent_so_far", "value": 89.6667}, {"name": "pt_weighted_score_so_far", "value": 44.8334}, {"name": "qa_points_earned_so_far", "value": 0.0}, {"name": "qa_points_possible_so_far", "value": 0.0}, {"name": "qa_percent_so_far", "value": 0.0}, {"name": "qa_weighted_score_so_far", "value": 0.0}, {"name": "observed_component_weight_sum", "value": 70.0}, {"name": "overall_weighted_score_so_far", "value": 62.5334}, {"name": "overall_partial_percent", "value": 89.3334}, {"name": "ww_has_evidence", "value": 1.0}, {"name": "pt_has_evidence", "value": 1.0}, {"name": "qa_has_evidence", "value": 0.0}, {"name": "has_any_input_evidence", "value": 1.0}, {"name": "ww_score_over_hps_count_so_far", "value": 0.0}, {"name": "pt_score_over_hps_count_so_far", "value": 0.0}, {"name": "qa_score_over_hps_count_so_far", "value": 0.0}, {"name": "subject", "value": "MATHEMATICS"}], "examination_presentation": {"status": "PARTIAL", "completed_count": 2, "components": {"SUMMATIVE_1": 89.0, "SUMMATIVE_2": 91.0, "TERM_EXAM": null}}, "intervention_reason_codes": ["PROJECTED_GRADE_90_OR_ABOVE"], "supporting_context": {"role": "SUPPORTING_CONTEXT_ONLY", "signals": {}}}	2026-10-20 04:15:40.278314+08
51	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	1	1	1	2	1	88.84	NEEDS_MONITORING	RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE	\N	{"snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V2", "captured_at": "2026-10-19T20:15:40.567987+00:00", "generation_cutoff_at": "2026-10-19T20:15:40.284971+00:00", "model_version_id": 2, "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION", "source_period_id": 1, "target_period_id": 1, "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "projected_final_term_grade_raw": 88.84385052910048, "normalized_subject": "MATHEMATICS", "grading_weight_pattern": "20/50/30", "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []}, "model_features": [{"name": "grade_level", "value": 9.0}, {"name": "ww_weight", "value": 20.0}, {"name": "pt_weight", "value": 50.0}, {"name": "qa_weight", "value": 30.0}, {"name": "ww_available_activity_count", "value": 4.0}, {"name": "pt_available_activity_count", "value": 3.0}, {"name": "qa_available_activity_count", "value": 0.0}, {"name": "overall_available_activity_count", "value": 7.0}, {"name": "ww_points_earned_so_far", "value": 61.2}, {"name": "ww_points_possible_so_far", "value": 80.0}, {"name": "ww_percent_so_far", "value": 76.5}, {"name": "ww_weighted_score_so_far", "value": 15.3}, {"name": "pt_points_earned_so_far", "value": 93.2}, {"name": "pt_points_possible_so_far", "value": 120.0}, {"name": "pt_percent_so_far", "value": 77.6667}, {"name": "pt_weighted_score_so_far", "value": 38.8334}, {"name": "qa_points_earned_so_far", "value": 0.0}, {"name": "qa_points_possible_so_far", "value": 0.0}, {"name": "qa_percent_so_far", "value": 0.0}, {"name": "qa_weighted_score_so_far", "value": 0.0}, {"name": "observed_component_weight_sum", "value": 70.0}, {"name": "overall_weighted_score_so_far", "value": 54.1334}, {"name": "overall_partial_percent", "value": 77.3334}, {"name": "ww_has_evidence", "value": 1.0}, {"name": "pt_has_evidence", "value": 1.0}, {"name": "qa_has_evidence", "value": 0.0}, {"name": "has_any_input_evidence", "value": 1.0}, {"name": "ww_score_over_hps_count_so_far", "value": 0.0}, {"name": "pt_score_over_hps_count_so_far", "value": 0.0}, {"name": "qa_score_over_hps_count_so_far", "value": 0.0}, {"name": "subject", "value": "MATHEMATICS"}], "examination_presentation": {"status": "PARTIAL", "completed_count": 2, "components": {"SUMMATIVE_1": 77.0, "SUMMATIVE_2": 79.0, "TERM_EXAM": null}}, "intervention_reason_codes": ["PROJECTED_GRADE_85_TO_BELOW_90"], "supporting_context": {"role": "SUPPORTING_CONTEXT_ONLY", "signals": {}}}	2026-10-20 04:15:40.567987+08
52	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	1	1	1	2	1	89.27	NEEDS_MONITORING	RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE	\N	{"snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V2", "captured_at": "2026-10-19T20:15:40.830209+00:00", "generation_cutoff_at": "2026-10-19T20:15:40.574612+00:00", "model_version_id": 2, "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION", "source_period_id": 1, "target_period_id": 1, "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "projected_final_term_grade_raw": 89.27000925925927, "normalized_subject": "MATHEMATICS", "grading_weight_pattern": "20/50/30", "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []}, "model_features": [{"name": "grade_level", "value": 9.0}, {"name": "ww_weight", "value": 20.0}, {"name": "pt_weight", "value": 50.0}, {"name": "qa_weight", "value": 30.0}, {"name": "ww_available_activity_count", "value": 4.0}, {"name": "pt_available_activity_count", "value": 3.0}, {"name": "qa_available_activity_count", "value": 0.0}, {"name": "overall_available_activity_count", "value": 7.0}, {"name": "ww_points_earned_so_far", "value": 62.8}, {"name": "ww_points_possible_so_far", "value": 80.0}, {"name": "ww_percent_so_far", "value": 78.5}, {"name": "ww_weighted_score_so_far", "value": 15.7}, {"name": "pt_points_earned_so_far", "value": 95.6}, {"name": "pt_points_possible_so_far", "value": 120.0}, {"name": "pt_percent_so_far", "value": 79.6667}, {"name": "pt_weighted_score_so_far", "value": 39.8334}, {"name": "qa_points_earned_so_far", "value": 0.0}, {"name": "qa_points_possible_so_far", "value": 0.0}, {"name": "qa_percent_so_far", "value": 0.0}, {"name": "qa_weighted_score_so_far", "value": 0.0}, {"name": "observed_component_weight_sum", "value": 70.0}, {"name": "overall_weighted_score_so_far", "value": 55.5334}, {"name": "overall_partial_percent", "value": 79.3334}, {"name": "ww_has_evidence", "value": 1.0}, {"name": "pt_has_evidence", "value": 1.0}, {"name": "qa_has_evidence", "value": 0.0}, {"name": "has_any_input_evidence", "value": 1.0}, {"name": "ww_score_over_hps_count_so_far", "value": 0.0}, {"name": "pt_score_over_hps_count_so_far", "value": 0.0}, {"name": "qa_score_over_hps_count_so_far", "value": 0.0}, {"name": "subject", "value": "MATHEMATICS"}], "examination_presentation": {"status": "PARTIAL", "completed_count": 2, "components": {"SUMMATIVE_1": 79.0, "SUMMATIVE_2": 81.0, "TERM_EXAM": null}}, "intervention_reason_codes": ["PROJECTED_GRADE_85_TO_BELOW_90"], "supporting_context": {"role": "SUPPORTING_CONTEXT_ONLY", "signals": {}}}	2026-10-20 04:15:40.830209+08
53	c64e1a20-e025-5113-9f47-a49019ed27c5	1	1	1	1	2	1	85.62	NEEDS_MONITORING	RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE	\N	{"snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V2", "captured_at": "2026-10-19T20:15:41.058030+00:00", "generation_cutoff_at": "2026-10-19T20:15:40.837254+00:00", "model_version_id": 2, "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION", "source_period_id": 1, "target_period_id": 1, "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "projected_final_term_grade_raw": 85.61539454064452, "normalized_subject": "MATHEMATICS", "grading_weight_pattern": "20/50/30", "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []}, "model_features": [{"name": "grade_level", "value": 9.0}, {"name": "ww_weight", "value": 20.0}, {"name": "pt_weight", "value": 50.0}, {"name": "qa_weight", "value": 30.0}, {"name": "ww_available_activity_count", "value": 4.0}, {"name": "pt_available_activity_count", "value": 3.0}, {"name": "qa_available_activity_count", "value": 0.0}, {"name": "overall_available_activity_count", "value": 7.0}, {"name": "ww_points_earned_so_far", "value": 54.8}, {"name": "ww_points_possible_so_far", "value": 80.0}, {"name": "ww_percent_so_far", "value": 68.5}, {"name": "ww_weighted_score_so_far", "value": 13.7}, {"name": "pt_points_earned_so_far", "value": 83.6}, {"name": "pt_points_possible_so_far", "value": 120.0}, {"name": "pt_percent_so_far", "value": 69.6667}, {"name": "pt_weighted_score_so_far", "value": 34.8334}, {"name": "qa_points_earned_so_far", "value": 0.0}, {"name": "qa_points_possible_so_far", "value": 0.0}, {"name": "qa_percent_so_far", "value": 0.0}, {"name": "qa_weighted_score_so_far", "value": 0.0}, {"name": "observed_component_weight_sum", "value": 70.0}, {"name": "overall_weighted_score_so_far", "value": 48.5334}, {"name": "overall_partial_percent", "value": 69.3334}, {"name": "ww_has_evidence", "value": 1.0}, {"name": "pt_has_evidence", "value": 1.0}, {"name": "qa_has_evidence", "value": 0.0}, {"name": "has_any_input_evidence", "value": 1.0}, {"name": "ww_score_over_hps_count_so_far", "value": 0.0}, {"name": "pt_score_over_hps_count_so_far", "value": 0.0}, {"name": "qa_score_over_hps_count_so_far", "value": 0.0}, {"name": "subject", "value": "MATHEMATICS"}], "examination_presentation": {"status": "PARTIAL", "completed_count": 2, "components": {"SUMMATIVE_1": 69.0, "SUMMATIVE_2": 71.0, "TERM_EXAM": null}}, "intervention_reason_codes": ["PROJECTED_GRADE_85_TO_BELOW_90"], "supporting_context": {"role": "SUPPORTING_CONTEXT_ONLY", "signals": {}}}	2026-10-20 04:15:41.05803+08
54	28141b44-9a69-567f-88bd-3a838b4115db	1	1	1	1	2	1	94.65	LOW_RISK	RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE	\N	{"snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V2", "captured_at": "2026-10-19T20:15:41.316493+00:00", "generation_cutoff_at": "2026-10-19T20:15:41.065511+00:00", "model_version_id": 2, "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION", "source_period_id": 1, "target_period_id": 1, "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "projected_final_term_grade_raw": 94.65171027360442, "normalized_subject": "MATHEMATICS", "grading_weight_pattern": "20/50/30", "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []}, "model_features": [{"name": "grade_level", "value": 9.0}, {"name": "ww_weight", "value": 20.0}, {"name": "pt_weight", "value": 50.0}, {"name": "qa_weight", "value": 30.0}, {"name": "ww_available_activity_count", "value": 4.0}, {"name": "pt_available_activity_count", "value": 3.0}, {"name": "qa_available_activity_count", "value": 0.0}, {"name": "overall_available_activity_count", "value": 7.0}, {"name": "ww_points_earned_so_far", "value": 74.8}, {"name": "ww_points_possible_so_far", "value": 80.0}, {"name": "ww_percent_so_far", "value": 93.5}, {"name": "ww_weighted_score_so_far", "value": 18.7}, {"name": "pt_points_earned_so_far", "value": 113.6}, {"name": "pt_points_possible_so_far", "value": 120.0}, {"name": "pt_percent_so_far", "value": 94.6667}, {"name": "pt_weighted_score_so_far", "value": 47.3334}, {"name": "qa_points_earned_so_far", "value": 0.0}, {"name": "qa_points_possible_so_far", "value": 0.0}, {"name": "qa_percent_so_far", "value": 0.0}, {"name": "qa_weighted_score_so_far", "value": 0.0}, {"name": "observed_component_weight_sum", "value": 70.0}, {"name": "overall_weighted_score_so_far", "value": 66.0334}, {"name": "overall_partial_percent", "value": 94.3334}, {"name": "ww_has_evidence", "value": 1.0}, {"name": "pt_has_evidence", "value": 1.0}, {"name": "qa_has_evidence", "value": 0.0}, {"name": "has_any_input_evidence", "value": 1.0}, {"name": "ww_score_over_hps_count_so_far", "value": 0.0}, {"name": "pt_score_over_hps_count_so_far", "value": 0.0}, {"name": "qa_score_over_hps_count_so_far", "value": 0.0}, {"name": "subject", "value": "MATHEMATICS"}], "examination_presentation": {"status": "PARTIAL", "completed_count": 2, "components": {"SUMMATIVE_1": 94.0, "SUMMATIVE_2": 96.0, "TERM_EXAM": null}}, "intervention_reason_codes": ["PROJECTED_GRADE_90_OR_ABOVE"], "supporting_context": {"role": "SUPPORTING_CONTEXT_ONLY", "signals": {}}}	2026-10-20 04:15:41.316493+08
55	02361276-31c5-5e69-a622-b7220472edd3	1	1	1	1	2	1	87.28	NEEDS_MONITORING	RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE	\N	{"snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V2", "captured_at": "2026-10-19T20:15:41.555162+00:00", "generation_cutoff_at": "2026-10-19T20:15:41.322346+00:00", "model_version_id": 2, "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION", "source_period_id": 1, "target_period_id": 1, "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "projected_final_term_grade_raw": 87.28456349206354, "normalized_subject": "MATHEMATICS", "grading_weight_pattern": "20/50/30", "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []}, "model_features": [{"name": "grade_level", "value": 9.0}, {"name": "ww_weight", "value": 20.0}, {"name": "pt_weight", "value": 50.0}, {"name": "qa_weight", "value": 30.0}, {"name": "ww_available_activity_count", "value": 2.0}, {"name": "pt_available_activity_count", "value": 2.0}, {"name": "qa_available_activity_count", "value": 0.0}, {"name": "overall_available_activity_count", "value": 4.0}, {"name": "ww_points_earned_so_far", "value": 24.0}, {"name": "ww_points_possible_so_far", "value": 40.0}, {"name": "ww_percent_so_far", "value": 60.0}, {"name": "ww_weighted_score_so_far", "value": 12.0}, {"name": "pt_points_earned_so_far", "value": 63.0}, {"name": "pt_points_possible_so_far", "value": 80.0}, {"name": "pt_percent_so_far", "value": 78.75}, {"name": "pt_weighted_score_so_far", "value": 39.375}, {"name": "qa_points_earned_so_far", "value": 0.0}, {"name": "qa_points_possible_so_far", "value": 0.0}, {"name": "qa_percent_so_far", "value": 0.0}, {"name": "qa_weighted_score_so_far", "value": 0.0}, {"name": "observed_component_weight_sum", "value": 70.0}, {"name": "overall_weighted_score_so_far", "value": 51.375}, {"name": "overall_partial_percent", "value": 73.3929}, {"name": "ww_has_evidence", "value": 1.0}, {"name": "pt_has_evidence", "value": 1.0}, {"name": "qa_has_evidence", "value": 0.0}, {"name": "has_any_input_evidence", "value": 1.0}, {"name": "ww_score_over_hps_count_so_far", "value": 0.0}, {"name": "pt_score_over_hps_count_so_far", "value": 0.0}, {"name": "qa_score_over_hps_count_so_far", "value": 0.0}, {"name": "subject", "value": "MATHEMATICS"}], "examination_presentation": {"status": "NOT_STARTED", "completed_count": 0, "components": {"SUMMATIVE_1": null, "SUMMATIVE_2": null, "TERM_EXAM": null}}, "intervention_reason_codes": ["PROJECTED_GRADE_85_TO_BELOW_90"], "supporting_context": {"role": "SUPPORTING_CONTEXT_ONLY", "signals": {}}}	2026-10-20 04:15:41.555162+08
56	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	1	1	1	2	1	91.91	LOW_RISK	RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE	\N	{"snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V2", "captured_at": "2026-10-19T20:15:41.820977+00:00", "generation_cutoff_at": "2026-10-19T20:15:41.561292+00:00", "model_version_id": 2, "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION", "source_period_id": 1, "target_period_id": 1, "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "projected_final_term_grade_raw": 91.91305850168345, "normalized_subject": "MATHEMATICS", "grading_weight_pattern": "20/50/30", "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []}, "model_features": [{"name": "grade_level", "value": 9.0}, {"name": "ww_weight", "value": 20.0}, {"name": "pt_weight", "value": 50.0}, {"name": "qa_weight", "value": 30.0}, {"name": "ww_available_activity_count", "value": 4.0}, {"name": "pt_available_activity_count", "value": 3.0}, {"name": "qa_available_activity_count", "value": 0.0}, {"name": "overall_available_activity_count", "value": 7.0}, {"name": "ww_points_earned_so_far", "value": 69.2}, {"name": "ww_points_possible_so_far", "value": 80.0}, {"name": "ww_percent_so_far", "value": 86.5}, {"name": "ww_weighted_score_so_far", "value": 17.3}, {"name": "pt_points_earned_so_far", "value": 105.2}, {"name": "pt_points_possible_so_far", "value": 120.0}, {"name": "pt_percent_so_far", "value": 87.6667}, {"name": "pt_weighted_score_so_far", "value": 43.8334}, {"name": "qa_points_earned_so_far", "value": 0.0}, {"name": "qa_points_possible_so_far", "value": 0.0}, {"name": "qa_percent_so_far", "value": 0.0}, {"name": "qa_weighted_score_so_far", "value": 0.0}, {"name": "observed_component_weight_sum", "value": 70.0}, {"name": "overall_weighted_score_so_far", "value": 61.1334}, {"name": "overall_partial_percent", "value": 87.3334}, {"name": "ww_has_evidence", "value": 1.0}, {"name": "pt_has_evidence", "value": 1.0}, {"name": "qa_has_evidence", "value": 0.0}, {"name": "has_any_input_evidence", "value": 1.0}, {"name": "ww_score_over_hps_count_so_far", "value": 0.0}, {"name": "pt_score_over_hps_count_so_far", "value": 0.0}, {"name": "qa_score_over_hps_count_so_far", "value": 0.0}, {"name": "subject", "value": "MATHEMATICS"}], "examination_presentation": {"status": "PARTIAL", "completed_count": 2, "components": {"SUMMATIVE_1": 87.0, "SUMMATIVE_2": 89.0, "TERM_EXAM": null}}, "intervention_reason_codes": ["PROJECTED_GRADE_90_OR_ABOVE"], "supporting_context": {"role": "SUPPORTING_CONTEXT_ONLY", "signals": {}}}	2026-10-20 04:15:41.820977+08
57	84de62ab-c6cc-5305-a06b-964a71fb0c21	1	1	1	1	2	1	83.27	MODERATE_RISK	RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE	\N	{"snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V2", "captured_at": "2026-10-19T20:15:42.056028+00:00", "generation_cutoff_at": "2026-10-19T20:15:41.826742+00:00", "model_version_id": 2, "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION", "source_period_id": 1, "target_period_id": 1, "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "projected_final_term_grade_raw": 83.27475180375184, "normalized_subject": "MATHEMATICS", "grading_weight_pattern": "20/50/30", "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []}, "model_features": [{"name": "grade_level", "value": 9.0}, {"name": "ww_weight", "value": 20.0}, {"name": "pt_weight", "value": 50.0}, {"name": "qa_weight", "value": 30.0}, {"name": "ww_available_activity_count", "value": 2.0}, {"name": "pt_available_activity_count", "value": 2.0}, {"name": "qa_available_activity_count", "value": 0.0}, {"name": "overall_available_activity_count", "value": 4.0}, {"name": "ww_points_earned_so_far", "value": 18.0}, {"name": "ww_points_possible_so_far", "value": 40.0}, {"name": "ww_percent_so_far", "value": 45.0}, {"name": "ww_weighted_score_so_far", "value": 9.0}, {"name": "pt_points_earned_so_far", "value": 52.0}, {"name": "pt_points_possible_so_far", "value": 80.0}, {"name": "pt_percent_so_far", "value": 65.0}, {"name": "pt_weighted_score_so_far", "value": 32.5}, {"name": "qa_points_earned_so_far", "value": 0.0}, {"name": "qa_points_possible_so_far", "value": 0.0}, {"name": "qa_percent_so_far", "value": 0.0}, {"name": "qa_weighted_score_so_far", "value": 0.0}, {"name": "observed_component_weight_sum", "value": 70.0}, {"name": "overall_weighted_score_so_far", "value": 41.5}, {"name": "overall_partial_percent", "value": 59.2857}, {"name": "ww_has_evidence", "value": 1.0}, {"name": "pt_has_evidence", "value": 1.0}, {"name": "qa_has_evidence", "value": 0.0}, {"name": "has_any_input_evidence", "value": 1.0}, {"name": "ww_score_over_hps_count_so_far", "value": 0.0}, {"name": "pt_score_over_hps_count_so_far", "value": 0.0}, {"name": "qa_score_over_hps_count_so_far", "value": 0.0}, {"name": "subject", "value": "MATHEMATICS"}], "examination_presentation": {"status": "NOT_STARTED", "completed_count": 0, "components": {"SUMMATIVE_1": null, "SUMMATIVE_2": null, "TERM_EXAM": null}}, "intervention_reason_codes": ["PROJECTED_GRADE_75_TO_BELOW_85"], "supporting_context": {"role": "SUPPORTING_CONTEXT_ONLY", "signals": {}}}	2026-10-20 04:15:42.056028+08
58	84de62ab-c6cc-5305-a06b-964a71fb0c21	1	1	1	1	2	2	83.27	MODERATE_RISK	RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE	\N	{"snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V2", "captured_at": "2026-10-19T20:19:31.520155+00:00", "generation_cutoff_at": "2026-10-19T20:19:28.058863+00:00", "model_version_id": 2, "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION", "source_period_id": 1, "target_period_id": 1, "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "projected_final_term_grade_raw": 83.27475180375183, "normalized_subject": "MATHEMATICS", "grading_weight_pattern": "20/50/30", "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []}, "model_features": [{"name": "grade_level", "value": 9.0}, {"name": "ww_weight", "value": 20.0}, {"name": "pt_weight", "value": 50.0}, {"name": "qa_weight", "value": 30.0}, {"name": "ww_available_activity_count", "value": 2.0}, {"name": "pt_available_activity_count", "value": 2.0}, {"name": "qa_available_activity_count", "value": 0.0}, {"name": "overall_available_activity_count", "value": 4.0}, {"name": "ww_points_earned_so_far", "value": 18.0}, {"name": "ww_points_possible_so_far", "value": 40.0}, {"name": "ww_percent_so_far", "value": 45.0}, {"name": "ww_weighted_score_so_far", "value": 9.0}, {"name": "pt_points_earned_so_far", "value": 52.0}, {"name": "pt_points_possible_so_far", "value": 80.0}, {"name": "pt_percent_so_far", "value": 65.0}, {"name": "pt_weighted_score_so_far", "value": 32.5}, {"name": "qa_points_earned_so_far", "value": 0.0}, {"name": "qa_points_possible_so_far", "value": 0.0}, {"name": "qa_percent_so_far", "value": 0.0}, {"name": "qa_weighted_score_so_far", "value": 0.0}, {"name": "observed_component_weight_sum", "value": 70.0}, {"name": "overall_weighted_score_so_far", "value": 41.5}, {"name": "overall_partial_percent", "value": 59.2857}, {"name": "ww_has_evidence", "value": 1.0}, {"name": "pt_has_evidence", "value": 1.0}, {"name": "qa_has_evidence", "value": 0.0}, {"name": "has_any_input_evidence", "value": 1.0}, {"name": "ww_score_over_hps_count_so_far", "value": 0.0}, {"name": "pt_score_over_hps_count_so_far", "value": 0.0}, {"name": "qa_score_over_hps_count_so_far", "value": 0.0}, {"name": "subject", "value": "MATHEMATICS"}], "examination_presentation": {"status": "PARTIAL", "completed_count": 1, "components": {"SUMMATIVE_1": null, "SUMMATIVE_2": 66.67, "TERM_EXAM": null}}, "intervention_reason_codes": ["PROJECTED_GRADE_75_TO_BELOW_85"], "supporting_context": {"role": "SUPPORTING_CONTEXT_ONLY", "signals": {}}}	2026-10-20 04:19:31.520155+08
59	84de62ab-c6cc-5305-a06b-964a71fb0c21	1	1	1	1	2	3	83.27	MODERATE_RISK	RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE	\N	{"snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V2", "captured_at": "2026-10-19T20:19:40.566693+00:00", "generation_cutoff_at": "2026-10-19T20:19:40.064930+00:00", "model_version_id": 2, "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION", "source_period_id": 1, "target_period_id": 1, "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "projected_final_term_grade_raw": 83.2747518037518, "normalized_subject": "MATHEMATICS", "grading_weight_pattern": "20/50/30", "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []}, "model_features": [{"name": "grade_level", "value": 9.0}, {"name": "ww_weight", "value": 20.0}, {"name": "pt_weight", "value": 50.0}, {"name": "qa_weight", "value": 30.0}, {"name": "ww_available_activity_count", "value": 2.0}, {"name": "pt_available_activity_count", "value": 2.0}, {"name": "qa_available_activity_count", "value": 0.0}, {"name": "overall_available_activity_count", "value": 4.0}, {"name": "ww_points_earned_so_far", "value": 18.0}, {"name": "ww_points_possible_so_far", "value": 40.0}, {"name": "ww_percent_so_far", "value": 45.0}, {"name": "ww_weighted_score_so_far", "value": 9.0}, {"name": "pt_points_earned_so_far", "value": 52.0}, {"name": "pt_points_possible_so_far", "value": 80.0}, {"name": "pt_percent_so_far", "value": 65.0}, {"name": "pt_weighted_score_so_far", "value": 32.5}, {"name": "qa_points_earned_so_far", "value": 0.0}, {"name": "qa_points_possible_so_far", "value": 0.0}, {"name": "qa_percent_so_far", "value": 0.0}, {"name": "qa_weighted_score_so_far", "value": 0.0}, {"name": "observed_component_weight_sum", "value": 70.0}, {"name": "overall_weighted_score_so_far", "value": 41.5}, {"name": "overall_partial_percent", "value": 59.2857}, {"name": "ww_has_evidence", "value": 1.0}, {"name": "pt_has_evidence", "value": 1.0}, {"name": "qa_has_evidence", "value": 0.0}, {"name": "has_any_input_evidence", "value": 1.0}, {"name": "ww_score_over_hps_count_so_far", "value": 0.0}, {"name": "pt_score_over_hps_count_so_far", "value": 0.0}, {"name": "qa_score_over_hps_count_so_far", "value": 0.0}, {"name": "subject", "value": "MATHEMATICS"}], "examination_presentation": {"status": "PARTIAL", "completed_count": 2, "components": {"SUMMATIVE_1": 66.67, "SUMMATIVE_2": 66.67, "TERM_EXAM": null}}, "intervention_reason_codes": ["PROJECTED_GRADE_75_TO_BELOW_85"], "supporting_context": {"role": "SUPPORTING_CONTEXT_ONLY", "signals": {}}}	2026-10-20 04:19:40.566693+08
60	84de62ab-c6cc-5305-a06b-964a71fb0c21	1	1	1	1	2	4	83.14	MODERATE_RISK	RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE	\N	{"snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V2", "captured_at": "2026-10-19T20:19:56.399379+00:00", "generation_cutoff_at": "2026-10-19T20:19:55.928596+00:00", "model_version_id": 2, "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION", "source_period_id": 1, "target_period_id": 1, "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "projected_final_term_grade_raw": 83.14486688311689, "normalized_subject": "MATHEMATICS", "grading_weight_pattern": "20/50/30", "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []}, "model_features": [{"name": "grade_level", "value": 9.0}, {"name": "ww_weight", "value": 20.0}, {"name": "pt_weight", "value": 50.0}, {"name": "qa_weight", "value": 30.0}, {"name": "ww_available_activity_count", "value": 2.0}, {"name": "pt_available_activity_count", "value": 3.0}, {"name": "qa_available_activity_count", "value": 0.0}, {"name": "overall_available_activity_count", "value": 5.0}, {"name": "ww_points_earned_so_far", "value": 18.0}, {"name": "ww_points_possible_so_far", "value": 40.0}, {"name": "ww_percent_so_far", "value": 45.0}, {"name": "ww_weighted_score_so_far", "value": 9.0}, {"name": "pt_points_earned_so_far", "value": 82.0}, {"name": "pt_points_possible_so_far", "value": 120.0}, {"name": "pt_percent_so_far", "value": 68.3333}, {"name": "pt_weighted_score_so_far", "value": 34.1666}, {"name": "qa_points_earned_so_far", "value": 0.0}, {"name": "qa_points_possible_so_far", "value": 0.0}, {"name": "qa_percent_so_far", "value": 0.0}, {"name": "qa_weighted_score_so_far", "value": 0.0}, {"name": "observed_component_weight_sum", "value": 70.0}, {"name": "overall_weighted_score_so_far", "value": 43.1666}, {"name": "overall_partial_percent", "value": 61.6666}, {"name": "ww_has_evidence", "value": 1.0}, {"name": "pt_has_evidence", "value": 1.0}, {"name": "qa_has_evidence", "value": 0.0}, {"name": "has_any_input_evidence", "value": 1.0}, {"name": "ww_score_over_hps_count_so_far", "value": 0.0}, {"name": "pt_score_over_hps_count_so_far", "value": 0.0}, {"name": "qa_score_over_hps_count_so_far", "value": 0.0}, {"name": "subject", "value": "MATHEMATICS"}], "examination_presentation": {"status": "PARTIAL", "completed_count": 2, "components": {"SUMMATIVE_1": 66.67, "SUMMATIVE_2": 66.67, "TERM_EXAM": null}}, "intervention_reason_codes": ["PROJECTED_GRADE_75_TO_BELOW_85"], "supporting_context": {"role": "SUPPORTING_CONTEXT_ONLY", "signals": {}}}	2026-10-20 04:19:56.399379+08
61	84de62ab-c6cc-5305-a06b-964a71fb0c21	1	1	1	1	2	5	83.14	MODERATE_RISK	RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE	\N	{"snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V2", "captured_at": "2026-10-19T20:21:18.054509+00:00", "generation_cutoff_at": "2026-10-19T20:21:17.546791+00:00", "model_version_id": 2, "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION", "source_period_id": 1, "target_period_id": 1, "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "projected_final_term_grade_raw": 83.1448668831169, "normalized_subject": "MATHEMATICS", "grading_weight_pattern": "20/50/30", "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []}, "model_features": [{"name": "grade_level", "value": 9.0}, {"name": "ww_weight", "value": 20.0}, {"name": "pt_weight", "value": 50.0}, {"name": "qa_weight", "value": 30.0}, {"name": "ww_available_activity_count", "value": 2.0}, {"name": "pt_available_activity_count", "value": 3.0}, {"name": "qa_available_activity_count", "value": 0.0}, {"name": "overall_available_activity_count", "value": 5.0}, {"name": "ww_points_earned_so_far", "value": 18.0}, {"name": "ww_points_possible_so_far", "value": 40.0}, {"name": "ww_percent_so_far", "value": 45.0}, {"name": "ww_weighted_score_so_far", "value": 9.0}, {"name": "pt_points_earned_so_far", "value": 82.0}, {"name": "pt_points_possible_so_far", "value": 120.0}, {"name": "pt_percent_so_far", "value": 68.3333}, {"name": "pt_weighted_score_so_far", "value": 34.1666}, {"name": "qa_points_earned_so_far", "value": 0.0}, {"name": "qa_points_possible_so_far", "value": 0.0}, {"name": "qa_percent_so_far", "value": 0.0}, {"name": "qa_weighted_score_so_far", "value": 0.0}, {"name": "observed_component_weight_sum", "value": 70.0}, {"name": "overall_weighted_score_so_far", "value": 43.1666}, {"name": "overall_partial_percent", "value": 61.6666}, {"name": "ww_has_evidence", "value": 1.0}, {"name": "pt_has_evidence", "value": 1.0}, {"name": "qa_has_evidence", "value": 0.0}, {"name": "has_any_input_evidence", "value": 1.0}, {"name": "ww_score_over_hps_count_so_far", "value": 0.0}, {"name": "pt_score_over_hps_count_so_far", "value": 0.0}, {"name": "qa_score_over_hps_count_so_far", "value": 0.0}, {"name": "subject", "value": "MATHEMATICS"}], "examination_presentation": {"status": "PARTIAL", "completed_count": 1, "components": {"SUMMATIVE_1": 66.67, "SUMMATIVE_2": null, "TERM_EXAM": null}}, "intervention_reason_codes": ["PROJECTED_GRADE_75_TO_BELOW_85"], "supporting_context": {"role": "SUPPORTING_CONTEXT_ONLY", "signals": {}}}	2026-10-20 04:21:18.054509+08
62	84de62ab-c6cc-5305-a06b-964a71fb0c21	1	1	1	1	2	6	83.14	MODERATE_RISK	RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE	\N	{"snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V2", "captured_at": "2026-10-19T20:21:24.077531+00:00", "generation_cutoff_at": "2026-10-19T20:21:23.628962+00:00", "model_version_id": 2, "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION", "source_period_id": 1, "target_period_id": 1, "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "projected_final_term_grade_raw": 83.14486688311689, "normalized_subject": "MATHEMATICS", "grading_weight_pattern": "20/50/30", "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []}, "model_features": [{"name": "grade_level", "value": 9.0}, {"name": "ww_weight", "value": 20.0}, {"name": "pt_weight", "value": 50.0}, {"name": "qa_weight", "value": 30.0}, {"name": "ww_available_activity_count", "value": 2.0}, {"name": "pt_available_activity_count", "value": 3.0}, {"name": "qa_available_activity_count", "value": 0.0}, {"name": "overall_available_activity_count", "value": 5.0}, {"name": "ww_points_earned_so_far", "value": 18.0}, {"name": "ww_points_possible_so_far", "value": 40.0}, {"name": "ww_percent_so_far", "value": 45.0}, {"name": "ww_weighted_score_so_far", "value": 9.0}, {"name": "pt_points_earned_so_far", "value": 82.0}, {"name": "pt_points_possible_so_far", "value": 120.0}, {"name": "pt_percent_so_far", "value": 68.3333}, {"name": "pt_weighted_score_so_far", "value": 34.1666}, {"name": "qa_points_earned_so_far", "value": 0.0}, {"name": "qa_points_possible_so_far", "value": 0.0}, {"name": "qa_percent_so_far", "value": 0.0}, {"name": "qa_weighted_score_so_far", "value": 0.0}, {"name": "observed_component_weight_sum", "value": 70.0}, {"name": "overall_weighted_score_so_far", "value": 43.1666}, {"name": "overall_partial_percent", "value": 61.6666}, {"name": "ww_has_evidence", "value": 1.0}, {"name": "pt_has_evidence", "value": 1.0}, {"name": "qa_has_evidence", "value": 0.0}, {"name": "has_any_input_evidence", "value": 1.0}, {"name": "ww_score_over_hps_count_so_far", "value": 0.0}, {"name": "pt_score_over_hps_count_so_far", "value": 0.0}, {"name": "qa_score_over_hps_count_so_far", "value": 0.0}, {"name": "subject", "value": "MATHEMATICS"}], "examination_presentation": {"status": "NOT_STARTED", "completed_count": 0, "components": {"SUMMATIVE_1": null, "SUMMATIVE_2": null, "TERM_EXAM": null}}, "intervention_reason_codes": ["PROJECTED_GRADE_75_TO_BELOW_85"], "supporting_context": {"role": "SUPPORTING_CONTEXT_ONLY", "signals": {}}}	2026-10-20 04:21:24.077531+08
63	84de62ab-c6cc-5305-a06b-964a71fb0c21	1	1	1	1	2	7	83.27	MODERATE_RISK	RULE_BASED_FROM_PROJECTED_FINAL_TERM_GRADE	\N	{"snapshot_version": "CURRENT_TERM_V3_EVIDENCE_V2", "captured_at": "2026-10-19T20:21:30.756638+00:00", "generation_cutoff_at": "2026-10-19T20:21:30.316032+00:00", "model_version_id": 2, "prediction_purpose": "CURRENT_TERM_FINAL_GRADE_PROJECTION", "source_period_id": 1, "target_period_id": 1, "feature_schema_version": "sha256:36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "feature_schema_sha256": "36d8445afa9ef4675fa06442f04b7123bf4b45c9342807d771c9f1410ee19562", "artifact_sha256": "f9e9fa20d617e73ccfde292c0dfc729456a4d844f86216fbf530eee9e21a94cc", "training_dataset_version": "sha256:789879391162415bf2df25630e7bd65be0838a0b73b3e3cc62579e9e0019f5a1", "projected_final_term_grade_raw": 83.27475180375181, "normalized_subject": "MATHEMATICS", "grading_weight_pattern": "20/50/30", "readiness": {"status": "READY", "level": "STANDARD_READY", "reason_codes": []}, "model_features": [{"name": "grade_level", "value": 9.0}, {"name": "ww_weight", "value": 20.0}, {"name": "pt_weight", "value": 50.0}, {"name": "qa_weight", "value": 30.0}, {"name": "ww_available_activity_count", "value": 2.0}, {"name": "pt_available_activity_count", "value": 2.0}, {"name": "qa_available_activity_count", "value": 0.0}, {"name": "overall_available_activity_count", "value": 4.0}, {"name": "ww_points_earned_so_far", "value": 18.0}, {"name": "ww_points_possible_so_far", "value": 40.0}, {"name": "ww_percent_so_far", "value": 45.0}, {"name": "ww_weighted_score_so_far", "value": 9.0}, {"name": "pt_points_earned_so_far", "value": 52.0}, {"name": "pt_points_possible_so_far", "value": 80.0}, {"name": "pt_percent_so_far", "value": 65.0}, {"name": "pt_weighted_score_so_far", "value": 32.5}, {"name": "qa_points_earned_so_far", "value": 0.0}, {"name": "qa_points_possible_so_far", "value": 0.0}, {"name": "qa_percent_so_far", "value": 0.0}, {"name": "qa_weighted_score_so_far", "value": 0.0}, {"name": "observed_component_weight_sum", "value": 70.0}, {"name": "overall_weighted_score_so_far", "value": 41.5}, {"name": "overall_partial_percent", "value": 59.2857}, {"name": "ww_has_evidence", "value": 1.0}, {"name": "pt_has_evidence", "value": 1.0}, {"name": "qa_has_evidence", "value": 0.0}, {"name": "has_any_input_evidence", "value": 1.0}, {"name": "ww_score_over_hps_count_so_far", "value": 0.0}, {"name": "pt_score_over_hps_count_so_far", "value": 0.0}, {"name": "qa_score_over_hps_count_so_far", "value": 0.0}, {"name": "subject", "value": "MATHEMATICS"}], "examination_presentation": {"status": "NOT_STARTED", "completed_count": 0, "components": {"SUMMATIVE_1": null, "SUMMATIVE_2": null, "TERM_EXAM": null}}, "intervention_reason_codes": ["PROJECTED_GRADE_75_TO_BELOW_85"], "supporting_context": {"role": "SUPPORTING_CONTEXT_ONLY", "signals": {}}}	2026-10-20 04:21:30.756638+08
\.


--
-- Data for Name: grade_submission_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.grade_submission_log (id, student_period_grade_id, student_id, class_id, subject_id, academic_period_id, written_work_percent, performance_task_percent, quarterly_assessment_percent, initial_grade, transmuted_grade, final_period_grade, submitted_by_staff_id, submitted_at, submission_type, remarks) FROM stdin;
\.


--
-- Data for Name: grading_template; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.grading_template (grading_template_id, template_name, description, status, created_at, updated_at, passing_threshold) FROM stdin;
1	Core	\N	active	2026-09-23 21:31:00.305889+08	2026-10-19 22:47:30.196318+08	87.00
10	Applied	\N	active	2026-10-19 22:47:30.196318+08	2026-10-19 22:47:30.196318+08	85.00
8	Specialized	\N	active	2026-10-19 22:47:30.196318+08	2026-10-19 22:47:30.196318+08	85.00
\.


--
-- Data for Name: grading_template_component; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.grading_template_component (component_id, grading_template_id, component_name, weight, display_order, created_at, updated_at) FROM stdin;
4	1	Written Work	20.00	1	2026-10-19 22:47:30.196318+08	2026-10-19 22:47:30.196318+08
5	1	Performance Tasks	50.00	2	2026-10-19 22:47:30.196318+08	2026-10-19 22:47:30.196318+08
6	1	Exams	30.00	3	2026-10-19 22:47:30.196318+08	2026-10-19 22:47:30.196318+08
7	10	Written Work	20.00	1	2026-10-19 22:47:30.196318+08	2026-10-19 22:47:30.196318+08
8	10	Performance Tasks	60.00	2	2026-10-19 22:47:30.196318+08	2026-10-19 22:47:30.196318+08
9	10	Exams	20.00	3	2026-10-19 22:47:30.196318+08	2026-10-19 22:47:30.196318+08
10	8	Written Work	20.00	1	2026-10-19 22:47:30.196318+08	2026-10-19 22:47:30.196318+08
11	8	Performance Tasks	50.00	2	2026-10-19 22:47:30.196318+08	2026-10-19 22:47:30.196318+08
12	8	Exams	30.00	3	2026-10-19 22:47:30.196318+08	2026-10-19 22:47:30.196318+08
\.


--
-- Data for Name: intervention; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.intervention (intervention_id, student_id, class_id, subject_id, academic_period_id, source_prediction_id, status, resolution_reason, created_at, activated_at, activated_by_staff_id, resolved_at, diagnosis_snapshot, remediation_plan) FROM stdin;
6	84de62ab-c6cc-5305-a06b-964a71fb0c21	1	1	1	57	CANDIDATE	\N	2026-10-20 04:15:41.8271+08	\N	\N	\N	{"snapshot_version": "INTERVENTION_DIAGNOSIS_V2", "diagnosis_status": "AVAILABLE", "captured_at": "2026-10-19T20:15:42.095914+00:00", "source_prediction_id": 57, "student_id": "84de62ab-c6cc-5305-a06b-964a71fb0c21", "class_id": 1, "subject_id": 1, "academic_period_id": 1, "evidence_cutoff_at": "2026-10-19T20:15:41.826742+00:00", "components": {"WRITTEN_WORK": {"evidence_state": "AVAILABLE", "percent": 45.0, "model_observation_count": 2}, "PERFORMANCE_TASK": {"evidence_state": "AVAILABLE", "percent": 65.0, "model_observation_count": 2}, "EXAMINATION": {"evidence_state": "UNAVAILABLE", "percent": null, "model_observation_count": 0}}, "weakest_supported_components": ["WRITTEN_WORK"], "supporting_activities": [{"classwork_id": 1, "classwork_assignment_id": 1, "submission_id": 115, "title": "DEMO - WW 1 - Number Sense", "activity_mode": "MANUAL", "component": "WRITTEN_WORK", "exam_subtype": null, "score": 8.0, "possible_score": 20.0, "percent": 40.0}, {"classwork_id": 4, "classwork_assignment_id": 4, "submission_id": 116, "title": "DEMO - WW 4 - Algebraic Expressions", "activity_mode": "MANUAL", "component": "WRITTEN_WORK", "exam_subtype": null, "score": 10.0, "possible_score": 20.0, "percent": 50.0}, {"classwork_id": 5, "classwork_assignment_id": 5, "submission_id": 117, "title": "DEMO - PT 1 - Budget Mathematics", "activity_mode": "MANUAL", "component": "PERFORMANCE_TASK", "exam_subtype": null, "score": 26.0, "possible_score": 40.0, "percent": 65.0}, {"classwork_id": 7, "classwork_assignment_id": 7, "submission_id": 118, "title": "DEMO - PT 3 - Data Investigation", "activity_mode": "MANUAL", "component": "PERFORMANCE_TASK", "exam_subtype": null, "score": 26.0, "possible_score": 40.0, "percent": 65.0}], "manual_assessment_coverage": [{"classwork_id": 1, "classwork_assignment_id": 1, "submission_id": 115, "title": "DEMO - WW 1 - Number Sense", "activity_mode": "MANUAL", "component": "WRITTEN_WORK", "exam_subtype": null, "score": 8.0, "possible_score": 20.0, "percent": 40.0, "evidence_cutoff_at": "2026-10-19T20:15:41.826742+00:00", "coverage_provenance": "TEACHER_ASSERTED_ASSESSMENT_COVERAGE", "score_scope": "ASSESSMENT_TOTAL_ONLY", "competency_score_attribution": "NONE_SHARED_TOTAL_SCORE", "in_weakest_supported_component": true, "coverage_links": [{"coverage_id": 1, "lesson_id": 2, "competency_id": 2, "valid_from": "2026-10-19T19:27:26.241200+00:00", "valid_until": null, "linked_by_staff_id": "DEMO-T-001", "provenance": "TEACHER_ASSERTED_ASSESSMENT_COVERAGE"}], "covered_lessons": [{"lesson_id": 2, "title": "DEMO - Number Systems: Integers and Rational Numbers"}], "covered_competencies": [{"competency_id": 2, "competency_code": "DEMO-LOCAL-G9M-NS-01", "competency_statement": "Demonstrate number sense by applying operational properties to integers and rational numbers in real-world contexts."}]}, {"classwork_id": 4, "classwork_assignment_id": 4, "submission_id": 116, "title": "DEMO - WW 4 - Algebraic Expressions", "activity_mode": "MANUAL", "component": "WRITTEN_WORK", "exam_subtype": null, "score": 10.0, "possible_score": 20.0, "percent": 50.0, "evidence_cutoff_at": "2026-10-19T20:15:41.826742+00:00", "coverage_provenance": "TEACHER_ASSERTED_ASSESSMENT_COVERAGE", "score_scope": "ASSESSMENT_TOTAL_ONLY", "competency_score_attribution": "NONE_SHARED_TOTAL_SCORE", "in_weakest_supported_component": true, "coverage_links": [{"coverage_id": 4, "lesson_id": 1, "competency_id": 1, "valid_from": "2026-10-19T19:27:26.241200+00:00", "valid_until": null, "linked_by_staff_id": "DEMO-T-001", "provenance": "TEACHER_ASSERTED_ASSESSMENT_COVERAGE"}], "covered_lessons": [{"lesson_id": 1, "title": "DEMO - Equation Modeling with One-Variable Linear Equations"}], "covered_competencies": [{"competency_id": 1, "competency_code": "DEMO-LOCAL-G9M-EQ-01", "competency_statement": "Model a contextual relationship with a one-variable linear equation, solve it, and verify the solution."}]}, {"classwork_id": 5, "classwork_assignment_id": 5, "submission_id": 117, "title": "DEMO - PT 1 - Budget Mathematics", "activity_mode": "MANUAL", "component": "PERFORMANCE_TASK", "exam_subtype": null, "score": 26.0, "possible_score": 40.0, "percent": 65.0, "evidence_cutoff_at": "2026-10-19T20:15:41.826742+00:00", "coverage_provenance": "TEACHER_ASSERTED_ASSESSMENT_COVERAGE", "score_scope": "ASSESSMENT_TOTAL_ONLY", "competency_score_attribution": "NONE_SHARED_TOTAL_SCORE", "in_weakest_supported_component": false, "coverage_links": [{"coverage_id": 5, "lesson_id": 3, "competency_id": 3, "valid_from": "2026-10-19T19:27:26.241200+00:00", "valid_until": null, "linked_by_staff_id": "DEMO-T-001", "provenance": "TEACHER_ASSERTED_ASSESSMENT_COVERAGE"}], "covered_lessons": [{"lesson_id": 3, "title": "DEMO - Budget Mathematics and Financial Modeling"}], "covered_competencies": [{"competency_id": 3, "competency_code": "DEMO-LOCAL-G9M-BM-01", "competency_statement": "Formulate and analyze personal and household budget allocations using arithmetic ratios, percentages, and financial constraints."}]}, {"classwork_id": 7, "classwork_assignment_id": 7, "submission_id": 118, "title": "DEMO - PT 3 - Data Investigation", "activity_mode": "MANUAL", "component": "PERFORMANCE_TASK", "exam_subtype": null, "score": 26.0, "possible_score": 40.0, "percent": 65.0, "evidence_cutoff_at": "2026-10-19T20:15:41.826742+00:00", "coverage_provenance": "TEACHER_ASSERTED_ASSESSMENT_COVERAGE", "score_scope": "ASSESSMENT_TOTAL_ONLY", "competency_score_attribution": "NONE_SHARED_TOTAL_SCORE", "in_weakest_supported_component": false, "coverage_links": [{"coverage_id": 7, "lesson_id": 4, "competency_id": 4, "valid_from": "2026-10-19T19:27:26.241200+00:00", "valid_until": null, "linked_by_staff_id": "DEMO-T-001", "provenance": "TEACHER_ASSERTED_ASSESSMENT_COVERAGE"}], "covered_lessons": [{"lesson_id": 4, "title": "DEMO - Statistical Data Investigation and Interpretation"}], "covered_competencies": [{"competency_id": 4, "competency_code": "DEMO-LOCAL-G9M-DI-01", "competency_statement": "Collect, organize, summarize, and interpret bivariate or univariate numerical data using statistical measures and graphical representations."}]}], "covered_competencies_for_teacher_review": [{"competency_id": 1, "competency_code": "DEMO-LOCAL-G9M-EQ-01", "competency_statement": "Model a contextual relationship with a one-variable linear equation, solve it, and verify the solution.", "reason": "COVERED_BY_ASSESSMENT_IN_WEAKEST_COMPONENT", "ranking_status": "UNRANKED_SHARED_ASSESSMENT_SCORE", "assessment_classwork_ids": [4]}, {"competency_id": 2, "competency_code": "DEMO-LOCAL-G9M-NS-01", "competency_statement": "Demonstrate number sense by applying operational properties to integers and rational numbers in real-world contexts.", "reason": "COVERED_BY_ASSESSMENT_IN_WEAKEST_COMPONENT", "ranking_status": "UNRANKED_SHARED_ASSESSMENT_SCORE", "assessment_classwork_ids": [1]}], "lowest_supported_competencies": [{"competency_id": 1, "competency_code": "DEMO-LOCAL-G9M-EQ-01", "competency_statement": "Model a contextual relationship with a one-variable linear equation, solve it, and verify the solution.", "percent": 50.0, "score": 10.0, "possible_score": 20.0, "supporting_scores": [{"source_type": "QUIZ_QUESTION", "quiz_question_id": 16, "lesson_id": 1, "lesson_title": "DEMO - Equation Modeling with One-Variable Linear Equations", "competency_id": 1, "competency_code": "DEMO-LOCAL-G9M-EQ-01", "competency_statement": "Model a contextual relationship with a one-variable linear equation, solve it, and verify the solution.", "score": 10.0, "possible_score": 10.0, "classwork_id": 4, "classwork_assignment_id": 4, "submission_id": 116, "activity_title": "DEMO - WW 4 - Algebraic Expressions", "component": "WRITTEN_WORK"}, {"source_type": "QUIZ_QUESTION", "quiz_question_id": 17, "lesson_id": 1, "lesson_title": "DEMO - Equation Modeling with One-Variable Linear Equations", "competency_id": 1, "competency_code": "DEMO-LOCAL-G9M-EQ-01", "competency_statement": "Model a contextual relationship with a one-variable linear equation, solve it, and verify the solution.", "score": 0.0, "possible_score": 10.0, "classwork_id": 4, "classwork_assignment_id": 4, "submission_id": 116, "activity_title": "DEMO - WW 4 - Algebraic Expressions", "component": "WRITTEN_WORK"}]}], "competency_detail_status": "AVAILABLE", "unresolved_activity_evidence": false, "external_assessment_detail_status": "AVAILABLE_ASSESSMENT_LEVEL_COVERAGE"}	\N
\.


--
-- Data for Name: intervention_support_material; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.intervention_support_material (material_id, intervention_id, kind, status, evidence_basis, generated_content, current_content, created_by_staff_id, updated_by_staff_id, created_at, updated_at, sent_at, sent_by_staff_id) FROM stdin;
\.


--
-- Data for Name: invitation_token; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.invitation_token (token_id, user_id, token_hash, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: lesson; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lesson (lesson_id, title, description, content, order_index, is_published, is_draft, is_locked, is_archived, created_by_staff_id, subject_id, competency_id, created_at, updated_at) FROM stdin;
1	DEMO - Equation Modeling with One-Variable Linear Equations	Teacher-created Grade 9 Mathematics review material for translating a contextual relationship into a one-variable linear equation, solving it, and checking the result. This is a local demonstration objective, not an official curriculum-code claim.	Learning objective\nTranslate a contextual relationship into a one-variable linear equation, solve for the unknown, and verify the solution in context.\n\nKey idea\nChoose a variable for the unknown quantity. Convert each relationship in the problem into an algebraic expression. Build an equation, use inverse operations to isolate the variable, and substitute the result back into the original situation.\n\nWorked example\nA school club rents equipment for PHP 1,200 plus PHP 75 per hour. The total bill is PHP 1,650. How many hours was the equipment used?\n\nLet h be the number of hours.\n1,200 + 75h = 1,650\n75h = 450\nh = 6\n\nCheck: 1,200 + 75(6) = 1,650. The equipment was used for 6 hours.\n\nShort practice\n1. A data plan costs PHP 250 plus PHP 40 per gigabyte. A bill is PHP 410. How many gigabytes were used?\n2. A rectangle has width 5 cm and perimeter 34 cm. Find its length.\n3. Write one sentence explaining how substitution confirms a solution.\n\nAnswer check\n1. 250 + 40g = 410, so g = 4.\n2. 2L + 2(5) = 34, so L = 12 cm.\n3. Substitution is valid when the computed value makes both sides of the original equation equal.\n	1	t	f	f	f	DEMO-T-001	1	1	2026-10-20 01:45:12.670641+08	2026-10-20 01:45:12.670641+08
2	DEMO - Number Systems: Integers and Rational Numbers	Teacher-created Grade 9 Mathematics review material for understanding operational rules on integers, operations on rational numbers, and applied signed values. This is a local demonstration objective, not an official curriculum-code claim.	Learning objective\nDemonstrate number sense by applying operational properties to integers and rational numbers in real-world contexts.\n\nKey idea\nIntegers and rational numbers represent directed values and fractions/decimals. When adding integers with like signs, sum the magnitudes and keep the sign; with unlike signs, subtract the smaller magnitude from the larger and keep the sign of the larger. Multiplying or dividing two numbers with identical signs yields a positive result, while differing signs yield a negative result. For rational numbers, find a common denominator for addition/subtraction, and multiply across for multiplication.\n\nWorked example\nA submarine starts at sea level (0 m), dives 150 meters below sea level (-150 m), ascends 45 meters, and then descends another 20.5 meters. What is the submarine's final position relative to sea level?\n\nPosition = 0 + (-150) + 45 + (-20.5)\nStep 1: -150 + 45 = -105 m\nStep 2: -105 + (-20.5) = -125.5 m\n\nCheck: The submarine is 125.5 meters below sea level (-125.5 m).\n\nShort practice\n1. Compute: (-18) + 27 - (-12).\n2. Evaluate: (-3/4) * (8/9).\n3. A bank account had a balance of PHP 500. A withdrawal of PHP 750 was made, followed by a deposit of PHP 300. What is the new balance?\n\nAnswer check\n1. (-18) + 27 + 12 = 9 + 12 = 21.\n2. (-3 * 8) / (4 * 9) = -24/36 = -2/3.\n3. 500 - 750 + 300 = -250 + 300 = PHP 50.	2	t	f	f	f	DEMO-T-001	1	2	2026-10-20 03:27:26.003643+08	2026-10-20 03:27:26.003643+08
3	DEMO - Budget Mathematics and Financial Modeling	Teacher-created Grade 9 Mathematics review material for calculating income streams, classifying fixed and variable expenses, computing savings ratios, and modeling balanced budgets. This is a local demonstration objective, not an official curriculum-code claim.	Learning objective\nFormulate and analyze personal and household budget allocations using arithmetic ratios, percentages, and financial constraints.\n\nKey idea\nA personal budget balances income against expenses and savings. Net income is total earnings minus mandatory deductions. Total expenditures are categorized into fixed expenses (constant monthly costs) and variable expenses (fluctuating costs). The savings rate is calculated as (Total Savings / Net Income) * 100%. A balanced budget adheres to the constraint: Net Income = Fixed Expenses + Variable Expenses + Savings.\n\nWorked example\nMaria receives a monthly net allowance of PHP 8,000. She allocates 40% for food and transportation, 25% for school project supplies, and 15% for emergency savings. How much money remains for discretionary spending?\n\nAllocations:\n- Food and transportation: 0.40 * 8,000 = PHP 3,200\n- Project supplies: 0.25 * 8,000 = PHP 2,000\n- Emergency savings: 0.15 * 8,000 = PHP 1,200\nTotal committed = 3,200 + 2,000 + 1,200 = PHP 6,400\nRemaining discretionary = 8,000 - 6,400 = PHP 1,600 (or 20%).\n\nCheck: 3,200 + 2,000 + 1,200 + 1,600 = PHP 8,000.\n\nShort practice\n1. If a family earns PHP 30,000 net monthly and spends PHP 18,000 on necessities and PHP 6,000 on utilities, what percentage is left for savings?\n2. A student saves PHP 1,500 from a PHP 6,000 monthly stipend. Compute the savings rate.\n3. If fixed expenses increase by PHP 1,200 in a balanced budget, what two adjustments can keep the budget balanced?\n\nAnswer check\n1. Total spent = 24,000. Remaining = PHP 6,000. Savings rate = (6,000 / 30,000) * 100% = 20%.\n2. Savings rate = (1,500 / 6,000) * 100% = 25%.\n3. Either reduce variable/discretionary expenses by PHP 1,200 or increase net income by PHP 1,200 (or a combination of both).	3	t	f	f	f	DEMO-T-001	1	3	2026-10-20 03:27:26.003643+08	2026-10-20 03:27:26.003643+08
4	DEMO - Statistical Data Investigation and Interpretation	Teacher-created Grade 9 Mathematics review material for organizing data distributions, computing measures of central tendency and variability, and deriving contextual conclusions. This is a local demonstration objective, not an official curriculum-code claim.	Learning objective\nCollect, organize, summarize, and interpret bivariate or univariate numerical data using statistical measures and graphical representations.\n\nKey idea\nStatistical investigation begins with data collection and tabulation. Numerical data are summarized through measures of central tendency: Mean (arithmetic average), Median (middle value of an ordered set), and Mode (most frequent observation). Measures of variability, such as Range (maximum - minimum), indicate data spread. When significant outliers exist, the median provides a more robust representation of central tendency than the mean.\n\nWorked example\nA mathematics study group records their weekly practice test scores (out of 20): [14, 16, 16, 17, 19, 20, 20]. Find the mean, median, mode, and range.\n\nOrdered data: 14, 16, 16, 17, 19, 20, 20 (n = 7).\n- Mean = (14 + 16 + 16 + 17 + 19 + 20 + 20) / 7 = 122 / 7 ≈ 17.43.\n- Median = 4th value = 17.\n- Mode = 16 and 20 (bimodal).\n- Range = 20 - 14 = 6.\n\nConclusion: The typical performance center is approximately 17, with a narrow dispersion of 6 points.\n\nShort practice\n1. Find the median of the dataset: [82, 75, 90, 88, 79, 94].\n2. Identify which measure of central tendency is most affected by an extreme score of 10 in a class where other scores are around 85.\n3. Calculate the range of the test scores: [65, 78, 82, 85, 91, 98].\n\nAnswer check\n1. Ordered set: [75, 79, 82, 88, 90, 94]. Median = (82 + 88) / 2 = 85.\n2. The mean is most sensitive to extreme values/outliers.\n3. Range = 98 - 65 = 33.	4	t	f	f	f	DEMO-T-001	1	4	2026-10-20 03:27:26.003643+08	2026-10-20 03:27:26.003643+08
\.


--
-- Data for Name: lesson_assignment; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lesson_assignment (lesson_assignment_id, lesson_id, class_id, assigned_by_staff_id, publish_date, is_published, created_at) FROM stdin;
1	1	1	DEMO-T-001	\N	f	2026-10-20 01:45:12.670641+08
\.


--
-- Data for Name: lesson_goal; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lesson_goal (goal_id, class_id, subject_id, academic_period_id, created_by_staff_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: lesson_goal_item; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lesson_goal_item (goal_item_id, goal_id, item_type, lesson_id, classwork_id, order_index) FROM stdin;
\.


--
-- Data for Name: lesson_plan; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.lesson_plan (plan_id, status, title, learning_area, grade_section, date, sessions, "references", ai_declaration, intentions, learning_experience, assessment, ways_forward, teacher_id, subject_id, class_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: notification; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.notification (notification_id, user_id, notification_type, title, body, action_url, is_read, created_at, read_at) FROM stdin;
fe351965-da5c-4692-ae38-311e88769ce4	117c4122-f3eb-5e19-8219-b636b590887b	assignment_due	Deadline Summary: DEMO - Summative Test 2	Mathematics — Classwork 'DEMO - Summative Test 2' deadline has passed. 9/10 students turned in their work.	/teacher/classworks/9	t	2026-09-23 21:34:41.042835+08	2026-09-25 08:47:08.828162+08
6c29042d-9d40-4b42-8f1b-5fcc437a563a	117c4122-f3eb-5e19-8219-b636b590887b	assignment_due	Deadline Summary: DEMO - Summative Test 1	Mathematics — Classwork 'DEMO - Summative Test 1' deadline has passed. 9/10 students turned in their work.	/teacher/classworks/8	t	2026-09-23 21:34:41.032101+08	2026-09-25 17:28:47.126382+08
adb8b6d3-3fee-49b8-bedd-80a97c44990f	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	assignment_due	Mathematics: I5I-A Targeted Mathematics Practice	Your teacher assigned additional Mathematics practice for you.	/student/subjects/1/1?tab=classwork&classworkAssignmentId=12	t	2026-09-27 10:54:40.346767+08	2026-09-27 11:44:36.114894+08
88772490-6b8a-4b70-bbb1-4a48deedfad1	117c4122-f3eb-5e19-8219-b636b590887b	intervention_candidate	Intervention candidate ready for review	Demo Finley Practice in Mathematics is a candidate (projected grade 84.016). Evidence is available for review.	/teacher/interventions?candidate=2	t	2026-09-26 20:18:38.519168+08	2026-09-28 10:23:37.50501+08
162ca272-3352-4618-b910-6e1fd5a70b6e	117c4122-f3eb-5e19-8219-b636b590887b	intervention_resolved	Intervention resolved after improved prediction	Demo Finley Practice's latest Mathematics prediction improved to 86.473. Intervention criteria are no longer met; the previous intervention remains in history.	/teacher/interventions	t	2026-09-26 20:07:41.343223+08	2026-09-28 10:23:43.030633+08
909a3d28-e7c7-4a31-ac66-6ad770905f96	117c4122-f3eb-5e19-8219-b636b590887b	intervention_candidate	Intervention candidate ready for review	Demo Finley Practice in Mathematics is a candidate (projected grade 84.044). Evidence is available for review.	/teacher/interventions?candidate=1	t	2026-09-26 11:17:14.57057+08	2026-09-28 10:23:45.82942+08
6f6a7f38-ef30-4c2e-83c8-96470afe9c5e	117c4122-f3eb-5e19-8219-b636b590887b	intervention_candidate	Intervention candidate ready for review	Demo Drew Balanced in Mathematics is a candidate (projected grade 83.654). Evidence is available for review.	/teacher/interventions?candidate=3	t	2026-09-28 15:47:54.183836+08	2026-09-28 15:51:51.616653+08
a340c7ed-a745-4398-a55c-d404ed4b6fc1	117c4122-f3eb-5e19-8219-b636b590887b	assignment_due	Deadline Summary: I5I-A Targeted Mathematics Practice	Mathematics — Classwork 'I5I-A Targeted Mathematics Practice' deadline has passed. 1/1 students turned in their work.	/teacher/classworks/12?focus=deadline_summary	t	2026-10-19 22:49:52.992136+08	2026-10-20 01:25:09.69186+08
b72033e6-fc87-42b2-8ee2-e579a1c6c27a	117c4122-f3eb-5e19-8219-b636b590887b	assignment_due	Deadline Summary: DEMO - Term Examination	Mathematics — Classwork 'DEMO - Term Examination' deadline has passed. 10/10 students turned in their work.	/teacher/classworks/10?focus=deadline_summary	t	2026-10-19 22:49:52.920856+08	2026-10-20 01:25:50.327317+08
c5c8d2ec-eda0-497d-b73c-9e853cd8cdbd	117c4122-f3eb-5e19-8219-b636b590887b	assignment_due	Deadline Summary: DEMO - PT 3 - Data Investigation	Mathematics — Classwork 'DEMO - PT 3 - Data Investigation' deadline has passed. 9/10 students turned in their work.	/teacher/classworks/7	t	2026-09-23 21:34:41.022101+08	2026-10-20 01:28:24.551839+08
4628e6c3-9249-40e9-b35b-63e83d470aba	117c4122-f3eb-5e19-8219-b636b590887b	assignment_due	Deadline Summary: DEMO - WW 1 - Number Sense	Mathematics — Classwork 'DEMO - WW 1 - Number Sense' deadline has passed. 10/10 students turned in their work.	/teacher/classworks/1	t	2026-09-23 21:34:40.900349+08	2026-10-20 01:28:42.25964+08
e1d137b0-42c7-4a0d-beff-debdefa5f492	117c4122-f3eb-5e19-8219-b636b590887b	assignment_due	Deadline Summary: DEMO - PT 1 - Budget Mathematics	Mathematics — Classwork 'DEMO - PT 1 - Budget Mathematics' deadline has passed. 10/10 students turned in their work.	/teacher/classworks/5	t	2026-09-23 21:34:40.996625+08	2026-10-20 01:28:50.664231+08
b4792b40-b424-47a0-a19e-e729da2475a9	117c4122-f3eb-5e19-8219-b636b590887b	intervention_candidate	Intervention candidate ready for review	Demo Morgan Striving in Mathematics is a candidate (projected grade 83.274). Evidence is available for review.	/teacher/interventions?candidate=5	t	2026-10-20 02:59:02.400707+08	2026-10-20 03:50:14.660081+08
0e876a98-bc65-489f-9751-b8ad84835117	117c4122-f3eb-5e19-8219-b636b590887b	intervention_candidate	Intervention candidate ready for review	Demo Morgan Striving in Mathematics is a candidate (projected grade 83.274). Evidence is available for review.	/teacher/interventions?candidate=6	f	2026-10-20 04:15:41.8271+08	\N
149f7cc2-f724-420f-8ff7-8d1713601588	117c4122-f3eb-5e19-8219-b636b590887b	assignment_due	Deadline Summary: DEMO - PT 2 - Equation Modeling	Mathematics — Classwork 'DEMO - PT 2 - Equation Modeling' deadline has passed. 9/10 students turned in their work.	/teacher/classworks/6	t	2026-09-23 21:34:41.009458+08	2026-10-20 01:28:50.721492+08
b8706902-267b-46e6-85b3-1999a15027da	117c4122-f3eb-5e19-8219-b636b590887b	assignment_due	Deadline Summary: DEMO - WW 4 - Algebraic Expressions	Mathematics — Classwork 'DEMO - WW 4 - Algebraic Expressions' deadline has passed. 9/10 students turned in their work.	/teacher/classworks/4	t	2026-09-23 21:34:40.983015+08	2026-10-20 01:28:50.723084+08
f0ff8587-4755-4d30-8da8-adc7d2dda4ee	117c4122-f3eb-5e19-8219-b636b590887b	assignment_due	Deadline Summary: DEMO - WW 3 - Rational Numbers	Mathematics — Classwork 'DEMO - WW 3 - Rational Numbers' deadline has passed. 9/10 students turned in their work.	/teacher/classworks/3	t	2026-09-23 21:34:40.970658+08	2026-10-20 01:29:06.745849+08
30a296e4-0856-4cde-92c8-25839ea6f4ea	117c4122-f3eb-5e19-8219-b636b590887b	assignment_due	Deadline Summary: DEMO - WW 2 - Integer Operations	Mathematics — Classwork 'DEMO - WW 2 - Integer Operations' deadline has passed. 10/10 students turned in their work.	/teacher/classworks/2	t	2026-09-23 21:34:40.941007+08	2026-10-20 01:29:11.777765+08
\.


--
-- Data for Name: official_section; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.official_section (id, academic_year_id, academic_level_id, section_name, normalized_name, pathway_id, is_active, created_at) FROM stdin;
\.


--
-- Data for Name: period_template_slot; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.period_template_slot (slot_id, template_group, slot_name, slot_type, start_time, end_time, is_locked_break, display_order, created_at, updated_at) FROM stdin;
1	JHS_45MIN	Homeroom Guidance	HOMEROOM	07:30	08:00	t	1	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
2	JHS_45MIN	Period 1	CLASS	08:00	08:45	f	2	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
3	JHS_45MIN	Period 2	CLASS	08:45	09:30	f	3	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
4	JHS_45MIN	Morning Recess	RECESS	09:30	09:45	t	4	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
5	JHS_45MIN	Period 3	CLASS	09:45	10:30	f	5	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
6	JHS_45MIN	Period 4	CLASS	10:30	11:15	f	6	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
7	JHS_45MIN	Period 5	CLASS	11:15	12:00	f	7	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
8	JHS_45MIN	Lunch Break	LUNCH	12:00	13:00	t	8	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
9	JHS_45MIN	Enhanced Period 1	CLASS	13:00	14:00	f	9	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
10	JHS_45MIN	Enhanced Period 2	CLASS	14:00	15:00	f	10	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
11	JHS_45MIN	Afternoon Recess	RECESS	15:00	15:30	t	11	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
12	JHS_45MIN	Period 6	CLASS	15:30	16:15	f	12	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
13	JHS_45MIN	Period 7	CLASS	16:15	17:00	f	13	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
14	SHS_CAMPOS_ZARA	Homeroom Guidance	HOMEROOM	07:30	08:00	t	1	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
15	SHS_CAMPOS_ZARA	Period 1	CLASS	08:00	09:00	f	2	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
16	SHS_CAMPOS_ZARA	Period 2	CLASS	09:00	10:00	f	3	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
17	SHS_CAMPOS_ZARA	Morning Recess	RECESS	10:00	10:24	t	4	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
18	SHS_CAMPOS_ZARA	Lab Block	CLASS	10:24	12:00	f	5	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
19	SHS_CAMPOS_ZARA	Lunch Break	LUNCH	12:00	13:00	t	6	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
20	SHS_CAMPOS_ZARA	Period 3	CLASS	13:00	14:00	f	7	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
21	SHS_CAMPOS_ZARA	Period 4	CLASS	14:00	15:00	f	8	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
22	SHS_CAMPOS_ZARA	Afternoon Recess	RECESS	15:00	15:30	t	9	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
23	SHS_CAMPOS_ZARA	Period 5	CLASS	15:30	16:30	f	10	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
24	SHS_DELMUNDO_REYES	Homeroom Guidance	HOMEROOM	07:30	08:00	t	1	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
25	SHS_DELMUNDO_REYES	Period 1	CLASS	08:00	09:12	f	2	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
26	SHS_DELMUNDO_REYES	Period 2	CLASS	09:12	10:24	f	3	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
27	SHS_DELMUNDO_REYES	Morning Recess	RECESS	10:24	10:48	t	4	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
28	SHS_DELMUNDO_REYES	Period 3	CLASS	10:48	12:00	f	5	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
29	SHS_DELMUNDO_REYES	Lunch Break	LUNCH	12:00	13:00	t	6	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
30	SHS_DELMUNDO_REYES	Period 4	CLASS	13:00	14:12	f	7	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
31	SHS_DELMUNDO_REYES	Period 5	CLASS	14:12	15:24	f	8	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
32	SHS_DELMUNDO_REYES	Afternoon Recess	RECESS	15:24	15:50	t	9	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
33	SHS_DELMUNDO_REYES	Period 6 (PE)	CLASS	15:50	16:50	f	10	2026-09-29 08:33:33.117058+08	2026-09-29 08:33:33.117058+08
\.


--
-- Data for Name: prediction_outcome; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.prediction_outcome (outcome_id, prediction_id, actual_period_grade, actual_risk_status, prediction_error, absolute_error, actual_passed, actual_risk_label, outcome_status, evaluated_at, intervention_given, intervention_result, recorded_at) FROM stdin;
\.


--
-- Data for Name: question; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.question (question_id, question_text, question_type, difficulty_level, points, explanation, is_ai_generated, expected_answer_type, max_file_size_mb, lesson_id, created_at) FROM stdin;
1	Which symbol can represent an unknown number?	MULTIPLE_CHOICE	\N	10.00	\N	f	\N	\N	1	2026-09-27 10:54:40.346767+08
3	In the equation 3x + 5 = 20, what is the value of x?	MULTIPLE_CHOICE	MEDIUM	10.00	Subtract 5 then divide by 3: 3x = 15, x = 5.	f	\N	\N	1	2026-10-20 02:23:39.738608+08
\.


--
-- Data for Name: question_option; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.question_option (option_id, question_id, option_text, is_correct, option_order, created_at) FROM stdin;
1	1	x	t	1	2026-09-27 10:54:40.346767+08
2	1	=	f	2	2026-09-27 10:54:40.346767+08
6	3	x = 5	t	1	2026-10-20 02:23:39.738608+08
7	3	x = 8	f	2	2026-10-20 02:23:39.738608+08
8	3	x = 15	f	3	2026-10-20 02:23:39.738608+08
\.


--
-- Data for Name: quiz; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.quiz (quiz_id, classwork_id, total_items, duration_minutes, accessible_at, status, created_at) FROM stdin;
3	2	2	20	\N	READY	2026-10-20 02:23:39.738608+08
9	4	2	30	\N	PUBLISHED	2026-10-20 02:59:02.070557+08
\.


--
-- Data for Name: quiz_answer; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.quiz_answer (answer_id, quiz_question_id, submission_id, answer_text, is_correct, points_awarded) FROM stdin;
4	4	83	x	t	10.00
5	5	83	x = 8	f	0.00
12	16	116	x	t	10.00
13	17	116	x = 8	f	0.00
\.


--
-- Data for Name: quiz_question; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.quiz_question (quiz_question_id, quiz_id, question_id, display_order) FROM stdin;
4	3	1	1
5	3	3	2
16	9	1	1
17	9	3	2
\.


--
-- Data for Name: quiz_setting; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.quiz_setting (quiz_setting_id, classwork_id, is_shuffle_questions, enable_per_question_scoring, enable_per_question_time_limits, max_attempts, show_correct_answers, summary_release_mode, summary_release_at, created_at) FROM stdin;
\.


--
-- Data for Name: risk_threshold; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.risk_threshold (threshold_id, threshold_name, condition_type, condition_value, risk_level, effective_from, effective_to, is_active, created_at) FROM stdin;
\.


--
-- Data for Name: role; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.role (role_id, role_name, description, created_at) FROM stdin;
1	Admin	\N	2026-09-23 21:31:00.305889+08
2	Teacher	\N	2026-09-23 21:31:00.305889+08
3	Student	\N	2026-09-23 21:31:00.305889+08
\.


--
-- Data for Name: rubric_template; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.rubric_template (rubric_template_id, owner_staff_id, name, description, levels, is_system, created_at, updated_at) FROM stdin;
1	\N	Standard Performance Levels	The existing five-level classwork scoring rubric.	[{"level_name": "Excellent", "description": "Displays all required components clearly and accurately.", "points": 100, "display_order": 0}, {"level_name": "Good", "description": "Most components are present with minor errors.", "points": 80, "display_order": 1}, {"level_name": "Fair", "description": "Some required parts are missing or unclear.", "points": 60, "display_order": 2}, {"level_name": "Needs Improvement", "description": "Many required elements are missing.", "points": 40, "display_order": 3}, {"level_name": "Poor", "description": "Work is incomplete or not submitted.", "points": 20, "display_order": 4}]	t	2026-10-19 22:47:30.196318+08	2026-10-19 22:47:30.196318+08
\.


--
-- Data for Name: setting; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.setting (id, key, value, type, "group", is_public, description, created_at, updated_at, updated_by) FROM stdin;
\.


--
-- Data for Name: student; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.student (student_id, student_lrn, first_name, middle_name, last_name, dob, suffix, gender, contact_number, email, address, academic_level_id, prior_gwa, user_id) FROM stdin;
e5888450-33df-5d69-9991-8bf448c3f0d1	990000000001	Demo Avery	\N	Excellent	\N	\N	\N	\N	\N	\N	1	94.25	\N
5fb1cda3-2f09-5942-ace4-4fb19c31d678	990000000002	Demo Blake	\N	Capable	\N	\N	\N	\N	\N	\N	1	93.00	\N
5be4d747-79a3-5835-86a4-354c46bfe5a2	990000000003	Demo Casey	\N	Steady	\N	\N	\N	\N	\N	\N	1	91.75	\N
e43e9f2a-675c-5f33-9827-db6ce02923ef	990000000005	Demo Emery	\N	Growing	\N	\N	\N	\N	\N	\N	1	89.25	\N
59501866-17b8-5e3f-b979-d2a94b876e21	990000000007	Demo Gray	\N	Focused	\N	\N	\N	\N	\N	\N	1	92.25	\N
34d631c3-b1e1-5e71-8c43-2f51ece01205	990000000008	Demo Harper	\N	Improving	\N	\N	\N	\N	\N	\N	1	89.75	\N
28141b44-9a69-567f-88bd-3a838b4115db	990000000009	Demo Indigo	\N	Prepared	\N	\N	\N	\N	\N	\N	1	93.50	\N
c64e1a20-e025-5113-9f47-a49019ed27c5	990000000006	Demo Finley	\N	Practice	\N	\N	\N	\N	\N	\N	1	87.25	a70644de-3d98-4a11-9ad7-8ba7dc1aa987
02361276-31c5-5e69-a622-b7220472edd3	990000000010	Demo Jordan	\N	Starting	\N	\N	\N	\N	\N	\N	1	88.00	8dce0e29-eac9-476f-a9b3-23d41108f3b9
f6ea943b-d2e7-575b-a092-5d7725fe0690	990000000004	Demo Drew	\N	Balanced	\N	\N	\N	\N	\N	\N	1	90.50	843802db-12a2-494a-ac3f-4fd511ee90b0
84de62ab-c6cc-5305-a06b-964a71fb0c21	990000000011	Demo Morgan	\N	Striving	2011-04-15	\N	Male	\N	demo-morgan-striving@example.com	\N	1	86.50	2560780f-6406-5687-b59f-c19fbf762072
\.


--
-- Data for Name: student_assessment_score; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.student_assessment_score (score_id, assessment_id, student_id, raw_score, score_status, encoded_at, entered_by_staff_id) FROM stdin;
\.


--
-- Data for Name: student_class; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.student_class (student_class_id, student_id, class_id, academic_year_id, enrollment_status, enrolled_at) FROM stdin;
1	e5888450-33df-5d69-9991-8bf448c3f0d1	1	1	enrolled	2026-09-23 21:31:00.305889+08
2	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	1	enrolled	2026-09-23 21:31:00.305889+08
3	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	1	enrolled	2026-09-23 21:31:00.305889+08
4	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	1	enrolled	2026-09-23 21:31:00.305889+08
5	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	1	enrolled	2026-09-23 21:31:00.305889+08
6	c64e1a20-e025-5113-9f47-a49019ed27c5	1	1	enrolled	2026-09-23 21:31:00.305889+08
7	59501866-17b8-5e3f-b979-d2a94b876e21	1	1	enrolled	2026-09-23 21:31:00.305889+08
8	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	1	enrolled	2026-09-23 21:31:00.305889+08
9	28141b44-9a69-567f-88bd-3a838b4115db	1	1	enrolled	2026-09-23 21:31:00.305889+08
10	02361276-31c5-5e69-a622-b7220472edd3	1	1	enrolled	2026-09-23 21:31:00.305889+08
17	84de62ab-c6cc-5305-a06b-964a71fb0c21	1	1	enrolled	2026-10-20 02:59:02.070557+08
\.


--
-- Data for Name: student_period_grade; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.student_period_grade (period_grade_id, student_id, class_id, subject_id, academic_period_id, written_work_percent, performance_task_percent, quarterly_assessment_percent, initial_grade, transmuted_grade, final_period_grade, is_finalized, finalized_at, finalized_by_staff_id, entered_by_staff_id, remarks, source_file_name, created_at) FROM stdin;
\.


--
-- Data for Name: student_submission; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.student_submission (submission_id, student_id, classwork_assignment_id, submitted_at, status, grade, feedback, attempt_count, graded_at, graded_by_staff_id, reading_focused_seconds, created_at) FROM stdin;
1	e5888450-33df-5d69-9991-8bf448c3f0d1	1	2026-09-03 21:00:00+08	late	19.00	\N	1	2026-09-04 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
2	e5888450-33df-5d69-9991-8bf448c3f0d1	2	2026-09-06 16:00:00+08	graded	19.40	\N	1	2026-09-07 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
3	e5888450-33df-5d69-9991-8bf448c3f0d1	3	2026-09-09 16:00:00+08	graded	19.80	\N	1	2026-09-10 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
5	e5888450-33df-5d69-9991-8bf448c3f0d1	5	2026-09-05 16:00:00+08	graded	38.80	\N	1	2026-09-06 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
10	5fb1cda3-2f09-5942-ace4-4fb19c31d678	1	2026-09-03 16:00:00+08	graded	18.00	\N	1	2026-09-04 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
11	5fb1cda3-2f09-5942-ace4-4fb19c31d678	2	2026-09-06 16:00:00+08	graded	18.40	\N	1	2026-09-07 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
12	5fb1cda3-2f09-5942-ace4-4fb19c31d678	3	2026-09-09 16:00:00+08	graded	18.80	\N	1	2026-09-10 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
14	5fb1cda3-2f09-5942-ace4-4fb19c31d678	5	2026-09-05 21:00:00+08	late	36.80	\N	1	2026-09-06 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
19	5be4d747-79a3-5835-86a4-354c46bfe5a2	1	2026-09-03 16:00:00+08	graded	17.00	\N	1	2026-09-04 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
20	5be4d747-79a3-5835-86a4-354c46bfe5a2	2	2026-09-06 16:00:00+08	graded	17.40	\N	1	2026-09-07 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
21	5be4d747-79a3-5835-86a4-354c46bfe5a2	3	2026-09-09 16:00:00+08	graded	17.80	\N	1	2026-09-10 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
23	5be4d747-79a3-5835-86a4-354c46bfe5a2	5	2026-09-05 16:00:00+08	graded	34.80	\N	1	2026-09-06 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
28	f6ea943b-d2e7-575b-a092-5d7725fe0690	1	2026-09-03 16:00:00+08	graded	16.00	\N	1	2026-09-04 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
29	f6ea943b-d2e7-575b-a092-5d7725fe0690	2	2026-09-06 16:00:00+08	graded	16.40	\N	1	2026-09-07 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
30	f6ea943b-d2e7-575b-a092-5d7725fe0690	3	2026-09-09 21:00:00+08	late	16.80	\N	1	2026-09-10 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
32	f6ea943b-d2e7-575b-a092-5d7725fe0690	5	2026-09-05 16:00:00+08	graded	32.80	\N	1	2026-09-06 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
37	e43e9f2a-675c-5f33-9827-db6ce02923ef	1	2026-09-03 16:00:00+08	graded	15.00	\N	1	2026-09-04 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
38	e43e9f2a-675c-5f33-9827-db6ce02923ef	2	2026-09-06 21:00:00+08	late	15.40	\N	1	2026-09-07 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
39	e43e9f2a-675c-5f33-9827-db6ce02923ef	3	2026-09-09 16:00:00+08	graded	15.80	\N	1	2026-09-10 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
41	e43e9f2a-675c-5f33-9827-db6ce02923ef	5	2026-09-05 16:00:00+08	graded	30.80	\N	1	2026-09-06 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
46	c64e1a20-e025-5113-9f47-a49019ed27c5	1	2026-09-03 21:00:00+08	late	13.40	\N	1	2026-09-04 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
47	c64e1a20-e025-5113-9f47-a49019ed27c5	2	2026-09-06 16:00:00+08	graded	13.80	\N	1	2026-09-07 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
48	c64e1a20-e025-5113-9f47-a49019ed27c5	3	2026-09-09 16:00:00+08	graded	14.20	\N	1	2026-09-10 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
50	c64e1a20-e025-5113-9f47-a49019ed27c5	5	2026-09-05 16:00:00+08	graded	27.60	\N	1	2026-09-06 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
55	59501866-17b8-5e3f-b979-d2a94b876e21	1	2026-09-03 16:00:00+08	graded	17.40	\N	1	2026-09-04 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
56	59501866-17b8-5e3f-b979-d2a94b876e21	2	2026-09-06 16:00:00+08	graded	17.80	\N	1	2026-09-07 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
57	59501866-17b8-5e3f-b979-d2a94b876e21	3	2026-09-09 16:00:00+08	graded	18.20	\N	1	2026-09-10 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
59	59501866-17b8-5e3f-b979-d2a94b876e21	5	2026-09-05 21:00:00+08	late	35.60	\N	1	2026-09-06 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
64	34d631c3-b1e1-5e71-8c43-2f51ece01205	1	2026-09-03 16:00:00+08	graded	15.40	\N	1	2026-09-04 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
65	34d631c3-b1e1-5e71-8c43-2f51ece01205	2	2026-09-06 16:00:00+08	graded	15.80	\N	1	2026-09-07 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
66	34d631c3-b1e1-5e71-8c43-2f51ece01205	3	2026-09-09 16:00:00+08	graded	16.20	\N	1	2026-09-10 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
68	34d631c3-b1e1-5e71-8c43-2f51ece01205	5	2026-09-05 16:00:00+08	graded	31.60	\N	1	2026-09-06 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
7	e5888450-33df-5d69-9991-8bf448c3f0d1	8	2026-09-08 16:00:00+08	graded	29.10	\N	1	2026-10-20 04:21:23.608178+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
4	e5888450-33df-5d69-9991-8bf448c3f0d1	4	2026-09-12 16:00:00+08	graded	19.00	\N	1	2026-09-28 15:47:54.166677+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
13	5fb1cda3-2f09-5942-ace4-4fb19c31d678	4	2026-09-12 16:00:00+08	graded	18.00	\N	1	2026-09-28 15:47:54.166677+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
22	5be4d747-79a3-5835-86a4-354c46bfe5a2	4	2026-09-12 21:00:00+08	graded	17.00	\N	1	2026-09-28 15:47:54.166677+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
31	f6ea943b-d2e7-575b-a092-5d7725fe0690	4	2026-09-12 16:00:00+08	graded	9.00	\N	1	2026-09-28 15:47:54.166677+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
40	e43e9f2a-675c-5f33-9827-db6ce02923ef	4	2026-09-12 16:00:00+08	graded	15.00	\N	1	2026-09-28 15:47:54.166677+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
9	e5888450-33df-5d69-9991-8bf448c3f0d1	10	\N	pending	\N	\N	1	\N	\N	\N	2026-09-23 21:31:00.305889+08
16	5fb1cda3-2f09-5942-ace4-4fb19c31d678	8	2026-09-08 16:00:00+08	graded	27.60	\N	1	2026-10-20 04:21:23.608178+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
25	5be4d747-79a3-5835-86a4-354c46bfe5a2	8	2026-09-08 16:00:00+08	graded	26.10	\N	1	2026-10-20 04:21:23.608178+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
34	f6ea943b-d2e7-575b-a092-5d7725fe0690	8	2026-09-08 21:00:00+08	graded	24.60	\N	1	2026-10-20 04:21:23.608178+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
43	e43e9f2a-675c-5f33-9827-db6ce02923ef	8	2026-09-08 16:00:00+08	graded	23.10	\N	1	2026-10-20 04:21:23.608178+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
52	c64e1a20-e025-5113-9f47-a49019ed27c5	8	2026-09-08 16:00:00+08	graded	20.70	\N	1	2026-10-20 04:21:23.608178+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
6	e5888450-33df-5d69-9991-8bf448c3f0d1	6	2026-09-11 21:00:00+08	graded	39.60	\N	1	2026-10-20 04:21:30.296664+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
15	5fb1cda3-2f09-5942-ace4-4fb19c31d678	6	2026-09-11 16:00:00+08	graded	37.60	\N	1	2026-10-20 04:21:30.296664+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
24	5be4d747-79a3-5835-86a4-354c46bfe5a2	6	2026-09-11 16:00:00+08	graded	35.60	\N	1	2026-10-20 04:21:30.296664+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
33	f6ea943b-d2e7-575b-a092-5d7725fe0690	6	2026-09-11 16:00:00+08	graded	33.60	\N	1	2026-10-20 04:21:30.296664+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
42	e43e9f2a-675c-5f33-9827-db6ce02923ef	6	2026-09-11 16:00:00+08	graded	31.60	\N	1	2026-10-20 04:21:30.296664+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
51	c64e1a20-e025-5113-9f47-a49019ed27c5	6	2026-09-11 21:00:00+08	graded	28.40	\N	1	2026-10-20 04:21:30.296664+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
60	59501866-17b8-5e3f-b979-d2a94b876e21	6	2026-09-11 16:00:00+08	graded	36.40	\N	1	2026-10-20 04:21:30.296664+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
8	e5888450-33df-5d69-9991-8bf448c3f0d1	9	2026-09-15 16:00:00+08	graded	29.70	\N	1	2026-10-20 04:21:17.524262+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
17	5fb1cda3-2f09-5942-ace4-4fb19c31d678	9	2026-09-15 16:00:00+08	graded	28.20	\N	1	2026-10-20 04:21:17.524262+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
26	5be4d747-79a3-5835-86a4-354c46bfe5a2	9	2026-09-15 21:00:00+08	graded	26.70	\N	1	2026-10-20 04:21:17.524262+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
35	f6ea943b-d2e7-575b-a092-5d7725fe0690	9	2026-09-15 16:00:00+08	graded	25.20	\N	1	2026-10-20 04:21:17.524262+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
44	e43e9f2a-675c-5f33-9827-db6ce02923ef	9	2026-09-15 16:00:00+08	graded	23.70	\N	1	2026-10-20 04:21:17.524262+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
53	c64e1a20-e025-5113-9f47-a49019ed27c5	9	2026-09-15 16:00:00+08	graded	21.30	\N	1	2026-10-20 04:21:17.524262+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
62	59501866-17b8-5e3f-b979-d2a94b876e21	9	2026-09-15 16:00:00+08	graded	27.30	\N	1	2026-10-20 04:21:17.524262+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
73	28141b44-9a69-567f-88bd-3a838b4115db	1	2026-09-03 16:00:00+08	graded	18.40	\N	1	2026-09-04 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
74	28141b44-9a69-567f-88bd-3a838b4115db	2	2026-09-06 16:00:00+08	graded	18.80	\N	1	2026-09-07 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
75	28141b44-9a69-567f-88bd-3a838b4115db	3	2026-09-09 21:00:00+08	late	19.20	\N	1	2026-09-10 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
77	28141b44-9a69-567f-88bd-3a838b4115db	5	2026-09-05 16:00:00+08	graded	37.60	\N	1	2026-09-06 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
82	02361276-31c5-5e69-a622-b7220472edd3	1	2026-09-03 16:00:00+08	graded	14.00	\N	1	2026-09-04 17:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
85	e5888450-33df-5d69-9991-8bf448c3f0d1	7	2026-09-17 17:00:00+08	graded	38.80	\N	1	2026-09-28 15:46:53.935776+08	DEMO-T-001	\N	2026-09-23 21:31:02.964265+08
86	5fb1cda3-2f09-5942-ace4-4fb19c31d678	7	2026-09-17 17:00:00+08	graded	36.80	\N	1	2026-09-28 15:46:53.935776+08	DEMO-T-001	\N	2026-09-23 21:31:03.203797+08
87	5be4d747-79a3-5835-86a4-354c46bfe5a2	7	2026-09-17 17:00:00+08	graded	34.80	\N	1	2026-09-28 15:46:53.935776+08	DEMO-T-001	\N	2026-09-23 21:31:03.203797+08
88	f6ea943b-d2e7-575b-a092-5d7725fe0690	7	2026-09-17 17:00:00+08	graded	12.00	\N	1	2026-09-28 15:46:53.935776+08	DEMO-T-001	\N	2026-09-23 21:31:03.203797+08
89	e43e9f2a-675c-5f33-9827-db6ce02923ef	7	2026-09-17 17:00:00+08	graded	30.80	\N	1	2026-09-28 15:46:53.935776+08	DEMO-T-001	\N	2026-09-23 21:31:03.203797+08
90	c64e1a20-e025-5113-9f47-a49019ed27c5	7	2026-09-17 17:00:00+08	graded	27.60	\N	1	2026-09-28 15:46:53.935776+08	DEMO-T-001	\N	2026-09-23 21:31:03.203797+08
91	59501866-17b8-5e3f-b979-d2a94b876e21	7	2026-09-17 17:00:00+08	graded	35.60	\N	1	2026-09-28 15:46:53.935776+08	DEMO-T-001	\N	2026-09-23 21:31:03.203797+08
92	34d631c3-b1e1-5e71-8c43-2f51ece01205	7	2026-09-17 17:00:00+08	graded	31.60	\N	1	2026-09-28 15:46:53.935776+08	DEMO-T-001	\N	2026-09-23 21:31:03.203797+08
93	28141b44-9a69-567f-88bd-3a838b4115db	7	2026-09-17 17:00:00+08	graded	37.60	\N	1	2026-09-28 15:46:53.935776+08	DEMO-T-001	\N	2026-09-23 21:31:03.203797+08
121	02361276-31c5-5e69-a622-b7220472edd3	8	\N	pending	\N	\N	0	\N	\N	\N	2026-10-20 04:19:40.027604+08
123	02361276-31c5-5e69-a622-b7220472edd3	6	\N	pending	\N	\N	0	\N	\N	\N	2026-10-20 04:19:55.897924+08
71	34d631c3-b1e1-5e71-8c43-2f51ece01205	9	2026-09-15 21:00:00+08	graded	24.30	\N	1	2026-10-20 04:21:17.524262+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
49	c64e1a20-e025-5113-9f47-a49019ed27c5	4	2026-09-12 16:00:00+08	graded	13.40	\N	1	2026-09-28 15:47:54.166677+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
84	02361276-31c5-5e69-a622-b7220472edd3	5	2026-09-05 16:00:00+08	graded	31.00	Synthetic demo: Accurate budget calculations with minor rounding errors.	1	2026-09-10 14:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
97	02361276-31c5-5e69-a622-b7220472edd3	7	2026-09-15 15:00:00+08	graded	32.00	Synthetic demo: Satisfactory data representation and analysis.	0	2026-09-16 11:00:00+08	DEMO-T-001	\N	2026-09-28 15:46:53.929276+08
83	02361276-31c5-5e69-a622-b7220472edd3	2	2026-09-06 16:00:00+08	graded	10.00	Synthetic demo: Good grasp of variable representation, review linear solving steps.	1	2026-09-07 10:00:00+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
80	28141b44-9a69-567f-88bd-3a838b4115db	9	2026-09-15 16:00:00+08	graded	28.80	\N	1	2026-10-20 04:21:17.524262+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
58	59501866-17b8-5e3f-b979-d2a94b876e21	4	2026-09-12 16:00:00+08	graded	17.40	\N	1	2026-09-28 15:47:54.166677+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
67	34d631c3-b1e1-5e71-8c43-2f51ece01205	4	2026-09-12 21:00:00+08	graded	15.40	\N	1	2026-09-28 15:47:54.166677+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
76	28141b44-9a69-567f-88bd-3a838b4115db	4	2026-09-12 16:00:00+08	graded	18.40	\N	1	2026-09-28 15:47:54.166677+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
98	02361276-31c5-5e69-a622-b7220472edd3	4	\N	pending	\N	\N	0	\N	\N	\N	2026-09-28 15:47:54.161102+08
115	84de62ab-c6cc-5305-a06b-964a71fb0c21	1	2026-10-15 18:00:00+08	graded	8.00	\N	0	2026-10-15 18:00:00+08	\N	\N	2026-10-20 02:59:02.070557+08
116	84de62ab-c6cc-5305-a06b-964a71fb0c21	4	2026-10-15 18:00:00+08	graded	10.00	\N	0	2026-10-15 18:00:00+08	\N	\N	2026-10-20 02:59:02.070557+08
117	84de62ab-c6cc-5305-a06b-964a71fb0c21	5	2026-10-15 18:00:00+08	graded	26.00	\N	0	2026-10-15 18:00:00+08	\N	\N	2026-10-20 02:59:02.070557+08
118	84de62ab-c6cc-5305-a06b-964a71fb0c21	7	2026-10-15 18:00:00+08	graded	26.00	\N	0	2026-10-15 18:00:00+08	\N	\N	2026-10-20 02:59:02.070557+08
18	5fb1cda3-2f09-5942-ace4-4fb19c31d678	10	\N	pending	\N	\N	1	\N	\N	\N	2026-09-23 21:31:00.305889+08
27	5be4d747-79a3-5835-86a4-354c46bfe5a2	10	\N	pending	\N	\N	1	\N	\N	\N	2026-09-23 21:31:00.305889+08
36	f6ea943b-d2e7-575b-a092-5d7725fe0690	10	\N	pending	\N	\N	1	\N	\N	\N	2026-09-23 21:31:00.305889+08
45	e43e9f2a-675c-5f33-9827-db6ce02923ef	10	\N	pending	\N	\N	1	\N	\N	\N	2026-09-23 21:31:00.305889+08
54	c64e1a20-e025-5113-9f47-a49019ed27c5	10	\N	pending	\N	\N	1	\N	\N	\N	2026-09-23 21:31:00.305889+08
63	59501866-17b8-5e3f-b979-d2a94b876e21	10	\N	pending	\N	\N	1	\N	\N	\N	2026-09-23 21:31:00.305889+08
72	34d631c3-b1e1-5e71-8c43-2f51ece01205	10	\N	pending	\N	\N	1	\N	\N	\N	2026-09-23 21:31:00.305889+08
81	28141b44-9a69-567f-88bd-3a838b4115db	10	\N	pending	\N	\N	1	\N	\N	\N	2026-09-23 21:31:00.305889+08
94	02361276-31c5-5e69-a622-b7220472edd3	10	\N	pending	\N	\N	0	\N	\N	\N	2026-09-25 18:17:27.362048+08
120	84de62ab-c6cc-5305-a06b-964a71fb0c21	9	\N	pending	\N	\N	0	2026-10-20 04:19:28.001803+08	DEMO-T-001	\N	2026-10-20 04:19:27.994477+08
61	59501866-17b8-5e3f-b979-d2a94b876e21	8	2026-09-08 16:00:00+08	graded	26.70	\N	1	2026-10-20 04:21:23.608178+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
70	34d631c3-b1e1-5e71-8c43-2f51ece01205	8	2026-09-08 16:00:00+08	graded	23.70	\N	1	2026-10-20 04:21:23.608178+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
79	28141b44-9a69-567f-88bd-3a838b4115db	8	2026-09-08 21:00:00+08	graded	28.20	\N	1	2026-10-20 04:21:23.608178+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
122	84de62ab-c6cc-5305-a06b-964a71fb0c21	8	\N	pending	\N	\N	0	2026-10-20 04:19:40.034493+08	DEMO-T-001	\N	2026-10-20 04:19:40.027604+08
69	34d631c3-b1e1-5e71-8c43-2f51ece01205	6	2026-09-11 16:00:00+08	graded	32.40	\N	1	2026-10-20 04:21:30.296664+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
78	28141b44-9a69-567f-88bd-3a838b4115db	6	2026-09-11 16:00:00+08	graded	38.40	\N	1	2026-10-20 04:21:30.296664+08	DEMO-T-001	\N	2026-09-23 21:31:00.305889+08
124	84de62ab-c6cc-5305-a06b-964a71fb0c21	6	\N	pending	\N	\N	0	2026-10-20 04:19:55.902623+08	DEMO-T-001	\N	2026-10-20 04:19:55.897924+08
119	02361276-31c5-5e69-a622-b7220472edd3	9	\N	pending	\N	\N	0	\N	\N	\N	2026-10-20 04:19:27.994477+08
\.


--
-- Data for Name: student_suggestion; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.student_suggestion (student_suggestion_id, suggestion_type, resource_type, title, description, resource_links, priority, status, is_viewed, viewed_at, created_at, student_id, subject_id, lesson_id, created_by_staff_id, prediction_id) FROM stdin;
\.


--
-- Data for Name: subject; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.subject (subject_id, academic_level_id, subject_name, subject_codename, is_math_or_science, is_core, status, description, created_at, updated_at, grading_template_id) FROM stdin;
1	1	Mathematics	MATHEMATICS	t	t	active	\N	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	1
\.


--
-- Data for Name: subject_load; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.subject_load (subject_load_id, staff_id, subject_id, class_id, academic_period_id, slot_id, start_time, end_time, days_of_week, status, logical_load_id, section_revision, base_revision, version, is_active_version, is_locked, locked_at, published_at, published_by, last_modified_by, draft_notes, continued_from_load_id, created_at, updated_at) FROM stdin;
1	DEMO-T-001	1	1	1	\N	\N	\N	\N	published	LL_1_1_1	1	\N	1	t	t	\N	2026-09-01 17:00:00+08	\N	\N	\N	\N	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08
\.


--
-- Data for Name: subject_offering; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.subject_offering (subject_offering_id, subject_id, academic_year_id, academic_level_id, academic_period_id, minutes, status, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: subject_offering_pathway; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.subject_offering_pathway (subject_offering_id, pathway_id) FROM stdin;
\.


--
-- Data for Name: submission_attachment; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.submission_attachment (submission_attachment_id, submission_id, file_name, file_path, file_type, file_size, uploaded_at) FROM stdin;
\.


--
-- Data for Name: suggestion_classwork; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.suggestion_classwork (suggestion_classwork_id, student_suggestion_id, classwork_assignment_id, is_completed, completed_at, score_before, score_after) FROM stdin;
\.


--
-- Data for Name: teacher_risk_review; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.teacher_risk_review (review_id, prediction_id, student_id, reviewed_by_staff_id, review_decision, teacher_notes, reviewed_at) FROM stdin;
\.


--
-- Data for Name: teacher_substitution; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.teacher_substitution (substitution_id, batch_id, subject_load_id, original_staff_id, substitute_staff_id, start_date, end_date, status, reason, created_by_admin_id, ended_by_admin_id, ended_at, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: tos_exam; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.tos_exam (tos_exam_id, subject_id, created_by_staff_id, title, quarter, status, test_parts_json, competencies_json, difficulty_ratio_json, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: tos_question; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.tos_question (tos_question_id, tos_exam_id, competency_id, competency_label, question_text, question_type, difficulty_band, cognitive_level, display_order, points, explanation, options_json) FROM stdin;
\.


--
-- Data for Name: user_account; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_account (user_id, email, password_hash, account_status, email_status, last_login, email_verified_at, created_at, updated_at, avatar_path) FROM stdin;
32172179-fd98-5948-885a-f62daafd17e8	demo-admin@example.com	$2b$12$BK0jaO06RhaJlB9XqcXjx.CLjR1LROAmS2notedk7uPlp8OI/7t6e	active	verified	2026-10-15 22:39:11.813776+08	\N	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	\N
2560780f-6406-5687-b59f-c19fbf762072	demo-morgan-striving@example.com	$2b$12$Hen6rA/knI19JVAaUQe/E.2/71c8G9WyJa4HKEmgHH6C5N6gtU/Wm	active	verified	\N	\N	2026-10-20 02:59:02.070557+08	2026-10-20 02:59:02.070557+08	\N
117c4122-f3eb-5e19-8219-b636b590887b	demo-teacher@example.com	$2b$12$bun8RQebGGAoQzhxrzmloup1dvLAqM48SGqX/V15IAaesX.nX7QL6	active	verified	2026-10-20 04:22:07.143641+08	\N	2026-09-23 21:31:00.305889+08	2026-09-23 21:31:00.305889+08	\N
8dce0e29-eac9-476f-a9b3-23d41108f3b9	demo-remediation-classmate@example.com	$2b$12$Tn8xG5hr1LYEj5twx3FRJujtHIXWAt8AdhKePLT99bUsXc8HmBveu	active	verified	2026-09-27 12:08:09.376451+08	\N	2026-09-27 10:52:00.403275+08	2026-09-27 10:52:00.403275+08	\N
a70644de-3d98-4a11-9ad7-8ba7dc1aa987	demo-remediation-target@example.com	$2b$12$qrgzkdsbQIoLQLqyVl6Uqe/VlbbqZ0J3ujyLVaYv5micTOoIB/wDa	active	verified	2026-10-15 22:38:38.569108+08	\N	2026-09-27 10:52:00.403275+08	2026-09-27 10:52:00.403275+08	\N
843802db-12a2-494a-ac3f-4fd511ee90b0	demo-drew-balanced@example.com	$2b$12$6dfrQ4e56.2YxqHz6CLxcuHAsfFMMkN6D6U2tURfEzuihLVcBK2qe	active	verified	2026-10-15 22:39:11.57992+08	\N	2026-09-29 10:01:56.959566+08	2026-09-29 10:01:56.959566+08	\N
\.


--
-- Data for Name: user_login_log; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_login_log (login_id, user_id, login_at, logout_at) FROM stdin;
1	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-25 08:46:55.851394+08	\N
2	32172179-fd98-5948-885a-f62daafd17e8	2026-09-25 18:23:03.99906+08	\N
3	32172179-fd98-5948-885a-f62daafd17e8	2026-09-25 18:24:08.968178+08	\N
4	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-25 18:24:09.236766+08	\N
5	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:52:44.101696+08	\N
6	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 10:52:44.32124+08	\N
7	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 10:52:44.524599+08	\N
8	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:53:55.117347+08	\N
9	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 10:53:55.331496+08	\N
10	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 10:53:55.537705+08	\N
11	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:53:55.741464+08	\N
12	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:54:14.273215+08	\N
13	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 10:54:14.481432+08	\N
14	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 10:54:14.685609+08	\N
15	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:54:14.890684+08	\N
16	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:54:39.562118+08	\N
17	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 10:54:39.772137+08	\N
18	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 10:54:39.973686+08	\N
19	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:54:40.175929+08	\N
20	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:55:16.34476+08	\N
21	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 10:55:16.553009+08	\N
22	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 10:55:16.753701+08	\N
23	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:55:16.953669+08	\N
24	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:55:39.946612+08	\N
25	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 10:55:40.155426+08	\N
26	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 10:55:40.356143+08	\N
27	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:55:40.554218+08	\N
28	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:56:11.438614+08	\N
29	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 10:56:11.689702+08	\N
30	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 10:56:11.920592+08	\N
31	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:56:12.153604+08	\N
32	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:56:41.139088+08	\N
33	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 10:56:41.348856+08	\N
34	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 10:56:41.550594+08	\N
35	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:56:41.750171+08	\N
36	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 10:56:42.108106+08	\N
37	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 10:56:42.411193+08	\N
38	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:57:13.294988+08	\N
39	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 10:57:13.504161+08	\N
40	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 10:57:13.70572+08	\N
41	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:57:13.909892+08	\N
42	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 10:57:14.26751+08	\N
43	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 10:58:22.877882+08	\N
44	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 10:58:23.149901+08	\N
45	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 10:58:23.403892+08	\N
46	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 10:59:29.828947+08	\N
47	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 10:59:30.229057+08	\N
48	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 11:03:05.759641+08	\N
49	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 11:03:06.110464+08	\N
50	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:36:30.284302+08	\N
51	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:36:51.276078+08	\N
52	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:37:12.642789+08	\N
53	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:38:03.573052+08	\N
54	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:38:26.996221+08	\N
55	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:39:30.412118+08	\N
56	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:40:27.594356+08	\N
57	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:41:16.519198+08	\N
58	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:41:49.692167+08	\N
59	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:42:16.954429+08	\N
60	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:42:59.130612+08	\N
61	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 11:43:11.981083+08	\N
62	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:43:37.519703+08	\N
63	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 11:43:50.770605+08	\N
64	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:44:20.689995+08	\N
65	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 11:44:33.479891+08	\N
66	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:45:28.985815+08	\N
67	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 11:45:40.934123+08	\N
68	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:46:25.544591+08	\N
69	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 11:46:38.120403+08	\N
70	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:47:51.361762+08	\N
71	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 11:48:03.205582+08	\N
72	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 11:48:13.514024+08	\N
73	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:49:10.553068+08	\N
74	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 11:49:22.445953+08	\N
75	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 11:49:32.689972+08	\N
76	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:50:13.657636+08	\N
77	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 11:50:25.681789+08	\N
78	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 11:50:36.218169+08	\N
79	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 11:51:00.971567+08	\N
80	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 11:51:12.959928+08	\N
81	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 11:51:23.495343+08	\N
82	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 12:06:23.153547+08	\N
83	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 12:06:28.824244+08	\N
84	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 12:06:35.096153+08	\N
85	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 12:07:12.686767+08	\N
86	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 12:07:18.4008+08	\N
87	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 12:07:24.268577+08	\N
88	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 12:08:02.928822+08	\N
89	8dce0e29-eac9-476f-a9b3-23d41108f3b9	2026-09-27 12:08:09.37636+08	\N
90	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 12:08:15.95261+08	2026-09-27 12:14:47.60379+08
91	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 12:14:56.000218+08	2026-09-27 12:15:36.676133+08
92	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 12:16:14.646236+08	\N
93	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 12:38:10.315249+08	\N
94	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 12:39:02.64079+08	\N
95	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 20:17:07.66946+08	\N
96	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 20:17:59.317738+08	\N
97	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 20:19:03.158835+08	\N
98	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 20:19:49.932018+08	\N
99	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 20:23:21.164539+08	\N
100	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 20:25:22.191688+08	\N
101	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 20:26:16.239924+08	\N
102	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 20:27:14.503136+08	\N
103	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 20:29:14.413541+08	\N
104	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 20:31:00.399327+08	\N
105	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 21:06:15.242709+08	\N
106	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 21:06:36.573328+08	\N
107	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 21:06:55.626077+08	\N
108	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 21:07:50.581996+08	\N
109	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 21:09:45.366396+08	\N
110	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 21:10:15.183077+08	\N
111	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 21:10:23.615938+08	\N
112	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 21:10:40.619803+08	\N
113	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 21:10:49.06493+08	\N
114	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 21:11:11.809971+08	\N
115	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 21:11:20.220642+08	\N
116	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 21:14:15.76155+08	\N
117	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 21:14:24.2835+08	\N
118	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 21:29:31.320183+08	\N
119	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 21:29:42.924549+08	\N
120	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 21:30:33.65815+08	\N
121	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 21:30:44.065443+08	\N
122	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 21:31:31.71921+08	\N
123	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 21:31:42.01478+08	\N
124	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 21:32:25.507888+08	\N
125	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-27 21:32:34.556258+08	\N
126	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 21:36:04.048473+08	\N
127	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-27 21:36:57.078835+08	\N
129	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-28 08:22:30.895859+08	\N
128	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-28 08:22:20.596959+08	2026-09-29 08:34:05.718028+08
130	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-09-29 08:34:25.746396+08	2026-09-29 08:35:27.662458+08
131	117c4122-f3eb-5e19-8219-b636b590887b	2026-09-29 08:35:38.847544+08	2026-09-29 10:04:14.067406+08
132	843802db-12a2-494a-ac3f-4fd511ee90b0	2026-09-29 10:04:20.710352+08	2026-09-29 10:05:29.757915+08
133	117c4122-f3eb-5e19-8219-b636b590887b	2026-10-15 20:15:10.048186+08	2026-10-15 22:01:43.601277+08
134	32172179-fd98-5948-885a-f62daafd17e8	2026-10-15 22:38:37.961408+08	\N
135	117c4122-f3eb-5e19-8219-b636b590887b	2026-10-15 22:38:38.174254+08	\N
136	843802db-12a2-494a-ac3f-4fd511ee90b0	2026-10-15 22:38:38.37377+08	\N
137	a70644de-3d98-4a11-9ad7-8ba7dc1aa987	2026-10-15 22:38:38.569022+08	\N
138	117c4122-f3eb-5e19-8219-b636b590887b	2026-10-15 22:39:11.128519+08	\N
139	843802db-12a2-494a-ac3f-4fd511ee90b0	2026-10-15 22:39:11.579821+08	\N
140	32172179-fd98-5948-885a-f62daafd17e8	2026-10-15 22:39:11.813699+08	\N
141	117c4122-f3eb-5e19-8219-b636b590887b	2026-10-19 22:13:44.541526+08	\N
142	117c4122-f3eb-5e19-8219-b636b590887b	2026-10-19 22:14:56.892546+08	\N
143	117c4122-f3eb-5e19-8219-b636b590887b	2026-10-20 01:51:56.376608+08	\N
144	117c4122-f3eb-5e19-8219-b636b590887b	2026-10-20 01:52:44.312784+08	\N
145	117c4122-f3eb-5e19-8219-b636b590887b	2026-10-20 02:39:14.166482+08	\N
146	117c4122-f3eb-5e19-8219-b636b590887b	2026-10-20 02:40:20.835816+08	\N
147	117c4122-f3eb-5e19-8219-b636b590887b	2026-10-20 02:41:06.314805+08	\N
148	117c4122-f3eb-5e19-8219-b636b590887b	2026-10-20 02:59:49.606608+08	\N
149	117c4122-f3eb-5e19-8219-b636b590887b	2026-10-20 03:01:17.006516+08	\N
150	117c4122-f3eb-5e19-8219-b636b590887b	2026-10-20 04:20:35.767149+08	\N
151	117c4122-f3eb-5e19-8219-b636b590887b	2026-10-20 04:22:07.143255+08	\N
\.


--
-- Data for Name: user_roles; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.user_roles (user_id, role_id, assigned_at) FROM stdin;
32172179-fd98-5948-885a-f62daafd17e8	1	2026-09-23 21:31:00.305889+08
117c4122-f3eb-5e19-8219-b636b590887b	2	2026-09-23 21:31:00.305889+08
a70644de-3d98-4a11-9ad7-8ba7dc1aa987	3	2026-09-27 10:52:00.403275+08
8dce0e29-eac9-476f-a9b3-23d41108f3b9	3	2026-09-27 10:52:00.403275+08
843802db-12a2-494a-ac3f-4fd511ee90b0	3	2026-09-29 10:01:56.959566+08
2560780f-6406-5687-b59f-c19fbf762072	3	2026-10-20 02:59:02.070557+08
\.


--
-- Name: academic_level_academic_level_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.academic_level_academic_level_id_seq', 1, true);


--
-- Name: academic_level_pathway_scope_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.academic_level_pathway_scope_id_seq', 1, false);


--
-- Name: academic_pathway_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.academic_pathway_id_seq', 1, false);


--
-- Name: academic_period_academic_period_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.academic_period_academic_period_id_seq', 1, true);


--
-- Name: academic_year_academic_year_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.academic_year_academic_year_id_seq', 1, true);


--
-- Name: activity_rubric_level_rubric_level_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.activity_rubric_level_rubric_level_id_seq', 1, false);


--
-- Name: ai_model_version_model_version_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.ai_model_version_model_version_id_seq', 2, true);


--
-- Name: ai_prediction_feature_feature_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.ai_prediction_feature_feature_id_seq', 1, false);


--
-- Name: ai_prediction_prediction_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.ai_prediction_prediction_id_seq', 1, false);


--
-- Name: assessment_item_assessment_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.assessment_item_assessment_id_seq', 1, false);


--
-- Name: attendance_record_attendance_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.attendance_record_attendance_id_seq', 150, true);


--
-- Name: class_class_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.class_class_id_seq', 1, true);


--
-- Name: classwork_assignment_classwork_assignment_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.classwork_assignment_classwork_assignment_id_seq', 12, true);


--
-- Name: classwork_attachment_classwork_attachment_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.classwork_attachment_classwork_attachment_id_seq', 1, true);


--
-- Name: classwork_classwork_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.classwork_classwork_id_seq', 12, true);


--
-- Name: classwork_coverage_coverage_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.classwork_coverage_coverage_id_seq', 7, true);


--
-- Name: competency_competency_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.competency_competency_id_seq', 4, true);


--
-- Name: deped_cluster_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.deped_cluster_id_seq', 1, false);


--
-- Name: development_current_term_prediction_prediction_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.development_current_term_prediction_prediction_id_seq', 63, true);


--
-- Name: grade_submission_log_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.grade_submission_log_id_seq', 1, false);


--
-- Name: grading_template_component_component_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.grading_template_component_component_id_seq', 12, true);


--
-- Name: grading_template_grading_template_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.grading_template_grading_template_id_seq', 10, true);


--
-- Name: intervention_intervention_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.intervention_intervention_id_seq', 6, true);


--
-- Name: intervention_support_material_material_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.intervention_support_material_material_id_seq', 2, true);


--
-- Name: lesson_assignment_lesson_assignment_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lesson_assignment_lesson_assignment_id_seq', 1, true);


--
-- Name: lesson_goal_goal_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lesson_goal_goal_id_seq', 1, false);


--
-- Name: lesson_goal_item_goal_item_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lesson_goal_item_goal_item_id_seq', 1, false);


--
-- Name: lesson_lesson_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lesson_lesson_id_seq', 4, true);


--
-- Name: lesson_plan_plan_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.lesson_plan_plan_id_seq', 1, false);


--
-- Name: official_section_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.official_section_id_seq', 1, false);


--
-- Name: period_template_slot_slot_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.period_template_slot_slot_id_seq', 33, true);


--
-- Name: prediction_outcome_outcome_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.prediction_outcome_outcome_id_seq', 1, false);


--
-- Name: question_option_option_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.question_option_option_id_seq', 8, true);


--
-- Name: question_question_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.question_question_id_seq', 3, true);


--
-- Name: quiz_answer_answer_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.quiz_answer_answer_id_seq', 13, true);


--
-- Name: quiz_question_quiz_question_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.quiz_question_quiz_question_id_seq', 17, true);


--
-- Name: quiz_quiz_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.quiz_quiz_id_seq', 9, true);


--
-- Name: quiz_setting_quiz_setting_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.quiz_setting_quiz_setting_id_seq', 1, true);


--
-- Name: risk_threshold_threshold_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.risk_threshold_threshold_id_seq', 1, false);


--
-- Name: role_role_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.role_role_id_seq', 1, false);


--
-- Name: rubric_template_rubric_template_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.rubric_template_rubric_template_id_seq', 1, true);


--
-- Name: setting_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.setting_id_seq', 1, false);


--
-- Name: student_assessment_score_score_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.student_assessment_score_score_id_seq', 1, false);


--
-- Name: student_class_student_class_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.student_class_student_class_id_seq', 17, true);


--
-- Name: student_period_grade_period_grade_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.student_period_grade_period_grade_id_seq', 1, false);


--
-- Name: student_submission_submission_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.student_submission_submission_id_seq', 124, true);


--
-- Name: student_suggestion_student_suggestion_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.student_suggestion_student_suggestion_id_seq', 1, false);


--
-- Name: subject_load_subject_load_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.subject_load_subject_load_id_seq', 1, true);


--
-- Name: subject_offering_subject_offering_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.subject_offering_subject_offering_id_seq', 1, false);


--
-- Name: subject_subject_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.subject_subject_id_seq', 1, true);


--
-- Name: submission_attachment_submission_attachment_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.submission_attachment_submission_attachment_id_seq', 1, false);


--
-- Name: suggestion_classwork_suggestion_classwork_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.suggestion_classwork_suggestion_classwork_id_seq', 1, false);


--
-- Name: teacher_risk_review_review_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.teacher_risk_review_review_id_seq', 1, false);


--
-- Name: teacher_substitution_substitution_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.teacher_substitution_substitution_id_seq', 1, false);


--
-- Name: tos_exam_tos_exam_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.tos_exam_tos_exam_id_seq', 1, false);


--
-- Name: tos_question_tos_question_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.tos_question_tos_question_id_seq', 1, false);


--
-- Name: user_login_log_login_id_seq; Type: SEQUENCE SET; Schema: public; Owner: postgres
--

SELECT pg_catalog.setval('public.user_login_log_login_id_seq', 151, true);


--
-- Name: academic_level_pathway_scope academic_level_pathway_scope_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_level_pathway_scope
    ADD CONSTRAINT academic_level_pathway_scope_pkey PRIMARY KEY (id);


--
-- Name: academic_level academic_level_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_level
    ADD CONSTRAINT academic_level_pkey PRIMARY KEY (academic_level_id);


--
-- Name: academic_pathway academic_pathway_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_pathway
    ADD CONSTRAINT academic_pathway_code_key UNIQUE (code);


--
-- Name: academic_pathway academic_pathway_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_pathway
    ADD CONSTRAINT academic_pathway_pkey PRIMARY KEY (id);


--
-- Name: academic_period academic_period_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_period
    ADD CONSTRAINT academic_period_pkey PRIMARY KEY (academic_period_id);


--
-- Name: academic_staff academic_staff_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_staff
    ADD CONSTRAINT academic_staff_email_key UNIQUE (email);


--
-- Name: academic_staff academic_staff_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_staff
    ADD CONSTRAINT academic_staff_pkey PRIMARY KEY (staff_id);


--
-- Name: academic_staff academic_staff_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_staff
    ADD CONSTRAINT academic_staff_user_id_key UNIQUE (user_id);


--
-- Name: academic_year academic_year_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_year
    ADD CONSTRAINT academic_year_pkey PRIMARY KEY (academic_year_id);


--
-- Name: academic_year academic_year_year_label_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_year
    ADD CONSTRAINT academic_year_year_label_key UNIQUE (year_label);


--
-- Name: activity_rubric_level activity_rubric_level_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_rubric_level
    ADD CONSTRAINT activity_rubric_level_pkey PRIMARY KEY (rubric_level_id);


--
-- Name: ai_model_version ai_model_version_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_model_version
    ADD CONSTRAINT ai_model_version_pkey PRIMARY KEY (model_version_id);


--
-- Name: ai_prediction_feature ai_prediction_feature_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_prediction_feature
    ADD CONSTRAINT ai_prediction_feature_pkey PRIMARY KEY (feature_id);


--
-- Name: ai_prediction ai_prediction_generation_request_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_prediction
    ADD CONSTRAINT ai_prediction_generation_request_id_key UNIQUE (generation_request_id);


--
-- Name: ai_prediction ai_prediction_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_prediction
    ADD CONSTRAINT ai_prediction_pkey PRIMARY KEY (prediction_id);


--
-- Name: alembic_version alembic_version_pkc; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alembic_version
    ADD CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num);


--
-- Name: api_usage_counter api_usage_counter_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.api_usage_counter
    ADD CONSTRAINT api_usage_counter_pkey PRIMARY KEY (scope, period);


--
-- Name: assessment_item assessment_item_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_item
    ADD CONSTRAINT assessment_item_pkey PRIMARY KEY (assessment_id);


--
-- Name: attendance_record attendance_record_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_record
    ADD CONSTRAINT attendance_record_pkey PRIMARY KEY (attendance_id);


--
-- Name: class class_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.class
    ADD CONSTRAINT class_pkey PRIMARY KEY (class_id);


--
-- Name: classwork_assignment classwork_assignment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_assignment
    ADD CONSTRAINT classwork_assignment_pkey PRIMARY KEY (classwork_assignment_id);


--
-- Name: classwork_attachment classwork_attachment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_attachment
    ADD CONSTRAINT classwork_attachment_pkey PRIMARY KEY (classwork_attachment_id);


--
-- Name: classwork_coverage classwork_coverage_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_coverage
    ADD CONSTRAINT classwork_coverage_pkey PRIMARY KEY (coverage_id);


--
-- Name: classwork_lesson classwork_lesson_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_lesson
    ADD CONSTRAINT classwork_lesson_pkey PRIMARY KEY (classwork_id, lesson_id);


--
-- Name: classwork classwork_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork
    ADD CONSTRAINT classwork_pkey PRIMARY KEY (classwork_id);


--
-- Name: competency competency_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.competency
    ADD CONSTRAINT competency_pkey PRIMARY KEY (competency_id);


--
-- Name: deped_cluster deped_cluster_code_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deped_cluster
    ADD CONSTRAINT deped_cluster_code_key UNIQUE (code);


--
-- Name: deped_cluster deped_cluster_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.deped_cluster
    ADD CONSTRAINT deped_cluster_pkey PRIMARY KEY (id);


--
-- Name: development_current_term_prediction development_current_term_prediction_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.development_current_term_prediction
    ADD CONSTRAINT development_current_term_prediction_pkey PRIMARY KEY (prediction_id);


--
-- Name: grade_submission_log grade_submission_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grade_submission_log
    ADD CONSTRAINT grade_submission_log_pkey PRIMARY KEY (id);


--
-- Name: grading_template_component grading_template_component_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grading_template_component
    ADD CONSTRAINT grading_template_component_pkey PRIMARY KEY (component_id);


--
-- Name: grading_template grading_template_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grading_template
    ADD CONSTRAINT grading_template_pkey PRIMARY KEY (grading_template_id);


--
-- Name: intervention intervention_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.intervention
    ADD CONSTRAINT intervention_pkey PRIMARY KEY (intervention_id);


--
-- Name: intervention intervention_source_prediction_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.intervention
    ADD CONSTRAINT intervention_source_prediction_id_key UNIQUE (source_prediction_id);


--
-- Name: intervention_support_material intervention_support_material_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.intervention_support_material
    ADD CONSTRAINT intervention_support_material_pkey PRIMARY KEY (material_id);


--
-- Name: invitation_token invitation_token_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invitation_token
    ADD CONSTRAINT invitation_token_pkey PRIMARY KEY (token_id);


--
-- Name: invitation_token invitation_token_token_hash_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invitation_token
    ADD CONSTRAINT invitation_token_token_hash_key UNIQUE (token_hash);


--
-- Name: lesson_assignment lesson_assignment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_assignment
    ADD CONSTRAINT lesson_assignment_pkey PRIMARY KEY (lesson_assignment_id);


--
-- Name: lesson_goal_item lesson_goal_item_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_goal_item
    ADD CONSTRAINT lesson_goal_item_pkey PRIMARY KEY (goal_item_id);


--
-- Name: lesson_goal lesson_goal_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_goal
    ADD CONSTRAINT lesson_goal_pkey PRIMARY KEY (goal_id);


--
-- Name: lesson lesson_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson
    ADD CONSTRAINT lesson_pkey PRIMARY KEY (lesson_id);


--
-- Name: lesson_plan lesson_plan_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_plan
    ADD CONSTRAINT lesson_plan_pkey PRIMARY KEY (plan_id);


--
-- Name: notification notification_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notification
    ADD CONSTRAINT notification_pkey PRIMARY KEY (notification_id);


--
-- Name: official_section official_section_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.official_section
    ADD CONSTRAINT official_section_pkey PRIMARY KEY (id);


--
-- Name: period_template_slot period_template_slot_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.period_template_slot
    ADD CONSTRAINT period_template_slot_pkey PRIMARY KEY (slot_id);


--
-- Name: prediction_outcome prediction_outcome_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prediction_outcome
    ADD CONSTRAINT prediction_outcome_pkey PRIMARY KEY (outcome_id);


--
-- Name: question_option question_option_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.question_option
    ADD CONSTRAINT question_option_pkey PRIMARY KEY (option_id);


--
-- Name: question question_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.question
    ADD CONSTRAINT question_pkey PRIMARY KEY (question_id);


--
-- Name: quiz_answer quiz_answer_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz_answer
    ADD CONSTRAINT quiz_answer_pkey PRIMARY KEY (answer_id);


--
-- Name: quiz quiz_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz
    ADD CONSTRAINT quiz_pkey PRIMARY KEY (quiz_id);


--
-- Name: quiz_question quiz_question_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz_question
    ADD CONSTRAINT quiz_question_pkey PRIMARY KEY (quiz_question_id);


--
-- Name: quiz_setting quiz_setting_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz_setting
    ADD CONSTRAINT quiz_setting_pkey PRIMARY KEY (quiz_setting_id);


--
-- Name: risk_threshold risk_threshold_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.risk_threshold
    ADD CONSTRAINT risk_threshold_pkey PRIMARY KEY (threshold_id);


--
-- Name: role role_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role
    ADD CONSTRAINT role_pkey PRIMARY KEY (role_id);


--
-- Name: rubric_template rubric_template_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rubric_template
    ADD CONSTRAINT rubric_template_pkey PRIMARY KEY (rubric_template_id);


--
-- Name: setting setting_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.setting
    ADD CONSTRAINT setting_pkey PRIMARY KEY (id);


--
-- Name: student_assessment_score student_assessment_score_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_assessment_score
    ADD CONSTRAINT student_assessment_score_pkey PRIMARY KEY (score_id);


--
-- Name: student_class student_class_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_class
    ADD CONSTRAINT student_class_pkey PRIMARY KEY (student_class_id);


--
-- Name: student student_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student
    ADD CONSTRAINT student_email_key UNIQUE (email);


--
-- Name: student_period_grade student_period_grade_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_period_grade
    ADD CONSTRAINT student_period_grade_pkey PRIMARY KEY (period_grade_id);


--
-- Name: student student_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student
    ADD CONSTRAINT student_pkey PRIMARY KEY (student_id);


--
-- Name: student student_student_lrn_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student
    ADD CONSTRAINT student_student_lrn_key UNIQUE (student_lrn);


--
-- Name: student_submission student_submission_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_submission
    ADD CONSTRAINT student_submission_pkey PRIMARY KEY (submission_id);


--
-- Name: student_suggestion student_suggestion_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_suggestion
    ADD CONSTRAINT student_suggestion_pkey PRIMARY KEY (student_suggestion_id);


--
-- Name: student student_user_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student
    ADD CONSTRAINT student_user_id_key UNIQUE (user_id);


--
-- Name: subject_load subject_load_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_load
    ADD CONSTRAINT subject_load_pkey PRIMARY KEY (subject_load_id);


--
-- Name: subject_offering_pathway subject_offering_pathway_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_offering_pathway
    ADD CONSTRAINT subject_offering_pathway_pkey PRIMARY KEY (subject_offering_id, pathway_id);


--
-- Name: subject_offering subject_offering_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_offering
    ADD CONSTRAINT subject_offering_pkey PRIMARY KEY (subject_offering_id);


--
-- Name: subject subject_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject
    ADD CONSTRAINT subject_pkey PRIMARY KEY (subject_id);


--
-- Name: submission_attachment submission_attachment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.submission_attachment
    ADD CONSTRAINT submission_attachment_pkey PRIMARY KEY (submission_attachment_id);


--
-- Name: suggestion_classwork suggestion_classwork_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestion_classwork
    ADD CONSTRAINT suggestion_classwork_pkey PRIMARY KEY (suggestion_classwork_id);


--
-- Name: teacher_risk_review teacher_risk_review_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teacher_risk_review
    ADD CONSTRAINT teacher_risk_review_pkey PRIMARY KEY (review_id);


--
-- Name: teacher_substitution teacher_substitution_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teacher_substitution
    ADD CONSTRAINT teacher_substitution_pkey PRIMARY KEY (substitution_id);


--
-- Name: tos_exam tos_exam_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tos_exam
    ADD CONSTRAINT tos_exam_pkey PRIMARY KEY (tos_exam_id);


--
-- Name: tos_question tos_question_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tos_question
    ADD CONSTRAINT tos_question_pkey PRIMARY KEY (tos_question_id);


--
-- Name: academic_level_pathway_scope uq_academic_level_pathway_scope_year_level; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_level_pathway_scope
    ADD CONSTRAINT uq_academic_level_pathway_scope_year_level UNIQUE (academic_year_id, academic_level_id);


--
-- Name: academic_period uq_academic_period_year_type_sequence; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_period
    ADD CONSTRAINT uq_academic_period_year_type_sequence UNIQUE (academic_year_id, period_type, period_sequence);


--
-- Name: assessment_item uq_assessment_item_scope_item; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_item
    ADD CONSTRAINT uq_assessment_item_scope_item UNIQUE (class_id, subject_id, academic_period_id, component_type, item_number);


--
-- Name: attendance_record uq_attendance_student_class_subject_date; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_record
    ADD CONSTRAINT uq_attendance_student_class_subject_date UNIQUE (student_id, class_id, subject_id, date);


--
-- Name: class uq_class_adviser_academic_year; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.class
    ADD CONSTRAINT uq_class_adviser_academic_year UNIQUE (adviser_staff_id, academic_year_id);


--
-- Name: class uq_class_class_id_academic_year_id; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.class
    ADD CONSTRAINT uq_class_class_id_academic_year_id UNIQUE (class_id, academic_year_id);


--
-- Name: classwork_assignment uq_classwork_assignment; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_assignment
    ADD CONSTRAINT uq_classwork_assignment UNIQUE (classwork_id, class_id);


--
-- Name: classwork_assignment uq_classwork_remediation_request; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_assignment
    ADD CONSTRAINT uq_classwork_remediation_request UNIQUE (remediation_request_id);


--
-- Name: development_current_term_prediction uq_development_current_term_scope_revision; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.development_current_term_prediction
    ADD CONSTRAINT uq_development_current_term_scope_revision UNIQUE (student_id, class_id, subject_id, source_period_id, target_period_id, model_version_id, revision);


--
-- Name: grading_template_component uq_grading_template_component_order; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grading_template_component
    ADD CONSTRAINT uq_grading_template_component_order UNIQUE (grading_template_id, display_order);


--
-- Name: grading_template uq_grading_template_name; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grading_template
    ADD CONSTRAINT uq_grading_template_name UNIQUE (template_name);


--
-- Name: intervention_support_material uq_intervention_support_kind; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.intervention_support_material
    ADD CONSTRAINT uq_intervention_support_kind UNIQUE (intervention_id, kind);


--
-- Name: lesson_assignment uq_lesson_assignment; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_assignment
    ADD CONSTRAINT uq_lesson_assignment UNIQUE (lesson_id, class_id);


--
-- Name: lesson_goal uq_lesson_goal_class_subject_period; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_goal
    ADD CONSTRAINT uq_lesson_goal_class_subject_period UNIQUE (class_id, subject_id, academic_period_id);


--
-- Name: official_section uq_official_section_year_level_name; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.official_section
    ADD CONSTRAINT uq_official_section_year_level_name UNIQUE (academic_year_id, academic_level_id, normalized_name);


--
-- Name: question_option uq_question_option_order; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.question_option
    ADD CONSTRAINT uq_question_option_order UNIQUE (question_id, option_order);


--
-- Name: quiz_answer uq_quiz_answer_submission_question; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz_answer
    ADD CONSTRAINT uq_quiz_answer_submission_question UNIQUE (submission_id, quiz_question_id);


--
-- Name: quiz uq_quiz_classwork; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz
    ADD CONSTRAINT uq_quiz_classwork UNIQUE (classwork_id);


--
-- Name: quiz_question uq_quiz_question_display_order; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz_question
    ADD CONSTRAINT uq_quiz_question_display_order UNIQUE (quiz_id, display_order);


--
-- Name: quiz_question uq_quiz_question_question; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz_question
    ADD CONSTRAINT uq_quiz_question_question UNIQUE (quiz_id, question_id);


--
-- Name: quiz_setting uq_quiz_setting_classwork; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz_setting
    ADD CONSTRAINT uq_quiz_setting_classwork UNIQUE (classwork_id);


--
-- Name: role uq_role_role_name; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.role
    ADD CONSTRAINT uq_role_role_name UNIQUE (role_name);


--
-- Name: rubric_template uq_rubric_template_owner_name; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rubric_template
    ADD CONSTRAINT uq_rubric_template_owner_name UNIQUE (owner_staff_id, name);


--
-- Name: student_assessment_score uq_student_assessment_score_assessment_student; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_assessment_score
    ADD CONSTRAINT uq_student_assessment_score_assessment_student UNIQUE (assessment_id, student_id);


--
-- Name: student_class uq_student_class; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_class
    ADD CONSTRAINT uq_student_class UNIQUE (student_id, class_id);


--
-- Name: student_class uq_student_class_student_academic_year; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_class
    ADD CONSTRAINT uq_student_class_student_academic_year UNIQUE (student_id, academic_year_id);


--
-- Name: student_period_grade uq_student_period_grade_scope; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_period_grade
    ADD CONSTRAINT uq_student_period_grade_scope UNIQUE (student_id, class_id, subject_id, academic_period_id);


--
-- Name: suggestion_classwork uq_suggestion_classwork_suggestion; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestion_classwork
    ADD CONSTRAINT uq_suggestion_classwork_suggestion UNIQUE (student_suggestion_id);


--
-- Name: user_account user_account_email_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT user_account_email_key UNIQUE (email);


--
-- Name: user_account user_account_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_account
    ADD CONSTRAINT user_account_pkey PRIMARY KEY (user_id);


--
-- Name: user_login_log user_login_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_login_log
    ADD CONSTRAINT user_login_log_pkey PRIMARY KEY (login_id);


--
-- Name: user_roles user_roles_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_pkey PRIMARY KEY (user_id, role_id);


--
-- Name: ix_academic_level_pathway_scope_academic_level_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_academic_level_pathway_scope_academic_level_id ON public.academic_level_pathway_scope USING btree (academic_level_id);


--
-- Name: ix_academic_level_pathway_scope_academic_year_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_academic_level_pathway_scope_academic_year_id ON public.academic_level_pathway_scope USING btree (academic_year_id);


--
-- Name: ix_academic_staff_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_academic_staff_user_id ON public.academic_staff USING btree (user_id);


--
-- Name: ix_activity_rubric_level_classwork_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_activity_rubric_level_classwork_id ON public.activity_rubric_level USING btree (classwork_id);


--
-- Name: ix_ai_model_version_model_name_type; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_ai_model_version_model_name_type ON public.ai_model_version USING btree (model_name, model_type);


--
-- Name: ix_ai_prediction_class_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_ai_prediction_class_id ON public.ai_prediction USING btree (class_id);


--
-- Name: ix_ai_prediction_feature_prediction_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_ai_prediction_feature_prediction_id ON public.ai_prediction_feature USING btree (prediction_id);


--
-- Name: ix_ai_prediction_model_version_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_ai_prediction_model_version_id ON public.ai_prediction USING btree (model_version_id);


--
-- Name: ix_ai_prediction_source_period_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_ai_prediction_source_period_id ON public.ai_prediction USING btree (source_period_id);


--
-- Name: ix_ai_prediction_student_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_ai_prediction_student_id ON public.ai_prediction USING btree (student_id);


--
-- Name: ix_ai_prediction_subject_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_ai_prediction_subject_id ON public.ai_prediction USING btree (subject_id);


--
-- Name: ix_ai_prediction_target_period_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_ai_prediction_target_period_id ON public.ai_prediction USING btree (target_period_id);


--
-- Name: ix_assessment_item_academic_period_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_assessment_item_academic_period_id ON public.assessment_item USING btree (academic_period_id);


--
-- Name: ix_assessment_item_class_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_assessment_item_class_id ON public.assessment_item USING btree (class_id);


--
-- Name: ix_assessment_item_subject_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_assessment_item_subject_id ON public.assessment_item USING btree (subject_id);


--
-- Name: ix_attendance_record_class_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_attendance_record_class_id ON public.attendance_record USING btree (class_id);


--
-- Name: ix_attendance_record_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_attendance_record_date ON public.attendance_record USING btree (date);


--
-- Name: ix_attendance_record_student_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_attendance_record_student_id ON public.attendance_record USING btree (student_id);


--
-- Name: ix_classwork_assignment_class_published_due; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_classwork_assignment_class_published_due ON public.classwork_assignment USING btree (class_id, is_published, due_date);


--
-- Name: ix_classwork_assignment_classwork_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_classwork_assignment_classwork_id ON public.classwork_assignment USING btree (classwork_id);


--
-- Name: ix_classwork_coverage_classwork; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_classwork_coverage_classwork ON public.classwork_coverage USING btree (classwork_id);


--
-- Name: ix_competency_academic_period_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_competency_academic_period_id ON public.competency USING btree (academic_period_id);


--
-- Name: ix_competency_competency_code; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_competency_competency_code ON public.competency USING btree (competency_code);


--
-- Name: ix_competency_subject_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_competency_subject_id ON public.competency USING btree (subject_id);


--
-- Name: ix_competency_subject_staff; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_competency_subject_staff ON public.competency USING btree (subject_id, created_by_staff_id);


--
-- Name: ix_development_current_term_model_version_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_development_current_term_model_version_id ON public.development_current_term_prediction USING btree (model_version_id);


--
-- Name: ix_grade_submission_log_period_grade_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_grade_submission_log_period_grade_id ON public.grade_submission_log USING btree (student_period_grade_id);


--
-- Name: ix_grade_submission_log_scope; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_grade_submission_log_scope ON public.grade_submission_log USING btree (class_id, subject_id, academic_period_id);


--
-- Name: ix_grade_submission_log_student_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_grade_submission_log_student_id ON public.grade_submission_log USING btree (student_id);


--
-- Name: ix_grade_submission_log_submitted_by; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_grade_submission_log_submitted_by ON public.grade_submission_log USING btree (submitted_by_staff_id);


--
-- Name: ix_grading_template_component_template_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_grading_template_component_template_id ON public.grading_template_component USING btree (grading_template_id);


--
-- Name: ix_grading_template_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_grading_template_status ON public.grading_template USING btree (status);


--
-- Name: ix_intervention_support_material_intervention_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_intervention_support_material_intervention_id ON public.intervention_support_material USING btree (intervention_id);


--
-- Name: ix_invitation_token_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_invitation_token_user_id ON public.invitation_token USING btree (user_id);


--
-- Name: ix_lesson_competency_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_lesson_competency_id ON public.lesson USING btree (competency_id);


--
-- Name: ix_lesson_goal_academic_period_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_lesson_goal_academic_period_id ON public.lesson_goal USING btree (academic_period_id);


--
-- Name: ix_lesson_goal_class_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_lesson_goal_class_id ON public.lesson_goal USING btree (class_id);


--
-- Name: ix_lesson_goal_item_goal_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_lesson_goal_item_goal_id ON public.lesson_goal_item USING btree (goal_id);


--
-- Name: ix_lesson_goal_subject_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_lesson_goal_subject_id ON public.lesson_goal USING btree (subject_id);


--
-- Name: ix_notification_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_notification_user_id ON public.notification USING btree (user_id);


--
-- Name: ix_period_template_slot_template_group; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_period_template_slot_template_group ON public.period_template_slot USING btree (template_group);


--
-- Name: ix_prediction_outcome_prediction_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_prediction_outcome_prediction_id ON public.prediction_outcome USING btree (prediction_id);


--
-- Name: ix_remedial_original_exam; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_remedial_original_exam ON public.classwork_assignment USING btree (original_exam_assignment_id);


--
-- Name: ix_rubric_template_owner_staff_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_rubric_template_owner_staff_id ON public.rubric_template USING btree (owner_staff_id);


--
-- Name: ix_setting_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX ix_setting_key ON public.setting USING btree (key);


--
-- Name: ix_student_academic_level_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_student_academic_level_id ON public.student USING btree (academic_level_id);


--
-- Name: ix_student_assessment_score_assessment_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_student_assessment_score_assessment_id ON public.student_assessment_score USING btree (assessment_id);


--
-- Name: ix_student_assessment_score_student_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_student_assessment_score_student_id ON public.student_assessment_score USING btree (student_id);


--
-- Name: ix_student_period_grade_academic_period_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_student_period_grade_academic_period_id ON public.student_period_grade USING btree (academic_period_id);


--
-- Name: ix_student_period_grade_class_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_student_period_grade_class_id ON public.student_period_grade USING btree (class_id);


--
-- Name: ix_student_period_grade_student_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_student_period_grade_student_id ON public.student_period_grade USING btree (student_id);


--
-- Name: ix_student_period_grade_subject_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_student_period_grade_subject_id ON public.student_period_grade USING btree (subject_id);


--
-- Name: ix_student_submission_assignment_student; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_student_submission_assignment_student ON public.student_submission USING btree (classwork_assignment_id, student_id);


--
-- Name: ix_student_suggestion_prediction_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_student_suggestion_prediction_id ON public.student_suggestion USING btree (prediction_id);


--
-- Name: ix_student_suggestion_student_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_student_suggestion_student_status ON public.student_suggestion USING btree (student_id, status);


--
-- Name: ix_student_suggestion_subject_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_student_suggestion_subject_status ON public.student_suggestion USING btree (subject_id, status);


--
-- Name: ix_student_user_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_student_user_id ON public.student USING btree (user_id);


--
-- Name: ix_subject_offering_academic_level_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_subject_offering_academic_level_id ON public.subject_offering USING btree (academic_level_id);


--
-- Name: ix_subject_offering_academic_period_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_subject_offering_academic_period_id ON public.subject_offering USING btree (academic_period_id);


--
-- Name: ix_subject_offering_academic_year_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_subject_offering_academic_year_id ON public.subject_offering USING btree (academic_year_id);


--
-- Name: ix_subject_offering_status; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_subject_offering_status ON public.subject_offering USING btree (status);


--
-- Name: ix_subject_offering_subject_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_subject_offering_subject_id ON public.subject_offering USING btree (subject_id);


--
-- Name: ix_teacher_risk_review_prediction_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_teacher_risk_review_prediction_id ON public.teacher_risk_review USING btree (prediction_id);


--
-- Name: ix_teacher_risk_review_reviewed_by_staff_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_teacher_risk_review_reviewed_by_staff_id ON public.teacher_risk_review USING btree (reviewed_by_staff_id);


--
-- Name: ix_teacher_risk_review_student_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_teacher_risk_review_student_id ON public.teacher_risk_review USING btree (student_id);


--
-- Name: ix_tos_exam_subject_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_tos_exam_subject_id ON public.tos_exam USING btree (subject_id);


--
-- Name: ix_tos_question_competency_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_tos_question_competency_id ON public.tos_question USING btree (competency_id);


--
-- Name: ix_tos_question_tos_exam_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_tos_question_tos_exam_id ON public.tos_question USING btree (tos_exam_id);


--
-- Name: ix_user_login_log_user_open; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX ix_user_login_log_user_open ON public.user_login_log USING btree (user_id, logout_at);


--
-- Name: uq_ai_model_version_active_purpose; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_ai_model_version_active_purpose ON public.ai_model_version USING btree (model_purpose) WHERE (is_active = true);


--
-- Name: uq_classwork_coverage_active_competency; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_classwork_coverage_active_competency ON public.classwork_coverage USING btree (classwork_id, competency_id) WHERE ((valid_until IS NULL) AND (lesson_id IS NULL) AND (competency_id IS NOT NULL));


--
-- Name: uq_classwork_coverage_active_lesson; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_classwork_coverage_active_lesson ON public.classwork_coverage USING btree (classwork_id, lesson_id) WHERE ((valid_until IS NULL) AND (lesson_id IS NOT NULL));


--
-- Name: uq_intervention_open_scope; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_intervention_open_scope ON public.intervention USING btree (student_id, class_id, subject_id, academic_period_id) WHERE ((status)::text = ANY ((ARRAY['CANDIDATE'::character varying, 'ACTIVE'::character varying])::text[]));


--
-- Name: uq_prediction_legacy_scope_revision; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_prediction_legacy_scope_revision ON public.ai_prediction USING btree (student_id, class_id, subject_id, source_period_id, target_period_id, revision) WHERE (model_version_id IS NULL);


--
-- Name: uq_prediction_scope_revision; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_prediction_scope_revision ON public.ai_prediction USING btree (student_id, class_id, subject_id, source_period_id, target_period_id, model_version_id, revision);


--
-- Name: uq_student_suggestion_active_lesson; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX uq_student_suggestion_active_lesson ON public.student_suggestion USING btree (student_id, subject_id, lesson_id) WHERE (((status)::text = 'ACTIVE'::text) AND (lesson_id IS NOT NULL));


--
-- Name: academic_level_pathway_scope academic_level_pathway_scope_academic_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_level_pathway_scope
    ADD CONSTRAINT academic_level_pathway_scope_academic_level_id_fkey FOREIGN KEY (academic_level_id) REFERENCES public.academic_level(academic_level_id) ON DELETE CASCADE;


--
-- Name: academic_level_pathway_scope academic_level_pathway_scope_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_level_pathway_scope
    ADD CONSTRAINT academic_level_pathway_scope_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_year(academic_year_id) ON DELETE CASCADE;


--
-- Name: academic_pathway academic_pathway_deped_cluster_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_pathway
    ADD CONSTRAINT academic_pathway_deped_cluster_id_fkey FOREIGN KEY (deped_cluster_id) REFERENCES public.deped_cluster(id) ON DELETE SET NULL;


--
-- Name: academic_period academic_period_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_period
    ADD CONSTRAINT academic_period_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_year(academic_year_id) ON DELETE CASCADE;


--
-- Name: academic_staff academic_staff_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.academic_staff
    ADD CONSTRAINT academic_staff_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_account(user_id) ON DELETE SET NULL;


--
-- Name: activity_rubric_level activity_rubric_level_classwork_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.activity_rubric_level
    ADD CONSTRAINT activity_rubric_level_classwork_id_fkey FOREIGN KEY (classwork_id) REFERENCES public.classwork(classwork_id) ON DELETE CASCADE;


--
-- Name: ai_prediction ai_prediction_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_prediction
    ADD CONSTRAINT ai_prediction_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(class_id) ON DELETE CASCADE;


--
-- Name: ai_prediction_feature ai_prediction_feature_prediction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_prediction_feature
    ADD CONSTRAINT ai_prediction_feature_prediction_id_fkey FOREIGN KEY (prediction_id) REFERENCES public.ai_prediction(prediction_id) ON DELETE CASCADE;


--
-- Name: ai_prediction ai_prediction_model_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_prediction
    ADD CONSTRAINT ai_prediction_model_version_id_fkey FOREIGN KEY (model_version_id) REFERENCES public.ai_model_version(model_version_id) ON DELETE RESTRICT;


--
-- Name: ai_prediction ai_prediction_source_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_prediction
    ADD CONSTRAINT ai_prediction_source_period_id_fkey FOREIGN KEY (source_period_id) REFERENCES public.academic_period(academic_period_id) ON DELETE CASCADE;


--
-- Name: ai_prediction ai_prediction_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_prediction
    ADD CONSTRAINT ai_prediction_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE;


--
-- Name: ai_prediction ai_prediction_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_prediction
    ADD CONSTRAINT ai_prediction_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id) ON DELETE CASCADE;


--
-- Name: ai_prediction ai_prediction_target_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.ai_prediction
    ADD CONSTRAINT ai_prediction_target_period_id_fkey FOREIGN KEY (target_period_id) REFERENCES public.academic_period(academic_period_id) ON DELETE CASCADE;


--
-- Name: assessment_item assessment_item_academic_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_item
    ADD CONSTRAINT assessment_item_academic_period_id_fkey FOREIGN KEY (academic_period_id) REFERENCES public.academic_period(academic_period_id) ON DELETE CASCADE;


--
-- Name: assessment_item assessment_item_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_item
    ADD CONSTRAINT assessment_item_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(class_id) ON DELETE CASCADE;


--
-- Name: assessment_item assessment_item_entered_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_item
    ADD CONSTRAINT assessment_item_entered_by_staff_id_fkey FOREIGN KEY (entered_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: assessment_item assessment_item_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.assessment_item
    ADD CONSTRAINT assessment_item_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id) ON DELETE CASCADE;


--
-- Name: attendance_record attendance_record_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_record
    ADD CONSTRAINT attendance_record_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(class_id) ON DELETE CASCADE;


--
-- Name: attendance_record attendance_record_recorded_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_record
    ADD CONSTRAINT attendance_record_recorded_by_staff_id_fkey FOREIGN KEY (recorded_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: attendance_record attendance_record_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_record
    ADD CONSTRAINT attendance_record_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE;


--
-- Name: attendance_record attendance_record_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.attendance_record
    ADD CONSTRAINT attendance_record_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id) ON DELETE CASCADE;


--
-- Name: class class_academic_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.class
    ADD CONSTRAINT class_academic_level_id_fkey FOREIGN KEY (academic_level_id) REFERENCES public.academic_level(academic_level_id);


--
-- Name: class class_academic_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.class
    ADD CONSTRAINT class_academic_period_id_fkey FOREIGN KEY (academic_period_id) REFERENCES public.academic_period(academic_period_id);


--
-- Name: class class_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.class
    ADD CONSTRAINT class_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_year(academic_year_id);


--
-- Name: class class_adviser_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.class
    ADD CONSTRAINT class_adviser_staff_id_fkey FOREIGN KEY (adviser_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: class class_paired_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.class
    ADD CONSTRAINT class_paired_class_id_fkey FOREIGN KEY (paired_class_id) REFERENCES public.class(class_id) ON DELETE SET NULL;


--
-- Name: class class_pathway_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.class
    ADD CONSTRAINT class_pathway_id_fkey FOREIGN KEY (pathway_id) REFERENCES public.academic_pathway(id) ON DELETE SET NULL;


--
-- Name: classwork_assignment classwork_assignment_academic_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_assignment
    ADD CONSTRAINT classwork_assignment_academic_period_id_fkey FOREIGN KEY (academic_period_id) REFERENCES public.academic_period(academic_period_id) ON DELETE RESTRICT;


--
-- Name: classwork_assignment classwork_assignment_assigned_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_assignment
    ADD CONSTRAINT classwork_assignment_assigned_by_staff_id_fkey FOREIGN KEY (assigned_by_staff_id) REFERENCES public.academic_staff(staff_id);


--
-- Name: classwork_assignment classwork_assignment_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_assignment
    ADD CONSTRAINT classwork_assignment_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(class_id) ON DELETE CASCADE;


--
-- Name: classwork_assignment classwork_assignment_classwork_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_assignment
    ADD CONSTRAINT classwork_assignment_classwork_id_fkey FOREIGN KEY (classwork_id) REFERENCES public.classwork(classwork_id) ON DELETE CASCADE;


--
-- Name: classwork_attachment classwork_attachment_classwork_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_attachment
    ADD CONSTRAINT classwork_attachment_classwork_id_fkey FOREIGN KEY (classwork_id) REFERENCES public.classwork(classwork_id) ON DELETE CASCADE;


--
-- Name: classwork_coverage classwork_coverage_classwork_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_coverage
    ADD CONSTRAINT classwork_coverage_classwork_id_fkey FOREIGN KEY (classwork_id) REFERENCES public.classwork(classwork_id) ON DELETE CASCADE;


--
-- Name: classwork_coverage classwork_coverage_competency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_coverage
    ADD CONSTRAINT classwork_coverage_competency_id_fkey FOREIGN KEY (competency_id) REFERENCES public.competency(competency_id) ON DELETE RESTRICT;


--
-- Name: classwork_coverage classwork_coverage_lesson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_coverage
    ADD CONSTRAINT classwork_coverage_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lesson(lesson_id) ON DELETE RESTRICT;


--
-- Name: classwork_coverage classwork_coverage_linked_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_coverage
    ADD CONSTRAINT classwork_coverage_linked_by_staff_id_fkey FOREIGN KEY (linked_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: classwork_coverage classwork_coverage_removed_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_coverage
    ADD CONSTRAINT classwork_coverage_removed_by_staff_id_fkey FOREIGN KEY (removed_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: classwork classwork_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork
    ADD CONSTRAINT classwork_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.academic_staff(staff_id);


--
-- Name: classwork_lesson classwork_lesson_classwork_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_lesson
    ADD CONSTRAINT classwork_lesson_classwork_id_fkey FOREIGN KEY (classwork_id) REFERENCES public.classwork(classwork_id) ON DELETE CASCADE;


--
-- Name: classwork_lesson classwork_lesson_lesson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_lesson
    ADD CONSTRAINT classwork_lesson_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lesson(lesson_id) ON DELETE CASCADE;


--
-- Name: classwork classwork_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork
    ADD CONSTRAINT classwork_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id);


--
-- Name: competency competency_academic_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.competency
    ADD CONSTRAINT competency_academic_period_id_fkey FOREIGN KEY (academic_period_id) REFERENCES public.academic_period(academic_period_id) ON DELETE SET NULL;


--
-- Name: competency competency_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.competency
    ADD CONSTRAINT competency_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: competency competency_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.competency
    ADD CONSTRAINT competency_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id) ON DELETE CASCADE;


--
-- Name: development_current_term_prediction development_current_term_prediction_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.development_current_term_prediction
    ADD CONSTRAINT development_current_term_prediction_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(class_id) ON DELETE CASCADE;


--
-- Name: development_current_term_prediction development_current_term_prediction_model_version_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.development_current_term_prediction
    ADD CONSTRAINT development_current_term_prediction_model_version_id_fkey FOREIGN KEY (model_version_id) REFERENCES public.ai_model_version(model_version_id) ON DELETE RESTRICT;


--
-- Name: development_current_term_prediction development_current_term_prediction_source_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.development_current_term_prediction
    ADD CONSTRAINT development_current_term_prediction_source_period_id_fkey FOREIGN KEY (source_period_id) REFERENCES public.academic_period(academic_period_id) ON DELETE CASCADE;


--
-- Name: development_current_term_prediction development_current_term_prediction_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.development_current_term_prediction
    ADD CONSTRAINT development_current_term_prediction_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE;


--
-- Name: development_current_term_prediction development_current_term_prediction_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.development_current_term_prediction
    ADD CONSTRAINT development_current_term_prediction_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id) ON DELETE CASCADE;


--
-- Name: development_current_term_prediction development_current_term_prediction_target_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.development_current_term_prediction
    ADD CONSTRAINT development_current_term_prediction_target_period_id_fkey FOREIGN KEY (target_period_id) REFERENCES public.academic_period(academic_period_id) ON DELETE CASCADE;


--
-- Name: classwork_assignment fk_classwork_source_intervention; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_assignment
    ADD CONSTRAINT fk_classwork_source_intervention FOREIGN KEY (source_intervention_id) REFERENCES public.intervention(intervention_id) ON DELETE RESTRICT;


--
-- Name: classwork_assignment fk_classwork_target_student; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_assignment
    ADD CONSTRAINT fk_classwork_target_student FOREIGN KEY (recipient_student_id) REFERENCES public.student(student_id) ON DELETE RESTRICT;


--
-- Name: classwork_assignment fk_remedial_original_exam; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.classwork_assignment
    ADD CONSTRAINT fk_remedial_original_exam FOREIGN KEY (original_exam_assignment_id) REFERENCES public.classwork_assignment(classwork_assignment_id) ON DELETE RESTRICT;


--
-- Name: student_class fk_student_class_class_academic_year; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_class
    ADD CONSTRAINT fk_student_class_class_academic_year FOREIGN KEY (class_id, academic_year_id) REFERENCES public.class(class_id, academic_year_id) ON DELETE CASCADE;


--
-- Name: subject fk_subject_grading_template_id; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject
    ADD CONSTRAINT fk_subject_grading_template_id FOREIGN KEY (grading_template_id) REFERENCES public.grading_template(grading_template_id) ON DELETE RESTRICT;


--
-- Name: grade_submission_log grade_submission_log_academic_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grade_submission_log
    ADD CONSTRAINT grade_submission_log_academic_period_id_fkey FOREIGN KEY (academic_period_id) REFERENCES public.academic_period(academic_period_id) ON DELETE CASCADE;


--
-- Name: grade_submission_log grade_submission_log_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grade_submission_log
    ADD CONSTRAINT grade_submission_log_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(class_id) ON DELETE CASCADE;


--
-- Name: grade_submission_log grade_submission_log_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grade_submission_log
    ADD CONSTRAINT grade_submission_log_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE;


--
-- Name: grade_submission_log grade_submission_log_student_period_grade_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grade_submission_log
    ADD CONSTRAINT grade_submission_log_student_period_grade_id_fkey FOREIGN KEY (student_period_grade_id) REFERENCES public.student_period_grade(period_grade_id) ON DELETE SET NULL;


--
-- Name: grade_submission_log grade_submission_log_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grade_submission_log
    ADD CONSTRAINT grade_submission_log_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id) ON DELETE CASCADE;


--
-- Name: grade_submission_log grade_submission_log_submitted_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grade_submission_log
    ADD CONSTRAINT grade_submission_log_submitted_by_staff_id_fkey FOREIGN KEY (submitted_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: grading_template_component grading_template_component_grading_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.grading_template_component
    ADD CONSTRAINT grading_template_component_grading_template_id_fkey FOREIGN KEY (grading_template_id) REFERENCES public.grading_template(grading_template_id) ON DELETE CASCADE;


--
-- Name: intervention intervention_academic_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.intervention
    ADD CONSTRAINT intervention_academic_period_id_fkey FOREIGN KEY (academic_period_id) REFERENCES public.academic_period(academic_period_id) ON DELETE RESTRICT;


--
-- Name: intervention intervention_activated_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.intervention
    ADD CONSTRAINT intervention_activated_by_staff_id_fkey FOREIGN KEY (activated_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE RESTRICT;


--
-- Name: intervention intervention_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.intervention
    ADD CONSTRAINT intervention_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(class_id) ON DELETE RESTRICT;


--
-- Name: intervention intervention_source_prediction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.intervention
    ADD CONSTRAINT intervention_source_prediction_id_fkey FOREIGN KEY (source_prediction_id) REFERENCES public.development_current_term_prediction(prediction_id) ON DELETE RESTRICT;


--
-- Name: intervention intervention_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.intervention
    ADD CONSTRAINT intervention_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE RESTRICT;


--
-- Name: intervention intervention_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.intervention
    ADD CONSTRAINT intervention_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id) ON DELETE RESTRICT;


--
-- Name: intervention_support_material intervention_support_material_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.intervention_support_material
    ADD CONSTRAINT intervention_support_material_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE RESTRICT;


--
-- Name: intervention_support_material intervention_support_material_intervention_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.intervention_support_material
    ADD CONSTRAINT intervention_support_material_intervention_id_fkey FOREIGN KEY (intervention_id) REFERENCES public.intervention(intervention_id) ON DELETE RESTRICT;


--
-- Name: intervention_support_material intervention_support_material_sent_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.intervention_support_material
    ADD CONSTRAINT intervention_support_material_sent_by_staff_id_fkey FOREIGN KEY (sent_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE RESTRICT;


--
-- Name: intervention_support_material intervention_support_material_updated_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.intervention_support_material
    ADD CONSTRAINT intervention_support_material_updated_by_staff_id_fkey FOREIGN KEY (updated_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE RESTRICT;


--
-- Name: invitation_token invitation_token_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invitation_token
    ADD CONSTRAINT invitation_token_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_account(user_id) ON DELETE CASCADE;


--
-- Name: lesson_assignment lesson_assignment_assigned_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_assignment
    ADD CONSTRAINT lesson_assignment_assigned_by_staff_id_fkey FOREIGN KEY (assigned_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: lesson_assignment lesson_assignment_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_assignment
    ADD CONSTRAINT lesson_assignment_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(class_id) ON DELETE CASCADE;


--
-- Name: lesson_assignment lesson_assignment_lesson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_assignment
    ADD CONSTRAINT lesson_assignment_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lesson(lesson_id) ON DELETE CASCADE;


--
-- Name: lesson lesson_competency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson
    ADD CONSTRAINT lesson_competency_id_fkey FOREIGN KEY (competency_id) REFERENCES public.competency(competency_id) ON DELETE SET NULL;


--
-- Name: lesson lesson_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson
    ADD CONSTRAINT lesson_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: lesson_goal lesson_goal_academic_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_goal
    ADD CONSTRAINT lesson_goal_academic_period_id_fkey FOREIGN KEY (academic_period_id) REFERENCES public.academic_period(academic_period_id) ON DELETE CASCADE;


--
-- Name: lesson_goal lesson_goal_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_goal
    ADD CONSTRAINT lesson_goal_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(class_id) ON DELETE CASCADE;


--
-- Name: lesson_goal lesson_goal_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_goal
    ADD CONSTRAINT lesson_goal_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: lesson_goal_item lesson_goal_item_classwork_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_goal_item
    ADD CONSTRAINT lesson_goal_item_classwork_id_fkey FOREIGN KEY (classwork_id) REFERENCES public.classwork(classwork_id) ON DELETE CASCADE;


--
-- Name: lesson_goal_item lesson_goal_item_goal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_goal_item
    ADD CONSTRAINT lesson_goal_item_goal_id_fkey FOREIGN KEY (goal_id) REFERENCES public.lesson_goal(goal_id) ON DELETE CASCADE;


--
-- Name: lesson_goal_item lesson_goal_item_lesson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_goal_item
    ADD CONSTRAINT lesson_goal_item_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lesson(lesson_id) ON DELETE CASCADE;


--
-- Name: lesson_goal lesson_goal_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_goal
    ADD CONSTRAINT lesson_goal_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id) ON DELETE CASCADE;


--
-- Name: lesson_plan lesson_plan_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_plan
    ADD CONSTRAINT lesson_plan_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(class_id) ON DELETE SET NULL;


--
-- Name: lesson_plan lesson_plan_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_plan
    ADD CONSTRAINT lesson_plan_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id) ON DELETE SET NULL;


--
-- Name: lesson_plan lesson_plan_teacher_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson_plan
    ADD CONSTRAINT lesson_plan_teacher_id_fkey FOREIGN KEY (teacher_id) REFERENCES public.academic_staff(staff_id) ON DELETE CASCADE;


--
-- Name: lesson lesson_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.lesson
    ADD CONSTRAINT lesson_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id) ON DELETE CASCADE;


--
-- Name: notification notification_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.notification
    ADD CONSTRAINT notification_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_account(user_id) ON DELETE CASCADE;


--
-- Name: official_section official_section_academic_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.official_section
    ADD CONSTRAINT official_section_academic_level_id_fkey FOREIGN KEY (academic_level_id) REFERENCES public.academic_level(academic_level_id) ON DELETE CASCADE;


--
-- Name: official_section official_section_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.official_section
    ADD CONSTRAINT official_section_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_year(academic_year_id) ON DELETE CASCADE;


--
-- Name: official_section official_section_pathway_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.official_section
    ADD CONSTRAINT official_section_pathway_id_fkey FOREIGN KEY (pathway_id) REFERENCES public.academic_pathway(id) ON DELETE RESTRICT;


--
-- Name: prediction_outcome prediction_outcome_prediction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.prediction_outcome
    ADD CONSTRAINT prediction_outcome_prediction_id_fkey FOREIGN KEY (prediction_id) REFERENCES public.ai_prediction(prediction_id) ON DELETE CASCADE;


--
-- Name: question question_lesson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.question
    ADD CONSTRAINT question_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lesson(lesson_id) ON DELETE SET NULL;


--
-- Name: question_option question_option_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.question_option
    ADD CONSTRAINT question_option_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.question(question_id) ON DELETE CASCADE;


--
-- Name: quiz_answer quiz_answer_quiz_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz_answer
    ADD CONSTRAINT quiz_answer_quiz_question_id_fkey FOREIGN KEY (quiz_question_id) REFERENCES public.quiz_question(quiz_question_id) ON DELETE CASCADE;


--
-- Name: quiz_answer quiz_answer_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz_answer
    ADD CONSTRAINT quiz_answer_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.student_submission(submission_id) ON DELETE CASCADE;


--
-- Name: quiz quiz_classwork_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz
    ADD CONSTRAINT quiz_classwork_id_fkey FOREIGN KEY (classwork_id) REFERENCES public.classwork(classwork_id) ON DELETE CASCADE;


--
-- Name: quiz_question quiz_question_question_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz_question
    ADD CONSTRAINT quiz_question_question_id_fkey FOREIGN KEY (question_id) REFERENCES public.question(question_id) ON DELETE CASCADE;


--
-- Name: quiz_question quiz_question_quiz_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz_question
    ADD CONSTRAINT quiz_question_quiz_id_fkey FOREIGN KEY (quiz_id) REFERENCES public.quiz(quiz_id) ON DELETE CASCADE;


--
-- Name: quiz_setting quiz_setting_classwork_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.quiz_setting
    ADD CONSTRAINT quiz_setting_classwork_id_fkey FOREIGN KEY (classwork_id) REFERENCES public.classwork(classwork_id) ON DELETE CASCADE;


--
-- Name: rubric_template rubric_template_owner_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.rubric_template
    ADD CONSTRAINT rubric_template_owner_staff_id_fkey FOREIGN KEY (owner_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE CASCADE;


--
-- Name: setting setting_updated_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.setting
    ADD CONSTRAINT setting_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES public.user_account(user_id);


--
-- Name: student student_academic_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student
    ADD CONSTRAINT student_academic_level_id_fkey FOREIGN KEY (academic_level_id) REFERENCES public.academic_level(academic_level_id) ON DELETE RESTRICT;


--
-- Name: student_assessment_score student_assessment_score_assessment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_assessment_score
    ADD CONSTRAINT student_assessment_score_assessment_id_fkey FOREIGN KEY (assessment_id) REFERENCES public.assessment_item(assessment_id) ON DELETE CASCADE;


--
-- Name: student_assessment_score student_assessment_score_entered_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_assessment_score
    ADD CONSTRAINT student_assessment_score_entered_by_staff_id_fkey FOREIGN KEY (entered_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: student_assessment_score student_assessment_score_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_assessment_score
    ADD CONSTRAINT student_assessment_score_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE;


--
-- Name: student_class student_class_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_class
    ADD CONSTRAINT student_class_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id);


--
-- Name: student_period_grade student_period_grade_academic_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_period_grade
    ADD CONSTRAINT student_period_grade_academic_period_id_fkey FOREIGN KEY (academic_period_id) REFERENCES public.academic_period(academic_period_id) ON DELETE CASCADE;


--
-- Name: student_period_grade student_period_grade_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_period_grade
    ADD CONSTRAINT student_period_grade_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(class_id) ON DELETE CASCADE;


--
-- Name: student_period_grade student_period_grade_entered_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_period_grade
    ADD CONSTRAINT student_period_grade_entered_by_staff_id_fkey FOREIGN KEY (entered_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: student_period_grade student_period_grade_finalized_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_period_grade
    ADD CONSTRAINT student_period_grade_finalized_by_staff_id_fkey FOREIGN KEY (finalized_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: student_period_grade student_period_grade_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_period_grade
    ADD CONSTRAINT student_period_grade_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE;


--
-- Name: student_period_grade student_period_grade_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_period_grade
    ADD CONSTRAINT student_period_grade_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id) ON DELETE CASCADE;


--
-- Name: student_submission student_submission_classwork_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_submission
    ADD CONSTRAINT student_submission_classwork_assignment_id_fkey FOREIGN KEY (classwork_assignment_id) REFERENCES public.classwork_assignment(classwork_assignment_id) ON DELETE CASCADE;


--
-- Name: student_submission student_submission_graded_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_submission
    ADD CONSTRAINT student_submission_graded_by_staff_id_fkey FOREIGN KEY (graded_by_staff_id) REFERENCES public.academic_staff(staff_id);


--
-- Name: student_submission student_submission_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_submission
    ADD CONSTRAINT student_submission_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE;


--
-- Name: student_suggestion student_suggestion_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_suggestion
    ADD CONSTRAINT student_suggestion_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: student_suggestion student_suggestion_lesson_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_suggestion
    ADD CONSTRAINT student_suggestion_lesson_id_fkey FOREIGN KEY (lesson_id) REFERENCES public.lesson(lesson_id) ON DELETE SET NULL;


--
-- Name: student_suggestion student_suggestion_prediction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_suggestion
    ADD CONSTRAINT student_suggestion_prediction_id_fkey FOREIGN KEY (prediction_id) REFERENCES public.ai_prediction(prediction_id) ON DELETE SET NULL;


--
-- Name: student_suggestion student_suggestion_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_suggestion
    ADD CONSTRAINT student_suggestion_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE;


--
-- Name: student_suggestion student_suggestion_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student_suggestion
    ADD CONSTRAINT student_suggestion_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id) ON DELETE CASCADE;


--
-- Name: student student_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.student
    ADD CONSTRAINT student_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_account(user_id) ON DELETE SET NULL;


--
-- Name: subject subject_academic_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject
    ADD CONSTRAINT subject_academic_level_id_fkey FOREIGN KEY (academic_level_id) REFERENCES public.academic_level(academic_level_id);


--
-- Name: subject_load subject_load_academic_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_load
    ADD CONSTRAINT subject_load_academic_period_id_fkey FOREIGN KEY (academic_period_id) REFERENCES public.academic_period(academic_period_id);


--
-- Name: subject_load subject_load_class_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_load
    ADD CONSTRAINT subject_load_class_id_fkey FOREIGN KEY (class_id) REFERENCES public.class(class_id);


--
-- Name: subject_load subject_load_continued_from_load_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_load
    ADD CONSTRAINT subject_load_continued_from_load_id_fkey FOREIGN KEY (continued_from_load_id) REFERENCES public.subject_load(subject_load_id);


--
-- Name: subject_load subject_load_slot_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_load
    ADD CONSTRAINT subject_load_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES public.period_template_slot(slot_id);


--
-- Name: subject_load subject_load_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_load
    ADD CONSTRAINT subject_load_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.academic_staff(staff_id);


--
-- Name: subject_load subject_load_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_load
    ADD CONSTRAINT subject_load_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id);


--
-- Name: subject_offering subject_offering_academic_level_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_offering
    ADD CONSTRAINT subject_offering_academic_level_id_fkey FOREIGN KEY (academic_level_id) REFERENCES public.academic_level(academic_level_id);


--
-- Name: subject_offering subject_offering_academic_period_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_offering
    ADD CONSTRAINT subject_offering_academic_period_id_fkey FOREIGN KEY (academic_period_id) REFERENCES public.academic_period(academic_period_id) ON DELETE CASCADE;


--
-- Name: subject_offering subject_offering_academic_year_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_offering
    ADD CONSTRAINT subject_offering_academic_year_id_fkey FOREIGN KEY (academic_year_id) REFERENCES public.academic_year(academic_year_id) ON DELETE CASCADE;


--
-- Name: subject_offering_pathway subject_offering_pathway_pathway_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_offering_pathway
    ADD CONSTRAINT subject_offering_pathway_pathway_id_fkey FOREIGN KEY (pathway_id) REFERENCES public.academic_pathway(id) ON DELETE CASCADE;


--
-- Name: subject_offering_pathway subject_offering_pathway_subject_offering_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_offering_pathway
    ADD CONSTRAINT subject_offering_pathway_subject_offering_id_fkey FOREIGN KEY (subject_offering_id) REFERENCES public.subject_offering(subject_offering_id) ON DELETE CASCADE;


--
-- Name: subject_offering subject_offering_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.subject_offering
    ADD CONSTRAINT subject_offering_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id) ON DELETE CASCADE;


--
-- Name: submission_attachment submission_attachment_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.submission_attachment
    ADD CONSTRAINT submission_attachment_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.student_submission(submission_id) ON DELETE CASCADE;


--
-- Name: suggestion_classwork suggestion_classwork_classwork_assignment_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestion_classwork
    ADD CONSTRAINT suggestion_classwork_classwork_assignment_id_fkey FOREIGN KEY (classwork_assignment_id) REFERENCES public.classwork_assignment(classwork_assignment_id) ON DELETE CASCADE;


--
-- Name: suggestion_classwork suggestion_classwork_student_suggestion_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.suggestion_classwork
    ADD CONSTRAINT suggestion_classwork_student_suggestion_id_fkey FOREIGN KEY (student_suggestion_id) REFERENCES public.student_suggestion(student_suggestion_id) ON DELETE CASCADE;


--
-- Name: teacher_risk_review teacher_risk_review_prediction_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teacher_risk_review
    ADD CONSTRAINT teacher_risk_review_prediction_id_fkey FOREIGN KEY (prediction_id) REFERENCES public.ai_prediction(prediction_id) ON DELETE CASCADE;


--
-- Name: teacher_risk_review teacher_risk_review_reviewed_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teacher_risk_review
    ADD CONSTRAINT teacher_risk_review_reviewed_by_staff_id_fkey FOREIGN KEY (reviewed_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: teacher_risk_review teacher_risk_review_student_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teacher_risk_review
    ADD CONSTRAINT teacher_risk_review_student_id_fkey FOREIGN KEY (student_id) REFERENCES public.student(student_id) ON DELETE CASCADE;


--
-- Name: teacher_substitution teacher_substitution_created_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teacher_substitution
    ADD CONSTRAINT teacher_substitution_created_by_admin_id_fkey FOREIGN KEY (created_by_admin_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: teacher_substitution teacher_substitution_ended_by_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teacher_substitution
    ADD CONSTRAINT teacher_substitution_ended_by_admin_id_fkey FOREIGN KEY (ended_by_admin_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: teacher_substitution teacher_substitution_original_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teacher_substitution
    ADD CONSTRAINT teacher_substitution_original_staff_id_fkey FOREIGN KEY (original_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE RESTRICT;


--
-- Name: teacher_substitution teacher_substitution_subject_load_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teacher_substitution
    ADD CONSTRAINT teacher_substitution_subject_load_id_fkey FOREIGN KEY (subject_load_id) REFERENCES public.subject_load(subject_load_id) ON DELETE RESTRICT;


--
-- Name: teacher_substitution teacher_substitution_substitute_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.teacher_substitution
    ADD CONSTRAINT teacher_substitution_substitute_staff_id_fkey FOREIGN KEY (substitute_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE RESTRICT;


--
-- Name: tos_exam tos_exam_created_by_staff_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tos_exam
    ADD CONSTRAINT tos_exam_created_by_staff_id_fkey FOREIGN KEY (created_by_staff_id) REFERENCES public.academic_staff(staff_id) ON DELETE SET NULL;


--
-- Name: tos_exam tos_exam_subject_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tos_exam
    ADD CONSTRAINT tos_exam_subject_id_fkey FOREIGN KEY (subject_id) REFERENCES public.subject(subject_id) ON DELETE CASCADE;


--
-- Name: tos_question tos_question_competency_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tos_question
    ADD CONSTRAINT tos_question_competency_id_fkey FOREIGN KEY (competency_id) REFERENCES public.competency(competency_id) ON DELETE SET NULL;


--
-- Name: tos_question tos_question_tos_exam_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tos_question
    ADD CONSTRAINT tos_question_tos_exam_id_fkey FOREIGN KEY (tos_exam_id) REFERENCES public.tos_exam(tos_exam_id) ON DELETE CASCADE;


--
-- Name: user_login_log user_login_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_login_log
    ADD CONSTRAINT user_login_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_account(user_id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.role(role_id) ON DELETE CASCADE;


--
-- Name: user_roles user_roles_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_roles
    ADD CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.user_account(user_id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict LJoKH6d5ZEmRqMWjcu3wQYCFJvjodJ8Z2tc8fbEOKViN2OnJOHfur9nbldeOVDO


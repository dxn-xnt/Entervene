// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import TeacherDashboard from "./dashboard";
import type { TeacherDashboardHealthResponse } from "@/lib/api";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="app-layout">{children}</div>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button type="button" aria-label="Toggle sidebar" />,
}));

let mockAcademicContext = {
  selectedYearId: 101,
  selectedPeriodId: 201,
  selectedYear: { academic_year_id: 101, year_label: "2026-2027", is_active: true },
  selectedPeriod: { id: 201, period: "Q1", is_active: true },
  isLoading: false,
};

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => mockAcademicContext,
}));

const mockGetTeacherDashboardHealth = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getTeacherDashboardHealth: (...args: unknown[]) => mockGetTeacherDashboardHealth(...args),
  };
});

// Mock Recharts ResponsiveContainer for jsdom (zero-width container)
vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 640, height: 260 }}>{children}</div>
    ),
  };
});

function buildSampleResponse(overrides: Partial<TeacherDashboardHealthResponse> = {}): TeacherDashboardHealthResponse {
  return {
    term_info: {
      period_id: 201,
      period_name: "Q1",
      academic_year: "2026-2027",
      academic_year_id: 101,
      is_active: true,
    },
    dashboard_filters: [
      { class_id: 301, section_name: "11-Rizal", subject_id: 11, subject_name: "General Mathematics" },
      { class_id: 302, section_name: "11-Luna", subject_id: 12, subject_name: "Oral Communication" },
    ],
    analytics: {
      submission_rate: {
        submission_rate_percent: 82.5,
        submitted_count: 33,
        expected_count: 40,
        resolved_submitted_count: 33,
        late_rate_percent: 9.1,
        late_count: 3,
        late_eligible_count: 33,
        excused_excluded_count: 1,
        eligible_assignment_count: 4,
        warnings: [],
      },
      grading_completion: {
        grading_completion_rate_percent: 75.0,
        finalized_count: 18,
        auto_graded_count: 12,
        teacher_graded_count: 6,
        awaiting_grading_count: 6,
        submitted_gradable_count: 24,
        resolved_finalized_count: 18,
        resolved_awaiting_grading_count: 6,
        eligible_assignment_count: 3,
        warnings: [],
      },
      graded_performance: {
        avg_graded_score_percent: 84.2,
        scored_submission_count: 18,
        graded_assignment_count: 3,
        eligible_assignment_count: 3,
        warnings: [],
      },
      term_grades: {
        current_grade: 86.4,
        passing_rate_percent: 80.0,
        available_grade_count: 20,
        total_grade_count: 25,
        passing_count: 16,
        passing_threshold: 80.0,
        current_grade_meets_threshold: true,
        warnings: [],
      },
      threshold_summary: {
        meeting_threshold_count: 16,
        below_threshold_count: 4,
        meeting_threshold_percent: 80.0,
        below_threshold_percent: 20.0,
        available_grade_count: 20,
        total_grade_count: 25,
        grade_coverage_percent: 80.0,
        uniform_passing_threshold: 80.0,
        has_mixed_thresholds: false,
        warnings: [],
      },
      period_attendance: {
        rate: 93.4,
        record_count: 152,
        present_count: 135,
        late_count: 7,
        excused_count: 4,
        absent_count: 6,
      },
      interventions: {
        candidate_count: 2,
        active_count: 3,
        resolved_improved_count: 2,
        resolved_other_count: 1,
        resolved_total_count: 3,
        total_count: 8,
        activated_count: 6,
        activation_rate_percent: 75.0,
        improved_prediction_resolution_rate_percent: 33.3,
        other_resolution_rate_percent: 16.7,
        practice_assessments: {
          published_count: 4,
          attempted_count: 3,
          passed_count: 2,
          attempt_participation_rate_percent: 75.0,
          attempted_pass_rate_percent: 66.7,
          is_ungraded: true,
          excluded_from_official_grades: true,
        },
      },
      subject_comparisons: [
        {
          subject_id: 11,
          subject_name: "General Mathematics",
          section_count: 1,
          student_count: 15,
          submission_rate_percent: 85.0,
          grading_completion_rate_percent: 80.0,
          avg_graded_score_percent: 86.0,
          passing_rate_percent: 80.0,
          mean_current_grade: 87.2,
          available_grade_count: 12,
          total_grade_count: 15,
          grade_coverage_percent: 80.0,
          passing_threshold: 80.0,
        },
      ],
      category_performance: [
        {
          category: "WRITTEN_WORK",
          label: "Written Work",
          assignment_count: 2,
          scored_submission_count: 12,
          avg_graded_score_percent: 85.0,
          grading_completion_rate_percent: 80.0,
          awaiting_grading_count: 3,
        },
      ],
      grade_distribution: {
        bands: [
          { band: "90-100", count: 6, percent: 30.0 },
          { band: "85-89", count: 6, percent: 30.0 },
          { band: "80-84", count: 4, percent: 20.0 },
          { band: "75-79", count: 3, percent: 15.0 },
          { band: "Below 75", count: 1, percent: 5.0 },
        ],
        total_grade_count: 25,
        available_grade_count: 20,
        unavailable_grade_count: 5,
      },
    },
    kpis: {
      active_classes: 2,
      enrolled_students: 25,
      overall_completion_rate: 82.5,
      grading_completion_rate: 75.0,
      ungraded_count: 6,
      avg_graded_score_percent: 84.2,
      passing_rate_percent: 80.0,
      grade_coverage_percent: 80.0,
      period_attendance_rate: 93.4,
      improved_prediction_resolution_rate: 33.3,
    },
    trend_chart: {
      available_filters: [
        { class_id: 301, section_name: "11-Rizal", subject_id: 11, subject_name: "General Mathematics" },
      ],
      selected_class_id: null,
      selected_subject_id: null,
      selected_section_name: "All Classes",
      selected_subject_name: "All Subjects",
      has_sufficient_data: true,
      graded_task_count: 3,
      date_group_count: 2,
      warnings: [],
      points: [
        {
          classwork_id: 501,
          title: "Quiz 1",
          category: "Written Work",
          due_date: "2026-10-05T00:00:00Z",
          label: "Oct 05",
          short_label: "Oct 05",
          avg_score_percent: 84.2,
          completion_rate_percent: 82.5,
          submitted_count: 33,
          total_enrolled: 40,
        },
      ],
    },
    section_matrix: [
      {
        class_id: 301,
        section_name: "11-Rizal",
        grade_level: "Grade 11",
        subject_id: 11,
        subject_name: "General Mathematics",
        student_count: 15,
        published_classworks: 3,
        avg_score_percent: 86.0,
        avg_graded_score_percent: 86.0,
        passing_rate_percent: 80.0,
        grade_coverage_percent: 80.0,
        completion_rate_percent: 85.0,
        submission_rate_percent: 85.0,
        grading_completion_rate_percent: 80.0,
        awaiting_grading_count: 2,
        attendance_rate_percent: 93.4,
        current_grade: 87.2,
        available_grade_count: 12,
        total_grade_count: 15,
        passing_threshold: 80.0,
      },
    ],
    action_queue: { upcoming_deadlines: [] },
    details: {
      grade_distribution: [
        { band: "90-100", count: 6, percent: 30.0 },
        { band: "85-89", count: 6, percent: 30.0 },
        { band: "80-84", count: 4, percent: 20.0 },
        { band: "75-79", count: 3, percent: 15.0 },
        { band: "Below 75", count: 1, percent: 5.0 },
      ],
      lesson_performance: {
        policy: { min_learners: 3, min_questions: 3, limit_per_subject: 5 },
        subjects: [],
      },
    },
    ...overrides,
  };
}

describe("TeacherDashboard (v2 Analytics-First Redesign)", () => {
  afterEach(() => {
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockAcademicContext = {
      selectedYearId: 101,
      selectedPeriodId: 201,
      selectedYear: { academic_year_id: 101, year_label: "2026-2027", is_active: true },
      selectedPeriod: { id: 201, period: "Q1", is_active: true },
      isLoading: false,
    };
  });

  it("renders all six percentage-first KPI cards, clarifications, and zero student rosters or Study Support copy", async () => {
    mockGetTeacherDashboardHealth.mockResolvedValue(buildSampleResponse());

    render(
      <MemoryRouter>
        <TeacherDashboard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Classwork Submission Rate")).toBeTruthy();
    });

    // All 6 KPI titles & real database-backed percentages
    expect(screen.getByText("82.5%")).toBeTruthy();
    expect(screen.getByText("Grading Completion Rate")).toBeTruthy();
    expect(screen.getByText(/12 auto · 6 teacher/)).toBeTruthy();
    expect(screen.getByText("6 awaiting teacher grading")).toBeTruthy();
    expect(screen.getByText("Avg. Graded Assessment Score")).toBeTruthy();
    expect(screen.getByText("84.2%")).toBeTruthy();
    expect(screen.getByText("Term Passing Rate")).toBeTruthy();
    expect(screen.getByText(/Grade coverage 80\.0% \(20\/25\)/)).toBeTruthy();
    expect(screen.getAllByText("Improved-Prediction Resolution Rate").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Period Attendance Rate")).toBeTruthy();

    // Configured passing threshold displayed without hardcoded 75
    expect(screen.getByText("Configured passing threshold: 80.0")).toBeTruthy();

    // Intervention terminology & separated ungraded Practice Assessments with literal denominator
    expect(screen.getByText("Intervention Analytics")).toBeTruthy();
    expect(screen.getByText("Intervention Practice Assessments")).toBeTruthy();
    expect(screen.getByText("Ungraded · Excluded from Official Grades")).toBeTruthy();
    expect(screen.getByText("Attempted Passed")).toBeTruthy();
    expect(screen.getByText("2/3 attempted")).toBeTruthy();
    expect(screen.getByText("Other Resolution Reasons")).toBeTruthy();

    // Strictly absent legacy widgets & forbidden terminology
    expect(screen.queryByText(/Students to Check In With/i)).toBeNull();
    expect(screen.queryByText(/Top Performers/i)).toBeNull();
    expect(screen.queryByText(/Submissions to Review/i)).toBeNull();
    expect(screen.queryByText(/Study Support/i)).toBeNull();
    expect(screen.queryByText(/Not calculated/i)).toBeNull();
  });

  it("drills down to authorized teacher pages when clicking KPI cards", async () => {
    mockGetTeacherDashboardHealth.mockResolvedValue(buildSampleResponse());

    render(
      <MemoryRouter>
        <TeacherDashboard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Grading Completion Rate")).toBeTruthy();
    });

    fireEvent.click(screen.getByText("Grading Completion Rate"));
    expect(mockNavigate).toHaveBeenCalledWith("/teacher/classworks?grading_status=needs_grading");

    fireEvent.click(screen.getByText("Term Passing Rate"));
    expect(mockNavigate).toHaveBeenCalledWith("/teacher/grades");

    fireEvent.click(screen.getByText("Period Attendance Rate"));
    expect(mockNavigate).toHaveBeenCalledWith("/teacher/attendance");
  });

  it("renders TeacherEmptyState when teacher has no assigned classes in the selected period", async () => {
    mockGetTeacherDashboardHealth.mockResolvedValue(
      buildSampleResponse({
        dashboard_filters: [],
        section_matrix: [],
        trend_chart: {
          available_filters: [],
          selected_class_id: null,
          selected_subject_id: null,
          selected_section_name: "",
          selected_subject_name: "",
          has_sufficient_data: false,
          points: [],
        },
        kpis: {
          active_classes: 0,
          enrolled_students: 0,
          overall_completion_rate: null,
          ungraded_count: 0,
        },
      }),
    );

    render(
      <MemoryRouter>
        <TeacherDashboard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("No assigned classes for this academic period")).toBeTruthy();
    });
  });

  it("renders inline error Alert with Retry action on API failure", async () => {
    mockGetTeacherDashboardHealth.mockRejectedValue(new Error("Network error"));

    render(
      <MemoryRouter>
        <TeacherDashboard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Unable to load dashboard analytics")).toBeTruthy();
      expect(screen.getByText("Network error")).toBeTruthy();
    });
    expect(screen.getByText("Retry")).toBeTruthy();
  });
});

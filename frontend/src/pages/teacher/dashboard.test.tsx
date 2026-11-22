// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
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
  periods: [{ id: 201, period: "Q1", is_active: true }],
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

vi.mock("recharts", async () => {
  const actual = await vi.importActual<typeof import("recharts")>("recharts");
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div style={{ width: 640, height: 220 }}>{children}</div>
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
    kpis: {
      active_classes: 2,
      enrolled_students: 25,
      overall_completion_rate: 82.0,
      ungraded_count: 3,
    },
    engagement: {
      expected_count: 40,
      completed_count: 33,
      pending_grading_count: 3,
      resolved_completed_count: 33,
      resolved_pending_grading_count: 3,
      completion_rate_percent: 82.5,
      avg_score_percent: 84.2,
      scored_count: 30,
      graded_task_count: 3,
      warnings: [],
    },
    trend_chart: {
      available_filters: [
        { class_id: 301, section_name: "11-Rizal", subject_id: 11, subject_name: "General Mathematics" },
      ],
      selected_class_id: 301,
      selected_subject_id: 11,
      selected_section_name: "11-Rizal",
      selected_subject_name: "General Mathematics",
      has_sufficient_data: true,
      graded_task_count: 3,
      date_group_count: 2,
      warnings: [],
      points: [
        {
          classwork_id: 501,
          title: "1 task",
          category: "Grouped tasks",
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
        passing_rate_percent: 80.0,
        completion_rate_percent: 85.0,
        attendance_rate_percent: 93.4,
        current_grade: 87.2,
        available_grade_count: 12,
        total_grade_count: 15,
        passing_threshold: 80.0,
        current_grade_meets_threshold: true,
      },
    ],
    phase_two: {
      grades: {
        current_grade: 86.4,
        passing_rate_percent: 80.0,
        available_grade_count: 20,
        total_grade_count: 25,
        passing_count: 16,
        passing_threshold: 80.0,
        current_grade_meets_threshold: true,
        warnings: [],
      },
      attendance_today: {
        rate: 92.0,
        record_count: 25,
        present_count: 21,
        late_count: 2,
        excused_count: 1,
        absent_count: 1,
      },
      month_window: {
        start_date: "2026-10-01",
        end_date: "2026-10-08",
        today: "2026-10-08",
        label: "This month",
      },
      late_submissions: {
        late_rate_percent: 9.1,
        late_count: 3,
        eligible_count: 33,
        excused_excluded_count: 1,
        completed_count: 34,
        warnings: [],
      },
      weekdays: {
        days: [
          { label: "Mon", day_index: 0, count: 6 },
          { label: "Tue", day_index: 1, count: 8 },
          { label: "Wed", day_index: 2, count: 5 },
          { label: "Thu", day_index: 3, count: 7 },
          { label: "Fri", day_index: 4, count: 6 },
          { label: "Sat", day_index: 5, count: 1 },
        ],
        sunday_count: 1,
        total_count: 34,
        warnings: [],
      },
      term_progress: {
        progress_percent: 45.0,
        elapsed_days: 40,
        total_days: 90,
        week_number: 6,
        total_weeks: 13,
        warnings: [],
      },
      intervention_resolution: {
        candidate_count: 2,
        active_count: 2,
        resolved_improved_count: 2,
        resolved_other_count: 1,
        resolved_total_count: 3,
        eligible_count: 5,
        total_count: 7,
        improved_prediction_resolution_rate_percent: 40.0,
      },
      require_subject_match: false,
    },
    action_queue: {
      pending_grading: [
        {
          submission_id: 901,
          student_id: "s-1",
          student_name: "Juan Dela Cruz",
          classwork_id: 501,
          classwork_title: "Linear Equations Quiz",
          section_name: "11-Rizal",
          submitted_at: "2026-10-07T08:00:00Z",
        },
      ],
      upcoming_deadlines: [],
    },
    details: {
      grade_details: {
        total_grade_count: 25,
        available_grade_count: 20,
        unavailable_grade_count: 5,
        warnings: [],
      },
      grade_distribution: [
        { band: "90-100", count: 6 },
        { band: "85-89", count: 6 },
        { band: "80-84", count: 4 },
        { band: "75-79", count: 3 },
        { band: "Below 75", count: 1 },
      ],
      attendance_by_section: [
        {
          class_id: 301,
          section: "11-Rizal",
          rate: 93.4,
          record_count: 152,
          present_count: 135,
          late_count: 7,
          excused_count: 4,
          absent_count: 6,
        },
      ],
      intervention_resolution: {
        candidate_count: 2,
        active_count: 2,
        resolved_improved_count: 2,
        resolved_other_count: 1,
        resolved_total_count: 3,
        eligible_count: 5,
        total_count: 7,
        improved_prediction_resolution_rate_percent: 40.0,
      },
      lesson_performance: {
        policy: { min_learners: 3, min_questions: 3, limit_per_subject: 5 },
        subjects: [
          {
            subject_id: 11,
            subject_name: "General Mathematics",
            class_ids: [301],
            items: [
              {
                lesson_id: 701,
                title: "Rational Functions",
                performance_percent: 58.5,
                awarded_points: 35.1,
                possible_points: 60,
                scored_response_count: 12,
                learner_count: 4,
                question_count: 3,
              },
              {
                lesson_id: 702,
                title: "Inverse Functions",
                performance_percent: 66.7,
                awarded_points: 40.0,
                possible_points: 60,
                scored_response_count: 12,
                learner_count: 4,
                question_count: 3,
              },
            ],
            coverage: {
              scored_mapped_response_count: 24,
              unmapped_response_count: 2,
              ungraded_response_count: 1,
              invalid_response_count: 0,
              insufficient_lesson_count: 0,
              omitted_lesson_count: 0,
              excluded_manual_assignment_count: 1,
            },
            warnings: [],
          },
        ],
      },
    },
    ...overrides,
  };
}

describe("TeacherDashboard (Restored & Refined Original Dashboard)", () => {
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
      periods: [{ id: 201, period: "Q1", is_active: true }],
      isLoading: false,
    };
  });

  it("renders Improved Prediction Resolution Rate directly below Active Classes, Lowest Mastery Lessons Graph, and omits removed student sections", async () => {
    mockGetTeacherDashboardHealth.mockResolvedValue(buildSampleResponse());

    const { container } = render(
      <MemoryRouter>
        <TeacherDashboard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Improved Prediction Resolution Rate")).toBeTruthy();
    });

    // Verify Improved Prediction Resolution Rate is positioned immediately below Active Classes
    const html = container.innerHTML;
    const activeClassesIdx = html.indexOf("Active Classes");
    const improvedRateIdx = html.indexOf("Improved Prediction Resolution Rate");
    const overallCompletionIdx = html.indexOf("Overall Completion");
    expect(activeClassesIdx).toBeGreaterThan(-1);
    expect(improvedRateIdx).toBeGreaterThan(activeClassesIdx);
    expect(overallCompletionIdx).toBeGreaterThan(improvedRateIdx);

    expect(screen.getByText("40%")).toBeTruthy();
    expect(screen.getByText(/2 of 5 active & resolved/)).toBeTruthy();

    // Verify Lowest Mastery Lessons Graph renders with coverage details
    expect(screen.getByText("Lowest Mastery Lessons")).toBeTruthy();
    expect(
      screen.getByRole("region", {
        name: "Lowest mastery lessons graph for General Mathematics",
      }),
    ).toBeTruthy();
    expect(screen.getByText(/24 scored lesson-linked responses/)).toBeTruthy();

    // Verify retained original sections render in their swapped positions:
    // Submissions to Review is alongside Lowest Mastery Lessons (above Section-by-Section Health),
    // and Attendance By Section is below Section-by-Section Health (before Submissions by weekday).
    expect(screen.getByText("Classwork Performance & Completion Trend")).toBeTruthy();
    expect(screen.getByText("Submissions to Review")).toBeTruthy();
    expect(screen.getByText("Section-by-Section Health")).toBeTruthy();
    expect(screen.getByText("Attendance By Section")).toBeTruthy();
    expect(screen.getByText("Submissions by weekday")).toBeTruthy();
    expect(screen.getByText("Grade distribution")).toBeTruthy();

    const lowestMasteryIdx = html.indexOf("Lowest Mastery Lessons");
    const submissionsToReviewIdx = html.indexOf("Submissions to Review");
    const sectionHealthIdx = html.indexOf("Section-by-Section Health");
    const attendanceBySectionIdx = html.indexOf("Attendance By Section");
    const weekdayIdx = html.indexOf("Submissions by weekday");
    expect(lowestMasteryIdx).toBeGreaterThan(-1);
    expect(submissionsToReviewIdx).toBeGreaterThan(lowestMasteryIdx);
    expect(sectionHealthIdx).toBeGreaterThan(submissionsToReviewIdx);
    expect(attendanceBySectionIdx).toBeGreaterThan(sectionHealthIdx);
    expect(weekdayIdx).toBeGreaterThan(attendanceBySectionIdx);

    // Verify removed sections do NOT render anywhere
    expect(screen.queryByText(/Students to Check In With/i)).toBeNull();
    expect(screen.queryByText(/Top Performers?/i)).toBeNull();
  });

  it("displays insufficient lesson mastery data empty state rather than zero mastery when evidence is below threshold", async () => {
    const sample = buildSampleResponse();
    mockGetTeacherDashboardHealth.mockResolvedValue({
      ...sample,
      details: {
        ...sample.details,
        lesson_performance: {
          policy: { min_learners: 3, min_questions: 3, limit_per_subject: 5 },
          subjects: [
            {
              subject_id: 11,
              subject_name: "General Mathematics",
              class_ids: [301],
              items: [],
              coverage: {
                scored_mapped_response_count: 4,
                unmapped_response_count: 0,
                ungraded_response_count: 2,
                invalid_response_count: 0,
                insufficient_lesson_count: 1,
                omitted_lesson_count: 0,
                excluded_manual_assignment_count: 0,
              },
              warnings: [],
            },
          ],
        },
      },
    });

    render(
      <MemoryRouter>
        <TeacherDashboard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Insufficient lesson mastery data")).toBeTruthy();
    });
    expect(
      screen.getByText(/Each lesson needs scores from at least 3 learners across 3 questions/),
    ).toBeTruthy();
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
          overall_completion_rate: 0,
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
      expect(screen.getByText("No classes assigned")).toBeTruthy();
    });
  });

  it("renders inline error Alert on API failure", async () => {
    mockGetTeacherDashboardHealth.mockRejectedValue(new Error("Network error"));

    render(
      <MemoryRouter>
        <TeacherDashboard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeTruthy();
    });
    expect(
      screen.getAllByText("Dashboard data is unavailable.").length,
    ).toBeGreaterThan(0);
  });
});

// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { SubjectSectionCard } from "./subject-section-card";
import { PredictionSubjectSection } from "./prediction-subject-section";
import type { DashboardSubjectGroupSummary } from "./current-term-dashboard-adapter";
import PredictionsDashboard from "@/pages/teacher/predictions";
import SectionPredictions from "@/pages/teacher/section-predictions";
import SubjectPrediction from "@/pages/teacher/subject-prediction";
import * as predictionApi from "@/lib/prediction-api";
import * as api from "@/lib/api";

// ── Context and layout mocks ──
const authState = { role: "teacher" as "teacher" | "admin" };
vi.mock("@/context/AuthContext", () => ({
  useAuth: () => ({ role: authState.role }),
}));

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => ({
    selectedPeriodId: 1,
    periods: [{ period_id: 1, period_name: "Term 1 Demo", is_active: true }],
  }),
}));

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="app-layout">{children}</div>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button type="button">SidebarTrigger</button>,
}));

vi.mock("@/components/retroui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render }: { render: ReactNode }) => <>{render}</>,
  TooltipContent: () => null,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  authState.role = "teacher";
});

describe("SubjectSectionCard", () => {
  it("renders section card with accurate prediction count label and target URL", () => {
    render(
      <MemoryRouter>
        <SubjectSectionCard
          subjectId={1}
          classId={10}
          name="Demo Archimedes"
          gradeLevel={9}
          totalPredictions={9}
          highRisk={0}
          moderateRisk={2}
          needsMonitoring={2}
          lowRisk={5}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Demo Archimedes")).toBeDefined();
    // Labels count as "Predictions", not "Students"
    expect(screen.getByText("9 Predictions")).toBeDefined();

    const link = screen.getByRole("link", { name: /View Demo Archimedes predictions/i });
    expect(link.getAttribute("href")).toBe("/teacher/predictions/subject/1/section/10");

    expect(screen.getByText("On Track")).toBeDefined();
    expect(screen.getByText("Moderate Risk")).toBeDefined();
    expect(screen.getByText("High Risk")).toBeDefined();
    expect(screen.getByText("78%")).toBeDefined();
    expect(screen.getByText("22%")).toBeDefined();
    expect(screen.getByText("0%")).toBeDefined();
  });

  it("combines monitoring predictions into the On Track section category", () => {
    render(
      <MemoryRouter>
        <SubjectSectionCard
          subjectId={1}
          classId={10}
          name="Demo Archimedes"
          gradeLevel={9}
          totalPredictions={4}
          highRisk={0}
          moderateRisk={2}
          needsMonitoring={2}
          lowRisk={0}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Moderate Risk")).toBeDefined();
    expect(screen.getByText("On Track")).toBeDefined();
    expect(screen.getAllByText("50%")).toHaveLength(2);
  });

  it("labels singular prediction accurately", () => {
    render(
      <MemoryRouter>
        <SubjectSectionCard
          subjectId={1}
          classId={10}
          name="Section Alpha"
          totalPredictions={1}
          lowRisk={1}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("1 Prediction")).toBeDefined();
    expect(screen.getByText("On Track")).toBeDefined();
  });

  it("handles zero predictions gracefully with distinct empty banner", () => {
    render(
      <MemoryRouter>
        <SubjectSectionCard
          subjectId={1}
          classId={10}
          name="Empty Section"
          totalPredictions={0}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("0 Predictions")).toBeDefined();
    expect(screen.getByText("No Predictions Yet")).toBeDefined();
  });

  it("shows assessed zero-risk categories when all predictions are On Track", () => {
    render(
      <MemoryRouter>
        <SubjectSectionCard
          subjectId={1}
          classId={10}
          name="Safe Section"
          totalPredictions={5}
          lowRisk={5}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("5 Predictions")).toBeDefined();
    expect(screen.getByText("On Track")).toBeDefined();
    expect(screen.getByText("100%")).toBeDefined();
  });

  it("keeps predictions without an assessed category out of percentages", () => {
    render(
      <MemoryRouter>
        <SubjectSectionCard
          subjectId={1}
          classId={10}
          name="Pending Section"
          totalPredictions={3}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("3 Predictions")).toBeDefined();
    expect(screen.getByText("No Assessed Predictions")).toBeDefined();
    expect(screen.queryByText(/%$/)).toBeNull();
  });
});

describe("PredictionSubjectSection", () => {
  const mockGroup: DashboardSubjectGroupSummary = {
    subject_id: 1,
    subject_name: "Mathematics",
    subject_codename: "MATH",
    grade_level: 9,
    display_name: "Mathematics 9",
    total_students: 9,
    total_predictions: 9,
    at_risk_count: 4,
    high_risk_count: 1,
    moderate_risk_count: 2,
    needs_monitoring_count: 1,
    low_risk_count: 5,
    sections: [
      {
        class_id: 1,
        section_name: "Demo Archimedes",
        grade_level: 9,
        subject_id: 1,
        total_students: 9,
        total_predictions: 9,
        at_risk_count: 4,
        high_risk_count: 1,
        moderate_risk_count: 2,
        needs_monitoring_count: 1,
        low_risk_count: 5,
      },
      {
        class_id: 2,
        section_name: "Demo Aristotle",
        grade_level: 9,
        subject_id: 1,
        total_students: 0,
        total_predictions: 0,
        at_risk_count: 0,
        high_risk_count: 0,
        moderate_risk_count: 0,
        needs_monitoring_count: 0,
        low_risk_count: 0,
      },
    ],
  };

  it("renders subject title, grade context, distinct risk badges, and assigned section cards", () => {
    render(
      <MemoryRouter>
        <PredictionSubjectSection group={mockGroup} />
      </MemoryRouter>
    );

    expect(screen.getByRole("heading", { level: 2, name: /Mathematics 9/i })).toBeDefined();

    // Badges in header
    expect(screen.getByText("2 Moderate Risk (22%)")).toBeDefined();
    expect(screen.getByText("1 High Risk (11%)")).toBeDefined();
    expect(screen.getByText("6 On Track (67%)")).toBeDefined();

    // Sections
    expect(screen.getByText("Demo Archimedes")).toBeDefined();
    expect(screen.getByText("Demo Aristotle")).toBeDefined();
  });

  it("displays helpful empty text if a subject has no sections", () => {
    const emptyGroup: DashboardSubjectGroupSummary = {
      ...mockGroup,
      sections: [],
    };

    render(
      <MemoryRouter>
        <PredictionSubjectSection group={emptyGroup} />
      </MemoryRouter>
    );

    expect(screen.getByText(/No sections assigned in this subject/i)).toBeDefined();
  });
});

describe("TeacherCurrentTermDashboard (Subject-First Main Page)", () => {
  beforeEach(() => {
    authState.role = "teacher";

    const mockFilters: predictionApi.DashboardFilters = {
      grades: [{ grade_level: 9, level_name: "Grade 9" }],
      classes: [{ class_id: 1, section_name: "Demo Archimedes", grade_level: 9 }],
      subjects: [{ subject_id: 1, subject_name: "Mathematics", subject_codename: "MATH" }],
      terms: [{ term_number: 1, term_label: "Term 1 Demo", academic_period_id: 1 }],
    };

    // Mock fetchDashboardFilters / fetchTeacherAcademicScope
    vi.spyOn(predictionApi, "fetchTeacherAcademicScope").mockResolvedValue(mockFilters);
    vi.spyOn(predictionApi, "fetchDashboardFilters").mockResolvedValue(mockFilters);

    // Mock the environment-aware Current-Term read contract.
    vi.spyOn(predictionApi, "fetchCurrentTermPredictions").mockResolvedValue({
      items: [
        {
          prediction_id: 1,
          revision: 1,
          student_id: "s1",
          student_name: "Blake Student",
          class_id: 1,
          class_name: "Demo Archimedes",
          subject_id: 1,
          subject_name: "Mathematics",
          subject_codename: "MATH",
          academic_period_id: 1,
          period_name: "Term 1 Demo",
          projected_final_term_grade: 92.5,
          intervention_level: "LOW_RISK",
          intervention_basis: "RULE_BASED",
          readiness_status: "READY",
          readiness_level: "HIGH",
          readiness_label: "Ready",
          academic_evidence: {
            written_works: { graded_count: 4, performance_percent: 85 },
            performance_tasks: { graded_count: 3, performance_percent: 85 },
            examination: { graded_count: 2, performance_percent: 85, presentation: { status: "COMPLETE", completed_count: 2, components: {} } },
            overall: { graded_activity_count: 9, performance_percent: 85, observed_component_weight_percent: 100 },
          },
          participation_context: {
            attendance: { recorded_days: 15, attendance_rate: 95, present: 14, absent: 0, late: 1, excused: 0 },
            submissions: { assigned_count: 9, submitted_count: 9, missing_count: 0, late_count: 0, upcoming_count: 0, completion_rate: 100 },
          },
          term_context: {
            start_date: "2026-09-01",
            end_date: "2026-11-30",
            evidence_cutoff_date: "2026-09-25",
            progress_percent: 33,
            days_remaining: 66,
            is_active: true,
            scheduled_end_passed_while_active: false,
          },
          official_final_grade_available: false,
          official_final_grade: null,
          model_version_id: 2,
          model_name: "rf_model",
          lifecycle_status: "DEVELOPMENT",
          generated_at: "2026-09-25T10:00:00Z",
        },
      ],
      total: 1,
    });
  });

  it("renders 'Subject Summaries' heading instead of 'Grade Cohort Summaries'", async () => {
    render(
      <MemoryRouter>
        <PredictionsDashboard />
      </MemoryRouter>
    );

    // Initial loading
    expect(screen.getByText(/Loading current-term projections/i)).toBeDefined();

    // After loading
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: /Mathematics 9/i })).toBeDefined();
    });

    // Heading "Grade Cohort Summaries" must NOT exist
    expect(screen.queryByText("Grade Cohort Summaries")).toBeNull();

    // Subject section is rendered with "Mathematics 9"
    expect(screen.getByRole("heading", { level: 2, name: /Mathematics 9/i })).toBeDefined();
    expect(screen.getByText("Demo Archimedes")).toBeDefined();
  });

  it("does not substitute another subject's health data on an assigned subject page", async () => {
    vi.spyOn(api, "getTeacherDashboardHealth").mockResolvedValue({
      term_info: {
        period_id: 1,
        period_name: "Term 1 Demo",
        academic_year: "2026-2027",
        is_active: true,
      },
      kpis: {
        active_classes: 1,
        enrolled_students: 1,
        overall_completion_rate: null,
        ungraded_count: null,
      },
      trend_chart: {
        available_filters: [],
        selected_class_id: null,
        selected_subject_id: 1,
        selected_section_name: "",
        selected_subject_name: "Mathematics",
        has_sufficient_data: false,
        points: [],
      },
      section_matrix: [{
        class_id: 99,
        section_name: "Wrong Subject Section",
        grade_level: "9",
        subject_id: 999,
        subject_name: "Other Subject",
        student_count: 3,
        published_classworks: 1,
        avg_score_percent: 80,
        passing_rate_percent: 80,
        completion_rate_percent: 80,
        attendance_rate_percent: 80,
      }],
      action_queue: { pending_grading: [], upcoming_deadlines: [] },
      details: {
        lesson_performance: {
          policy: { min_learners: 3, min_questions: 3, limit_per_subject: 5 },
          subjects: [],
        },
      },
    });

    render(
      <MemoryRouter initialEntries={["/teacher/predictions/subject/1"]}>
        <Routes>
          <Route path="/teacher/predictions/subject/:subjectId" element={<SubjectPrediction />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("No section health data available for this subject.")).toBeDefined();
      expect(screen.getByText("No lesson performance data is available for this assigned subject yet.")).toBeDefined();
    });
    expect(screen.queryByText("Wrong Subject Section")).toBeNull();
  });
});

describe("TeacherCurrentTermSectionPredictions (Section Detail & Navigation)", () => {
  beforeEach(() => {
    authState.role = "teacher";

    const sectionMockFilters: predictionApi.DashboardFilters = {
      grades: [{ grade_level: 9, level_name: "Grade 9" }],
      classes: [{ class_id: 1, section_name: "Demo Archimedes", grade_level: 9 }],
      subjects: [{ subject_id: 1, subject_name: "Mathematics", subject_codename: "MATH" }],
      terms: [{ term_number: 1, term_label: "Term 1 Demo", academic_period_id: 1 }],
    };

    vi.spyOn(predictionApi, "fetchTeacherAcademicScope").mockResolvedValue(sectionMockFilters);
    vi.spyOn(predictionApi, "fetchDashboardFilters").mockResolvedValue(sectionMockFilters);
    vi.spyOn(api, "getTeacherDashboardHealth").mockResolvedValue({
      term_info: {
        period_id: 1,
        period_name: "Term 1 Demo",
        academic_year: "2026-2027",
        is_active: true,
      },
      kpis: {
        active_classes: 1,
        enrolled_students: 1,
        overall_completion_rate: null,
        ungraded_count: null,
      },
      trend_chart: {
        available_filters: [],
        selected_class_id: 1,
        selected_subject_id: 1,
        selected_section_name: "Demo Archimedes",
        selected_subject_name: "Mathematics",
        has_sufficient_data: false,
        points: [],
      },
      section_matrix: [],
      action_queue: { pending_grading: [], upcoming_deadlines: [] },
      details: {
        lesson_performance: {
          policy: { min_learners: 3, min_questions: 3, limit_per_subject: 5 },
          subjects: [],
        },
      },
    });

    vi.spyOn(predictionApi, "fetchCurrentTermPredictions").mockResolvedValue({
      items: [
        {
          prediction_id: 33,
          revision: 1,
          student_id: "s-blake",
          student_name: "Blake Student",
          class_id: 1,
          class_name: "Demo Archimedes",
          subject_id: 1,
          subject_name: "Mathematics",
          subject_codename: "MATH",
          academic_period_id: 1,
          period_name: "Term 1 Demo",
          projected_final_term_grade: 92.51,
          intervention_level: "LOW_RISK",
          intervention_basis: "RULE_BASED",
          readiness_status: "READY",
          readiness_level: "HIGH",
          readiness_label: "Ready",
          academic_evidence: {
            written_works: { graded_count: 4, performance_percent: 85 },
            performance_tasks: { graded_count: 3, performance_percent: 85 },
            examination: { graded_count: 2, performance_percent: 85, presentation: { status: "COMPLETE", completed_count: 2, components: {} } },
            overall: { graded_activity_count: 9, performance_percent: 85, observed_component_weight_percent: 100 },
          },
          participation_context: {
            attendance: { recorded_days: 15, attendance_rate: 95, present: 14, absent: 0, late: 1, excused: 0 },
            submissions: { assigned_count: 9, submitted_count: 9, missing_count: 0, late_count: 0, upcoming_count: 0, completion_rate: 100 },
          },
          term_context: {
            start_date: "2026-09-01",
            end_date: "2026-11-30",
            evidence_cutoff_date: "2026-09-25",
            progress_percent: 33,
            days_remaining: 66,
            is_active: true,
            scheduled_end_passed_while_active: false,
          },
          official_final_grade_available: false,
          official_final_grade: null,
          model_version_id: 2,
          model_name: "rf_model",
          lifecycle_status: "DEVELOPMENT",
          generated_at: "2026-09-25T10:00:00Z",
        },
      ],
      total: 1,
    });
  });

  it("renders breadcrumb AI Predictions > Mathematics 9 > Demo Archimedes on subject route", async () => {
    render(
      <MemoryRouter initialEntries={["/teacher/predictions/subject/1/section/1"]}>
        <Routes>
          <Route
            path="/teacher/predictions/subject/:subjectId/section/:classId"
            element={<SectionPredictions />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Mathematics 9")).toBeDefined();
      expect(screen.getByText("Demo Archimedes")).toBeDefined();
    });

    // The redundant "Subject:" row is NOT rendered
    expect(screen.queryByText("Subject:")).toBeNull();

    // Student prediction row is visible
    expect(screen.getByText("Blake Student")).toBeDefined();
  });

  it("reports missing lesson evidence for an assigned subject without showing another subject", async () => {
    vi.mocked(api.getTeacherDashboardHealth).mockResolvedValueOnce({
      term_info: {
        period_id: 1,
        period_name: "Term 1 Demo",
        academic_year: "2026-2027",
        is_active: true,
      },
      kpis: {
        active_classes: 1,
        enrolled_students: 1,
        overall_completion_rate: null,
        ungraded_count: null,
      },
      trend_chart: {
        available_filters: [],
        selected_class_id: 1,
        selected_subject_id: 1,
        selected_section_name: "Demo Archimedes",
        selected_subject_name: "Mathematics",
        has_sufficient_data: false,
        points: [],
      },
      section_matrix: [],
      action_queue: { pending_grading: [], upcoming_deadlines: [] },
      details: {
        lesson_performance: {
          policy: { min_learners: 3, min_questions: 3, limit_per_subject: 5 },
          subjects: [{
            subject_id: 999,
            subject_name: "Other Subject",
            class_ids: [1],
            items: [{
              lesson_id: 91,
              title: "Wrong Subject Lesson",
              performance_percent: 80,
              awarded_points: 8,
              possible_points: 10,
              scored_response_count: 3,
              learner_count: 3,
              question_count: 3,
            }],
            coverage: {
              scored_mapped_response_count: 3,
              unmapped_response_count: 0,
              ungraded_response_count: 0,
              invalid_response_count: 0,
              insufficient_lesson_count: 0,
              omitted_lesson_count: 0,
              excluded_manual_assignment_count: 0,
            },
            warnings: [],
          }],
        },
      },
    });

    render(
      <MemoryRouter initialEntries={["/teacher/predictions/subject/1/section/1"]}>
        <Routes>
          <Route
            path="/teacher/predictions/subject/:subjectId/section/:classId"
            element={<SectionPredictions />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("No lesson performance data is available for this assigned subject yet.")).toBeDefined();
    });
    expect(screen.queryByText("Wrong Subject Lesson")).toBeNull();
    expect(screen.queryByText("No subjects assigned for this academic period.")).toBeNull();
  });

  it("handles unauthorized subject ID without silent fallback", async () => {
    render(
      <MemoryRouter initialEntries={["/teacher/predictions/subject/999/section/1"]}>
        <Routes>
          <Route
            path="/teacher/predictions/subject/:subjectId/section/:classId"
            element={<SectionPredictions />}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(
        screen.getByText(/This subject is not assigned to this section or you do not have permission/i)
      ).toBeDefined();
    });

    // Does NOT render student predictions for other subjects
    expect(screen.queryByText("Blake Student")).toBeNull();
  });

  it("redirects legacy grade-first route to subject-first route when single subject exists", async () => {
    render(
      <MemoryRouter initialEntries={["/teacher/predictions/9/1"]}>
        <Routes>
          <Route
            path="/teacher/predictions/:grade/:classId"
            element={<SectionPredictions />}
          />
          <Route
            path="/teacher/predictions/subject/:subjectId/section/:classId"
            element={<div data-testid="subject-first-destination">Redirected Successfully</div>}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId("subject-first-destination")).toBeDefined();
      expect(screen.getByText("Redirected Successfully")).toBeDefined();
    });
  });
});

describe("Admin AI Predictions View Regression", () => {
  beforeEach(() => {
    authState.role = "admin";

    const adminMockFilters: predictionApi.DashboardFilters = {
      grades: [{ grade_level: 9, level_name: "Grade 9" }],
      classes: [{ class_id: 1, section_name: "Demo Archimedes", grade_level: 9 }],
      subjects: [{ subject_id: 1, subject_name: "Mathematics", subject_codename: "MATH" }],
      terms: [{ term_number: 1, term_label: "Term 1 Demo", academic_period_id: 1 }],
    };

    vi.spyOn(predictionApi, "fetchDashboardFilters").mockResolvedValue(adminMockFilters);

    vi.spyOn(predictionApi, "fetchDashboardGradeSummaries").mockResolvedValue([
      {
        grade_level: 9,
        level_name: "Grade 9",
        total_students: 10,
        at_risk_count: 4,
        sections: [
          {
            class_id: 1,
            section_name: "Demo Archimedes",
            grade_level: 9,
            total_students: 10,
            at_risk_count: 4,
            high_risk_count: 0,
            moderate_risk_count: 4,
          },
        ],
      },
    ]);

    vi.spyOn(predictionApi, "fetchDashboardAtRisk").mockResolvedValue({
      items: [],
      risk_summary: { HIGH_RISK: 0, MODERATE_RISK: 0, NEEDS_MONITORING: 0, LOW_RISK: 0, INSUFFICIENT_DATA: 0, total: 0 },
      total: 0,
      limit: 10,
      offset: 0,
    });
  });

  it("preserves Admin Grade Cohort Summaries unchanged", async () => {
    render(
      <MemoryRouter>
        <PredictionsDashboard />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 2, name: /Grade Cohort Summaries/i })).toBeDefined();
    });

    // Admin still sees Grade 9 cohort
    expect(screen.getByText("Grade 9")).toBeDefined();
  });
});

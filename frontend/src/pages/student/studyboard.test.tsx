// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import StoryBoard from "./studyboard";
import type { StudentStudyboardMetrics, StudentSubjectItem, TodoItem } from "@/lib/api";
import type { StudentPersistentIntervention } from "@/lib/student-persistent-interventions-api";

const mockNavigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="app-layout">{children}</div>
  ),
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button type="button" aria-label="Toggle sidebar" />,
}));

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => ({
    selectedPeriodId: 101,
    selectedPeriod: { id: 101, period: "First Quarter", is_active: true },
    selectedYear: { academic_year_id: 1, year_label: "2026-2027", is_active: true },
  }),
}));

const mockUseStudentOverviewData = vi.fn();
vi.mock("@/hooks/use-student-overview-data", () => ({
  useStudentOverviewData: () => mockUseStudentOverviewData(),
}));

const mockGetMyStudyboardMetrics = vi.fn();
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    getMyStudyboardMetrics: (...args: unknown[]) => mockGetMyStudyboardMetrics(...args),
  };
});

const mockListMyActiveInterventions = vi.fn();
vi.mock("@/lib/student-persistent-interventions-api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/student-persistent-interventions-api")>(
    "@/lib/student-persistent-interventions-api",
  );
  return {
    ...actual,
    listMyActiveInterventions: (...args: unknown[]) => mockListMyActiveInterventions(...args),
  };
});

function buildSubjects(): StudentSubjectItem[] {
  return [
    {
      subject_load_id: 1,
      class_id: 10,
      subject_id: 1,
      subject_name: "Enhanced Mathematics 9",
      subject_codename: "MATH9",
      section_name: "Section Newton",
      teacher_name: "Ms. Cruz",
      teacher_avatar: null,
      period_id: 101,
      period_name: "First Quarter",
      is_current_period: true,
      is_current_quarter: true,
      year_label: "2026-2027",
    },
    {
      subject_load_id: 2,
      class_id: 10,
      subject_id: 2,
      subject_name: "Science 9",
      subject_codename: "SCI9",
      section_name: "Section Newton",
      teacher_name: "Mr. Reyes",
      teacher_avatar: null,
      period_id: 101,
      period_name: "First Quarter",
      is_current_period: true,
      is_current_quarter: true,
      year_label: "2026-2027",
    },
  ];
}

function buildMetrics(): StudentStudyboardMetrics {
  return {
    week_start: "2026-11-23",
    attendance: [
      { date: "2026-11-23", status: "present" },
      { date: "2026-11-24", status: "late" },
      { date: "2026-11-25", status: "no_record" },
      { date: "2026-11-26", status: "no_record" },
      { date: "2026-11-27", status: "no_record" },
    ],
    attendance_rate: 100,
    daily_reading_seconds: [600, 0, 0, 0, 0, 0, 0],
    subject_reading_seconds: [{ subject: "Science 9", seconds: 600 }],
    grade_trend: [{ week_start: "2026-11-23", average: 73 }],
    on_time_count: 0,
    late_submission_count: 0,
    on_time_rate: null,
    submitted_without_deadline_count: 0,
    quiz_correct: 0,
    quiz_wrong: 0,
  };
}

describe("Student StoryBoard Subject Performance and Layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("defaults Subject Performance to With Scores, filters dynamically with counts, navigates on click/Enter, and preserves Weekly Attendance and Study Support", async () => {
    const subjects = buildSubjects();
    const futureIso = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();
    const pastIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const todos: TodoItem[] = [
      // 3 released graded scores in Math: 14/20 + 15/20 + 15/20 = 44/60 = 73%
      {
        assignment_id: 11,
        class_id: 10,
        classwork_id: 11,
        title: "Quiz 1",
        subject: "Enhanced Mathematics 9",
        subject_id: 1,
        due_date: pastIso,
        deadline: "Last week",
        type: "QUIZ",
        category: "WRITTEN_WORK",
        is_graded: true,
        total_points: 20,
        status: "completed",
        is_submitted: true,
        submission_status: "graded",
        grade: 14,
        show_scores: true,
      },
      {
        assignment_id: 12,
        class_id: 10,
        classwork_id: 12,
        title: "Quiz 2",
        subject: "Enhanced Mathematics 9",
        subject_id: 1,
        due_date: pastIso,
        deadline: "Last week",
        type: "QUIZ",
        category: "WRITTEN_WORK",
        is_graded: true,
        total_points: 20,
        status: "completed",
        is_submitted: true,
        submission_status: "graded",
        grade: 15,
        show_scores: true,
      },
      {
        assignment_id: 13,
        class_id: 10,
        classwork_id: 13,
        title: "Worksheet 1",
        subject: "Enhanced Mathematics 9",
        subject_id: 1,
        due_date: pastIso,
        deadline: "Last week",
        type: "ASSIGNMENT",
        category: "WRITTEN_WORK",
        is_graded: true,
        total_points: 20,
        status: "completed",
        is_submitted: true,
        submission_status: "graded",
        grade: 15,
        show_scores: true,
      },
      // Hidden score in Science -> must remain hidden so Science belongs in No Scores
      {
        assignment_id: 14,
        class_id: 10,
        classwork_id: 14,
        title: "Lab Quiz",
        subject: "Science 9",
        subject_id: 2,
        due_date: futureIso,
        deadline: "In 2 days",
        type: "QUIZ",
        category: "WRITTEN_WORK",
        is_graded: true,
        total_points: 20,
        status: "completed",
        is_submitted: true,
        submission_status: "graded",
        grade: 19,
        show_scores: false,
      },
    ];

    mockUseStudentOverviewData.mockReturnValue({
      subjects,
      todos,
      urgentTodos: [],
      isLoading: false,
      error: null,
    });
    mockGetMyStudyboardMetrics.mockResolvedValue(buildMetrics());

    const activeSupport: StudentPersistentIntervention[] = [
      {
        intervention_id: 99,
        status: "ACTIVE",
        subject_id: 2,
        subject_name: "Science 9",
        class_id: 10,
        class_name: "Section Newton",
        academic_period_id: 101,
        teacher_name: "Mr. Reyes",
        required_readings: [],
        resource_issues: [],
        preparation: {
          state: "IN_PROGRESS",
          is_satisfied: false,
          completed_count: 1,
          required_count: 2,
          accessible_count: 2,
          unavailable_count: 0,
          summary: "1 of 2 completed",
        },
        activities: [],
        reviewer_id: null,
        resolved_at: null,
        resolution_message: null,
      },
    ];
    mockListMyActiveInterventions.mockResolvedValue({ items: activeSupport });

    const { container } = render(
      <MemoryRouter>
        <StoryBoard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("No timed submissions yet")).toBeTruthy();
    });

    // Removed sections do NOT render
    expect(screen.queryByText("Academic Progress")).toBeNull();
    expect(screen.queryByText("Reading Time (This Week)")).toBeNull();
    expect(screen.queryByText("Subject Mastery")).toBeNull();
    expect(screen.queryByText("Strengths & Focus Areas")).toBeNull();

    // Renamed heading + dynamic segmented filter counts
    const perfHeading = screen.getByText("Subject Performance");
    expect(perfHeading).toBeTruthy();
    const perfCard = perfHeading.closest("[data-slot='card']") as HTMLElement;
    expect(perfCard).toBeTruthy();
    const perfScope = within(perfCard);

    const withScoresBtn = perfScope.getByRole("button", { name: "With Scores (1)" });
    const noScoresBtn = perfScope.getByRole("button", { name: "No Scores (1)" });
    const allSubjectsBtn = perfScope.getByRole("button", { name: "All Subjects (2)" });
    expect(withScoresBtn.getAttribute("aria-pressed")).toBe("true");
    expect(noScoresBtn.getAttribute("aria-pressed")).toBe("false");
    expect(allSubjectsBtn.getAttribute("aria-pressed")).toBe("false");

    // Default "With Scores" shows Math (73%) and hides Science (no released scores)
    const mathCard = perfScope.getByRole("button", {
      name: /View Enhanced Mathematics 9, 73% released score average/i,
    });
    expect(perfScope.getByTestId("subject-mastery-badge").textContent).toBe("Low");
    expect(perfScope.getByText("Based on 3 released graded scores")).toBeTruthy();
    expect(
      perfScope.queryByRole("button", { name: /View Science 9, no released graded scores yet/i }),
    ).toBeNull();

    // Clicking Math navigates to subject detail
    fireEvent.click(mathCard);
    expect(mockNavigate).toHaveBeenCalledWith("/student/subjects/10/1");

    // Switching to "No Scores" shows Science only
    fireEvent.click(noScoresBtn);
    expect(noScoresBtn.getAttribute("aria-pressed")).toBe("true");
    expect(
      perfScope.queryByRole("button", { name: /View Enhanced Mathematics 9, 73% released score average/i }),
    ).toBeNull();
    const scienceCard = perfScope.getByRole("button", {
      name: /View Science 9, no released graded scores yet/i,
    });
    fireEvent.keyDown(scienceCard, { key: "Enter" });
    expect(mockNavigate).toHaveBeenCalledWith("/student/subjects/10/2");

    // Switching to "All Subjects" shows both
    fireEvent.click(allSubjectsBtn);
    expect(
      perfScope.getByRole("button", { name: /View Enhanced Mathematics 9, 73% released score average/i }),
    ).toBeTruthy();
    expect(
      perfScope.getByRole("button", { name: /View Science 9, no released graded scores yet/i }),
    ).toBeTruthy();

    // Weekly Attendance & Study Support intact
    expect(screen.getByText("Weekly Attendance")).toBeTruthy();
    expect(screen.getByText("Present")).toBeTruthy();
    expect(screen.getByText("Study Support")).toBeTruthy();
    expect(container.textContent).not.toMatch(/\bintervention\b/i);
  }, 15000);

  it("shows a helpful empty state when no subjects have released scores and allows switching to All Subjects", async () => {
    const subjects = buildSubjects();
    mockUseStudentOverviewData.mockReturnValue({
      subjects,
      todos: [],
      urgentTodos: [],
      isLoading: false,
      error: null,
    });
    mockGetMyStudyboardMetrics.mockResolvedValue(buildMetrics());
    mockListMyActiveInterventions.mockResolvedValue({ items: [] });

    render(
      <MemoryRouter>
        <StoryBoard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("No released graded scores yet")).toBeTruthy();
    });

    const perfCard = screen.getByText("Subject Performance").closest("[data-slot='card']") as HTMLElement;
    const perfScope = within(perfCard);

    expect(perfScope.getByRole("button", { name: "With Scores (0)" }).getAttribute("aria-pressed")).toBe("true");
    const viewAllBtn = perfScope.getByRole("button", { name: "View all enrolled subjects (2)" });
    fireEvent.click(viewAllBtn);

    expect(perfScope.getByRole("button", { name: "All Subjects (2)" }).getAttribute("aria-pressed")).toBe("true");
    expect(
      perfScope.getByRole("button", { name: /View Enhanced Mathematics 9, no released graded scores yet/i }),
    ).toBeTruthy();
    expect(
      perfScope.getByRole("button", { name: /View Science 9, no released graded scores yet/i }),
    ).toBeTruthy();
  }, 15000);

  it("limits My Priorities to at most 5 items in priority order while keeping full counts and View all navigation", async () => {
    const subjects = buildSubjects();
    const dayMs = 24 * 60 * 60 * 1000;
    const nowMs = Date.now();
    const makeIso = (offsetDays: number) => new Date(nowMs + offsetDays * dayMs).toISOString();

    const todos: TodoItem[] = [
      {
        assignment_id: 201,
        class_id: 10,
        classwork_id: 201,
        title: "Far Pending B",
        subject: "Science 9",
        subject_id: 2,
        due_date: makeIso(20),
        deadline: "In 20 days",
        type: "ASSIGNMENT",
        category: "WRITTEN_WORK",
        is_graded: true,
        total_points: 20,
        status: "pending",
        is_submitted: false,
        submission_status: null,
        grade: null,
        allow_late_submissions: true,
        is_locked: false,
        is_actionable: true,
      },
      {
        assignment_id: 202,
        class_id: 10,
        classwork_id: 202,
        title: "Far Pending A",
        subject: "Science 9",
        subject_id: 2,
        due_date: makeIso(15),
        deadline: "In 15 days",
        type: "ASSIGNMENT",
        category: "WRITTEN_WORK",
        is_graded: true,
        total_points: 20,
        status: "pending",
        is_submitted: false,
        submission_status: null,
        grade: null,
        allow_late_submissions: true,
        is_locked: false,
        is_actionable: true,
      },
      {
        assignment_id: 203,
        class_id: 10,
        classwork_id: 203,
        title: "Due Soon 2",
        subject: "Enhanced Mathematics 9",
        subject_id: 1,
        due_date: makeIso(3),
        deadline: "In 3 days",
        type: "QUIZ",
        category: "WRITTEN_WORK",
        is_graded: true,
        total_points: 20,
        status: "pending",
        is_submitted: false,
        submission_status: null,
        grade: null,
        allow_late_submissions: true,
        is_locked: false,
        is_actionable: true,
      },
      {
        assignment_id: 204,
        class_id: 10,
        classwork_id: 204,
        title: "Due Soon 1",
        subject: "Enhanced Mathematics 9",
        subject_id: 1,
        due_date: makeIso(1),
        deadline: "Tomorrow",
        type: "QUIZ",
        category: "WRITTEN_WORK",
        is_graded: true,
        total_points: 20,
        status: "pending",
        is_submitted: false,
        submission_status: null,
        grade: null,
        allow_late_submissions: true,
        is_locked: false,
        is_actionable: true,
      },
      {
        assignment_id: 205,
        class_id: 10,
        classwork_id: 205,
        title: "Overdue Task 2",
        subject: "Enhanced Mathematics 9",
        subject_id: 1,
        due_date: makeIso(-1),
        deadline: "Yesterday",
        type: "ASSIGNMENT",
        category: "WRITTEN_WORK",
        is_graded: true,
        total_points: 20,
        status: "pastdue",
        is_submitted: false,
        submission_status: null,
        grade: null,
        allow_late_submissions: true,
        is_locked: false,
        is_actionable: true,
      },
      {
        assignment_id: 206,
        class_id: 10,
        classwork_id: 206,
        title: "Overdue Task 1",
        subject: "Science 9",
        subject_id: 2,
        due_date: makeIso(-2),
        deadline: "2 days ago",
        type: "ASSIGNMENT",
        category: "WRITTEN_WORK",
        is_graded: true,
        total_points: 20,
        status: "pastdue",
        is_submitted: false,
        submission_status: null,
        grade: null,
        allow_late_submissions: true,
        is_locked: false,
        is_actionable: true,
      },
      {
        assignment_id: 207,
        class_id: 10,
        classwork_id: 207,
        title: "Far Pending C",
        subject: "Science 9",
        subject_id: 2,
        due_date: makeIso(25),
        deadline: "In 25 days",
        type: "ASSIGNMENT",
        category: "WRITTEN_WORK",
        is_graded: true,
        total_points: 20,
        status: "pending",
        is_submitted: false,
        submission_status: null,
        grade: null,
        allow_late_submissions: true,
        is_locked: false,
        is_actionable: true,
      },
    ];

    mockUseStudentOverviewData.mockReturnValue({
      subjects,
      todos,
      urgentTodos: [],
      isLoading: false,
      error: null,
    });
    mockGetMyStudyboardMetrics.mockResolvedValue(buildMetrics());
    mockListMyActiveInterventions.mockResolvedValue({ items: [] });

    render(
      <MemoryRouter>
        <StoryBoard />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("My Priorities")).toBeTruthy();
    });

    const prioritiesCard = screen
      .getByText("My Priorities")
      .closest("[data-slot='card']") as HTMLElement;
    const scope = within(prioritiesCard);

    // Exactly 5 task rows rendered (excluding the header "View all" button)
    const renderedTitles = [
      "Overdue Task 1",
      "Overdue Task 2",
      "Due Soon 1",
      "Due Soon 2",
      "Far Pending A",
    ];
    for (const title of renderedTitles) {
      expect(scope.getByText(title)).toBeTruthy();
    }
    expect(scope.queryByText("Far Pending B")).toBeNull();
    expect(scope.queryByText("Far Pending C")).toBeNull();

    // Verify exact DOM ordering matches priority sorting
    const taskButtons = scope
      .getAllByRole("button")
      .filter((btn) => btn.getAttribute("aria-label") !== "View all to-do items");
    expect(taskButtons).toHaveLength(5);
    expect(taskButtons.map((btn) => btn.querySelector("p")?.textContent)).toEqual(
      renderedTitles,
    );

    // Status badges & deadline labels preserved
    expect(scope.getAllByText("Overdue")).toHaveLength(2);
    expect(scope.getAllByText("Due Soon")).toHaveLength(2);
    expect(scope.getAllByText("Pending")).toHaveLength(1);
    expect(scope.getByText(/2 days ago/)).toBeTruthy();

    // Clicking View all navigates to the full To-Do page
    fireEvent.click(scope.getByRole("button", { name: "View all to-do items" }));
    expect(mockNavigate).toHaveBeenCalledWith("/student/todo");
  }, 15000);
});

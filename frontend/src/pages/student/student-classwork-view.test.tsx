// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudentClassworkView from "./classwork-view";
import * as apiModule from "@/lib/api";
import * as persistentApi from "@/lib/student-persistent-interventions-api";

const mockToast = {
  success: vi.fn(),
  error: vi.fn(),
};

const mockAcademicContext = vi.hoisted(() => ({
  selectedPeriodId: 1 as number | null,
  selectedPeriod: {
    id: 1,
    period: "Quarter 1",
    period_sequence: 1,
    total_periods: 4,
    academicyear: "2025-2026",
    academic_year_id: 1,
    startDate: null,
    endDate: null,
    is_active: true,
    status: "active",
  },
  selectedYear: {
    academic_year_id: 1,
    year_label: "2025-2026",
    start_date: null,
    end_date: null,
    is_active: true,
  },
  periods: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => mockAcademicContext,
}));

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => mockToast,
}));

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button data-testid="sidebar-trigger">Menu</button>,
}));

vi.mock("@/hooks/use-reading-focus-tracker", () => ({
  useReadingFocusTracker: vi.fn(),
}));

const mockReadingDetail = {
  assignment_id: 16,
  classwork_id: 116,
  class_id: 1,
  subject_id: 2,
  subject_name: "Physics",
  title: "Kinematics Reference Guide",
  description: "Read the kinematic equations guide.",
  classwork_type: "READING",
  classwork_category: "LESSON_MATERIAL",
  total_points: 0,
  show_scores: false,
  submission_status: "not_submitted_yet",
  due_date: null,
  lock_date: null,
  allow_late_submissions: true,
  attachments: [],
  reference_links: [{ classwork_reference_link_id: 21, url: "https://docs.example.test/kinematics", title: "Kinematics Guide", position: 0 }],
  linked_lessons: [
    {
      lesson_id: 101,
      title: "Introduction to Kinematics",
    },
  ],
};

const mount = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/student/classworks/:assignmentId" element={<StudentClassworkView />} />
        <Route path="/student/interventions" element={<div>Study Support Page</div>} />
        <Route path="/student/subjects/:classId/:subjectId" element={<div data-testid="subject-detail-page">Subject Detail Page</div>} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.restoreAllMocks();
  mockToast.success.mockClear();
  mockToast.error.mockClear();
  mockAcademicContext.selectedPeriodId = 1;
  mockAcademicContext.selectedPeriod.is_active = true;
  mockAcademicContext.selectedPeriod.period_sequence = 1;
  mockAcademicContext.selectedYear.is_active = true;
  mockAcademicContext.periods = [mockAcademicContext.selectedPeriod];

  vi.spyOn(apiModule, "apiFetch").mockImplementation(async (path: string) => {
    if (path.includes("/api/v1/classwork-assignments/assignment/16")) {
      return {
        ok: true,
        json: async () => mockReadingDetail,
      } as Response;
    }
    if (path.includes("/api/v1/submissions/my-submissions")) {
      return {
        ok: true,
        json: async () => [],
      } as Response;
    }
    if (path.includes("/api/v1/submissions/assignment/16/complete-reading")) {
      return {
        ok: true,
        json: async () => ({
          submission_id: 1,
          classwork_assignment_id: 16,
          status: "completed",
        }),
      } as Response;
    }
    return {
      ok: true,
      json: async () => ({}),
    } as Response;
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("keeps historical classwork viewable while hiding progress mutations", async () => {
  mockAcademicContext.selectedYear.is_active = false;

  mount("/student/classworks/16");

  expect(await screen.findByRole("heading", { name: "Kinematics Reference Guide" })).toBeTruthy();
  expect(screen.getByText("This reading is unavailable.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Mark as Completed" })).toBeNull();
  expect(
    vi.mocked(apiModule.apiFetch).mock.calls.some(
      ([path, options]) =>
        path.includes("/complete-reading") && options?.method === "POST",
    ),
  ).toBe(false);
});

describe("StudentClassworkView reading review and intervention integration", () => {
  it("renders standard reading material view without intervention card when no intervention_id is present", async () => {
    mount("/student/classworks/16");

    expect(await screen.findByRole("heading", { name: "Kinematics Reference Guide" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark as Completed" })).toBeTruthy();
    expect(screen.queryByText("Study Support Preparation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark as Reviewed" })).toBeNull();
    const resource = screen.getByRole("link", { name: "Kinematics Guide" });
    expect(resource.getAttribute("href")).toBe("https://docs.example.test/kinematics");
    expect(resource.getAttribute("target")).toBe("_blank");
    expect(resource.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders Study Support Preparation card with Review Required when intervention_id is present and not reviewed", async () => {
    vi.spyOn(persistentApi, "listInterventionReadingReviews").mockResolvedValueOnce([]);

    mount("/student/classworks/16?from=%2Fstudent%2Finterventions&intervention_id=7");

    expect(await screen.findByRole("heading", { name: "Kinematics Reference Guide" })).toBeTruthy();
    expect(screen.getByText("Study Support Preparation")).toBeTruthy();
    expect(screen.getByText("Review Required")).toBeTruthy();

    const reviewButton = screen.getByRole("button", { name: "Mark as Reviewed" });
    expect(reviewButton).toBeTruthy();

    // Standard classwork completion button is preserved alongside
    expect(screen.getByRole("button", { name: "Mark as Completed" })).toBeTruthy();
  });

  it("acknowledges reading review on click and updates badge to Reviewed", async () => {
    vi.spyOn(persistentApi, "listInterventionReadingReviews").mockResolvedValueOnce([]);
    const reviewSpy = vi.spyOn(persistentApi, "reviewInterventionReading").mockResolvedValueOnce({
      review_id: 88,
      intervention_id: 7,
      reading_assignment_id: 16,
      student_id: "test-student-id",
      review_status: "REVIEWED",
      reviewed_at: "2026-10-27T12:00:00Z",
      acknowledged_at: "2026-10-27T12:00:00Z",
    });

    mount("/student/classworks/16?from=%2Fstudent%2Finterventions&intervention_id=7");

    const reviewButton = await screen.findByRole("button", { name: "Mark as Reviewed" });
    fireEvent.click(reviewButton);

    await waitFor(() => {
      expect(reviewSpy).toHaveBeenCalledWith(7, 16);
    });

    expect(await screen.findByText("Reviewed")).toBeTruthy();
    expect(mockToast.success).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Reading reviewed" })
    );
  });

  it("supports repeated clicks on Mark as Reviewed idempotently without breaking", async () => {
    vi.spyOn(persistentApi, "listInterventionReadingReviews").mockResolvedValueOnce([]);
    const reviewSpy = vi.spyOn(persistentApi, "reviewInterventionReading").mockResolvedValue({
      review_id: 88,
      intervention_id: 7,
      reading_assignment_id: 16,
      student_id: "test-student-id",
      review_status: "REVIEWED",
      reviewed_at: "2026-10-27T12:00:00Z",
      acknowledged_at: "2026-10-27T12:00:00Z",
    });

    mount("/student/classworks/16?from=%2Fstudent%2Finterventions&intervention_id=7");

    const reviewButton = await screen.findByRole("button", { name: "Mark as Reviewed" });
    fireEvent.click(reviewButton);

    await waitFor(() => {
      expect(reviewSpy).toHaveBeenCalledTimes(1);
    });

    // Repeated click
    fireEvent.click(reviewButton);
    await waitFor(() => {
      expect(reviewSpy).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByText("Reviewed")).toBeTruthy();
  });

  it("displays Reviewed immediately if reading was already acknowledged according to the backend", async () => {
    vi.spyOn(persistentApi, "listInterventionReadingReviews").mockResolvedValueOnce([
      {
        review_id: 99,
        intervention_id: 7,
        reading_assignment_id: 16,
        assignment_id: 16,
        student_id: "test-student-id",
        review_status: "REVIEWED",
        reviewed_at: "2026-10-27T10:00:00Z",
        acknowledged_at: "2026-10-27T10:00:00Z",
      },
    ]);

    mount("/student/classworks/16?from=%2Fstudent%2Finterventions&intervention_id=7");

    expect(await screen.findByText("Study Support Preparation")).toBeTruthy();
    expect(screen.getByText("Reviewed")).toBeTruthy();
    expect(screen.queryByText("Review Required")).toBeNull();
  });

  it("allows returning back to Study Support via button", async () => {
    vi.spyOn(persistentApi, "listInterventionReadingReviews").mockResolvedValueOnce([]);

    mount("/student/classworks/16?from=%2Fstudent%2Finterventions&intervention_id=7");

    const backButton = await screen.findByRole("button", { name: /Back to Study Support/i });
    fireEvent.click(backButton);

    expect(await screen.findByText("Study Support Page")).toBeTruthy();
  });

  it("preserves standard classwork completion functionality alongside review", async () => {
    vi.spyOn(persistentApi, "listInterventionReadingReviews").mockResolvedValueOnce([]);

    mount("/student/classworks/16?from=%2Fstudent%2Finterventions&intervention_id=7");

    const completeButton = await screen.findByRole("button", { name: "Mark as Completed" });
    fireEvent.click(completeButton);

    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith(
        expect.objectContaining({ title: "Reading completed" })
      );
    });

    expect(
      await screen.findByText("You have completed this reading material.")
    ).toBeTruthy();

    // Study Support Preparation card and Mark as Reviewed remain active
    expect(screen.getByText("Study Support Preparation")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Mark as Reviewed" })).toBeTruthy();
  });

  it("navigates to lesson and subject when clicked in the subtitle", async () => {
    mount("/student/classworks/16");

    const lessonButtons = await screen.findAllByRole("button", {
      name: "Introduction to Kinematics",
    });
    expect(lessonButtons.length).toBeGreaterThanOrEqual(1);
    expect(lessonButtons[0].className).toContain("hover:underline");

    const subjectButton = screen.getByRole("button", { name: "Physics" });
    expect(subjectButton).toBeTruthy();
    expect(subjectButton.className).toContain("hover:underline");

    fireEvent.click(subjectButton);
    expect(await screen.findByTestId("subject-detail-page")).toBeTruthy();
  });

  it("renders breadcrumbs hierarchy Study Support -> Intervention Title -> Classwork when coming from intervention view", async () => {
    mount(
      "/student/classworks/16?from=%2Fstudent%2Finterventions%2Fview%3Fintervention%3D7&support_title=Physics%20Support"
    );

    expect(await screen.findByRole("heading", { name: "Kinematics Reference Guide" })).toBeTruthy();
    expect(screen.getByText("Study Support")).toBeTruthy();
    expect(screen.getByText("Physics Support")).toBeTruthy();
    expect(screen.getAllByText("Kinematics Reference Guide").length).toBeGreaterThanOrEqual(2);
  });
});

it("submits a link-only assignment through the existing multipart endpoint", async () => {
  vi.mocked(apiModule.apiFetch).mockImplementation(async (path: string, options?: RequestInit) => {
    if (path.includes("/api/v1/classwork-assignments/assignment/16")) {
      return { ok: true, json: async () => ({
        ...mockReadingDetail,
        classwork_type: "ASSIGNMENT",
        title: "Link Assignment",
        is_graded: true,
        max_attempts: null,
      }) } as Response;
    }
    if (path.includes("/api/v1/submissions/my-submissions")) {
      return { ok: true, json: async () => [] } as Response;
    }
    if (path.includes("/api/v1/submissions/assignment/16/submit") && options?.method === "POST") {
      return { ok: true, json: async () => ({
        submission_id: 21,
        classwork_assignment_id: 16,
        status: "submitted",
        attempt_count: 1,
        attachments: [],
        links: [{ submission_link_id: 4, url: "https://github.com/example/work", title: null, position: 0 }],
      }) } as Response;
    }
    return { ok: true, json: async () => ({}) } as Response;
  });

  mount("/student/classworks/16");
  expect(await screen.findByRole("heading", { name: "Link Assignment" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Submit link" }));
  fireEvent.change(screen.getByLabelText("Link 1 URL"), { target: { value: "https://github.com/example/work" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit Assignment" }));

  await waitFor(() => {
    const call = vi.mocked(apiModule.apiFetch).mock.calls.find(([path, options]) =>
      path.includes("/api/v1/submissions/assignment/16/submit") && options?.method === "POST"
    );
    expect(call).toBeTruthy();
    const body = call?.[1]?.body as FormData;
    expect(body.getAll("files")).toEqual([]);
    expect(JSON.parse(String(body.get("links")))).toEqual([{ url: "https://github.com/example/work", title: null }]);
  });
  expect(await screen.findByText("Submitted Links")).toBeTruthy();
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StudentInterventionView from "../intervention-view";

const mockApi = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
  getActive: vi.fn(),
  getResolved: vi.fn(),
  listActive: vi.fn(),
  listResolved: vi.fn(),
}));

vi.mock("@/lib/student-intervention-reviewers-api", () => ({
  listMyReviewers: mockApi.list,
  getMyReviewer: mockApi.detail,
}));

vi.mock("@/lib/student-persistent-interventions-api", () => ({
  getMyActiveIntervention: mockApi.getActive,
  getMyResolvedIntervention: mockApi.getResolved,
  listMyActiveInterventions: mockApi.listActive,
  listMyResolvedInterventions: mockApi.listResolved,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button data-testid="sidebar-trigger">Menu</button>,
}));

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const mockIntervention = {
  intervention_id: 10,
  status: "ACTIVE",
  subject_id: 1,
  subject_name: "Mathematics",
  class_id: 1,
  class_name: "Grade 9 - Section A",
  teacher_name: "Mara Santos",
  reviewer_id: 1,
  activities: [
    {
      assignment_id: 101,
      title: "151-A Targeted Mathematics Practice",
      classwork_type: "QUIZ",
      submission_status: "graded",
      grade: 10,
      total_points: 10,
    },
  ],
};

beforeEach(() => {
  mockApi.list.mockResolvedValue({ items: [], total: 0 });
  mockApi.detail.mockResolvedValue({
    material_id: 1,
    subject_name: "Mathematics",
    title: "Strengthening Your Exam Skills",
    sent_at: "2026-10-24T00:00:00Z",
    introduction:
      "You’ve shown solid progress in written work and performance tasks. The exam is where you can grow the most. This review covers exam strategies, practice ideas and a quick checklist.",
    body: "Study tips and notes from teacher for review.",
  });
  mockApi.getActive.mockResolvedValue(mockIntervention);
  mockApi.getResolved.mockResolvedValue(mockIntervention);
  mockApi.listActive.mockResolvedValue({
    items: [mockIntervention],
  });
  mockApi.listResolved.mockResolvedValue({ items: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mount = (path = "/student/interventions/view?reviewer=1") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/student/interventions/view" element={<StudentInterventionView />} />
      </Routes>
    </MemoryRouter>
  );

it("renders supporting materials and curated activities from teacher intervention flow", async () => {
  mount();

  expect(await screen.findByRole("heading", { name: "Strengthening Your Exam Skills", level: 1 })).toBeTruthy();
  expect(screen.getByText(/Mathematics/)).toBeTruthy();

  // Supporting material section
  expect(await screen.findByText("Supporting Material")).toBeTruthy();
  expect(screen.getByText("Study tips and notes from teacher for review.")).toBeTruthy();

  // Curated activities section
  expect(await screen.findByText("Curated Activities")).toBeTruthy();
  expect(screen.getByText("151-A Targeted Mathematics Practice")).toBeTruthy();
  expect(screen.getByText("Completed")).toBeTruthy();

  const markBtn = screen.getByRole("button", { name: /Mark as read/i });
  expect(markBtn).toBeTruthy();
  fireEvent.click(markBtn);
  expect(await screen.findByText(/Marked as read/i)).toBeTruthy();

  const backBtn = screen.getByRole("button", { name: /Back to support/i });
  expect(backBtn).toBeTruthy();
});

it("renders intervention details when navigated by ?intervention parameter without reviewer", async () => {
  mockApi.detail.mockRejectedValue(new Error("Not found"));
  mockApi.getActive.mockResolvedValue({
    ...mockIntervention,
    reviewer_id: null,
  });

  mount("/student/interventions/view?intervention=10");

  expect(await screen.findByRole("heading", { name: "Mathematics Support", level: 1 })).toBeTruthy();
  expect(screen.getByText(/Mathematics · Mara Santos/)).toBeTruthy();
  expect(screen.getByText("Curated Activities")).toBeTruthy();
  expect(screen.getByText("151-A Targeted Mathematics Practice")).toBeTruthy();
});


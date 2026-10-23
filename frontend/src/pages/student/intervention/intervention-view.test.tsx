// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StudentInterventionView from "../intervention-view";

const mockApi = vi.hoisted(() => ({
  list: vi.fn(),
  detail: vi.fn(),
}));

vi.mock("@/lib/student-intervention-reviewers-api", () => ({
  listMyReviewers: mockApi.list,
  getMyReviewer: mockApi.detail,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button data-testid="sidebar-trigger">Menu</button>,
}));

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

beforeEach(() => {
  mockApi.list.mockResolvedValue({ items: [], total: 0 });
  mockApi.detail.mockResolvedValue({
    material_id: 1,
    subject_name: "Mathematics",
    title: "Strengthening Your Exam Skills",
    sent_at: "2026-10-24T00:00:00Z",
    introduction:
      "You’ve shown solid progress in written work and performance tasks. The exam is where you can grow the most. This review covers exam strategies, practice ideas and a quick checklist.",
    body: "",
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mount = (path = "/student/interventions/view") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/student/interventions/view" element={<StudentInterventionView />} />
      </Routes>
    </MemoryRouter>
  );

it("renders the review interface matching the mockup structure", async () => {
  mount();

  expect(await screen.findByText(/Mathematics · Review from your teacher/i)).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Strengthening Your Exam Skills", level: 1 })).toBeTruthy();
  expect(screen.getByText("1. Where you are now")).toBeTruthy();
  expect(screen.getByText("Written work")).toBeTruthy();
  expect(screen.getByText("72.8%")).toBeTruthy();
  expect(screen.getByText("Performance tasks")).toBeTruthy();
  expect(screen.getByText("65.3%")).toBeTruthy();
  expect(screen.getByText("Your growth area")).toBeTruthy();
  expect(screen.getByText("58.8%")).toBeTruthy();

  expect(screen.getByText("2. Topics from your written work")).toBeTruthy();
  expect(screen.getByText("Number Sense")).toBeTruthy();
  expect(screen.getByText("Algebraic Expressions")).toBeTruthy();
  expect(screen.getByText("Needs attention.")).toBeTruthy();

  expect(screen.getByText("3. Quick checklist")).toBeTruthy();
  expect(screen.getByText("Practise simplifying algebraic expressions")).toBeTruthy();

  const markBtn = screen.getByRole("button", { name: /Mark as read/i });
  expect(markBtn).toBeTruthy();
  fireEvent.click(markBtn);
  expect(await screen.findByText(/Marked as read/i)).toBeTruthy();

  const backBtn = screen.getByRole("button", { name: /Back to support/i });
  expect(backBtn).toBeTruthy();
});

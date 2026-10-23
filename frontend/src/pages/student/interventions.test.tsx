// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StudentInterventions from "./interventions";

const mockApi = vi.hoisted(() => ({
  listReviewers: vi.fn(),
  listActive: vi.fn(),
  listResolved: vi.fn(),
}));

vi.mock("@/lib/student-intervention-reviewers-api", () => ({
  listMyReviewers: mockApi.listReviewers,
}));

vi.mock("@/lib/student-persistent-interventions-api", () => ({
  listMyActiveInterventions: mockApi.listActive,
  listMyResolvedInterventions: mockApi.listResolved,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button data-testid="sidebar-trigger">Menu</button>,
}));

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

beforeEach(() => {
  mockApi.listReviewers.mockResolvedValue({ items: [], total: 0 });
  mockApi.listActive.mockResolvedValue({ items: [] });
  mockApi.listResolved.mockResolvedValue({ items: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const mount = () =>
  render(
    <MemoryRouter initialEntries={["/student/interventions"]}>
      <Routes>
        <Route path="/student/interventions" element={<StudentInterventions />} />
      </Routes>
    </MemoryRouter>
  );

it("renders the study support dashboard matching the mockup", async () => {
  mount();

  expect(await screen.findAllByText("My Study Support")).toBeTruthy();
  expect(screen.getByText("Extra help your teachers have prepared for you.")).toBeTruthy();
  expect(screen.getByText("New from your teacher")).toBeTruthy();
  expect(screen.getByText("Math Review: Strengthening Your Exam Skills")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Start reading" })).toBeTruthy();

  expect(screen.getByText("Your active support")).toBeTruthy();
  expect(screen.getByText("Mathematics Support")).toBeTruthy();
  expect(screen.getByText("Teacher support active")).toBeTruthy();
  expect(screen.getByText("Practice activities are on their way. We'll let you know when the first one is ready.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Read the review" })).toBeTruthy();

  expect(screen.getByText("Past support")).toBeTruthy();
  expect(screen.getByText("Nothing here yet.")).toBeTruthy();
  expect(screen.getByText("Finished support will be saved here so you can look back on it.")).toBeTruthy();
});

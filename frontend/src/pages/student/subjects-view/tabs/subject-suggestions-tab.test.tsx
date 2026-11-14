// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import SubjectSuggestionsTab from "./subject-suggestions-tab";
import type { SuggestionResponse } from "@/types/suggestion";

const api = vi.hoisted(() => ({ getMy: vi.fn(), viewed: vi.fn(), complete: vi.fn() }));
vi.mock("@/lib/suggestion-api", () => ({
  getMySuggestions: api.getMy,
  markSuggestionViewed: api.viewed,
  completeSuggestion: api.complete,
}));
vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function item(kind: "LINK" | "LESSON"): SuggestionResponse {
  return {
    student_suggestion_id: kind === "LINK" ? 1 : 2, suggestion_type: "MANUAL",
    resource_type: kind, title: kind === "LINK" ? "External guide" : "Internal lesson",
    priority: "NORMAL", status: "ACTIVE", is_viewed: false,
    student_id: "student", subject_id: 7,
    resource: {
      resource_type: kind, title: kind === "LINK" ? "External guide" : "Internal lesson",
      subject_id: 7, is_available: true,
      external_url: kind === "LINK" ? "https://example.org/guide" : null,
      lesson_id: kind === "LESSON" ? 12 : null,
    },
  };
}

function Location() {
  const location = useLocation();
  return <><output data-testid="route">{location.search}</output><output data-testid="path">{location.pathname}</output></>;
}

function show() {
  return render(
    <MemoryRouter initialEntries={["/student/subjects/3/7?tab=suggestions"]}>
      <Routes>
        <Route path="/student/subjects/:classId/:subjectId" element={<><SubjectSuggestionsTab classId={3} subjectId={7} /><Location /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  api.getMy.mockReset().mockResolvedValue({ suggestions: [item("LINK"), item("LESSON")] });
  api.viewed.mockReset().mockImplementation(async (id: number) => ({ ...item(id === 1 ? "LINK" : "LESSON"), is_viewed: true }));
  api.complete.mockReset();
});
afterEach(cleanup);

it("shows LINK suggestions in the subject and marks opening viewed without internal navigation", async () => {
  show();
  expect(screen.getByText("View learning resources and recommendations suggested by your teacher for this subject.")).toBeTruthy();
  expect(screen.queryByText(/Select a lesson to narrow suggestions/)).toBeNull();
  const link = await screen.findByRole("link", { name: "Open Resource" });
  fireEvent.click(link);
  await waitFor(() => expect(api.viewed).toHaveBeenCalledWith(1));
  expect(screen.getByTestId("route").textContent).toBe("?tab=suggestions");
});

it("retains internal navigation for lessons", async () => {
  show();
  const lessonButton = await screen.findByRole("button", { name: "View Resource" });
  fireEvent.click(lessonButton);
  await waitFor(() => expect(api.viewed).toHaveBeenCalledWith(2));
  await waitFor(() => expect(screen.getByTestId("route").textContent).toContain("lessonId=12"));
});

it("opens an authorized historical lesson in its assigned class", async () => {
  api.getMy.mockResolvedValue({ suggestions: [{ ...item("LESSON"),
    origin_academic_period_id: 1, is_historical: true, origin_period_label: "2025-2026 · Q1",
    resource: { ...item("LESSON").resource, class_id: 8 },
  }] });
  show();
  fireEvent.click(await screen.findByRole("button", { name: "View Resource" }));
  await waitFor(() => expect(screen.getByTestId("path").textContent).toBe("/student/subjects/8/7"));
});

it("shows current, historical, and unknown-origin statuses once without drafts or archived records", async () => {
  api.getMy.mockResolvedValue({ suggestions: [
    { ...item("LINK"), student_suggestion_id: 1, origin_academic_period_id: 2,
      origin_period_label: "2025-2026 · Q2", is_historical: false },
    { ...item("LESSON"), student_suggestion_id: 2, status: "COMPLETED",
      origin_academic_period_id: 1, origin_period_label: "2025-2026 · Q1", is_historical: true },
    { ...item("LINK"), student_suggestion_id: 3, title: "Legacy guide", status: "DISMISSED",
      origin_academic_period_id: null, origin_period_label: "Unknown period" },
    { ...item("LINK"), student_suggestion_id: 4, title: "Archived guide", status: "ARCHIVED" },
    { ...item("LINK"), student_suggestion_id: 5, title: "Draft guide", status: "DRAFT" },
  ] });
  show();
  expect(await screen.findByText("Current Period")).toBeTruthy();
  expect(screen.getByText("Previous Periods")).toBeTruthy();
  expect(screen.getByText("Unknown Period")).toBeTruthy();
  expect(screen.getByText("Legacy guide")).toBeTruthy();
  expect(screen.queryByText("Archived guide")).toBeNull();
  expect(screen.queryByText("Draft guide")).toBeNull();
  expect(screen.getByRole("button", { name: "Dismissed" }).hasAttribute("disabled")).toBe(true);
  expect(api.getMy).toHaveBeenCalledWith();
});

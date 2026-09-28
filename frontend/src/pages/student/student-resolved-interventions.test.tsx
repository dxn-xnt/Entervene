// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StudentResolvedInterventions from "./student-resolved-interventions";

const api = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/student-persistent-interventions-api", () => ({
  listMyResolvedInterventions: api.list, getMyResolvedIntervention: api.detail,
}));

const resolved = {
  intervention_id: 4, status: "RESOLVED", subject_id: 1, subject_name: "Mathematics",
  class_id: 1, class_name: "Demo Class", teacher_name: "Demo Teacher", reviewer_id: 8,
  resolved_at: "2026-09-27T00:00:00Z", resolution_message: "Your progress reached the goal for this support.",
  activities: [{ assignment_id: 12, title: "Practice Quiz", classwork_type: "QUIZ",
    submission_status: "graded", grade: 8, total_points: 10 }],
};

const mount = (path = "/student/interventions") => render(<MemoryRouter initialEntries={[path]}><Routes>
  <Route path="/student/interventions" element={<StudentResolvedInterventions />} />
</Routes></MemoryRouter>);

beforeEach(() => { api.list.mockResolvedValue({ items: [resolved] }); api.detail.mockResolvedValue(resolved); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("shows previous support, completion and sent reviewer without edit controls", async () => {
  mount();
  expect(await screen.findByText("Mathematics · Resolved")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View Previous Support" }));
  const detail = await screen.findByRole("region", { name: "Previous support detail" });
  expect(within(detail).getByText("Your progress reached the goal for this support.")).toBeTruthy();
  expect(within(detail).getByText("Practice Quiz · Completed · Score: 8/10")).toBeTruthy();
  fireEvent.click(within(detail).getByRole("button", { name: "Read Reviewer" }));
  expect(api.detail).toHaveBeenCalledWith(4);
  expect(within(detail).queryByRole("button", { name: /edit|submit|prepare/i })).toBeNull();
});

it("does not show a guessed previous support when the detail read is denied", async () => {
  api.list.mockResolvedValue({ items: [] });
  api.detail.mockRejectedValue(new Error("denied"));
  mount("/student/interventions?previous=4");
  expect(await screen.findByText("Previous support is unavailable.")).toBeTruthy();
  expect(screen.queryByText("Practice Quiz")).toBeNull();
});

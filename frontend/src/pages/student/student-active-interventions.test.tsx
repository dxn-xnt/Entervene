// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import StudentActiveInterventions from "./student-active-interventions";

const api = vi.hoisted(() => ({ list: vi.fn(), detail: vi.fn() }));
vi.mock("@/lib/student-persistent-interventions-api", () => ({
  listMyActiveInterventions: api.list, getMyActiveIntervention: api.detail,
}));

const item = {
  intervention_id: 2, status: "ACTIVE", subject_id: 1, subject_name: "Mathematics",
  class_id: 1, class_name: "Demo Class", teacher_name: "Demo Teacher", reviewer_id: null,
  activities: [{ assignment_id: 12, title: "Practice Quiz", classwork_type: "QUIZ",
    submission_status: "graded", grade: 10, total_points: 10 }],
};

const mount = (path = "/student/interventions") => render(<MemoryRouter initialEntries={[path]}><Routes>
  <Route path="/student/interventions" element={<StudentActiveInterventions />} />
  <Route path="/student/subjects/:classId/:subjectId" element={<p>Classwork destination</p>} />
</Routes></MemoryRouter>);

beforeEach(() => { api.list.mockResolvedValue({ items: [item] }); api.detail.mockResolvedValue(item); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("opens own active support and reaches the existing graded Classwork route", async () => {
  mount();
  expect(await screen.findByText("Completed · Monitoring · Demo Class")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "View Support" }));
  expect(await screen.findByText("Completed · Score: 10/10")).toBeTruthy();
  expect(screen.getByText(/continuing to monitor your progress/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Read Reviewer" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "View Activity" }));
  expect(await screen.findByText("Classwork destination")).toBeTruthy();
});

it("shows only sent reviewer links and no target card for an empty student list", async () => {
  api.detail.mockResolvedValue({ ...item, reviewer_id: 8 });
  mount("/student/interventions?intervention=2");
  expect(await screen.findByRole("button", { name: "Read Reviewer" })).toBeTruthy();
  cleanup();
  api.list.mockResolvedValue({ items: [] });
  mount();
  expect(await screen.findByText("No active interventions at this time.")).toBeTruthy();
  expect(screen.queryByText("Mathematics")).toBeNull();
});

it("does not reveal a guessed intervention when the detail read is denied", async () => {
  api.list.mockResolvedValue({ items: [] });
  api.detail.mockRejectedValue(new Error("Unable to load your active support."));
  mount("/student/interventions?intervention=2");
  expect(await screen.findByText("Unable to load your active support.")).toBeTruthy();
  expect(screen.queryByText("Practice Quiz")).toBeNull();
});

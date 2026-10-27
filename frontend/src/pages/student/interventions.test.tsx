// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useParams } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudentInterventions from "./interventions";
import type {
  StudentPersistentIntervention,
  StudentRequiredReading,
  StudentSupportActivity,
} from "@/lib/student-persistent-interventions-api";

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

const reading = (
  assignmentId: number,
  order: number,
  reviewStatus: StudentRequiredReading["review_status"] = "NOT_REVIEWED",
  title = `Reading ${order}`,
  completionStatus: StudentRequiredReading["completion_status"] = "NOT_STARTED"
): StudentRequiredReading => ({
  classwork_id: assignmentId + 1000,
  assignment_id: assignmentId,
  title,
  order,
  completion_status: completionStatus,
  focused_seconds: completionStatus === "NOT_STARTED" ? 0 : 30,
  completed_at: completionStatus === "COMPLETED" ? "2026-10-27T08:00:00Z" : null,
  review_status: reviewStatus,
  reviewed_at: reviewStatus === "REVIEWED" ? "2026-10-27T08:00:00Z" : null,
});

const activity = (
  overrides: Partial<StudentSupportActivity> = {}
): StudentSupportActivity => ({
  assignment_id: 900,
  title: "Practice Quiz",
  classwork_type: "QUIZ",
  submission_status: null,
  grade: null,
  total_points: 10,
  access_state: "PREPARATION_REQUIRED",
  access_enforced: true,
  prerequisite_code: "PREPARATION_REQUIRED",
  prerequisite_message: "Complete the required readings.",
  preparation: {
    state: "NOT_STARTED",
    is_satisfied: false,
    completed_count: 0,
    required_count: 3,
    accessible_count: 3,
    unavailable_count: 0,
    summary: "0 of 3 completed",
  },
  readings: [reading(101, 1), reading(102, 2), reading(103, 3)],
  ...overrides,
});

const intervention = (
  activities: StudentSupportActivity[],
  overrides: Partial<StudentPersistentIntervention> = {}
): StudentPersistentIntervention => ({
  intervention_id: 2,
  status: "ACTIVE",
  subject_id: 1,
  subject_name: "Mathematics",
  class_id: 1,
  class_name: "Demo Class",
  teacher_name: "Demo Teacher",
  required_readings: [],
  resource_issues: [],
  preparation: {
    state: "NOT_APPLICABLE",
    is_satisfied: true,
    completed_count: 0,
    required_count: 0,
    accessible_count: 0,
    unavailable_count: 0,
    summary: "No intervention-level readings",
  },
  activities,
  reviewer_id: null,
  resolved_at: null,
  resolution_message: null,
  ...overrides,
});

function Destination() {
  const { assignmentId } = useParams();
  const search = typeof window !== "undefined" ? window.location.search : "";
  const params = new URLSearchParams(search);
  const interventionId = params.get("intervention_id");
  return (
    <p>
      Classwork destination {assignmentId}
      {interventionId ? ` intervention ${interventionId}` : ""}
    </p>
  );
}

const mount = () =>
  render(
    <MemoryRouter initialEntries={["/student/interventions"]}>
      <Routes>
        <Route path="/student/interventions" element={<StudentInterventions />} />
        <Route path="/student/classworks/:assignmentId" element={<Destination />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  mockApi.listReviewers.mockResolvedValue({ items: [], total: 0 });
  mockApi.listActive.mockResolvedValue({ items: [] });
  mockApi.listResolved.mockResolvedValue({ items: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("guided Study Support activities", () => {
  it("keeps a 0/3 activity locked and labels every reading as Review Required", async () => {
    mockApi.listActive.mockResolvedValue({ items: [intervention([activity()])] });
    mount();
    expect(await screen.findByText("0 of 3 reviewed")).toBeTruthy();
    expect(screen.getByText("Locked")).toBeTruthy();
    expect(screen.getAllByText("Review Required")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Start Activity" })).toBeNull();
  });

  it("keeps a 1/3 activity locked and shows 1 of 3 reviewed", async () => {
    const oneReviewed = activity({
      preparation: { state: "IN_PROGRESS", is_satisfied: false, completed_count: 1, required_count: 3, accessible_count: 3, unavailable_count: 0, summary: "1 of 3 completed" },
      readings: [
        reading(101, 1, "REVIEWED", "Reading 1"),
        reading(102, 2, "NOT_REVIEWED", "Reading 2"),
        reading(103, 3, "NOT_REVIEWED", "Reading 3"),
      ],
    });
    mockApi.listActive.mockResolvedValue({ items: [intervention([oneReviewed])] });
    mount();
    expect(await screen.findByText("1 of 3 reviewed")).toBeTruthy();
    expect(screen.getByText("Locked")).toBeTruthy();
    expect(screen.getAllByText("Reviewed")).toHaveLength(1);
    expect(screen.getAllByText("Review Required")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Start Activity" })).toBeNull();
  });

  it("keeps a 2/3 activity locked and shows individual review labels", async () => {
    const partiallyComplete = activity({
      preparation: { state: "IN_PROGRESS", is_satisfied: false, completed_count: 2, required_count: 3, accessible_count: 3, unavailable_count: 0, summary: "2 of 3 completed" },
      readings: [
        reading(101, 1, "REVIEWED", "Reading 1", "COMPLETED"),
        reading(102, 2, "NOT_REVIEWED", "Reading 2", "IN_PROGRESS"),
        reading(103, 3, "REVIEWED", "Reading 3", "COMPLETED"),
      ],
    });
    mockApi.listActive.mockResolvedValue({ items: [intervention([partiallyComplete])] });
    mount();
    expect(await screen.findByText("2 of 3 reviewed")).toBeTruthy();
    expect(screen.getAllByText("Reviewed")).toHaveLength(2);
    expect(screen.getByText("Review Required")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start Activity" })).toBeNull();
  });

  it("unlocks a 3/3 activity and uses the remediation assignment ID", async () => {
    const ready = activity({
      access_state: "READY",
      prerequisite_code: "PREPARATION_COMPLETE",
      preparation: { state: "COMPLETE", is_satisfied: true, completed_count: 3, required_count: 3, accessible_count: 3, unavailable_count: 0, summary: "3 of 3 completed" },
      readings: [
        reading(101, 1, "REVIEWED", "Reading 1", "COMPLETED"),
        reading(102, 2, "REVIEWED", "Reading 2", "COMPLETED"),
        reading(103, 3, "REVIEWED", "Reading 3", "COMPLETED"),
      ],
    });
    mockApi.listActive.mockResolvedValue({ items: [intervention([ready])] });
    mount();
    expect(await screen.findByText("3 of 3 reviewed")).toBeTruthy();
    expect(screen.getByText("Ready")).toBeTruthy();
    expect(screen.getAllByText("Reviewed")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Start Activity" }));
    expect(await screen.findByText(/Classwork destination 900/)).toBeTruthy();
  });

  it("opens readings by assignment ID, preserves intervention context, and displays them in snapshot order", async () => {
    const snapshotted = activity({
      readings: [
        reading(302, 2, "NOT_REVIEWED", "Second snapshot reading"),
        reading(301, 1, "REVIEWED", "First snapshot reading", "COMPLETED"),
      ],
      preparation: { state: "IN_PROGRESS", is_satisfied: false, completed_count: 1, required_count: 2, accessible_count: 2, unavailable_count: 0, summary: "1 of 2 completed" },
    });
    mockApi.listActive.mockResolvedValue({ items: [intervention([snapshotted])] });
    mount();
    const list = await screen.findByLabelText("Required readings for Practice Quiz");
    const titles = within(list).getAllByRole("heading", { level: 4 }).map((node) => node.textContent);
    expect(titles).toEqual(["First snapshot reading", "Second snapshot reading"]);
    fireEvent.click(screen.getByRole("button", { name: "Open reading: First snapshot reading" }));
    expect(await screen.findByText(/Classwork destination 301/)).toBeTruthy();
  });

  it("keeps two activities independent and ignores current intervention-level readings", async () => {
    const first = activity({
      assignment_id: 901,
      title: "Ready activity",
      access_state: "READY",
      preparation: { state: "COMPLETE", is_satisfied: true, completed_count: 1, required_count: 1, accessible_count: 1, unavailable_count: 0, summary: "1 of 1" },
      readings: [reading(401, 1, "REVIEWED", "Saved reading A", "COMPLETED")],
    });
    const second = activity({
      assignment_id: 902,
      title: "Locked activity",
      preparation: { state: "NOT_STARTED", is_satisfied: false, completed_count: 0, required_count: 1, accessible_count: 1, unavailable_count: 0, summary: "0 of 1" },
      readings: [reading(402, 1, "NOT_REVIEWED", "Saved reading B", "NOT_STARTED")],
    });
    mockApi.listActive.mockResolvedValue({
      items: [intervention([first, second], { required_readings: [reading(999, 1, "REVIEWED", "Changed current plan reading", "COMPLETED")] })],
    });
    mount();
    expect(await screen.findByText("Saved reading A")).toBeTruthy();
    expect(screen.getByText("Saved reading B")).toBeTruthy();
    expect(screen.queryByText("Changed current plan reading")).toBeNull();
    expect(screen.getAllByText("Ready")).toHaveLength(1);
    expect(screen.getAllByText("Locked")).toHaveLength(1);
  });

  it("shows a safe blocked state without inventing an inaccessible title", async () => {
    const blocked = activity({
      preparation: { state: "BLOCKED", is_satisfied: false, completed_count: 0, required_count: 2, accessible_count: 1, unavailable_count: 1, summary: "1 resource unavailable" },
      readings: [reading(501, 1, "NOT_REVIEWED", "Available reading", "NOT_STARTED")],
    });
    mockApi.listActive.mockResolvedValue({ items: [intervention([blocked])] });
    mount();
    expect(await screen.findByText(/Some required readings are unavailable/)).toBeTruthy();
    expect(screen.getByText("Available reading")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start Activity" })).toBeNull();
  });

  it("does not falsely unlock a historical activity without a snapshot", async () => {
    const historical = activity({
      access_state: "HISTORICAL",
      access_enforced: false,
      prerequisite_code: "PREREQUISITE_SNAPSHOT_MISSING",
      prerequisite_message: "Historical activity without snapshot.",
      preparation: null,
      readings: [],
    });
    mockApi.listResolved.mockResolvedValue({ items: [intervention([historical], { status: "RESOLVED", resolved_at: "2026-10-26T08:00:00Z" })] });
    mount();
    expect(await screen.findByText("Unavailable")).toBeTruthy();
    expect(screen.getByText("Historical activity without snapshot.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Activity/ })).toBeNull();
  });

  it.each([["submitted", "Submitted"], ["graded", "Completed"]])(
    "preserves the %s state without offering a new start",
    async (submissionStatus, label) => {
      const finished = activity({
        access_state: "READY",
        submission_status: submissionStatus,
        grade: submissionStatus === "graded" ? 9 : null,
        preparation: { state: "COMPLETE", is_satisfied: true, completed_count: 0, required_count: 0, accessible_count: 0, unavailable_count: 0, summary: "Ready" },
        readings: [],
      });
      mockApi.listActive.mockResolvedValue({ items: [intervention([finished])] });
      mount();
      expect(await screen.findByText(label)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Start Activity" })).toBeNull();
      expect(screen.getByRole("button", { name: "View Activity" })).toBeTruthy();
    }
  );
});

describe("Study Support request states", () => {
  it("keeps loading separate from empty data", () => {
    mockApi.listActive.mockReturnValue(new Promise(() => {}));
    mockApi.listResolved.mockReturnValue(new Promise(() => {}));
    mount();
    expect(screen.getByText("Loading your active support...")).toBeTruthy();
    expect(screen.queryByText("No active support")).toBeNull();
  });

  it("uses Student empty states after successful empty responses", async () => {
    mount();
    expect(await screen.findByText("No active support")).toBeTruthy();
    expect(screen.getByText("No past support yet")).toBeTruthy();
  });

  it("shows the shared inline Alert when an API request fails", async () => {
    mockApi.listActive.mockRejectedValue(new Error("offline"));
    mount();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Some study support could not be loaded. Please try again later."
    );
  });
});

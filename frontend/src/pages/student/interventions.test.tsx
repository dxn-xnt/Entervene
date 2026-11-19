// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import StudentInterventions from "./interventions";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  listReviewers: vi.fn(),
  listActive: vi.fn(),
  listResolved: vi.fn(),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/layouts/app-layout", () => ({ default: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("@/context/AcademicPeriodContext", () => ({
  useOptionalAcademicPeriod: () => ({ selectedPeriodId: 1 }),
}));
vi.mock("@/lib/student-intervention-reviewers-api", () => ({
  listMyReviewers: mocks.listReviewers,
}));
vi.mock("@/lib/student-persistent-interventions-api", () => ({
  listMyActiveInterventions: mocks.listActive,
  listMyResolvedInterventions: mocks.listResolved,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Student Study Support", () => {
  it("shows assigned readings while the remediation activity remains an unpublished teacher draft", async () => {
    mocks.listReviewers.mockResolvedValue({ items: [], total: 0 });
    mocks.listResolved.mockResolvedValue({ items: [] });
    mocks.listActive.mockResolvedValue({
      items: [{
        intervention_id: 6,
        status: "ACTIVE",
        subject_id: 7,
        subject_name: "Enhanced Mathematics 9",
        class_id: 8,
        class_name: "Archimedes",
        academic_period_id: 1,
        teacher_name: "Angel Alcantara",
        required_readings: [
          {
            classwork_id: 38,
            title: "Constructing Parallel & Perpendicular Lines",
            assignment_id: 31,
            order: 1,
            completion_status: "NOT_STARTED",
            focused_seconds: 0,
            completed_at: null,
            review_status: "NOT_REVIEWED",
            reviewed_at: null,
          },
          {
            classwork_id: 36,
            title: "Points, Lines, Rays, Segments, Angles & Planes",
            assignment_id: 27,
            order: 2,
            completion_status: "IN_PROGRESS",
            focused_seconds: 2,
            completed_at: null,
            review_status: "NOT_REVIEWED",
            reviewed_at: null,
          },
        ],
        resource_issues: [],
        preparation: {
          state: "NOT_STARTED",
          is_satisfied: false,
          completed_count: 0,
          required_count: 2,
          accessible_count: 2,
          unavailable_count: 0,
          summary: "0 of 2 completed",
        },
        activities: [],
        reviewer_id: null,
        activated_at: "2026-11-19T15:46:00+08:00",
        resolved_at: null,
        resolution_message: null,
      }],
    });

    render(<StudentInterventions />);

    expect(await screen.findByText("Enhanced Mathematics 9 Support")).toBeDefined();
    expect(screen.getByText("Supporting Readings")).toBeDefined();
    expect(screen.getByText("Constructing Parallel & Perpendicular Lines")).toBeDefined();
    expect(screen.getByText("Points, Lines, Rays, Segments, Angles & Planes")).toBeDefined();
    expect(screen.getAllByRole("button", { name: /Open reading:/i })).toHaveLength(2);
    expect(screen.queryByText("No practice activities yet")).toBeNull();
    await waitFor(() => expect(mocks.listActive).toHaveBeenCalledWith(1));
  });

  it("keeps successful active support visible when the reviewer request fails", async () => {
    mocks.listReviewers.mockRejectedValue(new Error("Reviewer service unavailable"));
    mocks.listResolved.mockResolvedValue({ items: [] });
    mocks.listActive.mockResolvedValue({
      items: [{
        intervention_id: 6,
        status: "ACTIVE",
        subject_id: 7,
        subject_name: "Enhanced Mathematics 9",
        class_id: 8,
        class_name: "Archimedes",
        academic_period_id: 1,
        teacher_name: "Angel Alcantara",
        required_readings: [{
          classwork_id: 38,
          title: "Constructing Parallel & Perpendicular Lines",
          assignment_id: 31,
          order: 1,
          completion_status: "NOT_STARTED",
          focused_seconds: 0,
          completed_at: null,
          review_status: "NOT_REVIEWED",
          reviewed_at: null,
        }],
        resource_issues: [],
        preparation: {
          state: "NOT_STARTED",
          is_satisfied: false,
          completed_count: 0,
          required_count: 1,
          accessible_count: 1,
          unavailable_count: 0,
          summary: "0 of 1 completed",
        },
        activities: [],
        reviewer_id: null,
        activated_at: "2026-11-19T15:46:00+08:00",
        resolved_at: null,
        resolution_message: null,
      }],
    });

    render(<StudentInterventions />);

    expect(await screen.findByText("Enhanced Mathematics 9 Support")).toBeDefined();
    expect(screen.getByText("Constructing Parallel & Perpendicular Lines")).toBeDefined();
    expect(screen.getByText("Some Study Support could not be loaded. Please try again later.")).toBeDefined();
    expect(screen.queryByText("No active support")).toBeNull();
  });
});

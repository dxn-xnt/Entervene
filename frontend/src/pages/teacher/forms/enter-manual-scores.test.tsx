// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EnterManualScoresModal from "./enter-manual-scores";

const apiMocks = vi.hoisted(() => ({
  getActivityScores: vi.fn(),
  bulkUpdateActivityScores: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, ...apiMocks };
});

vi.mock("@/components/retroui/Dialog", () => ({
  Dialog: {
    Content: ({ children }: { children: ReactNode }) => (
      <div data-slot="dialog-content">
        <div>{children}</div>
      </div>
    ),
    Header: ({ children }: { children: ReactNode }) => (
      <div data-slot="dialog-header">{children}</div>
    ),
    Footer: ({ children }: { children: ReactNode }) => (
      <div data-slot="dialog-footer">{children}</div>
    ),
    Close: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  },
}));

describe("Gradebook Enter Scores modal", () => {
  beforeEach(() => {
    apiMocks.getActivityScores.mockResolvedValue({
      activity_id: 11,
      classwork_assignment_id: 22,
      title: "Online activity",
      max_score: 100,
      activity_mode: "ONLINE",
      students: [
        {
          student_id: "student-pending",
          name: "Zoe Reyes",
          score: null,
          assigned: true,
          can_enter_score: false,
          score_entry_reason: "A submitted student attempt is required before an online grade can be saved.",
        },
        {
          student_id: "student-submitted",
          name: "Juan Cruz",
          score: 0,
          assigned: true,
          can_enter_score: true,
          score_entry_reason: null,
        },
        {
          student_id: "student-unassigned",
          name: "Ana Alvarez",
          score: null,
          assigned: false,
          can_enter_score: false,
          score_entry_reason: "Not assigned to this classwork.",
        },
      ],
    });
    apiMocks.bulkUpdateActivityScores.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a two-column table sorted by surname with pale-yellow notice, unavailable locks, and submits only gradeable scores", async () => {
    render(
      <EnterManualScoresModal
        activityId={11}
        classId={4}
        activityTitle="Online activity"
        maxScore={100}
        studentDisplayNames={{
          "student-pending": "Reyes, Zoe M.",
          "student-submitted": "Cruz, Juan P.",
          "student-unassigned": "Alvarez, Ana L.",
        }}
      />,
    );

    await screen.findByText("Cruz, Juan P.");

    // Single scrollable body between header and footer so App.css dialog scroller never clips the notice
    const modalInner = document.querySelector('[data-slot="dialog-content"] > div');
    const middleRegions = Array.from(modalInner?.children ?? []).filter(
      (child) =>
        child.getAttribute("data-slot") !== "dialog-header" &&
        child.getAttribute("data-slot") !== "dialog-footer",
    );
    expect(middleRegions).toHaveLength(1);

    const modalBody = screen.getByTestId("enter-scores-modal-body");
    expect(middleRegions[0]).toBe(modalBody);
    expect(modalBody.className).toContain("overflow-y-auto");
    expect(modalBody.className).not.toContain("flex-col");

    // Compact pale-yellow notice with exact message inside the single scrollable body (no bright blue info alert)
    const notice = within(modalBody).getByRole("note");
    expect(notice.textContent).toContain(
      "Online scores can be entered only after a student submits their work.",
    );
    expect(notice.className).toContain("bg-yellow-50");
    expect(notice.className).toContain("border-black");
    expect(notice.className).not.toContain("bg-blue-300");

    // Only two columns: Learner's Name and Score (no status column or Submitted/Not Submitted badges)
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((header) => header.textContent?.trim())).toEqual(["Learner's Name", "Score"]);
    expect(screen.queryByText(/^Submitted$/i)).toBeNull();
    expect(screen.queryByText(/^Not Submitted$/i)).toBeNull();

    // Sorted alphabetically by surname: Alvarez -> Cruz -> Reyes
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent?.trim())).toEqual([
      "Alvarez, Ana L.",
      "Cruz, Juan P.",
      "Reyes, Zoe M.",
    ]);

    // Missing online submission shows "No submission yet"; other restrictions keep their own label/reason
    expect(screen.getByText("No submission yet")).toBeTruthy();
    expect(screen.getByText("Not assigned")).toBeTruthy();

    const unassignedStatus = screen.getByLabelText("Not assigned for Alvarez, Ana L.");
    const unassignedReasonId = unassignedStatus.getAttribute("aria-describedby");
    expect(unassignedReasonId).toBeTruthy();
    expect(document.getElementById(unassignedReasonId!)?.textContent).toBe(
      "Not assigned to this classwork.",
    );
    expect(document.getElementById(unassignedReasonId!)?.className).toContain("sr-only");

    const pendingStatus = screen.getByLabelText("No submission yet for Reyes, Zoe M.");
    const pendingReasonId = pendingStatus.getAttribute("aria-describedby");
    expect(pendingReasonId).toBeTruthy();
    expect(document.getElementById(pendingReasonId!)?.textContent).toBe(
      "A submitted student attempt is required before an online grade can be saved.",
    );
    expect(document.getElementById(pendingReasonId!)?.className).toContain("sr-only");

    // Only the gradeable student renders an editable score input (preserving 0)
    const scoreInputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(scoreInputs).toHaveLength(1);
    expect(scoreInputs[0].disabled).toBe(false);
    expect(scoreInputs[0].value).toBe("0");

    fireEvent.change(scoreInputs[0], { target: { value: "75" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Scores" }));

    await waitFor(() => {
      expect(apiMocks.bulkUpdateActivityScores).toHaveBeenCalledWith(11, {
        class_id: 4,
        scores: [{ student_id: "student-submitted", score: 75 }],
      });
    });
  });

  it("preserves manual/offline activity grading without showing the online submission notice", async () => {
    apiMocks.getActivityScores.mockResolvedValueOnce({
      activity_id: 19,
      classwork_assignment_id: 30,
      title: "Oral Recitation",
      max_score: 50,
      activity_mode: "MANUAL",
      students: [
        {
          student_id: "student-b",
          name: "Maria Clara Santos",
          score: null,
          assigned: true,
          can_enter_score: true,
          score_entry_reason: null,
        },
        {
          student_id: "student-a",
          name: "Pedro Alfonso Cruz",
          score: 45,
          assigned: true,
          can_enter_score: true,
          score_entry_reason: null,
        },
      ],
    });

    render(
      <EnterManualScoresModal
        activityId={19}
        classId={4}
        activityTitle="Oral Recitation"
        maxScore={50}
      />,
    );

    await screen.findByText("Cruz, Pedro A.");
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.queryByText("No submission yet")).toBeNull();
    expect(screen.queryByText("Unavailable")).toBeNull();

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent?.trim())).toEqual([
      "Cruz, Pedro A.",
      "Santos, Maria C.",
    ]);

    const scoreInputs = screen.getAllByRole("spinbutton") as HTMLInputElement[];
    expect(scoreInputs).toHaveLength(2);
    expect(scoreInputs[0].value).toBe("45");
    expect(scoreInputs[1].value).toBe("");

    fireEvent.change(scoreInputs[1], { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Scores" }));

    await waitFor(() => {
      expect(apiMocks.bulkUpdateActivityScores).toHaveBeenCalledWith(19, {
        class_id: 4,
        scores: [
          { student_id: "student-b", score: 42 },
          { student_id: "student-a", score: 45 },
        ],
      });
    });
  });

  it("formats and sorts mixed student name patterns as Surname, Firstname MI.", async () => {
    apiMocks.getActivityScores.mockResolvedValueOnce({
      activity_id: 23,
      classwork_assignment_id: 34,
      title: "Seatwork",
      max_score: 20,
      activity_mode: "MANUAL",
      students: [
        {
          student_id: "s-1",
          name: "Ana Maria L. Dela Cruz",
          score: null,
          assigned: true,
          can_enter_score: true,
          score_entry_reason: null,
        },
        {
          student_id: "s-2",
          name: "Bea De la Rosa",
          score: null,
          assigned: true,
          can_enter_score: true,
          score_entry_reason: null,
        },
        {
          student_id: "s-3",
          name: "Zoe Cruz",
          score: null,
          assigned: true,
          can_enter_score: true,
          score_entry_reason: null,
        },
        {
          student_id: "s-4",
          name: "Juan Cruz",
          score: null,
          assigned: true,
          can_enter_score: true,
          score_entry_reason: null,
        },
      ],
    });

    render(
      <EnterManualScoresModal
        activityId={23}
        classId={4}
        activityTitle="Seatwork"
        maxScore={20}
        studentDisplayNames={{
          "s-4": "Cruz, Juan M.",
        }}
      />,
    );

    await screen.findByText("Cruz, Juan M.");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows.map((row) => within(row).getAllByRole("cell")[0].textContent?.trim())).toEqual([
      "Cruz, Juan M.",
      "Cruz, Zoe",
      "De la Rosa, Bea",
      "Dela Cruz, Ana Maria L.",
    ]);
  });

  it("retains Unavailable and the backend reason for non-submission restrictions", async () => {
    apiMocks.getActivityScores.mockResolvedValueOnce({
      activity_id: 24,
      classwork_assignment_id: 35,
      title: "Online quiz",
      max_score: 20,
      activity_mode: "ONLINE",
      students: [
        {
          student_id: "s-locked",
          name: "Clara Santos",
          score: null,
          assigned: true,
          can_enter_score: false,
          score_entry_reason: "Grading period is closed for edits.",
        },
      ],
    });

    render(
      <EnterManualScoresModal
        activityId={24}
        classId={4}
        activityTitle="Online quiz"
        maxScore={20}
      />,
    );

    await screen.findByText("Santos, Clara");
    expect(screen.queryByText("No submission yet")).toBeNull();
    expect(screen.getByText("Unavailable")).toBeTruthy();

    const lockedStatus = screen.getByLabelText("Unavailable for Santos, Clara");
    const reasonId = lockedStatus.getAttribute("aria-describedby");
    expect(document.getElementById(reasonId!)?.textContent).toBe(
      "Grading period is closed for edits.",
    );
  });
});

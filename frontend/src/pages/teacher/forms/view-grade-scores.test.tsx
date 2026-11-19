// @vitest-environment jsdom

import { useRef, useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "@/components/retroui/Dialog";
import ViewGradeScoreModal from "./view-grade-scores";
import EnterManualScoresModal from "./enter-manual-scores";

const apiMocks = vi.hoisted(() => ({
  getActivityScores: vi.fn(),
  bulkUpdateActivityScores: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, ...apiMocks };
});

type StudentGradeItem = {
  student_id: string;
  name: string;
  scores: (number | null)[];
  gender?: string | null;
};

function BreakdownHarness({
  initialGrades,
  refreshedGrades,
}: {
  initialGrades: StudentGradeItem[];
  refreshedGrades?: StudentGradeItem[];
}) {
  const [parentOpen, setParentOpen] = useState(true);
  const [grades, setGrades] = useState(initialGrades);
  const [scoringActivity, setScoringActivity] = useState<{
    activityId: number;
    title: string;
    maxScore: number;
  } | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const items = [
    { id: 101, title: "Essay 1", maxScore: 50 },
    { id: 102, title: "Worksheet 2", maxScore: 100 },
  ];

  const studentDisplayNames = Object.fromEntries(
    grades.map((student) => [student.student_id, student.name]),
  );

  return (
    <Dialog
      open={parentOpen}
      onOpenChange={(open) => {
        if (!open) {
          if (scoringActivity) return;
          setParentOpen(false);
        }
      }}
    >
      {parentOpen && (
        <ViewGradeScoreModal
          categoryName="Written Works"
          items={items}
          studentGrades={grades}
          onEnterScores={(item, triggerElement) => {
            returnFocusRef.current = triggerElement ?? null;
            setScoringActivity({
              activityId: item.id,
              title: item.title,
              maxScore: item.maxScore,
            });
          }}
          nestedModal={
            <Dialog
              open={scoringActivity !== null}
              onOpenChange={(open) => {
                if (!open) setScoringActivity(null);
              }}
            >
              {scoringActivity && (
                <EnterManualScoresModal
                  activityId={scoringActivity.activityId}
                  classId={4}
                  activityTitle={scoringActivity.title}
                  maxScore={scoringActivity.maxScore}
                  studentDisplayNames={studentDisplayNames}
                  isNested
                  finalFocus={returnFocusRef}
                  onSuccess={() => {
                    if (refreshedGrades) setGrades(refreshedGrades);
                  }}
                  onClose={() => setScoringActivity(null)}
                />
              )}
            </Dialog>
          }
        />
      )}
    </Dialog>
  );
}

const sampleInitialGrades: StudentGradeItem[] = [
  {
    student_id: "s-1",
    name: "3elacruz, Juan P.",
    scores: [40, 80],
    gender: "Male",
  },
  {
    student_id: "s-2",
    name: "Cruz, Maria A.",
    scores: [45, null],
    gender: "Female",
  },
];

describe("Gradebook Breakdown and nested Enter Scores modals", () => {
  beforeEach(() => {
    apiMocks.getActivityScores.mockResolvedValue({
      activity_id: 102,
      classwork_assignment_id: 55,
      title: "Worksheet 2",
      max_score: 100,
      activity_mode: "ONLINE",
      students: [
        {
          student_id: "s-1",
          name: "Juan 3elacruz",
          score: 80,
          assigned: true,
          can_enter_score: true,
          score_entry_reason: null,
        },
        {
          student_id: "s-2",
          name: "Maria Cruz",
          score: null,
          assigned: true,
          can_enter_score: false,
          score_entry_reason:
            "A submitted student attempt is required before an online grade can be saved.",
        },
      ],
    });
    apiMocks.bulkUpdateActivityScores.mockResolvedValue({});
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("removes automatic row numbering while preserving stored surname numbers and Learner's Name header", () => {
    render(<BreakdownHarness initialGrades={sampleInitialGrades} />);

    const parentDialog = screen.getByRole("dialog");
    expect(within(parentDialog).getByText("Written Works Breakdown (Latest First)")).toBeTruthy();
    expect(within(parentDialog).getByRole("columnheader", { name: "Learner's Name" })).toBeTruthy();

    // Preserves numeric surname without prepending "1. " or "2. "
    expect(within(parentDialog).getByText("3elacruz, Juan P.")).toBeTruthy();
    expect(within(parentDialog).getByText("Cruz, Maria A.")).toBeTruthy();
    expect(within(parentDialog).queryByText(/^1\./)).toBeNull();
    expect(within(parentDialog).queryByText(/^2\./)).toBeNull();
  });

  it("opens Enter Scores above Breakdown, preserves search/scroll, closes only child on Cancel/X/Escape, and returns focus", async () => {
    render(<BreakdownHarness initialGrades={sampleInitialGrades} />);

    const searchInput = screen.getByPlaceholderText("Search student's name...") as HTMLInputElement;
    fireEvent.change(searchInput, { target: { value: "3elacruz" } });
    expect(searchInput.value).toBe("3elacruz");

    const parentSection = searchInput.closest("section") as HTMLElement;
    parentSection.scrollTop = 120;

    const pencilButton = screen.getByRole("button", {
      name: "Enter or edit scores for Worksheet 2",
    });
    pencilButton.focus();
    fireEvent.click(pencilButton);

    // Both parent and child dialogs remain mounted; child is the active accessible dialog stacked above parent
    await screen.findByText("Enter Scores");
    expect(screen.getAllByRole("dialog", { hidden: true })).toHaveLength(2);
    const childDialog = screen.getByRole("dialog");
    expect(childDialog.className).toContain("z-[1001]");
    expect(screen.getByText("Written Works Breakdown (Latest First)")).toBeTruthy();

    // Child shows complete student list (including students filtered out of parent search) with Learner's Name + Score
    expect(
      within(childDialog)
        .getAllByRole("columnheader")
        .map((header) => header.textContent?.trim()),
    ).toEqual(["Learner's Name", "Score"]);
    expect(within(childDialog).getByText("3elacruz, Juan P.")).toBeTruthy();
    expect(within(childDialog).getByText("Cruz, Maria A.")).toBeTruthy();
    expect(within(childDialog).getByText("No submission yet")).toBeTruthy();

    // Cancel closes ONLY the child, preserves parent search/scroll, and restores focus to pencil button
    fireEvent.click(within(childDialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(screen.queryByText("Enter Scores")).toBeNull();
    });
    expect(screen.getByText("Written Works Breakdown (Latest First)")).toBeTruthy();
    expect((screen.getByPlaceholderText("Search student's name...") as HTMLInputElement).value).toBe(
      "3elacruz",
    );
    expect(parentSection.scrollTop).toBe(120);
    await waitFor(() => {
      expect(document.activeElement).toBe(pencilButton);
    });

    // Re-open and verify Escape closes ONLY the topmost child dialog
    fireEvent.click(pencilButton);
    await screen.findByText("Enter Scores");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByText("Enter Scores")).toBeNull();
    });
    expect(screen.getByText("Written Works Breakdown (Latest First)")).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(pencilButton);
    });

    // Re-open and verify X button closes ONLY the child dialog
    fireEvent.click(pencilButton);
    await screen.findByText("Enter Scores");
    const activeChildDialog = screen.getByRole("dialog");
    const closeXButton = within(activeChildDialog).getByTitle("Close pop-up");
    fireEvent.click(closeXButton);
    await waitFor(() => {
      expect(screen.queryByText("Enter Scores")).toBeNull();
    });
    expect(screen.getByText("Written Works Breakdown (Latest First)")).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(pencilButton);
    });
  });

  it("saves scores, closes only Enter Scores, refreshes parent scores and totals, and returns focus", async () => {
    const updatedGrades: StudentGradeItem[] = [
      {
        student_id: "s-1",
        name: "3elacruz, Juan P.",
        scores: [40, 95],
        gender: "Male",
      },
      {
        student_id: "s-2",
        name: "Cruz, Maria A.",
        scores: [45, null],
        gender: "Female",
      },
    ];

    render(
      <BreakdownHarness
        initialGrades={sampleInitialGrades}
        refreshedGrades={updatedGrades}
      />,
    );

    const parentDialog = screen.getByRole("dialog");
    expect(within(parentDialog).getByText("120")).toBeTruthy();

    const pencilButton = within(parentDialog).getByRole("button", {
      name: "Enter or edit scores for Worksheet 2",
    });
    fireEvent.click(pencilButton);

    await screen.findByText("Enter Scores");
    const scoreInput = screen.getByLabelText("Score for 3elacruz, Juan P.") as HTMLInputElement;
    fireEvent.change(scoreInput, { target: { value: "95" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Scores" }));

    await waitFor(() => {
      expect(apiMocks.bulkUpdateActivityScores).toHaveBeenCalledWith(102, {
        class_id: 4,
        scores: [{ student_id: "s-1", score: 95 }],
      });
    });

    await waitFor(() => {
      expect(screen.queryByText("Enter Scores")).toBeNull();
    });

    // Parent stays open with updated score (95) and refreshed total (40 + 95 = 135)
    expect(screen.getByText("Written Works Breakdown (Latest First)")).toBeTruthy();
    expect(within(parentDialog).getByText("95")).toBeTruthy();
    expect(within(parentDialog).getByText("135")).toBeTruthy();
    await waitFor(() => {
      expect(document.activeElement).toBe(pencilButton);
    });
  });
});

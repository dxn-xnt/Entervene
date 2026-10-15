// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BulkSendGradesToAdviserResponse, StudentGradebookResponse } from "@/lib/api";
import TeacherGradeView from "./grade-view";

const mocks = vi.hoisted(() => ({ book: vi.fn(), periods: vi.fn(), summary: vi.fn(), bulk: vi.fn(), single: vi.fn() }));
vi.mock("@/lib/api", () => ({
  getTeacherGradebook: mocks.book,
  getTeacherAvailablePeriods: mocks.periods,
  getTeacherTermSummary: mocks.summary,
  bulkSendGradesToAdviser: mocks.bulk,
  sendStudentGradeToAdviser: mocks.single,
  exportTeacherClassRecord: vi.fn(),
  exportTeacherClassRecordWorkbook: vi.fn(),
}));
vi.mock("react-router-dom", () => ({ useParams: () => ({ section: "1", subject: "2" }) }));
vi.mock("@/layouts/app-layout", () => ({ default: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("./forms/view-grade-scores", () => ({ default: () => null }));
vi.mock("./forms/add-classwork-score", () => ({ default: () => null }));
vi.mock("./forms/enter-manual-scores", () => ({ default: () => null }));
vi.mock("@/components/retroui/tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render: child }: { render: ReactNode }) => <>{child}</>,
  TooltipContent: () => null,
}));
vi.mock("@/components/retroui/Dialog", async () => {
  const React = await import("react");
  const Open = React.createContext(false);
  const Part = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { Dialog: Object.assign(
    ({ children, open }: { children: ReactNode; open: boolean }) => <Open.Provider value={open}>{children}</Open.Provider>,
    { Content: ({ children }: { children: ReactNode }) => React.useContext(Open) ? <section role="dialog">{children}</section> : null,
      Header: Part, Footer: Part },
  ) };
});
vi.mock("@/components/retroui/Select", () => ({
  Select: Object.assign(
    ({ children, value, onValueChange }: { children: ReactNode; value: string; onValueChange: (v: string) => void }) =>
      <select value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>,
    { Trigger: () => null, Value: () => null, Content: ({ children }: { children: ReactNode }) => <>{children}</>,
      Group: ({ children }: { children: ReactNode }) => <>{children}</>,
      Item: ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option> },
  ),
}));

function gradebook(): StudentGradebookResponse {
  return {
    scope: { section_name: "Example Section", subject_name: "Example Subject" },
    classwork: [{ writtenWork: [], performanceTask: [], quarterlyAssessment: [] }],
    grading_weights: { template_id: 7, template_name: "Two categories", ww_weight: 0.4, pt_weight: 0.6,
      exams_weight: 0, ww_percentage: 40, pt_percentage: 60, exams_percentage: 0 },
    studentGrades: [
      { student_id: "complete", name: "Scored Zero", writtenWork: [0], performanceTask: [0],
        quarterlyAssessment: [], ps_written: 0, ps_performance: 0, ps_quarterly: null,
        transmuted_grade: 60, initial_grade: 0, total: "60", finalized_at: null },
      { student_id: "incomplete", name: "Missing Evidence", writtenWork: [90], performanceTask: [null],
        quarterlyAssessment: [], ps_written: 90, ps_performance: null, ps_quarterly: null,
        transmuted_grade: null, total: "", finalized_at: null },
    ],
  };
}

function skippedResult(sentCount = 0, configuration = false): BulkSendGradesToAdviserResponse {
  return {
    class_id: 1, subject_id: 2, academic_period_id: 3, total_students: 2,
    newly_sent_count: sentCount, unchanged_skipped_count: 0, incomplete_skipped_count: 1,
    finalized_at: sentCount ? "2026-10-16T00:00:00Z" : null,
    finalized_by_staff_id: "test-staff", finalized_by_name: "Example Teacher",
    entries: [{ student_id: "incomplete", name: "Missing Evidence", is_finalized: false,
      finalized_at: null, final_period_grade: null, status: "skipped_incomplete",
      skip_reason: configuration ? "grading_configuration_invalid" : "grade_send_incomplete",
      message: configuration ? "Grade not sent. Configure an active grading template for this subject first."
        : "Grade not sent. Missing scored components: Performance Task. Any previously stored grade is unchanged.",
      incomplete_components: configuration ? [] : ["performance_task"] }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.book.mockResolvedValue(gradebook());
  mocks.periods.mockResolvedValue({ default_academic_period_id: 3, periods: [{ academic_period_id: 3, period_name: "Term 1" }] });
  mocks.summary.mockResolvedValue({ scope: {}, periods: [], students: [] });
  mocks.bulk.mockResolvedValue(skippedResult());
});
afterEach(cleanup);

async function openConfirmation() {
  render(<TeacherGradeView />);
  const open = await screen.findByRole("button", { name: "Send All to Adviser" });
  await waitFor(() => expect((open as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(open);
  return screen.findByRole("dialog");
}

describe("grade-send evidence rendering", () => {
  it("counts scored zero and only configured category percentages in the preliminary check", async () => {
    const dialog = await openConfirmation();
    expect(screen.getByText("Category Evidence Available").parentElement?.textContent).toContain("1");
    expect(screen.getByText("Missing Evidence (Will Skip)").parentElement?.textContent).toContain("1");
    expect(dialog.textContent).toContain("A scored zero counts. Not every assignment must be graded.");
    expect(dialog.textContent).toContain("existing adviser grades will stay unchanged");
    expect(dialog.textContent).not.toMatch(/sending anyway|sent anyway|sent based on available scores/i);
  });

  it.each([0, 1])("shows individual skipped reasons when %i grades were sent", async (sentCount) => {
    mocks.bulk.mockResolvedValue(skippedResult(sentCount));
    await openConfirmation();
    const dialog = screen.getByRole("dialog");
    const send = Array.from(dialog.querySelectorAll("button")).find((button) => button.textContent?.includes("Confirm"));
    expect(send).toBeDefined();
    fireEvent.click(send!);
    const list = await screen.findByRole("list", { name: "Students whose grades were not sent" });
    expect(list.textContent).toContain("Missing Evidence");
    expect(list.textContent).toContain("Missing scored components: Performance Task");
    expect(screen.getByText("Skipped (Not Sent)").parentElement?.textContent).toContain("1");
    if (!sentCount) expect(screen.getByText(/No grades were sent or updated/)).toBeTruthy();
    expect(screen.queryByText("With Warnings")).toBeNull();
    expect(document.body.textContent).not.toMatch(/transmitted with missing classwork components/i);
  });

  it("renders a configuration skip with a null timestamp and no fabricated grade", async () => {
    mocks.bulk.mockResolvedValue(skippedResult(0, true));
    await openConfirmation();
    const send = Array.from(screen.getByRole("dialog").querySelectorAll("button")).find((button) => button.textContent?.includes("Confirm"));
    fireEvent.click(send!);
    const list = await screen.findByRole("list", { name: "Students whose grades were not sent" });
    expect(list.textContent).toContain("Configure an active grading template");
    expect(document.body.textContent).not.toContain("Invalid Date");
  });
});

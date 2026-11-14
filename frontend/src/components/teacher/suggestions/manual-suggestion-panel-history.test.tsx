// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ManualSuggestionPanel } from "./manual-suggestion-panel";
import type { SuggestionResponse } from "@/types/suggestion";
import type { TeacherAdvisoryStudentItem } from "@/types/adminClasses";

const api = vi.hoisted(() => ({ list: vi.fn(), dismiss: vi.fn(), approve: vi.fn(), archive: vi.fn() }));
vi.mock("@/lib/suggestion-api", () => ({
  getTeacherSuggestions: api.list,
  dismissSuggestion: api.dismiss,
  approveSuggestion: api.approve,
  archiveSuggestion: api.archive,
}));
vi.mock("./suggestion-panel-modal", () => ({ SuggestionPanel: () => null }));
vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function suggestion(id: number, historical: boolean, manageable: boolean): SuggestionResponse {
  return {
    student_suggestion_id: id, suggestion_type: "MANUAL", resource_type: "LINK",
    title: historical ? "Earlier reading" : "Current reading", description: "Review this guide",
    priority: "NORMAL", status: "ACTIVE", is_viewed: false,
    student_id: "student", subject_id: 7, is_historical: historical, can_manage: manageable,
    origin_academic_period_id: historical ? 1 : 2,
    origin_period_label: historical ? "2025-2026 · Q1" : "2025-2026 · Q2",
    resource: { resource_type: "LINK", title: "Guide", subject_id: 7,
      is_available: true, external_url: "https://example.org/guide" },
  };
}

function lessonSuggestion(id: number, historical: boolean, classId: number | null, available = true): SuggestionResponse {
  return {
    ...suggestion(id, historical, !historical),
    resource_type: "LESSON",
    title: historical ? "Earlier lesson" : "Current lesson",
    origin_class_id: historical ? 4 : 3,
    resource: {
      resource_type: "LESSON", title: "Nouns", subject_id: 7,
      lesson_id: available ? 40 : null, class_id: classId,
      is_available: available,
      unavailable_reason: available ? null : "Lesson resource is no longer available",
    },
  };
}

beforeEach(() => {
  api.list.mockReset().mockResolvedValue({ suggestions: [suggestion(1, false, true), suggestion(2, true, false)] });
  api.dismiss.mockReset().mockResolvedValue({});
  api.approve.mockReset();
  api.archive.mockReset();
});
afterEach(cleanup);

it("groups current and previous suggestions and gives only the creator management controls", async () => {
  render(<ManualSuggestionPanel classId={3} student={{ student_id: "student" } as TeacherAdvisoryStudentItem}
    subjectLoads={[]} />);
  fireEvent.click(await screen.findByRole("button", { name: /View History/ }));
  expect(screen.getByText("Current Period")).toBeTruthy();
  expect(screen.getByText("Previous Periods")).toBeTruthy();
  expect(screen.getByText("2025-2026 · Q1")).toBeTruthy();
  expect(screen.getByText("Read-only")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(1);
  expect(screen.getAllByRole("link", { name: "Open external resource" })).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  await waitFor(() => expect(api.dismiss).toHaveBeenCalledWith(1));
  expect(api.dismiss).not.toHaveBeenCalledWith(2);
});

it("uses the teacher empty state when no authorized suggestions exist", async () => {
  api.list.mockResolvedValue({ suggestions: [] });
  render(<ManualSuggestionPanel classId={3} student={{ student_id: "student" } as TeacherAdvisoryStudentItem}
    subjectLoads={[]} />);
  await waitFor(() => expect(api.list).toHaveBeenCalled());
  fireEvent.click(screen.getByRole("button", { name: /View History/ }));
  expect(await screen.findByText("No suggestions yet")).toBeTruthy();
});

it("makes history available from the compact student-page header", async () => {
  render(<ManualSuggestionPanel classId={3} student={{ student_id: "student" } as TeacherAdvisoryStudentItem}
    subjectLoads={[]} displayMode="header" />);
  fireEvent.click(await screen.findByRole("button", { name: /View History/ }));
  expect(screen.getByText("Previous Periods")).toBeTruthy();
  expect(screen.getByText("Read-only")).toBeTruthy();
});

it("opens current and historical lessons only at an authorized response destination", async () => {
  api.list.mockResolvedValue({ suggestions: [
    lessonSuggestion(1, false, 3), lessonSuggestion(2, true, 4),
  ] });
  render(<ManualSuggestionPanel classId={3} student={{ student_id: "student" } as TeacherAdvisoryStudentItem}
    subjectLoads={[]} />);
  fireEvent.click(await screen.findByRole("button", { name: /View History/ }));
  const links = screen.getAllByRole("link", { name: "Open lesson" });
  expect(links).toHaveLength(2);
  expect(links[0].getAttribute("href")).toBe("/teacher/classes/3/subjects/7?lessonId=40");
  expect(links[1].getAttribute("href")).toBe("/teacher/classes/4/subjects/7?lessonId=40");
  expect(screen.getByText("Read-only")).toBeTruthy();
  expect(screen.getAllByRole("button", { name: "Dismiss" })).toHaveLength(1);
});

it("shows inaccessible and missing historical lessons without a guessed class URL", async () => {
  api.list.mockResolvedValue({ suggestions: [
    lessonSuggestion(2, true, null), lessonSuggestion(3, true, null, false),
  ] });
  render(<ManualSuggestionPanel classId={3} student={{ student_id: "student" } as TeacherAdvisoryStudentItem}
    subjectLoads={[]} />);
  fireEvent.click(await screen.findByRole("button", { name: /View History/ }));
  expect(screen.queryByRole("link", { name: "Open lesson" })).toBeNull();
  expect(screen.getByText("Lesson is unavailable to open.")).toBeTruthy();
  expect(screen.getByText("Lesson resource is no longer available")).toBeTruthy();
  expect(screen.getAllByText("Read-only")).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Dismiss" })).toBeNull();
});

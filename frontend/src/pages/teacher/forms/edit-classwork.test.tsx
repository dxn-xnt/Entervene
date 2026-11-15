// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import type { TeacherClasswork } from "@/types/classwork";
import EditClassworkModal from "./edit-classwork";

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: api.fetch }));
vi.mock("@/components/retroui/Dialog", () => {
  const Root = ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div>{children}</div> : null;
  return {
    Dialog: Object.assign(Root, {
      Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      Header: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      Footer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    }),
  };
});
vi.mock("@/components/retroui/Select", async () => {
  const React = await import("react");
  const Selection = React.createContext<{ value: string; onValueChange: (value: string) => void }>({ value: "", onValueChange: () => {} });
  const Root = ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode }) =>
    <Selection.Provider value={{ value, onValueChange }}>{children}</Selection.Provider>;
  return {
    Select: Object.assign(Root, {
      Trigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      Value: ({ placeholder }: { placeholder?: string }) => <span>{React.useContext(Selection).value || placeholder}</span>,
      Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      Item: ({ value, children }: { value: string; children: React.ReactNode }) => {
        const selection = React.useContext(Selection);
        return <button type="button" onClick={() => selection.onValueChange(value)}>{children}</button>;
      },
    }),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("locks a remediation assessment to its assigned student instead of showing section checkboxes", async () => {
  const classwork = {
    classwork_id: 700,
    title: "Targeted remediation activity",
    description: "Practice activity",
    instructions: "Complete the targeted activity.",
    classwork_type: "ACTIVITY",
    classwork_category: "PERFORMANCE_TASK",
    total_points: 40,
    is_published: false,
    show_scores: true,
    is_locked: false,
    is_archived: false,
    subject_id: 5,
    subject_name: "Mathematics",
    attachments: [],
    reference_links: [{ classwork_reference_link_id: 1, url: "https://example.test/old", title: "Old", position: 0 }],
    linked_lessons: [],
    rubric_levels: [
      { level_name: "Complete", description: "Complete work", points: 40, display_order: 0 },
      { level_name: "Developing", description: "Developing work", points: 20, display_order: 1 },
    ],
    assignments: [{
      classwork_assignment_id: 701,
      classwork_id: 700,
      class_id: 7,
      title: "Demo Archimedes",
      is_published: false,
      show_scores: true,
      recipient_student_id: "student-10",
      recipient_student_name: "Alex Reyes",
      source_intervention_id: 10,
    }],
  } as TeacherClasswork;
  api.fetch.mockImplementation(async (path: string, options?: RequestInit) => {
    if (
      path === "/api/v1/classwork-assignments/classwork/700" &&
      (options?.method === "PUT" || options?.method === undefined)
    ) {
      return { ok: true, json: async () => classwork };
    }
    if (path === "/api/v1/classwork-assignments/classwork/700/assign" && options?.method === "POST") {
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => [] };
  });

  render(
    <EditClassworkModal
      classwork={classwork}
      isOpen
      onClose={vi.fn()}
      onSuccess={vi.fn()}
    />,
  );

  expect(await screen.findByText("Assigned student")).toBeTruthy();
  expect(screen.getByText("Alex Reyes")).toBeTruthy();
  expect(screen.getByText(/Automatically assigned only to this student through Intervention #10/)).toBeTruthy();
  expect(screen.queryByText("Assign to sections")).toBeNull();
  expect(screen.queryByRole("button", { name: /Select All/i })).toBeNull();
  expect(api.fetch.mock.calls.some(([path]) => path === "/api/v1/classwork-assignments/teacher/classes")).toBe(false);

  fireEvent.change(screen.getByRole("textbox", { name: "Reference link 1 URL" }), { target: { value: "https://example.test/new" } });
  fireEvent.change(screen.getByRole("textbox", { name: "Reference link 1 title" }), { target: { value: "New" } });

  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() => {
    const assignCall = api.fetch.mock.calls.find(
      ([path, options]) => path === "/api/v1/classwork-assignments/classwork/700/assign" && options?.method === "POST",
    );
    expect(assignCall).toBeTruthy();
    expect(JSON.parse(assignCall![1].body as string).class_ids).toEqual([7]);
  });
  const editCall = api.fetch.mock.calls.find(([path, options]) => path === "/api/v1/classwork-assignments/classwork/700" && options?.method === "PUT");
  expect(JSON.parse(editCall![1].body as string).reference_links).toEqual([{ url: "https://example.test/new", title: "New" }]);
});

function quizClasswork(showScores = false): TeacherClasswork {
  return {
    classwork_id: 800,
    title: "Unit Quiz",
    description: "Check understanding",
    instructions: "Answer all questions.",
    classwork_type: "QUIZ",
    classwork_category: "WRITTEN_WORK",
    total_points: 10,
    is_published: true,
    show_scores: showScores,
    is_locked: false,
    is_archived: false,
    subject_id: 5,
    subject_name: "Mathematics",
    attachments: [],
    reference_links: [],
    linked_lessons: [],
    assignments: [{
      classwork_assignment_id: 801,
      classwork_id: 800,
      class_id: 7,
      title: "Sapphire",
      due_date: "2026-11-20T12:00:00Z",
      max_attempts: 2,
      is_published: true,
      show_scores: showScores,
    }],
  } as TeacherClasswork;
}

it("loads quiz results settings and requires confirmation before enabling unified quiz results", async () => {
  const quiz = quizClasswork(false);
  const onSuccess = vi.fn();
  api.fetch.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === "/api/v1/quizzes/classwork/800" && !options?.method) {
      return {
        ok: true,
        json: async () => ({
          quiz_id: 90,
          classwork_id: 800,
          settings: {
            show_correct_answers: false,
            summary_release_mode: "AFTER_DUE_DATE",
            summary_release_at: null,
          },
          questions: [],
        }),
      };
    }
    if (path === "/api/v1/quizzes/classwork/800/results-settings" && options?.method === "PUT") {
      return {
        ok: true,
        json: async () => ({
          classwork_id: 800,
          show_scores: true,
          show_correct_answers: true,
          summary_release_mode: "AFTER_DUE_DATE",
          summary_release_at: null,
          has_mixed_visibility: false,
        }),
      };
    }
    if (path === "/api/v1/classwork-assignments/classwork/800" && !options?.method) {
      return { ok: true, json: async () => ({ ...quiz, show_scores: true }) };
    }
    if (path === "/api/v1/classwork-assignments/classwork/800" && options?.method === "PUT") {
      return { ok: true, json: async () => quiz };
    }
    if (path === "/api/v1/classwork-assignments/classwork/800/assign" && options?.method === "POST") {
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => [] };
  });

  render(<EditClassworkModal classwork={quiz} isOpen onClose={vi.fn()} onSuccess={onSuccess} />);

  const toggle = await screen.findByRole("switch", {
    name: "Show quiz results (scores and correct answers)",
  });
  await waitFor(() => expect(screen.getByText("Summary unlocks automatically after the due date.")).toBeTruthy());
  expect(screen.queryByText("Show scores to students")).toBeNull();

  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

  expect(await screen.findByText("Reveal Quiz Results?")).toBeTruthy();
  expect(api.fetch.mock.calls.some(([path]) => path === "/api/v1/quizzes/classwork/800/results-settings")).toBe(false);

  fireEvent.click(screen.getByRole("button", { name: "Confirm & Save" }));

  await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ show_scores: true })));
  const settingsCall = api.fetch.mock.calls.find(
    ([path, options]) => path === "/api/v1/quizzes/classwork/800/results-settings" && options?.method === "PUT",
  );
  expect(JSON.parse(settingsCall![1].body as string)).toEqual({
    show_quiz_results: true,
    summary_release_mode: "AFTER_DUE_DATE",
    summary_release_at: null,
    confirm_answer_reveal: true,
  });
  const classworkPut = api.fetch.mock.calls.find(
    ([path, options]) => path === "/api/v1/classwork-assignments/classwork/800" && options?.method === "PUT",
  );
  expect(JSON.parse(classworkPut![1].body as string).show_scores).toBeUndefined();
});

it("preserves mixed legacy quiz visibility when saving release mode without touching the unified switch", async () => {
  const quiz = quizClasswork(true);
  api.fetch.mockImplementation(async (path: string, options?: RequestInit) => {
    if (path === "/api/v1/quizzes/classwork/800" && !options?.method) {
      return {
        ok: true,
        json: async () => ({
          quiz_id: 90,
          classwork_id: 800,
          settings: {
            show_correct_answers: false,
            summary_release_mode: "IMMEDIATE",
            summary_release_at: null,
          },
          questions: [],
        }),
      };
    }
    if (path === "/api/v1/quizzes/classwork/800/results-settings" && options?.method === "PUT") {
      return {
        ok: true,
        json: async () => ({
          classwork_id: 800,
          show_scores: true,
          show_correct_answers: false,
          summary_release_mode: "NEVER",
          summary_release_at: null,
          has_mixed_visibility: true,
        }),
      };
    }
    if (path === "/api/v1/classwork-assignments/classwork/800") {
      return { ok: true, json: async () => quiz };
    }
    if (path === "/api/v1/classwork-assignments/classwork/800/assign" && options?.method === "POST") {
      return { ok: true, json: async () => ({}) };
    }
    return { ok: true, json: async () => [] };
  });

  render(<EditClassworkModal classwork={quiz} isOpen onClose={vi.fn()} onSuccess={vi.fn()} />);

  expect(await screen.findByText(/Current setting is mixed/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Never" }));
  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

  await waitFor(() => {
    const settingsCall = api.fetch.mock.calls.find(
      ([path, options]) => path === "/api/v1/quizzes/classwork/800/results-settings" && options?.method === "PUT",
    );
    expect(settingsCall).toBeTruthy();
    expect(JSON.parse(settingsCall![1].body as string)).toEqual({
      show_quiz_results: null,
      summary_release_mode: "NEVER",
      summary_release_at: null,
      confirm_answer_reveal: false,
    });
  });
});

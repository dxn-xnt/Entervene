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

  fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
  await waitFor(() => {
    const assignCall = api.fetch.mock.calls.find(
      ([path, options]) => path === "/api/v1/classwork-assignments/classwork/700/assign" && options?.method === "POST",
    );
    expect(assignCall).toBeTruthy();
    expect(JSON.parse(assignCall![1].body as string).class_ids).toEqual([7]);
  });
});

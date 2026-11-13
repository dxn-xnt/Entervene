// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SuggestionPanel } from "./suggestion-panel-modal";
import type { TeacherAdvisoryStudentItem, TeacherAdvisorySubjectLoadItem } from "@/types/adminClasses";

const mocks = vi.hoisted(() => ({
  create: vi.fn(), apiFetch: vi.fn(), success: vi.fn(),
}));

vi.mock("@/lib/suggestion-api", () => ({
  createManualSuggestion: mocks.create,
  generateRecommendationDrafts: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.apiFetch }));
vi.mock("@/components/retroui/Toast", () => ({ useToast: () => ({ success: mocks.success }) }));
vi.mock("@/components/retroui/Dialog", () => {
  function Dialog({ open, children }: { open: boolean; children: React.ReactNode }) {
    return open ? <div>{children}</div> : null;
  }
  Dialog.Content = ({ children }: { children: React.ReactNode }) => <div>{children}</div>;
  Dialog.Header = ({ children }: { children: React.ReactNode }) => <header>{children}</header>;
  Dialog.Footer = ({ children }: { children: React.ReactNode }) => <footer>{children}</footer>;
  Dialog.Description = ({ children }: { children: React.ReactNode }) => <p>{children}</p>;
  return { Dialog };
});
vi.mock("@/components/retroui/Select", () => {
  function find(element: React.ReactNode, name: string): React.ReactElement[] {
    return React.Children.toArray(element).flatMap((child) => {
      if (!React.isValidElement(child)) return [];
      return [...(child.type === name ? [child] : []), ...find((child.props as { children?: React.ReactNode }).children, name)];
    });
  }
  function Select({ children, value, onValueChange, disabled }: { children: React.ReactNode; value: string; onValueChange: (value: string) => void; disabled?: boolean }) {
    return <select value={value} disabled={disabled} onChange={(event) => onValueChange(event.target.value)}>
      {find(children, "item").map((item) => <option key={(item.props as { value: string }).value} value={(item.props as { value: string }).value}>{(item.props as { children: React.ReactNode }).children}</option>)}
    </select>;
  }
  Select.Trigger = "trigger";
  Select.Value = "value";
  Select.Content = "content";
  Select.Group = "group";
  Select.Item = "item";
  return { Select };
});

const student = { student_id: "student-one", full_name: "Student One" } as TeacherAdvisoryStudentItem;
const subjectLoads = [{ subject_load_id: 1, subject_id: 7, subject_name: "English" }] as TeacherAdvisorySubjectLoadItem[];

beforeEach(() => {
  mocks.create.mockReset().mockResolvedValue({});
  mocks.apiFetch.mockReset().mockResolvedValue({ ok: true, json: async () => [{ classwork_assignment_id: 9, classwork_id: 4, title: "Reading", classwork_type: "READING", is_published: true }] });
  mocks.success.mockReset();
});
afterEach(cleanup);

function show() {
  return render(<SuggestionPanel open classId={3} student={student} subjectLoads={subjectLoads} />);
}

it("creates a LINK with URL, title and guidance without loading or selecting internal resources", async () => {
  show();
  expect(screen.getByText("Link")).toBeTruthy();
  fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "LINK" } });
  expect(screen.queryByText("Resource")).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: /External URL/ }), { target: { value: "https://example.org/guide" } });
  fireEvent.change(screen.getByRole("textbox", { name: /Title/ }), { target: { value: "Study guide" } });
  fireEvent.change(screen.getByRole("textbox", { name: /Reason/ }), { target: { value: "Review this." } });
  fireEvent.click(screen.getByRole("button", { name: /Send Suggestion/ }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  expect(mocks.create.mock.calls[0][0]).toMatchObject({ resource_type: "LINK", external_url: "https://example.org/guide", title: "Study guide", description: "Review this.", subject_id: 7, student_id: "student-one" });
  expect(mocks.create.mock.calls[0][0]).not.toHaveProperty("lesson_id");
  expect(mocks.create.mock.calls[0][0]).not.toHaveProperty("classwork_assignment_id");
});

it("shows invalid URL feedback and keeps the classwork payload unchanged", async () => {
  show();
  fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "LINK" } });
  fireEvent.change(screen.getByRole("textbox", { name: /External URL/ }), { target: { value: "javascript:alert(1)" } });
  fireEvent.change(screen.getByRole("textbox", { name: /Title/ }), { target: { value: "Study guide" } });
  fireEvent.click(screen.getByRole("button", { name: /Send Suggestion/ }));
  expect(screen.getByText(/HTTP or HTTPS/)).toBeTruthy();
  expect(mocks.create).not.toHaveBeenCalled();

  fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "CLASSWORK" } });
  await waitFor(() => expect(screen.getByText(/Reading - READING/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /Send Suggestion/ }));
  await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
  expect(mocks.create.mock.calls[0][0]).toMatchObject({ resource_type: "CLASSWORK", classwork_assignment_id: 9, lesson_id: null });
  expect(mocks.create.mock.calls[0][0]).not.toHaveProperty("external_url");
});

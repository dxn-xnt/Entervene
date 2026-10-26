// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CreateClassworkModal from "./create-classwork";

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: api.fetch }));
vi.mock("@/components/retroui/Dialog", () => ({
  dialogHeaderCloseButtonClassName: "",
  Dialog: {
    Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Header: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Footer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  },
}));
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

it("renders teacher guidance, displays supporting readings, marks upload optional, and cleans Step 2 recipient layout", async () => {
  api.fetch.mockImplementation(async (path: string) => {
    if (path.includes("/lessons/my-class/")) {
      return {
        ok: true,
        json: async () => [
          { lesson_id: 10, title: "Algebra Basics", subject_id: 5, is_published: true, is_draft: false, show_scores: true },
        ],
      };
    }
    return { ok: true, json: async () => ({}) };
  });

  const onSuccess = vi.fn();
  const target = {
    assignment_id: 101,
    classwork_id: 55,
    title: "Original Seatwork 1",
    component: "WRITTEN_WORK" as const,
    original_score: 5,
    max_points: 20,
    percent: 25,
    is_recommended: true,
  };

  const readingRef = {
    kind: "CLASSWORK" as const,
    id: 99,
    title: "Algebra Foundation Reading",
    classwork_type: "READING",
    is_graded: false,
    recommended: true,
  };

  render(
    <CreateClassworkModal
      selectedType="ASSIGNMENT"
      subjects={[{ id: 5, name: "Mathematics" }]}
      loads={[{ subject_load_id: 1, subject_id: 5, subject_name: "Mathematics", class_id: 7, section_name: "Sapphire", academic_period_id: 1 }]}
      initialSubjectId="5"
      initialLessonId={10}
      initialTitle="Remedial Seatwork 1"
      initialInstructions="Please review the referenced reading materials and complete the tasks described in this activity."
      remediationDraft={true}
      remediationTarget={{
        intervention_id: 42,
        student_id: "s-101",
        student_name: "Juan Dela Cruz",
        class_id: 7,
        class_name: "Sapphire",
        subject_id: 5,
        subject_name: "Mathematics",
        status: "ACTIVE",
      } as any}
      remediationFocus={{
        component: "WRITTEN_WORK",
        evidence_level: "SCORED_COMPETENCY",
        competencies: [{ code: "M9-01", label: "Linear Equations", score: 5, possible_score: 20 }],
        lesson_ids: [10],
      } as any}
      remediationGradeTreatment="WRITTEN_WORK"
      remediationOriginalTargets={[target]}
      initialTargetAssignmentId={101}
      remediationReferences={[readingRef]}
      onClose={vi.fn()}
      onSuccess={onSuccess}
      onBack={vi.fn()}
    />
  );

  // Wait for lessons to load
  await screen.findByText("Algebra Basics");

  // 1. Teacher Remediation Guidance banner matches unified RetroUI theme
  const banner = screen.getByTestId("remediation-teacher-guidance-banner");
  expect(within(banner).getByText("Teacher only · Individual support")).toBeTruthy();
  expect(within(banner).getByText("Juan Dela Cruz")).toBeTruthy();
  expect(within(banner).getByText("Sapphire")).toBeTruthy();
  expect(within(banner).getByText("LINKED ORIGINAL")).toBeTruthy();
  expect(within(banner).getByText("Original Seatwork 1")).toBeTruthy();
  expect(within(banner).getByText(/5\/20 pts/)).toBeTruthy();
  expect(within(banner).getByText("THIS TASK")).toBeTruthy();
  expect(within(banner).getByText("Exactly 20 pts")).toBeTruthy();
  expect(within(banner).getByText(/adjusts grade within plan cap/)).toBeTruthy();

  // 2. Selected Supporting Readings from plan are displayed as linked boxes
  expect(within(banner).getByText("READING MATERIALS ALREADY LINKED TO STUDENT")).toBeTruthy();
  expect(within(banner).getByText("Algebra Foundation Reading")).toBeTruthy();

  // 3. Collapsible Diagnostic Focus accordion
  expect(within(banner).getByRole("button", { name: "Show diagnostic focus ▾" })).toBeTruthy();
  expect(within(banner).queryByText(/Linear Equations/)).toBeNull();
  fireEvent.click(within(banner).getByRole("button", { name: "Show diagnostic focus ▾" }));
  expect(within(banner).getByRole("button", { name: "Hide diagnostic focus ▴" })).toBeTruthy();
  expect(within(banner).getByText(/Linear Equations/)).toBeTruthy();

  // 4. Upload Material is clearly marked Optional
  expect(screen.getByText("Upload Material (Optional)")).toBeTruthy();
  expect(screen.getByText(/No Additional Files Attached/i)).toBeTruthy();
  expect(screen.getByText(/Attach Optional Files/i)).toBeTruthy();

  // 5. Student Instructions field has dedicated student guidance label
  expect(screen.getByText(/Student Instructions \(Visible to student\):/i)).toBeTruthy();
  const instructionsArea = screen.getByPlaceholderText("What students need to read, answer, or submit") as HTMLTextAreaElement;
  expect(instructionsArea.value).toBe("Please review the referenced reading materials and complete the tasks described in this activity.");

  // Step 1 -> Step 2
  fireEvent.click(screen.getByRole("button", { name: "Next" }));

  // 6. Step 2 Assign to sections: clean Single-Student Remedial Assignment card
  expect(screen.getByText("Single-Student Remedial Assignment")).toBeTruthy();
  expect(screen.getByText("Individual Recipient")).toBeTruthy();
  expect(screen.getByText(/This activity is exclusively assigned to/i)).toBeTruthy();
  expect(screen.getByText(/Other students will not receive or see this assignment/i)).toBeTruthy();
  // "Select all" button is NOT rendered in remediation mode
  expect(screen.queryByRole("button", { name: "Select all" })).toBeNull();

  // Assign
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));

  await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  const call = api.fetch.mock.calls.find(([path, options]) => path === "/api/v1/classwork-assignments/with-assignments" && options?.method === "POST");
  expect(call).toBeTruthy();
  const form = call![1].body as FormData;
  expect(form.get("classwork_category")).toBe("WRITTEN_WORK");
  expect(form.get("original_classwork_assignment_id")).toBe("101");
  expect(form.get("intervention_id")).toBe("42");
  expect(form.get("total_points")).toBe("20");
});

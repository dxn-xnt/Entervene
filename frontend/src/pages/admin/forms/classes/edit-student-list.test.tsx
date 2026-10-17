// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import EditStudentList from "./edit-student-list";

vi.mock("@/components/retroui/Dialog", () => {
  const Container = ({ children }: { children: ReactNode }) => <div>{children}</div>;
  return { Dialog: Object.assign(Container, { Content: Container, Header: Container, Footer: Container }) };
});
vi.mock("./existing-class-distribution", () => ({ default: () => <div>Distribution dialog opened</div> }));

afterEach(cleanup);

it("keeps individual Add and Save while blocking distribution with unsaved manual changes", () => {
  render(<EditStudentList
    currentSectionId={19} currentSectionName="Del Mundo" academicLevel="Grade 12" academicYear="2025-2026"
    requiresPathway={false} students={[]} availableSections={[{ class_id: 20, section_name: "Reyes" }]}
    availableStudents={[{
      student_id: "student-1", student_lrn: "123456789012", first_name: "Ada", middle_name: null,
      last_name: "Student", gender: "Female", academic_level_id: 6,
    }]}
    onSaveChanges={vi.fn().mockResolvedValue(undefined)} onDistributionCommitted={vi.fn().mockResolvedValue(undefined)} onClose={vi.fn()}
  />);
  const distribute = screen.getByRole("button", { name: "Assign Evenly" }) as HTMLButtonElement;
  expect(distribute.disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
  expect(distribute.disabled).toBe(true);
  expect(screen.getByText(/Save or discard pending manual changes/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Save Changes" }) as HTMLButtonElement).disabled).toBe(false);
});

it("groups unassigned students by gender and sorts surnames alphabetically within each group", () => {
  const availableStudents = [
    ["1", "Zeta", "Male"], ["2", "Bravo", "Female"],
    ["3", "Alpha", "Male"], ["4", "Able", "Female"],
    ["5", "Other", "Unspecified"],
  ].map(([student_id, last_name, gender]) => ({
    student_id, last_name, gender, first_name: "Student", middle_name: null,
    student_lrn: `00000000000${student_id}`, academic_level_id: 6,
  }));
  render(<EditStudentList
    currentSectionId={19} currentSectionName="Del Mundo" academicLevel="Grade 12" academicYear="2025-2026"
    requiresPathway={false} students={[]} availableSections={[{ class_id: 20, section_name: "Reyes" }]}
    availableStudents={availableStudents}
    onSaveChanges={vi.fn()} onDistributionCommitted={vi.fn()} onClose={vi.fn()}
  />);

  expect(within(screen.getByRole("region", { name: "Male students" })).getAllByText(/, Student/)
    .map((element) => element.textContent)).toEqual(["Alpha, Student", "Zeta, Student"]);
  expect(within(screen.getByRole("region", { name: "Female students" })).getAllByText(/, Student/)
    .map((element) => element.textContent)).toEqual(["Able, Student", "Bravo, Student"]);
  expect(screen.getByText("Male (2)")).toBeTruthy();
  expect(screen.getByText("Female (2)")).toBeTruthy();
  expect(screen.getByText("Unspecified (1)")).toBeTruthy();

  fireEvent.change(screen.getByPlaceholderText("Search available students..."), { target: { value: "Bravo" } });
  expect(screen.getByText("Male (0)")).toBeTruthy();
  expect(screen.getByText("Female (1)")).toBeTruthy();
});

it("displays compact layout for empty enrolled roster and allows switching to unassigned tab", () => {
  render(<EditStudentList
    currentSectionId={19} currentSectionName="Campos" academicLevel="Grade 11" academicYear="2025-2026"
    requiresPathway={false} students={[]} availableSections={[]}
    availableStudents={[{
      student_id: "s-1", student_lrn: "111111111111", first_name: "John", middle_name: null,
      last_name: "Doe", gender: "Male", academic_level_id: 5,
    }]}
    onSaveChanges={vi.fn()} onDistributionCommitted={vi.fn()} onClose={vi.fn()}
  />);

  // Initial tab when class has 0 enrolled students defaults to Unassigned Students
  expect(screen.getByText("Doe, John")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add" })).toBeTruthy();

  // Switch to Enrolled Students tab (displays compact empty state)
  fireEvent.click(screen.getByRole("tab", { name: /Enrolled Students/i }));
  expect(screen.getByText("No enrolled students in this section.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Save Changes" })).toBeTruthy();

  // Switch back to Unassigned Students tab
  fireEvent.click(screen.getByRole("tab", { name: /Unassigned Students/i }));
  expect(screen.getByText("Doe, John")).toBeTruthy();
});

it("displays small 2-student enrolled roster compactly and supports search and Select Multiple toggle", () => {
  const enrolled = [
    { student_id: "e-1", full_name: "Santos, Maria", gender: "Female", avatar_initial: "M", account_status: "active" },
    { student_id: "e-2", full_name: "Cruz, Juan", gender: "Male", avatar_initial: "J", account_status: "active" },
  ];

  render(<EditStudentList
    currentSectionId={19} currentSectionName="Campos" academicLevel="Grade 11" academicYear="2025-2026"
    requiresPathway={false} students={enrolled} availableSections={[{ class_id: 20, section_name: "Reyes" }]}
    availableStudents={[]}
    onSaveChanges={vi.fn()} onDistributionCommitted={vi.fn()} onClose={vi.fn()}
  />);

  expect(screen.getByText("Santos, Maria")).toBeTruthy();
  expect(screen.getByText("Cruz, Juan")).toBeTruthy();
  expect(screen.getByText("Female (1)")).toBeTruthy();
  expect(screen.getByText("Male (1)")).toBeTruthy();

  // Search enrolled students
  fireEvent.change(screen.getByPlaceholderText("Search enrolled students..."), { target: { value: "Maria" } });
  expect(screen.getByText("Santos, Maria")).toBeTruthy();
  expect(screen.queryByText("Cruz, Juan")).toBeNull();

  // Clear search
  fireEvent.change(screen.getByPlaceholderText("Search enrolled students..."), { target: { value: "" } });
  expect(screen.getByText("Santos, Maria")).toBeTruthy();
  expect(screen.getByText("Cruz, Juan")).toBeTruthy();

  // Toggle Select Multiple
  const selectMultiBtn = screen.getByRole("button", { name: "Select Multiple" });
  fireEvent.click(selectMultiBtn);
  expect(screen.getByRole("button", { name: "Cancel Selection" })).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Cancel Selection" }));
  expect(screen.getByRole("button", { name: "Select Multiple" })).toBeTruthy();
});

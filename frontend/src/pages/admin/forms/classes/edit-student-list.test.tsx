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

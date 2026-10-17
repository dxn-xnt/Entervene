// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ManualClassSetup } from "@/types/adminClasses";
import ManualClassWizard from "./manual-class-wizard";

const getClassFormOptions = vi.hoisted(() => vi.fn());
const fetchPathways = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ getClassFormOptions, fetchPathways }));
vi.mock("@/components/retroui/Select", () => {
  const Select = ({ children, value, onValueChange, onChange }: {
    children: ReactNode; value: string; onValueChange?: (value: string) => void;
    onChange?: (event: { target: { value: string } }) => void;
  }) => <select value={value} onChange={(event) => {
    onValueChange?.(event.target.value);
    onChange?.({ target: { value: event.target.value } });
  }}><option value="">Select</option>{children}</select>;
  const Container = ({ children }: { children: ReactNode }) => <>{children}</>;
  return { Select: Object.assign(Select, {
    Trigger: Container, Value: () => null, Content: Container, Group: Container,
    Item: ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option>,
  }) };
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("reviews a valid class without loading or assigning students", async () => {
  const setup: ManualClassSetup = {
    academicLevelId: 6,
    academicLevelName: "Grade 12",
    academicYear: { academic_year_id: 1, year_label: "2025-2026" },
    sections: [{ localId: "section-1", sectionName: "Del Mundo", adviserStaffId: "T-1", pathway: "general" }],
  };
  getClassFormOptions.mockResolvedValue({
    academic_year: setup.academicYear,
    academic_levels: [{ academic_level_id: 6, level_name: "Grade 12", grade_level: 12, requires_pathway: false }],
    eligible_advisers: [{ staff_id: "T-1", first_name: "Ada", middle_name: null, last_name: "Lovelace", suffix: null }],
    official_sections: [{ id: 1, academic_year_id: 1, academic_level_id: 6, section_name: "Del Mundo", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: false }],
  });
  fetchPathways.mockResolvedValue({ pathways: [] });
  const onSkipStudents = vi.fn();
  render(<ManualClassWizard initialSetup={setup} onComplete={vi.fn()} onSkipStudents={onSkipStudents} onBack={vi.fn()} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Review without Students" })).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: "Review without Students" }));
  expect(onSkipStudents).toHaveBeenCalledWith({
    ...setup,
    sections: [{ ...setup.sections[0], adviserName: "Ada Lovelace" }],
  });
});

it("filters official sections by grade and clears the old section on a grade change", async () => {
  const names = [
    ["Aristotle", "Galileo"], ["Newton", "Plato"], ["Archimedes", "Copernicus"],
    ["Einstein", "Socrates"], ["Campos", "Zara"], ["Del Mundo", "Reyes"],
  ];
  getClassFormOptions.mockResolvedValue({
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_years: [{ academic_year_id: 1, year_label: "2025-2026" }],
    academic_levels: names.map((_, index) => ({ academic_level_id: index + 1, level_name: `Grade ${index + 7}`, grade_level: index + 7, requires_pathway: index === 4 })),
    eligible_advisers: [{ staff_id: "T-1", first_name: "Ada", middle_name: null, last_name: "Lovelace", suffix: null }],
    official_sections: names.flatMap((pair, index) => pair.map((section_name, number) => ({
      id: index * 2 + number + 1, academic_year_id: 1, academic_level_id: index + 1,
      section_name, pathway_id: index === 4 ? number + 1 : null,
      pathway_name: index === 4 ? section_name : null,
      pathway_code: index === 4 ? section_name.toLowerCase() : null,
      is_active: true, has_class: false,
    }))),
  });
  render(<ManualClassWizard initialSetup={null} onComplete={vi.fn()} onSkipStudents={vi.fn()} onBack={vi.fn()} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getAllByRole("combobox").length).toBeGreaterThanOrEqual(3));
  for (let index = 0; index < names.length; index += 1) {
    const gradeSelect = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    fireEvent.change(gradeSelect, { target: { value: String(index + 1) } });
    const sectionSelect = screen.getAllByRole("combobox")[2] as HTMLSelectElement;
    expect(within(sectionSelect).getAllByRole("option").slice(1).map((option) => (option as HTMLOptionElement).value)).toEqual(names[index]);
    if (index === 0) fireEvent.change(sectionSelect, { target: { value: "Aristotle" } });
    if (index === 1) expect(sectionSelect.value).toBe("");
  }
});

it("adds Reyes after Del Mundo and prevents a third Grade 12 section", async () => {
  const year = { academic_year_id: 1, year_label: "2025-2026" };
  const setup: ManualClassSetup = {
    academicLevelId: 6, academicLevelName: "Grade 12", academicYear: year,
    sections: [{ localId: "first", sectionName: "Del Mundo", adviserStaffId: "T-1", pathway: "general" }],
  };
  getClassFormOptions.mockResolvedValue({
    academic_year: year,
    academic_levels: [{ academic_level_id: 6, level_name: "Grade 12", grade_level: 12, requires_pathway: false }],
    eligible_advisers: [{ staff_id: "T-1", first_name: "Ada", last_name: "Lovelace" }, { staff_id: "T-2", first_name: "Grace", last_name: "Hopper" }],
    official_sections: ["Del Mundo", "Reyes"].map((section_name, index) => ({
      id: index + 1, academic_year_id: 1, academic_level_id: 6, section_name,
      pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: false,
    })),
  });
  render(<ManualClassWizard initialSetup={setup} onComplete={vi.fn()} onSkipStudents={vi.fn()} onBack={vi.fn()} onClose={vi.fn()} />);
  const addButton = await screen.findByRole("button", { name: "Add Another Section" });
  fireEvent.click(addButton);

  const sectionSelects = [screen.getAllByRole("combobox")[2], screen.getAllByRole("combobox")[4]] as HTMLSelectElement[];
  expect(sectionSelects.map((select) => select.value)).toEqual(["Del Mundo", "Reyes"]);
  expect(within(sectionSelects[0]).getAllByRole("option").slice(1).map((option) => (option as HTMLOptionElement).value)).toEqual(["Del Mundo"]);
  expect(within(sectionSelects[1]).getAllByRole("option").slice(1).map((option) => (option as HTMLOptionElement).value)).toEqual(["Reyes"]);
  expect((screen.getByRole("button", { name: "All Available Sections Added" }) as HTMLButtonElement).disabled).toBe(true);
});

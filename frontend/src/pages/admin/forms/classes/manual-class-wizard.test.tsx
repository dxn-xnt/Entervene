// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ManualClassSetup } from "@/types/adminClasses";
import ManualClassWizard from "./manual-class-wizard";

const getClassFormOptions = vi.hoisted(() => vi.fn());
const fetchPathways = vi.hoisted(() => vi.fn());
const deleteOfficialSection = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api", () => ({ getClassFormOptions, fetchPathways, deleteOfficialSection }));
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

it("displays existing sections for selected grade level as read-only and deletes with confirmation dialog", async () => {
  const year = { academic_year_id: 1, year_label: "2025-2026" };
  deleteOfficialSection.mockResolvedValue({ action: "deleted", message: "Section deleted" });
  getClassFormOptions.mockResolvedValue({
    academic_year: year,
    academic_levels: [{ academic_level_id: 1, level_name: "Grade 7", grade_level: 7, requires_pathway: false }],
    eligible_advisers: [{ staff_id: "T-1", first_name: "Ada", last_name: "Lovelace" }],
    official_sections: [
      { id: 101, academic_year_id: 1, academic_level_id: 1, section_name: "Aristotle", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: true },
      { id: 102, academic_year_id: 1, academic_level_id: 1, section_name: "Galileo", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: true },
    ],
  });
  fetchPathways.mockResolvedValue({ pathways: [] });

  render(<ManualClassWizard initialSetup={null} onComplete={vi.fn()} onSkipStudents={vi.fn()} onBack={vi.fn()} onClose={vi.fn()} />);

  // Existing sections displayed on Sections & Advisers
  await waitFor(() => {
    expect(screen.getByText("Sections & Advisers")).toBeTruthy();
    expect(screen.getByDisplayValue("Aristotle")).toBeTruthy();
    expect(screen.getByDisplayValue("Galileo")).toBeTruthy();
  });

  // Click delete on Galileo
  const deleteGalileoBtn = screen.getByRole("button", { name: "Delete Galileo" });
  fireEvent.click(deleteGalileoBtn);

  // Confirmation dialog opens
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "Delete Section" })).toBeTruthy();
  expect(within(dialog).getByText(/Are you sure you want to delete section/i)).toBeTruthy();

  // Click Delete Section inside confirmation dialog
  const confirmDeleteBtn = within(dialog).getByRole("button", { name: "Delete Section" });
  fireEvent.click(confirmDeleteBtn);

  await waitFor(() => {
    expect(deleteOfficialSection).toHaveBeenCalledWith(102);
  });
});

it("allows typing section name into input and adding additional sections", async () => {
  const year = { academic_year_id: 1, year_label: "2025-2026" };
  getClassFormOptions.mockResolvedValue({
    academic_year: year,
    academic_levels: [{ academic_level_id: 1, level_name: "Grade 7", grade_level: 7, requires_pathway: false }],
    eligible_advisers: [
      { staff_id: "T-1", first_name: "Ada", last_name: "Lovelace" },
      { staff_id: "T-2", first_name: "Grace", last_name: "Hopper" },
    ],
    official_sections: [],
  });
  fetchPathways.mockResolvedValue({ pathways: [] });
  const onSkipStudents = vi.fn();

  render(<ManualClassWizard initialSetup={null} onComplete={vi.fn()} onSkipStudents={onSkipStudents} onBack={vi.fn()} onClose={vi.fn()} />);

  await waitFor(() => expect(screen.getByPlaceholderText("e.g. Diamond, Archimedes")).toBeTruthy());

  // Type section name in input
  const firstInput = screen.getByPlaceholderText("e.g. Diamond, Archimedes");
  fireEvent.change(firstInput, { target: { value: "Newton" } });

  // Select adviser for first section
  const adviserSelects = screen.getAllByRole("combobox");
  // Index 0: Year, 1: Level, 2: Adviser
  fireEvent.change(adviserSelects[2], { target: { value: "T-1" } });

  // Add another section
  const addButton = screen.getByRole("button", { name: "Add Another Section" });
  fireEvent.click(addButton);

  // Second row appears
  await waitFor(() => {
    const inputs = screen.getAllByPlaceholderText("e.g. Diamond, Archimedes");
    expect(inputs.length).toBe(2);
  });

  const inputs = screen.getAllByPlaceholderText("e.g. Diamond, Archimedes");
  fireEvent.change(inputs[1], { target: { value: "Plato" } });

  const updatedAdviserSelects = screen.getAllByRole("combobox");
  // Index 3 is the second row adviser
  fireEvent.change(updatedAdviserSelects[3], { target: { value: "T-2" } });

  // Submit
  fireEvent.click(screen.getByRole("button", { name: "Review without Students" }));

  expect(onSkipStudents).toHaveBeenCalledWith(expect.objectContaining({
    sections: [
      expect.objectContaining({ sectionName: "Newton", adviserStaffId: "T-1", adviserName: "Ada Lovelace" }),
      expect.objectContaining({ sectionName: "Plato", adviserStaffId: "T-2", adviserName: "Grace Hopper" }),
    ],
  }));
});

it("prevents duplicate section names within the same grade or against existing classes", async () => {
  const year = { academic_year_id: 1, year_label: "2025-2026" };
  getClassFormOptions.mockResolvedValue({
    academic_year: year,
    academic_levels: [{ academic_level_id: 1, level_name: "Grade 7", grade_level: 7, requires_pathway: false }],
    eligible_advisers: [{ staff_id: "T-1", first_name: "Ada", last_name: "Lovelace" }],
    official_sections: [
      { id: 1, academic_year_id: 1, academic_level_id: 1, section_name: "Aristotle", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: true },
    ],
  });
  fetchPathways.mockResolvedValue({ pathways: [] });

  render(<ManualClassWizard initialSetup={null} onComplete={vi.fn()} onSkipStudents={vi.fn()} onBack={vi.fn()} onClose={vi.fn()} />);

  await waitFor(() => expect(screen.getByPlaceholderText("e.g. Diamond, Archimedes")).toBeTruthy());

  // Try to create a section with an existing class name
  const input = screen.getByPlaceholderText("e.g. Diamond, Archimedes");
  fireEvent.change(input, { target: { value: "Aristotle" } });

  // Select adviser
  const adviserSelect = screen.getAllByRole("combobox")[2];
  fireEvent.change(adviserSelect, { target: { value: "T-1" } });

  // Click review
  fireEvent.click(screen.getByRole("button", { name: "Review without Students" }));

  // Validation error shown
  expect(await screen.findByText(/A class with section name "Aristotle" already exists for this grade\./i)).toBeTruthy();
});

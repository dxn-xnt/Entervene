// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ManualClassSetup } from "@/types/adminClasses";
import ManualClassWizard from "./manual-class-wizard";

const getClassFormOptions = vi.hoisted(() => vi.fn());
const fetchPathways = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", () => ({ useNavigate: () => navigate }));
vi.mock("@/lib/api", () => ({ getClassFormOptions, fetchPathways }));
vi.mock("@/pages/admin/official-sections-settings", () => ({
  default: () => <div>Official sections manager</div>,
}));
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
    sections: [{ ...setup.sections[0], officialSectionId: 1, adviserName: "Ada Lovelace" }],
  });
});

it("separates configured sections from existing classes and adds a configured section with an adviser", async () => {
  const year = { academic_year_id: 1, year_label: "2025-2026" };
  getClassFormOptions.mockResolvedValue({
    academic_year: year,
    academic_levels: [{ academic_level_id: 1, level_name: "Grade 7", grade_level: 7, requires_pathway: false }],
    eligible_advisers: [
      { staff_id: "T-1", first_name: "Ada", last_name: "Lovelace" },
      { staff_id: "T-2", first_name: "Grace", last_name: "Hopper" },
    ],
    official_sections: [
      { id: 101, academic_year_id: 1, academic_level_id: 1, section_name: "Aristotle", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: true, class_id: 44, adviser_name: "Ada Lovelace" },
      { id: 102, academic_year_id: 1, academic_level_id: 1, section_name: "Galileo", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: false },
    ],
  });
  fetchPathways.mockResolvedValue({ pathways: [] });

  render(<ManualClassWizard initialSetup={null} onComplete={vi.fn()} onSkipStudents={vi.fn()} onBack={vi.fn()} onClose={vi.fn()} />);

  await waitFor(() => {
    expect(screen.getByText("Available configured sections")).toBeTruthy();
    expect(screen.getByText("Existing classes")).toBeTruthy();
    expect(screen.getByText("Galileo")).toBeTruthy();
    expect(screen.getByText("Aristotle")).toBeTruthy();
  });

  expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  fireEvent.change(screen.getAllByRole("combobox")[2], { target: { value: "T-2" } });
  fireEvent.click(screen.getByRole("button", { name: "Add section" }));
  await waitFor(() => expect(screen.getByDisplayValue("Galileo")).toBeTruthy());
  expect((screen.getByDisplayValue("Galileo") as HTMLInputElement).disabled).toBe(true);
});

it("navigates from an in-use section to class management", async () => {
  const onClose = vi.fn();
  getClassFormOptions.mockResolvedValue({
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_levels: [{ academic_level_id: 1, level_name: "Grade 7", grade_level: 7, requires_pathway: false }],
    eligible_advisers: [{ staff_id: "T-1", first_name: "Ada", last_name: "Lovelace" }],
    official_sections: [{ id: 101, academic_year_id: 1, academic_level_id: 1, section_name: "Aristotle", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: true, class_id: 44 }],
  });
  fetchPathways.mockResolvedValue({ pathways: [] });

  render(<ManualClassWizard initialSetup={null} onComplete={vi.fn()} onSkipStudents={vi.fn()} onBack={vi.fn()} onClose={onClose} />);
  fireEvent.click(await screen.findByRole("button", { name: "Manage Class" }));

  expect(onClose).toHaveBeenCalledOnce();
  expect(navigate).toHaveBeenCalledWith("/admin/classes/44?tab=students&action=manage-students");
});

it("shows inline validation before adding a configured section without an adviser", async () => {
  getClassFormOptions.mockResolvedValue({
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_levels: [{ academic_level_id: 1, level_name: "Grade 7", grade_level: 7, requires_pathway: false }],
    eligible_advisers: [{ staff_id: "T-1", first_name: "Ada", last_name: "Lovelace" }],
    official_sections: [{ id: 102, academic_year_id: 1, academic_level_id: 1, section_name: "Galileo", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: false }],
  });
  fetchPathways.mockResolvedValue({ pathways: [] });

  render(<ManualClassWizard initialSetup={null} onComplete={vi.fn()} onSkipStudents={vi.fn()} onBack={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Add section" }));
  expect(await screen.findByText("Select an adviser before adding this section.")).toBeTruthy();
});

it("manages official sections inside the class wizard and preserves the class draft on return", async () => {
  const options = {
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_levels: [{ academic_level_id: 1, level_name: "Grade 7", grade_level: 7, requires_pathway: false }],
    eligible_advisers: [{ staff_id: "T-1", first_name: "Ada", last_name: "Lovelace" }],
    official_sections: [{ id: 102, academic_year_id: 1, academic_level_id: 1, section_name: "Galileo", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: false }],
  };
  getClassFormOptions.mockResolvedValue(options);
  fetchPathways.mockResolvedValue({ pathways: [] });
  const onScreenChange = vi.fn();

  render(<ManualClassWizard initialSetup={null} onComplete={vi.fn()} onSkipStudents={vi.fn()} onBack={vi.fn()} onClose={vi.fn()} onScreenChange={onScreenChange} />);
  const sectionInput = await screen.findByPlaceholderText("e.g. Diamond, Archimedes");
  fireEvent.change(sectionInput, { target: { value: "Newton" } });
  fireEvent.click(screen.getByRole("button", { name: "Manage official sections" }));

  expect(await screen.findByText("Official sections manager")).toBeTruthy();
  expect(onScreenChange).toHaveBeenCalledWith("official-sections");
  expect(navigate).not.toHaveBeenCalledWith("/admin/settings");

  fireEvent.click(screen.getByRole("button", { name: "Back to New Class" }));
  await waitFor(() => expect(getClassFormOptions).toHaveBeenCalledTimes(2));
  expect(await screen.findByDisplayValue("Newton")).toBeTruthy();
  expect(onScreenChange).toHaveBeenLastCalledWith("details");
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

// @vitest-environment jsdom
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ImportClassWizard from "./import-class-wizard";

const mockNavigate = vi.hoisted(() => vi.fn());
const getClassFormOptions = vi.hoisted(() => vi.fn());
const validateClassImport = vi.hoisted(() => vi.fn());

vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("@/lib/api", () => ({ getClassFormOptions, validateClassImport }));

vi.mock("@/components/retroui/Select", () => {
  const Select = ({ children, value, onValueChange, onChange }: {
    children: ReactNode;
    value: string;
    onValueChange?: (value: string) => void;
    onChange?: (event: { target: { value: string } }) => void;
  }) => (
    <select
      value={value}
      onChange={(event) => {
        onValueChange?.(event.target.value);
        onChange?.({ target: { value: event.target.value } });
      }}
    >
      <option value="">Select</option>
      {children}
    </select>
  );
  const Container = ({ children }: { children: ReactNode }) => <>{children}</>;
  return {
    Select: Object.assign(Select, {
      Trigger: Container,
      Value: () => null,
      Content: Container,
      Group: Container,
      Item: ({ children, value }: { children: ReactNode; value: string }) => <option value={value}>{children}</option>,
    }),
  };
});

beforeEach(() => {
  mockNavigate.mockClear();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("validates modern CSV and supports empty class review navigation", async () => {
  const mockOptions = {
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_levels: [{ academic_level_id: 1, level_name: "Grade 7", grade_level: 7 }],
    eligible_advisers: [
      { staff_id: "T-001", first_name: "Dan", middle_name: null, last_name: "Bejec", suffix: null, email: "dan1@school.test", employment_status: "active" },
      { staff_id: "T-002", first_name: "Dan", middle_name: null, last_name: "Bejec", suffix: null, email: "dan2@school.test", employment_status: "pending" },
    ],
    official_sections: [
      { id: 1, academic_year_id: 1, academic_level_id: 1, section_name: "Aristotle", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: false },
      { id: 2, academic_year_id: 1, academic_level_id: 1, section_name: "Galileo", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: false },
    ],
  };

  getClassFormOptions.mockResolvedValue(mockOptions);

  validateClassImport.mockResolvedValue({
    academic_level: { academic_level_id: 1, level_name: "Grade 7", grade_level: 7 },
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    format: "modern",
    summary: { section_count: 2, student_count: 0 },
    eligible_advisers: mockOptions.eligible_advisers,
    warnings: ["Adviser hint 'Dan Bejec' is ambiguous (matches multiple eligible teachers). Please select the adviser in the review step."],
    sections: [
      {
        section_name: "Aristotle",
        pathway: "general",
        adviser: null,
        adviser_hint: "Dan Bejec",
        students: [],
      },
      {
        section_name: "Galileo",
        pathway: "general",
        adviser: null,
        adviser_hint: null,
        students: [],
      },
    ],
  });

  const onContinue = vi.fn();
  render(<ImportClassWizard onContinue={onContinue} onClose={vi.fn()} />);

  await waitFor(() => expect(screen.getByText("Upload CSV file")).toBeTruthy());

  // Create and select modern CSV file
  const modernCsvContent = "section_name,grade_level,pathway,adviser,student_lrn\nAristotle,7,general,Dan Bejec,\nGalileo,7,general,,";
  const file = new File([modernCsvContent], "classes.csv", { type: "text/csv" });
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: [file] } });

  // Click Validate CSV
  const validateBtn = screen.getByRole("button", { name: "Validate CSV" });
  fireEvent.click(validateBtn);

  // Wait for validation success panel
  await waitFor(() => expect(screen.getByText("CSV validated successfully")).toBeTruthy());

  // Check section summary
  expect(screen.getAllByText("Aristotle").length).toBeGreaterThanOrEqual(1);
  expect(screen.getAllByText("Galileo").length).toBeGreaterThanOrEqual(1);

  // Ambiguous adviser hint warning was detected
  expect(screen.getByText(/ambiguous/i)).toBeTruthy();

  // Select adviser for Aristotle and Galileo (index 0 is the grade level select)
  const allComboboxes = screen.getAllByRole("combobox");
  expect(allComboboxes.length).toBeGreaterThanOrEqual(3);
  fireEvent.change(allComboboxes[1], { target: { value: "T-001" } });
  fireEvent.change(allComboboxes[2], { target: { value: "T-002" } });

  // Continue to review button should now be enabled
  const continueBtn = screen.getByRole("button", { name: /Review/i });
  expect(continueBtn).toBeTruthy();
  expect(continueBtn.hasAttribute("disabled")).toBe(false);

  fireEvent.click(continueBtn);
  expect(onContinue).toHaveBeenCalledWith(
    expect.objectContaining({
      academicLevelId: 1,
      sections: expect.arrayContaining([
        expect.objectContaining({ sectionName: "Aristotle" }),
        expect.objectContaining({ sectionName: "Galileo" }),
      ]),
    }),
    expect.anything(),
    true
  );
});

it("rejects unknown headers during CSV preflight", async () => {
  getClassFormOptions.mockResolvedValue({
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_levels: [{ academic_level_id: 1, level_name: "Grade 7", grade_level: 7 }],
    eligible_advisers: [],
    official_sections: [
      { id: 1, academic_year_id: 1, academic_level_id: 1, section_name: "Aristotle", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: false },
    ],
  });

  render(<ImportClassWizard onContinue={vi.fn()} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByText("Upload CSV file")).toBeTruthy());

  const badCsvContent = "bad_col_1,bad_col_2\nval1,val2";
  const file = new File([badCsvContent], "invalid.csv", { type: "text/csv" });
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: [file] } });

  const validateBtn = screen.getByRole("button", { name: "Validate CSV" });
  fireEvent.click(validateBtn);

  await waitFor(() => expect(screen.getByText("CSV validation failed.")).toBeTruthy());
  expect(screen.getByText(/Header row must match the modern 5-column format or legacy 12-column format/i)).toBeTruthy();
});

it("displays actionable existing-class management interface when all sections already have classes", async () => {
  getClassFormOptions.mockResolvedValue({
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_levels: [{ academic_level_id: 6, level_name: "Grade 12", grade_level: 12 }],
    eligible_advisers: [],
    official_sections: [
      { id: 11, academic_year_id: 1, academic_level_id: 6, section_name: "Del Mundo", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: true, class_id: 19, class_status: "active" },
      { id: 12, academic_year_id: 1, academic_level_id: 6, section_name: "Reyes", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: true, class_id: 20, class_status: "active" },
    ],
  });

  const onClose = vi.fn();
  render(<ImportClassWizard onContinue={vi.fn()} onClose={onClose} />);

  // Should display concise header and existing class cards
  await waitFor(() => expect(screen.getByText("All Grade 12 classes are created")).toBeTruthy());
  expect(screen.getByText(/Del Mundo and Reyes already exist for AY 2025-2026/)).toBeTruthy();
  expect(screen.getByText(/All sections for this grade already have classes/)).toBeTruthy();
  expect(screen.getByText("Class ID #19")).toBeTruthy();
  expect(screen.getByText("Class ID #20")).toBeTruthy();

  // CSV controls must be hidden when all sections have classes
  expect(screen.queryByText("Upload CSV file")).toBeNull();
  expect(screen.queryByText("CSV validation")).toBeNull();
  expect(screen.queryByRole("button", { name: "Download Template" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Validate CSV" })).toBeNull();

  // Check direct management action buttons
  const manageDelMundoBtn = screen.getByRole("button", { name: /Manage Del Mundo/i });
  const manageReyesBtn = screen.getByRole("button", { name: /Manage Reyes/i });
  expect(manageDelMundoBtn).toBeTruthy();
  expect(manageReyesBtn).toBeTruthy();

  // Clicking Manage Del Mundo navigates directly with class ID and action
  fireEvent.click(manageDelMundoBtn);
  expect(onClose).toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith("/admin/classes/19?tab=students&action=manage-students");
});

it("removes redundant View Details action from existing-class entries in State B and presents Manage Students as sole action", async () => {
  getClassFormOptions.mockResolvedValue({
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_levels: [{ academic_level_id: 6, level_name: "Grade 12", grade_level: 12 }],
    eligible_advisers: [],
    official_sections: [
      { id: 11, academic_year_id: 1, academic_level_id: 6, section_name: "Del Mundo", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: true, class_id: 19, class_status: "active" },
    ],
  });

  const onClose = vi.fn();
  render(<ImportClassWizard onContinue={vi.fn()} onClose={onClose} />);

  await waitFor(() => expect(screen.getByText("All Grade 12 classes are created")).toBeTruthy());

  // Redundant View Details action must NOT be present
  expect(screen.queryByRole("button", { name: /View Details/i })).toBeNull();

  // Manage Students action must be present as the sole primary action
  const manageBtn = screen.getByRole("button", { name: /Manage Del Mundo/i });
  expect(manageBtn).toBeTruthy();
  fireEvent.click(manageBtn);

  expect(onClose).toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith("/admin/classes/19?tab=students&action=manage-students");
});

it("handles archived classes as read-only with View Class button", async () => {
  getClassFormOptions.mockResolvedValue({
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_levels: [{ academic_level_id: 6, level_name: "Grade 12", grade_level: 12 }],
    eligible_advisers: [],
    official_sections: [
      { id: 11, academic_year_id: 1, academic_level_id: 6, section_name: "Del Mundo", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: true, class_id: 19, class_status: "archived" },
    ],
  });

  const onClose = vi.fn();
  render(<ImportClassWizard onContinue={vi.fn()} onClose={onClose} />);

  await waitFor(() => expect(screen.getByText("Archived")).toBeTruthy());

  const viewClassBtn = screen.getByRole("button", { name: /View Class/i });
  expect(viewClassBtn).toBeTruthy();

  fireEvent.click(viewClassBtn);
  expect(onClose).toHaveBeenCalled();
  // Does not pass action=manage-students for archived classes
  expect(mockNavigate).toHaveBeenCalledWith("/admin/classes/19?tab=students");
});

it("supports partially available sections with available list and quick manage links", async () => {
  getClassFormOptions.mockResolvedValue({
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_levels: [{ academic_level_id: 1, level_name: "Grade 7", grade_level: 7 }],
    eligible_advisers: [],
    official_sections: [
      { id: 1, academic_year_id: 1, academic_level_id: 1, section_name: "Aristotle", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: true, class_id: 5, class_status: "active" },
      { id: 2, academic_year_id: 1, academic_level_id: 1, section_name: "Galileo", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: false },
    ],
  });

  const onClose = vi.fn();
  render(<ImportClassWizard onContinue={vi.fn()} onClose={onClose} />);

  await waitFor(() => expect(screen.getByText(/Available section for import:/)).toBeTruthy());
  expect(screen.getByText("Galileo")).toBeTruthy();

  // CSV upload panel is present because Galileo is available
  expect(screen.getByText("Upload CSV file")).toBeTruthy();

  // Existing class Aristotle is hidden behind progressive disclosure initially
  expect(screen.queryByText("Class ID #5")).toBeNull();

  // Progressive disclosure toggle is displayed
  const disclosureTrigger = screen.getByRole("button", { name: /Manage classes/i });
  expect(disclosureTrigger).toBeTruthy();
  expect(disclosureTrigger.getAttribute("aria-expanded")).toBe("false");

  // Expand disclosure
  fireEvent.click(disclosureTrigger);
  expect(disclosureTrigger.getAttribute("aria-expanded")).toBe("true");

  // Now existing class card is visible
  expect(screen.getByText("Aristotle")).toBeTruthy();
  expect(screen.getByText("Class ID #5")).toBeTruthy();

  const manageLink = screen.getByRole("button", { name: /Manage Aristotle/i });
  fireEvent.click(manageLink);

  expect(onClose).toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith("/admin/classes/5?tab=students&action=manage-students");
});

it("prompts confirmation before navigating if an import file is selected", async () => {
  getClassFormOptions.mockResolvedValue({
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_levels: [{ academic_level_id: 1, level_name: "Grade 7", grade_level: 7 }],
    eligible_advisers: [],
    official_sections: [
      { id: 1, academic_year_id: 1, academic_level_id: 1, section_name: "Aristotle", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: true, class_id: 5, class_status: "active" },
      { id: 2, academic_year_id: 1, academic_level_id: 1, section_name: "Galileo", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: false },
    ],
  });

  const onClose = vi.fn();
  render(<ImportClassWizard onContinue={vi.fn()} onClose={onClose} />);
  await waitFor(() => expect(screen.getByText("Upload CSV file")).toBeTruthy());

  // Select a file
  const file = new File(["sample"], "classes.csv", { type: "text/csv" });
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: [file] } });

  // Open existing classes disclosure
  const disclosureTrigger = screen.getByRole("button", { name: /Manage classes/i });
  fireEvent.click(disclosureTrigger);

  const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

  const manageLink = screen.getByRole("button", { name: /Manage Aristotle/i });
  fireEvent.click(manageLink);

  // Since user cancelled the confirm dialog, navigation should NOT happen
  expect(confirmSpy).toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(mockNavigate).not.toHaveBeenCalled();

  // Now user confirms
  confirmSpy.mockReturnValue(true);
  fireEvent.click(manageLink);
  expect(onClose).toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith("/admin/classes/5?tab=students&action=manage-students");

  confirmSpy.mockRestore();
});

it("accepts CSV files with UTF-8 BOM in preflight", async () => {
  getClassFormOptions.mockResolvedValue({
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_levels: [{ academic_level_id: 1, level_name: "Grade 7", grade_level: 7 }],
    eligible_advisers: [],
    official_sections: [
      { id: 1, academic_year_id: 1, academic_level_id: 1, section_name: "Aristotle", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: false },
    ],
  });

  validateClassImport.mockResolvedValue({
    academic_level: { academic_level_id: 1, level_name: "Grade 7", grade_level: 7 },
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    format: "modern",
    summary: { section_count: 1, student_count: 0 },
    eligible_advisers: [],
    sections: [{ section_name: "Aristotle", pathway: "general", adviser: null, students: [] }],
  });

  render(<ImportClassWizard onContinue={vi.fn()} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByText("Upload CSV file")).toBeTruthy());

  // BOM prefixed modern CSV
  const bomCsvContent = "\ufeffsection_name,grade_level,pathway,adviser,student_lrn\nAristotle,7,general,,";
  const file = new File([bomCsvContent], "bom.csv", { type: "text/csv" });
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: [file] } });

  const validateBtn = screen.getByRole("button", { name: "Validate CSV" });
  fireEvent.click(validateBtn);

  await waitFor(() => expect(screen.getByText("CSV validated successfully")).toBeTruthy());
});

it("validates legacy 12-column CSV format during preflight and import validation", async () => {
  getClassFormOptions.mockResolvedValue({
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_levels: [{ academic_level_id: 1, level_name: "Grade 7", grade_level: 7 }],
    eligible_advisers: [
      { staff_id: "T-001", first_name: "Dan", middle_name: null, last_name: "Bejec", suffix: null, email: "dan1@school.test", employment_status: "active" },
    ],
    official_sections: [
      { id: 1, academic_year_id: 1, academic_level_id: 1, section_name: "Aristotle", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: false },
    ],
  });

  validateClassImport.mockResolvedValue({
    academic_level: { academic_level_id: 1, level_name: "Grade 7", grade_level: 7 },
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    format: "legacy",
    summary: { section_count: 1, student_count: 0 },
    eligible_advisers: [
      { staff_id: "T-001", first_name: "Dan", middle_name: null, last_name: "Bejec", suffix: null, email: "dan1@school.test", employment_status: "active" },
    ],
    sections: [{ section_name: "Aristotle", pathway: "general", adviser: { staff_id: "T-001", first_name: "Dan", last_name: "Bejec" }, students: [] }],
  });

  render(<ImportClassWizard onContinue={vi.fn()} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByText("Upload CSV file")).toBeTruthy());

  const legacyHeader = "section_name,grade_level,pathway,adviser_staff_id,adviser_first_name,adviser_middle_name,adviser_last_name,student_lrn,student_first_name,student_middle_name,student_last_name\nAristotle,7,general,T-001,Dan,,Bejec,,,,";
  const file = new File([legacyHeader], "legacy.csv", { type: "text/csv" });
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: [file] } });

  const validateBtn = screen.getByRole("button", { name: "Validate CSV" });
  fireEvent.click(validateBtn);

  await waitFor(() => expect(screen.getByText("CSV validated successfully")).toBeTruthy());
  expect(screen.getByText(/Legacy 12-column template/i)).toBeTruthy();
});

it("supports long section names and multiple classes with consistent full-size buttons and View Details in State A", async () => {
  getClassFormOptions.mockResolvedValue({
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_levels: [{ academic_level_id: 6, level_name: "Grade 12", grade_level: 12 }],
    eligible_advisers: [],
    official_sections: [
      { id: 101, academic_year_id: 1, academic_level_id: 6, section_name: "Immaculate Conception of the Blessed Virgin Mary", pathway_id: null, pathway_name: "Science and Technology", pathway_code: "STEM", is_active: true, has_class: true, class_id: 99, class_status: "active" },
      { id: 102, academic_year_id: 1, academic_level_id: 6, section_name: "San Juan Bautista de La Salle", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: false },
    ],
  });

  const onClose = vi.fn();
  render(<ImportClassWizard onContinue={vi.fn()} onClose={onClose} />);

  await waitFor(() => expect(screen.getByText(/Available section for import:/)).toBeTruthy());
  expect(screen.getByText("San Juan Bautista de La Salle")).toBeTruthy();

  // Expand progressive disclosure
  const disclosureTrigger = screen.getByRole("button", { name: /Manage classes/i });
  fireEvent.click(disclosureTrigger);

  expect(screen.getByText("Existing Classes")).toBeTruthy();
  expect(screen.getByText("Immaculate Conception of the Blessed Virgin Mary")).toBeTruthy();
  expect(screen.getByText("Science and Technology")).toBeTruthy();

  // View Details action must NOT be present in State A
  expect(screen.queryByRole("button", { name: /View details for Immaculate Conception/i })).toBeNull();

  // Manage Students action must be present and navigate to manage-students
  const manageBtn = screen.getByRole("button", { name: /Manage Immaculate Conception/i });
  expect(manageBtn).toBeTruthy();
  fireEvent.click(manageBtn);

  expect(onClose).toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith("/admin/classes/99?tab=students&action=manage-students");
});

it("displays styled card when no official sections are configured", async () => {
  getClassFormOptions.mockResolvedValue({
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_levels: [{ academic_level_id: 2, level_name: "Grade 8", grade_level: 8 }],
    eligible_advisers: [],
    official_sections: [],
  });

  const onClose = vi.fn();
  render(<ImportClassWizard onContinue={vi.fn()} onClose={onClose} />);

  await waitFor(() => expect(screen.getByText("No official sections configured")).toBeTruthy());
  expect(screen.getByText(/Configure official sections in System Settings before importing classes/i)).toBeTruthy();

  // CSV controls must be hidden when no sections are configured
  expect(screen.queryByText("Upload CSV file")).toBeNull();
  expect(screen.queryByRole("button", { name: "Validate CSV" })).toBeNull();

  // Configure Sections button navigates to settings
  const configBtn = screen.getByRole("button", { name: "Configure Sections" });
  fireEvent.click(configBtn);
  expect(onClose).toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith("/admin/settings");
});

it("toggles progressive disclosure open and closed without losing selected file", async () => {
  getClassFormOptions.mockResolvedValue({
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_levels: [{ academic_level_id: 1, level_name: "Grade 7", grade_level: 7 }],
    eligible_advisers: [],
    official_sections: [
      { id: 1, academic_year_id: 1, academic_level_id: 1, section_name: "Aristotle", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: true, class_id: 5, class_status: "active" },
      { id: 2, academic_year_id: 1, academic_level_id: 1, section_name: "Galileo", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: false },
    ],
  });

  render(<ImportClassWizard onContinue={vi.fn()} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByText("Upload CSV file")).toBeTruthy());

  // Select a file
  const file = new File(["section_name,grade_level,pathway,adviser,student_lrn\nGalileo,7,general,,\n"], "test.csv", { type: "text/csv" });
  const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(fileInput, { target: { files: [file] } });

  expect(screen.getByText("test.csv")).toBeTruthy();

  // Toggle open
  const trigger = screen.getByRole("button", { name: /Manage classes/i });
  fireEvent.click(trigger);
  expect(screen.getByText("Aristotle")).toBeTruthy();
  expect(screen.getByText("test.csv")).toBeTruthy();

  // Toggle closed
  const hideTrigger = screen.getByRole("button", { name: /Hide/i });
  fireEvent.click(hideTrigger);
  expect(screen.queryByText("Class ID #5")).toBeNull();
  expect(screen.getByText("test.csv")).toBeTruthy();
});

it("dynamically switches between all-sections-created empty state and available import state when changing grade level", async () => {
  getClassFormOptions.mockResolvedValue({
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_levels: [
      { academic_level_id: 1, level_name: "Grade 7", grade_level: 7 },
      { academic_level_id: 6, level_name: "Grade 12", grade_level: 12 },
    ],
    eligible_advisers: [],
    official_sections: [
      // Grade 7 has only existing classes (State B)
      { id: 1, academic_year_id: 1, academic_level_id: 1, section_name: "Aristotle", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: true, class_id: 10, class_status: "active" },
      // Grade 12 has an available section (State A)
      { id: 2, academic_year_id: 1, academic_level_id: 6, section_name: "Santos", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: false },
      { id: 3, academic_year_id: 1, academic_level_id: 6, section_name: "Del Mundo", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: true, class_id: 20, class_status: "active" },
    ],
  });

  render(<ImportClassWizard onContinue={vi.fn()} onClose={vi.fn()} />);

  // Initial grade is Grade 7 (all classes created)
  await waitFor(() => expect(screen.getByText("All Grade 7 classes are created")).toBeTruthy());
  expect(screen.queryByText("Upload CSV file")).toBeNull();
  expect(screen.queryByRole("button", { name: "Validate CSV" })).toBeNull();

  // Switch to Grade 12
  const levelSelect = screen.getByRole("combobox");
  fireEvent.change(levelSelect, { target: { value: "6" } });

  // Now Grade 12 is active: State A should appear with available section and CSV upload
  await waitFor(() => expect(screen.getByText(/Available section for import:/)).toBeTruthy());
  expect(screen.getByText("Santos")).toBeTruthy();
  expect(screen.getByText("Upload CSV file")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Validate CSV" })).toBeTruthy();
  expect(screen.queryByText("All Grade 7 classes are created")).toBeNull();

  // Switch back to Grade 7: State B should reappear, hiding CSV upload
  fireEvent.change(levelSelect, { target: { value: "1" } });
  await waitFor(() => expect(screen.getByText("All Grade 7 classes are created")).toBeTruthy());
  expect(screen.queryByText("Upload CSV file")).toBeNull();
});

it("navigates to settings from all-sections-created state via Configure Sections button", async () => {
  getClassFormOptions.mockResolvedValue({
    academic_year: { academic_year_id: 1, year_label: "2025-2026" },
    academic_levels: [{ academic_level_id: 1, level_name: "Grade 7", grade_level: 7 }],
    eligible_advisers: [],
    official_sections: [
      { id: 1, academic_year_id: 1, academic_level_id: 1, section_name: "Aristotle", pathway_id: null, pathway_name: null, pathway_code: null, is_active: true, has_class: true, class_id: 10, class_status: "active" },
    ],
  });

  const onClose = vi.fn();
  render(<ImportClassWizard onContinue={vi.fn()} onClose={onClose} />);

  await waitFor(() => expect(screen.getByText("All Grade 7 classes are created")).toBeTruthy());

  const configBtn = screen.getByRole("button", { name: "Configure Sections" });
  fireEvent.click(configBtn);

  expect(onClose).toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith("/admin/settings");
});


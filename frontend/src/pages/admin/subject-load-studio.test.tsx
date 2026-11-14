// @vitest-environment jsdom
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdminSubjectLoadStudio from "./subject-load-studio";

const getStudio = vi.hoisted(() => vi.fn());
const validate = vi.hoisted(() => vi.fn());
const unlock = vi.hoisted(() => vi.fn());
const jhsSlots = vi.hoisted(() => [
  [1, "Homeroom Guidance", "HOMEROOM", "07:30", "08:00", true],
  [2, "Period 1", "CLASS", "08:00", "08:45", false],
  [3, "Period 2", "CLASS", "08:45", "09:30", false],
  [4, "Morning Recess", "RECESS", "09:30", "09:45", true],
  [5, "Period 3", "CLASS", "09:45", "10:30", false],
  [6, "Period 4", "CLASS", "10:30", "11:15", false],
  [7, "Period 5", "CLASS", "11:15", "12:00", false],
  [8, "Lunch Break", "LUNCH", "12:00", "13:00", true],
  [9, "Enhanced Period 1", "CLASS", "13:00", "14:00", false],
  [10, "Enhanced Period 2", "CLASS", "14:00", "15:00", false],
  [11, "Afternoon Recess", "RECESS", "15:00", "15:30", true],
  [12, "Period 6", "CLASS", "15:30", "16:15", false],
  [13, "Period 7", "CLASS", "16:15", "17:00", false],
].map(([slot_id, slot_name, slot_type, start_time, end_time, is_locked_break], index) => ({
  slot_id, slot_name, slot_type, start_time, end_time, is_locked_break,
  template_group: "JHS_45MIN", display_order: index + 1,
})));

vi.mock("@/layouts/app-layout", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("@/context/SettingsContext", () => ({ useSettings: () => ({ getSetting: (_: string, fallback: string) => fallback }) }));
vi.mock("@/context/AcademicPeriodContext", () => ({ useAcademicPeriod: () => ({ selectedPeriodId: 1 }) }));
const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();
vi.mock("@/components/retroui/use-toast", () => ({ useToast: () => ({ success: mockToastSuccess, error: mockToastError }) }));
vi.mock("@/components/retroui/Toast", () => ({ useToast: () => ({ success: mockToastSuccess, error: mockToastError }) }));
vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn().mockResolvedValue({ ok: true, json: async () => jhsSlots }),
  getSubjectLoadStudioData: getStudio,
  validateSubjectLoads: validate,
  unlockSection: unlock,
  batchSaveSubjectLoads: vi.fn(),
  autoScheduleSubjectLoads: vi.fn(),
  discardDraft: vi.fn(),
}));

const baseline = {
  active_period_id: 1,
  academic_years: [{ academic_year_id: 1, year_label: "2026-2027", is_active: true }],
  academic_periods: [{ academic_period_id: 1, period_name: "Term 1", is_active: true }],
  academic_levels: [{ academic_level_id: 9, level_name: "Grade 9", grade_level: 9 }],
  classes: [{ class_id: 8, section_name: "Archimedes", academic_level_id: 9, academic_year_id: 1, period_template_group: "JHS_45MIN" }],
  subjects: [{ subject_id: 3, subject_name: "Filipino 9", subject_codename: "F9", academic_level_id: 9, subject_group: "Core" }],
  subject_offerings: [{ subject_offering_id: 30, subject_id: 3, academic_year_id: 1, academic_level_id: 9, academic_period_id: 1, pathway: "both", pathway_ids: [], minutes: 45 }],
  teachers: [{ staff_id: "T1", name: "Maria Cruz", department: "Filipino", specialization: "Filipino" }],
  existing_loads: [{ subject_load_id: 12, class_id: 8, subject_id: 3, staff_id: "T1", academic_period_id: 1,
    slot_id: 2, start_time: "08:00", end_time: "08:45", days_of_week: ["MON"], status: "published", is_locked: true, section_revision: 1 }],
  has_pending_draft_by_class: {},
  period_template_slots: jhsSlots,
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("Subject Load Studio locked section", () => {
  it("shows the lock, keeps assignments visible, and disables list edits", async () => {
    getStudio.mockResolvedValue(baseline);
    validate.mockResolvedValue({ conflicts: [{ rule: "TEACHER_OVERLAP", severity: "error", message: "Teacher overlap in Archimedes", class_id: 8, subject_id: 3 }], teacher_workloads: [], is_valid: false });
    render(<AdminSubjectLoadStudio />);
    await waitFor(() => expect(screen.getByText("Section Locked")).toBeTruthy());
    expect(screen.getByText(/Unlock it to modify subject schedules/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Unlock Section/i })).toBeTruthy();
    fireEvent.click(screen.getByText("List"));
    await waitFor(() => expect(screen.getByRole("button", { name: /Maria Cruz/i })).toBeTruthy());
    expect((screen.getByRole("button", { name: /Maria Cruz/i }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "M" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText(/Teacher overlap in Archimedes/i).length).toBeGreaterThan(0);
  });

  it("restores list editing after an authorized unlock refresh", async () => {
    const unlocked = {
      ...baseline,
      existing_loads: [{ ...baseline.existing_loads[0], status: "draft", is_locked: false, subject_load_id: 13, base_revision: 1 }],
      has_pending_draft_by_class: { 8: true },
    };
    getStudio.mockResolvedValueOnce(baseline).mockResolvedValue(unlocked);
    validate.mockResolvedValue({ conflicts: [], teacher_workloads: [], is_valid: true });
    unlock.mockResolvedValue({ section_revision: 2 });
    render(<AdminSubjectLoadStudio />);
    await waitFor(() => expect(screen.getByText("Section Locked")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Unlock Section/i }));
    await waitFor(() => expect(screen.queryByText("Section Locked")).toBeNull());
    expect(unlock).toHaveBeenCalledWith(1, 8);
    fireEvent.click(screen.getByText("List"));
    await waitFor(() => expect(screen.getByRole("button", { name: /Maria Cruz/i })).toBeTruthy());
    expect((screen.getByRole("button", { name: /Maria Cruz/i }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole("button", { name: "M" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("shows canonical SHS pathways in both views and updates on section navigation", async () => {
    getStudio.mockResolvedValue({
      ...baseline,
      academic_levels: [{ academic_level_id: 11, level_name: "Grade 11", grade_level: 11 }],
      classes: [
        { class_id: 12, section_name: "Zara", academic_level_id: 11, academic_year_id: 1, pathway_id: 1,
          pathway: "medical-courses", pathway_name: "Medical Courses and Sciences Related", pathway_is_enabled: true, requires_pathway: true },
        { class_id: 13, section_name: "Campos", academic_level_id: 11, academic_year_id: 1, pathway_id: 2,
          pathway: "engineering-math", pathway_name: "Engineering and Mathematics Related", pathway_is_enabled: true, requires_pathway: true },
      ],
      subjects: [], existing_loads: [], has_pending_draft_by_class: {},
    });
    validate.mockResolvedValue({ conflicts: [], teacher_workloads: [], is_valid: true });
    render(<AdminSubjectLoadStudio />);
    await waitFor(() => expect(screen.getByText("Medical Courses and Sciences Related")).toBeTruthy());
    fireEvent.click(screen.getByText("List"));
    expect(screen.getByText("Medical Courses and Sciences Related")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Campos/i }));
    await waitFor(() => expect(screen.getByText("Engineering and Mathematics Related")).toBeTruthy());
    fireEvent.change(screen.getByPlaceholderText("Search class"), { target: { value: "Medical Courses" } });
    await waitFor(() => expect(screen.getByText("Medical Courses and Sciences Related")).toBeTruthy());
    expect(screen.queryByText("Engineering and Mathematics Related")).toBeNull();
  });

  it("shows a Grade 12 assignment when its academic year enables pathways", async () => {
    getStudio.mockResolvedValue({
      ...baseline,
      academic_levels: [{ academic_level_id: 12, level_name: "Grade 12", grade_level: 12 }],
      classes: [{ class_id: 21, section_name: "Sample", academic_level_id: 12, academic_year_id: 1,
        pathway_id: 2, pathway: "engineering-math", pathway_name: "Engineering and Mathematics Related",
        pathway_is_enabled: true, requires_pathway: true }],
      subjects: [], existing_loads: [], has_pending_draft_by_class: {},
    });
    validate.mockResolvedValue({ conflicts: [], teacher_workloads: [], is_valid: true });
    render(<AdminSubjectLoadStudio />);
    await waitFor(() => expect(screen.getByText("Engineering and Mathematics Related")).toBeTruthy());
    fireEvent.click(screen.getByText("List"));
    expect(screen.getByText("Engineering and Mathematics Related")).toBeTruthy();
  });
});

describe("Subject Load Studio offering eligibility", () => {
  it("gives a fresh JHS subject an authoritative default period", async () => {
    getStudio.mockResolvedValue({ ...baseline, existing_loads: [] });
    validate.mockResolvedValue({ conflicts: [], teacher_workloads: [], is_valid: true });

    render(<AdminSubjectLoadStudio />);
    fireEvent.click(await screen.findByText("List"));

    expect(await screen.findByText(/Period 1.*8:00 AM.*8:45 AM/)).toBeTruthy();
    expect(validate).toHaveBeenCalledWith(1, expect.arrayContaining([
      expect.objectContaining({ subject_id: 3, slot_id: 2, start_time: "08:00", end_time: "08:45" }),
    ]));
  });

  it("shows a configured empty state instead of treating zero offerings as all subjects", async () => {
    getStudio.mockResolvedValue({
      ...baseline,
      subject_offerings: [],
      existing_loads: [],
    });
    validate.mockResolvedValue({ conflicts: [], teacher_workloads: [], is_valid: true });

    render(<AdminSubjectLoadStudio />);

    await waitFor(() => expect(screen.getByText("No eligible subject offerings")).toBeTruthy());
    expect(screen.queryByText("Filipino 9")).toBeNull();
    expect(validate).not.toHaveBeenCalled();
  });

  it("shows the API failure state separately from an empty configuration", async () => {
    getStudio.mockRejectedValue(new Error("Offering query unavailable"));

    render(<AdminSubjectLoadStudio />);

    await waitFor(() => expect(screen.getByText("Unable to load class sections")).toBeTruthy());
    expect(mockToastError).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Loading Failed",
        description: "Offering query unavailable",
      })
    );
    expect(screen.queryByText("Offering query unavailable")).toBeNull();
    expect(screen.queryByText("No eligible subject offerings")).toBeNull();
  });

  it("filters offerings by year, term, grade, and pathway", async () => {
    getStudio.mockResolvedValue({
      ...baseline,
      classes: [{ ...baseline.classes[0], pathway_id: 7, pathway: "engineering-math" }],
      subjects: [
        baseline.subjects[0],
        { subject_id: 4, subject_name: "Wrong pathway", subject_codename: "WP", academic_level_id: 9 },
        { subject_id: 5, subject_name: "Wrong term", subject_codename: "WT", academic_level_id: 9 },
        { subject_id: 6, subject_name: "Wrong year", subject_codename: "WY", academic_level_id: 9 },
      ],
      subject_offerings: [
        { subject_offering_id: 30, subject_id: 3, academic_year_id: 1, academic_level_id: 9, academic_period_id: 1, pathway_ids: [7] },
        { subject_offering_id: 31, subject_id: 4, academic_year_id: 1, academic_level_id: 9, academic_period_id: 1, pathway_ids: [8] },
        { subject_offering_id: 32, subject_id: 5, academic_year_id: 1, academic_level_id: 9, academic_period_id: 2, pathway_ids: [7] },
        { subject_offering_id: 33, subject_id: 6, academic_year_id: 2, academic_level_id: 9, academic_period_id: 1, pathway_ids: [7] },
      ],
      existing_loads: [],
    });
    validate.mockResolvedValue({ conflicts: [], teacher_workloads: [], is_valid: true });

    render(<AdminSubjectLoadStudio />);
    fireEvent.click(await screen.findByText("List"));

    expect(await screen.findByText("Filipino 9")).toBeTruthy();
    expect(screen.queryByText("Wrong pathway")).toBeNull();
    expect(screen.queryByText("Wrong term")).toBeNull();
    expect(screen.queryByText("Wrong year")).toBeNull();
  });

  it("keeps an ineligible existing draft visible and marks it non-publishable", async () => {
    getStudio.mockResolvedValue({
      ...baseline,
      subject_offerings: [],
      existing_loads: [{ ...baseline.existing_loads[0], status: "draft", is_locked: false }],
      has_pending_draft_by_class: { 8: true },
    });
    validate.mockResolvedValue({
      conflicts: [{ rule: "SUBJECT_NOT_OFFERED", severity: "error", message: "Subject is not offered", class_id: 8, subject_id: 3 }],
      teacher_workloads: [],
      is_valid: false,
    });

    render(<AdminSubjectLoadStudio />);

    await waitFor(() => expect(screen.getByText(/existing subject load is no longer eligible/i)).toBeTruthy());
    fireEvent.click(screen.getByText("List"));
    expect(await screen.findByText("Filipino 9")).toBeTruthy();
    expect(screen.getByText(/Not offered.*cannot publish/i)).toBeTruthy();
    expect(validate).toHaveBeenCalledWith(1, expect.arrayContaining([
      expect.objectContaining({ subject_load_id: 12, _offering_eligible: false }),
    ]));
  });
});

describe("Subject Load Studio Grade and Status filters", () => {
  it("renders Grade pill buttons and filters displayed section by grade level", async () => {
    const multiGradeData = {
      active_period_id: 1,
      academic_years: [{ academic_year_id: 1, year_label: "2026-2027", is_active: true }],
      academic_periods: [{ academic_period_id: 1, period_name: "Term 1", is_active: true }],
      academic_levels: [
        { academic_level_id: 7, level_name: "Grade 7", grade_level: 7 },
        { academic_level_id: 8, level_name: "Grade 8", grade_level: 8 },
      ],
      classes: [
        { class_id: 101, section_name: "Apollo", academic_level_id: 7, academic_year_id: 1 },
        { class_id: 102, section_name: "Zeus", academic_level_id: 8, academic_year_id: 1 },
      ],
      subjects: [
        { subject_id: 1, subject_name: "Science 7", subject_codename: "SCI7", academic_level_id: 7 },
        { subject_id: 2, subject_name: "Science 8", subject_codename: "SCI8", academic_level_id: 8 },
      ],
      subject_offerings: [
        { subject_offering_id: 1, subject_id: 1, academic_year_id: 1, academic_level_id: 7, academic_period_id: 1 },
        { subject_offering_id: 2, subject_id: 2, academic_year_id: 1, academic_level_id: 8, academic_period_id: 1 },
      ],
      teachers: [{ staff_id: "T1", name: "Teacher One", department: "Science", specialization: "Science" }],
      existing_loads: [],
      has_pending_draft_by_class: {},
    };

    getStudio.mockResolvedValue(multiGradeData);
    validate.mockResolvedValue({ conflicts: [], teacher_workloads: [], is_valid: true });

    render(<AdminSubjectLoadStudio />);

    await waitFor(() => expect(screen.getByText("Grade:")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Grade 7" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Grade 8" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "All" })).toBeNull();

    expect(screen.getByText("Apollo")).toBeTruthy();
    expect(screen.queryByText("Zeus")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Grade 8" }));
    await waitFor(() => expect(screen.getByText("Zeus")).toBeTruthy());
    expect(screen.queryByText("Apollo")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Grade 7" }));
    await waitFor(() => expect(screen.getByText("Apollo")).toBeTruthy());
    expect(screen.queryByText("Zeus")).toBeNull();
  });

  it("renders Status filter dropdown with options replacing the grade select", async () => {
    const statusData = {
      active_period_id: 1,
      academic_years: [{ academic_year_id: 1, year_label: "2026-2027", is_active: true }],
      academic_periods: [{ academic_period_id: 1, period_name: "Term 1", is_active: true }],
      academic_levels: [{ academic_level_id: 7, level_name: "Grade 7", grade_level: 7 }],
      classes: [{ class_id: 101, section_name: "Apollo", academic_level_id: 7, academic_year_id: 1 }],
      subjects: [{ subject_id: 1, subject_name: "Science 7", subject_codename: "SCI7", academic_level_id: 7 }],
      subject_offerings: [{ subject_offering_id: 1, subject_id: 1, academic_year_id: 1, academic_level_id: 7, academic_period_id: 1 }],
      teachers: [{ staff_id: "T1", name: "Teacher One", department: "Science", specialization: "Science" }],
      existing_loads: [],
      has_pending_draft_by_class: {},
    };

    getStudio.mockResolvedValue(statusData);
    validate.mockResolvedValue({ conflicts: [], teacher_workloads: [], is_valid: true });

    render(<AdminSubjectLoadStudio />);

    await waitFor(() => expect(screen.getByText("All Statuses")).toBeTruthy());
    expect(screen.queryByText("All Grade Levels")).toBeNull();
  });
});

describe("Subject Load Studio timetable grid editing", () => {
  const draftGridData = {
    ...baseline,
    subjects: [
      { subject_id: 3, subject_name: "Filipino 9", subject_codename: "F9", academic_level_id: 9, subject_group: "Core" },
      { subject_id: 4, subject_name: "English 9", subject_codename: "E9", academic_level_id: 9, subject_group: "Core" },
    ],
    subject_offerings: [
      { subject_offering_id: 30, subject_id: 3, academic_year_id: 1, academic_level_id: 9, academic_period_id: 1, pathway: "both", pathway_ids: [] },
      { subject_offering_id: 31, subject_id: 4, academic_year_id: 1, academic_level_id: 9, academic_period_id: 1, pathway: "both", pathway_ids: [] },
    ],
    existing_loads: [
      { subject_load_id: 21, class_id: 8, subject_id: 3, staff_id: "T1", academic_period_id: 1, start_time: "08:00", end_time: "08:45",
        days_of_week: ["MON", "TUE", "WED", "THU", "FRI"], status: "draft", is_locked: false },
      { subject_load_id: 22, class_id: 8, subject_id: 4, staff_id: null, academic_period_id: 1, start_time: "08:45", end_time: "09:30",
        days_of_week: ["MON", "TUE", "WED", "THU", "FRI"], status: "draft", is_locked: false },
    ],
    has_pending_draft_by_class: { 8: true },
  };

  it("genuinely disables section and master publish while a subject is unassigned", async () => {
    getStudio.mockResolvedValue({
      ...draftGridData,
      existing_loads: [{ ...draftGridData.existing_loads[0], staff_id: null }],
    });
    validate.mockResolvedValue({ conflicts: [], teacher_workloads: [], is_valid: true });

    render(<AdminSubjectLoadStudio />);

    expect((await screen.findByRole("button", { name: "Publish Master Schedule" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Publish" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("swaps two subject blocks when one is dragged onto the other", async () => {
    getStudio.mockResolvedValue(draftGridData);
    validate.mockResolvedValue({ conflicts: [], teacher_workloads: [], is_valid: true });
    render(<AdminSubjectLoadStudio />);

    const filipino = (await screen.findByText("Filipino 9")).closest("[draggable='true']") as HTMLElement;
    const english = screen.getByText("English 9").closest("[draggable='true']") as HTMLElement;
    expect(filipino).toBeTruthy();
    expect(english).toBeTruthy();

    const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
    validate.mockClear();
    fireEvent.dragStart(filipino, { dataTransfer });
    fireEvent.dragOver(english, { dataTransfer });
    fireEvent.drop(english, { dataTransfer });

    await waitFor(() => expect(validate).toHaveBeenCalled());
    const swapped = validate.mock.calls.at(-1)?.[1] as Array<{ subject_id: number; start_time: string; end_time: string; subject_load_id: number }>;
    expect(swapped.find((l) => l.subject_id === 3)).toMatchObject({ subject_load_id: 21, start_time: "08:45", end_time: "09:30" });
    expect(swapped.find((l) => l.subject_id === 4)).toMatchObject({ subject_load_id: 22, start_time: "08:00", end_time: "08:45" });
  });

  it("selects empty cells and groups more cells with Ctrl + click", async () => {
    getStudio.mockResolvedValue(draftGridData);
    validate.mockResolvedValue({ conflicts: [], teacher_workloads: [], is_valid: true });
    render(<AdminSubjectLoadStudio />);

    fireEvent.click(await screen.findByRole("button", { name: "Monday 9:45 AM - 10:30 AM" }));
    expect(screen.getByText(/1 cell selected/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Tuesday 9:45 AM - 10:30 AM" }), { ctrlKey: true });
    expect(screen.getByText(/2 cells selected/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Add Subject/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Wednesday 9:45 AM - 10:30 AM" }));
    expect(screen.getByText(/1 cell selected/)).toBeTruthy();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByText(/cell selected/)).toBeNull());
  });
});

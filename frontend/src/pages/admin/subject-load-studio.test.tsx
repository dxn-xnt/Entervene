// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConflictItem, SubjectLoadStudioData } from "@/lib/api";
import { buildInitialStudioLoads } from "./subject-load-init";
import {
  conflictAffectsSection,
  describeConflictForAdmin,
  getLoadConflicts,
  getLoadConflictSummary,
  getSlotConflictSummary,
} from "./subject-load-conflicts";
import { teacherAssignmentConflict } from "./teacher-availability";
import {
  diagnoseMissingPeriodSlots,
  getCompatiblePeriodSlots,
  resolveAssignedTemplateGroup,
  withAuthoritativeTemplateSlots,
} from "./subject-load-templates";
import AdminSubjectLoadStudio from "./subject-load-studio";

const mocks = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  getSubjectLoadStudioData: vi.fn(),
  validateSubjectLoads: vi.fn(),
  batchSaveSubjectLoads: vi.fn(),
  unlockSection: vi.fn(),
  discardDraft: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("@/context/SettingsContext", () => ({
  useSettings: () => ({
    getSetting: (_key: string, fallback: string) => fallback,
  }),
}));
vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => ({ selectedPeriodId: 1 }),
}));
vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({
    success: mocks.toastSuccess,
    error: mocks.toastError,
  }),
}));
vi.mock("@/components/retroui/Tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render: trigger }: { render: ReactNode }) => <>{trigger}</>,
  TooltipContent: () => null,
}));
vi.mock("@/pages/admin/forms/break-config-drawer", () => ({
  default: ({ open, initialGroup }: { open: boolean; initialGroup?: string }) =>
    open ? (
      <div data-testid="break-config-drawer" data-initial-group={initialGroup ?? ""}>
        Break Timelines Drawer ({initialGroup})
      </div>
    ) : null,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  DropdownMenuSub: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubTrigger: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuSubContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DropdownMenuPortal: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/retroui/Dialog", () => {
  const DialogRoot = ({ open, children }: { open: boolean; children: ReactNode }) =>
    open ? <div role="dialog">{children}</div> : null;
  const Dialog = Object.assign(DialogRoot, {
    Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Header: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
    Description: ({ children }: { children: ReactNode }) => <p>{children}</p>,
    Footer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  });
  return { Dialog };
});
vi.mock("@/lib/api", () => ({
  apiFetch: mocks.apiFetch,
  getSubjectLoadStudioData: mocks.getSubjectLoadStudioData,
  validateSubjectLoads: mocks.validateSubjectLoads,
  batchSaveSubjectLoads: mocks.batchSaveSubjectLoads,
  unlockSection: mocks.unlockSection,
  discardDraft: mocks.discardDraft,
}));

const JHS_TEMPLATE_SLOTS: NonNullable<SubjectLoadStudioData["period_template_slots"]> = [
  { slot_id: 1, template_group: "JHS_45MIN", slot_name: "Homeroom Guidance", slot_type: "HOMEROOM", start_time: "07:30", end_time: "08:00", is_locked_break: true, display_order: 1 },
  { slot_id: 2, template_group: "JHS_45MIN", slot_name: "Period 1", slot_type: "CLASS", start_time: "08:00", end_time: "08:45", is_locked_break: false, display_order: 2 },
  { slot_id: 3, template_group: "JHS_45MIN", slot_name: "Period 2", slot_type: "CLASS", start_time: "08:45", end_time: "09:30", is_locked_break: false, display_order: 3 },
  { slot_id: 4, template_group: "JHS_45MIN", slot_name: "Morning Recess", slot_type: "RECESS", start_time: "09:30", end_time: "09:45", is_locked_break: true, display_order: 4 },
  { slot_id: 5, template_group: "JHS_45MIN", slot_name: "Period 3", slot_type: "CLASS", start_time: "09:45", end_time: "10:30", is_locked_break: false, display_order: 5 },
  { slot_id: 6, template_group: "JHS_45MIN", slot_name: "Period 4", slot_type: "CLASS", start_time: "10:30", end_time: "11:15", is_locked_break: false, display_order: 6 },
  { slot_id: 7, template_group: "JHS_45MIN", slot_name: "Period 5", slot_type: "CLASS", start_time: "11:15", end_time: "12:00", is_locked_break: false, display_order: 7 },
  { slot_id: 8, template_group: "JHS_45MIN", slot_name: "Lunch Break", slot_type: "LUNCH", start_time: "12:00", end_time: "13:00", is_locked_break: true, display_order: 8 },
  { slot_id: 9, template_group: "JHS_45MIN", slot_name: "Enhanced Period 1", slot_type: "CLASS", start_time: "13:00", end_time: "14:00", is_locked_break: false, display_order: 9 },
  { slot_id: 10, template_group: "JHS_45MIN", slot_name: "Enhanced Period 2", slot_type: "CLASS", start_time: "14:00", end_time: "15:00", is_locked_break: false, display_order: 10 },
  { slot_id: 11, template_group: "JHS_45MIN", slot_name: "Afternoon Recess", slot_type: "RECESS", start_time: "15:00", end_time: "15:30", is_locked_break: true, display_order: 11 },
  { slot_id: 12, template_group: "JHS_45MIN", slot_name: "Period 6", slot_type: "CLASS", start_time: "15:30", end_time: "16:15", is_locked_break: false, display_order: 12 },
  { slot_id: 13, template_group: "JHS_45MIN", slot_name: "Period 7", slot_type: "CLASS", start_time: "16:15", end_time: "17:00", is_locked_break: false, display_order: 13 },
];

const SHS_TEMPLATE_SLOTS: NonNullable<SubjectLoadStudioData["period_template_slots"]> = [
  { slot_id: 100, template_group: "SHS_CAMPOS_ZARA", slot_name: "Homeroom Guidance", slot_type: "HOMEROOM", start_time: "07:30", end_time: "08:00", is_locked_break: true, display_order: 1 },
  { slot_id: 101, template_group: "SHS_CAMPOS_ZARA", slot_name: "Period 1", slot_type: "CLASS", start_time: "08:00", end_time: "09:00", is_locked_break: false, display_order: 2 },
  { slot_id: 102, template_group: "SHS_CAMPOS_ZARA", slot_name: "Period 2", slot_type: "CLASS", start_time: "09:00", end_time: "10:00", is_locked_break: false, display_order: 3 },
  { slot_id: 103, template_group: "SHS_CAMPOS_ZARA", slot_name: "Morning Recess", slot_type: "RECESS", start_time: "10:00", end_time: "10:24", is_locked_break: true, display_order: 4 },
  { slot_id: 104, template_group: "SHS_CAMPOS_ZARA", slot_name: "Lab Block", slot_type: "CLASS", start_time: "10:24", end_time: "12:00", is_locked_break: false, display_order: 5 },
  { slot_id: 105, template_group: "SHS_CAMPOS_ZARA", slot_name: "Lunch Break", slot_type: "LUNCH", start_time: "12:00", end_time: "13:00", is_locked_break: true, display_order: 6 },
  { slot_id: 106, template_group: "SHS_CAMPOS_ZARA", slot_name: "Period 3", slot_type: "CLASS", start_time: "13:00", end_time: "14:00", is_locked_break: false, display_order: 7 },
  { slot_id: 201, template_group: "SHS_DELMUNDO_REYES", slot_name: "Homeroom Guidance", slot_type: "HOMEROOM", start_time: "07:30", end_time: "08:00", is_locked_break: true, display_order: 1 },
  { slot_id: 202, template_group: "SHS_DELMUNDO_REYES", slot_name: "Period 1", slot_type: "CLASS", start_time: "08:00", end_time: "09:12", is_locked_break: false, display_order: 2 },
  { slot_id: 203, template_group: "SHS_DELMUNDO_REYES", slot_name: "Period 2", slot_type: "CLASS", start_time: "09:12", end_time: "10:24", is_locked_break: false, display_order: 3 },
  { slot_id: 204, template_group: "SHS_DELMUNDO_REYES", slot_name: "Morning Recess", slot_type: "RECESS", start_time: "10:24", end_time: "10:48", is_locked_break: true, display_order: 4 },
  { slot_id: 205, template_group: "SHS_DELMUNDO_REYES", slot_name: "Period 6 (PE)", slot_type: "CLASS", start_time: "15:50", end_time: "16:50", is_locked_break: false, display_order: 5 },
  { slot_id: 301, template_group: "SHS_MEDICAL_CUSTOM", slot_name: "Clinical Block 1", slot_type: "CLASS", start_time: "08:00", end_time: "09:20", is_locked_break: false, display_order: 1 },
  { slot_id: 302, template_group: "SHS_MEDICAL_CUSTOM", slot_name: "Mid-Morning Break", slot_type: "RECESS", start_time: "09:20", end_time: "09:40", is_locked_break: true, display_order: 2 },
  { slot_id: 303, template_group: "SHS_MEDICAL_CUSTOM", slot_name: "Clinical Block 2", slot_type: "CLASS", start_time: "09:40", end_time: "11:00", is_locked_break: false, display_order: 3 },
];

function makeStudioData(overrides: Partial<SubjectLoadStudioData> = {}): SubjectLoadStudioData {
  return {
    active_period_id: 1,
    academic_years: [{ academic_year_id: 1, year_label: "2026-2027", is_active: true }],
    academic_periods: [{ academic_period_id: 1, period_name: "Term 1", is_active: true }],
    academic_levels: [{ academic_level_id: 9, level_name: "Grade 9", grade_level: 9 }],
    classes: [
      {
        class_id: 10,
        section_name: "Archimedes",
        academic_level_id: 9,
        academic_year_id: 1,
        period_template_group: "JHS_45MIN",
      },
    ],
    subjects: [
      {
        subject_id: 100,
        subject_name: "Filipino 9",
        subject_codename: "FIL9",
        academic_level_id: 9,
        grading_template: "Core",
        is_core: true,
      },
      {
        subject_id: 101,
        subject_name: "Math 9",
        subject_codename: "MAT9",
        academic_level_id: 9,
        grading_template: "Core",
        is_core: true,
      },
    ],
    subject_offerings: [
      {
        subject_offering_id: 1,
        subject_id: 100,
        academic_year_id: 1,
        academic_level_id: 9,
        academic_period_id: 1,
        pathway: "general",
        pathway_ids: [],
        minutes: 45,
      },
      {
        subject_offering_id: 2,
        subject_id: 101,
        academic_year_id: 1,
        academic_level_id: 9,
        academic_period_id: 1,
        pathway: "general",
        pathway_ids: [],
        minutes: 60,
      },
    ],
    teachers: [
      { staff_id: "T001", name: "Angel Alcantara", department: "Languages", specialization: "Filipino" },
      { staff_id: "T002", name: "Ramon Reyes", department: "Math", specialization: "Mathematics" },
    ],
    existing_loads: [],
    has_pending_draft_by_class: { 10: false },
    published_load_count_by_class: { 10: 0 },
    period_template_slots: JHS_TEMPLATE_SLOTS,
    ...overrides,
  };
}

beforeEach(() => {
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => {};
  }
  mocks.apiFetch.mockResolvedValue({
    ok: true,
    json: async () => JHS_TEMPLATE_SLOTS,
  });
  mocks.validateSubjectLoads.mockResolvedValue({
    is_valid: true,
    conflicts: [],
    teacher_workloads: [],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("buildInitialStudioLoads", () => {
  it("leaves newly created sections unscheduled instead of auto-assigning times", () => {
    const data = makeStudioData();
    const loads = buildInitialStudioLoads(data);

    expect(loads).toHaveLength(2);
    for (const load of loads) {
      expect(load.slot_id).toBeNull();
      expect(load.start_time).toBeNull();
      expect(load.end_time).toBeNull();
      expect(load.days_of_week).toEqual([]);
      expect(load.staff_id).toBeNull();
      expect(load.status).toBe("draft");
      expect(load.is_locked).toBe(false);
    }
  });

  it("preserves existing drafts and published schedules verbatim while keeping new sections unscheduled", () => {
    const data = makeStudioData({
      classes: [
        { class_id: 10, section_name: "Published Section", academic_level_id: 9, academic_year_id: 1, period_template_group: "JHS_45MIN" },
        { class_id: 11, section_name: "Draft Section", academic_level_id: 9, academic_year_id: 1, period_template_group: "JHS_45MIN" },
        { class_id: 12, section_name: "Fresh Section", academic_level_id: 9, academic_year_id: 1, period_template_group: "JHS_45MIN" },
      ],
      existing_loads: [
        {
          subject_load_id: 501,
          class_id: 10,
          subject_id: 100,
          staff_id: "T001",
          academic_period_id: 1,
          slot_id: 2,
          start_time: "08:00",
          end_time: "08:45",
          days_of_week: ["MON", "TUE", "WED", "THU", "FRI"],
          status: "published",
          is_locked: true,
          section_revision: 2,
        },
        {
          subject_load_id: 502,
          class_id: 11,
          subject_id: 100,
          staff_id: "T002",
          academic_period_id: 1,
          slot_id: 3,
          start_time: "08:45",
          end_time: "09:30",
          days_of_week: ["MON", "WED", "FRI"],
          status: "draft",
          is_locked: false,
          section_revision: 1,
        },
      ],
    });

    const loads = buildInitialStudioLoads(data);
    const pubLoad = loads.find((l) => l.class_id === 10 && l.subject_id === 100);
    const draftLoad = loads.find((l) => l.class_id === 11 && l.subject_id === 100);
    const freshLoads = loads.filter((l) => l.class_id === 12);

    expect(pubLoad).toMatchObject({
      subject_load_id: 501,
      slot_id: 2,
      start_time: "08:00",
      end_time: "08:45",
      days_of_week: ["MON", "TUE", "WED", "THU", "FRI"],
      staff_id: "T001",
      status: "published",
      is_locked: true,
      section_revision: 2,
    });
    expect(draftLoad).toMatchObject({
      subject_load_id: 502,
      slot_id: 3,
      start_time: "08:45",
      end_time: "09:30",
      days_of_week: ["MON", "WED", "FRI"],
      staff_id: "T002",
      status: "draft",
      is_locked: false,
    });
    expect(freshLoads).toHaveLength(2);
    expect(freshLoads.every((l) => l.start_time === null && l.end_time === null && l.days_of_week.length === 0)).toBe(true);
  });
});

describe("AdminSubjectLoadStudio", () => {
  it("omits Auto-Generate and Auto-Fit Section and does not mutate existing schedules on open", async () => {
    const data = makeStudioData({
      classes: [
        { class_id: 10, section_name: "Archimedes", academic_level_id: 9, academic_year_id: 1, period_template_group: "JHS_45MIN" },
        { class_id: 11, section_name: "Copernicus", academic_level_id: 9, academic_year_id: 1, period_template_group: "JHS_45MIN" },
      ],
      existing_loads: [
        {
          subject_load_id: 700,
          class_id: 10,
          subject_id: 100,
          staff_id: "T001",
          academic_period_id: 1,
          slot_id: 2,
          start_time: "08:00",
          end_time: "08:45",
          days_of_week: ["MON", "TUE", "WED", "THU", "FRI"],
          status: "published",
          is_locked: true,
          section_revision: 1,
        },
        {
          subject_load_id: 701,
          class_id: 10,
          subject_id: 101,
          staff_id: "T002",
          academic_period_id: 1,
          slot_id: 9,
          start_time: "13:00",
          end_time: "14:00",
          days_of_week: ["MON", "TUE", "WED", "THU", "FRI"],
          status: "published",
          is_locked: true,
          section_revision: 1,
        },
      ],
      has_pending_draft_by_class: { 10: false, 11: false },
      published_load_count_by_class: { 10: 2, 11: 0 },
    });
    mocks.getSubjectLoadStudioData.mockResolvedValue(data);

    render(<AdminSubjectLoadStudio />);

    await waitFor(() => {
      expect(screen.getByText("Filipino 9")).toBeTruthy();
    });

    expect(screen.queryByRole("button", { name: /auto-generate/i })).toBeNull();
    expect(screen.queryByText(/auto-fit section/i)).toBeNull();
    expect(mocks.batchSaveSubjectLoads).not.toHaveBeenCalled();

    // Opening the page validated the preserved published loads and kept fresh section 11 unscheduled.
    expect(mocks.validateSubjectLoads).toHaveBeenCalledTimes(1);
    const validatedLoads = mocks.validateSubjectLoads.mock.calls[0][1];
    expect(validatedLoads.find((l: { class_id: number; subject_id: number }) => l.class_id === 10 && l.subject_id === 100)).toMatchObject({
      start_time: "08:00",
      end_time: "08:45",
      status: "published",
      is_locked: true,
    });
    expect(validatedLoads.filter((l: { class_id: number }) => l.class_id === 11).every(
      (l: { start_time: string | null; end_time: string | null; days_of_week: string[] }) =>
        l.start_time === null && l.end_time === null && l.days_of_week.length === 0
    )).toBe(true);
  });

  it("supports manual Grid placement and teacher assignment for an unscheduled fresh JHS section", async () => {
    mocks.getSubjectLoadStudioData.mockResolvedValue(makeStudioData());

    render(<AdminSubjectLoadStudio />);

    await waitFor(() => {
      expect(screen.getByLabelText("Monday 8:00 AM - 8:45 AM")).toBeTruthy();
    });

    // No subject card is pre-placed on the timetable grid.
    expect(screen.queryByText("Filipino 9")).toBeNull();
    expect(screen.queryByRole("button", { name: /more options/i })).toBeNull();

    // Click empty cell -> Add Subject -> Filipino 9
    fireEvent.click(screen.getByLabelText("Monday 8:00 AM - 8:45 AM"));
    fireEvent.click(screen.getByRole("button", { name: "Filipino 9" }));

    await waitFor(() => {
      expect(screen.getByText("Filipino 9")).toBeTruthy();
    });

    const afterPlaceLoads = mocks.validateSubjectLoads.mock.calls.at(-1)?.[1];
    expect(afterPlaceLoads.find((l: { subject_id: number }) => l.subject_id === 100)).toMatchObject({
      slot_id: 2,
      start_time: "08:00",
      end_time: "08:45",
      days_of_week: ["MON"],
      staff_id: null,
    });

    // Click placed subject card -> Assign Teacher -> Angel Alcantara
    fireEvent.click(screen.getByText("Filipino 9"));
    const dialog = await screen.findByRole("dialog");
    const row = within(dialog).getByText("Angel Alcantara").closest("tr");
    expect(row).toBeTruthy();
    fireEvent.click(within(row!).getByRole("button", { name: /assign/i }));

    await waitFor(() => {
      expect(screen.getByText("Angel Alcantara")).toBeTruthy();
    });
    const afterAssignLoads = mocks.validateSubjectLoads.mock.calls.at(-1)?.[1];
    expect(afterAssignLoads.find((l: { subject_id: number }) => l.subject_id === 100)).toMatchObject({
      staff_id: "T001",
      start_time: "08:00",
      end_time: "08:45",
      days_of_week: ["MON"],
    });
  });

  it("allows assigning a shared teacher across two fresh unscheduled sections without deadlock", async () => {
    mocks.getSubjectLoadStudioData.mockResolvedValue(
      makeStudioData({
        classes: [
          { class_id: 10, section_name: "Archimedes", academic_level_id: 9, academic_year_id: 1, period_template_group: "JHS_45MIN" },
          { class_id: 11, section_name: "Copernicus", academic_level_id: 9, academic_year_id: 1, period_template_group: "JHS_45MIN" },
        ],
        has_pending_draft_by_class: { 10: false, 11: false },
        published_load_count_by_class: { 10: 0, 11: 0 },
      })
    );

    render(<AdminSubjectLoadStudio />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Archimedes" })).toBeTruthy();
    });

    // Switch to List view
    fireEvent.click(screen.getByRole("radio", { name: "List" }));

    // Assign Angel Alcantara to Filipino 9 in Archimedes
    const filipinoRowA = screen.getByText("Filipino 9").closest("tr")!;
    fireEvent.click(within(filipinoRowA).getByRole("button", { name: /assign teacher/i }));
    let dialog = await screen.findByRole("dialog");
    fireEvent.click(within(within(dialog).getByText("Angel Alcantara").closest("tr")!).getByRole("button", { name: /assign/i }));
    await waitFor(() => {
      expect(within(filipinoRowA).getByText("Angel Alcantara")).toBeTruthy();
    });

    // Switch to Copernicus and assign the same teacher before placing times — must NOT be deadlocked!
    fireEvent.click(screen.getByRole("button", { name: "Copernicus" }));
    const filipinoRowB = screen.getByText("Filipino 9").closest("tr")!;
    fireEvent.click(within(filipinoRowB).getByRole("button", { name: /assign teacher/i }));
    dialog = await screen.findByRole("dialog");
    const angelAssignBtn = within(within(dialog).getByText("Angel Alcantara").closest("tr")!).getByRole("button", { name: /assign/i });
    expect((angelAssignBtn as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(angelAssignBtn);

    await waitFor(() => {
      expect(within(filipinoRowB).getByText("Angel Alcantara")).toBeTruthy();
    });
  });

  it("uses an SHS period dropdown instead of free-form time inputs in List View and syncs with Timetable Grid", async () => {
    const shsData = makeStudioData({
      academic_levels: [{ academic_level_id: 11, level_name: "Grade 11", grade_level: 11 }],
      classes: [
        { class_id: 20, section_name: "Zara", academic_level_id: 11, academic_year_id: 1, period_template_group: "SHS_CAMPOS_ZARA" },
      ],
      subjects: [
        { subject_id: 200, subject_name: "Research 1", subject_codename: "RES1", academic_level_id: 11, grading_template: "Core", is_core: true },
      ],
      subject_offerings: [
        { subject_offering_id: 20, subject_id: 200, academic_year_id: 1, academic_level_id: 11, academic_period_id: 1, pathway: "general", pathway_ids: [], minutes: 60 },
      ],
      period_template_slots: [...JHS_TEMPLATE_SLOTS, ...SHS_TEMPLATE_SLOTS],
      has_pending_draft_by_class: { 20: false },
      published_load_count_by_class: { 20: 0 },
    });
    mocks.apiFetch.mockResolvedValue({ ok: true, json: async () => [...JHS_TEMPLATE_SLOTS, ...SHS_TEMPLATE_SLOTS] });
    mocks.getSubjectLoadStudioData.mockResolvedValue(shsData);

    render(<AdminSubjectLoadStudio />);

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "List" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("radio", { name: "List" }));

    const row = (await screen.findByText("Research 1")).closest("tr")!;
    // Free-form start/end time pickers must be gone for Grade 11-12
    expect(within(row).queryByPlaceholderText("08:00 am")).toBeNull();

    // Open the SHS period dropdown and verify ONLY duration-compatible CLASS slots for SHS_CAMPOS_ZARA appear
    const periodTrigger = within(row).getByRole("combobox", { name: "Schedule period for Research 1" });
    fireEvent.keyDown(periodTrigger, { key: "ArrowDown" });

    const options = await screen.findAllByRole("option");
    const optionTexts = options.map((opt) => opt.textContent?.trim() || "");
    expect(optionTexts).toEqual([
      "Period 1 — 8:00 AM–9:00 AM",
      "Period 2 — 9:00 AM–10:00 AM",
      "Period 3 — 1:00 PM–2:00 PM",
    ]);
    // Breaks, wrong-duration 96m Lab Block, JHS 45m slots, and SHS_DELMUNDO_REYES 72m slots are excluded
    expect(optionTexts.join(" | ")).not.toContain("Morning Recess");
    expect(optionTexts.join(" | ")).not.toContain("Lab Block");
    expect(optionTexts.join(" | ")).not.toContain("9:12");
    expect(optionTexts.join(" | ")).not.toContain("8:45");

    // Pick Period 2 (09:00-10:00, slot_id 102) and toggle Monday
    fireEvent.click(options[1]);
    fireEvent.click(within(row).getByRole("button", { name: "M" }));

    await waitFor(() => {
      const latestLoads = mocks.validateSubjectLoads.mock.calls.at(-1)?.[1];
      expect(latestLoads[0]).toMatchObject({
        subject_id: 200,
        slot_id: 102,
        start_time: "09:00",
        end_time: "10:00",
        days_of_week: ["MON"],
      });
    });

    // Switch back to Timetable Grid and verify Research 1 is synchronized at 9:00 AM - 10:00 AM
    fireEvent.click(screen.getByRole("radio", { name: "Timetable" }));
    const gridCard = await screen.findByText("Research 1");
    expect(gridCard.closest("[data-slot-time]")?.getAttribute("data-slot-time")).toBe("09:00-10:00");
    expect(gridCard.closest("[data-slot-days]")?.getAttribute("data-slot-days")).toBe("MON");
  });

  it("prioritizes blocking errors over UNASSIGNED_TEACHER warnings in both Grid and List views without losing conflict details", async () => {
    const conflictsFromBackend: ConflictItem[] = [
      // Duplicate UNASSIGNED_TEACHER warnings emitted for a 2-slot unassigned subject (mirrors ConflictDetectorService Rule 0)
      {
        rule: "UNASSIGNED_TEACHER",
        severity: "warning",
        message: "Subject 'Filipino 9' in section 'Archimedes' has no assigned teacher.",
        class_id: 10,
        subject_id: 100,
        affected_key: "10_100",
      },
      {
        rule: "UNASSIGNED_TEACHER",
        severity: "warning",
        message: "Subject 'Filipino 9' in section 'Archimedes' has no assigned teacher.",
        class_id: 10,
        subject_id: 100,
        affected_key: "10_100",
      },
      {
        rule: "SECTION_OVERLAP",
        severity: "error",
        message: "Section Archimedes has overlapping subjects on MON (Filipino 9 at 08:00-08:45 vs Math 9 at 08:00-09:00).",
        class_id: 10,
        subject_id: 100,
        affected_key: "10_100",
        affected_keys: ["10_100", "10_101"],
        related_class_id: 10,
        related_subject_id: 101,
        related_affected_key: "10_101",
      },
      {
        rule: "OFFERING_DURATION_MISMATCH",
        severity: "error",
        message: "Subject 'Filipino 9' is configured for 45 minutes in Curriculum Plan, but the selected timetable slot is 60 minutes.",
        class_id: 10,
        subject_id: 100,
        affected_key: "10_100",
      },
    ];

    mocks.getSubjectLoadStudioData.mockResolvedValue(
      makeStudioData({
        existing_loads: [
          {
            subject_load_id: 701,
            class_id: 10,
            subject_id: 100,
            staff_id: null,
            academic_period_id: 1,
            slot_id: 2,
            start_time: "08:00",
            end_time: "08:45",
            days_of_week: ["MON", "WED"],
            status: "draft",
            is_locked: false,
            section_revision: 1,
          },
          {
            subject_load_id: 702,
            class_id: 10,
            subject_id: 100,
            staff_id: null,
            academic_period_id: 1,
            slot_id: 3,
            start_time: "08:45",
            end_time: "09:30",
            days_of_week: ["TUE", "THU"],
            status: "draft",
            is_locked: false,
            section_revision: 1,
          },
          {
            subject_load_id: 703,
            class_id: 10,
            subject_id: 101,
            staff_id: "T002",
            academic_period_id: 1,
            slot_id: 2,
            start_time: "08:00",
            end_time: "08:45",
            days_of_week: ["MON"],
            status: "draft",
            is_locked: false,
            section_revision: 1,
          },
        ],
        has_pending_draft_by_class: { 10: true },
      })
    );
    mocks.validateSubjectLoads.mockResolvedValue({
      is_valid: false,
      conflicts: conflictsFromBackend,
      teacher_workloads: [],
    });

    render(<AdminSubjectLoadStudio />);

    // Timetable Grid View: slot card must show destructive error styling and keep all conflict messages in tooltip
    await waitFor(() => {
      const slotCard = document.getElementById("timetable-slot-10_100");
      expect(slotCard).toBeTruthy();
      expect(slotCard!.className).toContain("border-destructive");
      expect(slotCard!.className).not.toContain("border-amber-400");
      const tooltip = slotCard!.getAttribute("title") || "";
      expect(tooltip).toContain("Conflict: Section Archimedes has overlapping subjects on MON");
      expect(tooltip).toContain("Conflict: Subject 'Filipino 9' is configured for 45 minutes");
      expect(tooltip).toContain("Warning: Subject 'Filipino 9' in section 'Archimedes' has no assigned teacher.");
    });

    // Switch to List View: row must highlight as error, list blocking Conflicts before Warning, and deduplicate repeated warning
    fireEvent.click(screen.getByRole("radio", { name: "List" }));

    await waitFor(() => {
      const row = document.getElementById("subject-row-10_100");
      expect(row).toBeTruthy();
      expect(row!.className).toContain("bg-destructive/10");

      const rowText = row!.textContent || "";
      const overlapIdx = rowText.indexOf("Conflict: Section Archimedes has overlapping subjects on MON");
      const durationIdx = rowText.indexOf("Conflict: Subject 'Filipino 9' is configured for 45 minutes");
      const unassignedIdx = rowText.indexOf("Warning: Subject 'Filipino 9' in section 'Archimedes' has no assigned teacher.");

      expect(overlapIdx).toBeGreaterThan(-1);
      expect(durationIdx).toBeGreaterThan(overlapIdx);
      expect(unassignedIdx).toBeGreaterThan(durationIdx);
      // Repeated UNASSIGNED_TEACHER from 2 slots must appear once, not twice
      expect(rowText.match(/has no assigned teacher\./g)).toHaveLength(1);
    });
  });
});

describe("getLoadConflictSummary (C5 conflict prioritization)", () => {
  it("prioritizes blocking errors over UNASSIGNED_TEACHER warnings while retaining all unique details", () => {
    const conflicts: ConflictItem[] = [
      {
        rule: "UNASSIGNED_TEACHER",
        severity: "warning",
        message: "Subject 'Math 9' in section 'Archimedes' has no assigned teacher.",
        class_id: 10,
        subject_id: 101,
        affected_key: "10_101",
      },
      {
        rule: "UNASSIGNED_TEACHER",
        severity: "warning",
        message: "Subject 'Math 9' in section 'Archimedes' has no assigned teacher.",
        class_id: 10,
        subject_id: 101,
        affected_key: "10_101",
      },
      {
        rule: "CORE_SUBJECT_SPLIT_SCHEDULE",
        severity: "warning",
        message: "Core subject 'Math 9' is scheduled for only 2 days.",
        class_id: 10,
        subject_id: 101,
        affected_key: "10_101",
      },
      {
        rule: "BREAK_TIME_VIOLATION",
        severity: "error",
        message: "Subject 'Math 9' overlaps with Lunch Break (12:00-13:00).",
        class_id: 10,
        subject_id: 101,
        affected_key: "10_101",
      },
    ];

    const summary = getLoadConflictSummary(conflicts, 10, 101);
    expect(summary).toBeDefined();
    expect(summary!.primary.rule).toBe("BREAK_TIME_VIOLATION");
    expect(summary!.primary.severity).toBe("error");
    expect(summary!.all.map((c) => c.rule)).toEqual([
      "BREAK_TIME_VIOLATION",
      "CORE_SUBJECT_SPLIT_SCHEDULE",
      "UNASSIGNED_TEACHER",
    ]);
    expect(summary!.errors).toHaveLength(1);
    expect(summary!.warnings).toHaveLength(2);
    expect(summary!.additionalCount).toBe(2);
    expect(summary!.tooltip).toContain("Conflict: Subject 'Math 9' overlaps with Lunch Break");
    expect(summary!.tooltip).toContain("Warning: Core subject 'Math 9' is scheduled for only 2 days.");
    expect(summary!.tooltip).toContain("Warning: Subject 'Math 9' in section 'Archimedes' has no assigned teacher.");
  });

  it("prioritizes non-unassigned schedule warnings over UNASSIGNED_TEACHER when no errors exist", () => {
    const conflicts: ConflictItem[] = [
      {
        rule: "UNASSIGNED_TEACHER",
        severity: "warning",
        message: "No teacher.",
        class_id: 10,
        subject_id: 101,
        affected_key: "10_101",
      },
      {
        rule: "CORE_SUBJECT_SPLIT_SCHEDULE",
        severity: "warning",
        message: "Split schedule.",
        class_id: 10,
        subject_id: 101,
        affected_key: "10_101",
      },
    ];

    const ordered = getLoadConflicts(conflicts, 10, 101);
    expect(ordered.map((c) => c.rule)).toEqual([
      "CORE_SUBJECT_SPLIT_SCHEDULE",
      "UNASSIGNED_TEACHER",
    ]);
  });

  it("still surfaces UNASSIGNED_TEACHER when it is the only warning and matches related_affected_key errors", () => {
    const conflicts: ConflictItem[] = [
      {
        rule: "UNASSIGNED_TEACHER",
        severity: "warning",
        message: "No teacher on 10_100.",
        class_id: 10,
        subject_id: 100,
        affected_key: "10_100",
      },
      {
        rule: "SECTION_OVERLAP",
        severity: "error",
        message: "Overlap with 10_101.",
        class_id: 10,
        subject_id: 100,
        affected_key: "10_100",
        affected_keys: ["10_100", "10_101"],
        related_class_id: 10,
        related_subject_id: 101,
        related_affected_key: "10_101",
      },
    ];

    // 10_101 matched via related_affected_key
    const relatedSummary = getLoadConflictSummary(conflicts, 10, 101);
    expect(relatedSummary?.primary.rule).toBe("SECTION_OVERLAP");

    // Standalone UNASSIGNED_TEACHER still returns warning
    const onlyWarning = getLoadConflictSummary([conflicts[0]], 10, 100);
    expect(onlyWarning?.primary.rule).toBe("UNASSIGNED_TEACHER");
    expect(onlyWarning?.primary.severity).toBe("warning");
  });
});

describe("Task 4: conflict diagnosis, slot precision, teacher-wide caps, and fresh validation", () => {
  it("highlights only the conflicting slot on a multi-slot subject and explains non-teacher conflicts when clicked", async () => {
    mocks.getSubjectLoadStudioData.mockResolvedValue(
      makeStudioData({
        existing_loads: [
          {
            subject_load_id: 801,
            class_id: 10,
            subject_id: 100,
            staff_id: "T001",
            academic_period_id: 1,
            slot_id: 2,
            start_time: "08:00",
            end_time: "08:45",
            days_of_week: ["MON", "WED"],
            status: "draft",
            is_locked: false,
            section_revision: 1,
          },
          {
            subject_load_id: 802,
            class_id: 10,
            subject_id: 100,
            staff_id: "T001",
            academic_period_id: 1,
            slot_id: 9,
            start_time: "13:00",
            end_time: "14:00",
            days_of_week: ["TUE", "THU"],
            status: "draft",
            is_locked: false,
            section_revision: 1,
          },
        ],
        has_pending_draft_by_class: { 10: true },
      }),
    );

    mocks.validateSubjectLoads.mockResolvedValue({
      is_valid: false,
      conflicts: [
        {
          rule: "OFFERING_DURATION_MISMATCH",
          severity: "error",
          message:
            "Subject 'Filipino 9' is configured for 45 minutes in Curriculum Plan, but the selected timetable slot is 60 minutes.",
          class_id: 10,
          subject_id: 100,
          days: ["TUE", "THU"],
          start_time: "13:00",
          end_time: "14:00",
          slot_id: 9,
          subject_load_id: 802,
          affected_key: "10_100",
        },
      ],
      teacher_workloads: [],
    });

    render(<AdminSubjectLoadStudio />);

    await waitFor(() => {
      const cards = document.querySelectorAll('[id="timetable-slot-10_100"]');
      expect(cards.length).toBeGreaterThanOrEqual(2);
    });

    const cleanCards = Array.from(
      document.querySelectorAll('[id="timetable-slot-10_100"][data-slot-time="08:00-08:45"]'),
    );
    const conflictingCards = Array.from(
      document.querySelectorAll('[id="timetable-slot-10_100"][data-slot-time="13:00-14:00"]'),
    );

    expect(cleanCards.length).toBeGreaterThan(0);
    expect(conflictingCards.length).toBeGreaterThan(0);
    for (const card of cleanCards) {
      expect(card.getAttribute("data-conflict-severity")).toBe("none");
      expect(card.className).not.toContain("border-destructive");
    }
    for (const card of conflictingCards) {
      expect(card.getAttribute("data-conflict-severity")).toBe("error");
      expect(card.className).toContain("border-destructive");
    }

    // Clicking the red card opens the dialog with clear conflict explanation and "Edit schedule in List View" action
    fireEvent.click(conflictingCards[0]);
    const dialog = await screen.findByRole("dialog");
    const alert = within(dialog).getByRole("alert");
    expect(alert.textContent).toContain("Conflict: Period duration mismatch");
    expect(alert.textContent).toContain("configured for 45 minutes in Curriculum Plan");
    expect(alert.textContent).toContain("Reassigning the teacher will not fix this");

    // Clicking "Edit schedule in List View" switches to List View and closes the dialog
    fireEvent.click(within(dialog).getByRole("button", { name: /edit schedule in list view/i }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(document.getElementById("subject-row-10_100")).toBeTruthy();
    });
  });

  it("reflects teacher-wide DAILY_WORKLOAD_EXCEEDED in section badge, publish guard, overloaded-day slot only, and modal diagnosis", async () => {
    mocks.getSubjectLoadStudioData.mockResolvedValue(
      makeStudioData({
        subjects: [
          {
            subject_id: 100,
            subject_name: "Filipino 9",
            subject_codename: "FIL9",
            academic_level_id: 9,
            grading_template: "Core",
            is_core: true,
          },
        ],
        subject_offerings: [
          {
            subject_offering_id: 1,
            subject_id: 100,
            academic_year_id: 1,
            academic_level_id: 9,
            academic_period_id: 1,
            pathway: "general",
            pathway_ids: [],
            minutes: 45,
          },
        ],
        existing_loads: [
          {
            subject_load_id: 901,
            class_id: 10,
            subject_id: 100,
            staff_id: "T001",
            academic_period_id: 1,
            slot_id: 2,
            start_time: "08:00",
            end_time: "08:45",
            days_of_week: ["MON"],
            status: "draft",
            is_locked: false,
            section_revision: 1,
          },
          {
            subject_load_id: 902,
            class_id: 10,
            subject_id: 100,
            staff_id: "T001",
            academic_period_id: 1,
            slot_id: 3,
            start_time: "08:45",
            end_time: "09:30",
            days_of_week: ["TUE"],
            status: "draft",
            is_locked: false,
            section_revision: 1,
          },
        ],
        has_pending_draft_by_class: { 10: true },
      }),
    );

    // Emit DAILY_WORKLOAD_EXCEEDED for T001 on MON (even without class_id)
    mocks.validateSubjectLoads.mockResolvedValue({
      is_valid: false,
      conflicts: [
        {
          rule: "DAILY_WORKLOAD_EXCEEDED",
          severity: "error",
          message: "Teacher Angel Alcantara exceeds max 6 subjects/day on MON (7 subjects scheduled).",
          staff_id: "T001",
          day: "MON",
          days: ["MON"],
          affected_keys: ["10_100"],
        },
      ],
      teacher_workloads: [
        {
          staff_id: "T001",
          staff_name: "Angel Alcantara",
          daily_hours: { MON: 5.25, TUE: 1.5 },
          daily_subjects_count: { MON: 7, TUE: 2 },
          total_weekly_hours: 6.75,
          has_capacity_warning: true,
        },
      ],
    });

    render(<AdminSubjectLoadStudio />);

    await waitFor(() => {
      expect(screen.getByText(/1 conflict — must resolve to publish/i)).toBeTruthy();
    });

    // Section publish button must be disabled when DAILY_WORKLOAD_EXCEEDED affects the section
    const publishSectionBtn = screen.getByRole("button", { name: /^publish$/i }) as HTMLButtonElement;
    expect(publishSectionBtn.disabled).toBe(true);

    // Only the MON card should be red; TUE card must remain clean
    const monCard = document.querySelector('[id="timetable-slot-10_100"][data-slot-days="MON"]')!;
    const tueCard = document.querySelector('[id="timetable-slot-10_100"][data-slot-days="TUE"]')!;
    expect(monCard.getAttribute("data-conflict-severity")).toBe("error");
    expect(tueCard.getAttribute("data-conflict-severity")).toBe("none");

    // Clicking the red MON card explains the daily limit conflict
    fireEvent.click(monCard);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("alert").textContent).toContain("Teacher daily limit exceeded");
    expect(within(dialog).getByRole("alert").textContent).toContain("exceeds max 6 subjects/day on MON");
  });

  it("ignores stale out-of-order validation responses so conflicts refresh cleanly after edits", async () => {
    mocks.getSubjectLoadStudioData.mockResolvedValue(
      makeStudioData({
        subjects: [
          {
            subject_id: 100,
            subject_name: "Filipino 9",
            subject_codename: "FIL9",
            academic_level_id: 9,
            grading_template: "Core",
            is_core: true,
          },
        ],
        subject_offerings: [
          {
            subject_offering_id: 1,
            subject_id: 100,
            academic_year_id: 1,
            academic_level_id: 9,
            academic_period_id: 1,
            pathway: "general",
            pathway_ids: [],
            minutes: 45,
          },
        ],
        existing_loads: [
          {
            subject_load_id: 950,
            class_id: 10,
            subject_id: 100,
            staff_id: "T001",
            academic_period_id: 1,
            slot_id: 2,
            start_time: "08:00",
            end_time: "08:45",
            days_of_week: ["MON", "WED"],
            status: "draft",
            is_locked: false,
            section_revision: 1,
          },
        ],
        has_pending_draft_by_class: { 10: true },
      }),
    );

    const overlapConflict: ConflictItem = {
      rule: "TEACHER_OVERLAP",
      severity: "error",
      message: "Teacher Angel Alcantara is double-booked on MON (08:00-08:45 in Archimedes vs 08:00-08:45 in Other).",
      class_id: 10,
      subject_id: 100,
      staff_id: "T001",
      day: "MON",
      days: ["MON"],
      start_time: "08:00",
      end_time: "08:45",
      subject_load_id: 950,
      affected_key: "10_100",
      affected_keys: ["10_100"],
    };

    let resolveSlowStaleValidation!: (val: { is_valid: boolean; conflicts: ConflictItem[]; teacher_workloads: [] }) => void;
    const slowStalePromise = new Promise<{ is_valid: boolean; conflicts: ConflictItem[]; teacher_workloads: [] }>((resolve) => {
      resolveSlowStaleValidation = resolve;
    });

    mocks.validateSubjectLoads
      .mockResolvedValueOnce({ is_valid: false, conflicts: [overlapConflict], teacher_workloads: [] })
      .mockReturnValueOnce(slowStalePromise)
      .mockResolvedValueOnce({ is_valid: true, conflicts: [], teacher_workloads: [] });

    render(<AdminSubjectLoadStudio />);

    await waitFor(() => {
      const monCard = document.querySelector('[id="timetable-slot-10_100"][data-slot-days="MON"]');
      expect(monCard?.getAttribute("data-conflict-severity")).toBe("error");
    });

    // Switch to List View: trigger edit #1 (toggle FRI -> fires slow validation #2)
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    const row = document.getElementById("subject-row-10_100")!;
    fireEvent.click(within(row).getByRole("button", { name: "F" }));

    // Immediately trigger edit #2 (reassign teacher -> fires fast validation #3 returning clean [])
    fireEvent.click(within(row).getByRole("button", { name: /angel alcantara/i }));
    const dialog = await screen.findByRole("dialog");
    const ramonRow = within(dialog).getByText("Ramon Reyes").closest("tr")!;
    fireEvent.click(within(ramonRow).getByRole("button", { name: /assign/i }));

    await waitFor(() => {
      expect(document.getElementById("subject-row-10_100")!.textContent).not.toContain("double-booked");
    });

    // Now the older slow validation #2 resolves late with the stale overlap conflict — must be ignored!
    resolveSlowStaleValidation({ is_valid: false, conflicts: [overlapConflict], teacher_workloads: [] });

    await new Promise((r) => setTimeout(r, 30));
    expect(document.getElementById("subject-row-10_100")!.textContent).not.toContain("double-booked");
    expect(screen.queryByText(/1 conflict — must resolve to publish/i)).toBeNull();
  });

  it("correctly evaluates slot-level matching, section-level teacher workload matching, and teacher daily caps", () => {
    const teacherOverlap: ConflictItem = {
      rule: "TEACHER_OVERLAP",
      severity: "error",
      message: "Double-booked on MON.",
      class_id: 10,
      subject_id: 100,
      staff_id: "T001",
      day: "MON",
      days: ["MON"],
      start_time: "08:00",
      end_time: "08:45",
      subject_load_id: 1,
      affected_key: "10_100",
      affected_keys: ["10_100", "11_200"],
      related_class_id: 11,
      related_subject_id: 200,
      related_affected_key: "11_200",
      related_start_time: "08:00",
      related_end_time: "08:45",
      related_subject_load_id: 2,
    };

    const unscheduledDraftErr: ConflictItem = {
      rule: "UNSCHEDULED_LOAD",
      severity: "error",
      message: "Missing time.",
      class_id: 10,
      subject_id: 100,
      days: [],
      start_time: null,
      end_time: null,
      affected_key: "10_100",
    };

    // Slot 1 MON matches overlap; Slot 1 WED does not; unscheduled error does not highlight placed slot
    expect(
      getSlotConflictSummary([teacherOverlap, unscheduledDraftErr], {
        class_id: 10,
        subject_id: 100,
        staff_id: "T001",
        subject_load_id: 1,
        start_time: "08:00",
        end_time: "08:45",
        days_of_week: ["MON", "WED"],
      }, ["MON"])?.primary.rule,
    ).toBe("TEACHER_OVERLAP");

    expect(
      getSlotConflictSummary([teacherOverlap, unscheduledDraftErr], {
        class_id: 10,
        subject_id: 100,
        staff_id: "T001",
        subject_load_id: 1,
        start_time: "08:00",
        end_time: "08:45",
        days_of_week: ["MON", "WED"],
      }, ["WED"]),
    ).toBeUndefined();

    // conflictAffectsSection catches DAILY_WORKLOAD_EXCEEDED via staff_id even when affected_keys is empty
    const workloadNoKeys: ConflictItem = {
      rule: "DAILY_WORKLOAD_EXCEEDED",
      severity: "error",
      message: "Exceeds max 6 subjects/day on MON.",
      staff_id: "T001",
      day: "MON",
    };
    expect(
      conflictAffectsSection(workloadNoKeys, 10, [
        { class_id: 10, subject_id: 100, staff_id: "T001", academic_period_id: 1, days_of_week: ["MON"] },
      ]),
    ).toBe(true);
    expect(
      conflictAffectsSection(workloadNoKeys, 10, [
        { class_id: 10, subject_id: 100, staff_id: "T001", academic_period_id: 1, days_of_week: ["TUE"] },
      ]),
    ).toBe(false);

    // describeConflictForAdmin distinguishes teacher-fixable vs schedule-fixable conflicts
    expect(describeConflictForAdmin(teacherOverlap).canFixByTeacherChange).toBe(true);
    expect(describeConflictForAdmin(unscheduledDraftErr).canFixByTeacherChange).toBe(false);

    // teacherAssignmentConflict flags exceeding daily subject caps when assigning a teacher
    const existingSixLoads = [1, 2, 3, 4, 5, 6].map((cid, idx) => ({
      class_id: cid,
      subject_id: 100,
      staff_id: "T001",
      academic_period_id: 1,
      start_time: `${String(8 + idx).padStart(2, "0")}:00`,
      end_time: `${String(8 + idx).padStart(2, "0")}:45`,
      days_of_week: ["MON"],
    }));
    const targetSeventhLoad = {
      class_id: 7,
      subject_id: 100,
      staff_id: null,
      academic_period_id: 1,
      start_time: "15:00",
      end_time: "15:45",
      days_of_week: ["MON"],
    };
    const capMsg = teacherAssignmentConflict(
      [...existingSixLoads, targetSeventhLoad],
      "T001",
      7,
      100,
      [],
      [],
      { maxSubjectsPerDay: 6, maxHoursPerDay: 6 },
    );
    expect(capMsg).toContain("Conflict: Exceeds max 6 subjects/day on Mon (7 scheduled)");
  });
});

describe("Task 5: Standardized SHS period scheduling", () => {
  it("respects each SHS section's assigned Break Timeline (Medical vs Engineering vs Custom) without leaking slots", async () => {
    const allSlots = [...JHS_TEMPLATE_SLOTS, ...SHS_TEMPLATE_SLOTS];
    const shsData = makeStudioData({
      academic_levels: [{ academic_level_id: 11, level_name: "Grade 11", grade_level: 11 }],
      classes: [
        { class_id: 20, section_name: "Zara", academic_level_id: 11, academic_year_id: 1, period_template_group: "SHS_CAMPOS_ZARA", pathway_name: "Medical", pathway_is_enabled: true, requires_pathway: true, pathway_id: 1 },
        { class_id: 21, section_name: "Reyes", academic_level_id: 11, academic_year_id: 1, period_template_group: "SHS_DELMUNDO_REYES", pathway_name: "Engineering", pathway_is_enabled: true, requires_pathway: true, pathway_id: 2 },
        { class_id: 22, section_name: "Galen", academic_level_id: 11, academic_year_id: 1, period_template_group: "SHS_MEDICAL_CUSTOM", pathway_name: "Medical", pathway_is_enabled: true, requires_pathway: true, pathway_id: 1 },
      ],
      subjects: [
        { subject_id: 201, subject_name: "Research Lab", subject_codename: "RESLAB", academic_level_id: 11, grading_template: "Core", is_core: false },
        { subject_id: 202, subject_name: "Pre-Calculus", subject_codename: "PRECAL", academic_level_id: 11, grading_template: "Core", is_core: true },
        { subject_id: 203, subject_name: "Clinical Practicum", subject_codename: "CLIN", academic_level_id: 11, grading_template: "Core", is_core: false },
      ],
      subject_offerings: [
        { subject_offering_id: 201, subject_id: 201, academic_year_id: 1, academic_level_id: 11, academic_period_id: 1, pathway: "general", pathway_ids: [], minutes: 96 },
        { subject_offering_id: 202, subject_id: 202, academic_year_id: 1, academic_level_id: 11, academic_period_id: 1, pathway: "general", pathway_ids: [], minutes: 72 },
        { subject_offering_id: 203, subject_id: 203, academic_year_id: 1, academic_level_id: 11, academic_period_id: 1, pathway: "general", pathway_ids: [], minutes: 80 },
      ],
      period_template_slots: allSlots,
      has_pending_draft_by_class: { 20: false, 21: false, 22: false },
      published_load_count_by_class: { 20: 0, 21: 0, 22: 0 },
    });
    mocks.apiFetch.mockResolvedValue({ ok: true, json: async () => allSlots });
    mocks.getSubjectLoadStudioData.mockResolvedValue(shsData);

    render(<AdminSubjectLoadStudio />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Zara/i })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("radio", { name: "List" }));

    // 1. Zara (SHS_CAMPOS_ZARA): 96-min Research Lab gets ONLY Lab Block (10:24-12:00)
    const labRow = (await screen.findByText("Research Lab")).closest("tr")!;
    fireEvent.keyDown(within(labRow).getByRole("combobox", { name: "Schedule period for Research Lab" }), { key: "ArrowDown" });
    let options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent?.trim())).toEqual(["Lab Block — 10:24 AM–12:00 PM"]);
    fireEvent.keyDown(options[0], { key: "Escape" });

    // Pre-Calculus (72m) has NO matching period in SHS_CAMPOS_ZARA -> shows explanation + Edit Break Timelines targeting SHS_CAMPOS_ZARA
    const precalRowZara = screen.getByText("Pre-Calculus").closest("tr")!;
    expect(within(precalRowZara).getByText(/No 72-minute class period exists in SHS Template A/i)).toBeTruthy();
    const editBtnZara = within(precalRowZara).getByRole("button", { name: /Edit Break Timelines/i });
    fireEvent.click(editBtnZara);
    const drawer = await screen.findByTestId("break-config-drawer");
    expect(drawer.getAttribute("data-initial-group")).toBe("SHS_CAMPOS_ZARA");

    // 2. Switch to Reyes (SHS_DELMUNDO_REYES): 72-min Pre-Calculus gets ONLY its two 72-min periods
    fireEvent.click(screen.getByRole("button", { name: /Reyes/i }));
    const precalRowReyes = (await screen.findByText("Pre-Calculus")).closest("tr")!;
    fireEvent.keyDown(within(precalRowReyes).getByRole("combobox", { name: "Schedule period for Pre-Calculus" }), { key: "ArrowDown" });
    options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      "Period 1 — 8:00 AM–9:12 AM",
      "Period 2 — 9:12 AM–10:24 AM",
    ]);
    fireEvent.keyDown(options[0], { key: "Escape" });

    // 3. Switch to Galen (SHS_MEDICAL_CUSTOM): 80-min Clinical Practicum gets ONLY Clinical Block 1 & 2
    fireEvent.click(screen.getByRole("button", { name: /Galen/i }));
    const clinRowGalen = (await screen.findByText("Clinical Practicum")).closest("tr")!;
    fireEvent.keyDown(within(clinRowGalen).getByRole("combobox", { name: "Schedule period for Clinical Practicum" }), { key: "ArrowDown" });
    options = await screen.findAllByRole("option");
    expect(options.map((o) => o.textContent?.trim())).toEqual([
      "Clinical Block 1 — 8:00 AM–9:20 AM",
      "Clinical Block 2 — 9:40 AM–11:00 AM",
    ]);
  });

  it("explains missing Break Timeline for an unassigned Grade 12 section without inventing times or falling back to JHS", async () => {
    const allSlots = [...JHS_TEMPLATE_SLOTS, ...SHS_TEMPLATE_SLOTS];
    const shsData = makeStudioData({
      academic_levels: [{ academic_level_id: 12, level_name: "Grade 12", grade_level: 12 }],
      classes: [
        { class_id: 30, section_name: "12-Unassigned", academic_level_id: 12, academic_year_id: 1, period_template_group: null },
      ],
      subjects: [
        { subject_id: 300, subject_name: "Capstone Project", subject_codename: "CAP12", academic_level_id: 12, grading_template: "Core", is_core: true },
      ],
      subject_offerings: [
        { subject_offering_id: 300, subject_id: 300, academic_year_id: 1, academic_level_id: 12, academic_period_id: 1, pathway: "general", pathway_ids: [], minutes: 60 },
      ],
      period_template_slots: allSlots,
      has_pending_draft_by_class: { 30: false },
      published_load_count_by_class: { 30: 0 },
    });
    mocks.apiFetch.mockResolvedValue({ ok: true, json: async () => allSlots });
    mocks.getSubjectLoadStudioData.mockResolvedValue(shsData);

    render(<AdminSubjectLoadStudio />);

    // Grid View shows empty-state prompt directing admin to Edit Break Timelines (no JHS fallback!)
    expect(await screen.findByText(/No Break Timeline is assigned to 12-Unassigned/i)).toBeTruthy();

    // Switching to List View keeps the subject visible with clear missing-template guidance & Edit Break Timelines button
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    const row = (await screen.findByText("Capstone Project")).closest("tr")!;
    expect(within(row).queryByRole("combobox")).toBeNull();
    expect(within(row).queryByPlaceholderText("08:00 am")).toBeNull();
    expect(within(row).getByText(/No Break Timeline is assigned to 12-Unassigned/i)).toBeTruthy();

    fireEvent.click(within(row).getByRole("button", { name: /Edit Break Timelines/i }));
    const drawer = await screen.findByTestId("break-config-drawer");
    expect(drawer.getAttribute("data-initial-group")).toBe("SHS_CAMPOS_ZARA");
  });

  it("preserves existing custom saved SHS schedules in both Grid and List views without silently overwriting them", async () => {
    const allSlots = [...JHS_TEMPLATE_SLOTS, ...SHS_TEMPLATE_SLOTS];
    const shsData = makeStudioData({
      academic_levels: [{ academic_level_id: 11, level_name: "Grade 11", grade_level: 11 }],
      classes: [
        { class_id: 20, section_name: "Zara", academic_level_id: 11, academic_year_id: 1, period_template_group: "SHS_CAMPOS_ZARA" },
      ],
      subjects: [
        { subject_id: 200, subject_name: "General Biology 1", subject_codename: "BIO1", academic_level_id: 11, grading_template: "Core", is_core: true },
      ],
      subject_offerings: [
        { subject_offering_id: 20, subject_id: 200, academic_year_id: 1, academic_level_id: 11, academic_period_id: 1, pathway: "general", pathway_ids: [], minutes: 60 },
      ],
      existing_loads: [
        {
          subject_load_id: 950,
          class_id: 20,
          subject_id: 200,
          staff_id: "T001",
          academic_period_id: 1,
          slot_id: null,
          start_time: "08:15",
          end_time: "09:15",
          days_of_week: ["MON", "WED"],
          status: "draft",
          is_locked: false,
          section_revision: 1,
        },
      ],
      period_template_slots: allSlots,
      has_pending_draft_by_class: { 20: true },
      published_load_count_by_class: { 20: 0 },
    });
    mocks.apiFetch.mockResolvedValue({ ok: true, json: async () => allSlots });
    mocks.getSubjectLoadStudioData.mockResolvedValue(shsData);

    render(<AdminSubjectLoadStudio />);

    // Grid View preserves the custom saved time visibly across MON and WED without overwriting it
    const gridCards = await screen.findAllByText("General Biology 1");
    expect(gridCards).toHaveLength(2);
    expect(gridCards.every((el) => el.closest("[data-slot-time]")?.getAttribute("data-slot-time") === "08:15-09:15")).toBe(true);
    expect(screen.getByText("Saved custom time")).toBeTruthy();

    // Initial validation payload preserved 08:15-09:15 untouched
    expect(mocks.validateSubjectLoads).toHaveBeenCalledWith(
      1,
      expect.arrayContaining([
        expect.objectContaining({
          subject_load_id: 950,
          slot_id: null,
          start_time: "08:15",
          end_time: "09:15",
        }),
      ]),
    );

    // List View displays the preserved custom saved time alongside the valid period dropdown
    fireEvent.click(screen.getByRole("radio", { name: "List" }));
    const row = (await screen.findByText("General Biology 1")).closest("tr")!;
    expect(within(row).getByText(/Saved time: 8:15 AM–9:15 AM \(custom saved time/i)).toBeTruthy();
    expect(within(row).getByRole("combobox", { name: "Schedule period for General Biology 1" })).toBeTruthy();
  });

  it("supports SHS multi-slot scheduling, teacher preservation, and occupied-period swap confirmation", async () => {
    const allSlots = [...JHS_TEMPLATE_SLOTS, ...SHS_TEMPLATE_SLOTS];
    const shsData = makeStudioData({
      academic_levels: [{ academic_level_id: 11, level_name: "Grade 11", grade_level: 11 }],
      classes: [
        { class_id: 20, section_name: "Zara", academic_level_id: 11, academic_year_id: 1, period_template_group: "SHS_CAMPOS_ZARA" },
      ],
      subjects: [
        { subject_id: 200, subject_name: "General Biology 1", subject_codename: "BIO1", academic_level_id: 11, grading_template: "Core", is_core: true },
        { subject_id: 201, subject_name: "General Chemistry 1", subject_codename: "CHEM1", academic_level_id: 11, grading_template: "Core", is_core: true },
      ],
      subject_offerings: [
        { subject_offering_id: 20, subject_id: 200, academic_year_id: 1, academic_level_id: 11, academic_period_id: 1, pathway: "general", pathway_ids: [], minutes: 60 },
        { subject_offering_id: 21, subject_id: 201, academic_year_id: 1, academic_level_id: 11, academic_period_id: 1, pathway: "general", pathway_ids: [], minutes: 60 },
      ],
      existing_loads: [
        {
          subject_load_id: 960,
          class_id: 20,
          subject_id: 200,
          staff_id: "T001",
          academic_period_id: 1,
          slot_id: 101,
          start_time: "08:00",
          end_time: "09:00",
          days_of_week: ["MON", "WED"],
          status: "draft",
          is_locked: false,
          section_revision: 1,
        },
        {
          subject_load_id: 961,
          class_id: 20,
          subject_id: 201,
          staff_id: "T002",
          academic_period_id: 1,
          slot_id: 102,
          start_time: "09:00",
          end_time: "10:00",
          days_of_week: ["MON", "WED"],
          status: "draft",
          is_locked: false,
          section_revision: 1,
        },
      ],
      period_template_slots: allSlots,
      has_pending_draft_by_class: { 20: true },
      published_load_count_by_class: { 20: 0 },
    });
    mocks.apiFetch.mockResolvedValue({ ok: true, json: async () => allSlots });
    mocks.getSubjectLoadStudioData.mockResolvedValue(shsData);

    render(<AdminSubjectLoadStudio />);

    await waitFor(() => {
      expect(screen.getByRole("radio", { name: "List" })).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("radio", { name: "List" }));

    // Selecting Period 2 (occupied by General Chemistry 1 on MON/WED) for General Biology 1 opens Swap confirmation
    const bioRow = (await screen.findByText("General Biology 1")).closest("tr")!;
    fireEvent.keyDown(within(bioRow).getByRole("combobox", { name: "Schedule period for General Biology 1" }), { key: "ArrowDown" });
    const options = await screen.findAllByRole("option");
    fireEvent.click(options[1]); // Period 2

    const swapDialog = await screen.findByRole("dialog");
    expect(within(swapDialog).getByText("Swap occupied periods?")).toBeTruthy();
    fireEvent.click(within(swapDialog).getByRole("button", { name: /Swap Periods/i }));

    await waitFor(() => {
      const latestLoads = mocks.validateSubjectLoads.mock.calls.at(-1)?.[1];
      expect(latestLoads).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ subject_id: 200, slot_id: 102, start_time: "09:00", end_time: "10:00", staff_id: "T001" }),
          expect.objectContaining({ subject_id: 201, slot_id: 101, start_time: "08:00", end_time: "09:00", staff_id: "T002" }),
        ]),
      );
    });

    // Adding a second meeting slot to General Biology 1 preserves its teacher assignment & picks a valid SHS slot_id
    fireEvent.click(within(bioRow).getByRole("button", { name: "Row options" }));
    fireEvent.click(within(bioRow).getByRole("button", { name: /\+ Add Time Slot/i }));

    await waitFor(() => {
      const latestLoads = mocks.validateSubjectLoads.mock.calls.at(-1)?.[1];
      const bioSlots = latestLoads.filter((l: { subject_id: number }) => l.subject_id === 200);
      expect(bioSlots).toHaveLength(2);
      expect(bioSlots.every((l: { staff_id?: string | null; slot_id?: number | null }) => l.staff_id === "T001" && l.slot_id != null)).toBe(true);
    });
  });

  it("evaluates SHS template assignment, duration filtering, missing-slot diagnostics, and authoritative slot resolution accurately", () => {
    const levels = [
      { academic_level_id: 9, grade_level: 9 },
      { academic_level_id: 11, grade_level: 11 },
      { academic_level_id: 12, grade_level: 12 },
    ];
    const allSlots = [...JHS_TEMPLATE_SLOTS, ...SHS_TEMPLATE_SLOTS];
    const clsJhsUnset = { class_id: 1, section_name: "9-A", academic_level_id: 9, academic_year_id: 1, period_template_group: null };
    const clsShsUnset = { class_id: 2, section_name: "11-Unset", academic_level_id: 11, academic_year_id: 1, period_template_group: null };
    const clsShsWrongJhs = { class_id: 3, section_name: "12-Wrong", academic_level_id: 12, academic_year_id: 1, period_template_group: "JHS_45MIN" };
    const clsShsReyes = { class_id: 4, section_name: "11-Reyes", academic_level_id: 11, academic_year_id: 1, period_template_group: "SHS_DELMUNDO_REYES" };

    expect(resolveAssignedTemplateGroup(clsJhsUnset, levels)).toBe("JHS_45MIN");
    expect(resolveAssignedTemplateGroup(clsShsUnset, levels)).toBeNull();
    expect(resolveAssignedTemplateGroup(clsShsWrongJhs, levels)).toBeNull();
    expect(resolveAssignedTemplateGroup(clsShsReyes, levels)).toBe("SHS_DELMUNDO_REYES");

    const offerings = [
      { subject_offering_id: 1, subject_id: 10, academic_year_id: 1, academic_level_id: 11, academic_period_id: 1, pathway: "general", pathway_ids: [], minutes: 72 },
      { subject_offering_id: 2, subject_id: 11, academic_year_id: 1, academic_level_id: 11, academic_period_id: 1, pathway: "general", pathway_ids: [], minutes: 90 },
      { subject_offering_id: 3, subject_id: 12, academic_year_id: 1, academic_level_id: 12, academic_period_id: 1, pathway: "general", pathway_ids: [], minutes: 60 },
    ];

    // 72m offering on SHS_DELMUNDO_REYES returns ONLY 72m CLASS slots (not 60m PE, not breaks)
    expect(
      getCompatiblePeriodSlots(clsShsReyes, 10, levels, allSlots, offerings, 1).map((s) => s.slot_id),
    ).toEqual([202, 203]);

    // Missing-slot diagnostics distinguish each failure cause cleanly
    expect(diagnoseMissingPeriodSlots(clsShsUnset, 10, levels, allSlots, offerings, 1)?.code).toBe("NO_TEMPLATE_ASSIGNED");
    expect(diagnoseMissingPeriodSlots(clsShsWrongJhs, 12, levels, allSlots, offerings, 1)?.code).toBe("JHS_TEMPLATE_ON_SHS");
    const mismatchDiag = diagnoseMissingPeriodSlots(clsShsReyes, 11, levels, allSlots, offerings, 1);
    expect(mismatchDiag?.code).toBe("NO_DURATION_MATCH");
    expect(mismatchDiag?.drawerGroup).toBe("SHS_DELMUNDO_REYES");
    expect(mismatchDiag?.message).toContain("60 min, 72 min");

    // withAuthoritativeTemplateSlots attaches SHS slot_id on exact match, leaves custom saved times untouched
    const normalized = withAuthoritativeTemplateSlots(
      [
        { class_id: 4, subject_id: 10, academic_period_id: 1, slot_id: null, start_time: "08:00", end_time: "09:12", days_of_week: ["MON"] },
        { class_id: 4, subject_id: 10, academic_period_id: 1, slot_id: null, start_time: "08:15", end_time: "09:27", days_of_week: ["TUE"] },
      ],
      [clsShsReyes],
      levels,
      allSlots,
    );
    expect(normalized[0].slot_id).toBe(202);
    expect(normalized[1].slot_id).toBeNull();
    expect(normalized[1].start_time).toBe("08:15");
    expect(normalized[1].end_time).toBe("09:27");
  });
});

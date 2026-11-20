// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SubjectOfferingFormOptions } from "@/lib/api";
import AdminSubjects from "@/pages/admin/subjects";
import { CopyPreviousYearSetupModal } from "@/pages/admin/subjects/components/copy-previous-year-setup-modal";

const mocks = vi.hoisted(() => ({
  selectedYearId: 1 as number | null,
  getSubjects: vi.fn(),
  getSubjectOfferings: vi.fn(),
  getSubjectOfferingFormOptions: vi.fn(),
  getGradingTemplates: vi.fn(),
}));

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button type="button">Sidebar</button>,
}));

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

vi.mock("@/context/AcademicPeriodContext", () => ({
  useAcademicPeriod: () => ({
    selectedYearId: mocks.selectedYearId,
  }),
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

vi.mock("@/components/retroui/Select", () => {
  const SelectRoot = ({ children, value }: { children: ReactNode; value?: string }) => (
    <div data-select-value={value}>{children}</div>
  );
  const Select = Object.assign(SelectRoot, {
    Trigger: ({ children, id }: { children: ReactNode; id?: string }) => <div id={id}>{children}</div>,
    Value: ({ placeholder }: { placeholder?: string }) => <span>{placeholder}</span>,
    Content: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Group: ({ children }: { children: ReactNode }) => <div>{children}</div>,
    Item: ({ children, value }: { children: ReactNode; value: string }) => (
      <div data-option-value={value}>{children}</div>
    ),
  });
  return { Select };
});

vi.mock("@/lib/api", () => ({
  getSubjects: mocks.getSubjects,
  getSubjectOfferings: mocks.getSubjectOfferings,
  getSubjectOfferingFormOptions: mocks.getSubjectOfferingFormOptions,
  getGradingTemplates: mocks.getGradingTemplates,
  archiveSubject: vi.fn(),
  archiveSubjectOffering: vi.fn(),
  restoreSubject: vi.fn(),
  restoreSubjectOffering: vi.fn(),
  downloadSubjectImportTemplate: vi.fn(),
  downloadSubjectOfferingImportTemplate: vi.fn(),
  uploadSubjectImportCsv: vi.fn(),
  uploadSubjectOfferingImportCsv: vi.fn(),
  copySubjectOfferingsFromAcademicYear: vi.fn(),
}));

const MULTI_YEAR_OPTIONS: SubjectOfferingFormOptions = {
  academic_years: [
    {
      academic_year_id: 1,
      year_label: "2025-2026",
      is_active: true,
      start_date: "2025-06-02",
      end_date: "2026-03-31",
    },
    {
      academic_year_id: 5,
      year_label: "2026-2027",
      is_active: false,
      start_date: "2026-06-01",
      end_date: "2027-03-31",
    },
    {
      academic_year_id: 8,
      year_label: "2027-2028",
      is_active: false,
      start_date: "2027-08-01",
      end_date: "2028-05-31",
    },
  ],
  academic_levels: [{ academic_level_id: 3, level_name: "Grade 9", grade_level: 9 }],
  academic_periods: [
    { academic_period_id: 1, period_name: "Term 1", period_type: "TERM", period_sequence: 1, academic_year_id: 1 },
    { academic_period_id: 8, period_name: "Term 1", period_type: "TERM", period_sequence: 1, academic_year_id: 5 },
  ],
  pathways: [],
  statuses: ["active", "archived"],
  default_status: "active",
  active_subjects: [],
  grading_templates: [{ grading_template_id: 1, template_name: "Core", status: "active" }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getSubjects.mockResolvedValue({ subjects: [] });
  mocks.getSubjectOfferings.mockResolvedValue({
    summary: { total_offerings: 0, active_offerings: 0, archived_offerings: 0 },
    subject_offerings: [],
  });
  mocks.getSubjectOfferingFormOptions.mockResolvedValue(MULTI_YEAR_OPTIONS);
  mocks.getGradingTemplates.mockResolvedValue({ grading_templates: [] });
});

afterEach(() => {
  cleanup();
});

describe("Copy Previous Year Setup visibility", () => {
  it("hides Copy Previous Year Setup when viewing the earliest academic year (2025-2026)", async () => {
    mocks.selectedYearId = 1;

    render(
      <MemoryRouter initialEntries={["/admin/subjects?tab=offerings"]}>
        <AdminSubjects />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mocks.getSubjectOfferingFormOptions).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(screen.getByText("No subjects have been offered for this setup yet.")).toBeTruthy();
    });

    expect(screen.queryByRole("button", { name: /copy previous year setup/i })).toBeNull();
  });

  it("shows Copy Previous Year Setup when viewing a year with an earlier academic year (2026-2027)", async () => {
    mocks.selectedYearId = 5;

    render(
      <MemoryRouter initialEntries={["/admin/subjects?tab=offerings"]}>
        <AdminSubjects />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /copy previous year setup/i })).toBeTruthy();
    });
  });

  it("only offers strictly earlier academic years as copy sources inside the modal", async () => {
    render(
      <CopyPreviousYearSetupModal
        open={true}
        onOpenChange={vi.fn()}
        options={MULTI_YEAR_OPTIONS}
        defaultTargetAcademicYearId={5}
        onCopied={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const dialog = await screen.findByRole("dialog");
    const sourceContainer = dialog.querySelector("#copy-source-year")?.parentElement;
    const targetContainer = dialog.querySelector("#copy-target-year")?.parentElement;

    expect(sourceContainer).toBeTruthy();
    expect(targetContainer).toBeTruthy();

    // Target 2026-2027 (id 5) should only allow 2025-2026 (id 1) as source, never future 2027-2028 (id 8)
    expect(sourceContainer!.querySelector('[data-option-value="1"]')).toBeTruthy();
    expect(sourceContainer!.querySelector('[data-option-value="5"]')).toBeNull();
    expect(sourceContainer!.querySelector('[data-option-value="8"]')).toBeNull();

    // Earliest year 2025-2026 (id 1) should not be a valid target since it has no previous year
    expect(targetContainer!.querySelector('[data-option-value="1"]')).toBeNull();
    expect(targetContainer!.querySelector('[data-option-value="5"]')).toBeTruthy();
    expect(targetContainer!.querySelector('[data-option-value="8"]')).toBeTruthy();
  });
});

// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  SubjectListItem,
  SubjectOfferingFormOptions,
  SubjectOfferingListItem,
} from "@/lib/api";
import { OfferingModal } from "@/pages/admin/forms/add-subject-offering-modal";
import {
  CurriculumPlanTable,
  groupOfferingsForCurriculumPlan,
} from "@/pages/admin/subjects/components/curriculum-plan-table";
import { levelRequiresPathway } from "@/pages/admin/subjects/components/subject-utils";

const mocks = vi.hoisted(() => ({
  getSubjectOfferings: vi.fn(),
  createSubjectOffering: vi.fn(),
  createSubjectOfferingsBatch: vi.fn(),
  updateSubjectOffering: vi.fn(),
  archiveSubjectOffering: vi.fn(),
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

vi.mock("@/components/retroui/Tooltip", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ render: trigger }: { render: ReactNode }) => <>{trigger}</>,
  TooltipContent: () => null,
}));

vi.mock("@/lib/api", () => ({
  getSubjectOfferings: mocks.getSubjectOfferings,
  createSubjectOffering: mocks.createSubjectOffering,
  createSubjectOfferingsBatch: mocks.createSubjectOfferingsBatch,
  updateSubjectOffering: mocks.updateSubjectOffering,
  archiveSubjectOffering: mocks.archiveSubjectOffering,
}));

const OPTIONS: SubjectOfferingFormOptions = {
  academic_years: [
    {
      academic_year_id: 1,
      year_label: "2026-2027",
      is_active: true,
      start_date: "2026-06-01",
      end_date: "2027-03-31",
    },
  ],
  academic_levels: [{ academic_level_id: 8, level_name: "Grade 8", grade_level: 8 }],
  academic_periods: [
    { academic_period_id: 11, period_name: "Term 1", period_type: "TERM", period_sequence: 1, academic_year_id: 1 },
    { academic_period_id: 12, period_name: "Term 2", period_type: "TERM", period_sequence: 2, academic_year_id: 1 },
    { academic_period_id: 13, period_name: "Term 3", period_type: "TERM", period_sequence: 3, academic_year_id: 1 },
  ],
  pathways: [],
  statuses: ["active", "archived"],
  default_status: "active",
  active_subjects: [],
  grading_templates: [
    { grading_template_id: 1, template_name: "Core", status: "active" },
    { grading_template_id: 2, template_name: "Specialized", status: "active" },
  ],
};

function makeFrenchOffering(
  overrides: Partial<SubjectOfferingListItem> = {},
): SubjectOfferingListItem {
  return {
    subject_offering_id: 101,
    subject: {
      subject_id: 50,
      subject_name: "French 8",
      subject_codename: "FRE8",
      grading_template_id: 2,
      grading_template: "Specialized",
      grading_template_assignment_locked: false,
      grading_template_assignment_lock_reason: null,
    },
    academic_year: { academic_year_id: 1, year_label: "2026-2027", is_active: true },
    academic_level: { academic_level_id: 8, level_name: "Grade 8", grade_level: 8 },
    academic_period: {
      academic_period_id: 11,
      period_name: "Term 1",
      period_type: "TERM",
      period_sequence: 1,
      academic_year_id: 1,
    },
    pathway: "general",
    pathway_ids: [],
    minutes: 45,
    status: "active",
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

const CATALOG_FRENCH: SubjectListItem = {
  subject_id: 50,
  subject_name: "French 8",
  subject_codename: "FRE8",
  description: null,
  academic_level: { academic_level_id: 8, level_name: "Grade 8", grade_level: 8 },
  grading_template_id: 2,
  grading_template: {
    grading_template_id: 2,
    template_name: "Specialized",
    passing_threshold: 75,
    components: [],
  },
  is_core: false,
  status: "active",
  created_at: null,
  updated_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  }
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  }
});

afterEach(() => {
  cleanup();
});

describe("Curriculum Plan Offering Edit Regressions", () => {
  it("restores and updates previously archived term offerings instead of silently failing on create", async () => {
    const activeTerm1 = makeFrenchOffering({ subject_offering_id: 101 });
    const archivedTerm2 = makeFrenchOffering({
      subject_offering_id: 102,
      status: "archived",
      academic_period: OPTIONS.academic_periods[1],
    });

    mocks.getSubjectOfferings.mockResolvedValue({
      summary: { total_offerings: 2, active_offerings: 1, archived_offerings: 1 },
      subject_offerings: [activeTerm1, archivedTerm2],
    });
    mocks.updateSubjectOffering.mockResolvedValue(activeTerm1);
    mocks.createSubjectOffering.mockResolvedValue(
      makeFrenchOffering({
        subject_offering_id: 103,
        academic_period: OPTIONS.academic_periods[2],
      }),
    );

    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <OfferingModal
        open={true}
        onOpenChange={onOpenChange}
        options={OPTIONS}
        offering={activeTerm1}
        catalogSubjects={[CATALOG_FRENCH]}
        onSaved={onSaved}
      />,
    );

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(mocks.getSubjectOfferings).toHaveBeenCalledTimes(1);
    });

    // Re-check Term 2 (archived) and Term 3 (new)
    fireEvent.click(within(dialog).getByLabelText("Term 2"));
    fireEvent.click(within(dialog).getByLabelText("Term 3"));

    fireEvent.click(within(dialog).getByRole("button", { name: /save offering/i }));

    await waitFor(() => {
      expect(onSaved).toHaveBeenCalledTimes(1);
    });

    // Active Term 1 updated, archived Term 2 restored+updated via PATCH (not POST!), new Term 3 created via POST
    expect(mocks.updateSubjectOffering).toHaveBeenCalledWith(
      101,
      expect.objectContaining({ academic_period_id: 11, status: "active", minutes: 45 }),
    );
    expect(mocks.updateSubjectOffering).toHaveBeenCalledWith(
      102,
      expect.objectContaining({ academic_period_id: 12, status: "active", minutes: 45 }),
    );
    expect(mocks.createSubjectOffering).toHaveBeenCalledTimes(1);
    expect(mocks.createSubjectOffering).toHaveBeenCalledWith(
      expect.objectContaining({ academic_period_id: 13, status: "active", minutes: 45 }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("never swallows createSubjectOffering errors or fires a false success toast", async () => {
    const activeTerm1 = makeFrenchOffering({ subject_offering_id: 101 });
    mocks.getSubjectOfferings.mockResolvedValue({
      summary: { total_offerings: 1, active_offerings: 1, archived_offerings: 0 },
      subject_offerings: [activeTerm1],
    });
    mocks.updateSubjectOffering.mockResolvedValue(activeTerm1);
    mocks.createSubjectOffering.mockRejectedValue(
      new Error("Subject offering already exists for this scope and pathway."),
    );

    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <OfferingModal
        open={true}
        onOpenChange={onOpenChange}
        options={OPTIONS}
        offering={activeTerm1}
        catalogSubjects={[CATALOG_FRENCH]}
        onSaved={onSaved}
      />,
    );

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(mocks.getSubjectOfferings).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(within(dialog).getByLabelText("Term 2"));
    fireEvent.click(within(dialog).getByRole("button", { name: /save offering/i }));

    await waitFor(() => {
      expect(
        within(dialog).getByText("Subject offering already exists for this scope and pathway."),
      ).toBeTruthy();
    });

    expect(onSaved).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("renders the offering's year-scoped grading template in CurriculumPlanTable instead of stale catalog default", () => {
    const updatedYearScopedOffering = makeFrenchOffering({
      subject: {
        ...makeFrenchOffering().subject,
        grading_template_id: 1,
        grading_template: "Core",
      },
    });

    // Catalog default is still "Specialized", while year-scoped offering template is "Core"
    const rows = groupOfferingsForCurriculumPlan(
      [updatedYearScopedOffering],
      OPTIONS.academic_periods,
      [CATALOG_FRENCH],
    );
    expect(rows[0].gradingTemplate).toBe("Core");

    render(
      <CurriculumPlanTable
        offerings={[updatedYearScopedOffering]}
        periods={OPTIONS.academic_periods}
        catalogSubjects={[CATALOG_FRENCH]}
        academicYearLabel="2026-2027"
        gradeLabel="Grade 8"
        pathwayLabel="General / Unrestricted"
        onEdit={vi.fn()}
        onArchive={vi.fn()}
        onRestore={vi.fn()}
      />,
    );

    expect(screen.getByText("Core")).toBeTruthy();
    expect(screen.queryByText("Specialized")).toBeNull();
  });

  it("hides Pathway selector and submits general pathway when adding Grade 12 offerings with requires_pathway=false", async () => {
    const g12Options: SubjectOfferingFormOptions = {
      ...OPTIONS,
      academic_levels: [
        { academic_level_id: 12, level_name: "Grade 12", grade_level: 12 },
      ],
      pathways: [
        {
          id: 1,
          code: "medical-courses",
          name: "Medical Courses",
          is_enabled: true,
          sort_order: 1,
          deped_cluster_id: null,
        },
        {
          id: 2,
          code: "engineering-math",
          name: "Engineering & Math",
          is_enabled: true,
          sort_order: 2,
          deped_cluster_id: null,
        },
      ],
      pathway_scopes: [
        {
          academic_year_id: 1,
          academic_level_id: 12,
          grade_level: 12,
          requires_pathway: false,
        },
      ],
    };

    const g12Physics: SubjectListItem = {
      ...CATALOG_FRENCH,
      subject_id: 15,
      subject_name: "General Physics 1",
      subject_codename: "GENPHYS1",
      academic_level: { academic_level_id: 12, level_name: "Grade 12", grade_level: 12 },
      is_core: false,
    };

    mocks.getSubjectOfferings.mockResolvedValue({
      summary: { total_offerings: 0, active_offerings: 0, archived_offerings: 0 },
      subject_offerings: [],
    });
    mocks.createSubjectOfferingsBatch.mockResolvedValue({
      created_count: 1,
      subject_offerings: [],
    });

    const onSaved = vi.fn().mockResolvedValue(undefined);
    const onOpenChange = vi.fn();

    render(
      <OfferingModal
        open={true}
        onOpenChange={onOpenChange}
        options={g12Options}
        offering={null}
        catalogSubjects={[g12Physics]}
        onSaved={onSaved}
      />,
    );

    const dialog = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(mocks.getSubjectOfferings).toHaveBeenCalledTimes(1);
    });

    // Grade 12 has requires_pathway=false -> Pathway select MUST NOT be shown
    expect(within(dialog).queryByLabelText(/^Pathway$/i)).toBeNull();

    // Select duration 72 minutes
    const durationTrigger = dialog.querySelector("#create-offering-minutes");
    expect(durationTrigger).toBeTruthy();
    fireEvent.click(durationTrigger!);
    fireEvent.click(await screen.findByText("72 minutes"));

    // Select Term 1
    fireEvent.click(within(dialog).getByLabelText("Term 1"));

    // Open Select Subjects accordion and select General Physics 1
    fireEvent.click(within(dialog).getByText("Select Subjects"));
    fireEvent.click(await within(dialog).findByText("General Physics 1"));

    fireEvent.click(within(dialog).getByRole("button", { name: /add offerings/i }));

    await waitFor(() => {
      expect(mocks.createSubjectOfferingsBatch).toHaveBeenCalledTimes(1);
    });

    expect(mocks.createSubjectOfferingsBatch).toHaveBeenCalledWith({
      academic_year_id: 1,
      academic_level_id: 12,
      minutes: 72,
      status: "active",
      items: [
        {
          subject_id: 15,
          academic_period_id: 11,
          pathway: "general",
        },
      ],
    });
    expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ gradeValue: "12", pathway: "general" }),
    );
  });

  it("resolves levelRequiresPathway per academic year and grade scope", () => {
    const scopes = [
      { academic_year_id: 1, academic_level_id: 11, grade_level: 11, requires_pathway: true },
      { academic_year_id: 1, academic_level_id: 12, grade_level: 12, requires_pathway: false },
      { academic_year_id: 2, academic_level_id: 12, grade_level: 12, requires_pathway: true },
    ];
    expect(levelRequiresPathway(scopes, 1, 11, 11)).toBe(true);
    expect(levelRequiresPathway(scopes, 1, 12, 12)).toBe(false);
    expect(levelRequiresPathway(scopes, 2, 12, 12)).toBe(true);
    expect(levelRequiresPathway(scopes, 1, 10, 10)).toBe(false);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { OfferingModal } from "./offering-modal";
import type {
  SubjectListItem,
  SubjectOfferingFormOptions,
  SubjectOfferingListItem,
} from "@/lib/api";

const getSubjectOfferings = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("@/lib/api")>();
  return { ...original, getSubjectOfferings };
});

const options: SubjectOfferingFormOptions = {
  academic_years: [{
    academic_year_id: 1,
    year_label: "2026-2027",
    is_active: true,
    start_date: "2026-06-01",
    end_date: "2027-03-31",
  }],
  academic_levels: [{ academic_level_id: 7, level_name: "Grade 7", grade_level: 7 }],
  academic_periods: [{
    academic_period_id: 11,
    period_name: "Term 1",
    period_type: "TERM",
    period_sequence: 1,
    academic_year_id: 1,
  }],
  pathways: [],
  statuses: ["active", "archived"],
  default_status: "active",
  active_subjects: [],
  grading_templates: [
    { grading_template_id: 1, template_name: "Core", status: "active" },
    { grading_template_id: 2, template_name: "Applied", status: "active" },
  ],
};

const offering = (locked: boolean): SubjectOfferingListItem => ({
  subject_offering_id: 21,
  subject: {
    subject_id: 31,
    subject_name: "Science 7",
    subject_codename: "SCI7",
    grading_template_id: 1,
    grading_template: "Core",
    grading_template_assignment_locked: locked,
    grading_template_assignment_lock_reason: locked
      ? "The grading template is locked because classwork, submissions, or grades already exist for this subject in the selected academic year."
      : null,
  },
  academic_year: options.academic_years[0],
  academic_level: options.academic_levels[0],
  academic_period: options.academic_periods[0],
  pathway: "general",
  minutes: 60,
  status: "active",
  created_at: null,
  updated_at: null,
});

const catalogSubject = {
  subject_id: 31,
  grading_template_id: 1,
  grading_template: {
    grading_template_id: 1,
    template_name: "Core",
    passing_threshold: 85,
    components: [],
  },
  subject_name: "Science 7",
  subject_codename: "SCI7",
  description: null,
  status: "active",
  academic_level: options.academic_levels[0],
  is_math_or_science: true,
  created_at: null,
  updated_at: null,
} satisfies SubjectListItem;

afterEach(() => {
  cleanup();
  getSubjectOfferings.mockReset();
});

describe("Edit subject offering grading template", () => {
  it("keeps the year-scoped template editable when the year has no academic records", async () => {
    const current = offering(false);
    getSubjectOfferings.mockResolvedValue({
      summary: { total_offerings: 1, active_offerings: 1, archived_offerings: 0 },
      subject_offerings: [current],
    });

    render(
      <OfferingModal
        open
        onOpenChange={vi.fn()}
        options={options}
        offering={current}
        catalogSubjects={[catalogSubject]}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const trigger = await screen.findByRole("combobox", { name: "Grading Template" });
    await waitFor(() => expect(trigger.hasAttribute("disabled")).toBe(false));
    expect(screen.getByText("Applies to every term and pathway in 2026-2027.")).toBeTruthy();
  });

  it("disables the template and shows the shared warning when records exist", async () => {
    const current = offering(true);
    getSubjectOfferings.mockResolvedValue({
      summary: { total_offerings: 1, active_offerings: 1, archived_offerings: 0 },
      subject_offerings: [current],
    });

    render(
      <OfferingModal
        open
        onOpenChange={vi.fn()}
        options={options}
        offering={current}
        catalogSubjects={[catalogSubject]}
        onSaved={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    const trigger = await screen.findByRole("combobox", { name: "Grading Template" });
    expect(trigger.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("Grading template locked")).toBeTruthy();
    expect(screen.getByText(/classwork, submissions, or grades already exist/i)).toBeTruthy();
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OfferingModal } from "./offering-modal";
import type {
  SubjectListItem,
  SubjectOfferingFormOptions,
  SubjectOfferingListItem,
} from "@/lib/api";

const getSubjectOfferings = vi.hoisted(() => vi.fn());
const createSubjectOfferingsBatch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", async (loadOriginal) => {
  const original = await loadOriginal<typeof import("@/lib/api")>();
  return { ...original, getSubjectOfferings, createSubjectOfferingsBatch };
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
  }, {
    academic_period_id: 12,
    period_name: "Term 2",
    period_type: "TERM",
    period_sequence: 2,
    academic_year_id: 1,
  }, {
    academic_period_id: 13,
    period_name: "Term 3",
    period_type: "TERM",
    period_sequence: 3,
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
  created_at: null,
  updated_at: null,
} satisfies SubjectListItem;

afterEach(() => {
  cleanup();
  getSubjectOfferings.mockReset();
  createSubjectOfferingsBatch.mockReset();
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

const offeringForPeriod = (periodIndex: number): SubjectOfferingListItem => ({
  ...offering(false),
  subject_offering_id: 21 + periodIndex,
  academic_period: options.academic_periods[periodIndex],
});

function subjectRow(name: string) {
  const label = screen.getByText(name).closest("label");
  if (!label) throw new Error(`Subject row not found: ${name}`);
  return label;
}

describe("Create subject offering eligibility", () => {
  it("keeps a partially offered subject selectable and submits only missing terms", async () => {
    getSubjectOfferings.mockResolvedValue({
      summary: { total_offerings: 1, active_offerings: 1, archived_offerings: 0 },
      subject_offerings: [offeringForPeriod(0)],
    });
    createSubjectOfferingsBatch.mockResolvedValue({ created_count: 2, subject_offerings: [] });

    render(<OfferingModal
      open
      onOpenChange={vi.fn()}
      options={options}
      offering={null}
      catalogSubjects={[catalogSubject]}
      defaultAcademicYearId={1}
      onSaved={vi.fn().mockResolvedValue(undefined)}
    />);

    expect(await screen.findByText("Already offered: Term 1 · Will add: Term 2, Term 3.")).toBeTruthy();
    const row = subjectRow("Science 7");
    const checkbox = within(row).getByRole("checkbox") as HTMLButtonElement;
    expect(checkbox.disabled).toBe(false);
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "60" }));
    fireEvent.click(screen.getByRole("button", { name: "Add Offerings" }));

    await waitFor(() => expect(createSubjectOfferingsBatch).toHaveBeenCalledWith({
      academic_year_id: 1,
      academic_level_id: 7,
      items: [
        { subject_id: 31, academic_period_id: 12, pathway: "general" },
        { subject_id: 31, academic_period_id: 13, pathway: "general" },
      ],
      minutes: 60,
      status: "active",
    }));
  });

  it("disables a subject offered in every selected term and disables submission", async () => {
    getSubjectOfferings.mockResolvedValue({
      summary: { total_offerings: 3, active_offerings: 3, archived_offerings: 0 },
      subject_offerings: [offeringForPeriod(0), offeringForPeriod(1), offeringForPeriod(2)],
    });

    render(<OfferingModal
      open
      onOpenChange={vi.fn()}
      options={options}
      offering={null}
      catalogSubjects={[catalogSubject]}
      defaultAcademicYearId={1}
      onSaved={vi.fn().mockResolvedValue(undefined)}
    />);

    expect(await screen.findByText("Already offered in all selected terms.")).toBeTruthy();
    expect((within(subjectRow("Science 7")).getByRole("checkbox") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Add Offerings" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("uses the globally selected academic year when checking availability", async () => {
    const yearTwoOptions: SubjectOfferingFormOptions = {
      ...options,
      academic_years: [
        options.academic_years[0],
        { academic_year_id: 2, year_label: "2027-2028", is_active: false, start_date: "2027-06-01", end_date: "2028-03-31" },
      ],
      academic_periods: [
        ...options.academic_periods,
        { academic_period_id: 21, period_name: "Term 1", period_type: "TERM", period_sequence: 1, academic_year_id: 2 },
      ],
    };
    getSubjectOfferings.mockResolvedValue({
      summary: { total_offerings: 0, active_offerings: 0, archived_offerings: 0 },
      subject_offerings: [],
    });

    render(<OfferingModal
      open
      onOpenChange={vi.fn()}
      options={yearTwoOptions}
      offering={null}
      catalogSubjects={[catalogSubject]}
      defaultAcademicYearId={2}
      onSaved={vi.fn().mockResolvedValue(undefined)}
    />);

    await waitFor(() => expect(getSubjectOfferings).toHaveBeenCalledWith({
      academic_year_id: 2,
      academic_level_id: 7,
      status: "active",
    }));
    expect(screen.getByText(/2027-2028/)).toBeTruthy();
    expect(screen.queryByText(/Already offered/)).toBeNull();
  });

  it("refetches after a year change and ignores the stale previous-year response", async () => {
    const yearTwoOptions: SubjectOfferingFormOptions = {
      ...options,
      academic_years: [
        options.academic_years[0],
        { academic_year_id: 2, year_label: "2027-2028", is_active: false, start_date: "2027-06-01", end_date: "2028-03-31" },
      ],
      academic_periods: [
        ...options.academic_periods,
        { academic_period_id: 21, period_name: "Term 1", period_type: "TERM", period_sequence: 1, academic_year_id: 2 },
      ],
    };
    let resolveYearOne: (value: unknown) => void = () => undefined;
    let resolveYearTwo: (value: unknown) => void = () => undefined;
    getSubjectOfferings.mockImplementation(({ academic_year_id }: { academic_year_id: number }) =>
      new Promise((resolve) => {
        if (academic_year_id === 1) resolveYearOne = resolve;
        else resolveYearTwo = resolve;
      }),
    );

    const view = render(<OfferingModal
      open
      onOpenChange={vi.fn()}
      options={yearTwoOptions}
      offering={null}
      catalogSubjects={[catalogSubject]}
      defaultAcademicYearId={1}
      onSaved={vi.fn().mockResolvedValue(undefined)}
    />);
    await waitFor(() => expect(getSubjectOfferings).toHaveBeenCalledWith(expect.objectContaining({ academic_year_id: 1 })));

    view.rerender(<OfferingModal
      open
      onOpenChange={vi.fn()}
      options={yearTwoOptions}
      offering={null}
      catalogSubjects={[catalogSubject]}
      defaultAcademicYearId={2}
      onSaved={vi.fn().mockResolvedValue(undefined)}
    />);
    await waitFor(() => expect(getSubjectOfferings).toHaveBeenCalledWith(expect.objectContaining({ academic_year_id: 2 })));

    await act(async () => resolveYearTwo({
      summary: { total_offerings: 0, active_offerings: 0, archived_offerings: 0 },
      subject_offerings: [],
    }));
    await screen.findByText("Science 7");
    await act(async () => resolveYearOne({
      summary: { total_offerings: 1, active_offerings: 1, archived_offerings: 0 },
      subject_offerings: [offeringForPeriod(0)],
    }));

    expect(screen.queryByText(/Already offered/)).toBeNull();
    expect(screen.getByText(/2027-2028/)).toBeTruthy();
  });

  it("keeps availability loading and API errors separate from empty data", async () => {
    let rejectRequest: (reason: Error) => void = () => undefined;
    getSubjectOfferings.mockImplementation(() => new Promise((_resolve, reject) => {
      rejectRequest = reject;
    }));
    render(<OfferingModal
      open
      onOpenChange={vi.fn()}
      options={options}
      offering={null}
      catalogSubjects={[catalogSubject]}
      defaultAcademicYearId={1}
      onSaved={vi.fn().mockResolvedValue(undefined)}
    />);

    expect(await screen.findByText("Checking existing offerings...")).toBeTruthy();
    rejectRequest(new Error("Availability request failed"));
    expect(await screen.findByText("Unable to check offering availability")).toBeTruthy();
    expect(screen.getByText("Availability request failed")).toBeTruthy();
    expect(screen.queryByText("No active catalog subjects")).toBeNull();
  });

  it("reports duplicate-looking catalog records without merging them", async () => {
    getSubjectOfferings.mockResolvedValue({
      summary: { total_offerings: 0, active_offerings: 0, archived_offerings: 0 },
      subject_offerings: [],
    });
    const duplicate = {
      ...catalogSubject,
      subject_id: 32,
      subject_name: "Science7",
      subject_codename: "SCI 7",
    } satisfies SubjectListItem;

    render(<OfferingModal
      open
      onOpenChange={vi.fn()}
      options={options}
      offering={null}
      catalogSubjects={[catalogSubject, duplicate]}
      defaultAcademicYearId={1}
      onSaved={vi.fn().mockResolvedValue(undefined)}
    />);

    expect(await screen.findByText("Possible duplicate catalog subjects")).toBeTruthy();
    expect(screen.getByText(/Science 7 \/ Science7/)).toBeTruthy();
    expect(screen.getByText("Science 7")).toBeTruthy();
    expect(screen.getByText("Science7")).toBeTruthy();
  });

  it("shows a configuration alert when the selected year has no terms", async () => {
    getSubjectOfferings.mockResolvedValue({
      summary: { total_offerings: 0, active_offerings: 0, archived_offerings: 0 },
      subject_offerings: [],
    });
    render(<OfferingModal
      open
      onOpenChange={vi.fn()}
      options={{ ...options, academic_periods: [] }}
      offering={null}
      catalogSubjects={[catalogSubject]}
      defaultAcademicYearId={1}
      onSaved={vi.fn().mockResolvedValue(undefined)}
    />);

    expect(screen.getByText("Academic year setup incomplete")).toBeTruthy();
    expect(screen.getByText(/Configure its academic periods/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Add Offerings" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

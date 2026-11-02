import { describe, expect, it } from "vitest";
import type { SubjectOfferingFormOptions } from "@/lib/api";
import { defaultOfferingFilters, offeringQueryFromFilters } from "./subjects/components/subject-utils";

const options: SubjectOfferingFormOptions = {
  academic_years: [
    { academic_year_id: 1, year_label: "AY 2024-2025", is_active: false, start_date: "2024-08-01", end_date: "2025-05-31" },
    { academic_year_id: 2, year_label: "AY 2025-2026", is_active: true, start_date: "2025-08-01", end_date: "2026-05-31" },
    { academic_year_id: 3, year_label: "AY 2026-2027", is_active: false, start_date: "2026-08-01", end_date: "2027-05-31" },
  ],
  academic_levels: [{ academic_level_id: 7, level_name: "Grade 7", grade_level: 7 }],
  academic_periods: [],
  pathways: [],
  statuses: ["active", "archived"],
  default_status: "active",
  active_subjects: [],
};

describe("Curriculum Plan filters", () => {
  it("uses the active year by default when preferred year is not specified", () => {
    const defaults = defaultOfferingFilters(options);
    expect(defaults).toEqual({
      academic_year_id: "2",
      grade: "7",
      pathway: "general",
      status: "active",
      search: "",
    });
    expect(offeringQueryFromFilters(defaults, options)).toEqual({
      academic_year_id: 2,
      academic_level_id: 7,
      pathway: "general",
      status: "active",
      search: "",
    });
  });

  it("respects preferredYearId when specified", () => {
    const defaults = defaultOfferingFilters(options, 3);
    expect(defaults.academic_year_id).toBe("3");
    expect(offeringQueryFromFilters(defaults, options)?.academic_year_id).toBe(3);
  });

  it("does not issue an unfiltered offering request while defaults are unresolved", () => {
    expect(offeringQueryFromFilters({
      academic_year_id: "all", grade: "all", pathway: "all", status: "active", search: "",
    }, options)).toBeNull();
  });

  it("preserves valid search filters and Reset clears them", () => {
    const query = offeringQueryFromFilters({ ...defaultOfferingFilters(options), search: "English" }, options);
    expect(query?.search).toBe("English");
    expect(defaultOfferingFilters(options).search).toBe("");
  });
});

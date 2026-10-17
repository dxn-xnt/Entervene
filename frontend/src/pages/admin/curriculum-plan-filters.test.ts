import { describe, expect, it } from "vitest";
import type { SubjectOfferingFormOptions } from "@/lib/api";
import { defaultOfferingFilters, offeringQueryFromFilters } from "./subjects/components/subject-utils";

const options = {
  academic_years: [
    { academic_year_id: 5, year_label: "AY 2026-2027", is_active: true },
    { academic_year_id: 1, year_label: "2025-2026", is_active: false },
  ],
  academic_levels: [{ academic_level_id: 7, level_name: "Grade 7", grade_level: 7 }],
  academic_periods: [], pathways: [], statuses: ["active", "archived"],
  default_status: "active", active_subjects: [],
} as SubjectOfferingFormOptions;

describe("Curriculum Plan filters", () => {
  it("uses the same concrete defaults for first load and Reset", () => {
    const defaults = defaultOfferingFilters(options);
    expect(defaults).toEqual({ academic_year_id: "5", grade: "7", pathway: "general", status: "active", search: "" });
    expect(offeringQueryFromFilters(defaults, options)).toEqual({
      academic_year_id: 5, academic_level_id: 7, pathway: "general", status: "active", search: "",
    });
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

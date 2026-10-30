// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ClassListItem } from "@/types/adminClasses";
import ClassCard from "./class-card";

afterEach(cleanup);

const schoolClass = (grade: number, pathwayId: number | null, pathwayName?: string): ClassListItem => ({
  class_id: 12,
  section_name: "Zara",
  class_status: "active",
  academic_year: { academic_year_id: 1, year_label: "2025-2026" },
  academic_level: { academic_level_id: grade, level_name: `Grade ${grade}`, grade_level: grade, requires_pathway: grade >= 11 },
  pathway_id: pathwayId,
  pathway: pathwayId == null ? null : { id: pathwayId, code: "database-code", name: pathwayName || "", is_enabled: true, sort_order: 1 },
  adviser: null,
  student_count: 0,
  subject_count: 0,
  male_count: 0,
  female_count: 0,
});

describe("Classes pathway labels", () => {
  it("shows an assigned SHS pathway separately from the section name", () => {
    render(<MemoryRouter><ClassCard item={schoolClass(11, 1, "Medical Courses and Sciences Related")} onEdit={() => {}} onArchive={() => {}} /></MemoryRouter>);
    expect(screen.getByText("Zara")).toBeTruthy();
    expect(screen.getByText("Academic Pathway: Medical Courses and Sciences Related")).toBeTruthy();
  });

  it("marks an unassigned SHS section and leaves JHS cards uncluttered", () => {
    const page = render(<MemoryRouter><ClassCard item={schoolClass(12, null)} onEdit={() => {}} onArchive={() => {}} /></MemoryRouter>);
    expect(screen.getByText("Academic Pathway: Unassigned pathway")).toBeTruthy();
    page.rerender(<MemoryRouter><ClassCard item={schoolClass(9, null)} onEdit={() => {}} onArchive={() => {}} /></MemoryRouter>);
    expect(screen.queryByText(/Academic Pathway:/)).toBeNull();
  });

  it("renders in preview mode without links or dropdown actions", () => {
    render(<ClassCard item={schoolClass(11, 1, "Medical Courses and Sciences Related")} preview />);
    expect(screen.getByText("Zara")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button", { name: "More options" })).toBeNull();
  });
});

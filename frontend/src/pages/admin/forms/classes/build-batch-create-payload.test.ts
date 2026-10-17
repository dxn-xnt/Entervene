import { describe, expect, it } from "vitest";
import type { ManualAssignmentWorkspaceState, ManualClassSetup } from "@/types/adminClasses";
import { buildBatchCreatePayload } from "./build-batch-create-payload";

const setup: ManualClassSetup = {
  academicLevelId: 6,
  academicLevelName: "Grade 12",
  academicYear: { academic_year_id: 1, year_label: "2025-2026" },
  sections: [{ localId: "a", sectionName: "Newton", adviserStaffId: "T-1", pathway: "general" }],
};

function state(): ManualAssignmentWorkspaceState {
  return { academicLevelId: 6, unassignedStudents: [], assignmentsBySection: { a: [] }, selectedStudentIds: new Set() };
}

describe("class creation payload", () => {
  it("accepts an empty Grade 12 section when no students exist", () => {
    expect(buildBatchCreatePayload(setup, state())).toEqual({
      ok: true,
      payload: { academic_year_id: 1, academic_level_id: 6, sections: [{ section_name: "Newton", adviser_staff_id: "T-1", pathway: "general", student_ids: [] }] },
    });
  });

  it("allows eligible students to remain unassigned while creating a section", () => {
    const assignmentState = state();
    assignmentState.unassignedStudents = [{ student_id: "b08eb668-16e5-4ec8-bcac-254b0054b7e0", student_lrn: "123456789012", first_name: "Ada", middle_name: null, last_name: "Lovelace", gender: "Female", academic_level_id: 6 }];
    expect(buildBatchCreatePayload(setup, assignmentState).ok).toBe(true);
  });

  it("still rejects missing class configuration", () => {
    const result = buildBatchCreatePayload({ ...setup, sections: [{ ...setup.sections[0], adviserStaffId: "" }] }, state());
    expect(result.ok).toBe(false);
  });
});

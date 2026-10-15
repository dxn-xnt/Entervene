import { describe, expect, it } from "vitest";
import { classPathwayLabel } from "./class-pathway";

describe("class pathway labels", () => {
  it("uses the canonical record name for assigned Grade 11 and 12 sections", () => {
    expect(classPathwayLabel({ gradeLevel: 11, pathwayId: 1, pathwayName: "Medical Courses and Sciences Related", pathwayEnabled: true }))
      .toBe("Medical Courses and Sciences Related");
    expect(classPathwayLabel({ gradeLevel: 12, pathwayId: 2, pathwayName: "Engineering and Mathematics Related", pathwayEnabled: true }))
      .toBe("Engineering and Mathematics Related");
  });

  it("distinguishes missing, inactive, and invalid assignments", () => {
    expect(classPathwayLabel({ gradeLevel: 11, requiresPathway: true })).toBe("Unassigned pathway");
    expect(classPathwayLabel({ gradeLevel: 12, requiresPathway: false })).toBe("No pathway assigned");
    expect(classPathwayLabel({ gradeLevel: 11, pathwayId: 2, pathwayName: "Engineering", pathwayEnabled: false }))
      .toBe("Engineering (inactive)");
    expect(classPathwayLabel({ gradeLevel: 11, pathwayId: 99 })).toBe("Unknown pathway (#99)");
    expect(classPathwayLabel({ gradeLevel: 9, pathwayId: 1, pathwayName: "Medical" })).toBeNull();
  });
});

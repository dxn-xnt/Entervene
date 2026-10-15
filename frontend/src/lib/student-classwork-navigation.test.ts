import { describe, expect, it } from "vitest";
import { studentClassworkPath, studentClassworkReturnPath, studentClassworkSourceLabel } from "./student-classwork-navigation";

describe("student classwork navigation", () => {
  it("keeps the originating subject tab and filters", () => {
    const from = "/student/subjects/3/8?tab=classwork&search=quiz&sort=newest";
    expect(studentClassworkPath(42, from)).toBe(
      `/student/classworks/42?from=${encodeURIComponent(from)}`,
    );
    expect(studentClassworkReturnPath(from)).toBe(from);
  });

  it("uses a safe fallback for direct and invalid return links", () => {
    expect(studentClassworkReturnPath(null, 3, 8)).toBe("/student/subjects/3/8?tab=classwork");
    expect(studentClassworkReturnPath("//elsewhere.example", 3, 8)).toBe("/student/subjects/3/8?tab=classwork");
    expect(studentClassworkReturnPath(null)).toBe("/student/subjects");
  });

  it("names the breadcrumb for the originating student view", () => {
    expect(studentClassworkSourceLabel("/student/todo")).toBe("To Do");
    expect(studentClassworkSourceLabel("/student/subjects/3/8?tab=classwork&search=quiz")).toBe("Classwork");
    expect(studentClassworkSourceLabel("/student/subjects/3/8?tab=lessons")).toBe("Lessons");
  });
});

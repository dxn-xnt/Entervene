import { describe, expect, it } from "vitest";
import {
  compareTrackingStudentsBySurname,
  formatStudentRosterName,
  isTrackingStudentGraded,
  matchesTrackingFilters,
} from "./classwork-utils";
import type { TrackingStudent } from "@/types/classwork";

const student = (
  overrides: Partial<TrackingStudent> & Pick<TrackingStudent, "student_id" | "student_name">,
): TrackingStudent => ({
  status: "submitted",
  ...overrides,
});

describe("classwork submission filters and sorting", () => {
  it("sorts by structured surname and formats the roster name with a middle initial", () => {
    const rows = [
      student({
        student_id: "1",
        student_name: "Ana Maria Van Dyke",
        first_name: "Ana Maria",
        middle_name: "Louise",
        last_name: "Van Dyke",
      }),
      student({
        student_id: "2",
        student_name: "Zoe Cruz",
        first_name: "Zoe",
        last_name: "Cruz",
      }),
      student({
        student_id: "3",
        student_name: "Bea De la Rosa",
        first_name: "Bea",
        last_name: "De la Rosa",
      }),
    ];

    expect(rows.sort(compareTrackingStudentsBySurname).map((row) => row.student_name)).toEqual([
      "Zoe Cruz",
      "Bea De la Rosa",
      "Ana Maria Van Dyke",
    ]);
    expect(formatStudentRosterName(rows[2])).toBe("Van Dyke, Ana Maria L.");
  });

  it("falls back to the complete display name without guessing a surname token", () => {
    const rows = [
      student({ student_id: "1", student_name: "Zoe Alpha" }),
      student({ student_id: "2", student_name: "Amy Zeta" }),
    ];

    expect(rows.sort(compareTrackingStudentsBySurname).map((row) => row.student_name)).toEqual([
      "Amy Zeta",
      "Zoe Alpha",
    ]);
  });

  it("combines submission and grading filters using the completion grading rule", () => {
    const lateUngraded = student({
      student_id: "1",
      student_name: "Late Learner",
      status: "late",
      grade: null,
    });
    const lateGraded = student({
      student_id: "2",
      student_name: "Graded Learner",
      status: "graded",
      grade: null,
    });

    expect(matchesTrackingFilters(lateUngraded, "late", "not_graded", "late")).toBe(true);
    expect(matchesTrackingFilters(lateUngraded, "on_time", "not_graded", "late")).toBe(false);
    expect(matchesTrackingFilters(lateGraded, "late", "not_graded", "late")).toBe(false);
    expect(matchesTrackingFilters(lateGraded, "late", "graded", "late")).toBe(true);
    expect(isTrackingStudentGraded(lateGraded)).toBe(true);
  });
});

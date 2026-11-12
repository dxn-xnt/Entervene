// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StudentRecordDetail } from "./student-view";
import type { StudentRecordDetailResponse } from "@/lib/student-record-api";

const detail: StudentRecordDetailResponse = {
  student: { student_id: "student-1", lrn: "123", full_name: "Demo Learner", section_name: "A" },
  scope: { class_id: 1, subject_id: 2, academic_year_id: 3, academic_period_id: 4, section_name: "A", subject_name: "Math", period_name: "Term 1", year_label: "2026-2027" },
  summary: { assigned_count: 4, submitted_count: 2, missing_count: 1, late_count: 0, graded_count: 2, ungraded_count: 2 },
  classwork_results: [
    { classwork_id: 1, assignment_id: 11, title: "Scored quiz", type: "QUIZ", status: "graded", score: 8, total_points: 10, percentage: 80, lesson_links: [{ lesson_id: 1, title: "Fractions" }] },
    { classwork_id: 2, assignment_id: 12, title: "Practice", type: "ASSIGNMENT", status: "missing", lesson_links: [{ lesson_id: 1, title: "Fractions" }] },
    { classwork_id: 3, assignment_id: 13, title: "Shared activity", type: "ACTIVITY", status: "graded", score: 9, total_points: 10, percentage: 90, lesson_links: [{ lesson_id: 1, title: "Fractions" }, { lesson_id: 2, title: "Decimals" }] },
    { classwork_id: 4, assignment_id: 14, title: "Unlinked task", type: "ASSIGNMENT", status: "missing", lesson_links: [] },
  ],
};

describe("student lesson performance", () => {
  it("groups real linked activities once and does not invent a score for ungraded work", () => {
    render(<StudentRecordDetail detail={detail} classId={1} subjectLoads={[]} showSuggestionPanel={false} />);
    const fractions = screen.getByRole("heading", { name: "Fractions" }).closest("section")!;
    const multiple = screen.getByRole("heading", { name: "Covers multiple lessons" }).closest("section")!;
    const unlinked = screen.getByRole("heading", { name: "Not linked to a lesson" }).closest("section")!;

    expect(within(fractions).getByText("Scored quiz")).toBeTruthy();
    expect(within(fractions).getByText("Practice")).toBeTruthy();
    expect(within(fractions).getByText("Not graded")).toBeTruthy();
    expect(within(fractions).queryByText("Shared activity")).toBeNull();
    expect(within(multiple).getAllByText("Shared activity")).toHaveLength(1);
    expect(within(unlinked).getByText("Unlinked task")).toBeTruthy();
  });
});

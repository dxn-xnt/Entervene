import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { StudentSubjectSectionCard } from "./student-subject-section-card";
import type { TodoItem } from "@/lib/api";

const classworks = [
  {
    assignment_id: 1,
    class_id: 7,
    classwork_id: 1,
    title: "Problem Solving Practice",
    subject: "Mathematics",
    subject_id: 5,
    due_date: null,
    deadline: "No due date",
    type: "QUIZ",
    category: null,
    status: "pending",
    is_submitted: false,
    submission_status: null,
    grade: null,
  },
  {
    assignment_id: 2,
    class_id: 7,
    classwork_id: 2,
    title: "Previous Quiz",
    subject: "Mathematics",
    subject_id: 5,
    due_date: null,
    deadline: "No due date",
    type: "QUIZ",
    category: null,
    status: "completed",
    is_submitted: true,
    submission_status: "graded",
    grade: 10,
  },
] satisfies TodoItem[];

const props = {
  to: "/student/subjects/7/5",
  subjectName: "Mathematics",
  sectionName: "Demo Archimedes",
  teacherName: "Mara Santos",
  periodName: "Term 1 Demo",
  yearLabel: "2026-2027 DEMO",
  isCurrentPeriod: true,
};

describe("StudentSubjectSectionCard", () => {
  it("shows the subject name, real completion rate, and next classwork", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter><StudentSubjectSectionCard {...props} classworks={classworks} /></MemoryRouter>,
    );
    expect(html).toContain('href="/student/subjects/7/5"');
    expect(html).toMatch(/<h3[^>]*>Mathematics<\/h3>/);
    expect(html).toContain("Mara Santos");
    expect(html).toContain("Your Classwork Completion");
    expect(html).toContain("50%");
    expect(html).toContain("Problem Solving Practice");
    expect(html).not.toContain("Previous Quiz");
  });

  it("does not invent completion data when classwork is unavailable", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter><StudentSubjectSectionCard {...props} classworks={null} /></MemoryRouter>,
    );
    expect(html).not.toContain("Your Classwork Completion");
    expect(html).toContain("View classwork");
  });
});

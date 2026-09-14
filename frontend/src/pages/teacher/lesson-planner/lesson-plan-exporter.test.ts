import { describe, expect, it } from "vitest";
import { buildILAWHTML } from "./lesson-plan-exporter";
import type { LessonPlanDraft } from "./use-lesson-planner";

const sampleDraft: LessonPlanDraft = {
  title: "Understanding the Self",
  learning_area: "Philosophy",
  grade_section: "Grade 7 - Galileo",
  sessions: "4",
  references: "DepEd Curriculum Guide",
  ai_declaration: "No AI assistance was used.",
  intentions: {
    competencies: ["Competency 1", "Competency 2"],
    objectives: "Student will understand self-reflection.",
    context: {
      checklist: ["Participate actively in class discussions"],
    },
  },
  learning_experience: {
    pre_lesson: "Review previous concepts",
    flow: [
      { phase: "before", description: "Engage discussion" },
      { phase: "during", description: "Explore concepts" },
      { phase: "after", description: "Consolidate learning" },
    ],
  },
  assessment: {
    formative: "Observe student participation",
    tasks: [{ description: "Reflection essay" }],
  },
  ways_forward: {
    extended_opportunities: "Journaling at home",
    reflections: "Pacing was appropriate",
  },
};

describe("lesson-plan-exporter: buildILAWHTML", () => {
  it("omits the preview toolbar when showToolbar is false (download mode)", () => {
    const html = buildILAWHTML(sampleDraft, "Maria Cruz", false);

    expect(html).not.toContain("Save as PDF / Print");
    expect(html).not.toContain("Close Window");
    expect(html).not.toContain("DepEd ILAW Lesson Plan Document Preview");
    expect(html).not.toContain('class="no-print"');

    // Starts cleanly with standard DepEd header
    expect(html).toContain("LESSON PLAN");
    expect(html).toContain("MNSTS &nbsp; ILAW &middot; SY 2026-2027");
    expect(html).toContain("Understanding the Self");
    expect(html).toContain("Maria Cruz");
  });

  it("includes the preview toolbar when showToolbar is true (interactive preview mode)", () => {
    const html = buildILAWHTML(sampleDraft, "Maria Cruz", true);

    expect(html).toContain("Save as PDF / Print");
    expect(html).toContain("Close Window");
    expect(html).toContain("DepEd ILAW Lesson Plan Document Preview");
    expect(html).toContain("no-print");
  });
});

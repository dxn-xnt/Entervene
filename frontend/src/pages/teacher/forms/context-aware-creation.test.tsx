// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Dialog } from "@/components/retroui/Dialog";
import CreateLessonModal from "./create-lesson";
import CreateClassworkModal from "./create-classwork";
import CreateClassworkQuizModal from "./create-classwork-quiz";
import EditClassworkModal from "./edit-classwork";
import type { TeacherClassLoad, TeacherClasswork } from "@/types/classwork";

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/context/AcademicPeriodContext", () => ({
  useOptionalAcademicPeriod: () => ({
    selectedPeriodId: 1,
    selectedYearId: 1,
  }),
  useRegisterDirtyGuard: () => {},
}));

const mockClasses = [
  {
    subject_load_id: 1,
    subject_id: 10,
    subject_name: "English 8",
    class_id: 100,
    section_name: "Diamond",
    grade_level: "8",
  },
];

vi.mock("@/hooks/use-teacher-classes", () => ({
  useTeacherClasses: () => ({
    classes: mockClasses,
    isLoading: false,
    error: null,
  }),
}));

const sampleLesson = {
  lesson_id: 1,
  title: "Elements of Poetry",
  subject_id: 10,
  competency_code: "ENG8-C1",
  competency_statement: "Analyze elements of poetry",
  is_published: true,
  is_archived: false,
};

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    apiFetch: vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/v1/competencies/subject/")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve([
              {
                competency_id: 1,
                statement: "Analyze elements of poetry",
                competency_code: "ENG8-C1",
              },
            ]),
        });
      }
      if (url.includes("/api/v1/lessons/my-lessons") || url.includes("/my-class/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve([sampleLesson]),
        });
      }
      if (url.includes("/api/v1/lessons/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(sampleLesson),
        });
      }
      if (url.includes("/api/v1/quizzes/classwork/")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            duration_minutes: 30,
            has_attempts: false,
            settings: {
              is_shuffle_questions: true,
              enable_per_question_scoring: true,
              enable_per_question_time_limits: false,
              max_attempts: 2,
              show_correct_answers: true,
              summary_release_mode: "IMMEDIATE",
              summary_release_at: null,
            },
          }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve([]) });
    }),
  };
});

afterEach(() => {
  cleanup();
});

const sampleLoads: TeacherClassLoad[] = [
  {
    subject_load_id: 1,
    subject_id: 10,
    subject_name: "English 8",
    class_id: 100,
    section_name: "Diamond",
  },
];

const sampleSubjects = [{ id: 10, name: "English 8" }];

describe("Context-Aware Creation & Quiz Reference Link Removal (Priorities 4 & 5)", () => {
  it("Scenario 11: Add Lesson with initial context locks Subject and Competency selections", async () => {
    render(
      <MemoryRouter>
        <CreateLessonModal
          classId="100"
          subjectId="10"
          initialCompetencyId={1}
          onClose={vi.fn()}
          onCreated={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("Add Lesson")).toBeDefined();

    // Subject select trigger is disabled
    const subjectTrigger = screen.getByRole("combobox", { name: /Subject/i });
    expect(subjectTrigger.hasAttribute("disabled")).toBe(true);

    // Learning Competency select trigger is disabled once competencies load
    const competencyTrigger = await screen.findByRole("combobox", { name: /Learning Competency/i });
    expect(competencyTrigger.hasAttribute("disabled")).toBe(true);
  });

  it("Scenario 12: Add Classwork from a lesson locks Subject and Lesson and displays read-only Competency", async () => {
    render(
      <MemoryRouter>
        <Dialog open={true}>
          <CreateClassworkModal
            selectedType="ASSIGNMENT"
            subjects={sampleSubjects}
            loads={sampleLoads}
            initialSubjectId="10"
            initialClassId={100}
            initialLessonId={1}
            onClose={vi.fn()}
            onSuccess={vi.fn()}
            onBack={vi.fn()}
          />
        </Dialog>
      </MemoryRouter>,
    );

    // Subject dropdown trigger is disabled
    const subjectTrigger = screen.getByRole("combobox", { name: /Subject/i });
    expect(subjectTrigger.hasAttribute("disabled")).toBe(true);

    // Lesson dropdown trigger is disabled
    const lessonTrigger = screen.getByRole("combobox", { name: /Lesson/i });
    expect(lessonTrigger.hasAttribute("disabled")).toBe(true);

    // Read-only learning competency is displayed
    expect(await screen.findByText(/Analyze elements of poetry/i)).toBeDefined();
  });

  it("Scenario 13: Create Quiz modal does not render ReferenceLinkEditor", async () => {
    render(
      <MemoryRouter>
        <Dialog open={true}>
          <CreateClassworkQuizModal
            selectedType="QUIZ"
            subjects={sampleSubjects}
            loads={sampleLoads}
            initialSubjectId="10"
            initialClassId={100}
            initialLessonId={1}
            onClose={vi.fn()}
            onSuccess={vi.fn()}
            onBack={vi.fn()}
          />
        </Dialog>
      </MemoryRouter>,
    );

    // Switch to details step by clicking manual builder
    const manualBtn = screen.getByText("Create manually");
    manualBtn.click();

    expect(screen.queryByText("Reference Links")).toBeNull();
    expect(screen.queryByText("Add reference link")).toBeNull();
  });

  it("Scenario 14: Create Assignment/Activity modal renders ReferenceLinkEditor", () => {
    render(
      <MemoryRouter>
        <Dialog open={true}>
          <CreateClassworkModal
            selectedType="ASSIGNMENT"
            subjects={sampleSubjects}
            loads={sampleLoads}
            initialSubjectId="10"
            initialClassId={100}
            onClose={vi.fn()}
            onSuccess={vi.fn()}
            onBack={vi.fn()}
          />
        </Dialog>
      </MemoryRouter>,
    );

    expect(screen.getByText("Reference Links")).toBeDefined();
    expect(screen.getByText(/Add Reference Link/i)).toBeDefined();
  });

  it("Scenario 15: Edit Classwork modal hides ReferenceLinkEditor for QUIZ and renders it for ASSIGNMENT", () => {
    const quizClasswork: TeacherClasswork = {
      classwork_id: 10,
      title: "Sample Quiz",
      classwork_type: "QUIZ",
      total_points: 20,
      is_published: true,
      show_scores: true,
      is_locked: false,
      is_archived: false,
      subject_id: 10,
      attachments: [],
      reference_links: [],
    };

    const assignmentClasswork: TeacherClasswork = {
      ...quizClasswork,
      classwork_id: 11,
      title: "Sample Assignment",
      classwork_type: "ASSIGNMENT",
    };

    const { rerender } = render(
      <MemoryRouter>
        <EditClassworkModal
          isOpen={true}
          onClose={vi.fn()}
          classwork={quizClasswork}
          onSuccess={vi.fn()}
        />
      </MemoryRouter>,
    );

    // Hidden for Quiz
    expect(screen.queryByText("Reference Links")).toBeNull();

    // Rerender with Assignment
    rerender(
      <MemoryRouter>
        <EditClassworkModal
          isOpen={true}
          onClose={vi.fn()}
          classwork={assignmentClasswork}
          onSuccess={vi.fn()}
        />
      </MemoryRouter>,
    );

    // Rendered for Assignment
    expect(screen.getByText("Reference Links")).toBeDefined();
    expect(screen.getByText(/Add Reference Link/i)).toBeDefined();
  });

  it("restores editable quiz creation settings before attempts", async () => {
    const quizClasswork: TeacherClasswork = {
      classwork_id: 12,
      title: "Editable Quiz",
      classwork_type: "QUIZ",
      total_points: 20,
      is_published: true,
      show_scores: true,
      is_locked: false,
      is_archived: false,
      subject_id: 10,
      attachments: [],
      reference_links: [],
      assignments: [{
        classwork_assignment_id: 1,
        classwork_id: 12,
        class_id: 100,
        max_attempts: 1,
        is_published: true,
        show_scores: true,
      }],
    };

    render(
      <MemoryRouter>
        <EditClassworkModal
          isOpen={true}
          onClose={vi.fn()}
          classwork={quizClasswork}
          onSuccess={vi.fn()}
        />
      </MemoryRouter>,
    );

    const duration = await screen.findByLabelText("Duration (minutes)") as HTMLInputElement;
    const attempts = screen.getByLabelText("Allowed Attempts") as HTMLInputElement;
    expect(duration.value).toBe("30");
    expect(attempts.value).toBe("2");
    expect(screen.getByRole("switch", { name: "Shuffle questions" }).getAttribute("aria-checked")).toBe("true");
    expect(duration.disabled).toBe(false);
  });
});

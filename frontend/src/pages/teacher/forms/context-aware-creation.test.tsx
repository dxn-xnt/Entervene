// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { Dialog } from "@/components/retroui/Dialog";
import { apiFetch } from "@/lib/api";
import CreateLessonModal from "./create-lesson";
import CreateClassworkModal from "./create-classwork";
import CreateClassworkQuizModal from "./create-classwork-quiz";
import { interventionQuizCreationDefaults } from "../classworks/quiz-builder-utils";
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
  useRegisterDirtyGuard: () => { },
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
      if (url.includes("/intervention-resource-recipient-context")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              current_scope: "THIS_STUDENT",
              recipient_scopes: {
                default_scope: "THIS_STUDENT",
                this_student: {
                  scope: "THIS_STUDENT",
                  student_id: "student-1",
                  student_name: "Morgan Striving",
                  class_id: 100,
                  class_name: "Diamond",
                  student_count: 1,
                },
                entire_class: {
                  scope: "ENTIRE_CLASS",
                  class_id: 100,
                  class_name: "Diamond",
                  student_count: 17,
                },
                all_subject_students: {
                  scope: "ALL_SUBJECT_STUDENTS",
                  subject_id: 10,
                  subject_name: "English 8",
                  class_ids: [100],
                  class_names: ["Diamond"],
                  section_count: 1,
                  student_count: 17,
                },
              },
            }),
        });
      }
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
      if (url.includes("/api/v1/quizzes/classwork/404")) {
        return Promise.resolve({
          ok: false,
          status: 404,
          json: () => Promise.resolve({ detail: "Quiz has not been created" }),
        });
      }
      if (url === "/api/v1/classwork-assignments/classwork/99") {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            classwork_id: 99,
            title: "Attempted Quiz",
            classwork_type: "QUIZ",
            total_points: 50,
            is_published: true,
            show_scores: false,
            is_locked: false,
            is_archived: false,
            subject_id: 10,
            attachments: [],
            reference_links: [],
            linked_lessons: [sampleLesson],
            assignments: [{
              classwork_assignment_id: 102,
              classwork_id: 99,
              class_id: 100,
              max_attempts: 1,
              is_published: true,
              show_scores: false,
            }],
          }),
        });
      }
      if (url.includes("/api/v1/quizzes/classwork/99/results-settings")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            classwork_id: 99,
            release_policy: "HIDDEN",
            show_scores: false,
            show_correct_answers: false,
            summary_release_mode: "NEVER",
            summary_release_at: null,
            has_mixed_visibility: false,
          }),
        });
      }
      if (url.includes("/api/v1/quizzes/classwork/99")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            duration_minutes: 45,
            has_attempts: true,
            settings: {
              is_shuffle_questions: true,
              enable_per_question_scoring: true,
              enable_per_question_time_limits: false,
              max_attempts: 1,
              show_correct_answers: true,
              summary_release_mode: "IMMEDIATE",
              summary_release_at: null,
            },
          }),
        });
      }
      if (url.includes("/api/v1/quizzes/classwork/88")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            duration_minutes: 30,
            has_attempts: true,
            settings: {
              is_shuffle_questions: false,
              enable_per_question_scoring: true,
              enable_per_question_time_limits: false,
              max_attempts: 1,
              show_correct_answers: true,
              summary_release_mode: "SCHEDULED",
              summary_release_at: "2026-12-01T09:00:00Z",
            },
          }),
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

if (typeof HTMLElement !== "undefined") {
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  }
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = vi.fn(() => false);
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = vi.fn();
  }
}

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

  it("defaults new Study Support quizzes to three attempts and visible results only for intervention quizzes", () => {
    expect(interventionQuizCreationDefaults(true, "PRACTICE_ONLY")).toEqual({
      maxAttempts: "3",
      showScores: true,
    });
    expect(interventionQuizCreationDefaults(true, "WRITTEN_WORK")).toEqual({
      maxAttempts: "3",
      showScores: true,
    });
    expect(interventionQuizCreationDefaults(true, "PERFORMANCE_TASK")).toEqual({
      maxAttempts: "3",
      showScores: true,
    });
    expect(interventionQuizCreationDefaults(true, "EXAMINATION")).toEqual({
      maxAttempts: "1",
      showScores: true,
    });
    expect(interventionQuizCreationDefaults(false, null)).toEqual({
      maxAttempts: "1",
      showScores: false,
    });
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

  it("Scenario 15: Edit Classwork modal renders ReferenceLinkEditor for QUIZ and ASSIGNMENT", () => {
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

    // Available for Quiz edits without adding a rubric.
    expect(screen.getByText("Reference Links")).toBeDefined();
    expect(screen.getByText(/Add Reference Link/i)).toBeDefined();
    expect(screen.queryByRole("region", { name: "Scoring Rubric" })).toBeNull();
    expect(screen.getByRole("region", { name: "Basic Information" }).className).toContain("order-0");
    expect(screen.getByRole("region", { name: "Editable Settings" }).className).toContain("order-1");
    expect(screen.getByRole("region", { name: "Reference Links / Materials" }).className).toContain("order-2");
    expect(screen.getByRole("region", { name: "Assign to Sections" }).className).toContain("order-4");
    expect(screen.queryByText("Share reading with")).toBeNull();
    expect(screen.getByTestId("edit-classwork-modal-body").className).toContain("overflow-y-auto");

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
    expect(screen.getByRole("region", { name: "Scoring Rubric" }).className).toContain("order-3");
  });

  it("places intervention-created reading recipients after Publish Status and before materials", async () => {
    const reading: TeacherClasswork = {
      classwork_id: 16,
      title: "Targeted Reading",
      classwork_type: "READING",
      is_graded: false,
      total_points: null,
      is_published: true,
      show_scores: false,
      is_locked: false,
      is_archived: false,
      subject_id: 10,
      subject_name: "English 8",
      attachments: [],
      reference_links: [],
      intervention_resource_origin_id: 6,
      assignments: [
        {
          classwork_assignment_id: 16,
          classwork_id: 16,
          class_id: 100,
          is_published: true,
          show_scores: false,
          recipient_student_ids: ["student-1"],
        },
      ],
    };

    render(
      <MemoryRouter>
        <EditClassworkModal
          isOpen={true}
          onClose={vi.fn()}
          classwork={reading}
          onSuccess={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Share reading with")).toBeDefined();
    expect(
      screen.getByRole("region", { name: "Resource recipients" }).className,
    ).toContain("order-2");
    expect(
      screen.getByRole("region", { name: "Reference Links / Materials" })
        .className,
    ).toContain("order-3");
    expect(screen.getByText("Publish Status")).toBeDefined();
    expect(
      screen.getByText("Assigned to: 1 student (Morgan Striving in Diamond)"),
    ).toBeDefined();
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

  it("enables quiz settings for draft quiz even if quiz row is not created yet (404)", async () => {
    const uninitializedQuizClasswork: TeacherClasswork = {
      classwork_id: 404,
      title: "Draft Quiz No Questions",
      classwork_type: "QUIZ",
      total_points: 10,
      is_published: false,
      show_scores: true,
      is_locked: false,
      is_archived: false,
      subject_id: 10,
      attachments: [],
      reference_links: [],
      assignments: [{
        classwork_assignment_id: 101,
        classwork_id: 404,
        class_id: 100,
        max_attempts: 1,
        is_published: false,
        show_scores: true,
      }],
    };

    render(
      <MemoryRouter>
        <EditClassworkModal
          isOpen={true}
          onClose={vi.fn()}
          classwork={uninitializedQuizClasswork}
          onSuccess={vi.fn()}
        />
      </MemoryRouter>,
    );

    const duration = await screen.findByLabelText("Duration (minutes)") as HTMLInputElement;
    const attempts = screen.getByLabelText("Allowed Attempts") as HTMLInputElement;
    const shuffleSwitch = screen.getByRole("switch", { name: "Shuffle questions" });

    expect(duration.disabled).toBe(false);
    expect(attempts.disabled).toBe(false);
    expect((shuffleSwitch as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText(/Locked because students have already attempted this quiz/i)).toBeNull();
  });

  it("locks question settings with explanation but leaves result release settings editable when attempts exist", async () => {
    const attemptedQuizClasswork: TeacherClasswork = {
      classwork_id: 99,
      title: "Attempted Quiz",
      classwork_type: "QUIZ",
      total_points: 50,
      is_published: true,
      show_scores: true,
      is_locked: false,
      is_archived: false,
      subject_id: 10,
      attachments: [],
      reference_links: [],
      assignments: [{
        classwork_assignment_id: 102,
        classwork_id: 99,
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
          classwork={attemptedQuizClasswork}
          onSuccess={vi.fn()}
        />
      </MemoryRouter>,
    );

    const duration = await screen.findByLabelText("Duration (minutes)") as HTMLInputElement;
    const attempts = screen.getByLabelText("Allowed Attempts") as HTMLInputElement;
    const shuffleSwitch = screen.getByRole("switch", { name: "Shuffle questions" }) as HTMLButtonElement;

    // Question structure and scoring controls are locked
    expect(duration.disabled).toBe(true);
    expect(attempts.disabled).toBe(false);
    expect(shuffleSwitch.disabled).toBe(true);

    // A single, clear explanation describes all locked quiz controls.
    expect(screen.getByText("Quiz settings locked")).toBeTruthy();
    expect(screen.getByText(/A student has already started this quiz/)).toBeTruthy();

    // Result release controls remain editable
    const releaseSelector = screen.getByRole("combobox", { name: /Quiz Results Release/i }) as HTMLButtonElement;
    expect(releaseSelector.disabled).toBe(false);
    expect(screen.queryByRole("switch", { name: /Show quiz results to students/i })).toBeNull();
  });

  it("saves release-only changes on a started quiz via results-settings without calling classwork update or assign", async () => {
    const apiFetchMock = vi.mocked(apiFetch);
    apiFetchMock.mockClear();
    const onSuccess = vi.fn();
    const attemptedQuizClasswork: TeacherClasswork = {
      classwork_id: 99,
      title: "Attempted Quiz",
      classwork_type: "QUIZ",
      total_points: 50,
      is_published: true,
      show_scores: true,
      is_locked: false,
      is_archived: false,
      subject_id: 10,
      attachments: [],
      reference_links: [],
      linked_lessons: [sampleLesson],
      assignments: [{
        classwork_assignment_id: 102,
        classwork_id: 99,
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
          classwork={attemptedQuizClasswork}
          onSuccess={onSuccess}
        />
      </MemoryRouter>,
    );

    const releaseSelector = await screen.findByRole("combobox", { name: /Quiz Results Release/i });
    await waitFor(() => expect((releaseSelector as HTMLButtonElement).disabled).toBe(false));

    fireEvent.click(releaseSelector);
    fireEvent.click(await screen.findByText("Keep results hidden"));
    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));

    const calledUrls = apiFetchMock.mock.calls.map(([url, init]) => ({
      url: String(url),
      method: (init as RequestInit | undefined)?.method ?? "GET",
      body: (init as RequestInit | undefined)?.body,
    }));
    const resultsCall = calledUrls.find(
      (call) => call.url === "/api/v1/quizzes/classwork/99/results-settings" && call.method === "PUT",
    );
    expect(resultsCall).toBeDefined();
    expect(JSON.parse(String(resultsCall?.body))).toEqual({
      release_policy: "HIDDEN",
      summary_release_at: null,
      confirm_answer_reveal: false,
    });
    expect(
      calledUrls.some((call) => call.url === "/api/v1/classwork-assignments/classwork/99" && call.method === "PUT"),
    ).toBe(false);
    expect(
      calledUrls.some((call) => call.url === "/api/v1/classwork-assignments/classwork/99/assign" && call.method === "POST"),
    ).toBe(false);
  });

  it("treats legacy mixed scheduled quizzes as hidden without rendering the scheduled date picker", async () => {
    const legacyMixedScheduledQuiz: TeacherClasswork = {
      classwork_id: 88,
      title: "Legacy Mixed Scheduled Quiz",
      classwork_type: "QUIZ",
      total_points: 20,
      is_published: true,
      show_scores: false,
      is_locked: false,
      is_archived: false,
      subject_id: 10,
      attachments: [],
      reference_links: [],
      assignments: [{
        classwork_assignment_id: 103,
        classwork_id: 88,
        class_id: 100,
        max_attempts: 1,
        is_published: true,
        show_scores: false,
      }],
    };

    render(
      <MemoryRouter>
        <EditClassworkModal
          isOpen={true}
          onClose={vi.fn()}
          classwork={legacyMixedScheduledQuiz}
          onSuccess={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByText(/This legacy quiz has mixed visibility settings and is treated as hidden/i),
    ).toBeDefined();
    expect(screen.queryByLabelText("Release Date & Time")).toBeNull();
    expect(screen.getByText(/Scores and answer feedback remain hidden from students/i)).toBeDefined();
  });
});

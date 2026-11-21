// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
      if (url.includes("/api/v1/quizzes/classwork/55")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            duration_minutes: 30,
            has_attempts: false,
            settings: {
              is_shuffle_questions: false,
              is_shuffle_options: false,
              enable_per_question_scoring: true,
              enable_per_question_time_limits: false,
              max_attempts: 3,
              show_correct_answers: true,
              summary_release_mode: "IMMEDIATE",
              summary_release_at: null,
            },
            questions: [
              {
                quiz_question_id: 1,
                question_id: 10,
                question_text: "What is the rhyme scheme of a Shakespearean sonnet?",
                question_type: "MULTIPLE_CHOICE",
                points: 12,
                display_order: 1,
                difficulty_level: "MEDIUM",
                explanation: "Shakespearean sonnets use ABAB CDCD EFEF GG.",
                lesson_id: 1,
                options: [
                  { option_id: 1, option_text: "ABAB CDCD EFEF GG", is_correct: true, option_order: 1 },
                  { option_id: 2, option_text: "AABB CCDD EEFF GG", is_correct: false, option_order: 2 },
                ],
              },
              {
                quiz_question_id: 2,
                question_id: 11,
                question_text: "How many lines are in a traditional sonnet?",
                question_type: "MULTIPLE_CHOICE",
                points: 8,
                display_order: 2,
                difficulty_level: "EASY",
                explanation: "A traditional sonnet always has 14 lines.",
                lesson_id: 1,
                options: [
                  { option_id: 3, option_text: "12 lines", is_correct: false, option_order: 1 },
                  { option_id: 4, option_text: "14 lines", is_correct: true, option_order: 2 },
                ],
              },
            ],
          }),
        });
      }
      if (url.includes("/api/v1/classwork-assignments/with-assignments")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ classwork_id: 777 }),
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
              is_shuffle_options: true,
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

  it("loads original target quiz questions into Quiz Builder when initialQuizMode is reuse and allows going back from Step 1", async () => {
    const onBack = vi.fn();
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
            initialTitle="English 8 focused practice"
            initialQuizMode="reuse"
            initialOriginalClassworkId={55}
            remediationDraft={true}
            remediationGradeTreatment="WRITTEN_WORK"
            remediationOriginalTargets={[
              {
                assignment_id: 201,
                classwork_id: 55,
                title: "Poetry Quiz 1",
                component: "WRITTEN_WORK",
                original_score: 10,
                max_points: 20,
              },
            ]}
            initialTargetAssignmentId={201}
            onClose={vi.fn()}
            onSuccess={vi.fn()}
            onBack={onBack}
          />
        </Dialog>
      </MemoryRouter>,
    );

    // Opens directly on Step 1 (details), skipping Choose Quiz Creation Method
    expect(screen.queryByText("Choose Quiz Creation Method")).toBeNull();
    expect(await screen.findByText(/Step 1 of 3/i)).toBeDefined();

    // Advance to Step 2 (Quiz question builder) and verify reused question loaded
    const nextBtn = await screen.findByRole("button", { name: /Next/i });
    await vi.waitFor(() => expect(nextBtn.hasAttribute("disabled")).toBe(false));
    nextBtn.click();

    expect(await screen.findByText("Quiz question builder")).toBeDefined();
    expect(
      screen.getByDisplayValue("What is the rhyme scheme of a Shakespearean sonnet?"),
    ).toBeDefined();

    // Go back from Step 2 to Step 1, then click Previous on Step 1 to return to Step 3 method selection
    const prevBtn = screen.getByRole("button", { name: /Previous/i });
    prevBtn.click();
    expect(await screen.findByText(/Step 1 of 3/i)).toBeDefined();

    const step1PrevBtn = screen.getByRole("button", { name: /Previous/i });
    step1PrevBtn.click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("loads original questions, choices, correct answers, and points, preserves shuffle settings on save, and prevents overwriting edits across step navigation", async () => {
    const onSuccess = vi.fn();
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
            initialTitle="Poetry Remediation Quiz"
            initialQuizMode="reuse"
            initialOriginalClassworkId={55}
            remediationDraft={true}
            remediationGradeTreatment="WRITTEN_WORK"
            remediationOriginalTargets={[
              {
                assignment_id: 201,
                classwork_id: 55,
                title: "Poetry Quiz 1",
                component: "WRITTEN_WORK",
                original_score: 10,
                max_points: 20,
              },
            ]}
            initialTargetAssignmentId={201}
            onClose={vi.fn()}
            onSuccess={onSuccess}
            onBack={vi.fn()}
          />
        </Dialog>
      </MemoryRouter>,
    );

    const nextBtn = await screen.findByRole("button", { name: /Next/i });
    await vi.waitFor(() => expect(nextBtn.hasAttribute("disabled")).toBe(false));
    fireEvent.click(nextBtn);

    expect(await screen.findByText("Quiz question builder")).toBeDefined();
    expect(screen.getByText("20/20 pts")).toBeDefined();

    // Verify both original questions, choices, correct answers, and points loaded accurately
    expect(
      screen.getByDisplayValue("What is the rhyme scheme of a Shakespearean sonnet?"),
    ).toBeDefined();
    expect(
      screen.getByDisplayValue("How many lines are in a traditional sonnet?"),
    ).toBeDefined();
    expect(screen.getByDisplayValue("ABAB CDCD EFEF GG")).toBeDefined();
    expect(screen.getByDisplayValue("AABB CCDD EEFF GG")).toBeDefined();
    expect(screen.getByDisplayValue("12 lines")).toBeDefined();
    expect(screen.getByDisplayValue("14 lines")).toBeDefined();
    expect(screen.getByDisplayValue("12")).toBeDefined();
    expect(screen.getByDisplayValue("8")).toBeDefined();

    const choice1Checkboxes = screen.getAllByRole("checkbox", {
      name: "Mark choice 1 correct",
    });
    const choice2Checkboxes = screen.getAllByRole("checkbox", {
      name: "Mark choice 2 correct",
    });
    // Question 1 has choice 1 correct; Question 2 has choice 2 correct
    expect(choice1Checkboxes[0].getAttribute("aria-checked")).toBe("true");
    expect(choice2Checkboxes[0].getAttribute("aria-checked")).toBe("false");
    expect(choice1Checkboxes[1].getAttribute("aria-checked")).toBe("false");
    expect(choice2Checkboxes[1].getAttribute("aria-checked")).toBe("true");

    // Toggle both Shuffle questions and Shuffle answer choices in Step 2
    const shuffleQuestionsSwitch = screen.getByRole("switch", {
      name: "Shuffle questions",
    });
    const shuffleChoicesSwitch = screen.getByRole("switch", {
      name: "Shuffle answer choices",
    });
    expect(shuffleQuestionsSwitch.getAttribute("aria-checked")).toBe("false");
    expect(shuffleChoicesSwitch.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(shuffleQuestionsSwitch);
    fireEvent.click(shuffleChoicesSwitch);
    expect(shuffleQuestionsSwitch.getAttribute("aria-checked")).toBe("true");
    expect(shuffleChoicesSwitch.getAttribute("aria-checked")).toBe("true");

    // Edit question 1 text, navigate back to Step 1 and forward to Step 2, and verify edit is not overwritten or duplicated
    const q1Textarea = screen.getByDisplayValue(
      "What is the rhyme scheme of a Shakespearean sonnet?",
    );
    fireEvent.change(q1Textarea, {
      target: {
        value: "What is the rhyme scheme of a Shakespearean sonnet? (Edited)",
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /Previous/i }));
    expect(await screen.findByText(/Step 1 of 3/i)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    expect(await screen.findByText("Quiz question builder")).toBeDefined();
    expect(
      screen.getByDisplayValue(
        "What is the rhyme scheme of a Shakespearean sonnet? (Edited)",
      ),
    ).toBeDefined();
    expect(screen.getAllByText(/^Question \d+$/)).toHaveLength(2);

    // Advance to Step 3 (assign) and verify shuffle settings persist and submit in quiz_payload
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    expect(await screen.findByText(/Step 3 of 3/i)).toBeDefined();

    const step3ShuffleQuestions = screen.getByRole("switch", {
      name: "Shuffle questions",
    });
    const step3ShuffleChoices = screen.getByRole("switch", {
      name: "Shuffle answer choices",
    });
    expect(step3ShuffleQuestions.getAttribute("aria-checked")).toBe("true");
    expect(step3ShuffleChoices.getAttribute("aria-checked")).toBe("true");

    // Submit the quiz creation
    const submitBtn = screen.getByRole("button", { name: /^Save Draft$/i });
    fireEvent.click(submitBtn);

    await vi.waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const mockedApiFetch = vi.mocked(apiFetch);
    const submitCall = mockedApiFetch.mock.calls.find(([url]) =>
      String(url).includes("/api/v1/classwork-assignments/with-assignments"),
    );
    expect(submitCall).toBeDefined();
    const submittedFormData = submitCall?.[1]?.body as FormData;
    const quizPayload = JSON.parse(
      String(submittedFormData.get("quiz_payload")),
    );
    expect(quizPayload.settings.is_shuffle_questions).toBe(true);
    expect(quizPayload.settings.is_shuffle_options).toBe(true);
    expect(quizPayload.questions).toHaveLength(2);
    expect(quizPayload.questions[0].question_text).toBe(
      "What is the rhyme scheme of a Shakespearean sonnet? (Edited)",
    );
    expect(quizPayload.questions[0].points).toBe(12);
    expect(quizPayload.questions[0].options[0].is_correct).toBe(true);
    expect(quizPayload.questions[1].points).toBe(8);
    expect(quizPayload.questions[1].options[1].is_correct).toBe(true);
  });

  it("keeps manual and AI quiz builder workflows functional", async () => {
    const { unmount } = render(
      <MemoryRouter>
        <Dialog open={true}>
          <CreateClassworkQuizModal
            selectedType="QUIZ"
            subjects={sampleSubjects}
            loads={sampleLoads}
            initialSubjectId="10"
            initialClassId={100}
            initialLessonId={1}
            initialTitle="Manual Remediation Quiz"
            initialQuizMode="manual"
            remediationDraft={true}
            remediationGradeTreatment="PRACTICE_ONLY"
            onClose={vi.fn()}
            onSuccess={vi.fn()}
            onBack={vi.fn()}
          />
        </Dialog>
      </MemoryRouter>,
    );

    const nextBtn = await screen.findByRole("button", { name: /Next/i });
    fireEvent.click(nextBtn);
    expect(await screen.findByText("Quiz question builder")).toBeDefined();
    expect(screen.getAllByText(/^Question \d+$/)).toHaveLength(1);
    unmount();

    const onAiBack = vi.fn();
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
            initialQuizMode="ai"
            initialAiRemediationDraft={{
              draft_format: "QUIZ",
              target_component: "WRITTEN_WORK",
              grade_treatment: "PRACTICE_ONLY",
              title: "AI Remediation Quiz",
              instructions: "Complete all AI questions.",
              total_points: 20,
              questions: [
                {
                  question_text: "Which poetic device compares two things using like or as?",
                  question_type: "MULTIPLE_CHOICE",
                  points: 12,
                  display_order: 1,
                  difficulty_level: "EASY",
                  targeted_lesson_id: 1,
                  targeted_competency_id: 1,
                  options: [
                    { option_text: "Simile", option_order: 1 },
                    { option_text: "Metaphor", option_order: 2 },
                  ],
                  teacher_answer_key: {
                    correct_answer: "Simile",
                    explanation: "Simile uses like or as.",
                  },
                },
                {
                  question_text: "Which device gives human qualities to non-human things?",
                  question_type: "MULTIPLE_CHOICE",
                  points: 8,
                  display_order: 2,
                  difficulty_level: "MEDIUM",
                  targeted_lesson_id: 1,
                  targeted_competency_id: 1,
                  options: [
                    { option_text: "Hyperbole", option_order: 1 },
                    { option_text: "Personification", option_order: 2 },
                  ],
                  teacher_answer_key: {
                    correct_answer: "B.",
                    explanation: "Personification assigns human traits.",
                  },
                },
              ],
            }}
            remediationDraft={true}
            remediationGradeTreatment="PRACTICE_ONLY"
            onClose={vi.fn()}
            onSuccess={vi.fn()}
            onBack={onAiBack}
          />
        </Dialog>
      </MemoryRouter>,
    );

    expect(await screen.findByDisplayValue("AI Remediation Quiz")).toBeDefined();
    expect(screen.getByDisplayValue("Complete all AI questions.")).toBeDefined();
    expect(screen.getByDisplayValue("20")).toBeDefined();

    const aiNextBtn = screen.getByRole("button", { name: /Next/i });
    fireEvent.click(aiNextBtn);
    expect(await screen.findByText("Quiz question builder")).toBeDefined();
    expect(screen.getByText("20/20 pts")).toBeDefined();
    expect(
      screen.getByDisplayValue(
        "Which poetic device compares two things using like or as?",
      ),
    ).toBeDefined();
    expect(
      screen.getByDisplayValue(
        "Which device gives human qualities to non-human things?",
      ),
    ).toBeDefined();

    // Verify both exact-text and letter-coded answer keys mapped accurately
    const aiChoice1Boxes = screen.getAllByRole("checkbox", {
      name: "Mark choice 1 correct",
    });
    const aiChoice2Boxes = screen.getAllByRole("checkbox", {
      name: "Mark choice 2 correct",
    });
    expect(aiChoice1Boxes[0].getAttribute("aria-checked")).toBe("true");
    expect(aiChoice2Boxes[0].getAttribute("aria-checked")).toBe("false");
    expect(aiChoice1Boxes[1].getAttribute("aria-checked")).toBe("false");
    expect(aiChoice2Boxes[1].getAttribute("aria-checked")).toBe("true");

    // Verify back-navigation returns to Step 1 and then Step 3 method selection
    fireEvent.click(screen.getByRole("button", { name: /Previous/i }));
    expect(await screen.findByText(/Step 1 of 3/i)).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Previous/i }));
    expect(onAiBack).toHaveBeenCalledTimes(1);
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
    expect(screen.getByRole("switch", { name: "Shuffle answer choices" }).getAttribute("aria-checked")).toBe("true");
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
    const shuffleChoicesSwitch = screen.getByRole("switch", { name: "Shuffle answer choices" });

    expect(duration.disabled).toBe(false);
    expect(attempts.disabled).toBe(false);
    expect((shuffleSwitch as HTMLButtonElement).disabled).toBe(false);
    expect((shuffleChoicesSwitch as HTMLButtonElement).disabled).toBe(false);
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
    const shuffleChoicesSwitch = screen.getByRole("switch", { name: "Shuffle answer choices" }) as HTMLButtonElement;

    // Question structure and scoring controls are locked
    expect(duration.disabled).toBe(true);
    expect(attempts.disabled).toBe(false);
    expect(shuffleSwitch.disabled).toBe(true);
    expect(shuffleChoicesSwitch.disabled).toBe(true);

    // A single, clear explanation describes all locked quiz controls.
    expect(screen.getByText("Quiz settings locked")).toBeTruthy();
    expect(screen.getByText(/A student has already started this quiz/)).toBeTruthy();

    // Result release controls remain editable
    const showResultsSwitch = screen.getByRole("switch", { name: /Show quiz results to students/i }) as HTMLButtonElement;
    expect(showResultsSwitch.disabled).toBe(false);
  });
});

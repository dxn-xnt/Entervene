// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PracticeAssessmentModal from "./practice-assessment-modal";
import type { PracticeQuestionDraft } from "@/lib/practice-assessment-api";

const api = vi.hoisted(() => ({
  getTeacherPracticeAssessment: vi.fn(),
  initializeTeacherPracticeAssessment: vi.fn(),
  updateTeacherPracticeAssessment: vi.fn(),
  batchSavePracticeQuestions: vi.fn(),
  saveTeacherPracticeAssessment: vi.fn(),
  generatePracticeQuestionsAI: vi.fn(),
  importPracticeQuestionsPreview: vi.fn(),
  listTeacherPracticeAttempts: vi.fn(),
  publishTeacherPracticeAssessment: vi.fn(),
  archiveTeacherPracticeAssessment: vi.fn(),
}));

vi.mock("@/lib/practice-assessment-api", () => api);
vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

function generatedQuestions(prefix: string, count = 5): PracticeQuestionDraft[] {
  return Array.from({ length: count }, (_, index) => ({
    question_text: `${prefix} question ${index + 1}`,
    question_type: "MULTIPLE_CHOICE" as const,
    points: 1,
    explanation: `${prefix} explanation ${index + 1}`,
    display_order: index + 1,
    is_ai_generated: true,
    options: [
      { option_text: `Correct ${index + 1}`, is_correct: true, option_order: 1 },
      { option_text: `Distractor ${index + 1}`, is_correct: false, option_order: 2 },
    ],
  }));
}

async function openGenerator() {
  fireEvent.click(await screen.findByRole("button", { name: /Generate with AI/i }));
  return screen.findByRole("button", { name: /^Generate Questions$/i });
}

describe("PracticeAssessmentModal AI draft generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getTeacherPracticeAssessment.mockResolvedValue(null);
    api.listTeacherPracticeAttempts.mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it("generates the exact requested draft without creating an assessment row", async () => {
    api.generatePracticeQuestionsAI.mockResolvedValue(generatedQuestions("First"));
    render(
      <PracticeAssessmentModal
        isOpen
        onClose={vi.fn()}
        interventionId={41}
        selectedReadingIds={[11, 12]}
      />,
    );

    fireEvent.click(await openGenerator());

    await waitFor(() => expect(api.generatePracticeQuestionsAI).toHaveBeenCalledTimes(1));
    expect(api.generatePracticeQuestionsAI).toHaveBeenCalledWith(41, {
      target_count: 5,
      reading_classwork_ids: [11, 12],
      additional_guidance: undefined,
    });
    expect(api.initializeTeacherPracticeAssessment).not.toHaveBeenCalled();
    expect(await screen.findAllByPlaceholderText("Enter the question prompt...")).toHaveLength(5);
  });

  it("regeneration replaces the existing five questions instead of appending to ten", async () => {
    api.generatePracticeQuestionsAI
      .mockResolvedValueOnce(generatedQuestions("First"))
      .mockResolvedValueOnce(generatedQuestions("Second"));
    render(
      <PracticeAssessmentModal
        isOpen
        onClose={vi.fn()}
        interventionId={42}
        selectedReadingIds={[11]}
      />,
    );

    fireEvent.click(await openGenerator());
    expect(await screen.findAllByPlaceholderText("Enter the question prompt...")).toHaveLength(5);

    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Regenerate Questions$/i }));

    await waitFor(() => expect(api.generatePracticeQuestionsAI).toHaveBeenCalledTimes(2));
    const prompts = await screen.findAllByPlaceholderText("Enter the question prompt...");
    expect(prompts).toHaveLength(5);
    expect((prompts[0] as HTMLTextAreaElement).value).toBe("Second question 1");
    expect(screen.queryByDisplayValue("First question 1")).toBeNull();
  });

  it("rejects an incomplete provider response without changing the current draft", async () => {
    api.generatePracticeQuestionsAI.mockResolvedValue(generatedQuestions("Short", 4));
    render(
      <PracticeAssessmentModal
        isOpen
        onClose={vi.fn()}
        interventionId={43}
        selectedReadingIds={[11]}
      />,
    );

    fireEvent.click(await openGenerator());

    expect(await screen.findByText(/returned 4 of 5 requested questions/i)).toBeDefined();
    expect(screen.queryAllByPlaceholderText("Enter the question prompt...")).toHaveLength(0);
    expect(api.initializeTeacherPracticeAssessment).not.toHaveBeenCalled();
  });

  it("preserves an unsaved generated draft across close and reopen", async () => {
    api.generatePracticeQuestionsAI.mockResolvedValue(generatedQuestions("Preserved"));
    const { rerender } = render(
      <PracticeAssessmentModal
        isOpen
        onClose={vi.fn()}
        interventionId={44}
        selectedReadingIds={[11]}
      />,
    );
    fireEvent.click(await openGenerator());
    expect(await screen.findAllByPlaceholderText("Enter the question prompt...")).toHaveLength(5);

    rerender(
      <PracticeAssessmentModal
        isOpen={false}
        onClose={vi.fn()}
        interventionId={44}
        selectedReadingIds={[11]}
      />,
    );
    rerender(
      <PracticeAssessmentModal
        isOpen
        onClose={vi.fn()}
        interventionId={44}
        selectedReadingIds={[11]}
      />,
    );

    expect(await screen.findAllByPlaceholderText("Enter the question prompt...")).toHaveLength(5);
    expect(api.getTeacherPracticeAssessment).toHaveBeenCalledTimes(1);
  });

  it("persists the approved assessment only when Save Draft is clicked", async () => {
    const questions = generatedQuestions("Approved");
    api.generatePracticeQuestionsAI.mockResolvedValue(questions);
    api.saveTeacherPracticeAssessment.mockResolvedValue({
      practice_assessment_id: 91,
      intervention_id: 46,
      title: "Practice Assessment",
      status: "DRAFT",
      gatekeeper_policy: "REQUIRE_PASS",
      passing_percentage: 75,
      shuffle_options: true,
      version: 1,
      questions: [],
    });
    render(
      <PracticeAssessmentModal
        isOpen
        onClose={vi.fn()}
        interventionId={46}
        selectedReadingIds={[11]}
      />,
    );

    fireEvent.click(await openGenerator());
    expect(await screen.findAllByPlaceholderText("Enter the question prompt...")).toHaveLength(5);
    expect(api.initializeTeacherPracticeAssessment).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(api.saveTeacherPracticeAssessment).toHaveBeenCalledTimes(1));
    expect(api.saveTeacherPracticeAssessment).toHaveBeenCalledWith(46, {
      title: "Practice Assessment",
      passing_percentage: 75,
      gatekeeper_policy: "REQUIRE_PASS",
      questions,
      publish: false,
    });
  });

  it("synchronizes edits, deletions, and ordering on repeated saves and reopen", async () => {
    let persistedQuestions = generatedQuestions("Original", 3);
    const assessment = () => ({
      practice_assessment_id: 92,
      intervention_id: 47,
      title: "Practice Assessment",
      status: "DRAFT",
      gatekeeper_policy: "REQUIRE_PASS",
      passing_percentage: 75,
      shuffle_options: true,
      version: 1,
      questions: persistedQuestions,
    });
    api.getTeacherPracticeAssessment.mockImplementation(async () => assessment());
    api.saveTeacherPracticeAssessment.mockImplementation(
      async (_interventionId, payload: { questions?: PracticeQuestionDraft[] }) => {
        const questions = payload.questions || persistedQuestions;
        persistedQuestions = questions.map((question, index) => ({
          ...question,
          display_order: index + 1,
        }));
        return assessment();
      },
    );

    const { rerender } = render(
      <PracticeAssessmentModal
        isOpen
        onClose={vi.fn()}
        interventionId={47}
        selectedReadingIds={[11]}
      />,
    );

    const initialPrompts = await screen.findAllByPlaceholderText("Enter the question prompt...");
    expect(initialPrompts).toHaveLength(3);
    fireEvent.change(initialPrompts[0], { target: { value: "Edited first question" } });
    fireEvent.click(screen.getAllByTitle("Delete Question")[1]);
    fireEvent.click(screen.getAllByTitle("Move Down")[0]);

    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(api.saveTeacherPracticeAssessment).toHaveBeenCalledTimes(1));
    expect(api.saveTeacherPracticeAssessment).toHaveBeenLastCalledWith(
      47,
      expect.objectContaining({
        questions: expect.arrayContaining([
          expect.objectContaining({ question_text: "Original question 3" }),
          expect.objectContaining({ question_text: "Edited first question" }),
        ]),
        publish: false,
      }),
    );
    expect(persistedQuestions.map((question) => question.question_text)).toEqual([
      "Original question 3",
      "Edited first question",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(api.saveTeacherPracticeAssessment).toHaveBeenCalledTimes(2));
    expect(persistedQuestions).toHaveLength(2);

    rerender(
      <PracticeAssessmentModal
        isOpen={false}
        onClose={vi.fn()}
        interventionId={47}
        selectedReadingIds={[11]}
      />,
    );
    rerender(
      <PracticeAssessmentModal
        isOpen
        onClose={vi.fn()}
        interventionId={47}
        selectedReadingIds={[11]}
      />,
    );

    const reopenedPrompts = await screen.findAllByPlaceholderText("Enter the question prompt...");
    expect(reopenedPrompts).toHaveLength(2);
    expect(reopenedPrompts.map((input) => (input as HTMLTextAreaElement).value)).toEqual([
      "Original question 3",
      "Edited first question",
    ]);
  });

  it("publishes settings and questions with one atomic request", async () => {
    const questions = generatedQuestions("Publish", 2);
    const draft = {
      practice_assessment_id: 95,
      intervention_id: 50,
      title: "Draft assessment",
      status: "DRAFT",
      gatekeeper_policy: "REQUIRE_PASS",
      passing_percentage: 75,
      version: 1,
      questions,
    };
    api.getTeacherPracticeAssessment.mockResolvedValue(draft);
    api.saveTeacherPracticeAssessment.mockResolvedValue({ ...draft, status: "PUBLISHED" });

    render(
      <PracticeAssessmentModal
        isOpen
        onClose={vi.fn()}
        interventionId={50}
        selectedReadingIds={[11]}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Publish Assessment" }));
    await waitFor(() => expect(api.saveTeacherPracticeAssessment).toHaveBeenCalledTimes(1));
    expect(api.saveTeacherPracticeAssessment).toHaveBeenCalledWith(50, {
      title: "Draft assessment",
      passing_percentage: 75,
      gatekeeper_policy: "REQUIRE_PASS",
      questions,
      publish: true,
    });
    expect(api.updateTeacherPracticeAssessment).not.toHaveBeenCalled();
    expect(api.batchSavePracticeQuestions).not.toHaveBeenCalled();
    expect(api.publishTeacherPracticeAssessment).not.toHaveBeenCalled();
  });

  it("warns and blocks saving when selected readings change after generation", async () => {
    api.generatePracticeQuestionsAI.mockResolvedValue(generatedQuestions("Stale"));
    const { rerender } = render(
      <PracticeAssessmentModal
        isOpen
        onClose={vi.fn()}
        interventionId={45}
        selectedReadingIds={[11]}
      />,
    );
    fireEvent.click(await openGenerator());
    expect(await screen.findAllByPlaceholderText("Enter the question prompt...")).toHaveLength(5);

    rerender(
      <PracticeAssessmentModal
        isOpen
        onClose={vi.fn()}
        interventionId={45}
        selectedReadingIds={[11, 12]}
      />,
    );

    expect(await screen.findByText("Reading materials changed")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    expect(await screen.findByText(/Regenerate the questions before saving this draft/i)).toBeDefined();
    expect(api.saveTeacherPracticeAssessment).not.toHaveBeenCalled();
  });

  it("tracks manual settings and question changes and offers continue or discard", async () => {
    const originalQuestions = generatedQuestions("Original", 3);
    api.getTeacherPracticeAssessment.mockResolvedValue({
      practice_assessment_id: 93,
      intervention_id: 48,
      title: "Original Assessment",
      status: "DRAFT",
      gatekeeper_policy: "REQUIRE_PASS",
      passing_percentage: 75,
      shuffle_options: true,
      version: 1,
      questions: originalQuestions,
    });
    const onClose = vi.fn();
    const { rerender } = render(
      <PracticeAssessmentModal
        isOpen
        onClose={onClose}
        interventionId={48}
        selectedReadingIds={[11]}
      />,
    );

    fireEvent.change(await screen.findByLabelText("Assessment Title"), {
      target: { value: "Teacher Edited Assessment" },
    });
    fireEvent.change(screen.getByLabelText(/Passing Percentage/i), {
      target: { value: "82" },
    });
    fireEvent.click(screen.getByText("Optional Practice"));
    const prompts = screen.getAllByPlaceholderText("Enter the question prompt...");
    fireEvent.change(prompts[0], { target: { value: "Teacher edited question" } });
    fireEvent.click(screen.getByRole("button", { name: /Add True \/ False/i }));
    fireEvent.click(screen.getAllByTitle("Delete Question")[1]);
    fireEvent.click(screen.getAllByTitle("Move Down")[0]);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("Unsaved Practice Assessment Changes")).toBeDefined();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Continue Editing" }));
    expect(screen.queryByText("Unsaved Practice Assessment Changes")).toBeNull();
    expect((screen.getByLabelText("Assessment Title") as HTMLInputElement).value).toBe(
      "Teacher Edited Assessment",
    );
    expect(screen.getByDisplayValue("Teacher edited question")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByRole("button", { name: "Discard Changes" }));
    expect(onClose).toHaveBeenCalledTimes(1);

    rerender(
      <PracticeAssessmentModal
        isOpen={false}
        onClose={onClose}
        interventionId={48}
        selectedReadingIds={[11]}
      />,
    );
    rerender(
      <PracticeAssessmentModal
        isOpen
        onClose={onClose}
        interventionId={48}
        selectedReadingIds={[11]}
      />,
    );

    await waitFor(() => expect(api.getTeacherPracticeAssessment).toHaveBeenCalledTimes(2));
    expect((await screen.findByLabelText("Assessment Title") as HTMLInputElement).value).toBe(
      "Original Assessment",
    );
    expect(screen.getAllByPlaceholderText("Enter the question prompt...")).toHaveLength(3);
  });

  it("keeps edits after a failed prompt save and clears dirty state after success", async () => {
    const questions = generatedQuestions("Saved", 2);
    const persisted = {
      practice_assessment_id: 94,
      intervention_id: 49,
      title: "Original Assessment",
      status: "DRAFT",
      gatekeeper_policy: "REQUIRE_PASS",
      passing_percentage: 75,
      shuffle_options: true,
      version: 1,
      questions,
    };
    api.getTeacherPracticeAssessment.mockResolvedValue(persisted);
    api.saveTeacherPracticeAssessment
      .mockRejectedValueOnce(new Error("Save unavailable"))
      .mockResolvedValueOnce({ ...persisted, title: "Edited Assessment" });
    const onClose = vi.fn();
    render(
      <PracticeAssessmentModal
        isOpen
        onClose={onClose}
        interventionId={49}
        selectedReadingIds={[11]}
      />,
    );

    fireEvent.change(await screen.findByLabelText("Assessment Title"), {
      target: { value: "Edited Assessment" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save Changes" }));

    expect(await screen.findByText("Save unavailable")).toBeDefined();
    expect(screen.getByText("Unsaved Practice Assessment Changes")).toBeDefined();
    expect((screen.getByLabelText("Assessment Title") as HTMLInputElement).value).toBe(
      "Edited Assessment",
    );
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.saveTeacherPracticeAssessment).toHaveBeenCalledWith(49, expect.objectContaining({
      title: "Edited Assessment",
      questions,
      publish: false,
    }));
  });
});

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
    api.initializeTeacherPracticeAssessment.mockResolvedValue({
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
    api.batchSavePracticeQuestions.mockResolvedValue(questions);
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
    await waitFor(() => expect(api.initializeTeacherPracticeAssessment).toHaveBeenCalledTimes(1));
    expect(api.batchSavePracticeQuestions).toHaveBeenCalledWith(46, questions);
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
    expect(api.initializeTeacherPracticeAssessment).not.toHaveBeenCalled();
    expect(api.batchSavePracticeQuestions).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PracticeAssessmentModal from "./practice-assessment-modal";
import type {
  PracticeAssessmentDetail,
  PracticeAttemptSummary,
  PracticeQuestionDraft,
} from "@/lib/practice-assessment-api";

const api = vi.hoisted(() => ({
  getAssessment: vi.fn(),
  initAssessment: vi.fn(),
  updateAssessment: vi.fn(),
  publishAssessment: vi.fn(),
  archiveAssessment: vi.fn(),
  batchSaveQuestions: vi.fn(),
  aiGenerate: vi.fn(),
  importPreview: vi.fn(),
  listAttempts: vi.fn(),
}));

vi.mock("@/lib/practice-assessment-api", async (original) => ({
  ...(await original<typeof import("@/lib/practice-assessment-api")>()),
  getTeacherPracticeAssessment: api.getAssessment,
  initializeTeacherPracticeAssessment: api.initAssessment,
  updateTeacherPracticeAssessment: api.updateAssessment,
  publishTeacherPracticeAssessment: api.publishAssessment,
  archiveTeacherPracticeAssessment: api.archiveAssessment,
  batchSavePracticeQuestions: api.batchSaveQuestions,
  generatePracticeQuestionsAI: api.aiGenerate,
  importPracticeQuestionsPreview: api.importPreview,
  listTeacherPracticeAttempts: api.listAttempts,
}));

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

const mockQuestions: PracticeQuestionDraft[] = [
  {
    practice_question_id: 101,
    question_text: "What is 2 + 2?",
    question_type: "MULTIPLE_CHOICE",
    points: 1,
    display_order: 1,
    explanation: "Basic addition",
    options: [
      { option_text: "3", is_correct: false, option_order: 1 },
      { option_text: "4", is_correct: true, option_order: 2 },
    ],
  },
  {
    practice_question_id: 102,
    question_text: "The earth is flat.",
    question_type: "TRUE_FALSE",
    points: 1,
    display_order: 2,
    explanation: "Earth is an oblate spheroid",
    options: [
      { option_text: "True", is_correct: false, option_order: 1 },
      { option_text: "False", is_correct: true, option_order: 2 },
    ],
  },
];

const mockAssessment: PracticeAssessmentDetail = {
  practice_assessment_id: 1,
  intervention_id: 42,
  title: "Algebra Foundation Practice",
  status: "DRAFT",
  gatekeeper_policy: "REQUIRE_PASS",
  passing_percentage: 75,
  version: 1,
  questions: mockQuestions,
};

const mockAttempts: PracticeAttemptSummary[] = [
  {
    attempt_id: 501,
    practice_assessment_id: 1,
    student_id: "s1",
    attempt_number: 1,
    status: "SUBMITTED",
    total_score: 1,
    max_score: 2,
    score_percentage: 50,
    is_passed: false,
    started_at: "2026-11-01T10:00:00Z",
    completed_at: "2026-11-01T10:15:00Z",
  },
];

describe("PracticeAssessmentModal (Teacher Interface)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getAssessment.mockResolvedValue(null);
    api.listAttempts.mockResolvedValue([]);
    api.initAssessment.mockResolvedValue(mockAssessment);
    api.updateAssessment.mockResolvedValue(mockAssessment);
  });

  afterEach(() => {
    cleanup();
  });

  it("does not render when isOpen is false", () => {
    render(
      <PracticeAssessmentModal
        isOpen={false}
        onClose={vi.fn()}
        interventionId={42}
      />
    );
    expect(screen.queryByText("Practice Assessment")).toBeNull();
  });

  it("renders empty state and allows authoring when no assessment exists yet", async () => {
    render(
      <PracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={42}
        studentName="Alex Rivera"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Practice Assessment")).toBeTruthy();
    });

    expect(screen.getByText(/Alex Rivera/i)).toBeTruthy();
    expect(screen.getByText("No Practice Questions")).toBeTruthy();

    // Policy options are displayed
    expect(screen.getByText("Require Passing Score")).toBeTruthy();
    expect(screen.getByText("Allow Progress Below Passing")).toBeTruthy();
    expect(screen.getByText("Optional Practice")).toBeTruthy();
  });

  it("loads and displays existing assessment details and questions", async () => {
    api.getAssessment.mockResolvedValue(mockAssessment);
    api.listAttempts.mockResolvedValue([]);

    render(
      <PracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={42}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue("Algebra Foundation Practice")).toBeTruthy();
    });

    expect(screen.getByDisplayValue("75")).toBeTruthy();
    expect(screen.getByDisplayValue("What is 2 + 2?")).toBeTruthy();
    expect(screen.getByDisplayValue("The earth is flat.")).toBeTruthy();
  });

  it("allows adding a new multiple choice question manually", async () => {
    api.getAssessment.mockResolvedValue(mockAssessment);

    render(
      <PracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={42}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Add Multiple Choice/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Add Multiple Choice/i }));

    // Question #3 should now appear
    expect(screen.getByText("#3")).toBeTruthy();
    expect(screen.getByText("Questions (3)")).toBeTruthy();
  });

  it("displays locking alert and hides authoring actions when student attempts exist", async () => {
    api.getAssessment.mockResolvedValue({
      ...mockAssessment,
      status: "PUBLISHED",
    });
    api.listAttempts.mockResolvedValue(mockAttempts);

    render(
      <PracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={42}
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Questions Locked")).toBeTruthy();
    });

    expect(
      screen.getByText(/Student attempts already exist for this Practice Assessment/i)
    ).toBeTruthy();

    // Authoring actions bar is hidden when locked
    expect(screen.queryByRole("button", { name: /Add Multiple Choice/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /Generate with AI/i })).toBeNull();

    // Existing question inputs are disabled
    const questionInput = screen.getByDisplayValue("What is 2 + 2?");
    expect(questionInput).toHaveProperty("disabled", true);

    // Title and passing percentage remain editable
    const titleInput = screen.getByDisplayValue("Algebra Foundation Practice");
    expect(titleInput).not.toHaveProperty("disabled", true);
  });

  it("shows student attempt history in the Student Attempts tab", async () => {
    api.getAssessment.mockResolvedValue({
      ...mockAssessment,
      status: "PUBLISHED",
    });
    api.listAttempts.mockResolvedValue(mockAttempts);

    render(
      <PracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={42}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/Student Attempts \(1\)/i)).toBeTruthy();
    });

    fireEvent.click(screen.getByText(/Student Attempts \(1\)/i));

    expect(screen.getByText("Attempt #1")).toBeTruthy();
    expect(screen.getByText("1.0 / 2.0 pts")).toBeTruthy();
    expect(screen.getByText("50.0%")).toBeTruthy();
    expect(screen.getByText("BELOW PASSING")).toBeTruthy();
  });

  it("invokes AI generation grounded strictly in selected reading materials", async () => {
    api.getAssessment.mockResolvedValue(mockAssessment);
    api.aiGenerate.mockResolvedValue([
      {
        question_text: "AI generated question about photosynthesis?",
        question_type: "MULTIPLE_CHOICE",
        points: 1,
        explanation: "From reading #1",
        options: [
          { option_text: "Choice A", is_correct: true },
          { option_text: "Choice B", is_correct: false },
        ],
      },
    ]);

    render(
      <PracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={42}
        selectedReadingIds={[77, 88]}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Generate with AI/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));

    expect(screen.getByText("AI Practice Question Generation")).toBeTruthy();
    expect(screen.getByText(/2 approved material\(s\) saved/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Generate Questions/i }));

    await waitFor(() => {
      expect(api.aiGenerate).toHaveBeenCalledWith(42, {
        target_count: 5,
        reading_classwork_ids: [77, 88],
        additional_guidance: undefined,
      });
    });

    expect(await screen.findByDisplayValue("AI generated question about photosynthesis?")).toBeTruthy();
  });

  it("publishes the assessment when publish button is clicked", async () => {
    api.getAssessment.mockResolvedValue(mockAssessment);
    api.batchSaveQuestions.mockResolvedValue(mockQuestions);
    api.publishAssessment.mockResolvedValue({
      ...mockAssessment,
      status: "PUBLISHED",
    });

    const onUpdated = vi.fn();

    render(
      <PracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={42}
        onAssessmentUpdated={onUpdated}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Publish Assessment" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Publish Assessment" }));

    await waitFor(() => {
      expect(api.publishAssessment).toHaveBeenCalledWith(42);
    });

    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ status: "PUBLISHED" })
    );
  });

  it("archives the assessment when archive button is clicked", async () => {
    api.getAssessment.mockResolvedValue({
      ...mockAssessment,
      status: "PUBLISHED",
    });
    api.archiveAssessment.mockResolvedValue({
      ...mockAssessment,
      status: "ARCHIVED",
    });

    const onUpdated = vi.fn();

    render(
      <PracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={42}
        onAssessmentUpdated={onUpdated}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Archive" })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));

    await waitFor(() => {
      expect(api.archiveAssessment).toHaveBeenCalledWith(42);
    });

    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({ status: "ARCHIVED" })
    );
  });

  it("warns and disables AI generation when there are unsaved reading changes in the intervention plan", async () => {
    api.getAssessment.mockResolvedValue(mockAssessment);

    render(
      <PracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={42}
        savedReadingIds={[77]}
        selectedReadingIds={[77, 88]}
        hasUnsavedReadingChanges={true}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Generate with AI/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));

    expect(screen.getByText("Unsaved Reading Selections")).toBeTruthy();
    expect(
      screen.getByText(/You have unsaved changes to your supporting reading materials/i)
    ).toBeTruthy();

    const generateBtn = screen.getByRole("button", { name: /Generate Questions/i });
    expect(generateBtn).toHaveProperty("disabled", true);
  });

  it("disables AI generation when no approved reading materials are saved", async () => {
    api.getAssessment.mockResolvedValue(mockAssessment);

    render(
      <PracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={42}
        savedReadingIds={[]}
        selectedReadingIds={[]}
        hasUnsavedReadingChanges={false}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Generate with AI/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Generate with AI/i }));

    expect(screen.getByText("No Saved Reading Materials")).toBeTruthy();
    const generateBtn = screen.getByRole("button", { name: /Generate Questions/i });
    expect(generateBtn).toHaveProperty("disabled", true);
  });

  it("rejects unsupported file formats during import such as .json", async () => {
    api.getAssessment.mockResolvedValue(mockAssessment);

    render(
      <PracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={42}
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Import \(\.docx, \.pdf, \.txt\)/i })).toBeTruthy();
    });

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(fileInput).toBeTruthy();
    expect(fileInput.accept).toBe(".docx,.pdf,.txt");

    const unsupportedFile = new File(['{"questions": []}'], "quiz.json", {
      type: "application/json",
    });

    fireEvent.change(fileInput, { target: { files: [unsupportedFile] } });

    await waitFor(() => {
      expect(
        screen.getByText(/Unsupported file format\. Please upload a \.docx, \.pdf, or \.txt quiz document\./i)
      ).toBeTruthy();
    });

    expect(api.importPreview).not.toHaveBeenCalled();
  });

  it("clamps passing percentage between 0 and 100", async () => {
    api.getAssessment.mockResolvedValue(mockAssessment);

    render(
      <PracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={42}
      />
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue("75")).toBeTruthy();
    });

    const percentInput = screen.getByDisplayValue("75");

    fireEvent.change(percentInput, { target: { value: "-15" } });
    expect(screen.getByDisplayValue("0")).toBeTruthy();

    fireEvent.change(percentInput, { target: { value: "125" } });
    expect(screen.getByDisplayValue("100")).toBeTruthy();
  });
});

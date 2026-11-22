// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "@/components/retroui/Dialog";
import { apiFetch } from "@/lib/api";
import { DEADLINE_FUTURE_ERROR } from "@/lib/deadline-validation";
import type { TeacherClassLoad, TeacherLesson } from "@/types/classwork";
import CreateClassworkQuizModal from "./create-classwork-quiz";

const toast = {
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
};

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => toast,
}));

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn(),
}));

vi.mock("@/lib/quiz-export", () => ({
  exportQuizPdf: vi.fn(),
  exportQuizDocx: vi.fn(),
}));

vi.mock("./ai-quiz-generator-modal", () => ({
  default: () => null,
}));

// Lightweight DatePicker mock that renders a controllable input and exposes `min`
vi.mock("@/components/retroui/DatePicker", () => ({
  DatePicker: ({
    value,
    onValueChange,
    min,
    "aria-invalid": ariaInvalid,
    "aria-describedby": ariaDescribedBy,
  }: {
    value: string;
    onValueChange: (val: string) => void;
    min?: string;
    "aria-invalid"?: boolean;
    "aria-describedby"?: string;
  }) => (
    <input
      data-testid="mock-due-date-picker"
      data-min={min ?? ""}
      value={value}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      onChange={(e) => onValueChange(e.target.value)}
    />
  ),
}));

const lesson: TeacherLesson = {
  lesson_id: 501,
  title: "Variables",
  is_published: true,
  show_scores: true,
  is_draft: false,
  is_archived: false,
  subject_id: 10,
};

const loads: TeacherClassLoad[] = [
  {
    subject_load_id: 1,
    subject_id: 10,
    subject_name: "Programming",
    class_id: 101,
    section_name: "Alpha",
    grade_level: "Grade 7",
    student_count: 20,
    academic_period_id: 901,
  },
];

const jsonResponse = (body: unknown, ok = true) =>
  ({
    ok,
    json: async () => body,
  }) as Response;

function installApiMock(onCreate?: (body: FormData) => void) {
  vi.mocked(apiFetch).mockImplementation(async (url, init) => {
    const path = String(url);
    if (path === "/api/v1/lessons/501") return jsonResponse(lesson);
    if (path === "/api/v1/lessons/my-lessons") return jsonResponse([lesson]);
    if (path.startsWith("/api/v1/lessons/my-class/")) return jsonResponse([lesson]);
    if (path === "/api/v1/quizzes/import-preview") {
      return jsonResponse({
        title: "Imported Variables Quiz",
        instructions: null,
        questions: [
          {
            question_text: "Which name is a valid variable?",
            question_type: "MULTIPLE_CHOICE",
            points: 100,
            display_order: 1,
            difficulty_level: "EASY",
            explanation: "Variable names cannot start with a number.",
            options: [
              { option_text: "score", is_correct: true, option_order: 1 },
              { option_text: "1score", is_correct: false, option_order: 2 },
            ],
          },
        ],
        notices: [],
        summary: {
          question_count: 1,
          keyed_question_count: 1,
          normalized_key_count: 0,
          preserved_explanation_count: 1,
          needs_attention_count: 0,
        },
        warnings: [],
      });
    }
    if (path === "/api/v1/classwork-assignments/with-assignments") {
      onCreate?.(init?.body as FormData);
      return jsonResponse({ classwork_id: 700 });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
}

function renderModal(props: { initialQuizMode?: "manual" | "reuse" | "ai"; initialTitle?: string } = {}) {
  return render(
    <Dialog open>
      <CreateClassworkQuizModal
        selectedType="QUIZ"
        subjects={[{ id: 10, name: "Programming" }]}
        loads={loads}
        initialSubjectId="10"
        initialClassId={101}
        initialLessonId={501}
        initialTitle={props.initialTitle ?? "Manual Quiz"}
        initialQuizMode={props.initialQuizMode}
        onClose={vi.fn()}
        onSuccess={vi.fn()}
        onBack={vi.fn()}
      />
    </Dialog>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  // Freeze at 2026-11-23 15:30:00 local time
  vi.setSystemTime(new Date(2026, 10, 23, 15, 30, 0, 0));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("CreateClassworkQuizModal deadline validation", () => {
  it("rejects past and expired deadlines on submit and across step navigation for imported quizzes", async () => {
    const onCreate = vi.fn();
    installApiMock(onCreate);

    renderModal({ initialTitle: "" });

    // Import a quiz so questions are populated
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).toBeTruthy();
    const file = new File(["q"], "quiz.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fireEvent.change(fileInput!, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByDisplayValue("Imported Variables Quiz")).toBeTruthy();
    });

    // Step 1 -> Step 2 -> Step 3 (Assign)
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(screen.getByText("Quiz question builder")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const duePicker = await screen.findByLabelText(/Due Date/i, { selector: "input" });
    expect(duePicker.getAttribute("data-min")).toBe("2026-11-23T15:31");

    // 1. Selecting a past deadline (15:00 when now is 15:30) shows error and blocks submit
    fireEvent.change(duePicker, { target: { value: "2026-11-23T15:00" } });
    expect(screen.getByText(DEADLINE_FUTURE_ERROR)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(onCreate).not.toHaveBeenCalled();

    // 2. Selecting a valid future deadline (15:31) clears error
    fireEvent.change(duePicker, { target: { value: "2026-11-23T15:31" } });
    expect(screen.queryByText(DEADLINE_FUTURE_ERROR)).toBeNull();

    // 3. Navigate back to Quiz step and return to Assign step; advance clock past 15:31
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => {
      expect(screen.getByText("Quiz question builder")).toBeTruthy();
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByLabelText(/Due Date/i, { selector: "input" });

    vi.setSystemTime(new Date(2026, 10, 23, 15, 31, 0, 0));

    // Submitting now revalidates against live time and rejects the expired deadline
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    expect(await screen.findByText(DEADLINE_FUTURE_ERROR)).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();

    // 4. Updating to a future deadline (15:35) succeeds
    fireEvent.change(screen.getByLabelText(/Due Date/i, { selector: "input" }), {
      target: { value: "2026-11-23T15:35" },
    });
    expect(screen.queryByText(DEADLINE_FUTURE_ERROR)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => {
      expect(onCreate).toHaveBeenCalledTimes(1);
    });
  }, 15000);
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "@/components/retroui/Dialog";
import { apiFetch } from "@/lib/api";
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
  {
    subject_load_id: 2,
    subject_id: 10,
    subject_name: "Programming",
    class_id: 102,
    section_name: "Beta",
    grade_level: "Grade 7",
    student_count: 18,
    academic_period_id: 901,
  },
  {
    subject_load_id: 3,
    subject_id: 11,
    subject_name: "Mathematics",
    class_id: 103,
    section_name: "Gamma",
    grade_level: "Grade 7",
    student_count: 19,
    academic_period_id: 901,
  },
];

const response = (body: unknown, ok = true) => ({
  ok,
  json: async () => body,
}) as Response;

function installLessonResponses() {
  vi.mocked(apiFetch).mockImplementation(async (url) => {
    const path = String(url);
    if (path === "/api/v1/lessons/501") return response(lesson);
    if (path === "/api/v1/lessons/my-lessons") return response([lesson]);
    if (path.startsWith("/api/v1/lessons/my-class/")) return response([lesson]);
    throw new Error(`Unexpected request: ${path}`);
  });
}

function renderQuizWorkflow(props: {
  initialQuizMode?: "manual" | "reuse" | "ai";
  initialTitle?: string;
} = {}) {
  const onSuccess = vi.fn();
  const result = render(
    <Dialog open>
      <CreateClassworkQuizModal
        selectedType="QUIZ"
        subjects={[
          { id: 10, name: "Programming" },
          { id: 11, name: "Mathematics" },
        ]}
        loads={loads}
        initialSubjectId="10"
        initialClassId={101}
        initialLessonId={501}
        initialTitle={props.initialTitle ?? "Manual Quiz"}
        initialQuizMode={props.initialQuizMode}
        onClose={vi.fn()}
        onSuccess={onSuccess}
        onBack={vi.fn()}
      />
    </Dialog>,
  );
  return { ...result, onSuccess };
}

beforeEach(() => {
  vi.clearAllMocks();
  installLessonResponses();
});

afterEach(() => cleanup());

describe("CreateClassworkQuizModal section and shuffle settings", () => {
  it("shows each shuffle setting only in the shared question-builder step", async () => {
    renderQuizWorkflow({ initialQuizMode: "manual" });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Quiz question builder")).toBeTruthy();
    expect(screen.getAllByText("Shuffle questions")).toHaveLength(1);
    expect(screen.getAllByText("Shuffle answer choices")).toHaveLength(1);
  });

  it("keeps the context section as a default while allowing other eligible sections and preserves imported shuffle settings", async () => {
    const importedPreview = {
      title: "Imported Variables Quiz",
      instructions: null,
      questions: [{
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
      }],
      notices: [],
      summary: {
        question_count: 1,
        keyed_question_count: 1,
        normalized_key_count: 0,
        preserved_explanation_count: 1,
        needs_attention_count: 0,
      },
      warnings: [],
    };
    vi.mocked(apiFetch).mockImplementation(async (url) => {
      const path = String(url);
      if (path === "/api/v1/quizzes/import-preview") return response(importedPreview);
      if (path === "/api/v1/lessons/501") return response(lesson);
      if (path === "/api/v1/lessons/my-lessons") return response([lesson]);
      if (path.startsWith("/api/v1/lessons/my-class/")) return response([lesson]);
      if (path === "/api/v1/classwork-assignments/with-assignments") {
        return response({ classwork_id: 700 });
      }
      throw new Error(`Unexpected request: ${path}`);
    });

    const { onSuccess } = renderQuizWorkflow({ initialTitle: "" });
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).toBeTruthy();
    fireEvent.change(fileInput!, {
      target: { files: [new File(["quiz"], "quiz.txt", { type: "text/plain" })] },
    });

    expect(await screen.findByDisplayValue("Imported Variables Quiz")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const shuffleQuestions = await screen.findByRole("switch", { name: "Shuffle questions" });
    const shuffleOptions = screen.getByRole("switch", { name: "Shuffle answer choices" });
    fireEvent.click(shuffleQuestions);
    fireEvent.click(shuffleOptions);
    expect(shuffleQuestions.getAttribute("data-state")).toBe("checked");
    expect(shuffleOptions.getAttribute("data-state")).toBe("checked");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    const alpha = await screen.findByRole("button", { pressed: true });
    const beta = screen.getByRole("button", { pressed: false });
    expect(alpha.getAttribute("aria-pressed")).toBe("true");
    expect(beta.getAttribute("aria-pressed")).toBe("false");
    expect(screen.queryByText("Gamma")).toBeNull();
    const selectAll = screen.getByText("Select All").closest("button");
    expect(selectAll).toBeTruthy();
    expect(selectAll!.hasAttribute("disabled")).toBe(false);
    expect(screen.queryByRole("switch", { name: "Shuffle questions" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Shuffle answer choices" })).toBeNull();

    fireEvent.click(alpha);
    expect(alpha.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Assign" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith({
      title: "Select at least one section to assign this quiz.",
    }));
    expect(vi.mocked(apiFetch).mock.calls.some(
      ([url]) => String(url) === "/api/v1/classwork-assignments/with-assignments",
    )).toBe(false);
    fireEvent.click(alpha);
    fireEvent.click(beta);
    expect(alpha.getAttribute("aria-pressed")).toBe("true");
    expect(beta.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect((await screen.findByRole("switch", { name: "Shuffle questions" })).getAttribute("data-state")).toBe("checked");
    expect(screen.getByRole("switch", { name: "Shuffle answer choices" }).getAttribute("data-state")).toBe("checked");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(await screen.findByRole("button", { name: "Assign" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    const createCall = vi.mocked(apiFetch).mock.calls.find(
      ([url]) => String(url) === "/api/v1/classwork-assignments/with-assignments",
    );
    expect(createCall).toBeTruthy();
    const formData = createCall![1]?.body as FormData;
    expect(JSON.parse(String(formData.get("class_ids")))).toEqual([101, 102]);
    expect(formData.get("academic_period_id")).toBe("901");
    const quizPayload = JSON.parse(String(formData.get("quiz_payload")));
    expect(quizPayload.settings.is_shuffle_questions).toBe(true);
    expect(quizPayload.settings.is_shuffle_options).toBe(true);
    expect(quizPayload.questions).toEqual([
      expect.objectContaining({
        question_text: "Which name is a valid variable?",
        lesson_id: 501,
        explanation: "Variable names cannot start with a number.",
        options: [
          { option_text: "score", is_correct: true, option_order: 1 },
          { option_text: "1score", is_correct: false, option_order: 2 },
        ],
      }),
    ]);
  });
});

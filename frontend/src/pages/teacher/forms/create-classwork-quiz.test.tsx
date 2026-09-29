// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import CreateClassworkQuizModal from "./create-classwork-quiz";

const api = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: api.fetch }));
vi.mock("./ai-quiz-generator-modal", () => ({ default: () => null }));
vi.mock("@/components/retroui/Dialog", () => ({
  Dialog: {
    Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Header: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Footer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  },
}));
vi.mock("@/components/retroui/Select", async () => {
  const React = await import("react");
  const Selection = React.createContext<{ value: string; onValueChange: (value: string) => void }>({ value: "", onValueChange: () => {} });
  const Root = ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode }) =>
    <Selection.Provider value={{ value, onValueChange }}>{children}</Selection.Provider>;
  return { Select: Object.assign(Root, {
    Trigger: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Value: ({ placeholder }: { placeholder?: string }) => <span>{React.useContext(Selection).value || placeholder}</span>,
    Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Group: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    Item: ({ value, children }: { value: string; children: React.ReactNode }) => {
      const selection = React.useContext(Selection);
      return <button type="button" onClick={() => selection.onValueChange(value)}>{children}</button>;
    },
  }) };
});

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("submits the selected lesson on an Examination quiz question", async () => {
  api.fetch.mockImplementation(async (path: string) => {
    if (path.includes("/lessons/my-class/")) return { ok: true, json: async () => [{ lesson_id: 42, title: "Variables", subject_id: 5, is_published: true, is_draft: false, show_scores: true }] };
    return { ok: true, json: async () => ({}) };
  });
  const onSuccess = vi.fn();
  render(<CreateClassworkQuizModal
    selectedType="QUIZ"
    subjects={[{ id: 5, name: "Mathematics" }]}
    loads={[{ subject_load_id: 9, subject_id: 5, subject_name: "Mathematics", class_id: 7, section_name: "Sapphire", academic_period_id: 3 }]}
    onClose={vi.fn()} onSuccess={onSuccess} onBack={vi.fn()}
  />);

  fireEvent.click(screen.getByRole("button", { name: /Create manually/i }));
  fireEvent.change(screen.getByPlaceholderText("Introduction to Programming Quiz"), { target: { value: "Summative ratios" } });
  fireEvent.click(screen.getByRole("button", { name: "Exams" }));
  fireEvent.click(screen.getByRole("button", { name: "Summative 1 (30%)" }));
  fireEvent.change(screen.getByText("Total points").parentElement!.querySelector("input")!, { target: { value: "1" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(screen.getByPlaceholderText("Which of the following is the primary function of a CPU?"), { target: { value: "What is a ratio?" } });
  fireEvent.change(screen.getByPlaceholderText("Choice 1"), { target: { value: "A comparison" } });
  fireEvent.change(screen.getByPlaceholderText("Choice 2"), { target: { value: "A calendar" } });
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.click(screen.getByRole("button", { name: "Sapphire" }));
  fireEvent.click(await screen.findByRole("button", { name: /Variables.*Published lesson/i }));
  fireEvent.change(screen.getByLabelText("Question 1: What is a ratio?"), { target: { value: "42" } });
  fireEvent.click(screen.getByRole("button", { name: "Assign" }));

  await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  const call = api.fetch.mock.calls.find(([path, options]) => path === "/api/v1/classwork-assignments/with-assignments" && options?.method === "POST");
  expect(call).toBeTruthy();
  const form = call![1].body as FormData;
  expect(form.get("classwork_category")).toBe("QUARTERLY_ASSESSMENT");
  expect(form.get("exam_subtype")).toBe("SUMMATIVE_1");
  expect(JSON.parse(String(form.get("quiz_payload"))).questions[0].lesson_id).toBe(42);
});

it("requires an explicit Examination subtype before leaving quiz details", async () => {
  api.fetch.mockResolvedValue({ ok: true, json: async () => ({}) });
  render(<CreateClassworkQuizModal
    selectedType="QUIZ"
    subjects={[{ id: 5, name: "Mathematics" }]}
    loads={[{ subject_load_id: 9, subject_id: 5, subject_name: "Mathematics", class_id: 7, section_name: "Sapphire", academic_period_id: 3 }]}
    onClose={vi.fn()} onSuccess={vi.fn()} onBack={vi.fn()}
  />);
  fireEvent.click(screen.getByRole("button", { name: /Create manually/i }));
  fireEvent.change(screen.getByPlaceholderText("Introduction to Programming Quiz"), { target: { value: "Summative ratios" } });
  fireEvent.click(screen.getByRole("button", { name: "Exams" }));
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Choose an Examination sub-type explicitly.")).toBeTruthy();
  expect(screen.getByText("Step 2 of 4")).toBeTruthy();
});

it("displays 'Needs answer key' badge and blocks assign step when a question is unkeyed", async () => {
  api.fetch.mockImplementation(async (path: string) => {
    if (path === "/api/v1/quizzes/import-preview") {
      return {
        ok: true,
        json: async () => ({
          title: "Unkeyed Quiz",
          questions: [
            {
              question_text: "What is 2 + 2?",
              question_type: "MULTIPLE_CHOICE",
              points: 1,
              options: [
                { option_text: "3", is_correct: false, option_order: 1 },
                { option_text: "4", is_correct: false, option_order: 2 },
              ],
            },
          ],
          warnings: ["Question 1 has no answer key. Please select the correct answer in the builder."],
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  });

  const { container } = render(
    <CreateClassworkQuizModal
      selectedType="QUIZ"
      subjects={[{ id: 5, name: "Mathematics" }]}
      loads={[{ subject_load_id: 9, subject_id: 5, subject_name: "Mathematics", class_id: 7, section_name: "Sapphire", academic_period_id: 3 }]}
      onClose={vi.fn()}
      onSuccess={vi.fn()}
      onBack={vi.fn()}
    />
  );

  const fileInput = container.querySelector('input[type="file"]')!;
  const file = new File(["dummy"], "quiz.txt", { type: "text/plain" });
  fireEvent.change(fileInput, { target: { files: [file] } });

  await waitFor(() => expect(screen.getByText("Step 2 of 4")).toBeTruthy());

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Step 3 of 4")).toBeTruthy();

  expect(screen.getByText("⚠️ Needs answer key")).toBeTruthy();
  expect(screen.getByText("Select the correct choice below")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Question 1 needs exactly one correct answer.")).toBeTruthy();
  expect(screen.getByText("Step 3 of 4")).toBeTruthy();

  const radios = screen.getAllByRole("radio");
  fireEvent.click(radios[1]);
  expect(screen.queryByText("⚠️ Needs answer key")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Step 4 of 4")).toBeTruthy();
});

it("does not block valid questions for True/False and Short Answer items", async () => {
  api.fetch.mockImplementation(async (path: string) => {
    if (path === "/api/v1/quizzes/import-preview") {
      return {
        ok: true,
        json: async () => ({
          title: "Valid Mixed Quiz",
          questions: [
            {
              question_text: "Helium is a noble gas.",
              question_type: "MULTIPLE_CHOICE",
              points: 1,
              options: [
                { option_text: "True", is_correct: true, option_order: 1 },
                { option_text: "False", is_correct: false, option_order: 2 },
              ],
            },
            {
              question_text: "What is the chemical symbol for gold?",
              question_type: "SHORT_ANSWER",
              points: 1,
              options: [
                { option_text: "Au", is_correct: true, option_order: 1 },
              ],
            },
          ],
          warnings: [],
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  });

  const { container } = render(
    <CreateClassworkQuizModal
      selectedType="QUIZ"
      subjects={[{ id: 5, name: "Mathematics" }]}
      loads={[{ subject_load_id: 9, subject_id: 5, subject_name: "Mathematics", class_id: 7, section_name: "Sapphire", academic_period_id: 3 }]}
      onClose={vi.fn()}
      onSuccess={vi.fn()}
      onBack={vi.fn()}
    />
  );

  const fileInput = container.querySelector('input[type="file"]')!;
  const file = new File(["dummy"], "quiz.txt", { type: "text/plain" });
  fireEvent.change(fileInput, { target: { files: [file] } });

  await waitFor(() => expect(screen.getByText("Step 2 of 4")).toBeTruthy());

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Step 3 of 4")).toBeTruthy();

  expect(screen.queryByText("⚠️ Needs answer key")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Step 4 of 4")).toBeTruthy();
});


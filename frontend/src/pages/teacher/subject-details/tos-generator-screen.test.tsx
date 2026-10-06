// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TOSGeneratorScreen } from "./tos-generator-screen";
import type { TOSExportQuestion } from "@/lib/tos-export";

const mocks = vi.hoisted(() => ({ api: vi.fn(), pdf: vi.fn(), docx: vi.fn() }));
vi.mock("@/lib/api", () => ({ apiFetch: mocks.api }));
vi.mock("@/lib/tos-export", () => ({
  exportTosExamPdf: mocks.pdf, exportTosExamDocx: mocks.docx,
  exportTosBlueprintPdf: vi.fn(), exportTosBlueprintDocx: vi.fn(),
}));
vi.mock("@/components/ui/sidebar", () => ({ SidebarTrigger: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Decorative SVGs multiply jsdom's accessibility-query work under parallel
// workers. Keep the real controls, dialogs, and their accessible names.
vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();
  const decorative = () => null;
  return { ...actual, TableProperties: decorative, Sparkles: decorative, FileDown: decorative,
    Plus: decorative, Trash2: decorative, RefreshCw: decorative, Edit3: decorative,
    CheckCircle2: decorative, AlertCircle: decorative, ArrowRight: decorative,
    ArrowLeft: decorative, Save: decorative, FileText: decorative, Check: decorative,
    Search: decorative, Clock: decorative };
});

const subjects = [{ subject_id: 1, subject_name: "Science" }];
const competencies = [{ competency_id: 1, statement: "Plants", competency_code: "SCI1", target_hours: 8 }];
const question = (number: number, type = "MULTIPLE_CHOICE"): TOSExportQuestion => ({
  question_text: `Plant question ${number}`, question_type: type, competency_label: "Plants",
  options: [{ option_text: "Roots", is_correct: true }, { option_text: "Leaves" }],
});
let generated: { questions: TOSExportQuestion[]; warnings: string[] };
let savedQuestions: TOSExportQuestion[];
function response(data: unknown) { return Promise.resolve({ ok: true, json: async () => data }); }
function saveCalls() { return mocks.api.mock.calls.filter(([, options]) => options?.method === "PUT"); }
async function openReview(questions = [question(1)]) {
  savedQuestions = questions;
  render(<TOSGeneratorScreen subjectId={1} subjectName="Science" subjectsList={subjects}
    competencies={competencies} initialExamId={7} onBack={vi.fn()} />);
  await screen.findByText("Plant question 1");
}
async function confirm() {
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Confirm short exam" }));
  await dialogClosed(dialog);
}
async function dialogClosed(dialog: HTMLElement) {
  // Poll the known element rather than repeatedly walking the entire wizard.
  await waitFor(() => expect(dialog.isConnected).toBe(false));
  expect(screen.queryByRole("dialog")).toBeNull();
}
async function goToExport() {
  fireEvent.click(screen.getByRole("button", { name: "Proceed to Export" }));
  if (screen.queryByRole("dialog")) await confirm();
  await screen.findByText(/Export Assessment Questionnaire/);
}

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", { writable: true, value: vi.fn(() => ({
    matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) });
});
beforeEach(() => {
  vi.clearAllMocks();
  generated = { questions: [question(1)], warnings: ["1 question(s) discarded: duplicate options"] };
  mocks.pdf.mockResolvedValue(undefined);
  mocks.docx.mockResolvedValue(undefined);
  mocks.api.mockImplementation((path: string, options?: { method?: string }) => {
    if (options?.method === "PUT") return response({ tos_exam_id: 7 });
    if (path.includes("generate-tos-questions")) return response(generated);
    if (path === "/api/v1/tos/7") return response({
      tos_exam_id: 7, subject_id: 1, title: "Plants exam", quarter: "Term 1",
      test_parts: [{ type: "MULTIPLE_CHOICE", count: 2 }],
      competencies: [{ competency_id: 1, label: "Plants", days: 2 }],
      difficulty_ratio: { easy: 0.6, average: 0.3, difficult: 0.1 }, questions: savedQuestions,
    });
    return response([]);
  });
});
afterEach(cleanup);

describe("TOS shortfall visibility and confirmation", () => {
  it("displays structured backend validation errors instead of [object Object]", async () => {
    await openReview();
    mocks.api.mockImplementationOnce(() => Promise.resolve({ ok: false, json: async () => ({ detail: [{
      loc: ["body", "rows", 0], msg: "Value error, Each row must request 1 to 20 questions of supported types", ctx: { error: {} },
    }] }) }));
    fireEvent.click(screen.getByRole("button", { name: /Regenerate All/ }));
    expect(await screen.findByText("body.rows.0: Value error, Each row must request 1 to 20 questions of supported types")).toBeTruthy();
    expect(screen.queryByText(/\[object Object\]/)).toBeNull();
  });
  it("keeps generator warnings visible on review and export with total and per-type counts", async () => {
    await openReview();
    fireEvent.click(screen.getByRole("button", { name: /Regenerate All/ }));
    const warning = await screen.findByText(generated.warnings[0]);
    expect(warning).toBeTruthy();
    const panel = screen.getByRole("status", { name: "Generator warnings" });
    expect(panel.textContent).toContain("Requested: 2 | Produced: 1 | Missing: 1");
    const row = within(panel).getByRole("row", { name: "MULTIPLE CHOICE 2 1 1" });
    expect(within(row).getAllByRole("cell").map((cell) => cell.textContent)).toEqual(["2", "1", "1"]);
    await goToExport();
    expect(screen.getByText(generated.warnings[0])).toBeTruthy();
    expect(screen.getByRole("status", { name: "Generator warnings" }).textContent).toContain("Missing: 1");
  });
  it("a complete exam proceeds, exports and finalizes without confirmation", async () => {
    await openReview([question(1), question(2)]);
    await goToExport();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Export Exam Paper PDF/ }));
    await waitFor(() => expect(mocks.pdf).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: /Save & Return/ }));
    await waitFor(() => expect(saveCalls()).toHaveLength(1));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it.each(["Proceed to Export", "Proceed to Final Export", "6Export"])("guards %s and cancellation does not navigate", async (label) => {
    await openReview();
    fireEvent.click(screen.getByRole("button", { name: label }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/blueprint requests 2 questions/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await dialogClosed(dialog);
    expect(screen.queryByText(/Export Assessment Questionnaire/)).toBeNull();
    expect(mocks.pdf).not.toHaveBeenCalled();
    expect(mocks.docx).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: label }));
    await confirm();
    expect(screen.getByText(/Export Assessment Questionnaire/)).toBeTruthy();
  });
  it.each([[/Export Exam Paper PDF/, "pdf"], [/Export Exam Paper Word/, "docx"]] as const)("defers %s until confirmed and cancel does nothing", async (label, exporter) => {
    await openReview();
    await goToExport();
    fireEvent.click(screen.getByRole("button", { name: label }));
    const dialog = await screen.findByRole("dialog");
    expect(mocks[exporter]).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await dialogClosed(dialog);
    expect(mocks[exporter]).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: label }));
    await confirm();
    await waitFor(() => expect(mocks[exporter]).toHaveBeenCalledTimes(1));
    expect(mocks[exporter].mock.calls[0][0]).toEqual([question(1)]);
  });
  it.each(["Save Draft", "Save & Return to TOS Archive"])("requires confirmation before %s finalizes a short exam", async (label) => {
    await openReview();
    if (label.includes("Return")) await goToExport();
    fireEvent.click(screen.getByRole("button", { name: label }));
    const dialog = await screen.findByRole("dialog");
    expect(saveCalls()).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await dialogClosed(dialog);
    expect(saveCalls()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: label }));
    await confirm();
    await waitFor(() => expect(saveCalls()).toHaveLength(1));
    expect(JSON.parse(saveCalls()[0][1].body).status).toBe("FINALIZED");
  });
  it("recomputes counts after deletion and complete regeneration", async () => {
    await openReview([question(1), question(2)]);
    expect(screen.queryByRole("status", { name: "Generator warnings" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete question 2" }));
    expect(screen.getByRole("status", { name: "Generator warnings" }).textContent).toContain("Requested: 2 | Produced: 1 | Missing: 1");
    generated = { questions: [question(1), question(2)], warnings: [] };
    fireEvent.click(screen.getByRole("button", { name: /Regenerate All/ }));
    await screen.findByText("Plant question 2");
    expect(screen.queryByRole("status", { name: "Generator warnings" })).toBeNull();
    await goToExport();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("TOS passage rendering and persistence", () => {
  const passage = { id: "plants-reading", title: "A Garden After Rain", text: "The rain watered the garden. The roots absorbed water." };

  it("renders a shared passage once above its questions and includes it in the save payload", async () => {
    await openReview([1, 2].map((number) => ({ ...question(number), passage, passage_id: passage.id })));
    expect(screen.getAllByRole("region", { name: "Reading passage" })).toHaveLength(1);
    expect(screen.getByText(passage.text)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save Draft" }));
    await waitFor(() => expect(saveCalls()).toHaveLength(1));
    const saved = JSON.parse(saveCalls()[0][1].body);
    expect(saved.questions.map((q: TOSExportQuestion) => q.passage)).toEqual([passage, passage]);
    expect(saved.questions.map((q: TOSExportQuestion) => q.passage_id)).toEqual([passage.id, passage.id]);
  });

  it("single regeneration reuses the passage and supplies existing stems to avoid repeats", async () => {
    await openReview([1, 2].map((number) => ({ ...question(number), passage, passage_id: passage.id })));
    generated = { questions: [{ ...question(3), passage, passage_id: passage.id }], warnings: [] };
    const card = screen.getByText("Plant question 1").closest('[data-slot="card"]') as HTMLElement;
    // The existing icon-only regeneration button has no accessible name.
    fireEvent.click(within(card).getByRole("button", { name: "" }));
    await screen.findByText("Plant question 3");
    const call = mocks.api.mock.calls.find(([path]) => path.includes("generate-tos-questions"));
    const payload = JSON.parse(call![1].body);
    expect(payload.rows[0].passage).toEqual(passage);
    expect(payload.existing_stems).toEqual(["Plant question 1", "Plant question 2"]);
    expect(screen.getAllByRole("region", { name: "Reading passage" })).toHaveLength(1);
  });
});

describe("TOS missing-only repair", () => {
  it("discloses the free short-exam fill limit and paid fallback", async () => {
    await openReview();
    expect(screen.getByText(/Filling a short exam is free/).textContent).toContain("default: 3 successful fills");
    expect(screen.getByText(/Filling a short exam is free/).textContent).toContain("one AI credit");
    expect(screen.getByText(/Filling a short exam is free/).textContent).toContain("Failed, cancelled, and zero-addition fills are free");
  });
  it("reuses saved Bloom overrides rather than recomputing a different blueprint", async () => {
    const original = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((path, options) => {
      if (path === "/api/v1/tos/7" && !options?.method) return response({
        tos_exam_id: 7, subject_id: 1, title: "Plants exam", quarter: "Term 1",
        test_parts: [{ type: "MULTIPLE_CHOICE", count: 2 }],
        competencies: [{ competency_id: 1, label: "Plants", days: 2 }],
        difficulty_ratio: { easy: 0.6, average: 0.3, difficult: 0.1, blueprint_rows: [{
          competency_id: 1, label: "Plants", type_counts: { MULTIPLE_CHOICE: 2 },
          bloom_targets: { REMEMBER: 0, UNDERSTAND: 2, APPLY: 0, ANALYZE: 0, EVALUATE: 0, CREATE: 0 },
        }] }, questions: [question(1)],
      });
      if (path.includes("generate-missing")) return response({ questions: [question(1), question(2)], warnings: [], added_count: 1 });
      return original(path, options);
    });
    await openReview();
    fireEvent.click(screen.getByRole("button", { name: "Generate missing items only" }));
    await screen.findByText("Plant question 2");
    const saved = JSON.parse(saveCalls()[0][1].body);
    expect(saved.difficulty_ratio.blueprint_rows[0].bloom_targets.UNDERSTAND).toBe(2);
    expect(saved.difficulty_ratio.blueprint_rows[0].bloom_targets.REMEMBER).toBe(0);
  });

  it("saves a draft, fills only missing items and keeps the existing question and passage", async () => {
    const passage = { id: "keep-reading", title: "Plants", text: "Rain fell. Roots absorbed water." };
    const existing = { ...question(1), passage, passage_id: passage.id };
    await openReview([existing]);
    const original = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((path, options) => path.includes("generate-missing")
      ? response({ questions: [existing, { ...question(2), passage, passage_id: passage.id }], warnings: [], added_count: 1, credits_charged: 1 })
      : original(path, options));
    fireEvent.click(screen.getByRole("button", { name: "Generate missing items only" }));
    await screen.findByText("Plant question 2");
    expect(screen.getByText("Plant question 1")).toBeTruthy();
    expect(screen.getAllByRole("region", { name: "Reading passage" })).toHaveLength(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("status", { name: "Generator warnings" })).toBeNull();
    const saved = JSON.parse(saveCalls()[0][1].body);
    expect(saved.status).toBe("DRAFT");
    expect(saved.questions[0].passage).toEqual(passage);
    expect(saved.difficulty_ratio.blueprint_rows[0].type_counts.MULTIPLE_CHOICE).toBe(2);
    const repair = mocks.api.mock.calls.find(([path]) => path.includes("generate-missing"));
    expect(repair?.[0]).toBe("/api/v1/ai/tos-exams/7/generate-missing");
    expect(JSON.parse(repair![1].body)).toEqual({ language: "English" });
    expect(mocks.api.mock.calls.some(([path]) => path.includes("generate-tos-questions"))).toBe(false);
  });

  it("keeps existing items when repair fails and displays the error", async () => {
    await openReview();
    const original = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((path, options) => path.includes("generate-missing")
      ? Promise.resolve({ ok: false, json: async () => ({ detail: "AI is busy, try again in 3 seconds." }) })
      : original(path, options));
    fireEvent.click(screen.getByRole("button", { name: "Generate missing items only" }));
    await screen.findByText("AI is busy, try again in 3 seconds.");
    expect(screen.getByText("Plant question 1")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Generator warnings" }).textContent).toContain("Missing: 1");
  });

  it("replaces old warnings with only the final repair shortfall", async () => {
    await openReview();
    fireEvent.click(screen.getByRole("button", { name: /Regenerate All/ }));
    await screen.findByText(generated.warnings[0]);
    const original = mocks.api.getMockImplementation()!;
    mocks.api.mockImplementation((path, options) => path.includes("generate-missing")
      ? response({ questions: [question(1)], warnings: ["Still missing MULTIPLE_CHOICE/EASY/REMEMBER=1"], added_count: 0 })
      : original(path, options));
    fireEvent.click(screen.getByRole("button", { name: "Generate missing items only" }));
    await screen.findByText("Still missing MULTIPLE_CHOICE/EASY/REMEMBER=1");
    expect(screen.queryByText(generated.warnings[0])).toBeNull();
  });
});

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
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
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

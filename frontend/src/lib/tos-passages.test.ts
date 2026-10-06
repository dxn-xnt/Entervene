// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { exportTosExamDocx, exportTosExamPdf, groupExamQuestions, type TOSExportQuestion } from "./tos-export";

// Use built-in fonts for inspectable PDF text. No downloads or network calls.
vi.mock("./pdf-font-loader", () => ({
  setupUnicodePdfFont: async (doc: { setFont: (name: string, weight: string) => void }) => ({
    customFontLoaded: false, setFont: (bold: boolean) => doc.setFont("helvetica", bold ? "bold" : "normal"),
  }),
}));

const passage = { id: "shared", title: "The Shared Reading", text: "Rain nourishes the garden. The roots absorb water." };
const questions: TOSExportQuestion[] = [
  { question_type: "ESSAY", question_text: "Explain the theme of the passage.", passage, passage_id: passage.id, explanation: "TEACHER_ONLY_RUBRIC" },
  { question_type: "MULTIPLE_CHOICE", question_text: "What helps the roots?", passage, passage_id: passage.id,
    options: [{ option_text: "Rain", is_correct: true, option_order: 1 }, { option_text: "Sand", option_order: 2 }] },
  { question_type: "IDENTIFICATION", question_text: "Name the organ that absorbs water.", options: [{ option_text: "Roots", is_correct: true }] },
];

describe("TOS shared passages", () => {
  it("groups shared-source questions across types and includes their passage once", () => {
    const groups = groupExamQuestions(questions);
    expect(groups.filter((group) => group.passage)).toHaveLength(1);
    expect(groups[0].passage).toEqual(passage);
    expect(groups.slice(0, 2).flatMap((group) => group.questions).map((q) => q.passage_id)).toEqual(["shared", "shared"]);
    expect(groups[2].questions[0].passage).toBeUndefined();
    expect(groups.flatMap((group) => group.questions)).toHaveLength(3);
  });

  it("retains the existing standalone export headings", () => {
    const groups = groupExamQuestions(questions.map((q) => ({ ...q, passage: null, passage_id: null })));
    expect(groups.map((group) => group.heading)).toEqual([
      "PART I. MULTIPLE CHOICE", "PART II. IDENTIFICATION", "PART III. ESSAY / OPEN-ENDED",
    ]);
  });

  it("writes the passage once into the real PDF, before its questions, without the rubric", async () => {
    const doc = await exportTosExamPdf(questions, { includeAnswerKey: false }, { save: false }) as { output: () => string };
    const pdf = doc.output();
    expect(pdf.match(/The Shared Reading/g)).toHaveLength(1);
    expect(pdf).toContain("Rain nourishes the garden.");
    expect(pdf.indexOf("The Shared Reading")).toBeLessThan(pdf.indexOf("What helps the roots"));
    expect(pdf).not.toContain("TEACHER_ONLY_RUBRIC");
  });

  it("writes the passage once into the real DOCX and keeps the answer key aligned", async () => {
    const { unzipSync, strFromU8 } = await import("fflate");
    const doc = await exportTosExamDocx(questions, { includeAnswerKey: true }, { save: false }) as { toBuffer: () => Promise<Uint8Array> };
    const archive = unzipSync(await doc.toBuffer());
    const xml = strFromU8(archive["word/document.xml"]);
    expect(xml.match(/The Shared Reading/g)).toHaveLength(1);
    expect(xml).toContain(passage.text);
    expect(xml.indexOf("The Shared Reading")).toBeLessThan(xml.indexOf("What helps the roots"));
    expect(xml).toContain("1. A");
    expect(xml).toContain("2. [Sample Answer / Rubric]: TEACHER_ONLY_RUBRIC");
    expect(xml).toContain("3. Roots");
  });
});

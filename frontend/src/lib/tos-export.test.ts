// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  exportTosExamPdf,
  exportTosBlueprintPdf,
  exportTosExamDocx,
  formatTosAnswerKeyLine,
} from "./tos-export";

describe("tos-export PDF generation and Unicode font support", () => {
  it("exports an exam PDF containing mathematical Unicode symbols (≤, ≥, ∞) without throwing", async () => {
    const questions = [
      {
        question_text: "Solve: 3x - 5 ≤ 7",
        question_type: "MULTIPLE_CHOICE",
        options: [
          { option_text: "x - 4 ≥ 0", is_correct: false, option_order: 1 },
          { option_text: "x ≤ 4", is_correct: true, option_order: 2 },
          { option_text: "(4, ∞)", is_correct: false, option_order: 3 },
          { option_text: "None of the above", is_correct: false, option_order: 4 },
        ],
      },
      {
        question_text: "The domain is [0, ∞).",
        question_type: "TRUE_FALSE",
        options: [
          { option_text: "True", is_correct: true, option_order: 1 },
          { option_text: "False", is_correct: false, option_order: 2 },
        ],
      },
    ];

    const doc = (await exportTosExamPdf(
      questions,
      {
        title: "Summative Test",
        subjectName: "Mathematics 10",
        quarter: "Term 1",
        includeAnswerKey: true,
      },
      { save: false }
    )) as { output: (type: string) => ArrayBuffer };

    expect(doc).toBeDefined();
    const pdfData = doc.output("arraybuffer");
    expect(pdfData.byteLength).toBeGreaterThan(1000);
  });

  it("exports a TOS blueprint PDF without throwing", async () => {
    const draft: Parameters<typeof exportTosBlueprintPdf>[0] = {
      title: "Blueprint Math 10",
      subject_name: "Mathematics 10",
      quarter: "Term 1",
      total_items: 2,
      test_parts: [{ type: "MULTIPLE_CHOICE", count: 2 }],
      rows: [
        {
          label: "Solves linear inequalities where x ≤ 7",
          code: "M10-01",
          days: 4,
          weight_percent: 100.0,
          items: 2,
          remember: 1,
          understand: 1,
          apply: 0,
          analyze: 0,
          evaluate: 0,
          create_: 0,
          easy: 2,
          average: 0,
          difficult: 0,
          item_start: 1,
          item_end: 2,
        },
      ],
      grand_total: {
        days: 4,
        items: 2,
        remember: 1,
        understand: 1,
        apply: 0,
        analyze: 0,
        evaluate: 0,
        create_: 0,
        easy: 2,
        average: 0,
        difficult: 0,
      },
    };

    const doc = (await exportTosBlueprintPdf(draft, { save: false })) as {
      output: (type: string) => ArrayBuffer;
    };
    expect(doc).toBeDefined();
    const pdfData = doc.output("arraybuffer");
    expect(pdfData.byteLength).toBeGreaterThan(1000);
  });

  it("exports an exam DOCX containing mathematical Unicode symbols (≤, ≥, ∞, √, °) without throwing", async () => {
    // Mock URL.createObjectURL and URL.revokeObjectURL for DOM download in test environment
    const origCreateObjectURL = globalThis.URL.createObjectURL;
    const origRevokeObjectURL = globalThis.URL.revokeObjectURL;
    globalThis.URL.createObjectURL = () => "blob:mock-docx-url";
    globalThis.URL.revokeObjectURL = () => {};

    try {
      const questions = [
        {
          question_text: "Find the limit: lim_{x→∞} (√x² + 1 - x) where θ = 45° and x ≥ 0",
          question_type: "MULTIPLE_CHOICE",
          options: [
            { option_text: "0 ≤ y ≤ 1", is_correct: true, option_order: 1 },
            { option_text: "y ≠ 0", is_correct: false, option_order: 2 },
            { option_text: "∞", is_correct: false, option_order: 3 },
            { option_text: "None of the above", is_correct: false, option_order: 4 },
          ],
        },
      ];

      await expect(
        exportTosExamDocx(questions, {
          title: "Advanced Math Exam",
          subjectName: "Pre-Calculus",
          quarter: "Quarter 1",
          includeAnswerKey: true,
        })
      ).resolves.not.toThrow();
    } finally {
      globalThis.URL.createObjectURL = origCreateObjectURL;
      globalThis.URL.revokeObjectURL = origRevokeObjectURL;
    }
  });

  it("restores line width, draw color, and fill color after bold doc.text call", async () => {
    const { jsPDF } = await import("jspdf");
    const { setupUnicodePdfFont } = await import("./pdf-font-loader");
    const doc = new jsPDF();
    const { setFont } = await setupUnicodePdfFont(doc);

    // Set distinctive initial state values
    doc.setLineWidth(0.42);
    doc.setDrawColor(120, 60, 30);
    doc.setTextColor(20, 40, 80);
    doc.setFillColor(10, 200, 50);

    const lwBefore = doc.getLineWidth();
    const drawBefore = doc.getDrawColor();
    const fillBefore = doc.getFillColor();
    const textBefore = doc.getTextColor();

    setFont(true);
    doc.text("Bold Heading Sample", 20, 20);

    const lwAfter = doc.getLineWidth();
    const drawAfter = doc.getDrawColor();
    const fillAfter = doc.getFillColor();
    const textAfter = doc.getTextColor();

    expect(lwAfter).toBe(lwBefore);
    expect(drawAfter).toBe(drawBefore);
    expect(fillAfter).toBe(fillBefore);
    expect(textAfter).toBe(textBefore);
  });
});

describe("TOS Exam Export - formatTosAnswerKeyLine", () => {
  it("formats MULTIPLE_CHOICE with correct option letter", () => {
    const q = {
      quiz_question_id: 1,
      question_text: "What is the capital of France?",
      question_type: "MULTIPLE_CHOICE",
      options: [
        { option_text: "London", is_correct: false, option_order: 1 },
        { option_text: "Paris", is_correct: true, option_order: 2 },
        { option_text: "Berlin", is_correct: false, option_order: 3 },
      ],
    };
    expect(formatTosAnswerKeyLine("MULTIPLE_CHOICE", q, 1)).toBe("1. B");
  });

  it("formats TRUE_FALSE with TRUE or FALSE in uppercase", () => {
    const qTrue = {
      quiz_question_id: 2,
      question_text: "Water is H2O.",
      question_type: "TRUE_FALSE",
      options: [
        { option_text: "True", is_correct: true, option_order: 1 },
        { option_text: "False", is_correct: false, option_order: 2 },
      ],
    };
    expect(formatTosAnswerKeyLine("TRUE_FALSE", qTrue, 2)).toBe("2. TRUE");

    const qFalse = {
      quiz_question_id: 3,
      question_text: "The sun revolves around the Earth.",
      question_type: "TRUE_FALSE",
      options: [
        { option_text: "True", is_correct: false, option_order: 1 },
        { option_text: "False", is_correct: true, option_order: 2 },
      ],
    };
    expect(formatTosAnswerKeyLine("TRUE_FALSE", qFalse, 3)).toBe("3. FALSE");
  });

  it("formats IDENTIFICATION using option text, NEVER explanation", () => {
    const q = {
      quiz_question_id: 4,
      question_text: "What is the largest organ of the human body?",
      question_type: "IDENTIFICATION",
      explanation: "Teacher explanation or note that must NOT be used as answer key",
      options: [
        { option_text: "Skin", is_correct: true, option_order: 1 },
        { option_text: "Integumentary system", is_correct: true, option_order: 2 },
      ],
    };
    const line = formatTosAnswerKeyLine("IDENTIFICATION", q, 4);
    expect(line).toBe("4. Skin / Integumentary system");
    expect(line).not.toContain("Teacher explanation");
    expect(line).not.toContain("[Key/Rubric]");
  });

  it("formats ESSAY / SHORT_ANSWER with [Sample Answer / Rubric]: and never [Key/Rubric]:", () => {
    const q = {
      quiz_question_id: 5,
      question_text: "Explain the importance of biodiversity in ecosystems.",
      question_type: "ESSAY",
      explanation: "Student must explain trophic cascades and ecological resilience.",
      options: [],
    };
    const line = formatTosAnswerKeyLine("ESSAY", q, 5);
    expect(line).toBe("5. [Sample Answer / Rubric]: Student must explain trophic cascades and ecological resilience.");
    expect(line).not.toContain("[Key/Rubric]");
  });

  it("handles empty / missing rubric gracefully for ESSAY", () => {
    const q = {
      quiz_question_id: 6,
      question_text: "Open essay question without rubric.",
      question_type: "ESSAY",
      explanation: "",
      options: [],
    };
    const line = formatTosAnswerKeyLine("ESSAY", q, 6);
    expect(line).toBe("6. [Sample Answer / Rubric]: (See rubric)");
  });
});

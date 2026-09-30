// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { exportTosExamPdf, exportTosBlueprintPdf, exportTosExamDocx } from "./tos-export";

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

    const doc = await exportTosExamPdf(
      questions,
      {
        title: "Summative Test",
        subjectName: "Mathematics 10",
        quarter: "Term 1",
        includeAnswerKey: true,
      },
      { save: false }
    );

    expect(doc).toBeDefined();
    const pdfData = doc.output("arraybuffer");
    expect(pdfData.byteLength).toBeGreaterThan(1000);
  });

  it("exports a TOS blueprint PDF without throwing", async () => {
    const draft: any = {
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

    const doc = await exportTosBlueprintPdf(draft, { save: false });
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



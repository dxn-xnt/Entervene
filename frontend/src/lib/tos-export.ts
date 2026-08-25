/**
 * tos-export.ts
 * Dedicated PDF and Word (.docx) export for:
 * 1. TOS Blueprint Table (15-column landscape grid)
 * 2. TOS Exam Questionnaire supporting all 5 question types:
 *    - Multiple Choice
 *    - True or False
 *    - Identification / Short Answer
 *    - Matching Type (2-column premises vs matches)
 *    - Essay (Rubrics & writing lines)
 */

import type { TOSDraft } from "./tos-calculator";

export type TOSExamMeta = {
  title?: string;
  subjectName?: string;
  quarter?: string;
  teacherName?: string;
  schoolName?: string;
  includeAnswerKey?: boolean;
};

export type TOSExportQuestion = {
  question_text: string;
  question_type: string;
  difficulty_band?: string;
  cognitive_level?: string;
  points?: number;
  display_order?: number;
  explanation?: string | null;
  competency_label?: string;
  options?: Array<{
    option_text: string;
    is_correct?: boolean;
    option_order?: number;
  }>;
};

function sanitize(text: string): string {
  return (text || "").replace(/[^\x00-\x7F]/g, (ch) => ch);
}

function optionLetter(order: number): string {
  return String.fromCharCode(64 + Math.min(order, 26)); // A, B, C, D...
}

// ─── 1. TOS Blueprint Exports (Landscape Legal) ─────────────────────────────

export async function exportTosBlueprintPdf(draft: TOSDraft): Promise<void> {
  const { jsPDF } = await import("jspdf");

  // Landscape Legal: 330.2 × 215.9 mm
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "legal" });
  const PAGE_W = 330.2;
  const PAGE_H = 215.9;
  const ML = 15;
  const MR = 15;
  const MT = 15;
  const MB = 15;
  const TW = PAGE_W - ML - MR;

  let y = MT;

  const checkPage = (needed: number) => {
    if (y + needed > PAGE_H - MB) {
      doc.addPage();
      y = MT;
    }
  };

  // Header Title
  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text("TABLE OF SPECIFICATIONS (TOS)", ML, y);
  y += 6;

  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  doc.text(`${draft.subject_name || "Subject"} — ${draft.title || "Summative Assessment"} (${draft.quarter || "Q1"})`, ML, y);
  y += 5;

  // Test Parts Breakdown Header
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "normal");
  const testPartsStr = draft.test_parts
    .filter((p) => p.count > 0)
    .map((p) => `${p.type.replace(/_/g, " ")}: ${p.count}`)
    .join("  |  ");
  doc.text(`Test Composition: ${testPartsStr}  |  Total Items: ${draft.total_items}`, ML, y);
  y += 7;

  // Columns specification: total width = TW (300.2 mm)
  const cols = [
    { label: "Learning Competency / Topic", w: 75, align: "left" as const },
    { label: "Code", w: 20, align: "left" as const },
    { label: "Days", w: 12, align: "center" as const },
    { label: "% Wt", w: 14, align: "center" as const },
    { label: "Items", w: 12, align: "center" as const },
    { label: "Rem", w: 12, align: "center" as const },
    { label: "Und", w: 12, align: "center" as const },
    { label: "App", w: 12, align: "center" as const },
    { label: "Ana", w: 12, align: "center" as const },
    { label: "Eva", w: 12, align: "center" as const },
    { label: "Cre", w: 12, align: "center" as const },
    { label: "Easy", w: 14, align: "center" as const },
    { label: "Avg", w: 14, align: "center" as const },
    { label: "Diff", w: 14, align: "center" as const },
    { label: "Placement", w: 25, align: "center" as const },
  ];

  // Draw Table Header
  const rowHeight = 7;
  checkPage(rowHeight * 2);

  doc.setFillColor(240, 240, 240);
  doc.rect(ML, y, TW, rowHeight, "F");
  doc.rect(ML, y, TW, rowHeight, "S");

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");

  let x = ML;
  for (const c of cols) {
    doc.rect(x, y, c.w, rowHeight, "S");
    const textX = c.align === "center" ? x + c.w / 2 : x + 2;
    doc.text(c.label, textX, y + 4.8, { align: c.align });
    x += c.w;
  }
  y += rowHeight;

  // Table Body Rows
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);

  for (const r of draft.rows) {
    checkPage(rowHeight);
    x = ML;
    const placementStr = r.items > 0 ? `${r.item_start}–${r.item_end}` : "-";

    const vals = [
      sanitize(r.label).slice(0, 48),
      sanitize(r.code || "-").slice(0, 10),
      String(r.days),
      `${r.weight_percent.toFixed(1)}%`,
      String(r.items),
      String(r.remember),
      String(r.understand),
      String(r.apply),
      String(r.analyze),
      String(r.evaluate),
      String(r.create_),
      String(r.easy),
      String(r.average),
      String(r.difficult),
      placementStr,
    ];

    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      doc.rect(x, y, c.w, rowHeight, "S");
      const textX = c.align === "center" ? x + c.w / 2 : x + 2;
      doc.text(vals[i], textX, y + 4.8, { align: c.align });
      x += c.w;
    }
    y += rowHeight;
  }

  // Grand Total Row
  checkPage(rowHeight + 4);
  doc.setFillColor(230, 230, 230);
  doc.rect(ML, y, TW, rowHeight, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  x = ML;

  const gt = draft.grand_total;
  const gtVals = [
    "TOTAL",
    "-",
    String(gt.days),
    "100.0%",
    String(gt.items),
    String(gt.remember),
    String(gt.understand),
    String(gt.apply),
    String(gt.analyze),
    String(gt.evaluate),
    String(gt.create_),
    String(gt.easy),
    String(gt.average),
    String(gt.difficult),
    gt.items > 0 ? `1–${gt.items}` : "-",
  ];

  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    doc.rect(x, y, c.w, rowHeight, "S");
    const textX = c.align === "center" ? x + c.w / 2 : x + 2;
    doc.text(gtVals[i], textX, y + 4.8, { align: c.align });
    x += c.w;
  }
  y += rowHeight + 8;

  // Difficulty Summary Box
  checkPage(18);
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.text(
    `Difficulty Distribution: Easy = ${gt.easy} (${((gt.easy / (gt.items || 1)) * 100).toFixed(1)}%)  |  Average = ${gt.average} (${((gt.average / (gt.items || 1)) * 100).toFixed(1)}%)  |  Difficult = ${gt.difficult} (${((gt.difficult / (gt.items || 1)) * 100).toFixed(1)}%)`,
    ML,
    y
  );

  const filename = `${(draft.title || "TOS_Blueprint").replace(/[/\\:*?"<>|]/g, "_")}_Blueprint.pdf`;
  doc.save(filename);
}

export async function exportTosBlueprintDocx(draft: TOSDraft): Promise<void> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    Table,
    TableRow,
    TableCell,
    WidthType,
    convertInchesToTwip,
    PageOrientation,
    AlignmentType,
  } = await import("docx");

  const p = (text: string, bold = false, size = 20) =>
    new Paragraph({
      spacing: { after: 80 },
      children: [new TextRun({ text: sanitize(text), bold, size, font: "Calibri" })],
    });

  const headers = [
    "Learning Competency",
    "Code",
    "Days",
    "% Wt",
    "Items",
    "Rem",
    "Und",
    "App",
    "Ana",
    "Eva",
    "Cre",
    "Easy",
    "Avg",
    "Diff",
    "Placement",
  ];

  const headerRow = new TableRow({
    children: headers.map(
      (h) =>
        new TableCell({
          children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: h, bold: true, size: 17 })] })],
          shading: { fill: "E0E0E0" },
        })
    ),
  });

  const tableRows: InstanceType<typeof TableRow>[] = [headerRow];

  for (const r of draft.rows) {
    const placementStr = r.items > 0 ? `${r.item_start}–${r.item_end}` : "-";
    const cells = [
      r.label,
      r.code || "-",
      String(r.days),
      `${r.weight_percent.toFixed(1)}%`,
      String(r.items),
      String(r.remember),
      String(r.understand),
      String(r.apply),
      String(r.analyze),
      String(r.evaluate),
      String(r.create_),
      String(r.easy),
      String(r.average),
      String(r.difficult),
      placementStr,
    ];

    tableRows.push(
      new TableRow({
        children: cells.map(
          (text, idx) =>
            new TableCell({
              children: [
                new Paragraph({
                  alignment: idx === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
                  children: [new TextRun({ text: sanitize(text), size: 16 })],
                }),
              ],
            })
        ),
      })
    );
  }

  // Total Row
  const gt = draft.grand_total;
  const gtCells = [
    "TOTAL",
    "-",
    String(gt.days),
    "100.0%",
    String(gt.items),
    String(gt.remember),
    String(gt.understand),
    String(gt.apply),
    String(gt.analyze),
    String(gt.evaluate),
    String(gt.create_),
    String(gt.easy),
    String(gt.average),
    String(gt.difficult),
    gt.items > 0 ? `1–${gt.items}` : "-",
  ];

  tableRows.push(
    new TableRow({
      children: gtCells.map(
        (text, idx) =>
          new TableCell({
            children: [
              new Paragraph({
                alignment: idx === 0 ? AlignmentType.LEFT : AlignmentType.CENTER,
                children: [new TextRun({ text: sanitize(text), bold: true, size: 17 })],
              }),
            ],
            shading: { fill: "F0F0F0" },
          })
      ),
    })
  );

  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: tableRows,
  });

  const testPartsStr = draft.test_parts
    .filter((p) => p.count > 0)
    .map((p) => `${p.type.replace(/_/g, " ")}: ${p.count}`)
    .join("  |  ");

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertInchesToTwip(13),
              height: convertInchesToTwip(8.5),
              orientation: PageOrientation.LANDSCAPE,
            },
            margin: {
              top: convertInchesToTwip(0.6),
              bottom: convertInchesToTwip(0.6),
              left: convertInchesToTwip(0.6),
              right: convertInchesToTwip(0.6),
            },
          },
        },
        children: [
          p("TABLE OF SPECIFICATIONS (TOS)", true, 28),
          p(`${draft.subject_name || "Subject"} — ${draft.title || "Summative Assessment"} (${draft.quarter || "Q1"})`, true, 22),
          p(`Test Composition: ${testPartsStr}  |  Total Items: ${draft.total_items}`, false, 18),
          table,
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(draft.title || "TOS_Blueprint").replace(/[/\\:*?"<>|]/g, "_")}_Blueprint.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── 2. Dedicated TOS Exam Paper Export (All 5 Question Types) ───────────────

type TOSQuestionGroup = {
  heading: string;
  directions: string;
  type: string;
  questions: TOSExportQuestion[];
};

function groupExamQuestions(questions: TOSExportQuestion[]): TOSQuestionGroup[] {
  const mc: TOSExportQuestion[] = [];
  const tf: TOSExportQuestion[] = [];
  const idn: TOSExportQuestion[] = [];
  const mat: TOSExportQuestion[] = [];
  const ess: TOSExportQuestion[] = [];

  for (const q of questions) {
    const t = (q.question_type || "MULTIPLE_CHOICE").toUpperCase();
    if (t === "TRUE_FALSE") {
      tf.push(q);
    } else if (t === "IDENTIFICATION" || t === "SHORT_ANSWER") {
      idn.push(q);
    } else if (t === "MATCHING") {
      mat.push(q);
    } else if (t === "ESSAY") {
      ess.push(q);
    } else {
      // Check if it's true-false masked as MC
      const opts = q.options || [];
      const isTF =
        opts.length === 2 &&
        opts.some((o) => o.option_text.trim().toLowerCase() === "true") &&
        opts.some((o) => o.option_text.trim().toLowerCase() === "false");
      isTF ? tf.push(q) : mc.push(q);
    }
  }

  const groups: TOSQuestionGroup[] = [];
  const roman = ["I", "II", "III", "IV", "V", "VI", "VII"];

  if (mc.length > 0) {
    groups.push({
      heading: `PART ${roman[groups.length]}. MULTIPLE CHOICE`,
      directions: "Directions: Read each question carefully. Write the letter of the correct answer on the line provided.",
      type: "MULTIPLE_CHOICE",
      questions: mc,
    });
  }
  if (tf.length > 0) {
    groups.push({
      heading: `PART ${roman[groups.length]}. TRUE OR FALSE`,
      directions: "Directions: Write TRUE if the statement is correct and FALSE if the statement is incorrect.",
      type: "TRUE_FALSE",
      questions: tf,
    });
  }
  if (mat.length > 0) {
    groups.push({
      heading: `PART ${roman[groups.length]}. MATCHING TYPE`,
      directions: "Directions: Match Column A with the correct match in Column B. Write the letter of your answer on the space provided.",
      type: "MATCHING",
      questions: mat,
    });
  }
  if (idn.length > 0) {
    groups.push({
      heading: `PART ${roman[groups.length]}. IDENTIFICATION`,
      directions: "Directions: Provide the exact term or concise answer in the space provided.",
      type: "IDENTIFICATION",
      questions: idn,
    });
  }
  if (ess.length > 0) {
    groups.push({
      heading: `PART ${roman[groups.length]}. ESSAY / OPEN-ENDED`,
      directions: "Directions: Answer the following questions in complete sentences. Refer to the scoring criteria.",
      type: "ESSAY",
      questions: ess,
    });
  }

  return groups;
}

export async function exportTosExamPdf(
  questions: TOSExportQuestion[],
  meta: TOSExamMeta
): Promise<void> {
  const { jsPDF } = await import("jspdf");

  // Legal Portrait: 215.9 × 330.2 mm
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "legal" });
  const PAGE_W = 215.9;
  const PAGE_H = 330.2;
  const ML = 20;
  const MR = 20;
  const MT = 20;
  const MB = 18;
  const TW = PAGE_W - ML - MR;

  let y = MT;

  const checkPage = (needed: number) => {
    if (y + needed > PAGE_H - MB) {
      doc.addPage();
      y = MT;
    }
  };

  const write = (text: string, size: number, bold = false, indent = 0, gapAfter = 2.5) => {
    doc.setFontSize(size);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    const lines = doc.splitTextToSize(text, TW - indent);
    const lh = size * 0.42;
    checkPage(lines.length * lh + gapAfter);
    doc.text(lines, ML + indent, y);
    y += lines.length * lh + gapAfter;
  };

  const rule = (gap = 3) => {
    checkPage(6);
    doc.setDrawColor(160, 160, 160);
    doc.setLineWidth(0.4);
    doc.line(ML, y, PAGE_W - MR, y);
    y += gap;
  };

  const title = meta.title || "Summative Examination";
  const subjectName = meta.subjectName || "Subject";
  const groups = groupExamQuestions(questions);

  // Header
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(subjectName.toUpperCase(), ML, y);
  y += 4.5;

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(title, ML, y);
  y += 6;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text("Name: _________________________________________   Grade & Section: __________________   Score: _________", ML, y);
  y += 5;
  rule(5);

  let qNum = 1;

  for (const group of groups) {
    checkPage(25);
    write(group.heading, 12, true, 0, 2);
    write(group.directions, 9.5, false, 0, 4);

    if (group.type === "MATCHING") {
      // Render 2-column premises vs matches
      const allChoices = Array.from(
        new Set(
          group.questions.flatMap((q) => (q.options || []).map((o) => o.option_text))
        )
      );

      const colAW = TW * 0.55;
      const colBW = TW * 0.45;

      for (let idx = 0; idx < group.questions.length; idx++) {
        const q = group.questions[idx];
        const choiceText = allChoices[idx] ? `${optionLetter(idx + 1)}. ${allChoices[idx]}` : "";

        checkPage(8);
        doc.setFontSize(10.5);
        doc.setFont("helvetica", "normal");
        const premiseText = `_____ ${qNum}. ${sanitize(q.question_text)}`;
        const premiseLines = doc.splitTextToSize(premiseText, colAW - 5);

        doc.text(premiseLines, ML, y);
        if (choiceText) {
          const choiceLines = doc.splitTextToSize(sanitize(choiceText), colBW - 5);
          doc.text(choiceLines, ML + colAW, y);
        }
        y += Math.max(premiseLines.length, 1) * 4.5 + 2;
        qNum++;
      }
      y += 3;
    } else {
      for (const q of group.questions) {
        const isMC = group.type === "MULTIPLE_CHOICE" || group.type === "TRUE_FALSE";
        const prefixSpace = isMC ? "____ " : "";
        const qText = `${prefixSpace}${qNum}. ${sanitize(q.question_text)}`;
        write(qText, 10.5, false, 0, 2.5);

        const opts = q.options || [];
        if (isMC && opts.length > 0) {
          const sorted = [...opts].sort((a, b) => (a.option_order || 0) - (b.option_order || 0));
          if (sorted.length === 2) {
            const line = sorted
              .map((opt) => `${optionLetter(opt.option_order || 1)}) ${sanitize(opt.option_text)}`)
              .join("           ");
            write(line, 10, false, 12, 3);
          } else {
            for (const opt of sorted) {
              write(`${optionLetter(opt.option_order || 1)}) ${sanitize(opt.option_text)}`, 10, false, 10, 1.8);
            }
            y += 1.5;
          }
        } else if (group.type === "ESSAY") {
          write("__________________________________________________________________________________________", 9, false, 6, 2.5);
          write("__________________________________________________________________________________________", 9, false, 6, 2.5);
          write("__________________________________________________________________________________________", 9, false, 6, 4);
          if (q.explanation) {
            write(`[Scoring Criteria: ${sanitize(q.explanation)}]`, 8.5, false, 6, 3);
          }
        } else {
          // Identification
          write("Answer: __________________________________________________________________", 9.5, false, 6, 4);
        }
        qNum++;
      }
      y += 3;
    }
  }

  // Answer Key
  if (meta.includeAnswerKey && questions.length > 0) {
    checkPage(40);
    rule(5);
    write("ANSWER KEY", 12, true, 0, 2);
    write(`${title} (${questions.length} Items)`, 9, false, 0, 4);

    let currNum = 1;
    for (const group of groups) {
      for (const q of group.questions) {
        if (group.type === "MULTIPLE_CHOICE" || group.type === "TRUE_FALSE") {
          const opts = q.options || [];
          const correctIdx = opts.findIndex((o) => o.is_correct);
          const correctOpt = opts[correctIdx];
          const ans = correctOpt
            ? group.type === "TRUE_FALSE"
              ? correctOpt.option_text.toUpperCase()
              : optionLetter(correctOpt.option_order || correctIdx + 1)
            : "-";
          write(`${currNum}. ${ans}`, 9.5, false, 4, 1.8);
        } else {
          const ans = q.explanation || (q.options && q.options[0]?.option_text) || "(See Rubric)";
          write(`${currNum}. [Key/Rubric]: ${sanitize(ans)}`, 9, false, 4, 1.8);
        }
        currNum++;
      }
    }
  }

  const filename = `${(title || "Exam").replace(/[/\\:*?"<>|]/g, "_")}_Exam.pdf`;
  doc.save(filename);
}

export async function exportTosExamDocx(
  questions: TOSExportQuestion[],
  meta: TOSExamMeta
): Promise<void> {
  const {
    Document,
    Packer,
    Paragraph,
    TextRun,
    convertInchesToTwip,
    BorderStyle,
    PageOrientation,
  } = await import("docx");

  const title = meta.title || "Summative Examination";
  const subjectName = meta.subjectName || "Subject";
  const groups = groupExamQuestions(questions);

  const children: InstanceType<typeof Paragraph>[] = [];

  const p = (text: string, opts: { bold?: boolean; size?: number; indent?: number; space?: number } = {}) =>
    new Paragraph({
      spacing: { after: opts.space ?? 100 },
      indent: opts.indent ? { left: convertInchesToTwip(opts.indent) } : undefined,
      children: [
        new TextRun({
          text: sanitize(text),
          bold: opts.bold ?? false,
          size: opts.size ?? 22,
          font: "Calibri",
        }),
      ],
    });

  const divider = () =>
    new Paragraph({
      spacing: { after: 100 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "888888" } },
      children: [],
    });

  // Header
  children.push(p(subjectName.toUpperCase(), { bold: true, size: 20, space: 40 }));
  children.push(p(title, { bold: true, size: 28, space: 80 }));
  children.push(p("Name: _________________________________________   Grade & Section: __________________   Score: _________", { size: 20, space: 100 }));
  children.push(divider());

  let qNum = 1;

  for (const group of groups) {
    children.push(p(group.heading, { bold: true, size: 24, space: 40 }));
    children.push(p(group.directions, { size: 19, space: 120 }));

    for (const q of group.questions) {
      const isMC = group.type === "MULTIPLE_CHOICE" || group.type === "TRUE_FALSE";
      const prefixSpace = isMC ? "____ " : "";
      children.push(p(`${prefixSpace}${qNum}. ${sanitize(q.question_text)}`, { size: 21, space: 50 }));

      if (isMC && (q.options || []).length > 0) {
        const sorted = [...(q.options || [])].sort((a, b) => (a.option_order || 0) - (b.option_order || 0));
        for (const opt of sorted) {
          children.push(p(`${optionLetter(opt.option_order || 1)}) ${sanitize(opt.option_text)}`, { size: 20, indent: 0.35, space: 35 }));
        }
      } else if (group.type === "ESSAY") {
        children.push(p("Answer: __________________________________________________________________", { size: 19, space: 60 }));
        children.push(p("__________________________________________________________________________", { size: 19, space: 60 }));
        if (q.explanation) {
          children.push(p(`[Rubric: ${sanitize(q.explanation)}]`, { size: 18, indent: 0.2, space: 60 }));
        }
      } else {
        children.push(p("Answer: __________________________________________________________________", { size: 19, space: 100 }));
      }
      qNum++;
    }
    children.push(p("", { space: 100 }));
  }

  // Answer Key
  if (meta.includeAnswerKey && questions.length > 0) {
    children.push(divider());
    children.push(p("ANSWER KEY", { bold: true, size: 24, space: 60 }));
    let currNum = 1;
    for (const group of groups) {
      for (const q of group.questions) {
        if (group.type === "MULTIPLE_CHOICE" || group.type === "TRUE_FALSE") {
          const opts = q.options || [];
          const correctIdx = opts.findIndex((o) => o.is_correct);
          const correctOpt = opts[correctIdx];
          const ans = correctOpt
            ? group.type === "TRUE_FALSE"
              ? correctOpt.option_text.toUpperCase()
              : optionLetter(correctOpt.option_order || correctIdx + 1)
            : "-";
          children.push(p(`${currNum}. ${ans}`, { size: 20, space: 40 }));
        } else {
          const ans = q.explanation || (q.options && q.options[0]?.option_text) || "(See Rubric)";
          children.push(p(`${currNum}. [Key/Rubric]: ${sanitize(ans)}`, { size: 19, space: 40 }));
        }
        currNum++;
      }
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertInchesToTwip(8.5),
              height: convertInchesToTwip(13),
              orientation: PageOrientation.PORTRAIT,
            },
            margin: {
              top: convertInchesToTwip(0.8),
              bottom: convertInchesToTwip(0.8),
              left: convertInchesToTwip(0.8),
              right: convertInchesToTwip(0.8),
            },
          },
        },
        children,
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(title || "Exam").replace(/[/\\:*?"<>|]/g, "_")}_Exam.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * quiz-export.ts
 * Client-side PDF and Word (.docx) export for AI-generated quiz questionnaires.
 * Paper size: Legal (8.5 × 13 in). DepEd / PH school exam formatting.
 * Supports compact grid answer key at the bottom.
 */

import type { QuizQuestionDraft } from "@/pages/teacher/classworks/quiz-builder-types";

// ─── Helpers ────────────────────────────────────────────────────────────────

function sanitize(text: string): string {
  return (text || "").replace(/[^\x00-\x7F]/g, (ch) => ch);
}

function optionLetter(order: number): string {
  return String.fromCharCode(64 + Math.min(order, 26)); // A, B, C, D
}

type QuestionGroup = {
  heading: string;
  directions: string;
  questions: QuizQuestionDraft[];
};

function groupQuestions(questions: QuizQuestionDraft[]): QuestionGroup[] {
  const mc: QuizQuestionDraft[] = [];
  const tf: QuizQuestionDraft[] = [];
  const sa: QuizQuestionDraft[] = [];

  for (const q of questions) {
    if (q.question_type === "MULTIPLE_CHOICE") {
      const opts = q.options ?? [];
      const isTF =
        opts.length === 2 &&
        opts.some((o) => o.option_text.trim().toLowerCase() === "true") &&
        opts.some((o) => o.option_text.trim().toLowerCase() === "false");
      isTF ? tf.push(q) : mc.push(q);
    } else {
      sa.push(q);
    }
  }

  const groups: QuestionGroup[] = [];
  let cursor = 1;
  const prefix = (n: number) =>
    ["I", "II", "III", "IV", "V", "VI"][n - 1] ?? `${n}.`;

  if (mc.length) {
    groups.push({
      heading: `PART ${prefix(groups.length + 1)}. MULTIPLE CHOICE`,
      directions:
        "Directions: Read each question carefully. Choose the letter of the best answer and write it on the space before each number.",
      questions: mc.map((q, i) => ({ ...q, display_order: cursor + i })),
    });
    cursor += mc.length;
  }
  if (tf.length) {
    groups.push({
      heading: `PART ${prefix(groups.length + 1)}. TRUE OR FALSE`,
      directions:
        "Directions: Write TRUE if the statement is correct and FALSE if it is incorrect.",
      questions: tf.map((q, i) => ({ ...q, display_order: cursor + i })),
    });
    cursor += tf.length;
  }
  if (sa.length) {
    groups.push({
      heading: `PART ${prefix(groups.length + 1)}. IDENTIFICATION / SHORT ANSWER`,
      directions:
        "Directions: Provide the concise and accurate answer for each question in the space provided.",
      questions: sa.map((q, i) => ({ ...q, display_order: cursor + i })),
    });
  }
  return groups;
}

function makeDocTitle(quizTitle?: string, subjectName?: string): string {
  if (quizTitle?.trim()) return quizTitle.trim();
  const date = new Date().toLocaleDateString("en-PH", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return `${subjectName || "Quiz"} — ${date}`;
}

// ─── PDF Export ──────────────────────────────────────────────────────────────

export async function exportQuizPdf(
  questions: QuizQuestionDraft[],
  quizTitle?: string,
  subjectName?: string,
  includeAnswerKey = false
): Promise<void> {
  const { jsPDF } = await import("jspdf");

  // Legal: 215.9 × 330.2 mm (8.5 × 13 in)
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "legal" });
  const PAGE_W = 215.9;
  const PAGE_H = 330.2;
  const ML = 20; // left margin
  const MR = 20; // right margin
  const MT = 20; // top margin
  const MB = 18; // bottom margin
  const TW = PAGE_W - ML - MR; // usable text width

  let y = MT;

  const checkPage = (needed: number) => {
    if (y + needed > PAGE_H - MB) {
      doc.addPage();
      y = MT;
    }
  };

  const write = (
    text: string,
    size: number,
    bold = false,
    indent = 0,
    gapAfter = 2.5
  ) => {
    doc.setFontSize(size);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    const lines = doc.splitTextToSize(text, TW - indent);
    const lh = size * 0.42; // standard 1.25 line height
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

  const title = makeDocTitle(quizTitle, subjectName);
  const groups = groupQuestions(questions);

  // ── Header ──────────────────────────────────────────────────────────────
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text((subjectName || "Subject").toUpperCase(), ML, y);
  y += 4.5;

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  doc.text(title, ML, y);
  y += 6;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Name: _________________________________________   Grade & Section: __________________   Score: _________`,
    ML,
    y
  );
  y += 5;
  rule(5);

  // ── Question Sections ───────────────────────────────────────────────────
  for (const group of groups) {
    checkPage(24);
    write(group.heading, 12.5, true, 0, 2);
    write(group.directions, 10, false, 0, 4);

    for (const q of group.questions) {
      const qNum = q.display_order;
      const isMC = q.question_type === "MULTIPLE_CHOICE";
      const opts = q.options ?? [];

      // Question line with space for answer
      const prefixSpace = isMC ? "____ " : "";
      const qText = `${prefixSpace}${qNum}. ${sanitize(q.question_text)}`;
      write(qText, 11, false, 0, 2.5);

      if (isMC && opts.length > 0) {
        const sorted = [...opts].sort(
          (a, b) => (a.option_order ?? 0) - (b.option_order ?? 0)
        );

        // Check if options are short enough to format side-by-side or stacked
        const maxOptLen = Math.max(...sorted.map((o) => (o.option_text || "").length));
        if (sorted.length === 2 && maxOptLen < 15) {
          // True/False inline
          const line = sorted
            .map((opt) => `${optionLetter(opt.option_order ?? 1)}) ${sanitize(opt.option_text)}`)
            .join("           ");
          write(line, 10.5, false, 12, 3);
        } else {
          for (const opt of sorted) {
            write(
              `${optionLetter(opt.option_order ?? 1)}) ${sanitize(opt.option_text)}`,
              10.5,
              false,
              10,
              1.8
            );
          }
          y += 1.5;
        }
      } else {
        // SA / Essay — writing line
        write("Answer: __________________________________________________________________", 10, false, 6, 4);
      }
    }
    y += 4;
  }

  // ── Compact Grid Answer Key ──────────────────────────────────────────────
  if (includeAnswerKey && groups.length > 0) {
    checkPage(40);
    rule(5);
    write("ANSWER KEY", 12.5, true, 0, 2);
    write(`${title} (${questions.length} Items)`, 9.5, false, 0, 4);

    // Collect all answers
    const keyItems: Array<{ num: number; ans: string; isChoice: boolean }> = [];
    for (const group of groups) {
      for (const q of group.questions) {
        if (q.question_type === "MULTIPLE_CHOICE") {
          const sorted = [...(q.options ?? [])].sort(
            (a, b) => (a.option_order ?? 0) - (b.option_order ?? 0)
          );
          const idx = sorted.findIndex((o) => o.is_correct);
          const correct = sorted[idx];
          const letter = idx >= 0 ? optionLetter(idx + 1) : "-";
          const isTF =
            sorted.length === 2 &&
            sorted.some((o) => o.option_text.trim().toLowerCase() === "true");
          const ansText = isTF && correct ? correct.option_text.toUpperCase() : letter;
          keyItems.push({ num: q.display_order, ans: ansText, isChoice: true });
        } else {
          const text = sanitize(q.explanation || "(See rubric)");
          keyItems.push({ num: q.display_order, ans: text, isChoice: false });
        }
      }
    }

    // Render Multiple Choice / True-False items in a compact 5-column grid
    const choiceItems = keyItems.filter((k) => k.isChoice);
    const nonChoiceItems = keyItems.filter((k) => !k.isChoice);

    if (choiceItems.length > 0) {
      const COLS = 5;
      const colW = TW / COLS;

      for (let i = 0; i < choiceItems.length; i += COLS) {
        checkPage(6);
        const row = choiceItems.slice(i, i + COLS);
        row.forEach((item, colIdx) => {
          doc.setFontSize(10);
          doc.setFont("helvetica", "bold");
          doc.text(`${item.num}.`, ML + colIdx * colW, y);
          doc.setFont("helvetica", "normal");
          doc.text(` ${item.ans}`, ML + colIdx * colW + 7, y);
        });
        y += 5;
      }
      y += 3;
    }

    // Non-choice items (Short Answer / Essay)
    if (nonChoiceItems.length > 0) {
      for (const item of nonChoiceItems) {
        write(`${item.num}. [Key/Rubric]: ${item.ans}`, 9.5, false, 0, 2);
      }
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────
  const filename = (title + ".pdf")
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, "_");
  doc.save(filename);
}

// ─── Word (.docx) Export ─────────────────────────────────────────────────────

export async function exportQuizDocx(
  questions: QuizQuestionDraft[],
  quizTitle?: string,
  subjectName?: string,
  includeAnswerKey = false
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

  const title = makeDocTitle(quizTitle, subjectName);
  const groups = groupQuestions(questions);

  const children: InstanceType<typeof Paragraph>[] = [];

  const p = (
    text: string,
    opts: { bold?: boolean; size?: number; indent?: number; space?: number } = {}
  ) =>
    new Paragraph({
      spacing: { after: opts.space ?? 120 },
      indent: opts.indent ? { left: convertInchesToTwip(opts.indent) } : undefined,
      children: [
        new TextRun({
          text: sanitize(text),
          bold: opts.bold ?? false,
          size: opts.size ?? 22, // half-points: 22 = 11pt
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
  children.push(p((subjectName || "Subject").toUpperCase(), { bold: true, size: 20, space: 40 }));
  children.push(p(title, { bold: true, size: 28, space: 80 }));
  children.push(
    p(
      "Name: _________________________________________   Grade & Section: __________________   Score: _________",
      { size: 20, space: 100 }
    )
  );
  children.push(divider());

  // Questions
  for (const group of groups) {
    children.push(p(group.heading, { bold: true, size: 25, space: 60 }));
    children.push(p(group.directions, { size: 20, space: 140 }));

    for (const q of group.questions) {
      const isMC = q.question_type === "MULTIPLE_CHOICE";
      const prefixSpace = isMC ? "____ " : "";
      children.push(
        p(`${prefixSpace}${q.display_order}. ${sanitize(q.question_text)}`, {
          size: 22, // 11pt
          space: 60,
        })
      );

      if (isMC && (q.options ?? []).length > 0) {
        const sorted = [...(q.options ?? [])].sort(
          (a, b) => (a.option_order ?? 0) - (b.option_order ?? 0)
        );
        for (const opt of sorted) {
          children.push(
            p(`${optionLetter(opt.option_order ?? 1)}) ${sanitize(opt.option_text)}`, {
              size: 21,
              indent: 0.35,
              space: 40,
            })
          );
        }
        children.push(p("", { space: 60 }));
      } else {
        children.push(
          p("Answer: __________________________________________________________________", {
            size: 20,
            space: 140,
          })
        );
      }
    }
    children.push(p("", { space: 120 }));
  }

  // Compact Answer Key
  if (includeAnswerKey && groups.length > 0) {
    children.push(divider());
    children.push(p("ANSWER KEY", { bold: true, size: 26, space: 60 }));
    children.push(p(`${title} (${questions.length} Items)`, { size: 19, space: 120 }));

    // Collect keys
    const choiceItems: Array<{ num: number; ans: string }> = [];
    const nonChoiceItems: Array<{ num: number; ans: string }> = [];

    for (const group of groups) {
      for (const q of group.questions) {
        if (q.question_type === "MULTIPLE_CHOICE") {
          const sorted = [...(q.options ?? [])].sort(
            (a, b) => (a.option_order ?? 0) - (b.option_order ?? 0)
          );
          const idx = sorted.findIndex((o) => o.is_correct);
          const correct = sorted[idx];
          const isTF =
            sorted.length === 2 &&
            sorted.some((o) => o.option_text.trim().toLowerCase() === "true");
          const ansText = isTF && correct
            ? correct.option_text.toUpperCase()
            : idx >= 0
            ? optionLetter(idx + 1)
            : "-";
          choiceItems.push({ num: q.display_order, ans: ansText });
        } else {
          nonChoiceItems.push({
            num: q.display_order,
            ans: sanitize(q.explanation || "(See rubric)"),
          });
        }
      }
    }

    // 5-items per line for Multiple Choice / True-False
    const COLS = 5;
    for (let i = 0; i < choiceItems.length; i += COLS) {
      const row = choiceItems.slice(i, i + COLS);
      const rowText = row.map((item) => `${item.num}. ${item.ans}`).join("       ");
      children.push(p(rowText, { bold: true, size: 21, space: 60 }));
    }

    if (nonChoiceItems.length > 0) {
      children.push(p("", { space: 60 }));
      for (const item of nonChoiceItems) {
        children.push(
          p(`${item.num}. [Key/Rubric]: ${item.ans}`, { size: 20, space: 50 })
        );
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
              left: convertInchesToTwip(0.9),
              right: convertInchesToTwip(0.9),
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
  a.download = (title + ".docx").replace(/[/\\:*?"<>|]/g, "-").replace(/\s+/g, "_");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

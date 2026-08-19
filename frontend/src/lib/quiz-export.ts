/**
 * quiz-export.ts
 * Client-side PDF and Word (.docx) export for AI-generated quiz questionnaires.
 * Paper size: Legal (8.5 × 13 in). Supports optional answer key at the bottom.
 */

import type { QuizQuestionDraft } from "@/pages/teacher/classworks/quiz-builder-types";

// ─── Helpers ────────────────────────────────────────────────────────────────

function sanitize(text: string): string {
  return (text || "").replace(/[^\x00-\x7F]/g, (ch) => ch); // keep UTF-8 as-is
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
      heading: `${prefix(groups.length + 1)}. MULTIPLE CHOICE`,
      directions:
        "Directions: Choose the letter of the best answer. Write the letter on the space provided.",
      questions: mc.map((q, i) => ({ ...q, display_order: cursor + i })),
    });
    cursor += mc.length;
  }
  if (tf.length) {
    groups.push({
      heading: `${prefix(groups.length + 1)}. TRUE OR FALSE`,
      directions:
        "Directions: Write TRUE if the statement is correct and FALSE if it is incorrect.",
      questions: tf.map((q, i) => ({ ...q, display_order: cursor + i })),
    });
    cursor += tf.length;
  }
  if (sa.length) {
    groups.push({
      heading: `${prefix(groups.length + 1)}. IDENTIFICATION / SHORT ANSWER`,
      directions:
        "Directions: Write the correct word or phrase on the blank provided.",
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

  // Legal: 215.9 × 330.2 mm
  const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "legal" });
  const PAGE_W = 215.9;
  const PAGE_H = 330.2;
  const ML = 22; // left margin
  const MR = 22; // right margin
  const MT = 22; // top margin
  const MB = 18; // bottom margin
  const TW = PAGE_W - ML - MR; // text width

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
    gapAfter = 2
  ) => {
    doc.setFontSize(size);
    doc.setFont("helvetica", bold ? "bold" : "normal");
    const lines = doc.splitTextToSize(text, TW - indent);
    const lh = size * 0.38;
    checkPage(lines.length * lh + gapAfter);
    doc.text(lines, ML + indent, y);
    y += lines.length * lh + gapAfter;
  };

  const rule = () => {
    checkPage(6);
    doc.setDrawColor(180, 180, 180);
    doc.line(ML, y, PAGE_W - MR, y);
    y += 4;
  };

  const title = makeDocTitle(quizTitle, subjectName);
  const groups = groupQuestions(questions);

  // ── Header ──────────────────────────────────────────────────────────────
  write(subjectName || "Subject", 10, false, 0, 1);
  write(title, 14, true, 0, 1);
  write(
    `Name: ________________________________  Score: ________  Date: ___________`,
    9,
    false,
    0,
    1
  );
  rule();

  // ── Question sections ───────────────────────────────────────────────────
  for (const group of groups) {
    checkPage(20);
    write(group.heading, 11, true, 0, 2);
    write(group.directions, 9, false, 0, 4);

    for (const q of group.questions) {
      const qText = `${q.display_order}. ${sanitize(q.question_text)}`;
      write(qText, 10, false, 0, 1);

      if (q.question_type === "MULTIPLE_CHOICE" && (q.options ?? []).length > 0) {
        const sorted = [...(q.options ?? [])].sort(
          (a, b) => (a.option_order ?? 0) - (b.option_order ?? 0)
        );
        for (const opt of sorted) {
          write(
            `${optionLetter(opt.option_order ?? 1)}. ${sanitize(opt.option_text)}`,
            9,
            false,
            6,
            0.5
          );
        }
        y += 2;
      } else {
        // SA/Essay — blank answer line
        write("Answer: ___________________________________________", 9, false, 0, 3);
      }
    }
    y += 4;
  }

  // ── Answer Key ──────────────────────────────────────────────────────────
  if (includeAnswerKey && groups.length > 0) {
    doc.addPage();
    y = MT;
    rule();
    write("ANSWER KEY", 12, true, 0, 3);
    write(title, 9, false, 0, 4);

    let num = 1;
    for (const group of groups) {
      write(group.heading, 10, true, 0, 2);
      for (const q of group.questions) {
        let answer = "";
        if (q.question_type === "MULTIPLE_CHOICE") {
          const correct = (q.options ?? []).find((o) => o.is_correct);
          if (correct) {
            const sorted = [...(q.options ?? [])].sort(
              (a, b) => (a.option_order ?? 0) - (b.option_order ?? 0)
            );
            const idx = sorted.findIndex((o) => o.is_correct);
            answer = `${optionLetter(idx + 1)}. ${sanitize(correct.option_text)}`;
          }
        } else {
          // SA / Essay
          answer = sanitize(q.explanation || "(See rubric)");
        }
        write(`${num++}. ${answer}`, 9, false, 0, 1.5);
      }
      y += 3;
    }
  }

  // ── Save ────────────────────────────────────────────────────────────────
  const filename = (title + ".pdf")
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, "_");
  doc.save(filename);
}

// ─── Word Export ─────────────────────────────────────────────────────────────

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
    AlignmentType,
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
      spacing: { after: opts.space ?? 100 },
      indent: opts.indent ? { left: convertInchesToTwip(opts.indent) } : undefined,
      children: [
        new TextRun({
          text: sanitize(text),
          bold: opts.bold ?? false,
          size: opts.size ?? 22, // half-points; 22 = 11pt
          font: "Calibri",
        }),
      ],
    });

  const divider = () =>
    new Paragraph({
      spacing: { after: 60 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "AAAAAA" } },
      children: [],
    });

  // Header
  children.push(p(subjectName || "Subject", { size: 20 }));
  children.push(p(title, { bold: true, size: 28, space: 80 }));
  children.push(
    p(
      "Name: ________________________________  Score: ________  Date: ___________",
      { size: 18, space: 80 }
    )
  );
  children.push(divider());

  // Questions
  for (const group of groups) {
    children.push(p(group.heading, { bold: true, size: 24, space: 60 }));
    children.push(p(group.directions, { size: 18, space: 120 }));

    for (const q of group.questions) {
      children.push(
        p(`${q.display_order}. ${sanitize(q.question_text)}`, {
          size: 22,
          space: 60,
        })
      );

      if (q.question_type === "MULTIPLE_CHOICE" && (q.options ?? []).length > 0) {
        const sorted = [...(q.options ?? [])].sort(
          (a, b) => (a.option_order ?? 0) - (b.option_order ?? 0)
        );
        for (const opt of sorted) {
          children.push(
            p(`${optionLetter(opt.option_order ?? 1)}. ${sanitize(opt.option_text)}`, {
              size: 20,
              indent: 0.3,
              space: 40,
            })
          );
        }
        children.push(p("", { space: 80 }));
      } else {
        children.push(
          p("Answer: ___________________________________________", {
            size: 20,
            space: 120,
          })
        );
      }
    }
    children.push(p("", { space: 120 }));
  }

  // Answer Key
  if (includeAnswerKey && groups.length > 0) {
    children.push(divider());
    children.push(p("ANSWER KEY", { bold: true, size: 26, space: 80 }));
    children.push(p(title, { size: 18, space: 120 }));

    let num = 1;
    for (const group of groups) {
      children.push(p(group.heading, { bold: true, size: 22, space: 60 }));
      for (const q of group.questions) {
        let answer = "";
        if (q.question_type === "MULTIPLE_CHOICE") {
          const sorted = [...(q.options ?? [])].sort(
            (a, b) => (a.option_order ?? 0) - (b.option_order ?? 0)
          );
          const idx = sorted.findIndex((o) => o.is_correct);
          const correct = sorted[idx];
          answer = correct
            ? `${optionLetter(idx + 1)}. ${sanitize(correct.option_text)}`
            : "(No answer marked)";
        } else {
          answer = sanitize(q.explanation || "(See rubric)");
        }
        children.push(p(`${num++}. ${answer}`, { size: 20, space: 60 }));
      }
      children.push(p("", { space: 80 }));
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
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.25),
              right: convertInchesToTwip(1.25),
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

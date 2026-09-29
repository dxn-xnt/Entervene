/**
 * quiz-export.ts
 * Client-side PDF and Word (.docx) export for AI-generated quiz questionnaires.
 * Paper size: Legal (8.5 × 13 in). DepEd / PH school exam formatting.
 * Supports compact grid answer key at the bottom.
 */

import type { QuizQuestionDraft } from "@/pages/teacher/classworks/quiz-builder-types";

// ─── Helpers ────────────────────────────────────────────────────────────────

export interface SanitizeOptions {
  /**
   * If true, transliterates non-ASCII characters to safe ASCII equivalents.
   * If false, preserves all glyphs supported by the embedded Unicode font (Latin, Greek, Math, Punctuation).
   * Default: true (safe for fallback or ASCII-only targets).
   */
  fallbackAscii?: boolean;
  /**
   * Optional callback invoked when unrenderable glyphs (e.g. CJK, emojis) are replaced with visible marker [?].
   */
  onWarning?: (warning: string) => void;
}

export function sanitize(text: string, options: SanitizeOptions = {}): string {
  if (!text) return "";
  const { fallbackAscii = true, onWarning } = options;
  const unrecognized = new Set<string>();

  if (!fallbackAscii) {
    // Lossless mode for embedded DejaVu Sans subset
    const inSubset = (cp: number) =>
      (cp >= 0x20 && cp <= 0x7e) ||
      cp === 0x0a ||
      cp === 0x0d ||
      cp === 0x09 ||
      (cp >= 0xa0 && cp <= 0xff) ||
      (cp >= 0x0370 && cp <= 0x03ff) ||
      (cp >= 0x2010 && cp <= 0x206f) ||
      (cp >= 0x2070 && cp <= 0x209f) ||
      (cp >= 0x2100 && cp <= 0x214f) ||
      (cp >= 0x2190 && cp <= 0x21ff) ||
      (cp >= 0x2200 && cp <= 0x22ff);

    let out = "";
    for (const ch of Array.from(text)) {
      const cp = ch.codePointAt(0);
      if (cp !== undefined && inSubset(cp)) {
        out += ch;
      } else {
        const hex =
          cp !== undefined
            ? `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`
            : "unknown";
        unrecognized.add(`${ch} (${hex})`);
        out += "[?]";
      }
    }
    if (unrecognized.size && onWarning) {
      onWarning(
        `Some characters could not be rendered in PDF and were replaced with [?]: ${Array.from(
          unrecognized
        ).join(", ")}`
      );
    }
    return out;
  }

  // Fallback mode: transliterate mathematical, greek, relational, superscripts, accents to ASCII
  let res = text
    .replace(/→/g, "->")
    .replace(/←/g, "<-")
    .replace(/↔/g, "<->")
    .replace(/≤/g, "<=")
    .replace(/≥/g, ">=")
    .replace(/≠/g, "!=")
    .replace(/≈/g, "~=")
    .replace(/⊂/g, "subset of")
    .replace(/±/g, "+/-")
    .replace(/×/g, "x")
    .replace(/÷/g, "/")
    .replace(/°/g, " deg")
    .replace(/•/g, "*")
    .replace(/…/g, "...")
    .replace(/²/g, "^2")
    .replace(/³/g, "^3")
    .replace(/¹/g, "^1")
    .replace(/⁰/g, "^0")
    .replace(/π/g, "pi")
    .replace(/Π/g, "Pi")
    .replace(/Δ/g, "Delta")
    .replace(/δ/g, "delta")
    .replace(/√/g, "sqrt")
    .replace(/[µμ]/g, "u")
    .replace(/½/g, "1/2")
    .replace(/¼/g, "1/4")
    .replace(/¾/g, "3/4")
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015]/g, (m) =>
      m === "\u2014" || m === "\u2015" ? " -- " : "-"
    )
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

  let out = "";
  for (const ch of Array.from(res)) {
    const cp = ch.codePointAt(0);
    if (
      cp !== undefined &&
      ((cp >= 0x20 && cp <= 0x7e) || cp === 0x0a || cp === 0x0d || cp === 0x09)
    ) {
      out += ch;
    } else {
      const hex =
        cp !== undefined
          ? `U+${cp.toString(16).toUpperCase().padStart(4, "0")}`
          : "unknown";
      unrecognized.add(`${ch} (${hex})`);
      out += "[?]";
    }
  }
  if (unrecognized.size && onWarning) {
    onWarning(
      `Some characters could not be rendered in PDF and were replaced with [?]: ${Array.from(
        unrecognized
      ).join(", ")}`
    );
  }
  return out;
}

export function cleanDocxText(text: string): string {
  if (!text) return "";
  // DOCX XML is UTF-8 encoded and supports full Unicode natively.
  // We only strip control characters that are invalid in XML 1.0.
  return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
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
  return `${subjectName || "Quiz"} - ${date}`;
}

// ─── PDF Export ──────────────────────────────────────────────────────────────

export interface ExportPdfOptions {
  save?: boolean;
  outputPath?: string;
}

export async function exportQuizPdf(
  questions: QuizQuestionDraft[],
  quizTitle?: string,
  subjectName?: string,
  includeAnswerKey = false,
  options?: ExportPdfOptions
): Promise<{ doc: any; warnings: string[] }> {
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
  const warnings: string[] = [];
  const addWarning = (msg: string) => {
    if (!warnings.includes(msg)) warnings.push(msg);
  };

  // Lazy-load Unicode font
  let activeFont = "helvetica";
  let customFontLoaded = false;
  try {
    const { QUIZ_FONT_NAME, QUIZ_FONT_B64 } = await import("./quiz-export-font");
    if (QUIZ_FONT_B64) {
      doc.addFileToVFS(`${QUIZ_FONT_NAME}.ttf`, QUIZ_FONT_B64);
      doc.addFont(`${QUIZ_FONT_NAME}.ttf`, QUIZ_FONT_NAME, "normal");
      doc.addFont(`${QUIZ_FONT_NAME}.ttf`, QUIZ_FONT_NAME, "bold");
      activeFont = QUIZ_FONT_NAME;
      customFontLoaded = true;
    }
  } catch {
    customFontLoaded = false;
    activeFont = "helvetica";
  }

  const setDocFont = (bold: boolean) => {
    doc.setFont(activeFont, bold ? "bold" : "normal");
  };

  const clean = (str: string) =>
    sanitize(str, { fallbackAscii: !customFontLoaded, onWarning: addWarning });

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
    const cleanText = clean(text);
    doc.setFontSize(size);
    setDocFont(bold);
    const lines = doc.splitTextToSize(cleanText, TW - indent);
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

  const title = clean(makeDocTitle(quizTitle, subjectName));
  const groups = groupQuestions(questions);

  // ── Header ──────────────────────────────────────────────────────────────
  doc.setFontSize(10);
  setDocFont(true);
  doc.text(clean((subjectName || "Subject").toUpperCase()), ML, y);
  y += 4.5;

  doc.setFontSize(14);
  setDocFont(true);
  doc.text(clean(title), ML, y);
  y += 6;

  doc.setFontSize(10);
  setDocFont(false);
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
      const qText = `${prefixSpace}${qNum}. ${q.question_text}`;
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
            .map((opt) => `${optionLetter(opt.option_order ?? 1)}) ${opt.option_text}`)
            .join("           ");
          write(line, 10.5, false, 12, 3);
        } else {
          for (const opt of sorted) {
            write(
              `${optionLetter(opt.option_order ?? 1)}) ${opt.option_text}`,
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
          const text = q.explanation || "(See rubric)";
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
          setDocFont(true);
          doc.text(`${item.num}.`, ML + colIdx * colW, y);
          setDocFont(false);
          doc.text(` ${clean(item.ans)}`, ML + colIdx * colW + 7, y);
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

  // ── Save or Output ──────────────────────────────────────────────────────
  if (options?.outputPath && typeof window === "undefined") {
    const fs = await (Function('return import("fs")')() as Promise<any>);
    fs.writeFileSync(options.outputPath, Buffer.from(doc.output("arraybuffer")));
  } else if (options?.save !== false) {
    const filename = (title + ".pdf")
      .replace(/[/\\:*?"<>|]/g, "-")
      .replace(/\s+/g, "_");
    doc.save(filename);
  }

  return { doc, warnings };
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

  const title = cleanDocxText(makeDocTitle(quizTitle, subjectName));
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
          text: cleanDocxText(text),
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
        p(`${prefixSpace}${q.display_order}. ${q.question_text}`, {
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
            p(`${optionLetter(opt.option_order ?? 1)}) ${opt.option_text}`, {
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
            ans: q.explanation || "(See rubric)",
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
  a.download = (title + ".docx")
    .replace(/[/\\:*?"<>|]/g, "-")
    .replace(/\s+/g, "_");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

import { describe, it, expect } from "vitest";
import { sanitize, cleanDocxText, groupQuestions } from "./quiz-export";
import type { QuizQuestionDraft } from "@/pages/teacher/classworks/quiz-builder-types";

describe("quiz-export text sanitization", () => {
  it("normalizes mathematical, punctuation, and non-WinAnsi characters to safe ASCII equivalents in fallback mode", () => {
    // Math & relational
    expect(sanitize("→")).toBe("->");
    expect(sanitize("≤")).toBe("<=");
    expect(sanitize("≥")).toBe(">=");
    expect(sanitize("⊂")).toBe("subset of");
    expect(sanitize("≠")).toBe("!=");
    expect(sanitize("≈")).toBe("~=");
    expect(sanitize("±")).toBe("+/-");

    // Superscripts & fractions
    expect(sanitize("m/s²")).toBe("m/s^2");
    expect(sanitize("½")).toBe("1/2");

    // Greek & Math operators
    expect(sanitize("π")).toBe("pi");
    expect(sanitize("Δ")).toBe("Delta");
    expect(sanitize("√")).toBe("sqrt");
    expect(sanitize("µ")).toBe("u");

    // Punctuation & accents
    expect(sanitize("°")).toBe(" deg");
    expect(sanitize("–")).toBe("-");
    expect(sanitize("—")).toBe(" -- ");
    expect(sanitize("’")).toBe("'");
    expect(sanitize("“")).toBe('"');
    expect(sanitize("”")).toBe('"');
    expect(sanitize("•")).toBe("*");
    expect(sanitize("…")).toBe("...");
    expect(sanitize("ñ")).toBe("n");
    expect(sanitize("é")).toBe("e");
    expect(sanitize("\u2011")).toBe("-");
    expect(sanitize('"Niño"')).toBe('"Nino"');
    expect(sanitize('"José"')).toBe('"Jose"');
  });

  it("never silently deletes unrecognized characters in fallback mode; substitutes [?] and warns", () => {
    const warnings: string[] = [];
    const onWarning = (w: string) => warnings.push(w);

    const cjkOut = sanitize("中文 text", { fallbackAscii: true, onWarning });
    expect(cjkOut).toBe("[?][?] text");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toContain("U+4E2D");
    expect(warnings[0]).toContain("U+6587");

    const emojiWarnings: string[] = [];
    const emojiOut = sanitize("emoji 😀 here", {
      fallbackAscii: true,
      onWarning: (w) => emojiWarnings.push(w),
    });
    expect(emojiOut).toBe("emoji [?] here");
    expect(emojiWarnings.length).toBe(1);
    expect(emojiWarnings[0]).toContain("U+1F600");
  });

  it("preserves exact Unicode characters without loss in font-enabled mode", () => {
    const fontChars = "→ ≤ ≥ ⊂ ² π Δ ñ é – — ’ “ ” • … ° ‑ √ µ ½";
    const out = sanitize(fontChars, { fallbackAscii: false });
    expect(out).toBe(fontChars);

    expect(sanitize("m/s²", { fallbackAscii: false })).toBe("m/s²");
    expect(sanitize("25°C", { fallbackAscii: false })).toBe("25°C");
    expect(sanitize("πr²", { fallbackAscii: false })).toBe("πr²");
    expect(sanitize("Δt", { fallbackAscii: false })).toBe("Δt");
    expect(sanitize("√16", { fallbackAscii: false })).toBe("√16");
    expect(sanitize("100 µF", { fallbackAscii: false })).toBe("100 µF");
    expect(sanitize("½ cup", { fallbackAscii: false })).toBe("½ cup");
    expect(sanitize('"Niño"', { fallbackAscii: false })).toBe('"Niño"');
    expect(sanitize('"José"', { fallbackAscii: false })).toBe('"José"');
  });

  it("substitutes [?] and warns in font mode for glyphs outside the font subset", () => {
    const warnings: string[] = [];
    const cjkOut = sanitize("CJK 中文 test", {
      fallbackAscii: false,
      onWarning: (w) => warnings.push(w),
    });
    expect(cjkOut).toBe("CJK [?][?] test");
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("U+4E2D");

    const emojiWarnings: string[] = [];
    const emojiOut = sanitize("rocket 🚀 quiz", {
      fallbackAscii: false,
      onWarning: (w) => emojiWarnings.push(w),
    });
    expect(emojiOut).toBe("rocket [?] quiz");
    expect(emojiWarnings.length).toBe(1);
  });

  it("cleanDocxText preserves full Unicode while stripping invalid XML control chars", () => {
    const richText = "m/s² 25°C π Δ √ µ ½ Niño José 中文 🚀 \x00\x08\x0b\x0c";
    const cleaned = cleanDocxText(richText);
    expect(cleaned).toBe("m/s² 25°C π Δ √ µ ½ Niño José 中文 🚀 ");
    expect(cleaned).not.toContain("\x00");
    expect(cleaned).not.toContain("\x08");
  });
});

describe("quiz-export groupQuestions", () => {
  it("separates MULTIPLE_CHOICE, TRUE_FALSE, IDENTIFICATION, and SHORT_ANSWER (ESSAY) into distinct parts", () => {
    const questions: QuizQuestionDraft[] = [
      {
        id: "1",
        question_text: "What is 2+2?",
        question_type: "MULTIPLE_CHOICE",
        points: "1",
        display_order: 1,
        options: [
          { option_text: "3", is_correct: false },
          { option_text: "4", is_correct: true },
          { option_text: "5", is_correct: false },
          { option_text: "6", is_correct: false },
        ],
      },
      {
        id: "2",
        question_text: "The sky is blue.",
        question_type: "MULTIPLE_CHOICE",
        points: "1",
        display_order: 2,
        options: [
          { option_text: "True", is_correct: true },
          { option_text: "False", is_correct: false },
        ],
      },
      {
        id: "3",
        question_text: "Identify the powerhouse of the cell.",
        question_type: "IDENTIFICATION",
        points: "1",
        display_order: 3,
        options: [{ option_text: "Mitochondria", is_correct: true }],
      },
      {
        id: "4",
        question_text: "Explain cellular respiration in depth.",
        question_type: "SHORT_ANSWER",
        points: "5",
        display_order: 4,
        explanation: "Sample rubric",
        options: [],
      },
    ];

    const groups = groupQuestions(questions);
    expect(groups).toHaveLength(4);

    expect(groups[0].heading).toBe("PART I. MULTIPLE CHOICE");
    expect(groups[0].directions).toContain("Choose the letter of the best answer");
    expect(groups[0].questions).toHaveLength(1);
    expect(groups[0].questions[0].display_order).toBe(1);

    expect(groups[1].heading).toBe("PART II. TRUE OR FALSE");
    expect(groups[1].directions).toContain("Write TRUE if the statement is correct");
    expect(groups[1].questions).toHaveLength(1);
    expect(groups[1].questions[0].display_order).toBe(2);

    expect(groups[2].heading).toBe("PART III. IDENTIFICATION");
    expect(groups[2].directions).toContain("Provide the concise and accurate answer");
    expect(groups[2].questions).toHaveLength(1);
    expect(groups[2].questions[0].display_order).toBe(3);

    expect(groups[3].heading).toBe("PART IV. SHORT ANSWER (ESSAY)");
    expect(groups[3].directions).toContain("Write a clear and comprehensive response");
    expect(groups[3].questions).toHaveLength(1);
    expect(groups[3].questions[0].display_order).toBe(4);
  });
});

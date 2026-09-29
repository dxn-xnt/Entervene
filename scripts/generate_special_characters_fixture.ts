/**
 * scripts/generate_special_characters_fixture.ts
 * Generates backend/tests/fixtures/Special_Characters_Export_Quiz.pdf
 * using the REAL exportQuizPdf code path from frontend/src/lib/quiz-export.ts.
 *
 * Usage:
 *   npx tsx scripts/generate_special_characters_fixture.ts
 */

import path from "path";
import { fileURLToPath } from "url";
import { exportQuizPdf } from "../frontend/src/lib/quiz-export";
import type { QuizQuestionDraft } from "../frontend/src/pages/teacher/classworks/quiz-builder-types";

const questions: QuizQuestionDraft[] = [
  {
    display_order: 1,
    question_text: "If set A ⊂ set B and condition x ≤ y holds, which statement is true?",
    question_type: "MULTIPLE_CHOICE",
    points: 1,
    difficulty_level: "MEDIUM",
    options: [
      { option_order: 1, option_text: "x → y", is_correct: true },
      { option_order: 2, option_text: "x ≥ y", is_correct: false },
    ],
  },
  {
    display_order: 2,
    question_text:
      'The experiment at 25° showed that jalapeño and café are "positive"—correct?',
    question_type: "MULTIPLE_CHOICE",
    points: 1,
    difficulty_level: "MEDIUM",
    options: [
      { option_order: 1, option_text: "Temperature was 25°", is_correct: true },
      { option_order: 2, option_text: "Temperature was negative", is_correct: false },
    ],
  },
  {
    display_order: 3,
    question_text: "Identify the isotope: carbon\u201112 • high purity",
    question_type: "SHORT_ANSWER",
    points: 1,
    difficulty_level: "MEDIUM",
    options: [],
    explanation: "carbon\u201112",
  },
];

async function main() {
  const outputPath = path.resolve(
    process.cwd(),
    "backend/tests/fixtures/Special_Characters_Export_Quiz.pdf"
  );

  console.log("Generating fixture via REAL exportQuizPdf code path...");
  const { warnings } = await exportQuizPdf(
    questions,
    "Special Characters Export Quiz",
    "Science",
    true, // includeAnswerKey
    { save: false, outputPath }
  );

  if (warnings.length > 0) {
    console.warn("Export warnings:", warnings);
  }
  console.log(`Generated: ${outputPath}`);
}

main().catch((err) => {
  console.error("Error generating fixture:", err);
  process.exit(1);
});

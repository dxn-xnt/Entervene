/**
 * scripts/generate_tos_roundtrip_fixtures.ts
 * Builds real exam exports using the REAL exportTosExamPdf and exportTosExamDocx:
 * - 3 Multiple Choice
 * - 3 True/False
 * - 3 Identification (single-term keys)
 * - 3 Essays with explanations containing scoring criteria
 *
 * Exports:
 * 1. Student PDF (no answer key)
 * 2. Exam PDF with answer key
 * 3. Exam DOCX with answer key
 *
 * Saves into a temp directory outside the repository.
 */

import os from "os";
import path from "path";
import fs from "fs";
import { exportTosExamPdf, exportTosExamDocx } from "../frontend/src/lib/tos-export";
import type { TOSExportQuestion, TOSExamMeta } from "../frontend/src/lib/tos-export";

export const sampleQuestions: TOSExportQuestion[] = [
  // 3 Multiple Choice
  {
    quiz_question_id: 1,
    display_order: 1,
    question_text: "What literary device compares two unlike things using 'like' or 'as'?",
    question_type: "MULTIPLE_CHOICE",
    points: 1,
    difficulty_level: "EASY",
    options: [
      { option_id: 101, option_text: "Simile", is_correct: true, option_order: 1 },
      { option_id: 102, option_text: "Metaphor", is_correct: false, option_order: 2 },
      { option_id: 103, option_text: "Personification", is_correct: false, option_order: 3 },
      { option_id: 104, option_text: "Hyperbole", is_correct: false, option_order: 4 },
    ],
  },
  {
    quiz_question_id: 2,
    display_order: 2,
    question_text: "Who is the legendary hero that defeats the monster Grendel?",
    question_type: "MULTIPLE_CHOICE",
    points: 1,
    difficulty_level: "EASY",
    options: [
      { option_id: 201, option_text: "Hrothgar", is_correct: false, option_order: 1 },
      { option_id: 202, option_text: "Beowulf", is_correct: true, option_order: 2 },
      { option_id: 203, option_text: "Wiglaf", is_correct: false, option_order: 3 },
      { option_id: 204, option_text: "Unferth", is_correct: false, option_order: 4 },
    ],
  },
  {
    quiz_question_id: 3,
    display_order: 3,
    question_text: "What term denotes the highest point of tension in a narrative arc?",
    question_type: "MULTIPLE_CHOICE",
    points: 1,
    difficulty_level: "MEDIUM",
    options: [
      { option_id: 301, option_text: "Exposition", is_correct: false, option_order: 1 },
      { option_id: 302, option_text: "Climax", is_correct: true, option_order: 2 },
      { option_id: 303, option_text: "Resolution", is_correct: false, option_order: 3 },
      { option_id: 304, option_text: "Rising action", is_correct: false, option_order: 4 },
    ],
  },

  // 3 True/False
  {
    quiz_question_id: 4,
    display_order: 4,
    question_text: "A standard Shakespearean sonnet contains exactly 14 lines.",
    question_type: "TRUE_FALSE",
    points: 1,
    difficulty_level: "EASY",
    options: [
      { option_id: 401, option_text: "True", is_correct: true, option_order: 1 },
      { option_id: 402, option_text: "False", is_correct: false, option_order: 2 },
    ],
  },
  {
    quiz_question_id: 5,
    display_order: 5,
    question_text: "All poems are required to follow a strict rhyming pattern.",
    question_type: "TRUE_FALSE",
    points: 1,
    difficulty_level: "EASY",
    options: [
      { option_id: 501, option_text: "True", is_correct: false, option_order: 1 },
      { option_id: 502, option_text: "False", is_correct: true, option_order: 2 },
    ],
  },
  {
    quiz_question_id: 6,
    display_order: 6,
    question_text: "An internal conflict centers on psychological struggles within a character.",
    question_type: "TRUE_FALSE",
    points: 1,
    difficulty_level: "MEDIUM",
    options: [
      { option_id: 601, option_text: "True", is_correct: true, option_order: 1 },
      { option_id: 602, option_text: "False", is_correct: false, option_order: 2 },
    ],
  },

  // 3 Identification (single-term keys)
  {
    quiz_question_id: 7,
    display_order: 7,
    question_text: "The planned chronological sequence of events in a story is called the:",
    question_type: "IDENTIFICATION",
    points: 1,
    difficulty_level: "MEDIUM",
    explanation: "Teacher note: accept plot.",
    options: [
      { option_id: 701, option_text: "Plot", is_correct: true, option_order: 1 },
    ],
  },
  {
    quiz_question_id: 8,
    display_order: 8,
    question_text: "The repetition of initial consonant sounds in successive words is known as:",
    question_type: "IDENTIFICATION",
    points: 1,
    difficulty_level: "MEDIUM",
    explanation: "Teacher note: accept alliteration.",
    options: [
      { option_id: 801, option_text: "Alliteration", is_correct: true, option_order: 1 },
    ],
  },
  {
    quiz_question_id: 9,
    display_order: 9,
    question_text: "The lens or perspective through which a narrative is related is called the:",
    question_type: "IDENTIFICATION",
    points: 1,
    difficulty_level: "MEDIUM",
    explanation: "Teacher note: accept point of view.",
    options: [
      { option_id: 901, option_text: "Point of View", is_correct: true, option_order: 1 },
    ],
  },

  // 3 Essays with explanations containing scoring criteria
  {
    quiz_question_id: 10,
    display_order: 10,
    question_text: "Explain how dramatic irony heightens tension in a theatrical tragedy.",
    question_type: "ESSAY",
    points: 5,
    difficulty_level: "HARD",
    explanation:
      "Scoring Criteria: Defines dramatic irony clearly (2 pts), analyzes an illustrative scene (2 pts), and explains audience emotional suspense (1 pt).",
    options: [],
  },
  {
    quiz_question_id: 11,
    display_order: 11,
    question_text: "Analyze how the setting reinforces the gloomy mood in the Gothic passage.",
    question_type: "ESSAY",
    points: 5,
    difficulty_level: "HARD",
    explanation:
      "Rubric: Identifies sensory details (2 pts), connects architecture/weather to atmosphere (2 pts), and maintains grammatical precision (1 pt).",
    options: [],
  },
  {
    quiz_question_id: 12,
    display_order: 12,
    question_text: "Discuss the moral dilemma confronting the protagonist in the final act.",
    question_type: "ESSAY",
    points: 5,
    difficulty_level: "HARD",
    explanation:
      "Scoring Criteria: Explains competing ethical values (2 pts), evaluates character actions (2 pts), and articulates thematic consequence (1 pt).",
    options: [],
  },
];

export async function generateRealFiles(outputDir: string) {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const metaStudent: TOSExamMeta = {
    title: "English 7 Summative Assessment",
    subjectName: "English 7",
    quarter: "Quarter 1",
    includeAnswerKey: false,
  };

  const metaTeacher: TOSExamMeta = {
    title: "English 7 Summative Assessment",
    subjectName: "English 7",
    quarter: "Quarter 1",
    includeAnswerKey: true,
  };

  const studentPdfPath = path.join(outputDir, "real_student_exam.pdf");
  const teacherPdfPath = path.join(outputDir, "real_teacher_exam_with_key.pdf");
  const teacherDocxPath = path.join(outputDir, "real_teacher_exam_with_key.docx");

  console.log("Exporting real student PDF (no answer key)...");
  const studentDoc = (await exportTosExamPdf(sampleQuestions, metaStudent, { save: false })) as {
    output: (type: string) => ArrayBuffer;
  };
  fs.writeFileSync(studentPdfPath, Buffer.from(studentDoc.output("arraybuffer")));

  console.log("Exporting real teacher PDF (with answer key)...");
  const teacherDoc = (await exportTosExamPdf(sampleQuestions, metaTeacher, { save: false })) as {
    output: (type: string) => ArrayBuffer;
  };
  fs.writeFileSync(teacherPdfPath, Buffer.from(teacherDoc.output("arraybuffer")));

  console.log("Exporting real teacher DOCX (with answer key)...");
  const teacherDocx = (await exportTosExamDocx(sampleQuestions, metaTeacher, { save: false })) as {
    toBuffer: () => Promise<Buffer | Uint8Array>;
  };
  const docxBuffer = await teacherDocx.toBuffer();
  fs.writeFileSync(teacherDocxPath, Buffer.from(docxBuffer));

  return { studentPdfPath, teacherPdfPath, teacherDocxPath };
}

if (process.argv[1] && process.argv[1].endsWith("generate_tos_roundtrip_fixtures.ts")) {
  const targetDir = process.argv[2] || path.join(os.tmpdir(), "entervene_tos_roundtrip");
  generateRealFiles(targetDir)
    .then((paths) => {
      console.log("Generated real files successfully in:", targetDir);
      console.log(paths);
    })
    .catch((err) => {
      console.error("Failed to generate real files:", err);
      process.exit(1);
    });
}

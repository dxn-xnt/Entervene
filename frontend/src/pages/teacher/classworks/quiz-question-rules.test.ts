import { describe, it, expect, vi } from "vitest";
import {
  isUnkeyed,
  normalizeIncomingQuestion,
  normalizeIncomingQuestions,
  checkPublishReadiness,
  switchQuestionType,
  mapGeneratedQuizQuestions,
} from "./quiz-question-rules";
import type { QuizQuestionDraft } from "./quiz-builder-types";

describe("quiz-question-rules", () => {
  describe("isUnkeyed and badge logic for all three question types", () => {
    it("MULTIPLE_CHOICE: unkeyed when no option is marked correct", () => {
      const q: QuizQuestionDraft = {
        id: "1",
        question_text: "MC Question",
        question_type: "MULTIPLE_CHOICE",
        points: "1",
        display_order: 1,
        options: [
          { option_text: "Option A", is_correct: false },
          { option_text: "Option B", is_correct: false },
        ],
      };
      expect(isUnkeyed(q)).toBe(true);
    });

    it("MULTIPLE_CHOICE: keyed when at least one option is marked correct", () => {
      const q: QuizQuestionDraft = {
        id: "1",
        question_text: "MC Question",
        question_type: "MULTIPLE_CHOICE",
        points: "1",
        display_order: 1,
        options: [
          { option_text: "Option A", is_correct: true },
          { option_text: "Option B", is_correct: false },
        ],
      };
      expect(isUnkeyed(q)).toBe(false);
    });

    it("IDENTIFICATION: unkeyed when options array is empty", () => {
      const q: QuizQuestionDraft = {
        id: "2",
        question_text: "ID Question",
        question_type: "IDENTIFICATION",
        points: "1",
        display_order: 2,
        options: [],
      };
      expect(isUnkeyed(q)).toBe(true);
    });

    it("IDENTIFICATION: unkeyed when all options are blank/whitespace", () => {
      const q: QuizQuestionDraft = {
        id: "2",
        question_text: "ID Question",
        question_type: "IDENTIFICATION",
        points: "1",
        display_order: 2,
        options: [
          { option_text: "   ", is_correct: true },
          { option_text: "", is_correct: true },
        ],
      };
      expect(isUnkeyed(q)).toBe(true);
    });

    it("IDENTIFICATION: keyed when there is at least one non-blank key", () => {
      const q: QuizQuestionDraft = {
        id: "2",
        question_text: "ID Question",
        question_type: "IDENTIFICATION",
        points: "1",
        display_order: 2,
        options: [
          { option_text: "Photosynthesis", is_correct: true },
        ],
      };
      expect(isUnkeyed(q)).toBe(false);
    });

    it("SHORT_ANSWER: never unkeyed (manual grading; badge never shown)", () => {
      const qEmpty: QuizQuestionDraft = {
        id: "3",
        question_text: "Essay question",
        question_type: "SHORT_ANSWER",
        points: "5",
        display_order: 3,
        options: [],
      };
      expect(isUnkeyed(qEmpty)).toBe(false);

      const qWithExplanation: QuizQuestionDraft = {
        id: "3",
        question_text: "Essay question",
        question_type: "SHORT_ANSWER",
        points: "5",
        display_order: 3,
        explanation: "Sample rubric",
        options: [],
      };
      expect(isUnkeyed(qWithExplanation)).toBe(false);
    });
  });

  describe("normalizeIncomingQuestion (backend coercion mirror)", () => {
    it("coerces SHORT_ANSWER with non-blank options into IDENTIFICATION with is_correct: true", () => {
      const raw = {
        question_text: "What is the capital of France?",
        question_type: "SHORT_ANSWER" as const,
        options: [
          { option_text: "Paris", is_correct: false },
          { option_text: "paris", is_correct: false },
        ],
      };
      const normalized = normalizeIncomingQuestion(raw);
      expect(normalized.question_type).toBe("IDENTIFICATION");
      expect(normalized.options).toHaveLength(2);
      expect(normalized.options.every((o) => o.is_correct)).toBe(true);
    });

    it("leaves SHORT_ANSWER with empty options as SHORT_ANSWER with options: []", () => {
      const raw = {
        question_text: "Discuss the themes of Hamlet.",
        question_type: "SHORT_ANSWER" as const,
        options: [],
      };
      const normalized = normalizeIncomingQuestion(raw);
      expect(normalized.question_type).toBe("SHORT_ANSWER");
      expect(normalized.options).toEqual([]);
    });

    it("leaves SHORT_ANSWER with only whitespace options as SHORT_ANSWER with options: []", () => {
      const raw = {
        question_text: "Discuss Hamlet.",
        question_type: "SHORT_ANSWER" as const,
        options: [{ option_text: "   ", is_correct: false }],
      };
      const normalized = normalizeIncomingQuestion(raw);
      expect(normalized.question_type).toBe("SHORT_ANSWER");
      expect(normalized.options).toEqual([]);
    });

    it("preserves MULTIPLE_CHOICE and IDENTIFICATION question types", () => {
      const mc = {
        question_text: "MC Question",
        question_type: "MULTIPLE_CHOICE" as const,
        options: [{ option_text: "A", is_correct: true }],
      };
      expect(normalizeIncomingQuestion(mc).question_type).toBe("MULTIPLE_CHOICE");

      const id = {
        question_text: "ID Question",
        question_type: "IDENTIFICATION" as const,
        options: [{ option_text: "Term", is_correct: true }],
      };
      expect(normalizeIncomingQuestion(id).question_type).toBe("IDENTIFICATION");
    });

    it("normalizeIncomingQuestions processes arrays accurately", () => {
      const list = [
        { question_text: "Q1", question_type: "SHORT_ANSWER" as const, options: [{ option_text: "Key", is_correct: false }] },
        { question_text: "Q2", question_type: "SHORT_ANSWER" as const, options: [] },
      ];
      const res = normalizeIncomingQuestions(list);
      expect(res[0].question_type).toBe("IDENTIFICATION");
      expect(res[1].question_type).toBe("SHORT_ANSWER");
    });
  });

  describe("checkPublishReadiness", () => {
    it("allows saving drafts regardless of unkeyed IDENTIFICATION questions", () => {
      const questions: QuizQuestionDraft[] = [
        { id: "1", question_text: "Q1", question_type: "IDENTIFICATION", points: "1", display_order: 1, options: [] },
      ];
      const readiness = checkPublishReadiness(questions, false);
      expect(readiness.canProceed).toBe(true);
      expect(readiness.unkeyedIdentificationCount).toBe(1);
    });

    it("blocks publishing when any IDENTIFICATION question has no non-blank key", () => {
      const questions: QuizQuestionDraft[] = [
        { id: "1", question_text: "Q1", question_type: "IDENTIFICATION", points: "1", display_order: 1, options: [] },
        { id: "2", question_text: "Q2", question_type: "IDENTIFICATION", points: "1", display_order: 2, options: [{ option_text: "   ", is_correct: true }] },
        { id: "3", question_text: "Q3", question_type: "MULTIPLE_CHOICE", points: "1", display_order: 3, options: [{ option_text: "A", is_correct: true }] },
      ];
      const readiness = checkPublishReadiness(questions, true);
      expect(readiness.canProceed).toBe(false);
      expect(readiness.unkeyedIdentificationCount).toBe(2);
      expect(readiness.errorMessage).toContain("2 identification question(s) need at least one non-blank answer key");
    });

    it("allows publishing when all IDENTIFICATION questions have valid keys", () => {
      const questions: QuizQuestionDraft[] = [
        { id: "1", question_text: "Q1", question_type: "IDENTIFICATION", points: "1", display_order: 1, options: [{ option_text: "Mitochondria", is_correct: true }] },
        { id: "2", question_text: "Q2", question_type: "SHORT_ANSWER", points: "5", display_order: 2, options: [] },
        { id: "3", question_text: "Q3", question_type: "MULTIPLE_CHOICE", points: "1", display_order: 3, options: [{ option_text: "A", is_correct: true }, { option_text: "B", is_correct: false }] },
      ];
      const readiness = checkPublishReadiness(questions, true);
      expect(readiness.canProceed).toBe(true);
      expect(readiness.unkeyedIdentificationCount).toBe(0);
      expect(readiness.errorMessage).toBeUndefined();
    });
  });

  describe("switchQuestionType without data loss", () => {
    it("IDENTIFICATION to SHORT_ANSWER: moves first key into sample answer / explanation when explanation is empty", () => {
      const q: QuizQuestionDraft = {
        id: "1",
        question_text: "Define osmosis",
        question_type: "IDENTIFICATION",
        points: "1",
        display_order: 1,
        explanation: "",
        options: [
          { option_text: "Diffusion of water", is_correct: true },
          { option_text: "Water diffusion", is_correct: true },
        ],
      };
      const switched = switchQuestionType(q, "SHORT_ANSWER");
      expect(switched.question_type).toBe("SHORT_ANSWER");
      expect(switched.explanation).toBe("Diffusion of water");
      expect(switched.options).toEqual([]);
    });

    it("IDENTIFICATION to SHORT_ANSWER: asks confirmation if explanation is non-empty and overwrites when confirmed", () => {
      const q: QuizQuestionDraft = {
        id: "1",
        question_text: "Define osmosis",
        question_type: "IDENTIFICATION",
        points: "1",
        display_order: 1,
        explanation: "Existing rubric",
        options: [{ option_text: "Diffusion of water", is_correct: true }],
      };
      const confirmSpy = vi.fn().mockReturnValue(true);
      const switched = switchQuestionType(q, "SHORT_ANSWER", { confirmOverwrite: confirmSpy });
      expect(confirmSpy).toHaveBeenCalled();
      expect(switched.explanation).toBe("Diffusion of water");
      expect(switched.options).toEqual([]);
    });

    it("IDENTIFICATION to SHORT_ANSWER: keeps existing explanation when confirmation is declined", () => {
      const q: QuizQuestionDraft = {
        id: "1",
        question_text: "Define osmosis",
        question_type: "IDENTIFICATION",
        points: "1",
        display_order: 1,
        explanation: "Existing rubric",
        options: [{ option_text: "Diffusion of water", is_correct: true }],
      };
      const confirmSpy = vi.fn().mockReturnValue(false);
      const switched = switchQuestionType(q, "SHORT_ANSWER", { confirmOverwrite: confirmSpy });
      expect(confirmSpy).toHaveBeenCalled();
      expect(switched.explanation).toBe("Existing rubric");
      expect(switched.options).toEqual([]);
    });

    it("SHORT_ANSWER to IDENTIFICATION: preserves existing explanation and creates one empty key option", () => {
      const q: QuizQuestionDraft = {
        id: "1",
        question_text: "Essay prompt",
        question_type: "SHORT_ANSWER",
        points: "5",
        display_order: 1,
        explanation: "Rubric notes",
        options: [],
      };
      const switched = switchQuestionType(q, "IDENTIFICATION");
      expect(switched.question_type).toBe("IDENTIFICATION");
      expect(switched.explanation).toBe("Rubric notes");
      expect(switched.options).toHaveLength(1);
      expect(switched.options[0].option_text).toBe("");
      expect(switched.options[0].is_correct).toBe(true);
    });
  });

  describe("AI response mapping (mapGeneratedQuizQuestions)", () => {
    it("maps IDENTIFICATION with keys and sets is_ai_generated: true", () => {
      const apiQuestions = [
        {
          question_text: "What organelle produces ATP?",
          question_type: "IDENTIFICATION" as const,
          points: 1,
          display_order: 1,
          explanation: "Mitochondria generates ATP",
          options: [
            { option_text: "Mitochondria", is_correct: true, option_order: 1 },
            { option_text: "mitochondrion", is_correct: true, option_order: 2 },
          ],
        },
      ];
      const drafts = mapGeneratedQuizQuestions(apiQuestions);
      expect(drafts).toHaveLength(1);
      expect(drafts[0].question_type).toBe("IDENTIFICATION");
      expect(drafts[0].is_ai_generated).toBe(true);
      expect(drafts[0].options).toHaveLength(2);
      expect(drafts[0].options[0].option_text).toBe("Mitochondria");
      expect(drafts[0].options[0].is_correct).toBe(true);
      expect(drafts[0].options[1].option_text).toBe("mitochondrion");
      expect(drafts[0].options[1].is_correct).toBe(true);
      expect(drafts[0].explanation).toBe("Mitochondria generates ATP");
    });

    it("maps SHORT_ANSWER with explanation as sample answer and empty options, with is_ai_generated: true", () => {
      const apiQuestions = [
        {
          question_text: "Explain photosynthesis in your own words.",
          question_type: "SHORT_ANSWER" as const,
          points: 5,
          display_order: 1,
          explanation: "Sample answer: Process by which plants use sunlight to produce glucose.",
          options: [],
        },
      ];
      const drafts = mapGeneratedQuizQuestions(apiQuestions);
      expect(drafts).toHaveLength(1);
      expect(drafts[0].question_type).toBe("SHORT_ANSWER");
      expect(drafts[0].is_ai_generated).toBe(true);
      expect(drafts[0].options).toEqual([]);
      expect(drafts[0].explanation).toContain("Process by which plants use sunlight");
    });

    it("handles fallback empty option for IDENTIFICATION if AI returned empty options", () => {
      const apiQuestions = [
        {
          question_text: "Identify the author of Hamlet.",
          question_type: "IDENTIFICATION" as const,
          points: 1,
          options: [],
        },
      ];
      const drafts = mapGeneratedQuizQuestions(apiQuestions);
      expect(drafts[0].options).toHaveLength(1);
      expect(drafts[0].options[0].option_text).toBe("");
      expect(drafts[0].options[0].is_correct).toBe(true);
      expect(drafts[0].is_ai_generated).toBe(true);
    });

    it("preserves response warnings cleanly when passed through", () => {
      const warnings = ["1 question(s) discarded: no answer key"];
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain("discarded: no answer key");
    });
  });
});

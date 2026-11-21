import { describe, expect, it } from "vitest";

import type { QuizQuestionDraft } from "./quiz-builder-types";
import {
  applyBulkQuestionLessonAssignment,
  assignSelectedQuestionsToLesson,
  clearQuestionMappingsForLesson,
  getQuizLessonMappingState,
  mapQuestionsToSingleLinkedLesson,
  mapUnmappedQuestionsToLesson,
  sanitizeQuestionLessonId,
  selectUnmappedQuestionIds,
} from "./quiz-question-rules";

const question = (
  id: string,
  lessonId: number | null,
): QuizQuestionDraft => ({
  id,
  lesson_id: lessonId,
  question_text: `Question ${id}`,
  question_type: "MULTIPLE_CHOICE",
  points: "1",
  display_order: Number(id),
  difficulty_level: "EASY",
  explanation: "",
  options: [
    { option_text: "Correct", is_correct: true, option_order: 1 },
    { option_text: "Incorrect", is_correct: false, option_order: 2 },
  ],
});

describe("quiz lesson mapping helpers", () => {
  it("shows only select all when every question is unmapped", () => {
    const questions = Array.from({ length: 10 }, (_, index) =>
      question(String(index + 1), null),
    );
    const selected = new Set(questions.map((item) => item.id));
    const state = getQuizLessonMappingState(questions, [10], selected);

    expect(state).toMatchObject({
      totalCount: 10,
      mappedCount: 0,
      unmappedCount: 10,
      selectedCount: 10,
      allSelected: true,
      someSelected: false,
      showSelectUnmapped: false,
    });
  });

  it("maps only unmapped questions when one lesson is linked", () => {
    const result = mapUnmappedQuestionsToLesson(
      [question("1", null), question("2", 20)],
      10,
    );

    expect(result.map((item) => item.lesson_id)).toEqual([10, 10]);
  });

  it("maps imported questions to the only linked lesson but preserves multi-lesson choices", () => {
    const questions = [question("1", null), question("2", 20)];

    expect(
      mapQuestionsToSingleLinkedLesson(questions, [10]).map(
        (item) => item.lesson_id,
      ),
    ).toEqual([10, 10]);
    expect(mapQuestionsToSingleLinkedLesson(questions, [10, 20])).toBe(
      questions,
    );
  });

  it("bulk assigns only the selected subset to one primary lesson", () => {
    const result = assignSelectedQuestionsToLesson(
      [question("1", null), question("2", 20), question("3", null)],
      new Set(["1", "3"]),
      10,
    );

    expect(result.map((item) => item.lesson_id)).toEqual([10, 20, 10]);
  });

  it("clears question selection after a successful bulk assignment", () => {
    const result = applyBulkQuestionLessonAssignment(
      [question("1", null), question("2", null)],
      new Set(["1", "2"]),
      10,
    );

    expect(result.questions.map((item) => item.lesson_id)).toEqual([10, 10]);
    expect(result.selectedQuestionIds.size).toBe(0);
  });

  it("selects only questions without a mapping inside current coverage", () => {
    const selected = selectUnmappedQuestionIds(
      [question("1", null), question("2", 10), question("3", 30)],
      [10, 20],
    );

    expect([...selected]).toEqual(["1", "3"]);
  });

  it("shows select unmapped only for partially completed mapping", () => {
    const questions = [
      ...Array.from({ length: 5 }, (_, index) =>
        question(String(index + 1), 10),
      ),
      ...Array.from({ length: 5 }, (_, index) =>
        question(String(index + 6), null),
      ),
    ];
    const selected = selectUnmappedQuestionIds(questions, [10, 20]);
    const state = getQuizLessonMappingState(questions, [10, 20], selected);

    expect([...selected]).toEqual(["6", "7", "8", "9", "10"]);
    expect(state).toMatchObject({
      mappedCount: 5,
      unmappedCount: 5,
      selectedCount: 5,
      allSelected: false,
      someSelected: true,
      showSelectUnmapped: true,
    });
  });

  it("hides unmapped guidance after all questions are mapped", () => {
    const state = getQuizLessonMappingState(
      [question("1", 10), question("2", 20)],
      [10, 20],
    );

    expect(state).toMatchObject({
      mappedCount: 2,
      unmappedCount: 0,
      showSelectUnmapped: false,
    });
  });

  it("allows every question to map to one lesson in multi-lesson coverage", () => {
    const state = getQuizLessonMappingState(
      [question("1", 10), question("2", 10)],
      [10, 20],
    );

    expect(state).toMatchObject({ mappedCount: 2, unmappedCount: 0 });
    expect(state).not.toHaveProperty("lessonIdsWithoutMappedQuestions");
  });

  it("ignores stale selected ids when calculating checkbox state and count", () => {
    const state = getQuizLessonMappingState(
      [question("1", null), question("2", null)],
      [10],
      new Set(["1", "removed-question"]),
    );

    expect(state.selectedCount).toBe(1);
    expect(state.allSelected).toBe(false);
    expect(state.someSelected).toBe(true);
  });

  it("clears only mappings for a removed lesson", () => {
    const result = clearQuestionMappingsForLesson(
      [question("1", 10), question("2", 20), question("3", null)],
      10,
    );

    expect(result.map((item) => item.lesson_id)).toEqual([null, 20, null]);
  });

  it("never submits a question mapping outside linked coverage", () => {
    expect(sanitizeQuestionLessonId(10, [10, 20])).toBe(10);
    expect(sanitizeQuestionLessonId(30, [10, 20])).toBeNull();
    expect(sanitizeQuestionLessonId(null, [10, 20])).toBeNull();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import QuizAnalysisView from "./quiz-analysis-view";
import type { QuizAnalysis } from "./quiz-builder-types";
import type { TeacherClasswork } from "@/types/classwork";

afterEach(cleanup);

const selected: TeacherClasswork = {
  classwork_id: 7,
  title: "Quiz Detail",
  classwork_type: "QUIZ",
  total_points: 10,
  is_published: true,
  show_scores: true,
  is_locked: false,
  is_archived: false,
  subject_id: 2,
  attachments: [],
};

const analysis: QuizAnalysis = {
  quiz_id: 3,
  classwork_id: 7,
  title: "Quiz Detail",
  total_points: 10,
  total_students: 5,
  submitted_count: 4,
  missing_count: 1,
  graded_count: 2,
  needs_grading_count: 2,
  questions: [],
  students: [
    {
      student_id: "1",
      student_name: "Ana Maria Van Dyke",
      first_name: "Ana Maria",
      middle_name: "Louise",
      last_name: "Van Dyke",
      submission_id: 11,
      status: "graded",
      attempt_count: 1,
      grade: 9,
      score_percent: 90,
      needs_grading: false,
      answers: [],
    },
    {
      student_id: "2",
      student_name: "Zoe Cruz",
      first_name: "Zoe",
      last_name: "Cruz",
      submission_id: 12,
      status: "late",
      attempt_count: 1,
      grade: null,
      score_percent: null,
      needs_grading: true,
      answers: [],
    },
    {
      student_id: "3",
      student_name: "Bea De la Rosa",
      first_name: "Bea",
      last_name: "De la Rosa",
      submission_id: null,
      status: "not_submitted",
      attempt_count: 0,
      grade: null,
      score_percent: null,
      needs_grading: false,
      answers: [],
    },
    {
      student_id: "4",
      student_name: "Ian Flores",
      first_name: "Ian",
      last_name: "Flores",
      submission_id: 13,
      status: "pending",
      attempt_count: 1,
      grade: null,
      score_percent: null,
      needs_grading: false,
      answers: [],
    },
    {
      student_id: "5",
      student_name: "Aaron Able",
      first_name: "Aaron",
      last_name: "Able",
      submission_id: 14,
      status: "graded",
      attempt_count: 1,
      grade: 0,
      score_percent: 0,
      needs_grading: false,
      answers: [],
    },
  ],
};

describe("quiz analysis student filters", () => {
  it("uses compact status dropdowns and defaults Name sorting to surname A-Z", () => {
    render(
      <QuizAnalysisView
        quizAnalysis={analysis}
        isQuizAnalysisLoading={false}
        quizAnalysisError=""
        selected={selected}
        setSelectedGradingSubmissionId={vi.fn()}
      />,
    );

    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByRole("tab", { name: /Overview/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Questions/ })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Students/ })).toBeNull();
    expect(screen.getByText("3 of 5")).toBeTruthy();
    expect(screen.getByText("45%")).toBeTruthy();

    expect(screen.getByRole("combobox", { name: "Submission Status" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Grading Status" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Sort By" }).textContent).toContain("Name");
    expect(screen.getAllByRole("columnheader").map((header) => header.textContent)).toEqual([
      "Student Name",
      "Submission Status",
      "Question Indicators",
      "Accuracy",
      "Points",
      "Score",
      "Action",
    ]);

    const able = screen.getByText("Able, Aaron");
    const cruz = screen.getByText("Cruz, Zoe");
    const deLaRosa = screen.getByText("De la Rosa, Bea");
    const flores = screen.getByText("Flores, Ian");
    const vanDyke = screen.getByText("Van Dyke, Ana Maria L.");
    expect(able.compareDocumentPosition(cruz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(cruz.compareDocumentPosition(deLaRosa) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(deLaRosa.compareDocumentPosition(flores) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(flores.compareDocumentPosition(vanDyke) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText("In Progress")).toBeTruthy();
    expect(screen.getByText("Not Submitted")).toBeTruthy();
    const ableCells = within(able.closest("tr")!).getAllByRole("cell");
    expect(ableCells).toHaveLength(7);
    expect(ableCells[1].textContent).toContain("On Time");
    expect(ableCells[3].textContent).toBe("0%");
    expect(ableCells[4].textContent).toBe("0/10");
    expect(screen.queryByText("No score")).toBeNull();
  });

  it("keeps wide question indicators aligned inside the table scroll container", () => {
    const manyQuestions: QuizAnalysis = {
      ...analysis,
      total_students: 1,
      students: [analysis.students[0]],
      questions: Array.from({ length: 25 }, (_, index) => ({
        quiz_question_id: index + 1,
        question_text: `Question ${index + 1}`,
        question_type: "SHORT_ANSWER",
        points: 1,
        answered_count: 0,
        correct_count: 0,
        accuracy_percent: null,
        needs_grading_count: 0,
        option_distribution: [],
      })),
    };

    render(
      <QuizAnalysisView
        quizAnalysis={manyQuestions}
        isQuizAnalysisLoading={false}
        quizAnalysisError=""
        selected={selected}
        setSelectedGradingSubmissionId={vi.fn()}
      />,
    );

    const table = screen.getByTestId("quiz-overview-student-table");
    const indicators = screen.getByTestId("question-indicators-1");
    expect(table.parentElement?.className).toContain("overflow-x-auto");
    expect(within(indicators).getAllByTitle(/^Question \d+$/)).toHaveLength(25);
  });

  it("uses completed evaluated attempts for question accuracy and shows no-result states", () => {
    const analysisWithQuestions: QuizAnalysis = {
      ...analysis,
      questions: [
        {
          quiz_question_id: 101,
          question_text: "Completed answers only",
          question_type: "SHORT_ANSWER",
          points: 5,
          answered_count: 3,
          correct_count: 2,
          accuracy_percent: 66.67,
          needs_grading_count: 0,
          option_distribution: [],
        },
        {
          quiz_question_id: 102,
          question_text: "Pending answer only",
          question_type: "SHORT_ANSWER",
          points: 5,
          answered_count: 1,
          correct_count: 1,
          accuracy_percent: 100,
          needs_grading_count: 0,
          option_distribution: [],
        },
      ],
      students: analysis.students.map((student) => ({
        ...student,
        answers: student.student_id === "1"
          ? [{ quiz_question_id: 101, is_correct: true, points_awarded: 5 }]
          : student.student_id === "5"
            ? [{ quiz_question_id: 101, is_correct: false, points_awarded: 0 }]
            : student.student_id === "4"
              ? [
                { quiz_question_id: 101, is_correct: true, points_awarded: 5 },
                { quiz_question_id: 102, is_correct: true, points_awarded: 5 },
              ]
              : [],
      })),
    };

    render(
      <QuizAnalysisView
        quizAnalysis={analysisWithQuestions}
        isQuizAnalysisLoading={false}
        quizAnalysisError=""
        selected={selected}
        setSelectedGradingSubmissionId={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: /Questions/ }));

    const completedQuestion = screen.getByTestId("question-accuracy-101");
    const pendingOnlyQuestion = screen.getByTestId("question-accuracy-102");
    expect(within(completedQuestion).getByText("50%")).toBeTruthy();
    expect(within(pendingOnlyQuestion).getByText("No results yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Jump to question 1 (50% accuracy)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Jump to question 2 (No results yet)" })).toBeTruthy();
  });
});

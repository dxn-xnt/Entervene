// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  computeLessonMastery,
  computeLessonCompletion,
  computeSubjectLessonMastery,
  type MasteryClassworkInput,
} from "@/lib/student-lesson-mastery";
import { StudentLessonMastery } from "@/components/student-lesson-mastery";
import type { StudentLesson } from "@/types/student-subject";

afterEach(() => {
  cleanup();
});

describe("Student Lesson Mastery Calculation Engine", () => {
  const dummyLesson1: StudentLesson = {
    lesson_id: 1,
    title: "Lesson 1: Introduction",
    subject_id: 10,
    is_published: true,
    show_scores: true,
    attachments: [],
  };

  const dummyLesson2: StudentLesson = {
    lesson_id: 2,
    title: "Lesson 2: Advanced Concepts",
    subject_id: 10,
    is_published: true,
    show_scores: true,
    attachments: [],
  };

  it("Scenario 1: New lesson with no graded assessment displays 'Not yet rated' with no invented percentage", () => {
    const items: MasteryClassworkInput[] = [];
    const mastery = computeLessonMastery(items);
    const completion = computeLessonCompletion(items);

    expect(mastery.id).toBe("not_yet_rated");
    expect(mastery.label).toBe("Not yet rated");
    expect(mastery.percentage).toBeNull();
    expect(mastery.gradedCount).toBe(0);
    expect(completion.totalCount).toBe(0);
    expect(completion.completedCount).toBe(0);
  });

  it("Scenario 2: Lesson with one graded quiz displays accurate calculated mastery percentage and level", () => {
    const items: MasteryClassworkInput[] = [
      {
        assignment_id: 101,
        title: "Poetry Quiz",
        classwork_type: "QUIZ",
        is_graded: true,
        show_scores: true,
        total_points: 20,
        grade: 18,
        submission_status: "graded",
      },
    ];
    const mastery = computeLessonMastery(items);
    expect(mastery.percentage).toBe(90);
    expect(mastery.id).toBe("high");
    expect(mastery.label).toBe("High");
    expect(mastery.earnedPoints).toBe(18);
    expect(mastery.possiblePoints).toBe(20);
  });

  it("Scenario 3: Lesson with graded quiz and activity combines points accurately", () => {
    const items: MasteryClassworkInput[] = [
      {
        assignment_id: 101,
        title: "Quiz 1",
        classwork_type: "QUIZ",
        is_graded: true,
        show_scores: true,
        total_points: 20,
        grade: 18,
        submission_status: "graded",
      },
      {
        assignment_id: 102,
        title: "Activity 1",
        classwork_type: "ACTIVITY",
        is_graded: true,
        show_scores: true,
        total_points: 50,
        grade: 40,
        submission_status: "graded",
      },
    ];
    const mastery = computeLessonMastery(items);
    // 58 / 70 = 82.857... -> 83%
    expect(mastery.earnedPoints).toBe(58);
    expect(mastery.possiblePoints).toBe(70);
    expect(mastery.percentage).toBe(83);
    expect(mastery.id).toBe("high");
  });

  it("Scenario 4: Lesson with pending assignment separates completion from mastery ('Not yet rated')", () => {
    const items: MasteryClassworkInput[] = [
      {
        assignment_id: 103,
        title: "Pending Essay",
        classwork_type: "ASSIGNMENT",
        is_graded: true,
        show_scores: true,
        total_points: 50,
        grade: null,
        submission_status: "pending",
        is_submitted: false,
      },
    ];
    const mastery = computeLessonMastery(items);
    const completion = computeLessonCompletion(items);

    expect(mastery.id).toBe("not_yet_rated");
    expect(mastery.percentage).toBeNull();
    expect(completion.totalCount).toBe(1);
    expect(completion.completedCount).toBe(0);
    expect(completion.pendingCount).toBe(1);
  });

  it("Scenario 5: Subject with multiple lessons calculates accurate aggregate mastery across lessons", () => {
    const lessons = [dummyLesson1, dummyLesson2];
    const assignmentIdsByLesson = {
      1: [201],
      2: [202],
    };
    const classworks: MasteryClassworkInput[] = [
      {
        assignment_id: 201,
        classwork_type: "QUIZ",
        is_graded: true,
        show_scores: true,
        total_points: 50,
        grade: 35, // 70% Moderate
        submission_status: "graded",
      },
      {
        assignment_id: 202,
        classwork_type: "ACTIVITY",
        is_graded: true,
        show_scores: true,
        total_points: 50,
        grade: 45, // 90% High
        submission_status: "graded",
      },
    ];

    const result = computeSubjectLessonMastery(lessons, assignmentIdsByLesson, classworks);
    // Combined: (35 + 45) / (50 + 50) = 80 / 100 = 80% -> High
    expect(result.aggregate.earnedPoints).toBe(80);
    expect(result.aggregate.possiblePoints).toBe(100);
    expect(result.aggregate.percentage).toBe(80);
    expect(result.aggregate.id).toBe("high");

    // Per lesson breakdown
    expect(result.perLesson[0].mastery.percentage).toBe(70);
    expect(result.perLesson[0].mastery.id).toBe("moderate");
    expect(result.perLesson[1].mastery.percentage).toBe(90);
    expect(result.perLesson[1].mastery.id).toBe("high");
  });

  it("Scenario 6: Grade updates accurately recompute mastery", () => {
    const item: MasteryClassworkInput = {
      assignment_id: 301,
      classwork_type: "QUIZ",
      is_graded: true,
      show_scores: true,
      total_points: 100,
      grade: 40, // 40% Low
      submission_status: "graded",
    };
    const lowMastery = computeLessonMastery([item]);
    expect(lowMastery.id).toBe("low");
    expect(lowMastery.percentage).toBe(40);

    // Grade changes to 85%
    const updatedItem = { ...item, grade: 85 };
    const highMastery = computeLessonMastery([updatedItem]);
    expect(highMastery.id).toBe("high");
    expect(highMastery.percentage).toBe(85);
  });

  it("Scenario 7: Classwork with no lesson link is excluded from lesson mastery", () => {
    const lessons = [dummyLesson1];
    const assignmentIdsByLesson = {
      1: [401], // Only 401 is linked to Lesson 1
    };
    const classworks: MasteryClassworkInput[] = [
      {
        assignment_id: 401,
        title: "Lesson-linked Quiz",
        classwork_type: "QUIZ",
        is_graded: true,
        show_scores: true,
        total_points: 20,
        grade: 20,
        submission_status: "graded",
      },
      {
        assignment_id: 999, // Unlinked standalone classwork
        title: "Standalone General Classwork",
        classwork_type: "ASSIGNMENT",
        is_graded: true,
        show_scores: true,
        total_points: 100,
        grade: 10,
        submission_status: "graded",
      },
    ];

    const result = computeSubjectLessonMastery(lessons, assignmentIdsByLesson, classworks);
    // Unlinked 999 must not affect Lesson 1 or Subject Lesson aggregate
    expect(result.aggregate.earnedPoints).toBe(20);
    expect(result.aggregate.possiblePoints).toBe(20);
    expect(result.aggregate.percentage).toBe(100);
  });

  it("Scenario 8: Multi-lesson linked classworks are counted once in subject aggregate (no double-counting)", () => {
    const lessons = [dummyLesson1, dummyLesson2];
    // Shared classwork 501 linked to both lesson 1 and lesson 2
    const assignmentIdsByLesson = {
      1: [501],
      2: [501],
    };
    const classworks: MasteryClassworkInput[] = [
      {
        assignment_id: 501,
        title: "Multi-lesson Quiz",
        classwork_type: "QUIZ",
        is_graded: true,
        show_scores: true,
        total_points: 40,
        grade: 36, // 90%
        submission_status: "graded",
      },
    ];

    const result = computeSubjectLessonMastery(lessons, assignmentIdsByLesson, classworks);
    // Aggregate must deduplicate: earned=36, possible=40 (NOT 72/80)
    expect(result.aggregate.earnedPoints).toBe(36);
    expect(result.aggregate.possiblePoints).toBe(40);
    expect(result.aggregate.percentage).toBe(90);
  });
});

describe("StudentLessonMastery Component UI", () => {
  it("Scenario 10: Renders non-interactive mastery indicator that cannot be manually cycled by clicking", () => {
    const lessons: StudentLesson[] = [
      {
        lesson_id: 1,
        title: "Elements of Poetry",
        subject_id: 10,
        is_published: true,
        show_scores: true,
        attachments: [],
      },
    ];
    const assignmentIdsByLesson = { 1: [101] };
    const classworks: MasteryClassworkInput[] = [
      {
        assignment_id: 101,
        title: "Poetry Quiz",
        classwork_type: "QUIZ",
        is_graded: true,
        show_scores: true,
        total_points: 20,
        grade: 19,
        submission_status: "graded",
      },
    ];

    render(
      <StudentLessonMastery
        lessons={lessons}
        assignmentIdsByLesson={assignmentIdsByLesson}
        classworks={classworks}
      />,
    );

    // Shows 95% High
    expect(screen.getByText("Lesson Mastery")).toBeDefined();
    expect(screen.getByText("High (95%)")).toBeDefined();
    expect(screen.getByTestId("subject-mastery-badge").textContent).toBe("High · 95%");

    // Verify clicking does not change mastery (it is non-interactive)
    const summaryCard = screen.getByTestId("subject-mastery-summary");
    fireEvent.click(summaryCard);

    // Percentage and label remain identical (no manual cycling)
    expect(screen.getByText("High (95%)")).toBeDefined();
    expect(screen.getByTestId("subject-mastery-badge").textContent).toBe("High · 95%");
  });

  it("Scenario 9: Subject or academic period switch updates displayed data without stale bleeding", () => {
    const lessonsPeriod1: StudentLesson[] = [
      {
        lesson_id: 1,
        title: "Term 1 Poetry",
        subject_id: 10,
        is_published: true,
        show_scores: true,
        attachments: [],
      },
    ];
    const classworksPeriod1: MasteryClassworkInput[] = [
      {
        assignment_id: 101,
        classwork_type: "QUIZ",
        is_graded: true,
        show_scores: true,
        total_points: 20,
        grade: 18, // 90%
        submission_status: "graded",
      },
    ];

    const lessonsPeriod2: StudentLesson[] = [
      {
        lesson_id: 2,
        title: "Term 2 Prose",
        subject_id: 10,
        is_published: true,
        show_scores: true,
        attachments: [],
      },
    ];
    const classworksPeriod2: MasteryClassworkInput[] = [
      {
        assignment_id: 201,
        classwork_type: "ACTIVITY",
        is_graded: true,
        show_scores: true,
        total_points: 100,
        grade: 60, // 60% Moderate
        submission_status: "graded",
      },
    ];

    const { rerender } = render(
      <StudentLessonMastery
        lessons={lessonsPeriod1}
        assignmentIdsByLesson={{ 1: [101] }}
        classworks={classworksPeriod1}
      />,
    );

    expect(screen.getByText("Term 1 Poetry")).toBeDefined();
    expect(screen.getByText("High (90%)")).toBeDefined();

    // Switch to Period 2
    rerender(
      <StudentLessonMastery
        lessons={lessonsPeriod2}
        assignmentIdsByLesson={{ 2: [201] }}
        classworks={classworksPeriod2}
      />,
    );

    expect(screen.queryByText("Term 1 Poetry")).toBeNull();
    expect(screen.getByText("Term 2 Prose")).toBeDefined();
    expect(screen.getByText("Moderate (60%)")).toBeDefined();
  });
});

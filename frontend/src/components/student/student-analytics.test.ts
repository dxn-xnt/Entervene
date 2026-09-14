import { describe, expect, it } from "vitest";
import {
  computeCompletion,
  computeDistribution,
  computeSubjectPerformance,
  donutSegments,
} from "./student-analytics";
import type { TodoItem } from "@/lib/api";

describe("student-analytics: computeCompletion", () => {
  it("returns 0% when no todos exist", () => {
    const res = computeCompletion([]);
    expect(res).toEqual({ total: 0, completed: 0, rate: 0 });
  });

  it("calculates rate based on completed, submitted, or graded tasks", () => {
    const mockTodos: TodoItem[] = [
      {
        assignment_id: 1,
        classwork_id: 1,
        title: "Task 1",
        subject: "Math",
        subject_id: 101,
        deadline: "Today",
        status: "completed",
        is_submitted: true,
        grade: 90,
        total_points: 100,
        is_graded: true,
        type: "ASSIGNMENT",
      },
      {
        assignment_id: 2,
        classwork_id: 2,
        title: "Task 2",
        subject: "Science",
        subject_id: 102,
        deadline: "Tomorrow",
        status: "pending",
        is_submitted: false,
        grade: null,
        total_points: 50,
        is_graded: false,
        type: "QUIZ",
      },
      {
        assignment_id: 3,
        classwork_id: 3,
        title: "Task 3",
        subject: "English",
        subject_id: 103,
        deadline: "Yesterday",
        status: "pastdue",
        is_submitted: true,
        grade: null,
        total_points: 50,
        is_graded: false,
        type: "ACTIVITY",
      },
      {
        assignment_id: 4,
        classwork_id: 4,
        title: "Task 4",
        subject: "History",
        subject_id: 104,
        deadline: "Next week",
        status: "pending",
        is_submitted: false,
        grade: null,
        total_points: 20,
        is_graded: false,
        type: "ASSIGNMENT",
      },
    ];

    const res = computeCompletion(mockTodos);
    // 2 completed out of 4 -> 50%
    expect(res).toEqual({ total: 4, completed: 2, rate: 50 });
  });
});

describe("student-analytics: computeDistribution", () => {
  it("groups todos by classwork type", () => {
    const mockTodos: TodoItem[] = [
      { assignment_id: 1, classwork_id: 1, title: "A", subject: "Math", subject_id: 1, deadline: "", status: "pending", is_submitted: false, grade: null, total_points: 10, is_graded: false, type: "QUIZ" },
      { assignment_id: 2, classwork_id: 2, title: "B", subject: "Math", subject_id: 1, deadline: "", status: "pending", is_submitted: false, grade: null, total_points: 10, is_graded: false, type: "QUIZ" },
      { assignment_id: 3, classwork_id: 3, title: "C", subject: "Math", subject_id: 1, deadline: "", status: "pending", is_submitted: false, grade: null, total_points: 10, is_graded: false, type: "ASSIGNMENT" },
    ];

    const res = computeDistribution(mockTodos);
    expect(res).toEqual([
      { type: "QUIZ", count: 2, percent: 67 },
      { type: "ASSIGNMENT", count: 1, percent: 33 },
    ]);
  });
});

describe("student-analytics: computeSubjectPerformance", () => {
  it("computes average scores and sorts lowest score first for recommended attention", () => {
    const mockTodos: TodoItem[] = [
      // Math: 80/100 -> 80%
      { assignment_id: 1, classwork_id: 1, title: "M1", subject: "Math", subject_id: 1, deadline: "", status: "completed", is_submitted: true, grade: 80, total_points: 100, is_graded: true, type: "EXAM" },
      // Science: 50/100 -> 50%
      { assignment_id: 2, classwork_id: 2, title: "S1", subject: "Science", subject_id: 2, deadline: "", status: "completed", is_submitted: true, grade: 50, total_points: 100, is_graded: true, type: "QUIZ" },
      // English: 95/100 -> 95%
      { assignment_id: 3, classwork_id: 3, title: "E1", subject: "English", subject_id: 3, deadline: "", status: "completed", is_submitted: true, grade: 95, total_points: 100, is_graded: true, type: "PROJECT" },
      // Ungraded task should be ignored
      { assignment_id: 4, classwork_id: 4, title: "U1", subject: "History", subject_id: 4, deadline: "", status: "pending", is_submitted: false, grade: null, total_points: 100, is_graded: false, type: "ACTIVITY" },
    ];

    const res = computeSubjectPerformance(mockTodos);
    expect(res).toHaveLength(3);
    // Lowest first: Science (50%) -> Math (80%) -> English (95%)
    expect(res[0].subject).toBe("Science");
    expect(res[0].score).toBe(50);
    expect(res[1].subject).toBe("Math");
    expect(res[1].score).toBe(80);
    expect(res[2].subject).toBe("English");
    expect(res[2].score).toBe(95);
  });
});

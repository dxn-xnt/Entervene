import { describe, expect, it } from "vitest";
import { quizPathWithContext, quizReturnContext } from "./student-quiz-navigation";

describe("student quiz navigation", () => {
  const classwork = "/student/classworks/17?from=%2Fstudent%2Ftodo";
  const search = `?from=${encodeURIComponent(classwork)}`;

  it("returns to classwork after viewing results or submitting a quiz", () => {
    expect(quizReturnContext(search)).toEqual({ path: classwork, label: "Classwork" });
    expect(quizPathWithContext("/student/quiz/17/result", search)).toBe(`/student/quiz/17/result${search}`);
  });

  it("keeps direct and invalid links on the To Do fallback", () => {
    expect(quizReturnContext("")).toEqual({ path: "/student/todo", label: "To Do" });
    expect(quizReturnContext("?from=https%3A%2F%2Fexample.com")).toEqual({ path: "/student/todo", label: "To Do" });
    expect(quizPathWithContext("/student/quiz/17/result", "")).toBe("/student/quiz/17/result");
  });
});

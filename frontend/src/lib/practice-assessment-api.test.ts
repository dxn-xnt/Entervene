import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiFetch } from "@/lib/api";
import {
  getTeacherPracticeAssessment,
  PracticeAssessmentApiError,
  saveTeacherPracticeAssessment,
} from "./practice-assessment-api";

vi.mock("@/lib/api", () => ({ apiFetch: vi.fn() }));

const mockedApiFetch = vi.mocked(apiFetch);

const assessment = {
  practice_assessment_id: 12,
  intervention_id: 7,
  title: "Practice Assessment",
  status: "DRAFT",
  gatekeeper_policy: "REQUIRE_PASS",
  passing_percentage: 75,
  version: 1,
  questions: [],
};

beforeEach(() => mockedApiFetch.mockReset());

describe("getTeacherPracticeAssessment", () => {
  it("returns a valid assessment response", async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify(assessment), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(getTeacherPracticeAssessment(7)).resolves.toEqual(assessment);
  });

  it("returns null only for the backend's genuine missing-assessment 404", async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({
      detail: "Practice assessment not found for this intervention",
    }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(getTeacherPracticeAssessment(7)).resolves.toBeNull();
  });

  it.each([
    [401, "Not authenticated"],
    [403, "Teacher does not handle this intervention scope"],
    [404, "Not found"],
    [500, "Database unavailable"],
  ])("preserves a %i API failure", async (status, detail) => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({ detail }), {
      status,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(getTeacherPracticeAssessment(7)).rejects.toMatchObject({
      status,
      message: detail,
    });
  });

  it("rejects an unexpected successful response", async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({ title: "Incomplete" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await expect(getTeacherPracticeAssessment(7)).rejects.toBeInstanceOf(
      PracticeAssessmentApiError,
    );
  });

});

describe("saveTeacherPracticeAssessment", () => {
  it("sends settings, normalized questions, and publish intent in one request", async () => {
    mockedApiFetch.mockResolvedValue(new Response(JSON.stringify({
      ...assessment,
      status: "PUBLISHED",
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));

    await saveTeacherPracticeAssessment(7, {
      title: "Atomic assessment",
      passing_percentage: 85,
      gatekeeper_policy: "REQUIRE_ATTEMPT",
      publish: true,
      questions: [{
        question_text: "Question",
        question_type: "MULTIPLE_CHOICE",
        points: 2,
        explanation: "Explanation",
        display_order: 9,
        is_ai_generated: false,
        options: [
          { option_text: "Correct", is_correct: true, option_order: 7 },
          { option_text: "Wrong", is_correct: false, option_order: 8 },
        ],
      }],
    });

    expect(mockedApiFetch).toHaveBeenCalledWith(
      "/api/v1/teacher/interventions/7/practice-assessment/save",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({
          title: "Atomic assessment",
          passing_percentage: 85,
          gatekeeper_policy: "REQUIRE_ATTEMPT",
          publish: true,
          questions: [{
            question_text: "Question",
            question_type: "MULTIPLE_CHOICE",
            points: 2,
            explanation: "Explanation",
            display_order: 1,
            is_ai_generated: false,
            options: [
              { option_text: "Correct", is_correct: true, option_order: 1 },
              { option_text: "Wrong", is_correct: false, option_order: 2 },
            ],
          }],
        }),
      }),
    );
  });
});

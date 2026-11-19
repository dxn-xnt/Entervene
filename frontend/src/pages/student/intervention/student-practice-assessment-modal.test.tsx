// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudentPracticeAssessmentModal from "./student-practice-assessment-modal";

const apiMocks = vi.hoisted(() => ({
  getStudentPracticeAssessment: vi.fn(),
  listStudentPracticeAttempts: vi.fn(),
  getStudentPracticeAttemptFeedback: vi.fn(),
  startStudentPracticeAttempt: vi.fn(),
  saveStudentPracticeAttemptDraft: vi.fn(),
  submitStudentPracticeAttempt: vi.fn(),
}));

vi.mock("@/lib/practice-assessment-api", () => apiMocks);

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

describe("StudentPracticeAssessmentModal reading-cycle enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("disables Try Again and shows the Study Support reading-cycle lock reason after a failed attempt", async () => {
    apiMocks.getStudentPracticeAssessment.mockResolvedValue({
      practice_assessment_id: 11,
      title: "Linear Equations Practice",
      gatekeeper_policy: "REQUIRE_PASS",
      passing_percentage: 75,
      total_questions: 2,
      total_points: 2,
      attempts_count: 1,
      has_active_attempt: false,
      has_passed: false,
      best_score_percentage: 50,
      latest_score_percentage: 50,
      latest_attempt_number: 1,
      reading_review_cycle: 2,
      required_readings_count: 2,
      reviewed_readings_count: 0,
      reading_prerequisite_met: false,
      can_start_attempt: false,
      practice_lock_reason:
        "Review all assigned readings for this Study Support cycle before starting Practice Assessment.",
    });
    apiMocks.listStudentPracticeAttempts.mockResolvedValue([
      {
        attempt_id: 501,
        practice_assessment_id: 11,
        student_id: "student-1",
        attempt_number: 1,
        reading_review_cycle: 1,
        status: "SUBMITTED",
        total_score: 1,
        max_score: 2,
        score_percentage: 50,
        is_passed: false,
        started_at: "2026-11-20T00:00:00Z",
        completed_at: "2026-11-20T00:05:00Z",
      },
    ]);
    apiMocks.getStudentPracticeAttemptFeedback.mockResolvedValue({
      attempt_id: 501,
      attempt_number: 1,
      status: "SUBMITTED",
      total_score: 1,
      max_score: 2,
      score_percentage: 50,
      passing_percentage: 75,
      is_passed: false,
      eligible_for_remediation: false,
      completed_at: "2026-11-20T00:05:00Z",
      items: [],
    });

    render(
      <StudentPracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={7}
        initialMode="feedback"
      />,
    );

    const tryAgainButton = (await screen.findByRole("button", {
      name: /Try Again/i,
    })) as HTMLButtonElement;
    expect(tryAgainButton.disabled).toBe(true);
    expect(
      screen.getByText(
        "Review all assigned readings for this Study Support cycle before starting Practice Assessment.",
      ),
    ).toBeTruthy();
    expect(document.body.textContent ?? "").not.toMatch(/\bintervention\b/i);
  });

  it("hides Try Again once the student has passed the Practice Assessment", async () => {
    apiMocks.getStudentPracticeAssessment.mockResolvedValue({
      practice_assessment_id: 11,
      title: "Linear Equations Practice",
      gatekeeper_policy: "REQUIRE_PASS",
      passing_percentage: 75,
      total_questions: 2,
      total_points: 2,
      attempts_count: 2,
      has_active_attempt: false,
      has_passed: true,
      best_score_percentage: 100,
      latest_score_percentage: 100,
      latest_attempt_number: 2,
      reading_review_cycle: 2,
      required_readings_count: 2,
      reviewed_readings_count: 2,
      reading_prerequisite_met: true,
      can_start_attempt: false,
      practice_lock_reason: "Practice completed successfully.",
    });
    apiMocks.listStudentPracticeAttempts.mockResolvedValue([
      {
        attempt_id: 502,
        practice_assessment_id: 11,
        student_id: "student-1",
        attempt_number: 2,
        reading_review_cycle: 2,
        status: "SUBMITTED",
        total_score: 2,
        max_score: 2,
        score_percentage: 100,
        is_passed: true,
        started_at: "2026-11-20T00:10:00Z",
        completed_at: "2026-11-20T00:15:00Z",
      },
    ]);
    apiMocks.getStudentPracticeAttemptFeedback.mockResolvedValue({
      attempt_id: 502,
      attempt_number: 2,
      status: "SUBMITTED",
      total_score: 2,
      max_score: 2,
      score_percentage: 100,
      passing_percentage: 75,
      is_passed: true,
      eligible_for_remediation: true,
      completed_at: "2026-11-20T00:15:00Z",
      items: [],
    });

    render(
      <StudentPracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={7}
        initialMode="feedback"
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Study Support activity unlocked")).toBeTruthy();
    });
    expect(screen.queryByRole("button", { name: /Try Again/i })).toBeNull();
    expect(document.body.textContent ?? "").not.toMatch(/\bintervention\b/i);
  });
});

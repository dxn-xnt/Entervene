// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudentInterventionView from "../intervention-view";
import StudentPracticeAssessmentModal from "./student-practice-assessment-modal";
import type {
  PracticeAttemptFeedbackResponse,
  PracticeAttemptStartResponse,
  PracticeAttemptSummary,
  StudentPracticeAssessmentMetadata,
} from "@/lib/practice-assessment-api";

// ---------------------------------------------------------------------------
// Mock APIs
// ---------------------------------------------------------------------------

const mockPracticeApi = vi.hoisted(() => ({
  getMetadata: vi.fn(),
  startAttempt: vi.fn(),
  submitAttempt: vi.fn(),
  listAttempts: vi.fn(),
  getFeedback: vi.fn(),
  getProgression: vi.fn(),
}));

vi.mock("@/lib/practice-assessment-api", async (original) => ({
  ...(await original<typeof import("@/lib/practice-assessment-api")>()),
  getStudentPracticeAssessment: mockPracticeApi.getMetadata,
  startStudentPracticeAttempt: mockPracticeApi.startAttempt,
  submitStudentPracticeAttempt: mockPracticeApi.submitAttempt,
  listStudentPracticeAttempts: mockPracticeApi.listAttempts,
  getStudentPracticeAttemptFeedback: mockPracticeApi.getFeedback,
  getStudentPracticeProgression: mockPracticeApi.getProgression,
}));

const mockInterventionApi = vi.hoisted(() => ({
  getActive: vi.fn(),
  getResolved: vi.fn(),
  listActive: vi.fn(),
  listResolved: vi.fn(),
}));

vi.mock("@/lib/student-persistent-interventions-api", () => ({
  getMyActiveIntervention: mockInterventionApi.getActive,
  getMyResolvedIntervention: mockInterventionApi.getResolved,
  listMyActiveInterventions: mockInterventionApi.listActive,
  listMyResolvedInterventions: mockInterventionApi.listResolved,
}));

vi.mock("@/lib/student-intervention-reviewers-api", () => ({
  listMyReviewers: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  getMyReviewer: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button data-testid="sidebar-trigger">Menu</button>,
}));

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Mock Data Fixtures
// ---------------------------------------------------------------------------

const mockPracticeMeta: StudentPracticeAssessmentMetadata = {
  practice_assessment_id: 10,
  title: "Algebra Mastery Practice",
  gatekeeper_policy: "REQUIRE_PASS",
  passing_percentage: 75,
  total_questions: 3,
  total_points: 3,
  attempts_count: 0,
  has_active_attempt: false,
  active_attempt_id: null,
  active_attempt_number: null,
  has_passed: false,
  best_score_percentage: null,
  latest_score_percentage: null,
  latest_attempt_number: null,
};

const mockStartResponse: PracticeAttemptStartResponse = {
  attempt_id: 501,
  attempt_number: 1,
  status: "STARTED",
  passing_percentage: 75,
  total_questions: 3,
  questions: [
    {
      practice_question_id: 1,
      display_order: 1,
      question_text: "What is 2 + 2?",
      question_type: "MULTIPLE_CHOICE",
      points: 1,
      options: [
        { option_id: 11, option_text: "3", option_order: 1 },
        { option_id: 12, option_text: "4", option_order: 2 },
      ],
    },
    {
      practice_question_id: 2,
      display_order: 2,
      question_text: "Is the earth flat?",
      question_type: "TRUE_FALSE",
      points: 1,
      options: [
        { option_id: 21, option_text: "True", option_order: 1 },
        { option_id: 22, option_text: "False", option_order: 2 },
      ],
    },
    {
      practice_question_id: 3,
      display_order: 3,
      question_text: "Define the chemical symbol for Gold:",
      question_type: "IDENTIFICATION",
      points: 1,
      options: [],
    },
  ],
};

const mockFailedFeedback: PracticeAttemptFeedbackResponse = {
  attempt_id: 501,
  attempt_number: 1,
  status: "SUBMITTED",
  total_score: 1,
  max_score: 3,
  score_percentage: 33.33,
  passing_percentage: 75,
  is_passed: false,
  result_status: "BELOW_PASSING",
  eligible_for_remediation: false,
  started_at: "2026-11-04T10:00:00Z",
  completed_at: "2026-11-04T10:15:00Z",
  items: [
    {
      practice_question_id: 1,
      question_text: "What is 2 + 2?",
      question_type: "MULTIPLE_CHOICE",
      points_possible: 1,
      points_awarded: 1,
      is_correct: true,
      student_answer: "4",
      selected_option_id: 12,
      correct_answer: "4",
      explanation: "2 + 2 equals 4 by basic arithmetic.",
      options: [
        { option_id: 11, option_text: "3", is_correct: false },
        { option_id: 12, option_text: "4", is_correct: true },
      ],
    },
    {
      practice_question_id: 2,
      question_text: "Is the earth flat?",
      question_type: "TRUE_FALSE",
      points_possible: 1,
      points_awarded: 0,
      is_correct: false,
      student_answer: "True",
      selected_option_id: 21,
      correct_answer: "False",
      explanation: "The earth is an oblate spheroid.",
      options: [
        { option_id: 21, option_text: "True", is_correct: false },
        { option_id: 22, option_text: "False", is_correct: true },
      ],
    },
    {
      practice_question_id: 3,
      question_text: "Define the chemical symbol for Gold:",
      question_type: "IDENTIFICATION",
      points_possible: 1,
      points_awarded: 0,
      is_correct: false,
      student_answer: null,
      selected_option_id: null,
      correct_answer: "Au",
      explanation: "Gold is denoted by Au from Latin aurum.",
      options: [],
    },
  ],
};

const mockPassedFeedback: PracticeAttemptFeedbackResponse = {
  ...mockFailedFeedback,
  attempt_id: 502,
  attempt_number: 2,
  total_score: 3,
  score_percentage: 100,
  is_passed: true,
  result_status: "PASSED",
  eligible_for_remediation: true,
};

const mockAttemptsSummary: PracticeAttemptSummary[] = [
  {
    attempt_id: 501,
    practice_assessment_id: 10,
    student_id: "s1",
    attempt_number: 1,
    status: "SUBMITTED",
    total_score: 1,
    max_score: 3,
    score_percentage: 33.33,
    is_passed: false,
    started_at: "2026-11-04T10:00:00Z",
    completed_at: "2026-11-04T10:15:00Z",
  },
];

const mockInterventionWithPrereqs = {
  intervention_id: 42,
  status: "ACTIVE",
  subject_id: 1,
  subject_name: "Mathematics",
  class_id: 1,
  class_name: "Grade 9 - Section A",
  teacher_name: "Mara Santos",
  reviewer_id: null,
  required_readings: [
    {
      classwork_id: 201,
      title: "Algebra Lesson 1 Notes",
      assignment_id: 301,
      order: 1,
      completion_status: "COMPLETED",
      focused_seconds: 120,
      completed_at: "2026-11-04T09:00:00Z",
      review_status: "REVIEWED",
      reviewed_at: "2026-11-04T09:05:00Z",
    },
  ],
  preparation: {
    state: "COMPLETE",
    is_satisfied: true,
    completed_count: 1,
    required_count: 1,
    accessible_count: 1,
    unavailable_count: 0,
    summary: "1 of 1 completed",
  },
  activities: [
    {
      assignment_id: 401,
      title: "Algebra Remediation Quiz",
      classwork_type: "QUIZ",
      submission_status: null,
      grade: null,
      total_points: 20,
      access_state: "PREPARATION_REQUIRED",
      access_enforced: true,
      prerequisite_code: "PRACTICE_PASS_REQUIRED",
      prerequisite_message: "A passing score of at least 75.0% on the practice assessment is required.",
      preparation: null,
      readings: [],
    },
  ],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Student Practice Assessment Interface (Phase 5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInterventionApi.getActive.mockResolvedValue(mockInterventionWithPrereqs);
    mockInterventionApi.listActive.mockResolvedValue({ items: [mockInterventionWithPrereqs] });
    mockPracticeApi.getMetadata.mockResolvedValue(mockPracticeMeta);
    mockPracticeApi.listAttempts.mockResolvedValue([]);
    mockPracticeApi.startAttempt.mockResolvedValue(mockStartResponse);
  });

  afterEach(() => {
    cleanup();
  });

  const mountInterventionView = () =>
    render(
      <MemoryRouter initialEntries={["/student/interventions/view?intervention=42"]}>
        <Routes>
          <Route path="/student/interventions/view" element={<StudentInterventionView />} />
        </Routes>
      </MemoryRouter>
    );

  it("displays Step 2 Practice Assessment card when a published practice assessment exists", async () => {
    mountInterventionView();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Practice Assessment" })).toBeTruthy();
    });

    expect(screen.getByText("Algebra Mastery Practice")).toBeTruthy();
    expect(screen.getByText("Ungraded")).toBeTruthy();
    expect(screen.getByText(/Passing Required \(75%\)/i)).toBeTruthy();
    expect(screen.getByText(/3 question\(s\)/i)).toBeTruthy();
    expect(screen.getByText("Not yet attempted")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Take Practice/i })).toBeTruthy();
  });

  it("does not display Step 2 Practice Assessment when no published assessment exists (404/draft)", async () => {
    mockPracticeApi.getMetadata.mockResolvedValue(null);

    mountInterventionView();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Review Activity" })).toBeTruthy();
    });

    expect(screen.queryByRole("heading", { name: "Practice Assessment" })).toBeNull();
    expect(screen.queryByText("Algebra Mastery Practice")).toBeNull();
  });

  it("displays In-Progress and Resume Practice when an active attempt exists", async () => {
    mockPracticeApi.getMetadata.mockResolvedValue({
      ...mockPracticeMeta,
      has_active_attempt: true,
      active_attempt_id: 501,
      active_attempt_number: 1,
    });

    mountInterventionView();

    await waitFor(() => {
      expect(screen.getByText("Attempt In Progress")).toBeTruthy();
    });

    expect(screen.getByRole("button", { name: /Resume Practice/i })).toBeTruthy();
  });

  it("conceals correct answers and explanations during an active attempt", async () => {
    render(
      <StudentPracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={42}
        initialMode="taking"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("What is 2 + 2?")).toBeTruthy();
    });

    // Options are present
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    expect(screen.getByText("4")).toBeTruthy();

    // Correct answer badges and explanations must NOT be present in taking mode
    expect(screen.queryByText(/Correct Answer/i)).toBeNull();
    expect(screen.queryByText(/basic arithmetic/i)).toBeNull();
    expect(screen.queryByText(/oblate spheroid/i)).toBeNull();
    expect(screen.queryByText(/aurum/i)).toBeNull();
  });

  it("supports MCQ, True/False, and Identification answer entry with question navigation", async () => {
    render(
      <StudentPracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={42}
        initialMode="taking"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("Question 1 of 3")).toBeTruthy();
    });

    // 1. Answer Question 1 (MCQ)
    fireEvent.click(screen.getByText("4"));
    expect(screen.getByText("1 of 3 answered (2 remaining)")).toBeTruthy();

    // 2. Navigate to Question 2 (True/False)
    fireEvent.click(screen.getByRole("button", { name: /Next/i }));
    expect(await screen.findByText("Is the earth flat?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "False" }));
    expect(screen.getByText("2 of 3 answered (1 remaining)")).toBeTruthy();

    // 3. Jump to Question 3 via navigator bubble (Identification)
    fireEvent.click(screen.getByLabelText("Jump to Question 3"));
    expect(await screen.findByText("Define the chemical symbol for Gold:")).toBeTruthy();

    const input = screen.getByPlaceholderText("Enter exact answer...");
    fireEvent.change(input, { target: { value: "Au" } });
    expect(screen.getByText("3 of 3 answered")).toBeTruthy();
  });

  it("requires confirmation and displays prompt before submitting attempt", async () => {
    render(
      <StudentPracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={42}
        initialMode="taking"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Submit Practice/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Submit Practice/i }));

    expect(await screen.findByText(/Submit with 3 Unanswered Question\(s\)\?/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Confirm & Submit/i })).toBeTruthy();
  });

  it("displays mandatory full correct answers and explanations after a failed attempt", async () => {
    mockPracticeApi.submitAttempt.mockResolvedValue(mockFailedFeedback);

    render(
      <StudentPracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={42}
        initialMode="taking"
      />
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Submit Practice/i })).toBeTruthy();
    });

    fireEvent.click(screen.getByRole("button", { name: /Submit Practice/i }));
    fireEvent.click(screen.getByRole("button", { name: /Confirm & Submit/i }));

    await waitFor(() => {
      expect(screen.getByText("BELOW PASSING")).toBeTruthy();
    });

    expect(screen.getByText("1 / 3 pts")).toBeTruthy();
    expect(screen.getByText(/33.3%/)).toBeTruthy();

    // Mandatory complete feedback verification:
    // Even on failed/unanswered questions, correct answers and explanations must be revealed!
    expect(screen.getByText("Correct (+1 pt)")).toBeTruthy();
    expect(screen.getAllByText(/Incorrect \(0 \/ 1 pt\)/i).length).toBe(2);

    // Question 1: MCQ with explanation
    expect(screen.getByText("2 + 2 equals 4 by basic arithmetic.")).toBeTruthy();

    // Question 2: True/False with correct answer indicated and explanation
    expect(screen.getByText("The earth is an oblate spheroid.")).toBeTruthy();
    expect(screen.getAllByText("Your Choice").length).toBe(2); // Q1 selected 4, Q2 selected True
    expect(screen.getAllByText("Correct Answer").length).toBeGreaterThan(0); // highlights False

    // Question 3: Unanswered Identification question must show accepted answer!
    expect(screen.getByText("(No answer entered)")).toBeTruthy();
    expect(screen.getByText("Au")).toBeTruthy();
    expect(screen.getByText("Gold is denoted by Au from Latin aurum.")).toBeTruthy();
  });

  it("allows retrying via Try Again and navigating historical attempts", async () => {
    mockPracticeApi.listAttempts.mockResolvedValue([
      ...mockAttemptsSummary,
      {
        attempt_id: 502,
        practice_assessment_id: 10,
        student_id: "s1",
        attempt_number: 2,
        status: "SUBMITTED",
        total_score: 3,
        max_score: 3,
        score_percentage: 100,
        is_passed: true,
        started_at: "2026-11-04T11:00:00Z",
        completed_at: "2026-11-04T11:15:00Z",
      },
    ]);
    mockPracticeApi.getFeedback.mockResolvedValue(mockPassedFeedback);

    render(
      <StudentPracticeAssessmentModal
        isOpen={true}
        onClose={vi.fn()}
        interventionId={42}
        initialMode="feedback"
      />
    );

    await waitFor(() => {
      expect(screen.getByText("PASSED")).toBeTruthy();
    });

    expect(screen.getByText("3 / 3 pts")).toBeTruthy();

    // Check historical attempt selectors
    expect(screen.getByText("Attempt #1 (33%)")).toBeTruthy();
    expect(screen.getByText("Attempt #2 (100%) ✓")).toBeTruthy();

    // Switch to Attempt 1 feedback
    mockPracticeApi.getFeedback.mockResolvedValue(mockFailedFeedback);
    fireEvent.click(screen.getByText("Attempt #1 (33%)"));

    await waitFor(() => {
      expect(mockPracticeApi.getFeedback).toHaveBeenCalledWith(42, 501);
    });

    // Try Again starts a new independent attempt
    mockPracticeApi.startAttempt.mockResolvedValue({
      ...mockStartResponse,
      attempt_id: 503,
      attempt_number: 3,
    });

    const tryAgainBtn = screen.getAllByRole("button", { name: /Try Again/i })[0];
    fireEvent.click(tryAgainBtn);

    await waitFor(() => {
      expect(mockPracticeApi.startAttempt).toHaveBeenCalledWith(42);
    });

    expect(await screen.findByText("Question 1 of 3")).toBeTruthy();
  });

  it("displays lock message with PRACTICE_PASS_REQUIRED on remediation activity until passed", async () => {
    mountInterventionView();

    await waitFor(() => {
      expect(screen.getByText("Algebra Remediation Quiz")).toBeTruthy();
    });

    expect(screen.getByText("Locked")).toBeTruthy();
    expect(
      screen.getByText("A passing score of at least 75.0% on the practice assessment is required.")
    ).toBeTruthy();
  });
});


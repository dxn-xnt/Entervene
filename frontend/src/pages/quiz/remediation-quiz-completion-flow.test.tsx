// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StudentQuizTake from "./quiz-interface";
import StudentQuizResult from "./quiz-result";
import StudentInterventionView from "@/pages/student/intervention-view";
import type { QuizAttemptResponse } from "@/lib/quiz-api";

const quizApiMocks = vi.hoisted(() => ({
  getQuizAttempt: vi.fn(),
  startQuizAttempt: vi.fn(),
  submitQuizAttempt: vi.fn(),
}));

const toastMocks = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
}));

const interventionApiMocks = vi.hoisted(() => ({
  getMyActiveIntervention: vi.fn(),
  getMyResolvedIntervention: vi.fn(),
  listMyActiveInterventions: vi.fn(),
  listMyResolvedInterventions: vi.fn(),
}));

const reviewerApiMocks = vi.hoisted(() => ({
  getMyReviewer: vi.fn(),
  listMyReviewers: vi.fn(),
}));

const practiceApiMocks = vi.hoisted(() => ({
  getStudentPracticeAssessment: vi.fn(),
}));

vi.mock("@/lib/quiz-api", () => quizApiMocks);

vi.mock("@/components/retroui/Toast", () => ({
  useToast: () => toastMocks,
}));

vi.mock("@/lib/student-persistent-interventions-api", () => interventionApiMocks);
vi.mock("@/lib/student-intervention-reviewers-api", () => reviewerApiMocks);
vi.mock("@/lib/practice-assessment-api", () => practiceApiMocks);

vi.mock("@/lib/api", () => ({
  apiFetch: vi.fn().mockResolvedValue({ ok: false }),
}));

vi.mock("@/layouts/app-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/sidebar", () => ({
  SidebarTrigger: () => <button type="button">Menu</button>,
}));

vi.mock("@/pages/student/intervention/student-practice-assessment-modal", () => ({
  default: () => null,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
}

const pendingAttempt: QuizAttemptResponse = {
  quiz_id: 11,
  classwork_assignment_id: 73,
  classwork_id: 101,
  title: "Remediation Algebra Quiz",
  instructions: "Answer carefully.",
  total_points: 10,
  duration_minutes: null,
  max_attempts: 1,
  attempt_count: 0,
  attempts_used: 0,
  attempts_remaining: 1,
  status: "pending",
  started_at: "2026-11-20T00:00:00Z",
  server_time: "2026-11-20T00:01:00Z",
  submitted_at: null,
  grade: null,
  can_submit: true,
  summary_available: false,
  summary_release_mode: "IMMEDIATE",
  summary_release_at: null,
  summary_message: null,
  feedback: null,
  questions: [
    {
      quiz_question_id: 501,
      question_text: "What is 2 + 2?",
      question_type: "MULTIPLE_CHOICE",
      points: 7,
      display_order: 1,
      options: [
        { option_id: 1, option_text: "4", option_order: 1 },
        { option_id: 2, option_text: "5", option_order: 2 },
      ],
    },
  ],
};

const gradedAttempt: QuizAttemptResponse = {
  ...pendingAttempt,
  attempt_count: 1,
  attempts_used: 1,
  attempts_remaining: 0,
  status: "graded",
  submitted_at: "2026-11-20T00:05:00Z",
  grade: 7,
  can_submit: false,
  summary_available: true,
  questions: [
    {
      ...pendingAttempt.questions[0],
      selected_option_id: 1,
      answer_text: "4",
      points_awarded: 7,
      is_correct: true,
      options: [
        { option_id: 1, option_text: "4", option_order: 1, is_correct: true },
        { option_id: 2, option_text: "5", option_order: 2, is_correct: false },
      ],
    },
  ],
};

describe("student remediation quiz completion, result retrieval, and resolved review", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("submits once, renders saved result without error or retake button, and navigates back to Study Support classwork", async () => {
    const classworkReturn =
      "/student/classworks/73?from=%2Fstudent%2Finterventions%2Fview%3Fintervention%3D9";
    quizApiMocks.getQuizAttempt
      .mockResolvedValueOnce(pendingAttempt)
      .mockResolvedValueOnce(gradedAttempt);
    quizApiMocks.submitQuizAttempt.mockResolvedValue(gradedAttempt);

    render(
      <MemoryRouter
        initialEntries={[`/student/quiz/73/take?from=${encodeURIComponent(classworkReturn)}`]}
      >
        <Routes>
          <Route path="/student/quiz/:assignmentId/take" element={<><StudentQuizTake /><LocationProbe /></>} />
          <Route path="/student/quiz/:assignmentId/result" element={<><StudentQuizResult /><LocationProbe /></>} />
          <Route path="/student/classworks/:assignmentId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    // Select option and submit (including rapid second click guard)
    const option = await screen.findByText("4");
    fireEvent.click(option);
    const submitBtn = screen.getByRole("button", { name: /Finish Quiz/i });
    fireEvent.click(submitBtn);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(quizApiMocks.submitQuizAttempt).toHaveBeenCalledTimes(1);
      expect(toastMocks.success).toHaveBeenCalledWith({ title: "Quiz submitted" });
      expect(screen.getByText("7 / 10 Total Points")).toBeTruthy();
    });

    expect(screen.queryByText(/Failed to fetch quiz attempt/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /Retake Quiz/i })).toBeNull();
    expect(quizApiMocks.startQuizAttempt).not.toHaveBeenCalled();

    // Navigate back to Study Support classwork via breadcrumb
    fireEvent.click(screen.getByText("Classwork"));
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(classworkReturn);
    });
  });

  it("warns about unanswered questions and submits only after confirmation", async () => {
    quizApiMocks.getQuizAttempt
      .mockResolvedValueOnce(pendingAttempt)
      .mockResolvedValueOnce(gradedAttempt);
    quizApiMocks.submitQuizAttempt.mockResolvedValue(gradedAttempt);
    const confirm = vi.spyOn(window, "confirm")
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);

    render(
      <MemoryRouter initialEntries={["/student/quiz/73/take"]}>
        <Routes>
          <Route path="/student/quiz/:assignmentId/take" element={<StudentQuizTake />} />
          <Route path="/student/quiz/:assignmentId/result" element={<StudentQuizResult />} />
        </Routes>
      </MemoryRouter>,
    );

    const finish = await screen.findByRole("button", { name: /Finish Quiz/i });
    fireEvent.click(finish);
    expect(confirm).toHaveBeenCalledWith(
      "1 question is unanswered. Submit the quiz anyway? Unanswered questions will receive no credit.",
    );
    expect(quizApiMocks.submitQuizAttempt).not.toHaveBeenCalled();

    fireEvent.click(finish);
    await waitFor(() => expect(quizApiMocks.submitQuizAttempt).toHaveBeenCalledTimes(1));
    confirm.mockRestore();
  });

  it("redirects reopening /take for a completed remediation quiz directly to results without starting a retake", async () => {
    quizApiMocks.getQuizAttempt.mockResolvedValue(gradedAttempt);

    render(
      <MemoryRouter initialEntries={["/student/quiz/73/take"]}>
        <Routes>
          <Route path="/student/quiz/:assignmentId/take" element={<><StudentQuizTake /><LocationProbe /></>} />
          <Route path="/student/quiz/:assignmentId/result" element={<><StudentQuizResult /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe("/student/quiz/73/result");
      expect(screen.getByText("7 / 10 Total Points")).toBeTruthy();
    });
    expect(quizApiMocks.startQuizAttempt).not.toHaveBeenCalled();
  });

  it("starts an Intervention retake with a new identity, blank answers, and the full timer", async () => {
    const failedAttempt: QuizAttemptResponse = {
      ...gradedAttempt,
      submission_id: 9001,
      duration_minutes: 30,
      max_attempts: 3,
      attempt_count: 1,
      attempts_used: 1,
      attempts_remaining: 2,
      can_submit: true,
      is_intervention_quiz: true,
      is_passed: false,
    };
    const freshRetake: QuizAttemptResponse = {
      ...pendingAttempt,
      submission_id: 9002,
      duration_minutes: 30,
      max_attempts: 3,
      attempt_count: 1,
      attempts_used: 1,
      attempts_remaining: 2,
      can_submit: true,
      is_intervention_quiz: true,
      started_at: "2026-11-20T00:10:00Z",
      server_time: "2026-11-20T00:10:00Z",
    };
    quizApiMocks.getQuizAttempt.mockResolvedValue(failedAttempt);
    quizApiMocks.startQuizAttempt.mockResolvedValue(freshRetake);

    render(
      <MemoryRouter initialEntries={["/student/quiz/73/take"]}>
        <Routes>
          <Route path="/student/quiz/:assignmentId/take" element={<StudentQuizTake />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("30:00")).toBeTruthy();
    expect(quizApiMocks.startQuizAttempt).toHaveBeenCalledWith(73);
    expect(screen.getByRole("button", { name: "4" }).className).not.toContain("bg-primary");
  });

  it("restores answers and remaining time when reopening the ongoing Intervention attempt", async () => {
    const ongoingAttempt: QuizAttemptResponse = {
      ...pendingAttempt,
      submission_id: 9002,
      duration_minutes: 30,
      max_attempts: 3,
      attempt_count: 1,
      attempts_used: 1,
      attempts_remaining: 2,
      is_intervention_quiz: true,
      started_at: "2026-11-20T00:10:00Z",
      server_time: "2026-11-20T00:11:00Z",
      questions: [{
        ...pendingAttempt.questions[0],
        selected_option_id: 1,
        answer_text: "4",
      }],
    };
    quizApiMocks.getQuizAttempt.mockResolvedValue(ongoingAttempt);

    render(
      <MemoryRouter initialEntries={["/student/quiz/73/take"]}>
        <Routes>
          <Route path="/student/quiz/:assignmentId/take" element={<StudentQuizTake />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("29:00")).toBeTruthy();
    expect(screen.getByRole("button", { name: "4" }).className).toContain("bg-primary");
    expect(quizApiMocks.startQuizAttempt).not.toHaveBeenCalled();
  });

  it("allows reviewing a completed activity on a resolved intervention while keeping uncompleted activities unavailable", async () => {
    interventionApiMocks.getMyActiveIntervention.mockRejectedValue(new Error("404"));
    interventionApiMocks.getMyResolvedIntervention.mockResolvedValue({
      intervention_id: 9,
      status: "RESOLVED",
      subject_id: 3,
      subject_name: "Mathematics 9",
      class_id: 2,
      class_name: "Section A",
      teacher_name: "Ms. Cruz",
      required_readings: [],
      resource_issues: [],
      preparation: {
        state: "NOT_APPLICABLE",
        is_satisfied: false,
        completed_count: 0,
        required_count: 0,
        accessible_count: 0,
        unavailable_count: 0,
        summary: "Preparation progress is available for active support only.",
      },
      activities: [
        {
          assignment_id: 73,
          title: "Remediation Algebra Quiz",
          classwork_type: "QUIZ",
          submission_status: "graded",
          grade: 7,
          total_points: 10,
          access_state: "HISTORICAL",
          access_enforced: false,
          prerequisite_code: "INTERVENTION_RESOLVED",
          prerequisite_message: "This support has ended.",
          preparation: null,
          readings: [],
        },
        {
          assignment_id: 74,
          title: "Unstarted Remediation Worksheet",
          classwork_type: "ASSIGNMENT",
          submission_status: null,
          grade: null,
          total_points: 10,
          access_state: "HISTORICAL",
          access_enforced: false,
          prerequisite_code: "INTERVENTION_RESOLVED",
          prerequisite_message: "This support has ended.",
          preparation: null,
          readings: [],
        },
      ],
      reviewer_id: null,
      activated_at: "2026-11-18T00:00:00Z",
      resolved_at: "2026-11-20T00:05:00Z",
      resolution_message: "Your progress reached the goal for this support.",
    });
    practiceApiMocks.getStudentPracticeAssessment.mockRejectedValue(new Error("404"));
    reviewerApiMocks.listMyReviewers.mockResolvedValue({ items: [] });

    render(
      <MemoryRouter initialEntries={["/student/interventions/view?intervention=9"]}>
        <Routes>
          <Route path="/student/interventions/view" element={<><StudentInterventionView /><LocationProbe /></>} />
          <Route path="/student/classworks/:assignmentId" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    const completedTitle = await screen.findByText("Remediation Algebra Quiz");
    expect(screen.getAllByText("Score: 7/10").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Review")).toBeTruthy();
    expect(screen.getByText("Unavailable")).toBeTruthy();

    // Uncompleted activity stays non-interactive
    fireEvent.click(screen.getByText("Unstarted Remediation Worksheet"));
    expect(screen.getByTestId("location").textContent).toBe("/student/interventions/view?intervention=9");

    // Completed activity opens classwork review page cleanly
    fireEvent.click(completedTitle);
    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toContain("/student/classworks/73?");
    });
  });
});

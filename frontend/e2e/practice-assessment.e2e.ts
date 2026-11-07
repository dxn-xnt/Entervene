import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser } from "@playwright/test";

type FixtureState = {
  database: string;
  password: string;
  teacher_email: string;
  target_email: string;
  control_email: string;
  intervention_id: number;
  original_assignment_id: number;
  target_student_id: string;
  reading_assignment_ids: number[];
  quiz_assignment_id: number;
  classwork_assignment_id: number;
};

function setReadingCompletion(state: "zero" | "partial" | "complete") {
  execFileSync(
    process.env.E2E_PYTHON!,
    [join(process.env.E2E_BACKEND_DIR!, "tests/browser/remediation_fixture.py"), state, process.env.E2E_STATE_FILE!],
    { cwd: process.env.E2E_BACKEND_DIR!, encoding: "utf8", timeout: 60_000 },
  );
}

function getReadingReviewsCount(): number {
  const output = execFileSync(
    process.env.E2E_PYTHON!,
    [join(process.env.E2E_BACKEND_DIR!, "tests/browser/remediation_fixture.py"), "count_reading_reviews", process.env.E2E_STATE_FILE!],
    { cwd: process.env.E2E_BACKEND_DIR!, encoding: "utf8", timeout: 60_000 },
  );
  return JSON.parse(output.trim()).reading_reviews_count;
}

async function login(browser: Browser, email: string, password: string, base: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/(teacher|student)\//, { timeout: 20_000 });
  return { context, page };
}

test.describe("Practice Assessment End-to-End Hardened Real Browser Suite", () => {
  test.setTimeout(300_000);

  test("comprehensive practice assessment flow: reading acknowledgment, below-passing progress, retry pass, historical review", async ({ browser }) => {
    const state = JSON.parse(readFileSync(process.env.E2E_STATE_FILE!, "utf8")) as FixtureState;
    const base = process.env.E2E_FRONTEND_URL!;
    const interventionId = state.intervention_id;

    // Reset database to 0 readings reviewed
    setReadingCompletion("zero");
    expect(getReadingReviewsCount()).toBe(0);

    // Maintain single persistent sessions for student and teacher to maximize performance
    const studentSession = await login(browser, state.target_email, state.password, base);
    const teacherSession = await login(browser, state.teacher_email, state.password, base);
    const studentPage = studentSession.page;
    const teacherPage = teacherSession.page;

    try {
      // =======================================================================
      // SCENARIO C: REAL UI READING COMPLETION & PERSISTENCE VALIDATION
      // =======================================================================
      await studentPage.goto(`${base}/student/interventions/view?intervention=${interventionId}`);
      await expect(studentPage.getByRole("heading", { name: "Study Support", exact: true })).toBeVisible({ timeout: 15_000 });

      // Confirm initial 0/3 readings reviewed
      await expect(studentPage.getByText("0 of 3 reviewed")).toBeVisible({ timeout: 10_000 });

      // Click the first reading item in Study Support to open its classwork view
      const firstReadingLine = studentPage.locator('[role="button"]').filter({ hasText: /reading/i }).first();
      await expect(firstReadingLine).toBeVisible();
      await firstReadingLine.click();

      // In Classwork view, acknowledge reading through the real UI button
      await expect(studentPage.getByRole("heading", { name: /study support preparation/i })).toBeVisible({ timeout: 15_000 });
      const markReviewedBtn = studentPage.getByRole("button", { name: /mark as reviewed/i });
      await expect(markReviewedBtn).toBeVisible({ timeout: 10_000 });
      await markReviewedBtn.click();

      // UI updates to indicate reviewed
      await expect(studentPage.getByText("Reviewed").first()).toBeVisible({ timeout: 10_000 });

      // Return back to study support
      const backBtn = studentPage.getByRole("button", { name: /back to study support/i });
      await expect(backBtn).toBeVisible();
      await backBtn.click();

      // Confirm Study Support reflects 1 of 3 reviewed
      await expect(studentPage.getByRole("heading", { name: "Study Support", exact: true })).toBeVisible({ timeout: 15_000 });
      await expect(studentPage.getByText("1 of 3 reviewed")).toBeVisible({ timeout: 10_000 });

      // Verify directly against PostgreSQL that 1 row is genuinely persisted in InterventionReadingReview
      expect(getReadingReviewsCount()).toBe(1);

      // Now complete remaining readings via real UI
      for (const readingId of state.reading_assignment_ids.slice(1)) {
        await studentPage.goto(
          `${base}/student/classworks/${readingId}?intervention_id=${interventionId}&from=%2Fstudent%2Finterventions%2Fview%3Fintervention%3D${interventionId}`
        );
        const markBtn = studentPage.getByRole("button", { name: /mark as reviewed/i });
        await markBtn.waitFor({ state: "visible", timeout: 10_000 });
        await markBtn.click();
        await expect(studentPage.getByText("Reviewed").first()).toBeVisible({ timeout: 10_000 });
      }

      // Check PostgreSQL review records count is now 3
      expect(getReadingReviewsCount()).toBe(3);

      // Verify study support reflects all 3 completed
      await studentPage.goto(`${base}/student/interventions/view?intervention=${interventionId}`);
      await expect(studentPage.getByText("3 of 3 reviewed")).toBeVisible({ timeout: 10_000 });

      // =======================================================================
      // SCENARIO B: TEACHER CONFIGURES REQUIRE_ATTEMPT (ALLOW PROGRESS BELOW PASSING)
      // =======================================================================
      await teacherPage.goto(`${base}/teacher/interventions?active=${interventionId}`);
      await expect(teacherPage.getByRole("dialog")).toBeVisible({ timeout: 15_000 });

      const adjustBtn = teacherPage.getByRole("button", { name: /adjust support/i });
      await adjustBtn.waitFor({ state: "visible", timeout: 15_000 });
      await adjustBtn.click();

      const configureBtn = teacherPage.getByRole("button", { name: /(configure practice|add practice assessment)/i }).first();
      await configureBtn.waitFor({ state: "visible", timeout: 15_000 });
      await configureBtn.click();

      await expect(teacherPage.getByRole("heading", { name: /practice assessment/i })).toBeVisible({ timeout: 10_000 });

      // Add Question
      const addMcqBtn = teacherPage.getByRole("button", { name: /add multiple choice/i });
      await expect(addMcqBtn).toBeVisible();
      await addMcqBtn.click();

      const questionTextarea = teacherPage.getByPlaceholder(/enter the question prompt/i);
      await expect(questionTextarea).toBeVisible();
      await questionTextarea.fill("What is 10 divided by 2?");

      await teacherPage.getByPlaceholder("Option A").fill("5");
      await teacherPage.getByPlaceholder("Option B").fill("2");
      await teacherPage.getByPlaceholder("Option C").fill("3");
      await teacherPage.getByPlaceholder("Option D").fill("4");
      await teacherPage.getByPlaceholder(/explanation for the correct answer/i).fill("10 divided by 2 equals 5.");

      // Select progression policy: REQUIRE_ATTEMPT ("Allow Progress Below Passing")
      const allowBelowPassingCard = teacherPage.getByText("Allow Progress Below Passing");
      await expect(allowBelowPassingCard).toBeVisible();
      await allowBelowPassingCard.click();

      // Publish Assessment
      const publishBtn = teacherPage.getByRole("button", { name: /publish assessment/i });
      await expect(publishBtn).toBeEnabled({ timeout: 5_000 });
      await publishBtn.click();

      await expect(teacherPage.getByText(/published/i).first()).toBeVisible({ timeout: 10_000 });

      // Close modals
      const closePracticeModalBtn = teacherPage.getByRole("button", { name: /close/i }).last();
      await closePracticeModalBtn.click();

      const closeInterventionModalBtn = teacherPage.getByRole("button", { name: /close/i }).first();
      if (await closeInterventionModalBtn.isVisible()) {
        await closeInterventionModalBtn.click();
      }

      // -----------------------------------------------------------------------
      // Student takes practice under REQUIRE_ATTEMPT, fails, but unlocks remediation
      // -----------------------------------------------------------------------
      await studentPage.goto(`${base}/student/interventions/view?intervention=${interventionId}`);
      await expect(studentPage.getByRole("heading", { name: "Study Support", exact: true })).toBeVisible({ timeout: 15_000 });

      // Verify Attempt Required badge
      await expect(studentPage.getByText("Attempt Required")).toBeVisible({ timeout: 10_000 });

      // Take practice
      const takePracticeBtn = studentPage.getByRole("button", { name: /take practice/i });
      await expect(takePracticeBtn).toBeVisible({ timeout: 10_000 });
      await takePracticeBtn.click();

      await expect(studentPage.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
      await expect(studentPage.getByText("What is 10 divided by 2?")).toBeVisible({ timeout: 10_000 });

      // Deliberately select WRONG answer "2"
      const option2 = studentPage.getByText("2", { exact: true });
      await expect(option2).toBeVisible();
      await option2.click();

      // Submit
      const submitPracticeBtn = studentPage.getByRole("button", { name: /submit practice/i });
      await expect(submitPracticeBtn).toBeVisible();
      await submitPracticeBtn.click();

      const confirmSubmitBtn = studentPage.getByRole("button", { name: /confirm & submit/i });
      await expect(confirmSubmitBtn).toBeVisible({ timeout: 5_000 });
      await confirmSubmitBtn.click();

      // Feedback shows BELOW PASSING (0.0%), shows explanation, and confirms satisfaction under REQUIRE_ATTEMPT
      await expect(studentPage.getByText(/results review/i)).toBeVisible({ timeout: 15_000 });
      await expect(studentPage.getByText(/0\.0%/i).first()).toBeVisible();
      await expect(studentPage.getByText(/below passing/i).first()).toBeVisible();
      await expect(studentPage.getByText(/remediation activity requirement satisfied/i)).toBeVisible();

      // Close modal
      const closeStudentModalBtn = studentPage.getByRole("button", { name: "Close", exact: true });
      await closeStudentModalBtn.click();

      // On intervention page, Curated Remediation Activity is Ready (unlocked) because REQUIRE_ATTEMPT policy was met!
      await expect(studentPage.getByText("Below Passing").first()).toBeVisible({ timeout: 10_000 });
      await expect(studentPage.getByText("Ready").first()).toBeVisible({ timeout: 10_000 });

      // =======================================================================
      // SCENARIO A: TEACHER ENFORCES REQUIRE_PASS -> LOCKED -> RETRY -> PASS -> UNLOCKED
      // =======================================================================
      await teacherPage.goto(`${base}/teacher/interventions?active=${interventionId}`);
      await expect(teacherPage.getByRole("dialog")).toBeVisible({ timeout: 15_000 });

      const configureBtn2 = teacherPage.getByRole("button", { name: /(manage practice|view details|configure practice|add practice assessment)/i }).first();
      await configureBtn2.waitFor({ state: "visible", timeout: 15_000 });
      await configureBtn2.click();

      await expect(teacherPage.getByRole("heading", { name: /practice assessment/i })).toBeVisible({ timeout: 10_000 });

      // Change Progression Policy to REQUIRE_PASS ("Require Passing Score")
      const requirePassCard = teacherPage.getByText("Require Passing Score");
      await expect(requirePassCard).toBeVisible();
      await requirePassCard.click();

      // Click Re-publish
      const republishBtn = teacherPage.getByRole("button", { name: "Re-publish" });
      await expect(republishBtn).toBeEnabled({ timeout: 5_000 });
      await republishBtn.click();

      await expect(teacherPage.getByText(/published/i).first()).toBeVisible({ timeout: 10_000 });

      // Close modals
      const closePracticeModalBtn2 = teacherPage.getByRole("button", { name: /close/i }).last();
      await closePracticeModalBtn2.click();

      const closeInterventionModalBtn2 = teacherPage.getByRole("button", { name: /close/i }).first();
      if (await closeInterventionModalBtn2.isVisible()) {
        await closeInterventionModalBtn2.click();
      }

      // -----------------------------------------------------------------------
      // Student sees remediation locked under REQUIRE_PASS, retries, passes, unlocks
      // -----------------------------------------------------------------------
      await studentPage.goto(`${base}/student/interventions/view?intervention=${interventionId}`);
      await expect(studentPage.getByRole("heading", { name: "Study Support", exact: true })).toBeVisible({ timeout: 15_000 });

      // Practice card now indicates Passing Required (75%)
      await expect(studentPage.getByText(/passing required/i)).toBeVisible({ timeout: 10_000 });

      // Since student's previous attempt scored 0% (< 75%), remediation activity is now LOCKED!
      await expect(studentPage.getByText("Locked").first()).toBeVisible({ timeout: 10_000 });
      await expect(studentPage.getByText(/passing score.*required/i).first()).toBeVisible({ timeout: 10_000 });

      // Student clicks "Try Again"
      const tryAgainBtn = studentPage.getByRole("button", { name: /try again/i });
      await expect(tryAgainBtn).toBeVisible({ timeout: 10_000 });
      await tryAgainBtn.click();

      // Modal opens in Taking Mode for Attempt #2
      await expect(studentPage.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
      await expect(studentPage.getByText("What is 10 divided by 2?")).toBeVisible({ timeout: 10_000 });

      // Select CORRECT answer "5"
      const option5 = studentPage.getByText("5", { exact: true });
      await expect(option5).toBeVisible();
      await option5.click();

      // Submit
      const submitPracticeBtn2 = studentPage.getByRole("button", { name: /submit practice/i });
      await expect(submitPracticeBtn2).toBeVisible();
      await submitPracticeBtn2.click();

      const confirmSubmitBtn2 = studentPage.getByRole("button", { name: /confirm & submit/i });
      await expect(confirmSubmitBtn2).toBeVisible({ timeout: 5_000 });
      await confirmSubmitBtn2.click();

      // Feedback shows PASSED (100.0%)
      await expect(studentPage.getByText(/results review/i)).toBeVisible({ timeout: 15_000 });
      await expect(studentPage.getByText(/100\.0%/i).first()).toBeVisible();
      await expect(studentPage.getByText(/passed/i).first()).toBeVisible();
      await expect(studentPage.getByText(/remediation activity requirement satisfied/i)).toBeVisible();

      // -----------------------------------------------------------------------
      // Verify Historical Attempts Review
      // -----------------------------------------------------------------------
      const attempt1Btn = studentPage.getByRole("button", { name: /attempt #1/i });
      const attempt2Btn = studentPage.getByRole("button", { name: /attempt #2/i });
      await expect(attempt1Btn).toBeVisible({ timeout: 5_000 });
      await expect(attempt2Btn).toBeVisible({ timeout: 5_000 });

      // Click Attempt #1 -> reviews Attempt #1 (0.0% Below Passing)
      await attempt1Btn.click();
      await expect(studentPage.getByText(/0\.0%/i).first()).toBeVisible();
      await expect(studentPage.getByText(/below passing/i).first()).toBeVisible();

      // Click Attempt #2 -> reviews Attempt #2 (100.0% Passed)
      await attempt2Btn.click();
      await expect(studentPage.getByText(/100\.0%/i).first()).toBeVisible();
      await expect(studentPage.getByText(/passed/i).first()).toBeVisible();

      // Close feedback modal
      const closeStudentModalBtn2 = studentPage.getByRole("button", { name: "Close", exact: true });
      await closeStudentModalBtn2.click();

      // On intervention page, Curated Remediation Activity is now UNLOCKED (Ready)
      await expect(studentPage.getByText("Ready").first()).toBeVisible({ timeout: 10_000 });

      // Click into the Remediation Activity to confirm direct access without error blocker
      const remediationLink = studentPage.getByRole("link", { name: /deterministic remedial quiz/i }).first();
      if (await remediationLink.isVisible()) {
        await remediationLink.click();
        await expect(studentPage.getByText(/this classwork is unavailable or you do not have access/i)).toHaveCount(0);
      }
    } finally {
      await studentSession.context.close();
      await teacherSession.context.close();
    }
  });
});

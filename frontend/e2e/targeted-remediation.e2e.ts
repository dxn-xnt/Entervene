import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const title = "Mathematics 10 focused practice";

type FixtureState = {
  database: string;
  password: string;
  teacher_email: string;
  target_email: string;
  control_email: string;
  intervention_id: number;
  original_assignment_id: number;
  target_student_id: string;
};

async function login(browser: Browser, email: string, password: string, base: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/(teacher|student)\//);
  return { context, page };
}

async function todos(page: Page, api: string) {
  return page.evaluate(async (base) => {
    const response = await fetch(`${base}/api/v1/students/me/todos`, { credentials: "include" });
    return { status: response.status, data: await response.json() };
  }, api);
}

function inspect() {
  const python = process.env.E2E_PYTHON!;
  const backend = process.env.E2E_BACKEND_DIR!;
  const stateFile = process.env.E2E_STATE_FILE!;
  const output = execFileSync(python, [join(backend, "tests/browser/remediation_fixture.py"), "inspect", stateFile], {
    cwd: backend, encoding: "utf8", timeout: 15_000,
  });
  return JSON.parse(output) as { database: string; assignments: Array<{
    assignment_id: number; recipient_student_id: string; published: boolean; submission_count: number;
  }> };
}

test("targeted Examination remediation is pending only for its student and opens without starting an attempt", async ({ browser }) => {
  const state = JSON.parse(readFileSync(process.env.E2E_STATE_FILE!, "utf8")) as FixtureState;
  const base = process.env.E2E_FRONTEND_URL!;
  const api = process.env.E2E_BACKEND_URL!;
  const contexts: BrowserContext[] = [];
  try {
    const teacher = await login(browser, state.teacher_email, state.password, base);
    contexts.push(teacher.context);
    await teacher.page.goto(`${base}/teacher/interventions`);
    await teacher.page.getByRole("button", { name: "Review" }).first().click();
    await teacher.page.getByRole("button", { name: "Approve Intervention" }).click();
    await teacher.page.getByRole("tab", { name: "Active" }).click();
    await teacher.page.getByRole("button", { name: "Review" }).first().click();
    await teacher.page.getByRole("button", { name: "Prepare Remediation" }).click();
    await teacher.page.getByRole("radio", { name: /Quiz Focused practice/ }).click();
    await teacher.page.getByRole("radio", { name: /Remedial Examination/ }).click();
    await expect(teacher.page.getByLabel("Original Examination")).toHaveValue(String(state.original_assignment_id));
    await teacher.page.getByRole("button", { name: /Continue to Quiz Builder/ }).click();
    await teacher.page.getByRole("button", { name: /Create manually/ }).click();
    await teacher.page.getByRole("button", { name: "Next" }).click();
    await teacher.page.locator('textarea[placeholder^="Which of the following"]').fill("Which ratio is 2 to 1?");
    await teacher.page.locator('input[type="number"][placeholder="Enter text"]').last().fill("10");
    await teacher.page.locator('input[placeholder="Choice 1"]').fill("2:1");
    await teacher.page.locator('input[placeholder="Choice 2"]').fill("1:2");
    await teacher.page.getByRole("radio", { name: "Mark choice 1 correct" }).click();
    await teacher.page.getByRole("button", { name: "Next" }).click();
    await teacher.page.getByRole("combobox").filter({ hasText: "Keep hidden from students" }).click();
    await teacher.page.getByRole("option", { name: "Publish now" }).click();
    await teacher.page.getByRole("button", { name: "Assign", exact: true }).click();
    await expect(teacher.page.getByText(title, { exact: true }).first()).toBeVisible();

    const published = inspect();
    expect(published.database).toBe(state.database);
    expect(published.assignments).toHaveLength(1);
    const assignment = published.assignments[0];
    expect(assignment.published).toBe(true);
    expect(assignment.recipient_student_id).toBe(state.target_student_id);
    expect(assignment.submission_count).toBe(0);

    const target = await login(browser, state.target_email, state.password, base);
    contexts.push(target.context);
    await target.page.goto(`${base}/student/todo`);
    const card = target.page.getByRole("button", { name: new RegExp(title) }).first();
    await expect(card).toBeVisible();
    await expect(card).toContainText(title);
    const targetList = await todos(target.page, api);
    expect(targetList.status).toBe(200);
    expect(targetList.data.pending).toEqual(expect.arrayContaining([
      expect.objectContaining({ assignment_id: assignment.assignment_id, title, status: "pending", submission_status: null }),
    ]));
    expect(targetList.data.completed.some((item: { assignment_id: number }) => item.assignment_id === assignment.assignment_id)).toBe(false);

    await card.click();
    await expect(target.page.getByText("Student classwork detail")).toBeVisible();
    await expect(target.page.getByText("Not Submitted Yet").first()).toBeVisible();
    await expect(target.page.getByRole("button", { name: "Start Quiz" })).toBeVisible();
    expect(inspect().assignments[0].submission_count).toBe(0);

    const control = await login(browser, state.control_email, state.password, base);
    contexts.push(control.context);
    await control.page.goto(`${base}/student/todo`);
    await expect(control.page.getByText("Pending Tasks")).toBeVisible();
    await expect(control.page.getByRole("button", { name: new RegExp(title) })).toHaveCount(0);
    const controlList = await todos(control.page, api);
    expect(controlList.status).toBe(200);
    expect(controlList.data.all.some((item: { assignment_id: number }) => item.assignment_id === assignment.assignment_id)).toBe(false);
    expect(inspect().assignments[0].submission_count).toBe(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

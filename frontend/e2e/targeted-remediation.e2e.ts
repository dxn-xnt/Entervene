import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

const title = "Deterministic Remedial Quiz";

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
  blocked_assignment_id: number;
  historical_assignment_id: number;
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

function setReadingCompletion(state: "zero" | "partial" | "complete") {
  execFileSync(
    process.env.E2E_PYTHON!,
    [join(process.env.E2E_BACKEND_DIR!, "tests/browser/remediation_fixture.py"), state, process.env.E2E_STATE_FILE!],
    { cwd: process.env.E2E_BACKEND_DIR!, encoding: "utf8", timeout: 15_000 },
  );
}

test("deterministic student Study Support fixture authenticates and loads", async ({ browser }) => {
  const state = JSON.parse(readFileSync(process.env.E2E_STATE_FILE!, "utf8")) as FixtureState;
  const base = process.env.E2E_FRONTEND_URL!;
  const api = process.env.E2E_BACKEND_URL!;
  const student = await login(browser, state.target_email, state.password, base);
  const errors: string[] = [];
  student.page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  try {
    await student.page.goto(`${base}/student/interventions`);
    await expect(student.page.getByRole("heading", { name: "Study Support" })).toBeVisible();
    await expect(student.page.getByText("0 of 3 reviewed")).toBeVisible();
    await expect(student.page.getByText("Deterministic Remedial Quiz")).toBeVisible();
    await expect(student.page.getByText("Historical Activity Without Snapshot")).toBeVisible();
    const response = await student.page.evaluate(async (backend) => {
      const result = await fetch(`${backend}/api/v1/student/interventions`, { credentials: "include" });
      return { status: result.status, body: await result.json() };
    }, api);
    expect(response.status).toBe(200);
    expect(response.body.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ intervention_id: state.intervention_id }),
    ]));
    expect(errors.filter((message) => !message.includes("ERR_NETWORK_ACCESS_DENIED"))).toEqual([]);
  } finally {
    await student.context.close();
  }
});

test("seeded remediation is visible only to its student and opens without starting an attempt", async ({ browser }) => {
  const state = JSON.parse(readFileSync(process.env.E2E_STATE_FILE!, "utf8")) as FixtureState;
  const base = process.env.E2E_FRONTEND_URL!;
  const api = process.env.E2E_BACKEND_URL!;
  const contexts: BrowserContext[] = [];
  try {
    const published = inspect();
    expect(published.database).toBe(state.database);
    expect(published.assignments).toHaveLength(1);
    const assignment = published.assignments[0];
    expect(assignment.assignment_id).toBe(state.quiz_assignment_id);
    expect(assignment.published).toBe(true);
    expect(assignment.recipient_student_id).toBe(state.target_student_id);
    expect(assignment.submission_count).toBe(0);

    setReadingCompletion("complete");

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
    await expect(target.page.getByRole("heading", { name: title })).toBeVisible();
    await expect(target.page.getByText("Status: not started")).toBeVisible();
    await expect(target.page.getByRole("button", { name: "Start Quiz" })).toBeVisible();
    expect(inspect().assignments[0].submission_count).toBe(0);

    const control = await login(browser, state.control_email, state.password, base);
    contexts.push(control.context);
    await control.page.goto(`${base}/student/todo`);
    await expect(control.page.getByRole("heading", { name: "To do" })).toBeVisible();
    await expect(control.page.getByRole("button", { name: new RegExp(title) })).toHaveCount(0);
    const controlList = await todos(control.page, api);
    expect(controlList.status).toBe(200);
    expect(controlList.data.all.some((item: { assignment_id: number }) => item.assignment_id === assignment.assignment_id)).toBe(false);
    expect(inspect().assignments[0].submission_count).toBe(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

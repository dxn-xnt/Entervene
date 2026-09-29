import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const frontend = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const backend = resolve(frontend, "../backend");
const fixture = join(backend, "tests/browser/remediation_fixture.py");

function pythonExecutable(): string {
  const local = join(backend, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const executable = process.env.E2E_PYTHON || local;
  if (!existsSync(executable)) throw new Error(`Python environment missing: ${executable}`);
  return executable;
}

function runFixture(python: string, action: string, stateFile: string): string {
  return execFileSync(python, [fixture, action, stateFile], {
    cwd: backend, encoding: "utf8", timeout: 120_000,
  }).trim();
}

async function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("No local port assigned"));
      server.close(() => resolvePort(address.port));
    });
  });
}

async function ready(url: string, child: ChildProcess, label: string): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`${label} exited before it was ready (${child.exitCode})`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
    } catch { /* Wait for the server to bind. */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`${label} did not become ready: ${url}`);
}

async function stop(child?: ChildProcess): Promise<void> {
  if (!child || child.exitCode !== null) return;
  child.kill();
  await Promise.race([
    new Promise<void>((resolveExit) => child.once("exit", () => resolveExit())),
    new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 5000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

export default async function globalSetup() {
  const python = pythonExecutable();
  const directory = mkdtempSync(join(tmpdir(), "entervene-remediation-browser-"));
  const stateFile = join(directory, "fixture.json");
  let backendProcess: ChildProcess | undefined;
  let frontendProcess: ChildProcess | undefined;
  const cleanup = async () => {
    await stop(frontendProcess);
    await stop(backendProcess);
    try { runFixture(python, "cleanup", stateFile); }
    finally { rmSync(directory, { recursive: true, force: true }); }
  };
  try {
    runFixture(python, "prepare", stateFile);
    const state = JSON.parse(readFileSync(stateFile, "utf8"));
    const databaseUrl = runFixture(python, "url", stateFile);
    const backendPort = await freePort();
    const frontendPort = await freePort();
    const backendUrl = `http://127.0.0.1:${backendPort}`;
    const frontendUrl = `http://127.0.0.1:${frontendPort}`;
    backendProcess = spawn(python, ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(backendPort)], {
      cwd: backend, stdio: "ignore", env: {
        ...process.env, DATABASE_URL: databaseUrl, APP_ENVIRONMENT: "development",
        DEVELOPMENT_PREDICTION_API_ENABLED: "true",
        DEVELOPMENT_CURRENT_TERM_MODEL_NAME: "entervene_current_term_official_target_rf_candidate",
        AI_ENABLED: "false", MAIL_DRIVER: "console",
        FRONTEND_URL: frontendUrl,
      },
    });
    await ready(`${backendUrl}/api/v1/settings/public`, backendProcess, "backend");
    frontendProcess = spawn(process.execPath, [join(frontend, "node_modules/vite/bin/vite.js"), "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"], {
      cwd: frontend, stdio: "ignore", env: { ...process.env, VITE_API_URL: backendUrl },
    });
    await ready(`${frontendUrl}/login`, frontendProcess, "frontend");
    process.env.E2E_STATE_FILE = stateFile;
    process.env.E2E_FRONTEND_URL = frontendUrl;
    process.env.E2E_BACKEND_URL = backendUrl;
    process.env.E2E_PYTHON = python;
    process.env.E2E_BACKEND_DIR = backend;
    if (!state.intervention_id || !state.original_assignment_id) throw new Error("Fixture IDs missing");
    return cleanup;
  } catch (error) {
    await cleanup();
    throw error;
  }
}

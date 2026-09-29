# Targeted remediation browser regression

Run from `frontend` with `npm run test:e2e`.

The runner requires the frontend npm dependencies, `backend/.venv` (or
`E2E_PYTHON` pointing to the backend Python environment), a reachable local
PostgreSQL server configured by the backend settings, and Microsoft Edge on
Windows. On other platforms, install Playwright Chromium with
`npx playwright install chromium`. `E2E_BROWSER_CHANNEL` overrides the browser
channel.

Global setup creates a uniquely named local PostgreSQL database, runs Alembic
to the current head, seeds a natural Intervention candidate, and starts the
backend and Vite on free local ports. Playwright closes both servers and drops
the database after the test, including when an assertion fails. The database
name is checked before cleanup; the configured database is used only for local
PostgreSQL connection details.

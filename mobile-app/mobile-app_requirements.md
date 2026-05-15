================================================================================
Entervene mobile-app — what to install after cloning (setup reference)
================================================================================
This file is NOT a Python requirements file. The mobile client is a Node.js /
Expo (React Native) app. All library versions are pinned in package.json and
package-lock.json in this folder.

--------------------------------------------------------------------------------
 Install JavaScript dependencies (required after every clone)
--------------------------------------------------------------------------------
  From the repository root:

    cd mobile-app
    npm install

  If npm reports peer dependency warnings, you can align Expo-related packages
  with the SDK using (optional, usually not needed if lockfile is committed):

    npx expo install --fix

--------------------------------------------------------------------------------
2) Point the app at your API (required for login and data)
--------------------------------------------------------------------------------
  The app reads the backend base URL from EXPO_PUBLIC_API_URL (see hooks/api.ts,
  hooks/useStudentSubjects.ts, context/AuthContext.tsx).

  Create mobile-app/.env (not committed) or export before starting:
  
  ### RUN THE BACKEND FIRST ###
    cd ../backend
python3 -m uvicorn app.main:app --reload


--------------------------------------------------------------------------------
3) Backend (separate repo folder — the API must run for most features)
--------------------------------------------------------------------------------
  Database (PostgreSQL)

    • Install PostgreSQL and create a database and copy and paste the schema_with_sample_data.txt

  Run SQL migrations (yes — required for lessons/classwork/submissions features)

    From the repo root (adjust host, user, and database name to match your .env
    DATABASE_URL / database_url):

      psql -h localhost -U postgres -d Entervene -f backend/migrations/001_add_lms_tables.sql

    On Windows you can use pgAdmin Query Tool and paste the file contents, or
    psql from PATH if installed.

    If more files appear later under backend/migrations/, run them in numeric
    order (002 after 001, etc.).

    Note: requirements.txt lists Alembic, but this project ships hand-written SQL
    in backend/migrations/ for the LMS MVP; use those unless your team adds
    Alembic revisions.

  Python API

  From repo root:

    cd backend
    python -m venv .venv
    .venv\Scripts\activate          (Windows)   — or: source .venv/bin/activate (macOS/Linux)
    pip install -r requirements.txt

  Configure backend/.env with database_url matching the database you created and
  migrated.

  Start the server:

    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

  Use the same host/port in EXPO_PUBLIC_API_URL.

--------------------------------------------------------------------------------
4) Run the mobile app
--------------------------------------------------------------------------------
  From mobile-app:

    npx expo start

  Then press a/i/w for Android / iOS simulator / web, or scan the QR code with
  Expo Go on a device.

  Clear Metro cache if you see stale bundles:

    npx expo start --clear

--------------------------------------------------------------------------------
5) Lint (optional)
--------------------------------------------------------------------------------
    npm run lint

================================================================================

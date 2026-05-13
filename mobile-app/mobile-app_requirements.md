================================================================================
Entervene mobile-app — what to install after cloning (setup reference)
================================================================================
This file is NOT a Python requirements file. The mobile client is a Node.js /
Expo (React Native) app. All library versions are pinned in package.json and
package-lock.json in this folder.

--------------------------------------------------------------------------------
1) Prerequisites (install on your machine once)
--------------------------------------------------------------------------------
  • Node.js 20 LTS or newer (https://nodejs.org/) — includes npm
  • Git
  • For physical device testing over LAN: phone with Expo Go, same Wi‑Fi as PC

  Optional (native builds / emulators):
  • Android: Android Studio + SDK (for emulator or USB debugging)
  • iOS (macOS only): Xcode (for Simulator or device builds)

--------------------------------------------------------------------------------
2) Install JavaScript dependencies (required after every clone)
--------------------------------------------------------------------------------
  From the repository root:

    cd mobile-app
    npm install

  That installs everything declared in package.json, including for example:
  • Expo SDK ~54, expo-router, expo-document-picker, expo-sharing, and other
    expo-* packages
  • react 19.x, react-native 0.81.x
  • @react-native-async-storage/async-storage, react-native-safe-area-context,
    react-native-screens, react-native-gesture-handler, react-native-reanimated,
    react-native-svg, @expo/vector-icons, lucide-react-native, etc.

  If npm reports peer dependency warnings, you can align Expo-related packages
  with the SDK using (optional, usually not needed if lockfile is committed):

    npx expo install --fix

--------------------------------------------------------------------------------
3) Point the app at your API (required for login and data)
--------------------------------------------------------------------------------
  The app reads the backend base URL from EXPO_PUBLIC_API_URL (see hooks/api.ts,
  hooks/useStudentSubjects.ts, context/AuthContext.tsx).

  Create mobile-app/.env (not committed) or export before starting:

    EXPO_PUBLIC_API_URL=http://YOUR_MACHINE_IP:8000

  Example for local backend on the same computer (emulator / web):

    EXPO_PUBLIC_API_URL=http://localhost:8000

  For a phone on the same network, use your PC’s LAN IP (not localhost).

--------------------------------------------------------------------------------
4) Backend (separate repo folder — the API must run for most features)
--------------------------------------------------------------------------------
  Database (PostgreSQL)

    • Install PostgreSQL and create a database (name should match backend/.env
      or the default in app/core/Config.py, e.g. Entervene).
    • The API expects your core schema (users, subjects, classes, staff, etc.) to
      already exist. The SQL under backend/migrations/ adds LMS tables on top.

  Run SQL migrations (yes — required for lessons/classwork/submissions features)

    From the repo root (adjust host, user, and database name to match your .env
    DATABASE_URL / database_url):

      psql -h localhost -U postgres -d Entervene -f backend/migrations/001_add_lms_tables.sql

    On Windows you can use pgAdmin → Query Tool and paste the file contents, or
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

  Configure backend/.env (copy from team template if you have one) with at least
  database_url / DATABASE_URL matching the database you created and migrated.

  Start the server:

    uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

  Use the same host/port in EXPO_PUBLIC_API_URL.

--------------------------------------------------------------------------------
5) Run the mobile app
--------------------------------------------------------------------------------
  From mobile-app:

    npx expo start

  Then press a/i/w for Android / iOS simulator / web, or scan the QR code with
  Expo Go on a device.

  Clear Metro cache if you see stale bundles:

    npx expo start --clear

--------------------------------------------------------------------------------
6) Lint (optional)
--------------------------------------------------------------------------------
    npm run lint

================================================================================

# Local development

Backend (from backend/):
```
pip install -r requirements.txt
.venv\Scripts\activate
uvicorn app.main:app --reload
```

Frontend (from frontend/): `npm run dev`

Mobile (from mobile-app/): `npx expo start`

Keep passwords and SMTP credentials in a password manager or an untracked environment file. Previously recorded credentials must be rotated; deleting file content does not remove Git history.

How to View It in the Browser
Both your backend (uvicorn) and frontend (npm run dev) are already running in your terminals.

Open your browser: Go to http://localhost:5173

Log in with the seeded Teacher account:

Email: teacher.acceptance@school.edu.ph
Password: Password123! (Or log in as Admin: admin.acceptance@school.edu.ph / Password123!)
Go to AI Predictions:

Click AI Predictions in the left sidebar (or go to http://localhost:5173/teacher/predictions).

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

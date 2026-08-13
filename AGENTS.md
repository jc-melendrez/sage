# SAGE Learning — AGENTS.md

## Project structure

- **`mobile_app/`** — Expo 55 + React Native 0.83 TS app (file-based routing via expo-router)
- **`backend_api/core/`** — Django 6.0.4 + DRF backend with SQLite
- **`env/`** — Python virtual env (git-ignored but present locally)
- **`games.tsx`** (root) — stale copy; ignore it. Real game screens live in `mobile_app/app/game/`

## Quick start

### Frontend
```bash
cd mobile_app
npm install
npx expo start          # dev server
npm run android         # builds Android (patches gradle first)
npm run ios             # iOS build
npm run web             # web version
npm run lint            # expo lint (ESLint)
```

### Backend
```bash
cd backend_api/core
source ../../env/bin/activate   # or your venv
pip install -r requirements.txt
python manage.py runserver       # defaults to :8000
python manage.py test            # runs Django tests
```

## Architecture

### Mobile app key facts

- **Auth** — JWT tokens stored in `expo-secure-store` (keys: `auth_token`, `refresh_token`). See `services/authService.ts`
- **API base URL** — switchable in `config/api.ts`. Defaults to `API_CONFIG.LOCAL` (`http://192.168.1.11:8000/api`). Change to `LOCALHOST` for web or `TUNNEL` for ngrok
- **Path alias** — `@/*` maps to `mobile_app/*`
- **Firebase** — client-side Firebase auth is a no-op (`services/firebaseAuthService.ts`). All Firestore sync is server-side (Django → Firestore)
- **Hidden tabs** — `explore` and `dashboard` screen files exist but have `href: null` in tab layout
- **Game screens** — `app/game/` has 5 routes: `index`, `classic`, `lobby`, `question`, `final`. `(tabs)/games.tsx` re-exports `app/game/index`

### Backend key facts

- **Django apps**: `users`, `ai_assistant`, `game`
- **Custom user model**: `users.User` (extends `AbstractUser`) — has XP, level, streak, role flags (`is_student`/`is_educator`/`is_admin`)
- **API endpoints**:
  - `/api/users/register/`, `/api/users/login/` (JWT), `/api/users/token/refresh/`
  - `/api/users/me/` (current user profile, requires JWT)
  - `/api/users/<id>/`, `<id>/activities/`, `<id>/badges/`, `<id>/sessions/`, `<id>/recommendations/`
  - `/api/users/groups/create/`, `/api/users/groups/join/`, `/api/users/groups/mine/`, `/api/users/groups/<id>/chat/`
  - `/api/users/courses/create/`, `/api/users/courses/mine/`, `/api/users/courses/enrolled/`, `/api/users/courses/join/`, `/api/users/courses/<id>/`, `/api/users/courses/<id>/add-student/`, `/api/users/courses/<id>/remove-student/` (per-course rosters, educator-owned; students enroll via join code or are added by the educator)
  - `/api/users/lessons/generate/` (Groq AI)
  - `/api/users/test-xp/` (add XP debug), `/api/users/test-model-config/`
  - `/api/ai/ask/`, `/api/ai/sessions/`, `/api/ai/sessions/<id>/history/`
  - `/api/ai/generate-quiz/`, `/api/ai/quizzes/`
  - `/api/game/create/`, `/api/game/join/`, `/api/game/start/`, `/api/game/answer/`, `/api/game/finish/`
- **Secrets**: loaded from `/mnt/c/dev/sage/.env` (tracks in git — contains `DJANGO_SECRET_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`)
- **AI provider**: Groq, model `llama-3.3-70b-versatile` via `https://api.groq.com/openai/v1/chat/completions`. Override with env var `GROQ_MODEL_NAME`
- **Real-time**: game rooms and group chats use Firestore as real-time layer (server writes, mobile reads). Game rooms in `gameRooms` collection, group messages in `groups/<id>/messages`
- **CORS**: custom middleware at `core.cors.CORSMiddleware` — allows all origins, methods, and `Content-Type, Authorization` headers
- **Testing**: `test_api.py` at `backend_api/core/test_api.py` (manual HTTP request script)

## Gotchas

- `.env` with API keys is committed to git — **do not push to public repos** without scrubbing
- Django settings require `DJANGO_SECRET_KEY` in `.env` or server won't start
- `Android` build command runs `scripts/patch-gradle.js` before `expo run:android` — patches wrapper to Gradle 8.13
- Root `games.tsx` is dead code; modify `mobile_app/app/game/` instead
- No test framework exists for the mobile app (no Jest config found)

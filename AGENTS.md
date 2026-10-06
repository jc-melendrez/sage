# SAGE Learning — AGENTS.md

## Project structure

- **`mobile_app/`** — Expo 55 + React Native 0.83 TS app (file-based routing via expo-router)
- **`landing_page/`** — standalone marketing page (plain HTML/CSS, no build). Deployed to `/`
- **`render.yaml`** — Render Blueprint for the web deployment (see "Web deployment")
- **`backend_api/core/`** — Django 6.0.4 + DRF backend. SQLite locally, **Postgres (AWS RDS)** in production when `DATABASE_URL` is set
- **`env/`** — Python virtual env (git-ignored but present locally)
- **`games.tsx`** (root) — stale copy; ignore it. Real game screens live in `mobile_app/app/game/`

## Quick start

### Frontend
```bash
cd mobile_app
npm install
npx expo start          # dev server
npm run android         # builds Android (patches gradle first)
npm run android:release  # release APK -> android/app/build/outputs/apk/release/SAGE.apk
npm run ios             # iOS build
npm run web             # web version
npm run build:web        # production web build -> mobile_app/web-build/
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
- **Custom user model**: `users.User` (extends `AbstractUser`) — single `role` field (`superadmin`/`educator`/`student`) + `token_version` (JWT revocation). Legacy flags (`is_student`/`is_educator`) are derived from `role` in `save()`. Custom `SageUserManager` sets `role='superadmin'` for `createsuperuser`
- **No schools/tenants**: the old `School` model and `admin` (school-scoped) role were removed — 3 roles only. Game rooms are open: anyone with the room code can join. Firestore user docs may still carry stale `schoolId`/`is_admin` fields from before the removal (`merge=True` syncs don't delete fields) — harmless, ignore them
- **Roles**: superadmin = global scope (user management via `users/permissions.py` `IsSuperadmin`); role changes audited in `RoleChangeLog` + bump `token_version` to kill outstanding JWTs (stale token → 401)
- **Creating superusers / educators**:
  - `python manage.py createsuperuser` → role `superadmin` (via `SageUserManager`)
  - Superadmin interface: `POST /api/users/superadmin/users/` with `role`; for `role='superadmin'` it also auto-provisions a **Firebase Auth account** (email+password) so the user can sign in on the app immediately (offline/duplicate → warning, still creates the Django user)
- **Mobile login is Firebase-only**: the app calls `signInWithEmailAndPassword` then exchanges the ID token at `/api/users/firebase-login/` (matches Django user by `firebase_uid`, falling back to email). A backend-created user without a Firebase account can be linked by creating a Firebase Auth user with the same email (or by being created via the superadmin interface, which provisions it automatically)
- **Email OTP 2FA**: `firebase-login` with `sign_in_provider == 'password'` responds with an OTP challenge (`{otp_required, challenge_token, email, expires_in: 300}`) and emails a 6-digit code (`users/otp.py`); the client finishes at `/api/users/firebase-login/verify-otp/` (`FirebaseLoginVerifyOtpView`). Google sign-ins skip OTP. Gated by `OTP_ENABLED` (default **on**; set `OTP_ENABLED=0` in `.env`/Render env to disable; `EMAIL_BACKEND=console` prints codes in the runserver console). **Delivery is via SendGrid's HTTP API when `SENDGRID_API_KEY` is set** — Render blocks direct SMTP egress (`Errno 101` "Network is unreachable" at `smtp.gmail.com:587`), so Gmail SMTP cannot work from Render; `EMAIL_TIMEOUT=10` bounds any stale send path so a failure surfaces as a fast 503, never a hung-worker 500. `SENDGRID_FROM_EMAIL` defaults to `sage.app.io@gmail.com` (must pass SendGrid Single Sender Verification; `SENDGRID_FROM_NAME` defaults to `SAGE`). `/api/healthz/` reports `otp_enabled`, `otp_delivery` (`sendgrid`/`smtp`/`none`), `email_configured`. Login/verify are throttled by `OtpThrottle` (`otp` scope, 20/hour)
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
- **Database / `DATABASE_URL`**: `settings.py` reads `DATABASE_URL` → AWS RDS Postgres (`dj_database_url`, `sslmode=require`); when unset it falls back to SQLite so **local dev needs no config**. RDS instance is reachable only from Render egress IPs; credentials live in Render env (secret), never in the repo. Both `Procfile` commands run `python manage.py migrate --noinput && python manage.py createcachetable` — the `django_cache` table is created by `createcachetable` and **no migration creates it**, but every request writes a DRF throttle counter to it. `core/cache.py` (`ResilientDatabaseCache`) degrades to an in-process cache instead of 500ing if the table is missing; `/api/healthz/` reports `cache_table` and `cache_degraded`.
- **Secrets**: loaded from repo-root `.env` (git-ignored, NOT tracked — contains `DJANGO_SECRET_KEY`, `GROQ_API_KEY`, `DEEPSEEK_API_KEY`)
- **AI provider**: Groq, model `llama-3.3-70b-versatile` via `https://api.groq.com/openai/v1/chat/completions`. Override with env var `GROQ_MODEL_NAME`
- **Real-time**: game rooms and group chats use Firestore as real-time layer (server writes, mobile reads). Game rooms in `gameRooms` collection, group messages in `groups/<id>/messages`
- **CORS**: custom middleware at `core.cors.CORSMiddleware` — allows all origins, methods, and `Content-Type, Authorization` headers
- **Testing**: `test_api.py` at `backend_api/core/test_api.py` (manual HTTP request script)

## Web deployment (Render)

`sage-web-cdep.onrender.com` is a Render **static site** serving `mobile_app/web-build/`, assembled by `mobile_app/scripts/build-web.js` (`npm run build:web`).

| URL | Served by |
|---|---|
| `/` | `landing_page/index.html` (real file) |
| `/styles.css` | `landing_page/styles.css` (real file) |
| `/tv` | rewrite → `app.html` → TV room-code entry |
| `/tv/<CODE>` | rewrite → `app.html` → live leaderboard |
| `/<CODE>` | rewrite → `app.html` → live leaderboard (the link educators copy) |
| anything else | rewrite → `app.html`, then `app/_layout.tsx` bounces to `/tv` |

- **The Expo shell is renamed `index.html` → `app.html` on purpose.** Render serves a rewrite's destination as a real file, so if the catch-all `/*` still pointed at `/index.html`, every unknown path would return the landing page instead of the app. The landing page needs the name `index.html`; the shell must not have it.
- **The web build is TV-only.** `app/_layout.tsx` (web-only effect) redirects any path that is not `/tv…` or a bare alphanumeric segment to `/tv`, and skips auth/offline init on web. Do not expect login/game/educator screens to be reachable on the web.
- The 109 per-route HTML files that `expo export` emits for `web.output: "static"` are **deleted** by the build script — routing is client-side, and their directories would otherwise ship to the CDN.
- Expo assets stay at the site root (`/_expo/…`, `/assets/…`) because the shell references them with root-absolute URLs.
- `render.yaml` is **not** auto-applied to an existing Render service. Either use Settings → Blueprint, or paste `buildCommand`, `staticPublishPath` and the three rewrite rules into the Dashboard by hand. Beware: the Blueprint button can offer to *create* a new service instead of updating the existing one — for `sage-web`, hand-pasting is safer.
- `npm run build:web` takes ~12 min (Metro bundles the whole app into a ~10 MB `entry-*.js`). Use `node scripts/build-web.js --skip-export` to re-run only the assembly step against the existing `mobile_app/dist`.
- Env vars the build needs (both set in `render.yaml`): `EXPO_SKIP_GOOGLE_SERVICES_CHECK=1` and `EXPO_PUBLIC_WEB_URL` (e.g. `https://sage-web-cdep.onrender.com`, no trailing slash).
  - **Why the skip var exists:** `google-services.json` is git-ignored (`mobile_app/.gitignore:7`), so it only exists in a developer's working copy and is *never* on Render's build machine. `app.config.js` throws when it's missing, to stop an Android/EAS build shipping an app with no Firebase config. A web export doesn't need it at all: config-plugin mods never run during `expo export` (only in `prebuild` / `run:android` / EAS), and the web Firebase SDK reads its config from JS. So the guard is bypassed for web only. **Never set this for an Android or EAS build** — it would silently produce a Firebase-less app.
  - `EXPO_PUBLIC_WEB_URL` is not optional: without it `getTvPageBaseUrl()` returns `''` in release builds and the educator "copy TV link" button silently does nothing.
  - **Landing-page APK link** — both green download buttons in `landing_page/index.html` carry `href="__DOWNLOAD_URL__"`; `scripts/build-web.js` (`injectDownloadUrl()`) replaces it at build time with the `DOWNLOAD_URL` env var (Dashboard-only, deliberately not in `render.yaml`, so the tokenized link stays out of git) and falls back to a baked-in default when unset. Static site = build-time only: **to change the link, edit `DOWNLOAD_URL` in the sage-web Dashboard → Env, then Actions → Manual Deploy → Clear build cache & deploy** (~12 min). `verify()` fails the build if the placeholder survives. Opening the raw `landing_page/index.html` locally shows the placeholder, not a working link.
  - `render.yaml` declares **only** the `sage-web` static site, so applying the Blueprint cannot touch the Django backend service.

## Gotchas

- `.env` with API keys is git-ignored and untracked — **still never push real secrets** (Render uses env vars / masked secrets)
- Django settings require `DJANGO_SECRET_KEY` in `.env` or server won't start
- `backend_api/core/db.sqlite3` is git-ignored (untracked). Prod data lives in AWS RDS via `DATABASE_URL`; local dev builds a fresh SQLite with `migrate`
- `Android` build command runs `scripts/patch-gradle.js` before `expo run:android` — patches wrapper to Gradle 8.13
- **`android/` is prebuild-owned and git-ignored — never hand-edit it.** Anything you put in `android/app/build.gradle`, `AndroidManifest.xml`, the gradle wrapper, etc. is reverted by the next `npx expo prebuild`, silently. That is exactly how a stale Sept-20 launcher icon survived weeks of builds (`expo run:android` skips prebuild when `android/` exists). Patch it from a script instead; `scripts/patch-gradle.js` is the existing mechanism (Gradle 8.13 wrapper + the `SAGE.apk` output name).
- The APK is named **`SAGE.apk`**, not `app-release.apk`. AGP's default would be `${moduleDir}-${variant}.apk` because the Gradle module is `:app`; `patch-gradle.js` injects an `applicationVariants` block to override it. Run the release build via `npm run android:release` (it patches first) — bare `gradlew.bat assembleRelease` skips the patch and produces `app-release.apk` again. Debug and release land in separate directories (`outputs/apk/debug/`, `outputs/apk/release/`), so the shared name is safe.
- Prebuild also bakes `backgroundColor` into `splashscreen_logo.png`. Re-run `python scripts/generate-splash.py` after any prebuild to restore the transparent wordmark. Same pattern for the themed-icon layer: `python scripts/generate-icon-monochrome.py` regenerates `android-icon-monochrome.png` from the foreground's alpha.
- Icons are generated, not hand-edited: `generate-splash.py` (wordmark) and `generate-icon-monochrome.py` (Android 13+ themed-icon silhouette). Change the artwork in `assets/images/`, re-run the script, then prebuild.
- `mobile_app/android/res/` and `mobile_app/assets/res/` are **orphans** — no build reads them (`git grep "assets/res"` → nothing), and the unanchored `android/` + `ios/` patterns in `mobile_app/.gitignore:11-12` keep them untracked. The live trees are `assets/images/*.png` → prebuild → `android/app/src/main/res/mipmap-*/`. Don't copy icons there expecting them to ship.
- Root `games.tsx` is dead code; modify `mobile_app/app/game/` instead
- No test framework exists for the mobile app (no Jest config found)

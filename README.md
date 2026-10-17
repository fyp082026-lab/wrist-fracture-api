# PediaFracture AI

AI-assisted pediatric wrist X-ray analysis: fracture detection (YOLOv8m) and bone age estimation (EfficientNet-B3).

| Part | Folder | Who uses it | Where it runs |
| --- | --- | --- | --- |
| Analysis API | `app/` | Mobile app and admin site | Docker on AWS EC2, behind nginx at `https://wristfracture.duckdns.org` |
| Admin website | `admin/` | Administrators | Served by the API at `https://wristfracture.duckdns.org/admin/` |
| Mobile app | `mobile/` | Clinicians | Android APK built by CI (Expo / React Native) |

All three share one Supabase project (auth, Postgres with RLS, private `wrist-xrays` bucket).

```
Clinician phone ──(Supabase email/password)──► Supabase Auth
      │  upload X-ray to wrist-xrays/<user>/<scan>.jpg, insert patients/scans (RLS)
      └──POST /analyze (Bearer token)──► FastAPI on EC2 ──(service role)──► Supabase
                                              │ writes analysis_results, scans.status
Admin browser ──► /admin/ (static site) ──► /admin/api/* (Bearer token, ADMIN_EMAILS only)
```

## How a scan flows

1. The app creates `patients` + `scans` rows (status `uploaded`) and uploads the re-encoded JPEG.
2. It calls `POST /analyze` with the user's access token.
3. The server checks the token and ownership, runs both models, writes `analysis_results`, and sets `scans.status` to `completed` (or `failed`).
4. The app shows the result; the admin site sees it on its next refresh (every 30 s).

## Admin access

Only emails in `ADMIN_EMAILS` can use the admin site and `/admin/api/*`. The default is set in
`docker-compose.yml` (`fyp082026@gmail.com`). To change it without editing the repo, add
`ADMIN_EMAILS=a@x.org,b@y.org` to `~/app/.env` on the server; that value wins.
An admin signs in with a normal Supabase account (create it in the app or the Supabase dashboard).

## CI/CD

| Workflow | Runs on | Does |
| --- | --- | --- |
| `CI/CD` (`deploy.yml`) | Push to `main`, `feat/**`, `fix/**`; PRs | Python syntax + admin API tests, admin site typecheck/build, Docker build. **On `main` only:** push image to GHCR, deploy to EC2 with health check and automatic rollback, then smoke-test `/health`, `/admin/` and that `/admin/api` refuses anonymous calls. |
| `Mobile app` (`mobile.yml`) | Changes under `mobile/` | Typecheck, lint, unit tests, server reachability, then a release APK. Download it from the run's **Artifacts**; builds from `main` are also attached to the `mobile-latest` release. |

Required repository secrets (already used before): `EC2_HOST`, `EC2_USER`, `EC2_SSH_KEY`. The mobile build needs none.

## One-time Supabase settings

Authentication → URL Configuration → **Redirect URLs** must contain:

- `pediafracture://**` (installed app: email confirmation and password reset)
- `exp://**` (only if you test with Expo Go)

Without these, verification and reset emails send people to the Site URL instead of the app.

## Local development

```bash
# Mobile (Expo)
cd mobile && npm ci && npm start          # scan the QR code with Expo Go
npm run check                             # typecheck + lint + tests

# Admin site (proxies API calls to the live server)
cd admin && npm ci && npm run dev         # http://localhost:5173/admin/

# Server tests (no models needed)
pip install -r requirements-dev.txt && python -m pytest tests
```

On Windows PowerShell, use `npm.cmd` / `npx.cmd` if script execution is disabled.

## Configuration

- `mobile/.env` and `admin/.env` hold only **public** values (Supabase URL, publishable key, API URL). They are committed so CI builds work with no setup.
- The **service-role key** lives only in `~/app/.env` on the EC2 server (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`) and is never committed.

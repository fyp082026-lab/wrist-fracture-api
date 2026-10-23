# PediaFracture: authentication and role-based access

This branch (`main`) is the **authentication-only** version of PediaFracture: users sign in to a
mobile app, administrators sign in to a website, and each role can only reach what it is allowed to.
The full app with X-ray analysis is kept on the **`backup/full-app`** branch.

| Part | Folder | Who uses it | Where it runs |
| --- | --- | --- | --- |
| API server | `app/` | Mobile app and admin website | Docker on AWS EC2, behind nginx at `https://wristfracture.duckdns.org` |
| Admin website | `admin/` | Admins | `https://wristfracture.duckdns.org/admin/` |
| Mobile app | `mobile/` | Users | Android APK built by CI (Expo / React Native) |
| Database setup | `db/schema.sql` | - | Supabase (auth, Postgres with Row Level Security) |

## Roles

| | User | Admin |
| --- | --- | --- |
| Signs up / in with | Mobile app | Admin website |
| Stored in | `public.profiles` | `public.admins` (from `public.admin_allowlist`) |
| Mobile app | ✅ own account and profile | ❌ refused, told to use the website |
| Admin website | ❌ refused (403) | ✅ all accounts, roles and email status |
| Database (RLS) | reads and edits only own profile | reads every profile |

Who is an admin is decided **only** by the `admin_allowlist` table in Supabase (Table Editor):
add an email to grant admin, delete the row to revoke it. Both take effect immediately.

## Authentication features

- Email + password sign-up with email verification (resend link from the app)
- Sign in, persistent session (Keychain / Keystore), automatic token refresh, sign out
- Forgot password → email link → set a new password (app and website)
- Profile: name and organisation, editable by the user
- The server verifies Supabase tokens (`GET /me`, admin API) and reports its own health (`GET /health`)

## API

| Endpoint | Access | Returns |
| --- | --- | --- |
| `GET /health` | public | server and Supabase status |
| `GET /me` | any signed-in account | the token's user id and email |
| `GET /admin/api/me` | admin | admin confirmation (403 for users) |
| `GET /admin/api/overview` | admin | user, verified, active and admin counts; sign-ups per day |
| `GET /admin/api/users` | admin | every account with role and email status |

## Demo script (5 minutes)

1. **Sign up** in the app as a new user → "Check your inbox" → open the email link on the phone.
2. **Sign in** → Home shows *Role: User*, *Email verified*, and the server verifying the session.
3. **Profile** → change name or organisation → saved.
4. **Admin website** → sign in with the user's account → refused: *"This account has the User role, not Admin"*.
5. **Admin website** → sign in as the admin → Overview and Users show the new account with role *User*.
6. **Mobile app** → sign in with the admin account → refused: *administrators use the website*.
7. **Supabase** → add the user's email to `admin_allowlist` → they can now open the admin website
   (and are refused by the app). Delete the row → back to a normal user.
8. **Forgot password** on either the app or the website → email link → new password.

## One-time setup

1. Run [`db/schema.sql`](db/schema.sql) in Supabase (SQL Editor → New query → Run). Safe to re-run.
2. Supabase → Authentication → URL Configuration → **Redirect URLs** must include
   `pediafracture://**` and `https://wristfracture.duckdns.org/admin/**` (and `exp://**` for Expo Go).
3. EC2 `~/app/.env` holds `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (never committed).

## CI/CD

| Workflow | Does |
| --- | --- |
| `CI/CD` (`deploy.yml`) | Server tests, admin website build, Docker build. On `main`: deploy to EC2 with health check, rollback and a public smoke test. |
| `Mobile app` (`mobile.yml`) | Typecheck, lint, tests, then a release APK. Builds from `main` are published as the `mobile-latest` release: `https://github.com/fyp082026-lab/wrist-fracture-api/releases/download/mobile-latest/PediaFracture.apk` |

## Local development

```bash
cd mobile && npm ci && npm start          # Expo; scan the QR code with Expo Go
npm run check                             # typecheck + lint + tests
cd admin && npm ci && npm run dev         # http://localhost:5173/admin/ (API proxied to the live server)
pip install -r requirements-dev.txt -r requirements.txt && python -m pytest tests
```

On Windows PowerShell, use `npm.cmd` / `npx.cmd` if script execution is disabled.

`mobile/.env` and `admin/.env` hold only **public** values (Supabase URL, publishable key, API URL).
The service-role key lives only on the server.

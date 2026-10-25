# PediaFracture: pediatric wrist X-ray analysis

Users scan wrist X-rays in a mobile app; the API server runs the AI models (YOLOv8 fracture
detection and EfficientNet bone-age estimation) and stores the result; administrators review every
account and scan on a website.

| Part | Folder | Who uses it | Where it runs |
| --- | --- | --- | --- |
| API server + AI models | `app/` | Mobile app and admin website | Docker on AWS EC2, behind nginx at `https://wristfracture.duckdns.org` |
| Admin website | `admin/` | Admins | `https://wristfracture.duckdns.org/admin/` |
| Mobile app | `mobile/` | Users | Android APK built by CI (Expo / React Native) |
| Database setup | `db/schema.sql` | - | Supabase (auth, Postgres, X-ray storage) |

## Roles: one table, decided in code

Every account (user or admin) is one row in **`public.profiles`**, with a `role` column of
`user` or `admin`. There are no separate admin tables. Sign-up always creates `role = 'user'`.

The database rules (RLS) only say "you can reach your own rows". What a role may do is decided
in application code, which reads `profiles.role`:

| Where | Code | Rule |
| --- | --- | --- |
| API server | `get_role()` in `app/main.py` | `/analyze` only for `user`; `/admin/api/*` only for `admin` (`require_admin` in `app/admin.py`) |
| Mobile app | `getRole()` in `mobile/services/account.ts` | an `admin` account is refused and sent to the website |
| Admin website | `App.tsx` calls `/admin/api/me` | a `user` account is refused (403) and signed out |

**Make someone an admin:** Supabase → Table Editor → `profiles` → set their `role` to `admin`.
Set it back to `user` to remove it. Users can never change their own role (the column is not
writable from the apps).

| | User | Admin |
| --- | --- | --- |
| Mobile app | ✅ scan X-rays, history, profile | ❌ refused, told to use the website |
| Admin website | ❌ refused (403) | ✅ all accounts and all scans with results |
| Signed out after | only by signing out | 30 minutes without activity (1-minute warning) |

## Analysis options

Before analysing, the user chooses which AI to run. Only the chosen model(s) run on the server,
and the choice is saved with the scan (`scans.analysis_mode`, `analysis_results.analysis_mode`).

| Option | `analysis_mode` | Model | Project module | Test result of the trained model |
| --- | --- | --- | --- | --- |
| Fracture detection | `fracture` | YOLOv8m (GRAZPEDWRI-DX) | B | precision 0.74, recall 0.53, mAP50 0.56 (all 9 classes) |
| Bone age | `bone_age` | EfficientNet-B3 (RSNA Bone Age) | C | MAE 6.9 months on 1,262 test X-rays; 83.5% within 12 months |
| Fracture + bone age | `both` | both | B + C | |
| Fusion AI | (coming soon) | bone-age-aware fracture type | D | not trained yet |

A result that did not run a model shows that part as **Not run** (never as "no fracture").

## How a scan works

1. The app uploads the X-ray to the private `wrist-xrays` bucket (`<user id>/<scan id>.jpg`) and
   creates a `patients` row and a `scans` row (`status = 'uploaded'`).
2. The app calls `POST /analyze`. The server checks the role and that the scan is the user's own,
   sets `analyzing`, runs the chosen model(s), saves the row in `analysis_results`, and sets `completed`.
3. The app shows the result. If the connection drops (for example nginx's 60 s timeout returns
   504) the app keeps reading the database for up to 2 minutes, so a result the server saved is
   still shown.

**Why results were not shown before (fixed):** the `scans` table had two status rules at once.
The old one allowed `done` but not `completed`, so the server saved the result and then failed to
mark the scan completed. It treated that as an error and marked the scan `failed`, and the app
said "Analysis failed" although the result was in the database. Migration 004 keeps one rule.
In addition, a scan with a saved result is now always shown as completed (server, website and
app), and the app accepts small rounding errors in result values instead of rejecting the result.

## API

| Endpoint | Access | Returns |
| --- | --- | --- |
| `GET /health` | public | server, Supabase and model status |
| `GET /me` | any signed-in account | id, email and role |
| `POST /analyze` | user | runs `analysis_mode` (`fracture`, `bone_age` or `both`) on one scan |
| `GET /admin/api/me` | admin | admin confirmation (403 for users) |
| `GET /admin/api/users` | admin | every account with its role |
| `GET /admin/api/scans` | admin | every scan with patient and result (filter by status or user) |
| `GET /admin/api/scans/{id}` | admin | one scan, its result and a temporary image link |

## One-time setup

1. New project: run [`db/schema.sql`](db/schema.sql) in Supabase (SQL Editor → New query → Run).
   Existing project: run the files in [`db/migrations/`](db/migrations) from 004 onwards, in order.
2. Supabase → Authentication → URL Configuration → **Redirect URLs** must include
   `pediafracture://**` and `https://wristfracture.duckdns.org/admin/**` (and `exp://**` for Expo Go).
3. EC2 `~/app/.env` holds `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (never committed).
4. EC2 `~/app/models/` holds `yolov8m_wrist_best.pt` and `bone_age_best.pt` (mounted into the container).

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

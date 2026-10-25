-- =============================================================================
-- PediaFracture - Supabase setup (full app, one users table)
-- =============================================================================
-- Run in Supabase: SQL Editor -> New query -> paste all -> Run.
-- Creates everything a NEW project needs. Safe to run again. An existing
-- project that still has public.admins / public.admin_allowlist is upgraded
-- with db/migrations/004_single_users_table.sql instead.
--
-- One table holds every account:   public.profiles (role = 'user' | 'admin')
--   user  -> mobile app (scans X-rays)
--   admin -> admin website (sees every account and scan)
-- The database only enforces OWNERSHIP ("your own rows"). What each role may
-- do is decided in code: the API server and both apps read profiles.role.
-- To make someone an admin: Table Editor -> profiles -> set role to 'admin'.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ACCOUNTS
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  hospital   text,
  role       text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table  public.profiles is 'Every account (users and admins). role decides what the account may use.';
comment on column public.profiles.role is 'user = mobile app; admin = admin website. Change it here to grant or remove admin.';
comment on column public.profiles.hospital is 'Shown as "Organisation" in the apps.';

-- Every new account gets a profile with role 'user'.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, hospital, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    nullif(new.raw_user_meta_data ->> 'hospital', ''),
    'user'
  )
  on conflict (id) do nothing;
  return new;
exception when others then
  -- Never block a sign-up; the app creates the profile itself if this failed.
  raise warning 'handle_new_user: %', sqlerrm;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Users may edit their name and organisation, never their role.
revoke insert, update on public.profiles from anon, authenticated;
grant  insert (id, full_name, hospital)         on public.profiles to authenticated;
grant  update (full_name, hospital, updated_at) on public.profiles to authenticated;

-- -----------------------------------------------------------------------------
-- 2. SCANS (written by the mobile app and the API server)
-- -----------------------------------------------------------------------------
create table if not exists public.patients (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  patient_code text,
  sex          text not null constraint patients_sex_check check (sex in ('M', 'F')),
  age_months   integer not null constraint patients_age_months_check check (age_months between 1 and 240),
  created_at   timestamptz not null default now()
);

create table if not exists public.scans (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  patient_id uuid references public.patients (id) on delete set null,
  image_path text not null,
  status     text not null default 'uploaded'
             constraint scans_status_check check (status in ('uploaded', 'analyzing', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.analysis_results (
  id                  uuid primary key default gen_random_uuid(),
  scan_id             uuid not null unique references public.scans (id) on delete cascade,
  user_id             uuid not null references auth.users (id) on delete cascade,
  fracture_detected   boolean,
  confidence          double precision,
  fracture_confidence numeric,
  low_confidence      boolean not null default false,
  fracture_type       text,
  detections          jsonb not null default '[]'::jsonb,
  bone_age_months     numeric,
  grad_cam_path       text,
  gradcam_path        text,
  model_version       text,
  clinical_disclaimer text,
  created_at          timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY: ownership only, no roles
--    The admin website never reads these tables directly; it calls the API
--    server, which checks profiles.role = 'admin' in code.
-- -----------------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.patients         enable row level security;
alter table public.scans            enable row level security;
alter table public.analysis_results enable row level security;

drop policy if exists "Users can view own profile"   on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can view own profile"   on public.profiles for select to authenticated using (id = auth.uid());
create policy "Users can insert own profile" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "Users can update own profile" on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "Users can select own patients" on public.patients;
drop policy if exists "Users can insert own patients" on public.patients;
drop policy if exists "Users can update own patients" on public.patients;
drop policy if exists "Users can delete own patients" on public.patients;
create policy "Users can select own patients" on public.patients for select to authenticated using (user_id = auth.uid());
create policy "Users can insert own patients" on public.patients for insert to authenticated with check (user_id = auth.uid());
create policy "Users can update own patients" on public.patients for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users can delete own patients" on public.patients for delete to authenticated using (user_id = auth.uid());

-- Users create scans as 'uploaded' and may retry a failed one; only the server
-- (service key) sets 'analyzing' and 'completed'.
drop policy if exists "Users can select own scans" on public.scans;
drop policy if exists "Users can insert own scans" on public.scans;
drop policy if exists "Users can update own scans" on public.scans;
drop policy if exists "Users can delete own scans" on public.scans;
create policy "Users can select own scans" on public.scans for select to authenticated using (user_id = auth.uid());
create policy "Users can insert own scans" on public.scans for insert to authenticated with check (user_id = auth.uid() and status = 'uploaded');
create policy "Users can update own scans" on public.scans for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid() and status in ('uploaded', 'failed'));
create policy "Users can delete own scans" on public.scans for delete to authenticated using (user_id = auth.uid());

-- Results are written only by the server.
drop policy if exists "Users can view own analysis results" on public.analysis_results;
create policy "Users can view own analysis results" on public.analysis_results for select to authenticated
  using (scan_id in (select id from public.scans where user_id = auth.uid()));

-- -----------------------------------------------------------------------------
-- 4. X-RAY STORAGE: private bucket, one folder per user (<user id>/<file>)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('wrist-xrays', 'wrist-xrays', false)
on conflict (id) do nothing;

drop policy if exists "xray read own"   on storage.objects;
drop policy if exists "xray upload own" on storage.objects;
drop policy if exists "xray delete own" on storage.objects;
drop policy if exists "xray update own" on storage.objects;
create policy "xray read own" on storage.objects for select to authenticated
  using (bucket_id = 'wrist-xrays' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "xray upload own" on storage.objects for insert to authenticated
  with check (bucket_id = 'wrist-xrays' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "xray delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'wrist-xrays' and (storage.foldername(name))[1] = auth.uid()::text);
-- Needed because the app uploads with upsert (a retried upload replaces the file).
create policy "xray update own" on storage.objects for update to authenticated
  using (bucket_id = 'wrist-xrays' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'wrist-xrays' and (storage.foldername(name))[1] = auth.uid()::text);

-- -----------------------------------------------------------------------------
-- 5. Refresh the API and show a summary
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';

select role, count(*) as accounts from public.profiles group by role order by role;

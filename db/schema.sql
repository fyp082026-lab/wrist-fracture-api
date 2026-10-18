-- =============================================================================
-- PediaFracture AI - complete Supabase setup
-- =============================================================================
-- Run in Supabase: SQL Editor -> New query -> paste all -> Run.
--
-- SAFE ON AN EXISTING PROJECT: it creates what is missing and never deletes
-- data. Every step can be run again (idempotent). It also includes
-- db/migrations/001, so running this alone is enough.
--
-- Who is who:
--   * Clinicians  -> sign up in the MOBILE APP  -> row in public.profiles
--   * Admins      -> use the ADMIN WEBSITE      -> row in public.admins
--   An email listed in public.admin_allowlist becomes an admin when it signs
--   up (or now, if it already exists) and gets NO clinician profile.
--
-- Data flow (matches the app and the API):
--   app (clinician token, RLS) : insert patients + scans (status 'uploaded'),
--                                upload wrist-xrays/<user_id>/<scan_id>.jpg,
--                                may set its own scan to 'failed'
--   API (service key, no RLS)  : sets 'analyzing'/'completed'/'failed',
--                                writes analysis_results
--   admin website              : reads everything through the API
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. ADMINS (kept separate from clinicians)
-- -----------------------------------------------------------------------------
create table if not exists public.admin_allowlist (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);

create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null unique,
  full_name  text,
  created_at timestamptz not null default now()
);

-- The administrator for this project. Add more rows to add more admins.
insert into public.admin_allowlist (email, note)
values ('fyp082026@gmail.com', 'Project administrator')
on conflict (email) do nothing;

-- True when the signed-in user is an admin. SECURITY DEFINER so it works
-- inside RLS policies without exposing the admins table.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

-- -----------------------------------------------------------------------------
-- 2. CLINICIAN PROFILES
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  full_name  text,
  hospital   text,
  created_at timestamptz not null default now()
);
alter table public.profiles add column if not exists full_name  text;
alter table public.profiles add column if not exists hospital   text;
alter table public.profiles add column if not exists created_at timestamptz not null default now();
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

-- -----------------------------------------------------------------------------
-- 3. SIGN-UP: admin or clinician
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.admin_allowlist where lower(email) = lower(new.email)) then
    insert into public.admins (user_id, email, full_name)
    values (new.id, lower(new.email), new.raw_user_meta_data ->> 'full_name')
    on conflict (user_id) do nothing;
  else
    insert into public.profiles (id, full_name, hospital)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
      nullif(new.raw_user_meta_data ->> 'hospital', '')
    )
    on conflict (id) do nothing;
  end if;
  return new;
exception when others then
  -- Never block a sign-up because of profile bookkeeping; the app creates
  -- the profile itself on first sign-in if this failed.
  raise warning 'handle_new_user: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Existing accounts: promote allow-listed emails that already signed up.
insert into public.admins (user_id, email, full_name)
select u.id, lower(u.email), u.raw_user_meta_data ->> 'full_name'
  from auth.users u
  join public.admin_allowlist a on lower(a.email) = lower(u.email)
on conflict (user_id) do nothing;

-- Existing clinicians without a profile row get one.
insert into public.profiles (id, full_name, hospital)
select u.id,
       coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
       nullif(u.raw_user_meta_data ->> 'hospital', '')
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id)
   and not exists (select 1 from public.admins a where a.user_id = u.id)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 4. PATIENTS (pseudonymous: a code, age in months and sex; never names)
-- -----------------------------------------------------------------------------
create table if not exists public.patients (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users (id) on delete cascade,
  patient_code text,
  age_months   integer not null,
  sex          text not null,
  created_at   timestamptz not null default now()
);
alter table public.patients add column if not exists patient_code text;
alter table public.patients add column if not exists created_at timestamptz not null default now();

-- -----------------------------------------------------------------------------
-- 5. SCANS (id is generated by the app and reused on retries)
-- -----------------------------------------------------------------------------
create table if not exists public.scans (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  patient_id  uuid references public.patients (id) on delete set null,
  image_path  text not null,
  status      text not null default 'uploaded',
  created_at  timestamptz not null default now()
);
alter table public.scans add column if not exists created_at timestamptz not null default now();
alter table public.scans add column if not exists updated_at timestamptz not null default now();
alter table public.scans alter column status set default 'uploaded';

-- -----------------------------------------------------------------------------
-- 6. ANALYSIS RESULTS (written only by the API)
-- -----------------------------------------------------------------------------
create table if not exists public.analysis_results (
  id                  uuid primary key default gen_random_uuid(),
  scan_id             uuid not null references public.scans (id) on delete cascade,
  user_id             uuid references auth.users (id) on delete cascade,
  fracture_detected   boolean not null default false,
  confidence          double precision,
  detections          jsonb not null default '[]'::jsonb,
  fracture_type       text,
  bone_age_months     double precision,
  grad_cam_path       text,
  clinical_disclaimer text,
  created_at          timestamptz not null default now()
);
-- Columns from the newer layout (no-ops if present)...
alter table public.analysis_results add column if not exists user_id             uuid;
alter table public.analysis_results add column if not exists confidence          double precision;
alter table public.analysis_results add column if not exists detections          jsonb not null default '[]'::jsonb;
alter table public.analysis_results add column if not exists fracture_type       text;
alter table public.analysis_results add column if not exists grad_cam_path       text;
alter table public.analysis_results add column if not exists clinical_disclaimer text;
alter table public.analysis_results add column if not exists created_at          timestamptz not null default now();
-- ...and the original layout's columns, which the API also keeps filled.
alter table public.analysis_results add column if not exists fracture_confidence double precision;
alter table public.analysis_results add column if not exists gradcam_path        text;
alter table public.analysis_results add column if not exists model_version       text;

update public.analysis_results
   set confidence = fracture_confidence::double precision
 where confidence is null and fracture_confidence is not null;

-- Fill user_id on old rows from their scan.
update public.analysis_results r
   set user_id = s.user_id
  from public.scans s
 where r.scan_id = s.id and r.user_id is null;

-- -----------------------------------------------------------------------------
-- 7. CONSTRAINTS AND INDEXES
--    Added NOT VALID: enforced for new rows without failing on old ones.
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'patients_sex_check_v2') then
    alter table public.patients add constraint patients_sex_check_v2
      check (sex in ('M', 'F')) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'patients_age_months_check_v2') then
    alter table public.patients add constraint patients_age_months_check_v2
      check (age_months between 1 and 240) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'scans_status_check_v2') then
    alter table public.scans add constraint scans_status_check_v2
      check (status in ('uploaded', 'analyzing', 'completed', 'failed')) not valid;
  end if;
end $$;

-- One result per scan (the API upserts on scan_id). Skipped with a notice if
-- already unique or if old duplicate rows exist.
do $$
begin
  if exists (
    select 1 from pg_index i
      join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
     where i.indrelid = 'public.analysis_results'::regclass
       and i.indisunique and i.indnatts = 1 and a.attname = 'scan_id'
  ) then
    raise notice 'analysis_results.scan_id already unique';
  elsif exists (select scan_id from public.analysis_results group by scan_id having count(*) > 1) then
    raise notice 'Duplicate scan_id rows in analysis_results: unique index NOT created. Remove duplicates and run again.';
  else
    create unique index analysis_results_scan_id_key on public.analysis_results (scan_id);
  end if;
end $$;

create index if not exists patients_user_id_idx       on public.patients (user_id);
create index if not exists scans_user_created_idx     on public.scans (user_id, created_at desc);
create index if not exists scans_status_idx           on public.scans (status);
create index if not exists analysis_results_user_idx  on public.analysis_results (user_id);

-- -----------------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY
--    Clinicians: only their own rows. Admins: read everything.
--    The API uses the service key and is not affected by RLS.
-- -----------------------------------------------------------------------------
alter table public.admin_allowlist  enable row level security;
alter table public.admins           enable row level security;
alter table public.profiles         enable row level security;
alter table public.patients         enable row level security;
alter table public.scans            enable row level security;
alter table public.analysis_results enable row level security;

-- Remove temporary "anon" test policies from early development (if present):
-- they let anyone without an account read or write clinical data.
drop policy if exists "Allow anon insert on patients"         on public.patients;
drop policy if exists "Allow anon select on patients"         on public.patients;
drop policy if exists "Allow anon insert on scans"            on public.scans;
drop policy if exists "Allow anon select on scans"            on public.scans;
drop policy if exists "Allow anon update on scans"            on public.scans;
drop policy if exists "Allow anon insert on analysis_results" on public.analysis_results;
drop policy if exists "Allow anon select on analysis_results" on public.analysis_results;

-- admins / allowlist: an admin can see their own admin row; nobody writes from clients.
drop policy if exists "Admins read own admin row" on public.admins;
create policy "Admins read own admin row" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- profiles
drop policy if exists "Users can view own profile"   on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
drop policy if exists "Admins can view all profiles" on public.profiles;
create policy "Users can view own profile" on public.profiles
  for select to authenticated using (id = auth.uid());
create policy "Users can insert own profile" on public.profiles
  for insert to authenticated with check (id = auth.uid() and not public.is_admin());
create policy "Users can update own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
create policy "Admins can view all profiles" on public.profiles
  for select to authenticated using (public.is_admin());

-- patients
drop policy if exists "Users can select own patients" on public.patients;
drop policy if exists "Users can insert own patients" on public.patients;
drop policy if exists "Users can update own patients" on public.patients;
drop policy if exists "Users can delete own patients" on public.patients;
drop policy if exists "Admins can view all patients"  on public.patients;
create policy "Users can select own patients" on public.patients
  for select to authenticated using (user_id = auth.uid());
create policy "Users can insert own patients" on public.patients
  for insert to authenticated with check (user_id = auth.uid());
create policy "Users can update own patients" on public.patients
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users can delete own patients" on public.patients
  for delete to authenticated using (user_id = auth.uid());
create policy "Admins can view all patients" on public.patients
  for select to authenticated using (public.is_admin());

-- scans: the app inserts 'uploaded' and may only move its own scan to 'failed'.
drop policy if exists "Users can select own scans" on public.scans;
drop policy if exists "Users can insert own scans" on public.scans;
drop policy if exists "Users can update own scans" on public.scans;
drop policy if exists "Users can delete own scans" on public.scans;
drop policy if exists "Admins can view all scans"  on public.scans;
create policy "Users can select own scans" on public.scans
  for select to authenticated using (user_id = auth.uid());
create policy "Users can insert own scans" on public.scans
  for insert to authenticated with check (user_id = auth.uid() and status = 'uploaded');
create policy "Users can update own scans" on public.scans
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid() and status in ('uploaded', 'failed'));
create policy "Users can delete own scans" on public.scans
  for delete to authenticated using (user_id = auth.uid());
create policy "Admins can view all scans" on public.scans
  for select to authenticated using (public.is_admin());

-- analysis_results: read-only for clients.
drop policy if exists "Users can view own analysis results" on public.analysis_results;
drop policy if exists "Admins can view all analysis results" on public.analysis_results;
create policy "Users can view own analysis results" on public.analysis_results
  for select to authenticated
  using (scan_id in (select id from public.scans where user_id = auth.uid()));
create policy "Admins can view all analysis results" on public.analysis_results
  for select to authenticated using (public.is_admin());

-- -----------------------------------------------------------------------------
-- 9. STORAGE: private bucket, one folder per clinician (<user_id>/<scan_id>.jpg)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wrist-xrays', 'wrist-xrays', false, 20971520, array['image/jpeg', 'image/png'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Clinicians upload own x-rays" on storage.objects;
drop policy if exists "Clinicians read own x-rays"   on storage.objects;
drop policy if exists "Clinicians update own x-rays" on storage.objects;
drop policy if exists "Clinicians delete own x-rays" on storage.objects;
drop policy if exists "Admins read all x-rays"       on storage.objects;
create policy "Clinicians upload own x-rays" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'wrist-xrays' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Clinicians read own x-rays" on storage.objects
  for select to authenticated
  using (bucket_id = 'wrist-xrays' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Clinicians update own x-rays" on storage.objects
  for update to authenticated
  using (bucket_id = 'wrist-xrays' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Clinicians delete own x-rays" on storage.objects
  for delete to authenticated
  using (bucket_id = 'wrist-xrays' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "Admins read all x-rays" on storage.objects
  for select to authenticated
  using (bucket_id = 'wrist-xrays' and public.is_admin());

-- -----------------------------------------------------------------------------
-- 10. Refresh the API's view of the schema
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- Summary (shown as the result of the run).
select
  (select count(*) from public.admins)            as admins,
  (select count(*) from public.profiles)          as clinician_profiles,
  (select count(*) from public.patients)          as patients,
  (select count(*) from public.scans)             as scans,
  (select count(*) from public.analysis_results)  as analysis_results;

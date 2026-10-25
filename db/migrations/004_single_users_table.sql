-- One users table with a role column; role decisions move into application code.
--
--   public.profiles.role  = 'user' | 'admin'   (the only place a role is stored)
--   Sign-up always creates role 'user'. To make someone an admin, set their
--   role to 'admin' in Table Editor -> profiles.
--   Users may edit only their own full_name and hospital (never role).
--
-- Replaces: public.admins, public.admin_allowlist, public.is_admin(), the
-- allowlist sync trigger and every role-based RLS policy. Database rules that
-- remain are ownership only ("your own rows"); the API server and the apps
-- read profiles.role and decide in code.
--
-- Safe to run more than once. It does NOT drop the old admins and
-- admin_allowlist tables; after checking the result, drop them with the two
-- statements at the very end of this file.

-- 1. Role column ------------------------------------------------------------
alter table public.profiles add column if not exists role text not null default 'user';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_role_check') then
    alter table public.profiles add constraint profiles_role_check check (role in ('user', 'admin'));
  end if;
end $$;
comment on table  public.profiles is 'Every account (users and admins). role decides what the account may use.';
comment on column public.profiles.role is 'user = mobile app; admin = admin website. Change it here to grant or remove admin.';
comment on column public.profiles.hospital is 'Shown as "Organisation" in the apps.';

-- 2. Move existing admins into profiles (if the old table still exists) --------
do $$
begin
  if to_regclass('public.admins') is not null then
    insert into public.profiles (id, full_name, role)
    select a.user_id, a.full_name, 'admin' from public.admins a
    on conflict (id) do update set role = 'admin';
  end if;
end $$;

-- Every account has exactly one profile row.
insert into public.profiles (id, full_name, hospital, role)
select u.id,
       coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
       nullif(u.raw_user_meta_data ->> 'hospital', ''),
       'user'
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id)
on conflict (id) do nothing;

-- 3. Sign-up: every new account is a user -------------------------------------
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
  raise warning 'handle_new_user: %', sqlerrm;
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4. Users can never change their own role ------------------------------------
revoke insert, update on public.profiles from anon, authenticated;
grant  insert (id, full_name, hospital)             on public.profiles to authenticated;
grant  update (full_name, hospital, updated_at)     on public.profiles to authenticated;

-- 5. Remove role logic from the database --------------------------------------
drop policy if exists "Admins can view all profiles"         on public.profiles;
drop policy if exists "Admins can view all patients"         on public.patients;
drop policy if exists "Admins can view all scans"            on public.scans;
drop policy if exists "Admins can view all analysis results" on public.analysis_results;
drop policy if exists "Admins read all x-rays"               on storage.objects;
do $$
begin
  if to_regclass('public.admins') is not null then
    drop policy if exists "Admins read own admin row" on public.admins;
  end if;
end $$;

-- Profile insert rule no longer calls is_admin(): ownership only.
drop policy if exists "Users can insert own profile" on public.profiles;
create policy "Users can insert own profile" on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- Old duplicate rules from early development (looser than the named ones).
drop policy if exists "own scans"        on public.scans;
drop policy if exists "own patients"     on public.patients;
drop policy if exists "read own results" on public.analysis_results;

-- Storage had each x-ray rule twice ("Clinicians ..." and "xray ..."); keep one set.
drop policy if exists "xray update own" on storage.objects;
create policy "xray update own" on storage.objects for update to authenticated
  using (bucket_id = 'wrist-xrays' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'wrist-xrays' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Clinicians read own x-rays"   on storage.objects;
drop policy if exists "Clinicians upload own x-rays" on storage.objects;
drop policy if exists "Clinicians update own x-rays" on storage.objects;
drop policy if exists "Clinicians delete own x-rays" on storage.objects;

do $$
begin
  if to_regclass('public.admin_allowlist') is not null then
    drop trigger if exists admin_allowlist_sync on public.admin_allowlist;
  end if;
end $$;
drop function if exists public.sync_admin_allowlist();
drop function if exists public.is_admin();

-- 6. One status rule and one age rule ------------------------------------------
-- The old scans_status_check allowed 'done' but not 'completed'. It was left in
-- place next to a newer rule, and Postgres enforces both, so the server could
-- save a result but never mark its scan completed: the scan ended up 'failed'
-- and the app never showed the saved result. Same duplication on patients.
update public.scans set status = 'completed' where status = 'done';
alter table public.scans    drop constraint if exists scans_status_check;
alter table public.patients drop constraint if exists patients_age_months_check;
alter table public.patients drop constraint if exists patients_sex_check_v2;
do $
begin
  if exists (select 1 from pg_constraint where conname = 'scans_status_check_v2') then
    alter table public.scans rename constraint scans_status_check_v2 to scans_status_check;
  else
    alter table public.scans add constraint scans_status_check
      check (status in ('uploaded', 'analyzing', 'completed', 'failed')) not valid;
  end if;
  if exists (select 1 from pg_constraint where conname = 'patients_age_months_check_v2') then
    alter table public.patients rename constraint patients_age_months_check_v2 to patients_age_months_check;
  else
    alter table public.patients add constraint patients_age_months_check
      check (age_months between 1 and 240) not valid;
  end if;
end $;
alter table public.scans    validate constraint scans_status_check;
alter table public.patients validate constraint patients_age_months_check;

notify pgrst, 'reload schema';

-- Check: one row per account, roles as expected.
select p.role, count(*) as accounts
  from public.profiles p
 group by p.role
 order by p.role;

-- ---------------------------------------------------------------------------
-- After checking the result above, remove the two old tables:
--   drop table if exists public.admin_allowlist;
--   drop table if exists public.admins;
-- ---------------------------------------------------------------------------

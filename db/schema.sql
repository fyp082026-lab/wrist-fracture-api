-- =============================================================================
-- PediaFracture - Supabase setup: AUTHENTICATION AND ROLE-BASED ACCESS
-- =============================================================================
-- Run in Supabase: SQL Editor -> New query -> paste all -> Run.
-- Safe on an existing project and safe to run again: it only creates or
-- updates auth objects. It does NOT touch the scan tables (patients, scans,
-- analysis_results) or the X-ray storage bucket; those belong to the full app
-- on the backup/full-app branch and keep their data.
--
-- Two roles, stored separately:
--   USER  -> signs up in the MOBILE APP     -> row in public.profiles
--   ADMIN -> signs in to the ADMIN WEBSITE  -> row in public.admins
-- Who is an admin is decided ONLY by public.admin_allowlist:
--   add an email    -> that account becomes an admin at once
--                      (or as soon as it signs up)
--   delete the row  -> admin access is removed at once
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ADMINS
-- -----------------------------------------------------------------------------
create table if not exists public.admin_allowlist (
  email      text primary key,
  note       text,
  created_at timestamptz not null default now()
);
comment on table public.admin_allowlist is
  'Emails that have the Admin role. Add or delete rows here to grant or revoke admin access.';

create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  email      text not null unique,
  full_name  text,
  created_at timestamptz not null default now()
);
comment on table public.admins is
  'Accounts with the Admin role (kept in sync with admin_allowlist automatically).';

-- First admin, only when the list is empty (a fresh project). After that,
-- manage admins in Table Editor -> admin_allowlist; re-running this script
-- never re-adds an email you removed.
insert into public.admin_allowlist (email, note)
select 'fyp082026@gmail.com', 'Initial administrator'
 where not exists (select 1 from public.admin_allowlist);

-- True when the signed-in account has the Admin role. Used by RLS policies
-- and by the mobile app (which refuses admin accounts).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;
-- Only signed-in accounts may call it (it only reveals the caller's own role).
revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated;

-- Keep admins in sync with admin_allowlist.
create or replace function public.sync_admin_allowlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('DELETE', 'UPDATE') then
    delete from public.admins where lower(email) = lower(old.email);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    insert into public.admins (user_id, email, full_name)
    select u.id, lower(u.email), u.raw_user_meta_data ->> 'full_name'
      from auth.users u
     where lower(u.email) = lower(new.email)
    on conflict (user_id) do nothing;
  end if;
  return null;
end;
$$;

drop trigger if exists admin_allowlist_sync on public.admin_allowlist;
create trigger admin_allowlist_sync
  after insert or update or delete on public.admin_allowlist
  for each row execute function public.sync_admin_allowlist();

-- Runs only as a trigger; never callable through the API.
revoke execute on function public.sync_admin_allowlist() from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. USER PROFILES (role: user)
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
comment on table public.profiles is 'Profiles of users (role: user) who sign up in the mobile app.';
comment on column public.profiles.hospital is 'Shown as "Organisation" in the app and admin website.';

-- -----------------------------------------------------------------------------
-- 3. SIGN-UP: decide the role of every new account
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
  -- Never block a sign-up; the app creates the profile itself if this failed.
  raise warning 'handle_new_user: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Runs only as a trigger; never callable through the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Bring existing accounts in line: admins from the list, profiles for users.
delete from public.admins a
 where not exists (select 1 from public.admin_allowlist l where lower(l.email) = lower(a.email));

insert into public.admins (user_id, email, full_name)
select u.id, lower(u.email), u.raw_user_meta_data ->> 'full_name'
  from auth.users u
  join public.admin_allowlist l on lower(l.email) = lower(u.email)
on conflict (user_id) do nothing;

-- Admins have no user profile (removes rows created before the role split).
delete from public.profiles p
 using public.admins a
 where p.id = a.user_id;

insert into public.profiles (id, full_name, hospital)
select u.id,
       coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name'),
       nullif(u.raw_user_meta_data ->> 'hospital', '')
  from auth.users u
 where not exists (select 1 from public.profiles p where p.id = u.id)
   and not exists (select 1 from public.admins a where a.user_id = u.id)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 4. ROW LEVEL SECURITY (who can read or change what)
--    User : only their own profile.     Admin : can read every profile.
--    Nobody writes the admin tables from the app or website.
-- -----------------------------------------------------------------------------
alter table public.admin_allowlist enable row level security;
alter table public.admins          enable row level security;
alter table public.profiles        enable row level security;

drop policy if exists "Admins read own admin row" on public.admins;
create policy "Admins read own admin row" on public.admins
  for select to authenticated using (user_id = auth.uid());

-- Old catch-all policy from early development (replaced by the ones below).
drop policy if exists "own profile"                  on public.profiles;
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

-- -----------------------------------------------------------------------------
-- 5. Refresh the API and show a summary
-- -----------------------------------------------------------------------------
notify pgrst, 'reload schema';

select
  (select count(*) from auth.users)          as total_accounts,
  (select count(*) from public.admins)       as admins,
  (select count(*) from public.profiles)     as user_profiles,
  (select string_agg(email, ', ') from public.admin_allowlist) as admin_emails;

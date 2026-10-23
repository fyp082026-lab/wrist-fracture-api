-- Applied to the live project on 2026-10-23 (also folded into db/schema.sql).

-- 1. Remove the old catch-all profile policy (the named user/admin policies replace it).
drop policy if exists "own profile" on public.profiles;

-- 2. Admins have no user profile: remove profile rows that belong to admin accounts.
delete from public.profiles p
 using public.admins a
 where p.id = a.user_id;

-- 3. Lock down SECURITY DEFINER functions.
revoke execute on function public.handle_new_user()      from public, anon, authenticated;
revoke execute on function public.sync_admin_allowlist() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;
grant  execute on function public.is_admin() to authenticated;

notify pgrst, 'reload schema';

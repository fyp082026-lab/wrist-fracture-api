-- Makes public.admin_allowlist the single control for who is an admin.
--   * add an email      -> that account is an admin immediately (if it exists;
--                          otherwise as soon as it signs up)
--   * remove an email   -> admin access is removed immediately
--   * change an email   -> treated as remove + add
-- Edit the table in Supabase: Table Editor -> admin_allowlist.
-- Safe to run more than once.

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

-- Bring admins in line with the list as it is now.
delete from public.admins a
 where not exists (select 1 from public.admin_allowlist l where lower(l.email) = lower(a.email));

insert into public.admins (user_id, email, full_name)
select u.id, lower(u.email), u.raw_user_meta_data ->> 'full_name'
  from auth.users u
  join public.admin_allowlist l on lower(l.email) = lower(u.email)
on conflict (user_id) do nothing;

notify pgrst, 'reload schema';

select l.email,
       (a.user_id is not null) as is_admin_now,
       case when a.user_id is null then 'will become admin when this email signs up' else 'active' end as state
  from public.admin_allowlist l
  left join public.admins a on lower(a.email) = lower(l.email)
 order by l.email;

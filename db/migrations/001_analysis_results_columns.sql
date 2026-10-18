-- Brings public.analysis_results in line with what the API writes and the
-- mobile app / admin site read. Safe to run more than once; it only ADDS
-- columns, an index and a read policy. Existing rows are kept.
--
-- Run in Supabase: SQL Editor -> New query -> paste -> Run.

-- 1. Columns the API writes (previous layout had fracture_confidence and
--    gradcam_path only, and nowhere to store the detection boxes).
alter table public.analysis_results
  add column if not exists confidence          double precision,
  add column if not exists detections          jsonb not null default '[]'::jsonb,
  add column if not exists fracture_type       text,
  add column if not exists clinical_disclaimer text,
  add column if not exists grad_cam_path       text;

-- Copy existing confidence values into the new column.
update public.analysis_results
   set confidence = fracture_confidence::double precision
 where confidence is null and fracture_confidence is not null;

-- 2. One result per scan: the API saves with upsert ... on conflict (scan_id).
create unique index if not exists analysis_results_scan_id_key
  on public.analysis_results (scan_id);

-- 3. Clinicians can read results for their own scans (the app's History and
--    result screens). The API writes with the service key, which bypasses RLS.
alter table public.analysis_results enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'analysis_results'
       and policyname = 'Users can view own analysis results'
  ) then
    create policy "Users can view own analysis results"
      on public.analysis_results for select to authenticated
      using (scan_id in (select id from public.scans where user_id = auth.uid()));
  end if;
end $$;

-- 4. Make the new columns visible to the API immediately.
notify pgrst, 'reload schema';

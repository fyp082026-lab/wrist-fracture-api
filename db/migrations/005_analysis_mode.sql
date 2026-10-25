-- Which AI models a scan runs (Modules B and C of the project, separately or together).
--
--   fracture : YOLOv8m fracture detection only           (Module B)
--   bone_age : EfficientNet-B3 bone age estimation only  (Module C)
--   both     : both models on the same X-ray
--
-- The bone-age-aware fusion model (Module D) is not trained yet; it will get its
-- own mode when it is. Existing scans ran both models, hence the default.
-- Safe to run more than once.

alter table public.scans
  add column if not exists analysis_mode text not null default 'both';
alter table public.analysis_results
  add column if not exists analysis_mode text not null default 'both';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'scans_analysis_mode_check') then
    alter table public.scans add constraint scans_analysis_mode_check
      check (analysis_mode in ('fracture', 'bone_age', 'both'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'analysis_results_analysis_mode_check') then
    alter table public.analysis_results add constraint analysis_results_analysis_mode_check
      check (analysis_mode in ('fracture', 'bone_age', 'both'));
  end if;
end $$;

comment on column public.scans.analysis_mode is
  'fracture = fracture detection only, bone_age = bone age only, both = both models.';
comment on column public.analysis_results.fracture_detected is
  'null when fracture detection was not run (analysis_mode = bone_age).';

notify pgrst, 'reload schema';

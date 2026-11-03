-- =====================================================================
-- PSICOSTUDIOS · 02_tareas_automaticas.sql
-- Programa las tareas que corren solas en Supabase:
--   · cada 5 minutos: libera las reservas sin seña y las solicitudes de fijo vencidas
--   · todos los días a las 3:00 (hora Argentina): extiende los fijos 12 semanas adelante
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Se puede correr más de una vez sin problema (borra y vuelve a crear las tareas).
-- Requiere haber corrido antes 01_base.sql.
-- =====================================================================

create extension if not exists pg_cron;

-- Si ya existían, se borran para no duplicarlas
select cron.unschedule(jobid) from cron.job
where jobname in ('psicostudios-liberar-vencidas', 'psicostudios-extender-fijos');

select cron.schedule(
  'psicostudios-liberar-vencidas',
  '*/5 * * * *',
  $$ select public.liberar_vencidas() $$
);

-- pg_cron usa hora UTC: 06:00 UTC = 03:00 en Argentina
select cron.schedule(
  'psicostudios-extender-fijos',
  '0 6 * * *',
  $$ select public.extender_fijos() $$
);

select jobname, schedule from cron.job where jobname like 'psicostudios-%';

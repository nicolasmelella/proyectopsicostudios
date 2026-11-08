-- Pruebas de 19_sin_subida_web.sql (al final, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/19_sin_subida_web.sql
\set QUIET 1
\o /dev/null
set role anon;
select pg_temp.espera_error($$insert into storage.objects (bucket_id, name) values ('comprobantes', '1/' || gen_random_uuid() || '/x.jpg')$$, 'row-level security');
select pg_temp.espera_error($$select public.registrar_comprobante(1, gen_random_uuid(), 'x')$$, 'permission denied');
reset role;
\o
select 'PRUEBAS DE SIN SUBIDA WEB PASARON' as resultado;

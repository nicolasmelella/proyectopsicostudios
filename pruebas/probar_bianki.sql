-- Pruebas de 24_bianki.sql (al final, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/24_bianki.sql
\set QUIET 1
\o /dev/null
set role anon;
select pg_temp.espera_error($$select public.bianki_permitir('x')$$, 'permission denied');
select pg_temp.espera_error($$select * from public.bianki_usos$$, 'permission denied');
reset role;
update public.config set valor = '3' where clave = 'bianki_max_por_hora';
set role service_role;
select pg_temp.ok(public.bianki_permitir('persona-a') and public.bianki_permitir('persona-a') and public.bianki_permitir('persona-a'), 'deja pasar hasta el límite por hora');
select pg_temp.ok(not public.bianki_permitir('persona-a'), 'la cuarta consulta de la misma persona en la hora: no');
select pg_temp.ok(public.bianki_permitir('persona-b'), 'otra persona sigue pudiendo');
reset role;
update public.config set valor = '4' where clave = 'bianki_max_por_dia';
set role service_role;
select pg_temp.ok(not public.bianki_permitir('persona-c'), 'tope del día entre todas las personas');
reset role;
update public.config set valor = 'no' where clave = 'bianki_activo';
set role service_role;
select pg_temp.ok(not public.bianki_permitir('persona-d'), 'apagada: no usa la IA');
reset role;
update public.config set valor = 'si' where clave = 'bianki_activo';
update public.config set valor = '20' where clave = 'bianki_max_por_hora';
update public.config set valor = '800' where clave = 'bianki_max_por_dia';
delete from public.bianki_usos;
\o
select 'PRUEBAS DE BIANKI (LÍMITES) PASARON' as resultado;

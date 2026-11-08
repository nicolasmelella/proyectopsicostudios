-- Pruebas de 14_permisos_finos.sql (después de probar_equipo.sql, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/14_permisos_finos.sql
\set QUIET 1
\o /dev/null
set role anon;
select pg_temp.espera_error($$select public.aviso_fijo()$$, 'permission denied');
reset role;
-- Los disparadores siguen andando: cancelar una reserva vigente genera su aviso
create temp table perm_antes as select count(*) n from public.avisos where tipo = 'reserva_cancelada';
grant select on perm_antes to authenticated;
create temp table perm_reserva as select id from public.reservas
  where estado in ('pendiente', 'confirmada') and origen = 'panel' and profesional_id in (select id from public.profesionales where email is not null or whatsapp is not null) limit 1;
grant select on perm_reserva to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select public.cancelar_reserva((select id from perm_reserva), 'Prueba de permisos');
reset role;
select pg_temp.ok((select count(*) from public.avisos where tipo = 'reserva_cancelada') > (select n from perm_antes),
                  'con las funciones internas cerradas, los avisos se siguen generando solos');
\o
select 'PRUEBAS DE PERMISOS PASARON' as resultado;

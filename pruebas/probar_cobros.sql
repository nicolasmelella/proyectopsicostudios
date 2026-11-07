-- Pruebas de 10_quien_cobro.sql (después de probar_semana.sql, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/10_quien_cobro.sql
\set QUIET 1
\o /dev/null

set role authenticated;
select set_config('request.jwt.claim.sub', :'id_bianca', false);
create temp table cb as select public.cargar_reserva('Rita Cobro', '1170008888', 3::smallint,
  (select lunes + 2 from sem), array[10, 11]::smallint[], 8500, 'efectivo') as id;
grant select on cb to authenticated;
select pg_temp.espera_error($$select public.marcar_quien_recibio('Pepe', null, (select id from cb))$$, 'COBRADOR_INVALIDO');
select pg_temp.ok((select public.marcar_quien_recibio('silvia', null, (select id from cb)) = 1), 'se marca quién recibió la seña de una reserva nueva');
reset role;
select pg_temp.ok((select recibio = 'Silvia' from public.pagos where reserva_id = (select id from cb)), 'queda guardado con el nombre de la lista (Silvia)');

set role authenticated;
create temp table pg2 as select public.registrar_pago(8500, 'transferencia', (select id from cb)) as id;
grant select on pg2 to authenticated;
select public.marcar_quien_recibio('Nico', (select id from pg2));
select pg_temp.ok((select public.marcar_quien_recibio('Silvia', (select id from pg2)) = 0), 'un pago que ya tiene quién lo recibió no se pisa');
select set_config('request.jwt.claim.sub', :'id_intruso', false);
select pg_temp.espera_error($$select public.marcar_quien_recibio('Nico', (select id from pg2))$$, 'NO_AUTORIZADO');
reset role;
select pg_temp.ok((select recibio = 'Nico' from public.pagos where id = (select id from pg2)), 'el saldo quedó a nombre de Nico');
set role anon;
select pg_temp.espera_error($$select public.marcar_quien_recibio('Nico', 1)$$, 'permission denied');
reset role;

\ir ../supabase/10_quien_cobro.sql
\set QUIET 1
\o
select 'PRUEBAS DE A QUIÉN LE PAGARON PASARON' as resultado;

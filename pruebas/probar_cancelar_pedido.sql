-- Pruebas de 15_cancelar_pedido.sql (después de probar_permisos.sql, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/15_cancelar_pedido.sql
\set QUIET 1
\o /dev/null

create temp table cp_dia as
select (public.hoy_ar() + ((8 - extract(isodow from public.hoy_ar())::int) % 7) + 21)::date as lunes;
grant select on cp_dia to anon, service_role, authenticated;

set role anon;
create temp table cp1 as select public.crear_pedido('Cata Cancela', '1188009900', 'Psicóloga', 'cata@prueba.com',
  (select jsonb_build_array(jsonb_build_object('fecha', lunes, 'horas', jsonb_build_array(8, 9), 'consultorio', 4)) from cp_dia)) as j;
grant select on cp1 to service_role, authenticated;
-- Sin el código correcto no se puede
select pg_temp.espera_error($$select public.cancelar_pedido_web((select (j->>'pedido')::bigint from cp1), gen_random_uuid())$$, 'NO_ENCONTRADO');
-- Con el código, se cancela y el horario queda libre
select pg_temp.ok((select (public.cancelar_pedido_web((j->>'pedido')::bigint, (j->>'token')::uuid)->>'canceladas')::int = 1 from cp1),
                  'la persona cancela su pedido sin pagar desde la web');
reset role;
select pg_temp.ok((select count(*) = 0 from public.ocupaciones o join public.reservas r on r.id = o.reserva_id
                    where r.pedido_id = (select (j->>'pedido')::bigint from cp1)), 'al cancelar, los horarios quedan libres');
select pg_temp.ok((select bool_and(estado = 'cancelada') from public.reservas where pedido_id = (select (j->>'pedido')::bigint from cp1)),
                  'las reservas quedan como canceladas (no se borran)');

-- Si ya subió un comprobante, no puede cancelar sola
set role anon;
create temp table cp2 as select public.crear_pedido('Cata Cancela', '1188009900', 'Psicóloga', 'cata@prueba.com',
  (select jsonb_build_array(jsonb_build_object('fecha', lunes, 'horas', jsonb_build_array(8, 9), 'consultorio', 4)) from cp_dia)) as j;
grant select on cp2 to service_role, authenticated;
reset role;
insert into public.comprobantes (pedido_id, ruta, tipo, bytes)
select (j->>'pedido')::bigint, (j->>'pedido') || '/' || (j->>'token') || '/x.jpg', 'image/jpeg', 10 from cp2;
set role anon;
select pg_temp.espera_error($$select public.cancelar_pedido_web((select (j->>'pedido')::bigint from cp2), (select (j->>'token')::uuid from cp2))$$, 'YA_PAGADO');
reset role;

\o
select 'PRUEBAS DE CANCELAR PEDIDO PASARON' as resultado;

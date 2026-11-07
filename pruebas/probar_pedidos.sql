-- Pruebas de 06_pedidos.sql (se corre después de probar_calendario.sql, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/06_pedidos.sql
\set QUIET 1
\o /dev/null

-- Un lunes y el jueves de esa semana, dentro de los 2 meses
create temp table dias as
select l as lunes, l + 3 as jueves
from (select (public.hoy_ar() + ((8 - extract(isodow from public.hoy_ar())::int) % 7) + 14)::date as l) x;
grant select on dias to anon, service_role;
create temp table items as
select jsonb_build_array(
  jsonb_build_object('fecha', lunes, 'horas', jsonb_build_array(10, 11), 'consultorio', 1),
  jsonb_build_object('fecha', jueves, 'horas', jsonb_build_array(15), 'consultorio', null)) as j from dias;
grant select on items to anon, service_role;

set role anon;
select set_config('request.jwt.claim.sub', '', false);
create temp table p1 as select public.crear_pedido('Pía Pedido', '1188001100', 'Psicóloga', 'pia@prueba.com', (select j from items)) as j;
grant select on p1 to service_role, authenticated;
select pg_temp.ok((select jsonb_array_length((j->'reservas')::jsonb) = 2 from p1), 'un pedido con lunes y jueves crea 2 reservas');
select pg_temp.ok((select (j->>'total')::int = 17000 + 9000 and (j->>'sena')::int = 8500 + 4500 from p1),
                  'total $26.000 y una sola seña de $13.000');
select pg_temp.ok((select (j->'reservas'->0->>'consultorio') = 'Consultorio 1' from p1), 'el lunes queda en el Consultorio 1 elegido');

-- Un pedido cuenta como UNA reserva sin pagar para el límite (2)
select public.crear_pedido('Pía Pedido', '1188001100', 'Psicóloga', 'pia@prueba.com',
  (select jsonb_build_array(jsonb_build_object('fecha', lunes, 'horas', jsonb_build_array(18), 'consultorio', 2)) from dias));
select pg_temp.espera_error((select format($$select public.crear_pedido('Pía Pedido', '1188001100', 'Psicóloga', 'pia@prueba.com', %L::jsonb)$$,
  jsonb_build_array(jsonb_build_object('fecha', lunes, 'horas', jsonb_build_array(19), 'consultorio', 2))) from dias), 'DEMASIADAS_PENDIENTES');

-- Todo o nada: si el jueves está ocupado, tampoco se crea el lunes
reset role;
create temp table antes as select count(*) as n from public.reservas;
set role anon;
select pg_temp.espera_error((select format($$select public.crear_pedido('Otro', '1188002200', 'Psicólogo', 'otro@prueba.com', %L::jsonb)$$,
  jsonb_build_array(jsonb_build_object('fecha', lunes, 'horas', jsonb_build_array(12), 'consultorio', 4),
                    jsonb_build_object('fecha', lunes, 'horas', jsonb_build_array(10), 'consultorio', 1))) from dias), 'DIA_REPETIDO');
reset role;
-- ocupar a mano el jueves 16 hs del Consultorio 2 y pedir lunes C4 + jueves 16 hs C2
insert into public.bloqueos (consultorio_id, fecha, hora_desde, hora_hasta, motivo) select 2, jueves, 16, 17, 'prueba' from dias;
insert into public.ocupaciones (consultorio_id, fecha, hora, bloqueo_id) select 2, jueves, 16, (select max(id) from public.bloqueos) from dias;
set role anon;
select pg_temp.espera_error((select format($$select public.crear_pedido('Otro', '1188002200', 'Psicólogo', 'otro@prueba.com', %L::jsonb)$$,
  jsonb_build_array(jsonb_build_object('fecha', lunes, 'horas', jsonb_build_array(12), 'consultorio', 4),
                    jsonb_build_object('fecha', jueves, 'horas', jsonb_build_array(16), 'consultorio', 2))) from dias), 'SIN_LUGAR');
reset role;
select pg_temp.ok((select count(*) from public.reservas) = (select n from antes), 'todo o nada: si un día falla, no se crea ninguno');
select pg_temp.ok((select count(*) = 0 from public.ocupaciones o join dias on o.fecha = dias.lunes where o.consultorio_id = 4 and o.hora = 12),
                  'el lunes no quedó ocupado');

-- Estado del pedido con su código
set role anon;
select pg_temp.ok((select public.estado_pago_pedido((j->>'pedido')::bigint, (j->>'token')::uuid)->>'estado' = 'pendiente' from p1), 'la web ve el pedido con su código');
select pg_temp.espera_error((select format('select public.estado_pago_pedido(%s, %L)', j->>'pedido', gen_random_uuid()) from p1), 'NO_ENCONTRADO');
select pg_temp.espera_error((select format('select public.preparar_pago_pedido(%s, %L)', j->>'pedido', j->>'token') from p1), 'permission denied');
select pg_temp.espera_error((select format('select public.registrar_pago_pedido_mp(%s, %L, 1)', j->>'pedido', 'x') from p1), 'permission denied');
select pg_temp.espera_error($$select public.aplicar_pago_mp_reserva(1, 'x', 1)$$, 'permission denied');

-- Mercado Pago: una seña para todo el pedido, repartida
set role service_role;
select pg_temp.ok((select (public.preparar_pago_pedido((j->>'pedido')::bigint, (j->>'token')::uuid)->>'monto')::int = 13000 from p1),
                  'Mercado Pago cobra $13.000 por todo el pedido');
select pg_temp.espera_error($$select public.aplicar_pago_mp_reserva(1, 'x', 1)$$, 'permission denied');
select pg_temp.ok((select public.registrar_pago_pedido_mp((j->>'pedido')::bigint, 'pp-1', 13000) = 'CONFIRMADA' from p1), 'pago aprobado: pedido CONFIRMADO');
select pg_temp.ok((select public.registrar_pago_pedido_mp((j->>'pedido')::bigint, 'pp-1', 13000) = 'YA_REGISTRADO' from p1), 'aviso repetido: no duplica');
reset role;
select pg_temp.ok((select bool_and(estado = 'confirmada') and count(*) = 2 from public.reservas where pedido_id = (select (j->>'pedido')::bigint from p1)),
                  'las 2 reservas del pedido quedaron confirmadas');
select pg_temp.ok((select count(*) = 2 and sum(monto) = 13000 from public.pagos where mp_payment_id = 'pp-1'), 'el pago se repartió: $8.500 + $4.500');
set role service_role;
select pg_temp.espera_error((select format('select public.preparar_pago_pedido(%s, %L)', j->>'pedido', j->>'token') from p1), 'YA_CONFIRMADA');
reset role;

-- Pago de más: completa saldos y lo que sobra queda a revisar
set role anon;
create temp table p2 as select public.crear_pedido('Quique', '1188003300', 'Psicólogo', 'q@prueba.com',
  (select jsonb_build_array(jsonb_build_object('fecha', lunes, 'horas', jsonb_build_array(13), 'consultorio', 5)) from dias)) as j;
grant select on p2 to service_role;
set role service_role;
select pg_temp.ok((select public.registrar_pago_pedido_mp((j->>'pedido')::bigint, 'pp-2', 10000) = 'A_REVISAR' from p2), 'pago de más: lo que sobra queda a revisar');
reset role;
select pg_temp.ok((select estado = 'confirmada' and public.monto_pagado_reserva(id) = 9000 from public.reservas where pedido_id = (select (j->>'pedido')::bigint from p2)),
                  'pago de más: la reserva queda pagada completa ($9.000)');
select pg_temp.ok((select monto = 1000 from public.pagos_a_revisar where mp_payment_id = 'pp-2'), 'pago de más: $1.000 a devolver');

-- Pago tardío: un día se recupera y el otro (ya ocupado) queda a revisar
set role anon;
create temp table p3 as select public.crear_pedido('Rocío', '1188004400', 'Psicóloga', 'r@prueba.com',
  (select jsonb_build_array(jsonb_build_object('fecha', lunes, 'horas', jsonb_build_array(9), 'consultorio', 5),
                            jsonb_build_object('fecha', jueves, 'horas', jsonb_build_array(9), 'consultorio', 5)) from dias)) as j;
grant select on p3 to service_role;
reset role;
update public.reservas set expira_en = now() - interval '1 minute' where pedido_id = (select (j->>'pedido')::bigint from p3);
select public.liberar_vencidas();
set role anon;
select public.crear_pedido('Ocupa', '1188005500', 'Psicólogo', 'o@prueba.com',
  (select jsonb_build_array(jsonb_build_object('fecha', jueves, 'horas', jsonb_build_array(9), 'consultorio', 5)) from dias));
set role service_role;
select pg_temp.ok((select public.registrar_pago_pedido_mp((j->>'pedido')::bigint, 'pp-3', 8500) = 'A_REVISAR' from p3), 'pago tardío con un día ocupado: a revisar');
reset role;
select pg_temp.ok((select public.estado_pago_pedido((j->>'pedido')::bigint, (j->>'token')::uuid)->>'estado' = 'parcial' from p3),
                  'pago tardío: el lunes se recuperó y confirmó; el jueves queda a revisar (estado "parcial")');
select pg_temp.ok((select count(*) = 1 from public.pagos_a_revisar where mp_payment_id = 'pp-3' and monto = 4250), 'pago tardío: la parte del jueves ($4.250) a devolver');

\o
select 'PRUEBAS DE PEDIDOS PASARON' as resultado;

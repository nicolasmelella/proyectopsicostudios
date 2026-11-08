-- Pruebas de 16_pagos_completos.sql (después de probar_cancelar_pedido.sql, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/16_pagos_completos.sql
\set QUIET 1
\o /dev/null
update public.config set valor = 'si' where clave = 'mercadopago_activo';

-- Fechas: un martes a ~5 semanas y un jueves a ~6 semanas
create temp table pc_dias as
select l + 1 as martes, l + 10 as jueves, l + 8 as martes2
from (select (public.hoy_ar() + ((8 - extract(isodow from public.hoy_ar())::int) % 7) + 28)::date as l) x;
grant select on pc_dias to anon, service_role, authenticated;

-- ===== Horas sueltas: seña o total =====
set role anon;
create temp table pc_s as select public.crear_pedido('Sol Total', '1188112233', 'Psicóloga', 'sol@prueba.com',
  (select jsonb_build_array(jsonb_build_object('fecha', martes, 'horas', jsonb_build_array(10, 11), 'consultorio', 2)) from pc_dias)) as j;
grant select on pc_s to service_role, authenticated;
select pg_temp.espera_error($$select public.preparar_pago_pedido(1, gen_random_uuid(), 'total')$$, 'permission denied');
set role service_role;
select pg_temp.ok((select (public.preparar_pago_pedido((j->>'pedido')::bigint, (j->>'token')::uuid)->>'monto')::int = (j->>'sena')::int from pc_s),
                  'sueltas: por defecto Mercado Pago cobra la seña');
select pg_temp.ok((select (public.preparar_pago_pedido((j->>'pedido')::bigint, (j->>'token')::uuid, 'total')->>'monto')::int = (j->>'total')::int from pc_s),
                  'sueltas: eligiendo "total", Mercado Pago cobra todo');
select pg_temp.ok((select public.registrar_pago_pedido_mp((j->>'pedido')::bigint, 'pc-total-1', (j->>'total')::int) = 'CONFIRMADA' from pc_s),
                  'pagó el total: queda confirmada');
reset role;
select pg_temp.ok((select bool_and(estado = 'confirmada') and sum(public.monto_pagado_reserva(id)) = (select (j->>'total')::int from pc_s)
                   from public.reservas where pedido_id = (select (j->>'pedido')::bigint from pc_s)), 'y figura todo pago (sin saldo)');
set role service_role;
select pg_temp.espera_error((select format('select public.preparar_pago_pedido(%s, %L, %L)', j->>'pedido', j->>'token', 'total') from pc_s), 'YA_CONFIRMADA');
reset role;

-- ===== Fijo: paga el primer mes completo =====
set role anon;
select pg_temp.espera_error((select format($$select public.crear_solicitud_fijo('X', '1100000000', 'Psicóloga', 'x@prueba.com', 2::smallint, array[19,20]::smallint[], %L)$$, martes) from pc_dias),
                            'permission denied');
create temp table pc_f as select public.crear_fijo_web('Fede Fijo', '1188445566', 'Psicólogo', 'fede@prueba.com', 2::smallint,
  array[19, 20]::smallint[], (select martes from pc_dias), 4::smallint) as j;
grant select on pc_f to service_role, authenticated;
reset role;
create temp table pc_semanas as
select count(*)::int as n from pc_dias, generate_series(martes::timestamp, date_trunc('month', martes) + interval '1 month - 1 day', interval '7 days');
select pg_temp.ok((select (j->>'total')::int = (j->>'precio_semanal')::int * (select n from pc_semanas)
                          and (j->>'sena')::int = (j->>'total')::int and json_array_length(j->'reservas') = (select n from pc_semanas) from pc_f),
                  'fijo: hay que pagar todas las semanas que quedan del primer mes (sin seña)');
select pg_temp.ok((select estado = 'solicitud' and pedido_id = (select (j->>'pedido')::bigint from pc_f) and expira_en < now() + interval '3 hours'
                   from public.fijos where id = (select (j->>'id')::bigint from pc_f)), 'fijo: queda guardado unas horas esperando el pago');
set role anon;
select pg_temp.ok((select public.estado_pago_pedido((j->>'pedido')::bigint, (j->>'token')::uuid)->>'tipo' = 'fijo'
                          and public.estado_pago_pedido((j->>'pedido')::bigint, (j->>'token')::uuid)->>'estado' = 'pendiente' from pc_f),
                  'fijo: el link del pedido muestra el fijo pendiente de pago');
set role service_role;
select pg_temp.ok((select (public.preparar_pago_pedido((j->>'pedido')::bigint, (j->>'token')::uuid, 'sena')->>'monto')::int = (j->>'total')::int from pc_f),
                  'fijo: aunque pida "seña", Mercado Pago cobra el mes completo');
select pg_temp.ok((select public.registrar_pago_pedido_mp((j->>'pedido')::bigint, 'pc-fijo-1', (j->>'total')::int) = 'CONFIRMADA' from pc_f),
                  'fijo: pagó el mes por Mercado Pago');
reset role;
select pg_temp.ok((select estado = 'activo' and expira_en is null from public.fijos where id = (select (j->>'id')::bigint from pc_f)),
                  'fijo: queda ACTIVO solo, sin que el equipo lo apruebe');
select pg_temp.ok((select count(*) = 1 and min(periodo) = to_char((select martes from pc_dias), 'YYYY-MM') from public.pagos
                   where fijo_id = (select (j->>'id')::bigint from pc_f) and medio = 'mercadopago'), 'fijo: el pago queda en el mes que corresponde');
set role service_role;
select pg_temp.ok((select public.registrar_pago_pedido_mp((j->>'pedido')::bigint, 'pc-fijo-1', (j->>'total')::int) = 'YA_REGISTRADO' from pc_f),
                  'fijo: el mismo aviso de Mercado Pago dos veces no cobra doble');
reset role;

-- Fijo cancelado por la persona antes de pagar: libera los horarios
set role anon;
create temp table pc_c as select public.crear_fijo_web('Caro Cancela', '1188778899', 'Psicóloga', 'caro@prueba.com', 4::smallint,
  array[19, 20]::smallint[], (select jueves from pc_dias), 4::smallint) as j;
grant select on pc_c to service_role, authenticated;
select pg_temp.ok((select (public.cancelar_pedido_web((j->>'pedido')::bigint, (j->>'token')::uuid)->>'canceladas')::int = 1 from pc_c),
                  'fijo: la persona lo cancela desde la web antes de pagar');
select pg_temp.ok((select public.estado_pago_pedido((j->>'pedido')::bigint, (j->>'token')::uuid)->>'estado' = 'cancelada' from pc_c),
                  'fijo cancelado: el link lo muestra cancelado');
reset role;
select pg_temp.ok((select f.estado = 'cancelado' and not exists (select 1 from public.ocupaciones o where o.fijo_id = f.id)
                   from public.fijos f where f.id = (select (j->>'id')::bigint from pc_c)), 'fijo cancelado: los horarios quedan libres');

-- Fijo pagado por transferencia: comprobante → el equipo lo acepta → activo
set role anon;
create temp table pc_t as select public.crear_fijo_web('Tina Transfer', '1188990011', 'Psicóloga', 'tina@prueba.com', 2::smallint,
  array[8, 9]::smallint[], (select martes2 from pc_dias), 5::smallint) as j;
grant select on pc_t to service_role, authenticated;
reset role;
insert into public.comprobantes (pedido_id, ruta, tipo, bytes)
select (j->>'pedido')::bigint, (j->>'pedido') || '/' || (j->>'token') || '/t.jpg', 'image/jpeg', 10 from pc_t;
select pg_temp.ok((select expira_en > now() + interval '11 hours' from public.fijos where id = (select (j->>'id')::bigint from pc_t)),
                  'fijo: al subir el comprobante, el horario se guarda 12 horas más');
set role anon;
select pg_temp.espera_error((select format('select public.cancelar_pedido_web(%s, %L)', j->>'pedido', j->>'token') from pc_t), 'YA_PAGADO');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);
create temp table pc_cp as select c from json_array_elements(public.comprobantes_pendientes()) c
  where (c->>'pedido_id')::bigint = (select (j->>'pedido')::bigint from pc_t);
select pg_temp.ok((select (c->>'es_fijo')::boolean and (c->>'falta_total')::int = (select (j->>'total')::int from pc_t)
                          and json_array_length(c->'reservas') > 0 from pc_cp), 'panel: el comprobante del fijo muestra el mes a cobrar');
select pg_temp.espera_error((select format('select public.revisar_comprobante(%s, true, %s)', c->>'id', (c->>'falta_total')::int + 1) from pc_cp), 'PAGO_EXCEDE');
select pg_temp.ok((select public.revisar_comprobante((c->>'id')::bigint, true, (c->>'falta_total')::int) = 'CONFIRMADA' from pc_cp),
                  'panel: aceptar el comprobante del mes activa el fijo');
reset role;
select pg_temp.ok((select estado = 'activo' from public.fijos where id = (select (j->>'id')::bigint from pc_t)), 'el fijo quedó activo');
update public.config set valor = 'no' where clave = 'mercadopago_activo';

\o
select 'PRUEBAS DE PAGOS COMPLETOS PASARON' as resultado;

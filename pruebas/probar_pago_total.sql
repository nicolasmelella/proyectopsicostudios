-- Pruebas de 25_pago_total.sql: por horas se confirma solo con el pago total.
\set ON_ERROR_STOP 1
\set QUIET 1
\o /dev/null
-- Antes de aplicar 25: con la mitad paga, la reserva quedaba confirmada
create or replace function pg_temp.dia_pt(n integer) returns date language sql as $$
  select case when extract(isodow from public.hoy_ar() + n) = 7 then public.hoy_ar() + n + 1 else public.hoy_ar() + n end $$;
grant execute on function pg_temp.dia_pt(integer) to anon;
set role anon;
select (public.crear_pedido('Ana Antes', '1179880001', 'Psicóloga', 'ana.antes@prueba.com',
  jsonb_build_array(jsonb_build_object('fecha', pg_temp.dia_pt(52), 'horas', jsonb_build_array(9, 10), 'consultorio', 5)))->>'pedido')::bigint as pa \gset
reset role;
select public.registrar_pago_pedido(:pa, (select precio_total / 2 from public.reservas where pedido_id = :pa), 'transferencia');
select pg_temp.ok((select estado = 'confirmada' from public.reservas where pedido_id = :pa), 'antes: con la mitad paga quedaba confirmada (seña del 50%)');

\ir ../supabase/25_pago_total.sql
\set QUIET 1
\o /dev/null
select pg_temp.ok(public.cfg('porcentaje_sena') = 100, 'ahora hay que pagar el 100% para confirmar');

set role anon;
select public.crear_pedido('Beto Total', '1179880002', 'Psicólogo', 'beto.total@prueba.com',
  jsonb_build_array(jsonb_build_object('fecha', pg_temp.dia_pt(53), 'horas', jsonb_build_array(9, 10), 'consultorio', 5))) as j \gset
reset role;
select (:'j'::json->>'pedido')::bigint as pb \gset
select pg_temp.ok((:'j'::json->>'sena')::int = (:'j'::json->>'total')::int, 'al reservar, lo que hay que pagar para confirmar es el total');
select public.registrar_pago_pedido(:pb, (select precio_total / 2 from public.reservas where pedido_id = :pb), 'transferencia');
select pg_temp.ok((select estado = 'pendiente' from public.reservas where pedido_id = :pb), 'con la mitad paga NO queda confirmada');
select public.registrar_pago_pedido(:pb, (select precio_total - public.monto_pagado_reserva(id) from public.reservas where pedido_id = :pb), 'transferencia');
select pg_temp.ok((select estado = 'confirmada' from public.reservas where pedido_id = :pb), 'con el total pago queda confirmada');
select pg_temp.ok((select estado = 'confirmada' from public.reservas where pedido_id = :pa), 'lo que ya estaba confirmado no cambia');
-- Las pruebas que siguen (funciones de pago) usan la seña del 50%: se deja como estaba
update public.config set valor = '50' where clave = 'porcentaje_sena';
\o
\echo 'PRUEBAS DE PAGO TOTAL PASARON'

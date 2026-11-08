-- Pruebas de 17_alertas_pago.sql (después de probar_pagos_completos.sql, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/17_alertas_pago.sql
\set QUIET 1
\o /dev/null

-- Nada se cancela solo
set role anon;
create temp table al_p as select public.crear_pedido('Alba Alerta', '1188223344', 'Psicóloga', 'alba@prueba.com',
  (select jsonb_build_array(jsonb_build_object('fecha', public.hoy_ar() + 12, 'horas', jsonb_build_array(19), 'consultorio', 3)))) as j;
grant select on al_p to service_role, authenticated;
reset role;
update public.reservas set expira_en = now() - interval '5 hours' where pedido_id = (select (j->>'pedido')::bigint from al_p);
select pg_temp.ok((select public.liberar_vencidas() = 0), 'la tarea de liberar ya no libera nada');
select pg_temp.ok((select estado = 'pendiente' from public.reservas where pedido_id = (select (j->>'pedido')::bigint from al_p)),
                  'una reserva sin seña con el plazo pasado SIGUE reservada');
select pg_temp.ok((select count(*) > 0 from public.ocupaciones o join public.reservas r on r.id = o.reserva_id
                   where r.pedido_id = (select (j->>'pedido')::bigint from al_p)), '…y el horario sigue ocupado');

-- Una reserva confirmada (seña paga) para mañana con saldo, y otra para pasado mañana
insert into public.profesionales (nombre, whatsapp, origen) values ('Sergio Saldo', '1188556677', 'Panel') on conflict do nothing;
create temp table al_r as
with p as (select id from public.profesionales where whatsapp = '1188556677'),
ins as (
  insert into public.reservas (profesional_id, consultorio_id, fecha, horas, precio_total, estado, origen)
  select p.id, 5, f, array[20]::smallint[], 9000, 'confirmada', 'panel' from p, (values (public.hoy_ar() + 1), (public.hoy_ar() + 2)) v(f)
  where extract(isodow from f) <> 7
  returning id, fecha)
select * from ins;
insert into public.pagos (reserva_id, monto, medio) select id, 4500, 'transferencia' from al_r;
grant select on al_r to authenticated;

-- El panel (equipo) ve las alertas
set role anon;
select pg_temp.espera_error($$select public.alertas_pago()$$, 'permission denied');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_intruso', false);
select pg_temp.espera_error($$select public.alertas_pago()$$, 'NO_AUTORIZADO');
select set_config('request.jwt.claim.sub', :'id_equipo', false);
create temp table al as select a from json_array_elements(public.alertas_pago()) a;
select pg_temp.ok((select count(*) = 1 from al where a->>'tipo' = 'sena' and a->>'nombre' = 'Alba Alerta' and a->>'gravedad' = 'vencida'),
                  'alerta "falta la seña" (vencida: pasó el tiempo para pagarla)');
select pg_temp.ok((select count(*) = 1 from al where a->>'tipo' = 'saldo' and a->>'nombre' = 'Sergio Saldo' and a->>'gravedad' = 'hoy'
                          and (a->>'falta')::int = 4500),
                  'alerta "falta el saldo" del turno de mañana: vence HOY ($4.500)');
select pg_temp.ok((select count(*) = 0 from al where a->>'tipo' = 'saldo' and a->>'nombre' = 'Sergio Saldo' and (a->>'fecha_turno')::date = public.hoy_ar() + 2),
                  'el turno de pasado mañana todavía no tiene alerta de saldo');
reset role;

-- Al pagar el saldo, la alerta desaparece
insert into public.pagos (reserva_id, monto, medio) select id, 4500, 'efectivo' from al_r where fecha = public.hoy_ar() + 1;
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select pg_temp.ok((select count(*) = 0 from json_array_elements(public.alertas_pago()) a where a->>'tipo' = 'saldo' and a->>'nombre' = 'Sergio Saldo'),
                  'pagó el saldo: la alerta se va');
reset role;
-- Un fijo activo que empezó el primer día hábil de este mes y no pagó el mes: alerta
insert into public.profesionales (nombre, whatsapp, origen) values ('Fabi Fijo Mes', '1188990022', 'Panel') on conflict do nothing;
insert into public.fijos (profesional_id, consultorio_id, dia_semana, horas, precio_semanal, estado, desde, origen)
select (select id from public.profesionales where whatsapp = '1188990022'), 1, extract(isodow from d)::smallint, array[21]::smallint[], 8000, 'activo', d, 'panel'
from (select case when extract(isodow from date_trunc('month', public.hoy_ar())) = 7 then date_trunc('month', public.hoy_ar())::date + 1
                  else date_trunc('month', public.hoy_ar())::date end as d) x;
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select pg_temp.ok((select count(*) = 1 from json_array_elements(public.alertas_pago()) a
                   where a->>'tipo' = 'fijo_mes' and a->>'nombre' = 'Fabi Fijo Mes' and a->>'periodo' = to_char(public.hoy_ar(), 'YYYY-MM')),
                  'fijo activo sin pagar el mes: alerta');
reset role;
insert into public.pagos (fijo_id, periodo, monto, medio)
select id, to_char(public.hoy_ar(), 'YYYY-MM'), 100000, 'efectivo' from public.fijos where profesional_id = (select id from public.profesionales where whatsapp = '1188990022');
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select pg_temp.ok((select count(*) = 0 from json_array_elements(public.alertas_pago()) a
                   where a->>'tipo' = 'fijo_mes' and a->>'nombre' = 'Fabi Fijo Mes' and a->>'periodo' = to_char(public.hoy_ar(), 'YYYY-MM')),
                  'pagó el mes: la alerta se va');
reset role;

\o
select 'PRUEBAS DE ALERTAS DE PAGO PASARON' as resultado;

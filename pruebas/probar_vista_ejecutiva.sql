-- Pruebas de 23_vista_ejecutiva.sql (al final, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/23_vista_ejecutiva.sql
\set QUIET 1
\o /dev/null

-- Pagos conocidos en un mes sin movimiento (marzo 2030) y en el período anterior
select id as r_ve from public.reservas where estado in ('pendiente', 'confirmada') limit 1 \gset
insert into public.pagos (reserva_id, monto, medio, pagado_en) values
  (:r_ve, 5000, 'efectivo', '2030-03-10'), (:r_ve, 2500, 'transferencia', '2030-03-11'),
  (:r_ve, 2000, 'efectivo', '2030-02-10'), (:r_ve, 999, 'efectivo', '2030-04-01');
update public.pagos set anulado = true where monto = 2500 and pagado_en = '2030-03-11';
update public.config set valor = '20000' where clave = 'objetivo_mensual';

set role anon;
select pg_temp.espera_error($$select public.vista_ejecutiva('2030-03-01', '2030-03-31')$$, 'permission denied');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_intruso', false);
select pg_temp.espera_error($$select public.vista_ejecutiva('2030-03-01', '2030-03-31')$$, 'NO_AUTORIZADO');
select set_config('request.jwt.claim.sub', :'id_equipo', false);
create temp table ve as select public.vista_ejecutiva('2030-03-01', '2030-03-31') as v;
select pg_temp.ok((select (v->>'cobrado')::int = 5000 from ve), 'cobrado del período: suma los pagos y no cuenta los anulados');
select pg_temp.ok((select (v->>'cobrado_anterior')::int = 2000 from ve), 'cobrado del período anterior (para comparar)');
select pg_temp.ok((select (v->>'objetivo')::int = 20000 from ve), 'trae el objetivo del mes');
select pg_temp.ok((select jsonb_array_length(v->'por_dia') = 31 and (v->'por_dia'->9->>'cobrado')::int = 5000 from ve), 'cobrado por día (31 días; el 10 de marzo, $5.000)');
select pg_temp.ok((select (v->>'capacidad')::int = 26 * (public.cfg('hora_cierre') - public.cfg('hora_apertura'))
                          * (select count(*) from public.consultorios where activo)
                          - (select count(*) from public.ocupaciones where bloqueo_id is not null and fecha between '2030-03-01' and '2030-03-31') from ve),
                  'capacidad: días sin domingos × horas × consultorios, menos lo bloqueado');
select pg_temp.ok((select v->'tareas' ?& array['transferencia', 'no_pago', 'vencidos', 'comprobantes', 'pagos_a_revisar'] from ve), 'tareas pendientes');
select pg_temp.espera_error($$select public.vista_ejecutiva('2030-03-31', '2030-03-01')$$, 'PERIODO_INVALIDO');
-- este mes: las horas coinciden con el tablero
create temp table ve2 as select public.vista_ejecutiva(date_trunc('month', public.hoy_ar())::date, public.hoy_ar()) as v,
  public.tablero(date_trunc('month', public.hoy_ar())::date, public.hoy_ar()) as t;
select pg_temp.ok((select (v->>'horas')::int = (t->>'horas')::int from ve2), 'horas alquiladas: igual que en Números');
select pg_temp.ok((select jsonb_array_length(v->'ultimas') between 1 and 8 from ve2), 'últimas reservas (hasta 8)');
reset role;
delete from public.pagos where pagado_en between '2030-01-01' and '2030-12-31';
update public.config set valor = '0' where clave = 'objetivo_mensual';

\o
select 'PRUEBAS DE LA VISTA EJECUTIVA PASARON' as resultado;

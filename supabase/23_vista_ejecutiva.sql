-- =====================================================================
-- PSICOSTUDIOS · 23_vista_ejecutiva.sql
-- Panel → Inicio: la vista ejecutiva en una pantalla.
--   · Cobrado, horas alquiladas, ocupación y objetivo del mes (con la
--     comparación contra el período anterior).
--   · Cobrado por día, de dónde vienen las reservas nuevas, últimas
--     reservas y tareas pendientes.
-- El objetivo mensual se carga en Precios y ajustes.
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Requiere 01 a 22. Se puede correr más de una vez.
-- =====================================================================

insert into public.config (clave, valor, descripcion) values
  ('objetivo_mensual', '0', 'Objetivo de cobros del mes, en pesos (para la vista ejecutiva del panel; 0 = sin objetivo)')
on conflict (clave) do nothing;

create or replace function public.vista_ejecutiva(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_dias integer := p_hasta - p_desde + 1;
  v_ant_desde date := p_desde - (p_hasta - p_desde + 1);
  v_ant_hasta date := p_desde - 1;
  v_alertas json;
  v jsonb;
begin
  perform public.exigir_equipo();
  if p_desde is null or p_hasta is null or p_hasta < p_desde or v_dias > 400 then
    raise exception 'PERIODO_INVALIDO' using hint = 'Elegí un período de hasta un año';
  end if;
  v_alertas := public.alertas_pago();

  with
  -- horas ocupadas (reservas vigentes y fijos activos; los bloqueos no cuentan)
  oc as (
    select o.fecha, o.hora
    from public.ocupaciones o
    left join public.reservas r on r.id = o.reserva_id
    left join public.fijos f on f.id = o.fijo_id
    where o.fecha between v_ant_desde and p_hasta and o.bloqueo_id is null
      and (o.reserva_id is null or r.estado in ('pendiente', 'confirmada'))
      and (o.fijo_id is null or f.estado = 'activo')
  ),
  bq as (select o.fecha from public.ocupaciones o where o.fecha between p_desde and p_hasta and o.bloqueo_id is not null),
  dias as (select d::date as fecha from generate_series(p_desde::timestamp, p_hasta::timestamp, interval '1 day') d),
  pg as (select p.pagado_en as fecha, p.monto from public.pagos p
         where not p.anulado and p.pagado_en between v_ant_desde and p_hasta),
  -- reservas y fijos nuevos del período, con su origen (los del Excel son la carga inicial: no cuentan)
  nuevas as (
    select case when ap.pedido_id is not null then 'asistente' else r.origen end as origen
    from public.reservas r left join public.asistente_pedidos ap on ap.pedido_id = r.pedido_id
    where r.origen <> 'excel' and (r.creado_en at time zone 'America/Argentina/Buenos_Aires')::date between p_desde and p_hasta
    union all
    select case when ap.pedido_id is not null then 'asistente' else f.origen end
    from public.fijos f left join public.asistente_pedidos ap on ap.pedido_id = f.pedido_id
    where (f.creado_en at time zone 'America/Argentina/Buenos_Aires')::date between p_desde and p_hasta
      and f.estado not in ('rechazado', 'cancelado')
  ),
  ultimas as (
    select * from (
      select r.creado_en as cuando, p.nombre, 'reserva' as tipo, r.id, r.fecha, r.horas, c.nombre as consultorio,
             r.precio_total as total, public.monto_pagado_reserva(r.id) as pagado, r.estado, null::smallint as dia
      from public.reservas r join public.profesionales p on p.id = r.profesional_id join public.consultorios c on c.id = r.consultorio_id
      where r.origen <> 'excel'
      union all
      select f.creado_en, p.nombre, 'fijo', f.id, f.desde, f.horas, c.nombre,
             coalesce(f.pago_inicial, f.precio_semanal), public.monto_pagado_fijo(f.id, coalesce(f.periodo_inicial, to_char(f.desde, 'YYYY-MM'))),
             f.estado, f.dia_semana
      from public.fijos f join public.profesionales p on p.id = f.profesional_id join public.consultorios c on c.id = f.consultorio_id
      where f.origen = 'web' or f.creado_por is not null
    ) x order by cuando desc limit 8
  )
  select jsonb_build_object(
    'desde', p_desde, 'hasta', p_hasta,
    'cobrado', coalesce((select sum(monto) from pg where fecha between p_desde and p_hasta), 0),
    'cobrado_anterior', coalesce((select sum(monto) from pg where fecha between v_ant_desde and v_ant_hasta), 0),
    'horas', (select count(*) from oc where fecha between p_desde and p_hasta),
    'horas_anterior', (select count(*) from oc where fecha between v_ant_desde and v_ant_hasta),
    'capacidad', greatest(0,
        (select count(*) from dias where extract(isodow from fecha) <> 7)
        * (public.cfg('hora_cierre') - public.cfg('hora_apertura'))
        * (select count(*) from public.consultorios where activo)
        - (select count(*) from bq)),
    'objetivo', coalesce(public.cfg('objetivo_mensual'), 0),
    'por_dia', (select jsonb_agg(jsonb_build_object('fecha', d.fecha,
                  'cobrado', coalesce((select sum(monto) from pg where pg.fecha = d.fecha), 0),
                  'horas', (select count(*) from oc where oc.fecha = d.fecha)) order by d.fecha) from dias d),
    'origen', coalesce((select jsonb_object_agg(origen, n) from (select origen, count(*) as n from nuevas group by 1) x), '{}'::jsonb),
    'ultimas', coalesce((select jsonb_agg(jsonb_build_object('cuando', cuando, 'nombre', nombre, 'tipo', tipo, 'id', id, 'fecha', fecha,
                  'horas', horas, 'consultorio', consultorio, 'total', total, 'pagado', pagado, 'estado', estado, 'dia', dia)
                  order by cuando desc) from ultimas), '[]'::jsonb),
    'tareas', jsonb_build_object(
      'transferencia', (select count(*) from json_array_elements(v_alertas) a where a->>'gravedad' = 'transferencia'),
      'no_pago', (select count(*) from json_array_elements(v_alertas) a where a->>'gravedad' = 'no_pago'),
      'vencidos', (select count(*) from json_array_elements(v_alertas) a where a->>'gravedad' = 'vencida'),
      'por_vencer', (select count(*) from json_array_elements(v_alertas) a where a->>'gravedad' in ('hoy', 'pendiente')),
      'comprobantes', (select count(*) from public.comprobantes where estado = 'pendiente'),
      'pagos_a_revisar', (select count(*) from public.pagos_a_revisar where not resuelto),
      'asistente', (select count(*) from public.asistente_solicitudes where estado = 'pendiente'))
  ) into v;
  return v;
end $$;
revoke execute on function public.vista_ejecutiva(date, date) from public, anon;
grant execute on function public.vista_ejecutiva(date, date) to authenticated;

select 'Vista ejecutiva lista: Panel → Inicio' as resultado;

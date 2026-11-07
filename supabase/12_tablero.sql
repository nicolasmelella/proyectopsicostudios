-- =====================================================================
-- PSICOSTUDIOS · 12: tablero de números (pestaña "Números" del panel)
--   * Historia cargada desde el Excel: reservas con origen 'excel' y su tipo
--     (fijo, flotante, pericia, quincenal). No cuentan para cobros ni pendientes.
--   * tablero(desde, hasta): ocupación, días, horas, consultorios, ranking y cobros.
--   * pendientes_cobro(): saldos de turnos ya usados y meses de fijos sin pagar.
-- Se puede correr las veces que haga falta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. HISTORIA DEL EXCEL
-- ---------------------------------------------------------------------
alter table public.reservas add column if not exists tipo_excel text
  check (tipo_excel in ('fijo', 'flotante', 'pericia', 'quincenal'));
alter table public.reservas drop constraint if exists reservas_origen_check;
alter table public.reservas add constraint reservas_origen_check check (origen in ('web', 'panel', 'excel'));

-- La agenda devuelve también el tipo del Excel (para pintar en verde lo que era fijo)
drop function if exists public.agenda(date, date);
create or replace function public.agenda(p_desde date, p_hasta date)
returns table (
  fecha date, hora smallint, consultorio_id smallint, tipo text, estado text,
  nombre text, whatsapp text, profesional_id bigint,
  reserva_id bigint, fijo_id bigint, bloqueo_id bigint, pagado boolean, detalle text,
  monto_total integer, monto_pagado integer, expira_en timestamptz,
  tipo_excel text
)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  return query
  select o.fecha, o.hora, o.consultorio_id,
    case when o.reserva_id is not null then 'suelta'
         when o.fijo_id is not null then (case when f.estado = 'solicitud' then 'solicitud' else 'fijo' end)
         else 'bloqueo' end,
    coalesce(r.estado, f.estado, 'bloqueado'),
    coalesce(pr.nombre, pf.nombre, b.motivo),
    coalesce(pr.whatsapp, pf.whatsapp),
    coalesce(pr.id, pf.id),
    o.reserva_id, o.fijo_id, o.bloqueo_id,
    case when o.reserva_id is not null then public.monto_pagado_reserva(r.id) >= r.precio_total
         when o.fijo_id is not null then exists (
           select 1 from public.pagos p where p.fijo_id = f.id and not p.anulado
             and p.periodo = to_char(o.fecha, 'YYYY-MM'))
         else null end,
    coalesce(r.comentario, f.comentario),           -- comentario del equipo (11_comentarios.sql)
    coalesce(r.precio_total, f.precio_semanal),
    case when o.reserva_id is not null then public.monto_pagado_reserva(r.id) end,
    coalesce(r.expira_en, f.expira_en),
    r.tipo_excel                                    -- de dónde venía en el Excel (12_tablero.sql)
  from public.ocupaciones o
  left join public.reservas r on r.id = o.reserva_id
  left join public.profesionales pr on pr.id = r.profesional_id
  left join public.fijos f on f.id = o.fijo_id
  left join public.profesionales pf on pf.id = f.profesional_id
  left join public.bloqueos b on b.id = o.bloqueo_id
  where o.fecha between p_desde and p_hasta
  union all
  select e.fecha, h::smallint, f.consultorio_id, 'liberado', 'libre',
         pf.nombre, pf.whatsapp, pf.id, null, f.id, null, null, e.motivo,
         null::integer, null::integer, null::timestamptz, null::text
  from public.fijo_excepciones e
  join public.fijos f on f.id = e.fijo_id and f.estado = 'activo'
  join public.profesionales pf on pf.id = f.profesional_id
  cross join unnest(f.horas) h
  where e.fecha between p_desde and p_hasta
    and not exists (select 1 from public.ocupaciones o2
                    where o2.consultorio_id = f.consultorio_id and o2.fecha = e.fecha and o2.hora = h)
  order by 1, 2, 3;
end $$;
revoke execute on function public.agenda(date, date) from public, anon;
grant execute on function public.agenda(date, date) to authenticated;

-- ---------------------------------------------------------------------
-- 2. TABLERO
-- Horas ocupadas = fijos activos + reservas vigentes (no cuenta bloqueos ni solicitudes).
-- ---------------------------------------------------------------------
create or replace function public.tablero(p_desde date, p_hasta date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  perform public.exigir_equipo();
  with oc as (
    select o.fecha, o.hora, o.consultorio_id,
           coalesce(r.profesional_id, f.profesional_id) as prof,
           case when o.fijo_id is not null or r.tipo_excel = 'fijo' then 'fijo' else 'suelta' end as tipo
    from public.ocupaciones o
    left join public.reservas r on r.id = o.reserva_id
    left join public.fijos f on f.id = o.fijo_id
    where o.fecha between p_desde and p_hasta and o.bloqueo_id is null
      and (o.reserva_id is null or r.estado in ('pendiente', 'confirmada'))
      and (o.fijo_id is null or f.estado = 'activo')
  ), pg as (
    select p.monto, p.medio, coalesce(p.recibio, case when p.medio = 'mercadopago' then 'Mercado Pago' else 'Sin indicar' end) as recibio
    from public.pagos p
    where not p.anulado and p.pagado_en between p_desde and p_hasta
  )
  select jsonb_build_object(
    'horas', (select count(*) from oc),
    'por_semana', coalesce((select jsonb_agg(jsonb_build_object('lunes', lunes, 'horas', horas) order by lunes) from (
        select (fecha - (extract(isodow from fecha)::int - 1))::date as lunes, count(*) as horas from oc group by 1) x), '[]'),
    'por_dia', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'horas', horas) order by dia) from (
        select extract(isodow from fecha)::int as dia, count(*) as horas from oc group by 1) x), '[]'),
    'calor', coalesce((select jsonb_agg(jsonb_build_object('dia', dia, 'hora', hora, 'horas', horas)) from (
        select extract(isodow from fecha)::int as dia, hora, count(*) as horas from oc group by 1, 2) x), '[]'),
    'por_consultorio', coalesce((select jsonb_agg(jsonb_build_object('consultorio_id', consultorio_id, 'horas', horas) order by consultorio_id) from (
        select consultorio_id, count(*) as horas from oc group by 1) x), '[]'),
    'por_tipo', coalesce((select jsonb_object_agg(tipo, horas) from (select tipo, count(*) as horas from oc group by 1) x), '{}'),
    'ranking', coalesce((select jsonb_agg(jsonb_build_object('profesional_id', x.prof, 'nombre', p.nombre, 'horas', x.horas, 'horas_fijo', x.hf)
                                          order by x.horas desc, p.nombre) from (
        select prof, count(*) as horas, count(*) filter (where tipo = 'fijo') as hf from oc where prof is not null
        group by 1 order by 2 desc limit 20) x join public.profesionales p on p.id = x.prof), '[]'),
    'cobrado', (select coalesce(sum(monto), 0) from pg),
    'cobros_por_persona', coalesce((select jsonb_agg(jsonb_build_object('recibio', recibio, 'monto', m) order by m desc) from (
        select recibio, sum(monto) as m from pg group by 1) x), '[]'),
    'cobros_por_medio', coalesce((select jsonb_agg(jsonb_build_object('medio', medio, 'monto', m) order by m desc) from (
        select medio, sum(monto) as m from pg group by 1) x), '[]')
  ) into v;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 3. PENDIENTE DE COBRO
--   * Reservas ya usadas (día de hoy o antes) con saldo.
--   * Fijos activos: lo que falta del mes en curso (precio semanal x veces en el mes - pagado).
-- La historia del Excel no cuenta (no tiene pagos cargados).
-- ---------------------------------------------------------------------
create or replace function public.pendientes_cobro() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := public.hoy_ar();
  v_mes text := to_char(public.hoy_ar(), 'YYYY-MM');
  v_ini date := date_trunc('month', public.hoy_ar())::date;
  v_fin date := (date_trunc('month', public.hoy_ar()) + interval '1 month - 1 day')::date;
  v jsonb;
begin
  perform public.exigir_equipo();
  with saldos as (
    select 'reserva' as tipo, r.id, p.nombre, r.fecha, r.horas, r.precio_total - public.monto_pagado_reserva(r.id) as falta
    from public.reservas r join public.profesionales p on p.id = r.profesional_id
    where r.estado in ('pendiente', 'confirmada') and r.origen <> 'excel' and r.fecha <= v_hoy
  ), fijos_mes as (
    select 'fijo' as tipo, f.id, p.nombre, f.dia_semana, f.horas,
      f.precio_semanal * (select count(*) from generate_series(greatest(v_ini, f.desde), least(v_fin, coalesce(f.hasta, v_fin)), interval '1 day') d
                          where extract(isodow from d)::int = f.dia_semana
                            and not exists (select 1 from public.fijo_excepciones e where e.fijo_id = f.id and e.fecha = d::date))
      - coalesce((select sum(monto) from public.pagos pg where pg.fijo_id = f.id and pg.periodo = v_mes and not pg.anulado), 0) as falta
    from public.fijos f join public.profesionales p on p.id = f.profesional_id
    where f.estado = 'activo'
  )
  select jsonb_build_object(
    'mes', v_mes,
    'total', coalesce((select sum(falta) from saldos where falta > 0), 0) + coalesce((select sum(falta) from fijos_mes where falta > 0), 0),
    'items', coalesce((select jsonb_agg(x order by x.falta desc) from (
        select tipo, id, nombre, falta, jsonb_build_object('fecha', fecha, 'horas', horas) as detalle from saldos where falta > 0
        union all
        select tipo, id, nombre, falta, jsonb_build_object('dia_semana', dia_semana, 'horas', horas) from fijos_mes where falta > 0
      ) x), '[]')
  ) into v;
  return v;
end $$;

revoke execute on function public.tablero(date, date), public.pendientes_cobro() from public, anon, authenticated;
grant execute on function public.tablero(date, date) to authenticated;
grant execute on function public.pendientes_cobro() to authenticated;

select 'Listo: tablero de números' as resultado;

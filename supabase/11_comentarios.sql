-- =====================================================================
-- PSICOSTUDIOS · 11: comentarios del equipo en reservas y fijos
-- ("algo a tener en cuenta": trae camilla, avisó que llega tarde, etc.)
-- Solo lo ve el equipo. Se puede correr las veces que haga falta.
-- =====================================================================

alter table public.reservas add column if not exists comentario text;
alter table public.fijos    add column if not exists comentario text;

create or replace function public.guardar_comentario(p_texto text, p_reserva_id bigint default null, p_fijo_id bigint default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v text := nullif(left(trim(coalesce(p_texto, '')), 1000), '');
begin
  perform public.exigir_equipo();
  if p_reserva_id is not null then
    update public.reservas set comentario = v where id = p_reserva_id;
  elsif p_fijo_id is not null then
    update public.fijos set comentario = v where id = p_fijo_id;
  else
    raise exception 'NO_ENCONTRADO' using hint = 'Falta la reserva o el fijo';
  end if;
  if not found then raise exception 'NO_ENCONTRADO' using hint = 'No se encontró'; end if;
end $$;

revoke execute on function public.guardar_comentario(text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.guardar_comentario(text, bigint, bigint) to authenticated;

-- La agenda devuelve el comentario en "detalle" (para mostrar 📝 en la grilla)
drop function if exists public.agenda(date, date);
create or replace function public.agenda(p_desde date, p_hasta date)
returns table (
  fecha date, hora smallint, consultorio_id smallint, tipo text, estado text,
  nombre text, whatsapp text, profesional_id bigint,
  reserva_id bigint, fijo_id bigint, bloqueo_id bigint, pagado boolean, detalle text,
  monto_total integer, monto_pagado integer, expira_en timestamptz
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
    coalesce(r.expira_en, f.expira_en)
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
         null::integer, null::integer, null::timestamptz
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

select 'Listo: comentarios en reservas y fijos' as resultado;

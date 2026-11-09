-- =====================================================================
-- PSICOSTUDIOS · 21_sin_sena_una_hora.sql
-- Completar los datos NO alcanza para quedarse con el horario:
--   · La reserva por la web aparta el horario 1 HORA para mandar la seña.
--   · Si en esa hora el equipo no registra la seña, el horario se LIBERA
--     solo y la reserva queda en el panel marcada como "NO PAGÓ".
--   · Desde el panel se puede recuperar (si el horario sigue libre),
--     registrar el pago (la recupera sola) o descartar el aviso.
--   · Solo afecta a reservas por horas pedidas por la web sin ningún pago.
--     Las del panel, las del Excel, los fijos y las que ya tienen un pago
--     no se tocan nunca.
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Requiere 01 a 19. Se puede correr más de una vez.
-- =====================================================================

update public.config set valor = '60', descripcion = 'Minutos que queda apartado un horario pedido por la web esperando la seña (después se libera solo)'
where clave = 'retencion_suelta_minutos';

alter table public.reservas add column if not exists no_pago_visto boolean not null default false;

create or replace function public.motivo_no_pago() returns text
language sql immutable as $$ select 'No pagó la seña a tiempo'::text $$;

-- 1) Liberar las reservas web que pasaron la hora sin ningún pago
create or replace function public.liberar_vencidas() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer := 0;
begin
  with v as (
    update public.reservas r
    set estado = 'vencida', cancelada_en = now(), motivo_cancelacion = public.motivo_no_pago(), no_pago_visto = false
    where r.estado = 'pendiente' and r.origen <> 'excel'
      and r.expira_en is not null and r.expira_en < now()
      and public.monto_pagado_reserva(r.id) = 0
    returning r.id)
  delete from public.ocupaciones o using v where o.reserva_id = v.id;
  get diagnostics v_n = row_count;
  return v_n;   -- los fijos pedidos por la web no se liberan solos: los aprueba el equipo
end $$;
revoke execute on function public.liberar_vencidas() from public, anon, authenticated;

-- 2) Volver a ocupar una reserva que se liberó por falta de pago (si el horario sigue libre)
create or replace function public.reactivar_no_pago(p_reserva_id bigint, p_minutos integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  r public.reservas;
begin
  select * into r from public.reservas where id = p_reserva_id for update;
  if not found or r.estado <> 'vencida' or r.motivo_cancelacion is distinct from public.motivo_no_pago() then return false; end if;
  if not public.libre(r.consultorio_id, r.fecha, r.horas) then
    raise exception 'SIN_LUGAR' using hint = 'Ese horario ya lo tomó otra persona. Ofrecele otro y cargalo desde "+ Reserva".';
  end if;
  begin
    insert into public.ocupaciones (consultorio_id, fecha, hora, reserva_id)
    select r.consultorio_id, r.fecha, h, r.id from unnest(r.horas) h;
  exception when unique_violation then
    raise exception 'SIN_LUGAR' using hint = 'Ese horario ya lo tomó otra persona. Ofrecele otro y cargalo desde "+ Reserva".';
  end;
  update public.reservas
  set estado = 'pendiente', cancelada_en = null, motivo_cancelacion = null, no_pago_visto = false,
      expira_en = case when p_minutos is null then null else now() + make_interval(mins => p_minutos) end
  where id = r.id;
  return true;
end $$;
revoke execute on function public.reactivar_no_pago(bigint, integer) from public, anon, authenticated;

-- PANEL: "Volver a apartar" (otra hora para que pague)
create or replace function public.recuperar_reserva(p_reserva_id bigint, p_minutos integer default 60) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  if not public.reactivar_no_pago(p_reserva_id, greatest(15, least(coalesce(p_minutos, 60), 60 * 24 * 7))) then
    raise exception 'NO_ENCONTRADO' using hint = 'Esa reserva no está liberada por falta de pago';
  end if;
end $$;
revoke execute on function public.recuperar_reserva(bigint, integer) from public, anon;
grant execute on function public.recuperar_reserva(bigint, integer) to authenticated;

-- PANEL: "Descartar" (ya se habló, no va a pagar)
create or replace function public.descartar_no_pago(p_reserva_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  update public.reservas set no_pago_visto = true
  where id = p_reserva_id and estado = 'vencida' and motivo_cancelacion = public.motivo_no_pago();
  if not found then raise exception 'NO_ENCONTRADO'; end if;
end $$;
revoke execute on function public.descartar_no_pago(bigint) from public, anon;
grant execute on function public.descartar_no_pago(bigint) to authenticated;

-- 3) Registrar un pago de una reserva que se liberó: la recupera sola si el horario sigue libre
create or replace function public.registrar_pago(p_monto integer, p_medio text, p_reserva_id bigint default null,
  p_fijo_id bigint default null, p_periodo text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  r public.reservas;
  v_pagado integer;
begin
  perform public.exigir_equipo();
  if p_monto is null or p_monto <= 0 then
    raise exception 'MONTO_INVALIDO' using hint = 'El monto tiene que ser mayor a cero';
  end if;

  if p_reserva_id is not null then
    perform public.reactivar_no_pago(p_reserva_id, null);
    select * into r from public.reservas where id = p_reserva_id for update;
    if not found then raise exception 'NO_ENCONTRADO' using hint = 'No existe esa reserva'; end if;
    if r.estado not in ('pendiente', 'confirmada') then
      raise exception 'RESERVA_NO_VIGENTE'
        using hint = 'Esa reserva está vencida o cancelada y la hora ya se liberó. Cargala de nuevo desde "Nueva reserva".';
    end if;
    v_pagado := public.monto_pagado_reserva(p_reserva_id);
    if v_pagado + p_monto > r.precio_total then
      raise exception 'PAGO_EXCEDE'
        using hint = format('Falta pagar $%s y se está cargando $%s', r.precio_total - v_pagado, p_monto);
    end if;
  elsif p_fijo_id is not null then
    if p_periodo is null then
      raise exception 'FALTA_PERIODO' using hint = 'Indicá a qué mes corresponde el pago del fijo';
    end if;
  end if;

  insert into public.pagos (reserva_id, fijo_id, periodo, monto, medio, cobrado_por)
  values (p_reserva_id, p_fijo_id, p_periodo, p_monto, p_medio, auth.uid())
  returning id into v_id;

  if p_reserva_id is not null then
    -- con un pago ya no se libera sola; con la seña completa queda confirmada
    update public.reservas set expira_en = null where id = p_reserva_id and estado = 'pendiente';
    if v_pagado + p_monto >= public.sena_minima(r.precio_total) then
      update public.reservas set estado = 'confirmada', expira_en = null
      where id = p_reserva_id and estado = 'pendiente';
    end if;
  end if;
  return v_id;
end $$;

-- 4) Lo mismo al registrar el pago de un pedido entero
create or replace function public.registrar_pago_pedido(p_pedido_id bigint, p_monto integer, p_medio text) returns text
language plpgsql security definer set search_path = public as $$
declare
  r record;
  f public.fijos;
  v_resto integer := p_monto;
  v_parte integer;
  v_falta integer;
begin
  perform public.exigir_equipo();
  if p_monto is null or p_monto <= 0 then raise exception 'MONTO_INVALIDO' using hint = 'El monto tiene que ser mayor a cero'; end if;

  select * into f from public.fijos where pedido_id = p_pedido_id for update;
  if found then
    v_falta := f.pago_inicial - public.monto_pagado_fijo(f.id, f.periodo_inicial);
    if v_falta <= 0 then raise exception 'RESERVA_NO_VIGENTE' using hint = 'Este fijo ya tiene el primer mes pago.'; end if;
    if p_monto > v_falta then raise exception 'PAGO_EXCEDE' using hint = format('Lo que falta pagar del primer mes es $%s', v_falta); end if;
    return public.aplicar_pago_fijo(f.id, p_monto, p_medio, null, auth.uid());
  end if;

  -- las que se liberaron por no pagar vuelven si el horario sigue libre
  perform public.reactivar_no_pago(id, null) from public.reservas
  where pedido_id = p_pedido_id and estado = 'vencida' and motivo_cancelacion = public.motivo_no_pago();
  perform 1 from public.reservas where pedido_id = p_pedido_id for update;
  select coalesce(sum(precio_total - public.monto_pagado_reserva(id)), 0) into v_falta
  from public.reservas where pedido_id = p_pedido_id and estado in ('pendiente', 'confirmada');
  if v_falta = 0 then
    raise exception 'RESERVA_NO_VIGENTE'
      using hint = 'Este pedido no tiene reservas vigentes con saldo (vencidas, canceladas o ya pagas). Si hace falta, cargalas de nuevo desde "+ Reserva".';
  end if;
  if p_monto > v_falta then
    raise exception 'PAGO_EXCEDE' using hint = format('Lo que falta pagar del pedido es $%s', v_falta);
  end if;

  for r in select id, precio_total from public.reservas
           where pedido_id = p_pedido_id and estado in ('pendiente', 'confirmada') order by fecha, id loop
    exit when v_resto <= 0;
    v_parte := least(v_resto, greatest(0, public.sena_minima(r.precio_total) - public.monto_pagado_reserva(r.id)));
    continue when v_parte = 0;
    insert into public.pagos (reserva_id, monto, medio, cobrado_por) values (r.id, v_parte, p_medio, auth.uid());
    update public.reservas set expira_en = null where id = r.id and estado = 'pendiente';
    v_resto := v_resto - v_parte;
  end loop;
  for r in select id, precio_total from public.reservas
           where pedido_id = p_pedido_id and estado in ('pendiente', 'confirmada') order by fecha, id loop
    exit when v_resto <= 0;
    v_parte := least(v_resto, greatest(0, r.precio_total - public.monto_pagado_reserva(r.id)));
    continue when v_parte = 0;
    insert into public.pagos (reserva_id, monto, medio, cobrado_por) values (r.id, v_parte, p_medio, auth.uid());
    update public.reservas set expira_en = null where id = r.id and estado = 'pendiente';
    v_resto := v_resto - v_parte;
  end loop;

  update public.reservas set estado = 'confirmada', expira_en = null
  where pedido_id = p_pedido_id and estado = 'pendiente' and public.monto_pagado_reserva(id) >= public.sena_minima(precio_total);
  return case when exists (select 1 from public.reservas where pedido_id = p_pedido_id and estado = 'pendiente')
              then 'PAGO_PARCIAL' else 'CONFIRMADA' end;
end $$;

-- 5) Las alertas: se suma "No pagó"
create or replace function public.alertas_pago() returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := public.hoy_ar();
  v_dias integer := coalesce(public.cfg('dias_antes_saldo'), 1);
begin
  perform public.exigir_equipo();
  return coalesce((
    select json_agg(a order by
      case a->>'gravedad' when 'no_pago' then 0 when 'vencida' then 1 when 'hoy' then 2 else 3 end,
      a->>'fecha_turno', a->>'nombre')
    from (
      -- a) horas sueltas sin la seña
      select json_build_object(
        'tipo', 'sena', 'texto', 'Falta la seña',
        -- la seña se pide al reservar: pasado el tiempo para pagarla (o si el turno ya está encima) es "vencida"
        'gravedad', case when r.fecha - v_dias < v_hoy or (r.expira_en is not null and r.expira_en < now()) then 'vencida'
                         when r.fecha - v_dias = v_hoy then 'hoy' else 'pendiente' end,
        'fecha_turno', r.fecha, 'fecha_limite', coalesce((r.expira_en at time zone 'America/Argentina/Buenos_Aires')::date, r.fecha - v_dias),
        'horas', r.horas, 'consultorio', c.nombre,
        'falta', public.sena_minima(r.precio_total) - public.monto_pagado_reserva(r.id),
        'total', r.precio_total - public.monto_pagado_reserva(r.id),
        'reserva_id', r.id, 'pedido_id', r.pedido_id, 'origen', r.origen, 'expira_en', r.expira_en,
        'nombre', p.nombre, 'whatsapp', p.whatsapp) as a
      from public.reservas r
      join public.profesionales p on p.id = r.profesional_id
      join public.consultorios c on c.id = r.consultorio_id
      where r.estado = 'pendiente' and r.origen <> 'excel' and r.fecha >= v_hoy - 30

      union all
      -- a2) NO PAGÓ: pasó la hora sin seña y el horario se liberó solo (hasta que el equipo la recupere o la descarte)
      select json_build_object(
        'tipo', 'no_pago', 'texto', 'No pagó la seña',
        'gravedad', 'no_pago',
        'fecha_turno', r.fecha, 'fecha_limite', (r.cancelada_en at time zone 'America/Argentina/Buenos_Aires')::date,
        'liberada_en', r.cancelada_en, 'horas', r.horas, 'consultorio', c.nombre,
        'falta', public.sena_minima(r.precio_total), 'total', r.precio_total,
        'libre', public.libre(r.consultorio_id, r.fecha, r.horas),
        'reserva_id', r.id, 'pedido_id', r.pedido_id, 'origen', r.origen,
        'nombre', p.nombre, 'whatsapp', p.whatsapp)
      from public.reservas r
      join public.profesionales p on p.id = r.profesional_id
      join public.consultorios c on c.id = r.consultorio_id
      where r.estado = 'vencida' and r.motivo_cancelacion = public.motivo_no_pago()
        and not r.no_pago_visto and r.fecha >= v_hoy

      union all
      -- b) horas sueltas confirmadas con saldo: se paga hasta el día anterior
      select json_build_object(
        'tipo', 'saldo', 'texto', 'Falta el saldo',
        'gravedad', case when r.fecha - v_dias < v_hoy then 'vencida' else 'hoy' end,
        'fecha_turno', r.fecha, 'fecha_limite', r.fecha - v_dias, 'horas', r.horas, 'consultorio', c.nombre,
        'falta', r.precio_total - public.monto_pagado_reserva(r.id), 'total', r.precio_total - public.monto_pagado_reserva(r.id),
        'reserva_id', r.id, 'pedido_id', r.pedido_id, 'origen', r.origen,
        'nombre', p.nombre, 'whatsapp', p.whatsapp)
      from public.reservas r
      join public.profesionales p on p.id = r.profesional_id
      join public.consultorios c on c.id = r.consultorio_id
      where r.estado = 'confirmada' and r.origen <> 'excel'
        and r.fecha - v_dias <= v_hoy and r.fecha >= v_hoy - 30
        and r.precio_total > public.monto_pagado_reserva(r.id)

      union all
      -- c) fijo pedido por la web, sin pagar el primer mes
      select json_build_object(
        'tipo', 'fijo_inicial', 'texto', 'Falta pagar el primer mes del fijo',
        'gravedad', case when f.desde - 1 < v_hoy then 'vencida' when f.desde - 1 = v_hoy then 'hoy' else 'pendiente' end,
        'fecha_turno', f.desde, 'fecha_limite', f.desde - 1, 'horas', f.horas, 'consultorio', c.nombre, 'dia_semana', f.dia_semana,
        'falta', coalesce(f.pago_inicial, f.precio_semanal * greatest(1, cardinality(public.fechas_primer_mes(f.id))))
                 - public.monto_pagado_fijo(f.id, coalesce(f.periodo_inicial, to_char(f.desde, 'YYYY-MM'))),
        'total', coalesce(f.pago_inicial, f.precio_semanal * greatest(1, cardinality(public.fechas_primer_mes(f.id)))),
        'fijo_id', f.id, 'pedido_id', f.pedido_id,
        'nombre', p.nombre, 'whatsapp', p.whatsapp)
      from public.fijos f
      join public.profesionales p on p.id = f.profesional_id
      join public.consultorios c on c.id = f.consultorio_id
      where f.estado = 'solicitud'

      union all
      -- d) fijos activos: el mes (este y el que viene) se paga hasta el día anterior a su primera semana
      select json_build_object(
        'tipo', 'fijo_mes', 'texto', 'Falta pagar el mes ' || m.periodo,
        'gravedad', case when m.primera - 1 < v_hoy then 'vencida' else 'hoy' end,
        'fecha_turno', m.primera, 'fecha_limite', m.primera - 1, 'horas', m.horas, 'consultorio', m.consultorio, 'dia_semana', m.dia_semana,
        'falta', m.monto - m.pagado, 'total', m.monto, 'periodo', m.periodo, 'fijo_id', m.id,
        'nombre', m.nombre, 'whatsapp', m.whatsapp)
      from (
        select f.id, f.horas, f.dia_semana, c.nombre as consultorio, p.nombre, p.whatsapp, per.periodo,
               min(d::date) as primera, f.precio_semanal * count(*) as monto,
               public.monto_pagado_fijo(f.id, per.periodo) as pagado
        from public.fijos f
        join public.profesionales p on p.id = f.profesional_id
        join public.consultorios c on c.id = f.consultorio_id
        cross join lateral (values (date_trunc('month', v_hoy)::date), ((date_trunc('month', v_hoy) + interval '1 month')::date)) mes(ini)
        cross join lateral (select to_char(mes.ini, 'YYYY-MM') as periodo) per
        cross join lateral generate_series(greatest(mes.ini, f.desde)::timestamp,
                                           least((mes.ini + interval '1 month - 1 day')::date, coalesce(f.hasta, '9999-12-31'::date))::timestamp,
                                           interval '1 day') d
        where f.estado = 'activo'
          and extract(isodow from d)::int = f.dia_semana
          and not exists (select 1 from public.fijo_excepciones e where e.fijo_id = f.id and e.fecha = d::date)
        group by f.id, f.horas, f.dia_semana, c.nombre, p.nombre, p.whatsapp, per.periodo, f.precio_semanal
      ) m
      where m.monto > m.pagado and m.primera - 1 <= v_hoy
    ) t), '[]'::json);
end $$;
revoke execute on function public.alertas_pago() from public, anon;
grant execute on function public.alertas_pago() to authenticated;

-- 6) La tarea automática: cada minuto
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'psicostudios-liberar-vencidas';
    perform cron.schedule('psicostudios-liberar-vencidas', '* * * * *', $c$ select public.liberar_vencidas() $c$);
  end if;
end $$;

-- 7) Las que ya estaban esperando la seña: tienen una hora desde ahora (no se libera nada de golpe)
update public.reservas set expira_en = now() + make_interval(mins => public.cfg('retencion_suelta_minutos'))
where estado = 'pendiente' and origen <> 'excel' and expira_en is not null and public.monto_pagado_reserva(id) = 0;

select 'Listo: las reservas web sin seña se liberan solas a la hora y quedan en el panel como "No pagó"' as resultado;

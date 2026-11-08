-- =====================================================================
-- PSICOSTUDIOS · 17_alertas_pago.sql
-- REGLA: el sistema NUNCA cancela ni libera nada solo. Si falta un pago,
-- levanta una ALERTA en el panel y el equipo decide.
--   · Horas sueltas: la seña se pide al reservar; el SALDO se paga hasta el
--     DÍA ANTERIOR al turno.
--   · Fijos: el primer mes al reservar; después, cada mes por adelantado
--     (hasta el día anterior a la primera semana del mes).
--   · Reservas para hoy o mañana: se pueden hacer; la alerta sale enseguida.
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Requiere 01 a 16. Se puede correr más de una vez.
-- =====================================================================

insert into public.config (clave, valor, descripcion) values
  ('dias_antes_saldo', '1', 'El saldo de las horas sueltas se paga hasta cuántos días antes del turno')
on conflict (clave) do nothing;

-- 1) Nada se libera solo: se apaga la tarea automática y la función queda sin efecto
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    execute $q$select cron.unschedule(jobid) from cron.job where jobname = 'psicostudios-liberar-vencidas'$q$;
  end if;
end $$;

create or replace function public.liberar_vencidas() returns integer
language sql security definer set search_path = public as $$
  select 0  -- a pedido del equipo: no se cancela nada automáticamente (ver alertas_pago)
$$;

-- 2) Pagar con Mercado Pago (si se prende) ya no depende de un plazo: se puede pagar mientras la reserva exista
create or replace function public.preparar_pago_pedido(p_pedido_id bigint, p_token uuid, p_pagar text default 'sena') returns json
language plpgsql stable security definer set search_path = public as $$
declare
  f public.fijos;
  v_monto integer;
  v_n integer;
  v_fechas text;
  v_no_vigente constant text := 'Esta reserva ya no está vigente. Escribinos por WhatsApp.';
begin
  if coalesce(public.cfg_texto('mercadopago_activo'), 'no') <> 'si' then
    raise exception 'MP_APAGADO' using hint = 'El pago online no está disponible. Transferí al alias.';
  end if;
  if not exists (select 1 from public.pedidos where id = p_pedido_id and token = p_token) then
    raise exception 'NO_ENCONTRADO' using hint = 'No encontramos ese pedido';
  end if;

  select * into f from public.fijos where pedido_id = p_pedido_id;
  if found then
    if f.estado = 'activo' then raise exception 'YA_CONFIRMADA' using hint = 'Este horario fijo ya está pago y confirmado.'; end if;
    if f.estado <> 'solicitud' then raise exception 'RESERVA_NO_VIGENTE' using hint = v_no_vigente; end if;
    v_monto := f.pago_inicial - public.monto_pagado_fijo(f.id, f.periodo_inicial);
    if v_monto <= 0 then raise exception 'YA_CONFIRMADA' using hint = 'Este horario fijo ya está pago.'; end if;
    return json_build_object('id', p_pedido_id, 'monto', v_monto, 'expira_en', null,
      'descripcion', format('Fijo pedido #%s · %s %s · primer mes (%s)', p_pedido_id,
                            lower((array['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'])[f.dia_semana]),
                            public.rangos_horas(f.horas), f.periodo_inicial));
  end if;

  if p_pagar = 'total' then
    select coalesce(sum(greatest(0, precio_total - public.monto_pagado_reserva(id))), 0)::integer,
           count(*), string_agg(to_char(fecha, 'DD/MM'), ', ' order by fecha)
      into v_monto, v_n, v_fechas
    from public.reservas where pedido_id = p_pedido_id and estado in ('pendiente', 'confirmada');
    if v_n = 0 then raise exception 'RESERVA_NO_VIGENTE' using hint = v_no_vigente; end if;
    if v_monto <= 0 then raise exception 'YA_CONFIRMADA' using hint = 'Este pedido ya está pago.'; end if;
    return json_build_object('id', p_pedido_id, 'monto', v_monto, 'expira_en', null,
      'descripcion', format('Pedido #%s · pago total · %s %s (%s)', p_pedido_id, v_n, case when v_n = 1 then 'turno' else 'turnos' end, v_fechas));
  end if;

  select coalesce(sum(greatest(0, public.sena_minima(precio_total) - public.monto_pagado_reserva(id))), 0)::integer,
         count(*), string_agg(to_char(fecha, 'DD/MM'), ', ' order by fecha)
    into v_monto, v_n, v_fechas
  from public.reservas where pedido_id = p_pedido_id and estado = 'pendiente';
  if v_n = 0 then
    if exists (select 1 from public.reservas where pedido_id = p_pedido_id and estado = 'confirmada') then
      raise exception 'YA_CONFIRMADA' using hint = 'Este pedido ya tiene la seña paga.';
    end if;
    raise exception 'RESERVA_NO_VIGENTE' using hint = v_no_vigente;
  end if;
  if v_monto <= 0 then raise exception 'YA_CONFIRMADA' using hint = 'Este pedido ya tiene la seña paga.'; end if;
  return json_build_object('id', p_pedido_id, 'monto', v_monto, 'expira_en', null,
    'descripcion', format('Seña pedido #%s · %s %s (%s)', p_pedido_id, v_n, case when v_n = 1 then 'turno' else 'turnos' end, v_fechas));
end $$;
revoke execute on function public.preparar_pago_pedido(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.preparar_pago_pedido(bigint, uuid, text) to service_role;

-- 3) Las alertas de pago para el panel
-- gravedad: 'vencida' (ya pasó el plazo), 'hoy' (vence hoy), 'pendiente' (todavía hay tiempo)
create or replace function public.alertas_pago() returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := public.hoy_ar();
  v_dias integer := coalesce(public.cfg('dias_antes_saldo'), 1);
begin
  perform public.exigir_equipo();
  return coalesce((
    select json_agg(a order by
      case a->>'gravedad' when 'vencida' then 0 when 'hoy' then 1 else 2 end,
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
        'reserva_id', r.id, 'pedido_id', r.pedido_id, 'origen', r.origen,
        'nombre', p.nombre, 'whatsapp', p.whatsapp) as a
      from public.reservas r
      join public.profesionales p on p.id = r.profesional_id
      join public.consultorios c on c.id = r.consultorio_id
      where r.estado = 'pendiente' and r.origen <> 'excel' and r.fecha >= v_hoy - 30

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

select 'Alertas de pago listas: nada se cancela solo' as resultado;

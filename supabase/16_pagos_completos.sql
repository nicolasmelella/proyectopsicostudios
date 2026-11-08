-- =====================================================================
-- PSICOSTUDIOS · 16_pagos_completos.sql
-- Cómo se paga desde la web:
--   · HORAS SUELTAS: se elige pagar la SEÑA o el TOTAL (Mercado Pago o transferencia).
--   · HORARIO FIJO: se paga TODO EL PRIMER MES por adelantado (las semanas que
--     quedan de ese mes desde que empieza). Al pagarlo, el fijo queda activo solo,
--     sin que el equipo tenga que aprobarlo. Después, mes a mes como siempre.
--   · Un fijo pedido desde la web ahora es un "pedido" (con su código secreto),
--     igual que las horas sueltas: se paga, se sube el comprobante y se puede
--     cancelar antes de pagar con el mismo link.
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Requiere 01 a 15. Se puede correr más de una vez.
-- =====================================================================

alter table public.fijos add column if not exists pedido_id bigint references public.pedidos (id);
alter table public.fijos add column if not exists pago_inicial integer;     -- lo que hay que pagar para arrancar (primer mes)
alter table public.fijos add column if not exists periodo_inicial text;     -- el mes de ese pago: '2026-11'
create unique index if not exists fijos_pedido_id on public.fijos (pedido_id) where pedido_id is not null;

-- La persona puede cancelar su propio pedido de fijo: nuevo estado "cancelado"
alter table public.fijos drop constraint if exists fijos_estado_check;
alter table public.fijos add constraint fijos_estado_check
  check (estado in ('solicitud', 'activo', 'rechazado', 'vencido', 'baja', 'cancelado'));

create or replace function public.monto_pagado_fijo(p_fijo_id bigint, p_periodo text) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(monto), 0)::integer from public.pagos
  where fijo_id = p_fijo_id and periodo = p_periodo and not anulado
$$;
revoke execute on function public.monto_pagado_fijo(bigint, text) from public, anon, authenticated;

-- Fechas del primer mes de un fijo (las que de verdad le quedan ocupadas: sin feriados ni semanas que no viene)
create or replace function public.fechas_primer_mes(p_fijo_id bigint) returns date[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(d::date order by d), '{}')
  from public.fijos f, generate_series(f.desde::timestamp, (date_trunc('month', f.desde) + interval '1 month - 1 day'), interval '7 days') d
  where f.id = p_fijo_id
    and not exists (select 1 from public.fijo_excepciones e where e.fijo_id = f.id and e.fecha = d::date)
    and not exists (select 1 from public.ocupaciones o where o.consultorio_id = f.consultorio_id and o.fecha = d::date
                      and o.hora = any (f.horas) and o.bloqueo_id is not null)
$$;
revoke execute on function public.fechas_primer_mes(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- WEB: pedir un horario fijo (reemplaza a crear_solicitud_fijo en la web)
-- ---------------------------------------------------------------------
create or replace function public.crear_fijo_web(
  p_nombre text, p_whatsapp text, p_profesion text, p_email text,
  p_dia smallint, p_horas smallint[], p_desde date, p_consultorio smallint default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v json;
  f public.fijos;
  v_pedido bigint;
  v_token uuid;
  v_fechas date[];
  v_monto integer;
  v_expira timestamptz := now() + make_interval(mins => public.cfg('retencion_suelta_minutos'));
begin
  v := public.crear_solicitud_fijo(p_nombre, p_whatsapp, p_profesion, p_email, p_dia, p_horas, p_desde, p_consultorio);
  select * into f from public.fijos where id = (v->>'id')::bigint;
  insert into public.pedidos (profesional_id) values (f.profesional_id) returning id, token into v_pedido, v_token;
  v_fechas := public.fechas_primer_mes(f.id);
  if cardinality(v_fechas) = 0 then v_fechas := array[f.desde]; end if;
  v_monto := f.precio_semanal * cardinality(v_fechas);
  update public.fijos set pedido_id = v_pedido, pago_inicial = v_monto, periodo_inicial = to_char(f.desde, 'YYYY-MM'),
                          expira_en = v_expira
  where id = f.id;

  return json_build_object(
    'id', f.id, 'pedido', v_pedido, 'token', v_token,
    'consultorio', v->>'consultorio', 'precio_semanal', f.precio_semanal,
    'precio_mensual_aprox', (v->>'precio_mensual_aprox')::integer,
    'total', v_monto, 'sena', v_monto, 'expira_en', v_expira, 'periodo', to_char(f.desde, 'YYYY-MM'),
    'reservas', (select json_agg(json_build_object('fecha', d, 'horas', f.horas, 'consultorio', v->>'consultorio') order by d)
                 from unnest(v_fechas) d));
end $$;
revoke execute on function public.crear_fijo_web(text, text, text, text, smallint, smallint[], date, smallint) from public;
grant execute on function public.crear_fijo_web(text, text, text, text, smallint, smallint[], date, smallint) to anon, authenticated;
-- La web ya no pide fijos sin pago
revoke execute on function public.crear_solicitud_fijo(text, text, text, text, smallint, smallint[], date, smallint) from anon, authenticated;

-- ---------------------------------------------------------------------
-- WEB: estado de un pedido (horas sueltas o fijo). No devuelve nombres ni teléfonos.
-- ---------------------------------------------------------------------
create or replace function public.estado_pago_pedido(p_pedido_id bigint, p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v json;
  f public.fijos;
  v_est text;
begin
  if not exists (select 1 from public.pedidos where id = p_pedido_id and token = p_token) then
    raise exception 'NO_ENCONTRADO' using hint = 'No encontramos ese pedido';
  end if;

  select * into f from public.fijos where pedido_id = p_pedido_id;
  if found then
    v_est := case f.estado when 'activo' then 'confirmada' when 'solicitud' then 'pendiente'
                           when 'vencido' then 'vencida' else 'cancelada' end;
    return json_build_object(
      'id', p_pedido_id, 'tipo', 'fijo', 'estado', v_est,
      'total', f.pago_inicial, 'pagado', public.monto_pagado_fijo(f.id, f.periodo_inicial), 'sena', f.pago_inicial,
      'expira_en', case when f.estado = 'solicitud' then f.expira_en end,
      'fijo', json_build_object('dia', f.dia_semana, 'horas', f.horas, 'desde', f.desde, 'precio_semanal', f.precio_semanal,
                                'consultorio', (select nombre from public.consultorios where id = f.consultorio_id)),
      'reservas', (select json_agg(json_build_object('id', null, 'fecha', d, 'horas', f.horas, 'estado', v_est, 'total', f.precio_semanal,
                                   'consultorio', (select nombre from public.consultorios where id = f.consultorio_id)) order by d)
                   from unnest(public.fechas_primer_mes(f.id)) d));
  end if;

  select json_build_object(
    'id', pe.id, 'tipo', 'suelta',
    'estado', case when bool_and(r.estado = 'confirmada') then 'confirmada'
                   when bool_or(r.estado = 'pendiente') then 'pendiente'
                   when bool_or(r.estado = 'confirmada') then 'parcial'
                   else 'vencida' end,
    'total', sum(r.precio_total),
    'pagado', sum(public.monto_pagado_reserva(r.id)),
    'sena', sum(public.sena_minima(r.precio_total)),
    'expira_en', min(r.expira_en),
    'reservas', json_agg(json_build_object('id', r.id, 'fecha', r.fecha, 'horas', r.horas, 'consultorio', c.nombre,
                                           'estado', r.estado, 'total', r.precio_total) order by r.fecha))
  into v
  from public.pedidos pe
  join public.reservas r on r.pedido_id = pe.id
  join public.consultorios c on c.id = r.consultorio_id
  where pe.id = p_pedido_id
  group by pe.id;
  if v is null then raise exception 'NO_ENCONTRADO' using hint = 'No encontramos ese pedido'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- SERVIDOR: cuánto cobrar por Mercado Pago. p_pagar: 'sena' o 'total' (los fijos, siempre el primer mes)
-- ---------------------------------------------------------------------
drop function if exists public.preparar_pago_pedido(bigint, uuid);
create or replace function public.preparar_pago_pedido(p_pedido_id bigint, p_token uuid, p_pagar text default 'sena') returns json
language plpgsql stable security definer set search_path = public as $$
declare
  f public.fijos;
  v_monto integer;
  v_expira timestamptz;
  v_n integer;
  v_fechas text;
  v_vencido constant text := 'Se venció el tiempo para pagar y los horarios se liberaron. Hacé una reserva nueva.';
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
    if f.estado <> 'solicitud' or f.expira_en < now() + interval '2 minutes' then
      raise exception 'RESERVA_NO_VIGENTE' using hint = v_vencido;
    end if;
    v_monto := f.pago_inicial - public.monto_pagado_fijo(f.id, f.periodo_inicial);
    if v_monto <= 0 then raise exception 'YA_CONFIRMADA' using hint = 'Este horario fijo ya está pago.'; end if;
    return json_build_object('id', p_pedido_id, 'monto', v_monto, 'expira_en', f.expira_en,
      'descripcion', format('Fijo pedido #%s · %s %s · primer mes (%s)', p_pedido_id,
                            lower((array['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'])[f.dia_semana]),
                            public.rangos_horas(f.horas), f.periodo_inicial));
  end if;

  select count(*), min(expira_en), string_agg(to_char(fecha, 'DD/MM'), ', ' order by fecha)
    into v_n, v_expira, v_fechas
  from public.reservas where pedido_id = p_pedido_id and estado = 'pendiente';

  if p_pagar = 'total' then
    select coalesce(sum(greatest(0, precio_total - public.monto_pagado_reserva(id))), 0)::integer,
           count(*), string_agg(to_char(fecha, 'DD/MM'), ', ' order by fecha)
      into v_monto, v_n, v_fechas
    from public.reservas where pedido_id = p_pedido_id and estado in ('pendiente', 'confirmada');
    if v_n = 0 then raise exception 'RESERVA_NO_VIGENTE' using hint = v_vencido; end if;
    if v_expira is not null and v_expira < now() + interval '2 minutes' then raise exception 'RESERVA_NO_VIGENTE' using hint = v_vencido; end if;
    if v_monto <= 0 then raise exception 'YA_CONFIRMADA' using hint = 'Este pedido ya está pago.'; end if;
    return json_build_object('id', p_pedido_id, 'monto', v_monto, 'expira_en', v_expira,
      'descripcion', format('Pedido #%s · pago total · %s %s (%s)', p_pedido_id, v_n, case when v_n = 1 then 'turno' else 'turnos' end, v_fechas));
  end if;

  if v_n = 0 then
    if exists (select 1 from public.reservas where pedido_id = p_pedido_id and estado = 'confirmada') then
      raise exception 'YA_CONFIRMADA' using hint = 'Este pedido ya tiene la seña paga.';
    end if;
    raise exception 'RESERVA_NO_VIGENTE' using hint = v_vencido;
  end if;
  if v_expira is not null and v_expira < now() + interval '2 minutes' then
    raise exception 'RESERVA_NO_VIGENTE' using hint = v_vencido;
  end if;
  select coalesce(sum(greatest(0, public.sena_minima(precio_total) - public.monto_pagado_reserva(id))), 0)::integer into v_monto
  from public.reservas where pedido_id = p_pedido_id and estado = 'pendiente';
  if v_monto <= 0 then raise exception 'YA_CONFIRMADA' using hint = 'Este pedido ya tiene la seña paga.'; end if;
  return json_build_object('id', p_pedido_id, 'monto', v_monto, 'expira_en', v_expira,
    'descripcion', format('Seña pedido #%s · %s %s (%s)', p_pedido_id, v_n, case when v_n = 1 then 'turno' else 'turnos' end, v_fechas));
end $$;
revoke execute on function public.preparar_pago_pedido(bigint, uuid, text) from public, anon, authenticated;
grant execute on function public.preparar_pago_pedido(bigint, uuid, text) to service_role;

-- "08:00 a 10:00" (para textos)
create or replace function public.rangos_horas(p_horas smallint[]) returns text
language sql immutable set search_path = public as $$
  select lpad(min(h)::text, 2, '0') || ':00 a ' || lpad((max(h) + 1)::text, 2, '0') || ':00' from unnest(p_horas) h
$$;

-- ---------------------------------------------------------------------
-- Cobrar el primer mes de un fijo (Mercado Pago o el equipo). Si queda pago, se activa solo.
-- ---------------------------------------------------------------------
create or replace function public.aplicar_pago_fijo(p_fijo_id bigint, p_monto integer, p_medio text,
                                                    p_mp_payment_id text default null, p_cobrado_por uuid default null)
returns text
language plpgsql security definer set search_path = public as $$
declare
  f public.fijos;
begin
  select * into f from public.fijos where id = p_fijo_id for update;
  if f.estado not in ('solicitud', 'activo') then
    if p_mp_payment_id is null then
      raise exception 'RESERVA_NO_VIGENTE' using hint = 'Este fijo ya no está vigente (venció o se canceló). Si hace falta, cargalo de nuevo desde Fijos.';
    end if;
    insert into public.pagos_a_revisar (reserva_id, mp_payment_id, monto, motivo)
    values (null, p_mp_payment_id, p_monto, format('Pagó el fijo #%s, que estaba %s', f.id, f.estado));
    return 'A_REVISAR';
  end if;
  insert into public.pagos (fijo_id, periodo, monto, medio, mp_payment_id, cobrado_por)
  values (f.id, f.periodo_inicial, p_monto, p_medio, p_mp_payment_id, p_cobrado_por);
  if f.estado = 'solicitud' and public.monto_pagado_fijo(f.id, f.periodo_inicial) >= f.pago_inicial then
    update public.fijos set estado = 'activo', expira_en = null, aprobado_en = now(), aprobado_por = p_cobrado_por where id = f.id;
    perform public.ocupar_fijo(f.id, false);
    return 'CONFIRMADA';
  end if;
  return case when f.estado = 'activo' then 'CONFIRMADA' else 'PAGO_PARCIAL' end;
end $$;
revoke execute on function public.aplicar_pago_fijo(bigint, integer, text, text, uuid) from public, anon, authenticated, service_role;

-- Mercado Pago avisó un pago aprobado de un pedido (sueltas: seña y después saldo; fijo: primer mes)
create or replace function public.registrar_pago_pedido_mp(p_pedido_id bigint, p_mp_payment_id text, p_monto integer)
returns text
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_fijo bigint;
  v_resto integer := p_monto;
  v_parte integer;
  v_revisar boolean := false;
  v_res text;
begin
  perform pg_advisory_xact_lock(hashtext('mp:' || p_mp_payment_id));
  if exists (select 1 from public.pagos where mp_payment_id = p_mp_payment_id)
     or exists (select 1 from public.pagos_a_revisar where mp_payment_id = p_mp_payment_id) then
    return 'YA_REGISTRADO';
  end if;

  select id into v_fijo from public.fijos where pedido_id = p_pedido_id;
  if v_fijo is not null then
    return public.aplicar_pago_fijo(v_fijo, p_monto, 'mercadopago', p_mp_payment_id, null);
  end if;

  if not exists (select 1 from public.reservas where pedido_id = p_pedido_id) then
    insert into public.pagos_a_revisar (reserva_id, mp_payment_id, monto, motivo)
    values (null, p_mp_payment_id, p_monto, format('Pago para el pedido #%s, que no existe', p_pedido_id));
    return 'A_REVISAR';
  end if;

  for r in select id, precio_total from public.reservas where pedido_id = p_pedido_id order by fecha, id loop
    exit when v_resto <= 0;
    v_parte := least(v_resto, greatest(0, public.sena_minima(r.precio_total) - public.monto_pagado_reserva(r.id)));
    continue when v_parte = 0;
    v_res := public.aplicar_pago_mp_reserva(r.id, p_mp_payment_id, v_parte);
    v_revisar := v_revisar or v_res = 'A_REVISAR';
    v_resto := v_resto - v_parte;
  end loop;
  for r in select id, precio_total from public.reservas
           where pedido_id = p_pedido_id and estado in ('pendiente', 'confirmada') order by fecha, id loop
    exit when v_resto <= 0;
    v_parte := least(v_resto, greatest(0, r.precio_total - public.monto_pagado_reserva(r.id)));
    continue when v_parte = 0;
    perform public.aplicar_pago_mp_reserva(r.id, p_mp_payment_id, v_parte);
    v_resto := v_resto - v_parte;
  end loop;
  if v_resto > 0 then
    insert into public.pagos_a_revisar (reserva_id, mp_payment_id, monto, motivo)
    values (null, p_mp_payment_id, v_resto, format('Sobraron $%s del pago del pedido #%s', v_resto, p_pedido_id));
    v_revisar := true;
  end if;

  if v_revisar then return 'A_REVISAR'; end if;
  if not exists (select 1 from public.reservas where pedido_id = p_pedido_id and estado <> 'confirmada') then return 'CONFIRMADA'; end if;
  return 'PAGO_PARCIAL';
end $$;

-- PANEL: registrar lo que pagó un pedido (al aceptar un comprobante). Ahora también fijos.
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
    v_resto := v_resto - v_parte;
  end loop;
  for r in select id, precio_total from public.reservas
           where pedido_id = p_pedido_id and estado in ('pendiente', 'confirmada') order by fecha, id loop
    exit when v_resto <= 0;
    v_parte := least(v_resto, greatest(0, r.precio_total - public.monto_pagado_reserva(r.id)));
    continue when v_parte = 0;
    insert into public.pagos (reserva_id, monto, medio, cobrado_por) values (r.id, v_parte, p_medio, auth.uid());
    v_resto := v_resto - v_parte;
  end loop;

  update public.reservas set estado = 'confirmada', expira_en = null
  where pedido_id = p_pedido_id and estado = 'pendiente' and public.monto_pagado_reserva(id) >= public.sena_minima(precio_total);
  return case when exists (select 1 from public.reservas where pedido_id = p_pedido_id and estado = 'pendiente')
              then 'PAGO_PARCIAL' else 'CONFIRMADA' end;
end $$;

-- PANEL: comprobantes a revisar (ahora también de fijos)
create or replace function public.comprobantes_pendientes() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  return coalesce((
    select json_agg(x order by x->>'creado_en') from (
      select case when f.id is null then json_build_object(
        'id', c.id, 'ruta', c.ruta, 'tipo', c.tipo, 'creado_en', c.creado_en, 'pedido_id', c.pedido_id,
        'nombre', pr.nombre, 'whatsapp', pr.whatsapp, 'es_fijo', false,
        'total', (select sum(precio_total) from public.reservas where pedido_id = c.pedido_id),
        'pagado', (select sum(public.monto_pagado_reserva(id)) from public.reservas where pedido_id = c.pedido_id),
        'falta_sena', (select coalesce(sum(greatest(0, public.sena_minima(precio_total) - public.monto_pagado_reserva(id))), 0)
                       from public.reservas where pedido_id = c.pedido_id and estado in ('pendiente', 'confirmada')),
        'falta_total', (select coalesce(sum(precio_total - public.monto_pagado_reserva(id)), 0)
                        from public.reservas where pedido_id = c.pedido_id and estado in ('pendiente', 'confirmada')),
        'reservas', (select json_agg(json_build_object('id', r.id, 'fecha', r.fecha, 'horas', r.horas, 'estado', r.estado,
                                                       'consultorio', co.nombre, 'expira_en', r.expira_en) order by r.fecha)
                     from public.reservas r join public.consultorios co on co.id = r.consultorio_id where r.pedido_id = c.pedido_id))
      else json_build_object(
        'id', c.id, 'ruta', c.ruta, 'tipo', c.tipo, 'creado_en', c.creado_en, 'pedido_id', c.pedido_id,
        'nombre', pr.nombre, 'whatsapp', pr.whatsapp, 'es_fijo', true, 'fijo_id', f.id,
        'total', f.pago_inicial, 'pagado', public.monto_pagado_fijo(f.id, f.periodo_inicial),
        'falta_sena', greatest(0, f.pago_inicial - public.monto_pagado_fijo(f.id, f.periodo_inicial)),
        'falta_total', greatest(0, f.pago_inicial - public.monto_pagado_fijo(f.id, f.periodo_inicial)),
        'reservas', (select json_agg(json_build_object('id', null, 'fecha', d, 'horas', f.horas,
                                                       'estado', case f.estado when 'activo' then 'confirmada' when 'solicitud' then 'pendiente' else 'vencida' end,
                                                       'consultorio', co.nombre, 'expira_en', f.expira_en) order by d)
                     from unnest(public.fechas_primer_mes(f.id)) d, public.consultorios co where co.id = f.consultorio_id))
      end as x
      from public.comprobantes c
      join public.pedidos pe on pe.id = c.pedido_id
      join public.profesionales pr on pr.id = pe.profesional_id
      left join public.fijos f on f.pedido_id = c.pedido_id
      where c.estado = 'pendiente') t), '[]'::json);
end $$;

-- Al subir un comprobante de un fijo, el horario se guarda unas horas más (igual que las sueltas)
create or replace function public.comprobante_extiende_fijo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.fijos set expira_en = greatest(expira_en, now() + make_interval(hours => public.cfg('horas_espera_comprobante')))
  where pedido_id = new.pedido_id and estado = 'solicitud';
  return new;
end $$;
revoke execute on function public.comprobante_extiende_fijo() from public, anon, authenticated;
drop trigger if exists comprobante_extiende_fijo on public.comprobantes;
create trigger comprobante_extiende_fijo after insert on public.comprobantes
  for each row execute function public.comprobante_extiende_fijo();

-- WEB: cancelar antes de pagar (ahora también un fijo)
create or replace function public.cancelar_pedido_web(p_pedido_id bigint, p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare
  f public.fijos;
  v_n integer;
  v_pagado constant text := 'Este pedido ya tiene un pago o un comprobante. Para cancelarlo escribinos por WhatsApp.';
begin
  if not exists (select 1 from public.pedidos where id = p_pedido_id and token = p_token) then
    raise exception 'NO_ENCONTRADO' using hint = 'No encontramos ese pedido';
  end if;
  if exists (select 1 from public.comprobantes c where c.pedido_id = p_pedido_id) then
    raise exception 'YA_PAGADO' using hint = v_pagado;
  end if;

  select * into f from public.fijos where pedido_id = p_pedido_id for update;
  if found then
    if f.estado = 'activo' or public.monto_pagado_fijo(f.id, f.periodo_inicial) > 0 then
      raise exception 'YA_PAGADO' using hint = v_pagado;
    end if;
    if f.estado = 'solicitud' then
      update public.fijos set estado = 'cancelado', expira_en = null, baja_en = now() where id = f.id;
      delete from public.ocupaciones where fijo_id = f.id;
    end if;
    return json_build_object('pedido', p_pedido_id, 'canceladas', 1);
  end if;

  if exists (select 1 from public.reservas r where r.pedido_id = p_pedido_id
              and (r.estado = 'confirmada' or public.monto_pagado_reserva(r.id) > 0)) then
    raise exception 'YA_PAGADO' using hint = v_pagado;
  end if;
  with c as (
    update public.reservas
    set estado = 'cancelada', cancelada_en = now(), motivo_cancelacion = 'La canceló la persona desde la web'
    where pedido_id = p_pedido_id and estado = 'pendiente'
    returning id)
  delete from public.ocupaciones o using c where o.reserva_id = c.id;
  select count(*) into v_n from public.reservas where pedido_id = p_pedido_id and estado = 'cancelada';
  return json_build_object('pedido', p_pedido_id, 'canceladas', v_n);
end $$;

-- Datos de un pedido para los avisos: ahora también de un fijo (el primer mes, como "reservas")
create or replace function public.datos_pedido(p_pedido_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select jsonb_build_object(
       'pedido', pe.id, 'token', pe.token, 'nombre', pr.nombre,
       'total', sum(r.precio_total), 'pagado', sum(public.monto_pagado_reserva(r.id)),
       'sena', sum(public.sena_minima(r.precio_total)), 'expira_en', min(r.expira_en),
       'reservas', jsonb_agg(jsonb_build_object('fecha', r.fecha, 'horas', r.horas, 'consultorio', c.nombre, 'estado', r.estado) order by r.fecha),
       'transferencia', public.datos_transferencia())
     from public.pedidos pe
     join public.profesionales pr on pr.id = pe.profesional_id
     join public.reservas r on r.pedido_id = pe.id
     join public.consultorios c on c.id = r.consultorio_id
     where pe.id = p_pedido_id
     group by pe.id, pr.nombre),
    (select jsonb_build_object(
       'pedido', pe.id, 'token', pe.token, 'nombre', pr.nombre, 'es_fijo', true,
       'total', f.pago_inicial, 'pagado', public.monto_pagado_fijo(f.id, f.periodo_inicial),
       'sena', f.pago_inicial, 'expira_en', f.expira_en,
       'reservas', (select jsonb_agg(jsonb_build_object('fecha', d, 'horas', f.horas, 'consultorio', c.nombre,
                                     'estado', case f.estado when 'activo' then 'confirmada' when 'solicitud' then 'pendiente' else 'vencida' end) order by d)
                    from unnest(public.fechas_primer_mes(f.id)) d),
       'transferencia', public.datos_transferencia())
     from public.pedidos pe
     join public.profesionales pr on pr.id = pe.profesional_id
     join public.fijos f on f.pedido_id = pe.id
     join public.consultorios c on c.id = f.consultorio_id
     where pe.id = p_pedido_id))
$$;
revoke execute on function public.datos_pedido(bigint) from public, anon, authenticated;

-- El aviso de "pedido nuevo" es para horas sueltas; los fijos tienen el suyo (fijo_solicitado)
create or replace function public.aviso_pedido_nuevo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.origen = 'web' and exists (select 1 from public.reservas where pedido_id = new.id) then
    perform public.encolar_aviso('reserva_creada', 'pedido:' || new.id, new.profesional_id, public.datos_pedido(new.id), new.id);
  end if;
  return null;
end $$;
revoke execute on function public.aviso_pedido_nuevo() from public, anon, authenticated;

select 'Pagos completos listos: seña o total en sueltas, primer mes en fijos' as resultado;

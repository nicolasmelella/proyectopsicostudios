-- =====================================================================
-- PSICOSTUDIOS · 22_ya_transferi.sql
-- Arreglos de la revisión del sistema:
--   · "YA TRANSFERÍ": la persona avisa desde la web que transfirió. Su
--     horario queda guardado 1 hora más y en el panel aparece la alerta
--     "Avisó que transfirió" para que el equipo revise la cuenta y confirme.
--   · Los FIJOS pedidos por la web sin pagar también se liberan solos
--     (mismo plazo que las reservas por horas) y quedan como "No pagó".
--   · Lo que debe un fijo en el mes se calcula en un solo lugar (descuenta
--     las semanas liberadas), igual en Alertas, Fijos y al registrar el pago.
--   · Dar de baja un fijo con fecha futura: sigue activo (y debiendo) hasta
--     esa fecha.
--   · Pagos de fijos: no se puede cargar más de lo que falta del mes ni un
--     mes en el que el fijo no tiene semanas.
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Requiere 01 a 21. Se puede correr más de una vez.
-- =====================================================================

insert into public.config (clave, valor, descripcion) values
  ('minutos_aviso_transferencia', '60', 'Cuando la persona toca "Ya transferí", minutos que se le guarda el horario mientras el equipo revisa')
on conflict (clave) do nothing;
update public.config
set descripcion = 'Minutos que queda guardado un horario pedido por la web (por horas o fijo) esperando la seña o el primer mes. Después se libera solo'
where clave = 'retencion_suelta_minutos';

alter table public.pedidos add column if not exists aviso_transferencia_en timestamptz;
alter table public.fijos add column if not exists no_pago_visto boolean not null default false;

-- ---------------------------------------------------------------------
-- 1) Cuánto debe un fijo en un mes (un solo cálculo para todo el sistema)
-- ---------------------------------------------------------------------
create or replace function public.cuenta_fijo_mes(p_fijo_id bigint, p_periodo text) returns jsonb
language sql stable security definer set search_path = public as $$
  with f as (select * from public.fijos where id = p_fijo_id),
  mes as (select to_date(p_periodo || '-01', 'YYYY-MM-DD') as ini),
  semanas as (
    select count(*)::integer as n
    from f, mes, generate_series(greatest(mes.ini, f.desde)::timestamp,
                                 least((mes.ini + interval '1 month - 1 day')::date, coalesce(f.hasta, '9999-12-31'::date))::timestamp,
                                 interval '1 day') d
    where extract(isodow from d)::int = f.dia_semana
      and not exists (select 1 from public.fijo_excepciones e where e.fijo_id = f.id and e.fecha = d::date))
  select jsonb_build_object('semanas', s.n, 'debe', f.precio_semanal * s.n,
                            'pagado', public.monto_pagado_fijo(f.id, p_periodo),
                            'falta', greatest(0, f.precio_semanal * s.n - public.monto_pagado_fijo(f.id, p_periodo)))
  from f, semanas s
$$;
revoke execute on function public.cuenta_fijo_mes(bigint, text) from public, anon, authenticated;

-- PANEL: la cuenta de un fijo (detalle) y la de todos los fijos activos del mes (pestaña Fijos)
create or replace function public.panel_cuenta_fijo(p_fijo_id bigint, p_periodo text) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  if p_periodo is null or p_periodo !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'FALTA_PERIODO' using hint = 'El mes tiene que ser del tipo AAAA-MM';
  end if;
  return public.cuenta_fijo_mes(p_fijo_id, p_periodo);
end $$;
revoke execute on function public.panel_cuenta_fijo(bigint, text) from public, anon;
grant execute on function public.panel_cuenta_fijo(bigint, text) to authenticated;

create or replace function public.fijos_del_mes(p_periodo text) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  if p_periodo is null or p_periodo !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
    raise exception 'FALTA_PERIODO' using hint = 'El mes tiene que ser del tipo AAAA-MM';
  end if;
  return coalesce((select json_agg(jsonb_build_object('fijo_id', f.id) || public.cuenta_fijo_mes(f.id, p_periodo) order by f.id)
                   from public.fijos f where f.estado = 'activo'), '[]'::json);
end $$;
revoke execute on function public.fijos_del_mes(text) from public, anon;
grant execute on function public.fijos_del_mes(text) to authenticated;

-- ---------------------------------------------------------------------
-- 2) Fijos web sin pagar: se liberan solos y se pueden recuperar
-- ---------------------------------------------------------------------
create or replace function public.reactivar_fijo_no_pago(p_fijo_id bigint, p_minutos integer) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  f public.fijos;
begin
  select * into f from public.fijos where id = p_fijo_id for update;
  if not found or f.estado <> 'vencido' or f.origen <> 'web' then return false; end if;
  update public.fijos
  set estado = 'solicitud', no_pago_visto = false,
      expira_en = case when p_minutos is null then null else now() + make_interval(mins => p_minutos) end
  where id = f.id;
  begin
    perform public.ocupar_fijo(f.id, true);
  exception when others then
    raise exception 'SIN_LUGAR' using hint = 'Ese horario fijo ya lo tomó otra persona (al menos una semana). Ofrecele otro.';
  end;
  return true;
end $$;
revoke execute on function public.reactivar_fijo_no_pago(bigint, integer) from public, anon, authenticated;

create or replace function public.liberar_vencidas() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer := 0;
  v_m integer := 0;
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

  -- fijos pedidos por la web que no pagaron el primer mes a tiempo
  with v as (
    update public.fijos f
    set estado = 'vencido', no_pago_visto = false
    where f.estado = 'solicitud' and f.origen = 'web'
      and f.expira_en is not null and f.expira_en < now()
      and public.monto_pagado_fijo(f.id, coalesce(f.periodo_inicial, to_char(f.desde, 'YYYY-MM'))) = 0
    returning f.id)
  delete from public.ocupaciones o using v where o.fijo_id = v.id;
  get diagnostics v_m = row_count;
  return v_n + v_m;
end $$;
revoke execute on function public.liberar_vencidas() from public, anon, authenticated;

-- Al registrar el primer mes de un fijo que se liberó: vuelve, si sigue libre
create or replace function public.aplicar_pago_fijo(p_fijo_id bigint, p_monto integer, p_medio text,
  p_mp_payment_id text default null, p_cobrado_por uuid default null) returns text
language plpgsql security definer set search_path = public as $$
declare
  f public.fijos;
begin
  select * into f from public.fijos where id = p_fijo_id for update;
  if f.estado = 'vencido' then
    begin
      perform public.reactivar_fijo_no_pago(f.id, null);
    exception when others then
      if p_mp_payment_id is null then raise; end if;
    end;
    select * into f from public.fijos where id = p_fijo_id;
  end if;
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
  update public.fijos set expira_en = null where id = f.id and estado = 'solicitud';   -- con un pago ya no se libera
  if f.estado = 'solicitud' and public.monto_pagado_fijo(f.id, f.periodo_inicial) >= f.pago_inicial then
    update public.fijos set estado = 'activo', expira_en = null, aprobado_en = now(), aprobado_por = p_cobrado_por where id = f.id;
    perform public.ocupar_fijo(f.id, false);
    return 'CONFIRMADA';
  end if;
  return case when f.estado = 'activo' then 'CONFIRMADA' else 'PAGO_PARCIAL' end;
end $$;
revoke execute on function public.aplicar_pago_fijo(bigint, integer, text, text, uuid) from public, anon, authenticated, service_role;

-- PANEL: "Volver a apartar" y "Descartar" para un fijo que no pagó
create or replace function public.recuperar_fijo(p_fijo_id bigint, p_minutos integer default 60) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  if not public.reactivar_fijo_no_pago(p_fijo_id, greatest(15, least(coalesce(p_minutos, 60), 60 * 24 * 7))) then
    raise exception 'NO_ENCONTRADO' using hint = 'Ese fijo no está liberado por falta de pago';
  end if;
end $$;
revoke execute on function public.recuperar_fijo(bigint, integer) from public, anon;
grant execute on function public.recuperar_fijo(bigint, integer) to authenticated;

create or replace function public.descartar_no_pago_fijo(p_fijo_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  update public.fijos set no_pago_visto = true where id = p_fijo_id and estado = 'vencido' and origen = 'web';
  if not found then raise exception 'NO_ENCONTRADO'; end if;
end $$;
revoke execute on function public.descartar_no_pago_fijo(bigint) from public, anon;
grant execute on function public.descartar_no_pago_fijo(bigint) to authenticated;

-- ---------------------------------------------------------------------
-- 3) WEB: "Ya transferí" (una vez por pedido)
-- ---------------------------------------------------------------------
create or replace function public.avisar_transferencia(p_pedido_id bigint, p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_min integer := coalesce(public.cfg('minutos_aviso_transferencia'), 60);
  v_hasta timestamptz := now() + make_interval(mins => coalesce(public.cfg('minutos_aviso_transferencia'), 60));
  pe public.pedidos;
  f public.fijos;
  r record;
  v_no_vigente constant text := 'El horario ya se liberó y lo tomó otra persona. Escribinos por WhatsApp y lo resolvemos.';
begin
  select * into pe from public.pedidos where id = p_pedido_id and token = p_token for update;
  if not found then raise exception 'NO_ENCONTRADO' using hint = 'No encontramos ese pedido'; end if;

  -- ya avisó: no se vuelve a extender (así nadie traba un horario tocando el botón muchas veces)
  if pe.aviso_transferencia_en is not null then
    return json_build_object('ya_avisado', true,
      'hasta', coalesce((select max(expira_en) from public.reservas where pedido_id = pe.id and estado = 'pendiente'),
                        (select expira_en from public.fijos where pedido_id = pe.id and estado = 'solicitud')));
  end if;

  select * into f from public.fijos where pedido_id = pe.id for update;
  if found then
    if f.estado = 'activo' then raise exception 'YA_CONFIRMADA' using hint = 'Tu horario fijo ya está confirmado.'; end if;
    if f.estado = 'vencido' then
      begin
        perform public.reactivar_fijo_no_pago(f.id, v_min);
      exception when others then
        raise exception 'RESERVA_NO_VIGENTE' using hint = v_no_vigente;
      end;
    elsif f.estado <> 'solicitud' then
      raise exception 'RESERVA_NO_VIGENTE' using hint = 'Esta reserva ya no está vigente. Escribinos por WhatsApp.';
    end if;
    update public.fijos set expira_en = greatest(expira_en, v_hasta) where id = f.id and expira_en is not null;
  else
    -- si ya se había liberado (avisó un poco tarde) y sigue libre, vuelve
    for r in select id from public.reservas
             where pedido_id = pe.id and estado = 'vencida' and motivo_cancelacion = public.motivo_no_pago() loop
      begin
        perform public.reactivar_no_pago(r.id, v_min);
      exception when others then null;   -- ese día ya lo tomó otra persona
      end;
    end loop;
    if not exists (select 1 from public.reservas where pedido_id = pe.id and estado = 'pendiente') then
      if exists (select 1 from public.reservas where pedido_id = pe.id and estado = 'confirmada') then
        raise exception 'YA_CONFIRMADA' using hint = 'Tu reserva ya está confirmada.';
      end if;
      raise exception 'RESERVA_NO_VIGENTE' using hint = v_no_vigente;
    end if;
    update public.reservas set expira_en = greatest(expira_en, v_hasta)
    where pedido_id = pe.id and estado = 'pendiente' and expira_en is not null;
  end if;

  update public.pedidos set aviso_transferencia_en = now() where id = pe.id;
  return json_build_object('ya_avisado', false, 'hasta', v_hasta);
end $$;
revoke execute on function public.avisar_transferencia(bigint, uuid) from public;
grant execute on function public.avisar_transferencia(bigint, uuid) to anon, authenticated;

-- ---------------------------------------------------------------------
-- 4) Baja de un fijo con fecha futura: sigue activo hasta esa fecha
-- ---------------------------------------------------------------------
create or replace function public.dar_baja_fijo(p_fijo_id bigint, p_desde date default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_desde date := coalesce(p_desde, public.hoy_ar());
begin
  perform public.exigir_equipo();
  update public.fijos
  set estado = case when v_desde > public.hoy_ar() then 'activo' else 'baja' end,
      hasta = v_desde - 1, baja_en = now()
  where id = p_fijo_id and estado = 'activo';
  if not found then raise exception 'NO_ENCONTRADO'; end if;
  delete from public.ocupaciones where fijo_id = p_fijo_id and fecha >= v_desde;
end $$;

-- La tarea de cada mañana pasa a "baja" los fijos cuya última semana ya pasó
create or replace function public.extender_fijos() returns integer
language plpgsql security definer set search_path = public as $$
declare
  f record;
  v_saltadas integer := 0;
  v_s integer;
begin
  update public.fijos set estado = 'baja'
  where estado = 'activo' and hasta is not null and hasta < public.hoy_ar();
  for f in select id from public.fijos where estado in ('activo', 'solicitud') loop
    v_s := public.ocupar_fijo(f.id, false);
    if v_s > 0 then
      insert into public.historial (tabla, registro_id, accion, datos)
      values ('fijos', f.id::text, 'CONFLICTO', json_build_object('horas_superpuestas', v_s)::jsonb);
      v_saltadas := v_saltadas + v_s;
    end if;
  end loop;
  return v_saltadas;
end $$;

-- ---------------------------------------------------------------------
-- 5) Registrar pagos: controles para los fijos
-- ---------------------------------------------------------------------
create or replace function public.registrar_pago(p_monto integer, p_medio text, p_reserva_id bigint default null,
  p_fijo_id bigint default null, p_periodo text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
  r public.reservas;
  f public.fijos;
  v_cuenta jsonb;
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
    if p_periodo is null or p_periodo !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then
      raise exception 'FALTA_PERIODO' using hint = 'Indicá a qué mes corresponde el pago del fijo (AAAA-MM)';
    end if;
    select * into f from public.fijos where id = p_fijo_id for update;
    if not found then raise exception 'NO_ENCONTRADO' using hint = 'No existe ese fijo'; end if;
    if p_periodo > to_char(public.hoy_ar() + interval '6 months', 'YYYY-MM') then
      raise exception 'PERIODO_INVALIDO' using hint = 'Se puede pagar por adelantado hasta 6 meses';
    end if;
    v_cuenta := public.cuenta_fijo_mes(f.id, p_periodo);
    if (v_cuenta->>'semanas')::integer = 0 then
      raise exception 'PERIODO_INVALIDO' using hint = format('En %s este fijo no tiene semanas', p_periodo);
    end if;
    if (v_cuenta->>'pagado')::integer + p_monto > (v_cuenta->>'debe')::integer then
      raise exception 'PAGO_EXCEDE'
        using hint = format('Del mes %s falta pagar $%s y se está cargando $%s', p_periodo, (v_cuenta->>'falta')::integer, p_monto);
    end if;
  else
    raise exception 'NO_ENCONTRADO' using hint = 'Falta la reserva o el fijo';
  end if;

  insert into public.pagos (reserva_id, fijo_id, periodo, monto, medio, cobrado_por)
  values (p_reserva_id, p_fijo_id, p_periodo, p_monto, p_medio, auth.uid())
  returning id into v_id;

  if p_reserva_id is not null then
    update public.reservas set expira_en = null where id = p_reserva_id and estado = 'pendiente';
    if v_pagado + p_monto >= public.sena_minima(r.precio_total) then
      update public.reservas set estado = 'confirmada', expira_en = null
      where id = p_reserva_id and estado = 'pendiente';
    end if;
  end if;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 6) Alertas de pago: "Avisó que transfirió", fijos que no pagaron y la cuenta del mes
-- ---------------------------------------------------------------------
create or replace function public.alertas_pago() returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_hoy date := public.hoy_ar();
  v_dias integer := coalesce(public.cfg('dias_antes_saldo'), 1);
begin
  perform public.exigir_equipo();
  return coalesce((
    select json_agg(a order by
      case a->>'gravedad' when 'transferencia' then 0 when 'no_pago' then 1 when 'vencida' then 2 when 'hoy' then 3 else 4 end,
      a->>'fecha_turno', a->>'nombre')
    from (
      -- a) horas sueltas sin la seña (si avisó que transfirió, va primero para revisar)
      select json_build_object(
        'tipo', 'sena', 'texto', 'Falta la seña',
        'gravedad', case when pe.aviso_transferencia_en is not null then 'transferencia'
                         when r.fecha - v_dias < v_hoy or (r.expira_en is not null and r.expira_en < now()) then 'vencida'
                         when r.fecha - v_dias = v_hoy then 'hoy' else 'pendiente' end,
        'fecha_turno', r.fecha, 'fecha_limite', coalesce((r.expira_en at time zone 'America/Argentina/Buenos_Aires')::date, r.fecha - v_dias),
        'horas', r.horas, 'consultorio', c.nombre,
        'falta', public.sena_minima(r.precio_total) - public.monto_pagado_reserva(r.id),
        'total', r.precio_total - public.monto_pagado_reserva(r.id),
        'reserva_id', r.id, 'pedido_id', r.pedido_id, 'origen', r.origen, 'expira_en', r.expira_en,
        'aviso_transferencia_en', pe.aviso_transferencia_en,
        'nombre', p.nombre, 'whatsapp', p.whatsapp) as a
      from public.reservas r
      join public.profesionales p on p.id = r.profesional_id
      join public.consultorios c on c.id = r.consultorio_id
      left join public.pedidos pe on pe.id = r.pedido_id
      where r.estado = 'pendiente' and r.origen <> 'excel' and r.fecha >= v_hoy - 30

      union all
      -- a2) NO PAGÓ (por horas): se liberó solo
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
      -- a3) NO PAGÓ (fijo pedido por la web): se liberó solo
      select json_build_object(
        'tipo', 'no_pago', 'texto', 'No pagó el primer mes del fijo',
        'gravedad', 'no_pago',
        'fecha_turno', f.desde, 'fecha_limite', (f.expira_en at time zone 'America/Argentina/Buenos_Aires')::date,
        'liberada_en', f.expira_en, 'horas', f.horas, 'consultorio', c.nombre, 'dia_semana', f.dia_semana,
        'falta', f.pago_inicial, 'total', f.pago_inicial,
        'libre', not exists (select 1 from public.fechas_fijo(f.id) d
                             join public.ocupaciones o on o.consultorio_id = f.consultorio_id and o.fecha = d
                                                      and o.hora = any (f.horas) and o.bloqueo_id is null),
        'fijo_id', f.id, 'pedido_id', f.pedido_id,
        'nombre', p.nombre, 'whatsapp', p.whatsapp)
      from public.fijos f
      join public.profesionales p on p.id = f.profesional_id
      join public.consultorios c on c.id = f.consultorio_id
      where f.estado = 'vencido' and f.origen = 'web' and not f.no_pago_visto
        and f.expira_en > now() - interval '7 days'

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
        'gravedad', case when pe.aviso_transferencia_en is not null then 'transferencia'
                         when f.desde - 1 < v_hoy or (f.expira_en is not null and f.expira_en < now()) then 'vencida'
                         when f.desde - 1 = v_hoy then 'hoy' else 'pendiente' end,
        'fecha_turno', f.desde, 'fecha_limite', f.desde - 1, 'horas', f.horas, 'consultorio', c.nombre, 'dia_semana', f.dia_semana,
        'falta', coalesce(f.pago_inicial, f.precio_semanal * greatest(1, cardinality(public.fechas_primer_mes(f.id))))
                 - public.monto_pagado_fijo(f.id, coalesce(f.periodo_inicial, to_char(f.desde, 'YYYY-MM'))),
        'total', coalesce(f.pago_inicial, f.precio_semanal * greatest(1, cardinality(public.fechas_primer_mes(f.id)))),
        'fijo_id', f.id, 'pedido_id', f.pedido_id, 'expira_en', f.expira_en,
        'aviso_transferencia_en', pe.aviso_transferencia_en,
        'nombre', p.nombre, 'whatsapp', p.whatsapp)
      from public.fijos f
      join public.profesionales p on p.id = f.profesional_id
      join public.consultorios c on c.id = f.consultorio_id
      left join public.pedidos pe on pe.id = f.pedido_id
      where f.estado = 'solicitud'

      union all
      -- d) fijos activos: el mes (este y el que viene) se paga hasta el día anterior a su primera semana
      select json_build_object(
        'tipo', 'fijo_mes', 'texto', 'Falta pagar el mes ' || m.periodo,
        'gravedad', case when m.primera - 1 < v_hoy then 'vencida' else 'hoy' end,
        'fecha_turno', m.primera, 'fecha_limite', m.primera - 1, 'horas', m.horas, 'consultorio', m.consultorio, 'dia_semana', m.dia_semana,
        'falta', (m.cuenta->>'falta')::integer, 'total', (m.cuenta->>'debe')::integer, 'periodo', m.periodo, 'fijo_id', m.id,
        'nombre', m.nombre, 'whatsapp', m.whatsapp)
      from (
        select f.id, f.horas, f.dia_semana, c.nombre as consultorio, p.nombre, p.whatsapp, per.periodo,
               public.cuenta_fijo_mes(f.id, per.periodo) as cuenta,
               (select min(d::date) from generate_series(greatest(mes.ini, f.desde)::timestamp,
                                                        least((mes.ini + interval '1 month - 1 day')::date, coalesce(f.hasta, '9999-12-31'::date))::timestamp,
                                                        interval '1 day') d
                where extract(isodow from d)::int = f.dia_semana
                  and not exists (select 1 from public.fijo_excepciones e where e.fijo_id = f.id and e.fecha = d::date)) as primera
        from public.fijos f
        join public.profesionales p on p.id = f.profesional_id
        join public.consultorios c on c.id = f.consultorio_id
        cross join lateral (values (date_trunc('month', v_hoy)::date), ((date_trunc('month', v_hoy) + interval '1 month')::date)) mes(ini)
        cross join lateral (select to_char(mes.ini, 'YYYY-MM') as periodo) per
        where f.estado = 'activo'
      ) m
      where m.primera is not null and (m.cuenta->>'falta')::integer > 0 and m.primera - 1 <= v_hoy
    ) t), '[]'::json);
end $$;
revoke execute on function public.alertas_pago() from public, anon;
grant execute on function public.alertas_pago() to authenticated;

select 'Listo: botón "Ya transferí", fijos sin pagar que se liberan solos y cuentas de fijos corregidas' as resultado;

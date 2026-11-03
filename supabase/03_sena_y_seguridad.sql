-- =====================================================================
-- PSICOSTUDIOS · 03_sena_y_seguridad.sql
-- Ajustes sobre 01_base.sql:
--   1. Seña obligatoria: una reserva queda CONFIRMADA recién cuando se
--      registra al menos el 50% del total (configurable).
--   2. Límites anti-abuso para la web pública.
--   3. Permisos más estrictos (nadie de afuera puede tocar tablas).
--   4. Alta del usuario del equipo para entrar al panel.
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- ANTES: crear el usuario en Authentication (ver README, paso 3).
-- Se puede correr más de una vez sin romper nada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. NUEVOS VALORES DE CONFIGURACIÓN
-- ---------------------------------------------------------------------
insert into public.config (clave, valor, descripcion) values
  ('porcentaje_sena',             '50', 'Porcentaje del total que hay que pagar para confirmar una reserva'),
  ('max_pendientes_por_whatsapp', '2',  'Reservas/solicitudes sin pagar que puede tener abiertas un mismo WhatsApp desde la web'),
  ('max_horas_por_reserva',       '6',  'Máximo de horas que se pueden pedir en una sola reserva web'),
  ('alias_transferencia',         'COMPLETAR', 'Alias o CBU para que transfieran la seña (se muestra en la web)'),
  ('titular_transferencia',       'COMPLETAR', 'Titular de la cuenta (se muestra en la web)'),
  ('whatsapp_contacto',           'COMPLETAR', 'WhatsApp del equipo, solo números con código de país. Ej: 5491112345678')
on conflict (clave) do nothing;

create or replace function public.cfg_texto(p_clave text) returns text
language sql stable set search_path = public as $$
  select valor from public.config where clave = p_clave
$$;

-- ---------------------------------------------------------------------
-- 2. FUNCIONES DE APOYO PARA LA SEÑA
-- ---------------------------------------------------------------------

-- Cuánto hay pagado (sin contar pagos anulados) de una reserva
create or replace function public.monto_pagado_reserva(p_reserva_id bigint) returns integer
language sql stable security definer set search_path = public as $$
  select coalesce(sum(monto), 0)::integer from public.pagos
  where reserva_id = p_reserva_id and not anulado
$$;

-- Seña mínima para un total dado (redondea para arriba)
create or replace function public.sena_minima(p_total integer) returns integer
language sql stable set search_path = public as $$
  select ceil(p_total * public.cfg('porcentaje_sena') / 100.0)::integer
$$;

-- Frena si un mismo WhatsApp ya tiene demasiadas cosas sin pagar desde la web
create or replace function public.controlar_pendientes(p_whatsapp text) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_tel text := public.solo_numeros(p_whatsapp);
  v_n integer;
begin
  select
    (select count(*) from public.reservas r join public.profesionales p on p.id = r.profesional_id
      where p.whatsapp = v_tel and r.estado = 'pendiente' and r.origen = 'web')
  + (select count(*) from public.fijos f join public.profesionales p on p.id = f.profesional_id
      where p.whatsapp = v_tel and f.estado = 'solicitud' and f.origen = 'web')
  into v_n;
  if v_n >= public.cfg('max_pendientes_por_whatsapp') then
    raise exception 'DEMASIADAS_PENDIENTES'
      using hint = 'Ya tenés reservas esperando el pago de la seña. Pagalas o escribinos por WhatsApp.';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 3. WEB PÚBLICA: RESERVA CON SEÑA
-- ---------------------------------------------------------------------
create or replace function public.crear_reserva(
  p_nombre text, p_whatsapp text, p_profesion text,
  p_fecha date, p_horas smallint[], p_consultorio smallint default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_prof bigint;
  v_cons smallint;
  v_total integer;
  v_id bigint;
  v_expira timestamptz;
begin
  perform public.validar_horas(p_fecha, p_horas);
  if cardinality(p_horas) > public.cfg('max_horas_por_reserva') then
    raise exception 'DEMASIADAS_HORAS'
      using hint = format('Se pueden reservar hasta %s horas por vez. Para más, escribinos.', public.cfg('max_horas_por_reserva'));
  end if;
  if p_fecha > public.hoy_ar() + public.cfg('dias_reserva_maximo') then
    raise exception 'FECHA_LEJANA' using hint = 'Todavía no se puede reservar tan adelante';
  end if;
  perform public.controlar_pendientes(p_whatsapp);

  if p_consultorio is not null then
    if not exists (select 1 from public.consultorios where id = p_consultorio and activo and online) then
      raise exception 'CONSULTORIO_INVALIDO' using hint = 'Ese consultorio no está disponible';
    end if;
    v_cons := p_consultorio;
  else
    select c.id into v_cons from public.consultorios c
    where c.activo and c.online and c.nombre <> 'Salón' and public.libre(c.id, p_fecha, p_horas)
    order by c.orden limit 1;
  end if;
  if v_cons is null or not public.libre(v_cons, p_fecha, p_horas) then
    raise exception 'SIN_LUGAR' using hint = 'Ese horario se acaba de ocupar. Elegí otro.';
  end if;

  v_prof := public.obtener_profesional(p_nombre, p_whatsapp, p_profesion, null, 'Web');
  select sum(public.precio_hora('suelta', h, p_fecha)) into v_total from unnest(p_horas) h;
  v_expira := now() + make_interval(mins => public.cfg('retencion_suelta_minutos'));

  insert into public.reservas (profesional_id, consultorio_id, fecha, horas, precio_total, estado, expira_en, origen)
  values (v_prof, v_cons, p_fecha, (select array_agg(x order by x) from unnest(p_horas) x),
          v_total, 'pendiente', v_expira, 'web')
  returning id into v_id;

  begin
    insert into public.ocupaciones (consultorio_id, fecha, hora, reserva_id)
    select v_cons, p_fecha, h, v_id from unnest(p_horas) h;
  exception when unique_violation then
    raise exception 'SIN_LUGAR' using hint = 'Ese horario se acaba de ocupar. Elegí otro.';
  end;

  return json_build_object(
    'id', v_id,
    'consultorio', (select nombre from public.consultorios where id = v_cons),
    'total', v_total,
    'sena', public.sena_minima(v_total),
    'expira_en', v_expira);
end $$;

-- Solicitud de fijo: se agregan los mismos controles
create or replace function public.crear_solicitud_fijo(
  p_nombre text, p_whatsapp text, p_profesion text,
  p_dia smallint, p_horas smallint[], p_desde date, p_consultorio smallint default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_prof bigint;
  v_cons smallint;
  v_id bigint;
  v_semanal integer;
  v_ordenadas smallint[];
  i integer;
  v_largo integer := 1;
begin
  if extract(isodow from p_desde) <> p_dia then
    raise exception 'FECHA_NO_COINCIDE' using hint = 'La fecha de inicio no cae ese día de la semana';
  end if;
  perform public.validar_horas(p_desde, p_horas);
  if cardinality(p_horas) > public.cfg('max_horas_por_reserva') then
    raise exception 'DEMASIADAS_HORAS'
      using hint = format('Se pueden pedir hasta %s horas por día. Para más, escribinos.', public.cfg('max_horas_por_reserva'));
  end if;
  if p_desde > public.hoy_ar() + public.cfg('dias_reserva_maximo') then
    raise exception 'FECHA_LEJANA' using hint = 'Elegí una fecha de inicio más cercana';
  end if;
  perform public.controlar_pendientes(p_whatsapp);

  -- mínimo 2 horas seguidas por bloque
  select array_agg(x order by x) into v_ordenadas from unnest(p_horas) x;
  for i in 2 .. cardinality(v_ordenadas) + 1 loop
    if i <= cardinality(v_ordenadas) and v_ordenadas[i] = v_ordenadas[i - 1] + 1 then
      v_largo := v_largo + 1;
    else
      if v_largo < 2 then
        raise exception 'BLOQUE_CORTO' using hint = 'El horario fijo es de 2 horas seguidas como mínimo';
      end if;
      v_largo := 1;
    end if;
  end loop;

  if p_consultorio is not null then
    if not exists (select 1 from public.consultorios where id = p_consultorio and activo and online) then
      raise exception 'CONSULTORIO_INVALIDO' using hint = 'Ese consultorio no está disponible';
    end if;
    v_cons := p_consultorio;
  else
    select c.id into v_cons from public.consultorios c
    where c.activo and c.online and c.nombre <> 'Salón'
      and (select count(distinct d.hora) from public.disponibilidad_fijo(p_dia, p_desde) d
           where d.consultorio_id = c.id and d.hora = any (p_horas)) = cardinality(p_horas)
    order by c.orden limit 1;
  end if;
  if v_cons is null then
    raise exception 'SIN_LUGAR' using hint = 'No hay un consultorio libre en ese horario todas las semanas';
  end if;

  v_prof := public.obtener_profesional(p_nombre, p_whatsapp, p_profesion, null, 'Web');
  select sum(public.precio_hora('fijo', h, p_desde)) into v_semanal from unnest(p_horas) h;

  insert into public.fijos (profesional_id, consultorio_id, dia_semana, horas, precio_semanal,
                            estado, desde, expira_en, origen)
  values (v_prof, v_cons, p_dia, v_ordenadas, v_semanal, 'solicitud', p_desde,
          now() + make_interval(hours => public.cfg('retencion_fijo_horas')), 'web')
  returning id into v_id;

  perform public.ocupar_fijo(v_id, true);

  return json_build_object(
    'id', v_id,
    'consultorio', (select nombre from public.consultorios where id = v_cons),
    'precio_semanal', v_semanal,
    'precio_mensual_aprox', round(v_semanal * 4.33 / 100) * 100);
end $$;

-- ---------------------------------------------------------------------
-- 4. PANEL: PAGOS, SEÑAS Y RESERVAS
-- ---------------------------------------------------------------------

-- Registrar un cobro. Una reserva se confirma cuando lo pagado llega a la seña.
create or replace function public.registrar_pago(
  p_monto integer, p_medio text,
  p_reserva_id bigint default null, p_fijo_id bigint default null, p_periodo text default null
) returns bigint
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

  if p_reserva_id is not null and v_pagado + p_monto >= public.sena_minima(r.precio_total) then
    update public.reservas set estado = 'confirmada', expira_en = null
    where id = p_reserva_id and estado = 'pendiente';
  end if;
  return v_id;
end $$;

-- Anular un pago cargado por error
create or replace function public.anular_pago(p_pago_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.pagos;
  r public.reservas;
begin
  perform public.exigir_equipo();
  update public.pagos set anulado = true where id = p_pago_id and not anulado returning * into p;
  if not found then raise exception 'NO_ENCONTRADO' using hint = 'Ese pago no existe o ya estaba anulado'; end if;
  if p.reserva_id is not null then
    select * into r from public.reservas where id = p.reserva_id;
    -- si ya no cubre la seña, vuelve a pendiente (sin vencimiento: decide el equipo)
    if r.estado = 'confirmada' and public.monto_pagado_reserva(r.id) < public.sena_minima(r.precio_total) then
      update public.reservas set estado = 'pendiente', expira_en = null where id = r.id;
    end if;
  end if;
end $$;

-- Dar más tiempo a una reserva sin seña (ej: avisó que transfiere más tarde)
create or replace function public.extender_reserva(p_reserva_id bigint, p_minutos integer default 60) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  update public.reservas
  set expira_en = greatest(coalesce(expira_en, now()), now()) + make_interval(mins => p_minutos)
  where id = p_reserva_id and estado = 'pendiente';
  if not found then raise exception 'NO_ENCONTRADO' using hint = 'La reserva ya no está pendiente'; end if;
end $$;

-- Cargar una reserva desde el panel. Si se carga con seña suficiente, queda confirmada.
-- Si se carga sin pago, queda pendiente SIN vencimiento (el equipo la sigue a mano).
drop function if exists public.cargar_reserva(text, text, smallint, date, smallint[], boolean, text);
create or replace function public.cargar_reserva(
  p_nombre text, p_whatsapp text, p_consultorio smallint, p_fecha date, p_horas smallint[],
  p_monto_pagado integer default 0, p_medio text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_prof bigint;
  v_total integer;
  v_id bigint;
begin
  perform public.exigir_equipo();
  perform public.validar_horas(p_fecha, p_horas, true);
  if not exists (select 1 from public.consultorios where id = p_consultorio and activo) then
    raise exception 'CONSULTORIO_INVALIDO' using hint = 'Ese consultorio no está activo';
  end if;
  v_prof := public.obtener_profesional(p_nombre, p_whatsapp, null, null, 'Carga manual');
  select sum(public.precio_hora('suelta', h, p_fecha)) into v_total from unnest(p_horas) h;
  if coalesce(p_monto_pagado, 0) > v_total then
    raise exception 'PAGO_EXCEDE' using hint = format('El total es $%s', v_total);
  end if;

  insert into public.reservas (profesional_id, consultorio_id, fecha, horas, precio_total, estado, origen, creado_por)
  values (v_prof, p_consultorio, p_fecha, (select array_agg(x order by x) from unnest(p_horas) x), v_total,
          case when coalesce(p_monto_pagado, 0) >= public.sena_minima(v_total) then 'confirmada' else 'pendiente' end,
          'panel', auth.uid())
  returning id into v_id;

  begin
    insert into public.ocupaciones (consultorio_id, fecha, hora, reserva_id)
    select p_consultorio, p_fecha, h, v_id from unnest(p_horas) h;
  exception when unique_violation then
    raise exception 'SIN_LUGAR' using hint = 'Alguna de esas horas ya está ocupada';
  end;

  if coalesce(p_monto_pagado, 0) > 0 then
    insert into public.pagos (reserva_id, monto, medio, cobrado_por)
    values (v_id, p_monto_pagado, coalesce(p_medio, 'efectivo'), auth.uid());
  end if;
  return v_id;
end $$;

-- Agenda: ahora también devuelve total, pagado y vencimiento
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
    null::text,
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

-- ---------------------------------------------------------------------
-- 5. PERMISOS MÁS ESTRICTOS
-- ---------------------------------------------------------------------

-- Funciones sin search_path fijo (lo pide el control de seguridad de Supabase)
alter function public.cfg(text)                               set search_path = public;
alter function public.ahora_ar()                              set search_path = public;
alter function public.hoy_ar()                                set search_path = public;
alter function public.precio_hora(text, integer, date)        set search_path = public;
alter function public.solo_numeros(text)                      set search_path = public;
alter function public.validar_horas(date, smallint[], boolean) set search_path = public;

-- Tablas: por defecto Supabase deja que anon/authenticated intenten de todo
-- (lo frena RLS). Acá se quita todo y se da solo lo necesario.
revoke all on all tables in schema public from anon, authenticated;
grant select on public.config, public.consultorios, public.precios to anon;
grant select on all tables in schema public to authenticated;           -- RLS: solo el equipo ve filas
grant update on public.profesionales, public.consultorios, public.config to authenticated;
grant insert on public.precios to authenticated;

-- Lo que se cree en el futuro arranca cerrado
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- Funciones: se cierra todo y se vuelve a abrir lo justo
revoke execute on all functions in schema public from public, anon, authenticated;

-- Web pública (sin login)
grant execute on function public.disponibilidad(date, date)                                         to anon, authenticated;
grant execute on function public.disponibilidad_fijo(smallint, date)                                to anon, authenticated;
grant execute on function public.crear_reserva(text, text, text, date, smallint[], smallint)        to anon, authenticated;
grant execute on function public.crear_solicitud_fijo(text, text, text, smallint, smallint[], date, smallint) to anon, authenticated;
grant execute on function public.cfg(text)                                                          to anon, authenticated;
grant execute on function public.cfg_texto(text)                                                    to anon, authenticated;
grant execute on function public.precio_hora(text, integer, date)                                   to anon, authenticated;
grant execute on function public.sena_minima(integer)                                               to anon, authenticated;
grant execute on function public.hoy_ar()                                                           to anon, authenticated;
grant execute on function public.ahora_ar()                                                         to anon, authenticated;
grant execute on function public.es_equipo()                                                        to anon, authenticated;

-- Panel (cada función además revisa que el usuario sea del equipo)
grant execute on function public.agenda(date, date)                                                 to authenticated;
grant execute on function public.cargar_reserva(text, text, smallint, date, smallint[], integer, text) to authenticated;
grant execute on function public.cargar_fijo(text, text, smallint, smallint, smallint[], date)      to authenticated;
grant execute on function public.aprobar_fijo(bigint)                                               to authenticated;
grant execute on function public.rechazar_fijo(bigint)                                              to authenticated;
grant execute on function public.dar_baja_fijo(bigint, date)                                        to authenticated;
grant execute on function public.liberar_fijo_fecha(bigint, date, text)                             to authenticated;
grant execute on function public.volver_a_bloquear_fijo(bigint, date)                              to authenticated;
grant execute on function public.cancelar_reserva(bigint, text)                                     to authenticated;
grant execute on function public.registrar_pago(integer, text, bigint, bigint, text)                to authenticated;
grant execute on function public.anular_pago(bigint)                                                to authenticated;
grant execute on function public.extender_reserva(bigint, integer)                                  to authenticated;
grant execute on function public.monto_pagado_reserva(bigint)                                       to authenticated;
grant execute on function public.crear_bloqueo(date, smallint, smallint, text, smallint)            to authenticated;
grant execute on function public.borrar_bloqueo(bigint)                                             to authenticated;

-- ---------------------------------------------------------------------
-- 6. ALTA DEL USUARIO DEL EQUIPO
-- El usuario se crea antes en Authentication → Users (README, paso 3)
-- con el email psicomel@psicostudios.local. Acá se lo habilita como admin.
-- ---------------------------------------------------------------------
insert into public.equipo (user_id, nombre, rol)
select id, 'Psicomel', 'admin' from auth.users where email = 'psicomel@psicostudios.local'
on conflict (user_id) do nothing;

select case
  when exists (select 1 from public.equipo e join auth.users u on u.id = e.user_id
               where u.email = 'psicomel@psicostudios.local')
  then 'Listo: ajustes aplicados y usuario psicomel habilitado para el panel'
  else 'Ajustes aplicados, PERO falta el usuario: crealo en Authentication y volvé a correr este archivo'
end as resultado;

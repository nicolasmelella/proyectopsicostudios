-- =====================================================================
-- PSICOSTUDIOS · 05_calendario.sql
--   1. La agenda se abre por MESES de calendario (por defecto 2):
--      hoy 7/11 → se puede reservar hasta el 7/1 inclusive.
--   2. Resumen de lugares libres por día, para pintar el calendario de la web
--      (verde / amarillo / completo). No muestra nombres de nadie.
--   3. Datos obligatorios al reservar desde la web: nombre, profesión,
--      celular (WhatsApp) y mail. Los valida la base, no solo la página.
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Requiere 01 a 04. Se puede correr más de una vez.
-- =====================================================================

insert into public.config (clave, valor, descripcion) values
  ('meses_reserva_maximo', '2', 'Meses hacia adelante que se puede reservar online (hoy 7/11 y 2 meses → hasta el 7/1)')
on conflict (clave) do nothing;

-- Datos obligatorios de quien reserva desde la web
create or replace function public.validar_contacto(p_profesion text, p_email text) returns void
language plpgsql immutable set search_path = public as $$
begin
  if length(trim(coalesce(p_profesion, ''))) < 2 then
    raise exception 'FALTA_PROFESION' using hint = 'Contanos tu profesión';
  end if;
  if p_email is null or length(p_email) > 120 or trim(p_email) !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'EMAIL_INVALIDO' using hint = 'Revisá el mail: tiene que ser del tipo nombre@ejemplo.com';
  end if;
end $$;

-- Horario fijo: mínimo de horas seguidas según la franja.
-- Mañana (antes de 'hora_fin_manana'): desde 1 hora. Tarde: mínimo 2 horas seguidas.
-- Un bloque que llega a la tarde (ej: 12 a 14) cuenta como de tarde.
insert into public.config (clave, valor, descripcion) values
  ('min_horas_fijo_manana', '1', 'Horario fijo: mínimo de horas seguidas por la mañana'),
  ('min_horas_fijo_tarde',  '2', 'Horario fijo: mínimo de horas seguidas por la tarde')
on conflict (clave) do nothing;

create or replace function public.validar_bloques_fijo(p_horas smallint[]) returns void
language plpgsql stable set search_path = public as $$
declare
  v smallint[];
  i integer;
  v_inicio integer := 1;
  v_minimo integer;
begin
  select array_agg(x order by x) into v from unnest(p_horas) x;
  for i in 2 .. cardinality(v) + 1 loop
    continue when i <= cardinality(v) and v[i] = v[i - 1] + 1;
    -- termina un bloque de horas seguidas: v[v_inicio] .. v[i - 1]
    v_minimo := case when v[i - 1] >= public.cfg('hora_fin_manana')
                     then public.cfg('min_horas_fijo_tarde') else public.cfg('min_horas_fijo_manana') end;
    if i - v_inicio < v_minimo then
      raise exception 'BLOQUE_CORTO'
        using hint = format('Por la tarde (desde las %s hs) el horario fijo es de %s horas seguidas como mínimo',
                            public.cfg('hora_fin_manana'), public.cfg('min_horas_fijo_tarde'));
    end if;
    v_inicio := i;
  end loop;
end $$;

-- Último día que se puede reservar online
create or replace function public.fecha_maxima_reserva() returns date
language sql stable set search_path = public as $$
  select (public.hoy_ar() + make_interval(months => public.cfg('meses_reserva_maximo')))::date
$$;

-- Horas libres por día y consultorio (igual que en 01, con el nuevo límite)
create or replace function public.disponibilidad(p_desde date, p_hasta date)
returns table (fecha date, hora smallint, consultorio_id smallint)
language sql stable security definer set search_path = public as $$
  select d::date, h::smallint, c.id
  from generate_series(greatest(p_desde, public.hoy_ar())::timestamp,
                       least(p_hasta, public.fecha_maxima_reserva())::timestamp,
                       interval '1 day') d
  cross join generate_series(public.cfg('hora_apertura'), public.cfg('hora_cierre') - 1) h
  cross join public.consultorios c
  where c.activo and c.online
    and extract(isodow from d) <> 7
    and not (d::date = public.hoy_ar() and h <= extract(hour from public.ahora_ar()))
    and not exists (select 1 from public.ocupaciones o
                    where o.consultorio_id = c.id and o.fecha = d::date and o.hora = h)
  order by 1, 2, 3
$$;

-- Resumen por día: cuántos turnos (consultorio + hora) quedan libres de cuántos posibles
create or replace function public.resumen_disponibilidad(p_desde date, p_hasta date)
returns table (fecha date, libres integer, total integer)
language sql stable security definer set search_path = public as $$
  with dias as (
    select g::date as f
    from generate_series(greatest(p_desde, public.hoy_ar())::timestamp,
                         least(p_hasta, public.fecha_maxima_reserva())::timestamp, interval '1 day') g
    where extract(isodow from g) <> 7
  ), libres as (
    select d.fecha, count(*)::integer as n from public.disponibilidad(p_desde, p_hasta) d group by d.fecha
  )
  select dias.f,
         coalesce(libres.n, 0),
         (greatest(0, public.cfg('hora_cierre') - case when dias.f = public.hoy_ar()
                     then greatest(public.cfg('hora_apertura'), extract(hour from public.ahora_ar())::integer + 1)
                     else public.cfg('hora_apertura') end)
          * (select count(*) from public.consultorios where activo and online))::integer
  from dias left join libres on libres.fecha = dias.f
  order by 1
$$;

-- Reserva web: igual que en 04, con el nuevo límite de fecha y el mail obligatorio
drop function if exists public.crear_reserva(text, text, text, date, smallint[], smallint);
create or replace function public.crear_reserva(
  p_nombre text, p_whatsapp text, p_profesion text, p_email text,
  p_fecha date, p_horas smallint[], p_consultorio smallint default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_prof bigint;
  v_cons smallint;
  v_total integer;
  v_id bigint;
  v_expira timestamptz;
  v_token uuid;
begin
  perform public.validar_contacto(p_profesion, p_email);
  perform public.validar_horas(p_fecha, p_horas);
  if cardinality(p_horas) > public.cfg('max_horas_por_reserva') then
    raise exception 'DEMASIADAS_HORAS'
      using hint = format('Se pueden reservar hasta %s horas por vez. Para más, escribinos.', public.cfg('max_horas_por_reserva'));
  end if;
  if p_fecha > public.fecha_maxima_reserva() then
    raise exception 'FECHA_LEJANA'
      using hint = format('Se puede reservar hasta el %s', to_char(public.fecha_maxima_reserva(), 'DD/MM'));
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

  v_prof := public.obtener_profesional(p_nombre, p_whatsapp, p_profesion, lower(trim(p_email)), 'Web');
  select sum(public.precio_hora('suelta', h, p_fecha)) into v_total from unnest(p_horas) h;
  v_expira := now() + make_interval(mins => public.cfg('retencion_suelta_minutos'));

  insert into public.reservas (profesional_id, consultorio_id, fecha, horas, precio_total, estado, expira_en, origen)
  values (v_prof, v_cons, p_fecha, (select array_agg(x order by x) from unnest(p_horas) x),
          v_total, 'pendiente', v_expira, 'web')
  returning id, token_pago into v_id, v_token;

  begin
    insert into public.ocupaciones (consultorio_id, fecha, hora, reserva_id)
    select v_cons, p_fecha, h, v_id from unnest(p_horas) h;
  exception when unique_violation then
    raise exception 'SIN_LUGAR' using hint = 'Ese horario se acaba de ocupar. Elegí otro.';
  end;

  return json_build_object(
    'id', v_id,
    'token', v_token,
    'consultorio', (select nombre from public.consultorios where id = v_cons),
    'total', v_total,
    'sena', public.sena_minima(v_total),
    'expira_en', v_expira);
end $$;

-- Solicitud de fijo: igual que en 03, con el nuevo límite de fecha y el mail obligatorio
drop function if exists public.crear_solicitud_fijo(text, text, text, smallint, smallint[], date, smallint);
create or replace function public.crear_solicitud_fijo(
  p_nombre text, p_whatsapp text, p_profesion text, p_email text,
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

begin
  perform public.validar_contacto(p_profesion, p_email);
  if extract(isodow from p_desde) <> p_dia then
    raise exception 'FECHA_NO_COINCIDE' using hint = 'La fecha de inicio no cae ese día de la semana';
  end if;
  perform public.validar_horas(p_desde, p_horas);
  if cardinality(p_horas) > public.cfg('max_horas_por_reserva') then
    raise exception 'DEMASIADAS_HORAS'
      using hint = format('Se pueden pedir hasta %s horas por día. Para más, escribinos.', public.cfg('max_horas_por_reserva'));
  end if;
  if p_desde > public.fecha_maxima_reserva() then
    raise exception 'FECHA_LEJANA' using hint = 'Elegí una fecha de inicio más cercana';
  end if;
  perform public.controlar_pendientes(p_whatsapp);

  select array_agg(x order by x) into v_ordenadas from unnest(p_horas) x;
  perform public.validar_bloques_fijo(v_ordenadas);

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

  v_prof := public.obtener_profesional(p_nombre, p_whatsapp, p_profesion, lower(trim(p_email)), 'Web');
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

-- Permisos (las funciones nuevas arrancan cerradas)
revoke execute on function public.fecha_maxima_reserva()                   from public, anon, authenticated;
revoke execute on function public.resumen_disponibilidad(date, date)        from public, anon, authenticated;
grant execute on function public.fecha_maxima_reserva()                    to anon, authenticated;
grant execute on function public.resumen_disponibilidad(date, date)         to anon, authenticated;
revoke execute on function public.validar_contacto(text, text)               from public, anon, authenticated;
revoke execute on function public.validar_bloques_fijo(smallint[])         from public, anon, authenticated;
revoke execute on function public.crear_reserva(text, text, text, text, date, smallint[], smallint)                 from public, anon, authenticated;
revoke execute on function public.crear_solicitud_fijo(text, text, text, text, smallint, smallint[], date, smallint) from public, anon, authenticated;
grant execute on function public.crear_reserva(text, text, text, text, date, smallint[], smallint)                  to anon, authenticated;
grant execute on function public.crear_solicitud_fijo(text, text, text, text, smallint, smallint[], date, smallint)  to anon, authenticated;

select 'Calendario listo: se puede reservar hasta el ' || to_char(public.fecha_maxima_reserva(), 'DD/MM/YYYY') as resultado;

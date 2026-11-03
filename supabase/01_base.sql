-- =====================================================================
-- PSICOSTUDIOS · 01_base.sql
-- Base de datos del sistema de reservas.
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Se corre UNA sola vez. Si da error, no lo corras de nuevo: mandá captura.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. CONFIGURACIÓN GENERAL (se puede cambiar después desde el panel)
-- ---------------------------------------------------------------------
create table public.config (
  clave text primary key,
  valor text not null,
  descripcion text
);

insert into public.config (clave, valor, descripcion) values
  ('hora_apertura',            '8',   'Primera hora reservable'),
  ('hora_cierre',              '21',  'Hora de cierre: el último turno empieza una hora antes'),
  ('retencion_suelta_minutos', '120', 'Minutos que se guarda una reserva suelta sin pagar'),
  ('retencion_fijo_horas',     '48',  'Horas que se guarda una solicitud de fijo sin aprobar'),
  ('semanas_fijo',             '12',  'Semanas hacia adelante que se bloquean los fijos'),
  ('dias_reserva_maximo',      '60',  'Hasta cuántos días adelante se puede reservar online'),
  ('hora_fin_manana',          '13',  'Desde esta hora rige el precio de tarde');

create or replace function public.cfg(p_clave text) returns integer
language sql stable as $$
  select valor::integer from public.config where clave = p_clave
$$;

-- ---------------------------------------------------------------------
-- 2. CONSULTORIOS Y PRECIOS
-- ---------------------------------------------------------------------
create table public.consultorios (
  id smallint primary key,
  nombre text not null unique,
  orden smallint not null,
  activo boolean not null default true,
  online boolean not null default true  -- false = no se ofrece en la web
);

insert into public.consultorios (id, nombre, orden) values
  (1, 'Consultorio 1', 1),
  (2, 'Consultorio 2', 2),
  (3, 'Consultorio 3', 3),
  (4, 'Consultorio 4', 4),
  (5, 'Consultorio 5', 5),
  (6, 'Salón',         6);

create table public.precios (
  id bigint generated always as identity primary key,
  modalidad text not null check (modalidad in ('suelta', 'fijo')),
  franja text not null check (franja in ('manana', 'tarde')),
  valor integer not null check (valor > 0),
  vigente_desde date not null default current_date,
  unique (modalidad, franja, vigente_desde)
);

-- Precios actuales. Para aumentar: se agrega una fila nueva con otra fecha.
-- Las reservas viejas guardan el precio que tenían.
insert into public.precios (modalidad, franja, valor, vigente_desde) values
  ('suelta', 'manana', 8500, '2026-01-01'),
  ('suelta', 'tarde',  9000, '2026-01-01'),
  ('fijo',   'manana', 8200, '2026-01-01'),
  ('fijo',   'tarde',  8500, '2026-01-01');

-- ---------------------------------------------------------------------
-- 3. PERSONAS: EQUIPO Y PROFESIONALES
-- ---------------------------------------------------------------------
create table public.equipo (
  user_id uuid primary key references auth.users (id) on delete cascade,
  nombre text not null,
  rol text not null default 'equipo' check (rol in ('admin', 'equipo')),
  creado_en timestamptz not null default now()
);

create table public.profesionales (
  id bigint generated always as identity primary key,
  nombre text not null,
  whatsapp text not null unique,   -- solo números, ej: 1141952323
  email text,
  profesion text,
  origen text,                     -- Meta Ads, Google, Recomendación, Universidad, Web, Otro
  usa_habilitacion boolean not null default false,
  notas text,
  creado_en timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. RESERVAS, FIJOS, BLOQUEOS
-- ---------------------------------------------------------------------
create table public.reservas (
  id bigint generated always as identity primary key,
  profesional_id bigint not null references public.profesionales (id),
  consultorio_id smallint not null references public.consultorios (id),
  fecha date not null,
  horas smallint[] not null,
  precio_total integer not null,
  estado text not null default 'pendiente'
    check (estado in ('pendiente', 'confirmada', 'cancelada', 'vencida')),
  expira_en timestamptz,
  origen text not null default 'web' check (origen in ('web', 'panel')),
  creado_por uuid,
  creado_en timestamptz not null default now(),
  cancelada_en timestamptz,
  cancelada_por uuid,
  motivo_cancelacion text
);

create table public.fijos (
  id bigint generated always as identity primary key,
  profesional_id bigint not null references public.profesionales (id),
  consultorio_id smallint not null references public.consultorios (id),
  dia_semana smallint not null check (dia_semana between 1 and 6), -- 1 lunes … 6 sábado
  horas smallint[] not null,
  precio_semanal integer not null,
  estado text not null default 'solicitud'
    check (estado in ('solicitud', 'activo', 'rechazado', 'vencido', 'baja')),
  desde date not null,
  hasta date,
  expira_en timestamptz,
  origen text not null default 'web' check (origen in ('web', 'panel')),
  creado_por uuid,
  creado_en timestamptz not null default now(),
  aprobado_por uuid,
  aprobado_en timestamptz,
  baja_en timestamptz
);

-- Semanas puntuales en que un fijo no viene (la hora queda libre)
create table public.fijo_excepciones (
  fijo_id bigint not null references public.fijos (id) on delete cascade,
  fecha date not null,
  motivo text,
  creado_por uuid,
  creado_en timestamptz not null default now(),
  primary key (fijo_id, fecha)
);

-- Feriados, mantenimiento, limpieza. consultorio_id vacío = todos.
create table public.bloqueos (
  id bigint generated always as identity primary key,
  consultorio_id smallint references public.consultorios (id),
  fecha date not null,
  hora_desde smallint not null,
  hora_hasta smallint not null,
  motivo text not null,
  creado_por uuid,
  creado_en timestamptz not null default now(),
  check (hora_hasta > hora_desde)
);

-- LA PIEZA CLAVE: una fila por consultorio, día y hora ocupados.
-- La clave primaria hace IMPOSIBLE que dos cosas ocupen la misma hora.
create table public.ocupaciones (
  consultorio_id smallint not null references public.consultorios (id),
  fecha date not null,
  hora smallint not null check (hora between 0 and 23),
  reserva_id bigint references public.reservas (id) on delete cascade,
  fijo_id bigint references public.fijos (id) on delete cascade,
  bloqueo_id bigint references public.bloqueos (id) on delete cascade,
  primary key (consultorio_id, fecha, hora),
  check (num_nonnulls(reserva_id, fijo_id, bloqueo_id) = 1)
);
create index on public.ocupaciones (fecha);
create index on public.ocupaciones (reserva_id);
create index on public.ocupaciones (fijo_id);
create index on public.ocupaciones (bloqueo_id);

-- ---------------------------------------------------------------------
-- 5. PAGOS E HISTORIAL
-- ---------------------------------------------------------------------
create table public.pagos (
  id bigint generated always as identity primary key,
  reserva_id bigint references public.reservas (id),
  fijo_id bigint references public.fijos (id),
  periodo text,                       -- para fijos: '2026-11'
  monto integer not null check (monto > 0),
  medio text not null check (medio in ('efectivo', 'transferencia', 'mercadopago', 'otro')),
  pagado_en date not null default current_date,
  cobrado_por uuid,
  anulado boolean not null default false,
  creado_en timestamptz not null default now(),
  check (num_nonnulls(reserva_id, fijo_id) = 1),
  check (fijo_id is null or periodo ~ '^[0-9]{4}-[0-9]{2}$')
);
create index on public.pagos (reserva_id);
create index on public.pagos (fijo_id, periodo);

create table public.historial (
  id bigint generated always as identity primary key,
  tabla text not null,
  registro_id text,
  accion text not null,
  usuario uuid,
  cuando timestamptz not null default now(),
  datos jsonb
);

create or replace function public.registrar_historial() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  fila jsonb := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
begin
  insert into public.historial (tabla, registro_id, accion, usuario, datos)
  values (tg_table_name, coalesce(fila->>'id', fila->>'fijo_id'), tg_op, auth.uid(), fila);
  return null;
end $$;

create trigger historial_reservas after insert or update or delete on public.reservas
  for each row execute function public.registrar_historial();
create trigger historial_fijos after insert or update or delete on public.fijos
  for each row execute function public.registrar_historial();
create trigger historial_pagos after insert or update or delete on public.pagos
  for each row execute function public.registrar_historial();
create trigger historial_profesionales after insert or update or delete on public.profesionales
  for each row execute function public.registrar_historial();
create trigger historial_bloqueos after insert or update or delete on public.bloqueos
  for each row execute function public.registrar_historial();
create trigger historial_excepciones after insert or delete on public.fijo_excepciones
  for each row execute function public.registrar_historial();

-- ---------------------------------------------------------------------
-- 6. FUNCIONES DE APOYO
-- ---------------------------------------------------------------------
create or replace function public.ahora_ar() returns timestamp
language sql stable as $$ select (now() at time zone 'America/Argentina/Buenos_Aires') $$;

create or replace function public.hoy_ar() returns date
language sql stable as $$ select public.ahora_ar()::date $$;

create or replace function public.es_equipo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipo where user_id = auth.uid())
$$;

create or replace function public.exigir_equipo() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_equipo() then
    raise exception 'NO_AUTORIZADO' using hint = 'Solo el equipo de Psicostudios puede hacer esto';
  end if;
end $$;

create or replace function public.precio_hora(p_modalidad text, p_hora integer, p_fecha date)
returns integer language sql stable as $$
  select valor from public.precios
  where modalidad = p_modalidad
    and franja = case when p_hora < public.cfg('hora_fin_manana') then 'manana' else 'tarde' end
    and vigente_desde <= p_fecha
  order by vigente_desde desc
  limit 1
$$;

create or replace function public.solo_numeros(p text) returns text
language sql immutable as $$ select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') $$;

-- Busca al profesional por WhatsApp o lo crea
create or replace function public.obtener_profesional(
  p_nombre text, p_whatsapp text, p_profesion text default null,
  p_email text default null, p_origen text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_tel text := public.solo_numeros(p_whatsapp);
  v_id bigint;
begin
  if length(v_tel) < 8 then
    raise exception 'WHATSAPP_INVALIDO' using hint = 'El WhatsApp tiene que tener al menos 8 números';
  end if;
  if length(trim(coalesce(p_nombre, ''))) < 2 then
    raise exception 'NOMBRE_INVALIDO' using hint = 'Falta el nombre';
  end if;
  insert into public.profesionales (nombre, whatsapp, profesion, email, origen)
  values (trim(p_nombre), v_tel, nullif(trim(p_profesion), ''), nullif(trim(p_email), ''), nullif(trim(p_origen), ''))
  on conflict (whatsapp) do update set
    profesion = coalesce(public.profesionales.profesion, excluded.profesion),
    email = coalesce(public.profesionales.email, excluded.email)
  returning id into v_id;
  return v_id;
end $$;

-- Revisa que el día y las horas sean válidos
create or replace function public.validar_horas(p_fecha date, p_horas smallint[], p_permitir_pasado boolean default false)
returns void language plpgsql stable as $$
declare
  h smallint;
begin
  if p_horas is null or cardinality(p_horas) = 0 then
    raise exception 'SIN_HORAS' using hint = 'Elegí al menos una hora';
  end if;
  if cardinality(p_horas) <> (select count(distinct x) from unnest(p_horas) x) then
    raise exception 'HORAS_REPETIDAS' using hint = 'Hay horas repetidas';
  end if;
  if extract(isodow from p_fecha) = 7 then
    raise exception 'DOMINGO' using hint = 'Los domingos está cerrado';
  end if;
  foreach h in array p_horas loop
    if h < public.cfg('hora_apertura') or h >= public.cfg('hora_cierre') then
      raise exception 'HORA_FUERA_DE_RANGO' using hint = format('La hora %s está fuera del horario', h);
    end if;
    if not p_permitir_pasado and (p_fecha < public.hoy_ar()
       or (p_fecha = public.hoy_ar() and h <= extract(hour from public.ahora_ar()))) then
      raise exception 'HORA_PASADA' using hint = 'Ese horario ya pasó';
    end if;
  end loop;
end $$;

-- ¿Está libre ese consultorio en todas esas horas?
create or replace function public.libre(p_consultorio smallint, p_fecha date, p_horas smallint[])
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.ocupaciones
    where consultorio_id = p_consultorio and fecha = p_fecha and hora = any (p_horas)
  )
$$;

-- Fechas en que cae un fijo: desde su inicio, cada 7 días, hasta N semanas adelante
create or replace function public.fechas_fijo(p_fijo_id bigint)
returns setof date language sql stable security definer set search_path = public as $$
  select d::date
  from public.fijos f,
       generate_series(f.desde::timestamp,
                       least(coalesce(f.hasta, '9999-12-31'::date),
                             public.hoy_ar() + 7 * public.cfg('semanas_fijo'))::timestamp,
                       interval '7 days') d
  where f.id = p_fijo_id
    and d::date >= public.hoy_ar()
    and not exists (select 1 from public.fijo_excepciones e where e.fijo_id = f.id and e.fecha = d::date)
$$;

-- Ocupa en la agenda las horas de un fijo.
-- p_estricto = true: si alguna hora ya está ocupada, frena con error.
-- p_estricto = false: salta las ocupadas y devuelve cuántas saltó.
create or replace function public.ocupar_fijo(p_fijo_id bigint, p_estricto boolean)
returns integer language plpgsql security definer set search_path = public as $$
declare
  f public.fijos;
  d date;
  h smallint;
  v_saltadas integer := 0;
begin
  select * into f from public.fijos where id = p_fijo_id;
  for d in select * from public.fechas_fijo(p_fijo_id) loop
    foreach h in array f.horas loop
      insert into public.ocupaciones (consultorio_id, fecha, hora, fijo_id)
      values (f.consultorio_id, d, h, f.id)
      on conflict do nothing;
      if not found then
        if exists (select 1 from public.ocupaciones o
                   where o.consultorio_id = f.consultorio_id and o.fecha = d and o.hora = h
                     and (o.fijo_id = f.id or o.bloqueo_id is not null)) then
          continue;  -- ya era de este mismo fijo, o es un feriado/bloqueo: esa semana se saltea
        end if;
        if p_estricto then
          raise exception 'SIN_LUGAR'
            using hint = format('El %s a las %s hs ya está ocupado', to_char(d, 'DD/MM'), h);
        end if;
        v_saltadas := v_saltadas + 1;
      end if;
    end loop;
  end loop;
  return v_saltadas;
end $$;

-- ---------------------------------------------------------------------
-- 7. FUNCIONES PÚBLICAS (las usa la web de reservas, sin login)
-- ---------------------------------------------------------------------

-- Horas libres por día y consultorio. No devuelve nombres de nadie.
create or replace function public.disponibilidad(p_desde date, p_hasta date)
returns table (fecha date, hora smallint, consultorio_id smallint)
language sql stable security definer set search_path = public as $$
  select d::date, h::smallint, c.id
  from generate_series(greatest(p_desde, public.hoy_ar())::timestamp,
                       least(p_hasta, public.hoy_ar() + public.cfg('dias_reserva_maximo'))::timestamp,
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

-- Horas libres TODAS las semanas para un fijo (p_dia: 1 lunes … 6 sábado)
create or replace function public.disponibilidad_fijo(p_dia smallint, p_desde date)
returns table (hora smallint, consultorio_id smallint)
language sql stable security definer set search_path = public as $$
  with semanas as (
    select (p_desde + ((p_dia - extract(isodow from p_desde)::int + 7) % 7) + 7 * n)::date as fecha
    from generate_series(0, public.cfg('semanas_fijo') - 1) n
  )
  select h::smallint, c.id
  from generate_series(public.cfg('hora_apertura'), public.cfg('hora_cierre') - 1) h
  cross join public.consultorios c
  where c.activo and c.online
    and not exists (select 1 from public.ocupaciones o join semanas s on o.fecha = s.fecha
                    where o.consultorio_id = c.id and o.hora = h
                      and o.bloqueo_id is null)  -- un feriado no impide pedir un fijo
  order by 1, 2
$$;

-- Reserva de horas sueltas desde la web. Queda "pendiente" hasta que se paga.
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
  if p_fecha > public.hoy_ar() + public.cfg('dias_reserva_maximo') then
    raise exception 'FECHA_LEJANA' using hint = 'Todavía no se puede reservar tan adelante';
  end if;

  if p_consultorio is not null then
    if not exists (select 1 from public.consultorios where id = p_consultorio and activo and online) then
      raise exception 'CONSULTORIO_INVALIDO';
    end if;
    v_cons := p_consultorio;
  else
    -- el primero libre en todas las horas, sin contar el Salón
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
  values (v_prof, v_cons, p_fecha, p_horas, v_total, 'pendiente', v_expira, 'web')
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
    'expira_en', v_expira);
end $$;

-- Solicitud de horario fijo desde la web. Queda esperando aprobación.
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
-- 8. FUNCIONES DEL PANEL (solo equipo)
-- ---------------------------------------------------------------------

-- Agenda completa de un rango de fechas, con nombres y estado de pago
create or replace function public.agenda(p_desde date, p_hasta date)
returns table (
  fecha date, hora smallint, consultorio_id smallint, tipo text, estado text,
  nombre text, whatsapp text, profesional_id bigint,
  reserva_id bigint, fijo_id bigint, bloqueo_id bigint, pagado boolean, detalle text
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
    case when o.reserva_id is not null then r.estado = 'confirmada'
         when o.fijo_id is not null then exists (
           select 1 from public.pagos p where p.fijo_id = f.id and not p.anulado
             and p.periodo = to_char(o.fecha, 'YYYY-MM'))
         else null end,
    null::text
  from public.ocupaciones o
  left join public.reservas r on r.id = o.reserva_id
  left join public.profesionales pr on pr.id = r.profesional_id
  left join public.fijos f on f.id = o.fijo_id
  left join public.profesionales pf on pf.id = f.profesional_id
  left join public.bloqueos b on b.id = o.bloqueo_id
  where o.fecha between p_desde and p_hasta
  union all
  -- semanas liberadas de un fijo (la hora está libre, pero se muestra en verde)
  select e.fecha, h::smallint, f.consultorio_id, 'liberado', 'libre',
         pf.nombre, pf.whatsapp, pf.id, null, f.id, null, null, e.motivo
  from public.fijo_excepciones e
  join public.fijos f on f.id = e.fijo_id and f.estado = 'activo'
  join public.profesionales pf on pf.id = f.profesional_id
  cross join unnest(f.horas) h
  where e.fecha between p_desde and p_hasta
    and not exists (select 1 from public.ocupaciones o2
                    where o2.consultorio_id = f.consultorio_id and o2.fecha = e.fecha and o2.hora = h)
  order by 1, 2, 3;
end $$;

-- Cargar una reserva suelta desde el panel (pedido por WhatsApp o teléfono)
create or replace function public.cargar_reserva(
  p_nombre text, p_whatsapp text, p_consultorio smallint, p_fecha date, p_horas smallint[],
  p_pagada boolean default false, p_medio text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_prof bigint;
  v_total integer;
  v_id bigint;
begin
  perform public.exigir_equipo();
  perform public.validar_horas(p_fecha, p_horas, true);
  v_prof := public.obtener_profesional(p_nombre, p_whatsapp, null, null, 'Carga manual');
  select sum(public.precio_hora('suelta', h, p_fecha)) into v_total from unnest(p_horas) h;

  insert into public.reservas (profesional_id, consultorio_id, fecha, horas, precio_total, estado, origen, creado_por)
  values (v_prof, p_consultorio, p_fecha, p_horas, v_total,
          case when p_pagada then 'confirmada' else 'pendiente' end, 'panel', auth.uid())
  returning id into v_id;

  begin
    insert into public.ocupaciones (consultorio_id, fecha, hora, reserva_id)
    select p_consultorio, p_fecha, h, v_id from unnest(p_horas) h;
  exception when unique_violation then
    raise exception 'SIN_LUGAR' using hint = 'Alguna de esas horas ya está ocupada';
  end;

  if p_pagada then
    insert into public.pagos (reserva_id, monto, medio, cobrado_por)
    values (v_id, v_total, coalesce(p_medio, 'efectivo'), auth.uid());
  end if;
  return v_id;
end $$;

-- Cargar un fijo desde el panel (queda activo directamente)
create or replace function public.cargar_fijo(
  p_nombre text, p_whatsapp text, p_consultorio smallint, p_dia smallint,
  p_horas smallint[], p_desde date
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_prof bigint;
  v_id bigint;
  v_semanal integer;
begin
  perform public.exigir_equipo();
  if extract(isodow from p_desde) <> p_dia then
    raise exception 'FECHA_NO_COINCIDE' using hint = 'La fecha de inicio no cae ese día de la semana';
  end if;
  perform public.validar_horas(p_desde, p_horas, true);
  v_prof := public.obtener_profesional(p_nombre, p_whatsapp, null, null, 'Carga manual');
  select sum(public.precio_hora('fijo', h, p_desde)) into v_semanal from unnest(p_horas) h;

  insert into public.fijos (profesional_id, consultorio_id, dia_semana, horas, precio_semanal,
                            estado, desde, origen, creado_por, aprobado_por, aprobado_en)
  values (v_prof, p_consultorio, p_dia, (select array_agg(x order by x) from unnest(p_horas) x),
          v_semanal, 'activo', p_desde, 'panel', auth.uid(), auth.uid(), now())
  returning id into v_id;

  perform public.ocupar_fijo(v_id, true);
  return v_id;
end $$;

create or replace function public.aprobar_fijo(p_fijo_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  update public.fijos set estado = 'activo', expira_en = null, aprobado_por = auth.uid(), aprobado_en = now()
  where id = p_fijo_id and estado = 'solicitud';
  if not found then raise exception 'NO_ENCONTRADO' using hint = 'La solicitud ya no está pendiente'; end if;
  perform public.ocupar_fijo(p_fijo_id, false);
end $$;

create or replace function public.rechazar_fijo(p_fijo_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  update public.fijos set estado = 'rechazado', expira_en = null where id = p_fijo_id and estado = 'solicitud';
  if not found then raise exception 'NO_ENCONTRADO'; end if;
  delete from public.ocupaciones where fijo_id = p_fijo_id;
end $$;

-- Dar de baja un fijo desde una fecha (por defecto, hoy)
create or replace function public.dar_baja_fijo(p_fijo_id bigint, p_desde date default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_desde date := coalesce(p_desde, public.hoy_ar());
begin
  perform public.exigir_equipo();
  update public.fijos set estado = 'baja', hasta = v_desde - 1, baja_en = now()
  where id = p_fijo_id and estado = 'activo';
  if not found then raise exception 'NO_ENCONTRADO'; end if;
  delete from public.ocupaciones where fijo_id = p_fijo_id and fecha >= v_desde;
end $$;

-- Un fijo avisa que una semana no viene: se libera esa fecha
create or replace function public.liberar_fijo_fecha(p_fijo_id bigint, p_fecha date, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  insert into public.fijo_excepciones (fijo_id, fecha, motivo, creado_por)
  values (p_fijo_id, p_fecha, p_motivo, auth.uid())
  on conflict do nothing;
  delete from public.ocupaciones where fijo_id = p_fijo_id and fecha = p_fecha;
end $$;

-- Deshacer lo anterior (si la hora sigue libre)
create or replace function public.volver_a_bloquear_fijo(p_fijo_id bigint, p_fecha date)
returns void language plpgsql security definer set search_path = public as $$
declare
  f public.fijos;
begin
  perform public.exigir_equipo();
  select * into f from public.fijos where id = p_fijo_id;
  if not public.libre(f.consultorio_id, p_fecha, f.horas) then
    raise exception 'SIN_LUGAR' using hint = 'Esa hora ya la tomó otra persona';
  end if;
  delete from public.fijo_excepciones where fijo_id = p_fijo_id and fecha = p_fecha;
  insert into public.ocupaciones (consultorio_id, fecha, hora, fijo_id)
  select f.consultorio_id, p_fecha, h, f.id from unnest(f.horas) h;
end $$;

create or replace function public.cancelar_reserva(p_reserva_id bigint, p_motivo text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  update public.reservas
  set estado = 'cancelada', cancelada_en = now(), cancelada_por = auth.uid(), motivo_cancelacion = p_motivo
  where id = p_reserva_id and estado in ('pendiente', 'confirmada');
  if not found then raise exception 'NO_ENCONTRADO'; end if;
  delete from public.ocupaciones where reserva_id = p_reserva_id;
end $$;

-- Registrar un cobro. Para una suelta: p_reserva_id. Para un fijo: p_fijo_id + p_periodo ('2026-11').
create or replace function public.registrar_pago(
  p_monto integer, p_medio text,
  p_reserva_id bigint default null, p_fijo_id bigint default null, p_periodo text default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  perform public.exigir_equipo();
  insert into public.pagos (reserva_id, fijo_id, periodo, monto, medio, cobrado_por)
  values (p_reserva_id, p_fijo_id, p_periodo, p_monto, p_medio, auth.uid())
  returning id into v_id;
  if p_reserva_id is not null then
    update public.reservas set estado = 'confirmada', expira_en = null
    where id = p_reserva_id and estado = 'pendiente';
  end if;
  return v_id;
end $$;

-- Bloquear horas (feriado, mantenimiento). p_consultorio vacío = todos.
create or replace function public.crear_bloqueo(
  p_fecha date, p_hora_desde smallint, p_hora_hasta smallint, p_motivo text, p_consultorio smallint default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  perform public.exigir_equipo();
  insert into public.bloqueos (consultorio_id, fecha, hora_desde, hora_hasta, motivo, creado_por)
  values (p_consultorio, p_fecha, p_hora_desde, p_hora_hasta, p_motivo, auth.uid())
  returning id into v_id;
  begin
    insert into public.ocupaciones (consultorio_id, fecha, hora, bloqueo_id)
    select c.id, p_fecha, h, v_id
    from public.consultorios c
    cross join generate_series(p_hora_desde, p_hora_hasta - 1) h
    where c.activo and (p_consultorio is null or c.id = p_consultorio);
  exception when unique_violation then
    raise exception 'OCUPADO' using hint = 'Hay reservas en ese horario. Cancelalas o movelas antes de bloquear.';
  end;
  return v_id;
end $$;

create or replace function public.borrar_bloqueo(p_bloqueo_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  delete from public.bloqueos where id = p_bloqueo_id;
end $$;

-- ---------------------------------------------------------------------
-- 9. TAREAS AUTOMÁTICAS (las programa el archivo 02)
-- ---------------------------------------------------------------------

-- Libera reservas sin pagar y solicitudes de fijo vencidas
create or replace function public.liberar_vencidas() returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_n integer := 0;
  v_m integer := 0;
begin
  with v as (
    update public.reservas set estado = 'vencida'
    where estado = 'pendiente' and expira_en is not null and expira_en < now()
    returning id)
  delete from public.ocupaciones o using v where o.reserva_id = v.id;
  get diagnostics v_n = row_count;

  with v as (
    update public.fijos set estado = 'vencido'
    where estado = 'solicitud' and expira_en < now()
    returning id)
  delete from public.ocupaciones o using v where o.fijo_id = v.id;
  get diagnostics v_m = row_count;
  return v_n + v_m;
end $$;

-- Extiende los fijos para que siempre estén bloqueados N semanas adelante
create or replace function public.extender_fijos() returns integer
language plpgsql security definer set search_path = public as $$
declare
  f record;
  v_saltadas integer := 0;
  v_s integer;
begin
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
-- 10. SEGURIDAD
-- ---------------------------------------------------------------------
alter table public.config           enable row level security;
alter table public.consultorios     enable row level security;
alter table public.precios          enable row level security;
alter table public.equipo           enable row level security;
alter table public.profesionales    enable row level security;
alter table public.reservas         enable row level security;
alter table public.fijos            enable row level security;
alter table public.fijo_excepciones enable row level security;
alter table public.bloqueos         enable row level security;
alter table public.ocupaciones      enable row level security;
alter table public.pagos            enable row level security;
alter table public.historial        enable row level security;

-- Cualquiera puede ver consultorios, precios y configuración (la web los necesita)
create policy "todos leen consultorios" on public.consultorios for select using (true);
create policy "todos leen precios"      on public.precios      for select using (true);
create policy "todos leen config"       on public.config       for select using (true);

-- El equipo ve todo
create policy "equipo lee equipo"        on public.equipo           for select to authenticated using (public.es_equipo());
create policy "equipo lee profesionales" on public.profesionales    for select to authenticated using (public.es_equipo());
create policy "equipo lee reservas"      on public.reservas         for select to authenticated using (public.es_equipo());
create policy "equipo lee fijos"         on public.fijos            for select to authenticated using (public.es_equipo());
create policy "equipo lee excepciones"   on public.fijo_excepciones for select to authenticated using (public.es_equipo());
create policy "equipo lee bloqueos"      on public.bloqueos         for select to authenticated using (public.es_equipo());
create policy "equipo lee ocupaciones"   on public.ocupaciones      for select to authenticated using (public.es_equipo());
create policy "equipo lee pagos"         on public.pagos            for select to authenticated using (public.es_equipo());
create policy "equipo lee historial"     on public.historial        for select to authenticated using (public.es_equipo());

-- El equipo edita fichas de profesionales, precios, consultorios y configuración
create policy "equipo edita profesionales" on public.profesionales for update to authenticated
  using (public.es_equipo()) with check (public.es_equipo());
create policy "equipo agrega precios" on public.precios for insert to authenticated
  with check (public.es_equipo());
create policy "equipo edita consultorios" on public.consultorios for update to authenticated
  using (public.es_equipo()) with check (public.es_equipo());
create policy "equipo edita config" on public.config for update to authenticated
  using (public.es_equipo()) with check (public.es_equipo());

-- Reservas, fijos, pagos y ocupaciones solo se modifican a través de las funciones de arriba.

-- Quién puede ejecutar cada función
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.disponibilidad(date, date)                                         to anon, authenticated;
grant execute on function public.disponibilidad_fijo(smallint, date)                                to anon, authenticated;
grant execute on function public.crear_reserva(text, text, text, date, smallint[], smallint)        to anon, authenticated;
grant execute on function public.crear_solicitud_fijo(text, text, text, smallint, smallint[], date, smallint) to anon, authenticated;
grant execute on function public.cfg(text)                                                          to anon, authenticated;
grant execute on function public.precio_hora(text, integer, date)                                   to anon, authenticated;
grant execute on function public.hoy_ar()                                                           to anon, authenticated;
grant execute on function public.ahora_ar()                                                         to anon, authenticated;
grant execute on function public.es_equipo()                                                        to anon, authenticated;

grant execute on function public.agenda(date, date)                                                 to authenticated;
grant execute on function public.cargar_reserva(text, text, smallint, date, smallint[], boolean, text) to authenticated;
grant execute on function public.cargar_fijo(text, text, smallint, smallint, smallint[], date)      to authenticated;
grant execute on function public.aprobar_fijo(bigint)                                               to authenticated;
grant execute on function public.rechazar_fijo(bigint)                                              to authenticated;
grant execute on function public.dar_baja_fijo(bigint, date)                                        to authenticated;
grant execute on function public.liberar_fijo_fecha(bigint, date, text)                             to authenticated;
grant execute on function public.volver_a_bloquear_fijo(bigint, date)                              to authenticated;
grant execute on function public.cancelar_reserva(bigint, text)                                     to authenticated;
grant execute on function public.registrar_pago(integer, text, bigint, bigint, text)                to authenticated;
grant execute on function public.crear_bloqueo(date, smallint, smallint, text, smallint)            to authenticated;
grant execute on function public.borrar_bloqueo(bigint)                                             to authenticated;

-- Listo. Si llegaste acá sin errores, la base está creada.
select 'Base de Psicostudios creada correctamente' as resultado;

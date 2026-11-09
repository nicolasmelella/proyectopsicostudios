-- =====================================================================
-- PSICOSTUDIOS · 20_asistente.sql
-- ASISTENTE DE WHATSAPP con inteligencia artificial (Claude).
--   · Contesta los WhatsApp solo: dudas, disponibilidad, precios, reservas
--     por horas, pedidos de horario fijo, estado de un pedido y comprobantes.
--   · Usa las MISMAS funciones que la web: lo que reserva aparece en el panel
--     como cualquier reserva, con las mismas reglas (seña, plazos, límites).
--   · Aprende: memoria por cliente, respuestas que el equipo aprueba y una
--     revisión semanal. NADA de lo aprendido se usa sin que el equipo lo apruebe.
--   · Nunca registra pagos, ni cancela algo pagado, ni hace descuentos:
--     eso lo deriva al equipo (queda marcado en el panel → Asistente).
--   · Si alguien del equipo contesta un chat, el asistente se calla en ese
--     chat un rato (configurable).
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Requiere 01 a 19. Se puede correr más de una vez.
-- Arranca APAGADO y en modo prueba (ver docs/asistente-whatsapp.md).
-- =====================================================================

insert into public.config (clave, valor, descripcion) values
  ('asistente_activo',          'no',  'si = el asistente contesta los WhatsApp'),
  ('asistente_solo_prueba',     'si',  'si = solo contesta a los números cargados en Asistente → Ajustes (para probarlo antes de abrirlo a todos)'),
  ('asistente_nombre',          'Sofía', 'Nombre con el que se presenta el asistente'),
  ('asistente_minutos_pausa',   '60',  'Minutos que el asistente se queda callado en un chat cuando alguien del equipo contesta'),
  ('asistente_horas_charla',    '24',  'Horas sin mensajes después de las que el asistente empieza la charla de cero (recuerda igual los datos del cliente)'),
  ('asistente_recordar_sena',   'si',  'si = si alguien reservó por WhatsApp y no pagó, el asistente le recuerda la seña una vez'),
  ('asistente_minutos_recordatorio', '60', 'Minutos después de reservar en que el asistente recuerda la seña'),
  ('asistente_esfuerzo',        'medium', 'Cuánto piensa antes de responder: low (más rápido y barato), medium o high'),
  ('asistente_seguimiento',     'si',  'si = si alguien consultó y no reservó, el asistente le vuelve a escribir UNA vez (con disponibilidad real)'),
  ('asistente_horas_seguimiento', '3', 'Horas de silencio después de las que el asistente hace ese seguimiento'),
  ('asistente_transcribir_audios', 'si', 'si = los audios se pasan a texto con Whisper (requiere el secreto OPENAI_API_KEY)')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------

-- Números especiales: de PRUEBA (le contesta aunque esté en modo prueba)
-- y del EQUIPO (además puede pedirle datos del panel: agenda, cobros, números)
create table if not exists public.asistente_numeros (
  whatsapp text primary key,                 -- internacional, solo números: 5491122334455
  tipo text not null check (tipo in ('prueba', 'equipo')),
  nombre text,
  user_id uuid references public.equipo (user_id) on delete cascade,  -- para 'equipo': con qué usuario consulta
  creado_en timestamptz not null default now(),
  check (tipo = 'prueba' or user_id is not null)
);

create table if not exists public.asistente_chats (
  id bigint generated always as identity primary key,
  whatsapp text not null unique,             -- internacional; 'sim-…' para el simulador del panel
  nombre_perfil text,                        -- el nombre que tiene en WhatsApp
  profesional_id bigint references public.profesionales (id),
  simulado boolean not null default false,
  atender boolean not null default false,    -- alguien del equipo tiene que mirarlo
  motivo_atender text,
  urgente boolean not null default false,
  pausa_hasta timestamptz,                   -- el asistente no contesta hasta esta hora
  sesion_desde timestamptz not null default now(),  -- desde cuándo cuenta la charla actual
  procesando_desde timestamptz,              -- hay una respuesta en curso
  ultimo_cliente_en timestamptz,             -- último mensaje del cliente (WhatsApp deja contestar 24 hs)
  ultimo_mensaje_en timestamptz,
  creado_en timestamptz not null default now()
);
create index if not exists asistente_chats_orden on public.asistente_chats (atender desc, ultimo_mensaje_en desc);
-- CRM: en qué etapa está cada contacto, qué busca, cuánto vale y quién del equipo lo sigue
alter table public.asistente_chats add column if not exists etapa text not null default 'nuevo';
alter table public.asistente_chats drop constraint if exists asistente_chats_etapa_check;
alter table public.asistente_chats add constraint asistente_chats_etapa_check
  check (etapa in ('nuevo', 'consulta', 'interesado', 'reservo', 'pago', 'perdido'));
alter table public.asistente_chats add column if not exists interes text;          -- horas, fijo, salon, otro
alter table public.asistente_chats add column if not exists valor_estimado integer; -- $ por mes aprox.
alter table public.asistente_chats add column if not exists nota_crm text;          -- lo que busca, en una línea
alter table public.asistente_chats add column if not exists prioridad boolean not null default false;
alter table public.asistente_chats add column if not exists asignado_a uuid references public.equipo (user_id) on delete set null;
alter table public.asistente_chats add column if not exists seguimiento_en timestamptz;

create table if not exists public.asistente_mensajes (
  id bigint generated always as identity primary key,
  chat_id bigint not null references public.asistente_chats (id) on delete cascade,
  rol text not null check (rol in ('cliente', 'asistente', 'equipo', 'nota')),
  texto text not null default '',
  tipo text not null default 'texto',        -- texto, imagen, documento, audio, otro
  media jsonb,                               -- {id, mime, nombre} de WhatsApp, o {url} si lo mandó el asistente
  wa_id text unique,                         -- id del mensaje en WhatsApp (evita duplicados)
  leido boolean not null default false,      -- ya lo tuvo en cuenta el asistente
  api jsonb,                                 -- (asistente) la charla exacta con la IA en ese turno
  uso jsonb,                                 -- (asistente) tokens usados
  autor uuid,                                -- (equipo) quién lo mandó
  envio text,                                -- 'enviado' o el error de WhatsApp
  creado_en timestamptz not null default now()
);
create index if not exists asistente_mensajes_chat on public.asistente_mensajes (chat_id, id);

-- Memoria por cliente: datos útiles que el asistente anota (y el equipo puede borrar)
create table if not exists public.asistente_memoria (
  id bigint generated always as identity primary key,
  whatsapp text not null,
  dato text not null,
  creado_en timestamptz not null default now()
);
create index if not exists asistente_memoria_wa on public.asistente_memoria (whatsapp, id);

-- Lo que el asistente sabe responder (lo carga y aprueba el equipo)
create table if not exists public.asistente_conocimiento (
  id bigint generated always as identity primary key,
  tema text not null default 'General',
  pregunta text not null,
  respuesta text not null,
  activo boolean not null default true,
  origen text not null default 'equipo' check (origen in ('inicial', 'equipo', 'aprendido')),
  usos integer not null default 0,
  creado_por uuid,
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Lo que el asistente PROPONE aprender: el equipo lo aprueba, corrige o descarta
create table if not exists public.asistente_propuestas (
  id bigint generated always as identity primary key,
  tema text not null default 'General',
  pregunta text not null,
  respuesta text not null,
  motivo text,
  origen text not null default 'conversacion' check (origen in ('conversacion', 'equipo', 'revision')),
  chat_id bigint references public.asistente_chats (id) on delete set null,
  conocimiento_id bigint references public.asistente_conocimiento (id) on delete set null,  -- si corrige una existente
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'descartada')),
  revisado_por uuid,
  revisado_en timestamptz,
  creado_en timestamptz not null default now()
);
create unique index if not exists asistente_propuestas_unica
  on public.asistente_propuestas (md5(lower(trim(pregunta)))) where estado = 'pendiente';

-- Pedidos que tomó el asistente (para medir y para recordar la seña)
create table if not exists public.asistente_pedidos (
  pedido_id bigint primary key references public.pedidos (id) on delete cascade,
  chat_id bigint not null references public.asistente_chats (id) on delete cascade,
  recordatorio_en timestamptz,
  creado_en timestamptz not null default now()
);

-- Revisión semanal
create table if not exists public.asistente_informes (
  id bigint generated always as identity primary key,
  desde date not null,
  hasta date not null,
  datos jsonb not null,
  creado_en timestamptz not null default now()
);

alter table public.equipo add column if not exists whatsapp text;

-- Seguridad: el panel solo LEE (todo cambio pasa por funciones que revisan permisos); la web no ve nada
do $$
declare t text;
begin
  foreach t in array array['asistente_numeros', 'asistente_chats', 'asistente_mensajes', 'asistente_memoria',
                           'asistente_conocimiento', 'asistente_propuestas', 'asistente_pedidos', 'asistente_informes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "equipo lee" on public.%I', t);
    execute format('create policy "equipo lee" on public.%I for select to authenticated using (public.es_equipo())', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. AYUDAS
-- ---------------------------------------------------------------------

-- Los últimos 10 números (código de área + número) para reconocer a alguien
-- aunque esté guardado como 1133334444, 91133334444 o 5491133334444.
-- El simulador del panel ('sim-…') no es nadie: nunca coincide con un profesional.
create or replace function public.asistente_clave_tel(p text) returns text
language sql immutable set search_path = public as $$
  select case when p !~ '[a-zA-Z]' and length(public.solo_numeros(p)) >= 10 then right(public.solo_numeros(p), 10) end
$$;

-- Con qué clave se guarda la memoria de un chat
create or replace function public.asistente_clave_memoria(p text) returns text
language sql immutable set search_path = public as $$
  select case when p like 'sim-%' then p else public.solo_numeros(p) end
$$;

-- El número como se guarda en profesionales (si ya existe, el mismo; si no, sin el 54 9)
create or replace function public.asistente_tel_local(p text) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select pr.whatsapp from public.profesionales pr
     where public.asistente_clave_tel(pr.whatsapp) = public.asistente_clave_tel(p)
     order by pr.id limit 1),
    case when public.solo_numeros(p) like '549%' then substr(public.solo_numeros(p), 4)
         when public.solo_numeros(p) like '54%' then substr(public.solo_numeros(p), 3)
         else public.solo_numeros(p) end)
$$;

create or replace function public.asistente_profesional(p_whatsapp text) returns bigint
language sql stable security definer set search_path = public as $$
  select pr.id from public.profesionales pr
  where public.asistente_clave_tel(pr.whatsapp) = public.asistente_clave_tel(p_whatsapp)
  order by pr.id limit 1
$$;

-- ¿Este pedido es de este número? Devuelve su código secreto (o error)
create or replace function public.asistente_token_pedido(p_whatsapp text, p_pedido bigint) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v uuid;
begin
  select pe.token into v from public.pedidos pe
  join public.profesionales pr on pr.id = pe.profesional_id
  where pe.id = p_pedido and public.asistente_clave_tel(pr.whatsapp) = public.asistente_clave_tel(p_whatsapp);
  if v is null then
    raise exception 'NO_ENCONTRADO' using hint = 'No hay un pedido con ese número a nombre de este WhatsApp';
  end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- 3. SERVIDOR: entrada de mensajes y turnos (solo la función "asistente-whatsapp")
-- ---------------------------------------------------------------------

-- Llega un mensaje. Devuelve si el asistente tiene que contestar.
create or replace function public.asistente_entrada(
  p_whatsapp text, p_nombre text, p_texto text, p_tipo text default 'texto',
  p_media jsonb default null, p_wa_id text default null, p_simulado boolean default false
) returns json
language plpgsql security definer set search_path = public as $$
declare
  c public.asistente_chats;
  v_id bigint;
  v_numero public.asistente_numeros;
  v_motivo text;
begin
  insert into public.asistente_chats (whatsapp, nombre_perfil, simulado, profesional_id)
  values (p_whatsapp, nullif(trim(p_nombre), ''), p_simulado, public.asistente_profesional(p_whatsapp))
  on conflict (whatsapp) do update set nombre_perfil = coalesce(excluded.nombre_perfil, public.asistente_chats.nombre_perfil)
  returning * into c;

  -- charla nueva si pasó mucho tiempo (la memoria del cliente se mantiene)
  if c.ultimo_mensaje_en is not null and c.ultimo_mensaje_en < now() - make_interval(hours => coalesce(public.cfg('asistente_horas_charla'), 24)) then
    update public.asistente_chats set sesion_desde = now() where id = c.id;
  end if;
  update public.asistente_chats
  set ultimo_cliente_en = now(), ultimo_mensaje_en = now(),
      profesional_id = coalesce(profesional_id, public.asistente_profesional(p_whatsapp))
  where id = c.id returning * into c;

  insert into public.asistente_mensajes (chat_id, rol, texto, tipo, media, wa_id)
  values (c.id, 'cliente', coalesce(p_texto, ''), coalesce(p_tipo, 'texto'), p_media, p_wa_id)
  on conflict (wa_id) do nothing
  returning id into v_id;
  if v_id is null then
    return json_build_object('chat_id', c.id, 'duplicado', true, 'contestar', false);
  end if;

  select * into v_numero from public.asistente_numeros where whatsapp = public.solo_numeros(p_whatsapp);
  v_motivo := case
    when p_simulado then null
    when public.cfg_texto('asistente_activo') <> 'si' then 'apagado'
    when public.cfg_texto('asistente_solo_prueba') = 'si' and v_numero.whatsapp is null then 'modo_prueba'
    when c.pausa_hasta > now() then 'pausa_equipo'
  end;
  return json_build_object('chat_id', c.id, 'mensaje_id', v_id, 'contestar', v_motivo is null, 'motivo', v_motivo);
end $$;

-- Toma el turno: solo si este es el último mensaje sin leer y no hay otra respuesta en curso
-- (si la persona manda 3 mensajes seguidos, se contesta una sola vez, a los 3)
create or replace function public.asistente_tomar_turno(p_chat_id bigint, p_mensaje_id bigint default null) returns boolean
language plpgsql security definer set search_path = public as $$
declare v_ok boolean;
begin
  update public.asistente_chats c set procesando_desde = now()
  where c.id = p_chat_id
    and (c.procesando_desde is null or c.procesando_desde < now() - interval '3 minutes')
    and (c.pausa_hasta is null or c.pausa_hasta <= now() or c.simulado)
    and exists (select 1 from public.asistente_mensajes m where m.chat_id = c.id and m.rol = 'cliente' and not m.leido)
    and (p_mensaje_id is null or not exists (select 1 from public.asistente_mensajes m
                                             where m.chat_id = c.id and m.rol = 'cliente' and m.id > p_mensaje_id))
  returning true into v_ok;
  return coalesce(v_ok, false);
end $$;

create or replace function public.asistente_soltar_turno(p_chat_id bigint) returns void
language sql security definer set search_path = public as $$
  update public.asistente_chats set procesando_desde = null where id = p_chat_id
$$;

-- Todo lo que el asistente necesita saber para contestar
create or replace function public.asistente_contexto(p_chat_id bigint) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  c public.asistente_chats;
  pr public.profesionales;
  n public.asistente_numeros;
begin
  select * into c from public.asistente_chats where id = p_chat_id;
  if not found then raise exception 'NO_ENCONTRADO'; end if;
  select * into pr from public.profesionales where id = c.profesional_id;
  select * into n from public.asistente_numeros where whatsapp = public.solo_numeros(c.whatsapp) and tipo = 'equipo';
  return json_build_object(
    'chat_id', c.id, 'whatsapp', c.whatsapp, 'nombre_perfil', c.nombre_perfil, 'simulado', c.simulado,
    'crm', json_build_object('etapa', public.asistente_etapa(c.id), 'interes', c.interes, 'valor_estimado', c.valor_estimado,
                             'nota', c.nota_crm, 'prioridad', c.prioridad),
    'equipo', case when n.whatsapp is not null and exists (select 1 from public.equipo e where e.user_id = n.user_id and e.activo)
                   then json_build_object('nombre', coalesce(n.nombre, (select nombre from public.equipo where user_id = n.user_id))) end,
    'cliente', case when pr.id is not null then json_build_object(
        'nombre', pr.nombre, 'profesion', pr.profesion, 'email', pr.email,
        'cliente_desde', to_char(pr.creado_en, 'YYYY-MM'),
        'reservas_hechas', (select count(*) from public.reservas r where r.profesional_id = pr.id and r.estado = 'confirmada'),
        'tiene_fijo', exists (select 1 from public.fijos f where f.profesional_id = pr.id and f.estado = 'activo')) end,
    'memoria', coalesce((select json_agg(m.dato order by m.id) from (
        select * from public.asistente_memoria where whatsapp = public.asistente_clave_memoria(c.whatsapp) order by id desc limit 30) m), '[]'::json),
    'historial', coalesce((select json_agg(m.api order by m.id) from public.asistente_mensajes m
                           where m.chat_id = c.id and m.rol = 'asistente' and m.api is not null and m.creado_en >= c.sesion_desde), '[]'::json),
    'nuevos', coalesce((select json_agg(json_build_object('id', m.id, 'rol', m.rol, 'texto', m.texto, 'tipo', m.tipo,
                                                          'media', m.media, 'creado_en', m.creado_en) order by m.id)
                        from public.asistente_mensajes m
                        where m.chat_id = c.id and m.rol <> 'asistente' and not m.leido), '[]'::json));
end $$;

-- Guarda la respuesta del asistente. Devuelve si llegaron mensajes nuevos mientras pensaba.
create or replace function public.asistente_guardar_turno(
  p_chat_id bigint, p_leidos bigint[], p_texto text, p_api jsonb, p_uso jsonb default null
) returns json
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  update public.asistente_mensajes set leido = true where chat_id = p_chat_id and id = any (p_leidos);
  insert into public.asistente_mensajes (chat_id, rol, texto, api, uso, leido)
  values (p_chat_id, 'asistente', coalesce(p_texto, ''), p_api, p_uso, true)
  returning id into v_id;
  update public.asistente_chats set procesando_desde = null, ultimo_mensaje_en = now() where id = p_chat_id;
  return json_build_object('mensaje_id', v_id,
    'hay_mas', exists (select 1 from public.asistente_mensajes where chat_id = p_chat_id and rol = 'cliente' and not leido));
end $$;

create or replace function public.asistente_resultado_envio(p_mensaje_id bigint, p_resultado text) returns void
language sql security definer set search_path = public as $$
  update public.asistente_mensajes set envio = left(p_resultado, 500) where id = p_mensaje_id
$$;

-- Alguien del equipo contestó DESDE EL CELULAR (app WhatsApp Business con el mismo número):
-- queda en el chat y el asistente se calla un rato, igual que si contestara desde el panel
create or replace function public.asistente_eco(p_whatsapp text, p_texto text, p_wa_id text) returns void
language plpgsql security definer set search_path = public as $$
declare v_chat bigint;
begin
  insert into public.asistente_chats (whatsapp, profesional_id) values (p_whatsapp, public.asistente_profesional(p_whatsapp))
  on conflict (whatsapp) do nothing;
  select id into v_chat from public.asistente_chats where whatsapp = p_whatsapp;
  insert into public.asistente_mensajes (chat_id, rol, texto, wa_id, envio) values (v_chat, 'equipo', coalesce(p_texto, ''), p_wa_id, 'enviado')
  on conflict (wa_id) do nothing;
  update public.asistente_chats
  set atender = false, urgente = false, ultimo_mensaje_en = now(),
      pausa_hasta = now() + make_interval(mins => public.cfg('asistente_minutos_pausa'))
  where id = v_chat;
end $$;

-- Audio pasado a texto (Whisper): queda en el mensaje para el asistente y para el panel
create or replace function public.asistente_transcripcion(p_mensaje_id bigint, p_texto text) returns void
language sql security definer set search_path = public as $$
  update public.asistente_mensajes
  set texto = left(p_texto, 8000), media = coalesce(media, '{}'::jsonb) || '{"transcripto": true}'::jsonb
  where id = p_mensaje_id and tipo = 'audio'
$$;

-- Mensaje que manda el sistema (recordatorio, aviso): queda en el chat y como nota para el asistente
create or replace function public.asistente_mensaje_sistema(p_chat_id bigint, p_texto text, p_nota text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  insert into public.asistente_mensajes (chat_id, rol, texto, leido) values (p_chat_id, 'asistente', p_texto, true) returning id into v_id;
  insert into public.asistente_mensajes (chat_id, rol, texto) values (p_chat_id, 'nota', p_nota);
  update public.asistente_chats set ultimo_mensaje_en = now() where id = p_chat_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------
-- 4. HERRAMIENTAS DEL ASISTENTE (lo que puede consultar y hacer)
-- ---------------------------------------------------------------------

-- Precios, seña, horarios y reglas vigentes (todo sale de la base: si cambian en el panel, cambia la respuesta)
create or replace function public.asistente_info(p_fecha date default null) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'hoy', public.hoy_ar(),
    'precio_por_hora', json_build_object(
      'horas_sueltas', json_build_object('manana', public.precio_hora('suelta', public.cfg('hora_apertura'), coalesce(p_fecha, public.hoy_ar())),
                                         'tarde',  public.precio_hora('suelta', public.cfg('hora_fin_manana'), coalesce(p_fecha, public.hoy_ar()))),
      'horario_fijo',  json_build_object('manana', public.precio_hora('fijo', public.cfg('hora_apertura'), coalesce(p_fecha, public.hoy_ar())),
                                         'tarde',  public.precio_hora('fijo', public.cfg('hora_fin_manana'), coalesce(p_fecha, public.hoy_ar())))),
    'aumentos_programados', coalesce((select json_agg(json_build_object('modalidad', modalidad, 'franja', franja, 'valor', valor, 'desde', vigente_desde))
                                      from public.precios where vigente_desde > public.hoy_ar()), '[]'::json),
    'horario', json_build_object('abre', public.cfg('hora_apertura'), 'cierra', public.cfg('hora_cierre'),
                                 'tarde_desde', public.cfg('hora_fin_manana'), 'dias', 'lunes a sábado (domingo cerrado)'),
    'sena_porcentaje', public.cfg('porcentaje_sena'),
    'minutos_para_pagar_la_sena', public.cfg('retencion_suelta_minutos'),
    'saldo', 'el resto se paga hasta el día anterior a cada turno',
    'fijo', json_build_object('minimo_horas_manana', coalesce(public.cfg('min_horas_fijo_manana'), 1),
                              'minimo_horas_tarde', coalesce(public.cfg('min_horas_fijo_tarde'), 2),
                              'como_se_paga', 'se confirma pagando el primer mes; después, mes a mes por adelantado'),
    'limites', json_build_object('dias_por_pedido', public.cfg('max_dias_por_pedido'), 'horas_por_dia', public.cfg('max_horas_por_reserva'),
                                 'pedidos_sin_pagar_por_persona', public.cfg('max_pendientes_por_whatsapp'),
                                 'se_puede_reservar_hasta', public.fecha_maxima_reserva()),
    'consultorios', (select json_agg(json_build_object('id', id, 'nombre', nombre) order by orden) from public.consultorios where activo and online),
    'pago', json_build_object('mercadopago', public.cfg_texto('mercadopago_activo') = 'si',
                              'transferencia', public.datos_transferencia()))
$$;

-- Horarios libres de un día, por consultorio
create or replace function public.asistente_horarios_libres(p_fecha date) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('consultorio_id', x.consultorio_id, 'consultorio', x.nombre, 'horas_libres', x.horas) order by x.orden), '[]'::json)
  from (select d.consultorio_id, c.nombre, c.orden, array_agg(d.hora order by d.hora) as horas
        from public.disponibilidad(p_fecha, p_fecha) d join public.consultorios c on c.id = d.consultorio_id
        group by d.consultorio_id, c.nombre, c.orden) x
$$;

-- Horas libres TODAS las semanas para un fijo
create or replace function public.asistente_libres_fijo(p_dia smallint, p_desde date) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('consultorio_id', x.consultorio_id, 'consultorio', x.nombre, 'horas_libres_todas_las_semanas', x.horas) order by x.orden), '[]'::json)
  from (select d.consultorio_id, c.nombre, c.orden, array_agg(d.hora order by d.hora) as horas
        from public.disponibilidad_fijo(p_dia, greatest(p_desde, public.hoy_ar())) d join public.consultorios c on c.id = d.consultorio_id
        group by d.consultorio_id, c.nombre, c.orden) x
$$;

-- Las reservas, pedidos y fijos de quien escribe (SOLO los de su número)
create or replace function public.asistente_mis_reservas(p_whatsapp text) returns json
language sql stable security definer set search_path = public as $$
  with yo as (
    select pr.id from public.profesionales pr
    where public.asistente_clave_tel(pr.whatsapp) = public.asistente_clave_tel(p_whatsapp))
  select json_build_object(
    'proximos_turnos', coalesce((select json_agg(json_build_object(
        'pedido', r.pedido_id, 'fecha', r.fecha, 'horas', r.horas, 'consultorio', c.nombre, 'estado', r.estado,
        'total', r.precio_total, 'pagado', public.monto_pagado_reserva(r.id),
        'paga_sena_hasta', case when r.estado = 'pendiente' then r.expira_en end) order by r.fecha, r.horas[1])
      from public.reservas r join public.consultorios c on c.id = r.consultorio_id
      where r.profesional_id in (select id from yo) and r.fecha >= public.hoy_ar() and r.estado in ('pendiente', 'confirmada')), '[]'::json),
    'horarios_fijos', coalesce((select json_agg(json_build_object(
        'pedido', f.pedido_id, 'dia_semana', f.dia_semana, 'horas', f.horas, 'consultorio', c.nombre, 'estado', f.estado,
        'desde', f.desde, 'precio_semanal', f.precio_semanal))
      from public.fijos f join public.consultorios c on c.id = f.consultorio_id
      where f.profesional_id in (select id from yo) and f.estado in ('solicitud', 'activo')), '[]'::json),
    'pedidos_con_comprobante_en_revision', coalesce((select json_agg(distinct co.pedido_id)
      from public.comprobantes co join public.pedidos pe on pe.id = co.pedido_id
      where pe.profesional_id in (select id from yo) and co.estado = 'pendiente'), '[]'::json))
$$;

-- Reserva de horas sueltas (uno o varios días) a nombre de quien escribe
create or replace function public.asistente_crear_pedido(
  p_chat_id bigint, p_nombre text, p_profesion text, p_email text, p_items jsonb
) returns json
language plpgsql security definer set search_path = public as $$
declare
  c public.asistente_chats;
  v json;
begin
  select * into c from public.asistente_chats where id = p_chat_id;
  if c.simulado then raise exception 'SIMULADO'; end if;
  v := public.crear_pedido(p_nombre, public.asistente_tel_local(c.whatsapp), p_profesion, p_email, p_items);
  update public.pedidos set origen = 'whatsapp' where id = (v->>'pedido')::bigint;
  insert into public.asistente_pedidos (pedido_id, chat_id) values ((v->>'pedido')::bigint, c.id) on conflict do nothing;
  update public.asistente_chats set profesional_id = coalesce(profesional_id, public.asistente_profesional(c.whatsapp)) where id = c.id;
  return v;
end $$;

-- Pedido de horario fijo a nombre de quien escribe
create or replace function public.asistente_crear_fijo(
  p_chat_id bigint, p_nombre text, p_profesion text, p_email text,
  p_dia smallint, p_horas smallint[], p_desde date, p_consultorio smallint default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  c public.asistente_chats;
  v json;
begin
  select * into c from public.asistente_chats where id = p_chat_id;
  if c.simulado then raise exception 'SIMULADO'; end if;
  v := public.crear_fijo_web(p_nombre, public.asistente_tel_local(c.whatsapp), p_profesion, p_email, p_dia, p_horas, p_desde, p_consultorio);
  update public.pedidos set origen = 'whatsapp' where id = (v->>'pedido')::bigint;
  insert into public.asistente_pedidos (pedido_id, chat_id) values ((v->>'pedido')::bigint, c.id) on conflict do nothing;
  update public.asistente_chats set profesional_id = coalesce(profesional_id, public.asistente_profesional(c.whatsapp)) where id = c.id;
  return v;
end $$;

-- Simulador: calcula lo que se reservaría, SIN reservar nada
create or replace function public.asistente_simular_pedido(p_items jsonb) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  it jsonb;
  v_fecha date;
  v_horas smallint[];
  v_cons smallint;
  v_total integer;
  v_lista jsonb := '[]'::jsonb;
  v_suma integer := 0;
  v_sena integer := 0;
begin
  for it in select x from jsonb_array_elements(p_items) x loop
    v_fecha := (it->>'fecha')::date;
    v_horas := array(select h::smallint from jsonb_array_elements_text(it->'horas') h order by 1);
    v_cons := nullif(it->>'consultorio', '')::smallint;
    perform public.validar_horas(v_fecha, v_horas);
    if v_cons is null then
      select c.id into v_cons from public.consultorios c
      where c.activo and c.online and c.nombre <> 'Salón' and public.libre(c.id, v_fecha, v_horas) order by c.orden limit 1;
    end if;
    if v_cons is null or not public.libre(v_cons, v_fecha, v_horas) then
      raise exception 'SIN_LUGAR' using hint = format('El horario del %s no está libre', to_char(v_fecha, 'DD/MM'));
    end if;
    select sum(public.precio_hora('suelta', h, v_fecha)) into v_total from unnest(v_horas) h;
    v_suma := v_suma + v_total;
    v_sena := v_sena + public.sena_minima(v_total);
    v_lista := v_lista || jsonb_build_object('fecha', v_fecha, 'horas', to_jsonb(v_horas),
      'consultorio', (select nombre from public.consultorios where id = v_cons), 'total', v_total);
  end loop;
  return json_build_object('simulado', true, 'pedido', 0, 'total', v_suma, 'sena', v_sena,
                           'expira_en', now() + make_interval(mins => public.cfg('retencion_suelta_minutos')), 'reservas', v_lista);
end $$;

create or replace function public.asistente_estado_pedido(p_whatsapp text, p_pedido bigint) returns json
language plpgsql stable security definer set search_path = public as $$
declare v_token uuid := public.asistente_token_pedido(p_whatsapp, p_pedido);
begin
  return (public.estado_pago_pedido(p_pedido, v_token)::jsonb
          || jsonb_build_object('token', v_token,
                                'comprobante_en_revision', exists (select 1 from public.comprobantes where pedido_id = p_pedido and estado = 'pendiente'),
                                'transferencia', public.datos_transferencia()))::json;
end $$;

-- Resumen de lugar libre por día
create or replace function public.asistente_resumen(p_desde date, p_hasta date) returns json
language sql stable security definer set search_path = public as $$
  select coalesce(json_agg(json_build_object('fecha', fecha, 'turnos_libres', libres, 'de', total) order by fecha), '[]'::json)
  from public.resumen_disponibilidad(p_desde, least(p_hasta, p_desde + 62))
$$;

-- El archivo (imagen, PDF) de un mensaje de este chat
create or replace function public.asistente_media(p_chat_id bigint, p_mensaje_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select media from public.asistente_mensajes where id = p_mensaje_id and chat_id = p_chat_id and rol = 'cliente'
$$;

-- Cancelar un pedido SIN pagar (la función de la web ya impide cancelar algo pagado o con comprobante)
create or replace function public.asistente_cancelar_pedido(p_whatsapp text, p_pedido bigint) returns json
language plpgsql security definer set search_path = public as $$
begin
  return public.cancelar_pedido_web(p_pedido, public.asistente_token_pedido(p_whatsapp, p_pedido));
end $$;

-- Comprobante que mandó por WhatsApp: ya subido por el servidor al espacio privado
create or replace function public.asistente_comprobante(p_whatsapp text, p_pedido bigint, p_ruta text) returns json
language plpgsql security definer set search_path = public as $$
declare v_token uuid := public.asistente_token_pedido(p_whatsapp, p_pedido);
begin
  if (select count(*) from public.comprobantes where pedido_id = p_pedido) >= public.cfg('max_comprobantes_por_pedido') then
    raise exception 'DEMASIADOS' using hint = 'Ya hay varios comprobantes en este pedido: lo revisa el equipo';
  end if;
  return public.registrar_comprobante(p_pedido, v_token, p_ruta);
end $$;

-- Ruta donde guardar el archivo de un comprobante (pedido/código/archivo)
create or replace function public.asistente_ruta_comprobante(p_whatsapp text, p_pedido bigint, p_ext text) returns text
language sql stable security definer set search_path = public as $$
  select p_pedido || '/' || public.asistente_token_pedido(p_whatsapp, p_pedido) || '/' || gen_random_uuid() || '.' || lower(p_ext)
$$;

create or replace function public.asistente_recordar(p_whatsapp text, p_dato text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(trim(coalesce(p_dato, ''))) < 3 then return; end if;
  if exists (select 1 from public.asistente_memoria where whatsapp = public.asistente_clave_memoria(p_whatsapp) and lower(dato) = lower(trim(p_dato))) then return; end if;
  insert into public.asistente_memoria (whatsapp, dato) values (public.asistente_clave_memoria(p_whatsapp), left(trim(p_dato), 300));
end $$;

create or replace function public.asistente_derivar(p_chat_id bigint, p_motivo text, p_urgente boolean default false) returns void
language sql security definer set search_path = public as $$
  update public.asistente_chats set atender = true, motivo_atender = left(p_motivo, 500), urgente = urgente or coalesce(p_urgente, false)
  where id = p_chat_id
$$;

create or replace function public.asistente_proponer(
  p_pregunta text, p_respuesta text, p_tema text default 'General', p_motivo text default null,
  p_origen text default 'conversacion', p_chat_id bigint default null, p_conocimiento_id bigint default null
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if length(trim(coalesce(p_pregunta, ''))) < 4 or length(trim(coalesce(p_respuesta, ''))) < 2 then return null; end if;
  insert into public.asistente_propuestas (pregunta, respuesta, tema, motivo, origen, chat_id, conocimiento_id)
  values (left(trim(p_pregunta), 500), left(trim(p_respuesta), 2000), coalesce(nullif(trim(p_tema), ''), 'General'),
          left(p_motivo, 500), p_origen, p_chat_id,
          (select id from public.asistente_conocimiento where id = p_conocimiento_id))
  on conflict do nothing
  returning id into v_id;
  return v_id;
end $$;

-- Busca en lo que el asistente sabe (lo aprobado por el equipo)
create or replace function public.asistente_buscar(p_consulta text) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_q tsquery;
  v json;
begin
  if (select count(*) from public.asistente_conocimiento where activo) <= 40 or coalesce(trim(p_consulta), '') = '' then
    -- base chica: devuelve todo (es lo más seguro para no perder nada)
    select json_agg(json_build_object('id', id, 'tema', tema, 'pregunta', pregunta, 'respuesta', respuesta) order by tema, id) into v
    from public.asistente_conocimiento where activo;
  else
    select to_tsquery('spanish', string_agg(quote_literal(w) || ':*', ' | ')) into v_q
    from regexp_split_to_table(lower(regexp_replace(p_consulta, '[^[:alnum:][:space:]áéíóúñü]', ' ', 'g')), '\s+') w
    where length(w) >= 3;
    select json_agg(x) into v from (
      select json_build_object('id', id, 'tema', tema, 'pregunta', pregunta, 'respuesta', respuesta) as x
      from public.asistente_conocimiento
      where activo and v_q is not null and to_tsvector('spanish', tema || ' ' || pregunta || ' ' || respuesta) @@ v_q
      order by ts_rank(to_tsvector('spanish', tema || ' ' || pregunta || ' ' || respuesta), v_q) desc limit 12) s;
  end if;
  return coalesce(v, '[]'::json);
end $$;

create or replace function public.asistente_contar_uso(p_ids bigint[]) returns void
language sql security definer set search_path = public as $$
  update public.asistente_conocimiento set usos = usos + 1 where id = any (p_ids)
$$;

-- Consultas del EQUIPO por WhatsApp: corren con el usuario del panel de esa persona
-- (mismos permisos que si entrara al panel)
create or replace function public.asistente_consulta_equipo(p_whatsapp text, p_que text, p_desde date default null, p_hasta date default null)
returns json
language plpgsql security definer set search_path = public as $$
declare
  n public.asistente_numeros;
  v_desde date := coalesce(p_desde, public.hoy_ar());
  v_hasta date := coalesce(p_hasta, p_desde, public.hoy_ar());
begin
  select * into n from public.asistente_numeros where whatsapp = public.solo_numeros(p_whatsapp) and tipo = 'equipo';
  if n.user_id is null then raise exception 'NO_AUTORIZADO' using hint = 'Este número no es del equipo'; end if;
  perform set_config('request.jwt.claim.sub', n.user_id::text, true);
  perform public.exigir_equipo();
  if v_hasta - v_desde > 62 then raise exception 'RANGO' using hint = 'Pedí como mucho dos meses'; end if;
  return case p_que
    when 'agenda' then (
      select coalesce(json_agg(json_build_object('fecha', x.fecha, 'consultorio', x.cons, 'quien', x.nombre, 'tipo', x.tipo, 'estado', x.estado,
                                                 'horas', x.horas, 'pagado', x.pagado) order by x.fecha, x.cons, x.horas[1]), '[]'::json)
      from (select a.fecha, (select nombre from public.consultorios where id = a.consultorio_id) as cons, a.nombre, a.tipo, a.estado,
                   bool_and(a.pagado) as pagado, array_agg(a.hora order by a.hora) as horas
            from public.agenda(v_desde, v_hasta) a
            group by a.fecha, a.consultorio_id, a.nombre, a.tipo, a.estado, coalesce(a.reserva_id, a.fijo_id, a.bloqueo_id)) x)
    when 'libres' then (
      select coalesce(json_agg(json_build_object('fecha', r.fecha, 'turnos_libres', r.libres, 'de', r.total) order by r.fecha), '[]'::json)
      from public.resumen_disponibilidad(v_desde, v_hasta) r)
    when 'alertas_pago' then public.alertas_pago()
    when 'falta_cobrar' then public.pendientes_cobro()::json
    when 'numeros' then public.tablero(v_desde, v_hasta)::json
    when 'pendientes' then json_build_object(
      'solicitudes_de_fijo', (select count(*) from public.fijos where estado = 'solicitud'),
      'comprobantes_para_revisar', (select count(*) from public.comprobantes where estado = 'pendiente'),
      'chats_para_atender', (select count(*) from public.asistente_chats where atender and not simulado),
      'propuestas_del_asistente', (select count(*) from public.asistente_propuestas where estado = 'pendiente'))
    else null end;
end $$;

-- Etapa real: si reservó o pagó lo dice la base, no la IA
create or replace function public.asistente_etapa(p_chat_id bigint) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.asistente_pedidos ap where ap.chat_id = c.id
                 and (exists (select 1 from public.reservas r where r.pedido_id = ap.pedido_id and (r.estado = 'confirmada' or public.monto_pagado_reserva(r.id) > 0))
                      or exists (select 1 from public.fijos f where f.pedido_id = ap.pedido_id and f.estado = 'activo'))) then 'pago'
    when exists (select 1 from public.asistente_pedidos ap where ap.chat_id = c.id
                 and (exists (select 1 from public.reservas r where r.pedido_id = ap.pedido_id and r.estado = 'pendiente')
                      or exists (select 1 from public.fijos f where f.pedido_id = ap.pedido_id and f.estado = 'solicitud'))) then 'reservo'
    else c.etapa end
  from public.asistente_chats c where c.id = p_chat_id
$$;

-- El asistente califica al contacto (precalificación): etapa, qué busca y cuánto vale
create or replace function public.asistente_calificar(
  p_chat_id bigint, p_etapa text, p_interes text default null, p_valor integer default null, p_nota text default null, p_prioridad boolean default null
) returns json
language plpgsql security definer set search_path = public as $$
begin
  if p_etapa not in ('nuevo', 'consulta', 'interesado', 'perdido') then
    raise exception 'ETAPA' using hint = 'Etapas que puede poner el asistente: consulta, interesado o perdido (reservó y pagó salen solos de la base)';
  end if;
  update public.asistente_chats
  set etapa = p_etapa, interes = coalesce(nullif(p_interes, ''), interes), valor_estimado = coalesce(p_valor, valor_estimado),
      nota_crm = coalesce(nullif(left(p_nota, 200), ''), nota_crm), prioridad = coalesce(p_prioridad, prioridad)
  where id = p_chat_id;
  return json_build_object('etapa', public.asistente_etapa(p_chat_id));
end $$;

-- El asistente mandó una foto (queda en el chat)
create or replace function public.asistente_registrar_foto(p_chat_id bigint, p_url text, p_texto text) returns bigint
language sql security definer set search_path = public as $$
  insert into public.asistente_mensajes (chat_id, rol, texto, tipo, media, leido, envio)
  values (p_chat_id, 'asistente', coalesce(p_texto, ''), 'imagen', jsonb_build_object('url', p_url), true, 'enviado')
  returning id
$$;

-- Seguimiento: consultó, se quedó callado y no reservó → el asistente le escribe UNA vez
-- (solo dentro de las 24 hs que deja WhatsApp; nunca si el equipo lo está atendiendo)
create or replace function public.asistente_para_seguir() returns json
language plpgsql security definer set search_path = public as $$
declare v json;
begin
  if public.cfg_texto('asistente_seguimiento') <> 'si' or public.cfg_texto('asistente_activo') <> 'si' then return '[]'::json; end if;
  with candidatos as (
    select c.id from public.asistente_chats c
    where not c.simulado and not c.atender
      and c.etapa in ('consulta', 'interesado')
      and public.asistente_etapa(c.id) in ('consulta', 'interesado')
      and (c.seguimiento_en is null or c.seguimiento_en < now() - interval '3 days')
      and c.ultimo_cliente_en < now() - make_interval(hours => coalesce(public.cfg('asistente_horas_seguimiento'), 3))
      and c.ultimo_cliente_en > now() - interval '22 hours'
      and (c.pausa_hasta is null or c.pausa_hasta < now())
      and (c.procesando_desde is null or c.procesando_desde < now() - interval '3 minutes')
      and (public.cfg_texto('asistente_solo_prueba') <> 'si' or exists (select 1 from public.asistente_numeros n where n.whatsapp = c.whatsapp))
      and (select m.rol from public.asistente_mensajes m where m.chat_id = c.id and m.rol <> 'nota' order by m.id desc limit 1) = 'asistente'
    for update of c skip locked
  ), marcados as (
    update public.asistente_chats c set seguimiento_en = now(), procesando_desde = now()
    from candidatos k where c.id = k.id returning c.id
  ), notas as (
    insert into public.asistente_mensajes (chat_id, rol, texto)
    select id, 'nota', 'SEGUIMIENTO AUTOMÁTICO: la persona consultó y no volvió a escribir. Si tiene sentido, mandale UN mensaje corto y útil '
      || '(revisá que lo que buscaba siga libre y proponé algo concreto). Si no corresponde escribirle (ya dijo que no, se resolvió, '
      || 'o sería insistente), respondé exactamente: NADA'
    from marcados returning chat_id
  )
  select coalesce(json_agg(chat_id), '[]'::json) into v from notas;
  return v;
end $$;

-- Recordatorio de seña: pedidos tomados por el asistente que siguen sin pagar
create or replace function public.asistente_para_recordar() returns json
language plpgsql security definer set search_path = public as $$
declare v json;
begin
  if public.cfg_texto('asistente_recordar_sena') <> 'si' or public.cfg_texto('asistente_activo') <> 'si' then return '[]'::json; end if;
  with candidatos as (
    select ap.pedido_id, ap.chat_id
    from public.asistente_pedidos ap
    join public.asistente_chats c on c.id = ap.chat_id
    where ap.recordatorio_en is null and not c.simulado
      and ap.creado_en < now() - make_interval(mins => public.cfg('asistente_minutos_recordatorio'))
      and c.ultimo_cliente_en > now() - interval '23 hours'           -- WhatsApp deja escribir 24 hs desde su último mensaje
      and (c.pausa_hasta is null or c.pausa_hasta < now())
      and not exists (select 1 from public.comprobantes co where co.pedido_id = ap.pedido_id)
      and exists (select 1 from public.reservas r where r.pedido_id = ap.pedido_id and r.estado = 'pendiente'
                    and r.expira_en > now() + interval '10 minutes' and public.monto_pagado_reserva(r.id) = 0)
    for update of ap skip locked
  ), marcados as (
    update public.asistente_pedidos ap set recordatorio_en = now()
    from candidatos k where ap.pedido_id = k.pedido_id
    returning ap.pedido_id, ap.chat_id
  )
  select coalesce(json_agg(json_build_object('chat_id', m.chat_id, 'whatsapp', c.whatsapp, 'datos', public.datos_pedido(m.pedido_id))), '[]'::json)
  into v
  from marcados m join public.asistente_chats c on c.id = m.chat_id;
  return v;
end $$;

-- Material para la revisión semanal
create or replace function public.asistente_datos_revision(p_desde timestamptz) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'charlas', coalesce((select json_agg(json_build_object('chat', c.id, 'derivado', c.atender, 'motivo', c.motivo_atender,
        'mensajes', (select json_agg(json_build_object('rol', m.rol, 'texto', left(m.texto, 600), 'cuando', m.creado_en) order by m.id)
                     from public.asistente_mensajes m where m.chat_id = c.id and m.creado_en >= p_desde and m.rol <> 'nota'))
        order by c.ultimo_mensaje_en desc)
      from (select * from public.asistente_chats where not simulado and ultimo_mensaje_en >= p_desde order by ultimo_mensaje_en desc limit 80) c), '[]'::json),
    'conocimiento', coalesce((select json_agg(json_build_object('id', id, 'tema', tema, 'pregunta', pregunta, 'respuesta', respuesta, 'usos', usos))
                              from public.asistente_conocimiento where activo), '[]'::json),
    'propuestas_pendientes', coalesce((select json_agg(pregunta) from public.asistente_propuestas where estado = 'pendiente'), '[]'::json),
    'reservas_por_whatsapp', (select count(*) from public.asistente_pedidos where creado_en >= p_desde),
    'ocupacion_proximas_2_semanas', (select json_agg(json_build_object('fecha', fecha, 'libres', libres, 'de', total) order by fecha)
                                     from public.resumen_disponibilidad(public.hoy_ar(), public.hoy_ar() + 14)))
$$;

create or replace function public.asistente_guardar_informe(p_desde date, p_hasta date, p_datos jsonb) returns bigint
language sql security definer set search_path = public as $$
  insert into public.asistente_informes (desde, hasta, datos) values (p_desde, p_hasta, p_datos) returning id
$$;

-- ---------------------------------------------------------------------
-- 5. PANEL (pestaña "Asistente")
-- ---------------------------------------------------------------------

create or replace function public.asistente_panel_chats() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  return coalesce((select json_agg(x order by x.atender desc, x.urgente desc, x.prioridad desc, x.ultimo_mensaje_en desc nulls last) from (
    select c.id, c.whatsapp, c.simulado, c.atender, c.urgente, c.motivo_atender, c.pausa_hasta, c.ultimo_mensaje_en, c.ultimo_cliente_en,
           public.asistente_etapa(c.id) as etapa, c.interes, c.valor_estimado, c.nota_crm, c.prioridad, c.asignado_a,
           (select nombre from public.equipo where user_id = c.asignado_a) as asignado,
           coalesce(pr.nombre, c.nombre_perfil, c.whatsapp) as nombre, pr.id as profesional_id,
           (select left(m.texto, 120) from public.asistente_mensajes m where m.chat_id = c.id and m.rol <> 'nota' order by m.id desc limit 1) as ultimo,
           (select m.rol from public.asistente_mensajes m where m.chat_id = c.id and m.rol <> 'nota' order by m.id desc limit 1) as ultimo_rol,
           exists (select 1 from public.asistente_pedidos ap where ap.chat_id = c.id) as reservo
    from public.asistente_chats c left join public.profesionales pr on pr.id = c.profesional_id
    where not c.simulado or c.whatsapp = 'sim-' || auth.uid()
    order by c.atender desc, c.ultimo_mensaje_en desc nulls last limit 300) x), '[]'::json);
end $$;

create or replace function public.asistente_panel_mensajes(p_chat_id bigint) returns json
language plpgsql stable security definer set search_path = public as $$
declare c public.asistente_chats;
begin
  perform public.exigir_equipo();
  select * into c from public.asistente_chats where id = p_chat_id;
  return json_build_object(
    'mensajes', coalesce((select json_agg(json_build_object('id', m.id, 'rol', m.rol, 'texto', m.texto, 'tipo', m.tipo, 'envio', m.envio,
                                                            'url', m.media->>'url',
                                                            'creado_en', m.creado_en,
                                                            'autor', (select nombre from public.equipo where user_id = m.autor)) order by m.id)
                          from (select * from public.asistente_mensajes where chat_id = p_chat_id order by id desc limit 300) m), '[]'::json),
    'memoria', coalesce((select json_agg(json_build_object('id', id, 'dato', dato, 'creado_en', creado_en) order by id)
                         from public.asistente_memoria where whatsapp = public.asistente_clave_memoria(c.whatsapp)), '[]'::json),
    'pedidos', coalesce((select json_agg(ap.pedido_id order by ap.pedido_id) from public.asistente_pedidos ap where ap.chat_id = p_chat_id), '[]'::json));
end $$;

-- Alguien del equipo contesta en un chat: el asistente se calla un rato
create or replace function public.asistente_panel_responder(p_chat_id bigint, p_texto text) returns json
language plpgsql security definer set search_path = public as $$
declare
  c public.asistente_chats;
  v_id bigint;
begin
  perform public.exigir_equipo();
  if length(trim(coalesce(p_texto, ''))) = 0 then raise exception 'VACIO' using hint = 'Escribí el mensaje'; end if;
  select * into c from public.asistente_chats where id = p_chat_id;
  if not found then raise exception 'NO_ENCONTRADO'; end if;
  insert into public.asistente_mensajes (chat_id, rol, texto, autor) values (c.id, 'equipo', left(p_texto, 4000), auth.uid()) returning id into v_id;
  update public.asistente_chats
  set atender = false, urgente = false, ultimo_mensaje_en = now(),
      pausa_hasta = case when simulado then null else now() + make_interval(mins => public.cfg('asistente_minutos_pausa')) end
  where id = c.id;
  return json_build_object('mensaje_id', v_id, 'whatsapp', c.whatsapp, 'simulado', c.simulado,
                           'ventana_abierta', c.ultimo_cliente_en > now() - interval '24 hours');
end $$;

-- Pausar el asistente en un chat (p_minutos = 0: se lo devuelve al asistente)
create or replace function public.asistente_panel_pausa(p_chat_id bigint, p_minutos integer) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  update public.asistente_chats set pausa_hasta = case when p_minutos > 0 then now() + make_interval(mins => p_minutos) end
  where id = p_chat_id;
end $$;

create or replace function public.asistente_panel_atendido(p_chat_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  update public.asistente_chats set atender = false, urgente = false, motivo_atender = null where id = p_chat_id;
end $$;

-- CRM: asignar el contacto a alguien del equipo (null = nadie)
create or replace function public.asistente_panel_asignar(p_chat_id bigint, p_user_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  if p_user_id is not null and not exists (select 1 from public.equipo where user_id = p_user_id and activo) then
    raise exception 'NO_ENCONTRADO' using hint = 'Esa persona no está en el equipo';
  end if;
  update public.asistente_chats set asignado_a = p_user_id where id = p_chat_id;
end $$;

-- CRM: cambiar la etapa a mano (reservó y pagó salen solos de la base)
create or replace function public.asistente_panel_etapa(p_chat_id bigint, p_etapa text, p_prioridad boolean default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  if p_etapa not in ('nuevo', 'consulta', 'interesado', 'perdido') then
    raise exception 'ETAPA' using hint = 'Reservó y pagó se marcan solos cuando hay un pedido';
  end if;
  update public.asistente_chats set etapa = p_etapa, prioridad = coalesce(p_prioridad, prioridad) where id = p_chat_id;
end $$;

-- El simulador del panel empieza una charla nueva
create or replace function public.asistente_panel_reiniciar_simulador() returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  delete from public.asistente_chats where whatsapp = 'sim-' || auth.uid();
  delete from public.asistente_memoria where whatsapp = 'sim-' || auth.uid();
end $$;

create or replace function public.asistente_panel_borrar_memoria(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  delete from public.asistente_memoria where id = p_id;
end $$;

create or replace function public.asistente_panel_propuestas() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  return coalesce((select json_agg(json_build_object('id', p.id, 'tema', p.tema, 'pregunta', p.pregunta, 'respuesta', p.respuesta,
      'motivo', p.motivo, 'origen', p.origen, 'chat_id', p.chat_id, 'creado_en', p.creado_en,
      'corrige', case when k.id is not null then json_build_object('id', k.id, 'pregunta', k.pregunta, 'respuesta', k.respuesta) end)
      order by p.id)
    from public.asistente_propuestas p left join public.asistente_conocimiento k on k.id = p.conocimiento_id
    where p.estado = 'pendiente'), '[]'::json);
end $$;

-- Aprobar (con o sin cambios) o descartar algo que propuso el asistente
create or replace function public.asistente_panel_resolver(
  p_id bigint, p_aprobar boolean, p_pregunta text default null, p_respuesta text default null, p_tema text default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.asistente_propuestas;
  v_k bigint;
begin
  perform public.exigir_equipo();
  select * into p from public.asistente_propuestas where id = p_id and estado = 'pendiente' for update;
  if not found then raise exception 'NO_ENCONTRADO' using hint = 'Ya la resolvió otra persona'; end if;
  if p_aprobar then
    if p.conocimiento_id is not null then
      update public.asistente_conocimiento
      set pregunta = coalesce(nullif(trim(p_pregunta), ''), p.pregunta), respuesta = coalesce(nullif(trim(p_respuesta), ''), p.respuesta),
          tema = coalesce(nullif(trim(p_tema), ''), p.tema), activo = true, actualizado_en = now()
      where id = p.conocimiento_id returning id into v_k;
    end if;
    if v_k is null then
      insert into public.asistente_conocimiento (tema, pregunta, respuesta, origen, creado_por)
      values (coalesce(nullif(trim(p_tema), ''), p.tema), coalesce(nullif(trim(p_pregunta), ''), p.pregunta),
              coalesce(nullif(trim(p_respuesta), ''), p.respuesta), 'aprendido', auth.uid());
    end if;
  end if;
  update public.asistente_propuestas set estado = case when p_aprobar then 'aprobada' else 'descartada' end,
         revisado_por = auth.uid(), revisado_en = now()
  where id = p_id;
end $$;

-- Cargar o corregir a mano lo que sabe (p_id null = nuevo)
create or replace function public.asistente_panel_guardar_saber(
  p_id bigint, p_tema text, p_pregunta text, p_respuesta text, p_activo boolean default true
) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform public.exigir_equipo();
  if length(trim(coalesce(p_pregunta, ''))) < 3 or length(trim(coalesce(p_respuesta, ''))) < 2 then
    raise exception 'INCOMPLETO' using hint = 'Completá la pregunta y la respuesta';
  end if;
  if p_id is null then
    insert into public.asistente_conocimiento (tema, pregunta, respuesta, activo, creado_por)
    values (coalesce(nullif(trim(p_tema), ''), 'General'), trim(p_pregunta), trim(p_respuesta), coalesce(p_activo, true), auth.uid())
    returning id into v_id;
  else
    update public.asistente_conocimiento
    set tema = coalesce(nullif(trim(p_tema), ''), 'General'), pregunta = trim(p_pregunta), respuesta = trim(p_respuesta),
        activo = coalesce(p_activo, true), actualizado_en = now()
    where id = p_id returning id into v_id;
  end if;
  return v_id;
end $$;

create or replace function public.asistente_panel_borrar_saber(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  delete from public.asistente_conocimiento where id = p_id;
end $$;

-- Números de prueba y del equipo (solo administradores: un número del equipo puede pedir datos del panel)
create or replace function public.asistente_panel_guardar_numero(p_whatsapp text, p_tipo text, p_nombre text, p_user_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare v_tel text := public.whatsapp_internacional(p_whatsapp);
begin
  perform public.exigir_admin();
  if length(public.solo_numeros(p_whatsapp)) < 10 then
    raise exception 'WHATSAPP_INVALIDO' using hint = 'Escribí el número con código de área, ej: 11 2345 6789';
  end if;
  if p_tipo = 'equipo' and not exists (select 1 from public.equipo where user_id = p_user_id and activo) then
    raise exception 'FALTA_PERSONA' using hint = 'Elegí de quién del equipo es el número';
  end if;
  insert into public.asistente_numeros (whatsapp, tipo, nombre, user_id)
  values (v_tel, p_tipo, nullif(trim(p_nombre), ''), case when p_tipo = 'equipo' then p_user_id end)
  on conflict (whatsapp) do update set tipo = excluded.tipo, nombre = excluded.nombre, user_id = excluded.user_id;
end $$;

create or replace function public.asistente_panel_borrar_numero(p_whatsapp text) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  delete from public.asistente_numeros where whatsapp = p_whatsapp;
end $$;

-- Números del asistente para la pestaña
create or replace function public.asistente_panel_resumen(p_desde date, p_hasta date) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_ini timestamptz := (p_desde::timestamp at time zone 'America/Argentina/Buenos_Aires');
  v_fin timestamptz := ((p_hasta + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires');
begin
  perform public.exigir_equipo();
  return json_build_object(
    'charlas', (select count(distinct m.chat_id) from public.asistente_mensajes m join public.asistente_chats c on c.id = m.chat_id
                where not c.simulado and m.rol = 'cliente' and m.creado_en >= v_ini and m.creado_en < v_fin),
    'mensajes_recibidos', (select count(*) from public.asistente_mensajes m join public.asistente_chats c on c.id = m.chat_id
                           where not c.simulado and m.rol = 'cliente' and m.creado_en >= v_ini and m.creado_en < v_fin),
    'respuestas_asistente', (select count(*) from public.asistente_mensajes m join public.asistente_chats c on c.id = m.chat_id
                             where not c.simulado and m.rol = 'asistente' and m.creado_en >= v_ini and m.creado_en < v_fin),
    'respuestas_equipo', (select count(*) from public.asistente_mensajes m join public.asistente_chats c on c.id = m.chat_id
                          where not c.simulado and m.rol = 'equipo' and m.creado_en >= v_ini and m.creado_en < v_fin),
    'pedidos', (select count(*) from public.asistente_pedidos where creado_en >= v_ini and creado_en < v_fin),
    'pedidos_confirmados', (select count(*) from public.asistente_pedidos ap where ap.creado_en >= v_ini and ap.creado_en < v_fin
                            and (exists (select 1 from public.reservas r where r.pedido_id = ap.pedido_id and r.estado = 'confirmada')
                                 or exists (select 1 from public.fijos f where f.pedido_id = ap.pedido_id and f.estado = 'activo'))),
    'monto_reservado', coalesce((select sum(r.precio_total) from public.asistente_pedidos ap join public.reservas r on r.pedido_id = ap.pedido_id
                                 where ap.creado_en >= v_ini and ap.creado_en < v_fin and r.estado = 'confirmada'), 0),
    'embudo', (select json_object_agg(e, n) from (
        select public.asistente_etapa(c.id) as e, count(*) as n from public.asistente_chats c
        where not c.simulado and c.ultimo_mensaje_en >= v_ini and c.creado_en < v_fin group by 1) x),
    'respuesta_segundos', (select json_build_object(
        'asistente', percentile_cont(0.5) within group (order by seg) filter (where quien = 'asistente'),
        'equipo', percentile_cont(0.5) within group (order by seg) filter (where quien = 'equipo'))
      from (select r.rol as quien, extract(epoch from r.creado_en - m.creado_en) as seg
            from public.asistente_mensajes m
            join public.asistente_chats c on c.id = m.chat_id and not c.simulado
            cross join lateral (select x.rol, x.creado_en from public.asistente_mensajes x
                                where x.chat_id = m.chat_id and x.id > m.id and x.rol in ('asistente', 'equipo') order by x.id limit 1) r
            where m.rol = 'cliente' and m.creado_en >= v_ini and m.creado_en < v_fin
              and not exists (select 1 from public.asistente_mensajes p where p.chat_id = m.chat_id and p.id < m.id and p.id > coalesce(
                    (select max(q.id) from public.asistente_mensajes q where q.chat_id = m.chat_id and q.id < m.id and q.rol in ('asistente', 'equipo')), 0)
                    and p.rol = 'cliente')) t),
    'oportunidades', coalesce((select json_agg(json_build_object('id', c.id, 'nombre', coalesce(pr.nombre, c.nombre_perfil, c.whatsapp),
        'etapa', public.asistente_etapa(c.id), 'interes', c.interes, 'valor_estimado', c.valor_estimado, 'nota', c.nota_crm,
        'ultimo_mensaje_en', c.ultimo_mensaje_en) order by c.prioridad desc, c.valor_estimado desc nulls last, c.ultimo_mensaje_en desc)
      from public.asistente_chats c left join public.profesionales pr on pr.id = c.profesional_id
      where not c.simulado and c.etapa = 'interesado' and public.asistente_etapa(c.id) = 'interesado'
        and c.ultimo_mensaje_en > now() - interval '14 days'), '[]'::json),
    'para_atender', (select count(*) from public.asistente_chats where atender and not simulado),
    'propuestas', (select count(*) from public.asistente_propuestas where estado = 'pendiente'),
    'tokens', (select json_build_object('entrada', coalesce(sum((m.uso->>'input_tokens')::bigint + coalesce((m.uso->>'cache_read_input_tokens')::bigint, 0)
                                                                + coalesce((m.uso->>'cache_creation_input_tokens')::bigint, 0)), 0),
                                        'salida', coalesce(sum((m.uso->>'output_tokens')::bigint), 0))
               from public.asistente_mensajes m where m.uso is not null and m.creado_en >= v_ini and m.creado_en < v_fin));
end $$;

-- Para el número rojo de la pestaña
create or replace function public.asistente_panel_badge() returns integer
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_equipo() then return 0; end if;
  return (select count(*) from public.asistente_chats where atender and not simulado)
       + (select count(*) from public.asistente_propuestas where estado = 'pendiente');
end $$;

-- ---------------------------------------------------------------------
-- 6. LO QUE SABE DE ENTRADA (el equipo lo corrige o completa desde el panel)
-- ---------------------------------------------------------------------
insert into public.asistente_conocimiento (tema, pregunta, respuesta, origen)
select * from (values
  ('El espacio', '¿Dónde están?', 'Estamos en pleno Microcentro, Buenos Aires. La dirección exacta se la pasamos al confirmar la reserva.', 'inicial'),
  ('El espacio', '¿Cómo son los consultorios?', 'Son amplios y luminosos, todos con aire acondicionado. Hay 5 consultorios y un Salón para grupos, talleres y supervisiones. El 3 tiene sofá, sillones y ventanales; el 4, sillones enfrentados; el 1, escritorio y sillas. Hay recepción y sala de espera. En la web están las fotos de cada uno.', 'inicial'),
  ('El espacio', '¿Qué incluye?', 'Wifi de alta velocidad, aire acondicionado, recepción y sala de espera, y café y snacks para vos. Sin contratos ni costos ocultos.', 'inicial'),
  ('El espacio', '¿Están habilitados?', 'Sí: están habilitados por el Ministerio de Salud y para obras sociales.', 'inicial'),
  ('El espacio', '¿Quiénes atienden el espacio?', 'Está atendido por sus dueños. Hace más de 15 años que alquilamos consultorios a profesionales de la salud en el Microcentro.', 'inicial'),
  ('El espacio', '¿Hacen derivación de pacientes?', 'Sí, hay derivación de pacientes: lo coordina el equipo directamente (derivar a una persona del equipo).', 'inicial'),
  ('Reservas', '¿Cómo reservo?', 'Por acá mismo: decime qué día, horario y si preferís algún consultorio, y te lo reservo. También se puede desde la web, en 2 minutos. Se pide nombre, profesión, celular y mail (los recordamos para la próxima).', 'inicial'),
  ('Reservas', '¿Cómo se confirma una reserva por horas?', 'Los horarios quedan guardados mientras se paga la seña (50% del total). Se paga por transferencia (y se manda la captura del comprobante por este chat) o por Mercado Pago si está disponible. El saldo se paga hasta el día anterior a cada turno.', 'inicial'),
  ('Reservas', '¿Qué pasa si no pago la seña a tiempo?', 'Si la seña no llega en el plazo, los horarios se liberan solos y otra persona los puede tomar. Si avisás que transferís más tarde, el equipo puede darte un rato más.', 'inicial'),
  ('Horario fijo', '¿Qué es el horario fijo?', 'Es el mismo día y horario todas las semanas, con precio preferencial. Por la mañana desde 1 hora; por la tarde (desde las 13 hs) mínimo 2 horas seguidas. Se confirma pagando el primer mes y después se paga mes a mes por adelantado.', 'inicial'),
  ('Cancelaciones', '¿Puedo cancelar o cambiar una reserva?', 'Si todavía no pagaste nada, se puede cancelar y volver a reservar. Si ya pagaste algo (seña o comprobante enviado), lo ve el equipo: te paso con ellos.', 'inicial')
) v(tema, pregunta, respuesta, origen)
where not exists (select 1 from public.asistente_conocimiento);

-- ---------------------------------------------------------------------
-- 7. TAREAS AUTOMÁTICAS (pg_cron + pg_net, solo en Supabase)
--    Necesitan en ajustes_privados: url_asistente y secreto_asistente (ver docs)
--    · cada 5 minutos: recordatorios de seña y seguimientos
--    · lunes 9:00 (hora Argentina): revisión semanal del asistente
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net')
     and exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname in ('psicostudios-asistente-recordatorios', 'psicostudios-asistente-revision');
    perform cron.schedule('psicostudios-asistente-recordatorios', '*/5 * * * *', $cron$
      select net.http_post(
        url := (select valor from public.ajustes_privados where clave = 'url_asistente'),
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-asistente-secreto', (select valor from public.ajustes_privados where clave = 'secreto_asistente')),
        body := '{"accion":"recordatorios"}'::jsonb)
      where exists (select 1 from public.ajustes_privados where clave = 'url_asistente')
        and (exists (select 1 from public.asistente_pedidos where recordatorio_en is null and creado_en > now() - interval '1 day')
             or exists (select 1 from public.asistente_chats where etapa in ('consulta', 'interesado') and ultimo_cliente_en > now() - interval '1 day'))
    $cron$);
    perform cron.schedule('psicostudios-asistente-revision', '0 12 * * 1', $cron$
      select net.http_post(
        url := (select valor from public.ajustes_privados where clave = 'url_asistente'),
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-asistente-secreto', (select valor from public.ajustes_privados where clave = 'secreto_asistente')),
        body := '{"accion":"revision"}'::jsonb,
        timeout_milliseconds := 120000)
      where exists (select 1 from public.ajustes_privados where clave = 'url_asistente')
    $cron$);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. PERMISOS: el servidor usa las funciones internas; el panel, las de "panel"
-- ---------------------------------------------------------------------
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as firma, p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.proname like 'asistente\_%' loop
    execute format('revoke execute on function %s from public, anon, authenticated', f.firma);
    if f.proname like 'asistente\_panel\_%' then
      execute format('grant execute on function %s to authenticated', f.firma);
    else
      execute format('grant execute on function %s to service_role', f.firma);
    end if;
  end loop;
end $$;

select 'Asistente de WhatsApp instalado (apagado y en modo prueba)' as resultado;

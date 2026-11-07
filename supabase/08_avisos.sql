-- =====================================================================
-- PSICOSTUDIOS · 08_avisos.sql
-- Avisos automáticos por MAIL y WHATSAPP al profesional (y al equipo).
--   · Cada cambio importante deja un aviso en una "cola" (tabla avisos).
--   · La función del servidor "enviar-avisos" (cada minuto) los manda y anota
--     si salieron bien. Un aviso nunca se manda dos veces.
--   · Mail y WhatsApp se prenden por separado desde el panel → Precios y ajustes
--     (arrancan APAGADOS hasta configurar las cuentas: ver README).
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Requiere 01 a 07. Se puede correr más de una vez.
-- =====================================================================

insert into public.config (clave, valor, descripcion) values
  ('avisos_email_activo',    'no', 'si = se mandan los avisos por mail'),
  ('avisos_whatsapp_activo', 'no', 'si = se mandan los avisos por WhatsApp (requiere la API de WhatsApp Business)'),
  ('email_equipo', 'COMPLETAR', 'Mail del equipo: recibe aviso de cada reserva, comprobante y solicitud de fijo')
on conflict (clave) do nothing;

-- El mail del equipo recibe datos de los profesionales: también queda protegido
-- (solo se cambia desde el SQL Editor, como alias/CVU/titular/WhatsApp)
create or replace function public.config_protegida(p_clave text) returns boolean
language sql immutable set search_path = public as $$
  select p_clave in ('alias_transferencia', 'cvu_transferencia', 'titular_transferencia', 'whatsapp_contacto', 'email_equipo')
$$;

-- Datos privados del servidor (NO los puede leer la web ni el panel)
create table if not exists public.ajustes_privados (
  clave text primary key,
  valor text not null
);
alter table public.ajustes_privados enable row level security;
revoke all on public.ajustes_privados from anon, authenticated;

-- ---------------------------------------------------------------------
-- 1. La cola de avisos
-- ---------------------------------------------------------------------
create table if not exists public.avisos (
  id bigint generated always as identity primary key,
  clave text not null unique,          -- evita duplicados: tipo:canal:objeto
  tipo text not null,
  canal text not null check (canal in ('email', 'whatsapp')),
  destino text not null,
  pedido_id bigint references public.pedidos (id),
  reserva_id bigint references public.reservas (id),
  fijo_id bigint references public.fijos (id),
  datos jsonb not null default '{}'::jsonb,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'enviado', 'error')),
  intentos integer not null default 0,
  ultimo_error text,
  creado_en timestamptz not null default now(),
  tomado_en timestamptz,
  enviado_en timestamptz
);
create index if not exists avisos_estado on public.avisos (estado, id);
alter table public.avisos enable row level security;
drop policy if exists "equipo lee avisos" on public.avisos;
create policy "equipo lee avisos" on public.avisos for select to authenticated using (public.es_equipo());
revoke all on public.avisos from anon, authenticated;
grant select on public.avisos to authenticated;

-- Número de WhatsApp en formato internacional (54 9 + área + número)
create or replace function public.whatsapp_internacional(p text) returns text
language sql immutable set search_path = public as $$
  select case when public.solo_numeros(p) like '54%' then public.solo_numeros(p)
              else '549' || ltrim(public.solo_numeros(p), '0') end
$$;

-- Datos de transferencia que van en los avisos
create or replace function public.datos_transferencia() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('alias', public.cfg_texto('alias_transferencia'), 'cvu', public.cfg_texto('cvu_transferencia'),
                            'titular', public.cfg_texto('titular_transferencia'), 'whatsapp', public.cfg_texto('whatsapp_contacto'))
$$;

-- Foto del pedido en el momento del aviso
create or replace function public.datos_pedido(p_pedido_id bigint) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
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
  group by pe.id, pr.nombre
$$;

-- Deja el aviso en la cola por cada canal prendido (y copia al equipo si corresponde)
create or replace function public.encolar_aviso(
  p_tipo text, p_objeto text, p_profesional_id bigint, p_datos jsonb,
  p_pedido_id bigint default null, p_reserva_id bigint default null, p_fijo_id bigint default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  p public.profesionales;
  v_equipo text := public.cfg_texto('email_equipo');
begin
  select * into p from public.profesionales where id = p_profesional_id;
  if public.cfg_texto('avisos_email_activo') = 'si' and p.email is not null then
    insert into public.avisos (clave, tipo, canal, destino, pedido_id, reserva_id, fijo_id, datos)
    values (p_tipo || ':email:' || p_objeto, p_tipo, 'email', p.email, p_pedido_id, p_reserva_id, p_fijo_id, p_datos)
    on conflict (clave) do nothing;
  end if;
  if public.cfg_texto('avisos_whatsapp_activo') = 'si' and length(public.solo_numeros(p.whatsapp)) >= 8 then
    insert into public.avisos (clave, tipo, canal, destino, pedido_id, reserva_id, fijo_id, datos)
    values (p_tipo || ':whatsapp:' || p_objeto, p_tipo, 'whatsapp', public.whatsapp_internacional(p.whatsapp),
            p_pedido_id, p_reserva_id, p_fijo_id, p_datos)
    on conflict (clave) do nothing;
  end if;
  -- copia al equipo (solo mail) de lo que hay que atender
  if p_tipo in ('reserva_creada', 'comprobante_recibido', 'fijo_solicitado')
     and public.cfg_texto('avisos_email_activo') = 'si' and v_equipo like '%@%' then
    insert into public.avisos (clave, tipo, canal, destino, pedido_id, reserva_id, fijo_id, datos)
    values ('equipo_' || p_tipo || ':email:' || p_objeto, 'equipo_' || p_tipo, 'email', v_equipo,
            p_pedido_id, p_reserva_id, p_fijo_id,
            p_datos || jsonb_build_object('profesional', jsonb_build_object('nombre', p.nombre, 'whatsapp', p.whatsapp,
                                                                           'email', p.email, 'profesion', p.profesion)))
    on conflict (clave) do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 2. Qué genera un aviso (se evalúa al confirmar cada operación)
-- ---------------------------------------------------------------------

-- Pedido nuevo desde la web → "recibimos tu reserva"
create or replace function public.aviso_pedido_nuevo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.origen = 'web' then
    perform public.encolar_aviso('reserva_creada', 'pedido:' || new.id, new.profesional_id, public.datos_pedido(new.id), new.id);
  end if;
  return null;
end $$;
drop trigger if exists aviso_pedido_nuevo on public.pedidos;
create constraint trigger aviso_pedido_nuevo after insert on public.pedidos
  deferrable initially deferred for each row execute function public.aviso_pedido_nuevo();

-- Cambios de estado de las reservas
create or replace function public.aviso_reserva_estado() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'cancelada' then
    perform public.encolar_aviso('reserva_cancelada', 'reserva:' || new.id, new.profesional_id,
      jsonb_build_object('nombre', (select nombre from public.profesionales where id = new.profesional_id),
                         'fecha', new.fecha, 'horas', new.horas, 'motivo', new.motivo_cancelacion,
                         'consultorio', (select nombre from public.consultorios where id = new.consultorio_id),
                         'pedido', new.pedido_id),
      new.pedido_id, new.id);
  elsif new.pedido_id is not null and new.estado = 'confirmada'
        and not exists (select 1 from public.reservas where pedido_id = new.pedido_id and estado = 'pendiente') then
    -- todo el pedido quedó confirmado (un solo aviso aunque sean varios días)
    perform public.encolar_aviso('reserva_confirmada', 'pedido:' || new.pedido_id, new.profesional_id,
      public.datos_pedido(new.pedido_id), new.pedido_id);
  elsif new.pedido_id is not null and new.estado = 'vencida'
        and not exists (select 1 from public.reservas where pedido_id = new.pedido_id and estado in ('pendiente', 'confirmada')) then
    perform public.encolar_aviso('reserva_vencida', 'pedido:' || new.pedido_id, new.profesional_id,
      public.datos_pedido(new.pedido_id), new.pedido_id);
  end if;
  return null;
end $$;
drop trigger if exists aviso_reserva_estado on public.reservas;
create constraint trigger aviso_reserva_estado after update of estado on public.reservas
  deferrable initially deferred for each row
  when (old.estado is distinct from new.estado)
  execute function public.aviso_reserva_estado();

-- Comprobantes
create or replace function public.aviso_comprobante() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_prof bigint := (select profesional_id from public.pedidos where id = new.pedido_id);
begin
  if tg_op = 'INSERT' then
    perform public.encolar_aviso('comprobante_recibido', 'comprobante:' || new.id, v_prof,
      public.datos_pedido(new.pedido_id), new.pedido_id);
  elsif new.estado = 'rechazado' and old.estado = 'pendiente' then
    perform public.encolar_aviso('comprobante_rechazado', 'comprobante:' || new.id, v_prof,
      public.datos_pedido(new.pedido_id) || jsonb_build_object('motivo', new.nota), new.pedido_id);
  end if;
  return null;
end $$;
drop trigger if exists aviso_comprobante on public.comprobantes;
create constraint trigger aviso_comprobante after insert or update on public.comprobantes
  deferrable initially deferred for each row execute function public.aviso_comprobante();

-- Horario fijo: solicitud, aprobado, rechazado
create or replace function public.aviso_fijo() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_datos jsonb := jsonb_build_object(
    'nombre', (select nombre from public.profesionales where id = new.profesional_id),
    'dia', new.dia_semana, 'horas', new.horas, 'desde', new.desde, 'precio_semanal', new.precio_semanal,
    'consultorio', (select nombre from public.consultorios where id = new.consultorio_id), 'fijo', new.id);
begin
  if tg_op = 'INSERT' and new.estado = 'solicitud' and new.origen = 'web' then
    perform public.encolar_aviso('fijo_solicitado', 'fijo:' || new.id, new.profesional_id, v_datos, null, null, new.id);
  elsif tg_op = 'UPDATE' and old.estado = 'solicitud' and new.estado = 'activo' then
    perform public.encolar_aviso('fijo_aprobado', 'fijo:' || new.id, new.profesional_id, v_datos, null, null, new.id);
  elsif tg_op = 'UPDATE' and old.estado = 'solicitud' and new.estado = 'rechazado' then
    perform public.encolar_aviso('fijo_rechazado', 'fijo:' || new.id, new.profesional_id, v_datos, null, null, new.id);
  end if;
  return null;
end $$;
drop trigger if exists aviso_fijo on public.fijos;
create constraint trigger aviso_fijo after insert or update on public.fijos
  deferrable initially deferred for each row execute function public.aviso_fijo();

-- ---------------------------------------------------------------------
-- 3. Para la función del servidor "enviar-avisos"
-- ---------------------------------------------------------------------

-- Toma un lote de avisos para mandar (los que fallaron se reintentan hasta 3 veces)
create or replace function public.tomar_avisos(p_limite integer default 20) returns json
language plpgsql security definer set search_path = public as $$
declare
  v json;
begin
  with lote as (
    select id from public.avisos
    where estado = 'pendiente'
       or (estado = 'error' and intentos < 3 and creado_en > now() - interval '2 days')
       or (estado = 'enviando' and tomado_en < now() - interval '10 minutes')
    order by id
    limit least(greatest(p_limite, 1), 50)
    for update skip locked
  ), tomados as (
    update public.avisos a set estado = 'enviando', intentos = a.intentos + 1, tomado_en = now()
    from lote where a.id = lote.id
    returning a.id, a.tipo, a.canal, a.destino, a.datos
  )
  select coalesce(json_agg(t order by t.id), '[]'::json) into v from tomados t;
  return v;
end $$;

create or replace function public.resultado_aviso(p_id bigint, p_ok boolean, p_error text default null) returns void
language sql security definer set search_path = public as $$
  update public.avisos
  set estado = case when p_ok then 'enviado' else 'error' end,
      enviado_en = case when p_ok then now() end,
      ultimo_error = case when p_ok then null else left(p_error, 500) end
  where id = p_id and estado = 'enviando'
$$;

-- Para el equipo: avisos de un pedido (en el panel)
create or replace function public.avisos_de_pedido(p_pedido_id bigint) returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  return coalesce((select json_agg(json_build_object('tipo', tipo, 'canal', canal, 'estado', estado, 'creado_en', creado_en,
                                                     'enviado_en', enviado_en, 'error', ultimo_error) order by id)
                   from public.avisos where pedido_id = p_pedido_id and tipo not like 'equipo_%'), '[]'::json);
end $$;

-- ---------------------------------------------------------------------
-- 4. Envío automático cada minuto (pg_cron + pg_net, solo en Supabase)
--    Necesita en ajustes_privados: url_enviar_avisos y secreto_avisos (README)
-- ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net')
     and exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_net;
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname = 'psicostudios-enviar-avisos';
    perform cron.schedule('psicostudios-enviar-avisos', '* * * * *', $cron$
      select net.http_post(
        url := (select valor from public.ajustes_privados where clave = 'url_enviar_avisos'),
        headers := jsonb_build_object('Content-Type', 'application/json',
                                      'x-avisos-secreto', (select valor from public.ajustes_privados where clave = 'secreto_avisos')),
        body := '{}'::jsonb)
      where exists (select 1 from public.avisos where estado in ('pendiente', 'error', 'enviando'))
        and exists (select 1 from public.ajustes_privados where clave = 'url_enviar_avisos')
    $cron$);
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function public.whatsapp_internacional(text)                                        from public, anon, authenticated;
revoke execute on function public.datos_transferencia()                                               from public, anon, authenticated;
revoke execute on function public.datos_pedido(bigint)                                                from public, anon, authenticated;
revoke execute on function public.encolar_aviso(text, text, bigint, jsonb, bigint, bigint, bigint)    from public, anon, authenticated;
revoke execute on function public.tomar_avisos(integer)                                               from public, anon, authenticated;
revoke execute on function public.resultado_aviso(bigint, boolean, text)                              from public, anon, authenticated;
revoke execute on function public.avisos_de_pedido(bigint)                                            from public, anon, authenticated;
grant execute on function public.tomar_avisos(integer)                                                to service_role;
grant execute on function public.resultado_aviso(bigint, boolean, text)                               to service_role;
grant execute on function public.avisos_de_pedido(bigint)                                             to authenticated;
grant execute on function public.config_protegida(text)                                               to anon, authenticated, service_role;

select 'Avisos listos (apagados hasta configurar el mail / WhatsApp)' as resultado;

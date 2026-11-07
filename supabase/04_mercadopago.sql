-- =====================================================================
-- PSICOSTUDIOS · 04_mercadopago.sql
-- Pago de la seña con Mercado Pago. Cuando Mercado Pago avisa que el pago
-- se aprobó, la reserva queda CONFIRMADA sola, sin cargarla a mano.
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Requiere haber corrido antes 01, 02 y 03. Se puede correr más de una vez.
-- Mercado Pago arranca APAGADO: se prende desde el panel cuando esté
-- todo configurado (README, sección Mercado Pago).
-- =====================================================================

insert into public.config (clave, valor, descripcion) values
  ('mercadopago_activo', 'no', 'si = la web ofrece pagar la seña con Mercado Pago'),
  ('cvu_transferencia', 'COMPLETAR', 'CVU o CBU para transferir la seña (se muestra en la web)')
on conflict (clave) do nothing;

-- Cada reserva tiene un código secreto: sin él nadie puede ver ni pagar
-- una reserva ajena (los números de reserva son fáciles de adivinar).
alter table public.reservas add column if not exists token_pago uuid not null default gen_random_uuid();

-- Número de pago de Mercado Pago: evita registrar dos veces el mismo pago
alter table public.pagos add column if not exists mp_payment_id text;
create unique index if not exists pagos_mp_payment_id_unico on public.pagos (mp_payment_id) where mp_payment_id is not null;

-- Pagos que entraron pero no se pudieron aplicar (ej: la reserva ya había
-- vencido y otra persona tomó el horario). El equipo decide: devolver o reubicar.
create table if not exists public.pagos_a_revisar (
  id bigint generated always as identity primary key,
  reserva_id bigint references public.reservas (id),
  mp_payment_id text not null unique,
  monto integer not null,
  motivo text not null,
  resuelto boolean not null default false,
  resuelto_por uuid,
  resuelto_en timestamptz,
  nota text,
  creado_en timestamptz not null default now()
);
alter table public.pagos_a_revisar enable row level security;
drop policy if exists "equipo lee pagos a revisar" on public.pagos_a_revisar;
create policy "equipo lee pagos a revisar" on public.pagos_a_revisar for select to authenticated using (public.es_equipo());
revoke all on public.pagos_a_revisar from anon, authenticated;
grant select on public.pagos_a_revisar to authenticated;

drop trigger if exists historial_pagos_a_revisar on public.pagos_a_revisar;
create trigger historial_pagos_a_revisar after insert or update on public.pagos_a_revisar
  for each row execute function public.registrar_historial();

-- ---------------------------------------------------------------------
-- La web recibe el código secreto al crear la reserva
-- (misma función que en 03, solo cambia lo que devuelve al final)
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
  v_token uuid;
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

-- ---------------------------------------------------------------------
-- Para la web: estado de una reserva (solo con su código secreto).
-- Se usa al volver de Mercado Pago. No devuelve nombres ni teléfonos.
-- ---------------------------------------------------------------------
create or replace function public.estado_pago_reserva(p_reserva_id bigint, p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  r public.reservas;
begin
  select * into r from public.reservas where id = p_reserva_id and token_pago = p_token;
  if not found then raise exception 'NO_ENCONTRADO' using hint = 'No encontramos esa reserva'; end if;
  return json_build_object(
    'id', r.id, 'estado', r.estado, 'fecha', r.fecha, 'horas', r.horas,
    'consultorio', (select nombre from public.consultorios where id = r.consultorio_id),
    'total', r.precio_total, 'pagado', public.monto_pagado_reserva(r.id),
    'sena', public.sena_minima(r.precio_total), 'expira_en', r.expira_en);
end $$;

-- ---------------------------------------------------------------------
-- Para el servidor (función "mp-crear-pago"): cuánto cobrar.
-- El monto SIEMPRE lo calcula la base, nunca la web.
-- ---------------------------------------------------------------------
create or replace function public.preparar_pago_mp(p_reserva_id bigint, p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  r public.reservas;
  v_monto integer;
begin
  if coalesce(public.cfg_texto('mercadopago_activo'), 'no') <> 'si' then
    raise exception 'MP_APAGADO' using hint = 'El pago online no está disponible. Transferí al alias.';
  end if;
  select * into r from public.reservas where id = p_reserva_id and token_pago = p_token;
  if not found then raise exception 'NO_ENCONTRADO' using hint = 'No encontramos esa reserva'; end if;
  if r.estado = 'confirmada' then
    raise exception 'YA_CONFIRMADA' using hint = 'Esta reserva ya tiene la seña paga.';
  end if;
  if r.estado <> 'pendiente' or (r.expira_en is not null and r.expira_en < now() + interval '2 minutes') then
    raise exception 'RESERVA_NO_VIGENTE' using hint = 'Se venció el tiempo para pagar y el horario se liberó. Hacé una reserva nueva.';
  end if;
  v_monto := public.sena_minima(r.precio_total) - public.monto_pagado_reserva(r.id);
  if v_monto <= 0 then
    raise exception 'YA_CONFIRMADA' using hint = 'Esta reserva ya tiene la seña paga.';
  end if;
  return json_build_object(
    'id', r.id,
    'monto', v_monto,
    'expira_en', r.expira_en,
    'descripcion', format('Seña reserva #%s · %s · %s %s a %s hs', r.id,
      (select nombre from public.consultorios where id = r.consultorio_id),
      to_char(r.fecha, 'DD/MM'), (select min(h) from unnest(r.horas) h),
      (select max(h) + 1 from unnest(r.horas) h)));
end $$;

-- ---------------------------------------------------------------------
-- Para el servidor (función "mp-webhook"): Mercado Pago avisó un pago aprobado.
-- Devuelve: CONFIRMADA, PAGO_PARCIAL, YA_REGISTRADO o A_REVISAR.
-- Nunca da error por un caso de negocio: si da error, Mercado Pago reintenta.
-- ---------------------------------------------------------------------
create or replace function public.registrar_pago_mp(p_reserva_id bigint, p_mp_payment_id text, p_monto integer)
returns text
language plpgsql security definer set search_path = public as $$
declare
  r public.reservas;
  v_pagado integer;
  v_minima smallint;
begin
  if exists (select 1 from public.pagos where mp_payment_id = p_mp_payment_id)
     or exists (select 1 from public.pagos_a_revisar where mp_payment_id = p_mp_payment_id) then
    return 'YA_REGISTRADO';
  end if;

  select * into r from public.reservas where id = p_reserva_id for update;
  if not found then
    insert into public.pagos_a_revisar (reserva_id, mp_payment_id, monto, motivo)
    values (null, p_mp_payment_id, p_monto, format('Pago para la reserva #%s, que no existe', p_reserva_id));
    return 'A_REVISAR';
  end if;

  -- Pagó tarde: si el horario sigue libre y no pasó, se recupera la reserva
  if r.estado in ('vencida', 'cancelada') then
    select min(h) into v_minima from unnest(r.horas) h;
    if r.estado = 'vencida' and public.libre(r.consultorio_id, r.fecha, r.horas)
       and (r.fecha > public.hoy_ar() or (r.fecha = public.hoy_ar() and v_minima > extract(hour from public.ahora_ar()))) then
      begin
        insert into public.ocupaciones (consultorio_id, fecha, hora, reserva_id)
        select r.consultorio_id, r.fecha, h, r.id from unnest(r.horas) h;
        update public.reservas set estado = 'pendiente', expira_en = null where id = r.id;
        r.estado := 'pendiente';
      exception when unique_violation then
        null;  -- alguien lo tomó justo ahora: queda a revisar
      end;
    end if;
    if r.estado <> 'pendiente' then
      insert into public.pagos_a_revisar (reserva_id, mp_payment_id, monto, motivo)
      values (r.id, p_mp_payment_id, p_monto,
              case when r.estado = 'cancelada' then 'Pagó una reserva que estaba cancelada'
                   else 'Pagó después del vencimiento y el horario ya no está libre' end);
      return 'A_REVISAR';
    end if;
  end if;

  v_pagado := public.monto_pagado_reserva(r.id);
  if v_pagado + p_monto > r.precio_total then
    insert into public.pagos_a_revisar (reserva_id, mp_payment_id, monto, motivo)
    values (r.id, p_mp_payment_id, p_monto, format('Pagó $%s pero el saldo era $%s', p_monto, r.precio_total - v_pagado));
    return 'A_REVISAR';
  end if;

  insert into public.pagos (reserva_id, monto, medio, mp_payment_id)
  values (r.id, p_monto, 'mercadopago', p_mp_payment_id);

  if v_pagado + p_monto >= public.sena_minima(r.precio_total) then
    update public.reservas set estado = 'confirmada', expira_en = null where id = r.id;
    return 'CONFIRMADA';
  end if;
  return 'PAGO_PARCIAL';
end $$;

-- Panel: marcar un pago a revisar como resuelto (devuelto o reubicado)
create or replace function public.resolver_pago_revisar(p_id bigint, p_nota text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  update public.pagos_a_revisar
  set resuelto = true, resuelto_por = auth.uid(), resuelto_en = now(), nota = p_nota
  where id = p_id and not resuelto;
  if not found then raise exception 'NO_ENCONTRADO' using hint = 'Ya estaba resuelto'; end if;
end $$;

-- ---------------------------------------------------------------------
-- PROTECCIÓN DE LOS DATOS DE COBRO
-- Alias, CVU, titular y WhatsApp NO se pueden cambiar desde el panel ni
-- desde la web: solo desde Supabase (SQL Editor), que pide la cuenta de
-- Supabase. Así, aunque alguien consiga la contraseña del panel, no puede
-- desviar los pagos a otra cuenta.
-- ---------------------------------------------------------------------
create or replace function public.config_protegida(p_clave text) returns boolean
language sql immutable set search_path = public as $$
  select p_clave in ('alias_transferencia', 'cvu_transferencia', 'titular_transferencia', 'whatsapp_contacto')
$$;

-- Barrera 1: la regla de permisos no deja al equipo editar esas filas
drop policy if exists "equipo edita config" on public.config;
create policy "equipo edita config" on public.config for update to authenticated
  using (public.es_equipo() and not public.config_protegida(clave))
  with check (public.es_equipo() and not public.config_protegida(clave));

-- Barrera 2: aunque fallara la regla, la tabla misma rechaza el cambio
-- si no viene del SQL Editor de Supabase (usuario "postgres")
create or replace function public.proteger_config() returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user in ('anon', 'authenticated', 'service_role')
     and (public.config_protegida(coalesce(new.clave, old.clave)) or public.config_protegida(old.clave)) then
    raise exception 'DATO_PROTEGIDO'
      using hint = 'Los datos de cobro solo se cambian desde Supabase (SQL Editor). Ver README.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists proteger_config on public.config;
create trigger proteger_config before insert or update or delete on public.config
  for each row execute function public.proteger_config();

-- Registro de cambios de ajustes y precios: quién, cuándo, antes y después
create or replace function public.registrar_cambio_ajuste() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.historial (tabla, registro_id, accion, usuario, datos)
  values (tg_table_name,
          coalesce(to_jsonb(new)->>'clave', to_jsonb(new)->>'id', to_jsonb(old)->>'clave', to_jsonb(old)->>'id'),
          tg_op, auth.uid(),
          jsonb_build_object('antes', case when tg_op <> 'INSERT' then to_jsonb(old) end,
                             'despues', case when tg_op <> 'DELETE' then to_jsonb(new) end,
                             'rol', current_user));
  return null;
end $$;
drop trigger if exists historial_config on public.config;
create trigger historial_config after insert or update or delete on public.config
  for each row execute function public.registrar_cambio_ajuste();
drop trigger if exists historial_precios on public.precios;
create trigger historial_precios after insert or update or delete on public.precios
  for each row execute function public.registrar_cambio_ajuste();

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function public.estado_pago_reserva(bigint, uuid)            from public, anon, authenticated;
revoke execute on function public.preparar_pago_mp(bigint, uuid)               from public, anon, authenticated;
revoke execute on function public.registrar_pago_mp(bigint, text, integer)     from public, anon, authenticated;
revoke execute on function public.resolver_pago_revisar(bigint, text)          from public, anon, authenticated;

grant execute on function public.estado_pago_reserva(bigint, uuid)             to anon, authenticated;
grant execute on function public.config_protegida(text)                        to anon, authenticated, service_role;
grant execute on function public.resolver_pago_revisar(bigint, text)           to authenticated;
-- Solo el servidor (clave service_role, que nunca está en la web)
grant execute on function public.preparar_pago_mp(bigint, uuid)                to service_role;
grant execute on function public.registrar_pago_mp(bigint, text, integer)      to service_role;
grant execute on function public.monto_pagado_reserva(bigint)                  to service_role;
grant execute on function public.sena_minima(integer)                          to service_role;
grant execute on function public.cfg_texto(text)                               to service_role;

select 'Mercado Pago listo en la base (queda apagado hasta activarlo en el panel)' as resultado;

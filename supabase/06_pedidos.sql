-- =====================================================================
-- PSICOSTUDIOS · 06_pedidos.sql
-- Reservar VARIOS DÍAS de una vez (ej: lunes en el Consultorio 1 y jueves
-- en el Consultorio 3): un "pedido" agrupa varias reservas, se cargan los
-- datos una sola vez y se paga UNA seña por todo.
--   · Se crean todas las reservas juntas o ninguna (si un horario se ocupa,
--     no queda nada a medias).
--   · Para el límite de "reservas sin pagar por persona", un pedido cuenta como una.
--   · Mercado Pago cobra la seña de todo el pedido y la reparte entre sus reservas.
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Requiere 01 a 05. Se puede correr más de una vez.
-- =====================================================================

insert into public.config (clave, valor, descripcion) values
  ('max_dias_por_pedido', '8', 'Máximo de días distintos que se pueden reservar juntos desde la web')
on conflict (clave) do nothing;

create table if not exists public.pedidos (
  id bigint generated always as identity primary key,
  token uuid not null unique default gen_random_uuid(),  -- código secreto para ver y pagar el pedido
  profesional_id bigint not null references public.profesionales (id),
  origen text not null default 'web',
  creado_en timestamptz not null default now()
);
alter table public.pedidos enable row level security;
drop policy if exists "equipo lee pedidos" on public.pedidos;
create policy "equipo lee pedidos" on public.pedidos for select to authenticated using (public.es_equipo());
revoke all on public.pedidos from anon, authenticated;
grant select on public.pedidos to authenticated;

alter table public.reservas add column if not exists pedido_id bigint references public.pedidos (id);
create index if not exists reservas_pedido_id on public.reservas (pedido_id);

-- Un pago de Mercado Pago ahora puede repartirse entre varias reservas del mismo pedido
drop index if exists public.pagos_mp_payment_id_unico;
create index if not exists pagos_mp_payment_id on public.pagos (mp_payment_id) where mp_payment_id is not null;
alter table public.pagos_a_revisar drop constraint if exists pagos_a_revisar_mp_payment_id_key;
create index if not exists pagos_a_revisar_mp_payment_id on public.pagos_a_revisar (mp_payment_id);

-- ---------------------------------------------------------------------
-- Límite de cosas sin pagar por WhatsApp: un pedido cuenta como una
-- ---------------------------------------------------------------------
create or replace function public.controlar_pendientes(p_whatsapp text) returns void
language plpgsql stable security definer set search_path = public as $$
declare
  v_tel text := public.solo_numeros(p_whatsapp);
  v_n integer;
begin
  select
    (select count(distinct coalesce('p' || r.pedido_id, 'r' || r.id))
       from public.reservas r join public.profesionales p on p.id = r.profesional_id
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
-- WEB: crear un pedido con uno o varios días
-- p_items: [{"fecha":"2026-11-09","horas":[10,11],"consultorio":1}, {"fecha":"2026-11-12","horas":[15],"consultorio":null}]
-- (consultorio null = el primero libre)
-- ---------------------------------------------------------------------
create or replace function public.crear_pedido(
  p_nombre text, p_whatsapp text, p_profesion text, p_email text, p_items jsonb
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_prof bigint;
  v_pedido bigint;
  v_token uuid;
  v_expira timestamptz;
  it jsonb;
  v_fecha date;
  v_horas smallint[];
  v_cons smallint;
  v_total integer;
  v_id bigint;
  v_lista jsonb := '[]'::jsonb;
  v_suma integer := 0;
  v_sena integer := 0;
begin
  perform public.validar_contacto(p_profesion, p_email);
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'SIN_HORAS' using hint = 'Elegí al menos un horario';
  end if;
  if jsonb_array_length(p_items) > public.cfg('max_dias_por_pedido') then
    raise exception 'DEMASIADOS_DIAS'
      using hint = format('Se pueden reservar hasta %s días por vez. Para más, escribinos.', public.cfg('max_dias_por_pedido'));
  end if;
  if (select count(distinct x->>'fecha') from jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items) then
    raise exception 'DIA_REPETIDO' using hint = 'Hay un día repetido en el pedido';
  end if;
  perform public.controlar_pendientes(p_whatsapp);

  v_prof := public.obtener_profesional(p_nombre, p_whatsapp, p_profesion, lower(trim(p_email)), 'Web');
  v_expira := now() + make_interval(mins => public.cfg('retencion_suelta_minutos'));
  insert into public.pedidos (profesional_id) values (v_prof) returning id, token into v_pedido, v_token;

  for it in select x from jsonb_array_elements(p_items) x order by x->>'fecha' loop
    v_fecha := (it->>'fecha')::date;
    v_horas := array(select h::smallint from jsonb_array_elements_text(it->'horas') h order by 1);
    v_cons := nullif(it->>'consultorio', '')::smallint;

    perform public.validar_horas(v_fecha, v_horas);
    if cardinality(v_horas) > public.cfg('max_horas_por_reserva') then
      raise exception 'DEMASIADAS_HORAS'
        using hint = format('Se pueden reservar hasta %s horas por día. Para más, escribinos.', public.cfg('max_horas_por_reserva'));
    end if;
    if v_fecha > public.fecha_maxima_reserva() then
      raise exception 'FECHA_LEJANA' using hint = format('Se puede reservar hasta el %s', to_char(public.fecha_maxima_reserva(), 'DD/MM'));
    end if;

    if v_cons is not null then
      if not exists (select 1 from public.consultorios where id = v_cons and activo and online) then
        raise exception 'CONSULTORIO_INVALIDO' using hint = 'Ese consultorio no está disponible';
      end if;
    else
      select c.id into v_cons from public.consultorios c
      where c.activo and c.online and c.nombre <> 'Salón' and public.libre(c.id, v_fecha, v_horas)
      order by c.orden limit 1;
    end if;
    if v_cons is null or not public.libre(v_cons, v_fecha, v_horas) then
      raise exception 'SIN_LUGAR'
        using hint = format('El horario del %s se acaba de ocupar. Elegí otro y volvé a intentar.', to_char(v_fecha, 'DD/MM'));
    end if;

    select sum(public.precio_hora('suelta', h, v_fecha)) into v_total from unnest(v_horas) h;
    insert into public.reservas (profesional_id, consultorio_id, fecha, horas, precio_total, estado, expira_en,
                                 origen, token_pago, pedido_id)
    values (v_prof, v_cons, v_fecha, v_horas, v_total, 'pendiente', v_expira, 'web', v_token, v_pedido)
    returning id into v_id;
    begin
      insert into public.ocupaciones (consultorio_id, fecha, hora, reserva_id)
      select v_cons, v_fecha, h, v_id from unnest(v_horas) h;
    exception when unique_violation then
      raise exception 'SIN_LUGAR'
        using hint = format('El horario del %s se acaba de ocupar. Elegí otro y volvé a intentar.', to_char(v_fecha, 'DD/MM'));
    end;

    v_suma := v_suma + v_total;
    v_sena := v_sena + public.sena_minima(v_total);
    v_lista := v_lista || jsonb_build_object('id', v_id, 'fecha', v_fecha, 'horas', to_jsonb(v_horas),
      'consultorio', (select nombre from public.consultorios where id = v_cons), 'total', v_total);
  end loop;

  return json_build_object('pedido', v_pedido, 'token', v_token, 'total', v_suma, 'sena', v_sena,
                           'expira_en', v_expira, 'reservas', v_lista);
end $$;

-- WEB: estado de un pedido (solo con su código). No devuelve nombres ni teléfonos.
create or replace function public.estado_pago_pedido(p_pedido_id bigint, p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v json;
begin
  select json_build_object(
    'id', pe.id,
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
  where pe.id = p_pedido_id and pe.token = p_token
  group by pe.id;
  if v is null then raise exception 'NO_ENCONTRADO' using hint = 'No encontramos ese pedido'; end if;
  return v;
end $$;

-- ---------------------------------------------------------------------
-- SERVIDOR: cuánto cobrar por Mercado Pago (la seña que falta de todo el pedido)
-- ---------------------------------------------------------------------
create or replace function public.preparar_pago_pedido(p_pedido_id bigint, p_token uuid) returns json
language plpgsql stable security definer set search_path = public as $$
declare
  v_monto integer;
  v_expira timestamptz;
  v_n integer;
  v_fechas text;
begin
  if coalesce(public.cfg_texto('mercadopago_activo'), 'no') <> 'si' then
    raise exception 'MP_APAGADO' using hint = 'El pago online no está disponible. Transferí al alias.';
  end if;
  if not exists (select 1 from public.pedidos where id = p_pedido_id and token = p_token) then
    raise exception 'NO_ENCONTRADO' using hint = 'No encontramos ese pedido';
  end if;
  select coalesce(sum(greatest(0, public.sena_minima(precio_total) - public.monto_pagado_reserva(id))), 0)::integer,
         min(expira_en), count(*), string_agg(to_char(fecha, 'DD/MM'), ', ' order by fecha)
    into v_monto, v_expira, v_n, v_fechas
  from public.reservas where pedido_id = p_pedido_id and estado = 'pendiente';
  if v_n = 0 then
    if exists (select 1 from public.reservas where pedido_id = p_pedido_id and estado = 'confirmada') then
      raise exception 'YA_CONFIRMADA' using hint = 'Este pedido ya tiene la seña paga.';
    end if;
    raise exception 'RESERVA_NO_VIGENTE' using hint = 'Se venció el tiempo para pagar y los horarios se liberaron. Hacé una reserva nueva.';
  end if;
  if v_expira is not null and v_expira < now() + interval '2 minutes' then
    raise exception 'RESERVA_NO_VIGENTE' using hint = 'Se venció el tiempo para pagar y los horarios se liberaron. Hacé una reserva nueva.';
  end if;
  if v_monto <= 0 then
    raise exception 'YA_CONFIRMADA' using hint = 'Este pedido ya tiene la seña paga.';
  end if;
  return json_build_object('id', p_pedido_id, 'monto', v_monto, 'expira_en', v_expira,
    'descripcion', format('Seña pedido #%s · %s %s (%s)', p_pedido_id, v_n, case when v_n = 1 then 'turno' else 'turnos' end, v_fechas));
end $$;

-- Interna: aplica una parte de un pago de Mercado Pago a UNA reserva
-- (misma lógica que registrar_pago_mp de 04, sin el control de repetidos)
create or replace function public.aplicar_pago_mp_reserva(p_reserva_id bigint, p_mp_payment_id text, p_monto integer)
returns text
language plpgsql security definer set search_path = public as $$
declare
  r public.reservas;
  v_pagado integer;
begin
  select * into r from public.reservas where id = p_reserva_id for update;
  if r.estado in ('vencida', 'cancelada') then
    if r.estado = 'vencida' and public.libre(r.consultorio_id, r.fecha, r.horas)
       and (r.fecha > public.hoy_ar() or (r.fecha = public.hoy_ar()
            and (select min(h) from unnest(r.horas) h) > extract(hour from public.ahora_ar()))) then
      begin
        insert into public.ocupaciones (consultorio_id, fecha, hora, reserva_id)
        select r.consultorio_id, r.fecha, h, r.id from unnest(r.horas) h;
        update public.reservas set estado = 'pendiente', expira_en = null where id = r.id;
        r.estado := 'pendiente';
      exception when unique_violation then
        null;
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
  insert into public.pagos (reserva_id, monto, medio, mp_payment_id) values (r.id, p_monto, 'mercadopago', p_mp_payment_id);
  if v_pagado + p_monto >= public.sena_minima(r.precio_total) then
    update public.reservas set estado = 'confirmada', expira_en = null where id = r.id;
    return 'CONFIRMADA';
  end if;
  return 'PAGO_PARCIAL';
end $$;

-- ---------------------------------------------------------------------
-- SERVIDOR: Mercado Pago aprobó el pago de un pedido. Se reparte:
-- primero completa la seña de cada reserva (por fecha), y si sobra, el saldo.
-- Devuelve CONFIRMADA, PAGO_PARCIAL, YA_REGISTRADO o A_REVISAR. Nunca da error por
-- un caso de negocio (si diera error, Mercado Pago reintentaría).
-- ---------------------------------------------------------------------
create or replace function public.registrar_pago_pedido_mp(p_pedido_id bigint, p_mp_payment_id text, p_monto integer)
returns text
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_resto integer := p_monto;
  v_parte integer;
  v_revisar boolean := false;
  v_res text;
begin
  -- dos avisos del mismo pago al mismo tiempo: el segundo espera al primero
  perform pg_advisory_xact_lock(hashtext('mp:' || p_mp_payment_id));
  if exists (select 1 from public.pagos where mp_payment_id = p_mp_payment_id)
     or exists (select 1 from public.pagos_a_revisar where mp_payment_id = p_mp_payment_id) then
    return 'YA_REGISTRADO';
  end if;
  if not exists (select 1 from public.reservas where pedido_id = p_pedido_id) then
    insert into public.pagos_a_revisar (reserva_id, mp_payment_id, monto, motivo)
    values (null, p_mp_payment_id, p_monto, format('Pago para el pedido #%s, que no existe', p_pedido_id));
    return 'A_REVISAR';
  end if;

  -- 1) la seña de cada reserva
  for r in select id, precio_total from public.reservas where pedido_id = p_pedido_id order by fecha, id loop
    exit when v_resto <= 0;
    v_parte := least(v_resto, greatest(0, public.sena_minima(r.precio_total) - public.monto_pagado_reserva(r.id)));
    continue when v_parte = 0;
    v_res := public.aplicar_pago_mp_reserva(r.id, p_mp_payment_id, v_parte);
    v_revisar := v_revisar or v_res = 'A_REVISAR';
    v_resto := v_resto - v_parte;
  end loop;
  -- 2) si sobra, el saldo de las reservas vigentes
  for r in select id, precio_total from public.reservas
           where pedido_id = p_pedido_id and estado in ('pendiente', 'confirmada') order by fecha, id loop
    exit when v_resto <= 0;
    v_parte := least(v_resto, greatest(0, r.precio_total - public.monto_pagado_reserva(r.id)));
    continue when v_parte = 0;
    perform public.aplicar_pago_mp_reserva(r.id, p_mp_payment_id, v_parte);
    v_resto := v_resto - v_parte;
  end loop;
  -- 3) si todavía sobra, a revisar (para devolver)
  if v_resto > 0 then
    insert into public.pagos_a_revisar (reserva_id, mp_payment_id, monto, motivo)
    values (null, p_mp_payment_id, v_resto, format('Sobraron $%s del pago del pedido #%s', v_resto, p_pedido_id));
    v_revisar := true;
  end if;

  if v_revisar then return 'A_REVISAR'; end if;
  if not exists (select 1 from public.reservas where pedido_id = p_pedido_id and estado <> 'confirmada') then return 'CONFIRMADA'; end if;
  return 'PAGO_PARCIAL';
end $$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function public.crear_pedido(text, text, text, text, jsonb)                 from public, anon, authenticated;
revoke execute on function public.estado_pago_pedido(bigint, uuid)                             from public, anon, authenticated;
revoke execute on function public.preparar_pago_pedido(bigint, uuid)                           from public, anon, authenticated;
revoke execute on function public.aplicar_pago_mp_reserva(bigint, text, integer)               from public, anon, authenticated, service_role;
revoke execute on function public.registrar_pago_pedido_mp(bigint, text, integer)              from public, anon, authenticated;
grant execute on function public.crear_pedido(text, text, text, text, jsonb)                  to anon, authenticated;
grant execute on function public.estado_pago_pedido(bigint, uuid)                              to anon, authenticated;
grant execute on function public.preparar_pago_pedido(bigint, uuid)                            to service_role;
grant execute on function public.registrar_pago_pedido_mp(bigint, text, integer)               to service_role;

select 'Pedidos de varios días listos' as resultado;

-- =====================================================================
-- PSICOSTUDIOS · 07_comprobantes.sql
-- Subir el comprobante de pago (transferencia) desde la web, y revisarlo en el panel.
--   · Los archivos van a un espacio PRIVADO de Supabase ("comprobantes"):
--     solo el equipo los puede ver. Máx. 5 MB, solo imágenes o PDF.
--   · Solo se puede subir con el código secreto del pedido. Máx. 5 por pedido.
--   · Al subir un comprobante, los horarios del pedido se guardan unas horas
--     más (por defecto 12) mientras el equipo lo revisa.
--   · En el panel: "Registrar seña" reparte el pago entre los días del pedido.
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Requiere 01 a 06. Se puede correr más de una vez.
-- =====================================================================

insert into public.config (clave, valor, descripcion) values
  ('horas_espera_comprobante', '12', 'Horas extra que se guardan los horarios después de subir un comprobante, mientras el equipo lo revisa'),
  ('max_comprobantes_por_pedido', '5', 'Máximo de comprobantes que se pueden subir por pedido')
on conflict (clave) do nothing;

-- ---------------------------------------------------------------------
-- 1. Espacio privado para los archivos
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
                               allowed_mime_types = excluded.allowed_mime_types;

-- Ruta de cada archivo: <pedido>/<código secreto del pedido>/<nombre al azar>.<extensión>
create or replace function public.ruta_comprobante_valida(p_ruta text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_pedido bigint;
  v_token uuid;
begin
  if p_ruta is null or p_ruta !~ '^[0-9]{1,18}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|jpeg|png|webp|heic|heif|pdf)$' then
    return false;
  end if;
  v_pedido := split_part(p_ruta, '/', 1)::bigint;
  v_token := split_part(p_ruta, '/', 2)::uuid;
  if not exists (select 1 from public.pedidos where id = v_pedido and token = v_token) then
    return false;
  end if;
  return (select count(*) from storage.objects
          where bucket_id = 'comprobantes' and name like v_pedido || '/%') < public.cfg('max_comprobantes_por_pedido');
end $$;

-- Quién puede hacer qué con los archivos
drop policy if exists "web sube comprobantes" on storage.objects;
create policy "web sube comprobantes" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'comprobantes' and public.ruta_comprobante_valida(name));
drop policy if exists "equipo ve comprobantes" on storage.objects;
create policy "equipo ve comprobantes" on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and public.es_equipo());
-- (nadie puede modificar ni borrar comprobantes desde la web ni el panel)

-- ---------------------------------------------------------------------
-- 2. Registro de comprobantes
-- ---------------------------------------------------------------------
create table if not exists public.comprobantes (
  id bigint generated always as identity primary key,
  pedido_id bigint not null references public.pedidos (id),
  ruta text not null unique,
  tipo text,
  bytes integer,
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptado', 'rechazado')),
  nota text,
  creado_en timestamptz not null default now(),
  revisado_por uuid,
  revisado_en timestamptz
);
create index if not exists comprobantes_estado on public.comprobantes (estado);
alter table public.comprobantes enable row level security;
drop policy if exists "equipo lee comprobantes" on public.comprobantes;
create policy "equipo lee comprobantes" on public.comprobantes for select to authenticated using (public.es_equipo());
revoke all on public.comprobantes from anon, authenticated;
grant select on public.comprobantes to authenticated;
drop trigger if exists historial_comprobantes on public.comprobantes;
create trigger historial_comprobantes after insert or update on public.comprobantes
  for each row execute function public.registrar_historial();

-- WEB: después de subir el archivo, se registra (y se guardan los horarios unas horas más)
create or replace function public.registrar_comprobante(p_pedido_id bigint, p_token uuid, p_ruta text) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_obj record;
  v_id bigint;
  v_hasta timestamptz;
begin
  if not exists (select 1 from public.pedidos where id = p_pedido_id and token = p_token) then
    raise exception 'NO_ENCONTRADO' using hint = 'No encontramos ese pedido';
  end if;
  if split_part(p_ruta, '/', 1) <> p_pedido_id::text or split_part(p_ruta, '/', 2) <> p_token::text then
    raise exception 'ARCHIVO_INVALIDO' using hint = 'El archivo no corresponde a este pedido';
  end if;
  select name, metadata into v_obj from storage.objects where bucket_id = 'comprobantes' and name = p_ruta;
  if not found then
    raise exception 'ARCHIVO_INVALIDO' using hint = 'No se pudo subir el archivo. Probá de nuevo.';
  end if;

  insert into public.comprobantes (pedido_id, ruta, tipo, bytes)
  values (p_pedido_id, p_ruta, v_obj.metadata->>'mimetype', nullif(v_obj.metadata->>'size', '')::integer)
  on conflict (ruta) do nothing
  returning id into v_id;

  -- mientras el equipo revisa, los horarios no se liberan
  v_hasta := now() + make_interval(hours => public.cfg('horas_espera_comprobante'));
  update public.reservas set expira_en = greatest(expira_en, v_hasta)
  where pedido_id = p_pedido_id and estado = 'pendiente' and expira_en is not null;

  return json_build_object('id', v_id, 'horarios_guardados_hasta',
    (select max(expira_en) from public.reservas where pedido_id = p_pedido_id and estado = 'pendiente'));
end $$;

-- ---------------------------------------------------------------------
-- 3. PANEL
-- ---------------------------------------------------------------------

-- Comprobantes para revisar, con los datos del pedido
create or replace function public.comprobantes_pendientes() returns json
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  return coalesce((
    select json_agg(json_build_object(
      'id', c.id, 'ruta', c.ruta, 'tipo', c.tipo, 'creado_en', c.creado_en, 'pedido_id', c.pedido_id,
      'nombre', pr.nombre, 'whatsapp', pr.whatsapp,
      'total', (select sum(precio_total) from public.reservas where pedido_id = c.pedido_id),
      'pagado', (select sum(public.monto_pagado_reserva(id)) from public.reservas where pedido_id = c.pedido_id),
      'falta_sena', (select coalesce(sum(greatest(0, public.sena_minima(precio_total) - public.monto_pagado_reserva(id))), 0)
                     from public.reservas where pedido_id = c.pedido_id and estado in ('pendiente', 'confirmada')),
      'falta_total', (select coalesce(sum(precio_total - public.monto_pagado_reserva(id)), 0)
                      from public.reservas where pedido_id = c.pedido_id and estado in ('pendiente', 'confirmada')),
      'reservas', (select json_agg(json_build_object('id', r.id, 'fecha', r.fecha, 'horas', r.horas, 'estado', r.estado,
                                                     'consultorio', co.nombre, 'expira_en', r.expira_en) order by r.fecha)
                   from public.reservas r join public.consultorios co on co.id = r.consultorio_id where r.pedido_id = c.pedido_id)
    ) order by c.creado_en)
    from public.comprobantes c
    join public.pedidos pe on pe.id = c.pedido_id
    join public.profesionales pr on pr.id = pe.profesional_id
    where c.estado = 'pendiente'), '[]'::json);
end $$;

-- Registrar un pago para todo el pedido: completa primero la seña de cada día y después el saldo
create or replace function public.registrar_pago_pedido(p_pedido_id bigint, p_monto integer, p_medio text) returns text
language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_resto integer := p_monto;
  v_parte integer;
  v_falta integer;
begin
  perform public.exigir_equipo();
  if p_monto is null or p_monto <= 0 then raise exception 'MONTO_INVALIDO' using hint = 'El monto tiene que ser mayor a cero'; end if;
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

-- Revisar un comprobante: aceptar (registra el pago) o rechazar (con nota)
create or replace function public.revisar_comprobante(
  p_id bigint, p_aceptar boolean, p_monto integer default null, p_medio text default 'transferencia', p_nota text default null
) returns text
language plpgsql security definer set search_path = public as $$
declare
  c public.comprobantes;
  v_res text := 'RECHAZADO';
begin
  perform public.exigir_equipo();
  select * into c from public.comprobantes where id = p_id for update;
  if not found or c.estado <> 'pendiente' then raise exception 'NO_ENCONTRADO' using hint = 'Ese comprobante ya fue revisado'; end if;
  if p_aceptar then
    v_res := public.registrar_pago_pedido(c.pedido_id, p_monto, coalesce(p_medio, 'transferencia'));
  end if;
  update public.comprobantes
  set estado = case when p_aceptar then 'aceptado' else 'rechazado' end, nota = p_nota,
      revisado_por = auth.uid(), revisado_en = now()
  where id = p_id;
  return v_res;
end $$;

-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
revoke execute on function public.ruta_comprobante_valida(text)                        from public, anon, authenticated;
revoke execute on function public.registrar_comprobante(bigint, uuid, text)              from public, anon, authenticated;
revoke execute on function public.comprobantes_pendientes()                              from public, anon, authenticated;
revoke execute on function public.registrar_pago_pedido(bigint, integer, text)           from public, anon, authenticated;
revoke execute on function public.revisar_comprobante(bigint, boolean, integer, text, text) from public, anon, authenticated;
-- la regla de subida la evalúa quien sube (anon), por eso necesita poder ejecutarla
grant execute on function public.ruta_comprobante_valida(text)                         to anon, authenticated;
grant execute on function public.registrar_comprobante(bigint, uuid, text)               to anon, authenticated;
grant execute on function public.comprobantes_pendientes()                               to authenticated;
grant execute on function public.registrar_pago_pedido(bigint, integer, text)            to authenticated;
grant execute on function public.revisar_comprobante(bigint, boolean, integer, text, text) to authenticated;

select 'Comprobantes listos: espacio privado creado y reglas de subida aplicadas' as resultado;

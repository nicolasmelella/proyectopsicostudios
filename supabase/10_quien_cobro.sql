-- =====================================================================
-- PSICOSTUDIOS · 10: "¿A quién le pagaron?"
-- Cada pago cargado a mano dice quién recibió la plata (ej: Silvia o Nico).
-- La lista se cambia en el panel → Precios y ajustes. Se puede correr las veces que haga falta.
-- =====================================================================

alter table public.pagos add column if not exists recibio text;

insert into public.config (clave, valor, descripcion)
values ('quienes_cobran', 'Silvia,Nico', 'Quiénes reciben los pagos (separados por coma)')
on conflict (clave) do nothing;

-- Marca quién recibió un pago (p_pago_id) o los pagos de una reserva recién cargada (p_reserva_id).
-- Solo completa pagos que todavía no lo tienen.
create or replace function public.marcar_quien_recibio(p_recibio text, p_pago_id bigint default null, p_reserva_id bigint default null)
returns integer
language plpgsql security definer set search_path = public as $$
declare
  v_nombre text;
  v_n integer;
begin
  perform public.exigir_equipo();
  select trim(x) into v_nombre
  from unnest(string_to_array(public.cfg_texto('quienes_cobran'), ',')) x
  where lower(trim(x)) = lower(trim(coalesce(p_recibio, ''))) and trim(x) <> ''
  limit 1;
  if v_nombre is null then
    raise exception 'COBRADOR_INVALIDO' using hint = 'Elegí a quién le pagaron';
  end if;
  if p_pago_id is null and p_reserva_id is null then
    raise exception 'NO_ENCONTRADO' using hint = 'Falta el pago';
  end if;
  update public.pagos set recibio = v_nombre
  where not anulado and recibio is null
    and (case when p_pago_id is not null then id = p_pago_id else reserva_id = p_reserva_id end);
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke execute on function public.marcar_quien_recibio(text, bigint, bigint) from public, anon, authenticated;
grant execute on function public.marcar_quien_recibio(text, bigint, bigint) to authenticated;

select 'Listo: los pagos ahora guardan a quién le pagaron (' || public.cfg_texto('quienes_cobran') || ')' as resultado;

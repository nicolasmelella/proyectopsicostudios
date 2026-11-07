-- =====================================================================
-- PSICOSTUDIOS · 09: vista "Semana" del panel (la que reemplaza al Excel)
--   * Notas de la semana (lo que hoy se escribe al pie de cada hoja)
--   * "Deshacer" de una carga recién hecha (sin mandar avisos de cancelación)
--   * Un usuario por persona del equipo (queda registrado quién cargó qué)
-- Se puede correr las veces que haga falta.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. NOTAS DE LA SEMANA
-- ---------------------------------------------------------------------
create table if not exists public.notas_semana (
  id bigint generated always as identity primary key,
  semana date not null check (extract(isodow from semana) = 1),   -- siempre el lunes
  texto text not null check (length(trim(texto)) between 1 and 1000),
  autor uuid default auth.uid(),
  autor_nombre text,
  creado_en timestamptz not null default now()
);
create index if not exists notas_semana_semana_idx on public.notas_semana (semana);

alter table public.notas_semana enable row level security;
drop policy if exists "equipo lee notas" on public.notas_semana;
create policy "equipo lee notas" on public.notas_semana for select to authenticated using (public.es_equipo());
revoke all on public.notas_semana from anon, authenticated;
grant select on public.notas_semana to authenticated;      -- se escribe solo con las funciones de abajo

drop trigger if exists historial_notas_semana on public.notas_semana;
create trigger historial_notas_semana after insert or update or delete on public.notas_semana
  for each row execute function public.registrar_historial();

create or replace function public.agregar_nota(p_semana date, p_texto text) returns bigint
language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  perform public.exigir_equipo();
  if length(trim(coalesce(p_texto, ''))) = 0 then
    raise exception 'NOTA_VACIA' using hint = 'Escribí la nota';
  end if;
  insert into public.notas_semana (semana, texto, autor, autor_nombre)
  values (p_semana - (extract(isodow from p_semana)::int - 1), left(trim(p_texto), 1000), auth.uid(),
          (select nombre from public.equipo where user_id = auth.uid()))
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.borrar_nota(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_equipo();
  delete from public.notas_semana where id = p_id;
end $$;

-- ---------------------------------------------------------------------
-- 2. DESHACER UNA CARGA RECIÉN HECHA
-- Solo lo que cargó la misma persona desde el panel en los últimos 15 minutos.
-- Se borra como si nunca hubiera existido (no se avisa "cancelada" al profesional).
-- Para todo lo demás está "Cancelar reserva".
-- ---------------------------------------------------------------------
create or replace function public.deshacer_carga(p_reserva_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare r public.reservas;
begin
  perform public.exigir_equipo();
  select * into r from public.reservas where id = p_reserva_id for update;
  if not found or r.origen <> 'panel' or r.creado_por is distinct from auth.uid()
     or r.creado_en < now() - interval '15 minutes' or r.estado not in ('pendiente', 'confirmada') then
    raise exception 'NO_SE_PUEDE_DESHACER'
      using hint = 'Solo se puede deshacer lo que cargaste vos en los últimos 15 minutos. Abrí la reserva y usá "Cancelar reserva".';
  end if;
  delete from public.avisos where reserva_id = r.id;
  delete from public.pagos where reserva_id = r.id;
  delete from public.reservas where id = r.id;            -- las horas se liberan solas (ocupaciones on delete cascade)
end $$;

-- ---------------------------------------------------------------------
-- 3. PERMISOS
-- ---------------------------------------------------------------------
revoke execute on function public.agregar_nota(date, text), public.borrar_nota(bigint), public.deshacer_carga(bigint)
  from public, anon, authenticated;
grant execute on function public.agregar_nota(date, text) to authenticated;
grant execute on function public.borrar_nota(bigint)      to authenticated;
grant execute on function public.deshacer_carga(bigint)   to authenticated;

-- ---------------------------------------------------------------------
-- 4. UN USUARIO POR PERSONA DEL EQUIPO
-- Antes de correr esto, crear cada usuario en Authentication → Users → Add user
-- con el formato nombre@psicostudios.local (ej: bianca@psicostudios.local).
-- Acá se habilitan todos los que terminan en @psicostudios.local.
-- (El registro libre está desactivado: solo se crean usuarios desde Supabase.)
-- ---------------------------------------------------------------------
insert into public.equipo (user_id, nombre, rol)
select id, initcap(split_part(email, '@', 1)), 'equipo'
from auth.users where email like '%@psicostudios.local'
on conflict (user_id) do nothing;

select 'Semana lista. Usuarios del panel: ' ||
       coalesce((select string_agg(e.nombre, ', ' order by e.nombre) from public.equipo e), 'ninguno') as resultado;

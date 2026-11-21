-- =====================================================================
-- PSICOSTUDIOS · 24_bianki.sql
-- Bianki, la buscadora de la web ("quiero consultorio el lunes a las 14
-- con escritorio"). Acá va solo el LÍMITE de consultas, para que nadie
-- gaste el crédito de la IA: por persona y por hora, y un tope por día.
-- Si se pasa el límite (o Bianki está apagada), la web sigue buscando
-- con sus propias reglas, sin IA.
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Requiere 01 a 23. Se puede correr más de una vez.
-- =====================================================================

insert into public.config (clave, valor, descripcion) values
  ('bianki_activo',       'si',  'Bianki (buscadora con IA de la web): si / no'),
  ('bianki_max_por_hora', '20',  'Bianki: consultas con IA por persona y por hora'),
  ('bianki_max_por_dia',  '800', 'Bianki: consultas con IA por día, entre todas las personas')
on conflict (clave) do nothing;

create table if not exists public.bianki_usos (
  clave text not null,            -- huella de la persona (no es la IP) o 'global'
  dia date not null,
  hora smallint not null,         -- 0 a 23; -1 = todo el día (global)
  n integer not null default 0,
  primary key (clave, dia, hora)
);
alter table public.bianki_usos enable row level security;   -- nadie la lee desde afuera

create or replace function public.bianki_permitir(p_clave text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_ahora timestamp := public.ahora_ar();
  v_n integer;
  v_global integer;
begin
  if coalesce(public.cfg_texto('bianki_activo'), 'si') <> 'si' or coalesce(p_clave, '') = '' then return false; end if;
  delete from public.bianki_usos where dia < v_ahora::date - 7;
  insert into public.bianki_usos (clave, dia, hora, n) values (left(p_clave, 64), v_ahora::date, extract(hour from v_ahora), 1)
  on conflict (clave, dia, hora) do update set n = public.bianki_usos.n + 1 returning n into v_n;
  if v_n > coalesce(public.cfg('bianki_max_por_hora'), 20) then return false; end if;
  insert into public.bianki_usos (clave, dia, hora, n) values ('global', v_ahora::date, -1, 1)
  on conflict (clave, dia, hora) do update set n = public.bianki_usos.n + 1 returning n into v_global;
  return v_global <= coalesce(public.cfg('bianki_max_por_dia'), 800);
end $$;
revoke execute on function public.bianki_permitir(text) from public, anon, authenticated;
grant execute on function public.bianki_permitir(text) to service_role;

select 'Bianki lista: límite de consultas configurado' as resultado;

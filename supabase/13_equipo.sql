-- =====================================================================
-- PSICOSTUDIOS · 13: equipo con mails reales
--   * Cada persona entra con su mail y la contraseña que eligió desde la invitación.
--   * Un administrador invita a otros desde el panel (pestaña "Equipo"), los desactiva o les cambia el rol.
--   * Quien está desactivado no puede usar el panel (sus reservas cargadas quedan).
-- La invitación por mail la manda la función del servidor "equipo-admin".
-- Se puede correr las veces que haga falta.
-- =====================================================================

alter table public.equipo add column if not exists email text;
alter table public.equipo add column if not exists activo boolean not null default true;

-- Solo cuenta el equipo activo
create or replace function public.es_equipo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipo where user_id = auth.uid() and activo)
$$;

create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.equipo where user_id = auth.uid() and activo and rol = 'admin')
$$;

create or replace function public.exigir_admin() returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.es_admin() then
    raise exception 'NO_AUTORIZADO' using hint = 'Solo un administrador puede hacer esto';
  end if;
end $$;

-- Lista del equipo (solo administradores)
create or replace function public.equipo_lista()
returns table (user_id uuid, nombre text, email text, rol text, activo boolean, ultimo_ingreso timestamptz, creado_en timestamptz)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  perform public.exigir_admin();
  return query
  select e.user_id, e.nombre, coalesce(e.email, u.email::text), e.rol, e.activo, u.last_sign_in_at, e.creado_en
  from public.equipo e left join auth.users u on u.id = e.user_id
  order by e.activo desc, e.nombre;
end $$;

-- Activar / desactivar o cambiar el rol (solo administradores). Siempre tiene que quedar un administrador activo.
create or replace function public.equipo_cambiar(p_user_id uuid, p_activo boolean default null, p_rol text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  perform public.exigir_admin();
  if p_rol is not null and p_rol not in ('admin', 'equipo') then
    raise exception 'ROL_INVALIDO' using hint = 'El rol tiene que ser administrador o equipo';
  end if;
  if p_user_id = auth.uid() and (p_activo is false or p_rol = 'equipo') then
    raise exception 'NO_A_VOS_MISMO' using hint = 'No podés desactivarte ni sacarte el rol de administrador a vos mismo';
  end if;
  update public.equipo set activo = coalesce(p_activo, activo), rol = coalesce(p_rol, rol) where user_id = p_user_id;
  if not found then raise exception 'NO_ENCONTRADO' using hint = 'No se encontró esa persona'; end if;
  if not exists (select 1 from public.equipo where activo and rol = 'admin') then
    raise exception 'SIN_ADMIN' using hint = 'Tiene que quedar al menos un administrador activo';
  end if;
end $$;

-- Para la función del servidor "equipo-admin" (con permisos de servidor, nunca desde la web)
create or replace function public.rol_de(p_user_id uuid) returns text
language sql stable security definer set search_path = public as $$
  select rol from public.equipo where user_id = p_user_id and activo
$$;

create or replace function public.equipo_alta(p_user_id uuid, p_nombre text, p_email text, p_rol text default 'equipo')
returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(trim(coalesce(p_nombre, ''))) < 2 then raise exception 'NOMBRE_INVALIDO' using hint = 'Falta el nombre'; end if;
  if coalesce(p_rol, 'equipo') not in ('admin', 'equipo') then raise exception 'ROL_INVALIDO' using hint = 'Rol inválido'; end if;
  insert into public.equipo (user_id, nombre, email, rol, activo)
  values (p_user_id, trim(p_nombre), lower(trim(p_email)), coalesce(p_rol, 'equipo'), true)
  on conflict (user_id) do update set nombre = excluded.nombre, email = excluded.email, rol = excluded.rol, activo = true;
end $$;

drop trigger if exists historial_equipo on public.equipo;
create trigger historial_equipo after insert or update or delete on public.equipo
  for each row execute function public.registrar_historial();

revoke execute on function public.es_admin(), public.exigir_admin(), public.equipo_lista(), public.equipo_cambiar(uuid, boolean, text),
  public.rol_de(uuid), public.equipo_alta(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.es_admin() to authenticated;
grant execute on function public.equipo_lista() to authenticated;
grant execute on function public.equipo_cambiar(uuid, boolean, text) to authenticated;
grant execute on function public.rol_de(uuid) to service_role;
grant execute on function public.equipo_alta(uuid, text, text, text) to service_role;

-- ---------------------------------------------------------------------
-- PRIMER ADMINISTRADOR (una sola vez): después de invitarlo desde Supabase
-- (Authentication → Users → Invite user), cambiar el mail y correr:
--   insert into public.equipo (user_id, nombre, email, rol)
--   select id, 'NOMBRE', email, 'admin' from auth.users where email = 'MAIL@EJEMPLO.COM'
--   on conflict (user_id) do update set rol = 'admin', activo = true;
-- Al resto lo invita ese administrador desde el panel → Equipo.
-- ---------------------------------------------------------------------

select 'Equipo listo: ' || (select count(*) from public.equipo where activo) || ' personas activas' as resultado;

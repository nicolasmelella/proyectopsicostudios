-- Pruebas de 13_equipo.sql (después de probar_tablero.sql, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
alter table auth.users add column if not exists last_sign_in_at timestamptz;   -- (en Supabase ya existe)
\ir ../supabase/13_equipo.sql
\set QUIET 1
\o /dev/null

insert into auth.users (email) values ('nueva@ejemplo.com');
select (select id from auth.users where email = 'nueva@ejemplo.com') as id_nueva \gset

-- Solo un administrador ve y cambia el equipo
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_bianca', false);
select pg_temp.espera_error($$select * from public.equipo_lista()$$, 'NO_AUTORIZADO');
select pg_temp.espera_error(format($$select public.equipo_cambiar(%L, false)$$, :'id_mama'), 'NO_AUTORIZADO');
select set_config('request.jwt.claim.sub', :'id_equipo', false);   -- psicomel es admin
select pg_temp.ok((select count(*) >= 3 from public.equipo_lista()), 'el administrador ve la lista del equipo');
reset role;

-- Alta desde la función del servidor (service_role)
set role service_role;
select public.equipo_alta(:'id_nueva', 'Nueva Persona', 'Nueva@Ejemplo.com', 'equipo');
select pg_temp.ok((select rol_de = 'equipo' from public.rol_de(:'id_nueva')), 'rol_de devuelve el rol (solo para el servidor)');
reset role;
select pg_temp.ok((select email = 'nueva@ejemplo.com' and activo from public.equipo where user_id = :'id_nueva'), 'alta: queda activa y con el mail en minúscula');
set role authenticated;
select pg_temp.espera_error(format($$select public.equipo_alta(%L, 'X', 'x@x.com')$$, :'id_nueva'), 'permission denied');
select pg_temp.espera_error(format($$select public.rol_de(%L)$$, :'id_nueva'), 'permission denied');

-- Desactivar: deja de poder usar el panel
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select public.equipo_cambiar(:'id_nueva', false);
select set_config('request.jwt.claim.sub', :'id_nueva', false);
select pg_temp.ok((select not public.es_equipo()), 'desactivada: ya no es del equipo');
select pg_temp.espera_error($$select * from public.agenda(current_date, current_date)$$, 'NO_AUTORIZADO');

-- Reactivar y hacer admin
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select public.equipo_cambiar(:'id_nueva', true, 'admin');
select set_config('request.jwt.claim.sub', :'id_nueva', false);
select pg_temp.ok((select public.es_admin()), 'reactivada y administradora');

-- Nadie se desactiva a sí mismo y siempre queda un administrador
select pg_temp.espera_error(format($$select public.equipo_cambiar(%L, false)$$, :'id_nueva'), 'NO_A_VOS_MISMO');
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select public.equipo_cambiar(:'id_nueva', null, 'equipo');
select pg_temp.espera_error(format($$select public.equipo_cambiar(%L, null, 'equipo')$$, :'id_equipo'), 'NO_A_VOS_MISMO');
select pg_temp.espera_error(format($$select public.equipo_cambiar(%L, null, 'jefe')$$, :'id_nueva'), 'ROL_INVALIDO');
reset role;
set role anon;
select pg_temp.espera_error($$select * from public.equipo_lista()$$, 'permission denied');
reset role;

\ir ../supabase/13_equipo.sql
\set QUIET 1
\o
select 'PRUEBAS DEL EQUIPO PASARON' as resultado;

-- Pruebas de 05_calendario.sql (se corre después de probar_mercadopago.sql, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/05_calendario.sql
\set QUIET 1
\o /dev/null

select pg_temp.ok(public.fecha_maxima_reserva() = (public.hoy_ar() + interval '2 months')::date,
                  'la agenda llega a 2 meses de calendario (ej: 7/11 → 7/1)');
select pg_temp.ok((select max(fecha) from public.disponibilidad(public.hoy_ar(), public.hoy_ar() + 120))
                  <= public.fecha_maxima_reserva(), 'la disponibilidad no muestra días después del límite');

-- El último día permitido (si no es domingo) se puede reservar; el siguiente no
create temp table lim as
select case when extract(isodow from public.fecha_maxima_reserva()) = 7
            then public.fecha_maxima_reserva() - 1 else public.fecha_maxima_reserva() end as ultimo,
       public.fecha_maxima_reserva() + case when extract(isodow from public.fecha_maxima_reserva() + 1) = 7 then 2 else 1 end as pasado;
grant select on lim to anon;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select pg_temp.ok((select public.crear_reserva('Límite', '1100001111', 'Psicóloga', 'Limite@Prueba.com', ultimo, array[10]::smallint[]) ->> 'id' is not null from lim),
                  'se puede reservar el último día permitido');
select pg_temp.espera_error((select format($$select public.crear_reserva('Lejos', '1100002222', 'Psicóloga', 'lejos@prueba.com', %L, array[10]::smallint[])$$, pasado) from lim), 'FECHA_LEJANA');

-- Datos obligatorios: mail y profesión
select pg_temp.espera_error((select format($$select public.crear_reserva('Sin Mail', '1100003333', 'Psicóloga', null, %L, array[11]::smallint[])$$, ultimo) from lim), 'EMAIL_INVALIDO');
select pg_temp.espera_error((select format($$select public.crear_reserva('Mal Mail', '1100003333', 'Psicóloga', 'no-es-un-mail', %L, array[11]::smallint[])$$, ultimo) from lim), 'EMAIL_INVALIDO');
select pg_temp.espera_error((select format($$select public.crear_reserva('Sin Prof', '1100003333', '', 'a@b.com', %L, array[11]::smallint[])$$, ultimo) from lim), 'FALTA_PROFESION');
select pg_temp.espera_error((select format($$select public.crear_solicitud_fijo('Sin Mail', '1100003333', 'Psicóloga', null, %s::smallint, array[9,10]::smallint[], %L)$$, extract(isodow from ultimo), ultimo) from lim), 'EMAIL_INVALIDO');
select pg_temp.espera_error($$select public.crear_reserva('Vieja', '1100003333', null, current_date + 3, array[11]::smallint[])$$, 'function');
reset role;
select pg_temp.ok((select email = 'limite@prueba.com' and profesion = 'Psicóloga' from public.profesionales where whatsapp = '1100001111'),
                  'se guardan el mail (en minúsculas) y la profesión');
set role anon;

-- Resumen por día (lo usa el calendario de la web)
create temp table res as select * from public.resumen_disponibilidad(public.hoy_ar(), public.hoy_ar() + 90);
select pg_temp.ok((select count(*) > 40 from res), 'el resumen trae todos los días hábiles de los 2 meses');
select pg_temp.ok((select bool_and(libres <= total and total >= 0) from res), 'en cada día, libres ≤ posibles');
select pg_temp.ok((select max(fecha) <= public.fecha_maxima_reserva() from res), 'el resumen no pasa del límite');
select pg_temp.ok((select libres = total - 1 from res where fecha = (select ultimo from lim)),
                  'una reserva de 1 hora descuenta 1 lugar ese día');
select pg_temp.ok((select count(*) = 0 from res where extract(isodow from fecha) = 7), 'los domingos no aparecen');
reset role;

\o
select 'PRUEBAS DEL CALENDARIO PASARON' as resultado;

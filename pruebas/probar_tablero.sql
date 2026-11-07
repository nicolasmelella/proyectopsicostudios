-- Pruebas de 12_tablero.sql (después de probar_comentarios.sql, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/12_tablero.sql
\set QUIET 1
\o /dev/null

-- Una reserva de la historia del Excel (la carga la hace el equipo desde el SQL Editor)
insert into public.profesionales (nombre, whatsapp, origen) values ('Hilda Historia', 'excel-hilda', 'Excel');
insert into public.reservas (profesional_id, consultorio_id, fecha, horas, precio_total, estado, origen, tipo_excel)
select id, 4, (select lunes - 7 from sem), array[9, 10, 11]::smallint[], 25500, 'confirmada', 'excel', 'fijo'
from public.profesionales where whatsapp = 'excel-hilda';
insert into public.ocupaciones (consultorio_id, fecha, hora, reserva_id)
select 4, (select lunes - 7 from sem), h, (select id from public.reservas where origen = 'excel') from unnest(array[9, 10, 11]) h;

set role authenticated;
select set_config('request.jwt.claim.sub', :'id_bianca', false);
create temp table tb as select public.tablero((select lunes - 7 from sem), (select lunes + 13 from sem)) as j;
grant select on tb to authenticated;
select pg_temp.ok((select (j->>'horas')::int = (select count(*) from public.ocupaciones o
      left join public.reservas r on r.id = o.reserva_id left join public.fijos f on f.id = o.fijo_id
      where o.fecha between (select lunes - 7 from sem) and (select lunes + 13 from sem) and o.bloqueo_id is null
        and (o.reserva_id is null or r.estado in ('pendiente','confirmada')) and (o.fijo_id is null or f.estado = 'activo')) from tb),
  'las horas del tablero son las horas ocupadas (sin bloqueos)');
select pg_temp.ok((select (j->'por_tipo'->>'fijo')::int >= 3 from tb), 'lo que era fijo en el Excel cuenta como fijo');
select pg_temp.ok((select exists (select 1 from jsonb_array_elements(j->'ranking') x where x->>'nombre' = 'Hilda Historia' and (x->>'horas_fijo')::int = 3) from tb),
  'el ranking suma la historia del Excel');
select pg_temp.ok((select (select sum((x->>'horas')::int) from jsonb_array_elements(j->'por_dia') x) = (j->>'horas')::int
                      and (select sum((x->>'horas')::int) from jsonb_array_elements(j->'calor') x) = (j->>'horas')::int from tb),
  'días y mapa de calor suman lo mismo que el total');
select pg_temp.ok((select (j->>'cobrado')::int = (select coalesce(sum(monto), 0) from public.pagos where not anulado
                     and pagado_en between (select lunes - 7 from sem) and (select lunes + 13 from sem)) from tb), 'cobrado = suma de pagos');
create temp table tb2 as select public.tablero(current_date - 30, current_date + 30) as j;
grant select on tb2 to authenticated;
select pg_temp.ok((select exists (select 1 from jsonb_array_elements(j->'cobros_por_persona') x where x->>'recibio' = 'Silvia')
                      and exists (select 1 from jsonb_array_elements(j->'cobros_por_persona') x where x->>'recibio' = 'Nico') from tb2),
  'cobros separados por Silvia y Nico');
create temp table pcobro as select public.pendientes_cobro() as j;
grant select on pcobro to authenticated;
select pg_temp.ok((select not exists (select 1 from jsonb_array_elements(j->'items') x where x->>'nombre' = 'Hilda Historia') from pcobro),
  'la historia del Excel no aparece como deuda');
select pg_temp.ok((select (j->>'total')::int = coalesce((select sum((x->>'falta')::int) from jsonb_array_elements(j->'items') x), 0) from pcobro),
  'el total pendiente es la suma de la lista');
select set_config('request.jwt.claim.sub', :'id_intruso', false);
select pg_temp.espera_error($$select public.tablero(current_date, current_date)$$, 'NO_AUTORIZADO');
select pg_temp.espera_error($$select public.pendientes_cobro()$$, 'NO_AUTORIZADO');
reset role;
set role anon;
select pg_temp.espera_error($$select public.tablero(current_date, current_date)$$, 'permission denied');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_bianca', false);
select pg_temp.ok((select tipo_excel = 'fijo' from public.agenda((select lunes - 7 from sem), (select lunes - 7 from sem)) where nombre = 'Hilda Historia' limit 1),
  'la agenda marca lo que era fijo en el Excel');
reset role;

\ir ../supabase/12_tablero.sql
\set QUIET 1
\o
select 'PRUEBAS DEL TABLERO PASARON' as resultado;

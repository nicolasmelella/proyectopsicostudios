-- Pruebas de 21_sin_sena_una_hora.sql (al final, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/21_sin_sena_una_hora.sql
\set QUIET 1
\o /dev/null

create or replace function pg_temp.dia(n integer) returns date language sql as $$
  select case when extract(isodow from public.hoy_ar() + n) = 7 then public.hoy_ar() + n + 1 else public.hoy_ar() + n end $$;
create or replace function pg_temp.pedido(p_nombre text, p_wa text, n integer, h integer, c integer) returns bigint language sql as $$
  select (public.crear_pedido(p_nombre, p_wa, 'Psicóloga', lower(replace(p_nombre, ' ', '')) || '@prueba.com',
    jsonb_build_array(jsonb_build_object('fecha', pg_temp.dia(n), 'horas', jsonb_build_array(h), 'consultorio', c)))->>'pedido')::bigint $$;
grant execute on function pg_temp.dia(integer), pg_temp.pedido(text, text, integer, integer, integer) to anon, authenticated;
create or replace function pg_temp.res(p bigint) returns public.reservas language sql as $$ select * from public.reservas where pedido_id = p $$;

select pg_temp.ok(public.cfg('retencion_suelta_minutos') = 15, 'el horario queda apartado 15 minutos');

set role anon;
select pg_temp.pedido('Nora Nopago', '1179990001', 40, 13, 4) as p_a \gset
select pg_temp.pedido('Paula Parcial', '1179990002', 40, 14, 4) as p_b \gset
select pg_temp.pedido('Rita Recupera', '1179990003', 40, 16, 4) as p_c \gset
select pg_temp.pedido('Ocho Ocupado', '1179990004', 40, 17, 4) as p_d \gset
select pg_temp.pedido('Pedro Pedido', '1179990005', 40, 18, 4) as p_e \gset
reset role;
select pg_temp.ok((select expira_en between now() + interval '14 minutes' and now() + interval '16 minutes' from pg_temp.res(:p_a)),
                  'al reservar por la web se aparta 15 minutos');

-- Dentro del plazo no se libera nada
select pg_temp.ok(public.liberar_vencidas() = 0, 'dentro del plazo no se libera nada');

-- Pasa la hora
update public.reservas set expira_en = now() - interval '1 minute' where pedido_id in (:p_a, :p_b, :p_c, :p_d, :p_e);
insert into public.pagos (reserva_id, monto, medio) select id, 1000, 'transferencia' from pg_temp.res(:p_b);
insert into public.profesionales (nombre, whatsapp, origen) values ('Pato Panel', '1179990009', 'Panel') on conflict do nothing;
insert into public.reservas (profesional_id, consultorio_id, fecha, horas, precio_total, estado, origen, expira_en)
select id, 3, pg_temp.dia(40), array[13]::smallint[], 9000, 'pendiente', 'excel', now() - interval '1 day' from public.profesionales where whatsapp = '1179990009';
select public.liberar_vencidas() as n \gset
select pg_temp.ok(:n = 4, 'pasada la hora se liberan las 4 sin ningún pago');
select pg_temp.ok((select estado = 'vencida' and motivo_cancelacion = 'No pagó la seña a tiempo' from pg_temp.res(:p_a)), 'queda como "No pagó la seña a tiempo"');
select pg_temp.ok((select public.libre(consultorio_id, fecha, horas) from pg_temp.res(:p_a)), '…y el horario queda libre para otro');
select pg_temp.ok((select estado = 'pendiente' from pg_temp.res(:p_b)), 'la que tiene un pago (aunque sea parcial) no se libera');
select pg_temp.ok((select count(*) = 1 from public.reservas where origen = 'excel' and estado = 'pendiente' and consultorio_id = 3 and fecha = pg_temp.dia(40)),
                  'las cargadas del Excel no se tocan');

-- Permisos
select (select id from pg_temp.res(:p_c)) as r_c, (select id from pg_temp.res(:p_d)) as r_d \gset
set role anon;
select pg_temp.espera_error($$select public.liberar_vencidas()$$, 'permission denied');
select pg_temp.espera_error(format('select public.recuperar_reserva(%s)', :r_c), 'permission denied');
select pg_temp.espera_error(format('select public.descartar_no_pago(%s)', :r_c), 'permission denied');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_intruso', false);
select pg_temp.espera_error(format('select public.recuperar_reserva(%s)', :r_c), 'NO_AUTORIZADO');

-- El panel lo muestra aparte como "No pagó"
select set_config('request.jwt.claim.sub', :'id_equipo', false);
create temp table ss_al as select a from json_array_elements(public.alertas_pago()) a;
select pg_temp.ok((select count(*) = 1 from ss_al where a->>'tipo' = 'no_pago' and a->>'nombre' = 'Nora Nopago' and (a->>'libre')::boolean),
                  'en el panel aparece como "No pagó" (y dice que el horario sigue libre)');
select pg_temp.ok((select a->>'tipo' = 'no_pago' from ss_al limit 1), '"No pagó" va primero en la lista');
select pg_temp.ok((select count(*) = 0 from ss_al where a->>'tipo' = 'sena' and a->>'nombre' = 'Nora Nopago'), '…y ya no como "falta la seña"');

-- Registrar el pago la recupera (si el horario sigue libre)
select public.registrar_pago(sena_minima(precio_total), 'transferencia', id) from pg_temp.res(:p_a);
select pg_temp.ok((select estado = 'confirmada' and expira_en is null from pg_temp.res(:p_a)), 'al registrar la seña se recupera y queda confirmada');
reset role;
select pg_temp.ok((select not public.libre(consultorio_id, fecha, horas) from pg_temp.res(:p_a)), '…y vuelve a ocupar el horario');
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);

-- Si otro tomó el horario, no se puede recuperar
reset role;
set role anon;
select pg_temp.pedido('Otra Persona', '1179990006', 40, 17, 4) as p_otra \gset
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select pg_temp.espera_error(format('select public.recuperar_reserva(%s)', :r_d), 'SIN_LUGAR');
select pg_temp.espera_error(format('select public.registrar_pago(1000, ''transferencia'', %s)', :r_d), 'SIN_LUGAR');
select pg_temp.ok((select (a->>'libre')::boolean = false from json_array_elements(public.alertas_pago()) a where a->>'nombre' = 'Ocho Ocupado'),
                  'el panel avisa que el horario ya lo tomó otra persona');

-- "Volver a apartar": otra hora
select public.recuperar_reserva(id) from pg_temp.res(:p_c);
select pg_temp.ok((select estado = 'pendiente' and expira_en > now() + interval '59 minutes' from pg_temp.res(:p_c)), 'volver a apartar: otra hora para pagar');
reset role;
select pg_temp.ok((select not public.libre(consultorio_id, fecha, horas) from pg_temp.res(:p_c)), '…y el horario vuelve a estar ocupado');
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);

-- Registrar el pago de un pedido entero también la recupera
select public.registrar_pago_pedido(:p_e, (select precio_total from pg_temp.res(:p_e)), 'transferencia');
select pg_temp.ok((select estado = 'confirmada' from pg_temp.res(:p_e)), 'registrar el pago del pedido la recupera y confirma');

-- Descartar el aviso
select public.descartar_no_pago(id) from pg_temp.res(:p_d);
select pg_temp.ok((select count(*) = 0 from json_array_elements(public.alertas_pago()) a where a->>'nombre' = 'Ocho Ocupado'), 'descartado: deja de aparecer');
reset role;

-- (la tarea automática usa pg_cron, que no está en la base local de prueba)
\o
select 'PRUEBAS DE SIN SEÑA (1 HORA) PASARON' as resultado;

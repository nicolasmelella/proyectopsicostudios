-- Pruebas automáticas de la base (se corren en un Postgres local, NO en Supabase).
-- Uso: ver pruebas/correr_pruebas.sh
\set ON_ERROR_STOP 1
\set QUIET 1

create or replace function pg_temp.espera_error(p_sql text, p_codigo text) returns void
language plpgsql as $$
declare
  v_error text;
begin
  begin
    execute p_sql;
  exception when others then
    v_error := sqlerrm;
  end;
  -- (el control va afuera del bloque: si no hubo error, la falla no la "atrapa" el mismo bloque)
  if v_error is null then
    raise exception 'FALLO: se esperaba el error % y no hubo error en: %', p_codigo, p_sql;
  end if;
  if v_error not like '%' || p_codigo || '%' then
    raise exception 'FALLO: se esperaba % pero salió: %', p_codigo, v_error;
  end if;
  raise notice 'ok  · error esperado %', p_codigo;
end $$;
grant execute on function pg_temp.espera_error(text, text) to anon, authenticated;

create or replace function pg_temp.ok(p_cond boolean, p_msg text) returns void
language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'FALLO: %', p_msg; end if;
  raise notice 'ok  · %', p_msg;
end $$;
grant execute on function pg_temp.ok(boolean, text) to anon, authenticated;

-- Fecha de prueba: el próximo martes
create temp table t as
select (public.hoy_ar() + ((2 - extract(isodow from public.hoy_ar())::int + 7) % 7) + 7)::date as martes;
grant select on t to anon, authenticated;

-- Setup como en Supabase: usuario creado y 03 aplicado
insert into auth.users (email) values ('psicomel@psicostudios.local'), ('intruso@x.com');
\ir ../supabase/03_sena_y_seguridad.sql
\set QUIET 1
select (select id from auth.users where email = 'psicomel@psicostudios.local') as id_equipo,
       (select id from auth.users where email = 'intruso@x.com') as id_intruso \gset
\o /dev/null

-- ============ WEB PÚBLICA (anon) ============
set role anon;
select set_config('request.jwt.claim.sub', '', false);

select pg_temp.ok((select count(*) from public.disponibilidad((select martes from t), (select martes from t))) = 13 * 6,
                  'disponibilidad de un martes vacío: 13 horas x 6 consultorios');

select pg_temp.espera_error($$select * from public.profesionales$$, 'permission denied');
select pg_temp.espera_error($$select * from public.reservas$$, 'permission denied');
select pg_temp.espera_error($$select * from public.pagos$$, 'permission denied');
select pg_temp.espera_error($$insert into public.ocupaciones values (1, current_date, 10, null, null, null)$$, 'permission denied');
select pg_temp.espera_error($$update public.config set valor = '1' where clave = 'porcentaje_sena'$$, 'permission denied');
select pg_temp.espera_error($$select * from public.agenda(current_date, current_date)$$, 'permission denied');
select pg_temp.espera_error($$select public.registrar_pago(100, 'efectivo', 1)$$, 'permission denied');
select pg_temp.ok((select count(*) from public.config) > 0, 'anon puede leer config (alias, horarios)');

-- Reserva web: 10 y 11 hs (mañana: 8500 c/u) → total 17000, seña 8500
create temp table r1 as
select public.crear_reserva('Ana Pérez', '11 2345-6789', 'Psicóloga',
                            (select martes from t), array[10, 11]::smallint[]) as j;
grant select on r1 to authenticated;
select pg_temp.ok((select (j->>'total')::int = 17000 and (j->>'sena')::int = 8500 from r1), 'reserva web: total 17000, seña 8500');
select pg_temp.ok((select j->>'consultorio' = 'Consultorio 1' from r1), 'se asigna el primer consultorio libre');

select pg_temp.espera_error(format($$select public.crear_reserva('Otro', '1199998888', null, %L, array[10]::smallint[], 1::smallint)$$,
                            (select martes from t)), 'SIN_LUGAR');
select pg_temp.espera_error(format($$select public.crear_reserva('X', '1177776666', null, %L, array[8,9,10,11,12,13,14]::smallint[])$$,
                            (select martes from t)), 'DEMASIADAS_HORAS');
select pg_temp.espera_error(format($$select public.crear_reserva('X', '1177776666', null, %L, array[9]::smallint[], 3::smallint)$$,
                            (select martes from t) + 5), 'DOMINGO');

-- Límite de pendientes por WhatsApp (2)
select public.crear_reserva('Ana Pérez', '1123456789', null, (select martes from t), array[15]::smallint[]);
select pg_temp.espera_error(format($$select public.crear_reserva('Ana Pérez', '1123456789', null, %L, array[17]::smallint[])$$,
                            (select martes from t)), 'DEMASIADAS_PENDIENTES');

-- Fijo con bloque de 1 hora: no
select pg_temp.espera_error(format($$select public.crear_solicitud_fijo('Bruno', '1155554444', null, 2::smallint, array[18]::smallint[], %L)$$,
                            (select martes from t)), 'BLOQUE_CORTO');

reset role;

-- ============ PANEL (equipo) ============

-- Un usuario logueado que NO es del equipo no ve nada
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_intruso', false);
select pg_temp.ok((select count(*) from public.reservas) = 0, 'usuario logueado ajeno al equipo no ve reservas');
select pg_temp.espera_error($$select * from public.agenda(current_date, current_date + 30)$$, 'NO_AUTORIZADO');
select pg_temp.espera_error((select format('select public.registrar_pago(8500, %L, %s)', 'efectivo', (j->>'id')) from r1), 'NO_AUTORIZADO');

-- Equipo
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select pg_temp.ok((select count(*) from public.reservas) = 2, 'el equipo ve las reservas');

-- Pago menor a la seña: sigue pendiente
select public.registrar_pago(5000, 'transferencia', (select (j->>'id')::bigint from r1));
select pg_temp.ok((select estado = 'pendiente' from public.reservas where id = (select (j->>'id')::bigint from r1)), 'pago de 5000 (< seña): sigue pendiente');
-- Completa la seña: confirmada
select public.registrar_pago(3500, 'transferencia', (select (j->>'id')::bigint from r1));
select pg_temp.ok((select estado = 'confirmada' and expira_en is null from public.reservas where id = (select (j->>'id')::bigint from r1)), 'llega al 50%: confirmada');
-- No se puede pagar de más
select pg_temp.espera_error((select format('select public.registrar_pago(9000, %L, %s)', 'efectivo', (j->>'id')) from r1), 'PAGO_EXCEDE');
select pg_temp.ok((select monto_total = 17000 and monto_pagado = 8500 and not pagado
                   from public.agenda((select martes from t), (select martes from t)) where hora = 10),
                  'agenda muestra total 17000, pagado 8500');
-- Anular un pago: vuelve a pendiente
select public.anular_pago((select max(id) from public.pagos));
select pg_temp.ok((select estado = 'pendiente' from public.reservas where id = (select (j->>'id')::bigint from r1)), 'anular pago: vuelve a pendiente');

-- Reserva vencida: no se le puede cobrar
reset role;
update public.reservas set expira_en = now() - interval '1 minute' where id = (select max(id) from public.reservas);
select public.liberar_vencidas();
set role authenticated;
select pg_temp.ok((select estado = 'vencida' from public.reservas where id = (select max(id) from public.reservas)), 'reserva sin seña vencida se libera');
select pg_temp.espera_error((select format('select public.registrar_pago(1000, %L, %s)', 'efectivo', max(id)) from public.reservas), 'RESERVA_NO_VIGENTE');

-- Carga desde el panel con seña completa
select public.cargar_reserva('Carla', '1133332222', 2::smallint, (select martes from t), array[19, 20]::smallint[], 9000, 'efectivo');
select pg_temp.ok((select estado = 'confirmada' from public.reservas where id = (select max(id) from public.reservas)), 'carga panel con 50%: confirmada');
select public.cargar_reserva('Dani', '1122221111', 3::smallint, (select martes from t), array[19]::smallint[]);
select pg_temp.ok((select estado = 'pendiente' and expira_en is null from public.reservas where id = (select max(id) from public.reservas)), 'carga panel sin pago: pendiente sin vencimiento');

-- Fijo desde el panel, liberar una semana y feriado (un día normal)
select public.cargar_fijo('Eva', '1111110000', 4::smallint, 2::smallint, array[9, 10]::smallint[], (select martes from t));
select pg_temp.ok((select count(*) from public.ocupaciones where fijo_id = (select max(id) from public.fijos)) >= 20, 'fijo ocupa varias semanas');
select public.liberar_fijo_fecha((select max(id) from public.fijos), (select martes from t) + 7, 'Vacaciones');
select pg_temp.ok((select count(*) from public.agenda((select martes from t) + 7, (select martes from t) + 7) where tipo = 'liberado') = 2, 'semana liberada aparece en agenda');

reset role;
\o
select 'TODAS LAS PRUEBAS PASARON' as resultado;

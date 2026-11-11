-- Pruebas de 22_ya_transferi.sql (al final, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/22_ya_transferi.sql
\set QUIET 1
\o /dev/null

-- Ayudas: la próxima fecha (desde hoy + n días) que cae en ese día de la semana
create or replace function pg_temp.proximo(n integer, dia integer) returns date language sql as $$
  select (public.hoy_ar() + n + ((dia - extract(isodow from public.hoy_ar() + n)::int + 7) % 7))::date $$;
create or replace function pg_temp.lunes(n integer) returns date language sql as $$
  select (public.hoy_ar() + n + (extract(isodow from public.hoy_ar() + n) = 7)::int)::date $$;
grant execute on function pg_temp.proximo(integer, integer), pg_temp.lunes(integer) to anon, authenticated;

-- =====================================================================
-- 1) "Ya transferí"
-- =====================================================================
set role anon;
create temp table yt_a as select public.crear_pedido('Yami Transfiere', '1166000101', 'Psicóloga', 'yami@prueba.com',
  jsonb_build_array(jsonb_build_object('fecha', pg_temp.lunes(44), 'horas', jsonb_build_array(9), 'consultorio', 2))) as j;
create temp table yt_b as select public.crear_pedido('Beto Tarde', '1166000102', 'Psicólogo', 'beto@prueba.com',
  jsonb_build_array(jsonb_build_object('fecha', pg_temp.lunes(44), 'horas', jsonb_build_array(10), 'consultorio', 2))) as j;
create temp table yt_c as select public.crear_pedido('Ceci Sinlugar', '1166000103', 'Psicóloga', 'ceci@prueba.com',
  jsonb_build_array(jsonb_build_object('fecha', pg_temp.lunes(44), 'horas', jsonb_build_array(11), 'consultorio', 2))) as j;
grant select on yt_a, yt_b, yt_c to authenticated, service_role;
reset role;
select (j->>'pedido')::bigint as p_a, j->>'token' as t_a from yt_a \gset
select (j->>'pedido')::bigint as p_b, j->>'token' as t_b from yt_b \gset
select (j->>'pedido')::bigint as p_c, j->>'token' as t_c from yt_c \gset

set role anon;
select pg_temp.espera_error(format('select public.avisar_transferencia(%s, %L)', :p_a, gen_random_uuid()), 'NO_ENCONTRADO');
create temp table yt_r1 as select public.avisar_transferencia(:p_a, :'t_a')::jsonb as r;
create temp table yt_r2 as select public.avisar_transferencia(:p_a, :'t_a')::jsonb as r;
grant select on yt_r1, yt_r2 to authenticated, service_role;
reset role;
select pg_temp.ok((select expira_en > now() + interval '55 minutes' from public.reservas where pedido_id = :p_a),
                  'Ya transferí: el horario queda guardado 1 hora más');
select pg_temp.ok((select count(*) = 1 from public.avisos where pedido_id = :p_a and tipo = 'transferencia_avisada' and canal = 'email')
                  and (select count(*) = 1 from public.avisos where pedido_id = :p_a and tipo = 'equipo_transferencia_avisada'),
                  'Ya transferí: le llega el mail "Estamos revisando tu pago" y al equipo "Avisó que transfirió"');
select pg_temp.ok((select not (r->>'ya_avisado')::boolean from yt_r1) and (select (r->>'ya_avisado')::boolean from yt_r2)
                  and (select expira_en < now() + interval '61 minutes' from public.reservas where pedido_id = :p_a),
                  'tocarlo de nuevo no vuelve a extender el plazo');
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select pg_temp.ok((select a->>'gravedad' = 'transferencia' and a->>'aviso_transferencia_en' is not null
                   from json_array_elements(public.alertas_pago()) a where (a->>'pedido_id')::bigint = :p_a),
                  'en el panel aparece como "Avisó que transfirió"');
select pg_temp.ok((select (a->>'pedido_id')::bigint = :p_a from json_array_elements(public.alertas_pago()) a limit 1),
                  '…y va primero en la lista');
reset role;

-- Avisó un poco tarde: ya se había liberado, pero sigue libre → vuelve
update public.reservas set expira_en = now() - interval '1 minute' where pedido_id in (:p_b, :p_c);
select public.liberar_vencidas();
set role anon;
select public.avisar_transferencia(:p_b, :'t_b');
reset role;
select pg_temp.ok((select estado = 'pendiente' and expira_en > now() + interval '55 minutes' from public.reservas where pedido_id = :p_b),
                  'avisó tarde pero el horario seguía libre: se recupera y queda guardado 1 hora');
-- Avisó tarde y otra persona ya lo tomó → error claro
set role anon;
select public.crear_pedido('Otro Ocupa', '1166000104', 'Psicólogo', 'otro@prueba.com',
  jsonb_build_array(jsonb_build_object('fecha', pg_temp.lunes(44), 'horas', jsonb_build_array(11), 'consultorio', 2)));
select pg_temp.espera_error(format('select public.avisar_transferencia(%s, %L)', :p_c, :'t_c'), 'RESERVA_NO_VIGENTE');
reset role;

-- =====================================================================
-- 2) Fijos pedidos por la web sin pagar: se liberan solos
-- =====================================================================
set role anon;
create temp table yt_f as select public.crear_fijo_web('Fede Fijo', '1166000201', 'Psicólogo', 'fede@prueba.com',
  3::smallint, array[19, 20]::smallint[], pg_temp.proximo(20, 3), 6::smallint)::jsonb as j;
create temp table yt_g as select public.crear_fijo_web('Gabi Fijo', '1166000202', 'Psicóloga', 'gabi@prueba.com',
  4::smallint, array[19, 20]::smallint[], pg_temp.proximo(20, 4), 6::smallint)::jsonb as j;
create temp table yt_h as select public.crear_fijo_web('Hugo Parcial', '1166000203', 'Psicólogo', 'hugo@prueba.com',
  5::smallint, array[19, 20]::smallint[], pg_temp.proximo(20, 5), 6::smallint)::jsonb as j;
grant select on yt_f, yt_g, yt_h to authenticated, service_role;
reset role;
select (j->>'id')::bigint as f_f, (j->>'pedido')::bigint as fp_f from yt_f \gset
select (j->>'id')::bigint as f_g from yt_g \gset
select (j->>'id')::bigint as f_h from yt_h \gset
insert into public.pagos (fijo_id, periodo, monto, medio)
select id, periodo_inicial, 1000, 'transferencia' from public.fijos where id = :f_h;
update public.fijos set expira_en = now() - interval '1 minute' where id in (:f_f, :f_g, :f_h);
select public.liberar_vencidas();
select pg_temp.ok((select estado = 'vencido' from public.fijos where id = :f_f)
                  and not exists (select 1 from public.ocupaciones where fijo_id = :f_f),
                  'fijo sin pagar pasado el plazo: se libera solo (todas las semanas)');
select pg_temp.ok((select estado = 'solicitud' from public.fijos where id = :f_h), 'un fijo con algún pago no se libera');
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select pg_temp.ok((select a->>'tipo' = 'no_pago' and (a->>'libre')::boolean from json_array_elements(public.alertas_pago()) a
                   where (a->>'fijo_id')::bigint = :f_f), 'en el panel aparece como "No pagó" (y sigue libre)');
-- Registrar el primer mes lo recupera
select public.registrar_pago_pedido(:fp_f, (select pago_inicial from public.fijos where id = :f_f), 'transferencia');
select pg_temp.ok((select estado = 'activo' from public.fijos where id = :f_f)
                  and exists (select 1 from public.ocupaciones where fijo_id = :f_f),
                  'al registrar el primer mes, el fijo vuelve y queda activo');
-- Volver a apartar y descartar
select public.recuperar_fijo(:f_g);
select pg_temp.ok((select estado = 'solicitud' and expira_en > now() + interval '55 minutes' from public.fijos where id = :f_g),
                  'volver a apartar un fijo: otra hora para pagar');
reset role;
update public.fijos set expira_en = now() - interval '1 minute' where id = :f_g;
select public.liberar_vencidas();
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select public.descartar_no_pago_fijo(:f_g);
select pg_temp.ok((select count(*) = 0 from json_array_elements(public.alertas_pago()) a where (a->>'fijo_id')::bigint = :f_g),
                  'descartado: deja de aparecer');
reset role;

-- =====================================================================
-- 3) Lo que debe un fijo en el mes descuenta las semanas liberadas
-- =====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select public.cargar_fijo('Irene Cuenta', '1166000301', 6::smallint, 1::smallint, array[8]::smallint[],
  date_trunc('month', public.hoy_ar() + 62)::date + ((1 - extract(isodow from date_trunc('month', public.hoy_ar() + 62))::int + 7) % 7)) as f_i \gset
select to_char(public.hoy_ar() + 62, 'YYYY-MM') as mes_i \gset
create temp table yt_i1 as select public.panel_cuenta_fijo(:f_i, :'mes_i') as c;
select public.liberar_fijo_fecha(:f_i, (select desde from public.fijos where id = :f_i), 'vacaciones');
create temp table yt_i2 as select public.panel_cuenta_fijo(:f_i, :'mes_i') as c;
select pg_temp.ok((select (c->>'semanas')::int from yt_i2) = (select (c->>'semanas')::int - 1 from yt_i1)
                  and (select (c->>'debe')::int from yt_i2) = (select (c->>'debe')::int from yt_i1) - (select precio_semanal from public.fijos where id = :f_i),
                  'liberar una semana descuenta esa semana de lo que debe el mes');
select pg_temp.ok((select x->>'debe' from json_array_elements(public.fijos_del_mes(:'mes_i')) x where (x->>'fijo_id')::bigint = :f_i)
                  = (select c->>'debe' from yt_i2), 'la pestaña Fijos usa la misma cuenta');

-- =====================================================================
-- 4) Baja con fecha futura: sigue activo y debiendo hasta esa fecha
-- =====================================================================
select public.cargar_fijo('Juan Baja', '1166000401', 6::smallint, 2::smallint, array[8]::smallint[], pg_temp.proximo(1, 2)) as f_j \gset
select public.dar_baja_fijo(:f_j, pg_temp.proximo(15, 2));
select pg_temp.ok((select estado = 'activo' and hasta = pg_temp.proximo(15, 2) - 1 from public.fijos where id = :f_j),
                  'baja con fecha futura: el fijo sigue activo hasta esa fecha');
select pg_temp.ok((select count(*) = 0 from public.ocupaciones where fijo_id = :f_j and fecha >= pg_temp.proximo(15, 2)),
                  '…y desde esa fecha el horario queda libre');
reset role;
update public.fijos set hasta = public.hoy_ar() - 1 where id = :f_j;
select public.extender_fijos();
select pg_temp.ok((select estado = 'baja' from public.fijos where id = :f_j), 'pasada la fecha, la tarea diaria lo pasa a baja');

-- =====================================================================
-- 5) Pagos de fijos con control
-- =====================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select (c->>'debe')::int as debe_i from yt_i2 \gset
select pg_temp.espera_error(format('select public.registrar_pago(%s, ''transferencia'', null, %s, %L)', :debe_i + 1, :f_i, :'mes_i'), 'PAGO_EXCEDE');
select pg_temp.espera_error(format('select public.registrar_pago(1000, ''efectivo'', null, %s, ''2031-01'')', :f_i), 'PERIODO_INVALIDO');
select pg_temp.espera_error(format('select public.registrar_pago(1000, ''efectivo'', null, %s, %L)', :f_i, to_char(public.hoy_ar() - 400, 'YYYY-MM')), 'PERIODO_INVALIDO');
select public.registrar_pago(:debe_i, 'transferencia', null, :f_i, :'mes_i');
select pg_temp.espera_error(format('select public.registrar_pago(1, ''transferencia'', null, %s, %L)', :f_i, :'mes_i'), 'PAGO_EXCEDE');
reset role;
select pg_temp.ok(public.monto_pagado_fijo(:f_i, :'mes_i') = :debe_i, 'el mes queda pagado justo, sin pagos de más');

\o
select 'PRUEBAS DE YA TRANSFERÍ Y FIJOS PASARON' as resultado;

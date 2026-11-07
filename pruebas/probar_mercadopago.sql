-- Pruebas de 04_mercadopago.sql (se corre después de probar.sql, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/04_mercadopago.sql
\set QUIET 1
\o /dev/null

create temp table mp as select (select martes from t) + 14 as dia;
grant select on mp to anon, authenticated, service_role;

-- Reserva web nueva (15 y 16 hs, tarde: 9000 c/u → total 18000, seña 9000)
set role anon;
select set_config('request.jwt.claim.sub', '', false);
create temp table rmp as
select public.crear_reserva('Gabi MP', '1188887777', null, (select dia from mp), array[15, 16]::smallint[]) as j;
grant select on rmp to anon, authenticated, service_role;
select pg_temp.ok((select j->>'token' is not null from rmp), 'crear_reserva devuelve el código secreto');

-- Estado con y sin código
select pg_temp.ok((select public.estado_pago_reserva((j->>'id')::bigint, (j->>'token')::uuid)->>'estado' = 'pendiente' from rmp),
                  'la web puede ver el estado con el código');
select pg_temp.espera_error((select format('select public.estado_pago_reserva(%s, %L)', j->>'id', gen_random_uuid()) from rmp), 'NO_ENCONTRADO');
-- La web NO puede preparar ni registrar pagos
select pg_temp.espera_error((select format('select public.preparar_pago_mp(%s, %L)', j->>'id', j->>'token') from rmp), 'permission denied');
select pg_temp.espera_error((select format('select public.registrar_pago_mp(%s, %L, 9000)', j->>'id', '111') from rmp), 'permission denied');
select pg_temp.espera_error($$select * from public.pagos_a_revisar$$, 'permission denied');

-- Servidor (service_role)
set role service_role;
select pg_temp.espera_error((select format('select public.preparar_pago_mp(%s, %L)', j->>'id', j->>'token') from rmp), 'MP_APAGADO');
reset role;
update public.config set valor = 'si' where clave = 'mercadopago_activo';
set role service_role;
select pg_temp.ok((select (public.preparar_pago_mp((j->>'id')::bigint, (j->>'token')::uuid)->>'monto')::int = 9000 from rmp),
                  'preparar_pago_mp cobra la seña: 9000');
select pg_temp.espera_error((select format('select public.preparar_pago_mp(%s, %L)', j->>'id', gen_random_uuid()) from rmp), 'NO_ENCONTRADO');

select pg_temp.ok((select public.registrar_pago_mp((j->>'id')::bigint, '111', 9000) = 'CONFIRMADA' from rmp), 'pago aprobado: CONFIRMADA');
select pg_temp.ok((select public.registrar_pago_mp((j->>'id')::bigint, '111', 9000) = 'YA_REGISTRADO' from rmp), 'mismo aviso dos veces: no duplica');
select pg_temp.ok((select count(*) = 1 from public.pagos where mp_payment_id = '111' and medio = 'mercadopago'), 'queda un solo pago, medio mercadopago');
select pg_temp.espera_error((select format('select public.preparar_pago_mp(%s, %L)', j->>'id', j->>'token') from rmp), 'YA_CONFIRMADA');
select pg_temp.ok((select public.registrar_pago_mp((j->>'id')::bigint, '112', 9001) = 'A_REVISAR' from rmp), 'pago mayor al saldo: a revisar');
reset role;

-- Pago tardío con el horario todavía libre: se recupera
set role anon;
create temp table rv as
select public.crear_reserva('Hugo Tarde', '1166665555', null, (select dia from mp), array[9]::smallint[], 3::smallint) as j;
grant select on rv to service_role;
reset role;
update public.reservas set expira_en = now() - interval '1 minute' where id = (select (j->>'id')::bigint from rv);
select public.liberar_vencidas();
set role service_role;
select pg_temp.espera_error((select format('select public.preparar_pago_mp(%s, %L)', j->>'id', j->>'token') from rv), 'RESERVA_NO_VIGENTE');
select pg_temp.ok((select public.registrar_pago_mp((j->>'id')::bigint, '200', 4250) = 'CONFIRMADA' from rv), 'pagó tarde, horario libre: se recupera y confirma');
reset role;
select pg_temp.ok((select count(*) = 1 from public.ocupaciones where reserva_id = (select (j->>'id')::bigint from rv)), 'vuelve a ocupar el horario');

-- Pago tardío con el horario ya tomado: a revisar
set role anon;
create temp table rw as
select public.crear_reserva('Iris Tarde', '1155553333', null, (select dia from mp), array[11]::smallint[], 3::smallint) as j;
grant select on rw to service_role;
reset role;
update public.reservas set expira_en = now() - interval '1 minute' where id = (select (j->>'id')::bigint from rw);
select public.liberar_vencidas();
set role anon;
select public.crear_reserva('Otra Persona', '1144442222', null, (select dia from mp), array[11]::smallint[], 3::smallint);
set role service_role;
select pg_temp.ok((select public.registrar_pago_mp((j->>'id')::bigint, '300', 4250) = 'A_REVISAR' from rw), 'pagó tarde, horario tomado: a revisar');
select pg_temp.ok((select public.registrar_pago_mp(999999, '400', 100) = 'A_REVISAR'), 'reserva inexistente: a revisar');
reset role;

-- Panel: ve y resuelve los pagos a revisar
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select pg_temp.ok((select count(*) = 3 from public.pagos_a_revisar where not resuelto), 'el equipo ve 3 pagos a revisar');
select public.resolver_pago_revisar((select min(id) from public.pagos_a_revisar), 'Devuelto por MP');
select pg_temp.ok((select count(*) = 2 from public.pagos_a_revisar where not resuelto), 'resolver un pago lo saca de la lista');
select set_config('request.jwt.claim.sub', :'id_intruso', false);
select pg_temp.ok((select count(*) = 0 from public.pagos_a_revisar), 'un usuario ajeno no ve pagos a revisar');
select pg_temp.espera_error($$select public.resolver_pago_revisar(1)$$, 'NO_AUTORIZADO');
reset role;

-- ============ PROTECCIÓN DE LOS DATOS DE COBRO ============
update public.config set valor = 'alias.real' where clave = 'alias_transferencia';  -- como postgres (SQL Editor): se puede
select pg_temp.ok((select valor = 'alias.real' from public.config where clave = 'alias_transferencia'), 'desde el SQL Editor se puede cambiar el alias');

-- El equipo (o quien robe la contraseña del panel) NO puede cambiarlo
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);
update public.config set valor = 'alias.ladron' where clave = 'alias_transferencia';
update public.config set valor = '0000000000000000000666' where clave = 'cvu_transferencia';
update public.config set valor = 'Otra Persona' where clave = 'titular_transferencia';
update public.config set valor = '5491100000666' where clave = 'whatsapp_contacto';
select pg_temp.espera_error($$update public.config set clave = 'alias_transferencia' where clave = 'porcentaje_sena'$$, 'DATO_PROTEGIDO');
reset role;
select pg_temp.ok((select valor = 'alias.real' from public.config where clave = 'alias_transferencia'), 'el equipo NO puede cambiar el alias');
select pg_temp.ok((select valor = 'COMPLETAR' from public.config where clave = 'cvu_transferencia'), 'el equipo NO puede cambiar el CVU');
select pg_temp.ok((select valor <> 'Otra Persona' from public.config where clave = 'titular_transferencia'), 'el equipo NO puede cambiar el titular');
select pg_temp.ok((select valor <> '5491100000666' from public.config where clave = 'whatsapp_contacto'), 'el equipo NO puede cambiar el WhatsApp');
select pg_temp.ok((select count(*) = 1 from public.config where clave = 'porcentaje_sena'), 'el equipo NO puede renombrar un ajuste para pisar el alias');

-- Barrera 2: ni siquiera el servidor (que saltea las reglas de permisos) puede
set role service_role;
select pg_temp.espera_error($$update public.config set valor = 'x' where clave = 'alias_transferencia'$$, 'DATO_PROTEGIDO');
select pg_temp.espera_error($$delete from public.config where clave = 'cvu_transferencia'$$, 'DATO_PROTEGIDO');
select pg_temp.espera_error($$insert into public.config values ('alias_transferencia', 'x', null) on conflict (clave) do update set valor = 'x'$$, 'DATO_PROTEGIDO');
reset role;
-- Nadie de afuera
set role anon;
select pg_temp.espera_error($$update public.config set valor = 'x' where clave = 'alias_transferencia'$$, 'permission denied');
reset role;

-- Los ajustes comunes sí se pueden cambiar desde el panel, y queda registrado
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);
update public.config set valor = '40' where clave = 'porcentaje_sena';
reset role;
select pg_temp.ok((select valor = '40' from public.config where clave = 'porcentaje_sena'), 'el equipo sí puede cambiar el % de seña');
select pg_temp.ok((select datos->'antes'->>'valor' = '50' and datos->'despues'->>'valor' = '40' and usuario = :'id_equipo'::uuid
                   from public.historial where tabla = 'config' and registro_id = 'porcentaje_sena' order by id desc limit 1),
                  'el cambio queda registrado: quién, antes (50) y después (40)');
select pg_temp.ok((select count(*) >= 1 from public.historial where tabla = 'config' and registro_id = 'alias_transferencia'),
                  'el cambio de alias desde el SQL Editor también queda registrado');
update public.config set valor = '50' where clave = 'porcentaje_sena';

-- 04 se puede correr dos veces
\ir ../supabase/04_mercadopago.sql
\set QUIET 1
\o
select 'PRUEBAS DE MERCADO PAGO PASARON' as resultado;

-- Pruebas de 08_avisos.sql (se corre después de probar_comprobantes.sql, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/08_avisos.sql
\set QUIET 1
\o /dev/null

-- Con los avisos apagados (como arranca), no se genera nada
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select public.crear_pedido('Ana Apagado', '1170000001', 'Psicóloga', 'apagado@prueba.com',
  (select jsonb_build_array(jsonb_build_object('fecha', lunes, 'horas', jsonb_build_array(20), 'consultorio', 5)) from dias));
reset role;
select pg_temp.ok((select count(*) = 0 from public.avisos), 'con los avisos apagados no se genera ninguno');

-- Prender mail y WhatsApp (desde el SQL Editor)
update public.config set valor = 'si' where clave in ('avisos_email_activo', 'avisos_whatsapp_activo');
update public.config set valor = 'consultoriospsicostudios@gmail.com' where clave = 'email_equipo';

-- Reserva nueva → "recibimos tu reserva" por mail y WhatsApp + copia al equipo
set role anon;
create temp table pa as select public.crear_pedido('Bruno Avisos', '11 7000-0002', 'Psicólogo', 'bruno@prueba.com',
  (select jsonb_build_array(jsonb_build_object('fecha', lunes, 'horas', jsonb_build_array(19), 'consultorio', 5),
                            jsonb_build_object('fecha', jueves, 'horas', jsonb_build_array(19, 20), 'consultorio', 5)) from dias)) as j;
grant select on pa to service_role, authenticated;
reset role;
create temp table pid as select (j->>'pedido')::bigint as id from pa;
grant select on pid to service_role, authenticated;
select pg_temp.ok((select count(*) = 3 from public.avisos where pedido_id = (select id from pid) and tipo like '%reserva_creada'),
                  'reserva nueva: 3 avisos (mail, WhatsApp y copia al equipo)');
select pg_temp.ok((select destino = '5491170000002' from public.avisos where pedido_id = (select id from pid) and canal = 'whatsapp'),
                  'el WhatsApp va en formato internacional (549…)');
select pg_temp.ok((select jsonb_array_length(datos->'reservas') = 2 and datos->>'token' is not null and datos->'transferencia' ? 'alias'
                   from public.avisos where pedido_id = (select id from pid) and tipo = 'reserva_creada' and canal = 'email'),
                  'el aviso lleva los 2 días, el link y los datos de transferencia');
select pg_temp.ok((select destino = 'consultoriospsicostudios@gmail.com' and datos->'profesional'->>'email' = 'bruno@prueba.com'
                   from public.avisos where tipo = 'equipo_reserva_creada' and pedido_id = (select id from pid)),
                  'la copia al equipo va a la casilla de Psico Studios con los datos del profesional');

-- Pago aprobado → "reserva confirmada": UN aviso por canal aunque sean 2 días
set role service_role;
select public.registrar_pago_pedido_mp((select id from pid), 'av-1', (select (j->>'sena')::int from pa));
reset role;
select pg_temp.ok((select count(*) = 2 from public.avisos where pedido_id = (select id from pid) and tipo = 'reserva_confirmada'),
                  'pago aprobado: 1 aviso de confirmación por canal (no uno por día)');
set role service_role;
select public.registrar_pago_pedido_mp((select id from pid), 'av-1', (select (j->>'sena')::int from pa));
reset role;
select pg_temp.ok((select count(*) = 2 from public.avisos where pedido_id = (select id from pid) and tipo = 'reserva_confirmada'),
                  'un aviso nunca se repite');

-- Cancelada por el equipo → aviso con el motivo
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select public.cancelar_reserva((select min(id) from public.reservas where pedido_id = (select id from pid)), 'Corte de luz en el edificio');
reset role;
select pg_temp.ok((select datos->>'motivo' = 'Corte de luz en el edificio' from public.avisos where tipo = 'reserva_cancelada' and canal = 'email'
                   and pedido_id = (select id from pid)), 'cancelada por el equipo: aviso con el motivo');

-- Pedido que se vence sin pagar → "se venció"
set role anon;
create temp table pv as select public.crear_pedido('Caro Vence', '1170000003', 'Psicóloga', 'caro@prueba.com',
  (select jsonb_build_array(jsonb_build_object('fecha', jueves, 'horas', jsonb_build_array(8), 'consultorio', 5)) from dias)) as j;
reset role;
update public.reservas set expira_en = now() - interval '1 minute' where pedido_id = (select (j->>'pedido')::bigint from pv);
select public.liberar_vencidas();
select pg_temp.ok((select count(*) = 2 from public.avisos where tipo = 'reserva_vencida' and pedido_id = (select (j->>'pedido')::bigint from pv)),
                  'se venció sin pagar: aviso por mail y WhatsApp');

-- Comprobante recibido y rechazado
set role anon;
create temp table pcm as select public.crear_pedido('Dani Compro', '1170000004', 'Psicólogo', 'dani@prueba.com',
  (select jsonb_build_array(jsonb_build_object('fecha', jueves, 'horas', jsonb_build_array(9), 'consultorio', 6)) from dias)) as j;
grant select on pcm to authenticated;
insert into storage.objects (bucket_id, name, metadata)
select 'comprobantes', (j->>'pedido') || '/' || (j->>'token') || '/' || '11111111-1111-1111-1111-111111111111.jpg', '{"mimetype":"image/jpeg","size":1000}' from pcm;
select public.registrar_comprobante((j->>'pedido')::bigint, (j->>'token')::uuid, (j->>'pedido') || '/' || (j->>'token') || '/11111111-1111-1111-1111-111111111111.jpg') from pcm;
reset role;
select pg_temp.ok((select count(*) = 3 from public.avisos where tipo like '%comprobante_recibido' and pedido_id = (select (j->>'pedido')::bigint from pcm)),
                  'comprobante recibido: aviso al profesional (mail y WhatsApp) y al equipo');
set role authenticated;
select public.revisar_comprobante((select id from public.comprobantes where pedido_id = (select (j->>'pedido')::bigint from pcm)), false, null, null, 'No se ve el monto');
reset role;
select pg_temp.ok((select datos->>'motivo' = 'No se ve el monto' from public.avisos where tipo = 'comprobante_rechazado' and canal = 'email'
                   and pedido_id = (select (j->>'pedido')::bigint from pcm)), 'comprobante rechazado: aviso con el motivo');

-- Horario fijo: solicitud y aprobación
set role anon;
create temp table fa as select public.crear_solicitud_fijo('Eli Fijo', '1170000005', 'Psicóloga', 'eli@prueba.com', 6::smallint,
  array[9]::smallint[], (select lunes + 5 from dias)) as j;
grant select on fa to authenticated;
reset role;
select pg_temp.ok((select count(*) = 3 from public.avisos where tipo like '%fijo_solicitado' and fijo_id = (select (j->>'id')::bigint from fa)),
                  'solicitud de fijo: aviso al profesional y al equipo');
set role authenticated;
select public.aprobar_fijo((select (j->>'id')::bigint from fa));
reset role;
select pg_temp.ok((select count(*) = 2 from public.avisos where tipo = 'fijo_aprobado' and fijo_id = (select (j->>'id')::bigint from fa)),
                  'fijo aprobado: aviso por mail y WhatsApp');

-- Seguridad
set role anon;
select pg_temp.espera_error($$select * from public.avisos$$, 'permission denied');
select pg_temp.espera_error($$select * from public.ajustes_privados$$, 'permission denied');
select pg_temp.espera_error($$select public.tomar_avisos(5)$$, 'permission denied');
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select pg_temp.espera_error($$select * from public.ajustes_privados$$, 'permission denied');
select pg_temp.espera_error($$select public.tomar_avisos(5)$$, 'permission denied');
select pg_temp.ok((select json_array_length(public.avisos_de_pedido((select id from pid))) >= 4), 'el equipo ve los avisos de un pedido');
set role service_role;
select pg_temp.espera_error($$update public.config set valor = 'x@ladron.com' where clave = 'email_equipo'$$, 'DATO_PROTEGIDO');

-- El servidor toma avisos y anota el resultado
create temp table lote as select json_array_elements(public.tomar_avisos(50)) as a;
select pg_temp.ok((select count(*) > 10 from lote), 'el servidor toma los avisos pendientes');
select pg_temp.ok((select count(*) = 0 from json_array_elements(public.tomar_avisos(50))), 'un aviso tomado no lo toma otro envío al mismo tiempo');
select public.resultado_aviso((a->>'id')::bigint, true) from lote where a->>'canal' = 'email';
select public.resultado_aviso((a->>'id')::bigint, false, 'WhatsApp no configurado') from lote where a->>'canal' = 'whatsapp';
reset role;
select pg_temp.ok((select count(*) = 0 from public.avisos where canal = 'email' and estado <> 'enviado'), 'mails marcados como enviados');
select pg_temp.ok((select bool_and(estado = 'error' and ultimo_error = 'WhatsApp no configurado') from public.avisos where canal = 'whatsapp'),
                  'los que fallaron quedan con el error');
set role service_role;
select pg_temp.ok((select count(*) > 0 from json_array_elements(public.tomar_avisos(50))), 'los que fallaron se reintentan');
reset role;

\ir ../supabase/08_avisos.sql
\set QUIET 1
\o
select 'PRUEBAS DE AVISOS PASARON' as resultado;

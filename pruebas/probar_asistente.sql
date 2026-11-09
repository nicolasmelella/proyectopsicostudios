-- Pruebas de 20_asistente.sql (al final, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/20_asistente.sql
\set QUIET 1
\o /dev/null

-- Personas de prueba: una admin y una del equipo
insert into auth.users (email) values ('asis-admin@x.com'), ('asis-equipo@x.com'), ('asis-nadie@x.com');
select (select id from auth.users where email = 'asis-admin@x.com') as a_admin,
       (select id from auth.users where email = 'asis-equipo@x.com') as a_equipo,
       (select id from auth.users where email = 'asis-nadie@x.com') as a_nadie \gset
insert into public.equipo (user_id, nombre, rol) values (:'a_admin', 'Ana Admin', 'admin'), (:'a_equipo', 'Eli Equipo', 'equipo');

-- Un día hábil de prueba (dentro de 10 días, no domingo)
create temp table as_ta as
select case when extract(isodow from public.hoy_ar() + 10) = 7 then public.hoy_ar() + 11 else public.hoy_ar() + 10 end as dia;
grant select on as_ta to anon, authenticated, service_role;
grant execute on function pg_temp.ok(boolean, text) to service_role;
grant execute on function pg_temp.espera_error(text, text) to service_role;

-- Una profesional que ya existe, guardada SIN el 54 9
select public.obtener_profesional('Laura Vieja', '1155556666', 'Psicóloga', 'laura@x.com', 'Web');
update public.config set valor = 'no' where clave = 'asistente_activo';

-- ---------------------------------------------------------------------
-- Permisos: la web y el panel no tocan las funciones del servidor
-- ---------------------------------------------------------------------
set role anon;
select pg_temp.espera_error($$select public.asistente_entrada('5491100000000', 'x', 'hola')$$, 'permission denied');
select pg_temp.espera_error($$select * from public.asistente_chats$$, 'permission denied');
select pg_temp.espera_error($$select public.asistente_panel_chats()$$, 'permission denied');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'a_nadie', false);
select pg_temp.espera_error($$select public.asistente_contexto(1)$$, 'permission denied');
select pg_temp.espera_error($$select public.asistente_crear_pedido(1, 'a', 'b', 'c', '[]')$$, 'permission denied');
select pg_temp.espera_error($$select public.asistente_panel_chats()$$, 'NO_AUTORIZADO');
select pg_temp.espera_error($$select public.asistente_panel_guardar_saber(null, 'x', 'pregunta', 'respuesta')$$, 'NO_AUTORIZADO');
select pg_temp.ok((select public.asistente_panel_badge() = 0), 'alguien de afuera: el número de la pestaña es 0');
select pg_temp.ok((select count(*) = 0 from public.asistente_conocimiento), 'alguien de afuera no ve lo que sabe el asistente');
reset role;

-- ---------------------------------------------------------------------
-- Entrada de mensajes
-- ---------------------------------------------------------------------
set role service_role;
create temp table as_e1 as select public.asistente_entrada('5491155556666', 'Lau', 'Hola! tienen lugar el jueves?', 'texto', null, 'wamid.1')::jsonb as r;
select pg_temp.ok((select r->>'contestar' = 'false' and r->>'motivo' = 'apagado' from as_e1), 'apagado: guarda el mensaje pero no contesta');
reset role;
update public.config set valor = 'si' where clave = 'asistente_activo';
set role service_role;
create temp table as_e2 as select public.asistente_entrada('5491155556666', 'Lau', 'sigo acá', 'texto', null, 'wamid.2')::jsonb as r;
select pg_temp.ok((select r->>'motivo' = 'modo_prueba' from as_e2), 'modo prueba: no contesta a números que no son de prueba');
reset role;
insert into public.asistente_numeros (whatsapp, tipo, nombre) values ('5491155556666', 'prueba', 'Laura');
set role service_role;
create temp table as_e3 as select public.asistente_entrada('5491155556666', 'Lau', 'y el jueves a las 10?', 'texto', null, 'wamid.3')::jsonb as r;
select pg_temp.ok((select (r->>'contestar')::boolean from as_e3), 'número de prueba: contesta');
select pg_temp.ok((select (public.asistente_entrada('5491155556666', 'Lau', 'y el jueves a las 10?', 'texto', null, 'wamid.3')::jsonb->>'duplicado')::boolean),
                  'el mismo mensaje dos veces (WhatsApp reintenta): no se duplica');
select (select (r->>'chat_id')::bigint from as_e3) as chat \gset
select (select (r->>'mensaje_id')::bigint from as_e3) as m3, (select (r->>'mensaje_id')::bigint from as_e2) as m2 \gset
reset role;
select pg_temp.ok((select pr.nombre = 'Laura Vieja' from public.asistente_chats c join public.profesionales pr on pr.id = c.profesional_id where c.id = :chat),
                  'reconoce a la profesional aunque esté guardada sin el 54 9');

-- Turnos: con 3 mensajes seguidos, contesta una sola vez
set role service_role;
select pg_temp.ok((select not public.asistente_tomar_turno(:chat, :m2)), 'un mensaje que no es el último no toma el turno');
select pg_temp.ok((select public.asistente_tomar_turno(:chat, :m3)), 'el último mensaje toma el turno');
select pg_temp.ok((select not public.asistente_tomar_turno(:chat, :m3)), 'mientras responde, no hay otro turno en paralelo');
create temp table as_cx as select public.asistente_contexto(:chat)::jsonb as c;
select pg_temp.ok((select jsonb_array_length(c->'nuevos') = 3 from as_cx), 'el contexto trae los 3 mensajes sin leer');
select pg_temp.ok((select c->'cliente'->>'email' = 'laura@x.com' and c->'equipo' = 'null'::jsonb from as_cx), 'trae los datos del cliente; no es del equipo');
select pg_temp.ok((select jsonb_array_length(c->'historial') = 0 from as_cx), 'charla nueva: sin historial');
create temp table as_g1 as select public.asistente_guardar_turno(:chat,
  (select array_agg((x->>'id')::bigint) from as_cx, jsonb_array_elements(c->'nuevos') x), 'Hola Laura! Sí, el jueves hay lugar.',
  '[{"role":"user","content":[{"type":"text","text":"hola"}]},{"role":"assistant","content":[{"type":"text","text":"Hola Laura!"}]}]',
  '{"input_tokens": 1000, "output_tokens": 50}')::jsonb as r;
select pg_temp.ok((select r->>'hay_mas' = 'false' from as_g1), 'guardado: no quedan mensajes sin leer');
select pg_temp.ok((select jsonb_array_length(public.asistente_contexto(:chat)::jsonb->'historial') = 1), 'el próximo turno ve la charla anterior');
select pg_temp.ok((select jsonb_array_length(public.asistente_contexto(:chat)::jsonb->'nuevos') = 0), '…y nada nuevo');
reset role;

-- ---------------------------------------------------------------------
-- Herramientas
-- ---------------------------------------------------------------------
set role service_role;
select pg_temp.ok((select (public.asistente_info()::jsonb->'precio_por_hora'->'horas_sueltas'->>'manana')::int > 0), 'info: precio por hora desde la base');
select pg_temp.ok((select json_array_length(public.asistente_horarios_libres((select dia from as_ta))) >= 5), 'horarios libres por consultorio');
select pg_temp.ok((select jsonb_array_length(public.asistente_resumen((select dia from as_ta), (select dia from as_ta) + 3)::jsonb) >= 3), 'días con lugar');
select pg_temp.ok((select json_array_length(public.asistente_buscar('wifi')) >= 1), 'busca en lo que sabe');

-- Reservar a nombre de quien escribe: usa su ficha (no crea otra profesional)
create temp table as_p1 as select public.asistente_crear_pedido(:chat, 'Laura Vieja', 'Psicóloga', 'laura@x.com',
  jsonb_build_array(jsonb_build_object('fecha', (select dia from as_ta), 'horas', jsonb_build_array(10, 11), 'consultorio', 2)))::jsonb as r;
select (select (r->>'pedido')::bigint from as_p1) as pedido \gset
reset role;
select pg_temp.ok((select count(*) = 1 from public.profesionales where right(whatsapp, 10) = '1155556666'), 'no duplica a la profesional');
select pg_temp.ok((select origen = 'whatsapp' from public.pedidos where id = :pedido), 'el pedido queda marcado como de WhatsApp');
select pg_temp.ok((select count(*) = 1 from public.asistente_pedidos where pedido_id = :pedido), 'y cuenta para el asistente');
set role service_role;
select pg_temp.ok((select jsonb_array_length(public.asistente_mis_reservas('5491155556666')::jsonb->'proximos_turnos') = 1), 'mis reservas: ve su turno');
select pg_temp.ok((select jsonb_array_length(public.asistente_mis_reservas('5491177778888')::jsonb->'proximos_turnos') = 0), 'otro número no ve nada');
select pg_temp.ok((select public.asistente_estado_pedido('5491155556666', :pedido)::jsonb->>'estado' = 'pendiente'), 'estado del pedido');
select pg_temp.espera_error(format($$select public.asistente_estado_pedido('5491177778888', %s)$$, :pedido), 'NO_ENCONTRADO');
select pg_temp.espera_error(format($$select public.asistente_cancelar_pedido('5491177778888', %s)$$, :pedido), 'NO_ENCONTRADO');
select pg_temp.ok((select public.asistente_ruta_comprobante('5491155556666', :pedido, 'jpg') ~ ('^' || :pedido || '/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$')),
                  'ruta del comprobante como la espera la base');

-- Recordatorio de seña: una sola vez, y solo pasado el tiempo configurado
select pg_temp.ok((select json_array_length(public.asistente_para_recordar()) = 0), 'recién reservado: todavía no recuerda');
reset role;
update public.asistente_pedidos set creado_en = now() - interval '2 hours' where pedido_id = :pedido;
set role service_role;
create temp table as_rec as select public.asistente_para_recordar()::jsonb as r;
select pg_temp.ok((select jsonb_array_length(r) = 1 and r->0->'datos'->>'nombre' = 'Laura Vieja' from as_rec), 'pasado el tiempo: recuerda la seña');
select pg_temp.ok((select json_array_length(public.asistente_para_recordar()) = 0), 'no lo recuerda dos veces');
select public.asistente_mensaje_sistema(:chat, 'Te recuerdo la seña', 'Se le recordó la seña');
select pg_temp.ok((select jsonb_array_length(public.asistente_contexto(:chat)::jsonb->'nuevos') = 1), 'el asistente se entera del recordatorio (nota)');
select pg_temp.ok((select (public.asistente_cancelar_pedido('5491155556666', :pedido)::jsonb->>'canceladas')::int = 1), 'cancela su pedido sin pagar');
reset role;
select pg_temp.ok((select bool_and(estado = 'cancelada') from public.reservas where pedido_id = :pedido), 'los horarios quedan libres');

-- Memoria y propuestas
set role service_role;
select public.asistente_recordar('5491155556666', 'Prefiere el Consultorio 2');
select public.asistente_recordar('5491155556666', 'prefiere el consultorio 2');
select pg_temp.ok((select count(*) = 1 from public.asistente_memoria), 'memoria: no anota lo mismo dos veces');
select pg_temp.ok((select public.asistente_contexto(:chat)::jsonb->'memoria'->>0 = 'Prefiere el Consultorio 2'), 'y lo trae en el contexto');
select public.asistente_proponer('¿Tienen estacionamiento?', 'No, hay cocheras a media cuadra.', 'El espacio', 'Lo preguntaron', 'conversacion', :chat);
select pg_temp.ok((select public.asistente_proponer('¿tienen estacionamiento? ', 'Otra', 'X', 'x') is null), 'propuesta repetida: no se duplica');
select public.asistente_derivar(:chat, 'Pide factura A', true);
reset role;

-- Simulador: no es nadie y no reserva de verdad
set role service_role;
create temp table as_s1 as select public.asistente_entrada('sim-' || :'a_equipo', 'Simulador', 'hola', 'texto', null, null, true)::jsonb as r;
select pg_temp.ok((select (r->>'contestar')::boolean from as_s1), 'simulador: contesta siempre (aunque esté en modo prueba)');
select (select (r->>'chat_id')::bigint from as_s1) as sim \gset
select pg_temp.ok((select profesional_id is null from public.asistente_chats where id = :sim), 'el simulador no coincide con ningún profesional');
select pg_temp.espera_error(format($$select public.asistente_crear_pedido(%s, 'a', 'Psicóloga', 'a@a.com', '[]')$$, :sim), 'SIMULADO');
select pg_temp.ok((select (public.asistente_simular_pedido(jsonb_build_array(jsonb_build_object('fecha', (select dia from as_ta), 'horas', jsonb_build_array(10, 11), 'consultorio', 2)))::jsonb->>'total')::int > 0),
                  'simulador: calcula el total sin reservar');
select pg_temp.ok((select json_array_length(public.asistente_mis_reservas('sim-' || :'a_equipo')->'proximos_turnos') = 0), 'el simulador no ve reservas de nadie');
reset role;

-- ---------------------------------------------------------------------
-- Equipo por WhatsApp
-- ---------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :'a_equipo', false);
select pg_temp.espera_error(format($$select public.asistente_panel_guardar_numero('11 4444 5555', 'equipo', 'Eli', %L)$$, :'a_equipo'), 'NO_AUTORIZADO');
select set_config('request.jwt.claim.sub', :'a_admin', false);
select pg_temp.espera_error($$select public.asistente_panel_guardar_numero('11 4444 5555', 'equipo', 'Eli')$$, 'FALTA_PERSONA');
select public.asistente_panel_guardar_numero('11 4444 5555', 'equipo', 'Eli', :'a_equipo');
reset role;
select pg_temp.ok((select whatsapp = '5491144445555' from public.asistente_numeros where tipo = 'equipo'), 'el admin carga el número del equipo (formato internacional)');
set role service_role;
create temp table as_eq as select public.asistente_entrada('5491144445555', 'Eli', 'quién viene mañana?', 'texto', null, 'wamid.eq')::jsonb as r;
select pg_temp.ok((select (r->>'contestar')::boolean from as_eq), 'número del equipo: contesta en modo prueba');
select pg_temp.ok((select public.asistente_contexto((select (r->>'chat_id')::bigint from as_eq))::jsonb->'equipo'->>'nombre' = 'Eli'), 'sabe que es del equipo');
select pg_temp.ok((select public.asistente_consulta_equipo('5491144445555', 'agenda', (select dia from as_ta), (select dia from as_ta)) is not null), 'consulta la agenda como Eli');
select pg_temp.ok((select (public.asistente_consulta_equipo('5491144445555', 'pendientes')::jsonb->>'chats_para_atender')::int = 1), 'pendientes: 1 chat para atender');
select pg_temp.espera_error($$select public.asistente_consulta_equipo('5491155556666', 'agenda')$$, 'NO_AUTORIZADO');
reset role;
update public.equipo set activo = false where user_id = :'a_equipo';
set role service_role;
select pg_temp.espera_error($$select public.asistente_consulta_equipo('5491144445555', 'agenda')$$, 'NO_AUTORIZADO');
select pg_temp.ok((select public.asistente_contexto((select (r->>'chat_id')::bigint from as_eq))::jsonb->'equipo' = 'null'::jsonb), 'desactivada del equipo: pierde el acceso');
reset role;
update public.equipo set activo = true where user_id = :'a_equipo';

-- ---------------------------------------------------------------------
-- Panel
-- ---------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :'a_equipo', false);
select pg_temp.ok((select json_array_length(public.asistente_panel_chats()) = 3), 'panel: ve los chats reales y su propio simulador');
select set_config('request.jwt.claim.sub', :'a_admin', false);
select pg_temp.ok((select json_array_length(public.asistente_panel_chats()) = 2), 'no ve el simulador de otra persona');
select set_config('request.jwt.claim.sub', :'a_equipo', false);
select pg_temp.ok((select (public.asistente_panel_chats()->0->>'id')::bigint = :chat), 'el chat para atender aparece primero');
select pg_temp.ok((select public.asistente_panel_badge() = 2), 'número de la pestaña: 1 para atender + 1 propuesta');
create temp table as_resp as select public.asistente_panel_responder(:chat, 'Hola Laura, sí hacemos factura A.')::jsonb as r;
select pg_temp.ok((select (r->>'ventana_abierta')::boolean and r->>'whatsapp' = '5491155556666' from as_resp), 'responder: devuelve a quién mandarlo');
reset role;
select pg_temp.ok((select not atender and pausa_hasta > now() + interval '50 minutes' from public.asistente_chats where id = :chat),
                  'al contestar el equipo: queda atendido y el asistente se calla un rato');
set role service_role;
create temp table as_e4 as select public.asistente_entrada('5491155556666', 'Lau', 'gracias!', 'texto', null, 'wamid.4')::jsonb as r;
select pg_temp.ok((select r->>'motivo' = 'pausa_equipo' from as_e4), 'mientras el equipo atiende, el asistente no contesta');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'a_equipo', false);
select public.asistente_panel_pausa(:chat, 0);
reset role;
set role service_role;
select pg_temp.ok((select public.asistente_tomar_turno(:chat)), 'devuelto al asistente: vuelve a contestar');
select pg_temp.ok((select jsonb_path_exists(public.asistente_contexto(:chat)::jsonb, '$.nuevos[*] ? (@.rol == "equipo")')),
                  'el asistente ve lo que respondió el equipo');
select public.asistente_soltar_turno(:chat);
reset role;

-- Aprobar lo aprendido
set role authenticated;
select set_config('request.jwt.claim.sub', :'a_equipo', false);
create temp table as_pr as select public.asistente_panel_propuestas()::jsonb as r;
select pg_temp.ok((select jsonb_array_length(r) = 1 from as_pr), 've la propuesta pendiente');
select public.asistente_panel_resolver((select (r->0->>'id')::bigint from as_pr), true, null, 'No, pero hay cocheras a media cuadra sobre la avenida.');
select pg_temp.espera_error(format($$select public.asistente_panel_resolver(%s, true)$$, (select (r->0->>'id')::bigint from as_pr)), 'NO_ENCONTRADO');
reset role;
select pg_temp.ok((select origen = 'aprendido' and respuesta like '%sobre la avenida%' from public.asistente_conocimiento where pregunta = '¿Tienen estacionamiento?'),
                  'aprobada con corrección: el asistente ya lo sabe');
set role service_role;
select pg_temp.ok((select public.asistente_buscar('estacionamiento')::text like '%cocheras%'), 'y lo encuentra al buscar');
-- Una corrección de algo que ya sabía
select public.asistente_proponer('¿Qué incluye?', 'Wifi, aire, café, snacks y agua fresca.', 'El espacio', 'Faltaba el agua', 'revision', null,
  (select id from public.asistente_conocimiento where pregunta = '¿Qué incluye?'));
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'a_equipo', false);
select public.asistente_panel_resolver((select id from public.asistente_propuestas where estado = 'pendiente'), true);
select pg_temp.ok((select count(*) = 1 from public.asistente_conocimiento where pregunta = '¿Qué incluye?' and respuesta like '%agua fresca%'),
                  'una corrección reemplaza la respuesta vieja (no duplica)');
select pg_temp.ok((select (public.asistente_panel_resumen(public.hoy_ar() - 7, public.hoy_ar())::jsonb->'tokens'->>'entrada')::int = 1000), 'resumen: cuenta los tokens');
select public.asistente_panel_reiniciar_simulador();
reset role;
select pg_temp.ok((select count(*) = 0 from public.asistente_chats where whatsapp = 'sim-' || :'a_equipo'), 'reiniciar el simulador borra esa charla');

\o
select 'PRUEBAS DEL ASISTENTE PASARON' as resultado;

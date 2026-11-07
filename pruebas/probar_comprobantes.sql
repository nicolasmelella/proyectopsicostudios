-- Pruebas de 07_comprobantes.sql (se corre después de probar_pedidos.sql, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/07_comprobantes.sql
\set QUIET 1
\o /dev/null

select pg_temp.ok((select not public and file_size_limit = 5242880 and 'application/pdf' = any (allowed_mime_types)
                   from storage.buckets where id = 'comprobantes'), 'espacio "comprobantes" privado, máx. 5 MB, imágenes o PDF');

-- Un pedido nuevo (2 días) para subir comprobantes
set role anon;
select set_config('request.jwt.claim.sub', '', false);
create temp table pc as select public.crear_pedido('Tomás Transfer', '1199001100', 'Psicólogo', 'tomas@prueba.com',
  (select jsonb_build_array(jsonb_build_object('fecha', lunes, 'horas', jsonb_build_array(17), 'consultorio', 4),
                            jsonb_build_object('fecha', jueves, 'horas', jsonb_build_array(17, 18), 'consultorio', 4)) from dias)) as j;
grant select on pc to authenticated;
create temp table rutas as select
  (j->>'pedido') || '/' || (j->>'token') || '/' || gen_random_uuid() || '.jpg' as buena,
  (j->>'pedido') || '/' || gen_random_uuid() || '/' || gen_random_uuid() || '.jpg' as token_falso,
  (j->>'pedido') || '/' || (j->>'token') || '/' || gen_random_uuid() || '.exe' as extension_mala
from pc;
grant select on rutas to authenticated;

-- Subir: con el código del pedido sí; sin código, otra extensión u otro espacio, no
insert into storage.objects (bucket_id, name, metadata) select 'comprobantes', buena, '{"mimetype":"image/jpeg","size":180000}' from rutas;
select pg_temp.ok(true, 'la web puede subir un comprobante con el código del pedido');
select pg_temp.espera_error($$insert into storage.objects (bucket_id, name) select 'comprobantes', token_falso from rutas$$, 'row-level security');
select pg_temp.espera_error($$insert into storage.objects (bucket_id, name) select 'comprobantes', extension_mala from rutas$$, 'row-level security');
select pg_temp.espera_error($$insert into storage.objects (bucket_id, name) select 'otro', buena from rutas$$, 'row-level security');
select pg_temp.ok((select count(*) = 0 from storage.objects), 'nadie de afuera puede ver los comprobantes');
select pg_temp.espera_error($$update storage.objects set name = 'x'$$, 'permission denied');

-- Registrar el comprobante: guarda los horarios unas horas más
select pg_temp.espera_error((select format('select public.registrar_comprobante(%s, %L, %L)', j->>'pedido', gen_random_uuid(), (select buena from rutas)) from pc), 'NO_ENCONTRADO');
select pg_temp.espera_error((select format('select public.registrar_comprobante(%s, %L, %L)', j->>'pedido', j->>'token',
  (j->>'pedido') || '/' || (j->>'token') || '/' || gen_random_uuid() || '.jpg') from pc), 'ARCHIVO_INVALIDO');
create temp table reg as select public.registrar_comprobante((j->>'pedido')::bigint, (j->>'token')::uuid, (select buena from rutas)) as r from pc;
select pg_temp.ok((select (r->>'horarios_guardados_hasta')::timestamptz > now() + interval '11 hours' from reg),
                  'al subir el comprobante, los horarios se guardan 12 horas más');

-- Máximo 5 por pedido
insert into storage.objects (bucket_id, name) select 'comprobantes', (j->>'pedido') || '/' || (j->>'token') || '/' || gen_random_uuid() || '.png' from pc, generate_series(1, 4);
select pg_temp.espera_error((select format($$insert into storage.objects (bucket_id, name) values ('comprobantes', %L)$$,
  (j->>'pedido') || '/' || (j->>'token') || '/' || gen_random_uuid() || '.pdf') from pc), 'row-level security');
select pg_temp.espera_error($$select public.comprobantes_pendientes()$$, 'permission denied');
reset role;

-- Panel
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_intruso', false);
select pg_temp.ok((select count(*) = 0 from storage.objects where bucket_id = 'comprobantes'), 'un usuario ajeno al equipo no ve los comprobantes');
select pg_temp.espera_error($$select public.comprobantes_pendientes()$$, 'NO_AUTORIZADO');
select set_config('request.jwt.claim.sub', :'id_equipo', false);
select pg_temp.ok((select count(*) = 5 from storage.objects where bucket_id = 'comprobantes'), 'el equipo ve los comprobantes');
create temp table cp as select json_array_elements(public.comprobantes_pendientes()) as c;
select pg_temp.ok((select count(*) = 1 and (min(c->>'falta_sena'))::int = 4500 + 9000 and min(c->>'nombre') = 'Tomás Transfer' from cp),
                  'el panel lista el comprobante con lo que falta de seña ($13.500)');
select pg_temp.espera_error((select format('select public.revisar_comprobante(%s, true, %s)', c->>'id', (c->>'falta_total')::int + 1) from cp), 'PAGO_EXCEDE');
select pg_temp.ok((select public.revisar_comprobante((c->>'id')::bigint, true, (c->>'falta_sena')::int) = 'CONFIRMADA' from cp),
                  'aceptar con la seña: el pedido queda confirmado');
select pg_temp.ok((select bool_and(estado = 'confirmada') from public.reservas where pedido_id = (select (j->>'pedido')::bigint from pc)),
                  'los 2 días quedaron confirmados');
select pg_temp.ok((select count(*) = 2 and sum(monto) = 13500 from public.pagos p join public.reservas r on r.id = p.reserva_id
                   where r.pedido_id = (select (j->>'pedido')::bigint from pc) and p.medio = 'transferencia'),
                  'el pago se repartió entre los 2 días');
select pg_temp.espera_error((select format('select public.revisar_comprobante(%s, true, 1)', c->>'id') from cp), 'NO_ENCONTRADO');
reset role;
insert into public.comprobantes (pedido_id, ruta) select (j->>'pedido')::bigint, 'x/rechazo' from pc;
set role authenticated;
select public.revisar_comprobante((select max(id) from public.comprobantes), false, null, null, 'No se lee el monto');
select pg_temp.ok((select estado = 'rechazado' and nota = 'No se lee el monto' from public.comprobantes where ruta = 'x/rechazo'), 'rechazar con nota');
reset role;

\ir ../supabase/07_comprobantes.sql
\set QUIET 1
\o
select 'PRUEBAS DE COMPROBANTES PASARON' as resultado;

-- Pruebas de 11_comentarios.sql (después de probar_cobros.sql, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
\ir ../supabase/11_comentarios.sql
\set QUIET 1
\o /dev/null

set role authenticated;
select set_config('request.jwt.claim.sub', :'id_bianca', false);
select public.guardar_comentario('  Trae camilla  ', (select id from cb));
select pg_temp.ok((select detalle = 'Trae camilla' from public.agenda((select lunes + 2 from sem), (select lunes + 2 from sem))
                   where reserva_id = (select id from cb) limit 1), 'el comentario se ve en la agenda');
select public.guardar_comentario('   ', (select id from cb));
select pg_temp.ok((select comentario is null from public.reservas where id = (select id from cb)), 'un comentario vacío se borra');
select pg_temp.espera_error($$select public.guardar_comentario('hola')$$, 'NO_ENCONTRADO');
select set_config('request.jwt.claim.sub', :'id_intruso', false);
select pg_temp.espera_error($$select public.guardar_comentario('hola', (select id from cb))$$, 'NO_AUTORIZADO');
reset role;
set role anon;
select pg_temp.espera_error($$select public.guardar_comentario('hola', 1)$$, 'permission denied');
select pg_temp.espera_error($$select * from public.agenda(current_date, current_date)$$, 'permission denied');
reset role;

\ir ../supabase/11_comentarios.sql
\set QUIET 1
\o
select 'PRUEBAS DE COMENTARIOS PASARON' as resultado;

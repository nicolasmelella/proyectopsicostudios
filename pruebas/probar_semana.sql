-- Pruebas de 09_semana.sql (se corre después de probar_avisos.sql, en la misma sesión).
\set ON_ERROR_STOP 1
\set QUIET 1
insert into auth.users (email) values ('bianca@psicostudios.local'), ('mama@psicostudios.local');
\ir ../supabase/09_semana.sql
\set QUIET 1
select (select id from auth.users where email = 'bianca@psicostudios.local') as id_bianca,
       (select id from auth.users where email = 'mama@psicostudios.local') as id_mama \gset
\o /dev/null

select pg_temp.ok((select count(*) = 3 from public.equipo), 'quedan 3 usuarios en el equipo (psicomel, bianca, mama)');
select pg_temp.ok((select rol = 'admin' from public.equipo where user_id = :'id_equipo'), 'psicomel sigue siendo admin');
select pg_temp.ok((select nombre = 'Bianca' from public.equipo where user_id = :'id_bianca'), 'el nombre sale del usuario');

create temp table sem as select (public.hoy_ar() + ((8 - extract(isodow from public.hoy_ar())::int) % 7) + 7)::date as lunes;
grant select on sem to anon, authenticated;

-- Notas de la semana
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_bianca', false);
select public.agregar_nota((select lunes + 3 from sem), '  Ana no viene el jueves  ');
reset role;
select pg_temp.ok((select semana = (select lunes from sem) and texto = 'Ana no viene el jueves' and autor_nombre = 'Bianca'
                   from public.notas_semana), 'la nota se guarda en el lunes de esa semana, con quién la escribió');
set role authenticated;
select pg_temp.espera_error($$select public.agregar_nota(current_date, '   ')$$, 'NOTA_VACIA');
select set_config('request.jwt.claim.sub', :'id_intruso', false);
select pg_temp.espera_error($$select public.agregar_nota(current_date, 'hola')$$, 'NO_AUTORIZADO');
select pg_temp.ok((select count(*) = 0 from public.notas_semana), 'alguien de afuera no ve las notas');
reset role;
set role anon;
select pg_temp.espera_error($$select * from public.notas_semana$$, 'permission denied');
select pg_temp.espera_error($$select public.borrar_nota(1)$$, 'permission denied');
reset role;
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_mama', false);
select public.borrar_nota((select id from public.notas_semana limit 1));
reset role;
select pg_temp.ok((select count(*) = 0 from public.notas_semana), 'otra persona del equipo puede borrar la nota');

-- Deshacer una carga
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_bianca', false);
create temp table carga as select public.cargar_reserva('Paula Deshacer', '1170009999', 2::smallint,
  (select lunes + 1 from sem), array[15, 16]::smallint[], 8500, 'transferencia') as id;
grant select on carga to authenticated;
reset role;
select pg_temp.ok((select count(*) = 2 from public.ocupaciones where reserva_id = (select id from carga)), 'carga hecha: 2 horas ocupadas');
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_mama', false);
select pg_temp.espera_error($$select public.deshacer_carga((select id from carga))$$, 'NO_SE_PUEDE_DESHACER');
select set_config('request.jwt.claim.sub', :'id_bianca', false);
select public.deshacer_carga((select id from carga));
reset role;
select pg_temp.ok((select not exists (select 1 from public.reservas where id = (select id from carga))
                     and not exists (select 1 from public.ocupaciones where reserva_id = (select id from carga))
                     and not exists (select 1 from public.pagos where reserva_id = (select id from carga))),
                  'deshacer: se borra la reserva con su pago y las horas quedan libres');
select pg_temp.ok((select count(*) = 0 from public.avisos where tipo = 'reserva_cancelada' and datos->>'nombre' = 'Paula Deshacer'),
                  'deshacer no le manda "cancelada" al profesional');

-- Una carga vieja ya no se deshace
set role authenticated;
select set_config('request.jwt.claim.sub', :'id_bianca', false);
create temp table carga2 as select public.cargar_reserva('Paula Deshacer', '1170009999', 2::smallint,
  (select lunes + 1 from sem), array[15]::smallint[]) as id;
grant select on carga2 to authenticated;
reset role;
update public.reservas set creado_en = now() - interval '20 minutes' where id = (select id from carga2);
set role authenticated;
select pg_temp.espera_error($$select public.deshacer_carga((select id from carga2))$$, 'NO_SE_PUEDE_DESHACER');
reset role;

\ir ../supabase/09_semana.sql
\set QUIET 1
\o
select 'PRUEBAS DE LA SEMANA PASARON' as resultado;

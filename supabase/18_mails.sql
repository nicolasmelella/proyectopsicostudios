-- =====================================================================
-- PSICOSTUDIOS · 18_mails.sql
-- Los mails del horario fijo pedido por la web ahora llevan el primer mes
-- a pagar, los datos para transferir y el link para subir el comprobante.
-- (El aviso se arma al confirmar la operación, cuando el pedido ya existe.)
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Requiere 01 a 17. Se puede correr más de una vez.
-- =====================================================================

create or replace function public.aviso_fijo() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  f public.fijos;
  v_datos jsonb;
begin
  -- el aviso corre al final de la operación: se lee el fijo como quedó (con su pedido y el primer mes)
  select * into f from public.fijos where id = new.id;
  if not found then return null; end if;
  v_datos := jsonb_build_object(
    'nombre', (select nombre from public.profesionales where id = f.profesional_id),
    'dia', f.dia_semana, 'horas', f.horas, 'desde', f.desde, 'precio_semanal', f.precio_semanal,
    'consultorio', (select nombre from public.consultorios where id = f.consultorio_id), 'fijo', f.id,
    'pago_inicial', f.pago_inicial, 'pedido', f.pedido_id,
    'token', (select token from public.pedidos where id = f.pedido_id),
    'reservas', (select coalesce(jsonb_agg(jsonb_build_object('fecha', d, 'horas', f.horas,
                   'consultorio', (select nombre from public.consultorios where id = f.consultorio_id)) order by d), '[]'::jsonb)
                 from unnest(public.fechas_primer_mes(f.id)) d),
    'transferencia', public.datos_transferencia());
  if tg_op = 'INSERT' and new.estado = 'solicitud' and new.origen = 'web' then
    perform public.encolar_aviso('fijo_solicitado', 'fijo:' || f.id, f.profesional_id, v_datos, f.pedido_id, null, f.id);
  elsif tg_op = 'UPDATE' and old.estado = 'solicitud' and new.estado = 'activo' then
    perform public.encolar_aviso('fijo_aprobado', 'fijo:' || f.id, f.profesional_id, v_datos, f.pedido_id, null, f.id);
  elsif tg_op = 'UPDATE' and old.estado = 'solicitud' and new.estado = 'rechazado' then
    perform public.encolar_aviso('fijo_rechazado', 'fijo:' || f.id, f.profesional_id, v_datos, f.pedido_id, null, f.id);
  end if;
  return null;
end $$;
revoke execute on function public.aviso_fijo() from public, anon, authenticated;

select 'Mails del fijo actualizados' as resultado;

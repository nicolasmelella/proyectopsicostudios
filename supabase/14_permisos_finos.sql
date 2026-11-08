-- =====================================================================
-- PSICOSTUDIOS · 14: cierra funciones internas que se disparan solas
-- (avisos e historial de ajustes). No hacen falta desde afuera: los disparadores
-- siguen funcionando igual. Lo pide el control de seguridad de Supabase.
-- Se puede correr las veces que haga falta.
-- =====================================================================
revoke execute on function public.aviso_comprobante(), public.aviso_fijo(), public.aviso_pedido_nuevo(),
  public.aviso_reserva_estado(), public.registrar_cambio_ajuste() from public, anon, authenticated;

select 'Permisos finos aplicados' as resultado;

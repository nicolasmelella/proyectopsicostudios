-- =====================================================================
-- PSICOSTUDIOS · 19_sin_subida_web.sql
-- Un solo camino para confirmar: la persona transfiere y ENVÍA LA RESERVA
-- POR WHATSAPP con el comprobante. Desde la web ya no se puede subir nada:
-- se cierra la subida de archivos y el registro de comprobantes desde afuera.
-- (Los comprobantes que ya se subieron siguen visibles en el panel.)
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Requiere 01 a 18. Se puede correr más de una vez.
-- =====================================================================

drop policy if exists "web sube comprobantes" on storage.objects;
revoke execute on function public.registrar_comprobante(bigint, uuid, text) from public, anon, authenticated;

select 'Subida de comprobantes desde la web: cerrada (todo se confirma por WhatsApp)' as resultado;

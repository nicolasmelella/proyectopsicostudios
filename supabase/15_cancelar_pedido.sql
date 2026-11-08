-- =====================================================================
-- PSICOSTUDIOS · 15_cancelar_pedido.sql
-- La persona que reservó desde la web puede CANCELAR su pedido mientras
-- todavía no pagó nada (ni seña por Mercado Pago ni comprobante subido).
-- Los horarios quedan libres al instante.
--   · Solo con el código secreto del pedido (el mismo del link para pagar).
--   · Si ya pagó o subió un comprobante, no se puede: tiene que escribirnos.
--
-- Cómo usarlo: Supabase → SQL Editor → New query → pegar TODO → Run.
-- Requiere 01 a 14. Se puede correr más de una vez.
-- =====================================================================

create or replace function public.cancelar_pedido_web(p_pedido_id bigint, p_token uuid) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if not exists (select 1 from public.pedidos where id = p_pedido_id and token = p_token) then
    raise exception 'NO_ENCONTRADO' using hint = 'No encontramos ese pedido';
  end if;
  if exists (select 1 from public.reservas r where r.pedido_id = p_pedido_id
              and (r.estado = 'confirmada' or public.monto_pagado_reserva(r.id) > 0))
     or exists (select 1 from public.comprobantes c where c.pedido_id = p_pedido_id) then
    raise exception 'YA_PAGADO'
      using hint = 'Este pedido ya tiene un pago o un comprobante. Para cancelarlo escribinos por WhatsApp.';
  end if;

  with c as (
    update public.reservas
    set estado = 'cancelada', cancelada_en = now(), motivo_cancelacion = 'La canceló la persona desde la web'
    where pedido_id = p_pedido_id and estado = 'pendiente'
    returning id)
  delete from public.ocupaciones o using c where o.reserva_id = c.id;

  select count(*) into v_n from public.reservas where pedido_id = p_pedido_id and estado = 'cancelada';
  return json_build_object('pedido', p_pedido_id, 'canceladas', v_n);
end $$;

revoke all on function public.cancelar_pedido_web(bigint, uuid) from public;
grant execute on function public.cancelar_pedido_web(bigint, uuid) to anon, authenticated;

select 'Cancelar pedido desde la web: listo' as resultado;

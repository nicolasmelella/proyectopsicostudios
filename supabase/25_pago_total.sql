-- =====================================================================
-- 25 · Por horas se paga el total (sin seña)
-- Las reservas por horas (flexibles) se confirman solo con el pago total.
-- Se hace con el mismo dato que ya usa toda la base: el porcentaje que hay
-- que pagar para confirmar pasa a ser 100. No cambia lo ya confirmado.
-- (El horario fijo sigue pagándose por mes, como siempre.)
-- =====================================================================
update public.config
   set valor = '100',
       descripcion = 'Porcentaje del total que hay que pagar para confirmar una reserva por horas (100 = se paga el total, sin seña)'
 where clave = 'porcentaje_sena';

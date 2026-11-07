# Psico Studios · Reglas del negocio

Este documento junta **cómo funcionan las reservas** y **qué reglas faltan programar**.
Si algo de acá cambia, se actualiza este archivo primero.

Estado: ✅ funciona en el sistema · 🕓 pendiente (documentado, todavía no programado)

---

## 1. Dos formas de alquilar

| | **Horas sueltas** (pestaña "Por horas") | **Horario fijo** (pestaña "Horario fijo semanal") |
|---|---|---|
| Qué es | Una o varias horas, en uno o varios días puntuales | El mismo día y horario **todas las semanas** |
| Mínimo | 1 hora | 2 horas seguidas |
| Precio por hora | Mañana $8.500 · Tarde $9.000 | Mañana $8.200 · Tarde $8.500 |
| Cómo se confirma | Pagando la **seña (50%)** online o por transferencia | El equipo **aprueba la solicitud** desde el panel |
| Si no se confirma | Se libera sola a las **2 horas** | Se libera sola a las **48 horas** |
| Cómo se cobra | Seña al reservar + saldo (ver punto 4) | Por mes, se registra en el panel |

Mañana: de 8 a 13 hs · Tarde: de 13 a 21 hs · Lunes a sábado.
Los precios y horarios se cambian desde el panel → **Precios y ajustes**.

## 2. Horas sueltas: pedidos de varios días ✅

- Se pueden reservar **varios días en un mismo pedido** (ej: lunes en el Consultorio 1 y jueves en el Consultorio 3), hasta 8 días.
- La persona deja sus datos **una sola vez** (nombre, profesión, celular y mail, todos obligatorios) y paga **una sola seña** por todo.
- **Todo o nada:** si mientras completa los datos alguien ocupa uno de los días, no se reserva ninguno y se le avisa cuál.
- Un pedido cuenta como **una** reserva sin pagar (máximo 2 por persona).
- La agenda online está abierta **2 meses de calendario** (hoy 7/11 → hasta el 7/1).

## 3. Seña ✅

- Para confirmar se paga el **50% del total** (configurable en el panel).
- Plazo para pagarla: **2 horas** desde que se reserva. Si no se paga, los horarios se liberan solos.
- Con Mercado Pago la reserva se confirma sola. Por transferencia, el equipo registra la seña en el panel.
- Pagos tardíos o de más quedan en el panel como **"Pagos de Mercado Pago a revisar"**.

## 4. Saldo (el 50% restante) 🕓 PENDIENTE — reglas decididas

> Definido por el equipo, **todavía no programado**. Hoy la web dice que el saldo
> "se abona el día de cada turno": cuando se programe, hay que cambiar ese texto.

**Reglas decididas:**
1. **Recordatorio 2 días antes** de la fecha reservada, **por mail y por WhatsApp automático**: hay que pagar el
   **50% restante**.
2. El aviso informa que, si el saldo **no se paga hasta las 22:00 del día anterior**, la reserva **se cancela y
   la seña no se devuelve**.
3. Pasado ese horario sin el pago completo, el panel marca la reserva como **"saldo vencido"** y **el equipo decide**
   si la cancela (botón "Cancelar sin devolución") o hace una excepción. No se cancela sola.
4. **Reservas hechas con menos de 2 días de anticipación:** se cobra el **100% al reservar** (no hay seña + saldo).
5. **El saldo se paga por Mercado Pago o por transferencia.**
6. **La condición se acepta al reservar:** la casilla "Entiendo que…" suma "si no pago el saldo hasta las 22:00 del día
   anterior, la reserva se cancela sin devolución de la seña".

**Ejemplo:** reserva para el jueves 12/11.
- Martes 10/11: llega el recordatorio (mail + WhatsApp) para pagar el saldo.
- Miércoles 11/11 hasta las 22:00: plazo para pagarlo.
- Miércoles 11/11 después de las 22:00, sin pago: el panel la marca "saldo vencido" y el equipo decide.

**Falta decidir (ver ejemplo):** en un **pedido de varios días**, ¿el saldo se maneja **por cada día** o **todo junto**?

> Pedido: lunes 16/11 (Consultorio 1, 2 horas, $17.000) + jueves 19/11 (Consultorio 3, 1 hora, $9.000).
> Seña pagada al reservar: $13.000. Saldo: $8.500 del lunes + $4.500 del jueves.
>
> - **Opción A, por cada día (recomendada):** sábado 14/11 llega el aviso por el saldo del lunes ($8.500, hasta el
>   domingo 15/11 a las 22:00). Martes 17/11 llega el aviso por el saldo del jueves ($4.500, hasta el miércoles 18/11
>   a las 22:00). Si no paga el lunes, se cancela solo el lunes; el jueves sigue en pie.
> - **Opción B, todo junto:** sábado 14/11 llega un solo aviso por todo el saldo ($13.000, hasta el domingo a las 22:00).
>   Si no paga, se cancelan los dos días, aunque el jueves faltara casi una semana.

**Qué habría que programar (referencia técnica):**
- Base: plazo de saldo por reserva y una tarea automática que cada día marque los recordatorios a enviar y, a las
  22:00, las reservas con "saldo vencido".
- Envío: mail (servicio como Resend) y WhatsApp automático (API oficial de WhatsApp Business de Meta: tiene costo
  por mensaje y la plantilla del mensaje la tiene que aprobar Meta).
- Web: cobrar el 100% si faltan menos de 2 días, cambiar el texto del saldo y sumar la condición a la casilla.
- Mercado Pago: pagar el saldo con el mismo mecanismo que la seña (link en el recordatorio).
- Panel: lista "Saldos por vencer / vencidos" y botón "Cancelar sin devolución".

## 5. Subir el comprobante de pago 🕓 PENDIENTE

Para quien paga **por transferencia** (la seña o el saldo): en vez de mandar la captura por WhatsApp, la sube en la web.

- Después de reservar (y desde el link del recordatorio) aparece **"Subir comprobante"**: foto o PDF del pago.
- En el panel aparece **"Comprobantes para revisar"** con la imagen; el equipo la mira y toca **"Registrar pago"**.
- Seguridad: los comprobantes se guardan en un espacio **privado** de Supabase. Solo se pueden subir con el código
  secreto del pedido, y solo el equipo los puede ver. Máximo 5 MB, solo imágenes o PDF.
- Mercado Pago no lo necesita: ahí la confirmación es automática.

## 6. Datos de cobro y seguridad ✅

- Alias, CVU, titular y WhatsApp **solo se cambian desde Supabase** (ver README, paso 7): ni con la
  contraseña del panel se pueden modificar.
- Todo cambio de ajustes y precios queda registrado (quién, cuándo, antes y después).

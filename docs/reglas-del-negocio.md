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

## 4. Saldo (el 50% restante) 🕓 PENDIENTE

> Regla definida por el equipo, **todavía no programada**. Hoy la web dice que el saldo
> "se abona el día de cada turno": cuando se programe esta regla, hay que cambiar ese texto.

**Regla:**
1. **Recordatorio 2 días antes** de cada fecha reservada: se le avisa a la persona que tiene que
   pagar el **50% restante**.
2. En ese mismo aviso se informa que, **si no paga el saldo hasta 1 día antes**, la reserva
   **se cancela y la seña no se devuelve**.
3. Si llega el plazo sin el pago completo: se cancela la reserva, se libera el horario y la seña queda
   para Psico Studios.

**Ejemplo:** reserva para el jueves 12/11.
- Martes 10/11: llega el recordatorio para pagar el saldo.
- Hasta el miércoles 11/11: plazo para pagarlo.
- Si el jueves no está pagado: la reserva se cancela, sin devolución de la seña.

**A definir antes de programarlo:**
- [ ] **Por dónde se avisa:** mail (ya pedimos el mail), WhatsApp automático (tiene costo por mensaje, vía la API de WhatsApp Business)
      o una lista diaria en el panel para que el equipo mande el WhatsApp a mano.
- [ ] **Hora exacta del corte:** "1 día antes" ¿hasta qué hora? (ej: 20:00 del día anterior).
- [ ] **Reservas hechas con menos de 2 días de anticipación:** ¿se pide el 100% al reservar, o el
      recordatorio sale enseguida?
- [ ] **Pedidos de varios días:** ¿un recordatorio por cada día (2 días antes de cada uno)? Propuesta: sí,
      y el saldo se paga día por día.
- [ ] **¿Se cancela solo o lo decide el equipo?** Propuesta: el panel muestra "saldo vencido" y el equipo cancela
      con un botón, para poder hacer excepciones.
- [ ] **Cómo se paga el saldo:** link de Mercado Pago (como la seña) y/o transferencia.
- [ ] **Texto legal:** sumar esta condición en la web, en el momento de reservar, para que la persona la acepte
      antes de pagar la seña (hoy acepta solo la regla de las 2 horas).

**Qué habría que programar (referencia técnica):**
- Base: un plazo de saldo por reserva y una tarea automática diaria (como las de `02_tareas_automaticas.sql`)
  que marque los recordatorios a enviar y las reservas con saldo vencido.
- Envío: mail (con un servicio como Resend) o WhatsApp Business, desde una función del servidor.
- Web: cambiar el texto del saldo y sumar la condición a la casilla "Entiendo que…".
- Mercado Pago: permitir pagar el saldo con el mismo mecanismo que la seña.
- Panel: lista "Saldos por vencer / vencidos" y botón de cancelar sin devolución.

## 5. Datos de cobro y seguridad ✅

- Alias, CVU, titular y WhatsApp **solo se cambian desde Supabase** (ver README, paso 7): ni con la
  contraseña del panel se pueden modificar.
- Todo cambio de ajustes y precios queda registrado (quién, cuándo, antes y después).

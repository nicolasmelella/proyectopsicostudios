# Asistente de WhatsApp con inteligencia artificial

Un asistente (por defecto se llama **Sofía**) que contesta el WhatsApp de Psico Studios solo, las 24 horas.
Usa **Claude** (la inteligencia artificial de Anthropic) y está conectado a la misma base que la web y el panel.

## Qué hace

| Hace solo | Siempre lo pasa al equipo |
|---|---|
| Contesta dudas (el espacio, cómo reservar, el fijo, cómo se paga) | Registrar pagos o dar algo por pagado |
| Precios, seña, horarios y reglas **leídos de la base** (si cambian en el panel, cambia la respuesta) | Cancelar algo que ya tiene un pago o comprobante |
| Busca disponibilidad y, si está lleno, ofrece **alternativas** (otro consultorio, otro horario, otro día) | Descuentos, excepciones, extender plazos |
| **Reserva** horas sueltas (uno o varios días) y pide **horario fijo**, después de mostrar un resumen y recibir un “sí” | Lo que no sabe (no inventa) |
| Pasa los datos de pago y el link “Mi reserva” | Reclamos, enojos o quien pide hablar con una persona |
| Recibe la **foto o PDF del comprobante**, lo lee y lo deja en *Pendientes → Comprobantes para revisar* | Temas de salud o crisis (sugiere emergencias y avisa como urgente) |
| Le dice a cada persona el estado de **sus** reservas (solo las de su número) | |
| Cancela un pedido **sin pagar** si la persona lo pide | |
| **Recuerda la seña** una vez a quien reservó y no pagó | |
| **Seguimiento:** si alguien consultó y no reservó, le vuelve a escribir **una vez** con algo concreto (“el martes a las 15 sigue libre”), o decide no escribir si sería insistente | |
| Manda **fotos** de los consultorios, del Salón y del espacio | |
| **Precalifica** a cada contacto (qué busca, cuánto vale por mes) y marca como 🔥 prioridad los fijos, muchas horas o el Salón | |
| Reconoce a quien ya es cliente (“¿lo mismo de siempre, martes a la tarde?”) | |
| Responde en el idioma en que le escriben | |

Lo que reserva aparece en el panel como cualquier reserva, con las mismas reglas (seña, plazos, límites).
Los pedidos que toma quedan marcados con origen **WhatsApp**.

**Para el equipo:** si escribe un número cargado como *Equipo*, además puede preguntarle cosas del panel:
“¿quién viene mañana?”, “¿qué falta cobrar?”, “¿cómo vamos este mes?”, “¿qué hay pendiente?”.
Responde con los permisos del usuario del panel de esa persona.

## CRM: cada contacto con su etapa

En *Asistente → Conversaciones* cada contacto tiene una **etapa**: Nuevo → Consultó → Interesado → Reservó → Pagó (o Perdido).
- *Consultó / Interesado / Perdido* los pone el asistente (o el equipo a mano). *Reservó* y *Pagó* **salen solos de la base**
  (de los pedidos y pagos reales), así que no se pueden “inflar”.
- Cada contacto muestra qué busca, el valor estimado por mes y si es 🔥 **prioridad**. Se puede **asignar** a alguien del equipo
  (“Lo sigue: Silvia”) y filtrar por etapa, prioridad o “los que sigo yo”.
- En *Asistente → Resumen*: **embudo**, **tasa de cierre**, **cuánto tarda en responder** el asistente y el equipo, y la lista
  de **oportunidades abiertas** (interesados que todavía no reservaron).

## Cómo aprende (y por qué es seguro)

La IA no se “reentrena” sola: lo que crece es lo que **sabe** y lo que **recuerda**, siempre bajo control del equipo.

1. **Memoria por cliente.** Anota datos útiles de cada persona (consultorio preferido, días habituales, cómo paga).
   Se ven y se pueden borrar en *Asistente → Conversaciones*, abajo de cada chat.
2. **Aprende de las respuestas del equipo.** Cuando alguien del equipo contesta desde el panel, el asistente mira si
   hay algo general para aprender (ej. “¿se puede ir con mascota?”) y lo propone en *Asistente → Aprendizaje*.
3. **Revisión semanal.** Cada lunes a las 9 lee las charlas de la semana y deja un informe en *Asistente → Resumen*:
   de qué preguntan, qué no supo responder, reservas que se perdieron y por qué, días y franjas que pidieron y estaban
   llenos, errores e ideas para el negocio. También deja propuestas para aprobar.

**Nada de lo aprendido se usa hasta que alguien del equipo lo aprueba** (se puede corregir antes de aprobar).
Así nadie le puede “enseñar” un precio falso o una regla inventada por chat.

## Cómo convive con el equipo

- Si alguien del equipo contesta un chat (desde el panel **o desde la app del celular**), el asistente se **calla en ese
  chat** por 60 minutos (configurable). En *Conversaciones* se puede pausar o devolverle el chat cuando quieran.
- Lo que el asistente no puede resolver queda **“Para atender”**, con el motivo en una línea, y suma al número rojo de la pestaña.
- Si la persona manda varios mensajes seguidos, espera unos segundos y contesta todo junto.
- No escucha audios: pide con amabilidad que lo escriban.

---

## Puesta en marcha

> Requiere tener funcionando los avisos por WhatsApp (API oficial de Meta). Ver [avisos-mail-y-whatsapp.md](avisos-mail-y-whatsapp.md), sección B.

### 1. Base de datos
Supabase → **SQL Editor** → pegá `supabase/20_asistente.sql` entero → **Run**.
Tiene que decir *“Asistente de WhatsApp instalado (apagado y en modo prueba)”*. Arranca **apagado**.

### 2. Clave de Claude (Anthropic)
1. Entrá a <https://console.anthropic.com> → creá la cuenta de Psico Studios → **Billing**: cargá saldo o una tarjeta.
2. **API Keys → Create Key** (nombre: `Psico Studios WhatsApp`). Copiala: es secreta, no la mandes por chat.
3. Recomendado: en **Limits** poné un tope de gasto mensual.

### 3. Subir la función
Supabase → **Edge Functions → Deploy a new function → Via Editor**: nombre `asistente-whatsapp`, pegá
`supabase/functions/asistente-whatsapp/index.ts` → **Deploy**. En **Details**, **desactivá “Enforce JWT verification”**
(WhatsApp no tiene sesión; la función revisa sola la firma de Meta, la sesión del panel o la clave de las tareas).

### 4. Secretos
Supabase → **Edge Functions → Secrets**, agregá:

| Nombre | Valor |
|---|---|
| `ANTHROPIC_API_KEY` | la clave del paso 2 |
| `WA_APP_SECRET` | Meta for Developers → tu app → **Configuración de la app → Básica → Clave secreta de la app** |
| `WA_VERIFY_TOKEN` | una palabra inventada (ej. `psico-asistente-2026`): la vas a poner también en Meta |
| `ASISTENTE_SECRETO` | otra clave larga inventada (40 letras y números al azar) |

`WA_TOKEN`, `WA_PHONE_ID` y `SITIO_URL` ya están cargados de los avisos.
Opcional: `ASISTENTE_MODELO` para usar otro modelo (por defecto `claude-opus-5-5`, el más capaz; ver *Costos*).

### 5. Conectar WhatsApp con la función (webhook)
Meta for Developers → tu app → **WhatsApp → Configuración**:
1. **URL de devolución de llamada:** `https://TU-PROYECTO.supabase.co/functions/v1/asistente-whatsapp`
2. **Token de verificación:** la misma palabra de `WA_VERIFY_TOKEN` → **Verificar y guardar**.
3. En **Campos del webhook**, suscribite a **`messages`**. Si usás el mismo número en la app del celular
   (coexistencia), suscribite también a **`smb_message_echoes`**: así el asistente se entera cuando contestás desde el celular y se calla en ese chat.

### 6. Tareas automáticas (recordatorio de seña y revisión semanal)
SQL Editor → pegá esto completando los dos valores → **Run**:

```sql
insert into public.ajustes_privados (clave, valor) values
  ('url_asistente',     'https://TU-PROYECTO.supabase.co/functions/v1/asistente-whatsapp'),
  ('secreto_asistente', 'LA MISMA CLAVE QUE PUSISTE EN ASISTENTE_SECRETO')
on conflict (clave) do update set valor = excluded.valor;
```

### 7. Probarlo (sin riesgo)
1. Panel → **Asistente → Probar**: chateá como si fueras un cliente. Usa la agenda y los precios de verdad, pero
   **no reserva nada ni manda WhatsApp**. Debajo de cada respuesta se ve qué consultó.
2. **Asistente → Aprendizaje**: revisá “Lo que sabe” y completá lo que falte (dirección, estacionamiento, factura,
   política de cancelación, etc.). Lo que no esté acá, no lo contesta: lo pasa al equipo.
3. **Asistente → Ajustes**: agregá tu celular como número de **Prueba** (y los del equipo como **Equipo**) y poné
   **Asistente prendido: Sí**. En modo prueba **solo les contesta a esos números**.
4. Escribile desde tu celular al WhatsApp del espacio: reservá, mandá un comprobante, preguntá cosas raras.

### 8. Abrirlo a todos
Cuando estés conforme: **Asistente → Ajustes → Modo prueba: No**. Desde ese momento contesta todos los WhatsApp.
Para apagarlo en cualquier momento: **Asistente prendido: No** (los mensajes se siguen guardando en el panel).

---

## Ajustes (Asistente → Ajustes)

| Ajuste | Por defecto | Qué hace |
|---|---|---|
| Asistente prendido | No | Si contesta o no |
| Modo prueba | Sí | Solo contesta a los números de prueba y del equipo |
| Nombre | Sofía | Cómo se presenta |
| Minutos de pausa | 60 | Cuánto se calla en un chat cuando contesta el equipo |
| Horas para charla nueva | 24 | Después de este tiempo sin mensajes, empieza de cero (recuerda igual los datos del cliente) |
| Recordar la seña | Sí | Un recordatorio a quien reservó por WhatsApp y no pagó |
| Seguimiento | Sí | Una vez, a quien consultó y no reservó (solo dentro de las 24 hs que deja WhatsApp) |
| Horas antes del seguimiento | 3 | Cuánto silencio espera antes de volver a escribir |
| Minutos para recordarla | 60 | Cuándo manda ese recordatorio (antes de que se libere) |
| Cuánto piensa | Normal | *Poco*: más rápido y barato. *Mucho*: más cuidadoso y lento |

## Costos

- **Claude:** se paga por uso (por “tokens”, pedacitos de texto). Con el modelo por defecto (`claude-opus-5-5`),
  una charla típica (consultar, reservar, mandar comprobante) cuesta **del orden de 10 a 30 centavos de dólar**:
  el asistente reutiliza las instrucciones entre mensajes (caché) para que salga más barato. El gasto real se ve en
  <https://console.anthropic.com> y los tokens en *Asistente → Resumen*.
  Para gastar menos: *Cuánto piensa → Poco*, o el secreto `ASISTENTE_MODELO` = `claude-sonnet-5-5` (más barato, muy bueno para charlas).
  Precios actuales: <https://www.anthropic.com/pricing>.
- **WhatsApp (Meta):** las respuestas a un mensaje que escribió el cliente (dentro de las 24 hs) no tienen el costo de
  las plantillas. Ver <https://developers.facebook.com/docs/whatsapp/pricing>.
- WhatsApp **no deja escribir primero** a alguien que no escribió en las últimas 24 hs (salvo con plantillas aprobadas).
  Por eso el recordatorio de seña solo sale si la persona escribió hace menos de 23 hs, y el panel avisa si pasó ese plazo.

## Audios (pendiente)

Hoy **no escucha audios**: pide con amabilidad que lo escriban. Claude no recibe audio directamente; para entenderlos hace falta
sumar un servicio de **transcripción** (por ejemplo OpenAI Whisper, Deepgram o Google Speech), con su propia cuenta y costo
(del orden de centavos de dólar por minuto). Con eso, el audio se pasa a texto antes de llegar al asistente y se ve transcripto en el panel.

## Seguridad y privacidad

- Solo habla de las reservas **del número que escribe** (lo verifica la base, no la IA).
- Lo que escribe el cliente es información, no órdenes: no puede cambiarle las reglas ni los precios.
- No registra pagos, no cancela lo pagado, no hace descuentos: eso queda siempre en manos del equipo.
- Los comprobantes van al mismo espacio **privado** que los de la web (solo los ve el equipo).
- Los números del **equipo** los carga solo un administrador, y consultan con los permisos del usuario de esa persona
  (si se la desactiva del equipo, pierde el acceso también por WhatsApp).
- Las conversaciones quedan guardadas en Supabase (tablas `asistente_*`), visibles solo para el equipo.

## Si algo falla
- **No contesta:** revisá *Asistente → Ajustes* (prendido / modo prueba / ¿el número está cargado?) y si el chat está **pausado**.
- **Contesta “tuve un problema”:** Supabase → Edge Functions → `asistente-whatsapp` → **Logs**. Suele ser la clave de
  Claude o falta de saldo. El chat queda “Para atender” y los mensajes no se pierden.
- **Un mensaje dice “No se envió”:** el error de WhatsApp aparece debajo del mensaje en el chat.
- Las pruebas automáticas del asistente: `pruebas/probar_asistente.sql` y `pruebas/probar_asistente.mjs`.

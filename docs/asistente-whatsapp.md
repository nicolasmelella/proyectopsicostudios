# Asistente de WhatsApp con inteligencia artificial

Un asistente (por defecto se llama **Sofía**) que contesta el WhatsApp de Psico Studios solo, las 24 horas.
Usa **Claude** (la inteligencia artificial de Anthropic) y está conectado a la misma base que la web y el panel.

## Para qué está (y para qué no)

- **Informa, no vende.** Responde con calma y completo: cómo es el espacio, precios, disponibilidad, cómo se reserva.
  No apura, no insiste, no usa urgencia ni descuentos. Ofrece reservar solo si la persona muestra interés o lo pide.
- **Visitas:** si alguien quiere conocer el espacio, le pregunta qué día y horario le queda cómodo y lo deja en
  *Para aprobar*. Ustedes eligen día y hora y aprueban; el asistente le confirma por WhatsApp (con la dirección, si la escriben).
- **Disponibilidad:** muestra horarios libres a quien pregunte y le pasa el **link de la web** que abre directo en ese día
  (`?dia=AAAA-MM-DD`, o `?fijo=1…6` para horario fijo), para que la persona arme su reserva. Por defecto **no reserva él**;
  se puede prender en *Ajustes → “Reserva él mismo”*.
- **Los que ya alquilan:** los ayuda a reagendar o a encontrar más disponibilidad cuando escriben.
- **Nunca escribe primero**, salvo dos avisos que se pueden apagar en *Ajustes*: un recordatorio de seña a quien reservó
  por el asistente y no pagó, y un seguimiento cordial (sin presión) a quien consultó y quedó con algo pendiente.
- **No hace:** escribir a gente que no le escribió, ofrecer horarios por su cuenta, ni pedir pagos a los fijos.
  Eso lo maneja el equipo.

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
| **Entiende audios**: los pasa a texto (Whisper) y responde al contenido; el equipo ve la transcripción en el panel | |

Lo que reserva aparece en el panel como cualquier reserva, con las mismas reglas (seña, plazos, límites).
Los pedidos que toma quedan marcados con origen **WhatsApp**.

**Para el equipo:** si escribe un número cargado como *Equipo*, además puede preguntarle cosas del panel:
“¿quién viene mañana?”, “¿qué falta cobrar?”, “¿cómo vamos este mes?”, “¿qué hay pendiente?”.
Responde con los permisos del usuario del panel de esa persona.

## Clientes que ya alquilan: mover y liberar horarios

El asistente reconoce a la persona por su WhatsApp y ve sus turnos, su horario fijo y sus horas a favor. Reglas (decididas por el equipo):

| Pide | Qué hace el asistente |
|---|---|
| Mover un turno por horas, o **una semana** de su fijo, a otro día/hora/consultorio libre | Lo mueve si faltan **24 horas o más** (configurable). Misma duración. Si el horario nuevo cuesta más, **la diferencia queda como saldo a pagar** |
| “Esta semana no voy” (fijo) | Libera ese día para otros. Si **ya pagó el mes**, le quedan **horas a favor** por 30 días (configurable) y le ofrece recuperarlas; si **no pagó el mes**, esa semana **no se le cobra** (igual que cuando la libera el equipo) |
| Recuperar horas a favor | Reserva otro horario libre; si la franja es más cara, paga la diferencia |
| Con **menos de 24 hs**, cambiar la duración, cambiar el fijo para siempre | Lo pasa al equipo |

- Cada cambio queda en la agenda (con un comentario “movida por el asistente”) y en *Asistente → Conversaciones*, debajo del chat.
- **Seguridad:** el asistente reconoce a cada persona **solo por el número de WhatsApp** (un nombre o un mail los puede escribir cualquiera).
  Conviene cargar los WhatsApp completos (con código de área) en *Profesionales*: hoy la mayoría de las fichas no lo tiene.

### Lo que no puede hacer solo: “Para aprobar”

Cuando el pedido no entra en las reglas, el asistente **deja el cambio armado** y ustedes lo aprueban con un toque en
*Asistente → Para aprobar*:

| Caso | Qué deja armado |
|---|---|
| Escribe alguien que **no reconoce** por su WhatsApp y dice quién es (“soy Graciela, mi fijo de los jueves…”) | El cambio pedido, con la **ficha sugerida** por el nombre y el horario que dijo (sin contarle a la persona qué figura a su nombre) |
| Aviso con **menos de 24 hs** | El cambio pedido |
| “Transfiero más tarde” | Más tiempo para pagar la seña |
| “Quiero conocer el espacio” | Una visita con los días y horarios que le quedan cómodos (ustedes eligen día y hora al aprobar) |

- El **lugar nuevo queda guardado** mientras deciden (en la agenda se ve como bloqueado “Guardado por el asistente”), así no lo toma otra persona.
- **Aprobar:** se hace el cambio, el WhatsApp de la persona queda **vinculado a su ficha** (la próxima vez lo hace solo) y el asistente le avisa por WhatsApp.
- **Rechazar:** se suelta el lugar guardado y se le avisa, con el motivo si lo escriben.
- También existe **“¿Ya alquila? Vincular con su ficha”** en cada chat, para vincular sin que haya un pedido.
- Supuesto a confirmar: si el horario nuevo es **más barato**, no se devuelve la diferencia.

## Recordatorios de pago (solo si los autoriza el equipo)

El asistente **nunca** pide plata por su cuenta. En *Pendientes → Alertas de pago*, cada deuda tiene el botón
**“Que lo mande el asistente”**: se abre el mensaje (editable), lo revisan y tocan **Enviar**. Sale por WhatsApp desde el número
del asistente, queda en el chat y, si la persona responde (comprobante, dudas), el asistente la atiende sin insistir.
También sigue el botón **“Recordar desde mi WhatsApp”**, para mandarlo a mano desde el celular.

- Si la persona escribió en las **últimas 24 hs**, va el texto que editaron.
- Si no, WhatsApp solo deja mandar un texto **aprobado por Meta**: se usa la plantilla `psico_recordatorio_pago`
  (hay que crearla una vez, ver abajo). El panel avisa cuál de los dos se mandó.
- Hace falta el WhatsApp completo en la ficha.

**Plantilla para cargar en Meta** (Administrador de WhatsApp → Plantillas → Crear; categoría **Utilidad**, idioma **Español (ARG)**):

`psico_recordatorio_pago`
```
Hola {{1}}, te escribimos de Psico Studios por {{2}}. Tenés pendiente {{3}}. Podés transferir al alias {{4}} y mandarnos el comprobante por este chat. ¡Gracias!
```

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
- Los audios los entiende (si está cargada la clave de OpenAI, ver paso 4). Si no se pueden transcribir, pide que lo escriban.

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
Para **entender audios**, agregá también `OPENAI_API_KEY` (ver abajo, *Audios*).
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
| Entender audios | Sí | Pasa los audios a texto con Whisper (si está la clave de OpenAI) |
| Horas de anticipación | 24 | Mínimo para que el asistente mueva o libere un horario (se cambia desde *Precios y ajustes* del panel) |
| Días de las horas a favor | 30 | Cuánto duran las horas a favor (ídem) |
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

## Audios (Whisper)

Los audios de WhatsApp se pasan a texto con **Whisper** (de OpenAI) apenas llegan. El asistente responde al contenido como si
lo hubieran escrito, y en el panel el audio aparece como *🎤 Audio · transcripto* con el texto, para que el equipo no tenga que escucharlo.
La transcripción puede tener errores: el asistente confirma los datos clave (fecha, hora, mail) antes de reservar.

**Para prenderlo:**
1. Entrá a <https://platform.openai.com> → creá la cuenta → **Billing**: cargá saldo (alcanza con poco) y poné un tope de gasto.
2. **API keys → Create new secret key** (nombre: `Psico Studios audios`). Copiala: es secreta.
3. Supabase → **Edge Functions → Secrets** → agregá `OPENAI_API_KEY` con esa clave. Listo: no hay que volver a subir la función.

- **Costo:** se paga por minuto de audio, del orden de **un centavo de dólar por minuto** (una nota de voz típica dura menos de un minuto).
  Precio actual: <https://openai.com/api/pricing>.
- Sin la clave (o con *Entender audios: No* en Ajustes), el asistente pide con amabilidad que lo escriban.
- El audio se manda a OpenAI solo para transcribirlo; el archivo no se guarda en Supabase.
- Opcional: `ASISTENTE_MODELO_AUDIO` para usar otro modelo de transcripción de OpenAI (por defecto `whisper-1`).

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

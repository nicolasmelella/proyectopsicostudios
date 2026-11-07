# Avisos por mail y WhatsApp: cómo se configuran

El sistema avisa solo al profesional (y al equipo) cuando:

| Momento | Mail | WhatsApp | Copia al equipo |
|---|---|---|---|
| Reservó (horarios guardados, falta la seña) | ✓ con link para pagar o subir comprobante y datos de transferencia | ✓ | ✓ |
| Seña recibida: reserva confirmada | ✓ | ✓ | |
| Recibimos tu comprobante | ✓ | ✓ | ✓ |
| Comprobante rechazado (con el motivo) | ✓ | ✓ | |
| Se venció sin pagar | ✓ | ✓ | |
| Cancelada por el equipo (con el motivo) | ✓ | ✓ | |
| Horario fijo: solicitud recibida / aprobado / rechazado | ✓ | ✓ | ✓ (solicitud) |

Un aviso nunca se manda dos veces. Si falla (ej: Gmail caído), se reintenta hasta 3 veces.
Mail y WhatsApp se prenden por separado en el panel → **Precios y ajustes**.

---

## A · Mail (desde consultoriospsicostudios@gmail.com)

Los mails salen **desde esa casilla**: si el profesional responde, la respuesta llega ahí. Límite de Gmail: 500 por día.

### 1. Contraseña de aplicación de Google
1. Entrá a <https://myaccount.google.com> con **consultoriospsicostudios@gmail.com**.
2. **Seguridad → Verificación en dos pasos → Activar** (si no estaba activa).
3. Buscá **"Contraseñas de aplicaciones"** (<https://myaccount.google.com/apppasswords>).
4. Nombre: `Psico Studios reservas` → **Crear**. Copiá la clave de 16 letras.
   ⚠️ Es secreta: no la mandes por chat. Si se filtra, se borra desde esa misma página y se crea otra.

### 2. Subir la función y cargar las claves
1. Supabase → **Edge Functions → Deploy a new function → Via Editor**: nombre `enviar-avisos`, pegá
   `supabase/functions/enviar-avisos/index.ts` → **Deploy**. En **Details**, desactivá **"Enforce JWT verification"**.
2. Supabase → **Edge Functions → Secrets**, agregá:

| Nombre | Valor |
|---|---|
| `GMAIL_USUARIO` | `consultoriospsicostudios@gmail.com` |
| `GMAIL_CLAVE_APP` | la clave de 16 letras del paso 1 |
| `AVISOS_SECRETO` | una clave larga inventada (ej: 40 letras y números al azar) |
| `SITIO_URL` | la dirección de la web (ya cargada para Mercado Pago) |

### 3. Que la base llame a la función cada minuto
SQL Editor → pegá esto completando los dos valores → **Run**:

```sql
insert into public.ajustes_privados (clave, valor) values
  ('url_enviar_avisos', 'https://TU-PROYECTO.supabase.co/functions/v1/enviar-avisos'),
  ('secreto_avisos',    'LA MISMA CLAVE LARGA QUE PUSISTE EN AVISOS_SECRETO')
on conflict (clave) do update set valor = excluded.valor;

update public.config set valor = 'consultoriospsicostudios@gmail.com' where clave = 'email_equipo';
```

### 4. Prender
Panel → **Precios y ajustes** → "Avisos por mail a los profesionales" → **Sí**.
Probalo haciendo una reserva con tu propio mail.

---

## B · WhatsApp automático (API oficial de WhatsApp Business)

La **app** WhatsApp Business no deja que un sistema mande mensajes solo. Hace falta la **API oficial de Meta**
(WhatsApp Business Platform). Lo que conviene saber antes:

- **Número:** desde 2025 Meta permite usar el **mismo número en la app WhatsApp Business y en la API**
  ("coexistencia"): seguís chateando desde el celular como siempre y el sistema manda los avisos.
  Se confirma al conectarlo (paso 3). Si para tu número no estuviera disponible, hay que usar otro número
  (una línea nueva) que **no** esté registrado en ninguna app de WhatsApp.
- **Costo:** Meta cobra por cada aviso (categoría "utilidad"), unos pocos centavos de dólar por mensaje.
  Se paga con tarjeta desde la cuenta de Meta. Ver precios actuales en <https://developers.facebook.com/docs/whatsapp/pricing>.
- **Textos:** Meta aprueba los textos antes (abajo están listos para copiar). Suele tardar de minutos a un día.

### Pasos
1. **Cuenta comercial de Meta:** <https://business.facebook.com> → crear el portfolio **Psico Studios**
   (con tu usuario de Facebook). Si te lo pide, verificá el negocio.
2. **App:** <https://developers.facebook.com> → **Mis apps → Crear app** → tipo **"Negocios"** → vinculala al
   portfolio Psico Studios → agregá el producto **WhatsApp**.
3. **Conectar el número:** WhatsApp → **Configuración de la API → Agregar número de teléfono**. Si aparece la opción de
   **conectar un número de la app WhatsApp Business**, elegila y seguí los pasos (se escanea un código QR desde la app
   en el celular). Si no aparece, usá un número que no tenga WhatsApp.
4. **Medio de pago:** en el Administrador de WhatsApp → **Facturación** → agregá una tarjeta.
5. **Plantillas:** Administrador de WhatsApp → **Plantillas de mensajes → Crear**. Para cada una de abajo:
   categoría **Utilidad**, idioma **Español (ARG)**, el **nombre** y el **texto** exactos.
6. **Token permanente:** Configuración del negocio → **Usuarios del sistema → Agregar** (rol Administrador) →
   **Asignar activos**: la app y la cuenta de WhatsApp → **Generar token** con los permisos
   `whatsapp_business_messaging` y `whatsapp_business_management`. Copialo (es secreto).
7. **Identificador del número:** WhatsApp → Configuración de la API → copiá el **"Identificador del número de teléfono"**.
8. Supabase → **Edge Functions → Secrets**: `WA_TOKEN` (paso 6) y `WA_PHONE_ID` (paso 7).
9. Panel → **Precios y ajustes** → "Avisos por WhatsApp" → **Sí**.

> Alternativa más simple (con costo mensual): proveedores como Twilio o 360dialog hacen los pasos 1 a 7 por vos.
> Habría que adaptar la función de envío a su sistema.

### Plantillas para cargar en Meta (nombre → texto)

Las `{{1}}`, `{{2}}`… se completan solas con los datos de cada reserva.

**psico_reserva_recibida**
```
Hola {{1}}, guardamos tu reserva en Psico Studios (pedido #{{2}}): {{3}}. Para confirmarla, pagá la seña de {{4}} antes del {{5}} hs. Ver, pagar o subir el comprobante: {{6}}
```
**psico_reserva_confirmada**
```
Hola {{1}}, ¡tu reserva en Psico Studios está confirmada! Pedido #{{2}}: {{3}}. Saldo a abonar el día de cada turno: {{4}}. ¡Te esperamos!
```
**psico_reserva_vencida**
```
Hola {{1}}, tu reserva #{{2}} en Psico Studios se venció porque no recibimos la seña a tiempo y los horarios se liberaron. Si ya pagaste, respondé este mensaje y lo resolvemos.
```
**psico_reserva_cancelada**
```
Hola {{1}}, tu reserva del {{2}} en Psico Studios fue cancelada. Motivo: {{3}}. Si tenés dudas, respondé este mensaje.
```
**psico_comprobante_recibido**
```
Hola {{1}}, recibimos tu comprobante del pedido #{{2}}. Lo revisamos y te confirmamos. Mientras tanto, tus horarios quedan guardados.
```
**psico_comprobante_rechazado**
```
Hola {{1}}, no pudimos validar el comprobante del pedido #{{2}}. Motivo: {{3}}. Podés subir otro acá: {{4}}
```
**psico_fijo_solicitado**
```
Hola {{1}}, recibimos tu solicitud de horario fijo en Psico Studios: {{2}}. Te escribimos para confirmarla.
```
**psico_fijo_aprobado**
```
Hola {{1}}, ¡tu horario fijo en Psico Studios está confirmado!: {{2}}. ¡Te esperamos!
```
**psico_fijo_rechazado**
```
Hola {{1}}, no pudimos confirmar tu horario fijo en Psico Studios ({{2}}). Respondé este mensaje y te ayudamos a encontrar otro horario.
```

---

## Si algo falla
- Supabase → **Table Editor → avisos**: cada aviso con su estado (`enviado`, `error`) y el motivo del error.
- Supabase → **Edge Functions → enviar-avisos → Logs**.
- Errores típicos: *"Invalid login"* → la contraseña de aplicación de Gmail está mal; *"WhatsApp no configurado"* →
  faltan `WA_TOKEN` / `WA_PHONE_ID`; *"template name does not exist"* → la plantilla no está aprobada o el nombre no coincide.

# Psico Studios · Sistema de reservas de consultorios

Dos pantallas y una base de datos:

| Qué | Para quién | Dirección (cuando esté publicado) |
|---|---|---|
| **Web de reservas** | Profesionales (público, sin login) | `https://TU-DOMINIO/` |
| **Panel** | Equipo de Psico Studios (con usuario y contraseña) | `https://TU-DOMINIO/panel` |
| **Base de datos** | Supabase | — |

```
supabase/   → archivos SQL para pegar en Supabase (en orden: 01, 02, 03)
web/        → la web de reservas y el panel (lo que se publica)
pruebas/    → pruebas automáticas de la base (no hace falta tocarlas)
```

> 📄 Reglas del negocio (precios, seña, horas sueltas vs. fijo y reglas pendientes): [`docs/reglas-del-negocio.md`](docs/reglas-del-negocio.md)
>
> 🔎 Revisión del Excel actual y mejoras pendientes (fijos y panel): [`docs/revision-excel-y-mejoras.md`](docs/revision-excel-y-mejoras.md)
>
> 🎬 Video de cómo funciona (1 minuto, para mostrar o mandar por WhatsApp): [`docs/como-funciona-reservas.mp4`](docs/como-funciona-reservas.mp4)

---

## Cómo funciona

**Reserva por horas (web):**
1. La persona elige uno o **varios días** (ej: lunes en el Consultorio 1 y jueves en el 3); todo queda en "Tu pedido".
   Deja sus datos una sola vez: nombre, profesión, celular y mail.
2. Los horarios quedan **guardados 2 horas** esperando **una sola seña** (50% del total del pedido).
3. Le aparece el alias para transferir y un botón para mandar el comprobante por WhatsApp.
4. El equipo, desde el panel, toca **Registrar seña** → la reserva queda **confirmada**.
5. Si la seña no se registra en 2 horas, el horario **se libera solo**.
   ¿Avisó que transfiere más tarde? En el panel: **+1 hora para pagar**.

**Horario fijo (web):** la persona pide un día y horario semanal (mínimo 2 horas seguidas).
El horario se guarda 48 hs y el equipo lo **aprueba o rechaza** desde el panel → Pendientes.

**Feriados:** son un día más. Si alguien reserva y paga, se usa. Para cerrar por limpieza
o mantenimiento está **Bloquear horario** en el panel.

Todos los valores (porcentaje de seña, minutos de espera, horarios, precios, alias) se cambian
desde el panel → **Precios y ajustes**, sin tocar código.

---

## Puesta en marcha (una sola vez)

### Paso 1 · Crear el proyecto en Supabase
1. Entrá a <https://supabase.com> → **New project**.
2. Nombre: `psicostudios`. Región: **South America (São Paulo)**. Guardá la contraseña de la base en un lugar seguro.

### Paso 2 · Crear la base
En Supabase → **SQL Editor** → **New query**. Pegá el archivo entero y tocá **Run**, de a uno y en este orden:
1. `supabase/01_base.sql` → tiene que decir *"Base de Psicostudios creada correctamente"*.
2. `supabase/02_tareas_automaticas.sql` → muestra las 2 tareas automáticas programadas.

> Si `02` da error con `pg_cron`: Database → Extensions → buscá **pg_cron** → Enable, y corrélo de nuevo.

### Paso 3 · Usuarios del equipo (cada persona con su mail real)
Cada persona entra al panel con **su mail y su propia contraseña**. Nadie más la conoce, y en cada reserva
queda registrado quién la cargó. Si alguien se olvida la contraseña, la recupera sola desde "¿Olvidaste tu contraseña?".

1. **Authentication → Sign In / Providers → Email**:
   - **desactivá "Allow new users to sign up"** (nadie puede crearse una cuenta por su cuenta);
   - en **Password requirements**, mínimo **10** caracteres.
2. **Authentication → URL Configuration**: en **Site URL** poné la dirección de la web y en **Redirect URLs**
   agregá `https://TU-WEB/panel.html` (a donde llevan los links de invitación y de recuperación).
3. **Authentication → Emails → SMTP Settings** (recomendado): para que los mails de invitación y de recuperación
   salgan desde `consultoriospsicostudios@gmail.com` y sin el límite de pocos mails por hora de Supabase.
   Host `smtp.gmail.com`, puerto `465`, usuario el Gmail y la **contraseña de aplicación** (ver [docs/avisos-mail-y-whatsapp.md](docs/avisos-mail-y-whatsapp.md)).
4. **Primer administrador:** **Authentication → Users → Invite user** con tu mail. Te llega un mail: tocá el link y elegí tu contraseña.
   Después, en el paso 4, corré `13_equipo.sql` y el bloque "PRIMER ADMINISTRADOR" que está al final de ese archivo (con tu mail).
5. **El resto del equipo** lo invita el administrador desde el panel → **Equipo** → "Invitar a alguien"
   (nombre, mail y rol). Ahí mismo se puede desactivar a alguien, hacerlo administrador o mandarle el mail para cambiar la contraseña.

### Paso 4 · Aplicar seña, seguridad y Mercado Pago
SQL Editor → pegá `supabase/03_sena_y_seguridad.sql` → **Run**.
Dice *"Ajustes aplicados…"*. Si además dice que falta el usuario `psicomel`, no pasa nada: ese usuario general
ya no se usa (ahora cada persona entra con su mail, ver paso 3 y `13_equipo.sql`).

Después, en una consulta nueva: `supabase/04_mercadopago.sql` → **Run** → *"Mercado Pago listo en la base"*.
(Mercado Pago queda apagado hasta completar la sección de abajo.)

Por último: `supabase/05_calendario.sql` → **Run** → *"Calendario listo: se puede reservar hasta el …"*.
(Agenda abierta 2 meses de calendario, colores por día, y nombre, profesión, celular y mail obligatorios.)

Y `supabase/06_pedidos.sql` → **Run** → *"Pedidos de varios días listos"*.
(Reservar varios días de una vez, con una sola seña.)

Y `supabase/07_comprobantes.sql` → **Run** → *"Comprobantes listos…"*.
(Subir el comprobante de la transferencia desde la web y revisarlo en el panel → Pendientes. Crea solo el espacio privado de archivos.)

Y `supabase/08_avisos.sql` → **Run** → *"Avisos listos…"*.
(Avisos automáticos por mail y WhatsApp. Arrancan apagados: se configuran con [`docs/avisos-mail-y-whatsapp.md`](docs/avisos-mail-y-whatsapp.md).)

Y `supabase/09_semana.sql` → **Run** → *"Semana lista. Usuarios del panel: …"* (tienen que aparecer todos los nombres).
(La vista **Semana** del panel, como la hoja del Excel: notas de la semana, "Deshacer" y un usuario por persona.
Si después se suma alguien al equipo, se crea su usuario y se vuelve a correr este archivo.)

Y `supabase/10_quien_cobro.sql` → **Run** → *"Listo: los pagos ahora guardan a quién le pagaron …"*.
(Cada pago cargado a mano dice **a quién le pagaron**. La lista se cambia en el panel → Precios y ajustes.)

Y `supabase/11_comentarios.sql` → **Run** → *"Listo: comentarios en reservas y fijos"*.
(Un comentario del equipo en cada reserva o fijo, "algo a tener en cuenta". Solo lo ve el equipo.)

Y `supabase/12_tablero.sql` → **Run** → *"Listo: tablero de números"*.
(La pestaña **Números**: ocupación por semana, días y horas más llenos, profesionales con más horas,
cobrado por persona y lo que falta cobrar. También prepara la base para cargar la historia del Excel.)

Y `supabase/13_equipo.sql` → **Run** → *"Equipo listo: …"* (y el bloque del primer administrador, ver paso 3).
Después: **Edge Functions → Deploy a new function → Via Editor**, nombre `equipo-admin`, pegá
`supabase/functions/equipo-admin/index.ts` → **Deploy**. Esta **sí** deja prendido "Enforce JWT verification".

Y `supabase/14_permisos_finos.sql` → **Run** → *"Permisos finos aplicados"* (cierra funciones internas que pide el control de seguridad).

Y `supabase/15_cancelar_pedido.sql` → **Run** (quien reservó desde la web puede cancelar antes de pagar).

Y `supabase/16_pagos_completos.sql` → **Run** (horas sueltas: seña **o** total; horario fijo: se paga el **primer mes**
y queda activo solo). Después volvé a desplegar la función `mp-crear-pago`.

Y `supabase/17_alertas_pago.sql` → **Run**. **Regla: el sistema no cancela nada solo.** Las horas sueltas piden la seña
al reservar y el saldo se paga hasta el día anterior al turno; los fijos, el primer mes y después mes a mes por adelantado.
Si falta un pago, aparece en el panel → **Pendientes → Alertas de pago** y el equipo decide.

### Paso 5 · Conectar la web con Supabase
En Supabase → **Project Settings → API** copiá:
- **Project URL**
- **anon public key** (⚠️ la *anon*, nunca la *service_role*)

Pegalos en `web/js/config.js` en lugar de `COMPLETAR`.

### Paso 6 · Publicar en Cloudflare Pages
1. <https://dash.cloudflare.com> → **Workers & Pages → Create → Pages → Connect to Git**.
2. Elegí el repositorio `proyectopsicostudios`.
3. Configuración:
   - Framework preset: **None**
   - Build command: *(vacío)*
   - Build output directory: **`web`**
4. **Save and Deploy**. Después se puede conectar un dominio propio (ej: `reservas.psicostudios.com.ar`).

Cada vez que se actualiza el repositorio, Cloudflare publica la versión nueva solo.

### Paso 7 · Cargar los datos de cobro
Por seguridad, alias, CVU, titular y WhatsApp **no se pueden cambiar desde el panel** (ni siquiera con la
contraseña): así nadie que consiga la clave del panel puede desviar los pagos a otra cuenta.
Se cargan desde Supabase → **SQL Editor** → New query, completando los valores entre comillas → **Run**:

```sql
update public.config set valor = 'ALIAS'           where clave = 'alias_transferencia';
update public.config set valor = 'CVU'             where clave = 'cvu_transferencia';
update public.config set valor = 'NOMBRE TITULAR'  where clave = 'titular_transferencia';
update public.config set valor = '549XXXXXXXXXX'   where clave = 'whatsapp_contacto';
select clave, valor from public.config where clave like '%transferencia' or clave = 'whatsapp_contacto';
```

El WhatsApp va con `549` + código de área + número, sin espacios (ej: `5491123456789`).
Para cambiarlos más adelante, lo mismo. Estos datos no se guardan en el código (este repositorio es público).

---

## Mercado Pago: la seña se paga y se confirma sola

Cuando está activo, después de reservar aparece el botón **"Pagar seña con Mercado Pago"**.
La persona paga con tarjeta o dinero en cuenta y la reserva queda **confirmada al instante**, sin que nadie
la registre. La transferencia al alias sigue disponible como alternativa.

> El link fijo de Mercado Pago (`mpago.la/...`) **no sirve para esto**: no sabe a qué reserva corresponde
> ni le avisa al sistema. Hace falta una "aplicación" de Mercado Pago, que es gratis.

### 1 · Crear la aplicación en Mercado Pago
Con la **misma cuenta** que va a recibir la plata:
1. Entrá a <https://www.mercadopago.com.ar/developers/panel/app> → **Crear aplicación**.
2. Tipo de solución: **Pagos online** → producto **Checkout Pro**.
3. Entrá a la aplicación → **Credenciales de producción** → copiá el **Access Token** (empieza con `APP_USR-`).
   ⚠️ Es una clave secreta: no la mandes por chat ni la pegues en ningún archivo del proyecto.

### 2 · Subir las dos funciones del servidor a Supabase
En Supabase → **Edge Functions** → **Deploy a new function** → **Via Editor**:
1. Nombre: `mp-crear-pago`. Borrá el ejemplo, pegá el contenido de `supabase/functions/mp-crear-pago/index.ts` → **Deploy**.
2. Repetí con el nombre `mp-webhook` y el archivo `supabase/functions/mp-webhook/index.ts`.
3. En cada función → **Details** → desactivá **"Enforce JWT verification"** (Verify JWT) → Save.
   Mercado Pago no tiene usuario de Supabase; la seguridad la hacen las propias funciones.

### 3 · Cargar las claves en Supabase
Supabase → **Edge Functions → Secrets** → agregá:

| Nombre | Valor |
|---|---|
| `MP_ACCESS_TOKEN` | el Access Token del paso 1 |
| `SITIO_URL` | la dirección de la web, ej: `https://reservas.psicostudios.com.ar` |
| `MP_WEBHOOK_SECRET` | la clave secreta del paso 4 (cargala cuando la tengas) |

### 4 · Avisos de pago (webhook)
En Mercado Pago → tu aplicación → **Webhooks** → **Configurar notificaciones**:
- URL de producción: `https://TU-PROYECTO.supabase.co/functions/v1/mp-webhook`
  (la dirección de tu proyecto está en Supabase → Project Settings → API → Project URL)
- Evento: **Pagos** → **Guardar**.
- Copiá la **Clave secreta** que aparece y cargala como `MP_WEBHOOK_SECRET` (paso 3).

### 5 · Activar y probar
1. Panel → **Precios y ajustes** → "Cobrar la seña con Mercado Pago" → **Sí** → Guardar.
2. Hacé una reserva real de 1 hora desde la web y pagá la seña.
3. Tenés que volver a la web con el mensaje **"¡Seña pagada! Tu reserva está confirmada"**,
   y en el panel la reserva tiene que aparecer confirmada, con el pago "Mercado Pago".
4. Devolvete la plata desde Mercado Pago (Actividad → el pago → Devolver) y cancelá la reserva en el panel.

Si algo falla: Supabase → Edge Functions → la función → **Logs** muestra el error. Para apagar Mercado Pago
en cualquier momento: panel → "Cobrar la seña con Mercado Pago" → **No** (la web vuelve a mostrar solo el alias).

### Casos especiales
- **Pagó tarde** (después de que venció su reserva): si el horario sigue libre, la reserva se recupera y se confirma sola.
  Si ya lo tomó otra persona, el pago aparece en el panel → Pendientes → **"Pagos de Mercado Pago a revisar"**,
  para devolverlo o reubicar a la persona.
- **Pagos que acreditan tarde** (Rapipago, Pago Fácil) están desactivados: solo tarjeta y dinero en cuenta, que son al instante.
- Mercado Pago cobra una comisión por cada cobro, según el plazo de acreditación que tengas elegido en tu cuenta.

---

## Simulador (probar todo sin Supabase ni Mercado Pago)
Mientras `config.js` diga `COMPLETAR`, la web funciona como **simulador** con datos de prueba
(banda naranja arriba). Ya conectado, se abre agregando `?demo` al final de la dirección.

- La web y el panel **comparten los datos** (quedan guardados en ese navegador, del día).
- "Pagar seña con Mercado Pago" abre un **simulador de pago** (no es Mercado Pago) con cuatro opciones:
  aprobado, aprobado pero tarde, rechazado y volver sin pagar.
- Barra de arriba: **Ver el panel / Ver la web**, **⏩ Adelantar el reloj 2 horas** (simula que pasó el tiempo:
  las reservas sin seña se liberan) y **↺ Borrar mis pruebas** (vuelve a los datos de ejemplo). **¿Qué es esto?** lo explica.
- En el panel del simulador entra cualquier usuario y contraseña.

Recorridos para probar:
1. Reservar → pagar → aprobado → ver en el panel la reserva confirmada con el pago "Mercado Pago".
2. Reservar → pagar → rechazado → reintentar → aprobado.
3. Reservar sin pagar → ⏩ Adelantar el reloj 2 horas → en el panel el horario quedó libre.
4. Reservar → pagar → aprobado pero tarde → la reserva se recupera.
5. Panel: registrar una seña a mano, cancelar una reserva, cargar un fijo, bloquear un horario.

## Seguridad
- Las personas de afuera **solo pueden**: ver horarios libres (sin nombres), ver precios y crear reservas/solicitudes.
  No pueden leer ni modificar ninguna tabla.
- El panel exige usuario y contraseña **y** que el usuario esté dado de alta en el equipo. Un usuario logueado que no es del equipo no ve nada.
- La sesión del panel se cierra al cerrar el navegador y tras 60 minutos sin uso.
- Anti-abuso en la web: máximo 6 horas por reserva y máximo 2 reservas sin pagar por WhatsApp.
- Todo cambio en reservas, fijos, pagos, profesionales, ajustes y precios queda registrado en la tabla `historial`
  (quién, cuándo, y para ajustes y precios el valor de antes y el de después).

### Plata y Mercado Pago
- **Datos de cobro bloqueados** (alias, CVU, titular, WhatsApp): solo se cambian desde el SQL Editor de Supabase.
  Dos barreras independientes: la regla de permisos y un control en la propia tabla, que rechaza el cambio
  aunque venga del servidor. Está probado (`pruebas/probar_mercadopago.sql`).
- **El monto de la seña lo calcula siempre la base**, nunca la web: no se puede pagar menos manipulando la página.
- **Una reserva solo se confirma si Mercado Pago dice que el pago está aprobado.** El aviso que llega se verifica
  con su firma y, además, el pago se consulta directo a Mercado Pago con nuestra clave. Un aviso falso no confirma nada.
- **Cada reserva tiene un código secreto**: nadie puede ver ni pagar una reserva ajena adivinando el número.
- **El Access Token de Mercado Pago** vive solo en los secretos de Supabase: no está en el código ni en la web.
- Un mismo pago nunca se registra dos veces, aunque Mercado Pago avise varias veces.

### Cuidar las cuentas (lo más importante)
Quien controle estas cuentas controla el sistema. En las cuatro:
**contraseña larga y única + verificación en dos pasos (2FA)**.

| Cuenta | Qué permite si alguien entra | Dónde activar 2FA |
|---|---|---|
| **Supabase** | Todo: datos, datos de cobro, claves | Account → Security → Multi-factor authentication |
| **Mercado Pago** | La plata y el Access Token | Seguridad → Verificación en dos pasos |
| **GitHub** | Cambiar el código de la web | Settings → Password and authentication |
| **Cloudflare** | Cambiar la web publicada | My Profile → Authentication |

Y la contraseña del panel: **mínimo 12 caracteres**, distinta a todas las demás. Se cambia en Supabase →
Authentication → Users → el usuario → Reset password / Update user.

Si sospechás que alguien entró: cambiá la contraseña del panel, y en Mercado Pago generá un Access Token nuevo
(tu aplicación → Credenciales → Renovar) y cargalo en Supabase → Edge Functions → Secrets.

## Pruebas de la base (para desarrollo)
```bash
PGHOST=... PGPORT=... PGUSER=postgres ./pruebas/correr_pruebas.sh
```
Crea una base temporal en un PostgreSQL local, corre `01` + `03` + `04` y verifica reservas, seña, permisos, vencimientos,
Mercado Pago y las funciones del servidor (con Mercado Pago simulado; necesita Node 22).

## Fotos de los consultorios
Están en `web/img/consultorios/` (optimizadas para celular y sin datos ocultos de la cámara, como la ubicación).
Para cambiar una foto o el texto de un consultorio: `FOTOS` al principio de `web/js/reservar.js`.

## WhatsApp de ayuda
El botón "¿Tenés algún problema?" y el botón flotante usan el número de `WHATSAPP_AYUDA` en `web/js/config.js`.

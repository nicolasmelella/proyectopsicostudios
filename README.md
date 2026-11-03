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

---

## Cómo funciona

**Reserva por horas (web):**
1. La persona elige el día y las horas, y deja nombre y WhatsApp.
2. El horario queda **guardado 2 horas** esperando la seña (50% del total).
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

### Paso 3 · Crear el usuario del equipo
1. **Authentication → Users → Add user → Create new user**
   - Email: `psicomel@psicostudios.local`
   - Password: la contraseña que elijan
   - Tildá **Auto Confirm User**
2. **Authentication → Sign In / Providers → Email**: **desactivá "Allow new users to sign up"**.
   Así nadie puede crearse una cuenta por su cuenta.

En el panel se entra escribiendo solo `psicomel` como usuario (el `@psicostudios.local` se agrega solo).

### Paso 4 · Aplicar seña y seguridad
SQL Editor → pegá `supabase/03_sena_y_seguridad.sql` → **Run**.
Tiene que decir *"Listo: ajustes aplicados y usuario psicomel habilitado para el panel"*.
Si dice que falta el usuario, hacé el paso 3 y volvé a correrlo (se puede correr las veces que haga falta).

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

### Paso 7 · Completar los datos de cobro
Entrá al panel → **Precios y ajustes** y completá: alias/CBU, titular y WhatsApp del equipo
(formato `549` + código de área + número, ej: `5491141952323`).

---

## Ver la web sin Supabase (modo demo)
Mientras `config.js` diga `COMPLETAR`, todo funciona con **datos de prueba** (aparece una banda
naranja arriba que dice MODO DEMO). En el panel demo entra cualquier usuario y contraseña.
Ya conectado, se puede volver a ver la demo agregando `?demo` al final de la dirección.

## Seguridad
- Las personas de afuera **solo pueden**: ver horarios libres (sin nombres), ver precios y crear reservas/solicitudes.
  No pueden leer ni modificar ninguna tabla.
- El panel exige usuario y contraseña **y** que el usuario esté dado de alta en el equipo. Un usuario logueado que no es del equipo no ve nada.
- La sesión del panel se cierra al cerrar el navegador y tras 60 minutos sin uso.
- Anti-abuso en la web: máximo 6 horas por reserva y máximo 2 reservas sin pagar por WhatsApp.
- Todo cambio en reservas, fijos, pagos y profesionales queda registrado en la tabla `historial`.

## Pruebas de la base (para desarrollo)
```bash
PGHOST=... PGPORT=... PGUSER=postgres ./pruebas/correr_pruebas.sh
```
Crea una base temporal en un PostgreSQL local, corre `01` + `03` y verifica reservas, seña, permisos y vencimientos.

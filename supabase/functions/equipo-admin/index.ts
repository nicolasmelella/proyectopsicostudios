// =====================================================================
// Función del servidor "equipo-admin" (Supabase Edge Function)
// El panel la llama para INVITAR a una persona al equipo:
//   { nombre, email, rol: 'equipo' | 'admin' }
// Solo funciona si quien la llama es administrador (se revisa en la base).
// Supabase le manda a esa persona un mail con un link para elegir su contraseña.
//
// Dejar "Enforce JWT verification" PRENDIDO (solo la llama alguien con sesión del panel).
// Secretos: SITIO_URL (ya cargado). SUPABASE_URL, SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.
// =====================================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const variable = (nombre: string) => {
  const v = Deno.env.get(nombre);
  if (!v) throw new Error(`Falta configurar el secreto ${nombre}`);
  return v;
};

async function rpc(fn: string, args: Record<string, unknown>) {
  const clave = variable('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${variable('SUPABASE_URL')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const datos = await r.json().catch(() => null);
  if (!r.ok) throw { message: datos?.message ?? 'ERROR_BASE', hint: datos?.hint };
  return datos;
}

// ¿Quién llama? (con su propia sesión del panel)
async function quienLlama(req: Request) {
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const r = await fetch(`${variable('SUPABASE_URL')}/auth/v1/user`, {
    headers: { apikey: variable('SUPABASE_ANON_KEY'), Authorization: `Bearer ${jwt}` },
  });
  if (!r.ok) return null;
  return await r.json();
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return responder({ ok: true });
  if (req.method !== 'POST') return responder({ message: 'METODO' }, 405);
  try {
    const yo = await quienLlama(req);
    if (!yo?.id) return responder({ message: 'NO_AUTORIZADO', hint: 'Tu sesión venció. Volvé a entrar.' }, 401);
    if ((await rpc('rol_de', { p_user_id: yo.id })) !== 'admin') {
      return responder({ message: 'NO_AUTORIZADO', hint: 'Solo un administrador puede invitar personas.' }, 403);
    }

    const cuerpo = await req.json().catch(() => ({}));
    const nombre = String(cuerpo.nombre || '').trim();
    const email = String(cuerpo.email || '').trim().toLowerCase();
    const rol = cuerpo.rol === 'admin' ? 'admin' : 'equipo';
    if (nombre.length < 2) return responder({ message: 'NOMBRE_INVALIDO', hint: 'Escribí el nombre.' }, 400);
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return responder({ message: 'EMAIL_INVALIDO', hint: 'Revisá el mail.' }, 400);

    // Invitación: Supabase le manda el mail con el link para elegir su contraseña
    const volver = `${variable('SITIO_URL').replace(/\/+$/, '')}/panel.html`;
    const clave = variable('SUPABASE_SERVICE_ROLE_KEY');
    const r = await fetch(`${variable('SUPABASE_URL')}/auth/v1/invite?redirect_to=${encodeURIComponent(volver)}`, {
      method: 'POST',
      headers: { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, data: { nombre } }),
    });
    const usuario = await r.json().catch(() => ({}));
    if (!r.ok) {
      const texto = String(usuario?.msg || usuario?.message || usuario?.error_description || '');
      if (r.status === 422 || /already|registered|exists/i.test(texto)) {
        return responder({ message: 'YA_EXISTE', hint: 'Ese mail ya tiene usuario. Si no puede entrar, mandale el mail para cambiar la contraseña.' }, 409);
      }
      return responder({ message: 'INVITACION', hint: 'No se pudo mandar la invitación: ' + texto }, 400);
    }

    await rpc('equipo_alta', { p_user_id: usuario.id, p_nombre: nombre, p_email: email, p_rol: rol });
    return responder({ ok: true, user_id: usuario.id });
  } catch (e) {
    const err = e as { message?: string; hint?: string };
    return responder({ message: err.message ?? 'ERROR', hint: err.hint }, 400);
  }
});

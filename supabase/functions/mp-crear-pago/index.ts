// =====================================================================
// Función del servidor "mp-crear-pago" (Supabase Edge Function)
// La web la llama con { reserva_id, token } y recibe el link de pago
// de Mercado Pago para la seña. El monto lo calcula la base de datos.
//
// Secretos que necesita (Supabase → Edge Functions → Secrets):
//   MP_ACCESS_TOKEN  → Access Token de Mercado Pago
//   SITIO_URL        → dirección de la web, ej: https://reservas.psicostudios.com.ar
// SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY los pone Supabase solo.
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

// Llama a una función de la base con permisos de servidor
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

// Fecha en el formato que pide Mercado Pago, en hora argentina (UTC-3, sin horario de verano)
function fechaMP(fecha: Date) {
  const ar = new Date(fecha.getTime() - 3 * 3600 * 1000);
  return ar.toISOString().slice(0, 19) + '.000-03:00';
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return responder({ message: 'METODO_NO_PERMITIDO' }, 405);

  let cuerpo: { reserva_id?: unknown; token?: unknown };
  try { cuerpo = await req.json(); } catch { return responder({ message: 'PEDIDO_INVALIDO' }, 400); }
  const id = Number(cuerpo.reserva_id);
  const token = String(cuerpo.token ?? '');
  if (!Number.isInteger(id) || id <= 0 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token)) {
    return responder({ message: 'PEDIDO_INVALIDO', hint: 'Faltan los datos de la reserva' }, 400);
  }

  try {
    let datos: { monto: number; expira_en: string | null; descripcion: string };
    try {
      datos = await rpc('preparar_pago_mp', { p_reserva_id: id, p_token: token });
    } catch (e) {
      const err = e as { message: string; hint?: string };
      return responder({ message: err.message, hint: err.hint }, 400);
    }

    const sitio = variable('SITIO_URL').replace(/\/+$/, '');
    const vuelta = (resultado: string) => `${sitio}/?pago=${resultado}&reserva=${id}&t=${token}`;
    const preferencia: Record<string, unknown> = {
      items: [{ id: `reserva-${id}`, title: datos.descripcion, quantity: 1, unit_price: datos.monto, currency_id: 'ARS' }],
      external_reference: `reserva-${id}`,
      notification_url: `${variable('SUPABASE_URL')}/functions/v1/mp-webhook`,
      back_urls: { success: vuelta('ok'), failure: vuelta('error'), pending: vuelta('pendiente') },
      auto_return: 'approved',
      binary_mode: true, // aprobado o rechazado al instante, sin "pendiente"
      statement_descriptor: 'PSICOSTUDIOS',
      payment_methods: { excluded_payment_types: [{ id: 'ticket' }, { id: 'atm' }], installments: 1 },
    };
    if (datos.expira_en) {
      preferencia.expires = true;
      preferencia.expiration_date_from = fechaMP(new Date());
      preferencia.expiration_date_to = fechaMP(new Date(datos.expira_en));
    }

    const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
      method: 'POST',
      headers: { Authorization: `Bearer ${variable('MP_ACCESS_TOKEN')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(preferencia),
    });
    const pref = await r.json().catch(() => null);
    if (!r.ok || !pref?.init_point) {
      console.error('Mercado Pago rechazó la preferencia', r.status, JSON.stringify(pref));
      return responder({ message: 'MP_ERROR', hint: 'No pudimos abrir Mercado Pago. Probá de nuevo o transferí al alias.' }, 502);
    }
    return responder({ url: pref.init_point, monto: datos.monto });
  } catch (e) {
    console.error('Error en mp-crear-pago', e);
    return responder({ message: 'ERROR_SERVIDOR', hint: 'No pudimos abrir Mercado Pago. Probá de nuevo o transferí al alias.' }, 500);
  }
});

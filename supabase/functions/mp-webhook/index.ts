// =====================================================================
// Función del servidor "mp-webhook" (Supabase Edge Function)
// Mercado Pago la llama cuando hay novedades de un pago. Esta función
// NO confía en lo que dice el aviso: consulta el pago directamente a
// Mercado Pago con nuestro Access Token y solo si está APROBADO lo
// registra en la base (que confirma la reserva).
//
// Secretos que necesita (Supabase → Edge Functions → Secrets):
//   MP_ACCESS_TOKEN     → Access Token de Mercado Pago
//   MP_WEBHOOK_SECRET   → "Clave secreta" de la sección Webhooks de Mercado Pago
// =====================================================================

const variable = (nombre: string) => {
  const v = Deno.env.get(nombre);
  if (!v) throw new Error(`Falta configurar el secreto ${nombre}`);
  return v;
};
const texto = (t: string, status = 200) => new Response(t, { status, headers: { 'Content-Type': 'text/plain' } });

async function rpc(fn: string, args: Record<string, unknown>) {
  const clave = variable('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${variable('SUPABASE_URL')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const datos = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`La base respondió ${r.status}: ${JSON.stringify(datos)}`);
  return datos;
}

// Verifica la firma "x-signature" que manda Mercado Pago (HMAC-SHA256)
export async function firmaValida(firma: string, requestId: string, dataId: string, secreto: string) {
  const partes = Object.fromEntries(firma.split(',').map((p) => p.trim().split('=', 2) as [string, string]));
  if (!partes.ts || !partes.v1) return false;
  let manifiesto = '';
  if (dataId) manifiesto += `id:${/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId};`;
  if (requestId) manifiesto += `request-id:${requestId};`;
  manifiesto += `ts:${partes.ts};`;
  const clave = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(manifiesto)));
  const calculada = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (calculada.length !== partes.v1.length) return false;
  let distinto = 0;
  for (let i = 0; i < calculada.length; i++) distinto |= calculada.charCodeAt(i) ^ partes.v1.charCodeAt(i);
  return distinto === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return texto('ok');
  try {
    const url = new URL(req.url);
    let cuerpo: { type?: string; data?: { id?: string | number } } = {};
    try { cuerpo = await req.json(); } catch { /* algunos avisos vienen solo en la URL */ }

    const tipo = cuerpo.type ?? url.searchParams.get('type') ?? url.searchParams.get('topic');
    const pagoId = String(cuerpo.data?.id ?? url.searchParams.get('data.id') ?? url.searchParams.get('id') ?? '');
    if (tipo !== 'payment' || !/^\d+$/.test(pagoId)) return texto('ignorado');

    // Firma: si Mercado Pago la manda y tenemos la clave, tiene que coincidir
    const firma = req.headers.get('x-signature');
    const secreto = Deno.env.get('MP_WEBHOOK_SECRET');
    if (firma && secreto) {
      const ok = await firmaValida(firma, req.headers.get('x-request-id') ?? '', url.searchParams.get('data.id') ?? pagoId, secreto);
      if (!ok) return texto('firma invalida', 401);
    }

    // Fuente de verdad: el pago consultado a Mercado Pago
    const r = await fetch(`https://api.mercadopago.com/v1/payments/${pagoId}`, {
      headers: { Authorization: `Bearer ${variable('MP_ACCESS_TOKEN')}` },
    });
    if (!r.ok) return texto('no se pudo consultar el pago', 502); // Mercado Pago reintenta
    const pago = await r.json();

    const ref = /^reserva-(\d+)$/.exec(String(pago.external_reference ?? ''));
    if (!ref) return texto('no es un pago de reserva');
    if (pago.status !== 'approved') return texto(`pago ${pago.status}`);
    if (pago.currency_id !== 'ARS') return texto('moneda no esperada');

    const resultado = await rpc('registrar_pago_mp', {
      p_reserva_id: Number(ref[1]),
      p_mp_payment_id: pagoId,
      p_monto: Math.round(Number(pago.transaction_amount)),
    });
    console.log(`Pago ${pagoId} reserva ${ref[1]}: ${resultado}`);
    return texto(String(resultado));
  } catch (e) {
    console.error('Error en mp-webhook', e);
    return texto('error', 500); // Mercado Pago reintenta más tarde
  }
});

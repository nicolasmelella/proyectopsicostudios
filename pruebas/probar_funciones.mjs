// Prueba las funciones del servidor (supabase/functions) sin Supabase ni Mercado Pago reales:
//  · las llamadas a la base van al PostgreSQL local de pruebas (como service_role)
//  · las llamadas a Mercado Pago se simulan
// Uso (después de correr_pruebas.sh): PGHOST=... PGPORT=... node --experimental-strip-types pruebas/probar_funciones.mjs
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';

const BASE = 'psicostudios_prueba';
const SECRETO = 'secreto-de-prueba';
const env = {
  SUPABASE_URL: 'http://supabase.prueba',
  SUPABASE_SERVICE_ROLE_KEY: 'clave-servicio-prueba',
  MP_ACCESS_TOKEN: 'TEST-token',
  MP_WEBHOOK_SECRET: SECRETO,
  SITIO_URL: 'https://reservas.prueba/',
};

// ---------- base de datos ----------
function sql(rol, consulta) {
  try {
    return execFileSync('psql', ['-d', BASE, '-At', '-v', 'ON_ERROR_STOP=1', '-c', `set role ${rol};`, '-c', consulta],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').pop();
  } catch (e) {
    const err = String(e.stderr);
    throw { message: /ERROR:\s+(.*)/.exec(err)?.[1] ?? err, hint: /HINT:\s+(.*)/.exec(err)?.[1] };
  }
}
const literal = (v) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);

// ---------- Mercado Pago simulado ----------
const mp = { preferencias: [], pagos: {} };

globalThis.fetch = async (url, opciones = {}) => {
  const u = String(url);
  const json = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith(env.SUPABASE_URL + '/rest/v1/rpc/')) {
    assert.equal(opciones.headers.Authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
    const fn = u.split('/').pop();
    const args = JSON.parse(opciones.body);
    const params = Object.entries(args).map(([k, v]) => `${k} => ${literal(v)}`).join(', ');
    try { return json(JSON.parse(sql('service_role', `select to_json(public.${fn}(${params}))`))); }
    catch (e) { return json(e, 400); }
  }
  if (u === 'https://api.mercadopago.com/checkout/preferences') {
    assert.equal(opciones.headers.Authorization, 'Bearer TEST-token');
    mp.preferencias.push(JSON.parse(opciones.body));
    return json({ id: 'pref-1', init_point: 'https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=pref-1' }, 201);
  }
  const m = /^https:\/\/api\.mercadopago\.com\/v1\/payments\/(\d+)$/.exec(u);
  if (m) return mp.pagos[m[1]] ? json(mp.pagos[m[1]]) : json({ message: 'not found' }, 404);
  throw new Error('fetch inesperado: ' + u);
};

// ---------- Deno simulado ----------
let manejador;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (fn) => { manejador = fn; } };
const cargar = async (nombre) => { await import(`../supabase/functions/${nombre}/index.ts`); return manejador; };

const ok = (msg) => console.log('ok  · ' + msg);

// =====================================================================
sql('postgres', "update public.config set valor = 'si' where clave = 'mercadopago_activo'");
let dia = sql('postgres', 'select public.hoy_ar() + 21');
if (sql('postgres', `select extract(isodow from date '${dia}')`) === '7') dia = sql('postgres', `select date '${dia}' + 1`);
const reserva = JSON.parse(sql('anon', `select public.crear_reserva('Juli Prueba', '1133334444', 'Psicóloga', 'juli@prueba.com', '${dia}', array[18,19]::smallint[], 1::smallint)`));

// ---------- mp-crear-pago ----------
const crearPago = await cargar('mp-crear-pago');
const pedir = (cuerpo) => crearPago(new Request('https://x/functions/v1/mp-crear-pago', { method: 'POST', body: JSON.stringify(cuerpo) }));

let r = await crearPago(new Request('https://x', { method: 'OPTIONS' }));
assert.equal(r.status, 200); assert.equal(r.headers.get('Access-Control-Allow-Origin'), '*'); ok('responde al preflight CORS');

r = await pedir({ reserva_id: reserva.id, token: reserva.token });
let cuerpo = await r.json();
assert.equal(r.status, 200, JSON.stringify(cuerpo));
assert.match(cuerpo.url, /^https:\/\/www\.mercadopago\.com\.ar\//); ok('devuelve el link de Mercado Pago');
const pref = mp.preferencias.at(-1);
assert.equal(pref.items[0].unit_price, 9000); ok('cobra la seña calculada por la base: $9000');
assert.equal(pref.external_reference, `reserva-${reserva.id}`); ok('identifica la reserva');
assert.equal(pref.notification_url, 'http://supabase.prueba/functions/v1/mp-webhook'); ok('avisa al webhook');
assert.equal(pref.back_urls.success, `https://reservas.prueba/?pago=ok&reserva=${reserva.id}&t=${reserva.token}`); ok('vuelve a la web con el código');
assert.match(pref.expiration_date_to, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.000-03:00$/); ok('vence junto con la reserva, en hora argentina');
assert.equal(new Date(pref.expiration_date_to).getTime() - new Date(reserva.expira_en).getTime() < 1000, true); ok('la hora de vencimiento coincide');
assert.deepEqual(pref.payment_methods.excluded_payment_types, [{ id: 'ticket' }, { id: 'atm' }]); ok('sin Rapipago/Pago Fácil (acreditan tarde)');

r = await pedir({ reserva_id: reserva.id, token: '00000000-0000-0000-0000-000000000000' });
cuerpo = await r.json();
assert.equal(r.status, 400); assert.equal(cuerpo.message, 'NO_ENCONTRADO'); ok('código equivocado: rechaza');
r = await pedir({ reserva_id: 'x' });
assert.equal(r.status, 400); ok('pedido mal armado: rechaza');

// ---------- mp-webhook ----------
const webhook = await cargar('mp-webhook');
const avisar = (pagoId, { firma = true, secreto = SECRETO, tipo = 'payment' } = {}) => {
  const ts = '1730000000';
  const requestId = 'req-' + pagoId;
  const v1 = createHmac('sha256', secreto).update(`id:${pagoId};request-id:${requestId};ts:${ts};`).digest('hex');
  const headers = { 'Content-Type': 'application/json', 'x-request-id': requestId };
  if (firma) headers['x-signature'] = `ts=${ts},v1=${v1}`;
  return webhook(new Request(`https://x/functions/v1/mp-webhook?data.id=${pagoId}&type=${tipo}`, {
    method: 'POST', headers, body: JSON.stringify({ type: tipo, data: { id: String(pagoId) } }),
  }));
};

mp.pagos['9001'] = { id: 9001, status: 'approved', currency_id: 'ARS', external_reference: `reserva-${reserva.id}`, transaction_amount: 9000 };
r = await avisar(9001, { secreto: 'otra-clave' });
assert.equal(r.status, 401); ok('firma falsa: rechaza');
assert.equal(sql('postgres', `select estado from public.reservas where id = ${reserva.id}`), 'pendiente'); ok('…y la reserva sigue pendiente');

r = await avisar(9001);
assert.equal(await r.text(), 'CONFIRMADA'); ok('pago aprobado: CONFIRMADA');
assert.equal(sql('postgres', `select estado from public.reservas where id = ${reserva.id}`), 'confirmada'); ok('la reserva quedó confirmada en la base');
r = await avisar(9001);
assert.equal(await r.text(), 'YA_REGISTRADO'); ok('aviso repetido: no duplica');

mp.pagos['9002'] = { id: 9002, status: 'rejected', currency_id: 'ARS', external_reference: `reserva-${reserva.id}`, transaction_amount: 9000 };
r = await avisar(9002);
assert.equal(await r.text(), 'pago rejected'); ok('pago rechazado: no registra nada');
mp.pagos['9003'] = { id: 9003, status: 'approved', currency_id: 'ARS', external_reference: 'otra-cosa', transaction_amount: 5 };
r = await avisar(9003);
assert.equal(await r.text(), 'no es un pago de reserva'); ok('pago ajeno a reservas: lo ignora');
r = await avisar(9004, { tipo: 'merchant_order' });
assert.equal(await r.text(), 'ignorado'); ok('otros avisos: los ignora');
r = await avisar(9999);
assert.equal(r.status, 502); ok('pago que Mercado Pago no encuentra: pide reintento');

const estado = JSON.parse(sql('anon', `select public.estado_pago_reserva(${reserva.id}, '${reserva.token}')`));
assert.equal(estado.estado, 'confirmada'); assert.equal(estado.pagado, 9000); ok('la web ve la reserva confirmada al volver');

// ---------- Pedido de varios días ----------
const d2 = sql('postgres', `select (date '${dia}' + case when extract(isodow from date '${dia}' + 3) = 7 then 4 else 3 end)::text`);
const items = JSON.stringify([{ fecha: dia, horas: [10, 11], consultorio: 2 }, { fecha: d2, horas: [16], consultorio: null }]);
const pedido = JSON.parse(sql('anon', `select public.crear_pedido('Pedro Pedido', '1133335555', 'Psicólogo', 'pedro@prueba.com', '${items}'::jsonb)`));
r = await pedir({ pedido_id: pedido.pedido, token: pedido.token });
cuerpo = await r.json();
assert.equal(r.status, 200, JSON.stringify(cuerpo));
const prefPedido = mp.preferencias.at(-1);
assert.equal(prefPedido.items[0].unit_price, pedido.sena); ok(`pedido de 2 días: cobra una sola seña de $${pedido.sena}`);
assert.equal(prefPedido.external_reference, `pedido-${pedido.pedido}`); ok('identifica el pedido');
assert.equal(prefPedido.back_urls.success, `https://reservas.prueba/?pago=ok&pedido=${pedido.pedido}&t=${pedido.token}`); ok('vuelve a la web con el pedido y su código');
mp.pagos['9101'] = { id: 9101, status: 'approved', currency_id: 'ARS', external_reference: `pedido-${pedido.pedido}`, transaction_amount: pedido.sena };
r = await avisar(9101);
assert.equal(await r.text(), 'CONFIRMADA'); ok('pago del pedido aprobado: CONFIRMADA');
assert.equal(sql('postgres', `select count(*) from public.reservas where pedido_id = ${pedido.pedido} and estado = 'confirmada'`), '2'); ok('los 2 días quedaron confirmados');
r = await avisar(9101);
assert.equal(await r.text(), 'YA_REGISTRADO'); ok('aviso repetido del pedido: no duplica');

console.log('PRUEBAS DE FUNCIONES DEL SERVIDOR PASARON');

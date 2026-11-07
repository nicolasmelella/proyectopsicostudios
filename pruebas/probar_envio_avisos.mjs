// Prueba la función "enviar-avisos" contra la base de prueba, con Gmail y WhatsApp simulados.
// Uso (después de correr_pruebas.sh): PGHOST=... PGPORT=... node --experimental-strip-types pruebas/probar_envio_avisos.mjs
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const BASE = 'psicostudios_prueba';
const env = {
  SUPABASE_URL: 'http://supabase.prueba', SUPABASE_SERVICE_ROLE_KEY: 'clave-servicio-prueba',
  AVISOS_SECRETO: 'secreto-avisos-prueba', SITIO_URL: 'https://reservas.prueba',
  GMAIL_USUARIO: 'consultoriospsicostudios@gmail.com', GMAIL_CLAVE_APP: 'x',
};
const sql = (rol, consulta) => execFileSync('psql', ['-d', BASE, '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', `set role ${rol};`, '-c', consulta],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const literal = (v) => (typeof v === 'number' || typeof v === 'boolean' ? String(v) : v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);
const mails = [], whatsapps = [];
globalThis.__enviarMailPrueba = async (para, m) => { mails.push({ para, ...m }); };
globalThis.fetch = async (url, op = {}) => {
  const u = String(url);
  const json = (c, s = 200) => new Response(JSON.stringify(c), { status: s, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith(env.SUPABASE_URL + '/rest/v1/rpc/')) {
    const fn = u.split('/').pop();
    const params = Object.entries(JSON.parse(op.body)).map(([k, v]) => `${k} => ${literal(v)}`).join(', ');
    return json(JSON.parse(sql('service_role', `select to_json(public.${fn}(${params}))`) || 'null'));
  }
  if (u.startsWith('https://graph.facebook.com/')) { whatsapps.push(JSON.parse(op.body)); return json({ messages: [{ id: 'wamid.x' }] }); }
  throw new Error('fetch inesperado: ' + u);
};
let manejador;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (fn) => { manejador = fn; } };
const mod = await import('../supabase/functions/enviar-avisos/index.ts');
const ok = (m) => console.log('ok  · ' + m);
const llamar = (secreto) => manejador(new Request('https://x/functions/v1/enviar-avisos', { method: 'POST', headers: { 'x-avisos-secreto': secreto } }));

// Dejar solo avisos nuevos: los anteriores (de las pruebas SQL) se marcan como enviados
sql('postgres', "update public.avisos set estado = 'enviado' where estado <> 'enviado'");
const dia = sql('postgres', "select (public.hoy_ar() + ((8 - extract(isodow from public.hoy_ar())::int) % 7) + 28)::text");
const items = JSON.stringify([{ fecha: dia, horas: [11, 12], consultorio: 2 }]);
const pedido = JSON.parse(sql('anon', `select public.crear_pedido('Flor <b>Avisos</b>', '1170000009', 'Psicóloga', 'flor@prueba.com', '${items}'::jsonb)`));

let r = await llamar('otro');
assert.equal(r.status, 401); ok('sin la clave secreta no se puede llamar');

r = await llamar(env.AVISOS_SECRETO);
const res = await r.json();
assert.deepEqual(res, { enviados: 2, fallidos: 1 }, JSON.stringify(res)); ok('manda 2 mails (profesional + equipo); el WhatsApp falla porque no está configurado');
const mail = mails.find((m) => m.para === 'flor@prueba.com');
assert.match(mail.asunto, new RegExp(`Recibimos tu reserva · Pedido #${pedido.pedido}`)); ok('asunto: ' + mail.asunto);
assert.ok(mail.html.includes(`https://reservas.prueba/?ver=${pedido.pedido}&amp;t=${pedido.token}`)); ok('el mail trae el link a "Mi reserva"');
assert.ok(mail.html.includes('Hola Flor')); ok('saluda por el nombre');
assert.ok(!mail.html.includes('<b>Avisos</b>')); ok('el nombre se muestra escapado (nadie puede meter código en el mail)');
assert.ok(mails.some((m) => m.para === 'consultoriospsicostudios@gmail.com' && /Nueva reserva web/.test(m.asunto))); ok('copia al equipo: "Nueva reserva web"');
assert.equal(sql('postgres', `select ultimo_error from public.avisos where pedido_id = ${pedido.pedido} and canal = 'whatsapp'`), 'WhatsApp no configurado (faltan WA_TOKEN / WA_PHONE_ID)');
ok('el WhatsApp queda con el error "no configurado" para reintentar');

// Con WhatsApp configurado: se reintenta y sale con la plantilla
env.WA_TOKEN = 'wa-token'; env.WA_PHONE_ID = '123';
sql('postgres', `update public.avisos set tomado_en = now() - interval '1 hour' where pedido_id = ${pedido.pedido} and canal = 'whatsapp'`);
r = await llamar(env.AVISOS_SECRETO);
assert.deepEqual(await r.json(), { enviados: 1, fallidos: 0 });
const wa = whatsapps.at(-1);
assert.equal(wa.to, '5491170000009'); assert.equal(wa.template.name, 'psico_reserva_recibida');
assert.equal(wa.template.parameters, undefined);
const ps = wa.template.components[0].parameters.map((x) => x.text);
assert.equal(ps.length, 6); assert.ok(ps.every((t) => !/\n/.test(t)));
ok(`WhatsApp: plantilla ${wa.template.name}, ${ps.length} datos: ${ps.slice(0, 4).join(' | ')}`);
assert.equal(sql('postgres', `select count(*) from public.avisos where pedido_id = ${pedido.pedido} and estado = 'enviado'`), '3'); ok('los 3 avisos quedaron enviados');

// Todos los tipos tienen texto de mail y de WhatsApp
const ej = { pedido: 9, token: 't', nombre: 'Ana Pérez', total: 26000, pagado: 13000, sena: 13000, expira_en: new Date().toISOString(), motivo: 'X',
  fecha: dia, horas: [10, 11], consultorio: 'Consultorio 1', dia: 2, desde: dia, precio_semanal: 16400,
  reservas: [{ fecha: dia, horas: [10, 11], consultorio: 'Consultorio 1', estado: 'confirmada' }],
  transferencia: { alias: 'psico.alias', cvu: '000', titular: 'Psico' }, profesional: { nombre: 'Ana', whatsapp: '11', email: 'a@b.c' } };
const tipos = ['reserva_creada', 'reserva_confirmada', 'reserva_vencida', 'reserva_cancelada', 'comprobante_recibido', 'comprobante_rechazado',
  'fijo_solicitado', 'fijo_aprobado', 'fijo_rechazado', 'equipo_reserva_creada', 'equipo_comprobante_recibido', 'equipo_fijo_solicitado'];
for (const t of tipos) {
  const m = mod.armarMail({ id: 1, tipo: t, canal: 'email', destino: 'x', datos: ej }, 'https://s');
  assert.ok(m.asunto && m.html.length > 500 && m.texto.length > 20, t);
  if (!t.startsWith('equipo_')) assert.ok(mod.armarWhatsApp({ id: 1, tipo: t, canal: 'whatsapp', destino: 'x', datos: ej }, 'https://s').plantilla, t);
}
ok(`los ${tipos.length} tipos de aviso tienen mail (y WhatsApp los 9 del profesional)`);
console.log('PRUEBAS DE ENVÍO DE AVISOS PASARON');

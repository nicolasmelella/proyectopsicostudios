// Prueba la función del servidor "asistente-whatsapp" sin servicios reales:
//  · la base es el PostgreSQL local de pruebas (después de las pruebas SQL)
//  · WhatsApp, Claude, el login y el guardado de archivos se simulan
// Uso: lo corre pruebas/correr_pruebas.sh
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';

const BASE = 'psicostudios_prueba';
const env = {
  SUPABASE_URL: 'http://supabase.prueba', SUPABASE_ANON_KEY: 'anon-prueba', SUPABASE_SERVICE_ROLE_KEY: 'clave-servicio-prueba',
  SITIO_URL: 'https://reservas.prueba/', WA_APP_SECRET: 'secreto-meta', WA_VERIFY_TOKEN: 'palabra-meta',
  ASISTENTE_SECRETO: 'secreto-tareas', ASISTENTE_ESPERA_MS: '0', WA_TOKEN: 'wa', WA_PHONE_ID: '123',
};
const ok = (m) => console.log('ok  · ' + m);

// ---------- base de datos ----------
const psql = (args) => execFileSync('psql', ['-d', BASE, '-qAt', '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
function sql(consulta, usuario = null) {
  const rol = usuario ? ['-c', 'set role authenticated;', '-c', `select set_config('request.jwt.claim.sub', '${usuario}', false);`] : ['-c', 'set role service_role;'];
  try { return psql([...rol, '-c', consulta]).trim().split('\n').pop(); }
  catch (e) {
    const err = String(e.stderr);
    throw { message: /ERROR:\s+(.*)/.exec(err)?.[1] ?? err, hint: /HINT:\s+(.*)/.exec(err)?.[1] };
  }
}
const pg = (c) => psql(['-c', c]).trim();
const literal = (v) => {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v) && v.every((x) => typeof x === 'number')) return `'{${v.join(',')}}'`;
  if (typeof v === 'object') return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

const idEquipo = pg("select id from auth.users where email = 'asis-equipo@x.com'");
const sesiones = { 'jwt-equipo': idEquipo };

// ---------- servicios simulados ----------
const enviados = [];        // WhatsApp que salieron
const archivos = {};        // archivos "de WhatsApp"
const subidos = [];         // comprobantes guardados
const pedidosAClaude = [];  // lo que se le mandó a Claude
let guion = [];             // lo que contesta Claude, en orden
const whisper = [];         // audios que se mandaron a transcribir
let whisperRespuesta = () => new Response(JSON.stringify({ text: '' }), { status: 200 });

globalThis.fetch = async (url, opciones = {}) => {
  const u = String(url);
  const json = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith(env.SUPABASE_URL + '/rest/v1/rpc/')) {
    const fn = u.split('/').pop();
    const jwt = opciones.headers.Authorization.replace('Bearer ', '');
    let usuario = null;
    if (jwt !== env.SUPABASE_SERVICE_ROLE_KEY) {
      assert.equal(opciones.headers.apikey, env.SUPABASE_ANON_KEY);
      usuario = sesiones[jwt];
      if (!usuario) return json({ message: 'JWT inválido' }, 401);
    }
    const params = Object.entries(JSON.parse(opciones.body)).map(([k, v]) => `${k} => ${literal(v)}`).join(', ');
    let salida;
    try { salida = sql(`select to_json(public.${fn}(${params}))`, usuario); } catch (e) { return json(e, 400); }
    return json(salida === '' ? null : JSON.parse(salida));   // (las funciones "void" no devuelven nada)
  }
  if (u.startsWith(env.SUPABASE_URL + '/rest/v1/config')) {
    return json(JSON.parse(pg("select json_agg(json_build_object('clave', clave, 'valor', valor)) from public.config")));
  }
  if (u === 'https://api.openai.com/v1/audio/transcriptions') {
    whisper.push({ auth: opciones.headers.Authorization, model: opciones.body.get('model'), language: opciones.body.get('language'),
                   prompt: opciones.body.get('prompt'), archivo: opciones.body.get('file') });
    return whisperRespuesta();
  }
  if (u === env.SUPABASE_URL + '/auth/v1/user') {
    const id = sesiones[opciones.headers.Authorization.replace('Bearer ', '')];
    return id ? json({ id }) : json({ msg: 'invalid JWT' }, 401);
  }
  throw new Error('fetch inesperado: ' + u);
};
globalThis.__enviarWhatsAppPrueba = async (para, texto, extra = {}) => { enviados.push({ para, texto, ...extra }); };
globalThis.__bajarMediaPrueba = async (id) => { if (!archivos[id]) throw new Error('no existe'); return archivos[id]; };
globalThis.__subirArchivoPrueba = async (ruta, datos, mime) => {
  subidos.push({ ruta, mime, bytes: datos.length });
  pg(`insert into storage.objects (bucket_id, name, metadata) values ('comprobantes', '${ruta}', '{"mimetype":"${mime}","size":"${datos.length}"}')`);
};
globalThis.__claudePrueba = {
  beta: { messages: { create: async (p) => {
    pedidosAClaude.push(structuredClone(p));
    const paso = guion.shift();
    if (!paso) throw new Error('Claude simulado: no hay más respuestas en el guion');
    if (paso instanceof Error) throw paso;
    return typeof paso === 'function' ? paso(p) : paso;
  } } },
};
const texto = (t) => ({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '', signature: 'firma' }, { type: 'text', text: t }],
                        usage: { input_tokens: 2000, output_tokens: 80, cache_read_input_tokens: 1500 } });
const herramienta = (name, input, id = 'tu_' + Math.random().toString(36).slice(2, 8)) => ({ stop_reason: 'tool_use',
  content: [{ type: 'thinking', thinking: '', signature: 'firma' }, { type: 'tool_use', id, name, input }],
  usage: { input_tokens: 1800, output_tokens: 40 } });
const jsonComoTexto = (obj) => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }], usage: { input_tokens: 500, output_tokens: 100 } });

let manejador;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (fn) => { manejador = fn; } };
const mod = await import('../supabase/functions/asistente-whatsapp/index.ts');

const firmar = (cuerpo, secreto = env.WA_APP_SECRET) => 'sha256=' + createHmac('sha256', secreto).update(cuerpo).digest('hex');
let nWa = 0;
const deWhatsApp = (de, mensaje, nombre = 'Juan') => {
  const cuerpo = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: {
    contacts: [{ wa_id: de, profile: { name: nombre } }],
    messages: [{ from: de, id: `wamid.prueba.${++nWa}`, timestamp: '1', ...mensaje }] } }] }] });
  return manejador(new Request('https://x/functions/v1/asistente-whatsapp', { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-hub-signature-256': firmar(cuerpo) }, body: cuerpo }));
};
const panel = (cuerpo, jwt = 'jwt-equipo') => manejador(new Request('https://x', { method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}) }, body: JSON.stringify(cuerpo) }));
const tarea = (accion, secreto = env.ASISTENTE_SECRETO) => manejador(new Request('https://x', { method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-asistente-secreto': secreto }, body: JSON.stringify({ accion }) }));

pg("update public.config set valor = 'si' where clave = 'asistente_activo'");
pg("update public.config set valor = 'no' where clave = 'asistente_solo_prueba'");
pg("update public.config set valor = 'Sofía' where clave = 'asistente_nombre'");
let dia = pg('select public.hoy_ar() + 12');
if (pg(`select extract(isodow from date '${dia}')`) === '7') dia = pg(`select date '${dia}' + 1`);
const CEL = '5491166667777';

// =====================================================================
// Conexión con Meta
// =====================================================================
let r = await manejador(new Request('https://x/?hub.mode=subscribe&hub.verify_token=palabra-meta&hub.challenge=12345'));
assert.equal(await r.text(), '12345'); ok('Meta: verificación del webhook con la palabra correcta');
r = await manejador(new Request('https://x/?hub.mode=subscribe&hub.verify_token=otra&hub.challenge=12345'));
assert.equal(r.status, 403); ok('Meta: palabra equivocada, rechaza');
const falso = JSON.stringify({ entry: [] });
r = await manejador(new Request('https://x', { method: 'POST', headers: { 'x-hub-signature-256': firmar(falso, 'otra') }, body: falso }));
assert.equal(r.status, 401); ok('mensaje con firma falsa (no viene de WhatsApp): rechaza');
r = await tarea('recordatorios', 'clave-mala');
assert.equal(r.status, 401); ok('tareas automáticas sin la clave secreta: rechaza');
r = await panel({ accion: 'simular', texto: 'hola' }, null);
assert.equal(r.status, 401); ok('simulador sin sesión del panel: rechaza');

// =====================================================================
// 1. Consulta de disponibilidad (con una herramienta)
// =====================================================================
guion = [herramienta('ver_horarios_libres', { fecha: dia }), texto(`¡Hola Juan! Soy Sofía 😊 El ${mod.fechaCorta(dia)} de 10 a 12 hs está libre el Consultorio 1.`)];
r = await deWhatsApp(CEL, { type: 'text', text: { body: `Hola! tienen lugar el ${dia} de 10 a 12?` } });
assert.equal(r.status, 200);
assert.equal(enviados.length, 1); assert.equal(enviados[0].para, CEL); assert.match(enviados[0].texto, /Soy Sofía/);
ok('llega un WhatsApp: consulta horarios y contesta por WhatsApp');
let p = pedidosAClaude[0];
assert.equal(p.model, 'claude-opus-5-5'); ok('usa Claude Opus 5.5 por defecto');
assert.deepEqual(p.thinking, { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } }); ok('piensa antes de responder (adaptive)');
assert.equal(p.fallbacks, 'default'); assert.ok(p.betas.includes('server-side-fallback-2026-07-01')); ok('si el modelo declina, reintenta solo en otro (fallback)');
assert.equal(p.output_config.effort, 'medium'); ok('esfuerzo desde Ajustes: medium');
assert.equal(p.system[0].text, mod.INSTRUCCIONES); ok('instrucciones fijas (no cambian entre mensajes)');
assert.equal(p.tools.length, 20); ok('20 herramientas');
const ctx0 = p.messages[0].content[0].text;
assert.match(ctx0, /\[Contexto/); assert.match(ctx0, /Tu nombre: Sofía/); assert.match(ctx0, /No está registrado/); assert.match(ctx0, /comienzo de la charla/);
assert.match(ctx0, new RegExp(`${mod.fechaCorta(dia)} = ${dia}`)); ok('contexto: fecha con días de la semana, nombre, cliente nuevo');
assert.match(pedidosAClaude[1].messages.at(-1).content[0].content, /"por_consultorio"/); ok('le devuelve los horarios libres por consultorio');
assert.equal(pg(`select count(*) from public.asistente_mensajes m join public.asistente_chats c on c.id = m.chat_id where c.whatsapp = '${CEL}' and m.rol = 'asistente' and m.envio = 'enviado'`), '1');
ok('la respuesta queda guardada como enviada');

// =====================================================================
// 2. Confirma: reserva de verdad y pasa los datos de pago
// =====================================================================
const antes = pedidosAClaude.length;
guion = [
  herramienta('reservar_horas', { nombre: 'Juan Pérez', profesion: 'Psicólogo', email: 'juan@x.com', dias: [{ fecha: dia, horas: [10, 11], consultorio_id: 1 }] }),
  (q) => texto('¡Listo! Te reservé. ' + JSON.parse(q.messages.at(-1).content[0].content).sena_a_pagar),
];
r = await deWhatsApp(CEL, { type: 'text', text: { body: 'Sí! Juan Pérez, psicólogo, juan@x.com' } });
const pedidoId = Number(pg(`select max(pedido_id) from public.asistente_pedidos`));
assert.ok(pedidoId > 0); assert.equal(pg(`select origen from public.pedidos where id = ${pedidoId}`), 'whatsapp');
assert.equal(pg(`select string_agg(h::text, ',') from public.reservas r, unnest(r.horas) h where r.pedido_id = ${pedidoId}`), '10,11');
ok('reserva de verdad: pedido de WhatsApp con las horas pedidas');
const resultado = JSON.parse(pedidosAClaude.at(-1).messages.at(-1).content[0].content);
assert.equal(resultado.reservado, true); assert.match(resultado.link_mi_reserva, new RegExp(`^https://reservas.prueba/\\?ver=${pedidoId}&t=`));
assert.match(resultado.pagar_antes_de, /a las \d\d:\d\d/); assert.match(resultado.sena_a_pagar, /^\$/);
ok('le pasa total, seña, plazo en hora argentina y el link "Mi reserva"');
assert.match(enviados.at(-1).texto, /^¡Listo! Te reservé\. \$/); ok('contesta con la seña');
// La charla se manda igual que antes + lo nuevo (así no se pierde el razonamiento ni la caché)
const previo = pedidosAClaude[antes - 1];
const actual = pedidosAClaude[antes];
assert.deepEqual(actual.messages.slice(0, previo.messages.length), previo.messages);
const final1 = actual.messages[previo.messages.length];
assert.equal(final1.role, 'assistant'); assert.equal(final1.content[0].type, 'thinking'); assert.match(final1.content[1].text, /Soy Sofía/);
ok('la charla anterior se reenvía exacta, con el razonamiento (solo se agrega al final)');
assert.equal(actual.messages.length, previo.messages.length + 2);
assert.match(actual.messages.at(-1).content[0].text, /^\[Contexto/);
ok('cada mensaje nuevo trae su propio contexto');

// =====================================================================
// 3. Manda la foto del comprobante
// =====================================================================
archivos['media-1'] = { datos: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), mime: 'image/jpeg' };
guion = [
  (q) => {
    const bloques = q.messages.at(-1).content;
    const img = bloques.find((b) => b.type === 'image');
    assert.ok(img && img.source.media_type === 'image/jpeg' && img.source.data.length > 0);
    const nota = bloques.find((b) => b.type === 'text' && /archivo del mensaje #(\d+)/.test(b.text));
    assert.match(nota.text, /con el texto: seña/);
    return herramienta('guardar_comprobante', { pedido: pedidoId, mensaje_id: Number(/#(\d+)/.exec(nota.text)[1]) });
  },
  texto('¡Gracias! Recibí el comprobante: el equipo lo revisa y te confirma.'),
];
await deWhatsApp(CEL, { type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'seña' } });
assert.equal(subidos.length, 1); assert.match(subidos[0].ruta, new RegExp(`^${pedidoId}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.jpg$`));
assert.equal(pg(`select count(*) from public.comprobantes where pedido_id = ${pedidoId} and estado = 'pendiente'`), '1');
ok('foto del comprobante: la IA la ve y queda en "Comprobantes para revisar" del panel');
assert.equal(pg(`select estado from public.reservas where pedido_id = ${pedidoId}`), 'pendiente'); ok('…pero no confirma el pago (eso lo hace el equipo)');

// =====================================================================
// 4. Varios mensajes seguidos: se contestan juntos
// =====================================================================
const n = enviados.length;
const chatId = Number(pg(`select id from public.asistente_chats where whatsapp = '${CEL}'`));
pg(`update public.asistente_chats set procesando_desde = now() where id = ${chatId}`);   // como si estuviera pensando
await deWhatsApp(CEL, { type: 'text', text: { body: 'otra cosa' } });
await deWhatsApp(CEL, { type: 'audio', audio: { id: 'a1', mime_type: 'audio/ogg' } });
assert.equal(enviados.length, n); ok('mientras piensa, no arranca otra respuesta en paralelo');
pg(`update public.asistente_chats set procesando_desde = null where id = ${chatId}`);
guion = [(q) => {
  const t = q.messages.at(-1).content.map((b) => b.text || '').join('|');
  assert.match(t, /otra cosa/); assert.match(t, /audio que no se pudo transcribir/);
  return texto('Te leo! No puedo escuchar audios, ¿me lo escribís?');
}];
await deWhatsApp(CEL, { type: 'text', text: { body: 'hola??' } });
assert.equal(enviados.length, n + 1); ok('el siguiente mensaje contesta todo junto (y avisa que no escucha audios)');

// =====================================================================
// 5. Si la IA falla: avisa, deriva y no pierde los mensajes
// =====================================================================
guion = [new Error('API caída')];
await deWhatsApp(CEL, { type: 'text', text: { body: 'me confirmás?' } });
assert.match(enviados.at(-1).texto, /tuve un problema/); ok('si falla la IA, le avisa a la persona');
assert.equal(pg(`select atender from public.asistente_chats where id = ${chatId}`), 't'); ok('…y lo marca para el equipo');
assert.equal(pg(`select count(*) from public.asistente_mensajes where chat_id = ${chatId} and rol = 'cliente' and not leido`), '1');
ok('…sin perder el mensaje (la próxima vez lo vuelve a ver)');

// =====================================================================
// 6. El equipo contesta desde el panel: se envía y el asistente aprende
// =====================================================================
const enviadosAntes = enviados.length;
guion = [jsonComoTexto({ proponer: true, pregunta: '¿Se puede ir con mascota?', respuesta: 'Sí, perros chicos en la sala de espera.', tema: 'El espacio', motivo: 'Lo respondió el equipo' })];
r = await panel({ accion: 'responder', chat_id: chatId, texto: 'Hola Juan! Sí, podés venir con tu perro chico.' });
assert.equal((await r.json()).ok, true);
assert.equal(enviados.length, enviadosAntes + 1); assert.equal(enviados.at(-1).para, CEL); ok('el equipo responde desde el panel: sale por WhatsApp');
assert.equal(pg(`select (pausa_hasta > now()) and not atender from public.asistente_chats where id = ${chatId}`), 't'); ok('el asistente se calla en ese chat un rato');
assert.equal(pg("select count(*) from public.asistente_propuestas where origen = 'equipo' and pregunta like '%mascota%'"), '1');
ok('aprende de la respuesta del equipo: queda una propuesta para aprobar');
assert.deepEqual(pedidosAClaude.at(-1).output_config.format.type, 'json_schema'); ok('…con respuesta estructurada');
r = await panel({ accion: 'responder', chat_id: chatId, texto: 'x' }, 'jwt-falso');
assert.equal(r.status, 401); ok('sin sesión válida no se puede responder');

// =====================================================================
// 7. Simulador del panel: contesta sin WhatsApp y sin reservar de verdad
// =====================================================================
const pedidosAntes = pg('select count(*) from public.pedidos');
guion = [
  (q) => { assert.match(q.messages.at(-1).content[0].text, /SIMULADOR/); return herramienta('reservar_horas', { nombre: 'Prueba', profesion: 'Psicóloga', email: 'p@x.com', dias: [{ fecha: dia, horas: [15] }] }); },
  texto('Listo (simulación).'),
];
const enviadosSim = enviados.length;
r = await panel({ accion: 'simular', texto: 'quiero reservar a las 15' });
const sim = await r.json();
assert.equal(sim.texto, 'Listo (simulación).'); assert.deepEqual(sim.herramientas, [{ nombre: 'reservar_horas', ok: true }]);
ok('simulador: responde y muestra qué herramientas usó');
assert.equal(enviados.length, enviadosSim); assert.equal(pg('select count(*) from public.pedidos'), pedidosAntes); ok('…sin mandar WhatsApp ni crear pedidos');
assert.match(JSON.parse(pedidosAClaude.at(-1).messages.at(-1).content[0].content).simulado, /SIMULADOR/); ok('la herramienta le avisa que es una simulación');
r = await panel({ accion: 'simular', reiniciar: true });
assert.equal((await r.json()).ok, true); ok('reiniciar el simulador');

// =====================================================================
// 8. Recordatorio de seña (tarea automática)
// =====================================================================
pg(`delete from public.comprobantes where pedido_id = ${pedidoId}`);
pg(`update public.asistente_pedidos set creado_en = now() - interval '2 hours' where pedido_id = ${pedidoId}`);
pg(`update public.asistente_chats set pausa_hasta = null where id = ${chatId}`);
r = await tarea('recordatorios');
assert.deepEqual(await r.json(), { enviados: 1, seguimientos: 0 });
assert.match(enviados.at(-1).texto, /^Hola Juan! Soy Sofía\. Te recuerdo que tu reserva #\d+ .* falta la seña de \*\$/);
ok('recordatorio de seña automático, con nombre y monto');
r = await tarea('recordatorios');
assert.deepEqual(await r.json(), { enviados: 0, seguimientos: 0 }); ok('no lo repite');

// =====================================================================
// 9. Revisión semanal
// =====================================================================
const informe = { resumen: 'Semana tranquila.', temas_frecuentes: [{ tema: 'Disponibilidad', veces: 3 }], preguntas_sin_respuesta: ['¿Hay estacionamiento?'],
  reservas_perdidas: [], demanda_sin_lugar: ['Martes a la tarde'], errores_del_asistente: [], ideas_para_el_negocio: ['Promocionar las mañanas'],
  propuestas: [{ pregunta: '¿Hay ascensor?', respuesta: 'Sí.', tema: 'El espacio', motivo: 'Lo dijo el equipo', corrige_id: null }] };
guion = [(q) => { assert.equal(q.output_config.effort, 'high'); assert.match(q.messages[0].content, /Juan|charlas/); return jsonComoTexto(informe); }];
r = await tarea('revision');
assert.ok((await r.json()).informe > 0);
assert.equal(pg("select datos->>'resumen' from public.asistente_informes order by id desc limit 1"), 'Semana tranquila.');
assert.equal(pg("select count(*) from public.asistente_propuestas where origen = 'revision' and pregunta = '¿Hay ascensor?'"), '1');
ok('revisión semanal: guarda el informe y deja propuestas para aprobar');

// =====================================================================
// 10. El equipo contesta desde el celular (coexistencia): el asistente se calla
// =====================================================================
pg(`update public.asistente_chats set pausa_hasta = null where id = ${chatId}`);
const eco = JSON.stringify({ entry: [{ changes: [{ field: 'smb_message_echoes', value: { message_echoes: [
  { from: '5491178224918', to: CEL, id: 'wamid.eco.1', type: 'text', text: { body: 'Hola Juan, soy Silvia. Te confirmo yo.' } }] } }] }] });
await manejador(new Request('https://x', { method: 'POST', headers: { 'x-hub-signature-256': firmar(eco) }, body: eco }));
assert.equal(pg(`select count(*) from public.asistente_mensajes where chat_id = ${chatId} and rol = 'equipo' and texto like '%soy Silvia%'`), '1');
assert.equal(pg(`select pausa_hasta > now() from public.asistente_chats where id = ${chatId}`), 't');
ok('si el equipo contesta desde la app del celular, queda en el chat y el asistente se calla');
const enviadosEco = enviados.length;
await deWhatsApp(CEL, { type: 'text', text: { body: 'gracias Silvia!' } });
assert.equal(enviados.length, enviadosEco); ok('…y no se mete en esa charla');

// =====================================================================
// 11. Fotos y CRM en una charla nueva
// =====================================================================
const CEL2 = '5491122223333';
guion = [
  { stop_reason: 'tool_use', usage: {}, content: [
    { type: 'tool_use', id: 'f1', name: 'mandar_fotos', input: { cual: '3' } },
    { type: 'tool_use', id: 'f2', name: 'calificar_contacto', input: { etapa: 'interesado', interes: 'fijo', valor_estimado_mensual: 136000, nota: 'Fijo martes 15 a 17', prioridad: true } }] },
  (q) => {
    const res = q.messages.at(-1).content;
    assert.equal(res.length, 2); assert.ok(res.every((b) => b.type === 'tool_result' && !b.is_error));
    return texto('Te mandé fotos del 3 ☝️ ¿Te reservo los martes de 15 a 17?');
  },
];
const enviadosF = enviados.length;
await deWhatsApp(CEL2, { type: 'text', text: { body: 'Hola! busco algo fijo los martes de 15 a 17, ¿cómo es el consultorio 3?' } }, 'Ana');
const fotos = enviados.slice(enviadosF).filter((x) => x.imagen);
assert.deepEqual(fotos.map((x) => x.imagen), ['https://reservas.prueba/img/consultorios/c3-a.jpg', 'https://reservas.prueba/img/consultorios/c3-b.jpg']);
assert.match(fotos[0].texto, /Consultorio 3/);
assert.match(enviados.at(-1).texto, /Te mandé fotos/);
ok('manda las fotos del consultorio por WhatsApp (con epígrafe) y después el texto');
const chat2 = Number(pg(`select id from public.asistente_chats where whatsapp = '${CEL2}'`));
assert.equal(pg(`select count(*) from public.asistente_mensajes where chat_id = ${chat2} and tipo = 'imagen' and media->>'url' like '%c3-a.jpg'`), '1');
ok('las fotos quedan en el chat del panel');
assert.equal(pg(`select etapa || '|' || interes || '|' || valor_estimado || '|' || prioridad from public.asistente_chats where id = ${chat2}`), 'interesado|fijo|136000|true');
ok('precalifica: interesado en un fijo, ~$136.000/mes, prioridad');

// =====================================================================
// 12. Seguimiento: se calló sin reservar → el asistente decide si escribir
// =====================================================================
pg(`update public.asistente_chats set ultimo_cliente_en = now() - interval '4 hours' where id = ${chat2}`);
guion = [(q) => {
  assert.match(q.messages.at(-1).content.map((b) => b.text || '').join(' '), /SEGUIMIENTO AUTOMÁTICO/);
  assert.match(q.messages.at(-1).content[0].text, /PRIORIDAD/);
  return texto('Hola Ana! Te cuento que los martes de 15 a 17 el Consultorio 3 sigue libre. ¿Te lo guardo?');
}];
r = await tarea('recordatorios');
assert.deepEqual(await r.json(), { enviados: 0, seguimientos: 1 });
assert.match(enviados.at(-1).texto, /sigue libre/); assert.equal(enviados.at(-1).para, CEL2);
ok('seguimiento automático: le vuelve a escribir una vez, con lo que buscaba');
pg(`update public.asistente_chats set seguimiento_en = null, ultimo_cliente_en = now() - interval '4 hours' where id = ${chat2}`);
const enviadosN = enviados.length;
guion = [texto('NADA')];
r = await tarea('recordatorios');
assert.deepEqual(await r.json(), { enviados: 0, seguimientos: 0 });
assert.equal(enviados.length, enviadosN); ok('si decide que no corresponde ("NADA"), no manda nada');

// Simulador: las fotos se devuelven para verlas en el panel (no se mandan)
guion = [herramienta('mandar_fotos', { cual: 'espacio' }), texto('Ahí van fotos del espacio.')];
r = await panel({ accion: 'simular', texto: '¿cómo es el lugar?' });
assert.equal((await r.json()).fotos.length, 3); ok('simulador: muestra las fotos que mandaría');

// =====================================================================
// 13. Audios: se transcriben con Whisper y el asistente responde al contenido
// =====================================================================
env.OPENAI_API_KEY = 'sk-prueba';
archivos['audio-1'] = { datos: new Uint8Array([0x4f, 0x67, 0x67, 0x53, 1, 2, 3]), mime: 'audio/ogg' };
whisperRespuesta = () => new Response(JSON.stringify({ text: 'Hola, quería saber si el viernes a las diez hay lugar.' }), { status: 200 });
const CEL3 = '5491144440000';
guion = [(q) => {
  const t = q.messages.at(-1).content.map((b) => b.text || '').join('|');
  assert.match(t, /\[Audio del cliente, transcripto automáticamente \(puede tener errores\)\]: Hola, quería saber si el viernes a las diez hay lugar\./);
  return texto('¡Hola! Sí, el viernes a las 10 hay lugar en el Consultorio 2. ¿Te lo reservo?');
}];
await deWhatsApp(CEL3, { type: 'audio', audio: { id: 'audio-1', mime_type: 'audio/ogg; codecs=opus' } }, 'Pablo');
const w = whisper.at(-1);
assert.equal(w.auth, 'Bearer sk-prueba'); assert.equal(w.model, 'whisper-1'); assert.equal(w.language, 'es');
assert.match(w.prompt, /seña/); assert.equal(w.archivo.name, 'audio.ogg'); assert.equal(w.archivo.size, 7);
ok('audio: lo baja de WhatsApp y lo manda a Whisper (español, con el vocabulario del negocio)');
assert.match(enviados.at(-1).texto, /el viernes a las 10 hay lugar/); ok('el asistente responde al contenido del audio');
assert.equal(pg(`select texto from public.asistente_mensajes m join public.asistente_chats c on c.id = m.chat_id where c.whatsapp = '${CEL3}' and m.tipo = 'audio'`),
  'Hola, quería saber si el viernes a las diez hay lugar.');
ok('la transcripción queda en el chat del panel');

whisperRespuesta = () => new Response('caído', { status: 500 });
guion = [(q) => {
  assert.match(q.messages.at(-1).content.at(-1).text, /no se pudo transcribir/);
  return texto('Perdón, no pude escuchar tu audio. ¿Me lo escribís?');
}];
await deWhatsApp(CEL3, { type: 'audio', audio: { id: 'audio-1', mime_type: 'audio/ogg' } }, 'Pablo');
assert.match(enviados.at(-1).texto, /¿Me lo escribís\?/); ok('si Whisper falla, pide con amabilidad que lo escriba');

pg("update public.config set valor = 'no' where clave = 'asistente_transcribir_audios'");
const nWhisper = whisper.length;
guion = [texto('¿Me lo escribís?')];
await deWhatsApp(CEL3, { type: 'audio', audio: { id: 'audio-1', mime_type: 'audio/ogg' } }, 'Pablo');
assert.equal(whisper.length, nWhisper); ok('con "Entender audios: No" no se transcribe (no gasta)');
pg("update public.config set valor = 'si' where clave = 'asistente_transcribir_audios'");
delete env.OPENAI_API_KEY;

// =====================================================================
// 14. Quien ya alquila mueve su turno (y alguien no reconocido no puede)
// =====================================================================
const resId = Number(pg(`select id from public.reservas where pedido_id = ${pedidoId}`));
pg(`update public.asistente_chats set pausa_hasta = null, atender = false where whatsapp = '${CEL}'`);
guion = [
  herramienta('mis_reservas', {}),
  (q) => {
    const mr = JSON.parse(q.messages.at(-1).content[0].content);
    assert.equal(mr.proximos_turnos[0].reserva_id, resId);
    return herramienta('mover_turno', { tipo: 'reserva', reserva_id: resId, nueva_fecha: dia, nuevas_horas: [17, 18] });
  },
  (q) => {
    const r = JSON.parse(q.messages.at(-1).content[0].content);
    assert.equal(r.movida, true); assert.equal(r.a_pagar, '$1.000'); assert.equal(r.horario, '17 a 19 hs');
    return texto('¡Listo! Te pasé al mismo día de 17 a 19 hs. Como la tarde sale un poco más, quedan $1.000 de diferencia.');
  },
];
await deWhatsApp(CEL, { type: 'text', text: { body: 'Sí, pasame de 17 a 19 porfa' } });
assert.equal(pg(`select array_to_string(horas, ',') || '|' || precio_total from public.reservas where id = ${resId}`), '17,18|18000');
assert.match(enviados.at(-1).texto, /\$1\.000 de diferencia/);
ok('quien ya alquila mueve su turno por WhatsApp: se mueve en la agenda y queda la diferencia como saldo');
assert.equal(pg(`select count(*) from public.asistente_cambios where reserva_id = ${resId}`), '1'); ok('el cambio queda registrado para el equipo');

guion = [
  herramienta('no_vengo', { fijo_id: 1, fecha: dia }),
  (q) => {
    const r = q.messages.at(-1).content[0];
    assert.equal(r.is_error, true); assert.match(r.content, /SIN_IDENTIFICAR/);
    return texto('Por seguridad, ¿me pasás tu nombre y el mail con el que alquilás? Se lo paso al equipo.');
  },
];
await deWhatsApp('5491199990000', { type: 'text', text: { body: 'Hola, soy fija de los lunes y este no voy' } }, 'Desconocida');
assert.match(enviados.at(-1).texto, /Por seguridad/); ok('un número que no reconoce no puede mover ni liberar nada');

// Utilidades
assert.equal(mod.rangos([10, 11, 15]), '10 a 12 hs y 15 a 16 hs'); ok('horarios: "10 a 12 hs y 15 a 16 hs"');
assert.deepEqual(mod.partirMensaje('a'.repeat(5000)).map((x) => x.length), [3800, 1200]); ok('mensajes largos se parten (WhatsApp tiene límite)');
assert.equal(mod.leerMensajeWhatsApp({ type: 'interactive', interactive: { button_reply: { title: 'Sí' } } }).texto, 'Sí'); ok('entiende botones');

console.log('PRUEBAS DE LA FUNCIÓN DEL ASISTENTE PASARON');

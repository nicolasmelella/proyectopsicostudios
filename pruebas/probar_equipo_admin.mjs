// Prueba la función del servidor "equipo-admin" sin Supabase real:
//  · la base es el PostgreSQL local de pruebas (después de correr_pruebas.sh)
//  · el login y las invitaciones de Supabase se simulan
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';

const BASE = 'psicostudios_prueba';
const env = {
  SUPABASE_URL: 'http://supabase.prueba', SUPABASE_ANON_KEY: 'anon-prueba',
  SUPABASE_SERVICE_ROLE_KEY: 'clave-servicio-prueba', SITIO_URL: 'https://reservas.prueba/',
};
function sql(consulta) {
  try {
    return execFileSync('psql', ['-d', BASE, '-At', '-v', 'ON_ERROR_STOP=1', '-c', 'set role service_role;', '-c', consulta],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim().split('\n').pop();
  } catch (e) {
    const err = String(e.stderr);
    throw { message: /ERROR:\s+(.*)/.exec(err)?.[1] ?? err, hint: /HINT:\s+(.*)/.exec(err)?.[1] };
  }
}
const sqlPostgres = (c) => execFileSync('psql', ['-d', BASE, '-At', '-c', c], { encoding: 'utf8' }).trim();
const literal = (v) => (v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`);

const idAdmin = sqlPostgres("select id from auth.users where email = 'psicomel@psicostudios.local'");
const idComun = sqlPostgres("select id from auth.users where email = 'bianca@psicostudios.local'");
const sesiones = { 'jwt-admin': idAdmin, 'jwt-comun': idComun };
const invitaciones = [];

globalThis.fetch = async (url, opciones = {}) => {
  const u = String(url);
  const json = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.startsWith(env.SUPABASE_URL + '/rest/v1/rpc/')) {
    assert.equal(opciones.headers.Authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
    const fn = u.split('/').pop();
    const params = Object.entries(JSON.parse(opciones.body)).map(([k, v]) => `${k} => ${literal(v)}`).join(', ');
    try { return json(JSON.parse(sql(`select to_json(public.${fn}(${params}))`))); } catch (e) { return json(e, 400); }
  }
  if (u === env.SUPABASE_URL + '/auth/v1/user') {
    assert.equal(opciones.headers.apikey, env.SUPABASE_ANON_KEY);
    const id = sesiones[opciones.headers.Authorization.replace('Bearer ', '')];
    return id ? json({ id }) : json({ msg: 'invalid JWT' }, 401);
  }
  if (u.startsWith(env.SUPABASE_URL + '/auth/v1/invite?redirect_to=')) {
    assert.equal(opciones.headers.Authorization, `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`);
    assert.equal(decodeURIComponent(u.split('redirect_to=')[1]), 'https://reservas.prueba/panel.html');
    const { email, data } = JSON.parse(opciones.body);
    if (sqlPostgres(`select count(*) from auth.users where email = ${literal(email)}`) !== '0') return json({ msg: 'A user with this email address has already been registered' }, 422);
    const id = sqlPostgres(`insert into auth.users (email) values (${literal(email)}) returning id`).split('\n')[0];
    invitaciones.push({ email, nombre: data.nombre });
    return json({ id, email });
  }
  throw new Error('fetch inesperado: ' + u);
};
let manejador;
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (fn) => { manejador = fn; } };
await import('../supabase/functions/equipo-admin/index.ts');
const ok = (m) => console.log('ok  · ' + m);
const llamar = async (jwt, cuerpo) => {
  const r = await manejador(new Request('http://x/equipo-admin', {
    method: 'POST', headers: jwt ? { Authorization: `Bearer ${jwt}` } : {}, body: JSON.stringify(cuerpo),
  }));
  return { status: r.status, ...(await r.json()) };
};

let r = await llamar(null, { nombre: 'X', email: 'x@x.com' });
assert.equal(r.status, 401); ok('sin sesión no se puede invitar');
r = await llamar('jwt-comun', { nombre: 'Rosa Invitada', email: 'rosa@ejemplo.com' });
assert.equal(r.status, 403); ok('alguien del equipo que no es administrador no puede invitar');
r = await llamar('jwt-admin', { nombre: 'Rosa Invitada', email: 'no-es-un-mail' });
assert.equal(r.message, 'EMAIL_INVALIDO'); ok('mail inválido: avisa');
r = await llamar('jwt-admin', { nombre: 'Rosa Invitada', email: 'Rosa@Ejemplo.com', rol: 'equipo' });
assert.equal(r.ok, true);
assert.deepEqual(invitaciones.at(-1), { email: 'rosa@ejemplo.com', nombre: 'Rosa Invitada' });
assert.equal(sqlPostgres("select nombre || '|' || rol || '|' || activo from public.equipo where email = 'rosa@ejemplo.com'"), 'Rosa Invitada|equipo|true');
ok('el administrador invita: sale el mail y queda en el equipo, activa');
r = await llamar('jwt-admin', { nombre: 'Rosa Otra Vez', email: 'rosa@ejemplo.com' });
assert.equal(r.status, 409); assert.equal(r.message, 'YA_EXISTE'); ok('el mismo mail dos veces: avisa que ya tiene usuario');
console.log('PRUEBAS DE INVITAR AL EQUIPO PASARON');

// Panel del equipo (con login).
import {
  crearCliente, esc, pesos, hoyAR, sumarDias, diaSemana, fechaLarga, fechaCorta, horaTxt, rangos,
  faltan, mensajeError, linkWhatsApp, waArgentina, DIAS, DIAS_CORTOS, preguntar,
} from './comun.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const sb = await crearCliente({ sesionTemporal: true });

const DOMINIO_USUARIOS = 'psicostudios.local';
const MINUTOS_INACTIVIDAD = 60;
const MEDIOS = [['transferencia', 'Transferencia'], ['efectivo', 'Efectivo'], ['mercadopago', 'Mercado Pago'], ['otro', 'Otro']];

// Lunes de la semana de una fecha (el domingo muestra la semana que empieza)
const lunesDe = (f) => (diaSemana(f) === 7 ? sumarDias(f, 1) : sumarDias(f, 1 - diaSemana(f)));

const st = {
  fecha: hoyAR(),
  semana: lunesDe(hoyAR()),
  cfg: {},
  consultorios: [],
  profesionales: [],
  equipo: [],
  precios: [],
  yo: null,
  tab: 'semana',
};

// ================================================================ utilidades
function toast(msg, accion) {
  document.querySelectorAll('.toast').forEach((x) => x.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  if (accion) {
    const b = document.createElement('button');
    b.className = 'deshacer';
    b.textContent = accion.etiqueta;
    b.onclick = () => { t.remove(); accion.fn(); };
    t.appendChild(b);
  }
  document.body.appendChild(t);
  setTimeout(() => t.remove(), accion ? 15000 : 3200);
}

async function llamar(fn, params, okMsg) {
  const { data, error } = await sb.rpc(fn, params);
  if (error) {
    if (error.message === 'NO_AUTORIZADO' || error.code === 'PGRST301') { await salir('Tu sesión venció. Volvé a entrar.'); }
    throw error;
  }
  if (okMsg) toast(okMsg);
  return data;
}

function abrirModal(html) {
  $('#modal-cuerpo').innerHTML = html;
  $('#modal').classList.remove('oculto');
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('#modal-cuerpo input:not([type=hidden]), #modal-cuerpo select')?.focus(), 50);
}
function cerrarModal() {
  $('#modal').classList.add('oculto');
  document.body.style.overflow = '';
}
$('#modal-cerrar').onclick = cerrarModal;
$('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') cerrarModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrarModal(); });

// Muestra un error dentro del modal (o como toast si no hay lugar)
function errorEn(el, err) {
  const msg = mensajeError(err);
  if (el) { el.textContent = msg; el.classList.remove('oculto'); } else toast(msg);
}

const consNombre = (id) => st.consultorios.find((c) => c.id === id)?.nombre || `Consultorio ${id}`;
const waLink = (num, texto) => linkWhatsApp(waArgentina(num), texto);
const nombreMedio = (m) => MEDIOS.find(([v]) => v === m)?.[1] || m;
const medioOpts = (sel) => MEDIOS.map(([v, t]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${t}</option>`).join('');
const consOpts = (sel) => st.consultorios.filter((c) => c.activo)
  .map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('');
const horasDelDia = () => {
  const out = [];
  for (let h = Number(st.cfg.hora_apertura || 8); h < Number(st.cfg.hora_cierre || 21); h++) out.push(h);
  return out;
};
const sena = (total) => Math.ceil((total * Number(st.cfg.porcentaje_sena || 50)) / 100);

// ================================================================ sesión
let temporizador = null;
function reiniciarInactividad() {
  clearTimeout(temporizador);
  temporizador = setTimeout(() => salir('Se cerró la sesión por inactividad.'), MINUTOS_INACTIVIDAD * 60000);
}
['click', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, reiniciarInactividad, { passive: true }));

async function salir(msg) {
  clearTimeout(temporizador);
  await sb.auth.signOut();
  cerrarModal();
  $('#app').classList.add('oculto');
  $('#login').classList.remove('oculto');
  if (msg) { $('#aviso-login').textContent = msg; $('#aviso-login').classList.remove('oculto'); }
}
$('#btn-salir').onclick = () => salir();

$('#form-login').onsubmit = async (e) => {
  e.preventDefault();
  const aviso = $('#aviso-login');
  aviso.classList.add('oculto');
  let usuario = $('#l-usuario').value.trim().toLowerCase();
  if (!usuario.includes('@')) usuario = `${usuario}@${DOMINIO_USUARIOS}`;
  const btn = $('#btn-login');
  btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    const { error } = await sb.auth.signInWithPassword({ email: usuario, password: $('#l-clave').value });
    if (error) throw error;
    $('#l-clave').value = '';
    await entrar();
  } catch (err) {
    errorEn(aviso, err);
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
};

async function entrar() {
  const { data: esEquipo, error } = await sb.rpc('es_equipo');
  if (error || !esEquipo) {
    await salir('Este usuario no está habilitado para el panel.');
    return;
  }
  $('#login').classList.add('oculto');
  $('#app').classList.remove('oculto');
  reiniciarInactividad();
  await cargarBase();
  irA(st.tab);
  actualizarBadge();
}

async function cargarBase() {
  const [c, k, p, e, pr, s] = await Promise.all([
    sb.from('config').select('clave, valor, descripcion'),
    sb.from('consultorios').select('*').order('orden'),
    sb.from('profesionales').select('id, nombre, whatsapp, profesion').order('nombre'),
    sb.from('equipo').select('user_id, nombre'),
    sb.from('precios').select('*').order('vigente_desde', { ascending: false }),
    sb.auth.getSession(),
  ]);
  st.cfg = Object.fromEntries((c.data || []).map((r) => [r.clave, r.valor]));
  st.consultorios = k.data || [];
  st.profesionales = p.data || [];
  st.equipo = e.data || [];
  st.precios = pr.data || [];
  const uid = s.data?.session?.user?.id;
  st.yo = st.equipo.find((x) => x.user_id === uid) || null;
  $('#hola').textContent = st.yo ? `Hola, ${st.yo.nombre}` : '';
}

// Precio por hora suelta para un día y hora (el vigente en esa fecha)
const precioSuelta = (fecha, h) => st.precios.find((p) => p.modalidad === 'suelta' && p.vigente_desde <= fecha
  && p.franja === (h < Number(st.cfg.hora_fin_manana || 13) ? 'manana' : 'tarde'))?.valor || 0;

// Letra grande (se recuerda en esta compu)
function ponerLetra(grande) {
  document.documentElement.classList.toggle('letra-grande', grande);
  $('#btn-letra').setAttribute('aria-pressed', grande);
  $('#btn-letra').innerHTML = grande ? 'A− <span class="largo">Letra normal</span>' : 'A+ <span class="largo">Letra grande</span>';
}
try { ponerLetra(localStorage.getItem('psico-letra') === 'grande'); } catch { ponerLetra(false); }
$('#btn-letra').onclick = () => {
  const grande = !document.documentElement.classList.contains('letra-grande');
  ponerLetra(grande);
  try { localStorage.setItem('psico-letra', grande ? 'grande' : 'normal'); } catch { /* nada */ }
};

// ================================================================ pestañas
function irA(tab) {
  st.tab = tab;
  $$('.tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab));
  $$('[data-vista]').forEach((s) => s.classList.toggle('oculto', s.dataset.vista !== tab));
  ({ semana: pintarSemana, agenda: pintarAgenda, pendientes: pintarPendientes, fijos: pintarFijos, profesionales: pintarProfesionales, ajustes: pintarAjustes })[tab]();
}
$$('.tabs button').forEach((b) => (b.onclick = () => irA(b.dataset.tab)));

async function refrescar() {
  irA(st.tab);
  actualizarBadge();
}

async function actualizarBadge() {
  const [r, f, m, c] = await Promise.all([
    sb.from('reservas').select('id').eq('estado', 'pendiente'),
    sb.from('fijos').select('id').eq('estado', 'solicitud'),
    sb.from('pagos_a_revisar').select('id').eq('resuelto', false),
    sb.from('comprobantes').select('id').eq('estado', 'pendiente'),
  ]);
  const n = (r.data?.length || 0) + (f.data?.length || 0) + (m.data?.length || 0) + (c.data?.length || 0);
  const b = $('#badge-pend');
  b.textContent = n;
  b.classList.toggle('oculto', !n);
}

// ================================================================ AGENDA
$('#ag-ant').onclick = () => { st.fecha = sumarDias(st.fecha, -1); pintarAgenda(); };
$('#ag-sig').onclick = () => { st.fecha = sumarDias(st.fecha, 1); pintarAgenda(); };
$('#ag-hoy').onclick = () => { st.fecha = hoyAR(); pintarAgenda(); };
$('#ag-elegir').onchange = (e) => { if (e.target.value) { st.fecha = e.target.value; pintarAgenda(); } };
$('#btn-nueva-reserva').onclick = () => modalNuevaReserva({});
$('#btn-nuevo-fijo').onclick = () => modalNuevoFijo({});
$('#btn-bloquear').onclick = () => modalBloqueo();

let filasAgenda = [];

async function pintarAgenda() {
  $('#ag-fecha').textContent = fechaLarga(st.fecha) + (st.fecha === hoyAR() ? ' (hoy)' : '');
  $('#ag-elegir').value = st.fecha;
  const cont = $('#grilla');
  if (diaSemana(st.fecha) === 7) { cont.innerHTML = '<p class="aviso aviso-info" style="margin:1em">Domingo: cerrado.</p>'; return; }
  cont.innerHTML = '<div class="cargando" style="padding:1em">Cargando agenda…</div>';
  let filas;
  try { filas = await llamar('agenda', { p_desde: st.fecha, p_hasta: st.fecha }); } catch (err) { cont.innerHTML = ''; errorEn(null, err); return; }
  filasAgenda = filas;

  const cons = st.consultorios.filter((c) => c.activo);
  const mapa = new Map(filas.map((f) => [`${f.consultorio_id}|${f.hora}`, f]));
  const idDe = (f) => f && (f.reserva_id ? 'r' + f.reserva_id : f.bloqueo_id ? 'b' + f.bloqueo_id : (f.tipo === 'liberado' ? 'l' : 'f') + f.fijo_id);
  const horas = horasDelDia();
  const salto = new Set(); // celdas tapadas por rowspan

  let html = `<table class="grilla"><thead><tr><th class="h">Hora</th>${cons.map((c) => `<th scope="col">${esc(c.nombre)}</th>`).join('')}</tr></thead><tbody>`;
  for (const h of horas) {
    html += `<tr><th class="h" scope="row">${horaTxt(h)}</th>`;
    for (const c of cons) {
      const k = `${c.id}|${h}`;
      if (salto.has(k)) continue;
      const f = mapa.get(k);
      if (!f) { html += `<td><button class="celda vacia" data-vacia="${c.id}|${h}" aria-label="${esc(c.nombre)} ${horaTxt(h)} libre"></button></td>`; continue; }
      let span = 1;
      while (h + span < horas[horas.length - 1] + 1 && idDe(mapa.get(`${c.id}|${h + span}`)) === idDe(f)) { salto.add(`${c.id}|${h + span}`); span++; }
      html += `<td rowspan="${span}">${celdaHTML(f, span)}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  cont.innerHTML = html;

  $$('.celda.vacia', cont).forEach((b) => (b.onclick = () => {
    const [c, h] = b.dataset.vacia.split('|').map(Number);
    modalNuevaReserva({ consultorio: c, fecha: st.fecha, horas: [h] });
  }));
  $$('.celda[data-k]', cont).forEach((b) => (b.onclick = () => abrirDetalle(mapa.get(b.dataset.k))));
}

function celdaHTML(f, span) {
  let clase = 't-bloqueo', estado = '';
  if (f.tipo === 'suelta') {
    if (f.estado === 'confirmada') {
      clase = 't-confirmada';
      estado = f.pagado ? 'Pagada' : `Señada · saldo ${pesos(f.monto_total - f.monto_pagado)}`;
    } else {
      clase = 't-pendiente';
      estado = f.expira_en ? `Sin seña · vence en ${faltan(f.expira_en)}` : 'Sin seña';
    }
  } else if (f.tipo === 'fijo') { clase = 't-fijo'; estado = 'Fijo · ' + (f.pagado ? 'mes pagado ✓' : 'mes sin pagar'); }
  else if (f.tipo === 'solicitud') { clase = 't-solicitud'; estado = 'Solicitud de fijo'; }
  else if (f.tipo === 'liberado') { clase = 't-liberado'; estado = 'Libre · fijo liberado'; }
  else { estado = 'Bloqueado'; }
  const nombre = f.tipo === 'liberado' ? f.nombre : f.nombre;
  return `<button class="celda ${clase}" data-k="${f.consultorio_id}|${f.hora}" style="min-height:${52 * span}px">
    <span class="n">${esc(nombre)}</span><span class="e">${esc(estado)}</span></button>`;
}


// ================================================================ SEMANA (como la hoja del Excel)
$('#se-ant').onclick = () => { st.semana = sumarDias(st.semana, -7); pintarSemana(); };
$('#se-sig').onclick = () => { st.semana = sumarDias(st.semana, 7); pintarSemana(); };
$('#se-hoy').onclick = () => { st.semana = lunesDe(hoyAR()); pintarSemana(); };
$('#se-imprimir').onclick = () => window.print();
$('#se-excel').onclick = () => bajarSemanaExcel();

let datosSemana = { filas: [], mapa: new Map(), notas: [] };
const diasDeSemana = () => [0, 1, 2, 3, 4, 5].map((i) => sumarDias(st.semana, i));
const consCorto = (c) => (c.id === 6 || /sal[oó]n/i.test(c.nombre) ? 'Salón' : 'C' + (c.nombre.match(/\d+/)?.[0] || c.id));

// Cómo se ve cada casillero ocupado (colores como en el Excel)
function claseSemana(f) {
  if (f.tipo === 'fijo') return ['s-fijo', f.pagado ? 'fijo ✓' : 'fijo'];
  if (f.tipo === 'solicitud') return ['s-sol', 'pidió fijo'];
  if (f.tipo === 'liberado') return ['s-lib', 'no viene · libre'];
  if (f.tipo === 'bloqueo') return ['s-bloq', 'bloqueado'];
  if (f.estado === 'confirmada') return ['s-suelta', f.pagado ? 'pagó todo' : 'señada'];
  return ['s-sinsena', 'sin seña'];
}

async function pintarSemana() {
  const dias = diasDeSemana();
  const hoy = hoyAR();
  const [, m1, d1] = dias[0].split('-').map(Number);
  const [, m6, d6] = dias[5].split('-').map(Number);
  $('#se-titulo').textContent = `Semana del ${d1}/${m1} al ${d6}/${m6}` + (dias.includes(hoy) ? ' (esta semana)' : '');
  const cont = $('#semana');
  cont.innerHTML = '<div class="cargando" style="padding:1em">Cargando semana…</div>';
  let filas, notas;
  try {
    [filas, notas] = await Promise.all([
      llamar('agenda', { p_desde: dias[0], p_hasta: dias[5] }),
      sb.from('notas_semana').select('*').eq('semana', st.semana).order('creado_en').then((r) => r.data || []),
    ]);
  } catch (err) { cont.innerHTML = ''; errorEn(null, err); return; }
  // Si hay una ocupación real y un "fijo liberado" en la misma hora, manda la ocupación
  const mapa = new Map();
  for (const f of filas) {
    const k = `${f.fecha}|${f.consultorio_id}|${f.hora}`;
    if (!mapa.has(k) || mapa.get(k).tipo === 'liberado') mapa.set(k, f);
  }
  datosSemana = { filas, mapa, notas };

  const cons = st.consultorios.filter((c) => c.activo);
  const horas = horasDelDia();
  const idDe = (f) => f && (f.reserva_id ? 'r' + f.reserva_id : f.bloqueo_id ? 'b' + f.bloqueo_id : (f.tipo === 'liberado' ? 'l' : 'f') + f.fijo_id);
  const salto = new Set();
  let html = `<table class="semana" style="--nc:${dias.length * cons.length}"><colgroup><col class="hcol">${dias.map(() => cons.map(() => '<col class="c">').join('')).join('')}</colgroup><thead><tr><th class="h" rowspan="2">Hora</th>`;
  html += dias.map((d) => `<th colspan="${cons.length}" class="fin-dia ${d === hoy ? 'hoy' : ''}" scope="colgroup">${DIAS[diaSemana(d)]} ${fechaCorta(d)}${d === hoy ? ' · HOY' : ''}</th>`).join('');
  html += '</tr><tr>' + dias.map((d) => cons.map((c, i) => `<th scope="col" title="${esc(c.nombre)}" class="${i === cons.length - 1 ? 'fin-dia' : ''} ${d === hoy ? 'hoy' : ''}">${esc(consCorto(c))}</th>`).join('')).join('') + '</tr></thead><tbody>';
  for (const h of horas) {
    html += `<tr><th class="h" scope="row">${h} hs</th>`;
    for (const d of dias) {
      cons.forEach((c, i) => {
        const k = `${d}|${c.id}|${h}`;
        if (salto.has(k)) return;
        const td = `${i === cons.length - 1 ? 'fin-dia' : ''} ${d === hoy ? 'hoy-col' : ''}`;
        const f = mapa.get(k);
        const etiqueta = `${DIAS[diaSemana(d)]} ${fechaCorta(d)}, ${c.nombre}, ${h} hs`;
        if (!f) { html += `<td class="${td}"><button class="sc vacia" data-anotar="${k}" aria-label="${esc(etiqueta)}: libre, anotar"></button></td>`; return; }
        let span = 1;
        while (h + span <= horas[horas.length - 1] && idDe(mapa.get(`${d}|${c.id}|${h + span}`)) === idDe(f)) { salto.add(`${d}|${c.id}|${h + span}`); span++; }
        const [clase, estado] = claseSemana(f);
        html += `<td class="${td}" rowspan="${span}"><button class="sc ${clase}" data-ver="${k}" style="min-height:${40 * span}px"
          title="${esc(f.nombre || '')} · ${esc(estado)}" aria-label="${esc(etiqueta)}: ${esc(f.nombre || '')}, ${esc(estado)}">
          <span class="n">${esc(f.nombre || '')}</span><span class="e">${esc(estado)}</span></button></td>`;
      });
    }
    html += '</tr>';
  }
  cont.innerHTML = html + '</tbody></table>';

  $$('[data-anotar]', cont).forEach((b) => (b.onclick = () => {
    const [d, c, h] = b.dataset.anotar.split('|');
    modalAnotar({ fecha: d, consultorio: Number(c), hora: Number(h) });
  }));
  $$('[data-ver]', cont).forEach((b) => (b.onclick = () => {
    const f = mapa.get(b.dataset.ver);
    if (f.tipo === 'liberado') return modalAnotar({ fecha: f.fecha, consultorio: f.consultorio_id, hora: f.hora, liberado: f });
    abrirDetalle(f);
  }));
  // Llevar la vista al día de hoy
  const iHoy = dias.indexOf(hoy);
  if (iHoy > 0) $('#se-wrap').scrollLeft = Math.max(0, cont.querySelector('thead th.hoy')?.offsetLeft - 60 || 0);
  pintarNotas();
}

// ---------- Notas de la semana ----------
function pintarNotas() {
  const ul = $('#se-notas');
  const notas = datosSemana.notas;
  ul.innerHTML = notas.length ? notas.map((n) => `<li><p>${esc(n.texto)}<small>${esc(n.autor_nombre || 'Equipo')} · ${fechaCorta(n.creado_en.slice(0, 10))} ${new Date(n.creado_en).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' })}</small></p>
    <button class="btn btn-borde btn-chico" data-borrar-nota="${n.id}" aria-label="Borrar nota">Borrar</button></li>`).join('')
    : '<li class="suave">Todavía no hay notas para esta semana.</li>';
  $$('[data-borrar-nota]', ul).forEach((b) => (b.onclick = async () => {
    if (await preguntar({ titulo: '¿Borrar esta nota?', aceptar: 'Borrar', peligro: true }) === null) return;
    try { await llamar('borrar_nota', { p_id: Number(b.dataset.borrarNota) }, 'Nota borrada'); pintarSemana(); } catch (err) { errorEn(null, err); }
  }));
}
$('#form-nota').onsubmit = async (e) => {
  e.preventDefault();
  const texto = $('#nota-texto').value.trim();
  if (!texto) return $('#nota-texto').focus();
  try {
    await llamar('agregar_nota', { p_semana: st.semana, p_texto: texto }, 'Nota guardada');
    $('#nota-texto').value = '';
    pintarSemana();
  } catch (err) { errorEn(null, err); }
};

// ---------- Anotar (lo que piden por WhatsApp) ----------
const normal = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function modalAnotar({ fecha, consultorio, hora, liberado }) {
  const c = st.consultorios.find((x) => x.id === consultorio);
  const cierre = Number(st.cfg.hora_cierre || 21);
  const libreEn = (h) => h < cierre && (!datosSemana.mapa.get(`${fecha}|${consultorio}|${h}`) || datosSemana.mapa.get(`${fecha}|${consultorio}|${h}`).tipo === 'liberado');
  const maxHoras = (() => { let n = 0; while (n < 6 && libreEn(hora + n)) n++; return n; })();
  const nombres = [...new Set(st.profesionales.map((p) => p.nombre))];
  abrirModal(`
    <h2 id="modal-titulo">Anotar</h2>
    <p class="contexto">${DIAS[diaSemana(fecha)]} ${fechaCorta(fecha)} · ${esc(c?.nombre || '')} · desde las ${hora} hs</p>
    ${liberado ? `<p class="aviso aviso-info chico">Este horario es del fijo de <strong>${esc(liberado.nombre)}</strong>, que esta semana no viene${liberado.detalle ? ` (${esc(liberado.detalle)})` : ''}. Podés anotar a otra persona.</p>` : ''}
    <form id="form-anotar" autocomplete="off">
      <div class="campo">
        <label for="a-nombre">¿Quién?</label>
        <input id="a-nombre" list="dl-nombres" placeholder="Escribí el nombre" required>
        <datalist id="dl-nombres">${nombres.map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
        <div class="ayuda" id="a-quien">Si ya vino antes, aparece solo mientras escribís.</div>
      </div>
      <div class="campo oculto" id="a-wa-campo">
        <label for="a-wa">Su WhatsApp</label>
        <input id="a-wa" inputmode="tel" placeholder="Ej: 11 4195 2323">
        <div class="ayuda" id="a-wa-ayuda">Es alguien nuevo: con el WhatsApp queda guardado para la próxima.</div>
      </div>
      <div class="campo">
        <label>¿Cuántas horas?</label>
        <div class="grupo-grande" id="a-horas">${[1, 2, 3, 4].map((n) => `<button type="button" class="chip" data-n="${n}" aria-pressed="${n === 1}" ${n > maxHoras ? 'disabled title="Esas horas ya están ocupadas o es la hora de cierre"' : ''}>${n}</button>`).join('')}</div>
        <div class="ayuda" id="a-rango"></div>
      </div>
      <div class="campo">
        <label>¿Pagó?</label>
        <div class="grupo-grande" id="a-pago">
          <button type="button" class="chip" data-pago="nada" aria-pressed="true">Todavía no</button>
          <button type="button" class="chip" data-pago="sena" aria-pressed="false">La seña<small id="a-sena"></small></button>
          <button type="button" class="chip" data-pago="todo" aria-pressed="false">Todo<small id="a-todo"></small></button>
        </div>
      </div>
      <div class="campo oculto" id="a-medio-campo"><label for="a-medio">¿Cómo pagó?</label><select id="a-medio">${medioOpts('transferencia')}</select></div>
      <div id="a-error" class="aviso aviso-error oculto" role="alert"></div>
      <button class="btn btn-acento btn-bloque" id="a-guardar" style="min-height:56px;font-size:1.1rem">Anotar</button>
    </form>`);

  let horasN = 1, pago = 'nada', persona = null;
  const total = () => { let t = 0; for (let i = 0; i < horasN; i++) t += precioSuelta(fecha, hora + i); return t; };
  const actualizar = () => {
    $('#a-rango').textContent = `De ${hora} a ${hora + horasN} hs · Total ${pesos(total())}`;
    $('#a-sena').textContent = pesos(sena(total()));
    $('#a-todo').textContent = pesos(total());
    $('#a-medio-campo').classList.toggle('oculto', pago === 'nada');
  };
  const buscarPersona = () => {
    const q = normal($('#a-nombre').value);
    const coinciden = q.length >= 2 ? st.profesionales.filter((p) => normal(p.nombre) === q) : [];
    persona = coinciden.length === 1 ? coinciden[0] : null;
    const nuevo = q.length >= 2 && !persona;
    $('#a-wa-campo').classList.toggle('oculto', !nuevo);
    $('#a-wa').required = nuevo;
    $('#a-wa-ayuda').textContent = coinciden.length > 1 ? `Hay ${coinciden.length} personas con ese nombre: anotá su WhatsApp para saber cuál es.`
      : 'Es alguien nuevo: con el WhatsApp queda guardado para la próxima.';
    $('#a-quien').innerHTML = persona ? `<span class="quien-ok">✓ ${esc(persona.nombre)}</span> · WhatsApp ${esc(persona.whatsapp)}`
      : nuevo ? 'No está en la lista: es alguien nuevo.' : 'Si ya vino antes, aparece solo mientras escribís.';
  };
  $('#a-nombre').addEventListener('input', buscarPersona);
  $$('#a-horas .chip').forEach((b) => (b.onclick = () => {
    horasN = Number(b.dataset.n);
    $$('#a-horas .chip').forEach((x) => x.setAttribute('aria-pressed', x === b));
    actualizar();
  }));
  $$('#a-pago .chip').forEach((b) => (b.onclick = () => {
    pago = b.dataset.pago;
    $$('#a-pago .chip').forEach((x) => x.setAttribute('aria-pressed', x === b));
    actualizar();
  }));
  actualizar();
  if (maxHoras === 0) errorEn($('#a-error'), 'Ese horario ya está ocupado.');

  $('#form-anotar').onsubmit = async (e) => {
    e.preventDefault();
    buscarPersona();
    const nombre = persona?.nombre || $('#a-nombre').value.trim();
    const whatsapp = persona?.whatsapp || $('#a-wa').value;
    if (nombre.length < 2) return errorEn($('#a-error'), 'Escribí el nombre.');
    if (!persona && whatsapp.replace(/\D/g, '').length < 8) { $('#a-wa').focus(); return errorEn($('#a-error'), 'Anotá su WhatsApp (al menos 8 números).'); }
    const t = total();
    const monto = pago === 'todo' ? t : pago === 'sena' ? sena(t) : 0;
    const horas = Array.from({ length: horasN }, (_, i) => hora + i);
    const btn = $('#a-guardar');
    btn.disabled = true; btn.textContent = 'Anotando…';
    try {
      const id = await llamar('cargar_reserva', {
        p_nombre: nombre, p_whatsapp: whatsapp, p_consultorio: consultorio, p_fecha: fecha,
        p_horas: horas, p_monto_pagado: monto, p_medio: $('#a-medio').value,
      });
      cerrarModal();
      await cargarBase();
      refrescar();
      toast(`Anotado: ${nombre.split(' ')[0]}, ${DIAS_CORTOS[diaSemana(fecha)]} ${fechaCorta(fecha)} de ${hora} a ${hora + horasN} hs`, {
        etiqueta: 'Deshacer',
        fn: async () => {
          try { await llamar('deshacer_carga', { p_reserva_id: id }, 'Listo, se deshizo'); refrescar(); } catch (err) { errorEn(null, err); }
        },
      });
    } catch (err) {
      errorEn($('#a-error'), err);
      btn.disabled = false; btn.textContent = 'Anotar';
    }
  };
}

// ---------- Bajar la semana para abrir en Excel ----------
function bajarSemanaExcel() {
  const dias = diasDeSemana();
  const cons = st.consultorios.filter((c) => c.activo);
  const celda = (t) => `"${String(t ?? '').replace(/"/g, '""')}"`;
  const lineas = [];
  lineas.push(['Hora', ...dias.flatMap((d) => cons.map((c) => `${DIAS[diaSemana(d)]} ${fechaCorta(d)} - ${c.nombre}`))].map(celda).join(';'));
  for (const h of horasDelDia()) {
    lineas.push([`${h} hs`, ...dias.flatMap((d) => cons.map((c) => {
      const f = datosSemana.mapa.get(`${d}|${c.id}|${h}`);
      return f ? `${f.nombre || ''} (${claseSemana(f)[1]})` : '';
    }))].map(celda).join(';'));
  }
  lineas.push('');
  lineas.push(celda('Notas de la semana'));
  datosSemana.notas.forEach((n) => lineas.push(celda(`${n.texto} — ${n.autor_nombre || 'Equipo'}`)));
  const blob = new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `semana-${st.semana}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ================================================================ DETALLE
async function abrirDetalle(f) {
  if (f.reserva_id) return detalleReserva(f.reserva_id);
  if (f.bloqueo_id) return detalleBloqueo(f);
  if (f.fijo_id) return detalleFijo(f.fijo_id, f.fecha, f.tipo === 'liberado');
}

async function detalleReserva(id) {
  const [{ data: rs, error }, { data: pagos }] = await Promise.all([
    sb.from('reservas').select('*, profesionales(nombre, whatsapp, profesion, email), consultorios(nombre)').eq('id', id),
    sb.from('pagos').select('*').eq('reserva_id', id).order('creado_en'),
  ]);
  if (error || !rs?.length) return errorEn(null, error || 'No se encontró la reserva');
  const r = rs[0];
  let pedidoN = 0;
  if (r.pedido_id) pedidoN = (await sb.from('reservas').select('id').eq('pedido_id', r.pedido_id)).data?.length || 0;
  const pagado = (pagos || []).filter((p) => !p.anulado).reduce((s, p) => s + p.monto, 0);
  const falta = r.precio_total - pagado;
  const faltaSena = Math.max(0, sena(r.precio_total) - pagado);
  const vigente = ['pendiente', 'confirmada'].includes(r.estado);
  const pill = { pendiente: 'pill-alerta">Sin seña', confirmada: 'pill-ok">Confirmada', cancelada: 'pill-error">Cancelada', vencida: 'pill-error">Vencida' }[r.estado];
  const textoRecordatorio = `Hola ${r.profesionales.nombre.split(' ')[0]}! Te escribimos de Psico Studios por tu reserva #${r.id} del ${fechaLarga(r.fecha)} (${rangos(r.horas)}). ` +
    (r.estado === 'pendiente' ? `Para confirmarla falta la seña de ${pesos(faltaSena)}. Alias: ${st.cfg.alias_transferencia}.` : `¡Te esperamos!`);

  abrirModal(`
    <h2 id="modal-titulo">Reserva #${r.id} <span class="pill ${pill}</span></h2>
    <ul class="datos">
      <li><span>Profesional</span><span>${esc(r.profesionales.nombre)}</span></li>
      <li><span>Profesión</span><span>${esc(r.profesionales.profesion || '—')}</span></li>
      <li><span>WhatsApp</span><span><a href="${waLink(r.profesionales.whatsapp, textoRecordatorio)}" target="_blank" rel="noopener">${esc(r.profesionales.whatsapp)}</a></span></li>
      <li><span>Mail</span><span>${r.profesionales.email ? `<a href="mailto:${esc(r.profesionales.email)}">${esc(r.profesionales.email)}</a>` : '—'}</span></li>
      <li><span>Día</span><span>${esc(fechaLarga(r.fecha))}</span></li>
      <li><span>Horario</span><span>${esc(rangos(r.horas))}</span></li>
      <li><span>Consultorio</span><span>${esc(r.consultorios.nombre)}</span></li>
      <li><span>Total</span><span>${pesos(r.precio_total)}</span></li>
      <li><span>Pagado</span><span>${pesos(pagado)}</span></li>
      <li><span>Saldo</span><span>${pesos(falta)}</span></li>
      ${r.estado === 'pendiente' && r.expira_en ? `<li><span>Vence en</span><span>${faltan(r.expira_en)}</span></li>` : ''}
      ${r.motivo_cancelacion ? `<li><span>Motivo</span><span>${esc(r.motivo_cancelacion)}</span></li>` : ''}
      <li><span>Origen</span><span>${r.origen === 'web' ? 'Web' : 'Cargada en el panel' + (st.equipo.find((e) => e.user_id === r.creado_por) ? ' por ' + esc(st.equipo.find((e) => e.user_id === r.creado_por).nombre) : '')}</span></li>
      ${r.pedido_id ? `<li><span>Pedido</span><span>#${r.pedido_id}${pedidoN > 1 ? ` · ${pedidoN} días en el mismo pedido` : ''}</span></li>` : ''}
    </ul>
    ${(pagos || []).length ? `<h3>Pagos</h3><ul class="datos">${pagos.map((p) => `<li><span>${fechaCorta(p.pagado_en)} · ${esc(nombreMedio(p.medio))}${p.anulado ? ' · <s>anulado</s>' : ''}</span>
      <span>${pesos(p.monto)} ${!p.anulado ? `<button class="btn btn-peligro btn-chico" data-anular="${p.id}" style="margin-left:6px">Anular</button>` : ''}</span></li>`).join('')}</ul>` : ''}
    ${vigente && falta > 0 ? `
    <form class="bloque" id="form-pago">
      <h3>Registrar pago</h3>
      <div class="fila2">
        <div class="campo"><label for="pg-monto">Monto</label><input id="pg-monto" type="number" min="1" max="${falta}" value="${faltaSena || falta}" required></div>
        <div class="campo"><label for="pg-medio">Medio</label><select id="pg-medio">${medioOpts('transferencia')}</select></div>
      </div>
      <div class="grupo-btn" style="margin-bottom:.6em">
        ${faltaSena ? `<button type="button" class="btn btn-borde btn-chico" data-monto="${faltaSena}">Seña ${pesos(faltaSena)}</button>` : ''}
        <button type="button" class="btn btn-borde btn-chico" data-monto="${falta}">Total ${pesos(falta)}</button>
      </div>
      <button class="btn btn-acento btn-bloque">Registrar pago</button>
    </form>` : ''}
    <div id="det-error" class="aviso aviso-error oculto" role="alert"></div>
    ${vigente ? `<div class="bloque grupo-btn">
      ${r.estado === 'pendiente' ? '<button class="btn btn-borde btn-chico" id="btn-extender">+1 hora para pagar</button>' : ''}
      <a class="btn btn-wa btn-chico" href="${waLink(r.profesionales.whatsapp, textoRecordatorio)}" target="_blank" rel="noopener">WhatsApp</a>
      <button class="btn btn-peligro btn-chico" id="btn-cancelar">Cancelar reserva</button>
    </div>` : ''}`);

  const errEl = $('#det-error');
  $$('[data-monto]').forEach((b) => (b.onclick = () => { $('#pg-monto').value = b.dataset.monto; }));
  $('#form-pago')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await llamar('registrar_pago', { p_monto: Number($('#pg-monto').value), p_medio: $('#pg-medio').value, p_reserva_id: r.id }, 'Pago registrado');
      cerrarModal(); refrescar();
    } catch (err) { errorEn(errEl, err); }
  });
  $$('[data-anular]').forEach((b) => (b.onclick = async () => {
    if (await preguntar({ titulo: '¿Anular este pago?', texto: 'Deja de contar para la reserva. Si era la seña, la reserva vuelve a quedar sin seña.', aceptar: 'Anular pago', peligro: true }) === null) return;
    try { await llamar('anular_pago', { p_pago_id: Number(b.dataset.anular) }, 'Pago anulado'); detalleReserva(id); refrescar(); } catch (err) { errorEn(errEl, err); }
  }));
  $('#btn-extender')?.addEventListener('click', async () => {
    try { await llamar('extender_reserva', { p_reserva_id: r.id, p_minutos: 60 }, 'Se dio 1 hora más'); detalleReserva(id); refrescar(); } catch (err) { errorEn(errEl, err); }
  });
  $('#btn-cancelar')?.addEventListener('click', async () => {
    const motivo = await preguntar({ titulo: '¿Cancelar la reserva?', texto: 'El horario se libera y cualquiera lo puede reservar.', campo: { etiqueta: 'Motivo (opcional)', placeholder: 'Ej: avisó que no viene' }, aceptar: 'Cancelar reserva', peligro: true });
    if (motivo === null) return;
    try { await llamar('cancelar_reserva', { p_reserva_id: r.id, p_motivo: motivo || null }, 'Reserva cancelada'); cerrarModal(); refrescar(); } catch (err) { errorEn(errEl, err); }
  });
}

function detalleBloqueo(f) {
  abrirModal(`
    <h2 id="modal-titulo">Horario bloqueado</h2>
    <ul class="datos"><li><span>Motivo</span><span>${esc(f.nombre)}</span></li><li><span>Día</span><span>${esc(fechaLarga(f.fecha))}</span></li></ul>
    <div id="det-error" class="aviso aviso-error oculto"></div>
    <button class="btn btn-peligro" id="btn-borrar-bloqueo">Quitar bloqueo</button>
    <p class="ayuda">Se quita el bloqueo completo (todas las horas y consultorios que incluía).</p>`);
  $('#btn-borrar-bloqueo').onclick = async () => {
    try { await llamar('borrar_bloqueo', { p_bloqueo_id: f.bloqueo_id }, 'Bloqueo quitado'); cerrarModal(); refrescar(); } catch (err) { errorEn($('#det-error'), err); }
  };
}

// Fechas en que cae un fijo dentro de un mes 'AAAA-MM'
function vecesEnMes(fijo, periodo) {
  let d = periodo + '-01', n = 0;
  while (d.startsWith(periodo)) {
    if (diaSemana(d) === fijo.dia_semana && d >= fijo.desde && (!fijo.hasta || d <= fijo.hasta)) n++;
    d = sumarDias(d, 1);
  }
  return n;
}

async function detalleFijo(id, fecha, liberado) {
  const [{ data: fs, error }, { data: pagos }] = await Promise.all([
    sb.from('fijos').select('*, profesionales(nombre, whatsapp), consultorios(nombre)').eq('id', id),
    sb.from('pagos').select('*').eq('fijo_id', id).order('periodo', { ascending: false }),
  ]);
  if (error || !fs?.length) return errorEn(null, error || 'No se encontró el fijo');
  const f = fs[0];
  const periodo = (fecha || hoyAR()).slice(0, 7);
  const veces = vecesEnMes(f, periodo);
  const pagosMes = (pagos || []).filter((p) => p.periodo === periodo && !p.anulado);
  const pagadoMes = pagosMes.reduce((s, p) => s + p.monto, 0);
  const sugerido = Math.max(0, f.precio_semanal * veces - pagadoMes);
  const esSolicitud = f.estado === 'solicitud';

  abrirModal(`
    <h2 id="modal-titulo">${esSolicitud ? 'Solicitud de fijo' : 'Horario fijo'} #${f.id}</h2>
    <ul class="datos">
      <li><span>Profesional</span><span>${esc(f.profesionales.nombre)}</span></li>
      <li><span>WhatsApp</span><span><a href="${waLink(f.profesionales.whatsapp, `Hola ${f.profesionales.nombre.split(' ')[0]}! Te escribimos de Psico Studios por tu horario fijo de los ${DIAS[f.dia_semana].toLowerCase()}.`)}" target="_blank" rel="noopener">${esc(f.profesionales.whatsapp)}</a></span></li>
      <li><span>Día y horario</span><span>${DIAS[f.dia_semana]} · ${esc(rangos(f.horas))}</span></li>
      <li><span>Consultorio</span><span>${esc(f.consultorios.nombre)}</span></li>
      <li><span>Desde</span><span>${esc(fechaLarga(f.desde))}</span></li>
      <li><span>Precio semanal</span><span>${pesos(f.precio_semanal)}</span></li>
      ${esSolicitud && f.expira_en ? `<li><span>Se libera en</span><span>${faltan(f.expira_en)}</span></li>` : ''}
      ${!esSolicitud ? `<li><span>Pagado ${periodo}</span><span>${pesos(pagadoMes)} de ${pesos(f.precio_semanal * veces)} (${veces} semanas)</span></li>` : ''}
    </ul>
    <div id="det-error" class="aviso aviso-error oculto" role="alert"></div>
    ${esSolicitud ? `<div class="grupo-btn"><button class="btn btn-acento" id="btn-aprobar">Aprobar</button><button class="btn btn-peligro" id="btn-rechazar">Rechazar</button></div>` : ''}
    ${f.estado === 'activo' ? `
      <form class="bloque" id="form-pago-fijo">
        <h3>Registrar pago del mes</h3>
        <div class="fila2">
          <div class="campo"><label for="pf-periodo">Mes</label><input id="pf-periodo" type="month" value="${periodo}" required></div>
          <div class="campo"><label for="pf-monto">Monto</label><input id="pf-monto" type="number" min="1" value="${sugerido || f.precio_semanal * veces}" required></div>
        </div>
        <div class="campo"><label for="pf-medio">Medio</label><select id="pf-medio">${medioOpts('transferencia')}</select></div>
        <button class="btn btn-acento btn-bloque">Registrar pago</button>
      </form>
      <div class="bloque grupo-btn">
        ${fecha && !liberado ? `<button class="btn btn-borde btn-chico" id="btn-liberar">Liberar el ${fechaCorta(fecha)} (no viene)</button>` : ''}
        ${fecha && liberado ? `<button class="btn btn-borde btn-chico" id="btn-rebloquear">Volver a reservar el ${fechaCorta(fecha)}</button>` : ''}
        <button class="btn btn-peligro btn-chico" id="btn-baja">Dar de baja</button>
      </div>` : ''}`);

  const errEl = $('#det-error');
  const act = async (fn, params, msg) => {
    try { await llamar(fn, params, msg); cerrarModal(); refrescar(); } catch (err) { errorEn(errEl, err); }
  };
  $('#btn-aprobar')?.addEventListener('click', () => act('aprobar_fijo', { p_fijo_id: f.id }, 'Fijo aprobado'));
  $('#btn-rechazar')?.addEventListener('click', async () => {
    if (await preguntar({ titulo: '¿Rechazar la solicitud?', texto: 'Se liberan los horarios de todas las semanas.', aceptar: 'Rechazar', peligro: true }) !== null) act('rechazar_fijo', { p_fijo_id: f.id }, 'Solicitud rechazada');
  });
  $('#btn-liberar')?.addEventListener('click', async () => {
    const motivo = await preguntar({ titulo: `¿Liberar el ${fechaCorta(fecha)}?`, texto: 'Esa semana el horario queda libre para otra persona. Las demás semanas siguen siendo suyas.', campo: { etiqueta: 'Motivo (opcional)', placeholder: 'Ej: vacaciones' }, aceptar: 'Liberar' });
    if (motivo !== null) act('liberar_fijo_fecha', { p_fijo_id: f.id, p_fecha: fecha, p_motivo: motivo || null }, 'Semana liberada');
  });
  $('#btn-rebloquear')?.addEventListener('click', () => act('volver_a_bloquear_fijo', { p_fijo_id: f.id, p_fecha: fecha }, 'Horario recuperado'));
  $('#btn-baja')?.addEventListener('click', async () => {
    const desde = await preguntar({ titulo: '¿Dar de baja el horario fijo?', texto: 'Desde esa fecha los horarios quedan libres.', campo: { etiqueta: 'Deja de venir desde', tipo: 'date', valor: fecha || hoyAR() }, aceptar: 'Dar de baja', peligro: true });
    if (!desde) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(desde)) return errorEn(errEl, 'La fecha tiene que tener el formato AAAA-MM-DD');
    act('dar_baja_fijo', { p_fijo_id: f.id, p_desde: desde }, 'Fijo dado de baja');
  });
  $('#form-pago-fijo')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act('registrar_pago', { p_monto: Number($('#pf-monto').value), p_medio: $('#pf-medio').value, p_fijo_id: f.id, p_periodo: $('#pf-periodo').value }, 'Pago registrado');
  });
}

// ================================================================ ALTAS
function datalistProfesionales() {
  return `<datalist id="dl-prof">${st.profesionales.map((p) => `<option value="${esc(p.whatsapp)}">${esc(p.nombre)}</option>`).join('')}</datalist>`;
}
function camposPersona() {
  return `${datalistProfesionales()}
    <div class="fila2">
      <div class="campo"><label for="n-wa">WhatsApp</label><input id="n-wa" list="dl-prof" inputmode="tel" required placeholder="1141952323">
        <div class="ayuda">Si ya existe, se completa el nombre.</div></div>
      <div class="campo"><label for="n-nombre">Nombre</label><input id="n-nombre" required></div>
    </div>`;
}
function conectarPersona() {
  $('#n-wa').addEventListener('change', () => {
    const p = st.profesionales.find((x) => x.whatsapp === $('#n-wa').value.replace(/\D/g, ''));
    if (p) $('#n-nombre').value = p.nombre;
  });
}
function selectorHoras(elegidas = []) {
  return `<div class="horas-sel" id="n-horas">${horasDelDia().map((h) =>
    `<button type="button" class="chip" data-h="${h}" aria-pressed="${elegidas.includes(h)}">${horaTxt(h)}</button>`).join('')}</div>`;
}
function conectarHoras(alCambiar) {
  $$('#n-horas .chip').forEach((b) => (b.onclick = () => {
    b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') !== 'true');
    alCambiar?.();
  }));
}
const horasElegidas = () => $$('#n-horas .chip[aria-pressed="true"]').map((b) => Number(b.dataset.h));

function modalNuevaReserva({ consultorio, fecha, horas = [] }) {
  abrirModal(`
    <h2 id="modal-titulo">Nueva reserva</h2>
    <form id="form-nr">
      ${camposPersona()}
      <div class="fila2">
        <div class="campo"><label for="n-fecha">Día</label><input id="n-fecha" type="date" value="${fecha || st.fecha}" required></div>
        <div class="campo"><label for="n-cons">Consultorio</label><select id="n-cons">${consOpts(consultorio)}</select></div>
      </div>
      <div class="campo"><label>Horas</label>${selectorHoras(horas)}</div>
      <p class="aviso aviso-info chico" id="n-total">Elegí las horas.</p>
      <div class="fila2">
        <div class="campo"><label for="n-pagado">Pagó ahora ($)</label><input id="n-pagado" type="number" min="0" value="0"></div>
        <div class="campo"><label for="n-medio">Medio</label><select id="n-medio">${medioOpts('transferencia')}</select></div>
      </div>
      <p class="ayuda">Con la seña (${st.cfg.porcentaje_sena || 50}%) o más queda confirmada. Sin pago queda pendiente y no vence sola.</p>
      <div id="n-error" class="aviso aviso-error oculto" role="alert"></div>
      <button class="btn btn-acento btn-bloque">Guardar reserva</button>
    </form>`);
  conectarPersona();
  const precios = { m: null, t: null };
  const recalcular = async () => {
    const hs = horasElegidas();
    if (!hs.length) { $('#n-total').textContent = 'Elegí las horas.'; return; }
    if (precios.m === null) {
      const { data } = await sb.from('precios').select('*').eq('modalidad', 'suelta').order('vigente_desde', { ascending: false });
      const f = $('#n-fecha').value;
      precios.m = data.find((p) => p.franja === 'manana' && p.vigente_desde <= f)?.valor || 0;
      precios.t = data.find((p) => p.franja === 'tarde' && p.vigente_desde <= f)?.valor || 0;
    }
    const total = hs.reduce((s, h) => s + (h < Number(st.cfg.hora_fin_manana) ? precios.m : precios.t), 0);
    $('#n-total').innerHTML = `${rangos(hs)} · Total <strong>${pesos(total)}</strong> · Seña <strong>${pesos(sena(total))}</strong>`;
  };
  conectarHoras(recalcular);
  $('#n-fecha').onchange = () => { precios.m = null; recalcular(); };
  recalcular();
  $('#form-nr').onsubmit = async (e) => {
    e.preventDefault();
    const hs = horasElegidas();
    if (!hs.length) return errorEn($('#n-error'), 'Elegí al menos una hora.');
    try {
      await llamar('cargar_reserva', {
        p_nombre: $('#n-nombre').value.trim(), p_whatsapp: $('#n-wa').value, p_consultorio: Number($('#n-cons').value),
        p_fecha: $('#n-fecha').value, p_horas: hs, p_monto_pagado: Number($('#n-pagado').value) || 0, p_medio: $('#n-medio').value,
      }, 'Reserva guardada');
      st.fecha = $('#n-fecha').value;
      cerrarModal(); cargarBase(); refrescar();
    } catch (err) { errorEn($('#n-error'), err); }
  };
}

function modalNuevoFijo() {
  abrirModal(`
    <h2 id="modal-titulo">Nuevo horario fijo</h2>
    <p class="suave chico">Queda activo directamente y ocupa ese horario todas las semanas.</p>
    <form id="form-nf">
      ${camposPersona()}
      <div class="fila2">
        <div class="campo"><label for="n-cons">Consultorio</label><select id="n-cons">${consOpts()}</select></div>
        <div class="campo"><label for="n-desde">Primer día</label><input id="n-desde" type="date" value="${st.fecha}" required>
          <div class="ayuda" id="n-dia"></div></div>
      </div>
      <div class="campo"><label>Horas</label>${selectorHoras()}</div>
      <div id="n-error" class="aviso aviso-error oculto" role="alert"></div>
      <button class="btn btn-acento btn-bloque">Guardar fijo</button>
    </form>`);
  conectarPersona();
  conectarHoras();
  const dia = () => { $('#n-dia').textContent = 'Todos los ' + DIAS[diaSemana($('#n-desde').value)].toLowerCase(); };
  $('#n-desde').onchange = dia; dia();
  $('#form-nf').onsubmit = async (e) => {
    e.preventDefault();
    const hs = horasElegidas();
    const desde = $('#n-desde').value;
    if (!hs.length) return errorEn($('#n-error'), 'Elegí al menos una hora.');
    if (diaSemana(desde) === 7) return errorEn($('#n-error'), 'Los domingos está cerrado.');
    try {
      await llamar('cargar_fijo', {
        p_nombre: $('#n-nombre').value.trim(), p_whatsapp: $('#n-wa').value, p_consultorio: Number($('#n-cons').value),
        p_dia: diaSemana(desde), p_horas: hs, p_desde: desde,
      }, 'Fijo guardado');
      cerrarModal(); cargarBase(); refrescar();
    } catch (err) { errorEn($('#n-error'), err); }
  };
}

function modalBloqueo() {
  const hs = horasDelDia();
  const opts = (sel) => [...hs, hs[hs.length - 1] + 1].map((h) => `<option value="${h}" ${h === sel ? 'selected' : ''}>${horaTxt(h)}</option>`).join('');
  abrirModal(`
    <h2 id="modal-titulo">Bloquear horario</h2>
    <p class="suave chico">Para limpieza, mantenimiento o cierre. Esas horas no se podrán reservar.</p>
    <form id="form-bl">
      <div class="fila2">
        <div class="campo"><label for="b-fecha">Día</label><input id="b-fecha" type="date" value="${st.fecha}" required></div>
        <div class="campo"><label for="b-cons">Consultorio</label><select id="b-cons"><option value="">Todos</option>${consOpts()}</select></div>
        <div class="campo"><label for="b-desde">Desde</label><select id="b-desde">${opts(hs[0])}</select></div>
        <div class="campo"><label for="b-hasta">Hasta</label><select id="b-hasta">${opts(hs[hs.length - 1] + 1)}</select></div>
      </div>
      <div class="campo"><label for="b-motivo">Motivo</label><input id="b-motivo" required placeholder="Ej: Mantenimiento"></div>
      <div id="b-error" class="aviso aviso-error oculto" role="alert"></div>
      <button class="btn btn-primario btn-bloque">Bloquear</button>
    </form>`);
  $('#form-bl').onsubmit = async (e) => {
    e.preventDefault();
    const d = Number($('#b-desde').value), h = Number($('#b-hasta').value);
    if (h <= d) return errorEn($('#b-error'), '"Hasta" tiene que ser después de "Desde".');
    try {
      await llamar('crear_bloqueo', {
        p_fecha: $('#b-fecha').value, p_hora_desde: d, p_hora_hasta: h, p_motivo: $('#b-motivo').value.trim(),
        p_consultorio: $('#b-cons').value ? Number($('#b-cons').value) : null,
      }, 'Horario bloqueado');
      st.fecha = $('#b-fecha').value;
      cerrarModal(); refrescar();
    } catch (err) { errorEn($('#b-error'), err); }
  };
}

// ================================================================ PENDIENTES
async function pintarPagosRevisar() {
  const { data, error } = await sb.from('pagos_a_revisar').select('*').eq('resuelto', false).order('creado_en');
  const bloque = $('#bloque-revisar');
  if (error || !data?.length) { bloque.classList.add('oculto'); return; }
  bloque.classList.remove('oculto');
  $('#lista-revisar').innerHTML = data.map((x) => `
    <div class="item" style="border-color:var(--error)">
      <h3>${pesos(x.monto)} <span class="pill pill-error">a revisar</span></h3>
      <div>${esc(x.motivo)}</div>
      <div class="suave chico" style="margin-top:.4em">Pago de Mercado Pago N° ${esc(x.mp_payment_id)}${x.reserva_id ? ` · Reserva #${x.reserva_id}` : ''}</div>
      <div class="acciones">
        ${x.reserva_id ? `<button class="btn btn-borde btn-chico" data-ver-reserva="${x.reserva_id}">Ver reserva</button>` : ''}
        <button class="btn btn-primario btn-chico" data-resolver="${x.id}">Marcar como resuelto</button>
      </div>
    </div>`).join('');
  $$('[data-ver-reserva]').forEach((b) => (b.onclick = () => detalleReserva(Number(b.dataset.verReserva))));
  $$('[data-resolver]').forEach((b) => (b.onclick = async () => {
    const nota = await preguntar({ titulo: '¿Cómo se resolvió?', campo: { etiqueta: 'Nota', placeholder: 'Ej: devuelto desde Mercado Pago, reubicado al jueves 10 hs' }, aceptar: 'Marcar como resuelto' });
    if (nota === null) return;
    try { await llamar('resolver_pago_revisar', { p_id: Number(b.dataset.resolver), p_nota: nota || null }, 'Marcado como resuelto'); refrescar(); }
    catch (err) { errorEn(null, err); }
  }));
}

// Comprobantes de transferencia subidos desde la web
async function pintarComprobantes() {
  const bloque = $('#bloque-comprobantes');
  let lista;
  try { lista = await llamar('comprobantes_pendientes', {}); } catch { bloque.classList.add('oculto'); return; }
  if (!lista?.length) { bloque.classList.add('oculto'); return; }
  bloque.classList.remove('oculto');
  // enlaces temporales (10 min) para ver los archivos privados
  const urls = await Promise.all(lista.map(async (c) => (await sb.storage.from('comprobantes').createSignedUrl(c.ruta, 600)).data?.signedUrl || null));
  const estadoPill = { confirmada: 'pill-ok">Confirmada', pendiente: 'pill-alerta">Sin seña', vencida: 'pill-error">Vencida', cancelada: 'pill-error">Cancelada' };
  $('#lista-comprobantes').innerHTML = lista.map((c, i) => {
    const esPdf = (c.tipo || c.ruta).includes('pdf');
    const vista = !urls[i] ? '<div class="comp-pdf">No se pudo cargar el archivo</div>'
      : esPdf ? `<a class="comp-pdf" href="${urls[i]}" target="_blank" rel="noopener">📄 Ver PDF</a>`
      : `<img class="comp-mini" src="${urls[i]}" alt="Comprobante de ${esc(c.nombre)}" data-ver-comp="${i}">`;
    const vigente = c.falta_total > 0;
    return `<div class="item">
      ${vista}
      <h3>${esc(c.nombre)}</h3>
      <div class="suave chico">Pedido #${c.pedido_id} · subido ${esc(new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(c.creado_en)))}</div>
      <ul class="datos" style="margin:.5em 0">${(c.reservas || []).map((r) => `<li><span>${esc(fechaLarga(r.fecha))} · ${esc(rangos(r.horas))} · ${esc(r.consultorio)}</span>
        <span><span class="pill ${estadoPill[r.estado] || 'pill-info">' + esc(r.estado)}</span></span></li>`).join('')}</ul>
      ${vigente ? `<div>Falta de seña: <strong>${pesos(c.falta_sena)}</strong> · Saldo total: ${pesos(c.falta_total)}</div>`
        : '<p class="aviso aviso-alerta chico">Las reservas de este pedido ya no están vigentes (vencidas o pagas). Si corresponde, cargalas de nuevo desde "+ Reserva".</p>'}
      <div class="acciones">
        ${vigente && c.falta_sena > 0 ? `<button class="btn btn-acento btn-chico" data-comp-sena="${i}">Registrar seña ${pesos(c.falta_sena)}</button>` : ''}
        ${vigente ? `<button class="btn btn-borde btn-chico" data-comp-otro="${i}">Otro monto</button>` : ''}
        <button class="btn btn-peligro btn-chico" data-comp-rechazar="${i}">${vigente ? 'Rechazar' : 'Archivar'}</button>
        <a class="btn btn-wa btn-chico" target="_blank" rel="noopener" href="${waLink(c.whatsapp, `Hola ${c.nombre.split(' ')[0]}! Te escribimos de Psico Studios por el comprobante del pedido #${c.pedido_id}.`)}">WhatsApp</a>
      </div>
    </div>`;
  }).join('');
  const revisar = async (c, aceptar, monto, nota, msg) => {
    try { await llamar('revisar_comprobante', { p_id: c.id, p_aceptar: aceptar, p_monto: monto, p_medio: 'transferencia', p_nota: nota }, msg); refrescar(); }
    catch (err) { errorEn(null, err); }
  };
  $$('[data-ver-comp]').forEach((im) => (im.onclick = () => abrirModal(`<h2 id="modal-titulo">Comprobante de ${esc(lista[im.dataset.verComp].nombre)}</h2>
    <img src="${im.src}" alt="Comprobante" style="width:100%;border-radius:10px">`)));
  $$('[data-comp-sena]').forEach((b) => (b.onclick = async () => {
    const c = lista[b.dataset.compSena];
    if (await preguntar({ titulo: `¿Registrar la seña de ${pesos(c.falta_sena)}?`, texto: `Se confirma el pedido #${c.pedido_id} de ${c.nombre}. Confirmalo solo si viste la transferencia en la cuenta.`, aceptar: 'Registrar seña' }) === null) return;
    revisar(c, true, c.falta_sena, null, 'Seña registrada: pedido confirmado');
  }));
  $$('[data-comp-otro]').forEach((b) => (b.onclick = async () => {
    const c = lista[b.dataset.compOtro];
    const v = await preguntar({ titulo: '¿Cuánto transfirió?', texto: `Se reparte entre los días del pedido: primero la seña de cada uno y después el saldo. Máximo ${pesos(c.falta_total)}.`,
      campo: { etiqueta: 'Monto ($)', tipo: 'number', valor: c.falta_sena || c.falta_total }, aceptar: 'Registrar pago' });
    if (v === null) return;
    revisar(c, true, Number(v), null, 'Pago registrado');
  }));
  $$('[data-comp-rechazar]').forEach((b) => (b.onclick = async () => {
    const c = lista[b.dataset.compRechazar];
    const nota = await preguntar({ titulo: '¿Rechazar el comprobante?', texto: 'No se registra ningún pago. Avisale por WhatsApp qué pasó.',
      campo: { etiqueta: 'Motivo (queda registrado)', placeholder: 'Ej: no se lee el monto' }, aceptar: 'Rechazar', peligro: true });
    if (nota === null) return;
    revisar(c, false, null, nota || null, 'Comprobante rechazado');
  }));
}

async function pintarPendientes() {
  pintarComprobantes();
  pintarPagosRevisar();
  const lp = $('#lista-pend'), ls = $('#lista-sol');
  lp.innerHTML = ls.innerHTML = '<div class="cargando">Cargando…</div>';
  const [r, f] = await Promise.all([
    sb.from('reservas').select('*, profesionales(nombre, whatsapp), consultorios(nombre)').eq('estado', 'pendiente').order('fecha').order('creado_en'),
    sb.from('fijos').select('*, profesionales(nombre, whatsapp), consultorios(nombre)').eq('estado', 'solicitud').order('creado_en'),
  ]);
  if (r.error || f.error) { errorEn(null, r.error || f.error); return; }

  lp.innerHTML = r.data.length ? r.data.map((x) => `
    <div class="item">
      <h3>${esc(x.profesionales.nombre)}</h3>
      <div class="suave chico">${esc(fechaLarga(x.fecha))} · ${esc(rangos(x.horas))} · ${esc(x.consultorios.nombre)}</div>
      <div style="margin-top:.5em">Seña: <strong>${pesos(sena(x.precio_total))}</strong> de ${pesos(x.precio_total)}
        ${x.expira_en ? `<span class="pill pill-alerta">vence en ${faltan(x.expira_en)}</span>` : '<span class="pill pill-info">cargada en panel</span>'}</div>
      <div class="acciones">
        <button class="btn btn-acento btn-chico" data-ver="${x.id}">Registrar seña</button>
        <a class="btn btn-wa btn-chico" target="_blank" rel="noopener" href="${waLink(x.profesionales.whatsapp, `Hola ${x.profesionales.nombre.split(' ')[0]}! Te escribimos de Psico Studios por tu reserva del ${fechaLarga(x.fecha)} (${rangos(x.horas)}). Para confirmarla falta la seña de ${pesos(sena(x.precio_total))}. Alias: ${st.cfg.alias_transferencia}.`)}">WhatsApp</a>
      </div>
    </div>`).join('') : '<p class="suave">No hay reservas esperando seña. 🎉</p>';

  ls.innerHTML = f.data.length ? f.data.map((x) => `
    <div class="item">
      <h3>${esc(x.profesionales.nombre)}</h3>
      <div class="suave chico">Todos los ${DIAS[x.dia_semana].toLowerCase()} · ${esc(rangos(x.horas))} · ${esc(x.consultorios.nombre)}</div>
      <div style="margin-top:.5em">Desde ${esc(fechaLarga(x.desde))} · ${pesos(x.precio_semanal)}/semana
        ${x.expira_en ? `<span class="pill pill-alerta">se libera en ${faltan(x.expira_en)}</span>` : ''}</div>
      <div class="acciones"><button class="btn btn-acento btn-chico" data-fijo="${x.id}">Ver y aprobar</button></div>
    </div>`).join('') : '<p class="suave">No hay solicitudes de fijo.</p>';

  $$('[data-ver]', lp).forEach((b) => (b.onclick = () => detalleReserva(Number(b.dataset.ver))));
  $$('[data-fijo]', ls).forEach((b) => (b.onclick = () => detalleFijo(Number(b.dataset.fijo), null, false)));
}

// ================================================================ FIJOS
async function pintarFijos() {
  const cont = $('#lista-fijos');
  cont.innerHTML = '<div class="cargando">Cargando…</div>';
  const periodo = hoyAR().slice(0, 7);
  $('#fijos-mes').textContent = 'Pagos de ' + periodo;
  const [f, p] = await Promise.all([
    sb.from('fijos').select('*, profesionales(nombre, whatsapp), consultorios(nombre)').eq('estado', 'activo').order('dia_semana'),
    sb.from('pagos').select('fijo_id, monto, anulado, periodo').eq('periodo', periodo),
  ]);
  if (f.error) return errorEn(null, f.error);
  if (!f.data.length) { cont.innerHTML = '<p class="suave">Todavía no hay horarios fijos.</p>'; return; }
  const pagadoDe = (id) => (p.data || []).filter((x) => x.fijo_id === id && !x.anulado).reduce((s, x) => s + x.monto, 0);
  cont.innerHTML = `<table class="tabla"><thead><tr><th>Profesional</th><th>Día y horario</th><th>Consultorio</th><th>Semanal</th><th>Este mes</th></tr></thead><tbody>
    ${f.data.map((x) => {
      const debe = x.precio_semanal * vecesEnMes(x, periodo);
      const pag = pagadoDe(x.id);
      const pill = pag >= debe ? '<span class="pill pill-ok">Pagado</span>' : pag > 0 ? `<span class="pill pill-alerta">Falta ${pesos(debe - pag)}</span>` : `<span class="pill pill-error">Debe ${pesos(debe)}</span>`;
      return `<tr class="click" data-fijo="${x.id}"><td><strong>${esc(x.profesionales.nombre)}</strong></td>
        <td>${DIAS[x.dia_semana]} · ${esc(rangos(x.horas))}</td><td>${esc(x.consultorios.nombre)}</td><td>${pesos(x.precio_semanal)}</td><td>${pill}</td></tr>`;
    }).join('')}</tbody></table>`;
  $$('[data-fijo]', cont).forEach((tr) => (tr.onclick = () => detalleFijo(Number(tr.dataset.fijo), null, false)));
}

// ================================================================ PROFESIONALES
let profesionalesCompletos = [];
async function pintarProfesionales() {
  const cont = $('#lista-prof');
  cont.innerHTML = '<div class="cargando">Cargando…</div>';
  const { data, error } = await sb.from('profesionales').select('*').order('nombre');
  if (error) return errorEn(null, error);
  profesionalesCompletos = data;
  filtrarProfesionales();
}
function filtrarProfesionales() {
  const q = $('#buscar-prof').value.trim().toLowerCase();
  const lista = profesionalesCompletos.filter((p) => !q || p.nombre.toLowerCase().includes(q) || (p.email || '').toLowerCase().includes(q) || p.whatsapp.includes(q.replace(/\D/g, '') || '§'));
  $('#cant-prof').textContent = `${lista.length} de ${profesionalesCompletos.length}`;
  $('#lista-prof').innerHTML = `<table class="tabla"><thead><tr><th>Nombre</th><th>WhatsApp</th><th>Mail</th><th>Profesión</th><th>Origen</th></tr></thead><tbody>
    ${lista.map((p) => `<tr class="click" data-prof="${p.id}"><td><strong>${esc(p.nombre)}</strong></td><td>${esc(p.whatsapp)}</td>
      <td>${esc(p.email || '—')}</td><td>${esc(p.profesion || '—')}</td><td>${esc(p.origen || '—')}</td></tr>`).join('')}</tbody></table>`;
  $$('[data-prof]').forEach((tr) => (tr.onclick = () => editarProfesional(Number(tr.dataset.prof))));
}
$('#buscar-prof').oninput = filtrarProfesionales;

function editarProfesional(id) {
  const p = profesionalesCompletos.find((x) => x.id === id);
  const ORIGENES = ['Meta Ads', 'Google', 'Recomendación', 'Universidad', 'Web', 'Carga manual', 'Otro'];
  abrirModal(`
    <h2 id="modal-titulo">${esc(p.nombre)}</h2>
    <form id="form-prof">
      <div class="campo"><label for="e-nombre">Nombre</label><input id="e-nombre" value="${esc(p.nombre)}" required></div>
      <div class="fila2">
        <div class="campo"><label>WhatsApp</label><input value="${esc(p.whatsapp)}" disabled>
          <div class="ayuda"><a href="${waLink(p.whatsapp, '')}" target="_blank" rel="noopener">Abrir chat</a></div></div>
        <div class="campo"><label for="e-email">Email</label><input id="e-email" type="email" value="${esc(p.email || '')}"></div>
        <div class="campo"><label for="e-prof">Profesión</label><input id="e-prof" value="${esc(p.profesion || '')}"></div>
        <div class="campo"><label for="e-origen">¿Cómo nos conoció?</label><select id="e-origen"><option value=""></option>
          ${ORIGENES.map((o) => `<option ${o === p.origen ? 'selected' : ''}>${o}</option>`).join('')}</select></div>
      </div>
      <div class="campo"><label for="e-notas">Notas internas</label><textarea id="e-notas" rows="3">${esc(p.notas || '')}</textarea></div>
      <label style="display:flex;gap:.6em;align-items:center;font-weight:500"><input type="checkbox" id="e-hab" ${p.usa_habilitacion ? 'checked' : ''} style="width:22px;min-height:22px"> Usa la habilitación del consultorio</label>
      <div id="e-error" class="aviso aviso-error oculto" role="alert"></div>
      <button class="btn btn-primario btn-bloque" style="margin-top:1em">Guardar</button>
    </form>`);
  $('#form-prof').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await sb.from('profesionales').update({
      nombre: $('#e-nombre').value.trim(), email: $('#e-email').value.trim() || null, profesion: $('#e-prof').value.trim() || null,
      origen: $('#e-origen').value || null, notas: $('#e-notas').value.trim() || null, usa_habilitacion: $('#e-hab').checked,
    }).eq('id', id);
    if (error) return errorEn($('#e-error'), error);
    toast('Datos guardados'); cerrarModal(); cargarBase(); pintarProfesionales();
  };
}

// ================================================================ AJUSTES
// Datos de cobro: protegidos en la base, solo se cambian desde Supabase (SQL Editor)
const CONFIG_PROTEGIDA = [
  ['alias_transferencia', 'Alias'],
  ['cvu_transferencia', 'CVU / CBU'],
  ['titular_transferencia', 'Titular de la cuenta'],
  ['whatsapp_contacto', 'WhatsApp del equipo'],
  ['email_equipo', 'Mail del equipo (recibe los avisos)'],
];
const CONFIG_VISIBLE = [
  ['mercadopago_activo', 'Cobrar la seña con Mercado Pago', 'sino'],
  ['avisos_email_activo', 'Avisos por mail a los profesionales', 'sino'],
  ['avisos_whatsapp_activo', 'Avisos por WhatsApp (requiere la API de WhatsApp Business)', 'sino'],
  ['porcentaje_sena', 'Seña para confirmar (%)', 'number'],
  ['retencion_suelta_minutos', 'Minutos para pagar la seña', 'number'],
  ['retencion_fijo_horas', 'Horas para aprobar una solicitud de fijo', 'number'],
  ['hora_apertura', 'Hora de apertura', 'number'],
  ['hora_cierre', 'Hora de cierre', 'number'],
  ['hora_fin_manana', 'Desde qué hora rige precio de tarde', 'number'],
  ['meses_reserva_maximo', 'Meses hacia adelante que se puede reservar', 'number'],
  ['max_horas_por_reserva', 'Máximo de horas por reserva web', 'number'],
  ['min_horas_fijo_manana', 'Horario fijo: mínimo de horas por la mañana', 'number'],
  ['min_horas_fijo_tarde', 'Horario fijo: mínimo de horas seguidas por la tarde', 'number'],
  ['max_pendientes_por_whatsapp', 'Reservas sin pagar por persona (web)', 'number'],
];

async function pintarAjustes() {
  $('#p-desde').value = $('#p-desde').value || hoyAR();
  const { data: precios } = await sb.from('precios').select('*').order('vigente_desde', { ascending: false });
  const hoy = hoyAR();
  const vigente = (m, f) => (precios || []).find((p) => p.modalidad === m && p.franja === f && p.vigente_desde <= hoy);
  const futuros = (precios || []).filter((p) => p.vigente_desde > hoy);
  $('#tabla-precios').innerHTML = `<table class="tabla" style="max-width:640px"><thead><tr><th></th><th>Mañana</th><th>Tarde</th></tr></thead><tbody>
    <tr><td><strong>Por horas</strong></td><td>${pesos(vigente('suelta', 'manana')?.valor)}</td><td>${pesos(vigente('suelta', 'tarde')?.valor)}</td></tr>
    <tr><td><strong>Horario fijo</strong></td><td>${pesos(vigente('fijo', 'manana')?.valor)}</td><td>${pesos(vigente('fijo', 'tarde')?.valor)}</td></tr>
    </tbody></table>
    ${futuros.length ? `<p class="aviso aviso-info chico" style="max-width:640px">Aumentos programados: ${futuros.map((p) =>
      `${p.modalidad === 'suelta' ? 'por horas' : 'fijo'} ${p.franja === 'manana' ? 'mañana' : 'tarde'} ${pesos(p.valor)} desde ${fechaCorta(p.vigente_desde)}`).join(' · ')}</p>` : ''}`;

  $('#lista-config').innerHTML = `
    <div class="tarjeta" style="max-width:640px;margin-bottom:14px">
      <h3>🔒 Datos de cobro</h3>
      <p class="suave chico">Por seguridad, estos datos no se pueden cambiar desde el panel, ni siquiera con la contraseña.
        Así nadie puede desviar los pagos a otra cuenta. Se cambian solo desde Supabase (ver README, paso 7).</p>
      <ul class="datos">${CONFIG_PROTEGIDA.map(([k, t]) => `<li><span>${t}</span><span>${
        !st.cfg[k] || st.cfg[k] === 'COMPLETAR' ? '<span class="pill pill-alerta">Sin cargar</span>' : esc(st.cfg[k])}</span></li>`).join('')}</ul>
    </div>
    <div class="tarjeta" style="max-width:640px">${CONFIG_VISIBLE.map(([k, t, tipo]) => `
    <form class="campo" data-cfg="${k}" style="display:flex;gap:8px;align-items:flex-end">
      <div style="flex:1"><label for="c-${k}">${t}</label>${tipo === 'sino'
        ? `<select id="c-${k}"><option value="si" ${st.cfg[k] === 'si' ? 'selected' : ''}>Sí</option><option value="no" ${st.cfg[k] !== 'si' ? 'selected' : ''}>No</option></select>`
        : `<input id="c-${k}" type="${tipo}" value="${esc(st.cfg[k] ?? '')}" required>`}</div>
      <button class="btn btn-borde btn-chico" style="min-height:48px">Guardar</button>
    </form>`).join('')}</div>`;
  $$('form[data-cfg]').forEach((fm) => (fm.onsubmit = async (e) => {
    e.preventDefault();
    const k = fm.dataset.cfg;
    const v = $('input, select', fm).value.trim();
    const { data, error } = await sb.from('config').update({ valor: v }).eq('clave', k).select();
    if (error) return errorEn(null, error);
    if (!data?.length) return errorEn(null, 'No se pudo guardar: tu usuario no tiene permiso para cambiar este dato.');
    st.cfg[k] = v;
    toast('Guardado');
  }));
}

$('#form-precio').onsubmit = async (e) => {
  e.preventDefault();
  const fila = { modalidad: $('#p-mod').value, franja: $('#p-franja').value, valor: Number($('#p-valor').value), vigente_desde: $('#p-desde').value };
  if (!(fila.valor > 0)) return toast('Poné un precio válido');
  const { error } = await sb.from('precios').insert(fila);
  if (error) return errorEn(null, /duplicate|unique/i.test(error.message) ? 'Ya hay un precio cargado para esa modalidad, franja y fecha.' : error);
  toast('Precio guardado');
  $('#p-valor').value = '';
  pintarAjustes();
};

// ================================================================ arranque
setInterval(() => { if (!$('#app').classList.contains('oculto') && $('#modal').classList.contains('oculto')) refrescar(); }, 60000);

const { data: { session } } = await sb.auth.getSession();
if (session) await entrar();
else $('#login').classList.remove('oculto');

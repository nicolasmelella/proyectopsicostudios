// Panel del equipo (con login).
import {
  crearCliente, esc, pesos, hoyAR, sumarDias, diaSemana, fechaLarga, fechaCorta, horaTxt, rangos,
  faltan, mensajeError, linkWhatsApp, waArgentina, DIAS, DIAS_CORTOS, preguntar,
} from './comun.js';
import { crearAsistente } from './asistente.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
// Si se llega desde el link de una invitación o de "olvidé mi contraseña", hay que elegir contraseña.
// (Se lee antes de crear el cliente, que limpia la dirección.)
const tipoLink = new URLSearchParams(location.hash.slice(1)).get('type');
const sb = await crearCliente({ sesionTemporal: true });

const DOMINIO_USUARIOS = 'psicostudios.local';
const MINUTOS_INACTIVIDAD = 60;
const MEDIOS = [['transferencia', 'Transferencia'], ['efectivo', 'Efectivo'], ['mercadopago', 'Mercado Pago'], ['otro', 'Otro']];

// Lunes de la semana de una fecha (el domingo muestra la semana que empieza)
const lunesDe = (f) => (diaSemana(f) === 7 ? sumarDias(f, 1) : sumarDias(f, 1 - diaSemana(f)));

// Pestaña "Asistente" (asistente.js). Se crea al final, cuando ya están todas las funciones.
let asistente = { pintar() {}, badge() {} };

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

// "¿A quién le pagaron?" (la lista sale de Precios y ajustes)
const quienesCobran = () => String(st.cfg.quienes_cobran || '').split(',').map((x) => x.trim()).filter(Boolean);
function campoRecibio(id) {
  const lista = quienesCobran();
  if (!lista.length) return '';
  return `<div class="campo"><label>¿A quién le pagaron?</label><div class="grupo-grande" id="${id}">${lista.map((x) =>
    `<button type="button" class="chip" data-recibio="${esc(x)}" aria-pressed="false">${esc(x)}</button>`).join('')}</div></div>`;
}
// Conecta los botones y devuelve una función que dice quién quedó elegido
function conectarRecibio(id) {
  let elegido = null;
  $$(`#${id} .chip`).forEach((b) => (b.onclick = () => {
    elegido = b.dataset.recibio;
    document.querySelectorAll('#modal-cuerpo .aviso-error').forEach((x) => x.classList.add('oculto'));
    $$(`#${id} .chip`).forEach((x) => x.setAttribute('aria-pressed', x === b));
  }));
  return () => elegido;
}
const faltaRecibio = (elegido) => quienesCobran().length > 0 && !elegido;

// Comentarios del equipo ("algo a tener en cuenta"); solo los ve el equipo
function bloqueComentario(texto, ayuda) {
  return `<form class="bloque" id="form-coment">
    <label for="coment"><strong>📝 Comentarios</strong></label>
    <textarea id="coment" rows="2" maxlength="1000" placeholder="Algo a tener en cuenta (solo lo ve el equipo)">${esc(texto || '')}</textarea>
    ${ayuda ? `<div class="ayuda">${ayuda}</div>` : ''}
    <button class="btn btn-borde btn-chico" style="margin-top:6px">Guardar comentario</button>
  </form>`;
}
function conectarComentario(params) {
  $('#form-coment')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await llamar('guardar_comentario', { p_texto: $('#coment').value, ...params }, 'Comentario guardado'); refrescar(); }
    catch (err) { errorEn(null, err); }
  });
}

// Compartir la reserva con el profesional (mensaje listo para copiar o mandar por WhatsApp)
const primerNombre = (n) => String(n || '').trim().split(' ')[0];
const diaCorto = (f) => `${DIAS[diaSemana(f)]} ${Number(f.slice(8))}/${Number(f.slice(5, 7))}`;
function horarioTexto(horas) {
  const hs = [...horas].map(Number).sort((a, b) => a - b);
  const tramos = [];
  for (const h of hs) { const u = tramos.at(-1); if (u && u[1] === h) u[1] = h + 1; else tramos.push([h, h + 1]); }
  return tramos.map(([a, b]) => `de ${a} a ${b} hs`).join(' y ');
}
async function compartirReserva(r, pagado) {
  // Si es un pedido de varios días, el mensaje los lista todos
  let lista = [{ ...r, consultorio: r.consultorios?.nombre }];
  let pagadoTotal = pagado, totalTotal = r.precio_total;
  if (r.pedido_id) {
    const { data } = await sb.from('reservas').select('*, consultorios(nombre)').eq('pedido_id', r.pedido_id);
    const vig = (data || []).filter((x) => ['pendiente', 'confirmada'].includes(x.estado)).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    if (vig.length > 1) {
      lista = vig.map((x) => ({ ...x, consultorio: x.consultorios?.nombre }));
      const { data: pg } = await sb.from('pagos').select('reserva_id, monto, anulado').in('reserva_id', vig.map((x) => x.id));
      pagadoTotal = (pg || []).filter((p) => !p.anulado).reduce((s, p) => s + p.monto, 0);
      totalTotal = vig.reduce((s, x) => s + x.precio_total, 0);
    }
  }
  if (!['pendiente', 'confirmada'].includes(r.estado)) return;
  const confirmada = lista.every((x) => x.estado === 'confirmada');
  const lineas = lista.map((x) => `• ${diaCorto(x.fecha)}, ${horarioTexto(x.horas)}, en el ${x.consultorio}`).join('\n');
  const saldo = totalTotal - pagadoTotal;
  const senaFalta = Math.max(0, lista.reduce((s, x) => s + sena(x.precio_total), 0) - pagadoTotal);
  const texto = confirmada
    ? `Hola ${primerNombre(r.profesionales.nombre)}! Te confirmamos tu reserva en Psico Studios:\n\n${lineas}\n\n${saldo > 0 ? `Saldo a abonar: ${pesos(saldo)}. ¡Te esperamos!` : 'Ya está todo pago. ¡Te esperamos!'}`
    : `Hola ${primerNombre(r.profesionales.nombre)}! Tenemos guardada tu reserva en Psico Studios:\n\n${lineas}\n\nPara confirmarla falta la seña de ${pesos(senaFalta)}.${st.cfg.alias_transferencia && st.cfg.alias_transferencia !== 'COMPLETAR' ? ` Alias: ${st.cfg.alias_transferencia}.` : ''}`;
  pintarCompartir(texto, r.profesionales.whatsapp, confirmada ? '' : 'Todavía falta la seña: el mensaje lo avisa.');
}
function textoFijo(f) {
  return `Hola ${primerNombre(f.profesionales.nombre)}! Te confirmamos tu horario fijo en Psico Studios:\n\n`
    + `• Todos los ${f.dia_semana === 6 ? 'sábados' : DIAS[f.dia_semana].toLowerCase()}, ${horarioTexto(f.horas)}, en el ${f.consultorios.nombre}\n`
    + `• Desde el ${diaCorto(f.desde).toLowerCase()}\n\n¡Te esperamos!`;
}
function pintarCompartir(texto, whatsapp, nota = '') {
  const cont = $('#compartir');
  if (!cont) return;
  const tieneWa = /^\d{8,}$/.test(String(whatsapp || '').replace(/\D/g, ''));
  cont.innerHTML = `<div class="bloque compartir" style="margin-bottom:1.4em">
    <label for="compartir-texto"><strong>Compartir con el profesional</strong></label>
    ${nota ? `<p class="ayuda" style="margin:0 0 .4em">${esc(nota)}</p>` : ''}
    <textarea id="compartir-texto" rows="7">${esc(texto)}</textarea>
    <div class="grupo-btn" style="margin-top:.6em">
      <button type="button" class="btn btn-primario btn-chico" id="compartir-copiar">Copiar mensaje</button>
      ${tieneWa ? '<a class="btn btn-wa btn-chico" id="compartir-wa" target="_blank" rel="noopener" href="#">Enviar por WhatsApp</a>' : '<span class="ayuda">Sin WhatsApp cargado: copiá el mensaje y mandalo a mano.</span>'}
    </div></div>`;
  const ta = $('#compartir-texto');
  $('#compartir-copiar').onclick = async () => {
    try { await navigator.clipboard.writeText(ta.value); toast('Mensaje copiado'); }
    catch { ta.focus(); ta.select(); toast('Seleccioné el mensaje: copialo con Ctrl+C'); }
  };
  const wa = $('#compartir-wa');
  if (wa) {
    const actualizar = () => { wa.href = waLink(whatsapp, ta.value); };
    ta.addEventListener('input', actualizar);
    actualizar();
  }
}

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
  st.admin = !!(await sb.rpc('es_admin')).data;
  $('#tab-equipo').classList.toggle('oculto', !st.admin);
  if (!st.admin && st.tab === 'equipo') st.tab = 'semana';
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
  ({ equipo: pintarEquipo, semana: pintarSemana, numeros: pintarNumeros, agenda: pintarAgenda, pendientes: pintarPendientes, fijos: pintarFijos, profesionales: pintarProfesionales, ajustes: pintarAjustes, asistente: () => asistente.pintar() })[tab]();
}
$$('.tabs button').forEach((b) => (b.onclick = () => irA(b.dataset.tab)));

async function refrescar() {
  irA(st.tab);
  actualizarBadge();
}

async function actualizarBadge() {
  asistente.badge();
  const [a, m, c] = await Promise.all([
    sb.rpc('alertas_pago'),
    sb.from('pagos_a_revisar').select('id').eq('resuelto', false),
    sb.from('comprobantes').select('id').eq('estado', 'pendiente'),
  ]);
  const n = (a.data?.length || 0) + (m.data?.length || 0) + (c.data?.length || 0);
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
      estado = 'Sin seña';
    }
  } else if (f.tipo === 'fijo') { clase = 't-fijo'; estado = 'Fijo · ' + (f.pagado ? 'mes pagado ✓' : 'mes sin pagar'); }
  else if (f.tipo === 'solicitud') { clase = 't-solicitud'; estado = 'Solicitud de fijo'; }
  else if (f.tipo === 'liberado') { clase = 't-liberado'; estado = 'Libre · fijo liberado'; }
  else { estado = 'Bloqueado'; }
  const nombre = f.tipo === 'liberado' ? f.nombre : f.nombre;
  return `<button class="celda ${clase}" data-k="${f.consultorio_id}|${f.hora}" style="min-height:${52 * span}px">
    <span class="n">${esc(nombre)}</span><span class="e">${esc(estado)}${f.tipo !== 'liberado' && f.detalle ? ' · 📝 ' + esc(f.detalle) : ''}</span></button>`;
}


// ================================================================ SEMANA (como la hoja del Excel)
$('#se-ant').onclick = () => { st.semana = sumarDias(st.semana, -7); pintarSemana(); };
$('#se-sig').onclick = () => { st.semana = sumarDias(st.semana, 7); pintarSemana(); };
$('#se-hoy').onclick = () => { st.semana = lunesDe(hoyAR()); pintarSemana(); };
$('#se-imprimir').onclick = () => window.print();
$('#se-excel').onclick = () => bajarSemanaExcel();

let datosSemana = { filas: [], mapa: new Map(), notas: [] };

// Cuántos días entran en pantalla: 2, 3 o la semana entera (se recuerda en esta compu)
let zoom = 3;
try { zoom = Number(localStorage.getItem('psico-zoom')) || 3; } catch { /* nada */ }
function ajustarZoom() {
  const tabla = $('#semana table.semana');
  if (!tabla) return;
  const ancho = $('#se-wrap').clientWidth - 62;
  const columnas = zoom * 6;
  const cw = Math.max(zoom === 6 ? 26 : zoom === 3 ? 64 : 88, Math.floor(ancho / columnas));
  tabla.style.setProperty('--cw', cw + 'px');
  tabla.classList.toggle('compacto', cw < 64);
  $$('[data-zoom]').forEach((b) => b.setAttribute('aria-pressed', Number(b.dataset.zoom) === zoom));
}
$$('[data-zoom]').forEach((b) => (b.onclick = () => {
  zoom = Number(b.dataset.zoom);
  try { localStorage.setItem('psico-zoom', zoom); } catch { /* nada */ }
  pintarSemana();
}));
window.addEventListener('resize', () => { if (st.tab === 'semana') ajustarZoom(); });
const diasDeSemana = () => [0, 1, 2, 3, 4, 5].map((i) => sumarDias(st.semana, i));
const consCorto = (c) => (c.id === 6 || /sal[oó]n/i.test(c.nombre) ? 'Salón' : 'C' + (c.nombre.match(/\d+/)?.[0] || c.id));

// Cómo se ve cada casillero ocupado (colores como en el Excel)
function claseSemana(f) {
  if (f.tipo === 'fijo') return ['s-fijo', f.pagado ? 'fijo ✓' : 'fijo'];
  if (f.tipo === 'solicitud') return ['s-sol', 'pidió fijo'];
  if (f.tipo === 'liberado') return ['s-lib', 'no viene · libre'];
  if (f.tipo === 'bloqueo') return ['s-bloq', 'bloqueado'];
  if (f.tipo_excel) {
    const t = { fijo: ['s-fijo', 'fijo'], flotante: ['s-suelta', 'flotante'], pericia: ['s-peri', 'pericia'], quincenal: ['s-quinc', 'cada 15 días'] }[f.tipo_excel];
    if (t) return t;
  }
  if (f.estado === 'confirmada') return ['s-suelta', f.pagado ? 'pagó todo' : f.monto_pagado ? 'señada' : 'anotada'];
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
  const corto = zoom === 6;
  html += dias.map((d) => `<th colspan="${cons.length}" class="fin-dia ${d === hoy ? 'hoy' : ''}" scope="colgroup">${(corto ? DIAS_CORTOS : DIAS)[diaSemana(d)]} ${fechaCorta(d)}${d === hoy ? (corto ? ' ·' : ' · HOY') : ''}</th>`).join('');
  html += '</tr><tr>' + dias.map((d) => cons.map((c, i) => `<th scope="col" title="${esc(c.nombre)}" class="${i === cons.length - 1 ? 'fin-dia' : ''} ${d === hoy ? 'hoy' : ''}">${esc(corto ? consCorto(c).replace('Salón', 'S') : consCorto(c))}</th>`).join('')).join('') + '</tr></thead><tbody>';
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
        const coment = f.tipo !== 'liberado' && f.detalle ? ` · 📝 ${f.detalle}` : '';
        html += `<td class="${td}" rowspan="${span}"><button class="sc ${clase}" data-ver="${k}" style="min-height:${(zoom === 6 ? 30 : 40) * span}px"
          title="${esc(f.nombre || '')} · ${esc(estado)}${esc(coment)}" aria-label="${esc(etiqueta)}: ${esc(f.nombre || '')}, ${esc(estado)}${esc(coment)}">
          <span class="n">${esc(f.nombre || '')}</span><span class="e">${esc(estado)}${coment ? ' 📝' : ''}</span></button></td>`;
      });
    }
    html += '</tr>';
  }
  cont.innerHTML = html + '</tbody></table>';
  ajustarZoom();

  $$('[data-anotar]', cont).forEach((b) => (b.onclick = () => {
    if (arrastre.recien) { arrastre.recien = false; return; }
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

// ================================================================ NÚMEROS (tablero)
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const pct = (n) => `${Math.round(n * 100)}%`;
const finDeMes = (ini) => sumarDias(sumarDias(ini.slice(0, 8) + '01', 32).slice(0, 7) + '-01', -1);
const may = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// Períodos: semana (lunes a sábado), quincena (1 al 15 / 16 a fin de mes) o mes
function periodoDe(fecha, tipo) {
  if (tipo === 'semana') { const l = sumarDias(fecha, 1 - diaSemana(fecha)); return { tipo, ini: l, fin: sumarDias(l, 5) }; }  // lunes de esa misma semana
  const mes = fecha.slice(0, 8);
  if (tipo === 'quincena') return Number(fecha.slice(8)) <= 15 ? { tipo, ini: mes + '01', fin: mes + '15' } : { tipo, ini: mes + '16', fin: finDeMes(fecha) };
  return { tipo, ini: mes + '01', fin: finDeMes(fecha) };
}
const periodoAnterior = (p) => periodoDe(sumarDias(p.ini, -1), p.tipo);
const periodoSiguiente = (p) => periodoDe(sumarDias(p.fin, p.tipo === 'semana' ? 2 : 1), p.tipo);
function nombrePeriodo(p, corto = false) {
  const mes = MESES_LARGOS[Number(p.ini.slice(5, 7)) - 1];
  const anio = p.ini.slice(0, 4);
  if (p.tipo === 'semana') return corto ? fechaCorta(p.ini) : `Semana del ${fechaCorta(p.ini)} al ${fechaCorta(p.fin)}`;
  if (p.tipo === 'quincena') {
    const q = p.ini.endsWith('-01') ? '1ª' : '2ª';
    return corto ? `${q} ${mes.slice(0, 3)}` : `${q} quincena de ${mes} ${anio}`;
  }
  return corto ? may(mes.slice(0, 3)) : `${may(mes)} ${anio}`;
}
// Horas posibles en un período (lunes a sábado), sin contar las bloqueadas (ej: Privado)
function capacidad(p, T) {
  const bloq = (T?.bloq_por_fecha || []).filter((x) => x.fecha >= p.ini && x.fecha <= p.fin).reduce((s, x) => s + x.horas, 0);
  return capacidadBruta(p) - bloq;
}
function capacidadBruta(p) {
  const nCons = st.consultorios.filter((c) => c.activo).length;
  const horasDia = Number(st.cfg.hora_cierre || 21) - Number(st.cfg.hora_apertura || 8);
  let dias = 0;
  for (let d = p.ini; d <= p.fin; d = sumarDias(d, 1)) if (diaSemana(d) !== 7) dias++;
  return dias * nCons * horasDia;
}

const nu = { tipo: 'mes', sel: null, comp: 'anterior' };
try { nu.tipo = localStorage.getItem('psico-nu-tipo') || 'mes'; } catch { /* nada */ }
$$('[data-gran]').forEach((b) => (b.onclick = () => {
  nu.tipo = b.dataset.gran;
  try { localStorage.setItem('psico-nu-tipo', nu.tipo); } catch { /* nada */ }
  nu.sel = null; nu.comp = 'anterior';
  pintarNumeros();
}));
$('#nu-ant').onclick = () => { nu.sel = periodoAnterior(nu.sel); nu.comp = 'anterior'; pintarNumeros(); };
$('#nu-sig').onclick = () => { nu.sel = periodoSiguiente(nu.sel); nu.comp = 'anterior'; pintarNumeros(); };
$('#nu-hoy').onclick = () => { nu.sel = null; nu.comp = 'anterior'; pintarNumeros(); };
$('#nu-comp').onchange = (e) => { nu.comp = e.target.value; pintarNumeros(); };

async function pintarNumeros() {
  const hoy = hoyAR();
  if (!nu.sel || nu.sel.tipo !== nu.tipo) nu.sel = periodoDe(hoy, nu.tipo);
  const sel = nu.sel;
  $$('[data-gran]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.gran === nu.tipo));
  $('#nu-titulo').textContent = nombrePeriodo(sel);

  // Opciones para comparar: el anterior y los 24 de antes
  const previos = [];
  for (let p = periodoAnterior(sel), i = 0; i < 24; p = periodoAnterior(p), i++) previos.push(p);
  $('#nu-comp').innerHTML = previos.map((p, i) => `<option value="${p.ini}" ${(nu.comp === 'anterior' ? i === 0 : nu.comp === p.ini) ? 'selected' : ''}>${i === 0 ? 'el período anterior · ' : ''}${nombrePeriodo(p)}</option>`).join('');
  const comp = previos.find((p) => p.ini === (nu.comp === 'anterior' ? previos[0].ini : nu.comp)) || previos[0];

  // Evolución: los 12 períodos que terminan en el elegido
  const evo = [sel];
  while (evo.length < 12) evo.unshift(periodoAnterior(evo[0]));
  const enCurso = sel.ini <= hoy && hoy <= sel.fin;
  const futuro = sel.ini > hoy;
  $('#nu-aviso').classList.toggle('oculto', !enCurso && !futuro);
  $('#nu-aviso').textContent = futuro ? 'Período que todavía no empezó: muestra lo que ya está reservado.'
    : enCurso ? `Período en curso: cuenta lo que ya pasó y lo que ya está reservado hasta el ${fechaCorta(sel.fin)}.` : '';

  let S, C, E, P, A;
  try {
    [S, C, E, P, A] = await Promise.all([
      llamar('tablero', { p_desde: sel.ini, p_hasta: sel.fin }),
      llamar('tablero', { p_desde: comp.ini, p_hasta: comp.fin }),
      llamar('tablero', { p_desde: evo[0].ini, p_hasta: sel.fin }),
      llamar('pendientes_cobro', {}),
      llamar('profesionales_accion', {}),
    ]);
  } catch (err) { $('#nu-kpis').innerHTML = ''; errorEn(null, err); return; }

  // ---- números grandes: elegido vs. comparación ----
  const ocS = S.horas / (capacidad(sel, S) || 1), ocC = C.horas / (capacidad(comp, C) || 1);
  const flecha = (n, txt) => (n > 0 ? `<span class="sube">▲ ${txt}</span>` : n < 0 ? `<span class="baja">▼ ${txt}</span>` : '<span>= igual</span>');
  const varPct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : null);
  const vs = `vs. ${nombrePeriodo(comp)}`;
  const difH = varPct(S.horas, C.horas), difCob = varPct(S.cobrado, C.cobrado), difP = S.n_profesionales - C.n_profesionales;
  const difOc = Math.round((ocS - ocC) * 100);
  $('#nu-kpis').innerHTML = `
    <div class="kpi"><div class="t">Ocupación</div><div class="v">${pct(ocS)}</div>
      <div class="d">${flecha(difOc, Math.abs(difOc) + ' puntos')} ${vs} (${pct(ocC)})</div></div>
    <div class="kpi"><div class="t">Horas usadas</div><div class="v">${S.horas.toLocaleString('es-AR')}</div>
      <div class="d">${S.por_tipo.fijo || 0} fijas · ${S.por_tipo.suelta || 0} sueltas (${S.horas ? Math.round(((S.por_tipo.fijo || 0) / S.horas) * 100) : 0}% fijas)<br>
        ${difH === null ? '' : flecha(difH, Math.abs(difH) + '%')} ${vs} (${C.horas.toLocaleString('es-AR')})</div></div>
    <div class="kpi"><div class="t">Valor de lo alquilado</div><div class="v">${pesos(S.valor)}</div>
      <div class="d">Horas usadas × precio (fijo o suelta, mañana o tarde). Cobrado: ${pesos(S.cobrado)}${S.valor ? ` (${Math.round((S.cobrado / S.valor) * 100)}%)` : ''}<br>
        ${varPct(S.valor, C.valor) === null ? '' : flecha(varPct(S.valor, C.valor), Math.abs(varPct(S.valor, C.valor)) + '%')} ${vs}</div></div>
    <div class="kpi"><div class="t">Profesionales que vinieron</div><div class="v">${S.n_profesionales}</div>
      <div class="d">${flecha(difP, Math.abs(difP))} ${vs} (${C.n_profesionales})</div></div>
    <div class="kpi"><div class="t">Cobrado</div><div class="v">${pesos(S.cobrado)}</div>
      <div class="d">${S.cobros_por_persona.length ? S.cobros_por_persona.map((x) => `${esc(x.recibio)} <strong>${pesos(x.monto)}</strong>`).join(' · ') : 'Sin pagos cargados en el período.'}
        ${difCob === null ? '' : `<br>${flecha(difCob, Math.abs(difCob) + '%')} ${vs}`}</div></div>
    <div class="kpi"><div class="t">Falta cobrar (hoy)</div><div class="v">${pesos(P.total)}</div>
      <div class="d">${P.items.length} ${P.items.length === 1 ? 'pendiente' : 'pendientes'} (lista abajo)</div></div>`;

  // ---- evolución ----
  const horasDe = (p) => E.por_fecha.filter((x) => x.fecha >= p.ini && x.fecha <= p.fin).reduce((s, x) => s + x.horas, 0);
  const valores = evo.map((p) => ({ p, oc: horasDe(p) / (capacidad(p, E) || 1), h: horasDe(p) }));
  const compH = { p: comp, oc: ocC, h: C.horas };
  const enEvo = valores.some((v) => v.p.ini === comp.ini);
  const max = Math.max(...valores.map((v) => v.oc), ocC, 0.01);
  $('#nu-evo-titulo').textContent = `Ocupación por ${nu.tipo === 'mes' ? 'mes' : nu.tipo === 'quincena' ? 'quincena' : 'semana'}`;
  const barra = (v, clase) => `<div class="col ${clase}" data-ir="${v.p.ini}" title="${nombrePeriodo(v.p)}: ${v.h} horas (${pct(v.oc)})">
      ${clase ? `<span class="val" style="bottom:${(v.oc / max) * 100}%">${pct(v.oc)}</span>` : ''}<div class="bar" style="height:${(v.oc / max) * 100}%"></div></div>`;
  $('#nu-evo').innerHTML = `
    <div class="ley"><span style="--c:var(--azul)">${esc(nombrePeriodo(sel))}</span><span style="--c:var(--celeste)">${esc(nombrePeriodo(comp))} (comparación)</span><span style="--c:#c9d3e6">Otros</span></div>
    <div class="barras-v">${!enEvo ? barra(compH, 'comp') + '<div style="width:10px"></div>' : ''}${valores.map((v) => barra(v, v.p.ini === sel.ini ? 'actual' : v.p.ini === comp.ini ? 'comp' : '')).join('')}</div>
    <div class="ejes-v">${!enEvo ? `<span>${esc(nombrePeriodo(comp, true))}</span><span style="flex:0 0 10px"></span>` : ''}${valores.map((v) => `<span>${esc(nombrePeriodo(v.p, true))}</span>`).join('')}</div>`;
  $$('#nu-evo [data-ir]').forEach((c) => (c.onclick = () => { nu.sel = periodoDe(c.dataset.ir, nu.tipo); nu.comp = 'anterior'; pintarNumeros(); }));

  // ---- días: elegido vs. comparación ----
  const capDia = st.consultorios.filter((c) => c.activo).length * (Number(st.cfg.hora_cierre || 21) - Number(st.cfg.hora_apertura || 8));
  const cuantos = (p, dia) => { let n = 0; for (let d = p.ini; d <= p.fin; d = sumarDias(d, 1)) if (diaSemana(d) === dia) n++; return n; };
  const bloqDia = (T, dia) => (T.bloq_calor || []).filter((x) => x.dia === dia).reduce((s, x) => s + x.horas, 0);
  const ocDia = (T, p, dia) => (T.por_dia.find((x) => x.dia === dia)?.horas || 0) / ((cuantos(p, dia) * capDia - bloqDia(T, dia)) || 1);
  const dias = [1, 2, 3, 4, 5, 6].map((dia) => ({ dia, s: ocDia(S, sel, dia), c: ocDia(C, comp, dia) }));
  const maxD = Math.max(...dias.flatMap((x) => [x.s, x.c]), 0.01);
  $('#nu-dias').innerHTML = `<div class="ley"><span style="--c:var(--azul)">${esc(nombrePeriodo(sel))}</span><span style="--c:#b9c3d6">${esc(nombrePeriodo(comp))}</span></div>
    <div class="barras-h">${dias.map((x) => `
    <span class="et">${DIAS[x.dia]}</span>
    <div class="dos" title="${DIAS[x.dia]}: ${pct(x.s)} (${nombrePeriodo(sel)}) · ${pct(x.c)} (${nombrePeriodo(comp)})">
      <div class="pista"><div class="bar" style="width:${(x.s / maxD) * 100}%"></div></div>
      <div class="bar c" style="width:${(x.c / maxD) * 100}%"></div></div>
    <span class="num"><strong>${pct(x.s)}</strong> ${Math.round((x.s - x.c) * 100) > 0 ? `<span class="sube">▲${Math.round((x.s - x.c) * 100)}</span>` : Math.round((x.s - x.c) * 100) < 0 ? `<span class="baja">▼${Math.round((x.c - x.s) * 100)}</span>` : ''}</span>`).join('')}</div>
    <p class="suave chico" style="margin:.6em 0 0">▲▼ = puntos de diferencia con la comparación.</p>`;

  // ---- mapa de calor (período elegido) ----
  const nCons = st.consultorios.filter((c) => c.activo).length;
  const calor = new Map(S.calor.map((x) => [`${x.dia}|${x.hora}`, x.horas]));
  const bloqCalor = new Map((S.bloq_calor || []).map((x) => [`${x.dia}|${x.hora}`, x.horas]));
  $('#nu-calor').innerHTML = `<table class="calor"><thead><tr><th></th>${[1, 2, 3, 4, 5, 6].map((d) => `<th>${DIAS_CORTOS[d]}</th>`).join('')}</tr></thead><tbody>
    ${horasDelDia().map((h) => `<tr><th>${h} hs</th>${[1, 2, 3, 4, 5, 6].map((d) => {
      const v = (calor.get(`${d}|${h}`) || 0) / ((cuantos(sel, d) * nCons - (bloqCalor.get(`${d}|${h}`) || 0)) || 1);
      return `<td class="${v > 0.55 ? 'osc' : ''}" style="background:rgba(18,39,90,${(0.06 + v * 0.94).toFixed(2)})" title="${DIAS[d]} ${h} hs: ${pct(v)} ocupado">${Math.round(v * 100)}</td>`;
    }).join('')}</tr>`).join('')}</tbody></table>
    <p class="suave chico" style="margin:.5em 0 0">% de consultorios ocupados a esa hora · ${esc(nombrePeriodo(sel))}.</p>`;

  // ---- ranking ----
  const antes = new Map(C.ranking.map((x) => [x.profesional_id, x.horas]));
  const top = S.ranking.slice(0, 10);
  const maxR = Math.max(...top.map((x) => x.horas), 1);
  const top5 = S.ranking.slice(0, 5).reduce((s, x) => s + x.horas, 0);
  $('#nu-ranking').innerHTML = top.length ? `<p class="conclusion" style="margin:0 0 .8em">Los 5 que más usan el espacio suman el <strong>${pct(top5 / (S.horas || 1))}</strong> de las horas.</p><div class="barras-h">${top.map((x) => {
    const a = antes.get(x.profesional_id) || 0;
    const d = x.horas - a;
    return `<span class="et" title="${esc(x.nombre)}">${esc(x.nombre)}</span>
      <div class="pista" title="${esc(x.nombre)}: ${x.horas} h (${x.horas_fijo} de fijo) · ${nombrePeriodo(comp)}: ${a} h"><div class="bar" style="width:${(x.horas / maxR) * 100}%"></div></div>
      <span class="num"><strong>${x.horas} h</strong> ${d > 0 ? `<span class="sube">▲${d}</span>` : d < 0 ? `<span class="baja">▼${-d}</span>` : ''}</span>`;
  }).join('')}</div><p class="suave chico" style="margin:.6em 0 0">${esc(nombrePeriodo(sel))} · ▲▼ = horas de diferencia con ${esc(nombrePeriodo(comp))}.</p>`
    : '<p class="suave">No hay horas en este período.</p>';

  // ---- por consultorio (fijas y sueltas) ----
  const bloqCons = new Map((S.bloq_por_consultorio || []).map((x) => [x.consultorio_id, x.horas]));
  const horasDiaN = Number(st.cfg.hora_cierre || 21) - Number(st.cfg.hora_apertura || 8);
  const diasSel = capacidadBruta(sel) / (st.consultorios.filter((c) => c.activo).length * horasDiaN || 1);
  const cons = st.consultorios.filter((c) => c.activo).map((c) => {
    const x = S.por_consultorio.find((y) => y.consultorio_id === c.id) || { horas: 0, horas_fijo: 0 };
    const cap = diasSel * horasDiaN - (bloqCons.get(c.id) || 0);
    return { c, f: x.horas_fijo, s: x.horas - x.horas_fijo, cap, oc: cap > 0 ? x.horas / cap : 0 };
  });
  const vacio = cons.filter((x) => x.cap > 0).reduce((a, x) => (x.oc < a.oc ? x : a), cons[0]);
  $('#nu-cons').innerHTML = `<div class="ley"><span style="--c:#3a8a4f">Horas fijas</span><span style="--c:#d9a21b">Horas sueltas</span><span style="--c:#eef1f6">Libres</span></div>
    ${cons.map((x) => `<div class="fila-cons" title="${esc(x.c.nombre)}: ${x.f} h fijas, ${x.s} h sueltas de ${x.cap} disponibles">
      <div class="t"><span><strong>${esc(x.c.nombre)}</strong> ${x === vacio ? '<span class="pill pill-alerta">Más vacío</span>' : ''}</span>
        <span><strong style="color:var(--texto)">${pct(x.oc)}</strong> · ${x.f} fijas · ${x.s} sueltas</span></div>
      <div class="apilada"><i class="f" style="width:${x.cap ? (x.f / x.cap) * 100 : 0}%"></i><i class="s" style="width:${x.cap ? (x.s / x.cap) * 100 : 0}%"></i></div></div>`).join('')}`;

  // ---- mañana y tarde ----
  const finMan = Number(st.cfg.hora_fin_manana || 13);
  const franja = (T, p, man) => {
    let usadas = 0, cap = 0;
    for (let d = 1; d <= 6; d++) for (const h of horasDelDia()) {
      if ((h < finMan) !== man) continue;
      usadas += T.calor.find((x) => x.dia === d && x.hora === h)?.horas || 0;
      cap += cuantos(p, d) * nCons - ((T.bloq_calor || []).find((x) => x.dia === d && x.hora === h)?.horas || 0);
    }
    return { usadas, cap, oc: cap ? usadas / cap : 0 };
  };
  const mS = franja(S, sel, true), tS = franja(S, sel, false), mC = franja(C, comp, true), tC = franja(C, comp, false);
  const filaF = (t, a, b) => `<span class="et">${t}</span><div class="dos" title="${t}: ${pct(a.oc)} (${nombrePeriodo(sel)}) · ${pct(b.oc)} (${nombrePeriodo(comp)})">
      <div class="pista"><div class="bar" style="width:${a.oc * 100}%"></div></div><div class="bar c" style="width:${b.oc * 100}%"></div></div>
    <span class="num"><strong>${pct(a.oc)}</strong> · ${a.usadas} de ${a.cap} h</span>`;
  const brecha = Math.round((tS.oc - mS.oc) * 100);
  $('#nu-franja').innerHTML = `<div class="ley"><span style="--c:var(--azul)">${esc(nombrePeriodo(sel))}</span><span style="--c:#b9c3d6">${esc(nombrePeriodo(comp))}</span></div>
    <div class="barras-h">${filaF(`Mañana (${st.cfg.hora_apertura || 8} a ${finMan})`, mS, mC)}${filaF(`Tarde (${finMan} a ${st.cfg.hora_cierre || 21})`, tS, tC)}</div>
    ${brecha >= 10 ? `<p class="conclusion">La mañana tiene <strong>${brecha} puntos menos</strong> de ocupación que la tarde: es la franja para promocionar.</p>`
      : brecha <= -10 ? `<p class="conclusion">La tarde tiene <strong>${-brecha} puntos menos</strong> de ocupación que la mañana.</p>` : ''}`;

  // ---- para accionar ----
  const wa = (x, texto) => x.whatsapp && /^\d{8,}$/.test(x.whatsapp) ? `<a class="btn btn-wa btn-chico" href="${waLink(x.whatsapp, texto)}" target="_blank" rel="noopener">WhatsApp</a>` : '';
  const diasDesde = (f) => Math.round((new Date(hoy + 'T12:00:00Z') - new Date(f + 'T12:00:00Z')) / 864e5);
  $('#nu-accion').innerHTML = `
    <div><h4>Candidatos a fijo <span class="badge">${A.candidatos_fijo.length}</span></h4>
      <p class="suave chico" style="margin:0 0 .4em">Sin fijo, pero reservaron el mismo día de la semana 3 veces o más en las últimas 8 semanas. Ofreceles el horario fijo.</p>
      ${A.candidatos_fijo.length ? `<ul class="lista-acc">${A.candidatos_fijo.slice(0, 10).map((x) => `<li><span><strong>${esc(x.nombre)}</strong>
        <small>Vino ${x.veces} ${x.dia === 6 ? "sábados" : DIAS[x.dia].toLowerCase()}</small></span>${wa(x, `Hola ${x.nombre.split(' ')[0]}! Vimos que venís seguido los ${x.dia === 6 ? "sábados" : DIAS[x.dia].toLowerCase()}. ¿Te interesa dejarlo como horario fijo? Te queda más barato.`)}</li>`).join('')}</ul>`
        : '<p class="suave">Nadie por ahora.</p>'}</div>
    <div><h4>Dejaron de venir <span class="badge">${A.inactivos.length}</span></h4>
      <p class="suave chico" style="margin:0 0 .4em">Venían (8 horas o más en los últimos 4 meses) y hace 4 semanas o más que no vienen ni tienen nada reservado.</p>
      ${A.inactivos.length ? `<ul class="lista-acc">${A.inactivos.slice(0, 10).map((x) => `<li><span><strong>${esc(x.nombre)}</strong>
        <small>Última vez: ${fechaCorta(x.ultima)} (hace ${diasDesde(x.ultima)} días) · ${x.horas} h en 4 meses</small></span>${wa(x, `Hola ${x.nombre.split(' ')[0]}! Hace un tiempo que no te vemos por Psico Studios. ¿Querés que te guardemos algún horario?`)}</li>`).join('')}</ul>
        ${A.inactivos.length > 10 ? `<p class="suave chico">Y ${A.inactivos.length - 10} más.</p>` : ''}`
        : '<p class="suave">Nadie por ahora.</p>'}</div>`;

  // ---- niveles por volumen (simulación) ----
  pintarNiveles(A);

  // ---- falta cobrar ----
  $('#nu-pendientes').innerHTML = P.items.length ? `<ul class="pend-lista">${P.items.map((x, i) => `<li ${i >= 8 ? 'class="oculto" data-mas' : ''}><button data-pend="${i}">
      <span><strong>${esc(x.nombre)}</strong><small>${x.tipo === 'fijo'
        ? `Fijo de los ${DIAS[x.detalle.dia_semana].toLowerCase()} ${rangos(x.detalle.horas)} · mes de ${MESES_LARGOS[Number(P.mes.slice(5, 7)) - 1]}`
        : `${fechaLarga(x.detalle.fecha)} · ${rangos(x.detalle.horas)}`}</small></span>
      <strong>${pesos(x.falta)}</strong></button></li>`).join('')}</ul>
    ${P.items.length > 8 ? `<button class="btn btn-borde btn-chico" id="pend-mas" style="margin-top:8px">Ver los ${P.items.length - 8} restantes</button>` : ''}`
    : '<p class="aviso aviso-ok">No hay nada pendiente de cobro. 🎉</p>';
  $('#pend-mas')?.addEventListener('click', (e) => { $$('[data-mas]').forEach((li) => li.classList.remove('oculto')); e.target.remove(); });
  $$('[data-pend]').forEach((b) => (b.onclick = () => {
    const x = P.items[Number(b.dataset.pend)];
    if (x.tipo === 'fijo') detalleFijo(x.id, hoy); else detalleReserva(x.id);
  }));
}

// Niveles por volumen: se guardan en Precios y ajustes (config 'niveles_volumen')
function nivelesActuales() {
  try { const n = JSON.parse(st.cfg.niveles_volumen || ''); if (Array.isArray(n) && n.length) return n; } catch { /* nada */ }
  return [{ n: 'Base', min: 0, pct: 0 }, { n: 'Frecuente', min: 8, pct: 5 }, { n: 'Destacado', min: 20, pct: 10 }];
}
function pintarNiveles(A, niveles = nivelesActuales()) {
  const nivelDe = (h) => niveles.reduce((a, n) => (h >= n.min ? n : a), niveles[0]);
  const lista = A.ult30.map((x) => ({ ...x, niv: nivelDe(x.horas) }));
  const costo = lista.reduce((s, x) => s + Math.round((x.valor_suelta_manana * x.niv.pct) / 100), 0);
  $('#nu-niveles').innerHTML = `<div class="nu-dos">
    <div><div style="overflow-x:auto"><table class="tabla niv-tabla"><thead><tr><th>Nivel</th><th>Desde (horas en 30 días)</th><th>Descuento mañana</th><th>Profesionales</th></tr></thead><tbody>
      ${niveles.map((n, i) => `<tr><td><strong>${esc(n.n)}</strong></td>
        <td>${i ? `<input type="number" min="1" max="300" data-niv-min="${i}" value="${n.min}" aria-label="Horas mínimas para ${esc(n.n)}">` : '0'}</td>
        <td>${i ? `<input type="number" min="0" max="50" data-niv-pct="${i}" value="${n.pct}" aria-label="Descuento para ${esc(n.n)}"> %` : '—'}</td>
        <td>${lista.filter((x) => x.niv === n).length}</td></tr>`).join('')}</tbody></table></div>
      <p class="conclusion">Con estos valores, el descuento costaría unos <strong>${pesos(costo)} por mes</strong>.</p>
      <div class="grupo-btn" style="margin-top:.6em"><button class="btn btn-primario btn-chico" id="niv-guardar">Guardar niveles</button>
        <button class="btn btn-borde btn-chico" id="niv-reset">Volver a los sugeridos</button></div></div>
    <div>${niveles.slice(1).reverse().map((n) => {
      const q = lista.filter((x) => x.niv === n);
      return `<h4>${esc(n.n)} <span class="badge">${q.length}</span></h4><p class="chico" style="margin:0 0 .8em">${q.length ? q.map((x) => `${esc(x.nombre)} (${x.horas} h)`).join(' · ') : '<span class="suave">Nadie</span>'}</p>`;
    }).join('')}
    <p class="suave chico">Cerca de subir de nivel: ${lista.filter((x) => { const i = niveles.indexOf(x.niv); return niveles[i + 1] && niveles[i + 1].min - x.horas <= 3; })
      .map((x) => `${esc(x.nombre)} (le faltan ${niveles[niveles.indexOf(x.niv) + 1].min - x.horas} h)`).join(' · ') || 'nadie'}.</p></div></div>`;
  const leer = () => niveles.map((n, i) => (i ? { n: n.n, min: Number($(`[data-niv-min="${i}"]`).value) || n.min, pct: Number($(`[data-niv-pct="${i}"]`).value) || 0 } : n));
  $$('#nu-niveles input').forEach((inp) => (inp.onchange = () => { const v = leer(); setTimeout(() => pintarNiveles(A, v), 0); }));
  $('#niv-reset').onclick = () => pintarNiveles(A, [{ n: 'Base', min: 0, pct: 0 }, { n: 'Frecuente', min: 8, pct: 5 }, { n: 'Destacado', min: 20, pct: 10 }]);
  $('#niv-guardar').onclick = async () => {
    const v = JSON.stringify(leer());
    const { data, error } = await sb.from('config').update({ valor: v }).eq('clave', 'niveles_volumen').select();
    if (error) return errorEn(null, error);
    if (!data?.length) return errorEn(null, 'No se pudo guardar: tu usuario no tiene permiso para cambiar este dato.');
    st.cfg.niveles_volumen = v;
    toast('Niveles guardados');
  };
}

// ---------- Arrastrar con el mouse para elegir varias horas seguidas ----------
// Se aprieta en un casillero libre, se arrastra hacia arriba o abajo (mismo día y consultorio) y al soltar se abre "Anotar".
const arrastre = { inicio: null, fin: null, recien: false };
function rangoArrastre() {
  if (!arrastre.inicio || !arrastre.fin) return [];
  const [d, c, h0] = arrastre.inicio.split('|');
  const h1 = Number(arrastre.fin.split('|')[2]);
  const paso = h1 >= Number(h0) ? 1 : -1;
  const out = [];
  for (let h = Number(h0); ; h += paso) {
    const b = document.querySelector(`#semana [data-anotar="${d}|${c}|${h}"]`);
    if (!b) break;                    // un casillero ocupado corta el rango
    out.push(b);
    if (h === h1) break;
  }
  return out;
}
function pintarArrastre() {
  $$('#semana .sc.arrastre').forEach((b) => { b.classList.remove('arrastre'); delete b.dataset.rango; });
  const r = rangoArrastre();
  if (r.length < 2) return;
  const hs = r.map((b) => Number(b.dataset.anotar.split('|')[2])).sort((a, b) => a - b);
  r.forEach((b) => b.classList.add('arrastre'));
  const primero = r.find((b) => Number(b.dataset.anotar.split('|')[2]) === hs[0]);
  primero.dataset.rango = `${hs[0]} a ${hs.at(-1) + 1} hs`;
}
$('#semana').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-anotar]');
  if (!b || e.pointerType !== 'mouse' || e.button !== 0) return;
  e.preventDefault();                 // que no se seleccione texto al arrastrar
  arrastre.inicio = arrastre.fin = b.dataset.anotar;
});
document.addEventListener('pointermove', (e) => {
  if (!arrastre.inicio) return;
  const b = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-anotar]');
  if (!b) return;
  const [d, c] = arrastre.inicio.split('|');
  if (!b.dataset.anotar.startsWith(`${d}|${c}|`) || b.dataset.anotar === arrastre.fin) return;
  arrastre.fin = b.dataset.anotar;
  pintarArrastre();
});
document.addEventListener('pointerup', () => {
  if (!arrastre.inicio) return;
  const r = rangoArrastre();
  arrastre.inicio = arrastre.fin = null;
  pintarArrastre();
  if (r.length < 2) return;           // fue un clic común: lo maneja el clic del casillero
  arrastre.recien = true;
  setTimeout(() => { arrastre.recien = false; }, 400);
  const hs = r.map((b) => Number(b.dataset.anotar.split('|')[2])).sort((a, b) => a - b);
  const [d, c] = r[0].dataset.anotar.split('|');
  modalAnotar({ fecha: d, consultorio: Number(c), hora: hs[0], horas: hs.length });
});

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

function modalAnotar({ fecha, consultorio, hora, liberado, horas: horasIniciales = 1 }) {
  const c = st.consultorios.find((x) => x.id === consultorio);
  const cierre = Number(st.cfg.hora_cierre || 21);
  const libreEn = (h) => h < cierre && (!datosSemana.mapa.get(`${fecha}|${consultorio}|${h}`) || datosSemana.mapa.get(`${fecha}|${consultorio}|${h}`).tipo === 'liberado');
  const maxHoras = (() => { let n = 0; while (n < 13 && libreEn(hora + n)) n++; return n; })();
  const opcionesHoras = [...new Set([1, 2, 3, 4, horasIniciales])].sort((a, b) => a - b);
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
        <input id="a-wa" inputmode="tel" placeholder="Ej: 11 2345 6789">
        <div class="ayuda" id="a-wa-ayuda">Es alguien nuevo: con el WhatsApp queda guardado para la próxima.</div>
      </div>
      <div class="campo">
        <label>¿Cuántas horas?</label>
        <div class="grupo-grande" id="a-horas">${opcionesHoras.map((n) => `<button type="button" class="chip" data-n="${n}" aria-pressed="${n === horasIniciales}" ${n > maxHoras ? 'disabled title="Esas horas ya están ocupadas o es la hora de cierre"' : ''}>${n}</button>`).join('')}</div>
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
      <div class="oculto" id="a-medio-campo">
        ${campoRecibio('a-recibio')}
        <div class="campo"><label for="a-medio">¿Cómo pagó?</label><select id="a-medio">${medioOpts('transferencia')}</select></div>
      </div>
      <div class="campo"><label for="a-coment">Comentario (opcional)</label>
        <textarea id="a-coment" rows="2" maxlength="1000" placeholder="Algo a tener en cuenta (ej: necesita camilla)"></textarea></div>
      <div id="a-error" class="aviso aviso-error oculto" role="alert"></div>
      <button class="btn btn-acento btn-bloque" id="a-guardar" style="min-height:56px;font-size:1.1rem">Anotar</button>
    </form>`);

  let horasN = Math.min(horasIniciales, Math.max(maxHoras, 1)), pago = 'nada', persona = null;
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
    const nuevo = q.length >= 2 && (!persona || !persona.whatsapp);
    $('#a-wa-campo').classList.toggle('oculto', !nuevo);
    $('#a-wa').required = nuevo;
    $('#a-wa-ayuda').textContent = coinciden.length > 1 ? `Hay ${coinciden.length} personas con ese nombre: anotá su WhatsApp para saber cuál es.`
      : persona ? 'Todavía no tenemos su WhatsApp: anotalo una vez y queda guardado.'
      : 'Es alguien nuevo: con el WhatsApp queda guardado para la próxima.';
    $('#a-quien').innerHTML = persona ? `<span class="quien-ok">✓ ${esc(persona.nombre)}</span>${persona.whatsapp ? ' · WhatsApp ' + esc(persona.whatsapp) : ''}`
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
  const recibio = conectarRecibio('a-recibio');
  actualizar();
  if (maxHoras === 0) errorEn($('#a-error'), 'Ese horario ya está ocupado.');

  $('#form-anotar').onsubmit = async (e) => {
    e.preventDefault();
    buscarPersona();
    const nombre = persona?.nombre || $('#a-nombre').value.trim();
    const whatsapp = persona?.whatsapp || $('#a-wa').value;
    if (nombre.length < 2) return errorEn($('#a-error'), 'Escribí el nombre.');
    if (!persona?.whatsapp && whatsapp.replace(/\D/g, '').length < 8) { $('#a-wa').focus(); return errorEn($('#a-error'), 'Anotá su WhatsApp (al menos 8 números).'); }
    const t = total();
    const monto = pago === 'todo' ? t : pago === 'sena' ? sena(t) : 0;
    if (monto > 0 && faltaRecibio(recibio())) return errorEn($('#a-error'), 'Elegí a quién le pagaron.');
    const horas = Array.from({ length: horasN }, (_, i) => hora + i);
    const btn = $('#a-guardar');
    btn.disabled = true; btn.textContent = 'Anotando…';
    try {
      const id = await llamar('cargar_reserva', {
        p_nombre: nombre, p_whatsapp: whatsapp, p_consultorio: consultorio, p_fecha: fecha,
        p_horas: horas, p_monto_pagado: monto, p_medio: $('#a-medio').value,
      });
      if ($('#a-coment').value.trim()) {
        try { await llamar('guardar_comentario', { p_texto: $('#a-coment').value, p_reserva_id: id }); }
        catch (err) { toast('Se anotó, pero no se guardó el comentario: ' + mensajeError(err)); }
      }
      if (monto > 0 && recibio()) {
        try { await llamar('marcar_quien_recibio', { p_recibio: recibio(), p_reserva_id: id }); }
        catch (err) { toast('Se anotó, pero no se guardó a quién le pagaron: ' + mensajeError(err)); }
      }
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
      return f ? `${f.nombre || ''} (${claseSemana(f)[1]})${f.tipo !== 'liberado' && f.detalle ? ' - ' + f.detalle : ''}` : '';
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

      ${r.motivo_cancelacion ? `<li><span>Motivo</span><span>${esc(r.motivo_cancelacion)}</span></li>` : ''}
      <li><span>Origen</span><span>${r.origen === 'web' ? 'Web' : 'Cargada en el panel' + (st.equipo.find((e) => e.user_id === r.creado_por) ? ' por ' + esc(st.equipo.find((e) => e.user_id === r.creado_por).nombre) : '')}</span></li>
      ${r.pedido_id ? `<li><span>Pedido</span><span>#${r.pedido_id}${pedidoN > 1 ? ` · ${pedidoN} días en el mismo pedido` : ''}</span></li>` : ''}
    </ul>
    ${bloqueComentario(r.comentario)}
    <div id="compartir"></div>
    ${(pagos || []).length ? `<h3>Pagos</h3><ul class="datos">${pagos.map((p) => `<li><span>${fechaCorta(p.pagado_en)} · ${esc(nombreMedio(p.medio))}${p.recibio ? ` · le pagaron a ${esc(p.recibio)}` : ''}${p.anulado ? ' · <s>anulado</s>' : ''}</span>
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
      ${campoRecibio('pg-recibio')}
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
  conectarComentario({ p_reserva_id: r.id });
  compartirReserva(r, pagado);
  const recibioPago = conectarRecibio('pg-recibio');
  $('#form-pago')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (faltaRecibio(recibioPago())) return errorEn(errEl, 'Elegí a quién le pagaron.');
    try {
      const pagoId = await llamar('registrar_pago', { p_monto: Number($('#pg-monto').value), p_medio: $('#pg-medio').value, p_reserva_id: r.id }, 'Pago registrado');
      if (recibioPago()) await llamar('marcar_quien_recibio', { p_recibio: recibioPago(), p_pago_id: pagoId });
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

      ${esSolicitud && f.pago_inicial ? `<li><span>Primer mes a pagar</span><span>${pesos(f.pago_inicial)} (al pagarlo se activa solo)</span></li>` : ''}
      ${!esSolicitud ? `<li><span>Pagado ${periodo}</span><span>${pesos(pagadoMes)} de ${pesos(f.precio_semanal * veces)} (${veces} semanas)</span></li>` : ''}
    </ul>
    ${bloqueComentario(f.comentario, 'Vale para todas las semanas de este fijo.')}
    <div id="compartir"></div>
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
        ${campoRecibio('pf-recibio')}
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
  conectarComentario({ p_fijo_id: f.id });
  if (f.estado === 'activo') pintarCompartir(textoFijo(f), f.profesionales.whatsapp);
  const recibioFijo = conectarRecibio('pf-recibio');
  $('#form-pago-fijo')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (faltaRecibio(recibioFijo())) return errorEn(errEl, 'Elegí a quién le pagaron.');
    try {
      const pagoId = await llamar('registrar_pago', { p_monto: Number($('#pf-monto').value), p_medio: $('#pf-medio').value, p_fijo_id: f.id, p_periodo: $('#pf-periodo').value }, 'Pago registrado');
      if (recibioFijo()) await llamar('marcar_quien_recibio', { p_recibio: recibioFijo(), p_pago_id: pagoId });
      cerrarModal(); refrescar();
    } catch (err) { errorEn(errEl, err); }
  });
}

// ================================================================ ALTAS
function datalistProfesionales() {
  return `<datalist id="dl-prof">${st.profesionales.map((p) => `<option value="${esc(p.whatsapp)}">${esc(p.nombre)}</option>`).join('')}</datalist>`;
}
function camposPersona() {
  return `${datalistProfesionales()}
    <div class="fila2">
      <div class="campo"><label for="n-wa">WhatsApp</label><input id="n-wa" list="dl-prof" inputmode="tel" required placeholder="1123456789">
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
      ${vigente ? (c.es_fijo ? `<div>Horario fijo · primer mes: <strong>${pesos(c.falta_total)}</strong></div>`
        : `<div>Seña: <strong>${pesos(c.falta_sena)}</strong> · Total: <strong>${pesos(c.falta_total)}</strong></div>`)
        : '<p class="aviso aviso-alerta chico">Las reservas de este pedido ya no están vigentes (vencidas o pagas). Si corresponde, cargalas de nuevo desde "+ Reserva".</p>'}
      <div class="acciones">
        ${vigente && c.falta_sena > 0 && c.falta_sena < c.falta_total ? `<button class="btn btn-acento btn-chico" data-comp-sena="${i}">Aceptar: pagó la seña ${pesos(c.falta_sena)}</button>` : ''}
        ${vigente ? `<button class="btn btn-acento btn-chico" data-comp-total="${i}">Aceptar: pagó ${c.es_fijo ? 'el mes' : 'todo'} ${pesos(c.falta_total)}</button>` : ''}
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
  $$('[data-comp-total]').forEach((b) => (b.onclick = async () => {
    const c = lista[b.dataset.compTotal];
    if (await preguntar({ titulo: `¿Registrar el pago de ${pesos(c.falta_total)}?`, texto: `${c.es_fijo ? 'Se activa el horario fijo del' : 'Queda todo pago el'} pedido #${c.pedido_id} de ${c.nombre}. Confirmalo solo si viste la transferencia en la cuenta.`, aceptar: 'Registrar pago' }) === null) return;
    revisar(c, true, c.falta_total, null, c.es_fijo ? 'Pago registrado: fijo activo' : 'Pago registrado: pedido confirmado y pago');
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

// Alertas de pago: lo que falta cobrar y ya está en plazo o vencido. Nunca se cancela nada solo.
const GRAVEDAD = { vencida: ['pill-error', 'Vencido'], hoy: ['pill-alerta', 'Vence hoy'], pendiente: ['pill-info', 'Pendiente'] };
function textoAlertaWa(x) {
  const n = x.nombre.split(' ')[0];
  const alias = st.cfg.alias_transferencia && st.cfg.alias_transferencia !== 'COMPLETAR' ? ` Alias: ${st.cfg.alias_transferencia}.` : '';
  const turno = `${fechaLarga(x.fecha_turno)} (${rangos(x.horas)})`;
  if (x.tipo === 'sena') return `Hola ${n}! Te escribimos de Psico Studios por tu reserva del ${turno}. Para confirmarla falta la seña de ${pesos(x.falta)}.${alias}`;
  if (x.tipo === 'saldo') return `Hola ${n}! Te escribimos de Psico Studios por tu reserva del ${turno}. Te recordamos que el saldo de ${pesos(x.falta)} se paga hasta el ${fechaLarga(x.fecha_limite)}.${alias}`;
  if (x.tipo === 'fijo_inicial') return `Hola ${n}! Te escribimos de Psico Studios por tu horario fijo de los ${DIAS[x.dia_semana].toLowerCase()} (${rangos(x.horas)}). Para confirmarlo falta pagar el primer mes: ${pesos(x.falta)}.${alias}`;
  return `Hola ${n}! Te escribimos de Psico Studios por tu horario fijo de los ${DIAS[x.dia_semana].toLowerCase()} (${rangos(x.horas)}). Te recordamos que falta pagar el mes ${x.periodo}: ${pesos(x.falta)}.${alias}`;
}
function pintarAlertas(cont, lista) {
  if (!lista.length) { cont.innerHTML = '<p class="suave">No hay pagos atrasados ni por vencer. 🎉</p>'; return; }
  const tieneWa = (w) => /^\d{8,}$/.test(String(w || ''));
  cont.innerHTML = lista.map((x, i) => {
    const [clase, etiqueta] = GRAVEDAD[x.gravedad] || GRAVEDAD.pendiente;
    const esFijo = x.tipo.startsWith('fijo');
    const que = esFijo ? `Todos los ${DIAS[x.dia_semana].toLowerCase()} · ${rangos(x.horas)} · ${x.consultorio}`
      : `${fechaLarga(x.fecha_turno)} · ${rangos(x.horas)} · ${x.consultorio}`;
    return `<div class="item alerta-pago alerta-${esc(x.gravedad)}">
      <div class="alerta-cab"><span class="pill ${clase}">${etiqueta}</span><strong>${esc(x.texto)}: ${pesos(x.falta)}</strong></div>
      <h3>${esc(x.nombre)}</h3>
      <div class="suave chico">${esc(que)}</div>
      <div class="chico" style="margin-top:.3em">Plazo: hasta el ${esc(fechaLarga(x.fecha_limite))}${x.tipo === 'sena' && x.total > x.falta ? ` · total ${pesos(x.total)}` : ''}</div>
      <div class="acciones">
        <button class="btn btn-acento btn-chico" data-cobrar="${i}">Registrar pago</button>
        <button class="btn btn-borde btn-chico" data-alerta="${i}">Ver · cancelar</button>
        ${tieneWa(x.whatsapp) ? `<a class="btn btn-wa btn-chico" target="_blank" rel="noopener" href="${waLink(x.whatsapp, textoAlertaWa(x))}">Recordar desde mi WhatsApp</a>
          ${st.cfg.asistente_activo !== undefined ? `<button class="btn btn-borde btn-chico" data-recordar="${i}">Que lo mande el asistente</button>` : ''}`
          : '<span class="suave chico">Sin WhatsApp cargado</span>'}
      </div>
    </div>`;
  }).join('');
  $$('[data-cobrar]', cont).forEach((b) => (b.onclick = () => cobrarAlerta(lista[b.dataset.cobrar])));
  $$('[data-recordar]', cont).forEach((b) => (b.onclick = () => recordarConAsistente(lista[b.dataset.recordar])));
  $$('[data-alerta]', cont).forEach((b) => (b.onclick = () => {
    const x = lista[b.dataset.alerta];
    if (x.reserva_id) detalleReserva(x.reserva_id); else detalleFijo(x.fijo_id, null, false);
  }));
}

// El equipo autoriza que el asistente mande el recordatorio (y atienda la respuesta)
function recordarConAsistente(x) {
  const esFijo = x.tipo.startsWith('fijo');
  const detalle = esFijo ? `tu horario fijo de los ${DIAS[x.dia_semana].toLowerCase()} (${rangos(x.horas)})` : `tu reserva del ${fechaLarga(x.fecha_turno)} (${rangos(x.horas)})`;
  abrirModal(`<h2 id="modal-titulo">Recordatorio de pago</h2>
    <p class="suave chico">Lo manda el asistente por WhatsApp a <strong>${esc(x.nombre)}</strong>. Si responde, el asistente la atiende (comprobante, dudas).</p>
    <div class="campo"><label for="rec-texto">Mensaje</label><textarea id="rec-texto" rows="5" maxlength="1500">${esc(textoAlertaWa(x))}</textarea></div>
    <p class="aviso aviso-info chico">Si no escribió en las últimas 24 hs, WhatsApp no deja mandar texto libre: se manda el texto aprobado por Meta
      (“Hola ${esc(x.nombre.split(' ')[0])}, te escribimos de Psico Studios por ${esc(detalle)}. Tenés pendiente ${pesos(x.falta)}…”).</p>
    <div id="rec-error" class="aviso aviso-error oculto" role="alert"></div>
    <div class="acciones"><button class="btn btn-primario" id="rec-enviar">Enviar</button><button class="btn btn-borde" id="rec-cancelar">Cancelar</button></div>`);
  $('#rec-cancelar').onclick = cerrarModal;
  $('#rec-enviar').onclick = async () => {
    $('#rec-enviar').disabled = true;
    const { data, error } = await sb.functions.invoke('asistente-whatsapp', { body: { accion: 'recordar_pago', whatsapp: x.whatsapp, nombre: x.nombre,
      texto: $('#rec-texto').value, detalle, monto: x.falta } });
    if (error) { $('#rec-enviar').disabled = false; return errorEn($('#rec-error'), await errorDeFuncion(error)); }
    cerrarModal();
    toast(data.ok ? (data.como === 'plantilla' ? 'Enviado (con el texto aprobado por Meta)' : 'Enviado por WhatsApp') : `No se pudo enviar: ${data.envio}`);
  };
}

// Registrar el pago de una alerta (ej: el comprobante llegó por WhatsApp)
function cobrarAlerta(x) {
  const esFijo = x.tipo.startsWith('fijo');
  const que = esFijo ? `Todos los ${DIAS[x.dia_semana].toLowerCase()} · ${rangos(x.horas)} · ${x.consultorio}`
    : `${fechaLarga(x.fecha_turno)} · ${rangos(x.horas)} · ${x.consultorio}`;
  const opciones = x.tipo === 'sena' && x.total > x.falta ? [['La seña', x.falta], ['Todo', x.total]]
    : [[{ sena: 'La seña', saldo: 'El saldo', fijo_inicial: 'El primer mes', fijo_mes: `El mes ${x.periodo || ''}` }[x.tipo], x.falta]];
  abrirModal(`<h2 id="modal-titulo">Registrar pago</h2>
    <p style="margin:0"><strong>${esc(x.nombre)}</strong></p>
    <p class="suave chico" style="margin-top:.2em">${esc(que)}</p>
    <div class="campo"><label>¿Qué pagó?</label><div class="grupo-grande" id="ca-monto">${opciones.map(([t, m], i) =>
      `<button type="button" class="chip" data-monto-alerta="${m}" aria-pressed="${i === 0}">${esc(t)} · ${pesos(m)}</button>`).join('')}</div></div>
    <div class="campo"><label for="ca-medio">Medio</label><select id="ca-medio">${medioOpts('transferencia')}</select></div>
    ${campoRecibio('ca-recibio')}
    <p class="ayuda">Registralo solo si viste la plata en la cuenta.</p>
    <div id="ca-error" class="aviso aviso-error oculto" role="alert"></div>
    <button class="btn btn-acento btn-bloque" id="ca-ok">Registrar pago</button>`);
  let monto = opciones[0][1];
  $$('[data-monto-alerta]').forEach((b) => (b.onclick = () => {
    monto = Number(b.dataset.montoAlerta);
    $$('[data-monto-alerta]').forEach((y) => y.setAttribute('aria-pressed', y === b));
  }));
  const recibio = conectarRecibio('ca-recibio');
  const errEl = $('#ca-error');
  $('#ca-ok').onclick = async () => {
    if (faltaRecibio(recibio())) return errorEn(errEl, 'Elegí a quién le pagaron.');
    const medio = $('#ca-medio').value;
    const b = $('#ca-ok');
    b.disabled = true;
    try {
      let pagoId = null;
      if (x.reserva_id) {
        pagoId = await llamar('registrar_pago', { p_monto: monto, p_medio: medio, p_reserva_id: x.reserva_id }, 'Pago registrado');
      } else if (x.tipo === 'fijo_inicial' && x.pedido_id) {
        await llamar('registrar_pago_pedido', { p_pedido_id: x.pedido_id, p_monto: monto, p_medio: medio }, 'Pago registrado: fijo activo');
        const { data } = await sb.from('pagos').select('id').eq('fijo_id', x.fijo_id).order('id', { ascending: false }).limit(1);
        pagoId = data?.[0]?.id || null;
      } else {
        pagoId = await llamar('registrar_pago', { p_monto: monto, p_medio: medio, p_fijo_id: x.fijo_id,
          p_periodo: x.periodo || String(x.fecha_turno).slice(0, 7) }, 'Pago registrado');
        if (x.tipo === 'fijo_inicial') await llamar('aprobar_fijo', { p_fijo_id: x.fijo_id });
      }
      if (recibio() && pagoId) await llamar('marcar_quien_recibio', { p_recibio: recibio(), p_pago_id: pagoId });
      cerrarModal(); refrescar();
    } catch (err) { b.disabled = false; errorEn(errEl, err); }
  };
}

async function pintarPendientes() {
  pintarComprobantes();
  pintarPagosRevisar();
  const la = $('#lista-alertas'), ls = $('#lista-sol');
  la.innerHTML = ls.innerHTML = '<div class="cargando">Cargando…</div>';
  const [a, f] = await Promise.all([
    sb.rpc('alertas_pago'),
    sb.from('fijos').select('*, profesionales(nombre, whatsapp), consultorios(nombre)').eq('estado', 'solicitud').order('creado_en'),
  ]);
  if (a.error || f.error) { errorEn(null, a.error || f.error); return; }
  pintarAlertas(la, a.data || []);

  ls.innerHTML = f.data.length ? f.data.map((x) => `
    <div class="item">
      <h3>${esc(x.profesionales.nombre)}</h3>
      <div class="suave chico">Todos los ${DIAS[x.dia_semana].toLowerCase()} · ${esc(rangos(x.horas))} · ${esc(x.consultorios.nombre)}</div>
      <div style="margin-top:.5em">Desde ${esc(fechaLarga(x.desde))} · ${pesos(x.precio_semanal)}/semana
</div>
      ${x.pago_inicial ? `<div class="chico" style="margin-top:.3em">Pidió por la web: esperando que pague el primer mes (<strong>${pesos(x.pago_inicial)}</strong>). Al pagarlo queda activo solo.</div>` : ''}
      <div class="acciones"><button class="btn btn-acento btn-chico" data-fijo="${x.id}">Ver y aprobar</button></div>
    </div>`).join('') : '<p class="suave">No hay solicitudes de fijo.</p>';

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

// ================================================================ COPIA DE SEGURIDAD
// Lee todo de a tandas (la base entrega hasta 1000 filas por vez)
async function leerTodo(tabla, campos = '*', orden = 'id') {
  const filas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await sb.from(tabla).select(campos).order(orden).range(desde, desde + 999);
    if (error) throw error;
    filas.push(...(data || []));
    if (!data || data.length < 1000) return filas;
  }
}
const nombreDe = (o) => o?.nombre ?? '';
async function bajarCopia() {
  const b = $('#btn-copia'), est = $('#copia-estado');
  b.disabled = true;
  est.textContent = 'Juntando la información…';
  try {
    const [reservas, fijos, pagos, profesionales, bloqueos, excepciones, notas, precios, equipo, consultorios] = await Promise.all([
      leerTodo('reservas', '*, profesionales(nombre, whatsapp), consultorios(nombre)'),
      leerTodo('fijos', '*, profesionales(nombre, whatsapp), consultorios(nombre)'),
      leerTodo('pagos'),
      leerTodo('profesionales'),
      leerTodo('bloqueos'),
      leerTodo('fijo_excepciones', '*', 'fecha'),
      leerTodo('notas_semana'),
      leerTodo('precios'),
      leerTodo('equipo', '*', 'nombre'),
      leerTodo('consultorios'),
    ]);
    est.textContent = 'Armando el Excel…';
    const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
    const cons = (id) => consultorios.find((c) => c.id === id)?.nombre || id;
    const prof = (id) => profesionales.find((p) => p.id === id)?.nombre || '';
    const pagadoReserva = (id) => pagos.filter((p) => p.reserva_id === id && !p.anulado).reduce((s, p) => s + p.monto, 0);
    const reservaDe = (id) => reservas.find((r) => r.id === id);
    const fijoDe = (id) => fijos.find((f) => f.id === id);
    const hojas = {
      Reservas: reservas.map((r) => ({ ID: r.id, Fecha: r.fecha, Horario: rangos(r.horas || []), Consultorio: nombreDe(r.consultorios),
        Profesional: nombreDe(r.profesionales), WhatsApp: r.profesionales?.whatsapp || '', Estado: r.estado, Origen: r.origen,
        'Tipo (Excel)': r.tipo_excel || '', Total: r.precio_total, Pagado: pagadoReserva(r.id), Falta: r.precio_total - pagadoReserva(r.id),
        Comentario: r.comentario || '', Pedido: r.pedido_id || '', 'Cargada el': r.creado_en || '' })),
      Fijos: fijos.map((f) => ({ ID: f.id, Profesional: nombreDe(f.profesionales), WhatsApp: f.profesionales?.whatsapp || '',
        Día: DIAS[f.dia_semana], Horario: rangos(f.horas || []), Consultorio: nombreDe(f.consultorios), 'Por semana': f.precio_semanal,
        Estado: f.estado, Desde: f.desde, Hasta: f.hasta || '', Comentario: f.comentario || '' })),
      Pagos: pagos.map((p) => {
        const r = p.reserva_id ? reservaDe(p.reserva_id) : null;
        const f = p.fijo_id ? fijoDe(p.fijo_id) : null;
        return { ID: p.id, Fecha: p.pagado_en, Monto: p.monto, Medio: p.medio, 'Le pagaron a': p.recibio || '', Anulado: p.anulado ? 'sí' : '',
          Profesional: nombreDe(r?.profesionales) || nombreDe(f?.profesionales), Es: r ? `Reserva del ${r.fecha}` : f ? `Fijo · mes ${p.periodo}` : '',
          Reserva: p.reserva_id || '', Fijo: p.fijo_id || '', 'Mercado Pago': p.mp_payment_id || '' };
      }),
      Profesionales: profesionales.map((p) => ({ ID: p.id, Nombre: p.nombre, WhatsApp: /^\d+$/.test(p.whatsapp || '') ? p.whatsapp : '',
        Mail: p.email || '', Profesión: p.profesion || '', Origen: p.origen || '', Notas: p.notas || '' })),
      Bloqueos: bloqueos.map((x) => ({ Fecha: x.fecha, Consultorio: cons(x.consultorio_id), Desde: `${x.hora_desde}:00`, Hasta: `${x.hora_hasta}:00`, Motivo: x.motivo || '' })),
      'Fijos que no vienen': excepciones.map((e) => ({ Fecha: e.fecha, Profesional: prof(fijoDe(e.fijo_id)?.profesional_id), Fijo: e.fijo_id, Motivo: e.motivo || '' })),
      Notas: notas.map((n) => ({ Semana: n.semana, Nota: n.texto, Autor: n.autor_nombre || '' })),
      Precios: precios.map((p) => ({ Tipo: p.modalidad === 'fijo' ? 'Fijo' : 'Por horas', Franja: p.franja === 'manana' ? 'Mañana' : 'Tarde', 'Precio por hora': p.valor, 'Desde': p.vigente_desde })),
      Equipo: equipo.map((e) => ({ Nombre: e.nombre, Mail: e.email || '', Rol: e.rol === 'admin' ? 'Administrador' : 'Equipo', Activo: e.activo === false ? 'no' : 'sí' })),
    };
    const libro = XLSX.utils.book_new();
    for (const [nombre, filas] of Object.entries(hojas)) {
      const hoja = XLSX.utils.json_to_sheet(filas.length ? filas : [{ '(sin datos)': '' }]);
      hoja['!cols'] = Object.keys(filas[0] || { x: 1 }).map((k) => ({ wch: Math.min(40, Math.max(10, k.length + 2)) }));
      XLSX.utils.book_append_sheet(libro, hoja, nombre.slice(0, 31));
    }
    const archivo = `psicostudios-copia-${hoyAR()}.xlsx`;
    XLSX.writeFile(libro, archivo);
    est.textContent = `✓ Listo: se bajó "${archivo}" (${reservas.length} reservas, ${fijos.length} fijos, ${pagos.length} pagos, ${profesionales.length} profesionales).`;
  } catch (err) {
    est.textContent = 'No se pudo bajar la copia: ' + mensajeError(err);
  } finally {
    b.disabled = false;
  }
}
$('#btn-copia').onclick = bajarCopia;

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
  ['mercadopago_activo', 'Cobrar con Mercado Pago (seña, total o primer mes del fijo)', 'sino'],
  ['avisos_email_activo', 'Avisos por mail a los profesionales', 'sino'],
  ['avisos_whatsapp_activo', 'Avisos por WhatsApp (requiere la API de WhatsApp Business)', 'sino'],
  ['porcentaje_sena', 'Seña para confirmar (%)', 'number'],
  ['retencion_suelta_minutos', 'Minutos para pagar (seña de horas sueltas o primer mes del fijo)', 'number'],
  ['hora_apertura', 'Hora de apertura', 'number'],
  ['hora_cierre', 'Hora de cierre', 'number'],
  ['hora_fin_manana', 'Desde qué hora rige precio de tarde', 'number'],
  ['meses_reserva_maximo', 'Meses hacia adelante que se puede reservar', 'number'],
  ['max_horas_por_reserva', 'Máximo de horas por reserva web', 'number'],
  ['min_horas_fijo_manana', 'Horario fijo: mínimo de horas por la mañana', 'number'],
  ['min_horas_fijo_tarde', 'Horario fijo: mínimo de horas seguidas por la tarde', 'number'],
  ['max_pendientes_por_whatsapp', 'Reservas sin pagar por persona (web)', 'number'],
  ['quienes_cobran', '¿A quién le pagan? (nombres separados por coma, ej: Silvia,Nico)', 'text'],
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

// ================================================================ CONTRASEÑAS
const ir_al_panel = () => location.origin + location.pathname;
const ocultarAviso = (el) => { el.classList.add('oculto'); el.textContent = ''; };

// "¿Olvidaste tu contraseña?"
$('#btn-olvide').onclick = () => {
  $('#form-login').classList.add('oculto');
  $('#form-olvide').classList.remove('oculto');
  const m = $('#l-usuario').value.trim();
  if (m.includes('@')) $('#o-mail').value = m;
  ocultarAviso($('#aviso-olvide'));
  $('#o-mail').focus();
};
$('#btn-olvide-volver').onclick = () => {
  $('#form-olvide').classList.add('oculto');
  $('#form-login').classList.remove('oculto');
};
$('#form-olvide').onsubmit = async (e) => {
  e.preventDefault();
  const mail = $('#o-mail').value.trim().toLowerCase();
  const aviso = $('#aviso-olvide');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) {
    aviso.className = 'aviso aviso-error'; aviso.textContent = 'Revisá el mail.'; return;
  }
  const btn = $('#btn-olvide-enviar');
  btn.disabled = true;
  const { error } = await sb.auth.resetPasswordForEmail(mail, { redirectTo: ir_al_panel() });
  btn.disabled = false;
  if (error && /rate|too many|seconds/i.test(error.message || '')) {
    aviso.className = 'aviso aviso-error'; aviso.textContent = 'Pediste varios links seguidos. Esperá unos minutos y probá de nuevo.'; return;
  }
  // Mismo mensaje exista o no el mail (así nadie puede averiguar quién tiene usuario)
  aviso.className = 'aviso aviso-ok';
  aviso.textContent = 'Si ese mail tiene usuario, te llegó un correo con un link para elegir una contraseña nueva. Revisá también la carpeta de spam.';
};

// Pantalla para elegir contraseña (invitación o recuperación)
function mostrarNuevaClave(tipo) {
  $('#login').classList.add('oculto');
  $('#app').classList.add('oculto');
  $('#nueva-clave').classList.remove('oculto');
  $('#nc-titulo').textContent = tipo === 'invite' ? '¡Bienvenido/a! Elegí tu contraseña' : 'Elegí tu contraseña nueva';
  setTimeout(() => $('#nc-1').focus(), 50);
}
function validarClave(a, b) {
  if (a.length < 10) return 'La contraseña tiene que tener 10 caracteres o más.';
  if (a !== b) return 'Las dos contraseñas no coinciden.';
  return null;
}
$('#form-nueva-clave').onsubmit = async (e) => {
  e.preventDefault();
  const aviso = $('#aviso-nc');
  const problema = validarClave($('#nc-1').value, $('#nc-2').value);
  if (problema) return errorEn(aviso, problema);
  const btn = $('#btn-nc');
  btn.disabled = true;
  const { error } = await sb.auth.updateUser({ password: $('#nc-1').value });
  btn.disabled = false;
  if (error) return errorEn(aviso, /weak|short|length/i.test(error.message || '') ? 'Esa contraseña es muy débil: probá con una más larga.' : error);
  $('#nc-1').value = $('#nc-2').value = '';
  history.replaceState(null, '', location.pathname);
  $('#nueva-clave').classList.add('oculto');
  toast('Contraseña guardada');
  await entrar();
};

// "Mi cuenta": cambiar la propia contraseña
$('#btn-cuenta').onclick = async () => {
  const { data } = await sb.auth.getSession();
  abrirModal(`
    <h2 id="modal-titulo">Mi cuenta</h2>
    <ul class="datos"><li><span>Nombre</span><span>${esc(st.yo?.nombre || '—')}</span></li>
      <li><span>Mail</span><span>${esc(data.session?.user?.email || '—')}</span></li>
      <li><span>Rol</span><span>${st.admin ? 'Administrador' : 'Equipo'}</span></li></ul>
    <form id="form-mi-clave" class="bloque" novalidate>
      <h3>Cambiar mi contraseña</h3>
      <div class="campo"><label for="mc-1">Contraseña nueva</label><input id="mc-1" type="password" autocomplete="new-password" minlength="10"></div>
      <div class="campo"><label for="mc-2">Repetila</label><input id="mc-2" type="password" autocomplete="new-password" minlength="10"></div>
      <p class="ayuda">10 caracteres o más.</p>
      <div id="mc-error" class="aviso aviso-error oculto" role="alert"></div>
      <button class="btn btn-primario btn-bloque">Guardar contraseña</button>
    </form>`);
  $('#form-mi-clave').onsubmit = async (e) => {
    e.preventDefault();
    const problema = validarClave($('#mc-1').value, $('#mc-2').value);
    if (problema) return errorEn($('#mc-error'), problema);
    const { error } = await sb.auth.updateUser({ password: $('#mc-1').value });
    if (error) return errorEn($('#mc-error'), error);
    cerrarModal();
    toast('Contraseña cambiada');
  };
};

// ================================================================ EQUIPO (solo administradores)
async function errorDeFuncion(error) {
  try { return (await error.context?.json?.()) || error; } catch { return error; }
}
async function pintarEquipo() {
  const cont = $('#eq-lista');
  let lista;
  try { lista = await llamar('equipo_lista', {}); } catch (err) { cont.innerHTML = ''; errorEn(null, err); return; }
  const { data: s } = await sb.auth.getSession();
  const yo = s.session?.user?.id;
  const fecha = (iso) => (iso ? new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', year: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires' }) : null);
  cont.innerHTML = `<table class="tabla"><thead><tr><th>Nombre</th><th>Mail</th><th>Rol</th><th>Último ingreso</th><th></th></tr></thead><tbody>
    ${lista.map((p) => `<tr class="${p.activo ? '' : 'eq-inactivo'}">
      <td><strong>${esc(p.nombre)}</strong>${p.user_id === yo ? ' <span class="pill pill-info">Vos</span>' : ''}${p.activo ? '' : ' <span class="pill pill-error">Desactivado</span>'}</td>
      <td>${esc(p.email || '—')}</td>
      <td>${p.rol === 'admin' ? 'Administrador' : 'Equipo'}</td>
      <td>${fecha(p.ultimo_ingreso) || '<span class="pill pill-alerta">Todavía no entró</span>'}</td>
      <td><div class="eq-acc">
        ${p.email ? `<button class="btn btn-borde btn-chico" data-eq-clave="${esc(p.email)}">Mandar mail para cambiar contraseña</button>` : ''}
        ${p.user_id !== yo ? `<button class="btn btn-borde btn-chico" data-eq-rol="${p.user_id}" data-rol="${p.rol === 'admin' ? 'equipo' : 'admin'}">${p.rol === 'admin' ? 'Pasar a equipo' : 'Hacer administrador'}</button>
        <button class="btn ${p.activo ? 'btn-peligro' : 'btn-borde'} btn-chico" data-eq-activo="${p.user_id}" data-activo="${!p.activo}" data-nombre="${esc(p.nombre)}">${p.activo ? 'Desactivar' : 'Reactivar'}</button>` : ''}
      </div></td></tr>`).join('')}</tbody></table>`;
  $$('[data-eq-clave]', cont).forEach((b) => (b.onclick = async () => {
    const { error } = await sb.auth.resetPasswordForEmail(b.dataset.eqClave, { redirectTo: ir_al_panel() });
    if (error) return errorEn(null, /rate|too many|seconds/i.test(error.message || '') ? 'Se mandaron varios mails seguidos. Esperá unos minutos.' : error);
    toast('Le mandamos el mail para cambiar la contraseña');
  }));
  $$('[data-eq-rol]', cont).forEach((b) => (b.onclick = async () => {
    try { await llamar('equipo_cambiar', { p_user_id: b.dataset.eqRol, p_rol: b.dataset.rol }, 'Rol cambiado'); pintarEquipo(); } catch (err) { errorEn(null, err); }
  }));
  $$('[data-eq-activo]', cont).forEach((b) => (b.onclick = async () => {
    const activar = b.dataset.activo === 'true';
    if (!activar && await preguntar({ titulo: `¿Desactivar a ${b.dataset.nombre}?`, texto: 'No va a poder entrar más al panel. Lo que cargó queda guardado. Se puede reactivar cuando quieras.', aceptar: 'Desactivar', peligro: true }) === null) return;
    try { await llamar('equipo_cambiar', { p_user_id: b.dataset.eqActivo, p_activo: activar }, activar ? 'Reactivado' : 'Desactivado'); pintarEquipo(); } catch (err) { errorEn(null, err); }
  }));
}
$('#form-invitar').onsubmit = async (e) => {
  e.preventDefault();
  const aviso = $('#aviso-invitar');
  ocultarAviso(aviso);
  const nombre = $('#eq-nombre').value.trim(), email = $('#eq-mail').value.trim().toLowerCase(), rol = $('#eq-rol').value;
  if (nombre.length < 2) return errorEn(aviso, 'Escribí el nombre.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return errorEn(aviso, 'Revisá el mail.');
  const btn = $('#btn-invitar');
  btn.disabled = true; btn.textContent = 'Mandando…';
  const { error } = await sb.functions.invoke('equipo-admin', { body: { nombre, email, rol } });
  btn.disabled = false; btn.textContent = 'Mandar invitación';
  if (error) return errorEn(aviso, await errorDeFuncion(error));
  $('#eq-nombre').value = $('#eq-mail').value = '';
  toast(`Invitación enviada a ${email}`);
  pintarEquipo();
};

// ================================================================ arranque
setInterval(() => { if (!$('#app').classList.contains('oculto') && $('#modal').classList.contains('oculto')) refrescar(); }, 60000);

asistente = crearAsistente({ sb, st, llamar, toast, errorEn, errorDeFuncion, preguntar });

const { data: { session } } = await sb.auth.getSession();
if (session && (tipoLink === 'invite' || tipoLink === 'recovery')) mostrarNuevaClave(tipoLink);
else if (session) await entrar();
else $('#login').classList.remove('oculto');

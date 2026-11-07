// Web pública de reservas (sin login).
import {
  crearCliente, esc, pesos, hoyAR, horaAR, sumarDias, diaSemana, fechaLarga, fechaCorta, horaTxt, rangos,
  faltan, precioHora, mensajeError, linkWhatsApp, DIAS, DIAS_CORTOS,
} from './comun.js';
import { WHATSAPP_AYUDA } from './config.js';

const $ = (s) => document.querySelector(s);

// Fotos (en img/consultorios). El número es el id del consultorio en la base.
const FOTOS = {
  1: { fotos: ['c1-a', 'c1-b'], texto: 'Con escritorio y sillas.' },
  2: { fotos: ['c2-a', 'c2-b'], texto: 'Con sofá y sillones.' },
  3: { fotos: ['c3-a', 'c3-b'], texto: 'Con sofá, sillones y ventanales.' },
  4: { fotos: ['c4-a', 'c4-b'], texto: 'Con sillones enfrentados y ventanales.' },
  5: { fotos: ['c5-a', 'c5-b'], texto: 'Con escritorio y sillones.' },
  6: { fotos: ['c6-a', 'c6-b'], texto: 'Con mesa redonda y escritorio: ideal para grupos, talleres o supervisiones.' },
};
const ESPACIOS = { nombre: 'Espacios comunes', fotos: ['espacio-a', 'espacio-c', 'espacio-b'], texto: 'Recepción y sala de espera, en un edificio de pleno Microcentro.' };
const rutaFoto = (f, chica) => `img/consultorios/${f}${chica ? '-chica' : ''}.jpg`;
const sb = await crearCliente();

const estado = {
  modo: 'suelta',
  cfg: {},
  precios: [],
  consultorios: [],
  // por horas
  fecha: null,
  mesVista: null,         // 'AAAA-MM' que muestra el calendario
  resumen: new Map(),     // fecha → { libres, total }
  libres: new Map(),      // hora → Set(consultorio_id)
  horas: new Set(),
  consultorio: null,      // null = cualquiera
  pedido: new Map(),      // fecha → { consultorio, horas[] }: todos los días elegidos
  vistaHoras: (() => { try { return localStorage.getItem('psicostudios-vista-horas') || 'grilla'; } catch { return 'grilla'; } })(),
  // fijo
  dia: null,
  desde: null,
  libresFijo: new Map(),
  horasFijo: new Set(),
};

// ---------------------------------------------------------------- inicio
async function cargarBase() {
  const [c, p, k] = await Promise.all([
    sb.from('config').select('clave, valor'),
    sb.from('precios').select('modalidad, franja, valor, vigente_desde'),
    sb.from('consultorios').select('id, nombre, orden, activo, online').order('orden'),
  ]);
  const error = c.error || p.error || k.error;
  if (error) throw error;
  estado.cfg = Object.fromEntries(c.data.map((r) => [r.clave, r.valor]));
  estado.precios = p.data;
  estado.consultorios = k.data.filter((x) => x.activo && x.online);

  document.querySelectorAll('[data-cfg]').forEach((el) => {
    const v = estado.cfg[el.dataset.cfg];
    if (v) el.textContent = v;
  });
  document.querySelectorAll('[data-ayuda]').forEach((a) => {
    a.href = linkWhatsApp(WHATSAPP_AYUDA, 'Hola! Tengo una consulta sobre la reserva de consultorios de Psico Studios.');
  });
  $('#wa-flotante').classList.remove('oculto');
  pintarPrecios();
}

function pintarPrecios() {
  const hoy = hoyAR();
  const hm = Number(estado.cfg.hora_apertura), ht = Number(estado.cfg.hora_fin_manana);
  const fila = (mod, nombre) => `<tr><th scope="row">${nombre}</th>
    <td>${pesos(precioHora(estado.precios, estado.cfg, mod, hm, hoy))}</td>
    <td>${pesos(precioHora(estado.precios, estado.cfg, mod, ht, hoy))}</td></tr>`;
  $('#tabla-precios').innerHTML = fila('suelta', 'Por horas') + fila('fijo', 'Horario fijo');
}

const mostrarError = (msg) => {
  const el = $('#aviso-general');
  el.innerHTML = msg ? `${esc(msg)} <a data-ayuda target="_blank" rel="noopener" href="${linkWhatsApp(WHATSAPP_AYUDA, 'Hola! Tengo un problema con la web de reservas: ' + msg)}">¿Necesitás ayuda? Escribinos</a>` : '';
  el.classList.toggle('oculto', !msg);
};

// ---------------------------------------------------------------- pestañas
function cambiarModo(modo) {
  estado.modo = modo;
  $('#tab-suelta').setAttribute('aria-selected', modo === 'suelta');
  $('#tab-fijo').setAttribute('aria-selected', modo === 'fijo');
  $('#vista-suelta').classList.toggle('oculto', modo !== 'suelta');
  $('#vista-fijo').classList.toggle('oculto', modo !== 'fijo');
  mostrarError('');
  actualizarBarra();
}
$('#tab-suelta').onclick = () => cambiarModo('suelta');
$('#tab-fijo').onclick = () => cambiarModo('fijo');

// ================================================================ POR HORAS
const MESES_LARGOS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const mesMover = (ym, n) => { const [a, m] = ym.split('-').map(Number); return new Date(Date.UTC(a, m - 1 + n, 1)).toISOString().slice(0, 7); };

// Último día que se puede reservar: misma regla que la base (meses de calendario: 7/11 → 7/1)
function fechaMaxima() {
  const [a, m, d] = hoyAR().split('-').map(Number);
  const destino = new Date(Date.UTC(a, m - 1 + Number(estado.cfg.meses_reserva_maximo || 2), 1));
  const ultimoDelMes = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  destino.setUTCDate(Math.min(d, ultimoDelMes));
  return destino.toISOString().slice(0, 10);
}

// Cuántos lugares quedan cada día (para pintar el calendario)
async function cargarResumen() {
  const { data, error } = await sb.rpc('resumen_disponibilidad', { p_desde: hoyAR(), p_hasta: fechaMaxima() });
  if (error) { mostrarError(mensajeError(error)); return; }
  estado.resumen = new Map(data.map((r) => [r.fecha, r]));
}
function nivelDia(f) {
  const r = estado.resumen.get(f);
  if (!r) return null;
  if (r.libres === 0) return 'lleno';
  return r.libres / Math.max(1, r.total) < 0.25 ? 'poco' : 'mucho';
}
const primerDiaConLugar = () => [...estado.resumen.keys()].sort().find((f) => nivelDia(f) !== 'lleno');

function pintarCalendario() {
  const hoy = hoyAR(), max = fechaMaxima();
  const [a, m] = estado.mesVista.split('-').map(Number);
  $('#cal-mes').textContent = `${MESES_LARGOS[m - 1]} ${a}`;
  $('#cal-ant').disabled = estado.mesVista <= hoy.slice(0, 7);
  $('#cal-sig').disabled = estado.mesVista >= max.slice(0, 7);
  $('#fecha-max').textContent = fechaLarga(max).toLowerCase();
  const primero = `${estado.mesVista}-01`;
  const diasMes = new Date(Date.UTC(a, m, 0)).getUTCDate();
  let html = '<span aria-hidden="true"></span>'.repeat(diaSemana(primero) - 1);
  for (let d = 1; d <= diasMes; d++) {
    const f = `${estado.mesVista}-${String(d).padStart(2, '0')}`;
    const nivel = f < hoy || f > max ? null : nivelDia(f);
    const estadoTxt = diaSemana(f) === 7 ? 'cerrado' : !nivel ? 'no disponible' : { mucho: 'hay lugar', poco: 'queda poco lugar', lleno: 'completo' }[nivel];
    const enPedido = estado.pedido.has(f);
    html += `<button type="button" class="cal-dia ${nivel ? 'n-' + nivel : 'fuera'}${enPedido ? ' en-pedido' : ''}" data-f="${f}"
      ${(!nivel || nivel === 'lleno') && !enPedido ? 'disabled' : ''} aria-pressed="${f === estado.fecha}"
      aria-label="${fechaLarga(f)}: ${estadoTxt}${enPedido ? ', está en tu pedido' : ''}">${d}</button>`;
  }
  $('#cal-dias').innerHTML = html;
  $('#cal-dias').querySelectorAll('.cal-dia:not(:disabled)').forEach((b) => (b.onclick = () => elegirFecha(b.dataset.f, true)));
}
$('#cal-ant').onclick = () => { estado.mesVista = mesMover(estado.mesVista, -1); pintarCalendario(); };
$('#cal-sig').onclick = () => { estado.mesVista = mesMover(estado.mesVista, 1); pintarCalendario(); };

async function elegirFecha(f, desplazar = false) {
  estado.fecha = f;
  const guardado = estado.pedido.get(f);
  estado.horas = new Set(guardado?.horas || []);
  estado.consultorio = guardado?.consultorio ?? null;
  estado.mesVista = f.slice(0, 7);
  mostrarError('');
  pintarCalendario();
  $('#dia-elegido').textContent = fechaLarga(f);
  $('#horas-suelta').innerHTML = '<div class="cargando">Buscando horarios libres…</div>';
  if (desplazar) $('#paso-horas').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  const { data, error } = await sb.rpc('disponibilidad', { p_desde: f, p_hasta: f });
  if (error) { $('#horas-suelta').innerHTML = ''; mostrarError(mensajeError(error)); return; }
  estado.libres = new Map();
  for (const r of data) {
    if (!estado.libres.has(r.hora)) estado.libres.set(r.hora, new Set());
    estado.libres.get(r.hora).add(r.consultorio_id);
  }
  // si algo que estaba en el pedido para este día se ocupó mientras tanto, se saca
  const antes = estado.horas.size;
  for (const h of [...estado.horas]) {
    if (estado.consultorio ? !libreEn(h, estado.consultorio) : !estado.libres.get(h)?.size) estado.horas.delete(h);
  }
  if (estado.horas.size < antes) mostrarError(`Un horario que habías elegido para el ${fechaCorta(f)} se ocupó y lo sacamos de tu pedido.`);
  pintarHorasSuelta();
}

// Consultorios libres en TODAS las horas indicadas
function consultoriosComunes(libres, horas) {
  let set = null;
  for (const h of horas) {
    const s = libres.get(h) || new Set();
    set = set ? new Set([...set].filter((x) => s.has(x))) : new Set(s);
  }
  return set || new Set();
}
const libreEn = (h, c) => !!estado.libres.get(h)?.has(c);
const nombreCons = (id) => estado.consultorios.find((c) => c.id === id)?.nombre || '';
function horasVisibles() {
  const out = [];
  const hoy = hoyAR(), ahora = horaAR();
  for (let h = Number(estado.cfg.hora_apertura); h < Number(estado.cfg.hora_cierre); h++) {
    if (!(estado.fecha === hoy && h <= ahora)) out.push(h);
  }
  return out;
}

// Grilla o lista
document.querySelectorAll('[data-vista-h]').forEach((b) => (b.onclick = () => {
  estado.vistaHoras = b.dataset.vistaH;
  try { localStorage.setItem('psicostudios-vista-horas', estado.vistaHoras); } catch { /* sin almacenamiento */ }
  // la grilla siempre muestra un consultorio concreto
  if (estado.vistaHoras === 'grilla' && estado.horas.size && !estado.consultorio) {
    const comunes = [...consultoriosComunes(estado.libres, [...estado.horas])];
    estado.consultorio = estado.consultorios.find((c) => comunes.includes(c.id) && c.nombre !== 'Salón')?.id ?? comunes[0] ?? null;
  }
  pintarHorasSuelta();
}));

// Guarda la selección del día actual en el pedido
function sincronizarPedido() {
  if (!estado.fecha) return;
  const max = Number(estado.cfg.max_dias_por_pedido || 8);
  if (estado.horas.size && !estado.pedido.has(estado.fecha) && estado.pedido.size >= max) {
    estado.horas.clear();
    estado.consultorio = null;
    mostrarError(`Se pueden reservar hasta ${max} días por vez. Para más, escribinos.`);
    return;
  }
  if (estado.horas.size) estado.pedido.set(estado.fecha, { consultorio: estado.consultorio, horas: [...estado.horas].sort((a, b) => a - b) });
  else estado.pedido.delete(estado.fecha);
}
const totalDia = (f, horas) => horas.reduce((s, h) => s + precioHora(estado.precios, estado.cfg, 'suelta', h, f), 0);
const diasPedido = () => [...estado.pedido.entries()].sort(([a], [b]) => (a < b ? -1 : 1));

function pintarHorasSuelta() {
  sincronizarPedido();
  pintarCalendario();
  document.querySelectorAll('[data-vista-h]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.vistaH === estado.vistaHoras));
  const hs = horasVisibles();
  if (!hs.some((h) => estado.libres.get(h)?.size)) {
    $('#horas-suelta').innerHTML = '<p class="aviso aviso-alerta">No quedan horarios libres este día. Elegí otro día en el calendario.</p>';
  } else if (estado.vistaHoras === 'grilla') pintarGrilla(hs);
  else pintarLista(hs);
  pintarSeleccion();
  actualizarBarra();
}

function pintarGrilla(hs) {
  const cons = estado.consultorios;
  const corto = (n) => n.replace(/^Consultorio\s*/i, 'Cons.<br>');
  let html = `<div class="grilla-wrap"><table class="grilla-h"><caption class="oculto">Horarios libres por consultorio</caption>
    <thead><tr><th scope="col"><span class="oculto">Hora</span></th>${cons.map((c) => `<th scope="col" class="${estado.resaltar === c.id ? 'col-resaltada' : ''}">${FOTOS[c.id]
      ? `<button type="button" class="col-cons" data-fotos="${c.id}" aria-label="Ver fotos de ${esc(c.nombre)}">${corto(esc(c.nombre))}</button>` : corto(esc(c.nombre))}</th>`).join('')}</tr></thead><tbody>`;
  for (const h of hs) {
    html += `<tr><th scope="row">${horaTxt(h)}<small>${pesos(precioHora(estado.precios, estado.cfg, 'suelta', h, estado.fecha))}</small></th>`;
    for (const c of cons) {
      if (!libreEn(h, c.id)) { html += '<td><span class="celda-ocupada" role="img" aria-label="Ocupado"></span></td>'; continue; }
      const elegida = estado.consultorio === c.id && estado.horas.has(h);
      html += `<td><button type="button" class="celda-h" data-h="${h}" data-c="${c.id}" aria-pressed="${elegida}"
        aria-label="${esc(c.nombre)}, ${horaTxt(h)}: libre">${elegida ? '✓' : ''}</button></td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  $('#horas-suelta').innerHTML = html;
  estado.resaltar = null;
  $('#horas-suelta').querySelectorAll('[data-fotos]').forEach((b) => (b.onclick = () => abrirFotos(Number(b.dataset.fotos))));
  $('#horas-suelta').querySelectorAll('.celda-h').forEach((b) => (b.onclick = () => {
    const h = Number(b.dataset.h), c = Number(b.dataset.c);
    if (estado.consultorio !== c) { estado.horas.clear(); estado.consultorio = c; }
    estado.horas.has(h) ? estado.horas.delete(h) : estado.horas.add(h);
    if (!estado.horas.size) estado.consultorio = null;
    pintarHorasSuelta();
  }));
}

function pintarLista(hs) {
  const c = estado.consultorio;
  let html = '<div class="horas">';
  for (const h of hs) {
    const elegida = estado.horas.has(h);
    const libresH = c ? (libreEn(h, c) ? 1 : 0) : estado.libres.get(h)?.size || 0;
    const posible = elegida || (c ? libreEn(h, c) : consultoriosComunes(estado.libres, [...estado.horas, h]).size > 0);
    const sub = libresH === 0 ? (c ? 'Ocupado' : 'Completo') : !posible ? 'No combina' : pesos(precioHora(estado.precios, estado.cfg, 'suelta', h, estado.fecha));
    html += `<button type="button" class="hora" data-h="${h}" aria-pressed="${elegida}" ${posible && libresH ? '' : 'disabled'}
      aria-label="${horaTxt(h)}, ${sub}"><strong>${horaTxt(h)}</strong><small>${sub}</small></button>`;
  }
  html += '</div>';
  // Consultorio: siempre se puede volver a "cualquiera"
  const comunes = estado.horas.size ? consultoriosComunes(estado.libres, [...estado.horas])
    : new Set([...estado.libres.values()].flatMap((s) => [...s]));
  const opciones = estado.consultorios.filter((x) => comunes.has(x.id) || x.id === c);
  html += `<div class="campo" style="margin-top:14px;max-width:360px"><label for="consultorio-suelta">Consultorio</label>
    <select id="consultorio-suelta"><option value="">Cualquiera (te asignamos uno)</option>
    ${opciones.map((x) => `<option value="${x.id}" ${x.id === c ? 'selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select></div>`;
  $('#horas-suelta').innerHTML = html;
  $('#horas-suelta').querySelectorAll('.hora:not(:disabled)').forEach((b) => (b.onclick = () => {
    const h = Number(b.dataset.h);
    estado.horas.has(h) ? estado.horas.delete(h) : estado.horas.add(h);
    pintarHorasSuelta();
  }));
  $('#consultorio-suelta').onchange = (e) => {
    estado.consultorio = e.target.value ? Number(e.target.value) : null;
    // si alguna hora elegida no está libre en ese consultorio, se quita
    if (estado.consultorio) for (const h of [...estado.horas]) if (!libreEn(h, estado.consultorio)) estado.horas.delete(h);
    pintarHorasSuelta();
  };
}

function pintarSeleccion() {
  const el = $('#seleccion');
  const dias = diasPedido();
  if (!dias.length) {
    el.classList.remove('oculto');
    el.innerHTML = '<span class="suave">Tocá los horarios libres para armar tu pedido. Podés sumar varios días.</span>';
    return;
  }
  el.classList.remove('oculto');
  el.innerHTML = `<div class="pedido-cab"><strong>Tu pedido</strong><span>${dias.length === 1 ? '1 día' : `${dias.length} días`}</span></div>
    <ul class="pedido-lista">${dias.map(([f, it]) => `
      <li class="${f === estado.fecha ? 'actual' : ''}">
        <span><strong>${esc(fechaLarga(f))}</strong><br>${esc(rangos(it.horas))} · ${it.consultorio ? esc(nombreCons(it.consultorio)) : 'cualquier consultorio'} · ${pesos(totalDia(f, it.horas))}</span>
        <span class="pedido-acc">
          ${f !== estado.fecha ? `<button type="button" class="btn btn-borde btn-chico" data-ver-dia="${f}">Ver</button>` : ''}
          <button type="button" class="btn btn-peligro btn-chico" data-quitar-dia="${f}" aria-label="Quitar ${esc(fechaLarga(f))} del pedido">Quitar</button>
        </span>
      </li>`).join('')}</ul>
    <p class="ayuda" style="margin:.4em 0 0">¿Querés sumar otro día? Elegilo en el calendario: lo que ya elegiste queda guardado.</p>`;
  el.querySelectorAll('[data-ver-dia]').forEach((b) => (b.onclick = () => elegirFecha(b.dataset.verDia, true)));
  el.querySelectorAll('[data-quitar-dia]').forEach((b) => (b.onclick = () => {
    const f = b.dataset.quitarDia;
    estado.pedido.delete(f);
    if (f === estado.fecha) { estado.horas.clear(); estado.consultorio = null; }
    pintarHorasSuelta();
  }));
}

// ================================================================ FOTOS
function pintarGaleria() {
  const items = estado.consultorios.filter((c) => FOTOS[c.id]).map((c) => ({ id: c.id, nombre: c.nombre, ...FOTOS[c.id] }));
  items.push({ id: 'espacios', ...ESPACIOS });
  $('#galeria').innerHTML = items.map((x) => `<button type="button" class="card-cons" data-fotos="${x.id}">
      <img src="${rutaFoto(x.fotos[0], true)}" alt="" loading="lazy" width="640" height="427">
      <span><strong>${esc(x.nombre)}</strong><small>${esc(x.texto)}</small></span></button>`).join('');
  $('#galeria').querySelectorAll('[data-fotos]').forEach((b) => (b.onclick = () =>
    abrirFotos(b.dataset.fotos === 'espacios' ? 'espacios' : Number(b.dataset.fotos))));
}

function abrirFotos(id) {
  const datos = id === 'espacios' ? ESPACIOS : { ...FOTOS[id], nombre: nombreCons(id) };
  let i = 0;
  const mostrar = () => {
    $('#fotos-img').src = rutaFoto(datos.fotos[i]);
    $('#fotos-img').alt = `${datos.nombre}, foto ${i + 1} de ${datos.fotos.length}`;
    $('#fotos-minis').querySelectorAll('button').forEach((b, j) => b.setAttribute('aria-current', j === i));
  };
  $('#fotos-titulo').textContent = datos.nombre;
  $('#fotos-texto').textContent = id === 'espacios' ? datos.texto : `${datos.texto} Amplio, luminoso y con aire acondicionado.`;
  $('#fotos-minis').innerHTML = datos.fotos.map((f, j) =>
    `<button type="button" aria-label="Foto ${j + 1}"><img src="${rutaFoto(f, true)}" alt=""></button>`).join('');
  $('#fotos-minis').querySelectorAll('button').forEach((b, j) => (b.onclick = () => { i = j; mostrar(); }));
  $('#fotos-ant').onclick = () => { i = (i - 1 + datos.fotos.length) % datos.fotos.length; mostrar(); };
  $('#fotos-sig').onclick = () => { i = (i + 1) % datos.fotos.length; mostrar(); };
  $('#fotos-reservar').classList.toggle('oculto', id === 'espacios' || estado.modo !== 'suelta');
  $('#fotos-reservar').onclick = () => {
    cerrarVentanas();
    estado.vistaHoras = 'grilla';
    estado.resaltar = id;
    pintarHorasSuelta();
    $('#paso-horas').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  };
  mostrar();
  abrir('#modal-fotos');
}

// ================================================================ FIJO
function pintarDiasFijo() {
  $('#dias-fijo').innerHTML = [1, 2, 3, 4, 5, 6].map((d) =>
    `<button class="chip" data-dia="${d}" aria-pressed="${d === estado.dia}"><strong style="font-size:1rem">${DIAS[d]}</strong></button>`).join('');
  $('#dias-fijo').querySelectorAll('.chip').forEach((b) => (b.onclick = () => elegirDiaFijo(Number(b.dataset.dia))));
}

function elegirDiaFijo(d) {
  estado.dia = d;
  estado.desde = null;
  estado.horasFijo.clear();
  pintarDiasFijo();
  // próximas 6 fechas que caen ese día (desde mañana, para dar tiempo a confirmar)
  const fechas = [];
  let f = sumarDias(hoyAR(), 1);
  while (fechas.length < 6 && f <= fechaMaxima()) { if (diaSemana(f) === d) fechas.push(f); f = sumarDias(f, 1); }
  $('#inicio-fijo').innerHTML = fechas.map((x) => {
    const [, m, dd] = x.split('-');
    return `<button class="chip" data-f="${x}" aria-pressed="false" aria-label="${fechaLarga(x)}"><small>${DIAS_CORTOS[d]}</small><strong>${Number(dd)}/${Number(m)}</strong></button>`;
  }).join('');
  $('#inicio-fijo').querySelectorAll('.chip').forEach((b) => (b.onclick = () => elegirInicioFijo(b.dataset.f)));
  $('#paso-inicio-fijo').classList.remove('oculto');
  $('#paso-horas-fijo').classList.add('oculto');
  actualizarBarra();
}

async function elegirInicioFijo(f) {
  estado.desde = f;
  estado.horasFijo.clear();
  $('#inicio-fijo').querySelectorAll('.chip').forEach((b) => b.setAttribute('aria-pressed', b.dataset.f === f));
  $('#paso-horas-fijo').classList.remove('oculto');
  $('#horas-fijo').innerHTML = '<div class="cargando">Buscando horarios libres todas las semanas…</div>';
  const { data, error } = await sb.rpc('disponibilidad_fijo', { p_dia: estado.dia, p_desde: f });
  if (error) { $('#horas-fijo').innerHTML = ''; mostrarError(mensajeError(error)); return; }
  estado.libresFijo = new Map();
  for (const r of data) {
    if (!estado.libresFijo.has(r.hora)) estado.libresFijo.set(r.hora, new Set());
    estado.libresFijo.get(r.hora).add(r.consultorio_id);
  }
  pintarHorasFijo();
}

function bloquesValidos(horas) {
  const hs = [...horas].sort((a, b) => a - b);
  if (!hs.length) return false;
  let largo = 1;
  for (let i = 1; i <= hs.length; i++) {
    if (hs[i] === hs[i - 1] + 1) { largo++; continue; }
    if (largo < 2) return false;
    largo = 1;
  }
  return true;
}

function pintarHorasFijo() {
  const ini = Number(estado.cfg.hora_apertura), fin = Number(estado.cfg.hora_cierre);
  let html = '';
  for (let h = ini; h < fin; h++) {
    const elegida = estado.horasFijo.has(h);
    const libresH = estado.libresFijo.get(h)?.size || 0;
    const posible = elegida || consultoriosComunes(estado.libresFijo, [...estado.horasFijo, h]).size > 0;
    const precio = precioHora(estado.precios, estado.cfg, 'fijo', h, estado.desde);
    const sub = libresH === 0 ? 'Ocupado' : !posible ? 'No combina' : pesos(precio);
    html += `<button class="hora" data-h="${h}" aria-pressed="${elegida}" ${posible && libresH ? '' : 'disabled'}
      aria-label="${horaTxt(h)}, ${sub}"><strong>${horaTxt(h)}</strong><small>${sub}</small></button>`;
  }
  $('#horas-fijo').innerHTML = html;
  $('#horas-fijo').querySelectorAll('.hora:not(:disabled)').forEach((b) => (b.onclick = () => {
    const h = Number(b.dataset.h);
    estado.horasFijo.has(h) ? estado.horasFijo.delete(h) : estado.horasFijo.add(h);
    pintarHorasFijo();
  }));
  $('#aviso-bloque').classList.toggle('oculto', !estado.horasFijo.size || bloquesValidos(estado.horasFijo));
  actualizarBarra();
}

// ================================================================ RESUMEN
function calculo() {
  const pct = Number(estado.cfg.porcentaje_sena || 50);
  if (estado.modo === 'suelta') {
    let total = 0, sena = 0, nHoras = 0;
    for (const [f, it] of diasPedido()) {
      const t = totalDia(f, it.horas);
      total += t;
      sena += Math.ceil((t * pct) / 100);   // igual que la base: la seña de cada día, sumada
      nHoras += it.horas.length;
    }
    return { nHoras, dias: estado.pedido.size, total, sena, listo: nHoras > 0 };
  }
  const horas = [...estado.horasFijo];
  const semanal = horas.reduce((s, h) => s + precioHora(estado.precios, estado.cfg, 'fijo', h, estado.desde), 0);
  return { horas, semanal, mensual: Math.round((semanal * 4.33) / 100) * 100, listo: horas.length > 0 && bloquesValidos(estado.horasFijo) };
}

function actualizarBarra() {
  const c = calculo();
  const barra = $('#barra');
  const cuantas = estado.modo === 'suelta' ? c.nHoras : c.horas.length;
  if (!cuantas) { barra.classList.add('oculto'); return; }
  barra.classList.remove('oculto');
  const n = cuantas === 1 ? '1 hora' : `${cuantas} horas`;
  $('#barra-detalle').innerHTML = estado.modo === 'suelta'
    ? `${n}${c.dias > 1 ? ` en ${c.dias} días` : ''} · Total <strong>${pesos(c.total)}</strong><br>Seña para confirmar: <strong>${pesos(c.sena)}</strong>`
    : `${n} por semana · <strong>${pesos(c.semanal)}</strong><br>Aprox. ${pesos(c.mensual)} por mes`;
  $('#btn-continuar').disabled = !c.listo;
}

// ================================================================ DATOS
const abrir = (id) => {
  $(id).classList.remove('oculto');
  document.body.style.overflow = 'hidden';
  try { if (!history.state?.ventana) history.pushState({ ventana: true }, ''); } catch { /* sin historial */ }
};
const cerrar = (id) => { $(id).classList.add('oculto'); document.body.style.overflow = ''; };
// Cerrar a pedido de la persona: vuelve un paso en el historial (como el botón "atrás")
const cerrarVentanas = () => {
  if (history.state?.ventana) history.back();
  else { cerrar('#modal-datos'); cerrar('#modal-resultado'); cerrar('#modal-fotos'); }
};
window.addEventListener('popstate', () => { cerrar('#modal-datos'); cerrar('#modal-resultado'); cerrar('#modal-fotos'); clearInterval(reloj); });
document.querySelectorAll('[data-cerrar]').forEach((b) => (b.onclick = cerrarVentanas));
['#modal-datos', '#modal-fotos'].forEach((id) => $(id).addEventListener('click', (e) => { if (e.target === $(id)) cerrarVentanas(); }));
document.addEventListener('keydown', (e) => {
  const fotos = !$('#modal-fotos').classList.contains('oculto');
  if (e.key === 'Escape' && (fotos || !$('#modal-datos').classList.contains('oculto'))) cerrarVentanas();
  if (fotos && e.key === 'ArrowLeft') $('#fotos-ant').click();
  if (fotos && e.key === 'ArrowRight') $('#fotos-sig').click();
});

$('#btn-continuar').onclick = () => {
  const c = calculo();
  const filas = estado.modo === 'suelta'
    ? [...diasPedido().map(([f, it]) => [fechaLarga(f), `${rangos(it.horas)} · ${it.consultorio ? nombreCons(it.consultorio) : 'te asignamos uno'}`]),
       ['Total', pesos(c.total)], ['Seña (' + (estado.cfg.porcentaje_sena || 50) + '%)', pesos(c.sena)]]
    : [['Día', 'Todos los ' + DIAS[estado.dia].toLowerCase()], ['Desde', fechaLarga(estado.desde)],
       ['Horario', rangos(c.horas)], ['Por semana', pesos(c.semanal)], ['Por mes (aprox.)', pesos(c.mensual)]];
  $('#resumen-datos').innerHTML = filas.map(([a, b]) => `<li><span>${esc(a)}</span><span>${esc(b)}</span></li>`).join('');
  const min = Number(estado.cfg.retencion_suelta_minutos || 120);
  const tiempo = min % 60 === 0 ? `${min / 60} ${min === 60 ? 'hora' : 'horas'}` : `${min} minutos`;
  $('#acepto-texto').textContent = estado.modo === 'suelta'
    ? `Entiendo que ${c.dias > 1 ? 'los horarios se guardan' : 'el horario se guarda'} ${tiempo} y se ${c.dias > 1 ? 'confirman' : 'confirma'} cuando pago la seña de ${pesos(c.sena)}. Si no, se ${c.dias > 1 ? 'liberan solos' : 'libera solo'}.`
    : 'Entiendo que es una solicitud: el equipo me escribe por WhatsApp para confirmarla.';
  $('#btn-enviar').textContent = estado.modo === 'suelta' ? 'Reservar' : 'Enviar solicitud';
  $('#aviso-form').classList.add('oculto');
  cargarMisDatos();
  abrir('#modal-datos');
  setTimeout(() => $('#f-nombre').focus(), 50);
};

// "Recordar mis datos": quedan solo en este navegador
const CLAVE_DATOS = 'psicostudios-mis-datos';
function cargarMisDatos() {
  let d = null;
  try { d = JSON.parse(localStorage.getItem(CLAVE_DATOS) || 'null'); } catch { /* sin almacenamiento */ }
  if (!d) return;
  for (const [id, v] of [['#f-nombre', d.nombre], ['#f-whatsapp', d.whatsapp], ['#f-email', d.email]]) if (!$(id).value && v) $(id).value = v;
  if (!$('#f-profesion').value && d.profesion) {
    const existe = [...$('#f-profesion').options].some((o) => o.value === d.profesion);
    $('#f-profesion').value = existe ? d.profesion : 'Otra';
    if (!existe) $('#f-profesion-otra').value = d.profesion;
    $('#f-profesion-otra').classList.toggle('oculto', existe);
  }
}
function guardarMisDatos(d) {
  try { $('#f-recordar').checked ? localStorage.setItem(CLAVE_DATOS, JSON.stringify(d)) : localStorage.removeItem(CLAVE_DATOS); } catch { /* sin almacenamiento */ }
}
$('#f-profesion').onchange = (e) => {
  const otra = e.target.value === 'Otra';
  $('#f-profesion-otra').classList.toggle('oculto', !otra);
  if (otra) $('#f-profesion-otra').focus();
};

$('#form-datos').onsubmit = async (e) => {
  e.preventDefault();
  const nombre = $('#f-nombre').value.trim();
  const whatsapp = $('#f-whatsapp').value.replace(/\D/g, '');
  const profesion = $('#f-profesion').value === 'Otra' ? $('#f-profesion-otra').value.trim() : $('#f-profesion').value;
  const email = $('#f-email').value.trim().toLowerCase();
  const aviso = $('#aviso-form');
  const falla = (m, campo) => { aviso.textContent = m; aviso.classList.remove('oculto'); campo && $(campo).focus(); };
  if (nombre.length < 2) return falla('Escribí tu nombre y apellido.', '#f-nombre');
  if (profesion.length < 2) return falla('Contanos tu profesión.', $('#f-profesion').value === 'Otra' ? '#f-profesion-otra' : '#f-profesion');
  if (whatsapp.length < 8) return falla('Revisá el celular: tiene que tener al menos 8 números.', '#f-whatsapp');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return falla('Revisá el mail: tiene que ser del tipo nombre@ejemplo.com', '#f-email');
  if (!$('#f-acepto').checked) return falla('Tenés que aceptar las condiciones para seguir.');
  aviso.classList.add('oculto');

  const btn = $('#btn-enviar');
  btn.disabled = true;
  const textoBtn = btn.textContent;
  btn.textContent = 'Enviando…';
  try {
    if (estado.modo === 'suelta') {
      const { data, error } = await sb.rpc('crear_pedido', {
        p_nombre: nombre, p_whatsapp: whatsapp, p_profesion: profesion, p_email: email,
        p_items: diasPedido().map(([f, it]) => ({ fecha: f, horas: it.horas, consultorio: it.consultorio })),
      });
      if (error) throw error;
      guardarMisDatos({ nombre, whatsapp, profesion, email });
      estado.pedido.clear();
      estado.horas.clear();
      estado.consultorio = null;
      mostrarResultadoSuelta(data, nombre);
    } else {
      const { data, error } = await sb.rpc('crear_solicitud_fijo', {
        p_nombre: nombre, p_whatsapp: whatsapp, p_profesion: profesion, p_email: email,
        p_dia: estado.dia, p_horas: [...estado.horasFijo].sort((a, b) => a - b), p_desde: estado.desde,
      });
      if (error) throw error;
      guardarMisDatos({ nombre, whatsapp, profesion, email });
      mostrarResultadoFijo(data, nombre);
    }
  } catch (err) {
    falla(mensajeError(err));
    if (err?.message === 'SIN_LUGAR') {
      if (estado.modo === 'suelta') { await cargarResumen(); elegirFecha(estado.fecha); } else elegirInicioFijo(estado.desde);
    }
  } finally {
    btn.disabled = false;
    btn.textContent = textoBtn;
  }
};

// ================================================================ RESULTADO
let reloj = null;

function mostrarResultadoSuelta(r, nombre) {
  cerrar('#modal-datos');
  const alias = estado.cfg.alias_transferencia;
  const titular = estado.cfg.titular_transferencia;
  const cvu = estado.cfg.cvu_transferencia;
  const configurado = (v) => v && v !== 'COMPLETAR';
  const wa = configurado(estado.cfg.whatsapp_contacto) ? estado.cfg.whatsapp_contacto : WHATSAPP_AYUDA;
  const textoWa = `Hola! Soy ${nombre}. Te paso el comprobante de la seña del pedido #${r.pedido}: ` +
    r.reservas.map((x) => `${fechaLarga(x.fecha)} ${rangos(x.horas)} (${x.consultorio})`).join('; ') + `. Seña: ${pesos(r.sena)}.`;

  const conMP = mpActivo() && r.token;
  const transferencia = `
    <div class="dato-pago">
      <div class="fila"><span>Seña a transferir</span><span class="valor" style="font-size:1.2rem">${pesos(r.sena)}</span></div>
      <div class="fila"><span>Total</span><span class="valor">${pesos(r.total)}</span></div>
      ${configurado(alias) ? `<div class="fila"><span>Alias</span><span class="valor valor-largo">${esc(alias)}</span>
        <button class="btn btn-borde btn-chico" id="copiar-alias">Copiar</button></div>` : ''}
      ${configurado(cvu) ? `<div class="fila"><span>CVU</span><span class="valor valor-largo">${esc(cvu)}</span>
        <button class="btn btn-borde btn-chico" data-copiar="${esc(cvu)}">Copiar</button></div>` : ''}
      ${configurado(titular) ? `<div class="fila"><span>Titular</span><span class="valor valor-largo">${esc(titular)}</span></div>` : ''}
    </div>
    ${configurado(wa) ? `<a class="btn btn-wa btn-bloque" target="_blank" rel="noopener" href="${linkWhatsApp(wa, textoWa)}">Enviar comprobante por WhatsApp</a>` :
      '<p class="aviso aviso-info">Mandanos el comprobante por WhatsApp indicando el número de reserva.</p>'}`;

  $('#contenido-resultado').innerHTML = `
    <div class="icono" aria-hidden="true">✓</div>
    <h2 id="titulo-resultado">${r.reservas.length > 1 ? '¡Tus horarios están guardados!' : '¡Tu horario está guardado!'}</h2>
    <p style="margin-bottom:.4em">Pedido <strong>#${esc(r.pedido)}</strong></p>
    ${listaReservas(r.reservas)}
    <p class="suave chico" style="margin-bottom:.25em">Para confirmar${r.reservas.length > 1 ? ' todo' : 'la'}, pagá la seña de <strong>${pesos(r.sena)}</strong> antes de que termine este tiempo:</p>
    <div class="cuenta" id="cuenta" aria-live="polite">${faltan(r.expira_en)}</div>
    ${conMP ? `
      <button class="btn btn-mp btn-bloque" id="pagar-mp" style="margin-top:1em">Pagar seña con Mercado Pago</button>
      <p class="ayuda">Tarjeta de débito, crédito o dinero en cuenta. Se confirma al instante.</p>
      <div id="aviso-mp" class="aviso aviso-error oculto" role="alert"></div>
      <details class="otra-forma"><summary>¿Preferís transferir?</summary>${transferencia}</details>` : transferencia}
    <p class="ayuda" style="margin-top:1em">El saldo (${pesos(r.total - r.sena)}) se abona el día de cada turno. Si la seña no llega a tiempo, los horarios se liberan automáticamente.</p>
    <button class="btn btn-borde btn-bloque" id="nueva-reserva" style="margin-top:.5em">Hacer otra reserva</button>`;
  abrir('#modal-resultado');

  $('#pagar-mp')?.addEventListener('click', (e) => pagarConMP(r.pedido, r.token, e.currentTarget, $('#aviso-mp')));
  $('#copiar-alias')?.addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(alias); e.target.textContent = '¡Copiado!'; } catch { /* sin permiso */ }
  });
  document.querySelectorAll('[data-copiar]').forEach((b) => b.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(b.dataset.copiar); b.textContent = '¡Copiado!'; } catch { /* sin permiso */ }
  }));
  clearInterval(reloj);
  reloj = setInterval(() => { const el = $('#cuenta'); if (el) el.textContent = faltan(r.expira_en); }, 15000);
  $('#nueva-reserva').onclick = async () => { clearInterval(reloj); cerrarVentanas(); await cargarResumen(); elegirFecha(estado.fecha); };
}

// Lista de los turnos de un pedido (en la pantalla de resultado)
function listaReservas(reservas, conEstado = false) {
  const etiqueta = { confirmada: '<span class="pill-mini ok">Confirmada</span>', pendiente: '<span class="pill-mini alerta">Sin seña</span>',
                     vencida: '<span class="pill-mini error">Vencida</span>', cancelada: '<span class="pill-mini error">Cancelada</span>' };
  return `<ul class="resumen-lista">${reservas.map((x) => `<li><span>${esc(fechaLarga(x.fecha))}<br><small class="suave">${esc(rangos(x.horas))}</small></span>
    <span>${esc(x.consultorio)}${conEstado ? `<br>${etiqueta[x.estado] || ''}` : ''}</span></li>`).join('')}</ul>`;
}

function mostrarResultadoFijo(r, nombre) {
  cerrar('#modal-datos');
  const horas = [...estado.horasFijo];
  const wa = estado.cfg.whatsapp_contacto && estado.cfg.whatsapp_contacto !== 'COMPLETAR' ? estado.cfg.whatsapp_contacto : WHATSAPP_AYUDA;
  const textoWa = `Hola! Soy ${nombre}. Envié la solicitud de horario fijo #${r.id}: ` +
    `${DIAS[estado.dia].toLowerCase()} ${rangos(horas)} desde el ${fechaLarga(estado.desde)}.`;
  const horasRet = Number(estado.cfg.retencion_fijo_horas || 48);
  $('#contenido-resultado').innerHTML = `
    <div class="icono" aria-hidden="true">✓</div>
    <h2 id="titulo-resultado">¡Recibimos tu solicitud!</h2>
    <p>Todos los <strong>${esc(DIAS[estado.dia].toLowerCase())}</strong>, ${esc(rangos(horas))}, desde el ${esc(fechaLarga(estado.desde))} · <strong>${esc(r.consultorio)}</strong></p>
    <div class="dato-pago">
      <div class="fila"><span>Por semana</span><span class="valor">${pesos(r.precio_semanal)}</span></div>
      <div class="fila"><span>Por mes (aprox.)</span><span class="valor">${pesos(r.precio_mensual_aprox)}</span></div>
    </div>
    <p>Te guardamos el horario ${horasRet} horas. En ese tiempo te escribimos por WhatsApp para confirmarlo.</p>
    ${wa && wa !== 'COMPLETAR' ? `<a class="btn btn-wa btn-bloque" target="_blank" rel="noopener" href="${linkWhatsApp(wa, textoWa)}">Escribirnos por WhatsApp</a>` : ''}
    <button class="btn btn-borde btn-bloque" id="nueva-reserva" style="margin-top:.5em">Volver</button>`;
  abrir('#modal-resultado');
  $('#nueva-reserva').onclick = () => { cerrarVentanas(); elegirInicioFijo(estado.desde); };
}

// ================================================================ MERCADO PAGO
const mpActivo = () => estado.cfg.mercadopago_activo === 'si';

// Pide al servidor el link de pago y lleva a la persona a Mercado Pago
async function pagarConMP(id, token, boton, aviso) {
  const texto = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Abriendo Mercado Pago…';
  aviso?.classList.add('oculto');
  try {
    const { data, error } = await sb.functions.invoke('mp-crear-pago', { body: { pedido_id: id, token } });
    if (error) {
      const detalle = await error.context?.json?.().catch(() => null);
      throw detalle || error;
    }
    if (data.demo) { mostrarRetorno(id, token, 'ok'); return; }
    location.href = data.url;
  } catch (err) {
    if (aviso) { aviso.textContent = mensajeError(err); aviso.classList.remove('oculto'); } else mostrarError(mensajeError(err));
    boton.disabled = false;
    boton.textContent = texto;
  }
}

// Pantalla al volver de Mercado Pago (?pago=ok|error|pendiente&pedido=ID&t=CODIGO)
async function mostrarRetorno(id, token, resultado) {
  clearInterval(reloj);
  cerrar('#modal-datos');
  const caja = $('#contenido-resultado');
  caja.innerHTML = '<h2 id="titulo-resultado">Verificando el pago…</h2><div class="cargando" style="justify-content:center">Esto tarda unos segundos</div>';
  abrir('#modal-resultado');

  let r = null;
  for (let intento = 0; intento < 10; intento++) {
    const { data, error } = await sb.rpc('estado_pago_pedido', { p_pedido_id: id, p_token: token });
    if (error) { caja.innerHTML = `<h2 id="titulo-resultado">No encontramos la reserva</h2><p>${esc(mensajeError(error))}</p>${botonVolver()}`; conectarVolver(); return; }
    r = data;
    if (r.estado === 'confirmada' || resultado !== 'ok') break;
    await new Promise((ok) => setTimeout(ok, 3000));
  }

  const varios = r.reservas.length > 1;
  const detalle = `<p style="margin-bottom:.4em">Pedido <strong>#${esc(r.id)}</strong></p>${listaReservas(r.reservas, r.estado === 'parcial')}`;
  if (r.estado === 'confirmada') {
    caja.innerHTML = `<div class="icono" aria-hidden="true">✓</div>
      <h2 id="titulo-resultado">¡Seña pagada! ${varios ? 'Tus reservas están confirmadas' : 'Tu reserva está confirmada'}</h2>${detalle}
      <div class="dato-pago">
        <div class="fila"><span>Pagaste</span><span class="valor">${pesos(r.pagado)}</span></div>
        <div class="fila"><span>Saldo (se abona el día de cada turno)</span><span class="valor">${pesos(r.total - r.pagado)}</span></div>
      </div>
      <p class="suave chico">Guardá el número de pedido. ¡Te esperamos!</p>${botonVolver()}`;
  } else if (r.estado === 'parcial') {
    caja.innerHTML = `<div class="icono" aria-hidden="true" style="background:var(--alerta-fondo);color:var(--alerta)">!</div>
      <h2 id="titulo-resultado">Recibimos tu pago, pero no todos los horarios seguían libres</h2>${detalle}
      <p>Los turnos confirmados están marcados. Para el resto te escribimos para devolverte esa parte o buscarte otro horario.</p>
      <a class="btn btn-wa btn-bloque" data-ayuda target="_blank" rel="noopener" href="${linkWhatsApp(WHATSAPP_AYUDA, `Hola! Pagué el pedido #${r.id} y no todos los horarios quedaron confirmados.`)}">Escribinos por WhatsApp</a>${botonVolver()}`;
  } else if (r.estado === 'pendiente' && resultado === 'ok') {
    caja.innerHTML = `<div class="icono" aria-hidden="true">⏳</div>
      <h2 id="titulo-resultado">Estamos acreditando tu pago</h2>${detalle}
      <p>Mercado Pago todavía no nos confirmó el pago. Suele tardar un minuto: ${varios ? 'tus reservas se confirman solas' : 'tu reserva se confirma sola'}. Si tenés dudas, escribinos por WhatsApp con el número de pedido.</p>
      <button class="btn btn-primario btn-bloque" id="reverificar">Volver a verificar</button>${botonVolver()}`;
    $('#reverificar').onclick = () => mostrarRetorno(id, token, 'ok');
  } else if (r.estado === 'pendiente') {
    caja.innerHTML = `<div class="icono" aria-hidden="true" style="background:var(--alerta-fondo);color:var(--alerta)">!</div>
      <h2 id="titulo-resultado">El pago no se completó</h2>${detalle}
      <p>${varios ? 'Tus horarios siguen guardados' : 'Tu horario sigue guardado'} ${r.expira_en ? `<strong>${faltan(r.expira_en)}</strong> más` : ''}. Podés intentar de nuevo con otra tarjeta o medio de pago.</p>
      <button class="btn btn-mp btn-bloque" id="pagar-mp">Intentar de nuevo · ${pesos(r.sena - r.pagado)}</button>
      <div id="aviso-mp" class="aviso aviso-error oculto" role="alert"></div>${botonVolver()}`;
    $('#pagar-mp').onclick = (e) => pagarConMP(id, token, e.currentTarget, $('#aviso-mp'));
  } else {
    caja.innerHTML = `<h2 id="titulo-resultado">${varios ? 'Las reservas ya no están vigentes' : 'La reserva ya no está vigente'}</h2>${detalle}
      <p>Venció el tiempo para pagar la seña y ${varios ? 'los horarios se liberaron' : 'el horario se liberó'}. Si llegaste a pagar, escribinos por WhatsApp con el número de pedido y lo resolvemos.</p>${botonVolver('Hacer una reserva nueva')}`;
  }
  conectarVolver();
}
const botonVolver = (t = 'Volver al inicio') => `<button class="btn btn-borde btn-bloque" id="nueva-reserva" style="margin-top:.5em">${t}</button>`;
function conectarVolver() {
  const b = $('#nueva-reserva');
  if (b) b.onclick = async () => { cerrarVentanas(); await cargarResumen(); if (estado.fecha) elegirFecha(estado.fecha); };
}

// ---------------------------------------------------------------- arranque
try {
  await cargarBase();
  await cargarResumen();
  pintarGaleria();
  pintarDiasFijo();
  const primero = primerDiaConLugar();
  estado.mesVista = (primero || hoyAR()).slice(0, 7);
  if (primero) await elegirFecha(primero);
  else { pintarCalendario(); $('#horas-suelta').innerHTML = '<p class="aviso aviso-alerta">No quedan horarios libres en los próximos meses. Escribinos por WhatsApp.</p>'; }
  const q = new URLSearchParams(location.search);
  if (q.has('pago') && q.has('pedido') && q.has('t')) {
    const [resultado, id, token] = [q.get('pago'), Number(q.get('pedido')), q.get('t')];
    q.delete('pago'); q.delete('pedido'); q.delete('t');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
    mostrarRetorno(id, token, resultado);
  }
} catch (err) {
  mostrarError(mensajeError(err));
}

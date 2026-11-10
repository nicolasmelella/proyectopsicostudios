// Web pública de reservas (sin login).
import {
  crearCliente, esDemo, copiarTexto, idAlAzar, esc, pesos, hoyAR, horaAR, sumarDias, diaSemana, fechaLarga, fechaCorta, horaTxt, rangos,
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
  const plan = (mod, nombre, texto, destacado) => `<div class="plan ${destacado ? 'dest' : ''}">
    ${destacado ? '<span class="tag">Ahorrás todas las semanas</span>' : ''}<h3>${nombre}</h3><p>${texto}</p>
    <dl><dt>Mañana</dt><dd>${pesos(precioHora(estado.precios, estado.cfg, mod, hm, hoy))} <small>/ hora</small></dd>
      <dt>Tarde</dt><dd>${pesos(precioHora(estado.precios, estado.cfg, mod, ht, hoy))} <small>/ hora</small></dd></dl></div>`;
  $('#tabla-precios').innerHTML = plan('suelta', 'Horas sueltas', 'Reservás cuando lo necesitás.', false)
    + plan('fijo', 'Horario fijo', 'El mismo día, horario y consultorio cada semana.', true);
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

// Horario fijo: por la mañana desde 1 hora; por la tarde, mínimo 2 horas seguidas (misma regla que la base)
function bloquesValidos(horas) {
  const hs = [...horas].map(Number).sort((a, b) => a - b);
  if (!hs.length) return false;
  const finManana = Number(estado.cfg.hora_fin_manana || 13);
  const minManana = Number(estado.cfg.min_horas_fijo_manana || 1);
  const minTarde = Number(estado.cfg.min_horas_fijo_tarde || 2);
  let inicio = 0;
  for (let i = 1; i <= hs.length; i++) {
    if (i < hs.length && hs[i] === hs[i - 1] + 1) continue;
    const largo = i - inicio;
    if (largo < (hs[i - 1] >= finManana ? minTarde : minManana)) return false;
    inicio = i;
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
  // Primer mes: las semanas que quedan del mes en que empieza (la base descuenta feriados)
  let semanas = 0;
  if (estado.desde) for (let d = estado.desde; d.slice(0, 7) === estado.desde.slice(0, 7); d = sumarDias(d, 7)) semanas++;
  return { horas, semanal, semanas, primerMes: semanal * semanas, mensual: Math.round((semanal * 4.33) / 100) * 100,
           listo: horas.length > 0 && bloquesValidos(estado.horasFijo) };
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
    : `${n} por semana · <strong>${pesos(c.semanal)}</strong><br>Primer mes: <strong>${pesos(c.primerMes)}</strong>`;
  $('#btn-continuar').disabled = !c.listo;
}

// ================================================================ DATOS
const abrir = (id) => {
  $(id).classList.remove('oculto');
  document.body.style.overflow = 'hidden';
  try { if (!history.state?.ventana) history.pushState({ ventana: true }, ''); } catch { /* sin historial */ }
};
const cerrar = (id) => { $(id).classList.add('oculto'); document.body.style.overflow = ''; };
// Cerrar a pedido de la persona: se cierra directo (no depende del historial del navegador,
// que dentro de algunos visores no responde) y se desarma la marca para el botón "atrás"
const cerrarVentanas = () => {
  cerrar('#modal-datos'); cerrar('#modal-resultado'); cerrar('#modal-fotos');
  clearInterval(reloj);
  try { if (history.state?.ventana) history.replaceState(null, ''); } catch { /* sin historial */ }
};
window.addEventListener('popstate', () => { cerrar('#modal-datos'); cerrar('#modal-resultado'); cerrar('#modal-fotos'); clearInterval(reloj); });
// Minutos que queda guardado el horario (ej. "15 minutos")
function minutosGuardado(iso) {
  const m = Math.max(1, Math.ceil((new Date(iso) - new Date()) / 60000));
  return m >= 60 && m % 60 === 0 ? (m === 60 ? '1 hora' : `${m / 60} horas`) : `${m} minutos`;
}
// Antes de cerrar una ventana con algo a medio hacer: "¿Seguro que querés cancelar?"
function preguntarAntesDeCerrar(modal, texto, opciones) {
  const caja = modal.querySelector('.modal') || modal.firstElementChild;
  caja.querySelector('.confirmar-cierre')?.remove();
  const d = document.createElement('div');
  d.className = 'confirmar-cierre';
  d.setAttribute('role', 'alertdialog');
  d.setAttribute('aria-label', 'Confirmar');
  d.innerHTML = `<p>${texto}</p><div class="cancelar-botones">${opciones.map(([t, clase], i) =>
    `<button type="button" class="btn ${clase} btn-chico" data-op="${i}">${t}</button>`).join('')}</div>`;
  caja.prepend(d);
  caja.scrollTop = 0;
  d.querySelectorAll('[data-op]').forEach((b) => (b.onclick = () => { d.remove(); opciones[b.dataset.op][2]?.(); }));
  d.querySelector('[data-op="0"]').focus();
}
const cerrarDatos = () => preguntarAntesDeCerrar($('#modal-datos'), '¿Seguro que querés cancelar? Todavía no reservaste nada.',
  [['No, seguir', 'btn-primario', null], ['Sí, cancelar', 'btn-peligro-lleno', cerrarVentanas]]);
document.querySelectorAll('[data-cerrar]').forEach((b) => (b.onclick = b.closest('#modal-datos') ? cerrarDatos : cerrarVentanas));
$('#modal-datos').addEventListener('click', (e) => { if (e.target === $('#modal-datos')) cerrarDatos(); });
$('#modal-fotos').addEventListener('click', (e) => { if (e.target === $('#modal-fotos')) cerrarVentanas(); });
document.addEventListener('keydown', (e) => {
  const fotos = !$('#modal-fotos').classList.contains('oculto');
  if (e.key === 'Escape' && fotos) cerrarVentanas();
  else if (e.key === 'Escape' && !$('#modal-datos').classList.contains('oculto')) cerrarDatos();
  if (fotos && e.key === 'ArrowLeft') $('#fotos-ant').click();
  if (fotos && e.key === 'ArrowRight') $('#fotos-sig').click();
});

$('#btn-continuar').onclick = () => {
  const c = calculo();
  const filas = estado.modo === 'suelta'
    ? [...diasPedido().map(([f, it]) => [fechaLarga(f), `${rangos(it.horas)} · ${it.consultorio ? nombreCons(it.consultorio) : 'te asignamos uno'}`]),
       ['Total', pesos(c.total)]]
    : [['Día', 'Todos los ' + DIAS[estado.dia].toLowerCase()], ['Desde', fechaLarga(estado.desde)],
       ['Horario', rangos(c.horas)], ['Por semana', pesos(c.semanal)],
       [`Primer mes (${c.semanas} ${c.semanas === 1 ? 'semana' : 'semanas'})`, pesos(c.primerMes)]];
  $('#elegir-pago').classList.toggle('oculto', estado.modo !== 'suelta');
  if (estado.modo === 'suelta') { $('#op-sena').textContent = pesos(c.sena); $('#op-total').textContent = pesos(c.total); }
  $('#resumen-datos').innerHTML = filas.map(([a, b]) => `<li><span>${esc(a)}</span><span>${esc(b)}</span></li>`).join('');
  const textoSuelta = () => {
    const todo = document.querySelector('input[name="pagar"]:checked')?.value === 'total';
    return `Entiendo que ${c.dias > 1 ? 'las reservas se confirman' : 'la reserva se confirma'} cuando transfiero ${todo ? `el total de ${pesos(c.total)}` : `la seña de ${pesos(c.sena)}`} y mando el comprobante por WhatsApp${todo ? '' : ', y que el saldo se paga hasta el día anterior al turno'}.`;
  };
  document.querySelectorAll('input[name="pagar"]').forEach((r) => (r.onchange = () => { $('#acepto-texto').textContent = textoSuelta(); }));
  $('#acepto-texto').textContent = estado.modo === 'suelta'
    ? textoSuelta()
    : `Entiendo que el horario fijo se confirma cuando transfiero el primer mes (${pesos(c.primerMes)}) y envío el comprobante por WhatsApp, y que después se paga cada mes por adelantado.`;
  $('#btn-enviar').textContent = estado.modo === 'suelta' ? 'Reservar y pagar' : 'Reservar fijo y pagar';
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
      pantallaPago({ ...data, tipo: 'suelta', pagado: 0, preferencia: document.querySelector('input[name="pagar"]:checked')?.value }, nombre);
    } else {
      const { data, error } = await sb.rpc('crear_fijo_web', {
        p_nombre: nombre, p_whatsapp: whatsapp, p_profesion: profesion, p_email: email,
        p_dia: estado.dia, p_horas: [...estado.horasFijo].sort((a, b) => a - b), p_desde: estado.desde,
      });
      if (error) throw error;
      guardarMisDatos({ nombre, whatsapp, profesion, email });
      pantallaPago({ ...data, tipo: 'fijo', pagado: 0,
        fijo: { dia: estado.dia, horas: [...estado.horasFijo].sort((a, b) => a - b), desde: estado.desde, precio_semanal: data.precio_semanal, consultorio: data.consultorio } }, nombre);
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

// Pantalla de pago (horas sueltas: seña o total · fijo: el primer mes) · Mercado Pago o transferencia
// p: { pedido, token, tipo: 'suelta'|'fijo', total, sena, pagado, expira_en, reservas, fijo?, aviso? }
const ICONO = {
  reloj: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  link: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/></svg>',
  wa: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 01-13.5 7.8L3 21l1.2-4.5A9 9 0 1121 12z"/></svg>',
  mas: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  subir: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3"/></svg>',
  ok: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5L19 7"/></svg>',
};
const pasosPago = () => `<ol class="pasos" aria-label="Pasos de la reserva">
  <li class="hecho"><span class="pasos-n">${ICONO.ok}</span>Horario</li><li class="hecho"><span class="pasos-n">${ICONO.ok}</span>Datos</li>
  <li class="actual" aria-current="step"><span class="pasos-n">3</span>Pago</li></ol>`;
const configurado = (v) => v && v !== 'COMPLETAR';
const waEquipo = () => (configurado(estado.cfg.whatsapp_contacto) ? estado.cfg.whatsapp_contacto : WHATSAPP_AYUDA);
const fechaCortita = (f) => { const [, m, d] = f.split('-'); return `${Number(d)}/${Number(m)}`; };

function pantallaPago(p, nombre = '') {
  cerrar('#modal-datos');
  const esFijo = p.tipo === 'fijo';
  const pagado = p.pagado || 0;
  const falta = { sena: Math.max(0, p.sena - pagado), total: Math.max(0, p.total - pagado) };
  const puedeElegir = !esFijo && falta.sena > 0 && falta.sena < falta.total;
  const elegido = { cuanto: puedeElegir ? (p.preferencia === 'total' ? 'total' : 'sena') : 'total', medio: mpActivo() ? 'mp' : 'transf' };
  if (!esFijo && !puedeElegir && falta.sena > 0) elegido.cuanto = 'sena';
  const n = p.reservas.length;
  const textoWa = (monto) => mensajeComprobante(p, nombre, monto, esFijo ? 'total' : elegido.cuanto);

  const resumen = esFijo ? `
    <div class="pago-resumen">
      <div class="pago-turno"><div><strong>Todos los ${esc(DIAS[p.fijo.dia].toLowerCase())}</strong><span>${esc(rangos(p.fijo.horas))} · desde el ${esc(fechaLarga(p.fijo.desde))}</span></div>
        <span class="pill-cons">${esc(p.fijo.consultorio)}</span></div>
      <div class="pago-linea"><span>Por semana</span><span>${pesos(p.fijo.precio_semanal)}</span></div>
      <div class="pago-linea"><span>Primer mes: ${n} ${n === 1 ? 'semana' : 'semanas'} (${p.reservas.map((x) => fechaCortita(x.fecha)).join(', ')})</span><span>${pesos(p.total)}</span></div>
      ${pagado ? `<div class="pago-linea"><span>Ya pagaste</span><span>${pesos(pagado)}</span></div>` : ''}
      <p class="pago-nota">Después se paga mes a mes, por adelantado.</p>
    </div>` : `
    <div class="pago-resumen">
      ${p.reservas.map((x) => `<div class="pago-turno"><div><strong>${esc(fechaLarga(x.fecha))}</strong><span>${esc(rangos(x.horas))}</span></div>
        <span class="pill-cons">${esc(x.consultorio)}</span></div>`).join('')}
      <div class="pago-linea"><span>Total</span><span>${pesos(p.total)}</span></div>
      ${pagado ? `<div class="pago-linea"><span>Ya pagaste</span><span>${pesos(pagado)}</span></div>` : ''}
    </div>`;

  const caja = $('#contenido-resultado');
  caja.innerHTML = `
    <button class="modal-cerrar" id="cerrar-resultado" aria-label="Cerrar">×</button>
    ${pasosPago()}
    ${p.aviso ? `<p class="aviso aviso-alerta" role="alert">${esc(p.aviso)}</p>` : ''}
    <div class="pago-cab">
      <h2 id="titulo-resultado">${esFijo ? 'Tu horario fijo está reservado' : pagado ? (n > 1 ? 'Tus reservas están confirmadas' : 'Tu reserva está confirmada')
        : n > 1 ? 'Tus horarios están reservados' : 'Tu horario está reservado'}</h2>
      <span class="reloj-chip">${ICONO.reloj}<span>${esFijo ? 'Se confirma al pagar el primer mes' : pagado ? `Saldo: hasta el ${esc(fechaLarga(sumarDias(p.reservas[0].fecha, -1)))}`
        : p.expira_en && new Date(p.expira_en) > new Date() ? `Te lo guardamos <strong id="cuenta">${esc(faltan(p.expira_en))}</strong>: mandá la seña para confirmarlo`
        : `Pagá la seña para confirmar · el saldo, hasta el ${esc(fechaLarga(sumarDias(p.reservas[0].fecha, -1)))}`}</span></span>
      <span class="pago-pedido">Pedido #${esc(p.pedido)}</span>
    </div>
    ${resumen}
    <section class="pago-bloque" id="pago-cuerpo" aria-labelledby="pago-titulo"></section>
    <nav class="pago-links" aria-label="Más opciones">
      <button type="button" class="pago-link" data-copiar="${esc(linkComprobante(p.pedido, p.token))}" data-copiado="¡Link copiado! Guardalo para volver a tu reserva">${ICONO.link}<span>Pago más tarde: guardar el link de mi reserva</span></button>
      <a class="pago-link" id="link-wa" target="_blank" rel="noopener" href="${linkWhatsApp(waEquipo(), textoWa(falta[elegido.cuanto]))}">${ICONO.wa}<span>¿Dudas? Escribinos por WhatsApp</span></a>
      <button type="button" class="pago-link" id="nueva-reserva">${ICONO.mas}<span>Hacer otra reserva</span></button>
    </nav>
    ${pagado ? '' : bloqueCancelar()}`;

  const pintar = () => {
    const monto = falta[elegido.cuanto];
    const que = esFijo ? 'el primer mes' : pagado ? 'el saldo' : elegido.cuanto === 'total' ? 'el total' : 'la seña';
    const hayDatos = configurado(estado.cfg.alias_transferencia) || configurado(estado.cfg.cvu_transferencia);
    const fila = (etiqueta, valor, copiar, principal) => `<div class="cuenta-fila"><div><span>${etiqueta}</span><strong>${esc(valor)}</strong></div>
      ${copiar ? `<button type="button" class="btn btn-chico ${principal ? 'btn-primario' : 'btn-borde'}" data-copiar="${esc(copiar)}" aria-label="Copiar ${etiqueta.toLowerCase()}">Copiar</button>` : ''}</div>`;
    $('#pago-cuerpo').innerHTML = `
      <h3 id="pago-titulo">Pagá ${que}: ${pesos(monto)}</h3>
      ${puedeElegir ? `<div class="selector" role="group" aria-label="Cuánto pagás ahora">
          <button type="button" data-cuanto="sena" aria-pressed="${elegido.cuanto === 'sena'}"><strong>Seña ${pesos(falta.sena)}</strong><span>el resto, hasta el día anterior</span></button>
          <button type="button" data-cuanto="total" aria-pressed="${elegido.cuanto === 'total'}"><strong>Total ${pesos(falta.total)}</strong><span>y no pagás nada más</span></button>
        </div>` : ''}
      ${mpActivo() ? `<div class="selector selector-medio" role="group" aria-label="Medio de pago">
          <button type="button" data-medio="mp" aria-pressed="${elegido.medio === 'mp'}"><strong>Mercado Pago</strong></button>
          <button type="button" data-medio="transf" aria-pressed="${elegido.medio === 'transf'}"><strong>Transferencia</strong></button>
        </div>` : ''}
      ${elegido.medio === 'mp' ? `
        <button class="btn btn-mp btn-bloque" id="pagar-mp">Pagar ${pesos(monto)} con Mercado Pago</button>
        <p class="ayuda centro">Tarjeta de débito, crédito o dinero en cuenta. Se confirma al instante.</p>
        <div id="aviso-mp" class="aviso aviso-error oculto" role="alert"></div>` : `
        <ol class="pasos-pago">
          <li><span>1</span><div>Tocá <strong>Enviar reserva por WhatsApp</strong>: nos llega tu pedido con los datos para transferir.</div></li>
          <li><span>2</span><div>Transferí <strong>${pesos(monto)}</strong>.</div></li>
          <li><span>3</span><div>Mandá la captura de la transferencia <strong>en ese mismo chat</strong>. Te confirmamos por ahí.</div></li>
        </ol>
        <a class="btn btn-wa btn-bloque btn-subir" id="enviar-wa" target="_blank" rel="noopener" href="${linkWhatsApp(waEquipo(), textoWa(monto))}">${ICONO.wa}<span>Enviar reserva por WhatsApp</span></a>
        <p class="ayuda centro" style="margin-bottom:1em"><strong>La reserva se confirma cuando recibimos el comprobante.</strong>${!esFijo && !pagado && p.expira_en
          ? `<br>El horario queda guardado ${minutosGuardado(p.expira_en)}: si en ese tiempo no llega la seña, se libera para otra persona.` : ''}</p>
        ${hayDatos ? `<p class="cuenta-titulo">Datos para transferir <span>(también te llegan en el chat)</span></p><div class="cuenta-datos">
            ${fila('Monto', pesos(monto), String(monto), false)}
            ${configurado(estado.cfg.alias_transferencia) ? fila('Alias', estado.cfg.alias_transferencia, estado.cfg.alias_transferencia, true) : ''}
            ${configurado(estado.cfg.cvu_transferencia) ? fila('CVU', estado.cfg.cvu_transferencia, estado.cfg.cvu_transferencia, false) : ''}
            ${configurado(estado.cfg.titular_transferencia) ? fila('Titular', estado.cfg.titular_transferencia, null, false) : ''}
          </div>` : `<p class="aviso aviso-info">Te pasamos los datos para transferir por WhatsApp.</p>`}`}`;
    document.querySelectorAll('[data-cuanto]').forEach((b) => (b.onclick = () => { elegido.cuanto = b.dataset.cuanto; pintar(); $(`[data-cuanto="${elegido.cuanto}"]`).focus(); }));
    document.querySelectorAll('[data-medio]').forEach((b) => (b.onclick = () => { elegido.medio = b.dataset.medio; pintar(); $(`[data-medio="${elegido.medio}"]`).focus(); }));
    $('#pagar-mp')?.addEventListener('click', (e) => pagarConMP(p.pedido, p.token, e.currentTarget, $('#aviso-mp'), esFijo ? 'total' : elegido.cuanto));
    $('#link-wa').href = linkWhatsApp(waEquipo(), textoWa(monto));
    $('#enviar-wa')?.addEventListener('click', () => setTimeout(() => pantallaFinal(p, nombre, monto, true, esFijo ? 'total' : elegido.cuanto), 300));
    conectarComprobante(p.pedido, p.token, () => {
      const fin = document.createElement('button');
      fin.type = 'button';
      fin.className = 'btn btn-primario btn-bloque fin-pago';
      fin.textContent = 'Finalizar';
      fin.onclick = () => pantallaFinal(p, nombre, falta[elegido.cuanto]);
      $('#comp-estado').append(fin);
      fin.focus();
    });
  };
  pintar();
  abrir('#modal-resultado');
  conectarCancelar(p.pedido, p.token);
  const volver = async () => { clearInterval(reloj); cerrarVentanas(); await cargarResumen(); if (estado.modo === 'suelta' && estado.fecha) elegirFecha(estado.fecha); };
  $('#cerrar-resultado').onclick = pagado || !p.expira_en ? volver : () => preguntarAntesDeCerrar($('#modal-resultado'),
    `¿Seguro que querés salir? Tu horario queda guardado ${minutosGuardado(p.expira_en)}: si no llega la seña, se libera para otra persona.`,
    [['Seguir con el pago', 'btn-primario', null],
     ['Cancelar la reserva', 'btn-peligro-lleno', () => { $('#cancelar-paso1')?.click(); $('#cancelar-pedido')?.scrollIntoView({ block: 'center' }); }],
     ['Salir igual', 'btn-borde', volver]]);
  $('#nueva-reserva').onclick = volver;
  clearInterval(reloj);
  if (p.expira_en) reloj = setInterval(() => { const el = $('#cuenta'); if (el) el.textContent = faltan(p.expira_en); }, 15000);
}

// Lista de los turnos de un pedido (en la pantalla de resultado)
function listaReservas(reservas, conEstado = false) {
  const etiqueta = { confirmada: '<span class="pill-mini ok">Confirmada</span>', pendiente: '<span class="pill-mini alerta">Sin seña</span>',
                     vencida: '<span class="pill-mini error">Vencida (no llegó la seña)</span>', cancelada: '<span class="pill-mini error">Cancelada</span>' };
  return `<ul class="resumen-lista">${reservas.map((x) => `<li><span>${esc(fechaLarga(x.fecha))}<br><small class="suave">${esc(rangos(x.horas))}</small></span>
    <span>${esc(x.consultorio)}${conEstado ? `<br>${etiqueta[x.estado] || ''}` : ''}</span></li>`).join('')}</ul>`;
}

// ================================================================ MERCADO PAGO
const mpActivo = () => estado.cfg.mercadopago_activo === 'si';

// Pide al servidor el link de pago y lleva a la persona a Mercado Pago
async function pagarConMP(id, token, boton, aviso, pagar = 'sena') {
  const texto = boton.textContent;
  boton.disabled = true;
  boton.textContent = 'Abriendo Mercado Pago…';
  aviso?.classList.add('oculto');
  try {
    const { data, error } = await sb.functions.invoke('mp-crear-pago', { body: { pedido_id: id, token, pagar } });
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
async function mostrarRetorno(id, token, resultado, pagoMP = null) {
  clearInterval(reloj);
  cerrar('#modal-datos');
  const caja = $('#contenido-resultado');
  caja.innerHTML = '<h2 id="titulo-resultado">Verificando el pago…</h2><div class="cargando" style="justify-content:center">Esto tarda unos segundos</div>';
  abrir('#modal-resultado');

  // Doble control: si Mercado Pago nos devolvió el número de pago, lo hacemos verificar ya
  // (por si el aviso automático de Mercado Pago tarda o no llega). El servidor lo consulta a Mercado Pago.
  if (pagoMP && /^\d+$/.test(pagoMP) && !esDemo()) {
    try { await sb.functions.invoke('mp-webhook', { body: { type: 'payment', data: { id: pagoMP } } }); } catch { /* sigue con el aviso normal */ }
  }

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
    caja.innerHTML = confirmado(r, detalle);
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
    pantallaPago(desdeEstado(r, token, 'El pago no se completó. Podés intentar de nuevo con otra tarjeta, o transferir.'));
    return;
  } else if (r.reservas.every((x) => x.estado === 'cancelada')) {
    caja.innerHTML = `<h2 id="titulo-resultado">${varios ? 'Cancelaste estas reservas' : 'Cancelaste esta reserva'}</h2>${detalle}
      <p>${varios ? 'Los horarios quedaron libres' : 'El horario quedó libre'}. Podés hacer una reserva nueva cuando quieras.</p>${botonVolver('Hacer una reserva nueva')}`;
  } else {
    caja.innerHTML = `<h2 id="titulo-resultado">${varios ? 'Las reservas ya no están vigentes' : 'La reserva ya no está vigente'}</h2>${detalle}
      <p>${varios ? 'Estas reservas ya no están activas' : 'Esta reserva ya no está activa'}. Si tenés dudas o ya pagaste, escribinos por WhatsApp con el número de pedido y lo resolvemos.</p>${botonVolver('Hacer una reserva nueva')}`;
  }
  conectarVolver();
}
// Mensaje para mandar el comprobante por WhatsApp, con todo el pedido
function mensajeComprobante(p, nombre, monto, cuanto = 'sena') {
  const quien = (nombre || '').trim() || 'quien hizo la reserva';
  const c = estado.cfg;
  const turnos = p.tipo === 'fijo' && p.fijo
    ? [`Horario fijo: todos los ${DIAS[p.fijo.dia].toLowerCase()}, ${rangos(p.fijo.horas)}, ${p.fijo.consultorio}, desde el ${fechaLarga(p.fijo.desde).toLowerCase()}`]
    : p.reservas.map((x) => `${fechaLarga(x.fecha)}, ${rangos(x.horas)}, ${x.consultorio}`);
  const pago = p.tipo === 'fijo' ? `Primer mes: ${pesos(monto)}`
    : (p.pagado || 0) > 0 ? `Saldo: ${pesos(monto)}`
    : cuanto === 'total' ? `Pago el total: ${pesos(monto)}` : `Pago la seña: ${pesos(monto)} (total ${pesos(p.total)})`;
  const datos = [configurado(c.alias_transferencia) ? `Alias: ${c.alias_transferencia}` : null,
    configurado(c.cvu_transferencia) ? `CVU: ${c.cvu_transferencia}` : null,
    configurado(c.titular_transferencia) ? `Titular: ${c.titular_transferencia}` : null].filter(Boolean);
  return [`Hola! Soy ${quien}. Reservé por la web (pedido #${p.pedido}):`, ...turnos.map((t) => `• ${t}`), pago,
    ...(datos.length ? ['', 'Datos para transferir:', ...datos] : []), '', 'Ahora transfiero y te mando el comprobante por acá 👇'].join('\n');
}

// Cierre: después de mandar el comprobante por WhatsApp (porWa) o de subirlo acá
function pantallaFinal(p, nombre, monto, porWa = false, cuanto = 'sena') {
  clearInterval(reloj);
  const primer = (nombre || '').trim().split(' ')[0];
  const textoWa = mensajeComprobante(p, nombre, monto, cuanto);
  const c = estado.cfg;
  $('#contenido-resultado').innerHTML = `
    <button class="modal-cerrar" id="cerrar-resultado" aria-label="Cerrar">×</button>
    <div class="icono" aria-hidden="true">✓</div>
    <h2 id="titulo-resultado">¡Listo${primer ? `, ${esc(primer)}` : ''}!</h2>
    ${porWa ? `<p>Se abrió WhatsApp con tu reserva: <strong>enviá el mensaje</strong>.</p>
      <ol class="pasos-pago" style="text-align:left">
        <li><span>1</span><div>Enviá el mensaje que se abrió en WhatsApp.</div></li>
        <li><span>2</span><div>Transferí <strong>${pesos(monto)}</strong>${configurado(c.alias_transferencia) ? ` al alias <strong>${esc(c.alias_transferencia)}</strong>` : ''}.</div></li>
        <li><span>3</span><div>Mandá la captura <strong>en ese mismo chat</strong>. Te confirmamos por ahí.</div></li>
      </ol>`
      : `<p>Recibimos tu comprobante de <strong>${pesos(monto)}</strong>. Lo revisamos y te confirmamos por WhatsApp.</p>`}
    <p style="margin-bottom:.4em">Pedido <strong>#${esc(p.pedido)}</strong></p>${listaReservas(p.reservas)}
    <p class="suave chico">Mientras lo revisamos, ${p.tipo === 'fijo' || p.reservas.length === 1 ? 'el horario queda guardado' : 'los horarios quedan guardados'} a tu nombre.</p>
    <a class="btn btn-wa btn-bloque btn-subir" target="_blank" rel="noopener" href="${linkWhatsApp(waEquipo(), textoWa)}">${ICONO.wa}<span>${porWa ? 'Abrir WhatsApp de nuevo' : 'Avisar por WhatsApp'}</span></a>
    <p class="ayuda centro" style="margin:.4em 0 .8em">${porWa ? '¿No se abrió o no lo enviaste? Tocá el botón.' : 'Se abre el chat con el mensaje listo.'}</p>
    <button class="btn btn-borde btn-bloque" id="nueva-reserva">Volver al inicio</button>`;
  const volver = async () => { cerrarVentanas(); await cargarResumen(); if (estado.modo === 'suelta' && estado.fecha) elegirFecha(estado.fecha); };
  $('#cerrar-resultado').onclick = volver;
  $('#nueva-reserva').onclick = volver;
  $('#titulo-resultado').focus?.();
}

// Datos de estado_pago_pedido → pantalla de pago
const desdeEstado = (r, token, aviso) => ({ pedido: r.id, token, tipo: r.tipo || 'suelta', total: r.total, sena: r.sena, pagado: r.pagado,
  expira_en: r.expira_en, reservas: r.reservas, fijo: r.fijo, aviso });

// Pantalla de "¡Listo, confirmado!"
function confirmado(r, detalle) {
  const esFijo = r.tipo === 'fijo';
  const saldo = Math.max(0, r.total - r.pagado);
  const titulo = esFijo ? '¡Pagaste el primer mes! Tu horario fijo está confirmado'
    : `${saldo ? '¡Seña pagada!' : '¡Pagaste todo!'} ${r.reservas.length > 1 ? 'Tus reservas están confirmadas' : 'Tu reserva está confirmada'}`;
  return `<div class="icono" aria-hidden="true">✓</div>
    <h2 id="titulo-resultado">${titulo}</h2>${detalle}
    <div class="dato-pago">
      <div class="fila"><span>Pagaste</span><span class="valor">${pesos(r.pagado)}</span></div>
      ${esFijo ? '<div class="fila"><span>Próximo pago</span><span class="valor">el mes que viene, por adelantado</span></div>'
        : saldo ? `<div class="fila"><span>Saldo (hasta el día anterior a cada turno)</span><span class="valor">${pesos(saldo)}</span></div>`
          : '<div class="fila"><span>Saldo</span><span class="valor">No tenés que pagar nada más</span></div>'}
    </div>
    <p class="suave chico">Guardá el número de pedido. ¡Te esperamos!</p>${botonVolver()}`;
}

// ================================================================ CANCELAR (antes de pagar)
function bloqueCancelar() {
  return `<div class="cancelar-pedido" id="cancelar-pedido">
    <button type="button" class="link-cancelar" id="cancelar-paso1">¿Te equivocaste? Cancelar esta reserva</button>
    <div class="cancelar-confirmar oculto" id="cancelar-paso2" role="group" aria-label="Confirmar cancelación">
      <p>¿Seguro? Los horarios quedan libres para otra persona.</p>
      <div class="cancelar-botones">
        <button type="button" class="btn btn-borde btn-chico" id="cancelar-no">No, mantener</button>
        <button type="button" class="btn btn-peligro-lleno btn-chico" id="cancelar-si">Sí, cancelar</button>
      </div>
    </div>
    <div id="cancelar-aviso" class="aviso aviso-error oculto" role="alert"></div>
  </div>`;
}

function conectarCancelar(pedido, token) {
  const p1 = $('#cancelar-paso1'), p2 = $('#cancelar-paso2');
  if (!p1) return;
  p1.onclick = () => { p1.classList.add('oculto'); p2.classList.remove('oculto'); $('#cancelar-no').focus(); };
  $('#cancelar-no').onclick = () => { p2.classList.add('oculto'); p1.classList.remove('oculto'); p1.focus(); };
  $('#cancelar-si').onclick = async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = 'Cancelando…';
    const { error } = await sb.rpc('cancelar_pedido_web', { p_pedido_id: Number(pedido), p_token: token });
    if (error) {
      const aviso = $('#cancelar-aviso');
      aviso.textContent = mensajeError(error);
      aviso.classList.remove('oculto');
      b.disabled = false; b.textContent = 'Sí, cancelar';
      return;
    }
    clearInterval(reloj);
    $('#contenido-resultado').innerHTML = `
      <button class="modal-cerrar" id="cerrar-resultado" aria-label="Cerrar">×</button>
      <div class="icono" aria-hidden="true">✓</div>
      <h2 id="titulo-resultado">Listo, cancelaste la reserva</h2>
      <p>Los horarios quedaron libres. No tenés que pagar nada.</p>
      <button class="btn btn-primario btn-bloque" id="nueva-reserva">Hacer otra reserva</button>`;
    const volver = async () => { cerrarVentanas(); await cargarResumen(); if (estado.fecha) elegirFecha(estado.fecha); };
    $('#cerrar-resultado').onclick = volver;
    $('#nueva-reserva').onclick = volver;
  };
}

// ================================================================ COMPROBANTE DE PAGO
const MAX_ARCHIVO = 5 * 1024 * 1024;
const EXTENSION = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'image/heif': 'heif', 'application/pdf': 'pdf' };
const linkComprobante = (pedido, token) => `${location.origin}${location.pathname}?ver=${pedido}&t=${token}`;

function datosTransferencia(monto) {
  const c = estado.cfg, ok = (v) => v && v !== 'COMPLETAR';
  return `<div class="dato-pago">
    ${monto ? `<div class="fila"><span>A transferir</span><span class="valor" style="font-size:1.15rem">${pesos(monto)}</span></div>` : ''}
    ${ok(c.alias_transferencia) ? `<div class="fila"><span>Alias</span><span class="valor valor-largo">${esc(c.alias_transferencia)}</span><button class="btn btn-borde btn-chico" data-copiar="${esc(c.alias_transferencia)}">Copiar</button></div>` : ''}
    ${ok(c.cvu_transferencia) ? `<div class="fila"><span>CVU</span><span class="valor valor-largo">${esc(c.cvu_transferencia)}</span><button class="btn btn-borde btn-chico" data-copiar="${esc(c.cvu_transferencia)}">Copiar</button></div>` : ''}
    ${ok(c.titular_transferencia) ? `<div class="fila"><span>Titular</span><span class="valor valor-largo">${esc(c.titular_transferencia)}</span></div>` : ''}
  </div>`;
}

function bloqueComprobante() {
  return `<div class="comprobante">
    <strong>¿Ya transferiste? Subí el comprobante</strong>
    <span class="suave chico">Foto, captura o PDF. Lo revisamos y te confirmamos.</span>
    <label class="btn btn-acento btn-bloque" for="comp-archivo" style="margin-top:.6em">📎 Subir comprobante</label>
    <input type="file" id="comp-archivo" accept="image/*,application/pdf" class="visualmente-oculto">
    <div id="comp-estado" role="status" aria-live="polite"></div>
  </div>`;
}

function conectarComprobante(pedido, token, alTerminar) {
  document.querySelectorAll('[data-copiar]').forEach((b) => (b.onclick = async () => {
    const el = b.querySelector('span') || b;
    const antes = el.textContent;
    el.textContent = (await copiarTexto(b.dataset.copiar)) ? (b.dataset.copiado || '¡Copiado!') : 'No se pudo copiar: mantené apretado el texto';
    setTimeout(() => { el.textContent = antes; }, 2500);
  }));
  const input = $('#comp-archivo');
  if (!input) return;
  input.onchange = async () => {
    const archivo = input.files?.[0];
    input.value = '';
    if (!archivo) return;
    const el = $('#comp-estado');
    el.className = 'aviso aviso-info';
    el.textContent = 'Subiendo el comprobante…';
    try {
      const r = await subirComprobante(pedido, token, archivo);
      const hasta = r?.horarios_guardados_hasta ? new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires',
        weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(r.horarios_guardados_hasta)) : null;
      el.className = 'aviso aviso-ok';
      el.innerHTML = `✓ <strong>Recibimos tu comprobante.</strong> Lo revisamos y te confirmamos por WhatsApp.${hasta ? '' : ''}
        <br><span class="chico">¿Te faltó alguno? Podés subir otro.</span>`;
      alTerminar?.();
    } catch (err) {
      el.className = 'aviso aviso-error';
      el.textContent = mensajeError(err);
    }
  };
}

// Achica fotos grandes (las del celular pesan varios MB) a 1600 px en JPG
async function achicarImagen(archivo) {
  const img = await createImageBitmap(archivo);
  const escala = Math.min(1, 1600 / Math.max(img.width, img.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(img.width * escala);
  lienzo.height = Math.round(img.height * escala);
  lienzo.getContext('2d').drawImage(img, 0, 0, lienzo.width, lienzo.height);
  return new Promise((ok, mal) => lienzo.toBlob((b) => (b ? ok(b) : mal(new Error('No se pudo leer la imagen'))), 'image/jpeg', 0.82));
}

async function subirComprobante(pedido, token, archivo) {
  let datos = archivo, tipo = archivo.type || '';
  if (!(tipo.startsWith('image/') || tipo === 'application/pdf')) throw { hint: 'Subí una foto, una captura o un PDF del comprobante.' };
  if (tipo.startsWith('image/') && tipo !== 'image/heic' && tipo !== 'image/heif') {
    try { datos = await achicarImagen(archivo); tipo = 'image/jpeg'; } catch { /* si no se puede achicar, va como está */ }
  }
  if (!EXTENSION[tipo]) throw { hint: 'Ese formato de imagen no se puede subir. Probá con una captura de pantalla o un PDF.' };
  if (datos.size > MAX_ARCHIVO) throw { hint: 'El archivo pesa más de 5 MB. Probá con una captura de pantalla.' };
  const ruta = `${pedido}/${token}/${idAlAzar()}.${EXTENSION[tipo]}`;
  const subida = await sb.storage.from('comprobantes').upload(ruta, datos, { contentType: tipo, upsert: false });
  if (subida.error) {
    throw /row-level security|policy/i.test(subida.error.message || '')
      ? { hint: 'No pudimos guardar el comprobante: ya se subió el máximo para este pedido o el link no es válido. Escribinos por WhatsApp.' }
      : subida.error;
  }
  const { data, error } = await sb.rpc('registrar_comprobante', { p_pedido_id: pedido, p_token: token, p_ruta: ruta });
  if (error) throw error;
  return data;
}

// Pantalla para subir el comprobante más tarde (?comprobante=PEDIDO&t=CODIGO)
async function mostrarSubirComprobante(id, token) {
  const caja = $('#contenido-resultado');
  caja.innerHTML = '<div class="cargando" style="justify-content:center">Buscando tu pedido…</div>';
  abrir('#modal-resultado');
  const { data: r, error } = await sb.rpc('estado_pago_pedido', { p_pedido_id: id, p_token: token });
  if (error) { caja.innerHTML = `<h2 id="titulo-resultado">No encontramos el pedido</h2><p>${esc(mensajeError(error))}</p>${botonVolver()}`; conectarVolver(); return; }
  if (r.estado === 'pendiente' || (r.estado === 'confirmada' && r.tipo !== 'fijo' && r.total > r.pagado)) { pantallaPago(desdeEstado(r, token)); return; }
  const detalle = `<p style="margin-bottom:.4em">Pedido <strong>#${esc(r.id)}</strong></p>${listaReservas(r.reservas, true)}`;
  if (r.estado === 'confirmada') caja.innerHTML = confirmado(r, detalle);
  else if (r.reservas.every((x) => x.estado === 'cancelada')) {
    caja.innerHTML = `<h2 id="titulo-resultado">Cancelaste esta reserva</h2>${detalle}<p>Los horarios quedaron libres.</p>${botonVolver('Hacer una reserva nueva')}`;
  } else {
    caja.innerHTML = `<h2 id="titulo-resultado">${r.estado === 'parcial' ? 'Tu reserva' : 'Tu reserva se venció'}</h2>${detalle}
      ${r.estado === 'vencida' ? `<p class="aviso aviso-alerta">Esta reserva ya no está activa. Si ya transferiste, escribinos por WhatsApp con el comprobante y lo resolvemos.</p>
        <a class="btn btn-wa btn-bloque" target="_blank" rel="noopener" href="${linkWhatsApp(waEquipo(), `Hola! Te escribo por la reserva #${r.id}.`)}">Escribinos por WhatsApp</a>` : ''}${botonVolver()}`;
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
  // Links que comparte el asistente de WhatsApp: ?dia=AAAA-MM-DD (horas sueltas) o ?fijo=1…6 (horario fijo ese día de la semana)
  const diaLink = q.get('dia'), fijoLink = q.get('fijo');
  if (diaLink && /^\d{4}-\d{2}-\d{2}$/.test(diaLink) && diaLink >= hoyAR()) {
    await elegirFecha(diaLink);
    document.getElementById('reservar')?.scrollIntoView({ block: 'start' });
  } else if (fijoLink && /^[1-6]$/.test(fijoLink)) {
    cambiarModo('fijo');
    elegirDiaFijo(Number(fijoLink));
    document.getElementById('reservar')?.scrollIntoView({ block: 'start' });
  }
  if (q.has('pago') && q.has('pedido') && q.has('t')) {
    const [resultado, id, token] = [q.get('pago'), Number(q.get('pedido')), q.get('t')];
    const pagoMP = q.get('payment_id') || q.get('collection_id');
    for (const k of ['pago', 'pedido', 't', 'collection_id', 'collection_status', 'payment_id', 'status', 'external_reference',
      'payment_type', 'merchant_order_id', 'preference_id', 'site_id', 'processing_mode', 'merchant_account_id']) q.delete(k);
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
    mostrarRetorno(id, token, resultado, pagoMP);
  } else if ((q.has('ver') || q.has('comprobante')) && q.has('t')) {
    // "Mi reserva" (link de los mails) o el link para subir el comprobante
    const [id, token] = [Number(q.get('ver') || q.get('comprobante')), q.get('t')];
    q.delete('ver'); q.delete('comprobante'); q.delete('t');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
    mostrarSubirComprobante(id, token);
  }
} catch (err) {
  mostrarError(mensajeError(err));
}

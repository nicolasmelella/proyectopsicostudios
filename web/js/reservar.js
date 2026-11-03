// Web pública de reservas (sin login).
import {
  crearCliente, esc, pesos, hoyAR, horaAR, sumarDias, diaSemana, fechaLarga, horaTxt, rangos,
  faltan, precioHora, mensajeError, linkWhatsApp, DIAS, DIAS_CORTOS,
} from './comun.js';

const $ = (s) => document.querySelector(s);
const sb = await crearCliente();

const estado = {
  modo: 'suelta',
  cfg: {},
  precios: [],
  consultorios: [],
  // por horas
  fecha: null,
  libres: new Map(),      // hora → Set(consultorio_id)
  horas: new Set(),
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
  const wa = estado.cfg.whatsapp_contacto;
  if (wa && /^\d{8,}$/.test(wa)) {
    const a = $('#wa-flotante');
    a.href = linkWhatsApp(wa, 'Hola! Tengo una consulta sobre los consultorios.');
    a.classList.remove('oculto');
  }
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
  el.textContent = msg;
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
function fechasDisponibles(cantidad) {
  const out = [];
  let f = hoyAR();
  const ultimaHora = Number(estado.cfg.hora_cierre) - 1;
  if (horaAR() >= ultimaHora) f = sumarDias(f, 1);
  while (out.length < cantidad) {
    if (diaSemana(f) !== 7) out.push(f);
    f = sumarDias(f, 1);
  }
  return out;
}

function pintarDiasSuelta() {
  const fechas = fechasDisponibles(18);
  if (estado.fecha && !fechas.includes(estado.fecha)) fechas.push(estado.fecha);
  const hoy = hoyAR();
  $('#dias-suelta').innerHTML = fechas.map((f) => {
    const [, , d] = f.split('-');
    const etiqueta = f === hoy ? 'Hoy' : f === sumarDias(hoy, 1) ? 'Mañana' : DIAS_CORTOS[diaSemana(f)];
    return `<button class="chip" data-fecha="${f}" aria-pressed="${f === estado.fecha}" aria-label="${fechaLarga(f)}">
      <small>${etiqueta}</small><strong>${Number(d)}</strong></button>`;
  }).join('');
  $('#dias-suelta').querySelectorAll('.chip').forEach((b) => (b.onclick = () => elegirFecha(b.dataset.fecha)));
  const otra = $('#fecha-otra');
  otra.min = hoy;
  otra.max = sumarDias(hoy, Number(estado.cfg.dias_reserva_maximo));
}

$('#fecha-otra').onchange = (e) => {
  const f = e.target.value;
  if (!f) return;
  if (diaSemana(f) === 7) { mostrarError('Los domingos está cerrado. Elegí otro día.'); return; }
  elegirFecha(f);
};

async function elegirFecha(f) {
  estado.fecha = f;
  estado.horas.clear();
  mostrarError('');
  pintarDiasSuelta();
  $('#horas-suelta').innerHTML = '<div class="cargando">Buscando horarios libres…</div>';
  const { data, error } = await sb.rpc('disponibilidad', { p_desde: f, p_hasta: f });
  if (error) { $('#horas-suelta').innerHTML = ''; mostrarError(mensajeError(error)); return; }
  estado.libres = new Map();
  for (const r of data) {
    if (!estado.libres.has(r.hora)) estado.libres.set(r.hora, new Set());
    estado.libres.get(r.hora).add(r.consultorio_id);
  }
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

function pintarHorasSuelta() {
  const ini = Number(estado.cfg.hora_apertura), fin = Number(estado.cfg.hora_cierre);
  const hoy = hoyAR(), ahora = horaAR();
  let html = '';
  let alguna = false;
  for (let h = ini; h < fin; h++) {
    if (estado.fecha === hoy && h <= ahora) continue;
    const elegida = estado.horas.has(h);
    const comunes = consultoriosComunes(estado.libres, [...estado.horas, h]);
    const libresH = estado.libres.get(h)?.size || 0;
    const posible = elegida || comunes.size > 0;
    if (libresH > 0) alguna = true;
    const precio = precioHora(estado.precios, estado.cfg, 'suelta', h, estado.fecha);
    const sub = libresH === 0 ? 'Completo' : !posible ? 'No combina' : pesos(precio);
    html += `<button class="hora" data-h="${h}" aria-pressed="${elegida}" ${posible && libresH ? '' : 'disabled'}
      aria-label="${horaTxt(h)}, ${sub}"><strong>${horaTxt(h)}</strong><small>${sub}</small></button>`;
  }
  $('#horas-suelta').innerHTML = alguna ? html : '<p class="aviso aviso-alerta">No quedan horarios libres este día. Probá con otro.</p>';
  $('#horas-suelta').querySelectorAll('.hora:not(:disabled)').forEach((b) => (b.onclick = () => {
    const h = Number(b.dataset.h);
    estado.horas.has(h) ? estado.horas.delete(h) : estado.horas.add(h);
    pintarHorasSuelta();
  }));
  pintarConsultorios();
  actualizarBarra();
}

function pintarConsultorios() {
  const paso = $('#paso-consultorio');
  if (!estado.horas.size) { paso.classList.add('oculto'); return; }
  const comunes = consultoriosComunes(estado.libres, [...estado.horas]);
  const sel = $('#consultorio-suelta');
  const previo = sel.value;
  const opciones = estado.consultorios.filter((c) => comunes.has(c.id));
  const hayAuto = opciones.some((c) => c.nombre !== 'Salón');
  sel.innerHTML = (hayAuto ? '<option value="">Cualquiera (te asignamos uno)</option>' : '') +
    opciones.map((c) => `<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  if ([...sel.options].some((o) => o.value === previo)) sel.value = previo;
  paso.classList.remove('oculto');
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
  while (fechas.length < 6) { if (diaSemana(f) === d) fechas.push(f); f = sumarDias(f, 1); }
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
    const horas = [...estado.horas];
    const total = horas.reduce((s, h) => s + precioHora(estado.precios, estado.cfg, 'suelta', h, estado.fecha), 0);
    return { horas, total, sena: Math.ceil((total * pct) / 100), listo: horas.length > 0 };
  }
  const horas = [...estado.horasFijo];
  const semanal = horas.reduce((s, h) => s + precioHora(estado.precios, estado.cfg, 'fijo', h, estado.desde), 0);
  return { horas, semanal, mensual: Math.round((semanal * 4.33) / 100) * 100, listo: horas.length > 0 && bloquesValidos(estado.horasFijo) };
}

function actualizarBarra() {
  const c = calculo();
  const barra = $('#barra');
  if (!c.horas.length) { barra.classList.add('oculto'); return; }
  barra.classList.remove('oculto');
  const n = c.horas.length === 1 ? '1 hora' : `${c.horas.length} horas`;
  $('#barra-detalle').innerHTML = estado.modo === 'suelta'
    ? `${n} · Total <strong>${pesos(c.total)}</strong><br>Seña para confirmar: <strong>${pesos(c.sena)}</strong>`
    : `${n} por semana · <strong>${pesos(c.semanal)}</strong><br>Aprox. ${pesos(c.mensual)} por mes`;
  $('#btn-continuar').disabled = !c.listo;
}

// ================================================================ DATOS
const abrir = (id) => { $(id).classList.remove('oculto'); document.body.style.overflow = 'hidden'; };
const cerrar = (id) => { $(id).classList.add('oculto'); document.body.style.overflow = ''; };
document.querySelectorAll('[data-cerrar]').forEach((b) => (b.onclick = () => cerrar('#modal-datos')));
$('#modal-datos').addEventListener('click', (e) => { if (e.target.id === 'modal-datos') cerrar('#modal-datos'); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') cerrar('#modal-datos'); });

$('#btn-continuar').onclick = () => {
  const c = calculo();
  const sel = $('#consultorio-suelta');
  const consultorio = sel.value ? sel.options[sel.selectedIndex].text : 'Te asignamos uno';
  const filas = estado.modo === 'suelta'
    ? [['Día', fechaLarga(estado.fecha)], ['Horario', rangos(c.horas)], ['Consultorio', consultorio],
       ['Total', pesos(c.total)], ['Seña (' + (estado.cfg.porcentaje_sena || 50) + '%)', pesos(c.sena)]]
    : [['Día', 'Todos los ' + DIAS[estado.dia].toLowerCase()], ['Desde', fechaLarga(estado.desde)],
       ['Horario', rangos(c.horas)], ['Por semana', pesos(c.semanal)], ['Por mes (aprox.)', pesos(c.mensual)]];
  $('#resumen-datos').innerHTML = filas.map(([a, b]) => `<li><span>${esc(a)}</span><span>${esc(b)}</span></li>`).join('');
  const min = Number(estado.cfg.retencion_suelta_minutos || 120);
  const tiempo = min % 60 === 0 ? `${min / 60} ${min === 60 ? 'hora' : 'horas'}` : `${min} minutos`;
  $('#acepto-texto').textContent = estado.modo === 'suelta'
    ? `Entiendo que el horario se guarda ${tiempo} y se confirma cuando pago la seña de ${pesos(c.sena)}. Si no, se libera solo.`
    : 'Entiendo que es una solicitud: el equipo me escribe por WhatsApp para confirmarla.';
  $('#btn-enviar').textContent = estado.modo === 'suelta' ? 'Reservar' : 'Enviar solicitud';
  $('#aviso-form').classList.add('oculto');
  abrir('#modal-datos');
  setTimeout(() => $('#f-nombre').focus(), 50);
};

$('#form-datos').onsubmit = async (e) => {
  e.preventDefault();
  const nombre = $('#f-nombre').value.trim();
  const whatsapp = $('#f-whatsapp').value.replace(/\D/g, '');
  const profesion = $('#f-profesion').value;
  const aviso = $('#aviso-form');
  const falla = (m) => { aviso.textContent = m; aviso.classList.remove('oculto'); };
  if (nombre.length < 2) return falla('Escribí tu nombre y apellido.');
  if (whatsapp.length < 8) return falla('Revisá el WhatsApp: tiene que tener al menos 8 números.');
  if (!$('#f-acepto').checked) return falla('Tenés que aceptar las condiciones para seguir.');
  aviso.classList.add('oculto');

  const btn = $('#btn-enviar');
  btn.disabled = true;
  const textoBtn = btn.textContent;
  btn.textContent = 'Enviando…';
  try {
    if (estado.modo === 'suelta') {
      const cons = $('#consultorio-suelta').value;
      const { data, error } = await sb.rpc('crear_reserva', {
        p_nombre: nombre, p_whatsapp: whatsapp, p_profesion: profesion || null,
        p_fecha: estado.fecha, p_horas: [...estado.horas].sort((a, b) => a - b),
        p_consultorio: cons ? Number(cons) : null,
      });
      if (error) throw error;
      mostrarResultadoSuelta(data, nombre);
    } else {
      const { data, error } = await sb.rpc('crear_solicitud_fijo', {
        p_nombre: nombre, p_whatsapp: whatsapp, p_profesion: profesion || null,
        p_dia: estado.dia, p_horas: [...estado.horasFijo].sort((a, b) => a - b), p_desde: estado.desde,
      });
      if (error) throw error;
      mostrarResultadoFijo(data, nombre);
    }
  } catch (err) {
    falla(mensajeError(err));
    if (err?.message === 'SIN_LUGAR') {
      if (estado.modo === 'suelta') elegirFecha(estado.fecha); else elegirInicioFijo(estado.desde);
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
  const horas = [...estado.horas];
  const alias = estado.cfg.alias_transferencia;
  const titular = estado.cfg.titular_transferencia;
  const wa = estado.cfg.whatsapp_contacto;
  const configurado = (v) => v && v !== 'COMPLETAR';
  const textoWa = `Hola! Soy ${nombre}. Te paso el comprobante de la seña de la reserva #${r.id}: ` +
    `${fechaLarga(estado.fecha)}, ${rangos(horas)}, ${r.consultorio}. Seña: ${pesos(r.sena)}.`;

  $('#contenido-resultado').innerHTML = `
    <div class="icono" aria-hidden="true">✓</div>
    <h2 id="titulo-resultado">¡Tu horario está guardado!</h2>
    <p>Reserva <strong>#${esc(r.id)}</strong> · ${esc(fechaLarga(estado.fecha))}, ${esc(rangos(horas))} · <strong>${esc(r.consultorio)}</strong></p>
    <p class="suave chico" style="margin-bottom:.25em">Para confirmarla, pagá la seña antes de que termine este tiempo:</p>
    <div class="cuenta" id="cuenta" aria-live="polite">${faltan(r.expira_en)}</div>
    <div class="dato-pago">
      <div class="fila"><span>Seña a transferir</span><span class="valor" style="font-size:1.2rem">${pesos(r.sena)}</span></div>
      <div class="fila"><span>Total de la reserva</span><span class="valor">${pesos(r.total)}</span></div>
      ${configurado(alias) ? `<div class="fila"><span>Alias</span><span class="valor">${esc(alias)}</span>
        <button class="btn btn-borde btn-chico" id="copiar-alias">Copiar</button></div>` : ''}
      ${configurado(titular) ? `<div class="fila"><span>Titular</span><span class="valor">${esc(titular)}</span></div>` : ''}
    </div>
    ${configurado(wa) ? `<a class="btn btn-wa btn-bloque" target="_blank" rel="noopener" href="${linkWhatsApp(wa, textoWa)}">Enviar comprobante por WhatsApp</a>` :
      '<p class="aviso aviso-info">Mandanos el comprobante por WhatsApp indicando el número de reserva.</p>'}
    <p class="ayuda" style="margin-top:1em">El saldo (${pesos(r.total - r.sena)}) se abona el día de la reserva. Si la seña no llega a tiempo, el horario se libera automáticamente.</p>
    <button class="btn btn-borde btn-bloque" id="nueva-reserva" style="margin-top:.5em">Hacer otra reserva</button>`;
  abrir('#modal-resultado');

  $('#copiar-alias')?.addEventListener('click', async (e) => {
    try { await navigator.clipboard.writeText(alias); e.target.textContent = '¡Copiado!'; } catch { /* sin permiso */ }
  });
  clearInterval(reloj);
  reloj = setInterval(() => { const el = $('#cuenta'); if (el) el.textContent = faltan(r.expira_en); }, 15000);
  $('#nueva-reserva').onclick = () => { clearInterval(reloj); cerrar('#modal-resultado'); elegirFecha(estado.fecha); };
}

function mostrarResultadoFijo(r, nombre) {
  cerrar('#modal-datos');
  const horas = [...estado.horasFijo];
  const wa = estado.cfg.whatsapp_contacto;
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
  $('#nueva-reserva').onclick = () => { cerrar('#modal-resultado'); elegirInicioFijo(estado.desde); };
}

// ---------------------------------------------------------------- arranque
try {
  await cargarBase();
  pintarDiasSuelta();
  pintarDiasFijo();
  elegirFecha(fechasDisponibles(1)[0]);
} catch (err) {
  mostrarError(mensajeError(err));
}

// Vista "Elegí tu consultorio": plano del piso, fichas con fotos, disponibilidad en vivo,
// agenda semanal por consultorio, comparador y paso directo al formulario de reserva.
import { crearCliente, esc, pesos, hoyAR, horaAR, sumarDias, diaSemana, fechaLarga, horaTxt, rangos, precioHora, mensajeError, DIAS_CORTOS } from './comun.js';
import { WHATSAPP_AYUDA } from './config.js';
import { plano3d, plano2d } from './plano3d.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const foto = (f, chica) => `img/consultorios/${f}${chica ? '-chica' : ''}.jpg`;
const reducido = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------- catálogo
// Lo que se cuenta de cada consultorio (el id es el de la base). Los datos marcados
// como "a confirmar" se completan con el equipo.
const CATALOGO = {
  1: { corto: 'Consultorio 1', lema: 'Amplio y con ventana a la calle: sobrio, para sesiones individuales y entrevistas.', fotos: ['c1-a', 'c1-b'],
       ideal: ['individual'], muebles: ['Escritorio', 'Sillas', 'Ventana a la calle', 'Aire acondicionado'], capacidad: '3 a 4', tipos: ['escritorio'], metros: '3,75 × 4,07 m' },
  2: { corto: 'Consultorio 2', lema: 'Cálido, con sofá y sillones: pensado para la escucha.', fotos: ['c2-a', 'c2-b'],
       ideal: ['individual', 'pareja'], muebles: ['Sofá', 'Sillones', 'Ventana a la calle', 'Aire acondicionado'], capacidad: '3', tipos: ['sillones'], metros: '3,95 × 2,99 m' },
  3: { corto: 'Consultorio 3', lema: 'El más amplio, en la esquina: ventanal redondeado al balcón y mucha luz natural.', fotos: ['c3-a', 'c3-b'],
       ideal: ['individual', 'pareja', 'familia'], muebles: ['Sofá', 'Sillones', 'Ventanal al balcón', 'Aire acondicionado'], capacidad: '4', tipos: ['sillones'], metros: '4,80 × 4,05 m' },
  4: { corto: 'Consultorio 4', lema: 'Sillones enfrentados y ventanales: ideal para terapia de pareja.', fotos: ['c4-a', 'c4-b'],
       ideal: ['individual', 'pareja'], muebles: ['Sillones enfrentados', 'Ventanal al balcón', 'Aire acondicionado'], capacidad: '2', tipos: ['sillones'], metros: '3,25 × 3,50 m' },
  5: { corto: 'Consultorio 5', lema: 'Interno y silencioso, da al pulmón: ideal para evaluar o para sesiones que necesitan calma.', fotos: ['c5-a', 'c5-b'],
       ideal: ['individual', 'evaluacion'], muebles: ['Escritorio', 'Sillones', 'Ventana al pulmón', 'Aire acondicionado'], capacidad: '3', tipos: ['escritorio', 'sillones'], metros: '3,49 × 2,40 m' },
  6: { corto: 'Salón', lema: 'Mesa y escritorio con balcón: grupos chicos, familias, supervisiones y talleres para padres.', fotos: ['c6-a', 'c6-b'],
       ideal: ['grupo', 'familia'], muebles: ['Mesa', 'Escritorio', 'Sillas para 5', 'Balcón', 'Aire acondicionado'], capacidad: '5', tipos: ['escritorio', 'grupos'], metros: '5,50 × 3,50 m' },
};
const PARA = [['todos', 'Todos'], ['individual', 'Individual'], ['pareja', 'Pareja'], ['familia', 'Familia'], ['grupo', 'Grupos y talleres'], ['evaluacion', 'Evaluaciones']];
const TIPOS = [['todos', 'Todos'], ['sillones', '🛋️ Con sillones'], ['escritorio', '🗂️ Con escritorio'], ['grupos', '👥 Para grupos']];
const FRANJAS = [['dia', 'Todo el día'], ['manana', 'Mañana'], ['tarde', 'Tarde']];

// ---------------------------------------------------------------- estado
const sb = await crearCliente();
const st = {
  cfg: {}, precios: [], consultorios: [],
  libres: new Map(),          // fecha → Map(hora → Set(consultorio))
  dias: [],                   // fechas hábiles que se muestran
  fecha: null, franja: 'dia', para: 'todos', tipo: 'todos',
  hora: null,                 // horario elegido en la semana (null = todo el día)
  modo: 'horas',              // 'horas' (flexible) | 'fijo' (todas las semanas)
  libresFijo: null,           // 'fijo-1'…'fijo-6' → Map(hora → Set(consultorio)), libres todas las semanas
  fechaHoras: null,           // el día elegido en "por horas", para volver
  semana: 0,                  // 0 = esta semana, 1 = la que viene
  vistaSemana: 'horario',     // 'horario' | 'consultorio'
  comparar: new Set(),
  seleccion: new Map(),       // ficha abierta: fecha → Set(horas)
  abierto: null,
  vista: (() => { try { return localStorage.getItem('psicostudios-vista-piso') || '4d'; } catch { return '4d'; } })(),   // '4d' | 'plano'
  apuntado: null,             // consultorio con el mouse encima (para el recorrido en 3D)
};

const horasDelDia = () => {
  const ini = Number(st.cfg.hora_apertura || 8), fin = Number(st.cfg.hora_cierre || 21), corte = Number(st.cfg.hora_fin_manana || 13);
  const todas = Array.from({ length: fin - ini }, (_, i) => ini + i);
  return st.franja === 'manana' ? todas.filter((h) => h < corte) : st.franja === 'tarde' ? todas.filter((h) => h >= corte) : todas;
};
const todasLasHoras = () => { const ini = Number(st.cfg.hora_apertura || 8), fin = Number(st.cfg.hora_cierre || 21); return Array.from({ length: fin - ini }, (_, i) => ini + i); };
const esFijo = (f) => String(f).startsWith('fijo-');
const diaFijo = (f) => Number(String(f).slice(5));
const libre = (f, h, c) => !!(esFijo(f) ? st.libresFijo : st.libres)?.get(f)?.get(h)?.has(c);
const PLURAL = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
// "Martes 17 de nov" o, en fijo, "Todos los martes"
const fechaTxt = (f) => (esFijo(f) ? `Todos los ${PLURAL[diaFijo(f)]}` : fechaLarga(f));
// Fechas en que arranca un fijo ese día de la semana (desde mañana, como en la web)
const inicioFijo = (d) => { let f = sumarDias(hoyAR(), 1); while (diaSemana(f) !== d) f = sumarDias(f, 1); return f; };
const libresDe = (f, c, horas = horasDelDia()) => horas.filter((h) => libre(f, h, c));
const personas = (cap) => (/ a /.test(cap) ? `${cap} personas` : `hasta ${cap} ${cap === '1' ? 'persona' : 'personas'}`);
const datos = (c) => CATALOGO[c.id] || { corto: c.nombre, lema: '', fotos: [], ideal: ['individual'], muebles: [], capacidad: null };
const nombreDia = (f) => (esFijo(f) ? DIAS_CORTOS[diaFijo(f)] : f === hoyAR() ? 'Hoy' : f === sumarDias(hoyAR(), 1) ? 'Mañana' : DIAS_CORTOS[diaSemana(f)]);
const precioDesde = () => Math.min(...[8, 14].map((h) => precioHora(st.precios, st.cfg, 'suelta', h, hoyAR())).filter(Boolean));

// ---------------------------------------------------------------- carga
async function cargar() {
  const [c, p, k] = await Promise.all([
    sb.from('config').select('clave, valor'),
    sb.from('precios').select('modalidad, franja, valor, vigente_desde'),
    sb.from('consultorios').select('id, nombre, orden, activo, online').order('orden'),
  ]);
  const error = c.error || p.error || k.error;
  if (error) throw error;
  st.cfg = Object.fromEntries(c.data.map((r) => [r.clave, r.valor]));
  st.precios = p.data;
  st.consultorios = k.data.filter((x) => x.activo && x.online);
  const hoy = hoyAR(), hasta = sumarDias(hoy, 20);
  const { data, error: e2 } = await sb.rpc('disponibilidad', { p_desde: hoy, p_hasta: hasta });
  if (e2) throw e2;
  for (const r of data) {
    if (!st.libres.has(r.fecha)) st.libres.set(r.fecha, new Map());
    const m = st.libres.get(r.fecha);
    if (!m.has(r.hora)) m.set(r.hora, new Set());
    m.get(r.hora).add(r.consultorio_id);
  }
  for (let d = hoy; st.dias.length < 14 && d <= hasta; d = sumarDias(d, 1)) if (diaSemana(d) !== 7) st.dias.push(d);
  // arranca en el primer día con lugar
  st.fecha = st.dias.find((d) => st.libres.has(d)) || st.dias[0];
}

// ---------------------------------------------------------------- filtros
function pintarFiltros() {
  $('#franjas').innerHTML = FRANJAS.map(([k, t]) => `<button type="button" class="chip-f" data-franja="${k}" aria-pressed="${st.franja === k}">${t}</button>`).join('');
  $$('#franjas [data-franja]').forEach((b) => (b.onclick = () => { st.franja = b.dataset.franja; pintarTodo(); }));
  $('#tipos').innerHTML = TIPOS.map(([k, t]) => `<button type="button" class="chip-f chip-tipo" data-tipo="${k}" aria-pressed="${st.tipo === k}">${t}</button>`).join('');
  $$('#tipos [data-tipo]').forEach((b) => (b.onclick = () => { st.tipo = b.dataset.tipo; pintarTodo(); }));
  $$('[data-modo]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.modo === st.modo));
  $('#titulo-dia').textContent = st.hora !== null ? `${fechaTxt(st.fecha)} · ${horaTxt(st.hora)}`
    : `${fechaTxt(st.fecha)}${st.franja === 'dia' ? '' : st.franja === 'manana' ? ' · a la mañana' : ' · a la tarde'}`;
}

// ---------------------------------------------------------------- plano del piso (croquis)
// Estado de cada consultorio en el día y la franja elegidos: libre / pocas horas / completo
function estadoDe(c) {
  if (st.hora !== null) return libre(st.fecha, st.hora, c.id) ? ['libre', `Libre ${horaTxt(st.hora)}`] : ['completo', `Ocupado ${horaTxt(st.hora)}`];
  const hs = horasDelDia(), n = libresDe(st.fecha, c.id, hs).length;
  if (!n) return ['completo', 'Completo'];
  if (n <= Math.max(2, Math.round(hs.length / 4))) return ['pocas', `${n} h libres`];
  return ['libre', `${n} h libres`];
}
// El plano: 4D (modelo 3D que se gira y se recorre) o plano visto desde arriba.
// Si el dispositivo no puede mostrar 3D, queda la vista en perspectiva dibujada.
let motor = null, motorFalla = false;
function salasPlano() {
  const visibles = new Set(filtrados().map((c) => c.id));
  return st.consultorios.map((c) => {
    const [clase, texto] = estadoDe(c), d = datos(c);
    return { id: c.id, nombre: esc(d.corto.replace('Consultorio ', 'Cons. ')), texto: esc(texto), estado: clase,
             apagada: !visibles.has(c.id), activa: st.abierto === c.id || st.apuntado === c.id };
  });
}
async function pintarPlano() {
  $$('[data-vista-plano]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.vistaPlano === st.vista));
  $('#ayuda-4d').classList.toggle('oculto', st.vista !== '4d' || motorFalla);
  const salas = salasPlano();
  if (st.vista === '4d' && !motorFalla) {
    if (!motor) {
      $('#plano').innerHTML = '<div class="l4-lienzo" id="lienzo-4d"><div class="cargando">Armando el piso en 3D…</div></div>';
      try {
        const { crear4d } = await import('./plano4d.js');
        motor = await crear4d($('#lienzo-4d'), { onTocar: (id) => entrarA(id), onComun: () => abrirComunes() });
      } catch (e) {
        console.warn('Sin 3D, uso la vista dibujada', e);
        motorFalla = true;
        return pintarPlano();
      }
    }
    motor.pintar(salas, st.abierto);
    return;
  }
  if (motor) { motor.destruir(); motor = null; }
  $('#plano').innerHTML = st.vista === 'plano' ? plano2d(salas) : plano3d(salas, { destino: st.abierto || st.apuntado, giro: 1 });
  conectarPlano();
}

// Al tocar un consultorio: en 4D la cámara entra hasta adentro y después se abre la ficha
function entrarA(id) {
  if (motor && !reducido()) { motor.entrar(id, () => abrirFicha(id)); return; }
  abrirFicha(id);
}

function conectarPlano() {
  $$('#plano [data-cons]').forEach((g) => {
    const abrir = () => entrarA(Number(g.dataset.cons));
    g.onclick = abrir;
    g.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); } };
    g.onmouseenter = () => $(`.card[data-card="${g.dataset.cons}"]`)?.classList.add('resaltada');
    g.onmouseleave = () => $(`.card[data-card="${g.dataset.cons}"]`)?.classList.remove('resaltada');
  });
  $$('#plano [data-comun]').forEach((comun) => {
    comun.onclick = () => abrirComunes();
    comun.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrirComunes(); } };
  });
}
// Al pasar por una ficha se marca el consultorio y el camino desde la entrada
function apuntar(id) {
  if (st.apuntado === id) return;
  st.apuntado = id;
  if (motor) motor.resaltar(id);
  else if (st.vista !== 'plano') pintarPlano();
}
$$('[data-vista-plano]').forEach((b) => (b.onclick = () => {
  st.vista = b.dataset.vistaPlano;
  try { localStorage.setItem('psicostudios-vista-piso', st.vista); } catch { /* sin almacenamiento */ }
  pintarPlano();
}));
$('#vista-general').onclick = () => motor?.general();

// ---------------------------------------------------------------- fichas
const filtrados = () => st.consultorios.filter((c) => st.tipo === 'todos' || (datos(c).tipos || []).includes(st.tipo));

// ---------------------------------------------------------------- la semana (primer pantallazo)
const diasSemana = () => (st.modo === 'fijo' ? [1, 2, 3, 4, 5, 6].map((d) => `fijo-${d}`) : st.dias.slice(st.semana * 6, st.semana * 6 + 6));
const fechaCortaTxt = (f) => (esFijo(f) ? 'c/semana' : `${Number(f.slice(8))}/${Number(f.slice(5, 7))}`);

// Horario fijo: lo que está libre TODAS las semanas, para cada día (se pide a la base una sola vez)
async function cargarFijo() {
  if (st.libresFijo) return;
  const res = await Promise.all([1, 2, 3, 4, 5, 6].map((d) => sb.rpc('disponibilidad_fijo', { p_dia: d, p_desde: inicioFijo(d) })));
  const err = res.find((r) => r.error)?.error;
  if (err) throw err;
  st.libresFijo = new Map();
  res.forEach(({ data }, i) => {
    const m = new Map();
    for (const r of data) { if (!m.has(r.hora)) m.set(r.hora, new Set()); m.get(r.hora).add(r.consultorio_id); }
    st.libresFijo.set(`fijo-${i + 1}`, m);
  });
}
async function cambiarModo(modo) {
  if (modo === st.modo) return;
  if (modo === 'fijo') {
    try { await cargarFijo(); } catch (e) { return avisar(mensajeError(e)); }
    st.fechaHoras = st.fecha;
    st.fecha = `fijo-${diaSemana(st.fecha) === 7 ? 1 : diaSemana(st.fecha)}`;
  } else st.fecha = st.fechaHoras || st.dias[0];
  st.modo = modo; st.hora = null;
  pintarTodo();
}
// En fijo, por la tarde se piden al menos 2 horas seguidas (misma regla que la web)
function horasParaFijo(f, h, c) {
  const corte = Number(st.cfg.hora_fin_manana || 13), minTarde = Number(st.cfg.min_horas_fijo_tarde || 2);
  if (h < corte || minTarde < 2) return [h];
  if (libre(f, h + 1, c)) return [h, h + 1];
  if (h - 1 >= corte && libre(f, h - 1, c)) return [h - 1, h];
  return null;
}
function bloquesFijoValidos(horas) {
  const hs = [...horas].sort((a, b) => a - b), corte = Number(st.cfg.hora_fin_manana || 13);
  const minM = Number(st.cfg.min_horas_fijo_manana || 1), minT = Number(st.cfg.min_horas_fijo_tarde || 2);
  let ini = 0;
  for (let i = 1; i <= hs.length; i++) {
    if (i < hs.length && hs[i] === hs[i - 1] + 1) continue;
    if (i - ini < (hs[i - 1] >= corte ? minT : minM)) return false;
    ini = i;
  }
  return hs.length > 0;
}
const linkFijo = (f, horas, c) => `index.html?fijo=${diaFijo(f)}&h=${horas.join(',')}&c=${c}${new URLSearchParams(location.search).has('demo') ? '&demo' : ''}#reservar`;
function pintarSemana() {
  const dias = diasSemana(), hs = horasDelDia(), lista = filtrados();
  $('#sem-rango').textContent = st.modo === 'fijo' ? 'Libre todas las semanas, desde la próxima'
    : dias.length ? `${fechaCortaTxt(dias[0])} al ${fechaCortaTxt(dias[dias.length - 1])}` : '';
  $('#titulo-semana').textContent = st.modo === 'fijo' ? 'Horario fijo: qué hay libre todas las semanas' : 'Disponibilidad de la semana';
  $('#sem-ant').classList.toggle('oculto', st.modo === 'fijo'); $('#sem-sig').classList.toggle('oculto', st.modo === 'fijo');
  $('#sem-ant').disabled = st.semana === 0;
  $('#sem-sig').disabled = (st.semana + 1) * 6 >= st.dias.length;
  $$('[data-vista-sem]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.vistaSem === st.vistaSemana));
  const cabeza = `<thead><tr><th></th>${dias.map((f) => `<th scope="col"><button type="button" class="sem-dia ${f === st.fecha ? 'hoy' : ''}" data-dia="${f}">
    ${esc(nombreDia(f))}<small>${fechaCortaTxt(f)}</small></button></th>`).join('')}</tr></thead>`;
  if (st.vistaSemana === 'horario') {
    const max = Math.max(1, lista.length);
    $('#semana').innerHTML = `<table class="sem-tabla" aria-label="Consultorios libres por día y horario">${cabeza}<tbody>${hs.map((h) => `<tr><th scope="row">${horaTxt(h)}</th>${dias.map((f) => {
      const n = lista.filter((c) => libre(f, h, c.id)).length, nivel = n ? Math.min(4, Math.ceil((n / max) * 4)) : 0;
      const sel = st.fecha === f && st.hora === h;
      return `<td><button type="button" class="sem-celda n${nivel} ${sel ? 'sel' : ''}" data-f="${f}" data-h="${h}" ${n ? '' : 'disabled'}
        aria-label="${esc(fechaTxt(f))} ${horaTxt(h)}: ${n ? `${n} ${n === 1 ? 'consultorio libre' : 'consultorios libres'}` : 'completo'}">${n || '–'}</button></td>`;
    }).join('')}</tr>`).join('')}</tbody></table>`;
    $('#sem-leyenda').innerHTML = st.modo === 'fijo' ? 'Cada casilla dice cuántos consultorios están libres ese día y hora todas las semanas. Tocá una para verlos.'
      : 'Cada casilla dice cuántos consultorios hay libres. Tocá una para verlos.';
  } else {
    $('#semana').innerHTML = `<table class="sem-tabla por-cons" aria-label="Disponibilidad de cada consultorio">${cabeza}<tbody>${lista.map((c) => `<tr><th scope="row">${esc(datos(c).corto.replace('Consultorio ', 'Cons. '))}</th>${dias.map((f) => {
      const libres = libresDe(f, c.id, hs);
      return `<td><button type="button" class="sem-cons" data-f="${f}" data-c="${c.id}" aria-label="${esc(datos(c).corto)}, ${esc(fechaTxt(f))}: ${libres.length ? 'libre ' + esc(rangos(libres)) : 'completo'}">
        <span class="mini">${hs.map((h) => `<i class="${libre(f, h, c.id) ? 'l' : 'o'}"></i>`).join('')}</span><small>${libres.length ? `${libres.length} h` : 'Completo'}</small></button></td>`;
    }).join('')}</tr>`).join('')}</tbody></table>`;
    $('#sem-leyenda').innerHTML = 'Verde: horas libres de cada consultorio. Tocá un día para elegir horarios.';
  }
  $$('#semana .sem-dia').forEach((b) => (b.onclick = () => { st.fecha = b.dataset.dia; st.hora = null; pintarTodo(); }));
  $$('#semana .sem-celda').forEach((b) => (b.onclick = () => {
    const f = b.dataset.f, h = Number(b.dataset.h);
    if (st.fecha === f && st.hora === h) { st.hora = null; } else { st.fecha = f; st.hora = h; }
    pintarTodo();
    if (st.hora !== null) $('#slot').scrollIntoView({ behavior: reducido() ? 'auto' : 'smooth', block: 'nearest' });
  }));
  $$('#semana .sem-cons').forEach((b) => (b.onclick = () => { st.fecha = b.dataset.f; abrirFicha(Number(b.dataset.c)); }));
}
// Al elegir un horario: los consultorios libres en ese momento, para reservar directo
function pintarSlot() {
  const caja = $('#slot');
  if (st.hora === null) { caja.classList.add('oculto'); return; }
  const libres = filtrados().filter((c) => libre(st.fecha, st.hora, c.id));
  caja.classList.remove('oculto');
  caja.innerHTML = `<div class="slot-cab"><h3>${esc(fechaTxt(st.fecha))} · ${horaTxt(st.hora)} a ${horaTxt(st.hora + 1)}</h3>
      <span class="suave">${libres.length} ${libres.length === 1 ? 'consultorio libre' : 'consultorios libres'}${st.tipo === 'todos' ? '' : ' ' + TIPOS.find((t) => t[0] === st.tipo)[1].replace(/^\S+ /, '').toLowerCase()}</span>
      <button type="button" class="lnk-4d" id="slot-quitar">Quitar horario</button></div>
    <div class="slot-lista">${libres.map((c) => {
      const d = datos(c);
      return `<div class="slot-item"><img src="${foto(d.fotos[0], true)}" alt="" width="640" height="427" loading="lazy">
        <div><strong>${esc(d.corto)}</strong><small>${esc((d.tipos || []).map((t) => TIPOS.find((x) => x[0] === t)?.[1].replace(/^\S+ /, '')).join(' · '))} · 👥 ${esc(personas(d.capacidad))}</small></div>
        ${st.modo === 'fijo' ? (() => {
          const hs = horasParaFijo(st.fecha, st.hora, c.id);
          return hs ? `<a class="btn btn-primario btn-chico" href="${linkFijo(st.fecha, hs, c.id)}">Pedir fijo ${esc(rangos(hs))}</a>`
            : '<span class="suave chico">Por la tarde el fijo es de 2 horas seguidas y la de al lado está ocupada</span>';
        })() : `<button type="button" class="btn btn-primario btn-chico" data-reservar="${c.id}">Reservar ${horaTxt(st.hora)}</button>`}</div>`;
    }).join('')}</div>
    <p class="suave chico">En el mapa de abajo los ves marcados en verde.</p>`;
  $('#slot-quitar').onclick = () => { st.hora = null; pintarTodo(); };
  $$('#slot [data-reservar]').forEach((b) => (b.onclick = () => abrirFicha(Number(b.dataset.reservar), { fecha: st.fecha, hora: st.hora })));
}
$$('[data-modo]').forEach((b) => (b.onclick = () => cambiarModo(b.dataset.modo)));
$$('[data-vista-sem]').forEach((b) => (b.onclick = () => { st.vistaSemana = b.dataset.vistaSem; pintarSemana(); }));
$('#sem-ant').onclick = () => { st.semana = Math.max(0, st.semana - 1); st.hora = null; st.fecha = diasSemana()[0]; pintarTodo(); };
$('#sem-sig').onclick = () => { st.semana++; st.hora = null; st.fecha = diasSemana()[0]; pintarTodo(); };

// Línea de tiempo del día: una celda por hora (libre / ocupada), con las horas escritas
function linea(f, c, chica = false) {
  const hs = todasLasHoras(), corte = horasDelDia();
  return `<div class="linea ${chica ? 'chica' : ''}" role="img" aria-label="Libre: ${esc(rangos(libresDe(f, c, hs)) || 'nada')}">
    ${hs.map((h) => `<span class="${libre(f, h, c) ? 'l' : 'o'} ${corte.includes(h) ? '' : 'fuera'}" title="${horaTxt(h)} · ${libre(f, h, c) ? 'libre' : 'ocupado'}"></span>`).join('')}</div>
    <div class="linea-ejes ${chica ? 'chica' : ''}"><span>${horaTxt(hs[0])}</span><span>${horaTxt(Number(st.cfg.hora_fin_manana || 13))}</span><span>${horaTxt(hs[hs.length - 1] + 1)}</span></div>`;
}
function proximoLibre(c) {
  if (st.modo === 'fijo') return null;
  for (const d of st.dias) if (d > st.fecha && libresDe(d, c).length) return d;
  return null;
}
function pintarFichas() {
  const lista = filtrados().map((c) => [c, estadoDe(c)]).sort((a, b) => ({ libre: 0, pocas: 1, completo: 2 }[a[1][0]] - { libre: 0, pocas: 1, completo: 2 }[b[1][0]]));
  const ahora = horaAR();
  $('#cantidad').textContent = `${lista.length} ${lista.length === 1 ? 'espacio' : 'espacios'}`;
  $('#fichas').innerHTML = lista.map(([c, [clase, texto]]) => {
    const d = datos(c), libres = libresDe(st.fecha, c.id), prox = !libres.length && proximoLibre(c.id);
    const ahoraLibre = st.fecha === hoyAR() && libre(st.fecha, ahora + 1, c.id);
    return `<article class="card" data-card="${c.id}">
      <button type="button" class="card-foto" data-abrir="${c.id}" aria-label="Ver ${esc(d.corto)}">
        ${d.fotos[0] ? `<img src="${foto(d.fotos[0], true)}" alt="" loading="lazy" width="640" height="427">` : ''}
        <span class="estado-pill ${clase}">${clase === 'completo' ? 'Completo' : clase === 'pocas' ? 'Pocas horas' : 'Disponible'}</span>
        ${ahoraLibre ? `<span class="ya-pill">Libre a las ${horaTxt(ahora + 1)}</span>` : ''}
        ${d.fotos.length > 1 ? `<span class="n-fotos">📷 ${d.fotos.length}</span>` : ''}
      </button>
      <div class="card-cuerpo">
        <div class="card-cab"><h3>${esc(d.corto)}</h3>${d.capacidad ? `<span class="cap" title="Capacidad">👥 ${esc(personas(d.capacidad))}</span>` : ''}</div>
        <p class="lema">${esc(d.lema)}</p>
        <ul class="chips-m">${d.muebles.slice(0, 4).map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
        ${linea(st.fecha, c.id)}
        <p class="libres-txt">${libres.length ? `<strong>Libre:</strong> ${esc(rangos(libres))}` : prox ? `Completo · próximo lugar el <strong>${esc(fechaTxt(prox))}</strong>` : 'Sin lugar en las próximas semanas'}</p>
        <div class="card-acc">
          <button type="button" class="btn btn-primario" data-abrir="${c.id}">Ver y reservar</button>
          <label class="comparar"><input type="checkbox" data-comp="${c.id}" ${st.comparar.has(c.id) ? 'checked' : ''}> Comparar</label>
        </div>
      </div></article>`;
  }).join('') || '<p class="vacio">Ningún consultorio coincide con ese filtro.</p>';
  $$('#fichas [data-abrir]').forEach((b) => (b.onclick = () => abrirFicha(Number(b.dataset.abrir))));
  $$('#fichas [data-comp]').forEach((x) => (x.onchange = () => {
    const id = Number(x.dataset.comp);
    if (x.checked && st.comparar.size >= 3) { x.checked = false; avisar('Se pueden comparar hasta 3 consultorios.'); return; }
    x.checked ? st.comparar.add(id) : st.comparar.delete(id);
    pintarBarraComparar();
  }));
  $$('#fichas .card').forEach((card) => {
    card.onmouseenter = () => { $(`#plano [data-cons="${card.dataset.card}"]`)?.classList.add('hover'); apuntar(Number(card.dataset.card)); };
    card.onmouseleave = () => { $(`#plano [data-cons="${card.dataset.card}"]`)?.classList.remove('hover'); apuntar(null); };
  });
}

// ---------------------------------------------------------------- comparador
function pintarBarraComparar() {
  const b = $('#barra-comp');
  b.classList.toggle('oculto', st.comparar.size < 2);
  $('#barra-comp-txt').textContent = `${st.comparar.size} consultorios elegidos`;
}
function abrirComparar() {
  const lista = st.consultorios.filter((c) => st.comparar.has(c.id));
  $('#comp-cuerpo').innerHTML = `<p class="suave">Disponibilidad: <strong>${esc(fechaTxt(st.fecha))}</strong>. Cambiá el día arriba para comparar otro.</p>
    <div class="comp-grid" style="--n:${lista.length}">${lista.map((c) => {
      const d = datos(c), libres = libresDe(st.fecha, c.id, todasLasHoras());
      return `<div class="comp-col"><img src="${foto(d.fotos[0], true)}" alt="" width="640" height="427">
        <h3>${esc(d.corto)}</h3><p class="lema">${esc(d.lema)}</p>
        <dl><dt>Para</dt><dd>${esc(d.ideal.map((k) => PARA.find((p) => p[0] === k)?.[1]).join(', '))}</dd>
          <dt>Capacidad</dt><dd>${d.capacidad ? esc(personas(d.capacidad)) : '—'}</dd>
          <dt>Tiene</dt><dd>${esc(d.muebles.join(', '))}</dd>
          <dt>Libre</dt><dd>${libres.length ? esc(rangos(libres)) : 'Completo ese día'}</dd></dl>
        ${linea(st.fecha, c.id, true)}
        <button type="button" class="btn btn-primario btn-bloque" data-comp-abrir="${c.id}">Ver y reservar</button></div>`;
    }).join('')}</div>`;
  $$('#comp-cuerpo [data-comp-abrir]').forEach((b) => (b.onclick = () => { cerrar('#modal-comp'); abrirFicha(Number(b.dataset.compAbrir)); }));
  abrir('#modal-comp');
}

// ---------------------------------------------------------------- ficha del consultorio (agenda de la semana)
let fotoActual = 0;
function abrirFicha(id, pre = null) {
  const c = st.consultorios.find((x) => x.id === id);
  if (!c) return;
  st.abierto = id;
  st.seleccion = pre ? new Map([[pre.fecha, new Set([pre.hora])]]) : new Map();
  fotoActual = 0;
  pintarFicha();
  abrir('#ficha');
  pintarPlano();
}
function pintarFicha() {
  const c = st.consultorios.find((x) => x.id === st.abierto), d = datos(c);
  const semana = diasSemana(), hs = todasLasHoras(), corte = Number(st.cfg.hora_fin_manana || 13);
  $('#ficha-cuerpo').innerHTML = `
    <div class="galeria-f" id="galeria-f">
      <div class="g-pista" style="transform:translateX(-${fotoActual * 100}%)">${d.fotos.map((f, i) =>
        `<img src="${foto(f)}" alt="${esc(d.corto)}, foto ${i + 1} de ${d.fotos.length}" width="1280" height="853" ${i ? 'loading="lazy"' : ''}>`).join('')}</div>
      ${d.fotos.length > 1 ? `<button type="button" class="g-nav ant" aria-label="Foto anterior">‹</button><button type="button" class="g-nav sig" aria-label="Foto siguiente">›</button>
        <div class="g-puntos">${d.fotos.map((_, i) => `<span class="${i === fotoActual ? 'on' : ''}"></span>`).join('')}</div>` : ''}
    </div>
    <div class="ficha-info">
      <h2 id="ficha-titulo">${esc(d.corto)}</h2>
      <p class="lema">${esc(d.lema)}</p>
      <div class="ficha-datos">
        <div><span>Ideal para</span><strong>${esc(d.ideal.map((k) => PARA.find((p) => p[0] === k)?.[1]).join(' · '))}</strong></div>
        ${d.capacidad ? `<div><span>Capacidad</span><strong>${esc(personas(d.capacidad).replace(/^h/, 'H'))}</strong></div>` : ''}
        ${d.metros ? `<div><span>Medidas</span><strong>${esc(d.metros)}</strong></div>` : ''}
        <div><span>${st.modo === 'fijo' ? 'Fijo, por hora' : 'Precio por hora'}</span><strong>${pesos(precioHora(st.precios, st.cfg, st.modo === 'fijo' ? 'fijo' : 'suelta', 8, hoyAR()))} mañana · ${pesos(precioHora(st.precios, st.cfg, st.modo === 'fijo' ? 'fijo' : 'suelta', 14, hoyAR()))} tarde</strong></div>
      </div>
      <ul class="chips-m">${d.muebles.map((m) => `<li>${esc(m)}</li>`).join('')}<li>Wifi</li><li>Sala de espera</li></ul>
      <h3 class="agenda-tit">${st.modo === 'fijo' ? 'Elegí tu horario fijo <small>Un día de la semana y sus horas (por la tarde, 2 horas seguidas como mínimo)</small>'
        : 'Elegí días y horas <small>Tocá las horas libres (podés elegir varios días)</small>'}</h3>
      <div class="agenda-scroll"><table class="agenda" aria-label="Agenda de ${esc(d.corto)}">
        <thead><tr><th></th>${semana.map((f) => `<th scope="col" class="${f === st.fecha ? 'hoy-col' : ''}">${esc(nombreDia(f))}<br><small>${esc(fechaCortaTxt(f))}</small></th>`).join('')}</tr></thead>
        <tbody>${hs.map((h) => `<tr class="${h === corte ? 'corte' : ''}"><th scope="row">${horaTxt(h)}</th>${semana.map((f) => {
          const ok = libre(f, h, c.id), sel = st.seleccion.get(f)?.has(h);
          return `<td>${ok ? `<button type="button" class="celda ${sel ? 'sel' : ''}" data-f="${f}" data-h="${h}" aria-pressed="${!!sel}" aria-label="${esc(fechaTxt(f))} ${horaTxt(h)}, libre">${sel ? '✓' : ''}</button>`
            : '<span class="celda ocupada" aria-label="ocupado"></span>'}</td>`;
        }).join('')}</tr>`).join('')}</tbody></table></div>
      <p class="leyenda-ag"><span class="cl"></span> Libre <span class="cs"></span> Elegido <span class="co"></span> Ocupado</p>
    </div>`;
  const g = $('#galeria-f');
  const mover = (n) => { fotoActual = (fotoActual + n + d.fotos.length) % d.fotos.length; $('.g-pista', g).style.transform = `translateX(-${fotoActual * 100}%)`;
    $$('.g-puntos span', g).forEach((s, i) => s.classList.toggle('on', i === fotoActual)); };
  $('.g-nav.ant', g)?.addEventListener('click', () => mover(-1));
  $('.g-nav.sig', g)?.addEventListener('click', () => mover(1));
  let x0 = null;
  g.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  g.addEventListener('touchend', (e) => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) mover(dx < 0 ? 1 : -1); x0 = null; });
  $$('#ficha-cuerpo .celda[data-f]').forEach((b) => (b.onclick = () => {
    const f = b.dataset.f, h = Number(b.dataset.h);
    if (st.modo === 'fijo' && !st.seleccion.has(f) && st.seleccion.size) {   // el fijo es un solo día de la semana
      st.seleccion = new Map();
      $$('#ficha-cuerpo .celda.sel').forEach((x) => { x.classList.remove('sel'); x.setAttribute('aria-pressed', 'false'); x.textContent = ''; });
    }
    if (!st.seleccion.has(f)) st.seleccion.set(f, new Set());
    const s = st.seleccion.get(f);
    if (s.has(h)) s.delete(h);
    else if (s.size >= Number(st.cfg.max_horas_por_reserva || 6)) return avisar(`Hasta ${st.cfg.max_horas_por_reserva || 6} horas por día.`);
    else s.add(h);
    if (!s.size) st.seleccion.delete(f);
    b.classList.toggle('sel', s.has(h)); b.setAttribute('aria-pressed', s.has(h)); b.textContent = s.has(h) ? '✓' : '';
    pintarResumenFicha();
  }));
  pintarResumenFicha();
}
function pintarResumenFicha() {
  const dias = [...st.seleccion.entries()].filter(([, s]) => s.size).sort(([a], [b]) => (a < b ? -1 : 1));
  if (st.modo === 'fijo') {
    const [f, s] = dias[0] || [];
    const horas = s ? [...s].sort((a, b) => a - b) : [];
    const semanal = horas.reduce((t, h) => t + precioHora(st.precios, st.cfg, 'fijo', h, hoyAR()), 0);
    const ok = horas.length && bloquesFijoValidos(horas);
    $('#ficha-pie').innerHTML = horas.length ? `<div><strong>${esc(fechaTxt(f))} · ${esc(rangos(horas))}</strong>
        <br><span class="suave">${pesos(semanal)} por semana · se paga por mes${ok ? '' : ' · <strong style="color:var(--error)">por la tarde, 2 horas seguidas como mínimo</strong>'}</span></div>
        ${ok ? `<a class="btn btn-primario" href="${linkFijo(f, horas, st.abierto)}">Pedir horario fijo</a>` : ''}`
      : '<span class="suave">Elegí un día y sus horas en la agenda.</span>';
    return;
  }
  const total = dias.reduce((t, [f, s]) => t + [...s].reduce((x, h) => x + precioHora(st.precios, st.cfg, 'suelta', h, f), 0), 0);
  const horas = dias.reduce((t, [, s]) => t + s.size, 0);
  const pct = Number(st.cfg.porcentaje_sena || 50);
  const sena = dias.reduce((t, [f, s]) => t + Math.ceil([...s].reduce((x, h) => x + precioHora(st.precios, st.cfg, 'suelta', h, f), 0) * pct / 100), 0);
  $('#ficha-pie').innerHTML = horas ? `<div><strong>${horas} ${horas === 1 ? 'hora' : 'horas'}</strong> · ${dias.map(([f, s]) => `${esc(nombreDia(f))} ${esc(rangos([...s]))}`).join(' · ')}
      <br><span class="suave">Total ${pesos(total)} · seña para confirmar ${pesos(sena)}</span></div>
      <button type="button" class="btn btn-primario" id="ir-reservar">Reservar</button>`
    : `<span class="suave">Elegí una o más horas libres en la agenda.</span>`;
  $('#ir-reservar')?.addEventListener('click', () => {
    const p = dias.map(([f, s]) => `${f}.${st.abierto}.${[...s].sort((a, b) => a - b).join(',')}`).join('|');
    const demo = new URLSearchParams(location.search).has('demo') ? '&demo' : '';
    location.href = `index.html?p=${encodeURIComponent(p)}${demo}#reservar`;
  });
}

// ---------------------------------------------------------------- espacios comunes
function abrirComunes() {
  const fotos = ['espacio-a', 'espacio-c', 'espacio-b'];
  $('#comunes-cuerpo').innerHTML = `<div class="comunes-fotos">${fotos.map((f) => `<img src="${foto(f)}" alt="Espacios comunes" loading="lazy" width="1280" height="853">`).join('')}</div>
    <p>Recepción y sala de espera, en un edificio de pleno Microcentro. Tus pacientes esperan cómodos mientras terminás la sesión anterior.</p>`;
  abrir('#modal-comunes');
}

// ---------------------------------------------------------------- ventanas
function abrir(sel) {
  const m = $(sel); m.classList.remove('oculto'); document.body.style.overflow = 'hidden';
  setTimeout(() => $('[data-cerrar]', m)?.focus(), 30);
}
function cerrar(sel) {
  $(sel).classList.add('oculto');
  if (!$$('.capa:not(.oculto)').length) document.body.style.overflow = '';
  if (sel === '#ficha') { st.abierto = null; pintarPlano(); }
}
$$('[data-cerrar]').forEach((b) => (b.onclick = () => cerrar('#' + b.closest('.capa').id)));
$$('.capa').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) cerrar('#' + m.id); }));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const m = $$('.capa:not(.oculto)').pop(); if (m) cerrar('#' + m.id); } });
$('#btn-comparar').onclick = abrirComparar;
$('#limpiar-comp').onclick = () => { st.comparar.clear(); pintarBarraComparar(); pintarFichas(); };
let tAviso;
function avisar(t) { const a = $('#aviso-flot'); a.textContent = t; a.classList.add('ver'); clearTimeout(tAviso); tAviso = setTimeout(() => a.classList.remove('ver'), 2600); }

function pintarTodo() { pintarFiltros(); pintarSemana(); pintarSlot(); pintarPlano(); pintarFichas(); pintarBarraComparar(); }

// ---------------------------------------------------------------- arranque
$('#wa-ayuda').href = `https://wa.me/${WHATSAPP_AYUDA}?text=${encodeURIComponent('Hola! Quería consultar por los consultorios.')}`;
try {
  await cargar();
  $('#desde-precio').textContent = pesos(precioDesde());
  pintarTodo();
  const q = new URLSearchParams(location.search);
  if (/^\d$/.test(q.get('c') || '')) abrirFicha(Number(q.get('c')));
} catch (err) {
  $('#fichas').innerHTML = `<p class="aviso aviso-error">${esc(mensajeError(err))}</p>`;
}

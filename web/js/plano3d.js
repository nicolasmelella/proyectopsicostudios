// Plano del piso en 3D (vista isométrica, paredes cortadas al frente para ver adentro) y en 2D.
// Todo en SVG: nítido en cualquier pantalla y sin librerías. La distribución sale de piso7.js.
import { PISO } from './piso7.js';

const C30 = Math.cos(Math.PI / 6), S30 = 0.5;
const iso = (x, y, z = 0) => [(x - y) * C30, (x + y) * S30 - z];
const pts = (lista) => lista.map(([x, y, z]) => iso(x, y, z).map((n) => n.toFixed(1)).join(',')).join(' ');
const ALTO = 46, BAJO = 10, GROSOR = 5;

const PISO_COLOR = { libre: '#d9efe2', pocas: '#fbecc6', completo: '#e6e9ef', comun: '#f4e6ee', entrada: '#f6e7a8', servicio: '#eceae4', pasillo: '#eef0f4', aire: '#d6ebf8' };
const BORDE = { libre: '#1f7a4d', pocas: '#c98a10', completo: '#9aa3b2', comun: '#c48aa8', entrada: '#c9a227', servicio: '#c9c4b8', aire: '#8cc3e6' };

function caja(x, y, w, d, h, z0, [t, r, l]) {
  const z1 = z0 + h;
  return `<polygon points="${pts([[x, y + d, z0], [x + w, y + d, z0], [x + w, y + d, z1], [x, y + d, z1]])}" fill="${l}"/>
    <polygon points="${pts([[x + w, y, z0], [x + w, y + d, z0], [x + w, y + d, z1], [x + w, y, z1]])}" fill="${r}"/>
    <polygon points="${pts([[x, y, z1], [x + w, y, z1], [x + w, y + d, z1], [x, y + d, z1]])}" fill="${t}"/>`;
}
const suelo = (x, y, w, d, color, borde, clase = '') =>
  `<polygon points="${pts([[x, y, 0], [x + w, y, 0], [x + w, y + d, 0], [x, y + d, 0]])}" fill="${color}" ${borde ? `stroke="${borde}" stroke-width="2"` : ''} class="${clase}"/>`;

const MADERA = ['#d9b98c', '#b89263', '#a37f52'], TELA = ['#c9c4bd', '#aaa49c', '#958f87'], TELA2 = ['#b7c4d6', '#98a8bf', '#8395ae'];
const BLANCO = ['#fbfaf7', '#e6e2da', '#d6d1c7'], PARED = ['#f7f4ee', '#e3ded4', '#d4cec2'], VIDRIO = '#a9d3f0', PLANTA = ['#9cc79a', '#7aa978', '#6a9668'];
const sofa = (x, y, w, c = TELA) => caja(x, y, w, 8, 22, 0, c) + caja(x, y + 8, w, 18, 12, 0, c);
const sillon = (x, y, c = TELA) => caja(x, y, 24, 6, 22, 0, c) + caja(x, y + 6, 24, 18, 12, 0, c);
const silla = (x, y) => caja(x, y, 12, 12, 12, 0, TELA2) + caja(x, y, 12, 3, 22, 0, TELA2);
const escritorio = (x, y, w = 62, d = 30) => caja(x, y, w, d, 22, 0, MADERA);
const mesita = (x, y) => caja(x, y, 24, 18, 12, 0, MADERA);
const planta = (x, y) => caja(x, y, 18, 18, 30, 0, PLANTA);

// Muebles de cada ambiente, en proporción a su tamaño (x, y, ancho, fondo)
const MUEBLES = {
  1: (x, y, w, d) => escritorio(x + w * 0.3, y + d * 0.25) + silla(x + w * 0.42, y + d * 0.55) + silla(x + w * 0.12, y + d * 0.28) + planta(x + w - 30, y + 10),
  2: (x, y, w, d) => sofa(x + 20, y + 20, 26 + w * 0.3) + sillon(x + w * 0.6, y + d * 0.55) + sillon(x + 22, y + d * 0.68) + mesita(x + w * 0.38, y + d * 0.42),
  3: (x, y, w, d) => sofa(x + 30, y + 18, 90) + sillon(x + w * 0.66, y + d * 0.45) + sillon(x + 26, y + d * 0.62) + mesita(x + w * 0.4, y + d * 0.45) + planta(x + w - 34, y + 14),
  4: (x, y, w, d) => sillon(x + 24, y + d * 0.3) + sillon(x + w * 0.58, y + d * 0.58) + mesita(x + w * 0.38, y + d * 0.45),
  5: (x, y, w, d) => escritorio(x + 16, y + 18, 56, 26) + sillon(x + w * 0.6, y + d * 0.45) + silla(x + 30, y + d * 0.58),
  6: (x, y, w, d) => caja(x + w * 0.22, y + d * 0.32, w * 0.42, d * 0.3, 20, 0, MADERA)
    + [[0.14, 0.42], [0.67, 0.42], [0.3, 0.16], [0.48, 0.16], [0.4, 0.66]].map(([a, b]) => silla(x + w * a, y + d * b)).join('')
    + escritorio(x + w * 0.74, y + 16, 60, 26),
  espera: (x, y, w) => sofa(x + 40, y + 70, 80, TELA2) + sofa(x + w - 130, y + 70, 80, TELA2) + planta(x + w / 2 - 9, y + 70) + caja(x + w / 2 - 40, y + 14, 80, 22, 26, 0, BLANCO),
  entrada: (x, y, w, d) => caja(x + w - 70, y + 20, 56, d - 40, 30, 0, ['#e9dcae', '#d3c38c', '#c4b37a']) + caja(x + 20, y + 20, 50, 44, 44, 0, ['#cfd5df', '#b4bcc9', '#a2abb9']),
  bano: (x, y, w, d) => caja(x + 14, y + d - 34, 20, 26, 16, 0, BLANCO) + caja(x + w - 40, y + 12, 28, 20, 24, 0, BLANCO),
  cocina: (x, y, w) => caja(x + 8, y + 8, w - 16, 22, 26, 0, BLANCO),
  deposito: (x, y, w) => caja(x + 10, y + 10, w - 20, 18, 40, 0, ['#d9d4c8', '#c4bfb2', '#b3ad9f']),
};

// Gira el piso 90° (sentido horario) las veces que haga falta: así la vista puede quedar "desde la entrada"
const GIRA_VENTANA = { izq: 'atras', atras: 'der', der: 'frente', frente: 'izq' };
function girar(L, veces) {
  for (let i = 0; i < veces; i++) {
    const H = L.alto;
    const r = ([x, y, w, d]) => [H - y - d, x, d, w];
    const p = ([x, y]) => [H - y, x];
    L = {
      ...L, ancho: L.alto, alto: L.ancho,
      salas: Object.fromEntries(Object.entries(L.salas).map(([k, v]) => [k, r(v)])),
      ventanas: Object.fromEntries(Object.entries(L.ventanas).map(([k, v]) => [k, GIRA_VENTANA[v]])),
      comunes: L.comunes.map((c) => ({ ...c, rect: r(c.rect) })),
      servicio: L.servicio.map((c) => ({ ...c, rect: r(c.rect) })),
      pasillos: L.pasillos.map(r), balcon: r(L.balcon),
      desdeEntrada: L.desdeEntrada.map(p),
      hastaSala: Object.fromEntries(Object.entries(L.hastaSala).map(([k, v]) => [k, v.map(p)])),
    };
  }
  return L;
}

// Paredes: las de atrás altas, las de adelante bajas (corte). Ventana: franja de vidrio en ese lado.
function paredes(x, y, w, d, ventana) {
  let atras = caja(x - GROSOR, y - GROSOR, w + GROSOR, GROSOR, ALTO, 0, PARED) + caja(x - GROSOR, y, GROSOR, d, ALTO, 0, PARED);
  if (ventana === 'atras') atras += `<polygon points="${pts([[x + 18, y, 14], [x + w - 18, y, 14], [x + w - 18, y, ALTO - 6], [x + 18, y, ALTO - 6]])}" fill="${VIDRIO}" opacity=".85"/>`;
  if (ventana === 'izq') atras += `<polygon points="${pts([[x, y + 18, 14], [x, y + d - 18, 14], [x, y + d - 18, ALTO - 6], [x, y + 18, ALTO - 6]])}" fill="${VIDRIO}" opacity=".85"/>`;
  let frente = caja(x, y + d, w, GROSOR, BAJO, 0, PARED) + caja(x + w, y, GROSOR, d + GROSOR, BAJO, 0, PARED);
  if (ventana === 'der') frente += `<polygon points="${pts([[x + w + GROSOR, y + 14, 2], [x + w + GROSOR, y + d - 14, 2], [x + w + GROSOR, y + d - 14, BAJO], [x + w + GROSOR, y + 14, BAJO]])}" fill="${VIDRIO}"/>`;
  if (ventana === 'frente') frente += `<polygon points="${pts([[x + 14, y + d + GROSOR, 2], [x + w - 14, y + d + GROSOR, 2], [x + w - 14, y + d + GROSOR, BAJO], [x + 14, y + d + GROSOR, BAJO]])}" fill="${VIDRIO}"/>`;
  return { atras, frente };
}

function recorrido(L, id) {
  const tramo = L.hastaSala[id];
  if (!tramo) return '';
  const camino = [...L.desdeEntrada, ...tramo];
  const p = camino.map(([a, b]) => iso(a, b, 1).map((n) => n.toFixed(1)).join(',')).join(' ');
  const [fx, fy] = iso(...camino[camino.length - 1], 1);
  return `<polyline points="${p}" class="p3-camino"/><circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="8" class="p3-destino"/>`;
}

const atributos = (s) => (s.tipo === 'consultorio' ? `data-cons="${s.id}"` : s.tipo === 'comun' ? 'data-comun="1"' : '');

/**
 * salas: [{ id, nombre, texto, estado: 'libre'|'pocas'|'completo', apagada, activa }]
 * Devuelve el SVG del piso en 3D.
 */
export function plano3d(salas, { destino, giro = 0 } = {}) {
  const L = girar(PISO, giro);
  const { ancho: W, alto: H } = L;
  const [bx0, by0, bw, bd] = L.balcon;
  const baranda = bw > bd ? caja(bx0, by0 + bd - 3, bw, 3, 16, 0, ['#c9d6e2', '#aebfcf', '#9fb2c4']) : caja(bx0, by0, 3, bd, 16, 0, ['#c9d6e2', '#aebfcf', '#9fb2c4']);
  const base = caja(0, 0, W, H, 4, -4, ['#eef1f6', '#d9dee8', '#ccd3df'])
    + L.pasillos.map(([x, y, w, d]) => suelo(x, y, w, d, PISO_COLOR.pasillo)).join('')
    + suelo(...L.balcon, '#dde6ee', '#b9c6d3') + baranda;
  const lista = [
    ...salas.filter((s) => L.salas[s.id]).map((s) => ({ ...s, tipo: 'consultorio', rect: L.salas[s.id], ventana: L.ventanas[s.id] })),
    ...L.comunes.map((c) => ({ ...c, tipo: 'comun', estado: c.id === 'entrada' ? 'entrada' : 'comun' })),
    ...L.servicio.map((c) => ({ ...c, tipo: 'servicio', estado: c.aire ? 'aire' : 'servicio', texto: '' })),
  ].sort((a, b) => (a.rect[0] + a.rect[1]) - (b.rect[0] + b.rect[1]));
  const ambientes = lista.map((s) => {
    const [x, y, w, d] = s.rect;
    if (s.estado === 'aire') return `<g>${suelo(x, y, w, d, PISO_COLOR.aire, BORDE.aire)}</g>`;   // pulmón: a cielo abierto
    const p = paredes(x, y, w, d, s.ventana);
    const muebles = (MUEBLES[s.id] || (() => ''))(x, y, w, d);
    const clase = s.tipo === 'servicio' ? 'p3-servicio' : `p3-sala ${s.estado} ${s.apagada ? 'apagada' : ''} ${s.activa ? 'activa' : ''}`;
    const accesible = s.tipo === 'servicio' ? '' : `tabindex="0" role="button" aria-label="${s.nombre}${s.texto ? ': ' + s.texto : ''}"`;
    return `<g class="${clase}" ${atributos(s)} ${accesible}>${suelo(x, y, w, d, PISO_COLOR[s.estado], BORDE[s.estado], 'p3-suelo')}${p.atras}${muebles}${p.frente}</g>`;
  }).join('');
  const carteles = lista.map((s) => {
    const [x, y, w, d] = s.rect;
    if (s.tipo === 'servicio') {
      const [cx, cy] = iso(x + w / 2, y + d / 2, s.estado === 'aire' ? 4 : 52);
      return `<text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="middle" class="p3-servicio-txt">${s.nombre}</text>`;
    }
    const [cx, cy] = iso(x + w / 2, y + d / 2, 70);
    const ancho = Math.max(s.nombre.length * 17, (s.texto || '').length * 12.5) + 30;
    return `<g class="p3-cartel ${s.estado}" ${atributos(s)} transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})">
      <rect x="${-ancho / 2}" y="-34" width="${ancho}" height="66" rx="14"/>
      <text y="-6" text-anchor="middle" class="p3-nombre">${s.nombre}</text><text y="22" text-anchor="middle" class="p3-estado">${s.texto || ''}</text></g>`;
  }).join('');
  const [bx, by] = bw > bd ? iso(bx0 + bw / 2 - 60, by0 + bd, 0) : iso(bx0 - 40, by0 + bd * 0.86, 0);
  const x0 = -H * C30 - 30, x1 = W * C30 + 30;
  return `<svg viewBox="${x0.toFixed(0)} -70 ${(x1 - x0).toFixed(0)} ${((W + H) * S30 + 120).toFixed(0)}" role="group" aria-label="Piso 7 en 3D">
    ${base}${ambientes}${recorrido(L, destino)}
    <text x="${bx.toFixed(1)}" y="${(by + 34).toFixed(1)}" text-anchor="middle" class="p3-zona">Balcón · calle</text>
    ${carteles}</svg>`;
}

/** Mismo piso, visto desde arriba */
export function plano2d(salas) {
  const { ancho: W, alto: H } = PISO;
  const rect = ([x, y, w, d], clase, extra = '') => `<rect x="${x}" y="${y}" width="${w}" height="${d}" rx="6" class="${clase}" ${extra}/>`;
  const texto = ([x, y, w, d], a, b, clase = 'pl-nombre') => `<text x="${x + w / 2}" y="${y + d / 2 - (b ? 4 : -8)}" text-anchor="middle" class="${clase}">${a}</text>`
    + (b ? `<text x="${x + w / 2}" y="${y + d / 2 + 24}" text-anchor="middle" class="pl-estado">${b}</text>` : '');
  const ventana = (id, [x, y, w, d]) => ({ izq: `<line x1="${x + 3}" y1="${y + 18}" x2="${x + 3}" y2="${y + d - 18}" class="pl-ventana"/>`,
    atras: `<line x1="${x + 18}" y1="${y + 3}" x2="${x + w - 18}" y2="${y + 3}" class="pl-ventana"/>`,
    frente: `<line x1="${x + 14}" y1="${y + d - 3}" x2="${x + w - 14}" y2="${y + d - 3}" class="pl-ventana"/>` })[PISO.ventanas[id]] || '';
  const cons = salas.filter((s) => PISO.salas[s.id]).map((s) => {
    const r = PISO.salas[s.id];
    return `<g class="pl-sala ${s.estado} ${s.apagada ? 'apagada' : ''} ${s.activa ? 'activa' : ''}" data-cons="${s.id}" tabindex="0" role="button" aria-label="${s.nombre}: ${s.texto}">
      ${rect(r, '')}${ventana(s.id, r)}${texto(r, s.nombre, s.texto)}</g>`;
  }).join('');
  const comunes = PISO.comunes.map((c) => `<g class="pl-comun ${c.id}" data-comun="1" tabindex="0" role="button" aria-label="${c.nombre}: ver fotos">${rect(c.rect, '')}${texto(c.rect, c.nombre, c.texto)}</g>`).join('');
  const servicio = PISO.servicio.map((c) => `${rect(c.rect, c.aire ? 'pl-aire' : 'pl-servicio')}${texto(c.rect, c.nombre, '', 'pl-servicio-txt')}`).join('');
  return `<svg viewBox="-10 -10 ${W + 20} ${H + 60}" role="group" aria-label="Plano del piso 7">
    <rect x="-6" y="-6" width="${W + 12}" height="${H + 12}" rx="14" class="pl-piso"/>
    ${PISO.pasillos.map((r) => rect(r, 'pl-pasillo')).join('')}${rect(PISO.balcon, 'pl-balcon')}
    ${servicio}${comunes}${cons}
    <text x="${W / 2}" y="${H + 40}" text-anchor="middle" class="pl-zona">Balcón · calle</text></svg>`;
}

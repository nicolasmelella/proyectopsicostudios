// Plano del piso en 3D (vista isométrica, paredes cortadas al frente para ver adentro).
// Todo se dibuja en SVG: nítido en cualquier pantalla y sin librerías.
// Coordenadas del croquis: x de 0 a 720, y de 0 a 420 (las mismas del plano 2D); z es la altura.

const C30 = Math.cos(Math.PI / 6), S30 = 0.5;
const iso = (x, y, z = 0) => [(x - y) * C30, (x + y) * S30 - z];
const pts = (lista) => lista.map(([x, y, z]) => iso(x, y, z).map((n) => n.toFixed(1)).join(',')).join(' ');
const ALTO = 46, BAJO = 10, GROSOR = 5;

// Colores del piso según el estado (con un tono más oscuro para los laterales)
const PISO = { libre: '#d9efe2', pocas: '#fbecc6', completo: '#e6e9ef', comun: '#f4e6ee', pasillo: '#e4e8ef' };
const BORDE = { libre: '#1f7a4d', pocas: '#c98a10', completo: '#9aa3b2', comun: '#c48aa8', pasillo: '#c7cedb' };

// Caja con tres caras visibles (arriba, frente derecho y frente izquierdo)
function caja(x, y, w, d, h, z0, color, clase = '') {
  const [t, r, l] = color;
  const z1 = z0 + h;
  return `<g class="${clase}">
    <polygon points="${pts([[x, y + d, z0], [x + w, y + d, z0], [x + w, y + d, z1], [x, y + d, z1]])}" fill="${l}"/>
    <polygon points="${pts([[x + w, y, z0], [x + w, y + d, z0], [x + w, y + d, z1], [x + w, y, z1]])}" fill="${r}"/>
    <polygon points="${pts([[x, y, z1], [x + w, y, z1], [x + w, y + d, z1], [x, y + d, z1]])}" fill="${t}"/></g>`;
}
const MADERA = ['#d9b98c', '#b89263', '#a37f52'], TELA = ['#c9c4bd', '#aaa49c', '#958f87'], TELA2 = ['#b7c4d6', '#98a8bf', '#8395ae'];
const BLANCO = ['#fbfaf7', '#e6e2da', '#d6d1c7'], PARED = ['#f7f4ee', '#e3ded4', '#d4cec2'], VIDRIO = '#a9d3f0';

// Muebles de cada espacio (coordenadas relativas a la esquina del ambiente)
const sofa = (x, y, w, c = TELA) => caja(x, y, w, 8, 22, 0, c) + caja(x, y + 8, w, 18, 12, 0, c);
const sillon = (x, y, c = TELA) => caja(x, y, 24, 6, 22, 0, c) + caja(x, y + 6, 24, 18, 12, 0, c);
const silla = (x, y) => caja(x, y, 12, 12, 12, 0, TELA2) + caja(x, y, 12, 3, 22, 0, TELA2);
const escritorio = (x, y, w = 62, d = 30) => caja(x, y, w, d, 22, 0, MADERA);
const mesita = (x, y) => caja(x, y, 24, 18, 12, 0, MADERA);
const MUEBLES = {
  1: (x, y) => escritorio(x + 50, y + 40) + silla(x + 70, y + 80) + silla(x + 20, y + 40) + caja(x + 115, y + 12, 22, 12, 40, 0, BLANCO),
  2: (x, y) => sofa(x + 20, y + 14, 80) + sillon(x + 100, y + 80) + sillon(x + 18, y + 92) + mesita(x + 60, y + 70),
  3: (x, y) => sofa(x + 30, y + 14, 90) + sillon(x + 118, y + 70) + sillon(x + 20, y + 96) + mesita(x + 70, y + 74),
  4: (x, y) => sillon(x + 40, y + 50) + sillon(x + 120, y + 80) + mesita(x + 82, y + 64) + caja(x + 150, y + 12, 26, 12, 36, 0, BLANCO),
  5: (x, y) => escritorio(x + 18, y + 24) + sillon(x + 96, y + 70) + sillon(x + 30, y + 100) + silla(x + 40, y + 62),
  6: (x, y) => escritorio(x + 230, y + 16, 70, 28) + caja(x + 80, y + 46, 130, 60, 20, 0, MADERA)
    + [[60, 56], [60, 86], [215, 56], [215, 86], [105, 28], [160, 28], [105, 112], [160, 112]].map(([a, b]) => silla(x + a, y + b)).join(''),
  comun: (x, y) => caja(x + 20, y + 20, 70, 26, 28, 0, BLANCO) + sofa(x + 100, y + 96, 70, TELA2) + caja(x + 30, y + 110, 26, 26, 30, 0, ['#9cc79a', '#7aa978', '#6a9668']),
};

// Paredes: las de atrás altas, las de adelante bajas (corte para ver adentro). Ventanal en la pared de atrás.
function paredes(x, y, w, d, ventana) {
  const atras = caja(x - GROSOR, y - GROSOR, w + GROSOR, GROSOR, ALTO, 0, PARED) + caja(x - GROSOR, y, GROSOR, d, ALTO, 0, PARED);
  const vidrio = ventana ? `<polygon points="${pts([[x + 18, y, 14], [x + w - 18, y, 14], [x + w - 18, y, ALTO - 6], [x + 18, y, ALTO - 6]])}" fill="${VIDRIO}" opacity=".85"/>` : '';
  return { atras: atras + vidrio, frente: caja(x, y + d, w, GROSOR, BAJO, 0, PARED) + caja(x + w, y, GROSOR, d + GROSOR, BAJO, 0, PARED) };
}

// Recorrido punteado desde la entrada hasta la puerta del consultorio
function recorrido(sala) {
  if (!sala) return '';
  const [x, y, w, d] = sala;
  const puertaY = y < 182 ? y + d : y, cx = x + w / 2;
  const camino = [[262, 410, 1], [262, 210, 1], [cx, 210, 1], [cx, puertaY, 1], [cx, y < 182 ? puertaY - 30 : puertaY + 30, 1]];
  const p = camino.map(([a, b, c]) => iso(a, b, c).map((n) => n.toFixed(1)).join(',')).join(' ');
  const [fx, fy] = iso(...camino[camino.length - 1]);
  return `<polyline points="${p}" class="p3-camino"/><circle cx="${fx.toFixed(1)}" cy="${fy.toFixed(1)}" r="7" class="p3-destino"/>`;
}

/**
 * salas: [{ id, rect:[x,y,w,d], nombre, estado:'libre'|'pocas'|'completo', texto, ventana, apagada, activa }]
 * devuelve el SVG del piso en 3D
 */
export function plano3d(salas, { destino } = {}) {
  const piso = caja(0, 0, 720, 420, 4, -4, ['#eef1f6', '#d9dee8', '#ccd3df']);
  const pasillo = `<polygon points="${pts([[20, 182, 0], [700, 182, 0], [700, 238, 0], [20, 238, 0]])}" fill="${PISO.pasillo}"/>`;
  const comun = { id: 'comun', rect: [180, 250, 190, 150], nombre: 'Recepción', texto: 'y sala de espera', estado: 'comun' };
  const todas = [...salas, comun].sort((a, b) => (a.rect[0] + a.rect[1]) - (b.rect[0] + b.rect[1]));
  const ambientes = todas.map((s) => {
    const [x, y, w, d] = s.rect, p = paredes(x, y, w, d, s.ventana);
    const suelo = `<polygon points="${pts([[x, y, 0], [x + w, y, 0], [x + w, y + d, 0], [x, y + d, 0]])}" fill="${PISO[s.estado]}" stroke="${BORDE[s.estado]}" stroke-width="2" class="p3-suelo"/>`;
    const muebles = (MUEBLES[s.id] || (() => ''))(x, y);
    return `<g class="p3-sala ${s.estado} ${s.apagada ? 'apagada' : ''} ${s.activa ? 'activa' : ''}" ${s.id === 'comun' ? 'data-comun="1"' : `data-cons="${s.id}"`}
        tabindex="0" role="button" aria-label="${s.nombre}: ${s.texto}">${suelo}${p.atras}${muebles}${p.frente}</g>`;
  }).join('');
  // Carteles arriba de cada ambiente (siempre legibles, encima de todo)
  const carteles = todas.map((s) => {
    const [x, y, w, d] = s.rect, [cx, cy] = iso(x + w / 2, y + d / 2, 70);
    const ancho = Math.max(s.nombre.length * 17, s.texto.length * 12.5) + 30;
    return `<g class="p3-cartel ${s.estado}" ${s.id === 'comun' ? 'data-comun="1"' : `data-cons="${s.id}"`} transform="translate(${cx.toFixed(1)},${cy.toFixed(1)})">
      <rect x="${-ancho / 2}" y="-34" width="${ancho}" height="66" rx="14"/>
      <text y="-6" text-anchor="middle" class="p3-nombre">${s.nombre}</text><text y="22" text-anchor="middle" class="p3-estado">${s.texto}</text></g>`;
  }).join('');
  const destinoRect = salas.find((s) => s.id === destino)?.rect;
  const [ex, ey] = iso(262, 420, 0);
  return `<svg viewBox="-378 -48 1012 630" role="group" aria-label="Piso 7 en 3D">
    ${piso}${pasillo}${ambientes}${recorrido(destinoRect)}
    <g transform="translate(${ex.toFixed(1)},${(ey + 24).toFixed(1)})"><text text-anchor="middle" class="p3-entrada">↑ Entrada</text></g>
    ${carteles}</svg>`;
}

// Piso 7 en 3D real (Three.js): se gira con el dedo o el mouse, se acerca con la rueda o pellizcando,
// y al tocar un consultorio la cámara entra hasta adentro. La distribución sale de piso7.js (plano 1:100).
import * as THREE from '../vendor/three/three.module.min.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from '../vendor/three/CSS2DRenderer.js';
import { PISO } from './piso7.js';

const M = 54;                                   // unidades del plano por metro
const W = PISO.ancho / M, H = PISO.alto / M;
const X = (x) => x / M - W / 2, Z = (y) => y / M - H / 2;
const ALTO = 1.45, GROSOR = 0.12, PUERTA = 0.95, ANTEPECHO = 0.75;

const PISOS = { libre: 0xcdebd9, pocas: 0xf8e3a8, completo: 0xdfe2e8, comun: 0xf1dce8, entrada: 0xf3e3a0, servicio: 0xe9e5dd, aire: 0xcfe6f6, pasillo: 0xeef0f4, balcon: 0xdbe5ee };
const MAT = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
const PARED = MAT(0xf7f4ee), CANTO = MAT(0x3a3f4a), MADERA = MAT(0xc9a275), TELA = MAT(0xbdb7ae), TELA2 = MAT(0x9fb1c9), BLANCO = MAT(0xf4f2ed), PLANTA = MAT(0x6f9c6c), MACETA = MAT(0xb7795a);
const VIDRIO = new THREE.MeshStandardMaterial({ color: 0x9fd0f0, transparent: true, opacity: 0.45, roughness: 0.1 });

// ---------------------------------------------------------------- piezas
function caja(grupo, mat, x, z, w, d, h, y0 = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x + w / 2, y0 + h / 2, z + d / 2);
  m.castShadow = true; m.receiveShadow = true;
  grupo.add(m);
  return m;
}
const sofa = (g, x, z, w, mat = TELA) => { caja(g, mat, x, z, w, 0.85, 0.42); caja(g, mat, x, z, w, 0.2, 0.85); caja(g, mat, x, z, 0.18, 0.85, 0.6); caja(g, mat, x + w - 0.18, z, 0.18, 0.85, 0.6); };
const sillon = (g, x, z, mat = TELA) => { caja(g, mat, x, z, 0.8, 0.8, 0.42); caja(g, mat, x, z, 0.8, 0.18, 0.85); };
const silla = (g, x, z) => { caja(g, TELA2, x, z, 0.45, 0.45, 0.45); caja(g, TELA2, x, z, 0.45, 0.08, 0.9); };
const escritorio = (g, x, z, w = 1.3, d = 0.65) => caja(g, MADERA, x, z, w, d, 0.75);
const mesita = (g, x, z) => caja(g, MADERA, x, z, 0.6, 0.45, 0.4);
function planta(g, x, z) {
  const maceta = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.14, 0.35, 16), MACETA); maceta.position.set(x, 0.175, z); maceta.castShadow = true; g.add(maceta);
  const hojas = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), PLANTA); hojas.position.set(x, 0.75, z); hojas.castShadow = true; g.add(hojas);
}
function mesaRedonda(g, x, z, r) {
  const tapa = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 0.06, 40), MADERA); tapa.position.set(x, 0.75, z); tapa.castShadow = true; g.add(tapa);
  const pie = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.2, 0.72, 16), MADERA); pie.position.set(x, 0.36, z); g.add(pie);
}
function alfombra(g, x, z, w, d, color) {
  const a = new THREE.Mesh(new THREE.PlaneGeometry(w, d), MAT(color)); a.rotation.x = -Math.PI / 2; a.position.set(x + w / 2, 0.012, z + d / 2); a.receiveShadow = true; g.add(a);
}

// Muebles de cada ambiente (metros, relativos a la esquina del ambiente)
const MUEBLES = {
  1: (g, x, z, w, d) => { escritorio(g, x + w * 0.3, z + d * 0.28); silla(g, x + w * 0.45, z + d * 0.55); silla(g, x + w * 0.12, z + d * 0.3); planta(g, x + w - 0.4, z + 0.45); alfombra(g, x + w * 0.2, z + d * 0.2, w * 0.6, d * 0.55, 0xe7dccb); },
  2: (g, x, z, w, d) => { sofa(g, x + 0.3, z + 0.2, 1.8); sillon(g, x + w * 0.6, z + d * 0.6); sillon(g, x + 0.35, z + d * 0.68); mesita(g, x + w * 0.42, z + d * 0.45); alfombra(g, x + 0.3, z + d * 0.3, w - 0.6, d * 0.5, 0xd9cfe0); },
  3: (g, x, z, w, d) => { sofa(g, x + 0.6, z + 0.25, 2.0); sillon(g, x + w * 0.66, z + d * 0.5); sillon(g, x + 0.5, z + d * 0.62); mesita(g, x + w * 0.42, z + d * 0.48); planta(g, x + w - 0.45, z + 0.45); alfombra(g, x + 0.5, z + d * 0.3, w - 1, d * 0.5, 0xe8d6c5); },
  4: (g, x, z, w, d) => { sillon(g, x + 0.35, z + d * 0.32); sillon(g, x + w * 0.56, z + d * 0.58); mesita(g, x + w * 0.38, z + d * 0.48); alfombra(g, x + 0.3, z + d * 0.25, w - 0.6, d * 0.6, 0xdde3d3); },
  5: (g, x, z, w, d) => { escritorio(g, x + 0.3, z + 0.3, 1.2, 0.6); sillon(g, x + w * 0.6, z + d * 0.48); silla(g, x + 0.6, z + d * 0.62); },
  6: (g, x, z, w, d) => {
    const cx = x + w * 0.42, cz = z + d * 0.52; mesaRedonda(g, cx, cz, 0.75);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 - Math.PI / 2; silla(g, cx + Math.cos(a) * 1.1 - 0.22, cz + Math.sin(a) * 1.1 - 0.22); }
    escritorio(g, x + w - 1.6, z + 0.3); planta(g, x + 0.45, z + 0.45);
  },
  espera: (g, x, z, w, d) => { sofa(g, x + 0.7, z + d - 1.05, 1.6, TELA2); sofa(g, x + w - 2.4, z + d - 1.05, 1.6, TELA2); planta(g, x + w / 2, z + d - 0.5); caja(g, BLANCO, x + w / 2 - 0.8, z + 0.25, 1.6, 0.5, 1.05); },
  entrada: (g, x, z, w, d) => { for (let i = 0; i < 8; i++) caja(g, MAT(0xe2d39c), x + w - 1.2, z + 0.3 + i * (d - 0.6) / 8, 0.95, (d - 0.6) / 8, 0.12 + i * 0.16); caja(g, MAT(0xc6cdd8), x + 0.35, z + 0.35, 1.0, 1.0, 1.4); },
  bano: (g, x, z, w, d) => { caja(g, BLANCO, x + 0.25, z + d - 0.75, 0.4, 0.6, 0.4); caja(g, BLANCO, x + w - 0.8, z + 0.2, 0.55, 0.45, 0.85); },
  cocina: (g, x, z, w) => caja(g, BLANCO, x + 0.15, z + 0.15, w - 0.3, 0.6, 0.9),
  deposito: (g, x, z, w) => caja(g, MAT(0xd6d0c2), x + 0.2, z + 0.2, w - 0.4, 0.45, 1.3),
};

// ---------------------------------------------------------------- paredes con puerta y ventana
// Puerta: donde el recorrido desde la entrada cruza el borde del consultorio
function puertaDe(id, [x, y, w, d]) {
  const camino = [...PISO.desdeEntrada, ...(PISO.hastaSala[id] || [])];
  const adentro = ([a, b]) => a > x && a < x + w && b > y && b < y + d;
  for (let i = 1; i < camino.length; i++) {
    const [p, q] = [camino[i - 1], camino[i]];
    if (adentro(p) || !adentro(q)) continue;
    for (const [lado, fijo, eje] of [['atras', y, 1], ['frente', y + d, 1], ['izq', x, 0], ['der', x + w, 0]]) {
      const t = (fijo - p[eje]) / (q[eje] - p[eje]);
      if (t < 0 || t > 1 || !Number.isFinite(t)) continue;
      const otro = p[1 - eje] + t * (q[1 - eje] - p[1 - eje]);
      const [lo, hi] = eje ? [x, x + w] : [y, y + d];
      if (otro >= lo && otro <= hi) return { lado, en: otro / M };
    }
  }
  return null;
}
function paredes(g, [x0, y0, w0, d0], { ventana, puerta } = {}) {
  const x = X(x0) + GROSOR / 2, z = Z(y0) + GROSOR / 2, w = w0 / M - GROSOR, d = d0 / M - GROSOR;
  const lados = { atras: [x, z, w, true], frente: [x, z + d - GROSOR, w, true], izq: [x, z, d, false], der: [x + w - GROSOR, z, d, false] };
  for (const [lado, [px, pz, largo, horizontal]] of Object.entries(lados)) {
    const tramo = (desde, hasta, alto = ALTO, y0 = 0) => {
      if (hasta - desde < 0.02) return;
      if (horizontal) { caja(g, PARED, px + desde, pz, hasta - desde, GROSOR, alto, y0); caja(g, CANTO, px + desde, pz, hasta - desde, GROSOR, 0.02, y0 + alto); }
      else { caja(g, PARED, px, pz + desde, GROSOR, hasta - desde, alto, y0); caja(g, CANTO, px, pz + desde, GROSOR, hasta - desde, 0.02, y0 + alto); }
    };
    let cortes = [[0, largo]];
    if (puerta?.lado === lado) {
      // distancia de la puerta desde el comienzo de esa pared
      const centro = (horizontal ? puerta.en - x0 / M : puerta.en - y0 / M) - GROSOR / 2;
      const a = Math.max(0.15, Math.min(largo - PUERTA - 0.15, centro - PUERTA / 2));
      cortes = [[0, a], [a + PUERTA, largo]];   // (paredes cortadas a media altura: la puerta queda abierta)
    }
    for (const [a, b] of cortes) {
      if (ventana === lado && b - a > 1.4) {
        const v0 = a + 0.5, v1 = b - 0.5;
        tramo(a, v0); tramo(v1, b);
        tramo(v0, v1, ANTEPECHO);
        const vidrio = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? v1 - v0 : 0.03, ALTO - ANTEPECHO, horizontal ? 0.03 : v1 - v0), VIDRIO);
        vidrio.position.set(horizontal ? px + (v0 + v1) / 2 : px + GROSOR / 2, ANTEPECHO + (ALTO - ANTEPECHO) / 2, horizontal ? pz + GROSOR / 2 : pz + (v0 + v1) / 2);
        g.add(vidrio);
      } else tramo(a, b);
    }
  }
}
function suelo(grupo, [x0, y0, w0, d0], color, alto = 0.004) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w0 / M, alto, d0 / M), MAT(color));
  m.position.set(X(x0) + w0 / M / 2, alto / 2, Z(y0) + d0 / M / 2);
  m.receiveShadow = true;
  grupo.add(m);
  return m;
}

// ---------------------------------------------------------------- motor
export async function crear4d(cont, { onTocar, onComun }) {
  const reducido = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });   // tira error si no hay WebGL
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  cont.innerHTML = '';
  cont.appendChild(renderer.domElement);
  const etiquetas = new CSS2DRenderer();
  etiquetas.domElement.className = 'l4-capa';
  cont.appendChild(etiquetas.domElement);

  const escena = new THREE.Scene();
  const camara = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
  // de frente, desde la entrada (lado derecho del plano), mirando un poco desde arriba
  const DIR = new THREE.Vector3(1, 1.05, 0.22).normalize();
  const INICIO = { pos: new THREE.Vector3(), mira: new THREE.Vector3(0, 0, 0.2) };
  const RADIO = Math.hypot(W, H) / 2 + 0.6;
  let movido = false;
  const encuadrar = () => {
    const vertical = THREE.MathUtils.degToRad(camara.fov) / 2;
    const horizontal = Math.atan(Math.tan(vertical) * camara.aspect);
    INICIO.pos.copy(DIR).multiplyScalar(RADIO / Math.sin(Math.min(vertical, horizontal)) * 0.72).add(INICIO.mira);
    if (!movido) { camara.position.copy(INICIO.pos); }
  };
  const controles = new OrbitControls(camara, renderer.domElement);
  controles.target.copy(INICIO.mira);
  controles.enableDamping = true; controles.minDistance = 4; controles.maxDistance = 48;
  controles.addEventListener('start', () => { movido = true; });
  controles.maxPolarAngle = 1.32; controles.screenSpacePanning = false;

  escena.add(new THREE.HemisphereLight(0xffffff, 0xd8dde8, 1.6));
  const sol = new THREE.DirectionalLight(0xffffff, 1.6);
  sol.position.set(9, 16, 7); sol.castShadow = true;
  sol.shadow.mapSize.set(1536, 1536);
  Object.assign(sol.shadow.camera, { left: -10, right: 10, top: 10, bottom: -10, near: 1, far: 50 });
  escena.add(sol);

  // base, pasillos, balcón
  const base = new THREE.Mesh(new THREE.BoxGeometry(W + 0.6, 0.25, H + 0.6), MAT(0xdfe4ec));
  base.position.set(0, -0.13, 0); base.receiveShadow = true; escena.add(base);
  PISO.pasillos.forEach((r) => suelo(escena, r, PISOS.pasillo, 0.003));
  suelo(escena, PISO.balcon, PISOS.balcon);
  const [bx, by, bw, bd] = PISO.balcon;
  caja(escena, MAT(0xb9c7d6, { transparent: true, opacity: 0.8 }), X(bx), Z(by + bd) - 0.05, bw / M, 0.05, 1.0);

  // ambientes
  const salasGrupo = new Map();     // id → { grupo, suelo, etiqueta }
  const agregar = (id, rect, { tipo, ventana, nombre }) => {
    const g = new THREE.Group();
    g.userData = { id, tipo };
    const piso = suelo(g, rect, tipo === 'servicio' ? PISOS.servicio : tipo === 'aire' ? PISOS.aire : tipo === 'comun' ? (id === 'entrada' ? PISOS.entrada : PISOS.comun) : PISOS.libre, 0.02);
    piso.userData.esSuelo = true;
    if (tipo !== 'comun' || id === 'entrada') paredes(g, rect, { ventana, puerta: tipo === 'consultorio' ? puertaDe(id, rect) : null });
    const [x, y, w, d] = rect;
    (MUEBLES[id] || (() => {}))(g, X(x), Z(y), w / M, d / M);
    escena.add(g);
    let etiqueta = null;
    if (tipo === 'consultorio' || tipo === 'comun') {
      const div = document.createElement('button');
      div.type = 'button';
      div.className = `l4-cartel ${tipo}`;
      div.innerHTML = `<strong>${nombre}</strong><small></small>`;
      div.onclick = (e) => { e.stopPropagation(); tipo === 'comun' ? onComun() : onTocar(id); };
      etiqueta = new CSS2DObject(div);
      etiqueta.position.set(X(x) + w / M / 2, ALTO + 0.9, Z(y) + d / M / 2);
      escena.add(etiqueta);
    } else {
      const div = document.createElement('span'); div.className = 'l4-servicio'; div.textContent = nombre;
      etiqueta = new CSS2DObject(div); etiqueta.position.set(X(x) + w / M / 2, 0.4, Z(y) + d / M / 2); escena.add(etiqueta);
    }
    salasGrupo.set(String(id), { grupo: g, suelo: piso, etiqueta, rect });
  };
  for (const [id, rect] of Object.entries(PISO.salas)) agregar(Number(id), rect, { tipo: 'consultorio', ventana: PISO.ventanas[id], nombre: id === '6' ? 'Salón' : `Cons. ${id}` });
  PISO.comunes.forEach((c) => agregar(c.id, c.rect, { tipo: 'comun', nombre: c.nombre }));
  PISO.servicio.forEach((c) => agregar(c.id, c.rect, { tipo: c.aire ? 'aire' : 'servicio', nombre: c.nombre }));

  // recorrido desde la entrada (línea punteada que avanza)
  const linea = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ color: 0xc0623a, dashSize: 0.18, gapSize: 0.16 }));
  linea.visible = false; escena.add(linea);
  const marca = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.04, 24), MAT(0xc0623a)); marca.visible = false; escena.add(marca);
  function mostrarCamino(id) {
    const tramo = PISO.hastaSala[id];
    if (!tramo) { linea.visible = marca.visible = false; return; }
    const puntos = [...PISO.desdeEntrada, ...tramo].map(([a, b]) => new THREE.Vector3(X(a), 0.06, Z(b)));
    linea.geometry.dispose(); linea.geometry = new THREE.BufferGeometry().setFromPoints(puntos); linea.computeLineDistances();
    marca.position.copy(puntos[puntos.length - 1]); linea.visible = marca.visible = true;
  }

  // tamaño
  const medir = () => {
    const { clientWidth: w, clientHeight: h } = cont;
    if (!w || !h) return;
    renderer.setSize(w, h); etiquetas.setSize(w, h);
    camara.aspect = w / h; camara.updateProjectionMatrix();
    encuadrar();
  };
  const ro = new ResizeObserver(medir); ro.observe(cont); medir();

  // tocar / pasar el mouse
  const rayo = new THREE.Raycaster(), puntero = new THREE.Vector2();
  const tocado = (ev) => {
    const r = renderer.domElement.getBoundingClientRect();
    puntero.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    rayo.setFromCamera(puntero, camara);
    for (const hit of rayo.intersectObjects([...salasGrupo.values()].map((s) => s.grupo), true)) {
      let o = hit.object;
      while (o && !o.userData?.tipo) o = o.parent;
      if (o?.userData?.tipo === 'consultorio' || o?.userData?.tipo === 'comun') return o.userData;
    }
    return null;
  };
  let abajo = null, apuntado = null, fijo = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { abajo = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!abajo || Math.hypot(e.clientX - abajo[0], e.clientY - abajo[1]) > 6) return;
    const t = tocado(e);
    if (t?.tipo === 'consultorio') onTocar(t.id); else if (t?.tipo === 'comun') onComun();
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const t = tocado(e);
    renderer.domElement.style.cursor = t ? 'pointer' : 'grab';
    const id = t?.tipo === 'consultorio' ? t.id : null;
    if (id !== apuntado) { apuntado = id; resaltar(id); }
  });

  let estados = new Map();
  function resaltar(id) {
    const cual = id ?? fijo;
    for (const [k, s] of salasGrupo) {
      if (s.grupo.userData.tipo !== 'consultorio') continue;
      s.suelo.material.emissive?.setHex(String(cual) === k ? 0x1d3f8a : 0x000000);
      s.suelo.material.emissiveIntensity = String(cual) === k ? 0.25 : 0;
      s.etiqueta.element.classList.toggle('activa', String(cual) === k);
    }
    mostrarCamino(cual);
  }

  // animación de cámara
  let vuelo = null;
  function volarA(pos, mira, luego, dur = 1100) {
    if (reducido) { camara.position.copy(pos); controles.target.copy(mira); luego?.(); return; }
    vuelo = { p0: camara.position.clone(), m0: controles.target.clone(), pos, mira, t0: performance.now(), dur, luego };
  }

  let vivo = true;
  const cuadro = (t) => {
    if (!vivo) return;
    if (vuelo) {
      const k = Math.min(1, (t - vuelo.t0) / vuelo.dur), e = k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
      camara.position.lerpVectors(vuelo.p0, vuelo.pos, e); controles.target.lerpVectors(vuelo.m0, vuelo.mira, e);
      if (k >= 1) { const l = vuelo.luego; vuelo = null; l?.(); }
    }
    if (linea.visible && !reducido) linea.material.dashOffset = -(t / 900) % 1000;
    controles.update();
    renderer.render(escena, camara); etiquetas.render(escena, camara);
    requestAnimationFrame(cuadro);
  };
  requestAnimationFrame(cuadro);

  return {
    // salas: [{ id, texto, estado, apagada }]
    pintar(salas, destino) {
      estados = new Map(salas.map((s) => [String(s.id), s]));
      for (const [k, s] of salasGrupo) {
        const e = estados.get(k);
        if (!e) continue;
        s.suelo.material.color.setHex(PISOS[e.estado] || PISOS.libre);
        s.grupo.visible = true;
        s.grupo.traverse((o) => { if (o.material && o !== s.suelo && o.material !== VIDRIO) o.material.transparent = false; });
        s.etiqueta.element.className = `l4-cartel consultorio ${e.estado} ${e.apagada ? 'apagada' : ''}`;
        s.etiqueta.element.querySelector('small').textContent = e.texto;
        s.etiqueta.element.setAttribute('aria-label', `${s.etiqueta.element.querySelector('strong').textContent}: ${e.texto}`);
      }
      fijo = destino ?? null;
      resaltar(apuntado);
    },
    resaltar(id) { apuntado = id; resaltar(id); },
    entrar(id, luego) {
      const s = salasGrupo.get(String(id));
      if (!s) return luego?.();
      fijo = id; resaltar(id);
      const [x, y, w, d] = s.rect, cx = X(x) + w / M / 2, cz = Z(y) + d / M / 2;
      // se acerca desde el lado de la entrada, a la altura de una persona parada mirando hacia abajo
      const dir = new THREE.Vector3(camara.position.x - cx, 0, camara.position.z - cz).normalize();
      movido = true;
      volarA(new THREE.Vector3(cx + dir.x * 3.6, 5.2, cz + dir.z * 3.6), new THREE.Vector3(cx, 0.5, cz), () => setTimeout(() => luego?.(), 150));
    },
    general() { fijo = null; resaltar(apuntado); volarA(INICIO.pos.clone(), INICIO.mira.clone(), () => { movido = false; }); },
    destruir() { vivo = false; ro.disconnect(); renderer.dispose(); cont.innerHTML = ''; },
  };
}

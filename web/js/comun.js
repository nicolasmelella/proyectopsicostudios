// Funciones compartidas por la web de reservas y el panel.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const ZONA = 'America/Argentina/Buenos_Aires';
export const DIAS = ['', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
export const DIAS_CORTOS = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

export const esDemo = () =>
  SUPABASE_URL === 'COMPLETAR' || new URLSearchParams(location.search).has('demo');

// Crea el cliente de Supabase (o el de demo si todavía no está configurado).
// sesionTemporal = true: la sesión se borra al cerrar el navegador (para el panel).
export async function crearCliente({ sesionTemporal = false } = {}) {
  if (esDemo()) {
    const { crearClienteDemo } = await import('./demo.js');
    const cliente = crearClienteDemo();
    const enPanel = /panel(\.html)?$/.test(location.pathname);
    document.body.insertAdjacentHTML('afterbegin', `
      <div class="demo-banda" role="region" aria-label="Simulador">
        <div class="demo-linea">
          <span><strong>SIMULADOR</strong> · ${globalThis.PSICO_EXCEL ? 'semanas del Excel' : 'datos de prueba'}</span>
          <button type="button" class="demo-btn" data-demo="menu" aria-expanded="false" aria-controls="demo-panel">Herramientas ▾</button>
        </div>
        <div class="demo-panel" id="demo-panel" hidden>
          <p class="demo-nota">Esta barra existe solo en el simulador: en la web real no aparece.</p>
          <a class="demo-opcion" href="${enPanel ? 'index.html' : 'panel.html'}">
            <strong>${enPanel ? '→ Ver la web' : '→ Ver el panel del equipo'}</strong>
            <small>${enPanel ? 'Lo que ven los profesionales al reservar.' : 'Lo que ve el equipo, con las reservas que hiciste acá.'}</small></a>
          <button type="button" class="demo-opcion" data-demo="adelantar">
            <strong>⏩ Adelantar el reloj 2 horas</strong>
            <small>Las reservas sin seña se liberan solas a las 2 horas. Esto simula que ya pasó ese tiempo.</small></button>
          <button type="button" class="demo-opcion" data-demo="reiniciar">
            <strong>↺ Borrar mis pruebas</strong>
            <small>Borra lo que reservaste y pagaste acá y vuelve a los datos de ejemplo.</small></button>
        </div>
        <div class="demo-aviso" role="status"></div>
      </div>`);
    const menu = document.querySelector('[data-demo="menu"]');
    menu.onclick = () => {
      const panel = document.getElementById('demo-panel');
      panel.hidden = !panel.hidden;
      menu.setAttribute('aria-expanded', !panel.hidden);
      menu.textContent = panel.hidden ? 'Herramientas ▾' : 'Cerrar ▴';
    };
    try {
      const aviso = sessionStorage.getItem('psicostudios-demo-aviso');
      if (aviso) { document.querySelector('.demo-aviso').textContent = aviso; sessionStorage.removeItem('psicostudios-demo-aviso'); }
    } catch { /* sin almacenamiento */ }
    document.querySelector('[data-demo="adelantar"]').onclick = () => {
      const n = cliente.demo.adelantar(120);
      const aviso = n ? `⏩ Pasaron 2 horas: ${n === 1 ? 'se liberó 1 reserva' : `se liberaron ${n} reservas`} que no pagaron la seña.`
        : '⏩ Pasaron 2 horas: no había reservas sin seña por vencer.';
      try { sessionStorage.setItem('psicostudios-demo-aviso', aviso); } catch { /* nada */ }
      location.reload();
    };
    document.querySelector('[data-demo="reiniciar"]').onclick = () => {
      preguntar({ titulo: '¿Empezar de cero?', texto: 'Se borra todo lo que hiciste en el simulador y vuelven los datos de ejemplo.', aceptar: 'Reiniciar', peligro: true })
        .then((ok) => {
          if (ok === null) return;
          cliente.demo.reiniciar();
          try { sessionStorage.setItem('psicostudios-demo-aviso', '↺ Listo: se borraron tus pruebas y volvieron los datos de ejemplo.'); } catch { /* nada */ }
          location.href = location.pathname;
        });
    };
    document.querySelector('#form-login h1')?.insertAdjacentHTML('afterend',
      '<p class="aviso aviso-info chico">Simulador: entrá con cualquier usuario y contraseña.</p>');
    return cliente;
  }
  const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: sesionTemporal ? { storage: window.sessionStorage, persistSession: true } : {},
  });
}

// Escapa texto para meterlo en HTML (los nombres vienen de la web pública).
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export const pesos = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

// ---------- Fechas (siempre en hora de Argentina, como 'AAAA-MM-DD') ----------
export function hoyAR() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA }).format(new Date());
}
export function horaAR() {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: ZONA, hour: '2-digit', hour12: false }).format(new Date()));
}
export function sumarDias(fecha, n) {
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// 1 = lunes … 7 = domingo
export function diaSemana(fecha) {
  const d = new Date(fecha + 'T12:00:00Z').getUTCDay();
  return d === 0 ? 7 : d;
}
export function fechaLarga(fecha) {
  const [a, m, d] = fecha.split('-').map(Number);
  return `${DIAS[diaSemana(fecha)]} ${d} de ${MESES[m - 1]}`;
}
export function fechaCorta(fecha) {
  const [, m, d] = fecha.split('-').map(Number);
  return `${d}/${m}`;
}
export const horaTxt = (h) => `${String(h).padStart(2, '0')}:00`;

// Agrupa horas sueltas en rangos: [9,10,11,15] → "09:00 a 12:00 y 15:00 a 16:00"
export function rangos(horas) {
  const hs = [...horas].map(Number).sort((a, b) => a - b);
  const partes = [];
  let ini = hs[0], ant = hs[0];
  for (let i = 1; i <= hs.length; i++) {
    if (hs[i] === ant + 1) { ant = hs[i]; continue; }
    partes.push(`${horaTxt(ini)} a ${horaTxt(ant + 1)}`);
    ini = ant = hs[i];
  }
  return partes.join(' y ');
}

// Cuenta regresiva "1 h 23 min"
export function faltan(iso) {
  const ms = new Date(iso) - new Date();
  if (ms <= 0) return 'vencida';
  const min = Math.ceil(ms / 60000);
  return min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
}

// Precio de una hora según modalidad, franja y fecha (misma regla que la base)
export function precioHora(precios, cfg, modalidad, hora, fecha) {
  const franja = hora < Number(cfg.hora_fin_manana) ? 'manana' : 'tarde';
  const vigentes = precios
    .filter((p) => p.modalidad === modalidad && p.franja === franja && p.vigente_desde <= fecha)
    .sort((a, b) => (a.vigente_desde < b.vigente_desde ? 1 : -1));
  return vigentes[0]?.valor ?? 0;
}

// Traduce los errores de la base a un mensaje para la persona
const MENSAJES = {
  SIN_LUGAR: 'Ese horario se acaba de ocupar. Elegí otro.',
  HORA_PASADA: 'Ese horario ya pasó.',
  DOMINGO: 'Los domingos está cerrado.',
  WHATSAPP_INVALIDO: 'Revisá el WhatsApp: tiene que tener al menos 8 números.',
  NOMBRE_INVALIDO: 'Falta el nombre.',
  EMAIL_INVALIDO: 'Revisá el mail: tiene que ser del tipo nombre@ejemplo.com',
  FALTA_PROFESION: 'Contanos tu profesión.',
  NO_AUTORIZADO: 'Tu usuario no tiene permiso para esto.',
};
export function mensajeError(error) {
  if (!error) return '';
  if (error.hint) return error.hint;
  const msg = error.message || String(error);
  if (MENSAJES[msg]) return MENSAJES[msg];
  if (/Invalid login credentials/i.test(msg)) return 'Usuario o contraseña incorrectos.';
  if (/Failed to fetch|NetworkError/i.test(msg)) return 'No hay conexión. Revisá internet y probá de nuevo.';
  return 'Algo salió mal: ' + msg;
}

export function linkWhatsApp(numero, texto) {
  const n = String(numero || '').replace(/\D/g, '');
  return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
}

// Convierte un número local argentino a formato wa.me (54 9 + área + número)
export function waArgentina(numero) {
  let n = String(numero || '').replace(/\D/g, '');
  if (n.startsWith('54')) return n;
  if (n.startsWith('0')) n = n.slice(1);
  return '549' + n;
}

// Cuadro para confirmar o pedir un dato, con el diseño de la marca.
// (Reemplaza confirm()/prompt() del navegador, que en celulares se ven mal y en algunos lugares no aparecen.)
// Devuelve: null si se cancela; '' al confirmar sin campo; el texto escrito si hay campo.
export function preguntar({ titulo, texto = '', campo = null, aceptar = 'Aceptar', peligro = false }) {
  return new Promise((resolver) => {
    const fondo = document.createElement('div');
    fondo.className = 'modal-fondo';
    fondo.style.zIndex = '70';
    fondo.setAttribute('role', 'dialog');
    fondo.setAttribute('aria-modal', 'true');
    fondo.setAttribute('aria-labelledby', 'preg-titulo');
    fondo.innerHTML = `<form class="modal" style="max-width:440px" novalidate>
      <h2 id="preg-titulo">${esc(titulo)}</h2>
      ${texto ? `<p class="suave">${esc(texto)}</p>` : ''}
      ${campo ? `<div class="campo"><label for="preg-campo">${esc(campo.etiqueta)}</label>
        <input id="preg-campo" type="${campo.tipo || 'text'}" value="${esc(campo.valor ?? '')}" placeholder="${esc(campo.placeholder ?? '')}"></div>` : ''}
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap">
        <button type="button" class="btn btn-borde" data-preg-no>Volver</button>
        <button type="submit" class="btn ${peligro ? 'btn-peligro-lleno' : 'btn-primario'}">${esc(aceptar)}</button>
      </div></form>`;
    const cerrar = (valor) => { fondo.remove(); document.removeEventListener('keydown', tecla, true); resolver(valor); };
    const tecla = (e) => { if (e.key === 'Escape') { e.stopPropagation(); cerrar(null); } };
    document.addEventListener('keydown', tecla, true);
    fondo.querySelector('[data-preg-no]').onclick = () => cerrar(null);
    fondo.addEventListener('click', (e) => { if (e.target === fondo) cerrar(null); });
    fondo.querySelector('form').onsubmit = (e) => {
      e.preventDefault();
      cerrar(campo ? fondo.querySelector('#preg-campo').value.trim() : '');
    };
    document.body.appendChild(fondo);
    setTimeout(() => (fondo.querySelector('#preg-campo') || fondo.querySelector('[type=submit]')).focus(), 30);
  });
}

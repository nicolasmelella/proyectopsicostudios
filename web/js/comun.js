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
    document.body.insertAdjacentHTML('afterbegin',
      '<div class="demo-banda">MODO DEMO · datos de prueba, nada se guarda de verdad</div>');
    return crearClienteDemo();
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

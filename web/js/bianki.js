// Bianki: entiende un pedido escrito ("quiero consultorio el lunes a las 14 con escritorio") y lo
// convierte en una búsqueda. Primero prueba con la IA (función del servidor "bianki"); si no está
// disponible, usa las reglas de este archivo. Bianki solo BUSCA: no reserva ni cobra.
//
// Resultado (igual para la IA y para las reglas):
//   { entendido, modo: 'horas'|'fijo'|null, fecha: 'AAAA-MM-DD'|null, dia_semana: 1..6|null,
//     hora: 8..20|null, franja: 'manana'|'tarde'|null, tipo: 'sillones'|'escritorio'|'grupos'|null }

const DIAS = { lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, sabados: 6 };
const sinTildes = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '');
const sumar = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const diaDe = (f) => { const d = new Date(f + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };

export function entender(texto, hoy) {
  const t = ' ' + sinTildes(String(texto || '').toLowerCase()).replace(/[¿?¡!.,;]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const r = { entendido: false, modo: null, fecha: null, dia_semana: null, hora: null, franja: null, tipo: null };

  // tipo de consultorio
  if (/\b(sillon|sillones|sofa|divan|sillas comodas)\b/.test(t)) r.tipo = 'sillones';
  else if (/\b(escritorio|mesa de trabajo)\b/.test(t)) r.tipo = 'escritorio';
  if (/\b(grupo|grupos|grupal|taller|talleres|supervision|supervisiones|salon)\b/.test(t)) r.tipo = 'grupos';

  // fijo o por horas
  if (/\b(fijo|fija|todas las semanas|cada semana|semanal|semanalmente|todos los (lunes|martes|miercoles|jueves|viernes|sabados))\b/.test(t)) r.modo = 'fijo';
  else if (/\b(por hora|por horas|suelta|sueltas|una vez|solo ese dia)\b/.test(t)) r.modo = 'horas';

  // franja ("a la mañana" no es "mañana" = el día siguiente)
  const franjaManana = /\b(a|por|de|en) la manana\b|\bmanana temprano\b|\btemprano\b|\bal mediodia\b/.test(t);
  if (/\b(a|por|de|en) la tarde\b|\btardecita\b|\ba la noche\b|\bde noche\b/.test(t)) r.franja = 'tarde';
  else if (franjaManana) r.franja = 'manana';

  // día
  const sinFranja = t.replace(/\b(a|por|de|en) la manana\b/g, ' ').replace(/\bmanana temprano\b/g, ' temprano ');
  let m;
  if (/\bpasado manana\b/.test(sinFranja)) r.fecha = sumar(hoy, 2);
  else if (/\bmanana\b/.test(sinFranja)) r.fecha = sumar(hoy, 1);
  else if (/\bhoy\b/.test(t)) r.fecha = hoy;
  else if ((m = /\b(\d{1,2})\/(\d{1,2})\b/.exec(t))) {
    const [a] = hoy.split('-').map(Number);
    let f = `${a}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    if (f < hoy) f = `${a + 1}${f.slice(4)}`;
    if (!Number.isNaN(Date.parse(f + 'T12:00:00Z'))) r.fecha = f;
  }
  const dia = Object.keys(DIAS).find((d) => new RegExp(`\\b${d}\\b`).test(t));
  if (dia) r.dia_semana = DIAS[dia];
  if (!dia && !r.fecha && (m = /\bel (\d{1,2})\b(?! ?(hs|horas|h\b|:))/.exec(t))) {   // "el 25"
    const n = Number(m[1]);
    for (let i = 0, f = hoy; i < 62; i++, f = sumar(f, 1)) if (Number(f.slice(8)) === n) { r.fecha = f; break; }
  }

  // hora: "a las 14", "14 hs", "14:00", "14h", "2 de la tarde", "de 14 a 16"
  const hm = /\b(?:a las|a la|desde las|de|tipo)\s+(\d{1,2})(?::(\d{2}))?\b/.exec(t) || /\b(\d{1,2})(?::\d{2})?\s*(?:hs|horas|h)\b/.exec(t) || /\b(\d{1,2}):\d{2}\b/.exec(t);
  if (hm) {
    let h = Number(hm[1]);
    if (h >= 1 && h <= 7 && (r.franja === 'tarde' || /\bde la tarde\b|\bpm\b/.test(t) || !franjaManana)) h += 12;   // "a las 3" = 15
    if (h >= 8 && h <= 20) r.hora = h;
  }
  if (r.hora !== null && !r.franja) r.franja = r.hora < 13 ? 'manana' : 'tarde';

  r.entendido = !!(r.fecha || r.dia_semana || r.hora !== null || r.tipo || r.modo || r.franja);
  return r;
}

// Completa la fecha: el próximo día de la semana pedido (si es hoy y la hora ya pasó, la semana que viene)
export function completar(r, hoy, horaAhora) {
  const x = { ...r };
  if (!x.fecha && x.dia_semana && x.modo !== 'fijo') {
    let f = hoy;
    while (diaDe(f) !== x.dia_semana) f = sumar(f, 1);
    if (f === hoy && x.hora !== null && x.hora <= horaAhora) f = sumar(f, 7);
    x.fecha = f;
  }
  if (x.fecha && !x.dia_semana) x.dia_semana = diaDe(x.fecha);
  return x;
}

// Pregunta a la IA; si falla o no está, usa las reglas. Devuelve { ...resultado, con: 'ia' | 'reglas' }
export async function preguntar(sb, texto, hoy, { demo = false } = {}) {
  if (!demo) {
    try {
      const { data, error } = await sb.functions.invoke('bianki', { body: { texto: String(texto).slice(0, 200) } });
      if (!error && data && typeof data.entendido === 'boolean') return { ...data, con: 'ia' };
      if (data?.limite) return { entendido: false, limite: true, con: 'ia' };
    } catch { /* sigue con las reglas */ }
  }
  return { ...entender(texto, hoy), con: 'reglas' };
}

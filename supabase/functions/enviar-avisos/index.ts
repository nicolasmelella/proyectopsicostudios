// =====================================================================
// Función del servidor "enviar-avisos" (Supabase Edge Function)
// La llama la base cada minuto (08_avisos.sql). Toma los avisos pendientes
// y los manda por MAIL (Gmail) o WHATSAPP (API de WhatsApp Business).
//
// Secretos (Supabase → Edge Functions → Secrets):
//   AVISOS_SECRETO   → clave que manda la base para poder llamarla (ver README)
//   SITIO_URL        → dirección de la web (para los links)
//   GMAIL_USUARIO    → consultoriospsicostudios@gmail.com
//   GMAIL_CLAVE_APP  → "contraseña de aplicación" de esa cuenta de Google
//   WA_TOKEN, WA_PHONE_ID → solo cuando se conecte la API de WhatsApp Business
// =====================================================================

type Aviso = { id: number; tipo: string; canal: 'email' | 'whatsapp'; destino: string; datos: Record<string, any> };

const variable = (nombre: string) => {
  const v = Deno.env.get(nombre);
  if (!v) throw new Error(`Falta configurar el secreto ${nombre}`);
  return v;
};

async function rpc(fn: string, args: Record<string, unknown>) {
  const clave = variable('SUPABASE_SERVICE_ROLE_KEY');
  const r = await fetch(`${variable('SUPABASE_URL')}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: clave, Authorization: `Bearer ${clave}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  });
  const datos = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`La base respondió ${r.status}: ${JSON.stringify(datos)}`);
  return datos;
}

// ---------------------------------------------------------------- formato
const DIAS = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const diaSemana = (f: string) => { const d = new Date(f + 'T12:00:00Z').getUTCDay(); return d === 0 ? 7 : d; };
export const fechaLarga = (f: string) => { const [, m, d] = f.split('-').map(Number); return `${DIAS[diaSemana(f)]} ${d} de ${MESES[m - 1]}`; };
const fechaCorta = (f: string) => { const [, m, d] = f.split('-').map(Number); return `${DIAS[diaSemana(f)].slice(0, 3)} ${d}/${m}`; };
const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
export function rangos(horas: number[]) {
  const hs = [...horas].map(Number).sort((a, b) => a - b);
  const partes: string[] = [];
  let ini = hs[0], ant = hs[0];
  for (let i = 1; i <= hs.length; i++) {
    if (hs[i] === ant + 1) { ant = hs[i]; continue; }
    partes.push(`${hh(ini)} a ${hh(ant + 1)}`);
    ini = ant = hs[i];
  }
  return partes.join(' y ');
}
export const pesos = (n: number) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');
// "sábado a las 15:25" (hora de Argentina, 24 hs)
const horaAR = (iso: string) => {
  const partes = Object.fromEntries(new Intl.DateTimeFormat('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', weekday: 'long',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${partes.weekday} a las ${partes.hour}:${partes.minute}`;
};
const mayuscula = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const primerNombre = (n: string) => String(n || '').trim().split(/\s+/)[0] || '';
const configurado = (v: unknown) => typeof v === 'string' && v && v !== 'COMPLETAR';
const unaLinea = (t: string) => t.replace(/\s+/g, ' ').trim();  // WhatsApp no acepta saltos de línea en los datos
const DIAS_FIJO = ['', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];

// ---------------------------------------------------------------- mails
const AZUL = '#12275a', FONDO = '#f5f7fb', ROSA = '#eed2e2', LINEA = '#dfe3ea', SUAVE = '#4a597b', ALERTA = '#8a4b00';
// El día anterior a una fecha ('2026-11-19' → '2026-11-18')
const diaAnterior = (f: string) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
const primerTurno = (reservas: any[] = []) => reservas.map((r) => r.fecha).filter(Boolean).sort()[0];

function plantillaMail(titulo: string, cuerpo: string, boton?: { texto: string; url: string }) {
  return `<!doctype html><html lang="es"><body style="margin:0;background:${FONDO};font-family:Arial,Helvetica,sans-serif;color:${AZUL}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${FONDO};padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid ${LINEA}">
<tr><td style="background:${AZUL};padding:18px 24px;color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:1px">PSICO <span style="font-weight:normal;letter-spacing:3px">STUDIOS</span></td></tr>
<tr><td style="padding:24px">
<h1 style="margin:0 0 14px;font-size:21px;line-height:1.3">${titulo}</h1>
<div style="font-size:15px;line-height:1.55">${cuerpo}</div>
${boton ? `<p style="margin:22px 0 4px"><a href="${esc(boton.url)}" style="display:inline-block;background:${ROSA};color:${AZUL};text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:8px">${esc(boton.texto)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:14px 24px 22px;font-size:12px;color:${SUAVE};border-top:1px solid ${LINEA}">
Psico Studios · Consultorios en Microcentro<br>¿Dudas? Respondé este mail o escribinos por WhatsApp.</td></tr>
</table></td></tr></table></body></html>`;
}

function tablaTurnos(reservas: any[] = [], conEstado = false) {
  const etiqueta: Record<string, string> = { confirmada: 'Confirmada', pendiente: 'Sin seña', vencida: 'Vencida', cancelada: 'Cancelada' };
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:10px 0 14px;border-collapse:collapse">${reservas.map((r) =>
    `<tr><td style="padding:9px 0;border-bottom:1px solid ${LINEA}"><strong>${esc(mayuscula(fechaLarga(r.fecha)))}</strong><br>
     <span style="color:${SUAVE}">${esc(rangos(r.horas))}</span></td>
     <td style="padding:9px 0;border-bottom:1px solid ${LINEA};text-align:right"><strong>${esc(r.consultorio)}</strong>${conEstado ? `<br><span style="color:${SUAVE}">${esc(etiqueta[r.estado] || r.estado)}</span>` : ''}</td></tr>`).join('')}</table>`;
}

function cajaTransferencia(t: any = {}, monto?: number, titulo = 'Datos para transferir') {
  const filas = [
    monto ? ['A transferir', pesos(monto)] : null,
    configurado(t.alias) ? ['Alias', t.alias] : null,
    configurado(t.cvu) ? ['CVU', t.cvu] : null,
    configurado(t.titular) ? ['Titular', t.titular] : null,
  ].filter(Boolean) as string[][];
  if (filas.length < 2) return '';
  return `<div style="background:#ffffff;border:1.5px dashed #6f8fb8;border-radius:12px;padding:12px 14px;margin:12px 0">
    <div style="font-weight:bold;margin-bottom:6px">${esc(titulo)}</div>
    ${filas.map(([a, b]) => `<div>${esc(a)}: <strong>${esc(b)}</strong></div>`).join('')}
    <div style="margin-top:6px;color:${SUAVE};font-size:13px">Enviá la reserva por WhatsApp (botón de abajo), transferí y mandá la captura en ese mismo chat.</div></div>`;
}

const linkPedido = (sitio: string, d: any) => `${sitio}/?ver=${d.pedido}&t=${d.token}`;
// WhatsApp del equipo con el pedido ya escrito (la persona adjunta la captura del comprobante)
function linkWhatsComprobante(d: any, monto: number, que: string, pago = `A pagar: ${pesos(monto)}`) {
  const num = String(d.transferencia?.whatsapp || '').replace(/\D/g, '');
  if (num.length < 8) return null;
  const t = d.transferencia || {};
  const datos = [configurado(t.alias) ? `Alias: ${t.alias}` : null, configurado(t.cvu) ? `CVU: ${t.cvu}` : null,
    configurado(t.titular) ? `Titular: ${t.titular}` : null].filter(Boolean);
  const texto = [`Hola! Soy ${String(d.nombre || '').trim()}. Reservé por la web (pedido #${d.pedido}):`, `• ${que}`, pago,
    ...(datos.length ? ['', 'Datos para transferir:', ...datos] : []), '', 'Ahora transfiero y te mando el comprobante por acá 👇'].join('\n');
  return `https://wa.me/${num}?text=${encodeURIComponent(texto)}`;
}
const soloWhats = `<p style="margin:10px 0 0;font-size:13px;color:${SUAVE}">La reserva se confirma cuando recibimos el comprobante por WhatsApp.</p>`;

export function armarMail(a: Aviso, sitio: string): { asunto: string; html: string; texto: string } {
  const d = a.datos || {};
  const hola = `<p style="margin:0 0 8px">Hola ${esc(primerNombre(d.nombre))},</p>`;
  const varios = (d.reservas?.length || 0) > 1;
  let asunto = '', titulo = '', cuerpo = '', boton: { texto: string; url: string } | undefined;
  switch (a.tipo) {
    case 'reserva_creada': {
      const falta = Math.max(0, (d.sena || 0) - (d.pagado || 0));
      asunto = `Recibimos tu reserva · Pedido #${d.pedido}`;
      const primero = primerTurno(d.reservas);
      titulo = varios ? 'Recibimos tu reserva' : 'Recibimos tu reserva';
      cuerpo = `${hola}<p style="margin:0">Estos son los turnos de tu pedido <strong>#${esc(d.pedido)}</strong>:</p>${tablaTurnos(d.reservas)}
        <p style="margin:0">Total: <strong>${pesos(d.total)}</strong> · Seña para confirmar: <strong>${pesos(falta)}</strong></p>
        <p style="margin:10px 0 0;color:${ALERTA}"><strong>Para confirmar${varios ? 'las' : 'la'}: enviá la reserva por WhatsApp (botón de abajo), transferí la seña (o el total, si preferís) y mandá la captura en ese chat.</strong>
        ${primero ? `El saldo se paga hasta el ${esc(fechaLarga(diaAnterior(primero)))}.` : 'El saldo se paga hasta el día anterior al turno.'}</p>
        ${cajaTransferencia(d.transferencia, falta, 'Datos para transferir la seña')}`;
      const wa = linkWhatsComprobante(d, falta, (d.reservas || []).map((r: any) => `${mayuscula(fechaLarga(r.fecha))}, ${rangos(r.horas)}, ${r.consultorio}`).join('; '),
        `Pago la seña: ${pesos(falta)} (total ${pesos(d.total)})`);
      boton = wa ? { texto: 'Enviar reserva por WhatsApp', url: wa } : { texto: 'Ver mi reserva', url: linkPedido(sitio, d) };
      if (wa) cuerpo += soloWhats;
      break;
    }
    case 'reserva_confirmada':
      asunto = `¡Reserva confirmada! · Pedido #${d.pedido}`;
      titulo = varios ? '¡Tus reservas están confirmadas!' : '¡Tu reserva está confirmada!';
      {
        const saldo = Math.max(0, (d.total || 0) - (d.pagado || 0));
        const primero = primerTurno(d.reservas);
        cuerpo = `${hola}<p style="margin:0">Recibimos tu pago. Estos son tus turnos:</p>${tablaTurnos(d.reservas)}
          <p style="margin:0">Pagaste: <strong>${pesos(d.pagado)}</strong>${saldo ? ` · Saldo: <strong>${pesos(saldo)}</strong>, se paga hasta el ${esc(fechaLarga(diaAnterior(primero)))}.` : ' · No tenés que pagar nada más.'}</p>
          ${saldo ? cajaTransferencia(d.transferencia, saldo, 'Datos para transferir el saldo') : ''}
          <p style="margin:10px 0 0">¡Te esperamos!</p>`;
      }
      boton = { texto: 'Ver mi reserva', url: linkPedido(sitio, d) };
      break;
    case 'reserva_vencida':
      asunto = `Tu reserva se venció · Pedido #${d.pedido}`;
      titulo = 'Tu reserva se venció';
      cuerpo = `${hola}<p style="margin:0">No recibimos la seña a tiempo y ${varios ? 'estos horarios se liberaron' : 'este horario se liberó'}:</p>${tablaTurnos(d.reservas)}
        <p style="margin:0">Si ya pagaste, respondé este mail con el comprobante y lo resolvemos.</p>`;
      boton = { texto: 'Hacer una nueva reserva', url: `${sitio}/` };
      break;
    case 'reserva_cancelada':
      asunto = 'Tu reserva fue cancelada';
      titulo = 'Tu reserva fue cancelada';
      cuerpo = `${hola}<p style="margin:0">Cancelamos este turno:</p>${tablaTurnos([{ fecha: d.fecha, horas: d.horas, consultorio: d.consultorio }])}
        ${d.motivo ? `<p style="margin:0">Motivo: <strong>${esc(d.motivo)}</strong></p>` : ''}
        <p style="margin:10px 0 0">Si tenés dudas o querés reprogramar, respondé este mail.</p>`;
      break;
    case 'comprobante_recibido':
      asunto = `Recibimos tu comprobante · Pedido #${d.pedido}`;
      titulo = 'Recibimos tu comprobante';
      cuerpo = `${hola}<p style="margin:0">Lo vamos a revisar y te confirmamos. Mientras tanto, ${varios ? 'tus horarios quedan reservados' : 'tu horario queda reservado'} a tu nombre:</p>${tablaTurnos(d.reservas)}`;
      boton = { texto: 'Ver mi reserva', url: linkPedido(sitio, d) };
      break;
    case 'comprobante_rechazado':
      asunto = `No pudimos validar tu comprobante · Pedido #${d.pedido}`;
      titulo = 'No pudimos validar tu comprobante';
      cuerpo = `${hola}${d.motivo ? `<p style="margin:0">Motivo: <strong>${esc(d.motivo)}</strong></p>` : ''}
        <p style="margin:10px 0 0">Mandanos el comprobante correcto por WhatsApp, o respondé este mail.</p>${tablaTurnos(d.reservas)}`;
      boton = { texto: 'Ver mi reserva', url: linkPedido(sitio, d) };
      break;
    case 'fijo_solicitado':
    case 'fijo_aprobado':
    case 'fijo_rechazado': {
      const desc = `todos los <strong>${esc(DIAS_FIJO[d.dia])}</strong> de <strong>${esc(rangos(d.horas || []))}</strong> en <strong>${esc(d.consultorio)}</strong>, desde el ${esc(fechaLarga(d.desde))}`;
      if (a.tipo === 'fijo_solicitado') {
        asunto = 'Recibimos tu pedido de horario fijo'; titulo = 'Recibimos tu pedido de horario fijo';
        const semanas = (d.reservas || []).length;
        cuerpo = `${hola}<p style="margin:0">Reservaste ${desc} (${pesos(d.precio_semanal)} por semana).</p>
          ${d.pago_inicial ? `<p style="margin:10px 0 0;color:${ALERTA}"><strong>Para confirmarlo: enviá la reserva por WhatsApp (botón de abajo), transferí el primer mes (${pesos(d.pago_inicial)}${semanas ? `, ${semanas} ${semanas === 1 ? 'semana' : 'semanas'}` : ''}) y mandá la captura en ese chat.</strong>
            Después se paga cada mes por adelantado.</p>${cajaTransferencia(d.transferencia, d.pago_inicial, 'Datos para transferir el primer mes')}`
            : '<p style="margin:10px 0 0">Te escribimos para coordinar el pago.</p>'}`;
        const wa = d.pago_inicial ? linkWhatsComprobante(d, d.pago_inicial,
          `Horario fijo: todos los ${DIAS_FIJO[d.dia]}, ${rangos(d.horas || [])}, ${d.consultorio}, desde el ${fechaLarga(d.desde)}`, `Primer mes: ${pesos(d.pago_inicial)}`) : null;
        if (wa) { boton = { texto: 'Enviar reserva por WhatsApp', url: wa }; cuerpo += soloWhats; }
        else if (d.pedido && d.token) boton = { texto: 'Ver mi reserva', url: linkPedido(sitio, d) };
      } else if (a.tipo === 'fijo_aprobado') {
        asunto = '¡Tu horario fijo está confirmado!'; titulo = '¡Tu horario fijo está confirmado!';
        cuerpo = `${hola}<p style="margin:0">Recibimos el pago. Desde ahora tenés reservado ${desc}.</p>
          <p style="margin:10px 0 0">Cada mes se paga por adelantado, hasta el día anterior a la primera semana del mes. ¡Te esperamos!</p>`;
      } else {
        asunto = 'No pudimos confirmar tu horario fijo'; titulo = 'No pudimos confirmar tu horario fijo';
        cuerpo = `${hola}<p style="margin:0">No pudimos confirmar ${desc}.</p><p style="margin:10px 0 0">Respondé este mail y te ayudamos a encontrar otro horario.</p>`;
      }
      break;
    }
    case 'equipo_reserva_creada':
    case 'equipo_comprobante_recibido':
    case 'equipo_fijo_solicitado': {
      const p = d.profesional || {};
      const quien = `<p style="margin:0"><strong>${esc(p.nombre)}</strong>${p.profesion ? ` (${esc(p.profesion)})` : ''}<br>WhatsApp: ${esc(p.whatsapp)} · Mail: ${esc(p.email)}</p>`;
      if (a.tipo === 'equipo_reserva_creada') {
        asunto = `Nueva reserva web · ${p.nombre} · Pedido #${d.pedido}`; titulo = 'Nueva reserva desde la web';
        cuerpo = `${quien}${tablaTurnos(d.reservas)}<p style="margin:0">Total ${pesos(d.total)} · Seña ${pesos(d.sena)}</p>
          <p style="margin:10px 0 0">Si no paga, aparece en el panel → Pendientes → Alertas de pago. Nada se cancela solo.</p>`;
      } else if (a.tipo === 'equipo_comprobante_recibido') {
        asunto = `Comprobante para revisar · ${p.nombre} · Pedido #${d.pedido}`; titulo = 'Subieron un comprobante para revisar';
        cuerpo = `${quien}${tablaTurnos(d.reservas)}<p style="margin:0">Revisalo en el panel → Pendientes.</p>`;
      } else {
        asunto = `Nueva solicitud de horario fijo · ${p.nombre}`; titulo = 'Nueva solicitud de horario fijo';
        cuerpo = `${quien}<p style="margin:10px 0 0">Todos los ${esc(DIAS_FIJO[d.dia])} de ${esc(rangos(d.horas || []))} en ${esc(d.consultorio)}, desde el ${esc(fechaLarga(d.desde))}.</p>
          ${d.pago_inicial ? `<p style="margin:10px 0 0">Primer mes a pagar: <strong>${pesos(d.pago_inicial)}</strong>. Cuando pague (o aceptes el comprobante) queda activo solo.</p>` : ''}
          <p style="margin:10px 0 0">Lo ves en el panel → Pendientes.</p>`;
      }
      boton = { texto: 'Abrir el panel', url: `${sitio}/panel.html` };
      break;
    }
    default:
      throw new Error(`Tipo de aviso desconocido: ${a.tipo}`);
  }
  const html = plantillaMail(titulo, cuerpo, boton);
  const texto = unaLinea(cuerpo.replace(/<br\s*\/?>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")) + (boton ? `\n\n${boton.texto}: ${boton.url}` : '');
  return { asunto, html, texto };
}

// ---------------------------------------------------------------- WhatsApp (plantillas aprobadas por Meta, ver docs/plantillas-whatsapp.md)
const resumenTurnos = (reservas: any[] = []) => reservas.map((r) => `${fechaCorta(r.fecha)} ${rangos(r.horas)} (${r.consultorio})`).join('; ');

export function armarWhatsApp(a: Aviso, sitio: string): { plantilla: string; parametros: string[] } {
  const d = a.datos || {};
  const n = primerNombre(d.nombre);
  const p = (...xs: unknown[]) => xs.map((x) => unaLinea(String(x ?? '-')) || '-');
  switch (a.tipo) {
    case 'reserva_creada':
      return { plantilla: 'psico_reserva_recibida', parametros: p(n, d.pedido, resumenTurnos(d.reservas),
        pesos(Math.max(0, (d.sena || 0) - (d.pagado || 0))), d.expira_en ? horaAR(d.expira_en) : '-', linkPedido(sitio, d)) };
    case 'reserva_confirmada':
      return { plantilla: 'psico_reserva_confirmada', parametros: p(n, d.pedido, resumenTurnos(d.reservas), pesos((d.total || 0) - (d.pagado || 0))) };
    case 'reserva_vencida':
      return { plantilla: 'psico_reserva_vencida', parametros: p(n, d.pedido) };
    case 'reserva_cancelada':
      return { plantilla: 'psico_reserva_cancelada', parametros: p(n, `${fechaCorta(d.fecha)} ${rangos(d.horas)}`, d.motivo || 'sin detalle') };
    case 'comprobante_recibido':
      return { plantilla: 'psico_comprobante_recibido', parametros: p(n, d.pedido) };
    case 'comprobante_rechazado':
      return { plantilla: 'psico_comprobante_rechazado', parametros: p(n, d.pedido, d.motivo || 'sin detalle', linkPedido(sitio, d)) };
    case 'fijo_solicitado':
    case 'fijo_aprobado':
    case 'fijo_rechazado':
      return { plantilla: `psico_${a.tipo}`, parametros: p(n, `${DIAS_FIJO[d.dia]} de ${rangos(d.horas || [])} (${d.consultorio})`) };
    default:
      throw new Error(`Tipo de aviso sin plantilla de WhatsApp: ${a.tipo}`);
  }
}

// ---------------------------------------------------------------- envío
let transporte: any = null;
async function enviarMail(para: string, m: { asunto: string; html: string; texto: string }) {
  const prueba = (globalThis as any).__enviarMailPrueba;
  if (prueba) return prueba(para, m);
  const usuario = variable('GMAIL_USUARIO');
  if (!transporte) {
    const { default: nodemailer } = await import('npm:nodemailer@6.9.14');
    transporte = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true,
      auth: { user: usuario, pass: variable('GMAIL_CLAVE_APP') } });
  }
  await transporte.sendMail({ from: `"Psico Studios" <${usuario}>`, replyTo: usuario, to: para, subject: m.asunto, text: m.texto, html: m.html });
}

async function enviarWhatsApp(para: string, w: { plantilla: string; parametros: string[] }) {
  const token = Deno.env.get('WA_TOKEN'), telefono = Deno.env.get('WA_PHONE_ID');
  if (!token || !telefono) throw new Error('WhatsApp no configurado (faltan WA_TOKEN / WA_PHONE_ID)');
  const r = await fetch(`https://graph.facebook.com/v21.0/${telefono}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: para, type: 'template',
      template: { name: w.plantilla, language: { code: 'es_AR' },
        components: [{ type: 'body', parameters: w.parametros.map((t) => ({ type: 'text', text: t.slice(0, 1000) })) }] } }),
  });
  if (!r.ok) throw new Error(`WhatsApp respondió ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

function igualSeguro(a: string, b: string) {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('ok');
  let secreto: string;
  try { secreto = variable('AVISOS_SECRETO'); } catch (e) { console.error(e); return new Response('sin configurar', { status: 500 }); }
  if (!igualSeguro(req.headers.get('x-avisos-secreto') ?? '', secreto)) return new Response('no autorizado', { status: 401 });

  const sitio = (Deno.env.get('SITIO_URL') || '').replace(/\/+$/, '');
  const lote: Aviso[] = await rpc('tomar_avisos', { p_limite: 20 });
  let enviados = 0, fallidos = 0;
  for (const a of lote) {
    try {
      if (a.canal === 'email') await enviarMail(a.destino, armarMail(a, sitio));
      else await enviarWhatsApp(a.destino, armarWhatsApp(a, sitio));
      await rpc('resultado_aviso', { p_id: a.id, p_ok: true });
      enviados++;
    } catch (e) {
      console.error(`Aviso ${a.id} (${a.tipo}/${a.canal}) falló:`, e);
      await rpc('resultado_aviso', { p_id: a.id, p_ok: false, p_error: String((e as Error)?.message ?? e) }).catch(() => {});
      fallidos++;
    }
  }
  return new Response(JSON.stringify({ enviados, fallidos }), { headers: { 'Content-Type': 'application/json' } });
});

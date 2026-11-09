// Panel → pestaña "Asistente" (el asistente de WhatsApp con IA)
//   Conversaciones · Probar · Aprendizaje · Resumen · Ajustes
import { esc, pesos, hoyAR, sumarDias, fechaCorta, waArgentina, linkWhatsApp } from './comun.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const FUNCION = 'asistente-whatsapp';
const ZONA = 'America/Argentina/Buenos_Aires';
const cuando = (iso) => (iso ? new Date(iso).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA }) : '');
const hora = (iso) => (iso ? new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: ZONA }) : '');
const NOMBRES_HERRAMIENTA = {
  info_general: 'consultó precios y reglas', buscar_saber: 'buscó en lo que sabe', ver_dias_con_lugar: 'miró qué días hay lugar',
  ver_horarios_libres: 'miró horarios libres', ver_libres_fijo: 'miró libres para fijo', mis_reservas: 'miró sus reservas',
  reservar_horas: 'reservó', pedir_horario_fijo: 'pidió un fijo', estado_pedido: 'miró el estado del pedido',
  cancelar_pedido_sin_pagar: 'canceló un pedido sin pagar', guardar_comprobante: 'guardó un comprobante', recordar: 'anotó un dato',
  pasar_al_equipo: 'pasó al equipo', pedir_visita: 'pidió una visita', solicitar_cambio: 'dejó un cambio para aprobar', pedir_mas_tiempo: 'pidió más tiempo para la seña', proponer_saber: 'propuso aprender algo', consulta_equipo: 'consultó el panel',
  calificar_contacto: 'actualizó la ficha', mandar_fotos: 'mandó fotos',
  mover_turno: 'movió un horario', no_vengo: 'liberó una semana del fijo', recuperar_horas: 'usó horas a favor',
};
const ETAPAS = [['nuevo', 'Nuevo'], ['consulta', 'Consultó'], ['interesado', 'Interesado'], ['reservo', 'Reservó'], ['pago', 'Pagó'], ['perdido', 'Perdido']];
const nombreEtapa = (e) => ETAPAS.find(([v]) => v === e)?.[1] || e;
const claseEtapa = { nuevo: 'pill-info', consulta: 'pill-info', interesado: 'pill-alerta', reservo: 'pill-ok', pago: 'pill-ok', perdido: 'pill-error' };
const INTERES = { horas: 'horas sueltas', fijo: 'horario fijo', salon: 'el Salón', otro: 'otra cosa' };
// Formato de WhatsApp (*negrita*, _cursiva_) a HTML, sin dejar pasar código
const formato = (t) => esc(t).replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>').replace(/(^|\s)_([^_\n]+)_/g, '$1<em>$2</em>')
  .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>');

export function crearAsistente({ sb, st, llamar, toast, errorEn, errorDeFuncion, preguntar }) {
  const est = { sub: 'chats', chat: null, chats: [], timer: null, simulando: false };

  async function invocar(cuerpo) {
    const { data, error } = await sb.functions.invoke(FUNCION, { body: cuerpo });
    if (error) throw await errorDeFuncion(error);
    return data;
  }

  // ---------------------------------------------------------------- navegación interna
  $$('[data-asis]').forEach((b) => (b.onclick = () => irA(b.dataset.asis)));
  function irA(sub) {
    est.sub = sub;
    $$('[data-asis]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.asis === sub));
    $$('[data-asis-vista]').forEach((s) => s.classList.toggle('oculto', s.dataset.asisVista !== sub));
    clearInterval(est.timer);
    ({ chats: pintarChats, aprobar: pintarSolicitudes, probar: pintarProbar, aprender: pintarAprender, resumen: pintarResumen, ajustes: pintarAjustes })[sub]();
    if (sub === 'chats') est.timer = setInterval(() => { if (st.tab === 'asistente' && est.sub === 'chats' && !document.hidden) pintarChats(true); }, 20000);
  }

  // ---------------------------------------------------------------- estado general
  function pintarEstado() {
    const activo = st.cfg.asistente_activo === 'si', prueba = st.cfg.asistente_solo_prueba === 'si';
    $('#asis-estado').innerHTML = !activo
      ? '<span class="pill pill-alerta">Apagado</span> <span class="suave chico">No contesta WhatsApp. Podés probarlo en “Probar”.</span>'
      : prueba ? '<span class="pill pill-info">Modo prueba</span> <span class="suave chico">Solo contesta a los números de prueba y del equipo.</span>'
               : '<span class="pill pill-ok">Atendiendo</span> <span class="suave chico">Contesta todos los WhatsApp.</span>';
  }

  // ================================================================ CONVERSACIONES
  async function pintarChats(silencioso = false) {
    pintarEstado();
    if (!est.equipo) est.equipo = ((await sb.from('equipo').select('user_id, nombre, activo').order('nombre')).data || []).filter((e) => e.activo !== false);
    const cont = $('#asis-lista');
    if (!silencioso) cont.innerHTML = '<div class="cargando">Cargando…</div>';
    try { est.chats = await llamar('asistente_panel_chats', {}); } catch (err) { cont.innerHTML = ''; return errorEn(null, err); }
    const filtro = $('#asis-filtro').value;
    const yo = st.yo?.user_id;
    const lista = est.chats.filter((c) => !c.simulado && (filtro === 'todos' || (filtro === 'atender' && c.atender)
      || (filtro === 'prioridad' && c.prioridad) || (filtro === 'mios' && c.asignado_a && c.asignado_a === yo) || c.etapa === filtro));
    cont.innerHTML = lista.length ? lista.map((c) => `
      <button class="asis-item ${c.id === est.chat ? 'activo' : ''} ${c.atender ? 'atender' : ''}" data-chat="${c.id}">
        <span class="asis-nombre">${esc(c.nombre)}${c.urgente ? ' <span class="pill pill-error">Urgente</span>' : c.atender ? ' <span class="pill pill-alerta">Atender</span>' : ''}</span>
        <span class="asis-hora">${cuando(c.ultimo_mensaje_en)}</span>
        <span class="asis-ultimo">${c.ultimo_rol === 'asistente' ? '🤖 ' : c.ultimo_rol === 'equipo' ? '👤 ' : ''}${esc(c.ultimo || '')}</span>
        <span class="asis-tags"><span class="pill ${claseEtapa[c.etapa] || 'pill-info'}">${nombreEtapa(c.etapa)}</span>${c.prioridad ? '<span class="pill pill-alerta">🔥 Prioridad</span>' : ''}${c.valor_estimado ? `<span class="pill pill-info">~${pesos(c.valor_estimado)}/mes</span>` : ''}${c.asignado ? `<span class="pill pill-info">👤 ${esc(c.asignado.split(' ')[0])}</span>` : ''}${c.pausa_hasta && new Date(c.pausa_hasta) > new Date() ? '<span class="pill pill-info">Pausado</span>' : ''}</span>
      </button>`).join('') : `<p class="suave" style="padding:1em">${filtro === 'todos' ? 'Todavía no hay conversaciones.' : 'No hay conversaciones con ese filtro.'}</p>`;
    $$('[data-chat]', cont).forEach((b) => (b.onclick = () => abrirChat(Number(b.dataset.chat))));
    if (est.chat && !silencioso) abrirChat(est.chat, true);
    else if (est.chat && silencioso) abrirChat(est.chat, true, true);
  }
  $('#asis-filtro').onchange = () => pintarChats();

  async function abrirChat(id, mantener = false, silencioso = false) {
    est.chat = id;
    $$('[data-chat]').forEach((b) => b.classList.toggle('activo', Number(b.dataset.chat) === id));
    const c = est.chats.find((x) => x.id === id);
    const panel = $('#asis-chat');
    panel.classList.add('abierto');
    if (!c) { panel.innerHTML = '<p class="suave">Elegí una conversación.</p>'; return; }
    let d;
    try { d = await llamar('asistente_panel_mensajes', { p_chat_id: id }); } catch (err) { return errorEn(null, err); }
    const borrador = $('#asis-resp')?.value || '';
    const pausado = c.pausa_hasta && new Date(c.pausa_hasta) > new Date();
    const wa = waArgentina(c.whatsapp);
    const ventana = c.ultimo_cliente_en && Date.now() - new Date(c.ultimo_cliente_en).getTime() < 24 * 3600e3;
    panel.innerHTML = `
      <div class="asis-cab">
        <button class="btn btn-borde btn-chico asis-volver" aria-label="Volver a la lista">◀</button>
        <div><strong>${esc(c.nombre)}</strong><br><span class="suave chico">+${esc(c.whatsapp)}${c.profesional_id ? ' · cliente registrado' : ''}</span></div>
        <div class="der">
          ${c.atender ? '<button class="btn btn-acento btn-chico" id="asis-atendido">✓ Ya está atendido</button>' : ''}
          ${pausado ? `<button class="btn btn-borde btn-chico" id="asis-devolver">Devolver al asistente</button>`
                    : '<button class="btn btn-borde btn-chico" id="asis-pausar">Pausar asistente 2 h</button>'}
          <a class="btn btn-wa btn-chico" target="_blank" rel="noopener" href="${linkWhatsApp(wa, '')}">Abrir en WhatsApp</a>
        </div>
      </div>
      <div class="asis-crm">
        <label>Etapa <select id="asis-etapa" ${['reservo', 'pago'].includes(c.etapa) ? 'disabled title="Sale sola del pedido"' : ''}>
          ${ETAPAS.filter(([v]) => !['reservo', 'pago'].includes(v) || v === c.etapa).map(([v, t]) => `<option value="${v}" ${v === c.etapa ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label>Lo sigue <select id="asis-asignado"><option value="">Nadie</option>
          ${(est.equipo || []).map((e) => `<option value="${e.user_id}" ${e.user_id === c.asignado_a ? 'selected' : ''}>${esc(e.nombre)}</option>`).join('')}</select></label>
        <label class="asis-check"><input type="checkbox" id="asis-prioridad" ${c.prioridad ? 'checked' : ''}> 🔥 Prioridad</label>
        ${c.interes || c.nota_crm || c.valor_estimado ? `<p class="chico" style="margin:0;flex-basis:100%">${c.interes ? `Busca <strong>${INTERES[c.interes] || esc(c.interes)}</strong>` : ''}${c.valor_estimado ? ` · ~${pesos(c.valor_estimado)}/mes` : ''}${c.nota_crm ? ` · ${esc(c.nota_crm)}` : ''}</p>` : ''}
      </div>
      ${c.profesional_id ? '' : `<form class="asis-vincular" id="asis-vincular">
        <label for="asis-prof">¿Ya alquila? Vincular con su ficha</label>
        <input id="asis-prof" list="asis-profs" placeholder="Nombre del profesional" autocomplete="off">
        <datalist id="asis-profs">${(st.profesionales || []).map((p) => `<option value="${esc(p.nombre)}">${esc(p.profesion || '')}</option>`).join('')}</datalist>
        <button class="btn btn-borde btn-chico">Vincular</button>
        <span class="suave chico">Desde ahí el asistente la reconoce y puede mover sus horarios.</span></form>`}
      ${d.horas_a_favor?.length ? `<p class="aviso aviso-info chico" style="margin:.5em 0">Horas a favor: ${d.horas_a_favor.map((h) => `<strong>${h.horas} h</strong> hasta el ${fechaCorta(h.vence)} (${esc(h.motivo || '')})`).join(' · ')}</p>` : ''}
      ${c.atender ? `<p class="aviso aviso-alerta chico" style="margin:.5em 0">${c.urgente ? '<strong>URGENTE.</strong> ' : ''}Para atender: ${esc(c.motivo_atender || 'sin detalle')}</p>` : ''}
      ${pausado ? `<p class="aviso aviso-info chico" style="margin:.5em 0">El asistente no contesta en este chat hasta las ${hora(c.pausa_hasta)}.</p>` : ''}
      <div class="asis-msjs" id="asis-msjs">${d.mensajes.map(burbuja).join('') || '<p class="suave">Sin mensajes.</p>'}</div>
      <form id="asis-form" class="asis-form">
        <label for="asis-resp" class="oculto-visual">Responder como equipo</label>
        <textarea id="asis-resp" rows="2" maxlength="4000" placeholder="${ventana ? 'Responder como equipo (el asistente se pausa en este chat)…' : 'Pasaron más de 24 hs: WhatsApp no deja escribir primero. Usá “Abrir en WhatsApp”.'}" ${ventana ? '' : 'disabled'}></textarea>
        <button class="btn btn-primario" ${ventana ? '' : 'disabled'}>Enviar</button>
      </form>
      <details class="asis-memoria"><summary>Lo que recuerda de esta persona (${d.memoria.length})</summary>
        ${d.memoria.length ? `<ul>${d.memoria.map((m) => `<li>${esc(m.dato)} <button class="link-btn chico" data-borrar-memoria="${m.id}" style="display:inline;margin:0">borrar</button></li>`).join('')}</ul>`
          : '<p class="suave chico">Nada todavía.</p>'}
        ${d.pedidos.length ? `<p class="chico">Pedidos que tomó: ${d.pedidos.map((p) => `#${p}`).join(', ')}</p>` : ''}
        ${d.cambios?.length ? `<p class="chico" style="margin-bottom:0"><strong>Cambios que hizo:</strong></p><ul>${d.cambios.map((x) => `<li>${esc(x.detalle)}${x.diferencia > 0 ? ` · diferencia ${pesos(x.diferencia)}` : ''} <span class="suave">(${cuando(x.creado_en)})</span></li>`).join('')}</ul>` : ''}
      </details>`;
    if (borrador && $('#asis-resp') && !$('#asis-resp').disabled) $('#asis-resp').value = borrador;
    const caja = $('#asis-msjs');
    if (!silencioso || !mantener) caja.scrollTop = caja.scrollHeight;
    else caja.scrollTop = caja.scrollHeight;
    $('.asis-volver').onclick = () => { panel.classList.remove('abierto'); est.chat = null; };
    $('#asis-atendido') && ($('#asis-atendido').onclick = async () => { await llamar('asistente_panel_atendido', { p_chat_id: id }, 'Marcado como atendido'); pintarChats(); badge(); });
    $('#asis-pausar') && ($('#asis-pausar').onclick = async () => { await llamar('asistente_panel_pausa', { p_chat_id: id, p_minutos: 120 }, 'Asistente pausado en este chat'); pintarChats(); });
    $('#asis-devolver') && ($('#asis-devolver').onclick = async () => { await llamar('asistente_panel_pausa', { p_chat_id: id, p_minutos: 0 }, 'El asistente vuelve a contestar'); pintarChats(); });
    $('#asis-vincular') && ($('#asis-vincular').onsubmit = async (e) => {
      e.preventDefault();
      const nombre = $('#asis-prof').value.trim().toLowerCase();
      const p = (st.profesionales || []).find((x) => x.nombre.toLowerCase() === nombre);
      if (!p) return errorEn(null, 'Elegí el nombre de la lista (tiene que ser un profesional que ya existe).');
      try { await llamar('asistente_panel_vincular', { p_chat_id: id, p_profesional_id: p.id }, `Vinculado con ${p.nombre}`); est.chat = id; pintarChats(); }
      catch (err) { errorEn(null, err); }
    });
    $('#asis-etapa').onchange = async (e) => {
      try { await llamar('asistente_panel_etapa', { p_chat_id: id, p_etapa: e.target.value }, 'Etapa actualizada'); pintarChats(true); } catch (err) { errorEn(null, err); }
    };
    $('#asis-prioridad').onchange = async (e) => {
      try { await llamar('asistente_panel_etapa', { p_chat_id: id, p_etapa: ['reservo', 'pago'].includes(c.etapa) ? 'interesado' : c.etapa, p_prioridad: e.target.checked }, 'Guardado'); pintarChats(true); }
      catch (err) { errorEn(null, err); }
    };
    $('#asis-asignado').onchange = async (e) => {
      try { await llamar('asistente_panel_asignar', { p_chat_id: id, p_user_id: e.target.value || null }, 'Asignado'); pintarChats(true); } catch (err) { errorEn(null, err); }
    };
    $$('[data-borrar-memoria]', panel).forEach((b) => (b.onclick = async () => {
      await llamar('asistente_panel_borrar_memoria', { p_id: Number(b.dataset.borrarMemoria) }, 'Borrado'); abrirChat(id);
    }));
    $('#asis-form').onsubmit = async (e) => {
      e.preventDefault();
      const texto = $('#asis-resp').value.trim();
      if (!texto) return;
      const boton = $('#asis-form button');
      boton.disabled = true;
      try {
        const r = await invocar({ accion: 'responder', chat_id: id, texto });
        $('#asis-resp').value = '';
        toast(r.ok ? 'Enviado por WhatsApp' : `Guardado, pero no se envió: ${r.envio}`);
        await pintarChats(); badge();
      } catch (err) { errorEn(null, err); } finally { boton.disabled = false; }
    };
  }

  function burbuja(m) {
    if (m.rol === 'nota') return `<div class="asis-nota">${esc(m.texto)}</div>`;
    if (m.rol === 'asistente' && !m.texto && !m.url) return '';   // seguimiento en el que decidió no escribir
    const quien = m.rol === 'cliente' ? '' : m.rol === 'asistente' ? '🤖 Asistente' : `👤 ${esc(m.autor || 'Equipo')}`;
    const adjunto = m.tipo === 'audio' && m.texto ? '🎤 Audio · transcripto' : { imagen: '📷 Imagen', documento: '📄 Archivo', audio: '🎤 Audio (no se pudo transcribir)', video: '🎬 Video' }[m.tipo];
    const fallo = m.envio && m.envio !== 'enviado' ? `<span class="asis-fallo">No se envió: ${esc(m.envio)}</span>` : '';
    return `<div class="asis-b asis-${m.rol}">${quien ? `<span class="asis-quien">${quien}</span>` : ''}
      ${m.url ? `<a href="${esc(m.url)}" target="_blank" rel="noopener"><img class="asis-foto" src="${esc(m.url)}" alt="${esc(m.texto || 'Foto')}" loading="lazy"></a>`
        : adjunto ? `<span class="asis-adj">${adjunto}</span>` : ''}${m.texto ? `<div>${formato(m.texto)}</div>` : ''}
      <span class="asis-h">${cuando(m.creado_en)}</span>${fallo}</div>`;
  }

  // ================================================================ PARA APROBAR
  const TIPO_SOL = { mover_reserva: 'Mover un turno', mover_fijo: 'Mover una semana del fijo', no_vengo: 'No viene una semana (fijo)',
    recuperar_horas: 'Recuperar horas a favor', extender_sena: 'Más tiempo para la seña', visita: 'Visita para conocer el espacio' };
  const MOTIVO_SOL = { sin_identificar: '<span class="pill pill-alerta">No reconocido por su WhatsApp</span>',
    poca_anticipacion: '<span class="pill pill-alerta">Menos de 24 hs de aviso</span>', pedido: '<span class="pill pill-info">Lo pide la persona</span>' };
  async function pintarSolicitudes() {
    const cont = $('#asis-solicitudes');
    cont.innerHTML = '<div class="cargando">Cargando…</div>';
    let lista;
    try { lista = await llamar('asistente_panel_solicitudes', {}); } catch (err) { cont.innerHTML = ''; return errorEn(null, err); }
    const nombreProf = (id) => (st.profesionales || []).find((p) => p.id === id)?.nombre || '';
    cont.innerHTML = lista.length ? lista.map((x) => `
      <form class="item asis-sol" data-sol="${x.id}">
        <h3 style="margin:0">${esc(TIPO_SOL[x.tipo] || x.tipo)}</h3>
        <p style="margin:.3em 0">${esc(x.resumen)}</p>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${MOTIVO_SOL[x.motivo] || ''}${x.lugar_guardado ? '<span class="pill pill-ok">Lugar guardado</span>' : ''}</div>
        <div class="quien">
          <span>Escribió <strong>${esc(x.chat)}</strong> (+${esc(x.whatsapp)})${x.nombre_dicho ? ` · dice ser <strong>${esc(x.nombre_dicho)}</strong>` : ''}</span>
          ${x.tipo === 'visita' ? `<span>Le queda cómodo: <strong>${esc(x.datos?.preferencia || '—')}</strong></span>
            <div class="fila2"><div class="campo" style="margin:0"><label for="sol-fecha-${x.id}">Día</label><input id="sol-fecha-${x.id}" name="vfecha" type="date" value="${esc(x.datos?.fecha || '')}"></div>
            <div class="campo" style="margin:0"><label for="sol-hora-${x.id}">Hora</label><input id="sol-hora-${x.id}" name="vhora" type="time" step="900" value="${esc(x.datos?.hora || '')}"></div></div>`
          : x.identificado ? '' : `<label for="sol-prof-${x.id}">¿Quién es? (se vincula su WhatsApp a la ficha)</label>
            <input id="sol-prof-${x.id}" name="prof" list="sol-profs" value="${esc(x.profesional || '')}" placeholder="Elegí la ficha" autocomplete="off">
            ${x.profesional ? '<span class="suave chico">Sugerido por el nombre y el horario que dijo.</span>' : '<span class="suave chico">No encontramos una ficha que coincida: elegila.</span>'}`}
        </div>
        <label for="sol-nota-${x.id}" class="suave chico">${x.tipo === 'visita' ? 'Mensaje para la persona (opcional): ej. la dirección o a quién preguntar' : 'Si lo rechazan, motivo para la persona (opcional)'}</label>
        <input id="sol-nota-${x.id}" name="nota" maxlength="200" placeholder="${x.tipo === 'visita' ? 'Ej: Estamos en … 1234, 5º piso. Tocá timbre B.' : 'Ej: ese día cerramos temprano'}">
        <div class="acciones"><button class="btn btn-primario btn-chico" value="si">Aprobar</button>
          <button class="btn btn-borde btn-chico" value="no">Rechazar</button>
          <button class="btn btn-borde btn-chico" type="button" data-ver-chat="${x.chat_id}">Ver la charla</button></div>
      </form>`).join('') + `<datalist id="sol-profs">${(st.profesionales || []).map((p) => `<option value="${esc(p.nombre)}">`).join('')}</datalist>`
      : '<p class="suave">No hay nada para aprobar.</p>';
    pintarVisitas();
    $$('[data-ver-chat]', cont).forEach((b) => (b.onclick = () => { est.chat = Number(b.dataset.verChat); irA('chats'); }));
    $$('[data-sol]', cont).forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      const aprobar = e.submitter?.value === 'si';
      let profesional_id = null, datos = null;
      if (f.vfecha) {
        if (aprobar && (!f.vfecha.value || !f.vhora.value)) return errorEn(null, 'Elegí el día y la hora de la visita.');
        datos = { fecha: f.vfecha.value, hora: f.vhora.value };
      }
      if (f.prof) {
        const p = (st.profesionales || []).find((x) => x.nombre.toLowerCase() === f.prof.value.trim().toLowerCase());
        if (aprobar && !p) return errorEn(null, 'Elegí de la lista la ficha de la persona.');
        profesional_id = p?.id ?? null;
      }
      $$('button', f).forEach((b) => (b.disabled = true));
      try {
        const r = await invocar({ accion: 'resolver_solicitud', id: Number(f.dataset.sol), aprobar, profesional_id, nota: f.nota.value, datos });
        toast(aprobar ? (r.envio === 'enviado' ? 'Aprobado: ya se le avisó por WhatsApp' : `Aprobado. ${r.envio}`)
                      : (r.envio === 'enviado' ? 'Rechazado: ya se le avisó' : `Rechazado. ${r.envio}`));
        pintarSolicitudes(); badge();
      } catch (err) { errorEn(null, err); $$('button', f).forEach((b) => (b.disabled = false)); }
    }));
  }

  async function pintarVisitas() {
    const cont = $('#asis-visitas');
    let lista;
    try { lista = await llamar('asistente_panel_visitas', {}); } catch { return; }
    cont.innerHTML = lista.length ? `<table class="tabla"><thead><tr><th>Día</th><th>Hora</th><th>Quién</th><th></th></tr></thead><tbody>${lista.map((v) => `
      <tr><td>${fechaCorta(v.fecha)}</td><td>${esc(v.hora)}</td><td>${esc(v.nombre || '')} <span class="suave chico">+${esc(v.whatsapp || '')}</span></td>
      <td><button class="btn btn-borde btn-chico" data-cancelar-visita="${v.id}">Cancelar</button></td></tr>`).join('')}</tbody></table>`
      : '<p class="suave chico">No hay visitas agendadas.</p>';
    $$('[data-cancelar-visita]', cont).forEach((b) => (b.onclick = async () => {
      if (await preguntar({ titulo: '¿Cancelar la visita?', texto: 'Avisale a la persona desde el chat.', aceptar: 'Cancelar visita', peligro: true }) === null) return;
      try { await llamar('asistente_panel_cancelar_visita', { p_id: Number(b.dataset.cancelarVisita) }, 'Visita cancelada'); pintarVisitas(); } catch (err) { errorEn(null, err); }
    }));
  }

  // ================================================================ PROBAR (simulador)
  const sim = { mensajes: [] };
  function pintarProbar() {
    pintarEstado();
    const caja = $('#asis-sim-msjs');
    caja.innerHTML = sim.mensajes.length ? sim.mensajes.map((m) => `
      <div class="asis-b ${m.yo ? 'asis-cliente' : 'asis-asistente'}">${m.yo ? '' : '<span class="asis-quien">🤖 Asistente</span>'}
        ${(m.fotos || []).map((f) => `<img class="asis-foto" src="${esc(f.url)}" alt="${esc(f.texto || 'Foto')}" loading="lazy">`).join('')}
        <div>${formato(m.texto)}</div>
        ${m.herramientas?.length ? `<span class="asis-herr">${m.herramientas.map((h) => `${h.ok ? '🔧' : '⚠️'} ${esc(NOMBRES_HERRAMIENTA[h.nombre] || h.nombre)}`).join(' · ')}</span>` : ''}
      </div>`).join('') + (est.simulando ? '<div class="asis-b asis-asistente asis-escribiendo">escribiendo…</div>' : '')
      : `<div class="suave" style="padding:1em">Escribile como si fueras un cliente. Por ejemplo:<br>
        <button class="chip asis-ej" type="button">¿Tienen lugar el jueves a la tarde?</button>
        <button class="chip asis-ej" type="button">¿Cuánto sale la hora?</button>
        <button class="chip asis-ej" type="button">Quiero un horario fijo los martes de 15 a 17</button></div>`;
    caja.scrollTop = caja.scrollHeight;
    $$('.asis-ej', caja).forEach((b) => (b.onclick = () => { $('#asis-sim-txt').value = b.textContent; $('#asis-sim-form').requestSubmit(); }));
  }
  $('#asis-sim-form').onsubmit = async (e) => {
    e.preventDefault();
    const txt = $('#asis-sim-txt').value.trim();
    if (!txt || est.simulando) return;
    sim.mensajes.push({ yo: true, texto: txt });
    $('#asis-sim-txt').value = '';
    est.simulando = true; pintarProbar();
    try {
      const r = await invocar({ accion: 'simular', texto: txt });
      sim.mensajes.push({ texto: r.texto || '(sin respuesta)', herramientas: r.herramientas, fotos: r.fotos });
    } catch (err) {
      sim.mensajes.push({ texto: `⚠️ ${err?.hint || err?.message || 'No se pudo responder'}` });
    } finally { est.simulando = false; pintarProbar(); }
  };
  $('#asis-sim-txt').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#asis-sim-form').requestSubmit(); } };
  $('#asis-sim-nuevo').onclick = async () => {
    try { await invocar({ accion: 'simular', reiniciar: true }); } catch (err) { return errorEn(null, err); }
    sim.mensajes = []; pintarProbar(); toast('Charla nueva');
  };

  // ================================================================ APRENDIZAJE
  async function pintarAprender() {
    const [props, saber] = await Promise.all([
      llamar('asistente_panel_propuestas', {}).catch((e) => { errorEn(null, e); return []; }),
      sb.from('asistente_conocimiento').select('*').order('tema').order('id'),
    ]);
    const ORIGEN = { conversacion: 'Lo notó en una charla', equipo: 'De una respuesta del equipo', revision: 'De la revisión semanal' };
    $('#asis-props').innerHTML = props.length ? props.map((p) => `
      <form class="item asis-prop" data-prop="${p.id}">
        <p class="chico suave" style="margin:0 0 .4em">${ORIGEN[p.origen] || ''}${p.motivo ? ` · ${esc(p.motivo)}` : ''}</p>
        ${p.corrige ? `<p class="aviso aviso-info chico" style="margin:.3em 0">Corrige lo que dice hoy: “${esc(p.corrige.respuesta)}”</p>` : ''}
        <div class="campo"><label>Tema</label><input name="tema" value="${esc(p.tema)}" maxlength="60"></div>
        <div class="campo"><label>Pregunta</label><input name="pregunta" value="${esc(p.pregunta)}" maxlength="500"></div>
        <div class="campo"><label>Respuesta</label><textarea name="respuesta" rows="3" maxlength="2000">${esc(p.respuesta)}</textarea></div>
        <div class="acciones"><button class="btn btn-primario btn-chico" value="si">Aprobar</button>
          <button class="btn btn-borde btn-chico" value="no">Descartar</button></div>
      </form>`).join('') : '<p class="suave">No hay nada para revisar. Cuando el asistente aprenda algo nuevo, aparece acá.</p>';
    $$('[data-prop]').forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      const aprobar = e.submitter?.value === 'si';
      try {
        await llamar('asistente_panel_resolver', { p_id: Number(f.dataset.prop), p_aprobar: aprobar,
          p_pregunta: f.pregunta.value, p_respuesta: f.respuesta.value, p_tema: f.tema.value }, aprobar ? 'Aprendido ✓' : 'Descartado');
        pintarAprender(); badge();
      } catch (err) { errorEn(null, err); }
    }));

    const filas = saber.data || [];
    $('#asis-saber').innerHTML = filas.length ? filas.map((k) => `
      <details class="item asis-k ${k.activo ? '' : 'inactivo'}">
        <summary><span class="pill pill-info">${esc(k.tema)}</span> ${esc(k.pregunta)}${k.activo ? '' : ' <span class="pill pill-alerta">Apagada</span>'}
          ${k.origen === 'aprendido' ? ' <span class="pill pill-ok">Aprendida</span>' : ''}<span class="suave chico"> · usada ${k.usos} ${k.usos === 1 ? 'vez' : 'veces'}</span></summary>
        <form data-saber="${k.id}" style="margin-top:.6em">
          <div class="fila2"><div class="campo"><label>Tema</label><input name="tema" value="${esc(k.tema)}" maxlength="60"></div>
            <div class="campo"><label>Pregunta</label><input name="pregunta" value="${esc(k.pregunta)}" maxlength="500"></div></div>
          <div class="campo"><label>Respuesta</label><textarea name="respuesta" rows="3" maxlength="2000">${esc(k.respuesta)}</textarea></div>
          <label class="chico"><input type="checkbox" name="activo" ${k.activo ? 'checked' : ''}> La usa para responder</label>
          <div class="acciones"><button class="btn btn-primario btn-chico" value="guardar">Guardar</button>
            <button class="btn btn-peligro btn-chico" value="borrar">Borrar</button></div>
        </form>
      </details>`).join('') : '<p class="suave">Todavía no sabe nada. Cargá abajo lo que querés que responda.</p>';
    $$('[data-saber]').forEach((f) => (f.onsubmit = async (e) => {
      e.preventDefault();
      const id = Number(f.dataset.saber);
      try {
        if (e.submitter?.value === 'borrar') {
          if (await preguntar({ titulo: '¿Borrar esta respuesta?', texto: 'El asistente deja de saberla.', aceptar: 'Borrar', peligro: true }) === null) return;
          await llamar('asistente_panel_borrar_saber', { p_id: id }, 'Borrada');
        } else {
          await llamar('asistente_panel_guardar_saber', { p_id: id, p_tema: f.tema.value, p_pregunta: f.pregunta.value,
            p_respuesta: f.respuesta.value, p_activo: f.activo.checked }, 'Guardado');
        }
        pintarAprender();
      } catch (err) { errorEn(null, err); }
    }));
  }
  $('#asis-nuevo-saber').onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    try {
      await llamar('asistente_panel_guardar_saber', { p_id: null, p_tema: f.tema.value, p_pregunta: f.pregunta.value,
        p_respuesta: f.respuesta.value, p_activo: true }, 'Listo: ya lo sabe');
      f.reset(); pintarAprender();
    } catch (err) { errorEn(null, err); }
  };

  // ================================================================ RESUMEN
  const segundos = (n) => (n == null ? '—' : n < 90 ? `${Math.round(n)} seg` : n < 5400 ? `${Math.round(n / 60)} min` : `${Math.round(n / 3600)} h`);
  async function pintarResumen() {
    const dias = Number($('#asis-periodo').value);
    const desde = sumarDias(hoyAR(), -(dias - 1));
    let r;
    try { r = await llamar('asistente_panel_resumen', { p_desde: desde, p_hasta: hoyAR() }); } catch (err) { return errorEn(null, err); }
    const conv = r.charlas ? Math.round((r.pedidos / r.charlas) * 100) : 0;
    const kpi = (n, t, sub = '') => `<div class="kpi"><div class="t">${t}</div><div class="v">${n}</div>${sub ? `<div class="d">${sub}</div>` : ''}</div>`;
    $('#asis-kpis').innerHTML = [
      kpi(r.charlas, 'personas escribieron'),
      kpi(r.respuestas_asistente, 'respuestas del asistente', `${r.respuestas_equipo} del equipo`),
      kpi(r.pedidos, 'reservas tomadas', `${conv}% de las charlas`),
      kpi(r.pedidos_confirmados, 'reservas pagadas', pesos(r.monto_reservado)),
      kpi(r.charlas ? Math.round(((r.embudo?.pago || 0) / r.charlas) * 100) + '%' : '—', 'tasa de cierre', 'charlas que terminaron en pago'),
      kpi(segundos(r.respuesta_segundos?.asistente), 'tarda en responder el asistente', `el equipo: ${segundos(r.respuesta_segundos?.equipo)}`),
      kpi(r.cambios ?? 0, 'horarios que movió o liberó', 'sin intervención del equipo'),
      kpi(r.para_atender, 'chats para atender'),
      kpi(r.propuestas, 'cosas para aprobar'),
      kpi(Math.round((r.tokens.entrada + r.tokens.salida) / 1000).toLocaleString('es-AR') + ' mil', 'tokens usados', 'el costo se ve en console.anthropic.com'),
    ].join('');
    const emb = r.embudo || {};
    const maximo = Math.max(1, ...ETAPAS.map(([v]) => emb[v] || 0));
    $('#asis-embudo').innerHTML = ETAPAS.map(([v, t]) => `<div class="asis-barra"><span>${t}</span>
      <span class="asis-barra-v"><span style="width:${((emb[v] || 0) / maximo) * 100}%"></span></span><strong>${emb[v] || 0}</strong></div>`).join('');
    $('#asis-oportunidades').innerHTML = (r.oportunidades || []).length ? r.oportunidades.map((o) => `
      <button class="asis-item" data-ir-chat="${o.id}"><span class="asis-nombre">${esc(o.nombre)}</span><span class="asis-hora">${cuando(o.ultimo_mensaje_en)}</span>
        <span class="asis-ultimo">${o.interes ? `Busca ${INTERES[o.interes] || esc(o.interes)}` : ''}${o.valor_estimado ? ` · ~${pesos(o.valor_estimado)}/mes` : ''}${o.nota ? ` · ${esc(o.nota)}` : ''}</span></button>`).join('')
      : '<p class="suave chico">No hay interesados sin reservar en las últimas 2 semanas.</p>';
    $$('[data-ir-chat]').forEach((b) => (b.onclick = () => { est.chat = Number(b.dataset.irChat); irA('chats'); }));
    const { data: informes } = await sb.from('asistente_informes').select('*').order('id', { ascending: false }).limit(6);
    const lista = (titulo, xs, fn = esc) => (xs?.length ? `<h4>${titulo}</h4><ul>${xs.map((x) => `<li>${fn(x)}</li>`).join('')}</ul>` : '');
    $('#asis-informes').innerHTML = (informes || []).length ? informes.map((i, n) => `
      <details class="item" ${n === 0 ? 'open' : ''}><summary><strong>Semana del ${fechaCorta(i.desde)} al ${fechaCorta(i.hasta)}</strong></summary>
        <p>${esc(i.datos.resumen || '')}</p>
        ${lista('De qué preguntan', i.datos.temas_frecuentes, (t) => `${esc(t.tema)} <span class="suave">(${t.veces})</span>`)}
        ${lista('No supo responder', i.datos.preguntas_sin_respuesta)}
        ${lista('Reservas que se perdieron', i.datos.reservas_perdidas, (t) => `<strong>${esc(t.motivo)}:</strong> ${esc(t.detalle)}`)}
        ${lista('Pidieron y no había lugar', i.datos.demanda_sin_lugar)}
        ${lista('Errores del asistente', i.datos.errores_del_asistente)}
        ${lista('Ideas para el negocio', i.datos.ideas_para_el_negocio)}
        ${i.datos.propuestas?.length ? `<p class="chico suave">Dejó ${i.datos.propuestas.length} cosas para aprobar en “Aprendizaje”.</p>` : ''}
      </details>`).join('') : '<p class="suave">La primera revisión llega el lunes a las 9 (analiza la semana y propone mejoras).</p>';
  }
  $('#asis-periodo').onchange = () => pintarResumen();

  // ================================================================ AJUSTES
  const AJUSTES = [
    ['asistente_activo', 'Asistente prendido (contesta WhatsApp)', 'sino'],
    ['asistente_solo_prueba', 'Modo prueba: solo contesta a los números de abajo', 'sino'],
    ['asistente_nombre', 'Nombre con el que se presenta', 'text'],
    ['asistente_toma_reservas', 'Etapa 2 · Reserva él mismo (si no: comparte la disponibilidad y el link de la web)', 'sino'],
    ['asistente_minutos_pausa', 'Minutos que se calla en un chat cuando contesta el equipo', 'number'],
    ['asistente_horas_charla', 'Horas sin mensajes para empezar una charla nueva', 'number'],
    ['asistente_recordar_sena', 'Etapa 2 · Recordar la seña a quien reservó con el asistente y no pagó', 'sino'],
    ['asistente_minutos_recordatorio', 'Minutos después de reservar para recordarla', 'number'],
    ['asistente_seguimiento', 'Etapa 2 · Volver a escribirle UNA vez a quien quedó con algo pendiente', 'sino'],
    ['asistente_horas_seguimiento', 'Horas de silencio antes de ese seguimiento', 'number'],
    ['asistente_transcribir_audios', 'Entender audios (los pasa a texto con Whisper)', 'sino'],
    ['asistente_esfuerzo', 'Cuánto piensa antes de responder', 'esfuerzo'],
  ];
  async function pintarAjustes() {
    pintarEstado();
    $('#asis-ajustes').innerHTML = AJUSTES.map(([k, t, tipo]) => `
      <form class="campo" data-asis-cfg="${k}" style="display:flex;gap:8px;align-items:flex-end">
        <div style="flex:1"><label for="ac-${k}">${t}</label>${
          tipo === 'sino' ? `<select id="ac-${k}"><option value="si" ${st.cfg[k] === 'si' ? 'selected' : ''}>Sí</option><option value="no" ${st.cfg[k] !== 'si' ? 'selected' : ''}>No</option></select>`
          : tipo === 'esfuerzo' ? `<select id="ac-${k}">${[['low', 'Poco (más rápido y barato)'], ['medium', 'Normal (recomendado)'], ['high', 'Mucho (más lento, más cuidadoso)']]
              .map(([v, x]) => `<option value="${v}" ${st.cfg[k] === v ? 'selected' : ''}>${x}</option>`).join('')}</select>`
          : `<input id="ac-${k}" type="${tipo}" value="${esc(st.cfg[k] ?? '')}" required ${tipo === 'number' ? 'min="1" step="1"' : 'maxlength="40"'}>`}</div>
        <button class="btn btn-borde btn-chico" style="min-height:48px">Guardar</button>
      </form>`).join('');
    $$('[data-asis-cfg]').forEach((fm) => (fm.onsubmit = async (e) => {
      e.preventDefault();
      const k = fm.dataset.asisCfg, v = $('input, select', fm).value.trim();
      if (k === 'asistente_activo' && v === 'si' && st.cfg.asistente_solo_prueba !== 'si'
          && await preguntar({ titulo: '¿Prender el asistente para todos?', texto: 'Va a contestar TODOS los WhatsApp. Conviene probarlo antes en modo prueba.', aceptar: 'Sí, prender' }) === null) return;
      const { data, error } = await sb.from('config').update({ valor: v }).eq('clave', k).select();
      if (error) return errorEn(null, error);
      if (!data?.length) return errorEn(null, 'No se pudo guardar: tu usuario no tiene permiso para cambiar este dato.');
      st.cfg[k] = v; toast('Guardado'); pintarEstado();
    }));

    const [{ data: numeros }, { data: equipo }] = await Promise.all([
      sb.from('asistente_numeros').select('*').order('tipo').order('creado_en'),
      sb.from('equipo').select('user_id, nombre, activo').order('nombre'),
    ]);
    $('#asis-numeros').innerHTML = (numeros || []).length ? `<table class="tabla"><thead><tr><th>Número</th><th>Tipo</th><th>Nombre</th><th></th></tr></thead><tbody>
      ${numeros.map((n) => `<tr><td>+${esc(n.whatsapp)}</td><td>${n.tipo === 'equipo' ? 'Equipo' : 'Prueba'}</td><td>${esc(n.nombre || (equipo || []).find((e) => e.user_id === n.user_id)?.nombre || '')}</td>
        <td>${st.admin ? `<button class="btn btn-peligro btn-chico" data-borrar-num="${esc(n.whatsapp)}">Quitar</button>` : ''}</td></tr>`).join('')}</tbody></table>`
      : '<p class="suave chico">Todavía no hay números cargados.</p>';
    $$('[data-borrar-num]').forEach((b) => (b.onclick = async () => {
      try { await llamar('asistente_panel_borrar_numero', { p_whatsapp: b.dataset.borrarNum }, 'Quitado'); pintarAjustes(); } catch (err) { errorEn(null, err); }
    }));
    $('#an-persona').innerHTML = (equipo || []).filter((e) => e.activo).map((e) => `<option value="${e.user_id}">${esc(e.nombre)}</option>`).join('');
    $('#asis-form-num').classList.toggle('oculto', !st.admin);
    $('#asis-num-solo-admin').classList.toggle('oculto', !!st.admin);
  }
  $('#an-tipo').onchange = () => $('#an-persona-campo').classList.toggle('oculto', $('#an-tipo').value !== 'equipo');
  $('#asis-form-num').onsubmit = async (e) => {
    e.preventDefault();
    const tipo = $('#an-tipo').value;
    try {
      await llamar('asistente_panel_guardar_numero', { p_whatsapp: $('#an-num').value, p_tipo: tipo, p_nombre: $('#an-nombre').value,
        p_user_id: tipo === 'equipo' ? $('#an-persona').value : null }, 'Número guardado');
      e.target.reset(); $('#an-persona-campo').classList.add('oculto'); pintarAjustes();
    } catch (err) { errorEn(null, err); }
  };

  // ---------------------------------------------------------------- número de la pestaña
  async function badge() {
    const { data } = await sb.rpc('asistente_panel_badge');
    const b = $('#badge-asis');
    if (!b) return;
    b.textContent = data || '';
    b.classList.toggle('oculto', !data);
    const { data: sols } = await sb.from('asistente_solicitudes').select('id').eq('estado', 'pendiente');
    const ba = $('#badge-aprobar');
    if (ba) { ba.textContent = sols?.length || ''; ba.classList.toggle('oculto', !sols?.length); }
  }

  return { pintar: () => irA(est.sub), badge };
}

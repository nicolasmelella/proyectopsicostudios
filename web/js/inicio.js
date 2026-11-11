// Panel → Inicio: vista ejecutiva (cobrado, horas, ocupación, objetivo, cobros por día,
// origen de las reservas nuevas, últimas reservas y tareas pendientes) en una pantalla.
import { esc, pesos, hoyAR, sumarDias, fechaCorta, fechaLarga, rangos, DIAS } from './comun.js';

// Colores de la serie y de los orígenes (paleta validada sobre el fondo oscuro, ver docs)
const SERIE = '#3987e5';
const ORIGEN = [['web', 'Web', '#3987e5'], ['panel', 'Panel', '#d95926'], ['asistente', 'Asistente de WhatsApp', '#199e70']];
// Estados: color + texto (nunca solo color)
const ESTADO = {
  confirmada: ['Confirmada', '#0ca30c'], activo: ['Activo', '#0ca30c'],
  pendiente: ['Sin seña', '#fab219'], solicitud: ['Sin pagar', '#fab219'],
  vencida: ['No pagó', '#d03b3b'], vencido: ['No pagó', '#d03b3b'], cancelada: ['Cancelada', '#9aa6c4'],
  rechazado: ['Rechazado', '#9aa6c4'], cancelado: ['Cancelado', '#9aa6c4'], baja: ['De baja', '#9aa6c4'],
};

function periodo(tipo) {
  const hoy = hoyAR();
  const ini = hoy.slice(0, 8) + '01';
  const finDeMes = (d) => sumarDias(sumarDias(d.slice(0, 8) + '28', 4).slice(0, 8) + '01', -1);
  if (tipo === 'pasado') { const ant = sumarDias(ini, -1); return { desde: ant.slice(0, 8) + '01', hasta: ant, nombre: 'el mes pasado', comp: 'el mes anterior' }; }
  if (tipo === '30') return { desde: sumarDias(hoy, -29), hasta: hoy, nombre: 'los últimos 30 días', comp: 'los 30 días anteriores' };
  return { desde: ini, hasta: finDeMes(hoy), nombre: 'este mes', comp: 'el mes pasado' };
}

const variacion = (a, b) => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
const flecha = (v) => (v === null ? '' : `<span class="ej-var ${v >= 0 ? 'sube' : 'baja'}">${v >= 0 ? '↑' : '↓'} ${Math.abs(v)}%</span>`);
const corto = (n) => (n >= 1e6 ? `$${(n / 1e6).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M` : n >= 1e3 ? `$${Math.round(n / 1e3)} mil` : pesos(n));

// Barras de cobrado por día (una serie: sin leyenda; el título la nombra). Tooltip al pasar o tocar.
function graficoCobros(dias, W = 640) {
  const H = 220, izq = 46, abajo = 24, arriba = 8;
  const max = Math.max(1, ...dias.map((d) => d.cobrado));
  const paso = 10 ** Math.floor(Math.log10(max)); const tope = Math.ceil(max / paso) * paso;
  const ancho = (W - izq) / dias.length, barra = Math.max(2, ancho - 2);
  const y = (v) => H - abajo - ((H - abajo - arriba) * v) / tope;
  const lineas = [0, tope / 2, tope].map((v) => `<line x1="${izq}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="ej-grilla"/>
    <text x="${izq - 6}" y="${y(v) + 4}" text-anchor="end" class="ej-eje">${corto(v)}</text>`).join('');
  const marcas = dias.map((d, i) => {
    const x = izq + i * ancho + 1, alto = Math.max(0, y(0) - y(d.cobrado)), r = Math.min(4, barra / 2, alto);
    const forma = alto > 0 ? `<path d="M${x},${y(0)} v${-(alto - r)} q0,${-r} ${r},${-r} h${barra - 2 * r} q${r},0 ${r},${r} v${alto - r} z" fill="${SERIE}"/>` : '';
    return `<g class="ej-barra" data-i="${i}">${forma}<rect x="${x - 1}" y="${arriba}" width="${ancho}" height="${H - abajo - arriba}" fill="transparent"/></g>`;
  }).join('');
  const cada = Math.ceil(dias.length / 6);
  const fechas = dias.map((d, i) => (i % cada === 0 ? `<text x="${izq + i * ancho + ancho / 2}" y="${H - 6}" text-anchor="middle" class="ej-eje">${fechaCorta(d.fecha)}</text>` : '')).join('');
  return `<div class="ej-graf"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Cobrado por día">${lineas}${marcas}${fechas}</svg>
    <div class="ej-tip oculto" role="status"></div></div>`;
}

// El gráfico se dibuja al ancho real (así las letras no se achican en el celular)
function anchoGrafico(cont) {
  const total = cont.clientWidth || 900;
  return Math.max(280, Math.round((total > 900 ? (total - 12) * 2 / 3 : total) - 34));
}

export function crearInicio({ sb, $, $$, irA, errorEn }) {
  let tipo = 'mes';

  async function pintar() {
    const cont = $('#inicio-cont');
    const p = periodo(tipo);
    $$('[data-ej-per]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.ejPer === tipo));
    $('#ej-rango').textContent = `${fechaCorta(p.desde)} al ${fechaCorta(p.hasta)}`;
    cont.innerHTML = '<div class="cargando">Cargando…</div>';
    const { data: v, error } = await sb.rpc('vista_ejecutiva', { p_desde: p.desde, p_hasta: p.hasta });
    if (error) { cont.innerHTML = ''; return errorEn(null, error); }

    const ocup = v.capacidad ? Math.round((v.horas / v.capacidad) * 100) : 0;
    const objPct = v.objetivo ? Math.min(100, Math.round((v.cobrado / v.objetivo) * 100)) : 0;
    const totalOrigen = ORIGEN.reduce((s, [k]) => s + (v.origen[k] || 0), 0);
    const t = v.tareas;
    const tareas = [
      ['transferencia', '💸 Avisaron que transfirieron', 'Revisá la cuenta y registrá el pago', 'pendientes'],
      ['comprobantes', '🧾 Comprobantes para revisar', '', 'pendientes'],
      ['vencidos', '⏰ Pagos atrasados', 'Señas, saldos y meses de fijos', 'pendientes'],
      ['no_pago', '⛔ No pagaron (se liberaron)', 'Recuperar o descartar', 'pendientes'],
      ['por_vencer', '📅 Pagos por vencer', '', 'pendientes'],
      ['pagos_a_revisar', '🔎 Pagos a revisar', '', 'pendientes'],
      ['asistente', '💬 Pedidos del asistente', 'Para aprobar', 'asistente'],
    ].filter(([k]) => t[k] > 0);

    cont.innerHTML = `
      <div class="ej-kpis">
        <div class="ej-card"><div class="ej-t">Cobrado</div><div class="ej-v">${pesos(v.cobrado)}</div>
          <div class="ej-s">${flecha(variacion(v.cobrado, v.cobrado_anterior))} vs ${esc(p.comp)}</div></div>
        <div class="ej-card"><div class="ej-t">Horas alquiladas</div><div class="ej-v">${v.horas.toLocaleString('es-AR')}</div>
          <div class="ej-s">${flecha(variacion(v.horas, v.horas_anterior))} vs ${esc(p.comp)}</div></div>
        <div class="ej-card"><div class="ej-t">Ocupación</div><div class="ej-v">${ocup}%</div>
          <div class="ej-meter" role="meter" aria-valuenow="${ocup}" aria-valuemin="0" aria-valuemax="100" aria-label="Ocupación"><span style="width:${ocup}%"></span></div>
          <div class="ej-s">${v.horas.toLocaleString('es-AR')} de ${v.capacidad.toLocaleString('es-AR')} horas disponibles</div></div>
        <div class="ej-card"><div class="ej-t">Objetivo del mes</div>${v.objetivo ? `<div class="ej-v">${objPct}%</div>
          <div class="ej-meter" role="meter" aria-valuenow="${objPct}" aria-valuemin="0" aria-valuemax="100" aria-label="Objetivo"><span style="width:${objPct}%"></span></div>
          <div class="ej-s">${pesos(v.cobrado)} de ${pesos(v.objetivo)}</div>`
          : `<div class="ej-v ej-chico">Sin objetivo</div><div class="ej-s"><button type="button" class="ej-link" data-ej-ir="ajustes">Cargalo en Precios y ajustes →</button></div>`}</div>
      </div>
      <div class="ej-fila">
        <div class="ej-card ej-ancha"><div class="ej-cab"><h3>Cobrado por día</h3><span class="ej-s">${esc(p.nombre)}</span></div>
          ${v.cobrado || v.cobrado_anterior ? graficoCobros(v.por_dia, anchoGrafico(cont)) : '<p class="ej-vacio">Todavía no hay pagos registrados en este período.</p>'}
          <details class="ej-tabla-ver"><summary>Ver como tabla</summary><table><thead><tr><th>Día</th><th>Cobrado</th><th>Horas</th></tr></thead><tbody>
            ${v.por_dia.filter((d) => d.cobrado || d.horas).map((d) => `<tr><td>${esc(fechaCorta(d.fecha))}</td><td>${pesos(d.cobrado)}</td><td>${d.horas}</td></tr>`).join('')}</tbody></table></details></div>
        <div class="ej-card"><div class="ej-cab"><h3>De dónde vienen las reservas</h3></div>
          ${totalOrigen ? `<div class="ej-total">${totalOrigen} <span>reservas nuevas</span></div>
          <div class="ej-seg" role="img" aria-label="Reservas nuevas por origen">${ORIGEN.filter(([k]) => v.origen[k]).map(([k, n, c]) =>
            `<span style="flex:${v.origen[k]};background:${c}" title="${esc(n)}: ${v.origen[k]}"></span>`).join('')}</div>
          <ul class="ej-leyenda">${ORIGEN.map(([k, n, c]) => `<li><i style="background:${c}"></i>${esc(n)}<b>${v.origen[k] || 0}</b><em>${totalOrigen ? Math.round(((v.origen[k] || 0) / totalOrigen) * 100) : 0}%</em></li>`).join('')}</ul>`
          : '<p class="ej-vacio">No hubo reservas nuevas en este período.</p>'}</div>
      </div>
      <div class="ej-fila">
        <div class="ej-card ej-ancha"><div class="ej-cab"><h3>Últimas reservas</h3></div>
          ${v.ultimas.length ? `<div class="ej-scroll"><table class="ej-tabla"><thead><tr><th>Profesional</th><th>Reserva</th><th>Total</th><th>Estado</th></tr></thead><tbody>
          ${v.ultimas.map((u) => {
            const [txt, color] = ESTADO[u.estado] || [u.estado, '#9aa6c4'];
            const que = u.tipo === 'fijo' ? `Fijo · ${DIAS[u.dia]} ${rangos(u.horas)}` : `${fechaLarga(u.fecha)} · ${rangos(u.horas)}`;
            return `<tr><td><strong>${esc(u.nombre)}</strong></td><td>${esc(que)}<br><small>${esc(u.consultorio)}</small></td>
              <td>${pesos(u.total)}${u.pagado ? `<br><small>pagó ${pesos(u.pagado)}</small>` : ''}</td>
              <td><span class="ej-estado"><i style="background:${color}"></i>${esc(txt)}</span></td></tr>`;
          }).join('')}</tbody></table></div>` : '<p class="ej-vacio">Todavía no hay reservas de la web ni del panel.</p>'}</div>
        <div class="ej-card"><div class="ej-cab"><h3>Tareas pendientes</h3></div>
          ${tareas.length ? `<ul class="ej-tareas">${tareas.map(([k, titulo, sub, tab]) => `<li><button type="button" data-ej-ir="${tab}">
            <span><strong>${titulo}</strong>${sub ? `<small>${esc(sub)}</small>` : ''}</span><b>${t[k]}</b></button></li>`).join('')}</ul>`
          : '<p class="ej-vacio">Nada pendiente. 🎉</p>'}</div>
      </div>`;

    $$('[data-ej-ir]', cont).forEach((b) => (b.onclick = () => irA(b.dataset.ejIr)));
    const graf = $('.ej-graf', cont);
    if (graf) {
      const tip = $('.ej-tip', graf);
      const mostrar = (g) => {
        const d = v.por_dia[Number(g.dataset.i)];
        $$('.ej-barra', graf).forEach((x) => x.classList.toggle('activa', x === g));
        tip.innerHTML = `<strong>${esc(fechaLarga(d.fecha))}</strong><br>Cobrado: ${pesos(d.cobrado)}<br>Horas alquiladas: ${d.horas}`;
        const caja = graf.getBoundingClientRect(), r = g.getBoundingClientRect();
        tip.style.left = `${Math.min(caja.width - 170, Math.max(0, r.left - caja.left - 70))}px`;
        tip.classList.remove('oculto');
      };
      $$('.ej-barra', graf).forEach((g) => { g.onmouseenter = () => mostrar(g); g.onclick = () => mostrar(g); });
      graf.onmouseleave = () => { tip.classList.add('oculto'); $$('.ej-barra', graf).forEach((x) => x.classList.remove('activa')); };
    }
  }

  $$('[data-ej-per]').forEach((b) => (b.onclick = () => { tipo = b.dataset.ejPer; pintar(); }));
  return { pintar };
}

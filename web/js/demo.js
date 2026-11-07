// MODO DEMO: imita a Supabase en el navegador con datos de prueba.
// Sirve para ver y probar las pantallas sin tener la base conectada.
// Las reglas de verdad están en supabase/*.sql; esto es una copia simplificada.
import { hoyAR, horaAR, sumarDias, diaSemana } from './comun.js';

export function crearClienteDemo() {
  const hoy = hoyAR();
  let seq = 100;
  const nuevoId = () => ++seq;
  const ahoraISO = (minutos = 0) => new Date(Date.now() + minutos * 60000).toISOString();

  const db = {
    config: [
      ['hora_apertura', '8'], ['hora_cierre', '21'], ['retencion_suelta_minutos', '120'],
      ['retencion_fijo_horas', '48'], ['semanas_fijo', '12'], ['dias_reserva_maximo', '60'],
      ['hora_fin_manana', '13'], ['porcentaje_sena', '50'], ['max_pendientes_por_whatsapp', '2'],
      ['max_horas_por_reserva', '6'], ['alias_transferencia', 'psicostudios.demo'], ['cvu_transferencia', '0000000000000000000000'],
      ['titular_transferencia', 'Psico Studios (demo)'], ['whatsapp_contacto', '5491100000000'],
      ['mercadopago_activo', 'si'],
    ].map(([clave, valor]) => ({ clave, valor, descripcion: '' })),
    consultorios: [1, 2, 3, 4, 5, 6].map((id) => ({
      id, nombre: id === 6 ? 'Salón' : `Consultorio ${id}`, orden: id, activo: true, online: true,
    })),
    precios: [
      { id: 1, modalidad: 'suelta', franja: 'manana', valor: 8500, vigente_desde: '2026-01-01' },
      { id: 2, modalidad: 'suelta', franja: 'tarde', valor: 9000, vigente_desde: '2026-01-01' },
      { id: 3, modalidad: 'fijo', franja: 'manana', valor: 8200, vigente_desde: '2026-01-01' },
      { id: 4, modalidad: 'fijo', franja: 'tarde', valor: 8500, vigente_desde: '2026-01-01' },
    ],
    profesionales: [
      { id: 1, nombre: 'Lucía Fernández', whatsapp: '1141234567', profesion: 'Psicólogo/a', origen: 'Web', email: null, notas: null },
      { id: 2, nombre: 'Martín Gómez', whatsapp: '1152345678', profesion: 'Psiquiatra', origen: 'Recomendación', email: null, notas: null },
      { id: 3, nombre: 'Sofía Ruiz', whatsapp: '1163456789', profesion: 'Psicopedagogo/a', origen: 'Meta Ads', email: null, notas: null },
      { id: 4, nombre: 'Diego Álvarez', whatsapp: '1174567890', profesion: 'Psicólogo/a', origen: 'Google', email: null, notas: null },
    ],
    reservas: [], fijos: [], pagos: [], bloqueos: [], fijo_excepciones: [], pagos_a_revisar: [],
    ocupaciones: new Map(), // "cons|fecha|hora" → {reserva_id|fijo_id|bloqueo_id}
  };
  const cfg = (k) => Number(db.config.find((c) => c.clave === k)?.valor);
  const key = (c, f, h) => `${c}|${f}|${h}`;
  const libre = (c, f, horas) => horas.every((h) => !db.ocupaciones.has(key(c, f, h)));
  const err = (message, hint) => ({ data: null, error: { message, hint } });
  const precioHora = (mod, h, f) => {
    const franja = h < cfg('hora_fin_manana') ? 'manana' : 'tarde';
    return db.precios.filter((p) => p.modalidad === mod && p.franja === franja && p.vigente_desde <= f)
      .sort((a, b) => (a.vigente_desde < b.vigente_desde ? 1 : -1))[0]?.valor || 0;
  };
  const pagado = (rid) => db.pagos.filter((p) => p.reserva_id === rid && !p.anulado).reduce((s, p) => s + p.monto, 0);
  const sena = (t) => Math.ceil((t * cfg('porcentaje_sena')) / 100);
  const fechasFijo = (f) => {
    const out = [];
    let d = f.desde;
    const tope = sumarDias(hoy, 7 * cfg('semanas_fijo'));
    while (d <= tope && (!f.hasta || d <= f.hasta)) {
      if (d >= hoy && !db.fijo_excepciones.some((e) => e.fijo_id === f.id && e.fecha === d)) out.push(d);
      d = sumarDias(d, 7);
    }
    return out;
  };
  const ocuparFijo = (f) => {
    for (const d of fechasFijo(f)) for (const h of f.horas) {
      const k = key(f.consultorio_id, d, h);
      if (!db.ocupaciones.has(k)) db.ocupaciones.set(k, { fijo_id: f.id });
    }
  };
  const proximo = (dia) => { let d = sumarDias(hoy, 1); while (diaSemana(d) !== dia) d = sumarDias(d, 1); return d; };

  // ---- datos de ejemplo ----
  const agregarReserva = (prof, cons, fecha, horas, est, pagadoMonto, minutos) => {
    const r = {
      id: nuevoId(), profesional_id: prof, consultorio_id: cons, fecha, horas, origen: 'web',
      precio_total: horas.reduce((s, h) => s + precioHora('suelta', h, fecha), 0),
      estado: est, expira_en: minutos ? ahoraISO(minutos) : null, creado_en: ahoraISO(-30), token_pago: crypto.randomUUID(),
    };
    db.reservas.push(r);
    horas.forEach((h) => db.ocupaciones.set(key(cons, fecha, h), { reserva_id: r.id }));
    if (pagadoMonto) db.pagos.push({ id: nuevoId(), reserva_id: r.id, fijo_id: null, periodo: null, monto: pagadoMonto, medio: 'transferencia', pagado_en: hoy, anulado: false, creado_en: ahoraISO(-20) });
    return r;
  };
  let d1 = sumarDias(hoy, 1); if (diaSemana(d1) === 7) d1 = sumarDias(d1, 1);
  let d2 = sumarDias(d1, 1); if (diaSemana(d2) === 7) d2 = sumarDias(d2, 1);
  const hoyAbierto = diaSemana(hoy) !== 7;
  if (hoyAbierto) {
    agregarReserva(2, 2, hoy, [17, 18], 'confirmada', 18000);
    agregarReserva(4, 3, hoy, [19], 'confirmada', 4500);
  }
  agregarReserva(1, 1, d1, [10, 11], 'confirmada', 8500);
  agregarReserva(3, 2, d1, [15, 16, 17], 'pendiente', 0, 85);
  agregarReserva(4, 1, d2, [9], 'pendiente', 0, 25);
  const f1 = { id: nuevoId(), profesional_id: 2, consultorio_id: 4, dia_semana: diaSemana(d1), horas: [9, 10, 11],
    precio_semanal: 3 * 8200, estado: 'activo', desde: hoyAbierto && diaSemana(hoy) === diaSemana(d1) ? hoy : d1, hasta: null, expira_en: null, origen: 'panel' };
  const f2 = { id: nuevoId(), profesional_id: 1, consultorio_id: 5, dia_semana: 3, horas: [14, 15],
    precio_semanal: 2 * 8500, estado: 'solicitud', desde: proximo(3), hasta: null, expira_en: ahoraISO(60 * 30), origen: 'web' };
  db.fijos.push(f1, f2);
  ocuparFijo(f1); ocuparFijo(f2);
  db.pagos_a_revisar.push({ id: nuevoId(), reserva_id: null, mp_payment_id: '123456789', monto: 4250, resuelto: false, creado_en: ahoraISO(-90),
    motivo: 'Pagó después del vencimiento y el horario ya no está libre' });
  db.pagos.push({ id: nuevoId(), reserva_id: null, fijo_id: f1.id, periodo: hoy.slice(0, 7), monto: 106600, medio: 'efectivo', pagado_en: hoy, anulado: false, creado_en: ahoraISO(-600) });

  const conJoins = (tabla, fila) => {
    if (tabla === 'reservas' || tabla === 'fijos') {
      const p = db.profesionales.find((x) => x.id === fila.profesional_id);
      const c = db.consultorios.find((x) => x.id === fila.consultorio_id);
      return { ...fila, profesionales: p ? { ...p } : null, consultorios: c ? { nombre: c.nombre } : null };
    }
    return { ...fila };
  };

  // ---- consultas tipo supabase.from(...) ----
  class Consulta {
    constructor(tabla) { this.tabla = tabla; this.filtros = []; this.modo = 'select'; this.orden = []; this.lim = null; }
    select() { return this; }
    eq(c, v) { this.filtros.push((r) => r[c] == v); return this; }
    neq(c, v) { this.filtros.push((r) => r[c] != v); return this; }
    in(c, vs) { this.filtros.push((r) => vs.includes(r[c])); return this; }
    gte(c, v) { this.filtros.push((r) => r[c] >= v); return this; }
    lte(c, v) { this.filtros.push((r) => r[c] <= v); return this; }
    order(c, { ascending = true } = {}) { this.orden.push([c, ascending]); return this; }
    limit(n) { this.lim = n; return this; }
    update(v) { this.modo = 'update'; this.valores = v; return this; }
    insert(v) { this.modo = 'insert'; this.valores = Array.isArray(v) ? v : [v]; return this; }
    then(ok, mal) { return Promise.resolve(this.ejecutar()).then(ok, mal); }
    ejecutar() {
      const tabla = db[this.tabla];
      if (!Array.isArray(tabla)) return err('tabla desconocida');
      if (this.modo === 'insert') {
        this.valores.forEach((v) => tabla.push({ id: nuevoId(), ...v }));
        return { data: null, error: null };
      }
      let filas = tabla.filter((r) => this.filtros.every((f) => f(r)));
      if (this.modo === 'update') { filas.forEach((r) => Object.assign(r, this.valores)); return { data: filas.map((r) => ({ ...r })), error: null }; }
      filas = filas.map((r) => conJoins(this.tabla, r));
      for (const [c, asc] of [...this.orden].reverse()) {
        filas.sort((a, b) => (a[c] === b[c] ? 0 : (a[c] > b[c]) === asc ? 1 : -1));
      }
      if (this.lim) filas = filas.slice(0, this.lim);
      return { data: filas, error: null };
    }
  }

  // ---- funciones (rpc) ----
  const rpcs = {
    es_equipo: () => !!sesion,
    disponibilidad({ p_desde, p_hasta }) {
      const out = [];
      for (let f = p_desde < hoy ? hoy : p_desde; f <= p_hasta; f = sumarDias(f, 1)) {
        if (diaSemana(f) === 7) continue;
        for (let h = cfg('hora_apertura'); h < cfg('hora_cierre'); h++) {
          if (f === hoy && h <= horaAR()) continue;
          for (const c of db.consultorios) if (c.activo && c.online && libre(c.id, f, [h])) out.push({ fecha: f, hora: h, consultorio_id: c.id });
        }
      }
      return out;
    },
    disponibilidad_fijo({ p_dia, p_desde }) {
      let d = p_desde; while (diaSemana(d) !== p_dia) d = sumarDias(d, 1);
      const semanas = Array.from({ length: cfg('semanas_fijo') }, (_, i) => sumarDias(d, 7 * i));
      const out = [];
      for (let h = cfg('hora_apertura'); h < cfg('hora_cierre'); h++) {
        for (const c of db.consultorios) {
          if (semanas.every((f) => { const o = db.ocupaciones.get(key(c.id, f, h)); return !o || o.bloqueo_id; })) out.push({ hora: h, consultorio_id: c.id });
        }
      }
      return out;
    },
    obtenerProfesional(nombre, whatsapp, profesion, origen) {
      let p = db.profesionales.find((x) => x.whatsapp === whatsapp);
      if (!p) { p = { id: nuevoId(), nombre, whatsapp, profesion, origen, email: null, notas: null }; db.profesionales.push(p); }
      return p.id;
    },
    crear_reserva({ p_nombre, p_whatsapp, p_profesion, p_fecha, p_horas, p_consultorio }) {
      if (p_horas.length > cfg('max_horas_por_reserva')) return err('DEMASIADAS_HORAS', `Se pueden reservar hasta ${cfg('max_horas_por_reserva')} horas por vez.`);
      const pend = db.reservas.filter((r) => r.estado === 'pendiente' && r.origen === 'web' &&
        db.profesionales.find((p) => p.id === r.profesional_id)?.whatsapp === p_whatsapp).length;
      if (pend >= cfg('max_pendientes_por_whatsapp')) return err('DEMASIADAS_PENDIENTES', 'Ya tenés reservas esperando el pago de la seña. Pagalas o escribinos por WhatsApp.');
      const cons = p_consultorio || db.consultorios.find((c) => c.nombre !== 'Salón' && libre(c.id, p_fecha, p_horas))?.id;
      if (!cons || !libre(cons, p_fecha, p_horas)) return err('SIN_LUGAR', 'Ese horario se acaba de ocupar. Elegí otro.');
      const prof = rpcs.obtenerProfesional(p_nombre, p_whatsapp, p_profesion, 'Web');
      const r = agregarReserva(prof, cons, p_fecha, p_horas, 'pendiente', 0, cfg('retencion_suelta_minutos'));
      return { id: r.id, token: r.token_pago, consultorio: db.consultorios.find((c) => c.id === cons).nombre, total: r.precio_total, sena: sena(r.precio_total), expira_en: r.expira_en };
    },
    crear_solicitud_fijo({ p_nombre, p_whatsapp, p_profesion, p_dia, p_horas, p_desde }) {
      const disp = rpcs.disponibilidad_fijo({ p_dia, p_desde });
      const cons = db.consultorios.find((c) => c.nombre !== 'Salón' && p_horas.every((h) => disp.some((d) => d.hora === h && d.consultorio_id === c.id)))?.id;
      if (!cons) return err('SIN_LUGAR', 'No hay un consultorio libre en ese horario todas las semanas');
      const prof = rpcs.obtenerProfesional(p_nombre, p_whatsapp, p_profesion, 'Web');
      const semanal = p_horas.reduce((s, h) => s + precioHora('fijo', h, p_desde), 0);
      const f = { id: nuevoId(), profesional_id: prof, consultorio_id: cons, dia_semana: p_dia, horas: p_horas, precio_semanal: semanal,
        estado: 'solicitud', desde: p_desde, hasta: null, expira_en: ahoraISO(60 * cfg('retencion_fijo_horas')), origen: 'web' };
      db.fijos.push(f); ocuparFijo(f);
      return { id: f.id, consultorio: db.consultorios.find((c) => c.id === cons).nombre, precio_semanal: semanal, precio_mensual_aprox: Math.round((semanal * 4.33) / 100) * 100 };
    },
    agenda({ p_desde, p_hasta }) {
      const out = [];
      for (const [k, o] of db.ocupaciones) {
        const [c, f, h] = k.split('|');
        if (f < p_desde || f > p_hasta) continue;
        const r = o.reserva_id && db.reservas.find((x) => x.id === o.reserva_id);
        const fj = o.fijo_id && db.fijos.find((x) => x.id === o.fijo_id);
        const b = o.bloqueo_id && db.bloqueos.find((x) => x.id === o.bloqueo_id);
        const p = db.profesionales.find((x) => x.id === (r || fj)?.profesional_id);
        out.push({
          fecha: f, hora: Number(h), consultorio_id: Number(c),
          tipo: r ? 'suelta' : fj ? (fj.estado === 'solicitud' ? 'solicitud' : 'fijo') : 'bloqueo',
          estado: r?.estado || fj?.estado || 'bloqueado', nombre: p?.nombre || b?.motivo, whatsapp: p?.whatsapp || null,
          profesional_id: p?.id || null, reserva_id: r?.id || null, fijo_id: fj?.id || null, bloqueo_id: b?.id || null,
          pagado: r ? pagado(r.id) >= r.precio_total : fj ? db.pagos.some((x) => x.fijo_id === fj.id && !x.anulado && x.periodo === f.slice(0, 7)) : null,
          detalle: null, monto_total: r?.precio_total ?? fj?.precio_semanal ?? null, monto_pagado: r ? pagado(r.id) : null,
          expira_en: r?.expira_en || fj?.expira_en || null,
        });
      }
      for (const e of db.fijo_excepciones) {
        const fj = db.fijos.find((x) => x.id === e.fijo_id);
        if (e.fecha < p_desde || e.fecha > p_hasta || fj.estado !== 'activo') continue;
        const p = db.profesionales.find((x) => x.id === fj.profesional_id);
        for (const h of fj.horas) if (!db.ocupaciones.has(key(fj.consultorio_id, e.fecha, h))) out.push({
          fecha: e.fecha, hora: h, consultorio_id: fj.consultorio_id, tipo: 'liberado', estado: 'libre', nombre: p.nombre,
          whatsapp: p.whatsapp, profesional_id: p.id, reserva_id: null, fijo_id: fj.id, bloqueo_id: null, pagado: null, detalle: e.motivo,
          monto_total: null, monto_pagado: null, expira_en: null });
      }
      return out.sort((a, b) => (a.fecha + a.hora + a.consultorio_id > b.fecha + b.hora + b.consultorio_id ? 1 : -1));
    },
    registrar_pago({ p_monto, p_medio, p_reserva_id, p_fijo_id, p_periodo }) {
      if (p_reserva_id) {
        const r = db.reservas.find((x) => x.id === p_reserva_id);
        if (!['pendiente', 'confirmada'].includes(r.estado)) return err('RESERVA_NO_VIGENTE', 'Esa reserva está vencida o cancelada.');
        if (pagado(r.id) + p_monto > r.precio_total) return err('PAGO_EXCEDE', `Falta pagar $${r.precio_total - pagado(r.id)}`);
      }
      const id = nuevoId();
      db.pagos.push({ id, reserva_id: p_reserva_id || null, fijo_id: p_fijo_id || null, periodo: p_periodo || null, monto: p_monto, medio: p_medio, pagado_en: hoy, anulado: false, creado_en: ahoraISO() });
      const r = p_reserva_id && db.reservas.find((x) => x.id === p_reserva_id);
      if (r && r.estado === 'pendiente' && pagado(r.id) >= sena(r.precio_total)) { r.estado = 'confirmada'; r.expira_en = null; }
      return id;
    },
    estado_pago_reserva({ p_reserva_id, p_token }) {
      const r = db.reservas.find((x) => x.id === p_reserva_id && x.token_pago === p_token);
      if (!r) return err('NO_ENCONTRADO', 'No encontramos esa reserva');
      return { id: r.id, estado: r.estado, fecha: r.fecha, horas: r.horas, consultorio: db.consultorios.find((c) => c.id === r.consultorio_id).nombre,
        total: r.precio_total, pagado: pagado(r.id), sena: sena(r.precio_total), expira_en: r.expira_en };
    },
    resolver_pago_revisar({ p_id, p_nota }) {
      const x = db.pagos_a_revisar.find((y) => y.id === p_id); x.resuelto = true; x.nota = p_nota;
    },
    anular_pago({ p_pago_id }) {
      const p = db.pagos.find((x) => x.id === p_pago_id); p.anulado = true;
      const r = p.reserva_id && db.reservas.find((x) => x.id === p.reserva_id);
      if (r && r.estado === 'confirmada' && pagado(r.id) < sena(r.precio_total)) { r.estado = 'pendiente'; r.expira_en = null; }
    },
    extender_reserva({ p_reserva_id, p_minutos }) {
      const r = db.reservas.find((x) => x.id === p_reserva_id);
      r.expira_en = new Date(Math.max(Date.now(), new Date(r.expira_en || Date.now())) + p_minutos * 60000).toISOString();
    },
    cancelar_reserva({ p_reserva_id, p_motivo }) {
      const r = db.reservas.find((x) => x.id === p_reserva_id);
      r.estado = 'cancelada'; r.motivo_cancelacion = p_motivo;
      for (const [k, o] of db.ocupaciones) if (o.reserva_id === r.id) db.ocupaciones.delete(k);
    },
    cargar_reserva({ p_nombre, p_whatsapp, p_consultorio, p_fecha, p_horas, p_monto_pagado, p_medio }) {
      if (!libre(p_consultorio, p_fecha, p_horas)) return err('SIN_LUGAR', 'Alguna de esas horas ya está ocupada');
      const prof = rpcs.obtenerProfesional(p_nombre, p_whatsapp, null, 'Carga manual');
      const r = agregarReserva(prof, p_consultorio, p_fecha, p_horas, 'pendiente', 0, 0);
      r.origen = 'panel';
      if (p_monto_pagado > 0) rpcs.registrar_pago({ p_monto: p_monto_pagado, p_medio: p_medio || 'efectivo', p_reserva_id: r.id });
      return r.id;
    },
    cargar_fijo({ p_nombre, p_whatsapp, p_consultorio, p_dia, p_horas, p_desde }) {
      const prof = rpcs.obtenerProfesional(p_nombre, p_whatsapp, null, 'Carga manual');
      const f = { id: nuevoId(), profesional_id: prof, consultorio_id: p_consultorio, dia_semana: p_dia, horas: p_horas,
        precio_semanal: p_horas.reduce((s, h) => s + precioHora('fijo', h, p_desde), 0), estado: 'activo', desde: p_desde, hasta: null, expira_en: null, origen: 'panel' };
      if (fechasFijo(f).some((d) => !libre(p_consultorio, d, p_horas))) return err('SIN_LUGAR', 'Alguna semana ya está ocupada en ese horario');
      db.fijos.push(f); ocuparFijo(f); return f.id;
    },
    aprobar_fijo({ p_fijo_id }) { const f = db.fijos.find((x) => x.id === p_fijo_id); f.estado = 'activo'; f.expira_en = null; },
    rechazar_fijo({ p_fijo_id }) {
      const f = db.fijos.find((x) => x.id === p_fijo_id); f.estado = 'rechazado';
      for (const [k, o] of db.ocupaciones) if (o.fijo_id === f.id) db.ocupaciones.delete(k);
    },
    dar_baja_fijo({ p_fijo_id, p_desde }) {
      const f = db.fijos.find((x) => x.id === p_fijo_id); const desde = p_desde || hoy;
      f.estado = 'baja'; f.hasta = sumarDias(desde, -1);
      for (const [k, o] of db.ocupaciones) if (o.fijo_id === f.id && k.split('|')[1] >= desde) db.ocupaciones.delete(k);
    },
    liberar_fijo_fecha({ p_fijo_id, p_fecha, p_motivo }) {
      db.fijo_excepciones.push({ fijo_id: p_fijo_id, fecha: p_fecha, motivo: p_motivo });
      for (const [k, o] of db.ocupaciones) if (o.fijo_id === p_fijo_id && k.split('|')[1] === p_fecha) db.ocupaciones.delete(k);
    },
    volver_a_bloquear_fijo({ p_fijo_id, p_fecha }) {
      const f = db.fijos.find((x) => x.id === p_fijo_id);
      if (!libre(f.consultorio_id, p_fecha, f.horas)) return err('SIN_LUGAR', 'Esa hora ya la tomó otra persona');
      db.fijo_excepciones = db.fijo_excepciones.filter((e) => !(e.fijo_id === p_fijo_id && e.fecha === p_fecha));
      f.horas.forEach((h) => db.ocupaciones.set(key(f.consultorio_id, p_fecha, h), { fijo_id: f.id }));
    },
    crear_bloqueo({ p_fecha, p_hora_desde, p_hora_hasta, p_motivo, p_consultorio }) {
      const cons = db.consultorios.filter((c) => !p_consultorio || c.id === p_consultorio);
      const horas = []; for (let h = p_hora_desde; h < p_hora_hasta; h++) horas.push(h);
      if (cons.some((c) => !libre(c.id, p_fecha, horas))) return err('OCUPADO', 'Hay reservas en ese horario. Cancelalas o movelas antes de bloquear.');
      const b = { id: nuevoId(), consultorio_id: p_consultorio, fecha: p_fecha, hora_desde: p_hora_desde, hora_hasta: p_hora_hasta, motivo: p_motivo };
      db.bloqueos.push(b);
      cons.forEach((c) => horas.forEach((h) => db.ocupaciones.set(key(c.id, p_fecha, h), { bloqueo_id: b.id })));
      return b.id;
    },
    borrar_bloqueo({ p_bloqueo_id }) {
      for (const [k, o] of db.ocupaciones) if (o.bloqueo_id === p_bloqueo_id) db.ocupaciones.delete(k);
      db.bloqueos = db.bloqueos.filter((b) => b.id !== p_bloqueo_id);
    },
  };

  // ---- login de mentira (cualquier usuario/contraseña entra) ----
  let sesion = null;
  const oyentes = [];
  const auth = {
    async signInWithPassword({ email }) {
      sesion = { user: { id: 'demo', email } };
      oyentes.forEach((fn) => fn('SIGNED_IN', sesion));
      return { data: { session: sesion }, error: null };
    },
    async getSession() { return { data: { session: sesion }, error: null }; },
    async signOut() { sesion = null; oyentes.forEach((fn) => fn('SIGNED_OUT', null)); return { error: null }; },
    onAuthStateChange(fn) { oyentes.push(fn); return { data: { subscription: { unsubscribe() {} } } }; },
  };

  return {
    from: (t) => new Consulta(t),
    async rpc(nombre, params = {}) {
      await new Promise((r) => setTimeout(r, 150));
      const fn = rpcs[nombre];
      if (!fn) return err('Función desconocida: ' + nombre);
      try {
        const res = fn(params);
        return res && res.error !== undefined && res.data === null ? res : { data: res ?? null, error: null };
      } catch (e) { return err(e.message); }
    },
    auth,
    // Mercado Pago simulado: el pago se aprueba al instante
    functions: {
      async invoke(nombre, { body }) {
        await new Promise((r) => setTimeout(r, 400));
        const r = db.reservas.find((x) => x.id === body.reserva_id && x.token_pago === body.token);
        if (nombre !== 'mp-crear-pago' || !r) return { data: null, error: { message: 'NO_ENCONTRADO', hint: 'No encontramos esa reserva' } };
        const falta = sena(r.precio_total) - pagado(r.id);
        if (falta > 0) rpcs.registrar_pago({ p_monto: falta, p_medio: 'mercadopago', p_reserva_id: r.id });
        return { data: { demo: true }, error: null };
      },
    },
  };
}

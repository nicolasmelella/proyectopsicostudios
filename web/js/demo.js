// MODO DEMO: imita a Supabase en el navegador con datos de prueba.
// Sirve para ver y probar las pantallas sin tener la base conectada.
// Las reglas de verdad están en supabase/*.sql; esto es una copia simplificada.
// Los datos se guardan en este navegador, así la web y el panel comparten las reservas.
// Si la copia privada del simulador trae datos del Excel, se guardan aparte de los de prueba
// (cada versión de los datos del Excel se guarda aparte, así una lectura nueva no queda tapada por pruebas viejas)
const CLAVE_GUARDADO = globalThis.PSICO_EXCEL ? 'psicostudios-demo-excel-' + (globalThis.PSICO_EXCEL.version || 'v1') : 'psicostudios-demo-v1';
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
      ['mercadopago_activo', 'si'], ['meses_reserva_maximo', '2'], ['max_dias_por_pedido', '8'], ['min_horas_fijo_manana', '1'], ['min_horas_fijo_tarde', '2'], ['horas_espera_comprobante', '12'], ['avisos_email_activo', 'si'], ['avisos_whatsapp_activo', 'no'], ['email_equipo', 'consultoriospsicostudios@gmail.com'], ['max_comprobantes_por_pedido', '5'], ['quienes_cobran', 'Silvia,Nico'], ['niveles_volumen', '[{"n":"Base","min":0,"pct":0},{"n":"Frecuente","min":8,"pct":5},{"n":"Destacado","min":20,"pct":10}]'],
      ['asistente_activo', 'si'], ['asistente_solo_prueba', 'si'], ['asistente_nombre', 'Sofía'], ['asistente_minutos_pausa', '60'],
      ['asistente_horas_charla', '24'], ['asistente_recordar_sena', 'no'], ['asistente_minutos_recordatorio', '60'], ['asistente_esfuerzo', 'medium'],
      ['asistente_seguimiento', 'no'], ['asistente_horas_seguimiento', '3'], ['asistente_transcribir_audios', 'si'], ['asistente_toma_reservas', 'no'],
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
      { id: 1, nombre: 'Lucía Fernández', whatsapp: '1141234567', profesion: 'Psicólogo/a', origen: 'Web', email: 'lucia.fernandez@ejemplo.com', notas: null },
      { id: 2, nombre: 'Martín Gómez', whatsapp: '1152345678', profesion: 'Psiquiatra', origen: 'Recomendación', email: null, notas: null },
      { id: 3, nombre: 'Sofía Ruiz', whatsapp: '1163456789', profesion: 'Psicopedagogo/a', origen: 'Meta Ads', email: null, notas: null },
      { id: 4, nombre: 'Diego Álvarez', whatsapp: '1174567890', profesion: 'Psicólogo/a', origen: 'Google', email: null, notas: null },
    ],
    reservas: [], fijos: [], pagos: [], bloqueos: [], fijo_excepciones: [], pagos_a_revisar: [], pedidos: [], comprobantes: [], archivos: [],
    equipo: [], notas_semana: [],
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
  const fechaMax = (() => {
    const [a, m, dd] = hoy.split('-').map(Number);
    const destino = new Date(Date.UTC(a, m - 1 + 2, 1));
    destino.setUTCDate(Math.min(dd, new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate()));
    return destino.toISOString().slice(0, 10);
  })();
  const contactoInvalido = (profesion, email) =>
    (!profesion || profesion.trim().length < 2) ? err('FALTA_PROFESION', 'Contanos tu profesión')
      : (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) ? err('EMAIL_INVALIDO', 'Revisá el mail: tiene que ser del tipo nombre@ejemplo.com') : null;
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
  // Otros fijos de ejemplo, repartidos en la semana (como en el Excel)
  [[4, 1, 1, [9, 10, 11]], [3, 3, 2, [15, 16, 17]], [1, 6, 4, [18, 19]], [2, 2, 5, [10]], [3, 5, 6, [9, 10]], [4, 4, 3, [17, 18]]]
    .forEach(([prof, cons, dia, horas]) => {
      const f = { id: nuevoId(), profesional_id: prof, consultorio_id: cons, dia_semana: dia, horas,
        precio_semanal: horas.reduce((s, h) => s + precioHora('fijo', h, hoy), 0), estado: 'activo', desde: proximo(dia), hasta: null, expira_en: null, origen: 'panel' };
      if (fechasFijo(f).every((d) => libre(cons, d, horas))) { db.fijos.push(f); ocuparFijo(f); }
    });
  db.pagos_a_revisar.push({ id: nuevoId(), reserva_id: null, mp_payment_id: '123456789', monto: 4250, resuelto: false, creado_en: ahoraISO(-90),
    motivo: 'Pagó después del vencimiento y el horario ya no está libre' });
  db.pagos.push({ id: nuevoId(), reserva_id: null, fijo_id: f1.id, periodo: hoy.slice(0, 7), monto: 106600, medio: 'efectivo', pagado_en: hoy, anulado: false, creado_en: ahoraISO(-600) });

  // ---- datos reales del Excel: SOLO en la copia privada del simulador (este repositorio no los tiene) ----
  const EXCEL = globalThis.PSICO_EXCEL;
  if (EXCEL) {
    Object.assign(db, { reservas: [], fijos: [], pagos: [], bloqueos: [], fijo_excepciones: [], pagos_a_revisar: [], pedidos: [], comprobantes: [], notas_semana: [] });
    db.ocupaciones = new Map();
    const idPersona = new Map();
    db.profesionales = EXCEL.personas.map((p) => {
      const id = nuevoId(); idPersona.set(p.clave, id);
      return { id, nombre: p.nombre, whatsapp: '', profesion: null, origen: 'Excel', email: null, notas: null };
    });
    for (const f of EXCEL.fijos) {
      const fj = { id: nuevoId(), profesional_id: idPersona.get(f.clave), consultorio_id: f.cons, dia_semana: f.dia, horas: f.horas,
        precio_semanal: f.horas.reduce((s, h) => s + precioHora('fijo', h, f.desde), 0), estado: 'activo', desde: f.desde, hasta: null, expira_en: null, origen: 'panel' };
      db.fijos.push(fj);
      f.no_viene.forEach((fecha) => db.fijo_excepciones.push({ fijo_id: fj.id, fecha, motivo: 'Así figura en el Excel' }));
      ocuparFijo(fj);
    }
    for (const s of EXCEL.sueltas) {
      if (s.fecha < hoy || !libre(s.cons, s.fecha, s.horas)) continue;
      const r = agregarReserva(idPersona.get(s.clave), s.cons, s.fecha, s.horas, 'confirmada', 0, 0);
      r.origen = 'panel'; r.tipo_excel = s.tipo || null; r.comentario = s.coment || null;
    }
    // Historia: cada bloque de las semanas pasadas, tal cual estaba en el Excel
    for (const s of EXCEL.historia || []) {
      if (!libre(s.cons, s.fecha, s.horas)) continue;
      const r = agregarReserva(idPersona.get(s.clave), s.cons, s.fecha, s.horas, 'confirmada', 0, 0);
      r.origen = 'excel'; r.tipo_excel = s.tipo; r.comentario = s.coment || null; delete r.token_pago;
    }
    for (const b of EXCEL.bloqueos || []) {
      if (!libre(b.cons, b.fecha, b.horas)) continue;
      const bl = { id: nuevoId(), consultorio_id: b.cons, fecha: b.fecha, hora_desde: b.horas[0], hora_hasta: b.horas.at(-1) + 1, motivo: b.motivo };
      db.bloqueos.push(bl);
      b.horas.forEach((h) => db.ocupaciones.set(key(b.cons, b.fecha, h), { bloqueo_id: bl.id }));
    }
    EXCEL.notas.forEach((n) => db.notas_semana.push({ id: nuevoId(), semana: n.semana, texto: n.texto, autor: null, autor_nombre: 'Excel', creado_en: ahoraISO() }));
  }

  // ---- datos guardados en este navegador (si hay) ----
  try {
    const guardado = JSON.parse(localStorage.getItem(CLAVE_GUARDADO) || 'null');
    if (guardado && guardado.dia === hoy) {
      const configBase = db.config;
      Object.assign(db, guardado.db);
      // ajustes nuevos que no estaban cuando se guardó
      configBase.forEach((c) => { if (!db.config.some((x) => x.clave === c.clave)) db.config.push(c); });
      db.ocupaciones = new Map(guardado.ocupaciones);
      seq = guardado.seq;
    }
  } catch { /* navegador sin almacenamiento: se usa la demo de cero */ }
  // ---- asistente de WhatsApp (20_asistente.sql): datos de ejemplo ----
  if (!db.asistente_chats || !db.asistente_chats.some((c) => c.etapa) || !db.asistente_mensajes.some((m) => m.tipo === 'audio') || !db.asistente_solicitudes || !db.asistente_visitas) {
    const hace = (min) => new Date(Date.now() - min * 60000).toISOString();
    const saber = [
      ['El espacio', '¿Dónde están?', 'Estamos en pleno Microcentro, Buenos Aires. La dirección exacta se la pasamos al confirmar la reserva.'],
      ['El espacio', '¿Qué incluye?', 'Wifi de alta velocidad, aire acondicionado, recepción y sala de espera, y café y snacks para vos. Sin contratos ni costos ocultos.'],
      ['El espacio', '¿Están habilitados?', 'Sí: están habilitados por el Ministerio de Salud y para obras sociales.'],
      ['Reservas', '¿Cómo se confirma una reserva por horas?', 'Los horarios quedan guardados mientras se paga la seña (50% del total). Se paga por transferencia (y se manda la captura por este chat) o por Mercado Pago. El saldo, hasta el día anterior a cada turno.'],
      ['Horario fijo', '¿Qué es el horario fijo?', 'Es el mismo día y horario todas las semanas, con precio preferencial. Se confirma pagando el primer mes.'],
    ];
    Object.assign(db, {
      asistente_conocimiento: saber.map(([tema, pregunta, respuesta], i) => ({ id: nuevoId(), tema, pregunta, respuesta, activo: true, origen: 'inicial', usos: [12, 7, 3, 9, 4][i], creado_en: hace(9000) })),
      asistente_numeros: [{ whatsapp: '5491100001111', tipo: 'prueba', nombre: 'Celular de prueba', user_id: null, creado_en: hace(5000) }],
      asistente_memoria: [{ id: nuevoId(), whatsapp: '5491133334444', dato: 'Prefiere el Consultorio 3', creado_en: hace(3000) }],
      asistente_propuestas: [{ id: nuevoId(), tema: 'El espacio', pregunta: '¿Se puede ir con mascota?', respuesta: 'Sí, perros chicos en la sala de espera, avisando antes.',
        motivo: 'Lo respondió Silvia en una charla', origen: 'equipo', estado: 'pendiente', creado_en: hace(200) }],
      asistente_informes: [{ id: nuevoId(), desde: sumarDias(hoy, -7), hasta: sumarDias(hoy, -1), datos: {
        resumen: 'Escribieron 23 personas. El asistente resolvió 19 sin ayuda y tomó 6 reservas (4 ya pagaron la seña). Lo que más preguntan es disponibilidad de martes y jueves a la tarde.',
        temas_frecuentes: [{ tema: 'Disponibilidad', veces: 14 }, { tema: 'Precios', veces: 9 }, { tema: 'Horario fijo', veces: 5 }],
        preguntas_sin_respuesta: ['¿Tienen estacionamiento?', '¿Emiten factura A?'],
        reservas_perdidas: [{ motivo: 'Sin lugar', detalle: 'Dos personas querían jueves de 18 a 20 y estaba todo ocupado.' }],
        demanda_sin_lugar: ['Jueves de 17 a 21', 'Martes de 18 a 20'],
        errores_del_asistente: [],
        ideas_para_el_negocio: ['Ofrecer las mañanas de martes y jueves a quienes piden la tarde (hay mucho lugar).'],
        propuestas: [] }, creado_en: hace(60) }],
      asistente_pedidos: [],
      asistente_visitas: [],
      asistente_solicitudes: [{ id: nuevoId(), chat_id: 9002, tipo: 'visita', motivo: 'pedido', estado: 'pendiente',
        resumen: 'Visita para conocer el espacio: jueves o viernes a la tarde, después de las 17', nombre_dicho: 'Martín',
        datos: { preferencia: 'jueves o viernes a la tarde, después de las 17' }, profesional_id: null, lugar_guardado: false, creado_en: hace(90) },
        { id: nuevoId(), chat_id: 9004, tipo: 'mover_fijo', motivo: 'sin_identificar', estado: 'pendiente',
        resumen: `Pasar su fijo del martes ${Number(sumarDias(hoy, 8).slice(8))}/${Number(sumarDias(hoy, 8).slice(5, 7))} de 15 a 17 al jueves, misma hora`,
        nombre_dicho: 'Graciela Ruiz', profesional_id: null, datos: {}, lugar_guardado: true, creado_en: hace(25) }],
      asistente_chats: [
        { id: 9001, whatsapp: '5491133334444', nombre: 'Carla Gómez', profesional_id: null, simulado: false, atender: true, urgente: false,
          motivo_atender: 'Pide factura A para su monotributo', pausa_hasta: null, ultimo_mensaje_en: hace(12), ultimo_cliente_en: hace(12), reservo: true,
          etapa: 'reservo', interes: 'horas', valor_estimado: 17000, nota_crm: 'Jueves de 10 a 12, prefiere el Consultorio 3', prioridad: false, asignado_a: null },
        { id: 9002, whatsapp: '5491155557777', nombre: 'Martín (WhatsApp)', profesional_id: null, simulado: false, atender: false, urgente: false,
          motivo_atender: null, pausa_hasta: null, ultimo_mensaje_en: hace(95), ultimo_cliente_en: hace(96), reservo: false,
          etapa: 'interesado', interes: 'fijo', valor_estimado: 136000, nota_crm: 'Busca fijo martes y jueves a la tarde', prioridad: true, asignado_a: null },
        { id: 9004, whatsapp: '5491177771234', nombre: 'Graciela (WhatsApp)', profesional_id: null, simulado: false, atender: false, urgente: false,
          motivo_atender: null, pausa_hasta: null, ultimo_mensaje_en: hace(25), ultimo_cliente_en: hace(26), reservo: false,
          etapa: 'consulta', interes: null, valor_estimado: null, nota_crm: null, prioridad: false, asignado_a: null },
        { id: 9003, whatsapp: '5491166660000', nombre: 'Lucía P.', profesional_id: null, simulado: false, atender: false, urgente: false,
          motivo_atender: null, pausa_hasta: null, ultimo_mensaje_en: hace(400), ultimo_cliente_en: hace(420), reservo: false,
          etapa: 'consulta', interes: 'salon', valor_estimado: null, nota_crm: 'Taller grupal un sábado', prioridad: true, asignado_a: null },
      ],
      asistente_mensajes: [
        [9001, 'cliente', '¡Hola! ¿Tienen lugar el jueves de 10 a 12?', 30], [9001, 'asistente', '¡Hola Carla! Soy Sofía 😊 El jueves de 10 a 12 hs está libre el *Consultorio 3*, el que te gusta. ¿Te lo reservo?', 29],
        [9001, 'cliente', 'Sí, dale', 20], [9001, 'asistente', '¡Listo! Te reservé el jueves de 10 a 12 hs en el Consultorio 3. Total $17.000, seña *$8.500*. Transferí a *psicostudios.demo* y mandame la captura por acá 🙌', 19],
        [9001, 'cliente', 'Genial. ¿Me pueden hacer factura A?', 12], [9001, 'asistente', 'Eso lo ve el equipo: ya les pasé tu consulta y te responden por acá en un rato.', 12],
        [9002, 'cliente', 'Buenas, ¿cuánto sale la hora?', 96], [9002, 'asistente', '¡Hola Martín! Por horas: mañana (8 a 13 hs) *$8.500* y tarde (13 a 21 hs) *$9.000*. Con horario fijo semanal es más barato. ¿Qué día te sirve?', 95],
        [9002, 'cliente', 'Me interesa fijo martes y jueves de 17 a 19. ¿Cómo son los consultorios?', 94],
        [9002, 'asistente', '', 93, 'img/consultorios/c3-a.jpg', 'Consultorio 3: con sofá, sillones y ventanales'],
        [9002, 'asistente', 'Te mandé fotos del 3, que está libre esos días ☝️ Con horario fijo la tarde sale *$8.500* la hora: unos *$136.000* por mes. ¿Te lo pido?', 93],
        [9004, 'cliente', 'Hola, soy Graciela Ruiz, tengo fijo los martes de 15 a 17. ¿El martes que viene lo puedo pasar al jueves?', 26],
        [9004, 'asistente', '¡Hola Graciela! El jueves de 15 a 17 está libre y te lo dejé *guardado*. Como todavía no tengo tu WhatsApp asociado a tu ficha, el cambio lo confirma el equipo: te escriben por acá en un rato. Es por seguridad, y desde ahí ya te voy a reconocer 🙌', 25],
        [9003, 'cliente', 'Hola! ¿Se puede alquilar el Salón un sábado para un taller? Somos unas doce personas, sería a la mañana.', 420, null, null, 'audio'], [9003, 'asistente', '¡Hola Lucía! Sí, el Salón es para grupos y talleres. ¿Qué sábado y en qué horario lo necesitás?', 419],
      ].map(([chat_id, rol, texto, min, url, pie, tipo]) => ({ id: nuevoId(), chat_id, rol, texto: url ? pie : texto, tipo: tipo || (url ? 'imagen' : 'texto'), url,
        envio: rol === 'asistente' ? 'enviado' : null, creado_en: hace(min) })),
    });
  }
  const guardar = () => {
    try {
      const { ocupaciones, ...resto } = db;
      localStorage.setItem(CLAVE_GUARDADO, JSON.stringify({ dia: hoy, seq, db: resto, ocupaciones: [...ocupaciones] }));
    } catch { /* sin almacenamiento */ }
  };
  // A pedido del equipo: nada se libera ni se cancela solo (ver alertas_pago). Queda sin efecto.
  const liberarVencidas = () => {
    return;
    // eslint-disable-next-line no-unreachable
    const ahora = Date.now();
    for (const r of db.reservas) {
      if (r.estado === 'pendiente' && r.expira_en && new Date(r.expira_en) < ahora) {
        r.estado = 'vencida';
        for (const [k, o] of db.ocupaciones) if (o.reserva_id === r.id) db.ocupaciones.delete(k);
      }
    }
    for (const f of db.fijos) {
      if (f.estado === 'solicitud' && f.expira_en && new Date(f.expira_en) < ahora) {
        f.estado = 'vencido';
        for (const [k, o] of db.ocupaciones) if (o.fijo_id === f.id) db.ocupaciones.delete(k);
      }
    }
  };
  liberarVencidas();

  // Copia de registrar_pago_mp (04_mercadopago.sql): lo que hace el servidor cuando Mercado Pago aprueba
  const registrarPagoMP = (reservaId, mpId, monto) => {
    const r = db.reservas.find((x) => x.id === reservaId);
    const aRevisar = (motivo) => { db.pagos_a_revisar.push({ id: nuevoId(), reserva_id: r?.id ?? null, mp_payment_id: mpId, monto, motivo, resuelto: false, creado_en: ahoraISO() }); return 'A_REVISAR'; };
    if (!r) return aRevisar(`Pago para la reserva #${reservaId}, que no existe`);
    if (r.estado === 'vencida' || r.estado === 'cancelada') {
      const futuro = r.fecha > hoy || (r.fecha === hoy && Math.min(...r.horas) > horaAR());
      if (r.estado === 'vencida' && futuro && libre(r.consultorio_id, r.fecha, r.horas)) {
        r.horas.forEach((h) => db.ocupaciones.set(key(r.consultorio_id, r.fecha, h), { reserva_id: r.id }));
        r.estado = 'pendiente'; r.expira_en = null;
      } else {
        return aRevisar(r.estado === 'cancelada' ? 'Pagó una reserva que estaba cancelada' : 'Pagó después del vencimiento y el horario ya no está libre');
      }
    }
    if (pagado(r.id) + monto > r.precio_total) return aRevisar(`Pagó $${monto} pero el saldo era $${r.precio_total - pagado(r.id)}`);
    db.pagos.push({ id: nuevoId(), reserva_id: r.id, fijo_id: null, periodo: null, monto, medio: 'mercadopago', mp_payment_id: mpId, pagado_en: hoy, anulado: false, creado_en: ahoraISO() });
    if (pagado(r.id) >= sena(r.precio_total)) { r.estado = 'confirmada'; r.expira_en = null; return 'CONFIRMADA'; }
    return 'PAGO_PARCIAL';
  };

  // Fijos pedidos desde la web: se paga el primer mes (copia de 16_pagos_completos.sql)
  const pagadoFijo = (fid, periodo) => db.pagos.filter((p) => p.fijo_id === fid && p.periodo === periodo && !p.anulado).reduce((s, p) => s + p.monto, 0);
  const fechasPrimerMes = (f) => {
    const out = [];
    const mes = f.desde.slice(0, 7);
    for (let d = f.desde; d.slice(0, 7) === mes; d = sumarDias(d, 7)) {
      if (db.fijo_excepciones.some((e) => e.fijo_id === f.id && e.fecha === d)) continue;
      if (f.horas.some((h) => db.ocupaciones.get(key(f.consultorio_id, d, h))?.bloqueo_id)) continue;
      out.push(d);
    }
    return out;
  };
  const estadoFijoWeb = (f) => ({ activo: 'confirmada', solicitud: 'pendiente', vencido: 'vencida' }[f.estado] || 'cancelada');
  const aplicarPagoFijo = (f, monto, medio, mpId = null) => {
    if (!['solicitud', 'activo'].includes(f.estado)) {
      if (!mpId) return err('RESERVA_NO_VIGENTE', 'Este fijo ya no está vigente (venció o se canceló). Si hace falta, cargalo de nuevo desde Fijos.');
      db.pagos_a_revisar.push({ id: nuevoId(), reserva_id: null, mp_payment_id: mpId, monto, motivo: `Pagó el fijo #${f.id}, que estaba ${f.estado}`, resuelto: false, creado_en: ahoraISO() });
      return 'A_REVISAR';
    }
    db.pagos.push({ id: nuevoId(), reserva_id: null, fijo_id: f.id, periodo: f.periodo_inicial, monto, medio, mp_payment_id: mpId, pagado_en: hoy, anulado: false, creado_en: ahoraISO() });
    if (f.estado === 'solicitud' && pagadoFijo(f.id, f.periodo_inicial) >= f.pago_inicial) {
      f.estado = 'activo'; f.expira_en = null; f.aprobado_en = ahoraISO();
      ocuparFijo(f);
      return 'CONFIRMADA';
    }
    return f.estado === 'activo' ? 'CONFIRMADA' : 'PAGO_PARCIAL';
  };

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
    range(a, b) { this.rango = [a, b]; return this; }
    update(v) { this.modo = 'update'; this.valores = v; return this; }
    insert(v) { this.modo = 'insert'; this.valores = Array.isArray(v) ? v : [v]; return this; }
    then(ok, mal) { const res = this.ejecutar(); if (this.modo !== 'select') guardar(); return Promise.resolve(res).then(ok, mal); }
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
      if (this.rango) filas = filas.slice(this.rango[0], this.rango[1] + 1);
      return { data: filas, error: null };
    }
  }

  // ---- funciones (rpc) ----
  const rpcs = {
    es_equipo: () => !!sesion && db.equipo.some((e) => e.user_id === sesion.user.id && e.activo !== false),
    // ---- 13_equipo.sql ----
    es_admin: () => !!sesion && db.equipo.some((e) => e.user_id === sesion.user.id && e.activo !== false && e.rol === 'admin'),
    equipo_lista() {
      if (!rpcs.es_admin()) return err('NO_AUTORIZADO', 'Solo un administrador puede hacer esto');
      return db.equipo.map((e) => ({ ...e, activo: e.activo !== false, email: e.email || null, ultimo_ingreso: e.ultimo_ingreso || null }))
        .sort((a, b) => (b.activo - a.activo) || (a.nombre < b.nombre ? -1 : 1));
    },
    equipo_cambiar({ p_user_id, p_activo, p_rol }) {
      if (!rpcs.es_admin()) return err('NO_AUTORIZADO', 'Solo un administrador puede hacer esto');
      if (p_rol && !['admin', 'equipo'].includes(p_rol)) return err('ROL_INVALIDO', 'El rol tiene que ser administrador o equipo');
      if (p_user_id === sesion.user.id && (p_activo === false || p_rol === 'equipo')) return err('NO_A_VOS_MISMO', 'No podés desactivarte ni sacarte el rol de administrador a vos mismo');
      const e = db.equipo.find((x) => x.user_id === p_user_id);
      if (!e) return err('NO_ENCONTRADO', 'No se encontró esa persona');
      if (p_activo !== undefined && p_activo !== null) e.activo = p_activo;
      if (p_rol) e.rol = p_rol;
    },
    disponibilidad({ p_desde, p_hasta }) {
      const out = [];
      for (let f = p_desde < hoy ? hoy : p_desde; f <= p_hasta && f <= fechaMax; f = sumarDias(f, 1)) {
        if (diaSemana(f) === 7) continue;
        for (let h = cfg('hora_apertura'); h < cfg('hora_cierre'); h++) {
          if (f === hoy && h <= horaAR()) continue;
          for (const c of db.consultorios) if (c.activo && c.online && libre(c.id, f, [h])) out.push({ fecha: f, hora: h, consultorio_id: c.id });
        }
      }
      return out;
    },
    resumen_disponibilidad({ p_desde, p_hasta }) {
      const libres = new Map();
      for (const r of rpcs.disponibilidad({ p_desde, p_hasta })) libres.set(r.fecha, (libres.get(r.fecha) || 0) + 1);
      const out = [];
      const nCons = db.consultorios.filter((c) => c.activo && c.online).length;
      for (let f = p_desde < hoy ? hoy : p_desde; f <= p_hasta && f <= fechaMax; f = sumarDias(f, 1)) {
        if (diaSemana(f) === 7) continue;
        const desde = f === hoy ? Math.max(cfg('hora_apertura'), horaAR() + 1) : cfg('hora_apertura');
        out.push({ fecha: f, libres: libres.get(f) || 0, total: Math.max(0, cfg('hora_cierre') - desde) * nCons });
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
    obtenerProfesional(nombre, whatsapp, profesion, origen, email = null) {
      let p = db.profesionales.find((x) => x.whatsapp === whatsapp);
      // Persona pasada del Excel sin WhatsApp: se le completa la primera vez que se anota
      if (!p) p = db.profesionales.find((x) => !x.whatsapp && x.nombre.toLowerCase() === String(nombre).trim().toLowerCase());
      if (p && !p.whatsapp) p.whatsapp = whatsapp;
      if (!p) { p = { id: nuevoId(), nombre, whatsapp, profesion, origen, email, notas: null }; db.profesionales.push(p); }
      else { p.profesion = p.profesion || profesion; p.email = p.email || email; }
      return p.id;
    },
    crear_reserva({ p_nombre, p_whatsapp, p_profesion, p_email, p_fecha, p_horas, p_consultorio }) {
      const invalido = contactoInvalido(p_profesion, p_email);
      if (invalido) return invalido;
      if (p_fecha > fechaMax) return err('FECHA_LEJANA', 'Todavía no se puede reservar tan adelante');
      if (p_horas.length > cfg('max_horas_por_reserva')) return err('DEMASIADAS_HORAS', `Se pueden reservar hasta ${cfg('max_horas_por_reserva')} horas por vez.`);
      const pend = db.reservas.filter((r) => r.estado === 'pendiente' && r.origen === 'web' &&
        db.profesionales.find((p) => p.id === r.profesional_id)?.whatsapp === p_whatsapp).length;
      if (pend >= cfg('max_pendientes_por_whatsapp')) return err('DEMASIADAS_PENDIENTES', 'Ya tenés reservas esperando el pago de la seña. Pagalas o escribinos por WhatsApp.');
      const cons = p_consultorio || db.consultorios.find((c) => c.nombre !== 'Salón' && libre(c.id, p_fecha, p_horas))?.id;
      if (!cons || !libre(cons, p_fecha, p_horas)) return err('SIN_LUGAR', 'Ese horario se acaba de ocupar. Elegí otro.');
      const prof = rpcs.obtenerProfesional(p_nombre, p_whatsapp, p_profesion, 'Web', p_email);
      const r = agregarReserva(prof, cons, p_fecha, p_horas, 'pendiente', 0, cfg('retencion_suelta_minutos'));
      return { id: r.id, token: r.token_pago, consultorio: db.consultorios.find((c) => c.id === cons).nombre, total: r.precio_total, sena: sena(r.precio_total), expira_en: r.expira_en };
    },
    crear_pedido({ p_nombre, p_whatsapp, p_profesion, p_email, p_items }) {
      const invalido = contactoInvalido(p_profesion, p_email);
      if (invalido) return invalido;
      if (!p_items?.length) return err('SIN_HORAS', 'Elegí al menos un horario');
      if (p_items.length > cfg('max_dias_por_pedido')) return err('DEMASIADOS_DIAS', `Se pueden reservar hasta ${cfg('max_dias_por_pedido')} días por vez.`);
      const pendientes = new Set(db.reservas.filter((r) => r.estado === 'pendiente' && r.origen === 'web' &&
        db.profesionales.find((p) => p.id === r.profesional_id)?.whatsapp === p_whatsapp).map((r) => (r.pedido_id ? 'p' + r.pedido_id : 'r' + r.id))).size;
      if (pendientes >= cfg('max_pendientes_por_whatsapp')) return err('DEMASIADAS_PENDIENTES', 'Ya tenés reservas esperando el pago de la seña. Pagalas o escribinos por WhatsApp.');
      // todo o nada: primero se revisa todo, después se crea
      const plan = [];
      for (const it of [...p_items].sort((a, b) => (a.fecha < b.fecha ? -1 : 1))) {
        const horas = [...it.horas].map(Number).sort((a, b) => a - b);
        const [, mm, dd] = it.fecha.split('-');
        if (it.fecha > fechaMax) return err('FECHA_LEJANA', 'Todavía no se puede reservar tan adelante');
        if (horas.length > cfg('max_horas_por_reserva')) return err('DEMASIADAS_HORAS', `Se pueden reservar hasta ${cfg('max_horas_por_reserva')} horas por día.`);
        const cons = it.consultorio || db.consultorios.find((c) => c.nombre !== 'Salón' && libre(c.id, it.fecha, horas))?.id;
        if (!cons || !libre(cons, it.fecha, horas)) return err('SIN_LUGAR', `El horario del ${dd}/${mm} se acaba de ocupar. Elegí otro y volvé a intentar.`);
        plan.push({ fecha: it.fecha, horas, cons });
      }
      const prof = rpcs.obtenerProfesional(p_nombre, p_whatsapp, p_profesion, 'Web', p_email);
      const pedido = { id: nuevoId(), token: crypto.randomUUID(), profesional_id: prof, creado_en: ahoraISO() };
      db.pedidos.push(pedido);
      const reservas = plan.map((it) => {
        const r = agregarReserva(prof, it.cons, it.fecha, it.horas, 'pendiente', 0, cfg('retencion_suelta_minutos'));
        r.pedido_id = pedido.id;
        r.token_pago = pedido.token;
        return r;
      });
      return {
        pedido: pedido.id, token: pedido.token, expira_en: reservas[0].expira_en,
        total: reservas.reduce((s, r) => s + r.precio_total, 0), sena: reservas.reduce((s, r) => s + sena(r.precio_total), 0),
        reservas: reservas.map((r) => ({ id: r.id, fecha: r.fecha, horas: r.horas, total: r.precio_total, consultorio: db.consultorios.find((c) => c.id === r.consultorio_id).nombre })),
      };
    },
    // Comprobantes (copia de 07_comprobantes.sql)
    registrar_comprobante({ p_pedido_id, p_token, p_ruta }) {
      const pe = db.pedidos.find((x) => x.id === p_pedido_id && x.token === p_token);
      if (!pe) return err('NO_ENCONTRADO', 'No encontramos ese pedido');
      const a = db.archivos.find((x) => x.ruta === p_ruta);
      if (!a) return err('ARCHIVO_INVALIDO', 'No se pudo subir el archivo. Probá de nuevo.');
      if (!db.comprobantes.some((c) => c.ruta === p_ruta)) {
        db.comprobantes.push({ id: nuevoId(), pedido_id: pe.id, ruta: p_ruta, tipo: a.tipo, estado: 'pendiente', creado_en: ahoraISO() });
      }
      const hasta = ahoraISO(60 * cfg('horas_espera_comprobante'));
      db.reservas.filter((r) => r.pedido_id === pe.id && r.estado === 'pendiente' && r.expira_en).forEach((r) => { if (r.expira_en < hasta) r.expira_en = hasta; });
      db.fijos.filter((f) => f.pedido_id === pe.id && f.estado === 'solicitud').forEach((f) => { if (f.expira_en < hasta) f.expira_en = hasta; });
      return { id: null, horarios_guardados_hasta: hasta };
    },
    comprobantes_pendientes() {
      return db.comprobantes.filter((c) => c.estado === 'pendiente').map((c) => {
        const fw = db.fijos.find((x) => x.pedido_id === c.pedido_id);
        if (fw) {
          const pf = db.profesionales.find((x) => x.id === fw.profesional_id);
          const falta = Math.max(0, fw.pago_inicial - pagadoFijo(fw.id, fw.periodo_inicial));
          const cons = db.consultorios.find((k) => k.id === fw.consultorio_id).nombre;
          return { ...c, nombre: pf?.nombre, whatsapp: pf?.whatsapp, es_fijo: true, fijo_id: fw.id, total: fw.pago_inicial,
            pagado: pagadoFijo(fw.id, fw.periodo_inicial), falta_sena: falta, falta_total: falta,
            reservas: fechasPrimerMes(fw).map((d) => ({ id: null, fecha: d, horas: fw.horas, estado: estadoFijoWeb(fw), consultorio: cons })) };
        }
        const rs = db.reservas.filter((r) => r.pedido_id === c.pedido_id).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
        const vig = rs.filter((r) => ['pendiente', 'confirmada'].includes(r.estado));
        const p = db.profesionales.find((x) => x.id === db.pedidos.find((pe) => pe.id === c.pedido_id)?.profesional_id);
        return { ...c, nombre: p?.nombre, whatsapp: p?.whatsapp,
          falta_sena: vig.reduce((s, r) => s + Math.max(0, sena(r.precio_total) - pagado(r.id)), 0),
          falta_total: vig.reduce((s, r) => s + r.precio_total - pagado(r.id), 0),
          reservas: rs.map((r) => ({ id: r.id, fecha: r.fecha, horas: r.horas, estado: r.estado, consultorio: db.consultorios.find((k) => k.id === r.consultorio_id).nombre })) };
      });
    },
    registrar_pago_pedido({ p_pedido_id, p_monto, p_medio }) {
      const fw = db.fijos.find((x) => x.pedido_id === p_pedido_id);
      if (fw) {
        const faltaF = fw.pago_inicial - pagadoFijo(fw.id, fw.periodo_inicial);
        if (faltaF <= 0) return err('RESERVA_NO_VIGENTE', 'Este fijo ya tiene el primer mes pago.');
        if (p_monto > faltaF) return err('PAGO_EXCEDE', `Lo que falta pagar del primer mes es $${faltaF}`);
        return aplicarPagoFijo(fw, p_monto, p_medio);
      }
      const vig = db.reservas.filter((r) => r.pedido_id === p_pedido_id && ['pendiente', 'confirmada'].includes(r.estado)).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
      const falta = vig.reduce((s, r) => s + r.precio_total - pagado(r.id), 0);
      if (!falta) return err('RESERVA_NO_VIGENTE', 'Este pedido no tiene reservas vigentes con saldo.');
      if (p_monto > falta) return err('PAGO_EXCEDE', `Lo que falta pagar del pedido es $${falta}`);
      let resto = p_monto;
      for (const tope of [(r) => sena(r.precio_total), (r) => r.precio_total]) {
        for (const r of vig) {
          const parte = Math.min(resto, Math.max(0, tope(r) - pagado(r.id)));
          if (parte > 0) { db.pagos.push({ id: nuevoId(), reserva_id: r.id, fijo_id: null, periodo: null, monto: parte, medio: p_medio, pagado_en: hoy, anulado: false, creado_en: ahoraISO() }); resto -= parte; }
        }
      }
      vig.forEach((r) => { if (r.estado === 'pendiente' && pagado(r.id) >= sena(r.precio_total)) { r.estado = 'confirmada'; r.expira_en = null; } });
      return vig.some((r) => r.estado === 'pendiente') ? 'PAGO_PARCIAL' : 'CONFIRMADA';
    },
    revisar_comprobante({ p_id, p_aceptar, p_monto, p_medio, p_nota }) {
      const c = db.comprobantes.find((x) => x.id === p_id && x.estado === 'pendiente');
      if (!c) return err('NO_ENCONTRADO', 'Ese comprobante ya fue revisado');
      let res = 'RECHAZADO';
      if (p_aceptar) {
        res = rpcs.registrar_pago_pedido({ p_pedido_id: c.pedido_id, p_monto, p_medio: p_medio || 'transferencia' });
        if (res?.error) return res;
      }
      c.estado = p_aceptar ? 'aceptado' : 'rechazado';
      c.nota = p_nota;
      return res;
    },
    // Copia de 15_cancelar_pedido.sql
    cancelar_pedido_web({ p_pedido_id, p_token }) {
      const pe = db.pedidos.find((x) => x.id === p_pedido_id && x.token === p_token);
      if (!pe) return err('NO_ENCONTRADO', 'No encontramos ese pedido');
      const yaPagado = () => err('YA_PAGADO', 'Este pedido ya tiene un pago o un comprobante. Para cancelarlo escribinos por WhatsApp.');
      const fw = db.fijos.find((x) => x.pedido_id === pe.id);
      if (fw) {
        if (db.comprobantes.some((c) => c.pedido_id === pe.id) || fw.estado === 'activo' || pagadoFijo(fw.id, fw.periodo_inicial) > 0) return yaPagado();
        if (fw.estado === 'solicitud') {
          fw.estado = 'cancelado'; fw.expira_en = null;
          for (const [k, o] of db.ocupaciones) if (o.fijo_id === fw.id) db.ocupaciones.delete(k);
        }
        return { pedido: pe.id, canceladas: 1 };
      }
      const rs = db.reservas.filter((r) => r.pedido_id === pe.id);
      if (rs.some((r) => r.estado === 'confirmada' || pagado(r.id) > 0) || db.comprobantes.some((c) => c.pedido_id === pe.id)) {
        return err('YA_PAGADO', 'Este pedido ya tiene un pago o un comprobante. Para cancelarlo escribinos por WhatsApp.');
      }
      rs.filter((r) => r.estado === 'pendiente').forEach((r) => {
        r.estado = 'cancelada'; r.cancelada_en = ahoraISO(); r.motivo_cancelacion = 'La canceló la persona desde la web';
        for (const [k, o] of db.ocupaciones) if (o.reserva_id === r.id) db.ocupaciones.delete(k);
      });
      return { pedido: pe.id, canceladas: rs.filter((r) => r.estado === 'cancelada').length };
    },
    estado_pago_pedido({ p_pedido_id, p_token }) {
      const pe = db.pedidos.find((x) => x.id === p_pedido_id && x.token === p_token);
      const fw = pe && db.fijos.find((x) => x.pedido_id === pe.id);
      if (fw) {
        const est = estadoFijoWeb(fw);
        const cons = db.consultorios.find((c) => c.id === fw.consultorio_id).nombre;
        return { id: pe.id, tipo: 'fijo', estado: est, total: fw.pago_inicial, pagado: pagadoFijo(fw.id, fw.periodo_inicial), sena: fw.pago_inicial,
          expira_en: fw.estado === 'solicitud' ? fw.expira_en : null,
          fijo: { dia: fw.dia_semana, horas: fw.horas, desde: fw.desde, precio_semanal: fw.precio_semanal, consultorio: cons },
          reservas: fechasPrimerMes(fw).map((d) => ({ id: null, fecha: d, horas: fw.horas, estado: est, total: fw.precio_semanal, consultorio: cons })) };
      }
      const rs = pe ? db.reservas.filter((r) => r.pedido_id === pe.id).sort((a, b) => (a.fecha < b.fecha ? -1 : 1)) : [];
      if (!rs.length) return err('NO_ENCONTRADO', 'No encontramos ese pedido');
      const estado = rs.every((r) => r.estado === 'confirmada') ? 'confirmada' : rs.some((r) => r.estado === 'pendiente') ? 'pendiente'
        : rs.some((r) => r.estado === 'confirmada') ? 'parcial' : 'vencida';
      return {
        id: pe.id, tipo: 'suelta', estado, total: rs.reduce((s, r) => s + r.precio_total, 0), pagado: rs.reduce((s, r) => s + pagado(r.id), 0),
        sena: rs.reduce((s, r) => s + sena(r.precio_total), 0), expira_en: rs.map((r) => r.expira_en).filter(Boolean).sort()[0] || null,
        reservas: rs.map((r) => ({ id: r.id, fecha: r.fecha, horas: r.horas, estado: r.estado, total: r.precio_total,
          consultorio: db.consultorios.find((c) => c.id === r.consultorio_id).nombre })),
      };
    },
    crear_solicitud_fijo({ p_nombre, p_whatsapp, p_profesion, p_email, p_dia, p_horas, p_desde }) {
      const invalido = contactoInvalido(p_profesion, p_email);
      if (invalido) return invalido;
      const disp = rpcs.disponibilidad_fijo({ p_dia, p_desde });
      const cons = db.consultorios.find((c) => c.nombre !== 'Salón' && p_horas.every((h) => disp.some((d) => d.hora === h && d.consultorio_id === c.id)))?.id;
      if (!cons) return err('SIN_LUGAR', 'No hay un consultorio libre en ese horario todas las semanas');
      const prof = rpcs.obtenerProfesional(p_nombre, p_whatsapp, p_profesion, 'Web', p_email);
      const semanal = p_horas.reduce((s, h) => s + precioHora('fijo', h, p_desde), 0);
      const f = { id: nuevoId(), profesional_id: prof, consultorio_id: cons, dia_semana: p_dia, horas: p_horas, precio_semanal: semanal,
        estado: 'solicitud', desde: p_desde, hasta: null, expira_en: ahoraISO(60 * cfg('retencion_fijo_horas')), origen: 'web' };
      db.fijos.push(f); ocuparFijo(f);
      return { id: f.id, consultorio: db.consultorios.find((c) => c.id === cons).nombre, precio_semanal: semanal, precio_mensual_aprox: Math.round((semanal * 4.33) / 100) * 100 };
    },
    crear_fijo_web(args) {
      const v = rpcs.crear_solicitud_fijo(args);
      if (v?.error) return v;
      const f = db.fijos.find((x) => x.id === v.id);
      const pedido = { id: nuevoId(), token: crypto.randomUUID(), profesional_id: f.profesional_id, creado_en: ahoraISO() };
      db.pedidos.push(pedido);
      let fechas = fechasPrimerMes(f);
      if (!fechas.length) fechas = [f.desde];
      Object.assign(f, { pedido_id: pedido.id, pago_inicial: f.precio_semanal * fechas.length, periodo_inicial: f.desde.slice(0, 7),
        expira_en: ahoraISO(cfg('retencion_suelta_minutos')) });
      return { ...v, pedido: pedido.id, token: pedido.token, total: f.pago_inicial, sena: f.pago_inicial, expira_en: f.expira_en,
        periodo: f.periodo_inicial, reservas: fechas.map((d) => ({ fecha: d, horas: f.horas, consultorio: v.consultorio })) };
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
          detalle: r?.comentario || fj?.comentario || null, monto_total: r?.precio_total ?? fj?.precio_semanal ?? null, monto_pagado: r ? pagado(r.id) : null,
          expira_en: r?.expira_en || fj?.expira_en || null, tipo_excel: r?.tipo_excel || null,
        });
      }
      for (const e of db.fijo_excepciones) {
        const fj = db.fijos.find((x) => x.id === e.fijo_id);
        if (e.fecha < p_desde || e.fecha > p_hasta || fj.estado !== 'activo') continue;
        const p = db.profesionales.find((x) => x.id === fj.profesional_id);
        for (const h of fj.horas) if (!db.ocupaciones.has(key(fj.consultorio_id, e.fecha, h))) out.push({
          fecha: e.fecha, hora: h, consultorio_id: fj.consultorio_id, tipo: 'liberado', estado: 'libre', nombre: p.nombre,
          whatsapp: p.whatsapp, profesional_id: p.id, reserva_id: null, fijo_id: fj.id, bloqueo_id: null, pagado: null, detalle: e.motivo,
          monto_total: null, monto_pagado: null, expira_en: null, tipo_excel: null });
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
      r.origen = 'panel'; r.creado_por = sesion?.user.id || null; r.creado_en = ahoraISO();
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
    // ---- 12_tablero.sql ----
    tablero({ p_desde, p_hasta }) {
      const R = new Map(db.reservas.map((r) => [r.id, r]));
      const F = new Map(db.fijos.map((f) => [f.id, f]));
      const P = new Map(db.profesionales.map((p) => [p.id, p]));
      const oc = [];
      const bq = [];
      for (const [k, o] of db.ocupaciones) {
        const [c, f, h] = k.split('|');
        if (f < p_desde || f > p_hasta) continue;
        if (o.bloqueo_id) { bq.push({ fecha: f, hora: Number(h), cons: Number(c) }); continue; }
        const r = o.reserva_id && R.get(o.reserva_id);
        const fj = o.fijo_id && F.get(o.fijo_id);
        if (r && !['pendiente', 'confirmada'].includes(r.estado)) continue;
        if (fj && fj.estado !== 'activo') continue;
        oc.push({ fecha: f, hora: Number(h), cons: Number(c), prof: (r || fj)?.profesional_id, tipo: fj || r?.tipo_excel === 'fijo' ? 'fijo' : 'suelta' });
      }
      const contar = (fn) => { const m = new Map(); oc.forEach((x) => { const k = fn(x); m.set(k, (m.get(k) || 0) + 1); }); return m; };
      const lunes = (f) => sumarDias(f, 1 - diaSemana(f));
      const porProf = new Map();
      oc.filter((x) => x.prof).forEach((x) => { const v = porProf.get(x.prof) || { h: 0, hf: 0 }; v.h++; if (x.tipo === 'fijo') v.hf++; porProf.set(x.prof, v); });
      const pg = db.pagos.filter((p) => !p.anulado && p.pagado_en >= p_desde && p.pagado_en <= p_hasta)
        .map((p) => ({ ...p, recibio: p.recibio || (p.medio === 'mercadopago' ? 'Mercado Pago' : 'Sin indicar') }));
      const sumaPor = (campo, k) => [...pg.reduce((m, p) => m.set(p[campo], (m.get(p[campo]) || 0) + p.monto), new Map())]
        .map(([v, monto]) => ({ [k]: v, monto })).sort((a, b) => b.monto - a.monto);
      return {
        horas: oc.length,
        valor: oc.reduce((s, x) => s + precioHora(x.tipo === 'fijo' ? 'fijo' : 'suelta', x.hora, x.fecha), 0),
        bloq_por_consultorio: [...bq.reduce((m, x) => m.set(x.cons, (m.get(x.cons) || 0) + 1), new Map())].map(([consultorio_id, horas]) => ({ consultorio_id, horas })),
        bloq_por_fecha: [...bq.reduce((m, x) => m.set(x.fecha, (m.get(x.fecha) || 0) + 1), new Map())].map(([fecha, horas]) => ({ fecha, horas })),
        bloq_calor: [...bq.reduce((m, x) => { const k = diaSemana(x.fecha) + '|' + x.hora; return m.set(k, (m.get(k) || 0) + 1); }, new Map())]
          .map(([k, horas]) => ({ dia: Number(k.split('|')[0]), hora: Number(k.split('|')[1]), horas })),
        n_profesionales: new Set(oc.filter((x) => x.prof).map((x) => x.prof)).size,
        por_fecha: [...contar((x) => x.fecha)].map(([fecha, horas]) => ({ fecha, horas })).sort((a, b) => (a.fecha < b.fecha ? -1 : 1)),
        por_semana: [...contar((x) => lunes(x.fecha))].map(([l, horas]) => ({ lunes: l, horas })).sort((a, b) => (a.lunes < b.lunes ? -1 : 1)),
        por_dia: [...contar((x) => diaSemana(x.fecha))].map(([dia, horas]) => ({ dia, horas })).sort((a, b) => a.dia - b.dia),
        calor: [...contar((x) => diaSemana(x.fecha) + '|' + x.hora)].map(([k, horas]) => ({ dia: Number(k.split('|')[0]), hora: Number(k.split('|')[1]), horas })),
        por_consultorio: [...contar((x) => x.cons)].map(([consultorio_id, horas]) => ({ consultorio_id, horas, horas_fijo: oc.filter((x) => x.cons === consultorio_id && x.tipo === 'fijo').length }))
          .sort((a, b) => a.consultorio_id - b.consultorio_id),
        por_tipo: Object.fromEntries(contar((x) => x.tipo)),
        ranking: [...porProf].map(([id, v]) => ({ profesional_id: id, nombre: P.get(id)?.nombre, horas: v.h, horas_fijo: v.hf }))
          .sort((a, b) => b.horas - a.horas || (a.nombre < b.nombre ? -1 : 1)).slice(0, 20),
        cobrado: pg.reduce((s, p) => s + p.monto, 0),
        cobros_por_persona: sumaPor('recibio', 'recibio'),
        cobros_por_medio: sumaPor('medio', 'medio'),
      };
    },
    profesionales_accion() {
      const R = new Map(db.reservas.map((r) => [r.id, r]));
      const F = new Map(db.fijos.map((f) => [f.id, f]));
      const P = new Map(db.profesionales.map((p) => [p.id, p]));
      const desde = sumarDias(hoy, -111);
      const oc = [];
      for (const [k, o] of db.ocupaciones) {
        const [, f, h] = k.split('|');
        if (f < desde || o.bloqueo_id) continue;
        const r = o.reserva_id && R.get(o.reserva_id);
        const fj = o.fijo_id && F.get(o.fijo_id);
        if (r && !['pendiente', 'confirmada'].includes(r.estado)) continue;
        if (fj && fj.estado !== 'activo') continue;
        const prof = (r || fj)?.profesional_id;
        if (prof) oc.push({ fecha: f, hora: Number(h), prof, fijo: !!fj || r?.tipo_excel === 'fijo' });
      }
      const u = new Map();
      oc.filter((x) => x.fecha > sumarDias(hoy, -30) && x.fecha <= hoy).forEach((x) => {
        const v = u.get(x.prof) || { h: 0, hf: 0, vm: 0 };
        v.h++; if (x.fijo) v.hf++; else if (x.hora < cfg('hora_fin_manana')) v.vm += precioHora('suelta', x.hora, x.fecha);
        u.set(x.prof, v);
      });
      const conFijo = new Set(db.fijos.filter((f) => ['activo', 'solicitud'].includes(f.estado)).map((f) => f.profesional_id));
      const veces = new Map();
      oc.filter((x) => !x.fijo && x.fecha > sumarDias(hoy, -56) && x.fecha <= hoy).forEach((x) => {
        const k = x.prof + '|' + diaSemana(x.fecha); const s = veces.get(k) || new Set(); s.add(x.fecha); veces.set(k, s);
      });
      const mejor = new Map();
      for (const [k, s] of veces) {
        const [prof, dia] = k.split('|').map(Number);
        if (s.size >= 3 && !conFijo.has(prof) && (!mejor.has(prof) || mejor.get(prof).veces < s.size)) mejor.set(prof, { dia, veces: s.size });
      }
      const futuro = new Set(oc.filter((x) => x.fecha > hoy).map((x) => x.prof));
      const hist = new Map();
      oc.filter((x) => x.fecha <= hoy).forEach((x) => { const v = hist.get(x.prof) || { h: 0, ultima: '' }; v.h++; if (x.fecha > v.ultima) v.ultima = x.fecha; hist.set(x.prof, v); });
      const p = (id) => P.get(id) || {};
      return {
        ult30: [...u].map(([id, v]) => ({ profesional_id: id, nombre: p(id).nombre, horas: v.h, horas_fijo: v.hf, valor_suelta_manana: v.vm }))
          .sort((a, b) => b.horas - a.horas || (a.nombre < b.nombre ? -1 : 1)),
        candidatos_fijo: [...mejor].map(([id, v]) => ({ profesional_id: id, nombre: p(id).nombre, whatsapp: p(id).whatsapp, ...v }))
          .sort((a, b) => b.veces - a.veces || (a.nombre < b.nombre ? -1 : 1)),
        inactivos: [...hist].filter(([id, v]) => v.ultima <= sumarDias(hoy, -28) && v.h >= 8 && !futuro.has(id))
          .map(([id, v]) => ({ profesional_id: id, nombre: p(id).nombre, whatsapp: p(id).whatsapp, ultima: v.ultima, horas: v.h }))
          .sort((a, b) => b.horas - a.horas || (a.nombre < b.nombre ? -1 : 1)).slice(0, 25),
      };
    },
    // Copia de 17_alertas_pago.sql
    alertas_pago() {
      const dias = Number(cfg('dias_antes_saldo')) || 1;
      const out = [];
      const prof = (id) => db.profesionales.find((x) => x.id === id) || {};
      const cons = (id) => db.consultorios.find((c) => c.id === id)?.nombre;
      const grav = (limite) => (limite < hoy ? 'vencida' : limite === hoy ? 'hoy' : 'pendiente');
      for (const r of db.reservas) {
        if (r.origen === 'excel' || r.fecha < sumarDias(hoy, -30)) continue;
        const limite = sumarDias(r.fecha, -dias);
        const p = prof(r.profesional_id);
        const base = { fecha_turno: r.fecha, horas: r.horas, consultorio: cons(r.consultorio_id), reserva_id: r.id, pedido_id: r.pedido_id, nombre: p.nombre, whatsapp: p.whatsapp };
        if (r.estado === 'pendiente') {
          const vencidaSena = r.expira_en && new Date(r.expira_en) < Date.now();
          out.push({ ...base, tipo: 'sena', texto: 'Falta la seña', gravedad: vencidaSena ? 'vencida' : grav(limite),
            fecha_limite: r.expira_en ? r.expira_en.slice(0, 10) : limite, falta: sena(r.precio_total) - pagado(r.id), total: r.precio_total - pagado(r.id) });
        } else if (r.estado === 'confirmada' && limite <= hoy && r.precio_total > pagado(r.id)) {
          out.push({ ...base, tipo: 'saldo', texto: 'Falta el saldo', gravedad: limite < hoy ? 'vencida' : 'hoy', fecha_limite: limite,
            falta: r.precio_total - pagado(r.id), total: r.precio_total - pagado(r.id) });
        }
      }
      const pagadoF = (fid, per) => db.pagos.filter((x) => x.fijo_id === fid && x.periodo === per && !x.anulado).reduce((s, x) => s + x.monto, 0);
      for (const f of db.fijos) {
        const p = prof(f.profesional_id);
        const base = { horas: f.horas, consultorio: cons(f.consultorio_id), dia_semana: f.dia_semana, fijo_id: f.id, pedido_id: f.pedido_id, nombre: p.nombre, whatsapp: p.whatsapp };
        if (f.estado === 'solicitud') {
          const total = f.pago_inicial || f.precio_semanal;
          out.push({ ...base, tipo: 'fijo_inicial', texto: 'Falta pagar el primer mes del fijo', gravedad: grav(sumarDias(f.desde, -1)),
            fecha_turno: f.desde, fecha_limite: sumarDias(f.desde, -1), falta: total - pagadoF(f.id, f.periodo_inicial || f.desde.slice(0, 7)), total });
        }
        if (f.estado !== 'activo') continue;
        const [a, m] = hoy.split('-').map(Number);
        for (const ini of [new Date(Date.UTC(a, m - 1, 1)), new Date(Date.UTC(a, m, 1))].map((d) => d.toISOString().slice(0, 10))) {
          const periodo = ini.slice(0, 7);
          const fechas = [];
          for (let d = ini; d.slice(0, 7) === periodo; d = sumarDias(d, 1)) {
            if (d < f.desde || (f.hasta && d > f.hasta) || diaSemana(d) !== f.dia_semana) continue;
            if (db.fijo_excepciones.some((e) => e.fijo_id === f.id && e.fecha === d)) continue;
            fechas.push(d);
          }
          if (!fechas.length) continue;
          const monto = f.precio_semanal * fechas.length;
          const limite = sumarDias(fechas[0], -1);
          if (monto > pagadoF(f.id, periodo) && limite <= hoy) {
            out.push({ ...base, tipo: 'fijo_mes', texto: `Falta pagar el mes ${periodo}`, gravedad: limite < hoy ? 'vencida' : 'hoy',
              fecha_turno: fechas[0], fecha_limite: limite, falta: monto - pagadoF(f.id, periodo), total: monto, periodo });
          }
        }
      }
      const orden = { vencida: 0, hoy: 1, pendiente: 2 };
      return out.sort((x, y) => orden[x.gravedad] - orden[y.gravedad] || (x.fecha_turno < y.fecha_turno ? -1 : x.fecha_turno > y.fecha_turno ? 1 : 0));
    },
    pendientes_cobro() {
      const mes = hoy.slice(0, 7);
      const ini = mes + '-01';
      const fin = sumarDias(sumarDias(ini, 32).slice(0, 7) + '-01', -1);
      const items = [];
      for (const r of db.reservas) {
        if (!['pendiente', 'confirmada'].includes(r.estado) || r.origen === 'excel' || r.fecha > hoy) continue;
        const falta = r.precio_total - pagado(r.id);
        const p = db.profesionales.find((x) => x.id === r.profesional_id);
        if (falta > 0) items.push({ tipo: 'reserva', id: r.id, nombre: p?.nombre, falta, detalle: { fecha: r.fecha, horas: r.horas } });
      }
      for (const f of db.fijos.filter((x) => x.estado === 'activo')) {
        let veces = 0;
        for (let d = f.desde > ini ? f.desde : ini; d <= fin && (!f.hasta || d <= f.hasta); d = sumarDias(d, 1)) {
          if (diaSemana(d) === f.dia_semana && !db.fijo_excepciones.some((e) => e.fijo_id === f.id && e.fecha === d)) veces++;
        }
        const pagadoMes = db.pagos.filter((p) => p.fijo_id === f.id && p.periodo === mes && !p.anulado).reduce((s, p) => s + p.monto, 0);
        const falta = f.precio_semanal * veces - pagadoMes;
        const p = db.profesionales.find((x) => x.id === f.profesional_id);
        if (falta > 0) items.push({ tipo: 'fijo', id: f.id, nombre: p?.nombre, falta, detalle: { dia_semana: f.dia_semana, horas: f.horas } });
      }
      items.sort((a, b) => b.falta - a.falta);
      return { mes, total: items.reduce((s, x) => s + x.falta, 0), items };
    },
    // ---- 11_comentarios.sql ----
    guardar_comentario({ p_texto, p_reserva_id, p_fijo_id }) {
      const x = p_reserva_id ? db.reservas.find((r) => r.id === p_reserva_id) : p_fijo_id ? db.fijos.find((f) => f.id === p_fijo_id) : null;
      if (!x) return err('NO_ENCONTRADO', 'No se encontró');
      x.comentario = String(p_texto || '').trim().slice(0, 1000) || null;
    },
    // ---- 10_quien_cobro.sql ----
    marcar_quien_recibio({ p_recibio, p_pago_id, p_reserva_id }) {
      const lista = String(db.config.find((c) => c.clave === 'quienes_cobran')?.valor || '').split(',').map((x) => x.trim()).filter(Boolean);
      const nombre = lista.find((x) => x.toLowerCase() === String(p_recibio || '').trim().toLowerCase());
      if (!nombre) return err('COBRADOR_INVALIDO', 'Elegí a quién le pagaron');
      const ps = db.pagos.filter((p) => !p.anulado && !p.recibio && (p_pago_id ? p.id === p_pago_id : p.reserva_id === p_reserva_id));
      ps.forEach((p) => { p.recibio = nombre; });
      return ps.length;
    },
    // ---- 09_semana.sql ----
    agregar_nota({ p_semana, p_texto }) {
      if (!String(p_texto || '').trim()) return err('NOTA_VACIA', 'Escribí la nota');
      const n = { id: nuevoId(), semana: sumarDias(p_semana, 1 - diaSemana(p_semana)), texto: String(p_texto).trim().slice(0, 1000),
        autor: sesion?.user.id, autor_nombre: db.equipo.find((e) => e.user_id === sesion?.user.id)?.nombre || null, creado_en: ahoraISO() };
      db.notas_semana.push(n); return n.id;
    },
    borrar_nota({ p_id }) { db.notas_semana = db.notas_semana.filter((n) => n.id !== p_id); },
    deshacer_carga({ p_reserva_id }) {
      const r = db.reservas.find((x) => x.id === p_reserva_id);
      if (!r || r.origen !== 'panel' || r.creado_por !== sesion?.user.id || Date.now() - new Date(r.creado_en) > 15 * 60000 || !['pendiente', 'confirmada'].includes(r.estado)) {
        return err('NO_SE_PUEDE_DESHACER', 'Solo se puede deshacer lo que cargaste vos en los últimos 15 minutos. Abrí la reserva y usá "Cancelar reserva".');
      }
      db.pagos = db.pagos.filter((p) => p.reserva_id !== r.id);
      db.reservas = db.reservas.filter((x) => x.id !== r.id);
      for (const [k, o] of db.ocupaciones) if (o.reserva_id === r.id) db.ocupaciones.delete(k);
    },
    borrar_bloqueo({ p_bloqueo_id }) {
      for (const [k, o] of db.ocupaciones) if (o.bloqueo_id === p_bloqueo_id) db.ocupaciones.delete(k);
      db.bloqueos = db.bloqueos.filter((b) => b.id !== p_bloqueo_id);
    },
  };

  // ---- asistente de WhatsApp (20_asistente.sql) ----
  const soloEquipo = () => { if (!rpcs.es_equipo()) throw new Error('NO_AUTORIZADO'); };
  const chatDe = (id) => db.asistente_chats.find((c) => c.id === id);
  Object.assign(rpcs, {
    asistente_panel_badge: () => (rpcs.es_equipo() ? db.asistente_chats.filter((c) => c.atender && !c.simulado).length
      + db.asistente_propuestas.filter((p) => p.estado === 'pendiente').length + db.asistente_solicitudes.filter((x) => x.estado === 'pendiente').length : 0),
    asistente_panel_visitas() { soloEquipo(); return db.asistente_visitas.filter((v) => v.estado === 'confirmada').sort((a, b) => (a.fecha + a.hora < b.fecha + b.hora ? -1 : 1)); },
    asistente_panel_cancelar_visita({ p_id }) { soloEquipo(); const v = db.asistente_visitas.find((x) => x.id === p_id); if (v) v.estado = 'cancelada'; },
    asistente_panel_solicitudes() {
      soloEquipo();
      return db.asistente_solicitudes.filter((x) => x.estado === 'pendiente').map((x) => {
        const c = chatDe(x.chat_id);
        return { ...x, chat: c?.nombre, whatsapp: c?.whatsapp, identificado: !!c?.profesional_id };
      });
    },
    asistente_panel_chats() {
      soloEquipo();
      return db.asistente_chats.map((c) => {
        const ult = db.asistente_mensajes.filter((m) => m.chat_id === c.id && m.rol !== 'nota').at(-1);
        return { ...c, ultimo: ult?.texto?.slice(0, 120), ultimo_rol: ult?.rol, asignado: db.equipo.find((e) => e.user_id === c.asignado_a)?.nombre || null };
      }).sort((a, b) => (b.atender - a.atender) || (b.prioridad - a.prioridad) || (a.ultimo_mensaje_en < b.ultimo_mensaje_en ? 1 : -1));
    },
    asistente_panel_mensajes({ p_chat_id }) {
      soloEquipo();
      const c = chatDe(p_chat_id);
      return { mensajes: db.asistente_mensajes.filter((m) => m.chat_id === p_chat_id),
        memoria: db.asistente_memoria.filter((m) => m.whatsapp === c?.whatsapp), pedidos: c?.reservo ? [db.pedidos[0]?.id || 1] : [] };
    },
    asistente_panel_vincular({ p_chat_id, p_profesional_id }) {
      soloEquipo(); const p = db.profesionales.find((x) => x.id === p_profesional_id); if (!p) return err('NO_ENCONTRADO', 'Esa persona no existe');
      const c = chatDe(p_chat_id); c.profesional_id = p.id; c.nombre = p.nombre; return { nombre: p.nombre };
    },
    asistente_panel_asignar({ p_chat_id, p_user_id }) { soloEquipo(); chatDe(p_chat_id).asignado_a = p_user_id || null; },
    asistente_panel_etapa({ p_chat_id, p_etapa, p_prioridad }) {
      soloEquipo();
      if (!['nuevo', 'consulta', 'interesado', 'perdido'].includes(p_etapa)) return err('ETAPA', 'Reservó y pagó se marcan solos cuando hay un pedido');
      const c = chatDe(p_chat_id);
      if (!['reservo', 'pago'].includes(c.etapa)) c.etapa = p_etapa;
      if (typeof p_prioridad === 'boolean') c.prioridad = p_prioridad;
    },
    asistente_panel_atendido({ p_chat_id }) { soloEquipo(); Object.assign(chatDe(p_chat_id), { atender: false, urgente: false, motivo_atender: null }); },
    asistente_panel_pausa({ p_chat_id, p_minutos }) { soloEquipo(); chatDe(p_chat_id).pausa_hasta = p_minutos > 0 ? ahoraISO(p_minutos) : null; },
    asistente_panel_borrar_memoria({ p_id }) { soloEquipo(); db.asistente_memoria = db.asistente_memoria.filter((m) => m.id !== p_id); },
    asistente_panel_propuestas() {
      soloEquipo();
      return db.asistente_propuestas.filter((p) => p.estado === 'pendiente').map((p) => ({ ...p,
        corrige: p.conocimiento_id ? db.asistente_conocimiento.find((k) => k.id === p.conocimiento_id) : null }));
    },
    asistente_panel_resolver({ p_id, p_aprobar, p_pregunta, p_respuesta, p_tema }) {
      soloEquipo();
      const p = db.asistente_propuestas.find((x) => x.id === p_id && x.estado === 'pendiente');
      if (!p) throw new Error('NO_ENCONTRADO');
      if (p_aprobar) db.asistente_conocimiento.push({ id: nuevoId(), tema: p_tema || p.tema, pregunta: p_pregunta || p.pregunta,
        respuesta: p_respuesta || p.respuesta, activo: true, origen: 'aprendido', usos: 0, creado_en: ahoraISO() });
      p.estado = p_aprobar ? 'aprobada' : 'descartada';
    },
    asistente_panel_guardar_saber({ p_id, p_tema, p_pregunta, p_respuesta, p_activo }) {
      soloEquipo();
      if (String(p_pregunta || '').trim().length < 3 || String(p_respuesta || '').trim().length < 2) return err('INCOMPLETO', 'Completá la pregunta y la respuesta');
      const v = { tema: String(p_tema || '').trim() || 'General', pregunta: p_pregunta.trim(), respuesta: p_respuesta.trim(), activo: p_activo !== false };
      if (p_id) Object.assign(db.asistente_conocimiento.find((k) => k.id === p_id), v);
      else db.asistente_conocimiento.push({ id: nuevoId(), ...v, origen: 'equipo', usos: 0, creado_en: ahoraISO() });
    },
    asistente_panel_borrar_saber({ p_id }) { soloEquipo(); db.asistente_conocimiento = db.asistente_conocimiento.filter((k) => k.id !== p_id); },
    asistente_panel_guardar_numero({ p_whatsapp, p_tipo, p_nombre, p_user_id }) {
      if (!rpcs.es_admin()) return err('NO_AUTORIZADO', 'Solo un administrador puede hacer esto');
      const n = String(p_whatsapp).replace(/\D/g, '');
      if (n.length < 10) return err('WHATSAPP_INVALIDO', 'Escribí el número con código de área, ej: 11 2345 6789');
      const tel = n.startsWith('54') ? n : '549' + n.replace(/^0/, '');
      db.asistente_numeros = db.asistente_numeros.filter((x) => x.whatsapp !== tel);
      db.asistente_numeros.push({ whatsapp: tel, tipo: p_tipo, nombre: p_nombre || null, user_id: p_tipo === 'equipo' ? p_user_id : null, creado_en: ahoraISO() });
    },
    asistente_panel_borrar_numero({ p_whatsapp }) {
      if (!rpcs.es_admin()) return err('NO_AUTORIZADO', 'Solo un administrador puede hacer esto');
      db.asistente_numeros = db.asistente_numeros.filter((x) => x.whatsapp !== p_whatsapp);
    },
    asistente_panel_resumen() {
      soloEquipo();
      return { charlas: 23, mensajes_recibidos: 88, respuestas_asistente: 71, respuestas_equipo: 6, pedidos: 6, pedidos_confirmados: 4,
        monto_reservado: 68000, para_atender: rpcs.asistente_panel_badge() - db.asistente_propuestas.filter((p) => p.estado === 'pendiente').length,
        propuestas: db.asistente_propuestas.filter((p) => p.estado === 'pendiente').length, tokens: { entrada: 412000, salida: 23000 },
        embudo: { nuevo: 2, consulta: 6, interesado: 5, reservo: 2, pago: 4, perdido: 4 }, respuesta_segundos: { asistente: 9, equipo: 1260 },
        oportunidades: db.asistente_chats.filter((c) => c.etapa === 'interesado').map((c) => ({ id: c.id, nombre: c.nombre, etapa: c.etapa,
          interes: c.interes, valor_estimado: c.valor_estimado, nota: c.nota_crm, ultimo_mensaje_en: c.ultimo_mensaje_en })) };
    },
  });
  // Respuesta de ejemplo para el simulador del panel (la de verdad la da Claude en el servidor)
  const respuestaDemo = (texto) => {
    const t = texto.toLowerCase();
    const k = db.asistente_conocimiento.find((x) => x.activo && x.pregunta.toLowerCase().split(/\W+/).filter((w) => w.length > 4).some((w) => t.includes(w)));
    if (/c[oó]mo (es|son)|foto|ver el|conocer/.test(t)) return { texto: 'Te mandé fotos del espacio ☝️ ¿Querés ver algún consultorio en particular?',
      herramientas: [{ nombre: 'mandar_fotos', ok: true }], fotos: ['espacio-a', 'espacio-b', 'espacio-c'].map((f) => ({ url: `img/consultorios/${f}.jpg` })) };
    if (/cu[aá]nto|precio|sale|valor/.test(t)) return { texto: 'Por horas: mañana (8 a 13 hs) *$8.500* y tarde (13 a 21 hs) *$9.000*. Con horario fijo semanal es más barato. ¿Qué día te sirve?', herramientas: [{ nombre: 'info_general', ok: true }] };
    if (/lugar|libre|disponib|turno|reserv/.test(t)) return { texto: 'Me fijo… ✨ Ese día hay lugar a la mañana en los Consultorios 1, 2 y 4, y a la tarde desde las 17 hs en el 3. ¿Qué horario preferís?', herramientas: [{ nombre: 'ver_horarios_libres', ok: true }] };
    if (k) return { texto: k.respuesta, herramientas: [{ nombre: 'buscar_saber', ok: true }] };
    return { texto: '¡Hola! Soy Sofía, el asistente de Psico Studios 😊 ¿En qué te ayudo? Puedo contarte precios, ver disponibilidad y reservarte un consultorio.', herramientas: [] };
  };

  // ---- login de mentira (cualquier usuario/contraseña entra) ----
  let sesion = null;
  // Links de invitación o de "olvidé mi contraseña" (en el simulador: panel.html#type=invite&email=...)
  try {
    const h = new URLSearchParams(location.hash.slice(1));
    if (['invite', 'recovery'].includes(h.get('type'))) {
      const mail = (h.get('email') || 'invitado@ejemplo.com').toLowerCase();
      let e = db.equipo.find((x) => x.email === mail);
      if (!e) { e = { user_id: 'demo-inv-' + nuevoId(), nombre: mail.split('@')[0], email: mail, rol: 'equipo', activo: true, creado_en: ahoraISO() }; db.equipo.push(e); }
      sesion = { user: { id: e.user_id, email: mail } };
    }
  } catch { /* nada */ }
  const oyentes = [];
  const auth = {
    async signInWithPassword({ email }) {
      const mail = String(email).toLowerCase();
      const local = mail.split('@')[0] || 'equipo';
      const existente = db.equipo.find((e) => e.email === mail);
      sesion = { user: { id: existente?.user_id || 'demo-' + local, email: mail } };
      let e = db.equipo.find((x) => x.user_id === sesion.user.id);
      if (!e) {
        // En el simulador cualquiera entra; la primera persona que entra es administradora
        e = { user_id: sesion.user.id, nombre: local[0].toUpperCase() + local.slice(1), email: mail,
          rol: db.equipo.some((x) => x.rol === 'admin') ? 'equipo' : 'admin', activo: true, creado_en: ahoraISO() };
        db.equipo.push(e);
      }
      e.ultimo_ingreso = ahoraISO();
      guardar();
      oyentes.forEach((fn) => fn('SIGNED_IN', sesion));
      return { data: { session: sesion }, error: null };
    },
    async getSession() { return { data: { session: sesion }, error: null }; },
    async resetPasswordForEmail() { await new Promise((r) => setTimeout(r, 200)); return { data: {}, error: null }; },
    async updateUser({ password }) {
      if (!sesion) return { data: null, error: { message: 'Auth session missing!' } };
      if (String(password || '').length < 6) return { data: null, error: { message: 'Password should be at least 6 characters' } };
      return { data: { user: sesion.user }, error: null };
    },
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
        liberarVencidas();
        const res = fn(params);
        guardar();
        return res && res.error !== undefined && res.data === null ? res : { data: res ?? null, error: null };
      } catch (e) { return err(e.message); }
    },
    auth,
    // Mercado Pago simulado: lleva a la pantalla "simulador-pago.html"
    functions: {
      async invoke(nombre, { body }) {
        await new Promise((r) => setTimeout(r, 400));
        if (nombre === 'asistente-whatsapp') {
          if (!rpcs.es_equipo()) return { data: null, error: { message: 'NO_AUTORIZADO', context: { json: async () => ({ message: 'NO_AUTORIZADO', hint: 'Tu sesión venció.' }) } } };
          if (body.accion === 'simular') {
            await new Promise((r) => setTimeout(r, 700));
            return { data: body.reiniciar ? { ok: true } : { ...respuestaDemo(String(body.texto || '')), uso: {} }, error: null };
          }
          if (body.accion === 'recordar_pago') {
            await new Promise((r) => setTimeout(r, 300));
            return { data: { ok: true, envio: 'enviado', como: 'texto' }, error: null };
          }
          if (body.accion === 'resolver_solicitud') {
            const x = db.asistente_solicitudes.find((y) => y.id === Number(body.id) && y.estado === 'pendiente');
            if (x?.tipo === 'visita' && body.aprobar) {
              if (!body.datos?.fecha || !body.datos?.hora) return { data: null, error: { message: 'FALTA_FECHA', context: { json: async () => ({ message: 'FALTA_FECHA', hint: 'Elegí el día y la hora de la visita' }) } } };
              db.asistente_visitas.push({ id: nuevoId(), chat_id: x.chat_id, nombre: x.nombre_dicho, whatsapp: chatDe(x.chat_id)?.whatsapp, fecha: body.datos.fecha, hora: body.datos.hora, estado: 'confirmada' });
              x.estado = 'aprobada';
              const [, mm, dd] = body.datos.fecha.split('-');
              const texto = `¡Hola ${x.nombre_dicho}! Te esperamos el ${Number(dd)}/${Number(mm)} a las ${body.datos.hora} para que conozcas el espacio 😊${body.nota ? ' ' + body.nota : ''}`;
              db.asistente_mensajes.push({ id: nuevoId(), chat_id: x.chat_id, rol: 'asistente', texto, tipo: 'texto', envio: 'enviado', creado_en: ahoraISO() });
              guardar(); return { data: { ok: true, envio: 'enviado', texto }, error: null };
            }
            if (!x) return { data: null, error: { message: 'NO_ENCONTRADO', context: { json: async () => ({ message: 'NO_ENCONTRADO', hint: 'Ya la resolvió otra persona' }) } } };
            x.estado = body.aprobar ? 'aprobada' : 'rechazada';
            const c = chatDe(x.chat_id);
            if (body.aprobar && body.profesional_id) { const p = db.profesionales.find((y) => y.id === body.profesional_id); if (p) { c.profesional_id = p.id; c.nombre = p.nombre; } }
            const texto = body.aprobar ? '¡Listo! El equipo confirmó tu cambio: te esperamos el jueves de 15 a 17 hs.' : `El equipo revisó tu pedido y esta vez no se pudo hacer${body.nota ? ': ' + body.nota : '.'}`;
            db.asistente_mensajes.push({ id: nuevoId(), chat_id: c.id, rol: 'asistente', texto, tipo: 'texto', envio: 'enviado', creado_en: ahoraISO() });
            guardar();
            return { data: { ok: true, envio: 'enviado', texto }, error: null };
          }
          if (body.accion === 'responder') {
            const c = chatDe(Number(body.chat_id));
            db.asistente_mensajes.push({ id: nuevoId(), chat_id: c.id, rol: 'equipo', texto: String(body.texto), tipo: 'texto', envio: 'enviado',
              autor: db.equipo.find((e) => e.user_id === sesion.user.id)?.nombre, creado_en: ahoraISO() });
            Object.assign(c, { atender: false, urgente: false, pausa_hasta: ahoraISO(Number(cfg('asistente_minutos_pausa')) || 60), ultimo_mensaje_en: ahoraISO() });
            guardar();
            return { data: { ok: true, envio: 'enviado' }, error: null };
          }
        }
        if (nombre === 'equipo-admin') {
          const falla = (message, hint) => ({ data: null, error: { message, hint, context: { json: async () => ({ message, hint }) } } });
          if (!rpcs.es_admin()) return falla('NO_AUTORIZADO', 'Solo un administrador puede invitar personas.');
          const mail = String(body.email || '').trim().toLowerCase();
          if (db.equipo.some((e) => e.email === mail)) return falla('YA_EXISTE', 'Ese mail ya tiene usuario. Si no puede entrar, mandale el mail para cambiar la contraseña.');
          db.equipo.push({ user_id: 'demo-inv-' + nuevoId(), nombre: String(body.nombre).trim(), email: mail, rol: body.rol === 'admin' ? 'admin' : 'equipo',
            activo: true, creado_en: ahoraISO(), ultimo_ingreso: null });
          guardar();
          return { data: { ok: true }, error: null };
        }
        liberarVencidas();
        const pe = db.pedidos.find((x) => x.id === body.pedido_id && x.token === body.token);
        const rs = pe ? db.reservas.filter((r) => r.pedido_id === pe.id) : [];
        const fw = pe && db.fijos.find((x) => x.pedido_id === pe.id);
        const falla = (message, hint) => ({ data: null, error: { message, hint } });
        if (nombre !== 'mp-crear-pago' || (!rs.length && !fw)) return falla('NO_ENCONTRADO', 'No encontramos ese pedido');
        const vencido = 'Se venció el tiempo para pagar y los horarios se liberaron. Hacé una reserva nueva.';
        if (fw) {
          if (fw.estado === 'activo') return falla('YA_CONFIRMADA', 'Este horario fijo ya está pago y confirmado.');
          if (fw.estado !== 'solicitud') return falla('RESERVA_NO_VIGENTE', vencido);
          return { data: { url: `simulador-pago.html?pedido=${pe.id}&t=${pe.token}` }, error: null };
        }
        if (body.pagar === 'total') {
          const vig = rs.filter((r) => ['pendiente', 'confirmada'].includes(r.estado));
          if (!vig.length) return falla('RESERVA_NO_VIGENTE', vencido);
          if (vig.every((r) => pagado(r.id) >= r.precio_total)) return falla('YA_CONFIRMADA', 'Este pedido ya está pago.');
          return { data: { url: `simulador-pago.html?pedido=${pe.id}&t=${pe.token}&pagar=total` }, error: null };
        }
        if (!rs.some((r) => r.estado === 'pendiente')) {
          return rs.some((r) => r.estado === 'confirmada')
            ? { data: null, error: { message: 'YA_CONFIRMADA', hint: 'Este pedido ya tiene la seña paga.' } }
            : { data: null, error: { message: 'RESERVA_NO_VIGENTE', hint: 'Se venció el tiempo para pagar y los horarios se liberaron. Hacé una reserva nueva.' } };
        }
        return { data: { url: `simulador-pago.html?pedido=${pe.id}&t=${pe.token}` }, error: null };
      },
    },
    // Espacio de archivos simulado (en la versión real: espacio privado de Supabase)
    storage: {
      from(bucket) {
        return {
          async upload(ruta, archivo, { contentType } = {}) {
            const m = /^(\d+)\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.(jpg|png|webp|heic|heif|pdf)$/.exec(ruta);
            const pe = m && db.pedidos.find((x) => x.id === Number(m[1]) && x.token === m[2]);
            const cuantos = db.archivos.filter((a) => a.ruta.startsWith(`${m?.[1]}/`)).length;
            if (bucket !== 'comprobantes' || !pe || cuantos >= cfg('max_comprobantes_por_pedido')) {
              return { data: null, error: { message: 'new row violates row-level security policy' } };
            }
            if (archivo.size > 5 * 1024 * 1024) return { data: null, error: { message: 'The object exceeded the maximum allowed size' } };
            const dataUrl = await new Promise((ok) => { const fr = new FileReader(); fr.onload = () => ok(fr.result); fr.readAsDataURL(archivo); });
            db.archivos.push({ ruta, tipo: contentType, dataUrl });
            guardar();
            return { data: { path: ruta }, error: null };
          },
          async createSignedUrl(ruta) {
            const a = db.archivos.find((x) => x.ruta === ruta);
            return a ? { data: { signedUrl: a.dataUrl }, error: null } : { data: null, error: { message: 'Object not found' } };
          },
        };
      },
    },
    // Herramientas del simulador
    demo: {
      // Lo que pasa cuando Mercado Pago aprueba el pago de un pedido: completa la seña de cada día
      pagoAprobado(pedidoId, token, pagar = 'sena') {
        const pe = db.pedidos.find((x) => x.id === pedidoId && x.token === token);
        if (!pe) return 'NO_ENCONTRADO';
        const mpId = String(Date.now());
        const fw = db.fijos.find((x) => x.pedido_id === pe.id);
        if (fw) {
          const res = aplicarPagoFijo(fw, Math.max(0, fw.pago_inicial - pagadoFijo(fw.id, fw.periodo_inicial)), 'mercadopago', mpId);
          guardar();
          return res;
        }
        const tope = (r) => (pagar === 'total' ? r.precio_total : sena(r.precio_total));
        const resultados = db.reservas.filter((r) => r.pedido_id === pe.id).sort((a, b) => (a.fecha < b.fecha ? -1 : 1))
          .map((r) => { const falta = tope(r) - pagado(r.id); return falta > 0 ? registrarPagoMP(r.id, mpId, falta) : 'CONFIRMADA'; });
        guardar();
        return resultados.includes('A_REVISAR') ? 'A_REVISAR' : 'CONFIRMADA';
      },
      // Adelanta el reloj: lo que vencía en ese tiempo, vence
      adelantar(minutos) {
        const ms = minutos * 60000;
        const antes = db.reservas.filter((r) => r.estado === 'vencida').length;
        for (const r of db.reservas) if (r.estado === 'pendiente' && r.expira_en) r.expira_en = new Date(new Date(r.expira_en).getTime() - ms).toISOString();
        for (const f of db.fijos) if (f.estado === 'solicitud' && f.expira_en) f.expira_en = new Date(new Date(f.expira_en).getTime() - ms).toISOString();
        liberarVencidas();
        guardar();
        return db.reservas.filter((r) => r.estado === 'vencida').length - antes;
      },
      reiniciar() { try { localStorage.removeItem(CLAVE_GUARDADO); } catch { /* nada */ } },
    },
  };
}

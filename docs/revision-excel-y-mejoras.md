# Revisión del Excel "Psico CALENDARIO 2026" y mejoras pendientes

Análisis del Excel con el que hoy se maneja la agenda, para que el panel lo reemplace sin perder nada.
(Los ejemplos están anonimizados: este repositorio es público.)

## Cómo se usa hoy el Excel

- **Una hoja por semana** (de "ENERO 1" a "DICIEMBRE 05"): grilla de 8 a 21 hs × 6 días × 6 espacios
  (Consultorio 1 a 5 y Salón). Hay **171 hojas**, unas **100 vacías**, y otra tanda del año anterior.
- En cada casillero, **el nombre** de quien lo usa. Un turno de varias horas se marca combinando celdas.
- **Colores para el estado:** verde = hora fija · amarillo = horas flotantes (sueltas) · azul = pericias ·
  naranja = vacaciones o "lugar de un fijo que usa otro" (se ponen los dos nombres) · púrpura/rosado = cada 15 días.
- **Números y meses al lado del nombre** ("19", "oct", "14/8"): fecha de pago, de la reserva o mes pagado.
- **Notas al pie de cada semana**: altas, bajas, ausencias, cambios, pagos ("ya abonó").
- En 2026: unas **3.400 celdas ocupadas** y unos **210 nombres distintos**.

## Lo que el sistema nuevo ya resuelve

| En el Excel | En el sistema |
|---|---|
| Copiar la semana a mano en una hoja nueva | Los fijos se repiten solos 12 semanas adelante |
| Colores para saber quién pagó | Estado de cada reserva y pagos registrados (seña, saldo, mes del fijo) |
| "Hoy no viene / ausente" (es la nota más frecuente) | **Liberar esta semana** en el fijo: el horario queda libre para otro |
| "Ya abonó" en una nota | Pagos con fecha, monto y medio; Mercado Pago y comprobantes |
| Feriados | Son un día más; "Bloquear horario" si se cierra |
| Buscar quién es quién | Ficha de cada profesional con WhatsApp, mail y profesión |
| Altas y bajas en notas | Alta automática al reservar; "Dar de baja" en el fijo |

## Dolores de los FIJOS que el sistema todavía NO cubre

1. **Fijos cada 15 días** (aparece en varias semanas: "alquila cada 15 días", "c/15").
   Y **dos profesionales que se turnan el mismo horario** ("va los días que la otra no va").
   → Propuesta: fijo **quincenal** (semanas A/B), y dos quincenales pueden compartir el mismo lugar.
2. **Vacaciones** (color naranja): hoy se libera semana por semana.
   → Propuesta: **"Liberar del … al …"** de una vez.
3. **Cambio por una sola semana** ("solo por hoy usa el consultorio 3", "esta semana usa el miércoles en vez del jueves").
   → Propuesta: **"Mover esta semana"** (otro día, hora o consultorio, solo esa vez).
4. **Cambio desde una fecha** ("a partir de octubre, 1 hora los jueves 16 hs").
   → Propuesta: **"Modificar desde…"** (hoy hay que dar de baja y cargar otro fijo).
5. **Horas a recuperar** ("recupera 2 hs").
   → Propuesta: **horas a favor** por profesional, que se usan después sin pagar.
6. **Ver quién usa el lugar de un fijo** (naranja con los dos nombres).
   → Propuesta: en la agenda, "**Persona B (lugar de A)**".
7. **Horas que se agregan sobre la marcha** ("agregó 1 hora", "tenía hasta las 17 y terminó a las 18").
   → Propuesta: **"+1 hora"** en la reserva o en la semana del fijo.

## Mejoras para el PANEL (lo que se ve en el Excel y falta)

1. ✅ **Vista de la semana completa** (6 días × 6 espacios), como el Excel: pestaña **Semana** del panel, con los mismos
   colores, "Anotar" tocando un casillero (nombre que se completa solo, horas y si pagó), **Deshacer**, **Bajar en Excel**,
   **Imprimir** y **Letra grande**.
2. ✅ **Notas de la semana** (abajo de la grilla, con quién la escribió).
3. **Tipo de uso**: pericias, privado, psicotécnico… con su color.
4. **Necesidades**: con camilla, con o sin escritorio. Qué consultorio tiene camilla o escritorio.
5. **Medias horas** (8:30 a 9:30, 15 a 17:30): hoy el sistema funciona por horas enteras.
6. **"A confirmar"**: reservas cargadas por el equipo sin confirmar (hoy: pendiente sin vencimiento).
7. **Historial por profesional**: cuántas horas usó, ausencias, pagos.
8. **Pasar los fijos actuales al sistema**: se puede armar un borrador desde las últimas semanas del Excel
   para que el equipo lo revise y complete los WhatsApp.

## Cómo se reemplaza el Excel (equipo de 3 personas)

- **Cada una con su usuario** (gratis): queda registrado quién cargó cada reserva.
- **Lo que más se hace** es anotar las horas que piden por WhatsApp → la pantalla principal es la semana y
  anotar es tocar el casillero, escribir el nombre y elegir cuántas horas.
- **Transición:** 2 semanas usando los dos en paralelo (el Excel manda), 2 semanas cargando en el panel con el
  Excel de respaldo, y después el Excel solo para consultar lo viejo. "Bajar en Excel" sirve para tener una copia.
- **Fijos actuales:** se arma un borrador desde las últimas semanas del Excel para revisarlo juntos antes de cargarlo.

## Preguntas para definir

- [ ] **Medias horas:** ¿se siguen permitiendo? ¿Solo desde el panel (como excepción) o también en la web?
- [ ] **Pericias:** ¿tienen otro precio o alguna condición?
- [ ] **Horas a recuperar:** ¿cuándo se generan (feriado, cancelación del espacio, ausencia avisada)? ¿vencen?
- [ ] **Quincenal:** ¿mismo precio por hora que el fijo semanal?
- [ ] **Prioridades:** ¿qué de todo esto hace falta para dejar el Excel?

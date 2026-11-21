// Distribución real del piso 7 (Perú 89, esquina H. Irigoyen), tomada del plano de la arquitecta
// (escala 1:100). Unidades del dibujo: ~54 = 1 metro. Abajo, el balcón sobre la calle;
// a la derecha, la entrada por el palier; en el centro, la sala de espera.
export const PISO = {
  ancho: 700, alto: 640,
  // consultorios (id de la base): [x, y, ancho, fondo]
  salas: {
    1: [0, 0, 195, 175],
    2: [0, 175, 185, 230],
    3: [0, 405, 240, 210],
    4: [240, 405, 165, 210],
    5: [255, 140, 170, 145],
    6: [405, 405, 295, 210],
  },
  // ventanas: lado de la pared ('izq' | 'atras' | 'frente')
  ventanas: { 1: 'izq', 2: 'izq', 3: 'frente', 4: 'frente', 5: 'atras', 6: 'frente' },
  // espacios comunes que se pueden tocar (ver fotos)
  comunes: [
    { id: 'espera', nombre: 'Sala de espera', texto: 'Recepción', rect: [185, 285, 305, 120] },
    { id: 'entrada', nombre: 'Entrada', texto: 'Ascensor y escalera', rect: [490, 220, 205, 185] },
  ],
  // servicio (solo de referencia)
  servicio: [
    { id: 'bano', nombre: 'Baño', rect: [195, 0, 100, 115] },
    { id: 'pulmon', nombre: 'Pulmón', rect: [295, 0, 110, 135], aire: true },
    { id: 'cocina', nombre: 'Cocina', rect: [405, 0, 115, 130] },
    { id: 'deposito', nombre: 'Depósito', rect: [520, 0, 175, 130] },
  ],
  // pasillos (piso sin paredes)
  pasillos: [[185, 115, 70, 290], [425, 130, 65, 290], [185, 115, 305, 25], [490, 130, 205, 90]],
  balcon: [0, 615, 700, 25],
  // recorrido: desde la entrada, por la sala de espera, hasta la puerta de cada consultorio
  desdeEntrada: [[640, 330], [520, 345], [330, 345]],
  hastaSala: {
    1: [[220, 345], [220, 150], [150, 120]],
    2: [[215, 330], [140, 300]],
    3: [[215, 380], [215, 440], [140, 500]],
    4: [[320, 380], [320, 470]],
    5: [[340, 300], [340, 220]],
    6: [[470, 380], [500, 470]],
  },
};

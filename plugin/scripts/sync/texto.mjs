// Leer archivos del proyecto igual en cualquier computador.
// Windows guarda los finales de renglón como CRLF (\r\n) y algunos editores dejan un BOM al inicio.
// Con eso, la cabecera de las fichas (--- … ---) no coincidía y el motor leía el ítem VACÍO: sin
// título, sin riesgo y sin enlace con Altum, así que no avisaba nada y la tarea se quedaba en "new".
import { readFileSync } from 'node:fs';

export function normalizarTexto(texto) {
  return String(texto ?? '').replace(/^﻿/, '').replace(/\r\n/g, '\n');
}

export function leerTexto(file) {
  return normalizarTexto(readFileSync(file, 'utf8'));
}

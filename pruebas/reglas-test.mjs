// Pruebas de las reglas de fondo de la sincronización (plugin/scripts/sync/reglas.mjs).
// Cada caso viene de un daño real o de un hallazgo de la auditoría del 8-oct.
import { avanza, contenidoMasNuevo, esLaTareaDeLaFicha, instante, mismaFecha, mismaFechaHora } from '../plugin/scripts/sync/reglas.mjs';
import { camposDel422 } from '../plugin/scripts/sync/altum.mjs';

let ok = 0; let fallas = 0;
const check = (nombre, cond) => { if (cond) { ok += 1; console.log(`OK    ${nombre}`); } else { fallas += 1; console.log(`FALLA ${nombre}`); } };

// ---- 1. Una ficha solo escribe en SU tarea ----
const nativa = { id: 'u1', number: 12, external_ref: 'MB-1' };
check('Su propia tarea (external_ref exacto): sí', esLaTareaDeLaFicha({ id: 'MB-1' }, nativa).ok);
check('La tarea de otra ficha: no', !esLaTareaDeLaFicha({ id: 'MB-2' }, nativa).ok);
check('Tarea de reunión con una ficha normal: no (el caso de Mi Boleta)', !esLaTareaDeLaFicha({ id: 'MB-261008-n4d8' }, { id: 'acten:2249' }).ok);
check('Tarea de reunión con su ficha ACT-: sí', esLaTareaDeLaFicha({ id: 'ACT-2249' }, { id: 'acten:2249' }).ok);
check('Ficha traída ALT-n con la tarea #n sin dueño: sí', esLaTareaDeLaFicha({ id: 'ALT-77' }, { id: 'u2', number: 77, external_ref: null }).ok);
check('Ficha ALT-n con una tarea #n que ya es de otra ficha: no', !esLaTareaDeLaFicha({ id: 'ALT-77' }, { id: 'u2', number: 77, external_ref: 'CLI-9' }).ok);
check('Tarea que no está en el proyecto: no', !esLaTareaDeLaFicha({ id: 'MB-1' }, undefined).ok);

// ---- 2. El estado nunca retrocede (con el orden del flujo, no solo el tipo) ----
const flujo = [
  { key: 'new', kind: 'open', position: 0 }, { key: 'en_desarrollo', kind: 'in_progress', position: 10 },
  { key: 'en_revision', kind: 'in_progress', position: 20 }, { key: 'closed', kind: 'done', position: 30 },
  { key: 'removed', kind: 'cancelled', position: 40 },
];
check('new → en_desarrollo avanza', avanza('new', 'en_desarrollo', flujo));
check('en_revision → en_desarrollo NO (mismo tipo, más atrás)', !avanza('en_revision', 'en_desarrollo', flujo));
check('en_desarrollo → en_revision avanza', avanza('en_desarrollo', 'en_revision', flujo));
check('closed → new NO', !avanza('closed', 'new', flujo));
check('removed (cancelada) → closed NO (los finales no se cambian solos)', !avanza('removed', 'closed', flujo));
check('Descartar desde en_desarrollo → removed sí', avanza('en_desarrollo', 'removed', flujo, { descartar: true }));
check('Descartar sin estado cancelado → closed sí', avanza('en_desarrollo', 'closed', flujo.slice(0, 4), { descartar: true }));
check('Descartar algo ya cerrado: se deja', !avanza('closed', 'removed', flujo, { descartar: true }));

// ---- 3. El contenido viaja solo si la ficha es más nueva ----
check('Ficha más nueva que lo último enviado: viaja', contenidoMasNuevo({ modificado: '2026-10-08T10:00:00-05:00' }, '2026-10-08T09:00:00-05:00', null));
check('Ficha de una rama vieja (más vieja que lo enviado): no viaja', !contenidoMasNuevo({ modificado: '2026-10-07T10:00:00-05:00' }, '2026-10-08T09:00:00-05:00', null));
check('Máquina nueva, Altum editado después de la ficha: no viaja', !contenidoMasNuevo({ modificado: '2026-10-07T10:00:00-05:00' }, '', { updated_at: '2026-10-08T15:00:00' }));
check('Máquina nueva, ficha más nueva que Altum: viaja', contenidoMasNuevo({ modificado: '2026-10-08T10:00:00-05:00' }, '', { updated_at: '2026-10-08T14:00:00' }));
check('Dos commits en el mismo segundo: el segundo también viaja', contenidoMasNuevo({ modificado: '2026-10-08T10:00:00-05:00' }, '2026-10-08T15:00:00Z', null));
check('Sin git (sin fecha de la ficha): viaja, no se pierde trabajo', contenidoMasNuevo({}, '2026-10-08T09:00:00Z', null));

// ---- 4. Fechas comparadas como fechas ----
check('Mismo instante en -05:00 y en UTC: iguales', mismaFechaHora('2026-10-08T16:37:22-05:00', '2026-10-08T21:37:22Z'));
check('Altum sin "Z" se lee como UTC', mismaFechaHora('2026-10-08T21:37:22', '2026-10-08T16:37:22-05:00'));
check('Fecha sola vs fecha-hora del mismo día: iguales', mismaFecha('2026-10-12', '2026-10-12T00:00:00Z'));
check('El mismo día escrito con desfase horario (-05:00) no es un cambio', mismaFecha('2026-10-11T19:00:00-05:00', '2026-10-12T00:00:00Z'));
check('Dos días distintos sí son un cambio', !mismaFecha('2026-10-12', '2026-10-13'));
check('Dos textos ilegibles distintos no son el mismo instante', !mismaFechaHora('ayer', 'mañana'));
check('Un estado que el flujo ya no tiene no mueve la tarea (nunca retrocede)', !avanza('estado_borrado', 'new', [{ key: 'new', kind: 'open' }, { key: 'closed', kind: 'done' }]));
check('Una tarea de reunión por source (sin prefijo acten:) no se deja pisar', !esLaTareaDeLaFicha({ id: 'ALT-77' }, { id: 'uuid-1', source: 'acten', number: 77 }).ok);
check('Instantes distintos: distintos', !mismaFechaHora('2026-10-08T10:00:00Z', '2026-10-08T10:00:05Z'));
check('Texto que no es fecha no rompe', instante('no-es-fecha') === 0);

// Respuesta observada en el sandbox real de Altum el 10-oct: no menciona parent_id.
const jerarquiaReal = 'Un/a historia no puede colgar de un/a historia. Puede colgar de: épica, funcionalidad.';
check('422 real de jerarquía descarta solo el padre, conserva estado y título', JSON.stringify(camposDel422(jerarquiaReal, { parent_id: 'p1', state: 'closed', title: 'Historia' })) === '["parent_id"]');
check('422 de estado desconocido no descarta el padre por adivinación', camposDel422('El estado no existe en este proyecto', { parent_id: 'p1', state: 'closed' }).length === 0);

console.log(`\nRESULTADO: ${ok} OK · ${fallas} fallas`);
process.exit(fallas ? 1 : 0);

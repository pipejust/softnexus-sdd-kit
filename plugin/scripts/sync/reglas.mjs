// Reglas de fondo de la sincronización con Altum.
//
// Son funciones puras y valen igual en TODOS los caminos que escriben en Altum: la sincronización en
// segundo plano, "asegurar", los reintentos de la cola y el CI. Cada regla nació de un daño real:
//   1. Una ficha solo escribe en SU tarea      → se pisaron tareas de reunión y de otros proyectos.
//   2. El estado nunca retrocede               → tareas que avanzaban volvían a "nuevo".
//   3. El contenido viaja solo si es más nuevo → cambiar de rama o una cola vieja revertía títulos.
//   4. Las fechas se comparan como fechas      → un mismo instante en otra zona horaria parecía distinto.

// ---- 1. Una ficha solo escribe en SU tarea ----
// Nativa: su external_ref es el id de la ficha, o la ficha es ALT-<n> (traída de Altum) y la tarea es
// la #n sin otro dueño. De reunión (acten:<n>): solo la ficha ACT-<n>. Cualquier otra cosa se rechaza.
export function esLaTareaDeLaFicha(item, tarea) {
  const id = String(item?.id || '');
  if (!tarea) return { ok: false, motivo: 'esa tarea no está en este proyecto de Altum' };
  const tareaId = String(tarea.id || '');
  // Nacida en una reunión: Altum lo dice con el prefijo del id o con source "acten". Las dos señas
  // valen; mirando solo el prefijo, una tarea de reunión con id normal se dejaba pisar.
  if (tareaId.startsWith('acten:') || tarea.source === 'acten') {
    return tareaId.startsWith('acten:') && id.toUpperCase() === `ACT-${tareaId.slice(6)}`.toUpperCase()
      ? { ok: true }
      : { ok: false, motivo: `${tareaId} es una tarea nacida en una reunión y no le corresponde a ${id}` };
  }
  if (tarea.external_ref === id) return { ok: true };
  const importada = id.match(/^ALT-(\d+)$/i);
  if (importada && String(tarea.number) === importada[1] && !tarea.external_ref) return { ok: true };
  return {
    ok: false,
    motivo: tarea.external_ref
      ? `la tarea #${tarea.number ?? '?'} es de la ficha ${tarea.external_ref}, no de ${id}`
      : `la tarea #${tarea.number ?? '?'} no está enlazada a ${id}`,
  };
}

// ---- 2. El estado nunca retrocede ----
// El orden es el del flujo del proyecto: primero el tipo (abierto < en progreso < terminado) y, dentro
// del mismo tipo, la posición en el flujo ("En desarrollo" antes que "En revisión"). Terminado y
// cancelado son finales: de uno no se pasa al otro solo (eso lo decide una persona).
const RANGO = { open: 0, in_progress: 1, done: 2, cancelled: 2 };

function datos(clave, estados) {
  const i = estados.findIndex((s) => s.key === clave);
  const e = estados[i];
  return e ? { kind: e.kind, rango: RANGO[e.kind] ?? 0, pos: e.position ?? i } : null;
}

export function avanza(desde, hacia, estados, { descartar = false } = {}) {
  if (!hacia || hacia === desde) return false;
  const a = datos(desde, estados);
  const b = datos(hacia, estados);
  if (!b) return false;
  // Altum tiene un estado que este flujo no conoce (lo renombraron o lo borraron con tareas dentro):
  // no hay con qué comparar, así que no se mueve. "Nunca retrocede" es absoluto.
  if (!a) return false;
  // Descartar cierra la tarea: va a "cancelada" o, si el flujo no tiene, al último terminado. Desde
  // cualquier estado abierto; si ya estaba terminada o cancelada, se deja como está.
  if (descartar) return a.rango < 2 && b.rango === 2;
  if (b.rango !== a.rango) return b.rango > a.rango;
  if (a.rango === 2) return false; // terminada y cancelada no se intercambian solas
  return b.pos > a.pos;
}

// ---- 3. El contenido viaja solo si la ficha es más nueva que lo último que se mandó ----
// "modificado" es la fecha del último commit que tocó la ficha (o la hora del archivo si tiene
// cambios sin guardar). Al cambiar a una rama vieja, la ficha es más vieja que lo enviado: no se
// manda. En una máquina que nunca la mandó, se compara contra la última edición en Altum.
export function contenidoMasNuevo(item, ultimoEnviado, tarea) {
  const mio = instante(item?.modificado);
  if (!mio) return true; // sin git no hay con qué comparar: se manda (no se pierde trabajo)
  // ">=": dos commits en el mismo segundo tienen la misma fecha; el segundo también debe viajar
  // (si no cambió nada, soloCambios no manda nada igual).
  if (ultimoEnviado) return mio >= instante(ultimoEnviado);
  const altum = instante(tarea?.updated_at);
  return !altum || mio >= altum;
}

// ---- 4. Fechas comparadas como fechas ----
// Altum devuelve fecha-hora en UTC, a veces sin la "Z"; git da la hora local con su desfase. Son el
// mismo instante escrito distinto: comparadas como texto, cada sincronización parecía un cambio.
export function instante(valor) {
  if (!valor) return 0;
  const texto = String(valor).trim();
  const conZona = /[zZ]|[+-]\d{2}:?\d{2}$/.test(texto) || /^\d{4}-\d{2}-\d{2}$/.test(texto) ? texto : `${texto}Z`;
  const ms = Date.parse(conZona);
  return Number.isNaN(ms) ? 0 : ms;
}

export function mismaFechaHora(a, b) {
  if (!a && !b) return true;
  const [x, y] = [instante(a), instante(b)];
  // Lo que no se puede leer como fecha da 0: dos textos distintos e ilegibles no son el mismo instante.
  if (!x || !y) return String(a || '') === String(b || '');
  return Math.floor(x / 1000) === Math.floor(y / 1000);
}

// Mismo día. Altum puede devolver la fecha como fecha-hora con desfase ("2026-10-11T19:00:00-05:00"
// es el 12 en UTC): comparada como texto, cada sincronización parecía un cambio. Una fecha sola
// (AAAA-MM-DD) se lee como UTC, que es como la guarda Altum.
export function mismaFecha(a, b) {
  if (!a && !b) return true;
  const dia = (v) => {
    const ms = instante(v);
    return ms ? new Date(ms).toISOString().slice(0, 10) : String(v || '').slice(0, 10);
  };
  return dia(a) === dia(b);
}

// Vigilante interno de Altum (sin n8n ni servidor público): mientras la sesión está abierta,
// pregunta a Altum cada ~60 s qué cambió (GET /tasks?updated_since=…) y deja los avisos en una bandeja
// local que el agente lee en el siguiente mensaje. Ignora los cambios hechos desde este computador.
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fechaUtc, lastPush, selfKeyId } from './altum.mjs';
import { readBacklog } from './altum-backlog.mjs';
import { readState, stateFile, writeState } from './store.mjs';

const INBOX = 'inbox.json';
const WATCH_STATE = 'watch-altum.json';
const PID_FILE = 'watch-altum.pid';
const OWN_CHANGE_WINDOW_MS = 15000; // con la misma clave, un cambio hasta 15 s después de nuestro PATCH es nuestro
const MAX_INBOX = 50;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// El archivo del vigilante guarda su número de proceso, cada cuánto da una ronda y cuándo fue la
// última. El número solo no basta: si el vigilante muere de golpe, el sistema puede darle ese mismo
// número a OTRO programa, y entonces "detener el vigilante" mataba algo que no era nuestro.
// Con la hora de la última ronda se sabe si de verdad sigue vivo.
function leerVigilante(pidFile) {
  if (!existsSync(pidFile)) return null;
  const texto = readFileSync(pidFile, 'utf8').trim();
  try {
    const d = JSON.parse(texto);
    return d && d.pid ? { pid: Number(d.pid), at: Number(d.at) || 0, cada: Number(d.cada) || 60 } : null;
  } catch {
    return Number(texto) ? { pid: Number(texto), at: 0, cada: 60 } : null;   // formato viejo: solo el número
  }
}

const esNuestro = (v) => Boolean(v) && Date.now() - v.at < v.cada * 3000 + 60000;

function vivo(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function readInbox() {
  return readState(INBOX, []);
}

export function clearInbox() {
  writeState(INBOX, []);
}

function notifyDesktop(title, message) {
  if (process.platform !== 'darwin') return;
  const safe = (text) => String(text).replace(/["\\]/g, '');
  execFile('osascript', ['-e', `display notification "${safe(message)}" with title "${safe(title)}"`], () => {});
}

// updated_by = null: alguien lo cambió a mano en Altum. Otra clave: otra persona o integración.
// Misma clave: fue este computador solo si coincide con su último envío (la clave puede ser compartida).
function isOwnChange(connector, entry) {
  const by = entry.task.updated_by;
  if (by === null) return false;
  const self = selfKeyId(connector);
  if (by?.id && self && by.id !== self) return false;
  const pushed = lastPush(entry.altum_id);
  if (!pushed || !entry.task.updated_at) return false;
  return fechaUtc(entry.task.updated_at) - fechaUtc(pushed) <= OWN_CHANGE_WINDOW_MS;
}

// Una ronda: devuelve los avisos nuevos y avanza la marca de tiempo. Cada consulta se solapa
// OVERLAP_MS con la anterior (por si los relojes no coinciden) y "seen" evita repetir avisos.
const OVERLAP_MS = 30000;
const MAX_SEEN = 500;

export async function checkOnce(connector, root = '.') {
  const state = readState(WATCH_STATE, { since: new Date().toISOString(), seen: {} });
  const startedAt = new Date().toISOString();
  const since = new Date(new Date(state.since).getTime() - OVERLAP_MS).toISOString();
  const backlog = await readBacklog(connector, root, since);
  const seen = { ...(state.seen || {}) };
  const fresh = backlog.filter((b) => seen[b.altum_id] !== b.task.updated_at);
  fresh.forEach((b) => { seen[b.altum_id] = b.task.updated_at; });
  const notes = fresh.filter((b) => !isOwnChange(connector, b)).map((b) => ({
    at: startedAt,
    kind: b.deleted ? (b.item ? 'deleted' : 'closed-elsewhere') : b.item ? 'changed' : (b.open ? 'new' : 'closed-elsewhere'),
    number: b.number, title: b.title, state: b.state, priority: b.priority, item: b.item, altum_id: b.altum_id,
  })).filter((n) => n.kind !== 'closed-elsewhere');
  writeState(WATCH_STATE, { since: startedAt, seen: Object.fromEntries(Object.entries(seen).slice(-MAX_SEEN)) });
  if (notes.length) writeState(INBOX, [...readInbox(), ...notes].slice(-MAX_INBOX));
  return notes;
}

export function describe(note) {
  // Las de reuniones (Acten) no tienen número ni prioridad: se nombran por lo que son.
  if (note.kind === 'new' && !note.number) return `Nueva tarea en Altum, nacida en una reunión: ${note.title}. Tráela con /sn.`;
  if (note.kind === 'new') return `Nueva tarea en Altum #${note.number}: ${note.title} (prioridad ${note.priority ?? '—'}). Tráela con /sn.`;
  if (note.kind === 'deleted') return `${note.item}: su tarea #${note.number} se borró en Altum. Pregunta si se descarta el ítem o se vuelve a crear.`;
  return `${note.item} cambió en Altum: estado ${note.state}${note.priority ? `, prioridad ${note.priority}` : ''}.`;
}

// Bucle del vigilante. Un solo vigilante por repositorio (archivo pid). Se detiene al cerrar la sesión,
// al pasar max-minutes, o si otro vigilante tomó su lugar.
export async function watch(connector, { everySeconds = 60, maxMinutes = 480, notify = true } = {}) {
  const pidFile = stateFile(PID_FILE);
  mkdirSync(path.dirname(pidFile), { recursive: true });
  const latir = () => writeFileSync(pidFile, JSON.stringify({ pid: process.pid, at: Date.now(), cada: everySeconds }));
  latir();
  const deadline = Date.now() + maxMinutes * 60000;
  let delay = everySeconds * 1000;
  while (Date.now() < deadline) {
    if (leerVigilante(pidFile)?.pid !== process.pid) return;   // otro vigilante tomó el relevo
    latir();
    try {
      const notes = await checkOnce(connector);
      if (notify && notes.length) notifyDesktop('Altum', notes.length === 1 ? describe(notes[0]) : `${notes.length} cambios en Altum`);
      delay = everySeconds * 1000;
    } catch (error) {
      const retryAfter = Number(error.message.match(/reintentar en (\d+)/)?.[1]);
      delay = retryAfter ? retryAfter * 1000 : Math.min(delay * 2, 10 * 60000); // respeta 429 y se aleja si Altum falla
    }
    await sleep(delay + Math.floor(Math.random() * 5000)); // variación para no coincidir con otros computadores
  }
  if (leerVigilante(pidFile)?.pid === process.pid) rmSync(pidFile);
}

export function stopWatch() {
  const pidFile = stateFile(PID_FILE);
  const v = leerVigilante(pidFile);
  if (!v) return false;
  rmSync(pidFile, { force: true });
  // Solo se detiene si de verdad es nuestro vigilante (dio una ronda hace poco): si quedó un archivo
  // viejo, ese número puede ser hoy de otro programa del computador y matarlo sería un daño.
  if (!esNuestro(v)) return false;
  try {
    process.kill(v.pid);
  } catch {
    // ya no existía
  }
  return true;
}

export function isWatching() {
  const v = leerVigilante(stateFile(PID_FILE));
  return Boolean(v) && esNuestro(v) && vivo(v.pid);
}

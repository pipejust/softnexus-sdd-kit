// Estado local de la sincronización (NO se versiona: .sn/state/ está en .gitignore).
//   last-snapshot.json : última foto enviada desde este computador
//   outbox.jsonl       : entregas fallidas pendientes de reintento (el sistema externo estaba caído)
//   lock/              : evita dos sincronizaciones a la vez
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const SN_DIR = '.sn';
export const CONFIG_FILE = path.join(SN_DIR, 'connectors.json');
const STATE_DIR = path.join(SN_DIR, 'state');
const SNAPSHOT_FILE = path.join(STATE_DIR, 'last-snapshot.json');
const OUTBOX_FILE = path.join(STATE_DIR, 'outbox.jsonl');
export const DESCARTADOS_FILE = path.join(STATE_DIR, 'descartados.jsonl');
const LOCK_DIR = path.join(STATE_DIR, 'lock');
const STALE_LOCK_MS = 120000;
const MAX_ATTEMPTS = 20;

// La carpeta se ignora sola (su propio .gitignore con "*"): así no hay que tocar el .gitignore del
// equipo, y nadie sube por error el estado de su computador.
function ensureState() {
  mkdirSync(STATE_DIR, { recursive: true });
  const ignorar = path.join(STATE_DIR, '.gitignore');
  if (!existsSync(ignorar)) writeFileSync(ignorar, '*\n');
}

export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, ''));   // sin BOM (editores de Windows)
  return { ...config, connectors: (config.connectors || []).filter((c) => c.enabled !== false) };
}

export function loadSnapshot() {
  return existsSync(SNAPSHOT_FILE) ? JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')) : null;
}

export function saveSnapshot(snapshot) {
  ensureState();
  writeFileSync(SNAPSHOT_FILE, `${JSON.stringify(snapshot, null, 2)}\n`);
}

export function readOutbox() {
  if (!existsSync(OUTBOX_FILE)) return [];
  return readFileSync(OUTBOX_FILE, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
}

export function writeOutbox(entries) {
  ensureState();
  const kept = entries.filter((e) => e.attempts < MAX_ATTEMPTS);
  const tirados = entries.filter((e) => e.attempts >= MAX_ATTEMPTS);
  writeFileSync(OUTBOX_FILE, kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length ? '\n' : ''));
  // Lo que se rinde no desaparece: queda escrito para que "status" y el aviso de la sesión lo muestren.
  for (const e of tirados) {
    appendFileSync(DESCARTADOS_FILE, `${JSON.stringify({ at: new Date().toISOString(), conector: e.connector, item: e.event?.item?.id || '', error: e.error })}\n`);
  }
  return tirados.length;
}

export function appendOutbox(entry) {
  ensureState();
  appendFileSync(OUTBOX_FILE, `${JSON.stringify(entry)}\n`);
}

// Lo que no se va a reintentar queda escrito aquí, SIEMPRE: "status" lo muestra y el agente lo
// cuenta en el siguiente mensaje. Un cambio que no llegó a Altum no puede desaparecer en silencio.
export function anotarDescartado({ conector = '', item = '', error = '' }) {
  ensureState();
  appendFileSync(DESCARTADOS_FILE, `${JSON.stringify({ at: new Date().toISOString(), conector, item, error })}\n`);
}

// Refresca el candado mientras la sincronización corre: una corrida larga (el límite de 120
// peticiones por minuto obliga a esperar) pasaba de los 2 minutos y la siguiente se lo robaba a
// mitad de camino, con dos procesos escribiendo en Altum a la vez.
export function refreshLock() {
  try {
    utimesSync(LOCK_DIR, new Date(), new Date());
  } catch { /* ya se liberó */ }
}

export function acquireLock() {
  ensureState();
  try {
    mkdirSync(LOCK_DIR);
    return true;
  } catch {
    let age = Infinity;
    try {
      age = Date.now() - statSync(LOCK_DIR).mtimeMs;
    } catch {
      // Lo liberaron justo ahora: se intenta tomarlo una vez más, sin insistir.
      try {
        mkdirSync(LOCK_DIR);
        return true;
      } catch {
        return false;
      }
    }
    if (age < STALE_LOCK_MS) return false;
    rmSync(LOCK_DIR, { recursive: true, force: true }); // candado viejo de un proceso que murió
    try {
      mkdirSync(LOCK_DIR);
      return true;
    } catch {
      return false;   // otro proceso se adelantó: que sincronice él
    }
  }
}

// Archivos JSON auxiliares en .sn/state/ (último pull, cambios propios, bandeja de avisos).
export function stateFile(name) {
  return path.join(STATE_DIR, name);
}

export function readState(name, fallback) {
  const file = stateFile(name);
  try {
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback;
  } catch {
    return fallback; // archivo a medio escribir o dañado: se reconstruye
  }
}

// Se escribe aparte y se renombra: un corte a mitad de camino dejaba el archivo roto, y entonces
// readState devolvía el valor por defecto. En altum-enviados.json eso borraba de golpe la memoria de
// lo ya enviado, y la siguiente sincronización desde una rama vieja sobreescribía Altum.
export function writeState(name, value) {
  ensureState();
  const file = stateFile(name);
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temp, file);
}

export function releaseLock() {
  rmSync(LOCK_DIR, { recursive: true, force: true });
}

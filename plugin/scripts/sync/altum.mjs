// Conector nativo "altum" — API de tareas de Altum (contrato en references/integraciones.md §7d).
//   Repo -> Altum : crea la tarea (POST /tasks) y luego la actualiza (PATCH /tasks/{id}).
//   Altum -> Repo : ver altum-backlog.mjs (proyectos, tareas existentes, importar).
//   Firma de webhooks de Altum: verifyAltumSignature() para el receptor (n8n u otro).
// Una clave por empresa (X-API-Key); el resto del contrato es igual para todas.
import { execFileSync } from 'node:child_process';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findMark, itemPlainBody } from './body.mjs';
import { fetchAltumTask, miEmpleado } from './altum-backlog.mjs';
import { avanza, contenidoMasNuevo, esLaTareaDeLaFicha, instante, mismaFecha, mismaFechaHora } from './reglas.mjs';
import { readState, writeState } from './store.mjs';

const PUSHED_FILE = 'altum-pushed.json';
const SELF_FILE = 'altum-self.json';

// Recuerda cuándo ESTE computador cambió cada tarea y qué id tiene su clave en Altum ("updated_by"),
// para que el vigilante no avise de sus propios cambios.
function recordPush(connector, task) {
  writeState(PUSHED_FILE, { ...readState(PUSHED_FILE, {}), [task.id]: new Date().toISOString() });
  const keyId = task.updated_by?.id;
  if (keyId) writeState(SELF_FILE, { ...readState(SELF_FILE, {}), [connector.name]: keyId });
}

export function lastPush(taskId) {
  return readState(PUSHED_FILE, {})[taskId] || '';
}

export function selfKeyId(connector) {
  return readState(SELF_FILE, {})[connector.name] || '';
}

const DEFAULT_BASE = 'https://servicios.softnexus.io/api/v1/api';
const CLIENTE = (() => {
  try {
    const manifiesto = new URL('../../.claude-plugin/plugin.json', import.meta.url);
    return `softnexus-sdd/${JSON.parse(readFileSync(manifiesto, 'utf8')).version}`;
  } catch {
    return 'softnexus-sdd'; // copia del motor dentro de un repositorio: sin manifiesto al lado
  }
})();
const TIMEOUT_MS = 10000;
const PAGE_LIMIT = 200; // máximo que acepta GET /tasks
const MAX_SIGNATURE_AGE_S = 300;

// Etapa Softnexus -> estado Altum por defecto (sobrescribible con "status_map").
const DEFAULT_STATUS = {
  triaged: 'new', ready: 'new', planning: 'active', plan_written: 'active', plan_approved: 'active',
  building: 'active', built: 'active', verified: 'active', in_review: 'active', merged: 'closed', done: 'closed', discarded: 'removed',
};
// Tipo de ítem -> kind de Altum (epica|feature|historia|requerimiento|tarea|bug|pendiente).
const DEFAULT_KIND = { feature: 'historia', improvement: 'requerimiento', bug: 'bug', incident: 'bug', content: 'tarea', chore: 'tarea' };
export const KIND_TO_TYPE = { epica: 'feature', feature: 'feature', historia: 'feature', requerimiento: 'improvement', tarea: 'chore', bug: 'bug', pendiente: 'chore', 'acten-tarea': 'chore' };

// Tareas que nacen en reuniones gestionadas por Acten: llegan mezcladas en GET /tasks con id "acten:…".
// Se leen igual que las nativas, pero Altum solo deja cambiarles estado, responsable, título y descripción,
// y sus estados son fijos (los de Acten, no los del proyecto). Cualquier otro campo responde 422.
export function esDeActen(task) {
  return task?.source === 'acten' || String(task?.id || '').startsWith('acten:');
}
export const ACTEN_STATES = ['pending', 'blocked', 'done', 'cancelled'];
export const ACTEN_DONE = ['done', 'cancelled'];
const ACTEN_STATUS = {
  triaged: 'pending', ready: 'pending', planning: 'pending', plan_written: 'pending', plan_approved: 'pending',
  building: 'pending', built: 'pending', verified: 'pending', in_review: 'pending', merged: 'done', done: 'done', discarded: 'cancelled',
};

// Altum promete UTC, pero las fechas de Acten viajan sin zona ("2026-08-20T17:07:23.569141"):
// sin esto, JavaScript las leería como hora local y se irían varias horas.
export function fechaUtc(value) {
  if (!value) return null;
  const text = String(value);
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(text) ? text : `${text}Z`);
}

// Error que no se debe reintentar (reglas de negocio de Altum: 409 bloqueadores o duplicado, 422 dato no válido).
export class NotRetryable extends Error {
  constructor(message, status, campos = []) {
    super(message);
    this.status = status;
    this.campos = campos; // los que Altum rechazó por permisos (403): se pueden reintentar sin ellos
  }
}

function blockersMessage(detail) {
  const blockers = detail?.bloqueadores || [];
  if (!blockers.length) return '';
  return `Altum no deja cerrarla: falta cerrar ${blockers.map((b) => `#${b.number} "${b.title}" (${b.state})`).join(', ')}`;
}

// Una sola variable por empresa (key_env, ej. SN_ALTUM_KEY_SOFTNEXUS). En el computador de cada persona
// guarda SU clave personal (dice quién es, de qué empresa y qué proyectos tiene asignados); en el CI,
// la clave de la empresa. El plugin no distingue: Altum sabe de quién es cada clave (GET /me).
//
// Si la variable no está en el entorno (las apps de escritorio no leen ~/.zshrc ni el perfil de
// PowerShell), se busca donde la dejó el asistente de la clave, cifrada por el sistema operativo:
//   macOS   → Llavero (sn-clave-altum.sh)
//   Windows → archivo cifrado con DPAPI para ese usuario (sn-clave-altum.ps1), en %LOCALAPPDATA%\Softnexus
// El valor se queda en memoria: nunca se imprime ni se guarda en el repositorio.
const keyCache = new Map();

// Cómo se guarda la clave en cada sistema (el asistente la pide sin mostrarla y la deja cifrada).
export const COMO_GUARDARLA = process.platform === 'win32'
  ? '"powershell -ExecutionPolicy Bypass -File scripts\\sn\\sn-clave-altum.ps1"'
  : '"source scripts/sn/sn-clave-altum.sh"';

const ALMACEN_WINDOWS = (name) => path.join(process.env.LOCALAPPDATA || '', 'Softnexus', `${name}.dpapi`);

function delLlavero(name) {
  return execFileSync('security', ['find-generic-password', '-a', os.userInfo().username, '-s', name, '-w'],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000, windowsHide: true }).trim();
}

// DPAPI: lo que cifró ConvertFrom-SecureString solo lo descifra el mismo usuario en el mismo computador.
function deDpapi(name) {
  const archivo = ALMACEN_WINDOWS(name);
  if (!existsSync(archivo)) return '';
  const guion = '$e = Get-Content -Raw -LiteralPath $env:SN_ARCHIVO_CLAVE;'
    + '$s = ConvertTo-SecureString $e.Trim();'
    + '[Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))';
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', guion],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000, windowsHide: true,
      env: { ...process.env, SN_ARCHIVO_CLAVE: archivo } }).trim();
}

export function fromKeychain(name) {
  if (keyCache.has(name)) return keyCache.get(name);
  let value = '';
  try {
    if (process.platform === 'darwin') value = delLlavero(name);
    else if (process.platform === 'win32') value = deDpapi(name);
  } catch {
    value = ''; // no hay clave guardada en este computador
  }
  keyCache.set(name, value);
  return value;
}

export function keyName(connector) {
  return connector.key_env || 'SN_ALTUM_KEY';
}

export function hasKey(connector) {
  return Boolean(process.env[keyName(connector)] || fromKeychain(keyName(connector)));
}

function key(connector) {
  const name = keyName(connector);
  const value = process.env[name] || fromKeychain(name);
  if (!value) throw new Error(`falta la clave de Altum (${name}): guárdala con ${COMO_GUARDARLA} (una sola vez, sirve para todos tus proyectos)`);
  return value;
}

// El texto de un 403 de Altum, traducido a lo que la persona tiene que hacer. Altum manda
// {"detail": {"error": "…", "campos": [...]}}; si no se entiende, queda el texto tal cual.
export function camposRechazados(texto) {
  try {
    const d = JSON.parse(texto);
    return d?.detail?.campos || d?.campos || [];
  } catch {
    return [];
  }
}

export function motivo403(texto) {
  let detalle = null;
  try { detalle = JSON.parse(texto); } catch { /* cuerpo no JSON */ }
  const error = detalle?.detail?.error || detalle?.error || '';
  const campos = detalle?.detail?.campos || detalle?.campos || [];
  if (/no estás asignado/i.test(error)) {
    return `${error}. Pídele al líder del proyecto en Altum que te agregue (el acceso cambia al instante).`;
  }
  if (error) {
    return `${error}${campos.length ? ` (${campos.join(', ')})` : ''}. En Altum, planear y corregir lo ajeno es del líder: pídeselo a quien lleva el proyecto. Tu trabajo en el repositorio sigue igual.`;
  }
  return 'Altum no deja hacer ese cambio con tu clave: planear (fechas, prioridad, padre, sprint) y tocar tareas de otras personas lo decide quien lleva el proyecto.';
}

export async function api(connector, method, route, body, headers = {}, intento = 0) {
  const base = (connector.base_url || process.env.SN_ALTUM_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  const response = await fetch(`${base}${route}`, {
    method,
    // Quién escribe: el plugin, no "alguien". Altum puede mostrarlo en el historial de la tarea (pedido J).
    headers: {
      'X-API-Key': key(connector), 'Content-Type': 'application/json', Accept: 'application/json',
      'User-Agent': CLIENTE, 'X-Client-Name': 'Plugin Softnexus', ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 409 || response.status === 422) {
    const text = await response.text();
    let detail = null;
    try { detail = JSON.parse(text); } catch { /* cuerpo no JSON */ }
    const delServidor = String(detail?.error || detail?.detail?.error || detail?.detail || text || '');
    const message = blockersMessage(detail)
      || `Altum rechazó el cambio (HTTP ${response.status}${response.status === 422 ? ', estado o campo no válido en ese proyecto' : ''}): ${delServidor.slice(0, 200)}`;
    const error = new NotRetryable(message, response.status);
    // Lo que dijo ALTUM, sin el texto que agrega el plugin: de ahí (y solo de ahí) se saca qué campo
    // rechazó. Mirando el mensaje completo, la palabra "estado" del propio aviso hacía creer que el
    // campo rechazado era el estado, y la tarea se quedaba sin cerrar.
    error.delServidor = delServidor;
    throw error;
  }
  if (response.status === 429) {
    // Límite de 120 peticiones por minuto: se espera lo que Altum pide y se reintenta (hasta 3 veces).
    const espera = Math.min(Number(response.headers.get('retry-after')) || 10, 60);
    if (intento < 3) {
      await new Promise((r) => setTimeout(r, espera * 1000));
      return api(connector, method, route, body, headers, intento + 1);
    }
    throw new Error(`Altum: límite de peticiones (sigue lleno después de 3 esperas de ${espera} s)`);
  }
  // 403: desde el 6-oct Altum da a la clave personal los mismos permisos que su dueño tiene en pantalla.
  // Planear (fechas, prioridad, padre, sprint) y tocar lo ajeno es del líder. No es un fallo de conexión
  // ni se reintenta: se le dice a la persona que eso lo decide quien lleva el proyecto.
  if (response.status === 403) {
    const texto = await response.text().catch(() => '');
    throw new NotRetryable(motivo403(texto), 403, camposRechazados(texto));
  }
  const reasons = {
    401: 'clave de API inválida o revocada: si la regeneraste en Altum, la anterior dejó de servir — vuelve a guardarla con "bash scripts/sn/sn-clave-altum.sh"',
    404: 'no existe, o tu clave personal no alcanza ese proyecto: revisa el project_id y que estés asignado a él en Altum',
  };
  if (!response.ok) throw new Error(`Altum HTTP ${response.status}${reasons[response.status] ? ` — ${reasons[response.status]}` : ''} en ${route}`);
  return response.status === 204 ? null : response.json();
}

// Todas las tareas que cumplen el filtro, página por página (GET /tasks trae como máximo 200 por página).
// Con include_deleted=true, Altum devuelve además "deleted": las tareas borradas de verdad.
export async function listTasks(connector, params = {}) {
  const filters = Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== ''));
  const items = [];
  const deleted = [];
  for (let page = 1; ; page += 1) {
    const query = new URLSearchParams({ ...filters, page, limit: PAGE_LIMIT });
    const result = await api(connector, 'GET', `/tasks?${query}`);
    items.push(...(result.items || []));
    if (page === 1) deleted.push(...(result.deleted || []));
    if (!result.items?.length || items.length >= (result.total ?? items.length)) return { items, deleted };
  }
}

// Estados del workflow del proyecto: objetos { key, label, kind } con kind open|in_progress|done|cancelled.
// Los estados cambian muy poco: se guardan STATES_TTL_MS en .sn/state/ para que el vigilante
// haga una sola petición por minuto (solo GET /tasks) y no gaste el límite de la clave.
const STATES_FILE = 'altum-states.json';
const STATES_TTL_MS = 10 * 60000;

export async function projectStates(connector, { fresh = false } = {}) {
  const cached = readState(STATES_FILE, {})[connector.project_id];
  // Una caché de una versión vieja del plugin (sin "list", solo "valid") no trae kind ni position:
  // con eso, la regla "el estado nunca retrocede" se reduce al orden del arreglo. Se descarta y se
  // vuelve a pedir, en vez de usarla a medias.
  if (!fresh && cached?.value?.list && Date.now() - cached.at < STATES_TTL_MS) return cached.value;
  const value = await fetchProjectStates(connector);
  writeState(STATES_FILE, { ...readState(STATES_FILE, {}), [connector.project_id]: { at: Date.now(), value } });
  return value;
}

async function fetchProjectStates(connector) {
  const raw = await api(connector, 'GET', `/projects/${connector.project_id}/config/estados`);
  const list = Array.isArray(raw) ? raw : raw?.items || [];
  return {
    valid: list.map((s) => s.key),
    done: list.filter((s) => ['done', 'cancelled'].includes(s.kind)).map((s) => s.key),
    list: list.map((s, i) => ({ key: s.key, kind: s.kind, label: s.label || '', position: s.position ?? i })),
  };
}

// Campos propios del proyecto (GET /config/campos). Se envían solo los que el proyecto definió, de tipo
// texto o lista, y con un valor permitido. Por defecto: riesgo, tamaño y etapa (cambiable con "field_map").
const DEFAULT_FIELDS = { risk: 'riesgo', size: 'tamano', stage_label: 'etapa' };

async function projectFields(connector) {
  try {
    const raw = await api(connector, 'GET', `/projects/${connector.project_id}/config/campos`);
    return Array.isArray(raw) ? raw : raw?.items || [];
  } catch (error) {
    if (/HTTP 404/.test(error.message)) return [];
    throw error;
  }
}

export function customFieldsFor(connector, item, fields) {
  const defs = new Map(fields.map((f) => [f.key, f]));
  const esFecha = (valor) => /^\d{4}-\d{2}-\d{2}$/.test(String(valor));
  const allowed = (def, value) => def && value && (def.field_type === 'text'
    || (def.field_type === 'date' && esFecha(value))
    || (def.field_type === 'select' && def.options?.includes(value)));
  return Object.fromEntries(Object.entries(connector.field_map || DEFAULT_FIELDS)
    .filter(([source, key]) => allowed(defs.get(key), item[source]))
    .map(([source, key]) => [key, item[source]]));
}

// Sprints del proyecto: una tarea nueva entra al que esté activo (si el proyecto usa sprints).
// Si Altum todavía no tiene la ruta (404) o la clave no alcanza, se sigue sin sprint.
export async function sprintActivo(connector) {
  try {
    const raw = await api(connector, 'GET', `/projects/${connector.project_id}/sprints`);
    const lista = Array.isArray(raw) ? raw : raw?.items || [];
    return lista.find((sp) => sp.state === 'active')?.id || '';
  } catch {
    return '';
  }
}

// Una lectura por ejecución: estados válidos del proyecto y tareas ya enlazadas.
// El enlace firme es external_ref (= id del ítem); la marca oculta en la descripción queda para tareas viejas.
const runCache = new Map();
async function projectContext(connector) {
  if (runCache.has(connector.name)) return runCache.get(connector.name);
  const [{ valid, list: estados = valid.map((key) => ({ key })) }, fields, { items }, sprint, yo] = await Promise.all([
    projectStates(connector, { fresh: true }),
    projectFields(connector),
    listTasks(connector, { project_id: connector.project_id }),
    connector.sprints === false ? '' : sprintActivo(connector),
    miEmpleado(connector).catch(() => null),
  ]);
  const byRef = new Map(items.map((t) => [t.external_ref || findMark(t.description), t.id]).filter(([id]) => id));
  // En un PATCH, custom_fields REEMPLAZA el objeto: se guarda lo que ya tiene cada tarea para mezclarlo.
  const currentFields = new Map(items.map((t) => [t.id, t.custom_fields || {}]));
  // Cómo está cada tarea hoy en Altum: solo se envía lo que cambió (cada PATCH queda en el historial).
  const current = new Map(items.map((t) => [t.id, t]));
  const context = { validStates: valid, estados, fields, byRef, currentFields, current, sprint, yo };
  runCache.set(connector.name, context);
  return context;
}

// "[ID] título" sin repetir el prefijo si el título ya lo trae (p. ej. tareas importadas desde Altum).
export function taskTitle(item) {
  const clean = String(item.title || '').replace(/^(\[[^\]]+\]\s*)+/, '');
  return `[${item.id}] ${clean}`;
}

export function priorityOf(item) {
  if (item.type === 'incident' || item.risk === 'R4') return 1;
  return { R3: 2, R2: 3 }[item.risk] || 4;
}

// Qué "kind" de Altum corresponde a cada etapa, para proyectos con workflow propio.
const STAGE_KIND = {
  triaged: 'open', ready: 'open', planning: 'in_progress', plan_written: 'in_progress', plan_approved: 'in_progress',
  building: 'in_progress', built: 'in_progress', verified: 'in_progress', in_review: 'in_progress', merged: 'done', done: 'done', discarded: 'cancelled',
};

// Estado a enviar: el de status_map o el de siempre si el proyecto lo tiene; si no (workflow propio),
// el equivalente por "kind" — así una tarea terminada SIEMPRE queda en un estado de terminado.
// Al terminar (PR unido o plano archivado) se usa el ÚLTIMO estado "done" del workflow, el más cerrado;
// en los demás, el primero. Unir el PR ya es terminar: la tarea se cierra ahí, sin esperar a nadie.
export function estadoPara(stage, estados, statusMap = {}) {
  const valid = estados.map((s) => s.key);
  const wanted = statusMap[stage] || DEFAULT_STATUS[stage];
  if (valid.includes(wanted)) return wanted;
  const kind = STAGE_KIND[stage];
  let mismos = estados.filter((s) => s.kind === kind);
  // Descartado sin estado de "cancelado" en el workflow: se cierra igual (nunca queda abierta).
  if (!mismos.length && kind === 'cancelled') mismos = estados.filter((s) => s.kind === 'done');
  if (!mismos.length) return null;
  if (stage === 'in_review') {
    const revision = mismos.find((s) => /revisi|review/i.test(`${s.key} ${s.label || ''}`));
    return (revision || mismos[mismos.length - 1]).key;
  }
  return (['merged', 'done', 'discarded'].includes(stage) ? mismos[mismos.length - 1] : mismos[0]).key;
}

// Qué tan adelante va un estado en el flujo: abierto < en progreso < terminado/cancelado.
const RANGO = { open: 0, in_progress: 1, done: 2, cancelled: 2 };

function rangoDe(clave, estados) {
  const kind = estados.find((s) => s.key === clave)?.kind;
  return RANGO[kind] ?? 0;
}

// El estado que le toca al ítem según el repositorio. PERO nunca se devuelve una tarea hacia atrás:
// la etapa se deduce de lo que hay en ESTE computador (rama, plano, PR), y eso cambia de una persona
// a otra. Si en Altum la tarea ya va más adelante —alguien la movió, o la empezó otra persona—, lo
// de allá manda y aquí no se toca. Hacia adelante sí: terminar, cerrar o descartar siempre viaja.
export function estadoQueViaja(connector, item, estados, actual) {
  const quiero = estadoPara(item.stage, estados, connector.status_map);
  if (!quiero || !actual) return quiero;
  if (quiero === actual) return null;
  // Descartar es una decisión escrita en el repositorio: pasa a cancelada desde cualquier estado abierto.
  return avanza(actual, quiero, estados, { descartar: Boolean(item.discarded) }) ? quiero : null;
}

function stateFor(connector, item, estados) {
  return estadoPara(item.stage, estados, connector.status_map);
}

// Criterios de aceptación: en el repositorio son la sección "Criterios de aceptación" del ítem y a
// Altum van como texto plano. Si alguien los edita a mano en Altum, llegan con HTML simple
// (<strong>, <ul>...): para comparar se quitan etiquetas y viñetas, así un cambio solo de formato
// no provoca otro PATCH (ni ensucia el historial).
export function textoPlano(valor) {
  return String(valor || '')
    .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|li|div|h\d)>/gi, '\n').replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

const comparable = (valor) => textoPlano(valor).replace(/^\s*([-*•]|\d+[.)])\s*/gm, '').replace(/\*\*|`/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

// Etiquetas de la tarea. Las nuestras llevan prefijo "sn:" para poder reemplazarlas sin tocar las
// que alguien haya puesto a mano en Altum, que se conservan siempre.
export function etiquetasPara(connector, item, actuales = null) {
  if (connector.tags === false) return null;
  const nuestras = [
    item.type && `sn:${item.type}`,
    item.risk && `sn:${String(item.risk).toLowerCase()}`,
    item.size && `sn:tamano-${String(item.size).toLowerCase()}`,
    ...(connector.tags_extra || []),
  ].filter(Boolean);
  const ajenas = (actuales || []).filter((t) => !String(t).startsWith('sn:'));
  return [...new Set([...ajenas, ...nuestras])];
}

function criteriosDe(item) {
  return String(item.criteria || '').replace(/\*\*|`/g, '').trim();
}

// Solo los campos que de verdad cambian. Altum guarda en el historial cada PATCH con el antes y el
// después completos, así que mandar lo mismo otra vez solo ensucia ese historial.
// Las etiquetas son un conjunto: el orden en que Altum las devuelva no es un cambio.
const mismoConjunto = (a, b) => JSON.stringify([...(a || [])].sort()) === JSON.stringify([...(b || [])].sort());

function soloCambios(actual = {}, deseado) {
  return Object.fromEntries(Object.entries(deseado).filter(([k, v]) => {
    if (k === 'acceptance_criteria') return comparable(actual[k]) !== comparable(v);
    if (k === 'started_at' || k === 'completed_at') return !mismaFechaHora(actual[k], v);
    if (k === 'start_date' || k === 'due_date') return !mismaFecha(actual[k], v);
    if (Array.isArray(v)) return !mismoConjunto(actual[k], v);
    return JSON.stringify(actual[k] ?? null) !== JSON.stringify(v ?? null);
  }));
}

// Lo que en Altum es "planear": si la persona no lidera el proyecto, su clave no puede tocarlo
// (403 con la lista de campos). En ese caso se reintenta sin ellos, para que lo suyo —estado,
// descripción, criterios— sí llegue, y se le dice que lo demás lo pone el líder.
const CAMPOS_DE_PLANEACION = ['start_date', 'due_date', 'started_at', 'completed_at', 'parent_id', 'sprint_id', 'priority'];

function sinLosRechazados(cuerpo, campos) {
  const fuera = new Set(campos.length ? campos : CAMPOS_DE_PLANEACION);
  const resto = Object.fromEntries(Object.entries(cuerpo).filter(([k]) => !fuera.has(k)));
  return Object.keys(resto).length < Object.keys(cuerpo).length ? resto : null;
}

// Un 422 ("estado o campo no válido en ese proyecto") tumbaba el envío COMPLETO, estado incluido:
// una historia colgada de otra historia (Altum solo permite ciertas jerarquías) dejaba la tarea sin
// cerrar para siempre. Altum no manda la lista de campos, pero su mensaje nombra el que no aceptó:
// de ahí se saca, se reenvía sin él y lo demás sí llega. La jerarquía queda escrita en el repositorio.
// Solo el nombre LITERAL del campo (así lo nombra Altum: "ese parent_id no se permite…"), o una
// palabra que no puede confundirse. El estado NUNCA entra aquí: es el campo cuyo reintento importa,
// y si se descarta la tarea se queda abierta para siempre.
const NOMBRES_DE_CAMPO = {
  parent_id: /parent_id|\bpadre\b|jerarqu|\bno puede colgar de\b/i,
  sprint_id: /sprint_id|\bsprint\b|iteraci/i,
  priority: /\bpriority\b|prioridad/i,
  kind: /\bkind\b/i,
  start_date: /start_date/i,
  due_date: /due_date/i,
  started_at: /started_at/i,
  completed_at: /completed_at/i,
  custom_fields: /custom_field|campo propio/i,
  acceptance_criteria: /acceptance_criteria/i,
  tags: /\btags\b/i,
  assignee_id: /assignee_id/i,
};

export function camposDel422(textoDeAltum, cuerpo) {
  const texto = String(textoDeAltum || '');
  return Object.keys(cuerpo || {}).filter((campo) => NOMBRES_DE_CAMPO[campo]?.test(texto));
}

// Un envío que, si Altum lo rechaza por permisos (403) o por un campo que ese proyecto no acepta
// (422), se repite sin eso. Lo que no se pudo mandar se avisa y se anota, para no gastar una
// petición en cada sincronización repitiendo el mismo rechazo.
export async function enviarLoQueSePueda(connector, method, route, cuerpo, headers, aviso, alRechazar) {
  let pendiente = cuerpo;
  // Cada vuelta elimina al menos un campo: el límite es el tamaño del cuerpo inicial.
  for (;;) {
    try {
      return await api(connector, method, route, pendiente, headers);
    } catch (error) {
      const candidatos = error.status === 403 ? (error.campos?.length ? error.campos : CAMPOS_DE_PLANEACION)
        : error.status === 422 ? camposDel422(error.delServidor, pendiente) : [];
      if (candidatos.includes('state')) throw error; // jamás simular un cierre descartando su estado
      const campos = candidatos.filter((c) => c in pendiente);
      const resto = campos.length ? sinLosRechazados(pendiente, campos) : null;
      if (!resto) throw error;
      aviso?.(error.status === 422
        ? `${error.message} — lo mando sin ${campos.join(', ')}; eso queda escrito en la ficha, no en Altum.`
        : error.message);
      alRechazar?.(campos, pendiente);
      if (method === 'PATCH' && !Object.keys(resto).length) return null;
      pendiente = resto;
    }
  }
}

// Fechas de la tarea. Las previstas las escribe la persona en la ficha; las reales salen del
// repositorio: el primer commit del ítem y el día en que se unió el PR.
export function fechasDe(item) {
  return {
    ...(item.start ? { start_date: item.start } : {}),
    ...(item.due ? { due_date: item.due } : {}),
    ...(item.started_at || item.started ? { started_at: item.started_at || `${item.started}T00:00:00Z` } : {}),
    ...(item.finished_at || item.finished ? { completed_at: item.finished_at || `${item.finished}T00:00:00Z` } : {}),
  };
}

// Cada quien trabaja sus tareas: si una tarea ya tiene responsable y no soy yo, el plugin no la
// toca. La única excepción es el cierre explícito (`asegurar`, cuando se une el PR), que es una
// decisión de una persona y se anuncia. Las tareas sin responsable sí se pueden tomar.
export function esAjena(tarea, yo) {
  if (!tarea?.assignee_id || !yo?.id) return false;
  return tarea.assignee_id !== yo.id;
}

// Lo que la ficha declara como bloqueadores ("bloqueado_por: ID-1, ID-2") se declara en Altum.
// Solo se agregan: quitar una dependencia es una decisión que se toma en Altum, no un efecto de
// haber borrado una línea. Si la clave no puede declararlas (403), se dice y se sigue.
// Qué bloqueadores ya se declararon para cada tarea: sin esto, cada ficha con "bloqueado_por" gastaba
// un GET de más EN CADA sincronización, aunque nada hubiera cambiado (el límite es 120/min).
const BLOQUEADORES_DECLARADOS = 'altum-bloqueadores.json';
export async function declararBloqueadores(connector, taskId, item, byRef, tareaPorNumero = () => '') {
  const quiero = (item.blockers || []).map((id) => byRef.get(id) || tareaPorNumero(id)).filter(Boolean);
  if (!quiero.length) return;
  const todos = readState(BLOQUEADORES_DECLARADOS, {});
  const yaDeclarados = new Set(todos[taskId] || []);
  if (quiero.every((id) => yaDeclarados.has(id))) return; // ya se intentaron todos, con éxito o sin él
  let actuales = [];
  try {
    const raw = await api(connector, 'GET', `/tasks/${taskId}/dependencies`);
    actuales = (Array.isArray(raw) ? raw : raw?.items || []).map((d) => d.id);
  } catch (error) {
    if (!(error instanceof NotRetryable)) throw error;
    console.log(`[altum] ${item.id}: no pude leer los bloqueadores — ${error.message}`);
    return; // Altum todavía sin esa ruta, o caído: no es motivo para romper la sincronización
  }
  const intentados = [...yaDeclarados];
  for (const bloqueador of quiero.filter((id) => !yaDeclarados.has(id))) {
    if (actuales.includes(bloqueador)) { intentados.push(bloqueador); continue; }
    try {
      await api(connector, 'POST', `/tasks/${taskId}/dependencies`, { blocker_id: bloqueador });
    } catch (error) {
      if (!(error instanceof NotRetryable)) throw error;
      console.log(`[altum] ${item.id}: no pude declarar el bloqueador — ${error.message}`);
    }
    intentados.push(bloqueador);
  }
  writeState(BLOQUEADORES_DECLARADOS, { ...todos, [taskId]: intentados });
}

// Qué tarea es la de esta ficha. Primero el enlace escrito en la ficha; si no hay, la tarea cuyo
// external_ref es exactamente el id de la ficha; y para fichas traídas (ALT-n, ACT-n), la #n o la
// de la reunión n. Nunca "la primera que venga".
function tareaIdDe(item, connector, byRef, current) {
  const escrito = item.external?.[connector.name];
  if (escrito) return escrito;
  if (byRef.has(item.id)) return byRef.get(item.id);
  const alt = String(item.id).match(/^ALT-(\d+)$/i);
  if (alt) return [...current.values()].find((t) => String(t.number) === alt[1] && !t.external_ref)?.id || '';
  const act = String(item.id).match(/^ACT-(.+)$/i);
  if (act && current.has(`acten:${act[1]}`)) return `acten:${act[1]}`;
  return '';
}

// Lo último que ESTA máquina mandó de cada ficha (la fecha de la ficha en ese momento). Con eso se sabe
// si la ficha de ahora es más nueva o es una versión vieja (otra rama, un checkout atrasado).
// Lo que Altum rechazó para una tarea, con el valor exacto que rechazó: así no se vuelve a intentar
// cada sincronización, pero si la ficha cambia ese valor (o una persona corre "asegurar") sí se reintenta.
const RECHAZADOS = 'altum-rechazados.json';
const valorDe = (v) => JSON.stringify(v ?? null);

function anotarRechazo(taskId, campos, cuerpo) {
  const anotables = campos.filter((c) => c !== 'state');   // el estado se reintenta siempre
  if (!taskId || !anotables.length) return;
  const todo = readState(RECHAZADOS, {});
  const mios = { ...(todo[taskId] || {}) };
  for (const campo of anotables) mios[campo] = valorDe(cuerpo[campo]);
  writeState(RECHAZADOS, { ...todo, [taskId]: mios });
}

// Quita del envío lo que Altum ya rechazó con ese mismo valor.
function sinLoYaRechazado(taskId, cambios) {
  const mios = readState(RECHAZADOS, {})[taskId];
  if (!mios) return cambios;
  return Object.fromEntries(Object.entries(cambios).filter(([k, v]) => mios[k] !== valorDe(v)));
}

const ENVIADOS = 'altum-enviados.json';
const ultimoEnviado = (id) => readState(ENVIADOS, {})[id] || '';
const anotarEnviado = (id, modificado) => {
  if (modificado) writeState(ENVIADOS, { ...readState(ENVIADOS, {}), [id]: modificado });
};

const ACTEN_ORDEN = { pending: 0, blocked: 0, done: 2, cancelled: 2 };
const YA_TERMINO = new Set(['merged', 'done', 'discarded']);

// Desde cuándo este repositorio está unido a Altum: el primer commit de .sn/connectors.json o, si
// todavía no se guardó, la hora del archivo. Lo que terminó ANTES es historia: no se lleva a Altum solo.
let conectadoDesde = null;
function desdeCuandoConectado() {
  if (conectadoDesde !== null) return conectadoDesde;
  let fecha = '';
  try {
    fecha = execFileSync('git', ['log', '--diff-filter=A', '--format=%cI', '--', '.sn/connectors.json'], { windowsHide: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n').pop();
  } catch { /* sin git */ }
  if (!fecha) {
    try { fecha = statSync('.sn/connectors.json').mtime.toISOString(); } catch { /* sin archivo */ }
  }
  conectadoDesde = instante(fecha);
  return conectadoDesde;
}

export async function deliverAltum(connector, evt) {
  if (!connector.project_id) throw new NotRetryable('falta "project_id" (UUID del proyecto en Altum) en el conector');
  if (evt.type === 'sn.test') {
    await projectContext(connector);
    return;
  }
  const { item } = evt;
  const contexto = await projectContext(connector);
  const { estados, fields, byRef, currentFields, current, sprint, yo } = contexto;
  const description = itemPlainBody(evt);
  const email = item.assignee.match(/<([^>]+@[^>]+)>/)?.[1] || '';
  const assignee = connector.assignee_map?.[email || item.assignee];
  const avisar = (texto) => { if (process.env.SN_SYNC_SILENCIO !== '1') console.log(`[altum] ${item.id}: ${texto}`); };

  // ---- ¿Cuál es SU tarea? (regla 1) ----
  let taskId = tareaIdDe(item, connector, byRef, current);
  if (taskId && !current.has(taskId)) {
    // No está entre las tareas de este proyecto: o se borró (se crea de nuevo) o es de otro proyecto.
    let otra = null;
    try {
      otra = await fetchAltumTask(connector, taskId);
    } catch (error) {
      if (!/HTTP 404/.test(error.message)) throw error;
    }
    if (otra?.id && otra.project_id && otra.project_id !== connector.project_id) {
      throw new NotRetryable(`${item.id} apunta a ${taskId}, que es de otro proyecto de Altum. No la toco: corrige "ext.altum" en la ficha.`);
    }
    if (otra?.id) current.set(otra.id, otra);
    else taskId = ''; // se borró en Altum: se vuelve a crear abajo
  }
  if (taskId) {
    const veredicto = esLaTareaDeLaFicha(item, current.get(taskId));
    if (!veredicto.ok) {
      throw new NotRetryable(`no escribo en esa tarea: ${veredicto.motivo}. Si el enlace "ext.altum" de la ficha está mal, quítalo y corre "asegurar".`);
    }
  }

  // Una ficha que terminó ANTES de conectar el repositorio y nunca tuvo tarea no se estrena en segundo
  // plano: al conectar un repositorio con historia, Altum se llenaba de tareas viejas. Lo que termina
  // después de conectar sí se registra. Si de verdad hace falta, "asegurar <ID>" la crea.
  const modificado = instante(item.modificado);
  if (!taskId && YA_TERMINO.has(item.stage) && !evt.forzado && modificado && modificado < desdeCuandoConectado()) return;

  // ---- Crear (una sola vez, con todo) ----
  const padre = item.parent ? tareaIdDe({ id: item.parent, external: {} }, connector, byRef, current) : '';
  const fechas = fechasDe(item);
  const ours = customFieldsFor(connector, item, fields);
  if (!taskId) {
    const creada = await createTask(connector, item, description, { assignee, email, customFields: ours, padre, sprint, fechas, evtId: evt.id });
    taskId = creada.id;
    byRef.set(item.id, taskId);
    currentFields.set(taskId, creada.custom_fields || ours);
    current.set(taskId, creada);
    recordPush(connector, creada); // es un cambio nuestro: el vigilante no debe avisarlo
    anotarEnviado(item.id, item.modificado);
  }
  const tarea = current.get(taskId);

  // ---- Cada quien trabaja lo suyo ----
  if (esAjena(tarea, yo) && !evt.forzado) {
    avisar(`la tarea #${tarea.number ?? ''} es de otra persona, no la toco. Si te toca a ti, que el líder te la asigne.`);
    return;
  }

  // ---- ¿El contenido de la ficha es más nuevo que lo que ya está en Altum? (regla 3) ----
  const contenido = contenidoMasNuevo(item, ultimoEnviado(item.id), evt.forzado ? null : tarea);
  if (!contenido) avisar('esta ficha es más vieja que lo que ya está en Altum (otra rama o un checkout atrasado): no reescribo su contenido.');

  // ---- Tarea de una reunión (Acten): solo estado, responsable, título y descripción ----
  if (esDeActen({ id: taskId, source: tarea?.source })) {
    const quiero = connector.acten_status_map?.[item.stage] || ACTEN_STATUS[item.stage];
    const desde = ACTEN_ORDEN[tarea?.state] ?? 0;
    const sube = ACTEN_STATES.includes(quiero) && quiero !== tarea?.state && (ACTEN_ORDEN[quiero] ?? 0) > desde;
    const cambios = soloCambios(tarea, {
      ...(contenido ? { title: taskTitle(item), description } : {}),
      ...(sube ? { state: quiero } : {}), ...(contenido && assignee ? { assignee_id: assignee } : {}),
    });
    const porMandar = evt.forzado ? cambios : sinLoYaRechazado(taskId, cambios);
    if (!Object.keys(porMandar).length) return;
    const actualizada = await enviarLoQueSePueda(connector, 'PATCH', `/tasks/${encodeURIComponent(taskId)}`, porMandar, {}, avisar,
      (campos, cuerpo) => anotarRechazo(taskId, campos, cuerpo));
    if (!actualizada) return;
    current.set(taskId, { ...tarea, ...porMandar, ...actualizada });
    recordPush(connector, { ...actualizada, id: taskId });
    if (contenido) anotarEnviado(item.id, item.modificado);
    return;
  }

  // ---- Tarea nativa ----
  const state = estadoQueViaja(connector, item, estados, tarea?.state || '');
  if (!state && tarea?.state) {
    const pretendido = stateFor(connector, item, estados);
    if (pretendido && pretendido !== tarea.state) avisar(`en Altum va en "${tarea.state}" y aquí se ve "${pretendido}". No la devuelvo atrás: si de verdad hay que retroceder, cámbiala en Altum.`);
  }
  const criterios = criteriosDe(item);
  const etiquetas = etiquetasPara(connector, item, tarea?.tags || []);
  const customFields = Object.keys(ours).length ? { custom_fields: { ...(currentFields.get(taskId) || {}), ...ours } } : {};
  const { started_at: _sa, completed_at: _ca, ...fechasPrevistas } = fechas;
  // La prioridad se pone al crear; después es del líder (no se le pisa la que puso en Altum).
  const cambios = soloCambios(tarea, {
    ...(contenido ? {
      title: taskTitle(item), description,
      ...(criterios ? { acceptance_criteria: criterios } : {}),
      ...(etiquetas?.length ? { tags: etiquetas } : {}),
      ...fechasPrevistas,   // start_date/due_date sí dependen del contenido; started_at/completed_at van aparte (guardia abajo)
      ...(padre ? { parent_id: padre } : {}),
      ...(assignee ? { assignee_id: assignee } : {}), ...customFields,
    } : {}),
    // Las fechas reales (empezó / terminó) salen del primer commit visto desde ESTA rama, que
    // cambia con un squash-merge o al alternar de rama: sin una guardia, cambiarse de rama movía la
    // fecha en los dos sentidos. Solo se manda si Altum no tiene una, o si la nueva es más antigua
    // (de verdad más temprana, nunca "lo que esta rama ve ahora").
    ...(fechas.started_at && (!tarea?.started_at || instante(fechas.started_at) < instante(tarea.started_at)) ? { started_at: fechas.started_at } : {}),
    ...(fechas.completed_at && (!tarea?.completed_at || instante(fechas.completed_at) < instante(tarea.completed_at)) ? { completed_at: fechas.completed_at } : {}),
    ...(state ? { state } : {}),
  });
  // Lo que Altum ya rechazó para esta tarea no se vuelve a mandar (gastaba una petición y un aviso en
  // cada sincronización). Si una persona lo pide a mano (asegurar), se reintenta.
  const porMandar = evt.forzado ? cambios : sinLoYaRechazado(taskId, cambios);
  if (item.blockers?.length) await declararBloqueadores(connector, taskId, item, byRef, (id) => tareaIdDe({ id, external: {} }, connector, byRef, current));
  if (!Object.keys(porMandar).length) return; // nada cambió: la tarea no se toca
  let recortado = false;
  const updated = await enviarLoQueSePueda(connector, 'PATCH', `/tasks/${taskId}`, porMandar, {}, (motivo) => { recortado = true; avisar(motivo); },
    (campos, cuerpo) => anotarRechazo(taskId, campos, cuerpo));
  if (!updated) return; // todo lo que había que mandar era de planear y lo pone el líder
  if (updated.custom_fields) currentFields.set(taskId, updated.custom_fields);
  current.set(taskId, { ...tarea, ...porMandar, ...updated });
  recordPush(connector, { ...updated, id: taskId });
  if (contenido && !recortado) anotarEnviado(item.id, item.modificado);
}

// Altum IGNORA el filtro external_ref en GET /tasks: devuelve TODAS las tareas del proyecto. Tomar
// la primera enlazaba la ficha a una tarea ajena y el siguiente PATCH la sobrescribía (pasó en Mi
// Boleta: varias fichas quedaron apuntando a una tarea de reunión, que terminó con otro título,
// otro estado y otro responsable). Aquí se exige coincidencia EXACTA, y nunca una tarea de reunión:
// esas no llevan external_ref, así que jamás son la tarea de una ficha.
export async function tareaDeLaFicha(connector, externalRef) {
  if (!externalRef) return null;
  const { items } = await listTasks(connector, { project_id: connector.project_id, external_ref: externalRef });
  return items.find((t) => t.external_ref === externalRef && !esDeActen(t)) || null;
}

// POST con external_ref (enlace firme) e Idempotency-Key (un reintento por corte de red no duplica).
// Responsable: el UUID de assignee_map o, si no está, el correo de git (assignee_email); si ese correo
// no existe en la empresa (404), la tarea se crea sin responsable. Si external_ref ya existe (409), se reutiliza.
// Devuelve la tarea creada (o la existente).
async function createTask(connector, item, description, { assignee, email, customFields, padre = '', sprint = '', fechas = {}, evtId = '' }) {
  const body = {
    project_id: connector.project_id,
    title: taskTitle(item),
    kind: connector.kind_map?.[item.type] || DEFAULT_KIND[item.type],
    description,
    ...(criteriosDe(item) ? { acceptance_criteria: criteriosDe(item) } : {}),
    priority: priorityOf(item),
    ...(etiquetasPara(connector, item)?.length ? { tags: etiquetasPara(connector, item) } : {}),
    external_ref: item.id,
    ...(Object.keys(customFields).length ? { custom_fields: customFields } : {}),
    ...fechas,
    ...(padre ? { parent_id: padre } : {}),
    ...(sprint ? { sprint_id: sprint } : {}),
    ...(assignee ? { assignee_id: assignee } : email ? { assignee_email: email } : {}),
  };
  // La clave de idempotencia es la del EVENTO: si la red corta y se reintenta el mismo evento, Altum
  // devuelve la misma tarea; pero si la tarea se borró y la ficha vuelve a cambiar, el evento es otro
  // y se crea de nuevo (con la misma clave, Altum devolvería la tarea borrada).
  const clave = `sn-${connector.project_id}-${item.id}-${createHash('sha256').update(String(evtId || item.recrear || 'x')).digest('hex').slice(0, 16)}`;
  const crear = (cuerpo, sufijo = '') => enviarLoQueSePueda(connector, 'POST', '/tasks', cuerpo, { 'Idempotency-Key': `${clave}${sufijo}` },
    (motivo) => console.log(`[altum] ${item.id}: ${motivo}`));
  try {
    return await crear(body);
  } catch (error) {
    if (error.status === 409) {
      // 409 = "ese external_ref ya existe": la tarea está, hay que encontrar LA suya, no una cualquiera.
      const suya = await tareaDeLaFicha(connector, item.id);
      if (suya) return suya;
      throw new NotRetryable(`Altum dice que ya existe una tarea para ${item.id}, pero no aparece ninguna con ese enlace.`
        + ' No enlazo el ítem a otra tarea para no pisarla: búscala en Altum y enlázala a mano con "link", o quita el external_ref allá.', 409);
    }
    if (body.assignee_email && /HTTP 404/.test(error.message)) {
      const { assignee_email: _, ...sinResponsable } = body;
      return crear(sinResponsable, '-sin-responsable');
    }
    throw error;
  }
}

// Para quien reciba los webhooks de Altum (n8n, función serverless…): firma = HMAC-SHA256(secreto, "{timestamp}." + cuerpo).
export function verifyAltumSignature({ secret, timestamp, signature, rawBody, now = Date.now() / 1000 }) {
  if (!secret || !timestamp || !signature) return false;
  if (!Number.isFinite(Number(timestamp)) || !Number.isFinite(now) || Math.abs(now - Number(timestamp)) > MAX_SIGNATURE_AGE_S) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  const received = String(signature).replace(/^sha256=/, '');
  return expected.length === received.length && timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

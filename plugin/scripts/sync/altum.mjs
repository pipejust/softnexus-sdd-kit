// Conector nativo "altum" — API de tareas de Altum (contrato en references/integraciones.md §7d).
//   Repo -> Altum : crea la tarea (POST /tasks) y luego la actualiza (PATCH /tasks/{id}).
//   Altum -> Repo : ver altum-backlog.mjs (proyectos, tareas existentes, importar).
//   Firma de webhooks de Altum: verifyAltumSignature() para el receptor (n8n u otro).
// Una clave por empresa (X-API-Key); el resto del contrato es igual para todas.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { findMark, itemPlainBody } from './body.mjs';
import { setExternalId } from './items.mjs';
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
const TIMEOUT_MS = 10000;
const PAGE_LIMIT = 200; // máximo que acepta GET /tasks
const MAX_SIGNATURE_AGE_S = 300;

// Etapa Softnexus -> estado Altum por defecto (sobrescribible con "status_map").
const DEFAULT_STATUS = {
  triaged: 'new', ready: 'new', planning: 'active', plan_written: 'active', plan_approved: 'active',
  building: 'active', built: 'active', verified: 'active', in_review: 'active', merged: 'resolved', done: 'closed',
};
// Tipo de ítem -> kind de Altum (epica|feature|historia|requerimiento|tarea|bug|pendiente).
const DEFAULT_KIND = { feature: 'historia', improvement: 'requerimiento', bug: 'bug', incident: 'bug', content: 'tarea', chore: 'tarea' };
export const KIND_TO_TYPE = { epica: 'feature', feature: 'feature', historia: 'feature', requerimiento: 'improvement', tarea: 'chore', bug: 'bug', pendiente: 'chore' };

// Error que no se debe reintentar (reglas de negocio de Altum: 409 bloqueadores o duplicado, 422 dato no válido).
export class NotRetryable extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
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
function key(connector) {
  const name = connector.key_env || 'SN_ALTUM_KEY';
  if (!process.env[name]) throw new Error(`falta la clave de Altum en la variable ${name}: guárdala con "bash scripts/sn/sn-clave-altum.sh" (una sola vez, sirve para todos tus proyectos)`);
  return process.env[name];
}

export async function api(connector, method, route, body, headers = {}) {
  const base = (connector.base_url || process.env.SN_ALTUM_BASE_URL || DEFAULT_BASE).replace(/\/$/, '');
  const response = await fetch(`${base}${route}`, {
    method,
    headers: { 'X-API-Key': key(connector), 'Content-Type': 'application/json', Accept: 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 409 || response.status === 422) {
    const text = await response.text();
    let detail = null;
    try { detail = JSON.parse(text); } catch { /* cuerpo no JSON */ }
    const message = blockersMessage(detail)
      || `Altum rechazó el cambio (HTTP ${response.status}${response.status === 422 ? ', estado o campo no válido en ese proyecto' : ''}): ${(detail?.error || text).slice(0, 200)}`;
    throw new NotRetryable(message, response.status);
  }
  if (response.status === 429) throw new Error(`Altum: límite de peticiones (reintentar en ${response.headers.get('retry-after') || '?'} s)`);
  const reasons = {
    401: 'clave de API inválida (revisa la variable de la clave)',
    403: 'la clave no tiene permiso: revisa que tenga tasks:read / tasks:write y, si es personal, que estés asignado a ese proyecto',
    404: 'no existe: revisa project_id o la URL base',
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
  if (!fresh && cached && Date.now() - cached.at < STATES_TTL_MS) return cached.value;
  const value = await fetchProjectStates(connector);
  writeState(STATES_FILE, { ...readState(STATES_FILE, {}), [connector.project_id]: { at: Date.now(), value } });
  return value;
}

async function fetchProjectStates(connector) {
  const list = await api(connector, 'GET', `/projects/${connector.project_id}/config/estados`);
  return {
    valid: list.map((s) => s.key),
    done: list.filter((s) => ['done', 'cancelled'].includes(s.kind)).map((s) => s.key),
  };
}

// Campos propios del proyecto (GET /config/campos). Se envían solo los que el proyecto definió, de tipo
// texto o lista, y con un valor permitido. Por defecto: riesgo, tamaño y etapa (cambiable con "field_map").
const DEFAULT_FIELDS = { risk: 'riesgo', size: 'tamano', stage_label: 'etapa' };

async function projectFields(connector) {
  try {
    return await api(connector, 'GET', `/projects/${connector.project_id}/config/campos`);
  } catch (error) {
    if (/HTTP 404/.test(error.message)) return [];
    throw error;
  }
}

export function customFieldsFor(connector, item, fields) {
  const defs = new Map(fields.map((f) => [f.key, f]));
  const allowed = (def, value) => def && value && (def.field_type === 'text' || (def.field_type === 'select' && def.options?.includes(value)));
  return Object.fromEntries(Object.entries(connector.field_map || DEFAULT_FIELDS)
    .filter(([source, key]) => allowed(defs.get(key), item[source]))
    .map(([source, key]) => [key, item[source]]));
}

// Una lectura por ejecución: estados válidos del proyecto y tareas ya enlazadas.
// El enlace firme es external_ref (= id del ítem); la marca oculta en la descripción queda para tareas viejas.
const runCache = new Map();
async function projectContext(connector) {
  if (runCache.has(connector.name)) return runCache.get(connector.name);
  const [{ valid }, fields, { items }] = await Promise.all([
    projectStates(connector, { fresh: true }),
    projectFields(connector),
    listTasks(connector, { project_id: connector.project_id }),
  ]);
  const byRef = new Map(items.map((t) => [t.external_ref || findMark(t.description), t.id]).filter(([id]) => id));
  // En un PATCH, custom_fields REEMPLAZA el objeto: se guarda lo que ya tiene cada tarea para mezclarlo.
  const currentFields = new Map(items.map((t) => [t.id, t.custom_fields || {}]));
  const context = { validStates: valid, fields, byRef, currentFields };
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

function stateFor(connector, item, validStates) {
  const wanted = connector.status_map?.[item.stage] || DEFAULT_STATUS[item.stage];
  return validStates.includes(wanted) ? wanted : null; // estado no válido en ese proyecto: no se envía
}

export async function deliverAltum(connector, evt) {
  if (!connector.project_id) throw new NotRetryable('falta "project_id" (UUID del proyecto en Altum) en el conector');
  if (evt.type === 'sn.test') {
    await projectContext(connector);
    return;
  }
  const { item } = evt;
  const { validStates, fields, byRef, currentFields } = await projectContext(connector);
  const description = itemPlainBody(evt);
  const email = item.assignee.match(/<([^>]+@[^>]+)>/)?.[1] || '';
  const assignee = connector.assignee_map?.[email || item.assignee];
  const ours = customFieldsFor(connector, item, fields);
  let taskId = item.external?.[connector.name] || byRef.get(item.id);
  if (!taskId) {
    const created = await createTask(connector, item, description, { assignee, email, customFields: ours });
    taskId = created.id;
    byRef.set(item.id, taskId);
    currentFields.set(taskId, created.custom_fields || ours);
    if (item.file) setExternalId(item.file, connector.name, taskId); // queda en el repo con el siguiente commit
  }
  const state = stateFor(connector, item, validStates);
  const customFields = Object.keys(ours).length ? { custom_fields: { ...(currentFields.get(taskId) || {}), ...ours } } : {};
  const updated = await api(connector, 'PATCH', `/tasks/${taskId}`, {
    title: taskTitle(item), description, priority: priorityOf(item),
    ...(state ? { state } : {}), ...(assignee ? { assignee_id: assignee } : {}), ...customFields,
  });
  if (updated?.custom_fields) currentFields.set(taskId, updated.custom_fields);
  recordPush(connector, { ...updated, id: taskId });
}

// POST con external_ref (enlace firme) e Idempotency-Key (un reintento por corte de red no duplica).
// Responsable: el UUID de assignee_map o, si no está, el correo de git (assignee_email); si ese correo
// no existe en la empresa (404), la tarea se crea sin responsable. Si external_ref ya existe (409), se reutiliza.
// Devuelve la tarea creada (o la existente).
async function createTask(connector, item, description, { assignee, email, customFields }) {
  const body = {
    project_id: connector.project_id,
    title: taskTitle(item),
    kind: connector.kind_map?.[item.type] || DEFAULT_KIND[item.type],
    description,
    priority: priorityOf(item),
    external_ref: item.id,
    ...(Object.keys(customFields).length ? { custom_fields: customFields } : {}),
    ...(assignee ? { assignee_id: assignee } : email ? { assignee_email: email } : {}),
  };
  const headers = { 'Idempotency-Key': `sn-${connector.project_id}-${item.id}` };
  try {
    return await api(connector, 'POST', '/tasks', body, headers);
  } catch (error) {
    if (error.status === 409) {
      const { items } = await listTasks(connector, { project_id: connector.project_id, external_ref: item.id });
      if (items[0]) return items[0];
    }
    if (body.assignee_email && /HTTP 404/.test(error.message)) {
      const { assignee_email: _, ...withoutAssignee } = body;
      return api(connector, 'POST', '/tasks', withoutAssignee, { 'Idempotency-Key': `${headers['Idempotency-Key']}-sin-responsable` });
    }
    throw error;
  }
}

// Para quien reciba los webhooks de Altum (n8n, función serverless…): firma = HMAC-SHA256(secreto, "{timestamp}." + cuerpo).
export function verifyAltumSignature({ secret, timestamp, signature, rawBody, now = Date.now() / 1000 }) {
  if (!secret || !timestamp || !signature) return false;
  if (Math.abs(now - Number(timestamp)) > MAX_SIGNATURE_AGE_S) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex');
  const received = String(signature).replace(/^sha256=/, '');
  return expected.length === received.length && timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}

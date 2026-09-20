// Lectura de Altum: proyectos de la empresa, tareas que ya existen en el proyecto elegido e importación.
// Un repositorio de código = un proyecto de Altum de una empresa (la clave X-API-Key dice cuál empresa).
import { findMark } from './body.mjs';
import { api, KIND_TO_TYPE, listTasks, projectStates } from './altum.mjs';
import { projectKey } from './altum-clone.mjs';
import { readItems } from './items.mjs';

// Proyectos que ve la clave: id, clave corta (para escribirla), nombre, cliente, estado, integrantes
// y el repositorio registrado en Altum (repo_url), que es de donde se clona.
export function toProject(p) {
  return {
    id: p.id, key: projectKey(p.name), name: p.name || '', client: p.client_name || '',
    status: p.status || '', members: p.members?.length ?? null, repo: p.repo_url || '',
  };
}

// Altum devuelve { items, total }; se acepta también una lista suelta por si cambia.
export async function listProjects(connector) {
  const raw = await api(connector, 'GET', '/projects');
  return (Array.isArray(raw) ? raw : raw?.items || []).map(toProject);
}

// Quién es la clave (GET /me): persona o empresa, a qué empresa pertenece y qué proyectos tiene asignados.
// null si Altum todavía no expone /me (la clave funciona igual).
export async function whoAmI(connector) {
  try {
    return await api(connector, 'GET', '/me');
  } catch (error) {
    if (/HTTP 404/.test(error.message)) return null;
    throw error;
  }
}

export function whoAmIText(me, projectId) {
  if (!me) return 'Altum todavía no dice de quién es la clave (falta GET /me, pedido F). La conexión funciona igual.\n';
  const who = me.user ? `Clave personal de ${me.user.name || ''} <${me.user.email || '?'}>` : `Clave de la empresa (${me.key?.name || 'CI / servidores'})`;
  const projects = me.projects || [];
  const lines = projects.map((p) => `  ${projectKey(p.name).padEnd(22)} ${p.name || ''}${p.client_name ? `  · cliente: ${p.client_name}` : ''}${p.is_lead ? '  [líder]' : ''}${p.repo_url ? '' : '  (sin repositorio en Altum)'}`);
  const here = !projectId ? 'Este repositorio todavía no está unido a un proyecto: dile "conecta este proyecto con Altum" (/sn-connect).' : projects.some((p) => p.id === projectId)
    ? `Este repositorio: proyecto ${projectId} — asignado.`
    : `Este repositorio: proyecto ${projectId} — NO estás asignado. Pide al líder del proyecto en Altum que te agregue.`;
  return `${who}\nEmpresa: ${me.company?.name || '?'}${me.company?.slug ? ` (${me.company.slug})` : ''}\n`
    + `${me.user ? 'Proyectos asignados' : 'Proyectos de la empresa'} (${projects.length}) — escribe la clave de la izquierda:\n${lines.join('\n')}\n${here ? `\n${here}\n` : ''}`;
}

function linkedIndex(connector, root) {
  const index = new Map();
  for (const item of readItems(root)) {
    if (item.external?.[connector.name]) index.set(item.external[connector.name], item);
    index.set(item.id, item);
  }
  return index;
}

function importable(connector, task) {
  return {
    id: `ALT-${task.number ?? task.id.slice(0, 8)}`,
    type: KIND_TO_TYPE[task.kind] || 'feature',
    title: String(task.title || '').replace(/^(\[[^\]]+\]\s*)+/, ''),
    story: task.description || '',
    origin: 'altum',
    created: task.created_at || new Date().toISOString(),
    external: { [connector.name]: task.id },
  };
}

// Foto de las tareas del proyecto cruzada con el repositorio: qué está pendiente y si ya está enlazado.
// Con "since" (pull y vigilante) también trae las borradas en Altum (deleted: true) para avisar.
export async function readBacklog(connector, root = '.', since = '') {
  const [{ items, deleted }, { done }] = await Promise.all([
    listTasks(connector, { project_id: connector.project_id, updated_since: since, include_deleted: since ? 'true' : '' }),
    projectStates(connector),
  ]);
  const linked = linkedIndex(connector, root);
  const itemFor = (task) => linked.get(task.id) || linked.get(task.external_ref) || linked.get(findMark(task.description));
  const rows = items.map((task) => ({
    altum_id: task.id, number: task.number, kind: task.kind, title: task.title, state: task.state,
    priority: task.priority, assignee_id: task.assignee_id, target_date: task.target_date || null,
    open: !done.includes(task.state), deleted: false, item: itemFor(task)?.id || '', task,
  }));
  const gone = deleted.filter((d) => d.project_id === connector.project_id).map((d) => ({
    altum_id: d.id, number: d.number, kind: '', title: d.title, state: 'borrada', priority: null, assignee_id: null,
    target_date: null, open: false, deleted: true, item: linked.get(d.id)?.id || '',
    task: { ...d, updated_at: d.deleted_at, updated_by: null },
  }));
  return [...rows, ...gone].sort((a, b) => Number(b.open) - Number(a.open) || (a.priority ?? 9) - (b.priority ?? 9));
}

// Altum -> repo. Solo tareas ABIERTAS sin enlazar se importan (las terminadas son historia, no trabajo).
export async function pullAltum(connector, since, root = '.', { includeClosed = false } = {}) {
  const backlog = await readBacklog(connector, root, since);
  const live = backlog.filter((b) => !b.deleted);
  const created = live.filter((b) => !b.item && (b.open || includeClosed)).map((b) => importable(connector, b.task));
  const changed = live.filter((b) => b.item).map((b) => ({ id: b.item, altum_id: b.altum_id, state: b.state, title: b.title, priority: b.priority }));
  const deleted = backlog.filter((b) => b.deleted && b.item).map((b) => ({ id: b.item, altum_id: b.altum_id, number: b.number, title: b.title }));
  return { created, changed, deleted, checked: live.length, skippedClosed: live.filter((b) => !b.item && !b.open && !includeClosed).length };
}

export function fetchAltumTask(connector, taskId) {
  return api(connector, 'GET', `/tasks/${encodeURIComponent(taskId)}`);
}

export function backlogMarkdown(backlog, { all = false } = {}) {
  const rows = backlog.filter((b) => all || b.open);
  if (!rows.length) return 'No hay tareas pendientes en el proyecto de Altum.\n';
  const open = backlog.filter((b) => b.open).length;
  const unlinked = backlog.filter((b) => b.open && !b.item).length;
  const lines = rows.map((b) => `| ${b.number ?? '—'} | ${b.kind} | ${b.title.replace(/\|/g, '\\|')} | ${b.state} | ${b.priority ?? '—'} | ${b.target_date || '—'} | ${b.item || 'sin traer'} |`);
  return `# Tareas en Altum (${open} pendientes · ${unlinked} sin traer al proyecto)\n\n`
    + '| # | Tipo | Título | Estado | Prioridad | Fecha objetivo | Ítem en el repo |\n|---|---|---|---|---|---|---|\n'
    + `${lines.join('\n')}\n`;
}

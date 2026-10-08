// Altum falso según el contrato actualizado: X-API-Key, /projects, estados con kind, paginación (aquí 2 por
// página para ejercitarla), external_ref, Idempotency-Key, assignee_email, updated_by, include_deleted,
// 409 con bloqueadores o por external_ref repetido, 422 por estado no válido.
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import http from 'node:http';

const PORT = Number(process.argv[2] || 4598);
const LOG = process.argv[3] || 'altum.jsonl';
const KEY = 'sk_live_test_empresa_a';
const KEY_ID = 'aaaaaaaa-0000-0000-0000-00000000000a';
// Clave personal (pedido F): dice quién es y solo ve los proyectos asignados a esa persona.
const USER_KEY = 'sk_user_test_laura';
const LAURA = { id: 'user-laura', email: 'laura@x', name: 'Laura Gómez' };
const PROJECT = '11111111-1111-1111-1111-111111111111';
const OTHER = '22222222-2222-2222-2222-222222222222';
const MOCK_PAGE = 2;
const USERS = { 'laura@x': 'e2' };   // correo -> employee_id (así identifica Altum al responsable)
const STATES = [
  { key: 'new', label: 'Nuevo', kind: 'open', position: 0 },
  { key: 'en_desarrollo', label: 'En desarrollo', kind: 'in_progress', position: 10 },
  { key: 'en_revision', label: 'En revisión', kind: 'in_progress', position: 20 },
  { key: 'resolved', label: 'Resuelto', kind: 'done', position: 30 },
  { key: 'closed', label: 'Cerrado', kind: 'done', position: 40 },
];
const FIELDS = [
  { key: 'riesgo', label: 'Riesgo', field_type: 'select', options: ['R0', 'R1', 'R2', 'R3', 'R4'], required: false, position: 0 },
  { key: 'tamano', label: 'Tamaño', field_type: 'select', options: ['XS', 'S', 'M', 'L'], required: false, position: 1 },
  { key: 'cliente_final', label: 'Cliente final', field_type: 'text', required: false, position: 2 },
  { key: 'fecha_inicio', label: 'Inicio previsto', field_type: 'date', required: false, position: 3 },
  { key: 'fecha_fin', label: 'Entrega prevista', field_type: 'date', required: false, position: 4 },
  { key: 'inicio_real', label: 'Empezó', field_type: 'date', required: false, position: 5 },
  { key: 'fin_real', label: 'Terminó', field_type: 'date', required: false, position: 6 },
];
const BLOCKED_TITLE = 'bloqueada';
// custom_fields se valida contra FIELDS (tipo y opciones), como en Altum.
const badField = (cf = {}) => Object.entries(cf).find(([k, v]) => {
  const def = FIELDS.find((f) => f.key === k);
  if (def && def.field_type === 'date') return !/^\d{4}-\d{2}-\d{2}$/.test(String(v));
  return def && def.field_type === 'select' && !def.options.includes(v);
});
const now = () => new Date().toISOString();
const manual = (t) => ({ tags: [], external_ref: null, custom_fields: {}, updated_by: null, assignee_id: null,
  start_date: null, due_date: null, started_at: null, completed_at: null, parent_id: null, sprint_id: null, ...t });
const tasks = [
  manual({ id: randomUUID(), project_id: PROJECT, number: 77, kind: 'requerimiento', title: 'Exportar clientes a Excel (creada a mano)', description: 'El cliente pidió exportar.', state: 'new', priority: 2, created_at: '2026-09-19T08:00:00Z', updated_at: '2026-09-19T08:00:00Z' }),
  manual({ id: randomUUID(), project_id: PROJECT, number: 79, kind: 'historia', title: 'Filtrar ventas por fecha (criterios-html)', description: 'Pedido del cliente.', acceptance_criteria: '<ul><li><strong>Dado</strong> un rango de fechas, cuando filtro, entonces veo solo esas ventas</li><li>Sin resultados muestra &quot;Nada en ese rango&quot;</li></ul>', state: 'new', priority: 2, created_at: '2026-09-19T08:05:00Z', updated_at: '2026-09-19T08:05:00Z' }),
  manual({ id: randomUUID(), project_id: PROJECT, number: 78, kind: 'tarea', title: 'Migrar servidor viejo (ya cerrada)', description: '', state: 'closed', priority: 3, created_at: '2026-08-01T08:00:00Z', updated_at: '2026-08-02T08:00:00Z' }),
  manual({ id: randomUUID(), project_id: OTHER, number: 5, kind: 'historia', title: 'Portal de facturación (otro proyecto)', description: '', state: 'new', priority: 2, created_at: '2026-09-01T08:00:00Z', updated_at: '2026-09-01T08:00:00Z' }),
];
// Tarea nacida en una reunión de Acten: llega mezclada, ya con updated_at (sin zona, como la API real)
// y con los estados fijos de Acten (pending|blocked|done|cancelled), no los del proyecto.
const ACTEN_STATES = ['pending', 'blocked', 'done', 'cancelled'];
const ACTEN_EDITABLES = ['state', 'assignee_id', 'assignee_email', 'title', 'description'];
const acten = {
  id: 'acten:abc123', project_id: PROJECT, source: 'acten', kind: 'acten-tarea', title: 'Acuerdo de la reunión del lunes',
  state: 'pending', assignee_id: null, due_date: null, number: null, description: null, priority: null, tags: null,
  external_ref: null, custom_fields: {}, updated_by: null, created_at: null, updated_at: '2026-09-19T09:00:00.123456',
};
const deleted = [];
const repos = {};   // repo_url registrado con PUT /projects/{id}/repo
// Lista de repositorios por proyecto (un proyecto puede tener varios): POST/GET /projects/{id}/repos
const listaRepos = { p5: [{ provider: 'github', repo: 'empresa/app' }], p4: [{ provider: 'github', repo: 'empresa/app' }, { provider: 'github', repo: 'empresa/web' }, { provider: 'azure_devops', repo: 'miorg/Mi Proyecto/consola' }] };
// Azure DevOps mete un nivel más: "org/proyecto/repo" -> https://dev.azure.com/org/proyecto/_git/repo
const conUrl = (r) => {
  if (r.provider !== 'azure_devops') return { ...r, url: `https://github.com/${r.repo}` };
  const [org, ...resto] = r.repo.split('/');
  const nombre = resto.pop();
  return { ...r, url: `https://dev.azure.com/${encodeURIComponent(org)}/${resto.map(encodeURIComponent).join('/')}/_git/${encodeURIComponent(nombre)}` };
};
const SPRINTS = [
  { id: 'sp-1', name: 'Sprint 1', goal: 'Entregar el login', starts_on: '2026-10-05', ends_on: '2026-10-16', state: 'active' },
  { id: 'sp-0', name: 'Sprint 0', goal: 'Arranque', starts_on: '2026-09-21', ends_on: '2026-10-02', state: 'closed' },
];
const esFechaSola = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v));
const esFechaHora = (v) => !Number.isNaN(Date.parse(String(v)));
// Lo que Altum rechaza con 422 en los campos nuevos.
function malDato(data) {
  for (const k of ['start_date', 'due_date']) if (data[k] != null && !esFechaSola(data[k])) return `${k} tiene que ser AAAA-MM-DD`;
  for (const k of ['started_at', 'completed_at']) if (data[k] != null && !esFechaHora(data[k])) return `${k} tiene que ser una fecha-hora ISO`;
  if (data.sprint_id && !SPRINTS.some((sp) => sp.id === data.sprint_id)) return 'ese sprint no es de este proyecto';
  if (data.parent_id && !tasks.some((t) => t.id === data.parent_id)) return 'el padre no es de este proyecto';
  return '';
}
// Permisos del 6-oct: con PERMISOS=lider la clave personal puede planear; si no, 403 con los campos.
const CAMPOS_DE_PLANEACION = ['start_date', 'due_date', 'started_at', 'completed_at', 'parent_id', 'sprint_id', 'priority', 'assignee_id'];
const E1 = 'e1';            // Marta Ríos (líder)
const E2 = 'e2';            // Laura Gómez
let permisos = process.env.MOCK_PERMISOS || 'lider';   // se cambia en caliente con /_permisos
const planearProhibido = (data) => (permisos === 'no-lider'
  ? CAMPOS_DE_PLANEACION.filter((k) => data[k] !== undefined) : []);
const dependencias = new Map(); // tarea -> [ids que la bloquean]
let forzar409 = '';
const idempotent = new Map();
let number = 100;

const send = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
const findBy = (url) => tasks.find((t) => t.external_ref === url.searchParams.get('ref') || String(t.number) === url.searchParams.get('number')) || tasks[0];

http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const url = new URL(req.url, 'http://x');
    appendFileSync(LOG, `${JSON.stringify({ method: req.method, path: url.pathname, query: url.search, key: req.headers['x-api-key'], idem: req.headers['idempotency-key'] || null, cliente: req.headers['x-client-name'] || null, body: body ? JSON.parse(body) : null })}\n`);
    // Rutas de control de la prueba (simulan a una persona usando Altum a mano).
    if (url.pathname === '/_state') return send(res, 200, tasks);
    // Quien usa la clave lidera el proyecto o no: cambia qué puede planear (contrato del 6-oct).
    if (url.pathname === '/_permisos') { permisos = url.searchParams.get('modo') || 'lider'; return send(res, 200, { permisos }); }
    if (url.pathname === '/_create') {
      const t = manual({ id: randomUUID(), project_id: PROJECT, number: (number += 1), kind: 'bug', title: 'Error en login (creada a mano)', description: '', state: 'new', priority: 1, created_at: now(), updated_at: now() });
      tasks.push(t); return send(res, 200, t);
    }
    if (url.pathname === '/_edit') { Object.assign(findBy(url), { state: 'en_revision', updated_at: now(), updated_by: null }); return send(res, 200, {}); }
    if (url.pathname === '/_setfield') { const t = findBy(url); t.custom_fields = { ...t.custom_fields, cliente_final: 'Almacenes Éxito' }; t.updated_at = now(); t.updated_by = null; return send(res, 200, {}); }
    // Alguien le pone una etiqueta a mano dentro de Altum (no debe perderse al sincronizar).
    if (url.pathname === '/_tag') { const t = findBy(url); t.tags = [...(t.tags || []), url.searchParams.get('tag')]; t.updated_at = now(); t.updated_by = null; return send(res, 200, t.tags); }
    // Cuántos PATCH ha recibido esa tarea: sirve para comprobar que no se reescribe lo mismo.
    if (url.pathname === '/_patches') {
      const t = findBy(url);
      const n = readFileSync(LOG, 'utf8').split('\n').filter(Boolean)
        .filter((l) => { const e = JSON.parse(l); return e.method === 'PATCH' && e.path === `/api/v1/api/tasks/${t.id}`; }).length;
      return send(res, 200, { patches: n });
    }
    // Forzar el 409 "ese external_ref ya existe" aunque no exista: es lo que pasó en producción.
    if (url.pathname === '/_409') { forzar409 = url.searchParams.get('ref') || ''; return send(res, 200, { forzar409 }); }
    if (url.pathname === '/_stripmark') { tasks.forEach((t) => { t.description = String(t.description || '').replace(/<!--[^>]*-->/g, ''); }); return send(res, 200, {}); }
    // --- Azure DevOps (mismo servidor falso): PR de ramas y sus aprobaciones ---
    const az = url.pathname.match(/^\/([^/]+)\/([^/]+)\/_apis\/git\/repositories\/([^/]+)\/pullrequests(?:\/(\d+))?$/);
    if (az) {
      if (!String(req.headers.authorization || '').startsWith('Basic ')) return send(res, 401, {});
      const prs = [
        { pullRequestId: 41, status: 'completed', sourceRefName: 'refs/heads/feat/CLI-0020-azure', createdBy: { uniqueName: 'laura@softnexus.co' },
          reviewers: [{ uniqueName: 'marta@softnexus.co', displayName: 'Marta Ríos', vote: 10 }] },
        { pullRequestId: 42, status: 'active', sourceRefName: 'refs/heads/feat/otro', createdBy: { uniqueName: 'laura@softnexus.co' },
          reviewers: [{ uniqueName: 'pedro@softnexus.co', displayName: 'Pedro', vote: 10 }] },
      ];
      if (az[4]) return send(res, 200, prs.find((p) => String(p.pullRequestId) === az[4]) || {});
      const rama = url.searchParams.get('searchCriteria.sourceRefName');
      return send(res, 200, { value: prs.filter((p) => !rama || p.sourceRefName === rama) });
    }
    if (url.pathname === '/_delete') {
      const t = findBy(url); tasks.splice(tasks.indexOf(t), 1);
      deleted.push({ id: t.id, project_id: t.project_id, number: t.number, title: t.title, deleted_at: now() });
      return send(res, 200, {});
    }
    const apiKey = req.headers['x-api-key'];
    if (apiKey !== KEY && apiKey !== USER_KEY) return send(res, 401, { error: 'clave inválida' });
    const personal = apiKey === USER_KEY;
    const allowed = (pid) => !personal || pid === PROJECT || pid === 'p3' || pid === 'p4';
    const author = personal ? { type: 'user', id: LAURA.id } : { type: 'api_key', id: KEY_ID };
    const base = url.pathname.replace(/^\/api\/v1\/api/, '');
    if (req.method === 'GET' && base === '/me') {
      const projects = [{ id: PROJECT, name: 'Clientes', client_name: 'Almacenes Éxito', role: 'dev', is_lead: personal }, ...(personal ? [] : [{ id: OTHER, name: 'Facturación', client_name: 'Interno' }])];
      return send(res, 200, { key: { id: personal ? 'key-laura' : KEY_ID, type: personal ? 'user' : 'company', name: personal ? 'Portátil de Laura' : 'CI', scopes: personal ? ['tasks:read', 'tasks:write', 'projects:read', 'projects:write'] : ['tasks:read', 'tasks:write', 'projects:read'] }, company: { id: 'c1', slug: 'softnexus', name: 'Softnexus' }, user: personal ? { ...LAURA, emails: [LAURA.email, 'laura.personal@gmail.com'], github_username: 'lauragomez' } : null, projects });
    }
    const pidOf = () => base.match(/^\/projects\/([^/]+)\//)?.[1] || url.searchParams.get('project_id') || (body ? JSON.parse(body).project_id : null) || tasks.find((t) => base === `/tasks/${t.id}`)?.project_id;
    if (pidOf() && !allowed(pidOf())) return send(res, 403, { detail: { error: 'No estás asignado a este proyecto' } });
    if (req.method === 'GET' && base === `/projects/${PROJECT}/config/estados`) return send(res, 200, STATES);
    if (req.method === 'GET' && base === `/projects/${PROJECT}/config/campos`) return send(res, 200, FIELDS);
    const repoDe = { [PROJECT]: process.env.MOCK_REPO || '', p3: null, p4: null, [OTHER]: null };
    const variosRepos = base.match(/^\/projects\/([^/]+)\/repos$/);
    if (req.method === 'GET' && variosRepos) return send(res, 200, (listaRepos[variosRepos[1]] || []).map(conUrl));
    if (req.method === 'POST' && variosRepos) {
      if (!personal) return send(res, 403, { error: 'la clave no tiene projects:write' });
      const data = JSON.parse(body);
      const actuales = listaRepos[variosRepos[1]] || (listaRepos[variosRepos[1]] = []);
      if (data.provider === 'azure_devops' && String(data.repo || '').split('/').length !== 3) return send(res, 422, { error: 'con azure_devops el repositorio es "organizacion/proyecto/repositorio"' });
      if (actuales.some((r) => r.provider === (data.provider || 'github') && r.repo === data.repo)) return send(res, 409, { error: 'ese repositorio ya está en el proyecto' });
      actuales.push({ provider: data.provider || 'github', repo: data.repo });
      return send(res, 201, conUrl(actuales[actuales.length - 1]));
    }
    if (req.method === 'DELETE' && variosRepos) {
      if (!personal) return send(res, 403, { error: 'la clave no tiene projects:write' });
      const data = JSON.parse(body);
      const actuales = listaRepos[variosRepos[1]] || [];
      const i = actuales.findIndex((r) => r.provider === (data.provider || 'github') && r.repo === data.repo);
      if (i < 0) return send(res, 404, { error: 'Ese repositorio no está registrado en este proyecto' });
      actuales.splice(i, 1);
      res.writeHead(204); return res.end();
    }
    const ponerRepo = base.match(/^\/projects\/([^/]+)\/repo$/);
    if (req.method === 'PUT' && ponerRepo) {
      if (!personal) return send(res, 403, { error: 'la clave no tiene projects:write' });
      repos[ponerRepo[1]] = JSON.parse(body).repo_url;
      return send(res, 200, { id: ponerRepo[1], repo_url: repos[ponerRepo[1]] });
    }
    if (req.method === 'GET' && base === '/projects') {
      const page = Number(url.searchParams.get('page') || 1);
      const limit = Math.min(Number(url.searchParams.get('limit') || 50), MOCK_PAGE);
      const todos = [
        { id: PROJECT, name: 'Clientes', client_name: 'Almacenes Éxito', status: 'active', repo_url: process.env.MOCK_REPO || '', members: [{ employee_id: E1, name: 'Marta Ríos', role: 'Líder técnico', is_lead: true, email: 'marta@softnexus.co', emails: ['marta@softnexus.co', 'marta.rios.personal@gmail.com'], github_username: 'martarios', allocation_pct: 100 }, { employee_id: E2, name: 'Laura Gómez', role: 'Desarrolladora', is_lead: false, email: 'laura@x', emails: ['laura@x', 'laura.personal@gmail.com'], github_username: 'lauragomez', allocation_pct: 100 }] },
        { id: 'p3', name: 'Clientes VIP', client_name: 'Almacenes Éxito', status: 'active', repo_url: null, members: [] },
        { id: 'p4', name: 'Tienda', client_name: 'Almacenes Éxito', status: 'active', repo_url: null, members: [] },
        { id: OTHER, name: 'Facturación', client_name: 'Interno', status: 'active', repo_url: null, members: [] },
        { id: 'p5', name: 'Outlet', client_name: 'Almacenes Éxito', status: 'active', repo_url: null, members: [] },
      ].filter((p) => allowed(p.id) || p.id === 'p3' || p.id === 'p4' || p.id === 'p5')
        .map((p) => ({ ...p, repo_url: p.id in repos ? repos[p.id] : (repoDe[p.id] ?? null), repos: (listaRepos[p.id] || []).map(conUrl) }));
      return send(res, 200, { total: todos.length, page, limit, items: todos.slice((page - 1) * limit, page * limit) });
    }
    const sprintsDe = base.match(/^\/projects\/([^/]+)\/sprints$/);
    if (req.method === 'GET' && sprintsDe) return send(res, 200, { items: SPRINTS });
    const deps = base.match(/^\/tasks\/([^/]+)\/dependencies(?:\/([^/]+))?$/);
    if (deps) {
      const id = decodeURIComponent(deps[1]);
      const lista = () => ({ items: (dependencias.get(id) || []).map((b2) => { const t = tasks.find((x) => x.id === b2) || {}; return { id: b2, number: t.number, title: t.title, state: t.state }; }) });
      if (req.method === 'GET') return send(res, 200, lista());
      if (req.method === 'POST') {
        const { blocker_id: bloqueador } = JSON.parse(body);
        if (bloqueador === id) return send(res, 422, { error: 'una tarea no se bloquea a sí misma' });
        if (!tasks.some((t) => t.id === bloqueador)) return send(res, 422, { error: 'ese bloqueador no es de este proyecto' });
        if ((dependencias.get(bloqueador) || []).includes(id)) return send(res, 422, { error: 'ya se bloquean en el otro sentido' });
        const actuales = dependencias.get(id) || [];
        if (!actuales.includes(bloqueador)) dependencias.set(id, [...actuales, bloqueador]);
        return send(res, 201, lista());
      }
      if (req.method === 'DELETE') {
        dependencias.set(id, (dependencias.get(id) || []).filter((b2) => b2 !== decodeURIComponent(deps[2] || '')));
        res.writeHead(204); return res.end();
      }
    }
    if (req.method === 'GET' && base === '/tasks') {
      const q = url.searchParams;
      const since = q.get('updated_since');
      // OJO: el Altum real IGNORA external_ref en este filtro y devuelve TODAS las tareas del
      // proyecto. Se copia ese comportamiento para que las pruebas vean lo que ve la gente.
      const match = (t) => allowed(t.project_id) && (!q.get('project_id') || t.project_id === q.get('project_id'));
      const nativas = tasks.map((t) => ({ ...t, source: 'altum' }));
      // Las de Acten ya traen updated_at: se filtran igual que las nativas (su fecha viaja sin zona).
      const fecha = (t) => String(t.updated_at || '').replace(/(\d)$/, '$1Z').replace(/ZZ$/, 'Z');
      const todas = [...nativas, acten];
      const all = todas.filter((t) => match(t) && (!since || fecha(t) >= since))
        .sort((a, b) => String(a.updated_at || '').localeCompare(String(b.updated_at || '')));
      const page = Number(q.get('page') || 1);
      const limit = Math.min(Number(q.get('limit') || 50), MOCK_PAGE);
      const out = { items: all.slice((page - 1) * limit, page * limit), total: all.length, page, limit };
      if (q.get('include_deleted') === 'true') out.deleted = deleted.filter((d) => !since || d.deleted_at >= since);
      return send(res, 200, out);
    }
    const one = base.match(/^\/tasks\/([^/]+)$/);
    if (req.method === 'POST' && base === '/tasks') {
      const idem = req.headers['idempotency-key'];
      if (idem && idempotent.has(idem)) return send(res, 201, idempotent.get(idem));
      const data = JSON.parse(body);
      if (!data.project_id || !data.title) return send(res, 400, { error: 'project_id y title obligatorios' });
      if (badField(data.custom_fields)) return send(res, 422, { error: `campo ${badField(data.custom_fields)[0]} no válido` });
      if (malDato(data)) return send(res, 422, { error: malDato(data) });
      if (planearProhibido(data).length) return send(res, 403, { detail: { error: 'Eso lo decide quien lleva el proyecto', campos: planearProhibido(data) } });
      if (data.external_ref && (data.external_ref === forzar409 || tasks.some((t) => t.project_id === data.project_id && t.external_ref === data.external_ref))) return send(res, 409, { error: 'external_ref ya existe' });
      const { assignee_email: email, ...rest } = data;
      if (email && !USERS[email]) return send(res, 404, { error: 'no hay nadie con ese correo' });
      const task = manual({ id: randomUUID(), number: (number += 1), state: 'new', created_at: now(), updated_at: now(), ...rest, ...(email ? { assignee_id: USERS[email] } : {}), updated_by: author });
      tasks.push(task);
      if (idem) idempotent.set(idem, task);
      return send(res, 201, task);
    }
    if (req.method === 'PATCH' && one && decodeURIComponent(one[1]).startsWith('acten:')) {
      if (decodeURIComponent(one[1]) !== acten.id) return send(res, 404, {});
      const data = JSON.parse(body);
      const prohibido = Object.keys(data).find((k) => !ACTEN_EDITABLES.includes(k));
      if (prohibido) return send(res, 422, { error: `"${prohibido}" no se puede cambiar en una tarea de Acten` });
      if (data.state && !ACTEN_STATES.includes(data.state)) return send(res, 422, { error: `estado "${data.state}" no existe en Acten` });
      Object.assign(acten, data, { updated_at: now().replace('Z', '') });
      return send(res, 200, acten);
    }
    if (req.method === 'GET' && one && decodeURIComponent(one[1]) === acten.id) return send(res, 200, acten);
    if (req.method === 'PATCH' && one) {
      const task = tasks.find((t) => t.id === one[1]);
      if (!task) return send(res, 404, {});
      const data = JSON.parse(body);
      if (badField(data.custom_fields)) return send(res, 422, { error: `campo ${badField(data.custom_fields)[0]} no válido` });
      if (malDato(data)) return send(res, 422, { error: malDato(data) });
      if (planearProhibido(data).length) return send(res, 403, { detail: { error: 'Eso lo decide quien lleva el proyecto', campos: planearProhibido(data) } });
      if (data.state && !STATES.some((s) => s.key === data.state)) return send(res, 422, { error: `estado "${data.state}" no existe en el proyecto` });
      if (data.state === 'closed' && task.title.includes(BLOCKED_TITLE)) return send(res, 409, { error: 'Hay bloqueadores sin resolver', bloqueadores: [{ id: 'b1', number: 12, title: 'Configurar pasarela', state: 'en_desarrollo' }] });
      Object.assign(task, data, { updated_at: now(), updated_by: author });
      return send(res, 200, task);
    }
    if (req.method === 'GET' && one) return send(res, 200, tasks.find((t) => t.id === one[1]) || {});
    return send(res, 404, { error: 'ruta' });
  });
}).listen(PORT);

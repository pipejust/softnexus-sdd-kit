#!/usr/bin/env node
// Softnexus sync: mantiene los sistemas de tareas externos al día con el proceso Spec Driven.
//   node sn-sync.mjs sync [--background] [--upsert-only] [--dry-run]   envía los cambios desde la última vez
//   node sn-sync.mjs test [conector]                                     prueba la conexión (evento sn.test)
//   node sn-sync.mjs export [--format csv|json] [--out archivo]          exporta los ítems para otro sistema
//   node sn-sync.mjs fetch <conector> <id-externo>                       trae una tarea del sistema externo
//   node sn-sync.mjs list                                                ítems y su etapa (Markdown, sin conexión)
//   node sn-sync.mjs show <ID>                                           ficha completa + commits, firmas, evidencia
//   node sn-sync.mjs whoami                                              de quién es la clave y qué proyectos tiene
//   node sn-sync.mjs projects [--json]                                   proyectos que ve la clave, con su clave corta
//   node sn-sync.mjs clone <clave o nombre> [--in <carpeta>]             clona ese proyecto desde el repo_url de Altum
//   node sn-sync.mjs set-repo <clave o nombre> [url]                     registra en Altum de dónde se clona (por defecto, el remoto)
//   node sn-sync.mjs repo-check                                          ¿este proyecto tiene repositorio registrado en Altum?
//   node sn-sync.mjs backlog <altum> [--all] [--json]                    tareas del proyecto: pendientes y si ya están en el repo
//   node sn-sync.mjs pull <altum> [--apply] [--include-closed]           Altum -> repo: tareas abiertas sin traer (--apply las crea)
//   node sn-sync.mjs link <ITEM> <altum> <id-tarea>                      enlaza un ítem con una tarea que ya existe en Altum
//   node sn-sync.mjs watch <altum> [--background] [--every 60]           vigila Altum mientras se trabaja (sin n8n)
//   node sn-sync.mjs watch-stop | inbox [--peek]                         detiene el vigilante / muestra los avisos pendientes
//   node sn-sync.mjs status                                              conectores, pendientes, última sync
//   node sn-sync.mjs githooks                                            activa la sync en commit/merge/pull (agrega, no reemplaza)
// Se ejecuta en la raíz del repositorio. Sin .sn/connectors.json no hace nada (proyecto no conectado).
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NotRetryable } from './sync/altum.mjs';
import { backlogMarkdown, checkProjectRepo, listProjects, pullAltum, readBacklog, repoReminder, setProjectRepo, whoAmI, whoAmIText } from './sync/altum-backlog.mjs';
import { alreadyThere, cloneProject, findProject, targetDir } from './sync/altum-clone.mjs';
import { clearInbox, describe, isWatching, readInbox, stopWatch, watch } from './sync/altum-watch.mjs';
import { deliver, fetchExternal } from './sync/connectors.mjs';
import { readItems, setExternalId, writeImportedItem } from './sync/items.mjs';
import { diffSnapshots, matches } from './sync/events.mjs';
import { itemMarkdown, listMarkdown } from './sync/report.mjs';
import { takeSnapshot } from './sync/snapshot.mjs';
import {
  acquireLock, appendOutbox, loadConfig, loadSnapshot, readOutbox, releaseLock, saveSnapshot, writeOutbox,
} from './sync/store.mjs';

const SELF = fileURLToPath(import.meta.url);
const DEBOUNCE_MS = 3000;
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

// Remoto "origin" de este repositorio, para registrarlo en Altum sin escribirlo a mano.
function remoteUrl() {
  try {
    return execFileSync('git', ['config', '--get', 'remote.origin.url'], { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function localActor() {
  try {
    const name = execFileSync('git', ['config', 'user.name'], { encoding: 'utf8' }).trim();
    const email = execFileSync('git', ['config', 'user.email'], { encoding: 'utf8' }).trim();
    return `${name} <${email}>`;
  } catch {
    return '';
  }
}

// Las notificaciones a personas (Matrix) solo salen desde el computador de quien hizo el cambio,
// para que la sala no reciba el mismo aviso desde cada computador que hace pull. En CI siempre salen.
function wanted(connector, evt, me) {
  if (!matches(connector.events, evt)) return false;
  const onlyMine = connector.only_local_actor ?? connector.kind === 'matrix';
  return !onlyMine || process.env.CI === 'true' || !evt.actor || evt.actor === me;
}

async function attempt(connector, evt, attempts = 0) {
  try {
    await deliver(connector, evt);
    return true;
  } catch (error) {
    if (error instanceof NotRetryable) {
      console.error(`sn-sync: ${connector.name} ${evt.item?.id || ''}: ${error.message}`);
      return true; // regla de negocio del sistema externo: reintentar no cambia nada
    }
    appendOutbox({ connector: connector.name, event: evt, attempts: attempts + 1, error: error.message, at: new Date().toISOString() });
    return false;
  }
}

async function retryOutbox(config) {
  const pending = readOutbox();
  if (!pending.length) return { retried: 0, dropped: 0 };
  writeOutbox([]);
  const byName = new Map(config.connectors.map((c) => [c.name, c]));
  let retried = 0;
  for (const entry of pending) {
    const connector = byName.get(entry.connector);
    if (connector && await attempt(connector, entry.event, entry.attempts)) retried += 1;
  }
  const dropped = writeOutbox(readOutbox());
  return { retried, dropped };
}

function upsertEvents(snapshot) {
  return snapshot.items.map((item) => ({
    specversion: '1.0', id: `${item.id}:${item.stage}:${item.flag}:${item.tasks_done ?? ''}`, type: 'sn.item.upserted',
    source: snapshot.source, project: snapshot.project, time: snapshot.taken_at, actor: item.actor, item,
  }));
}

async function sync(config) {
  if (flag('--background')) {
    spawn(process.execPath, [SELF, 'sync', '--delay'], { detached: true, stdio: 'ignore', cwd: process.cwd(), env: process.env }).unref();
    return;
  }
  if (flag('--delay')) await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS));
  if (!acquireLock()) return; // otra sincronización en curso; el siguiente disparo recoge lo que falte
  try {
    const outbox = await retryOutbox(config);
    const snapshot = takeSnapshot(config.project);
    const upsertOnly = flag('--upsert-only');
    const events = upsertOnly ? upsertEvents(snapshot) : diffSnapshots(loadSnapshot(), snapshot);
    const targets = upsertOnly ? config.connectors.filter((c) => ['rest', 'github', 'altum'].includes(c.kind)) : config.connectors;
    const me = localActor();
    let sent = 0;
    let failed = 0;
    for (const evt of events) {
      for (const connector of targets.filter((c) => wanted(c, evt, me))) {
        if (flag('--dry-run')) {
          console.log(`[dry-run] ${connector.name} <- ${evt.type} ${evt.item.id} (${evt.item.stage})`);
        } else if (await attempt(connector, evt)) sent += 1; else failed += 1;
      }
    }
    if (!flag('--dry-run')) saveSnapshot(snapshot);
    if (!flag('--quiet')) {
      console.log(`sn-sync: ${events.length} eventos · ${sent} entregas · ${failed} en cola`
        + ` · reintentos ok ${outbox.retried}${outbox.dropped ? ` · descartados ${outbox.dropped}` : ''}`);
    }
  } finally {
    releaseLock();
  }
}

async function test(config) {
  const only = args[1];
  const snapshot = { source: 'sn-sync test', project: config.project || path.basename(process.cwd()), taken_at: new Date().toISOString() };
  const item = { id: 'SN-TEST', type: 'chore', title: 'Prueba de conexión Softnexus', stage: 'triaged', stage_label: 'Tarjeta', flag: '', risk: 'R0', size: 'XS' };
  const evt = { specversion: '1.0', id: `test-${Date.now()}`, type: 'sn.test', ...snapshot, time: snapshot.taken_at, item };
  let ok = true;
  for (const connector of config.connectors.filter((c) => !only || c.name === only)) {
    try {
      await deliver(connector, evt);
      console.log(`OK     ${connector.name} (${connector.kind})`);
    } catch (error) {
      ok = false;
      console.log(`FALLA  ${connector.name} (${connector.kind}): ${error.message}`);
    }
  }
  process.exitCode = ok ? 0 : 1;
}

function csvCell(value) {
  const text = String(value ?? '').replace(/\r?\n/g, ' ');
  return /[",;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportItems(config) {
  const { items } = takeSnapshot(config?.project);
  const format = option('--format', 'csv');
  const columns = ['id', 'type', 'title', 'stage', 'stage_label', 'flag', 'risk', 'size', 'assignee', 'branch', 'change', 'pr_url', 'commit_count', 'file', 'created', 'story'];
  const output = format === 'json'
    ? `${JSON.stringify(items, null, 2)}\n`
    : `${columns.join(',')}\n${items.map((i) => columns.map((c) => csvCell(i[c])).join(',')).join('\n')}\n`;
  const out = option('--out', '');
  if (out) {
    writeFileSync(out, output);
    console.log(`${items.length} ítems exportados a ${out}`);
  } else process.stdout.write(output);
}

async function pull(config) {
  const connector = config.connectors.find((c) => c.name === args[1]);
  if (!connector || connector.kind !== 'altum') throw new Error('uso: pull <conector de tipo altum> [--apply]');
  const stateFile = path.join('.sn', 'state', `pull-${connector.name}.json`);
  const since = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')).since : '';
  const startedAt = new Date().toISOString();
  const result = await pullAltum(connector, since, '.', { includeClosed: flag('--include-closed') });
  result.created.forEach((t) => console.log(`${flag('--apply') ? 'NUEVO' : 'nuevo (sin crear)'}  ${t.id}  ${t.title}`));
  result.changed.forEach((c) => console.log(`cambió en Altum  ${c.id}  estado=${c.state}  prioridad=${c.priority}`));
  result.deleted.forEach((d) => console.log(`borrada en Altum  ${d.id}  (#${d.number} ${d.title}): decide si se descarta el ítem o se vuelve a crear`));
  if (flag('--apply')) {
    result.created.forEach((t) => writeImportedItem('.', t));
    mkdirSync(path.dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ since: startedAt }));
  }
  console.log(`${result.checked} tareas revisadas · ${result.created.length} abiertas sin traer · ${result.changed.length} enlazadas${result.skippedClosed ? ` · ${result.skippedClosed} terminadas omitidas` : ''}`);
}

function altumConnector(config, name) {
  const connector = config.connectors.find((c) => c.name === name);
  if (!connector || connector.kind !== 'altum') throw new Error(`no existe un conector altum llamado "${name}"`);
  return connector;
}

// El conector de Altum del repo; si todavía no hay ninguno, basta la clave para leer y clonar.
function anyAltum(config) {
  return config?.connectors.find((c) => c.kind === 'altum') || { name: 'altum', kind: 'altum' };
}

async function projects(config) {
  const list = await listProjects(anyAltum(config));
  if (!list.length) return console.log('La clave no ve proyectos. Revisa que sea la clave correcta.');
  if (flag('--json')) return process.stdout.write(`${JSON.stringify(list, null, 2)}\n`);
  console.log('clave                  proyecto');
  list.forEach((p) => console.log(`${p.key.padEnd(22)} ${p.name || '(sin nombre)'}${p.client ? `  · cliente: ${p.client}` : ''}${p.repo ? '' : '  (sin repositorio en Altum)'}  ${p.id}`));
  console.log('\nPara empezar a trabajar en uno: clone <clave o nombre>');
}

// set-repo <clave o nombre> [url]: registra en Altum de dónde se clona ese proyecto.
// Sin url, usa el remoto "origin" de este repositorio.
async function setRepo(config) {
  const libres = args.slice(1).filter((a) => !a.startsWith('--'));
  const url = libres.find((a) => /^(https?:|git@)/.test(a)) || remoteUrl();
  const query = libres.filter((a) => a !== url).join(' ').trim();
  if (!query) throw new Error('uso: set-repo <clave o nombre del proyecto> [url del repositorio]');
  if (!url) throw new Error('este repositorio no tiene remoto "origin": pasa la dirección como segundo argumento');
  const connector = anyAltum(config);
  const { match, candidates } = findProject(await listProjects(connector), query);
  if (candidates) {
    console.log(`Hay ${candidates.length} proyectos parecidos a "${query}". ¿Cuál es?`);
    candidates.forEach((p) => console.log(`  ${p.key.padEnd(22)} ${p.name}`));
    process.exitCode = 1;
    return;
  }
  if (!match) throw new Error(`ninguno de tus proyectos se parece a "${query}".`);
  if (match.repo && match.repo !== url) console.log(`Ojo: ya tenía registrado ${match.repo}`);
  try {
    await setProjectRepo(connector, match.id, url);
  } catch (error) {
    if (/HTTP 403/.test(error.message)) {
      throw new Error('tu clave no tiene el permiso "projects:write" (es anterior a ese cambio): regenérala en Altum → Mi perfil → Mis datos y vuelve a guardarla.');
    }
    throw error;
  }
  console.log(`Listo: "${match.name}" se clona desde ${url}. Ahora cualquiera del equipo puede pedir "clóname ${match.key}".`);
}

// clone <clave o nombre> [--in <carpeta>] [--dry-run]: busca el proyecto en Altum y lo clona desde repo_url.
// Sirve aunque este repositorio no tenga nada configurado: solo hace falta la clave de Altum.
async function clone(config) {
  const query = args.slice(1).filter((a, i) => !a.startsWith('--') && args[i] !== '--in').join(' ').trim();
  if (!query) throw new Error('uso: clone <clave o nombre del proyecto> [--in <carpeta>] [--dry-run]');
  const { match, candidates } = findProject(await listProjects(anyAltum(config)), query);
  if (candidates) {
    console.log(`Hay ${candidates.length} proyectos parecidos a "${query}". ¿Cuál es?`);
    candidates.forEach((p) => console.log(`  ${p.key.padEnd(22)} ${p.name}${p.client ? `  · cliente: ${p.client}` : ''}`));
    process.exitCode = 1;
    return;
  }
  if (!match) throw new Error(`ninguno de tus proyectos se parece a "${query}". Mira la lista con "projects"; si falta uno, pide que te asignen a él en Altum.`);
  if (!match.repo) throw new Error(`"${match.name}" no tiene repositorio registrado en Altum. Regístralo en su ficha ("Repositorio" → Registrar) y vuelve a intentar.`);
  const parent = option('--in', '..');
  const dir = targetDir(match, parent);
  if (alreadyThere(dir)) return console.log(`"${match.name}" ya está en ${dir}. Ábrelo ahí; no se clona de nuevo.`);
  if (flag('--dry-run')) return console.log(`git clone ${match.repo} ${dir}`);
  cloneProject(match, parent);
  console.log(`Clonado: ${match.name} → ${dir}`);
  console.log(`Ábrelo con Claude Code. Si todavía no tiene la metodología, usa /sn-setup (proyecto de Altum: ${match.id}).`);
}

async function backlog(config) {
  const list = await readBacklog(altumConnector(config, args[1]));
  if (flag('--json')) process.stdout.write(`${JSON.stringify(list.map(({ task, ...rest }) => rest), null, 2)}\n`);
  else process.stdout.write(backlogMarkdown(list, { all: flag('--all') }));
}

function link(config) {
  const [, itemId, name, taskId] = args;
  altumConnector(config, name);
  const item = readItems().find((i) => i.id.toLowerCase() === String(itemId).toLowerCase());
  if (!item || !taskId) throw new Error('uso: link <ITEM> <conector altum> <id de la tarea en Altum>');
  setExternalId(item.file, name, taskId);
  console.log(`${item.id} quedó enlazado con la tarea ${taskId} de Altum (${item.file}).`);
}

async function startWatch(config) {
  const connector = altumConnector(config, args[1]);
  if (flag('--background')) {
    if (isWatching()) return;
    const rest = args.filter((a) => a !== '--background');
    spawn(process.execPath, [SELF, ...rest], { detached: true, stdio: 'ignore', cwd: process.cwd(), env: process.env }).unref();
    return;
  }
  await watch(connector, {
    everySeconds: Math.max(Number(option('--every', 60)), 20),
    maxMinutes: Number(option('--max-minutes', 480)),
    notify: !flag('--no-notify') && connector.notify !== false,
  });
}

function inbox() {
  const notes = readInbox();
  if (!notes.length) return console.log('Sin avisos nuevos de Altum.');
  notes.forEach((n) => console.log(`- ${describe(n)}`));
  if (!flag('--peek')) clearInbox();
}

function status(config) {
  const last = loadSnapshot();
  console.log(`Proyecto: ${config.project || path.basename(process.cwd())}`);
  config.connectors.forEach((c) => console.log(`  ${c.name.padEnd(14)} ${c.kind.padEnd(8)} eventos: ${(c.events || ['*']).join(', ')}`));
  console.log(`Última sincronización: ${last?.taken_at || 'nunca'} · ítems: ${last?.items.length ?? 0} · en cola: ${readOutbox().length}`);
}

// Agrega una línea marcada a los hooks de git (sin reemplazar hooks existentes como husky).
const HOOK_MARK = '# softnexus-sync';
const HOOK_LINE = `( [ -f .sn/connectors.json ] && [ -f scripts/sn/sn-sync.mjs ] && node scripts/sn/sn-sync.mjs sync --background >/dev/null 2>&1 ) || true ${HOOK_MARK}`;

function githooks() {
  const configured = (() => {
    try { return execFileSync('git', ['config', 'core.hooksPath'], { encoding: 'utf8' }).trim(); } catch { return ''; }
  })();
  const dir = configured || execFileSync('git', ['rev-parse', '--git-path', 'hooks'], { encoding: 'utf8' }).trim();
  mkdirSync(dir, { recursive: true });
  for (const hook of ['post-commit', 'post-merge', 'post-checkout', 'post-rewrite']) {
    const file = path.join(dir, hook);
    const current = existsSync(file) ? readFileSync(file, 'utf8') : '#!/bin/sh\n';
    if (!current.includes(HOOK_MARK)) writeFileSync(file, `${current.replace(/\n?$/, '\n')}${HOOK_LINE}\n`);
    chmodSync(file, 0o755);
  }
  console.log(`Sincronización enganchada a commit, merge, checkout y rebase (${dir}).`);
}

const command = args[0] || 'sync';
const config = loadConfig();
if (command === 'export') exportItems(config);
else if (command === 'list') process.stdout.write(listMarkdown(takeSnapshot(config?.project)));
else if (command === 'show') {
  const item = takeSnapshot(config?.project).items.find((i) => i.id.toLowerCase() === String(args[1]).toLowerCase());
  if (item) process.stdout.write(itemMarkdown(item));
  else { console.log(`No existe el ítem ${args[1]}. Usa "list" para ver los ids.`); process.exitCode = 1; }
}
else if (command === 'githooks') githooks();
// clone y whoami funcionan aunque el repositorio todavía no esté conectado: basta la clave de Altum.
else if (command === 'clone') await clone(config);
else if (command === 'set-repo') await setRepo(config);
// repo-check: mira si el proyecto ya tiene repositorio registrado y lo deja anotado para el aviso.
else if (command === 'repo-check') {
  const connector = config?.connectors.find((c) => c.kind === 'altum' && c.project_id);
  if (connector) {
    const estado = await checkProjectRepo(connector);
    console.log(estado.missing ? repoReminder() : `"${estado.name}" se clona desde ${estado.repo}`);
  }
}
else if (command === 'whoami') {
  const connector = config?.connectors.find((c) => c.kind === 'altum' && (!args[1] || c.name === args[1]))
    || { name: 'altum', kind: 'altum' };
  process.stdout.write(whoAmIText(await whoAmI(connector), connector.project_id));
}
else if (!config || !config.connectors.length) {
  if (command !== 'sync') console.log('Proyecto sin conectores. Configúralos con /sn-connect.');
} else if (command === 'sync') await sync(config);
else if (command === 'test') await test(config);
else if (command === 'status') status(config);
else if (command === 'pull') await pull(config);
else if (command === 'projects') await projects(config);
else if (command === 'backlog') await backlog(config);
else if (command === 'link') link(config);
else if (command === 'watch') await startWatch(config);
else if (command === 'watch-stop') console.log(stopWatch() ? 'Vigilante detenido.' : 'No había vigilante activo.');
else if (command === 'inbox') inbox();
else if (command === 'fetch') {
  const connector = config.connectors.find((c) => c.name === args[1]);
  if (!connector) throw new Error(`no existe el conector ${args[1]}`);
  process.stdout.write(`${JSON.stringify(await fetchExternal(connector, args[2]), null, 2)}\n`);
} else {
  console.log('Uso: sn-sync.mjs sync|test|list|show|export|fetch|projects|whoami|clone|set-repo|repo-check|backlog|pull|link|watch|watch-stop|inbox|status|githooks');
  process.exitCode = 2;
}

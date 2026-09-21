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
//   node sn-sync.mjs clone <clave o nombre> [--in <carpeta>|--into <ruta>] clona ese proyecto desde el repo_url de Altum
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
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasKey, keyName, listTasks, NotRetryable, projectStates } from './sync/altum.mjs';
import { addProjectRepo, backlogMarkdown, checkProjectRepo, fetchAltumTask, leadText, listProjects, listRepos, projectLead, pullAltum, readBacklog, removeProjectRepo, repoReminder, whoAmI, whoAmIText } from './sync/altum-backlog.mjs';
import { alreadyThere, cloneProject, findProject, findRepo, targetDir } from './sync/altum-clone.mjs';
import { clearInbox, describe, isWatching, readInbox, stopWatch, watch } from './sync/altum-watch.mjs';
import { deliver, fetchExternal } from './sync/connectors.mjs';
import { readItems, setExternalId, writeImportedItem } from './sync/items.mjs';
import { diffSnapshots, matches } from './sync/events.mjs';
import { itemMarkdown, listMarkdown } from './sync/report.mjs';
import { takeSnapshot } from './sync/snapshot.mjs';
import { mensajeValidacion } from './sync/validacion-mensaje.mjs';
import { parseLog } from './validation-state.mjs';
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
  console.log(`${result.checked} tareas revisadas · ${result.created.length} abiertas sin traer · ${result.changed.length} enlazadas`
    + `${result.skippedClosed ? ` · ${result.skippedClosed} terminadas omitidas` : ''}`
    + `${result.deActen ? ` · ${result.deActen} nacidas en reuniones (Acten)` : ''}`);
}

// Lo que escribió la persona, sin las opciones ni sus valores ("--repo APP SIPAR" no es parte del nombre).
const CON_VALOR = ['--in', '--into', '--repo', '--sello', '--riesgo', '--titulo', '--que', '--pr', '--format', '--out', '--every'];
function textoLibre(lista) {
  const libres = [];
  for (let i = 0; i < lista.length; i += 1) {
    if (CON_VALOR.includes(lista[i])) { i += 1; continue; }
    if (!lista[i].startsWith('--')) libres.push(lista[i]);
  }
  return libres;
}

function gitOut(argumentos) {
  try {
    return execFileSync('git', argumentos, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

// El change activo: el único que haya, o el que pidan por nombre.
function changeActivo(nombre) {
  const dir = 'openspec/changes';
  if (nombre) return nombre;
  if (!existsSync(dir)) return '';
  const activos = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== 'archive').map((d) => d.name);
  if (activos.length > 1) throw new Error(`hay ${activos.length} cambios abiertos (${activos.join(', ')}): dime cuál con "mensaje <change>"`);
  return activos[0] || '';
}

function urlDelPr(rama) {
  if (process.env.SN_SYNC_NO_GH) return '';
  try {
    return JSON.parse(execFileSync('gh', ['pr', 'view', rama, '--json', 'url'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })).url || '';
  } catch {
    return '';
  }
}

// Mensaje listo para copiarle al líder. Mientras no haya mensajería conectada, esto ES el canal:
// lo arma el motor (no el agente) para que siempre lleve rama, commit, quién firma y cómo empezar.
async function mensaje(config) {
  const change = changeActivo(args[1] && !args[1].startsWith('--') ? args[1] : '');
  const rama = gitOut(['rev-parse', '--abbrev-ref', 'HEAD']);
  const archivo = change ? path.join('openspec/changes', change, 'validacion.md') : '';
  const entradas = archivo && existsSync(archivo) ? parseLog(readFileSync(archivo, 'utf8')) : [];
  const solicitud = [...entradas].reverse().find((e) => e.type === 'SOLICITUD');
  const connector = config?.connectors.find((c) => c.kind === 'altum' && c.project_id);
  // El líder y el nombre del proyecto salen de Altum; si Altum no responde, el mensaje se arma igual.
  let lider = null;
  let proyecto = '';
  if (connector) {
    try {
      lider = await projectLead(connector);
      proyecto = lider?.project || '';
    } catch {
      lider = null;
    }
  }
  process.stdout.write(`${mensajeValidacion({
    proyecto: proyecto || config?.project || path.basename(process.cwd()),
    sello: option('--sello', solicitud?.seal || 'plano'),
    riesgo: option('--riesgo', (solicitud?.fields?.Riesgo || '').split(' · ')[0]),
    pide: localActor().replace(/\s*<[^>]*>$/, '') || '',
    titulo: option('--titulo', change || ''),
    queValidar: option('--que', solicitud?.fields?.['Qué validar'] || ''),
    rama,
    // El commit de la solicitud: es exactamente lo que el líder tiene que mirar, no lo último que haya.
    commit: (solicitud?.raw.match(/Commit:\s*([0-9a-f]{7,40})/)?.[1]) || gitOut(['rev-parse', '--short', 'HEAD']),
    pr: option('--pr', urlDelPr(rama)),
    lider: lider?.falta ? null : lider,
    clonar: proyecto || config?.project || path.basename(process.cwd()),
  })}\n`);
  if (!lider) console.log('(Altum no dijo quién es el líder: pregúntale a la persona a quién se lo manda.)');
  if (!rama || rama === 'main' || rama === 'master') console.log('(Ojo: no estás en una rama de trabajo, así que el líder no tendría qué validar.)');
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

// repos [<clave o nombre>]: los repositorios que tiene ese proyecto en Altum (pueden ser varios).
async function repos(config) {
  const connector = anyAltum(config);
  const query = textoLibre(args.slice(1)).join(' ').trim();
  const todos = await listProjects(connector);
  const { match, candidates } = query ? findProject(todos, query) : { match: todos.find((p) => p.id === connector.project_id) };
  if (candidates) throw new Error(`hay ${candidates.length} proyectos parecidos a "${query}": ${candidates.map((p) => p.key).join(', ')}`);
  if (!match) throw new Error('uso: repos <clave o nombre del proyecto> (o conecta este repositorio con /sn-connect)');
  const lista = (await listRepos(connector, match.id)) || match.repos;
  if (!lista.length) {
    console.log(`"${match.name}" no tiene repositorios registrados en Altum. Regístralo con: set-repo ${match.key} <url>`);
    return;
  }
  console.log(`"${match.name}" — ${lista.length} repositorio${lista.length > 1 ? 's' : ''}:`);
  lista.forEach((r) => console.log(`  ${r.name.padEnd(38)} ${r.provider === 'github' ? '' : `[${r.provider}] `}${r.url}`));
  if (lista.length > 1) console.log(`\nPara traer uno: clone ${match.key} --repo <nombre> --in <carpeta>`);
  console.log(`Para quitar uno mal registrado: quitar-repo ${match.key} <nombre o dirección> --si`);
}

async function projects(config) {
  const list = await listProjects(anyAltum(config));
  if (!list.length) return console.log('La clave no ve proyectos. Revisa que sea la clave correcta.');
  if (flag('--json')) return process.stdout.write(`${JSON.stringify(list, null, 2)}\n`);
  console.log('clave                  proyecto');
  list.forEach((p) => console.log(`${p.key.padEnd(22)} ${p.name || '(sin nombre)'}${p.client ? `  · cliente: ${p.client}` : ''}`
    + `${p.repos.length > 1 ? `  (${p.repos.length} repositorios)` : p.repos.length ? '' : '  (sin repositorio en Altum)'}  ${p.id}`));
  console.log('\nPara empezar a trabajar en uno: clone <clave o nombre>');
}

// set-repo <clave o nombre> [url]: registra en Altum de dónde se clona ese proyecto.
// Sin url, usa el remoto "origin" de este repositorio.
async function setRepo(config) {
  const libres = textoLibre(args.slice(1));
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
  let resultado;
  try {
    resultado = await addProjectRepo(connector, match.id, url);
  } catch (error) {
    if (/HTTP 403/.test(error.message)) {
      throw new Error('tu clave no tiene el permiso "projects:write" (es anterior a ese cambio): regenérala en Altum → Mi perfil → Mis datos y vuelve a guardarla.');
    }
    throw error;
  }
  if (resultado.modo === 'ya-estaba') return console.log(`"${match.name}" ya tenía registrado ${resultado.repo}. No cambié nada.`);
  if (resultado.modo === 'uno-solo' && match.repo && match.repo !== url) console.log(`Ojo: reemplacé el que tenía (${match.repo}); esta versión de Altum solo guarda uno por proyecto.`);
  const otros = match.repos.filter((r) => r.name !== resultado.repo).map((r) => r.name);
  console.log(`Listo: "${match.name}" se clona desde ${url}${resultado.provider === 'github' ? '' : ` (${resultado.provider})`}.`
    + `${otros.length ? ` Ese proyecto ya tenía: ${otros.join(', ')}.` : ''}`);
  console.log(`Ahora cualquiera del equipo puede pedir "clóname ${match.key}".`);
}

// asegurar <ITEM>: garantiza que el ítem YA tiene su tarea en Altum antes de empezar a construir.
// La sincronización normal corre sola y en segundo plano; esto la hace en primer plano, comprueba
// que la tarea exista de verdad en Altum y, si algo falla, dice por qué en vez de callarse.
async function asegurar(config) {
  const id = args[1];
  if (!id) throw new Error('uso: asegurar <ID del ítem>');
  const connector = config?.connectors.find((c) => c.kind === 'altum' && c.enabled !== false);
  if (!connector?.project_id) throw new Error('este repositorio no está unido a un proyecto de Altum: conéctalo con /sn-connect antes de construir (o sigue sin Altum si la persona así lo decidió).');
  if (!hasKey(connector)) throw new Error(`falta la clave de Altum (${keyName(connector)}) en este computador: guárdala siguiendo references/clave-altum.md.`);
  const buscar = () => takeSnapshot(config.project).items.find((i) => i.id.toLowerCase() === String(id).toLowerCase());
  let item = buscar();
  if (!item) throw new Error(`no existe el ítem ${id} en docs/items/.`);
  // ¿La tarea que dice el ítem existe de verdad en Altum? (pudo borrarse o ser de otro proyecto)
  const existente = async (taskId) => {
    // Sin enlace en el ítem (p. ej. otro computador), se busca por external_ref = ID del ítem.
    if (!taskId) {
      const { items } = await listTasks(connector, { project_id: connector.project_id, external_ref: item.id });
      if (items[0] && item.file) setExternalId(item.file, connector.name, items[0].id);
      return items[0] || null;
    }
    try {
      const tarea = await fetchAltumTask(connector, taskId);
      return tarea?.id ? tarea : null;
    } catch (error) {
      if (/HTTP 404/.test(error.message)) return null;
      throw error;
    }
  };
  let tarea = await existente(item.external?.[connector.name]);
  if (tarea) {
    // Ya existe: se le lleva la etapa actual del ítem (al cerrar, esto la deja terminada en Altum).
    await deliver(connector, { specversion: '1.0', id: `${item.id}:asegurar`, type: 'sn.item.upserted', project: config.project, time: new Date().toISOString(), actor: localActor(), item });
    tarea = await existente(item.external?.[connector.name]);
  } else {
    // Si el ítem apuntaba a una tarea que ya no existe (se borró en Altum), se olvida ese enlace y se crea de nuevo.
    const anterior = item.external?.[connector.name];
    const sinEnlace = { ...item, external: { ...(item.external || {}), [connector.name]: undefined }, ...(anterior ? { recrear: anterior } : {}) };
    await deliver(connector, { specversion: '1.0', id: `${item.id}:asegurar`, type: 'sn.item.upserted', project: config.project, time: new Date().toISOString(), actor: localActor(), item: sinEnlace });
    item = buscar();
    tarea = await existente(item.external?.[connector.name]);
  }
  if (!tarea) throw new Error(`no pude confirmar la tarea de ${item.id} en Altum. Revisa "status" y vuelve a intentar antes de construir.`);
  const numero = tarea.number ? `#${tarea.number}` : tarea.id;
  console.log(`Tarea en Altum ${numero}: ${tarea.title} · estado ${tarea.state}`);
  if (['merged', 'done'].includes(item.stage)) {
    const { done } = await projectStates(connector);
    const cerrada = [...done, 'done', 'cancelled'].includes(tarea.state);
    console.log(cerrada ? `Cerrada en Altum: ${item.id} terminó.` : `OJO: el ítem terminó pero la tarea sigue en "${tarea.state}" en Altum.`);
    if (!cerrada) process.exitCode = 1;
  } else {
    console.log(`Ítem ${item.id} enlazado (ext.${connector.name}: ${tarea.id}). Ya se puede construir.`);
  }
}

// quitar-repo <proyecto> <nombre o dirección> --si: saca un repositorio mal registrado del proyecto.
// Pide confirmación explícita porque lo ve todo el equipo: sin --si solo dice qué haría.
async function quitarRepo(config) {
  const libres = textoLibre(args.slice(1));
  const [query, ...resto] = libres;
  const cual = resto.join(' ').trim();
  if (!query || !cual) throw new Error('uso: quitar-repo <clave o nombre del proyecto> <nombre o dirección del repositorio> --si');
  const connector = anyAltum(config);
  const { match, candidates } = findProject(await listProjects(connector), query);
  if (candidates) throw new Error(`hay ${candidates.length} proyectos parecidos a "${query}": ${candidates.map((p) => p.key).join(', ')}`);
  if (!match) throw new Error(`ninguno de tus proyectos se parece a "${query}".`);
  const lista = (await listRepos(connector, match.id)) || match.repos;
  const { repo, choices } = findRepo({ ...match, repos: lista }, cual);
  if (!repo || choices) {
    console.log(`No sé cuál quitar de "${match.name}". Sus repositorios son:`);
    (choices || lista).forEach((r) => console.log(`  ${r.name}`));
    process.exitCode = 1;
    return;
  }
  if (!flag('--si')) {
    console.log(`Quitaría "${repo.name}" de "${match.name}" (${repo.url}).`);
    console.log('Pregúntale a la persona si es ese y vuelve a llamarme con --si. Lo ve todo el equipo; el código no se borra, solo el registro en Altum.');
    process.exitCode = 1;
    return;
  }
  const { quitado, motivo } = await removeProjectRepo(connector, match.id, repo);
  console.log(quitado
    ? `Listo: "${repo.name}" ya no figura en "${match.name}". El repositorio sigue existiendo; solo se quitó de Altum.`
    : `"${repo.name}" no estaba registrado en "${match.name}"${motivo ? '' : ''}. No cambié nada.`);
}

// clone <clave o nombre> [--in <carpeta>] [--dry-run]: busca el proyecto en Altum y lo clona desde repo_url.
// Sirve aunque este repositorio no tenga nada configurado: solo hace falta la clave de Altum.
async function clone(config) {
  const query = textoLibre(args.slice(1)).join(' ').trim();
  if (!query) throw new Error('uso: clone <clave o nombre> [--repo <cuál>] [--in <carpeta madre> | --into <ruta exacta> | --here] [--dry-run]');
  const { match, candidates } = findProject(await listProjects(anyAltum(config)), query);
  if (candidates) {
    console.log(`Hay ${candidates.length} proyectos parecidos a "${query}". ¿Cuál es?`);
    candidates.forEach((p) => console.log(`  ${p.key.padEnd(22)} ${p.name}${p.client ? `  · cliente: ${p.client}` : ''}`));
    process.exitCode = 1;
    return;
  }
  if (!match) throw new Error(`ninguno de tus proyectos se parece a "${query}". Mira la lista con "projects"; si falta uno, pide que te asignen a él en Altum.`);
  if (!match.repo) throw new Error(`"${match.name}" no tiene repositorio registrado en Altum. Regístralo en su ficha ("Repositorios") y vuelve a intentar.`);
  // Un proyecto puede tener varios repositorios (app, web, consola...). Cuál se trae lo elige la persona.
  const { repo, choices } = findRepo(match, option('--repo', ''));
  if (choices) {
    console.log(`"${match.name}" tiene ${choices.length} repositorios. Pregúntale a la persona cuál quiere y vuelve a llamarme con --repo <nombre>:`);
    choices.forEach((r) => console.log(`  --repo ${r.name.split('/').pop().padEnd(20)} ${r.url}`));
    process.exitCode = 1;
    return;
  }
  // La carpeta NUNCA se decide sola: la elige la persona.
  //   --in <carpeta madre> → <carpeta>/<clave>   ·   --into <ruta> o --here → el contenido va ahí mismo.
  if (!flag('--here') && !args.includes('--in') && !args.includes('--into')) {
    throw new Error(`no clono sin saber dónde. Pregúntale a la persona en qué carpeta lo quiere y vuelve a llamarme:\n`
      + `  --in <carpeta madre>   → queda en <carpeta>/${path.basename(targetDir(match, '.', { repo }))}\n`
      + `  --into <ruta exacta>   → el contenido del repositorio queda ahí mismo\n`
      + `  --here                 → en la carpeta actual (solo si está vacía)`);
  }
  const exact = flag('--here') || args.includes('--into');
  const parent = flag('--here') ? '.' : option('--into', option('--in'));
  const dir = targetDir(match, parent, { exact, repo });
  if (alreadyThere(dir)) return console.log(`"${match.name}" ya está en ${dir}. Ábrelo ahí; no se clona de nuevo.`);
  if (flag('--dry-run')) return console.log(`git clone ${repo?.url || match.repo} ${dir}`);
  cloneProject(match, parent, { exact, repo });
  console.log(`Clonado: ${match.name}${match.repos.length > 1 ? ` (${repo.name})` : ''} → ${dir}`);
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
  const deReunion = String(taskId).startsWith('acten:')
    ? ' Viene de una reunión: solo se le pueden cambiar estado, responsable, título y descripción.' : '';
  console.log(`${item.id} quedó enlazado con la tarea ${taskId} de Altum (${item.file}).${deReunion}`);
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
// projects, clone y whoami funcionan aunque el repositorio todavía no esté conectado (incluso en una carpeta vacía): basta la clave de Altum.
else if (command === 'projects') await projects(config);
else if (command === 'lead') {
  const connector = config?.connectors.find((c) => c.kind === 'altum' && (!args[1] || c.name === args[1]));
  if (!connector?.project_id) throw new Error('uso: lead [conector altum] — este repositorio todavía no está unido a un proyecto de Altum (/sn-connect)');
  process.stdout.write(leadText(await projectLead(connector)));
}
else if (command === 'repos') await repos(config);
else if (command === 'asegurar') await asegurar(config);
else if (command === 'quitar-repo') await quitarRepo(config);
else if (command === 'mensaje') await mensaje(config);
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
  console.log('Uso: sn-sync.mjs sync|test|list|show|export|fetch|projects|repos|asegurar|whoami|lead|mensaje|clone|set-repo|quitar-repo|repo-check|backlog|pull|link|watch|watch-stop|inbox|status|githooks');
  process.exitCode = 2;
}
